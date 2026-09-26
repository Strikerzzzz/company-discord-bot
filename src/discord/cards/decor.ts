import { Ctx, drawGlow, mix, Random, rgba, strokeCircle, TAU } from "./draw";
import { drawSparkle } from "./icons";

/*
 * Hoa văn nền phong cách tu tiên: sao/linh khí, dải linh khí lưu chuyển, núi xa, trận pháp bát quái, tia sét, hào quang.
 * Hàm nào có yếu tố ngẫu nhiên đều nhận PRNG có seed (mulberry32) để ảnh giống hệt nhau giữa các lần vẽ cùng dữ liệu.
 */

export interface Area
{
	x: number;
	y: number;
	width: number;
	height: number;
}

function inside(areas: readonly Area[], x: number, y: number): boolean
{
	return areas.some(area => x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height);
}

/** Hạt linh khí: chấm nhỏ mờ, thỉnh thoảng có ngôi sao 4 cánh lấp lánh. Bỏ qua các hạt rơi vào vùng `avoid` (vùng chữ nhỏ). */
export function drawStarfield(ctx: Ctx, rand: Random, area: Area, count: number, colors: readonly string[], avoid: readonly Area[] = []): void
{
	ctx.save();
	for (let index = 0; index < count; index++)
	{
		const x = area.x + rand() * area.width;
		const y = area.y + rand() * area.height;
		const size = 0.6 + Math.pow(rand(), 3) * 2.6;
		const alpha = 0.18 + rand() * 0.5;
		const color = colors[Math.floor(rand() * colors.length) % colors.length] ?? "#ffffff";
		const sparkle = size > 2.2 && rand() < 0.6;
		if (inside(avoid, x, y)) continue;
		if (sparkle)
		{
			drawGlow(ctx, x, y, size * 4, color, alpha * 0.35);
			drawSparkle(ctx, x, y, size * 2.2, color, Math.min(1, alpha + 0.2));
		}
		else
		{
			ctx.fillStyle = rgba(color, alpha);
			ctx.beginPath();
			ctx.arc(x, y, size, 0, TAU);
			ctx.fill();
		}
	}
	ctx.restore();
}

