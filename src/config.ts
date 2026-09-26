// Cấu hình đọc từ biến môi trường (DEC-015). Khi chạy bằng npm script, file .env được nạp qua `node --env-file`.
// Không bao giờ đưa giá trị token vào log hay thông báo lỗi.
import { join, resolve } from "path";

export interface BotConfig
{
	token: string;
	guildIds: string[];
	/** File SQLite của bot (DEC-003). */
	databasePath: string;
	/** Thư mục chứa bản sao lưu hàng ngày (DEC-017). */
	backupDir: string;
	/** Số bản sao lưu giữ lại. */
	backupKeep: number;
}

// Discord snowflake: chuỗi số 17–20 chữ số.
const SNOWFLAKE = /^\d{17,20}$/;
// Thư mục gốc dự án (build/.. khi chạy bản build).
const PROJECT_ROOT = join(__dirname, "..");

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig
{
	const token = requireEnv(env, "DISCORD_TOKEN");

	const guildIds = requireEnv(env, "DISCORD_GUILD_IDS")
		.split(",")
		.map(id => id.trim())
		.filter(id => id.length > 0);
	const invalidIds = guildIds.filter(id => !SNOWFLAKE.test(id));
	if (guildIds.length === 0 || invalidIds.length > 0)
	{
		throw new Error(`DISCORD_GUILD_IDS không hợp lệ: ${invalidIds.join(", ") || "(rỗng)"}. Cần danh sách guild ID cách nhau bằng dấu phẩy.`);
	}

	return {
		token,
		guildIds,
		databasePath: resolve(optionalEnv(env, "DATABASE_PATH") ?? join(PROJECT_ROOT, "data", "bot.db")),
		backupDir: resolve(optionalEnv(env, "BACKUP_DIR") ?? join(PROJECT_ROOT, "data", "backups")),
		backupKeep: integerEnv(env, "BACKUP_KEEP", 14, 1, 365),
	};
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string
{
	const value = optionalEnv(env, name);
	if (!value) throw new Error(`Thiếu biến môi trường ${name}. Xem .env.example.`);
	return value;
}

function optionalEnv(env: NodeJS.ProcessEnv, name: string): string | undefined
{
	const value = env[name]?.trim();
	return value ? value : undefined;
}

function integerEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number
{
	const raw = optionalEnv(env, name);
	if (raw === undefined) return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < min || value > max)
	{
		throw new Error(`${name} phải là số nguyên từ ${min} đến ${max}.`);
	}
	return value;
}
