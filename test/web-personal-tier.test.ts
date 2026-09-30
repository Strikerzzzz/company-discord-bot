// Test phần bộ danh hiệu cá nhân của web quản trị (DEC-047, DEC-041): công tắc và thống kê ở trang Danh hiệu, dòng "Bộ hiển thị"
// và nút xoá lựa chọn ở hồ sơ trang Thành viên. Gọi bộ xử lý thật với service thật trên SQLite :memory: (test/web-helpers.ts).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { TIER_SET_KEYS } from "../src/modules/activity/tiers";
import { escapeHtml } from "../src/web/html";
import { NO_TIER_CHOICE } from "../src/web/pages/members";
import { FORM_INVALID, PERSONAL_ALREADY, PERSONAL_OFF, PERSONAL_ON, PERSONAL_UNCHANGED } from "../src/web/pages/tiers";
import { DUPLICATE_POST_WINDOW_MS } from "../src/web/server";
import { GUILD } from "./helpers";
import { ADMIN_USER, call, createWebHarness, LoggedIn, login, PLAIN_USER, ROLE_ADMIN_USER, STRANGER, WebHarness, withCsrf } from "./web-helpers";

interface Flash
{
	kind: string;
	text: string;
}

function pageUrl(path: string): string
{
	return `/g/${GUILD}${path}`;
}

function viewUrl(userId: string): string
{
	return pageUrl(`/members/view?u=${userId}`);
}

async function setup(): Promise<{ harness: WebHarness; auth: LoggedIn }>
{
	const harness = createWebHarness();
	return { harness, auth: await login(harness, ADMIN_USER) };
}

async function getPage(harness: WebHarness, auth: LoggedIn, path: string): Promise<string>
{
	const response = await call(harness, path, { cookies: auth.cookies });
	assert.equal(response.status, 200, `GET ${path}`);
	return response.body;
}

/** POST form (kèm CSRF), kiểm tra 303 về `location`, rồi trả về flash hiện ở trang đó. Mỗi lần gửi cách nhau quá khoảng chống bấm đúp. */
async function post(harness: WebHarness, auth: LoggedIn, path: string, form: Record<string, string>, location: string): Promise<Flash>
{
	harness.clock.advance(DUPLICATE_POST_WINDOW_MS + 1);
	const response = await call(harness, pageUrl(path), { cookies: auth.cookies, form: withCsrf(auth, form) });
	assert.equal(response.status, 303, `POST ${path}`);
	assert.equal(response.headers.Location, location);
	let page = await call(harness, location, { cookies: auth.cookies });
	if (page.status === 303) page = await call(harness, page.headers.Location ?? "", { cookies: auth.cookies });
	assert.equal(page.status, 200);
	const match = /<div class="flash (ok|error)">([\s\S]*?)<\/div>/u.exec(page.body);
	assert.ok(match, "không có flash");
	return { kind: match[1] ?? "", text: match[2] ?? "" };
}

function prefAudits(harness: WebHarness): { action: string; actorId: string; targetId: string | null; details: Record<string, unknown> | null }[]
{
	return harness.services.audit.list(GUILD, 1000).filter(entry => entry.action.startsWith("tier_pref")).reverse();
}

/** Phần "Bộ danh hiệu cá nhân" của trang Danh hiệu. */
function personalCard(body: string): string
{
	const match = /<section class="card"><h2>🎨 Bộ danh hiệu cá nhân<\/h2>[\s\S]*?<\/section>/u.exec(body);
	assert.ok(match, "thiếu phần bộ danh hiệu cá nhân");
	return match[0];
}

/** Số người của một bộ trong bảng thống kê. */
function countOf(card: string, setName: string): number
{
	const match = new RegExp(`<tr><td>${setName}(?: <span class="badge ok">Bộ của server</span>)?</td>\\s*<td class="num">(\\d+)</td></tr>`, "u").exec(card);
	assert.ok(match, `thiếu dòng ${setName}`);
	return Number(match[1]);
}

