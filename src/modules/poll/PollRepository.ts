import { Statement } from "better-sqlite3";
import { Db } from "../../db/connection";

export interface PollRow
{
	id: number;
	guild_id: string;
	creator_id: string;
	question: string;
	multi_select: number;
	xp_reward: number;
	channel_id: string | null;
	message_id: string | null;
	closes_at: number | null;
	closed_at: number | null;
	created_at: number;
}

export interface PollOptionRow
{
	option_index: number;
	label: string;
	votes: number;
}

export interface NewPoll
{
	guildId: string;
	creatorId: string;
	question: string;
	multiSelect: boolean;
	xpReward: number;
	closesAt: number | null;
	createdAt: number;
}

/**
 * Truy cập các bảng polls, poll_options, poll_votes, poll_participants. Chỉ chứa SQL, không có quy tắc nghiệp vụ.
 * Phiếu ẩn danh (DEC-026): không có hàm nào trả danh sách người đã chọn một lựa chọn.
 */
export class PollRepository
{
	private readonly insertPollStmt: Statement<[string, string, string, number, number, number | null, number]>;
	private readonly insertOptionStmt: Statement<[number, number, string]>;
	private readonly selectPoll: Statement<[number], PollRow>;
	private readonly selectOptions: Statement<[number], PollOptionRow>;
	private readonly selectOptionCount: Statement<[number], { n: number }>;
	private readonly selectParticipantCount: Statement<[number], { n: number }>;
	private readonly updateMessage: Statement<[string, string, number, string]>;
	private readonly selectSelected: Statement<[number, string], { option_index: number }>;
	private readonly insertVoteStmt: Statement<[number, string, number, number]>;
	private readonly deleteVoteStmt: Statement<[number, string, number]>;
	private readonly deleteOtherVotesStmt: Statement<[number, string, number]>;
	private readonly selectParticipant: Statement<[number, string], { user_id: string }>;
	private readonly insertParticipantStmt: Statement<[number, string, number | null, number]>;
	private readonly updateClosed: Statement<[number, number]>;
	private readonly selectDue: Statement<[number], PollRow>;
	private readonly selectOpen: Statement<[string, number], PollRow>;

	constructor(db: Db)
	{
		this.insertPollStmt = db.prepare(`
			INSERT INTO polls (guild_id, creator_id, question, multi_select, xp_reward, closes_at, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`);
		this.insertOptionStmt = db.prepare("INSERT INTO poll_options (poll_id, option_index, label) VALUES (?, ?, ?)");
		this.selectPoll = db.prepare("SELECT * FROM polls WHERE id = ?");
		this.selectOptions = db.prepare(`
			SELECT o.option_index AS option_index, o.label AS label, COUNT(v.user_id) AS votes
			FROM poll_options o
			LEFT JOIN poll_votes v ON v.poll_id = o.poll_id AND v.option_index = o.option_index
			WHERE o.poll_id = ?
			GROUP BY o.option_index, o.label
			ORDER BY o.option_index`);
		this.selectOptionCount = db.prepare("SELECT COUNT(*) AS n FROM poll_options WHERE poll_id = ?");
		this.selectParticipantCount = db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM poll_votes WHERE poll_id = ?");
		this.updateMessage = db.prepare("UPDATE polls SET channel_id = ?, message_id = ? WHERE id = ? AND guild_id = ?");
		this.selectSelected = db.prepare("SELECT option_index FROM poll_votes WHERE poll_id = ? AND user_id = ? ORDER BY option_index");
		this.insertVoteStmt = db.prepare("INSERT OR IGNORE INTO poll_votes (poll_id, user_id, option_index, created_at) VALUES (?, ?, ?, ?)");
		this.deleteVoteStmt = db.prepare("DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ? AND option_index = ?");
		this.deleteOtherVotesStmt = db.prepare("DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ? AND option_index <> ?");
		this.selectParticipant = db.prepare("SELECT user_id FROM poll_participants WHERE poll_id = ? AND user_id = ?");
		this.insertParticipantStmt = db.prepare("INSERT INTO poll_participants (poll_id, user_id, xp_event_id, first_voted_at) VALUES (?, ?, ?, ?)");
		this.updateClosed = db.prepare("UPDATE polls SET closed_at = ? WHERE id = ? AND closed_at IS NULL");
		this.selectDue = db.prepare("SELECT * FROM polls WHERE closed_at IS NULL AND closes_at IS NOT NULL AND closes_at <= ? ORDER BY closes_at, id");
		this.selectOpen = db.prepare(`
			SELECT * FROM polls
			WHERE guild_id = ? AND closed_at IS NULL AND (closes_at IS NULL OR closes_at > ?)
			ORDER BY created_at DESC, id DESC`);
	}

