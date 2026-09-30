import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	InteractionEditReplyOptions,
	InteractionReplyOptions,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	MessageFlags,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
} from "discord.js";
import { LEVEL_FORMULA_TEXT, totalXpForLevel } from "../../modules/activity/levels";
import { Tier, TIER_SET_KEYS, TIER_SETS } from "../../modules/activity/tiers";
import { ACHIEVEMENTS } from "../../modules/gamification/achievements";
import { MemberTierDisplay, PERSONAL_TIER_DISABLED } from "../../modules/gamification/TierSetService";
import { AchievementDefinition, AchievementStat } from "../../modules/gamification/types";
import { ChannelSettings, GuildSettings } from "../../modules/guild-config/types";
import { UserError } from "../../shared/errors";
import { channelMention, COLORS, disableMaskedLinks, fitLines, formatNumber, truncate } from "../format";

/*
 * Phần hiển thị của /rank (DEC-047): khung Components V2 có nút "❓" ở góc trên bên phải, lời giải thích chỉ người bấm thấy
 * (dựng từ cấu hình thật của server) và câu trả lời của /rank-style. Hàm thuần, test được không cần Discord client.
 */

/** Namespace customId của nút "❓" trên thẻ /rank (khai báo trong `buttonIds` của /rank). */
export const RANK_HELP_NAMESPACE = "rankhelp";
/** customId duy nhất của nút "❓": không mang dữ liệu người dùng, ai bấm cũng nhận lời giải thích cho chính mình. */
export const RANK_HELP_ID = `${RANK_HELP_NAMESPACE}:show`;
export const INVALID_RANK_HELP_BUTTON = "Nút này không hợp lệ.";
/** Discord giới hạn tổng số ký tự của mọi TextDisplay trong một message Components V2. */
export const COMPONENTS_V2_TEXT_MAX = 4000;
/** Giá trị của lựa chọn "Theo server" trong option `bo` của /rank-style. */
export const RANK_STYLE_SERVER_CHOICE = "theo-server";

/** Discord giới hạn tên một lựa chọn (choice) của option là 100 ký tự. */
const CHOICE_NAME_MAX = 100;
const TITLE_NAME_MAX = 64;
const IMAGE_DESCRIPTION_MAX = 1024;
/** Số kênh tối đa liệt kê ở chế độ "chỉ kênh được bật", và số ký tự tối đa của danh sách đó. */
const LISTED_CHANNELS_MAX = 8;
const CHANNEL_LIST_BUDGET = 200;
/** Level lấy làm ví dụ tổng XP cần. */
const LEVEL_EXAMPLES = [1, 2, 5] as const;
const HEX_COLOR = /^#[0-9a-f]{6}$/iu;

/** Đơn vị của chỉ số huy hiệu, để ghép câu "100 / 1.000 tin được XP". */
const STAT_UNITS: Readonly<Record<AchievementStat, string>> = {
	messages: "tin được XP",
	bestStreak: "ngày liên tiếp",
	recognitionsReceived: "lượt được ghi nhận",
	recognitionsGiven: "lượt ghi nhận người khác",
	pollsJoined: "cuộc vote",
	contributions: "contribution",
};

