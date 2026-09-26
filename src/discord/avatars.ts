import { logger } from "../shared/logger";

/*
 * Tải avatar từ CDN của Discord để vẽ lên ảnh thẻ (DEC-030). Đây là network call duy nhất ngoài Discord API được phép:
 * chỉ HTTPS tới cdn.discordapp.com và media.discordapp.net, không theo redirect, có timeout, giới hạn dung lượng và cache trong bộ nhớ.
 * `get()` không bao giờ throw: mọi lỗi (URL sai, mạng lỗi, quá hạn, quá lớn, không phải ảnh) đều trả về null để ảnh vẽ chữ cái đầu.
 */

export const AVATAR_HOSTS: readonly string[] = ["cdn.discordapp.com", "media.discordapp.net"];

const MAX_URL_LENGTH = 2048;

export interface AvatarFetcherOptions
{
	/** Hàm fetch (mặc định: fetch toàn cục); test truyền fetch giả. */
	fetchImpl?: typeof fetch;
	/** Thời gian tối đa cho cả request lẫn đọc body (mặc định 3000 ms). */
	timeoutMs?: number;
	/** Dung lượng tối đa của một ảnh (mặc định 2.000.000 byte). */
	maxBytes?: number;
	/** Số URL tối đa trong cache LRU (mặc định 500). */
	maxEntries?: number;
	/** Thời gian giữ ảnh tải thành công (mặc định 6 giờ). */
	ttlMs?: number;
	/** Thời gian giữ kết quả lỗi, để không gọi lại liên tục (mặc định 5 phút). */
	failureTtlMs?: number;
	now?: () => number;
}

interface CacheEntry
{
	value: Buffer | null;
	expiresAt: number;
}

/** URL avatar hợp lệ (https, đúng host CDN của Discord, không có user/password, không có port riêng); ngược lại null. */
export function parseAvatarUrl(url: string | null | undefined): URL | null
{
	if (typeof url !== "string" || url.length === 0 || url.length > MAX_URL_LENGTH) return null;
	let parsed: URL;
	try
	{
		parsed = new URL(url);
	}
	catch
	{
		return null;
	}
	if (parsed.protocol !== "https:") return null;
	if (!AVATAR_HOSTS.includes(parsed.hostname)) return null;
	if (parsed.username !== "" || parsed.password !== "") return null;
	if (parsed.port !== "") return null;
	parsed.hash = "";
	return parsed;
}

function isImageContentType(value: string | null): boolean
{
	if (value === null) return false;
	const type = value.split(";")[0].trim().toLowerCase();
	return type.startsWith("image/") && !type.includes("svg");
}

export class AvatarFetcher
{
	private readonly fetchImpl: typeof fetch;
	private readonly timeoutMs: number;
	private readonly maxBytes: number;
	private readonly maxEntries: number;
	private readonly ttlMs: number;
	private readonly failureTtlMs: number;
	private readonly now: () => number;
	private readonly cache = new Map<string, CacheEntry>();
	private readonly pending = new Map<string, Promise<Buffer | null>>();

	constructor(options: AvatarFetcherOptions = {})
	{
		this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
		this.timeoutMs = options.timeoutMs ?? 3000;
		this.maxBytes = options.maxBytes ?? 2_000_000;
		this.maxEntries = Math.max(1, options.maxEntries ?? 500);
		this.ttlMs = options.ttlMs ?? 6 * 60 * 60 * 1000;
		this.failureTtlMs = options.failureTtlMs ?? 5 * 60 * 1000;
		this.now = options.now ?? Date.now;
	}

	/** Số URL đang nằm trong cache (kể cả kết quả lỗi). */
	get size(): number
	{
		return this.cache.size;
	}

	/** Bytes ảnh avatar, hoặc null nếu URL không hợp lệ hay tải không được. Không bao giờ throw. */
	async get(url: string | null): Promise<Buffer | null>
	{
		try
		{
			const parsed = parseAvatarUrl(url);
			if (!parsed) return null;
			const key = parsed.href;

			const cached = this.cache.get(key);
			if (cached)
			{
				this.cache.delete(key);
				if (cached.expiresAt > this.now())
				{
					this.cache.set(key, cached);
					return cached.value;
				}
			}

			const inFlight = this.pending.get(key);
			if (inFlight) return await inFlight;

			const request = this.download(parsed)
				.then(value =>
				{
					this.remember(key, value);
					return value;
				})
				.finally(() => this.pending.delete(key));
			this.pending.set(key, request);
			return await request;
		}
		catch (error)
		{
			logger.debug("Lỗi không mong đợi khi tải avatar.", error);
			return null;
		}
	}

	private remember(key: string, value: Buffer | null): void
	{
		this.cache.delete(key);
		this.cache.set(key, { value, expiresAt: this.now() + (value ? this.ttlMs : this.failureTtlMs) });
		while (this.cache.size > this.maxEntries)
		{
			const oldest = this.cache.keys().next();
			if (oldest.done) break;
			this.cache.delete(oldest.value);
		}
	}

	private async download(url: URL): Promise<Buffer | null>
	{
		const where = `${url.hostname}${url.pathname}`;
		try
		{
			const response = await this.fetchImpl(url.href, {
				signal: AbortSignal.timeout(this.timeoutMs),
				redirect: "error",
				headers: { accept: "image/png, image/webp, image/jpeg, image/gif" },
			});
			if (!response.ok)
			{
				logger.debug(`Tải avatar ${where} thất bại: HTTP ${response.status}.`);
				await this.discard(response);
				return null;
			}
			if (!isImageContentType(response.headers.get("content-type")))
			{
				logger.debug(`Avatar ${where} không phải ảnh (content-type không hợp lệ).`);
				await this.discard(response);
				return null;
			}
			const declared = Number(response.headers.get("content-length"));
			if (Number.isFinite(declared) && declared > this.maxBytes)
			{
				logger.debug(`Avatar ${where} quá lớn (${declared} byte).`);
				await this.discard(response);
				return null;
			}
			return await this.readBody(response, where);
		}
		catch (error)
		{
			logger.debug(`Tải avatar ${where} thất bại: ${error instanceof Error ? error.name : "lỗi không xác định"}.`);
			return null;
		}
	}

	private async readBody(response: Response, where: string): Promise<Buffer | null>
	{
		if (!response.body) return null;
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let total = 0;
		for (;;)
		{
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > this.maxBytes)
			{
				logger.debug(`Avatar ${where} vượt quá ${this.maxBytes} byte khi đọc.`);
				await reader.cancel().catch(() => undefined);
				return null;
			}
			chunks.push(value);
		}
		return total > 0 ? Buffer.concat(chunks, total) : null;
	}

	private async discard(response: Response): Promise<void>
	{
		try
		{
			await response.body?.cancel();
		}
		catch
		{
			return;
		}
	}
}
