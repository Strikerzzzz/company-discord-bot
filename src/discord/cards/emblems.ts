import { isTierSetKey, TierSetKey } from "../../modules/activity/tiers";
import { Ctx, drawGlow, fillCircle, Gradient, linearGradient, mix, Paint, rgba, strokeCircle, TAU } from "./draw";
import { boltPath, drawCrown, drawFlame, drawFlower, drawLeaf, drawOrb, drawPlanet, drawSparkle, drawSword, drawWings, starPath } from "./icons";

/*
 * Biểu tượng bậc (thay cho emoji trong tin nhắn) theo bộ danh hiệu và vị trí bậc (0–7). Mỗi bộ một motif; bậc càng cao
 * hoa văn càng phong phú. Biểu tượng hiển thị ở cỡ nhỏ (14–23 px trong viên thuốc bậc) nên mỗi bậc cần dáng khác nhau rõ.
 * Mọi hàm vẽ trong ô vuông cạnh `size`, tâm (x, y).
 */

type EmblemDrawer = (ctx: Ctx, x: number, y: number, size: number, color: string) => void;

const INK = "#141726";

function tuTienSprout(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	ctx.strokeStyle = color;
	ctx.lineWidth = Math.max(1.5, size * 0.11);
	ctx.beginPath();
	ctx.moveTo(x, y + s * 0.9);
	ctx.quadraticCurveTo(x - s * 0.05, y + s * 0.2, x, y - s * 0.1);
	ctx.stroke();
	drawLeaf(ctx, x, y - s * 0.05, s * 0.95, -Math.PI * 0.2, color);
	drawLeaf(ctx, x, y + s * 0.2, s * 0.8, -Math.PI * 0.85, mix(color, "#ffffff", 0.25));
}

function tuTienFoundation(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	const bricks: [number, number, number][] = [[-0.95, 0.42, 0.92], [0.03, 0.42, 0.92], [-0.66, -0.14, 0.63], [0.03, -0.14, 0.63], [-0.34, -0.7, 0.68]];
	bricks.forEach(([left, top, width], index) =>
	{
		ctx.fillStyle = index < 2 ? mix(color, "#000000", 0.15) : index < 4 ? color : mix(color, "#ffffff", 0.3);
		ctx.beginPath();
		ctx.roundRect(x + left * s, y + top * s, width * s, s * 0.5, s * 0.1);
		ctx.fill();
	});
}

function tuTienCore(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	const gradient = ctx.createRadialGradient(x - s * 0.3, y - s * 0.35, s * 0.1, x, y, s * 0.85);
	gradient.addColorStop(0, "#fffde7");
	gradient.addColorStop(0.45, color);
	gradient.addColorStop(1, mix(color, "#8d4a00", 0.55));
	fillCircle(ctx, x, y, s * 0.78, gradient);
	strokeCircle(ctx, x, y, s * 0.95, rgba(color, 0.7), Math.max(1, size * 0.06));
}

function tuTienInfant(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	strokeCircle(ctx, x, y - s * 0.62, s * 0.38, color, Math.max(1.2, size * 0.07));
	fillCircle(ctx, x, y - s * 0.05, s * 0.3, color);
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.moveTo(x - s * 0.62, y + s * 0.95);
	ctx.quadraticCurveTo(x - s * 0.55, y + s * 0.25, x, y + s * 0.25);
	ctx.quadraticCurveTo(x + s * 0.55, y + s * 0.25, x + s * 0.62, y + s * 0.95);
	ctx.closePath();
	ctx.fill();
}

function tuTienFlame(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	drawFlame(ctx, x, y, size * 0.95, true, color, mix(color, "#ffe082", 0.7));
}

function tuTienVoid(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	ctx.strokeStyle = color;
	ctx.lineWidth = Math.max(1.5, size * 0.1);
	ctx.beginPath();
	for (let step = 0; step <= 60; step++)
	{
		const t = step / 60;
		const angle = t * Math.PI * 3.6;
		const radius = s * 0.1 + t * s * 0.82;
		const px = x + Math.cos(angle) * radius;
		const py = y + Math.sin(angle) * radius;
		if (step === 0) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
	}
	ctx.stroke();
}

function tuTienTaiji(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const r = (size / 2) * 0.9;
	fillCircle(ctx, x, y, r, color);
	ctx.fillStyle = "#101426";
	ctx.beginPath();
	ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2);
	ctx.arc(x, y + r / 2, r / 2, Math.PI / 2, -Math.PI / 2, true);
	ctx.arc(x, y - r / 2, r / 2, Math.PI / 2, -Math.PI / 2, false);
	ctx.closePath();
	ctx.fill();
	fillCircle(ctx, x, y - r / 2, r * 0.16, color);
	fillCircle(ctx, x, y + r / 2, r * 0.16, "#101426");
	strokeCircle(ctx, x, y, r, color, Math.max(1, size * 0.06));
}

function tuTienBolt(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	boltPath(ctx, x, y, size);
	ctx.fillStyle = linearGradient(ctx, x, y - s, x, y + s, ["#fff8d6", color, mix(color, "#ff6f00", 0.4)]);
	ctx.fill();
}

function shieldPath(ctx: Ctx, x: number, y: number, w: number, h: number): void
{
	ctx.beginPath();
	ctx.moveTo(x - w, y - h * 0.78);
	ctx.quadraticCurveTo(x - w * 0.45, y - h * 0.8, x, y - h);
	ctx.quadraticCurveTo(x + w * 0.45, y - h * 0.8, x + w, y - h * 0.78);
	ctx.lineTo(x + w, y - h * 0.05);
	ctx.bezierCurveTo(x + w, y + h * 0.45, x + w * 0.45, y + h * 0.78, x, y + h);
	ctx.bezierCurveTo(x - w * 0.45, y + h * 0.78, x - w, y + h * 0.45, x - w, y - h * 0.05);
	ctx.closePath();
}

