import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { LeaderboardService } from "../src/modules/leaderboard/LeaderboardService";
import { ADMIN, createTestContext, GUILD, ROLE_BACKEND, ROLE_FRONTEND } from "./helpers";

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
		});
	});

	test("bảng rỗng vẫn có 1 trang", () =>
	{
		const { deps } = createTestContext();
		const page = new LeaderboardService(deps).teams(GUILD, "contribution", 1);
		assert.deepEqual(page, { entries: [], page: 1, totalPages: 1, totalEntries: 0 });
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
