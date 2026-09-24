import { ContextMenuCommandBuilder,
	MessageContextMenuCommandInteraction,
	UserContextMenuCommandInteraction } from "discord.js";
import DiscordClient from "./DiscordClient";

/**
 * Derive from this class to create a new context menu interaction.
 * https://discordjs.guide/interactions/context-menus.html
 */
export default abstract class ContextMenu
{
	readonly client: DiscordClient;

	abstract data: ContextMenuCommandBuilder;

	constructor(client: DiscordClient)
	{
		this.client = client;
	}

	abstract execute(interaction: UserContextMenuCommandInteraction | MessageContextMenuCommandInteraction): Promise<void>;
}
