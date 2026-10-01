import { ContributionService } from "../src/modules/contribution/ContributionService";
import {
	Contribution,
	ContributionServiceApi,
	ContributionVoteAction,
	ContributionVoteResult,
	SubmitContributionInput,
} from "../src/modules/contribution/types";
import { GuildConfigService } from "../src/modules/guild-config/GuildConfigService";
import { ADMIN, createTestContext, GUILD, TestContext, USER_A } from "./helpers";

/** Kênh contribution mẫu (DEC-051): phải chọn trước khi gửi được contribution. */
export const CONTRIBUTION_CHANNEL = "400000000000000009";
/** Discord user ID của bot: actor của event XP người bấm. */
export const BOT_ID = "900000000000000001";
/** Lý do 👎 mặc định trong test (hợp lệ: 3–200 ký tự). */
export const DOWN_REASON = "Nội dung trùng với đóng góp trước";

/** Chọn kênh contribution cho guild bằng service thật (ghi một dòng audit `config.update`). */
export function enableContributions(guildConfig: GuildConfigService, guildId = GUILD, channelId = CONTRIBUTION_CHANNEL): void
{
	guildConfig.updateSettings(guildId, { contributionChannelId: channelId }, ADMIN);
}

export interface ContributionTestContext extends TestContext
{
	service: ContributionService;
}

/** Database :memory: với migration thật, ContributionService thật, và kênh contribution đã chọn cho các guild cho trước. */
export function setupContributions(guildIds: readonly string[] = [GUILD]): ContributionTestContext
{
	const context = createTestContext();
	for (const guildId of guildIds) enableContributions(context.deps.guildConfig, guildId);
	return { ...context, service: new ContributionService(context.db, context.deps) };
}

/** Dữ liệu gửi hợp lệ của USER_A trong GUILD; `overrides` ghi đè từng trường. */
export function contributionInput(overrides: Partial<SubmitContributionInput> = {}): SubmitContributionInput
{
	return {
		guildId: GUILD,
		authorId: USER_A,
		submittedBy: USER_A,
		title: "Tối ưu build",
		description: "Giảm thời gian build CI từ 10 phút xuống 4 phút.",
		category: "cai-tien",
		link: null,
		authorRoleIds: [],
		...overrides,
	};
}

/** Gửi rồi duyệt ngay (người duyệt mặc định ADMIN): contribution mở cho bấm 👍/👎 như trước DEC-051. */
export function submitApproved(service: ContributionServiceApi, input: SubmitContributionInput, reviewerId = ADMIN): Contribution
{
	const created = service.submit(input);
	return service.approve(input.guildId, created.id, reviewerId);
}

export interface VoteOptions
{
	guildId?: string;
	/** Role của người bấm (snapshot team cho XP người bấm); mặc định không có role. */
	voterRoleIds?: readonly string[];
	/** Lý do 👎 (bỏ qua với 👍 và rút). */
	reason?: string | null;
}

/** Gọi vote() với các trường mặc định của test (guild GUILD, actor XP là BOT_ID). */
export function castVote(service: ContributionServiceApi, contributionId: number, voterId: string, action: ContributionVoteAction, options: VoteOptions = {}): ContributionVoteResult
{
	return service.vote({
		guildId: options.guildId ?? GUILD,
		contributionId,
		voterId,
		action,
		reason: options.reason ?? null,
		voterRoleIds: options.voterRoleIds ?? [],
		systemActorId: BOT_ID,
	});
}

/** 👍 Ghi nhận. */
export function voteUp(service: ContributionServiceApi, contributionId: number, voterId: string, options: VoteOptions = {}): ContributionVoteResult
{
	return castVote(service, contributionId, voterId, "up", options);
}

/** 👎 Không ghi nhận, lý do mặc định DOWN_REASON. */
export function voteDown(service: ContributionServiceApi, contributionId: number, voterId: string, options: VoteOptions = {}): ContributionVoteResult
{
	return castVote(service, contributionId, voterId, "down", { ...options, reason: options.reason === undefined ? DOWN_REASON : options.reason });
}

/** Rút lượt đang có. */
export function withdrawVote(service: ContributionServiceApi, contributionId: number, voterId: string, options: VoteOptions = {}): ContributionVoteResult
{
	return castVote(service, contributionId, voterId, "withdraw", options);
}
