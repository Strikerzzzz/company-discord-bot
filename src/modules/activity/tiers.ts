/*
 * Bộ danh hiệu theo level (DEC-029, DEC-033). Chỉ để hiển thị: không đổi công thức XP hay level (DEC-022).
 * Mọi bộ có đúng 8 bậc với cùng mốc level (TIER_LEVELS), nên "bậc" (TierKey) là vị trí dùng chung giữa các bộ:
 * đổi bộ chỉ đổi tên, emoji, màu và giọng văn; role gán theo bậc (tier_roles) vẫn giữ nguyên.
 */

/** Level tối thiểu của từng bậc, dùng chung cho mọi bộ. */
export const TIER_LEVELS = [0, 3, 6, 10, 15, 20, 30, 40] as const;

/** Khoá vị trí bậc, từ thấp tới cao. */
export const TIER_KEYS = ["bac-1", "bac-2", "bac-3", "bac-4", "bac-5", "bac-6", "bac-7", "bac-8"] as const;

export type TierKey = (typeof TIER_KEYS)[number];

export const TIER_SET_KEYS = ["tu-tien", "rank-game", "kiem-hiep", "cay-xanh", "vu-tru"] as const;

export type TierSetKey = (typeof TIER_SET_KEYS)[number];

export const DEFAULT_TIER_SET_KEY: TierSetKey = "tu-tien";

export interface Tier
{
	key: TierKey;
	/** Vị trí 0–7 (bằng vị trí của key trong TIER_KEYS). */
	index: number;
	setKey: TierSetKey;
	/** Tên bậc hiển thị (đã áp tên tuỳ chỉnh của guild nếu có). */
	name: string;
	/** Emoji dùng trong tin nhắn (không vẽ trên ảnh vì font không có emoji). */
	emoji: string;
	/** Level tối thiểu để đạt bậc này (TIER_LEVELS[index]). */
	minLevel: number;
	/** Màu chính dạng "#rrggbb" (viền, chữ nhấn, màu role khi bot tự tạo). */
	color: string;
	/** Hai màu gradient "#rrggbb" cho ảnh thẻ, từ trái sang phải. */
	gradient: readonly [string, string];
	/**
	 * Vế câu trong thông báo lên bậc: "@A đã {breakthrough}". Chứa tên mặc định của bậc, nên khi admin đổi tên bậc
	 * thì tầng hiển thị dùng vế trung tính "vượt mốc Level N" thay thế (DEC-033).
	 */
	breakthrough: string;
}

/**
 * Giọng văn của một bộ. Template dùng placeholder: {user} (mention), {level}, {tier} (tên bậc), {emoji}, {phrase} (breakthrough).
 * Tầng Discord thay placeholder; nội dung template là hằng số trong code, không do người dùng nhập.
 */
export interface TierSetTexts
{
	/** Tên gọi của bậc trong câu, ví dụ "Cảnh giới", "Hạng". */
	tierLabel: string;
	/** Thông báo lên level khi không đổi bậc; chọn biến thể theo level. Placeholder: {user}, {level}. */
	levelUp: readonly string[];
	/** Thông báo khi lên bậc mới. Placeholder: {user}, {phrase}, {emoji}, {tier}, {level}. */
	promotion: string;
	/** Chữ trên thẻ khi đã ở bậc cao nhất. */
	maxTier: string;
	/** Chữ gợi ý trên thẻ khi đang có chuỗi ngày nhưng hôm nay chưa có tin được XP. */
	idleToday: string;
	/** Tên thẻ /rank trong câu, ví dụ "thẻ tu luyện". */
	cardName: string;
}

export interface TierSet
{
	key: TierSetKey;
	/** Tên bộ, ví dụ "Tu tiên". */
	name: string;
	/** Mô tả ngắn cho menu chọn bộ (≤ 100 ký tự). */
	description: string;
	texts: TierSetTexts;
	/** Đúng 8 bậc theo thứ tự TIER_KEYS. */
	tiers: readonly Tier[];
}

/** Tên/emoji tuỳ chỉnh của một bậc trong một bộ; null = dùng mặc định của bộ. */
export interface TierNameOverride
{
	tierKey: TierKey;
	name: string | null;
	emoji: string | null;
}

