import { ServiceDeps } from "../deps";
import { Ledger, RankedEntry } from "../ledger/Ledger";

export type ScoreKind = "activity" | "contribution";

export type LeaderboardScope = "individual" | "team";

/**
 * Kỳ xếp hạng (DEC-029): "all" = tổng từ trước tới nay; "week" = từ 00:00 thứ Hai; "month" = từ 00:00 ngày 1,
 * theo giờ Việt Nam (src/shared/time.ts). Điểm của kỳ = tổng các event chưa huỷ phát sinh trong kỳ.
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
}

export const DEFAULT_PAGE_SIZE = 10;

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
		const ledger = this.ledger(kind);
		return paginate(ledger.countRanked(guildId), page, pageSize, (limit, offset) => ledger.top(guildId, limit, offset));
	}

	teams(guildId: string, kind: ScoreKind, page: number, pageSize = DEFAULT_PAGE_SIZE): LeaderboardPage
	{
		const ledger = this.ledger(kind);
		return paginate(ledger.countTeams(guildId), page, pageSize, (limit, offset) => ledger.topTeams(guildId, limit, offset));
	}

	query(query: LeaderboardQuery): LeaderboardPage
	{
		throw new Error(`Chưa triển khai: LeaderboardService.query (${query.period}).`);
	}

	userStanding(guildId: string, kind: ScoreKind, period: LeaderboardPeriod, userId: string): LeaderboardStanding
	{
		throw new Error(`Chưa triển khai: LeaderboardService.userStanding (${guildId}, ${kind}, ${period}, ${userId}).`);
	}
}

function paginate(
	totalEntries: number,
	requestedPage: number,
	pageSize: number,
	fetch: (limit: number, offset: number) => RankedEntry[],
): LeaderboardPage
{
	const size = Math.max(1, Math.floor(pageSize));
	const totalPages = Math.max(1, Math.ceil(totalEntries / size));
	const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), totalPages);
	const offset = (page - 1) * size;
	// Hạng lấy từ ledger (tính trên toàn bảng), không suy ra từ vị trí trong trang, để người hoà điểm cùng hạng.
	const entries = fetch(size, offset).map(row => ({ rank: row.rank, id: row.id, value: row.total }));
	return { entries, page, totalPages, totalEntries, period: "all", since: null };
}
