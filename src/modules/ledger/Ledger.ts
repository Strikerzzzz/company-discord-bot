import { Statement } from "better-sqlite3";
import { Db } from "../../db/connection";
import { Clock } from "../../shared/clock";

export type LedgerKind = "xp" | "contribution";

// Tên bảng là hằng số trong code (không phải input), nên được phép ghép vào câu SQL.
const TABLES = {
	xp: { events: "xp_events", teams: "xp_event_teams", members: "member_xp", teamTotals: "xp_team_totals" },
	contribution: {
		events: "contribution_events",
		teams: "contribution_event_teams",
		members: "member_contribution",
		teamTotals: "contribution_team_totals",
	},
} as const;

export interface LedgerEntryInput
{
	guildId: string;
	userId: string;
	amount: number;
	/** xp: 'message' | 'poll' | 'admin'; contribution: 'vote' | 'admin' (CHECK trong schema). */
	source: string;
	referenceId?: string | null;
	actorId?: string | null;
	reason?: string | null;
	/** Role team của người nhận điểm tại thời điểm phát sinh (DEC-024). */
	teamRoleIds?: readonly string[];
}

export interface LedgerEvent
{
	id: number;
	guildId: string;
	userId: string;
	amount: number;
	source: string;
	referenceId: string | null;
	actorId: string | null;
	reason: string | null;
	createdAt: number;
	voidedAt: number | null;
}

/** Tổng điểm của một người (id = user ID) hoặc một team (id = role ID). */
export interface TotalEntry
{
	id: string;
	total: number;
}

/**
 * Một dòng bảng xếp hạng. Hạng kiểu competition ranking, tính trên toàn bộ bảng trước khi phân trang:
 * hoà điểm thì cùng hạng và hạng kế tiếp nhảy cóc (1, 1, 3), khớp với cách Ledger.rank tính hạng một người.
 */
export interface RankedEntry extends TotalEntry
{
	rank: number;
}

interface EventRow
{
	id: number;
	guild_id: string;
	user_id: string;
	amount: number;
	source: string;
	reference_id: string | null;
	actor_id: string | null;
	reason: string | null;
	created_at: number;
	voided_at: number | null;
}

function toEvent(row: EventRow): LedgerEvent
{
	return {
		id: row.id,
		guildId: row.guild_id,
		userId: row.user_id,
		amount: row.amount,
		source: row.source,
		referenceId: row.reference_id,
		actorId: row.actor_id,
		reason: row.reason,
		createdAt: row.created_at,
		voidedAt: row.voided_at,
	};
}

/**
 * Sổ cái điểm (PROP-014): mọi biến động là một dòng append-only. Hai bảng cache luôn được cập nhật trong cùng
 * transaction với ledger: member_* (tổng theo người) và *_team_totals (tổng theo role trong snapshot team, DEC-024).
 * Reset/gỡ chỉ đánh dấu voided_at (DEC-027).
 * Hai instance tách biệt cho "xp" và "contribution" — không bao giờ cộng gộp (DEC-004).
 */
export class Ledger
{
	private readonly insertEvent: Statement<[string, string, number, string, string | null, string | null, string | null, number]>;
	private readonly insertTeam: Statement<[number, string]>;
	private readonly addToMember: Statement<[string, string, number]>;
	private readonly addToTeam: Statement<[string, string, number]>;
	private readonly selectEvent: Statement<[number], EventRow>;
	private readonly markVoided: Statement<[number, number]>;
	private readonly selectTotal: Statement<[string, string], { total: number }>;
	private readonly selectActiveByReference: Statement<[string, string], { id: number }>;
	private readonly subtractEventFromTeams: Statement<[number]>;
	private readonly subtractUserFromTeams: Statement<[string, string]>;
	private readonly markUserVoided: Statement<[number, string, string]>;
	private readonly resetMember: Statement<[string, string]>;
	private readonly markGuildVoided: Statement<[number, string]>;
	private readonly resetGuildMembers: Statement<[string]>;
	private readonly resetGuildTeams: Statement<[string]>;
	private readonly countHigher: Statement<[string, number], { n: number }>;
	private readonly countRankedStmt: Statement<[string], { n: number }>;
	private readonly selectTop: Statement<[string, number, number], RankedEntry>;
	private readonly selectTopTeams: Statement<[string, number, number], RankedEntry>;
	private readonly countTeamsStmt: Statement<[string], { n: number }>;
	private readonly selectRecent: Statement<[string, string, number], EventRow>;
	private readonly selectSumSince: Statement<[string, string, string, number], { total: number }>;

