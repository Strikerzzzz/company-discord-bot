export interface GuildStatistics
{
	activity: {
		/** Số người có XP > 0. */
		members: number;
		totalXp: number;
		xpLast7Days: number;
		/** Số lần được XP từ tin nhắn trong 7 ngày. */
		messageAwardsLast7Days: number;
		/** Tối đa 5 channel có nhiều lần được XP nhất trong 7 ngày. */
		topChannelsLast7Days: { channelId: string; awards: number }[];
	};
	contribution: {
		/** Contribution còn hiệu lực. */
		total: number;
		last7Days: number;
		/** Lượt ghi nhận hiện có. */
		votes: number;
		totalScore: number;
	};
	polls: {
		total: number;
		open: number;
		/** Tổng lượt tham gia (mỗi người mỗi vote tính một). */
		participations: number;
	};
	/** Số team đang cấu hình. */
	teams: number;
}

export interface StatisticsServiceApi
{
	summary(guildId: string): GuildStatistics;
}
