import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDatabase } from "../src/db/connection";
import { currentSchemaVersion, MIGRATIONS, runMigrations } from "../src/db/migrations";
import { AuditService } from "../src/modules/audit/AuditService";
import { GuildConfigService } from "../src/modules/guild-config/GuildConfigService";
import { TierSetService } from "../src/modules/gamification/TierSetService";
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
		for (const name of ["guild_settings", "channel_settings", "team_roles", "xp_events", "member_xp", "contributions", "contribution_events", "member_contribution", "contribution_votes", "polls", "poll_options", "poll_votes", "poll_participants", "audit_log", "xp_team_totals", "contribution_team_totals", "guild_role_grants", "member_tier_prefs"])
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

		assert.equal(runMigrations(db, MIGRATIONS.filter(migration => migration.version <= 2)), 1);
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
		assert.equal(runMigrations(db, MIGRATIONS.filter(migration => migration.version <= 2)), 0);
	});

	test("chạy lại không làm gì (idempotent)", () =>
	{
		const db = openDatabase(":memory:");
		runMigrations(db);
		assert.equal(runMigrations(db), 0);
	});

	test("DB đang ở version 2 có cấu hình: migration 3 thêm giới hạn XP vote mặc định 25 và các bảng gamification", () =>
	{
		const db = openDatabase(":memory:");
		runMigrations(db, MIGRATIONS.filter(migration => migration.version <= 2));
		db.prepare(`
			INSERT INTO guild_settings (guild_id, xp_per_message, xp_cooldown_seconds, min_message_length, duplicate_window_seconds,
				level_up_announcements, default_poll_xp, contribution_vote_points, admin_role_id, poll_creator_role_id, updated_at)
			VALUES ('g1', 10, 60, 5, 300, 1, 5, 1, NULL, NULL, 0)`).run();

		assert.equal(runMigrations(db, MIGRATIONS.filter(migration => migration.version <= 3)), 1);
		assert.equal(currentSchemaVersion(db), 3);
		assert.deepEqual(db.prepare("SELECT poll_xp_daily_cap FROM guild_settings WHERE guild_id = 'g1'").get(), { poll_xp_daily_cap: 25 });
		const tables = db.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tier_roles', 'live_boards') ORDER BY name").all();
		assert.deepEqual(tables.map(table => table.name), ["live_boards", "tier_roles"]);

		db.prepare("INSERT INTO tier_roles (guild_id, tier_key, role_id, updated_at) VALUES ('g1', 'kim-dan', 'r1', 0)").run();
		assert.throws(() => db.prepare("INSERT INTO tier_roles (guild_id, tier_key, role_id, updated_at) VALUES ('g1', 'truc-co', 'r1', 0)").run(), /UNIQUE/);
	});

	test("DB đang ở version 3 có role cảnh giới: migration 4 đổi khoá cảnh giới cũ sang bac-N, thêm created_by_bot và bảng bộ danh hiệu", () =>
	{
		const db = openDatabase(":memory:");
		runMigrations(db, MIGRATIONS.filter(migration => migration.version <= 3));
		const insert = db.prepare<[string, string, string]>("INSERT INTO tier_roles (guild_id, tier_key, role_id, updated_at) VALUES (?, ?, ?, 0)");
		insert.run("g1", "luyen-khi", "r1");
		insert.run("g1", "kim-dan", "r3");
		insert.run("g1", "do-kiep", "r8");
		insert.run("g2", "khoa-la", "r9");

		assert.equal(runMigrations(db, MIGRATIONS.filter(migration => migration.version <= 4)), 1);
		assert.equal(currentSchemaVersion(db), 4);
		const rows = db.prepare<[], { guild_id: string; tier_key: string; role_id: string; created_by_bot: number }>(
			"SELECT guild_id, tier_key, role_id, created_by_bot FROM tier_roles ORDER BY guild_id, role_id").all();
		assert.deepEqual(rows.map(row => [row.guild_id, row.tier_key, row.role_id, row.created_by_bot]), [
			["g1", "bac-1", "r1", 0],
			["g1", "bac-3", "r3", 0],
			["g1", "bac-8", "r8", 0],
			["g2", "khoa-la", "r9", 0],
		]);
		const tables = db.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tier_set_config', 'tier_name_overrides') ORDER BY name").all();
		assert.deepEqual(tables.map(table => table.name), ["tier_name_overrides", "tier_set_config"]);
	});

	test("DB đang ở version 4 có cấu hình guild: migration 5 thêm chế độ kênh 'all' (giữ hành vi cũ), CHECK chặn giá trị lạ (DEC-037)", () =>
	{
		const db = openDatabase(":memory:");
		runMigrations(db, MIGRATIONS.filter(migration => migration.version <= 4));
		db.prepare(`
			INSERT INTO guild_settings (guild_id, xp_per_message, xp_cooldown_seconds, min_message_length, duplicate_window_seconds,
				level_up_announcements, default_poll_xp, contribution_vote_points, admin_role_id, poll_creator_role_id, updated_at)
			VALUES ('g1', 10, 60, 5, 300, 1, 5, 1, NULL, NULL, 0)`).run();

		assert.equal(runMigrations(db, MIGRATIONS.filter(migration => migration.version <= 5)), 1);
		assert.equal(currentSchemaVersion(db), 5);
		assert.deepEqual(db.prepare("SELECT xp_channel_mode FROM guild_settings WHERE guild_id = 'g1'").get(), { xp_channel_mode: "all" });
		db.prepare("UPDATE guild_settings SET xp_channel_mode = 'selected' WHERE guild_id = 'g1'").run();
		assert.throws(() => db.prepare("UPDATE guild_settings SET xp_channel_mode = 'khac' WHERE guild_id = 'g1'").run(), /CHECK/);
	});

	test("DB đang ở version 5 có cấu hình guild: migration 6 thêm kênh thông báo lên level, mặc định NULL (giữ hành vi cũ, DEC-043)", () =>
	{
		const db = openDatabase(":memory:");
		runMigrations(db, MIGRATIONS.filter(migration => migration.version <= 5));
		db.prepare(`
			INSERT INTO guild_settings (guild_id, xp_per_message, xp_cooldown_seconds, min_message_length, duplicate_window_seconds,
				level_up_announcements, default_poll_xp, contribution_vote_points, admin_role_id, poll_creator_role_id, updated_at)
			VALUES ('g1', 10, 60, 5, 300, 1, 5, 1, NULL, NULL, 0)`).run();

		assert.equal(runMigrations(db, MIGRATIONS.filter(migration => migration.version <= 6)), 1);
		assert.equal(currentSchemaVersion(db), 6);
		assert.deepEqual(db.prepare("SELECT level_up_channel_id FROM guild_settings WHERE guild_id = 'g1'").get(), { level_up_channel_id: null });
	});

	test("DB đang ở version 6 có role admin và role tạo vote: migration 7 chép sang guild_role_grants, hai cột cũ về NULL (DEC-044)", () =>
	{
		const db = openDatabase(":memory:");
		runMigrations(db, MIGRATIONS.filter(migration => migration.version <= 6));
		const insert = db.prepare<[string, string | null, string | null, number]>(`
			INSERT INTO guild_settings (guild_id, xp_per_message, xp_cooldown_seconds, min_message_length, duplicate_window_seconds,
				level_up_announcements, default_poll_xp, contribution_vote_points, admin_role_id, poll_creator_role_id, updated_at)
			VALUES (?, 10, 60, 5, 300, 1, 5, 1, ?, ?, ?)`);
		insert.run("g1", "500000000000000001", "500000000000000002", 1000);
		insert.run("g2", "500000000000000003", null, 2000);
		insert.run("g3", null, null, 3000);

		assert.equal(runMigrations(db, MIGRATIONS.filter(migration => migration.version <= 7)), 1);
		assert.equal(currentSchemaVersion(db), 7);
		const grants = db.prepare<[], { guild_id: string; kind: string; role_id: string; created_at: number }>(
			"SELECT guild_id, kind, role_id, created_at FROM guild_role_grants ORDER BY guild_id, kind").all();
		assert.deepEqual(grants.map(row => [row.guild_id, row.kind, row.role_id, row.created_at]), [
			["g1", "admin", "500000000000000001", 1000],
			["g1", "poll_creator", "500000000000000002", 1000],
			["g2", "admin", "500000000000000003", 2000],
		]);
		const oldColumns = db.prepare<[], { admin_role_id: string | null; poll_creator_role_id: string | null }>(
			"SELECT admin_role_id, poll_creator_role_id FROM guild_settings").all();
		assert.ok(oldColumns.every(row => row.admin_role_id === null && row.poll_creator_role_id === null), "hai cột cũ về NULL, không xoá cột");
		assert.equal(db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM guild_settings").get()?.count, 3);

		const clock = new FakeClock();
		const config = new GuildConfigService(db, clock, new AuditService(db, clock));
		assert.deepEqual(config.getSettings("g1").adminRoleIds, ["500000000000000001"]);
		assert.deepEqual(config.getSettings("g1").pollCreatorRoleIds, ["500000000000000002"]);
		assert.deepEqual(config.getSettings("g2").pollCreatorRoleIds, []);
		assert.deepEqual(config.getSettings("g3").adminRoleIds, []);

		assert.throws(() => db.prepare("INSERT INTO guild_role_grants (guild_id, kind, role_id, created_at) VALUES ('g1', 'khac', 'r', 0)").run(), /CHECK/);
		assert.throws(() => db.prepare("INSERT INTO guild_role_grants (guild_id, kind, role_id, created_at) VALUES ('g1', 'admin', '500000000000000001', 0)").run(), /UNIQUE|PRIMARY/);
	});

	test("DB đang ở version 7 có bộ danh hiệu: migration 8 thêm bảng lựa chọn cá nhân và công tắc tự chọn, mặc định bật (DEC-047)", () =>
	{
		const db = openDatabase(":memory:");
		runMigrations(db, MIGRATIONS.filter(migration => migration.version <= 7));
		db.prepare("INSERT INTO tier_set_config (guild_id, set_key, updated_at) VALUES ('g1', 'rank-game', 1000)").run();
		db.prepare("INSERT INTO tier_name_overrides (guild_id, set_key, tier_key, name, emoji, updated_at) VALUES ('g1', 'cay-xanh', 'bac-1', 'Mầm', NULL, 1000)").run();

		assert.equal(runMigrations(db), 1);
		assert.equal(currentSchemaVersion(db), 8);
		const config = db.prepare<[], { guild_id: string; set_key: string; updated_at: number; allow_personal: number }>(
			"SELECT guild_id, set_key, updated_at, allow_personal FROM tier_set_config").all();
		assert.deepEqual(config.map(row => [row.guild_id, row.set_key, row.updated_at, row.allow_personal]), [["g1", "rank-game", 1000, 1]], "dòng cũ giữ nguyên, công tắc bật");
		assert.equal(db.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM tier_name_overrides").get()?.n, 1);

		const columns = db.prepare<[], { name: string; pk: number; notnull: number }>("PRAGMA table_info(member_tier_prefs)").all();
		assert.deepEqual(columns.map(column => [column.name, column.pk, column.notnull]), [
			["guild_id", 1, 1],
			["user_id", 2, 1],
			["set_key", 0, 1],
			["updated_at", 0, 1],
		]);
		db.prepare("INSERT INTO member_tier_prefs (guild_id, user_id, set_key, updated_at) VALUES ('g1', 'u1', 'cay-xanh', 0)").run();
		assert.throws(() => db.prepare("INSERT INTO member_tier_prefs (guild_id, user_id, set_key, updated_at) VALUES ('g1', 'u1', 'vu-tru', 0)").run(), /UNIQUE|PRIMARY/);
		assert.throws(() => db.prepare("UPDATE tier_set_config SET allow_personal = 2 WHERE guild_id = 'g1'").run(), /CHECK/);
		db.prepare("INSERT INTO tier_set_config (guild_id, set_key, updated_at) VALUES ('g2', 'tu-tien', 0)").run();
		assert.equal(db.prepare<[], { allow_personal: number }>("SELECT allow_personal FROM tier_set_config WHERE guild_id = 'g2'").get()?.allow_personal, 1, "dòng mới mặc định bật");

		const clock = new FakeClock();
		const tierSets = new TierSetService(db, clock, new AuditService(db, clock));
		assert.equal(tierSets.currentKey("g1"), "rank-game");
		assert.equal(tierSets.allowPersonal("g1"), true);
		assert.equal(tierSets.allowPersonal("g3"), true, "guild chưa có dòng cấu hình: bật");
		const display = tierSets.displayFor("g1", "u1");
		assert.equal(display.source, "personal");
		assert.equal(display.set.tiers[0].name, "Mầm", "tên tuỳ chỉnh của server cho bộ đã chọn vẫn áp dụng");
		assert.equal(display.serverSet.key, "rank-game");
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
