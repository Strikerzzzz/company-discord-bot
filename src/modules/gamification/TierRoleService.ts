import { Db } from "../../db/connection";
import { Clock } from "../../shared/clock";
import { TierKey } from "../activity/tiers";
import { AuditService } from "../audit/AuditService";
import { TierRoleMapping, TierRoleServiceApi, TierRoleSyncPlan } from "./types";

/** Role Discord tự gán theo cảnh giới (DEC-031): mỗi cảnh giới tối đa một role, mỗi role chỉ thuộc một cảnh giới. */
export class TierRoleService implements TierRoleServiceApi
{
	constructor(private readonly db: Db, private readonly clock: Clock, private readonly audit: AuditService)
	{}

	list(guildId: string): TierRoleMapping[]
	{
		throw new Error(`Chưa triển khai: TierRoleService.list (${guildId}, ${this.db.name}).`);
	}

	set(guildId: string, tierKey: TierKey, roleId: string, actorId: string): void
	{
		throw new Error(`Chưa triển khai: TierRoleService.set (${guildId}, ${tierKey}, ${roleId}, ${actorId}, ${this.clock.now()}).`);
	}

	clear(guildId: string, tierKey: TierKey, actorId: string): boolean
	{
		throw new Error(`Chưa triển khai: TierRoleService.clear (${guildId}, ${tierKey}, ${actorId}, ${typeof this.audit}).`);
	}

	plan(guildId: string, level: number, memberRoleIds: readonly string[]): TierRoleSyncPlan
	{
		throw new Error(`Chưa triển khai: TierRoleService.plan (${guildId}, ${level}, ${memberRoleIds.length}).`);
	}
}
