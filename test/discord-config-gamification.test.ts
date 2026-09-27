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
	OverwriteType,
	PermissionFlagsBits,
	PermissionsBitField,
	Role,
} from "discord.js";
import type DiscordClient from "../src/classes/DiscordClient";
import { tierRoleSafetyIssue } from "../src/discord/roleSync";
import { TIER_ROLE_DEDICATED_NOTE, TIER_ROLE_SYNC_NOTE } from "../src/discord/views/admin";
import ConfigCmd from "../src/interactions/commands/config";
import { TIER_KEYS } from "../src/modules/activity/tiers";
import { TierRoleService } from "../src/modules/gamification/TierRoleService";
import { SETTING_LIMITS } from "../src/modules/guild-config/types";
import { LiveBoard, LiveBoardService } from "../src/modules/live-board/LiveBoardService";
import { AppServices } from "../src/services";
import { ADMIN, CHANNEL_BOT, CHANNEL_GENERAL, createTestContext, GUILD, TestContext } from "./helpers";

const BOT_USER = "900000000000000001";
const OWNER = "200000000000000099";
const BOT_ROLE = "530000000000000099";
const ADMIN_TOP_ROLE = "530000000000000088";
const ROLE_KIM_DAN = "530000000000000003";
const ROLE_OLD = "530000000000000004";
const ROLE_TEAM = "530000000000000005";
const MESSAGE_ID = "600000000000000001";
const ALL_BOARD_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles];
const CALLER_CHANNEL_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
const INVALID_BOARD_OPTIONS = "Hãy chọn `kenh` để đặt Bảng vàng, hoặc chọn `tat` = True để tắt Bảng vàng.";
const BOT_MEMBER_UNAVAILABLE = "Không đọc được thông tin của bot trong server. Vui lòng thử lại sau.";

// ---------- Đối tượng giả ----------

interface RoleSpec
{
	position?: number;
	managed?: boolean;
	permissions?: bigint[];
	/** Phân quyền riêng cho role này ở các kênh: id kênh → quyền được cho phép. */
	overwrites?: Record<string, bigint[]>;
}

function fakeRole(id: string, spec: RoleSpec = {}): Role
{
	const channels = Object.entries(spec.overwrites ?? {}).map(([channelId, allow]) => [channelId, {
		id: channelId,
		isThread: (): boolean => false,
		permissionOverwrites: { cache: new Map([[id, { id, type: OverwriteType.Role, allow: new PermissionsBitField(allow) }]]) },
	}] as const);
	return {
		id,
		position: spec.position ?? 3,
		managed: spec.managed ?? false,
		guild: { id: GUILD, channels: { cache: new Map(channels) } },
		permissions: new PermissionsBitField(spec.permissions ?? []),
	} as unknown as Role;
}

function fakeBot(manageRoles = true, highestPosition = 10): GuildMember
{
	return {
		user: { id: BOT_USER },
		permissions: new PermissionsBitField(manageRoles ? [PermissionFlagsBits.ManageRoles] : []),
		roles: { highest: fakeRole(BOT_ROLE, { position: highestPosition }) },
	} as unknown as GuildMember;
}

/** Người gọi lệnh; mặc định có Manage Roles và role cao nhất ở vị trí 20. */
interface CallerSpec
{
	id?: string;
	permissions?: bigint[];
	highestPosition?: number;
}

/** Kênh giả: quyền của bot và của người gọi ở kênh. */
function fakeChannel(id: string, bot: bigint[] = ALL_BOARD_PERMISSIONS, caller: bigint[] = CALLER_CHANNEL_PERMISSIONS): object
{
	return {
		id,
		type: ChannelType.GuildText,
		permissionsFor: (member: { user: { id: string } }): PermissionsBitField => new PermissionsBitField(member.user.id === BOT_USER ? bot : caller),
	};
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
		tierSets: context.deps.tierSets,
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
	/** Bot trong cache của server; null = không có trong cache. */
	bot?: GuildMember | null;
	/** Kết quả tải lại thông tin bot (fetchMe); mặc định trả về bot trong cache hoặc fakeBot(). Error = tải lỗi. */
	fetchedBot?: GuildMember | Error;
	caller?: CallerSpec;
}

