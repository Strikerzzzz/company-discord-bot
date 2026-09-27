import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { boardStyle, renderLeaderboardCard } from "../src/discord/cards/leaderboardCard";
import { renderRankCard, streakHint } from "../src/discord/cards/rankCard";
import { cleanDisplayName, colorForName, decodeAvatar, fitList, fitText, graphemes, hashString, initialOf, MAX_AVATAR_SIDE, mulberry32, sniffImageSize } from "../src/discord/cards/draw";
import { hasTierEmblem } from "../src/discord/cards/emblems";
import { ensureFonts, findFontDir, font } from "../src/discord/cards/fonts";
import { cardStyle } from "../src/discord/cards/styles";
import { cardTexts, drawTierPill, isTopTier, measureTierPill, NEUTRAL_TEXTS, tierPosition, tierSetKeyOf } from "../src/discord/cards/theme";
import { LeaderboardCardData, LeaderboardCardRow, RankCardData, RenderedCard } from "../src/discord/cards/types";
import { LevelInfo, levelInfo, totalXpForLevel } from "../src/modules/activity/levels";
import { applyTierOverrides, DEFAULT_TIER_SET, nextTier, Tier, tierForLevel, TIER_SET_KEYS, TIER_SETS, TierSet, TIERS } from "../src/modules/activity/tiers";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_RENDER_MS = 1000;

