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
	// Chữ bị xoá (nội dung retro, DEC-049) được ghi đè bằng 0 trong file thay vì nằm lại ở trang trống; xoá nội dung phiên còn
	// checkpoint WAL (RetroService.deleteContent). Backup cũ vẫn giữ bản trước khi xoá.
	db.pragma("secure_delete = ON");
	return db;
}

/** Ghi hết WAL vào file chính rồi cắt WAL về 0 byte, để bản cũ của trang vừa xoá không còn nằm trong file -wal. */
export function truncateWal(db: Db): void
{
	db.pragma("wal_checkpoint(TRUNCATE)");
}
