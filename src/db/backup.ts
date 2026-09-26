import { mkdirSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { Db } from "./connection";
import { Clock } from "../shared/clock";
import { logger } from "../shared/logger";

const DAY_MS = 24 * 60 * 60 * 1000;

/** "auto": bản hàng ngày theo lịch; "manual": bản do admin tạo bằng lệnh. Hai loại xoay vòng riêng. */
export type BackupKind = "auto" | "manual";

const PREFIX: Record<BackupKind, string> = { auto: "bot-", manual: "bot-manual-" };
const TIME_PART = "(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z)";
const FILE_PATTERN: Record<BackupKind, RegExp> = {
	auto: new RegExp(`^bot-${TIME_PART}\\.db$`),
	manual: new RegExp(`^bot-manual-${TIME_PART}\\.db$`),
};

function fileNameFor(kind: BackupKind, time: number): string
{
	return `${PREFIX[kind]}${new Date(time).toISOString().replace(/[:.]/g, "-")}.db`;
}

function timeOf(kind: BackupKind, fileName: string): number | null
{
	const match = FILE_PATTERN[kind].exec(fileName);
	if (!match) return null;
	const iso = match[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");
	const time = Date.parse(iso);
	return Number.isNaN(time) ? null : time;
}

/**
 * Sao lưu database hàng ngày (DEC-017) bằng online backup của better-sqlite3 (an toàn khi đang chạy với WAL).
 * Mỗi loại (auto/manual) giữ `keep` bản mới nhất, nên admin tạo nhiều bản thủ công không đẩy mất bản hàng ngày.
 * Việc chép bản sao ra ngoài server do vận hành đảm nhận.
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

	/** Danh sách file backup của một loại, cũ nhất trước (theo thời điểm ghi trong tên file). */
	list(kind: BackupKind = "auto"): string[]
	{
		mkdirSync(this.directory, { recursive: true });
		return readdirSync(this.directory)
			.map(name => ({ name, time: timeOf(kind, name) }))
			.filter((entry): entry is { name: string; time: number } => entry.time !== null)
			.sort((a, b) => a.time - b.time || a.name.localeCompare(b.name))
			.map(entry => entry.name);
	}

	latestBackupAt(kind: BackupKind = "auto"): number | null
	{
		const files = this.list(kind);
		return files.length === 0 ? null : timeOf(kind, files[files.length - 1]);
	}

	/** Tới hạn khi chưa có bản nào, bản gần nhất cũ hơn 24 giờ, hoặc mang thời điểm tương lai (đồng hồ từng bị lệch). */
	isDue(): boolean
	{
		const latest = this.latestBackupAt("auto");
		const now = this.clock.now();
		return latest === null || now - latest >= DAY_MS || latest > now;
	}

	async createBackup(kind: BackupKind = "auto"): Promise<string>
	{
		mkdirSync(this.directory, { recursive: true });
		const path = join(this.directory, fileNameFor(kind, this.clock.now()));
		await this.db.backup(path);
		this.prune(kind);
		return path;
	}

	async runIfDue(): Promise<string | null>
	{
		return this.isDue() ? this.createBackup("auto") : null;
	}

	/** Xoá bản cũ của một loại, chỉ giữ `keep` bản mới nhất. Trả về tên các file đã xoá. */
	prune(kind: BackupKind = "auto"): string[]
	{
		const files = this.list(kind);
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
