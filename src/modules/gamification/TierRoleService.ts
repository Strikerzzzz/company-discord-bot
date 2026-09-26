import { Statement } from "better-sqlite3";
import { Db } from "../../db/connection";
import { Clock } from "../../shared/clock";
import { UserError } from "../../shared/errors";
import { isTierKey, TierKey, tierByKey, TIERS, tierForLevel } from "../activity/tiers";
import { AuditService } from "../audit/AuditService";
import { TierRoleMapping, TierRoleServiceApi, TierRoleSyncPlan } from "./types";

const INVALID_TIER = "Cảnh giới không hợp lệ.";

interface TierRoleRow
{
	tier_key: string;
	role_id: string;
}

/** Tên cảnh giới để hiển thị trong thông báo lỗi; khoá lạ (sửa tay DB) thì hiển thị nguyên khoá. */
function tierName(tierKey: string): string
{
	return isTierKey(tierKey) ? tierByKey(tierKey).name : tierKey;
}

/**
 * Role Discord tự gán theo cảnh giới (DEC-031): mỗi cảnh giới tối đa một role, mỗi role chỉ thuộc một cảnh giới
 * (unique index (guild_id, role_id) là lớp chặn cuối). Đây là cấu hình, không phải điểm, nên bỏ gán thì xoá dòng.
 * Không kiểm tra quyền Discord của role; việc đó thuộc tầng Discord.
 */
export class TierRoleService implements TierRoleServiceApi
{
	private readonly selectByGuild: Statement<[string], TierRoleRow>;
	private readonly selectByRole: Statement<[string, string], { tier_key: string }>;
	private readonly selectByTier: Statement<[string, string], { role_id: string }>;
	private readonly upsert: Statement<[string, string, string, number]>;
	private readonly deleteByTier: Statement<[string, string]>;

	constructor(private readonly db: Db, private readonly clock: Clock, private readonly audit: AuditService)
	{
		this.selectByGuild = db.prepare("SELECT tier_key, role_id FROM tier_roles WHERE guild_id = ?");
		this.selectByRole = db.prepare("SELECT tier_key FROM tier_roles WHERE guild_id = ? AND role_id = ?");
		this.selectByTier = db.prepare("SELECT role_id FROM tier_roles WHERE guild_id = ? AND tier_key = ?");
		this.upsert = db.prepare(`
			INSERT INTO tier_roles (guild_id, tier_key, role_id, updated_at) VALUES (?, ?, ?, ?)
			ON CONFLICT (guild_id, tier_key) DO UPDATE SET role_id = excluded.role_id, updated_at = excluded.updated_at`);
		this.deleteByTier = db.prepare("DELETE FROM tier_roles WHERE guild_id = ? AND tier_key = ?");
	}

	list(guildId: string): TierRoleMapping[]
	{
		const roleByTier = new Map(this.selectByGuild.all(guildId).map(row => [row.tier_key, row.role_id]));
		const mappings: TierRoleMapping[] = [];
		// Duyệt theo TIERS để có thứ tự cảnh giới và tự bỏ qua khoá lạ không thuộc TIERS.
		for (const tier of TIERS)
		{
			const roleId = roleByTier.get(tier.key);
			if (roleId !== undefined) mappings.push({ tierKey: tier.key, roleId });
		}
		return mappings;
	}

	set(guildId: string, tierKey: TierKey, roleId: string, actorId: string): void
	{
		// Kiểu TypeScript không bảo vệ được dữ liệu đến từ Discord lúc chạy, nên kiểm tra lại.
		if (!isTierKey(tierKey)) throw new UserError(INVALID_TIER);

		this.db.transaction((): void =>
		{
			const owner = this.selectByRole.get(guildId, roleId);
			if (owner !== undefined)
			{
				if (owner.tier_key === tierKey) return;
				throw new UserError(`Role này đang được gán cho cảnh giới ${tierName(owner.tier_key)}. Hãy bỏ gán ở cảnh giới đó trước.`);
			}

			this.upsert.run(guildId, tierKey, roleId, this.clock.now());
			this.audit.record(guildId, actorId, "tier_role.set", roleId, { tierKey });
		})();
	}

	clear(guildId: string, tierKey: TierKey, actorId: string): boolean
	{
		if (!isTierKey(tierKey)) throw new UserError(INVALID_TIER);

		return this.db.transaction((): boolean =>
		{
			const current = this.selectByTier.get(guildId, tierKey);
			if (current === undefined) return false;

			this.deleteByTier.run(guildId, tierKey);
			this.audit.record(guildId, actorId, "tier_role.clear", current.role_id, { tierKey });
			return true;
		})();
	}

	plan(guildId: string, level: number, memberRoleIds: readonly string[]): TierRoleSyncPlan
	{
		const mappings = this.list(guildId);
		const targetRoleId = mappings.find(mapping => mapping.tierKey === tierForLevel(level).key)?.roleId ?? null;
		const memberRoles = new Set(memberRoleIds);

		const add = targetRoleId !== null && !memberRoles.has(targetRoleId) ? [targetRoleId] : [];
		// Theo thứ tự TIERS của list(); role_id là duy nhất trong guild nên mảng không trùng.
		const remove = mappings
			.filter(mapping => mapping.roleId !== targetRoleId && memberRoles.has(mapping.roleId))
			.map(mapping => mapping.roleId);
		return { add, remove };
	}
}
