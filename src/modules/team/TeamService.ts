import { Db } from "../../db/connection";
import { Clock } from "../../shared/clock";
import { UserError } from "../../shared/errors";
import { AuditService } from "../audit/AuditService";

export const MAX_TEAMS = 25;

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

	/** Các team mà một thành viên thuộc về, dựa trên role hiện có của họ (dùng làm snapshot khi ghi điểm). */
	resolveTeams(guildId: string, memberRoleIds: readonly string[]): string[]
	{
		const roles = new Set(memberRoleIds);
		return this.list(guildId).filter(roleId => roles.has(roleId));
	}
}
