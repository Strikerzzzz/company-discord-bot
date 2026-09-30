import { Events, GuildTextBasedChannel, Message, MessageFlags, PermissionFlagsBits } from "discord.js";
import Event from "../classes/Event";
import { roleIdsOf } from "../discord/members";
import { syncTierRoles } from "../discord/roleSync";
import { levelUpText, promotionText } from "../discord/views/progression";
import { tierUp } from "../modules/activity/tiers";
import { MessageInput } from "../modules/activity/types";
import { logger } from "../shared/logger";

/** Lý do ghi vào audit log của Discord khi bot đổi role danh hiệu. */
const TIER_ROLE_REASON = "Danh hiệu theo level";
/** Khoảng tối thiểu giữa hai lần ghi cảnh báo "kênh thông báo lên level hỏng" của cùng một server, để log không bị lặp mỗi lần lên level. */
const BROKEN_CHANNEL_WARN_INTERVAL_MS = 10 * 60 * 1000;

// Cộng Activity XP khi thành viên nhắn tin (DEC-022, DEC-023), thông báo lên level hoặc lên bậc theo giọng văn của bộ danh hiệu
// hiển thị của người đó (bộ tự chọn nếu server cho phép, không thì bộ của guild; DEC-029, DEC-033, DEC-047), rồi đồng bộ role
// danh hiệu (DEC-031). Role gán theo vị trí bậc (level), không phụ thuộc bộ nào, nên bộ cá nhân không đổi role. Không ghi log nội
// dung tin nhắn; lỗi của service để EventHandler bắt và ghi log.
export default class MessageCreate extends Event
{
	name = Events.MessageCreate;
	/** Lần gần nhất đã cảnh báo kênh thông báo hỏng, theo guild. */
	private readonly brokenChannelWarnedAt = new Map<string, number>();

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

	/**
	 * Thông báo lên level, hoặc lên bậc nếu vượt mốc bậc, theo bộ danh hiệu hiển thị của người vừa lên level (DEC-047; đã áp tên
	 * tuỳ chỉnh của server cho bộ đó). Gửi vào kênh thông báo admin đã chọn (DEC-043), chưa chọn thì gửi ở kênh vừa nhắn. Kênh đã
	 * chọn không còn hoặc bot mất quyền thì bỏ qua, không gửi về kênh vừa nhắn. Không ném lỗi khi gửi: XP đã được cộng, gửi thất
	 * bại chỉ ghi cảnh báo.
	 */
	private async announceLevelUp(message: Message<true>, levelBefore: number, levelAfter: number): Promise<void>
	{
		const settings = this.client.services.guildConfig.getSettings(message.guildId);
		if (!settings.levelUpAnnouncements) return;
		const channel = this.announceChannel(message, settings.levelUpChannelId);
		if (!channel) return;

		const set = this.client.services.tierSets.displayFor(message.guildId, message.author.id).set;
		const tier = tierUp(levelBefore, levelAfter, set);
		const content = tier ? promotionText(set, message.author.id, tier, levelAfter) : levelUpText(set, message.author.id, levelAfter);
		try
		{
			// Client mặc định chặn mọi mention; ở đây chỉ cho phép ping đúng người vừa lên level. Tắt xem trước link: tên bậc do admin
			// đặt đã bị chặn link, đây là lớp phòng thủ thêm cho tin công khai.
			await channel.send({ content, allowedMentions: { users: [message.author.id] }, flags: MessageFlags.SuppressEmbeds });
		}
		catch (error)
		{
			logger.warn(`Không gửi được thông báo lên level ở channel "${channel.id}":`, error);
		}
	}

	/**
	 * Kênh để gửi thông báo: kênh đã cấu hình (`configuredId`) hoặc kênh của tin nhắn nếu chưa cấu hình. null nếu kênh đã cấu
	 * hình không còn trong server, hoặc bot không gửi được tin ở kênh đó.
	 */
	private announceChannel(message: Message<true>, configuredId: string | null): GuildTextBasedChannel | null
	{
		if (configuredId === null) return this.canSendIn(message.channel) ? message.channel : null;
		const configured = message.guild.channels.cache.get(configuredId);
		if (!configured?.isTextBased() || !this.canSendIn(configured))
		{
			this.warnBrokenChannel(message.guildId, configuredId);
			return null;
		}
		return configured;
	}

	private warnBrokenChannel(guildId: string, channelId: string): void
	{
		const now = this.client.services.clock.now();
		const last = this.brokenChannelWarnedAt.get(guildId);
		if (last !== undefined && now - last < BROKEN_CHANNEL_WARN_INTERVAL_MS) return;
		this.brokenChannelWarnedAt.set(guildId, now);
		logger.warn(`Không gửi được thông báo lên level: kênh thông báo "${channelId}" không còn hoặc bot thiếu quyền gửi tin ở đó (cảnh báo tối đa mỗi 10 phút).`);
	}

	/** Bot có quyền gửi tin ở channel này không (isSendable() chỉ kiểm tra loại channel, không kiểm tra quyền). */
	private canSendIn(channel: GuildTextBasedChannel): boolean
	{
		const me = this.client.user;
		if (!me || !channel.isSendable()) return false;

		const send = channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
		return channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, send]) ?? false;
	}
}

/** Tin trong thread tính theo channel cha, để cấu hình XP của channel cha áp dụng cho cả thread. */
function xpChannelId(message: Message<true>): string
{
	if (message.channel.isThread()) return message.channel.parentId ?? message.channelId;
	return message.channelId;
}
