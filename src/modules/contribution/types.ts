import { ListPage } from "../../shared/paging";

export const CONTRIBUTION_CATEGORIES = [
	{ value: "y-tuong", label: "Ý tưởng" },
	{ value: "giai-phap", label: "Giải pháp" },
	{ value: "cai-tien", label: "Cải tiến quy trình" },
	{ value: "tai-lieu", label: "Tài liệu" },
	{ value: "chia-se", label: "Chia sẻ kiến thức" },
	{ value: "khac", label: "Khác" },
] as const;

export type ContributionCategory = (typeof CONTRIBUTION_CATEGORIES)[number]["value"];

export const CONTRIBUTION_LIMITS = {
	titleMin: 3,
	titleMax: 100,
	descriptionMax: 1500,
	linkMax: 500,
	/** Lý do từ chối (DEC-051), tính theo code point sau khi bỏ khoảng trắng hai đầu. */
	rejectReasonMin: 3,
	rejectReasonMax: 300,
	/** Lý do của lượt 👎 Không ghi nhận (DEC-051). */
	downvoteReasonMin: 3,
	downvoteReasonMax: 200,
} as const;

/**
 * Trạng thái duyệt (DEC-051): "pending" = chờ duyệt (chưa bấm 👍/👎 được); "approved" = đã duyệt (contribution có từ trước
 * migration 10 cũng là "approved"); "rejected" = bị từ chối, không tính điểm, gửi lại được dưới dạng contribution mới.
 */
export type ContributionReviewState = "pending" | "approved" | "rejected";

export const CONTRIBUTION_REVIEW_STATES: readonly ContributionReviewState[] = ["pending", "approved", "rejected"];

/** Lượt của một người trên một contribution: 👍 Ghi nhận hoặc 👎 Không ghi nhận (DEC-051). */
export type ContributionVoteKind = "up" | "down";

/** Thao tác của người bấm: chọn 👍, chọn 👎, hoặc rút lượt đang có. */
export type ContributionVoteAction = ContributionVoteKind | "withdraw";

export interface Contribution
{
	id: number;
	guildId: string;
	/** Người nhận điểm. */
	authorId: string;
	/** Người tạo contribution (khác authorId khi ghi nhận tin nhắn của người khác). */
	submittedBy: string;
	title: string;
	description: string;
	category: ContributionCategory;
	link: string | null;
	channelId: string | null;
	messageId: string | null;
	status: "active" | "removed";
	createdAt: number;
	/** Số lượt 👍 còn hiệu lực (không tính lượt có điểm đã bị huỷ do reset hoặc gỡ). */
	votes: number;
	/** Số lượt 👎 còn hiệu lực (DEC-051), cùng quy tắc với `votes`. */
	downvotes: number;
	/**
	 * Điểm contribution tác giả đang có từ contribution này: tổng các event chưa huỷ có reference là contribution (👍, 👎 và
	 * event sàn), tức max(0, tổng 👍 − tổng 👎) nếu không có reset (DEC-051). Không gồm điểm admin cộng/trừ tay.
	 */
	score: number;
	reviewState: ContributionReviewState;
	/** Người duyệt hoặc từ chối; null khi đang chờ duyệt và với contribution cũ (trước migration 10). */
	reviewedBy: string | null;
	reviewedAt: number | null;
	/** Lý do từ chối (chỉ khi "rejected"). Không hiện công khai: chỉ tác giả, người gửi, admin và người duyệt. */
	reviewReason: string | null;
}

export interface SubmitContributionInput
{
	guildId: string;
	authorId: string;
	submittedBy: string;
	title: string;
	description: string;
	category: ContributionCategory;
	link: string | null;
	/** Role hiện có của tác giả (snapshot team). */
	authorRoleIds: readonly string[];
	/**
	 * ID tin nhắn nguồn khi ghi nhận qua context menu. Mỗi tin nhắn chỉ được là nguồn của MỘT contribution
	 * còn hiệu lực và chưa bị từ chối trong guild (chống nhân điểm); trùng thì UserError. Bỏ trống với /contribution submit.
	 */
	sourceMessageId?: string | null;
}

/** Lượt hiện tại của một người trên một contribution (voterState). */
export interface ContributionVoterState
{
	/** Lượt đang có hiệu lực: "up", "down", hoặc null nếu chưa bấm (hoặc lượt đã bị huỷ). */
	current: ContributionVoteKind | null;
	/**
	 * true nếu người này không đổi hay rút được nữa (vote() sẽ ném UserError): lượt có event đã bị admin reset hoặc gỡ, hoặc lượt
	 * bị khoá vì lần thao tác làm giảm điểm đã phải bù cho tác giả đang bị trừ điểm (PROP-031, DEC-051).
	 */
	locked: boolean;
}

