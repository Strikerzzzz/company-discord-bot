import { isTierSetKey, TierSetKey } from "../../modules/activity/tiers";
import {
	Area,
	drawBeams,
	drawBirds,
	drawEllipseGlow,
	drawFallingLeaves,
	drawFireflies,
	drawFormation,
	drawGalaxy,
	drawHexGrid,
	drawHills,
	drawHorizon,
	drawInkMountains,
	drawLensFlare,
	drawLightning,
	drawMoon,
	drawMountains,
	drawNebula,
	drawPetals,
	drawQiStreams,
	drawRidges,
	drawSeal,
	drawShootingStar,
	drawSlash,
	drawSparks,
	drawStarfield,
	drawSunburst,
} from "./decor";
import { Ctx, drawGlow, fillCircle, mix, Random, rgba, strokeCircle } from "./draw";
import { drawCloudCurl, drawLeaf, drawPlanet, drawSparkle } from "./icons";
import { drawEnsoFrame, drawHexCrest, drawOrbitFrame, drawVineWreath, FrameOptions } from "./frames";
import { PALETTE } from "./theme";

/*
 * Phong cách ảnh thẻ theo bộ danh hiệu (DEC-033): hoa văn nền, khung quanh avatar, hiệu ứng bậc cao nhất, góc viền,
 * nền và khung cúp của bảng xếp hạng. Bộ lạ dùng phong cách trung tính (nền núi đêm, vòng vạch chia, không hoa văn riêng).
 */

export interface TopColors
{
	/** Màu nhấn chính của bậc cao nhất (viền, tên, hào quang). */
	primary: string;
	secondary: string;
	light: string;
}

/** Bối cảnh vẽ của thẻ rank, do rankCard chuẩn bị. */
export interface RankScene
{
	rand: Random;
	width: number;
	height: number;
	colors: { color: string; from: string; to: string };
	/** Vị trí bậc 0..7. */
	complexity: number;
	top: boolean;
	avatarX: number;
	avatarY: number;
	frameRadius: number;
	/** Vùng có chữ nhỏ; hạt trang trí tránh ra. */
	textAreas: readonly Area[];
	/** Mép trên của dải núi/đồi phía dưới thẻ. */
	groundY: number;
}

export interface CardStyle
{
	/** Bộ danh hiệu; null = phong cách trung tính. */
	key: TierSetKey | null;
	top: TopColors;
	/** Màu phụ của viền và quầng sáng trên bảng xếp hạng. */
	boardAccent: string;
	/** Hoa văn nền thẻ rank (trên lớp gradient chung), gồm hiệu ứng nền của bậc cao nhất. */
	rankBackground(ctx: Ctx, scene: RankScene): void;
	/** Khung quanh avatar (vẽ trước avatar), gồm hào quang của bậc cao nhất. */
	rankFrame(ctx: Ctx, scene: RankScene): void;
	/** Trang trí vẽ đè lên avatar (ví dụ ấn triện); có thể không làm gì. */
	rankFront(ctx: Ctx, scene: RankScene): void;
	/** Trang trí bốn góc viền thẻ ở bậc cao nhất. */
	corners(ctx: Ctx, width: number, height: number): void;
	/** Nền ảnh bảng xếp hạng (trên lớp gradient chung); `avoid` là vùng chữ. */
	boardBackground(ctx: Ctx, rand: Random, width: number, height: number, avoid: readonly Area[]): void;
	/** Khung nhỏ quanh cúp ở đầu bảng xếp hạng. */
	boardRing(ctx: Ctx, x: number, y: number, radius: number, seed: number): void;
}

const GOLD_TOP: TopColors = { primary: PALETTE.gold, secondary: "#b388ff", light: "#fff3b0" };

function frameOptions(scene: RankScene, accent: string): FrameOptions
{
	return { color: mix(scene.colors.color, "#ffffff", 0.2), accent, complexity: scene.complexity, detailed: true };
}

