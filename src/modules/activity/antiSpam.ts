import { createHash } from "node:crypto";

/*
 * Chống spam theo nội dung tin nhắn (DEC-023). Mọi thứ ở đây chỉ nằm trong bộ nhớ của process:
 * không bao giờ ghi nội dung hay hash của nội dung vào database. Tracker chỉ giữ hash, không giữ nguyên văn.
 */

// Mention người dùng, role, channel: <@123>, <@!123>, <@&123>, <#123>.
const MENTION_PATTERN = /<(?:@[!&]?|#)\d+>/g;
// Custom emoji tĩnh và động: <:ten:123>, <a:ten:123>.
const CUSTOM_EMOJI_PATTERN = /<a?:\w+:\d+>/g;
// Ký tự định dạng vô hình (zero-width space, ZWJ, soft hyphen, ...), hay bị chèn vào để né chống trùng.
const INVISIBLE_PATTERN = /\p{Cf}/gu;
const WHITESPACE_PATTERN = /\s+/gu;
// Một ký tự (code point) lặp liên tiếp từ 4 lần trở lên.
const REPEATED_CHAR_PATTERN = /(.)\1{3,}/gsu;

export const DEFAULT_MAX_ENTRIES_PER_KEY = 100;
export const DEFAULT_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Chuẩn hoá nội dung trước khi so trùng và đo độ dài:
 * bỏ mention và custom emoji, bỏ ký tự vô hình, Unicode NFC (tiếng Việt gõ tổ hợp và dựng sẵn thành một),
 * chữ thường, gộp khoảng trắng, trim, và rút chuỗi ký tự lặp dài còn 3 ký tự ("haaaaaa" → "haaa").
 */
export function normalizeContent(content: string): string
{
	return content
		.replace(MENTION_PATTERN, " ")
		.replace(CUSTOM_EMOJI_PATTERN, " ")
		.replace(INVISIBLE_PATTERN, "")
		.normalize("NFC")
		.toLowerCase()
		.replace(WHITESPACE_PATTERN, " ")
		.trim()
		.replace(REPEATED_CHAR_PATTERN, "$1$1$1");
}

/** Độ dài tính theo code point (emoji hay ký tự ngoài BMP tính là 1). */
export function contentLength(normalized: string): number
{
	return Array.from(normalized).length;
}

function fingerprintOf(normalized: string): string
{
	return createHash("sha256").update(normalized).digest("base64");
}

export interface DuplicateTrackerOptions
{
	/** Số nội dung tối đa nhớ cho mỗi người; vượt quá thì bỏ nội dung gặp lâu nhất. */
	maxEntriesPerKey?: number;
	/** Chu kỳ quét toàn bộ tracker để bỏ nội dung hết hạn của mọi người. */
	sweepIntervalMs?: number;
}

interface History
{
	/** Window áp dụng ở lần xét gần nhất của người này (dùng khi quét toàn bộ). */
	windowMs: number;
	/** Hash nội dung → lần gặp gần nhất. Thứ tự chèn của Map = thứ tự gặp (cũ trước). */
	seen: Map<string, number>;
}

function prune(history: History, now: number): void
{
	for (const [fingerprint, seenAt] of history.seen)
	{
		if (now - seenAt >= history.windowMs) history.seen.delete(fingerprint);
	}
}

/**
 * Nhớ các nội dung gần đây của từng người (theo khoá, ví dụ `guildId:userId`) để phát hiện tin trùng.
 * Tự dọn: mỗi lần xét thì bỏ nội dung hết hạn của chính người đó; định kỳ (theo thời gian của lần xét) quét toàn bộ
 * và bỏ hẳn người không còn nội dung nào. Vì vậy bộ nhớ chỉ tỉ lệ với số người nhắn tin trong một window.
 */
export class DuplicateTracker
{
	private readonly histories = new Map<string, History>();
	private readonly maxEntriesPerKey: number;
	private readonly sweepIntervalMs: number;
	private lastSweepAt: number | null = null;

	constructor(options: DuplicateTrackerOptions = {})
	{
		this.maxEntriesPerKey = Math.max(1, options.maxEntriesPerKey ?? DEFAULT_MAX_ENTRIES_PER_KEY);
		this.sweepIntervalMs = Math.max(0, options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS);
	}

	/** Số người đang được theo dõi. */
	get trackedKeys(): number
	{
		return this.histories.size;
	}

	/** Số nội dung đang nhớ của một người. */
	entryCount(key: string): number
	{
		return this.histories.get(key)?.seen.size ?? 0;
	}

	/**
	 * Ghi nhận một nội dung đã chuẩn hoá và trả về true nếu nó trùng với một tin trước đó của cùng người trong window.
	 * Luôn ghi nhận (kể cả tin trùng), nên lặp lại liên tục sẽ bị chặn cho tới khi ngừng đủ một window.
	 * windowMs <= 0 nghĩa là tắt chống trùng.
	 */
	checkAndRecord(key: string, normalized: string, now: number, windowMs: number): boolean
	{
		this.sweepIfDue(now);
		if (windowMs <= 0)
		{
			this.histories.delete(key);
			return false;
		}

		let history = this.histories.get(key);
		if (!history)
		{
			history = { windowMs, seen: new Map() };
			this.histories.set(key, history);
		}
		history.windowMs = windowMs;
		prune(history, now);

		const fingerprint = fingerprintOf(normalized);
		const duplicate = history.seen.has(fingerprint);
		history.seen.delete(fingerprint);
		history.seen.set(fingerprint, now);
		while (history.seen.size > this.maxEntriesPerKey)
		{
			const oldest = history.seen.keys().next();
			if (oldest.done) break;
			history.seen.delete(oldest.value);
		}
		return duplicate;
	}

	/** Quét toàn bộ: bỏ nội dung hết hạn của mọi người, bỏ hẳn người không còn nội dung nào. */
	sweep(now: number): void
	{
		for (const [key, history] of this.histories)
		{
			prune(history, now);
			if (history.seen.size === 0) this.histories.delete(key);
		}
		this.lastSweepAt = now;
	}

	private sweepIfDue(now: number): void
	{
		const last = this.lastSweepAt;
		// Đồng hồ lùi (chỉnh giờ hệ thống) cũng coi như tới hạn quét.
		if (last !== null && now >= last && now - last < this.sweepIntervalMs) return;
		this.sweep(now);
	}
}

/** Lý do loại một tin theo nội dung. */
export type ContentRejection = "duplicate" | "too_short";

export interface ContentCheckInput
{
	/** Khoá theo người, ví dụ `guildId:userId`. */
	key: string;
	content: string;
	hasAttachments: boolean;
	now: number;
	minMessageLength: number;
	duplicateWindowSeconds: number;
}

/**
 * Bước kiểm tra nội dung của Activity XP: tin chỉ có file đính kèm được bỏ qua bước này (chỉ còn cooldown);
 * tin rỗng không có file đính kèm là tin ngắn; sau đó chống trùng rồi mới xét độ dài tối thiểu.
 */
export class ContentSpamFilter
{
	constructor(private readonly tracker: DuplicateTracker = new DuplicateTracker())
	{}

	/** Trả về lý do loại tin, hoặc null nếu nội dung đạt (tin vẫn còn phải qua cooldown). */
	check(input: ContentCheckInput): ContentRejection | null
	{
		const normalized = normalizeContent(input.content);
		if (normalized === "") return input.hasAttachments ? null : "too_short";
		if (this.tracker.checkAndRecord(input.key, normalized, input.now, input.duplicateWindowSeconds * 1000)) return "duplicate";
		if (input.minMessageLength > 0 && contentLength(normalized) < input.minMessageLength) return "too_short";
		return null;
	}
}
