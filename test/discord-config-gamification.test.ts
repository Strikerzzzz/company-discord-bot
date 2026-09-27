import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
	APIApplicationCommandOption,
	APIEmbed,
	ApplicationCommandOptionType,
	ChannelType,
	ChatInputCommandInteraction,
	GuildMember,
	InteractionReplyOptions,
	MessageFlags,
	PermissionFlagsBits,
	PermissionsBitField,
	Role,
} from "discord.js";
import type DiscordClient from "../src/classes/DiscordClient";
import { tierRoleSafetyIssue } from "../src/discord/roleSync";
import { TIER_ROLE_SYNC_NOTE } from "../src/discord/views/admin";
import ConfigCmd from "../src/interactions/commands/config";
import { TIER_KEYS } from "../src/modules/activity/tiers";
import { TierRoleService } from "../src/modules/gamification/TierRoleService";
import { SETTING_LIMITS } from "../src/modules/guild-config/types";
import { LiveBoard, LiveBoardService } from "../src/modules/live-board/LiveBoardService";
import { AppServices } from "../src/services";
import { ADMIN, CHANNEL_BOT, CHANNEL_GENERAL, createTestContext, GUILD, TestContext } from "./helpers";

const BOT_ROLE = "530000000000000099";
const ROLE_KIM_DAN = "530000000000000003";
const ROLE_OLD = "530000000000000004";
const MESSAGE_ID = "600000000000000001";
const ALL_BOARD_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles];
const INVALID_BOARD_OPTIONS = "Hãy chọn `kenh` để đặt Bảng vàng, hoặc chọn `tat` = True để tắt Bảng vàng.";

// ---------- Đối tượng giả ----------

interface RoleSpec
{
	position?: number;
	managed?: boolean;
	permissions?: bigint[];
}

function fakeRole(id: string, spec: RoleSpec = {}): Role
{
	return {
		id,
		position: spec.position ?? 3,
		managed: spec.managed ?? false,
		guild: { id: GUILD },
		permissions: new PermissionsBitField(spec.permissions ?? []),
	} as unknown as Role;
}

function fakeBot(manageRoles = true): GuildMember
{
	return {
		permissions: new PermissionsBitField(manageRoles ? [PermissionFlagsBits.ManageRoles] : []),
		roles: { highest: fakeRole(BOT_ROLE, { position: 10 }) },
	} as unknown as GuildMember;
}

/** Kênh giả: quyền của bot ở kênh là `permissions`. */
function fakeChannel(id: string, permissions: bigint[] = ALL_BOARD_PERMISSIONS): object
{
	return { id, type: ChannelType.GuildText, permissionsFor: (): PermissionsBitField => new PermissionsBitField(permissions) };
}

interface Harness
{
	context: TestContext;
	tierRoles: TierRoleService;
	liveBoards: LiveBoardService;
	config: ConfigCmd;
	/** Thứ tự các bước: defer, remove, refresh, edit. */
	steps: string[];
	refreshCalls: { guildId: string; force: boolean | undefined }[];
	removed: LiveBoard[];
	/** Kênh Bảng vàng đang lưu trong database tại thời điểm xoá message cũ. */
	channelWhenRemoving: (string | null)[];
	result: { refresh: boolean; remove: boolean };
}

/** GuildConfig, Team, Audit, TierRole, LiveBoard là service thật trên SQLite :memory:; thao tác message Bảng vàng là fake. */
function createHarness(): Harness
{
	const context = createTestContext();
	const tierRoles = new TierRoleService(context.db, context.clock, context.deps.audit);
	const liveBoards = new LiveBoardService(context.db, context.clock, context.deps.audit);
	const services = {
		clock: context.clock,
		guildConfig: context.deps.guildConfig,
		teams: context.deps.teams,
		audit: context.deps.audit,
		tierRoles,
		liveBoards,
	} as unknown as AppServices;
	const client = { services } as unknown as DiscordClient;
	const config = new ConfigCmd(client);
	const harness: Harness = {
		context,
		tierRoles,
		liveBoards,
		config,
		steps: [],
		refreshCalls: [],
		removed: [],
		channelWhenRemoving: [],
		result: { refresh: true, remove: true },
	};
	config.liveBoardActions = {
		refresh: (actionClient, guildId, options = {}) =>
		{
			assert.equal(actionClient, client);
			harness.steps.push("refresh");
			harness.refreshCalls.push({ guildId, force: options.force });
			return Promise.resolve(harness.result.refresh);
		},
		remove: (actionClient, board) =>
		{
			assert.equal(actionClient, client);
			harness.steps.push("remove");
			harness.removed.push(board);
			harness.channelWhenRemoving.push(liveBoards.get(GUILD)?.channelId ?? null);
			return Promise.resolve(harness.result.remove);
		},
	};
	return harness;
}

