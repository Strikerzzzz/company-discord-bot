import { AttachmentBuilder, Channel, PermissionFlagsBits, RESTJSONErrorCodes } from "discord.js";
import type DiscordClient from "../classes/DiscordClient";
import { LeaderboardPage, LeaderboardPeriod, LeaderboardScope, ScoreKind } from "../modules/leaderboard/LeaderboardService";
import { LiveBoard } from "../modules/live-board/LiveBoardService";
import { logger } from "../shared/logger";
import { CARD_PAGE_SIZE, loadLeaderboardCardData } from "./cardData";
import { renderLeaderboardCard } from "./cards/leaderboardCard";
import { relativeTime } from "./format";
import { discordErrorCode } from "./memberDirectory";

/*
 * Bảng vàng (DEC-030): một message trong channel admin chọn, gồm 2–3 ảnh bảng xếp hạng, bot tự sửa khi dữ liệu đổi.
 * Mọi thao tác trên message của một guild (đăng, sửa, xoá) chạy tuần tự qua khoá theo guild, để lệnh của admin và lượt
 * định kỳ không đăng đôi. Trạng thái (chữ ký dữ liệu lần đăng trước, khoá, lần cảnh báo gần nhất) chỉ nằm trong RAM.
 */

const INITIAL_DELAY_MS = 15_000;
const WARN_INTERVAL_MS = 60 * 60 * 1000;

interface BoardSection
{
	kind: ScoreKind;
	scope: LeaderboardScope;
	period: LeaderboardPeriod;
	/** Tên file đính kèm; các ảnh trong cùng message phải khác tên. */
	fileName: string;
}

/** Activity cá nhân tuần này, Contribution cá nhân tháng này, và Activity team tuần này (chỉ khi guild có team). */
const SECTIONS: readonly BoardSection[] = [
	{ kind: "activity", scope: "individual", period: "week", fileName: "bang-vang-activity-tuan.png" },
	{ kind: "contribution", scope: "individual", period: "month", fileName: "bang-vang-contribution-thang.png" },
	{ kind: "activity", scope: "team", period: "week", fileName: "bang-vang-team-tuan.png" },
];

interface LiveBoardState
{
	/** Chữ ký dữ liệu của lần đăng/sửa thành công gần nhất, theo guild. */
	signatures: Map<string, string>;
	/** Thao tác đang chạy (hoặc đang chờ) của từng guild. */
	locks: Map<string, Promise<boolean>>;
	/** Lần cuối cảnh báo "không đăng được" của từng guild, để log không lặp lại mỗi lượt. */
	warnedAt: Map<string, number>;
}

const states = new WeakMap<DiscordClient, LiveBoardState>();

function stateOf(client: DiscordClient): LiveBoardState
{
	let state = states.get(client);
	if (!state)
	{
		state = { signatures: new Map(), locks: new Map(), warnedAt: new Map() };
		states.set(client, state);
	}
	return state;
}

/** Chạy `task` sau khi mọi thao tác trước đó của cùng guild đã xong. `task` không được throw. */
async function runExclusive(state: LiveBoardState, guildId: string, task: () => Promise<boolean>): Promise<boolean>
{
	const previous = state.locks.get(guildId);
	const current = (async (): Promise<boolean> =>
	{
		if (previous) await previous.catch(() => false);
		return task();
	})();
	state.locks.set(guildId, current);
	try
	{
		return await current;
	}
	finally
	{
		if (state.locks.get(guildId) === current) state.locks.delete(guildId);
	}
}

function warnThrottled(client: DiscordClient, guildId: string, message: string): void
{
	const { warnedAt } = stateOf(client);
	const now = client.services.clock.now();
	const last = warnedAt.get(guildId);
	if (last !== undefined && now - last < WARN_INTERVAL_MS) return;
	warnedAt.set(guildId, now);
	logger.warn(message);
}

async function fetchChannel(client: DiscordClient, channelId: string): Promise<Channel | null>
{
	try
	{
		return await client.channels.fetch(channelId);
	}
	catch (error)
	{
		logger.debug(`Không lấy được channel "${channelId}" của Bảng vàng:`, error);
		return null;
	}
}