function drawShield(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void
{
	shieldPath(ctx, x, y, w, h);
	ctx.fillStyle = linearGradient(ctx, x, y - h, x, y + h, [mix(color, "#ffffff", 0.4), color, mix(color, "#000000", 0.45)]);
	ctx.fill();
	ctx.strokeStyle = mix(color, "#ffffff", 0.65);
	ctx.lineWidth = Math.max(1, w * 0.13);
	ctx.stroke();
}

function drawChevrons(ctx: Ctx, x: number, y: number, w: number, h: number, count: number): void
{
	ctx.strokeStyle = rgba(INK, 0.85);
	ctx.lineWidth = Math.max(1.3, h * 0.17);
	const gap = h * 0.34;
	const top = y - ((count - 1) * gap) / 2;
	for (let index = 0; index < count; index++)
	{
		const cy = top + index * gap;
		ctx.beginPath();
		ctx.moveTo(x - w * 0.52, cy + h * 0.16);
		ctx.lineTo(x, cy - h * 0.12);
		ctx.lineTo(x + w * 0.52, cy + h * 0.16);
		ctx.stroke();
	}
}

function drawGem(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void
{
	const top = y - h * 0.6;
	const girdle = y - h * 0.15;
	const bottom = y + h;
	const tableLeft = x - w * 0.55;
	const tableRight = x + w * 0.55;
	ctx.beginPath();
	ctx.moveTo(tableLeft, top);
	ctx.lineTo(tableRight, top);
	ctx.lineTo(x + w, girdle);
	ctx.lineTo(x, bottom);
	ctx.lineTo(x - w, girdle);
	ctx.closePath();
	ctx.fillStyle = linearGradient(ctx, x, top, x, bottom, [mix(color, "#ffffff", 0.55), color, mix(color, "#000000", 0.4)]);
	ctx.fill();
	ctx.fillStyle = rgba("#ffffff", 0.35);
	ctx.beginPath();
	ctx.moveTo(tableLeft, top);
	ctx.lineTo(x - w * 0.2, girdle);
	ctx.lineTo(x - w, girdle);
	ctx.closePath();
	ctx.fill();
	ctx.fillStyle = rgba(INK, 0.22);
	ctx.beginPath();
	ctx.moveTo(x + w * 0.2, girdle);
	ctx.lineTo(x + w, girdle);
	ctx.lineTo(x, bottom);
	ctx.closePath();
	ctx.fill();
	ctx.strokeStyle = rgba("#ffffff", 0.7);
	ctx.lineWidth = Math.max(0.8, w * 0.07);
	ctx.beginPath();
	ctx.moveTo(x - w, girdle);
	ctx.lineTo(x + w, girdle);
	ctx.moveTo(tableLeft, top);
	ctx.lineTo(x - w * 0.2, girdle);
	ctx.lineTo(x, bottom);
	ctx.lineTo(x + w * 0.2, girdle);
	ctx.lineTo(tableRight, top);
	ctx.stroke();
}

function shieldWithChevrons(count: number): EmblemDrawer
{
	return (ctx, x, y, size, color) =>
	{
		const s = size / 2;
		drawShield(ctx, x, y, s * 0.66, s * 0.9, color);
		drawChevrons(ctx, x, y + s * 0.08, s * 0.66, s * 0.9, count);
	};
}

function rankStarShield(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	drawShield(ctx, x, y, s * 0.66, s * 0.9, color);
	starPath(ctx, x, y - s * 0.02, s * 0.46, s * 0.2, 5);
	ctx.fillStyle = rgba(INK, 0.85);
	ctx.fill();
	ctx.fillStyle = mix(color, "#ffffff", 0.7);
	ctx.fillRect(x - s * 0.9, y - s * 0.12, s * 0.2, s * 0.24);
	ctx.fillRect(x + s * 0.7, y - s * 0.12, s * 0.2, s * 0.24);
}

function rankGem(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	drawGem(ctx, x, y + s * 0.05, s * 0.88, s * 0.85, color);
}

function rankWingedGem(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	drawWings(ctx, x, y - s * 0.05, s * 0.95, mix(color, "#ffffff", 0.15), 2, s * 0.3);
	drawGem(ctx, x, y + s * 0.08, s * 0.56, s * 0.72, color);
}

function rankWingedShield(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	drawWings(ctx, x, y - s * 0.1, s, mix(color, "#ffffff", 0.1), 3, s * 0.32);
	drawShield(ctx, x, y + s * 0.05, s * 0.46, s * 0.72, color);
	starPath(ctx, x, y + s * 0.02, s * 0.32, s * 0.14, 5);
	ctx.fillStyle = rgba(INK, 0.85);
	ctx.fill();
}

function rankChallenger(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	drawWings(ctx, x, y + s * 0.02, s, mix(color, "#ffffff", 0.1), 3, s * 0.3);
	drawShield(ctx, x, y + s * 0.2, s * 0.44, s * 0.66, color);
	starPath(ctx, x, y + s * 0.18, s * 0.28, s * 0.12, 5);
	ctx.fillStyle = rgba(INK, 0.85);
	ctx.fill();
	drawCrown(ctx, x, y - s * 0.62, s * 0.95, mix(color, "#fff3b0", 0.35));
}

function steelOf(color: string): string
{
	return mix(color, "#dfe6f2", 0.65);
}

function kiemHiepScroll(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	ctx.fillStyle = mix(color, "#fff4dc", 0.65);
	ctx.fillRect(x - s * 0.6, y - s * 0.55, s * 1.2, s * 1.1);
	ctx.strokeStyle = rgba(mix(color, "#000000", 0.6), 0.8);
	ctx.lineWidth = Math.max(1, s * 0.1);
	const lines: [number, number][] = [[-0.3, 0.55], [0, 0.35], [0.3, 0.5]];
	for (const [offset, length] of lines)
	{
		ctx.beginPath();
		ctx.moveTo(x + offset * s, y - s * 0.32);
		ctx.lineTo(x + offset * s, y - s * 0.32 + length * s);
		ctx.stroke();
	}
	for (const side of [-1, 1])
	{
		ctx.fillStyle = mix(color, "#000000", 0.3);
		ctx.beginPath();
		ctx.roundRect(x + side * s * 0.66 - s * 0.13, y - s * 0.75, s * 0.26, s * 1.5, s * 0.1);
		ctx.fill();
		fillCircle(ctx, x + side * s * 0.66, y - s * 0.82, s * 0.1, mix(color, "#ffffff", 0.4));
		fillCircle(ctx, x + side * s * 0.66, y + s * 0.82, s * 0.1, mix(color, "#ffffff", 0.4));
	}
}

function kiemHiepSword(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	drawSword(ctx, x, y, size * 1.28, Math.PI / 4, steelOf(color), color);
}

function kiemHiepFan(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	const pivotX = x;
	const pivotY = y + s * 0.72;
	const outer = s * 1.42;
	const inner = s * 0.5;
	const start = -Math.PI / 2 - 0.78;
	const end = -Math.PI / 2 + 0.78;
	const folds = 8;
	for (let index = 0; index < folds; index++)
	{
		const a0 = start + ((end - start) * index) / folds;
		const a1 = start + ((end - start) * (index + 1)) / folds;
		ctx.beginPath();
		ctx.arc(pivotX, pivotY, outer, a0, a1);
		ctx.arc(pivotX, pivotY, inner, a1, a0, true);
		ctx.closePath();
		ctx.fillStyle = index % 2 === 0 ? color : mix(color, "#ffffff", 0.3);
		ctx.fill();
	}
	ctx.strokeStyle = mix(color, "#000000", 0.45);
	ctx.lineWidth = Math.max(1, s * 0.1);
	for (let index = 0; index <= folds; index += 2)
	{
		const angle = start + ((end - start) * index) / folds;
		ctx.beginPath();
		ctx.moveTo(pivotX, pivotY);
		ctx.lineTo(pivotX + Math.cos(angle) * outer, pivotY + Math.sin(angle) * outer);
		ctx.stroke();
	}
	ctx.beginPath();
	ctx.arc(pivotX, pivotY, outer, start, end);
	ctx.strokeStyle = mix(color, "#ffffff", 0.55);
	ctx.stroke();
	fillCircle(ctx, pivotX, pivotY, s * 0.14, mix(color, "#000000", 0.5));
}

function crossedSwords(ctx: Ctx, x: number, y: number, length: number, color: string): void
{
	drawSword(ctx, x, y, length, -Math.PI / 4, steelOf(color), color);
	drawSword(ctx, x, y, length, Math.PI / 4, steelOf(color), color);
}

function kiemHiepCrossed(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	crossedSwords(ctx, x, y, size * 1.25, color);
}

function kiemHiepWanderer(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	drawSword(ctx, x + s * 0.05, y - s * 0.1, size * 1.22, Math.PI / 4, steelOf(color), color);
	const brim = y + s * 0.5;
	const apex = brim - s * 1.05;
	const straw = mix("#e8c07a", color, 0.25);
	ctx.beginPath();
	ctx.moveTo(x - s, brim);
	ctx.lineTo(x, apex);
	ctx.lineTo(x + s, brim);
	ctx.quadraticCurveTo(x, brim + s * 0.26, x - s, brim);
	ctx.closePath();
	ctx.fillStyle = linearGradient(ctx, x - s, apex, x + s, brim, [mix(straw, "#ffffff", 0.4), straw, mix(straw, "#000000", 0.4)]);
	ctx.fill();
	ctx.strokeStyle = rgba(mix(straw, "#000000", 0.6), 0.65);
	ctx.lineWidth = Math.max(0.6, s * 0.06);
	ctx.beginPath();
	for (const t of [-0.55, -0.18, 0.18, 0.55])
	{
		ctx.moveTo(x, apex + s * 0.08);
		ctx.lineTo(x + t * s, brim + s * 0.1 * (1 - Math.abs(t)));
	}
	ctx.stroke();
	fillCircle(ctx, x, apex + s * 0.04, Math.max(0.8, s * 0.09), color);
}

function kiemHiepAura(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	drawFlame(ctx, x, y + size * 0.04, size * 0.98, true, color, mix(color, "#fff3b0", 0.6));
	drawSword(ctx, x, y + size * 0.02, size * 1.05, 0, steelOf(color), mix(color, "#000000", 0.2));
}

function kiemHiepToken(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	const w = s * 0.56;
	const top = y - s * 0.92;
	const bottom = y + s * 0.45;
	ctx.beginPath();
	ctx.moveTo(x - w, bottom);
	ctx.lineTo(x - w, top + w * 0.7);
	ctx.quadraticCurveTo(x - w, top, x, top);
	ctx.quadraticCurveTo(x + w, top, x + w, top + w * 0.7);
	ctx.lineTo(x + w, bottom);
	ctx.closePath();
	ctx.fillStyle = linearGradient(ctx, x, top, x, bottom, [mix(color, "#ffffff", 0.45), color, mix(color, "#000000", 0.35)]);
	ctx.fill();
	ctx.strokeStyle = mix(color, "#ffffff", 0.7);
	ctx.lineWidth = Math.max(1, s * 0.09);
	ctx.stroke();
	ctx.save();
	ctx.translate(x, y - s * 0.22);
	ctx.rotate(Math.PI / 4);
	ctx.fillStyle = rgba(INK, 0.8);
	ctx.fillRect(-s * 0.22, -s * 0.22, s * 0.44, s * 0.44);
	ctx.restore();
	ctx.strokeStyle = "#e53935";
	ctx.lineWidth = Math.max(1, s * 0.1);
	ctx.beginPath();
	ctx.moveTo(x, bottom);
	ctx.lineTo(x, bottom + s * 0.2);
	ctx.stroke();
	ctx.fillStyle = "#e53935";
	ctx.beginPath();
	ctx.moveTo(x - s * 0.08, bottom + s * 0.18);
	ctx.lineTo(x + s * 0.08, bottom + s * 0.18);
	ctx.lineTo(x + s * 0.2, y + s);
	ctx.lineTo(x - s * 0.2, y + s);
	ctx.closePath();
	ctx.fill();
}

function kiemHiepLeader(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	ctx.fillStyle = rgba(color, 0.4);
	for (let index = 0; index < 12; index++)
	{
		const angle = (index / 12) * TAU;
		ctx.beginPath();
		ctx.moveTo(x + Math.cos(angle - 0.12) * s * 0.3, y + s * 0.1 + Math.sin(angle - 0.12) * s * 0.3);
		ctx.lineTo(x + Math.cos(angle) * s, y + s * 0.1 + Math.sin(angle) * s);
		ctx.lineTo(x + Math.cos(angle + 0.12) * s * 0.3, y + s * 0.1 + Math.sin(angle + 0.12) * s * 0.3);
		ctx.closePath();
		ctx.fill();
	}
	crossedSwords(ctx, x, y + s * 0.18, size * 1.05, color);
	drawCrown(ctx, x, y - s * 0.62, s * 0.95, mix(color, "#fff3b0", 0.4));
}

const SOIL = "#6d4c41";
const TRUNK = "#8d5a3b";
const LEAF = "#5cc46a";

function drawMound(ctx: Ctx, x: number, y: number, s: number, width: number): void
{
	ctx.beginPath();
	ctx.ellipse(x, y + s * 0.95, s * width, s * 0.34, 0, Math.PI, TAU);
	ctx.closePath();
	ctx.fillStyle = linearGradient(ctx, x, y + s * 0.6, x, y + s * 0.95, [mix(SOIL, "#ffffff", 0.2), mix(SOIL, "#000000", 0.25)]);
	ctx.fill();
}

function drawStem(ctx: Ctx, x: number, bottom: number, top: number, width: number, color: string, bend = 0.08): void
{
	ctx.strokeStyle = color;
	ctx.lineWidth = width;
	ctx.beginPath();
	ctx.moveTo(x, bottom);
	ctx.quadraticCurveTo(x - (bottom - top) * bend, (bottom + top) / 2, x, top);
	ctx.stroke();
}

function leafOf(color: string): string
{
	return mix(LEAF, color, 0.35);
}

function cayXanhSeed(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	drawMound(ctx, x, y, s, 0.95);
	ctx.save();
	ctx.translate(x, y + s * 0.12);
	ctx.rotate(0.45);
	ctx.beginPath();
	ctx.ellipse(0, 0, s * 0.42, s * 0.6, 0, 0, TAU);
	ctx.fillStyle = linearGradient(ctx, -s * 0.4, -s * 0.6, s * 0.4, s * 0.6, [mix(color, "#ffffff", 0.45), color, mix(color, "#000000", 0.4)]);
	ctx.fill();
	ctx.strokeStyle = rgba(mix(color, "#000000", 0.55), 0.8);
	ctx.lineWidth = Math.max(1, s * 0.09);
	ctx.beginPath();
	ctx.moveTo(0, -s * 0.45);
	ctx.quadraticCurveTo(s * 0.12, 0, 0, s * 0.45);
	ctx.stroke();
	ctx.restore();
}

function cayXanhSprout(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	drawMound(ctx, x, y, s, 0.95);
	drawStem(ctx, x, y + s * 0.7, y - s * 0.15, Math.max(1.3, s * 0.14), color);
	drawLeaf(ctx, x, y - s * 0.12, s * 0.85, -Math.PI * 0.18, color, 0.42);
	drawLeaf(ctx, x, y - s * 0.12, s * 0.8, -Math.PI * 0.84, mix(color, "#ffffff", 0.2), 0.42);
}

function cayXanhSapling(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	drawMound(ctx, x, y, s, 0.8);
	drawStem(ctx, x, y + s * 0.75, y - s * 0.8, Math.max(1.3, s * 0.13), mix(color, TRUNK, 0.35));
	drawLeaf(ctx, x, y + s * 0.2, s * 0.75, -Math.PI * 0.1, color, 0.42);
	drawLeaf(ctx, x, y + s * 0.05, s * 0.72, -Math.PI * 0.9, mix(color, "#000000", 0.12), 0.42);
	drawLeaf(ctx, x, y - s * 0.45, s * 0.62, -Math.PI * 0.2, mix(color, "#ffffff", 0.2), 0.42);
	drawLeaf(ctx, x, y - s * 0.55, s * 0.6, -Math.PI * 0.82, color, 0.42);
	drawLeaf(ctx, x, y - s * 0.75, s * 0.4, -Math.PI * 0.5, mix(color, "#ffffff", 0.3), 0.42);
}

function cayXanhFlower(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	const leaf = leafOf(color);
	drawStem(ctx, x, y + s, y - s * 0.3, Math.max(1.3, s * 0.13), mix(leaf, "#000000", 0.2));
	drawLeaf(ctx, x, y + s * 0.55, s * 0.72, -Math.PI * 0.15, leaf, 0.42);
	drawLeaf(ctx, x, y + s * 0.35, s * 0.68, -Math.PI * 0.85, mix(leaf, "#000000", 0.12), 0.42);
	drawFlower(ctx, x, y - s * 0.4, s * 1.2, color, "#ffe082");
}

function cayXanhFruit(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	const leaf = leafOf(color);
	ctx.fillStyle = TRUNK;
	ctx.beginPath();
	ctx.moveTo(x - s * 0.14, y + s);
	ctx.lineTo(x - s * 0.08, y + s * 0.1);
	ctx.lineTo(x + s * 0.08, y + s * 0.1);
	ctx.lineTo(x + s * 0.14, y + s);
	ctx.closePath();
	ctx.fill();
	const canopy = ctx.createRadialGradient(x - s * 0.25, y - s * 0.45, s * 0.1, x, y - s * 0.2, s * 0.75);
	canopy.addColorStop(0, mix(leaf, "#ffffff", 0.3));
	canopy.addColorStop(1, mix(leaf, "#000000", 0.3));
	fillCircle(ctx, x, y - s * 0.22, s * 0.7, canopy);
	const fruits: [number, number][] = [[-0.32, -0.3], [0.3, -0.42], [0.08, 0.05], [-0.1, -0.62]];
	for (const [fx, fy] of fruits)
	{
		fillCircle(ctx, x + fx * s, y + fy * s, s * 0.15, color);
		fillCircle(ctx, x + fx * s - s * 0.05, y + fy * s - s * 0.05, s * 0.05, rgba("#ffffff", 0.7));
	}
}

function canopyPaint(ctx: Ctx, x: number, y: number, s: number, leaf: string): Gradient
{
	const gradient = ctx.createRadialGradient(x - s * 0.3, y - s * 0.6, s * 0.1, x, y - s * 0.2, s * 1.1);
	gradient.addColorStop(0, mix(leaf, "#ffffff", 0.35));
	gradient.addColorStop(1, mix(leaf, "#000000", 0.35));
	return gradient;
}

function cayXanhTree(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	ctx.fillStyle = TRUNK;
	ctx.beginPath();
	ctx.moveTo(x - s * 0.2, y + s);
	ctx.lineTo(x - s * 0.1, y + s * 0.1);
	ctx.lineTo(x + s * 0.1, y + s * 0.1);
	ctx.lineTo(x + s * 0.2, y + s);
	ctx.closePath();
	ctx.fill();
	const paint = canopyPaint(ctx, x, y, s, color);
	const blobs: [number, number, number][] = [[-0.42, -0.1, 0.45], [0.42, -0.1, 0.45], [0, -0.48, 0.55], [0, -0.05, 0.45]];
	for (const [bx, by, br] of blobs) fillCircle(ctx, x + bx * s, y + by * s, br * s, paint);
}

function cayXanhPine(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	ctx.fillStyle = TRUNK;
	ctx.fillRect(x - s * 0.1, y + s * 0.62, s * 0.2, s * 0.38);
	const tiers: [number, number, number][] = [[0.7, 0.35, 0.9], [0.2, -0.2, 0.72], [-0.3, -0.72, 0.52]];
	tiers.forEach(([bottom, top, half], index) =>
	{
		ctx.beginPath();
		ctx.moveTo(x - half * s, y + bottom * s);
		ctx.lineTo(x, y + (top - 0.28) * s);
		ctx.lineTo(x + half * s, y + bottom * s);
		ctx.closePath();
		ctx.fillStyle = mix(color, index === 2 ? "#ffffff" : "#000000", index === 2 ? 0.15 : 0.25 - index * 0.12);
		ctx.fill();
	});
}

function cayXanhGreatTree(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	drawGlow(ctx, x, y - s * 0.2, s * 1.1, color, 0.55);
	ctx.fillStyle = TRUNK;
	ctx.beginPath();
	ctx.moveTo(x - s * 0.62, y + s);
	ctx.quadraticCurveTo(x - s * 0.18, y + s * 0.82, x - s * 0.15, y + s * 0.1);
	ctx.lineTo(x + s * 0.15, y + s * 0.1);
	ctx.quadraticCurveTo(x + s * 0.18, y + s * 0.82, x + s * 0.62, y + s);
	ctx.closePath();
	ctx.fill();
	const leaf = mix(LEAF, color, 0.3);
	const paint = canopyPaint(ctx, x, y, s, leaf);
	const blobs: [number, number, number][] = [[-0.62, -0.05, 0.36], [0.62, -0.05, 0.36], [-0.34, -0.42, 0.44], [0.34, -0.42, 0.44], [0, -0.62, 0.42], [0, -0.12, 0.42]];
	for (const [bx, by, br] of blobs) fillCircle(ctx, x + bx * s, y + by * s, br * s, paint);
	const lights: [number, number][] = [[-0.35, -0.5], [0.4, -0.25], [0.05, -0.75], [-0.6, -0.1]];
	for (const [lx, ly] of lights) fillCircle(ctx, x + lx * s, y + ly * s, s * 0.09, mix(color, "#ffffff", 0.4));
}

function rockPath(ctx: Ctx, x: number, y: number, radius: number, jitter: readonly number[]): void
{
	ctx.beginPath();
	jitter.forEach((scale, index) =>
	{
		const angle = (index / jitter.length) * TAU;
		const px = x + Math.cos(angle) * radius * scale;
		const py = y + Math.sin(angle) * radius * scale;
		if (index === 0) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
	});
	ctx.closePath();
}

function rockPaint(ctx: Ctx, x: number, y: number, radius: number, color: string): Gradient
{
	const gradient = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.35, radius * 0.1, x, y, radius);
	gradient.addColorStop(0, mix(color, "#ffffff", 0.45));
	gradient.addColorStop(1, mix(color, "#000000", 0.5));
	return gradient;
}

function cometTail(ctx: Ctx, x: number, y: number, width: number, length: number, direction: number, color: string, alpha: number): void
{
	const nx = Math.cos(direction + Math.PI / 2);
	const ny = Math.sin(direction + Math.PI / 2);
	const tipX = x + Math.cos(direction) * length;
	const tipY = y + Math.sin(direction) * length;
	const middleX = (x + tipX) / 2;
	const middleY = (y + tipY) / 2;
	ctx.beginPath();
	ctx.moveTo(x + nx * width, y + ny * width);
	ctx.quadraticCurveTo(middleX + nx * width * 0.55, middleY + ny * width * 0.55, tipX, tipY);
	ctx.quadraticCurveTo(middleX - nx * width * 0.55, middleY - ny * width * 0.55, x - nx * width, y - ny * width);
	ctx.closePath();
	ctx.fillStyle = linearGradient(ctx, x, y, tipX, tipY, [rgba(color, alpha), rgba(color, 0)]);
	ctx.fill();
}

function vuTruMeteor(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	const rockX = x - s * 0.32;
	const rockY = y + s * 0.32;
	const rock = s * 0.5;
	const direction = -Math.PI / 4;
	cometTail(ctx, rockX, rockY, rock * 1.05, s * 1.5, direction, mix(color, "#ff9e57", 0.6), 0.85);
	cometTail(ctx, rockX, rockY, rock * 0.6, s * 1.15, direction, mix(color, "#fff3c4", 0.6), 0.9);
	rockPath(ctx, rockX, rockY, rock, [1, 0.82, 0.95, 0.78, 1, 0.86, 0.92, 0.8]);
	ctx.fillStyle = rockPaint(ctx, rockX, rockY, rock, color);
	ctx.fill();
	fillCircle(ctx, rockX + s * 0.1, rockY + s * 0.1, s * 0.12, rgba(INK, 0.45));
	fillCircle(ctx, rockX - s * 0.18, rockY - s * 0.08, s * 0.08, rgba(INK, 0.4));
}

function vuTruAsteroid(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	rockPath(ctx, x, y, s * 0.88, [1, 0.95, 0.9, 0.97, 0.92, 1, 0.94, 0.9, 0.98, 0.93]);
	ctx.fillStyle = rockPaint(ctx, x, y, s * 0.88, color);
	ctx.fill();
	const craters: [number, number, number][] = [[-0.3, -0.25, 0.2], [0.3, 0.1, 0.24], [-0.15, 0.4, 0.14], [0.3, -0.45, 0.1]];
	for (const [cx, cy, cr] of craters)
	{
		fillCircle(ctx, x + cx * s, y + cy * s, cr * s, rgba(INK, 0.35));
		strokeCircle(ctx, x + cx * s, y + cy * s, cr * s, rgba("#ffffff", 0.25), Math.max(0.6, s * 0.05));
	}
}

function vuTruPlanet(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	drawPlanet(ctx, x, y, size * 0.3, color, true);
}

function sunRays(ctx: Ctx, x: number, y: number, inner: number, outer: number, count: number, color: string, alternate: boolean): void
{
	ctx.fillStyle = color;
	for (let index = 0; index < count; index++)
	{
		const angle = -Math.PI / 2 + (index / count) * TAU;
		const reach = alternate && index % 2 === 1 ? inner + (outer - inner) * 0.55 : outer;
		const half = Math.PI / count / 1.6;
		ctx.beginPath();
		ctx.moveTo(x + Math.cos(angle - half) * inner, y + Math.sin(angle - half) * inner);
		ctx.lineTo(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach);
		ctx.lineTo(x + Math.cos(angle + half) * inner, y + Math.sin(angle + half) * inner);
		ctx.closePath();
		ctx.fill();
	}
}

function sunCore(ctx: Ctx, x: number, y: number, radius: number, color: string): void
{
	const gradient = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
	gradient.addColorStop(0, "#fffef0");
	gradient.addColorStop(0.5, mix(color, "#ffffff", 0.3));
	gradient.addColorStop(1, color);
	fillCircle(ctx, x, y, radius, gradient);
}

function vuTruStar(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	sunRays(ctx, x, y, s * 0.5, s, 8, color, true);
	sunCore(ctx, x, y, s * 0.52, color);
}

function vuTruGiant(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	drawGlow(ctx, x, y, s * 1.05, color, 0.6);
	sunRays(ctx, x, y, s * 0.6, s, 12, mix(color, "#ffffff", 0.15), true);
	strokeCircle(ctx, x, y, s * 0.7, rgba(mix(color, "#ffffff", 0.5), 0.7), Math.max(0.8, s * 0.06));
	sunCore(ctx, x, y, s * 0.6, color);
}

function vuTruNebula(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	const blobs: [number, number, number, string][] = [[-0.35, 0.1, 0.62, color], [0.35, -0.12, 0.6, mix(color, "#60a5fa", 0.5)], [0.05, 0.35, 0.5, mix(color, "#f472b6", 0.5)], [0, -0.35, 0.48, mix(color, "#ffffff", 0.3)]];
	for (const [bx, by, br, tint] of blobs)
	{
		const gradient = ctx.createRadialGradient(x + bx * s, y + by * s, 0, x + bx * s, y + by * s, br * s);
		gradient.addColorStop(0, rgba(tint, 0.95));
		gradient.addColorStop(0.6, rgba(tint, 0.5));
		gradient.addColorStop(1, rgba(tint, 0));
		ctx.fillStyle = gradient;
		ctx.beginPath();
		ctx.arc(x + bx * s, y + by * s, br * s, 0, TAU);
		ctx.fill();
	}
	drawSparkle(ctx, x + s * 0.05, y, s * 0.42, "#ffffff");
	fillCircle(ctx, x - s * 0.55, y - s * 0.45, Math.max(0.7, s * 0.06), "#ffffff");
	fillCircle(ctx, x + s * 0.6, y + s * 0.45, Math.max(0.7, s * 0.06), "#ffffff");
}

function spiralArms(ctx: Ctx, x: number, y: number, radius: number, arms: number, color: string, width: number, rotation: number): void
{
	ctx.lineCap = "round";
	for (let arm = 0; arm < arms; arm++)
	{
		const offset = rotation + (arm / arms) * TAU;
		const steps = 14;
		for (let step = 0; step < steps; step++)
		{
			const t0 = step / steps;
			const t1 = (step + 1) / steps;
			const point = (t: number): [number, number] =>
			{
				const angle = offset + t * Math.PI * 1.25;
				const r = radius * (0.12 + 0.88 * t);
				return [x + Math.cos(angle) * r, y + Math.sin(angle) * r * 0.82];
			};
			const [x0, y0] = point(t0);
			const [x1, y1] = point(t1);
			ctx.strokeStyle = rgba(color, 1 - t0 * 0.75);
			ctx.lineWidth = Math.max(0.6, width * (1 - t0 * 0.7));
			ctx.beginPath();
			ctx.moveTo(x0, y0);
			ctx.lineTo(x1, y1);
			ctx.stroke();
		}
	}
}

function vuTruGalaxy(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	drawGlow(ctx, x, y, s, color, 0.5);
	spiralArms(ctx, x, y, s * 0.95, 2, mix(color, "#ffffff", 0.2), s * 0.26, 0.3);
	fillCircle(ctx, x, y, s * 0.24, mix(color, "#ffffff", 0.75));
}

function vuTruUniverse(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	drawGlow(ctx, x, y, s * 1.05, color, 0.55);
	strokeCircle(ctx, x, y, s * 0.94, rgba(mix(color, "#ffffff", 0.4), 0.75), Math.max(0.8, s * 0.07));
	spiralArms(ctx, x, y, s * 0.78, 3, mix(color, "#ffffff", 0.25), s * 0.22, 0.2);
	for (let index = 0; index < 4; index++)
	{
		const angle = Math.PI / 4 + (index / 4) * TAU;
		fillCircle(ctx, x + Math.cos(angle) * s * 0.94, y + Math.sin(angle) * s * 0.94, Math.max(0.9, s * 0.1), "#ffffff");
	}
	drawSparkle(ctx, x, y, s * 0.42, "#ffffff");
}

/*
 * Bộ Mobile Legends: huy hiệu cách điệu theo từng rank (khiên và đầu thú vẽ bằng path, không dùng ảnh gốc của game).
 * Các hàm dưới đây vẽ trong hệ toạ độ đơn vị (xem inUnit): ô biểu tượng là [-1, 1] × [-1, 1], trục y hướng xuống.
 */

const MLBB_GOLD = "#f7c85a";
const MLBB_SILVER = "#e6edf5";
const MLBB_BLUE = "#3fa9f5";
const MLBB_SAPPHIRE = "#2563eb";
const MLBB_PURPLE = "#a855f7";
const MLBB_RED = "#ef4444";
/** Viền đỏ của Vinh Quang (Mythical Glory), cùng mã với `borderColor` của bậc 8. */
const MLBB_GLORY_RED = "#e0364b";
const MLBB_IVORY = "#fff3d6";

type UnitPoint = readonly [number, number];
/** Đoạn của một path: điểm cuối [x, y] (thẳng), [cx, cy, x, y] (cong bậc hai) hoặc [c1x, c1y, c2x, c2y, x, y] (cong bậc ba). */
type UnitSegment = UnitPoint | readonly [number, number, number, number] | readonly [number, number, number, number, number, number];

/** Vẽ trong hệ toạ độ đơn vị: tâm (x, y), cạnh ô `size` ứng với đoạn [-1, 1] trên cả hai trục; `edge` là độ dày nét viền. */
function inUnit(ctx: Ctx, x: number, y: number, size: number, draw: (edge: number) => void): void
{
	ctx.save();
	ctx.translate(x, y);
	ctx.scale(size / 2, size / 2);
	draw(Math.max(0.035, 1.8 / Math.max(1, size)));
	ctx.restore();
}

/** Vẽ một hình ở nửa phải rồi lặp lại, lật qua trục x = 0 cho nửa trái. */
function mirrored(ctx: Ctx, draw: () => void): void
{
	draw();
	ctx.save();
	ctx.scale(-1, 1);
	draw();
	ctx.restore();
}

function segmentEnd(segment: UnitSegment): UnitPoint
{
	if (segment.length === 2) return segment;
	if (segment.length === 4) return [segment[2], segment[3]];
	return [segment[4], segment[5]];
}

function traceSegment(ctx: Ctx, segment: UnitSegment): void
{
	if (segment.length === 2) ctx.lineTo(segment[0], segment[1]);
	else if (segment.length === 4) ctx.quadraticCurveTo(segment[0], segment[1], segment[2], segment[3]);
	else ctx.bezierCurveTo(segment[0], segment[1], segment[2], segment[3], segment[4], segment[5]);
}

/** Path mở theo các đoạn, bắt đầu từ `start`. */
function tracePath(ctx: Ctx, start: UnitPoint, segments: readonly UnitSegment[]): void
{
	ctx.beginPath();
	ctx.moveTo(start[0], start[1]);
	for (const segment of segments) traceSegment(ctx, segment);
}

/**
 * Path khép kín đối xứng qua trục x = 0: `start` (trên trục) và các đoạn của nửa phải từ trên xuống; nửa trái vẽ ngược lại,
 * lật dấu x, nên chỉ cần mô tả một nửa hình.
 */
function mirrorPath(ctx: Ctx, start: UnitPoint, segments: readonly UnitSegment[]): void
{
	tracePath(ctx, start, segments);
	const last = segments.length > 0 ? segmentEnd(segments[segments.length - 1]) : start;
	if (last[0] !== 0) ctx.lineTo(-last[0], last[1]);
	for (let index = segments.length - 1; index >= 0; index--)
	{
		const segment = segments[index];
		const [tx, ty] = index > 0 ? segmentEnd(segments[index - 1]) : start;
		if (segment.length === 2) ctx.lineTo(-tx, ty);
		else if (segment.length === 4) ctx.quadraticCurveTo(-segment[0], segment[1], -tx, ty);
		else ctx.bezierCurveTo(-segment[2], segment[3], -segment[0], segment[1], -tx, ty);
	}
	ctx.closePath();
}

/** Nước kim loại theo chiều dọc: sáng ở trên, một dải tối rồi hắt sáng ở đáy. */
function metalPaint(ctx: Ctx, color: string, top: number, bottom: number): Gradient
{
	return linearGradient(ctx, 0, top, 0, bottom, [mix(color, "#ffffff", 0.6), color, mix(color, "#000000", 0.35), mix(color, "#ffffff", 0.1)]);
}

function inkOf(color: string): string
{
	return mix(color, "#000000", 0.8);
}

/** Tô path hiện tại rồi viền tối (nét viền giúp hình tách khỏi nền tối khi vẽ nhỏ). */
function fillOutlined(ctx: Ctx, paint: Paint, color: string, edge: number): void
{
	ctx.fillStyle = paint;
	ctx.fill();
	ctx.strokeStyle = rgba(inkOf(color), 0.92);
	ctx.lineWidth = edge;
	ctx.stroke();
}

/** Viên đá bầu dục có ổ kim loại và chấm sáng. */
function mlbbStone(ctx: Ctx, x: number, y: number, rx: number, ry: number, stone: string, setting: string, edge: number): void
{
	ctx.beginPath();
	ctx.ellipse(x, y, rx + edge * 1.2, ry + edge * 1.2, 0, 0, TAU);
	fillOutlined(ctx, mix(setting, "#ffffff", 0.2), setting, edge * 0.8);
	const gradient = ctx.createRadialGradient(x - rx * 0.35, y - ry * 0.4, 0, x, y, Math.max(rx, ry));
	gradient.addColorStop(0, mix(stone, "#ffffff", 0.75));
	gradient.addColorStop(0.45, stone);
	gradient.addColorStop(1, mix(stone, "#000000", 0.45));
	ctx.beginPath();
	ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
	ctx.fillStyle = gradient;
	ctx.fill();
	ctx.beginPath();
	ctx.ellipse(x - rx * 0.32, y - ry * 0.38, rx * 0.28, ry * 0.2, -0.5, 0, TAU);
	ctx.fillStyle = rgba("#ffffff", 0.85);
	ctx.fill();
}

/** Mắt xếch phát sáng (đặt ở nửa phải; dùng cùng mirrored). */
function mlbbEye(ctx: Ctx, x: number, y: number, width: number, glow: string, edge: number): void
{
	ctx.beginPath();
	ctx.moveTo(x - width * 0.55, y + width * 0.12);
	ctx.quadraticCurveTo(x, y - width * 0.42, x + width * 0.55, y - width * 0.3);
	ctx.quadraticCurveTo(x + width * 0.1, y + width * 0.32, x - width * 0.55, y + width * 0.12);
	ctx.closePath();
	ctx.fillStyle = glow;
	ctx.fill();
	ctx.strokeStyle = rgba(INK, 0.9);
	ctx.lineWidth = edge * 0.8;
	ctx.stroke();
}

interface WingShape
{
	/** Gốc cánh ở nửa phải. */
	root: UnitPoint;
	feathers: number;
	/** Góc của lông trên cùng và dưới cùng (radian, 0 = sang phải, âm = chếch lên). */
	from: number;
	to: number;
	/** Độ dài lông trên cùng và dưới cùng. */
	longest: number;
	shortest: number;
	/** Bề rộng lông. */
	width: number;
}

/** Cánh lông vũ ở nửa phải: lông dưới vẽ trước, lông trên đè lên; màu lông xen sáng/tối. */
function featherWing(ctx: Ctx, color: string, shape: WingShape, edge: number): void
{
	const steps = Math.max(1, shape.feathers - 1);
	const [rx, ry] = shape.root;
	for (let index = shape.feathers - 1; index >= 0; index--)
	{
		const t = index / steps;
		const angle = shape.from + (shape.to - shape.from) * t;
		const length = shape.longest + (shape.shortest - shape.longest) * t;
		const tipX = rx + Math.cos(angle) * length;
		const tipY = ry + Math.sin(angle) * length;
		const nx = -Math.sin(angle);
		const ny = Math.cos(angle);
		const mx = (rx + tipX) / 2;
		const my = (ry + tipY) / 2;
		const w = shape.width;
		ctx.beginPath();
		ctx.moveTo(rx - nx * w * 0.35, ry - ny * w * 0.35);
		ctx.quadraticCurveTo(mx - nx * w * 0.9, my - ny * w * 0.9, tipX, tipY);
		ctx.quadraticCurveTo(mx + nx * w * 0.75, my + ny * w * 0.75, rx + nx * w * 0.45, ry + ny * w * 0.45);
		ctx.closePath();
		const shade = index % 2 === 0 ? mix(color, "#ffffff", 0.25) : mix(color, "#000000", 0.18);
		fillOutlined(ctx, linearGradient(ctx, rx, ry, tipX, tipY, [mix(shade, "#000000", 0.15), shade, mix(shade, "#ffffff", 0.35)]), color, edge);
	}
}

/** Vương miện năm đỉnh, tâm đáy vành ở (x, y), rộng 2 × `half`, cao `height`, viên đá ở giữa vành. */
function mlbbCrown(ctx: Ctx, x: number, y: number, half: number, height: number, color: string, stone: string, edge: number): void
{
	ctx.beginPath();
	ctx.moveTo(x - half, y);
	ctx.lineTo(x - half * 1.08, y - height * 0.72);
	ctx.lineTo(x - half * 0.55, y - height * 0.34);
	ctx.lineTo(x - half * 0.3, y - height * 0.8);
	ctx.lineTo(x, y - height);
	ctx.lineTo(x + half * 0.3, y - height * 0.8);
	ctx.lineTo(x + half * 0.55, y - height * 0.34);
	ctx.lineTo(x + half * 1.08, y - height * 0.72);
	ctx.lineTo(x + half, y);
	ctx.closePath();
	fillOutlined(ctx, metalPaint(ctx, color, y - height, y), color, edge);
	ctx.beginPath();
	ctx.roundRect(x - half * 1.02, y - height * 0.22, half * 2.04, height * 0.3, height * 0.08);
	fillOutlined(ctx, mix(color, "#000000", 0.25), color, edge * 0.8);
	for (const tip of [-1.08, 1.08]) fillCircle(ctx, x + half * tip, y - height * 0.74, height * 0.1, mix(color, "#ffffff", 0.6));
	fillCircle(ctx, x, y - height * 1.02, height * 0.11, mix(color, "#ffffff", 0.6));
	mlbbStone(ctx, x, y - height * 0.07, height * 0.13, height * 0.11, stone, color, edge * 0.7);
}

/** Đầu đại bàng nhìn nghiêng (mỏ quặp sang trái), đặt trên đỉnh khiên. */
function eagleHead(ctx: Ctx, color: string, edge: number): void
{
	const feather = mix(color, "#ffffff", 0.55);
	tracePath(ctx, [0.2, -0.24], [
		[0.26, -0.5, 0.2, -0.8, -0.02, -0.88],
		[-0.16, -0.92, -0.28, -0.84, -0.31, -0.72],
		[-0.27, -0.54],
		[-0.2, -0.46, -0.16, -0.36, -0.15, -0.24],
		[-0.06, -0.32],
		[0.02, -0.22],
		[0.1, -0.32],
	]);
	ctx.closePath();
	fillOutlined(ctx, linearGradient(ctx, 0, -0.9, 0, -0.24, [mix(feather, "#ffffff", 0.4), feather, mix(color, "#000000", 0.1)]), color, edge);
	tracePath(ctx, [-0.29, -0.76], [
		[-0.46, -0.8, -0.56, -0.62],
		[-0.54, -0.52],
		[-0.5, -0.6, -0.42, -0.58],
		[-0.27, -0.54],
	]);
	ctx.closePath();
	fillOutlined(ctx, linearGradient(ctx, -0.56, -0.8, -0.3, -0.5, [mix(MLBB_GOLD, "#ffffff", 0.3), MLBB_GOLD, mix(MLBB_GOLD, "#b45309", 0.5)]), color, edge);
	ctx.strokeStyle = rgba(INK, 0.9);
	ctx.lineWidth = edge * 1.3;
	ctx.beginPath();
	ctx.moveTo(-0.24, -0.76);
	ctx.lineTo(-0.02, -0.7);
	ctx.stroke();
	fillCircle(ctx, -0.11, -0.66, 0.055, INK);
}

/** Warrior: đại bàng đồng xoè cánh, ngực là tấm khiên có một vạch cấp. */
function mlbbWarrior(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	inUnit(ctx, x, y, size, edge =>
	{
		mirrored(ctx, () => featherWing(ctx, color, { root: [0.18, 0], feathers: 4, from: -1.2, to: -0.12, longest: 0.84, shortest: 0.62, width: 0.3 }, edge));
		shieldPath(ctx, 0, 0.24, 0.44, 0.68);
		fillOutlined(ctx, metalPaint(ctx, color, -0.44, 0.92), color, edge);
		ctx.strokeStyle = rgba(inkOf(color), 0.85);
		ctx.lineWidth = Math.max(edge * 1.6, 0.1);
		ctx.beginPath();
		ctx.moveTo(-0.24, 0.42);
		ctx.lineTo(0, 0.24);
		ctx.lineTo(0.24, 0.42);
		ctx.stroke();
		eagleHead(ctx, color, edge);
	});
}

/** Sừng cừu xoắn ốc ở nửa phải: vẽ viền tối trước rồi thân sừng có vân sáng tối, thêm các ngấn ngang. */
function ramHorn(ctx: Ctx, color: string, edge: number): void
{
	const cx = 0.5;
	const cy = -0.14;
	const steps = 44;
	const points: [number, number, number][] = [];
	for (let step = 0; step <= steps; step++)
	{
		const t = step / steps;
		const angle = -2.5 + t * 5.5;
		const radius = 0.44 - t * 0.3;
		points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, 0.3 - t * 0.19]);
	}
	ctx.lineCap = "round";
	for (const outline of [true, false])
	{
		for (let index = 0; index < steps; index++)
		{
			const [x0, y0, width] = points[index];
			const [x1, y1] = points[index + 1];
			const t = index / steps;
			ctx.strokeStyle = outline ? rgba(inkOf(color), 0.95) : mix(mix(color, "#ffffff", 0.35), mix(color, "#000000", 0.3), Math.abs(Math.sin(t * Math.PI * 1.6)));
			ctx.lineWidth = outline ? width + edge * 2 : width;
			ctx.beginPath();
			ctx.moveTo(x0, y0);
			ctx.lineTo(x1, y1);
			ctx.stroke();
		}
	}
	ctx.strokeStyle = rgba(inkOf(color), 0.6);
	ctx.lineWidth = edge * 0.8;
	for (let index = 3; index < steps - 2; index += 4)
	{
		const [x0, y0, width] = points[index];
		const [x1, y1] = points[index + 1];
		const length = Math.hypot(x1 - x0, y1 - y0) || 1;
		const nx = -(y1 - y0) / length;
		const ny = (x1 - x0) / length;
		ctx.beginPath();
		ctx.moveTo(x0 - nx * width * 0.42, y0 - ny * width * 0.42);
		ctx.lineTo(x0 + nx * width * 0.42, y0 + ny * width * 0.42);
		ctx.stroke();
	}
}

