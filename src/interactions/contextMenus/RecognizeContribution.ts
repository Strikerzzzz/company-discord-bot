import { ApplicationCommandType,
	ContextMenuCommandBuilder,
	Message,
	MessageContextMenuCommandInteraction,
	UserContextMenuCommandInteraction } from "discord.js";
import ContextMenu from "../../classes/ContextMenu";
import { requireGuildId } from "../../discord/guards";
import { roleIdsOf } from "../../discord/members";
import { descriptionFromMessage, titleFromMessage } from "../../discord/views/contribution";
import { UserError } from "../../shared/errors";
import { logger } from "../../shared/logger";
import { publishContribution } from "../commands/contribution";

// Chuột phải vào tin nhắn → "Ghi nhận đóng góp": điểm thuộc về tác giả tin nhắn (DEC-025).
export default class RecognizeContribution extends ContextMenu
{
	data = new ContextMenuCommandBuilder()
		.setName("Ghi nhận đóng góp")
		.setType(ApplicationCommandType.Message);

	async execute(interaction: UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction): Promise<void>
	{
		if (!interaction.isMessageContextMenuCommand()) return;

		const guildId = requireGuildId(interaction);
		const message = interaction.targetMessage;
		if (message.author.bot) throw new UserError("Không thể ghi nhận tin nhắn của bot.");

		const { contributions } = this.client.services;
		const contribution = contributions.submit({
			guildId,
			authorId: message.author.id,
			submittedBy: interaction.user.id,
			title: titleFromMessage(message.content),
			description: descriptionFromMessage(message.content),
			category: "khac",
			link: message.url,
			authorRoleIds: await authorRoleIds(interaction, message),
		});

		await publishContribution(interaction, contributions, contribution);
	}
}

/**
 * Role của tác giả tin nhắn (snapshot team, DEC-024). Tin nhắn trong dữ liệu interaction không kèm member,
 * nên nếu member chưa có trong cache thì lấy qua REST (không cần intent GuildMembers).
 */
async function authorRoleIds(interaction: MessageContextMenuCommandInteraction, message: Message): Promise<string[]>
{
	if (message.member) return roleIdsOf(message.member);

	try
	{
		return roleIdsOf(await interaction.guild?.members.fetch(message.author.id));
	}
	catch (error)
	{
		logger.debug(`Không lấy được role của tác giả tin nhắn ${message.id} (có thể đã rời server):`, error);
		return [];
	}
}
