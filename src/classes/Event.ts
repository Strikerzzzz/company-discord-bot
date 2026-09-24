import DiscordClient from "../classes/DiscordClient";

export default abstract class Event
{
	readonly client: DiscordClient;
	abstract name: string;
	once = false;

	constructor(client: DiscordClient)
	{
		this.client = client;
	}

	abstract execute(...args: unknown[]): Promise<void>;
}
