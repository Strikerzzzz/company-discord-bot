import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Message, MessageFlags, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import type DiscordClient from "../src/classes/DiscordClient";
import { buildLeaderboardCardData, buildRankCardData, rankSummaryText } from "../src/discord/cardData";
import { renderLeaderboardCard } from "../src/discord/cards/leaderboardCard";
import { renderRankCard } from "../src/discord/cards/rankCard";
import { openDatabase } from "../src/db/connection";
import { runMigrations } from "../src/db/migrations";
import MessageCreate from "../src/events/messageCreate";
import { tierUp } from "../src/modules/activity/tiers";
import { createServices } from "../src/services";
import { MS_PER_DAY } from "../src/shared/time";
import { enableContributions, submitApproved, voteUp, withdrawVote } from "./contribution-helpers";
import { ADMIN, CHANNEL_GENERAL, FakeClock, GUILD, ROLE_BACKEND, ROLE_FRONTEND, USER_A, USER_B, USER_C } from "./helpers";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ROLE_LUYEN_KHI = "600000000000000001";
const ROLE_TRUC_CO = "600000000000000002";
const BOT_ID = "900000000000000001";

/** Tin nhắn giả của USER_A trong CHANNEL_GENERAL (không có member, nên không đồng bộ role); ghi lại những gì bot gửi. */
function fakeMessage(content: string, sent: unknown[]): Message
{
	const message = {
		author: { id: USER_A, bot: false },
		webhookId: null,
		system: false,
		inGuild: () => true,
		guildId: GUILD,
		channelId: CHANNEL_GENERAL,
		channel: {
			isThread: () => false,
			isSendable: () => true,
			permissionsFor: () => new PermissionsBitField([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]),
			send: (payload: unknown) =>
			{
				sent.push(payload);
				return Promise.resolve();
			},
		},
		content,
		attachments: { size: 0 },
		member: null,
	};
	return message as unknown as Message;
}

