import { isTierKey, isTierSetKey, Tier, TIER_KEYS, tierIndex as positionOfKey, TierSet, TierSetKey } from "../../modules/activity/tiers";
import { cleanText, Ctx, drawGlow, drawSpacedText, fillRoundedRect, fitText, Gradient, isHexColor, linearGradient, luminance, measureSpaced, mix, rgba, strokeRoundedRect } from "./draw";
import { drawTierEmblem } from "./emblems";
import { font } from "./fonts";

/** Bảng màu chung của ảnh thẻ (nền tối, chữ sáng). */
export const PALETTE = {
	night: "#0a0d1b",
	nightSoft: "#12162c",
	text: "#f5f6ff",
	textSoft: "#c5cae9",
	textMuted: "#8e95bd",
	panel: "rgba(255, 255, 255, 0.05)",
	panelBorder: "rgba(255, 255, 255, 0.09)",
	gold: "#ffd166",
	goldDeep: "#f5a623",
	warning: "#ffb74d",
	highlight: "#6fe3ff",
} as const;

const DEFAULT_TIER_COLOR = "#9fa8da";
const TOP_INDEX = TIER_KEYS.length - 1;

/** Màu an toàn của bậc (tier truyền vào có màu sai định dạng thì dùng màu mặc định). */
export function tierColors(tier: Tier): { color: string; from: string; to: string }
{
	const color = isHexColor(tier.color) ? tier.color : DEFAULT_TIER_COLOR;
	const from = isHexColor(tier.gradient?.[0]) ? tier.gradient[0] : mix(color, "#000000", 0.5);
	const to = isHexColor(tier.gradient?.[1]) ? tier.gradient[1] : color;
	return { color, from, to };
}

/** Vị trí 0–7 của bậc: lấy `tier.index` nếu hợp lệ, không thì suy từ `tier.key`; không suy được thì null. */
export function tierPosition(tier: Tier): number | null
{
	const index = tier.index;
	if (typeof index === "number" && Number.isInteger(index) && index >= 0 && index <= TOP_INDEX) return index;
	return typeof tier.key === "string" && isTierKey(tier.key) ? positionOfKey(tier.key) : null;
}

/** Thứ tự bậc (0 = bậc đầu tiên) để chọn độ phức tạp hoa văn; bậc lạ coi như 0. */
export function tierIndex(tier: Tier): number
{
	return tierPosition(tier) ?? 0;
}

export function isTopTier(tier: Tier): boolean
{
	return tierPosition(tier) === TOP_INDEX;
}

/** Khoá bộ danh hiệu của bậc, hoặc null nếu không hợp lệ. */
export function tierSetKeyOf(tier: Tier | null | undefined): TierSetKey | null
{
	const key = tier?.setKey;
	return typeof key === "string" && isTierSetKey(key) ? key : null;
}

/** Chữ trên ảnh thẻ theo bộ danh hiệu. */
export interface CardTexts
{
	/** Tên gọi của bậc, ví dụ "Cảnh giới", "Hạng". */
	tierLabel: string;
	/** Dòng tiến độ khi đã ở bậc cao nhất. */
	maxTier: string;
	/** Dòng nhắc khi đang giữ chuỗi ngày nhưng hôm nay chưa có tin được XP. */
	idleToday: string;
}

/** Chữ trung tính, dùng khi bộ danh hiệu thiếu chữ (dữ liệu hỏng). */
export const NEUTRAL_TEXTS: CardTexts = {
	tierLabel: "Bậc",
	maxTier: "Đã đạt bậc cao nhất",
	idleToday: "Hôm nay chưa hoạt động",
};

function textOr(value: unknown, fallback: string): string
{
	const cleaned = typeof value === "string" ? cleanText(value) : "";
	return cleaned.length > 0 ? cleaned : fallback;
}

/** Chữ trên thẻ lấy theo `tierSet.texts` (đã làm sạch); thiếu chữ nào thì dùng chữ trung tính cho chữ đó. */
export function cardTexts(tierSet: TierSet | null | undefined): CardTexts
{
	const texts = tierSet?.texts;
	return {
		tierLabel: textOr(texts?.tierLabel, NEUTRAL_TEXTS.tierLabel),
		maxTier: textOr(texts?.maxTier, NEUTRAL_TEXTS.maxTier),
		idleToday: textOr(texts?.idleToday, NEUTRAL_TEXTS.idleToday),
	};
}

/** Tên bậc đã làm sạch (tên tuỳ chỉnh của admin có thể dài tới 32 ký tự); rỗng thì "?". */
export function tierName(tier: Tier): string
{
	return textOr(tier.name, "?");
}

interface PillLayout
{
	label: string;
	fontSize: number;
	spacing: number;
	width: number;
	emblem: number;
	padding: number;
	gap: number;
}

/**
 * Bố cục viên thuốc bậc cho vừa `maxWidth`: thu nhỏ chữ và giãn chữ trước (tối thiểu 78% cỡ chữ), rồi mới cắt tên bằng "…".
 */
