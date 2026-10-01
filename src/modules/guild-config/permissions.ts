import { GuildSettings } from "./types";

/** Thông tin quyền của người gọi lệnh, do tầng Discord trích từ interaction. */
export interface MemberAccess
{
	hasManageGuild: boolean;
	roleIds: readonly string[];
}

/** Người có ít nhất một role trong `roleIds`. */
function hasAnyRole(access: MemberAccess, roleIds: readonly string[]): boolean
{
	return roleIds.some(roleId => access.roleIds.includes(roleId));
}

/**
 * Lớp kiểm tra quyền thứ hai (PROP-013): người có quyền Manage Server, hoặc có ít nhất một role trong danh sách role admin bot
 * (DEC-044). Lớp thứ nhất là setDefaultMemberPermissions trên command, nhưng admin server có thể nới lỏng lớp đó.
 */
export function isAdmin(access: MemberAccess, settings: Pick<GuildSettings, "adminRoleIds">): boolean
{
	return access.hasManageGuild || hasAnyRole(access, settings.adminRoleIds);
}

/** Admin, hoặc người có ít nhất một role trong danh sách role được tạo vote (DEC-026, DEC-044). */
export function canCreatePoll(access: MemberAccess, settings: Pick<GuildSettings, "adminRoleIds" | "pollCreatorRoleIds">): boolean
{
	return isAdmin(access, settings) || hasAnyRole(access, settings.pollCreatorRoleIds);
}

/** Admin, hoặc người có ít nhất một role trong danh sách role duyệt contribution (DEC-051). */
export function canReviewContributions(access: MemberAccess, settings: Pick<GuildSettings, "adminRoleIds" | "contributionReviewerRoleIds">): boolean
{
	return isAdmin(access, settings) || hasAnyRole(access, settings.contributionReviewerRoleIds);
}
