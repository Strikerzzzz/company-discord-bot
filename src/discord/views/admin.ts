// Hàm thuần dựng nội dung hiển thị cho lệnh quản trị (/admin, /config). Không truy cập service hay database.
import { EmbedBuilder, escapeMarkdown, InteractionReplyOptions, MessageFlags } from "discord.js";
import { isTierKey, isTierSetKey, TIER_SETS, tierByKey, tierForLevel, tierIndex, TierSet } from "../../modules/activity/tiers";
import { ActivityProfile, XpEventSource, XpEventView } from "../../modules/activity/types";
import { AuditAction, AuditEntry } from "../../modules/audit/AuditService";
import { TierRoleMapping } from "../../modules/gamification/types";
import { ChannelSettings, GuildSettings } from "../../modules/guild-config/types";
import { GuildStatistics } from "../../modules/statistics/types";
import { MAX_TEAMS } from "../../modules/team/TeamService";
import {
	channelMention,
	COLORS,
	dateTime,
	disableMaskedLinks,
	DISCORD_LIMITS,
	fitLines,
	formatNumber,
	progressBar,
	relativeTime,
	roleMention,
	truncate,
	userMention,
} from "../format";
import type { TierRoleSyncResult } from "../roleSync";

const EMBED_DESCRIPTION_MAX = DISCORD_LIMITS.embedDescription;
const EMBED_FIELD_MAX = DISCORD_LIMITS.embedFieldValue;

const REASON_DISPLAY_MAX = 100;
const DETAIL_VALUE_MAX = 80;
const AUDIT_DETAILS_MAX = 300;

export function ephemeral(content: string): InteractionReplyOptions
{
	return { content, flags: MessageFlags.Ephemeral };
}

export function ephemeralEmbed(embed: EmbedBuilder): InteractionReplyOptions
{
	return { embeds: [embed], flags: MessageFlags.Ephemeral };
}

/** Văn bản do người dùng nhập, hiển thị trên một dòng: gộp khoảng trắng/xuống dòng, bỏ masked link, cắt ngắn, escape markdown. */
export function inlineText(text: string, max: number): string
{
	return escapeMarkdown(truncate(disableMaskedLinks(text.replace(/\s+/g, " ").trim()), max));
}

/** Số có dấu: "+1.234" hoặc "−1.234" (dấu trừ U+2212). */
export function signed(value: number): string
{
	return value < 0 ? `−${formatNumber(Math.abs(value))}` : `+${formatNumber(value)}`;
}

function onOff(value: boolean): string
{
	return value ? "Bật" : "Tắt";
}

function seconds(value: number): string
{
	return `${formatNumber(value)} giây`;
}

// ---------- Cấu hình ----------

interface SettingDisplay<T>
{
	label: string;
	format: (value: T) => string;
}

type SettingDisplayMap = { [K in keyof GuildSettings]: SettingDisplay<GuildSettings[K]> };

const SETTING_DISPLAY: SettingDisplayMap = {
	xpPerMessage: { label: "XP mỗi tin nhắn", format: value => `${formatNumber(value)} XP` },
	xpCooldownSeconds: { label: "Cooldown", format: seconds },
	minMessageLength: { label: "Độ dài tối thiểu", format: value => `${formatNumber(value)} ký tự` },
	duplicateWindowSeconds: { label: "Chống trùng", format: seconds },
	levelUpAnnouncements: { label: "Thông báo lên level", format: onOff },
	defaultPollXp: { label: "XP mặc định khi vote", format: value => `${formatNumber(value)} XP` },
	pollXpDailyCap: { label: "Giới hạn XP từ vote mỗi ngày", format: value => value === 0 ? "không giới hạn" : `${formatNumber(value)} XP` },
	pollCreatorRoleId: { label: "Role tạo vote", format: value => value === null ? "chưa đặt (chỉ admin)" : roleMention(value) },
	contributionVotePoints: { label: "Điểm mỗi lượt ghi nhận", format: value => `${formatNumber(value)} điểm` },
	adminRoleId: { label: "Role admin bot", format: value => value === null ? "chưa đặt" : roleMention(value) },
};

const SETTING_ORDER: readonly (keyof GuildSettings)[] = [
	"xpPerMessage",
	"xpCooldownSeconds",
	"minMessageLength",
	"duplicateWindowSeconds",
	"levelUpAnnouncements",
	"defaultPollXp",
	"pollXpDailyCap",
	"pollCreatorRoleId",
	"contributionVotePoints",
	"adminRoleId",
];

