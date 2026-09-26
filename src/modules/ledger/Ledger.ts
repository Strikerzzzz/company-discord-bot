import { Statement } from "better-sqlite3";
import { Db } from "../../db/connection";
import { Clock } from "../../shared/clock";

export type LedgerKind = "xp" | "contribution";

// Tên bảng là hằng số trong code (không phải input), nên được phép ghép vào câu SQL.
const TABLES = {
	xp: { events: "xp_events", teams: "xp_event_teams", members: "member_xp" },
	contribution: { events: "contribution_events", teams: "contribution_event_teams", members: "member_contribution" },
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

export interface RankedEntry
{
	id: string;
	total: number;
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
 * Sổ cái điểm (PROP-014): mọi biến động là một dòng append-only; bảng member_* là cache tổng,
 * luôn được cập nhật trong cùng transaction với ledger. Reset/gỡ chỉ đánh dấu voided_at (DEC-027).
 * Hai instance tách biệt cho "xp" và "contribution" — không bao giờ cộng gộp (DEC-004).
 */
export class Ledger
{
	private readonly insertEvent: Statement<[string, string, number, string, string | null, string | null, string | null, number]>;
	private readonly insertTeam: Statement<[number, string]>;
	private readonly addToMember: Statement<[string, string, number]>;
	private readonly selectEvent: Statement<[number], EventRow>;
	private readonly markVoided: Statement<[number, number]>;
	private readonly selectTotal: Statement<[string, string], { total: number }>;

	constructor(private readonly db: Db, readonly kind: LedgerKind, private readonly clock: Clock)
	{
		const t = TABLES[kind];
		this.insertEvent = db.prepare(`INSERT INTO ${t.events} (guild_id, user_id, amount, source, reference_id, actor_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
		this.insertTeam = db.prepare(`INSERT OR IGNORE INTO ${t.teams} (event_id, role_id) VALUES (?, ?)`);
		this.addToMember = db.prepare(`INSERT INTO ${t.members} (guild_id, user_id, total) VALUES (?, ?, ?) ON CONFLICT (guild_id, user_id) DO UPDATE SET total = total + excluded.total`);
		this.selectEvent = db.prepare(`SELECT * FROM ${t.events} WHERE id = ?`);
		this.markVoided = db.prepare(`UPDATE ${t.events} SET voided_at = ? WHERE id = ? AND voided_at IS NULL`);
		this.selectTotal = db.prepare(`SELECT total FROM ${t.members} WHERE guild_id = ? AND user_id = ?`);
	}

	private get tables(): (typeof TABLES)[LedgerKind]
	{
		return TABLES[this.kind];
	}

	/** Ghi một biến động điểm và cập nhật tổng. Chạy trong transaction (lồng được vào transaction của nơi gọi). */
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
			for (const roleId of new Set(input.teamRoleIds ?? [])) this.insertTeam.run(id, roleId);
			this.addToMember.run(input.guildId, input.userId, input.amount);
			return this.getEvent(id) as LedgerEvent;
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

	/** Huỷ một event (nếu chưa huỷ) và trừ khỏi tổng. Trả về event đã huỷ, hoặc null nếu không có gì để huỷ. */
	voidEvent(eventId: number): LedgerEvent | null
	{
		return this.db.transaction((): LedgerEvent | null =>
		{
			const event = this.getEvent(eventId);
			if (!event || event.voidedAt !== null) return null;
			this.markVoided.run(this.clock.now(), eventId);
			this.addToMember.run(event.guildId, event.userId, -event.amount);
			return this.getEvent(eventId);
		})();
	}

	/** Huỷ mọi event còn hiệu lực có cùng reference_id (ví dụ mọi điểm của một contribution). Trả về số event đã huỷ. */
	voidByReference(guildId: string, referenceId: string): number
	{
		const ids = this.db.prepare<[string, string], { id: number }>(
			`SELECT id FROM ${this.tables.events} WHERE guild_id = ? AND reference_id = ? AND voided_at IS NULL`,
		).all(guildId, referenceId);
		return this.db.transaction((): number => ids.filter(({ id }) => this.voidEvent(id) !== null).length)();
	}

	/** Reset điểm của một người: huỷ mọi event còn hiệu lực, đưa tổng về 0. Trả về số event đã huỷ. */
	voidUser(guildId: string, userId: string): number
	{
		return this.db.transaction((): number =>
		{
			const t = this.tables;
			const result = this.db.prepare(`UPDATE ${t.events} SET voided_at = ? WHERE guild_id = ? AND user_id = ? AND voided_at IS NULL`)
				.run(this.clock.now(), guildId, userId);
			this.db.prepare(`UPDATE ${t.members} SET total = 0 WHERE guild_id = ? AND user_id = ?`).run(guildId, userId);
			return result.changes;
		})();
	}

	/** Reset điểm của cả guild. Trả về số event đã huỷ và số thành viên từng có điểm khác 0. */
	voidGuild(guildId: string): { events: number; members: number }
	{
		return this.db.transaction((): { events: number; members: number } =>
		{
			const t = this.tables;
			const members = this.db.prepare(`UPDATE ${t.members} SET total = 0 WHERE guild_id = ? AND total <> 0`).run(guildId).changes;
			const events = this.db.prepare(`UPDATE ${t.events} SET voided_at = ? WHERE guild_id = ? AND voided_at IS NULL`)
				.run(this.clock.now(), guildId).changes;
			return { events, members };
		})();
	}

	/** Hạng của một người trong guild (chỉ tính người có tổng > 0). rank = null nếu người đó chưa có điểm. */
	rank(guildId: string, userId: string): { rank: number | null; totalRanked: number }
	{
		const t = this.tables;
		const totalRanked = this.countRanked(guildId);
		const mine = this.total(guildId, userId);
		if (mine <= 0) return { rank: null, totalRanked };
		const higher = this.db.prepare<[string, number], { n: number }>(`SELECT COUNT(*) AS n FROM ${t.members} WHERE guild_id = ? AND total > ?`)
			.get(guildId, mine)?.n ?? 0;
		return { rank: higher + 1, totalRanked };
	}

	/** Xếp hạng cá nhân: tổng giảm dần, hoà thì theo user_id. */
	top(guildId: string, limit: number, offset = 0): RankedEntry[]
	{
		return this.db.prepare<[string, number, number], RankedEntry>(
			`SELECT user_id AS id, total FROM ${this.tables.members} WHERE guild_id = ? AND total > 0 ORDER BY total DESC, user_id ASC LIMIT ? OFFSET ?`,
		).all(guildId, limit, offset);
	}

	countRanked(guildId: string): number
	{
		return this.db.prepare<[string], { n: number }>(`SELECT COUNT(*) AS n FROM ${this.tables.members} WHERE guild_id = ? AND total > 0`)
			.get(guildId)?.n ?? 0;
	}

	private teamTotalsQuery(): string
	{
		const t = this.tables;
		return `
			SELECT et.role_id AS id, SUM(e.amount) AS total
			FROM ${t.teams} et
			JOIN ${t.events} e ON e.id = et.event_id
			JOIN team_roles r ON r.guild_id = e.guild_id AND r.role_id = et.role_id
			WHERE e.guild_id = ? AND e.voided_at IS NULL
			GROUP BY et.role_id
			HAVING SUM(e.amount) > 0`;
	}

	/** Điểm team = tổng điểm theo snapshot team (DEC-024), chỉ tính các team đang được cấu hình. */
	teamTotals(guildId: string, limit: number, offset = 0): RankedEntry[]
	{
		return this.db.prepare<[string, number, number], RankedEntry>(`${this.teamTotalsQuery()} ORDER BY total DESC, id ASC LIMIT ? OFFSET ?`)
			.all(guildId, limit, offset);
	}

	countTeams(guildId: string): number
	{
		return this.db.prepare<[string], { n: number }>(`SELECT COUNT(*) AS n FROM (${this.teamTotalsQuery()})`).get(guildId)?.n ?? 0;
	}

	/** Các event gần nhất của một người (kể cả event đã huỷ), mới nhất trước. */
	recent(guildId: string, userId: string, limit: number): LedgerEvent[]
	{
		return this.db.prepare<[string, string, number], EventRow>(
			`SELECT * FROM ${this.tables.events} WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
		).all(guildId, userId, limit).map(toEvent);
	}
}
