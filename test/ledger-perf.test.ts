import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "perf_hooks";
import { Db, openDatabase } from "../src/db/connection";
import { MIGRATIONS, runMigrations } from "../src/db/migrations";
import { Ledger, TotalEntry } from "../src/modules/ledger/Ledger";
import { FakeClock, GUILD } from "./helpers";

const EVENTS = 50_000;
const USERS = 2_000;
const ROLES = 12;
const CONFIGURED_TEAMS = 10;

// Ngưỡng rộng để không flaky trên máy chậm: đọc từ cache chỉ mất cỡ 0,1 ms, còn cách cũ (quét mọi event)
// mất hơn 100 ms với 50k event và tăng tuyến tính theo số event.
const MAX_MS = 50;

function timeMs(fn: () => unknown): number
{
	const start = performance.now();
	fn();
	return performance.now() - start;
}

function median(samples: number[]): number
{
	const sorted = [...samples].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
}

/** Trung vị thời gian chạy (ms) của 7 lần, sau một lần chạy làm nóng. */
function medianMs(fn: () => unknown): number
{
	fn();
	return median(Array.from({ length: 7 }, () => timeMs(fn)));
}

/** Seed hàng loạt bằng SQL ở schema version 1 (như DB đã chạy lâu trước khi có cache), rồi chạy migration để backfill. */
function seedLargeLedger(db: Db): void
{
	runMigrations(db, MIGRATIONS.filter(migration => migration.version === 1));
	// Các hằng số là số nguyên do test định nghĩa, không phải input.
	db.exec(`
		WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ${EVENTS})
		INSERT INTO xp_events (id, guild_id, user_id, amount, source, reference_id, created_at, voided_at)
		SELECT n, '${GUILD}', 'u' || (n % ${USERS}), 10, 'message', 'c' || (n % 20), n, CASE WHEN n % 17 = 0 THEN n ELSE NULL END
		FROM seq;
		INSERT INTO xp_event_teams (event_id, role_id) SELECT id, 'r' || (id % ${ROLES}) FROM xp_events;
		INSERT INTO xp_event_teams (event_id, role_id)
		SELECT id, 'r' || ((id / 7) % ${ROLES}) FROM xp_events WHERE id % 3 = 0 AND id % ${ROLES} <> (id / 7) % ${ROLES};
		INSERT INTO member_xp (guild_id, user_id, total)
		SELECT guild_id, user_id, SUM(amount) FROM xp_events WHERE voided_at IS NULL GROUP BY guild_id, user_id;
	`);
	const addTeam = db.prepare<[string, string]>("INSERT INTO team_roles (guild_id, role_id, created_at) VALUES (?, ?, 0)");
	for (let role = 0; role < CONFIGURED_TEAMS; role++) addTeam.run(GUILD, `r${role}`);
	runMigrations(db);
}

/** Điểm team tính thẳng từ ledger (cách làm trước khi có cache) để đối chiếu. */
function recomputeTeamTotals(db: Db): TotalEntry[]
{
	return db.prepare<[string], TotalEntry>(`
		SELECT et.role_id AS id, SUM(e.amount) AS total
		FROM xp_event_teams et
		JOIN xp_events e ON e.id = et.event_id
		JOIN team_roles r ON r.guild_id = e.guild_id AND r.role_id = et.role_id
		WHERE e.guild_id = ? AND e.voided_at IS NULL
		GROUP BY et.role_id
		HAVING SUM(e.amount) > 0
		ORDER BY total DESC, id ASC`).all(GUILD);
}

describe("Ledger: hiệu năng bảng xếp hạng", () =>
{
	test(`${EVENTS} event: bảng xếp hạng đọc từ cache, dưới ${MAX_MS} ms mỗi lệnh; đường ghi không quét lại ledger`, () =>
	{
		const db = openDatabase(":memory:");
		try
		{
			seedLargeLedger(db);
			const ledger = new Ledger(db, "xp", new FakeClock());
			assert.equal(ledger.countTeams(GUILD), CONFIGURED_TEAMS);
			assert.deepEqual(ledger.teamTotals(GUILD, 100), recomputeTeamTotals(db), "backfill phải khớp giá trị tính lại từ ledger");

			const timings = {
				topTeams: medianMs(() => ledger.topTeams(GUILD, 10, 0)),
				teamTotals: medianMs(() => ledger.teamTotals(GUILD, 10, 0)),
				countTeams: medianMs(() => ledger.countTeams(GUILD)),
				top: medianMs(() => ledger.top(GUILD, 10, 1_000)),
				countRanked: medianMs(() => ledger.countRanked(GUILD)),
				recordAndVoid: medianMs(() =>
				{
					const event = ledger.record({ guildId: GUILD, userId: "u1", amount: 10, source: "message", teamRoleIds: ["r1", "r2"] });
					ledger.voidEvent(event.id);
				}),
				voidUser: median(Array.from({ length: 7 }, (_, i) => timeMs(() => ledger.voidUser(GUILD, `u${10 + i}`)))),
			};
			for (const [name, ms] of Object.entries(timings))
			{
				assert.ok(ms < MAX_MS, `${name} mất ${ms.toFixed(2)} ms (ngưỡng ${MAX_MS} ms)`);
			}
			assert.deepEqual(ledger.teamTotals(GUILD, 100), recomputeTeamTotals(db), "cache vẫn khớp ledger sau khi ghi");
		}
		finally
		{
			db.close();
		}
	});
});
