import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { AttachmentBuilder, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import type DiscordClient from "../src/classes/DiscordClient";
import { deleteLiveBoardMessage, LIVE_BOARD_RECHECK_MS, liveBoardContent, refreshLiveBoard, runLiveBoardSweep, startLiveBoardScheduler } from "../src/discord/liveBoard";
import { RenderGate } from "../src/discord/renderGate";
import { AppServices, createServices } from "../src/services";
import { ADMIN, CHANNEL_BOT, CHANNEL_GENERAL, createTestContext, GUILD, OTHER_GUILD, ROLE_BACKEND, TestContext, USER_A, USER_B } from "./helpers";

const BOT_ID = "900000000000000001";
const OTHER_CHANNEL = "400000000000000077";
// Thứ Tư 30/09/2026 10:00 giờ Việt Nam.
const NOW = Date.UTC(2026, 8, 30, 3, 0);
const BOT_CAN_POST = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles];

function discordError(code: number): Error
{
	return Object.assign(new Error(`Discord API error ${code}`), { code });
}

interface Payload
{
	content: string;
	files: AttachmentBuilder[];
	attachments?: unknown[];
}

interface FakeChannelOptions
{
	guildId?: string;
	/** Quyền của bot ở channel; null = không tính được quyền. */
	permissions?: bigint[] | null;
	textBased?: boolean;
	editError?: Error;
	deleteError?: Error;
	/** Chạy trước khi send trả về (ví dụ giả lập admin đổi kênh trong lúc bot đang đăng). */
	beforeSendResolves?: () => Promise<void> | void;
}

interface FakeChannel
{
	channel: unknown;
	sent: Payload[];
	edits: { messageId: string; payload: Payload }[];
	deleted: string[];
	/** Message bot vừa đăng rồi tự gỡ. */
	retracted: string[];
}

let messageCounter = 0;

function fakeChannel(options: FakeChannelOptions = {}): FakeChannel
{
	const result: FakeChannel = { channel: null, sent: [], edits: [], deleted: [], retracted: [] };
	const permissions = options.permissions === undefined ? BOT_CAN_POST : options.permissions;
	result.channel = {
		guildId: options.guildId ?? GUILD,
		isDMBased: () => false,
		isTextBased: () => options.textBased ?? true,
		isThread: () => false,
		isSendable: () => true,
		permissionsFor: (user: { id: string }) =>
		{
			assert.equal(user.id, BOT_ID, "phải kiểm tra quyền của chính bot");
			return permissions === null ? null : new PermissionsBitField(permissions);
		},
		send: async (payload: Payload) =>
		{
			result.sent.push(payload);
			await options.beforeSendResolves?.();
			const id = `70000000000000${String(++messageCounter).padStart(4, "0")}`;
			return {
				id,
				delete: () =>
				{
					result.retracted.push(id);
					return Promise.resolve();
				},
			};
		},
		messages: {
			edit: (messageId: string, payload: Payload) =>
			{
				if (options.editError) return Promise.reject(options.editError);
				result.edits.push({ messageId, payload });
				return Promise.resolve();
			},
			delete: (messageId: string) =>
			{
				if (options.deleteError) return Promise.reject(options.deleteError);
				result.deleted.push(messageId);
				return Promise.resolve();
			},
		},
	};
	return result;
}

interface Setup extends TestContext
{
	services: AppServices;
	client: DiscordClient;
	gate: RenderGate;
	channelFetches: string[];
}

function setup(channels: Record<string, FakeChannel>, guildIds: string[] = [GUILD]): Setup
{
	const context = createTestContext();
	context.clock.current = NOW;
	const services = createServices(context.db, { clock: context.clock, backupDir: "khong-dung", backupKeep: 1 });
	const channelFetches: string[] = [];
	const gate = new RenderGate();
	const client = {
		renderGate: gate,
		services,
		guildIds,
		user: { id: BOT_ID },
		channels: {
			fetch: (channelId: string) =>
			{
				channelFetches.push(channelId);
				const found = channels[channelId];
				return found ? Promise.resolve(found.channel) : Promise.reject(discordError(10003));
			},
		},
		guilds: { cache: new Map() },
		avatars: { get: () => Promise.resolve(null) },
		members: { resolve: () => Promise.resolve(new Map()) },
	} as unknown as DiscordClient;
	return { ...context, services, client, gate, channelFetches };
}