/** Elite: đầu cừu bạc xanh nhìn thẳng, hai sừng xoắn lớn, chỏm lông xoăn trên trán. */
function mlbbElite(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	inUnit(ctx, x, y, size, edge =>
	{
		mirrored(ctx, () => ramHorn(ctx, color, edge));
		mirrorPath(ctx, [0, -0.6], [
			[0.18, -0.62, 0.3, -0.46],
			[0.38, -0.34, 0.35, -0.08, 0.26, 0.14],
			[0.2, 0.32, 0.18, 0.52, 0.13, 0.64],
			[0.08, 0.76, 0, 0.76],
		]);
		fillOutlined(ctx, metalPaint(ctx, mix(color, "#ffffff", 0.15), -0.6, 0.76), color, edge);
		ctx.strokeStyle = rgba("#ffffff", 0.55);
		ctx.lineWidth = edge * 1.2;
		ctx.beginPath();
		ctx.moveTo(0, -0.28);
		ctx.lineTo(0, 0.42);
		ctx.stroke();
		const wool: [number, number, number][] = [[-0.16, -0.5, 0.11], [0.16, -0.5, 0.11], [0, -0.56, 0.13]];
		for (const [wx, wy, wr] of wool)
		{
			ctx.beginPath();
			ctx.arc(wx, wy, wr, 0, TAU);
			fillOutlined(ctx, mix(color, "#ffffff", 0.6), color, edge * 0.8);
		}
		mirrored(ctx, () => mlbbEye(ctx, 0.17, -0.1, 0.2, mix(MLBB_BLUE, "#ffffff", 0.35), edge));
		mirrored(ctx, () =>
		{
			ctx.beginPath();
			ctx.ellipse(0.07, 0.57, 0.035, 0.055, 0.3, 0, TAU);
			ctx.fillStyle = rgba(INK, 0.85);
			ctx.fill();
		});
	});
}

