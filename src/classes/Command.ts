import { ChatInputCommandInteraction,
	ButtonInteraction,
	AutocompleteInteraction,
	SlashCommandBuilder,
	SlashCommandOptionsOnlyBuilder,
	SlashCommandSubcommandsOnlyBuilder } from "discord.js";
import DiscordClient from "./DiscordClient";

/**
 * Derive from this class to create a new slash command interaction.
 * https://discordjs.guide/interactions/slash-commands.html
 */
export default abstract class Command
{
	readonly client: DiscordClient;

	abstract data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
	global = false;
	buttonIds: string[] = [];

	constructor(client: DiscordClient)
	{
		this.client = client;
	}

	abstract execute(interaction: ChatInputCommandInteraction): Promise<void>;

	// Chỉ command có gửi button (khai báo trong buttonIds) mới cần override.
	executeButton(interaction: ButtonInteraction): Promise<void>
	{
		return Promise.reject(new Error(`Method not implemented for button: ${interaction.customId}`));
	}

	// Chỉ command có option bật autocomplete mới cần override.
	autocomplete(interaction: AutocompleteInteraction): string[]
	{
		throw new Error(`Autocomplete not implemented for interaction: ${interaction.commandName}`);
	}
}
