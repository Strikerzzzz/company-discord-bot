import { createCanvas, Image } from "@napi-rs/canvas";
import { Tier } from "../../modules/activity/tiers";
import {
	clamp,
	cleanDisplayName,
	Ctx,
	decodeAvatar,
	drawAvatar,
	drawGlow,
	drawSpacedText,
	fillCircle,
	fillRoundedRect,
	fitFontSize,
	fitList,
	fitText,
	formatCount,
	hashString,
	linearGradient,
	measureSpaced,
	mix,
	mulberry32,
	rgba,
	roundedRectPath,
	safeInt,
	strokeRoundedRect,
	TAU,
} from "./draw";
import { ensureFonts, font } from "./fonts";
import { drawBadge, drawFlame, drawGroup, drawRising, drawSparkle, drawStar, drawTrophy } from "./icons";
import { CardStyle, cardStyle, RankScene } from "./styles";
import { CardTexts, cardTexts, drawTierPill, isTopTier, PALETTE, tierColors, tierIndex, tierName, tierSetKeyOf } from "./theme";
import { RankCardData, RenderedCard } from "./types";

/*
 * Ảnh thẻ /rank (DEC-030, DEC-033): avatar trong khung trang trí của bộ danh hiệu, tên, huy hiệu bậc, level, thanh tiến độ level
 * và 5 ô chỉ số. Màu và độ "phức tạp" của hoa văn đổi theo bậc; bậc cao nhất có hiệu ứng riêng của từng bộ và viền vàng.
 * Chữ mang giọng văn của bộ (bậc cao nhất, nhắc chuỗi ngày) lấy từ `tierSet.texts`.
 */

const WIDTH = 1000;
const HEIGHT = 460;
const CARD_RADIUS = 30;
const PAD = 30;
const RIGHT = WIDTH - PAD;
const AVATAR_X = 164;
const AVATAR_Y = 160;
const AVATAR_R = 84;
const FRAME_R = 126;
const INFO_X = 322;
const BAR_Y = 206;
const BAR_H = 26;
const TILES_Y = 298;
const TILE_H = 136;
const TILE_GAP = 10;
const GROUND_Y = 250;

interface TileLine
{
	text: string;
	color: string;
}

interface Tile
{
	label: string;
	/** Tỉ lệ độ rộng so với ô trung bình (ô chuỗi ngày rộng hơn để đủ chỗ cho dòng nhắc). */
	weight: number;
	accent: string;
	icon: (ctx: Ctx, x: number, y: number, size: number) => void;
	value: string;
	suffix: string;
	lines: TileLine[];
	beads?: { filled: number; total: number };
}

interface RankView
{
	name: string;
	tier: Tier;
	style: CardStyle;
	texts: CardTexts;
	colors: { color: string; from: string; to: string };
	complexity: number;
	top: boolean;
	nextTier: Tier | null;
	level: number;
	xpIntoLevel: number;
	xpForNextLevel: number;
	totalXp: number;
	ratio: number;
	teams: string[];
	tiles: Tile[];
	seed: number;
}

function rankOf(rank: number | null): number | null
{
	if (rank === null || !Number.isFinite(rank) || rank < 1) return null;
	return Math.trunc(rank);
}

function nonNegative(value: number): number
{
	return Math.max(0, safeInt(value));
}

/**
 * Dòng nhắc cuối ô chuỗi ngày: đang giữ chuỗi mà hôm nay chưa có tin được XP thì nhắc theo giọng văn của bộ (`texts.idleToday`);
 * đang lập kỷ lục thì chúc mừng; chưa có chuỗi thì gợi ý nhắn tin. Trả về null nếu không cần dòng nhắc.
 */
