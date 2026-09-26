import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDatabase } from "../src/db/connection";
import { runMigrations } from "../src/db/migrations";
import { createServices } from "../src/services";
import { ADMIN, CHANNEL_BOT, CHANNEL_GENERAL, FakeClock, GUILD, ROLE_BACKEND, ROLE_FRONTEND, USER_A, USER_B, USER_C } from "./helpers";

// Luồng end-to-end qua toàn bộ service thật (như khi bot chạy), chỉ thay Discord bằng lời gọi trực tiếp.
describe("tích hợp: một ngày làm việc của bot", () =>
{
	test("XP, contribution, vote, bảng xếp hạng, thống kê và reset hoạt động cùng nhau", async () =>
	{
		const dir = mkdtempSync(join(tmpdir(), "bot-integration-"));
		const db = openDatabase(":memory:");
		try
		{
			runMigrations(db);
			const clock = new FakeClock();
			const s = createServices(db, { clock, backupDir: join(dir, "backups"), backupKeep: 3 });

			// Admin cấu hình team và tắt XP ở channel bot.
			s.teams.add(GUILD, ROLE_BACKEND, ADMIN);
			s.teams.add(GUILD, ROLE_FRONTEND, ADMIN);
			s.guildConfig.setChannel(GUILD, CHANNEL_BOT, { xpEnabled: false }, ADMIN);

			const message = (userId: string, content: string, roleIds: string[], channelId = CHANNEL_GENERAL) =>
				s.activity.handleMessage({ guildId: GUILD, userId, channelId, content, hasAttachments: false, roleIds });

			// Farm XP bị chặn; tin hợp lệ được XP theo cooldown.
			assert.equal(message(USER_A, "ok", [ROLE_BACKEND]).awarded, false);
			assert.equal(message(USER_A, "Mình vừa deploy xong bản sửa lỗi đăng nhập", [ROLE_BACKEND]).awarded, true);
			assert.equal(message(USER_A, "Mọi người kiểm tra giúp mình nhé", [ROLE_BACKEND]).awarded, false);
			assert.equal(message(USER_B, "Frontend đã cập nhật giao diện mới", [ROLE_FRONTEND], CHANNEL_BOT).awarded, false);

			let levelUps = 0;
			for (let i = 0; i < 12; i++)
			{
				clock.advanceSeconds(61);
				const result = message(USER_A, `Cập nhật tiến độ công việc số ${i + 1}`, [ROLE_BACKEND]);
				assert.equal(result.awarded, true);
				if (result.awarded && result.levelAfter > result.levelBefore) levelUps++;
				message(USER_B, `Frontend báo cáo tiến độ lần ${i + 1}`, [ROLE_FRONTEND]);
			}
			const profileA = s.activity.getProfile(GUILD, USER_A);
			assert.equal(profileA.level.totalXp, 130);
			assert.equal(profileA.level.level, 1);
			assert.equal(levelUps, 1);
			assert.equal(profileA.rank, 1);

			// Contribution: B gửi, A và C ghi nhận; B không tự ghi nhận được.
			const contribution = s.contributions.submit({
				guildId: GUILD, authorId: USER_B, submittedBy: USER_B, title: "Tài liệu onboarding frontend",
				description: "Hướng dẫn setup môi trường và quy ước code.", category: "tai-lieu", link: "https://wiki.example/onboarding",
				authorRoleIds: [ROLE_FRONTEND],
			});
			assert.equal(s.contributions.toggleVote({ guildId: GUILD, contributionId: contribution.id, voterId: USER_A }).voted, true);
			assert.equal(s.contributions.toggleVote({ guildId: GUILD, contributionId: contribution.id, voterId: USER_C }).voted, true);
			assert.throws(() => s.contributions.toggleVote({ guildId: GUILD, contributionId: contribution.id, voterId: USER_B }));
			assert.equal(s.contributions.getProfile(GUILD, USER_B).score, 2);

			// Vote: admin tạo, người tham gia được XP một lần.
			const poll = s.polls.create({
				guildId: GUILD, creatorId: ADMIN, question: "Chọn ngày team building", options: ["Thứ 6", "Thứ 7"],
				multiSelect: false, xpReward: 20, durationMinutes: 60,
			});
			const xpBeforePoll = s.activity.getProfile(GUILD, USER_C).level.totalXp;
			assert.equal(s.polls.vote({ guildId: GUILD, pollId: poll.id, userId: USER_C, optionIndex: 0, roleIds: [] }).xpAwarded, 20);
			assert.equal(s.polls.vote({ guildId: GUILD, pollId: poll.id, userId: USER_C, optionIndex: 1, roleIds: [] }).xpAwarded, 0);
			assert.equal(s.activity.getProfile(GUILD, USER_C).level.totalXp, xpBeforePoll + 20);
			clock.advanceSeconds(3601);
			assert.deepEqual(s.polls.closeDue().map(p => p.id), [poll.id]);
			assert.throws(() => s.polls.vote({ guildId: GUILD, pollId: poll.id, userId: USER_A, optionIndex: 0, roleIds: [] }));

			// Hai hệ thống điểm tách biệt; điểm team theo snapshot.
			const activityTeams = s.leaderboard.teams(GUILD, "activity", 1).entries;
			assert.deepEqual(activityTeams.map(e => e.id), [ROLE_BACKEND, ROLE_FRONTEND]);
			assert.deepEqual(s.leaderboard.teams(GUILD, "contribution", 1).entries, [{ rank: 1, id: ROLE_FRONTEND, value: 2 }]);
			assert.equal(s.leaderboard.individual(GUILD, "contribution", 1).entries.length, 1);

			// Thống kê phản ánh dữ liệu.
			const stats = s.statistics.summary(GUILD);
			assert.equal(stats.contribution.total, 1);
			assert.equal(stats.contribution.votes, 2);
			assert.equal(stats.polls.total, 1);
			assert.equal(stats.polls.participations, 1);
			assert.equal(stats.teams, 2);

			// Admin reset XP của A: lịch sử được giữ, tổng về 0, contribution không bị ảnh hưởng.
			s.activity.resetUser(GUILD, USER_A, ADMIN);
			assert.equal(s.activity.getProfile(GUILD, USER_A).level.totalXp, 0);
			assert.equal(s.contributions.getProfile(GUILD, USER_B).score, 2);
			assert.ok(s.audit.list(GUILD, 50).some(entry => entry.action === "xp.reset_user"));

			// Sao lưu thủ công hoạt động trên DB thật.
			const backupPath = await s.backup.createBackup();
			assert.ok(backupPath.endsWith(".db"));
		}
		finally
		{
			db.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
