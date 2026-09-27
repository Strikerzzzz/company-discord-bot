import { Guild, Interaction, PermissionFlagsBits } from "discord.js";
import type DiscordClient from "../classes/DiscordClient";
import { levelInfo } from "../modules/activity/levels";
import { tierForLevel, TierSet } from "../modules/activity/tiers";
import { ActivityProfile } from "../modules/activity/types";
import { ContributionProfile } from "../modules/contribution/types";
import { AchievementProgress, GamificationProfile } from "../modules/gamification/types";
import { LeaderboardEntry, LeaderboardPage, LeaderboardPeriod, LeaderboardScope, ScoreKind } from "../modules/leaderboard/LeaderboardService";
import { formatVnDayMonth, VN_UTC_OFFSET_MS } from "../shared/time";
import { AvatarImage, LeaderboardCardData, LeaderboardCardRow, RankCardData } from "./cards/types";
import { formatNumber } from "./format";
import { canSendMessages } from "./guards";
import { MemberDisplay, UNKNOWN_MEMBER_NAME } from "./memberDirectory";

/*
 * Dựng dữ liệu cho ảnh thẻ (DEC-030). Các hàm build* và rankSummaryText là hàm thuần (test được không cần Discord);
 * loadLeaderboardCard gom dữ liệu từ service, cache thành viên và avatar rồi gọi hàm thuần.
 * Ảnh không vẽ được emoji nên dữ liệu ảnh không chứa emoji; emoji chỉ nằm ở phần chữ của tin nhắn (rankSummaryText).
 */

export const DELETED_ROLE_NAME = "Role đã xoá";
export const NO_BADGE_TEXT = "Chưa có huy hiệu nào — hoạt động thêm để mở khoá nhé!";
/** Số dòng của một trang bảng xếp hạng dạng ảnh. */
export const CARD_PAGE_SIZE = 10;
const MAX_SUMMARY_BADGES = 6;

const KIND_TITLES: Readonly<Record<ScoreKind, string>> = {
	activity: "BẢNG XẾP HẠNG · ACTIVITY XP",
	contribution: "BẢNG XẾP HẠNG · CONTRIBUTION",
};

const SCOPE_LABELS: Readonly<Record<LeaderboardScope, string>> = {
	individual: "Cá nhân",
	team: "Team",
};

/** Tên và avatar đã tải của một người trên bảng cá nhân. */
export interface CardPerson
{
	displayName: string;
	avatar: AvatarImage;
}

/** Tên và màu của role team; `color` là số nguyên RGB của Discord (0 = role không có màu). */
export interface CardRole
{
	name: string;
	color: number;
}

export interface LeaderboardCardInput
{
	kind: ScoreKind;
	scope: LeaderboardScope;
	page: LeaderboardPage;
	/** Bảng cá nhân: tên và avatar của người trong trang; thiếu = "Người dùng không rõ", vẽ chữ cái đầu. */
	people?: ReadonlyMap<string, CardPerson>;
	/**
	 * Bảng Activity cá nhân theo tuần/tháng: tổng XP từ trước tới nay của người trong trang, để tính level và bậc danh hiệu
	 * (bậc luôn theo level tổng, không theo điểm của kỳ). Kỳ "all" thì điểm của dòng chính là tổng XP.
	 */
	totalXp?: ReadonlyMap<string, number>;
	/**
	 * Bộ danh hiệu guild đang dùng (đã áp tên tuỳ chỉnh, DEC-033): bậc trên các dòng bảng Activity cá nhân lấy từ bộ này,
	 * và ảnh của mọi bảng (kể cả Contribution, team) trang trí theo bộ này.
	 */
	tierSet: TierSet;
	/** Bảng team: role còn tồn tại; thiếu = role đã bị xoá. */
	roles?: ReadonlyMap<string, CardRole>;
	/** Người đang xem: dòng của họ được vẽ nổi bật (chỉ bảng cá nhân); null = không ai. */
	viewerId: string | null;
}