function full(scene: RankScene): Area
{
	return { x: 0, y: 0, width: scene.width, height: scene.height };
}

function ground(scene: RankScene): Area
{
	return { x: 0, y: scene.groundY, width: scene.width, height: scene.height - scene.groundY };
}

function nothing(): void
{
	return;
}

function sparkleCorners(ctx: Ctx, width: number, height: number, color: string): void
{
	const corners: [number, number][] = [[22, 22], [width - 22, 22], [22, height - 22], [width - 22, height - 22]];
	for (const [x, y] of corners) drawSparkle(ctx, x, y, 8, color);
}

function nightMountains(ctx: Ctx, rand: Random, area: Area, from: string): void
{
	drawMountains(ctx, rand, area, [
		{ color: rgba(mix(from, "#ffffff", 0.15), 0.13), ridge: 0.3, amplitude: 60 },
		{ color: rgba(mix(from, PALETTE.night, 0.5), 0.35), ridge: 0.52, amplitude: 55 },
		{ color: rgba(PALETTE.night, 0.55), ridge: 0.75, amplitude: 40 },
	]);
}

function tuTienRankBackground(ctx: Ctx, scene: RankScene, lightning: boolean): void
{
	const { rand, colors, complexity } = scene;
	drawQiStreams(ctx, rand, { x: 0, y: 20, width: scene.width, height: 250 }, 4 + Math.floor(complexity / 2), colors.to, 0.11);
	nightMountains(ctx, rand, ground(scene), colors.from);
	drawStarfield(ctx, rand, full(scene), 60 + complexity * 14, ["#ffffff", colors.color, colors.to], scene.textAreas);
	if (scene.top && lightning)
	{
		drawLightning(ctx, rand, 318, -10, 268, 64, "#b388ff", 2.2);
		drawLightning(ctx, rand, 760, -10, 812, 36, PALETTE.gold, 1.8);
	}
}

function tuTienBoardBackground(ctx: Ctx, rand: Random, width: number, height: number, avoid: readonly Area[]): void
{
	drawGlow(ctx, 72, 70, 340, PALETTE.gold, 0.2);
	drawGlow(ctx, width - 80, 20, 360, "#7c4dff", 0.18);
	drawGlow(ctx, width / 2, height + 60, 520, "#3949ab", 0.2);
	drawQiStreams(ctx, rand, { x: 0, y: 10, width, height: 130 }, 4, PALETTE.gold, 0.1);
	drawMountains(ctx, rand, { x: 0, y: 40, width, height: 100 }, [
		{ color: "rgba(124, 77, 255, 0.07)", ridge: 0.45, amplitude: 50 },
		{ color: "rgba(10, 13, 27, 0.35)", ridge: 0.75, amplitude: 35 },
	]);
	drawMountains(ctx, rand, { x: 0, y: height - 160, width, height: 160 }, [
		{ color: "rgba(124, 77, 255, 0.06)", ridge: 0.3, amplitude: 60 },
		{ color: "rgba(57, 73, 171, 0.08)", ridge: 0.55, amplitude: 45 },
	]);
	drawStarfield(ctx, rand, { x: 0, y: 0, width, height }, Math.round(height / 7), ["#ffffff", PALETTE.gold, "#b39ddb"], avoid);
}

const TU_TIEN_STYLE: CardStyle = {
	key: "tu-tien",
	top: GOLD_TOP,
	boardAccent: "#7c4dff",
	rankBackground: (ctx, scene) => tuTienRankBackground(ctx, scene, true),
	rankFrame: (ctx, scene) =>
	{
		if (scene.top) drawSunburst(ctx, scene.avatarX, scene.avatarY, scene.frameRadius + 70, PALETTE.gold, 0.2, 24);
		drawFormation(ctx, scene.avatarX, scene.avatarY, scene.frameRadius, mix(scene.colors.color, "#ffffff", 0.2), scene.complexity);
	},
	rankFront: nothing,
	corners: (ctx, width, height) => sparkleCorners(ctx, width, height, GOLD_TOP.light),
	boardBackground: tuTienBoardBackground,
	boardRing: (ctx, x, y, radius, seed) => drawFormation(ctx, x, y, radius, PALETTE.gold, 2 + (seed % 2)),
};

