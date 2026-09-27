import { Guild, GuildMember, PermissionFlagsBits, Role } from "discord.js";
import { Tier, TierKey, TierSet, TierSetKey } from "../modules/activity/tiers";
import { TierRoleSetupSummary } from "../modules/gamification/types";
import { AppServices } from "../services";
import { UserError } from "../shared/errors";
import { logger } from "../shared/logger";
import { roleMention } from "./format";
import { tierRoleSafetyIssue } from "./roleSync";

/*
 * Thao tác role danh hiệu ở tầng Discord (DEC-031, DEC-033): gán role cho một bậc sau khi kiểm tra quyền, và tạo/đổi tên
 * role theo bộ danh hiệu đang dùng. Bot chỉ làm thay người gọi những gì chính người gọi làm được theo luật Discord
 * (có Manage Roles, role nằm dưới role cao nhất của họ), để bot không thành đường vòng tự cấp role (LL-017).
 */

export const BOT_MEMBER_UNAVAILABLE = "Không đọc được thông tin của bot trong server. Vui lòng thử lại sau.";
export const CALLER_NEEDS_MANAGE_ROLES = "Bạn cần quyền **Manage Roles** để gán hoặc tạo role danh hiệu, "
	+ "vì bot sẽ thay bạn gán các role này cho thành viên.";
export const BOT_NEEDS_MANAGE_ROLES = "Bot chưa có quyền **Manage Roles** nên không tạo hay đổi tên được role. "
	+ "Hãy cấp quyền này cho role của bot (Server Settings → Roles) rồi thử lại.";
export const SETUP_RUNNING = "Bot đang tạo/đồng bộ role danh hiệu cho server này. Vui lòng chờ xong rồi thử lại.";
export const SETUP_API_FAILURE = "Discord từ chối thao tác (thiếu quyền, sai thứ bậc role hoặc lỗi mạng); xem log của bot.";
export const SETUP_CHANGED_MEANWHILE = "Bậc này vừa được gán role khác trong lúc bot đang đồng bộ, nên bot giữ nguyên role đó.";
const SETUP_SAVE_FAILURE = "Không lưu được role vừa tạo; xem log của bot.";

/** Các service mà thao tác role danh hiệu cần. */
export type TierRoleServices = Pick<AppServices, "guildConfig" | "teams" | "tierRoles">;

/** Người thao tác role danh hiệu, dạng dữ liệu thuần lấy từ member trong cache. */
export interface TierRoleActor
{
	id: string;
	/** Chủ server không bị giới hạn quyền hay thứ bậc role. */
	isOwner: boolean;
	/** Có Manage Roles ở cấp server (không tính phân quyền riêng của kênh, nơi bit này nghĩa là "Manage Permissions"). */
	canManageRoles: boolean;
	/** Role cao nhất của người thao tác. */
	highestRole: { id: string; position: number };
}

export function tierRoleActor(guild: Guild, member: GuildMember): TierRoleActor
{
	const highest = member.roles.highest;
	return {
		id: member.id,
		isOwner: guild.ownerId === member.id,
		canManageRoles: member.permissions.has(PermissionFlagsBits.ManageRoles),
		highestRole: { id: highest.id, position: highest.position },
	};
}

/** Lý do người thao tác không được quản lý role danh hiệu (thiếu Manage Roles); null nếu được. */
export function callerManageRolesIssue(actor: TierRoleActor): string | null
{
	return actor.isOwner || actor.canManageRoles ? null : CALLER_NEEDS_MANAGE_ROLES;
}

/**
 * Lý do người thao tác không tự `action` được `role` theo luật Discord áp cho người thường: phải có Manage Roles và role
 * nằm dưới role cao nhất của họ (chủ server luôn được). null nếu được.
 */
export function callerRoleIssue(actor: TierRoleActor, role: Pick<Role, "id" | "position">, action = "gán"): string | null
{
	const issue = callerManageRolesIssue(actor);
	if (issue !== null || actor.isOwner) return issue;
	if (role.position >= actor.highestRole.position)
	{
		return `Bạn không ${action} được ${roleMention(role.id)} vì role này không thấp hơn role cao nhất của bạn (${roleMention(actor.highestRole.id)}). `
			+ `Discord chỉ cho ${action} role nằm dưới role cao nhất của mình.`;
	}
	return null;
}

