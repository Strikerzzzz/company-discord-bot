import { Ctx, drawGlow, fillCircle, linearGradient, mix, Paint, Random, rgba, strokeCircle, TAU } from "./draw";
import { drawLeaf, drawSparkle } from "./icons";

/*
 * Hoa văn nền của ảnh thẻ: sao/linh khí, dải linh khí, núi xa, trận pháp bát quái, tia sét, hào quang (tu tiên);
 * lưới tổ ong, dải sáng, núi gãy khúc (rank game); núi thuỷ mặc, trăng, cánh hoa, vệt kiếm khí, ấn triện (kiếm hiệp);
 * đồi, lá rơi, đom đóm (cây xanh); tinh vân, chân trời hành tinh, sao băng, thiên hà (vũ trụ).
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

/** Hào quang toả tia sau avatar (dùng cho bậc cao nhất); `width` là độ rộng tia so với khoảng cách giữa hai tia. */
export function drawSunburst(ctx: Ctx, x: number, y: number, radius: number, color: string, alpha: number, rays: number, rotation = 0, width = 0.5): void
{
	ctx.save();
	const gradient = ctx.createRadialGradient(x, y, radius * 0.2, x, y, radius);
	gradient.addColorStop(0, rgba(color, alpha));
	gradient.addColorStop(1, rgba(color, 0));
	ctx.fillStyle = gradient;
	for (let index = 0; index < rays; index++)
	{
		const angle = rotation + (index / rays) * TAU;
		const half = (Math.PI / rays) * width;
		ctx.beginPath();
		ctx.moveTo(x, y);
		ctx.lineTo(x + Math.cos(angle - half) * radius, y + Math.sin(angle - half) * radius);
		ctx.lineTo(x + Math.cos(angle + half) * radius, y + Math.sin(angle + half) * radius);
		ctx.closePath();
		ctx.fill();
	}
	ctx.restore();
}

/** Quầng sáng dạng elip (tỉ lệ dọc/ngang `squash`), dùng cho tinh vân và sương. */
export function drawEllipseGlow(ctx: Ctx, x: number, y: number, radius: number, squash: number, color: string, alpha: number): void
{
	ctx.save();
	ctx.translate(x, y);
	ctx.scale(1, squash);
	drawGlow(ctx, 0, 0, radius, color, alpha);
	ctx.restore();
}

/** Lưới tổ ong (lục giác đầu bằng cạnh `cell`) trong vùng `area`; `paint` có thể là gradient để lưới mờ dần. */
export function drawHexGrid(ctx: Ctx, area: Area, cell: number, paint: Paint, lineWidth: number): void
{
	const stepX = cell * 1.5;
	const stepY = cell * Math.sqrt(3);
	ctx.save();
	ctx.beginPath();
	ctx.rect(area.x, area.y, area.width, area.height);
	ctx.clip();
	ctx.beginPath();
	for (let column = 0; column * stepX <= area.width + cell; column++)
	{
		const cx = area.x + column * stepX;
		const offset = column % 2 === 0 ? 0 : stepY / 2;
		for (let cy = area.y - stepY + offset; cy <= area.y + area.height + stepY; cy += stepY)
		{
			for (let index = 0; index < 6; index++)
			{
				const angle = (index * Math.PI) / 3;
				const px = cx + Math.cos(angle) * cell;
				const py = cy + Math.sin(angle) * cell;
				if (index === 0) ctx.moveTo(px, py);
				else ctx.lineTo(px, py);
			}
			ctx.closePath();
		}
	}
	ctx.strokeStyle = paint;
	ctx.lineWidth = lineWidth;
	ctx.stroke();
	ctx.restore();
}