// Phase 12 end-to-end qua service thật và hàm vẽ ảnh thật (chỉ thay Discord bằng lời gọi trực tiếp).
describe("tích hợp: gamification và ảnh thẻ (Phase 12)", () =>
{
	test("chuỗi ngày, cảnh giới, role cảnh giới, giới hạn XP vote, điểm không âm, bảng theo kỳ và ảnh thẻ khớp nhau", async () =>
	{
		const dir = mkdtempSync(join(tmpdir(), "bot-integration-12-"));
		const db = openDatabase(":memory:");
		try
		{
			runMigrations(db);
			// 01/01/2026 07:00 giờ Việt Nam (thứ Năm): tuần bắt đầu thứ Hai 29/12/2025, tháng bắt đầu 01/01/2026.
			const clock = new FakeClock(Date.UTC(2026, 0, 1, 0, 0, 0));
			const s = createServices(db, { clock, backupDir: join(dir, "backups"), backupKeep: 3 });
			s.teams.add(GUILD, ROLE_BACKEND, ADMIN);
			s.teams.add(GUILD, ROLE_FRONTEND, ADMIN);
			s.tierRoles.set(GUILD, "bac-1", ROLE_LUYEN_KHI, ADMIN);
			s.tierRoles.set(GUILD, "bac-2", ROLE_TRUC_CO, ADMIN);

			const message = (userId: string, content: string, roleIds: string[]) =>
				s.activity.handleMessage({ guildId: GUILD, userId, channelId: CHANNEL_GENERAL, content, hasAttachments: false, roleIds });

			// Ba ngày liên tiếp có tin được XP → chuỗi 3 ngày, hôm nay đã tu luyện.
			for (let day = 0; day < 3; day++)
			{
				if (day > 0) clock.advance(MS_PER_DAY);
				assert.equal(message(USER_A, `Báo cáo tiến độ ngày thứ ${day + 1} của dự án`, [ROLE_BACKEND]).awarded, true);
			}
			let profile = s.gamification.profile(GUILD, USER_A);
			assert.deepEqual([profile.streak.current, profile.streak.best, profile.streak.activeToday], [3, 3, true]);
			assert.equal(profile.tier.key, "bac-1");
			assert.deepEqual(s.tierRoles.plan(GUILD, profile.level.level, []), { add: [ROLE_LUYEN_KHI], remove: [] });

			// Admin cộng XP đưa A lên level 3: đột phá Trúc Cơ, role cảnh giới đổi từ Luyện Khí sang Trúc Cơ.
			const before = profile.level.level;
			s.activity.adjustXp({ guildId: GUILD, userId: USER_A, delta: 445, actorId: ADMIN, reason: "Thưởng dự án", roleIds: [ROLE_BACKEND] });
			profile = s.gamification.profile(GUILD, USER_A);
			assert.equal(profile.level.level, 3);
			assert.equal(tierUp(before, profile.level.level)?.key, "bac-2");
			assert.deepEqual(s.tierRoles.plan(GUILD, profile.level.level, [ROLE_LUYEN_KHI, ROLE_BACKEND]), { add: [ROLE_TRUC_CO], remove: [ROLE_LUYEN_KHI] });

			// Giới hạn XP từ vote mặc định 25/ngày: 20 → 5 (bị cắt) → 0 (bị cắt); sang ngày mới được lại.
			const poll = () => s.polls.create({
				guildId: GUILD, creatorId: ADMIN, question: "Chọn giờ họp tuần sau?", options: ["Sáng", "Chiều"],
				multiSelect: false, xpReward: 20, durationMinutes: null,
			});
			const vote = (pollId: number) => s.polls.vote({ guildId: GUILD, pollId, userId: USER_C, optionIndex: 0, roleIds: [ROLE_FRONTEND] });
			const first = vote(poll().id);
			const second = vote(poll().id);
			const third = vote(poll().id);
			assert.deepEqual([first.xpAwarded, first.xpCapped], [20, false]);
			assert.deepEqual([second.xpAwarded, second.xpCapped, second.dailyCap], [5, true, 25]);
			assert.deepEqual([third.xpAwarded, third.xpCapped], [0, true]);
			clock.advance(MS_PER_DAY);
			assert.equal(vote(poll().id).xpAwarded, 20);

			// Điểm contribution không âm: 2 ghi nhận → admin trừ 2 → một người rút → bot bù về 0 và khoá lượt rút, điểm team không âm.
			enableContributions(s.guildConfig);
			const contribution = submitApproved(s.contributions, {
				guildId: GUILD, authorId: USER_B, submittedBy: USER_B, title: "Tài liệu onboarding frontend",
				description: "Hướng dẫn setup môi trường.", category: "tai-lieu", link: null, authorRoleIds: [ROLE_FRONTEND],
			});
			voteUp(s.contributions, contribution.id, USER_A, { voterRoleIds: [ROLE_BACKEND] });
			voteUp(s.contributions, contribution.id, USER_C, { voterRoleIds: [ROLE_FRONTEND] });
			s.contributions.adjust({ guildId: GUILD, userId: USER_B, delta: -2, actorId: ADMIN, reason: "Trùng nội dung", roleIds: [ROLE_FRONTEND] });
			assert.equal(withdrawVote(s.contributions, contribution.id, USER_C).locked, true);
			assert.equal(s.contributions.getProfile(GUILD, USER_B).score, 0);
			const negativeTeams = db.prepare("SELECT COUNT(*) AS n FROM contribution_team_totals WHERE total < 0").get() as { n: number };
			assert.equal(negativeTeams.n, 0);

			// Bảng tuần/tháng và hạng của người xem khớp nhau; hồ sơ gamification phản ánh dữ liệu thật.
			const week = s.leaderboard.query({ guildId: GUILD, kind: "activity", scope: "individual", period: "week", page: 1 });
			assert.equal(week.period, "week");
			assert.equal(week.entries[0].id, USER_A);
			assert.deepEqual(s.leaderboard.userStanding(GUILD, "activity", "week", USER_A), { rank: 1, value: week.entries[0].value, totalRanked: week.totalEntries });
			const teamMonth = s.leaderboard.query({ guildId: GUILD, kind: "activity", scope: "team", period: "month", page: 1 });
			assert.deepEqual(teamMonth.entries.map(entry => entry.id), [ROLE_BACKEND, ROLE_FRONTEND]);
			profile = s.gamification.profile(GUILD, USER_A);
			assert.equal(profile.stats.messages, 3);
			assert.equal(profile.stats.recognitionsGiven, 1);
			assert.deepEqual([profile.streak.current, profile.streak.activeToday], [3, false]);

			// Bảng vàng: đặt kênh, lưu message, tắt.
			s.liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
			assert.equal(s.liveBoards.setMessage(GUILD, CHANNEL_GENERAL, "700000000000000001"), true);
			assert.equal(s.liveBoards.get(GUILD)?.messageId, "700000000000000001");
			assert.equal(s.liveBoards.disable(GUILD, ADMIN)?.channelId, CHANNEL_GENERAL);

			// Ảnh thẻ vẽ từ dữ liệu thật.
			const rank = await renderRankCard(buildRankCardData({
				displayName: "Nguyễn Văn A",
				avatar: null,
				activity: s.activity.getProfile(GUILD, USER_A),
				contribution: s.contributions.getProfile(GUILD, USER_A),
				gamification: profile,
				teamNames: ["Backend"],
			}));
			assert.ok(rank.png.subarray(0, 8).equals(PNG_SIGNATURE));
			assert.match(rankSummaryText(profile), /Trúc Cơ/);
			const board = await renderLeaderboardCard(buildLeaderboardCardData({
				kind: "activity",
				scope: "individual",
				page: week,
				people: new Map([[USER_A, { displayName: "Nguyễn Văn A", avatar: null }]]),
				totalXp: new Map(week.entries.map(entry => [entry.id, s.activity.getProfile(GUILD, entry.id).level.totalXp])),
				viewerId: USER_A,
				tierSet: s.tierSets.current(GUILD),
			}));
			assert.ok(board.png.subarray(0, 8).equals(PNG_SIGNATURE));
		}
		finally
		{
			db.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// Phase 13 end-to-end: bộ danh hiệu của guild đi xuyên qua service thật, event messageCreate thật, dữ liệu ảnh và hàm vẽ thật.
describe("tích hợp: bộ danh hiệu (Phase 13)", () =>
{
	test("đổi bộ sang Rank game và đổi tên một bậc: hồ sơ, thông báo lên bậc, dữ liệu ảnh thẻ và bảng xếp hạng đều theo bộ mới", async () =>
	{
		const db = openDatabase(":memory:");
		try
		{
			runMigrations(db);
			const clock = new FakeClock(Date.UTC(2026, 0, 1, 0, 0, 0));
			const s = createServices(db, { clock, backupDir: "khong-dung", backupKeep: 1 });
			s.tierSets.select(GUILD, "rank-game", ADMIN);
			s.tierSets.rename(GUILD, [{ tierKey: "bac-2", name: "Bạc Ròng", emoji: "🥈" }], ADMIN);

			// 470 XP là Level 2; một tin nhắn được 10 XP qua event thật đưa lên Level 3, vượt mốc bậc 2.
			s.activity.adjustXp({ guildId: GUILD, userId: USER_A, delta: 470, actorId: ADMIN, reason: "Khởi tạo", roleIds: [] });
			const client = { services: s, guildIds: [GUILD], user: { id: BOT_ID } } as unknown as DiscordClient;
			const sent: unknown[] = [];
			await new MessageCreate(client).execute(fakeMessage("Báo cáo tiến độ dự án hôm nay", sent));
			assert.deepEqual(sent, [{
				content: `🏆 Thăng hạng! <@${USER_A}> đã vượt mốc Level 3! 🥈 Hạng **Bạc Ròng** · Level 3`,
				allowedMentions: { users: [USER_A] },
				flags: MessageFlags.SuppressEmbeds,
			}]);

			// Hồ sơ và phần chữ /rank theo bộ mới.
			const profile = s.gamification.profile(GUILD, USER_A);
			assert.equal(profile.level.level, 3);
			assert.equal(profile.tierSet.key, "rank-game");
			assert.deepEqual([profile.tier.key, profile.tier.name, profile.tier.emoji], ["bac-2", "Bạc Ròng", "🥈"]);
			assert.equal(profile.nextTier?.name, "Vàng");
			assert.equal(rankSummaryText(profile).split("\n")[0], "🥈 Hạng **Bạc Ròng** · Level 3");

			const rankData = buildRankCardData({
				displayName: "Nguyễn Văn A",
				avatar: null,
				activity: s.activity.getProfile(GUILD, USER_A),
				contribution: s.contributions.getProfile(GUILD, USER_A),
				gamification: profile,
				teamNames: [],
			});
			assert.equal(rankData.tierSet.key, "rank-game");
			assert.equal(rankData.tierSet.texts.cardName, "thẻ xếp hạng");
			assert.equal(rankData.tier.name, "Bạc Ròng");
			assert.ok((await renderRankCard(rankData)).png.subarray(0, 8).equals(PNG_SIGNATURE));

			const week = s.leaderboard.query({ guildId: GUILD, kind: "activity", scope: "individual", period: "week", page: 1 });
			const boardData = buildLeaderboardCardData({
				kind: "activity",
				scope: "individual",
				page: week,
				totalXp: new Map(week.entries.map(entry => [entry.id, s.activity.getProfile(GUILD, entry.id).level.totalXp])),
				viewerId: USER_A,
				tierSet: s.tierSets.current(GUILD),
			});
			assert.deepEqual(boardData.rows.map(row => [row.tier?.setKey, row.tier?.name, row.detail]), [["rank-game", "Bạc Ròng", "Lv 3"]]);
			assert.ok((await renderLeaderboardCard(boardData)).png.subarray(0, 8).equals(PNG_SIGNATURE));

			// Đổi về Tu tiên rồi lại sang Rank game: tên tuỳ chỉnh lưu theo từng bộ nên không mất.
			s.tierSets.select(GUILD, "tu-tien", ADMIN);
			assert.equal(s.gamification.profile(GUILD, USER_A).tier.name, "Trúc Cơ");
			s.tierSets.select(GUILD, "rank-game", ADMIN);
			assert.equal(s.gamification.profile(GUILD, USER_A).tier.name, "Bạc Ròng");
		}
		finally
		{
			db.close();
		}
	});
});
