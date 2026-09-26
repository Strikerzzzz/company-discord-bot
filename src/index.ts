import DiscordClient from "./classes/DiscordClient";
import ProcessManager from "./classes/ProcessManager";
import { loadConfig } from "./config";
import { startBackupSchedule } from "./db/backup";
import { openDatabase } from "./db/connection";
import { runMigrations } from "./db/migrations";
import { createServices } from "./services";
import { systemClock } from "./shared/clock";
import { logger } from "./shared/logger";

// Lưới an toàn cuối cùng: lỗi async không có ai bắt thì chỉ ghi log, không để process thoát (LL-001).
process.on("unhandledRejection", (reason) =>
{
	logger.error("Unhandled promise rejection:", reason);
});

/** Composition root: config → database → migration → service → Discord client → login. */
async function main(): Promise<void>
{
	const config = loadConfig();

	// Database mở và migrate TRƯỚC khi login Discord (LL-007).
	const db = openDatabase(config.databasePath);
	const applied = runMigrations(db);
	logger.info(`Database: ${config.databasePath} (áp dụng ${applied} migration mới).`);

	const services = createServices(db, { clock: systemClock, backupDir: config.backupDir, backupKeep: config.backupKeep });
	const stopBackups = startBackupSchedule(services.backup);
	const client = new DiscordClient(services, config.guildIds);

	new ProcessManager([
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
