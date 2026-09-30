// Lấy thông tin thành viên từ Discord cho tầng web (DEC-039, DEC-041): server dùng để kiểm tra quyền ở mỗi request, trang dùng
// để lấy thành viên được thao tác (role hiện có, đồng bộ role danh hiệu).
import { Channel, ChannelType, Guild, GuildMember, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import type DiscordClient from "../classes/DiscordClient";
import { UserError } from "../shared/errors";

export const DISCORD_UNAVAILABLE = "Không kiểm tra được quyền với Discord (Discord đang lỗi hoặc mạng chậm). Hãy thử lại sau ít phút.";
export const MEMBER_LOOKUP_UNAVAILABLE = "Không lấy được thông tin thành viên từ Discord (Discord đang lỗi hoặc mạng chậm). Hãy thử lại sau ít phút.";

/** Discord không trả lời được khi lấy thông tin thành viên (khác với "không phải thành viên"). */
export class DiscordUnavailableError extends Error
{}

function isNotFound(error: unknown): boolean
{
	return typeof error === "object" && error !== null && "status" in error && error.status === 404;
}

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
		if (isNotFound(error)) return null;
		throw new DiscordUnavailableError(DISCORD_UNAVAILABLE, { cause: error });
	}
}

/**
 * Cho trang: thành viên `userId` lấy mới qua REST. null nếu người này không còn trong server. Discord lỗi thì ném UserError để
 * trang báo lỗi thay vì trang 500. Kết quả vào cache thành viên của discord.js (như người đăng nhập ở fetchMember), để mention
 * `<@id>` trong thông báo sau thao tác hiện được tên; chỉ có các thành viên admin vừa thao tác nên cache không phình.
 */
export async function lookupMember(guild: Guild, userId: string): Promise<GuildMember | null>
{
	try
	{
		return await guild.members.fetch({ user: userId, force: true });
	}
	catch (error)
	{
		if (isNotFound(error)) return null;
		throw new UserError(MEMBER_LOOKUP_UNAVAILABLE);
	}
}

/** Phần của channel cần để tính quyền; khai báo riêng để gọi được trên mọi loại channel của guild. */
interface PermissionScope
{
	permissionsFor(member: GuildMember | string): Readonly<PermissionsBitField> | null;
}

async function fetchChannel(client: DiscordClient, channelId: string): Promise<Channel | null>
{
	try
	{
		return await client.channels.fetch(channelId);
	}
	catch
	{
		return null;
	}
}

/**
 * Admin đang đăng nhập (`viewer`) có xem được kênh gốc của một mục (contribution, vote) không; cùng quy tắc với
 * `canViewChannel` của lệnh Discord (src/discord/guards.ts), với người xem luôn là admin:
 * - mục chưa gắn kênh (`null`), kênh không còn, không lấy được hoặc không tính được quyền: xem được;
 * - còn lại: cần View Channel; thread riêng tư còn cần là thành viên thread hoặc có Manage Threads.
 */
export async function canViewItemChannel(client: DiscordClient, guild: Guild, channelId: string | null, viewer: GuildMember): Promise<boolean>
{
	if (channelId === null) return true;
	const channel = await fetchChannel(client, channelId);
	if (!channel || channel.isDMBased() || channel.guildId !== guild.id) return true;

	const scope: PermissionScope = channel;
	const permissions = scope.permissionsFor(viewer);
	if (!permissions) return true;
	if (!permissions.has(PermissionFlagsBits.ViewChannel)) return false;
	if (channel.type === ChannelType.PrivateThread && !permissions.has(PermissionFlagsBits.ManageThreads))
	{
		try
		{
			await channel.members.fetch({ member: viewer.id });
			return true;
		}
		catch
		{
			return false;
		}
	}
	return true;
}

/** ID các kênh (trong `channelIds`, bỏ trùng) mà `viewer` KHÔNG xem được; mỗi kênh chỉ kiểm tra một lần. */
export async function hiddenChannelIds(client: DiscordClient, guild: Guild, channelIds: readonly (string | null)[], viewer: GuildMember): Promise<Set<string>>
{
	const unique = [...new Set(channelIds.filter((id): id is string => id !== null))];
	const visible = await Promise.all(unique.map(id => canViewItemChannel(client, guild, id, viewer)));
	return new Set(unique.filter((_, index) => !visible[index]));
}
