import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Collection, ComponentType, Guild, GuildMember, Interaction, MessageFlags, PermissionFlagsBits, PermissionsBitField, Role } from "discord.js";
import type Command from "../src/classes/Command";
import type ContextMenu from "../src/classes/ContextMenu";
import type DiscordClient from "../src/classes/DiscordClient";
import InteractionCreate from "../src/events/interactionCreate";
import ButtonHandler from "../src/handlers/ButtonHandler";
import {
	BOT_NEEDS_MANAGE_ROLES,
	CALLER_NEEDS_MANAGE_ROLES,
	SETUP_API_FAILURE,
	SETUP_CHANGED_MEANWHILE,
	SETUP_RUNNING,
	syncTierSetRoles,
	TierRoleActor,
	TierRoleServices,
	TierRoleSetupResult,
} from "../src/discord/tierRoleSetup";
import {
	buildTierPanel,
	buildTierRenameModal,
	buildTierSetupReport,
	INVALID_PANEL_ACTION,
	parseTierPanelId,
	tierPanelReply,
	tierPanelUpdate,
} from "../src/discord/views/tierPanel";
import ConfigCmd from "../src/interactions/commands/config";
import { TIER_KEYS, TIER_SETS, TierKey } from "../src/modules/activity/tiers";
import { TierRoleService } from "../src/modules/gamification/TierRoleService";
import { AppServices } from "../src/services";
import { UserError } from "../src/shared/errors";
import { ADMIN, createTestContext, GUILD, TestContext, USER_A } from "./helpers";

const OWNER = "200000000000000099";
const BOT_USER = "900000000000000001";
const BOT_ROLE = "560000000000000099";
const CALLER_TOP_ROLE = "560000000000000088";
const ADMIN_ROLE = "560000000000000077";
const ROLE_A = "560000000000000001";
const ROLE_B = "560000000000000002";
const ROLE_C = "560000000000000003";
const ROLE_D = "560000000000000004";
const ROLE_E = "560000000000000005";
const ROLE_GONE = "560000000000000006";
const ROLE_H = "560000000000000008";
const NO_PERMISSION = "Bạn không có quyền dùng lệnh này.";
const TU_TIEN = TIER_SETS["tu-tien"];

/** Màu role của bậc (số nguyên RGB). */
function colorOf(hex: string): number
{
	return Number.parseInt(hex.slice(1), 16);
}

// ---------- Server Discord giả ----------

interface RoleSpec
{
	id: string;
	name?: string;
	position?: number;
	managed?: boolean;
	permissions?: bigint[];
	color?: number;
}

interface CreatedRole
{
	name?: string;
	colors?: { primaryColor: number };
	permissions?: unknown;
	hoist?: boolean;
	mentionable?: boolean;
	reason?: string;
}

interface World
{
	guild: Guild;
	/** Role của server (cũng là guild.roles.cache). */
	roles: Map<string, Role>;
	/** Các lần gọi API role theo thứ tự: "create:<tên>", "edit:<id>:<tên>", "delete:<id>". */
	calls: string[];
	created: CreatedRole[];
	bot: { manageRoles: boolean; highest: number };
	/** Tạo role có tên này thì Discord báo lỗi. */
	failCreate: Set<string>;
	/** Sửa role có id này thì Discord báo lỗi. */
	failEdit: Set<string>;
	fetchMeCalls: number;
	/** Chạy trong lúc Discord đang tạo role (trước khi trả kết quả), để mô phỏng thao tác đồng thời. */
	onCreate: ((name: string) => Promise<void> | void) | null;
}

function createWorld(specs: RoleSpec[] = []): World
{
	const roles = new Map<string, Role>();
	const base = { id: GUILD, ownerId: OWNER, channels: { cache: new Map() } };
	const world: World = {
		guild: base as unknown as Guild,
		roles,
		calls: [],
		created: [],
		bot: { manageRoles: true, highest: 50 },
		failCreate: new Set(),
		failEdit: new Set(),
		fetchMeCalls: 0,
		onCreate: null,
	};
	const makeRole = (spec: RoleSpec): Role =>
	{
		const role = {
			id: spec.id,
			name: spec.name ?? "role cũ",
			position: spec.position ?? 1,
			managed: spec.managed ?? false,
			permissions: new PermissionsBitField(spec.permissions ?? []),
			colors: { primaryColor: spec.color ?? 0, secondaryColor: null, tertiaryColor: null },
			guild: base,
			edit: (options: { name: string; colors: { primaryColor: number } }): Promise<unknown> =>
			{
				world.calls.push(`edit:${spec.id}:${options.name}`);
				if (world.failEdit.has(spec.id)) return Promise.reject(new Error("Missing Permissions"));
				role.name = options.name;
				role.colors = { ...role.colors, primaryColor: options.colors.primaryColor };
				return Promise.resolve(role);
			},
			delete: (): Promise<unknown> =>
			{
				world.calls.push(`delete:${spec.id}`);
				roles.delete(spec.id);
				return Promise.resolve(role);
			},
		};
		return role as unknown as Role;
	};
	for (const spec of specs) roles.set(spec.id, makeRole(spec));

	let nextId = 1;
	const botMember = (): GuildMember => ({
		id: BOT_USER,
		permissions: new PermissionsBitField(world.bot.manageRoles ? [PermissionFlagsBits.ManageRoles] : []),
		roles: { highest: { id: BOT_ROLE, position: world.bot.highest } },
	}) as unknown as GuildMember;
	Object.assign(base, {
		roles: {
			cache: roles,
			create: async (options: CreatedRole): Promise<Role> =>
			{
				const name = options.name ?? "";
				world.calls.push(`create:${name}`);
				world.created.push(options);
				if (world.onCreate) await world.onCreate(name);
				if (world.failCreate.has(name)) throw new Error("Missing Permissions");
				const role = makeRole({ id: `57000000000000000${nextId++}`, name, color: options.colors?.primaryColor });
				roles.set(role.id, role);
				return role;
			},
		},
		members: {
			get me(): GuildMember
			{
				return botMember();
			},
			fetchMe: (): Promise<GuildMember> =>
			{
				world.fetchMeCalls++;
				return Promise.resolve(botMember());
			},
		},
	});
	return world;
}

// ---------- Bot, dispatcher và interaction giả ----------

interface Harness
{
	context: TestContext;
	world: World;
	tierRoles: TierRoleService;
	services: AppServices;
	event: InteractionCreate;
}

