import { accessSync, chmodSync, closeSync, constants, copyFileSync, mkdtempSync, openSync, readSync, rmSync, statfsSync, statSync, writeSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setTimeout as delay } from "timers/promises";
import type { Db } from "../db/connection";
import { CheckResult, errorText, fail, fsHint, ok, warn } from "./checks";

/*
 * Kiểm tra better-sqlite3 và database cho selfcheck. File database thật KHÔNG được mở bằng SQLite: kể cả mở read-only,
 * SQLite vẫn tạo file -wal và -shm cạnh một database ở chế độ WAL và để lại sau khi đóng (LL-020).
 * Vì vậy selfcheck đọc header bằng fs, rồi chép file sang một thư mục tạm riêng và mở bản sao để kiểm tra hỏng và chạy
 * thử migration. Không đọc cả database vào RAM: new Database(buffer) chép buffer thêm một lần và cấp lại khi migration
 * làm database lớn lên, nên tốn khoảng ba lần dung lượng database.
 * Bot đang chạy có thể ghi vào file chính (checkpoint) đúng lúc selfcheck chép, nên bản sao có thể bị rách. Vì vậy lỗi trên
 * bản sao được kiểm lại bằng một bản sao mới; chỉ khuyên khôi phục backup khi lỗi lặp lại và không có dấu hiệu đang ghi.
 * Module này chỉ import kiểu của better-sqlite3; thư viện được nạp trong loadSqliteToolkit để lỗi binary native thành dòng ❌.
 */

/** Bộ công cụ SQLite của selfcheck; mặc định là better-sqlite3 và migration thật của bot (loadSqliteToolkit). */
export interface SqliteToolkit
{
	/** Database trống trong bộ nhớ, cùng pragma với bot. */
	openMemory(): Db;
	/** Mở bản sao của database nằm trong thư mục tạm của selfcheck, không bao giờ là file thật. */
	openCopy(path: string): Db;
	runMigrations(db: Db): number;
	schemaVersion(db: Db): number;
	/** Schema version mới nhất mà code biết. */
	latestVersion: number;
}

export async function loadSqliteToolkit(): Promise<SqliteToolkit>
{
	const [{ default: Database }, connection, migrations] = await Promise.all([
		import("better-sqlite3"),
		import("../db/connection"),
		import("../db/migrations"),
	]);
	return {
		openMemory: () => connection.openDatabase(":memory:"),
		openCopy: path =>
		{
			const db = new Database(path, { fileMustExist: true });
			db.pragma("foreign_keys = ON");
			return db;
		},
		runMigrations: db => migrations.runMigrations(db),
		schemaVersion: db => migrations.currentSchemaVersion(db),
		latestVersion: migrations.MIGRATIONS.reduce((max, migration) => Math.max(max, migration.version), 0),
	};
}

export interface SqliteCheck
{
	result: CheckResult;
	/** null nếu better-sqlite3 không nạp được; các bước database khi đó bị bỏ qua. */
	toolkit: SqliteToolkit | null;
}

/** Nạp better-sqlite3 và mở thử một database trong bộ nhớ (binary native chỉ được nạp ở lần mở đầu tiên). */
export async function checkSqlite(load: () => Promise<SqliteToolkit>, platform: string, arch: string): Promise<SqliteCheck>
{
	try
	{
		const toolkit = await load();
		const db = toolkit.openMemory();
		try
		{
			const version: unknown = db.prepare("SELECT sqlite_version()").pluck().get();
			return { result: ok("sqlite", `better-sqlite3 nạp được: SQLite ${String(version)} (${platform}-${arch}).`), toolkit };
		}
		finally
		{
			db.close();
		}
	}
	catch (error)
	{
		return {
			result: fail("sqlite", `better-sqlite3 không nạp được: ${errorText(error)}. Chạy lại "npm ci" trên chính máy này (binary native phải đúng nền tảng ${platform}-${arch}); không copy node_modules từ máy khác.`),
			toolkit: null,
		};
	}
}

/** Chạy toàn bộ migration trên database trống trong bộ nhớ. */
export function checkMigrations(sqlite: SqliteToolkit): CheckResult
{
	try
	{
		const db = sqlite.openMemory();
		try
		{
			const applied = sqlite.runMigrations(db);
			const version = sqlite.schemaVersion(db);
			if (version !== sqlite.latestVersion)
			{
				return fail("migrations", `Migration trên database trống dừng ở schema version ${version}, code mới nhất là ${sqlite.latestVersion}.`);
			}
			return ok("migrations", `Migration: chạy được toàn bộ ${applied} migration trên database trống trong bộ nhớ (schema version ${version}).`);
		}
		finally
		{
			db.close();
		}
	}
	catch (error)
	{
		return fail("migrations", `Migration lỗi trên database trống trong bộ nhớ: ${errorText(error)}.`);
	}
}

