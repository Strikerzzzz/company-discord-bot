import { Statement } from "better-sqlite3";
import { Db } from "../../db/connection";

/** Một dòng contribution kèm số lượt ghi nhận hiện tại. */
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
	createdAt: number;
}

const SELECT_WITH_VOTES = `
	SELECT c.*, (SELECT COUNT(*) FROM contribution_votes v WHERE v.contribution_id = c.id) AS votes
	FROM contributions c`;

/** Truy cập SQL cho contribution; không chứa quy tắc nghiệp vụ. */
export class ContributionRepository
{
	private readonly insertContribution: Statement<[string, string, string, string, string, string, string | null, number]>;
	private readonly insertTeam: Statement<[number, string]>;
	private readonly selectTeams: Statement<[number], { role_id: string }>;
	private readonly selectById: Statement<[string, number], ContributionRow>;
	private readonly selectActive: Statement<[string, number], ContributionRow>;
	private readonly selectActiveByAuthor: Statement<[string, string, number], ContributionRow>;
	private readonly countByAuthor: Statement<[string, string], { n: number }>;
	private readonly updateMessage: Statement<[string, string, string, number]>;
	private readonly updateRemoved: Statement<[number, string, string, number]>;
	private readonly selectVote: Statement<[number, string], { event_id: number }>;
	private readonly insertVoteRow: Statement<[number, string, number, number]>;
	private readonly deleteVoteRow: Statement<[number, string]>;

	constructor(db: Db)
	{
		this.insertContribution = db.prepare(`
			INSERT INTO contributions (guild_id, author_id, submitted_by, title, description, category, link, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
		this.insertTeam = db.prepare("INSERT OR IGNORE INTO contribution_teams (contribution_id, role_id) VALUES (?, ?)");
		this.selectTeams = db.prepare("SELECT role_id FROM contribution_teams WHERE contribution_id = ? ORDER BY role_id");
		this.selectById = db.prepare(`${SELECT_WITH_VOTES} WHERE c.guild_id = ? AND c.id = ?`);
		this.selectActive = db.prepare(`${SELECT_WITH_VOTES} WHERE c.guild_id = ? AND c.status = 'active' ORDER BY c.created_at DESC, c.id DESC LIMIT ?`);
		this.selectActiveByAuthor = db.prepare(
			`${SELECT_WITH_VOTES} WHERE c.guild_id = ? AND c.author_id = ? AND c.status = 'active' ORDER BY c.created_at DESC, c.id DESC LIMIT ?`,
		);
		this.countByAuthor = db.prepare("SELECT COUNT(*) AS n FROM contributions WHERE guild_id = ? AND author_id = ? AND status = 'active'");
		this.updateMessage = db.prepare("UPDATE contributions SET channel_id = ?, message_id = ? WHERE guild_id = ? AND id = ?");
		this.updateRemoved = db.prepare("UPDATE contributions SET status = 'removed', removed_at = ?, removed_by = ? WHERE guild_id = ? AND id = ?");
		this.selectVote = db.prepare("SELECT event_id FROM contribution_votes WHERE contribution_id = ? AND voter_id = ?");
		this.insertVoteRow = db.prepare("INSERT INTO contribution_votes (contribution_id, voter_id, event_id, created_at) VALUES (?, ?, ?, ?)");
		this.deleteVoteRow = db.prepare("DELETE FROM contribution_votes WHERE contribution_id = ? AND voter_id = ?");
	}

	/** Trả về id của contribution vừa tạo. */
	insert(input: NewContribution): number
	{
		const result = this.insertContribution.run(
			input.guildId, input.authorId, input.submittedBy, input.title, input.description, input.category, input.link, input.createdAt,
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

	setMessage(guildId: string, contributionId: number, channelId: string, messageId: string): void
	{
		this.updateMessage.run(channelId, messageId, guildId, contributionId);
	}

	markRemoved(guildId: string, contributionId: number, removedAt: number, removedBy: string): void
	{
		this.updateRemoved.run(removedAt, removedBy, guildId, contributionId);
	}

	/** event_id của lượt ghi nhận, hoặc null nếu người này chưa ghi nhận. */
	findVoteEventId(contributionId: number, voterId: string): number | null
	{
		return this.selectVote.get(contributionId, voterId)?.event_id ?? null;
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