type TierStyle = Omit<Tier, "key" | "index" | "setKey" | "minLevel">;

function buildTiers(setKey: TierSetKey, styles: readonly TierStyle[]): Tier[]
{
	if (styles.length !== TIER_KEYS.length) throw new Error(`Bộ danh hiệu "${setKey}" phải có đúng ${TIER_KEYS.length} bậc.`);
	return styles.map((style, index) => ({ ...style, key: TIER_KEYS[index], index, setKey, minLevel: TIER_LEVELS[index] }));
}

const TU_TIEN: TierSet = {
	key: "tu-tien",
	name: "Tu tiên",
	description: "Luyện Khí → Độ Kiếp: đột phá cảnh giới, vượt thiên kiếp",
	texts: {
		tierLabel: "Cảnh giới",
		levelUp: [
			"✨ Tu vi tăng tiến! {user} đã đạt **Level {level}**.",
			"🌿 Linh khí hội tụ, {user} tiến thêm một tầng: **Level {level}**!",
			"📜 Công pháp thêm một bậc viên mãn, {user} đã lên **Level {level}**.",
			"🍃 Bế quan có thành quả, {user} đã đạt **Level {level}**!",
		],
		promotion: "⚡ Thiên kiếp giáng xuống… {user} đã {phrase}! {emoji} Cảnh giới **{tier}** · Level {level}",
		maxTier: "Đã đạt cảnh giới tối cao",
		idleToday: "Hôm nay chưa tu luyện",
		cardName: "thẻ tu luyện",
	},
	tiers: buildTiers("tu-tien", [
		{ name: "Luyện Khí", emoji: "🌱", color: "#9ccc65", gradient: ["#33691e", "#9ccc65"], breakthrough: "bước vào con đường tu luyện" },
		{ name: "Trúc Cơ", emoji: "🧱", color: "#bcaaa4", gradient: ["#4e342e", "#bcaaa4"], breakthrough: "đặt nền Trúc Cơ vững chắc" },
		{ name: "Kim Đan", emoji: "🟡", color: "#ffca28", gradient: ["#ff8f00", "#ffe082"], breakthrough: "ngưng tụ Kim Đan thành công" },
		{ name: "Nguyên Anh", emoji: "👶", color: "#4fc3f7", gradient: ["#01579b", "#4fc3f7"], breakthrough: "phá đan thành anh, bước vào Nguyên Anh" },
		{ name: "Hóa Thần", emoji: "🔥", color: "#ff7043", gradient: ["#bf360c", "#ffab91"], breakthrough: "vượt thiên kiếp, đạt cảnh giới Hóa Thần" },
		{ name: "Luyện Hư", emoji: "🌀", color: "#9575cd", gradient: ["#311b92", "#b39ddb"], breakthrough: "lĩnh ngộ hư không, bước vào Luyện Hư" },
		{ name: "Hợp Thể", emoji: "☯️", color: "#26a69a", gradient: ["#004d40", "#80cbc4"], breakthrough: "thiên nhân hợp nhất, đạt cảnh giới Hợp Thể" },
		{ name: "Độ Kiếp", emoji: "⚡", color: "#ffd740", gradient: ["#6200ea", "#ffd740"], breakthrough: "đối mặt lôi kiếp, bước vào Độ Kiếp" },
	]),
};