/** Các dải sáng xiên từ mép trên xuống, mờ dần (ánh đèn sân khấu đấu trường). */
export function drawBeams(ctx: Ctx, rand: Random, area: Area, count: number, color: string, alpha: number): void
{
	ctx.save();
	for (let index = 0; index < count; index++)
	{
		const x = area.x + area.width * (0.1 + rand() * 0.85);
		const width = 16 + rand() * 46;
		const slant = area.height * (0.3 + rand() * 0.3);
		const gradient = ctx.createLinearGradient(0, area.y, 0, area.y + area.height);
		gradient.addColorStop(0, rgba(color, alpha * (0.6 + rand() * 0.4)));
		gradient.addColorStop(1, rgba(color, 0));
		ctx.fillStyle = gradient;
		ctx.beginPath();
		ctx.moveTo(x, area.y);
		ctx.lineTo(x + width, area.y);
		ctx.lineTo(x + width - slant, area.y + area.height);
		ctx.lineTo(x - slant, area.y + area.height);
		ctx.closePath();
		ctx.fill();
	}
	ctx.restore();
}

/** Dãy núi gãy khúc kiểu low-poly: sống núi là đường thẳng, sườn phải của mỗi đỉnh sáng hơn một chút. */
export function drawRidges(ctx: Ctx, rand: Random, area: Area, layers: readonly MountainLayer[]): void
{
	ctx.save();
	const bottom = area.y + area.height;
	for (const layer of layers)
	{
		const base = area.y + area.height * layer.ridge;
		const points: { x: number; y: number }[] = [];
		let x = area.x - 30;
		let peak = rand() < 0.5;
		while (x < area.x + area.width + 60)
		{
			points.push({ x, y: base - (peak ? layer.amplitude * (0.55 + rand() * 0.45) : layer.amplitude * rand() * 0.3) });
			peak = !peak;
			x += 36 + rand() * 64;
		}
		ctx.beginPath();
		ctx.moveTo(area.x - 30, bottom);
		for (const point of points) ctx.lineTo(point.x, point.y);
		ctx.lineTo(area.x + area.width + 60, bottom);
		ctx.closePath();
		ctx.fillStyle = layer.color;
		ctx.fill();
		ctx.fillStyle = "rgba(255, 255, 255, 0.025)";
		for (let index = 1; index < points.length - 1; index++)
		{
			const current = points[index];
			const next = points[index + 1];
			if (current.y > points[index - 1].y || current.y > next.y) continue;
			ctx.beginPath();
			ctx.moveTo(current.x, current.y);
			ctx.lineTo(next.x, next.y);
			ctx.lineTo(current.x + (next.x - current.x) * 0.35, bottom);
			ctx.closePath();
			ctx.fill();
		}
	}
	ctx.restore();
}

/** Hạt sáng kiểu game: hình thoi nhỏ và dấu cộng. Bỏ qua các hạt rơi vào vùng `avoid`. */
export function drawSparks(ctx: Ctx, rand: Random, area: Area, count: number, colors: readonly string[], avoid: readonly Area[] = []): void
{
	ctx.save();
	for (let index = 0; index < count; index++)
	{
		const x = area.x + rand() * area.width;
		const y = area.y + rand() * area.height;
		const size = 1.2 + Math.pow(rand(), 2.5) * 3.2;
		const alpha = 0.2 + rand() * 0.5;
		const color = colors[Math.floor(rand() * colors.length) % colors.length] ?? "#ffffff";
		const plus = rand() < 0.3;
		if (inside(avoid, x, y)) continue;
		ctx.fillStyle = rgba(color, alpha);
		if (plus)
		{
			ctx.fillRect(x - size, y - size * 0.22, size * 2, size * 0.44);
			ctx.fillRect(x - size * 0.22, y - size, size * 0.44, size * 2);
			continue;
		}
		ctx.beginPath();
		ctx.moveTo(x, y - size);
		ctx.lineTo(x + size * 0.6, y);
		ctx.lineTo(x, y + size);
		ctx.lineTo(x - size * 0.6, y);
		ctx.closePath();
		ctx.fill();
	}
	ctx.restore();
}

export interface InkLayer
{
	color: string;
	/** Chân núi (tỉ lệ 0..1 tính từ đỉnh vùng vẽ). */
	base: number;
	/** Độ cao tối đa của đỉnh (px). */
	height: number;
	/** Độ đậm của mực ở đỉnh núi. */
	alpha: number;
}

