import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown, messageLink } from "discord.js";
import { Contribution, CONTRIBUTION_CATEGORIES, ContributionCategory } from "../../modules/contribution/types";
import { UserError } from "../../shared/errors";
import { COLORS, relativeTime, truncate, userMention } from "../format";

// Hàm thuần dựng giao diện Contribution (DEC-025) từ dữ liệu thuần; không gọi service, không gọi Discord.

export const CONTRIBUTION_BUTTON_NAMESPACE = "contrib";

/** Số contribution tối đa trong /contribution list. */
export const CONTRIBUTION_LIST_LIMIT = 10;

const MESSAGE_TITLE_FALLBACK = "Đóng góp từ tin nhắn";
const MESSAGE_EMPTY_DESCRIPTION = "(Tin nhắn không có nội dung văn bản)";
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

export function contributionEmbed(contribution: Contribution): EmbedBuilder
{
	const active = contribution.status === "active";
	const embed = new EmbedBuilder()
		.setColor(active ? COLORS.success : COLORS.neutral)
		.setTitle(truncate(contribution.title, 256))
		.setDescription(truncate(contribution.description, 4096))
		.addFields({ name: "Tác giả", value: userMention(contribution.authorId), inline: true });

	if (contribution.submittedBy !== contribution.authorId)
	{
		embed.addFields({ name: "Người ghi nhận", value: userMention(contribution.submittedBy), inline: true });
	}
	embed.addFields({ name: "Loại", value: categoryLabel(contribution.category), inline: true });
	if (contribution.link) embed.addFields({ name: "Link", value: truncate(contribution.link, 1024) });
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

export function contributionMessage(contribution: Contribution): ContributionMessagePayload
{
	return { embeds: [contributionEmbed(contribution)], components: contributionComponents(contribution) };
}

export function voteFeedback(voted: boolean): string
{
	return voted ? "✅ Bạn đã ghi nhận đóng góp này." : "↩️ Bạn đã rút ghi nhận.";
}

/** Một dòng trong danh sách: `#id · **tiêu đề** · 👍 N · <thời gian tương đối>`. */
export function contributionListLine(contribution: Contribution): string
{
	const id = contribution.channelId && contribution.messageId
		? `[#${contribution.id}](${messageLink(contribution.channelId, contribution.messageId, contribution.guildId)})`
		: `#${contribution.id}`;
	const title = escapeMarkdown(truncate(contribution.title, 80));
	return `${id} · **${title}** · 👍 ${contribution.votes} · ${relativeTime(contribution.createdAt)}`;
}

export function contributionListEmbed(contributions: readonly Contribution[], authorId: string | null): EmbedBuilder
{
	const header = authorId ? `Của ${userMention(authorId)}\n\n` : "";
	const body = contributions.length > 0
		? contributions.slice(0, CONTRIBUTION_LIST_LIMIT).map(contributionListLine).join("\n")
		: "Chưa có đóng góp nào.";

	return new EmbedBuilder()
		.setColor(COLORS.primary)
		.setTitle("📋 Đóng góp gần đây")
		.setDescription(truncate(header + body, 4096))
		.setFooter({ text: "Xem chi tiết: /contribution view id" });
}

/** Tiêu đề khi ghi nhận từ tin nhắn: dòng đầu tiên, tối đa 100 ký tự; quá ngắn thì dùng tiêu đề mặc định. */
export function titleFromMessage(content: string): string
{
	const firstLine = content.trim().split("\n", 1)[0].trim();
	if (Array.from(firstLine).length < 3) return MESSAGE_TITLE_FALLBACK;
	return truncate(firstLine, 100);
}

export function descriptionFromMessage(content: string): string
{
	const text = content.trim();
	return text.length > 0 ? truncate(text, 1500) : MESSAGE_EMPTY_DESCRIPTION;
}
