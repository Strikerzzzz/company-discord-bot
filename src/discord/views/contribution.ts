import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown, messageLink } from "discord.js";
import { Contribution, CONTRIBUTION_CATEGORIES, CONTRIBUTION_LIMITS, ContributionCategory, ContributionVoteResult } from "../../modules/contribution/types";
import { UserError } from "../../shared/errors";
import { COLORS, disableMaskedLinks, DISCORD_LIMITS, fitLines, relativeTime, truncate, userMention } from "../format";

// Hàm thuần dựng giao diện Contribution (DEC-025) từ dữ liệu thuần; không gọi service, không gọi Discord.

export const CONTRIBUTION_BUTTON_NAMESPACE = "contrib";

/** Số contribution tối đa trong /contribution list. */
export const CONTRIBUTION_LIST_LIMIT = 10;

/**
 * Mô tả cố định của contribution ghi nhận từ tin nhắn. Không chép nội dung tin nhắn vào database
 * (CLAUDE.md: chưa có quyết định cho phép lưu nội dung tin nhắn); người xem mở link để đọc bản gốc.
 */
export const MESSAGE_CONTRIBUTION_DESCRIPTION = "Được ghi nhận từ một tin nhắn trên Discord. Mở link để xem nội dung gốc.";

const MESSAGE_TITLE_FALLBACK = "Đóng góp từ tin nhắn";
const LIST_TITLE_MAX = 80;
const BUTTON_ID_PATTERN = /^contrib:([1-9]\d{0,15})$/;

export interface ContributionMessagePayload
{
	embeds: EmbedBuilder[];
	components: ActionRowBuilder<ButtonBuilder>[];
}

export function contributionButtonId(contributionId: number): string
{
	return `${CONTRIBUTION_BUTTON_NAMESPACE}:${contributionId}`;
}

/** ID contribution trong customId `contrib:<id>`; UserError nếu sai định dạng. */
export function parseContributionButtonId(customId: string): number
{
	const match = BUTTON_ID_PATTERN.exec(customId);
	const id = match ? Number(match[1]) : NaN;
	if (!Number.isSafeInteger(id)) throw new UserError("Nút không hợp lệ.");
	return id;
}

/** Giá trị loại từ option `loai`; UserError nếu không thuộc danh sách. */
export function parseCategory(value: string): ContributionCategory
{
	const category = CONTRIBUTION_CATEGORIES.find(item => item.value === value);
	if (!category) throw new UserError("Loại đóng góp không hợp lệ.");
	return category.value;
}

export function categoryLabel(category: ContributionCategory): string
{
	return CONTRIBUTION_CATEGORIES.find(item => item.value === category)?.label ?? category;
}

/** Link tới message công khai của contribution; null nếu chưa biết vị trí. */
export function contributionMessageUrl(contribution: Contribution): string | null
{
	return contribution.channelId && contribution.messageId
		? messageLink(contribution.channelId, contribution.messageId, contribution.guildId)
		: null;
}

export function contributionEmbed(contribution: Contribution): EmbedBuilder
{
	const active = contribution.status === "active";
	const embed = new EmbedBuilder()
		.setColor(active ? COLORS.success : COLORS.neutral)
		.setTitle(truncate(contribution.title, DISCORD_LIMITS.embedTitle))
		.setDescription(truncate(disableMaskedLinks(contribution.description), DISCORD_LIMITS.embedDescription))
		.addFields({ name: "Tác giả", value: userMention(contribution.authorId), inline: true });

	if (contribution.submittedBy !== contribution.authorId)
	{
		embed.addFields({ name: "Người ghi nhận", value: userMention(contribution.submittedBy), inline: true });
	}
	embed.addFields({ name: "Loại", value: categoryLabel(contribution.category), inline: true });
	if (contribution.link) embed.addFields({ name: "Link", value: truncate(disableMaskedLinks(contribution.link), DISCORD_LIMITS.embedFieldValue) });
	if (!active) embed.addFields({ name: "Trạng thái", value: "⛔ Đã bị gỡ" });

	return embed
		.setFooter({ text: `Contribution #${contribution.id}` })
		.setTimestamp(contribution.createdAt);
}

