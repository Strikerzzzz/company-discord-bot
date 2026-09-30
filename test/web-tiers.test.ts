import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Collection, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import type { Role } from "discord.js";
import { CALLER_NEEDS_MANAGE_ROLES } from "../src/discord/tierRoleSetup";
import { tierNamesFingerprint } from "../src/discord/views/tierPanel";
import { TIER_KEYS, TierKey } from "../src/modules/activity/tiers";
import { escapeHtml } from "../src/web/html";
import type { WebResponse } from "../src/web/http";
import {
	DUPLICATE_ROLE,
	FORM_INVALID,
	INVALID_TIER_SET,
	NAME_TOO_LONG,
	NAMES_CHANGED,
	NAMES_SET_CHANGED,
	NOTHING_SAVED,
	RESET_SET_CHANGED,
	ROLE_CHANGED,
	SELECTED_ROLE_UNAVAILABLE,
	SET_CHANGED,
} from "../src/web/pages/tiers";
import { GUILD } from "./helpers";
import {
	addRole,
	ADMIN_USER,
	BOT_ID,
	call,
	createWebHarness,
	FakeRoleSpec,
	LoggedIn,
	login,
	ROLE_ADMIN_BOT,
	ROLE_ADMIN_USER,
	ROLE_MANAGED,
	ROLE_TEAM_A,
	setMember,
	WebHarness,
} from "./web-helpers";

const BOT_TOP_ROLE = "520000000000000099";
const ROLE_TIER_1 = "520000000000000001";
const ROLE_TIER_2 = "520000000000000002";
const ROLE_EVIL = "520000000000000003";
const ROLE_HIGH = "520000000000000004";
const ROLE_MOD = "520000000000000005";
const ROLE_BOT_MADE = "520000000000000006";
const ROLE_BOT_MADE_2 = "520000000000000007";
const ROLE_GONE = "520000000000000077";
const EVIL_NAME = "<img src=x onerror=alert(1)>";
/** Có Manage Server và Manage Roles, role cao nhất là ROLE_MOD (vị trí 10); không phải chủ server. */
const MOD_USER = "310000000000000009";

// ---------- Server Discord giả: bổ sung những gì tierRoleSetup cần ----------

interface TierTest
{
	harness: WebHarness;
	/** Các lần gọi API role theo thứ tự: "create:<tên>", "edit:<id>:<tên>", "delete:<id>". */
	calls: string[];
	/**
	 * Bot giả: quyền Manage Roles và vị trí role cao nhất (dùng cho cả members.me và fetchMe); `fetchesLeft` là số lần fetchMe
	 * còn thành công (hết thì fetchMe lỗi như lỗi mạng).
	 */
	bot: { manageRoles: boolean; highest: number; fetchesLeft: number };
}

function roleColors(primaryColor: number): object
{
	return { primaryColor, secondaryColor: null, tertiaryColor: null };
}

/** Thêm vào role giả các trường và thao tác mà kiểm tra an toàn, đổi tên và xoá role đọc tới. */
function equipRole(t: TierTest, role: Role, color = 0): void
{
	Object.assign(role, {
		mentionable: false,
		colors: roleColors(color),
		edit: (options: { name: string; colors: { primaryColor: number } }): Promise<Role> =>
		{
			t.calls.push(`edit:${role.id}:${options.name}`);
			Object.assign(role, { name: options.name, colors: roleColors(options.colors.primaryColor) });
			return Promise.resolve(role);
		},
		delete: (): Promise<Role> =>
		{
			t.calls.push(`delete:${role.id}`);
			t.harness.world.roles.delete(role.id);
			return Promise.resolve(role);
		},
	});
}

function addTestRole(t: TierTest, spec: FakeRoleSpec): void
{
	addRole(t.harness.world, spec);
	const role = t.harness.world.roles.get(spec.id);
	if (role) equipRole(t, role, spec.color ?? 0);
}

/**
 * Harness web thật (service thật trên SQLite :memory:, mọi trang) cộng phần giả cho role danh hiệu: guild.roles.create,
 * role.edit/delete, members.fetchMe (bot có Manage Roles, role cao nhất ở vị trí 50), phân quyền riêng của kênh (rỗng).
 * Role thêm sẵn: ROLE_TIER_1/2 (vị trí 1), ROLE_EVIL (tên độc hại), ROLE_HIGH (vị trí 20), ROLE_MOD (vị trí 10), ROLE_BOT_MADE.
 */
function createTierTest(): TierTest
{
	const harness = createWebHarness();
	const t: TierTest = { harness, calls: [], bot: { manageRoles: true, highest: 50, fetchesLeft: Infinity } };
	const { world } = harness;
	for (const role of world.roles.values()) equipRole(t, role);
	for (const channel of world.channels.values()) Object.assign(channel, { permissionOverwrites: { cache: new Collection() } });

	const botMember = (): object => ({
		id: BOT_ID,
		permissions: new PermissionsBitField(t.bot.manageRoles ? [PermissionFlagsBits.ManageRoles] : []),
		roles: { highest: { id: BOT_TOP_ROLE, position: t.bot.highest } },
	});
	Object.assign(world.guild.members, {
		fetchMe: (): Promise<object> =>
		{
			if (t.bot.fetchesLeft <= 0) return Promise.reject(new Error("lỗi mạng giả"));
			t.bot.fetchesLeft--;
			return Promise.resolve(botMember());
		},
	});
	Object.defineProperty(world.guild.members, "me", { get: botMember, configurable: true });

	let nextId = 1;
	Object.assign(world.guild.roles, {
		create: (options: { name: string; colors: { primaryColor: number } }): Promise<Role> =>
		{
			const id = `53000000000000000${nextId++}`;
			t.calls.push(`create:${options.name}`);
			addTestRole(t, { id, name: options.name, position: 1, color: options.colors.primaryColor });
			const role = world.roles.get(id);
			return role ? Promise.resolve(role) : Promise.reject(new Error("không tạo được role giả"));
		},
	});

	addTestRole(t, { id: ROLE_TIER_1, name: "Danh hiệu 1", position: 1 });
	addTestRole(t, { id: ROLE_TIER_2, name: "Danh hiệu 2", position: 1 });
	addTestRole(t, { id: ROLE_EVIL, name: EVIL_NAME, position: 1 });
	addTestRole(t, { id: ROLE_HIGH, name: "Cao", position: 20 });
	addTestRole(t, { id: ROLE_MOD, name: "Mod", position: 10 });
	addTestRole(t, { id: ROLE_BOT_MADE, name: "🌱 Luyện Khí", position: 1 });
	setMember(world, {
		id: MOD_USER,
		displayName: "Mod",
		permissions: [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles],
		roleIds: [ROLE_MOD],
	});
	return t;
}