const RANK_GAME: TierSet = {
	key: "rank-game",
	name: "Rank game",
	description: "Đồng → Thách Đấu: leo rank như trong game",
	texts: {
		tierLabel: "Hạng",
		levelUp: [
			"📈 {user} vừa lên **Level {level}**!",
			"🎮 Level up! {user} đã đạt **Level {level}**.",
			"⭐ {user} tăng cấp lên **Level {level}**, tiếp tục leo rank nào!",
			"🔥 {user} đang lên phong độ: **Level {level}**!",
		],
		promotion: "🏆 Thăng hạng! {user} đã {phrase}! {emoji} Hạng **{tier}** · Level {level}",
		maxTier: "Đã đạt hạng cao nhất",
		idleToday: "Hôm nay chưa leo rank",
		cardName: "thẻ xếp hạng",
	},
	tiers: buildTiers("rank-game", [
		{ name: "Đồng", emoji: "🟤", color: "#cd7f32", gradient: ["#5d3a1a", "#e0a370"], breakthrough: "bắt đầu hành trình leo rank" },
		{ name: "Bạc", emoji: "⚪", color: "#cbd5e1", gradient: ["#475569", "#e2e8f0"], breakthrough: "leo lên hạng Bạc" },
		{ name: "Vàng", emoji: "🟡", color: "#fbbf24", gradient: ["#b45309", "#fde68a"], breakthrough: "chạm tới hạng Vàng" },
		{ name: "Bạch Kim", emoji: "🔷", color: "#5eead4", gradient: ["#0f766e", "#99f6e4"], breakthrough: "bứt phá lên Bạch Kim" },
		{ name: "Kim Cương", emoji: "💎", color: "#60a5fa", gradient: ["#1e3a8a", "#93c5fd"], breakthrough: "chinh phục hạng Kim Cương" },
		{ name: "Tinh Anh", emoji: "🔮", color: "#c084fc", gradient: ["#581c87", "#e9d5ff"], breakthrough: "gia nhập hàng Tinh Anh" },
		{ name: "Cao Thủ", emoji: "👑", color: "#f87171", gradient: ["#7f1d1d", "#fecaca"], breakthrough: "trở thành Cao Thủ" },
		{ name: "Thách Đấu", emoji: "🏆", color: "#fde047", gradient: ["#b91c1c", "#fde047"], breakthrough: "đứng trên đỉnh Thách Đấu" },
	]),
};

const KIEM_HIEP: TierSet = {
	key: "kiem-hiep",
	name: "Kiếm hiệp",
	description: "Tân Thủ → Võ Lâm Minh Chủ: hành tẩu giang hồ",
	texts: {
		tierLabel: "Danh hiệu",
		levelUp: [
			"⚔️ Công lực tăng tiến! {user} đạt **Level {level}**.",
			"🗡️ {user} vừa luyện thêm một chiêu, lên **Level {level}**.",
			"🏯 Giang hồ đồn rằng {user} đã đạt **Level {level}**.",
			"🍶 Nâng chén chúc mừng {user} lên **Level {level}**!",
		],
		promotion: "🐉 Chấn động giang hồ! {user} đã {phrase}! {emoji} Danh hiệu **{tier}** · Level {level}",
		maxTier: "Đã đạt danh hiệu cao nhất",
		idleToday: "Hôm nay chưa luyện công",
		cardName: "thẻ giang hồ",
	},
	tiers: buildTiers("kiem-hiep", [
		{ name: "Tân Thủ", emoji: "🌱", color: "#a3e635", gradient: ["#365314", "#bef264"], breakthrough: "bước chân vào giang hồ" },
		{ name: "Kiếm Khách", emoji: "🗡️", color: "#94a3b8", gradient: ["#334155", "#cbd5e1"], breakthrough: "rèn xong thanh kiếm đầu tiên" },
		{ name: "Hiệp Sĩ", emoji: "🛡️", color: "#38bdf8", gradient: ["#075985", "#7dd3fc"], breakthrough: "hành hiệp trượng nghĩa, thành Hiệp Sĩ" },
		{ name: "Tráng Sĩ", emoji: "⚔️", color: "#f59e0b", gradient: ["#92400e", "#fcd34d"], breakthrough: "luyện thành tuyệt kỹ, thành Tráng Sĩ" },
		{ name: "Đại Hiệp", emoji: "🐉", color: "#ef4444", gradient: ["#7f1d1d", "#fca5a5"], breakthrough: "vang danh bốn phương, thành Đại Hiệp" },
		{ name: "Tông Sư", emoji: "🔥", color: "#fb923c", gradient: ["#9a3412", "#fed7aa"], breakthrough: "khai tông lập phái, thành Tông Sư" },
		{ name: "Chưởng Môn", emoji: "👑", color: "#a855f7", gradient: ["#4c1d95", "#d8b4fe"], breakthrough: "được tôn làm Chưởng Môn" },
		{ name: "Võ Lâm Minh Chủ", emoji: "🌟", color: "#facc15", gradient: ["#7c2d12", "#fde047"], breakthrough: "thống lĩnh quần hùng, thành Võ Lâm Minh Chủ" },
	]),
};

