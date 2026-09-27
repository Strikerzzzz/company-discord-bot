import { Clock } from "../shared/clock";
import { AuditService } from "./audit/AuditService";
import { TierSetService } from "./gamification/TierSetService";
import { GuildConfigService } from "./guild-config/GuildConfigService";
import { Ledger } from "./ledger/Ledger";
import { TeamService } from "./team/TeamService";

/** Dependency dùng chung, truyền qua constructor cho mọi service nghiệp vụ (PROP-011, không dùng DI container). */
export interface ServiceDeps
{
	clock: Clock;
	guildConfig: GuildConfigService;
	teams: TeamService;
	audit: AuditService;
	/** Ledger Activity XP. */
	xpLedger: Ledger;
	/** Ledger Contribution Score — tách biệt với XP (DEC-004). */
	contributionLedger: Ledger;
	/** Bộ danh hiệu của từng guild (DEC-033). */
	tierSets: TierSetService;
}