interface Invocation
{
	group?: string;
	subcommand: string;
	options?: Record<string, unknown>;
	/** Server có trong cache của bot không (mặc định có). */
	cached?: boolean;
	/** Bot trong server; null = không có trong cache. */
	bot?: GuildMember | null;
}

interface FakeInteraction
{
	interaction: ChatInputCommandInteraction;
	replies: InteractionReplyOptions[];
	deferred: unknown[];
	edits: unknown[];
}

function invoke(harness: Harness, call: Invocation): FakeInteraction
{
	const values = call.options ?? {};
	const get = (name: string): unknown => (Object.hasOwn(values, name) ? values[name] : null);
	const replies: InteractionReplyOptions[] = [];
	const deferred: unknown[] = [];
	const edits: unknown[] = [];
	const fake = {
		guildId: GUILD,
		user: { id: ADMIN, bot: false },
		inGuild: (): boolean => true,
		inCachedGuild: (): boolean => call.cached ?? true,
		guild: { id: GUILD, members: { me: call.bot === undefined ? fakeBot() : call.bot } },
		options: {
			getSubcommandGroup: (): string | null => call.group ?? null,
			getSubcommand: (): string => call.subcommand,
			getString: get,
			getInteger: get,
			getBoolean: get,
			getRole: get,
			getChannel: get,
		},
		reply: (payload: InteractionReplyOptions): Promise<void> =>
		{
			replies.push(payload);
			return Promise.resolve();
		},
		deferReply: (payload: unknown): Promise<void> =>
		{
			harness.steps.push("defer");
			deferred.push(payload);
			return Promise.resolve();
		},
		editReply: (payload: unknown): Promise<void> =>
		{
			harness.steps.push("edit");
			edits.push(payload);
			return Promise.resolve();
		},
	};
	return { interaction: fake as unknown as ChatInputCommandInteraction, replies, deferred, edits };
}

async function run(harness: Harness, call: Invocation): Promise<FakeInteraction>
{
	const fake = invoke(harness, call);
	await harness.config.execute(fake.interaction);
	return fake;
}

async function rejects(harness: Harness, call: Invocation, message: string): Promise<FakeInteraction>
{
	const fake = invoke(harness, call);
	await assert.rejects(harness.config.execute(fake.interaction), { name: "UserError", message });
	assert.equal(fake.replies.length, 0);
	return fake;
}

function replyText(fake: FakeInteraction): string
{
	assert.equal(fake.replies.length, 1);
	const [reply] = fake.replies;
	assert.equal(reply.flags, MessageFlags.Ephemeral, "phản hồi phải là ephemeral");
	assert.ok(typeof reply.content === "string");
	return reply.content;
}

function replyEmbed(fake: FakeInteraction): APIEmbed
{
	assert.equal(fake.replies.length, 1);
	assert.equal(fake.replies[0].flags, MessageFlags.Ephemeral);
	const embed = fake.replies[0].embeds?.[0];
	assert.ok(embed);
	return "toJSON" in embed ? embed.toJSON() : embed;
}

/** Phản hồi sau khi defer riêng: đúng một lần defer ephemeral và một lần sửa phản hồi. */
function deferredText(fake: FakeInteraction): string
{
	assert.deepEqual(fake.deferred, [{ flags: MessageFlags.Ephemeral }]);
	assert.equal(fake.replies.length, 0);
	assert.equal(fake.edits.length, 1);
	const [text] = fake.edits;
	assert.ok(typeof text === "string");
	return text;
}

function audits(context: TestContext, prefix: string): { action: string; targetId: string | null; details: unknown }[]
{
	return context.deps.audit.list(GUILD, 50)
		.filter(entry => entry.action.startsWith(prefix))
		.map(entry => ({ action: entry.action, targetId: entry.targetId, details: entry.details }))
		.reverse();
}

function childrenOf(option: APIApplicationCommandOption): readonly APIApplicationCommandOption[]
{
	if (option.type === ApplicationCommandOptionType.Subcommand || option.type === ApplicationCommandOptionType.SubcommandGroup)
	{
		return option.options ?? [];
	}
	return [];
}

