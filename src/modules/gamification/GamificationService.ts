import { Db } from "../../db/connection";
import { startOfVnWeek, vnDayNumber } from "../../shared/time";
import { levelInfo } from "../activity/levels";
import { nextTier, tierForLevel } from "../activity/tiers";
import { ServiceDeps } from "../deps";
import { ACHIEVEMENTS } from "./achievements";
import { GamificationRepository } from "./GamificationRepository";
import { computeStreak } from "./streaks";
import { AchievementProgress, AchievementStats, GamificationProfile, GamificationServiceApi } from "./types";

/** Cảnh giới, chuỗi ngày hoạt động, huy hiệu và XP tuần (DEC-029). Chỉ đọc dữ liệu, không ghi gì. */
export class GamificationService implements GamificationServiceApi
{
	private readonly repo: GamificationRepository;

	constructor(db: Db, private readonly deps: ServiceDeps)
	{
		this.repo = new GamificationRepository(db);
	}

	profile(guildId: string, userId: string): GamificationProfile
	{
		const { xpLedger, contributionLedger, clock } = this.deps;
		const now = clock.now();

		const level = levelInfo(xpLedger.total(guildId, userId));
		// Chuỗi ngày chỉ tính tin nhắn được XP (event "message" chưa huỷ), không tính XP từ vote hay admin.
		const streak = computeStreak(xpLedger.activeDays(guildId, userId, "message"), vnDayNumber(now));
		const stats: AchievementStats = {
			messages: xpLedger.countEvents(guildId, userId, "message"),
			bestStreak: streak.best,
			recognitionsReceived: contributionLedger.countEvents(guildId, userId, "vote"),
			recognitionsGiven: this.repo.recognitionsGiven(guildId, userId),
			pollsJoined: this.repo.pollsJoined(guildId, userId),
			contributions: this.repo.activeContributions(guildId, userId),
		};
		const achievements = ACHIEVEMENTS.map((achievement): AchievementProgress =>
		{
			const current = stats[achievement.stat];
			return { achievement, unlocked: current >= achievement.threshold, current };
		});
		// XP tuần tính mọi nguồn Activity XP (tin nhắn, vote, admin), như bảng xếp hạng tuần.
		const weekly = xpLedger.rankSince(guildId, userId, startOfVnWeek(now));

		return {
			userId,
			level,
			tier: tierForLevel(level.level),
			nextTier: nextTier(level.level),
			streak,
			stats,
			achievements,
			weekly: { xp: weekly.total, rank: weekly.rank },
		};
	}
}
