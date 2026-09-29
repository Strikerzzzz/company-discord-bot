import { randomBytes } from "crypto";
import { mkdirSync, rmSync, statSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { loadConfig, loadWebConfig } from "../config";

/*
 * Các bước tự kiểm tra môi trường (`npm run selfcheck`, DEC-034). Mỗi hàm trả về kết quả thay vì in ra hay throw,
 * và nhận đầu vào tường minh (env, phiên bản, đường dẫn) để test được với môi trường giả.
 * Không hàm nào đưa giá trị hay độ dài của DISCORD_TOKEN vào kết quả.
 */

export type CheckStatus = "ok" | "warn" | "fail";

export type CheckStep = "node" | "config" | "directories" | "sqlite" | "database" | "migrations" | "canvas" | "fonts" | "render" | "env-file";

export interface CheckResult
{
	step: CheckStep;
	/** ok: ổn; warn: bot vẫn chạy được nhưng nên xem lại; fail: phải sửa trước khi bật bot. */
	status: CheckStatus;
	/** Một dòng tiếng Việt, kèm gợi ý sửa nếu có. */
	message: string;
}

export function ok(step: CheckStep, message: string): CheckResult
{
	return { step, status: "ok", message };
}

export function warn(step: CheckStep, message: string): CheckResult
{
	return { step, status: "warn", message };
}

export function fail(step: CheckStep, message: string): CheckResult
{
	return { step, status: "fail", message };
}

export function errorText(error: unknown): string
{
	return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | null
{
	return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : null;
}

const FS_HINTS: Readonly<Record<string, string>> = {
	EROFS: "Đường dẫn nằm trong vùng chỉ đọc (ProtectSystem=strict của systemd): thêm thư mục vào ReadWritePaths của unit.",
	EACCES: "User đang chạy không có quyền ghi: kiểm tra chủ sở hữu (user chạy bot, ví dụ discordbot) và quyền của thư mục/file.",
	EPERM: "User đang chạy không có quyền ghi: kiểm tra chủ sở hữu (user chạy bot, ví dụ discordbot) và quyền của thư mục/file.",
	ENOTDIR: "Một phần của đường dẫn là file, không phải thư mục.",
	EEXIST: "Một phần của đường dẫn là file, không phải thư mục.",
	ENOSPC: "Ổ đĩa đã đầy.",
};

/** Gợi ý sửa theo mã lỗi file system (có dấu cách đứng đầu), hoặc chuỗi rỗng. */
export function fsHint(error: unknown): string
{
	const hint = FS_HINTS[errorCode(error) ?? ""];
	return hint ? ` ${hint}` : "";
}

const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 14;
const RECOMMENDED_NODE_MAJOR = 24;

/** Node ≥ 22.14 vì better-sqlite3 13 cần N-API 10 (LL-009); production dùng Node 24 LTS (DEC-016). */
export function checkNodeVersion(version: string): CheckResult
{
	const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
	if (!match) return fail("node", `Không đọc được phiên bản Node.js "${version}".`);

	const major = Number(match[1]);
	const minor = Number(match[2]);
	const label = `Node.js ${match[1]}.${match[2]}.${match[3]}`;
	if (major < MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor < MIN_NODE_MINOR))
	{
		return fail("node", `${label} quá cũ: cần tối thiểu ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} (better-sqlite3 13 cần N-API 10). Cài Node ${RECOMMENDED_NODE_MAJOR} LTS.`);
	}
	if (major === RECOMMENDED_NODE_MAJOR) return ok("node", `${label}: đúng Node ${RECOMMENDED_NODE_MAJOR} LTS khuyến nghị cho production.`);
	return warn("node", `${label}: chạy được, nhưng production nên dùng Node ${RECOMMENDED_NODE_MAJOR} LTS (DEC-016).`);
}

/** Token bot Discord gồm 3 đoạn cách nhau bởi dấu chấm. Chỉ dùng để cảnh báo dán nhầm, không bao giờ in token. */
const TOKEN_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]+$/;
/**
 * Token (đã trim) ngắn hơn mức này chắc chắn không phải token bot (token thật dài hơn nhiều). Output của selfcheck chỉ thay
 * nguyên văn token từ độ dài này trở lên, vì thay một chuỗi quá ngắn sẽ làm nát mọi dòng có chuỗi đó (redactSecrets).
 */
export const MIN_TOKEN_LENGTH = 20;
const PLACEHOLDER_TOKEN = "selfcheck";
const PLACEHOLDER_GUILD = "100000000000000000";
const LOG_LEVELS: readonly string[] = ["debug", "info", "warn", "error"];
/** Giống SNOWFLAKE trong src/config.ts. */
const GUILD_ID = /^\d{17,20}$/;

