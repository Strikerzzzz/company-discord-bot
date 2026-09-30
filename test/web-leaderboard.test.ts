// Test trang "Bảng xếp hạng" của web quản trị (Phase 17, DEC-041): 12 bảng như `/leaderboard`, tham số trong query, phân trang,
// kỳ tuần/tháng theo giờ Việt Nam. Service thật trên SQLite :memory: và server Discord giả (test/web-helpers.ts).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatNumber } from "../src/discord/format";
import { startOfVnMonth, startOfVnWeek } from "../src/shared/time";
import { NO_LEADERBOARD_ENTRIES } from "../src/web/pages/leaderboard";
import { formatDateTime } from "../src/web/widgets";
import { GUILD } from "./helpers";
import {
	ADMIN_USER,
	call,
	createWebHarness,
	login,
	LoggedIn,
	PLAIN_USER,
	ROLE_ADMIN_USER,
	ROLE_TEAM_A,
	ROLE_TEAM_B,
	WebHarness,
} from "./web-helpers";

const ROLE_GONE = "520000000000000999";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function boardUrl(query: string): string
{
	return `/g/${GUILD}/leaderboard${query}`;
}

async function getBoard(harness: WebHarness, auth: LoggedIn, query = ""): Promise<string>
{
	const response = await call(harness, boardUrl(query), { cookies: auth.cookies });
	assert.equal(response.status, 200, `GET leaderboard${query}`);
	return response.body;
}

/** href đã escape (như trong HTML) của bảng với các tham số cho trước, không có tham số trang. */
function tabHref(kind: string, scope: string, period: string): string
{
	return `${boardUrl("")}?loai=${kind}&amp;pv=${scope}&amp;ky=${period}`;
}

function activeTabs(body: string): string[]
{
	return [...body.matchAll(/<a class="active" href="([^"]+)" aria-current="page">/gu)].map(match => match[1] ?? "");
}

function rowCount(body: string): number
{
	return body.split("<td class=\"lb-rank\">").length - 1;
}

function giveXp(harness: WebHarness, userId: string, amount: number, roleIds: readonly string[] = []): void
{
	harness.services.activity.adjustXp({ guildId: GUILD, userId, delta: amount, actorId: ADMIN_USER, reason: null, roleIds });
}

function giveContribution(harness: WebHarness, userId: string, amount: number, roleIds: readonly string[] = []): void
{
	harness.services.contributions.adjust({ guildId: GUILD, userId, delta: amount, actorId: ADMIN_USER, reason: null, roleIds });
}

