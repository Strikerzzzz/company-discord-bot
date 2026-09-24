import DiscordClient from "../classes/DiscordClient";
import Command from "../classes/Command";
import { Collection } from "discord.js";

/**
 * customId của button có dạng "<namespace>" hoặc "<namespace>:<payload>".
 * Command khai báo các namespace mình sở hữu trong `buttonIds`; phần payload (ví dụ ID của một bản ghi)
 * do command tự parse và validate, vì người dùng Discord không sửa được customId nhưng payload vẫn có thể cũ hoặc sai.
 */
export default class ButtonHandler extends Collection<string, Command>
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
		this.client.interactions.commands.forEach(command =>
		{
			command.buttonIds.forEach(namespace =>
			{
				if (namespace.includes(":"))
				{
					throw new Error(`buttonIds "${namespace}" của /${command.data.name} không được chứa dấu ":".`);
				}

				const owner = this.get(namespace);
				if (owner) throw new Error(`Namespace button "${namespace}" bị trùng giữa /${owner.data.name} và /${command.data.name}.`);

				this.set(namespace, command);
				console.log(`Loaded button "${namespace}"`);
			});
		});
	}

	resolve(customId: string): Command | undefined
	{
		return this.get(customId.split(":", 1)[0]);
	}
}
