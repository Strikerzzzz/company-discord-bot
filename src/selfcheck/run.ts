import { statSync } from "fs";
import { dirname, join } from "path";
import { redact } from "../shared/logger";
import { checkConfig, checkEnvFileMode, checkNodeVersion, CheckResult, CheckStatus, checkWritableDirectory, errorText, warn } from "./checks";
import { checkDatabaseFile, checkMigrations, checkSqlite, loadSqliteToolkit, SqliteToolkit } from "./database";
import { CanvasToolkit, checkCanvas, checkRendering, loadCanvasToolkit } from "./render";

/*
 * Chạy lần lượt các bước selfcheck (DEC-034) và in mỗi kết quả thành một dòng ngay khi có, để nếu process bị dừng giữa
 * chừng (ví dụ vượt MemoryMax) thì dòng cuối cùng cho biết đã tới bước nào. Không kết nối Discord, không gọi mạng,
 * không ghi vào database thật. Mọi dòng in ra đều đi qua redactSecrets.
 */

export interface SelfCheckOptions
{
	env: NodeJS.ProcessEnv;
	/** Ví dụ process.versions.node. */
	nodeVersion: string;
	platform: NodeJS.Platform;
	arch: string;
	/** Thư mục làm việc: nơi tìm file .env để kiểm tra quyền (chỉ trên Linux). */
	cwd: string;
	/** Nhận từng dòng kết quả (đã che token). */
	write: (line: string) => void;
	loadSqlite?: () => Promise<SqliteToolkit>;
	loadCanvas?: () => Promise<CanvasToolkit>;
	/** Đồng hồ đo thời gian vẽ, tính bằng ms. */
	now?: () => number;
}

export interface SelfCheckReport
{
	results: CheckResult[];
	/** 1 nếu có ít nhất một kết quả fail. */
	exitCode: 0 | 1;
}

const ICONS: Readonly<Record<CheckStatus, string>> = { ok: "✅", warn: "⚠️", fail: "❌" };
const HIDDEN = "[đã ẩn]";

/** Che mọi lần xuất hiện của DISCORD_TOKEN (nguyên văn và đã trim), rồi che thêm chuỗi có dạng token như logger của bot. */
export function redactSecrets(text: string, env: NodeJS.ProcessEnv): string
{
	const raw = env.DISCORD_TOKEN ?? "";
	const secrets = [raw, raw.trim()]
		.filter(secret => secret.trim().length > 0)
		.sort((a, b) => b.length - a.length);
	return redact(secrets.reduce((result, secret) => result.split(secret).join(HIDDEN), text));
}

function envFileResult(options: SelfCheckOptions): CheckResult | null
{
	if (options.platform !== "linux") return null;
	const path = join(options.cwd, ".env");
	try
	{
		const stat = statSync(path, { throwIfNoEntry: false });
		return stat?.isFile() ? checkEnvFileMode(path, stat.mode) : null;
	}
	catch (error)
	{
		return warn("env-file", `Không kiểm tra được quyền của ${path}: ${errorText(error)}.`);
	}
}

function verdict(failed: number, warned: number): string
{
	if (failed > 0) return "Có lỗi: sửa các dòng ❌ rồi chạy lại trước khi bật bot.";
	if (warned > 0) return "Bật bot được; nên xem lại các dòng ⚠️.";
	return "Môi trường sẵn sàng.";
}

export async function runSelfCheck(options: SelfCheckOptions): Promise<SelfCheckReport>
{
	const results: CheckResult[] = [];
	const print = (line: string): void => options.write(redactSecrets(line, options.env));
	const report = (...items: CheckResult[]): void =>
	{
		for (const item of items)
		{
			results.push(item);
			print(`${ICONS[item.status]} ${item.message}`);
		}
	};

	print("Tự kiểm tra môi trường (selfcheck): không kết nối Discord, không gọi mạng, không sửa database.");
	report(checkNodeVersion(options.nodeVersion));

	const config = checkConfig(options.env);
	report(...config.results);
	const paths = config.paths;
	if (paths)
	{
		report(checkWritableDirectory("Thư mục database", dirname(paths.databasePath)));
		report(checkWritableDirectory("Thư mục backup", paths.backupDir));
	}
	else
	{
		report(warn("directories", "Bỏ qua kiểm tra thư mục và database vì cấu hình lỗi."));
	}

	const sqlite = await checkSqlite(options.loadSqlite ?? loadSqliteToolkit, options.platform, options.arch);
	report(sqlite.result);
	if (sqlite.toolkit)
	{
		if (paths) report(...checkDatabaseFile(paths.databasePath, sqlite.toolkit));
		report(checkMigrations(sqlite.toolkit));
	}
	else
	{
		report(warn("database", "Bỏ qua kiểm tra database và migration vì better-sqlite3 không nạp được."));
	}

	const canvas = await checkCanvas(options.loadCanvas ?? loadCanvasToolkit, options.platform, options.arch);
	report(...canvas.results);
	if (canvas.toolkit)
	{
		report(...await checkRendering(canvas.toolkit, options.now ?? (() => performance.now())));
	}
	else
	{
		report(warn("render", "Bỏ qua vẽ ảnh thử vì canvas hoặc font lỗi: bot sẽ không gửi được ảnh /rank, /leaderboard, Bảng vàng."));
	}

	const envFile = envFileResult(options);
	if (envFile) report(envFile);

	const count = (status: CheckStatus): number => results.filter(result => result.status === status).length;
	const failed = count("fail");
	const warned = count("warn");
	print("");
	print(`Tổng kết: ${count("ok")} ✅ · ${warned} ⚠️ · ${failed} ❌. ${verdict(failed, warned)}`);
	return { results, exitCode: failed > 0 ? 1 : 0 };
}
