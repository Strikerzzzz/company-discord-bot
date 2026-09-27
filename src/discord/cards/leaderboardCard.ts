import { createCanvas, Image } from "@napi-rs/canvas";
import { TIER_KEYS } from "../../modules/activity/tiers";
import {
	cleanDisplayName,
	cleanText,
	Ctx,
	decodeAvatar,
	drawAvatar,
	drawGlow,
	fillCircle,
	fillRoundedRect,
	fitFontSize,
	fitText,
	hashString,
	isHexColor,
	linearGradient,
	mix,
	mulberry32,
	rgba,
	roundedRectPath,
	safeInt,
	strokeCircle,
	strokeRoundedRect,
} from "./draw";
import { drawTierEmblem } from "./emblems";
import { ensureFonts, font } from "./fonts";
import { drawMedal, drawSparkle, drawTrophy, medalColor } from "./icons";
import { CardStyle, cardStyle } from "./styles";
import { drawTierPill, PALETTE, tierColors, tierSetKeyOf } from "./theme";
import { LeaderboardCardData, LeaderboardCardRow, RenderedCard } from "./types";

/*
 * Ảnh bảng xếp hạng "Bảng vàng" (DEC-030): header có cúp vàng trong khung trang trí, tối đa 10 dòng (top 3 có huy chương),
 * dòng của người xem được làm nổi bật, chân ảnh. Chiều cao đổi theo số dòng.
 * Mọi bảng (Activity, Contribution, cá nhân và team, kể cả bảng trống) mang phong cách của bộ danh hiệu guild đang dùng
 * (`data.tierSet`, DEC-033): nền, khung cúp, viền, hình bảng trống. Dòng có bậc (Activity cá nhân) vẽ thêm viên thuốc bậc.
 */

const WIDTH = 1000;
const PAD = 30;
const CARD_RADIUS = 30;
const ROWS_TOP = 144;
const ROW_H = 68;
const ROW_GAP = 8;
const EMPTY_H = 250;
const FOOTER_H = 66;
const MAX_ROWS = 10;
const EMBLEM_X = PAD + 42;
const EMBLEM_Y = 70;
const TOP_TIER_INDEX = TIER_KEYS.length - 1;
const NEUTRAL_RING = "#5c6391";

interface RowView
{
	source: LeaderboardCardRow;
	avatar: Image | null;
	rank: number;
	name: string;
	value: string;
	detail: string;
	accent: string | null;
}

function cardHeight(rowCount: number): number
{
	const body = rowCount > 0 ? rowCount * ROW_H + (rowCount - 1) * ROW_GAP : EMPTY_H;
	return ROWS_TOP + body + FOOTER_H;
}

function drawBackground(ctx: Ctx, style: CardStyle, height: number, seed: number): void
{
	const rand = mulberry32(seed);
	ctx.fillStyle = linearGradient(ctx, 0, 0, WIDTH * 0.4, height, ["#1a1530", PALETTE.night, "#0d1224"]);
	ctx.fillRect(0, 0, WIDTH, height);
	style.boardBackground(ctx, rand, WIDTH, height, [
		{ x: PAD + 90, y: 30, width: WIDTH - PAD * 2 - 90, height: 80 },
		{ x: PAD, y: ROWS_TOP, width: WIDTH - PAD * 2, height: height - ROWS_TOP - 20 },
	]);
}

