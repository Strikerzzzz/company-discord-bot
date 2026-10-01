import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "../src/db/connection";
import { ContributionService } from "../src/modules/contribution/ContributionService";
import { LeaderboardPeriod, LeaderboardService } from "../src/modules/leaderboard/LeaderboardService";
import { Ledger } from "../src/modules/ledger/Ledger";
import { startOfVnMonth, startOfVnWeek, vnDayNumber } from "../src/shared/time";
import { castVote, enableContributions } from "./contribution-helpers";
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

interface RecordOptions
{
	source?: string;
	guildId?: string;
	teamRoleIds?: string[];
	/** Mặc định ADMIN (event admin thật luôn có actor); null = event bù tự động của hệ thống (PROP-024). */
	actorId?: string | null;
}

/** Ghi một event tại thời điểm `at` (đặt đồng hồ giả rồi ghi qua Ledger thật). */
function recordAt(context: TestContext, ledger: Ledger, at: number, userId: string, amount: number, options: RecordOptions = {}): number
{
	context.clock.current = at;
	return ledger.record({
		guildId: options.guildId ?? GUILD,
		userId,
		amount,
		source: options.source ?? "admin",
		actorId: options.actorId === undefined ? ADMIN : options.actorId,
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

	test("positionSince/position: vị trí 0-based đúng thứ tự hiển thị của topSince/top; null nếu không có điểm dương", () =>
	{
		const { deps } = seed();
		const ledger = deps.xpLedger;
		const period = ledger.topSince(GUILD, SINCE, 100);
		assert.equal(period.length, 4);
		period.forEach((entry, index) => assert.equal(ledger.positionSince(GUILD, entry.id, SINCE), index, entry.id));
		for (const userId of [USER_E, USER_F, "399999999999999999"]) assert.equal(ledger.positionSince(GUILD, userId, SINCE), null, userId);

		const all = ledger.top(GUILD, 100);
		assert.equal(all.length, 4);
		all.forEach((entry, index) => assert.equal(ledger.position(GUILD, entry.id), index, entry.id));
		for (const userId of [USER_E, USER_F, "399999999999999999"]) assert.equal(ledger.position(GUILD, userId), null, userId);

		assert.equal(ledger.positionSince(OTHER_GUILD, USER_A, SINCE), 0, "tách guild");
		assert.equal(ledger.position(OTHER_GUILD, USER_B), null);
		assert.equal(deps.contributionLedger.positionSince(GUILD, USER_A, SINCE), null, "tách hai loại điểm");
		assert.equal(deps.contributionLedger.position(GUILD, USER_A), null);
	});

	test("nhóm hoà điểm: cùng hạng nhưng vị trí tăng dần theo user_id, kể cả khi nhóm tràn trang", () =>
	{
		const context = createTestContext();
		const ledger = context.deps.xpLedger;
		const tied = Array.from({ length: 25 }, (_, index) => `31000000000000${String(99 - index).padStart(4, "0")}`);
		for (const userId of tied) recordAt(context, ledger, SINCE + HOUR, userId, 7, { source: "message" });
		recordAt(context, ledger, SINCE + HOUR, USER_A, 50, { source: "message" });
		recordAt(context, ledger, SINCE + HOUR, USER_B, 1, { source: "message" });

		const sorted = [...tied].sort();
		sorted.forEach((userId, index) =>
		{
			assert.equal(ledger.positionSince(GUILD, userId, SINCE), index + 1, userId);
			assert.equal(ledger.position(GUILD, userId), index + 1, userId);
			assert.equal(ledger.rankSince(GUILD, userId, SINCE).rank, 2, "cùng hạng 2");
		});
		assert.equal(ledger.positionSince(GUILD, USER_A, SINCE), 0);
		assert.equal(ledger.positionSince(GUILD, USER_B, SINCE), 26);
		assert.deepEqual(ledger.topSince(GUILD, SINCE, 1, 20).map(entry => entry.id), [sorted[19]], "vị trí 20 là dòng đầu trang 3 (10 dòng/trang)");
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

describe("Ledger: bảng theo kỳ chỉ tính điểm kiếm được (bỏ event bù tự động của PROP-024)", () =>
{
	test("event nguồn admin không có actor bị loại khỏi mọi truy vấn theo kỳ, nhưng vẫn tính vào tổng, bảng all và sumSince", () =>
	{
		const context = createTestContext();
		const { teams, contributionLedger: ledger } = context.deps;
		teams.add(GUILD, ROLE_BACKEND, ADMIN);
		teams.add(GUILD, ROLE_FRONTEND, ADMIN);
		recordAt(context, ledger, SINCE + HOUR, USER_A, 5, { source: "admin", actorId: null, teamRoleIds: [ROLE_BACKEND] });
		recordAt(context, ledger, SINCE + HOUR, USER_B, 2, { source: "admin", teamRoleIds: [ROLE_FRONTEND] });
		recordAt(context, ledger, SINCE + HOUR, USER_C, 1, { source: "vote", teamRoleIds: [ROLE_FRONTEND] });

		assert.deepEqual(ledger.topSince(GUILD, SINCE, 10), [{ id: USER_B, total: 2, rank: 1 }, { id: USER_C, total: 1, rank: 2 }]);
		assert.equal(ledger.countRankedSince(GUILD, SINCE), 2);
		assert.deepEqual(ledger.rankSince(GUILD, USER_A, SINCE), { rank: null, total: 0, totalRanked: 2 });
		assert.equal(ledger.positionSince(GUILD, USER_A, SINCE), null);
		assert.equal(ledger.positionSince(GUILD, USER_B, SINCE), 0, "event admin thật (có actor) vẫn được tính");
		assert.deepEqual(ledger.topTeamsSince(GUILD, SINCE, 10), [{ id: ROLE_FRONTEND, total: 3, rank: 1 }]);
		assert.equal(ledger.countTeamsSince(GUILD, SINCE), 1);

		assert.equal(ledger.total(GUILD, USER_A), 5);
		assert.equal(ledger.top(GUILD, 1)[0].id, USER_A, "bảng all vẫn tính event bù");
		assert.equal(ledger.position(GUILD, USER_A), 0);
		assert.deepEqual(ledger.topTeams(GUILD, 10).map(entry => entry.id), [ROLE_BACKEND, ROLE_FRONTEND]);
		assert.equal(ledger.sumSince(GUILD, USER_A, "admin", SINCE), 5, "sumSince không loại event nào");
	});

	// 10:00 giờ Việt Nam các ngày trong tháng 8 và 9/2026. Tuần của 12/09 (thứ Bảy) bắt đầu 00:00 thứ Hai 07/09.
	const AUG_15 = Date.UTC(2026, 7, 15, 3, 0);
	const AUG_20 = Date.UTC(2026, 7, 20, 3, 0);
	const SEP_08 = Date.UTC(2026, 8, 8, 3, 0);
	const SEP_10 = Date.UTC(2026, 8, 10, 3, 0);
	const SEP_12 = Date.UTC(2026, 8, 12, 3, 0);
	const PERIODS: LeaderboardPeriod[] = ["week", "month"];

	interface Scenario extends TestContext
	{
		contributions: ContributionService;
		board: LeaderboardService;
	}

	function scenario(): Scenario
	{
		const context = createTestContext();
		context.deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		context.deps.teams.add(GUILD, ROLE_FRONTEND, ADMIN);
		enableContributions(context.deps.guildConfig);
		return { ...context, contributions: new ContributionService(context.db, context.deps), board: new LeaderboardService(context.deps) };
	}

	function submitAt(s: Scenario, at: number, authorId: string, roleIds: string[]): number
	{
		s.clock.current = at;
		const created = s.contributions.submit({
			guildId: GUILD,
			authorId,
			submittedBy: authorId,
			title: "Tối ưu build",
			description: "Giảm thời gian build CI từ 10 phút xuống 4 phút.",
			category: "cai-tien",
			link: null,
			authorRoleIds: roleIds,
		});
		return s.contributions.approve(GUILD, created.id, ADMIN).id;
	}

	function voteAt(s: Scenario, at: number, contributionId: number, voterId: string, action: "up" | "withdraw"): void
	{
		s.clock.current = at;
		castVote(s.contributions, contributionId, voterId, action);
	}

	/** Tháng 8: contribution của USER_A (team Backend) có 3 ghi nhận, rồi admin trừ 3 điểm, tổng về 0. */
	function augustOfUserA(s: Scenario): number
	{
		const id = submitAt(s, AUG_15, USER_A, [ROLE_BACKEND]);
		for (const voter of [USER_B, USER_C, USER_D]) voteAt(s, AUG_15, id, voter, "up");
		s.clock.current = AUG_20;
		s.contributions.adjust({ guildId: GUILD, userId: USER_A, delta: -3, actorId: ADMIN, reason: "Trùng nội dung", roleIds: [ROLE_BACKEND] });
		assert.equal(s.deps.contributionLedger.total(GUILD, USER_A), 0);
		return id;
	}

	/** Điểm thật trong tháng 9 (cả trong tuần của 12/09): contribution của USER_B (team Frontend) có `votes` ghi nhận. */
	function septemberOfUserB(s: Scenario, votes: number): void
	{
		const id = submitAt(s, SEP_08, USER_B, [ROLE_FRONTEND]);
		for (const voter of [USER_A, USER_C, USER_D].slice(0, votes)) voteAt(s, SEP_08, id, voter, "up");
	}

	function compensations(s: Scenario, userId: string): { amount: number; createdAt: number }[]
	{
		return s.deps.contributionLedger.recent(GUILD, userId, 50)
			.filter(event => event.source === "admin" && event.actorId === null)
			.map(({ amount, createdAt }) => ({ amount, createdAt }));
	}

	function assertOnlyRealPoints(s: Scenario, value: number): void
	{
		for (const period of PERIODS)
		{
			const individual = s.board.query({ guildId: GUILD, kind: "contribution", scope: "individual", period, page: 1 });
			assert.deepEqual(individual.entries, [{ rank: 1, id: USER_B, value }], `${period}: chỉ người có điểm thật`);
			assert.equal(s.board.userPosition(GUILD, "contribution", period, USER_A), null, period);
			assert.deepEqual(s.board.userStanding(GUILD, "contribution", period, USER_A), { rank: null, value: 0, totalRanked: 1 }, period);
			const team = s.board.query({ guildId: GUILD, kind: "contribution", scope: "team", period, page: 1 });
			assert.deepEqual(team.entries, [{ rank: 1, id: ROLE_FRONTEND, value }], `${period}: team Backend chỉ có event bù`);
		}
	}

	test("R11: tháng 8 có 3 ghi nhận, admin trừ 3; 10/09 admin gỡ contribution → bảng tuần/tháng/team tháng 9 không có người đó", () =>
	{
		const s = scenario();
		const contributionId = augustOfUserA(s);
		septemberOfUserB(s, 1);
		s.clock.current = SEP_10;
		s.contributions.remove(GUILD, contributionId, ADMIN);

		s.clock.current = SEP_12;
		assert.equal(s.deps.contributionLedger.total(GUILD, USER_A), 0, "event bù đưa tổng về 0");
		assert.deepEqual(compensations(s, USER_A), [{ amount: 3, createdAt: SEP_10 }]);
		assertOnlyRealPoints(s, 1);
		assert.equal(s.deps.contributionLedger.sumSince(GUILD, USER_A, "admin", startOfVnMonth(SEP_12)), 3, "sumSince vẫn thấy event bù");
	});

	test("R10: ba người rút ghi nhận cũ của tháng trước → người đó không đứng trên người có điểm thật trong tháng", () =>
	{
		const s = scenario();
		const contributionId = augustOfUserA(s);
		septemberOfUserB(s, 2);
		for (const voter of [USER_B, USER_C, USER_D]) voteAt(s, SEP_10, contributionId, voter, "withdraw");

		s.clock.current = SEP_12;
		assert.equal(s.deps.contributionLedger.total(GUILD, USER_A), 0);
		assert.deepEqual(compensations(s, USER_A), Array.from({ length: 3 }, () => ({ amount: 1, createdAt: SEP_10 })));
		assertOnlyRealPoints(s, 2);
		assert.equal(startOfVnWeek(SEP_12), Date.UTC(2026, 8, 6, 17, 0), "tuần bắt đầu 00:00 thứ Hai 07/09 giờ Việt Nam");
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
			queryPlan(db, ledger["selectPositionSince"], [GUILD, SINCE, USER_A]),
		])
		{
			assert.ok(plan.some(line => periodSearch("xp_events", "xp_events").test(line)), plan.join("\n"));
			assert.ok(!plan.some(fullScan), plan.join("\n"));
		}
		const positionSince = queryPlan(db, ledger["selectPositionSince"], [GUILD, SINCE, USER_A]);
		assert.equal(positionSince.filter(line => periodSearch("xp_events", "xp_events").test(line)).length, 1, `quét ledger đúng một lần:\n${positionSince.join("\n")}`);

		const position = queryPlan(db, ledger["selectPosition"], [GUILD, USER_A]);
		assert.ok(position.every(line => !line.startsWith("SCAN")), position.join("\n"));

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
