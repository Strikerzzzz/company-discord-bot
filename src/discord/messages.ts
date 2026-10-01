import { GuildMember, Interaction, MessageEditOptions, PermissionFlagsBits } from "discord.js";
import type DiscordClient from "../classes/DiscordClient";
import { Contribution } from "../modules/contribution/types";
import { AppServices } from "../services";
import { UserError } from "../shared/errors";
import { logger } from "../shared/logger";
import { BoardChannel, isBoardChannel, missingContributionBotPermissions } from "./configOps";
import { channelMention } from "./format";
import { isNotFoundError, requireGuildId } from "./guards";
import { BOT_MEMBER_UNAVAILABLE } from "./tierRoleSetup";
import { contributionMessage } from "./views/contribution";

/** Vị trí message công khai bot đã đăng (null nếu chưa lưu được). */
export interface PostedMessage
{
	channelId: string | null;
	messageId: string | null;
}

/**
 * Sửa một message công khai bot đã đăng. Không ném lỗi (kể cả khi dựng nội dung lỗi): message có thể đã bị xoá
 * hoặc bot mất quyền, khi đó chỉ ghi log. `label` dùng trong log (ví dụ "vote #5"). Trả về true nếu đã sửa được.
 */
export async function editPostedMessage(
	client: DiscordClient,
	posted: PostedMessage,
	render: () => MessageEditOptions,
	label: string,
): Promise<boolean>
{
	if (posted.channelId === null || posted.messageId === null) return false;

	try
	{
		const payload = render();
		const channel = await client.channels.fetch(posted.channelId);
		if (!channel?.isTextBased())
		{
			logger.warn(`Không cập nhật được message của ${label}: channel "${posted.channelId}" không còn hoặc không phải kênh văn bản.`);
			return false;
		}
		await channel.messages.edit(posted.messageId, payload);
		return true;
	}
	catch (error)
	{
		logger.warn(`Không cập nhật được message của ${label}:`, error);
		return false;
	}
}

/** Cập nhật message công khai của contribution theo trạng thái hiện tại (ví dụ sau khi bị gỡ: bỏ nút, ghi "Đã bị gỡ"). */
export function refreshContributionMessage(client: DiscordClient, contribution: Contribution): Promise<boolean>
{
	return editPostedMessage(client, contribution, () => contributionMessage(contribution), `contribution #${contribution.id}`);
}

const ASK_ADMIN = "Hãy báo admin chọn kênh contribution bằng `/config contribution kenh` hoặc trên trang web quản trị (Cài đặt điểm).";
export const NO_CONTRIBUTION_CHANNEL = `Admin chưa chọn kênh contribution nên chưa gửi được đóng góp. ${ASK_ADMIN}`;
export const CONTRIBUTION_CHANNEL_GONE = `Kênh contribution admin đã chọn không còn tồn tại (hoặc không còn là kênh văn bản). ${ASK_ADMIN}`;

/** Bot không lấy được kênh contribution vì lỗi khác 404 (thiếu quyền truy cập, Discord lỗi, mạng). */
function channelUnavailable(channelId: string): string
{
	return `Bot không truy cập được kênh contribution ${channelMention(channelId)} (có thể bot thiếu quyền View Channel, hoặc Discord đang lỗi). `
		+ "Hãy thử lại sau ít phút; nếu vẫn lỗi, báo admin kiểm tra quyền của bot ở kênh đó.";
}

/**
 * Kênh contribution để đăng thẻ của một contribution mới (DEC-051), kiểm tra trước khi tạo bản ghi; UserError tiếng Việt (gợi ý báo
 * admin) nếu không đạt:
 * - admin đã chọn kênh (`contributionChannelId`), kênh còn trong server và là kênh văn bản hoặc kênh thông báo;
 * - người gọi xem được kênh (View Channel): thành viên gửi từ đâu cũng được, nhưng không gửi được vào kênh mình không thấy (LL-013);
 * - bot đủ quyền đăng thẻ (missingContributionBotPermissions).
 * Có thể gọi REST (kênh không có trong cache), nên người gọi defer trước.
 */
export async function requireContributionCardChannel(client: DiscordClient, interaction: Interaction): Promise<BoardChannel>
{
	const guildId = requireGuildId(interaction);
	const channelId = client.services.guildConfig.getSettings(guildId).contributionChannelId;
	if (channelId === null) throw new UserError(NO_CONTRIBUTION_CHANNEL);

	let channel;
	try
	{
		channel = await client.channels.fetch(channelId);
	}
	catch (error)
	{
		logger.debug(`Không lấy được kênh contribution "${channelId}":`, error);
		throw new UserError(isNotFoundError(error) ? CONTRIBUTION_CHANNEL_GONE : channelUnavailable(channelId));
	}
	if (!channel || channel.isDMBased() || channel.guildId !== guildId || !isBoardChannel(channel)) throw new UserError(CONTRIBUTION_CHANNEL_GONE);

	const member = interaction.member instanceof GuildMember ? interaction.member : interaction.user.id;
	if (!channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel))
	{
		throw new UserError(`Bạn không xem được kênh contribution ${channelMention(channel.id)} nên chưa gửi được đóng góp. `
			+ "Hãy báo admin cấp cho bạn quyền xem kênh đó, hoặc chọn kênh contribution khác.");
	}
	const bot = channel.guild.members.me;
	if (!bot) throw new UserError(BOT_MEMBER_UNAVAILABLE);
	const missing = missingContributionBotPermissions(channel, bot);
	if (missing.length > 0)
	{
		throw new UserError(`Bot thiếu quyền ${missing.join(", ")} ở kênh contribution ${channelMention(channel.id)} nên chưa đăng được đóng góp. `
			+ "Hãy báo admin cấp quyền cho bot ở kênh đó.");
	}
	return channel;
}