export function streakHint(current: number, best: number, activeToday: boolean, texts: CardTexts): TileLine | null
{
	if (current > 0 && !activeToday) return { text: texts.idleToday, color: PALETTE.warning };
	if (current > 1 && current >= best) return { text: "Đang lập kỷ lục!", color: PALETTE.gold };
	if (current === 0) return { text: "Nhắn tin để nhóm lửa", color: PALETTE.textMuted };
	return null;
}

function buildTiles(data: RankCardData, accent: string, texts: CardTexts): Tile[]
{
	const activityRank = rankOf(data.activity?.rank ?? null);
	const activityTotal = nonNegative(data.activity?.totalRanked ?? 0);
	const weeklyXp = nonNegative(data.activity?.weeklyXp ?? 0);
	const weeklyRank = rankOf(data.activity?.weeklyRank ?? null);
	const contributionRank = rankOf(data.contribution?.rank ?? null);
	const contributionTotal = nonNegative(data.contribution?.totalRanked ?? 0);
	const streak = nonNegative(data.streak?.current ?? 0);
	const best = Math.max(streak, nonNegative(data.streak?.best ?? 0));
	const activeToday = data.streak?.activeToday === true;
	const unlocked = nonNegative(data.achievements?.unlocked ?? 0);
	const totalAchievements = nonNegative(data.achievements?.total ?? 0);

	const activityLines: TileLine[] = [];
	if (activityRank === null)
	{
		activityLines.push({ text: "Chưa có hạng", color: PALETTE.textMuted });
	}
	else if (activityTotal >= activityRank)
	{
		const percent = clamp(Math.ceil((activityRank / activityTotal) * 100), 1, 100);
		activityLines.push({ text: `Top ${percent}% server`, color: accent });
	}

	const weeklyLine: TileLine = weeklyRank !== null
		? { text: `Hạng tuần #${formatCount(weeklyRank)}`, color: "#8be3ff" }
		: { text: weeklyXp > 0 ? "Chưa có hạng" : "Chưa có XP", color: PALETTE.textMuted };

	const contributionLines: TileLine[] = [
		contributionRank !== null
			? { text: `Hạng #${formatCount(contributionRank)}${contributionTotal >= contributionRank ? ` / ${formatCount(contributionTotal)}` : ""}`, color: "#ffb3cf" }
			: { text: "Chưa có hạng", color: PALETTE.textMuted },
		{ text: `${formatCount(nonNegative(data.contribution?.contributions ?? 0))} contribution`, color: PALETTE.textMuted },
	];

	const streakLines: TileLine[] = [];
	if (best > 0) streakLines.push({ text: `Kỷ lục ${formatCount(best)} ngày`, color: PALETTE.textSoft });
	const hint = streakHint(streak, best, activeToday, texts);
	if (hint) streakLines.push(hint);

	return [
		{
			label: "Hạng Activity",
			weight: 0.96,
			accent: PALETTE.gold,
			icon: (ctx, x, y, size) => drawTrophy(ctx, x, y, size, PALETTE.gold),
			value: activityRank === null ? "—" : `#${formatCount(activityRank)}`,
			suffix: activityRank !== null && activityTotal >= activityRank ? ` / ${formatCount(activityTotal)}` : "",
			lines: activityLines,
		},
		{
			label: "XP tuần này",
			weight: 0.96,
			accent: "#56d4f5",
			icon: (ctx, x, y, size) => drawRising(ctx, x, y, size, "#56d4f5"),
			value: weeklyXp > 0 ? `+${formatCount(weeklyXp)}` : "0",
			suffix: " XP",
			lines: [weeklyLine],
		},
		{
			label: "Contribution",
			weight: 0.98,
			accent: "#ff8fb8",
			icon: (ctx, x, y, size) => drawStar(ctx, x, y, size * 1.15, "#ff8fb8"),
			value: formatCount(safeInt(data.contribution?.score ?? 0)),
			suffix: " điểm",
			lines: contributionLines,
		},
		{
			label: "Chuỗi ngày",
			weight: 1.16,
			accent: "#ff9a3c",
			icon: (ctx, x, y, size) => drawFlame(ctx, x, y, size * 1.05, streak > 0),
			value: formatCount(streak),
			suffix: " ngày",
			lines: streakLines,
		},
		{
			label: "Huy hiệu",
			weight: 0.94,
			accent: "#b69cff",
			icon: (ctx, x, y, size) => drawBadge(ctx, x, y, size, "#b69cff"),
			value: formatCount(unlocked),
			suffix: totalAchievements > 0 ? ` / ${formatCount(totalAchievements)}` : "",
			lines: totalAchievements > 20 || totalAchievements === 0 ? [{ text: "đã mở khoá", color: PALETTE.textMuted }] : [],
			beads: totalAchievements > 0 && totalAchievements <= 20 ? { filled: Math.min(unlocked, totalAchievements), total: totalAchievements } : undefined,
		},
	];
}

