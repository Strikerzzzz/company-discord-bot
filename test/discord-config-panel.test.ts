import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ChannelType, Collection, Guild, Interaction, MessageFlags, PermissionFlagsBits, PermissionsBitField, Role } from "discord.js";
import type Command from "../src/classes/Command";
import type ContextMenu from "../src/classes/ContextMenu";
import type DiscordClient from "../src/classes/DiscordClient";
import { channelModeChangedText } from "../src/discord/views/admin";
import {
	buildPollSettingsModal,
	buildXpSettingsModal,
	ConfigPanelAction,
	ConfigPanelData,
	configPanelId,
	ConfigPanelPage,
	configPanelReply,
	configPanelUpdate,
	INVALID_CONFIG_PANEL,
	XpFormValues,
} from "../src/discord/views/configPanel";
import { INVALID_PANEL_ACTION, TierPanelData, tierPanelReply, tierPanelUpdate } from "../src/discord/views/tierPanel";
import InteractionCreate from "../src/events/interactionCreate";
import ButtonHandler from "../src/handlers/ButtonHandler";
import ConfigCmd, {
	CONFIG_ROLE_CHANGED,
	FORM_UNCHANGED,
	SELECT_AT_LEAST_ONE_ROLE,
	SELECTED_CHANNEL_UNAVAILABLE,
} from "../src/interactions/commands/config";
import { TierRoleService } from "../src/modules/gamification/TierRoleService";
import { LiveBoard, LiveBoardService } from "../src/modules/live-board/LiveBoardService";
import { MAX_TEAMS } from "../src/modules/team/TeamService";
import { AppServices } from "../src/services";
import { ADMIN, CHANNEL_BOT, CHANNEL_GENERAL, createTestContext, GUILD, TestContext, USER_A } from "./helpers";

const OWNER = "200000000000000099";
const BOT_USER = "900000000000000001";
const BOT_ROLE = "560000000000000099";
const CALLER_TOP_ROLE = "560000000000000088";
const ADMIN_ROLE = "560000000000000077";
const ROLE_A = "560000000000000001";
const ROLE_B = "560000000000000002";
const ROLE_C = "560000000000000003";
const ROLE_D = "560000000000000004";
const ROLE_MANAGED = "560000000000000010";
const ROLE_TIER = "560000000000000011";
const ROLE_UNKNOWN = "560000000000000042";
const CHANNEL_C = "400000000000000003";
const CHANNEL_D = "400000000000000004";
const CHANNEL_VOICE = "400000000000000005";
const CHANNEL_FORUM = "400000000000000006";
const CHANNEL_CATEGORY = "400000000000000007";
const CHANNEL_THREAD = "400000000000000008";
const CHANNEL_NO_SEND = "400000000000000009";
const CHANNEL_NO_ATTACH = "400000000000000010";
const CHANNEL_UNKNOWN = "400000000000000042";
const MESSAGE_ID = "600000000000000001";
const NO_PERMISSION = "Bạn không có quyền dùng lệnh này.";
const GENERIC_ERROR = "Đã có lỗi xảy ra khi xử lý yêu cầu. Vui lòng thử lại sau.";
const SELECTED_ROLE_UNAVAILABLE = "Không tìm thấy role vừa chọn trong server. Vui lòng thử lại.";
const ALL_BOARD_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles];
const CALLER_CHANNEL_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];

const id = configPanelId;

// ---------- Server Discord giả ----------

interface ChannelSpec
{
	type?: ChannelType;
	/** Quyền của bot ở kênh. */
	bot?: bigint[];
	/** Quyền của người gọi ở kênh. */
	caller?: bigint[];
}

interface World
{
	guild: Guild;
	/** Role của server (cũng là guild.roles.cache); menu chọn role gửi kèm role lấy từ đây. */
	roles: Map<string, Role>;
	/** Kênh của server (cũng là guild.channels.cache); menu chọn kênh gửi kèm kênh lấy từ đây. */
	channels: Map<string, object>;
}

function addRole(world: World, roleId: string, managed = false): void
{
	world.roles.set(roleId, { id: roleId, managed, name: "role", position: 1, permissions: new PermissionsBitField([]) } as unknown as Role);
}

function addChannel(world: World, channelId: string, spec: ChannelSpec = {}): void
{
	world.channels.set(channelId, {
		id: channelId,
		type: spec.type ?? ChannelType.GuildText,
		permissionsFor: (member: { user: { id: string } }): PermissionsBitField =>
			new PermissionsBitField(member.user.id === BOT_USER ? spec.bot ?? ALL_BOARD_PERMISSIONS : spec.caller ?? CALLER_CHANNEL_PERMISSIONS),
	});
}

