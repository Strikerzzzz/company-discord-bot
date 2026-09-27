import { Events, Message, PermissionFlagsBits } from "discord.js";
import Event from "../classes/Event";
import { roleIdsOf } from "../discord/members";
import { syncTierRoles } from "../discord/roleSync";
import { breakthroughText, levelUpText } from "../discord/views/progression";
import { tierUp } from "../modules/activity/tiers";
import { MessageInput } from "../modules/activity/types";
import { logger } from "../shared/logger";

/** Lý do ghi vào audit log của Discord khi bot đổi role cảnh giới. */
const TIER_ROLE_REASON = "Cảnh giới tu luyện";

// Cộng Activity XP khi thành viên nhắn tin (DEC-022, DEC-023), thông báo lên level hoặc đột phá cảnh giới (DEC-029),
// rồi đồng bộ role cảnh giới (DEC-031). Không ghi log nội dung tin nhắn; lỗi của service để EventHandler bắt và ghi log.
export default class MessageCreate extends Event
{
	name = Events.MessageCreate;

	async execute(message: Message): Promise<void>
	{
		if (message.author.bot || message.webhookId || message.system || !message.inGuild()) return;
		// Chỉ phục vụ các server đã cấu hình: bot bị mời vào server lạ thì không đọc, không ghi XP, không gửi gì.
		if (!this.client.guildIds.includes(message.guildId)) return;

		const { activity, tierRoles } = this.client.services;
		const input: MessageInput = {
			guildId: message.guildId,
			userId: message.author.id,
			channelId: xpChannelId(message),
			content: message.content,
			hasAttachments: message.attachments.size > 0,
			roleIds: roleIdsOf(message.member),
		};

		const result = activity.handleMessage(input);
		if (!result.awarded) return;

		if (result.levelAfter > result.levelBefore) await this.announceLevelUp(message, result.levelBefore, result.levelAfter);
		// Đồng bộ ở mọi tin được XP (không chỉ khi lên level) để tự sửa lệch sau khi admin đổi cấu hình role hoặc reset XP.
		// syncTierRoles không ném lỗi, nên lỗi role và lỗi thông báo độc lập nhau.
		if (message.member) await syncTierRoles(message.member, result.levelAfter, tierRoles, TIER_ROLE_REASON);
	}

	/** Thông báo lên level, hoặc đột phá nếu vượt mốc cảnh giới. Không ném lỗi: XP đã được cộng, gửi thất bại chỉ ghi cảnh báo. */
	private async announceLevelUp(message: Message<true>, levelBefore: number, levelAfter: number): Promise<void>
	{
		if (!this.client.services.guildConfig.getSettings(message.guildId).levelUpAnnouncements) return;
		if (!this.canAnnounceIn(message)) return;

		const tier = tierUp(levelBefore, levelAfter);
		const content = tier ? breakthroughText(message.author.id, tier, levelAfter) : levelUpText(message.author.id, levelAfter);
		try
		{
			// Client mặc định chặn mọi mention; ở đây chỉ cho phép ping đúng người vừa lên level.
			await message.channel.send({ content, allowedMentions: { users: [message.author.id] } });
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