/** Service thật trên SQLite :memory:, command /config thật, dispatcher thật với ButtonHandler thật. */
function createHarness(world: World = createWorld()): Harness
{
	const context = createTestContext();
	const tierRoles = new TierRoleService(context.db, context.clock, context.deps.audit);
	const services = {
		clock: context.clock,
		guildConfig: context.deps.guildConfig,
		teams: context.deps.teams,
		audit: context.deps.audit,
		tierSets: context.deps.tierSets,
		tierRoles,
	} as unknown as AppServices;
	const client = {
		guildIds: [GUILD],
		services,
		interactions: { commands: new Collection<string, Command>(), contextMenus: new Collection<string, ContextMenu>() },
	} as unknown as DiscordClient;
	client.interactions.commands.set("config", new ConfigCmd(client));
	client.buttons = new ButtonHandler(client);
	return { context, world, tierRoles, services, event: new InteractionCreate(client) };
}

interface CallerSpec
{
	id?: string;
	manageGuild?: boolean;
	manageRoles?: boolean;
	highestPosition?: number;
	roleIds?: string[];
}

type Kind = "button" | "string" | "role" | "modal" | "chat";

interface Call
{
	kind: Kind;
	/** customId của component; với "chat" là tên subcommand của /config tier. */
	id: string;
	values?: string[];
	fields?: Record<string, string>;
	caller?: CallerSpec;
	fromMessage?: boolean;
}

interface Recorded
{
	method: string;
	payload?: unknown;
}