/** Nội dung chữ của message Bảng vàng. */
export function liveBoardContent(now: number): string
{
	return [
		`🏆 **BẢNG VÀNG** · cập nhật lần cuối ${relativeTime(now)}`,
		"Dùng `/rank` xem thẻ tu luyện, `/leaderboard` xem đầy đủ.",
	].join("\n");
}

/** Chữ ký những gì hiện trên ảnh (kỳ, tổng số dòng, hạng/điểm từng dòng); không đổi thì không cần sửa message. */
function signatureOf(channelId: string, pages: readonly LeaderboardPage[]): string
{
	return JSON.stringify({
		channelId,
		boards: pages.map(page => ({
			since: page.since,
			total: page.totalEntries,
			entries: page.entries.map(entry => [entry.id, entry.rank, entry.value]),
		})),
	});
}

interface BoardPayload
{
	content: string;
	files: AttachmentBuilder[];
}

/** Đăng hoặc sửa message. Message cũ không còn (10008) thì đăng lại một lần. Trả về true nếu đã đăng hoặc sửa được. */
async function upsertMessage(client: DiscordClient, board: LiveBoard, channel: Channel, payload: BoardPayload): Promise<boolean>
{
	if (!channel.isSendable()) return false;
	const { liveBoards } = client.services;

	if (board.messageId !== null)
	{
		try
		{
			await channel.messages.edit(board.messageId, { content: payload.content, files: payload.files, attachments: [] });
			return true;
		}
		catch (error)
		{
			if (discordErrorCode(error) !== RESTJSONErrorCodes.UnknownMessage) throw error;
			logger.info(`Message Bảng vàng của guild ${board.guildId} không còn; đăng lại.`);
			if (!liveBoards.setMessage(board.guildId, board.channelId, null)) return false;
		}
	}

	const message = await channel.send({ content: payload.content, files: payload.files });
	if (liveBoards.setMessage(board.guildId, board.channelId, message.id)) return true;

	// Admin vừa chuyển kênh hoặc tắt Bảng vàng trong lúc đăng: gỡ message vừa đăng ở kênh cũ.
	await message.delete().catch((error: unknown) => logger.warn("Không gỡ được message Bảng vàng vừa đăng ở kênh cũ:", error));
	return false;
}

async function publish(client: DiscordClient, guildId: string, force: boolean): Promise<boolean>
{
	const { liveBoards, leaderboard, teams, clock } = client.services;
	const state = stateOf(client);
	const board = liveBoards.get(guildId);
	if (!board)
	{
		state.signatures.delete(guildId);
		return false;
	}

	const sections = SECTIONS.filter(section => section.scope !== "team" || teams.list(guildId).length > 0);
	const pages = sections.map(section => leaderboard.query({
		guildId,
		kind: section.kind,
		scope: section.scope,
		period: section.period,
		page: 1,
		pageSize: CARD_PAGE_SIZE,
	}));
	const signature = signatureOf(board.channelId, pages);
	if (!force && board.messageId !== null && state.signatures.get(guildId) === signature) return false;

	const channel = await fetchChannel(client, board.channelId);
	if (!channel || channel.isDMBased() || channel.guildId !== guildId || !channel.isTextBased())
	{
		warnThrottled(client, guildId, `Bảng vàng của guild ${guildId}: channel "${board.channelId}" không còn hoặc không phải kênh văn bản của server.`);
		return false;
	}
	const me = client.user;
	const permissions = me ? channel.permissionsFor(me) : null;
	const send = channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
	if (!permissions?.has([PermissionFlagsBits.ViewChannel, send, PermissionFlagsBits.AttachFiles]))
	{
		warnThrottled(client, guildId, `Bảng vàng của guild ${guildId}: bot thiếu quyền View Channel, Send Messages hoặc Attach Files ở channel "${board.channelId}".`);
		return false;
	}

	const guild = client.guilds.cache.get(guildId) ?? null;
	const cards = await Promise.all(sections.map(async (section, index) =>
	{
		const data = await loadLeaderboardCardData(client, guild, guildId, { kind: section.kind, scope: section.scope, page: pages[index] }, null);
		return renderLeaderboardCard(data);
	}));
	const files = cards.map((card, index) => new AttachmentBuilder(card.png, { name: sections[index].fileName }));

	const posted = await upsertMessage(client, board, channel, { content: liveBoardContent(clock.now()), files });
	if (posted)
	{
		state.signatures.set(guildId, signature);
		state.warnedAt.delete(guildId);
	}
	return posted;
}

