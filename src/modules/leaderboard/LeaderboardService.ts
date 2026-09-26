import { ServiceDeps } from "../deps";
import { Ledger, RankedEntry } from "../ledger/Ledger";

export type ScoreKind = "activity" | "contribution";

export interface LeaderboardEntry
{
	/** Hạng kiểu competition ranking (hoà điểm thì cùng hạng: 1, 1, 3), khớp với hạng trong /rank. */
	rank: number;
	/** User ID (cá nhân) hoặc role ID (team). */
	id: string;
	value: number;
}

export interface LeaderboardPage
{
	entries: LeaderboardEntry[];
	page: number;
	totalPages: number;
	totalEntries: number;
}

export interface LeaderboardServiceApi
{
	individual(guildId: string, kind: ScoreKind, page: number, pageSize?: number): LeaderboardPage;
	teams(guildId: string, kind: ScoreKind, page: number, pageSize?: number): LeaderboardPage;
}

export const DEFAULT_PAGE_SIZE = 10;

/** 4 bảng xếp hạng: cá nhân/team × Activity/Contribution; hai loại điểm luôn tách biệt (DEC-004). */
export class LeaderboardService implements LeaderboardServiceApi
{
	constructor(private readonly deps: Pick<ServiceDeps, "xpLedger" | "contributionLedger">)
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
	return { entries, page, totalPages, totalEntries };
}
