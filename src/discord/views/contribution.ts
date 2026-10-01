import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	EmbedBuilder,
	escapeMarkdown,
	LabelBuilder,
	messageLink,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";
import {
	Contribution,
	CONTRIBUTION_CATEGORIES,
	CONTRIBUTION_LIMITS,
	ContributionCategory,
	ContributionVoter,
	ContributionVoteResult,
} from "../../modules/contribution/types";
import { UserError } from "../../shared/errors";
import { channelMention, COLORS, disableMaskedLinks, DISCORD_LIMITS, fitLines, formatNumber, relativeTime, truncate, userMention } from "../format";
import { inlineText } from "./admin";

// Hàm thuần dựng giao diện Contribution (DEC-025, DEC-051) từ dữ liệu thuần; không gọi service, không gọi Discord.

export const CONTRIBUTION_BUTTON_NAMESPACE = "contrib";

/** Số contribution tối đa trong /contribution list. */
export const CONTRIBUTION_LIST_LIMIT = 10;

/**
 * Mô tả cố định của contribution ghi nhận từ tin nhắn. Không chép nội dung tin nhắn vào database
 * (CLAUDE.md: chưa có quyết định cho phép lưu nội dung tin nhắn); người xem mở link để đọc bản gốc.
 */
export const MESSAGE_CONTRIBUTION_DESCRIPTION = "Được ghi nhận từ một tin nhắn trên Discord. Mở link để xem nội dung gốc.";

export const INVALID_CONTRIBUTION_COMPONENT = "Nút không hợp lệ.";

/** customId của ô nhập lý do trong form từ chối và form 👎. */
export const CONTRIBUTION_REASON_INPUT = "ly-do";

const MESSAGE_TITLE_FALLBACK = "Đóng góp từ tin nhắn";
const LIST_TITLE_MAX = 80;
const NOTICE_TITLE_MAX = 100;
const VOTER_REASON_MAX = 200;
const MODAL_TITLE_MAX = 45;

/**
 * Thao tác mã hoá trong customId của thẻ contribution (namespace `contrib`, DEC-051):
 * - `up`: nút 👍 Ghi nhận, customId `contrib:<id>` (giữ dạng cũ để thẻ đã đăng trước DEC-051 vẫn bấm được); bấm lại để rút;
 * - `down`: nút 👎 Không ghi nhận, `contrib:down:<id>`: mở form lý do, hoặc rút nếu đang 👎;
 * - `approve` / `reject`: nút ✅ Duyệt / ❌ Từ chối của thẻ chờ duyệt, `contrib:approve:<id>` / `contrib:reject:<id>` (chỉ người duyệt;
 *   từ chối mở form lý do);
 * - `downform` / `rejectform`: form lý do 👎 / lý do từ chối, `contrib:downform:<id>` / `contrib:rejectform:<id>`.
 */
export type ContributionComponentAction = "up" | "down" | "approve" | "reject" | "downform" | "rejectform";

const PREFIXED_ACTIONS: readonly ContributionComponentAction[] = ["down", "approve", "reject", "downform", "rejectform"];
const COMPONENT_ID_PATTERN = /^contrib:(?:(down|approve|reject|downform|rejectform):)?([1-9]\d{0,15})$/;

export interface ContributionMessagePayload
{
	embeds: EmbedBuilder[];
	components: ActionRowBuilder<ButtonBuilder>[];
}

/** Tuỳ chọn của bản xem riêng `/contribution view` theo người xem (DEC-051). */
export interface ContributionDetailOptions
{
	/** Hiện lý do từ chối: chỉ cho tác giả, người gửi, người duyệt và admin. */
	showReviewReason?: boolean;
	/** Danh sách lượt 👍/👎 kèm người bấm và lý do, cùng người duyệt: chỉ cho người duyệt và admin. null/bỏ trống = không hiện. */
	voters?: readonly ContributionVoter[] | null;
}

export function contributionComponentId(action: ContributionComponentAction, contributionId: number): string
{
	return action === "up" ? `${CONTRIBUTION_BUTTON_NAMESPACE}:${contributionId}` : `${CONTRIBUTION_BUTTON_NAMESPACE}:${action}:${contributionId}`;
}

