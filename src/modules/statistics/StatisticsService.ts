import { Statement } from "better-sqlite3";
import { Db } from "../../db/connection";
import { ServiceDeps } from "../deps";
import { GuildStatistics, StatisticsServiceApi } from "./types";

/** Cửa sổ thống kê "gần đây": 7 ngày tính ngược từ thời điểm gọi. */
export const STATISTICS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Số channel tối đa trong danh sách channel sôi nổi nhất. */
export const TOP_CHANNELS_LIMIT = 5;

interface GuildParams
{
	guildId: string;
}

interface WindowParams extends GuildParams
{
	since: number;
}

interface ActivityRow
{
	totalXp: number;
	xpLast7Days: number;
	messageAwardsLast7Days: number;
}

interface ChannelRow
{
	channelId: string;
	awards: number;
}

interface ContributionRow
{
	total: number;
	last7Days: number;
	votes: number;
	totalScore: number;
}

interface PollRow
{
	total: number;
	open: number;
	participations: number;
}

/** Query tổng hợp dạng SELECT (subquery...) luôn trả đúng một dòng; undefined nghĩa là có lỗi ngoài dự kiến. */
function singleRow<T>(row: T | undefined, name: string): T
{
	if (row === undefined) throw new Error(`Query thống kê ${name} không trả về dòng nào.`);
	return row;
}

/**
 * Thống kê tổng quan cho admin, chỉ đọc. Mọi số liệu tách theo guild (DEC-027) và bỏ qua event đã huỷ;
 * Activity XP và Contribution Score thống kê riêng, không cộng gộp (DEC-004).
 */
export class StatisticsService implements StatisticsServiceApi
{
	private readonly activityTotals: Statement<[WindowParams], ActivityRow>;
	private readonly topChannels: Statement<[WindowParams & { limit: number }], ChannelRow>;
	private readonly contributionTotals: Statement<[WindowParams], ContributionRow>;
	private readonly pollTotals: Statement<[GuildParams & { now: number }], PollRow>;

	constructor(private readonly db: Db, private readonly deps: ServiceDeps)
	{
		this.activityTotals = db.prepare<WindowParams, ActivityRow>(`
			SELECT
				(SELECT COALESCE(SUM(total), 0) FROM member_xp WHERE guild_id = @guildId AND total > 0) AS totalXp,
				(SELECT COALESCE(SUM(amount), 0) FROM xp_events
					WHERE guild_id = @guildId AND voided_at IS NULL AND created_at >= @since) AS xpLast7Days,
				(SELECT COUNT(*) FROM xp_events
					WHERE guild_id = @guildId AND voided_at IS NULL AND created_at >= @since AND source = 'message') AS messageAwardsLast7Days`);

		this.topChannels = db.prepare<WindowParams & { limit: number }, ChannelRow>(`
			SELECT reference_id AS channelId, COUNT(*) AS awards
			FROM xp_events
			WHERE guild_id = @guildId AND voided_at IS NULL AND created_at >= @since
				AND source = 'message' AND reference_id IS NOT NULL
			GROUP BY reference_id
			ORDER BY awards DESC, channelId ASC
			LIMIT @limit`);

		this.contributionTotals = db.prepare<WindowParams, ContributionRow>(`
			SELECT
				(SELECT COUNT(*) FROM contributions WHERE guild_id = @guildId AND status = 'active') AS total,
				(SELECT COUNT(*) FROM contributions
					WHERE guild_id = @guildId AND status = 'active' AND created_at >= @since) AS last7Days,
				(SELECT COUNT(*) FROM contribution_votes v
					JOIN contributions c ON c.id = v.contribution_id
					JOIN contribution_events e ON e.id = v.event_id
					WHERE c.guild_id = @guildId AND c.status = 'active' AND e.voided_at IS NULL) AS votes,
				(SELECT COALESCE(SUM(total), 0) FROM member_contribution WHERE guild_id = @guildId AND total > 0) AS totalScore`);

		this.pollTotals = db.prepare<GuildParams & { now: number }, PollRow>(`
			SELECT
				(SELECT COUNT(*) FROM polls WHERE guild_id = @guildId) AS total,
				(SELECT COUNT(*) FROM polls
					WHERE guild_id = @guildId AND closed_at IS NULL AND (closes_at IS NULL OR closes_at > @now)) AS open,
				(SELECT COUNT(*) FROM poll_participants pp
					JOIN polls p ON p.id = pp.poll_id
					WHERE p.guild_id = @guildId) AS participations`);
	}

	summary(guildId: string): GuildStatistics
	{
		const now = this.deps.clock.now();
		const window: WindowParams = { guildId, since: now - STATISTICS_WINDOW_MS };

		const activity = singleRow(this.activityTotals.get(window), "activity");
		const contribution = singleRow(this.contributionTotals.get(window), "contribution");
		const polls = singleRow(this.pollTotals.get({ guildId, now }), "polls");

		return {
			activity: {
				members: this.deps.xpLedger.countRanked(guildId),
				totalXp: activity.totalXp,
				xpLast7Days: activity.xpLast7Days,
				messageAwardsLast7Days: activity.messageAwardsLast7Days,
				topChannelsLast7Days: this.topChannels.all({ ...window, limit: TOP_CHANNELS_LIMIT }),
			},
			contribution: {
				total: contribution.total,
				last7Days: contribution.last7Days,
				votes: contribution.votes,
				totalScore: contribution.totalScore,
			},
			polls: {
				total: polls.total,
				open: polls.open,
				participations: polls.participations,
			},
			teams: this.deps.teams.list(guildId).length,
		};
	}
}
