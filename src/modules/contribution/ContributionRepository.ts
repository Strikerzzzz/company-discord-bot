import { Statement } from "better-sqlite3";
import { Db } from "../../db/connection";

/** Một dòng contribution kèm số lượt ghi nhận còn hiệu lực. */
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
	/** Chỉ đếm lượt có event chưa bị huỷ (lượt bị reset hoặc thuộc contribution đã gỡ không tính). */
	votes: number;
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

/** Lượt ghi nhận của một người; voided = event điểm của lượt đó đã bị huỷ (do admin reset hoặc gỡ contribution). */
export interface VoteRecord
{
	eventId: number;
	voided: boolean;
}

const SELECT_WITH_VOTES = `
	SELECT c.*, (
		SELECT COUNT(*) FROM contribution_votes v
		JOIN contribution_events e ON e.id = v.event_id
		WHERE v.contribution_id = c.id AND e.voided_at IS NULL
	) AS votes
	FROM contributions c`;

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
	private readonly selectVote: Statement<[number, string], { event_id: number; voided_at: number | null }>;
	private readonly insertVoteRow: Statement<[number, string, number, number]>;
	private readonly deleteVoteRow: Statement<[number, string]>;

	constructor(db: Db)
	{
		this.insertContribution = db.prepare(`
			INSERT INTO contributions (guild_id, author_id, submitted_by, title, description, category, link, source_message_id, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
		this.insertTeam = db.prepare("INSERT OR IGNORE INTO contribution_teams (contribution_id, role_id) VALUES (?, ?)");
		this.selectTeams = db.prepare("SELECT role_id FROM contribution_teams WHERE contribution_id = ? ORDER BY role_id");
		this.selectById = db.prepare(`${SELECT_WITH_VOTES} WHERE c.guild_id = ? AND c.id = ?`);
		this.selectActive = db.prepare(`${SELECT_WITH_VOTES} WHERE c.guild_id = ? AND c.status = 'active' ORDER BY c.created_at DESC, c.id DESC LIMIT ?`);
		this.selectActiveByAuthor = db.prepare(
			`${SELECT_WITH_VOTES} WHERE c.guild_id = ? AND c.author_id = ? AND c.status = 'active' ORDER BY c.created_at DESC, c.id DESC LIMIT ?`,
		);
		this.countByAuthor = db.prepare("SELECT COUNT(*) AS n FROM contributions WHERE guild_id = ? AND author_id = ? AND status = 'active'");
		this.selectActiveBySource = db.prepare("SELECT id FROM contributions WHERE guild_id = ? AND source_message_id = ? AND status = 'active'");
		this.updateMessage = db.prepare("UPDATE contributions SET channel_id = ?, message_id = ? WHERE guild_id = ? AND id = ?");
		this.updateRemoved = db.prepare("UPDATE contributions SET status = 'removed', removed_at = ?, removed_by = ? WHERE guild_id = ? AND id = ?");
		this.selectVote = db.prepare(`
			SELECT v.event_id, e.voided_at
			FROM contribution_votes v
			JOIN contribution_events e ON e.id = v.event_id
			WHERE v.contribution_id = ? AND v.voter_id = ?`);
		this.insertVoteRow = db.prepare("INSERT INTO contribution_votes (contribution_id, voter_id, event_id, created_at) VALUES (?, ?, ?, ?)");
		this.deleteVoteRow = db.prepare("DELETE FROM contribution_votes WHERE contribution_id = ? AND voter_id = ?");
	}

	/** Trả về id của contribution vừa tạo. */
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

	listActive(guildId: string, limit: number): ContributionRow[]
	{
		return this.selectActive.all(guildId, limit);
	}

	listActiveByAuthor(guildId: string, authorId: string, limit: number): ContributionRow[]
	{
		return this.selectActiveByAuthor.all(guildId, authorId, limit);
	}

	countActiveByAuthor(guildId: string, authorId: string): number
	{
		return this.countByAuthor.get(guildId, authorId)?.n ?? 0;
	}

	/** id của contribution còn hiệu lực có tin nhắn nguồn này trong guild, hoặc null nếu chưa có. */
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

	/** Lượt ghi nhận của người này (kể cả lượt có điểm đã bị huỷ), hoặc null nếu chưa từng ghi nhận. */
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
}
