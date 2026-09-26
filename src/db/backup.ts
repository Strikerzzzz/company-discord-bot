import { mkdirSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { Db } from "./connection";
import { Clock } from "../shared/clock";
import { logger } from "../shared/logger";

const DAY_MS = 24 * 60 * 60 * 1000;
const FILE_PATTERN = /^bot-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.db$/;

function fileNameFor(time: number): string
{
	return `bot-${new Date(time).toISOString().replace(/[:.]/g, "-")}.db`;
}

function timeOf(fileName: string): number | null
{
	const match = FILE_PATTERN.exec(fileName);
	if (!match) return null;
	const iso = match[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");
	const time = Date.parse(iso);
	return Number.isNaN(time) ? null : time;
}

/**
 * Sao lưu database hàng ngày (DEC-017) bằng online backup của better-sqlite3 (an toàn khi đang chạy với WAL).
 * Giữ `keep` bản mới nhất trong `directory`. Việc chép bản sao ra ngoài server do vận hành đảm nhận.
 */
export class BackupService
{
	constructor(
		private readonly db: Db,
		readonly directory: string,
		private readonly keep: number,
		private readonly clock: Clock,
	)
	{}

	/** Danh sách file backup, cũ nhất trước. */
	list(): string[]
	{
		mkdirSync(this.directory, { recursive: true });
		return readdirSync(this.directory).filter(name => timeOf(name) !== null).sort();
	}

	latestBackupAt(): number | null
	{
		const files = this.list();
		return files.length === 0 ? null : timeOf(files[files.length - 1]);
	}

	isDue(): boolean
	{
		const latest = this.latestBackupAt();
		return latest === null || this.clock.now() - latest >= DAY_MS;
	}

	async createBackup(): Promise<string>
	{
		mkdirSync(this.directory, { recursive: true });
		const path = join(this.directory, fileNameFor(this.clock.now()));
		await this.db.backup(path);
		this.prune();
		return path;
	}

	async runIfDue(): Promise<string | null>
	{
		return this.isDue() ? this.createBackup() : null;
	}

	/** Xoá bản cũ, chỉ giữ `keep` bản mới nhất. Trả về tên các file đã xoá. */
	prune(): string[]
	{
		const files = this.list();
		const removed = files.slice(0, Math.max(0, files.length - this.keep));
		for (const name of removed) rmSync(join(this.directory, name), { force: true });
		return removed;
	}
}

/** Kiểm tra mỗi giờ, backup khi bản gần nhất đã cũ hơn 24 giờ. Trả về hàm dừng lịch. */
export function startBackupSchedule(backup: BackupService, intervalMs = 60 * 60 * 1000): () => void
{
	const run = (): void =>
	{
		backup.runIfDue()
			.then(path =>
			{
				if (path) logger.info(`Đã sao lưu database: ${path}`);
			})
			.catch((error: unknown) => logger.error("Sao lưu database thất bại:", error));
	};

	run();
	const timer = setInterval(run, intervalMs);
	timer.unref();
	return () => clearInterval(timer);
}
