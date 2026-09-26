import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import Command from "../../classes/Command";

// Health check: kiểm tra bot còn phản hồi và độ trễ tới Discord.
export default class PingCmd extends Command
{
	data = new SlashCommandBuilder()
		.setName("ping")
		.setDescription("Kiểm tra bot còn hoạt động và độ trễ tới Discord");

	async execute(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const rtt = Math.abs(Date.now() - interaction.createdTimestamp);
		const websocketHeartbeat = Math.floor(this.client.ws.ping);

		await interaction.reply(`🏓 Pong!\n> Heartbeat WebSocket: **${websocketHeartbeat}ms**\n> Độ trễ phản hồi: **${rtt}ms**`);
	}
}
