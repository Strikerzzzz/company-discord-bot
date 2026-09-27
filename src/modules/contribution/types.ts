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
} as const;

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
	/** Số lượt ghi nhận còn hiệu lực (không tính lượt có điểm đã bị huỷ do reset hoặc gỡ). */
	votes: number;
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
	 * còn hiệu lực trong guild (chống nhân điểm); trùng thì UserError. Bỏ trống với /contribution submit.
	 */
	sourceMessageId?: string | null;
}

export interface ContributionVoteResult
{
	/** true = vừa ghi nhận, false = vừa rút ghi nhận. */
	voted: boolean;
	/**
	 * true nếu vừa rút ghi nhận và lần rút đó làm phát sinh điểm bù (tác giả đang bị admin trừ điểm, PROP-031):
	 * người này sẽ không ghi nhận lại được contribution đó. Luôn false khi voted = true.
	 */
	locked: boolean;
	contribution: Contribution;
}

export interface ContributionProfile
{
	userId: string;
	score: number;
	/** null nếu chưa có điểm. */
	rank: number | null;
	totalRanked: number;
	/** Số contribution còn hiệu lực của người đó. */
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

export interface ContributionServiceApi
{
	/** Tạo contribution sau khi validate (tiêu đề, mô tả, loại, link http/https). UserError nếu không hợp lệ. */
	submit(input: SubmitContributionInput): Contribution;
	/** Lưu vị trí message của bot hiển thị contribution (để cập nhật nút sau này). */
	attachMessage(guildId: string, contributionId: number, channelId: string, messageId: string): void;
	get(guildId: string, contributionId: number): Contribution | null;
	/** Contribution còn hiệu lực, mới nhất trước. */
	list(guildId: string, options: { authorId?: string; limit: number }): Contribution[];
	/** Bấm ghi nhận: chưa ghi nhận thì ghi nhận, đã ghi nhận thì rút. UserError nếu tự ghi nhận, contribution không tồn tại hoặc đã bị gỡ. */
	toggleVote(input: { guildId: string; contributionId: number; voterId: string }): ContributionVoteResult;
	/** Admin gỡ contribution: huỷ mọi điểm của nó. Ghi audit. */
	remove(guildId: string, contributionId: number, actorId: string): Contribution;
	/** Admin cộng/trừ điểm contribution. UserError nếu delta = 0 hoặc kết quả âm. Ghi audit. */
	adjust(input: ContributionAdjustInput): { score: number };
	resetUser(guildId: string, userId: string, actorId: string): { voidedEvents: number };
	resetAll(guildId: string, actorId: string): { voidedEvents: number; members: number };
	getProfile(guildId: string, userId: string): ContributionProfile;
}
