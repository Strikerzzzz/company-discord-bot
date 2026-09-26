import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "../src/db/connection";
import { Ledger } from "../src/modules/ledger/Ledger";
import { vnDayNumber } from "../src/shared/time";
import {
	ADMIN,
	createTestContext,
	GUILD,
	OTHER_GUILD,
	ROLE_BACKEND,
	ROLE_FRONTEND,
	ROLE_OTHER,
	TestContext,
	USER_A,
	USER_B,
	USER_C,
} from "./helpers";

const USER_D = "300000000000000004";
const USER_E = "300000000000000005";
const USER_F = "300000000000000006";
const ROLE_QA = "500000000000000003";

const SINCE = Date.UTC(2026, 8, 27, 17, 0);
const HOUR = 3_600_000;

/** Ghi một event tại thời điểm `at` (đặt đồng hồ giả rồi ghi qua Ledger thật). */
function recordAt(context: TestContext, ledger: Ledger, at: number, userId: string, amount: number, options: { source?: string; guildId?: string; teamRoleIds?: string[] } = {}): number
{
	context.clock.current = at;
	return ledger.record({
		guildId: options.guildId ?? GUILD,
		userId,
		amount,
		source: options.source ?? "admin",
		teamRoleIds: options.teamRoleIds,
	}).id;
}

/** Dòng EXPLAIN QUERY PLAN đọc một bảng thật (e, et, r) của truy vấn team, bỏ qua các dòng của subquery. */
const TABLE_ACCESS = /^(SEARCH|SCAN) (e|et|r) /;

/** Các dòng EXPLAIN QUERY PLAN của một statement đã prepare. */
function queryPlan(db: Db, statement: { readonly source: string }, params: unknown[]): string[]
{
	return db.prepare<unknown[], { detail: string }>(`EXPLAIN QUERY PLAN ${statement.source}`).all(...params).map(row => row.detail);
}

describe("Ledger: xếp hạng cá nhân theo kỳ", () =>
{
	function seed(): TestContext
	{
		const context = createTestContext();
		const ledger = context.deps.xpLedger;
		recordAt(context, ledger, SINCE - 1, USER_A, 100);
		recordAt(context, ledger, SINCE, USER_A, 30);
		recordAt(context, ledger, SINCE + HOUR, USER_B, 20);
		recordAt(context, ledger, SINCE + 2 * HOUR, USER_B, 10);
		recordAt(context, ledger, SINCE + HOUR, USER_C, 10);
		const voided = recordAt(context, ledger, SINCE + HOUR, USER_D, 50);
		ledger.voidEvent(voided);
		recordAt(context, ledger, SINCE + 3 * HOUR, USER_D, 5);
		recordAt(context, ledger, SINCE + HOUR, USER_E, 10);
		recordAt(context, ledger, SINCE + 2 * HOUR, USER_E, -10);
		recordAt(context, ledger, SINCE + HOUR, USER_F, -5);
		recordAt(context, ledger, SINCE + HOUR, USER_A, 1_000, { guildId: OTHER_GUILD });
		return context;
	}

	test("hoà điểm cùng hạng (1, 1, 3); tính cả mốc since; bỏ event trước kỳ, event đã huỷ và tổng <= 0", () =>
	{
		const { deps } = seed();
		const ledger = deps.xpLedger;

		assert.deepEqual(ledger.topSince(GUILD, SINCE, 10), [
			{ id: USER_A, total: 30, rank: 1 },
			{ id: USER_B, total: 30, rank: 1 },
			{ id: USER_C, total: 10, rank: 3 },
			{ id: USER_D, total: 5, rank: 4 },
		]);
		assert.equal(ledger.countRankedSince(GUILD, SINCE), 4);
		assert.deepEqual(ledger.topSince(GUILD, SINCE - 1, 1), [{ id: USER_A, total: 130, rank: 1 }], "since sớm hơn 1 ms thì có event trước đó");
	});

	test("hạng tính trên toàn bảng trước khi phân trang", () =>
	{
		const { deps } = seed();
		assert.deepEqual(deps.xpLedger.topSince(GUILD, SINCE, 2, 1), [
			{ id: USER_B, total: 30, rank: 1 },
			{ id: USER_C, total: 10, rank: 3 },
		]);
		assert.deepEqual(deps.xpLedger.topSince(GUILD, SINCE, 10, 10), []);
	});

	test("rankSince khớp hạng của topSince; người không có điểm dương trong kỳ có rank null", () =>
	{
		const { deps } = seed();
		const ledger = deps.xpLedger;
		for (const entry of ledger.topSince(GUILD, SINCE, 10))
		{
			assert.deepEqual(ledger.rankSince(GUILD, entry.id, SINCE), { rank: entry.rank, total: entry.total, totalRanked: 4 }, entry.id);
		}
		assert.deepEqual(ledger.rankSince(GUILD, USER_E, SINCE), { rank: null, total: 0, totalRanked: 4 });
		assert.deepEqual(ledger.rankSince(GUILD, USER_F, SINCE), { rank: null, total: -5, totalRanked: 4 });
		assert.deepEqual(ledger.rankSince(GUILD, "399999999999999999", SINCE), { rank: null, total: 0, totalRanked: 4 });
	});

	test("tách guild và tách hai loại điểm", () =>
	{
		const { deps } = seed();
		assert.deepEqual(deps.xpLedger.topSince(OTHER_GUILD, SINCE, 10), [{ id: USER_A, total: 1_000, rank: 1 }]);
		assert.deepEqual(deps.xpLedger.rankSince(OTHER_GUILD, USER_A, SINCE), { rank: 1, total: 1_000, totalRanked: 1 });
		assert.deepEqual(deps.contributionLedger.topSince(GUILD, SINCE, 10), []);
		assert.equal(deps.contributionLedger.countRankedSince(GUILD, SINCE), 0);
	});

	test("kỳ chưa có event: bảng rỗng", () =>
	{
		const { deps } = seed();
		const later = SINCE + 10 * HOUR;
		assert.deepEqual(deps.xpLedger.topSince(GUILD, later, 10), []);
		assert.equal(deps.xpLedger.countRankedSince(GUILD, later), 0);
		assert.deepEqual(deps.xpLedger.rankSince(GUILD, USER_A, later), { rank: null, total: 0, totalRanked: 0 });
	});

	test("ledger Contribution dùng cùng quy tắc", () =>
	{
		const context = createTestContext();
		const ledger = context.deps.contributionLedger;
		recordAt(context, ledger, SINCE - 1, USER_C, 50, { source: "vote" });
		recordAt(context, ledger, SINCE, USER_A, 3, { source: "vote" });
		recordAt(context, ledger, SINCE + HOUR, USER_B, 3, { source: "vote" });
		recordAt(context, ledger, SINCE + HOUR, USER_C, 1, { source: "vote" });

		assert.deepEqual(ledger.topSince(GUILD, SINCE, 10), [
			{ id: USER_A, total: 3, rank: 1 },
			{ id: USER_B, total: 3, rank: 1 },
			{ id: USER_C, total: 1, rank: 3 },
		]);
		assert.deepEqual(ledger.rankSince(GUILD, USER_C, SINCE), { rank: 3, total: 1, totalRanked: 3 });
	});
});

