import { Ctx, drawGlow, fillCircle, linearGradient, mix, rgba, strokeCircle, TAU } from "./draw";
import { drawCloudCurl, drawCrown, drawFlower, drawLeaf, drawPlanet, drawSparkle, drawSword, hexagonPath } from "./icons";

/*
 * Khung trang trí quanh avatar của từng bộ danh hiệu (khung tu tiên là trận pháp bát quái trong decor.ts).
 * `complexity` (0..7, vị trí bậc) càng cao thì khung càng nhiều chi tiết. Kích thước tính theo tỉ lệ `radius`
 * (thiết kế ở 126 px) để dùng lại cho biểu tượng nhỏ ở đầu bảng xếp hạng.
 */

export interface FrameOptions
{
	/** Màu chính của khung (đã làm sáng). */
	color: string;
	/** Màu nhấn của bậc cao nhất (vương miện, lá vàng...). */
	accent: string;
	complexity: number;
	/** Vẽ phần chỉ hợp với khung lớn (dãy chấm bậc, tua, ấn triện). */
	detailed: boolean;
}

function scale(radius: number): number
{
	return radius / 126;
}

function bladeWings(ctx: Ctx, x: number, y: number, inner: number, outer: number, count: number, color: string): void
{
	ctx.save();
	for (const side of [-1, 1])
	{
		for (let index = 0; index < count; index++)
		{
			const t = count === 1 ? 0.5 : index / (count - 1);
			const angle = -Math.PI / 2 + side * (0.5 + t * 0.95);
			const reach = outer * (1 - Math.abs(t - 0.35) * 0.28);
			const spread = 0.075;
			const tipX = x + Math.cos(angle) * reach;
			const tipY = y + Math.sin(angle) * reach;
			ctx.beginPath();
			ctx.moveTo(x + Math.cos(angle - spread) * inner, y + Math.sin(angle - spread) * inner);
			ctx.quadraticCurveTo(x + Math.cos(angle - spread * 0.5) * reach * 0.8, y + Math.sin(angle - spread * 0.5) * reach * 0.8, tipX, tipY);
			ctx.quadraticCurveTo(x + Math.cos(angle + spread * 0.9) * reach * 0.8, y + Math.sin(angle + spread * 0.9) * reach * 0.8, x + Math.cos(angle + spread) * inner, y + Math.sin(angle + spread) * inner);
			ctx.closePath();
			const shade = index % 2 === 0 ? mix(color, "#ffffff", 0.15) : mix(color, "#000000", 0.2);
			ctx.fillStyle = linearGradient(ctx, x + Math.cos(angle) * inner, y + Math.sin(angle) * inner, tipX, tipY, [rgba(shade, 0.95), rgba(mix(shade, "#ffffff", 0.35), 0.75)]);
			ctx.fill();
		}
	}
	ctx.restore();
}

function diamond(ctx: Ctx, x: number, y: number, size: number): void
{
	ctx.beginPath();
	ctx.moveTo(x, y - size);
	ctx.lineTo(x + size * 0.75, y);
	ctx.lineTo(x, y + size);
	ctx.lineTo(x - size * 0.75, y);
	ctx.closePath();
}

/**
 * Khung huy hiệu lục giác (rank game): viền lục giác, dãy 8 chấm bậc ở cạnh dưới (sáng tới bậc hiện tại).
 * Từ bậc 1 thêm lục giác trong; 2 viền kép và vạch; 3 nút sáng ở đỉnh; 4 vòng cung ngoài; 5 cánh lưỡi; 6 cánh dày hơn; 7 vương miện.
 */
