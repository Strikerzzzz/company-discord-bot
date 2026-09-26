import { Db } from "../../db/connection";
import { UserError } from "../../shared/errors";
import { ServiceDeps } from "../deps";
import { ContributionRepository, ContributionRow } from "./ContributionRepository";
import {
	Contribution,
	CONTRIBUTION_CATEGORIES,
	CONTRIBUTION_LIMITS,
	ContributionAdjustInput,
	ContributionCategory,
	ContributionProfile,
	ContributionServiceApi,
	ContributionVoteResult,
	SubmitContributionInput,
} from "./types";

const MAX_ADJUST_DELTA = 1_000_000;
const MAX_LIST_LIMIT = 50;

const NOT_FOUND = "Không tìm thấy contribution này.";
const ALREADY_REMOVED = "Contribution này đã bị gỡ.";
const VOTE_RESET = "Lượt ghi nhận của bạn cho đóng góp này đã bị admin reset nên không thể ghi nhận lại.";

function isContributionCategory(value: string): value is ContributionCategory
{
	return CONTRIBUTION_CATEGORIES.some(category => category.value === value);
}

/** Độ dài theo code point, để emoji hay ký tự ngoài BMP chỉ tính là một ký tự. */
function codePointLength(value: string): number
{
	return Array.from(value).length;
}

/** Link rỗng hoặc chỉ có khoảng trắng coi như không có link. */
function normalizeLink(link: string | null): string | null
{
	const trimmed = link?.trim() ?? "";
	if (trimmed === "") return null;
	if (codePointLength(trimmed) > CONTRIBUTION_LIMITS.linkMax)
	{
		throw new UserError(`Link tối đa ${CONTRIBUTION_LIMITS.linkMax} ký tự.`);
	}

	let protocol: string;
	try
	{
		protocol = new URL(trimmed).protocol;
	}
	catch
	{
		protocol = "";
	}
	if (protocol !== "http:" && protocol !== "https:")
	{
		throw new UserError("Link phải bắt đầu bằng http:// hoặc https://.");
	}
	return trimmed;
}

interface ValidatedSubmission
{
	title: string;
	description: string;
	category: ContributionCategory;
	link: string | null;
}

function validateSubmission(input: SubmitContributionInput): ValidatedSubmission
{
	const title = input.title.trim();
	const titleLength = codePointLength(title);
	if (titleLength < CONTRIBUTION_LIMITS.titleMin || titleLength > CONTRIBUTION_LIMITS.titleMax)
	{
		throw new UserError(`Tiêu đề phải từ ${CONTRIBUTION_LIMITS.titleMin} đến ${CONTRIBUTION_LIMITS.titleMax} ký tự.`);
	}

	const description = input.description.trim();
	if (description === "") throw new UserError("Mô tả không được để trống.");
	if (codePointLength(description) > CONTRIBUTION_LIMITS.descriptionMax)
	{
		throw new UserError(`Mô tả tối đa ${CONTRIBUTION_LIMITS.descriptionMax} ký tự.`);
	}

	// Kiểu TypeScript không bảo vệ được dữ liệu đến từ Discord lúc chạy, nên kiểm tra lại.
	if (!isContributionCategory(input.category)) throw new UserError("Loại đóng góp không hợp lệ.");

	return { title, description, category: input.category, link: normalizeLink(input.link) };
}

function toContribution(row: ContributionRow): Contribution
{
	return {
		id: row.id,
		guildId: row.guild_id,
		authorId: row.author_id,
		submittedBy: row.submitted_by,
		title: row.title,
		description: row.description,
		// Category luôn được validate khi ghi; giá trị lạ (sửa tay DB) hiển thị là "Khác" thay vì làm hỏng cả danh sách.
		category: isContributionCategory(row.category) ? row.category : "khac",
		link: row.link,
		channelId: row.channel_id,
		messageId: row.message_id,
		status: row.status,
		createdAt: row.created_at,
		votes: row.votes,
	};
}

/**
 * Contribution Score (DEC-025): ai cũng gửi được, người khác ghi nhận để cộng điểm cho tác giả.
 * Chỉ dùng contributionLedger, không bao giờ đụng tới Activity XP (DEC-004).
 * Điểm team theo snapshot team của tác giả lúc gửi (DEC-024); gỡ và reset chỉ void, không xoá dữ liệu (DEC-027).
 * Lượt ghi nhận có điểm đã bị admin reset vẫn tính là đã dùng: người đó không ghi nhận lại được contribution ấy.
 */
export class ContributionService implements ContributionServiceApi
{
	private readonly repo: ContributionRepository;

	constructor(private readonly db: Db, private readonly deps: ServiceDeps)
	{
		this.repo = new ContributionRepository(db);
	}

	submit(input: SubmitContributionInput): Contribution
	{
		const valid = validateSubmission(input);
		const sourceMessageId = input.sourceMessageId ?? null;
		return this.db.transaction((): Contribution =>
		{
			// Mỗi tin nhắn chỉ là nguồn của một contribution còn hiệu lực, để không nhân điểm. Unique index là lớp chặn cuối.
			if (sourceMessageId !== null)
			{
				const existing = this.repo.findActiveIdBySource(input.guildId, sourceMessageId);
				if (existing !== null) throw new UserError(`Tin nhắn này đã được ghi nhận thành đóng góp #${existing}.`);
			}

			const id = this.repo.insert({
				guildId: input.guildId,
				authorId: input.authorId,
				submittedBy: input.submittedBy,
				title: valid.title,
				description: valid.description,
				category: valid.category,
				link: valid.link,
				sourceMessageId,
				createdAt: this.deps.clock.now(),
			});
			this.repo.insertTeams(id, this.deps.teams.resolveTeams(input.guildId, input.authorRoleIds));
			return this.require(input.guildId, id);
		})();
	}

