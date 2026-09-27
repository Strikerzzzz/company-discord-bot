import { Statement } from "better-sqlite3";
import { Db } from "../../db/connection";
import { Clock } from "../../shared/clock";

export type LedgerKind = "xp" | "contribution";

/**
 * Điều kiện "điểm kiếm được" cho bảng xếp hạng theo kỳ: loại event điều chỉnh tự động của hệ thống, tức event
 * nguồn 'admin' không có actor. Hiện chỉ có event bù của PROP-024 (ContributionService.compensateNegative) mang dạng
 * này; event admin thật luôn ghi actor_id. Event bù mang thời điểm lúc bù chứ không phải lúc kiếm điểm, nên nếu tính
 * vào kỳ thì người vừa bị gỡ contribution (tổng 0) lại lên top tuần/tháng. Người phụ trách đã chốt bảng kỳ tính theo
 * điểm kiếm được trong kỳ. Không áp dụng cho sumSince (giới hạn XP vote theo nguồn), total hay bảng "all".
 * Tham số `alias` là hằng số trong code (không phải input).
 */
function earnedOnly(alias = ""): string
{
	return `(${alias}source <> 'admin' OR ${alias}actor_id IS NOT NULL)`;
}

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
	private readonly selectPosition: Statement<[string, string], { position: number }>;
	private readonly countRankedStmt: Statement<[string], { n: number }>;
	private readonly selectTop: Statement<[string, number, number], RankedEntry>;
	private readonly selectTopTeams: Statement<[string, number, number], RankedEntry>;
	private readonly countTeamsStmt: Statement<[string], { n: number }>;
	private readonly selectRecent: Statement<[string, string, number], EventRow>;
	private readonly selectSumSince: Statement<[string, string, string, number], { total: number }>;
	private readonly selectTopSince: Statement<[string, number, number, number], RankedEntry>;
	private readonly countRankedSinceStmt: Statement<[string, number], { n: number }>;
	private readonly selectRankSince: Statement<[string, number, string], { total: number; totalRanked: number; higher: number }>;
	private readonly selectPositionSince: Statement<[string, number, string], { position: number }>;
	private readonly selectTopTeamsSince: Statement<[string, number, number, number], RankedEntry>;
	private readonly countTeamsSinceStmt: Statement<[string, number], { n: number }>;
	private readonly selectActiveDays: Statement<[string, string, string], { day: number }>;
	private readonly countEventsStmt: Statement<[string, string, string], { n: number }>;

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
		// Vị trí trong đúng thứ tự của selectTop (total DESC, user_id ASC): số người điểm cao hơn cộng số người cùng điểm
		// có user_id nhỏ hơn. Không có dòng nếu người đó không có tổng dương.
		this.selectPosition = db.prepare(`
			SELECT
				(SELECT COUNT(*) FROM ${t.members} o WHERE o.guild_id = m.guild_id AND o.total > m.total)
				+ (SELECT COUNT(*) FROM ${t.members} o WHERE o.guild_id = m.guild_id AND o.total = m.total AND o.user_id < m.user_id) AS position
			FROM ${t.members} m
			WHERE m.guild_id = ? AND m.user_id = ? AND m.total > 0`);
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

		// Bảng xếp hạng theo kỳ (DEC-029) tính thẳng từ ledger, chỉ từ điểm kiếm được trong kỳ (earnedOnly, bỏ event bù
		// tự động). Điều kiện "voided_at IS NULL" phải có trong mọi câu để dùng được các partial index của migration 3
		// (idx_*_events_period, idx_xp_events_user_source).
		// Lưu ý: SQLite không coi partial index "WHERE voided_at IS NULL" là covering (cột voided_at không nằm trong
		// index), nên mỗi event trong kỳ vẫn phải đọc dòng của bảng; điều kiện trên source và actor_id đọc từ chính dòng
		// đó, query plan không đổi (đo với 200k event: bảng cá nhân tháng 26 → 28 ms, bảng team tháng 57 → 61 ms).
		// Planner có thể chọn idx_*_created thay cho idx_*_events_period vì hai index cho cùng một khoảng
		// (guild_id, created_at).
		const periodTotals = `
			SELECT user_id, SUM(amount) AS total
			FROM ${t.events}
			WHERE guild_id = ? AND created_at >= ? AND voided_at IS NULL AND ${earnedOnly()}
			GROUP BY user_id`;
		this.selectTopSince = db.prepare(`
			SELECT user_id AS id, total, RANK() OVER (ORDER BY total DESC) AS rank
			FROM (${periodTotals})
			WHERE total > 0
			ORDER BY total DESC, user_id ASC
			LIMIT ? OFFSET ?`);
		this.countRankedSinceStmt = db.prepare(`SELECT COUNT(*) AS n FROM (${periodTotals}) WHERE total > 0`);
		// Quét ledger một lần: tổng theo người được materialize rồi mới đếm, nên hạng khớp với RANK() của selectTopSince.
		this.selectRankSince = db.prepare(`
			WITH totals AS MATERIALIZED (${periodTotals}),
			mine AS (SELECT COALESCE((SELECT total FROM totals WHERE user_id = ?), 0) AS total)
			SELECT
				mine.total AS total,
				(SELECT COUNT(*) FROM totals WHERE total > 0) AS totalRanked,
				(SELECT COUNT(*) FROM totals WHERE total > mine.total) AS higher
			FROM mine`);
		// Vị trí trong đúng thứ tự của selectTopSince, cũng chỉ quét ledger một lần (tổng theo người được materialize).
		this.selectPositionSince = db.prepare(`
			WITH totals AS MATERIALIZED (${periodTotals})
			SELECT
				(SELECT COUNT(*) FROM totals o WHERE o.total > mine.total)
				+ (SELECT COUNT(*) FROM totals o WHERE o.total = mine.total AND o.user_id < mine.user_id) AS position
			FROM totals mine
			WHERE mine.user_id = ? AND mine.total > 0`);

		// CROSS JOIN cố định thứ tự vòng lặp: event trong kỳ → snapshot team của event → kiểm tra team đang cấu hình.
		// Nếu để planner tự chọn, nó đặt team_roles trước snapshot và tra (event, role) cho mọi team với từng event,
		// chậm hơn khoảng 3 lần với 100k event trong kỳ.
		const periodTeamTotals = `
			SELECT et.role_id AS role_id, SUM(e.amount) AS total
			FROM ${t.events} e
			CROSS JOIN ${t.teams} et ON et.event_id = e.id
			CROSS JOIN team_roles r ON r.guild_id = e.guild_id AND r.role_id = et.role_id
			WHERE e.guild_id = ? AND e.created_at >= ? AND e.voided_at IS NULL AND ${earnedOnly("e.")}
			GROUP BY et.role_id`;
		this.selectTopTeamsSince = db.prepare(`
			SELECT role_id AS id, total, RANK() OVER (ORDER BY total DESC) AS rank
			FROM (${periodTeamTotals})
			WHERE total > 0
			ORDER BY total DESC, role_id ASC
			LIMIT ? OFFSET ?`);
		this.countTeamsSinceStmt = db.prepare(`SELECT COUNT(*) AS n FROM (${periodTeamTotals}) WHERE total > 0`);

		// Cùng công thức với vnDayNumber (src/shared/time.ts): created_at là số nguyên dương nên phép chia nguyên là floor.
		this.selectActiveDays = db.prepare(`
			SELECT DISTINCT (created_at + 25200000) / 86400000 AS day
			FROM ${t.events}
			WHERE guild_id = ? AND user_id = ? AND source = ? AND voided_at IS NULL
			ORDER BY day DESC`);
		this.countEventsStmt = db.prepare(`
			SELECT COUNT(*) AS n
			FROM ${t.events}
			WHERE guild_id = ? AND user_id = ? AND source = ? AND voided_at IS NULL`);
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

	/**
	 * Vị trí 0-based của một người trong thứ tự hiển thị của top (tổng giảm dần, hoà điểm theo user_id tăng dần);
	 * null nếu người đó không có tổng dương. Khác với hạng: người hoà điểm cùng hạng nhưng khác vị trí.
	 */
	position(guildId: string, userId: string): number | null
	{
		return this.selectPosition.get(guildId, userId)?.position ?? null;
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

	/**
	 * Xếp hạng cá nhân theo kỳ (DEC-029): tổng điểm kiếm được trong kỳ, tức các event chưa huỷ có created_at >= since
	 * (ms, tính cả mốc), trừ event bù tự động (nguồn 'admin' không có actor, PROP-024); chỉ người có tổng > 0. Hạng và
	 * thứ tự theo cùng quy tắc với top (hoà điểm cùng hạng, hiển thị theo user_id). countRankedSince, rankSince,
	 * positionSince, topTeamsSince và countTeamsSince dùng cùng cách tính điểm của kỳ; sumSince thì không.
	 */
	topSince(guildId: string, since: number, limit: number, offset = 0): RankedEntry[]
	{
		return this.selectTopSince.all(guildId, since, limit, offset);
	}

	/** Số người có tổng > 0 trong kỳ bắt đầu từ since. */
	countRankedSince(guildId: string, since: number): number
	{
		return this.countRankedSinceStmt.get(guildId, since)?.n ?? 0;
	}

	/**
	 * Hạng và tổng trong kỳ của một người, nhất quán với topSince: rank = 1 + số người có tổng lớn hơn;
	 * null nếu tổng trong kỳ <= 0. totalRanked = countRankedSince.
	 */
	rankSince(guildId: string, userId: string, since: number): { rank: number | null; total: number; totalRanked: number }
	{
		const row = this.selectRankSince.get(guildId, since, userId);
		const total = row?.total ?? 0;
		const totalRanked = row?.totalRanked ?? 0;
		return { rank: total > 0 ? (row?.higher ?? 0) + 1 : null, total, totalRanked };
	}

	/** Như position nhưng theo kỳ bắt đầu từ since, khớp thứ tự của topSince; chỉ quét ledger của kỳ một lần. */
	positionSince(guildId: string, userId: string, since: number): number | null
	{
		return this.selectPositionSince.get(guildId, since, userId)?.position ?? null;
	}

	/**
	 * Xếp hạng team theo kỳ: tổng điểm kiếm được trong kỳ (như topSince) theo snapshot team (DEC-024), chỉ team đang
	 * được cấu hình và có tổng > 0. Cùng quy tắc hạng và thứ tự với topTeams.
	 */
	topTeamsSince(guildId: string, since: number, limit: number, offset = 0): RankedEntry[]
	{
		return this.selectTopTeamsSince.all(guildId, since, limit, offset);
	}

	/** Số team đang cấu hình có tổng > 0 trong kỳ bắt đầu từ since. */
	countTeamsSince(guildId: string, since: number): number
	{
		return this.countTeamsSinceStmt.get(guildId, since)?.n ?? 0;
	}

	/**
	 * Các ngày (số thứ tự ngày giờ Việt Nam, xem vnDayNumber) có ít nhất một event chưa huỷ của nguồn `source`,
	 * không trùng, giảm dần. Dùng cho chuỗi ngày hoạt động (DEC-029).
	 */
	activeDays(guildId: string, userId: string, source: string): number[]
	{
		return this.selectActiveDays.all(guildId, userId, source).map(row => row.day);
	}

	/** Số event chưa huỷ của một nguồn. */
	countEvents(guildId: string, userId: string, source: string): number
	{
		return this.countEventsStmt.get(guildId, userId, source)?.n ?? 0;
	}

	/** Các event gần nhất của một người (kể cả event đã huỷ), mới nhất trước. */
	recent(guildId: string, userId: string, limit: number): LedgerEvent[]
	{
		return this.selectRecent.all(guildId, userId, limit).map(toEvent);
	}
}