function toView(data: RankCardData): RankView
{
	const name = cleanDisplayName(data.displayName);
	const colors = tierColors(data.tier);
	const texts = cardTexts(data.tierSet);
	const setKey = tierSetKeyOf(data.tier) ?? data.tierSet?.key ?? null;
	const xpIntoLevel = nonNegative(data.level?.xpIntoLevel ?? 0);
	const xpForNextLevel = nonNegative(data.level?.xpForNextLevel ?? 0);
	const teams = Array.isArray(data.teamNames)
		? data.teamNames.filter(team => typeof team === "string").map(team => cleanDisplayName(team)).filter(team => team !== "?")
		: [];
	return {
		name,
		tier: data.tier,
		style: cardStyle(setKey),
		texts,
		colors,
		complexity: tierIndex(data.tier),
		top: isTopTier(data.tier) || data.nextTier === null,
		nextTier: data.nextTier,
		level: nonNegative(data.level?.level ?? 0),
		xpIntoLevel,
		xpForNextLevel,
		totalXp: nonNegative(data.level?.totalXp ?? 0),
		ratio: xpForNextLevel > 0 ? clamp(xpIntoLevel / xpForNextLevel, 0, 1) : 0,
		teams,
		tiles: buildTiles(data, colors.color, texts),
		seed: hashString(`${name}|${setKey ?? "?"}|${data.tier?.key}`),
	};
}

function toScene(view: RankView): RankScene
{
	return {
		rand: mulberry32(view.seed),
		width: WIDTH,
		height: HEIGHT,
		colors: view.colors,
		complexity: view.complexity,
		top: view.top,
		avatarX: AVATAR_X,
		avatarY: AVATAR_Y,
		frameRadius: FRAME_R,
		textAreas: [
			{ x: RIGHT - 170, y: 36, width: 170, height: 34 },
			{ x: INFO_X - 10, y: 100, width: RIGHT - INFO_X + 10, height: 180 },
			{ x: PAD, y: TILES_Y, width: RIGHT - PAD, height: TILE_H },
		],
		groundY: GROUND_Y,
	};
}

function drawBackground(ctx: Ctx, view: RankView, scene: RankScene): void
{
	const { color, from, to } = view.colors;
	ctx.fillStyle = linearGradient(ctx, 0, 0, WIDTH, HEIGHT, [mix(from, PALETTE.night, 0.62), PALETTE.night, mix(to, PALETTE.nightSoft, 0.86)]);
	ctx.fillRect(0, 0, WIDTH, HEIGHT);
	drawGlow(ctx, AVATAR_X, AVATAR_Y, 420, color, 0.3);
	drawGlow(ctx, WIDTH - 120, 40, 380, to, 0.16);
	view.style.rankBackground(ctx, scene);
}

