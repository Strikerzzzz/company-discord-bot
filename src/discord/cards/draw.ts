import { Image, loadImage, SKRSContext2D } from "@napi-rs/canvas";
import { formatNumber } from "../format";
import { font, FontWeight } from "./fonts";

/*
 * Helper vẽ dùng chung cho ảnh thẻ: màu, hình cơ bản, chữ (cắt vừa khung theo grapheme), làm sạch tên, PRNG có seed và avatar.
 * Mọi hàm ở đây chịu được dữ liệu người dùng bất thường (tên lạ, số NaN, màu sai định dạng, bytes ảnh hỏng) mà không throw.
 */

export type Ctx = SKRSContext2D;
export type Paint = Ctx["fillStyle"];
export type Gradient = ReturnType<Ctx["createLinearGradient"]>;

export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number
{
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, value));
}

/** Số nguyên an toàn để hiển thị: NaN/Infinity thành 0, phần thập phân bị bỏ. */
export function safeInt(value: number): number
{
	return Number.isFinite(value) ? Math.trunc(value) : 0;
}

/** Số theo kiểu Việt Nam, ví dụ 68.420. */
export function formatCount(value: number): string
{
	return formatNumber(safeInt(value));
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const FALLBACK_COLOR = 0x8a93b8;

export function isHexColor(value: unknown): value is string
{
	return typeof value === "string" && HEX_COLOR.test(value);
}

interface Rgb
{
	r: number;
	g: number;
	b: number;
}

function toRgb(hex: string): Rgb
{
	const value = isHexColor(hex) ? Number.parseInt(hex.slice(1), 16) : FALLBACK_COLOR;
	return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/** Màu "#rrggbb" kèm độ trong suốt; màu sai định dạng được thay bằng màu xám xanh mặc định. */
export function rgba(hex: string, alpha: number): string
{
	const { r, g, b } = toRgb(hex);
	return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1).toFixed(3)})`;
}

/** Pha hai màu: t = 0 là màu a, t = 1 là màu b. */
export function mix(a: string, b: string, t: number): string
{
	const from = toRgb(a);
	const to = toRgb(b);
	const k = clamp(t, 0, 1);
	const channel = (x: number, y: number): string => Math.round(x + (y - x) * k).toString(16).padStart(2, "0");
	return `#${channel(from.r, to.r)}${channel(from.g, to.g)}${channel(from.b, to.b)}`;
}

