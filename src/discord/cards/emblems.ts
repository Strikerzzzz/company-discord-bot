import { isTierSetKey, TierSetKey } from "../../modules/activity/tiers";
import { Ctx, drawGlow, fillCircle, Gradient, linearGradient, mix, rgba, strokeCircle, TAU } from "./draw";
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

const EMBLEMS: Readonly<Record<TierSetKey, readonly EmblemDrawer[]>> = {
	"tu-tien": [tuTienSprout, tuTienFoundation, tuTienCore, tuTienInfant, tuTienFlame, tuTienVoid, tuTienTaiji, tuTienBolt],
	"rank-game": [shieldWithChevrons(1), shieldWithChevrons(2), shieldWithChevrons(3), rankStarShield, rankGem, rankWingedGem, rankWingedShield, rankChallenger],
	"kiem-hiep": [kiemHiepScroll, kiemHiepSword, kiemHiepFan, kiemHiepCrossed, kiemHiepWanderer, kiemHiepAura, kiemHiepToken, kiemHiepLeader],
	"cay-xanh": [cayXanhSeed, cayXanhSprout, cayXanhSapling, cayXanhFlower, cayXanhFruit, cayXanhTree, cayXanhPine, cayXanhGreatTree],
	"vu-tru": [vuTruMeteor, vuTruAsteroid, vuTruPlanet, vuTruStar, vuTruGiant, vuTruNebula, vuTruGalaxy, vuTruUniverse],
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
