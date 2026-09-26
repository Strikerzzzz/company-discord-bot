import DatabaseConstructor, { Database } from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";

export type Db = Database;

/**
 * Mở kết nối SQLite duy nhất của bot (PROP-007). Truyền ":memory:" để dùng DB tạm trong test.
 */
export function openDatabase(path: string): Db
{
	const inMemory = path === ":memory:";
	if (!inMemory) mkdirSync(dirname(path), { recursive: true });

	const db = new DatabaseConstructor(path);
	// WAL: đọc và ghi không chặn nhau; backup phải dùng db.backup(), không copy file thô khi bot đang chạy.
	if (!inMemory) db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");
	db.pragma("busy_timeout = 5000");
	db.pragma("synchronous = NORMAL");
	return db;
}