const NEUTRAL_STYLE: CardStyle = {
	key: null,
	top: GOLD_TOP,
	boardAccent: "#7c4dff",
	rankBackground: (ctx, scene) => tuTienRankBackground(ctx, scene, false),
	rankFrame: (ctx, scene) =>
	{
		if (scene.top) drawSunburst(ctx, scene.avatarX, scene.avatarY, scene.frameRadius + 70, PALETTE.gold, 0.2, 24);
		drawFormation(ctx, scene.avatarX, scene.avatarY, scene.frameRadius, mix(scene.colors.color, "#ffffff", 0.2), Math.min(1, scene.complexity));
	},
	rankFront: nothing,
	corners: (ctx, width, height) => sparkleCorners(ctx, width, height, GOLD_TOP.light),
	boardBackground: tuTienBoardBackground,
	boardRing: (ctx, x, y, radius) => drawFormation(ctx, x, y, radius, PALETTE.gold, 1),
};

const RANK_TOP: TopColors = { primary: "#ffd166", secondary: "#ff5252", light: "#fff3b0" };

function arenaGrid(ctx: Ctx, x: number, y: number, width: number, height: number, color: string, strength: number): void
{
	const fade = ctx.createRadialGradient(x, y, 30, x, y, Math.max(width, height) * 0.65);
	fade.addColorStop(0, rgba(color, 0.2 * strength));
	fade.addColorStop(0.45, rgba(color, 0.07 * strength));
	fade.addColorStop(1, rgba(color, 0.02 * strength));
	drawHexGrid(ctx, { x: 0, y: 0, width, height }, 24, fade, 1);
}

function bracketCorners(ctx: Ctx, width: number, height: number, colors: TopColors): void
{
	const inset = 14;
	const arm = 30;
	const corners: [number, number, number, number][] = [[inset, inset, 1, 1], [width - inset, inset, -1, 1], [inset, height - inset, 1, -1], [width - inset, height - inset, -1, -1]];
	ctx.save();
	ctx.lineCap = "square";
	ctx.lineJoin = "miter";
	for (const [x, y, sx, sy] of corners)
	{
		ctx.strokeStyle = colors.primary;
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.moveTo(x, y + sy * arm);
		ctx.lineTo(x, y);
		ctx.lineTo(x + sx * arm, y);
		ctx.stroke();
		ctx.fillStyle = colors.secondary;
		ctx.beginPath();
		ctx.moveTo(x + sx * 10, y + sy * 5);
		ctx.lineTo(x + sx * 15, y + sy * 10);
		ctx.lineTo(x + sx * 10, y + sy * 15);
		ctx.lineTo(x + sx * 5, y + sy * 10);
		ctx.closePath();
		ctx.fill();
	}
	ctx.restore();
}

