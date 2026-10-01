// Thao tác retro dùng chung cho lệnh `/retro`, lịch quét và trang web quản trị (DEC-041, DEC-049): tạo phiên, đóng, mở lại, gia hạn,
// tạo vote tên sprint, chốt/chọn tên, nhắc, ghi Confluence. Quy tắc nằm ở RetroService; ở đây chỉ nối thêm tác dụng phụ lên Discord
// (đăng/sửa tin của phiên, đăng bảng tổng hợp, thông báo) và Confluence qua RetroActions, để web và test thay được. Thông báo trả về dùng
// markdown/mention kiểu Discord (web chuyển sang HTML bằng discordText). Lỗi hiển thị cho người dùng là UserError.
import { ChannelType, GuildBasedChannel, GuildMember, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import type { Guild, MessageCreateOptions } from "discord.js";
import type DiscordClient from "../classes/DiscordClient";
import { ConfluenceError, RetroDocSection, RetroDocWriter } from "../integrations/confluence";
import { Poll } from "../modules/poll/types";
import { CreateRetroInput, RetroSession, RetroVoteOutcome } from "../modules/retro/types";
import type { AppServices } from "../services";
import { UserError } from "../shared/errors";
import { logger } from "../shared/logger";
import { botMemberOf } from "./configOps";
import { channelMention, formatNumber, relativeTime } from "./format";
import { editPostedMessage } from "./messages";
import { pollMessage } from "./views/poll";
import {
	NO_MENTIONS,
	RetroComponentsPayload,
	retroReminderText,
	retroSessionMessage,
	retroSummaryMessage,
	retroTieText,
	retroWinnerText,
} from "./views/retro";

/** Vị trí một tin bot vừa đăng. */
export interface PostedRef
{
	channelId: string;
	messageId: string;
}

/**
 * Tác dụng phụ lên Discord và Confluence của thao tác retro. Bot dùng createRetroActions (DiscordClient.retroActions); web nhận qua
 * `WebDeps.retroActions`; test thay bằng bản giả.
 */
export interface RetroActions
{
	/** Nơi ghi bảng retro lên Confluence; null = chưa cấu hình CONFLUENCE_* (bỏ bước ghi, retro vẫn chạy). */
	readonly docWriter: RetroDocWriter | null;
	/** Sửa tin của phiên theo trạng thái hiện tại (nút, số người, trạng thái). Không ném lỗi; false nếu không sửa được. */
	refreshSessionMessage(client: DiscordClient, session: RetroSession): Promise<boolean>;
	/** Đăng một tin vào kênh/thread `channelId`. Không ném lỗi; null nếu không đăng được (đã ghi log). */
	post(client: DiscordClient, channelId: string, payload: MessageCreateOptions): Promise<PostedRef | null>;
}

/** Đăng tin bằng bot (cần View Channel và Send Messages / Send Messages in Threads ở kênh đó). */
async function postToChannel(client: DiscordClient, channelId: string, payload: MessageCreateOptions): Promise<PostedRef | null>
{
	try
	{
		const channel = await client.channels.fetch(channelId);
		if (!channel?.isSendable())
		{
			logger.warn(`Không đăng được tin retro: kênh "${channelId}" không còn hoặc bot không gửi tin được.`);
			return null;
		}
		const message = await channel.send(payload);
		return { channelId: message.channelId, messageId: message.id };
	}
	catch (error)
	{
		logger.warn(`Không đăng được tin retro vào kênh "${channelId}":`, error);
		return null;
	}
}

export function createRetroActions(docWriter: RetroDocWriter | null): RetroActions
{
	return {
		docWriter,
		refreshSessionMessage: (client, session) => editPostedMessage(client, session, () => retroSessionMessage(session), `phiên retro #${session.id}`),
		post: postToChannel,
	};
}

/** Những gì một thao tác retro cần: client (Discord), service, tác dụng phụ. */
export interface RetroContext
{
	client: DiscordClient;
	services: AppServices;
	actions: RetroActions;
}

/** Context retro của bot (dùng actions gắn trên client). */
export function retroContext(client: DiscordClient): RetroContext
{
	return { client, services: client.services, actions: client.retroActions };
}

/** ID của bot, ghi làm người thao tác của event XP retro (DEC-049). Lỗi hệ thống nếu bot chưa đăng nhập. */
export function botActorId(client: DiscordClient): string
{
	const id = client.user?.id ?? client.application?.id ?? null;
	if (id === null) throw new Error("Bot chưa đăng nhập Discord nên chưa có ID để ghi XP retro.");
	return id;
}

export const SESSION_MESSAGE_NOT_UPDATED = "⚠️ Không sửa được tin của phiên (có thể tin đã bị xoá hoặc bot mất quyền).";
export const SUMMARY_NOT_POSTED = "⚠️ Bot không đăng được bảng tổng hợp vào kênh của phiên (thiếu quyền xem hoặc gửi tin?).";
export const ANNOUNCEMENT_NOT_POSTED = "⚠️ Bot không đăng được thông báo vào kênh của phiên (thiếu quyền xem hoặc gửi tin?).";
export const VOTE_NOT_POSTED = "Bot không đăng được tin vote vào kênh của phiên (thiếu quyền xem hoặc gửi tin?), nên đã huỷ vote vừa tạo. "
	+ "Hãy cấp quyền cho bot ở kênh đó rồi thử lại.";
export const SESSION_NOT_POSTED = "Bot không đăng được tin của phiên (có nút 📝 Điền retro) vào kênh đã chọn (thiếu quyền xem hoặc gửi tin?), "
	+ "nên đã đóng phiên vừa tạo. Hãy cấp quyền cho bot ở kênh đó rồi tạo lại.";
export const DOC_WRITER_OFF_NOTE = "ℹ️ Đã lưu link tài liệu. Bot chưa bật ghi Confluence (CONFLUENCE_BASE_URL, CONFLUENCE_TOKEN) nên sẽ không ghi bảng vào trang.";
export const RETRO_CHANNEL_INVALID = "Phiên retro chỉ tạo được ở kênh văn bản, kênh thông báo hoặc thread đang hoạt động của server.";
/** Khoảng tối thiểu giữa hai lần nhắc của cùng một phiên (chống ping role team liên tục). */
export const REMIND_COOLDOWN_MS = 10 * 60 * 1000;

/** Kết quả một lần ghi Confluence. */
export type RetroDocReport =
	| { status: "written" }
	| { status: "skipped"; reason: string }
	| { status: "failed"; error: string };

/** Một dòng mô tả kết quả ghi Confluence cho người quản lý. */
export function retroDocReportLine(report: RetroDocReport): string
{
	switch (report.status)
	{
	case "written": return "📄 Đã ghi bảng retro vào Confluence.";
	case "skipped": return `📄 Không ghi Confluence: ${report.reason}`;
	case "failed": return `❌ Ghi Confluence lỗi: ${report.error}`;
	}
}

/**
 * Dữ liệu khu vực retro của phiên trên Confluence: các phiếu ẩn danh (không có người viết, không có mã phiếu) theo thứ tự trộn cố
 * định, tên sprint đã chốt. Dùng chung cho lần ghi Confluence và phần "xuất chữ để dán" của trang web, để hai nơi luôn cùng nội dung.
 */
export function retroDocSection(services: Pick<AppServices, "retro">, session: RetroSession): RetroDocSection
{
	const entries = services.retro.anonymousEntries(session.guildId, session.id)
		.map(({ learned, improve, ideas, kudos, sprintName }) => ({ learned, improve, ideas, kudos, sprintName }));
	return { guildId: session.guildId, sessionId: session.id, title: session.title, entries, winnerName: session.winnerName };
}

/**
 * Ghi (hoặc ghi lại) khu vực retro của phiên lên trang Confluence đã gắn, rồi lưu kết quả vào phiên (lỗi hiện trên web để thử lại).
 * Bỏ qua (không ghi, không đổi trạng thái) khi phiên không có link, chưa cấu hình Confluence, hoặc nội dung đã bị xoá. Không ném
 * lỗi Confluence: lỗi được trả về trong báo cáo.
 */
export async function writeRetroDoc(ctx: RetroContext, guildId: string, sessionId: number): Promise<RetroDocReport>
{
	const { services, actions } = ctx;
	const session = services.retro.get(guildId, sessionId);
	if (!session) throw new UserError("Không tìm thấy phiên retro này.");
	if (session.docUrl === null) return { status: "skipped", reason: "phiên chưa gắn link tài liệu." };
	if (actions.docWriter === null) return { status: "skipped", reason: "bot chưa bật ghi Confluence (CONFLUENCE_BASE_URL, CONFLUENCE_TOKEN)." };
	if (session.contentDeletedAt !== null) return { status: "skipped", reason: "nội dung phiên đã bị xoá." };

	try
	{
		await actions.docWriter.writeRetroSection(session.docUrl, retroDocSection(services, session));
	}
	catch (error)
	{
		const message = error instanceof ConfluenceError ? error.message : "Lỗi không xác định khi ghi Confluence (xem log của bot).";
		if (!(error instanceof ConfluenceError)) logger.error(`Lỗi khi ghi Confluence cho phiên retro #${sessionId}:`, error);
		else logger.warn(`Ghi Confluence cho phiên retro #${sessionId} lỗi: ${message}`);
		services.retro.recordDocResult(guildId, sessionId, { ok: false, error: message });
		return { status: "failed", error: message };
	}
	services.retro.recordDocResult(guildId, sessionId, { ok: true });
	return { status: "written" };
}

/** Sau khi phiên vừa đóng (người quản lý hoặc hết hạn): tắt nút, đăng bảng tổng hợp ẩn danh, ghi Confluence. Trả về các dòng ghi chú. */
export async function publishRetroClosed(ctx: RetroContext, session: RetroSession): Promise<string[]>
{
	const { client, services, actions } = ctx;
	const notes: string[] = [];
	if (!(await actions.refreshSessionMessage(client, session)) && session.messageId !== null) notes.push(SESSION_MESSAGE_NOT_UPDATED);
	const summary = retroSummaryMessage(session, services.retro.columns(session.guildId, session.id));
	if ((await actions.post(client, session.channelId, summary)) === null) notes.push(SUMMARY_NOT_POSTED);
	const report = await writeRetroDoc(ctx, session.guildId, session.id);
	if (!(report.status === "skipped" && session.docUrl === null)) notes.push(retroDocReportLine(report));
	return notes;
}

function withNotes(text: string, notes: readonly string[]): string
{
	return [text, ...notes].join("\n");
}

/** Loại kênh (không phải thread) tạo phiên retro được: kênh văn bản và kênh thông báo. */
const RETRO_TEXT_CHANNEL_TYPES: readonly ChannelType[] = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

/** Kênh tạo phiên retro được (DEC-049: kênh hoặc thread của team): kênh văn bản, kênh thông báo, hoặc thread chưa lưu trữ. */
export function isRetroChannel(channel: GuildBasedChannel): boolean
{
	if (channel.isThread()) return channel.archived !== true;
	return RETRO_TEXT_CHANNEL_TYPES.includes(channel.type);
}

/** Phần của kênh cần để tính quyền gửi tin (kênh trong cache của server). */
interface PostChannel
{
	isThread(): boolean;
	permissionsFor(member: GuildMember): Readonly<PermissionsBitField> | null;
}

/** `member` xem và gửi được tin ở kênh không (quyền theo kênh; trong thread là Send Messages in Threads). */
export function canPostInChannel(channel: PostChannel, member: GuildMember): boolean
{
	const send = channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
	return channel.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, send]) ?? false;
}

