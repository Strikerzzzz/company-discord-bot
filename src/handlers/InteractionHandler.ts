import DiscordClient from "../classes/DiscordClient";
import Command from "../classes/Command";
import ContextMenu from "../classes/ContextMenu";
import { join } from "path";
import { Collection, RESTPostAPIApplicationCommandsJSONBody } from "discord.js";
import { loadModules } from "./loadModules";

export default class InteractionHandler
{
	readonly client: DiscordClient;
	// Tách riêng hai loại để dispatcher lấy đúng kiểu, không cần ép kiểu.
	readonly commands = new Collection<string, Command>();
	readonly contextMenus = new Collection<string, ContextMenu>();

	constructor(client: DiscordClient)
	{
		this.client = client;
		this.init();
	}

	private init(): void
	{
		for (const command of loadModules(join(__dirname, "..", "interactions", "commands"), Command, this.client))
		{
			this.commands.set(command.data.name, command);
			console.log(`Loaded slash command "${command.data.name}"`);
		}

		for (const contextMenu of loadModules(join(__dirname, "..", "interactions", "contextMenus"), ContextMenu, this.client))
		{
			this.contextMenus.set(contextMenu.data.name, contextMenu);
			console.log(`Loaded context menu "${contextMenu.data.name}"`);
		}
	}

	// Gọi sau khi client đã login (event clientReady): dùng token và application ID của chính client.
	// Bot nội bộ chỉ đăng ký command theo guild: không dùng được trong DM, thay đổi có hiệu lực ngay.
	async deploy(guildIds: readonly string[]): Promise<void>
	{
		const application = this.client.application;
		if (!application) throw new Error("Chưa có application: deploy() phải được gọi sau khi client sẵn sàng.");

		const body: RESTPostAPIApplicationCommandsJSONBody[] = [
			...this.commands.map(command => command.data.toJSON()),
			...this.contextMenus.map(contextMenu => contextMenu.data.toJSON()),
		];

		// Deploy lỗi ở một guild thì chỉ ghi log, không chặn các guild khác và không chặn bot khởi động.
		for (const id of guildIds)
		{
			try
			{
				await application.commands.set(body, id);
				console.log(`Đã đăng ký ${body.length} command cho guild "${id}".`);
			}
			catch (error)
			{
				console.error(`Không đăng ký được command cho guild "${id}":`, error);
			}
		}

		// Xoá global command còn sót lại (template cũ đăng ký ping, clickme, Get User Info ở global).
		try
		{
			await application.commands.set([]);
		}
		catch (error)
		{
			console.error("Không xoá được global command cũ:", error);
		}
	}
}