function drawCardBorder(ctx: Ctx, view: RankView): void
{
	if (view.top)
	{
		const { primary, secondary, light } = view.style.top;
		strokeRoundedRect(ctx, 2, 2, WIDTH - 4, HEIGHT - 4, CARD_RADIUS - 2, linearGradient(ctx, 0, 0, WIDTH, HEIGHT, [light, primary, secondary, primary, light]), 4);
		strokeRoundedRect(ctx, 9, 9, WIDTH - 18, HEIGHT - 18, CARD_RADIUS - 8, rgba(primary, 0.35), 1);
		view.style.corners(ctx, WIDTH, HEIGHT);
		return;
	}
	strokeRoundedRect(ctx, 1, 1, WIDTH - 2, HEIGHT - 2, CARD_RADIUS - 1, linearGradient(ctx, 0, 0, WIDTH, HEIGHT, [rgba(view.colors.to, 0.55), rgba(view.colors.color, 0.12), rgba(view.colors.to, 0.4)]), 2);
}

function drawAvatarBlock(ctx: Ctx, view: RankView, scene: RankScene, avatar: Image | null): void
{
	const { color, from, to } = view.colors;
	drawGlow(ctx, AVATAR_X, AVATAR_Y, FRAME_R + 30, color, 0.35);
	view.style.rankFrame(ctx, scene);

	ctx.save();
	ctx.shadowColor = rgba(color, 0.85);
	ctx.shadowBlur = 26;
	fillCircle(ctx, AVATAR_X, AVATAR_Y, AVATAR_R + 8, PALETTE.night);
	ctx.restore();

	const ring = ctx.createConicGradient(-Math.PI / 2, AVATAR_X, AVATAR_Y);
	ring.addColorStop(0, to);
	ring.addColorStop(0.35, from);
	ring.addColorStop(0.65, color);
	ring.addColorStop(1, to);
	ctx.save();
	ctx.beginPath();
	ctx.arc(AVATAR_X, AVATAR_Y, AVATAR_R + 5, 0, TAU);
	ctx.strokeStyle = ring;
	ctx.lineWidth = 7;
	ctx.stroke();
	ctx.restore();

	drawAvatar(ctx, avatar, view.name, AVATAR_X, AVATAR_Y, AVATAR_R);
	view.style.rankFront(ctx, scene);
}

function drawHeader(ctx: Ctx, view: RankView): void
{
	const { color } = view.colors;

	const levelText = formatCount(view.level);
	ctx.font = font(700, 17);
	const labelWidth = measureSpaced(ctx, "LEVEL", 4);
	const levelSize = fitFontSize(ctx, levelText, 800, 84, 36, 250);
	const levelWidth = ctx.measureText(levelText).width;
	const blockWidth = Math.max(labelWidth, levelWidth);
	const levelLeft = RIGHT - blockWidth;

	ctx.save();
	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";
	ctx.font = font(700, 17);
	ctx.fillStyle = PALETTE.textMuted;
	drawSpacedText(ctx, "LEVEL", RIGHT - labelWidth, 62, 4);
	ctx.font = font(800, levelSize);
	ctx.shadowColor = rgba(color, 0.7);
	ctx.shadowBlur = 22;
	ctx.fillStyle = linearGradient(ctx, 0, 134 - levelSize * 0.75, 0, 134, ["#ffffff", mix(color, "#ffffff", 0.2)]);
	ctx.fillText(levelText, RIGHT - levelWidth, 134);
	ctx.restore();

	const textRight = levelLeft - 28;
	ctx.save();
	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";
	ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
	ctx.shadowBlur = 8;
	fitFontSize(ctx, view.name, 800, 44, 32, textRight - INFO_X);
	const name = fitText(ctx, view.name, textRight - INFO_X);
	const nameWidth = Math.max(1, ctx.measureText(name).width);
	const top = view.style.top;
	ctx.fillStyle = view.top ? linearGradient(ctx, INFO_X, 0, INFO_X + nameWidth, 0, [mix(top.light, "#ffffff", 0.4), top.primary, mix(top.light, "#ffffff", 0.4)]) : PALETTE.text;
	ctx.fillText(name, INFO_X, 86);
	ctx.restore();

	const pillHeight = 38;
	const pillCenter = 124;
	const pillWidth = drawTierPill(ctx, view.tier, INFO_X, pillCenter, pillHeight, textRight - INFO_X);

	const teamX = INFO_X + pillWidth + 18;
	const teamMax = textRight - teamX - 26;
	if (teamMax > 40)
	{
		ctx.save();
		ctx.font = font(600, 19);
		ctx.textBaseline = "middle";
		const teamText = view.teams.length > 0 ? fitList(ctx, view.teams, teamMax) : "Chưa thuộc team";
		drawGroup(ctx, teamX + 10, pillCenter, 20, view.teams.length > 0 ? PALETTE.textSoft : PALETTE.textMuted);
		ctx.fillStyle = view.teams.length > 0 ? PALETTE.textSoft : PALETTE.textMuted;
		ctx.fillText(teamText, teamX + 28, pillCenter + 1);
		ctx.restore();
	}
}