/** Độ sáng cảm nhận (0 đến 1), dùng để chọn màu chữ tương phản. */
export function luminance(hex: string): number
{
	const { r, g, b } = toRgb(hex);
	return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function roundedRectPath(ctx: Ctx, x: number, y: number, width: number, height: number, radius: number): void
{
	ctx.beginPath();
	ctx.roundRect(x, y, Math.max(0, width), Math.max(0, height), clamp(radius, 0, Math.min(width, height) / 2));
}

export function fillRoundedRect(ctx: Ctx, x: number, y: number, width: number, height: number, radius: number, paint: Paint): void
{
	roundedRectPath(ctx, x, y, width, height, radius);
	ctx.fillStyle = paint;
	ctx.fill();
}

export function strokeRoundedRect(ctx: Ctx, x: number, y: number, width: number, height: number, radius: number, paint: Paint, lineWidth: number): void
{
	roundedRectPath(ctx, x, y, width, height, radius);
	ctx.strokeStyle = paint;
	ctx.lineWidth = lineWidth;
	ctx.stroke();
}

/** Gradient tuyến tính với các màu chia đều. */
export function linearGradient(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, colors: readonly string[]): Gradient
{
	const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
	const last = Math.max(1, colors.length - 1);
	colors.forEach((color, index) => gradient.addColorStop(index / last, color));
	return gradient;
}

/** Quầng sáng tròn mờ dần ra ngoài. */
export function drawGlow(ctx: Ctx, x: number, y: number, radius: number, color: string, alpha: number): void
{
	if (radius <= 0) return;
	const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
	gradient.addColorStop(0, rgba(color, alpha));
	gradient.addColorStop(0.45, rgba(color, alpha * 0.45));
	gradient.addColorStop(1, rgba(color, 0));
	ctx.fillStyle = gradient;
	ctx.beginPath();
	ctx.arc(x, y, radius, 0, TAU);
	ctx.fill();
}

export function fillCircle(ctx: Ctx, x: number, y: number, radius: number, paint: Paint): void
{
	ctx.beginPath();
	ctx.arc(x, y, Math.max(0, radius), 0, TAU);
	ctx.fillStyle = paint;
	ctx.fill();
}

export function strokeCircle(ctx: Ctx, x: number, y: number, radius: number, paint: Paint, lineWidth: number): void
{
	ctx.beginPath();
	ctx.arc(x, y, Math.max(0, radius), 0, TAU);
	ctx.strokeStyle = paint;
	ctx.lineWidth = lineWidth;
	ctx.stroke();
}

const graphemeSegmenter = new Intl.Segmenter("vi", { granularity: "grapheme" });

export function graphemes(text: string): string[]
{
	return Array.from(graphemeSegmenter.segment(text), part => part.segment);
}

export const ELLIPSIS = "…";

/**
 * Cắt chữ cho vừa `maxWidth` (theo font hiện tại của ctx) và thêm "…" nếu bị cắt.
 * Chỉ cắt ở ranh giới grapheme nên không tách đôi chữ có dấu hay cặp surrogate. Không vừa cả "…" thì trả về chuỗi rỗng.
 */
export function fitText(ctx: Ctx, text: string, maxWidth: number): string
{
	if (maxWidth <= 0 || text.length === 0) return "";
	if (ctx.measureText(text).width <= maxWidth) return text;

	const parts = graphemes(text);
	const fits = (count: number): boolean => ctx.measureText(parts.slice(0, count).join("").trimEnd() + ELLIPSIS).width <= maxWidth;
	let low = 0;
	let high = parts.length - 1;
	while (low < high)
	{
		const middle = Math.ceil((low + high) / 2);
		if (fits(middle)) low = middle;
		else high = middle - 1;
	}
	if (low === 0) return ctx.measureText(ELLIPSIS).width <= maxWidth ? ELLIPSIS : "";
	return parts.slice(0, low).join("").trimEnd() + ELLIPSIS;
}

/** Cỡ chữ lớn nhất trong [minSize, maxSize] để `text` vừa `maxWidth`; đặt luôn ctx.font theo cỡ đó. */
export function fitFontSize(ctx: Ctx, text: string, weight: FontWeight, maxSize: number, minSize: number, maxWidth: number): number
{
	let size = maxSize;
	ctx.font = font(weight, size);
	while (size > minSize && ctx.measureText(text).width > maxWidth)
	{
		size -= 1;
		ctx.font = font(weight, size);
	}
	return size;
}

/**
 * Nối danh sách (ví dụ tên team) cho vừa `maxWidth`: giữ được bao nhiêu mục thì giữ, phần còn lại ghi "+N".
 * Mục đầu tiên dài quá thì bị cắt bằng "…".
 */
export function fitList(ctx: Ctx, items: readonly string[], maxWidth: number, separator = " · "): string
{
	if (items.length === 0) return "";
	for (let kept = items.length; kept >= 1; kept--)
	{
		const hidden = items.length - kept;
		const text = items.slice(0, kept).join(separator) + (hidden > 0 ? ` +${hidden}` : "");
		if (ctx.measureText(text).width <= maxWidth) return text;
	}
	const suffix = items.length > 1 ? ` +${items.length - 1}` : "";
	const first = fitText(ctx, items[0], maxWidth - ctx.measureText(suffix).width);
	return first.length > 0 ? first + suffix : fitText(ctx, items[0], maxWidth);
}

/** Vẽ chữ có độ giãn ký tự (letterSpacing), trả về độ rộng đã vẽ. */
export function drawSpacedText(ctx: Ctx, text: string, x: number, y: number, spacing: number): number
{
	ctx.letterSpacing = `${spacing}px`;
	ctx.fillText(text, x, y);
	const width = ctx.measureText(text).width;
	ctx.letterSpacing = "0px";
	return width;
}

export function measureSpaced(ctx: Ctx, text: string, spacing: number): number
{
	ctx.letterSpacing = `${spacing}px`;
	const width = ctx.measureText(text).width;
	ctx.letterSpacing = "0px";
	return width;
}

// Emoji (kể cả phần ghép: skin tone, cờ, keycap), variation selector, ký tự điều khiển, ký tự định dạng (\p{Cf}: ZWJ, tag của cờ,
// bidi override), vùng private use và surrogate lẻ: font không vẽ được hoặc làm hỏng bố cục.
const UNDRAWABLE = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\p{Variation_Selector}\p{Cc}\p{Cf}\p{Co}\p{Cs}]|⃣/gu;
// Chữ "zalgo" chồng hàng chục dấu tổ hợp: giữ tối đa 2 dấu liên tiếp (tiếng Việt cần nhiều nhất 2 dấu cho một chữ).
const EXCESS_MARKS = /(\p{M}{2})\p{M}+/gu;
const MAX_INPUT_LENGTH = 256;