function isSettingKey(key: string): key is keyof GuildSettings
{
	return Object.hasOwn(SETTING_DISPLAY, key);
}

/** Một dòng "• Nhãn: **giá trị**" cho một mục cấu hình. */
export function settingLine<K extends keyof GuildSettings>(key: K, value: GuildSettings[K]): string
{
	const display: SettingDisplay<GuildSettings[K]> = SETTING_DISPLAY[key];
	return `• ${display.label}: **${display.format(value)}**`;
}

/** Các dòng mô tả những mục cấu hình vừa thay đổi, theo thứ tự cố định. */
export function describeSettingsPatch(patch: Partial<GuildSettings>): string[]
{
	const lines: string[] = [];
	for (const key of SETTING_ORDER)
	{
		const value = patch[key];
		if (value !== undefined) lines.push(settingLine(key, value));
	}
	return lines;
}

/** Mô tả ngắn cấu hình riêng của một channel, ví dụ "bật XP, 20 XP/tin, cooldown 30 giây". */
export function describeChannelSettings(channel: ChannelSettings): string
{
	if (!channel.xpEnabled) return "tắt XP";
	const parts = ["bật XP"];
	if (channel.xpPerMessage !== null) parts.push(`${formatNumber(channel.xpPerMessage)} XP/tin`);
	if (channel.xpCooldownSeconds !== null) parts.push(`cooldown ${seconds(channel.xpCooldownSeconds)}`);
	if (parts.length === 1) parts.push("dùng giá trị chung");
	return parts.join(", ");
}

function channelLines(channels: readonly ChannelSettings[]): string[]
{
	return channels.map(channel => `${channelMention(channel.channelId)}: ${describeChannelSettings(channel)}`);
}

function teamLines(teams: readonly string[]): string[]
{
	return teams.map((roleId, index) => `${index + 1}. ${roleMention(roleId)}`);
}

function settingLines(settings: GuildSettings, keys: readonly (keyof GuildSettings)[]): string
{
	return keys.map(key => settingLine(key, settings[key])).join("\n");
}

/** Phần cấu hình gamification hiển thị trong `/config view` (DEC-030, DEC-031, DEC-033). */
export interface GamificationConfigView
{
	/** Kênh Bảng vàng; null = đang tắt. */
	boardChannelId: string | null;
	/** Các bậc đã gán role, theo thứ tự bậc. */
	tierRoles: readonly TierRoleMapping[];
	/** Bộ danh hiệu guild đang dùng (đã áp tên tuỳ chỉnh, DEC-033). */
	tierSet: TierSet;
}

/** Gợi ý trong `/config view`: mọi chỉnh sửa danh hiệu (chọn bộ, đổi tên bậc, tạo/gán role) nằm ở bảng điều khiển. */
export const TIER_PANEL_HINT = "Dùng `/config tier panel` để chọn bộ, đổi tên bậc, tạo hoặc gán role.";

/** Một dòng "emoji Tên (Lv n+)" của bậc `tierKey` trong bộ `set`. */
function tierLabel(tierKey: TierRoleMapping["tierKey"], set: TierSet): string
{
	const tier = tierByKey(tierKey, set);
	return `${tier.emoji} ${tier.name} (Lv ${formatNumber(tier.minLevel)}+)`;
}

/** Nội dung field danh hiệu: các bậc đã gán role (gọn trong giới hạn field) và gợi ý bảng điều khiển luôn ở cuối. */
function tierRoleFieldText(tierRoles: readonly TierRoleMapping[], set: TierSet): string
{
	if (tierRoles.length === 0) return `Chưa gán role nào. ${TIER_PANEL_HINT}`;
	const lines = tierRoles.map(mapping => `${tierLabel(mapping.tierKey, set)}: ${roleMention(mapping.roleId)}`);
	const budget = EMBED_FIELD_MAX - TIER_PANEL_HINT.length - 1;
	return `${fitLines(lines, budget, hidden => `… và ${hidden} bậc khác`)}\n${TIER_PANEL_HINT}`;
}

