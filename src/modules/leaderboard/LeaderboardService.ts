import { ServiceDeps } from "../deps";
import { Ledger, RankedEntry } from "../ledger/Ledger";
import { startOfVnMonth, startOfVnWeek } from "../../shared/time";

export type ScoreKind = "activity" | "contribution";

export type LeaderboardScope = "individual" | "team";

/**
 * Kỳ xếp hạng (DEC-029): "all" = tổng từ trước tới nay; "week" = từ 00:00 thứ Hai; "month" = từ 00:00 ngày 1,
 * theo giờ Việt Nam (src/shared/time.ts). Điểm của kỳ = điểm kiếm được trong kỳ: tổng các event chưa huỷ phát sinh
 * trong kỳ, không tính event bù tự động của PROP-024 (xem Ledger.topSince).
 */
export type LeaderboardPeriod = "all" | "week" | "month";

export interface LeaderboardEntry
{
	/** Hạng kiểu competition ranking (hoà điểm thì cùng hạng: 1, 1, 3), khớp với hạng trong /rank. */
	rank: number;
	/** User ID (cá nhân) hoặc role ID (team). */
	id: string;
	/** Điểm trong kỳ: tổng (period "all") hoặc tổng phát sinh trong kỳ. */
	value: number;
}

export interface LeaderboardPage
{
	entries: LeaderboardEntry[];
	page: number;
	totalPages: number;
	totalEntries: number;
	period: LeaderboardPeriod;
	/** Mốc bắt đầu kỳ (ms UTC); null với period "all". */
	since: number | null;
}

export interface LeaderboardQuery
{
	guildId: string;
	kind: ScoreKind;
	scope: LeaderboardScope;
	period: LeaderboardPeriod;
	/** Trang bắt đầu từ 1; ngoài khoảng thì kẹp về trang hợp lệ gần nhất. */
	page: number;
	pageSize?: number;
}

/** Vị trí của một người trong một bảng xếp hạng cá nhân. */
export interface LeaderboardStanding
{
	/** null nếu người đó không có điểm dương trong kỳ. */
	rank: number | null;
	/** Điểm trong kỳ (có thể là 0). */
	value: number;
	/** Số người có điểm dương trong kỳ. */
	totalRanked: number;
}

export interface LeaderboardServiceApi
{
	/** Bảng cá nhân, kỳ "all". Giữ để tương thích; tương đương query({ scope: "individual", period: "all" }). */
	individual(guildId: string, kind: ScoreKind, page: number, pageSize?: number): LeaderboardPage;
	/** Bảng team, kỳ "all". Giữ để tương thích; tương đương query({ scope: "team", period: "all" }). */
	teams(guildId: string, kind: ScoreKind, page: number, pageSize?: number): LeaderboardPage;
	/**
	 * Một trang của 1 trong 12 bảng xếp hạng: Activity/Contribution × cá nhân/team × tổng/tuần/tháng.
	 * Chỉ tính điểm dương; bảng team chỉ gồm các team đang cấu hình (DEC-024).
	 */
	query(query: LeaderboardQuery): LeaderboardPage;
	/** Hạng và điểm của một người trong bảng cá nhân của một kỳ (kỳ "all" khớp với Ledger.rank). */
	userStanding(guildId: string, kind: ScoreKind, period: LeaderboardPeriod, userId: string): LeaderboardStanding;
	/**
	 * Vị trí 0-based của một người trong đúng thứ tự hiển thị của bảng cá nhân của một kỳ (điểm giảm dần, hoà điểm theo
	 * user ID tăng dần, chỉ điểm dương); null nếu người đó không có trên bảng. Trang có người đó (bắt đầu từ 1) là
	 * floor(position / pageSize) + 1. Kỳ "all" đọc bảng cache; kỳ tuần/tháng quét ledger của kỳ đúng một lần.
	 */
	userPosition(guildId: string, kind: ScoreKind, period: LeaderboardPeriod, userId: string): number | null;
}

export const DEFAULT_PAGE_SIZE = 10;

/** Không giới hạn số dòng khi đọc cả bảng của một kỳ (LIMIT của SQLite nhận số nguyên 64-bit). */
const ALL_ROWS = Number.MAX_SAFE_INTEGER;

type PeriodWindow = Pick<LeaderboardPage, "period" | "since">;