function drawProgress(ctx: Ctx, view: RankView): void
{
	const { color, from, to } = view.colors;
	const barWidth = RIGHT - INFO_X;

	ctx.save();
	ctx.textBaseline = "alphabetic";
	ctx.textAlign = "left";
	const current = formatCount(view.xpIntoLevel);
	ctx.font = font(800, 22);
	ctx.fillStyle = PALETTE.text;
	ctx.fillText(current, INFO_X, 192);
	const currentWidth = ctx.measureText(current).width;
	ctx.font = font(600, 19);
	ctx.fillStyle = PALETTE.textSoft;
	ctx.fillText(` / ${formatCount(view.xpForNextLevel)} XP`, INFO_X + currentWidth, 192);

	const totalValue = `${formatCount(view.totalXp)} XP`;
	ctx.font = font(700, 19);
	const totalWidth = ctx.measureText(totalValue).width;
	ctx.fillStyle = PALETTE.text;
	ctx.fillText(totalValue, RIGHT - totalWidth, 192);
	ctx.font = font(400, 18);
	ctx.fillStyle = PALETTE.textMuted;
	const totalLabel = "Tổng ";
	ctx.fillText(totalLabel, RIGHT - totalWidth - ctx.measureText(totalLabel).width, 192);
	ctx.restore();

	fillRoundedRect(ctx, INFO_X, BAR_Y, barWidth, BAR_H, BAR_H / 2, "rgba(255, 255, 255, 0.07)");
	ctx.save();
	roundedRectPath(ctx, INFO_X, BAR_Y, barWidth, BAR_H, BAR_H / 2);
	ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
	ctx.lineWidth = 1;
	ctx.stroke();
	ctx.restore();

	if (view.ratio > 0)
	{
		const fillWidth = Math.max(BAR_H, barWidth * view.ratio);
		ctx.save();
		ctx.shadowColor = rgba(color, 0.8);
		ctx.shadowBlur = 18;
		fillRoundedRect(ctx, INFO_X, BAR_Y, fillWidth, BAR_H, BAR_H / 2, linearGradient(ctx, INFO_X, 0, INFO_X + fillWidth, 0, [from, color, to]));
		ctx.restore();

		ctx.save();
		roundedRectPath(ctx, INFO_X, BAR_Y, fillWidth, BAR_H, BAR_H / 2);
		ctx.clip();
		ctx.fillStyle = linearGradient(ctx, 0, BAR_Y, 0, BAR_Y + BAR_H, ["rgba(255, 255, 255, 0.35)", "rgba(255, 255, 255, 0.05)", "rgba(0, 0, 0, 0.12)"]);
		ctx.fillRect(INFO_X, BAR_Y, fillWidth, BAR_H);
		ctx.strokeStyle = "rgba(10, 13, 27, 0.25)";
		ctx.lineWidth = 2;
		for (let step = 1; step < 20; step++)
		{
			const x = INFO_X + (barWidth * step) / 20;
			ctx.beginPath();
			ctx.moveTo(x, BAR_Y);
			ctx.lineTo(x, BAR_Y + BAR_H);
			ctx.stroke();
		}
		ctx.restore();

		const headX = INFO_X + fillWidth - BAR_H / 2;
		drawGlow(ctx, headX, BAR_Y + BAR_H / 2, 26, "#ffffff", 0.5);
		drawSparkle(ctx, headX, BAR_Y + BAR_H / 2, 11, "#ffffff", 0.95);
	}

	ctx.save();
	ctx.textBaseline = "alphabetic";
	ctx.textAlign = "left";
	const lineY = 266;
	const percent = `${Math.floor(view.ratio * 100)}%`;
	ctx.font = font(800, 19);
	const percentWidth = ctx.measureText(percent).width;
	const lineMax = RIGHT - percentWidth - 24 - INFO_X;
	if (view.top || view.nextTier === null)
	{
		const accent = view.style.top.primary;
		ctx.font = font(700, 19);
		ctx.fillStyle = accent;
		drawSparkle(ctx, INFO_X + 8, lineY - 7, 8, accent);
		ctx.fillText(fitText(ctx, view.texts.maxTier, lineMax - 24), INFO_X + 24, lineY);
	}
	else
	{
		const next = view.nextTier;
		const nextColors = tierColors(next);
		const remaining = Math.max(1, safeInt(next.minLevel) - view.level);
		const prefix = `Còn ${formatCount(remaining)} level nữa lên ${view.texts.tierLabel.toLocaleLowerCase("vi")} `;
		ctx.font = font(600, 19);
		ctx.fillStyle = PALETTE.textSoft;
		const fittedPrefix = fitText(ctx, prefix, lineMax * 0.7);
		ctx.fillText(fittedPrefix, INFO_X, lineY);
		const prefixWidth = ctx.measureText(fittedPrefix).width;
		ctx.font = font(800, 19);
		ctx.fillStyle = mix(nextColors.color, "#ffffff", 0.25);
		ctx.fillText(fitText(ctx, tierName(next), lineMax - prefixWidth), INFO_X + prefixWidth, lineY);
	}

	ctx.font = font(800, 19);
	ctx.fillStyle = mix(color, "#ffffff", 0.3);
	ctx.fillText(percent, RIGHT - percentWidth, lineY);
	ctx.restore();
}

