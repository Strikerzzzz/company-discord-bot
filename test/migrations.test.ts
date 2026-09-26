import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDatabase } from "../src/db/connection";
import { currentSchemaVersion, MIGRATIONS, runMigrations } from "../src/db/migrations";
import { AuditService } from "../src/modules/audit/AuditService";
import { Ledger } from "../src/modules/ledger/Ledger";
import { TeamService } from "../src/modules/team/TeamService";
import { FakeClock } from "./helpers";

describe("migrations", () =>
{
	test("DB trống: áp dụng toàn bộ migration và tạo đủ bảng", () =>
	{
		const db = openDatabase(":memory:");
		assert.equal(runMigrations(db), MIGRATIONS.length);
		assert.equal(currentSchemaVersion(db), MIGRATIONS[MIGRATIONS.length - 1].version);

		const tables = db.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
		for (const name of ["guild_settings", "channel_settings", "team_roles", "xp_events", "member_xp", "contributions", "contribution_events", "member_contribution", "contribution_votes", "polls", "poll_options", "poll_votes", "poll_participants", "audit_log", "xp_team_totals", "contribution_team_totals"])
		{
			assert.ok(tables.includes(name), `thiếu bảng ${name}`);
		}

		const columns = db.prepare<[], { name: string }>("PRAGMA table_info(contributions)").all().map(row => row.name);
		assert.ok(columns.includes("source_message_id"));
		const index = db.prepare<[], { sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_contributions_source_message'").get();
		assert.match(index?.sql ?? "", /UNIQUE INDEX[\s\S]*WHERE source_message_id IS NOT NULL AND status = 'active'/);
	});

	test("DB đang ở version 1 có dữ liệu: migration 2 backfill tổng team từ event còn hiệu lực", () =>
	{
		const db = openDatabase(":memory:");
		runMigrations(db, MIGRATIONS.filter(migration => migration.version === 1));
		assert.equal(currentSchemaVersion(db), 1);

		const seedEvents = (kind: "xp" | "contribution", source: string, rows: [string, string, number, number | null, string[]][]): void =>
		{
			// Tên bảng lấy từ union cố định trong test, không phải input.
			const insertEvent = db.prepare<[string, string, number, string, number | null]>(
				`INSERT INTO ${kind}_events (guild_id, user_id, amount, source, created_at, voided_at) VALUES (?, ?, ?, ?, 0, ?)`,
			);
			const insertTeam = db.prepare<[number, string]>(`INSERT INTO ${kind}_event_teams (event_id, role_id) VALUES (?, ?)`);
			for (const [guildId, userId, amount, voidedAt, roles] of rows)
			{
				const id = Number(insertEvent.run(guildId, userId, amount, source, voidedAt).lastInsertRowid);
				for (const roleId of roles) insertTeam.run(id, roleId);
			}
		};
		seedEvents("xp", "message", [
			["g1", "a", 10, null, ["r1", "r2"]],
			["g1", "b", 5, null, ["r1"]],
			["g1", "b", 100, 1, ["r2"]],
			["g1", "c", -3, null, ["r1"]],
			["g2", "a", 7, null, ["r1"]],
			["g1", "c", 50, null, []],
			["g1", "a", 4, null, ["r3"]],
		]);
		seedEvents("contribution", "vote", [
			["g1", "a", 2, null, ["r2"]],
			["g1", "a", 1, 1, ["r2"]],
			["g2", "b", 3, null, ["r1", "r2"]],
		]);
		db.prepare("INSERT INTO contributions (guild_id, author_id, submitted_by, title, description, category, created_at) VALUES ('g1', 'a', 'a', 'Cũ', 'Mô tả', 'khac', 0)").run();

		assert.equal(runMigrations(db), 1);
		assert.equal(currentSchemaVersion(db), 2);

		const totals = (table: "xp_team_totals" | "contribution_team_totals"): [string, string, number][] =>
			db.prepare<[], { guild_id: string; role_id: string; total: number }>(`SELECT guild_id, role_id, total FROM ${table} ORDER BY guild_id, role_id`)
				.all()
				.map(row => [row.guild_id, row.role_id, row.total]);
		assert.deepEqual(totals("xp_team_totals"), [["g1", "r1", 12], ["g1", "r2", 10], ["g1", "r3", 4], ["g2", "r1", 7]]);
		assert.deepEqual(totals("contribution_team_totals"), [["g1", "r2", 2], ["g2", "r1", 3], ["g2", "r2", 3]]);
		assert.equal(db.prepare<[], { source_message_id: string | null }>("SELECT source_message_id FROM contributions").get()?.source_message_id, null);

		// Sau migration, Ledger tiếp tục cập nhật cache đúng, kể cả khi huỷ event ghi từ trước migration.
		const clock = new FakeClock();
		const teams = new TeamService(db, clock, new AuditService(db, clock));
		teams.add("g1", "r1", "admin");
		teams.add("g1", "r2", "admin");
		const ledger = new Ledger(db, "xp", clock);
		assert.deepEqual(ledger.teamTotals("g1", 10), [{ id: "r1", total: 12 }, { id: "r2", total: 10 }]);
		ledger.voidEvent(1);
		ledger.record({ guildId: "g1", userId: "d", amount: 6, source: "message", teamRoleIds: ["r2"] });
		assert.deepEqual(ledger.teamTotals("g1", 10), [{ id: "r2", total: 6 }, { id: "r1", total: 2 }]);
		assert.equal(runMigrations(db), 0);
	});

	test("chạy lại không làm gì (idempotent)", () =>
	{
		const db = openDatabase(":memory:");
		runMigrations(db);
		assert.equal(runMigrations(db), 0);
	});

	test("từ chối database mới hơn code", () =>
	{
		const db = openDatabase(":memory:");
		db.pragma("user_version = 999");
		assert.throws(() => runMigrations(db), /mới hơn code/);
	});

	test("migration lỗi được rollback, version giữ nguyên", () =>
	{
		const db = openDatabase(":memory:");
		const broken = [...MIGRATIONS, { version: 99, name: "broken", sql: "CREATE TABLE ok_table (id INTEGER); SELECT * FROM missing_table;" }];
		assert.throws(() => runMigrations(db, broken));
		assert.equal(currentSchemaVersion(db), MIGRATIONS[MIGRATIONS.length - 1].version);
		const exists = db.prepare("SELECT name FROM sqlite_master WHERE name = 'ok_table'").get();
		assert.equal(exists, undefined);
	});

	test("file DB thật dùng WAL và bật foreign keys", () =>
	{
		const dir = mkdtempSync(join(tmpdir(), "bot-db-"));
		try
		{
			const db = openDatabase(join(dir, "nested", "bot.db"));
			assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
			assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
			db.close();
		}
		finally
		{
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