/** Thông tin mới nhất của bot từ Discord (role, quyền), để kiểm tra thứ bậc role không dựa vào cache cũ. */
export async function fetchBotMember(guild: Guild): Promise<GuildMember>
{
	try
	{
		return await guild.members.fetchMe({ force: true });
	}
	catch (error)
	{
		logger.warn(`Không tải được thông tin của bot ở server "${guild.id}":`, error);
		throw new UserError(BOT_MEMBER_UNAVAILABLE);
	}
}

/** Vai trò khác của role trong cấu hình bot (role admin bot, role tạo vote, team); null nếu không có. */
export function otherRoleUsage(services: TierRoleServices, guildId: string, roleId: string): string | null
{
	const settings = services.guildConfig.getSettings(guildId);
	if (settings.adminRoleId === roleId) return "role admin bot";
	if (settings.pollCreatorRoleId === roleId) return "role được tạo vote";
	if (services.teams.list(guildId).includes(roleId)) return "role của một team";
	return null;
}

function assignedRoleId(services: TierRoleServices, guildId: string, tierKey: TierKey): string | null
{
	return services.tierRoles.list(guildId).find(mapping => mapping.tierKey === tierKey)?.roleId ?? null;
}

export interface TierRoleAssignment
{
	/** Role bậc này giữ trước khi gán; null nếu chưa gán. */
	previousRoleId: string | null;
	/** Bot có Manage Roles không (không có thì vẫn lưu, nhưng chưa tự gán được role cho thành viên). */
	botCanManageRoles: boolean;
}

/**
 * Gán `role` cho bậc `tierKey` sau khi kiểm tra: người thao tác tự gán được role đó, role an toàn và bot quản lý được
 * (theo thông tin mới nhất của bot), role không đang giữ vai trò khác trong cấu hình bot. Lỗi là UserError; không ghi gì.
 * Dùng chung cho `/config tier set-role` và ô chọn role trong bảng điều khiển.
 */
export async function assignTierRole(
	guild: Guild,
	actor: TierRoleActor,
	services: TierRoleServices,
	tierKey: TierKey,
	role: Role,
): Promise<TierRoleAssignment>
{
	const callerIssue = callerRoleIssue(actor, role);
	if (callerIssue !== null) throw new UserError(callerIssue);

	const me = await fetchBotMember(guild);
	const issue = tierRoleSafetyIssue(role, me);
	if (issue !== null) throw new UserError(issue);

	// Kiểm tra vai trò khác của role sau await, liền trước bước ghi, để không có await chen giữa bước đọc và bước ghi.
	const usage = otherRoleUsage(services, guild.id, role.id);
	if (usage !== null)
	{
		throw new UserError(`Không thể dùng ${roleMention(role.id)} làm role danh hiệu vì role này đang là ${usage}. `
			+ "Bot tự gán role danh hiệu cho người đủ level và gỡ khỏi người khác, nên hãy tạo một role mới dành riêng cho bậc danh hiệu.");
	}
	const previousRoleId = assignedRoleId(services, guild.id, tierKey);
	services.tierRoles.set(guild.id, tierKey, role.id, actor.id);
	return { previousRoleId, botCanManageRoles: me.permissions.has(PermissionFlagsBits.ManageRoles) };
}

// ---------- Tạo/đồng bộ role theo bộ ----------

/**
 * Kết quả của một bậc: "created" (tạo mới cho bậc chưa gán), "recreated" (role đã gán không còn nên tạo lại),
 * "renamed" (đổi tên/màu role đã gán), "unchanged" (đã đúng tên và màu), "skipped" (bỏ qua, xem `reason`).
 */
export type TierRoleSetupStatus = "created" | "recreated" | "renamed" | "unchanged" | "skipped";