function optionAt(options: readonly APIApplicationCommandOption[] | undefined, ...path: string[]): APIApplicationCommandOption
{
	let current: readonly APIApplicationCommandOption[] = options ?? [];
	let found: APIApplicationCommandOption | undefined;
	for (const name of path)
	{
		found = current.find(option => option.name === name);
		assert.ok(found, `không có option ${path.join(" ")}`);
		current = childrenOf(found);
	}
	assert.ok(found);
	return found;
}

// ---------- Test ----------

describe("định nghĩa /config canh-gioi, bang-vang, poll gioi-han-xp-ngay", () =>
{
	const json = createHarness().config.data.toJSON();

	test("canh-gioi: 8 lựa chọn cảnh giới dạng \"Tên (Lv n+)\", value là khoá cảnh giới; gan-role bắt buộc role", () =>
	{
		for (const subcommand of ["gan-role", "bo-role"])
		{
			const option = optionAt(json.options, "canh-gioi", subcommand, "canh-gioi");
			assert.equal(option.type, ApplicationCommandOptionType.String);
			if (option.type !== ApplicationCommandOptionType.String) continue;
			assert.equal(option.required, true);
			assert.deepEqual(option.choices?.map(choice => choice.value), [...TIER_KEYS]);
			assert.deepEqual(option.choices?.map(choice => choice.name), [
				"Luyện Khí (Lv 0+)",
				"Trúc Cơ (Lv 3+)",
				"Kim Đan (Lv 6+)",
				"Nguyên Anh (Lv 10+)",
				"Hóa Thần (Lv 15+)",
				"Luyện Hư (Lv 20+)",
				"Hợp Thể (Lv 30+)",
				"Độ Kiếp (Lv 40+)",
			]);
		}
		const role = optionAt(json.options, "canh-gioi", "gan-role", "role");
		assert.equal(role.type, ApplicationCommandOptionType.Role);
		assert.equal(role.required, true);
	});

	test("bang-vang: kenh (text, announcement) và tat, đều không bắt buộc", () =>
	{
		const kenh = optionAt(json.options, "bang-vang", "kenh");
		assert.equal(kenh.type, ApplicationCommandOptionType.Channel);
		if (kenh.type === ApplicationCommandOptionType.Channel)
		{
			assert.deepEqual(kenh.channel_types, [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
			assert.ok(!kenh.required);
		}
		const tat = optionAt(json.options, "bang-vang", "tat");
		assert.equal(tat.type, ApplicationCommandOptionType.Boolean);
		assert.ok(!tat.required);
	});

	test("poll gioi-han-xp-ngay: min/max theo SETTING_LIMITS, mô tả nói rõ 0 = không giới hạn", () =>
	{
		const option = optionAt(json.options, "poll", "gioi-han-xp-ngay");
		assert.equal(option.type, ApplicationCommandOptionType.Integer);
		if (option.type !== ApplicationCommandOptionType.Integer) return;
		assert.equal(option.min_value, SETTING_LIMITS.pollXpDailyCap.min);
		assert.equal(option.max_value, SETTING_LIMITS.pollXpDailyCap.max);
		assert.ok(option.description.includes("0 = không giới hạn"));
	});
});

describe("/config canh-gioi", () =>
{
	test("gan-role: lưu role, ghi audit, trả lời riêng kèm ghi chú thời điểm cập nhật role", async () =>
	{
		const harness = createHarness();
		const text = replyText(await run(harness, { group: "canh-gioi", subcommand: "gan-role", options: { "canh-gioi": "kim-dan", role: fakeRole(ROLE_KIM_DAN) } }));

		assert.equal(text, `Đã gán <@&${ROLE_KIM_DAN}> cho cảnh giới 🟡 **Kim Đan** (từ Level 6).\n${TIER_ROLE_SYNC_NOTE}`);
		assert.deepEqual(harness.tierRoles.list(GUILD), [{ tierKey: "kim-dan", roleId: ROLE_KIM_DAN }]);
		assert.deepEqual(audits(harness.context, "tier_role"), [{ action: "tier_role.set", targetId: ROLE_KIM_DAN, details: { tierKey: "kim-dan" } }]);
	});

	test("gan-role: bot chưa có Manage Roles thì vẫn lưu nhưng cảnh báo; đổi role thì nhắc role cũ không còn do bot quản lý", async () =>
	{
		const harness = createHarness();
		harness.tierRoles.set(GUILD, "kim-dan", ROLE_OLD, ADMIN);
		const text = replyText(await run(harness, {
			group: "canh-gioi",
			subcommand: "gan-role",
			options: { "canh-gioi": "kim-dan", role: fakeRole(ROLE_KIM_DAN) },
			bot: fakeBot(false),
		}));

		assert.deepEqual(harness.tierRoles.list(GUILD), [{ tierKey: "kim-dan", roleId: ROLE_KIM_DAN }]);
		assert.ok(text.includes(`Role cũ <@&${ROLE_OLD}> không còn do bot quản lý`), text);
		assert.ok(text.includes("⚠️ Bot chưa có quyền **Manage Roles**"), text);
	});

	test("gan-role: từ chối @everyone, role do integration quản lý, role có quyền nguy hiểm, role không thấp hơn role của bot", async () =>
	{
		const harness = createHarness();
		const bot = fakeBot();
		const unsafe = [
			fakeRole(GUILD, { position: 0 }),
			fakeRole(ROLE_KIM_DAN, { managed: true }),
			fakeRole(ROLE_KIM_DAN, { permissions: [PermissionFlagsBits.Administrator] }),
			fakeRole(ROLE_KIM_DAN, { permissions: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.MentionEveryone] }),
			fakeRole(ROLE_KIM_DAN, { position: 10 }),
		];
		for (const role of unsafe)
		{
			const expected = tierRoleSafetyIssue(role, bot);
			assert.ok(expected !== null);
			await rejects(harness, { group: "canh-gioi", subcommand: "gan-role", options: { "canh-gioi": "kim-dan", role }, bot }, expected);
		}
		assert.deepEqual(harness.tierRoles.list(GUILD), []);
		assert.deepEqual(audits(harness.context, "tier_role"), []);
	});

	test("gan-role: role đang thuộc cảnh giới khác, cảnh giới không hợp lệ, server hoặc bot không có trong cache thì báo lỗi", async () =>
	{
		const harness = createHarness();
		harness.tierRoles.set(GUILD, "luyen-khi", ROLE_KIM_DAN, ADMIN);
		const options = { "canh-gioi": "kim-dan", role: fakeRole(ROLE_KIM_DAN) };

		await rejects(harness, { group: "canh-gioi", subcommand: "gan-role", options }, "Role này đang được gán cho cảnh giới Luyện Khí. Hãy bỏ gán ở cảnh giới đó trước.");
		await rejects(harness, { group: "canh-gioi", subcommand: "gan-role", options: { ...options, "canh-gioi": "phi-thang" } }, "Cảnh giới không hợp lệ.");
		await rejects(harness, { group: "canh-gioi", subcommand: "gan-role", options, cached: false }, "Không đọc được thông tin server. Vui lòng thử lại sau.");
		await rejects(harness, { group: "canh-gioi", subcommand: "gan-role", options, bot: null }, "Không đọc được thông tin của bot trong server. Vui lòng thử lại sau.");
		assert.deepEqual(harness.tierRoles.list(GUILD), [{ tierKey: "luyen-khi", roleId: ROLE_KIM_DAN }]);
	});

	test("bo-role: bỏ role đã gán (nhắc bot không tự gỡ role khỏi người đang có); chưa gán thì báo", async () =>
	{
		const harness = createHarness();
		harness.tierRoles.set(GUILD, "kim-dan", ROLE_KIM_DAN, ADMIN);

		const cleared = replyText(await run(harness, { group: "canh-gioi", subcommand: "bo-role", options: { "canh-gioi": "kim-dan" } }));
		assert.ok(cleared.startsWith(`Đã bỏ <@&${ROLE_KIM_DAN}> khỏi cảnh giới 🟡 **Kim Đan** (từ Level 6).`), cleared);
		assert.ok(cleared.includes("không tự gỡ role đó"));
		assert.deepEqual(harness.tierRoles.list(GUILD), []);
		assert.deepEqual(audits(harness.context, "tier_role").map(entry => entry.action), ["tier_role.set", "tier_role.clear"]);

		const again = replyText(await run(harness, { group: "canh-gioi", subcommand: "bo-role", options: { "canh-gioi": "kim-dan" } }));
		assert.equal(again, "Cảnh giới 🟡 **Kim Đan** (từ Level 6) chưa được gán role.");
	});

	test("list: đủ 8 cảnh giới với emoji, tên, mốc level, role hoặc \"chưa gán\", ghi chú thời điểm cập nhật role", async () =>
	{
		const harness = createHarness();
		harness.tierRoles.set(GUILD, "kim-dan", ROLE_KIM_DAN, ADMIN);
		const embed = replyEmbed(await run(harness, { group: "canh-gioi", subcommand: "list" }));

		assert.equal(embed.title, "☯️ Role cảnh giới (1/8)");
		const lines = (embed.description ?? "").split("\n");
		assert.equal(lines.length, 8);
		assert.equal(lines[0], "🌱 **Luyện Khí** · từ Level 0 · chưa gán");
		assert.equal(lines[2], `🟡 **Kim Đan** · từ Level 6 · <@&${ROLE_KIM_DAN}>`);
		assert.equal(lines[7], "⚡ **Độ Kiếp** · từ Level 40 · chưa gán");
		assert.equal(lines.filter(line => line.endsWith("chưa gán")).length, 7);
		assert.equal(embed.footer?.text, TIER_ROLE_SYNC_NOTE);
	});
});

describe("/config bang-vang", () =>
{
	test("đặt kênh lần đầu: kiểm tra quyền, defer riêng, lưu kênh, đăng bảng ngay (force), ghi audit", async () =>
	{
		const harness = createHarness();
		const fake = await run(harness, { subcommand: "bang-vang", options: { kenh: fakeChannel(CHANNEL_GENERAL) } });

		assert.ok(deferredText(fake).startsWith(`Đã đặt Bảng vàng ở <#${CHANNEL_GENERAL}>.`));
		assert.deepEqual(harness.steps, ["defer", "refresh", "edit"]);
		assert.deepEqual(harness.refreshCalls, [{ guildId: GUILD, force: true }]);
		assert.deepEqual(harness.removed, []);
		assert.equal(harness.liveBoards.get(GUILD)?.channelId, CHANNEL_GENERAL);
		assert.deepEqual(audits(harness.context, "board"), [{ action: "board.set", targetId: CHANNEL_GENERAL, details: null }]);
	});

	test("chuyển kênh: xoá message bảng cũ (sau khi đã lưu kênh mới) rồi đăng bảng ở kênh mới", async () =>
	{
		const harness = createHarness();
		harness.liveBoards.setChannel(GUILD, CHANNEL_BOT, ADMIN);
		harness.liveBoards.setMessage(GUILD, CHANNEL_BOT, MESSAGE_ID);
		const old = harness.liveBoards.get(GUILD);

		deferredText(await run(harness, { subcommand: "bang-vang", options: { kenh: fakeChannel(CHANNEL_GENERAL) } }));
		assert.deepEqual(harness.steps, ["defer", "remove", "refresh", "edit"]);
		assert.deepEqual(harness.removed, [old]);
		assert.deepEqual(harness.channelWhenRemoving, [CHANNEL_GENERAL]);
		assert.deepEqual(harness.liveBoards.get(GUILD)?.messageId, null);
	});

	test("đặt lại đúng kênh đang dùng: bảng cũ chưa đăng được message thì không cần xoá", async () =>
	{
		const harness = createHarness();
		harness.liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		deferredText(await run(harness, { subcommand: "bang-vang", options: { kenh: fakeChannel(CHANNEL_GENERAL) } }));
		assert.deepEqual(harness.removed, []);
		assert.equal(harness.refreshCalls.length, 1);
	});

	test("chưa đăng được bảng xếp hạng thì cảnh báo, kênh vẫn được lưu", async () =>
	{
		const harness = createHarness();
		harness.result.refresh = false;
		const text = deferredText(await run(harness, { subcommand: "bang-vang", options: { kenh: fakeChannel(CHANNEL_GENERAL) } }));
		assert.ok(text.includes("⚠️ Chưa đăng được bảng xếp hạng"), text);
		assert.equal(harness.liveBoards.get(GUILD)?.channelId, CHANNEL_GENERAL);
	});

	test("bot thiếu quyền ở kênh: báo đủ các quyền thiếu, không defer, không lưu", async () =>
	{
		const harness = createHarness();
		const onlyView = fakeChannel(CHANNEL_GENERAL, [PermissionFlagsBits.ViewChannel]);
		const fake = await rejects(
			harness,
			{ subcommand: "bang-vang", options: { kenh: onlyView } },
			`Bot thiếu quyền **Send Messages**, **Attach Files** ở <#${CHANNEL_GENERAL}>. Hãy cấp quyền cho bot ở kênh đó rồi thử lại.`,
		);
		assert.deepEqual(fake.deferred, []);

		const noAttach = fakeChannel(CHANNEL_GENERAL, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);
		await rejects(
			harness,
			{ subcommand: "bang-vang", options: { kenh: noAttach } },
			`Bot thiếu quyền **Attach Files** ở <#${CHANNEL_GENERAL}>. Hãy cấp quyền cho bot ở kênh đó rồi thử lại.`,
		);
		assert.equal(harness.liveBoards.get(GUILD), null);
		assert.deepEqual(harness.steps, []);
		assert.deepEqual(audits(harness.context, "board"), []);
	});

	test("tắt: xoá message bảng cũ, ghi audit; không xoá được thì nói rõ", async () =>
	{
		const harness = createHarness();
		harness.liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		harness.liveBoards.setMessage(GUILD, CHANNEL_GENERAL, MESSAGE_ID);

		const text = deferredText(await run(harness, { subcommand: "bang-vang", options: { tat: true } }));
		assert.equal(text, `Đã tắt Bảng vàng và xoá message bảng xếp hạng ở <#${CHANNEL_GENERAL}>.`);
		assert.deepEqual(harness.removed.map(board => [board.channelId, board.messageId]), [[CHANNEL_GENERAL, MESSAGE_ID]]);
		assert.equal(harness.liveBoards.get(GUILD), null);
		assert.deepEqual(audits(harness.context, "board").map(entry => entry.action), ["board.set", "board.clear"]);

		harness.liveBoards.setChannel(GUILD, CHANNEL_BOT, ADMIN);
		harness.liveBoards.setMessage(GUILD, CHANNEL_BOT, MESSAGE_ID);
		harness.result.remove = false;
		const failed = deferredText(await run(harness, { subcommand: "bang-vang", options: { tat: true } }));
		assert.ok(failed.startsWith("Đã tắt Bảng vàng. Không xoá được message bảng xếp hạng cũ"), failed);
		assert.equal(harness.liveBoards.get(GUILD), null);
	});

	test("tắt: bảng chưa có message thì không cần xoá; vốn đang tắt thì báo", async () =>
	{
		const harness = createHarness();
		harness.liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		assert.equal(deferredText(await run(harness, { subcommand: "bang-vang", options: { tat: true } })), `Đã tắt Bảng vàng ở <#${CHANNEL_GENERAL}>.`);
		assert.deepEqual(harness.removed, []);

		assert.equal(deferredText(await run(harness, { subcommand: "bang-vang", options: { tat: true } })), "Bảng vàng vốn đang tắt.");
	});

	test("phải chọn đúng một trong kenh và tat", async () =>
	{
		const harness = createHarness();
		await rejects(
			harness,
			{ subcommand: "bang-vang", options: { kenh: fakeChannel(CHANNEL_GENERAL), tat: true } },
			"Chỉ chọn một: `kenh` để đặt Bảng vàng, hoặc `tat` để tắt.",
		);
		await rejects(harness, { subcommand: "bang-vang" }, INVALID_BOARD_OPTIONS);
		await rejects(harness, { subcommand: "bang-vang", options: { tat: false } }, INVALID_BOARD_OPTIONS);
		assert.deepEqual(harness.steps, []);
		assert.equal(harness.liveBoards.get(GUILD), null);
	});
});

describe("/config poll gioi-han-xp-ngay", () =>
{
	test("đặt giới hạn XP từ vote mỗi ngày; 0 là không giới hạn; đi cùng các option khác theo thứ tự cố định", async () =>
	{
		const harness = createHarness();
		const settings = (): number => harness.context.deps.guildConfig.getSettings(GUILD).pollXpDailyCap;

		const set = replyText(await run(harness, { subcommand: "poll", options: { "gioi-han-xp-ngay": 40 } }));
		assert.equal(set, "Đã cập nhật cấu hình vote:\n• Giới hạn XP từ vote mỗi ngày: **40 XP**");
		assert.equal(settings(), 40);

		const unlimited = replyText(await run(harness, { subcommand: "poll", options: { "gioi-han-xp-ngay": 0, "xp-mac-dinh": 8 } }));
		assert.equal(unlimited, "Đã cập nhật cấu hình vote:\n• XP mặc định khi vote: **8 XP**\n• Giới hạn XP từ vote mỗi ngày: **không giới hạn**");
		assert.equal(settings(), 0);

		const [entry] = harness.context.deps.audit.list(GUILD, 1);
		assert.equal(entry.action, "config.update");
		assert.deepEqual(entry.details, { defaultPollXp: 8, pollXpDailyCap: 0 });
	});
});
