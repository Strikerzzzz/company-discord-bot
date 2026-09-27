import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "perf_hooks";
import { Db } from "../src/db/connection";
import { GamificationService } from "../src/modules/gamification/GamificationService";
import { LeaderboardQuery, LeaderboardService } from "../src/modules/leaderboard/LeaderboardService";
import { TotalEntry } from "../src/modules/ledger/Ledger";
import { startOfVnMonth, startOfVnWeek } from "../src/shared/time";
import { ADMIN, createTestContext, GUILD } from "./helpers";

const EVENTS = 200_000;
const USERS = 300;
const DAYS = 60;
const ROLES = 12;
const CONFIGURED_TEAMS = 10;
const TIED = 2000;
const DAY = 86_400_000;
// 23:00 Chủ nhật 27/09/2026 giờ Việt Nam: bảng tuần gần đủ 7 ngày, bảng tháng gần đủ 27 ngày (~45% số event).
const NOW = Date.UTC(2026, 8, 27, 16, 0);
const FROM = NOW - DAYS * DAY;
const STEP = (DAYS * DAY) / EVENTS;

// Ngưỡng rộng để không flaky trên máy chậm hoặc đang bận. Trên máy phát triển: bảng cá nhân tháng ~30 ms, bảng team tháng
// ~80 ms (event trong kỳ phải cộng từ ledger vì không có cache theo kỳ; partial index không phủ được cột voided_at), nhưng lúc
// máy bận đo được tới ~400 ms. Test này để bắt lỗi quét lặp cỡ vài giây (LL-017: "Hạng của tôi" từng mất 7–10 s), nên 1 s là đủ.
const MAX_MS = 1000;

function timeMs(fn: () => unknown): number
{
	const start = performance.now();
	fn();
	return performance.now() - start;
}

/** Trung vị thời gian chạy (ms) của 5 lần, sau một lần chạy làm nóng. */
function medianMs(fn: () => unknown): number
{
	fn();
	const samples = Array.from({ length: 5 }, () => timeMs(fn)).sort((a, b) => a - b);
	return samples[Math.floor(samples.length / 2)];
}

/** Seed hàng loạt bằng SQL: event trải đều 60 ngày, ~4% đã huỷ, 10% là XP từ vote; mỗi event có 1–2 team trong snapshot. */
function seed(db: Db): void
{
	// Các hằng số là số do test định nghĩa, không phải input.
	db.exec(`
		WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ${EVENTS})
		INSERT INTO xp_events (id, guild_id, user_id, amount, source, created_at, voided_at)
		SELECT n, '${GUILD}', 'u' || (n % ${USERS}), 5 + (n % 11), CASE WHEN n % 10 = 0 THEN 'poll' ELSE 'message' END,
			${FROM} + n * ${STEP}, CASE WHEN n % 23 = 0 THEN ${NOW} ELSE NULL END
		FROM seq;
		INSERT INTO xp_event_teams (event_id, role_id) SELECT id, 'r' || ((id % ${USERS}) % ${ROLES}) FROM xp_events;
		INSERT INTO xp_event_teams (event_id, role_id) SELECT id, 'r' || ((id % ${USERS} + 1) % ${ROLES}) FROM xp_events WHERE id % 3 = 0;
		INSERT INTO member_xp (guild_id, user_id, total)
		SELECT guild_id, user_id, SUM(amount) FROM xp_events WHERE voided_at IS NULL GROUP BY guild_id, user_id;
	`);
}

/**
 * Thêm `count` người cùng có đúng 10 XP trong tháng (một event mỗi người, hôm qua), user ID "t0000"…: nhóm hoà điểm
 * tràn qua hàng trăm trang (điểm thấp hơn mọi người của seed nên đứng cuối bảng).
 */
function seedTied(db: Db, count: number): string[]
{
	// Các hằng số là số do test định nghĩa, không phải input.
	db.exec(`
		WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n < ${count - 1})
		INSERT INTO xp_events (guild_id, user_id, amount, source, created_at)
		SELECT '${GUILD}', 't' || printf('%04d', n), 10, 'message', ${NOW - DAY} FROM seq;
		INSERT INTO member_xp (guild_id, user_id, total) SELECT guild_id, user_id, amount FROM xp_events WHERE user_id LIKE 't%';
	`);
	return Array.from({ length: count }, (_, n) => `t${String(n).padStart(4, "0")}`);
}

/** Vị trí 0-based của một người trong bảng cá nhân của kỳ, tính bằng cách đọc cả bảng rồi tìm (để đối chiếu). */
function naivePosition(db: Db, since: number, userId: string): number
{
	const rows = db.prepare<[string, number], { id: string }>(`
		SELECT user_id AS id FROM xp_events
		WHERE guild_id = ? AND created_at >= ? AND voided_at IS NULL
		GROUP BY user_id HAVING SUM(amount) > 0
		ORDER BY SUM(amount) DESC, user_id ASC`).all(GUILD, since);
	return rows.findIndex(row => row.id === userId);
}

/** Top 10 cá nhân của kỳ tính bằng câu SQL đơn giản nhất (không INDEXED BY) để đối chiếu. */
function naiveTop(db: Db, since: number): TotalEntry[]
{
	return db.prepare<[string, number], TotalEntry>(`
		SELECT user_id AS id, SUM(amount) AS total FROM xp_events
		WHERE guild_id = ? AND created_at >= ? AND voided_at IS NULL
		GROUP BY user_id HAVING SUM(amount) > 0
		ORDER BY total DESC, id ASC LIMIT 10`).all(GUILD, since);
}

