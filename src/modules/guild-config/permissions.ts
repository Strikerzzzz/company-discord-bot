import { GuildSettings } from "./types";

/** Thông tin quyền của người gọi lệnh, do tầng Discord trích từ interaction. */
export interface MemberAccess
{
	hasManageGuild: boolean;
	roleIds: readonly string[];
}

/**
 * Lớp kiểm tra quyền thứ hai (PROP-013): người có quyền Manage Server hoặc role admin do bot cấu hình.
 * Lớp thứ nhất là setDefaultMemberPermissions trên command, nhưng admin server có thể nới lỏng lớp đó.
 */
export function isAdmin(access: MemberAccess, settings: Pick<GuildSettings, "adminRoleId">): boolean
{
	return access.hasManageGuild || (settings.adminRoleId !== null && access.roleIds.includes(settings.adminRoleId));
}

/** Admin, hoặc người có role được cấp quyền tạo vote (DEC-026). */
export function canCreatePoll(access: MemberAccess, settings: Pick<GuildSettings, "adminRoleId" | "pollCreatorRoleId">): boolean
{
	return isAdmin(access, settings) || (settings.pollCreatorRoleId !== null && access.roleIds.includes(settings.pollCreatorRoleId));
}