function drawBeads(ctx: Ctx, x: number, y: number, width: number, filled: number, total: number, color: string): void
{
	const pitch = Math.min(14, width / total);
	const radius = Math.min(4.2, pitch * 0.34);
	for (let index = 0; index < total; index++)
	{
		const cx = x + pitch * index + pitch / 2;
		if (index < filled)
		{
			drawGlow(ctx, cx, y, radius * 2.6, color, 0.45);
			ctx.save();
			ctx.translate(cx, y);
			ctx.rotate(Math.PI / 4);
			ctx.fillStyle = mix(color, "#ffffff", 0.25);
			ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
			ctx.restore();
		}
		else
		{
			ctx.save();
			ctx.translate(cx, y);
			ctx.rotate(Math.PI / 4);
			ctx.strokeStyle = rgba(color, 0.45);
			ctx.lineWidth = 1.2;
			ctx.strokeRect(-radius * 0.8, -radius * 0.8, radius * 1.6, radius * 1.6);
			ctx.restore();
		}
	}
}

function drawTile(ctx: Ctx, tile: Tile, x: number, y: number, width: number): void
{
	const padding = 15;
	const inner = width - padding * 2;
	fillRoundedRect(ctx, x, y, width, TILE_H, 18, rgba(PALETTE.night, 0.5));
	fillRoundedRect(ctx, x, y, width, TILE_H, 18, linearGradient(ctx, x, y, x, y + TILE_H, [rgba(tile.accent, 0.09), "rgba(255, 255, 255, 0.025)"]));
	strokeRoundedRect(ctx, x + 0.5, y + 0.5, width - 1, TILE_H - 1, 18, PALETTE.panelBorder, 1);
	fillRoundedRect(ctx, x + 18, y, width - 36, 2, 1, linearGradient(ctx, x + 18, y, x + width - 18, y, [rgba(tile.accent, 0), rgba(tile.accent, 0.85), rgba(tile.accent, 0)]));

	const iconX = x + padding + 13;
	const iconY = y + 29;
	fillCircle(ctx, iconX, iconY, 14, rgba(tile.accent, 0.16));
	tile.icon(ctx, iconX, iconY, 17);

	ctx.save();
	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";
	ctx.font = font(700, 15);
	ctx.fillStyle = PALETTE.textSoft;
	const labelX = iconX + 22;
	ctx.fillText(fitText(ctx, tile.label, x + width - padding - labelX), labelX, y + 34);

	ctx.font = font(700, 19);
	const suffixWidth = tile.suffix.length > 0 ? ctx.measureText(tile.suffix).width : 0;
	const valueSize = fitFontSize(ctx, tile.value, 800, 34, 20, Math.max(40, inner - suffixWidth));
	const value = fitText(ctx, tile.value, inner);
	ctx.fillStyle = PALETTE.text;
	ctx.fillText(value, x + padding, y + 82);
	const valueWidth = ctx.measureText(value).width;
	if (suffixWidth > 0)
	{
		ctx.font = font(700, Math.min(19, Math.round(valueSize * 0.6)));
		if (valueWidth + ctx.measureText(tile.suffix).width <= inner)
		{
			ctx.fillStyle = PALETTE.textSoft;
			ctx.fillText(tile.suffix, x + padding + valueWidth, y + 82);
		}
	}

	tile.lines.slice(0, 2).forEach((line, index) =>
	{
		fitFontSize(ctx, line.text, 600, 15, 13, inner);
		ctx.fillStyle = line.color;
		ctx.fillText(fitText(ctx, line.text, inner), x + padding, y + 106 + index * 20);
	});
	ctx.restore();

	if (tile.beads) drawBeads(ctx, x + padding - 2, y + 108, inner + 4, tile.beads.filled, tile.beads.total, tile.accent);
}