function seedXp(context: TestContext, userId: string, amount: number): void
{
	context.deps.xpLedger.record({ guildId: GUILD, userId, amount, source: "message", teamRoleIds: [ROLE_BACKEND] });
}

function fileNames(payload: Payload): string[]
{
	return payload.files.map(file => file.name ?? "");
}

describe("Bảng vàng: đăng và sửa message", () =>
{
	test("guild chưa bật Bảng vàng: không làm gì", async () =>
	{
		const s = setup({});
		assert.equal(await refreshLiveBoard(s.client, GUILD, { force: true }), false);
		assert.deepEqual(s.channelFetches, []);
	});

	test("chưa có message: đăng mới với 2 ảnh (chưa có team) và lưu message ID", async () =>
	{
		const general = fakeChannel();
		const s = setup({ [CHANNEL_GENERAL]: general });
		seedXp(s, USER_A, 120);
		s.services.liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);

		assert.equal(await refreshLiveBoard(s.client, GUILD), true);
		assert.equal(general.sent.length, 1);
		const [payload] = general.sent;
		assert.equal(payload.content, liveBoardContent(NOW));
		assert.equal(payload.content, `🏆 **BẢNG VÀNG** · cập nhật lần cuối <t:${NOW / 1000}:R>\nDùng \`/rank\` xem thẻ tu luyện, \`/leaderboard\` xem đầy đủ.`);
		assert.deepEqual(fileNames(payload), ["bang-vang-activity-tuan.png", "bang-vang-contribution-thang.png"]);
		assert.equal(s.services.liveBoards.get(GUILD)?.messageId, `70000000000000${String(messageCounter).padStart(4, "0")}`);
	});

	test("guild có team: thêm ảnh Activity team tuần này", async () =>
	{
		const general = fakeChannel();
		const s = setup({ [CHANNEL_GENERAL]: general });
		s.services.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		s.services.liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);

		assert.equal(await refreshLiveBoard(s.client, GUILD), true);
		assert.deepEqual(fileNames(general.sent[0]), ["bang-vang-activity-tuan.png", "bang-vang-contribution-thang.png", "bang-vang-team-tuan.png"]);
	});

	test("dữ liệu không đổi thì bỏ qua; đổi thì sửa message cũ (thay toàn bộ ảnh); force thì luôn sửa", async () =>
	{
		const general = fakeChannel();
		const s = setup({ [CHANNEL_GENERAL]: general });
		s.services.liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		assert.equal(await refreshLiveBoard(s.client, GUILD), true);
		const messageId = s.services.liveBoards.get(GUILD)?.messageId;
		assert.ok(messageId);

		assert.equal(await refreshLiveBoard(s.client, GUILD), false);
		assert.equal(general.edits.length, 0);

		seedXp(s, USER_B, 40);
		s.clock.advanceSeconds(600);
		assert.equal(await refreshLiveBoard(s.client, GUILD), true);
		assert.equal(general.sent.length, 1, "không đăng message mới");
		assert.equal(general.edits.length, 1);
		assert.equal(general.edits[0].messageId, messageId);
		assert.deepEqual(general.edits[0].payload.attachments, [], "bỏ ảnh cũ, chỉ giữ ảnh mới");
		assert.equal(general.edits[0].payload.content, liveBoardContent(NOW + 600_000));
		assert.equal(general.edits[0].payload.files.length, 2);

		assert.equal(await refreshLiveBoard(s.client, GUILD), false);
		assert.equal(await refreshLiveBoard(s.client, GUILD, { force: true }), true);
		assert.equal(general.edits.length, 2);
	});

	test("dữ liệu không đổi nhưng lần sửa gần nhất đã quá 1 giờ: vẫn sửa; message bị xoá tay (10008) thì đăng lại", async () =>
	{
		const options: FakeChannelOptions = {};
		const general = fakeChannel(options);
		const s = setup({ [CHANNEL_GENERAL]: general });
		s.services.liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		assert.equal(await refreshLiveBoard(s.client, GUILD), true);
		const first = s.services.liveBoards.get(GUILD)?.messageId;
		assert.ok(first);

		s.clock.advance(LIVE_BOARD_RECHECK_MS - 1);
		assert.equal(await refreshLiveBoard(s.client, GUILD), false, "chưa đủ 1 giờ thì bỏ qua");
		assert.equal(general.edits.length, 0);
		s.clock.advance(1);
		assert.equal(await refreshLiveBoard(s.client, GUILD), true, "đủ 1 giờ thì sửa để biết message còn không");
		assert.equal(general.edits.length, 1);
		assert.equal(general.edits[0].messageId, first);
		assert.equal(general.edits[0].payload.content, liveBoardContent(NOW + LIVE_BOARD_RECHECK_MS));
		assert.equal(await refreshLiveBoard(s.client, GUILD), false, "vừa sửa thì lại chờ đủ 1 giờ");

		options.editError = discordError(10008);
		s.clock.advance(LIVE_BOARD_RECHECK_MS);
		assert.equal(await refreshLiveBoard(s.client, GUILD), true);
		assert.equal(general.sent.length, 2, "message bị xoá tay được đăng lại dù dữ liệu không đổi");
		const second = s.services.liveBoards.get(GUILD)?.messageId;
		assert.ok(second && second !== first);
	});

	test("ảnh Bảng vàng được vẽ qua semaphore chung với /rank và /leaderboard", async (t) =>
	{
		const general = fakeChannel();
		const s = setup({ [CHANNEL_GENERAL]: general });
		s.services.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		s.services.liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		const run = t.mock.method(s.gate, "run");

		assert.equal(await refreshLiveBoard(s.client, GUILD), true);
		assert.equal(run.mock.callCount(), 3, "mỗi ảnh một lần qua semaphore");
		assert.equal(s.gate.activeRenders, 0);
		assert.equal(general.sent[0].files.length, 3);
	});

	test("message cũ đã bị xoá (10008): đăng lại một lần và lưu message mới", async () =>
	{
		const general = fakeChannel({ editError: discordError(10008) });
		const s = setup({ [CHANNEL_GENERAL]: general });
		s.services.liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		s.services.liveBoards.setMessage(GUILD, CHANNEL_GENERAL, "700000000000009999");

		assert.equal(await refreshLiveBoard(s.client, GUILD), true);
		assert.equal(general.sent.length, 1);
		const messageId = s.services.liveBoards.get(GUILD)?.messageId;
		assert.ok(messageId && messageId !== "700000000000009999");
	});

	test("lỗi khác khi sửa: không đăng thêm, không throw, trả false", async (t) =>
	{
		const warned = t.mock.method(console, "error", () => undefined);
		const general = fakeChannel({ editError: discordError(50001) });
		const s = setup({ [CHANNEL_GENERAL]: general });
		s.services.liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		s.services.liveBoards.setMessage(GUILD, CHANNEL_GENERAL, "700000000000009999");

		assert.equal(await refreshLiveBoard(s.client, GUILD, { force: true }), false);
		assert.equal(general.sent.length, 0);
		assert.equal(s.services.liveBoards.get(GUILD)?.messageId, "700000000000009999");
		assert.equal(warned.mock.callCount(), 1);
	});

	test("admin đổi kênh trong lúc bot đang đăng: gỡ message vừa đăng ở kênh cũ", async () =>
	{
		let s: Setup | null = null;
		const general = fakeChannel({ beforeSendResolves: () => { s?.services.liveBoards.setChannel(GUILD, CHANNEL_BOT, ADMIN); } });
		s = setup({ [CHANNEL_GENERAL]: general });
		s.services.liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);

		assert.equal(await refreshLiveBoard(s.client, GUILD), false);
		assert.equal(general.sent.length, 1);
		assert.equal(general.retracted.length, 1);
		assert.deepEqual(s.services.liveBoards.get(GUILD), { guildId: GUILD, channelId: CHANNEL_BOT, messageId: null, updatedAt: NOW });
	});

	test("thiếu quyền hoặc channel không hợp lệ: không đăng, cảnh báo tối đa mỗi giờ một lần", async (t) =>
	{
		const warned = t.mock.method(console, "error", () => undefined);
		const cases: [string, FakeChannelOptions][] = [
			["thiếu Attach Files", { permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }],
			["thiếu Send Messages", { permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.AttachFiles] }],
			["không tính được quyền", { permissions: null }],
			["channel của server khác", { guildId: OTHER_GUILD }],
			["không phải kênh văn bản", { textBased: false }],
		];
		for (const [label, options] of cases)
		{
			warned.mock.resetCalls();
			const channel = fakeChannel(options);
			const s = setup({ [CHANNEL_GENERAL]: channel });
			s.services.liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);

			assert.equal(await refreshLiveBoard(s.client, GUILD), false, label);
			assert.equal(await refreshLiveBoard(s.client, GUILD, { force: true }), false, label);
			assert.equal(channel.sent.length, 0, label);
			assert.equal(warned.mock.callCount(), 1, `${label}: cảnh báo một lần`);
			assert.match(String(warned.mock.calls[0].arguments[0]), /\[WARN\].*Bảng vàng/);

			s.clock.advance(60 * 60 * 1000);
			await refreshLiveBoard(s.client, GUILD);
			assert.equal(warned.mock.callCount(), 2, `${label}: sau một giờ thì cảnh báo lại`);
		}
	});

	test("channel không còn: không đăng, không throw", async (t) =>
	{
		t.mock.method(console, "error", () => undefined);
		const s = setup({});
		s.services.liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		assert.equal(await refreshLiveBoard(s.client, GUILD, { force: true }), false);
	});

	test("khoá theo guild: lệnh force và lượt định kỳ chạy cùng lúc không đăng đôi", async () =>
	{
		const general = fakeChannel({ beforeSendResolves: () => new Promise(resolve => setTimeout(resolve, 20)) });
		const s = setup({ [CHANNEL_GENERAL]: general });
		s.services.liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);

		const results = await Promise.all([
			refreshLiveBoard(s.client, GUILD),
			refreshLiveBoard(s.client, GUILD, { force: true }),
			refreshLiveBoard(s.client, GUILD),
		]);
		assert.deepEqual(results, [true, true, false]);
		assert.equal(general.sent.length, 1);
		assert.equal(general.edits.length, 1, "lần force sau khi đã đăng thì sửa message vừa đăng");
	});

	test("guild ngoài DISCORD_GUILD_IDS: không làm gì", async () =>
	{
		const general = fakeChannel();
		const s = setup({ [CHANNEL_GENERAL]: general });
		s.services.liveBoards.setChannel(OTHER_GUILD, CHANNEL_GENERAL, ADMIN);
		assert.equal(await refreshLiveBoard(s.client, OTHER_GUILD, { force: true }), false);
		assert.deepEqual(s.channelFetches, []);
	});
});

