import { Guild, GuildMember, PermissionFlagsBits, RESTJSONErrorCodes, Role } from "discord.js";
import { Tier, TierKey, TierSet, TierSetKey } from "../modules/activity/tiers";
import { TierRoleMapping, TierRoleSetupSummary } from "../modules/gamification/types";
import { AppServices } from "../services";
import { UserError } from "../shared/errors";
import { logger } from "../shared/logger";
import { roleMention } from "./format";
import { discordErrorCode } from "./memberDirectory";
import { tierRoleSafetyIssue } from "./roleSync";

/*
 * Thao tác role danh hiệu ở tầng Discord (DEC-031, DEC-033): gán role cho một bậc sau khi kiểm tra quyền, tạo/đổi tên
 * role theo bộ danh hiệu đang dùng, và bỏ gán (xoá luôn role do bot tạo). Bot chỉ làm thay người gọi những gì chính người
 * gọi làm được theo luật Discord (có Manage Roles, role nằm dưới role cao nhất của họ), để bot không thành đường vòng tự
 * cấp role (LL-017).
 */

export const BOT_MEMBER_UNAVAILABLE = "Không đọc được thông tin của bot trong server. Vui lòng thử lại sau.";
export const CALLER_NEEDS_MANAGE_ROLES = "Bạn cần quyền **Manage Roles** để gán hoặc tạo role danh hiệu, "
	+ "vì bot sẽ thay bạn gán các role này cho thành viên.";
export const BOT_NEEDS_MANAGE_ROLES = "Bot chưa có quyền **Manage Roles** nên không tạo hay đổi tên được role. "
	+ "Hãy cấp quyền này cho role của bot (Server Settings → Roles) rồi thử lại.";
export const SETUP_RUNNING = "Bot đang tạo/đồng bộ role danh hiệu cho server này. Vui lòng chờ xong rồi thử lại.";
export const SETUP_API_FAILURE = "Discord báo lỗi khi thao tác với role (lỗi mạng hoặc lỗi tạm thời); xem log của bot rồi thử lại.";
export const SETUP_MISSING_PERMISSIONS = "Discord báo bot thiếu quyền: kiểm tra bot còn quyền **Manage Roles** "
	+ "và role của bot nằm trên các role danh hiệu (Server Settings → Roles).";
export const SETUP_ROLE_LIMIT = "Server đã đạt số role tối đa của Discord nên bot không tạo thêm được, và dừng tạo role cho các bậc còn lại. "
	+ "Hãy xoá bớt role không dùng rồi bấm lại.";
export const SETUP_ROLE_LIMIT_PENDING = "Chưa tạo vì server đã đạt số role tối đa của Discord; xoá bớt role không dùng rồi bấm lại.";
export const SETUP_CHANGED_MEANWHILE = "Bậc này vừa được gán role khác trong lúc bot đang đồng bộ, nên bot giữ nguyên role đó.";
export const SETUP_CLEARED_MEANWHILE = "Bậc này vừa được bỏ gán trong lúc bot đang đồng bộ, nên bot không gán role mới.";
export const SETUP_REASSIGNED_AFTER_RENAME = "Trong lúc bot đổi tên, bậc này đã được gán role khác; role vừa đổi tên không còn là role của bậc.";
const SETUP_SAVE_FAILURE = "Không lưu được role vừa tạo; xem log của bot.";

export const CLEAR_CALLER_CANNOT_DELETE = "Bạn không có quyền **Manage Roles** ở cấp server, nên bot không xoá role thay bạn.";
export const CLEAR_BOT_UNAVAILABLE = "Không đọc được thông tin của bot trong server.";
export const CLEAR_BOT_NEEDS_MANAGE_ROLES = "Bot chưa có quyền **Manage Roles**.";
export const CLEAR_BOT_HIERARCHY = "Role này không thấp hơn role cao nhất của bot.";
export const CLEAR_DELETE_FAILURE = "Discord báo lỗi khi xoá role; xem log của bot.";

