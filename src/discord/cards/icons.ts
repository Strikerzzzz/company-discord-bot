import { Ctx, fillCircle, linearGradient, mix, Paint, rgba, strokeCircle, TAU } from "./draw";

/*
 * Biểu tượng vẽ bằng path (font không có emoji). Mỗi hàm vẽ trong ô vuông cạnh `size` có tâm (x, y) và không đổi trạng thái ctx.
 * Biểu tượng bậc của từng bộ danh hiệu nằm ở emblems.ts; file này chứa biểu tượng chung và các hình cơ bản dùng lại.
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

export function drawStar(ctx: Ctx, x: number, y: number, size: number, color: Paint): void
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

/** Đường lục giác đều; `rotation` = 0 là lục giác đầu bằng (hai đỉnh nằm ngang hai bên), -π/2 là lục giác đầu nhọn. */
export function hexagonPath(ctx: Ctx, x: number, y: number, radius: number, rotation = 0): void
{
	ctx.beginPath();
	for (let index = 0; index < 6; index++)
	{
		const angle = rotation + (index * Math.PI) / 3;
		const px = x + Math.cos(angle) * radius;
		const py = y + Math.sin(angle) * radius;
		if (index === 0) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
	}
	ctx.closePath();
}

/** Huy hiệu lục giác có ngôi sao. */
export function drawBadge(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	ctx.save();
	hexagonPath(ctx, x, y, s, -Math.PI / 2);
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

/** Chiếc lá mọc từ gốc (x, y) theo hướng `angle` (0 = sang phải), dài `size`; `width` là độ bầu của lá so với chiều dài. */
export function drawLeaf(ctx: Ctx, x: number, y: number, size: number, angle: number, color: Paint, width = 0.35): void
{
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(angle);
	ctx.beginPath();
	ctx.moveTo(0, 0);
	ctx.quadraticCurveTo(size * 0.5, -size * width, size, 0);
	ctx.quadraticCurveTo(size * 0.5, size * width, 0, 0);
	ctx.fillStyle = color;
	ctx.fill();
	ctx.restore();
}

/** Bông hoa 5 cánh, tâm (x, y), đường kính `size`. */
export function drawFlower(ctx: Ctx, x: number, y: number, size: number, petal: string, center: string, rotation = 0): void
{
	const s = size / 2;
	ctx.save();
	for (let index = 0; index < 5; index++)
	{
		const angle = rotation - Math.PI / 2 + (index * TAU) / 5;
		ctx.beginPath();
		ctx.ellipse(x + Math.cos(angle) * s * 0.52, y + Math.sin(angle) * s * 0.52, s * 0.48, s * 0.3, angle, 0, TAU);
		ctx.fillStyle = index % 2 === 0 ? petal : mix(petal, "#ffffff", 0.18);
		ctx.fill();
	}
	fillCircle(ctx, x, y, s * 0.3, center);
	ctx.restore();
}

/**
 * Thanh kiếm dài `length`, tâm (x, y); `angle` = 0 thì mũi kiếm chỉ lên, tăng theo chiều kim đồng hồ.
 * `thickness` là nửa bề rộng lưỡi so với chiều dài (biểu tượng nhỏ cần lưỡi dày hơn để dễ nhìn).
 */
export function drawSword(ctx: Ctx, x: number, y: number, length: number, angle: number, blade: string, guard: string, thickness = 0.045): void
{
	const tip = -length / 2;
	const guardY = tip + length * 0.68;
	const half = Math.max(0.8, length * thickness);
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(angle);
	ctx.beginPath();
	ctx.moveTo(0, tip);
	ctx.lineTo(half, tip + half * 2.6);
	ctx.lineTo(half, guardY);
	ctx.lineTo(-half, guardY);
	ctx.lineTo(-half, tip + half * 2.6);
	ctx.closePath();
	ctx.fillStyle = linearGradient(ctx, -half, 0, half, 0, [mix(blade, "#ffffff", 0.6), blade, mix(blade, "#000000", 0.3)]);
	ctx.fill();
	ctx.strokeStyle = rgba("#ffffff", 0.5);
	ctx.lineWidth = Math.max(0.5, half * 0.35);
	ctx.beginPath();
	ctx.moveTo(0, tip + half * 3);
	ctx.lineTo(0, guardY - half);
	ctx.stroke();
	ctx.fillStyle = guard;
	ctx.beginPath();
	ctx.roundRect(-length * 0.13, guardY - length * 0.022, length * 0.26, length * 0.044, length * 0.02);
	ctx.fill();
	ctx.fillStyle = mix(guard, "#000000", 0.4);
	ctx.fillRect(-half * 0.8, guardY + length * 0.022, half * 1.6, length * 0.2);
	fillCircle(ctx, 0, guardY + length * 0.25, half * 1.35, guard);
	ctx.restore();
}

/** Vương miện 3 đỉnh, tâm (x, y), rộng `size` (cao khoảng 0,56 × size). */
export function drawCrown(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	const tips: [number, number][] = [[x - s, y - s * 0.3], [x, y - s * 0.62], [x + s, y - s * 0.3]];
	ctx.save();
	ctx.beginPath();
	ctx.moveTo(x - s * 0.86, y + s * 0.5);
	ctx.lineTo(x - s, y - s * 0.3);
	ctx.lineTo(x - s * 0.45, y + s * 0.02);
	ctx.lineTo(x, y - s * 0.62);
	ctx.lineTo(x + s * 0.45, y + s * 0.02);
	ctx.lineTo(x + s, y - s * 0.3);
	ctx.lineTo(x + s * 0.86, y + s * 0.5);
	ctx.closePath();
	ctx.fillStyle = linearGradient(ctx, x, y - s * 0.62, x, y + s * 0.5, [mix(color, "#ffffff", 0.55), color, mix(color, "#000000", 0.3)]);
	ctx.fill();
	ctx.fillStyle = mix(color, "#000000", 0.35);
	ctx.fillRect(x - s * 0.86, y + s * 0.28, s * 1.72, s * 0.22);
	for (const [px, py] of tips) fillCircle(ctx, px, py, Math.max(0.8, s * 0.14), mix(color, "#ffffff", 0.65));
	ctx.restore();
}

/** Đôi cánh hai bên gốc (x, y): mỗi bên `feathers` lông xoè lên trên, lông trên cùng dài bằng `span`; `gap` là nửa khoảng cách giữa hai gốc cánh. */
export function drawWings(ctx: Ctx, x: number, y: number, span: number, color: string, feathers = 3, gap = 0): void
{
	const steps = Math.max(1, feathers - 1);
	ctx.save();
	for (const side of [-1, 1])
	{
		const baseX = x + side * gap;
		for (let index = feathers - 1; index >= 0; index--)
		{
			const angle = -0.8 + index * (0.8 / steps);
			const length = span * (1 - index * (0.3 / steps));
			const tipX = baseX + side * Math.cos(angle) * length;
			const tipY = y + Math.sin(angle) * length;
			const thickness = span * 0.22;
			const middleX = (baseX + tipX) / 2;
			const middleY = (y + tipY) / 2;
			ctx.beginPath();
			ctx.moveTo(baseX, y - thickness * 0.35);
			ctx.quadraticCurveTo(middleX, middleY - thickness, tipX, tipY);
			ctx.quadraticCurveTo(middleX + side * thickness * 0.2, middleY + thickness * 0.5, baseX, y + thickness * 0.55);
			ctx.closePath();
			ctx.fillStyle = index === 0 ? mix(color, "#ffffff", 0.3) : mix(color, "#000000", index * 0.14);
			ctx.fill();
		}
	}
	ctx.restore();
}

/** Mây lành (tường vân): một vòng xoắn kèm đuôi mây; `flip` = -1 thì lật ngang. */
export function drawCloudCurl(ctx: Ctx, x: number, y: number, size: number, color: string, lineWidth: number, flip = 1): void
{
	const s = size / 2;
	ctx.save();
	ctx.translate(x, y);
	ctx.scale(flip, 1);
	ctx.strokeStyle = color;
	ctx.lineWidth = lineWidth;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.beginPath();
	const centerX = -s * 0.4;
	const centerY = -s * 0.02;
	for (let step = 0; step <= 36; step++)
	{
		const t = step / 36;
		const angle = Math.PI * 1.5 + t * Math.PI * 2;
		const radius = s * (0.08 + 0.4 * t);
		const px = centerX + Math.cos(angle) * radius;
		const py = centerY + Math.sin(angle) * radius;
		if (step === 0) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
	}
	ctx.bezierCurveTo(-s * 0.05, -s * 0.5, s * 0.25, s * 0.35, s * 0.6, s * 0.28);
	ctx.bezierCurveTo(s * 0.95, s * 0.2, s * 0.95, -s * 0.22, s * 0.62, -s * 0.2);
	ctx.bezierCurveTo(s * 0.42, -s * 0.18, s * 0.4, s * 0.05, s * 0.58, s * 0.05);
	ctx.stroke();
	ctx.restore();
}

/** Hành tinh cầu, có thể kèm vành (nửa vành sau vẽ trước quả cầu, nửa vành trước vẽ sau). */
export function drawPlanet(ctx: Ctx, x: number, y: number, radius: number, color: string, ring: boolean, tilt = -0.35): void
{
	const ringStroke = (start: number, end: number): void =>
	{
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(tilt);
		ctx.beginPath();
		ctx.ellipse(0, 0, radius * 1.75, radius * 0.46, 0, start, end);
		ctx.strokeStyle = mix(color, "#ffffff", 0.5);
		ctx.lineWidth = Math.max(1, radius * 0.16);
		ctx.stroke();
		ctx.restore();
	};
	ctx.save();
	if (ring) ringStroke(Math.PI, TAU);
	const body = ctx.createRadialGradient(x - radius * 0.4, y - radius * 0.4, radius * 0.1, x, y, radius);
	body.addColorStop(0, mix(color, "#ffffff", 0.6));
	body.addColorStop(0.55, color);
	body.addColorStop(1, mix(color, "#000000", 0.55));
	fillCircle(ctx, x, y, radius, body);
	ctx.save();
	ctx.beginPath();
	ctx.arc(x, y, radius, 0, TAU);
	ctx.clip();
	ctx.fillStyle = rgba(mix(color, "#000000", 0.45), 0.4);
	ctx.fillRect(x - radius, y - radius * 0.28, radius * 2, radius * 0.2);
	ctx.fillRect(x - radius, y + radius * 0.22, radius * 2, radius * 0.13);
	ctx.restore();
	if (ring) ringStroke(0, Math.PI);
	ctx.restore();
}

/** Viên linh châu: quả cầu sáng, dùng làm biểu tượng dự phòng. */
export function drawOrb(ctx: Ctx, x: number, y: number, size: number, color: string): void
{
	const s = size / 2;
	const gradient = ctx.createRadialGradient(x - s * 0.3, y - s * 0.3, s * 0.1, x, y, s);
	gradient.addColorStop(0, "#ffffff");
	gradient.addColorStop(1, color);
	fillCircle(ctx, x, y, s * 0.8, gradient);
	strokeCircle(ctx, x, y, s * 0.92, rgba(color, 0.5), Math.max(1, size * 0.05));
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
