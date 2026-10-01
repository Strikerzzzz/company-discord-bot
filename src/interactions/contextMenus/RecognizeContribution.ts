import { ApplicationCommandType,
	ChannelType,
	ContextMenuCommandBuilder,
	messageLink,
	MessageContextMenuCommandInteraction,
	MessageFlags,
	PermissionFlagsBits,
	UserContextMenuCommandInteraction } from "discord.js";
import ContextMenu from "../../classes/ContextMenu";
import { requireGuildId } from "../../discord/guards";
import { roleIdsOf } from "../../discord/members";
import { postContributionCard, requireContributionCardChannel } from "../../discord/messages";
import { contributionSubmittedText, MESSAGE_CONTRIBUTION_DESCRIPTION, messageContributionTitle } from "../../discord/views/contribution";
import { UserError } from "../../shared/errors";
import { logger } from "../../shared/logger";

/**
 * Chuột phải vào tin nhắn → "Ghi nhận đóng góp": điểm thuộc về tác giả tin nhắn (DEC-025). Gọi ở kênh nào cũng được; bot đăng thẻ
 * chờ duyệt ở kênh contribution admin đã chọn và trả lời riêng kèm link (DEC-051), nên người gọi chỉ cần xem được kênh contribution.
 * Không chép nội dung tin nhắn vào database hay log: contribution chỉ giữ tên kênh (khi kênh công khai) và link tới tin nhắn gốc.
 */
export default class RecognizeContribution extends ContextMenu
{
	data = new ContextMenuCommandBuilder()
		.setName("Ghi nhận đóng góp")
		.setType(ApplicationCommandType.Message);

	async execute(interaction: UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction): Promise<void>
	{
		if (!interaction.isMessageContextMenuCommand()) return;

		const guildId = requireGuildId(interaction);
		const target = interaction.targetMessage;
		if (target.author.bot) throw new UserError("Không thể ghi nhận tin nhắn của bot.");
		// Tin nhắn hệ thống (ví dụ "X đã vào server", tin ghim) không phải đóng góp của ai.
		if (target.system) throw new UserError("Không thể ghi nhận tin nhắn hệ thống.");

		// Trả lời riêng (thẻ nằm ở kênh contribution); kiểm tra kênh và lấy role tác giả qua REST có thể vượt hạn 3 giây: defer trước.
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const channel = await requireContributionCardChannel(this.client, interaction);
		const authorRoleIds = await fetchRoleIds(interaction, target.author.id);

		const { services } = this.client;
		const contribution = services.contributions.submit({
			guildId,
			authorId: target.author.id,
			submittedBy: interaction.user.id,
			title: messageContributionTitle(publicChannelName(interaction)),
			description: MESSAGE_CONTRIBUTION_DESCRIPTION,
			category: "khac",
			// Tự dựng link: message.url bị thành "@me" khi channel không có trong cache.
			link: messageLink(target.channelId, target.id, guildId),
			authorRoleIds,
			sourceMessageId: target.id,
		});
		const posted = await postContributionCard(services, channel, contribution);
		await interaction.editReply({
			content: contributionSubmittedText(posted ?? contribution, channel.id, posted !== null),
			allowedMentions: { parse: [] },
		});
	}
}

/**
 * Tên kênh chứa tin nhắn, dùng cho tiêu đề, chỉ khi @everyone xem được kênh đó: thẻ nằm ở kênh contribution công khai, nên không để lộ
 * tên kênh riêng tư (DEC-051). Thread riêng tư, kênh không có trong cache hay không tính được quyền: null (tiêu đề chung). Link tới tin
 * gốc vẫn giữ; người không xem được kênh mở link sẽ không thấy nội dung.
 */
function publicChannelName(interaction: MessageContextMenuCommandInteraction): string | null
{
	const { channel, guild } = interaction;
	if (!channel || channel.isDMBased() || !guild || channel.type === ChannelType.PrivateThread) return null;
	return channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel) === true ? channel.name : null;
}

/**
 * Role hiện tại của tác giả tin nhắn (snapshot team, DEC-024). Luôn lấy mới qua REST vì role trong cache có thể đã cũ
 * (không dùng intent GuildMembers). Tác giả đã rời server hoặc lỗi khác: coi như không có role.
 */
async function fetchRoleIds(interaction: MessageContextMenuCommandInteraction, authorId: string): Promise<string[]>
{
	const guild = interaction.guild;
	if (!guild) return [];

	try
	{
		return roleIdsOf(await guild.members.fetch({ user: authorId, force: true }));
	}
	catch (error)
	{
		logger.debug(`Không lấy được role của thành viên ${authorId} (có thể đã rời server):`, error);
		return [];
	}
}