export function buildConfigEmbed(
	settings: GuildSettings,
	teams: readonly string[],
	channels: readonly ChannelSettings[],
	gamification: GamificationConfigView,
): EmbedBuilder
{
	const teamText = teams.length > 0
		? fitLines(teamLines(teams), EMBED_FIELD_MAX, hidden => `… và ${hidden} team khác`)
		: "Chưa có team nào. Dùng `/config team add` để thêm.";
	const channelText = channels.length > 0
		? fitLines(channelLines(channels), EMBED_FIELD_MAX, hidden => `… và ${hidden} channel khác (xem \`/config channel list\`)`)
		: "Không có. Mọi channel dùng cấu hình chung.";
	const boardText = gamification.boardChannelId === null
		? "Đang tắt. Dùng `/config board` để bật."
		: `${channelMention(gamification.boardChannelId)} (tự cập nhật định kỳ)`;
	const { tierSet, tierRoles } = gamification;
	const tierRoleText = tierRoleFieldText(tierRoles, tierSet);

	return new EmbedBuilder()
		.setColor(COLORS.primary)
		.setTitle("⚙️ Cấu hình bot")
		.addFields(
			{ name: "⭐ Activity XP", value: settingLines(settings, ["xpPerMessage", "xpCooldownSeconds", "minMessageLength", "duplicateWindowSeconds", "levelUpAnnouncements"]) },
			{ name: "🗳️ Vote", value: settingLines(settings, ["defaultPollXp", "pollXpDailyCap", "pollCreatorRoleId"]) },
			{ name: "🤝 Contribution", value: settingLines(settings, ["contributionVotePoints"]) },
			{ name: "🔐 Quyền admin", value: `${settingLines(settings, ["adminRoleId"])}\nNgười có quyền Manage Server luôn là admin.` },
			{ name: `👥 Team (${teams.length}/${MAX_TEAMS})`, value: teamText },
			{ name: `📺 Channel có cấu hình riêng (${channels.length})`, value: channelText },
			{ name: "🏆 Bảng vàng", value: boardText },
			{ name: `🏅 Danh hiệu: bộ ${tierSet.name} · role đã gán ${tierRoles.length}/${tierSet.tiers.length}`, value: tierRoleText },
		);
}

export function buildChannelListEmbed(channels: readonly ChannelSettings[], settings: GuildSettings): EmbedBuilder
{
	const description = channels.length > 0
		? fitLines(channelLines(channels), EMBED_DESCRIPTION_MAX, hidden => `… và ${hidden} channel khác`)
		: "Không có channel nào có cấu hình riêng. Mọi channel dùng cấu hình chung.";

	return new EmbedBuilder()
		.setColor(COLORS.primary)
		.setTitle("📺 Channel có cấu hình riêng")
		.setDescription(description)
		.setFooter({ text: `Cấu hình chung: ${formatNumber(settings.xpPerMessage)} XP/tin, cooldown ${seconds(settings.xpCooldownSeconds)}.` });
}

export function buildTeamListEmbed(teams: readonly string[]): EmbedBuilder
{
	const description = teams.length > 0
		? fitLines(teamLines(teams), EMBED_DESCRIPTION_MAX, hidden => `… và ${hidden} team khác`)
		: "Chưa có team nào. Dùng `/config team add` để thêm.";

	return new EmbedBuilder()
		.setColor(COLORS.primary)
		.setTitle(`👥 Danh sách team (${teams.length}/${MAX_TEAMS})`)
		.setDescription(description)
		.setFooter({ text: "Điểm team tính theo role team của thành viên tại thời điểm kiếm điểm." });
}

// ---------- Danh hiệu ----------
// Danh sách role danh hiệu và các ghi chú về role nằm ở views/tierPanel.ts.

/** Một dòng mô tả kết quả đồng bộ role danh hiệu; null nếu không có gì thay đổi hay bị bỏ qua. */
export function tierRoleSyncLine(result: TierRoleSyncResult): string | null
{
	const mentions = (roleIds: readonly string[]): string => roleIds.map(roleId => roleMention(roleId)).join(", ");
	const parts: string[] = [];
	if (result.added.length > 0) parts.push(`đã thêm ${mentions(result.added)}`);
	if (result.removed.length > 0) parts.push(`đã bỏ ${mentions(result.removed)}`);
	if (result.skipped.length > 0)
	{
		parts.push(`không đổi được ${mentions(result.skipped)} (kiểm tra quyền Manage Roles và thứ bậc role của bot; vừa lỗi thì bot chờ 10 phút mới thử lại)`);
	}
	return parts.length > 0 ? `🏅 Role danh hiệu: ${parts.join(" · ")}.` : null;
}

// ---------- Activity XP ----------

const XP_SOURCE_LABELS: Record<XpEventSource, string> = {
	message: "tin nhắn",
	poll: "vote",
	admin: "admin",
};