/** Các service mà thao tác role danh hiệu cần. */
export type TierRoleServices = Pick<AppServices, "guildConfig" | "teams" | "tierRoles" | "tierSets">;

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

/**
 * Vai trò khác của role trong cấu hình bot (role admin bot, role tạo vote, role duyệt contribution, team, role quản lý retro;
 * DEC-044, DEC-051); null nếu không có.
 */
export function otherRoleUsage(services: TierRoleServices & Partial<Pick<AppServices, "retro">>, guildId: string, roleId: string): string | null
{
	const settings = services.guildConfig.getSettings(guildId);
	if (settings.adminRoleIds.includes(roleId)) return "role admin bot";
	if (settings.pollCreatorRoleIds.includes(roleId)) return "role được tạo vote";
	if (settings.contributionReviewerRoleIds.includes(roleId)) return "role duyệt contribution";
	if (services.teams.list(guildId).includes(roleId)) return "role của một team";
	if (services.retro?.getConfig(guildId).managerRoleIds.includes(roleId)) return "role quản lý retro";
	return null;
}

/** Lý do không dùng được role làm role danh hiệu vì role đang giữ vai trò khác trong cấu hình bot; null nếu không có. */
export function otherRoleUsageIssue(services: TierRoleServices, guildId: string, roleId: string): string | null
{
	const usage = otherRoleUsage(services, guildId, roleId);
	if (usage === null) return null;
	return `Không thể dùng ${roleMention(roleId)} làm role danh hiệu vì role này đang là ${usage}. `
		+ "Bot tự gán role danh hiệu cho người đủ level và gỡ khỏi người khác, nên hãy tạo một role mới dành riêng cho bậc danh hiệu.";
}

function assignedMapping(services: TierRoleServices, guildId: string, tierKey: TierKey): TierRoleMapping | null
{
	return services.tierRoles.list(guildId).find(mapping => mapping.tierKey === tierKey) ?? null;
}

function assignedRoleId(services: TierRoleServices, guildId: string, tierKey: TierKey): string | null
{
	return assignedMapping(services, guildId, tierKey)?.roleId ?? null;
}

export interface TierRoleAssignment
{
	/** Role bậc này giữ trước khi gán; null nếu chưa gán. */
	previousRoleId: string | null;
	/** Role giữ trước đó do bot tạo (bot không tự xoá khi đổi sang role khác; admin tự xoá nếu không dùng nữa). */
	previousCreatedByBot: boolean;
	/** Bot có Manage Roles không (không có thì vẫn lưu, nhưng chưa tự gán được role cho thành viên). */
	botCanManageRoles: boolean;
}

/**
 * Gán `role` cho bậc `tierKey` sau khi kiểm tra: người thao tác tự gán được role đó, role an toàn và bot quản lý được
 * (theo thông tin mới nhất của bot), role không đang giữ vai trò khác trong cấu hình bot. Lỗi là UserError; không ghi gì.
 * Dùng chung cho `/config tier set-role`, ô chọn role trong bảng điều khiển và trang web. `options.createdByBot` chỉ dùng khi
 * chuyển một role do bot tạo từ bậc khác sang (trang web), để nút tạo/đồng bộ vẫn đổi tên được role đó; mặc định là role do
 * admin gán.
 */
