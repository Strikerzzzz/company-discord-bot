import { Events, Message, PermissionFlagsBits } from "discord.js";
import Event from "../classes/Event";
import { roleIdsOf } from "../discord/members";
import { levelUpMessage } from "../discord/views/activity";
import { MessageInput } from "../modules/activity/types";
import { logger } from "../shared/logger";

// Cộng Activity XP khi thành viên nhắn tin (DEC-022, DEC-023) và thông báo khi lên level.
// Không ghi log nội dung tin nhắn; lỗi để EventHandler bắt và ghi log.
export default class MessageCreate extends Event
{
	name = Events.MessageCreate;

	async execute(message: Message): Promise<void>
	{
		if (message.author.bot || message.webhookId || message.system || !message.inGuild()) return;
		// Chỉ phục vụ các server đã cấu hình: bot bị mời vào server lạ thì không đọc, không ghi XP, không gửi gì.
		if (!this.client.guildIds.includes(message.guildId)) return;

		const { activity, guildConfig } = this.client.services;
		const input: MessageInput = {
			guildId: message.guildId,
			userId: message.author.id,
			channelId: xpChannelId(message),
			content: message.content,
			hasAttachments: message.attachments.size > 0,
			roleIds: roleIdsOf(message.member),
		};

		const result = activity.handleMessage(input);
		if (!result.awarded || result.levelAfter <= result.levelBefore) return;
		if (!guildConfig.getSettings(message.guildId).levelUpAnnouncements) return;
		if (!this.canAnnounceIn(message)) return;

		// XP đã được cộng; gửi thông báo thất bại (ví dụ thread bị khoá) chỉ ghi cảnh báo.
		try
		{
			// Client mặc định chặn mọi mention; ở đây chỉ cho phép ping đúng người vừa lên level.
			await message.channel.send({
				content: levelUpMessage(message.author.id, result.levelAfter),
				allowedMentions: { users: [message.author.id] },
			});
		}
		catch (error)
		{
			logger.warn(`Không gửi được thông báo lên level ở channel "${message.channelId}":`, error);
		}
	}

	/** Bot có quyền gửi tin ở channel này không (isSendable() chỉ kiểm tra loại channel, không kiểm tra quyền). */
	private canAnnounceIn(message: Message<true>): boolean
	{
		const me = this.client.user;
		if (!me || !message.channel.isSendable()) return false;

		const send = message.channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
		return message.channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, send]) ?? false;
	}
}

/** Tin trong thread tính theo channel cha, để cấu hình XP của channel cha áp dụng cho cả thread. */
function xpChannelId(message: Message<true>): string
{
	if (message.channel.isThread()) return message.channel.parentId ?? message.channelId;
	return message.channelId;
}