/** Một dòng biến động XP; event đã huỷ bị gạch ngang. */
export function formatXpEvent(event: XpEventView): string
{
	const parts = [`**${signed(event.amount)} XP**`, XP_SOURCE_LABELS[event.source]];
	if (event.reason) parts.push(inlineText(event.reason, REASON_DISPLAY_MAX));
	parts.push(relativeTime(event.createdAt));
	const line = parts.join(" · ");
	return event.voided ? `~~${line}~~ (đã huỷ)` : line;
}

function rankText(rank: number | null, totalRanked: number): string
{
	return rank === null ? "Chưa xếp hạng" : `#${formatNumber(rank)} / ${formatNumber(totalRanked)}`;
}

/**
 * Chi tiết Activity XP của một thành viên; bậc theo bộ danh hiệu `set` của guild, field mang tên gọi bậc của bộ.
 * Field vị trí trên bảng tên "Xếp hạng" để không trùng tên gọi bậc "Hạng" của bộ Rank game.
 */
export function buildXpDetailEmbed(profile: ActivityProfile, events: readonly XpEventView[], set: TierSet): EmbedBuilder
{
	const { level } = profile;
	const tier = tierForLevel(level.level, set);
	const header = `${userMention(profile.userId)}\n\n**Biến động gần nhất**\n`;
	const history = events.length > 0
		? fitLines(events.map(formatXpEvent), EMBED_DESCRIPTION_MAX - header.length, hidden => `… và ${hidden} biến động khác`)
		: "Chưa có biến động nào.";

	return new EmbedBuilder()
		.setColor(COLORS.primary)
		.setTitle("⭐ Chi tiết Activity XP")
		.setDescription(header + history)
		.addFields(
			{ name: "Level", value: formatNumber(level.level), inline: true },
			{ name: "Tổng XP", value: formatNumber(level.totalXp), inline: true },
			{ name: "Xếp hạng", value: rankText(profile.rank, profile.totalRanked), inline: true },
			{ name: set.texts.tierLabel, value: `${tier.emoji} ${tier.name}`, inline: true },
			{
				name: `Tiến độ lên level ${formatNumber(level.level + 1)}`,
				value: `${progressBar(level.xpIntoLevel, level.xpForNextLevel)} ${formatNumber(level.xpIntoLevel)} / ${formatNumber(level.xpForNextLevel)} XP`,
			},
		);
}

// ---------- Thống kê ----------

export function buildStatsEmbed(stats: GuildStatistics): EmbedBuilder
{
	const { activity, contribution, polls } = stats;
	const topChannels = activity.topChannelsLast7Days.length > 0
		? activity.topChannelsLast7Days
			.map((channel, index) => `${index + 1}. ${channelMention(channel.channelId)} · **${formatNumber(channel.awards)}** lượt`)
			.join("\n")
		: "Chưa có dữ liệu.";

	return new EmbedBuilder()
		.setColor(COLORS.primary)
		.setTitle("📊 Thống kê server")
		.addFields(
			{
				name: "⭐ Activity XP",
				value: [
					`Thành viên có XP: **${formatNumber(activity.members)}**`,
					`Tổng XP: **${formatNumber(activity.totalXp)}**`,
					`XP trong 7 ngày: **${formatNumber(activity.xpLast7Days)}**`,
					`Lượt được XP từ tin nhắn (7 ngày): **${formatNumber(activity.messageAwardsLast7Days)}**`,
				].join("\n"),
			},
			{
				name: "🤝 Contribution",
				value: [
					`Contribution còn hiệu lực: **${formatNumber(contribution.total)}**`,
					`Mới trong 7 ngày: **${formatNumber(contribution.last7Days)}**`,
					`Lượt ghi nhận: **${formatNumber(contribution.votes)}**`,
					`Tổng điểm: **${formatNumber(contribution.totalScore)}**`,
				].join("\n"),
			},
			{
				name: "🗳️ Vote",
				value: [
					`Tổng số vote: **${formatNumber(polls.total)}**`,
					`Đang mở: **${formatNumber(polls.open)}**`,
					`Lượt tham gia: **${formatNumber(polls.participations)}**`,
				].join("\n"),
			},
			{ name: "👥 Team", value: `Đang cấu hình: **${formatNumber(stats.teams)}**` },
			{ name: "🔥 Channel sôi nổi nhất (7 ngày)", value: topChannels },
		);
}

// ---------- Audit log ----------

