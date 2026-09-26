// Mốc thời gian theo giờ Việt Nam (UTC+7, không có giờ mùa hè), dùng cho mọi quy tắc "theo ngày/tuần/tháng" (DEC-029).
// Timestamp trong database luôn là mili giây UTC; chỉ ranh giới ngày được tính theo giờ Việt Nam.

export const MS_PER_DAY = 86_400_000;
export const VN_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Số thứ tự ngày theo giờ Việt Nam: ngày 0 là 01/01/1970 (giờ Việt Nam). Cùng công thức với SQL `(created_at + 25200000) / 86400000`. */
export function vnDayNumber(ms: number): number
{
	return Math.floor((ms + VN_UTC_OFFSET_MS) / MS_PER_DAY);
}

/** Thời điểm 00:00 giờ Việt Nam của một ngày theo số thứ tự ngày. */
export function vnDayStart(day: number): number
{
	return day * MS_PER_DAY - VN_UTC_OFFSET_MS;
}

/** 00:00 giờ Việt Nam của ngày chứa `ms`. */
export function startOfVnDay(ms: number): number
{
	return vnDayStart(vnDayNumber(ms));
}

/** 00:00 thứ Hai giờ Việt Nam của tuần chứa `ms` (tuần bắt đầu từ thứ Hai). */
export function startOfVnWeek(ms: number): number
{
	const day = vnDayNumber(ms);
	// Ngày 0 (01/01/1970) là thứ Năm, tức ngày thứ 3 tính từ thứ Hai (thứ Hai = 0).
	const daysSinceMonday = (day + 3) % 7;
	return vnDayStart(day - daysSinceMonday);
}

/** 00:00 ngày 1 giờ Việt Nam của tháng chứa `ms`. */
export function startOfVnMonth(ms: number): number
{
	const local = new Date(ms + VN_UTC_OFFSET_MS);
	return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - VN_UTC_OFFSET_MS;
}

/** Ngày/tháng theo giờ Việt Nam, dạng "29/09". */
export function formatVnDayMonth(ms: number): string
{
	const local = new Date(ms + VN_UTC_OFFSET_MS);
	const day = String(local.getUTCDate()).padStart(2, "0");
	const month = String(local.getUTCMonth() + 1).padStart(2, "0");
	return `${day}/${month}`;
}