describe("Ledger: xếp hạng team theo kỳ", () =>
{
	function seed(): TestContext
	{
		const context = createTestContext();
		const { teams, xpLedger } = context.deps;
		for (const role of [ROLE_BACKEND, ROLE_FRONTEND, ROLE_QA]) teams.add(GUILD, role, ADMIN);
		recordAt(context, xpLedger, SINCE - 1, USER_A, 100, { teamRoleIds: [ROLE_BACKEND] });
		recordAt(context, xpLedger, SINCE, USER_A, 40, { teamRoleIds: [ROLE_BACKEND, ROLE_FRONTEND] });
		recordAt(context, xpLedger, SINCE + HOUR, USER_B, 10, { teamRoleIds: [ROLE_QA] });
		recordAt(context, xpLedger, SINCE + HOUR, USER_B, 70, { teamRoleIds: [ROLE_OTHER] });
		recordAt(context, xpLedger, SINCE + HOUR, USER_C, 25, { teamRoleIds: [] });
		const voided = recordAt(context, xpLedger, SINCE + HOUR, USER_C, 500, { teamRoleIds: [ROLE_QA] });
		xpLedger.voidEvent(voided);
		recordAt(context, xpLedger, SINCE + HOUR, USER_A, 999, { guildId: OTHER_GUILD, teamRoleIds: [ROLE_BACKEND] });
		return context;
	}

	test("chỉ team đang cấu hình; snapshot nhiều team cộng cho từng team; hoà điểm cùng hạng", () =>
	{
		const { deps } = seed();
		const ledger = deps.xpLedger;
		assert.deepEqual(ledger.topTeamsSince(GUILD, SINCE, 10), [
			{ id: ROLE_BACKEND, total: 40, rank: 1 },
			{ id: ROLE_FRONTEND, total: 40, rank: 1 },
			{ id: ROLE_QA, total: 10, rank: 3 },
		]);
		assert.equal(ledger.countTeamsSince(GUILD, SINCE), 3);
		assert.deepEqual(ledger.topTeamsSince(GUILD, SINCE, 1, 1), [{ id: ROLE_FRONTEND, total: 40, rank: 1 }]);
		assert.deepEqual(ledger.topTeamsSince(GUILD, SINCE - 1, 1), [{ id: ROLE_BACKEND, total: 140, rank: 1 }]);
	});

	test("bỏ cấu hình team thì team biến mất; tổng <= 0 bị loại; tách guild", () =>
	{
		const context = seed();
		const { deps } = context;
		deps.teams.remove(GUILD, ROLE_FRONTEND, ADMIN);
		recordAt(context, deps.xpLedger, SINCE + 2 * HOUR, USER_B, -10, { teamRoleIds: [ROLE_QA] });

		assert.deepEqual(deps.xpLedger.topTeamsSince(GUILD, SINCE, 10), [{ id: ROLE_BACKEND, total: 40, rank: 1 }]);
		assert.equal(deps.xpLedger.countTeamsSince(GUILD, SINCE), 1);
		assert.deepEqual(deps.xpLedger.topTeamsSince(OTHER_GUILD, SINCE, 10), [], "OTHER_GUILD chưa cấu hình team nào");
		deps.teams.add(OTHER_GUILD, ROLE_BACKEND, ADMIN);
		assert.deepEqual(deps.xpLedger.topTeamsSince(OTHER_GUILD, SINCE, 10), [{ id: ROLE_BACKEND, total: 999, rank: 1 }]);
		assert.deepEqual(deps.contributionLedger.topTeamsSince(GUILD, SINCE, 10), []);
	});
});

