import Event from "../classes/Event";
import { Events, Interaction, InteractionReplyOptions, MessageFlags } from "discord.js";
import { assertAdmin, checkAdmin } from "../discord/guards";
import { UserError } from "../shared/errors";
import { logger } from "../shared/logger";

// Discord chỉ nhận tối đa 25 lựa chọn cho một autocomplete.
const MAX_AUTOCOMPLETE_CHOICES = 25;
const GENERIC_ERROR = "Đã có lỗi xảy ra khi xử lý yêu cầu. Vui lòng thử lại sau.";

export default class InteractionCreate extends Event
{
	name = Events.InteractionCreate;

	// Error boundary cho mọi interaction: lỗi trong command chỉ ảnh hưởng tới interaction đó, không làm sập bot.
	async execute(interaction: Interaction): Promise<void>
	{
		try
		{
			await this.dispatch(interaction);
		}
		catch (error)
		{
			if (error instanceof UserError)
			{
				logger.debug(`Từ chối interaction ${describe(interaction)}: ${error.message}`);
				await replyWith(interaction, error.message);
			}
			else
			{
				logger.error(`Lỗi khi xử lý interaction ${describe(interaction)}:`, error);
				await replyWith(interaction, GENERIC_ERROR);
			}
		}
	}

	private async dispatch(interaction: Interaction): Promise<void>
	{
		if (interaction.isChatInputCommand())
		{
			const command = this.client.interactions.commands.get(interaction.commandName);
			if (!command) return;

			// Kiểm tra quyền tập trung (lớp 2, PROP-013).
			if (command.adminOnly) assertAdmin(interaction, this.client.services);
			await command.execute(interaction);
		}
		else if (interaction.isButton())
		{
			const command = this.client.buttons.resolve(interaction.customId);
			if (!command) return;

			await command.executeButton(interaction);
		}
		else if (interaction.isContextMenuCommand())
		{
			const contextMenu = this.client.interactions.contextMenus.get(interaction.commandName);
			if (!contextMenu) return;

			await contextMenu.execute(interaction);
		}
		else if (interaction.isAutocomplete())
		{
			const command = this.client.interactions.commands.get(interaction.commandName);
			if (!command) return;

			// Không gợi ý dữ liệu của lệnh admin cho người không có quyền.
			if (command.adminOnly && !checkAdmin(interaction, this.client.services))
			{
				await interaction.respond([]);
				return;
			}
			const choices = command.autocomplete(interaction).slice(0, MAX_AUTOCOMPLETE_CHOICES);
			await interaction.respond(choices.map(choice => ({ name: choice, value: choice })));
		}
	}
}

function describe(interaction: Interaction): string
{
	if (interaction.isCommand() || interaction.isAutocomplete()) return `"${interaction.commandName}"`;
	if (interaction.isMessageComponent()) return `"${interaction.customId}"`;
	return `type ${interaction.type}`;
}

async function replyWith(interaction: Interaction, content: string): Promise<void>
{
	// Autocomplete không reply được, chỉ ghi log.
	if (!interaction.isRepliable()) return;

	const payload: InteractionReplyOptions = { content, flags: MessageFlags.Ephemeral };

	try
	{
		if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
		else await interaction.reply(payload);
	}
	catch (replyError)
	{
		logger.error("Không gửi được thông báo lỗi cho người dùng:", replyError);
	}
}
