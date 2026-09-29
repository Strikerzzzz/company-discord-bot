import { Db } from "../../db/connection";
import { Clock } from "../../shared/clock";
import { UserError } from "../../shared/errors";
import { AuditService } from "../audit/AuditService";

export const MAX_TEAMS = 25;

/** Kết quả thêm/bỏ nhiều team: role đã đổi và role vốn đã đúng trạng thái (theo thứ tự đầu vào, đã bỏ trùng). */
export interface BulkTeamResult
{
	changed: string[];
	unchanged: string[];
}

/** Team = Discord Role do admin chỉ định (DEC-005). Không lưu danh sách thành viên. */
export class TeamService
{
	constructor(private readonly db: Db, private readonly clock: Clock, private readonly audit: AuditService)
	{}

	/** Role ID của các team, theo thứ tự thêm vào. */
	list(guildId: string): string[]
	{
		return this.db.prepare<[string], { role_id: string }>("SELECT role_id FROM team_roles WHERE guild_id = ? ORDER BY created_at, role_id")
			.all(guildId)
			.map(row => row.role_id);
	}

	/** Thêm role làm team. Trả về false nếu role đã là team. */
	add(guildId: string, roleId: string, actorId: string): boolean
	{
		return this.db.transaction((): boolean =>
		{
			const teams = this.list(guildId);
			if (teams.includes(roleId)) return false;
			if (teams.length >= MAX_TEAMS) throw new UserError(`Chỉ được cấu hình tối đa ${MAX_TEAMS} team.`);
			this.db.prepare("INSERT INTO team_roles (guild_id, role_id, created_at) VALUES (?, ?, ?)").run(guildId, roleId, this.clock.now());
			this.audit.record(guildId, actorId, "team.add", roleId);
			return true;
		})();
	}

	/** Bỏ role khỏi danh sách team (điểm lịch sử vẫn giữ, chỉ không hiển thị nữa). Trả về false nếu role không phải team. */
	remove(guildId: string, roleId: string, actorId: string): boolean
	{
		return this.db.transaction((): boolean =>
		{
			const removed = this.db.prepare("DELETE FROM team_roles WHERE guild_id = ? AND role_id = ?").run(guildId, roleId).changes > 0;
			if (removed) this.audit.record(guildId, actorId, "team.remove", roleId);
			return removed;
		})();
	}

	/**
	 * Thêm nhiều role làm team trong một transaction (bảng cấu hình): tổng số team sau khi thêm không được vượt MAX_TEAMS,
	 * kiểm tra trước khi ghi nên lỗi thì không thêm role nào. Role đã là team → `unchanged`. Mỗi role thêm có một audit `team.add`.
	 */
	addMany(guildId: string, roleIds: readonly string[], actorId: string): BulkTeamResult
	{
		const unique = [...new Set(roleIds)];
		return this.db.transaction((): BulkTeamResult =>
		{
			const teams = new Set(this.list(guildId));
			const fresh = unique.filter(roleId => !teams.has(roleId));
			if (teams.size + fresh.length > MAX_TEAMS)
			{
				throw new UserError(`Chỉ được cấu hình tối đa ${MAX_TEAMS} team: server đang có ${teams.size} team, `
					+ `thêm ${fresh.length} role mới sẽ vượt giới hạn. Bot chưa thêm role nào.`);
			}
			const insert = this.db.prepare("INSERT INTO team_roles (guild_id, role_id, created_at) VALUES (?, ?, ?)");
			const now = this.clock.now();
			for (const roleId of fresh)
			{
				insert.run(guildId, roleId, now);
				this.audit.record(guildId, actorId, "team.add", roleId);
			}
			return { changed: fresh, unchanged: unique.filter(roleId => teams.has(roleId)) };
		})();
	}

	/** Bỏ nhiều role khỏi danh sách team trong một transaction; role không phải team → `unchanged`. Mỗi role bỏ có một audit `team.remove`. */
	removeMany(guildId: string, roleIds: readonly string[], actorId: string): BulkTeamResult
	{
		const unique = [...new Set(roleIds)];
		return this.db.transaction((): BulkTeamResult =>
		{
			const remove = this.db.prepare("DELETE FROM team_roles WHERE guild_id = ? AND role_id = ?");
			const result: BulkTeamResult = { changed: [], unchanged: [] };
			for (const roleId of unique)
			{
				if (remove.run(guildId, roleId).changes > 0)
				{
					this.audit.record(guildId, actorId, "team.remove", roleId);
					result.changed.push(roleId);
				}
				else
				{
					result.unchanged.push(roleId);
				}
			}
			return result;
		})();
	}

	/** Các team mà một thành viên thuộc về, dựa trên role hiện có của họ (dùng làm snapshot khi ghi điểm). */
	resolveTeams(guildId: string, memberRoleIds: readonly string[]): string[]
	{
		const roles = new Set(memberRoleIds);
		return this.list(guildId).filter(roleId => roles.has(roleId));
	}
}
