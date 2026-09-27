import { Tier, TIERS } from "../../modules/activity/tiers";
import { Ctx, fillRoundedRect, isHexColor, linearGradient, measureSpaced, drawSpacedText, rgba, strokeRoundedRect, mix } from "./draw";
import { font } from "./fonts";
import { drawTierEmblem } from "./icons";

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

/** Màu an toàn của cảnh giới (tier truyền vào có màu sai định dạng thì dùng màu mặc định). */
export function tierColors(tier: Tier): { color: string; from: string; to: string }
{
	const color = isHexColor(tier.color) ? tier.color : DEFAULT_TIER_COLOR;
	const from = isHexColor(tier.gradient?.[0]) ? tier.gradient[0] : mix(color, "#000000", 0.5);
	const to = isHexColor(tier.gradient?.[1]) ? tier.gradient[1] : color;
	return { color, from, to };
}

/** Thứ tự cảnh giới (0 = Luyện Khí); key lạ coi như 0. */
export function tierIndex(tier: Tier): number
{
	return Math.max(0, TIERS.findIndex(candidate => candidate.key === tier.key));
}

export function isTopTier(tier: Tier): boolean
{
	return tierIndex(tier) === TIERS.length - 1;
}

function pillLabel(tier: Tier): string
{
	return (typeof tier.name === "string" && tier.name.length > 0 ? tier.name : "?").toLocaleUpperCase("vi");
}

function pillMetrics(ctx: Ctx, tier: Tier, height: number): { label: string; fontSize: number; spacing: number; width: number; emblem: number; padding: number }
{
	const label = pillLabel(tier);
	const fontSize = Math.round(height * 0.48);
	const spacing = Math.max(0.5, height * 0.035);
	const emblem = Math.round(height * 0.6);
	const padding = Math.round(height * 0.38);
	ctx.font = font(800, fontSize);
	const width = padding + emblem + Math.round(height * 0.2) + measureSpaced(ctx, label, spacing) + padding;
	return { label, fontSize, spacing, width, emblem, padding };
}

export function measureTierPill(ctx: Ctx, tier: Tier, height: number): number
{
	return pillMetrics(ctx, tier, height).width;
}

/**
 * Huy hiệu cảnh giới dạng viên thuốc: nền tối pha màu cảnh giới, viền gradient, biểu tượng và tên viết hoa.
 * Vẽ từ mép trái `x`, căn giữa theo `centerY`; trả về độ rộng.
 */
export function drawTierPill(ctx: Ctx, tier: Tier, x: number, centerY: number, height: number): number
{
	const { color, from, to } = tierColors(tier);
	const metrics = pillMetrics(ctx, tier, height);
	const y = centerY - height / 2;
	ctx.save();
	fillRoundedRect(ctx, x, y, metrics.width, height, height / 2, PALETTE.night);
	fillRoundedRect(ctx, x, y, metrics.width, height, height / 2, linearGradient(ctx, x, y, x + metrics.width, y, [rgba(from, 0.55), rgba(to, 0.22)]));
	strokeRoundedRect(ctx, x + 0.75, y + 0.75, metrics.width - 1.5, height - 1.5, height / 2, linearGradient(ctx, x, y, x + metrics.width, y, [to, rgba(color, 0.35)]), 1.5);

	drawTierEmblem(ctx, tier.key, x + metrics.padding + metrics.emblem / 2, centerY, metrics.emblem, mix(color, "#ffffff", 0.2));

	ctx.font = font(800, metrics.fontSize);
	ctx.textBaseline = "middle";
	ctx.textAlign = "left";
	ctx.fillStyle = mix(color, "#ffffff", 0.45);
	drawSpacedText(ctx, metrics.label, x + metrics.padding + metrics.emblem + Math.round(height * 0.2), centerY + 1, metrics.spacing);
	ctx.restore();
	return metrics.width;
}