function drawHeader(ctx: Ctx, style: CardStyle, data: LeaderboardCardData, seed: number): void
{
	drawGlow(ctx, EMBLEM_X, EMBLEM_Y, 60, PALETTE.gold, 0.45);
	style.boardRing(ctx, EMBLEM_X, EMBLEM_Y, 46, seed);
	fillCircle(ctx, EMBLEM_X, EMBLEM_Y, 27, linearGradient(ctx, EMBLEM_X, EMBLEM_Y - 27, EMBLEM_X, EMBLEM_Y + 27, ["#3a2a12", "#1b1426"]));
	strokeCircle(ctx, EMBLEM_X, EMBLEM_Y, 27, linearGradient(ctx, EMBLEM_X - 27, EMBLEM_Y - 27, EMBLEM_X + 27, EMBLEM_Y + 27, ["#fff3b0", PALETTE.goldDeep]), 2.5);
	drawTrophy(ctx, EMBLEM_X, EMBLEM_Y + 1, 30, PALETTE.gold);

	const textX = EMBLEM_X + 72;
	const maxWidth = WIDTH - PAD - textX;
	const title = cleanText(data.title);
	ctx.save();
	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";
	fitFontSize(ctx, title, 800, 32, 22, maxWidth);
	const fitted = fitText(ctx, title, maxWidth);
	const titleWidth = ctx.measureText(fitted).width;
	ctx.shadowColor = rgba(PALETTE.goldDeep, 0.55);
	ctx.shadowBlur = 16;
	ctx.fillStyle = linearGradient(ctx, textX, 0, textX + Math.max(1, titleWidth), 0, ["#fff6d8", PALETTE.gold, PALETTE.goldDeep]);
	ctx.fillText(fitted, textX, 64);
	ctx.shadowBlur = 0;

	ctx.font = font(600, 19);
	ctx.fillStyle = PALETTE.textSoft;
	ctx.fillText(fitText(ctx, cleanText(data.subtitle), maxWidth), textX, 99);
	ctx.restore();

	const lineY = 126;
	ctx.fillStyle = linearGradient(ctx, PAD, 0, WIDTH - PAD, 0, [rgba(PALETTE.gold, 0), rgba(PALETTE.gold, 0.7), rgba(PALETTE.gold, 0)]);
	ctx.fillRect(PAD, lineY, WIDTH - PAD * 2, 1.5);
	ctx.save();
	ctx.translate(WIDTH / 2, lineY + 0.75);
	ctx.rotate(Math.PI / 4);
	ctx.fillStyle = PALETTE.gold;
	ctx.fillRect(-4, -4, 8, 8);
	ctx.restore();
}

function isMedalRank(rank: number): rank is 1 | 2 | 3
{
	return rank === 1 || rank === 2 || rank === 3;
}

const NUMBER_PREFIX = /^([+-]?\d[\d.,]*)(\s*)(.*)$/u;

/** Vẽ giá trị căn phải (phần số đậm, phần đơn vị nhỏ hơn); trả về mép trái đã dùng. */
function drawValue(ctx: Ctx, value: string, right: number, baseline: number, color: string): number
{
	const match = NUMBER_PREFIX.exec(value);
	const number = match ? match[1] : value;
	const unit = match ? match[3] : "";
	const gap = unit.length > 0 ? 6 : 0;
	ctx.save();
	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";
	ctx.font = font(700, 17);
	const fittedUnit = fitText(ctx, unit, 120);
	const unitWidth = fittedUnit.length > 0 ? ctx.measureText(fittedUnit).width : 0;
	fitFontSize(ctx, number, 800, 27, 16, 260 - unitWidth - gap);
	const fittedNumber = fitText(ctx, number, 260 - unitWidth - gap);
	const numberWidth = ctx.measureText(fittedNumber).width;
	const left = right - unitWidth - gap - numberWidth;
	ctx.fillStyle = color;
	ctx.fillText(fittedNumber, left, baseline);
	if (unitWidth > 0)
	{
		ctx.font = font(700, 17);
		ctx.fillStyle = PALETTE.textSoft;
		ctx.fillText(fittedUnit, right - unitWidth, baseline);
	}
	ctx.restore();
	return left;
}

function drawRankLabel(ctx: Ctx, row: RowView, x: number, centerY: number): void
{
	if (isMedalRank(row.rank))
	{
		drawMedal(ctx, row.rank, x, centerY + 6, 19, String(row.rank), font(800, 18));
		return;
	}
	const label = `#${row.rank.toLocaleString("vi-VN")}`;
	ctx.save();
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = row.source.highlight ? PALETTE.highlight : PALETTE.textSoft;
	fitFontSize(ctx, label, 800, 24, 12, 66);
	ctx.fillText(fitText(ctx, label, 66), x, centerY + 1);
	ctx.restore();
}

/** Viền avatar: màu bậc; không có bậc thì màu riêng của dòng (màu role team), rồi màu huy chương top 3, rồi màu dịu của bộ. */
function avatarRingColor(style: CardStyle, row: RowView, medal: string | null): string
{
	if (row.source.tier) return tierColors(row.source.tier).color;
	if (row.accent) return row.accent;
	if (medal) return mix(medal, "#ffffff", 0.15);
	return mix(style.boardSoft, NEUTRAL_RING, 0.5);
}

