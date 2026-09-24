import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import Command from "../../classes/Command";

// Example slash command. The simplest type of command to exist.
// Don't forget to rename the file and the class if you copy-paste this and use it as a snippet.
export default class PingCmd extends Command
{
	data = new SlashCommandBuilder()
		.setName("ping")
		.setDescription("Pong!")
	override global = true;

	// The execute function is called when a user enters the slash command.
	// It gets called by the interactionCreate event.
	async execute(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const rtt = Math.abs(Date.now() - interaction.createdTimestamp);
		const websocketHeartbeat = Math.floor(this.client.ws.ping);

		await interaction.reply(`Pong! \n> Websocket Heartbeat: **${websocketHeartbeat}ms**\n> Roundtrip Latency: **${rtt}ms**`);
	}
}