// ---------- Trình duyệt giả: đọc trang, điền form, gửi, đọc flash ----------

const PAGE = `/g/${GUILD}/tiers`;

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: "\"", "#39": "'" };

function unescapeHtml(text: string): string
{
	return text.replace(/&(amp|lt|gt|quot|#39);/gu, (entity, name: string) => ENTITIES[name] ?? entity);
}

function attr(tag: string, name: string): string | null
{
	const value = new RegExp(`\\s${name}="([^"]*)"`, "u").exec(tag)?.[1];
	return value === undefined ? null : unescapeHtml(value);
}

/** Giá trị trình duyệt sẽ gửi của form có action `path`: input (radio chỉ khi được chọn) và select (lựa chọn đang chọn). */
function formFields(body: string, path: string): Record<string, string>
{
	const start = body.indexOf(`action="${PAGE}${path}"`);
	assert.ok(start >= 0, `không có form ${path}`);
	const form = body.slice(start, body.indexOf("</form>", start));
	const fields: Record<string, string> = {};
	for (const tag of form.match(/<input\b[^>]*>/gu) ?? [])
	{
		const name = attr(tag, "name");
		const type = attr(tag, "type");
		if (name === null || (type === "radio" && !/\schecked\b/u.test(tag))) continue;
		fields[name] = attr(tag, "value") ?? "";
	}
	for (const match of form.matchAll(/<select\b[^>]*\sname="([^"]*)"[^>]*>([\s\S]*?)<\/select>/gu))
	{
		const options = match[2] ?? "";
		const selected = /<option value="([^"]*)" selected>/u.exec(options)?.[1] ?? /<option value="([^"]*)"/u.exec(options)?.[1] ?? "";
		fields[unescapeHtml(match[1] ?? "")] = unescapeHtml(selected);
	}
	return fields;
}

async function getPage(t: TierTest, auth: LoggedIn): Promise<string>
{
	const response = await call(t.harness, PAGE, { cookies: auth.cookies });
	assert.equal(response.status, 200);
	return response.body;
}

/** Theo các lần chuyển hướng (POST → trang form → trang chính) tới trang cuối. */
async function follow(t: TierTest, auth: LoggedIn, response: WebResponse): Promise<string>
{
	let current = response;
	for (let hop = 0; hop < 3 && current.status === 303; hop++)
	{
		current = await call(t.harness, current.headers.Location ?? "", { cookies: auth.cookies });
	}
	assert.equal(current.status, 200);
	return current.body;
}

interface Flash
{
	kind: string;
	/** Nội dung HTML của thông báo. */
	html: string;
}

/** Gửi form tới `path` rồi đọc thông báo kết quả trên trang được chuyển về. */
async function submit(t: TierTest, auth: LoggedIn, path: string, form: Record<string, string>): Promise<Flash>
{
	const response = await call(t.harness, `${PAGE}${path}`, { form, cookies: auth.cookies });
	assert.equal(response.status, 303, `${path}: ${response.body}`);
	const body = await follow(t, auth, response);
	const match = /<div class="flash (ok|error)">([\s\S]*?)<\/div>/u.exec(body);
	assert.ok(match, "trang không có thông báo kết quả");
	return { kind: match[1] ?? "", html: match[2] ?? "" };
}

/** Đọc trang, sửa vài ô của form `path` như người dùng, rồi gửi. */
async function fillAndSubmit(t: TierTest, auth: LoggedIn, path: string, changes: Record<string, string>): Promise<Flash>
{
	return submit(t, auth, path, { ...formFields(await getPage(t, auth), path), ...changes });
}

function assertFlash(flash: Flash, kind: "ok" | "error", ...parts: string[]): void
{
	assert.equal(flash.kind, kind, flash.html);
	for (const part of parts) assert.ok(flash.html.includes(part), `thiếu "${part}" trong: ${flash.html}`);
}

function roleOf(t: TierTest, tierKey: TierKey): string | null
{
	return t.harness.services.tierRoles.list(GUILD).find(mapping => mapping.tierKey === tierKey)?.roleId ?? null;
}

function mappingOf(t: TierTest, tierKey: TierKey): { roleId: string; createdByBot: boolean } | null
{
	const mapping = t.harness.services.tierRoles.list(GUILD).find(candidate => candidate.tierKey === tierKey);
	return mapping ? { roleId: mapping.roleId, createdByBot: mapping.createdByBot } : null;
}

function tierName(t: TierTest, tierKey: TierKey): string
{
	const tier = t.harness.services.tierSets.current(GUILD).tiers.find(candidate => candidate.key === tierKey);
	return tier ? `${tier.emoji} ${tier.name}` : "";
}

function auditActions(t: TierTest, action: string): { actorId: string }[]
{
	return t.harness.services.audit.list(GUILD, 100).filter(entry => entry.action === action);
}

function useAdminRole(t: TierTest): void
{
	t.harness.services.guildConfig.updateSettings(GUILD, { adminRoleIds: [ROLE_ADMIN_BOT] }, ADMIN_USER);
}

// ---------- Kiểm tra ----------

describe("web: trang danh hiệu (GET)", () =>
{
	test("đủ 4 phần: bộ (5 thẻ, chọn sẵn bộ đang dùng), tên 8 bậc kèm dấu vân tay, role 8 bậc kèm role lúc vẽ, nút tạo/đồng bộ", async () =>
	{
		const t = createTierTest();
		const auth = await login(t.harness, ADMIN_USER);
		const body = await getPage(t, auth);

		for (const path of ["/set", "/names", "/reset-names", "/roles", "/setup"]) assert.ok(body.includes(`method="post" action="${PAGE}${path}"`), path);
		assert.equal(body.match(/name="set"/gu)?.length, 5);
		assert.ok(body.includes("value=\"tu-tien\" checked") && body.includes("Đồng → ") && body.includes("🏆 Thách Đấu"));
		assert.ok(body.includes("Bậc 3 · từ Level 6") && body.includes("✨ Tạo/đồng bộ role") && body.includes("Role được cập nhật khi thành viên nhắn tin"));

		const set = t.harness.services.tierSets.current(GUILD);
		const names = formFields(body, "/names");
		assert.equal(names.drawnSet, "tu-tien");
		assert.equal(names.fp1, tierNamesFingerprint(set, 1));
		assert.equal(names.fp2, tierNamesFingerprint(set, 2));
		assert.deepEqual(TIER_KEYS.map(key => names[`name:${key}`]), set.tiers.map(tier => `${tier.emoji} ${tier.name}`));
		assert.ok(body.includes("placeholder=\"🟡 Kim Đan\" maxlength=\"72\""));
		assert.ok(/<button class="btn" type="submit" disabled>↺ Khôi phục tên mặc định/u.test(body), "đang dùng tên mặc định thì nút khôi phục bị tắt");

		const roles = formFields(body, "/roles");
		for (const key of TIER_KEYS)
		{
			assert.equal(roles[`role:${key}`], "", key);
			assert.equal(roles[`drawnRole:${key}`], "", key);
		}
		assert.ok(body.includes("— Chưa gán —") && body.includes(`value="${ROLE_TIER_1}"`));
		assert.ok(!body.includes(`<option value="${ROLE_MANAGED}"`), "role do integration quản lý không có trong lựa chọn");
		assert.ok(!body.includes(`<option value="${GUILD}"`), "@everyone không có trong lựa chọn");
		assert.ok(!body.includes("class=\"warn-box\""), "bot và người đăng nhập đều có Manage Roles");
	});

	test("tên bậc và tên role độc hại được escape (cả trong thuộc tính value); role đang gán được chọn sẵn", async () =>
	{
		const t = createTierTest();
		const { tierSets, tierRoles } = t.harness.services;
		tierSets.rename(GUILD, [{ tierKey: "bac-2", name: "Trúc \"Cơ\" & 'x'", emoji: null }], ADMIN_USER);
		tierRoles.set(GUILD, "bac-3", ROLE_EVIL, ADMIN_USER);
		const auth = await login(t.harness, ADMIN_USER);
		const body = await getPage(t, auth);

		assert.ok(!body.includes(EVIL_NAME) && !body.includes("<img"), "tên role không được chèn thô");
		assert.ok(body.includes(escapeHtml(`@${EVIL_NAME}`)));
		assert.ok(body.includes("value=\"🧱 Trúc &quot;Cơ&quot; &amp; &#39;x&#39;\""), "tên bậc được escape trong value");
		assert.ok(body.includes("<strong>Trúc &quot;Cơ&quot; &amp; &#39;x&#39;</strong>"));
		assert.equal(formFields(body, "/names")["name:bac-2"], "🧱 Trúc \"Cơ\" & 'x'");
		const roles = formFields(body, "/roles");
		assert.equal(roles["role:bac-3"], ROLE_EVIL);
		assert.equal(roles["drawnRole:bac-3"], ROLE_EVIL);
		assert.ok(/<button class="btn" type="submit">↺ Khôi phục tên mặc định/u.test(body), "có tên tuỳ chỉnh thì nút khôi phục bật");
	});

	test("cảnh báo khi bot hoặc người đăng nhập thiếu Manage Roles; role đã gán nhưng không còn trong server vẫn được chọn sẵn", async () =>
	{
		const t = createTierTest();
		t.bot.manageRoles = false;
		t.harness.services.tierRoles.set(GUILD, "bac-1", ROLE_GONE, ADMIN_USER);
		useAdminRole(t);
		const auth = await login(t.harness, ROLE_ADMIN_USER);
		const body = await getPage(t, auth);

		assert.ok(body.includes("class=\"warn-box\">⚠️ Bot chưa có quyền <strong>Manage Roles</strong>"));
		assert.ok(body.includes("Bạn cần quyền <strong>Manage Roles</strong>"));
		assert.ok(body.includes(`<option value="${ROLE_GONE}" selected>Role ${ROLE_GONE} (không còn trong server)</option>`));
		assert.ok(body.includes("Role đã gán không còn trong server"));
		assert.equal(formFields(body, "/roles")["drawnRole:bac-1"], ROLE_GONE);

		const unchanged = await submit(t, auth, "/roles", formFields(body, "/roles"));
		assertFlash(unchanged, "ok", "Không có gì thay đổi");
		assert.equal(roleOf(t, "bac-1"), ROLE_GONE, "lưu form không sửa gì thì không bỏ gán role không còn trong server");
	});
});

describe("web: trang danh hiệu — bộ danh hiệu", () =>
{
	test("đổi bộ: ghi audit với người đăng nhập; bộ lạ bị từ chối; trùng bộ đang dùng thì không có gì thay đổi", async () =>
	{
		const t = createTierTest();
		const { tierSets } = t.harness.services;
		const auth = await login(t.harness, ADMIN_USER);

		assertFlash(await fillAndSubmit(t, auth, "/set", { set: "khong-co" }), "error", escapeHtml(INVALID_TIER_SET));
		assert.equal(tierSets.currentKey(GUILD), "tu-tien");

		assertFlash(await fillAndSubmit(t, auth, "/set", {}), "ok", "Không có gì thay đổi", "<strong>Tu tiên</strong>");
		assert.equal(auditActions(t, "tier_set.set").length, 0);

		const changed = await fillAndSubmit(t, auth, "/set", { set: "rank-game" });
		assertFlash(changed, "ok", "Đã chọn bộ danh hiệu <strong>Rank game</strong> (Đồng → Thách Đấu)");
		assert.ok(!changed.html.includes("Tạo/đồng bộ role"), "chưa gán role thì không nhắc đồng bộ");
		assert.equal(tierSets.currentKey(GUILD), "rank-game");
		assert.deepEqual(auditActions(t, "tier_set.set").map(entry => entry.actorId), [ADMIN_USER]);
		assert.ok((await getPage(t, auth)).includes("value=\"rank-game\" checked"));
	});

	test("bảng cũ: bộ vừa đổi ở nơi khác thì không ghi; đã gán role thì nhắc bấm Tạo/đồng bộ role", async () =>
	{
		const t = createTierTest();
		const { tierSets, tierRoles } = t.harness.services;
		const auth = await login(t.harness, ADMIN_USER);
		const stale = formFields(await getPage(t, auth), "/set");
		tierSets.select(GUILD, "vu-tru", ADMIN_USER);

		assertFlash(await submit(t, auth, "/set", { ...stale, set: "kiem-hiep" }), "error", escapeHtml(SET_CHANGED));
		assert.equal(tierSets.currentKey(GUILD), "vu-tru");

		tierRoles.set(GUILD, "bac-1", ROLE_TIER_1, ADMIN_USER);
		assertFlash(await fillAndSubmit(t, auth, "/set", { set: "kiem-hiep" }), "ok", "<strong>Kiếm hiệp</strong>", "<strong>✨ Tạo/đồng bộ role</strong>");
		assert.equal(tierSets.currentKey(GUILD), "kiem-hiep");
	});
});

describe("web: trang danh hiệu — tên bậc", () =>
{
	test("đổi tên một bậc (các ô điền sẵn không sửa không thành tên tuỳ chỉnh); để trống là dùng lại tên mặc định", async () =>
	{
		const t = createTierTest();
		const { tierSets, tierRoles } = t.harness.services;
		tierRoles.set(GUILD, "bac-3", ROLE_TIER_1, ADMIN_USER);
		const auth = await login(t.harness, ADMIN_USER);

		assertFlash(await fillAndSubmit(t, auth, "/names", {}), "ok", "Không có gì thay đổi");
		assert.equal(auditActions(t, "tier_name.set").length, 0);

		const renamed = await fillAndSubmit(t, auth, "/names", { "name:bac-3": "  🔥   Hỏa   Đan " });
		assertFlash(renamed, "ok", "Đã lưu tên bậc của bộ <strong>Tu tiên</strong>", "Bậc 3: 🔥 <strong>Hỏa Đan</strong>", "Tạo/đồng bộ role");
		assert.equal(tierName(t, "bac-3"), "🔥 Hỏa Đan");
		assert.deepEqual(tierSets.overrides(GUILD, "tu-tien"), [{ tierKey: "bac-3", name: "Hỏa Đan", emoji: "🔥" }]);
		assert.deepEqual(auditActions(t, "tier_name.set").map(entry => entry.actorId), [ADMIN_USER]);

		const onlyName = await fillAndSubmit(t, auth, "/names", { "name:bac-5": "Hóa Thần Mới" });
		assertFlash(onlyName, "ok", "Bậc 5: 🔥 <strong>Hóa Thần Mới</strong>");
		assert.ok(!onlyName.html.includes("Tạo/đồng bộ role"), "bậc 5 chưa gán role thì không nhắc đồng bộ");

		assertFlash(await fillAndSubmit(t, auth, "/names", { "name:bac-3": "", "name:bac-5": "" }), "ok", "(tên mặc định)");
		assert.equal(tierName(t, "bac-3"), "🟡 Kim Đan");
		assert.deepEqual(tierSets.overrides(GUILD, "tu-tien"), []);
	});

	test("tên có link hoặc ký tự cấm bị từ chối và không ghi bậc nào, kể cả bậc hợp lệ trong cùng form; thiếu ô thì form không hợp lệ", async () =>
	{
		const t = createTierTest();
		const { tierSets } = t.harness.services;
		const auth = await login(t.harness, ADMIN_USER);

		assertFlash(await fillAndSubmit(t, auth, "/names", { "name:bac-1": "🌱 Mầm discord.gg/abc", "name:bac-4": "Hợp Lệ" }), "error", "link");
		assertFlash(await fillAndSubmit(t, auth, "/names", { "name:bac-2": "Trúc*Cơ", "name:bac-4": "Hợp Lệ" }), "error", "không được chứa các ký tự");
		assert.deepEqual(tierSets.overrides(GUILD, "tu-tien"), []);
		assert.equal(auditActions(t, "tier_name.set").length, 0);

		const fields = formFields(await getPage(t, auth), "/names");
		delete fields["name:bac-8"];
		assertFlash(await submit(t, auth, "/names", { ...fields, "name:bac-4": "Hợp Lệ" }), "error", escapeHtml(FORM_INVALID));
		assert.deepEqual(tierSets.overrides(GUILD, "tu-tien"), []);
	});

	test("tên dài hơn ô nhập bị từ chối ngay, trước khi phân tích tên, và không lưu bậc nào", async () =>
	{
		const t = createTierTest();
		const { tierSets } = t.harness.services;
		const auth = await login(t.harness, ADMIN_USER);

		const huge = await fillAndSubmit(t, auth, "/names", { "name:bac-2": "Hợp Lệ", "name:bac-3": "a".repeat(120_000) });
		assertFlash(huge, "error", "Bậc 3 · 🟡 Kim Đan: ", escapeHtml(NAME_TOO_LONG));
		assertFlash(await fillAndSubmit(t, auth, "/names", { "name:bac-8": "a".repeat(73) }), "error", "Bậc 8 · ⚡ Độ Kiếp: ", escapeHtml(NAME_TOO_LONG));
		assert.deepEqual(tierSets.overrides(GUILD, "tu-tien"), []);
		assert.equal(auditActions(t, "tier_name.set").length, 0);
	});

	test("bảng cũ: tên vừa đổi ở nơi khác (dấu vân tay khác) hoặc bộ vừa đổi thì không lưu gì", async () =>
	{
		const t = createTierTest();
		const { tierSets } = t.harness.services;
		const auth = await login(t.harness, ADMIN_USER);

		const staleNames = formFields(await getPage(t, auth), "/names");
		tierSets.rename(GUILD, [{ tierKey: "bac-5", name: "Nơi Khác", emoji: null }], ADMIN_USER);
		assertFlash(await submit(t, auth, "/names", { ...staleNames, "name:bac-2": "Không Lưu" }), "error", escapeHtml(NAMES_CHANGED));
		assert.equal(tierName(t, "bac-5"), "🔥 Nơi Khác");
		assert.equal(tierName(t, "bac-2"), "🧱 Trúc Cơ");

		const staleGroup1 = formFields(await getPage(t, auth), "/names");
		tierSets.rename(GUILD, [{ tierKey: "bac-1", name: "Nơi Khác Nữa", emoji: null }], ADMIN_USER);
		assertFlash(await submit(t, auth, "/names", { ...staleGroup1, "name:bac-8": "Không Lưu" }), "error", escapeHtml(NAMES_CHANGED));
		assert.equal(tierName(t, "bac-8"), "⚡ Độ Kiếp");

		const staleSet = formFields(await getPage(t, auth), "/names");
		tierSets.select(GUILD, "rank-game", ADMIN_USER);
		assertFlash(await submit(t, auth, "/names", { ...staleSet, "name:bac-3": "Không Lưu" }), "error", escapeHtml(NAMES_SET_CHANGED));
		assert.deepEqual(tierSets.overrides(GUILD, "rank-game"), []);
	});

	test("khôi phục tên mặc định; bảng cũ (bộ vừa đổi) không khôi phục gì; chỉ xoá tên tuỳ chỉnh của bộ đang dùng", async () =>
	{
		const t = createTierTest();
		const { tierSets } = t.harness.services;
		tierSets.rename(GUILD, [{ tierKey: "bac-1", name: "Tu Một", emoji: null }], ADMIN_USER);
		const auth = await login(t.harness, ADMIN_USER);

		const stale = formFields(await getPage(t, auth), "/reset-names");
		assert.equal(stale.drawnSet, "tu-tien");
		tierSets.select(GUILD, "rank-game", ADMIN_USER);
		tierSets.rename(GUILD, [{ tierKey: "bac-1", name: "Rank Một", emoji: null }], ADMIN_USER);
		assertFlash(await submit(t, auth, "/reset-names", stale), "error", escapeHtml(RESET_SET_CHANGED));
		assert.equal(tierSets.overrides(GUILD, "rank-game").length, 1);
		assert.equal(tierSets.overrides(GUILD, "tu-tien").length, 1);

		assertFlash(await fillAndSubmit(t, auth, "/reset-names", {}), "ok", "Đã khôi phục tên mặc định cho mọi bậc của bộ <strong>Rank game</strong>");
		assert.deepEqual(tierSets.overrides(GUILD, "rank-game"), []);
		assert.equal(tierSets.overrides(GUILD, "tu-tien").length, 1, "tên tuỳ chỉnh của bộ khác vẫn giữ");
		assert.deepEqual(auditActions(t, "tier_name.reset").map(entry => entry.actorId), [ADMIN_USER]);

		const body = await getPage(t, auth);
		assert.ok(/<button class="btn" type="submit" disabled>↺ Khôi phục tên mặc định/u.test(body));
		assertFlash(await submit(t, auth, "/reset-names", formFields(body, "/reset-names")), "ok", "vốn đang dùng tên mặc định");
	});
});

describe("web: trang danh hiệu — role theo bậc", () =>
{
	test("gán role: ghi audit với người đăng nhập, báo lại; chỉ xử lý bậc có lựa chọn khác role lúc vẽ", async () =>
	{
		const t = createTierTest();
		const { tierRoles } = t.harness.services;
		const auth = await login(t.harness, ADMIN_USER);

		const stale = formFields(await getPage(t, auth), "/roles");
		tierRoles.set(GUILD, "bac-2", ROLE_TIER_2, ADMIN_USER);
		const assigned = await submit(t, auth, "/roles", { ...stale, "role:bac-1": ROLE_TIER_1 });
		assertFlash(assigned, "ok", "Đã gán <span class=\"mention\">@Danh hiệu 1</span> cho bậc 🌱 <strong>Luyện Khí</strong> (từ Level 0).");
		assert.equal(roleOf(t, "bac-1"), ROLE_TIER_1);
		assert.equal(roleOf(t, "bac-2"), ROLE_TIER_2, "bậc 2 không đổi trên form nên không bị bỏ gán dù form vẽ lúc bậc 2 chưa gán");
		assert.ok(auditActions(t, "tier_role.set").every(entry => entry.actorId === ADMIN_USER));

		const replaced = await fillAndSubmit(t, auth, "/roles", { "role:bac-1": ROLE_EVIL });
		assertFlash(replaced, "ok", "Role cũ <span class=\"mention\">@Danh hiệu 1</span> không còn do bot quản lý");
		assert.equal(roleOf(t, "bac-1"), ROLE_EVIL);
		assert.ok(!replaced.html.includes("<img"), "tên role trong thông báo được escape");
	});

	test("từ chối: role do integration quản lý, role team, role admin bot, role không có, giá trị lạ; không ghi gì", async () =>
	{
		const t = createTierTest();
		const { teams } = t.harness.services;
		teams.add(GUILD, ROLE_TEAM_A, ADMIN_USER);
		useAdminRole(t);
		const auth = await login(t.harness, ADMIN_USER);

		assertFlash(await fillAndSubmit(t, auth, "/roles", { "role:bac-2": ROLE_MANAGED }), "error", "Bậc 2 · 🧱 Trúc Cơ: ", "integration quản lý");
		assertFlash(await fillAndSubmit(t, auth, "/roles", { "role:bac-2": ROLE_TEAM_A }), "error", "role của một team", "chưa lưu thay đổi nào");
		assertFlash(await fillAndSubmit(t, auth, "/roles", { "role:bac-2": ROLE_ADMIN_BOT }), "error", "role admin bot");
		assertFlash(await fillAndSubmit(t, auth, "/roles", { "role:bac-2": "529999999999999999" }), "error", escapeHtml(SELECTED_ROLE_UNAVAILABLE));
		assertFlash(await fillAndSubmit(t, auth, "/roles", { "role:bac-2": "abc" }), "error", escapeHtml(FORM_INVALID));
		assertFlash(await fillAndSubmit(t, auth, "/roles", { "role:bac-2": ROLE_TIER_2, "role:bac-3": ROLE_TIER_2 }), "error", escapeHtml(DUPLICATE_ROLE));
		assert.deepEqual(t.harness.services.tierRoles.list(GUILD), []);
	});

	test("người gọi thiếu Manage Roles, hoặc role không thấp hơn role cao nhất của họ, bị từ chối gán; bỏ gán vẫn được (như Discord)", async () =>
	{
		const t = createTierTest();
		const { tierRoles } = t.harness.services;
		useAdminRole(t);
		tierRoles.set(GUILD, "bac-4", ROLE_TIER_1, ADMIN_USER);

		const roleAdmin = await login(t.harness, ROLE_ADMIN_USER);
		assertFlash(await fillAndSubmit(t, roleAdmin, "/roles", { "role:bac-2": ROLE_TIER_2 }), "error", CALLER_NEEDS_MANAGE_ROLES.replace(/\*\*(.+?)\*\*/u, "<strong>$1</strong>"));
		assert.equal(roleOf(t, "bac-2"), null);

		const mod = await login(t.harness, MOD_USER);
		assertFlash(await fillAndSubmit(t, mod, "/roles", { "role:bac-2": ROLE_HIGH }), "error", "không thấp hơn role cao nhất của bạn");
		assert.equal(roleOf(t, "bac-2"), null);
		assertFlash(await fillAndSubmit(t, mod, "/roles", { "role:bac-2": ROLE_TIER_2 }), "ok", "Đã gán");
		assert.equal(roleOf(t, "bac-2"), ROLE_TIER_2);

		assertFlash(await fillAndSubmit(t, roleAdmin, "/roles", { "role:bac-4": "" }), "ok", "Đã bỏ <span class=\"mention\">@Danh hiệu 1</span> khỏi bậc");
		assert.equal(roleOf(t, "bac-4"), null);
	});

	test("bỏ gán trên bảng cũ không bỏ nhầm role vừa gán ở nơi khác; role do bot tạo bị xoá khỏi server khi bỏ gán", async () =>
	{
		const t = createTierTest();
		const { tierRoles } = t.harness.services;
		tierRoles.set(GUILD, "bac-1", ROLE_TIER_1, ADMIN_USER);
		tierRoles.set(GUILD, "bac-2", ROLE_BOT_MADE, ADMIN_USER, { createdByBot: true });
		const auth = await login(t.harness, ADMIN_USER);

		const stale = formFields(await getPage(t, auth), "/roles");
		assert.equal(stale["drawnRole:bac-1"], ROLE_TIER_1);
		tierRoles.clear(GUILD, "bac-1", ADMIN_USER);
		tierRoles.set(GUILD, "bac-1", ROLE_TIER_2, ADMIN_USER);
		assertFlash(await submit(t, auth, "/roles", { ...stale, "role:bac-1": "" }), "error", "Bậc 1 · 🌱 Luyện Khí: ", escapeHtml(ROLE_CHANGED));
		assert.equal(roleOf(t, "bac-1"), ROLE_TIER_2);

		assertFlash(await fillAndSubmit(t, auth, "/roles", { "role:bac-2": "" }), "ok", "Đã bỏ gán và xoá role do bot tạo của bậc 🧱 <strong>Trúc Cơ</strong>");
		assert.equal(roleOf(t, "bac-2"), null);
		assert.deepEqual(t.calls, [`delete:${ROLE_BOT_MADE}`]);
		assert.ok(!t.harness.world.roles.has(ROLE_BOT_MADE));
		assert.ok(auditActions(t, "tier_role.clear").every(entry => entry.actorId === ADMIN_USER));
	});

	test("role đang thuộc bậc khác: từ chối nếu bậc đó không đổi; chuyển được trong cùng lần lưu (bậc cũ bỏ gán)", async () =>
	{
		const t = createTierTest();
		t.harness.services.tierRoles.set(GUILD, "bac-1", ROLE_TIER_1, ADMIN_USER);
		const auth = await login(t.harness, ADMIN_USER);

		assertFlash(await fillAndSubmit(t, auth, "/roles", { "role:bac-2": ROLE_TIER_1 }), "error", "đang là role của Bậc 1 · 🌱 Luyện Khí", NOTHING_SAVED);
		assert.equal(roleOf(t, "bac-2"), null);

		const moved = await fillAndSubmit(t, auth, "/roles", { "role:bac-1": "", "role:bac-2": ROLE_TIER_1 });
		assertFlash(moved, "ok", "Đã bỏ <span class=\"mention\">@Danh hiệu 1</span> khỏi bậc 🌱 <strong>Luyện Khí</strong> (từ Level 0) để chuyển sang bậc khác.", "Đã gán");
		assert.equal(roleOf(t, "bac-1"), null);
		assert.equal(roleOf(t, "bac-2"), ROLE_TIER_1);
		assert.deepEqual(t.calls, [], "role do admin gán không bị xoá");
	});

	test("chuyển role do bot tạo sang bậc khác: không xoá role, giữ cờ do bot tạo (nút ✨ vẫn đổi tên); role do bot tạo không dùng lại thì vẫn bị xoá", async () =>
	{
		const t = createTierTest();
		const { tierRoles, audit } = t.harness.services;
		addTestRole(t, { id: ROLE_BOT_MADE_2, name: "🟡 Kim Đan", position: 1 });
		tierRoles.set(GUILD, "bac-1", ROLE_BOT_MADE, ADMIN_USER, { createdByBot: true });
		tierRoles.set(GUILD, "bac-3", ROLE_BOT_MADE_2, ADMIN_USER, { createdByBot: true });
		const auth = await login(t.harness, ADMIN_USER);

		const flash = await fillAndSubmit(t, auth, "/roles", { "role:bac-1": "", "role:bac-2": ROLE_BOT_MADE, "role:bac-3": "" });
		assertFlash(
			flash,
			"ok",
			"Đã bỏ <span class=\"mention\">@🌱 Luyện Khí</span> khỏi bậc 🌱 <strong>Luyện Khí</strong> (từ Level 0) để chuyển sang bậc khác.",
			"Đã bỏ gán và xoá role do bot tạo của bậc 🟡 <strong>Kim Đan</strong>",
			"Đã gán <span class=\"mention\">@🌱 Luyện Khí</span> cho bậc 🧱 <strong>Trúc Cơ</strong>",
		);
		assert.deepEqual(t.calls, [`delete:${ROLE_BOT_MADE_2}`], "chỉ role do bot tạo không còn dùng ở bậc nào bị xoá");
		assert.ok(t.harness.world.roles.has(ROLE_BOT_MADE), "role được chuyển vẫn còn trong server");
		assert.equal(mappingOf(t, "bac-1"), null);
		assert.deepEqual(mappingOf(t, "bac-2"), { roleId: ROLE_BOT_MADE, createdByBot: true });
		assert.equal(mappingOf(t, "bac-3"), null);
		const clears = audit.list(GUILD, 100).filter(entry => entry.action === "tier_role.clear");
		assert.deepEqual(clears.find(entry => entry.targetId === ROLE_BOT_MADE)?.details, { tierKey: "bac-1" });
		assert.deepEqual(clears.find(entry => entry.targetId === ROLE_BOT_MADE_2)?.details, { tierKey: "bac-3", deletedRoleId: ROLE_BOT_MADE_2 });

		t.calls.length = 0;
		await fillAndSubmit(t, auth, "/setup", {});
		assert.ok(t.calls.includes(`edit:${ROLE_BOT_MADE}:🧱 Trúc Cơ`), "nút ✨ đổi tên role vừa chuyển theo bậc mới");
	});

	test("hoán đổi role giữa 2 bậc, chuyển vòng 3 bậc theo cả hai chiều: thành công, giữ đúng cờ do bot tạo, không xoá role nào", async () =>
	{
		const t = createTierTest();
		const { tierRoles } = t.harness.services;
		tierRoles.set(GUILD, "bac-1", ROLE_TIER_1, ADMIN_USER);
		tierRoles.set(GUILD, "bac-2", ROLE_BOT_MADE, ADMIN_USER, { createdByBot: true });
		const auth = await login(t.harness, ADMIN_USER);

		const swapped = await fillAndSubmit(t, auth, "/roles", { "role:bac-1": ROLE_BOT_MADE, "role:bac-2": ROLE_TIER_1 });
		assertFlash(
			swapped,
			"ok",
			"Đã gán <span class=\"mention\">@🌱 Luyện Khí</span> cho bậc 🌱 <strong>Luyện Khí</strong>",
			"Đã gán <span class=\"mention\">@Danh hiệu 1</span> cho bậc 🧱 <strong>Trúc Cơ</strong>",
		);
		assert.ok(!swapped.html.includes("Role cũ"), "role cũ được chuyển sang bậc khác nên không có ghi chú role cũ");
		assert.deepEqual(mappingOf(t, "bac-1"), { roleId: ROLE_BOT_MADE, createdByBot: true });
		assert.deepEqual(mappingOf(t, "bac-2"), { roleId: ROLE_TIER_1, createdByBot: false });

		tierRoles.set(GUILD, "bac-3", ROLE_TIER_2, ADMIN_USER);
		assertFlash(await fillAndSubmit(t, auth, "/roles", { "role:bac-1": ROLE_TIER_1, "role:bac-2": ROLE_TIER_2, "role:bac-3": ROLE_BOT_MADE }), "ok", "Đã gán");
		assert.deepEqual(mappingOf(t, "bac-1"), { roleId: ROLE_TIER_1, createdByBot: false });
		assert.deepEqual(mappingOf(t, "bac-2"), { roleId: ROLE_TIER_2, createdByBot: false });
		assert.deepEqual(mappingOf(t, "bac-3"), { roleId: ROLE_BOT_MADE, createdByBot: true });

		assertFlash(await fillAndSubmit(t, auth, "/roles", { "role:bac-1": ROLE_BOT_MADE, "role:bac-2": ROLE_TIER_1, "role:bac-3": ROLE_TIER_2 }), "ok", "Đã gán");
		assert.deepEqual(mappingOf(t, "bac-1"), { roleId: ROLE_BOT_MADE, createdByBot: true });
		assert.deepEqual(mappingOf(t, "bac-2"), { roleId: ROLE_TIER_1, createdByBot: false });
		assert.deepEqual(mappingOf(t, "bac-3"), { roleId: ROLE_TIER_2, createdByBot: false });
		assert.deepEqual(t.calls, []);
	});

	test("một lỗi kiểm tra ở bất kỳ bậc nào thì không ghi gì: không bỏ gán, không xoá role do bot tạo, kể cả ở các bậc trước bậc lỗi", async () =>
	{
		const t = createTierTest();
		const { tierRoles, teams } = t.harness.services;
		teams.add(GUILD, ROLE_TEAM_A, ADMIN_USER);
		tierRoles.set(GUILD, "bac-1", ROLE_TIER_1, ADMIN_USER);
		tierRoles.set(GUILD, "bac-5", ROLE_BOT_MADE, ADMIN_USER, { createdByBot: true });
		const before = tierRoles.list(GUILD);
		const mod = await login(t.harness, MOD_USER);
		const clearing = { "role:bac-1": "", "role:bac-5": "" };

		assertFlash(await fillAndSubmit(t, mod, "/roles", { ...clearing, "role:bac-8": ROLE_TEAM_A }), "error", "Bậc 8 · ⚡ Độ Kiếp: ", "role của một team", NOTHING_SAVED);
		assertFlash(await fillAndSubmit(t, mod, "/roles", { ...clearing, "role:bac-8": ROLE_HIGH }), "error", "Bậc 8 · ⚡ Độ Kiếp: ", "không thấp hơn role cao nhất của bạn", NOTHING_SAVED);
		assertFlash(await fillAndSubmit(t, mod, "/roles", { ...clearing, "role:bac-8": "529999999999999999" }), "error", escapeHtml(SELECTED_ROLE_UNAVAILABLE), NOTHING_SAVED);
		assertFlash(await fillAndSubmit(t, mod, "/roles", { ...clearing, "role:bac-7": ROLE_TIER_2, "role:bac-8": ROLE_TIER_2 }), "error", escapeHtml(DUPLICATE_ROLE));
		assertFlash(await fillAndSubmit(t, mod, "/roles", { "role:bac-5": "", "role:bac-8": ROLE_TIER_1 }), "error", "đang là role của Bậc 1 · 🌱 Luyện Khí", NOTHING_SAVED);
		t.bot.highest = 1;
		assertFlash(await fillAndSubmit(t, mod, "/roles", { ...clearing, "role:bac-8": ROLE_TIER_2 }), "error", "Bot không quản lý được", NOTHING_SAVED);

		assert.deepEqual(tierRoles.list(GUILD), before);
		assert.deepEqual(t.calls, [], "không xoá role do bot tạo khi có bậc lỗi");
		assert.equal(auditActions(t, "tier_role.clear").length, 0);
	});

	test("bảng cũ: đổi role của một bậc vừa được gán ở nơi khác bị từ chối, và không ghi gì ở các bậc khác", async () =>
	{
		const t = createTierTest();
		const { tierRoles } = t.harness.services;
		tierRoles.set(GUILD, "bac-4", ROLE_BOT_MADE, ADMIN_USER, { createdByBot: true });
		const auth = await login(t.harness, ADMIN_USER);
		const stale = formFields(await getPage(t, auth), "/roles");
		tierRoles.set(GUILD, "bac-6", ROLE_TIER_2, ADMIN_USER);

		assertFlash(await submit(t, auth, "/roles", { ...stale, "role:bac-4": "", "role:bac-6": ROLE_TIER_1 }), "error", "Bậc 6 · ", escapeHtml(ROLE_CHANGED), NOTHING_SAVED);
		assert.deepEqual(mappingOf(t, "bac-4"), { roleId: ROLE_BOT_MADE, createdByBot: true });
		assert.equal(roleOf(t, "bac-6"), ROLE_TIER_2);
		assert.deepEqual(t.calls, []);
	});

	test("lỗi khi gọi Discord ở bước gán (sau khi kiểm tra xong): dừng, báo rõ đã lưu gì và bậc nào chưa có role; role được chuyển không bị xoá", async () =>
	{
		const t = createTierTest();
		const { tierRoles } = t.harness.services;
		tierRoles.set(GUILD, "bac-1", ROLE_BOT_MADE, ADMIN_USER, { createdByBot: true });
		tierRoles.set(GUILD, "bac-3", ROLE_TIER_1, ADMIN_USER);
		const auth = await login(t.harness, ADMIN_USER);

		t.bot.fetchesLeft = 1;
		const flash = await fillAndSubmit(t, auth, "/roles", { "role:bac-1": "", "role:bac-2": ROLE_BOT_MADE, "role:bac-3": ROLE_TIER_2 });
		assertFlash(
			flash,
			"error",
			"Bậc 3 · 🟡 Kim Đan: Không đọc được thông tin của bot trong server.",
			"Bot dừng ở bậc này.",
			"Chưa gán được role mới cho: Bậc 3 · 🟡 Kim Đan. Các bậc này hiện chưa có role",
			"Đã lưu:",
			"Đã bỏ <span class=\"mention\">@🌱 Luyện Khí</span> khỏi bậc 🌱 <strong>Luyện Khí</strong> (từ Level 0) để chuyển sang bậc khác.",
			"Đã gán <span class=\"mention\">@🌱 Luyện Khí</span> cho bậc 🧱 <strong>Trúc Cơ</strong>",
		);
		assert.equal(mappingOf(t, "bac-1"), null);
		assert.deepEqual(mappingOf(t, "bac-2"), { roleId: ROLE_BOT_MADE, createdByBot: true });
		assert.equal(mappingOf(t, "bac-3"), null, "bậc lỗi đã bỏ role cũ nhưng chưa có role mới, đúng như thông báo");
		assert.deepEqual(t.calls, []);

		t.bot.fetchesLeft = 0;
		const nothing = await fillAndSubmit(t, auth, "/roles", { "role:bac-7": ROLE_TIER_2 });
		assertFlash(nothing, "error", "Bậc 7 · ", "Chưa gán được role mới cho: Bậc 7 · ", NOTHING_SAVED);
		assert.ok(!nothing.html.includes("Đã lưu:"));
		assert.equal(roleOf(t, "bac-7"), null);
	});
});

describe("web: trang danh hiệu — tạo/đồng bộ role", () =>
{
	test("người gọi thiếu Manage Roles bị từ chối, không tạo role nào", async () =>
	{
		const t = createTierTest();
		useAdminRole(t);
		const auth = await login(t.harness, ROLE_ADMIN_USER);
		assertFlash(await fillAndSubmit(t, auth, "/setup", {}), "error", "Bạn cần quyền <strong>Manage Roles</strong>");
		assert.deepEqual(t.calls, []);
		assert.deepEqual(t.harness.services.tierRoles.list(GUILD), []);
	});

	test("tạo role cho 8 bậc (từ bậc 8 xuống), báo cáo; đổi bộ rồi đồng bộ lại thì đổi tên các role do bot tạo", async () =>
	{
		const t = createTierTest();
		const { tierRoles, tierSets } = t.harness.services;
		const auth = await login(t.harness, ADMIN_USER);

		assertFlash(await fillAndSubmit(t, auth, "/setup", {}), "ok", "Đồng bộ role theo bộ <strong>Tu tiên</strong>: tạo mới <strong>8</strong>");
		assert.equal(t.calls.length, 8);
		assert.equal(t.calls[0], "create:⚡ Độ Kiếp");
		assert.equal(t.calls[7], "create:🌱 Luyện Khí");
		const mappings = tierRoles.list(GUILD);
		assert.equal(mappings.length, 8);
		assert.ok(mappings.every(mapping => mapping.createdByBot));
		assert.deepEqual(auditActions(t, "tier_role.setup").map(entry => entry.actorId), [ADMIN_USER]);
		const body = await getPage(t, auth);
		assert.equal(body.match(/do bot tạo<\/span>/gu)?.length, 8);
		assert.equal(formFields(body, "/roles")["drawnRole:bac-1"], mappings[0]?.roleId);

		tierSets.select(GUILD, "rank-game", ADMIN_USER);
		t.calls.length = 0;
		assertFlash(await fillAndSubmit(t, auth, "/setup", {}), "ok", "đổi tên <strong>8</strong>");
		assert.equal(t.calls.filter(entry => entry.startsWith("edit:")).length, 8);
		assert.ok(t.calls.includes(`edit:${mappings[0]?.roleId ?? ""}:🟤 Đồng`));
	});
});