export interface TierRoleSetupEntry
{
	/** Bậc theo bộ đang đồng bộ (tên, emoji đã áp tên tuỳ chỉnh). */
	tier: Tier;
	status: TierRoleSetupStatus;
	/** Role của bậc sau khi đồng bộ; null nếu bỏ qua mà bậc không có role còn tồn tại. */
	roleId: string | null;
	/** Lý do bỏ qua (tiếng Việt, hiển thị cho admin); null nếu không bỏ qua. */
	reason: string | null;
}

export interface TierRoleSetupResult
{
	setKey: TierSetKey;
	/** Đúng thứ tự bậc của bộ. */
	entries: TierRoleSetupEntry[];
	/** Số đếm đã ghi vào audit "tier_role.setup". */
	summary: TierRoleSetupSummary;
}

/** Tên role của một bậc: "{emoji} {tên}". */
export function tierRoleName(tier: Tier): string
{
	return `${tier.emoji} ${tier.name}`;
}

/** Màu role của một bậc (số nguyên RGB từ "#rrggbb"). */
export function tierRoleColor(tier: Tier): number
{
	return Number.parseInt(tier.color.slice(1), 16);
}

interface SetupContext
{
	guild: Guild;
	set: TierSet;
	services: TierRoleServices;
	actor: TierRoleActor;
	me: GuildMember;
}

/** Guild đang tạo/đồng bộ role; hai lượt chạy cùng lúc có thể tạo trùng role cho cùng một bậc. */
const runningSetups = new Set<string>();

function skipped(tier: Tier, roleId: string | null, reason: string): TierRoleSetupEntry
{
	return { tier, status: "skipped", roleId, reason };
}

function tierPosition(tier: Tier): string
{
	return `bậc ${tier.index + 1}`;
}

async function deleteQuietly(role: Role, reason: string): Promise<void>
{
	try
	{
		await role.delete(reason);
	}
	catch (error)
	{
		logger.warn(`Không xoá được role "${role.id}" vừa tạo ở server "${role.guild.id}":`, error);
	}
}

/** Lý do không đụng tới role vì role đang giữ vai trò khác trong cấu hình bot; null nếu không có. */
function usageIssue(context: SetupContext, role: Role): string | null
{
	const usage = otherRoleUsage(context.services, context.guild.id, role.id);
	return usage === null ? null : `${roleMention(role.id)} đang là ${usage}, nên bot không đổi tên role này. Hãy gán cho bậc này một role riêng.`;
}

/** Đổi tên/màu role đã gán nếu role an toàn, không giữ vai trò khác, và cả bot lẫn người thao tác quản lý được. */
async function renameRole(context: SetupContext, tier: Tier, role: Role): Promise<TierRoleSetupEntry>
{
	const issue = tierRoleSafetyIssue(role, context.me) ?? usageIssue(context, role) ?? callerRoleIssue(context.actor, role, "sửa");
	if (issue !== null) return skipped(tier, role.id, issue);

	const name = tierRoleName(tier);
	const color = tierRoleColor(tier);
	if (role.name === name && role.colors.primaryColor === color) return { tier, status: "unchanged", roleId: role.id, reason: null };
	try
	{
		await role.edit({
			name,
			colors: { primaryColor: color },
			reason: `Đổi tên và màu role danh hiệu ${tierPosition(tier)} theo bộ ${context.set.name} (yêu cầu của ${context.actor.id})`,
		});
		return { tier, status: "renamed", roleId: role.id, reason: null };
	}
	catch (error)
	{
		logger.warn(`Không đổi tên được role danh hiệu "${role.id}" (${tier.key}) ở server "${context.guild.id}":`, error);
		return skipped(tier, role.id, SETUP_API_FAILURE);
	}
}

/**
 * Tạo role mới (không có quyền gì, màu theo bậc) rồi gán cho bậc. `missingRoleId` là role đã gán nhưng không còn trong
 * server (null nếu bậc chưa gán). Đọc lại cấu hình sau khi tạo, liền trước bước ghi: nếu bậc vừa được gán role khác thì
 * không ghi đè và xoá role vừa tạo.
 */