/** Núi thuỷ mặc: đỉnh dốc đứng, mực đậm ở sống núi và nhạt dần xuống chân như sương. */
export function drawInkMountains(ctx: Ctx, rand: Random, area: Area, layers: readonly InkLayer[]): void
{
	ctx.save();
	for (const layer of layers)
	{
		const baseY = area.y + area.height * layer.base;
		let x = area.x - 50 + rand() * 40;
		while (x < area.x + area.width + 60)
		{
			const half = 42 + rand() * 68;
			const peak = layer.height * (0.45 + rand() * 0.55);
			const lean = (rand() - 0.5) * half * 0.5;
			const top = baseY - peak;
			const gradient = ctx.createLinearGradient(0, top, 0, baseY + 30);
			gradient.addColorStop(0, rgba(layer.color, layer.alpha));
			gradient.addColorStop(0.55, rgba(layer.color, layer.alpha * 0.45));
			gradient.addColorStop(1, rgba(layer.color, 0));
			ctx.fillStyle = gradient;
			ctx.beginPath();
			ctx.moveTo(x - half, baseY + 30);
			ctx.bezierCurveTo(x - half * 0.45, baseY - peak * 0.2, x - half * 0.22 + lean, top + peak * 0.12, x + lean, top);
			ctx.bezierCurveTo(x + half * 0.22 + lean, top + peak * 0.12, x + half * 0.45, baseY - peak * 0.25, x + half, baseY + 30);
			ctx.closePath();
			ctx.fill();
			x += half * (0.75 + rand() * 0.7);
		}
	}
	ctx.restore();
}

/** Mặt trăng tròn có quầng. */
export function drawMoon(ctx: Ctx, x: number, y: number, radius: number, color: string, alpha: number): void
{
	drawGlow(ctx, x, y, radius * 2.8, color, alpha * 0.45);
	const body = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
	body.addColorStop(0, rgba("#fffdf2", alpha));
	body.addColorStop(1, rgba(color, alpha * 0.75));
	fillCircle(ctx, x, y, radius, body);
	fillCircle(ctx, x + radius * 0.3, y + radius * 0.15, radius * 0.18, rgba("#000000", alpha * 0.12));
	fillCircle(ctx, x - radius * 0.25, y + radius * 0.35, radius * 0.1, rgba("#000000", alpha * 0.1));
}

/** Cánh hoa bay (elip nhỏ xoay ngẫu nhiên). */
export function drawPetals(ctx: Ctx, rand: Random, area: Area, count: number, colors: readonly string[], avoid: readonly Area[] = []): void
{
	ctx.save();
	for (let index = 0; index < count; index++)
	{
		const x = area.x + rand() * area.width;
		const y = area.y + rand() * area.height;
		const size = 2.5 + rand() * 4.5;
		const angle = rand() * TAU;
		const alpha = 0.3 + rand() * 0.5;
		const color = colors[Math.floor(rand() * colors.length) % colors.length] ?? "#ffffff";
		if (inside(avoid, x, y)) continue;
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(angle);
		ctx.beginPath();
		ctx.moveTo(-size, 0);
		ctx.quadraticCurveTo(-size * 0.2, -size * 0.75, size, -size * 0.15);
		ctx.lineTo(size * 0.7, 0);
		ctx.lineTo(size, size * 0.15);
		ctx.quadraticCurveTo(-size * 0.2, size * 0.75, -size, 0);
		ctx.fillStyle = rgba(color, alpha);
		ctx.fill();
		ctx.restore();
	}
	ctx.restore();
}