/** Hàng nút ghi nhận; contribution đã gỡ thì không có nút. */
export function contributionComponents(contribution: Contribution): ActionRowBuilder<ButtonBuilder>[]
{
	if (contribution.status !== "active") return [];

	const button = new ButtonBuilder()
		.setCustomId(contributionButtonId(contribution.id))
		.setStyle(ButtonStyle.Success)
		.setLabel(`👍 Ghi nhận (${contribution.votes})`);
	return [new ActionRowBuilder<ButtonBuilder>().addComponents(button)];
}

/** Message công khai của contribution: embed + nút ghi nhận. */
export function contributionMessage(contribution: Contribution): ContributionMessagePayload
{
	return { embeds: [contributionEmbed(contribution)], components: contributionComponents(contribution) };
}

/**
 * Bản xem riêng (/contribution view): không có nút ghi nhận, để mọi lượt ghi nhận diễn ra trên message công khai;
 * thay vào đó là nút link tới message công khai (nếu biết vị trí).
 */
export function contributionDetailMessage(contribution: Contribution): ContributionMessagePayload
{
	const url = contributionMessageUrl(contribution);
	const components = url === null
		? []
		: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder()
			.setStyle(ButtonStyle.Link)
			.setURL(url)
			.setLabel(contribution.status === "active" ? "Mở bài đăng để ghi nhận" : "Mở bài đăng gốc"))];
	return { embeds: [contributionEmbed(contribution)], components };
}

export function voteFeedback(result: Pick<ContributionVoteResult, "current" | "change" | "locked">): string
{
	if (result.current === "up") return "✅ Bạn đã ghi nhận đóng góp này.";
	if (result.current === "down") return "👎 Bạn đã chọn không ghi nhận đóng góp này.";
	if (result.locked) return "↩️ Bạn đã rút ghi nhận. Vì tác giả đang bị admin trừ điểm, bạn sẽ không ghi nhận lại được đóng góp này.";
	return "↩️ Bạn đã rút ghi nhận.";
}

/** Một dòng trong danh sách: `#id · **tiêu đề** · 👍 N · <thời gian tương đối>`. */
export function contributionListLine(contribution: Contribution): string
{
	const url = contributionMessageUrl(contribution);
	const id = url === null ? `#${contribution.id}` : `[#${contribution.id}](${url})`;
	const title = escapeMarkdown(truncate(disableMaskedLinks(contribution.title), LIST_TITLE_MAX));
	return `${id} · **${title}** · 👍 ${contribution.votes} · ${relativeTime(contribution.createdAt)}`;
}

export function contributionListEmbed(contributions: readonly Contribution[], authorId: string | null): EmbedBuilder
{
	const header = authorId ? `Của ${userMention(authorId)}\n\n` : "";
	const shown = contributions.slice(0, CONTRIBUTION_LIST_LIMIT).map(contributionListLine);
	const body = shown.length > 0
		? fitLines(shown, DISCORD_LIMITS.embedDescription - header.length, hidden => `… và ${hidden} đóng góp khác`)
		: "Chưa có đóng góp nào.";

	return new EmbedBuilder()
		.setColor(COLORS.primary)
		.setTitle("📋 Đóng góp gần đây")
		.setDescription(header + body)
		.setFooter({ text: "Xem chi tiết: /contribution view id" });
}

/** Tiêu đề khi ghi nhận từ tin nhắn: chỉ dùng tên kênh, không dùng nội dung tin nhắn. */
export function messageContributionTitle(channelName: string | null): string
{
	const name = channelName?.trim() ?? "";
	return name.length > 0 ? truncate(`${MESSAGE_TITLE_FALLBACK} trong #${name}`, CONTRIBUTION_LIMITS.titleMax) : MESSAGE_TITLE_FALLBACK;
}
