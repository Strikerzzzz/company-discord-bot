import { Ctx, fillCircle, linearGradient, mix, rgba, strokeCircle, TAU } from "./draw";

/*
 * Biểu tượng vẽ bằng path (font không có emoji). Mỗi hàm vẽ trong ô vuông cạnh `size` có tâm (x, y) và không đổi trạng thái ctx.
 */

/** Ngôi sao 4 cánh lấp lánh. */
export function drawSparkle(ctx: Ctx, x: number, y: number, size: number, color: string, alpha = 1): void
{
	ctx.save();
	ctx.fillStyle = rgba(color, alpha);
	ctx.beginPath();
	ctx.moveTo(x, y - size);
	ctx.quadraticCurveTo(x, y, x + size, y);
	ctx.quadraticCurveTo(x, y, x, y + size);
	ctx.quadraticCurveTo(x, y, x - size, y);
	ctx.quadraticCurveTo(x, y, x, y - size);
	ctx.fill();
	ctx.restore();
}

export function starPath(ctx: Ctx, x: number, y: number, outer: number, inner: number, points: number, rotation = -Math.PI / 2): void
{
	ctx.beginPath();
	for (let index = 0; index < points * 2; index++)
	{
		const radius = index % 2 === 0 ? outer : inner;
		const angle = rotation + (index * Math.PI) / points;
		const px = x + Math.cos(angle) * radius;
		const py = y + Math.sin(angle) * radius;
		if (index === 0) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
	}
	ctx.closePath();
}

export function drawStar(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	ctx.save();
	starPath(ctx, x, y, size * 0.5, size * 0.22, 5);
	ctx.fillStyle = color;
	ctx.fill();
	ctx.restore();
}

function flamePath(ctx: Ctx, x: number, y: number, size: number): void
{
	const s = size / 2;
	ctx.beginPath();
	ctx.moveTo(x, y + s);
	ctx.bezierCurveTo(x - s * 0.95, y + s, x - s * 0.95, y + s * 0.05, x - s * 0.5, y - s * 0.35);
	ctx.bezierCurveTo(x - s * 0.4, y - s * 0.05, x - s * 0.2, y + s * 0.05, x - s * 0.12, y - s * 0.1);
	ctx.bezierCurveTo(x - s * 0.3, y - s * 0.55, x - s * 0.05, y - s * 0.85, x + s * 0.1, y - s);
	ctx.bezierCurveTo(x + s * 0.15, y - s * 0.6, x + s * 0.95, y - s * 0.35, x + s * 0.85, y + s * 0.3);
	ctx.bezierCurveTo(x + s * 0.8, y + s * 0.8, x + s * 0.4, y + s, x, y + s);
	ctx.closePath();
}

/** Ngọn lửa hai lớp; `lit` = false thì vẽ màu tro (chuỗi đã tắt). */
export function drawFlame(ctx: Ctx, x: number, y: number, size: number, lit: boolean, outer = "#ff7a2f", inner = "#ffd54f"): void
{
	ctx.save();
	const top = y - size / 2;
	const bottom = y + size / 2;
	flamePath(ctx, x, y, size);
	ctx.fillStyle = lit ? linearGradient(ctx, x, bottom, x, top, [mix(outer, "#d32f2f", 0.35), outer, mix(outer, inner, 0.6)]) : "#5d6285";
	ctx.fill();
	flamePath(ctx, x + size * 0.03, y + size * 0.2, size * 0.55);
	ctx.fillStyle = lit ? linearGradient(ctx, x, bottom, x, y - size * 0.1, ["#fff8e1", inner]) : "#8a8fb3";
	ctx.fill();
	ctx.restore();
}

/** Cúp vàng. */
export function drawTrophy(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	ctx.save();
	ctx.fillStyle = color;
	ctx.strokeStyle = color;
	ctx.lineWidth = Math.max(1.5, size * 0.09);
	ctx.beginPath();
	ctx.moveTo(x - s * 0.62, y - s * 0.8);
	ctx.lineTo(x + s * 0.62, y - s * 0.8);
	ctx.bezierCurveTo(x + s * 0.62, y + s * 0.05, x + s * 0.3, y + s * 0.25, x, y + s * 0.25);
	ctx.bezierCurveTo(x - s * 0.3, y + s * 0.25, x - s * 0.62, y + s * 0.05, x - s * 0.62, y - s * 0.8);
	ctx.fill();
	ctx.beginPath();
	ctx.arc(x - s * 0.62, y - s * 0.4, s * 0.3, Math.PI * 0.5, Math.PI * 1.5);
	ctx.stroke();
	ctx.beginPath();
	ctx.arc(x + s * 0.62, y - s * 0.4, s * 0.3, -Math.PI * 0.5, Math.PI * 0.5);
	ctx.stroke();
	ctx.fillRect(x - s * 0.1, y + s * 0.2, s * 0.2, s * 0.4);
	ctx.beginPath();
	ctx.roundRect(x - s * 0.5, y + s * 0.58, s, s * 0.26, s * 0.08);
	ctx.fill();
	ctx.restore();
}

