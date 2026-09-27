import { Tier, TIER_SETS, TierSet } from "../../modules/activity/tiers";
import { formatNumber, userMention } from "../format";

/*
 * Thông báo lên level và lên bậc theo giọng văn của bộ danh hiệu guild đang dùng (DEC-029, DEC-033).
 * Hàm thuần, test được không cần Discord client.
 */

/** Dùng khi một bộ không có câu lên level nào (không xảy ra với các bộ có sẵn). */
const FALLBACK_LEVEL_UP = "🎉 {user} đã đạt **Level {level}**.";

/** Chỉ các placeholder đã biết; placeholder lạ giữ nguyên chữ. */
const PLACEHOLDER = /\{(user|level|tier|emoji|phrase)\}/g;

type TemplateValues = Readonly<Partial<Record<string, string>>>;

/**
 * Thay placeholder trong một lượt quét: giá trị đã thay (ví dụ tên bậc do admin đặt chứa "{user}") không bị quét lại,
 * và ký tự "$" trong giá trị không bị hiểu thành mẫu thay thế của String.replace.
 */
function fillTemplate(template: string, values: TemplateValues): string
{
	return template.replace(PLACEHOLDER, (match: string, name: string) => values[name] ?? match);
}

/** Vị trí biến thể theo level: cùng level luôn cùng câu, các level liên tiếp xoay vòng qua mọi câu. */
function variantIndex(level: number, count: number): number
{
	const whole = Number.isFinite(level) ? Math.trunc(level) : 0;
	return ((whole % count) + count) % count;
}

/** Thông báo lên level (không vượt mốc bậc) theo bộ `set`, gửi vào channel nơi người đó vừa nhắn. */
export function levelUpText(set: TierSet, userId: string, level: number): string
{
	const templates = set.texts.levelUp;
	const template = templates.length > 0 ? templates[variantIndex(level, templates.length)] : FALLBACK_LEVEL_UP;
	return fillTemplate(template, { user: userMention(userId), level: formatNumber(level) });
}

/**
 * Vế "đã {phrase}" của thông báo lên bậc. Vế riêng của bậc (`breakthrough`) nhắc tên mặc định (ví dụ "leo lên hạng Bạc"),
 * nên khi admin đã đổi tên bậc thì dùng vế trung tính theo mốc level để câu không mâu thuẫn với tên mới.
 */
function promotionPhrase(tier: Tier): string
{
	const defaultName = TIER_SETS[tier.setKey].tiers.at(tier.index)?.name;
	return tier.name === defaultName ? tier.breakthrough : `vượt mốc Level ${formatNumber(tier.minLevel)}`;
}

/** Thông báo khi lên level vượt qua mốc của bậc mới `tier` (thuộc bộ `set`). */
export function promotionText(set: TierSet, userId: string, tier: Tier, level: number): string
{
	return fillTemplate(set.texts.promotion, {
		user: userMention(userId),
		phrase: promotionPhrase(tier),
		emoji: tier.emoji,
		tier: tier.name,
		level: formatNumber(level),
	});
}
