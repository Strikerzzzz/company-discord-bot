// Hàm thuần dựng nội dung hiển thị cho lệnh quản trị (/admin, /config). Không truy cập service hay database.
import { EmbedBuilder, escapeMarkdown, InteractionReplyOptions, MessageFlags } from "discord.js";
import { ActivityProfile, XpEventSource, XpEventView } from "../../modules/activity/types";
import { AuditAction, AuditEntry } from "../../modules/audit/AuditService";
import { ChannelSettings, GuildSettings } from "../../modules/guild-config/types";
import { GuildStatistics } from "../../modules/statistics/types";
import { MAX_TEAMS } from "../../modules/team/TeamService";
import { channelMention, COLORS, dateTime, formatNumber, progressBar, relativeTime, roleMention, truncate, userMention } from "../format";

// Giới hạn của Discord cho embed.
const EMBED_DESCRIPTION_MAX = 4096;
const EMBED_FIELD_MAX = 1024;

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

/** Nối các dòng trong giới hạn độ dài; phần không vừa được thay bằng một dòng báo số dòng bị ẩn. */
export function fitLines(lines: readonly string[], max: number, overflow: (hidden: number) => string, separator = "\n"): string
{
	const full = lines.join(separator);
	if (full.length <= max) return full;
	for (let kept = lines.length - 1; kept > 0; kept--)
	{
		const text = [...lines.slice(0, kept), overflow(lines.length - kept)].join(separator);
		if (text.length <= max) return text;
	}
	return truncate(overflow(lines.length), max);
}

/** Văn bản do người dùng nhập, hiển thị trên một dòng: gộp khoảng trắng/xuống dòng, cắt ngắn, escape markdown. */
export function inlineText(text: string, max: number): string
{
	return escapeMarkdown(truncate(text.replace(/\s+/g, " ").trim(), max));
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

export function buildConfigEmbed(settings: GuildSettings, teams: readonly string[], channels: readonly ChannelSettings[]): EmbedBuilder
{
	const teamText = teams.length > 0
		? fitLines(teamLines(teams), EMBED_FIELD_MAX, hidden => `… và ${hidden} team khác`)
		: "Chưa có team nào. Dùng `/config team add` để thêm.";
	const channelText = channels.length > 0
		? fitLines(channelLines(channels), EMBED_FIELD_MAX, hidden => `… và ${hidden} channel khác (xem \`/config channel list\`)`)
		: "Không có. Mọi channel dùng cấu hình chung.";

	return new EmbedBuilder()
		.setColor(COLORS.primary)
		.setTitle("⚙️ Cấu hình bot")
		.addFields(
			{ name: "⭐ Activity XP", value: settingLines(settings, ["xpPerMessage", "xpCooldownSeconds", "minMessageLength", "duplicateWindowSeconds", "levelUpAnnouncements"]) },
			{ name: "🗳️ Vote", value: settingLines(settings, ["defaultPollXp", "pollCreatorRoleId"]) },
			{ name: "🤝 Contribution", value: settingLines(settings, ["contributionVotePoints"]) },
			{ name: "🔐 Quyền admin", value: `${settingLines(settings, ["adminRoleId"])}\nNgười có quyền Manage Server luôn là admin.` },
			{ name: `👥 Team (${teams.length}/${MAX_TEAMS})`, value: teamText },
			{ name: `📺 Channel có cấu hình riêng (${channels.length})`, value: channelText },
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

export function buildXpDetailEmbed(profile: ActivityProfile, events: readonly XpEventView[]): EmbedBuilder
{
	const { level } = profile;
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
			{ name: "Hạng", value: rankText(profile.rank, profile.totalRanked), inline: true },
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
	"backup.manual": "Sao lưu thủ công",
};

type AuditTargetKind = "user" | "role" | "channel" | "contribution" | "poll" | "none";

const AUDIT_TARGETS: Record<AuditAction, AuditTargetKind> = {
	"config.update": "none",
	"channel.set": "channel",
	"channel.reset": "channel",
	"team.add": "role",
	"team.remove": "role",
	"xp.adjust": "user",
	"xp.reset_user": "user",
	"xp.reset_all": "none",
	"contribution.remove": "contribution",
	"contribution.adjust": "user",
	"contribution.reset_user": "user",
	"contribution.reset_all": "none",
	"poll.create": "poll",
	"poll.close": "poll",
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
]);

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
	case "contribution": return `contribution #${inlineText(targetId, DETAIL_VALUE_MAX)}`;
	case "poll": return `vote #${inlineText(targetId, DETAIL_VALUE_MAX)}`;
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
		if (/^\d{17,20}$/.test(value))
		{
			if (key.endsWith("RoleId")) return roleMention(value);
			if (key.endsWith("ChannelId")) return channelMention(value);
			if (key.endsWith("Id")) return userMention(value);
		}
		return inlineText(value, DETAIL_VALUE_MAX);
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
		? fitLines(entries.map(formatAuditEntry), EMBED_DESCRIPTION_MAX, hidden => `… và ${hidden} mục khác (vượt giới hạn độ dài của Discord)`, "\n\n")
		: "Chưa có thao tác quản trị nào được ghi lại.";

	return new EmbedBuilder()
		.setColor(COLORS.neutral)
		.setTitle("📜 Nhật ký quản trị")
		.setDescription(description)
		.setFooter({ text: `${entries.length} mục mới nhất` });
}
