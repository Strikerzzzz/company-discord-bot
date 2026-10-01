import { Statement } from "better-sqlite3";
import { Db } from "../../db/connection";

/** Một dòng contribution kèm số lượt 👍/👎 còn hiệu lực và điểm hiện có của nó. */
export interface ContributionRow
{
	id: number;
	guild_id: string;
	author_id: string;
	submitted_by: string;
	title: string;
	description: string;
	/** Không có CHECK trong schema nên service tự kiểm tra lại khi đọc. */
	category: string;
	link: string | null;
	channel_id: string | null;
	message_id: string | null;
	/** Được CHECK trong schema. */
	status: "active" | "removed";
	created_at: number;
	removed_at: number | null;
	removed_by: string | null;
	/** ID tin nhắn nguồn khi ghi nhận qua context menu (migration 2). */
	source_message_id: string | null;
	/** Được CHECK trong schema (migration 10). */
	review_state: "pending" | "approved" | "rejected";
	reviewed_by: string | null;
	reviewed_at: number | null;
	review_reason: string | null;
	/** Chỉ đếm lượt 👍 có event chưa bị huỷ (lượt bị reset hoặc thuộc contribution đã gỡ không tính). */
	votes: number;
	/** Chỉ đếm lượt 👎 có event chưa bị huỷ. */
	downvotes: number;
	/** Tổng các event chưa huỷ có reference_id là contribution này. */
	score: number;
}

export interface NewContribution
{
	guildId: string;
	authorId: string;
	submittedBy: string;
	title: string;
	description: string;
	category: string;
	link: string | null;
	sourceMessageId: string | null;
	createdAt: number;
}

/** Lượt 👍 của một người; voided = event điểm của lượt đó đã bị huỷ (do admin reset, gỡ contribution, hoặc rút bị khoá). */
export interface VoteRecord
{
	eventId: number;
	voided: boolean;
}

/** Lượt 👎 của một người; locked = bị khoá theo PROP-031 (DEC-051). */
export interface DownvoteRecord
{
	eventId: number;
	voided: boolean;
	locked: boolean;
}

/**
 * Dòng XP người bấm của một người trên một contribution (giữ vĩnh viễn). xpEventId: event XP gần nhất, null = lần đó không được
 * XP. revokedAt: lúc rút hẳn đã huỷ event đó (null nếu chưa rút, hoặc đã bấm lại).
 */
export interface InteractionXpRecord
{
	xpEventId: number | null;
	revokedAt: number | null;
}

export interface VoterRow
{
	kind: "up" | "down";
	user_id: string;
	reason: string | null;
	voided_at: number | null;
	locked_at: number | null;
	created_at: number;
}

const SELECT_WITH_VOTES = `
	SELECT c.*, (
		SELECT COUNT(*) FROM contribution_votes v
		JOIN contribution_events e ON e.id = v.event_id
		WHERE v.contribution_id = c.id AND e.voided_at IS NULL
	) AS votes, (
		SELECT COUNT(*) FROM contribution_downvotes d
		JOIN contribution_events e ON e.id = d.event_id
		WHERE d.contribution_id = c.id AND e.voided_at IS NULL
	) AS downvotes, (
		SELECT COALESCE(SUM(e.amount), 0) FROM contribution_events e
		WHERE e.guild_id = c.guild_id AND e.reference_id = CAST(c.id AS TEXT) AND e.voided_at IS NULL
	) AS score
	FROM contributions c`;

/** Tham số lọc danh sách contribution; `author` null = mọi tác giả, `review` null = mọi trạng thái duyệt. */
export interface ContributionFilterParams
{
	guild: string;
	author: string | null;
	status: "active" | "removed" | "all";
	review: "pending" | "approved" | "rejected" | null;
}

const CONTRIBUTION_FILTER = "c.guild_id = @guild AND (@author IS NULL OR c.author_id = @author) AND (@status = 'all' OR c.status = @status)"
	+ " AND (@review IS NULL OR c.review_state = @review)";