	attachMessage(guildId: string, contributionId: number, channelId: string, messageId: string): void
	{
		this.repo.setMessage(guildId, contributionId, channelId, messageId);
	}

	get(guildId: string, contributionId: number): Contribution | null
	{
		const row = this.repo.findById(guildId, contributionId);
		return row ? toContribution(row) : null;
	}

	list(guildId: string, options: { authorId?: string; limit: number }): Contribution[]
	{
		const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(options.limit) || 1));
		const rows = options.authorId === undefined
			? this.repo.listActive(guildId, limit)
			: this.repo.listActiveByAuthor(guildId, options.authorId, limit);
		return rows.map(toContribution);
	}

	toggleVote(input: { guildId: string; contributionId: number; voterId: string }): ContributionVoteResult
	{
		const { guildId, contributionId, voterId } = input;
		return this.db.transaction((): ContributionVoteResult =>
		{
			const contribution = this.requireActive(guildId, contributionId);
			if (voterId === contribution.authorId) throw new UserError("Bạn không thể tự ghi nhận đóng góp của chính mình.");

			const existing = this.repo.findVote(contributionId, voterId);
			if (existing !== null)
			{
				// Lượt đã bị admin reset (event bị huỷ) vẫn tính là đã dùng: giữ nguyên dòng vote để không bấm hai lần mà lấy lại điểm.
				if (existing.voided) throw new UserError(VOTE_RESET);
				this.deps.contributionLedger.voidEvent(existing.eventId);
				this.repo.deleteVote(contributionId, voterId);
				return { voted: false, contribution: this.require(guildId, contributionId) };
			}

			const event = this.deps.contributionLedger.record({
				guildId,
				userId: contribution.authorId,
				amount: this.deps.guildConfig.getSettings(guildId).contributionVotePoints,
				source: "vote",
				referenceId: String(contributionId),
				actorId: voterId,
				teamRoleIds: this.repo.teamRoleIds(contributionId),
			});
			this.repo.insertVote(contributionId, voterId, event.id, this.deps.clock.now());
			return { voted: true, contribution: this.require(guildId, contributionId) };
		})();
	}

	remove(guildId: string, contributionId: number, actorId: string): Contribution
	{
		return this.db.transaction((): Contribution =>
		{
			const contribution = this.requireActive(guildId, contributionId);
			this.repo.markRemoved(guildId, contributionId, this.deps.clock.now(), actorId);
			this.deps.contributionLedger.voidByReference(guildId, String(contributionId));
			this.deps.audit.record(guildId, actorId, "contribution.remove", contribution.authorId, {
				contributionId,
				title: contribution.title,
			});
			return this.require(guildId, contributionId);
		})();
	}

	adjust(input: ContributionAdjustInput): { score: number }
	{
		const { guildId, userId, delta } = input;
		if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_ADJUST_DELTA)
		{
			throw new UserError("Số điểm điều chỉnh phải là số nguyên khác 0 và không vượt quá 1.000.000.");
		}

		return this.db.transaction((): { score: number } =>
		{
			const ledger = this.deps.contributionLedger;
			const current = ledger.total(guildId, userId);
			if (current + delta < 0) throw new UserError(`Không thể trừ quá số điểm hiện có (hiện có ${current} điểm).`);

			ledger.record({
				guildId,
				userId,
				amount: delta,
				source: "admin",
				referenceId: null,
				actorId: input.actorId,
				reason: input.reason,
				teamRoleIds: this.deps.teams.resolveTeams(guildId, input.roleIds),
			});
			const score = ledger.total(guildId, userId);
			this.deps.audit.record(guildId, input.actorId, "contribution.adjust", userId, { delta, reason: input.reason, score });
			return { score };
		})();
	}

	resetUser(guildId: string, userId: string, actorId: string): { voidedEvents: number }
	{
		return this.db.transaction((): { voidedEvents: number } =>
		{
			const voidedEvents = this.deps.contributionLedger.voidUser(guildId, userId);
			this.deps.audit.record(guildId, actorId, "contribution.reset_user", userId, { voidedEvents });
			return { voidedEvents };
		})();
	}

	resetAll(guildId: string, actorId: string): { voidedEvents: number; members: number }
	{
		return this.db.transaction((): { voidedEvents: number; members: number } =>
		{
			const { events, members } = this.deps.contributionLedger.voidGuild(guildId);
			this.deps.audit.record(guildId, actorId, "contribution.reset_all", null, { voidedEvents: events, members });
			return { voidedEvents: events, members };
		})();
	}

	getProfile(guildId: string, userId: string): ContributionProfile
	{
		const ledger = this.deps.contributionLedger;
		const { rank, totalRanked } = ledger.rank(guildId, userId);
		return {
			userId,
			score: ledger.total(guildId, userId),
			rank,
			totalRanked,
			contributions: this.repo.countActiveByAuthor(guildId, userId),
		};
	}

	/** Contribution chắc chắn tồn tại (vừa ghi trong cùng transaction). */
	private require(guildId: string, contributionId: number): Contribution
	{
		const contribution = this.get(guildId, contributionId);
		if (!contribution) throw new Error(`Contribution ${contributionId} không tồn tại ngay sau khi ghi.`);
		return contribution;
	}

	private requireActive(guildId: string, contributionId: number): Contribution
	{
		const contribution = this.get(guildId, contributionId);
		if (!contribution) throw new UserError(NOT_FOUND);
		if (contribution.status === "removed") throw new UserError(ALREADY_REMOVED);
		return contribution;
	}
}
