import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown, messageLink } from "discord.js";
import { Poll, POLL_LIMITS, PollVoteResult } from "../../modules/poll/types";
import { UserError } from "../../shared/errors";
import { COLORS, formatNumber, progressBar, relativeTime, truncate } from "../format";

// Hàm thuần dựng giao diện vote (DEC-026) từ dữ liệu thuần. Phiếu ẩn danh: chỉ hiển thị số lượng, không bao giờ hiển thị ai chọn gì.

export const POLL_BUTTON_NAMESPACE = "poll";

const BUTTONS_PER_ROW = 5;
const BUTTON_LABEL_MAX = 70;
/** Số vote tối đa hiển thị trong /poll list. */
const POLL_LIST_LIMIT = 15;
const BUTTON_ID_PATTERN = /^poll:([1-9]\d{0,15}):(\d{1,2})$/;

export interface PollMessagePayload
{
	embeds: EmbedBuilder[];
	components: ActionRowBuilder<ButtonBuilder>[];
}

export function pollButtonId(pollId: number, optionIndex: number): string
{
	return `${POLL_BUTTON_NAMESPACE}:${pollId}:${optionIndex}`;
}

/** Vote và lựa chọn trong customId `poll:<pollId>:<optionIndex>`; UserError nếu sai định dạng. */
export function parsePollButtonId(customId: string): { pollId: number; optionIndex: number }
{
	const match = BUTTON_ID_PATTERN.exec(customId);
	const pollId = match ? Number(match[1]) : NaN;
	const optionIndex = match ? Number(match[2]) : NaN;
	if (!Number.isSafeInteger(pollId) || !(optionIndex >= 0 && optionIndex < POLL_LIMITS.optionsMax))
	{
		throw new UserError("Nút không hợp lệ.");
	}
	return { pollId, optionIndex };
}

/** Tách option `lua-chon` theo dấu `|`, bỏ khoảng trắng và phần rỗng. Số lượng và độ dài do PollService validate. */
export function parsePollOptions(raw: string): string[]
{
	return raw.split("|").map(label => label.trim()).filter(label => label.length > 0);
}

function percent(votes: number, total: number): number
{
	return total > 0 ? Math.round((votes / total) * 100) : 0;
}

function durationText(poll: Poll): string
{
	if (!poll.open) return "Đã đóng";
	return poll.closesAt === null ? "Không giới hạn" : relativeTime(poll.closesAt);
}

/**
 * Embed kết quả vote. Tỉ lệ tính trên tổng số phiếu của mọi lựa chọn
 * (chọn một: bằng số người tham gia; chọn nhiều: một người có thể góp nhiều phiếu).
 */
export function pollEmbed(poll: Poll): EmbedBuilder
{
	const totalVotes = poll.options.reduce((sum, option) => sum + option.votes, 0);
	const lines = poll.options.map(option =>
	{
		const label = `**${option.index + 1}. ${escapeMarkdown(option.label)}**`;
		const stats = `${progressBar(option.votes, totalVotes)} ${formatNumber(option.votes)} phiếu (${percent(option.votes, totalVotes)}%)`;
		return `${label}\n${stats}`;
	});
	const title = `🗳️ ${poll.open ? "" : "[Đã đóng] "}${poll.question}`;

	return new EmbedBuilder()
		.setColor(poll.open ? COLORS.primary : COLORS.neutral)
		.setTitle(truncate(title, 256))
		.setDescription(truncate(lines.join("\n"), 4096))
		.addFields(
			{ name: "Hình thức", value: `${poll.multiSelect ? "Chọn nhiều" : "Chọn một"} · Phiếu ẩn danh`, inline: true },
			{ name: "XP khi tham gia", value: poll.xpReward > 0 ? `+${formatNumber(poll.xpReward)} XP` : "Không có", inline: true },
			{ name: "Thời hạn", value: durationText(poll), inline: true },
		)
		.setFooter({ text: `Vote #${poll.id} · ${formatNumber(poll.participants)} người tham gia` })
		.setTimestamp(poll.createdAt);
}

/** Mỗi lựa chọn một nút, tối đa 5 nút mỗi hàng; vote đã đóng thì mọi nút bị vô hiệu hoá. */
export function pollComponents(poll: Poll): ActionRowBuilder<ButtonBuilder>[]
{
	const buttons = poll.options.slice(0, POLL_LIMITS.optionsMax).map(option => new ButtonBuilder()
		.setCustomId(pollButtonId(poll.id, option.index))
		.setStyle(ButtonStyle.Primary)
		.setLabel(`${option.index + 1}. ${truncate(option.label, BUTTON_LABEL_MAX)}`)
		.setDisabled(!poll.open));

	const rows: ActionRowBuilder<ButtonBuilder>[] = [];
	for (let start = 0; start < buttons.length; start += BUTTONS_PER_ROW)
	{
		rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(start, start + BUTTONS_PER_ROW)));
	}
	return rows;
}

export function pollMessage(poll: Poll): PollMessagePayload
{
	return { embeds: [pollEmbed(poll)], components: pollComponents(poll) };
}

/** Phản hồi riêng cho người vừa bấm: các lựa chọn hiện tại và XP vừa nhận (nếu có). */
export function pollSelectionText(result: PollVoteResult): string
{
	const labels = result.selected
		.map(index => result.poll.options.find(option => option.index === index)?.label)
		.filter((label): label is string => label !== undefined)
		.map(label => escapeMarkdown(label));
	const text = labels.length > 0 ? `Bạn đang chọn: ${labels.join(", ")}` : "Bạn chưa chọn lựa chọn nào.";
	return result.xpAwarded > 0 ? `${text} · +${formatNumber(result.xpAwarded)} XP` : text;
}

function pollListLine(poll: Poll): string
{
	const id = poll.channelId && poll.messageId
		? `[#${poll.id}](${messageLink(poll.channelId, poll.messageId, poll.guildId)})`
		: `#${poll.id}`;
	const question = escapeMarkdown(truncate(poll.question, 80));
	const deadline = poll.closesAt === null ? "không giới hạn" : `đóng ${relativeTime(poll.closesAt)}`;
	return `${id} · **${question}** · ${formatNumber(poll.participants)} người tham gia · ${deadline}`;
}

export function pollListEmbed(polls: readonly Poll[]): EmbedBuilder
{
	const shown = polls.slice(0, POLL_LIST_LIMIT).map(pollListLine);
	if (polls.length > POLL_LIST_LIMIT) shown.push(`… và ${polls.length - POLL_LIST_LIMIT} vote khác`);

	return new EmbedBuilder()
		.setColor(COLORS.primary)
		.setTitle("🗳️ Vote đang mở")
		.setDescription(shown.length > 0 ? shown.join("\n") : "Không có vote nào đang mở.")
		.setFooter({ text: "Xem kết quả: /poll results id" });
}
