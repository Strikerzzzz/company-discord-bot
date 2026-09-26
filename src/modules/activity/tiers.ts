/*
 * Cảnh giới (danh hiệu theo level) phong cách tu tiên (DEC-029). Chỉ để hiển thị: không đổi công thức XP hay level (DEC-022).
 * Thứ tự trong TIERS là thứ tự tăng dần của minLevel; tier đầu tiên luôn có minLevel = 0.
 */

export const TIER_KEYS = ["luyen-khi", "truc-co", "kim-dan", "nguyen-anh", "hoa-than", "luyen-hu", "hop-the", "do-kiep"] as const;

export type TierKey = (typeof TIER_KEYS)[number];

export interface Tier
{
	key: TierKey;
	/** Tên cảnh giới hiển thị. */
	name: string;
	/** Emoji dùng trong tin nhắn (không vẽ trên ảnh vì font không có emoji). */
	emoji: string;
	/** Level tối thiểu để đạt cảnh giới này. */
	minLevel: number;
	/** Màu chính dạng "#rrggbb" (viền, chữ nhấn, màu embed). */
	color: string;
	/** Hai màu gradient "#rrggbb" cho ảnh thẻ, từ trái sang phải. */
	gradient: readonly [string, string];
	/** Vế câu trong thông báo đột phá: "@A đã {breakthrough}". */
	breakthrough: string;
}

export const TIERS: readonly Tier[] = [
	{
		key: "luyen-khi",
		name: "Luyện Khí",
		emoji: "🌱",
		minLevel: 0,
		color: "#9ccc65",
		gradient: ["#33691e", "#9ccc65"],
		breakthrough: "bước vào con đường tu luyện",
	},
	{
		key: "truc-co",
		name: "Trúc Cơ",
		emoji: "🧱",
		minLevel: 3,
		color: "#bcaaa4",
		gradient: ["#4e342e", "#bcaaa4"],
		breakthrough: "đặt nền Trúc Cơ vững chắc",
	},
	{
		key: "kim-dan",
		name: "Kim Đan",
		emoji: "🟡",
		minLevel: 6,
		color: "#ffca28",
		gradient: ["#ff8f00", "#ffe082"],
		breakthrough: "ngưng tụ Kim Đan thành công",
	},
	{
		key: "nguyen-anh",
		name: "Nguyên Anh",
		emoji: "👶",
		minLevel: 10,
		color: "#4fc3f7",
		gradient: ["#01579b", "#4fc3f7"],
		breakthrough: "phá đan thành anh, bước vào Nguyên Anh",
	},
	{
		key: "hoa-than",
		name: "Hóa Thần",
		emoji: "🔥",
		minLevel: 15,
		color: "#ff7043",
		gradient: ["#bf360c", "#ffab91"],
		breakthrough: "vượt thiên kiếp, đạt cảnh giới Hóa Thần",
	},
	{
		key: "luyen-hu",
		name: "Luyện Hư",
		emoji: "🌀",
		minLevel: 20,
		color: "#9575cd",
		gradient: ["#311b92", "#b39ddb"],
		breakthrough: "lĩnh ngộ hư không, bước vào Luyện Hư",
	},
	{
		key: "hop-the",
		name: "Hợp Thể",
		emoji: "☯️",
		minLevel: 30,
		color: "#26a69a",
		gradient: ["#004d40", "#80cbc4"],
		breakthrough: "thiên nhân hợp nhất, đạt cảnh giới Hợp Thể",
	},
	{
		key: "do-kiep",
		name: "Độ Kiếp",
		emoji: "⚡",
		minLevel: 40,
		color: "#ffd740",
		gradient: ["#6200ea", "#ffd740"],
		breakthrough: "đối mặt lôi kiếp, bước vào Độ Kiếp",
	},
];

export function isTierKey(value: string): value is TierKey
{
	return TIER_KEYS.some(key => key === value);
}

export function tierByKey(key: TierKey): Tier
{
	const tier = TIERS.find(candidate => candidate.key === key);
	if (!tier) throw new Error(`Không có cảnh giới "${key}".`);
	return tier;
}

/** Cảnh giới của một level (level âm hoặc không hợp lệ coi như 0). */
export function tierForLevel(level: number): Tier
{
	let current = TIERS[0];
	for (const tier of TIERS)
	{
		if (level >= tier.minLevel) current = tier;
	}
	return current;
}

/** Cảnh giới kế tiếp, hoặc null nếu đã ở cảnh giới cao nhất. */
export function nextTier(level: number): Tier | null
{
	return TIERS.find(tier => tier.minLevel > level) ?? null;
}

/** Cảnh giới mới nếu đi từ levelBefore lên levelAfter mà vượt qua mốc cảnh giới; ngược lại null. */
export function tierUp(levelBefore: number, levelAfter: number): Tier | null
{
	const before = tierForLevel(levelBefore);
	const after = tierForLevel(levelAfter);
	return after.minLevel > before.minLevel ? after : null;
}