function drawRow(ctx: Ctx, style: CardStyle, row: RowView, y: number): void
{
	const x = PAD;
	const width = WIDTH - PAD * 2;
	const centerY = y + ROW_H / 2;
	const medal = isMedalRank(row.rank) ? medalColor(row.rank) : null;
	const highlight = row.source.highlight === true;

	fillRoundedRect(ctx, x, y, width, ROW_H, 18, rgba(PALETTE.night, 0.55));
	if (highlight)
	{
		ctx.save();
		ctx.shadowColor = rgba(PALETTE.highlight, 0.6);
		ctx.shadowBlur = 16;
		fillRoundedRect(ctx, x, y, width, ROW_H, 18, linearGradient(ctx, x, 0, x + width, 0, [rgba(PALETTE.highlight, 0.24), rgba(PALETTE.highlight, 0.06)]));
		ctx.restore();
		strokeRoundedRect(ctx, x + 1, y + 1, width - 2, ROW_H - 2, 17, rgba(PALETTE.highlight, 0.9), 2);
	}
	else if (medal)
	{
		fillRoundedRect(ctx, x, y, width, ROW_H, 18, linearGradient(ctx, x, 0, x + width, 0, [rgba(medal, 0.2), rgba(medal, 0.03)]));
		strokeRoundedRect(ctx, x + 0.5, y + 0.5, width - 1, ROW_H - 1, 18, rgba(medal, 0.35), 1);
	}
	else
	{
		fillRoundedRect(ctx, x, y, width, ROW_H, 18, "rgba(255, 255, 255, 0.04)");
		strokeRoundedRect(ctx, x + 0.5, y + 0.5, width - 1, ROW_H - 1, 18, PALETTE.panelBorder, 1);
	}

	if (row.accent)
	{
		ctx.save();
		roundedRectPath(ctx, x, y, width, ROW_H, 18);
		ctx.clip();
		ctx.fillStyle = row.accent;
		ctx.fillRect(x, y, 6, ROW_H);
		ctx.restore();
	}

	drawRankLabel(ctx, row, x + 46, centerY);

	const avatarX = x + 110;
	const avatarR = 25;
	const tier = row.source.tier;
	const ringColor = avatarRingColor(style, row, medal);
	fillCircle(ctx, avatarX, centerY, avatarR + 4, rgba(ringColor, 0.25));
	drawAvatar(ctx, row.avatar, row.name, avatarX, centerY, avatarR, row.accent);
	strokeCircle(ctx, avatarX, centerY, avatarR + 2, ringColor, 2.5);

	const valueLeft = drawValue(ctx, row.value, x + width - 24, centerY + 9, medal ? mix(medal, "#ffffff", 0.45) : PALETTE.text);

	const textX = avatarX + avatarR + 20;
	const textMax = valueLeft - 24 - textX;
	const hasSecondLine = tier !== null || row.detail.length > 0;
	ctx.save();
	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";
	ctx.font = font(700, 23);
	ctx.fillStyle = PALETTE.text;
	ctx.fillText(fitText(ctx, row.name, textMax), textX, hasSecondLine ? centerY - 4 : centerY + 8);
	ctx.restore();

	if (!hasSecondLine) return;
	const secondY = centerY + 17;
	let cursor = textX;
	const pillMax = row.detail.length > 0 ? textMax - 70 : textMax;
	if (tier && pillMax >= 64)
	{
		cursor += drawTierPill(ctx, tier, cursor, secondY, 24, pillMax) + 10;
	}
	if (row.detail.length > 0)
	{
		ctx.save();
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.font = font(600, 16);
		ctx.fillStyle = PALETTE.textMuted;
		ctx.fillText(fitText(ctx, row.detail, textX + textMax - cursor), cursor, secondY + 1);
		ctx.restore();
	}
}

/** Bảng trống: khung lớn theo bộ, giữa là biểu tượng bậc cao nhất của bộ (phong cách trung tính thì là ngôi sao). */
function drawEmpty(ctx: Ctx, style: CardStyle, text: string): void
{
	const centerY = ROWS_TOP + EMPTY_H / 2 - 22;
	style.boardEmpty(ctx, WIDTH / 2, centerY, 62);
	if (style.key === null)
	{
		drawSparkle(ctx, WIDTH / 2, centerY, 16, "#e8e0ff", 0.9);
	}
	else
	{
		drawGlow(ctx, WIDTH / 2, centerY, 50, style.boardSoft, 0.3);
		drawTierEmblem(ctx, style.key, TOP_TIER_INDEX, WIDTH / 2, centerY, 50, style.boardSoft);
	}
	ctx.save();
	ctx.textAlign = "center";
	ctx.textBaseline = "alphabetic";
	ctx.font = font(700, 22);
	ctx.fillStyle = PALETTE.textSoft;
	ctx.fillText(fitText(ctx, text.length > 0 ? text : "Chưa có dữ liệu", WIDTH - PAD * 4), WIDTH / 2, centerY + 106);
	ctx.restore();
}

