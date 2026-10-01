// Test trang "Cài đặt retro" của web quản trị (Phase 19, DEC-041/DEC-049): XP khi điền retro, XP người đề xuất tên được chọn, thời hạn
// vote (chỉ ghi ô đã đổi so với lúc vẽ), role quản lý retro (bảng ô tick không có "Chọn tất cả", role thêm vào qua assertUsableRole,
// tối đa 25), CSRF, quyền. Service thật trên SQLite :memory: và server Discord giả.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RETRO_CONFIG } from "../src/modules/retro/types";
import { escapeHtml } from "../src/web/html";
import { RETRO_SETTINGS_STALE_FORM, RETRO_SETTINGS_UNCHANGED } from "../src/web/pages/retroSettings";
import { GUILD } from "./helpers";
import { flashAfter, getPage, pageUrl, post } from "./web-retro-helpers";
import { addRole, ADMIN_USER, call, createWebHarness, login, LoggedIn, PLAIN_USER, ROLE_MANAGED, ROLE_TEAM_A, ROLE_TEAM_B, WebHarness } from "./web-helpers";

const ROLE_TIER = "510000000000000009";

/** Form lưu XP và thời hạn, mang giá trị lúc vẽ là cấu hình mặc định. */
function numbersForm(values: Partial<Record<"fillXp" | "proposerBonusXp" | "voteMinutes", string>> = {}): Record<string, string>
{
	const drawn = { fillXp: String(DEFAULT_RETRO_CONFIG.fillXp), proposerBonusXp: String(DEFAULT_RETRO_CONFIG.proposerBonusXp), voteMinutes: String(DEFAULT_RETRO_CONFIG.voteMinutes) };
	return { ...drawn, ...values, "d:fillXp": drawn.fillXp, "d:proposerBonusXp": drawn.proposerBonusXp, "d:voteMinutes": drawn.voteMinutes };
}

async function setup(): Promise<{ harness: WebHarness; auth: LoggedIn }>
{
	const harness = createWebHarness();
	addRole(harness.world, { id: ROLE_TIER, name: "Đấu Sĩ", position: 1 });
	harness.services.tierRoles.set(GUILD, "bac-1", ROLE_TIER, ADMIN_USER);
	const auth = await login(harness, ADMIN_USER);
	return { harness, auth };
}

