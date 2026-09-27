import { GuildMember, OverwriteType, PermissionFlagsBits, PermissionsBitField, Role } from "discord.js";
import { TierRoleServiceApi } from "../modules/gamification/types";
import { logger } from "../shared/logger";
import { channelMention, roleMention } from "./format";
import { roleIdsOf } from "./members";

/**
 * Quyền quản trị, kiểm duyệt hoặc quyền đặc biệt: role có một trong các quyền này (ở cấp server hoặc trong phân quyền riêng
 * của một kênh) không được dùng làm role danh hiệu (DEC-031), vì bot tự gán role danh hiệu cho bất kỳ ai nhắn tin đủ nhiều.
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
	[PermissionFlagsBits.PinMessages, "Pin Messages"],
	[PermissionFlagsBits.BypassSlowmode, "Bypass Slowmode"],
	[PermissionFlagsBits.ViewGuildInsights, "View Server Insights"],
	[PermissionFlagsBits.CreateGuildExpressions, "Create Expressions"],
	[PermissionFlagsBits.CreateEvents, "Create Events"],
	[PermissionFlagsBits.ViewCreatorMonetizationAnalytics, "View Creator Monetization Analytics"],
];

/** Số kênh tối đa nêu tên trong thông báo về phân quyền riêng nguy hiểm của role. */
const MAX_LISTED_CHANNELS = 3;

/** Khoảng tối thiểu giữa hai cảnh báo cùng loại của một guild, để lỗi lặp lại ở mỗi tin nhắn không làm ngập log. */
const WARN_THROTTLE_MS = 10 * 60 * 1000;
const lastWarnings = new Map<string, number>();

/** Sau một lần thêm/bỏ role lỗi, bỏ qua đúng (guild, user, role) đó trong khoảng này thay vì gọi lại API ở mỗi tin nhắn. */
const ROLE_FAILURE_BACKOFF_MS = 10 * 60 * 1000;
/** Giới hạn số lỗi được nhớ cùng lúc, để map không phình vô hạn kể cả khi có rất nhiều lời gọi lỗi trong một khoảng ngắn. */
const MAX_REMEMBERED_FAILURES = 10_000;

export interface TierRoleSyncResult
{
	/** Role đã thêm cho member. */
	added: string[];
	/** Role đã bỏ khỏi member. */
	removed: string[];
	/** Role lẽ ra phải thêm hoặc bỏ nhưng không làm được (thiếu quyền, thứ bậc role, role nguy hiểm, lỗi API, vừa lỗi gần đây). */
	skipped: string[];
}

/**
 * Nhớ các khoá vừa lỗi trong `windowMs` để bỏ qua khoá đó tới khi hết hạn. Map giữ thứ tự chèn (ghi lại thì chuyển xuống
 * cuối), nên mục cũ nhất luôn ở đầu: mỗi lần dùng chỉ cần dọn các mục hết hạn ở đầu map. Vượt `maxEntries` thì bỏ mục cũ nhất.
 */
export class FailureBackoff
{
	private readonly failures = new Map<string, number>();

	constructor(private readonly windowMs: number, private readonly maxEntries: number)
	{}

	/** Số khoá lỗi đang được nhớ. */
	get size(): number
	{
		return this.failures.size;
	}

	/** Khoá có lỗi trong `windowMs` tính tới `now` không. */
	isBlocked(key: string, now: number): boolean
	{
		this.prune(now);
		const failedAt = this.failures.get(key);
		return failedAt !== undefined && now - failedAt < this.windowMs;
	}

	/** Ghi nhận khoá vừa lỗi lúc `now`. */
	record(key: string, now: number): void
	{
		this.failures.delete(key);
		this.failures.set(key, now);
		this.prune(now);
		for (const oldest of this.failures.keys())
		{
			if (this.failures.size <= this.maxEntries) break;
			this.failures.delete(oldest);
		}
	}

	private prune(now: number): void
	{
		for (const [key, failedAt] of this.failures)
		{
			if (now - failedAt < this.windowMs) break;
			this.failures.delete(key);
		}
	}
}

const recentFailures = new FailureBackoff(ROLE_FAILURE_BACKOFF_MS, MAX_REMEMBERED_FAILURES);

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

/** Tên các quyền nguy hiểm có trong `permissions` (Administrator không được tính là "có mọi quyền" ở đây, mà được liệt kê riêng). */
function dangerousPermissionNames(permissions: Readonly<PermissionsBitField>): string[]
{
	return DANGEROUS_PERMISSIONS.filter(([flag]) => permissions.has(flag, false)).map(([, name]) => name);
}

interface DangerousOverwrite
{
	channelId: string;
	permissions: string[];
}

/** Các kênh (kể cả category) có phân quyền riêng cho `role` cho phép quyền nguy hiểm. */
function dangerousOverwritesOf(role: Role): DangerousOverwrite[]
{
	const found: DangerousOverwrite[] = [];
	for (const channel of role.guild.channels.cache.values())
	{
		if (channel.isThread()) continue;
		const overwrite = channel.permissionOverwrites.cache.get(role.id);
		if (overwrite?.type !== OverwriteType.Role) continue;
		const permissions = dangerousPermissionNames(overwrite.allow);
		if (permissions.length > 0) found.push({ channelId: channel.id, permissions });
	}
	return found;
}