	constructor(private readonly db: Db, readonly kind: LedgerKind, private readonly clock: Clock)
	{
		const t = TABLES[kind];
		this.insertEvent = db.prepare(`INSERT INTO ${t.events} (guild_id, user_id, amount, source, reference_id, actor_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
		this.insertTeam = db.prepare(`INSERT OR IGNORE INTO ${t.teams} (event_id, role_id) VALUES (?, ?)`);
		this.addToMember = db.prepare(`INSERT INTO ${t.members} (guild_id, user_id, total) VALUES (?, ?, ?) ON CONFLICT (guild_id, user_id) DO UPDATE SET total = total + excluded.total`);
		this.addToTeam = db.prepare(`INSERT INTO ${t.teamTotals} (guild_id, role_id, total) VALUES (?, ?, ?) ON CONFLICT (guild_id, role_id) DO UPDATE SET total = total + excluded.total`);
		this.selectEvent = db.prepare(`SELECT * FROM ${t.events} WHERE id = ?`);
		this.markVoided = db.prepare(`UPDATE ${t.events} SET voided_at = ? WHERE id = ? AND voided_at IS NULL`);
		this.selectTotal = db.prepare(`SELECT total FROM ${t.members} WHERE guild_id = ? AND user_id = ?`);
		this.selectActiveByReference = db.prepare(`SELECT id FROM ${t.events} WHERE guild_id = ? AND reference_id = ? AND voided_at IS NULL ORDER BY id`);

		// Trừ khỏi tổng team phần điểm của các event (chưa huỷ) thoả điều kiện, theo snapshot team của từng event.
		// Dùng upsert để đúng cả khi dòng tổng team chưa tồn tại. SELECT phải có WHERE để upsert không bị hiểu nhầm là JOIN ... ON.
		const subtractFromTeams = (where: string): string => `
			INSERT INTO ${t.teamTotals} (guild_id, role_id, total)
			SELECT e.guild_id, et.role_id, -SUM(e.amount)
			FROM ${t.events} e
			JOIN ${t.teams} et ON et.event_id = e.id
			WHERE ${where}
			GROUP BY e.guild_id, et.role_id
			ON CONFLICT (guild_id, role_id) DO UPDATE SET total = total + excluded.total`;
		this.subtractEventFromTeams = db.prepare(subtractFromTeams("e.id = ? AND e.voided_at IS NULL"));
		this.subtractUserFromTeams = db.prepare(subtractFromTeams("e.guild_id = ? AND e.user_id = ? AND e.voided_at IS NULL"));

		this.markUserVoided = db.prepare(`UPDATE ${t.events} SET voided_at = ? WHERE guild_id = ? AND user_id = ? AND voided_at IS NULL`);
		this.resetMember = db.prepare(`UPDATE ${t.members} SET total = 0 WHERE guild_id = ? AND user_id = ?`);
		this.markGuildVoided = db.prepare(`UPDATE ${t.events} SET voided_at = ? WHERE guild_id = ? AND voided_at IS NULL`);
		this.resetGuildMembers = db.prepare(`UPDATE ${t.members} SET total = 0 WHERE guild_id = ? AND total <> 0`);
		this.resetGuildTeams = db.prepare(`UPDATE ${t.teamTotals} SET total = 0 WHERE guild_id = ? AND total <> 0`);

		this.countHigher = db.prepare(`SELECT COUNT(*) AS n FROM ${t.members} WHERE guild_id = ? AND total > ?`);
		this.countRankedStmt = db.prepare(`SELECT COUNT(*) AS n FROM ${t.members} WHERE guild_id = ? AND total > 0`);
		// Window function chạy trên toàn bộ dòng thoả WHERE rồi mới tới LIMIT/OFFSET, nên hạng đúng ở mọi trang.
		this.selectTop = db.prepare(`
			SELECT user_id AS id, total, RANK() OVER (ORDER BY total DESC) AS rank
			FROM ${t.members}
			WHERE guild_id = ? AND total > 0
			ORDER BY total DESC, user_id ASC
			LIMIT ? OFFSET ?`);
		this.selectTopTeams = db.prepare(`
			SELECT tt.role_id AS id, tt.total AS total, RANK() OVER (ORDER BY tt.total DESC) AS rank
			FROM ${t.teamTotals} tt
			JOIN team_roles r ON r.guild_id = tt.guild_id AND r.role_id = tt.role_id
			WHERE tt.guild_id = ? AND tt.total > 0
			ORDER BY tt.total DESC, tt.role_id ASC
			LIMIT ? OFFSET ?`);
		this.countTeamsStmt = db.prepare(`
			SELECT COUNT(*) AS n
			FROM ${t.teamTotals} tt
			JOIN team_roles r ON r.guild_id = tt.guild_id AND r.role_id = tt.role_id
			WHERE tt.guild_id = ? AND tt.total > 0`);
		this.selectRecent = db.prepare(`SELECT * FROM ${t.events} WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`);
		this.selectSumSince = db.prepare(`
			SELECT COALESCE(SUM(amount), 0) AS total
			FROM ${t.events}
			WHERE guild_id = ? AND user_id = ? AND source = ? AND created_at >= ? AND voided_at IS NULL`);
	}

	/** Ghi một biến động điểm và cập nhật các tổng. Chạy trong transaction (lồng được vào transaction của nơi gọi). */
	record(input: LedgerEntryInput): LedgerEvent
	{
		return this.db.transaction((): LedgerEvent =>
		{
			const now = this.clock.now();
			const result = this.insertEvent.run(
				input.guildId, input.userId, input.amount, input.source,
				input.referenceId ?? null, input.actorId ?? null, input.reason ?? null, now,
			);
			const id = Number(result.lastInsertRowid);
			for (const roleId of new Set(input.teamRoleIds ?? []))
			{
				if (this.insertTeam.run(id, roleId).changes > 0) this.addToTeam.run(input.guildId, roleId, input.amount);
			}
			this.addToMember.run(input.guildId, input.userId, input.amount);

			const event = this.getEvent(id);
			if (!event) throw new Error(`Không đọc lại được event ${id} (${this.kind}) vừa ghi.`);
			return event;
		})();
	}

	getEvent(id: number): LedgerEvent | null
	{
		const row = this.selectEvent.get(id);
		return row ? toEvent(row) : null;
	}

	total(guildId: string, userId: string): number
	{
		return this.selectTotal.get(guildId, userId)?.total ?? 0;
	}

	/** Huỷ một event (nếu chưa huỷ) và trừ khỏi các tổng. Trả về event đã huỷ, hoặc null nếu không có gì để huỷ. */
	voidEvent(eventId: number): LedgerEvent | null
	{
		return this.db.transaction((): LedgerEvent | null =>
		{
			const event = this.getEvent(eventId);
			if (!event || event.voidedAt !== null) return null;
			// Trừ tổng team trước khi đánh dấu huỷ, vì câu lệnh chỉ tính event chưa huỷ.
			this.subtractEventFromTeams.run(eventId);
			this.markVoided.run(this.clock.now(), eventId);
			this.addToMember.run(event.guildId, event.userId, -event.amount);
			return this.getEvent(eventId);
		})();
	}

	/** Huỷ mọi event còn hiệu lực có cùng reference_id (ví dụ mọi điểm của một contribution). Trả về số event đã huỷ. */
	voidByReference(guildId: string, referenceId: string): number
	{
		return this.db.transaction((): number =>
		{
			const ids = this.selectActiveByReference.all(guildId, referenceId);
			return ids.filter(({ id }) => this.voidEvent(id) !== null).length;
		})();
	}

	/** Reset điểm của một người: huỷ mọi event còn hiệu lực, đưa tổng về 0 và trừ phần của người đó khỏi tổng team. Trả về số event đã huỷ. */
	voidUser(guildId: string, userId: string): number
	{
		return this.db.transaction((): number =>
		{
			this.subtractUserFromTeams.run(guildId, userId);
			const voided = this.markUserVoided.run(this.clock.now(), guildId, userId).changes;
			this.resetMember.run(guildId, userId);
			return voided;
		})();
	}

	/** Reset điểm của cả guild. Trả về số event đã huỷ và số thành viên từng có điểm khác 0. */
	voidGuild(guildId: string): { events: number; members: number }
	{
		return this.db.transaction((): { events: number; members: number } =>
		{
			const members = this.resetGuildMembers.run(guildId).changes;
			this.resetGuildTeams.run(guildId);
			const events = this.markGuildVoided.run(this.clock.now(), guildId).changes;
			return { events, members };
		})();
	}

	/** Hạng của một người trong guild (chỉ tính người có tổng > 0). rank = null nếu người đó chưa có điểm. */
	rank(guildId: string, userId: string): { rank: number | null; totalRanked: number }
	{
		const totalRanked = this.countRanked(guildId);
		const mine = this.total(guildId, userId);
		if (mine <= 0) return { rank: null, totalRanked };
		const higher = this.countHigher.get(guildId, mine)?.n ?? 0;
		return { rank: higher + 1, totalRanked };
	}

	/** Xếp hạng cá nhân (chỉ người có tổng > 0): tổng giảm dần, hoà thì cùng hạng và hiển thị theo user_id. */
	top(guildId: string, limit: number, offset = 0): RankedEntry[]
	{
		return this.selectTop.all(guildId, limit, offset);
	}

	countRanked(guildId: string): number
	{
		return this.countRankedStmt.get(guildId)?.n ?? 0;
	}

	/**
	 * Xếp hạng team: điểm team = tổng điểm theo snapshot team (DEC-024), chỉ tính các team đang được cấu hình
	 * và có tổng > 0. Đọc từ bảng cache nên không phụ thuộc số lượng event.
	 */
	topTeams(guildId: string, limit: number, offset = 0): RankedEntry[]
	{
		return this.selectTopTeams.all(guildId, limit, offset);
	}

	/** Như topTeams nhưng chỉ lấy tổng, không kèm hạng. */
	teamTotals(guildId: string, limit: number, offset = 0): TotalEntry[]
	{
		return this.topTeams(guildId, limit, offset).map(({ id, total }) => ({ id, total }));
	}

	countTeams(guildId: string): number
	{
		return this.countTeamsStmt.get(guildId)?.n ?? 0;
	}

	/** Tổng điểm từ các event chưa huỷ của một nguồn, phát sinh từ thời điểm `since` (ms, tính cả mốc) trở đi. */
	sumSince(guildId: string, userId: string, source: string, since: number): number
	{
		return this.selectSumSince.get(guildId, userId, source, since)?.total ?? 0;
	}

	/** Các event gần nhất của một người (kể cả event đã huỷ), mới nhất trước. */
	recent(guildId: string, userId: string, limit: number): LedgerEvent[]
	{
		return this.selectRecent.all(guildId, userId, limit).map(toEvent);
	}
}