	insertPoll(poll: NewPoll): number
	{
		const result = this.insertPollStmt.run(
			poll.guildId, poll.creatorId, poll.question, poll.multiSelect ? 1 : 0, poll.xpReward, poll.closesAt, poll.createdAt,
		);
		return Number(result.lastInsertRowid);
	}

	insertOption(pollId: number, index: number, label: string): void
	{
		this.insertOptionStmt.run(pollId, index, label);
	}

	findPoll(pollId: number): PollRow | null
	{
		return this.selectPoll.get(pollId) ?? null;
	}

	/** Các lựa chọn theo thứ tự, kèm số người đang chọn mỗi lựa chọn. */
	listOptions(pollId: number): PollOptionRow[]
	{
		return this.selectOptions.all(pollId);
	}

	countOptions(pollId: number): number
	{
		return this.selectOptionCount.get(pollId)?.n ?? 0;
	}

	/** Số người khác nhau đang có ít nhất một lựa chọn. */
	countParticipants(pollId: number): number
	{
		return this.selectParticipantCount.get(pollId)?.n ?? 0;
	}

	/** Trả về false nếu không có vote này trong guild. */
	setMessage(guildId: string, pollId: number, channelId: string, messageId: string): boolean
	{
		return this.updateMessage.run(channelId, messageId, pollId, guildId).changes > 0;
	}

	/** Các lựa chọn hiện tại của một người, tăng dần. */
	selectedOptions(pollId: number, userId: string): number[]
	{
		return this.selectSelected.all(pollId, userId).map(row => row.option_index);
	}

	/** Thêm lựa chọn nếu chưa có. */
	addVote(pollId: number, userId: string, optionIndex: number, createdAt: number): void
	{
		this.insertVoteStmt.run(pollId, userId, optionIndex, createdAt);
	}

	/** Trả về true nếu có lựa chọn bị xoá. */
	removeVote(pollId: number, userId: string, optionIndex: number): boolean
	{
		return this.deleteVoteStmt.run(pollId, userId, optionIndex).changes > 0;
	}

	removeOtherVotes(pollId: number, userId: string, keepIndex: number): void
	{
		this.deleteOtherVotesStmt.run(pollId, userId, keepIndex);
	}

	hasParticipant(pollId: number, userId: string): boolean
	{
		return this.selectParticipant.get(pollId, userId) !== undefined;
	}

	insertParticipant(pollId: number, userId: string, xpEventId: number | null, firstVotedAt: number): void
	{
		this.insertParticipantStmt.run(pollId, userId, xpEventId, firstVotedAt);
	}

	/** Trả về true nếu vote vừa được đóng (trước đó chưa đóng). */
	markClosed(pollId: number, closedAt: number): boolean
	{
		return this.updateClosed.run(closedAt, pollId).changes > 0;
	}

	/** Vote chưa đóng nhưng đã tới hạn, ở mọi guild. */
	findDue(now: number): PollRow[]
	{
		return this.selectDue.all(now);
	}

	/** Vote đang mở của guild, mới nhất trước. */
	findOpen(guildId: string, now: number): PollRow[]
	{
		return this.selectOpen.all(guildId, now);
	}
}
