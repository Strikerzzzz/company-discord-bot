import DiscordClient from "../classes/DiscordClient";
import Event from "../classes/Event";
import { join } from "path";
import { readdirSync } from "fs";
import { Collection } from "discord.js";

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
		const path = join(__dirname, "..", "events");
		const files = readdirSync(path);

		files.forEach((file) =>
		{
			const eventClass = ((r) => r.default || r)(require(join(path, file)));
			const event: Event = new eventClass(this.client);

			this.set(event.name, event);

			this.client[event.once ? "once" : "on"](
				event.name,
				(...args: unknown[]) =>
				{
					// EventEmitter bỏ qua Promise mà listener trả về, nên lỗi phải được bắt ở đây (LL-001).
					event.execute(...args).catch((error: unknown) => console.error(`Lỗi trong event "${event.name}":`, error));
				},
			);

			console.log(`Loaded event "${event.name}"`);
		});
	}
}