/** Bảng xếp hạng: hai loại điểm luôn tách biệt (DEC-004). */
export class LeaderboardService implements LeaderboardServiceApi
{
	constructor(private readonly deps: Pick<ServiceDeps, "clock" | "xpLedger" | "contributionLedger">)
	{}

	private ledger(kind: ScoreKind): Ledger
	{
		return kind === "activity" ? this.deps.xpLedger : this.deps.contributionLedger;
	}

	individual(guildId: string, kind: ScoreKind, page: number, pageSize = DEFAULT_PAGE_SIZE): LeaderboardPage
	{
		return this.query({ guildId, kind, scope: "individual", period: "all", page, pageSize });
	}

	teams(guildId: string, kind: ScoreKind, page: number, pageSize = DEFAULT_PAGE_SIZE): LeaderboardPage
	{
		return this.query({ guildId, kind, scope: "team", period: "all", page, pageSize });
	}

	query(query: LeaderboardQuery): LeaderboardPage
	{
		const { guildId, scope, period, page } = query;
		const ledger = this.ledger(query.kind);
		const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
		const since = this.periodStart(period);
		const window: PeriodWindow = { period, since };

		if (since === null)
		{
			// Kỳ "all" đọc từ bảng cache nên đếm và lấy trang đều rẻ.
			return scope === "individual"
				? paginate(ledger.countRanked(guildId), page, pageSize, window, (limit, offset) => ledger.top(guildId, limit, offset))
				: paginate(ledger.countTeams(guildId), page, pageSize, window, (limit, offset) => ledger.topTeams(guildId, limit, offset));
		}

		// Điểm theo kỳ phải cộng từ ledger. Đọc cả bảng của kỳ trong một lần quét rồi cắt trang trong bộ nhớ, thay vì
		// quét hai lần (đếm rồi lấy trang). Số dòng tối đa bằng số người (hoặc team) có điểm dương trong kỳ.
		const rows = scope === "individual"
			? ledger.topSince(guildId, since, ALL_ROWS)
			: ledger.topTeamsSince(guildId, since, ALL_ROWS);
		return paginate(rows.length, page, pageSize, window, (limit, offset) => rows.slice(offset, offset + limit));
	}

	userStanding(guildId: string, kind: ScoreKind, period: LeaderboardPeriod, userId: string): LeaderboardStanding
	{
		const ledger = this.ledger(kind);
		const since = this.periodStart(period);
		if (since === null)
		{
			const { rank, totalRanked } = ledger.rank(guildId, userId);
			return { rank, value: ledger.total(guildId, userId), totalRanked };
		}
		const { rank, total, totalRanked } = ledger.rankSince(guildId, userId, since);
		return { rank, value: total, totalRanked };
	}

	userPosition(guildId: string, kind: ScoreKind, period: LeaderboardPeriod, userId: string): number | null
	{
		const ledger = this.ledger(kind);
		const since = this.periodStart(period);
		return since === null ? ledger.position(guildId, userId) : ledger.positionSince(guildId, userId, since);
	}

	/** Mốc bắt đầu kỳ theo giờ Việt Nam tại thời điểm hiện tại; null với kỳ "all". */
	private periodStart(period: LeaderboardPeriod): number | null
	{
		if (period === "all") return null;
		const now = this.deps.clock.now();
		if (period === "week") return startOfVnWeek(now);
		if (period === "month") return startOfVnMonth(now);
		// Kiểu TypeScript không bảo vệ được giá trị đến từ customId của nút lúc chạy.
		throw new Error(`Kỳ xếp hạng không hợp lệ: ${String(period)}.`);
	}
}

function paginate(
	totalEntries: number,
	requestedPage: number,
	pageSize: number,
	window: PeriodWindow,
	fetch: (limit: number, offset: number) => RankedEntry[],
): LeaderboardPage
{
	const size = Math.max(1, Math.floor(pageSize));
	const totalPages = Math.max(1, Math.ceil(totalEntries / size));
	const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), totalPages);
	const offset = (page - 1) * size;
	// Hạng lấy từ ledger (tính trên toàn bảng), không suy ra từ vị trí trong trang, để người hoà điểm cùng hạng.
	const entries = fetch(size, offset).map(row => ({ rank: row.rank, id: row.id, value: row.total }));
	return { entries, page, totalPages, totalEntries, period: window.period, since: window.since };
}