function naiveTopTeams(db: Db, since: number): TotalEntry[]
{
	return db.prepare<[string, number], TotalEntry>(`
		SELECT et.role_id AS id, SUM(e.amount) AS total
		FROM xp_events e
		JOIN xp_event_teams et ON et.event_id = e.id
		JOIN team_roles r ON r.guild_id = e.guild_id AND r.role_id = et.role_id
		WHERE e.guild_id = ? AND e.created_at >= ? AND e.voided_at IS NULL
		GROUP BY et.role_id HAVING SUM(e.amount) > 0
		ORDER BY total DESC, id ASC LIMIT 10`).all(GUILD, since);
}

describe("Bảng xếp hạng theo kỳ: hiệu năng", () =>
{
	test(`${EVENTS} event / ${USERS} người / ${DAYS} ngày: bảng tuần, tháng (cá nhân, team) và hồ sơ dưới ${MAX_MS} ms mỗi lệnh`, t =>
	{
		const context = createTestContext();
		const { db, deps, clock } = context;
		try
		{
			seed(db);
			for (let role = 0; role < CONFIGURED_TEAMS; role++) deps.teams.add(GUILD, `r${role}`, ADMIN);
			clock.current = NOW;
			const board = new LeaderboardService(deps);
			const gamification = new GamificationService(db, deps);
			const q = (scope: LeaderboardQuery["scope"], period: LeaderboardQuery["period"]): LeaderboardQuery =>
				({ guildId: GUILD, kind: "activity", scope, period, page: 1 });

			const monthStart = startOfVnMonth(NOW);
			const toTotals = (entries: { id: string; value: number }[]): TotalEntry[] => entries.map(({ id, value }) => ({ id, total: value }));
			assert.deepEqual(toTotals(board.query(q("individual", "month")).entries), naiveTop(db, monthStart));
			assert.deepEqual(toTotals(board.query(q("team", "month")).entries), naiveTopTeams(db, monthStart));
			assert.deepEqual(toTotals(board.query(q("team", "week")).entries), naiveTopTeams(db, startOfVnWeek(NOW)));
			assert.equal(board.query(q("team", "month")).totalEntries, CONFIGURED_TEAMS);
			assert.equal(board.query(q("individual", "week")).totalEntries, USERS);

			const timings = {
				individualWeek: medianMs(() => board.query(q("individual", "week"))),
				individualMonth: medianMs(() => board.query(q("individual", "month"))),
				teamWeek: medianMs(() => board.query(q("team", "week"))),
				teamMonth: medianMs(() => board.query(q("team", "month"))),
				standingMonth: medianMs(() => board.userStanding(GUILD, "activity", "month", "u7")),
				profile: medianMs(() => gamification.profile(GUILD, "u7")),
			};
			t.diagnostic(Object.entries(timings).map(([name, ms]) => `${name}=${ms.toFixed(1)}ms`).join(" "));
			for (const [name, ms] of Object.entries(timings))
			{
				assert.ok(ms < MAX_MS, `${name} mất ${ms.toFixed(2)} ms (ngưỡng ${MAX_MS} ms)`);
			}
		}
		finally
		{
			db.close();
		}
	});

	test(`"Hạng của tôi" ở kỳ tháng khi nhóm ${TIED} người hoà điểm tràn trang (trên ${EVENTS} event): tìm vị trí và lấy trang dưới ${MAX_MS} ms`, t =>
	{
		const context = createTestContext();
		const { db, deps, clock } = context;
		try
		{
			seed(db);
			const tied = seedTied(db, TIED);
			clock.current = NOW;
			const board = new LeaderboardService(deps);
			const monthStart = startOfVnMonth(NOW);
			const viewer = tied[TIED - 1];

			const position = board.userPosition(GUILD, "activity", "month", viewer);
			assert.equal(position, naivePosition(db, monthStart, viewer));
			assert.equal(position, USERS + TIED - 1, "người cuối của nhóm hoà điểm đứng cuối bảng");
			assert.equal(board.userPosition(GUILD, "activity", "all", viewer), USERS + TIED - 1);
			const click = (): number =>
			{
				const found = board.userPosition(GUILD, "activity", "month", viewer);
				assert.ok(found !== null);
				const page = board.query({ guildId: GUILD, kind: "activity", scope: "individual", period: "month", page: Math.floor(found / 10) + 1, pageSize: 10 });
				assert.ok(page.entries.some(entry => entry.id === viewer));
				return page.page;
			};
			assert.equal(click(), Math.floor((USERS + TIED - 1) / 10) + 1);

			const timings = {
				positionMonth: medianMs(() => board.userPosition(GUILD, "activity", "month", viewer)),
				positionAll: medianMs(() => board.userPosition(GUILD, "activity", "all", viewer)),
				meClickMonth: medianMs(click),
			};
			t.diagnostic(Object.entries(timings).map(([name, ms]) => `${name}=${ms.toFixed(1)}ms`).join(" "));
			for (const [name, ms] of Object.entries(timings))
			{
				assert.ok(ms < MAX_MS, `${name} mất ${ms.toFixed(2)} ms (ngưỡng ${MAX_MS} ms)`);
			}
		}
		finally
		{
			db.close();
		}
	});
});