/** Cách selfcheck chép và đọc lại file database thật; test thay từng phần để giả lập bot đang ghi hoặc ổ tạm đầy. */
export interface DatabaseReadOptions
{
	/** Nơi tạo thư mục tạm chứa bản sao; mặc định os.tmpdir() (dưới PrivateTmp của systemd vẫn ghi được). */
	tempRoot: string;
	/** Chép file database thật sang bản sao. */
	copyFile: (source: string, destination: string) => void;
	/** Dung lượng trống (byte) của ổ chứa thư mục; null nếu không đọc được. */
	freeBytes: (directory: string) => number | null;
	/** Nghỉ giữa hai lần chép lại. */
	sleep: (ms: number) => Promise<void>;
}

function freeBytes(directory: string): number | null
{
	try
	{
		const stats = statfsSync(directory);
		return stats.bavail * stats.bsize;
	}
	catch
	{
		return null;
	}
}

function defaultReadOptions(): DatabaseReadOptions
{
	return {
		tempRoot: tmpdir(),
		copyFile: (source, destination) => copyFileSync(source, destination),
		freeBytes,
		sleep: ms => delay(ms),
	};
}

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "latin1");
const HEADER_BYTES = 100;
const USER_VERSION_OFFSET = 60;
const WRITE_VERSION_OFFSET = 18;
const WAL_FORMAT = 2;
const ROLLBACK_FORMAT = 1;
const MEGABYTE = 1024 * 1024;
/**
 * Chỗ trống cần có ở ổ tạm = TEMP_SPACE_FACTOR × dung lượng database + TEMP_MARGIN_BYTES: bản sao, phần bản sao lớn thêm
 * khi chạy thử migration và file -journal của bản sao. Chỉ là ước lượng để tránh làm đầy ổ, không phải giới hạn chính xác.
 */
const TEMP_SPACE_FACTOR = 1.5;
const TEMP_MARGIN_BYTES = 32 * MEGABYTE;
/** Số lần chép và kiểm tra bản sao khi bản sao báo lỗi, và khoảng nghỉ giữa hai lần. */
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;
const DETAIL_MAX = 160;
const WORKSPACE_PREFIX = "company-discord-bot-selfcheck-";
const COPY_SUFFIXES: readonly string[] = ["", "-journal", "-wal", "-shm"];

function readHeader(path: string): Buffer
{
	const header = Buffer.alloc(HEADER_BYTES);
	const fd = openSync(path, "r");
	try
	{
		const read = readSync(fd, header, 0, HEADER_BYTES, 0);
		return header.subarray(0, read);
	}
	finally
	{
		closeSync(fd);
	}
}

function isSqliteHeader(header: Buffer): boolean
{
	return header.length >= HEADER_BYTES && header.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC);
}

/** File database, -wal, -shm (nếu có) phải ghi được bởi user đang chạy, vì bot ghi vào cả ba. */
function writeProblems(path: string): CheckResult[]
{
	const problems: CheckResult[] = [];
	for (const file of [path, `${path}-wal`, `${path}-shm`])
	{
		if (!statSync(file, { throwIfNoEntry: false })) continue;
		try
		{
			accessSync(file, constants.W_OK);
		}
		catch (error)
		{
			problems.push(fail("database", `${file} không ghi được bởi user đang chạy (${errorText(error)}): bot sẽ lỗi khi ghi.${fsHint(error)}`));
		}
	}
	return problems;
}

function walHasData(path: string): boolean
{
	const wal = statSync(`${path}-wal`, { throwIfNoEntry: false });
	return wal !== undefined && wal.size > 0;
}

function compareVersion(path: string, current: number, latest: number): CheckResult
{
	if (current > latest)
	{
		return fail("database", `Database ${path} ở schema version ${current}, mới hơn code (tối đa ${latest}): code cũ hơn database, bot sẽ từ chối khởi động. Cập nhật code lên bản mới hơn.`);
	}
	if (current === latest) return ok("database", `Database ${path}: schema version ${current}, khớp code.`);
	return warn("database", `Database ${path}: schema version ${current}, cũ hơn code (${latest}). Bot sẽ tự chạy migration khi khởi động; nên có bản sao lưu mới trước khi bật.`);
}

/** Kích thước và thời điểm sửa của file thật, để biết bot có ghi vào file trong lúc selfcheck chép không. */
interface FileState
{
	size: bigint;
	mtimeNs: bigint;
}

function fileState(path: string): FileState | null
{
	const stat = statSync(path, { bigint: true, throwIfNoEntry: false });
	return stat ? { size: stat.size, mtimeNs: stat.mtimeNs } : null;
}