describe("Ledger: ngày hoạt động và số event", () =>
{
	const LAST_MS_OF_DAY = Date.UTC(2026, 8, 28, 16, 59, 59, 999);
	const NEXT_DAY_START = Date.UTC(2026, 8, 28, 17, 0);

	test("ngày theo giờ Việt Nam (ranh giới 17:00 UTC), không trùng, giảm dần; bỏ event huỷ, nguồn khác, người và guild khác", () =>
	{
		const context = createTestContext();
		const ledger = context.deps.xpLedger;
		recordAt(context, ledger, LAST_MS_OF_DAY - 5 * 24 * HOUR, USER_A, 5, { source: "message" });
		recordAt(context, ledger, LAST_MS_OF_DAY - 3 * HOUR, USER_A, 5, { source: "message" });
		recordAt(context, ledger, LAST_MS_OF_DAY, USER_A, 5, { source: "message" });
		recordAt(context, ledger, NEXT_DAY_START, USER_A, 5, { source: "message" });
		recordAt(context, ledger, NEXT_DAY_START + HOUR, USER_A, 5, { source: "message" });
		ledger.voidEvent(recordAt(context, ledger, NEXT_DAY_START + 2 * 24 * HOUR, USER_A, 5, { source: "message" }));
		recordAt(context, ledger, NEXT_DAY_START + 3 * 24 * HOUR, USER_A, 5, { source: "poll" });
		recordAt(context, ledger, NEXT_DAY_START + 4 * 24 * HOUR, USER_B, 5, { source: "message" });
		recordAt(context, ledger, NEXT_DAY_START + 4 * 24 * HOUR, USER_A, 5, { source: "message", guildId: OTHER_GUILD });

		const days = ledger.activeDays(GUILD, USER_A, "message");
		assert.deepEqual(days, [vnDayNumber(NEXT_DAY_START), vnDayNumber(LAST_MS_OF_DAY), vnDayNumber(LAST_MS_OF_DAY) - 5]);
		assert.equal(days[0] - days[1], 1, "23:59:59.999 và 00:00 giờ Việt Nam là hai ngày liền nhau");
		assert.deepEqual(ledger.activeDays(GUILD, USER_A, "poll"), [vnDayNumber(NEXT_DAY_START) + 3]);
		assert.deepEqual(ledger.activeDays(GUILD, USER_C, "message"), []);
		assert.deepEqual(context.deps.contributionLedger.activeDays(GUILD, USER_A, "vote"), []);
	});

	test("countEvents chỉ đếm event chưa huỷ của đúng nguồn, người và guild", () =>
	{
		const context = createTestContext();
		const ledger = context.deps.xpLedger;
		for (let i = 0; i < 3; i++) recordAt(context, ledger, SINCE + i * HOUR, USER_A, 5, { source: "message" });
		ledger.voidEvent(recordAt(context, ledger, SINCE, USER_A, 5, { source: "message" }));
		recordAt(context, ledger, SINCE, USER_A, 5, { source: "poll" });
		recordAt(context, ledger, SINCE, USER_B, 5, { source: "message" });
		recordAt(context, ledger, SINCE, USER_A, 5, { source: "message", guildId: OTHER_GUILD });
		recordAt(context, context.deps.contributionLedger, SINCE, USER_A, 1, { source: "vote" });

		assert.equal(ledger.countEvents(GUILD, USER_A, "message"), 3);
		assert.equal(ledger.countEvents(GUILD, USER_A, "poll"), 1);
		assert.equal(ledger.countEvents(GUILD, USER_A, "admin"), 0);
		assert.equal(ledger.countEvents(OTHER_GUILD, USER_A, "message"), 1);
		assert.equal(context.deps.contributionLedger.countEvents(GUILD, USER_A, "vote"), 1);

		ledger.voidUser(GUILD, USER_A);
		assert.equal(ledger.countEvents(GUILD, USER_A, "message"), 0, "reset XP thì không còn event nào");
		assert.deepEqual(ledger.activeDays(GUILD, USER_A, "message"), []);
	});
});