function fakeInteraction(world: World, call: Call): { interaction: Interaction; calls: Recorded[] }
{
	const calls: Recorded[] = [];
	const state = { deferred: false, replied: false };
	const record = (method: string, payload?: unknown): Promise<void> =>
	{
		calls.push({ method, payload });
		return Promise.resolve();
	};
	const callerId = call.caller?.id ?? ADMIN;
	const permissions = new PermissionsBitField([
		...(call.caller?.manageGuild ?? true ? [PermissionFlagsBits.ManageGuild] : []),
		...(call.caller?.manageRoles ?? true ? [PermissionFlagsBits.ManageRoles] : []),
	]);
	const member = {
		id: callerId,
		user: { id: callerId },
		permissions,
		roles: Object.assign([...(call.caller?.roleIds ?? [])], { highest: { id: CALLER_TOP_ROLE, position: call.caller?.highestPosition ?? 40 } }),
	};
	const values = call.values ?? [];
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
		isAnySelectMenu: (): boolean => call.kind === "string" || call.kind === "role",
		isStringSelectMenu: (): boolean => call.kind === "string",
		isRoleSelectMenu: (): boolean => call.kind === "role",
		isModalSubmit: (): boolean => call.kind === "modal",
		isFromMessage: (): boolean => call.fromMessage ?? true,
		isContextMenuCommand: (): boolean => false,
		isAutocomplete: (): boolean => false,
		isCommand: (): boolean => call.kind === "chat",
		isMessageComponent: (): boolean => call.kind !== "modal" && call.kind !== "chat",
		isRepliable: (): boolean => true,
		values,
		roles: new Collection(values.flatMap(id =>
		{
			const role = world.roles.get(id);
			return role ? [[id, role] as const] : [];
		})),
		fields: {
			getTextInputValue: (id: string): string =>
			{
				const value = call.fields?.[id];
				if (value === undefined) throw new Error(`Form thiếu ô "${id}"`);
				return value;
			},
		},
		options: {
			getSubcommandGroup: (): string => "tier",
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
		deferReply: (payload: unknown): Promise<void> =>
		{
			state.deferred = true;
			return record("deferReply", payload);
		},
		editReply: (payload: unknown): Promise<void> =>
		{
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
	const { interaction, calls } = fakeInteraction(harness.world, call);
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

// ---------- Đọc JSON của component ----------

interface JsonNode
{
	type: ComponentType;
	custom_id?: string;
	content?: string;
	label?: string;
	description?: string;
	placeholder?: string;
	value?: string;
	required?: boolean;
	max_length?: number;
	min_values?: number;
	max_values?: number;
	disabled?: boolean;
	accent_color?: number;
	title?: string;
	default_values?: { id: string; type: string }[];
	options?: { label: string; value: string; description?: string; default?: boolean }[];
	components?: JsonNode[];
	component?: JsonNode;
}

function toJson(value: unknown): JsonNode
{
	return JSON.parse(JSON.stringify(value)) as JsonNode;
}

/** Mọi component trong cây (kể cả chính nó và component lồng trong label). */
function flatten(node: JsonNode): JsonNode[]
{
	return [node, ...(node.components ?? []).flatMap(flatten), ...(node.component ? flatten(node.component) : [])];
}

/** Bảng điều khiển trong payload update/editReply (Components V2, đúng một container). */
function panelOf(recorded: Recorded | undefined): JsonNode
{
	assert.ok(recorded, "thiếu payload bảng điều khiển");
	const payload = toJson(recorded.payload) as unknown as { components: JsonNode[]; flags: number; content?: string };
	assert.equal(payload.flags, MessageFlags.IsComponentsV2);
	assert.equal(payload.content, undefined);
	assert.equal(payload.components.length, 1);
	assert.equal(payload.components[0].type, ComponentType.Container);
	return payload.components[0];
}

function nodeById(panel: JsonNode, customId: string): JsonNode
{
	const node = flatten(panel).find(candidate => candidate.custom_id === customId);
	assert.ok(node, `không có component ${customId}`);
	return node;
}

function defaultRoleOf(panel: JsonNode, tierKey: TierKey): string | null
{
	return nodeById(panel, `tierui:role:${tierKey}`).default_values?.[0]?.id ?? null;
}

function panelText(panel: JsonNode): string
{
	return flatten(panel).map(node => node.content ?? "").filter(text => text !== "").join("\n");
}

function audits(context: TestContext, prefix: string): { action: string; targetId: string | null; details: unknown }[]
{
	return context.deps.audit.list(GUILD, 50)
		.filter(entry => entry.action.startsWith(prefix))
		.map(entry => ({ action: entry.action, targetId: entry.targetId, details: entry.details }))
		.reverse();
}

const ACTOR: TierRoleActor = { id: ADMIN, isOwner: false, canManageRoles: true, highestRole: { id: CALLER_TOP_ROLE, position: 40 } };

function servicesOf(harness: Harness): TierRoleServices
{
	return harness.services;
}

// ---------- View ----------

describe("bảng điều khiển danh hiệu: dựng giao diện (hàm thuần)", () =>
{
	test("Components V2: đếm đủ component lồng nhau (35 ≤ 40), customId duy nhất, ≤ 100 ký tự và parse lại được", () =>
	{
		const panel = toJson(buildTierPanel({ set: TU_TIEN, mappings: [] }));
		const nodes = flatten(panel);
		assert.equal(nodes.length, 35);
		assert.ok(nodes.length <= 40);

		const ids = nodes.map(node => node.custom_id).filter((id): id is string => id !== undefined);
		assert.equal(ids.length, 1 + 8 + 4, "1 menu chọn bộ, 8 ô chọn role, 4 nút");
		assert.equal(new Set(ids).size, ids.length);
		for (const id of ids)
		{
			assert.ok(id.length <= 100, id);
			assert.doesNotThrow(() => parseTierPanelId(id), id);
		}
		assert.ok(nodes.filter(node => node.type === ComponentType.ActionRow).every(row => (row.components ?? []).length <= 5));
	});

	test("tiêu đề, bộ đang dùng, mốc level; màu nhấn là màu bậc cao nhất; mỗi bậc một dòng kèm ô chọn role", () =>
	{
		const panel = toJson(buildTierPanel({ set: TU_TIEN, mappings: [{ tierKey: "bac-3", roleId: ROLE_C, createdByBot: false }] }));
		const text = panelText(panel);
		assert.ok(text.startsWith("## 🏅 Bảng điều khiển danh hiệu\nBộ đang dùng: **Tu tiên** · Luyện Khí → Độ Kiếp"), text);
		assert.ok(text.includes("Mốc level: 0 · 3 · 6 · 10 · 15 · 20 · 30 · 40 · Role đã gán: **1/8**"), text);
		assert.ok(text.includes("🟡 **Kim Đan** · từ Level 6"), text);
		assert.equal(panel.accent_color, colorOf(TU_TIEN.tiers[7].color));

		const select = nodeById(panel, "tierui:role:bac-3");
		assert.equal(select.type, ComponentType.RoleSelect);
		assert.equal(select.min_values, 0);
		assert.equal(select.max_values, 1);
		assert.equal(select.placeholder, "Chọn role cho Kim Đan");
		assert.deepEqual(select.default_values, [{ id: ROLE_C, type: "role" }]);
		for (const key of TIER_KEYS.filter(tierKey => tierKey !== "bac-3")) assert.equal(defaultRoleOf(panel, key), null, key);
	});

	test("menu chọn bộ: 5 bộ, mô tả theo bộ, mặc định là bộ đang dùng", () =>
	{
		const panel = toJson(buildTierPanel({ set: TIER_SETS["kiem-hiep"], mappings: [] }));
		const select = nodeById(panel, "tierui:set");
		assert.equal(select.type, ComponentType.StringSelect);
		assert.deepEqual(select.options?.map(option => option.value), ["tu-tien", "rank-game", "kiem-hiep", "cay-xanh", "vu-tru"]);
		assert.deepEqual(select.options?.map(option => option.default ?? false), [false, false, true, false, false]);
		assert.equal(select.options?.[1].description, TIER_SETS["rank-game"].description);
		assert.ok(panelText(panel).includes("🗡️ **Kiếm Khách** · từ Level 3"));
	});

	test("nút ↺ chỉ bấm được khi có tên tuỳ chỉnh; role đã gán mà không còn trong server thì không điền sẵn và có nhắc", () =>
	{
		const plain = toJson(buildTierPanel({ set: TU_TIEN, mappings: [] }));
		assert.equal(nodeById(plain, "tierui:reset").disabled, true);
		assert.equal(nodeById(plain, "tierui:setup").label, "✨ Tạo/đồng bộ role");

		const custom = { ...TU_TIEN, tiers: TU_TIEN.tiers.map(tier => (tier.key === "bac-2" ? { ...tier, name: "Nền Móng" } : tier)) };
		const panel = toJson(buildTierPanel({
			set: custom,
			mappings: [{ tierKey: "bac-2", roleId: ROLE_GONE, createdByBot: true }],
			missingRoleIds: new Set([ROLE_GONE]),
		}));
		assert.equal(nodeById(panel, "tierui:reset").disabled, false);
		assert.equal(defaultRoleOf(panel, "bac-2"), null);
		assert.ok(panelText(panel).includes("🧱 **Nền Móng** · từ Level 3\n-# ⚠️ Role đã gán không còn trong server"));
	});

	test("reply riêng kèm IsComponentsV2; update chỉ kèm IsComponentsV2", () =>
	{
		const data = { set: TU_TIEN, mappings: [] };
		assert.equal(tierPanelReply(data).flags, MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
		assert.equal(tierPanelUpdate(data).flags, MessageFlags.IsComponentsV2);
	});

	test("parseTierPanelId: đọc đúng từng loại, từ chối customId lạ hoặc sai định dạng", () =>
	{
		assert.deepEqual(parseTierPanelId("tierui:set"), { type: "set" });
		assert.deepEqual(parseTierPanelId("tierui:setup"), { type: "setup" });
		assert.deepEqual(parseTierPanelId("tierui:reset"), { type: "reset" });
		assert.deepEqual(parseTierPanelId("tierui:role:bac-8"), { type: "role", tierKey: "bac-8" });
		assert.deepEqual(parseTierPanelId("tierui:rename:2"), { type: "rename", group: 2 });
		assert.deepEqual(parseTierPanelId("tierui:names:1:vu-tru"), { type: "names", group: 1, setKey: "vu-tru" });
		for (const bad of ["tierui", "tierui:", "tierui:role:bac-9", "tierui:role:bac-1:x", "tierui:rename:3", "tierui:names:1", "tierui:names:1:phi-thang", "x:set", " tierui:set"])
		{
			assert.throws(() => parseTierPanelId(bad), { name: "UserError", message: INVALID_PANEL_ACTION }, bad);
		}
	});

	test("form đổi tên: 1 dòng hướng dẫn + 4 ô (điền sẵn tên hiện tại, không bắt buộc), customId mang nhóm và bộ", () =>
	{
		const custom = { ...TU_TIEN, tiers: TU_TIEN.tiers.map(tier => (tier.key === "bac-6" ? { ...tier, name: "Hư Không", emoji: "🌌" } : tier)) };
		const modal = toJson(buildTierRenameModal(custom, 2));
		assert.equal(modal.custom_id, "tierui:names:2:tu-tien");
		assert.equal(modal.title, "Đổi tên bậc 5–8 · bộ Tu tiên");
		assert.equal(modal.components?.length, 5);
		assert.equal(modal.components?.[0].type, ComponentType.TextDisplay);

		const labels = (modal.components ?? []).slice(1);
		assert.deepEqual(labels.map(label => label.label), ["Bậc 5 · từ Level 15", "Bậc 6 · từ Level 20", "Bậc 7 · từ Level 30", "Bậc 8 · từ Level 40"]);
		const inputs = labels.map(label => label.component);
		assert.deepEqual(inputs.map(input => input?.custom_id), ["bac-5", "bac-6", "bac-7", "bac-8"]);
		assert.deepEqual(inputs.map(input => input?.value), ["🔥 Hóa Thần", "🌌 Hư Không", "☯️ Hợp Thể", "⚡ Độ Kiếp"]);
		assert.equal(labels[1].description, "Để trống = tên mặc định: 🌀 Luyện Hư");
		for (const input of inputs)
		{
			assert.equal(input?.type, ComponentType.TextInput);
			assert.equal(input?.required, false);
			assert.ok((input?.max_length ?? 0) >= (input?.value ?? "").length);
		}
	});

	test("báo cáo đồng bộ: số đếm, từng bậc có thay đổi hoặc bị bỏ qua kèm lý do; luôn vừa 2.000 ký tự", () =>
	{
		const tiers = TU_TIEN.tiers;
		const result: TierRoleSetupResult = {
			setKey: "tu-tien",
			entries: [
				{ tier: tiers[0], status: "created", roleId: ROLE_A, reason: null },
				{ tier: tiers[1], status: "recreated", roleId: ROLE_B, reason: null },
				{ tier: tiers[2], status: "renamed", roleId: ROLE_C, reason: null },
				{ tier: tiers[3], status: "unchanged", roleId: ROLE_D, reason: null },
				...tiers.slice(4).map(tier => ({ tier, status: "skipped" as const, roleId: ROLE_E, reason: "x".repeat(600) })),
			],
			summary: { setKey: "tu-tien", created: 2, renamed: 1, skipped: 4 },
		};
		const report = buildTierSetupReport(TU_TIEN, result);
		assert.ok(report.length <= 2000, String(report.length));
		const lines = report.split("\n");
		assert.equal(lines[0], "✨ Đồng bộ role theo bộ **Tu tiên**: tạo mới **2** · đổi tên **1** · giữ nguyên **1** · bỏ qua **4**.");
		assert.equal(lines[1], `• 🌱 **Luyện Khí**: đã tạo <@&${ROLE_A}>`);
		assert.equal(lines[2], `• 🧱 **Trúc Cơ**: role cũ không còn, đã tạo lại <@&${ROLE_B}>`);
		assert.equal(lines[3], `• 🟡 **Kim Đan**: đã đổi tên và màu <@&${ROLE_C}>`);
		assert.ok(lines[4].startsWith(`• 🔥 **Hóa Thần**: bỏ qua <@&${ROLE_E}>. xxx`));
		assert.match(lines[lines.length - 1], /^… và \d+ dòng khác$/);
	});
});

// ---------- Quyền admin của component ----------

describe("bảng điều khiển danh hiệu: quyền", () =>
{
	test("người không phải admin bot bị chặn ở dispatcher với mọi loại component của /config; không đổi gì", async () =>
	{
		const harness = createHarness(createWorld([{ id: ROLE_A, position: 5 }]));
		const denied: Call[] = [
			{ kind: "string", id: "tierui:set", values: ["rank-game"] },
			{ kind: "role", id: "tierui:role:bac-1", values: [ROLE_A] },
			{ kind: "button", id: "tierui:reset" },
			{ kind: "button", id: "tierui:setup" },
			{ kind: "modal", id: "tierui:names:1:tu-tien", fields: { "bac-1": "Phàm Nhân" } },
		];
		for (const call of denied)
		{
			const calls = await dispatch(harness, { ...call, caller: { id: USER_A, manageGuild: false } });
			assert.deepEqual(methods(calls), ["reply"], call.id);
			assert.equal(privateText(calls[0]), NO_PERMISSION);
		}
		assert.equal(harness.context.deps.tierSets.currentKey(GUILD), "tu-tien");
		assert.deepEqual(harness.tierRoles.list(GUILD), []);
		assert.deepEqual(harness.world.calls, []);
		assert.equal(harness.world.fetchMeCalls, 0);
	});

	test("admin bot (role admin) nhưng thiếu Manage Roles: chọn bộ được, gán role thì bị từ chối như lệnh gõ", async () =>
	{
		const harness = createHarness(createWorld([{ id: ROLE_A, position: 5 }]));
		harness.context.deps.guildConfig.updateSettings(GUILD, { adminRoleId: ADMIN_ROLE }, ADMIN);
		const caller: CallerSpec = { id: USER_A, manageGuild: false, manageRoles: false, roleIds: [ADMIN_ROLE] };

		const set = await dispatch(harness, { kind: "string", id: "tierui:set", values: ["cay-xanh"], caller });
		assert.deepEqual(methods(set), ["update"]);
		assert.equal(harness.context.deps.tierSets.currentKey(GUILD), "cay-xanh");

		const role = await dispatch(harness, { kind: "role", id: "tierui:role:bac-1", values: [ROLE_A], caller });
		assert.deepEqual(methods(role), ["deferUpdate", "editReply", "followUp"]);
		assert.equal(privateText(role[2]), CALLER_NEEDS_MANAGE_ROLES);
		assert.equal(defaultRoleOf(panelOf(role[1]), "bac-1"), null, "ô chọn trở về trạng thái chưa gán");
		assert.deepEqual(harness.tierRoles.list(GUILD), []);
		assert.equal(harness.world.fetchMeCalls, 0);

		const setup = await dispatch(harness, { kind: "button", id: "tierui:setup", caller });
		assert.deepEqual(methods(setup), ["reply"]);
		assert.equal(privateText(setup[0]), CALLER_NEEDS_MANAGE_ROLES);
		assert.deepEqual(harness.world.calls, []);
	});

	test("customId không khớp loại component, hoặc form không mở từ bảng điều khiển: báo bảng đã cũ", async () =>
	{
		const harness = createHarness();
		const cases: Call[] = [
			{ kind: "button", id: "tierui:set" },
			{ kind: "button", id: "tierui:role:bac-1" },
			{ kind: "string", id: "tierui:role:bac-1", values: ["rank-game"] },
			{ kind: "role", id: "tierui:set", values: [ROLE_A] },
			{ kind: "string", id: "tierui:setup", values: ["rank-game"] },
			{ kind: "modal", id: "tierui:rename:1" },
			{ kind: "modal", id: "tierui:names:1:tu-tien", fromMessage: false, fields: {} },
			{ kind: "button", id: "tierui:bogus" },
		];
		for (const call of cases)
		{
			const calls = await dispatch(harness, call);
			assert.deepEqual(methods(calls), ["reply"], call.id);
			assert.equal(privateText(calls[0]), INVALID_PANEL_ACTION, call.id);
		}
		assert.equal(harness.context.deps.tierSets.currentKey(GUILD), "tu-tien");
	});
});

// ---------- Luồng thao tác ----------

describe("bảng điều khiển danh hiệu: chọn bộ, gán role, đổi tên", () =>
{
	test("chọn bộ: lưu và ghi audit, cập nhật bảng theo bộ mới; có role gán thì gợi ý bấm ✨; chọn lại bộ cũ thì không gợi ý", async () =>
	{
		const harness = createHarness();
		const first = await dispatch(harness, { kind: "string", id: "tierui:set", values: ["rank-game"] });
		assert.deepEqual(methods(first), ["update"], "chưa có role gán thì không gợi ý");
		const panel = panelOf(first[0]);
		assert.ok(panelText(panel).includes("Bộ đang dùng: **Rank game**"));
		assert.ok(panelText(panel).includes("🟡 **Vàng** · từ Level 6"));
		assert.equal(nodeById(panel, "tierui:set").options?.find(option => option.default)?.value, "rank-game");

		harness.tierRoles.set(GUILD, "bac-1", ROLE_A, ADMIN);
		const second = await dispatch(harness, { kind: "string", id: "tierui:set", values: ["vu-tru"] });
		assert.deepEqual(methods(second), ["update", "followUp"]);
		assert.ok(privateText(second[1]).startsWith("Đã chuyển sang bộ **Vũ trụ**."));
		assert.ok(privateText(second[1]).includes("**✨ Tạo/đồng bộ role**"));

		const same = await dispatch(harness, { kind: "string", id: "tierui:set", values: ["vu-tru"] });
		assert.deepEqual(methods(same), ["update"]);
		assert.deepEqual(audits(harness.context, "tier_set").map(entry => entry.details), [{ from: "tu-tien", to: "rank-game" }, { from: "rank-game", to: "vu-tru" }]);

		const bad = await dispatch(harness, { kind: "string", id: "tierui:set", values: ["phi-thang"] });
		assert.equal(privateText(bad[0]), "Bộ danh hiệu không hợp lệ.");
	});

	test("chọn role cho một bậc: kiểm tra như set-role (tải lại thông tin bot), lưu, vẽ lại bảng với role đã chọn", async () =>
	{
		const harness = createHarness(createWorld([{ id: ROLE_C, position: 5 }]));
		const calls = await dispatch(harness, { kind: "role", id: "tierui:role:bac-3", values: [ROLE_C] });

		assert.deepEqual(methods(calls), ["deferUpdate", "editReply"]);
		assert.equal(defaultRoleOf(panelOf(calls[1]), "bac-3"), ROLE_C);
		assert.equal(harness.world.fetchMeCalls, 1);
		assert.deepEqual(harness.tierRoles.list(GUILD), [{ tierKey: "bac-3", roleId: ROLE_C, createdByBot: false }]);
		assert.deepEqual(audits(harness.context, "tier_role"), [{ action: "tier_role.set", targetId: ROLE_C, details: { tierKey: "bac-3" } }]);
	});

	test("đổi role của bậc: báo riêng role cũ không còn do bot quản lý; bot thiếu Manage Roles thì vẫn lưu và cảnh báo", async () =>
	{
		const world = createWorld([{ id: ROLE_B, position: 4 }, { id: ROLE_C, position: 5 }]);
		const harness = createHarness(world);
		harness.tierRoles.set(GUILD, "bac-3", ROLE_B, ADMIN);
		world.bot.manageRoles = false;

		const calls = await dispatch(harness, { kind: "role", id: "tierui:role:bac-3", values: [ROLE_C] });
		assert.deepEqual(methods(calls), ["deferUpdate", "editReply", "followUp"]);
		const note = privateText(calls[2]);
		assert.ok(note.includes(`Role cũ <@&${ROLE_B}> không còn do bot quản lý`), note);
		assert.ok(note.includes("⚠️ Bot chưa có quyền **Manage Roles**"), note);
		assert.equal(defaultRoleOf(panelOf(calls[1]), "bac-3"), ROLE_C);
	});

	test("xoá lựa chọn (0 giá trị) là bỏ gán: ghi audit, báo riêng bot không tự gỡ role; bậc vốn chưa gán thì không báo gì", async () =>
	{
		const harness = createHarness(createWorld([{ id: ROLE_C, position: 5 }]));
		harness.tierRoles.set(GUILD, "bac-3", ROLE_C, ADMIN);

		const calls = await dispatch(harness, { kind: "role", id: "tierui:role:bac-3", values: [] });
		assert.deepEqual(methods(calls), ["deferUpdate", "editReply", "followUp"]);
		assert.equal(defaultRoleOf(panelOf(calls[1]), "bac-3"), null);
		assert.ok(privateText(calls[2]).startsWith(`Đã bỏ <@&${ROLE_C}> khỏi bậc 🟡 **Kim Đan** (từ Level 6).`));
		assert.deepEqual(harness.tierRoles.list(GUILD), []);
		assert.deepEqual(audits(harness.context, "tier_role").map(entry => entry.action), ["tier_role.set", "tier_role.clear"]);

		const again = await dispatch(harness, { kind: "role", id: "tierui:role:bac-3", values: [] });
		assert.deepEqual(methods(again), ["deferUpdate", "editReply"]);
	});

	test("chọn role không hợp lệ: vẽ lại bảng với role đang gán rồi báo lỗi riêng; không lưu gì", async () =>
	{
		const world = createWorld([
			{ id: ROLE_A, position: 3 },
			{ id: ROLE_B, position: 5, permissions: [PermissionFlagsBits.ManageMessages] },
			{ id: ROLE_C, position: 55 },
			{ id: ROLE_D, position: 45 },
			{ id: ROLE_E, position: 6 },
		]);
		const harness = createHarness(world);
		harness.tierRoles.set(GUILD, "bac-2", ROLE_A, ADMIN);
		harness.context.deps.guildConfig.updateSettings(GUILD, { adminRoleId: ROLE_E }, ADMIN);

		const cases: [string, string, CallerSpec?][] = [
			[ROLE_B, "có quyền quản trị hoặc kiểm duyệt (Manage Messages)"],
			[ROLE_C, "không thấp hơn role cao nhất của bot", { highestPosition: 60 }],
			[ROLE_D, "không thấp hơn role cao nhất của bạn"],
			[ROLE_E, "vì role này đang là role admin bot"],
			[ROLE_A, "Role này đang được gán cho bậc 2"],
		];
		for (const [roleId, reason, caller] of cases)
		{
			const calls = await dispatch(harness, { kind: "role", id: "tierui:role:bac-3", values: [roleId], caller });
			assert.deepEqual(methods(calls), ["deferUpdate", "editReply", "followUp"], roleId);
			assert.equal(defaultRoleOf(panelOf(calls[1]), "bac-3"), null, "ô chọn trở về role đang gán (chưa gán)");
			assert.equal(defaultRoleOf(panelOf(calls[1]), "bac-2"), ROLE_A);
			assert.ok(privateText(calls[2]).includes(reason), `${roleId}: ${privateText(calls[2])}`);
		}

		const unknown = await dispatch(harness, { kind: "role", id: "tierui:role:bac-3", values: ["560000000000000042"] });
		assert.equal(privateText(unknown[2]), "Không tìm thấy role vừa chọn trong server. Vui lòng thử lại.");
		assert.deepEqual(harness.tierRoles.list(GUILD), [{ tierKey: "bac-2", roleId: ROLE_A, createdByBot: false }]);
		assert.deepEqual(audits(harness.context, "tier_role").length, 1);
	});

	test("nút đổi tên mở form của đúng nhóm; lưu form: ô không sửa không thành tên tuỳ chỉnh, ô trống về mặc định, cập nhật bảng", async () =>
	{
		const harness = createHarness();
		const { tierSets } = harness.context.deps;
		tierSets.rename(GUILD, [{ tierKey: "bac-2", name: "Nền Móng", emoji: null }], ADMIN);

		const open = await dispatch(harness, { kind: "button", id: "tierui:rename:1" });
		assert.deepEqual(methods(open), ["showModal"]);
		const modal = toJson(open[0].payload);
		assert.equal(modal.custom_id, "tierui:names:1:tu-tien");
		const prefilled = (modal.components ?? []).slice(1).map(label => label.component?.value);
		assert.deepEqual(prefilled, ["🌱 Luyện Khí", "🧱 Nền Móng", "🟡 Kim Đan", "👶 Nguyên Anh"]);

		const submit = await dispatch(harness, {
			kind: "modal",
			id: "tierui:names:1:tu-tien",
			fields: { "bac-1": "🌱 Luyện Khí", "bac-2": "", "bac-3": "🥇 Kim Đan Pro", "bac-4": "Anh Hài" },
		});
		assert.deepEqual(methods(submit), ["update"]);
		const text = panelText(panelOf(submit[0]));
		assert.ok(text.includes("🧱 **Trúc Cơ** · từ Level 3"), text);
		assert.ok(text.includes("🥇 **Kim Đan Pro** · từ Level 6"), text);
		assert.ok(text.includes("👶 **Anh Hài** · từ Level 10"), text);
		assert.deepEqual(tierSets.overrides(GUILD, "tu-tien"), [
			{ tierKey: "bac-3", name: "Kim Đan Pro", emoji: "🥇" },
			{ tierKey: "bac-4", name: "Anh Hài", emoji: null },
		]);
		assert.deepEqual(audits(harness.context, "tier_name.set").map(entry => (entry.details as { tierKey: string }).tierKey), ["bac-2", "bac-2", "bac-3", "bac-4"]);
	});

	test("form có tên sai: báo lỗi riêng, không đổi tên nào (kể cả ô hợp lệ), không sửa bảng", async () =>
	{
		const harness = createHarness();
		const calls = await dispatch(harness, {
			kind: "modal",
			id: "tierui:names:2:tu-tien",
			fields: { "bac-5": "🔥 Hỏa Thần", "bac-6": "Luyện *Hư*", "bac-7": "", "bac-8": "" },
		});
		assert.deepEqual(methods(calls), ["reply"]);
		assert.ok(privateText(calls[0]).startsWith("Tên bậc không được chứa các ký tự"));
		assert.deepEqual(harness.context.deps.tierSets.overrides(GUILD, "tu-tien"), []);
	});

	test("bộ đã đổi kể từ lúc mở form: không lưu, vẽ lại bảng theo bộ mới và báo mở lại form", async () =>
	{
		const harness = createHarness();
		harness.context.deps.tierSets.select(GUILD, "cay-xanh", ADMIN);
		const calls = await dispatch(harness, {
			kind: "modal",
			id: "tierui:names:1:tu-tien",
			fields: { "bac-1": "Phàm Nhân", "bac-2": "", "bac-3": "", "bac-4": "" },
		});
		assert.deepEqual(methods(calls), ["update", "followUp"]);
		assert.ok(panelText(panelOf(calls[0])).includes("Bộ đang dùng: **Cây xanh**"));
		assert.equal(privateText(calls[1]), "Bộ danh hiệu vừa được đổi trong lúc bạn nhập tên, nên bot chưa lưu gì. Hãy mở lại form đổi tên.");
		assert.deepEqual(harness.context.deps.tierSets.overrides(GUILD, "tu-tien"), []);
		assert.deepEqual(harness.context.deps.tierSets.overrides(GUILD, "cay-xanh"), []);
	});

	test("nút ↺: xoá tên tuỳ chỉnh của bộ đang dùng (giữ của bộ khác), ghi audit, cập nhật bảng", async () =>
	{
		const harness = createHarness();
		const { tierSets } = harness.context.deps;
		tierSets.select(GUILD, "rank-game", ADMIN);
		tierSets.rename(GUILD, [{ tierKey: "bac-1", name: "Sắt", emoji: "⚙️" }], ADMIN);
		tierSets.select(GUILD, "tu-tien", ADMIN);
		tierSets.rename(GUILD, [{ tierKey: "bac-1", name: "Phàm Nhân", emoji: null }], ADMIN);

		const calls = await dispatch(harness, { kind: "button", id: "tierui:reset" });
		assert.deepEqual(methods(calls), ["update"]);
		const panel = panelOf(calls[0]);
		assert.ok(panelText(panel).includes("🌱 **Luyện Khí** · từ Level 0"));
		assert.equal(nodeById(panel, "tierui:reset").disabled, true);
		assert.deepEqual(tierSets.overrides(GUILD, "tu-tien"), []);
		assert.equal(tierSets.overrides(GUILD, "rank-game").length, 1);
		assert.deepEqual(audits(harness.context, "tier_name.reset").map(entry => entry.details), [{ setKey: "tu-tien", count: 1 }]);
	});
});

// ---------- Tạo/đồng bộ role ----------

describe("tạo/đồng bộ role theo bộ danh hiệu", () =>
{
	/**
	 * Server có đủ các trường hợp: bậc 1 role sai tên (đổi tên), bậc 2 role đã bị xoá (tạo lại), bậc 3 role có quyền nguy hiểm
	 * (bỏ qua), bậc 4 role cao hơn bot (bỏ qua), bậc 5 đã đúng tên và màu (giữ nguyên), bậc 6 chưa gán (tạo mới), bậc 7 chưa gán
	 * nhưng Discord từ chối tạo (bỏ qua), bậc 8 Discord từ chối sửa (bỏ qua).
	 */
	function mixedHarness(): Harness
	{
		const world = createWorld([
			{ id: ROLE_A, name: "Tân binh", position: 5 },
			{ id: ROLE_C, name: "Mod", position: 6, permissions: [PermissionFlagsBits.ManageMessages] },
			{ id: ROLE_D, name: "Cao", position: 60 },
			{ id: ROLE_E, name: "🔥 Hóa Thần", position: 7, color: colorOf(TU_TIEN.tiers[4].color) },
			{ id: ROLE_H, name: "Cũ", position: 8 },
		]);
		world.failCreate.add("☯️ Hợp Thể");
		world.failEdit.add(ROLE_H);
		const harness = createHarness(world);
		const mappings: [TierKey, string][] = [["bac-1", ROLE_A], ["bac-2", ROLE_GONE], ["bac-3", ROLE_C], ["bac-4", ROLE_D], ["bac-5", ROLE_E], ["bac-8", ROLE_H]];
		for (const [tierKey, roleId] of mappings) harness.tierRoles.set(GUILD, tierKey, roleId, ADMIN);
		return harness;
	}

	test("nút ✨: đổi tên/màu, tạo mới (không quyền, không hoist, không mentionable), bỏ qua role không an toàn và lỗi API; ghi audit; báo riêng", async (t) =>
	{
		const logged = t.mock.method(console, "error", () => undefined);
		const harness = mixedHarness();
		const { world } = harness;
		const calls = await dispatch(harness, { kind: "button", id: "tierui:setup" });

		assert.deepEqual(methods(calls), ["deferUpdate", "editReply", "followUp"]);
		assert.deepEqual(world.calls, [
			`edit:${ROLE_A}:🌱 Luyện Khí`,
			"create:🧱 Trúc Cơ",
			"create:🌀 Luyện Hư",
			"create:☯️ Hợp Thể",
			`edit:${ROLE_H}:⚡ Độ Kiếp`,
		], "tuần tự từng bậc; bậc 3, 4 không gọi API, bậc 5 đã đúng");
		assert.equal(world.roles.get(ROLE_A)?.name, "🌱 Luyện Khí");
		assert.equal(world.roles.get(ROLE_A)?.colors.primaryColor, colorOf(TU_TIEN.tiers[0].color));
		for (const options of world.created)
		{
			assert.deepEqual(options.permissions, []);
			assert.equal(options.hoist, false);
			assert.equal(options.mentionable, false);
			assert.ok(options.reason?.includes("bộ Tu tiên"), options.reason);
		}
		assert.deepEqual(world.created.map(options => options.colors?.primaryColor), [1, 5, 6].map(index => colorOf(TU_TIEN.tiers[index].color)));

		const mappings = new Map(harness.tierRoles.list(GUILD).map(mapping => [mapping.tierKey, mapping]));
		const recreated = mappings.get("bac-2");
		const created = mappings.get("bac-6");
		assert.ok(recreated && created);
		assert.ok(recreated.roleId !== ROLE_GONE && world.roles.has(recreated.roleId));
		assert.equal(recreated.createdByBot, true);
		assert.equal(created.createdByBot, true);
		assert.equal(mappings.get("bac-1")?.createdByBot, false);
		assert.equal(mappings.has("bac-7"), false);

		assert.deepEqual(audits(harness.context, "tier_role.setup"), [
			{ action: "tier_role.setup", targetId: null, details: { setKey: "tu-tien", created: 2, renamed: 1, skipped: 4 } },
		]);

		const panel = panelOf(calls[1]);
		assert.equal(defaultRoleOf(panel, "bac-6"), created.roleId);
		assert.equal(defaultRoleOf(panel, "bac-2"), recreated.roleId);
		const report = privateText(calls[2]);
		assert.ok(report.startsWith("✨ Đồng bộ role theo bộ **Tu tiên**: tạo mới **2** · đổi tên **1** · giữ nguyên **1** · bỏ qua **4**."), report);
		assert.ok(report.includes(`• 🌱 **Luyện Khí**: đã đổi tên và màu <@&${ROLE_A}>`), report);
		assert.ok(report.includes(`• 🧱 **Trúc Cơ**: role cũ không còn, đã tạo lại <@&${recreated.roleId}>`), report);
		assert.ok(report.includes(`• 🟡 **Kim Đan**: bỏ qua <@&${ROLE_C}>. Không thể dùng <@&${ROLE_C}> làm role danh hiệu`), report);
		assert.ok(report.includes(`• 👶 **Nguyên Anh**: bỏ qua <@&${ROLE_D}>. Bot không quản lý được`), report);
		assert.ok(report.includes(`• ☯️ **Hợp Thể**: bỏ qua. ${SETUP_API_FAILURE}`), report);
		assert.ok(report.includes(`• ⚡ **Độ Kiếp**: bỏ qua <@&${ROLE_H}>. ${SETUP_API_FAILURE}`), report);
		assert.ok(!report.includes("Hóa Thần"), "bậc giữ nguyên không liệt kê");
		assert.equal(logged.mock.callCount(), 2, "mỗi lỗi API ghi một cảnh báo");
	});

	test("đồng bộ theo bộ đang dùng và tên tuỳ chỉnh; chạy lại khi đã đúng thì giữ nguyên, không gọi API sửa", async () =>
	{
		const world = createWorld([{ id: ROLE_A, name: "🌱 Luyện Khí", position: 5, color: colorOf(TU_TIEN.tiers[0].color) }]);
		const harness = createHarness(world);
		harness.tierRoles.set(GUILD, "bac-1", ROLE_A, ADMIN);
		const { tierSets } = harness.context.deps;
		tierSets.select(GUILD, "rank-game", ADMIN);
		tierSets.rename(GUILD, [{ tierKey: "bac-1", name: "Sắt Vụn", emoji: "🔩" }], ADMIN);

		const first = await syncTierSetRoles(world.guild, tierSets.current(GUILD), servicesOf(harness), ACTOR);
		assert.equal(first.entries[0].status, "renamed");
		assert.equal(world.roles.get(ROLE_A)?.name, "🔩 Sắt Vụn");
		assert.equal(world.roles.get(ROLE_A)?.colors.primaryColor, colorOf(TIER_SETS["rank-game"].tiers[0].color));
		assert.deepEqual(first.summary, { setKey: "rank-game", created: 7, renamed: 1, skipped: 0 });

		world.calls.length = 0;
		const second = await syncTierSetRoles(world.guild, tierSets.current(GUILD), servicesOf(harness), ACTOR);
		assert.ok(second.entries.every(entry => entry.status === "unchanged"));
		assert.deepEqual(world.calls, []);
		assert.equal(audits(harness.context, "tier_role.setup").length, 2);
	});

	test("role nằm dưới bot nhưng không dưới role cao nhất của người thao tác: bỏ qua; chủ server thì sửa được", async () =>
	{
		const world = createWorld([{ id: ROLE_A, name: "Cũ", position: 45 }]);
		const harness = createHarness(world);
		harness.tierRoles.set(GUILD, "bac-1", ROLE_A, ADMIN);
		const set = harness.context.deps.tierSets.current(GUILD);

		const result = await syncTierSetRoles(world.guild, set, servicesOf(harness), ACTOR);
		assert.equal(result.entries[0].status, "skipped");
		assert.equal(result.entries[0].reason, `Bạn không sửa được <@&${ROLE_A}> vì role này không thấp hơn role cao nhất của bạn (<@&${CALLER_TOP_ROLE}>). `
			+ "Discord chỉ cho sửa role nằm dưới role cao nhất của mình.");
		assert.equal(world.roles.get(ROLE_A)?.name, "Cũ");

		const owner = await syncTierSetRoles(world.guild, set, servicesOf(harness), { ...ACTOR, id: OWNER, isOwner: true, canManageRoles: false });
		assert.equal(owner.entries[0].status, "renamed");
	});

	test("role đã gán nhưng đang là role team (dữ liệu cũ trước khi có kiểm tra hai chiều): không đổi tên, ghi lý do", async () =>
	{
		const world = createWorld([{ id: ROLE_A, name: "Backend", position: 5 }]);
		const harness = createHarness(world);
		harness.tierRoles.set(GUILD, "bac-1", ROLE_A, ADMIN);
		harness.context.deps.teams.add(GUILD, ROLE_A, ADMIN);

		const result = await syncTierSetRoles(world.guild, harness.context.deps.tierSets.current(GUILD), servicesOf(harness), ACTOR);
		assert.equal(result.entries[0].status, "skipped");
		assert.equal(result.entries[0].reason, `<@&${ROLE_A}> đang là role của một team, nên bot không đổi tên role này. Hãy gán cho bậc này một role riêng.`);
		assert.equal(world.roles.get(ROLE_A)?.name, "Backend");
	});

	test("người thao tác hoặc bot thiếu Manage Roles: UserError, không gọi API, không ghi audit", async () =>
	{
		const world = createWorld();
		const harness = createHarness(world);
		const set = harness.context.deps.tierSets.current(GUILD);

		await assert.rejects(syncTierSetRoles(world.guild, set, servicesOf(harness), { ...ACTOR, canManageRoles: false }), { name: "UserError", message: CALLER_NEEDS_MANAGE_ROLES });
		assert.equal(world.fetchMeCalls, 0);

		world.bot.manageRoles = false;
		await assert.rejects(syncTierSetRoles(world.guild, set, servicesOf(harness), ACTOR), { name: "UserError", message: BOT_NEEDS_MANAGE_ROLES });
		assert.deepEqual(world.calls, []);
		assert.deepEqual(audits(harness.context, "tier_role.setup"), []);

		const button = await dispatch(harness, { kind: "button", id: "tierui:setup" });
		assert.deepEqual(methods(button), ["deferUpdate", "followUp"]);
		assert.equal(privateText(button[1]), BOT_NEEDS_MANAGE_ROLES);

		await assert.rejects(
			syncTierSetRoles(world.guild, set, servicesOf(harness), { ...ACTOR, canManageRoles: false, isOwner: true }),
			(error: unknown) => error instanceof UserError && error.message === BOT_NEEDS_MANAGE_ROLES,
			"chủ server qua được kiểm tra người thao tác, chỉ vướng quyền của bot",
		);
	});

	test("hai lượt đồng bộ cùng lúc ở một server: lượt sau bị từ chối (tránh tạo trùng role); xong thì chạy lại được", async () =>
	{
		const world = createWorld();
		const harness = createHarness(world);
		const set = harness.context.deps.tierSets.current(GUILD);
		let release: () => void = () => undefined;
		const gate = new Promise<void>(resolve =>
		{
			release = resolve;
		});
		world.onCreate = () => gate;

		const first = syncTierSetRoles(world.guild, set, servicesOf(harness), ACTOR);
		await assert.rejects(syncTierSetRoles(world.guild, set, servicesOf(harness), ACTOR), { name: "UserError", message: SETUP_RUNNING });
		release();
		const result = await first;
		assert.equal(result.summary.created, 8);
		assert.equal(world.created.length, 8);

		world.onCreate = null;
		const again = await syncTierSetRoles(world.guild, set, servicesOf(harness), ACTOR);
		assert.ok(again.entries.every(entry => entry.status === "unchanged"));
	});

	test("bậc vừa được gán role khác trong lúc bot đang tạo role: không ghi đè, xoá role vừa tạo", async () =>
	{
		const world = createWorld([{ id: ROLE_B, position: 3 }]);
		const harness = createHarness(world);
		world.onCreate = name =>
		{
			if (name === "🌱 Luyện Khí") harness.tierRoles.set(GUILD, "bac-1", ROLE_B, ADMIN);
		};

		const result = await syncTierSetRoles(world.guild, harness.context.deps.tierSets.current(GUILD), servicesOf(harness), ACTOR);
		assert.deepEqual(result.entries[0], { tier: TU_TIEN.tiers[0], status: "skipped", roleId: ROLE_B, reason: SETUP_CHANGED_MEANWHILE });
		assert.equal(world.calls[1], "delete:570000000000000001");
		assert.equal(harness.tierRoles.list(GUILD)[0].roleId, ROLE_B);
		assert.equal(result.summary.created, 7);
	});

	test("/config tier setup-roles: kiểm tra quyền trước khi defer; defer riêng rồi trả báo cáo", async () =>
	{
		const harness = createHarness();
		const denied = await dispatch(harness, { kind: "chat", id: "setup-roles", caller: { manageRoles: false } });
		assert.deepEqual(methods(denied), ["reply"]);
		assert.equal(privateText(denied[0]), CALLER_NEEDS_MANAGE_ROLES);
		assert.deepEqual(harness.world.calls, []);

		const calls = await dispatch(harness, { kind: "chat", id: "setup-roles" });
		assert.deepEqual(methods(calls), ["deferReply", "editReply"]);
		assert.deepEqual(calls[0].payload, { flags: MessageFlags.Ephemeral });
		assert.ok(String(calls[1].payload).startsWith("✨ Đồng bộ role theo bộ **Tu tiên**: tạo mới **8**"), String(calls[1].payload));
		assert.equal(harness.tierRoles.list(GUILD).length, 8);
		assert.ok(harness.tierRoles.list(GUILD).every(mapping => mapping.createdByBot));
	});

	test("/config tier panel qua dispatcher: role đã gán mà không còn trong server thì không điền sẵn", async () =>
	{
		const harness = createHarness(createWorld([{ id: ROLE_A, position: 3 }]));
		harness.tierRoles.set(GUILD, "bac-1", ROLE_A, ADMIN);
		harness.tierRoles.set(GUILD, "bac-2", ROLE_GONE, ADMIN);
		const calls = await dispatch(harness, { kind: "chat", id: "panel" });
		assert.deepEqual(methods(calls), ["reply"]);
		const payload = toJson(calls[0].payload) as unknown as { flags: number; components: JsonNode[] };
		assert.equal(payload.flags, MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
		assert.equal(defaultRoleOf(payload.components[0], "bac-1"), ROLE_A);
		assert.equal(defaultRoleOf(payload.components[0], "bac-2"), null);
	});
});