export async function assignTierRole(
	guild: Guild,
	actor: TierRoleActor,
	services: TierRoleServices,
	tierKey: TierKey,
	role: Role,
	options: { createdByBot?: boolean } = {},
): Promise<TierRoleAssignment>
{
	const callerIssue = callerRoleIssue(actor, role);
	if (callerIssue !== null) throw new UserError(callerIssue);

	const me = await fetchBotMember(guild);
	const issue = tierRoleSafetyIssue(role, me);
	if (issue !== null) throw new UserError(issue);

	// Kiểm tra vai trò khác của role sau await, liền trước bước ghi, để không có await chen giữa bước đọc và bước ghi.
	const usage = otherRoleUsageIssue(services, guild.id, role.id);
	if (usage !== null) throw new UserError(usage);
	const previous = assignedMapping(services, guild.id, tierKey);
	services.tierRoles.set(guild.id, tierKey, role.id, actor.id, { createdByBot: options.createdByBot === true });
	return {
		previousRoleId: previous?.roleId ?? null,
		previousCreatedByBot: previous !== null && previous.roleId !== role.id && previous.createdByBot,
		botCanManageRoles: me.permissions.has(PermissionFlagsBits.ManageRoles),
	};
}

// ---------- Bỏ gán role ----------

/**
 * Role của bậc sau khi bỏ gán: "none" (role do admin gán, bot không xoá), "absent" (role do bot tạo nhưng đã không còn
 * trong server), "deleted" (bot đã xoá role do bot tạo), "kept" (role do bot tạo nhưng bot không xoá, xem `reason`).
 */
export type TierRoleDeletion =
	| { kind: "none" }
	| { kind: "absent" }
	| { kind: "deleted" }
	| { kind: "kept"; reason: string };

export interface TierRoleClearOutcome
{
	/** "cleared": đã bỏ gán; "unassigned": bậc vốn chưa gán; "changed": bậc vừa đổi role trong lúc bot xử lý nên không bỏ gán gì. */
	status: "cleared" | "unassigned" | "changed";
	/** Role của bậc lúc bắt đầu; null nếu bậc chưa gán. */
	roleId: string | null;
	deletion: TierRoleDeletion;
}

/**
 * Lý do bot không xoá `role` (thiếu thông tin bot, thiếu Manage Roles, role không thấp hơn bot, role đang giữ vai trò khác
 * trong cấu hình bot); null nếu xoá được.
 */
function deleteIssue(services: TierRoleServices, role: Role, me: GuildMember | null): string | null
{
	if (me === null) return CLEAR_BOT_UNAVAILABLE;
	if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return CLEAR_BOT_NEEDS_MANAGE_ROLES;
	if (role.managed || role.position >= me.roles.highest.position) return CLEAR_BOT_HIERARCHY;
	const usage = otherRoleUsage(services, role.guild.id, role.id);
	return usage === null ? null : `Role này đang là ${usage} trong cấu hình bot.`;
}

async function fetchBotMemberOrNull(guild: Guild): Promise<GuildMember | null>
{
	try
	{
		return await fetchBotMember(guild);
	}
	catch
	{
		return null;
	}
}

/** Bỏ gán ngay (đọc và ghi liền nhau, không có await chen giữa). */
function clearNow(services: TierRoleServices, guild: Guild, tierKey: TierKey, actor: TierRoleActor, roleId: string, deletion: TierRoleDeletion): TierRoleClearOutcome
{
	const cleared = services.tierRoles.clear(guild.id, tierKey, actor.id);
	return cleared ? { status: "cleared", roleId, deletion } : { status: "unassigned", roleId: null, deletion: { kind: "none" } };
}

/**
 * Bỏ role của bậc `tierKey` (`/config tier clear-role` và xoá lựa chọn trên bảng điều khiển). Role do bot tạo không còn ý
 * nghĩa nào khác, nên bot xoá luôn khỏi server nếu: người thao tác có Manage Roles cấp server và role nằm dưới role cao nhất
 * của họ (LL-017, LL-019), bot có Manage Roles, role nằm dưới role của bot và không đang là role admin bot/tạo vote/team
 * (dữ liệu cũ). Không đủ điều kiện hoặc xoá lỗi thì vẫn bỏ gán
 * và trả lý do trong `deletion`. Xoá role trước rồi mới bỏ gán, để audit "tier_role.clear" ghi được `deletedRoleId`; trước
 * mỗi bước ghi đều đọc lại cấu hình, nếu bậc vừa đổi role thì không bỏ gán gì ("changed").
 */