/** Mũi tên đi lên trên nền cột (XP tuần). */
export function drawRising(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	ctx.save();
	ctx.fillStyle = rgba(color, 0.55);
	const bars = [0.35, 0.6, 0.95];
	bars.forEach((height, index) =>
	{
		const bx = x - s * 0.85 + index * s * 0.62;
		ctx.fillRect(bx, y + s * 0.85 - s * height * 1.2, s * 0.42, s * height * 1.2);
	});
	ctx.strokeStyle = color;
	ctx.lineWidth = Math.max(1.5, size * 0.1);
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.beginPath();
	ctx.moveTo(x - s * 0.9, y + s * 0.2);
	ctx.lineTo(x - s * 0.25, y - s * 0.3);
	ctx.lineTo(x + s * 0.1, y - s * 0.05);
	ctx.lineTo(x + s * 0.8, y - s * 0.75);
	ctx.stroke();
	ctx.beginPath();
	ctx.moveTo(x + s * 0.35, y - s * 0.8);
	ctx.lineTo(x + s * 0.85, y - s * 0.8);
	ctx.lineTo(x + s * 0.85, y - s * 0.3);
	ctx.stroke();
	ctx.restore();
}

/** Huy hiệu lục giác có ngôi sao. */
export function drawBadge(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	ctx.save();
	ctx.beginPath();
	for (let index = 0; index < 6; index++)
	{
		const angle = -Math.PI / 2 + (index * Math.PI) / 3;
		const px = x + Math.cos(angle) * s;
		const py = y + Math.sin(angle) * s;
		if (index === 0) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
	}
	ctx.closePath();
	ctx.fillStyle = color;
	ctx.fill();
	starPath(ctx, x, y + s * 0.04, s * 0.55, s * 0.24, 5);
	ctx.fillStyle = "#1a1d33";
	ctx.fill();
	ctx.restore();
}

/** Hai người (team). */
export function drawGroup(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	ctx.save();
	ctx.fillStyle = rgba(color, 0.6);
	fillCircle(ctx, x + s * 0.42, y - s * 0.38, s * 0.3, rgba(color, 0.6));
	ctx.beginPath();
	ctx.ellipse(x + s * 0.42, y + s * 0.55, s * 0.5, s * 0.42, 0, Math.PI, TAU);
	ctx.fill();
	fillCircle(ctx, x - s * 0.22, y - s * 0.3, s * 0.36, color);
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.ellipse(x - s * 0.22, y + s * 0.75, s * 0.62, s * 0.55, 0, Math.PI, TAU);
	ctx.fill();
	ctx.restore();
}

/** Tia sét. */
export function boltPath(ctx: Ctx, x: number, y: number, size: number): void
{
	const s = size / 2;
	ctx.beginPath();
	ctx.moveTo(x + s * 0.2, y - s);
	ctx.lineTo(x - s * 0.55, y + s * 0.12);
	ctx.lineTo(x - s * 0.02, y + s * 0.12);
	ctx.lineTo(x - s * 0.25, y + s);
	ctx.lineTo(x + s * 0.58, y - s * 0.2);
	ctx.lineTo(x + s * 0.05, y - s * 0.2);
	ctx.closePath();
}

function drawLeaf(ctx: Ctx, x: number, y: number, size: number, angle: number, color: string): void
{
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(angle);
	ctx.beginPath();
	ctx.moveTo(0, 0);
	ctx.quadraticCurveTo(size * 0.5, -size * 0.35, size, 0);
	ctx.quadraticCurveTo(size * 0.5, size * 0.35, 0, 0);
	ctx.fillStyle = color;
	ctx.fill();
	ctx.restore();
}

/**
 * Biểu tượng của từng cảnh giới (thay cho emoji trong tin nhắn): mầm cây, nền đá, kim đan, nguyên anh, lửa, xoáy hư không,
 * thái cực và tia sét. `key` là TierKey; key lạ thì vẽ viên linh châu.
 */
