// Test trang "Reset điểm" của web quản trị (Phase 17, DEC-041): reset XP và điểm contribution toàn server phải nhập đúng chuỗi
// xác nhận như lệnh Discord, ghi audit với người đăng nhập. Service thật trên SQLite :memory:, server Discord giả.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { RESET_ALL_TIER_ROLE_NOTE, RESET_CONFIRMATION } from "../src/discord/adminOps";
import { escapeHtml } from "../src/web/html";
import { GUILD } from "./helpers";
import { ADMIN_USER, call, createWebHarness, login, LoggedIn, PLAIN_USER, ROLE_ADMIN_BOT, ROLE_ADMIN_USER, STRANGER, WebHarness, withCsrf } from "./web-helpers";

const RESET_URL = `/g/${GUILD}/reset`;

interface Flash
{
	kind: string;
	text: string;
}

async function setup(): Promise<{ harness: WebHarness; auth: LoggedIn }>
{
	const harness = createWebHarness();
	const { activity, contributions } = harness.services;
	activity.adjustXp({ guildId: GUILD, userId: PLAIN_USER, delta: 300, actorId: ADMIN_USER, reason: null, roleIds: [] });
	activity.adjustXp({ guildId: GUILD, userId: STRANGER, delta: 45, actorId: ADMIN_USER, reason: null, roleIds: [] });
	contributions.adjust({ guildId: GUILD, userId: PLAIN_USER, delta: 12, actorId: ADMIN_USER, reason: null, roleIds: [] });
	return { harness, auth: await login(harness, ADMIN_USER) };
}

/** POST tới `/reset/<kind>` với chuỗi xác nhận; luôn quay về trang Reset điểm; trả về flash hiện ở đó. */
async function reset(harness: WebHarness, auth: LoggedIn, kind: "xp" | "contribution", confirmation: string | null): Promise<Flash>
{
	const form: Record<string, string> = confirmation === null ? {} : { "xac-nhan": confirmation };
	const response = await call(harness, `${RESET_URL}/${kind}`, { cookies: auth.cookies, form: withCsrf(auth, form) });
	assert.equal(response.status, 303);
	assert.equal(response.headers.Location, RESET_URL);
	const page = await call(harness, RESET_URL, { cookies: auth.cookies });
	const match = /<div class="flash (ok|error)">([\s\S]*?)<\/div>/u.exec(page.body);
	assert.ok(match, "không có flash");
	return { kind: match[1] ?? "", text: match[2] ?? "" };
}

function totals(harness: WebHarness): { xp: number; points: number }
{
	const { activity, contributions } = harness.services;
	return {
		xp: activity.getProfile(GUILD, PLAIN_USER).level.totalXp + activity.getProfile(GUILD, STRANGER).level.totalXp,
		points: contributions.getProfile(GUILD, PLAIN_USER).score,
	};
}