function separator(): SeparatorBuilder
{
	return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function colorOf(hex: string): number
{
	return HEX_COLOR.test(hex) ? Number.parseInt(hex.slice(1), 16) : COLORS.primary;
}

/**
 * Tên do người dùng đặt, đưa vào chữ của tin nhắn: một dòng, vô hiệu hoá masked link, cắt cho vừa, rồi thêm `\` trước mọi ký tự
 * markdown và ký tự mở mention (`<`, `>`, `@`), để nickname như `<@&id>` hay `****` không thành mention hay phá định dạng
 * (escapeMarkdown của discord.js bỏ sót các trường hợp này, review Phase 18).
 */
function plainName(name: string): string
{
	return truncate(disableMaskedLinks(name.replace(/\s+/gu, " ").trim()), TITLE_NAME_MAX).replace(/[\\*_~`|<>@]/gu, "\\$&");
}

// ---------- Thẻ /rank ----------

/** Nút "❓" (Secondary) mở lời giải thích; nằm ở góc trên bên phải thẻ (accessory của Section đầu tiên). */
export function rankHelpButton(): ButtonBuilder
{
	return new ButtonBuilder().setCustomId(RANK_HELP_ID).setStyle(ButtonStyle.Secondary).setEmoji("❓");
}

/** Kiểm tra customId của nút "❓"; UserError nếu không phải đúng customId đã phát (cũ hoặc bị sửa). */
export function parseRankHelpId(customId: string): void
{
	if (customId !== RANK_HELP_ID) throw new UserError(INVALID_RANK_HELP_BUTTON);
}

/** Tiêu đề thẻ: "🏅 Thẻ rank của **tên**" (tên đã escape markdown). */
export function rankCardTitle(displayName: string): string
{
	return `🏅 Thẻ rank của **${plainName(displayName)}**`;
}

export interface RankCardView
{
	/** Tên hiển thị trong server của người được xem. */
	displayName: string;
	/** Phần chữ tóm tắt dưới ảnh (rankSummaryText). */
	summary: string;
	/** Tên file ảnh đính kèm (RenderedCard.fileName), ảnh được tham chiếu bằng `attachment://<tên file>`. */
	fileName: string;
	/** Màu "#rrggbb" của viền khung (màu bậc hiện tại theo bộ hiển thị). */
	accentColor: string;
}

/**
 * Khung thẻ /rank (Components V2): Section gồm tiêu đề và nút "❓" (accessory, nên nút nằm góc trên bên phải), ảnh thẻ trong
 * MediaGallery, rồi phần chữ tóm tắt. 6 component, tổng chữ vài trăm ký tự.
 */
export function buildRankCardContainer(view: RankCardView): ContainerBuilder
{
	const image = new MediaGalleryItemBuilder()
		.setURL(`attachment://${view.fileName}`)
		.setDescription(truncate(`Thẻ rank của ${view.displayName}`, IMAGE_DESCRIPTION_MAX));
	return new ContainerBuilder()
		.setAccentColor(colorOf(view.accentColor))
		.addSectionComponents(new SectionBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(rankCardTitle(view.displayName)))
			.setButtonAccessory(rankHelpButton()))
		.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(image))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(view.summary));
}

/**
 * Nội dung sửa phản hồi đã defer của /rank thành thẻ Components V2 (người gọi thêm `files` chứa ảnh). Không có `content` hay
 * `embeds`: Discord từ chối chúng khi bật IsComponentsV2. Trả lời riêng hay công khai do lần defer quyết định.
 */
export function rankCardReply(view: RankCardView): InteractionEditReplyOptions
{
	return { components: [buildRankCardContainer(view)], flags: MessageFlags.IsComponentsV2 };
}

/** Hàng nút đi kèm embed dự phòng khi vẽ ảnh lỗi (tin nhắn thường, không phải Components V2). */
export function rankFallbackComponents(): ActionRowBuilder<ButtonBuilder>[]
{
	return [new ActionRowBuilder<ButtonBuilder>().addComponents(rankHelpButton())];
}

// ---------- Lời giải thích (nút "❓") ----------

export interface RankHelpData
{
	/** Cấu hình hiện tại của server. */
	settings: GuildSettings;
	/** Cấu hình riêng của các kênh còn trong server (GuildConfigService.listChannels, đã bỏ kênh không còn). */
	channels: readonly ChannelSettings[];
	/** Bộ danh hiệu hiển thị của người bấm nút (TierSetService.displayFor). */
	display: MemberTierDisplay;
}

/** "45 giây", "5 phút", "2 giờ". */
export function durationText(seconds: number): string
{
	if (seconds > 0 && seconds % 3600 === 0) return `${formatNumber(seconds / 3600)} giờ`;
	if (seconds >= 60 && seconds % 60 === 0) return `${formatNumber(seconds / 60)} phút`;
	return `${formatNumber(seconds)} giây`;
}

function channelModeLine(settings: GuildSettings, channels: readonly ChannelSettings[]): string
{
	if (settings.xpChannelMode === "all")
	{
		const disabled = channels.filter(channel => !channel.xpEnabled).length;
		const except = disabled > 0 ? `, trừ ${formatNumber(disabled)} kênh admin đã tắt` : "";
		return `• Kênh tính XP: **tất cả kênh** bot xem được${except}.`;
	}
	const enabled = channels.filter(channel => channel.xpEnabled).map(channel => channel.channelId);
	const head = "• Kênh tính XP: **chỉ các kênh admin bật riêng**; kênh khác, kể cả kênh mới tạo, không tính.";
	if (enabled.length === 0) return `${head} Hiện chưa bật kênh nào, nên tin nhắn chưa được XP.`;
	const shown = enabled.slice(0, LISTED_CHANNELS_MAX).map(channelMention);
	const list = fitLines(shown, CHANNEL_LIST_BUDGET, hidden => `và ${formatNumber(hidden)} kênh khác`, { separator: ", ", total: enabled.length });
	return `${head} Đang bật: ${list}.`;
}

