import { Channel, ChannelType, GuildMember, Interaction, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import type DiscordClient from "../classes/DiscordClient";
import { canCreatePoll, isAdmin, MemberAccess } from "../modules/guild-config/permissions";
import { AppServices } from "../services";
import { UserError } from "../shared/errors";
import { logger } from "../shared/logger";
import { roleIdsOf } from "./members";

/** Guild ID của interaction; UserError nếu lệnh được dùng ngoài server. */
export function requireGuildId(interaction: Interaction): string
{
	if (!interaction.inGuild()) throw new UserError("Lệnh này chỉ dùng được trong server.");
	return interaction.guildId;
}

export function memberAccess(interaction: Interaction): MemberAccess
{
	return {
		hasManageGuild: interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false,
		roleIds: roleIdsOf(interaction.member),
	};
}

export function checkAdmin(interaction: Interaction, services: AppServices): boolean
{
	if (!interaction.inGuild()) return false;
	return isAdmin(memberAccess(interaction), services.guildConfig.getSettings(interaction.guildId));
}

/** Lớp kiểm tra quyền thứ hai (PROP-013). */
export function assertAdmin(interaction: Interaction, services: AppServices): void
{
	requireGuildId(interaction);
	if (!checkAdmin(interaction, services)) throw new UserError("Bạn không có quyền dùng lệnh này.");
}

export function checkCanCreatePoll(interaction: Interaction, services: AppServices): boolean
{
	if (!interaction.inGuild()) return false;
	return canCreatePoll(memberAccess(interaction), services.guildConfig.getSettings(interaction.guildId));
}

/**
 * Người gọi có quyền tự gửi tin nhắn ở kênh của interaction không (trong thread: Send Messages in Threads).
 * Bot trả lời interaction qua webhook nên Discord không tự chặn; phải kiểm tra trước khi đăng công khai thay người dùng.
 * Không xác định được kênh là thread hay không thì dùng Send Messages (chặt hơn).
 */
export function canSendMessages(interaction: Interaction): boolean
{
	const permission = interaction.channel?.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
	return interaction.memberPermissions?.has(permission) ?? false;
}

export function assertCanSendMessages(interaction: Interaction): void
{
	if (!canSendMessages(interaction)) throw new UserError("Bạn không có quyền gửi tin nhắn trong kênh này.");
}

/** Channel theo ID (cache trước, sau đó REST); null nếu không còn hoặc bot không truy cập được. */
async function fetchChannel(client: DiscordClient, channelId: string): Promise<Channel | null>
{
	try
	{
		return await client.channels.fetch(channelId);
	}
	catch (error)
	{
		logger.debug(`Không lấy được channel "${channelId}" để kiểm tra quyền xem:`, error);
		return null;
	}
}

/** Phần của channel cần để tính quyền; khai báo riêng để gọi được trên mọi loại channel của guild. */
interface PermissionScope
{
	permissionsFor(member: GuildMember | string): Readonly<PermissionsBitField> | null;
}

/**
 * Người gọi có xem được kênh gốc (`channelId`) của một mục (contribution, vote) không, để không lộ nội dung
 * của kênh riêng tư cho người dò ID. Quy tắc:
 * - mục chưa gắn kênh (`null`): xem được;
 * - kênh không còn, không lấy được, hoặc không tính được quyền: chỉ admin xem được;
 * - còn lại: cần quyền View Channel ở kênh đó; thread riêng tư còn cần là thành viên thread hoặc có Manage Threads.
 */
export async function canViewChannel(client: DiscordClient, interaction: Interaction, channelId: string | null): Promise<boolean>
{
	if (channelId === null) return true;
	if (!interaction.inGuild()) return false;

	const channel = await fetchChannel(client, channelId);
	if (!channel || channel.isDMBased() || channel.guildId !== interaction.guildId) return checkAdmin(interaction, client.services);

	const scope: PermissionScope = channel;
	const permissions = scope.permissionsFor(interaction.member instanceof GuildMember ? interaction.member : interaction.user.id);
	if (!permissions) return checkAdmin(interaction, client.services);
	if (!permissions.has(PermissionFlagsBits.ViewChannel)) return false;

	if (channel.type === ChannelType.PrivateThread && !permissions.has(PermissionFlagsBits.ManageThreads))
	{
		try
		{
			await channel.members.fetch({ member: interaction.user.id });
			return true;
		}
		catch
		{
			return false;
		}
	}
	return true;
}

/** Chỉ giữ các mục người gọi xem được (xem canViewChannel), giữ nguyên thứ tự; mỗi kênh chỉ kiểm tra một lần. */
export async function filterViewable<T extends { channelId: string | null }>(
	client: DiscordClient,
	interaction: Interaction,
	items: readonly T[],
): Promise<T[]>
{
	const checks = new Map<string | null, Promise<boolean>>();
	const visible = await Promise.all(items.map(item =>
	{
		let check = checks.get(item.channelId);
		if (!check)
		{
			check = canViewChannel(client, interaction, item.channelId);
			checks.set(item.channelId, check);
		}
		return check;
	}));
	return items.filter((_, index) => visible[index]);
}