/**
 * Kênh để tạo phiên retro từ web, cùng điều kiện với `/retro create` gõ ngay trong kênh đó: kênh văn bản, kênh thông báo hoặc thread
 * đang hoạt động có trong server; người tạo phải tự xem và gửi được tin ở đó (tin của phiên được đăng thay người tạo, LL-013); bot phải
 * xem và gửi được tin. UserError nếu không đạt.
 */
export function resolveRetroChannel(guild: Guild, channelId: string, caller: GuildMember): GuildBasedChannel
{
	const channel = guild.channels.cache.get(channelId);
	if (!channel || !isRetroChannel(channel)) throw new UserError(RETRO_CHANNEL_INVALID);
	if (!canPostInChannel(channel, caller))
	{
		throw new UserError(`Bạn không có quyền xem hoặc gửi tin nhắn ở ${channelMention(channel.id)}, nên không thể tạo phiên retro ở đó.`);
	}
	if (!canPostInChannel(channel, botMemberOf(guild)))
	{
		throw new UserError(`Bot thiếu quyền **View Channel** hoặc **Send Messages** (với thread: **Send Messages in Threads**) ở ${channelMention(channel.id)}. `
			+ "Hãy cấp quyền cho bot ở kênh đó rồi thử lại.");
	}
	return channel;
}