/**
 * Đăng (nếu chưa có message) hoặc sửa message Bảng vàng của một guild theo dữ liệu hiện tại (DEC-030).
 * `force`: bỏ qua kiểm tra "dữ liệu không đổi so với lần cập nhật trước" (dùng ngay sau khi admin đặt kênh).
 * Không ném lỗi (chỉ ghi log). Trả về true nếu đã đăng hoặc sửa được message; false nếu guild chưa bật Bảng vàng,
 * dữ liệu không đổi, hoặc gặp lỗi.
 */
export function refreshLiveBoard(client: DiscordClient, guildId: string, options: { force?: boolean } = {}): Promise<boolean>
{
	if (!client.guildIds.includes(guildId)) return Promise.resolve(false);
	return runExclusive(stateOf(client), guildId, async () =>
	{
		try
		{
			return await publish(client, guildId, options.force ?? false);
		}
		catch (error)
		{
			logger.warn(`Không cập nhật được Bảng vàng của guild ${guildId}:`, error);
			return false;
		}
	});
}

async function removeMessage(client: DiscordClient, board: LiveBoard): Promise<boolean>
{
	if (board.messageId === null) return false;
	try
	{
		const channel = await client.channels.fetch(board.channelId);
		if (!channel || channel.isDMBased() || channel.guildId !== board.guildId || !channel.isTextBased()) return false;
		await channel.messages.delete(board.messageId);
		return true;
	}
	catch (error)
	{
		const code = discordErrorCode(error);
		if (code === RESTJSONErrorCodes.UnknownMessage || code === RESTJSONErrorCodes.UnknownChannel)
		{
			logger.debug(`Message Bảng vàng cũ của guild ${board.guildId} không còn.`);
			return false;
		}
		logger.warn(`Không xoá được message Bảng vàng cũ của guild ${board.guildId}:`, error);
		return false;
	}
}

/** Xoá message của một Bảng vàng cũ (sau khi admin đổi kênh hoặc tắt). Không ném lỗi. Trả về true nếu đã xoá. */
export function deleteLiveBoardMessage(client: DiscordClient, board: LiveBoard): Promise<boolean>
{
	return runExclusive(stateOf(client), board.guildId, () => removeMessage(client, board));
}

/** Một lượt: cập nhật tuần tự Bảng vàng của các guild đang phục vụ. Trả về số message đã đăng hoặc sửa. */
export async function runLiveBoardSweep(client: DiscordClient): Promise<number>
{
	let boards: LiveBoard[];
	try
	{
		boards = client.services.liveBoards.listAll();
	}
	catch (error)
	{
		logger.error("Không đọc được danh sách Bảng vàng:", error);
		return 0;
	}

	let updated = 0;
	for (const board of boards)
	{
		if (!client.guildIds.includes(board.guildId)) continue;
		if (await refreshLiveBoard(client, board.guildId)) updated++;
	}
	return updated;
}

/**
 * Định kỳ cập nhật Bảng vàng của mọi guild đang phục vụ. Không chạy chồng lượt; timer không giữ process sống.
 * Lượt đầu chạy sau `initialDelayMs` (mặc định 15 giây). Trả về hàm dừng lịch.
 */
export function startLiveBoardScheduler(client: DiscordClient, intervalMs = 10 * 60_000, initialDelayMs = INITIAL_DELAY_MS): () => void
{
	let running = false;
	const sweep = (): void =>
	{
		if (running) return;
		running = true;
		runLiveBoardSweep(client)
			.finally(() =>
			{
				running = false;
			})
			.catch((error: unknown) => logger.error("Lỗi trong lịch cập nhật Bảng vàng:", error));
	};

	const first = setTimeout(sweep, initialDelayMs);
	first.unref();
	const timer = setInterval(sweep, intervalMs);
	timer.unref();

	return () =>
	{
		clearTimeout(first);
		clearInterval(timer);
	};
}
