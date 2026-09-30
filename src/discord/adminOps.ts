// Thao tác quản trị điểm, contribution và sao lưu dùng chung cho lệnh `/admin` (tầng Discord) và trang web quản trị (DEC-041),
// để hai nơi luôn cùng quy tắc. Sửa message vote sau khi đóng cũng đi qua AdminActions.refreshPoll. Lỗi hiển thị cho người dùng là UserError; thông báo trả về dùng
// markdown/mention của Discord (web tự chuyển sang HTML bằng discordText).
import { basename } from "path";
import type { Guild, GuildMember } from "discord.js";
import type DiscordClient from "../classes/DiscordClient";
import type { BackupService } from "../db/backup";
import { levelInfo } from "../modules/activity/levels";
import { Contribution } from "../modules/contribution/types";
import { TierRoleServiceApi } from "../modules/gamification/types";
import { Poll } from "../modules/poll/types";
import { AppServices } from "../services";
import { UserError } from "../shared/errors";
import { formatNumber, relativeTime, userMention } from "./format";
import { isNotFoundError } from "./guards";
import { MemberDisplay } from "./memberDirectory";
import { refreshContributionMessage } from "./messages";
import { refreshPollMessage } from "./pollScheduler";
import { syncTierRoles, TierRoleSyncResult } from "./roleSync";
import { inlineText, tierRoleSyncLine } from "./views/admin";

/** Chuỗi phải nhập đúng để reset toàn server. */
export const RESET_CONFIRMATION = "XAC NHAN";
/** Số XP hoặc điểm contribution tối đa cho một lần cộng/trừ. */
export const MAX_ADJUST = 1_000_000;
export const REASON_MAX_LENGTH = 200;
/** Số biến động XP gần nhất hiện ở hồ sơ thành viên (`/admin xp view`). */
export const RECENT_XP_EVENTS = 10;
/** Khoảng tối thiểu giữa hai lần sao lưu thủ công, chống spam làm đầy ổ đĩa. */
export const MANUAL_BACKUP_COOLDOWN_MS = 10 * 60 * 1000;
/** Lý do ghi vào audit log của Discord khi bot đổi role danh hiệu sau thao tác của admin (DEC-031). */
export const TIER_ROLE_REASON = "Danh hiệu theo level (admin điều chỉnh XP)";
export const RESET_ALL_TIER_ROLE_NOTE = "Role danh hiệu sẽ tự cập nhật khi từng thành viên nhắn tin được XP.";
export const BOT_TARGET = "Không thể thao tác với bot.";
export const USER_NOT_FOUND = "Không tìm thấy tài khoản Discord có ID này.";
export const USER_LOOKUP_UNAVAILABLE = "Không lấy được thông tin tài khoản từ Discord (Discord đang lỗi hoặc mạng chậm). Hãy thử lại sau ít phút.";
const TITLE_DISPLAY_MAX = 100;

/** Người được thao tác: `roleIds` là role hiện có (snapshot team, rỗng nếu đã rời server); `actorId` là admin thao tác. */
export interface AdjustTarget
{
	guildId: string;
	userId: string;
	roleIds: readonly string[];
	actorId: string;
}

/**
 * Tác dụng phụ lên Discord của thao tác quản trị. Lệnh Discord dùng DEFAULT_ADMIN_ACTIONS; web nhận qua `WebDeps.adminActions`
 * để test thay bằng hàm giả.
 */
export interface AdminActions
{
	/** Sửa message công khai của contribution theo trạng thái hiện tại (sau khi gỡ). Không ném lỗi; false nếu không sửa được. */
	refreshContribution(client: DiscordClient, contribution: Contribution): Promise<boolean>;
	/** Sửa message của vote theo trạng thái hiện tại (sau khi đóng). Không ném lỗi; false nếu không sửa được. */
	refreshPoll(client: DiscordClient, poll: Poll): Promise<boolean>;
	/** Đưa role danh hiệu của member về đúng `level` (DEC-031). */
	syncTierRoles(member: GuildMember, level: number, tierRoles: TierRoleServiceApi, reason: string): Promise<TierRoleSyncResult>;
	/** Thành viên có tên (username hoặc nickname) bắt đầu bằng `query`, qua REST (không cần intent GuildMembers), tối đa `limit`. */
	searchMembers(guild: Guild, query: string, limit: number): Promise<GuildMember[]>;
	/** Tên hiển thị và avatar của nhiều người (MemberDirectory của client, có cache). */
	displays(client: DiscordClient, guild: Guild, userIds: readonly string[]): Promise<Map<string, MemberDisplay>>;
	/**
	 * Tài khoản Discord `userId` (kể cả người không còn trong server) qua REST: null nếu Discord báo không có tài khoản này.
	 * Discord lỗi thì ném UserError(USER_LOOKUP_UNAVAILABLE).
	 */
	fetchUser(client: DiscordClient, userId: string): Promise<{ bot: boolean } | null>;
}