/**
 * Đăng tin của phiên vừa tạo: trả về ID tin (null nếu đã đăng mà không biết ID), ném lỗi nếu không đăng được. Lệnh trả lời chính
 * interaction; web nhờ bot gửi tin vào kênh (RetroActions.post).
 */
export type RetroSessionPublisher = (payload: RetroComponentsPayload) => Promise<string | null>;

/**
 * Tạo phiên retro (RetroService.create kiểm tra tiêu đề, link, team, hạn và "một kênh một phiên mở") rồi đăng tin có nút
 * "📝 Điền retro" vào kênh/thread của phiên bằng `publish` và lưu ID tin. Không đăng được thì đóng phiên vừa tạo, để kênh không bị giữ
 * bởi một phiên không ai bấm điền được, rồi ném lại lỗi. Người gọi đã kiểm tra quyền tạo phiên và quyền gửi tin ở kênh. Trả về phiên
 * (đã gắn tin) và các ghi chú cho người tạo.
 */
export async function createRetroSession(ctx: RetroContext, input: CreateRetroInput, publish: RetroSessionPublisher): Promise<{ session: RetroSession; notes: string[] }>
{
	const { services, actions } = ctx;
	const created = services.retro.create(input);
	let messageId: string | null;
	try
	{
		messageId = await publish(retroSessionMessage(created));
	}
	catch (error)
	{
		try
		{
			services.retro.close(created.guildId, created.id, input.createdBy);
		}
		catch (closeError)
		{
			logger.warn(`Không đóng được phiên retro #${created.id} sau khi đăng tin thất bại:`, closeError);
		}
		throw error;
	}
	if (messageId !== null) services.retro.attachMessage(created.guildId, created.id, messageId);
	else logger.warn(`Không lấy được message của phiên retro #${created.id}; tin sẽ không được cập nhật số người và trạng thái.`);
	const notes = created.docUrl !== null && actions.docWriter === null ? [DOC_WRITER_OFF_NOTE] : [];
	return { session: services.retro.get(created.guildId, created.id) ?? created, notes };
}

