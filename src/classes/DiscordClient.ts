import { Client, Events, GatewayIntentBits } from "discord.js";
import ProcessManager from "./ProcessManager";
import EventHandler from "../handlers/EventHandler";
import InteractionHandler from "../handlers/InteractionHandler";
import ButtonHandler from "../handlers/ButtonHandler";

export default class DiscordClient extends Client
{
	public events = new EventHandler(this);
	public interactions = new InteractionHandler(this);
	public buttons = new ButtonHandler(this);

	// Các guild được đăng ký slash command.
	readonly guildIds: readonly string[];

	constructor(guildIds: readonly string[])
	{
		super({
			intents: [
				GatewayIntentBits.Guilds,
			],
			// Mặc định không ping ai: nội dung do người dùng nhập mà bot gửi lại không thể kích hoạt
			// @everyone, @here, role hay user mention. Command nào cần mention phải bật lại có chủ đích.
			allowedMentions: { parse: [], repliedUser: false },
		});

		this.guildIds = guildIds;

		// Nếu không có listener cho "error", EventEmitter sẽ ném lỗi và làm sập process.
		this.on(Events.Error, (error) => console.error("Lỗi từ discord.js client:", error));

		new ProcessManager(this);
	}
}
