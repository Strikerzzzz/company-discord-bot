// Tiện ích hiển thị dùng chung cho tầng Discord. Mọi chuỗi hiển thị là tiếng Việt (DEC-020).

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

/** Cắt chuỗi cho vừa giới hạn của Discord, thêm "…" nếu bị cắt. */
export function truncate(text: string, max: number): string
{
	const chars = Array.from(text);
	return chars.length <= max ? text : `${chars.slice(0, Math.max(0, max - 1)).join("")}…`;
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