export interface ContributionVoteInput
{
	guildId: string;
	contributionId: number;
	voterId: string;
	action: ContributionVoteAction;
	/** Lý do khi chọn 👎 (bắt buộc nếu thao tác thêm hoặc đổi sang 👎); bỏ qua với "up" và "withdraw". */
	reason?: string | null;
	/** Role hiện có của người bấm: snapshot team cho event XP người bấm (DEC-024). */
	voterRoleIds: readonly string[];
	/** Discord user ID của bot: actor của event XP người bấm (nguồn 'admin', như XP retro). */
	systemActorId: string;
}

export interface ContributionVoteResult
{
	/** Lượt của người bấm sau thao tác. */
	current: ContributionVoteKind | null;
	/**
	 * "added" = chưa có lượt → có; "switched" = đổi 👍↔👎; "withdrawn" = rút; "unchanged" = không đổi gì (chọn đúng lượt đang có,
	 * hoặc rút khi chưa có lượt). Với "unchanged" không có event nào được ghi.
	 */
	change: "added" | "switched" | "withdrawn" | "unchanged";
	/**
	 * true nếu lần thao tác này làm giảm điểm (rút 👍, thêm hoặc đổi sang 👎) và phải bù vì tác giả đang bị admin trừ điểm
	 * (PROP-024): lượt của người này bị khoá, không đổi hay rút được nữa (PROP-031).
	 */
	locked: boolean;
	/**
	 * Activity XP vừa cộng cho người bấm. Chỉ khi từ chỗ chưa có lượt mà bấm 👍/👎: lần đầu trên contribution được
	 * min(`contributionInteractionXp`, hạn mức ngày còn lại); bấm lại sau khi rút được lại min(số XP đã bị thu, hạn mức ngày còn
	 * lại). 0 khi đổi 👍↔👎, khi đang giữ XP, khi event XP đã bị admin reset, hoặc khi lần trước được 0 hay bị hạn mức cắt (không
	 * bao giờ cộng bù).
	 */
	xpAwarded: number;
	/** true nếu hạn mức XP ngày cắt bớt (một phần hoặc toàn bộ) XP lẽ ra được cộng ở lần này; phần bị cắt không được cộng bù sau. */
	xpCapped: boolean;
	/**
	 * Activity XP vừa thu lại khi rút hẳn (bấm lại thì được trả lại, trong hạn mức ngày). 0 nếu không có event XP còn hiệu lực: lần
	 * đó được 0 XP, hoặc event đã bị admin reset.
	 */
	xpRevoked: number;
	contribution: Contribution;
}

/** Một lượt 👍/👎 kèm người bấm, cho admin (web) và người duyệt (`/contribution view`) (DEC-051). */
export interface ContributionVoter
{
	userId: string;
	kind: ContributionVoteKind;
	/** Lý do (chỉ lượt 👎). */
	reason: string | null;
	/** false nếu event của lượt đã bị huỷ (admin reset, gỡ contribution, hoặc rút 👍 bị khoá). */
	active: boolean;
	/** Như ContributionVoterState.locked. */
	locked: boolean;
	createdAt: number;
}

export interface ContributionProfile
{
	userId: string;
	score: number;
	/** null nếu chưa có điểm. */
	rank: number | null;
	totalRanked: number;
	/** Số contribution còn hiệu lực và đã được duyệt của người đó (DEC-051). */
	contributions: number;
}

export interface ContributionAdjustInput
{
	guildId: string;
	userId: string;
	delta: number;
	actorId: string;
	reason: string | null;
	roleIds: readonly string[];
}

export interface ContributionListQuery
{
	/** Chỉ contribution của tác giả này (người nhận điểm); bỏ trống = mọi tác giả. */
	authorId?: string;
	/** "active" = còn hiệu lực, "removed" = đã bị admin gỡ. */
	status: "active" | "removed" | "all";
	/** Lọc theo trạng thái duyệt (DEC-051); bỏ trống hoặc "all" = mọi trạng thái. */
	review?: ContributionReviewState | "all";
	/** Bắt đầu từ 1; ngoài khoảng thì kẹp về trang hợp lệ gần nhất. */
	page: number;
	/** 1 đến MAX_PAGE_SIZE (src/shared/paging.ts); ngoài khoảng thì kẹp. */
	pageSize: number;
}