const RANK_GAME_STYLE: CardStyle = {
	key: "rank-game",
	top: RANK_TOP,
	boardAccent: "#ef4444",
	rankBackground: (ctx, scene) =>
	{
		const { rand, colors, complexity } = scene;
		arenaGrid(ctx, scene.avatarX, scene.avatarY, scene.width, scene.height, colors.to, 1);
		drawBeams(ctx, rand, { x: 260, y: 0, width: scene.width - 260, height: 300 }, 3 + Math.floor(complexity / 3), scene.top ? RANK_TOP.primary : colors.to, scene.top ? 0.1 : 0.07);
		drawRidges(ctx, rand, ground(scene), [
			{ color: rgba(mix(colors.from, "#ffffff", 0.15), 0.13), ridge: 0.32, amplitude: 58 },
			{ color: rgba(mix(colors.from, PALETTE.night, 0.5), 0.38), ridge: 0.55, amplitude: 50 },
			{ color: rgba(PALETTE.night, 0.6), ridge: 0.78, amplitude: 36 },
		]);
		drawSparks(ctx, rand, full(scene), 40 + complexity * 10, ["#ffffff", colors.color, colors.to], scene.textAreas);
	},
	rankFrame: (ctx, scene) =>
	{
		if (scene.top)
		{
			drawSunburst(ctx, scene.avatarX, scene.avatarY, scene.frameRadius + 96, RANK_TOP.primary, 0.24, 16, 0, 0.32);
			drawSunburst(ctx, scene.avatarX, scene.avatarY, scene.frameRadius + 70, RANK_TOP.secondary, 0.16, 16, Math.PI / 16, 0.28);
		}
		drawHexCrest(ctx, scene.avatarX, scene.avatarY, scene.frameRadius, frameOptions(scene, RANK_TOP.primary));
	},
	rankFront: nothing,
	corners: (ctx, width, height) => bracketCorners(ctx, width, height, RANK_TOP),
	boardBackground: (ctx, rand, width, height, avoid) =>
	{
		drawGlow(ctx, 72, 70, 340, PALETTE.gold, 0.2);
		drawGlow(ctx, width - 80, 20, 380, "#ef4444", 0.16);
		drawGlow(ctx, width / 2, height + 60, 520, "#1d4ed8", 0.22);
		arenaGrid(ctx, 72, 70, width, height, "#93c5fd", 0.8);
		drawBeams(ctx, rand, { x: 200, y: 0, width: width - 200, height: 150 }, 4, PALETTE.gold, 0.07);
		drawRidges(ctx, rand, { x: 0, y: height - 150, width, height: 150 }, [
			{ color: "rgba(239, 68, 68, 0.06)", ridge: 0.3, amplitude: 60 },
			{ color: "rgba(29, 78, 216, 0.09)", ridge: 0.55, amplitude: 45 },
		]);
		drawSparks(ctx, rand, { x: 0, y: 0, width, height }, Math.round(height / 8), ["#ffffff", PALETTE.gold, "#93c5fd"], avoid);
	},
	boardRing: (ctx, x, y, radius) => drawHexCrest(ctx, x, y, radius, { color: PALETTE.gold, accent: PALETTE.gold, complexity: 4, detailed: false }),
};

const KIEM_TOP: TopColors = { primary: "#f5c451", secondary: "#e53935", light: "#fff1c1" };
const PETALS = ["#f9a8d4", "#fbcfe8", "#ffffff"];

function slashes(ctx: Ctx, color: string): void
{
	drawSlash(ctx, 318, 40, 812, 4, -24, 7, color);
	drawSlash(ctx, 360, 6, 700, 44, 16, 4.5, color);
}

function cloudCorners(ctx: Ctx, width: number, height: number, colors: TopColors): void
{
	const corners: [number, number, number][] = [[34, 26, 1], [width - 34, 26, -1], [34, height - 24, 1], [width - 34, height - 24, -1]];
	for (const [x, y, flip] of corners) drawCloudCurl(ctx, x, y, 34, colors.primary, 2.4, flip);
}

