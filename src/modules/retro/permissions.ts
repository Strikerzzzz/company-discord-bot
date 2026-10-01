import { GuildSettings } from "../guild-config/types";
import { isAdmin, MemberAccess } from "../guild-config/permissions";
import { RetroConfig, RetroSession } from "./types";

/** Thông tin quyền của người thao tác retro, do tầng Discord hoặc web trích ra. */
export interface RetroAccess extends MemberAccess
{
	userId: string;
}

function hasManagerRole(access: RetroAccess, config: Pick<RetroConfig, "managerRoleIds">): boolean
{
	return config.managerRoleIds.some(roleId => access.roleIds.includes(roleId));
}

/**
 * Được tạo phiên retro: admin bot hoặc người có role quản lý retro (DEC-049). Thành viên thường không tạo được, vì người tạo trở
 * thành người quản lý phiên (tạo vote, chọn tên) và phiên có XP khi điền.
 */
export function canCreateRetro(access: RetroAccess, settings: Pick<GuildSettings, "adminRoleIds">, config: Pick<RetroConfig, "managerRoleIds">): boolean
{
	return isAdmin(access, settings) || hasManagerRole(access, config);
}

/** Người quản lý một phiên (DEC-049): admin bot, người tạo phiên, hoặc người có role quản lý retro. */
export function canManageRetro(
	access: RetroAccess,
	settings: Pick<GuildSettings, "adminRoleIds">,
	config: Pick<RetroConfig, "managerRoleIds">,
	session: Pick<RetroSession, "createdBy">,
): boolean
{
	return access.userId === session.createdBy || canCreateRetro(access, settings, config);
}