/** Đàn chim xa (nét chữ V mềm) quanh điểm (x, y). */
export function drawBirds(ctx: Ctx, rand: Random, x: number, y: number, count: number, spread: number, color: string): void
{
	ctx.save();
	ctx.strokeStyle = color;
	ctx.lineCap = "round";
	for (let index = 0; index < count; index++)
	{
		const bx = x + (rand() - 0.5) * spread;
		const by = y + (rand() - 0.5) * spread * 0.4;
		const wing = 3.5 + rand() * 4;
		ctx.lineWidth = 1 + wing * 0.12;
		ctx.beginPath();
		ctx.moveTo(bx - wing, by - wing * 0.25);
		ctx.quadraticCurveTo(bx - wing * 0.45, by - wing * 0.65, bx, by);
		ctx.quadraticCurveTo(bx + wing * 0.45, by - wing * 0.65, bx + wing, by - wing * 0.25);
		ctx.stroke();
	}
	ctx.restore();
}

/** Vệt kiếm khí hình lưỡi liềm từ (x0, y0) tới (x1, y1), cong về một phía theo `bend` (px), dày nhất `width` ở giữa. */
export function drawSlash(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, bend: number, width: number, color: string): void
{
	const length = Math.max(1, Math.hypot(x1 - x0, y1 - y0));
	const nx = -(y1 - y0) / length;
	const ny = (x1 - x0) / length;
	const middleX = (x0 + x1) / 2;
	const middleY = (y0 + y1) / 2;
	ctx.save();
	ctx.shadowColor = color;
	ctx.shadowBlur = 16;
	ctx.fillStyle = linearGradient(ctx, x0, y0, x1, y1, [rgba(color, 0), rgba(mix(color, "#ffffff", 0.7), 0.85), rgba(color, 0.05)]);
	ctx.beginPath();
	ctx.moveTo(x0, y0);
	ctx.quadraticCurveTo(middleX + nx * bend, middleY + ny * bend, x1, y1);
	ctx.quadraticCurveTo(middleX + nx * (bend - width * 2), middleY + ny * (bend - width * 2), x0, y0);
	ctx.fill();
	ctx.restore();
}

/** Ấn triện đỏ: ô vuông bo góc, viền trong và chữ "王" (vương) cách điệu bằng nét thẳng. */
export function drawSeal(ctx: Ctx, x: number, y: number, size: number, color: string, rotation: number): void
{
	const s = size / 2;
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(rotation);
	ctx.shadowColor = rgba(color, 0.6);
	ctx.shadowBlur = 10;
	ctx.fillStyle = linearGradient(ctx, -s, -s, s, s, [mix(color, "#ffffff", 0.12), color, mix(color, "#000000", 0.2)]);
	ctx.beginPath();
	ctx.roundRect(-s, -s, size, size, s * 0.18);
	ctx.fill();
	ctx.shadowBlur = 0;
	ctx.strokeStyle = "rgba(255, 244, 230, 0.9)";
	ctx.lineWidth = Math.max(1, s * 0.09);
	ctx.beginPath();
	ctx.roundRect(-s * 0.78, -s * 0.78, s * 1.56, s * 1.56, s * 0.1);
	ctx.stroke();
	ctx.lineWidth = Math.max(1.2, s * 0.14);
	ctx.lineCap = "round";
	ctx.beginPath();
	ctx.moveTo(-s * 0.42, -s * 0.45);
	ctx.lineTo(s * 0.42, -s * 0.45);
	ctx.moveTo(-s * 0.34, 0);
	ctx.lineTo(s * 0.34, 0);
	ctx.moveTo(-s * 0.5, s * 0.46);
	ctx.lineTo(s * 0.5, s * 0.46);
	ctx.moveTo(0, -s * 0.45);
	ctx.lineTo(0, s * 0.46);
	ctx.stroke();
	ctx.restore();
}

export interface HillLayer
{
	color: string;
	/** Vị trí trung bình của sống đồi (tỉ lệ 0..1 tính từ đỉnh vùng vẽ). */
	ridge: number;
	/** Độ cao dao động (px). */
	amplitude: number;
}