function drawTiles(ctx: Ctx, view: RankView): void
{
	const totalWeight = view.tiles.reduce((sum, tile) => sum + tile.weight, 0);
	const available = RIGHT - PAD - TILE_GAP * (view.tiles.length - 1);
	let x = PAD;
	for (const tile of view.tiles)
	{
		const width = (available * tile.weight) / totalWeight;
		drawTile(ctx, tile, x, TILES_Y, width);
		x += width + TILE_GAP;
	}
}

/** Vẽ ảnh thẻ rank. Không throw vì dữ liệu người dùng (tên lạ, avatar hỏng, số lớn, hạng null, bộ hoặc bậc lạ...). */
export async function renderRankCard(data: RankCardData): Promise<RenderedCard>
{
	ensureFonts();
	const avatar = await decodeAvatar(data.avatar);
	const view = toView(data);
	const scene = toScene(view);

	const canvas = createCanvas(WIDTH, HEIGHT);
	const ctx = canvas.getContext("2d");
	roundedRectPath(ctx, 0, 0, WIDTH, HEIGHT, CARD_RADIUS);
	ctx.clip();

	drawBackground(ctx, view, scene);
	drawAvatarBlock(ctx, view, scene, avatar);
	drawHeader(ctx, view);
	drawProgress(ctx, view);
	drawTiles(ctx, view);
	drawCardBorder(ctx, view);

	const png = await canvas.encode("png");
	return { png, fileName: "rank.png", width: WIDTH, height: HEIGHT };
}
