import Event from "../classes/Event";
import { Events, Interaction, InteractionReplyOptions, MessageFlags } from "discord.js";

// Discord chỉ nhận tối đa 25 lựa chọn cho một autocomplete.
const MAX_AUTOCOMPLETE_CHOICES = 25;

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
			console.error(`Lỗi khi xử lý interaction ${describe(interaction)}:`, error);
			await replyWithError(interaction);
		}
	}

	private async dispatch(interaction: Interaction): Promise<void>
	{
		if (interaction.isChatInputCommand())
		{
			const command = this.client.interactions.commands.get(interaction.commandName);
			if (!command) return;

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

async function replyWithError(interaction: Interaction): Promise<void>
{
	// Autocomplete không reply được, chỉ ghi log.
	if (!interaction.isRepliable()) return;

	const payload: InteractionReplyOptions = {
		content: "There was an error while executing this interaction.",
		flags: MessageFlags.Ephemeral,
	};

	try
	{
		if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
		else await interaction.reply(payload);
	}
	catch (replyError)
	{
		console.error("Không gửi được thông báo lỗi cho người dùng:", replyError);
	}
}