/** Truy cập SQL cho contribution; không chứa quy tắc nghiệp vụ. */
export class ContributionRepository
{
	private readonly insertContribution: Statement<[string, string, string, string, string, string, string | null, string | null, number]>;
	private readonly insertTeam: Statement<[number, string]>;
	private readonly selectTeams: Statement<[number], { role_id: string }>;
	private readonly selectById: Statement<[string, number], ContributionRow>;
	private readonly selectActive: Statement<[string, number], ContributionRow>;
	private readonly selectActiveByAuthor: Statement<[string, string, number], ContributionRow>;
	private readonly countByAuthor: Statement<[string, string], { n: number }>;
	private readonly selectActiveBySource: Statement<[string, string], { id: number }>;
	private readonly updateMessage: Statement<[string, string, string, number]>;
	private readonly updateRemoved: Statement<[number, string, string, number]>;
	private readonly updateReview: Statement<[string, string, number, string | null, string, number]>;
	private readonly selectVote: Statement<[number, string], { event_id: number; voided_at: number | null }>;
	private readonly insertVoteRow: Statement<[number, string, number, number]>;
	private readonly deleteVoteRow: Statement<[number, string]>;
	private readonly selectDownvote: Statement<[number, string], { event_id: number; voided_at: number | null; locked_at: number | null }>;
	private readonly insertDownvoteRow: Statement<[number, string, string, number, string, number]>;
	private readonly deleteDownvoteRow: Statement<[number, string]>;
	private readonly lockDownvoteRow: Statement<[number, number, string]>;
	private readonly selectRawVoteSum: Statement<[string, string], { total: number }>;
	private readonly selectFloorSum: Statement<[string, string], { total: number }>;
	private readonly selectInteractionXp: Statement<[number, string], { xp_event_id: number | null; revoked_at: number | null }>;
	private readonly insertInteractionXpRow: Statement<[number, string, string, number | null, number]>;
	private readonly updateInteractionXpRevoked: Statement<[number, number, string]>;
	private readonly updateInteractionXpRestored: Statement<[number | null, number, string]>;
	private readonly selectInteractionXpSince: Statement<[string, string, number], { total: number }>;
	private readonly selectVoters: Statement<[number, number], VoterRow>;
	private readonly selectPage: Statement<[ContributionFilterParams & { limit: number; offset: number }], ContributionRow>;
	private readonly countPage: Statement<[ContributionFilterParams], { n: number }>;