function pillLayout(ctx: Ctx, tier: Tier, height: number, maxWidth: number): PillLayout
{
	const label = tierName(tier).toLocaleUpperCase("vi");
	const emblem = Math.round(height * 0.6);
	const padding = Math.round(height * 0.38);
	const gap = Math.round(height * 0.2);
	const chrome = padding + emblem + gap + padding;
	const baseSize = Math.round(height * 0.48);
	const minSize = Math.max(8, Math.round(baseSize * 0.78));
	let fontSize = baseSize;
	let spacing = Math.max(0.5, height * 0.035);
	ctx.font = font(800, fontSize);
	let textWidth = measureSpaced(ctx, label, spacing);
	while (chrome + textWidth > maxWidth && fontSize > minSize)
	{
		fontSize -= 1;
		spacing = Math.max(0, spacing - 0.25);
		ctx.font = font(800, fontSize);
		textWidth = measureSpaced(ctx, label, spacing);
	}
	let fitted = label;
	if (chrome + textWidth > maxWidth)
	{
		spacing = 0;
		fitted = fitText(ctx, label, Math.max(0, maxWidth - chrome));
		textWidth = fitted.length > 0 ? ctx.measureText(fitted).width : 0;
	}
	return { label: fitted, fontSize, spacing, width: chrome + textWidth, emblem, padding, gap };
}

/** Độ rộng viên thuốc bậc khi vẽ trong giới hạn `maxWidth`. */
export function measureTierPill(ctx: Ctx, tier: Tier, height: number, maxWidth = Number.POSITIVE_INFINITY): number
{
	return pillLayout(ctx, tier, height, maxWidth).width;
}

/** Màu chữ riêng của bậc khi nằm trên nền màu bậc (`tier.textColor`), hoặc null nếu bậc không khai báo hay sai định dạng. */
export function tierTextColor(tier: Tier): string | null
{
	return isHexColor(tier.textColor) ? tier.textColor : null;
}

/** Màu viền riêng của bậc (`tier.borderColor`), hoặc null nếu bậc không khai báo hay sai định dạng. */
export function tierBorderColor(tier: Tier): string | null
{
	return isHexColor(tier.borderColor) ? tier.borderColor : null;
}

/**
 * Nền chip màu bậc: giữ `color` làm màu chủ đạo, ngả tối nhẹ khi chữ sáng và ngả sáng nhẹ khi chữ tối để chữ tương phản tốt hơn.
 */
function chipPaint(ctx: Ctx, color: string, text: string, y: number, height: number): Gradient
{
	const stops = luminance(text) > 0.5
		? [mix(color, "#ffffff", 0.08), color, mix(color, "#000000", 0.22)]
		: [mix(color, "#ffffff", 0.3), mix(color, "#ffffff", 0.1), color];
	return linearGradient(ctx, 0, y, 0, y + height, stops);
}

/**
 * Huy hiệu bậc dạng viên thuốc: biểu tượng theo bộ danh hiệu và tên viết hoa. Bậc có `textColor` vẽ thành chip nền màu bậc,
 * chữ màu đó; bậc khác dùng nền tối pha màu bậc, viền gradient. Bậc có `borderColor` dùng màu đó cho viền.
 * Tên dài được thu nhỏ rồi cắt cho vừa `maxWidth`. Vẽ từ mép trái `x`, căn giữa theo `centerY`; trả về độ rộng.
 */
export function drawTierPill(ctx: Ctx, tier: Tier, x: number, centerY: number, height: number, maxWidth = Number.POSITIVE_INFINITY): number
{
	const { color, from, to } = tierColors(tier);
	const text = tierTextColor(tier);
	const border = tierBorderColor(tier);
	const layout = pillLayout(ctx, tier, height, maxWidth);
	const y = centerY - height / 2;
	const radius = height / 2;
	ctx.save();
	if (text)
	{
		fillRoundedRect(ctx, x, y, layout.width, height, radius, chipPaint(ctx, color, text, y, height));
		fillRoundedRect(ctx, x + height * 0.12, y + 1.5, layout.width - height * 0.24, height * 0.34, height * 0.17, "rgba(255, 255, 255, 0.14)");
	}
	else
	{
		fillRoundedRect(ctx, x, y, layout.width, height, radius, PALETTE.night);
		fillRoundedRect(ctx, x, y, layout.width, height, radius, linearGradient(ctx, x, y, x + layout.width, y, [rgba(from, 0.55), rgba(to, 0.22)]));
	}
	const borderWidth = border ? Math.max(1.5, height * 0.07) : 1.5;
	const borderPaint = border ?? (text ? mix(color, "#000000", 0.4) : linearGradient(ctx, x, y, x + layout.width, y, [to, rgba(color, 0.35)]));
	strokeRoundedRect(ctx, x + borderWidth / 2, y + borderWidth / 2, layout.width - borderWidth, height - borderWidth, radius, borderPaint, borderWidth);

	const emblemX = x + layout.padding + layout.emblem / 2;
	if (text) drawGlow(ctx, emblemX, centerY, layout.emblem * 0.72, "#000000", 0.35);
	drawTierEmblem(ctx, tierSetKeyOf(tier), tierPosition(tier), emblemX, centerY, layout.emblem, mix(color, "#ffffff", 0.2));

	ctx.font = font(800, layout.fontSize);
	ctx.textBaseline = "middle";
	ctx.textAlign = "left";
	ctx.fillStyle = text ?? mix(color, "#ffffff", 0.45);
	drawSpacedText(ctx, layout.label, x + layout.padding + layout.emblem + layout.gap, centerY + 1, layout.spacing);
	ctx.restore();
	return layout.width;
}