/** Người quản lý đóng phiên (lệnh hoặc web). */
export async function closeRetroSession(ctx: RetroContext, guildId: string, sessionId: number, actorId: string): Promise<string>
{
	const session = ctx.services.retro.close(guildId, sessionId, actorId);
	const notes = await publishRetroClosed(ctx, session);
	return withNotes(`Đã đóng phiên retro #${session.id} (${formatNumber(session.participants)} người đã điền) và đăng bảng tổng hợp ẩn danh.`, notes);
}

async function refreshNote(ctx: RetroContext, session: RetroSession): Promise<string[]>
{
	const refreshed = await ctx.actions.refreshSessionMessage(ctx.client, session);
	return !refreshed && session.messageId !== null ? [SESSION_MESSAGE_NOT_UPDATED] : [];
}

function deadlineText(session: RetroSession): string
{
	return session.closesAt === null ? "không tự đóng" : `tự đóng ${relativeTime(session.closesAt)}`;
}

/** Mở lại phiên đã đóng. */
export async function reopenRetroSession(ctx: RetroContext, guildId: string, sessionId: number, actorId: string, durationHours: number | null): Promise<string>
{
	const session = ctx.services.retro.reopen(guildId, sessionId, actorId, durationHours);
	return withNotes(`Đã mở lại phiên retro #${session.id} (${deadlineText(session)}).`, await refreshNote(ctx, session));
}

/** Đặt hạn mới cho phiên đang mở. */
export async function extendRetroSession(ctx: RetroContext, guildId: string, sessionId: number, actorId: string, durationHours: number): Promise<string>
{
	const session = ctx.services.retro.extend(guildId, sessionId, actorId, durationHours);
	return withNotes(`Đã gia hạn phiên retro #${session.id}: ${deadlineText(session)}.`, await refreshNote(ctx, session));
}

/**
 * Tạo vote tên sprint (RetroService.startVote) rồi đăng tin vote vào kênh của phiên. Không đăng được thì huỷ vote vừa tạo và báo
 * lỗi, để không có vote mà không ai bấm được.
 */
export async function startRetroVote(ctx: RetroContext, guildId: string, sessionId: number, actorId: string, names?: readonly string[]): Promise<string>
{
	const { client, services, actions } = ctx;
	const { session, poll } = services.retro.startVote({ guildId, sessionId, actorId, names });
	const posted = await actions.post(client, session.channelId, { ...pollMessage(poll), allowedMentions: NO_MENTIONS });
	if (posted === null)
	{
		const reverted = services.retro.cancelVote(guildId, sessionId, actorId);
		await actions.refreshSessionMessage(client, reverted);
		throw new UserError(VOTE_NOT_POSTED);
	}
	services.polls.attachMessage(guildId, poll.id, posted.channelId, posted.messageId);
	const notes = await refreshNote(ctx, session);
	const closes = poll.closesAt === null ? "" : `, tự đóng ${relativeTime(poll.closesAt)}`;
	return withNotes(`Đã tạo vote tên sprint #${poll.id} với ${formatNumber(poll.options.length)} tên${closes}. Vote xong bot tự chốt tên và cộng XP cho người đề xuất.`, notes);
}