/** "mm/yyyy" theo giờ Việt Nam. */
function formatVnMonthYear(ms: number): string
{
	const local = new Date(ms + VN_UTC_OFFSET_MS);
	return `${String(local.getUTCMonth() + 1).padStart(2, "0")}/${local.getUTCFullYear()}`;
}

/** Tên kỳ hiển thị: "Tổng", "Tuần này (từ 28/09)", "Tháng này (09/2026)". */
export function periodLabel(period: LeaderboardPeriod, since: number | null): string
{
	if (period === "week") return since === null ? "Tuần này" : `Tuần này (từ ${formatVnDayMonth(since)})`;
	if (period === "month") return since === null ? "Tháng này" : `Tháng này (${formatVnMonthYear(since)})`;
	return "Tổng";
}

export function leaderboardEmptyText(kind: ScoreKind, scope: LeaderboardScope, period: LeaderboardPeriod): string
{
	const who = scope === "team" ? "team nào" : "ai";
	const call = kind === "activity" ? "nhắn tin để mở hàng!" : "gửi contribution để mở hàng!";
	if (period === "week") return `Tuần này chưa ${who} ghi điểm — ${call}`;
	if (period === "month") return `Tháng này chưa ${who} ghi điểm — ${call}`;
	return `Chưa ${who} có điểm — ${call}`;
}

function scoreText(kind: ScoreKind, value: number): string
{
	return kind === "activity" ? `${formatNumber(value)} XP` : `${formatNumber(value)} điểm`;
}

