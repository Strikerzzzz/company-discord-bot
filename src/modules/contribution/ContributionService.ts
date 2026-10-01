import { Db } from "../../db/connection";
import { UserError } from "../../shared/errors";
import { ListPage, pageWindow } from "../../shared/paging";
import { startOfVnDay } from "../../shared/time";
import { ServiceDeps } from "../deps";
import { ContributionRepository, ContributionRow } from "./ContributionRepository";
import {
	Contribution,
	CONTRIBUTION_CATEGORIES,
	CONTRIBUTION_LIMITS,
	ContributionAdjustInput,
	ContributionCategory,
	ContributionListQuery,
	ContributionProfile,
	ContributionServiceApi,
	ContributionVoteInput,
	ContributionVoteKind,
	ContributionVoter,
	ContributionVoteResult,
	ContributionVoterState,
	SubmitContributionInput,
} from "./types";

const MAX_ADJUST_DELTA = 1_000_000;
const MAX_LIST_LIMIT = 50;

const NOT_FOUND = "Không tìm thấy contribution này.";
const ALREADY_REMOVED = "Contribution này đã bị gỡ.";
const VOTE_LOCKED = "Lượt của bạn cho đóng góp này đã bị khoá (do admin reset, hoặc vì lần bạn rút hay đổi lượt đã phải bù điểm cho tác giả đang bị trừ điểm) nên không đổi hay rút được nữa.";
const NOT_APPROVED = "Đóng góp này đang chờ duyệt, chưa ghi nhận được.";
const REJECTED = "Đóng góp này không được duyệt nên không ghi nhận được.";
const SELF_VOTE = "Bạn không thể tự ghi nhận hay không ghi nhận đóng góp của chính mình.";
const NO_CHANNEL = "Admin chưa chọn kênh contribution nên chưa gửi được đóng góp. Hãy báo admin chọn kênh trên trang web quản trị hoặc bằng `/config contribution`.";
const COMPENSATION_REASON = "Tự động bù để điểm không âm (PROP-024)";
const FLOOR_REASON = "Tự động: điểm của contribution không âm khi 👎 nhiều hơn 👍 (DEC-051)";
const VOTE_ACTIONS = new Set(["up", "down", "withdraw"]);

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

/** Lý do (từ chối, 👎) đã bỏ khoảng trắng hai đầu; UserError nếu ngoài khoảng [min, max] code point. */
function validateReason(raw: string | null | undefined, min: number, max: number, label: string): string
{
	const reason = raw?.trim() ?? "";
	const length = codePointLength(reason);
	if (length < min || length > max) throw new UserError(`${label} phải từ ${min} đến ${max} ký tự.`);
	return reason;
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
		downvotes: row.downvotes,
		score: row.score,
		reviewState: row.review_state,
		reviewedBy: row.reviewed_by,
		reviewedAt: row.reviewed_at,
		reviewReason: row.review_reason,
	};
}