interface FakeInteraction
{
	interaction: ChatInputCommandInteraction;
	replies: InteractionReplyOptions[];
	deferred: unknown[];
	edits: unknown[];
	/** Tham số của các lần gọi fetchMe. */
	fetches: unknown[];
}

function invoke(harness: Harness, call: Invocation): FakeInteraction
{
	const values = call.options ?? {};
	const get = (name: string): unknown => (Object.hasOwn(values, name) ? values[name] : null);
	const replies: InteractionReplyOptions[] = [];
	const deferred: unknown[] = [];
	const edits: unknown[] = [];
	const fetches: unknown[] = [];
	const cachedBot = call.bot === undefined ? fakeBot() : call.bot;
	const callerId = call.caller?.id ?? ADMIN;
	const callerPermissions = new PermissionsBitField(call.caller?.permissions ?? [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles]);
	const fake = {
		guildId: GUILD,
		user: { id: callerId, bot: false },
		member: { user: { id: callerId }, roles: { highest: fakeRole(ADMIN_TOP_ROLE, { position: call.caller?.highestPosition ?? 20 }) } },
		memberPermissions: callerPermissions,
		inGuild: (): boolean => true,
		inCachedGuild: (): boolean => call.cached ?? true,
		guild: {
			id: GUILD,
			ownerId: OWNER,
			members: {
				me: cachedBot,
				fetchMe: (options: unknown): Promise<GuildMember> =>
				{
					fetches.push(options);
					const fetched = call.fetchedBot ?? cachedBot ?? fakeBot();
					return fetched instanceof Error ? Promise.reject(fetched) : Promise.resolve(fetched);
				},
			},
		},
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
	return { interaction: fake as unknown as ChatInputCommandInteraction, replies, deferred, edits, fetches };
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

/** Gọi `/config tier set-role` cho cảnh giới Kim Đan. */
function setRole(role: Role, extra: Omit<Invocation, "group" | "subcommand" | "options"> = {}): Invocation
{
	return { group: "tier", subcommand: "set-role", options: { "canh-gioi": "bac-3", role }, ...extra };
}

// ---------- Test ----------

describe("định nghĩa /config tier, board, poll gioi-han-xp-ngay", () =>
{
	const json = createHarness().config.data.toJSON();

	test("tier: 8 lựa chọn cảnh giới dạng \"Tên (Lv n+)\", value là khoá cảnh giới; set-role bắt buộc role", () =>
	{
		for (const subcommand of ["set-role", "clear-role"])
		{
			const option = optionAt(json.options, "tier", subcommand, "canh-gioi");
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
		const role = optionAt(json.options, "tier", "set-role", "role");
		assert.equal(role.type, ApplicationCommandOptionType.Role);
		assert.equal(role.required, true);
	});

	test("board: kenh (text, announcement) và tat, đều không bắt buộc", () =>
	{
		const kenh = optionAt(json.options, "board", "kenh");
		assert.equal(kenh.type, ApplicationCommandOptionType.Channel);
		if (kenh.type === ApplicationCommandOptionType.Channel)
		{
			assert.deepEqual(kenh.channel_types, [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
			assert.ok(!kenh.required);
		}
		const tat = optionAt(json.options, "board", "tat");
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

describe("/config tier", () =>
{
	test("set-role: lưu role, ghi audit, trả lời riêng kèm ghi chú thời điểm cập nhật role và cảnh báo dùng role mới tạo riêng", async () =>
	{
		const harness = createHarness();
		const fake = await run(harness, setRole(fakeRole(ROLE_KIM_DAN)));
		const text = replyText(fake);

		assert.equal(text, `Đã gán <@&${ROLE_KIM_DAN}> cho cảnh giới 🟡 **Kim Đan** (từ Level 6).\n${TIER_ROLE_SYNC_NOTE}\n${TIER_ROLE_DEDICATED_NOTE}`);
		assert.ok(TIER_ROLE_DEDICATED_NOTE.includes("role **mới tạo riêng**"));
		assert.ok(TIER_ROLE_DEDICATED_NOTE.includes("bot sẽ gỡ role này khỏi người không ở đúng cảnh giới"));
		assert.deepEqual(fake.fetches, [{ force: true }], "làm mới thông tin bot trước khi kiểm tra thứ bậc role");
		assert.deepEqual(harness.tierRoles.list(GUILD), [{ tierKey: "bac-3", roleId: ROLE_KIM_DAN, createdByBot: false }]);
		assert.deepEqual(audits(harness.context, "tier_role"), [{ action: "tier_role.set", targetId: ROLE_KIM_DAN, details: { tierKey: "bac-3" } }]);
	});

	test("set-role: bot chưa có Manage Roles thì vẫn lưu nhưng cảnh báo; đổi role thì nhắc role cũ không còn do bot quản lý", async () =>
	{
		const harness = createHarness();
		harness.tierRoles.set(GUILD, "bac-3", ROLE_OLD, ADMIN);
		const text = replyText(await run(harness, setRole(fakeRole(ROLE_KIM_DAN), { fetchedBot: fakeBot(false) })));

		assert.deepEqual(harness.tierRoles.list(GUILD), [{ tierKey: "bac-3", roleId: ROLE_KIM_DAN, createdByBot: false }]);
		assert.ok(text.includes(`Role cũ <@&${ROLE_OLD}> không còn do bot quản lý`), text);
		assert.ok(text.includes("⚠️ Bot chưa có quyền **Manage Roles**"), text);
	});

	test("set-role: từ chối @everyone, role do integration quản lý, role có quyền nguy hiểm (cả trong phân quyền riêng của kênh), role không thấp hơn role của bot", async () =>
	{
		const harness = createHarness();
		const bot = fakeBot();
		const unsafe = [
			fakeRole(GUILD, { position: 0 }),
			fakeRole(ROLE_KIM_DAN, { managed: true }),
			fakeRole(ROLE_KIM_DAN, { permissions: [PermissionFlagsBits.Administrator] }),
			fakeRole(ROLE_KIM_DAN, { permissions: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.MentionEveryone] }),
			fakeRole(ROLE_KIM_DAN, { permissions: [PermissionFlagsBits.PinMessages] }),
			fakeRole(ROLE_KIM_DAN, { overwrites: { [CHANNEL_GENERAL]: [PermissionFlagsBits.ManageMessages] } }),
			fakeRole(ROLE_KIM_DAN, { position: 10 }),
		];
		for (const role of unsafe)
		{
			const expected = tierRoleSafetyIssue(role, bot);
			assert.ok(expected !== null);
			await rejects(harness, setRole(role, { fetchedBot: bot }), expected);
		}
		assert.deepEqual(harness.tierRoles.list(GUILD), []);
		assert.deepEqual(audits(harness.context, "tier_role"), []);
	});

	test("set-role: kiểm tra thứ bậc theo thông tin bot vừa tải lại, không theo cache cũ; tải lỗi thì báo và ghi log", async (t) =>
	{
		const logged = t.mock.method(console, "error", () => undefined);
		const harness = createHarness();
		const role = fakeRole(ROLE_KIM_DAN, { position: 5 });
		const fresh = fakeBot(true, 4);
		const expected = tierRoleSafetyIssue(role, fresh) ?? "";
		assert.ok(expected.includes("không thấp hơn role cao nhất của bot"));

		await rejects(harness, setRole(role, { bot: fakeBot(true, 10), fetchedBot: fresh }), expected);
		await rejects(harness, setRole(role, { fetchedBot: new Error("Service Unavailable") }), BOT_MEMBER_UNAVAILABLE);
		assert.equal(logged.mock.callCount(), 1);
		assert.match(String(logged.mock.calls[0].arguments[0]), /\[WARN\] Không tải được thông tin của bot/);
		assert.deepEqual(harness.tierRoles.list(GUILD), []);
	});

	test("set-role: từ chối role đang là role admin bot, role tạo vote hoặc role team (vai trò khác của role bị méo khi bot tự thêm/gỡ)", async () =>
	{
		const harness = createHarness();
		const { guildConfig, teams } = harness.context.deps;
		const cases: [string, () => void][] = [
			["role admin bot", () => guildConfig.updateSettings(GUILD, { adminRoleId: ROLE_KIM_DAN }, ADMIN)],
			["role được tạo vote", () => guildConfig.updateSettings(GUILD, { adminRoleId: null, pollCreatorRoleId: ROLE_KIM_DAN }, ADMIN)],
			["role của một team", () =>
			{
				guildConfig.updateSettings(GUILD, { pollCreatorRoleId: null }, ADMIN);
				teams.add(GUILD, ROLE_KIM_DAN, ADMIN);
			}],
		];
		for (const [usage, arrange] of cases)
		{
			arrange();
			await rejects(
				harness,
				setRole(fakeRole(ROLE_KIM_DAN)),
				`Không thể dùng <@&${ROLE_KIM_DAN}> làm role cảnh giới vì role này đang là ${usage}. `
					+ "Bot tự gán role cảnh giới cho người đủ level và gỡ khỏi người khác, nên hãy tạo một role mới dành riêng cho cảnh giới.",
			);
		}
		assert.deepEqual(harness.tierRoles.list(GUILD), []);
		assert.deepEqual(audits(harness.context, "tier_role"), []);
	});

	test("set-role: người gọi phải có Manage Roles và role phải thấp hơn role cao nhất của họ; chủ server luôn được", async () =>
	{
		const harness = createHarness();
		const role = fakeRole(ROLE_KIM_DAN, { position: 5 });

		const noManageRoles = await rejects(
			harness,
			setRole(role, { caller: { permissions: [PermissionFlagsBits.ManageGuild] } }),
			"Bạn cần quyền **Manage Roles** để gán role cảnh giới, vì bot sẽ thay bạn gán role này cho thành viên.",
		);
		assert.deepEqual(noManageRoles.fetches, []);

		for (const highestPosition of [5, 4])
		{
			await rejects(
				harness,
				setRole(role, { caller: { highestPosition } }),
				`Bạn không gán được <@&${ROLE_KIM_DAN}> vì role này không thấp hơn role cao nhất của bạn (<@&${ADMIN_TOP_ROLE}>). `
					+ "Discord chỉ cho gán role nằm dưới role cao nhất của mình.",
			);
		}
		assert.deepEqual(harness.tierRoles.list(GUILD), []);

		replyText(await run(harness, setRole(role, { caller: { permissions: [PermissionFlagsBits.Administrator], highestPosition: 6 } })));
		assert.deepEqual(harness.tierRoles.list(GUILD), [{ tierKey: "bac-3", roleId: ROLE_KIM_DAN, createdByBot: false }], "Administrator có Manage Roles");

		harness.tierRoles.clear(GUILD, "bac-3", ADMIN);
		replyText(await run(harness, setRole(role, { caller: { id: OWNER, permissions: [], highestPosition: 0 } })));
		assert.deepEqual(harness.tierRoles.list(GUILD), [{ tierKey: "bac-3", roleId: ROLE_KIM_DAN, createdByBot: false }], "chủ server không bị giới hạn thứ bậc");
	});

	test("set-role: role đang thuộc cảnh giới khác, cảnh giới không hợp lệ, server không có trong cache thì báo lỗi", async () =>
	{
		const harness = createHarness();
		harness.tierRoles.set(GUILD, "bac-1", ROLE_KIM_DAN, ADMIN);
		const options = { "canh-gioi": "bac-3", role: fakeRole(ROLE_KIM_DAN) };

		await rejects(harness, { group: "tier", subcommand: "set-role", options }, "Role này đang được gán cho bậc 1. Hãy bỏ gán ở bậc đó trước.");
		await rejects(harness, { group: "tier", subcommand: "set-role", options: { ...options, "canh-gioi": "phi-thang" } }, "Cảnh giới không hợp lệ.");
		await rejects(harness, { group: "tier", subcommand: "set-role", options, cached: false }, "Không đọc được thông tin server. Vui lòng thử lại sau.");
		assert.deepEqual(harness.tierRoles.list(GUILD), [{ tierKey: "bac-1", roleId: ROLE_KIM_DAN, createdByBot: false }]);
	});

	test("clear-role: bỏ role đã gán (nhắc bot không tự gỡ role khỏi người đang có); chưa gán thì báo", async () =>
	{
		const harness = createHarness();
		harness.tierRoles.set(GUILD, "bac-3", ROLE_KIM_DAN, ADMIN);

		const cleared = replyText(await run(harness, { group: "tier", subcommand: "clear-role", options: { "canh-gioi": "bac-3" } }));
		assert.ok(cleared.startsWith(`Đã bỏ <@&${ROLE_KIM_DAN}> khỏi cảnh giới 🟡 **Kim Đan** (từ Level 6).`), cleared);
		assert.ok(cleared.includes("không tự gỡ role đó"));
		assert.deepEqual(harness.tierRoles.list(GUILD), []);
		assert.deepEqual(audits(harness.context, "tier_role").map(entry => entry.action), ["tier_role.set", "tier_role.clear"]);

		const again = replyText(await run(harness, { group: "tier", subcommand: "clear-role", options: { "canh-gioi": "bac-3" } }));
		assert.equal(again, "Cảnh giới 🟡 **Kim Đan** (từ Level 6) chưa được gán role.");
	});

	test("list: đủ 8 cảnh giới với emoji, tên, mốc level, role hoặc \"chưa gán\", ghi chú thời điểm cập nhật role", async () =>
	{
		const harness = createHarness();
		harness.tierRoles.set(GUILD, "bac-3", ROLE_KIM_DAN, ADMIN);
		const embed = replyEmbed(await run(harness, { group: "tier", subcommand: "list" }));

		assert.equal(embed.title, "🏅 Role danh hiệu · bộ Tu tiên (1/8)");
		const lines = (embed.description ?? "").split("\n");
		assert.equal(lines.length, 8);
		assert.equal(lines[0], "🌱 **Luyện Khí** · từ Level 0 · chưa gán");
		assert.equal(lines[2], `🟡 **Kim Đan** · từ Level 6 · <@&${ROLE_KIM_DAN}>`);
		assert.equal(lines[7], "⚡ **Độ Kiếp** · từ Level 40 · chưa gán");
		assert.equal(lines.filter(line => line.endsWith("chưa gán")).length, 7);
		assert.equal(embed.footer?.text, TIER_ROLE_SYNC_NOTE);
	});
});

describe("role cảnh giới không dùng được vào việc khác", () =>
{
	const tierRoleRefusal = (purpose: string): string => `Không thể dùng <@&${ROLE_KIM_DAN}> ${purpose} vì role này đang là role của cảnh giới Kim Đan: `
		+ "bot tự thêm và gỡ role cảnh giới theo level của từng người. Hãy chọn role khác, hoặc bỏ gán bằng `/config tier clear-role` trước.";
	const role = { id: ROLE_KIM_DAN, managed: false };

	test("admin-role, poll role-tao-vote, team add từ chối role đang là role cảnh giới; không lưu gì", async () =>
	{
		const harness = createHarness();
		harness.tierRoles.set(GUILD, "bac-3", ROLE_KIM_DAN, ADMIN);
		const { guildConfig, teams } = harness.context.deps;

		await rejects(harness, { subcommand: "admin-role", options: { role } }, tierRoleRefusal("làm role admin bot"));
		await rejects(harness, { subcommand: "poll", options: { "role-tao-vote": role, "xp-mac-dinh": 8 } }, tierRoleRefusal("làm role tạo vote"));
		await rejects(harness, { group: "team", subcommand: "add", options: { role } }, tierRoleRefusal("làm team"));

		const settings = guildConfig.getSettings(GUILD);
		assert.equal(settings.adminRoleId, null);
		assert.equal(settings.pollCreatorRoleId, null);
		assert.notEqual(settings.defaultPollXp, 8);
		assert.deepEqual(teams.list(GUILD), []);
		assert.deepEqual(audits(harness.context, "config").concat(audits(harness.context, "team")), []);
	});

	test("bỏ gán cảnh giới rồi thì dùng được; role khác không bị ảnh hưởng", async () =>
	{
		const harness = createHarness();
		harness.tierRoles.set(GUILD, "bac-3", ROLE_KIM_DAN, ADMIN);
		replyText(await run(harness, { group: "team", subcommand: "add", options: { role: { id: ROLE_TEAM, managed: false } } }));
		assert.deepEqual(harness.context.deps.teams.list(GUILD), [ROLE_TEAM]);

		harness.tierRoles.clear(GUILD, "bac-3", ADMIN);
		replyText(await run(harness, { subcommand: "admin-role", options: { role } }));
		assert.equal(harness.context.deps.guildConfig.getSettings(GUILD).adminRoleId, ROLE_KIM_DAN);
	});
});

describe("/config board", () =>
{
	test("đặt kênh lần đầu: kiểm tra quyền, defer riêng, lưu kênh, đăng bảng ngay (force), ghi audit", async () =>
	{
		const harness = createHarness();
		const fake = await run(harness, { subcommand: "board", options: { kenh: fakeChannel(CHANNEL_GENERAL) } });

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

		deferredText(await run(harness, { subcommand: "board", options: { kenh: fakeChannel(CHANNEL_GENERAL) } }));
		assert.deepEqual(harness.steps, ["defer", "remove", "refresh", "edit"]);
		assert.deepEqual(harness.removed, [old]);
		assert.deepEqual(harness.channelWhenRemoving, [CHANNEL_GENERAL]);
		assert.deepEqual(harness.liveBoards.get(GUILD)?.messageId, null);
	});

	test("đặt lại đúng kênh đang dùng: bảng cũ chưa đăng được message thì không cần xoá", async () =>
	{
		const harness = createHarness();
		harness.liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		deferredText(await run(harness, { subcommand: "board", options: { kenh: fakeChannel(CHANNEL_GENERAL) } }));
		assert.deepEqual(harness.removed, []);
		assert.equal(harness.refreshCalls.length, 1);
	});

	test("chưa đăng được bảng xếp hạng thì cảnh báo, kênh vẫn được lưu", async () =>
	{
		const harness = createHarness();
		harness.result.refresh = false;
		const text = deferredText(await run(harness, { subcommand: "board", options: { kenh: fakeChannel(CHANNEL_GENERAL) } }));
		assert.ok(text.includes("⚠️ Chưa đăng được bảng xếp hạng"), text);
		assert.equal(harness.liveBoards.get(GUILD)?.channelId, CHANNEL_GENERAL);
	});

	test("bot thiếu quyền ở kênh: báo đủ các quyền thiếu, không defer, không lưu", async () =>
	{
		const harness = createHarness();
		const onlyView = fakeChannel(CHANNEL_GENERAL, [PermissionFlagsBits.ViewChannel]);
		const fake = await rejects(
			harness,
			{ subcommand: "board", options: { kenh: onlyView } },
			`Bot thiếu quyền **Send Messages**, **Attach Files** ở <#${CHANNEL_GENERAL}>. Hãy cấp quyền cho bot ở kênh đó rồi thử lại.`,
		);
		assert.deepEqual(fake.deferred, []);

		const noAttach = fakeChannel(CHANNEL_GENERAL, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);
		await rejects(
			harness,
			{ subcommand: "board", options: { kenh: noAttach } },
			`Bot thiếu quyền **Attach Files** ở <#${CHANNEL_GENERAL}>. Hãy cấp quyền cho bot ở kênh đó rồi thử lại.`,
		);
		assert.equal(harness.liveBoards.get(GUILD), null);
		assert.deepEqual(harness.steps, []);
		assert.deepEqual(audits(harness.context, "board"), []);
	});

	test("người gọi không xem được hoặc không gửi được tin ở kênh: từ chối (không mượn bot đăng vào kênh đó), không defer, không lưu", async () =>
	{
		const harness = createHarness();
		const cases: [bigint[], string][] = [
			[[PermissionFlagsBits.ViewChannel], "**Send Messages**"],
			[[PermissionFlagsBits.SendMessages], "**View Channel**"],
			[[], "**View Channel**, **Send Messages**"],
		];
		for (const [callerPermissions, missing] of cases)
		{
			const fake = await rejects(
				harness,
				{ subcommand: "board", options: { kenh: fakeChannel(CHANNEL_GENERAL, ALL_BOARD_PERMISSIONS, callerPermissions) } },
				`Bạn không có quyền ${missing} ở <#${CHANNEL_GENERAL}>, nên không thể đặt Bảng vàng ở kênh đó.`,
			);
			assert.deepEqual(fake.deferred, []);
		}
		assert.equal(harness.liveBoards.get(GUILD), null);
		assert.deepEqual(harness.steps, []);
		assert.deepEqual(audits(harness.context, "board"), []);
	});

	test("tắt: xoá message bảng cũ, ghi audit; không xoá được thì nói rõ", async () =>
	{
		const harness = createHarness();
		harness.liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		harness.liveBoards.setMessage(GUILD, CHANNEL_GENERAL, MESSAGE_ID);

		const text = deferredText(await run(harness, { subcommand: "board", options: { tat: true } }));
		assert.equal(text, `Đã tắt Bảng vàng và xoá message bảng xếp hạng ở <#${CHANNEL_GENERAL}>.`);
		assert.deepEqual(harness.removed.map(board => [board.channelId, board.messageId]), [[CHANNEL_GENERAL, MESSAGE_ID]]);
		assert.equal(harness.liveBoards.get(GUILD), null);
		assert.deepEqual(audits(harness.context, "board").map(entry => entry.action), ["board.set", "board.clear"]);

		harness.liveBoards.setChannel(GUILD, CHANNEL_BOT, ADMIN);
		harness.liveBoards.setMessage(GUILD, CHANNEL_BOT, MESSAGE_ID);
		harness.result.remove = false;
		const failed = deferredText(await run(harness, { subcommand: "board", options: { tat: true } }));
		assert.ok(failed.startsWith("Đã tắt Bảng vàng. Không xoá được message bảng xếp hạng cũ"), failed);
		assert.equal(harness.liveBoards.get(GUILD), null);
	});

	test("tắt: bảng chưa có message thì không cần xoá; vốn đang tắt thì báo", async () =>
	{
		const harness = createHarness();
		harness.liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		assert.equal(deferredText(await run(harness, { subcommand: "board", options: { tat: true } })), `Đã tắt Bảng vàng ở <#${CHANNEL_GENERAL}>.`);
		assert.deepEqual(harness.removed, []);

		assert.equal(deferredText(await run(harness, { subcommand: "board", options: { tat: true } })), "Bảng vàng vốn đang tắt.");
	});

	test("phải chọn đúng một trong kenh và tat", async () =>
	{
		const harness = createHarness();
		await rejects(
			harness,
			{ subcommand: "board", options: { kenh: fakeChannel(CHANNEL_GENERAL), tat: true } },
			"Chỉ chọn một: `kenh` để đặt Bảng vàng, hoặc `tat` để tắt.",
		);
		await rejects(harness, { subcommand: "board" }, INVALID_BOARD_OPTIONS);
		await rejects(harness, { subcommand: "board", options: { tat: false } }, INVALID_BOARD_OPTIONS);
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
