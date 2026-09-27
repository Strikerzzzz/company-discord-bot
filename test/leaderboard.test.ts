import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { LeaderboardPage, LeaderboardQuery, LeaderboardService } from "../src/modules/leaderboard/LeaderboardService";
import { ADMIN, createTestContext, GUILD, OTHER_GUILD, ROLE_BACKEND, ROLE_FRONTEND, TestContext, USER_A, USER_B, USER_C } from "./helpers";

function seedUsers(count: number): string[]
{
	return Array.from({ length: count }, (_, i) => `3000000000000001${String(i).padStart(2, "0")}`);
}

describe("LeaderboardService", () =>
{
	test("phân trang cá nhân, rank liên tục qua các trang, trang ngoài phạm vi được kẹp lại", () =>
	{
		const { deps } = createTestContext();
		const users = seedUsers(12);
		users.forEach((userId, i) => deps.xpLedger.record({ guildId: GUILD, userId, amount: 100 - i, source: "message" }));
		const board = new LeaderboardService(deps);

		const page1 = board.individual(GUILD, "activity", 1, 5);
		assert.equal(page1.totalEntries, 12);
		assert.equal(page1.totalPages, 3);
		assert.deepEqual(page1.entries.map(e => e.rank), [1, 2, 3, 4, 5]);
		assert.equal(page1.entries[0].id, users[0]);

		const page3 = board.individual(GUILD, "activity", 99, 5);
		assert.equal(page3.page, 3);
		assert.deepEqual(page3.entries.map(e => e.rank), [11, 12]);
	});

	test("hoà điểm cùng hạng (1, 2, 2, 2, 5) và hạng khớp Ledger.rank (/rank), kể cả ở trang 2", () =>
	{
		const { deps } = createTestContext();
		const totals: [string, number][] = [["u1", 100], ["u2", 90], ["u3", 90], ["u4", 90], ["u5", 80]];
		for (const [userId, amount] of totals) deps.contributionLedger.record({ guildId: GUILD, userId, amount, source: "admin" });
		const board = new LeaderboardService(deps);

		const pages = [1, 2, 3].map(page => board.individual(GUILD, "contribution", page, 2));
		assert.deepEqual(pages.map(page => page.entries.map(e => [e.id, e.rank])), [
			[["u1", 1], ["u2", 2]],
			[["u3", 2], ["u4", 2]],
			[["u5", 5]],
		]);
		for (const entry of pages.flatMap(page => page.entries))
		{
			assert.equal(deps.contributionLedger.rank(GUILD, entry.id).rank, entry.rank, `hạng của ${entry.id} lệch với /rank`);
		}
	});

	test("bảng team: team hoà điểm cùng hạng, kể cả ở trang 2", () =>
	{
		const { deps } = createTestContext();
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		deps.teams.add(GUILD, ROLE_FRONTEND, ADMIN);
		deps.xpLedger.record({ guildId: GUILD, userId: "u1", amount: 40, source: "message", teamRoleIds: [ROLE_BACKEND, ROLE_FRONTEND] });
		const board = new LeaderboardService(deps);

		assert.deepEqual(board.teams(GUILD, "activity", 1, 1).entries, [{ rank: 1, id: ROLE_BACKEND, value: 40 }]);
		assert.deepEqual(board.teams(GUILD, "activity", 2, 1), {
			entries: [{ rank: 1, id: ROLE_FRONTEND, value: 40 }],
			page: 2,
			totalPages: 2,
			totalEntries: 2,
			period: "all",
			since: null,
		});
	});

	test("bảng rỗng vẫn có 1 trang", () =>
	{
		const { deps } = createTestContext();
		const page = new LeaderboardService(deps).teams(GUILD, "contribution", 1);
		assert.deepEqual(page, { entries: [], page: 1, totalPages: 1, totalEntries: 0, period: "all", since: null });
	});

	test("Activity và Contribution tách biệt; bảng team dùng snapshot", () =>
	{
		const { deps } = createTestContext();
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		deps.teams.add(GUILD, ROLE_FRONTEND, ADMIN);
		deps.xpLedger.record({ guildId: GUILD, userId: "u1", amount: 50, source: "message", teamRoleIds: [ROLE_BACKEND] });
		deps.contributionLedger.record({ guildId: GUILD, userId: "u2", amount: 3, source: "vote", teamRoleIds: [ROLE_FRONTEND] });
		const board = new LeaderboardService(deps);

		assert.deepEqual(board.individual(GUILD, "activity", 1).entries, [{ rank: 1, id: "u1", value: 50 }]);
		assert.deepEqual(board.individual(GUILD, "contribution", 1).entries, [{ rank: 1, id: "u2", value: 3 }]);
		assert.deepEqual(board.teams(GUILD, "activity", 1).entries, [{ rank: 1, id: ROLE_BACKEND, value: 50 }]);
		assert.deepEqual(board.teams(GUILD, "contribution", 1).entries, [{ rank: 1, id: ROLE_FRONTEND, value: 3 }]);
	});
});

