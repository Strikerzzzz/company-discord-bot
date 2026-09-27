import type { LeaderboardCardData, LeaderboardCardRow, RankCardData, RenderedCard } from "../discord/cards/types";
import { levelInfo, totalXpForLevel } from "../modules/activity/levels";
import { DEFAULT_TIER_SET, nextTier, tierForLevel } from "../modules/activity/tiers";
import { CheckResult, errorText, fail, ok, warn } from "./checks";

/*
 * Kiểm tra @napi-rs/canvas, font và vẽ thử ảnh cho selfcheck. Module này chỉ import kiểu của phần vẽ ảnh;
 * @napi-rs/canvas (binary native) được nạp trong loadCanvasToolkit để lỗi nạp thành dòng ❌ thay vì làm selfcheck sập.
 */

export interface ImageSize
{
	width: number;
	height: number;
}

/** Bộ công cụ vẽ ảnh của selfcheck; mặc định là @napi-rs/canvas và hàm vẽ thật của bot (loadCanvasToolkit). */
export interface CanvasToolkit
{
	fontFamily: string;
	findFontDir(): string;
	ensureFonts(): void;
	renderRankCard(data: RankCardData): Promise<RenderedCard>;
	renderLeaderboardCard(data: LeaderboardCardData): Promise<RenderedCard>;
	/** Decode lại PNG để chắc ảnh đọc được. */
	decodeImage(png: Buffer): Promise<ImageSize>;
	/** Avatar mẫu dạng PNG, vẽ bằng canvas (đi qua cả bước decode avatar khi vẽ thẻ). */
	sampleAvatar(): Buffer;
}

const AVATAR_SIZE = 128;

export async function loadCanvasToolkit(): Promise<CanvasToolkit>
{
	const [canvas, fonts, rankCard, leaderboardCard] = await Promise.all([
		import("@napi-rs/canvas"),
		import("../discord/cards/fonts"),
		import("../discord/cards/rankCard"),
		import("../discord/cards/leaderboardCard"),
	]);
	return {
		fontFamily: fonts.FONT_FAMILY,
		findFontDir: () => fonts.findFontDir(),
		ensureFonts: () => fonts.ensureFonts(),
		renderRankCard: data => rankCard.renderRankCard(data),
		renderLeaderboardCard: data => leaderboardCard.renderLeaderboardCard(data),
		decodeImage: async png =>
		{
			const image = await canvas.loadImage(png);
			return { width: image.width, height: image.height };
		},
		sampleAvatar: () =>
		{
			const surface = canvas.createCanvas(AVATAR_SIZE, AVATAR_SIZE);
			const ctx = surface.getContext("2d");
			ctx.fillStyle = "#3949ab";
			ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
			ctx.fillStyle = "#ffffff";
			ctx.beginPath();
			ctx.arc(AVATAR_SIZE / 2, AVATAR_SIZE * 0.4, AVATAR_SIZE * 0.2, 0, Math.PI * 2);
			ctx.fill();
			return surface.toBuffer("image/png");
		},
	};
}

export interface CanvasCheck
{
	results: CheckResult[];
	/** null nếu @napi-rs/canvas không nạp được hoặc font không đăng ký được; bước vẽ thử khi đó bị bỏ qua. */
	toolkit: CanvasToolkit | null;
}