const AUDIT_LABELS: Record<AuditAction, string> = {
	"config.update": "Cập nhật cấu hình",
	"channel.set": "Đặt cấu hình channel",
	"channel.reset": "Xoá cấu hình channel",
	"team.add": "Thêm team",
	"team.remove": "Bỏ team",
	"xp.adjust": "Điều chỉnh XP",
	"xp.reset_user": "Reset XP thành viên",
	"xp.reset_all": "Reset XP toàn server",
	"contribution.remove": "Gỡ contribution",
	"contribution.adjust": "Điều chỉnh điểm contribution",
	"contribution.reset_user": "Reset contribution thành viên",
	"contribution.reset_all": "Reset contribution toàn server",
	"poll.create": "Tạo vote",
	"poll.close": "Đóng vote",
	"tier_role.set": "Gán role danh hiệu cho bậc",
	"tier_role.clear": "Bỏ role danh hiệu của bậc",
	"tier_role.setup": "Tạo/đồng bộ role danh hiệu",
	"tier_set.set": "Chọn bộ danh hiệu",
	"tier_name.set": "Đổi tên bậc danh hiệu",
	"tier_name.reset": "Khôi phục tên bậc mặc định",
	"board.set": "Đặt kênh Bảng vàng",
	"board.clear": "Tắt Bảng vàng",
	"backup.manual": "Sao lưu thủ công",
};

// Khớp với dữ liệu service ghi: contribution.remove có target là tác giả (mã contribution nằm trong details),
// poll.* không có target (mã vote nằm trong details), tier_role.set/clear có target là role (khoá bậc trong details.tierKey),
// board.* có target là channel của Bảng vàng.
type AuditTargetKind = "user" | "role" | "channel" | "none";

const AUDIT_TARGETS: Record<AuditAction, AuditTargetKind> = {
	"config.update": "none",
	"channel.set": "channel",
	"channel.reset": "channel",
	"team.add": "role",
	"team.remove": "role",
	"xp.adjust": "user",
	"xp.reset_user": "user",
	"xp.reset_all": "none",
	"contribution.remove": "user",
	"contribution.adjust": "user",
	"contribution.reset_user": "user",
	"contribution.reset_all": "none",
	"poll.create": "none",
	"poll.close": "none",
	"tier_role.set": "role",
	"tier_role.clear": "role",
	"tier_role.setup": "none",
	"tier_set.set": "none",
	"tier_name.set": "none",
	"tier_name.reset": "none",
	"board.set": "channel",
	"board.clear": "channel",
	"backup.manual": "none",
};

const DETAIL_LABELS = new Map<string, string>([
	["delta", "Thay đổi"],
	["reason", "Lý do"],
	["file", "File"],
	["xpEnabled", "Bật XP"],
	["voidedEvents", "Biến động đã huỷ"],
	["members", "Thành viên"],
	["title", "Tiêu đề"],
	["question", "Câu hỏi"],
	["authorId", "Tác giả"],
	["contributionId", "Mã contribution"],
	["pollId", "Mã vote"],
	["totalXp", "Tổng XP"],
	["score", "Tổng điểm"],
	["xpReward", "XP khi tham gia"],
	["tierKey", "Bậc"],
	["setKey", "Bộ danh hiệu"],
	["from", "Từ bộ"],
	["to", "Sang bộ"],
	["name", "Tên"],
	["emoji", "Emoji"],
	["count", "Số bậc"],
	["created", "Số role tạo mới"],
	["renamed", "Số role đổi tên"],
	["skipped", "Số bậc bỏ qua"],
	["renamedRoles", "Role đổi tên"],
	["keptRoles", "Role giữ nguyên tên"],
	["orphanedRoles", "Role không xoá được"],
	["deletedRoleId", "Role đã xoá"],
	["compensated", "Điểm bù tự động"],
]);

/** Khoá cảnh giới tu tiên dùng trước migration 4 (DEC-033), theo thứ tự bậc; audit cũ vẫn giữ nguyên các khoá này. */
const LEGACY_TIER_KEYS: readonly string[] = ["luyen-khi", "truc-co", "kim-dan", "nguyen-anh", "hoa-than", "luyen-hu", "hop-the", "do-kiep"];

const SNOWFLAKE = /^\d{17,20}$/;
const ROLE_LIST_MAX = 160;

/** Số thứ tự 1–8 của bậc theo khoá hiện tại hoặc khoá cũ; null nếu khoá lạ. */
function tierNumber(value: string): number | null
{
	if (isTierKey(value)) return tierIndex(value) + 1;
	const legacy = LEGACY_TIER_KEYS.indexOf(value);
	return legacy >= 0 ? legacy + 1 : null;
}