/**
 * Contribution Score (DEC-025, DEC-051): ai cũng gửi được; contribution chờ người duyệt rồi mới mở cho người khác bấm 👍 Ghi nhận
 * hoặc 👎 Không ghi nhận (một trong hai, đổi hoặc rút được).
 * - Điểm của một contribution = max(0, tổng 👍 − tổng 👎): mỗi lượt một event trong contributionLedger (👍 dương, 👎 âm, actor là
 *   người bấm), cộng các event sàn (nguồn 'vote', không actor) có tổng bằng phần âm của các lượt. Event sàn ghi theo chênh lệch tại
 *   thời điểm thao tác, nên bảng tuần/tháng nhận đúng phần điểm contribution thay đổi trong kỳ (bị 👎 không làm điểm kỳ tăng).
 * - Người bấm được Activity XP một lần mỗi contribution (xpLedger, nguồn 'admin', actor là bot, như XP retro), có hạn mức ngày;
 *   rút thì thu lại, bấm lại thì được lại (không lời không lỗ); phần bị hạn mức cắt hay bị admin reset không bao giờ được bù. Gỡ
 *   contribution không thu lại XP người bấm (họ đã tương tác thật). Đây là XP hoạt động như tham gia vote, điểm contribution vẫn
 *   tách khỏi XP (DEC-004).
 * - Điểm team theo snapshot team của tác giả lúc gửi (DEC-024); gỡ và reset chỉ void, không xoá dữ liệu (DEC-027).
 * - Lượt có điểm đã bị admin reset vẫn tính là đã dùng: người đó không đổi hay rút được lượt ấy.
 * - Tổng của tác giả không bao giờ âm (DEC-028, PROP-024): thao tác làm tổng âm thì tự ghi event bù trong cùng transaction. Thao tác
 *   làm giảm điểm (rút 👍, thêm hoặc đổi sang 👎) mà phải bù thì lượt đó bị khoá, để hình phạt không bị xoá (DEC-032, PROP-031).
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
		if (this.deps.guildConfig.getSettings(input.guildId).contributionChannelId === null) throw new UserError(NO_CHANNEL);
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

	listPage(guildId: string, query: ContributionListQuery): ListPage<Contribution>
	{
		const review = query.review === undefined || query.review === "all" ? null : query.review;
		const filter = { guild: guildId, author: query.authorId ?? null, status: query.status, review };
		const total = this.repo.countFiltered(filter);
		const window = pageWindow(total, query.page, query.pageSize);
		const items = this.repo.listFiltered(filter, window.pageSize, window.offset).map(toContribution);
		return { items, page: window.page, totalPages: window.totalPages, total, pageSize: window.pageSize };
	}

	approve(guildId: string, contributionId: number, actorId: string): Contribution
	{
		return this.db.transaction((): Contribution =>
		{
			const contribution = this.requirePending(guildId, contributionId);
			this.repo.setReview(guildId, contributionId, "approved", actorId, this.deps.clock.now(), null);
			this.deps.audit.record(guildId, actorId, "contribution.approve", contribution.authorId, { contributionId, title: contribution.title });
			return this.require(guildId, contributionId);
		})();
	}

	reject(guildId: string, contributionId: number, actorId: string, reason: string): Contribution
	{
		const text = validateReason(reason, CONTRIBUTION_LIMITS.rejectReasonMin, CONTRIBUTION_LIMITS.rejectReasonMax, "Lý do từ chối");
		return this.db.transaction((): Contribution =>
		{
			const contribution = this.requirePending(guildId, contributionId);
			this.repo.setReview(guildId, contributionId, "rejected", actorId, this.deps.clock.now(), text);
			// Lý do từ chối không ghi vào audit (nhật ký không giấu theo quyền xem kênh, PROP-038); lý do nằm ở contributions.review_reason.
			this.deps.audit.record(guildId, actorId, "contribution.reject", contribution.authorId, { contributionId, title: contribution.title });
			return this.require(guildId, contributionId);
		})();
	}

	voterState(guildId: string, contributionId: number, voterId: string): ContributionVoterState
	{
		if (this.get(guildId, contributionId) === null) return { current: null, locked: false };
		const up = this.repo.findVote(contributionId, voterId);
		const down = this.repo.findDownvote(contributionId, voterId);
		const current: ContributionVoteKind | null = up !== null && !up.voided ? "up" : down !== null && !down.voided ? "down" : null;
		const locked = (up !== null && up.voided) || (down !== null && (down.voided || down.locked));
		return { current, locked };
	}

	vote(input: ContributionVoteInput): ContributionVoteResult
	{
		const { guildId, contributionId, voterId, action } = input;
		if (!VOTE_ACTIONS.has(action)) throw new UserError("Thao tác không hợp lệ.");
		return this.db.transaction((): ContributionVoteResult =>
		{
			const contribution = this.requireActive(guildId, contributionId);
			if (contribution.reviewState === "pending") throw new UserError(NOT_APPROVED);
			if (contribution.reviewState === "rejected") throw new UserError(REJECTED);
			if (voterId === contribution.authorId) throw new UserError(SELF_VOTE);

			const state = this.voterState(guildId, contributionId, voterId);
			const target: ContributionVoteKind | null = action === "withdraw" ? null : action;
			const unchanged = (): ContributionVoteResult => (
				{ current: state.current, change: "unchanged", locked: false, xpAwarded: 0, xpCapped: false, xpRevoked: 0, contribution }
			);
			if (target === state.current && !state.locked) return unchanged();
			if (state.locked) throw new UserError(VOTE_LOCKED);
			const reason = target === "down"
				? validateReason(input.reason, CONTRIBUTION_LIMITS.downvoteReasonMin, CONTRIBUTION_LIMITS.downvoteReasonMax, "Lý do không ghi nhận")
				: null;

			const ledger = this.deps.contributionLedger;
			const now = this.deps.clock.now();
			const points = this.deps.guildConfig.getSettings(guildId).contributionVotePoints;
			const teamRoleIds = this.repo.teamRoleIds(contributionId);
			const up = this.repo.findVote(contributionId, voterId);
			const down = this.repo.findDownvote(contributionId, voterId);

			// Bỏ lượt đang có. Lượt 👍 chỉ xoá dòng sau khi biết có bị khoá hay không (PROP-031).
			if (state.current === "up" && up !== null) ledger.voidEvent(up.eventId);
			if (state.current === "down" && down !== null)
			{
				ledger.voidEvent(down.eventId);
				this.repo.deleteDownvote(contributionId, voterId);
			}

			let eventId: number | null = null;
			if (target !== null)
			{
				eventId = ledger.record({
					guildId,
					userId: contribution.authorId,
					amount: target === "up" ? points : -points,
					source: "vote",
					referenceId: String(contributionId),
					actorId: voterId,
					teamRoleIds,
				}).id;
				if (target === "down" && reason !== null)
				{
					this.repo.insertDownvote(contributionId, guildId, voterId, eventId, reason, now);
				}
			}

			this.recomputeFloor(guildId, contribution.authorId, contributionId, teamRoleIds);
			const reduced = state.current === "up" || target === "down";
			const locked = reduced && this.compensateNegative(guildId, contribution.authorId, contributionId) > 0;

			if (state.current === "up" && !(locked && target === null)) this.repo.deleteVote(contributionId, voterId);
			if (target === "up" && eventId !== null) this.repo.insertVote(contributionId, voterId, eventId, now);
			if (target === "down" && locked) this.repo.lockDownvote(contributionId, voterId, now);

			let xp = { awarded: 0, capped: false };
			let xpRevoked = 0;
			if (state.current === null && target !== null) xp = this.awardInteractionXp(input, now);
			if (target === null) xpRevoked = this.revokeInteractionXp(contributionId, voterId, now);

			return {
				current: target,
				change: state.current === null ? "added" : target === null ? "withdrawn" : "switched",
				locked,
				xpAwarded: xp.awarded,
				xpCapped: xp.capped,
				xpRevoked,
				contribution: this.require(guildId, contributionId),
			};
		})();
	}

	listVoters(guildId: string, contributionId: number): ContributionVoter[]
	{
		if (this.get(guildId, contributionId) === null) return [];
		return this.repo.listVoters(contributionId).map(row => ({
			userId: row.user_id,
			kind: row.kind,
			reason: row.reason,
			active: row.voided_at === null,
			locked: row.voided_at !== null || row.locked_at !== null,
			createdAt: row.created_at,
		}));
	}

	remove(guildId: string, contributionId: number, actorId: string): Contribution
	{
		return this.db.transaction((): Contribution =>
		{
			const contribution = this.requireActive(guildId, contributionId);
			this.repo.markRemoved(guildId, contributionId, this.deps.clock.now(), actorId);
			this.deps.contributionLedger.voidByReference(guildId, String(contributionId));
			const compensated = this.compensateNegative(guildId, contribution.authorId, contributionId);
			this.deps.audit.record(guildId, actorId, "contribution.remove", contribution.authorId, {
				contributionId,
				title: contribution.title,
				...(compensated > 0 ? { compensated } : {}),
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
			// Chỉ chặn khi trừ: tổng đang âm (dữ liệu cũ trước DEC-028) vẫn phải cộng được để đưa về lại.
			if (delta < 0 && current + delta < 0) throw new UserError(`Không thể trừ quá số điểm hiện có (hiện có ${current} điểm).`);

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

	/**
	 * Đưa event sàn của contribution về đúng: tổng các event sàn chưa huỷ (nguồn 'vote', không actor, reference là contribution, nên
	 * gỡ contribution hay reset huỷ luôn) phải bằng max(0, −tổng các lượt 👍/👎 chưa huỷ). Lệch thì ghi MỘT event mới bằng phần chênh
	 * lệch (có thể âm) và không huỷ event sàn cũ: phần điểm contribution thay đổi do thao tác này rơi đúng vào thời điểm thao tác, nên
	 * bảng tuần/tháng không cộng nhầm cả phần sàn cũ vào kỳ hiện tại. Gọi trong transaction của thao tác lượt, trước compensateNegative.
	 */
	private recomputeFloor(guildId: string, authorId: string, contributionId: number, teamRoleIds: readonly string[]): void
	{
		const raw = this.repo.rawVoteSum(guildId, contributionId);
		const wanted = raw < 0 ? -raw : 0;
		const delta = wanted - this.repo.floorSum(guildId, contributionId);
		if (delta === 0) return;
		this.deps.contributionLedger.record({
			guildId,
			userId: authorId,
			amount: delta,
			source: "vote",
			referenceId: String(contributionId),
			actorId: null,
			reason: FLOOR_REASON,
			teamRoleIds,
		});
	}

	/**
	 * XP người bấm (DEC-051) khi một người từ chỗ chưa có lượt bấm 👍/👎 trên contribution:
	 * - chưa có dòng XP: cộng min(cấu hình, hạn mức ngày còn lại) rồi ghi dòng (kể cả khi được 0 XP);
	 * - dòng đã bị thu lại khi rút (revoked_at): cộng lại min(số XP đã thu, hạn mức ngày còn lại), dòng trỏ sang event mới;
	 * - dòng khác (đang giữ XP, event bị admin reset, hoặc lần trước được 0 hay bị cắt): không cộng, để không có đường cộng bù.
	 */
	private awardInteractionXp(input: ContributionVoteInput, now: number): { awarded: number; capped: boolean }
	{
		const { guildId, contributionId, voterId } = input;
		const record = this.repo.findInteractionXp(contributionId, voterId);
		const settings = this.deps.guildConfig.getSettings(guildId);
		let reward = settings.contributionInteractionXp;
		if (record !== null)
		{
			if (record.revokedAt === null || record.xpEventId === null) return { awarded: 0, capped: false };
			reward = this.deps.xpLedger.getEvent(record.xpEventId)?.amount ?? 0;
		}

		const cap = settings.contributionInteractionXpDailyCap;
		const remaining = cap <= 0 ? reward : Math.max(0, cap - this.repo.interactionXpSince(guildId, voterId, startOfVnDay(now)));
		const awarded = Math.min(reward, remaining);
		let xpEventId: number | null = null;
		if (awarded > 0)
		{
			xpEventId = this.deps.xpLedger.record({
				guildId,
				userId: voterId,
				amount: awarded,
				source: "admin",
				referenceId: `contribution:${contributionId}`,
				actorId: input.systemActorId,
				reason: `Contribution #${contributionId}: ghi nhận hoặc không ghi nhận`,
				teamRoleIds: this.deps.teams.resolveTeams(guildId, input.voterRoleIds),
			}).id;
		}
		if (record === null) this.repo.insertInteractionXp(contributionId, guildId, voterId, xpEventId, now);
		else this.repo.restoreInteractionXp(contributionId, voterId, xpEventId);
		return { awarded, capped: reward > 0 && awarded < reward };
	}

	/**
	 * Rút hẳn lượt: event XP người bấm còn hiệu lực thì huỷ và đánh dấu dòng là đã thu lại (giữ dòng và xp_event_id để lần bấm lại
	 * biết số XP được trả). Event đã bị admin reset, hoặc không có event (lần đó được 0), thì không làm gì. Trả về số XP vừa thu lại.
	 */
	private revokeInteractionXp(contributionId: number, voterId: string, now: number): number
	{
		const record = this.repo.findInteractionXp(contributionId, voterId);
		if (record === null || record.xpEventId === null || record.revokedAt !== null) return 0;
		const event = this.deps.xpLedger.getEvent(record.xpEventId);
		if (event === null || event.voidedAt !== null) return 0;
		this.deps.xpLedger.voidEvent(event.id);
		this.repo.markInteractionXpRevoked(contributionId, voterId, now);
		return event.amount;
	}

	/**
	 * PROP-024: gọi ngay sau khi huỷ điểm của một contribution, trong cùng transaction. Tổng của tác giả âm thì ghi một
	 * event bù (nguồn admin, không có actor) để tổng về đúng 0; trả về số điểm đã bù (0 nếu không cần bù).
	 * reference_id để null để lần gỡ hay rút ghi nhận sau (void theo reference) không huỷ nhầm event bù.
	 * Dùng snapshot team của contribution, nên điểm team chỉ mất đúng phần tác giả thực sự mất.
	 */
	private compensateNegative(guildId: string, authorId: string, contributionId: number): number
	{
		const ledger = this.deps.contributionLedger;
		const total = ledger.total(guildId, authorId);
		if (total >= 0) return 0;

		ledger.record({
			guildId,
			userId: authorId,
			amount: -total,
			source: "admin",
			referenceId: null,
			actorId: null,
			reason: COMPENSATION_REASON,
			teamRoleIds: this.repo.teamRoleIds(contributionId),
		});
		return -total;
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

	private requirePending(guildId: string, contributionId: number): Contribution
	{
		const contribution = this.requireActive(guildId, contributionId);
		if (contribution.reviewState === "approved") throw new UserError(`Đóng góp #${contributionId} đã được duyệt.`);
		if (contribution.reviewState === "rejected") throw new UserError(`Đóng góp #${contributionId} đã bị từ chối.`);
		return contribution;
	}
}