/** customId của nút 👍 Ghi nhận (`contrib:<id>`). */
export function contributionButtonId(contributionId: number): string
{
	return contributionComponentId("up", contributionId);
}

function prefixedAction(value: string): ContributionComponentAction | null
{
	return PREFIXED_ACTIONS.find(action => action === value) ?? null;
}

/** Thao tác và ID contribution trong customId (xem ContributionComponentAction); UserError nếu sai định dạng. */
export function parseContributionComponentId(customId: string): { action: ContributionComponentAction; contributionId: number }
{
	const match = COMPONENT_ID_PATTERN.exec(customId);
	const contributionId = match ? Number(match[2]) : NaN;
	const action = match?.[1] === undefined ? "up" : prefixedAction(match[1]);
	if (!match || action === null || !Number.isSafeInteger(contributionId)) throw new UserError(INVALID_CONTRIBUTION_COMPONENT);
	return { action, contributionId };
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

/** Trạng thái hiển thị trên thẻ; null với contribution đã duyệt còn hiệu lực (trạng thái bình thường). Không bao giờ chứa lý do từ chối. */
function statusText(contribution: Contribution): string | null
{
	if (contribution.status !== "active") return "⛔ Đã bị gỡ";
	if (contribution.reviewState === "pending") return "⏳ Chờ duyệt";
	if (contribution.reviewState === "rejected") return "❌ Không được duyệt";
	return null;
}

function embedColor(contribution: Contribution): number
{
	if (contribution.status !== "active" || contribution.reviewState === "rejected") return COLORS.neutral;
	return contribution.reviewState === "pending" ? COLORS.warning : COLORS.success;
}

/** Embed công khai của contribution. Không hiện lý do từ chối hay người bấm (DEC-051): chỉ số lượt (trên nút) và điểm. */
export function contributionEmbed(contribution: Contribution): EmbedBuilder
{
	const embed = new EmbedBuilder()
		.setColor(embedColor(contribution))
		.setTitle(truncate(contribution.title, DISCORD_LIMITS.embedTitle))
		.setDescription(truncate(disableMaskedLinks(contribution.description), DISCORD_LIMITS.embedDescription))
		.addFields({ name: "Tác giả", value: userMention(contribution.authorId), inline: true });

	if (contribution.submittedBy !== contribution.authorId)
	{
		embed.addFields({ name: "Người ghi nhận", value: userMention(contribution.submittedBy), inline: true });
	}
	embed.addFields({ name: "Loại", value: categoryLabel(contribution.category), inline: true });
	if (contribution.link) embed.addFields({ name: "Link", value: truncate(disableMaskedLinks(contribution.link), DISCORD_LIMITS.embedFieldValue) });
	const status = statusText(contribution);
	if (status !== null) embed.addFields({ name: "Trạng thái", value: status });
	else embed.addFields({ name: "Điểm", value: `**${formatNumber(contribution.score)}** điểm`, inline: true });

	return embed
		.setFooter({ text: `Contribution #${contribution.id}` })
		.setTimestamp(contribution.createdAt);
}

function cardButton(action: ContributionComponentAction, contributionId: number, label: string, style: ButtonStyle): ButtonBuilder
{
	return new ButtonBuilder().setCustomId(contributionComponentId(action, contributionId)).setLabel(label).setStyle(style);
}

/**
 * Nút của thẻ theo trạng thái (DEC-051): chờ duyệt → ✅ Duyệt và ❌ Từ chối; đã duyệt → 👍 Ghi nhận (n) và 👎 Không ghi nhận (n);
 * bị từ chối hoặc đã gỡ → không có nút.
 */
export function contributionComponents(contribution: Contribution): ActionRowBuilder<ButtonBuilder>[]
{
	if (contribution.status !== "active" || contribution.reviewState === "rejected") return [];
	const { id } = contribution;
	const buttons = contribution.reviewState === "pending"
		? [cardButton("approve", id, "✅ Duyệt", ButtonStyle.Success), cardButton("reject", id, "❌ Từ chối", ButtonStyle.Danger)]
		: [
			cardButton("up", id, `👍 Ghi nhận (${formatNumber(contribution.votes)})`, ButtonStyle.Success),
			cardButton("down", id, `👎 Không ghi nhận (${formatNumber(contribution.downvotes)})`, ButtonStyle.Secondary),
		];
	return [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)];
}