export async function clearTierRoleAssignment(guild: Guild, actor: TierRoleActor, services: TierRoleServices, tierKey: TierKey): Promise<TierRoleClearOutcome>
{
	const mapping = assignedMapping(services, guild.id, tierKey);
	if (mapping === null) return { status: "unassigned", roleId: null, deletion: { kind: "none" } };
	if (!mapping.createdByBot) return clearNow(services, guild, tierKey, actor, mapping.roleId, { kind: "none" });
	const role = guild.roles.cache.get(mapping.roleId);
	if (!role) return clearNow(services, guild, tierKey, actor, mapping.roleId, { kind: "absent" });

	const callerIssue = actor.isOwner || actor.canManageRoles ? callerRoleIssue(actor, role, "xoá") : CLEAR_CALLER_CANNOT_DELETE;
	if (callerIssue !== null) return clearNow(services, guild, tierKey, actor, role.id, { kind: "kept", reason: callerIssue });

	const me = await fetchBotMemberOrNull(guild);
	if (assignedRoleId(services, guild.id, tierKey) !== role.id) return { status: "changed", roleId: role.id, deletion: { kind: "none" } };
	const keepReason = deleteIssue(services, role, me);
	if (keepReason !== null) return clearNow(services, guild, tierKey, actor, role.id, { kind: "kept", reason: keepReason });

	let deletion: TierRoleDeletion;
	try
	{
		await role.delete(`Bỏ gán role danh hiệu ${tierKey} do bot tạo (yêu cầu của ${actor.id})`);
		deletion = { kind: "deleted" };
	}
	catch (error)
	{
		logger.warn(`Không xoá được role danh hiệu "${role.id}" do bot tạo ở server "${guild.id}":`, error);
		deletion = { kind: "kept", reason: CLEAR_DELETE_FAILURE };
	}

	if (assignedRoleId(services, guild.id, tierKey) !== role.id)
	{
		if (deletion.kind === "deleted") logger.warn(`Đã xoá role "${role.id}" do bot tạo nhưng ${tierKey} ở server "${guild.id}" vừa đổi role, nên không bỏ gán.`);
		return { status: "changed", roleId: role.id, deletion };
	}
	services.tierRoles.clear(guild.id, tierKey, actor.id, deletion.kind === "deleted" ? { deletedRoleId: role.id } : {});
	return { status: "cleared", roleId: role.id, deletion };
}

// ---------- Tạo/đồng bộ role theo bộ ----------

/**
 * Kết quả của một bậc: "created" (tạo mới cho bậc chưa gán), "recreated" (role đã gán không còn nên tạo lại),
 * "renamed" (đổi tên/màu role do bot tạo), "unchanged" (đã đúng tên và màu), "kept" (role do admin tự gán: giữ nguyên
 * tên), "skipped" (bỏ qua, xem `reason`).
 */
export type TierRoleSetupStatus = "created" | "recreated" | "renamed" | "unchanged" | "kept" | "skipped";

export interface TierRoleSetupEntry
{
	/** Bậc theo bộ đang đồng bộ (tên, emoji đã áp tên tuỳ chỉnh). */
	tier: Tier;
	status: TierRoleSetupStatus;
	/** Role của bậc sau khi đồng bộ; null nếu bỏ qua mà bậc không có role còn tồn tại. */
	roleId: string | null;
	/** Lý do bỏ qua, hoặc ghi chú thêm cho trạng thái khác (tiếng Việt, hiển thị cho admin); null nếu không có. */
	reason: string | null;
	/** Tên role trước khi bot đổi (chỉ có với "renamed"). */
	previousName?: string;
	/** Role bot vừa tạo nhưng không dùng được và không xoá lại được: admin cần xoá thủ công. */
	orphanedRoleId?: string;
}

