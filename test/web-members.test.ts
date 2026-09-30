// Test trang "Thành viên" của web quản trị (Phase 17, DEC-041): danh sách theo điểm, tìm kiếm, hồ sơ, cộng/trừ/reset XP và điểm
// contribution. Gọi bộ xử lý thật với service thật trên SQLite :memory: và server Discord giả (test/web-helpers.ts).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ChannelType } from "discord.js";
import { BOT_TARGET, MAX_ADJUST, REASON_MAX_LENGTH } from "../src/discord/adminOps";
import { levelInfo } from "../src/modules/activity/levels";
import { UserError } from "../src/shared/errors";
import { MEMBER_LOOKUP_UNAVAILABLE } from "../src/web/discord";
import { escapeHtml } from "../src/web/html";
import {
	CONFIRM_REQUIRED,
	INVALID_DIRECTION,
	MEMBER_LEFT_NOTE,
	parseContributionDelta,
	parseXpAmount,
	SEARCH_MAX_LENGTH,
	SEARCH_TOO_LONG,
	SEARCH_UNAVAILABLE,
} from "../src/web/pages/members";
import { GUILD } from "./helpers";
import {
	addChannel,
	ADMIN_USER,
	BOT_ID,
	call,
	CHANNEL_CHAT,
	createWebHarness,
	login,
	LoggedIn,
	PLAIN_USER,
	ROLE_ADMIN_BOT,
	ROLE_TEAM_A,
	ROLE_TEAM_B,
	STRANGER,
	WebHarness,
	withCsrf,
} from "./web-helpers";

const CHANNEL_SECRET = "410000000000000031";
const ADMIN_NAME_ESCAPED = "Admin &lt;b&gt;";

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
	const response = await call(harness, pageUrl(path), { cookies: auth.cookies });
	assert.equal(response.status, 200, `GET ${path}`);
	return response.body;
}

/** POST form (kèm CSRF) tới `path`, kiểm tra 303 về `location`, rồi trả về flash hiện ở trang đó. */
async function post(harness: WebHarness, auth: LoggedIn, path: string, form: Record<string, string>, location: string): Promise<Flash>
{
	const response = await call(harness, pageUrl(path), { cookies: auth.cookies, form: withCsrf(auth, form) });
	assert.equal(response.status, 303, `POST ${path}`);
	assert.equal(response.headers.Location, location);
	const page = await call(harness, location, { cookies: auth.cookies });
	assert.equal(page.status, 200);
	const match = /<div class="flash (ok|error)">([\s\S]*?)<\/div>/u.exec(page.body);
	assert.ok(match, "không có flash");
	return { kind: match[1] ?? "", text: match[2] ?? "" };
}

function totalXp(harness: WebHarness, userId: string): number
{
	return harness.services.activity.getProfile(GUILD, userId).level.totalXp;
}

function score(harness: WebHarness, userId: string): number
{
	return harness.services.contributions.getProfile(GUILD, userId).score;
}

function auditCount(harness: WebHarness): number
{
	return harness.services.audit.list(GUILD, 10_000).length;
}

function giveXp(harness: WebHarness, userId: string, delta: number, reason: string | null = null): void
{
	harness.services.activity.adjustXp({ guildId: GUILD, userId, delta, actorId: ADMIN_USER, reason, roleIds: [] });
}

function givePoints(harness: WebHarness, userId: string, delta: number): void
{
	harness.services.contributions.adjust({ guildId: GUILD, userId, delta, actorId: ADMIN_USER, reason: null, roleIds: [] });
}

function syncCalls(harness: WebHarness): string[]
{
	return harness.adminCalls.filter(entry => entry.startsWith("syncTierRoles:"));
}

