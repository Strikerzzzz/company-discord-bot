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
	/** Trang web quản trị (DEC-039); null = tắt (không đặt WEB_PORT). */
	web: WebConfig | null;
}

/** Cấu hình trang web quản trị (DEC-039). */
export interface WebConfig
{
	/** Cổng HTTP. */
	port: number;
	/** Địa chỉ lắng nghe; mặc định 0.0.0.0 để máy khác trong mạng nội bộ truy cập được. */
	host: string;
	/**
	 * URL gốc admin mở trong trình duyệt, không có "/" ở cuối (ví dụ http://192.168.0.206:8787). Dùng cho redirect OAuth2
	 * (`<baseUrl>/auth/callback`) và để kiểm tra Host/Origin của request.
	 */
	baseUrl: string;
	/** Client Secret của Discord Application (OAuth2). Bí mật: không bao giờ log hay đưa vào thông báo lỗi. */
	clientSecret: string;
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
		web: loadWebConfig(env),
	};
}

/**
 * Cấu hình web quản trị: không đặt WEB_PORT thì trả về null (web tắt). Đặt WEB_PORT thì bắt buộc có WEB_BASE_URL (http/https,
 * chỉ gồm scheme, host và cổng) và DISCORD_CLIENT_SECRET. Lỗi không bao giờ chứa giá trị secret.
 */
export function loadWebConfig(env: NodeJS.ProcessEnv = process.env): WebConfig | null
{
	if (optionalEnv(env, "WEB_PORT") === undefined) return null;
	const port = integerEnv(env, "WEB_PORT", 0, 1024, 65535);
	const baseUrl = parseBaseUrl(requireEnv(env, "WEB_BASE_URL"));
	const clientSecret = requireEnv(env, "DISCORD_CLIENT_SECRET");
	if (/\s/u.test(clientSecret)) throw new Error("DISCORD_CLIENT_SECRET có khoảng trắng hoặc xuống dòng ở giữa. Dán lại trên một dòng.");
	return { port, host: optionalEnv(env, "WEB_HOST") ?? "0.0.0.0", baseUrl, clientSecret };
}

function parseBaseUrl(raw: string): string
{
	let url: URL;
	try
	{
		url = new URL(raw);
	}
	catch
	{
		throw new Error("WEB_BASE_URL không phải URL hợp lệ. Ví dụ: http://192.168.0.206:8787");
	}
	const plain = (url.pathname === "/" || url.pathname === "") && url.search === "" && url.hash === "" && url.username === "" && url.password === "";
	if ((url.protocol !== "http:" && url.protocol !== "https:") || !plain)
	{
		throw new Error("WEB_BASE_URL chỉ gồm http(s)://địa-chỉ:cổng, không có đường dẫn phía sau. Ví dụ: http://192.168.0.206:8787");
	}
	return url.origin;
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
