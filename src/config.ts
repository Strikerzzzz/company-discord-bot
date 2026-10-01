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
	/** Ghi retro vào Confluence nội bộ (DEC-049); null = tắt (không đặt CONFLUENCE_BASE_URL và CONFLUENCE_TOKEN). */
	confluence: ConfluenceConfig | null;
}

/** Kết nối Confluence nội bộ để bot ghi bảng retro (DEC-049, ngoại lệ luật protected số 3). */
export interface ConfluenceConfig
{
	/**
	 * Địa chỉ gốc của Confluence, https, không có "/" ở cuối (ví dụ https://confluence.congty.vn hoặc
	 * https://congty.vn/confluence). Bot chỉ gửi token tới đúng host này.
	 */
	baseUrl: string;
	/** Personal Access Token (header Bearer). Bí mật: không bao giờ log hay đưa vào thông báo lỗi. */
	token: string;
	/**
	 * Khoá các space bot được ghi (CONFLUENCE_SPACE_KEYS, ví dụ ["P2"]); trước khi ghi, bot đọc space của trang và từ chối nếu không có
	 * trong danh sách (so không phân biệt hoa thường). Rỗng: bot từ chối mọi lần ghi.
	 */
	spaceKeys: string[];
}

/** Khoá space của Confluence: chữ, số, `_`, `-`, `.`; space cá nhân bắt đầu bằng `~` (có thể có `@`). */
const SPACE_KEY = /^~?[A-Za-z0-9_.@-]{1,255}$/u;

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
		confluence: loadConfluenceConfig(env),
	};
}

/**
 * Cấu hình ghi Confluence (DEC-049): không đặt cả CONFLUENCE_BASE_URL lẫn CONFLUENCE_TOKEN thì trả về null (tắt; retro vẫn chạy,
 * chỉ bỏ bước ghi). Đặt một trong hai thì bắt buộc đủ cả hai. CONFLUENCE_SPACE_KEYS là danh sách space được ghi; bỏ trống thì vẫn
 * khởi động được nhưng mọi lần ghi bị từ chối (selfcheck cảnh báo). Lỗi không bao giờ chứa giá trị token.
 */
export function loadConfluenceConfig(env: NodeJS.ProcessEnv = process.env): ConfluenceConfig | null
{
	const rawBase = optionalEnv(env, "CONFLUENCE_BASE_URL");
	const token = optionalEnv(env, "CONFLUENCE_TOKEN");
	if (rawBase === undefined && token === undefined) return null;
	if (rawBase === undefined) throw new Error("Có CONFLUENCE_TOKEN nhưng thiếu CONFLUENCE_BASE_URL. Chạy lại deploy/enable-confluence.sh, hoặc xoá cả hai để tắt ghi Confluence.");
	if (token === undefined) throw new Error("Có CONFLUENCE_BASE_URL nhưng thiếu CONFLUENCE_TOKEN. Chạy lại deploy/enable-confluence.sh, hoặc xoá cả hai để tắt ghi Confluence.");
	if (/\s/u.test(token)) throw new Error("CONFLUENCE_TOKEN có khoảng trắng hoặc xuống dòng ở giữa. Dán lại trên một dòng.");
	return { baseUrl: parseConfluenceBaseUrl(rawBase), token, spaceKeys: parseSpaceKeys(optionalEnv(env, "CONFLUENCE_SPACE_KEYS") ?? "") };
}

/** CONFLUENCE_SPACE_KEYS: khoá space cách nhau bằng dấu phẩy (bỏ khoảng trắng, mục rỗng và mục trùng không phân biệt hoa thường). */
export function parseSpaceKeys(raw: string): string[]
{
	const keys: string[] = [];
	for (const part of raw.split(","))
	{
		const key = part.trim();
		if (key.length === 0) continue;
		if (!SPACE_KEY.test(key)) throw new Error(`CONFLUENCE_SPACE_KEYS có khoá space không hợp lệ: "${key}". Ví dụ đúng: P2 hoặc P2,PMS.`);
		if (!keys.some(existing => existing.toUpperCase() === key.toUpperCase())) keys.push(key);
	}
	return keys;
}

/** https://host[:port][/đường-dẫn-gốc], không query, hash hay tài khoản; bỏ "/" ở cuối. */
export function parseConfluenceBaseUrl(raw: string): string
{
	const example = "Ví dụ: https://confluence.congty.vn";
	let url: URL;
	try
	{
		url = new URL(raw);
	}
	catch
	{
		throw new Error(`CONFLUENCE_BASE_URL không phải URL hợp lệ. ${example}`);
	}
	if (url.protocol !== "https:") throw new Error(`CONFLUENCE_BASE_URL phải dùng https (token không được gửi qua kết nối không mã hoá). ${example}`);
	if (url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "")
	{
		throw new Error(`CONFLUENCE_BASE_URL chỉ gồm https://địa-chỉ và đường dẫn gốc (nếu có), không có ? # hay tài khoản. ${example}`);
	}
	const path = url.pathname.replace(/\/+$/u, "");
	return `${url.origin}${path}`;
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
