import { Tier } from "../../modules/activity/tiers";
import { formatNumber, userMention } from "../format";

// Thông báo lên level và đột phá cảnh giới phong cách tu tiên (DEC-029). Hàm thuần, test được không cần Discord client.

type LevelUpTemplate = (mention: string, level: string) => string;

/** Các biến thể thông báo lên level; chọn xác định theo level để test được và không lặp một câu liên tục. */
const LEVEL_UP_TEMPLATES: readonly LevelUpTemplate[] = [
	(mention, level) => `✨ Tu vi tăng tiến! ${mention} đã đạt **Level ${level}**.`,
	(mention, level) => `🌿 Linh khí hội tụ, ${mention} tiến thêm một tầng: **Level ${level}**!`,
	(mention, level) => `📜 Công pháp thêm một bậc viên mãn, ${mention} đã lên **Level ${level}**.`,
	(mention, level) => `🍃 Bế quan có thành quả, ${mention} đã đạt **Level ${level}**!`,
];

/** Số biến thể của thông báo lên level. */
export const LEVEL_UP_VARIANTS = LEVEL_UP_TEMPLATES.length;

/** Thông báo lên level (không vượt mốc cảnh giới), gửi vào channel nơi người đó vừa nhắn. */
export function levelUpText(userId: string, level: number): string
{
	const index = ((Math.trunc(level) % LEVEL_UP_VARIANTS) + LEVEL_UP_VARIANTS) % LEVEL_UP_VARIANTS;
	return LEVEL_UP_TEMPLATES[index](userMention(userId), formatNumber(level));
}

/** Thông báo đột phá khi lên level vượt qua mốc của một cảnh giới mới. */
export function breakthroughText(userId: string, tier: Tier, level: number): string
{
	return `⚡ Thiên kiếp giáng xuống… ${userMention(userId)} đã ${tier.breakthrough}! `
		+ `${tier.emoji} Cảnh giới **${tier.name}** · Level ${formatNumber(level)}`;
}