function sameState(a: FileState | null, b: FileState | null): boolean
{
	return a?.size === b?.size && a?.mtimeNs === b?.mtimeNs;
}

/** Thông báo lỗi của SQLite (quick_check có thể trả nhiều dòng) gom thành một dòng ngắn. */
function shortDetail(text: string): string
{
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > DETAIL_MAX ? `${line.slice(0, DETAIL_MAX - 1)}…` : line;
}

/** Bản sao chuyển từ WAL sang rollback journal, để SQLite không cần file -wal/-shm cho bản sao. */
function useRollbackJournal(copy: string): void
{
	const fd = openSync(copy, "r+");
	try
	{
		const versions = Buffer.alloc(2);
		readSync(fd, versions, 0, versions.length, WRITE_VERSION_OFFSET);
		if (!versions.includes(WAL_FORMAT)) return;
		const rollback = versions.map(value => value === WAL_FORMAT ? ROLLBACK_FORMAT : value);
		writeSync(fd, rollback, 0, rollback.length, WRITE_VERSION_OFFSET);
	}
	finally
	{
		closeSync(fd);
	}
}

function removeCopy(copy: string): void
{
	for (const suffix of COPY_SUFFIXES)
	{
		rmSync(`${copy}${suffix}`, { force: true, maxRetries: 10, retryDelay: 20 });
	}
}

/** Kết quả kiểm tra một bản sao: `problem` là mô tả lỗi của lần đọc này, null nếu bản sao ổn. */
interface CopyCheck
{
	results: CheckResult[];
	problem: string | null;
}

function corrupt(path: string, detail: string): CopyCheck
{
	return {
		results: [fail("database", `Database ${path} có dấu hiệu hỏng (${detail}). Lỗi lặp lại ở cả ${MAX_ATTEMPTS} lần chép và file không thay đổi trong lúc kiểm tra. Khôi phục từ bản sao lưu (docs/DEPLOY.md mục 6).`)],
		problem: detail,
	};
}

/** Kiểm tra hỏng rồi chạy thử migration còn thiếu trên một bản sao. */
function checkCopy(path: string, copy: string, sqlite: SqliteToolkit, current: number): CopyCheck
{
	let db: Db;
	try
	{
		db = sqlite.openCopy(copy);
	}
	catch (error)
	{
		return corrupt(path, `không mở được bản sao: ${shortDetail(errorText(error))}`);
	}
	try
	{
		let integrity: string;
		try
		{
			integrity = String(db.pragma("quick_check", { simple: true }));
		}
		catch (error)
		{
			integrity = errorText(error);
		}
		if (integrity !== "ok") return corrupt(path, `quick_check: ${shortDetail(integrity)}`);

		const results = [ok("database", `Database ${path}: không thấy lỗi cấu trúc (quick_check trên bản sao trong thư mục tạm).`)];
		if (current >= sqlite.latestVersion) return { results, problem: null };
		try
		{
			const applied = sqlite.runMigrations(db);
			results.push(ok("database", `Chạy thử ${applied} migration (version ${current} → ${sqlite.schemaVersion(db)}) trên bản sao trong thư mục tạm: thành công.`));
			return { results, problem: null };
		}
		catch (error)
		{
			const detail = shortDetail(errorText(error));
			results.push(fail("database", `Chạy thử migration trên bản sao trong thư mục tạm thất bại: ${detail}. Đừng bật bot; báo người phụ trách.`));
			return { results, problem: `chạy thử migration: ${detail}` };
		}
	}
	finally
	{
		db.close();
	}
}

function unreliable(path: string, detail: string): CheckResult
{
	return warn("database", `Database ${path}: kết quả kiểm tra database không tin cậy khi bot đang ghi (${MAX_ATTEMPTS} lần chép đều lỗi, lần cuối: ${detail}). Dừng bot rồi chạy lại selfcheck để kiểm chắc chắn; chưa cần khôi phục backup.`);
}

/**
 * Chép file thật sang thư mục tạm và kiểm tra bản sao, tối đa MAX_ATTEMPTS lần nếu bản sao báo lỗi. Dấu hiệu bot đang ghi:
 * file -wal có dữ liệu, hoặc kích thước/thời điểm sửa của file thật đổi trong lúc chép hay giữa hai lần chép.
 */