function pngSize(png: Buffer): { width: number; height: number }
{
	assert.equal(png.toString("latin1", 12, 16), "IHDR");
	return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function assertCard(card: RenderedCard, fileName: string): Promise<void>
{
	assert.ok(card.png.subarray(0, 8).equals(PNG_SIGNATURE), "không phải PNG");
	assert.deepEqual(pngSize(card.png), { width: card.width, height: card.height });
	assert.equal(card.fileName, fileName);
	assert.match(card.fileName, /^[a-z0-9-]+\.png$/);
	const image = await loadImage(card.png);
	assert.equal(image.width, card.width);
	assert.equal(image.height, card.height);
}

async function timed<T>(render: () => Promise<T>): Promise<T>
{
	const started = performance.now();
	const result = await render();
	const elapsed = performance.now() - started;
	assert.ok(elapsed < MAX_RENDER_MS, `vẽ mất ${elapsed.toFixed(0)} ms`);
	return result;
}

function fakeAvatar(format: "png" | "jpeg" | "webp" = "png", size = 128): Buffer
{
	const canvas = createCanvas(size, size);
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#3949ab";
	ctx.fillRect(0, 0, size, size);
	ctx.fillStyle = "#ffffff";
	ctx.beginPath();
	ctx.arc(size / 2, size * 0.4, size * 0.2, 0, Math.PI * 2);
	ctx.fill();
	return format === "png" ? canvas.toBuffer("image/png") : format === "jpeg" ? canvas.toBuffer("image/jpeg") : canvas.toBuffer("image/webp");
}

function rankData(overrides: Partial<RankCardData> = {}, totalXp = 2300): RankCardData
{
	const level = levelInfo(totalXp);
	return {
		displayName: "Nguyễn Tuấn Tiến",
		avatar: fakeAvatar(),
		level,
		tierSet: DEFAULT_TIER_SET,
		tier: tierForLevel(level.level),
		nextTier: nextTier(level.level),
		activity: { rank: 3, totalRanked: 37, weeklyXp: 1240, weeklyRank: 2 },
		contribution: { score: 86, rank: 4, totalRanked: 21, contributions: 12 },
		streak: { current: 12, best: 30, activeToday: true },
		achievements: { unlocked: 7, total: 15 },
		teamNames: ["Backend"],
		...overrides,
	};
}

function row(rank: number, overrides: Partial<LeaderboardCardRow> = {}): LeaderboardCardRow
{
	const level = Math.max(0, 40 - rank * 3);
	return {
		rank,
		name: `Thành viên số ${rank}`,
		avatar: null,
		value: `${(10000 - rank * 700).toLocaleString("vi-VN")} XP`,
		detail: `Lv ${level}`,
		tier: tierForLevel(level),
		accentColor: null,
		highlight: false,
		...overrides,
	};
}

/** Dữ liệu thẻ rank ở bậc `tier` của bộ `set` (level vừa qua mốc của bậc). */
function tierRankData(set: TierSet, tier: Tier, overrides: Partial<RankCardData> = {}): RankCardData
{
	const level = levelInfo(totalXpForLevel(tier.minLevel) + 10);
	return rankData({ tierSet: set, tier, nextTier: nextTier(level.level, set), level, ...overrides });
}

/** 10 dòng bảng Activity với nhiều bậc khác nhau của bộ `set`. */
function setRows(set: TierSet): LeaderboardCardRow[]
{
	const levels = [45, 38, 33, 27, 21, 16, 12, 8, 4, 1];
	return levels.map((level, index) => row(index + 1, { detail: `Lv ${level}`, tier: tierForLevel(level, set), highlight: index === 5 }));
}

/**
 * Bậc mang dữ liệu hỏng (bộ, khoá hoặc vị trí lạ) như khi dữ liệu bị sửa tay. Object.assign giữ kiểu Tier cho kết quả
 * nên không cần ép kiểu, dù giá trị lúc chạy không thuộc TierSetKey/TierKey.
 */
function corruptTier(base: Tier, patch: { setKey?: string; key?: string; index?: number }): Tier
{
	return Object.assign({}, base, patch);
}

const LONG_TIER_NAME = "Đại Thụ Ngàn Năm Vĩnh Hằng Bất Tử";

function board(rows: LeaderboardCardRow[], overrides: Partial<LeaderboardCardData> = {}): LeaderboardCardData
{
	return {
		title: "BẢNG XẾP HẠNG · ACTIVITY XP",
		subtitle: "Cá nhân · Tuần này (từ 21/09)",
		rows,
		footer: `Trang 1/1 · ${rows.length} người`,
		emptyText: "Chưa có ai trên bảng này",
		...overrides,
	};
}

before(async () =>
{
	ensureFonts();
	await renderRankCard(rankData());
});

describe("fonts", () =>
{
	test("tìm được thư mục font khi đi ngược từ thư mục build; gọi ensureFonts nhiều lần không lỗi", () =>
	{
		assert.ok(findFontDir().endsWith(path.join("assets", "fonts")));
		ensureFonts();
		ensureFonts();
	});

	test("không có font thì báo lỗi rõ ràng", () =>
	{
		assert.throws(() => findFontDir(path.parse(process.execPath).root), /Không tìm thấy font/);
	});
});

describe("helper vẽ", () =>
{
	test("cleanDisplayName bỏ emoji, ký tự điều khiển, chuẩn hoá chữ kiểu cách; rỗng thì '?'", () =>
	{
		assert.equal(cleanDisplayName("Nguyễn Tuấn Tiến"), "Nguyễn Tuấn Tiến");
		assert.equal(cleanDisplayName("Tiến 🔥🔥"), "Tiến");
		assert.equal(cleanDisplayName("👨‍👩‍👧‍👦 🇻🇳 1️⃣"), "1");
		assert.equal(cleanDisplayName("👻👻"), "?");
		assert.equal(cleanDisplayName(""), "?");
		assert.equal(cleanDisplayName("   a \t\n  b  "), "a b");
		assert.equal(cleanDisplayName("𝓣𝓲𝓮̂́𝓷"), "Tiến");
		assert.equal(cleanDisplayName("Ｆｕｌｌ"), "Full");
		assert.equal(cleanDisplayName("a‮b​c\u0000d"), "abcd");
		assert.equal(cleanDisplayName("x\uD800y"), "xy");
		const zalgo = cleanDisplayName(`Z${"̀́̂̃̄".repeat(10)}a`);
		assert.ok(zalgo.length <= 4, zalgo);
	});

	test("initialOf lấy một grapheme viết hoa, giữ dấu tiếng Việt", () =>
	{
		assert.equal(initialOf("nguyễn"), "N");
		assert.equal(initialOf("đạt"), "Đ");
		assert.equal(initialOf("ấn"), "Ấ");
		assert.equal(initialOf("🔥"), "?");
		assert.equal(initialOf("  "), "?");
	});

	test("màu avatar chữ cái đầu xác định theo tên", () =>
	{
		assert.equal(colorForName("Lan"), colorForName("Lan"));
		assert.match(colorForName("Lan"), /^#[0-9a-f]{6}$/);
	});

	test("fitText cắt theo độ rộng, thêm '…', không tách đôi grapheme", () =>
	{
		ensureFonts();
		const ctx = createCanvas(10, 10).getContext("2d");
		ctx.font = font(700, 24);
		assert.equal(fitText(ctx, "Lan", 500), "Lan");
		const decomposed = "Nguyễn 👨‍👩‍👧 ".repeat(20);
		const cut = fitText(ctx, decomposed, 200);
		assert.ok(cut.endsWith("…"));
		assert.ok(ctx.measureText(cut).width <= 200);
		const original = new Set(graphemes(decomposed));
		for (const part of graphemes(cut.slice(0, -1))) assert.ok(original.has(part), `grapheme lạ: ${JSON.stringify(part)}`);
		assert.equal(fitText(ctx, "Lan", 0), "");
		assert.ok(["…", ""].includes(fitText(ctx, "Nguyễn", 3)));
	});

	test("fitList giữ được bao nhiêu mục thì giữ, còn lại ghi +N", () =>
	{
		ensureFonts();
		const ctx = createCanvas(10, 10).getContext("2d");
		ctx.font = font(600, 19);
		assert.equal(fitList(ctx, ["Backend", "Frontend"], 1000), "Backend · Frontend");
		const fitted = fitList(ctx, ["Backend", "Frontend", "QA", "Platform"], 200);
		assert.match(fitted, /\+\d$/);
		assert.ok(ctx.measureText(fitted).width <= 200);
		assert.equal(fitList(ctx, [], 200), "");
	});

	test("PRNG có seed: cùng seed cùng dãy, khác seed khác dãy, giá trị trong [0, 1)", () =>
	{
		const first = mulberry32(hashString("Nguyễn"));
		const second = mulberry32(hashString("Nguyễn"));
		const other = mulberry32(hashString("Trần"));
		const a = Array.from({ length: 50 }, () => first());
		const b = Array.from({ length: 50 }, () => second());
		const c = Array.from({ length: 50 }, () => other());
		assert.deepEqual(a, b);
		assert.notDeepEqual(a, c);
		assert.ok(a.every(value => value >= 0 && value < 1));
	});

	test("sniffImageSize nhận PNG/JPEG/WebP; từ chối GIF (bom giải nén nhiều khung), SVG và dữ liệu rác", async () =>
	{
		const canvas = createCanvas(120, 90);
		canvas.getContext("2d").fillRect(0, 0, 120, 90);
		for (const bytes of [await canvas.encode("png"), await canvas.encode("jpeg"), await canvas.encode("webp"), canvas.toBuffer("image/webp", 100)])
		{
			assert.deepEqual(sniffImageSize(bytes), { width: 120, height: 90 });
		}
		assert.equal(sniffImageSize(await canvas.encode("gif")), null);
		assert.equal(sniffImageSize(Buffer.from("GIF89a\x10\x00\x10\x00\x00\x00\x00", "latin1")), null);
		assert.equal(sniffImageSize(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")), null);
		assert.equal(sniffImageSize(Buffer.from("rác")), null);
		assert.equal(sniffImageSize(Buffer.alloc(0)), null);
		assert.equal(sniffImageSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01])), null);
	});

	test("decodeAvatar trả về null với bytes hỏng, SVG, GIF, ảnh khai báo quá 1024 px; decode được ảnh thật", async () =>
	{
		assert.equal(MAX_AVATAR_SIDE, 1024);
		assert.equal(await decodeAvatar(null), null);
		assert.equal(await decodeAvatar(Buffer.alloc(0)), null);
		assert.equal(await decodeAvatar(Buffer.from("không phải ảnh")), null);
		const png = fakeAvatar();
		assert.equal(await decodeAvatar(Buffer.concat([png.subarray(0, 40), Buffer.from("hỏng hỏng hỏng")])), null);
		const huge = Buffer.from(png);
		huge.writeUInt32BE(100_000, 16);
		huge.writeUInt32BE(100_000, 20);
		assert.equal(await decodeAvatar(huge), null);
		const gif = createCanvas(32, 32);
		gif.getContext("2d").fillRect(0, 0, 32, 32);
		assert.equal(await decodeAvatar(await gif.encode("gif")), null, "GIF bị từ chối dù nhỏ");
		assert.equal(await decodeAvatar(fakeAvatar("png", MAX_AVATAR_SIDE + 1)), null, "quá 1024 px");
		assert.equal((await decodeAvatar(fakeAvatar("png", MAX_AVATAR_SIDE)))?.width, MAX_AVATAR_SIDE);
		assert.equal(await decodeAvatar(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='9' height='9'/>")), null);
		assert.equal((await decodeAvatar(png))?.width, 128);
		assert.equal((await decodeAvatar(fakeAvatar("jpeg", 64)))?.width, 64);
	});
});

describe("bộ danh hiệu trên ảnh thẻ", () =>
{
	test("chữ trên thẻ lấy theo texts của bộ; thiếu hoặc rỗng thì dùng chữ trung tính", () =>
	{
		for (const key of TIER_SET_KEYS)
		{
			const set = TIER_SETS[key];
			assert.deepEqual(cardTexts(set), { tierLabel: set.texts.tierLabel, maxTier: set.texts.maxTier, idleToday: set.texts.idleToday });
		}
		assert.equal(cardTexts(TIER_SETS["rank-game"]).maxTier, "Đã đạt hạng cao nhất");
		assert.equal(cardTexts(TIER_SETS["cay-xanh"]).idleToday, "Hôm nay chưa tưới cây");
		assert.deepEqual(cardTexts(undefined), NEUTRAL_TEXTS);
		const broken: TierSet = { ...DEFAULT_TIER_SET, texts: { ...DEFAULT_TIER_SET.texts, maxTier: "  ", idleToday: "🔥", tierLabel: "Cảnh\u0000giới" } };
		assert.deepEqual(cardTexts(broken), { tierLabel: "Cảnhgiới", maxTier: NEUTRAL_TEXTS.maxTier, idleToday: NEUTRAL_TEXTS.idleToday });
		const neutral = [NEUTRAL_TEXTS.tierLabel, NEUTRAL_TEXTS.maxTier, NEUTRAL_TEXTS.idleToday];
		assert.ok(neutral.every(text => !/cảnh giới|tu luyện/iu.test(text)), "chữ trung tính không mang giọng tu tiên");
	});

	test("dòng nhắc chuỗi ngày dùng idleToday của bộ khi hôm nay chưa có tin được XP", () =>
	{
		for (const key of TIER_SET_KEYS)
		{
			const texts = cardTexts(TIER_SETS[key]);
			assert.equal(streakHint(5, 9, false, texts)?.text, texts.idleToday);
		}
		const texts = cardTexts(DEFAULT_TIER_SET);
		assert.equal(streakHint(10, 10, true, texts)?.text, "Đang lập kỷ lục!");
		assert.equal(streakHint(0, 4, false, texts)?.text, "Nhắn tin để nhóm lửa");
		assert.equal(streakHint(3, 9, true, texts), null);
	});

	test("vị trí bậc lấy từ tier.index, sai thì suy từ key, không suy được thì null; bậc cao nhất là vị trí 7 của mọi bộ", () =>
	{
		for (const key of TIER_SET_KEYS)
		{
			const tiers = TIER_SETS[key].tiers;
			tiers.forEach((tier, index) => assert.equal(tierPosition(tier), index));
			assert.ok(isTopTier(tiers[7]));
			assert.ok(!isTopTier(tiers[6]));
			assert.equal(tierSetKeyOf(tiers[0]), key);
		}
		assert.equal(tierPosition(corruptTier(TIERS[3], { index: 99 })), 3);
		assert.equal(tierPosition(corruptTier(TIERS[3], { index: Number.NaN, key: "bac-6" })), 5);
		assert.equal(tierPosition(corruptTier(TIERS[3], { index: -1, key: "canh-gioi-la" })), null);
		assert.equal(tierSetKeyOf(corruptTier(TIERS[0], { setKey: "khong-co" })), null);
		assert.equal(tierSetKeyOf(null), null);
	});

	test("mỗi bộ có đủ 8 biểu tượng bậc; bộ hoặc vị trí lạ thì dùng biểu tượng dự phòng", () =>
	{
		for (const key of TIER_SET_KEYS)
		{
			for (let index = 0; index < 8; index++) assert.ok(hasTierEmblem(key, index), `${key} #${index}`);
			assert.ok(!hasTierEmblem(key, 8));
			assert.ok(!hasTierEmblem(key, -1));
			assert.ok(!hasTierEmblem(key, 1.5));
			assert.ok(!hasTierEmblem(key, null));
		}
		assert.ok(!hasTierEmblem("khong-co", 0));
		assert.ok(!hasTierEmblem(null, 0));
	});

	test("phong cách ảnh theo bộ; bộ lạ dùng phong cách trung tính; bảng xếp hạng lấy bộ từ bậc của các dòng", () =>
	{
		for (const key of TIER_SET_KEYS)
		{
			assert.equal(cardStyle(key).key, key);
			assert.equal(boardStyle(setRows(TIER_SETS[key])).key, key);
		}
		assert.equal(cardStyle("khong-co").key, null);
		assert.equal(cardStyle(null).key, null);
		assert.equal(boardStyle([]).key, null);
		assert.equal(boardStyle([row(1, { tier: null }), row(2, { tier: tierForLevel(20, TIER_SETS["vu-tru"]) })]).key, "vu-tru");
		assert.equal(boardStyle([row(1, { tier: corruptTier(TIERS[0], { setKey: "khong-co" }) })]).key, null);
	});

	test("viên thuốc bậc thu nhỏ rồi cắt tên dài cho vừa khung", () =>
	{
		ensureFonts();
		const ctx = createCanvas(600, 60).getContext("2d");
		const longTier: Tier = { ...TIER_SETS["cay-xanh"].tiers[7], name: LONG_TIER_NAME };
		const natural = measureTierPill(ctx, longTier, 38);
		assert.ok(natural > 300, `${natural}`);
		for (const maxWidth of [300, 200, 120, 60])
		{
			assert.ok(measureTierPill(ctx, longTier, 38, maxWidth) <= maxWidth + 0.5, `maxWidth ${maxWidth}`);
			assert.ok(drawTierPill(ctx, longTier, 0, 30, 38, maxWidth) <= maxWidth + 0.5);
		}
		const short: Tier = TIER_SETS["rank-game"].tiers[0];
		assert.equal(measureTierPill(ctx, short, 38, 400), measureTierPill(ctx, short, 38));
	});
});

describe("renderRankCard", () =>
{
	test("vẽ được mọi bộ × mọi bậc (40 trường hợp), mỗi ảnh dưới 1 giây", async () =>
	{
		let count = 0;
		for (const key of TIER_SET_KEYS)
		{
			const set = TIER_SETS[key];
			for (const tier of set.tiers)
			{
				const card = await timed(() => renderRankCard(tierRankData(set, tier, { displayName: `${set.name} ${tier.name}` })));
				await assertCard(card, "rank.png");
				assert.deepEqual([card.width, card.height], [1000, 460]);
				count++;
			}
		}
		assert.equal(count, 40);
	});

	test("cùng vị trí bậc nhưng khác bộ thì ảnh khác nhau (trang trí theo bộ)", async () =>
	{
		const images = new Set<string>();
		for (const key of TIER_SET_KEYS)
		{
			const set = TIER_SETS[key];
			const card = await renderRankCard(tierRankData(set, { ...set.tiers[4], color: "#60a5fa", gradient: ["#1e3a8a", "#93c5fd"], name: "Cùng Tên" }, { displayName: "Cùng người" }));
			images.add(card.png.toString("base64"));
		}
		assert.equal(images.size, TIER_SET_KEYS.length);
	});

	test("tên bậc tuỳ chỉnh dài (32 ký tự) ở bậc hiện tại và bậc kế tiếp, kể cả khi level rất lớn", async () =>
	{
		for (const key of TIER_SET_KEYS)
		{
			const set = applyTierOverrides(TIER_SETS[key], [
				{ tierKey: "bac-5", name: LONG_TIER_NAME, emoji: null },
				{ tierKey: "bac-6", name: "Võ Lâm Minh Chủ Thiên Hạ Vô Song X", emoji: null },
				{ tierKey: "bac-8", name: LONG_TIER_NAME, emoji: null },
			]);
			await assertCard(await timed(() => renderRankCard(tierRankData(set, set.tiers[4], { displayName: "Trưởng Lão Thái Thượng Vô Cực Kiếm Tông" }))), "rank.png");
			await assertCard(await timed(() => renderRankCard(tierRankData(set, set.tiers[7], {
				level: { level: 987654, totalXp: 987654321, xpIntoLevel: 1598646, xpForNextLevel: 3527975 },
				teamNames: ["Hội Đồng Quản Trị Tối Cao", "Backend"],
			}))), "rank.png");
		}
	});

	test("bộ hoặc bậc lạ (dữ liệu hỏng) vẫn vẽ được bằng biểu tượng và phong cách dự phòng", async () =>
	{
		const strange = corruptTier(TIERS[2], { setKey: "khong-co", key: "bac-99", index: 42 });
		const brokenSet: TierSet = { ...DEFAULT_TIER_SET, texts: { ...DEFAULT_TIER_SET.texts, maxTier: "", idleToday: "" } };
		await assertCard(await timed(() => renderRankCard(rankData({ tier: strange, nextTier: strange, tierSet: brokenSet }))), "rank.png");
		await assertCard(await timed(() => renderRankCard(rankData({ tier: strange, nextTier: null, tierSet: brokenSet, streak: { current: 3, best: 3, activeToday: false } }))), "rank.png");
		const otherSet = corruptTier(TIER_SETS["vu-tru"].tiers[7], { index: 7.5 });
		await assertCard(await timed(() => renderRankCard(rankData({ tier: otherSet, nextTier: null, tierSet: TIER_SETS["kiem-hiep"] }))), "rank.png");
	});

	test("người mới: chưa có hạng, avatar null, streak 0, không team", async () =>
	{
		const card = await timed(() => renderRankCard(rankData({
			avatar: null,
			activity: { rank: null, totalRanked: 0, weeklyXp: 0, weeklyRank: null },
			contribution: { score: 0, rank: null, totalRanked: 0, contributions: 0 },
			streak: { current: 0, best: 0, activeToday: false },
			achievements: { unlocked: 0, total: 15 },
			teamNames: [],
		}, 0)));
		await assertCard(card, "rank.png");
	});

	test("tên dài, tên toàn emoji, tên tiếng Việt, tên có ký tự điều khiển", async () =>
	{
		for (const displayName of ["Trưởng Lão Thái Thượng Vô Cực Kiếm Tông ".repeat(20), "🔥🐉⚡👑", "", "Đặng Thị Ngọc Huyền", "a‮b\u0000c", `Z${"́".repeat(200)}`])
		{
			await assertCard(await timed(() => renderRankCard(rankData({ displayName, avatar: null }))), "rank.png");
		}
	});

	test("avatar null, hỏng, rỗng, SVG, ảnh quá lớn và ảnh PNG/JPEG/WebP thật đều vẽ được", async () =>
	{
		const huge = Buffer.from(fakeAvatar());
		huge.writeUInt32BE(50_000, 16);
		const avatars = [null, Buffer.from("broken"), Buffer.alloc(0), Buffer.from("<svg/>"), huge, fakeAvatar("png"), fakeAvatar("jpeg"), fakeAvatar("webp"), fakeAvatar("png", 1024)];
		for (const avatar of avatars) await assertCard(await timed(() => renderRankCard(rankData({ avatar }))), "rank.png");
	});

	test("số rất lớn, NaN, âm và dữ liệu không nhất quán không làm lỗi", async () =>
	{
		const hugeLevel: LevelInfo = { level: 987654, totalXp: Number.MAX_SAFE_INTEGER, xpIntoLevel: 123456789012, xpForNextLevel: 987654321098 };
		const top = TIERS[TIERS.length - 1];
		await assertCard(await timed(() => renderRankCard(rankData({
			level: hugeLevel,
			tier: top,
			nextTier: null,
			activity: { rank: 123456789, totalRanked: 987654321, weeklyXp: 1e15, weeklyRank: 99999999 },
			contribution: { score: -5e12, rank: 1, totalRanked: 1, contributions: 1e9 },
			streak: { current: 99999, best: 12, activeToday: true },
			achievements: { unlocked: 999, total: 15 },
		}))), "rank.png");

		await assertCard(await timed(() => renderRankCard(rankData({
			level: { level: Number.NaN, totalXp: Number.POSITIVE_INFINITY, xpIntoLevel: -10, xpForNextLevel: 0 },
			activity: { rank: 0, totalRanked: -1, weeklyXp: Number.NaN, weeklyRank: -3 },
			contribution: { score: Number.NaN, rank: Number.NaN, totalRanked: 0, contributions: -1 },
			streak: { current: -1, best: Number.NaN, activeToday: false },
			achievements: { unlocked: -1, total: 0 },
			nextTier: TIERS[0],
		}))), "rank.png");

		const brokenTier: Tier = { ...TIERS[2], color: "gold", gradient: ["#zzzzzz", "not a color"], name: "" };
		await assertCard(await timed(() => renderRankCard(rankData({ tier: brokenTier, nextTier: brokenTier }))), "rank.png");
	});

	test("team: rỗng, một, nhiều, tên dài hoặc chỉ có emoji; chuỗi đang giữ nhưng hôm nay chưa tu luyện", async () =>
	{
		const teamLists = [[], ["Backend"], ["Backend", "Frontend", "QA", "Platform", "Design", "Mobile"], ["Hội Đồng Quản Trị Tối Cao Của Toàn Bộ Công Ty ".repeat(5)], ["🔥"]];
		for (const teamNames of teamLists)
		{
			await assertCard(await timed(() => renderRankCard(rankData({ teamNames, streak: { current: 5, best: 9, activeToday: false } }))), "rank.png");
		}
	});

	test("huy hiệu: tổng 0 hoặc nhiều hơn 20 vẫn vẽ được", async () =>
	{
		for (const achievements of [{ unlocked: 0, total: 0 }, { unlocked: 30, total: 50 }])
		{
			await assertCard(await timed(() => renderRankCard(rankData({ achievements }))), "rank.png");
		}
	});

	test("vẽ hai lần cùng dữ liệu cho ra cùng bytes (hoa văn dùng PRNG có seed), ở mọi bộ", async () =>
	{
		for (const key of TIER_SET_KEYS)
		{
			const set = TIER_SETS[key];
			const data = tierRankData(set, set.tiers[7]);
			const first = await renderRankCard(data);
			const second = await renderRankCard(data);
			assert.ok(first.png.equals(second.png), key);
		}
	});
});

describe("renderLeaderboardCard", () =>
{
	test("0, 3 và 10 dòng: chiều cao tăng theo số dòng, rows rỗng vẽ emptyText", async () =>
	{
		const empty = await timed(() => renderLeaderboardCard(board([])));
		const three = await timed(() => renderLeaderboardCard(board([row(1), row(2), row(3)])));
		const ten = await timed(() => renderLeaderboardCard(board(Array.from({ length: 10 }, (_, index) => row(index + 1)))));
		for (const card of [empty, three, ten])
		{
			await assertCard(card, "leaderboard.png");
			assert.equal(card.width, 1000);
		}
		assert.ok(empty.height < ten.height);
		assert.ok(three.height < ten.height);
	});

	test("hơn 10 dòng chỉ vẽ 10 dòng đầu", async () =>
	{
		const ten = await renderLeaderboardCard(board(Array.from({ length: 10 }, (_, index) => row(index + 1))));
		const twelve = await timed(() => renderLeaderboardCard(board(Array.from({ length: 12 }, (_, index) => row(index + 1)))));
		assert.equal(twelve.height, ten.height);
	});

	test("dòng highlight, team có accentColor, màu sai định dạng, hạng hoà, hạng lớn và hạng lạ", async () =>
	{
		const rows = [
			row(1, { name: "Backend", tier: null, detail: "12 thành viên", accentColor: "#3498db", value: "1.240 điểm" }),
			row(1, { name: "Frontend", tier: null, detail: null, accentColor: "#e91e63", value: "1.240 điểm", highlight: true }),
			row(3, { name: "QA", tier: null, detail: null, accentColor: "blue", value: "860 điểm" }),
			row(12345, { name: "Người ở rất xa", value: "1 XP" }),
			row(0, { name: "Hạng 0" }),
			row(Number.NaN, { name: "Hạng NaN", value: "" }),
			row(7, { name: "🔥🔥🔥", value: "không có số" }),
			row(8, { name: "Tên rất dài ".repeat(30), value: `${Number.MAX_SAFE_INTEGER.toLocaleString("vi-VN")} XP rất nhiều đơn vị` }),
		];
		await assertCard(await timed(() => renderLeaderboardCard(board(rows))), "leaderboard.png");
	});

	test("avatar null, hỏng và thật trong cùng bảng", async () =>
	{
		const rows = [row(1, { avatar: fakeAvatar() }), row(2, { avatar: Buffer.from("broken") }), row(3, { avatar: null }), row(4, { avatar: fakeAvatar("webp", 64) })];
		await assertCard(await timed(() => renderLeaderboardCard(board(rows))), "leaderboard.png");
	});

	test("tiêu đề, dòng phụ, chân ảnh và emptyText rỗng hoặc chứa emoji", async () =>
	{
		const data = board([], { title: "🏆", subtitle: "", footer: "", emptyText: "" });
		await assertCard(await timed(() => renderLeaderboardCard(data)), "leaderboard.png");
	});

	test("vẽ hai lần cùng dữ liệu cho ra cùng bytes", async () =>
	{
		const data = board([row(1, { avatar: fakeAvatar() }), row(2, { highlight: true })]);
		const first = await renderLeaderboardCard(data);
		const second = await renderLeaderboardCard(data);
		assert.ok(first.png.equals(second.png));
	});

	test("bảng 10 dòng cho từng bộ danh hiệu (nhiều bậc khác nhau), ảnh các bộ khác nhau", async () =>
	{
		const images = new Set<string>();
		for (const key of TIER_SET_KEYS)
		{
			const card = await timed(() => renderLeaderboardCard(board(setRows(TIER_SETS[key]))));
			await assertCard(card, "leaderboard.png");
			assert.equal(card.width, 1000);
			images.add(card.png.toString("base64"));
		}
		assert.equal(images.size, TIER_SET_KEYS.length);
	});

	test("tên bậc tuỳ chỉnh dài và bậc có bộ lạ trong bảng xếp hạng", async () =>
	{
		const set = applyTierOverrides(TIER_SETS["kiem-hiep"], [{ tierKey: "bac-8", name: LONG_TIER_NAME, emoji: null }]);
		const rows = [
			row(1, { tier: set.tiers[7], name: "Tên rất dài ".repeat(10) }),
			row(2, { tier: set.tiers[7], detail: null }),
			row(3, { tier: corruptTier(set.tiers[3], { setKey: "khong-co", index: 99 }) }),
			row(4, { tier: set.tiers[0], value: `${Number.MAX_SAFE_INTEGER.toLocaleString("vi-VN")} XP` }),
		];
		await assertCard(await timed(() => renderLeaderboardCard(board(rows))), "leaderboard.png");
	});
});
