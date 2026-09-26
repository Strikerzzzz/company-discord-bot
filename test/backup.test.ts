import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { BackupService } from "../src/db/backup";
import { openDatabase } from "../src/db/connection";
import { runMigrations } from "../src/db/migrations";
import { FakeClock } from "./helpers";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("BackupService (DEC-017)", () =>
{
	test("tạo bản sao đọc được, chạy lại sau 24 giờ, giữ đúng số bản", async () =>
	{
		const dir = mkdtempSync(join(tmpdir(), "bot-backup-"));
		try
		{
			const db = openDatabase(join(dir, "bot.db"));
			runMigrations(db);
			db.prepare("INSERT INTO team_roles (guild_id, role_id, created_at) VALUES ('g', 'r', 1)").run();
			const clock = new FakeClock();
			const backup = new BackupService(db, join(dir, "backups"), 2, clock);

			assert.equal(backup.isDue(), true);
			const first = await backup.runIfDue();
			assert.ok(first && existsSync(first));
			assert.equal(await backup.runIfDue(), null);

			const copy = openDatabase(first);
			assert.equal(copy.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM team_roles").get()?.n, 1);
			copy.close();

			clock.advance(DAY_MS);
			await backup.runIfDue();
			clock.advance(DAY_MS);
			await backup.runIfDue();
			assert.equal(backup.list().length, 2);
			assert.equal(backup.latestBackupAt(), clock.now());
			db.close();
		}
		finally
		{
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