function skippedLine(settings: GuildSettings): string
{
	const skipped = ["tin của bot"];
	if (settings.minMessageLength > 0)
	{
		skipped.push(`tin ngắn hơn **${formatNumber(settings.minMessageLength)} ký tự** (không đếm mention, emoji riêng của server; ảnh kèm chữ ngắn cũng vậy)`);
	}
	if (settings.duplicateWindowSeconds > 0) skipped.push(`tin trùng một tin bạn đã gửi trong **${durationText(settings.duplicateWindowSeconds)}** gần đây`);
	if (settings.xpCooldownSeconds > 0) skipped.push("tin gửi khi còn cooldown");
	return `• Không được tính: ${skipped.join("; ")}. Tin chỉ có ảnh hoặc file vẫn được tính.`;
}

function xpSection({ settings, channels }: RankHelpData): string
{
	const lines = ["### ⚡ Activity XP: nhắn tin để lên level"];
	const ownXp = channels.some(channel => channel.xpEnabled && channel.xpPerMessage !== null && channel.xpPerMessage > 0);
	const ownCooldown = channels.some(channel => channel.xpEnabled && channel.xpCooldownSeconds !== null && channel.xpCooldownSeconds > 0);
	if (settings.xpPerMessage > 0) lines.push(`• Mỗi tin nhắn hợp lệ được **${formatNumber(settings.xpPerMessage)} XP**.`);
	else if (ownXp) lines.push("• XP chung của server là 0: chỉ tin ở kênh admin đặt XP riêng mới được XP.");
	else lines.push("• Tin nhắn hiện **không được XP** (admin đặt 0 XP mỗi tin); XP vẫn đến từ vote.");
	if (settings.xpCooldownSeconds > 0)
	{
		lines.push(`• Cooldown **${durationText(settings.xpCooldownSeconds)}**: được XP xong phải chờ hết khoảng này tin sau mới được tính (theo từng người, chung mọi kênh).`);
	}
	else
	{
		lines.push(ownCooldown ? "• Không có cooldown chung; một số kênh có cooldown riêng." : "• Không có cooldown: tin hợp lệ nào cũng được tính.");
	}
	lines.push(channelModeLine(settings, channels));
	if (channels.some(channel => channel.xpEnabled && (channel.xpPerMessage !== null || channel.xpCooldownSeconds !== null)))
	{
		lines.push("• Một số kênh có XP hoặc cooldown riêng do admin đặt.");
	}
	lines.push("• Tin trong thread và bài trong forum tính theo kênh cha.");
	lines.push(skippedLine(settings));
	return lines.join("\n");
}

function levelSection(): string
{
	const examples = LEVEL_EXAMPLES.map(level => `Lv ${level}: ${formatNumber(totalXpForLevel(level))}`).join(" · ");
	return [
		"### 📈 Level",
		`• Level bắt đầu từ 0. Từ level **n** lên **n + 1** cần **${LEVEL_FORMULA_TEXT} XP**, nên càng lên cao càng cần nhiều XP.`,
		`• Tổng XP cần: ${examples} (mốc của từng bậc ở dưới). XP từ vote và XP admin cộng/trừ cũng tính.`,
	].join("\n");
}

function tierLine(tier: Tier): string
{
	const xp = tier.minLevel > 0 ? ` (${formatNumber(totalXpForLevel(tier.minLevel))} XP)` : "";
	return `${tier.emoji} **${tier.name}** · Level ${formatNumber(tier.minLevel)}${xp}`;
}

function tierSection({ display }: RankHelpData): string
{
	const { set, serverSet } = display;
	const origin = display.source === "personal" ? "bộ bạn tự chọn" : "bộ của server";
	return [
		`### 🏅 ${set.texts.tierLabel}: bộ ${set.name} (${origin})`,
		...set.tiers.map(tierLine),
		`Chỉ để hiển thị, lên theo level. Role Discord, bảng xếp hạng và Bảng vàng dùng bộ của server (**${serverSet.name}**).`,
	].join("\n");
}