const KIEM_HIEP_STYLE: CardStyle = {
	key: "kiem-hiep",
	top: KIEM_TOP,
	boardAccent: "#dc2626",
	rankBackground: (ctx, scene) =>
	{
		const { rand, colors, complexity } = scene;
		drawMoon(ctx, 846, 32, 20, mix(colors.to, "#fff4dc", 0.75), 0.34);
		drawBirds(ctx, rand, 776, 40, 4, 70, rgba("#e8e2d0", 0.35));
		drawStarfield(ctx, rand, full(scene), 22, ["#ffffff", colors.to], scene.textAreas);
		drawInkMountains(ctx, rand, { x: 0, y: scene.groundY - 60, width: scene.width, height: scene.height - scene.groundY + 60 }, [
			{ color: mix(colors.from, "#ffffff", 0.45), base: 0.45, height: 120, alpha: 0.13 },
			{ color: mix(colors.from, PALETTE.night, 0.25), base: 0.62, height: 96, alpha: 0.32 },
			{ color: PALETTE.night, base: 0.85, height: 70, alpha: 0.6 },
		]);
		drawEllipseGlow(ctx, scene.width / 2, scene.groundY + 30, scene.width * 0.6, 0.1, "#ffffff", 0.06);
		drawPetals(ctx, rand, full(scene), 24 + complexity * 5, [...PETALS, mix(colors.to, "#ffffff", 0.4)], scene.textAreas);
		if (scene.top) slashes(ctx, KIEM_TOP.primary);
	},
	rankFrame: (ctx, scene) =>
	{
		if (scene.top) drawSunburst(ctx, scene.avatarX, scene.avatarY, scene.frameRadius + 84, KIEM_TOP.primary, 0.16, 36, 0, 0.5);
		drawEnsoFrame(ctx, scene.avatarX, scene.avatarY, scene.frameRadius, frameOptions(scene, KIEM_TOP.primary));
	},
	rankFront: (ctx, scene) =>
	{
		if (scene.top) drawSeal(ctx, scene.avatarX + scene.frameRadius * 0.7, scene.avatarY + scene.frameRadius * 0.66, 34, KIEM_TOP.secondary, -0.14);
	},
	corners: (ctx, width, height) => cloudCorners(ctx, width, height, KIEM_TOP),
	boardBackground: (ctx, rand, width, height, avoid) =>
	{
		drawGlow(ctx, 72, 70, 340, PALETTE.gold, 0.2);
		drawGlow(ctx, width - 80, 20, 360, "#dc2626", 0.14);
		drawGlow(ctx, width / 2, height + 60, 520, "#7c2d12", 0.22);
		drawMoon(ctx, width - 110, 62, 34, "#fff1c1", 0.2);
		drawBirds(ctx, rand, width - 190, 50, 4, 90, rgba("#e8e2d0", 0.3));
		drawInkMountains(ctx, rand, { x: 0, y: 40, width, height: 100 }, [
			{ color: "#f5c451", base: 0.7, height: 70, alpha: 0.06 },
			{ color: PALETTE.night, base: 0.95, height: 45, alpha: 0.4 },
		]);
		drawInkMountains(ctx, rand, { x: 0, y: height - 170, width, height: 170 }, [
			{ color: "#e8e2d0", base: 0.5, height: 110, alpha: 0.06 },
			{ color: "#7c2d12", base: 0.75, height: 80, alpha: 0.14 },
		]);
		drawPetals(ctx, rand, { x: 0, y: 0, width, height }, Math.round(height / 14), PETALS, avoid);
	},
	boardRing: (ctx, x, y, radius) => drawEnsoFrame(ctx, x, y, radius, { color: PALETTE.gold, accent: PALETTE.gold, complexity: 4, detailed: false }),
};

const CAY_TOP: TopColors = { primary: "#ffd54f", secondary: "#66bb6a", light: "#fff8d6" };
const LEAVES = ["#6fcf73", "#a3e635", "#34d399"];

function leafCorners(ctx: Ctx, width: number, height: number, colors: TopColors): void
{
	const corners: [number, number, number][] = [[18, 18, Math.PI / 4], [width - 18, 18, (Math.PI * 3) / 4], [18, height - 18, -Math.PI / 4], [width - 18, height - 18, (-Math.PI * 3) / 4]];
	for (const [x, y, angle] of corners)
	{
		drawLeaf(ctx, x, y, 24, angle - 0.4, colors.secondary, 0.4);
		drawLeaf(ctx, x, y, 24, angle + 0.4, colors.primary, 0.4);
		fillCircle(ctx, x, y, 3, colors.light);
	}
}

