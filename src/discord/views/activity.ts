import { EmbedBuilder } from "discord.js";
import { levelInfo } from "../../modules/activity/levels";
import { ActivityProfile } from "../../modules/activity/types";
import { ContributionProfile } from "../../modules/contribution/types";
import { LeaderboardEntry, LeaderboardPage, LeaderboardPeriod, LeaderboardScope, ScoreKind } from "../../modules/leaderboard/LeaderboardService";
import { COLORS, formatNumber, progressBar, rankLabel, roleMention, truncate, userMention } from "../format";

// Nội dung hiển thị cho Activity XP, /rank và /leaderboard.
// Chỉ nhận dữ liệu thuần nên test được mà không cần Discord client.

const AUTHOR_NAME_MAX = 256;
const DESCRIPTION_MAX = 4096;

export type { LeaderboardScope };

const KIND_LABELS: Readonly<Record<ScoreKind, string>> = {
	activity: "Activity XP",
	contribution: "Contribution",
};

const SCOPE_LABELS: Readonly<Record<LeaderboardScope, string>> = {
	individual: "Cá nhân",
	team: "Team",
};

function rankText(rank: number | null, totalRanked: number): string
{
	return rank === null ? "Chưa có hạng" : `**#${formatNumber(rank)}**/${formatNumber(totalRanked)}`;
}

export interface RankView
{
	displayName: string;
	avatarUrl: string;
	activity: ActivityProfile;
	contribution: ContributionProfile;
	/** Role ID của các team người đó đang thuộc về. */
	teamRoleIds: readonly string[];
}

/** Hồ sơ /rank: Activity XP, Contribution và Team là ba phần riêng, không cộng gộp hai loại điểm (DEC-004). */
export function rankEmbed(view: RankView): EmbedBuilder
{
	const { level } = view.activity;
	const activity = [
		`**Level ${formatNumber(level.level)}** · ${formatNumber(level.totalXp)} XP`,
		`${progressBar(level.xpIntoLevel, level.xpForNextLevel)} ${formatNumber(level.xpIntoLevel)}/${formatNumber(level.xpForNextLevel)} XP`,
		`Hạng: ${rankText(view.activity.rank, view.activity.totalRanked)}`,
	];
	const contribution = [
		`**${formatNumber(view.contribution.score)}** điểm · ${formatNumber(view.contribution.contributions)} contribution`,
		`Hạng: ${rankText(view.contribution.rank, view.contribution.totalRanked)}`,
	];
	const teams = view.teamRoleIds.length > 0
		? view.teamRoleIds.map(roleId => roleMention(roleId)).join(", ")
		: "Chưa thuộc team nào";

	return new EmbedBuilder()
		.setColor(COLORS.primary)
		.setAuthor({ name: truncate(view.displayName, AUTHOR_NAME_MAX), iconURL: view.avatarUrl })
		.addFields(
			{ name: "⚡ Activity XP", value: activity.join("\n") },
			{ name: "🌟 Contribution", value: contribution.join("\n") },
			{ name: "👥 Team", value: teams },
		);
}

const PERIOD_LABELS: Readonly<Record<LeaderboardPeriod, string | null>> = {
	all: null,
	week: "Tuần này",
	month: "Tháng này",
};

/** Tiêu đề bảng xếp hạng; kỳ tuần/tháng được ghi thêm ở cuối, kỳ tổng giữ tiêu đề cũ. */
export function leaderboardTitle(kind: ScoreKind, scope: LeaderboardScope, period: LeaderboardPeriod = "all"): string
{
	const title = `🏆 Bảng xếp hạng ${KIND_LABELS[kind]} — ${SCOPE_LABELS[scope]}`;
	const periodLabel = PERIOD_LABELS[period];
	return periodLabel === null ? title : `${title} · ${periodLabel}`;
}

/**
 * Giá trị của một dòng: Activity cá nhân kỳ tổng kèm level; team chỉ có tổng điểm. Kỳ tuần/tháng không kèm level,
 * vì điểm của kỳ không phải tổng XP.
 */
export function leaderboardValue(kind: ScoreKind, scope: LeaderboardScope, value: number, period: LeaderboardPeriod = "all"): string
{
	if (kind === "contribution") return `${formatNumber(value)} điểm`;
	if (scope === "team" || period !== "all") return `${formatNumber(value)} XP`;
	return `Level ${formatNumber(levelInfo(value).level)} · ${formatNumber(value)} XP`;
}

function leaderboardLine(entry: LeaderboardEntry, kind: ScoreKind, scope: LeaderboardScope, period: LeaderboardPeriod): string
{
	const mention = scope === "team" ? roleMention(entry.id) : userMention(entry.id);
	return `${rankLabel(entry.rank)} ${mention} — ${leaderboardValue(kind, scope, entry.value, period)}`;
}

export interface LeaderboardView
{
	kind: ScoreKind;
	scope: LeaderboardScope;
	page: LeaderboardPage;
}

export function leaderboardEmbed(view: LeaderboardView): EmbedBuilder
{
	const { kind, scope, page } = view;
	const lines = page.entries.map(entry => leaderboardLine(entry, kind, scope, page.period));
	const unit = scope === "team" ? "team" : "người";

	return new EmbedBuilder()
		.setColor(COLORS.gold)
		.setTitle(leaderboardTitle(kind, scope, page.period))
		.setDescription(lines.length > 0 ? truncate(lines.join("\n"), DESCRIPTION_MAX) : "Chưa có dữ liệu.")
		.setFooter({ text: `Trang ${formatNumber(page.page)}/${formatNumber(page.totalPages)} · ${formatNumber(page.totalEntries)} ${unit}` });
}
