import { existsSync } from "fs";
import path from "path";
import { GlobalFonts } from "@napi-rs/canvas";

/*
 * Font Be Vietnam Pro (SIL OFL 1.1) trong assets/fonts.
 * Cả 4 weight đăng ký chung một family: @napi-rs/canvas 1.0.9 (Skia) tự chọn đúng file theo weight ghi trong `ctx.font`
 * (đã kiểm chứng: "400/600/700/800 40px \"Be Vietnam Pro\"" cho ra 4 nét khác nhau, và GlobalFonts.families liệt kê đủ 4 weight),
 * nên không cần alias riêng cho từng weight.
 */
export const FONT_FAMILY = "Be Vietnam Pro";

export type FontWeight = 400 | 600 | 700 | 800;

const FONT_FILES = [
	"BeVietnamPro-Regular.ttf",
	"BeVietnamPro-SemiBold.ttf",
	"BeVietnamPro-Bold.ttf",
	"BeVietnamPro-ExtraBold.ttf",
];

const MARKER_FILE = path.join("assets", "fonts", "BeVietnamPro-Bold.ttf");

// Code chạy từ build/discord/cards (3 cấp tới gốc repo) hoặc build-test/src/discord/cards (4 cấp); dò dư ra vài cấp.
const MAX_LEVELS_UP = 6;

let registered = false;

/** Tìm thư mục assets/fonts bằng cách đi ngược từ `start` lên tối đa 6 cấp (không dựa vào process.cwd()). */
export function findFontDir(start: string = __dirname): string
{
	let dir = path.resolve(start);
	for (let level = 0; level <= MAX_LEVELS_UP; level++)
	{
		if (existsSync(path.join(dir, MARKER_FILE))) return path.join(dir, "assets", "fonts");
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error(`Không tìm thấy font: cần file ${MARKER_FILE} ở thư mục gốc của bot (dò từ ${start} lên ${MAX_LEVELS_UP} cấp).`);
}

/** Đăng ký font một lần cho cả process; gọi lại nhiều lần không có tác dụng phụ. */
export function ensureFonts(): void
{
	if (registered) return;

	const dir = findFontDir();
	for (const file of FONT_FILES)
	{
		const key = GlobalFonts.registerFromPath(path.join(dir, file), FONT_FAMILY);
		if (!key) throw new Error(`Không đăng ký được font ${file} trong ${dir}.`);
	}
	registered = true;
}

/** Chuỗi `ctx.font`, ví dụ font(800, 44) = `800 44px "Be Vietnam Pro"`. */
export function font(weight: FontWeight, size: number): string
{
	return `${weight} ${Math.max(1, Math.round(size))}px "${FONT_FAMILY}"`;
}