function sunCorner(ctx: Ctx, width: number, alpha: number): void
{
	drawGlow(ctx, width - 50, -40, 340, "#ffe082", alpha * 2.2);
	drawSunburst(ctx, width - 40, -50, 560, "#fff3b0", alpha, 18, 0.25, 0.32);
}

const CAY_XANH_STYLE: CardStyle = {
	key: "cay-xanh",
	top: CAY_TOP,
	boardAccent: "#22c55e",
	rankBackground: (ctx, scene) =>
	{
		const { rand, colors, complexity } = scene;
		sunCorner(ctx, scene.width, scene.top ? 0.11 : 0.06);
		drawGlow(ctx, 90, scene.height + 40, 420, "#22c55e", 0.16);
		drawHills(ctx, rand, ground(scene), [
			{ color: rgba(mix("#4ade80", colors.from, 0.3), 0.14), ridge: 0.3, amplitude: 46 },
			{ color: rgba(mix("#166534", colors.from, 0.3), 0.4), ridge: 0.52, amplitude: 38 },
			{ color: rgba(mix("#052e16", PALETTE.night, 0.4), 0.7), ridge: 0.76, amplitude: 28 },
		]);
		drawStarfield(ctx, rand, full(scene), 18, ["#ffffff"], scene.textAreas);
		drawFallingLeaves(ctx, rand, full(scene), 14 + complexity * 3, [...LEAVES, colors.color], scene.textAreas);
		drawFireflies(ctx, rand, full(scene), 8 + complexity * 3, "#fff59d", scene.textAreas);
		if (scene.top) drawFallingLeaves(ctx, rand, full(scene), 16, [CAY_TOP.primary, "#ffb300"], scene.textAreas);
	},
	rankFrame: (ctx, scene) =>
	{
		if (scene.top) drawSunburst(ctx, scene.avatarX, scene.avatarY, scene.frameRadius + 84, CAY_TOP.primary, 0.18, 20, 0, 0.45);
		drawVineWreath(ctx, scene.avatarX, scene.avatarY, scene.frameRadius, frameOptions(scene, CAY_TOP.primary));
	},
	rankFront: nothing,
	corners: (ctx, width, height) => leafCorners(ctx, width, height, CAY_TOP),
	boardBackground: (ctx, rand, width, height, avoid) =>
	{
		drawGlow(ctx, 72, 70, 340, PALETTE.gold, 0.2);
		drawGlow(ctx, width / 2, height + 60, 520, "#15803d", 0.24);
		sunCorner(ctx, width, 0.06);
		drawHills(ctx, rand, { x: 0, y: height - 150, width, height: 150 }, [
			{ color: "rgba(74, 222, 128, 0.06)", ridge: 0.3, amplitude: 50 },
			{ color: "rgba(21, 128, 61, 0.1)", ridge: 0.55, amplitude: 40 },
		]);
		drawFallingLeaves(ctx, rand, { x: 0, y: 0, width, height }, Math.round(height / 22), LEAVES, avoid);
		drawFireflies(ctx, rand, { x: 0, y: 0, width, height }, Math.round(height / 30), "#fff59d", avoid);
	},
	boardRing: (ctx, x, y, radius) => drawVineWreath(ctx, x, y, radius, { color: "#86efac", accent: PALETTE.gold, complexity: 7, detailed: false }),
};

const VU_TRU_TOP: TopColors = { primary: "#f0abfc", secondary: "#818cf8", light: "#fdf4ff" };
const NEBULA = ["#7c4dff", "#00bcd4", "#e91e63"];