/** Bờm sư tử: vòng các mũi bờm uốn như lửa quanh tâm (cx, cy). */
function manePath(ctx: Ctx, cx: number, cy: number, inner: number, outer: number, spikes: number, rotation: number, swirl: number): void
{
	const step = TAU / spikes;
	const middle = (inner + outer) / 2;
	const at = (angle: number, radius: number): UnitPoint => [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
	ctx.beginPath();
	for (let index = 0; index < spikes; index++)
	{
		const angle = rotation + index * step;
		const [vx, vy] = at(angle - step / 2, inner);
		const [c1x, c1y] = at(angle - step * 0.15, middle * 1.08);
		const [tx, ty] = at(angle + swirl, outer);
		const [c2x, c2y] = at(angle + step * 0.3, middle * 0.98);
		const [ex, ey] = at(angle + step / 2, inner);
		if (index === 0) ctx.moveTo(vx, vy);
		ctx.quadraticCurveTo(c1x, c1y, tx, ty);
		ctx.quadraticCurveTo(c2x, c2y, ex, ey);
	}
	ctx.closePath();
}

function manePaint(ctx: Ctx, color: string, cy: number, radius: number, light: number): Gradient
{
	const gradient = ctx.createRadialGradient(0, cy, radius * 0.2, 0, cy, radius);
	gradient.addColorStop(0, mix(color, "#ffffff", light));
	gradient.addColorStop(0.6, color);
	gradient.addColorStop(1, mix(color, "#000000", 0.4));
	return gradient;
}

/** Mặt sư tử (nhìn thẳng); `roar` = há miệng gầm với nanh, ngược lại miệng khép. */
function lionFace(ctx: Ctx, color: string, edge: number, roar: boolean): void
{
	const skin = mix(color, "#ffffff", 0.25);
	mirrored(ctx, () =>
	{
		ctx.beginPath();
		ctx.arc(0.34, -0.44, 0.12, 0, TAU);
		fillOutlined(ctx, mix(color, "#000000", 0.1), color, edge);
	});
	mirrorPath(ctx, [0, -0.52], [
		[0.22, -0.54, 0.36, -0.4],
		[0.48, -0.26, 0.46, -0.02],
		[0.45, 0.2, 0.3, 0.34],
		[0.18, 0.56, 0, 0.6],
	]);
	fillOutlined(ctx, metalPaint(ctx, skin, -0.52, 0.6), color, edge);
	ctx.fillStyle = rgba("#ffffff", 0.35);
	ctx.beginPath();
	ctx.moveTo(-0.07, -0.42);
	ctx.lineTo(0.07, -0.42);
	ctx.lineTo(0.1, 0.02);
	ctx.lineTo(-0.1, 0.02);
	ctx.closePath();
	ctx.fill();
	const ink = inkOf(color);
	mirrored(ctx, () =>
	{
		ctx.beginPath();
		ctx.moveTo(0.05, -0.15);
		ctx.lineTo(0.36, roar ? -0.3 : -0.24);
		ctx.lineTo(0.36, -0.18);
		ctx.lineTo(0.1, -0.07);
		ctx.closePath();
		ctx.fillStyle = ink;
		ctx.fill();
		fillCircle(ctx, 0.22, -0.11, 0.045, mix(color, "#ffffff", 0.8));
	});
	ctx.beginPath();
	ctx.moveTo(-0.13, 0.01);
	ctx.lineTo(0.13, 0.01);
	ctx.quadraticCurveTo(0.11, 0.12, 0, 0.15);
	ctx.quadraticCurveTo(-0.11, 0.12, -0.13, 0.01);
	ctx.closePath();
	ctx.fillStyle = ink;
	ctx.fill();
	if (roar)
	{
		ctx.beginPath();
		ctx.moveTo(-0.22, 0.2);
		ctx.quadraticCurveTo(0, 0.14, 0.22, 0.2);
		ctx.quadraticCurveTo(0.2, 0.5, 0, 0.53);
		ctx.quadraticCurveTo(-0.2, 0.5, -0.22, 0.2);
		ctx.closePath();
		ctx.fillStyle = mix(MLBB_RED, "#000000", 0.55);
		ctx.fill();
		ctx.strokeStyle = ink;
		ctx.lineWidth = edge;
		ctx.stroke();
		mirrored(ctx, () =>
		{
			ctx.fillStyle = MLBB_IVORY;
			ctx.beginPath();
			ctx.moveTo(0.07, 0.19);
			ctx.lineTo(0.18, 0.2);
			ctx.lineTo(0.12, 0.36);
			ctx.closePath();
			ctx.fill();
			ctx.beginPath();
			ctx.moveTo(0.05, 0.5);
			ctx.lineTo(0.14, 0.47);
			ctx.lineTo(0.08, 0.38);
			ctx.closePath();
			ctx.fill();
		});
		return;
	}
	ctx.strokeStyle = ink;
	ctx.lineWidth = edge * 1.2;
	ctx.beginPath();
	ctx.moveTo(0, 0.15);
	ctx.lineTo(0, 0.26);
	ctx.moveTo(-0.16, 0.3);
	ctx.quadraticCurveTo(-0.08, 0.34, 0, 0.26);
	ctx.quadraticCurveTo(0.08, 0.34, 0.16, 0.3);
	ctx.stroke();
}

/** Master: sư tử vàng gầm, bờm hai lớp như lửa. */
function mlbbMaster(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	inUnit(ctx, x, y, size, edge =>
	{
		manePath(ctx, 0, 0.02, 0.62, 0.98, 14, -Math.PI / 2, 0.16);
		fillOutlined(ctx, manePaint(ctx, mix(color, "#b45309", 0.3), 0.02, 0.98, 0.2), color, edge);
		manePath(ctx, 0, 0.04, 0.5, 0.8, 12, -Math.PI / 2 + Math.PI / 12, 0.12);
		fillOutlined(ctx, manePaint(ctx, color, 0.04, 0.8, 0.45), color, edge);
		lionFace(ctx, color, edge, true);
	});
}

/** Grandmaster: đầu sói trắng bạc trên khiên màu bậc (xanh), mắt xanh băng, viên đá xanh trên trán. */
function mlbbGrandmaster(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	inUnit(ctx, x, y, size, edge =>
	{
		const navy = mix(color, "#0b1a3a", 0.45);
		shieldPath(ctx, 0, 0.12, 0.68, 0.84);
		fillOutlined(ctx, linearGradient(ctx, 0, -0.72, 0, 0.96, [mix(color, "#ffffff", 0.15), navy, mix(navy, "#000000", 0.45)]), color, edge);
		shieldPath(ctx, 0, 0.12, 0.6, 0.76);
		ctx.strokeStyle = MLBB_SILVER;
		ctx.lineWidth = edge * 1.4;
		ctx.stroke();
		const fur = MLBB_SILVER;
		mirrorPath(ctx, [0, -0.42], [
			[0.12, -0.48],
			[0.22, -0.72, 0.42, -0.97],
			[0.52, -0.64, 0.52, -0.36],
			[0.74, -0.16],
			[0.54, -0.08],
			[0.7, 0.14],
			[0.44, 0.16],
			[0.3, 0.42, 0.14, 0.66],
			[0.08, 0.8, 0, 0.8],
		]);
		fillOutlined(ctx, metalPaint(ctx, fur, -0.97, 0.8), navy, edge);
		mirrored(ctx, () =>
		{
			tracePath(ctx, [0.18, -0.52], [[0.26, -0.7, 0.38, -0.84], [0.44, -0.62, 0.42, -0.44]]);
			ctx.closePath();
			ctx.fillStyle = mix(navy, "#000000", 0.2);
			ctx.fill();
		});
		ctx.beginPath();
		ctx.moveTo(-0.34, -0.34);
		ctx.lineTo(0, 0.02);
		ctx.lineTo(0.34, -0.34);
		ctx.lineTo(0.14, -0.4);
		ctx.lineTo(0, -0.26);
		ctx.lineTo(-0.14, -0.4);
		ctx.closePath();
		ctx.fillStyle = rgba("#64748b", 0.6);
		ctx.fill();
		mirrorPath(ctx, [0, -0.02], [[0.14, 0.04, 0.2, 0.2], [0.14, 0.48, 0.1, 0.62], [0.05, 0.7, 0, 0.7]]);
		ctx.fillStyle = mix(fur, "#ffffff", 0.5);
		ctx.fill();
		mirrored(ctx, () => mlbbEye(ctx, 0.2, -0.1, 0.22, mix(MLBB_BLUE, "#ffffff", 0.3), edge));
		ctx.beginPath();
		ctx.moveTo(-0.1, 0.6);
		ctx.quadraticCurveTo(0, 0.54, 0.1, 0.6);
		ctx.quadraticCurveTo(0.06, 0.7, 0, 0.72);
		ctx.quadraticCurveTo(-0.06, 0.7, -0.1, 0.6);
		ctx.closePath();
		ctx.fillStyle = INK;
		ctx.fill();
		mlbbStone(ctx, 0, -0.36, 0.09, 0.11, MLBB_SAPPHIRE, MLBB_SILVER, edge);
	});
}

/** Epic: đầu tê giác bọc giáp xanh ngọc viền vàng, sừng lớn giữa mặt, trên tấm khiên lục giác. */
function mlbbEpic(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	inUnit(ctx, x, y, size, edge =>
	{
		const gold = MLBB_GOLD;
		const plate = mix(color, "#04121a", 0.72);
		mirrorPath(ctx, [0, -0.9], [[0.74, -0.52], [0.74, 0.38], [0, 0.96]]);
		fillOutlined(ctx, linearGradient(ctx, 0, -0.9, 0, 0.96, [mix(plate, "#ffffff", 0.12), plate]), color, edge);
		mirrorPath(ctx, [0, -0.8], [[0.64, -0.46], [0.64, 0.33], [0, 0.85]]);
		ctx.strokeStyle = gold;
		ctx.lineWidth = edge * 1.5;
		ctx.stroke();
		mirrored(ctx, () =>
		{
			tracePath(ctx, [0.3, -0.42], [[0.46, -0.78, 0.66, -0.8], [0.62, -0.56, 0.48, -0.32]]);
			ctx.closePath();
			fillOutlined(ctx, metalPaint(ctx, color, -0.8, -0.32), color, edge);
		});
		mirrorPath(ctx, [0, -0.6], [
			[0.3, -0.62, 0.46, -0.42],
			[0.58, -0.2, 0.52, 0.1],
			[0.44, 0.34, 0.3, 0.5],
			[0.22, 0.72, 0, 0.74],
		]);
		fillOutlined(ctx, metalPaint(ctx, color, -0.62, 0.74), color, edge);
		ctx.strokeStyle = gold;
		ctx.lineWidth = Math.max(edge * 1.6, 0.07);
		ctx.beginPath();
		ctx.moveTo(-0.44, -0.3);
		ctx.quadraticCurveTo(0, -0.52, 0.44, -0.3);
		ctx.moveTo(-0.5, 0.02);
		ctx.quadraticCurveTo(-0.36, -0.08, -0.26, 0.04);
		ctx.moveTo(0.5, 0.02);
		ctx.quadraticCurveTo(0.36, -0.08, 0.26, 0.04);
		ctx.stroke();
		mirrored(ctx, () => mlbbEye(ctx, 0.33, -0.12, 0.16, mix(gold, "#ffffff", 0.3), edge));
		tracePath(ctx, [-0.2, 0.48], [[-0.2, -0.1, 0.05, -0.86], [0.12, -0.2, 0.2, 0.48], [0, 0.58, -0.2, 0.48]]);
		ctx.closePath();
		fillOutlined(ctx, linearGradient(ctx, 0, -0.86, 0, 0.5, [MLBB_IVORY, mix(MLBB_IVORY, gold, 0.5), mix(gold, "#92400e", 0.35)]), color, edge);
		mirrored(ctx, () =>
		{
			ctx.beginPath();
			ctx.ellipse(0.2, 0.58, 0.05, 0.035, 0.4, 0, TAU);
			ctx.fillStyle = rgba(INK, 0.85);
			ctx.fill();
		});
	});
}

/** Legend: sư tử đội vương miện trên khiên vàng đồng, cánh vàng hai bên, đá xanh ở vương miện và đáy khiên. */
function mlbbLegend(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	inUnit(ctx, x, y, size, edge =>
	{
		mirrored(ctx, () => featherWing(ctx, MLBB_GOLD, { root: [0.4, 0.1], feathers: 5, from: -1, to: 0.35, longest: 0.62, shortest: 0.44, width: 0.24 }, edge));
		shieldPath(ctx, 0, 0.16, 0.6, 0.8);
		fillOutlined(ctx, metalPaint(ctx, mix(color, "#000000", 0.15), -0.64, 0.96), color, edge);
		ctx.save();
		ctx.translate(0, 0.08);
		ctx.scale(0.8, 0.8);
		manePath(ctx, 0, 0.02, 0.56, 0.84, 12, -Math.PI / 2, 0.08);
		fillOutlined(ctx, manePaint(ctx, color, 0.02, 0.84, 0.3), color, edge / 0.8);
		lionFace(ctx, color, edge / 0.8, false);
		ctx.restore();
		mlbbCrown(ctx, 0, -0.44, 0.34, 0.4, MLBB_GOLD, MLBB_BLUE, edge);
		mlbbStone(ctx, 0, 0.78, 0.09, 0.08, MLBB_BLUE, color, edge);
	});
}

/** Đầu rồng nhìn thẳng (không gồm sừng): gờ mày, vây má nhọn, mõm dài, mắt phát sáng màu `eye`. */
function dragonHead(ctx: Ctx, gold: string, eye: string, edge: number): void
{
	mirrorPath(ctx, [0, -0.56], [
		[0.2, -0.58, 0.32, -0.44],
		[0.44, -0.38],
		[0.66, -0.22],
		[0.46, -0.1],
		[0.62, 0.08],
		[0.38, 0.12],
		[0.28, 0.38, 0.2, 0.62],
		[0.14, 0.8, 0, 0.8],
	]);
	fillOutlined(ctx, metalPaint(ctx, gold, -0.58, 0.8), gold, edge);
	const ink = inkOf(gold);
	ctx.strokeStyle = rgba(ink, 0.8);
	ctx.lineWidth = edge;
	ctx.beginPath();
	ctx.moveTo(-0.3, -0.34);
	ctx.quadraticCurveTo(0, -0.2, 0.3, -0.34);
	ctx.moveTo(-0.16, 0.2);
	ctx.quadraticCurveTo(0, 0.28, 0.16, 0.2);
	ctx.stroke();
	mirrored(ctx, () =>
	{
		drawGlow(ctx, 0.2, -0.12, 0.22, eye, 0.7);
		mlbbEye(ctx, 0.2, -0.12, 0.24, mix(eye, "#ffffff", 0.25), edge);
		ctx.beginPath();
		ctx.ellipse(0.08, 0.66, 0.035, 0.05, 0.4, 0, TAU);
		ctx.fillStyle = rgba(ink, 0.9);
		ctx.fill();
		ctx.fillStyle = MLBB_IVORY;
		ctx.beginPath();
		ctx.moveTo(0.14, 0.5);
		ctx.lineTo(0.22, 0.48);
		ctx.lineTo(0.17, 0.66);
		ctx.closePath();
		ctx.fill();
	});
}

/** Sừng rồng thuôn nhọn ở nửa phải, từ gốc `base` uốn qua `bend` tới ngọn `tip`. */
function dragonHorn(ctx: Ctx, gold: string, base: UnitPoint, tip: UnitPoint, bend: UnitPoint, width: number, edge: number): void
{
	const [bx, by] = base;
	const [tx, ty] = tip;
	const [kx, ky] = bend;
	const length = Math.hypot(tx - bx, ty - by) || 1;
	const nx = -(ty - by) / length;
	const ny = (tx - bx) / length;
	ctx.beginPath();
	ctx.moveTo(bx + nx * width * 0.5, by + ny * width * 0.5);
	ctx.quadraticCurveTo(kx + nx * width * 0.45, ky + ny * width * 0.45, tx, ty);
	ctx.quadraticCurveTo(kx - nx * width * 0.2, ky - ny * width * 0.2, bx - nx * width * 0.5, by - ny * width * 0.5);
	ctx.closePath();
	fillOutlined(ctx, linearGradient(ctx, bx, by, tx, ty, [mix(gold, "#000000", 0.25), gold, mix(gold, "#ffffff", 0.55)]), gold, edge);
}

/** Cánh rồng (màng dơi) ở nửa phải: ba xương cánh vàng toả từ gốc, màng tím lượn sóng giữa các đầu xương. */
function dragonWing(ctx: Ctx, membrane: string, bone: string, edge: number): void
{
	const root: UnitPoint = [0.3, 0.02];
	const tips: UnitPoint[] = [[0.9, -0.62], [1, -0.08], [0.82, 0.42]];
	tracePath(ctx, root, [
		[0.52, -0.5, tips[0][0], tips[0][1]],
		[0.8, -0.3, tips[1][0], tips[1][1]],
		[0.78, 0.14, tips[2][0], tips[2][1]],
		[0.56, 0.3, 0.32, 0.3],
	]);
	ctx.closePath();
	fillOutlined(ctx, linearGradient(ctx, 0.3, 0, 1, 0, [mix(membrane, "#000000", 0.35), membrane, mix(membrane, "#ffffff", 0.3)]), membrane, edge);
	ctx.strokeStyle = bone;
	ctx.lineWidth = Math.max(edge * 1.3, 0.05);
	ctx.beginPath();
	for (const [tx, ty] of tips)
	{
		ctx.moveTo(root[0], root[1]);
		ctx.quadraticCurveTo((root[0] + tx) / 2, (root[1] + ty) / 2 - 0.12, tx, ty);
	}
	ctx.stroke();
}

/** Mythic: rồng vàng mắt tím, sừng dài vuốt ngược, cánh màng màu bậc (tím) phía sau, đá tím trên trán. */
function mlbbMythic(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	inUnit(ctx, x, y, size, edge =>
	{
		const gold = MLBB_GOLD;
		const purple = mix(color, MLBB_PURPLE, 0.3);
		mirrored(ctx, () => dragonWing(ctx, mix(purple, "#1e1b4b", 0.15), gold, edge));
		mirrored(ctx, () => dragonHorn(ctx, gold, [0.24, -0.44], [0.74, -0.98], [0.3, -0.84], 0.26, edge));
		dragonHead(ctx, gold, purple, edge);
		mlbbStone(ctx, 0, -0.44, 0.08, 0.1, purple, gold, edge);
	});
}

/** Mythical Glory: rồng vàng sừng lớn hình lưỡi liềm trên khiên tím viền đỏ và vàng, đá đỏ trên trán, ngôi sao trên đỉnh khiên. */
function mlbbGlory(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	inUnit(ctx, x, y, size, edge =>
	{
		const gold = MLBB_GOLD;
		shieldPath(ctx, 0, 0.1, 0.74, 0.86);
		fillOutlined(ctx, linearGradient(ctx, 0, -0.76, 0, 0.96, [mix(color, "#ffffff", 0.2), color, mix(color, "#1e0538", 0.6)]), color, edge);
		ctx.strokeStyle = MLBB_GLORY_RED;
		ctx.lineWidth = Math.max(edge * 2.2, 0.1);
		ctx.stroke();
		shieldPath(ctx, 0, 0.1, 0.66, 0.78);
		ctx.strokeStyle = gold;
		ctx.lineWidth = Math.max(edge * 1.2, 0.05);
		ctx.stroke();
		shieldPath(ctx, 0, 0.1, 0.58, 0.7);
		ctx.strokeStyle = rgba(gold, 0.7);
		ctx.lineWidth = edge;
		ctx.stroke();
		starPath(ctx, 0, -0.84, 0.16, 0.07, 5);
		fillOutlined(ctx, mix(gold, "#ffffff", 0.3), gold, edge);
		mirrored(ctx, () =>
		{
			ctx.beginPath();
			ctx.moveTo(0.16, -0.04);
			ctx.bezierCurveTo(0.72, -0.06, 1.02, -0.4, 0.84, -0.98);
			ctx.bezierCurveTo(0.76, -0.56, 0.54, -0.38, 0.14, -0.3);
			ctx.closePath();
			fillOutlined(ctx, linearGradient(ctx, 0.2, -0.2, 0.84, -0.98, [mix(gold, "#000000", 0.3), gold, mix(gold, "#ffffff", 0.6)]), gold, edge);
		});
		ctx.save();
		ctx.translate(0, 0.14);
		ctx.scale(0.78, 0.78);
		dragonHead(ctx, gold, MLBB_RED, edge / 0.78);
		ctx.restore();
		mlbbStone(ctx, 0, -0.28, 0.09, 0.11, MLBB_RED, gold, edge);
	});
}

const EMBLEMS: Readonly<Record<TierSetKey, readonly EmblemDrawer[]>> = {
	"tu-tien": [tuTienSprout, tuTienFoundation, tuTienCore, tuTienInfant, tuTienFlame, tuTienVoid, tuTienTaiji, tuTienBolt],
	"rank-game": [shieldWithChevrons(1), shieldWithChevrons(2), shieldWithChevrons(3), rankStarShield, rankGem, rankWingedGem, rankWingedShield, rankChallenger],
	"kiem-hiep": [kiemHiepScroll, kiemHiepSword, kiemHiepFan, kiemHiepCrossed, kiemHiepWanderer, kiemHiepAura, kiemHiepToken, kiemHiepLeader],
	"cay-xanh": [cayXanhSeed, cayXanhSprout, cayXanhSapling, cayXanhFlower, cayXanhFruit, cayXanhTree, cayXanhPine, cayXanhGreatTree],
	"vu-tru": [vuTruMeteor, vuTruAsteroid, vuTruPlanet, vuTruStar, vuTruGiant, vuTruNebula, vuTruGalaxy, vuTruUniverse],
	"mobile-legends": [mlbbWarrior, mlbbElite, mlbbMaster, mlbbGrandmaster, mlbbEpic, mlbbLegend, mlbbMythic, mlbbGlory],
};

function emblemFor(setKey: string | null, index: number | null): EmblemDrawer | null
{
	if (setKey === null || !isTierSetKey(setKey) || index === null || !Number.isInteger(index)) return null;
	const drawers = EMBLEMS[setKey];
	return index >= 0 && index < drawers.length ? drawers[index] : null;
}

/** Có biểu tượng riêng cho (bộ, vị trí bậc) này không; false thì drawTierEmblem vẽ biểu tượng dự phòng. */
export function hasTierEmblem(setKey: string | null, index: number | null): boolean
{
	return emblemFor(setKey, index) !== null;
}

/**
 * Vẽ biểu tượng của bậc thứ `index` (0–7) trong bộ `setKey`. Bộ lạ hoặc vị trí lạ thì vẽ viên linh châu dự phòng; không throw.
 */
export function drawTierEmblem(ctx: Ctx, setKey: string | null, index: number | null, x: number, y: number, size: number, color: string): void
{
	const drawer = emblemFor(setKey, index);
	ctx.save();
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	if (drawer) drawer(ctx, x, y, size, color);
	else drawOrb(ctx, x, y, size, color);
	ctx.restore();
}