describe("web: bộ danh hiệu cá nhân ở trang Danh hiệu (DEC-047)", () =>
{
	test("công tắc mặc định bật (form mang giá trị lúc vẽ); bảng số người chọn từng bộ, đánh dấu bộ của server, có tổng", async () =>
	{
		const { harness, auth } = await setup();
		harness.services.tierSets.select(GUILD, "rank-game", ADMIN_USER);
		harness.services.tierSets.chooseForMember(GUILD, PLAIN_USER, "cay-xanh");
		harness.services.tierSets.chooseForMember(GUILD, ROLE_ADMIN_USER, "cay-xanh");
		harness.services.tierSets.chooseForMember(GUILD, STRANGER, "mobile-legends");
		const card = personalCard(await getPage(harness, auth, pageUrl("/tiers")));

		assert.match(card, /<input type="checkbox" id="tr-allow" name="allowPersonal" value="1" checked>/u);
		assert.match(card, /<input type="hidden" name="drawnAllow" value="1">/u);
		assert.match(card, new RegExp(`action="${pageUrl("/tiers/personal")}"`, "u"));
		assert.match(card, /name="_csrf"/u);
		assert.ok(card.includes("/rank-style"));
		assert.equal(countOf(card, "Cây xanh"), 2);
		assert.equal(countOf(card, "Mobile Legends"), 1);
		assert.equal(countOf(card, "Tu tiên"), 0);
		assert.match(card, /<td>Rank game <span class="badge ok">Bộ của server<\/span><\/td>/u);
		assert.equal((card.match(/<tr><td>/gu) ?? []).length, TIER_SET_KEYS.length, "mỗi bộ một dòng");
		assert.match(card, /<tfoot><tr><th>Tổng<\/th><th class="num">3<\/th><\/tr><\/tfoot>/u);
		assert.ok(!card.includes("warn-box"), "đang bật thì không có cảnh báo");
	});

	test("tắt rồi bật: chỉ ghi khi đổi, audit với người đăng nhập, lựa chọn đã lưu vẫn giữ; trang hiện cảnh báo khi đang tắt", async () =>
	{
		const { harness, auth } = await setup();
		harness.services.tierSets.chooseForMember(GUILD, PLAIN_USER, "vu-tru");

		const off = await post(harness, auth, "/tiers/personal", { drawnAllow: "1" }, pageUrl("/tiers"));
		assert.deepEqual(off, { kind: "ok", text: escapeHtml(PERSONAL_OFF) });
		assert.equal(harness.services.tierSets.allowPersonal(GUILD), false);
		assert.equal(harness.services.tierSets.memberChoice(GUILD, PLAIN_USER), "vu-tru");
		const offCard = personalCard(await getPage(harness, auth, pageUrl("/tiers")));
		assert.match(offCard, /<input type="checkbox" id="tr-allow" name="allowPersonal" value="1">/u);
		assert.match(offCard, /<input type="hidden" name="drawnAllow" value="0">/u);
		assert.match(offCard, /<div class="warn-box">Đang tắt: mọi người hiển thị theo bộ của server\. 1 lựa chọn đã lưu vẫn giữ/u);

		const on = await post(harness, auth, "/tiers/personal", { drawnAllow: "0", allowPersonal: "1" }, pageUrl("/tiers"));
		assert.deepEqual(on, { kind: "ok", text: escapeHtml(PERSONAL_ON) });
		assert.equal(harness.services.tierSets.allowPersonal(GUILD), true);
		assert.deepEqual(prefAudits(harness).map(entry => [entry.action, entry.actorId, entry.targetId, entry.details]), [
			["tier_pref.allow", ADMIN_USER, null, { allowPersonal: false }],
			["tier_pref.allow", ADMIN_USER, null, { allowPersonal: true }],
		]);
	});

	test("không đổi so với lúc tải trang, hoặc admin khác vừa đặt giống vậy: không ghi gì", async () =>
	{
		const { harness, auth } = await setup();
		const same = await post(harness, auth, "/tiers/personal", { drawnAllow: "1", allowPersonal: "1" }, pageUrl("/tiers"));
		assert.deepEqual(same, { kind: "ok", text: escapeHtml(PERSONAL_UNCHANGED) });

		harness.services.tierSets.setAllowPersonal(GUILD, false, ROLE_ADMIN_USER);
		const stale = await post(harness, auth, "/tiers/personal", { drawnAllow: "1" }, pageUrl("/tiers"));
		assert.deepEqual(stale, { kind: "ok", text: escapeHtml(PERSONAL_ALREADY) });
		assert.equal(harness.services.tierSets.allowPersonal(GUILD), false);
		assert.deepEqual(prefAudits(harness).map(entry => entry.actorId), [ROLE_ADMIN_USER], "chỉ có lần đổi của admin kia");
	});

	test("form sai (thiếu giá trị lúc vẽ, giá trị lạ) bị từ chối, không ghi gì; thiếu CSRF bị 403", async () =>
	{
		const { harness, auth } = await setup();
		const forms: Record<string, string>[] = [{}, { drawnAllow: "x" }, { drawnAllow: "1", allowPersonal: "yes" }];
		for (const form of forms)
		{
			const flash = await post(harness, auth, "/tiers/personal", form, pageUrl("/tiers/personal"));
			assert.deepEqual(flash, { kind: "error", text: escapeHtml(FORM_INVALID) }, JSON.stringify(form));
		}
		const noCsrf = await call(harness, pageUrl("/tiers/personal"), { cookies: auth.cookies, form: { drawnAllow: "1" } });
		assert.equal(noCsrf.status, 403);
		assert.equal(harness.services.tierSets.allowPersonal(GUILD), true);
		assert.deepEqual(prefAudits(harness), []);
	});

	test("người không phải admin không đổi được công tắc", async () =>
	{
		const harness = createWebHarness();
		await assert.rejects(login(harness, PLAIN_USER));
		const denied = await call(harness, pageUrl("/tiers/personal"), { form: { drawnAllow: "1" } });
		assert.equal(denied.status, 403);
		assert.equal(harness.services.tierSets.allowPersonal(GUILD), true);
	});
});