function describeOverwrites(overwrites: readonly DangerousOverwrite[]): string
{
	const listed = overwrites.slice(0, MAX_LISTED_CHANNELS).map(entry => `${channelMention(entry.channelId)} (${entry.permissions.join(", ")})`);
	const hidden = overwrites.length - listed.length;
	return hidden > 0 ? `${listed.join(", ")} và ${hidden} kênh khác` : listed.join(", ");
}

/**
 * Lý do (tiếng Việt, hiển thị cho admin) khiến `role` không được dùng làm role danh hiệu; null nếu dùng được.
 * Chặn: @everyone, role do bot/integration quản lý, role có quyền nguy hiểm ở cấp server hoặc trong phân quyền riêng của
 * bất kỳ kênh nào, role cho phép mọi người @mention (role bậc thấp gần như ai cũng có, nên ai cũng ping được cả server),
 * role không thấp hơn role cao nhất của bot. Hàm được gọi lại mỗi lần định gán, nên role bị đổi thành không an toàn sau này
 * sẽ ngừng được gán (vẫn gỡ được).
 */
export function tierRoleSafetyIssue(role: Role, botMember: GuildMember): string | null
{
	if (role.id === role.guild.id) return "Không thể dùng @everyone làm role danh hiệu.";
	if (role.managed) return "Không thể dùng role do bot hoặc integration quản lý làm role danh hiệu.";

	const dangerous = dangerousPermissionNames(role.permissions);
	if (dangerous.length > 0)
	{
		return `Không thể dùng ${roleMention(role.id)} làm role danh hiệu vì role này có quyền quản trị hoặc kiểm duyệt (${dangerous.join(", ")}). `
			+ "Bot tự gán role danh hiệu cho thành viên, nên hãy dùng role không có các quyền này.";
	}

	const overwrites = dangerousOverwritesOf(role);
	if (overwrites.length > 0)
	{
		return `Không thể dùng ${roleMention(role.id)} làm role danh hiệu vì phân quyền riêng của kênh cấp cho role này quyền quản trị hoặc kiểm duyệt: `
			+ `${describeOverwrites(overwrites)}. Hãy gỡ các quyền đó trong phần phân quyền của kênh, hoặc dùng role mới tạo riêng cho bậc danh hiệu.`;
	}

	if (role.mentionable)
	{
		return `Không thể dùng ${roleMention(role.id)} làm role danh hiệu vì ai cũng @mention được role này: role danh hiệu bậc thấp gần như `
			+ "mọi thành viên đều có, nên bất kỳ ai cũng ping được cả server. Vào **Server Settings → Roles → chọn role**, tắt "
			+ "**Allow anyone to @mention this role** rồi thử lại.";
	}

	const highest = botMember.roles.highest;
	if (role.position >= highest.position)
	{
		return `Bot không quản lý được ${roleMention(role.id)} vì role này không thấp hơn role cao nhất của bot (${roleMention(highest.id)}). `
			+ "Vào **Server Settings → Roles**, kéo role của bot lên trên các role danh hiệu rồi thử lại.";
	}
	return null;
}

/** Bot có thể gỡ role này khỏi member không (không cần xét quyền nguy hiểm: gỡ role chỉ làm giảm quyền). */
function canRemoveRole(role: Role, botMember: GuildMember): boolean
{
	return role.id !== role.guild.id && !role.managed && role.position < botMember.roles.highest.position;
}

/**
 * Thêm hoặc bỏ một role; lỗi API chỉ ghi cảnh báo. Lỗi được nhớ trong ROLE_FAILURE_BACKOFF_MS; trong thời gian đó không gọi
 * lại API cho đúng (guild, user, role) này. Gọi từng role (PUT/DELETE) thay vì PATCH cả danh sách role từ cache.
 */
async function changeRole(member: GuildMember, roleId: string, action: "add" | "remove", reason: string): Promise<boolean>
{
	const key = `${member.guild.id}:${member.id}:${roleId}`;
	if (recentFailures.isBlocked(key, Date.now())) return false;
	try
	{
		if (action === "add") await member.roles.add(roleId, reason);
		else await member.roles.remove(roleId, reason);
		return true;
	}
	catch (error)
	{
		recentFailures.record(key, Date.now());
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
				+ "có quyền quản trị/kiểm duyệt (ở server hoặc trong phân quyền riêng của kênh), cho phép mọi người @mention, "
				+ "hoặc không thấp hơn role cao nhất của bot.",
		);
	}
}

/**
 * Đưa role danh hiệu của member về đúng bậc của `level` (DEC-031): thêm role của bậc hiện tại, bỏ role của
 * các bậc khác. Không gọi API nếu không có gì cần đổi. Role không quản lý được, lỗi API, hoặc vừa lỗi trong
 * ROLE_FAILURE_BACKOFF_MS thì đưa vào `skipped` và ghi cảnh báo (có throttle theo guild). Không bao giờ ném lỗi.
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
