import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDatabase } from "../src/db/connection";
import { runMigrations } from "../src/db/migrations";
import { formatAuditEntry } from "../src/discord/views/admin";
import { createServices } from "../src/services";
import { ADMIN, FakeClock, GUILD, USER_A, USER_B } from "./helpers";

// Hiển thị audit phải khớp với dữ liệu mà service THẬT ghi (target, details), không dựa trên giả định.
describe("audit log: dữ liệu service thật → hiển thị", () =>
{
	test("gỡ contribution hiện tác giả và mã contribution; vote hiện mã vote", () =>
	{
		const dir = mkdtempSync(join(tmpdir(), "bot-audit-"));
		const db = openDatabase(":memory:");
		try
		{
			runMigrations(db);
			const s = createServices(db, { clock: new FakeClock(), backupDir: join(dir, "backups"), backupKeep: 1 });

			const contribution = s.contributions.submit({
				guildId: GUILD, authorId: USER_A, submittedBy: USER_A, title: "Tài liệu quy trình",
				description: "Mô tả", category: "tai-lieu", link: null, authorRoleIds: [],
			});
			s.contributions.remove(GUILD, contribution.id, ADMIN);
			const poll = s.polls.create({ guildId: GUILD, creatorId: ADMIN, question: "Chọn ngày họp", options: ["A", "B"], multiSelect: false, xpReward: 5, durationMinutes: null });
			s.activity.adjustXp({ guildId: GUILD, userId: USER_B, delta: 50, actorId: ADMIN, reason: "thưởng", roleIds: [] });

			const byAction = new Map(s.audit.list(GUILD, 10).map(entry => [entry.action, formatAuditEntry(entry)]));

			const removed = byAction.get("contribution.remove") ?? "";
			assert.ok(removed.includes(`<@${USER_A}>`), removed);
			assert.ok(removed.includes(`Mã contribution: ${contribution.id}`), removed);
			assert.ok(!removed.includes(`contribution #${USER_A}`), removed);

			const created = byAction.get("poll.create") ?? "";
			assert.ok(created.includes(`Mã vote: ${poll.id}`), created);

			const adjusted = byAction.get("xp.adjust") ?? "";
			assert.ok(adjusted.includes(`<@${USER_B}>`), adjusted);
			assert.ok(adjusted.includes("thưởng"), adjusted);
		}
		finally
		{
			db.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