describe("web reset điểm toàn server", () =>
{
	test("trang có hai vùng nguy hiểm: giải thích, số liệu hiện tại, gợi ý sao lưu, ô nhập chuỗi xác nhận và nút đỏ", async () =>
	{
		const { harness, auth } = await setup();
		const response = await call(harness, RESET_URL, { cookies: auth.cookies });
		assert.equal(response.status, 200);
		const body = response.body;
		assert.equal((body.match(/<section class="card danger-zone">/gu) ?? []).length, 2);
		assert.ok(body.includes("Reset XP toàn server") && body.includes("Reset điểm contribution toàn server"));
		assert.ok(body.includes("<strong>2</strong> thành viên có XP") && body.includes("<strong>345</strong> XP"));
		assert.ok(body.includes("tổng <strong>12</strong> điểm"));
		assert.ok(body.includes("DEC-027") && body.includes("không hoàn tác được trên web"));
		assert.ok(body.includes(escapeHtml(RESET_ALL_TIER_ROLE_NOTE)));
		assert.equal((body.match(new RegExp(`href="/g/${GUILD}/backup"`, "gu")) ?? []).length >= 2, true);
		assert.equal((body.match(new RegExp(`Nhập ${RESET_CONFIRMATION} để xác nhận`, "gu")) ?? []).length, 2);
		assert.ok(body.includes(`action="${RESET_URL}/xp"`) && body.includes(`action="${RESET_URL}/contribution"`));
		assert.equal((body.match(/name="xac-nhan"/gu) ?? []).length, 2);
		assert.equal((body.match(/class="btn btn-danger"/gu) ?? []).length, 2);
		assert.equal((body.match(new RegExp(`name="_csrf" value="${auth.csrf}"`, "gu")) ?? []).length, 3);
	});

	test("reset XP: sai hoặc thiếu chuỗi xác nhận thì không làm gì; đúng thì XP về 0, contribution giữ nguyên, audit người đăng nhập", async () =>
	{
		const { harness, auth } = await setup();
		const before = harness.services.audit.list(GUILD, 100).length;
		for (const wrong of [null, "", "xac nhan", "XACNHAN", "XÁC NHẬN"])
		{
			const flash = await reset(harness, auth, "xp", wrong);
			assert.equal(flash.kind, "error", String(wrong));
			assert.match(flash.text, /Để reset toàn bộ, nhập chính xác: XAC NHAN/u);
		}
		assert.deepEqual(totals(harness), { xp: 345, points: 12 });
		assert.equal(harness.services.audit.list(GUILD, 100).length, before);

		const done = await reset(harness, auth, "xp", ` ${RESET_CONFIRMATION} `);
		assert.equal(done.kind, "ok");
		assert.match(done.text, /Đã reset XP toàn server: huỷ 2 biến động của 2 thành viên\.<br>/u);
		assert.deepEqual(totals(harness), { xp: 0, points: 12 });
		const [entry] = harness.services.audit.list(GUILD, 1);
		assert.deepEqual([entry?.action, entry?.actorId, entry?.targetId], ["xp.reset_all", ADMIN_USER, null]);
		assert.deepEqual(harness.adminCalls, []);
	});

	test("reset điểm contribution: sai chuỗi thì không làm gì; đúng thì điểm về 0, XP giữ nguyên, audit người đăng nhập", async () =>
	{
		const { harness, auth } = await setup();
		const wrong = await reset(harness, auth, "contribution", "XAC  NHAN");
		assert.equal(wrong.kind, "error");
		assert.deepEqual(totals(harness), { xp: 345, points: 12 });

		const done = await reset(harness, auth, "contribution", RESET_CONFIRMATION);
		assert.equal(done.kind, "ok");
		assert.match(done.text, /Đã reset điểm contribution toàn server: huỷ 1 biến động của 1 thành viên\./u);
		assert.deepEqual(totals(harness), { xp: 345, points: 0 });
		const [entry] = harness.services.audit.list(GUILD, 1);
		assert.deepEqual([entry?.action, entry?.actorId], ["contribution.reset_all", ADMIN_USER]);
	});

	test("admin nhờ role admin bot cũng reset được, audit đúng người đó", async () =>
	{
		const { harness } = await setup();
		harness.services.guildConfig.updateSettings(GUILD, { adminRoleId: ROLE_ADMIN_BOT }, ADMIN_USER);
		const auth = await login(harness, ROLE_ADMIN_USER);
		assert.equal((await reset(harness, auth, "xp", RESET_CONFIRMATION)).kind, "ok");
		assert.equal(harness.services.audit.list(GUILD, 1)[0]?.actorId, ROLE_ADMIN_USER);
	});

	test("POST thiếu hoặc sai CSRF bị 403; người không phải admin không vào được; không ghi gì", async () =>
	{
		const { harness, auth } = await setup();
		const form = { "xac-nhan": RESET_CONFIRMATION };
		assert.equal((await call(harness, `${RESET_URL}/xp`, { cookies: auth.cookies, form })).status, 403);
		assert.equal((await call(harness, `${RESET_URL}/contribution`, { cookies: auth.cookies, form: { ...form, _csrf: "sai" } })).status, 403);
		assert.equal((await call(harness, `${RESET_URL}/xp`, { form: { ...form, _csrf: auth.csrf } })).status, 403);

		await assert.rejects(login(harness, PLAIN_USER));
		harness.services.guildConfig.updateSettings(GUILD, { adminRoleId: ROLE_ADMIN_BOT }, ADMIN_USER);
		const spec = harness.world.members.get(PLAIN_USER);
		assert.ok(spec);
		spec.roleIds = [ROLE_ADMIN_BOT];
		const plain = await login(harness, PLAIN_USER);
		spec.roleIds = [];
		assert.equal((await call(harness, RESET_URL, { cookies: plain.cookies })).status, 403);
		assert.equal((await call(harness, `${RESET_URL}/xp`, { cookies: plain.cookies, form: withCsrf(plain, form) })).status, 403);

		assert.deepEqual(totals(harness), { xp: 345, points: 12 });
		assert.ok(!harness.services.audit.list(GUILD, 100).some(entry => entry.action.endsWith("reset_all")));
	});
});
