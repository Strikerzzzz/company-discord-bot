import { GuildMember, PermissionFlagsBits, Role } from "discord.js";
import { TierRoleServiceApi } from "../modules/gamification/types";
import { logger } from "../shared/logger";
import { roleMention } from "./format";
import { roleIdsOf } from "./members";

/**
 * Quyền quản trị hoặc kiểm duyệt: role có một trong các quyền này không được dùng làm role cảnh giới (DEC-031),
 * vì bot tự gán role cảnh giới cho bất kỳ ai nhắn tin đủ nhiều.
 */
const DANGEROUS_PERMISSIONS: readonly (readonly [bigint, string])[] = [
	[PermissionFlagsBits.Administrator, "Administrator"],
	[PermissionFlagsBits.ManageGuild, "Manage Server"],
	[PermissionFlagsBits.ManageRoles, "Manage Roles"],
	[PermissionFlagsBits.ManageChannels, "Manage Channels"],
	[PermissionFlagsBits.ManageWebhooks, "Manage Webhooks"],
	[PermissionFlagsBits.ManageGuildExpressions, "Manage Expressions"],
	[PermissionFlagsBits.ManageEvents, "Manage Events"],
	[PermissionFlagsBits.ManageThreads, "Manage Threads"],
	[PermissionFlagsBits.ManageMessages, "Manage Messages"],
	[PermissionFlagsBits.ManageNicknames, "Manage Nicknames"],
	[PermissionFlagsBits.KickMembers, "Kick Members"],
	[PermissionFlagsBits.BanMembers, "Ban Members"],
	[PermissionFlagsBits.ModerateMembers, "Timeout Members"],
	[PermissionFlagsBits.MentionEveryone, "Mention Everyone"],
	[PermissionFlagsBits.ViewAuditLog, "View Audit Log"],
	[PermissionFlagsBits.MoveMembers, "Move Members"],
	[PermissionFlagsBits.MuteMembers, "Mute Members"],
	[PermissionFlagsBits.DeafenMembers, "Deafen Members"],
];

/** Khoảng tối thiểu giữa hai cảnh báo cùng loại của một guild, để lỗi lặp lại ở mỗi tin nhắn không làm ngập log. */
const WARN_THROTTLE_MS = 10 * 60 * 1000;
const lastWarnings = new Map<string, number>();

export interface TierRoleSyncResult
{
	/** Role đã thêm cho member. */
	added: string[];
	/** Role đã bỏ khỏi member. */
	removed: string[];
	/** Role lẽ ra phải thêm hoặc bỏ nhưng không làm được (thiếu quyền, thứ bậc role, role nguy hiểm, lỗi API). */
	skipped: string[];
}

/** Cảnh báo có throttle theo guild và loại cảnh báo. */
function warnThrottled(guildId: string, kind: string, message: string, error?: unknown): void
{
	const key = `${guildId}:${kind}`;
	const now = Date.now();
	const last = lastWarnings.get(key);
	if (last !== undefined && now - last < WARN_THROTTLE_MS) return;
	lastWarnings.set(key, now);
	if (error === undefined) logger.warn(message);
	else logger.warn(message, error);
}

/** Tên các quyền nguy hiểm mà role có (Administrator không được tính là "có mọi quyền" ở đây, mà được liệt kê riêng). */
function dangerousPermissionsOf(role: Role): string[]
{
	return DANGEROUS_PERMISSIONS.filter(([flag]) => role.permissions.has(flag, false)).map(([, name]) => name);
}

/**
 * Lý do (tiếng Việt, hiển thị cho admin) khiến `role` không được dùng làm role cảnh giới; null nếu dùng được.
 * Chặn: @everyone, role do bot/integration quản lý, role có quyền quản trị/kiểm duyệt, role không thấp hơn role cao nhất của bot.
 */
