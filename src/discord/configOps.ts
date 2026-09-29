// Kiểm tra và thao tác cấu hình dùng chung cho lệnh `/config` (tầng Discord) và trang web quản trị (DEC-039), để hai nơi
// luôn cùng quy tắc. Lỗi hiển thị cho người dùng là UserError; nội dung dùng markdown/mention của Discord (web tự chuyển).
import { GuildBasedChannel, Guild, GuildMember, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import type DiscordClient from "../classes/DiscordClient";
import { TIER_SETS, TierKey, tierByKey, TierSet } from "../modules/activity/tiers";
import { parseTierDisplayName, TierRenameInput } from "../modules/gamification/TierSetService";
import { AppServices } from "../services";
import { UserError } from "../shared/errors";
import { channelMention, roleMention } from "./format";
import { deleteLiveBoardMessage, refreshLiveBoard } from "./liveBoard";
import { BOT_MEMBER_UNAVAILABLE } from "./tierRoleSetup";
import { BOARD_CHANNEL_TYPES } from "./views/configPanel";

type PermissionList = readonly (readonly [bigint, string])[];

/** Quyền bot cần ở kênh Bảng vàng để đăng message kèm ảnh (DEC-030). */
const BOARD_PERMISSIONS: PermissionList = [
	[PermissionFlagsBits.ViewChannel, "View Channel"],
	[PermissionFlagsBits.SendMessages, "Send Messages"],
	[PermissionFlagsBits.AttachFiles, "Attach Files"],
];

/** Quyền người gọi phải tự có ở kênh Bảng vàng, để không mượn bot đăng vào kênh mình không được gửi tin (LL-013). */
const BOARD_CALLER_PERMISSIONS: PermissionList = [
	[PermissionFlagsBits.ViewChannel, "View Channel"],
	[PermissionFlagsBits.SendMessages, "Send Messages"],
];

/** Thao tác với message Bảng vàng (src/discord/liveBoard.ts); test thay bằng hàm giả. */
export interface LiveBoardActions
{
	refresh: typeof refreshLiveBoard;
	remove: typeof deleteLiveBoardMessage;
}

export const DEFAULT_LIVE_BOARD_ACTIONS: LiveBoardActions = { refresh: refreshLiveBoard, remove: deleteLiveBoardMessage };

/** Thành viên của chính bot trong server; UserError nếu chưa có trong cache. */
export function botMemberOf(guild: Guild): GuildMember
{
	const me = guild.members.me;
	if (!me) throw new UserError(BOT_MEMBER_UNAVAILABLE);
	return me;
}

/** Tên (in đậm) các quyền trong `list` mà `permissions` không có. */
function missingPermissions(permissions: Readonly<PermissionsBitField>, list: PermissionList): string[]
{
	return list.filter(([flag]) => !permissions.has(flag)).map(([, name]) => `**${name}**`);
}

/** Phần của kênh cần để tính quyền theo kênh (kênh từ option của lệnh gõ, hoặc từ cache của server). */
export interface PermissionChannel
{
	id: string;
	permissionsFor(member: GuildMember): Readonly<PermissionsBitField>;
}

/**
 * Kiểm tra trước khi đặt Bảng vàng ở `channel` (lệnh gõ, bảng cấu hình, web): người gọi phải tự xem và gửi được tin ở kênh
 * đó (không mượn bot đăng vào kênh mình không được gửi, LL-013), bot phải đủ quyền đăng ảnh (DEC-030).
 */
export function assertBoardChannelAccess(channel: PermissionChannel, caller: GuildMember, bot: GuildMember): void
{
	const callerMissing = missingPermissions(channel.permissionsFor(caller), BOARD_CALLER_PERMISSIONS);
	if (callerMissing.length > 0)
	{
		throw new UserError(`Bạn không có quyền ${callerMissing.join(", ")} ở ${channelMention(channel.id)}, nên không thể đặt Bảng vàng ở kênh đó.`);
	}
	const missing = missingPermissions(channel.permissionsFor(bot), BOARD_PERMISSIONS);
	if (missing.length > 0)
	{
		throw new UserError(`Bot thiếu quyền ${missing.join(", ")} ở ${channelMention(channel.id)}. Hãy cấp quyền cho bot ở kênh đó rồi thử lại.`);
	}
}

export type BoardChannel = Extract<GuildBasedChannel, { type: (typeof BOARD_CHANNEL_TYPES)[number] }>;

export function isBoardChannel(channel: GuildBasedChannel): channel is BoardChannel
{
	return BOARD_CHANNEL_TYPES.some(type => type === channel.type);
}

/** Chặn @everyone và role do bot/integration quản lý (không gán được cho người dùng). */
export function assertAssignableRole(role: { id: string; managed: boolean }, guildId: string, purpose: string): void
{
	if (role.id === guildId) throw new UserError(`Không thể dùng @everyone ${purpose}.`);
	if (role.managed) throw new UserError(`Không thể dùng role do bot hoặc integration quản lý ${purpose}.`);
}

/** Role danh hiệu không được dùng vào việc khác: bot tự thêm và gỡ role danh hiệu theo level của từng người (DEC-031). */
export function assertNotTierRole(services: Pick<AppServices, "tierRoles" | "tierSets">, guildId: string, roleId: string, purpose: string): void
{
	const mapping = services.tierRoles.list(guildId).find(entry => entry.roleId === roleId);
	if (!mapping) return;
	const tier = tierByKey(mapping.tierKey, services.tierSets.current(guildId));
	throw new UserError(`Không thể dùng ${roleMention(roleId)} ${purpose} vì role này đang là role của bậc danh hiệu ${tier.name}: `
		+ "bot tự thêm và gỡ role danh hiệu theo level của từng người. Hãy chọn role khác, hoặc bỏ gán bằng `/config tier clear-role` trước.");
}

/**
 * Role dùng được vào một việc của bot (team, role admin bot, role tạo vote): không phải @everyone hay role do integration
 * quản lý, không phải role danh hiệu. `purpose` ví dụ "làm team".
 */
export function assertUsableRole(
	services: Pick<AppServices, "tierRoles" | "tierSets">,
	guildId: string,
	role: { id: string; managed: boolean },
	purpose: string,
): void
{
	assertAssignableRole(role, guildId, purpose);
	assertNotTierRole(services, guildId, role.id, purpose);
}

function collapseSpaces(text: string): string
{
	return text.replace(/\s+/gu, " ").trim();
}

/**
 * Chuỗi admin nhập cho một bậc ("🟡 Kim Đan", chỉ tên, chỉ emoji, hoặc rỗng) thành thay đổi để lưu. Phần trùng với
 * mặc định của bộ lưu là null (dùng mặc định), để ô điền sẵn mà admin không sửa không biến thành tên tuỳ chỉnh.
 * Dùng chung cho `/config tier rename`, form đổi tên của bảng danh hiệu và trang web; kiểm tra hợp lệ do TierSetService.rename làm.
 */
export function renameInput(set: TierSet, tierKey: TierKey, raw: string): TierRenameInput
{
	const parsed = parseTierDisplayName(raw);
	const base = tierByKey(tierKey, TIER_SETS[set.key]);
	return {
		tierKey,
		name: parsed.name !== null && collapseSpaces(parsed.name) === base.name ? null : parsed.name,
		emoji: parsed.emoji === base.emoji ? null : parsed.emoji,
	};
}

/**
 * Lưu kênh Bảng vàng (đã qua assertBoardChannelAccess), xoá message bảng cũ nếu có, rồi đăng bảng ở kênh mới ngay; trả về
 * phản hồi. Có thể mất vài giây (vẽ 3 ảnh): gọi sau khi đã defer.
 */
export async function moveLiveBoard(
	client: DiscordClient,
	services: AppServices,
	actions: LiveBoardActions,
	guildId: string,
	channelId: string,
	actorId: string,
): Promise<string>
{
	const { previous } = services.liveBoards.setChannel(guildId, channelId, actorId);
	if (previous?.messageId) await actions.remove(client, previous);
	const posted = await actions.refresh(client, guildId, { force: true });

	const lines = [`Đã đặt Bảng vàng ở ${channelMention(channelId)}. Bot giữ một message bảng xếp hạng ở đó và tự cập nhật định kỳ.`];
	if (!posted)
	{
		lines.push("⚠️ Chưa đăng được bảng xếp hạng lên kênh này (xem log của bot). Bot sẽ thử lại ở lần cập nhật định kỳ tiếp theo.");
	}
	return lines.join("\n");
}

/** Tắt Bảng vàng và xoá message bảng xếp hạng cũ nếu có; trả về phản hồi. */
export async function turnOffLiveBoard(client: DiscordClient, services: AppServices, actions: LiveBoardActions, guildId: string, actorId: string): Promise<string>
{
	const previous = services.liveBoards.disable(guildId, actorId);
	if (!previous) return "Bảng vàng vốn đang tắt.";

	const channel = channelMention(previous.channelId);
	if (!previous.messageId) return `Đã tắt Bảng vàng ở ${channel}.`;
	const deleted = await actions.remove(client, previous);
	return deleted
		? `Đã tắt Bảng vàng và xoá message bảng xếp hạng ở ${channel}.`
		: `Đã tắt Bảng vàng. Không xoá được message bảng xếp hạng cũ ở ${channel} (có thể đã bị xoá); nếu còn, bạn có thể tự xoá.`;
}