/** Nạp @napi-rs/canvas, tìm thư mục assets/fonts và đăng ký font như bot. */
export async function checkCanvas(load: () => Promise<CanvasToolkit>, platform: string, arch: string): Promise<CanvasCheck>
{
	let toolkit: CanvasToolkit;
	try
	{
		toolkit = await load();
	}
	catch (error)
	{
		return {
			results: [fail("canvas", `@napi-rs/canvas không nạp được: ${errorText(error)}. Chạy lại "npm ci" trên chính máy này để npm cài binary dựng sẵn đúng nền tảng (${platform}-${arch}); copy node_modules từ máy khác hoặc cài với --omit=optional sẽ thiếu binary này.`)],
			toolkit: null,
		};
	}

	const loaded = ok("canvas", "@napi-rs/canvas nạp được.");
	try
	{
		const dir = toolkit.findFontDir();
		toolkit.ensureFonts();
		return { results: [loaded, ok("fonts", `Font ${toolkit.fontFamily}: đăng ký được từ ${dir}.`)], toolkit };
	}
	catch (error)
	{
		return { results: [loaded, fail("fonts", `Font: ${errorText(error)} Bản triển khai phải có thư mục assets/fonts.`)], toolkit: null };
	}
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Kích thước ghi trong chunk IHDR nếu bytes là PNG, ngược lại null. */
export function pngSize(png: Buffer): ImageSize | null
{
	if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE) || png.toString("latin1", 12, 16) !== "IHDR") return null;
	return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function thousands(value: number): string
{
	return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Dữ liệu giả của thẻ rank, bộ danh hiệu mặc định. */
export function sampleRankCard(avatar: Buffer | null): RankCardData
{
	const level = levelInfo(totalXpForLevel(12) + 150);
	return {
		displayName: "Kiểm Tra Môi Trường",
		avatar,
		level,
		tierSet: DEFAULT_TIER_SET,
		tier: tierForLevel(level.level, DEFAULT_TIER_SET),
		nextTier: nextTier(level.level, DEFAULT_TIER_SET),
		activity: { rank: 3, totalRanked: 37, weeklyXp: 1240, weeklyRank: 2 },
		contribution: { score: 86, rank: 4, totalRanked: 21, contributions: 12 },
		streak: { current: 12, best: 30, activeToday: true },
		achievements: { unlocked: 7, total: 15 },
		teamNames: ["Backend", "QA"],
	};
}

/** Dữ liệu giả của một trang bảng Activity cá nhân (10 dòng, nhiều bậc của bộ mặc định). */
export function sampleLeaderboard(avatar: Buffer | null): LeaderboardCardData
{
	const levels = [42, 35, 28, 22, 17, 12, 8, 5, 2, 0];
	const rows = levels.map((level, index): LeaderboardCardRow => ({
		rank: index + 1,
		name: `Thành viên mẫu ${index + 1}`,
		avatar: index % 2 === 0 ? avatar : null,
		value: `${thousands(totalXpForLevel(level) + 37)} XP`,
		detail: `Lv ${level}`,
		tier: tierForLevel(level, DEFAULT_TIER_SET),
		accentColor: null,
		highlight: index === 4,
	}));
	return {
		title: "BẢNG XẾP HẠNG · ACTIVITY XP",
		subtitle: "Cá nhân · Tổng",
		rows,
		footer: `Trang 1/1 · ${rows.length} người`,
		emptyText: "Chưa có ai trên bảng này",
	};
}

/** Vẽ lâu hơn mức này thì cảnh báo: máy dev vẽ mỗi ảnh trong vài trăm ms. */
const SLOW_RENDER_MS = 2000;

async function renderOnce(label: string, render: () => Promise<RenderedCard>, canvas: CanvasToolkit, now: () => number): Promise<CheckResult>
{
	const started = now();
	let card: RenderedCard;
	try
	{
		card = await render();
	}
	catch (error)
	{
		return fail("render", `Vẽ ${label} thất bại: ${errorText(error)}`);
	}
	const elapsed = Math.round(now() - started);

	const size = pngSize(card.png);
	if (!size || size.width !== card.width || size.height !== card.height)
	{
		return fail("render", `Vẽ ${label}: kết quả không phải PNG hợp lệ (${card.png.length} byte).`);
	}
	try
	{
		const decoded = await canvas.decodeImage(card.png);
		if (decoded.width !== size.width || decoded.height !== size.height)
		{
			return fail("render", `Vẽ ${label}: PNG đọc lại ra ${decoded.width}×${decoded.height}, khác ${size.width}×${size.height}.`);
		}
	}
	catch (error)
	{
		return fail("render", `Vẽ ${label}: không đọc lại được PNG (${errorText(error)}).`);
	}

	const detail = `PNG ${size.width}×${size.height}, ${Math.ceil(card.png.length / 1024)} KB, vẽ mất ${elapsed} ms`;
	if (elapsed > SLOW_RENDER_MS) return warn("render", `Vẽ ${label} chậm: ${detail} (máy yếu hoặc đang bận; người dùng sẽ chờ ảnh lâu).`);
	return ok("render", `Vẽ ${label}: ${detail}.`);
}

/** Vẽ thử một thẻ rank và một bảng xếp hạng mẫu bằng đúng hàm vẽ của bot, kiểm tra PNG và đo thời gian vẽ. */
export async function checkRendering(canvas: CanvasToolkit, now: () => number): Promise<CheckResult[]>
{
	let avatar: Buffer;
	try
	{
		avatar = canvas.sampleAvatar();
	}
	catch (error)
	{
		return [fail("render", `Không tạo được ảnh bằng @napi-rs/canvas: ${errorText(error)}`)];
	}
	return [
		await renderOnce("thẻ rank", () => canvas.renderRankCard(sampleRankCard(avatar)), canvas, now),
		await renderOnce("bảng xếp hạng", () => canvas.renderLeaderboardCard(sampleLeaderboard(avatar)), canvas, now),
	];
}
