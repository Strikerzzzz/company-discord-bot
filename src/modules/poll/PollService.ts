import { Db } from "../../db/connection";
import { UserError } from "../../shared/errors";
import { startOfVnDay } from "../../shared/time";
import { ServiceDeps } from "../deps";
import { SETTING_LIMITS } from "../guild-config/types";
import { PollRepository, PollRow } from "./PollRepository";
import { CreatePollInput, Poll, POLL_LIMITS, PollServiceApi, PollVoteResult } from "./types";

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_DAY = 24 * 60;

// XP cho người tham gia dùng chung giới hạn với "XP mặc định khi vote" của guild, để hai giá trị luôn nhất quán.
const XP_REWARD_LIMIT = SETTING_LIMITS.defaultPollXp;

const NOT_FOUND = "Không tìm thấy vote này.";
const ALREADY_CLOSED = "Vote này đã đóng.";

/** Chưa bị đóng và chưa quá hạn, tại thời điểm now. */
function isOpen(row: PollRow, now: number): boolean
{
	return row.closed_at === null && (row.closes_at === null || now < row.closes_at);
}

function validateQuestion(raw: string): string
{
	const question = raw.trim();
	if (question.length < POLL_LIMITS.questionMin || question.length > POLL_LIMITS.questionMax)
	{
		throw new UserError(`Câu hỏi phải dài từ ${POLL_LIMITS.questionMin} đến ${POLL_LIMITS.questionMax} ký tự.`);
	}
	return question;
}

function validateOptions(raw: readonly string[]): string[]
{
	const options = raw.map(option => option.trim()).filter(option => option.length > 0);
	if (options.length < POLL_LIMITS.optionsMin || options.length > POLL_LIMITS.optionsMax)
	{
		throw new UserError(`Vote cần từ ${POLL_LIMITS.optionsMin} đến ${POLL_LIMITS.optionsMax} lựa chọn (không tính lựa chọn để trống).`);
	}

	const seen = new Set<string>();
	for (const option of options)
	{
		if (option.length > POLL_LIMITS.optionLabelMax)
		{
			throw new UserError(`Mỗi lựa chọn chỉ được dài tối đa ${POLL_LIMITS.optionLabelMax} ký tự.`);
		}
		// Chuẩn hoá Unicode trước khi so sánh để chữ có dấu gõ theo hai cách khác nhau vẫn bị coi là trùng.
		const key = option.normalize("NFC").toLowerCase();
		if (seen.has(key)) throw new UserError("Các lựa chọn không được trùng nhau.");
		seen.add(key);
	}
	return options;
}

function validateXpReward(xpReward: number): void
{
	if (!Number.isInteger(xpReward) || xpReward < XP_REWARD_LIMIT.min || xpReward > XP_REWARD_LIMIT.max)
	{
		throw new UserError(`XP cho người tham gia phải là số nguyên từ ${XP_REWARD_LIMIT.min} đến ${XP_REWARD_LIMIT.max}.`);
	}
}

function validateDuration(durationMinutes: number | null): void
{
	if (durationMinutes === null) return;
	const { durationMinutesMin: min, durationMinutesMax: max } = POLL_LIMITS;
	if (!Number.isInteger(durationMinutes) || durationMinutes < min || durationMinutes > max)
	{
		throw new UserError(`Thời hạn phải là số phút nguyên từ ${min} đến ${max} (${max / MINUTES_PER_DAY} ngày).`);
	}
}

/**
 * Vote / bầu cử / lấy ý kiến (DEC-026).
 * - Phiếu ẩn danh: chỉ trả số lượng mỗi lựa chọn, không bao giờ trả danh sách người chọn.
 * - Được đổi phiếu tới khi vote đóng.
 * - Người tham gia được XP một lần cho mỗi vote, cộng vào Activity XP (không đụng tới Contribution, DEC-004).
 * - Tổng XP từ vote của một người trong một ngày (giờ Việt Nam) không vượt `pollXpDailyCap` (DEC-028, PROP-028); phần bị cắt
 *   không được cộng bù về sau.
 */
export class PollService implements PollServiceApi
{
	private readonly repo: PollRepository;

	constructor(private readonly db: Db, private readonly deps: ServiceDeps)
	{
		this.repo = new PollRepository(db);
	}

	create(input: CreatePollInput): Poll
	{
		const question = validateQuestion(input.question);
		const options = validateOptions(input.options);
		validateXpReward(input.xpReward);
		validateDuration(input.durationMinutes);

		const now = this.deps.clock.now();
		const closesAt = input.durationMinutes === null ? null : now + input.durationMinutes * MS_PER_MINUTE;

		return this.db.transaction((): Poll =>
		{
			const pollId = this.repo.insertPoll({
				guildId: input.guildId,
				creatorId: input.creatorId,
				question,
				multiSelect: input.multiSelect,
				xpReward: input.xpReward,
				closesAt,
				createdAt: now,
			});
			options.forEach((label, index) => this.repo.insertOption(pollId, index, label));
			// Ghi cả XP thưởng để truy vết được vote đặt XP cao bất thường.
			this.deps.audit.record(input.guildId, input.creatorId, "poll.create", null, { pollId, question, xpReward: input.xpReward });
			return this.load(pollId, now);
		})();
	}

	attachMessage(guildId: string, pollId: number, channelId: string, messageId: string): void
	{
		if (!Number.isSafeInteger(pollId) || !this.repo.setMessage(guildId, pollId, channelId, messageId))
		{
			throw new UserError(NOT_FOUND);
		}
	}

	get(guildId: string, pollId: number): Poll | null
	{
		const row = this.findRow(guildId, pollId);
		return row ? this.toPoll(row, this.deps.clock.now()) : null;
	}