export interface TierRoleSetupResult
{
	setKey: TierSetKey;
	/** Đúng thứ tự bậc của bộ (bot xử lý từ bậc cao nhất xuống bậc thấp nhất). */
	entries: TierRoleSetupEntry[];
	/** Số đếm và danh sách role đã ghi vào audit "tier_role.setup" (không ghi nếu không có gì thay đổi). */
	summary: TierRoleSetupSummary;
	/** Bộ hoặc tên bậc vừa đổi trong lúc bot đang chạy: tên role có thể chưa theo tên mới, cần chạy lại. */
	setChangedMeanwhile: boolean;
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
	/** Discord báo server đã đạt số role tối đa (30005): không tạo thêm role cho các bậc còn lại. */
	roleLimitReached: boolean;
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

/** Lý do hiển thị cho một lỗi API khi tạo/sửa role: thiếu quyền (50013) có lý do riêng, lỗi khác dùng lý do chung. */
function apiFailureReason(error: unknown): string
{
	return discordErrorCode(error) === RESTJSONErrorCodes.MissingPermissions ? SETUP_MISSING_PERMISSIONS : SETUP_API_FAILURE;
}

/** Xoá role vừa tạo; false nếu không xoá được (đã ghi cảnh báo). */
async function deleteQuietly(role: Role, reason: string): Promise<boolean>
{
	try
	{
		await role.delete(reason);
		return true;
	}
	catch (error)
	{
		logger.warn(`Không xoá được role "${role.id}" vừa tạo ở server "${role.guild.id}":`, error);
		return false;
	}
}

/** Bỏ qua bậc và xoá role vừa tạo; không xoá được thì ghi role đó là role mồ côi. */
async function discardCreated(role: Role, tier: Tier, roleId: string | null, reason: string, deleteReason: string): Promise<TierRoleSetupEntry>
{
	const entry = skipped(tier, roleId, reason);
	if (!(await deleteQuietly(role, deleteReason))) entry.orphanedRoleId = role.id;
	return entry;
}

/** Lý do không đụng tới role vì role đang giữ vai trò khác trong cấu hình bot; null nếu không có. */
function usageIssue(context: SetupContext, role: Role): string | null
{
	const usage = otherRoleUsage(context.services, context.guild.id, role.id);
	return usage === null ? null : `${roleMention(role.id)} đang là ${usage}, nên bot không đổi tên role này. Hãy gán cho bậc này một role riêng.`;
}

/**
 * Role đã gán còn trong server: role không an toàn hoặc đang giữ vai trò khác thì bỏ qua; role do admin tự gán thì giữ
 * nguyên tên ("kept", hoặc "unchanged" nếu đã đúng); role do bot tạo thì đổi tên/màu nếu người thao tác sửa được.
 */
async function renameRole(context: SetupContext, tier: Tier, role: Role, createdByBot: boolean): Promise<TierRoleSetupEntry>
{
	const issue = tierRoleSafetyIssue(role, context.me) ?? usageIssue(context, role);
	if (issue !== null) return skipped(tier, role.id, issue);

	const name = tierRoleName(tier);
	const color = tierRoleColor(tier);
	if (role.name === name && role.colors.primaryColor === color) return { tier, status: "unchanged", roleId: role.id, reason: null };
	if (!createdByBot) return { tier, status: "kept", roleId: role.id, reason: null };

	const callerIssue = callerRoleIssue(context.actor, role, "sửa");
	if (callerIssue !== null) return skipped(tier, role.id, callerIssue);
	const previousName = role.name;
	try
	{
		await role.edit({
			name,
			colors: { primaryColor: color },
			reason: `Đổi tên và màu role danh hiệu ${tierPosition(tier)} theo bộ ${context.set.name} (yêu cầu của ${context.actor.id})`,
		});
	}
	catch (error)
	{
		logger.warn(`Không đổi tên được role danh hiệu "${role.id}" (${tier.key}) ở server "${context.guild.id}":`, error);
		return skipped(tier, role.id, apiFailureReason(error));
	}
	const stillAssigned = assignedRoleId(context.services, context.guild.id, tier.key) === role.id;
	return { tier, status: "renamed", roleId: role.id, reason: stillAssigned ? null : SETUP_REASSIGNED_AFTER_RENAME, previousName };
}

/**
 * Tạo role mới (không có quyền gì, màu theo bậc) rồi gán cho bậc. `missingRoleId` là role đã gán nhưng không còn trong
 * server (null nếu bậc chưa gán). Đọc lại cấu hình sau khi tạo, liền trước bước ghi: nếu bậc vừa được bỏ gán hoặc gán role
 * khác thì không ghi đè và xoá role vừa tạo. Discord báo quá số role tối đa thì dừng tạo cho các bậc còn lại.
 */
async function createRole(context: SetupContext, tier: Tier, missingRoleId: string | null): Promise<TierRoleSetupEntry>
{
	const { guild, services, actor } = context;
	if (context.roleLimitReached) return skipped(tier, null, SETUP_ROLE_LIMIT_PENDING);
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
		if (discordErrorCode(error) !== RESTJSONErrorCodes.MaximumNumberOfGuildRolesReached) return skipped(tier, null, apiFailureReason(error));
		context.roleLimitReached = true;
		return skipped(tier, null, SETUP_ROLE_LIMIT);
	}