// Thứ Tư 30/09/2026 10:00 giờ Việt Nam. Tuần bắt đầu 00:00 thứ Hai 28/09, tháng bắt đầu 00:00 ngày 01/09 (giờ Việt Nam).
const NOW = Date.UTC(2026, 8, 30, 3, 0);
const WEEK_START = Date.UTC(2026, 8, 27, 17, 0);
const MONTH_START = Date.UTC(2026, 7, 31, 17, 0);
const DAY = 86_400_000;

function periodQuery(overrides: Partial<LeaderboardQuery> = {}): LeaderboardQuery
{
	return { guildId: GUILD, kind: "activity", scope: "individual", period: "week", page: 1, ...overrides };
}

/** [id, điểm, hạng] của từng dòng trong trang. */
function rows(page: LeaderboardPage): [string, number, number][]
{
	return page.entries.map(entry => [entry.id, entry.value, entry.rank]);
}

/** Ghi XP tin nhắn tại thời điểm `at` rồi đưa đồng hồ về NOW. */
function xpAt(context: TestContext, at: number, userId: string, amount: number, teamRoleIds: string[] = []): void
{
	context.clock.current = at;
	context.deps.xpLedger.record({ guildId: GUILD, userId, amount, source: "message", teamRoleIds });
	context.clock.current = NOW;
}