/** Đồi thoai thoải (tổng hai sóng sin), nhiều lớp chồng lên nhau. */
export function drawHills(ctx: Ctx, rand: Random, area: Area, layers: readonly HillLayer[]): void
{
	ctx.save();
	const bottom = area.y + area.height;
	for (const layer of layers)
	{
		const base = area.y + area.height * layer.ridge;
		const wavelength = 320 + rand() * 260;
		const phase = rand() * TAU;
		const phase2 = rand() * TAU;
		ctx.beginPath();
		ctx.moveTo(area.x, bottom);
		for (let x = area.x; x <= area.x + area.width + 10; x += 10)
		{
			const wave = Math.sin((x / wavelength) * TAU + phase) * 0.7 + Math.sin((x / wavelength) * TAU * 2.3 + phase2) * 0.3;
			ctx.lineTo(x, base - layer.amplitude * (0.5 + wave * 0.5));
		}
		ctx.lineTo(area.x + area.width + 10, bottom);
		ctx.closePath();
		ctx.fillStyle = layer.color;
		ctx.fill();
	}
	ctx.restore();
}

/** Lá rơi xoay ngẫu nhiên. */
export function drawFallingLeaves(ctx: Ctx, rand: Random, area: Area, count: number, colors: readonly string[], avoid: readonly Area[] = []): void
{
	for (let index = 0; index < count; index++)
	{
		const x = area.x + rand() * area.width;
		const y = area.y + rand() * area.height;
		const size = 6 + rand() * 9;
		const angle = rand() * TAU;
		const alpha = 0.3 + rand() * 0.45;
		const color = colors[Math.floor(rand() * colors.length) % colors.length] ?? "#8bc34a";
		if (inside(avoid, x, y)) continue;
		drawLeaf(ctx, x - Math.cos(angle) * size / 2, y - Math.sin(angle) * size / 2, size, angle, rgba(color, alpha), 0.4);
	}
}

/** Đom đóm: chấm sáng ấm có quầng. */
export function drawFireflies(ctx: Ctx, rand: Random, area: Area, count: number, color: string, avoid: readonly Area[] = []): void
{
	for (let index = 0; index < count; index++)
	{
		const x = area.x + rand() * area.width;
		const y = area.y + rand() * area.height;
		const radius = 1.1 + rand() * 1.6;
		const alpha = 0.45 + rand() * 0.45;
		if (inside(avoid, x, y)) continue;
		drawGlow(ctx, x, y, radius * 6, color, alpha * 0.4);
		fillCircle(ctx, x, y, radius, rgba(mix(color, "#ffffff", 0.6), alpha));
	}
}

/** Tinh vân: nhiều quầng elip nhiều màu chồng lên nhau. */
export function drawNebula(ctx: Ctx, rand: Random, area: Area, clouds: number, colors: readonly string[], alpha: number): void
{
	for (let index = 0; index < clouds; index++)
	{
		const cx = area.x + rand() * area.width;
		const cy = area.y + rand() * area.height;
		const radius = 90 + rand() * 150;
		const color = colors[index % Math.max(1, colors.length)] ?? "#7c4dff";
		for (let part = 0; part < 3; part++)
		{
			drawEllipseGlow(ctx, cx + (rand() - 0.5) * radius * 0.9, cy + (rand() - 0.5) * radius * 0.4, radius * (0.45 + rand() * 0.55), 0.45 + rand() * 0.3, color, alpha * (0.5 + rand() * 0.5));
		}
	}
}

/** Chân trời hành tinh: cung tròn rất lớn tâm (cx, cy) có quầng khí quyển sáng ở mép. */
export function drawHorizon(ctx: Ctx, cx: number, cy: number, radius: number, color: string, alpha: number, body: string): void
{
	ctx.save();
	const atmosphere = ctx.createRadialGradient(cx, cy, radius - 6, cx, cy, radius + 60);
	atmosphere.addColorStop(0, rgba(color, alpha));
	atmosphere.addColorStop(0.12, rgba(color, alpha * 0.55));
	atmosphere.addColorStop(1, rgba(color, 0));
	fillCircle(ctx, cx, cy, radius + 60, atmosphere);
	const top = cy - radius;
	fillCircle(ctx, cx, cy, radius, linearGradient(ctx, 0, top, 0, top + 180, [mix(color, body, 0.55), body]));
	strokeCircle(ctx, cx, cy, radius, rgba(mix(color, "#ffffff", 0.5), alpha * 1.4), 1.5);
	ctx.restore();
}