	constructor(db: Db)
	{
		this.insertContribution = db.prepare(`
			INSERT INTO contributions (guild_id, author_id, submitted_by, title, description, category, link, source_message_id, created_at, review_state)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`);
		this.insertTeam = db.prepare("INSERT OR IGNORE INTO contribution_teams (contribution_id, role_id) VALUES (?, ?)");
		this.selectTeams = db.prepare("SELECT role_id FROM contribution_teams WHERE contribution_id = ? ORDER BY role_id");
		this.selectById = db.prepare(`${SELECT_WITH_VOTES} WHERE c.guild_id = ? AND c.id = ?`);
		this.selectActive = db.prepare(
			`${SELECT_WITH_VOTES} WHERE c.guild_id = ? AND c.status = 'active' AND c.review_state <> 'rejected' ORDER BY c.created_at DESC, c.id DESC LIMIT ?`,
		);
		this.selectActiveByAuthor = db.prepare(`${SELECT_WITH_VOTES}
			WHERE c.guild_id = ? AND c.author_id = ? AND c.status = 'active' AND c.review_state <> 'rejected'
			ORDER BY c.created_at DESC, c.id DESC LIMIT ?`);
		this.countByAuthor = db.prepare(
			"SELECT COUNT(*) AS n FROM contributions WHERE guild_id = ? AND author_id = ? AND status = 'active' AND review_state = 'approved'",
		);
		this.selectActiveBySource = db.prepare(
			"SELECT id FROM contributions WHERE guild_id = ? AND source_message_id = ? AND status = 'active' AND review_state <> 'rejected'",
		);
		this.updateMessage = db.prepare("UPDATE contributions SET channel_id = ?, message_id = ? WHERE guild_id = ? AND id = ?");
		this.updateRemoved = db.prepare("UPDATE contributions SET status = 'removed', removed_at = ?, removed_by = ? WHERE guild_id = ? AND id = ?");
		this.updateReview = db.prepare(
			"UPDATE contributions SET review_state = ?, reviewed_by = ?, reviewed_at = ?, review_reason = ? WHERE guild_id = ? AND id = ?",
		);
		this.selectVote = db.prepare(`
			SELECT v.event_id, e.voided_at
			FROM contribution_votes v
			JOIN contribution_events e ON e.id = v.event_id
			WHERE v.contribution_id = ? AND v.voter_id = ?`);
		this.insertVoteRow = db.prepare("INSERT INTO contribution_votes (contribution_id, voter_id, event_id, created_at) VALUES (?, ?, ?, ?)");
		this.deleteVoteRow = db.prepare("DELETE FROM contribution_votes WHERE contribution_id = ? AND voter_id = ?");
		this.selectDownvote = db.prepare(`
			SELECT d.event_id, e.voided_at, d.locked_at
			FROM contribution_downvotes d
			JOIN contribution_events e ON e.id = d.event_id
			WHERE d.contribution_id = ? AND d.voter_id = ?`);
		this.insertDownvoteRow = db.prepare(
			"INSERT INTO contribution_downvotes (contribution_id, guild_id, voter_id, event_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		);
		this.deleteDownvoteRow = db.prepare("DELETE FROM contribution_downvotes WHERE contribution_id = ? AND voter_id = ?");
		this.lockDownvoteRow = db.prepare("UPDATE contribution_downvotes SET locked_at = ? WHERE contribution_id = ? AND voter_id = ?");
		this.selectRawVoteSum = db.prepare(`
			SELECT COALESCE(SUM(amount), 0) AS total FROM contribution_events
			WHERE guild_id = ? AND reference_id = ? AND voided_at IS NULL AND actor_id IS NOT NULL`);
		this.selectFloorSum = db.prepare(`
			SELECT COALESCE(SUM(amount), 0) AS total FROM contribution_events
			WHERE guild_id = ? AND reference_id = ? AND voided_at IS NULL AND source = 'vote' AND actor_id IS NULL`);
		this.selectInteractionXp = db.prepare("SELECT xp_event_id, revoked_at FROM contribution_interaction_xp WHERE contribution_id = ? AND user_id = ?");
		this.insertInteractionXpRow = db.prepare(
			"INSERT INTO contribution_interaction_xp (contribution_id, guild_id, user_id, xp_event_id, created_at) VALUES (?, ?, ?, ?, ?)",
		);
		this.updateInteractionXpRevoked = db.prepare("UPDATE contribution_interaction_xp SET revoked_at = ? WHERE contribution_id = ? AND user_id = ?");
		this.updateInteractionXpRestored = db.prepare(
			"UPDATE contribution_interaction_xp SET xp_event_id = ?, revoked_at = NULL WHERE contribution_id = ? AND user_id = ?",
		);
		this.selectInteractionXpSince = db.prepare(`
			SELECT COALESCE(SUM(e.amount), 0) AS total
			FROM contribution_interaction_xp x
			JOIN xp_events e ON e.id = x.xp_event_id
			WHERE x.guild_id = ? AND x.user_id = ? AND e.voided_at IS NULL AND e.created_at >= ?`);
		this.selectVoters = db.prepare(`
			SELECT 'up' AS kind, v.voter_id AS user_id, NULL AS reason, e.voided_at AS voided_at, NULL AS locked_at, v.created_at AS created_at
			FROM contribution_votes v JOIN contribution_events e ON e.id = v.event_id
			WHERE v.contribution_id = ?
			UNION ALL
			SELECT 'down' AS kind, d.voter_id AS user_id, d.reason AS reason, e.voided_at AS voided_at, d.locked_at AS locked_at, d.created_at AS created_at
			FROM contribution_downvotes d JOIN contribution_events e ON e.id = d.event_id
			WHERE d.contribution_id = ?
			ORDER BY created_at, user_id`);
		this.selectPage = db.prepare(`${SELECT_WITH_VOTES} WHERE ${CONTRIBUTION_FILTER} ORDER BY c.created_at DESC, c.id DESC LIMIT @limit OFFSET @offset`);
		this.countPage = db.prepare(`SELECT COUNT(*) AS n FROM contributions c WHERE ${CONTRIBUTION_FILTER}`);
	}

	countFiltered(filter: ContributionFilterParams): number
	{
		return this.countPage.get(filter)?.n ?? 0;
	}

	/** Một trang contribution khớp bộ lọc, mới nhất trước. */
	listFiltered(filter: ContributionFilterParams, limit: number, offset: number): ContributionRow[]
	{
		return this.selectPage.all({ ...filter, limit, offset });
	}

	/** Trả về id của contribution vừa tạo (trạng thái chờ duyệt). */
	insert(input: NewContribution): number
	{
		const result = this.insertContribution.run(
			input.guildId, input.authorId, input.submittedBy, input.title, input.description, input.category, input.link,
			input.sourceMessageId, input.createdAt,
		);
		return Number(result.lastInsertRowid);
	}

	insertTeams(contributionId: number, roleIds: readonly string[]): void
	{
		for (const roleId of new Set(roleIds)) this.insertTeam.run(contributionId, roleId);
	}

	teamRoleIds(contributionId: number): string[]
	{
		return this.selectTeams.all(contributionId).map(row => row.role_id);
	}

	findById(guildId: string, contributionId: number): ContributionRow | null
	{
		return this.selectById.get(guildId, contributionId) ?? null;
	}

	/** Contribution còn hiệu lực và chưa bị từ chối, mới nhất trước. */
	listActive(guildId: string, limit: number): ContributionRow[]
	{
		return this.selectActive.all(guildId, limit);
	}

	listActiveByAuthor(guildId: string, authorId: string, limit: number): ContributionRow[]
	{
		return this.selectActiveByAuthor.all(guildId, authorId, limit);
	}

	/** Số contribution còn hiệu lực và đã được duyệt của tác giả. */
	countActiveByAuthor(guildId: string, authorId: string): number
	{
		return this.countByAuthor.get(guildId, authorId)?.n ?? 0;
	}

	/** id của contribution còn hiệu lực, chưa bị từ chối, có tin nhắn nguồn này trong guild; null nếu chưa có. */
	findActiveIdBySource(guildId: string, sourceMessageId: string): number | null
	{
		return this.selectActiveBySource.get(guildId, sourceMessageId)?.id ?? null;
	}

	setMessage(guildId: string, contributionId: number, channelId: string, messageId: string): void
	{
		this.updateMessage.run(channelId, messageId, guildId, contributionId);
	}

	markRemoved(guildId: string, contributionId: number, removedAt: number, removedBy: string): void
	{
		this.updateRemoved.run(removedAt, removedBy, guildId, contributionId);
	}

	setReview(guildId: string, contributionId: number, state: "approved" | "rejected", reviewedBy: string, reviewedAt: number, reason: string | null): void
	{
		this.updateReview.run(state, reviewedBy, reviewedAt, reason, guildId, contributionId);
	}

	/** Lượt 👍 của người này (kể cả lượt có điểm đã bị huỷ), hoặc null nếu chưa từng ghi nhận. */
	findVote(contributionId: number, voterId: string): VoteRecord | null
	{
		const row = this.selectVote.get(contributionId, voterId);
		return row ? { eventId: row.event_id, voided: row.voided_at !== null } : null;
	}

	insertVote(contributionId: number, voterId: string, eventId: number, createdAt: number): void
	{
		this.insertVoteRow.run(contributionId, voterId, eventId, createdAt);
	}

	deleteVote(contributionId: number, voterId: string): void
	{
		this.deleteVoteRow.run(contributionId, voterId);
	}

	/** Lượt 👎 của người này (kể cả lượt có điểm đã bị huỷ), hoặc null nếu không có. */
	findDownvote(contributionId: number, voterId: string): DownvoteRecord | null
	{
		const row = this.selectDownvote.get(contributionId, voterId);
		return row ? { eventId: row.event_id, voided: row.voided_at !== null, locked: row.locked_at !== null } : null;
	}

	insertDownvote(contributionId: number, guildId: string, voterId: string, eventId: number, reason: string, createdAt: number): void
	{
		this.insertDownvoteRow.run(contributionId, guildId, voterId, eventId, reason, createdAt);
	}

	deleteDownvote(contributionId: number, voterId: string): void
	{
		this.deleteDownvoteRow.run(contributionId, voterId);
	}

	lockDownvote(contributionId: number, voterId: string, lockedAt: number): void
	{
		this.lockDownvoteRow.run(lockedAt, contributionId, voterId);
	}

	/** Tổng các event lượt 👍/👎 chưa huỷ của contribution (event có actor), không gồm event sàn. */
	rawVoteSum(guildId: string, contributionId: number): number
	{
		return this.selectRawVoteSum.get(guildId, String(contributionId))?.total ?? 0;
	}

	/** Tổng các event sàn chưa huỷ của contribution (nguồn 'vote', không actor). */
	floorSum(guildId: string, contributionId: number): number
	{
		return this.selectFloorSum.get(guildId, String(contributionId))?.total ?? 0;
	}

	findInteractionXp(contributionId: number, userId: string): InteractionXpRecord | null
	{
		const row = this.selectInteractionXp.get(contributionId, userId);
		return row ? { xpEventId: row.xp_event_id, revokedAt: row.revoked_at } : null;
	}

	insertInteractionXp(contributionId: number, guildId: string, userId: string, xpEventId: number | null, createdAt: number): void
	{
		this.insertInteractionXpRow.run(contributionId, guildId, userId, xpEventId, createdAt);
	}

	/** Đánh dấu đã thu lại XP (rút hẳn); giữ xp_event_id trỏ event đã huỷ để biết số XP. */
	markInteractionXpRevoked(contributionId: number, userId: string, revokedAt: number): void
	{
		this.updateInteractionXpRevoked.run(revokedAt, contributionId, userId);
	}

	/** Bấm lại sau khi rút: trỏ sang event XP mới (null nếu được 0) và bỏ đánh dấu đã thu lại. */
	restoreInteractionXp(contributionId: number, userId: string, xpEventId: number | null): void
	{
		this.updateInteractionXpRestored.run(xpEventId, contributionId, userId);
	}

	/** Tổng XP người bấm còn hiệu lực của một người, từ event phát sinh từ `since` (ms, tính cả mốc) trở đi. */
	interactionXpSince(guildId: string, userId: string, since: number): number
	{
		return this.selectInteractionXpSince.get(guildId, userId, since)?.total ?? 0;
	}

	listVoters(contributionId: number): VoterRow[]
	{
		return this.selectVoters.all(contributionId, contributionId);
	}
}