describe("web thành viên: đọc số từ form", () =>
{
	test("số XP chỉ nhận chữ số trong khoảng 1..1.000.000; điểm contribution cho phép dấu trừ ở đầu, khác 0", () =>
	{
		assert.equal(parseXpAmount(" 250 "), 250);
		assert.equal(parseXpAmount(String(MAX_ADJUST)), MAX_ADJUST);
		for (const bad of ["1.000", "2,5", "-3", "+3", "0", "", "1e3", "abc", String(MAX_ADJUST + 1), null])
		{
			assert.throws(() => parseXpAmount(bad), UserError, String(bad));
		}
		assert.equal(parseContributionDelta("7"), 7);
		assert.equal(parseContributionDelta(" -12 "), -12);
		for (const bad of ["0", "-0", "+5", "1.5", "- 3", "--3", "", String(-MAX_ADJUST - 1), undefined])
		{
			assert.throws(() => parseContributionDelta(bad), UserError, String(bad));
		}
	});
});

describe("web thành viên: danh sách và tìm kiếm", () =>
{
	test("danh sách mặc định theo XP (hạng, tên đã escape, level, tổng XP); tab contribution; tham số lạ về XP", async () =>
	{
		const { harness, auth } = await setup();
		giveXp(harness, PLAIN_USER, 300);
		giveXp(harness, ADMIN_USER, 150);
		givePoints(harness, ADMIN_USER, 12);

		const body = await getPage(harness, auth, "/members");
		assert.ok(!body.includes("Admin <b>"));
		const plain = body.indexOf("Thường");
		const admin = body.indexOf(ADMIN_NAME_ESCAPED, body.indexOf("<table"));
		assert.ok(plain > 0 && admin > plain, "người nhiều XP đứng trước");
		assert.ok(body.includes(`href="${viewUrl(PLAIN_USER)}"`));
		assert.ok(body.includes("300 XP") && body.includes("150 XP"));
		assert.ok(body.includes(`<td class="num">${levelInfo(300).level}</td>`));
		assert.ok(body.includes("class=\"active\">⭐ Theo XP"));

		const points = await getPage(harness, auth, "/members?xep=contribution");
		assert.ok(points.includes("class=\"active\">🤝 Theo contribution"));
		assert.ok(points.includes("12 điểm"));
		assert.ok(!points.includes("Thường"), "người chưa có điểm contribution không có trong danh sách");

		const fallback = await getPage(harness, auth, "/members?xep=%3Cx%3E");
		assert.ok(fallback.includes("class=\"active\">⭐ Theo XP"));
	});

	test("phân trang 25 người mỗi trang, link trang giữ tham số xep", async () =>
	{
		const { harness, auth } = await setup();
		for (let index = 0; index < 30; index += 1) givePoints(harness, `3200000000000000${String(index).padStart(2, "0")}`, index + 1);
		const first = await getPage(harness, auth, "/members?xep=contribution");
		assert.ok(first.includes("Trang 1/2"));
		assert.ok(first.includes(`${pageUrl("/members")}?xep=contribution&amp;trang=2`));
		const second = await getPage(harness, auth, "/members?xep=contribution&trang=2");
		assert.ok(second.includes("Trang 2/2"));
		assert.equal((second.match(/<td class="num">#/gu) ?? []).length, 5);
	});

	test("tìm theo ID hoặc mention chuyển thẳng tới hồ sơ (303), kể cả người đã rời server", async () =>
	{
		const { harness, auth } = await setup();
		for (const [query, userId] of [[PLAIN_USER, PLAIN_USER], [`<@!${PLAIN_USER}>`, PLAIN_USER], [` ${STRANGER} `, STRANGER]] as const)
		{
			const response = await call(harness, `${pageUrl("/members")}?q=${encodeURIComponent(query)}`, { cookies: auth.cookies });
			assert.equal(response.status, 303, query);
			assert.equal(response.headers.Location, viewUrl(userId));
		}
		assert.deepEqual(harness.adminCalls, []);
	});

	test("tìm theo tên gọi Discord (tối đa 25 người), hiện tên, ID, đánh dấu bot và link hồ sơ", async () =>
	{
		const { harness, auth } = await setup();
		const body = await getPage(harness, auth, "/members?q=th");
		assert.deepEqual(harness.adminCalls, ["search:th:25"]);
		assert.ok(body.includes("Thường") && body.includes(PLAIN_USER));
		assert.ok(body.includes(`href="${viewUrl(PLAIN_USER)}"`));
		assert.ok(body.includes("value=\"th\""));

		const bots = await getPage(harness, auth, "/members?q=ezOne");
		assert.ok(bots.includes("ezOne Bot") && bots.includes("<span class=\"badge\">bot</span>"));

		const escaped = await getPage(harness, auth, "/members?q=admin%20%3C");
		assert.ok(escaped.includes(ADMIN_NAME_ESCAPED) && !escaped.includes("Admin <b>"));
		assert.ok(escaped.includes("value=\"admin &lt;\""));

		const none = await getPage(harness, auth, "/members?q=zzz");
		assert.ok(none.includes("Không có thành viên nào có tên bắt đầu bằng"));
	});

	test("từ khoá quá dài hoặc Discord lỗi khi tìm: cảnh báo, trang vẫn hiện", async () =>
	{
		const { harness, auth } = await setup();
		const tooLong = await getPage(harness, auth, `/members?q=${"a".repeat(SEARCH_MAX_LENGTH + 1)}`);
		assert.ok(tooLong.includes(`<div class="warn-box">${escapeHtml(SEARCH_TOO_LONG)}</div>`));
		assert.deepEqual(harness.adminCalls, []);
		await getPage(harness, auth, `/members?q=${"a".repeat(SEARCH_MAX_LENGTH)}`);
		assert.deepEqual(harness.adminCalls, [`search:${"a".repeat(SEARCH_MAX_LENGTH)}:25`]);

		harness.deps.adminActions.searchMembers = () => Promise.reject(new Error("Discord 503"));
		const failed = await getPage(harness, auth, "/members?q=th");
		assert.ok(failed.includes(`<div class="warn-box">${escapeHtml(SEARCH_UNAVAILABLE)}</div>`));
	});
});

describe("web thành viên: hồ sơ", () =>
{
	test("hồ sơ XP: level, tổng XP, hạng, tiến độ, bậc theo bộ danh hiệu đang dùng; biến động có lý do đã escape, người thao tác, đã huỷ", async () =>
	{
		const { harness, auth } = await setup();
		harness.services.tierSets.select(GUILD, "vu-tru", ADMIN_USER);
		giveXp(harness, PLAIN_USER, 150, "<i>thưởng</i>");
		harness.services.activity.resetUser(GUILD, PLAIN_USER, ADMIN_USER);
		giveXp(harness, PLAIN_USER, 200, "sau reset");

		const body = await getPage(harness, auth, `/members/view?u=${PLAIN_USER}`);
		assert.ok(body.includes("<h1>Thường</h1>"));
		assert.ok(body.includes("Thiên thể") && body.includes("🪨 Thiên Thạch"));
		assert.ok(body.includes("#1 / 1"));
		assert.ok(body.includes("value=\"100\" max=\"155\"") && body.includes("100 / 155 XP"));
		assert.ok(body.includes("+200 XP") && body.includes("+150 XP"));
		assert.ok(body.includes("&lt;i&gt;thưởng&lt;/i&gt;") && !body.includes("<i>thưởng</i>"));
		assert.ok(body.includes(ADMIN_NAME_ESCAPED) && !body.includes("Admin <b>"));
		assert.equal((body.match(/<tr class="mb-voided">/gu) ?? []).length, 1);
		assert.ok(body.includes("đã huỷ"));
		for (const path of ["/members/xp", "/members/xp-reset", "/members/contribution", "/members/contribution-reset"])
		{
			assert.ok(body.includes(`action="${pageUrl(path)}"`), path);
		}
		assert.ok(body.includes(`<input type="hidden" name="u" value="${PLAIN_USER}">`));
		assert.ok(body.includes(`name="_csrf" value="${auth.csrf}"`));
	});

	test("hồ sơ contribution: điểm, hạng, contribution gần nhất có link và trạng thái; tiêu đề ở kênh admin không xem được bị ẩn", async () =>
	{
		const { harness, auth } = await setup();
		const { contributions } = harness.services;
		addChannel(harness.world, { id: CHANNEL_SECRET, name: "luong-thuong", type: ChannelType.GuildText, permissionsByMember: { [ADMIN_USER]: [] } });
		const submit = (title: string): number =>
		{
			const created = contributions.submit({ guildId: GUILD, authorId: PLAIN_USER, submittedBy: PLAIN_USER, title, description: "Mô tả", category: "y-tuong", link: null, authorRoleIds: [] });
			harness.clock.advance(1000);
			return created.id;
		};
		const visible = submit("Tài liệu <onboarding>");
		const secret = submit("Bảng lương quý");
		const removed = submit("Ý tưởng cũ");
		contributions.attachMessage(GUILD, visible, CHANNEL_CHAT, "610000000000000001");
		contributions.attachMessage(GUILD, secret, CHANNEL_SECRET, "610000000000000002");
		contributions.remove(GUILD, removed, ADMIN_USER);
		givePoints(harness, PLAIN_USER, 9);

		const body = await getPage(harness, auth, `/members/view?u=${PLAIN_USER}`);
		assert.ok(body.includes(`href="${pageUrl(`/contributions/view?id=${visible}`)}"`));
		assert.ok(body.includes("Tài liệu &lt;onboarding&gt;"));
		assert.ok(!body.includes("Bảng lương quý"));
		assert.ok(body.includes("(ở kênh bạn không xem được)"));
		assert.ok(body.includes("<span class=\"badge off\">đã gỡ</span>"));
		assert.ok(body.includes("<div class=\"label\">Contribution còn hiệu lực</div><div class=\"value\">2</div>"));
		assert.ok(body.includes("<div class=\"label\">Điểm</div><div class=\"value\">9</div>"));
	});

	test("người đã rời server vẫn xem được và có form, kèm cảnh báo; bot chỉ có thông báo, không có form", async () =>
	{
		const { harness, auth } = await setup();
		const stranger = await getPage(harness, auth, `/members/view?u=${STRANGER}`);
		assert.ok(stranger.includes(escapeHtml(MEMBER_LEFT_NOTE)));
		assert.ok(stranger.includes("đã rời server"));
		assert.ok(stranger.includes(`action="${pageUrl("/members/xp")}"`));

		const bot = await getPage(harness, auth, `/members/view?u=${BOT_ID}`);
		assert.ok(bot.includes(BOT_TARGET));
		assert.ok(!bot.includes(`action="${pageUrl("/members/xp")}"`));
		assert.ok(!bot.includes("name=\"u\""));
	});

	test("mã thành viên sai hoặc Discord lỗi khi lấy thành viên: trang báo lỗi 400", async () =>
	{
		const { harness, auth } = await setup();
		for (const query of ["", "?u=abc", "?u=123", "?u=%3Cscript%3E"])
		{
			const response = await call(harness, pageUrl(`/members/view${query}`), { cookies: auth.cookies });
			assert.equal(response.status, 400, query);
			assert.ok(response.body.includes("Mã thành viên không hợp lệ."));
		}
		const realFetch = harness.world.guild.members.fetch.bind(harness.world.guild.members);
		let calls = 0;
		Object.assign(harness.world.guild.members, {
			fetch: (options: { user: string }) =>
			{
				calls += 1;
				return calls === 1 ? realFetch(options) : Promise.reject(Object.assign(new Error("Service Unavailable"), { status: 503 }));
			},
		});
		const down = await call(harness, viewUrl(PLAIN_USER), { cookies: auth.cookies });
		assert.equal(down.status, 400);
		assert.ok(down.body.includes(MEMBER_LOOKUP_UNAVAILABLE));
	});
});

describe("web thành viên: điều chỉnh điểm", () =>
{
	test("cộng rồi trừ XP: ghi qua service với người đăng nhập, team theo role hiện có, đồng bộ role danh hiệu, flash kèm dòng role", async () =>
	{
		const { harness, auth } = await setup();
		harness.services.teams.add(GUILD, ROLE_TEAM_A, ADMIN_USER);
		const spec = harness.world.members.get(PLAIN_USER);
		assert.ok(spec);
		spec.roleIds.push(ROLE_TEAM_A);
		harness.tierSync.result = { added: [ROLE_TEAM_B], removed: [], skipped: [] };

		const given = await post(harness, auth, "/members/xp", { u: PLAIN_USER, "so-xp": " 300 ", "ly-do": " thưởng dự án ", huong: "cong" }, viewUrl(PLAIN_USER));
		assert.equal(given.kind, "ok");
		assert.match(given.text, /Đã cộng 300 XP/u);
		assert.match(given.text, /Tổng: 300 XP\.<br>🏅 Role danh hiệu: đã thêm/u);
		assert.equal(totalXp(harness, PLAIN_USER), 300);
		assert.deepEqual(syncCalls(harness), [`syncTierRoles:${PLAIN_USER}:${levelInfo(300).level}`]);
		const [entry] = harness.services.audit.list(GUILD, 1);
		assert.equal(entry?.action, "xp.adjust");
		assert.equal(entry?.actorId, ADMIN_USER);
		assert.equal(entry?.targetId, PLAIN_USER);
		assert.equal(entry?.details?.reason, "thưởng dự án");
		const teams = harness.services.leaderboard.query({ guildId: GUILD, kind: "activity", scope: "team", period: "all", page: 1 });
		assert.deepEqual(teams.entries.map(team => [team.id, team.value]), [[ROLE_TEAM_A, 300]]);

		harness.tierSync.result = { added: [], removed: [], skipped: [] };
		const taken = await post(harness, auth, "/members/xp", { u: PLAIN_USER, "so-xp": "100", "ly-do": "", huong: "tru" }, viewUrl(PLAIN_USER));
		assert.equal(taken.kind, "ok");
		assert.match(taken.text, /Đã trừ 100 XP/u);
		assert.ok(!taken.text.includes("Role danh hiệu"));
		assert.equal(totalXp(harness, PLAIN_USER), 200);
		assert.equal(syncCalls(harness).at(-1), `syncTierRoles:${PLAIN_USER}:${levelInfo(200).level}`);
		assert.equal(harness.services.audit.list(GUILD, 1)[0]?.details?.reason, null);
	});

	test("lỗi nghiệp vụ, số sai định dạng, nút lạ, lý do quá dài: flash lỗi ở trang hồ sơ, không ghi gì", async () =>
	{
		const { harness, auth } = await setup();
		giveXp(harness, PLAIN_USER, 40);
		const before = auditCount(harness);
		const form = { u: PLAIN_USER, "ly-do": "", huong: "cong" };

		const tooMuch = await post(harness, auth, "/members/xp", { ...form, "so-xp": "50", huong: "tru" }, viewUrl(PLAIN_USER));
		assert.equal(tooMuch.kind, "error");
		assert.match(tooMuch.text, /Không thể trừ quá số XP hiện có/u);

		for (const bad of ["1.000", "2,5", "-3", "0", "", "1e3", String(MAX_ADJUST + 1)])
		{
			const flash = await post(harness, auth, "/members/xp", { ...form, "so-xp": bad }, viewUrl(PLAIN_USER));
			assert.equal(flash.kind, "error", bad);
			assert.match(flash.text, /Số XP phải là số nguyên từ 1 đến 1\.000\.000/u, bad);
		}
		const direction = await post(harness, auth, "/members/xp", { ...form, "so-xp": "5", huong: "nhan" }, viewUrl(PLAIN_USER));
		assert.equal(direction.text, escapeHtml(INVALID_DIRECTION));
		const reason = await post(harness, auth, "/members/xp", { ...form, "so-xp": "5", "ly-do": "a".repeat(REASON_MAX_LENGTH + 1) }, viewUrl(PLAIN_USER));
		assert.match(reason.text, /Lý do tối đa 200 ký tự/u);

		assert.equal(totalXp(harness, PLAIN_USER), 40);
		assert.equal(auditCount(harness), before);
		assert.deepEqual(syncCalls(harness), []);
	});

	test("reset XP một người cần tick xác nhận; reset xong đồng bộ role về level 0", async () =>
	{
		const { harness, auth } = await setup();
		giveXp(harness, PLAIN_USER, 500);
		const refused = await post(harness, auth, "/members/xp-reset", { u: PLAIN_USER }, viewUrl(PLAIN_USER));
		assert.equal(refused.kind, "error");
		assert.equal(refused.text, escapeHtml(CONFIRM_REQUIRED));
		assert.equal(totalXp(harness, PLAIN_USER), 500);

		const done = await post(harness, auth, "/members/xp-reset", { u: PLAIN_USER, "xac-nhan": "1" }, viewUrl(PLAIN_USER));
		assert.equal(done.kind, "ok");
		assert.match(done.text, /Đã reset XP của .*Thường.* \(huỷ 1 biến động\)\. Tổng: 0 XP\./u);
		assert.equal(totalXp(harness, PLAIN_USER), 0);
		assert.deepEqual(syncCalls(harness), [`syncTierRoles:${PLAIN_USER}:0`]);
		const [entry] = harness.services.audit.list(GUILD, 1);
		assert.deepEqual([entry?.action, entry?.actorId, entry?.targetId], ["xp.reset_user", ADMIN_USER, PLAIN_USER]);
	});

	test("điểm contribution: cộng, trừ bằng số âm, không trừ quá số hiện có, số sai bị từ chối, reset cần xác nhận; không đồng bộ role", async () =>
	{
		const { harness, auth } = await setup();
		const at = viewUrl(PLAIN_USER);
		const added = await post(harness, auth, "/members/contribution", { u: PLAIN_USER, diem: "7", "ly-do": "hỗ trợ" }, at);
		assert.equal(added.kind, "ok");
		assert.match(added.text, /Đã cộng 7 điểm contribution/u);
		const [entry] = harness.services.audit.list(GUILD, 1);
		assert.deepEqual([entry?.action, entry?.actorId, entry?.targetId, entry?.details?.reason], ["contribution.adjust", ADMIN_USER, PLAIN_USER, "hỗ trợ"]);

		const taken = await post(harness, auth, "/members/contribution", { u: PLAIN_USER, diem: " -3 " }, at);
		assert.match(taken.text, /Đã trừ 3 điểm contribution.*Tổng: 4 điểm/u);
		assert.equal(score(harness, PLAIN_USER), 4);

		const tooMuch = await post(harness, auth, "/members/contribution", { u: PLAIN_USER, diem: "-10" }, at);
		assert.equal(tooMuch.kind, "error");
		assert.match(tooMuch.text, /Không thể trừ quá số điểm hiện có/u);
		const zero = await post(harness, auth, "/members/contribution", { u: PLAIN_USER, diem: "0" }, at);
		assert.equal(zero.text, "Số điểm phải khác 0.");
		for (const bad of ["+5", "1.5", "2,5", "- 3", "", String(MAX_ADJUST + 1)])
		{
			const flash = await post(harness, auth, "/members/contribution", { u: PLAIN_USER, diem: bad }, at);
			assert.equal(flash.kind, "error", bad);
			assert.match(flash.text, /Số điểm phải là số nguyên/u, bad);
		}
		assert.equal(score(harness, PLAIN_USER), 4);

		const refused = await post(harness, auth, "/members/contribution-reset", { u: PLAIN_USER }, at);
		assert.equal(refused.text, escapeHtml(CONFIRM_REQUIRED));
		const reset = await post(harness, auth, "/members/contribution-reset", { u: PLAIN_USER, "xac-nhan": "1" }, at);
		assert.match(reset.text, /Đã reset điểm contribution của .* Tổng: 0 điểm\./u);
		assert.equal(score(harness, PLAIN_USER), 0);
		assert.equal(harness.services.audit.list(GUILD, 1)[0]?.action, "contribution.reset_user");
		assert.deepEqual(syncCalls(harness), []);
	});

	test("người đã rời server vẫn chỉnh được: không tính team, không gọi đồng bộ role", async () =>
	{
		const { harness, auth } = await setup();
		harness.services.teams.add(GUILD, ROLE_TEAM_A, ADMIN_USER);
		const at = viewUrl(STRANGER);
		const flash = await post(harness, auth, "/members/xp", { u: STRANGER, "so-xp": "50", huong: "cong" }, at);
		assert.equal(flash.kind, "ok");
		assert.equal(totalXp(harness, STRANGER), 50);
		assert.equal((await post(harness, auth, "/members/contribution", { u: STRANGER, diem: "5" }, at)).kind, "ok");
		assert.equal(score(harness, STRANGER), 5);
		assert.equal((await post(harness, auth, "/members/xp-reset", { u: STRANGER, "xac-nhan": "1" }, at)).kind, "ok");
		assert.deepEqual(syncCalls(harness), []);
		assert.deepEqual(harness.services.audit.list(GUILD, 3).map(entry => [entry.action, entry.targetId, entry.actorId]), [
			["xp.reset_user", STRANGER, ADMIN_USER],
			["contribution.adjust", STRANGER, ADMIN_USER],
			["xp.adjust", STRANGER, ADMIN_USER],
		]);
		const teams = harness.services.leaderboard.query({ guildId: GUILD, kind: "contribution", scope: "team", period: "all", page: 1 });
		assert.deepEqual(teams.entries, []);
	});

	test("bot bị từ chối; mã thành viên sai thì về danh sách thành viên", async () =>
	{
		const { harness, auth } = await setup();
		const before = auditCount(harness);
		const bot = await post(harness, auth, "/members/xp", { u: BOT_ID, "so-xp": "10", huong: "cong" }, viewUrl(BOT_ID));
		assert.equal(bot.kind, "error");
		assert.equal(bot.text, BOT_TARGET);
		const botPoints = await post(harness, auth, "/members/contribution-reset", { u: BOT_ID, "xac-nhan": "1" }, viewUrl(BOT_ID));
		assert.equal(botPoints.text, BOT_TARGET);
		assert.equal(totalXp(harness, BOT_ID), 0);

		const bad = await post(harness, auth, "/members/xp", { u: "abc", "so-xp": "10", huong: "cong" }, pageUrl("/members"));
		assert.equal(bad.text, "Mã thành viên không hợp lệ.");
		assert.equal(auditCount(harness), before);
	});

	test("POST thiếu hoặc sai CSRF bị 403, không ghi gì", async () =>
	{
		const { harness, auth } = await setup();
		const form = { u: PLAIN_USER, "so-xp": "10", huong: "cong" };
		assert.equal((await call(harness, pageUrl("/members/xp"), { cookies: auth.cookies, form })).status, 403);
		assert.equal((await call(harness, pageUrl("/members/xp"), { cookies: auth.cookies, form: { ...form, _csrf: "sai" } })).status, 403);
		assert.equal(totalXp(harness, PLAIN_USER), 0);
		assert.equal(auditCount(harness), 0);
	});

	test("người không phải admin không vào được trang và không chỉnh được điểm", async () =>
	{
		const harness = createWebHarness();
		await assert.rejects(login(harness, PLAIN_USER));
		harness.services.guildConfig.updateSettings(GUILD, { adminRoleId: ROLE_ADMIN_BOT }, ADMIN_USER);
		const spec = harness.world.members.get(PLAIN_USER);
		assert.ok(spec);
		spec.roleIds = [ROLE_ADMIN_BOT];
		const auth = await login(harness, PLAIN_USER);
		spec.roleIds = [];

		assert.equal((await call(harness, pageUrl("/members"), { cookies: auth.cookies })).status, 403);
		const posted = await call(harness, pageUrl("/members/xp"), { cookies: auth.cookies, form: withCsrf(auth, { u: PLAIN_USER, "so-xp": "10", huong: "cong" }) });
		assert.equal(posted.status, 403);
		assert.equal(totalXp(harness, PLAIN_USER), 0);
	});
});