describe("web: bộ danh hiệu hiển thị ở hồ sơ thành viên (DEC-047)", () =>
{
	test("dòng 'Bộ hiển thị': theo server, tự chọn, hoặc đã chọn nhưng admin đang tắt; nút xoá chỉ hiện khi có lựa chọn", async () =>
	{
		const { harness, auth } = await setup();
		harness.services.tierSets.select(GUILD, "rank-game", ADMIN_USER);

		const none = await getPage(harness, auth, viewUrl(PLAIN_USER));
		assert.ok(none.includes("Bộ hiển thị: <strong>Rank game</strong> (theo server)"), "chưa chọn");
		assert.ok(!none.includes("/members/tier-style-clear"));
		assert.ok(none.includes("Người này chưa tự chọn bộ nào"));

		harness.services.tierSets.chooseForMember(GUILD, PLAIN_USER, "cay-xanh");
		const chosen = await getPage(harness, auth, viewUrl(PLAIN_USER));
		assert.ok(chosen.includes("Bộ hiển thị: <strong>Cây xanh</strong> (tự chọn)"));
		assert.match(chosen, new RegExp(`<form method="post" action="${pageUrl("/members/tier-style-clear")}"[^>]*>[\\s\\S]*?name="u" value="${PLAIN_USER}"[\\s\\S]*?Xoá lựa chọn, về theo server`, "u"));
		assert.ok(chosen.includes("luôn theo bộ của server (Rank game)"));

		harness.services.tierSets.setAllowPersonal(GUILD, false, ADMIN_USER);
		const disabled = await getPage(harness, auth, viewUrl(PLAIN_USER));
		assert.ok(disabled.includes("Bộ hiển thị: <strong>Rank game</strong> (theo server; đã chọn Cây xanh nhưng admin đang tắt tự chọn)"));
		assert.ok(disabled.includes("/members/tier-style-clear"), "vẫn xoá được lựa chọn đã lưu");
	});

	test("xoá lựa chọn: người đó về theo server, audit với người đăng nhập; không có lựa chọn thì báo, không ghi gì; người đã rời server vẫn xoá được", async () =>
	{
		const { harness, auth } = await setup();
		harness.services.tierSets.chooseForMember(GUILD, PLAIN_USER, "cay-xanh");
		harness.services.tierSets.chooseForMember(GUILD, STRANGER, "vu-tru");

		const cleared = await post(harness, auth, "/members/tier-style-clear", { u: PLAIN_USER }, viewUrl(PLAIN_USER));
		assert.equal(cleared.kind, "ok");
		assert.match(cleared.text, /Đã xoá bộ danh hiệu tự chọn \(<strong>Cây xanh<\/strong>\) của <span class="mention">@Thường<\/span>: từ giờ người này hiển thị theo bộ của server \(<strong>Tu tiên<\/strong>\)\./u);
		assert.equal(harness.services.tierSets.memberChoice(GUILD, PLAIN_USER), null);

		const again = await post(harness, auth, "/members/tier-style-clear", { u: PLAIN_USER }, viewUrl(PLAIN_USER));
		assert.deepEqual(again, { kind: "ok", text: escapeHtml(NO_TIER_CHOICE) });

		const left = await post(harness, auth, "/members/tier-style-clear", { u: STRANGER }, viewUrl(STRANGER));
		assert.equal(left.kind, "ok");
		assert.equal(harness.services.tierSets.memberChoice(GUILD, STRANGER), null);

		assert.deepEqual(prefAudits(harness).map(entry => [entry.action, entry.actorId, entry.targetId, entry.details]), [
			["tier_pref.clear", ADMIN_USER, PLAIN_USER, { setKey: "cay-xanh" }],
			["tier_pref.clear", ADMIN_USER, STRANGER, { setKey: "vu-tru" }],
		]);
	});

	test("mã thành viên sai thì về danh sách thành viên; thiếu CSRF bị 403; không ghi gì", async () =>
	{
		const { harness, auth } = await setup();
		harness.services.tierSets.chooseForMember(GUILD, PLAIN_USER, "cay-xanh");
		const bad = await post(harness, auth, "/members/tier-style-clear", { u: "abc" }, pageUrl("/members"));
		assert.equal(bad.kind, "error");
		assert.equal(bad.text, "Mã thành viên không hợp lệ.");
		const noCsrf = await call(harness, pageUrl("/members/tier-style-clear"), { cookies: auth.cookies, form: { u: PLAIN_USER } });
		assert.equal(noCsrf.status, 403);
		assert.equal(harness.services.tierSets.memberChoice(GUILD, PLAIN_USER), "cay-xanh");
		assert.deepEqual(prefAudits(harness), []);
	});

	test("nhật ký quản trị hiện nhãn tiếng Việt và thành viên bị xoá lựa chọn", async () =>
	{
		const { harness, auth } = await setup();
		harness.services.tierSets.chooseForMember(GUILD, PLAIN_USER, "cay-xanh");
		harness.services.tierSets.clearMemberChoice(GUILD, PLAIN_USER, ADMIN_USER);
		harness.services.tierSets.setAllowPersonal(GUILD, false, ADMIN_USER);
		const body = await getPage(harness, auth, pageUrl("/audit"));
		assert.ok(body.includes("Xoá bộ danh hiệu thành viên tự chọn"));
		assert.ok(body.includes("Bộ danh hiệu: Cây xanh"));
		assert.ok(body.includes("Bật/tắt cho thành viên tự chọn bộ danh hiệu"));
		assert.ok(body.includes("Cho thành viên tự chọn bộ: Tắt"));
	});
});
