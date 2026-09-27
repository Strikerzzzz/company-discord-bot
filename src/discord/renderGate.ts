import { UserError } from "../shared/errors";

/*
 * Giới hạn việc vẽ ảnh thẻ (DEC-030), vì vẽ ảnh tốn CPU và bộ nhớ hơn hẳn các lệnh khác:
 * - cooldown theo người cho /rank, /leaderboard và nút bảng xếp hạng (dùng chung một mốc cho cả ba);
 * - semaphore toàn process: tối đa `maxConcurrent` lần vẽ chạy cùng lúc, lần vẽ sau phải chờ tới lượt
 *   (Bảng vàng cũng đi qua đây).
 * Trạng thái chỉ nằm trong RAM. Map cooldown tự dọn các mục đã hết hạn nên không phình theo số người từng dùng.
 */

export const DEFAULT_RENDER_COOLDOWN_MS = 3000;
export const DEFAULT_MAX_CONCURRENT_RENDERS = 2;

export interface RenderGateOptions
{
	/** Khoảng cách tối thiểu giữa hai lần vẽ của cùng một người (mặc định 3000 ms). */
	cooldownMs?: number;
	/** Số lần vẽ chạy đồng thời tối đa trong process (mặc định 2). */
	maxConcurrent?: number;
	now?: () => number;
}

/** "Bạn thao tác nhanh quá, thử lại sau N giây nhé." với N làm tròn lên, tối thiểu 1. */
export function cooldownMessage(remainingMs: number): string
{
	const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
	return `Bạn thao tác nhanh quá, thử lại sau ${seconds} giây nhé.`;
}

export class RenderGate
{
	private readonly cooldownMs: number;
	private readonly maxConcurrent: number;
	private readonly now: () => number;
	/** Lần vẽ được phép gần nhất của từng người; thứ tự chèn cũng là thứ tự thời gian, nên dọn từ đầu Map. */
	private readonly lastUse = new Map<string, number>();
	private running = 0;
	private readonly waiting: (() => void)[] = [];

	constructor(options: RenderGateOptions = {})
	{
		this.cooldownMs = Math.max(0, options.cooldownMs ?? DEFAULT_RENDER_COOLDOWN_MS);
		this.maxConcurrent = Math.max(1, Math.floor(options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_RENDERS));
		this.now = options.now ?? Date.now;
	}

	/** Số người đang bị giữ trong Map cooldown (chưa được dọn). */
	get trackedUsers(): number
	{
		return this.lastUse.size;
	}

	/** Số lần vẽ đang chạy. */
	get activeRenders(): number
	{
		return this.running;
	}

	/** Số lần vẽ đang chờ tới lượt. */
	get queuedRenders(): number
	{
		return this.waiting.length;
	}

	/**
	 * Ghi nhận một lần vẽ của `userId` nếu đã hết cooldown và trả về 0; nếu chưa hết thì không ghi nhận gì và trả về
	 * số ms còn phải chờ. Lần bị từ chối không kéo dài cooldown.
	 */
	tryUse(userId: string): number
	{
		const now = this.now();
		this.prune(now);
		const last = this.lastUse.get(userId);
		if (last !== undefined && this.isActive(last, now)) return last + this.cooldownMs - now;
		this.lastUse.delete(userId);
		this.lastUse.set(userId, now);
		return 0;
	}

	/** Như tryUse nhưng ném UserError (thông báo tiếng Việt) khi còn cooldown. Gọi trước khi defer để trả lời riêng ngay. */
	assertCooldown(userId: string): void
	{
		const remaining = this.tryUse(userId);
		if (remaining > 0) throw new UserError(cooldownMessage(remaining));
	}

	/** Chạy `task` khi có chỗ trong semaphore; lỗi của task được ném lại nguyên vẹn và luôn trả chỗ. */
	async run<T>(task: () => Promise<T>): Promise<T>
	{
		await this.acquire();
		try
		{
			return await task();
		}
		finally
		{
			this.release();
		}
	}

	private acquire(): Promise<void>
	{
		if (this.running < this.maxConcurrent)
		{
			this.running++;
			return Promise.resolve();
		}
		return new Promise<void>(resolve => this.waiting.push(resolve));
	}

	/** Trả chỗ: nếu có lần vẽ đang chờ thì chuyển thẳng chỗ cho nó (số đang chạy giữ nguyên). */
	private release(): void
	{
		const next = this.waiting.shift();
		if (next) next();
		else this.running--;
	}

	/**
	 * Mốc `last` còn trong cooldown tại `now`. Mốc nằm ở tương lai (đồng hồ hệ thống bị chỉnh lùi) coi như hết hạn,
	 * để không khoá người dùng lâu hơn một cooldown.
	 */
	private isActive(last: number, now: number): boolean
	{
		return last <= now && now < last + this.cooldownMs;
	}

	/** Bỏ các mục đã hết cooldown ở đầu Map (mục cũ nhất); dừng ở mục đầu tiên còn hạn. */
	private prune(now: number): void
	{
		for (const [userId, last] of this.lastUse)
		{
			if (this.isActive(last, now)) break;
			this.lastUse.delete(userId);
		}
	}
}