function createWorld(): World
{
	const roles = new Map<string, Role>();
	const channels = new Map<string, object>();
	const bot = {
		id: BOT_USER,
		user: { id: BOT_USER },
		permissions: new PermissionsBitField([PermissionFlagsBits.ManageRoles]),
		roles: { highest: { id: BOT_ROLE, position: 50 } },
	};
	const guild = { id: GUILD, ownerId: OWNER, roles: { cache: roles }, channels: { cache: channels }, members: { me: bot } };
	const world: World = { guild: guild as unknown as Guild, roles, channels };
	for (const roleId of [GUILD, ROLE_A, ROLE_B, ROLE_C, ROLE_D, ROLE_TIER, ADMIN_ROLE]) addRole(world, roleId);
	addRole(world, ROLE_MANAGED, true);
	for (const channelId of [CHANNEL_GENERAL, CHANNEL_BOT, CHANNEL_C, CHANNEL_D]) addChannel(world, channelId);
	addChannel(world, CHANNEL_VOICE, { type: ChannelType.GuildVoice });
	addChannel(world, CHANNEL_FORUM, { type: ChannelType.GuildForum });
	addChannel(world, CHANNEL_CATEGORY, { type: ChannelType.GuildCategory });
	addChannel(world, CHANNEL_THREAD, { type: ChannelType.PublicThread });
	addChannel(world, CHANNEL_NO_SEND, { caller: [PermissionFlagsBits.ViewChannel] });
	addChannel(world, CHANNEL_NO_ATTACH, { bot: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
	return world;
}

// ---------- Bot, dispatcher và interaction giả ----------

interface Harness
{
	context: TestContext;
	world: World;
	tierRoles: TierRoleService;
	liveBoards: LiveBoardService;
	event: InteractionCreate;
	/** Thứ tự các bước: phương thức interaction đã gọi, và "refresh"/"remove" của Bảng vàng. */
	steps: string[];
	removed: LiveBoard[];
	/** Kết quả của thao tác Bảng vàng giả; Error = thao tác ném lỗi. */
	board: { refresh: boolean | Error; remove: boolean };
}

/** Service thật trên SQLite :memory:, command /config thật, dispatcher thật với ButtonHandler thật; thao tác message Bảng vàng là fake. */
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
	const client = {
		guildIds: [GUILD],
		services,
		interactions: { commands: new Collection<string, Command>(), contextMenus: new Collection<string, ContextMenu>() },
	} as unknown as DiscordClient;
	const config = new ConfigCmd(client);
	client.interactions.commands.set("config", config);
	client.buttons = new ButtonHandler(client);
	const harness: Harness = {
		context,
		world: createWorld(),
		tierRoles,
		liveBoards,
		event: new InteractionCreate(client),
		steps: [],
		removed: [],
		board: { refresh: true, remove: true },
	};
	config.liveBoardActions = {
		refresh: (actionClient, guildId, options = {}) =>
		{
			assert.equal(actionClient, client);
			assert.equal(guildId, GUILD);
			assert.equal(options.force, true);
			harness.steps.push("refresh");
			const { refresh } = harness.board;
			return refresh instanceof Error ? Promise.reject(refresh) : Promise.resolve(refresh);
		},
		remove: (actionClient, board) =>
		{
			assert.equal(actionClient, client);
			harness.steps.push("remove");
			harness.removed.push(board);
			return Promise.resolve(harness.board.remove);
		},
	};
	return harness;
}

interface CallerSpec
{
	id?: string;
	manageGuild?: boolean;
	roleIds?: string[];
}

type Kind = "button" | "string" | "role" | "channel" | "modal" | "chat";

interface Call
{
	kind: Kind;
	/** customId của component; với "chat" là tên subcommand của /config. */
	id: string;
	values?: string[];
	fields?: Record<string, string>;
	caller?: CallerSpec;
	fromMessage?: boolean;
	/** editReply bị Discord từ chối (tin nhắn riêng đã bị đóng, Unknown Message...). */
	failEditReply?: boolean;
}

interface Recorded
{
	method: string;
	payload?: unknown;
}

function resolved<T>(values: readonly string[], source: Map<string, T>): Collection<string, T>
{
	return new Collection(values.flatMap(value =>
	{
		const item = source.get(value);
		return item === undefined ? [] : [[value, item] as const];
	}));
}

function fakeInteraction(harness: Harness, call: Call): { interaction: Interaction; calls: Recorded[] }
{
	const { world } = harness;
	const calls: Recorded[] = [];
	const state = { deferred: false, replied: false };
	const record = (method: string, payload?: unknown): Promise<void> =>
	{
		calls.push({ method, payload });
		harness.steps.push(method);
		return Promise.resolve();
	};
	const callerId = call.caller?.id ?? ADMIN;
	const permissions = new PermissionsBitField(call.caller?.manageGuild ?? true ? [PermissionFlagsBits.ManageGuild] : []);
	const member = {
		id: callerId,
		user: { id: callerId },
		permissions,
		roles: Object.assign([...(call.caller?.roleIds ?? [])], { highest: { id: CALLER_TOP_ROLE, position: 40 } }),
	};
	const values = call.values ?? [];
	const isSelect = call.kind === "string" || call.kind === "role" || call.kind === "channel";
	const fake = {
		guildId: GUILD,
		commandName: "config",
		customId: call.id,
		user: { id: callerId, bot: false },
		member,
		memberPermissions: permissions,
		guild: world.guild,
		inGuild: (): boolean => true,
		inCachedGuild: (): boolean => true,
		isChatInputCommand: (): boolean => call.kind === "chat",
		isButton: (): boolean => call.kind === "button",
		isAnySelectMenu: (): boolean => isSelect,
		isStringSelectMenu: (): boolean => call.kind === "string",
		isRoleSelectMenu: (): boolean => call.kind === "role",
		isChannelSelectMenu: (): boolean => call.kind === "channel",
		isModalSubmit: (): boolean => call.kind === "modal",
		isFromMessage: (): boolean => call.fromMessage ?? true,
		isContextMenuCommand: (): boolean => false,
		isAutocomplete: (): boolean => false,
		isCommand: (): boolean => call.kind === "chat",
		isMessageComponent: (): boolean => call.kind !== "modal" && call.kind !== "chat",
		isRepliable: (): boolean => true,
		values,
		roles: resolved(values, world.roles),
		channels: resolved(values, world.channels),
		fields: {
			getTextInputValue: (key: string): string =>
			{
				const value = call.fields?.[key];
				if (value === undefined) throw new Error(`Form thiếu ô "${key}"`);
				return value;
			},
		},
		options: {
			getSubcommandGroup: (): null => null,
			getSubcommand: (): string => call.id,
		},
		reply: (payload: unknown): Promise<void> =>
		{
			state.replied = true;
			return record("reply", payload);
		},
		update: (payload: unknown): Promise<void> =>
		{
			state.replied = true;
			return record("update", payload);
		},
		deferUpdate: (): Promise<void> =>
		{
			state.deferred = true;
			return record("deferUpdate");
		},
		editReply: (payload: unknown): Promise<void> =>
		{
			if (call.failEditReply)
			{
				calls.push({ method: "editReply", payload });
				return Promise.reject(Object.assign(new Error("Unknown Message"), { code: 10008 }));
			}
			state.replied = true;
			return record("editReply", payload);
		},
		followUp: (payload: unknown): Promise<void> => record("followUp", payload),
		showModal: (modal: unknown): Promise<void> =>
		{
			state.replied = true;
			return record("showModal", modal);
		},
	};
	Object.defineProperties(fake, {
		deferred: { get: () => state.deferred },
		replied: { get: () => state.replied },
		ephemeral: { get: () => true },
	});
	return { interaction: fake as unknown as Interaction, calls };
}

async function dispatch(harness: Harness, call: Call): Promise<Recorded[]>
{
	const { interaction, calls } = fakeInteraction(harness, call);
	await harness.event.execute(interaction);
	return calls;
}

function methods(calls: readonly Recorded[]): string[]
{
	return calls.map(call => call.method);
}

/** Nội dung tin nhắn riêng (reply hoặc followUp dạng { content, flags: Ephemeral }). */
function privateText(recorded: Recorded | undefined): string
{
	assert.ok(recorded);
	const payload = recorded.payload as { content?: unknown; flags?: unknown };
	assert.equal(payload.flags, MessageFlags.Ephemeral);
	assert.equal(typeof payload.content, "string");
	return String(payload.content);
}

/** Lỗi báo riêng cho người bấm: đúng một tin nhắn riêng, không đụng tới bảng. */
async function refused(harness: Harness, call: Call, message: string): Promise<void>
{
	const calls = await dispatch(harness, call);
	assert.deepEqual(methods(calls), ["reply"], call.id);
	assert.equal(privateText(calls[0]), message, call.id);
}

function toJson(value: unknown): unknown
{
	return JSON.parse(JSON.stringify(value));
}

/** Mọi chữ trong payload (content của TextDisplay, kể cả lồng nhau). */
function textOf(value: unknown): string
{
	if (Array.isArray(value)) return value.map(textOf).join("\n");
	if (typeof value !== "object" || value === null) return "";
	return Object.entries(value).map(([key, item]) => (key === "content" && typeof item === "string" ? item : textOf(item))).join("\n");
}

/** Dữ liệu bảng đọc thẳng từ service thật (độc lập với handler), để so với bảng handler vẽ ra. */
function panelData(harness: Harness, notice: string | null = null): ConfigPanelData
{
	const { guildConfig, teams, tierSets } = harness.context.deps;
	return {
		settings: guildConfig.getSettings(GUILD),
		channels: guildConfig.listChannels(GUILD),
		teams: teams.list(GUILD),
		boardChannelId: harness.liveBoards.get(GUILD)?.channelId ?? null,
		tierSet: tierSets.current(GUILD),
		tierRoleCount: harness.tierRoles.list(GUILD).length,
		notice,
	};
}

/**
 * Payload update/editReply là đúng bảng cấu hình của trang `page` với dữ liệu hiện tại và `notice` (so nguyên JSON với
 * configPanelUpdate, nên không phụ thuộc bố cục chi tiết của bảng); notice có mặt nguyên văn.
 */
function assertPanel(harness: Harness, recorded: Recorded | undefined, page: ConfigPanelPage, notice: string | null = null): void
{
	assert.ok(recorded, "thiếu payload bảng cấu hình");
	const payload = toJson(recorded.payload);
	assert.equal((payload as { flags?: unknown }).flags, MessageFlags.IsComponentsV2);
	assert.deepEqual(payload, toJson(configPanelUpdate(page, panelData(harness, notice))));
	if (notice !== null) assert.ok(textOf(payload).includes(notice), textOf(payload));
}

function audits(context: TestContext, prefix: string): { action: string; targetId: string | null; details: unknown }[]
{
	return context.deps.audit.list(GUILD, 100)
		.filter(entry => entry.action.startsWith(prefix))
		.map(entry => ({ action: entry.action, targetId: entry.targetId, details: entry.details }))
		.reverse();
}

function tierData(harness: Harness): TierPanelData
{
	return { set: harness.context.deps.tierSets.current(GUILD), mappings: harness.tierRoles.list(GUILD), missingRoleIds: new Set() };
}

function tierRoleRefusal(purpose: string): string
{
	return `Không thể dùng <@&${ROLE_TIER}> ${purpose} vì role này đang là role của bậc danh hiệu Kim Đan: `
		+ "bot tự thêm và gỡ role danh hiệu theo level của từng người. Hãy chọn role khác, hoặc bỏ gán bằng `/config tier clear-role` trước.";
}

function button(action: ConfigPanelAction, extra: Partial<Call> = {}): Call
{
	return { kind: "button", id: id(action), ...extra };
}

function xpFields(values: XpFormValues | Record<keyof XpFormValues, string>): Record<string, string>
{
	return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));
}