function starCorners(ctx: Ctx, width: number, height: number, colors: TopColors): void
{
	const corners: [number, number][] = [[24, 24], [width - 24, 24], [24, height - 24], [width - 24, height - 24]];
	for (const [x, y] of corners)
	{
		drawGlow(ctx, x, y, 18, colors.primary, 0.5);
		drawSparkle(ctx, x, y, 10, colors.light);
		strokeCircle(ctx, x, y, 7, rgba(colors.primary, 0.6), 1);
	}
}

const VU_TRU_STYLE: CardStyle = {
	key: "vu-tru",
	top: VU_TRU_TOP,
	boardAccent: "#818cf8",
	rankBackground: (ctx, scene) =>
	{
		const { rand, colors, complexity } = scene;
		drawNebula(ctx, rand, { x: 0, y: 0, width: scene.width, height: scene.groundY }, 4, [colors.to, ...NEBULA], 0.13);
		drawStarfield(ctx, rand, full(scene), 110 + complexity * 16, ["#ffffff", "#c7d2fe", colors.to], scene.textAreas);
		drawHorizon(ctx, scene.width * 0.56, scene.groundY + 1085, 1060, colors.to, 0.3, PALETTE.night);
		drawShootingStar(ctx, 596, 26, 120, Math.PI * 0.88, "#ffffff", 1.6);
		if (scene.top)
		{
			drawShootingStar(ctx, 760, 170, 150, Math.PI * 0.86, VU_TRU_TOP.primary, 2);
			drawShootingStar(ctx, 420, 14, 90, Math.PI * 0.9, VU_TRU_TOP.light, 1.4);
		}
	},
	rankFrame: (ctx, scene) =>
	{
		if (scene.top)
		{
			drawGalaxy(ctx, scene.rand, scene.avatarX, scene.avatarY, scene.frameRadius + 110, VU_TRU_TOP.primary, 2, 1400, 0.6, -0.3);
			drawLensFlare(ctx, scene.avatarX, scene.avatarY, scene.frameRadius + 150, 9, VU_TRU_TOP.light, 0.7);
		}
		drawOrbitFrame(ctx, scene.avatarX, scene.avatarY, scene.frameRadius, frameOptions(scene, VU_TRU_TOP.primary));
	},
	rankFront: nothing,
	corners: (ctx, width, height) => starCorners(ctx, width, height, VU_TRU_TOP),
	boardBackground: (ctx, rand, width, height, avoid) =>
	{
		drawNebula(ctx, rand, { x: 0, y: 0, width, height }, 5, NEBULA, 0.12);
		drawStarfield(ctx, rand, { x: 0, y: 0, width, height }, Math.round(height / 4), ["#ffffff", "#c7d2fe", "#f0abfc"], avoid);
		drawHorizon(ctx, width / 2, height + 1010, 1080, "#818cf8", 0.28, PALETTE.night);
		drawPlanet(ctx, width - 92, 58, 15, "#c4b5fd", true);
		drawShootingStar(ctx, width - 230, 30, 110, Math.PI * 0.88, "#ffffff", 1.5);
	},
	boardRing: (ctx, x, y, radius) => drawOrbitFrame(ctx, x, y, radius, { color: PALETTE.gold, accent: PALETTE.gold, complexity: 6, detailed: false }),
};

const STYLES: Readonly<Record<TierSetKey, CardStyle>> = {
	"tu-tien": TU_TIEN_STYLE,
	"rank-game": RANK_GAME_STYLE,
	"kiem-hiep": KIEM_HIEP_STYLE,
	"cay-xanh": CAY_XANH_STYLE,
	"vu-tru": VU_TRU_STYLE,
};

/** Phong cách của bộ `setKey`; bộ lạ hoặc null thì trả về phong cách trung tính. */
export function cardStyle(setKey: string | null | undefined): CardStyle
{
	return typeof setKey === "string" && isTierSetKey(setKey) ? STYLES[setKey] : NEUTRAL_STYLE;
}
