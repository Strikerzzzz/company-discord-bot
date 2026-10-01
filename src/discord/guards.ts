import { Channel, ChannelType, GuildMember, Interaction, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import type DiscordClient from "../classes/DiscordClient";
import { canCreatePoll, canReviewContributions, isAdmin, MemberAccess } from "../modules/guild-config/permissions";
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

/** Người gọi được duyệt contribution không (admin bot hoặc role duyệt contribution, DEC-051); kiểm tra mỗi lần bấm hay gửi form. */
export function checkCanReviewContributions(interaction: Interaction, services: AppServices): boolean
{
	if (!interaction.inGuild()) return false;
	return canReviewContributions(memberAccess(interaction), services.guildConfig.getSettings(interaction.guildId));
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

/** Discord báo "không có" (HTTP 404: Unknown Channel, Unknown Member, Unknown User...). */
export function isNotFoundError(error: unknown): boolean
{
	return typeof error === "object" && error !== null && "status" in error && error.status === 404;
}

/**
 * Kết quả kiểm tra quyền xem kênh gốc của một mục (contribution, vote):
 * - "visible": xem được;
 * - "hidden": thiếu View Channel, hoặc thread riêng tư mà không phải thành viên thread và không có Manage Threads;
 * - "gone": Discord báo kênh không còn (404), hoặc kênh không thuộc server này;
 * - "unknown": không lấy được kênh vì lỗi khác (thiếu quyền truy cập, Discord lỗi, mạng) hoặc không tính được quyền.
 */
export type ChannelAccess = "visible" | "hidden" | "gone" | "unknown";

/** Phần của channel cần để tính quyền; khai báo riêng để gọi được trên mọi loại channel của guild. */
interface PermissionScope
{
	permissionsFor(member: GuildMember | string): Readonly<PermissionsBitField> | null;
}

/** Channel theo ID (cache trước, sau đó REST); "gone" nếu Discord báo không còn, "unknown" nếu lỗi khác. */
async function fetchChannel(client: DiscordClient, channelId: string): Promise<Channel | "gone" | "unknown">
{
	try
	{
		return await client.channels.fetch(channelId) ?? "gone";
	}
	catch (error)
	{
		logger.debug(`Không lấy được channel "${channelId}" để kiểm tra quyền xem:`, error);
		return isNotFoundError(error) ? "gone" : "unknown";
	}
}

/**
 * Quyền xem kênh `channelId` của `member` (GuildMember, hoặc user ID khi không có) trong server `guildId`. Lõi dùng chung cho
 * lệnh Discord (canViewChannel) và trang web (src/web/discord.ts): mỗi nơi tự quyết cách xử lý "gone" và "unknown".
 */
export async function channelAccess(client: DiscordClient, guildId: string, channelId: string, member: GuildMember | string): Promise<ChannelAccess>
{
	const channel = await fetchChannel(client, channelId);
	if (channel === "gone" || channel === "unknown") return channel;
	if (channel.isDMBased() || channel.guildId !== guildId) return "gone";

	const scope: PermissionScope = channel;
	const permissions = scope.permissionsFor(member);
	if (!permissions) return "unknown";
	if (!permissions.has(PermissionFlagsBits.ViewChannel)) return "hidden";

	if (channel.type === ChannelType.PrivateThread && !permissions.has(PermissionFlagsBits.ManageThreads))
	{
		try
		{
			await channel.members.fetch({ member: typeof member === "string" ? member : member.id });
			return "visible";
		}
		catch
		{
			return "hidden";
		}
	}
	return "visible";
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

	const member = interaction.member instanceof GuildMember ? interaction.member : interaction.user.id;
	const access = await channelAccess(client, interaction.guildId, channelId, member);
	if (access === "visible") return true;
	if (access === "hidden") return false;
	return checkAdmin(interaction, client.services);
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
