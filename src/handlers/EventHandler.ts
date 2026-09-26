import DiscordClient from "../classes/DiscordClient";
import Event from "../classes/Event";
import { join } from "path";
import { Collection } from "discord.js";
import { loadModules } from "./loadModules";
import { logger } from "../shared/logger";

export default class EventHandler extends Collection<string, Event>
{
	readonly client: DiscordClient;

	constructor(client: DiscordClient)
	{
		super();

		this.client = client;
		this.init();
	}

	private init(): void
	{
		for (const event of loadModules(join(__dirname, "..", "events"), Event, this.client))
		{
			this.set(event.name, event);

			this.client[event.once ? "once" : "on"](
				event.name,
				(...args: unknown[]) =>
				{
					// EventEmitter bỏ qua Promise mà listener trả về, nên lỗi phải được bắt ở đây (LL-001).
					event.execute(...args).catch((error: unknown) => logger.error(`Lỗi trong event "${event.name}":`, error));
				},
			);

			logger.debug(`Loaded event "${event.name}"`);
		}
	}
}