/** Huy hiệu gộp theo chỉ số, theo thứ tự ACHIEVEMENTS: "💬 Khai Khẩu · 🗣️ Hoạt Ngôn: 100 / 1.000 tin được XP". */
export function achievementLines(): string[]
{
	const groups = new Map<AchievementStat, AchievementDefinition[]>();
	for (const achievement of ACHIEVEMENTS)
	{
		const group = groups.get(achievement.stat) ?? [];
		group.push(achievement);
		groups.set(achievement.stat, group);
	}
	return [...groups].map(([stat, group]) =>
	{
		const names = group.map(achievement => `${achievement.emoji} ${achievement.name}`).join(" · ");
		const thresholds = group.map(achievement => formatNumber(achievement.threshold)).join(" / ");
		return `${names}: ${thresholds} ${STAT_UNITS[stat]}`;
	});
}

function progressSection(): string
{
	return [
		"### 🔥 Chuỗi ngày, huy hiệu, bảng tuần/tháng",
		"• Chuỗi ngày: số ngày liên tiếp (giờ Việt Nam) có ít nhất một tin được XP. Hôm nay chưa nhắn thì chuỗi vẫn giữ; bỏ trọn một ngày thì về 0.",
		`• ${formatNumber(ACHIEVEMENTS.length)} huy hiệu, chỉ để khoe (không cộng điểm):`,
		...achievementLines().map(line => `  ${line}`),
		"• `/leaderboard` có bảng tuần (từ 00:00 thứ Hai) và tháng: xếp theo điểm kiếm được trong kỳ; điểm tổng không mất khi sang kỳ mới.",
	].join("\n");
}

function contributionSection({ settings }: RankHelpData): string
{
	const points = settings.contributionVotePoints > 0
		? `• Mỗi lượt người khác bấm 👍 ghi nhận, tác giả được **${formatNumber(settings.contributionVotePoints)} điểm**. Không tự ghi nhận cho mình; bấm lại để rút.`
		: "• Lượt ghi nhận hiện không cộng điểm (admin đặt 0 điểm mỗi lượt). Không tự ghi nhận cho mình.";
	return [
		"### 🌟 Contribution (điểm riêng, không cộng vào XP)",
		"• Gửi đóng góp bằng `/contribution submit`, hoặc chuột phải vào một tin nhắn → **Ứng dụng** → **Ghi nhận đóng góp** (điểm thuộc về tác giả tin nhắn).",
		points,
	].join("\n");
}

function pollSection({ settings }: RankHelpData): string
{
	const reward = settings.defaultPollXp > 0
		? `• Tham gia một cuộc vote lần đầu được **${formatNumber(settings.defaultPollXp)} XP** (vote do admin tạo có thể đặt mức khác); đổi phiếu không được thêm.`
		: "• Tham gia vote mặc định không được XP (vote do admin tạo có thể đặt XP riêng); mỗi cuộc vote chỉ tính một lần.";
	const cap = settings.pollXpDailyCap > 0
		? `• Tối đa **${formatNumber(settings.pollXpDailyCap)} XP** từ vote mỗi ngày (giờ Việt Nam); quá mức vẫn vote được nhưng không thêm XP.`
		: "• Không giới hạn XP từ vote mỗi ngày.";
	return ["### 🗳️ Vote", reward, cap].join("\n");
}

function tipsSection(): string
{
	return [
		"### 💡 Mẹo cày hợp lệ",
		"• Nhắn tin có nội dung ở kênh tính XP, rải đều trong ngày, ghé mỗi ngày để giữ chuỗi; tham gia vote, gửi và ghi nhận đóng góp thật.",
		"• ⚠️ Spam, gửi lại tin cũ hay tin quá ngắn không được tính; admin có thể điều chỉnh điểm gian lận.",
	].join("\n");
}

function styleSection({ display }: RankHelpData): string | null
{
	if (!display.allowPersonal) return null;
	return [
		"### 🎨 Đổi kiểu hiển thị",
		"• Dùng `/rank-style` để chọn bộ danh hiệu cho thẻ /rank và lời chúc lên level của riêng bạn (ví dụ Rank game, Cây xanh).",
		`• Bạn đang dùng: ${tierDisplayLabel(display)}.`,
	].join("\n");
}

/**
 * Các phần của lời giải thích, mỗi phần một TextDisplay: tiêu đề; Activity XP (theo cấu hình thật: XP mỗi tin, cooldown, độ dài
 * tối thiểu, chống trùng, chế độ kênh); level; các bậc của bộ hiển thị của người bấm; chuỗi ngày, huy hiệu, bảng tuần/tháng;
 * contribution; vote; mẹo cày; cách đổi kiểu hiển thị (chỉ khi server cho tự chọn). Tổng không quá COMPONENTS_V2_TEXT_MAX.
 */
