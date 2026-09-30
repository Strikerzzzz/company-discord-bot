import { Events } from "discord.js";
import DiscordClient from "./classes/DiscordClient";
import ProcessManager from "./classes/ProcessManager";
import { loadConfig } from "./config";
import { startBackupSchedule } from "./db/backup";
import { openDatabase } from "./db/connection";
import { runMigrations } from "./db/migrations";
import { createServices } from "./services";
import { systemClock } from "./shared/clock";
import { logger, registerSecret } from "./shared/logger";
import { DEFAULT_ADMIN_ACTIONS } from "./discord/adminOps";
import { DEFAULT_LIVE_BOARD_ACTIONS } from "./discord/configOps";
import { startWebServer, WebServerHandle } from "./web/server";

// Lưới an toàn cuối cùng: lỗi async không có ai bắt thì chỉ ghi log, không để process thoát (LL-001).
process.on("unhandledRejection", (reason) =>
{
	logger.error("Unhandled promise rejection:", reason);
});

/** Composition root: config → database → migration → service → Discord client → login. */
async function main(): Promise<void>
{
	const config = loadConfig();
	registerSecret(config.token);
	if (config.web) registerSecret(config.web.clientSecret);

	// Database mở và migrate TRƯỚC khi login Discord (LL-007).
	const db = openDatabase(config.databasePath);
	const applied = runMigrations(db);
	logger.info(`Database: ${config.databasePath} (áp dụng ${applied} migration mới).`);

	const services = createServices(db, { clock: systemClock, backupDir: config.backupDir, backupKeep: config.backupKeep });
	const stopBackups = startBackupSchedule(services.backup);
	const client = new DiscordClient(services, config.guildIds);

	// Trang web quản trị (DEC-039): chỉ mở khi có WEB_PORT, sau khi bot sẵn sàng (cần cache server, role, kênh).
	let web: WebServerHandle | null = null;
	const webConfig = config.web;
	if (webConfig)
	{
		client.once(Events.ClientReady, () =>
		{
			startWebServer({
				client,
				services,
				guildIds: config.guildIds,
				config: webConfig,
				fetch: (input, init) => fetch(input, init),
				clock: systemClock,
				liveBoardActions: DEFAULT_LIVE_BOARD_ACTIONS,
				adminActions: DEFAULT_ADMIN_ACTIONS,
			})
				.then(handle =>
				{
					web = handle;
					logger.info(`Trang web quản trị: ${webConfig.baseUrl} (lắng nghe ${webConfig.host}:${handle.port}).`);
				})
				.catch((error: unknown) => logger.error("Không mở được trang web quản trị (bot vẫn chạy bình thường):", error));
		});
	}

	new ProcessManager([
		() => web?.close(),
		() => stopBackups(),
		() => client.destroy(),
		() => db.close(),
	]);

	await client.login(config.token);
}

main().catch((error: unknown) =>
{
	logger.error("Không khởi động được bot:", error);
	process.exit(1);
});