export function drawHexCrest(ctx: Ctx, x: number, y: number, radius: number, options: FrameOptions): void
{
	const { color, accent, complexity } = options;
	const k = scale(radius);
	const edge = radius * Math.sin(Math.PI / 3);
	ctx.save();
	ctx.lineJoin = "round";
	ctx.lineCap = "round";

	if (complexity >= 5)
	{
		bladeWings(ctx, x, y, radius * 0.8, radius + (complexity >= 6 ? 46 : 34) * k, complexity >= 6 ? 5 : 3, complexity >= 7 ? accent : color);
	}

	if (complexity >= 4)
	{
		ctx.strokeStyle = rgba(color, 0.4);
		ctx.lineWidth = Math.max(0.8, 1.6 * k);
		for (let index = 0; index < 6; index++)
		{
			const angle = (index * Math.PI) / 3;
			ctx.beginPath();
			ctx.arc(x, y, radius + 13 * k, angle + 0.2, angle + Math.PI / 3 - 0.2);
			ctx.stroke();
		}
	}

	hexagonPath(ctx, x, y, radius);
	ctx.fillStyle = rgba(color, 0.07);
	ctx.fill();
	ctx.strokeStyle = rgba(color, 0.7);
	ctx.lineWidth = Math.max(1, 2.4 * k);
	ctx.stroke();

	if (complexity >= 2)
	{
		hexagonPath(ctx, x, y, radius + 6 * k);
		ctx.strokeStyle = rgba(color, 0.3);
		ctx.lineWidth = Math.max(0.6, 1 * k);
		ctx.stroke();
		ctx.strokeStyle = rgba(color, 0.45);
		ctx.lineWidth = Math.max(0.8, 1.4 * k);
		for (let index = 0; index < 6; index++)
		{
			const a0 = (index * Math.PI) / 3;
			const a1 = a0 + Math.PI / 3;
			for (let tick = 1; tick < 6; tick++)
			{
				const t = tick / 6;
				const px = x + (Math.cos(a0) * (1 - t) + Math.cos(a1) * t) * radius;
				const py = y + (Math.sin(a0) * (1 - t) + Math.sin(a1) * t) * radius;
				const inward = tick === 3 ? 9 : 5;
				const ratio = 1 - (inward * k) / radius;
				ctx.beginPath();
				ctx.moveTo(px, py);
				ctx.lineTo(x + (px - x) * ratio, y + (py - y) * ratio);
				ctx.stroke();
			}
		}
	}

	if (complexity >= 1)
	{
		hexagonPath(ctx, x, y, radius - 13 * k);
		ctx.strokeStyle = rgba(color, 0.35);
		ctx.lineWidth = Math.max(0.6, 1.2 * k);
		ctx.stroke();
	}

	if (complexity >= 3)
	{
		for (let index = 0; index < 6; index++)
		{
			const angle = (index * Math.PI) / 3;
			const px = x + Math.cos(angle) * radius;
			const py = y + Math.sin(angle) * radius;
			drawGlow(ctx, px, py, 12 * k, color, 0.6);
			diamond(ctx, px, py, 6 * k);
			ctx.fillStyle = mix(color, "#ffffff", 0.55);
			ctx.fill();
		}
	}

	if (options.detailed)
	{
		const pitch = 15 * k;
		const pipY = y + edge;
		for (let index = 0; index < 8; index++)
		{
			const px = x + (index - 3.5) * pitch;
			diamond(ctx, px, pipY, 7.5 * k);
			ctx.fillStyle = "#0a0d1b";
			ctx.fill();
			if (index <= complexity)
			{
				drawGlow(ctx, px, pipY, 10 * k, color, 0.55);
				diamond(ctx, px, pipY, 5.5 * k);
				ctx.fillStyle = mix(color, "#ffffff", 0.35);
				ctx.fill();
			}
			else
			{
				diamond(ctx, px, pipY, 5 * k);
				ctx.strokeStyle = rgba(color, 0.55);
				ctx.lineWidth = Math.max(0.6, 1.2 * k);
				ctx.stroke();
			}
		}
	}

	if (complexity >= 6 && complexity < 7)
	{
		drawSparkle(ctx, x, y - edge - 2 * k, 11 * k, mix(color, "#ffffff", 0.5));
	}
	if (complexity >= 7)
	{
		drawGlow(ctx, x, y - edge - 12 * k, 40 * k, accent, 0.45);
		drawCrown(ctx, x, y - edge - 12 * k, 56 * k, accent);
	}
	ctx.restore();
}

const ENSO_START = -Math.PI * 0.36;
const ENSO_SWEEP = Math.PI * 1.7;

function ensoWidth(t: number, thickness: number): number
{
	const attack = t < 0.04 ? 0.5 + (t / 0.04) * 0.5 : 1;
	return thickness * (0.16 + 0.84 * Math.pow(1 - t, 0.75)) * attack * (1 + 0.12 * Math.sin(t * 41));
}