export function rankHelpSections(data: RankHelpData): string[]
{
	const sections = [
		"## ❓ Thẻ rank: các chỉ số và cách cày\nMọi con số dưới đây là cấu hình hiện tại của server.",
		xpSection(data),
		levelSection(),
		tierSection(data),
		progressSection(),
		contributionSection(data),
		pollSection(data),
		tipsSection(),
		styleSection(data),
	].filter((section): section is string => section !== null);
	return fitTextSections(sections, COMPONENTS_V2_TEXT_MAX);
}

/**
 * Chốt chặn cuối cho giới hạn tổng ký tự: phần làm tổng vượt `max` bị cắt (kèm "…") và các phần sau bị bỏ. Với cấu hình hợp lệ
 * lời giải thích luôn vừa (có test cho trường hợp dài nhất), nên bình thường không cắt gì.
 */
export function fitTextSections(sections: readonly string[], max: number): string[]
{
	const kept: string[] = [];
	let used = 0;
	for (const section of sections)
	{
		if (used + section.length <= max)
		{
			kept.push(section);
			used += section.length;
			continue;
		}
		const rest = truncate(section, max - used);
		if (rest.length > 0) kept.push(rest);
		break;
	}
	return kept;
}

/** Khung lời giải thích (Components V2): mỗi phần một TextDisplay, ngăn bằng đường kẻ; tối đa 18 component (1 Container, 9 TextDisplay, 8 Separator). */
export function buildRankHelp(data: RankHelpData): ContainerBuilder
{
	const container = new ContainerBuilder().setAccentColor(colorOf(data.display.set.tiers[data.display.set.tiers.length - 1].color));
	rankHelpSections(data).forEach((section, index) =>
	{
		if (index > 0) container.addSeparatorComponents(separator());
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(section));
	});
	return container;
}

/** Trả lời nút "❓": chỉ người bấm thấy, Components V2, không ping ai (kênh chỉ hiện dạng #tên, không thông báo). */
export function rankHelpReply(data: RankHelpData): InteractionReplyOptions
{
	return {
		components: [buildRankHelp(data)],
		flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
		allowedMentions: { parse: [] },
	};
}

// ---------- /rank-style ----------

/** Lựa chọn của option `bo`: "Theo server (mặc định)" rồi các bộ theo thứ tự TIER_SET_KEYS, tên kèm mô tả của bộ. */
export function rankStyleChoices(): { name: string; value: string }[]
{
	return [
		{ name: "Theo server (mặc định)", value: RANK_STYLE_SERVER_CHOICE },
		...TIER_SET_KEYS.map(key => ({ name: truncate(`${TIER_SETS[key].name}: ${TIER_SETS[key].description}`, CHOICE_NAME_MAX), value: key })),
	];
}

/** "**Cây xanh** (tự chọn)", "**Tu tiên** (theo server)"; lựa chọn đã lưu mà admin đang tắt tự chọn thì ghi rõ. */
export function tierDisplayLabel(display: MemberTierDisplay): string
{
	if (display.source === "personal") return `**${display.set.name}** (tự chọn)`;
	if (display.choiceKey !== null)
	{
		return `**${display.set.name}** (theo server; đã chọn ${TIER_SETS[display.choiceKey].name} nhưng admin đang tắt tự chọn)`;
	}
	return `**${display.set.name}** (theo server)`;
}

/** Câu xác nhận sau khi thành viên chọn bộ bằng /rank-style (trả lời riêng). */
export function rankStyleResultText(display: MemberTierDisplay): string
{
	const { set, serverSet } = display;
	if (display.source === "personal")
	{
		const first = set.tiers[0];
		const last = set.tiers[set.tiers.length - 1];
		return [
			`✅ Đã chọn bộ **${set.name}** cho thẻ /rank và lời chúc lên level của bạn: ${first.emoji} ${first.name} → ${last.emoji} ${last.name}.`,
			`Role Discord, bảng xếp hạng và Bảng vàng vẫn theo bộ của server (**${serverSet.name}**).`,
		].join("\n");
	}
	const lines = [`✅ Đã chuyển về bộ danh hiệu của server (**${serverSet.name}**).`];
	if (!display.allowPersonal) lines.push(PERSONAL_TIER_DISABLED);
	return lines.join("\n");
}
