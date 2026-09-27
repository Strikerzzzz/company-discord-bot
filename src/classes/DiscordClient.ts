import { Client, Events, GatewayIntentBits } from "discord.js";
import EventHandler from "../handlers/EventHandler";
import InteractionHandler from "../handlers/InteractionHandler";
import ButtonHandler from "../handlers/ButtonHandler";
import { AvatarFetcher } from "../discord/avatars";
import { MemberDirectory } from "../discord/memberDirectory";
import { RenderGate } from "../discord/renderGate";
import { AppServices } from "../services";
import { logger } from "../shared/logger";

export default class DiscordClient extends Client
{
	public events = new EventHandler(this);
	public interactions = new InteractionHandler(this);
	public buttons = new ButtonHandler(this);

	// Các guild được đăng ký slash command.
	readonly guildIds: readonly string[];
	// Service nghiệp vụ cho command/event (context object, PROP-011).
	readonly services: AppServices;
	// Tải avatar từ CDN của Discord để vẽ ảnh thẻ (DEC-030); có cache trong bộ nhớ.
	readonly avatars = new AvatarFetcher();
	// Tên hiển thị và avatar của thành viên cho ảnh bảng xếp hạng; có cache trong bộ nhớ.
	readonly members = new MemberDirectory();
	// Cooldown theo người và giới hạn số lần vẽ ảnh đồng thời cho /rank, /leaderboard và Bảng vàng.
	readonly renderGate = new RenderGate();

	constructor(services: AppServices, guildIds: readonly string[])
	{
		super({
			intents: [
				GatewayIntentBits.Guilds,
				// Nhận tin nhắn để tính Activity XP (DEC-022).
				GatewayIntentBits.GuildMessages,
				// Privileged: đọc nội dung để chống spam, chỉ xử lý trong bộ nhớ (DEC-023).
				GatewayIntentBits.MessageContent,
			],
			// Mặc định không ping ai: nội dung do người dùng nhập mà bot gửi lại không thể kích hoạt
			// @everyone, @here, role hay user mention. Command nào cần mention phải bật lại có chủ đích.
			allowedMentions: { parse: [], repliedUser: false },
		});

		this.services = services;
		this.guildIds = guildIds;

		// Nếu không có listener cho "error", EventEmitter sẽ ném lỗi và làm sập process.
		this.on(Events.Error, (error) => logger.error("Lỗi từ discord.js client:", error));
	}
}
