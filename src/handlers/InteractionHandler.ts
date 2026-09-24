import DiscordClient from "../classes/DiscordClient";
import Command from "../classes/Command";
import ContextMenu from "../classes/ContextMenu";
import { join } from "path";
import { readdirSync, existsSync } from "fs";
import { Collection, REST, RESTPostAPIApplicationCommandsJSONBody, Routes } from "discord.js";
import { token, clientId, guildIds } from "../config.json";

export default class InteractionHandler extends Collection<string, Command | ContextMenu>
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
		// Load slash commands.
		let path = join(__dirname, "..", "interactions", "commands");
		let files = readdirSync(path);

		files.forEach((file) =>
		{
			const interactionClass = ((r) => r.default || r)(require(join(path, file)));
			const command: Command = new interactionClass(this.client);

			this.set(command.data.name, command);
			console.log(`Loaded slash command "${command.data.name}"`);

		});

		// Load context menus.
		path = join(__dirname, "..", "interactions", "contextMenus");
		if (existsSync(path))
		{
			files = readdirSync(path);

			files.forEach((file) =>
			{
				const interactionClass = ((r) => r.default || r)(require(join(path, file)));
				const contextMenu: ContextMenu = new interactionClass(this.client);

				this.set(contextMenu.data.name, contextMenu);
				console.log(`Loaded context menu "${contextMenu.data.name}"`);

			});
		}
		else
		{
			console.log("No conext menus loaded! Directory does not exist.");
		}
	}

	async deploy(): Promise<void>
	{
		const rest = new REST({ version: "10" }).setToken(token);
		const globalCommands: RESTPostAPIApplicationCommandsJSONBody[] = [];
		const guildCommands: RESTPostAPIApplicationCommandsJSONBody[] = [];

		this.forEach(cmd =>
		{
			if (cmd.global) globalCommands.push(cmd.data.toJSON());
			else guildCommands.push(cmd.data.toJSON());
		});

		// Deploy lỗi ở một guild thì chỉ ghi log, không chặn các guild khác và không chặn bot khởi động.
		for (const id of guildIds)
		{
			try
			{
				await rest.put(Routes.applicationGuildCommands(clientId, id), { body: guildCommands });
				console.log(`Đã đăng ký ${guildCommands.length} command cho guild "${id}".`);
			}
			catch (error)
			{
				console.error(`Không đăng ký được command cho guild "${id}":`, error);
			}
		}

		try
		{
			await rest.put(Routes.applicationCommands(clientId), { body: globalCommands });
			console.log(`Đã đăng ký ${globalCommands.length} global command.`);
		}
		catch (error)
		{
			console.error("Không đăng ký được global command:", error);
		}
	}
}