/** ID role của một phần tử danh sách role trong audit: chuỗi ID, hoặc object có `roleId`. */
function listedRoleId(item: unknown): string | null
{
	if (typeof item === "string") return SNOWFLAKE.test(item) ? item : null;
	if (typeof item === "object" && item !== null && "roleId" in item && typeof item.roleId === "string" && SNOWFLAKE.test(item.roleId))
	{
		return item.roleId;
	}
	return null;
}

/** Danh sách role dạng mention, gọn trong giới hạn; null nếu có phần tử không nhận ra được ID role. */
function roleListText(items: readonly unknown[]): string | null
{
	const roleIds: string[] = [];
	for (const item of items)
	{
		const roleId = listedRoleId(item);
		if (roleId === null) return null;
		roleIds.push(roleId);
	}
	if (roleIds.length === 0) return "không có";
	return fitLines(roleIds.map(roleMention), ROLE_LIST_MAX, hidden => `và ${hidden} role khác`, { separator: ", " });
}

/** Nhãn tiếng Việt của một hành động trong audit log. */
export function auditActionLabel(action: AuditAction): string
{
	return AUDIT_LABELS[action];
}

function auditTarget(action: AuditAction, targetId: string | null): string | null
{
	if (targetId === null) return null;
	switch (AUDIT_TARGETS[action])
	{
	case "user": return userMention(targetId);
	case "role": return roleMention(targetId);
	case "channel": return channelMention(targetId);
	case "none": return inlineText(targetId, DETAIL_VALUE_MAX);
	}
}

function detailLabel(key: string): string
{
	if (isSettingKey(key)) return SETTING_DISPLAY[key].label;
	return DETAIL_LABELS.get(key) ?? key;
}

function detailValue(key: string, value: unknown): string
{
	if (value === null || value === undefined) return "không có";
	if (typeof value === "boolean") return onOff(value);
	if (typeof value === "number") return key === "delta" ? signed(value) : formatNumber(value);
	if (typeof value === "string")
	{
		const tier = key === "tierKey" ? tierNumber(value) : null;
		if (tier !== null) return `Bậc ${tier}`;
		if ((key === "setKey" || key === "from" || key === "to") && isTierSetKey(value)) return TIER_SETS[value].name;
		if (SNOWFLAKE.test(value))
		{
			if (key === "deletedRoleId") return `${roleMention(value)} (ID ${value})`;
			if (key.endsWith("RoleId")) return roleMention(value);
			if (key.endsWith("ChannelId")) return channelMention(value);
			if (key.endsWith("Id")) return userMention(value);
		}
		return inlineText(value, DETAIL_VALUE_MAX);
	}
	if (Array.isArray(value) && key.endsWith("Roles"))
	{
		const roles = roleListText(value);
		if (roles !== null) return roles;
	}
	return inlineText(JSON.stringify(value), DETAIL_VALUE_MAX);
}

/** Chi tiết của một mục audit dạng "Nhãn: giá trị · ..."; null nếu không có chi tiết. */
export function formatAuditDetails(details: Record<string, unknown> | null): string | null
{
	if (!details) return null;
	const parts = Object.entries(details).map(([key, value]) => `${detailLabel(key)}: ${detailValue(key, value)}`);
	return parts.length > 0 ? truncate(parts.join(" · "), AUDIT_DETAILS_MAX) : null;
}

export function formatAuditEntry(entry: AuditEntry): string
{
	const target = auditTarget(entry.action, entry.targetId);
	const lines = [
		`**${auditActionLabel(entry.action)}** · ${dateTime(entry.createdAt)}`,
		target === null
			? `Người thực hiện: ${userMention(entry.actorId)}`
			: `Người thực hiện: ${userMention(entry.actorId)} · Đối tượng: ${target}`,
	];
	const details = formatAuditDetails(entry.details);
	if (details !== null) lines.push(`↳ ${details}`);
	return lines.join("\n");
}

export function buildAuditEmbed(entries: readonly AuditEntry[]): EmbedBuilder
{
	const description = entries.length > 0
		? fitLines(entries.map(formatAuditEntry), EMBED_DESCRIPTION_MAX, hidden => `… và ${hidden} mục khác (vượt giới hạn độ dài của Discord)`, { separator: "\n\n" })
		: "Chưa có thao tác quản trị nào được ghi lại.";

	return new EmbedBuilder()
		.setColor(COLORS.neutral)
		.setTitle("📜 Nhật ký quản trị")
		.setDescription(description)
		.setFooter({ text: `${entries.length} mục mới nhất` });
}
