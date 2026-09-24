import { Events } from "discord.js";
import DiscordClient from "../classes/DiscordClient";
import Event from "../classes/Event";
import Sqlite from "../classes/Sqlite";

export default class Ready extends Event
{
	name = Events.ClientReady;
	once = true;

	async execute(client: DiscordClient): Promise<void>
	{
		await client.interactions.deploy();

		Sqlite.setup();

		console.log(`Ready! Logged in as "${this.client.user?.tag}"`);
	}
}