describe("Ledger: query plan của truy vấn theo kỳ", () =>
{
	/**
	 * Dòng đọc event theo khoảng (guild_id, created_at). idx_*_events_period (partial, bỏ event đã huỷ) và
	 * idx_*_created cho cùng khoảng và đều phải đọc thêm dòng của bảng (SQLite không coi partial index
	 * "WHERE voided_at IS NULL" là covering), nên planner được chọn một trong hai; điều cần chặn là quét cả bảng.
	 */
	function periodSearch(table: string, alias: string): RegExp
	{
		return new RegExp(`^SEARCH ${alias} USING INDEX idx_${table}_(period|created) \\(guild_id=\\? AND created_at>\\?\\)$`);
	}

	// Statement là thành viên private; truy cập bằng chỉ số để EXPLAIN đúng câu SQL mà Ledger chạy.
	test("xp: xếp hạng theo kỳ đọc index theo khoảng thời gian, team đi từ event sang snapshot; ngày hoạt động đọc idx_xp_events_user_source", () =>
	{
		const { db, deps } = createTestContext();
		const ledger = deps.xpLedger;
		const fullScan = (line: string): boolean => line.startsWith("SCAN xp_events") || line.startsWith("SCAN e");

		for (const plan of [
			queryPlan(db, ledger["selectTopSince"], [GUILD, SINCE, 10, 0]),
			queryPlan(db, ledger["countRankedSinceStmt"], [GUILD, SINCE]),
			queryPlan(db, ledger["selectRankSince"], [GUILD, SINCE, USER_A]),
		])
		{
			assert.ok(plan.some(line => periodSearch("xp_events", "xp_events").test(line)), plan.join("\n"));
			assert.ok(!plan.some(fullScan), plan.join("\n"));
		}

		for (const plan of [
			queryPlan(db, ledger["selectTopTeamsSince"], [GUILD, SINCE, 10, 0]),
			queryPlan(db, ledger["countTeamsSinceStmt"], [GUILD, SINCE]),
		])
		{
			const access = plan.filter(line => TABLE_ACCESS.test(line));
			assert.equal(access.length, 3, plan.join("\n"));
			assert.match(access[0], periodSearch("xp_events", "e"));
			assert.equal(access[1], "SEARCH et USING COVERING INDEX sqlite_autoindex_xp_event_teams_1 (event_id=?)");
			assert.equal(access[2], "SEARCH r USING COVERING INDEX sqlite_autoindex_team_roles_1 (guild_id=? AND role_id=?)");
		}

		const days = queryPlan(db, ledger["selectActiveDays"], [GUILD, USER_A, "message"]);
		assert.ok(days.some(line => line.includes("USING INDEX idx_xp_events_user_source (guild_id=? AND user_id=? AND source=?)")), days.join("\n"));
		const count = queryPlan(db, ledger["countEventsStmt"], [GUILD, USER_A, "message"]);
		assert.ok(count.some(line => line.includes("USING INDEX idx_xp_events_user_source (guild_id=? AND user_id=? AND source=?)")), count.join("\n"));
	});

	test("contribution: xếp hạng theo kỳ cũng đọc index theo khoảng thời gian", () =>
	{
		const { db, deps } = createTestContext();
		const ledger = deps.contributionLedger;
		const top = queryPlan(db, ledger["selectTopSince"], [GUILD, SINCE, 10, 0]);
		assert.ok(top.some(line => periodSearch("contribution_events", "contribution_events").test(line)), top.join("\n"));
		const teams = queryPlan(db, ledger["selectTopTeamsSince"], [GUILD, SINCE, 10, 0]);
		assert.match(teams.find(line => TABLE_ACCESS.test(line)) ?? "", periodSearch("contribution_events", "e"), teams.join("\n"));
	});
});
