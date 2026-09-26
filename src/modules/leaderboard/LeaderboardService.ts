import { ServiceDeps } from "../deps";
import { Ledger } from "../ledger/Ledger";

export type ScoreKind = "activity" | "contribution";

export interface LeaderboardEntry
{
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
		return paginate(ledger.countTeams(guildId), page, pageSize, (limit, offset) => ledger.teamTotals(guildId, limit, offset));
	}
}

function paginate(
	totalEntries: number,
	requestedPage: number,
	pageSize: number,
	fetch: (limit: number, offset: number) => { id: string; total: number }[],
): LeaderboardPage
{
	const size = Math.max(1, Math.floor(pageSize));
	const totalPages = Math.max(1, Math.ceil(totalEntries / size));
	const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), totalPages);
	const offset = (page - 1) * size;
	const entries = fetch(size, offset).map((row, index) => ({ rank: offset + index + 1, id: row.id, value: row.total }));
	return { entries, page, totalPages, totalEntries };
}