describe("web: Retro — cài đặt", () =>
{
	test("trang cài đặt: giá trị mặc định, bảng role không có Chọn tất cả, role do integration quản lý và role danh hiệu không chọn được", async () =>
	{
		const { harness, auth } = await setup();
		const body = await getPage(harness, auth, "/retro/settings");
		assert.match(body, /<h1>Cài đặt retro<\/h1>/u);
		assert.ok(body.includes(`name="fillXp" value="${DEFAULT_RETRO_CONFIG.fillXp}"`));
		assert.ok(body.includes(`name="proposerBonusXp" value="${DEFAULT_RETRO_CONFIG.proposerBonusXp}"`));
		assert.ok(body.includes(`name="voteMinutes" value="${DEFAULT_RETRO_CONFIG.voteMinutes}"`));
		assert.ok(!body.includes("✅ Chọn tất cả") && !body.includes("chon=tat-ca"), "bảng role quản lý không có link Chọn tất cả");
		assert.match(body, new RegExp(`name="quan-ly" value="${ROLE_MANAGED}" disabled`, "u"));
		assert.match(body, new RegExp(`name="quan-ly" value="${ROLE_TIER}" disabled`, "u"));
		assert.match(body, new RegExp(`name="quan-ly" value="${ROLE_TEAM_A}">`, "u"));
		assert.ok(body.includes(`href="/g/${GUILD}/retro" class="active"`), "nằm dưới mục Retro");
	});

	test("lưu XP và thời hạn: chỉ ghi ô đã đổi, không đè thay đổi của admin khác; số sai hoặc ngoài khoảng báo lỗi; form cũ bị từ chối", async () =>
	{
		const { harness, auth } = await setup();
		harness.services.retro.updateConfig(GUILD, { proposerBonusXp: 50 }, PLAIN_USER);

		const saved = await flashAfter(harness, auth, await post(harness, auth, "/retro/settings", numbersForm({ fillXp: "30" })));
		assert.equal(saved.kind, "ok");
		assert.ok(saved.text.includes("XP khi điền retro: 20 → <strong>30</strong>"), saved.text);
		const config = harness.services.retro.getConfig(GUILD);
		assert.equal(config.fillXp, 30);
		assert.equal(config.proposerBonusXp, 50, "ô không đổi so với lúc vẽ không đè giá trị admin khác vừa lưu");
		assert.equal(config.voteMinutes, DEFAULT_RETRO_CONFIG.voteMinutes);
		const audit = harness.services.audit.list(GUILD, 5).find(entry => entry.action === "retro.config");
		assert.equal(audit?.actorId, ADMIN_USER);
		assert.deepEqual(audit?.details, { fillXp: 30 });

		const unchanged = await flashAfter(harness, auth, await post(harness, auth, "/retro/settings", numbersForm()));
		assert.ok(unchanged.text.includes(RETRO_SETTINGS_UNCHANGED));

		const cases: [Record<string, string>, string][] = [
			[numbersForm({ voteMinutes: "abc" }), "Thời hạn vote tên sprint (phút) phải là số nguyên"],
			[numbersForm({ fillXp: "5000" }), "XP khi điền retro phải là số nguyên từ 0 đến 1000."],
			[numbersForm({ voteMinutes: "0" }), "Thời hạn vote tên sprint (phút) phải là số nguyên"],
			[{ ...numbersForm({ fillXp: "40" }), "d:fillXp": "x" }, RETRO_SETTINGS_STALE_FORM],
		];
		for (const [form, message] of cases)
		{
			const flash = await flashAfter(harness, auth, await post(harness, auth, "/retro/settings", form));
			assert.equal(flash.kind, "error", JSON.stringify(form));
			assert.ok(flash.text.includes(escapeHtml(message)), `${JSON.stringify(form)}: ${flash.text}`);
			assert.equal(flash.location, pageUrl("/retro/settings"));
		}
		assert.equal(harness.services.retro.getConfig(GUILD).fillXp, 30, "lỗi thì không ghi gì");
	});

	test("role quản lý retro: thêm, bỏ theo phần đã đổi; role do integration quản lý, role danh hiệu bị chặn (assertUsableRole); form cũ bị từ chối", async () =>
	{
		const { harness, auth } = await setup();
		const drawn = { [`m:${ROLE_TEAM_A}`]: "0", [`m:${ROLE_TEAM_B}`]: "0", [`m:${ROLE_MANAGED}`]: "0", [`m:${ROLE_TIER}`]: "0" };

		const added = await flashAfter(harness, auth, await post(harness, auth, "/retro/settings/roles", { ...drawn, "quan-ly": ROLE_TEAM_A }));
		assert.equal(added.kind, "ok");
		assert.ok(added.text.includes("Đã thêm") && added.text.includes("@Backend"), added.text);
		assert.equal(added.location, pageUrl("/retro/settings"));
		assert.deepEqual(harness.services.retro.getConfig(GUILD).managerRoleIds, [ROLE_TEAM_A]);
		const audit = harness.services.audit.list(GUILD, 5).find(entry => entry.action === "retro.config");
		assert.equal(audit?.actorId, ADMIN_USER);

		const removed = await flashAfter(harness, auth, await post(harness, auth, "/retro/settings/roles", { ...drawn, [`m:${ROLE_TEAM_A}`]: "1" }));
		assert.equal(removed.kind, "ok");
		assert.ok(removed.text.includes("Đã bỏ"));
		assert.deepEqual(harness.services.retro.getConfig(GUILD).managerRoleIds, []);

		const cases: [Record<string, string>, string][] = [
			[{ ...drawn, "quan-ly": ROLE_MANAGED }, "Không thể dùng role do bot hoặc integration quản lý làm role quản lý retro."],
			[{ ...drawn, "quan-ly": ROLE_TIER }, "làm role quản lý retro vì role này đang là role của bậc danh hiệu"],
			[{ ...drawn, "quan-ly": GUILD, [`m:${GUILD}`]: "0" }, "Không thể dùng @everyone làm role quản lý retro."],
			[{ "quan-ly": ROLE_TEAM_A }, RETRO_SETTINGS_STALE_FORM],
			[{ ...drawn, "m:abc": "1" }, RETRO_SETTINGS_STALE_FORM],
			[{ ...drawn, "quan-ly": "510000000000000077", "m:510000000000000077": "0" }, "Không tìm thấy role"],
		];
		for (const [form, message] of cases)
		{
			const flash = await flashAfter(harness, auth, await post(harness, auth, "/retro/settings/roles", form));
			assert.equal(flash.kind, "error", JSON.stringify(form));
			assert.ok(flash.text.includes(escapeHtml(message)), `${JSON.stringify(form)}: ${flash.text}`);
		}
		assert.deepEqual(harness.services.retro.getConfig(GUILD).managerRoleIds, []);
	});

	test("tối đa 25 role quản lý: thêm role thứ 26 bị từ chối, không ghi gì", async () =>
	{
		const { harness, auth } = await setup();
		const existing = Array.from({ length: 25 }, (_, index) => `5200000000000000${String(index).padStart(2, "0")}`);
		for (const roleId of existing) addRole(harness.world, { id: roleId, name: `Role ${roleId.slice(-2)}` });
		harness.services.retro.changeManagerRoles(GUILD, { add: existing }, ADMIN_USER);
		const drawn: Record<string, string> = { [`m:${ROLE_TEAM_A}`]: "0" };
		for (const roleId of existing) drawn[`m:${roleId}`] = "1";
		const flash = await flashAfter(harness, auth, await post(harness, auth, "/retro/settings/roles", { ...drawn, "quan-ly": [...existing, ROLE_TEAM_A] }));
		assert.equal(flash.kind, "error");
		assert.ok(flash.text.includes("Chỉ được đặt tối đa 25 role quản lý retro"), flash.text);
		assert.equal(harness.services.retro.getConfig(GUILD).managerRoleIds.length, 25);
	});

	test("thiếu CSRF: 403; thành viên thường không vào được", async () =>
	{
		const { harness, auth } = await setup();
		const forged = await call(harness, pageUrl("/retro/settings"), { cookies: auth.cookies, form: numbersForm({ fillXp: "999" }) });
		assert.equal(forged.status, 403);
		const forgedRoles = await call(harness, pageUrl("/retro/settings/roles"), { cookies: auth.cookies, form: { [`m:${ROLE_TEAM_A}`]: "0", "quan-ly": ROLE_TEAM_A } });
		assert.equal(forgedRoles.status, 403);
		assert.equal(harness.services.retro.getConfig(GUILD).fillXp, DEFAULT_RETRO_CONFIG.fillXp);
		assert.deepEqual(harness.services.retro.getConfig(GUILD).managerRoleIds, []);
		await assert.rejects(login(harness, PLAIN_USER));
	});
});