/**
 * Đăng thẻ của contribution vừa tạo vào kênh contribution (không cho phép mention) rồi lưu vị trí (attachMessage); trả về contribution
 * kèm vị trí thẻ. Đăng thất bại thì chỉ ghi log và trả về null: bản ghi vẫn chờ duyệt, admin thấy trên trang web quản trị.
 */
export async function postContributionCard(services: AppServices, channel: BoardChannel, contribution: Contribution): Promise<Contribution | null>
{
	let message;
	try
	{
		message = await channel.send({ ...contributionMessage(contribution), allowedMentions: { parse: [] } });
	}
	catch (error)
	{
		logger.warn(`Không đăng được thẻ contribution #${contribution.id} vào kênh "${channel.id}" (bản ghi vẫn chờ duyệt):`, error);
		return null;
	}
	services.contributions.attachMessage(contribution.guildId, contribution.id, message.channelId, message.id);
	return { ...contribution, channelId: message.channelId, messageId: message.id };
}

export const REPOST_OTHER_CHANNEL = "Thẻ của contribution này nằm ở kênh khác kênh contribution hiện tại (contribution có từ trước khi có kênh "
	+ "contribution, hoặc admin đã đổi kênh). Bot không đăng lại để không chuyển nội dung sang kênh khác; thẻ cũ vẫn bấm được ở kênh của nó.";

/**
 * Chỉ đăng lại khi contribution chưa có thẻ, hoặc thẻ đang ở đúng kênh contribution hiện tại (review bảo mật Phase 20): thẻ ở kênh
 * khác (ví dụ contribution cũ trong kênh riêng tư) mà đăng lại sang kênh contribution sẽ lộ tiêu đề, mô tả cho người xem kênh đó.
 */
export function assertRepostableChannel(contribution: Pick<Contribution, "channelId">, contributionChannelId: string | null): void
{
	if (contribution.channelId !== null && contribution.channelId !== contributionChannelId) throw new UserError(REPOST_OTHER_CHANNEL);
}

/**
 * Đăng lại thẻ của một contribution vào kênh contribution đang chọn (DEC-051; web, khi thẻ đăng lỗi lúc gửi hoặc bị xoá tay): kiểm
 * tra kênh và quyền của bot như lúc gửi, xoá thẻ cũ nếu còn (bot xoá được tin của chính mình; lỗi chỉ ghi log), đăng thẻ mới theo
 * trạng thái hiện tại rồi lưu vị trí. UserError nếu chưa chọn kênh, kênh không còn, bot thiếu quyền hoặc Discord từ chối đăng.
 */
export async function repostContributionCard(client: DiscordClient, contribution: Contribution): Promise<Contribution>
{
	const { guildId } = contribution;
	const channelId = client.services.guildConfig.getSettings(guildId).contributionChannelId;
	if (channelId === null) throw new UserError(NO_CONTRIBUTION_CHANNEL);

	let channel;
	try
	{
		channel = await client.channels.fetch(channelId);
	}
	catch (error)
	{
		logger.debug(`Không lấy được kênh contribution "${channelId}":`, error);
		throw new UserError(isNotFoundError(error) ? CONTRIBUTION_CHANNEL_GONE : channelUnavailable(channelId));
	}
	if (!channel || channel.isDMBased() || channel.guildId !== guildId || !isBoardChannel(channel)) throw new UserError(CONTRIBUTION_CHANNEL_GONE);
	const bot = channel.guild.members.me;
	if (!bot) throw new UserError(BOT_MEMBER_UNAVAILABLE);
	const missing = missingContributionBotPermissions(channel, bot);
	if (missing.length > 0)
	{
		throw new UserError(`Bot thiếu quyền ${missing.join(", ")} ở kênh contribution ${channelMention(channel.id)}. Hãy cấp quyền cho bot ở kênh đó rồi thử lại.`);
	}
	assertRepostableChannel(contribution, channel.id);

	if (contribution.channelId !== null && contribution.messageId !== null)
	{
		try
		{
			const old = await client.channels.fetch(contribution.channelId);
			if (old?.isTextBased()) await old.messages.delete(contribution.messageId);
		}
		catch (error)
		{
			logger.debug(`Không xoá được thẻ cũ của contribution #${contribution.id} (có thể đã bị xoá):`, error);
		}
	}
	const posted = await postContributionCard(client.services, channel, contribution);
	if (posted === null) throw new UserError(`Discord từ chối đăng thẻ vào ${channelMention(channel.id)}. Hãy thử lại sau ít phút.`);
	return posted;
}