describe("LeaderboardService theo kỳ", () =>
{
	function seed(): TestContext
	{
		const context = createTestContext();
		context.deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		context.deps.teams.add(GUILD, ROLE_FRONTEND, ADMIN);
		xpAt(context, MONTH_START - 1, USER_A, 100, [ROLE_BACKEND]);
		xpAt(context, WEEK_START - 1, USER_A, 5, [ROLE_BACKEND]);
		xpAt(context, MONTH_START, USER_B, 20, [ROLE_FRONTEND]);
		xpAt(context, WEEK_START, USER_C, 7, [ROLE_BACKEND]);
		xpAt(context, NOW, USER_B, 3, [ROLE_FRONTEND]);
		return context;
	}

	test("tuần từ 00:00 thứ Hai, tháng từ 00:00 ngày 1 (giờ Việt Nam); kết quả ghi rõ period và since", () =>
	{
		const board = new LeaderboardService(seed().deps);

		const all = board.query(periodQuery({ period: "all" }));
		assert.deepEqual(rows(all), [[USER_A, 105, 1], [USER_B, 23, 2], [USER_C, 7, 3]]);
		assert.equal(all.period, "all");
		assert.equal(all.since, null);

		const month = board.query(periodQuery({ period: "month" }));
		assert.deepEqual(rows(month), [[USER_B, 23, 1], [USER_C, 7, 2], [USER_A, 5, 3]]);
		assert.equal(month.period, "month");
		assert.equal(month.since, MONTH_START);

		assert.deepEqual(board.query(periodQuery({ period: "week" })), {
			entries: [{ rank: 1, id: USER_C, value: 7 }, { rank: 2, id: USER_B, value: 3 }],
			page: 1,
			totalPages: 1,
			totalEntries: 2,
			period: "week",
			since: WEEK_START,
		});
	});

	test("bảng team theo kỳ dùng snapshot team", () =>
	{
		const board = new LeaderboardService(seed().deps);
		assert.deepEqual(rows(board.query(periodQuery({ scope: "team", period: "all" }))), [[ROLE_BACKEND, 112, 1], [ROLE_FRONTEND, 23, 2]]);
		assert.deepEqual(rows(board.query(periodQuery({ scope: "team", period: "month" }))), [[ROLE_FRONTEND, 23, 1], [ROLE_BACKEND, 12, 2]]);
		const week = board.query(periodQuery({ scope: "team", period: "week" }));
		assert.deepEqual(rows(week), [[ROLE_BACKEND, 7, 1], [ROLE_FRONTEND, 3, 2]]);
		assert.equal(week.period, "week");
		assert.equal(week.since, WEEK_START);
	});

	test("sang tuần mới thì bảng tuần trống; sang tháng mới thì mốc tháng đổi", () =>
	{
		const context = seed();
		const board = new LeaderboardService(context.deps);
		const nextMonday = WEEK_START + 7 * DAY;

		context.clock.current = nextMonday - 1;
		assert.equal(board.query(periodQuery()).totalEntries, 2);
		context.clock.current = nextMonday;
		assert.deepEqual(board.query(periodQuery()), { entries: [], page: 1, totalPages: 1, totalEntries: 0, period: "week", since: nextMonday });
		assert.equal(board.query(periodQuery({ period: "month" })).since, Date.UTC(2026, 8, 30, 17, 0), "đã sang tháng 10 giờ Việt Nam");
	});

	test("phân trang theo kỳ: hạng liên tục qua các trang, trang ngoài phạm vi được kẹp lại", () =>
	{
		const context = createTestContext();
		const users = seedUsers(12);
		users.forEach((userId, i) =>
		{
			xpAt(context, WEEK_START - 1, userId, 1_000 * (i + 1));
			xpAt(context, WEEK_START + i, userId, 100 - i);
		});
		const board = new LeaderboardService(context.deps);

		const page1 = board.query(periodQuery({ pageSize: 5 }));
		assert.equal(page1.totalEntries, 12);
		assert.equal(page1.totalPages, 3);
		assert.deepEqual(page1.entries.map(e => [e.id, e.rank]), users.slice(0, 5).map((id, i) => [id, i + 1]));

		const last = board.query(periodQuery({ page: 99, pageSize: 5 }));
		assert.equal(last.page, 3);
		assert.deepEqual(last.entries.map(e => e.rank), [11, 12]);
		assert.deepEqual(board.query(periodQuery({ page: 0, pageSize: 5 })).entries, page1.entries);

		const defaultSize = board.query(periodQuery({ page: 2 }));
		assert.equal(defaultSize.page, 2);
		assert.deepEqual(defaultSize.entries.map(e => e.rank), [11, 12], "trang mặc định 10 dòng");
		assert.deepEqual(board.query(periodQuery({ scope: "team", page: 5 })), {
			entries: [], page: 1, totalPages: 1, totalEntries: 0, period: "week", since: WEEK_START,
		});
	});

	test("individual()/teams() tương đương query kỳ all", () =>
	{
		const board = new LeaderboardService(seed().deps);
		assert.deepEqual(board.individual(GUILD, "activity", 1, 2), board.query(periodQuery({ period: "all", pageSize: 2 })));
		assert.deepEqual(board.teams(GUILD, "activity", 2, 1), board.query(periodQuery({ scope: "team", period: "all", page: 2, pageSize: 1 })));
	});

	test("userStanding khớp hạng và điểm trong bảng của từng kỳ", () =>
	{
		const context = seed();
		const { deps } = context;
		xpAt(context, NOW, "300000000000000009", 3);
		const board = new LeaderboardService(deps);

		for (const period of ["all", "week", "month"] as const)
		{
			const page = board.query(periodQuery({ period, pageSize: 50 }));
			for (const entry of page.entries)
			{
				assert.deepEqual(
					board.userStanding(GUILD, "activity", period, entry.id),
					{ rank: entry.rank, value: entry.value, totalRanked: page.totalEntries },
					`${period}: ${entry.id}`,
				);
			}
		}
		assert.deepEqual(board.userStanding(GUILD, "activity", "week", USER_A), { rank: null, value: 0, totalRanked: 3 });
		assert.deepEqual(board.userStanding(GUILD, "activity", "all", USER_A), {
			rank: deps.xpLedger.rank(GUILD, USER_A).rank,
			value: deps.xpLedger.total(GUILD, USER_A),
			totalRanked: deps.xpLedger.countRanked(GUILD),
		});
		assert.deepEqual(board.userStanding(OTHER_GUILD, "activity", "month", USER_B), { rank: null, value: 0, totalRanked: 0 });
	});

	test("userPosition: vị trí 0-based khớp thứ tự trong bảng của từng kỳ; trang = floor(vị trí / 10) + 1", () =>
	{
		const context = seed();
		const tied = seedUsers(23);
		for (const userId of tied) xpAt(context, NOW, userId, 3);
		const board = new LeaderboardService(context.deps);

		for (const period of ["all", "week", "month"] as const)
		{
			const full = board.query(periodQuery({ period, pageSize: 100 }));
			full.entries.forEach((entry, index) =>
			{
				const position = board.userPosition(GUILD, "activity", period, entry.id);
				assert.equal(position, index, `${period}: ${entry.id}`);
				const page = board.query(periodQuery({ period, page: Math.floor(index / 10) + 1 }));
				assert.ok(page.entries.some(row => row.id === entry.id), `${period}: ${entry.id} nằm ở trang tính từ vị trí`);
			});
		}
		assert.equal(board.userPosition(GUILD, "activity", "week", USER_A), null, "không có điểm trong tuần");
		assert.equal(board.userPosition(GUILD, "activity", "all", "399999999999999999"), null);
		assert.equal(board.userPosition(GUILD, "contribution", "all", USER_A), null, "tách hai loại điểm");
		assert.equal(board.userPosition(OTHER_GUILD, "activity", "month", USER_B), null, "tách guild");
	});

	test("Contribution theo kỳ tách biệt với Activity; điểm âm trong kỳ không có hạng", () =>
	{
		const context = seed();
		const { deps, clock } = context;
		clock.current = WEEK_START + 1;
		deps.contributionLedger.record({ guildId: GUILD, userId: USER_A, amount: 3, source: "vote" });
		deps.contributionLedger.record({ guildId: GUILD, userId: USER_B, amount: -2, source: "admin", actorId: ADMIN });
		clock.current = NOW;
		const board = new LeaderboardService(deps);

		assert.deepEqual(rows(board.query(periodQuery({ kind: "contribution" }))), [[USER_A, 3, 1]]);
		assert.deepEqual(board.userStanding(GUILD, "contribution", "week", USER_B), { rank: null, value: -2, totalRanked: 1 });
		assert.deepEqual(rows(board.query(periodQuery({ kind: "activity" }))), [[USER_C, 7, 1], [USER_B, 3, 2]]);
	});

	test("kỳ không hợp lệ lúc chạy (dữ liệu sai kiểu từ Discord) bị từ chối", () =>
	{
		const board = new LeaderboardService(createTestContext().deps);
		assert.throws(() => board.query(Object.assign(periodQuery(), { period: "year" })), /Kỳ xếp hạng không hợp lệ/);
	});
});
