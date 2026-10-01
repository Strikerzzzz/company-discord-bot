import { Db } from "./db/connection";
import { BackupService } from "./db/backup";
import { Clock } from "./shared/clock";
import { ActivityService } from "./modules/activity/ActivityService";
import { ActivityServiceApi } from "./modules/activity/types";
import { AuditService } from "./modules/audit/AuditService";
import { ContributionService } from "./modules/contribution/ContributionService";
import { ContributionServiceApi } from "./modules/contribution/types";
import { ServiceDeps } from "./modules/deps";
import { GamificationService } from "./modules/gamification/GamificationService";
import { TierRoleService } from "./modules/gamification/TierRoleService";
import { TierSetService, TierSetServiceApi } from "./modules/gamification/TierSetService";
import { GamificationServiceApi, TierRoleServiceApi } from "./modules/gamification/types";
import { GuildConfigService } from "./modules/guild-config/GuildConfigService";
import { LeaderboardService, LeaderboardServiceApi } from "./modules/leaderboard/LeaderboardService";
import { Ledger } from "./modules/ledger/Ledger";
import { LiveBoardService, LiveBoardServiceApi } from "./modules/live-board/LiveBoardService";
import { PollService } from "./modules/poll/PollService";
import { PollServiceApi } from "./modules/poll/types";
import { RetroService } from "./modules/retro/RetroService";
import { RetroServiceApi } from "./modules/retro/types";
import { StatisticsService } from "./modules/statistics/StatisticsService";
import { StatisticsServiceApi } from "./modules/statistics/types";
import { TeamService } from "./modules/team/TeamService";

/** Toàn bộ service mà tầng Discord dùng (context object gắn vào DiscordClient). */
export interface AppServices
{
	clock: Clock;
	guildConfig: GuildConfigService;
	teams: TeamService;
	audit: AuditService;
	activity: ActivityServiceApi;
	contributions: ContributionServiceApi;
	polls: PollServiceApi;
	leaderboard: LeaderboardServiceApi;
	statistics: StatisticsServiceApi;
	/** Cảnh giới, chuỗi ngày hoạt động, huy hiệu (DEC-029). */
	gamification: GamificationServiceApi;
	/** Role tự gán theo cảnh giới (DEC-031). */
	tierRoles: TierRoleServiceApi;
	/** Bộ danh hiệu đang dùng, tên bậc tuỳ chỉnh (DEC-033). */
	tierSets: TierSetServiceApi;
	/** Bảng vàng tự cập nhật (DEC-030). */
	liveBoards: LiveBoardServiceApi;
	/** Retro sprint theo team (DEC-049). */
	retro: RetroServiceApi;
	backup: BackupService;
}

export interface ServiceOptions
{
	clock: Clock;
	backupDir: string;
	backupKeep: number;
	/** CONFLUENCE_BASE_URL đã chuẩn hoá (DEC-049); không có = chưa cấu hình, link tài liệu retro không bị kiểm tra host. */
	confluenceBaseUrl?: string | null;
}

/** Composition root của tầng nghiệp vụ: tạo mọi service bằng constructor injection thủ công. */
export function createServices(db: Db, options: ServiceOptions): AppServices
{
	const { clock } = options;
	const audit = new AuditService(db, clock);
	const deps: ServiceDeps = {
		clock,
		audit,
		guildConfig: new GuildConfigService(db, clock, audit),
		teams: new TeamService(db, clock, audit),
		xpLedger: new Ledger(db, "xp", clock),
		contributionLedger: new Ledger(db, "contribution", clock),
		tierSets: new TierSetService(db, clock, audit),
	};

	const polls = new PollService(db, deps);

	return {
		clock,
		audit,
		guildConfig: deps.guildConfig,
		teams: deps.teams,
		activity: new ActivityService(db, deps),
		contributions: new ContributionService(db, deps),
		polls,
		leaderboard: new LeaderboardService(deps),
		statistics: new StatisticsService(db, deps),
		gamification: new GamificationService(db, deps),
		tierRoles: new TierRoleService(db, clock, audit),
		tierSets: deps.tierSets,
		liveBoards: new LiveBoardService(db, clock, audit),
		retro: new RetroService(db, deps, polls, options.confluenceBaseUrl ?? null),
		backup: new BackupService(db, options.backupDir, options.backupKeep, clock),
	};
}