/** Thẻ công khai của contribution trong kênh contribution: embed + nút theo trạng thái. */
export function contributionMessage(contribution: Contribution): ContributionMessagePayload
{
	return { embeds: [contributionEmbed(contribution)], components: contributionComponents(contribution) };
}

function voterLine(voter: ContributionVoter): string
{
	const parts = [`${voter.kind === "up" ? "👍" : "👎"} ${userMention(voter.userId)}`, relativeTime(voter.createdAt)];
	if (voter.reason !== null) parts.push(`lý do: ${inlineText(voter.reason, VOTER_REASON_MAX)}`);
	if (!voter.active) parts.push("đã huỷ");
	else if (voter.locked) parts.push("🔒 đã khoá");
	return parts.join(" · ");
}

/** Danh sách lượt 👍/👎 kèm người bấm và lý do (cũ nhất trước), chỉ cho người duyệt và admin (DEC-051). */
export function contributionVotersEmbed(voters: readonly ContributionVoter[]): EmbedBuilder
{
	const ups = voters.filter(voter => voter.active && voter.kind === "up").length;
	const downs = voters.filter(voter => voter.active && voter.kind === "down").length;
	const body = voters.length === 0
		? "Chưa có ai bấm 👍 hay 👎."
		: fitLines(voters.map(voterLine), DISCORD_LIMITS.embedDescription, hidden => `… và ${formatNumber(hidden)} lượt khác`);
	return new EmbedBuilder()
		.setColor(COLORS.primary)
		.setTitle(`Lượt bấm: 👍 ${formatNumber(ups)} · 👎 ${formatNumber(downs)}`)
		.setDescription(body)
		.setFooter({ text: "Chỉ người duyệt và admin xem được danh sách người bấm và lý do." });
}

function detailLinkLabel(contribution: Contribution): string
{
	if (contribution.status !== "active" || contribution.reviewState === "rejected") return "Mở bài đăng gốc";
	return contribution.reviewState === "pending" ? "Mở bài đăng" : "Mở bài đăng để ghi nhận";
}

/**
 * Bản xem riêng (/contribution view): không có nút thao tác, để mọi lượt bấm và việc duyệt diễn ra trên thẻ công khai; thay vào đó là
 * nút link tới thẻ (nếu biết vị trí). Lý do từ chối và danh sách người bấm chỉ hiện theo `options` (người gọi quyết định theo người xem).
 */
export function contributionDetailMessage(contribution: Contribution, options: ContributionDetailOptions = {}): ContributionMessagePayload
{
	const embed = contributionEmbed(contribution);
	const voters = options.voters ?? null;
	if (voters !== null && contribution.reviewedBy !== null)
	{
		const when = contribution.reviewedAt === null ? "" : ` · ${relativeTime(contribution.reviewedAt)}`;
		const name = contribution.reviewState === "rejected" ? "Người từ chối" : "Người duyệt";
		embed.addFields({ name, value: `${userMention(contribution.reviewedBy)}${when}`, inline: true });
	}
	if (options.showReviewReason === true && contribution.reviewState === "rejected" && contribution.reviewReason !== null)
	{
		embed.addFields({
			name: "Lý do không duyệt (không hiện công khai)",
			value: truncate(disableMaskedLinks(contribution.reviewReason), DISCORD_LIMITS.embedFieldValue),
		});
	}

	const url = contributionMessageUrl(contribution);
	const components = url === null
		? []
		: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder()
			.setStyle(ButtonStyle.Link)
			.setURL(url)
			.setLabel(detailLinkLabel(contribution)))];
	return { embeds: voters === null ? [embed] : [embed, contributionVotersEmbed(voters)], components };
}

/** Ô nhập lý do bắt buộc của form (độ dài theo CONTRIBUTION_LIMITS, service kiểm tra lại theo code point). */
function reasonInput(label: string, description: string, min: number, max: number): LabelBuilder
{
	return new LabelBuilder()
		.setLabel(label)
		.setDescription(description)
		.setTextInputComponent(new TextInputBuilder()
			.setCustomId(CONTRIBUTION_REASON_INPUT)
			.setStyle(TextInputStyle.Paragraph)
			.setRequired(true)
			.setMinLength(min)
			.setMaxLength(max));
}