export function drawTierEmblem(ctx: Ctx, key: string, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	ctx.save();
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	switch (key)
	{
	case "bac-1":
	{
		ctx.strokeStyle = color;
		ctx.lineWidth = Math.max(1.5, size * 0.11);
		ctx.beginPath();
		ctx.moveTo(x, y + s * 0.9);
		ctx.quadraticCurveTo(x - s * 0.05, y + s * 0.2, x, y - s * 0.1);
		ctx.stroke();
		drawLeaf(ctx, x, y - s * 0.05, s * 0.95, -Math.PI * 0.2, color);
		drawLeaf(ctx, x, y + s * 0.2, s * 0.8, -Math.PI * 0.85, mix(color, "#ffffff", 0.25));
		break;
	}
	case "bac-2":
	{
		const bricks: [number, number, number][] = [[-0.95, 0.42, 0.92], [0.03, 0.42, 0.92], [-0.66, -0.14, 0.63], [0.03, -0.14, 0.63], [-0.34, -0.7, 0.68]];
		bricks.forEach(([left, top, width], index) =>
		{
			ctx.fillStyle = index < 2 ? mix(color, "#000000", 0.15) : index < 4 ? color : mix(color, "#ffffff", 0.3);
			ctx.beginPath();
			ctx.roundRect(x + left * s, y + top * s, width * s, s * 0.5, s * 0.1);
			ctx.fill();
		});
		break;
	}
	case "bac-3":
	{
		const gradient = ctx.createRadialGradient(x - s * 0.3, y - s * 0.35, s * 0.1, x, y, s * 0.85);
		gradient.addColorStop(0, "#fffde7");
		gradient.addColorStop(0.45, color);
		gradient.addColorStop(1, mix(color, "#8d4a00", 0.55));
		fillCircle(ctx, x, y, s * 0.78, gradient);
		strokeCircle(ctx, x, y, s * 0.95, rgba(color, 0.7), Math.max(1, size * 0.06));
		break;
	}
	case "bac-4":
	{
		strokeCircle(ctx, x, y - s * 0.62, s * 0.38, color, Math.max(1.2, size * 0.07));
		fillCircle(ctx, x, y - s * 0.05, s * 0.3, color);
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.moveTo(x - s * 0.62, y + s * 0.95);
		ctx.quadraticCurveTo(x - s * 0.55, y + s * 0.25, x, y + s * 0.25);
		ctx.quadraticCurveTo(x + s * 0.55, y + s * 0.25, x + s * 0.62, y + s * 0.95);
		ctx.closePath();
		ctx.fill();
		break;
	}
	case "bac-5":
	{
		drawFlame(ctx, x, y, size * 0.95, true, color, mix(color, "#ffe082", 0.7));
		break;
	}
	case "bac-6":
	{
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
		break;
	}
	case "bac-7":
	{
		const r = s * 0.9;
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
		break;
	}
	case "bac-8":
	{
		boltPath(ctx, x, y, size);
		ctx.fillStyle = linearGradient(ctx, x, y - s, x, y + s, ["#fff8d6", color, mix(color, "#ff6f00", 0.4)]);
		ctx.fill();
		break;
	}
	default:
	{
		const gradient = ctx.createRadialGradient(x - s * 0.3, y - s * 0.3, s * 0.1, x, y, s);
		gradient.addColorStop(0, "#ffffff");
		gradient.addColorStop(1, color);
		fillCircle(ctx, x, y, s * 0.8, gradient);
	}
	}
	ctx.restore();
}

const MEDALS: Record<1 | 2 | 3, { light: string; base: string; dark: string; ribbon: string }> = {
	1: { light: "#fff4c2", base: "#ffc83d", dark: "#b8740a", ribbon: "#e53935" },
	2: { light: "#ffffff", base: "#cfd8e3", dark: "#7b8797", ribbon: "#1e88e5" },
	3: { light: "#ffe0c7", base: "#e59a62", dark: "#8a4a22", ribbon: "#43a047" },
};

export function medalColor(rank: 1 | 2 | 3): string
{
	return MEDALS[rank].base;
}

/** Huy chương có dải ruy băng, số hạng ở giữa. */
export function drawMedal(ctx: Ctx, rank: 1 | 2 | 3, x: number, y: number, radius: number, label: string, labelFont: string): void
{
	const colors = MEDALS[rank];
	ctx.save();
	const ribbonTop = y - radius - radius * 0.55;
	ctx.fillStyle = colors.ribbon;
	ctx.beginPath();
	ctx.moveTo(x - radius * 0.75, ribbonTop);
	ctx.lineTo(x - radius * 0.2, ribbonTop);
	ctx.lineTo(x + radius * 0.25, y - radius * 0.5);
	ctx.lineTo(x - radius * 0.3, y - radius * 0.5);
	ctx.closePath();
	ctx.fill();
	ctx.fillStyle = mix(colors.ribbon, "#000000", 0.25);
	ctx.beginPath();
	ctx.moveTo(x + radius * 0.75, ribbonTop);
	ctx.lineTo(x + radius * 0.2, ribbonTop);
	ctx.lineTo(x - radius * 0.25, y - radius * 0.5);
	ctx.lineTo(x + radius * 0.3, y - radius * 0.5);
	ctx.closePath();
	ctx.fill();

	ctx.shadowColor = rgba(colors.base, 0.55);
	ctx.shadowBlur = radius * 0.7;
	const body = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.4, radius * 0.1, x, y, radius);
	body.addColorStop(0, colors.light);
	body.addColorStop(0.55, colors.base);
	body.addColorStop(1, colors.dark);
	fillCircle(ctx, x, y, radius, body);
	ctx.shadowBlur = 0;
	strokeCircle(ctx, x, y, radius * 0.78, rgba(colors.light, 0.8), Math.max(1, radius * 0.08));

	ctx.fillStyle = mix(colors.dark, "#000000", 0.45);
	ctx.font = labelFont;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(label, x, y + radius * 0.04);
	ctx.restore();
}