function ensoRadius(t: number, radius: number, thickness: number): number
{
	return radius + Math.sin(t * 8 + 1) * thickness * 0.18;
}

function ensoPath(ctx: Ctx, x: number, y: number, radius: number, thickness: number): void
{
	const steps = 110;
	ctx.beginPath();
	for (let step = 0; step <= steps; step++)
	{
		const t = step / steps;
		const angle = ENSO_START + ENSO_SWEEP * t;
		const r = ensoRadius(t, radius, thickness) + ensoWidth(t, thickness) / 2;
		const px = x + Math.cos(angle) * r;
		const py = y + Math.sin(angle) * r;
		if (step === 0) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
	}
	for (let step = steps; step >= 0; step--)
	{
		const t = step / steps;
		const angle = ENSO_START + ENSO_SWEEP * t;
		const r = ensoRadius(t, radius, thickness) - ensoWidth(t, thickness) / 2;
		ctx.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
	}
	ctx.closePath();
}

/** Vòng bút lông (ensō): nét đậm ở đầu, mảnh dần, đuôi xơ bút; kèm vài sợi lông bút tối hơn chạy dọc nét. */
function drawEnso(ctx: Ctx, x: number, y: number, radius: number, thickness: number, color: string): void
{
	const ink = ctx.createConicGradient(ENSO_START, x, y);
	ink.addColorStop(0, rgba(mix(color, "#ffffff", 0.35), 0.98));
	ink.addColorStop(0.55, rgba(color, 0.9));
	ink.addColorStop(ENSO_SWEEP / (Math.PI * 2), rgba(color, 0.5));
	ink.addColorStop(1, rgba(color, 0.5));
	ensoPath(ctx, x, y, radius, thickness);
	ctx.fillStyle = ink;
	ctx.fill();

	ctx.save();
	ensoPath(ctx, x, y, radius, thickness);
	ctx.clip();
	ctx.strokeStyle = rgba(mix(color, "#000000", 0.45), 0.35);
	ctx.lineWidth = Math.max(0.5, thickness * 0.07);
	for (const offset of [-0.28, 0.05, 0.3])
	{
		ctx.beginPath();
		ctx.arc(x, y, radius + offset * thickness, ENSO_START + 0.15, ENSO_START + ENSO_SWEEP * 0.8);
		ctx.stroke();
	}
	ctx.restore();

	ctx.save();
	ctx.strokeStyle = rgba(color, 0.55);
	ctx.lineWidth = Math.max(0.5, thickness * 0.08);
	ctx.setLineDash([thickness * 0.9, thickness * 0.35, thickness * 0.25, thickness * 0.5]);
	const tail = ENSO_START + ENSO_SWEEP;
	for (const offset of [-0.22, 0, 0.2])
	{
		ctx.beginPath();
		ctx.arc(x, y, radius + offset * thickness, tail - 0.5, tail + 0.12 + Math.abs(offset) * 0.3);
		ctx.stroke();
	}
	ctx.restore();
}

/**
 * Khung thuỷ mặc (kiếm hiệp): vòng bút lông (ensō) quanh avatar. Từ bậc 1 thêm vòng trong; 2 bốn đám mây lành;
 * 3 hai thanh kiếm bắt chéo sau avatar; 4 thêm mây; 5 kiếm phát sáng; 6 tua đỏ ở chuôi kiếm; 7 kiếm và mây màu vàng.
 */