export interface ConfigPaths
{
	databasePath: string;
	backupDir: string;
}

export interface ConfigCheck
{
	results: CheckResult[];
	/** Đường dẫn database và backup đã resolve như bot; null nếu cấu hình lỗi tới mức không đọc được. */
	paths: ConfigPaths | null;
}

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

function attempt<T>(run: () => T): Attempt<T>
{
	try
	{
		return { ok: true, value: run() };
	}
	catch (error)
	{
		return { ok: false, error: errorText(error) };
	}
}

function checkToken(value: string | undefined): CheckResult
{
	const token = value?.trim() ?? "";
	if (!token) return fail("config", "DISCORD_TOKEN: chưa có. Điền vào file .env (máy dev) hoặc file EnvironmentFile của service (server).");
	if (/\s/.test(token))
	{
		return fail("config", "DISCORD_TOKEN: có khoảng trắng hoặc xuống dòng ở giữa, bot chắc chắn đăng nhập lỗi. Dán lại token trên một dòng, không có dấu cách.");
	}
	if (token.length < MIN_TOKEN_LENGTH)
	{
		return fail("config", "DISCORD_TOKEN: có, nhưng quá ngắn, không giống token bot: bot sẽ đăng nhập lỗi. Dán lại token lấy ở Discord Developer Portal (mục Bot, Reset Token).");
	}
	if (!TOKEN_SHAPE.test(token))
	{
		return warn("config", "DISCORD_TOKEN: có, nhưng không giống token bot (3 đoạn cách nhau bởi dấu chấm). Kiểm tra có dán nhầm Client Secret hoặc Application ID không.");
	}
	return ok("config", "DISCORD_TOKEN: có.");
}

const LISTED_POSITIONS_MAX = 5;

/**
 * Lỗi DISCORD_GUILD_IDS chỉ nêu vị trí của mục sai (đếm từ 1 theo dấu phẩy), không nêu giá trị: người vận hành có thể dán
 * nhầm token hay secret khác vào biến này. Vì vậy không dùng thông báo lỗi của loadConfig (có chứa giá trị).
 */
function guildIdsFailure(value: string | undefined): CheckResult
{
	const raw = value?.trim() ?? "";
	if (!raw) return fail("config", "DISCORD_GUILD_IDS: chưa có. Điền danh sách guild ID cách nhau bằng dấu phẩy.");
	const positions = raw.split(",")
		.map((item, index) => ({ item: item.trim(), position: index + 1 }))
		.filter(({ item }) => item.length > 0 && !GUILD_ID.test(item))
		.map(({ position }) => position);
	const listed = positions.slice(0, LISTED_POSITIONS_MAX).join(", ");
	const more = positions.length > LISTED_POSITIONS_MAX ? ` và ${positions.length - LISTED_POSITIONS_MAX} mục khác` : "";
	const where = positions.length > 0 ? `mục thứ ${listed}${more} không phải guild ID (17–20 chữ số)` : "không có guild ID nào";
	return fail("config", `DISCORD_GUILD_IDS không hợp lệ: ${where}. Cần danh sách guild ID cách nhau bằng dấu phẩy.`);
}

/**
 * Cấu hình trang web quản trị (DEC-039), đọc bằng đúng loadWebConfig của bot. Không in Client Secret (chỉ báo "có"); lỗi của
 * loadWebConfig chỉ nêu tên biến, không nêu giá trị.
 */
export function checkWebConfig(env: NodeJS.ProcessEnv): CheckResult
{
	const web = attempt(() => loadWebConfig(env));
	if (!web.ok) return fail("config", `Trang web quản trị: ${web.error}`);
	if (web.value === null) return ok("config", "Trang web quản trị: tắt (không đặt WEB_PORT).");
	const { port, host, baseUrl } = web.value;
	const url = new URL(baseUrl);
	const urlPort = Number(url.port || (url.protocol === "https:" ? "443" : "80"));
	if (urlPort !== port)
	{
		return warn("config", `Trang web quản trị: cổng trong WEB_BASE_URL (${urlPort}) khác WEB_PORT (${port}). Chỉ đúng khi có proxy chuyển `
			+ `tiếp từ cổng ${urlPort} sang ${port}; nếu không, trình duyệt sẽ không mở được trang và đăng nhập Discord sẽ lỗi. Sửa cho hai số khớp nhau.`);
	}
	return ok("config", `Trang web quản trị: bật, lắng nghe ${host}:${port}, địa chỉ ${baseUrl}; DISCORD_CLIENT_SECRET: có. `
		+ `Redirect cần đăng ký trên Developer Portal (OAuth2 → Redirects): ${baseUrl}/auth/callback`);
}