describe("web: trang Bảng xếp hạng (DEC-041)", () =>
{
	test("mặc định là Activity cá nhân kỳ tổng: đúng thứ tự, điểm định dạng, level, tên được escape, không lẫn Contribution", async () =>
	{
		const harness = createWebHarness();
		giveXp(harness, PLAIN_USER, 1500);
		giveXp(harness, ADMIN_USER, 300);
		giveContribution(harness, ROLE_ADMIN_USER, 7);
		const auth = await login(harness, ADMIN_USER);
		const body = await getBoard(harness, auth);

		assert.deepEqual(activeTabs(body), [
			tabHref("activity", "ca-nhan", "all"),
			tabHref("activity", "ca-nhan", "all"),
			tabHref("activity", "ca-nhan", "all"),
		]);
		assert.ok(body.includes(`<td class="num">${formatNumber(1500)}</td>`), "điểm định dạng kiểu Việt Nam");
		assert.ok(body.includes("<th class=\"num\">Level</th>"));
		const plain = body.indexOf(`/members/view?u=${PLAIN_USER}`);
		const admin = body.indexOf(`/members/view?u=${ADMIN_USER}`);
		assert.ok(plain > 0 && admin > plain, "người nhiều XP đứng trước");
		assert.ok(!body.includes(`/members/view?u=${ROLE_ADMIN_USER}`), "người chỉ có điểm contribution không có trên bảng Activity");
		assert.ok(body.includes("Admin &lt;b&gt;"));
		assert.ok(!body.includes("Admin <b>"));
		assert.ok(body.includes("2 người có điểm"));
	});

	test("tham số sai hoặc lạ về mặc định, không phản chiếu chữ từ query", async () =>
	{
		const harness = createWebHarness();
		giveXp(harness, PLAIN_USER, 40);
		giveContribution(harness, ADMIN_USER, 9);
		const auth = await login(harness, ADMIN_USER);
		const body = await getBoard(harness, auth, "?loai=xp&pv=%3Cscript%3Ealert(1)%3C%2Fscript%3E&ky=nam&trang=-3");

		assert.deepEqual(new Set(activeTabs(body)), new Set([tabHref("activity", "ca-nhan", "all")]));
		assert.ok(body.includes(`/members/view?u=${PLAIN_USER}`));
		assert.ok(!body.includes(`/members/view?u=${ADMIN_USER}`));
		assert.ok(!body.includes("<script>") && !body.includes("alert(1)"));
		assert.ok(body.includes("Trang 1/1"));
	});

	test("bảng team: chỉ team đang cấu hình, hiện tên role (role đã xoá thì chip thiếu); tab giữ tham số và về trang 1", async () =>
	{
		const harness = createWebHarness();
		const { services } = harness;
		services.teams.add(GUILD, ROLE_TEAM_A, ADMIN_USER);
		services.teams.add(GUILD, ROLE_GONE, ADMIN_USER);
		giveContribution(harness, PLAIN_USER, 12, [ROLE_TEAM_A, ROLE_TEAM_B]);
		giveContribution(harness, ADMIN_USER, 5, [ROLE_GONE]);
		giveXp(harness, PLAIN_USER, 80, [ROLE_TEAM_A]);
		const auth = await login(harness, ADMIN_USER);
		const body = await getBoard(harness, auth, "?loai=contribution&pv=team&ky=all&trang=4");

		assert.deepEqual(new Set(activeTabs(body)), new Set([
			tabHref("contribution", "team", "all"),
		]));
		const backend = body.indexOf("<span class=\"chip\">@Backend</span>");
		const gone = body.indexOf(`<span class="chip chip-missing">@role-không-còn (${ROLE_GONE})</span>`);
		assert.ok(backend > 0 && gone > backend, "team nhiều điểm đứng trước, role đã xoá vẫn hiện");
		assert.ok(!body.includes("@Frontend"), "role không phải team không có trên bảng");
		assert.ok(body.includes(`<td class="num">${formatNumber(12)}</td>`));
		assert.ok(!body.includes("<th class=\"num\">Level</th>"));
		assert.ok(body.includes(`href="/g/${GUILD}/teams"`), "ghi chú bảng team có link tới trang Team");
		assert.ok(!body.includes("/members/view?u="));

		assert.ok(body.includes(`href="${tabHref("activity", "team", "all")}"`), "đổi loại giữ phạm vi và kỳ, không mang trang");
		assert.ok(body.includes(`href="${tabHref("contribution", "ca-nhan", "all")}"`));
		assert.ok(body.includes(`href="${tabHref("contribution", "team", "week")}"`));
		assert.ok(!/leaderboard\?[^"]*trang=/u.test(body), "tab và bảng một trang không có link trang");

		const activityTeams = await getBoard(harness, auth, "?loai=activity&pv=team");
		assert.ok(activityTeams.includes("<span class=\"chip\">@Backend</span>"));
		assert.ok(activityTeams.includes(`<td class="num">${formatNumber(80)}</td>`));
	});

	test("kỳ tuần/tháng: chỉ điểm kiếm được trong kỳ, mốc bắt đầu theo giờ Việt Nam; kỳ trống báo chưa có ai", async () =>
	{
		const harness = createWebHarness();
		const { clock } = harness;
		giveXp(harness, PLAIN_USER, 500);
		clock.advance(4 * DAY_MS + 3 * HOUR_MS);
		const auth = await login(harness, ADMIN_USER);

		const emptyWeek = await getBoard(harness, auth, "?ky=week");
		assert.ok(emptyWeek.includes(NO_LEADERBOARD_ENTRIES));
		assert.ok(emptyWeek.includes("00:00 thứ Hai"));
		assert.ok(emptyWeek.includes(formatDateTime(startOfVnWeek(clock.now()))));

		giveXp(harness, ADMIN_USER, 50);
		const week = await getBoard(harness, auth, "?loai=activity&pv=ca-nhan&ky=week");
		assert.ok(week.includes(`/members/view?u=${ADMIN_USER}`));
		assert.ok(!week.includes(`/members/view?u=${PLAIN_USER}`), "điểm của tuần trước không tính vào tuần này");
		assert.ok(week.includes(`<td class="num">${formatNumber(50)}</td>`));
		assert.ok(!week.includes("<th class=\"num\">Level</th>"), "kỳ tuần không hiện level (điểm kỳ không phải tổng XP)");

		const month = await getBoard(harness, auth, "?ky=month");
		assert.ok(month.includes("00:00 ngày 1"));
		assert.ok(month.includes(formatDateTime(startOfVnMonth(clock.now()))));
		const plain = month.indexOf(`/members/view?u=${PLAIN_USER}`);
		const admin = month.indexOf(`/members/view?u=${ADMIN_USER}`);
		assert.ok(plain > 0 && admin > plain, "cùng tháng: cả hai, người nhiều điểm trước");
	});

	test("phân trang 25 dòng: link trang giữ loại/phạm vi/kỳ, trang vượt quá bị kẹp, hạng tiếp nối", async () =>
	{
		const harness = createWebHarness();
		for (let index = 1; index <= 30; index += 1)
		{
			giveXp(harness, `3200000000000000${String(index).padStart(2, "0")}`, 1000 - index * 10);
		}
		const auth = await login(harness, ADMIN_USER);

		const first = await getBoard(harness, auth, "?loai=activity&pv=ca-nhan&ky=month");
		assert.equal(rowCount(first), 25);
		assert.ok(first.includes("Trang 1/2"));
		assert.ok(first.includes(`href="${tabHref("activity", "ca-nhan", "month")}&amp;trang=2"`), "link Sau giữ tham số");

		const second = await getBoard(harness, auth, "?loai=activity&pv=ca-nhan&ky=month&trang=2");
		assert.equal(rowCount(second), 5);
		assert.ok(second.includes("<td class=\"lb-rank\">#26</td>"));
		assert.ok(second.includes("<td class=\"lb-rank\">#30</td>"));
		assert.ok(second.includes(`href="${tabHref("activity", "ca-nhan", "month")}&amp;trang=1"`), "link Trước giữ tham số");
		assert.ok(second.includes("30 người có điểm"));

		const clamped = await getBoard(harness, auth, "?ky=month&trang=99");
		assert.ok(clamped.includes("Trang 2/2"));
		assert.equal(rowCount(clamped), 5);
	});
});