const CAY_XANH: TierSet = {
	key: "cay-xanh",
	name: "Cây xanh",
	description: "Hạt Giống → Đại Thụ Ngàn Năm: cùng nhau lớn lên",
	texts: {
		tierLabel: "Giai đoạn",
		levelUp: [
			"🌱 {user} lớn thêm một chút: **Level {level}**!",
			"💧 Được tưới đều, {user} đã lên **Level {level}**.",
			"☀️ Nắng lên rồi! {user} đạt **Level {level}**.",
			"🍃 {user} vươn cao thêm, **Level {level}**!",
		],
		promotion: "🌳 Lớn lên rồi! {user} đã {phrase}! {emoji} Giai đoạn **{tier}** · Level {level}",
		maxTier: "Đã đạt giai đoạn cao nhất",
		idleToday: "Hôm nay chưa tưới cây",
		cardName: "thẻ vườn cây",
	},
	tiers: buildTiers("cay-xanh", [
		{ name: "Hạt Giống", emoji: "🌰", color: "#d6a36b", gradient: ["#5b3a1e", "#e7c49a"], breakthrough: "được gieo xuống đất lành" },
		{ name: "Nảy Mầm", emoji: "🌱", color: "#86efac", gradient: ["#166534", "#bbf7d0"], breakthrough: "nảy những chiếc mầm đầu tiên" },
		{ name: "Cây Non", emoji: "🌿", color: "#4ade80", gradient: ["#14532d", "#86efac"], breakthrough: "trở thành cây non xanh tốt" },
		{ name: "Ra Hoa", emoji: "🌷", color: "#f472b6", gradient: ["#9d174d", "#fbcfe8"], breakthrough: "nở những bông hoa đầu tiên" },
		{ name: "Kết Trái", emoji: "🍎", color: "#f87171", gradient: ["#991b1b", "#fecaca"], breakthrough: "kết những trái ngọt đầu mùa" },
		{ name: "Cây Lớn", emoji: "🌳", color: "#22c55e", gradient: ["#14532d", "#4ade80"], breakthrough: "vươn mình thành cây lớn" },
		{ name: "Cổ Thụ", emoji: "🌲", color: "#34d399", gradient: ["#064e3b", "#6ee7b7"], breakthrough: "trở thành cổ thụ vững chãi" },
		{ name: "Đại Thụ Ngàn Năm", emoji: "🏞️", color: "#fbbf24", gradient: ["#065f46", "#fde68a"], breakthrough: "hoá thành đại thụ ngàn năm" },
	]),
};

const VU_TRU: TierSet = {
	key: "vu-tru",
	name: "Vũ trụ",
	description: "Thiên Thạch → Vũ Trụ: hành trình giữa các vì sao",
	texts: {
		tierLabel: "Thiên thể",
		levelUp: [
			"🚀 {user} tăng tốc lên **Level {level}**!",
			"🛰️ Tín hiệu mới: {user} đạt **Level {level}**.",
			"🌠 Một ngôi sao băng vừa bay qua, {user} lên **Level {level}**!",
			"🪐 {user} tiến xa thêm một quỹ đạo: **Level {level}**.",
		],
		promotion: "🌌 Tiến hoá vũ trụ! {user} đã {phrase}! {emoji} Thiên thể **{tier}** · Level {level}",
		maxTier: "Đã đạt cấp cao nhất",
		idleToday: "Hôm nay chưa phóng tàu",
		cardName: "thẻ phi hành gia",
	},
	tiers: buildTiers("vu-tru", [
		{ name: "Thiên Thạch", emoji: "🪨", color: "#a8a29e", gradient: ["#44403c", "#d6d3d1"], breakthrough: "bắt đầu hành trình giữa các vì sao" },
		{ name: "Tiểu Hành Tinh", emoji: "🌑", color: "#94a3b8", gradient: ["#1e293b", "#cbd5e1"], breakthrough: "hội tụ thành tiểu hành tinh" },
		{ name: "Hành Tinh", emoji: "🌍", color: "#38bdf8", gradient: ["#0c4a6e", "#7dd3fc"], breakthrough: "trở thành một hành tinh" },
		{ name: "Ngôi Sao", emoji: "☀️", color: "#facc15", gradient: ["#a16207", "#fef08a"], breakthrough: "bừng sáng thành ngôi sao" },
		{ name: "Sao Khổng Lồ", emoji: "🌟", color: "#fb923c", gradient: ["#9a3412", "#fdba74"], breakthrough: "phình to thành sao khổng lồ" },
		{ name: "Tinh Vân", emoji: "💫", color: "#e879f9", gradient: ["#86198f", "#f5d0fe"], breakthrough: "toả rộng thành tinh vân rực rỡ" },
		{ name: "Thiên Hà", emoji: "🌌", color: "#818cf8", gradient: ["#312e81", "#c7d2fe"], breakthrough: "hội tụ cả một thiên hà" },
		{ name: "Vũ Trụ", emoji: "✨", color: "#f0abfc", gradient: ["#1e1b4b", "#f0abfc"], breakthrough: "trở thành cả một vũ trụ" },
	]),
};