export function drawEnsoFrame(ctx: Ctx, x: number, y: number, radius: number, options: FrameOptions): void
{
	const { color, accent, complexity } = options;
	const k = scale(radius);
	const metal = complexity >= 7 ? accent : color;
	ctx.save();
	ctx.lineCap = "round";
	ctx.lineJoin = "round";

	if (complexity >= 3)
	{
		const length = radius * 2.6;
		const angles = [-Math.PI / 4, Math.PI / 4];
		ctx.save();
		if (complexity >= 5)
		{
			ctx.shadowColor = rgba(metal, 0.9);
			ctx.shadowBlur = 16 * k;
		}
		for (const angle of angles) drawSword(ctx, x, y, length, angle, mix(metal, "#eef2f8", 0.7), mix(metal, "#000000", 0.05), 0.019);
		ctx.restore();
		if (complexity >= 6 && options.detailed)
		{
			for (const angle of angles)
			{
				const pommelX = x - Math.sin(angle) * length * 0.43;
				const pommelY = y + Math.cos(angle) * length * 0.43;
				ctx.strokeStyle = "#e53935";
				ctx.lineWidth = Math.max(1, 2 * k);
				ctx.beginPath();
				ctx.moveTo(pommelX, pommelY);
				ctx.quadraticCurveTo(pommelX + 3 * k, pommelY + 8 * k, pommelX, pommelY + 14 * k);
				ctx.stroke();
				ctx.fillStyle = "#e53935";
				ctx.beginPath();
				ctx.moveTo(pommelX - 2 * k, pommelY + 13 * k);
				ctx.lineTo(pommelX + 2 * k, pommelY + 13 * k);
				ctx.lineTo(pommelX + 6 * k, pommelY + 27 * k);
				ctx.lineTo(pommelX - 6 * k, pommelY + 27 * k);
				ctx.closePath();
				ctx.fill();
			}
		}
	}

	if (complexity >= 2)
	{
		const cloudColor = rgba(complexity >= 7 ? accent : mix(color, "#ffffff", 0.3), 0.8);
		const spots: [number, number][] = [[-0.38, 1], [-0.62, -1], [0.62, 1], [0.38, -1]];
		if (complexity >= 4) spots.push([0, -1], [1, 1]);
		for (const [turn, flip] of spots)
		{
			const angle = turn * Math.PI;
			const distance = radius + 14 * k;
			drawCloudCurl(ctx, x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, 32 * k, cloudColor, Math.max(1, 2.6 * k), flip);
		}
	}

	drawEnso(ctx, x, y, radius - 5 * k, 20 * k, mix(color, "#ffffff", 0.15));
	if (complexity >= 1) strokeCircle(ctx, x, y, radius - 24 * k, rgba(color, 0.3), Math.max(0.6, 1.2 * k));
	ctx.restore();
}

const BRANCH = "#7a5a3a";
const GREEN = "#5cc46a";

function wreathLeaf(ctx: Ctx, x: number, y: number, size: number, angle: number, color: string): void
{
	drawLeaf(ctx, x, y, size, angle, color, 0.38);
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(angle);
	ctx.strokeStyle = rgba(mix(color, "#000000", 0.4), 0.55);
	ctx.lineWidth = Math.max(0.5, size * 0.06);
	ctx.beginPath();
	ctx.moveTo(size * 0.08, 0);
	ctx.quadraticCurveTo(size * 0.5, -size * 0.04, size * 0.85, 0);
	ctx.stroke();
	ctx.restore();
}

/**
 * Vòng dây leo (cây xanh): cành mọc từ đáy vòng lên hai bên, bậc càng cao cành càng dài (bậc 7 khép kín vòng) và lá càng dày.
 * Từ bậc 3 có hoa; 4 có quả; 5 thêm dây trong; 6 thêm đốm sáng; 7 lá vàng.
 */
