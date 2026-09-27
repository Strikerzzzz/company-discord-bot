import { Statement } from "better-sqlite3";
import { Db } from "../../db/connection";
import { Clock } from "../../shared/clock";
import { UserError } from "../../shared/errors";
import { isTierKey, TierKey, TIERS, tierForLevel, tierIndex } from "../activity/tiers";
import { AuditService } from "../audit/AuditService";
import { TierRoleMapping, TierRoleServiceApi, TierRoleSetupSummary, TierRoleSyncPlan } from "./types";

const INVALID_TIER = "Bậc danh hiệu không hợp lệ.";

interface TierRoleRow
{
	tier_key: string;
	role_id: string;
	created_by_bot: number;
}

/**
 * Tên bậc trong thông báo lỗi. Service không biết bộ danh hiệu guild đang dùng nên gọi theo vị trí ("bậc 3");
 * khoá lạ (sửa tay DB) thì hiển thị nguyên khoá.
 */
function tierName(tierKey: string): string
{
	return isTierKey(tierKey) ? `bậc ${tierIndex(tierKey) + 1}` : tierKey;
}

/**
 * Role Discord tự gán theo bậc danh hiệu (DEC-031, DEC-033): mỗi bậc tối đa một role, mỗi role chỉ thuộc một bậc.
 * Bậc là vị trí dùng chung giữa các bộ, nên đổi bộ không đổi role đã gán. Thứ tự và mốc level theo TIER_LEVELS.
 * (unique index (guild_id, role_id) là lớp chặn cuối). Đây là cấu hình, không phải điểm, nên bỏ gán thì xoá dòng.
 * Không kiểm tra quyền Discord của role; việc đó thuộc tầng Discord.
 */
export class TierRoleService implements TierRoleServiceApi
{
	private readonly selectByGuild: Statement<[string], TierRoleRow>;
	private readonly selectByRole: Statement<[string, string], { tier_key: string }>;
	private readonly selectByTier: Statement<[string, string], { role_id: string }>;
	private readonly upsert: Statement<[string, string, string, number, number]>;
	private readonly deleteByTier: Statement<[string, string]>;

	constructor(private readonly db: Db, private readonly clock: Clock, private readonly audit: AuditService)
	{
		this.selectByGuild = db.prepare("SELECT tier_key, role_id, created_by_bot FROM tier_roles WHERE guild_id = ?");
		this.selectByRole = db.prepare("SELECT tier_key FROM tier_roles WHERE guild_id = ? AND role_id = ?");
		this.selectByTier = db.prepare("SELECT role_id FROM tier_roles WHERE guild_id = ? AND tier_key = ?");
		this.upsert = db.prepare(`
			INSERT INTO tier_roles (guild_id, tier_key, role_id, updated_at, created_by_bot) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT (guild_id, tier_key) DO UPDATE SET role_id = excluded.role_id, updated_at = excluded.updated_at, created_by_bot = excluded.created_by_bot`);
		this.deleteByTier = db.prepare("DELETE FROM tier_roles WHERE guild_id = ? AND tier_key = ?");
	}

	list(guildId: string): TierRoleMapping[]
	{
		const rowByTier = new Map(this.selectByGuild.all(guildId).map(row => [row.tier_key, row]));
		const mappings: TierRoleMapping[] = [];
		// Duyệt theo TIERS để có thứ tự bậc và tự bỏ qua khoá lạ không thuộc TIER_KEYS.
		for (const tier of TIERS)
		{
			const row = rowByTier.get(tier.key);
			if (row !== undefined) mappings.push({ tierKey: tier.key, roleId: row.role_id, createdByBot: row.created_by_bot === 1 });
		}
		return mappings;
	}

	set(guildId: string, tierKey: TierKey, roleId: string, actorId: string, options: { createdByBot?: boolean } = {}): void
	{
		// Kiểu TypeScript không bảo vệ được dữ liệu đến từ Discord lúc chạy, nên kiểm tra lại.
		if (!isTierKey(tierKey)) throw new UserError(INVALID_TIER);

		this.db.transaction((): void =>
		{
			const owner = this.selectByRole.get(guildId, roleId);
			if (owner !== undefined)
			{
				if (owner.tier_key === tierKey) return;
				throw new UserError(`Role này đang được gán cho ${tierName(owner.tier_key)}. Hãy bỏ gán ở bậc đó trước.`);
			}

			this.upsert.run(guildId, tierKey, roleId, this.clock.now(), options.createdByBot === true ? 1 : 0);
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

	recordSetup(guildId: string, actorId: string, summary: TierRoleSetupSummary): void
	{
		this.audit.record(guildId, actorId, "tier_role.setup", null, { ...summary });
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