/** Form nhập lý do từ chối (DEC-051), customId `contrib:rejectform:<id>`. */
export function rejectReasonModal(contributionId: number): ModalBuilder
{
	return new ModalBuilder()
		.setCustomId(contributionComponentId("rejectform", contributionId))
		.setTitle(truncate(`Từ chối đóng góp #${contributionId}`, MODAL_TITLE_MAX))
		.addLabelComponents(reasonInput(
			"Lý do từ chối",
			"Chỉ gửi riêng cho tác giả và người gửi, admin xem được trên web; không hiện trên thẻ công khai.",
			CONTRIBUTION_LIMITS.rejectReasonMin,
			CONTRIBUTION_LIMITS.rejectReasonMax,
		));
}

/** Form nhập lý do 👎 Không ghi nhận (DEC-051), customId `contrib:downform:<id>`. */
export function downvoteReasonModal(contributionId: number): ModalBuilder
{
	return new ModalBuilder()
		.setCustomId(contributionComponentId("downform", contributionId))
		.setTitle(truncate(`Không ghi nhận đóng góp #${contributionId}`, MODAL_TITLE_MAX))
		.addLabelComponents(reasonInput(
			"Lý do không ghi nhận",
			"Chỉ người duyệt và admin xem được; thẻ công khai chỉ hiện số lượt.",
			CONTRIBUTION_LIMITS.downvoteReasonMin,
			CONTRIBUTION_LIMITS.downvoteReasonMax,
		));
}

const LOCKED_NOTE = "Vì tác giả đang bị admin trừ điểm, lượt của bạn bị khoá: bạn không đổi hay rút được nữa.";

function voteChangeText(result: Pick<ContributionVoteResult, "current" | "change" | "locked">): string
{
	if (result.change === "unchanged")
	{
		if (result.current === "up") return "Bạn đang 👍 ghi nhận đóng góp này rồi.";
		if (result.current === "down") return "Bạn đang 👎 không ghi nhận đóng góp này rồi.";
		return "Bạn chưa bấm 👍 hay 👎 cho đóng góp này.";
	}
	if (result.change === "withdrawn") return result.locked ? `↩️ Bạn đã rút lượt của mình. ${LOCKED_NOTE}` : "↩️ Bạn đã rút lượt của mình.";
	const switched = result.change === "switched";
	const head = result.current === "up"
		? (switched ? "✅ Bạn đã đổi sang ghi nhận đóng góp này." : "✅ Bạn đã ghi nhận đóng góp này.")
		: `👎 ${switched ? "Bạn đã đổi sang không ghi nhận" : "Bạn đã chọn không ghi nhận"} đóng góp này. Lý do chỉ người duyệt và admin xem được.`;
	return result.locked ? `${head} ${LOCKED_NOTE}` : head;
}

function interactionXpText(result: Pick<ContributionVoteResult, "xpAwarded" | "xpCapped" | "xpRevoked">, dailyCap: number): string | null
{
	if (result.xpRevoked > 0) return `Đã thu lại ${formatNumber(result.xpRevoked)} XP bạn nhận khi bấm cho đóng góp này.`;
	const cap = `${formatNumber(dailyCap)} XP`;
	if (result.xpAwarded > 0)
	{
		const xp = `+${formatNumber(result.xpAwarded)} XP`;
		return result.xpCapped ? `${xp} (đã chạm giới hạn ${cap} từ bấm ghi nhận hôm nay)` : xp;
	}
	return result.xpCapped ? `Bạn đã nhận đủ ${cap} từ bấm ghi nhận hôm nay nên lần này không được cộng XP.` : null;
}

/**
 * Phản hồi riêng cho người bấm 👍/👎 (DEC-051): kết quả (đã ghi nhận, không ghi nhận, đã rút, không đổi; lượt bị khoá theo PROP-031),
 * Activity XP vừa nhận (nói rõ khi hạn mức ngày `dailyCap` cắt bớt) hoặc vừa bị thu lại.
 */