async function fetchUserOrNull(client: DiscordClient, userId: string): Promise<{ bot: boolean } | null>
{
	try
	{
		const user = await client.users.fetch(userId, { cache: false, force: true });
		return { bot: user.bot };
	}
	catch (error)
	{
		if (isNotFoundError(error)) return null;
		throw new UserError(USER_LOOKUP_UNAVAILABLE);
	}
}

export const DEFAULT_ADMIN_ACTIONS: AdminActions = {
	refreshContribution: refreshContributionMessage,
	refreshPoll: refreshPollMessage,
	syncTierRoles,
	searchMembers: async (guild, query, limit) => [...(await guild.members.search({ query, limit, cache: false })).values()],
	displays: (client, guild, userIds) => client.members.resolve(guild, userIds),
	fetchUser: fetchUserOrNull,
};

/**
 * Người được chỉnh điểm phải là tài khoản Discord thật và không phải bot, như option `thanh-vien` của lệnh `/admin`. `member`
 * là thành viên vừa lấy từ Discord (null nếu không còn trong server): khi đó hỏi tài khoản qua `actions.fetchUser`.
 */
export async function assertAdjustableUser(actions: AdminActions, client: DiscordClient, member: GuildMember | null, userId: string): Promise<void>
{
	if (member)
	{
		if (member.user.bot) throw new UserError(BOT_TARGET);
		return;
	}
	const user = await actions.fetchUser(client, userId);
	if (user === null) throw new UserError(USER_NOT_FOUND);
	if (user.bot) throw new UserError(BOT_TARGET);
}

/** UserError nếu `input` (đã bỏ khoảng trắng hai đầu) khác RESET_CONFIRMATION. */
export function assertResetConfirmation(input: string): void
{
	if (input.trim() !== RESET_CONFIRMATION) throw new UserError(`Để reset toàn bộ, nhập chính xác: ${RESET_CONFIRMATION}`);
}

/** Lý do ghi audit: bỏ khoảng trắng hai đầu, rỗng thì null. UserError nếu dài quá REASON_MAX_LENGTH ký tự. */
export function normalizeReason(raw: string | null | undefined): string | null
{
	const reason = raw?.trim() ?? "";
	if (Array.from(reason).length > REASON_MAX_LENGTH) throw new UserError(`Lý do tối đa ${REASON_MAX_LENGTH} ký tự.`);
	return reason.length > 0 ? reason : null;
}

/** Số XP cộng hoặc trừ (luôn dương): số nguyên từ 1 đến MAX_ADJUST. */
export function assertXpAmount(amount: number): void
{
	if (!Number.isInteger(amount) || amount < 1 || amount > MAX_ADJUST)
	{
		throw new UserError(`Số XP phải là số nguyên từ 1 đến ${formatNumber(MAX_ADJUST)}.`);
	}
}

/** Điểm contribution cộng (dương) hoặc trừ (âm): số nguyên khác 0, trị tuyệt đối không quá MAX_ADJUST. */
export function assertContributionDelta(delta: number): void
{
	if (!Number.isInteger(delta) || Math.abs(delta) > MAX_ADJUST)
	{
		throw new UserError(`Số điểm phải là số nguyên từ -${formatNumber(MAX_ADJUST)} đến ${formatNumber(MAX_ADJUST)}.`);
	}
	if (delta === 0) throw new UserError("Số điểm phải khác 0.");
}

/** Cộng (`sign` = 1) hoặc trừ (`sign` = -1) `amount` XP. Ghi audit qua service. */
export function adjustMemberXp(services: AppServices, target: AdjustTarget, sign: 1 | -1, amount: number, reason: string | null): { text: string; totalXp: number }
{
	assertXpAmount(amount);
	const { totalXp } = services.activity.adjustXp({
		guildId: target.guildId,
		userId: target.userId,
		delta: sign * amount,
		actorId: target.actorId,
		reason,
		roleIds: target.roleIds,
	});
	const action = sign > 0
		? `Đã cộng ${formatNumber(amount)} XP cho ${userMention(target.userId)}`
		: `Đã trừ ${formatNumber(amount)} XP của ${userMention(target.userId)}`;
	return { text: `${action}. Tổng: ${formatNumber(totalXp)} XP.`, totalXp };
}

/** Reset XP một người (void mọi biến động). Tổng XP sau đó luôn là 0. */
export function resetMemberXp(services: AppServices, target: AdjustTarget): { text: string; totalXp: number }
{
	const { voidedEvents } = services.activity.resetUser(target.guildId, target.userId, target.actorId);
	return { text: `Đã reset XP của ${userMention(target.userId)} (huỷ ${formatNumber(voidedEvents)} biến động). Tổng: 0 XP.`, totalXp: 0 };
}

/** Reset XP toàn server sau khi kiểm tra chuỗi xác nhận. */
export function resetAllXp(services: AppServices, guildId: string, actorId: string, confirmation: string): string
{
	assertResetConfirmation(confirmation);
	const { voidedEvents, members } = services.activity.resetAll(guildId, actorId);
	return `Đã reset XP toàn server: huỷ ${formatNumber(voidedEvents)} biến động của ${formatNumber(members)} thành viên.\n${RESET_ALL_TIER_ROLE_NOTE}`;
}