/** Màu role dạng "#rrggbb"; null nếu role không có màu (0). */
export function roleColorHex(color: number): string | null
{
	if (!Number.isInteger(color) || color <= 0) return null;
	return `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
}

function teamRow(input: LeaderboardCardInput, entry: LeaderboardEntry): LeaderboardCardRow
{
	const role = input.roles?.get(entry.id);
	return {
		rank: entry.rank,
		name: role?.name ?? DELETED_ROLE_NAME,
		avatar: null,
		value: scoreText(input.kind, entry.value),
		detail: null,
		tier: null,
		accentColor: role ? roleColorHex(role.color) : null,
		highlight: false,
	};
}

function personRow(input: LeaderboardCardInput, entry: LeaderboardEntry): LeaderboardCardRow
{
	const person = input.people?.get(entry.id);
	const row: LeaderboardCardRow = {
		rank: entry.rank,
		name: person?.displayName ?? UNKNOWN_MEMBER_NAME,
		avatar: person?.avatar ?? null,
		value: scoreText(input.kind, entry.value),
		detail: null,
		tier: null,
		accentColor: null,
		highlight: input.viewerId !== null && entry.id === input.viewerId,
	};
	if (input.kind === "activity")
	{
		const totalXp = input.page.period === "all" ? entry.value : input.totalXp?.get(entry.id) ?? entry.value;
		const level = levelInfo(totalXp).level;
		row.tier = tierForLevel(level, input.tierSet);
		row.detail = `Lv ${formatNumber(level)}`;
	}
	return row;
}

/** Dữ liệu ảnh bảng xếp hạng của một trang (tối đa 10 dòng). */
export function buildLeaderboardCardData(input: LeaderboardCardInput): LeaderboardCardData
{
	const { kind, scope, page } = input;
	const unit = scope === "team" ? "team" : "người";
	return {
		title: KIND_TITLES[kind],
		subtitle: `${SCOPE_LABELS[scope]} · ${periodLabel(page.period, page.since)}`,
		rows: page.entries.slice(0, CARD_PAGE_SIZE).map(entry => scope === "team" ? teamRow(input, entry) : personRow(input, entry)),
		footer: `Trang ${formatNumber(page.page)}/${formatNumber(page.totalPages)} · ${formatNumber(page.totalEntries)} ${unit}`,
		emptyText: leaderboardEmptyText(kind, scope, page.period),
		tierSet: input.tierSet,
	};
}

export interface RankCardInput
{
	displayName: string;
	avatar: AvatarImage;
	activity: ActivityProfile;
	contribution: ContributionProfile;
	gamification: GamificationProfile;
	/** Tên các role team (không phải mention). */
	teamNames: readonly string[];
}

/** Dữ liệu ảnh thẻ /rank. Level, bộ danh hiệu và bậc lấy cùng từ hồ sơ gamification để luôn khớp nhau. */
export function buildRankCardData(input: RankCardInput): RankCardData
{
	const { activity, contribution, gamification } = input;
	return {
		displayName: input.displayName,
		avatar: input.avatar,
		level: gamification.level,
		tierSet: gamification.tierSet,
		tier: gamification.tier,
		nextTier: gamification.nextTier,
		activity: {
			rank: activity.rank,
			totalRanked: activity.totalRanked,
			weeklyXp: gamification.weekly.xp,
			weeklyRank: gamification.weekly.rank,
		},
		contribution: {
			score: contribution.score,
			rank: contribution.rank,
			totalRanked: contribution.totalRanked,
			contributions: contribution.contributions,
		},
		streak: {
			current: gamification.streak.current,
			best: gamification.streak.best,
			activeToday: gamification.streak.activeToday,
		},
		achievements: {
			unlocked: gamification.achievements.filter(progress => progress.unlocked).length,
			total: gamification.achievements.length,
		},
		teamNames: [...input.teamNames],
	};
}

function badgeText(progress: AchievementProgress): string
{
	return `${progress.achievement.emoji} ${progress.achievement.name}`;
}

/** Huy hiệu chưa đạt gần đạt nhất (tỉ lệ current/threshold cao nhất; hoà thì theo thứ tự ACHIEVEMENTS); null nếu đã đạt hết. */
export function nextAchievement(achievements: readonly AchievementProgress[]): AchievementProgress | null
{
	let best: AchievementProgress | null = null;
	let bestRatio = -1;
	for (const progress of achievements)
	{
		if (progress.unlocked) continue;
		const { threshold } = progress.achievement;
		const ratio = threshold > 0 ? Math.max(0, progress.current) / threshold : 0;
		if (ratio > bestRatio)
		{
			best = progress;
			bestRatio = ratio;
		}
	}
	return best;
}

/**
 * Phần chữ đi kèm ảnh /rank: bậc danh hiệu (theo tên gọi của bộ, ví dụ "Cảnh giới", "Hạng"), chuỗi ngày, huy hiệu đã đạt
 * và huy hiệu sắp đạt. Tên bậc có thể do admin đặt nhưng đã được kiểm tra không chứa ký tự định dạng hay mention (DEC-033).
 */
export function rankSummaryText(profile: GamificationProfile): string
{
	const { tier, tierSet } = profile;
	const lines = [`${tier.emoji} ${tierSet.texts.tierLabel} **${tier.name}** · Level ${formatNumber(profile.level.level)}`];
	if (profile.streak.current > 0) lines.push(`🔥 Chuỗi ${formatNumber(profile.streak.current)} ngày`);

	const unlocked = profile.achievements.filter(progress => progress.unlocked);
	if (unlocked.length === 0)
	{
		lines.push(NO_BADGE_TEXT);
	}
	else
	{
		const shown = unlocked.slice(0, MAX_SUMMARY_BADGES).map(badgeText);
		const hidden = unlocked.length - shown.length;
		lines.push((hidden > 0 ? [...shown, `+${formatNumber(hidden)}`] : shown).join(" · "));
	}

	const next = nextAchievement(profile.achievements);
	if (next)
	{
		const progress = `${formatNumber(Math.max(0, next.current))}/${formatNumber(next.achievement.threshold)}`;
		lines.push(`🎯 Sắp đạt: ${badgeText(next)} (${progress})`);
	}
	return lines.join("\n");
}

export interface LeaderboardCardRequest
{
	kind: ScoreKind;
	scope: LeaderboardScope;
	period: LeaderboardPeriod;
	/** Trang bắt đầu từ 1; ngoài khoảng thì service kẹp về trang hợp lệ gần nhất. */
	page: number;
	viewerId: string | null;
	/** Bộ danh hiệu của guild (tierSets.current), để bậc trên các dòng đúng bộ và tên tuỳ chỉnh. */
	tierSet: TierSet;
}

export interface LoadedLeaderboardCard
{
	/** Trang thật sự đã lấy (đã kẹp), để dựng nút chuyển trang. */
	page: LeaderboardPage;
	data: LeaderboardCardData;
}

async function loadPeople(client: DiscordClient, guild: Guild | null, userIds: readonly string[]): Promise<Map<string, CardPerson>>
{
	if (userIds.length === 0) return new Map();
	const displays = guild ? await client.members.resolve(guild, userIds) : new Map<string, MemberDisplay>();
	const avatars = await Promise.all(userIds.map(userId => client.avatars.get(displays.get(userId)?.avatarUrl ?? null)));
	return new Map(userIds.map((userId, index) => [userId, {
		displayName: displays.get(userId)?.displayName ?? UNKNOWN_MEMBER_NAME,
		avatar: avatars[index],
	}]));
}

function loadRoles(guild: Guild | null, roleIds: readonly string[]): Map<string, CardRole>
{
	const roles = new Map<string, CardRole>();
	for (const roleId of roleIds)
	{
		const role = guild?.roles.cache.get(roleId);
		if (role) roles.set(roleId, { name: role.name, color: role.colors.primaryColor });
	}
	return roles;
}

/**
 * Dữ liệu ảnh của một trang bảng xếp hạng đã lấy: tên, avatar (song song, có cache) của người trong trang,
 * hoặc tên và màu role của team. `guild` null (không có trong cache) thì tên hiển thị là "Người dùng không rõ".
 * `tierSet` là bộ danh hiệu của guild; người gọi lấy một lần rồi dùng cho mọi bảng của cùng lượt.
 */
export async function loadLeaderboardCardData(
	client: DiscordClient,
	guild: Guild | null,
	guildId: string,
	board: { kind: ScoreKind; scope: LeaderboardScope; page: LeaderboardPage },
	viewerId: string | null,
	tierSet: TierSet,
): Promise<LeaderboardCardData>
{
	const { kind, scope, page } = board;
	const ids = page.entries.map(entry => entry.id);
	if (scope === "team") return buildLeaderboardCardData({ kind, scope, page, roles: loadRoles(guild, ids), viewerId, tierSet });

	const totalXp = kind === "activity" && page.period !== "all"
		? new Map(ids.map(userId => [userId, client.services.activity.getProfile(guildId, userId).level.totalXp]))
		: undefined;
	const people = await loadPeople(client, guild, ids);
	return buildLeaderboardCardData({ kind, scope, page, people, totalXp, viewerId, tierSet });
}

/** Lấy một trang bảng xếp hạng (tối đa 10 dòng) và dữ liệu ảnh của nó (xem loadLeaderboardCardData). */
export async function loadLeaderboardCard(
	client: DiscordClient,
	guild: Guild | null,
	guildId: string,
	request: LeaderboardCardRequest,
): Promise<LoadedLeaderboardCard>
{
	const { kind, scope, period } = request;
	const page = client.services.leaderboard.query({ guildId, kind, scope, period, page: request.page, pageSize: CARD_PAGE_SIZE });
	return { page, data: await loadLeaderboardCardData(client, guild, guildId, { kind, scope, page }, request.viewerId, request.tierSet) };
}

/**
 * Ảnh thẻ (/rank, /leaderboard) chỉ trả lời riêng cho người gọi khi họ không được tự gửi tin ở kênh này
 * (không đăng công khai thay họ), hoặc khi bot không có quyền Attach Files ở kênh.
 */
export function mustReplyPrivately(interaction: Interaction): boolean
{
	const canAttach = interaction.appPermissions?.has(PermissionFlagsBits.AttachFiles) ?? false;
	return !canSendMessages(interaction) || !canAttach;
}