	vote(input: { guildId: string; pollId: number; userId: string; optionIndex: number; roleIds: readonly string[] }): PollVoteResult
	{
		const { guildId, pollId, userId, optionIndex } = input;
		return this.db.transaction((): PollVoteResult =>
		{
			const now = this.deps.clock.now();
			const row = this.findRow(guildId, pollId);
			if (!row) throw new UserError(NOT_FOUND);
			if (!isOpen(row, now)) throw new UserError(ALREADY_CLOSED);
			if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= this.repo.countOptions(pollId))
			{
				throw new UserError("Lựa chọn không hợp lệ.");
			}

			if (row.multi_select === 1)
			{
				if (!this.repo.removeVote(pollId, userId, optionIndex)) this.repo.addVote(pollId, userId, optionIndex, now);
			}
			else
			{
				this.repo.removeOtherVotes(pollId, userId, optionIndex);
				this.repo.addVote(pollId, userId, optionIndex, now);
			}

			// Trạng thái "đã tham gia" giữ nguyên kể cả khi bỏ hết lựa chọn, nên XP chỉ được xét một lần.
			// Vì vậy phần XP bị giới hạn ngày cắt đi cũng không bao giờ được cộng lại (bấm lại hay đổi phiếu hôm sau).
			const dailyCap = this.deps.guildConfig.getSettings(guildId).pollXpDailyCap;
			let xpAwarded = 0;
			let xpCapped = false;
			if (!this.repo.hasParticipant(pollId, userId))
			{
				let xpEventId: number | null = null;
				if (row.xp_reward > 0)
				{
					xpAwarded = this.cappedPollXp(guildId, userId, row.xp_reward, dailyCap, now);
					xpCapped = xpAwarded < row.xp_reward;
				}
				if (xpAwarded > 0)
				{
					const event = this.deps.xpLedger.record({
						guildId,
						userId,
						amount: xpAwarded,
						source: "poll",
						referenceId: String(pollId),
						teamRoleIds: this.deps.teams.resolveTeams(guildId, input.roleIds),
					});
					xpEventId = event.id;
				}
				this.repo.insertParticipant(pollId, userId, xpEventId, now);
			}

			return {
				poll: this.load(pollId, now),
				selected: this.repo.selectedOptions(pollId, userId),
				xpAwarded,
				xpCapped,
				dailyCap,
			};
		})();
	}

	close(input: { guildId: string; pollId: number; actorId: string; actorIsAdmin: boolean }): Poll
	{
		const { guildId, pollId, actorId } = input;
		return this.db.transaction((): Poll =>
		{
			const now = this.deps.clock.now();
			const row = this.findRow(guildId, pollId);
			if (!row) throw new UserError(NOT_FOUND);
			if (row.closed_at !== null) throw new UserError(ALREADY_CLOSED);
			if (actorId !== row.creator_id && !input.actorIsAdmin)
			{
				throw new UserError("Chỉ người tạo vote hoặc admin mới đóng được vote.");
			}

			this.repo.markClosed(pollId, now);
			this.deps.audit.record(guildId, actorId, "poll.close", null, { pollId });
			return this.load(pollId, now);
		})();
	}

	closeDue(): Poll[]
	{
		return this.db.transaction((): Poll[] =>
		{
			const now = this.deps.clock.now();
			const closed: Poll[] = [];
			for (const row of this.repo.findDue(now))
			{
				if (this.repo.markClosed(row.id, now)) closed.push(this.load(row.id, now));
			}
			return closed;
		})();
	}

	listOpen(guildId: string): Poll[]
	{
		const now = this.deps.clock.now();
		return this.repo.findOpen(guildId, now).map(row => this.toPoll(row, now));
	}

	/**
	 * XP được cộng cho một lượt tham gia sau khi áp giới hạn ngày (PROP-028): phần còn lại của giới hạn trong ngày giờ Việt Nam
	 * chứa `now`, tính từ các event nguồn "poll" chưa huỷ (XP bị admin reset không tính là đã dùng). dailyCap = 0 là không giới hạn.
	 */
	private cappedPollXp(guildId: string, userId: string, xpReward: number, dailyCap: number, now: number): number
	{
		if (dailyCap <= 0) return xpReward;
		const used = this.deps.xpLedger.sumSince(guildId, userId, "poll", startOfVnDay(now));
		return Math.max(0, Math.min(xpReward, dailyCap - used));
	}

	/** Dòng poll thuộc guild, hoặc null nếu không có (kể cả khi id không phải số nguyên). */
	private findRow(guildId: string, pollId: number): PollRow | null
	{
		if (!Number.isSafeInteger(pollId)) return null;
		const row = this.repo.findPoll(pollId);
		return row && row.guild_id === guildId ? row : null;
	}

	/** Đọc lại một poll vừa ghi; không tìm thấy là lỗi hệ thống (bug), không phải lỗi người dùng. */
	private load(pollId: number, now: number): Poll
	{
		const row = this.repo.findPoll(pollId);
		if (!row) throw new Error(`Không đọc lại được poll ${pollId} vừa ghi.`);
		return this.toPoll(row, now);
	}

	private toPoll(row: PollRow, now: number): Poll
	{
		return {
			id: row.id,
			guildId: row.guild_id,
			creatorId: row.creator_id,
			question: row.question,
			multiSelect: row.multi_select === 1,
			xpReward: row.xp_reward,
			channelId: row.channel_id,
			messageId: row.message_id,
			closesAt: row.closes_at,
			closedAt: row.closed_at,
			createdAt: row.created_at,
			open: isOpen(row, now),
			options: this.repo.listOptions(row.id).map(option => ({ index: option.option_index, label: option.label, votes: option.votes })),
			participants: this.repo.countParticipants(row.id),
		};
	}
}