export interface ContributionServiceApi
{
	/**
	 * Tạo contribution ở trạng thái chờ duyệt (DEC-051) sau khi validate (tiêu đề, mô tả, loại, link http/https). UserError nếu
	 * không hợp lệ, hoặc nếu guild chưa chọn kênh contribution (`contributionChannelId`). Tầng Discord đăng thẻ vào kênh đó rồi
	 * gọi attachMessage.
	 */
	submit(input: SubmitContributionInput): Contribution;
	/** Lưu vị trí message của bot hiển thị contribution (để cập nhật nút sau này). */
	attachMessage(guildId: string, contributionId: number, channelId: string, messageId: string): void;
	get(guildId: string, contributionId: number): Contribution | null;
	/** Contribution còn hiệu lực và chưa bị từ chối (gồm cả chờ duyệt), mới nhất trước. */
	list(guildId: string, options: { authorId?: string; limit: number }): Contribution[];
	/** Một trang contribution (kể cả đã gỡ, cho web quản trị, DEC-041), mới nhất trước. Không kiểm tra quyền xem kênh. */
	listPage(guildId: string, query: ContributionListQuery): ListPage<Contribution>;
	/**
	 * Duyệt contribution đang chờ (DEC-051): từ đây mới bấm 👍/👎 được. Người gọi tự kiểm tra quyền duyệt
	 * (canReviewContributions); người duyệt được duyệt cả contribution của chính mình. UserError nếu không tồn tại, đã bị gỡ hoặc
	 * không còn chờ duyệt. Ghi audit `contribution.approve` (target = tác giả, details { contributionId, title }).
	 */
	approve(guildId: string, contributionId: number, actorId: string): Contribution;
	/**
	 * Từ chối contribution đang chờ với lý do bắt buộc (CONTRIBUTION_LIMITS.rejectReasonMin–Max). Cùng điều kiện như approve.
	 * Ghi audit `contribution.reject` (target = tác giả, details { contributionId, title }; lý do không ghi vào audit vì nhật ký không
	 * giấu theo quyền xem kênh, PROP-038 — lý do lưu ở contribution và hiện trên trang chi tiết).
	 */
	reject(guildId: string, contributionId: number, actorId: string, reason: string): Contribution;
	/** Lượt hiện tại của `voterId` trên contribution (để tầng Discord quyết định bấm lại là rút hay đổi). */
	voterState(guildId: string, contributionId: number, voterId: string): ContributionVoterState;
	/**
	 * 👍 / 👎 / rút (DEC-051), trong một transaction: điểm contribution = max(0, tổng 👍 − tổng 👎), event sàn ghi theo chênh lệch
	 * nên bảng tuần/tháng nhận đúng phần điểm thay đổi lúc thao tác. XP người bấm một lần mỗi contribution, có hạn mức ngày: giữ khi
	 * đổi, thu lại khi rút, trả lại khi bấm lại (không lời không lỗ); phần bị hạn mức cắt hay bị admin reset không được cộng bù.
	 * UserError nếu contribution không tồn tại, đã bị gỡ, chưa được duyệt hoặc bị từ chối; nếu người bấm là tác giả; nếu lượt bị
	 * khoá; nếu chọn 👎 mà lý do không hợp lệ.
	 */
	vote(input: ContributionVoteInput): ContributionVoteResult;
	/** Mọi lượt 👍/👎 của contribution kèm người bấm và lý do, cũ nhất trước (chỉ cho admin và người duyệt xem). */
	listVoters(guildId: string, contributionId: number): ContributionVoter[];
	/**
	 * Admin gỡ contribution: huỷ mọi điểm của nó (lượt 👍/👎 và event sàn; tác giả đang bị trừ điểm thì bù về 0, PROP-024). XP người
	 * bấm đã nhận được giữ nguyên (người bấm đã tương tác thật). Ghi audit.
	 */
	remove(guildId: string, contributionId: number, actorId: string): Contribution;
	/** Admin cộng/trừ điểm contribution. UserError nếu delta = 0 hoặc kết quả âm. Ghi audit. */
	adjust(input: ContributionAdjustInput): { score: number };
	resetUser(guildId: string, userId: string, actorId: string): { voidedEvents: number };
	resetAll(guildId: string, actorId: string): { voidedEvents: number; members: number };
	getProfile(guildId: string, userId: string): ContributionProfile;
}
