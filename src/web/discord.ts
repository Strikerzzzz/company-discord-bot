// Lấy thông tin thành viên từ Discord cho tầng web (DEC-039, DEC-041): server dùng để kiểm tra quyền ở mỗi request, trang dùng
// để lấy thành viên được thao tác (role hiện có, đồng bộ role danh hiệu).
import { Guild, GuildMember } from "discord.js";
import type DiscordClient from "../classes/DiscordClient";
import { channelAccess, isNotFoundError } from "../discord/guards";
import { UserError } from "../shared/errors";

export const DISCORD_UNAVAILABLE = "Không kiểm tra được quyền với Discord (Discord đang lỗi hoặc mạng chậm). Hãy thử lại sau ít phút.";
export const MEMBER_LOOKUP_UNAVAILABLE = "Không lấy được thông tin thành viên từ Discord (Discord đang lỗi hoặc mạng chậm). Hãy thử lại sau ít phút.";

/** Discord không trả lời được khi lấy thông tin thành viên (khác với "không phải thành viên"). */
export class DiscordUnavailableError extends Error
{}

/** Giữ kết quả "không lấy được kênh" trong khoảng này, để không gọi lại Discord ở mỗi lần mở trang (lỗi 403 lặp lại bị Discord tính vào giới hạn request lỗi). */
const UNKNOWN_CHANNEL_TTL_MS = 60_000;
const MAX_UNKNOWN_CHANNELS = 1000;
/** Kênh vừa không lấy được, theo client (mỗi bot một bảng): ID kênh → thời điểm hết hạn. */
const unknownChannels = new WeakMap<DiscordClient, Map<string, number>>();

/**
 * Lấy lại thông tin thành viên từ Discord (không dùng cache, để quyền luôn mới nhất). null nếu Discord báo không có (404: không
 * còn trong server); lỗi khác (Discord lỗi, mạng) thì ném DiscordUnavailableError để không báo nhầm là "không có quyền".
 */
export async function fetchMember(guild: Guild, userId: string): Promise<GuildMember | null>
{
	try
	{
		return await guild.members.fetch({ user: userId, force: true });
	}
	catch (error)
	{
		if (isNotFoundError(error)) return null;
		throw new DiscordUnavailableError(DISCORD_UNAVAILABLE, { cause: error });
	}
}

/**
 * Cho trang: như fetchMember (role luôn lấy mới), nhưng Discord lỗi thì ném UserError để trang báo lỗi thay vì trang 500. Thành
 * viên vào cache của discord.js như người đăng nhập; cache chỉ dùng để mention `<@id>` trong thông báo hiện được tên.
 */
export async function lookupMember(guild: Guild, userId: string): Promise<GuildMember | null>
{
	try
	{
		return await fetchMember(guild, userId);
	}
	catch (error)
	{
		if (error instanceof DiscordUnavailableError) throw new UserError(MEMBER_LOOKUP_UNAVAILABLE);
		throw error;
	}
}

function recentlyUnknown(client: DiscordClient, channelId: string, now: number): boolean
{
	const expiresAt = unknownChannels.get(client)?.get(channelId);
	return expiresAt !== undefined && expiresAt > now;
}

function rememberUnknown(client: DiscordClient, channelId: string, now: number): void
{
	let entries = unknownChannels.get(client);
	if (!entries)
	{
		entries = new Map();
		unknownChannels.set(client, entries);
	}
	entries.delete(channelId);
	entries.set(channelId, now + UNKNOWN_CHANNEL_TTL_MS);
	for (const [key, expiresAt] of entries)
	{
		if (entries.size <= MAX_UNKNOWN_CHANNELS && expiresAt > now) break;
		entries.delete(key);
	}
}

/**
 * Admin đang đăng nhập (`viewer`) có xem được kênh gốc của một mục (contribution, vote) không, theo lõi `channelAccess` dùng
 * chung với lệnh Discord (src/discord/guards.ts):
 * - mục chưa gắn kênh (`null`) hoặc kênh đã bị xoá: xem được (như lệnh, người xem luôn là admin);
 * - thiếu quyền xem: không;
 * - không lấy được kênh vì lỗi khác (bot thiếu quyền truy cập thread riêng tư, Discord lỗi): KHÔNG, chặt hơn lệnh, để web không
 *   lộ nội dung khi chưa chắc (review bảo mật Phase 17). Kết quả này được nhớ UNKNOWN_CHANNEL_TTL_MS.
 */
export async function canViewItemChannel(client: DiscordClient, guild: Guild, channelId: string | null, viewer: GuildMember, now = Date.now()): Promise<boolean>
{
	if (channelId === null) return true;
	if (recentlyUnknown(client, channelId, now)) return false;
	const access = await channelAccess(client, guild.id, channelId, viewer);
	if (access === "unknown") rememberUnknown(client, channelId, now);
	return access === "visible" || access === "gone";
}

/** ID các kênh (trong `channelIds`, bỏ trùng) mà `viewer` KHÔNG xem được; mỗi kênh chỉ kiểm tra một lần. */
export async function hiddenChannelIds(client: DiscordClient, guild: Guild, channelIds: readonly (string | null)[], viewer: GuildMember): Promise<Set<string>>
{
	const unique = [...new Set(channelIds.filter((id): id is string => id !== null))];
	const visible = await Promise.all(unique.map(id => canViewItemChannel(client, guild, id, viewer)));
	return new Set(unique.filter((_, index) => !visible[index]));
}
