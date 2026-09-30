// Test trang "Quyền" của web quản trị với nhiều role admin bot và nhiều role tạo vote (DEC-044): bảng ô tick mọi role của server,
// "chọn tất cả" riêng từng bảng, lưu chỉ phần chênh lệch (hai tab không đè nhau), role bị khoá, tối đa 25 role, cảnh báo tự khoá
// quyền. Gọi bộ xử lý thật với service thật trên SQLite :memory: và server Discord giả; form "gửi như trình duyệt" từ HTML vừa vẽ.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MAX_GRANT_ROLES } from "../src/modules/guild-config/types";
import { escapeHtml } from "../src/web/html";
import { ADMIN_CONFIRM_FIELD, ADMIN_CONFIRM_REQUIRED, MISSING_ROLE_NOTE, ROLES_STALE_FORM, ROLES_UNCHANGED } from "../src/web/pages/roles";
import { GUILD } from "./helpers";
import {
	addRole,
	ADMIN_USER,
	call,
	createWebHarness,
	login,
	LoggedIn,
	ROLE_ADMIN_BOT,
	ROLE_ADMIN_USER,
	ROLE_MANAGED,
	ROLE_TEAM_A,
	ROLE_TEAM_B,
	WebHarness,
} from "./web-helpers";

const PATH = "/roles";
const ROLE_TIER = "510000000000000010";
const ROLE_GONE = "519999999999999990";
const ROLE_EVIL = "510000000000000009";
const EVIL = "<img src=x onerror=alert(1)>";
/** Thông báo form cũ, dạng regex (chỉ có dấu chấm là ký tự đặc biệt). */
const STALE = new RegExp(ROLES_STALE_FORM.replace(/\./gu, "\\."), "u");

type Fields = [string, string][];

function pageUrl(path: string): string
{
	return `/g/${GUILD}${path}`;
}

async function getPage(harness: WebHarness, auth: LoggedIn, path = PATH): Promise<string>
{
	const response = await call(harness, pageUrl(path), { cookies: auth.cookies });
	assert.equal(response.status, 200, `GET ${path}`);
	return response.body;
}

