import { Events, Message } from "discord.js";
import Event from "../classes/Event";
import { roleIdsOf } from "../discord/members";
import { levelUpMessage } from "../discord/views/activity";
import { MessageInput } from "../modules/activity/types";

// Cộng Activity XP khi thành viên nhắn tin (DEC-022, DEC-023) và thông báo khi lên level.
// Không ghi log nội dung tin nhắn; lỗi để EventHandler bắt và ghi log.
export default class MessageCreate extends Event
{
	name = Events.MessageCreate;

	async execute(message: Message): Promise<void>
	{
		if (message.author.bot || message.webhookId || message.system || !message.inGuild()) return;

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
		if (!message.channel.isSendable()) return;

		// Client mặc định chặn mọi mention; ở đây chỉ cho phép ping đúng người vừa lên level.
		await message.channel.send({
			content: levelUpMessage(message.author.id, result.levelAfter),
			allowedMentions: { users: [message.author.id] },
		});
	}
}

/** Tin trong thread tính theo channel cha, để cấu hình XP của channel cha áp dụng cho cả thread. */
function xpChannelId(message: Message<true>): string
{
	if (message.channel.isThread()) return message.channel.parentId ?? message.channelId;
	return message.channelId;
}