	const current = assignedRoleId(services, guild.id, tier.key);
	if (current !== missingRoleId)
	{
		const cleared = current === null;
		return discardCreated(
			role,
			tier,
			current,
			cleared ? SETUP_CLEARED_MEANWHILE : SETUP_CHANGED_MEANWHILE,
			`Huỷ role vừa tạo: ${tierPosition(tier)} vừa được ${cleared ? "bỏ gán" : "gán role khác"}`,
		);
	}
	try
	{
		services.tierRoles.set(guild.id, tier.key, role.id, actor.id, { createdByBot: true });
	}
	catch (error)
	{
		logger.error(`Không lưu được role danh hiệu "${role.id}" vừa tạo cho ${tier.key} ở server "${guild.id}":`, error);
		return discardCreated(role, tier, null, SETUP_SAVE_FAILURE, `Huỷ role vừa tạo: không lưu được cho ${tierPosition(tier)}`);
	}
	return { tier, status: missingRoleId === null ? "created" : "recreated", roleId: role.id, reason: null };
}

async function syncTier(context: SetupContext, tier: Tier): Promise<TierRoleSetupEntry>
{
	const mapping = assignedMapping(context.services, context.guild.id, tier.key);
	const role = mapping === null ? undefined : context.guild.roles.cache.get(mapping.roleId);
	return mapping !== null && role ? renameRole(context, tier, role, mapping.createdByBot) : createRole(context, tier, mapping?.roleId ?? null);
}

function summarize(setKey: TierSetKey, entries: readonly TierRoleSetupEntry[]): TierRoleSetupSummary
{
	const count = (...statuses: TierRoleSetupStatus[]): number => entries.filter(entry => statuses.includes(entry.status)).length;
	return {
		setKey,
		created: count("created", "recreated"),
		renamed: count("renamed"),
		skipped: count("skipped"),
		renamedRoles: entries.flatMap(entry => (entry.status === "renamed" && entry.roleId !== null && entry.previousName !== undefined
			? [{ roleId: entry.roleId, oldName: entry.previousName }]
			: [])),
		keptRoles: entries.flatMap(entry => (entry.status === "kept" && entry.roleId !== null ? [entry.roleId] : [])),
		orphanedRoles: entries.flatMap(entry => (entry.orphanedRoleId === undefined ? [] : [entry.orphanedRoleId])),
	};
}