/** Dải linh khí mềm chạy ngang (các đường cong sin mờ). */
export function drawQiStreams(ctx: Ctx, rand: Random, area: Area, count: number, color: string, alpha: number): void
{
	ctx.save();
	ctx.lineCap = "round";
	for (let index = 0; index < count; index++)
	{
		const baseY = area.y + area.height * (0.15 + rand() * 0.7);
		const amplitude = 10 + rand() * 26;
		const wavelength = 180 + rand() * 260;
		const phase = rand() * TAU;
		const gradient = ctx.createLinearGradient(area.x, 0, area.x + area.width, 0);
		gradient.addColorStop(0, rgba(color, 0));
		gradient.addColorStop(0.3 + rand() * 0.3, rgba(color, alpha * (0.5 + rand() * 0.5)));
		gradient.addColorStop(1, rgba(color, 0));
		ctx.strokeStyle = gradient;
		ctx.lineWidth = 1 + rand() * 1.6;
		ctx.beginPath();
		for (let x = area.x; x <= area.x + area.width; x += 8)
		{
			const y = baseY + Math.sin((x / wavelength) * TAU + phase) * amplitude;
			if (x === area.x) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.stroke();
	}
	ctx.restore();
}

export interface MountainLayer
{
	color: string;
	/** Vị trí trung bình của sống núi (tỉ lệ 0..1 tính từ đỉnh vùng vẽ). */
	ridge: number;
	/** Độ cao dao động của sống núi (px). */
	amplitude: number;
}

/** Dãy núi xa kiểu tranh thuỷ mặc, nhiều lớp chồng lên nhau. */
export function drawMountains(ctx: Ctx, rand: Random, area: Area, layers: readonly MountainLayer[]): void
{
	ctx.save();
	for (const layer of layers)
	{
		const base = area.y + area.height * layer.ridge;
		const peaks: { x: number; y: number }[] = [];
		let x = area.x - 40;
		while (x < area.x + area.width + 80)
		{
			peaks.push({ x, y: base - rand() * layer.amplitude });
			x += 60 + rand() * 90;
		}
		ctx.beginPath();
		ctx.moveTo(area.x - 40, area.y + area.height);
		ctx.lineTo(peaks[0].x, peaks[0].y);
		for (let index = 1; index < peaks.length; index++)
		{
			const previous = peaks[index - 1];
			const current = peaks[index];
			const middleX = (previous.x + current.x) / 2;
			const valleyY = Math.max(previous.y, current.y) + layer.amplitude * (0.2 + rand() * 0.35);
			ctx.quadraticCurveTo(middleX - (current.x - previous.x) * 0.15, valleyY, middleX, valleyY - 2);
			ctx.quadraticCurveTo(middleX + (current.x - previous.x) * 0.2, current.y + 4, current.x, current.y);
		}
		ctx.lineTo(area.x + area.width + 80, area.y + area.height);
		ctx.closePath();
		ctx.fillStyle = layer.color;
		ctx.fill();
	}
	ctx.restore();
}

// Bát quái theo thứ tự Tiên Thiên; mỗi quẻ 3 hào từ trong ra ngoài, true = hào liền, false = hào đứt.
const TRIGRAMS: readonly (readonly [boolean, boolean, boolean])[] = [
	[true, true, true],
	[true, true, false],
	[true, false, true],
	[true, false, false],
	[false, false, false],
	[false, false, true],
	[false, true, false],
	[false, true, true],
];

/**
 * Trận pháp bát quái quanh avatar. `complexity` (0..7, theo thứ tự cảnh giới) càng cao thì trận càng nhiều vòng:
 * 0 chỉ có vòng vạch chia; từ 1 thêm vòng trong; từ 2 thêm 8 quẻ; từ 4 thêm vòng chấm ngoài; từ 6 thêm 8 linh châu.
 */
export function drawFormation(ctx: Ctx, x: number, y: number, radius: number, color: string, complexity: number): void
{
	ctx.save();
	ctx.lineCap = "round";
	strokeCircle(ctx, x, y, radius, rgba(color, 0.45), 1.6);

	ctx.strokeStyle = rgba(color, 0.4);
	for (let index = 0; index < 72; index++)
	{
		const angle = (index / 72) * TAU;
		const major = index % 9 === 0;
		ctx.lineWidth = major ? 2 : 1;
		const inner = radius - (major ? 9 : 5);
		ctx.beginPath();
		ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
		ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
		ctx.stroke();
	}

	if (complexity >= 1) strokeCircle(ctx, x, y, radius - 13, rgba(color, 0.35), 1.2);

	if (complexity >= 2)
	{
		ctx.fillStyle = rgba(color, 0.55);
		const bandCenter = radius - 23;
		TRIGRAMS.forEach((lines, index) =>
		{
			const angle = -Math.PI / 2 + (index / TRIGRAMS.length) * TAU;
			ctx.save();
			ctx.translate(x + Math.cos(angle) * bandCenter, y + Math.sin(angle) * bandCenter);
			ctx.rotate(angle + Math.PI / 2);
			lines.forEach((solid, line) =>
			{
				const ly = 5 - line * 5;
				if (solid)
				{
					ctx.fillRect(-9, ly - 1.4, 18, 2.8);
				}
				else
				{
					ctx.fillRect(-9, ly - 1.4, 7.5, 2.8);
					ctx.fillRect(1.5, ly - 1.4, 7.5, 2.8);
				}
			});
			ctx.restore();
		});
		strokeCircle(ctx, x, y, radius - 33, rgba(color, 0.28), 1);
	}

	if (complexity >= 4)
	{
		ctx.fillStyle = rgba(color, 0.5);
		for (let index = 0; index < 48; index++)
		{
			const angle = (index / 48) * TAU;
			ctx.beginPath();
			ctx.arc(x + Math.cos(angle) * (radius + 9), y + Math.sin(angle) * (radius + 9), index % 6 === 0 ? 2.2 : 1.1, 0, TAU);
			ctx.fill();
		}
	}

	if (complexity >= 6)
	{
		for (let index = 0; index < 8; index++)
		{
			const angle = -Math.PI / 2 + Math.PI / 8 + (index / 8) * TAU;
			const px = x + Math.cos(angle) * radius;
			const py = y + Math.sin(angle) * radius;
			drawGlow(ctx, px, py, 12, color, 0.55);
			const orb = ctx.createRadialGradient(px - 1.5, py - 1.5, 0.5, px, py, 5);
			orb.addColorStop(0, "#ffffff");
			orb.addColorStop(1, color);
			ctx.fillStyle = orb;
			ctx.beginPath();
			ctx.arc(px, py, 4.5, 0, TAU);
			ctx.fill();
		}
	}
	ctx.restore();
}

function lightningPoints(rand: Random, x0: number, y0: number, x1: number, y1: number, spread: number, depth: number): { x: number; y: number }[]
{
	if (depth === 0) return [{ x: x0, y: y0 }, { x: x1, y: y1 }];
	const middleX = (x0 + x1) / 2 + (rand() - 0.5) * spread;
	const middleY = (y0 + y1) / 2 + (rand() - 0.5) * spread * 0.4;
	const left = lightningPoints(rand, x0, y0, middleX, middleY, spread / 2, depth - 1);
	const right = lightningPoints(rand, middleX, middleY, x1, y1, spread / 2, depth - 1);
	return [...left, ...right.slice(1)];
}

/** Tia sét gấp khúc có quầng sáng, kèm một nhánh phụ. */
export function drawLightning(ctx: Ctx, rand: Random, x0: number, y0: number, x1: number, y1: number, color: string, width: number): void
{
	const length = Math.hypot(x1 - x0, y1 - y0);
	const main = lightningPoints(rand, x0, y0, x1, y1, length * 0.35, 5);
	const branchStart = main[Math.floor(main.length * (0.3 + rand() * 0.3))];
	const branchEnd = { x: branchStart.x + (rand() - 0.3) * length * 0.45, y: branchStart.y + length * (0.2 + rand() * 0.2) };
	const branch = lightningPoints(rand, branchStart.x, branchStart.y, branchEnd.x, branchEnd.y, length * 0.15, 4);

	ctx.save();
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	const stroke = (points: { x: number; y: number }[], lineWidth: number, style: string, blur: number): void =>
	{
		ctx.shadowColor = color;
		ctx.shadowBlur = blur;
		ctx.strokeStyle = style;
		ctx.lineWidth = lineWidth;
		ctx.beginPath();
		points.forEach((point, index) =>
		{
			if (index === 0) ctx.moveTo(point.x, point.y);
			else ctx.lineTo(point.x, point.y);
		});
		ctx.stroke();
	};
	stroke(main, width * 2.6, rgba(color, 0.35), 18);
	stroke(main, width, mix(color, "#ffffff", 0.7), 10);
	stroke(branch, width * 1.6, rgba(color, 0.3), 12);
	stroke(branch, width * 0.55, mix(color, "#ffffff", 0.6), 6);
	ctx.restore();
}

/** Hào quang toả tia sau avatar (dùng cho cảnh giới cao nhất). */
export function drawSunburst(ctx: Ctx, x: number, y: number, radius: number, color: string, alpha: number, rays: number): void
{
	ctx.save();
	const gradient = ctx.createRadialGradient(x, y, radius * 0.2, x, y, radius);
	gradient.addColorStop(0, rgba(color, alpha));
	gradient.addColorStop(1, rgba(color, 0));
	ctx.fillStyle = gradient;
	for (let index = 0; index < rays; index++)
	{
		const angle = (index / rays) * TAU;
		const half = Math.PI / rays / 2;
		ctx.beginPath();
		ctx.moveTo(x, y);
		ctx.lineTo(x + Math.cos(angle - half) * radius, y + Math.sin(angle - half) * radius);
		ctx.lineTo(x + Math.cos(angle + half) * radius, y + Math.sin(angle + half) * radius);
		ctx.closePath();
		ctx.fill();
	}
	ctx.restore();
}
