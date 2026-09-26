// Tiện ích hiển thị dùng chung cho tầng Discord. Mọi chuỗi hiển thị là tiếng Việt (DEC-020).

/** Giới hạn độ dài của Discord (đếm theo UTF-16). */
export const DISCORD_LIMITS = {
	embedTitle: 256,
	embedDescription: 4096,
	embedFieldValue: 1024,
	buttonLabel: 80,
} as const;

export const COLORS = {
	primary: 0x5865f2,
	success: 0x57f287,
	warning: 0xfee75c,
	danger: 0xed4245,
	neutral: 0x99aab5,
	gold: 0xf1c40f,
} as const;

export function formatNumber(value: number): string
{
	return value.toLocaleString("vi-VN");
}

/** Thanh tiến độ dạng ▰▰▰▱▱. */
export function progressBar(current: number, max: number, width = 12): string
{
	const ratio = max > 0 ? Math.min(1, Math.max(0, current / max)) : 0;
	const filled = Math.round(ratio * width);
	return "▰".repeat(filled) + "▱".repeat(width - filled);
}

const ELLIPSIS = "…";
const graphemes = new Intl.Segmenter("vi", { granularity: "grapheme" });

/**
 * Cắt chuỗi cho vừa giới hạn của Discord, thêm "…" nếu bị cắt.
 * Discord đếm giới hạn theo UTF-16 (`.length`), nên kết quả luôn có `.length <= max`.
 * Chỉ cắt ở ranh giới ký tự hiển thị (grapheme): không cắt đôi surrogate pair, emoji ghép hay dấu tổ hợp.
 */
export function truncate(text: string, max: number): string
{
	if (text.length <= max) return text;
	if (max < ELLIPSIS.length) return "";

	const budget = max - ELLIPSIS.length;
	let end = 0;
	for (const { segment } of graphemes.segment(text))
	{
		if (end + segment.length > budget) break;
		end += segment.length;
	}
	return text.slice(0, end) + ELLIPSIS;
}

export interface FitLinesOptions
{
	separator?: string;
	/** Tổng số mục, khi danh sách truyền vào đã bị cắt bớt từ trước (mặc định: số dòng). */
	total?: number;
}

/**
 * Nối các dòng trong giới hạn độ dài (UTF-16). Các mục không hiển thị được, gồm cả phần vượt `total`,
 * được gộp thành một dòng cuối do `overflow` tạo.
 */
export function fitLines(lines: readonly string[], max: number, overflow: (hidden: number) => string, options: FitLinesOptions = {}): string
{
	const separator = options.separator ?? "\n";
	const total = Math.max(options.total ?? lines.length, lines.length);
	for (let kept = lines.length; kept >= 0; kept--)
	{
		const hidden = total - kept;
		const parts = hidden > 0 ? [...lines.slice(0, kept), overflow(hidden)] : lines.slice(0, kept);
		const text = parts.join(separator);
		if (text.length <= max) return text;
	}
	return truncate(overflow(total), max);
}

// [chữ](url), kể cả dạng [chữ](<url>) hay [chữ](url "tiêu đề").
const MASKED_LINK = /\[([^[\]\n]*)\]\(([^()\n]*)\)/g;

/**
 * Vô hiệu hoá masked link `[chữ](url)` trong văn bản do người dùng nhập, để không giả mạo được link
 * (chữ hiển thị một địa chỉ nhưng link trỏ tới địa chỉ khác). Link hợp lệ thành `chữ (url)`;
 * mọi chuỗi `](` còn sót lại (link lồng nhau, url có ngoặc) bị tách ra để Discord không dựng thành link.
 */
export function disableMaskedLinks(text: string): string
{
	return text.replace(MASKED_LINK, "$1 ($2)").replaceAll("](", "] (");
}

export function userMention(userId: string): string
{
	return `<@${userId}>`;
}

export function roleMention(roleId: string): string
{
	return `<@&${roleId}>`;
}

export function channelMention(channelId: string): string
{
	return `<#${channelId}>`;
}

/** Thời gian tương đối, hiển thị theo múi giờ của người xem (ví dụ "2 giờ trước"). */
export function relativeTime(ms: number): string
{
	return `<t:${Math.floor(ms / 1000)}:R>`;
}

/** Ngày giờ đầy đủ, hiển thị theo múi giờ của người xem. */
export function dateTime(ms: number): string
{
	return `<t:${Math.floor(ms / 1000)}:f>`;
}

/** Huy chương cho top 3, còn lại là "#n". */
export function rankLabel(rank: number): string
{
	if (rank === 1) return "🥇";
	if (rank === 2) return "🥈";
	if (rank === 3) return "🥉";
	return `#${rank}`;
}