/**
 * Làm sạch chữ trước khi vẽ: chuẩn hoá NFKC (chữ "kiểu cách" như 𝓣𝓲𝓮̂́𝓷 thành Tiến, chữ full-width thành thường),
 * bỏ ký tự font không vẽ được, gộp khoảng trắng. Có thể trả về chuỗi rỗng.
 */
export function cleanText(text: string): string
{
	const raw = typeof text === "string" ? text.slice(0, MAX_INPUT_LENGTH) : "";
	return raw
		.normalize("NFKC")
		.replace(UNDRAWABLE, "")
		.replace(EXCESS_MARKS, "$1")
		.replace(/\s+/gu, " ")
		.trim();
}

/** Tên hiển thị đã làm sạch (xem cleanText); rỗng thì trả về "?". */
export function cleanDisplayName(name: string): string
{
	const cleaned = cleanText(name);
	return cleaned.length > 0 ? cleaned : "?";
}

/** Chữ cái đầu (một grapheme, viết hoa) của tên đã làm sạch. */
export function initialOf(name: string): string
{
	const first = graphemes(cleanDisplayName(name))[0] ?? "?";
	return first.toLocaleUpperCase("vi");
}

/** Hash FNV-1a 32 bit, dùng làm seed cho hoa văn và màu avatar (ổn định giữa các lần vẽ). */
export function hashString(text: string): number
{
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index++)
	{
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

export type Random = () => number;

/** PRNG mulberry32: cùng seed luôn cho cùng dãy số trong [0, 1). */
export function mulberry32(seed: number): Random
{
	let state = seed >>> 0;
	return () =>
	{
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const AVATAR_COLORS = ["#5c6bc0", "#26a69a", "#ef6c00", "#8e24aa", "#00897b", "#c2185b", "#3949ab", "#6d4c41", "#0277bd", "#7cb342", "#d84315", "#5e35b1"];

/** Màu nền avatar chữ cái đầu, xác định theo tên (không random). */
export function colorForName(name: string): string
{
	return AVATAR_COLORS[hashString(cleanDisplayName(name)) % AVATAR_COLORS.length];
}

interface ImageSize
{
	width: number;
	height: number;
}

/**
 * Đọc kích thước ảnh từ header, chỉ nhận PNG, JPEG, GIF, WebP (định dạng avatar của Discord).
 * Định dạng khác (kể cả SVG) hoặc header hỏng trả về null.
 */
export function sniffImageSize(bytes: Buffer): ImageSize | null
{
	try
	{
		if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(4) === 0x0d0a1a0a && bytes.toString("latin1", 12, 16) === "IHDR")
		{
			return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
		}
		const head = bytes.toString("latin1", 0, 6);
		if (bytes.length >= 10 && (head === "GIF87a" || head === "GIF89a"))
		{
			return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
		}
		if (bytes.length >= 30 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return webpSize(bytes);
		if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes);
		return null;
	}
	catch
	{
		return null;
	}
}

function webpSize(bytes: Buffer): ImageSize | null
{
	const chunk = bytes.toString("latin1", 12, 16);
	if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a)
	{
		return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
	}
	if (chunk === "VP8L" && bytes[20] === 0x2f)
	{
		const b1 = bytes[22];
		const b2 = bytes[23];
		const b3 = bytes[24];
		return { width: 1 + (bytes[21] | ((b1 & 0x3f) << 8)), height: 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)) };
	}
	if (chunk === "VP8X")
	{
		return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
	}
	return null;
}