/** Sao băng: vệt sáng mờ dần về đuôi, đầu có quầng; `angle` là hướng bay. */
export function drawShootingStar(ctx: Ctx, x: number, y: number, length: number, angle: number, color: string, width: number): void
{
	const tailX = x - Math.cos(angle) * length;
	const tailY = y - Math.sin(angle) * length;
	ctx.save();
	ctx.lineCap = "round";
	ctx.strokeStyle = linearGradient(ctx, tailX, tailY, x, y, [rgba(color, 0), rgba(mix(color, "#ffffff", 0.5), 0.85)]);
	ctx.lineWidth = width;
	ctx.beginPath();
	ctx.moveTo(tailX, tailY);
	ctx.lineTo(x, y);
	ctx.stroke();
	ctx.restore();
	drawGlow(ctx, x, y, width * 6, color, 0.55);
	drawSparkle(ctx, x, y, width * 2.6, "#ffffff", 0.95);
}

/** Chớp sáng hình sao 4 cánh (lens flare): hai tia dài ngang/dọc và bốn tia chéo ngắn hơn, mờ dần ra đầu tia. */
export function drawLensFlare(ctx: Ctx, x: number, y: number, length: number, width: number, color: string, alpha: number): void
{
	ctx.save();
	for (let index = 0; index < 8; index++)
	{
		const angle = (index * Math.PI) / 4;
		const diagonal = index % 2 === 1;
		const reach = diagonal ? length * 0.42 : length * (index % 4 === 0 ? 1 : 0.78);
		const half = diagonal ? width * 0.6 : width;
		const tipX = x + Math.cos(angle) * reach;
		const tipY = y + Math.sin(angle) * reach;
		const nx = Math.cos(angle + Math.PI / 2) * half;
		const ny = Math.sin(angle + Math.PI / 2) * half;
		ctx.fillStyle = linearGradient(ctx, x, y, tipX, tipY, [rgba(mix(color, "#ffffff", 0.5), alpha * (diagonal ? 0.6 : 1)), rgba(color, 0)]);
		ctx.beginPath();
		ctx.moveTo(x + nx, y + ny);
		ctx.lineTo(tipX, tipY);
		ctx.lineTo(x - nx, y - ny);
		ctx.closePath();
		ctx.fill();
	}
	ctx.restore();
}

/** Thiên hà xoắn ốc bằng hạt sáng, nghiêng theo `tilt` (tỉ lệ dọc/ngang). */
export function drawGalaxy(ctx: Ctx, rand: Random, x: number, y: number, radius: number, color: string, arms: number, count: number, tilt = 0.5, rotation = 0): void
{
	drawEllipseGlow(ctx, x, y, radius, tilt, color, 0.3);
	drawEllipseGlow(ctx, x, y, radius * 0.35, tilt * 1.2, "#ffffff", 0.35);
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(rotation);
	ctx.scale(1, tilt);
	for (let index = 0; index < count; index++)
	{
		const arm = index % Math.max(1, arms);
		const t = Math.sqrt(rand());
		const angle = (arm / Math.max(1, arms)) * TAU + t * Math.PI * 2.1 + (rand() - 0.5) * 0.6 * (1 - t * 0.4);
		const distance = radius * t;
		const px = Math.cos(angle) * distance + (rand() - 0.5) * 6;
		const py = Math.sin(angle) * distance + (rand() - 0.5) * 6;
		const size = 0.9 + rand() * 2 * (1 - t * 0.5);
		ctx.fillStyle = rgba(rand() < 0.35 ? "#ffffff" : color, 0.3 + 0.65 * (1 - t));
		ctx.fillRect(px - size / 2, py - size / 2, size, size);
	}
	ctx.restore();
}