/** Cộng (dương) hoặc trừ (âm) điểm contribution. Service từ chối nếu tổng sau đó âm. */
export function adjustMemberContribution(services: AppServices, target: AdjustTarget, delta: number, reason: string | null): string
{
	assertContributionDelta(delta);
	const { score } = services.contributions.adjust({
		guildId: target.guildId,
		userId: target.userId,
		delta,
		actorId: target.actorId,
		reason,
		roleIds: target.roleIds,
	});
	const action = delta > 0
		? `Đã cộng ${formatNumber(delta)} điểm contribution cho ${userMention(target.userId)}`
		: `Đã trừ ${formatNumber(-delta)} điểm contribution của ${userMention(target.userId)}`;
	return `${action}. Tổng: ${formatNumber(score)} điểm.`;
}

export function resetMemberContribution(services: AppServices, target: AdjustTarget): string
{
	const { voidedEvents } = services.contributions.resetUser(target.guildId, target.userId, target.actorId);
	return `Đã reset điểm contribution của ${userMention(target.userId)} (huỷ ${formatNumber(voidedEvents)} biến động). Tổng: 0 điểm.`;
}

/** Reset điểm contribution toàn server sau khi kiểm tra chuỗi xác nhận. */
export function resetAllContribution(services: AppServices, guildId: string, actorId: string, confirmation: string): string
{
	assertResetConfirmation(confirmation);
	const { voidedEvents, members } = services.contributions.resetAll(guildId, actorId);
	return `Đã reset điểm contribution toàn server: huỷ ${formatNumber(voidedEvents)} biến động của ${formatNumber(members)} thành viên.`;
}

/** Gỡ contribution và huỷ mọi điểm của nó. Người gọi sửa message công khai sau đó (`AdminActions.refreshContribution`). */
export function removeContribution(services: AppServices, guildId: string, contributionId: number, actorId: string): { text: string; removed: Contribution }
{
	const removed = services.contributions.remove(guildId, contributionId, actorId);
	const title = inlineText(removed.title, TITLE_DISPLAY_MAX);
	return {
		text: `Đã gỡ contribution #${removed.id} "${title}" của ${userMention(removed.authorId)}. Toàn bộ điểm của contribution này đã bị huỷ.`,
		removed,
	};
}

/**
 * Đưa role danh hiệu của member về đúng tổng XP mới (DEC-031); trả về một dòng mô tả nếu có role thay đổi hoặc bị bỏ qua,
 * null nếu không. `member` null (đã rời server) thì bỏ qua.
 */
export async function syncMemberTierRoles(actions: AdminActions, services: AppServices, member: GuildMember | null, totalXp: number): Promise<string | null>
{
	if (member === null) return null;
	const result = await actions.syncTierRoles(member, levelInfo(totalXp).level, services.tierRoles, TIER_ROLE_REASON);
	return tierRoleSyncLine(result);
}

export const BACKUP_IN_PROGRESS = "Đang có một bản sao lưu thủ công chạy dở. Hãy đợi ít giây rồi thử lại.";

/** Bản sao lưu thủ công đang chạy (lệnh và web chạy chung process), để hai yêu cầu đến cùng lúc không cùng qua bước kiểm tra. */
const runningManualBackups = new WeakSet<BackupService>();

/**
 * UserError nếu đang có bản sao lưu thủ công chạy dở, hoặc vừa có bản thủ công trong MANUAL_BACKUP_COOLDOWN_MS. Bản mang thời điểm
 * tương lai không chặn.
 */
export function assertManualBackupAllowed(services: AppServices): void
{
	if (runningManualBackups.has(services.backup)) throw new UserError(BACKUP_IN_PROGRESS);
	const latest = services.backup.latestBackupAt("manual");
	const now = services.clock.now();
	if (latest !== null && latest <= now && now - latest < MANUAL_BACKUP_COOLDOWN_MS)
	{
		throw new UserError(
			`Vừa có bản sao lưu thủ công ${relativeTime(latest)}. Mỗi 10 phút chỉ tạo được một bản, vui lòng thử lại ${relativeTime(latest + MANUAL_BACKUP_COOLDOWN_MS)}.`,
		);
	}
}

/**
 * Tạo bản sao lưu thủ công và ghi audit "backup.manual"; trả về thông báo kèm tên file (không có đường dẫn). Kiểm tra lại
 * assertManualBackupAllowed và đánh dấu "đang chạy" trước lần `await` đầu tiên, nên các yêu cầu đến cùng lúc chỉ một yêu cầu chạy.
 */
export async function createManualBackup(services: AppServices, guildId: string, actorId: string): Promise<string>
{
	assertManualBackupAllowed(services);
	runningManualBackups.add(services.backup);
	try
	{
		const file = basename(await services.backup.createBackup("manual"));
		services.audit.record(guildId, actorId, "backup.manual", null, { file });
		return `Đã sao lưu database: \`${file}\`.`;
	}
	finally
	{
		runningManualBackups.delete(services.backup);
	}
}
