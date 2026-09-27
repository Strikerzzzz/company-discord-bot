import { accessSync, closeSync, constants, openSync, readFileSync, readSync, statSync } from "fs";
import type { Db } from "../db/connection";
import { CheckResult, errorText, fail, fsHint, ok, warn } from "./checks";

/*
 * Kiểm tra better-sqlite3 và database cho selfcheck. File database thật KHÔNG được mở bằng SQLite: kể cả mở read-only,
 * SQLite vẫn tạo file -wal và -shm cạnh một database ở chế độ WAL và để lại sau khi đóng (đã kiểm chứng với better-sqlite3 13).
 * Vì vậy selfcheck đọc header bằng fs, rồi mở một bản sao trong bộ nhớ để kiểm tra hỏng và chạy thử migration.
 * Module này chỉ import kiểu của better-sqlite3; thư viện được nạp trong loadSqliteToolkit để lỗi binary native thành dòng ❌.
 */

/** Bộ công cụ SQLite của selfcheck; mặc định là better-sqlite3 và migration thật của bot (loadSqliteToolkit). */
export interface SqliteToolkit
{
	/** Database trống trong bộ nhớ, cùng pragma với bot. */
	openMemory(): Db;
	/** Bản sao trong bộ nhớ dựng từ bytes của file database; file thật không bị đụng tới. */
	openImage(image: Buffer): Db;
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
		openImage: image =>
		{
			const db = new Database(image);
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

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "latin1");
const HEADER_BYTES = 100;
const USER_VERSION_OFFSET = 60;
const WRITE_VERSION_OFFSET = 18;
const READ_VERSION_OFFSET = 19;
const WAL_FORMAT = 2;
const ROLLBACK_FORMAT = 1;
/** File lớn hơn mức này chỉ đọc header: đọc cả file vào bộ nhớ (thêm một bản của SQLite) có thể vượt MemoryMax của service. */
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

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

function compareVersion(path: string, current: number, latest: number): CheckResult
{
	if (current > latest)
	{
		return fail("database", `Database ${path} ở schema version ${current}, mới hơn code (tối đa ${latest}): code cũ hơn database, bot sẽ từ chối khởi động. Cập nhật code lên bản mới hơn.`);
	}
	if (current === latest) return ok("database", `Database ${path}: schema version ${current}, khớp code.`);
	return warn("database", `Database ${path}: schema version ${current}, cũ hơn code (${latest}). Bot sẽ tự chạy migration khi khởi động; nên có bản sao lưu mới trước khi bật.`);
}

/** Kiểm tra hỏng và chạy thử migration còn thiếu trên bản sao trong bộ nhớ. */
function inspectCopy(path: string, sqlite: SqliteToolkit, current: number): CheckResult[]
{
	const image = readFileSync(path);
	if (image[WRITE_VERSION_OFFSET] === WAL_FORMAT) image[WRITE_VERSION_OFFSET] = ROLLBACK_FORMAT;
	if (image[READ_VERSION_OFFSET] === WAL_FORMAT) image[READ_VERSION_OFFSET] = ROLLBACK_FORMAT;

	const db = sqlite.openImage(image);
	try
	{
		const integrity = String(db.pragma("quick_check", { simple: true }));
		if (integrity !== "ok")
		{
			return [fail("database", `Database ${path} có dấu hiệu hỏng (quick_check: ${integrity}). Khôi phục từ bản sao lưu (docs/DEPLOY.md mục 6).`)];
		}
		const results = [ok("database", `Database ${path}: không thấy lỗi cấu trúc (quick_check trên bản sao trong bộ nhớ).`)];
		if (current < sqlite.latestVersion)
		{
			try
			{
				const applied = sqlite.runMigrations(db);
				results.push(ok("database", `Chạy thử ${applied} migration (version ${current} → ${sqlite.schemaVersion(db)}) trên bản sao trong bộ nhớ: thành công.`));
			}
			catch (error)
			{
				results.push(fail("database", `Chạy thử migration trên bản sao trong bộ nhớ thất bại: ${errorText(error)}. Đừng bật bot; báo người phụ trách.`));
			}
		}
		return results;
	}
	finally
	{
		db.close();
	}
}

function inspectDatabaseFile(path: string, sqlite: SqliteToolkit): CheckResult[]
{
	const stat = statSync(path, { throwIfNoEntry: false });
	if (!stat) return [warn("database", `Database chưa có (${path}): sẽ được tạo khi bot chạy lần đầu.`)];
	if (!stat.isFile()) return [fail("database", `${path} không phải file.`)];

	const results = writeProblems(path);
	const wal = statSync(`${path}-wal`, { throwIfNoEntry: false });
	if (wal && wal.size > 0)
	{
		results.push(warn("database", `Có file ${path}-wal chưa gộp vào database: bot đang chạy hoặc lần trước dừng đột ngột. Kết quả dưới đây đọc từ file chính, có thể thiếu thay đổi mới nhất.`));
	}
	if (stat.size === 0) return [...results, warn("database", `Database ${path} đang rỗng (0 byte): bot sẽ tạo schema khi khởi động.`)];

	const header = readHeader(path);
	if (!isSqliteHeader(header)) return [...results, fail("database", `${path} không phải file SQLite.`)];

	const current = header.readInt32BE(USER_VERSION_OFFSET);
	results.push(compareVersion(path, current, sqlite.latestVersion));
	if (current > sqlite.latestVersion) return results;
	if (stat.size > MAX_IMAGE_BYTES)
	{
		const megabytes = Math.round(stat.size / 1024 / 1024);
		return [...results, warn("database", `Database lớn (${megabytes} MB): bỏ qua quick_check và chạy thử migration trên bản sao để không vượt trần bộ nhớ.`)];
	}
	return [...results, ...inspectCopy(path, sqlite, current)];
}

/**
 * Database đã có: đọc schema version từ header, so với migration mới nhất của code, kiểm tra hỏng và chạy thử migration
 * còn thiếu trên bản sao trong bộ nhớ. Database chưa có: cảnh báo sẽ được tạo khi bot chạy.
 */
export function checkDatabaseFile(path: string, sqlite: SqliteToolkit): CheckResult[]
{
	try
	{
		return inspectDatabaseFile(path, sqlite);
	}
	catch (error)
	{
		return [fail("database", `Không kiểm tra được database ${path}: ${errorText(error)}.${fsHint(error)}`)];
	}
}