describe("Bảng vàng: xoá message cũ", () =>
{
	test("xoá message của bot ở kênh cũ", async () =>
	{
		const general = fakeChannel();
		const s = setup({ [CHANNEL_GENERAL]: general });
		const board = { guildId: GUILD, channelId: CHANNEL_GENERAL, messageId: "700000000000000123", updatedAt: NOW };
		assert.equal(await deleteLiveBoardMessage(s.client, board), true);
		assert.deepEqual(general.deleted, ["700000000000000123"]);
	});

	test("chưa có message: không gọi Discord", async () =>
	{
		const s = setup({});
		assert.equal(await deleteLiveBoardMessage(s.client, { guildId: GUILD, channelId: CHANNEL_GENERAL, messageId: null, updatedAt: NOW }), false);
		assert.deepEqual(s.channelFetches, []);
	});

	test("message hoặc channel không còn (10008, 10003): bỏ qua, không cảnh báo", async (t) =>
	{
		const warned = t.mock.method(console, "error", () => undefined);
		const gone = fakeChannel({ deleteError: discordError(10008) });
		const s = setup({ [CHANNEL_GENERAL]: gone });
		assert.equal(await deleteLiveBoardMessage(s.client, { guildId: GUILD, channelId: CHANNEL_GENERAL, messageId: "700000000000000123", updatedAt: NOW }), false);
		assert.equal(await deleteLiveBoardMessage(s.client, { guildId: GUILD, channelId: OTHER_CHANNEL, messageId: "700000000000000123", updatedAt: NOW }), false);
		assert.equal(warned.mock.callCount(), 0);
	});

	test("lỗi khác (ví dụ thiếu quyền): chỉ cảnh báo, không throw", async (t) =>
	{
		const warned = t.mock.method(console, "error", () => undefined);
		const general = fakeChannel({ deleteError: discordError(50013) });
		const s = setup({ [CHANNEL_GENERAL]: general });
		assert.equal(await deleteLiveBoardMessage(s.client, { guildId: GUILD, channelId: CHANNEL_GENERAL, messageId: "700000000000000123", updatedAt: NOW }), false);
		assert.equal(warned.mock.callCount(), 1);
	});
});