async function inspectCopies(path: string, workspace: string, sqlite: SqliteToolkit, current: number, io: DatabaseReadOptions): Promise<CheckResult[]>
{
	let busy = false;
	let last: FileState | null = null;
	let results: CheckResult[] = [];
	let problem = "";
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1)
	{
		if (attempt > 1) await io.sleep(RETRY_DELAY_MS);
		const copy = join(workspace, `ban-sao-${attempt}.db`);
		const before = fileState(path);
		if (last !== null && !sameState(last, before)) busy = true;
		try
		{
			io.copyFile(path, copy);
			chmodSync(copy, 0o600);
			useRollbackJournal(copy);
		}
		catch (error)
		{
			return [warn("database", `Không chép được database sang thư mục tạm ${workspace} (${errorText(error)}): bỏ qua quick_check và chạy thử migration.${fsHint(error)}`)];
		}
		last = fileState(path);
		if (!sameState(before, last) || walHasData(path)) busy = true;

		let outcome: CopyCheck;
		try
		{
			outcome = checkCopy(path, copy, sqlite, current);
		}
		finally
		{
			removeCopy(copy);
		}
		if (outcome.problem === null) return outcome.results;
		results = outcome.results;
		problem = outcome.problem;
	}
	return busy ? [unreliable(path, problem)] : results;
}

/** Tạo thư mục tạm riêng cho bản sao và luôn xoá toàn bộ thư mục đó (kể cả -journal/-wal/-shm của bản sao) khi xong. */
async function inspectCopy(path: string, size: number, sqlite: SqliteToolkit, current: number, io: DatabaseReadOptions): Promise<CheckResult[]>
{
	const needed = Math.ceil(size * TEMP_SPACE_FACTOR) + TEMP_MARGIN_BYTES;
	const free = io.freeBytes(io.tempRoot);
	if (free !== null && free < needed)
	{
		return [warn("database", `Ổ chứa thư mục tạm ${io.tempRoot} còn ${Math.floor(free / MEGABYTE)} MB, không đủ chỗ cho bản sao database (cần khoảng ${Math.ceil(needed / MEGABYTE)} MB): bỏ qua quick_check và chạy thử migration, chỉ kiểm tra header. Giải phóng chỗ trống rồi chạy lại.`)];
	}

	let workspace: string;
	try
	{
		workspace = mkdtempSync(join(io.tempRoot, WORKSPACE_PREFIX));
	}
	catch (error)
	{
		return [warn("database", `Không tạo được thư mục tạm trong ${io.tempRoot} (${errorText(error)}): bỏ qua quick_check và chạy thử migration, chỉ kiểm tra header.${fsHint(error)}`)];
	}

	let results: CheckResult[] = [];
	try
	{
		results = await inspectCopies(path, workspace, sqlite, current, io);
	}
	finally
	{
		try
		{
			rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
		}
		catch (error)
		{
			results.push(warn("database", `Không xoá được thư mục tạm ${workspace} (${errorText(error)}): xoá bằng tay.`));
		}
	}
	return results;
}

async function inspectDatabaseFile(path: string, sqlite: SqliteToolkit, io: DatabaseReadOptions): Promise<CheckResult[]>
{
	const stat = statSync(path, { throwIfNoEntry: false });
	if (!stat) return [warn("database", `Database chưa có (${path}): sẽ được tạo khi bot chạy lần đầu.`)];
	if (!stat.isFile()) return [fail("database", `${path} không phải file.`)];

	const results = writeProblems(path);
	if (walHasData(path))
	{
		results.push(warn("database", `Có file ${path}-wal chưa gộp vào database: bot đang chạy hoặc lần trước dừng đột ngột. Kết quả dưới đây đọc từ file chính, có thể thiếu thay đổi mới nhất.`));
	}
	if (stat.size === 0) return [...results, warn("database", `Database ${path} đang rỗng (0 byte): bot sẽ tạo schema khi khởi động.`)];

	const header = readHeader(path);
	if (!isSqliteHeader(header)) return [...results, fail("database", `${path} không phải file SQLite.`)];

	const current = header.readInt32BE(USER_VERSION_OFFSET);
	results.push(compareVersion(path, current, sqlite.latestVersion));
	if (current > sqlite.latestVersion) return results;
	return [...results, ...await inspectCopy(path, stat.size, sqlite, current, io)];
}

/**
 * Database đã có: đọc schema version từ header, so với migration mới nhất của code, kiểm tra hỏng và chạy thử migration
 * còn thiếu trên bản sao trong thư mục tạm. Database chưa có: cảnh báo sẽ được tạo khi bot chạy.
 */
export async function checkDatabaseFile(path: string, sqlite: SqliteToolkit, options: Partial<DatabaseReadOptions> = {}): Promise<CheckResult[]>
{
	try
	{
		return await inspectDatabaseFile(path, sqlite, { ...defaultReadOptions(), ...options });
	}
	catch (error)
	{
		return [fail("database", `Không kiểm tra được database ${path}: ${errorText(error)}.${fsHint(error)}`)];
	}
}