function jpegSize(bytes: Buffer): ImageSize | null
{
	let offset = 2;
	while (offset + 9 <= bytes.length)
	{
		if (bytes[offset] !== 0xff) return null;
		const marker = bytes[offset + 1];
		if (marker === 0xff)
		{
			offset += 1;
			continue;
		}
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9))
		{
			offset += 2;
			continue;
		}
		const length = bytes.readUInt16BE(offset + 2);
		if (length < 2) return null;
		const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
		if (isStartOfFrame) return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
		offset += 2 + length;
	}
	return null;
}

// Avatar của Discord tối đa 4096 px; ảnh khai báo lớn hơn có thể là "bom giải nén" làm tràn bộ nhớ khi decode.
const MAX_AVATAR_SIDE = 4096;
const DECODE_TIMEOUT_MS = 3000;

/**
 * Decode bytes avatar thành Image. Không bao giờ throw: bytes rỗng, định dạng lạ, ảnh quá lớn, decode lỗi hay quá lâu đều trả về null
 * (khi đó ảnh vẽ chữ cái đầu). Chỉ truyền Buffer vào loadImage: chuỗi sẽ bị loadImage hiểu là đường dẫn file hoặc URL.
 */
export async function decodeAvatar(bytes: Buffer | null): Promise<Image | null>
{
	if (!Buffer.isBuffer(bytes) || bytes.length === 0) return null;
	const size = sniffImageSize(bytes);
	if (!size || size.width < 1 || size.height < 1 || size.width > MAX_AVATAR_SIDE || size.height > MAX_AVATAR_SIDE) return null;

	let timer: NodeJS.Timeout | undefined;
	try
	{
		const decoded = loadImage(bytes).catch(() => null);
		const timeout = new Promise<null>(resolve =>
		{
			timer = setTimeout(() => resolve(null), DECODE_TIMEOUT_MS);
		});
		const image = await Promise.race([decoded, timeout]);
		return image && image.width > 0 && image.height > 0 ? image : null;
	}
	catch
	{
		return null;
	}
	finally
	{
		if (timer) clearTimeout(timer);
	}
}

/** Vẽ ảnh vào hình tròn, cắt giữa theo kiểu "cover". Trả về false nếu vẽ lỗi. */
export function drawCircleImage(ctx: Ctx, image: Image, x: number, y: number, radius: number): boolean
{
	ctx.save();
	try
	{
		ctx.beginPath();
		ctx.arc(x, y, radius, 0, TAU);
		ctx.closePath();
		ctx.clip();
		const side = Math.min(image.width, image.height);
		ctx.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, x - radius, y - radius, radius * 2, radius * 2);
		return true;
	}
	catch
	{
		return false;
	}
	finally
	{
		ctx.restore();
	}
}

/** Avatar chữ cái đầu trên nền màu (màu truyền vào, hoặc màu xác định theo tên). */
export function drawInitialAvatar(ctx: Ctx, name: string, x: number, y: number, radius: number, color: string | null = null): void
{
	const base = isHexColor(color) ? color : colorForName(name);
	fillCircle(ctx, x, y, radius, linearGradient(ctx, x - radius, y - radius, x + radius, y + radius, [mix(base, "#ffffff", 0.18), mix(base, "#000000", 0.35)]));

	const initial = initialOf(name);
	ctx.save();
	ctx.fillStyle = luminance(base) > 0.62 ? "#141726" : "#ffffff";
	ctx.textAlign = "center";
	ctx.textBaseline = "alphabetic";
	fitFontSize(ctx, initial, 800, Math.round(radius * 0.95), Math.max(8, Math.round(radius * 0.4)), radius * 1.3);
	const metrics = ctx.measureText(initial);
	const ascent = metrics.actualBoundingBoxAscent;
	const descent = metrics.actualBoundingBoxDescent;
	const baseline = Number.isFinite(ascent) && Number.isFinite(descent) ? y + (ascent - descent) / 2 : y + radius * 0.33;
	ctx.fillText(initial, x, baseline);
	ctx.restore();
}

/** Avatar tròn: ảnh nếu có và vẽ được, ngược lại chữ cái đầu. */
export function drawAvatar(ctx: Ctx, image: Image | null, name: string, x: number, y: number, radius: number, fallbackColor: string | null = null): void
{
	if (image && drawCircleImage(ctx, image, x, y, radius)) return;
	drawInitialAvatar(ctx, name, x, y, radius, fallbackColor);
}