export function drawVineWreath(ctx: Ctx, x: number, y: number, radius: number, options: FrameOptions): void
{
	const { color, accent, complexity } = options;
	const k = options.detailed ? scale(radius) : Math.max(scale(radius), 0.6);
	const r = radius - 4 * k;
	const span = Math.min(TAU - 0.05, (0.42 + complexity * 0.084) * TAU);
	const half = span / 2;
	const leaf = mix(GREEN, color, 0.3);
	ctx.save();
	ctx.lineCap = "round";

	if (complexity >= 5)
	{
		strokeCircle(ctx, x, y, r - 16 * k, rgba(leaf, 0.35), Math.max(0.6, 1.4 * k));
		for (let index = 0; index < 18; index++)
		{
			const angle = (index / 18) * TAU;
			const px = x + Math.cos(angle) * (r - 16 * k);
			const py = y + Math.sin(angle) * (r - 16 * k);
			drawLeaf(ctx, px, py, 8 * k, angle + Math.PI / 2 + (index % 2 === 0 ? 0.5 : -0.5), rgba(leaf, 0.5), 0.4);
		}
	}

	for (const side of [-1, 1])
	{
		const segments = 48;
		for (let step = 0; step < segments; step++)
		{
			const t0 = step / segments;
			const t1 = (step + 1) / segments;
			const a0 = Math.PI / 2 + side * half * t0;
			const a1 = Math.PI / 2 + side * half * t1;
			ctx.strokeStyle = mix(BRANCH, leaf, t0 * 0.55);
			ctx.lineWidth = Math.max(0.8, (6.5 - t0 * 4.5) * k);
			ctx.beginPath();
			ctx.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
			ctx.lineTo(x + Math.cos(a1) * r, y + Math.sin(a1) * r);
			ctx.stroke();
		}

		const nodes = Math.max(3, Math.round(half / (options.detailed ? 0.15 : 0.26)));
		for (let index = 0; index < nodes; index++)
		{
			const t = (index + 0.5) / nodes;
			const angle = Math.PI / 2 + side * half * t;
			const tangent = angle + (side * Math.PI) / 2;
			const size = (21 - t * 8) * k;
			for (const outward of [1, -1])
			{
				const shift = outward === 1 ? 0 : 0.05 * side;
				const px = x + Math.cos(angle + shift) * r;
				const py = y + Math.sin(angle + shift) * r;
				const golden = complexity >= 7 && (index + (outward === 1 ? 0 : 1)) % 3 === 0;
				const tint = golden ? accent : mix(leaf, outward === 1 ? "#ffffff" : "#000000", index % 2 === 0 ? 0.12 : 0.04);
				wreathLeaf(ctx, px, py, outward === 1 ? size : size * 0.82, tangent - side * outward * 0.62, tint);
			}
		}

		if (complexity >= 3)
		{
			for (let t = 0.28; t < 0.97; t += 0.3)
			{
				const angle = Math.PI / 2 + side * half * t;
				const px = x + Math.cos(angle) * (r + 7 * k);
				const py = y + Math.sin(angle) * (r + 7 * k);
				drawFlower(ctx, px, py, 21 * k, complexity === 3 ? color : "#f9a8d4", "#ffe082", angle);
			}
		}
		if (complexity >= 4)
		{
			for (let t = 0.14; t < 0.9; t += 0.3)
			{
				const angle = Math.PI / 2 + side * half * t;
				const px = x + Math.cos(angle) * (r - 9 * k);
				const py = y + Math.sin(angle) * (r - 9 * k);
				const fruit = complexity === 4 ? color : "#ef5350";
				fillCircle(ctx, px, py, 6.5 * k, fruit);
				fillCircle(ctx, px - 2 * k, py - 2 * k, 2 * k, rgba("#ffffff", 0.7));
			}
		}
	}

	wreathLeaf(ctx, x, y + r, 18 * k, Math.PI * 0.64, mix(leaf, "#000000", 0.1));
	wreathLeaf(ctx, x, y + r, 18 * k, Math.PI * 0.36, leaf);
	fillCircle(ctx, x, y + r, 5 * k, complexity >= 7 ? accent : mix(BRANCH, "#ffffff", 0.25));

	if (complexity >= 6)
	{
		for (let index = 0; index < 7; index++)
		{
			const angle = -Math.PI / 2 + (index - 3) * 0.42;
			const distance = r + (18 + (index % 2) * 10) * k;
			const px = x + Math.cos(angle) * distance;
			const py = y + Math.sin(angle) * distance;
			drawGlow(ctx, px, py, 9 * k, accent, 0.55);
			fillCircle(ctx, px, py, 1.8 * k, mix(accent, "#ffffff", 0.6));
		}
	}
	ctx.restore();
}

interface Orbit
{
	rx: number;
	ry: number;
	rotation: number;
	/** Góc (tham số elip) của hành tinh trên quỹ đạo. */
	body: number;
	size: number;
	ring: boolean;
}

const ORBITS: readonly Orbit[] = [
	{ rx: 1.06, ry: 0.36, rotation: -0.38, body: 0.2, size: 10, ring: false },
	{ rx: 1.14, ry: 0.3, rotation: 0.62, body: Math.PI + 0.28, size: 7.5, ring: false },
	{ rx: 1, ry: 0.44, rotation: 1.5, body: Math.PI - 0.12, size: 6.5, ring: false },
	{ rx: 1.2, ry: 0.26, rotation: -1.12, body: -0.22, size: 9, ring: true },
];

const PLANET_COLORS = ["#7dd3fc", "#fda4af", "#fcd34d", "#c4b5fd"];