/** Đăng kết quả chốt vote (thắng hoặc hoà) lên Discord và ghi Confluence khi đã có tên. Trả về các dòng ghi chú. */
export async function publishRetroOutcome(ctx: RetroContext, outcome: RetroVoteOutcome): Promise<string[]>
{
	if (outcome.kind === "unchanged") return [];
	const { client, actions } = ctx;
	const { session } = outcome;
	const notes = await refreshNote(ctx, session);
	const text = outcome.kind === "winner"
		? retroWinnerText(session, outcome.name, outcome.proposerIds.length, outcome.xpEach)
		: retroTieText(session, outcome.names);
	if ((await actions.post(client, session.channelId, { content: text, allowedMentions: NO_MENTIONS })) === null) notes.push(ANNOUNCEMENT_NOT_POSTED);
	if (outcome.kind === "winner")
	{
		const report = await writeRetroDoc(ctx, session.guildId, session.id);
		if (!(report.status === "skipped" && session.docUrl === null)) notes.push(retroDocReportLine(report));
	}
	return notes;
}

/** Chốt vote tên sprint của phiên nếu vote đã đóng (gọi lại an toàn), rồi đăng kết quả. */
export async function settleRetroVote(ctx: RetroContext, guildId: string, sessionId: number): Promise<{ outcome: RetroVoteOutcome; notes: string[] }>
{
	const outcome = ctx.services.retro.finalizeVote(guildId, sessionId, botActorId(ctx.client));
	const notes = await publishRetroOutcome(ctx, outcome);
	return { outcome, notes };
}

/**
 * Gọi sau khi một vote bị đóng (tay, web hay hết hạn): nếu là vote tên sprint của một phiên retro thì chốt tên (hoặc báo hoà).
 * Không ném lỗi: lỗi chỉ ghi log, lịch quét retro sẽ thử lại.
 */
export async function settleRetroPoll(client: DiscordClient, poll: Poll): Promise<void>
{
	try
	{
		const session = client.services.retro.findByPoll(poll.guildId, poll.id);
		if (!session) return;
		const { notes } = await settleRetroVote(retroContext(client), session.guildId, session.id);
		for (const note of notes) logger.warn(`Phiên retro #${session.id}: ${note}`);
	}
	catch (error)
	{
		logger.error(`Không chốt được vote tên sprint #${poll.id}:`, error);
	}
}

/** Người quản lý chọn tên (vote hoà, hoặc phiên chỉ có một tên đề xuất). */
export async function pickRetroName(ctx: RetroContext, guildId: string, sessionId: number, name: string, actorId: string): Promise<string>
{
	const outcome = ctx.services.retro.pickName({ guildId, sessionId, name, actorId, systemActorId: botActorId(ctx.client) });
	const notes = await publishRetroOutcome(ctx, outcome);
	const chosen = outcome.kind === "winner" ? outcome.name : name;
	return withNotes(`Đã chốt tên sprint "${chosen}" cho phiên retro #${sessionId}.`, notes);
}

/** Lần nhắc gần nhất của từng phiên (theo guild và mã phiên), trong bộ nhớ. */
const lastReminders = new Map<string, number>();

/**
 * Nhắc điền retro trong kênh của phiên: có role team thì ping đúng role đó (allowedMentions chỉ role này), không thì nhắc không ping.
 * Mỗi phiên nhắc tối đa một lần trong REMIND_COOLDOWN_MS.
 */
export async function remindRetro(ctx: RetroContext, guildId: string, sessionId: number): Promise<string>
{
	const { client, services, actions } = ctx;
	const session = services.retro.get(guildId, sessionId);
	if (!session) throw new UserError("Không tìm thấy phiên retro này.");
	if (!session.acceptingAnswers) throw new UserError("Phiên retro này không còn nhận câu trả lời nên không cần nhắc.");
	const key = `${guildId}:${sessionId}`;
	const now = services.clock.now();
	const last = lastReminders.get(key);
	if (last !== undefined && now - last < REMIND_COOLDOWN_MS)
	{
		throw new UserError(`Phiên này vừa được nhắc. Hãy đợi tới ${relativeTime(last + REMIND_COOLDOWN_MS)} rồi nhắc lại.`);
	}
	lastReminders.set(key, now);

	const allowedMentions = session.teamRoleId === null ? NO_MENTIONS : { parse: [], roles: [session.teamRoleId] };
	const posted = await actions.post(client, session.channelId, { content: retroReminderText(session), allowedMentions });
	if (posted === null)
	{
		lastReminders.delete(key);
		throw new UserError(ANNOUNCEMENT_NOT_POSTED.replace("⚠️ ", ""));
	}
	return session.teamRoleId === null ? "Đã nhắc điền retro trong kênh của phiên (không ping ai)." : "Đã nhắc team điền retro trong kênh của phiên.";
}