describe("Bảng vàng: lịch cập nhật", () =>
{
	test("một lượt chỉ cập nhật guild đang phục vụ", async () =>
	{
		const general = fakeChannel();
		const other = fakeChannel({ guildId: OTHER_GUILD });
		const s = setup({ [CHANNEL_GENERAL]: general, [OTHER_CHANNEL]: other });
		s.services.liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		s.services.liveBoards.setChannel(OTHER_GUILD, OTHER_CHANNEL, ADMIN);

		assert.equal(await runLiveBoardSweep(s.client), 1);
		assert.deepEqual(s.channelFetches, [CHANNEL_GENERAL]);
		assert.equal(other.sent.length, 0);
		assert.equal(await runLiveBoardSweep(s.client), 0, "dữ liệu không đổi thì lượt sau không sửa");
	});

	test("chạy lượt đầu sau độ trễ, không chạy chồng lượt, dừng được", async (t) =>
	{
		let release: () => void = () => undefined;
		const general = fakeChannel({ beforeSendResolves: () => new Promise<void>(resolve => { release = resolve; }) });
		const s = setup({ [CHANNEL_GENERAL]: general });
		s.services.liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		const listAll = t.mock.method(s.services.liveBoards, "listAll");

		const stop = startLiveBoardScheduler(s.client, 5, 1);
		try
		{
			for (let waited = 0; general.sent.length === 0 && waited < 2000; waited += 5) await new Promise(resolve => setTimeout(resolve, 5));
			assert.equal(general.sent.length, 1, "lượt đầu đã chạy");
			await new Promise(resolve => setTimeout(resolve, 40));
			assert.equal(listAll.mock.callCount(), 1, "lượt đang chạy thì các nhịp sau bỏ qua");
			release();
			for (let waited = 0; listAll.mock.callCount() < 2 && waited < 2000; waited += 5) await new Promise(resolve => setTimeout(resolve, 5));
			assert.ok(listAll.mock.callCount() >= 2, "xong lượt thì nhịp sau chạy tiếp");
		}
		finally
		{
			stop();
		}
		const calls = listAll.mock.callCount();
		await new Promise(resolve => setTimeout(resolve, 30));
		assert.equal(listAll.mock.callCount(), calls, "đã dừng lịch");
	});
});
