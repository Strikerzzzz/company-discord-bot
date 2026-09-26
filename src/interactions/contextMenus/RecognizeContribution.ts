import { ApplicationCommandType,
	ContextMenuCommandBuilder,
	messageLink,
	MessageContextMenuCommandInteraction,
	UserContextMenuCommandInteraction } from "discord.js";
import ContextMenu from "../../classes/ContextMenu";
import { assertCanSendMessages, requireGuildId } from "../../discord/guards";
import { roleIdsOf } from "../../discord/members";
import { contributionMessage, MESSAGE_CONTRIBUTION_DESCRIPTION, messageContributionTitle } from "../../discord/views/contribution";
import { UserError } from "../../shared/errors";
import { logger } from "../../shared/logger";

/**
 * Chuột phải vào tin nhắn → "Ghi nhận đóng góp": điểm thuộc về tác giả tin nhắn (DEC-025).
 * Không chép nội dung tin nhắn vào database hay log: contribution chỉ giữ tên kênh và link tới tin nhắn gốc.
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
		// Bot đăng thay người dùng, nên người không được gửi tin ở kênh này cũng không được đăng qua bot.
		assertCanSendMessages(interaction);

		// Lấy role của tác giả qua REST có thể vượt hạn 3 giây: defer (công khai) trước.
		await interaction.deferReply();
		const authorRoleIds = await fetchRoleIds(interaction, target.author.id);

		const { contributions } = this.client.services;
		const contribution = contributions.submit({
			guildId,
			authorId: target.author.id,
			submittedBy: interaction.user.id,
			title: messageContributionTitle(channelName(interaction)),
			description: MESSAGE_CONTRIBUTION_DESCRIPTION,
			category: "khac",
			// Tự dựng link: message.url bị thành "@me" khi channel không có trong cache.
			link: messageLink(target.channelId, target.id, guildId),
			authorRoleIds,
			sourceMessageId: target.id,
		});

		const message = await interaction.editReply(contributionMessage(contribution));
		contributions.attachMessage(guildId, contribution.id, message.channelId, message.id);
	}
}

/** Tên kênh chứa tin nhắn (dùng cho tiêu đề); null nếu kênh không có trong cache. */
function channelName(interaction: MessageContextMenuCommandInteraction): string | null
{
	const channel = interaction.channel;
	return channel && !channel.isDMBased() ? channel.name : null;
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