/**
 * Khung thiên văn (vũ trụ): vòng tinh đồ có vạch chia và các quỹ đạo elip có hành tinh. Số quỹ đạo tăng theo bậc (1 → 4);
 * từ bậc 1 thêm vòng chấm ngoài; 3 thêm vệ tinh; 5 thêm quầng tinh vân; 7 hành tinh có vành và sao lấp lánh.
 */
export function drawOrbitFrame(ctx: Ctx, x: number, y: number, radius: number, options: FrameOptions): void
{
	const { color, accent, complexity } = options;
	const k = scale(radius);
	ctx.save();

	if (complexity >= 5)
	{
		drawGlow(ctx, x - 40 * k, y - 30 * k, radius * 0.95, mix(color, "#f472b6", 0.5), 0.22);
		drawGlow(ctx, x + 45 * k, y + 25 * k, radius * 0.9, mix(color, "#38bdf8", 0.5), 0.2);
	}

	const halo = ctx.createConicGradient(0, x, y);
	halo.addColorStop(0, rgba(color, 0.55));
	halo.addColorStop(0.33, rgba(mix(color, "#f472b6", 0.6), 0.45));
	halo.addColorStop(0.66, rgba(mix(color, "#38bdf8", 0.6), 0.45));
	halo.addColorStop(1, rgba(color, 0.55));
	strokeCircle(ctx, x, y, radius - 16 * k, halo, Math.max(1, 5 * k));

	strokeCircle(ctx, x, y, radius, rgba(color, 0.5), Math.max(0.6, 1.5 * k));
	ctx.strokeStyle = rgba(color, 0.55);
	for (let index = 0; index < 36; index++)
	{
		const angle = (index / 36) * TAU;
		const major = index % 3 === 0;
		ctx.lineWidth = Math.max(0.6, (major ? 1.6 : 1) * k);
		const inner = radius - (major ? 8 : 4) * k;
		ctx.beginPath();
		ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
		ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
		ctx.stroke();
	}
	if (complexity >= 1)
	{
		ctx.setLineDash([2 * k, 6 * k]);
		strokeCircle(ctx, x, y, radius + 10 * k, rgba(color, 0.45), Math.max(0.8, 1.6 * k));
		ctx.setLineDash([]);
	}

	const orbitCount = Math.min(ORBITS.length, 1 + Math.floor(complexity / 2));
	ORBITS.slice(0, orbitCount).forEach((orbit, index) =>
	{
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(orbit.rotation);
		ctx.beginPath();
		ctx.ellipse(0, 0, orbit.rx * radius, orbit.ry * radius, 0, 0, TAU);
		ctx.strokeStyle = rgba(mix(color, "#ffffff", 0.25), 0.75);
		ctx.lineWidth = Math.max(0.8, 2 * k);
		ctx.stroke();
		const px = Math.cos(orbit.body) * orbit.rx * radius;
		const py = Math.sin(orbit.body) * orbit.ry * radius;
		ctx.restore();
		const cos = Math.cos(orbit.rotation);
		const sin = Math.sin(orbit.rotation);
		const bodyX = x + px * cos - py * sin;
		const bodyY = y + px * sin + py * cos;
		const tint = index === 0 ? mix(color, "#ffffff", 0.2) : PLANET_COLORS[index % PLANET_COLORS.length];
		drawGlow(ctx, bodyX, bodyY, orbit.size * 2.6 * k, tint, 0.45);
		drawPlanet(ctx, bodyX, bodyY, orbit.size * k, tint, orbit.ring && complexity >= 7);
		if (complexity >= 3)
		{
			const moonAngle = orbit.body + 0.9;
			const mx = Math.cos(moonAngle) * orbit.rx * radius;
			const my = Math.sin(moonAngle) * orbit.ry * radius;
			fillCircle(ctx, x + mx * cos - my * sin, y + mx * sin + my * cos, Math.max(0.8, 2 * k), rgba("#ffffff", 0.8));
		}
	});

	if (complexity >= 7)
	{
		const sparkles: [number, number, number][] = [[-0.95, -0.55, 9], [0.9, -0.7, 7], [0.98, 0.5, 6], [-0.8, 0.78, 6]];
		for (const [sx, sy, size] of sparkles) drawSparkle(ctx, x + sx * radius, y + sy * radius, size * k, mix(accent, "#ffffff", 0.5));
	}
	ctx.restore();
}