function drawFooter(ctx: Ctx, text: string, height: number): void
{
	if (text.length === 0) return;
	const baseline = height - 26;
	ctx.save();
	ctx.textAlign = "center";
	ctx.textBaseline = "alphabetic";
	ctx.font = font(600, 16);
	ctx.fillStyle = PALETTE.textMuted;
	const fitted = fitText(ctx, text, WIDTH - PAD * 4);
	ctx.fillText(fitted, WIDTH / 2, baseline);
	const half = ctx.measureText(fitted).width / 2;
	ctx.restore();
	for (const side of [-1, 1])
	{
		const cx = WIDTH / 2 + side * (half + 18);
		ctx.save();
		ctx.translate(cx, baseline - 6);
		ctx.rotate(Math.PI / 4);
		ctx.fillStyle = rgba(PALETTE.gold, 0.7);
		ctx.fillRect(-3, -3, 6, 6);
		ctx.restore();
	}
}

function toRowView(row: LeaderboardCardRow, avatar: Image | null): RowView
{
	const rank = Math.max(0, safeInt(row.rank));
	return {
		source: row,
		avatar,
		rank,
		name: cleanDisplayName(row.name),
		value: cleanText(row.value),
		detail: row.detail === null ? "" : cleanText(row.detail),
		accent: isHexColor(row.accentColor) ? row.accentColor : null,
	};
}

/**
 * Phong cách của bảng theo bộ danh hiệu của guild (`data.tierSet`), áp cho mọi bảng. Bộ hỏng (dữ liệu sửa tay) thì lấy bộ
 * của dòng đầu tiên có bậc hợp lệ; vẫn không có thì trung tính.
 */
export function boardStyle(data: Pick<LeaderboardCardData, "tierSet" | "rows">): CardStyle
{
	const byTierSet = cardStyle(data.tierSet?.key);
	if (byTierSet.key !== null) return byTierSet;
	const rows = Array.isArray(data.rows) ? data.rows : [];
	for (const row of rows)
	{
		const key = tierSetKeyOf(row?.tier);
		if (key) return cardStyle(key);
	}
	return cardStyle(null);
}

/** Vẽ ảnh bảng xếp hạng (tối đa 10 dòng). Không throw vì dữ liệu người dùng. */
export async function renderLeaderboardCard(data: LeaderboardCardData): Promise<RenderedCard>
{
	ensureFonts();
	const source = Array.isArray(data.rows) ? data.rows.slice(0, MAX_ROWS) : [];
	const avatars = await Promise.all(source.map(row => decodeAvatar(row.avatar)));
	const rows = source.map((row, index) => toRowView(row, avatars[index]));
	const height = cardHeight(rows.length);
	const seed = hashString(`${data.title}|${data.subtitle}`);
	const style = boardStyle({ tierSet: data.tierSet, rows: source });

	const canvas = createCanvas(WIDTH, height);
	const ctx = canvas.getContext("2d");
	roundedRectPath(ctx, 0, 0, WIDTH, height, CARD_RADIUS);
	ctx.clip();

	drawBackground(ctx, style, height, seed);
	drawHeader(ctx, style, data, seed);
	if (rows.length === 0) drawEmpty(ctx, style, cleanText(data.emptyText));
	rows.forEach((row, index) => drawRow(ctx, style, row, ROWS_TOP + index * (ROW_H + ROW_GAP)));
	drawFooter(ctx, cleanText(data.footer), height);
	strokeRoundedRect(ctx, 1, 1, WIDTH - 2, height - 2, CARD_RADIUS - 1, linearGradient(ctx, 0, 0, WIDTH, height, [rgba(PALETTE.gold, 0.55), rgba(style.boardAccent, 0.2), rgba(PALETTE.gold, 0.4)]), 2);

	const png = await canvas.encode("png");
	return { png, fileName: "leaderboard.png", width: WIDTH, height };
}