export function tierRoleSafetyIssue(role: Role, botMember: GuildMember): string | null
{
	if (role.id === role.guild.id) return "Không thể dùng @everyone làm role cảnh giới.";
	if (role.managed) return "Không thể dùng role do bot hoặc integration quản lý làm role cảnh giới.";

	const dangerous = dangerousPermissionsOf(role);
	if (dangerous.length > 0)
	{
		return `Không thể dùng ${roleMention(role.id)} làm role cảnh giới vì role này có quyền quản trị hoặc kiểm duyệt (${dangerous.join(", ")}). `
			+ "Bot tự gán role cảnh giới cho thành viên, nên hãy dùng role không có các quyền này.";
	}

	const highest = botMember.roles.highest;
	if (role.position >= highest.position)
	{
		return `Bot không quản lý được ${roleMention(role.id)} vì role này không thấp hơn role cao nhất của bot (${roleMention(highest.id)}). `
			+ "Vào **Server Settings → Roles**, kéo role của bot lên trên các role cảnh giới rồi thử lại.";
	}
	return null;
}

/** Bot có thể gỡ role này khỏi member không (không cần xét quyền nguy hiểm: gỡ role chỉ làm giảm quyền). */
function canRemoveRole(role: Role, botMember: GuildMember): boolean
{
	return role.id !== role.guild.id && !role.managed && role.position < botMember.roles.highest.position;
}

/** Thêm hoặc bỏ một role; lỗi API chỉ ghi cảnh báo. Gọi từng role (PUT/DELETE) thay vì PATCH cả danh sách role từ cache. */
async function changeRole(member: GuildMember, roleId: string, action: "add" | "remove", reason: string): Promise<boolean>
{
	try
	{
		if (action === "add") await member.roles.add(roleId, reason);
		else await member.roles.remove(roleId, reason);
		return true;
	}
	catch (error)
	{
		warnThrottled(member.guild.id, "api", `Không ${action === "add" ? "thêm" : "bỏ"} được role cảnh giới "${roleId}" ở server "${member.guild.id}":`, error);
		return false;
	}
}

async function applyPlan(member: GuildMember, level: number, tierRoles: TierRoleServiceApi, reason: string, result: TierRoleSyncResult): Promise<void>
{
	const { guild } = member;
	const plan = tierRoles.plan(guild.id, level, roleIdsOf(member));
	if (plan.add.length === 0 && plan.remove.length === 0) return;

	const me = guild.members.me;
	if (!me || !me.permissions.has(PermissionFlagsBits.ManageRoles))
	{
		result.skipped.push(...plan.add, ...plan.remove);
		warnThrottled(guild.id, "permission", `Bot thiếu quyền Manage Roles ở server "${guild.id}" nên không đồng bộ được role cảnh giới.`);
		return;
	}

	const unmanageable: string[] = [];
	for (const roleId of plan.add)
	{
		const role = guild.roles.cache.get(roleId);
		if (!role || tierRoleSafetyIssue(role, me) !== null) unmanageable.push(roleId);
		else if (await changeRole(member, roleId, "add", reason)) result.added.push(roleId);
		else result.skipped.push(roleId);
	}
	for (const roleId of plan.remove)
	{
		const role = guild.roles.cache.get(roleId);
		if (!role || !canRemoveRole(role, me)) unmanageable.push(roleId);
		else if (await changeRole(member, roleId, "remove", reason)) result.removed.push(roleId);
		else result.skipped.push(roleId);
	}

	if (unmanageable.length > 0)
	{
		result.skipped.push(...unmanageable);
		warnThrottled(
			guild.id,
			"hierarchy",
			`Không đồng bộ được role cảnh giới ${unmanageable.join(", ")} ở server "${guild.id}": role không còn, do integration quản lý, `
				+ "có quyền quản trị/kiểm duyệt, hoặc không thấp hơn role cao nhất của bot.",
		);
	}
}

/**
 * Đưa role cảnh giới của member về đúng cảnh giới của `level` (DEC-031): thêm role của cảnh giới hiện tại, bỏ role của
 * các cảnh giới khác. Không gọi API nếu không có gì cần đổi. Role không quản lý được hoặc lỗi API thì đưa vào `skipped`
 * và ghi cảnh báo (có throttle theo guild). Không bao giờ ném lỗi.
 */
export async function syncTierRoles(member: GuildMember, level: number, tierRoles: TierRoleServiceApi, reason: string): Promise<TierRoleSyncResult>
{
	const result: TierRoleSyncResult = { added: [], removed: [], skipped: [] };
	try
	{
		await applyPlan(member, level, tierRoles, reason, result);
	}
	catch (error)
	{
		warnThrottled(member.guild.id, "unexpected", `Lỗi khi đồng bộ role cảnh giới ở server "${member.guild.id}":`, error);
	}
	return result;
}
