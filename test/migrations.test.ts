import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDatabase } from "../src/db/connection";
import { currentSchemaVersion, MIGRATIONS, runMigrations } from "../src/db/migrations";

describe("migrations", () =>
{
	test("DB trống: áp dụng toàn bộ migration và tạo đủ bảng", () =>
	{
		const db = openDatabase(":memory:");
		assert.equal(runMigrations(db), MIGRATIONS.length);
		assert.equal(currentSchemaVersion(db), MIGRATIONS[MIGRATIONS.length - 1].version);

		const tables = db.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
		for (const name of ["guild_settings", "channel_settings", "team_roles", "xp_events", "member_xp", "contributions", "contribution_events", "member_contribution", "contribution_votes", "polls", "poll_options", "poll_votes", "poll_participants", "audit_log"])
		{
			assert.ok(tables.includes(name), `thiếu bảng ${name}`);
		}
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