/** Các bộ có sẵn, theo thứ tự hiển thị trong menu chọn. */
export const TIER_SETS: Readonly<Record<TierSetKey, TierSet>> = {
	"tu-tien": TU_TIEN,
	"rank-game": RANK_GAME,
	"kiem-hiep": KIEM_HIEP,
	"cay-xanh": CAY_XANH,
	"vu-tru": VU_TRU,
};

/** Bộ mặc định (Tu tiên), dùng khi guild chưa chọn bộ. */
export const DEFAULT_TIER_SET: TierSet = TIER_SETS[DEFAULT_TIER_SET_KEY];

/** Bậc của bộ mặc định; giữ để tương thích với code viết trước khi có nhiều bộ. */
export const TIERS: readonly Tier[] = DEFAULT_TIER_SET.tiers;

export function isTierKey(value: string): value is TierKey
{
	return TIER_KEYS.some(key => key === value);
}

export function isTierSetKey(value: string): value is TierSetKey
{
	return TIER_SET_KEYS.some(key => key === value);
}

/** Vị trí 0–7 của một bậc. */
export function tierIndex(key: TierKey): number
{
	return TIER_KEYS.indexOf(key);
}

/**
 * Bộ danh hiệu với tên/emoji tuỳ chỉnh đã áp vào (tên/emoji null hoặc chuỗi rỗng thì giữ mặc định của bộ).
 * Không kiểm tra hợp lệ của tên tuỳ chỉnh; việc đó thuộc TierSetService khi lưu.
 */
export function applyTierOverrides(set: TierSet, overrides: readonly TierNameOverride[]): TierSet
{
	if (overrides.length === 0) return set;
	const byKey = new Map(overrides.map(override => [override.tierKey, override]));
	return {
		...set,
		tiers: set.tiers.map(tier =>
		{
			const override = byKey.get(tier.key);
			if (!override) return tier;
			return { ...tier, name: override.name || tier.name, emoji: override.emoji || tier.emoji };
		}),
	};
}

export function tierByKey(key: TierKey, set: TierSet = DEFAULT_TIER_SET): Tier
{
	const tier = set.tiers.find(candidate => candidate.key === key);
	if (!tier) throw new Error(`Không có bậc "${key}" trong bộ "${set.key}".`);
	return tier;
}

/** Bậc của một level trong một bộ (level âm hoặc không hợp lệ coi như 0). */
export function tierForLevel(level: number, set: TierSet = DEFAULT_TIER_SET): Tier
{
	let current = set.tiers[0];
	for (const tier of set.tiers)
	{
		if (level >= tier.minLevel) current = tier;
	}
	return current;
}

/** Bậc kế tiếp, hoặc null nếu đã ở bậc cao nhất. */
export function nextTier(level: number, set: TierSet = DEFAULT_TIER_SET): Tier | null
{
	return set.tiers.find(tier => tier.minLevel > level) ?? null;
}

/** Bậc mới nếu đi từ levelBefore lên levelAfter mà vượt qua mốc bậc; ngược lại null. */
export function tierUp(levelBefore: number, levelAfter: number, set: TierSet = DEFAULT_TIER_SET): Tier | null
{
	const before = tierForLevel(levelBefore, set);
	const after = tierForLevel(levelAfter, set);
	return after.minLevel > before.minLevel ? after : null;
}