function unescapeHtml(value: string): string
{
	return value.replace(/&quot;/gu, "\"").replace(/&#39;/gu, "'").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&amp;/gu, "&");
}

/** Các trường trình duyệt gửi khi bấm Lưu: input ẩn, checkbox đang tick (bỏ input `disabled`). */
function readForm(body: string): Fields
{
	const start = body.indexOf(`<form method="post" action="${pageUrl(PATH)}">`);
	assert.ok(start >= 0, "không thấy form của trang Quyền");
	const form = body.slice(start, body.indexOf("</form>", start));
	const fields: Fields = [];
	for (const [, attributes = ""] of form.matchAll(/<input\b([^>]*)>/gu))
	{
		const attrs = new Map<string, string>();
		for (const [, name = "", value = ""] of attributes.matchAll(/([a-zA-Z_:-]+)(?:="([^"]*)")?/gu)) attrs.set(name, unescapeHtml(value));
		const name = attrs.get("name");
		if (name === undefined || attrs.has("disabled")) continue;
		if (attrs.get("type") === "checkbox" && !attrs.has("checked")) continue;
		fields.push([name, attrs.get("value") ?? ""]);
	}
	return fields;
}

function check(fields: Fields, name: string, value: string, checked: boolean): Fields
{
	const rest = fields.filter(([key, item]) => !(key === name && item === value));
	return checked ? [...rest, [name, value]] : rest;
}

function ticked(fields: Fields, name: string): string[]
{
	return fields.filter(([key]) => key === name).map(([, value]) => value);
}

function toForm(fields: Fields): Record<string, string[]>
{
	const form: Record<string, string[]> = {};
	for (const [name, value] of fields) (form[name] ??= []).push(value);
	return form;
}

/** POST như trình duyệt rồi mở lại trang; trả về flash của lần GET đó. */
async function save(harness: WebHarness, auth: LoggedIn, fields: Fields): Promise<{ kind: string; text: string }>
{
	const response = await call(harness, pageUrl(PATH), { form: toForm(fields), cookies: auth.cookies });
	assert.equal(response.status, 303);
	assert.equal(response.headers.Location, pageUrl(PATH));
	const body = await getPage(harness, auth);
	const match = /<div class="flash (ok|error)">([\s\S]*?)<\/div>/u.exec(body);
	assert.ok(match, "không có flash");
	return { kind: match[1] ?? "", text: match[2] ?? "" };
}

function auditCount(harness: WebHarness): number
{
	return harness.services.audit.list(GUILD, 10_000).length;
}

function settings(harness: WebHarness): { admins: string[]; creators: string[] }
{
	const current = harness.services.guildConfig.getSettings(GUILD);
	return { admins: current.adminRoleIds, creators: current.pollCreatorRoleIds };
}

function withTierRole(harness: WebHarness): void
{
	addRole(harness.world, { id: ROLE_TIER, name: "Luyện khí", position: 1 });
	harness.services.tierRoles.set(GUILD, "bac-1", ROLE_TIER, ADMIN_USER);
}

describe("web trang Quyền: hiển thị (DEC-044)", () =>
{
	test("hai bảng ô tick mọi role (bỏ @everyone); role managed và role danh hiệu bị khoá kèm lý do; trạng thái lúc vẽ trong input ẩn", async () =>
	{
		const harness = createWebHarness();
		withTierRole(harness);
		harness.services.guildConfig.updateSettings(GUILD, { adminRoleIds: [ROLE_ADMIN_BOT, ROLE_TEAM_A], pollCreatorRoleIds: [ROLE_TEAM_B] }, ADMIN_USER);
		const auth = await login(harness, ADMIN_USER);
		const body = await getPage(harness, auth);

		assert.ok(body.includes(`🔐 Role admin bot: 2/${MAX_GRANT_ROLES}`) && body.includes(`🗳️ Role được tạo vote: 1/${MAX_GRANT_ROLES}`), "số role mỗi danh sách");
		assert.ok(!body.includes(`name="a:${GUILD}"`) && !body.includes(`name="v:${GUILD}"`), "không có @everyone");
		for (const field of ["admin", "vote"])
		{
			assert.match(body, new RegExp(`name="${field}" value="${ROLE_MANAGED}" disabled>`, "u"));
			assert.match(body, new RegExp(`name="${field}" value="${ROLE_TIER}" disabled>`, "u"));
		}
		assert.ok(body.includes("Role do bot hoặc integration quản lý: không dùng được.") && body.includes("Role danh hiệu (bot tự thêm và gỡ theo level): không dùng được."));

		const fields = readForm(body);
		assert.deepEqual(ticked(fields, "admin").sort(), [ROLE_ADMIN_BOT, ROLE_TEAM_A].sort());
		assert.deepEqual(ticked(fields, "vote"), [ROLE_TEAM_B]);
		const drawn = new Map(fields);
		assert.equal(drawn.get(`a:${ROLE_ADMIN_BOT}`), "1");
		assert.equal(drawn.get(`a:${ROLE_TEAM_B}`), "0");
		assert.equal(drawn.get(`v:${ROLE_TEAM_B}`), "1");
		assert.equal(drawn.get(`v:${ROLE_ADMIN_BOT}`), "0");
		assert.ok(body.includes(`href="${pageUrl(PATH)}?chon-vote=tat-ca"`) && body.includes(`href="${pageUrl(PATH)}?chon-vote=bo-het"`), "bảng role tạo vote có chọn tất cả");
		assert.ok(!body.includes("chon-admin="), "bảng role admin không có chọn tất cả (review bảo mật Phase 18)");
		assert.ok(body.includes(`name="${ADMIN_CONFIRM_FIELD}"`), "có ô xác nhận khi thêm role admin");
		assert.ok(!body.includes("rl-lockout"), "người có Manage Server không bị cảnh báo tự khoá");
	});

	test("chọn tất cả / bỏ chọn tất cả chỉ đổi cách vẽ của đúng bảng đó: ô bị khoá không tick, input ẩn vẫn như đang lưu, chưa ghi gì", async () =>
	{
		const harness = createWebHarness();
		withTierRole(harness);
		harness.services.guildConfig.updateSettings(GUILD, { adminRoleIds: [ROLE_ADMIN_BOT], pollCreatorRoleIds: [ROLE_TEAM_B] }, ADMIN_USER);
		const auth = await login(harness, ADMIN_USER);
		const before = auditCount(harness);

		const all = await getPage(harness, auth, `${PATH}?chon-vote=tat-ca`);
		assert.ok(all.includes("Đã tick sẵn mọi ô.") && all.includes("chưa lưu"));
		const allFields = readForm(all);
		assert.deepEqual(ticked(allFields, "vote").sort(), [ROLE_ADMIN_BOT, ROLE_TEAM_A, ROLE_TEAM_B].sort(), "mọi role dùng được, không có role bị khoá");
		assert.deepEqual(ticked(allFields, "admin"), [ROLE_ADMIN_BOT], "bảng role admin giữ nguyên");
		assert.equal(new Map(allFields).get(`v:${ROLE_TEAM_A}`), "0");

		const none = readForm(await getPage(harness, auth, `${PATH}?chon-vote=bo-het`));
		assert.deepEqual(ticked(none, "vote"), []);
		assert.deepEqual(ticked(none, "admin"), [ROLE_ADMIN_BOT]);
		const ignored = readForm(await getPage(harness, auth, `${PATH}?chon-admin=tat-ca`));
		assert.deepEqual(ticked(ignored, "admin"), [ROLE_ADMIN_BOT], "bảng role admin bỏ qua tham số chọn tất cả");
		assert.equal(auditCount(harness), before, "chỉ vẽ lại, chưa ghi gì");

		const flash = await save(harness, auth, allFields);
		assert.equal(flash.kind, "ok");
		assert.deepEqual(settings(harness).creators.sort(), [ROLE_ADMIN_BOT, ROLE_TEAM_A, ROLE_TEAM_B].sort());
		assert.deepEqual(settings(harness).admins, [ROLE_ADMIN_BOT]);
	});

	test("cảnh báo tự khoá quyền với người là admin chỉ nhờ role admin bot; nêu đúng các role họ đang có", async () =>
	{
		const harness = createWebHarness();
		harness.services.guildConfig.updateSettings(GUILD, { adminRoleIds: [ROLE_TEAM_A, ROLE_ADMIN_BOT] }, ADMIN_USER);
		const roleAdmin = await login(harness, ROLE_ADMIN_USER);
		const warned = await getPage(harness, roleAdmin);
		assert.ok(warned.includes("rl-lockout") && warned.includes("mất quyền quản trị ngay lập tức"));
		const box = /<div class="warn-box rl-lockout">([\s\S]*?)<\/div>/u.exec(warned)?.[1] ?? "";
		assert.ok(box.includes("@Admin bot") && !box.includes("@Backend"), box);
	});

	test("role đã lưu mà không còn trong server: có dòng riêng, đang tick, bỏ tick để gỡ", async () =>
	{
		const harness = createWebHarness();
		harness.services.guildConfig.updateSettings(GUILD, { pollCreatorRoleIds: [ROLE_TEAM_A, ROLE_GONE] }, ADMIN_USER);
		const auth = await login(harness, ADMIN_USER);
		const body = await getPage(harness, auth);
		assert.ok(body.includes(`role-không-còn (${ROLE_GONE})`) && body.includes(MISSING_ROLE_NOTE));
		const fields = readForm(body);
		assert.ok(ticked(fields, "vote").includes(ROLE_GONE));

		assert.equal((await save(harness, auth, fields)).text, ROLES_UNCHANGED);
		await save(harness, auth, check(fields, "vote", ROLE_GONE, false));
		assert.deepEqual(settings(harness).creators, [ROLE_TEAM_A]);
	});

	test("tên role độc hại luôn bị escape (bảng, chip, flash)", async () =>
	{
		const harness = createWebHarness();
		addRole(harness.world, { id: ROLE_EVIL, name: EVIL, position: 6 });
		const auth = await login(harness, ADMIN_USER);
		const body = await getPage(harness, auth);
		assert.ok(!body.includes(EVIL) && body.includes(`@${escapeHtml(EVIL)}`));
		const flash = await save(harness, auth, check(readForm(body), "vote", ROLE_EVIL, true));
		assert.ok(flash.text.includes(escapeHtml(EVIL)) && !flash.text.includes(EVIL));
		assert.ok(!(await getPage(harness, auth)).includes(EVIL));
	});
});

describe("web trang Quyền: lưu (DEC-044)", () =>
{
	test("tick nhiều role ở cả hai bảng một lần: mỗi danh sách một audit có danh sách mới và phần thêm; flash tóm tắt kèm nhắc Integrations", async () =>
	{
		const harness = createWebHarness();
		const auth = await login(harness, ADMIN_USER);
		let fields = readForm(await getPage(harness, auth));
		fields = check(check(fields, "admin", ROLE_ADMIN_BOT, true), "admin", ROLE_TEAM_A, true);
		fields = check(check(fields, "vote", ROLE_TEAM_A, true), "vote", ROLE_TEAM_B, true);
		const unconfirmed = await save(harness, auth, fields);
		assert.equal(unconfirmed.kind, "error");
		assert.ok(unconfirmed.text.includes("cần tick ô xác nhận"), unconfirmed.text);
		assert.deepEqual(settings(harness), { admins: [], creators: [] }, "thiếu xác nhận thì không ghi cả bảng role tạo vote");
		assert.ok(ADMIN_CONFIRM_REQUIRED.includes("toàn quyền quản trị"));
		const flash = await save(harness, auth, [...fields, [ADMIN_CONFIRM_FIELD, "1"]]);
		assert.equal(flash.kind, "ok");
		for (const part of ["Đã cập nhật quyền", "vào danh sách role admin bot", "vào danh sách role tạo vote", "@Admin bot", "@Backend", "@Frontend", "Integrations"])
		{
			assert.ok(flash.text.includes(part), `flash thiếu "${part}": ${flash.text}`);
		}
		assert.deepEqual(settings(harness).admins.sort(), [ROLE_ADMIN_BOT, ROLE_TEAM_A].sort());
		assert.deepEqual(settings(harness).creators.sort(), [ROLE_TEAM_A, ROLE_TEAM_B].sort());
		const entries = harness.services.audit.list(GUILD, 10);
		assert.equal(entries.length, 2);
		assert.ok(entries.every(entry => entry.action === "config.update" && entry.actorId === ADMIN_USER));
		assert.deepEqual(entries.map(entry => Object.keys(entry.details ?? {}).sort()), [["addedRoles", "pollCreatorRoleIds"], ["addedRoles", "adminRoleIds"]]);

		fields = readForm(await getPage(harness, auth));
		const removed = await save(harness, auth, check(fields, "admin", ROLE_TEAM_A, false));
		assert.ok(removed.text.includes("khỏi danh sách role admin bot") && !removed.text.includes("Integrations"), removed.text);
		assert.deepEqual(settings(harness).admins, [ROLE_ADMIN_BOT]);
		assert.equal((await save(harness, auth, readForm(await getPage(harness, auth)))).text, ROLES_UNCHANGED);
		assert.equal(auditCount(harness), 3);
	});

	test("người có role thứ hai trong danh sách role admin vào được web; bỏ role đó thì bị chặn ngay", async () =>
	{
		const harness = createWebHarness();
		harness.services.guildConfig.updateSettings(GUILD, { adminRoleIds: [ROLE_TEAM_A, ROLE_ADMIN_BOT] }, ADMIN_USER);
		const roleAdmin = await login(harness, ROLE_ADMIN_USER);
		assert.equal((await call(harness, pageUrl(PATH), { cookies: roleAdmin.cookies })).status, 200);

		const admin = await login(harness, ADMIN_USER);
		await save(harness, admin, check(readForm(await getPage(harness, admin)), "admin", ROLE_ADMIN_BOT, false));
		assert.deepEqual(settings(harness).admins, [ROLE_TEAM_A]);
		assert.equal((await call(harness, pageUrl(PATH), { cookies: roleAdmin.cookies })).status, 403);
	});

	test("hai tab: trang cũ chỉ ghi phần mình đổi, không bỏ role vừa được thêm ở tab kia, không thêm lại role vừa bị bỏ", async () =>
	{
		const harness = createWebHarness();
		harness.services.guildConfig.updateSettings(GUILD, { adminRoleIds: [ROLE_ADMIN_BOT], pollCreatorRoleIds: [ROLE_TEAM_A] }, ADMIN_USER);
		const auth = await login(harness, ADMIN_USER);
		const tabA = readForm(await getPage(harness, auth));
		const tabB = readForm(await getPage(harness, auth));

		await save(harness, auth, [...check(check(tabA, "admin", ROLE_TEAM_A, true), "vote", ROLE_TEAM_A, false), [ADMIN_CONFIRM_FIELD, "1"]]);
		assert.deepEqual(settings(harness), { admins: [ROLE_ADMIN_BOT, ROLE_TEAM_A], creators: [] });

		const flash = await save(harness, auth, check(tabB, "vote", ROLE_TEAM_B, true));
		assert.equal(flash.kind, "ok");
		assert.deepEqual(settings(harness).admins.sort(), [ROLE_ADMIN_BOT, ROLE_TEAM_A].sort(), "tab B không bỏ role admin tab A vừa thêm");
		assert.deepEqual(settings(harness).creators, [ROLE_TEAM_B], "tab B không thêm lại role tạo vote tab A vừa bỏ");

		const staleRemove = await save(harness, auth, check(tabB, "vote", ROLE_TEAM_A, false));
		assert.ok(staleRemove.text.includes(ROLES_UNCHANGED) && staleRemove.text.includes("Vốn không phải role tạo vote"), staleRemove.text);
		assert.deepEqual(settings(harness).creators, [ROLE_TEAM_B]);
	});

	test("gửi thẳng form (bỏ qua disabled): role managed, role danh hiệu, @everyone, role lạ, form thiếu trạng thái bị từ chối; không ghi cả bảng kia", async () =>
	{
		const harness = createWebHarness();
		withTierRole(harness);
		const auth = await login(harness, ADMIN_USER);
		const fields = check(readForm(await getPage(harness, auth)), "vote", ROLE_TEAM_A, true);
		const before = auditCount(harness);
		const cases: [Fields, RegExp][] = [
			[check(fields, "admin", ROLE_MANAGED, true), /Không thể dùng role do bot hoặc integration quản lý làm role admin bot/u],
			[check(fields, "admin", ROLE_TIER, true), /làm role admin bot vì role này đang là role của bậc danh hiệu/u],
			[check(fields, "vote", ROLE_TIER, true), /làm role tạo vote vì role này đang là role của bậc danh hiệu/u],
			[[...fields, ["admin", GUILD], [`a:${GUILD}`, "0"]], /Không thể dùng @everyone làm role admin bot/u],
			[[...fields, ["admin", ROLE_GONE], [`a:${ROLE_GONE}`, "0"]], /Không tìm thấy role/u],
			[check(fields, "admin", ROLE_TEAM_B, true).filter(([name]) => name !== `a:${ROLE_TEAM_B}`), STALE],
			[[...fields.filter(([name]) => name !== `v:${ROLE_TEAM_B}`), [`v:${ROLE_TEAM_B}`, "2"]], STALE],
			[[...fields, ["a:12345", "1"]], STALE],
		];
		for (const [form, message] of cases)
		{
			const flash = await save(harness, auth, form);
			assert.equal(flash.kind, "error", flash.text);
			assert.match(flash.text, message);
		}
		assert.deepEqual(settings(harness), { admins: [], creators: [] });
		assert.equal(auditCount(harness), before);
	});

	test("tối đa MAX_GRANT_ROLES role mỗi danh sách: chọn tất cả với nhiều role hơn thì cảnh báo, lưu bị từ chối và không ghi gì; bỏ bớt thì lưu được", async () =>
	{
		const harness = createWebHarness();
		const extra = Array.from({ length: MAX_GRANT_ROLES }, (_, index) => `54000000000000${String(index).padStart(4, "0")}`);
		extra.forEach((roleId, index) => addRole(harness.world, { id: roleId, name: `Nhóm ${index}`, position: 1 }));
		harness.services.guildConfig.updateSettings(GUILD, { adminRoleIds: [ROLE_ADMIN_BOT] }, ADMIN_USER);
		const auth = await login(harness, ADMIN_USER);
		const body = await getPage(harness, auth, `${PATH}?chon-vote=tat-ca`);
		assert.ok(body.includes(`nhiều hơn giới hạn ${MAX_GRANT_ROLES} role tạo vote`), "cảnh báo quá giới hạn");
		const fields = readForm(body);
		const before = auditCount(harness);

		const flash = await save(harness, auth, [...check(fields, "admin", ROLE_TEAM_A, true), [ADMIN_CONFIRM_FIELD, "1"]]);
		assert.equal(flash.kind, "error");
		assert.ok(flash.text.includes(`tối đa ${MAX_GRANT_ROLES} role tạo vote`) && flash.text.includes("Bot chưa thay đổi gì"), flash.text);
		assert.deepEqual(settings(harness), { admins: [ROLE_ADMIN_BOT], creators: [] }, "bảng role admin hợp lệ cũng không được ghi");
		assert.equal(auditCount(harness), before);

		const trimmed = [ROLE_ADMIN_BOT, ROLE_TEAM_A, ROLE_TEAM_B].reduce((form, roleId) => check(form, "vote", roleId, false), fields);
		assert.equal((await save(harness, auth, trimmed)).kind, "ok");
		assert.equal(settings(harness).creators.length, MAX_GRANT_ROLES);
	});
});