// ---------- Mở bảng, định tuyến, quyền ----------

describe("bảng cấu hình: mở bảng, định tuyến theo namespace, quyền", () =>
{
	test("/config panel: trả lời riêng bằng Components V2, trang tổng quan với dữ liệu hiện tại", async () =>
	{
		const harness = createHarness();
		harness.context.deps.teams.add(GUILD, ROLE_A, ADMIN);
		harness.liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		const calls = await dispatch(harness, { kind: "chat", id: "panel" });

		assert.deepEqual(methods(calls), ["reply"]);
		const payload = toJson(calls[0].payload) as { flags?: unknown; content?: unknown; embeds?: unknown };
		assert.equal(payload.flags, MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
		assert.equal(payload.content, undefined);
		assert.equal(payload.embeds, undefined);
		assert.deepEqual(payload, toJson(configPanelReply("home", panelData(harness))));
	});

	test("customId `tierui` vẫn đi luồng bảng danh hiệu cũ; customId lạ của mỗi bảng báo đúng thông báo của bảng đó", async () =>
	{
		const harness = createHarness();
		const calls = await dispatch(harness, { kind: "string", id: "tierui:set", values: ["rank-game"] });
		assert.deepEqual(methods(calls), ["update"]);
		assert.equal(harness.context.deps.tierSets.currentKey(GUILD), "rank-game");
		assert.deepEqual(toJson(calls[0].payload), toJson(tierPanelUpdate(tierData(harness))));

		await refused(harness, { kind: "button", id: "tierui:bogus" }, INVALID_PANEL_ACTION);
		await refused(harness, { kind: "button", id: "cfgui:bogus" }, INVALID_CONFIG_PANEL);
	});

	test("customId sai định dạng, không khớp loại component, form không mở từ bảng, trang lạ: báo bảng đã cũ, không ghi gì", async () =>
	{
		const harness = createHarness();
		const xpSave = id({ type: "xpSave", drawn: { xpPerMessage: 10, xpCooldownSeconds: 60, minMessageLength: 5, duplicateWindowSeconds: 300 } });
		const fields = xpFields({ xpPerMessage: 20, xpCooldownSeconds: 60, minMessageLength: 5, duplicateWindowSeconds: 300 });
		const cases: Call[] = [
			{ kind: "button", id: "cfgui:mode:khac" },
			{ kind: "button", id: "cfgui:xpsave:1.2.3" },
			{ kind: "button", id: id({ type: "nav" }) },
			{ kind: "button", id: xpSave },
			{ kind: "button", id: id({ type: "teams", add: true }) },
			{ kind: "string", id: id({ type: "board" }), values: ["home"] },
			{ kind: "string", id: id({ type: "mode", mode: "selected" }), values: ["home"] },
			{ kind: "role", id: id({ type: "channels", enabled: true }), values: [ROLE_A] },
			{ kind: "channel", id: id({ type: "teams", add: true }), values: [CHANNEL_GENERAL] },
			{ kind: "channel", id: id({ type: "adminRole", drawnRoleId: null }), values: [CHANNEL_GENERAL] },
			{ kind: "role", id: id({ type: "board" }), values: [ROLE_A] },
			{ kind: "modal", id: id({ type: "mode", mode: "selected" }), fields },
			{ kind: "modal", id: id({ type: "xpForm" }), fields },
			{ kind: "modal", id: xpSave, fields, fromMessage: false },
			{ kind: "string", id: id({ type: "nav" }), values: ["admin"] },
			{ kind: "string", id: id({ type: "nav" }), values: [] },
		];
		for (const call of cases) await refused(harness, call, INVALID_CONFIG_PANEL);
		assert.deepEqual(harness.context.deps.audit.list(GUILD, 10), []);
		assert.equal(harness.context.deps.guildConfig.getSettings(GUILD).xpPerMessage, 10);
	});

	test("người không phải admin bot bị dispatcher chặn với mọi loại component của bảng cấu hình; không đổi gì", async () =>
	{
		const harness = createHarness();
		harness.liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		const before = harness.context.deps.audit.list(GUILD, 10).length;
		const denied: Call[] = [
			{ kind: "chat", id: "panel" },
			{ kind: "string", id: id({ type: "nav" }), values: ["teams"] },
			button({ type: "mode", mode: "selected" }),
			{ kind: "channel", id: id({ type: "channels", enabled: false }), values: [CHANNEL_GENERAL] },
			{ kind: "role", id: id({ type: "teams", add: true }), values: [ROLE_A] },
			button({ type: "announce", enabled: false }),
			button({ type: "xpForm" }),
			{ kind: "modal", id: id({ type: "pollSave", drawn: { defaultPollXp: 5, pollXpDailyCap: 25, contributionVotePoints: 1 } }), fields: {} },
			{ kind: "role", id: id({ type: "adminRole", drawnRoleId: null }), values: [ROLE_A] },
			{ kind: "role", id: id({ type: "pollRole", drawnRoleId: null }), values: [ROLE_A] },
			{ kind: "channel", id: id({ type: "board" }), values: [CHANNEL_BOT] },
			button({ type: "boardOff" }),
			button({ type: "tierPanel" }),
		];
		for (const call of denied)
		{
			const calls = await dispatch(harness, { ...call, caller: { id: USER_A, manageGuild: false } });
			assert.deepEqual(methods(calls), ["reply"], call.id);
			assert.equal(privateText(calls[0]), NO_PERMISSION, call.id);
		}
		assert.equal(harness.context.deps.audit.list(GUILD, 10).length, before);
		assert.equal(harness.liveBoards.get(GUILD)?.channelId, CHANNEL_GENERAL);
		assert.deepEqual(harness.steps.filter(step => step === "refresh" || step === "remove"), []);
	});

	test("admin bot nhờ role admin (không có Manage Server) dùng được bảng", async () =>
	{
		const harness = createHarness();
		harness.context.deps.guildConfig.updateSettings(GUILD, { adminRoleId: ADMIN_ROLE }, ADMIN);
		const calls = await dispatch(harness, button({ type: "mode", mode: "selected" }, { caller: { id: USER_A, manageGuild: false, roleIds: [ADMIN_ROLE] } }));
		assert.deepEqual(methods(calls), ["update"]);
		assert.equal(harness.context.deps.guildConfig.getSettings(GUILD).xpChannelMode, "selected");
	});
});

// ---------- Trang, chế độ kênh, bật/tắt kênh ----------

describe("bảng cấu hình: chuyển trang, chế độ kênh, bật/tắt XP nhiều kênh", () =>
{
	test("menu chọn trang: vẽ đúng trang được chọn, không có notice, không ghi gì", async () =>
	{
		const harness = createHarness();
		for (const page of ["channels", "teams", "xp", "poll", "board", "home"] as const)
		{
			const calls = await dispatch(harness, { kind: "string", id: id({ type: "nav" }), values: [page] });
			assert.deepEqual(methods(calls), ["update"], page);
			assertPanel(harness, calls[0], page);
		}
		assert.deepEqual(harness.context.deps.audit.list(GUILD, 10), []);
	});

	test("đổi chế độ kênh: lưu, ghi audit, notice giống `/config channel mode`; bấm lại chế độ đang dùng thì chỉ báo lại, không ghi", async () =>
	{
		const harness = createHarness();
		const { guildConfig } = harness.context.deps;
		guildConfig.setChannel(GUILD, CHANNEL_GENERAL, { xpEnabled: true }, ADMIN);

		const changed = await dispatch(harness, button({ type: "mode", mode: "selected" }));
		assert.deepEqual(methods(changed), ["update"]);
		assert.equal(guildConfig.getSettings(GUILD).xpChannelMode, "selected");
		assertPanel(harness, changed[0], "channels", channelModeChangedText("selected", guildConfig.listChannels(GUILD)));
		assert.ok(channelModeChangedText("selected", guildConfig.listChannels(GUILD)).includes("Đang bật **1** kênh"));

		const same = await dispatch(harness, button({ type: "mode", mode: "selected" }));
		assertPanel(harness, same[0], "channels", "Server đang dùng chế độ này rồi: • Kênh tính XP: **chỉ kênh được bật**");

		const back = await dispatch(harness, button({ type: "mode", mode: "all" }));
		assertPanel(harness, back[0], "channels", channelModeChangedText("all", guildConfig.listChannels(GUILD)));
		assert.deepEqual(audits(harness.context, "config.update").map(entry => entry.details), [{ xpChannelMode: "selected" }, { xpChannelMode: "all" }]);
	});

	test("bật nhiều kênh ở chế độ chỉ kênh được bật: ghi audit từng kênh; kênh vốn đã bật được liệt kê riêng; tắt thì kênh chưa bật được nhắc", async () =>
	{
		const harness = createHarness();
		const { guildConfig } = harness.context.deps;
		guildConfig.updateSettings(GUILD, { xpChannelMode: "selected" }, ADMIN);
		const enable = id({ type: "channels", enabled: true });

		const first = await dispatch(harness, { kind: "channel", id: enable, values: [CHANNEL_GENERAL, CHANNEL_FORUM, CHANNEL_VOICE] });
		assert.deepEqual(methods(first), ["update"]);
		assertPanel(harness, first[0], "channels", `Đã bật XP cho <#${CHANNEL_GENERAL}>, <#${CHANNEL_FORUM}>, <#${CHANNEL_VOICE}>.`);
		assert.deepEqual(audits(harness.context, "channel.set"), [
			{ action: "channel.set", targetId: CHANNEL_GENERAL, details: { xpEnabled: true } },
			{ action: "channel.set", targetId: CHANNEL_FORUM, details: { xpEnabled: true } },
			{ action: "channel.set", targetId: CHANNEL_VOICE, details: { xpEnabled: true } },
		]);
		assert.equal(guildConfig.effectiveChannelXp(GUILD, CHANNEL_FORUM).enabled, true);

		const second = await dispatch(harness, { kind: "channel", id: enable, values: [CHANNEL_C, CHANNEL_GENERAL] });
		assertPanel(harness, second[0], "channels", `Đã bật XP cho <#${CHANNEL_C}>.\nVốn đã bật XP: <#${CHANNEL_GENERAL}>.`);

		const disable = await dispatch(harness, { kind: "channel", id: id({ type: "channels", enabled: false }), values: [CHANNEL_GENERAL, CHANNEL_D] });
		assertPanel(harness, disable[0], "channels", `Đã tắt XP cho <#${CHANNEL_GENERAL}>.\nVốn đã tắt XP: <#${CHANNEL_D}>.\n`
			+ "-# Server đang dùng chế độ **chỉ kênh được bật**: kênh chưa được bật riêng vốn không tính XP, chỉ cần tắt kênh đã bật.");
		assert.equal(guildConfig.effectiveChannelXp(GUILD, CHANNEL_GENERAL).enabled, false);
		assert.equal(audits(harness.context, "channel.set").length, 5);
	});

	test("chế độ tất cả kênh: tắt rồi bật lại kênh; bật kênh vốn đang tính XP thì nhắc thao tác không cần thiết", async () =>
	{
		const harness = createHarness();
		const { guildConfig } = harness.context.deps;
		const off = await dispatch(harness, { kind: "channel", id: id({ type: "channels", enabled: false }), values: [CHANNEL_GENERAL] });
		assertPanel(harness, off[0], "channels", `Đã tắt XP cho <#${CHANNEL_GENERAL}>.`);
		assert.equal(guildConfig.effectiveChannelXp(GUILD, CHANNEL_GENERAL).enabled, false);

		const on = await dispatch(harness, { kind: "channel", id: id({ type: "channels", enabled: true }), values: [CHANNEL_GENERAL, CHANNEL_BOT] });
		assertPanel(harness, on[0], "channels", `Đã bật XP cho <#${CHANNEL_GENERAL}>.\nVốn đã bật XP: <#${CHANNEL_BOT}>.\n`
			+ "-# Server đang dùng chế độ **tất cả kênh (trừ kênh đã tắt)**: kênh không bị tắt riêng vốn đã tính XP, chỉ cần bật lại kênh đã tắt.");
		assert.deepEqual(guildConfig.listChannels(GUILD), [], "bật lại kênh ở chế độ tất cả kênh thì xoá cấu hình riêng");
	});

	test("kênh sai loại (category, thread) hoặc không có trong dữ liệu Discord gửi kèm: từ chối, không ghi kênh nào", async () =>
	{
		const harness = createHarness();
		const enable = id({ type: "channels", enabled: true });
		const wrongType = (channelId: string): string => `Không bật/tắt XP được cho <#${channelId}>: chỉ dùng được kênh chữ, kênh thông báo, forum, media, `
			+ "kênh voice hoặc stage (tin trong thread theo kênh cha).";
		await refused(harness, { kind: "channel", id: enable, values: [CHANNEL_GENERAL, CHANNEL_CATEGORY] }, wrongType(CHANNEL_CATEGORY));
		await refused(harness, { kind: "channel", id: id({ type: "channels", enabled: false }), values: [CHANNEL_THREAD] }, wrongType(CHANNEL_THREAD));
		await refused(harness, { kind: "channel", id: enable, values: [CHANNEL_GENERAL, CHANNEL_UNKNOWN] }, SELECTED_CHANNEL_UNAVAILABLE);
		await refused(harness, { kind: "channel", id: enable, values: [] }, "Hãy chọn ít nhất một kênh.");
		assert.deepEqual(harness.context.deps.guildConfig.listChannels(GUILD), []);
		assert.deepEqual(audits(harness.context, "channel"), []);
	});
});

// ---------- Team ----------

describe("bảng cấu hình: team", () =>
{
	test("thêm nhiều role làm team, thêm lại role đã là team, bỏ team: ghi audit từng role, notice liệt kê từng nhóm", async () =>
	{
		const harness = createHarness();
		const { teams } = harness.context.deps;
		const add = id({ type: "teams", add: true });

		const first = await dispatch(harness, { kind: "role", id: add, values: [ROLE_A, ROLE_B] });
		assert.deepEqual(methods(first), ["update"]);
		assertPanel(harness, first[0], "teams", `Đã thêm <@&${ROLE_A}>, <@&${ROLE_B}> làm team. Điểm team chỉ tính từ các lượt kiếm điểm kể từ bây giờ.`);
		assert.deepEqual(teams.list(GUILD), [ROLE_A, ROLE_B]);

		const second = await dispatch(harness, { kind: "role", id: add, values: [ROLE_B, ROLE_C] });
		assertPanel(harness, second[0], "teams", `Đã thêm <@&${ROLE_C}> làm team. Điểm team chỉ tính từ các lượt kiếm điểm kể từ bây giờ.\nVốn đã là team: <@&${ROLE_B}>.`);

		const remove = await dispatch(harness, { kind: "role", id: id({ type: "teams", add: false }), values: [ROLE_B, ROLE_D] });
		assertPanel(harness, remove[0], "teams", `Đã bỏ <@&${ROLE_B}> khỏi danh sách team. Điểm lịch sử vẫn được giữ.\nVốn không phải team: <@&${ROLE_D}>.`);
		assert.deepEqual(teams.list(GUILD), [ROLE_A, ROLE_C]);
		assert.deepEqual(audits(harness.context, "team").map(entry => [entry.action, entry.targetId]), [
			["team.add", ROLE_A], ["team.add", ROLE_B], ["team.add", ROLE_C], ["team.remove", ROLE_B],
		]);
	});

	test("chặn @everyone, role do integration quản lý, role danh hiệu như `/config team add`; có một role sai thì không thêm role nào", async () =>
	{
		const harness = createHarness();
		harness.tierRoles.set(GUILD, "bac-3", ROLE_TIER, ADMIN);
		const add = id({ type: "teams", add: true });
		await refused(harness, { kind: "role", id: add, values: [ROLE_A, GUILD] }, "Không thể dùng @everyone làm team.");
		await refused(harness, { kind: "role", id: add, values: [ROLE_A, ROLE_MANAGED] }, "Không thể dùng role do bot hoặc integration quản lý làm team.");
		await refused(harness, { kind: "role", id: add, values: [ROLE_A, ROLE_TIER] }, tierRoleRefusal("làm team"));
		await refused(harness, { kind: "role", id: add, values: [ROLE_A, ROLE_UNKNOWN] }, SELECTED_ROLE_UNAVAILABLE);
		await refused(harness, { kind: "role", id: add, values: [] }, SELECT_AT_LEAST_ONE_ROLE);
		await refused(harness, { kind: "role", id: id({ type: "teams", add: false }), values: [] }, SELECT_AT_LEAST_ONE_ROLE);
		assert.deepEqual(harness.context.deps.teams.list(GUILD), []);
		assert.deepEqual(audits(harness.context, "team"), []);
	});

	test("vượt MAX_TEAMS sau khi thêm: báo lỗi trước khi ghi, không thêm role nào; role đã là team không tính vào phần thêm", async () =>
	{
		const harness = createHarness();
		const { teams } = harness.context.deps;
		for (let index = 0; index < MAX_TEAMS - 1; index++) teams.add(GUILD, `57000000000000${String(index).padStart(4, "0")}`, ADMIN);
		assert.equal(teams.list(GUILD).length, MAX_TEAMS - 1);
		const add = id({ type: "teams", add: true });

		await refused(harness, { kind: "role", id: add, values: [ROLE_A, ROLE_B] },
			`Chỉ được cấu hình tối đa ${MAX_TEAMS} team: server đang có ${MAX_TEAMS - 1} team, thêm 2 role mới sẽ vượt giới hạn. Bot chưa thêm role nào.`);
		assert.equal(teams.list(GUILD).length, MAX_TEAMS - 1);
		assert.ok(!teams.list(GUILD).includes(ROLE_A));

		teams.add(GUILD, ROLE_C, ADMIN);
		teams.remove(GUILD, "570000000000000000", ADMIN);
		assert.equal(teams.list(GUILD).length, MAX_TEAMS - 1);
		const ok = await dispatch(harness, { kind: "role", id: add, values: [ROLE_C, ROLE_A] });
		assert.deepEqual(methods(ok), ["update"]);
		assert.equal(teams.list(GUILD).length, MAX_TEAMS);
	});
});

// ---------- XP, vote và contribution ----------

describe("bảng cấu hình: thông báo lên level, form XP và vote", () =>
{
	test("công tắc thông báo lên level: lưu, ghi audit, notice; vẽ trang XP", async () =>
	{
		const harness = createHarness();
		const calls = await dispatch(harness, button({ type: "announce", enabled: false }));
		assert.deepEqual(methods(calls), ["update"]);
		assert.equal(harness.context.deps.guildConfig.getSettings(GUILD).levelUpAnnouncements, false);
		assertPanel(harness, calls[0], "xp", "Đã cập nhật cấu hình Activity XP:\n• Thông báo lên level: **Tắt**");
		assert.deepEqual(audits(harness.context, "config.update").map(entry => entry.details), [{ levelUpAnnouncements: false }]);
	});

	test("nút mở form: form XP và form vote điền sẵn giá trị hiện tại (customId mang giá trị lúc mở)", async () =>
	{
		const harness = createHarness();
		const { guildConfig } = harness.context.deps;
		guildConfig.updateSettings(GUILD, { xpPerMessage: 12, pollXpDailyCap: 0 }, ADMIN);

		const xp = await dispatch(harness, button({ type: "xpForm" }));
		assert.deepEqual(methods(xp), ["showModal"]);
		assert.deepEqual(toJson(xp[0].payload), toJson(buildXpSettingsModal(guildConfig.getSettings(GUILD))));

		const poll = await dispatch(harness, button({ type: "pollForm" }));
		assert.deepEqual(methods(poll), ["showModal"]);
		assert.deepEqual(toJson(poll[0].payload), toJson(buildPollSettingsModal(guildConfig.getSettings(GUILD))));
	});

	test("lưu form XP: chỉ ghi ô đã sửa, giữ giá trị người khác vừa đổi ở ô không sửa; đọc được \"1.000\"", async () =>
	{
		const harness = createHarness();
		const { guildConfig } = harness.context.deps;
		const drawn: XpFormValues = { xpPerMessage: 10, xpCooldownSeconds: 60, minMessageLength: 5, duplicateWindowSeconds: 300 };
		guildConfig.updateSettings(GUILD, { xpCooldownSeconds: 30 }, USER_A);

		const calls = await dispatch(harness, {
			kind: "modal",
			id: id({ type: "xpSave", drawn }),
			fields: xpFields({ xpPerMessage: "1.000", xpCooldownSeconds: "60", minMessageLength: " 5 ", duplicateWindowSeconds: "300" }),
		});
		assert.deepEqual(methods(calls), ["update"]);
		const settings = guildConfig.getSettings(GUILD);
		assert.equal(settings.xpPerMessage, 1000);
		assert.equal(settings.xpCooldownSeconds, 30, "ô không sửa không đè giá trị người khác vừa đổi");
		assertPanel(harness, calls[0], "xp", "Đã cập nhật cấu hình Activity XP:\n• XP mỗi tin nhắn: **1.000 XP**");
		assert.deepEqual(audits(harness.context, "config.update").map(entry => entry.details), [{ xpCooldownSeconds: 30 }, { xpPerMessage: 1000 }]);
	});

	test("lưu form không sửa ô nào: không ghi, notice báo không có gì thay đổi", async () =>
	{
		const harness = createHarness();
		const drawn: XpFormValues = { xpPerMessage: 10, xpCooldownSeconds: 60, minMessageLength: 5, duplicateWindowSeconds: 300 };
		const calls = await dispatch(harness, { kind: "modal", id: id({ type: "xpSave", drawn }), fields: xpFields(drawn) });
		assertPanel(harness, calls[0], "xp", FORM_UNCHANGED);
		assert.deepEqual(harness.context.deps.audit.list(GUILD, 10), []);
	});

	test("form có số sai (chữ, vượt giới hạn, số âm): báo lỗi riêng, không ghi ô nào kể cả ô hợp lệ, không sửa bảng", async () =>
	{
		const harness = createHarness();
		const drawn: XpFormValues = { xpPerMessage: 10, xpCooldownSeconds: 60, minMessageLength: 5, duplicateWindowSeconds: 300 };
		const save = id({ type: "xpSave", drawn });
		const cases: [Record<keyof XpFormValues, string>, string][] = [
			[{ xpPerMessage: "20", xpCooldownSeconds: "90000", minMessageLength: "5", duplicateWindowSeconds: "300" }, "Cooldown (giây) phải là số nguyên từ 0 đến 86400 (bạn nhập \"90000\")."],
			[{ xpPerMessage: "20", xpCooldownSeconds: "60", minMessageLength: "5", duplicateWindowSeconds: "abc" }, "Khoảng chống trùng (giây) phải là số nguyên từ 0 đến 86400 (bạn nhập \"abc\")."],
			[{ xpPerMessage: "-1", xpCooldownSeconds: "60", minMessageLength: "5", duplicateWindowSeconds: "300" }, "XP mỗi tin nhắn phải là số nguyên từ 0 đến 1000 (bạn nhập \"-1\")."],
		];
		for (const [fields, message] of cases) await refused(harness, { kind: "modal", id: save, fields: xpFields(fields) }, message);
		assert.equal(harness.context.deps.guildConfig.getSettings(GUILD).xpPerMessage, 10);
		assert.deepEqual(harness.context.deps.audit.list(GUILD, 10), []);
	});

	test("lưu form vote và contribution: ghi các ô đã sửa theo thứ tự cố định, vẽ trang vote", async () =>
	{
		const harness = createHarness();
		const drawn = { defaultPollXp: 5, pollXpDailyCap: 25, contributionVotePoints: 1 };
		const calls = await dispatch(harness, {
			kind: "modal",
			id: id({ type: "pollSave", drawn }),
			fields: { defaultPollXp: "5", pollXpDailyCap: "0", contributionVotePoints: "3" },
		});
		assert.deepEqual(methods(calls), ["update"]);
		assertPanel(harness, calls[0], "poll",
			"Đã cập nhật cấu hình vote và contribution:\n• Giới hạn XP từ vote mỗi ngày: **không giới hạn**\n• Điểm mỗi lượt ghi nhận: **3 điểm**");
		assert.deepEqual(audits(harness.context, "config.update").map(entry => entry.details), [{ pollXpDailyCap: 0, contributionVotePoints: 3 }]);
	});
});

// ---------- Role tạo vote và role admin ----------

describe("bảng cấu hình: role tạo vote và role admin bot", () =>
{
	test("role tạo vote: chọn là đặt; bỏ chọn khi vẫn đúng role lúc vẽ bảng là xoá; vốn chưa đặt thì không ghi", async () =>
	{
		const harness = createHarness();
		const { guildConfig } = harness.context.deps;

		const set = await dispatch(harness, { kind: "role", id: id({ type: "pollRole", drawnRoleId: null }), values: [ROLE_A] });
		assert.deepEqual(methods(set), ["update"]);
		assert.equal(guildConfig.getSettings(GUILD).pollCreatorRoleId, ROLE_A);
		assertPanel(harness, set[0], "poll", `Đã cập nhật cấu hình vote:\n• Role tạo vote: **<@&${ROLE_A}>**`);

		const clear = await dispatch(harness, { kind: "role", id: id({ type: "pollRole", drawnRoleId: ROLE_A }), values: [] });
		assert.equal(guildConfig.getSettings(GUILD).pollCreatorRoleId, null);
		assertPanel(harness, clear[0], "poll", "Đã cập nhật cấu hình vote:\n• Role tạo vote: **chưa đặt (chỉ admin)**");

		const again = await dispatch(harness, { kind: "role", id: id({ type: "pollRole", drawnRoleId: null }), values: [] });
		assertPanel(harness, again[0], "poll", "Không có gì thay đổi:\n• Role tạo vote: **chưa đặt (chỉ admin)**");
		assert.deepEqual(audits(harness.context, "config.update").map(entry => entry.details), [{ pollCreatorRoleId: ROLE_A }, { pollCreatorRoleId: null }]);
	});

	test("bỏ chọn trên bảng cũ (role đã bị đổi sau khi vẽ): vẽ lại bảng theo dữ liệu mới, báo riêng, không xoá", async () =>
	{
		const harness = createHarness();
		const { guildConfig } = harness.context.deps;
		guildConfig.updateSettings(GUILD, { pollCreatorRoleId: ROLE_B, adminRoleId: ROLE_B }, USER_A);

		for (const action of [
			{ type: "pollRole", drawnRoleId: ROLE_A },
			{ type: "pollRole", drawnRoleId: null },
			{ type: "adminRole", drawnRoleId: ROLE_A },
			{ type: "adminRole", drawnRoleId: null },
		] as const)
		{
			const calls = await dispatch(harness, { kind: "role", id: id(action), values: [] });
			assert.deepEqual(methods(calls), ["update", "followUp"], id(action));
			assertPanel(harness, calls[0], action.type === "pollRole" ? "poll" : "board");
			assert.equal(privateText(calls[1]), CONFIG_ROLE_CHANGED);
		}
		const settings = guildConfig.getSettings(GUILD);
		assert.equal(settings.pollCreatorRoleId, ROLE_B);
		assert.equal(settings.adminRoleId, ROLE_B);
		assert.equal(audits(harness.context, "config.update").length, 1);
	});

	test("role admin bot: đặt kèm nhắc cho phép role trong Integrations; bỏ chọn khi vẫn đúng role lúc vẽ bảng là xoá", async () =>
	{
		const harness = createHarness();
		const { guildConfig } = harness.context.deps;

		const set = await dispatch(harness, { kind: "role", id: id({ type: "adminRole", drawnRoleId: null }), values: [ROLE_C] });
		assert.deepEqual(methods(set), ["update"]);
		assert.equal(guildConfig.getSettings(GUILD).adminRoleId, ROLE_C);
		const notice = `Đã đặt <@&${ROLE_C}> làm role admin bot. Người có quyền Manage Server vẫn luôn là admin.\n`
			+ "⚠️ Lưu ý: `/admin` và `/config` mặc định chỉ dành cho người có quyền Manage Server; Discord chặn những người khác trước khi lệnh tới bot. "
			+ "Để role này dùng được, vào **Server Settings → Integrations → chọn bot** rồi cho phép role này dùng `/admin` và `/config`.";
		assertPanel(harness, set[0], "board", notice);

		const clear = await dispatch(harness, { kind: "role", id: id({ type: "adminRole", drawnRoleId: ROLE_C }), values: [] });
		assert.equal(guildConfig.getSettings(GUILD).adminRoleId, null);
		assertPanel(harness, clear[0], "board", "Đã xoá role admin bot. Chỉ người có quyền Manage Server dùng được lệnh admin.");
	});

	test("role tạo vote và role admin chặn @everyone, role integration, role danh hiệu như lệnh gõ; không ghi gì", async () =>
	{
		const harness = createHarness();
		harness.tierRoles.set(GUILD, "bac-3", ROLE_TIER, ADMIN);
		const cases: [ConfigPanelAction, string][] = [
			[{ type: "pollRole", drawnRoleId: null }, "làm role tạo vote"],
			[{ type: "adminRole", drawnRoleId: null }, "làm role admin bot"],
		];
		for (const [action, purpose] of cases)
		{
			await refused(harness, { kind: "role", id: id(action), values: [GUILD] }, `Không thể dùng @everyone ${purpose}.`);
			await refused(harness, { kind: "role", id: id(action), values: [ROLE_MANAGED] }, `Không thể dùng role do bot hoặc integration quản lý ${purpose}.`);
			await refused(harness, { kind: "role", id: id(action), values: [ROLE_TIER] }, tierRoleRefusal(purpose));
			await refused(harness, { kind: "role", id: id(action), values: [ROLE_UNKNOWN] }, SELECTED_ROLE_UNAVAILABLE);
		}
		const settings = harness.context.deps.guildConfig.getSettings(GUILD);
		assert.equal(settings.pollCreatorRoleId, null);
		assert.equal(settings.adminRoleId, null);
		assert.deepEqual(audits(harness.context, "config"), []);
	});
});

// ---------- Bảng vàng, bảng danh hiệu ----------

describe("bảng cấu hình: Bảng vàng và bảng danh hiệu", () =>
{
	test("chọn kênh Bảng vàng: defer, lưu kênh, đăng bảng ngay, rồi vẽ lại bảng kèm kết quả; chuyển kênh thì xoá message bảng cũ", async () =>
	{
		const harness = createHarness();
		const calls = await dispatch(harness, { kind: "channel", id: id({ type: "board" }), values: [CHANNEL_GENERAL] });
		assert.deepEqual(methods(calls), ["deferUpdate", "editReply"]);
		assert.deepEqual(harness.steps, ["deferUpdate", "refresh", "editReply"]);
		assert.equal(harness.liveBoards.get(GUILD)?.channelId, CHANNEL_GENERAL);
		assertPanel(harness, calls[1], "board", `Đã đặt Bảng vàng ở <#${CHANNEL_GENERAL}>. Bot giữ một message bảng xếp hạng ở đó và tự cập nhật định kỳ.`);
		assert.deepEqual(audits(harness.context, "board"), [{ action: "board.set", targetId: CHANNEL_GENERAL, details: null }]);

		harness.liveBoards.setMessage(GUILD, CHANNEL_GENERAL, MESSAGE_ID);
		const old = harness.liveBoards.get(GUILD);
		harness.steps.length = 0;
		harness.board.refresh = false;
		const moved = await dispatch(harness, { kind: "channel", id: id({ type: "board" }), values: [CHANNEL_BOT] });
		assert.deepEqual(harness.steps, ["deferUpdate", "remove", "refresh", "editReply"]);
		assert.deepEqual(harness.removed, [old]);
		assertPanel(harness, moved[1], "board", `Đã đặt Bảng vàng ở <#${CHANNEL_BOT}>. Bot giữ một message bảng xếp hạng ở đó và tự cập nhật định kỳ.\n`
			+ "⚠️ Chưa đăng được bảng xếp hạng lên kênh này (xem log của bot). Bot sẽ thử lại ở lần cập nhật định kỳ tiếp theo.");
	});

	test("người gọi hoặc bot thiếu quyền ở kênh, kênh sai loại hoặc không có trong cache: báo lỗi trước khi defer, không lưu", async () =>
	{
		const harness = createHarness();
		const board = id({ type: "board" });
		await refused(harness, { kind: "channel", id: board, values: [CHANNEL_NO_SEND] },
			`Bạn không có quyền **Send Messages** ở <#${CHANNEL_NO_SEND}>, nên không thể đặt Bảng vàng ở kênh đó.`);
		await refused(harness, { kind: "channel", id: board, values: [CHANNEL_NO_ATTACH] },
			`Bot thiếu quyền **Attach Files** ở <#${CHANNEL_NO_ATTACH}>. Hãy cấp quyền cho bot ở kênh đó rồi thử lại.`);
		await refused(harness, { kind: "channel", id: board, values: [CHANNEL_VOICE] },
			`Bảng vàng chỉ đặt được ở kênh chữ hoặc kênh thông báo; <#${CHANNEL_VOICE}> không phải loại kênh này.`);
		await refused(harness, { kind: "channel", id: board, values: [CHANNEL_UNKNOWN] }, SELECTED_CHANNEL_UNAVAILABLE);
		await refused(harness, { kind: "channel", id: board, values: [] }, SELECTED_CHANNEL_UNAVAILABLE);
		assert.equal(harness.liveBoards.get(GUILD), null);
		assert.deepEqual(harness.steps, ["reply", "reply", "reply", "reply", "reply"]);
		assert.deepEqual(audits(harness.context, "board"), []);
	});

	test("đăng bảng lỗi sau khi defer: vẫn vẽ lại bảng rồi mới báo lỗi riêng; vẽ lại lỗi thì chỉ ghi cảnh báo", async (t) =>
	{
		const logged = t.mock.method(console, "error", () => undefined);
		const harness = createHarness();
		harness.board.refresh = new Error("Discord 500");
		const failed = await dispatch(harness, { kind: "channel", id: id({ type: "board" }), values: [CHANNEL_GENERAL] });
		assert.deepEqual(methods(failed), ["deferUpdate", "editReply", "followUp"]);
		assertPanel(harness, failed[1], "board");
		assert.equal(privateText(failed[2]), GENERIC_ERROR);
		assert.equal(logged.mock.callCount(), 1);

		harness.board.refresh = true;
		const redrawFailed = await dispatch(harness, { kind: "channel", id: id({ type: "board" }), values: [CHANNEL_BOT], failEditReply: true });
		assert.deepEqual(methods(redrawFailed), ["deferUpdate", "editReply"]);
		assert.equal(harness.liveBoards.get(GUILD)?.channelId, CHANNEL_BOT);
		assert.equal(logged.mock.callCount(), 2);
		assert.match(String(logged.mock.calls[1].arguments[0]), /\[WARN\] Không vẽ lại được bảng cấu hình/);
	});

	test("nút tắt Bảng vàng: defer, tắt và xoá message bảng cũ, vẽ lại bảng kèm kết quả; vốn đang tắt thì báo", async () =>
	{
		const harness = createHarness();
		harness.liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		harness.liveBoards.setMessage(GUILD, CHANNEL_GENERAL, MESSAGE_ID);

		const calls = await dispatch(harness, button({ type: "boardOff" }));
		assert.deepEqual(harness.steps, ["deferUpdate", "remove", "editReply"]);
		assert.deepEqual(harness.removed.map(board => [board.channelId, board.messageId]), [[CHANNEL_GENERAL, MESSAGE_ID]]);
		assert.equal(harness.liveBoards.get(GUILD), null);
		assertPanel(harness, calls[1], "board", `Đã tắt Bảng vàng và xoá message bảng xếp hạng ở <#${CHANNEL_GENERAL}>.`);
		assert.deepEqual(audits(harness.context, "board").map(entry => entry.action), ["board.set", "board.clear"]);

		const again = await dispatch(harness, button({ type: "boardOff" }));
		assert.deepEqual(methods(again), ["deferUpdate", "editReply"]);
		assertPanel(harness, again[1], "board", "Bảng vàng vốn đang tắt.");
	});

	test("nút mở bảng danh hiệu: gửi bảng danh hiệu trong tin nhắn riêng mới, không thay bảng cấu hình", async () =>
	{
		const harness = createHarness();
		const calls = await dispatch(harness, button({ type: "tierPanel" }));
		assert.deepEqual(methods(calls), ["reply"]);
		const payload = toJson(calls[0].payload) as { flags?: unknown };
		assert.equal(payload.flags, MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
		assert.deepEqual(payload, toJson(tierPanelReply(tierData(harness))));
	});
});