export function voteFeedback(
	result: Pick<ContributionVoteResult, "current" | "change" | "locked" | "xpAwarded" | "xpCapped" | "xpRevoked">,
	dailyCap: number,
): string
{
	const xp = interactionXpText(result, dailyCap);
	return xp === null ? voteChangeText(result) : `${voteChangeText(result)}\n${xp}`;
}

/** Thẻ đã cũ khi bấm ✅/❌: contribution không còn chờ duyệt (đã được duyệt, bị từ chối hoặc bị gỡ ở nơi khác). */
export function reviewClosedText(contribution: Contribution): string
{
	const id = `#${contribution.id}`;
	if (contribution.status !== "active") return `Đóng góp ${id} đã bị gỡ nên không duyệt được nữa. Thẻ đã được cập nhật.`;
	if (contribution.reviewState === "approved") return `Đóng góp ${id} đã được duyệt rồi. Thẻ đã được cập nhật.`;
	return `Đóng góp ${id} đã bị từ chối rồi. Thẻ đã được cập nhật.`;
}

/**
 * Trả lời riêng cho người gửi (DEC-051). `posted` = bot đã đăng được thẻ vào kênh contribution `channelId`; không đăng được thì
 * bản ghi vẫn chờ duyệt (admin thấy trên web) và người gửi được nhắc báo admin.
 */
export function contributionSubmittedText(contribution: Contribution, channelId: string, posted: boolean): string
{
	const title = `#${contribution.id} "${inlineText(contribution.title, NOTICE_TITLE_MAX)}"`;
	if (!posted)
	{
		return `⚠️ Đã lưu đóng góp ${title} nhưng bot không đăng được thẻ vào ${channelMention(channelId)} (có thể bot vừa mất quyền ở kênh đó). `
			+ "Đóng góp vẫn đang chờ duyệt và admin xem được trên trang web quản trị; hãy báo admin kiểm tra quyền của bot ở kênh này.";
	}
	const whom = contribution.submittedBy === contribution.authorId
		? "Bot sẽ nhắn riêng cho bạn khi có kết quả duyệt."
		: `Bot sẽ nhắn riêng cho bạn và ${userMention(contribution.authorId)} khi có kết quả duyệt.`;
	const url = contributionMessageUrl(contribution);
	return [
		`📨 Đã gửi đóng góp ${title} vào ${channelMention(channelId)}.`,
		`Đóng góp đang **⏳ chờ duyệt**: khi được duyệt, mọi người mới 👍 ghi nhận hoặc 👎 không ghi nhận được. ${whom}`,
		...(url === null ? [] : [url]),
	].join("\n");
}

/** Trạng thái rút gọn trong một dòng danh sách. */
function listStatus(contribution: Contribution): string
{
	if (contribution.status !== "active") return "⛔ đã gỡ";
	if (contribution.reviewState === "pending") return "⏳ chờ duyệt";
	if (contribution.reviewState === "rejected") return "❌ không được duyệt";
	return `👍 ${formatNumber(contribution.votes)} · 👎 ${formatNumber(contribution.downvotes)}`;
}

/** Một dòng trong danh sách: `#id · **tiêu đề** · <trạng thái hoặc 👍 N · 👎 M> · <thời gian tương đối>`. */
export function contributionListLine(contribution: Contribution): string
{
	const url = contributionMessageUrl(contribution);
	const id = url === null ? `#${contribution.id}` : `[#${contribution.id}](${url})`;
	const title = escapeMarkdown(truncate(disableMaskedLinks(contribution.title), LIST_TITLE_MAX));
	return `${id} · **${title}** · ${listStatus(contribution)} · ${relativeTime(contribution.createdAt)}`;
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

/**
 * Tiêu đề khi ghi nhận từ tin nhắn: chỉ dùng tên kênh, không dùng nội dung tin nhắn. Người gọi truyền null khi tên kênh không được
 * lộ ra (kênh @everyone không xem được, vì thẻ nằm ở kênh contribution công khai, DEC-051) hoặc kênh không có trong cache.
 */
export function messageContributionTitle(channelName: string | null): string
{
	const name = channelName?.trim() ?? "";
	return name.length > 0 ? truncate(`${MESSAGE_TITLE_FALLBACK} trong #${name}`, CONTRIBUTION_LIMITS.titleMax) : MESSAGE_TITLE_FALLBACK;
}
