import { Events } from "discord.js";
import DiscordClient from "../classes/DiscordClient";
import Event from "../classes/Event";
import { startPollScheduler } from "../discord/pollScheduler";
import { logger } from "../shared/logger";

export default class Ready extends Event
{
	name = Events.ClientReady;
	override once = true;

	async execute(client: DiscordClient): Promise<void>
	{
		await client.interactions.deploy(client.guildIds);
		startPollScheduler(client);
		logger.info(`Bot đã sẵn sàng: ${client.user?.tag ?? "(không rõ tên)"}`);
	}
}