/** Có gì đáng ghi audit không: tạo, đổi tên, bỏ qua, giữ nguyên tên role do admin gán, hoặc để lại role mồ côi. */
function hasChanges(summary: TierRoleSetupSummary): boolean
{
	return summary.created + summary.renamed + summary.skipped + summary.keptRoles.length + summary.orphanedRoles.length > 0;
}

/** Ghi audit "tier_role.setup" nếu có thay đổi; lỗi chỉ ghi log để không che kết quả hay lỗi gốc của lượt đồng bộ. */
function recordSetup(services: TierRoleServices, guildId: string, actorId: string, summary: TierRoleSetupSummary): void
{
	if (!hasChanges(summary)) return;
	try
	{
		services.tierRoles.recordSetup(guildId, actorId, summary);
	}
	catch (error)
	{
		logger.error(`Không ghi được audit tạo/đồng bộ role danh hiệu ở server "${guildId}":`, error);
	}
}

/** Hai bộ có cùng khoá, cùng tên và emoji ở mọi bậc không. */
function sameNames(a: TierSet, b: TierSet): boolean
{
	return a.key === b.key && a.tiers.every((tier, index) => tier.name === b.tiers[index]?.name && tier.emoji === b.tiers[index]?.emoji);
}

/**
 * Tạo/đồng bộ role cho mọi bậc của bộ `set` (DEC-033), tuần tự từng bậc để tránh rate limit, từ bậc 8 xuống bậc 1 (role
 * mới nằm ngay trên @everyone, nên thứ tự này cho danh sách role tăng dần từ dưới lên):
 * - bậc đã gán role do bot tạo, còn tồn tại, an toàn (tierRoleSafetyIssue null, nên thấp hơn role cao nhất của bot), không
 *   đang là role admin bot/tạo vote/team, và người thao tác sửa được: đổi tên thành "{emoji} {tên}" và màu theo bậc;
 * - bậc đã gán role do admin tự gán: giữ nguyên tên và màu ("kept");
 * - bậc đã gán nhưng role không còn trong server, hoặc chưa gán: tạo role mới (permissions 0, không hoist, không mentionable)
 *   rồi gán với `createdByBot`; Discord báo quá số role tối đa (30005) thì dừng tạo cho các bậc còn lại;
 * - role không an toàn, cao hơn bot hay người thao tác, lỗi API: bỏ qua và ghi lý do vào kết quả (không throw).
 * UserError (không làm gì) nếu người thao tác hoặc bot thiếu Manage Roles, không tải được thông tin bot, hoặc đang có lượt
 * đồng bộ khác của cùng server. Audit "tier_role.setup" luôn được ghi (kể cả khi lỗi giữa chừng) trừ khi không có gì thay đổi.
 */
export async function syncTierSetRoles(guild: Guild, set: TierSet, services: TierRoleServices, actor: TierRoleActor): Promise<TierRoleSetupResult>
{
	const callerIssue = callerManageRolesIssue(actor);
	if (callerIssue !== null) throw new UserError(callerIssue);
	if (runningSetups.has(guild.id)) throw new UserError(SETUP_RUNNING);

	runningSetups.add(guild.id);
	const entries: TierRoleSetupEntry[] = [];
	try
	{
		const me = await fetchBotMember(guild);
		if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) throw new UserError(BOT_NEEDS_MANAGE_ROLES);

		const context: SetupContext = { guild, set, services, actor, me, roleLimitReached: false };
		for (const tier of [...set.tiers].reverse()) entries.unshift(await syncTier(context, tier));
	}
	finally
	{
		runningSetups.delete(guild.id);
		recordSetup(services, guild.id, actor.id, summarize(set.key, entries));
	}
	return {
		setKey: set.key,
		entries,
		summary: summarize(set.key, entries),
		setChangedMeanwhile: !sameNames(set, services.tierSets.current(guild.id)),
	};
}
