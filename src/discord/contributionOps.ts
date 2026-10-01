// Duyệt và từ chối contribution (DEC-051) dùng chung cho nút trên thẻ contribution (tầng Discord) và trang web quản trị
// (DEC-041), để hai nơi luôn cùng quy tắc: service ghi trạng thái và audit, rồi sửa thẻ trong kênh và nhắn riêng báo kết quả.
// Người gọi tự kiểm tra quyền duyệt (canReviewContributions) trước khi gọi. Thông báo trả về dùng markdown/mention của Discord.
import type DiscordClient from "../classes/DiscordClient";
import { Contribution } from "../modules/contribution/types";
import { AppServices } from "../services";
import { UserError } from "../shared/errors";
import type { AdminActions } from "./adminOps";
import { channelMention, userMention } from "./format";
import { inlineText } from "./views/admin";
import { contributionMessageUrl } from "./views/contribution";

/** Tác dụng phụ lên Discord của việc duyệt (lấy từ AdminActions; web truyền `deps.adminActions`, test thay bằng hàm giả). */
export type ContributionReviewActions = Pick<AdminActions, "refreshContribution" | "sendDirectMessage">;

const TITLE_MAX = 100;
export const CARD_EDIT_FAILED = "Không sửa được thẻ contribution trong Discord (có thể message đã bị xoá hoặc bot mất quyền).";
export const NOTICE_FAILED = "Không nhắn riêng được cho tác giả (có thể họ tắt tin nhắn riêng từ thành viên server); họ vẫn thấy trạng thái trên thẻ.";

export interface ReviewOutcome
{
	/** Phản hồi cho người duyệt (reply ephemeral trên Discord, flash trên web). */
	text: string;
	contribution: Contribution;
	/** Đã sửa được thẻ trong kênh. */
	refreshed: boolean;
	/** Có ít nhất một người nhận (tác giả, người gửi) không nhắn riêng được. */
	noticeFailed: boolean;
}

/**
 * Tin nhắn riêng báo kết quả duyệt cho tác giả và người gửi (DEC-051: chỉ khi duyệt và khi từ chối, không nhắn theo lượt 👍/👎).
 * Lý do từ chối chỉ nằm trong tin này, không hiện công khai trên thẻ.
 */
export function reviewNoticeText(contribution: Contribution, guildName: string | null): string
{
	const title = `#${contribution.id} "${inlineText(contribution.title, TITLE_MAX)}"`;
	const where = guildName === null ? "" : ` trên server **${inlineText(guildName, TITLE_MAX)}**`;
	const url = contributionMessageUrl(contribution);
	if (contribution.reviewState === "approved")
	{
		return [
			`✅ Đóng góp ${title}${where} đã được duyệt. Mọi người đã có thể 👍 ghi nhận hoặc 👎 không ghi nhận.`,
			...(url === null ? [] : [url]),
		].join("\n");
	}
	return [
		`❌ Đóng góp ${title}${where} không được duyệt.`,
		`Lý do: ${inlineText(contribution.reviewReason ?? "", 300)}`,
		"Bạn có thể sửa lại và gửi một đóng góp mới.",
	].join("\n");
}

/** Nhắn riêng kết quả duyệt cho tác giả và người gửi (nếu khác tác giả); true nếu có người không nhắn được. */
async function notifyReviewResult(client: DiscordClient, actions: ContributionReviewActions, contribution: Contribution): Promise<boolean>
{
	const guildName = client.guilds.cache.get(contribution.guildId)?.name ?? null;
	const text = reviewNoticeText(contribution, guildName);
	const recipients = [...new Set([contribution.authorId, contribution.submittedBy])];
	const results = await Promise.all(recipients.map(userId => actions.sendDirectMessage(client, userId, text)));
	return results.some(sent => !sent);
}

async function finishReview(client: DiscordClient, actions: ContributionReviewActions, contribution: Contribution, head: string): Promise<ReviewOutcome>
{
	const refreshed = await actions.refreshContribution(client, contribution);
	const noticeFailed = await notifyReviewResult(client, actions, contribution);
	const lines = [head];
	if (!refreshed && contribution.messageId !== null) lines.push(CARD_EDIT_FAILED);
	if (noticeFailed) lines.push(NOTICE_FAILED);
	return { text: lines.join("\n"), contribution, refreshed, noticeFailed };
}

/** Duyệt contribution đang chờ: service ghi và audit, sửa thẻ (mở nút 👍/👎), nhắn riêng cho tác giả. */
export async function approveContribution(
	client: DiscordClient,
	services: AppServices,
	actions: ContributionReviewActions,
	guildId: string,
	contributionId: number,
	actorId: string,
): Promise<ReviewOutcome>
{
	const contribution = services.contributions.approve(guildId, contributionId, actorId);
	const head = `✅ Đã duyệt đóng góp #${contribution.id} "${inlineText(contribution.title, TITLE_MAX)}" của ${userMention(contribution.authorId)}.`
		+ " Mọi người đã có thể 👍 ghi nhận hoặc 👎 không ghi nhận.";
	return finishReview(client, actions, contribution, head);
}

/** Từ chối contribution đang chờ với lý do bắt buộc: service ghi và audit, sửa thẻ ("Không được duyệt"), nhắn riêng kèm lý do. */
export async function rejectContribution(
	client: DiscordClient,
	services: AppServices,
	actions: ContributionReviewActions,
	guildId: string,
	contributionId: number,
	actorId: string,
	reason: string,
): Promise<ReviewOutcome>
{
	const contribution = services.contributions.reject(guildId, contributionId, actorId, reason);
	const head = `❌ Đã từ chối đóng góp #${contribution.id} "${inlineText(contribution.title, TITLE_MAX)}" của ${userMention(contribution.authorId)}.`
		+ " Lý do chỉ gửi riêng cho tác giả, không hiện trên thẻ.";
	return finishReview(client, actions, contribution, head);
}

/**
 * Đăng lại thẻ của contribution vào kênh contribution đang chọn (web; DEC-051): dùng khi thẻ đăng lỗi lúc gửi hoặc bị xoá tay, để
 * người duyệt và mọi người còn nút bấm. Chỉ cho contribution còn hiệu lực, chờ duyệt hoặc đã duyệt; thẻ cũ (nếu còn) bị xoá.
 */
export async function repostContribution(
	client: DiscordClient,
	services: AppServices,
	actions: Pick<AdminActions, "repostContribution">,
	guildId: string,
	contributionId: number,
): Promise<string>
{
	const contribution = services.contributions.get(guildId, contributionId);
	if (!contribution) throw new UserError(`Không tìm thấy contribution #${contributionId}.`);
	if (contribution.status === "removed") throw new UserError(`Contribution #${contributionId} đã bị gỡ nên không đăng lại thẻ.`);
	if (contribution.reviewState === "rejected") throw new UserError(`Contribution #${contributionId} đã bị từ chối nên không cần đăng lại thẻ.`);
	const posted = await actions.repostContribution(client, contribution);
	const where = posted.channelId === null ? "kênh contribution" : channelMention(posted.channelId);
	return `📮 Đã đăng lại thẻ contribution #${contribution.id} ở ${where}. Thẻ cũ (nếu còn) đã được xoá.`;
}