async function createRole(context: SetupContext, tier: Tier, missingRoleId: string | null): Promise<TierRoleSetupEntry>
{
	const { guild, services, actor } = context;
	let role: Role;
	try
	{
		role = await guild.roles.create({
			name: tierRoleName(tier),
			colors: { primaryColor: tierRoleColor(tier) },
			permissions: [],
			hoist: false,
			mentionable: false,
			reason: `Tạo role danh hiệu ${tierPosition(tier)} của bộ ${context.set.name} (yêu cầu của ${actor.id})`,
		});
	}
	catch (error)
	{
		logger.warn(`Không tạo được role danh hiệu cho ${tier.key} ở server "${guild.id}":`, error);
		return skipped(tier, null, SETUP_API_FAILURE);
	}

	const current = assignedRoleId(services, guild.id, tier.key);
	if (current !== missingRoleId)
	{
		await deleteQuietly(role, `Huỷ role vừa tạo: ${tierPosition(tier)} vừa được gán role khác`);
		return skipped(tier, current, SETUP_CHANGED_MEANWHILE);
	}
	try
	{
		services.tierRoles.set(guild.id, tier.key, role.id, actor.id, { createdByBot: true });
	}
	catch (error)
	{
		logger.error(`Không lưu được role danh hiệu "${role.id}" vừa tạo cho ${tier.key} ở server "${guild.id}":`, error);
		await deleteQuietly(role, `Huỷ role vừa tạo: không lưu được cho ${tierPosition(tier)}`);
		return skipped(tier, null, SETUP_SAVE_FAILURE);
	}
	return { tier, status: missingRoleId === null ? "created" : "recreated", roleId: role.id, reason: null };
}

async function syncTier(context: SetupContext, tier: Tier): Promise<TierRoleSetupEntry>
{
	const roleId = assignedRoleId(context.services, context.guild.id, tier.key);
	const role = roleId === null ? undefined : context.guild.roles.cache.get(roleId);
	return role ? renameRole(context, tier, role) : createRole(context, tier, roleId);
}

/**
 * Tạo/đồng bộ role cho mọi bậc của bộ `set` (DEC-033), tuần tự từng bậc để tránh rate limit:
 * - bậc đã gán role còn tồn tại, an toàn (tierRoleSafetyIssue null, nên thấp hơn role cao nhất của bot), không đang là
 *   role admin bot/tạo vote/team, và người thao tác sửa được: đổi tên thành "{emoji} {tên}" và màu theo bậc (bỏ qua nếu đã đúng);
 * - bậc đã gán nhưng role không còn trong server, hoặc chưa gán: tạo role mới (permissions 0, không hoist, không mentionable)
 *   rồi gán với `createdByBot`;
 * - role không an toàn, cao hơn bot hay người thao tác, lỗi API: bỏ qua và ghi lý do vào kết quả (không throw).
 * UserError (không làm gì) nếu người thao tác hoặc bot thiếu Manage Roles, không tải được thông tin bot, hoặc đang có lượt
 * đồng bộ khác của cùng server. Cuối cùng ghi audit "tier_role.setup".
 */
export async function syncTierSetRoles(guild: Guild, set: TierSet, services: TierRoleServices, actor: TierRoleActor): Promise<TierRoleSetupResult>
{
	const callerIssue = callerManageRolesIssue(actor);
	if (callerIssue !== null) throw new UserError(callerIssue);
	if (runningSetups.has(guild.id)) throw new UserError(SETUP_RUNNING);

	runningSetups.add(guild.id);
	try
	{
		const me = await fetchBotMember(guild);
		if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) throw new UserError(BOT_NEEDS_MANAGE_ROLES);

		const context: SetupContext = { guild, set, services, actor, me };
		const entries: TierRoleSetupEntry[] = [];
		for (const tier of set.tiers) entries.push(await syncTier(context, tier));

		const count = (...statuses: TierRoleSetupStatus[]): number => entries.filter(entry => statuses.includes(entry.status)).length;
		const summary: TierRoleSetupSummary = {
			setKey: set.key,
			created: count("created", "recreated"),
			renamed: count("renamed"),
			skipped: count("skipped"),
		};
		services.tierRoles.recordSetup(guild.id, actor.id, summary);
		return { setKey: set.key, entries, summary };
	}
	finally
	{
		runningSetups.delete(guild.id);
	}
}