/**
 * Đọc cấu hình bằng đúng loadConfig của bot. Token luôn được thay bằng chuỗi giả trước khi gọi loadConfig, nên token thật
 * không thể lọt vào thông báo lỗi. Guild ID và các biến còn lại được kiểm tra riêng để một lần chạy báo đủ các lỗi.
 * Giá trị sai của biến cấu hình không được in lại (có thể là secret dán nhầm chỗ, hoặc chứa ký tự xuống dòng tạo dòng giả).
 */
export function checkConfig(env: NodeJS.ProcessEnv): ConfigCheck
{
	const results = [checkToken(env.DISCORD_TOKEN)];
	const base: NodeJS.ProcessEnv = { ...env, DISCORD_TOKEN: PLACEHOLDER_TOKEN };

	const guilds = attempt(() => loadConfig({ ...base, BACKUP_KEEP: undefined }).guildIds);
	results.push(guilds.ok
		? ok("config", `DISCORD_GUILD_IDS: ${guilds.value.length} guild hợp lệ (${guilds.value.join(", ")}).`)
		: guildIdsFailure(env.DISCORD_GUILD_IDS));

	const rest = attempt(() => loadConfig({ ...base, DISCORD_GUILD_IDS: PLACEHOLDER_GUILD, WEB_PORT: undefined }));
	results.push(rest.ok
		? ok("config", `Database: ${rest.value.databasePath} · Backup: ${rest.value.backupDir} (giữ ${rest.value.backupKeep} bản).`)
		: fail("config", rest.error));
	results.push(checkWebConfig(env));

	const logLevel = env.LOG_LEVEL;
	if (logLevel && !LOG_LEVELS.includes(logLevel))
	{
		results.push(warn("config", `LOG_LEVEL không hợp lệ, bot sẽ dùng info. Dùng một trong: ${LOG_LEVELS.join(", ")}.`));
	}

	return {
		results,
		paths: rest.ok ? { databasePath: rest.value.databasePath, backupDir: rest.value.backupDir } : null,
	};
}

/**
 * Xoá thư mục selfcheck vừa tạo để thử (thư mục đầu tiên mkdirSync phải tạo, trước đó chưa tồn tại nên bên trong chỉ có
 * thứ selfcheck tạo ra). Có thử lại vì trên Windows, file tạm vừa xoá có thể còn bị phần mềm diệt virus giữ trong giây lát.
 */
function removeCreated(path: string): boolean
{
	try
	{
		rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
		return true;
	}
	catch
	{
		return false;
	}
}

function probeDirectory(label: string, dir: string, created: string | undefined): CheckResult
{
	const probe = join(dir, `.selfcheck-${process.pid}-${randomBytes(4).toString("hex")}.tmp`);
	writeFileSync(probe, "selfcheck\n", { flag: "wx" });
	rmSync(probe);
	const note = created ? " (chưa có; đã tạo thử rồi xoá, bot sẽ tự tạo khi chạy)" : "";
	return ok("directories", `${label} ghi được: ${dir}${note}.`);
}

/**
 * Thư mục tồn tại (hoặc tạo được) và ghi được: tạo rồi xoá một file tạm. Thư mục phải tạo thêm để thử thì được xoá lại
 * ngay sau đó (bot tự tạo khi chạy), nên selfcheck không để lại gì.
 */
export function checkWritableDirectory(label: string, directory: string): CheckResult
{
	const dir = resolve(directory);
	let created: string | undefined;
	let result: CheckResult;
	try
	{
		const stat = statSync(dir, { throwIfNoEntry: false });
		if (stat && !stat.isDirectory()) return fail("directories", `${label} ${dir} không phải thư mục.`);
		created = mkdirSync(dir, { recursive: true });
		result = probeDirectory(label, dir, created);
	}
	catch (error)
	{
		result = fail("directories", `${label} không ghi được: ${dir} (${errorText(error)}).${fsHint(error)}`);
	}

	if (created && !removeCreated(created))
	{
		result = { ...result, message: `${result.message} Không xoá được thư mục vừa tạo để thử: ${created}.` };
	}
	return result;
}

/** Quyền của file .env (chỉ ý nghĩa trên Linux): group hoặc user khác có quyền gì thì cảnh báo, vì file chứa token. */
export function checkEnvFileMode(path: string, mode: number): CheckResult
{
	const permissions = mode & 0o777;
	const text = permissions.toString(8).padStart(3, "0");
	if ((permissions & 0o077) !== 0)
	{
		return warn("env-file", `File ${path} có quyền ${text}: user khác trên máy truy cập được token. Sửa: chmod 600 ${path} (trên server file thuộc root, xem docs/DEPLOY.md mục 3).`);
	}
	return ok("env-file", `File ${path} có quyền ${text}: chỉ chủ sở hữu truy cập được.`);
}
