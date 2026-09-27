import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
	applyTierOverrides,
	DEFAULT_TIER_SET_KEY,
	TIER_KEYS,
	TIER_LEVELS,
	TIER_SET_KEYS,
	TIER_SETS,
	tierForLevel,
	tierUp,
} from "../src/modules/activity/tiers";
import { GamificationService } from "../src/modules/gamification/GamificationService";
import { TierSetService, normalizeTierEmoji, normalizeTierName, parseTierDisplayName, TIER_NAME_MAX } from "../src/modules/gamification/TierSetService";
import { UserError } from "../src/shared/errors";
import { ADMIN, createTestContext, GUILD, OTHER_GUILD } from "./helpers";

const HEX = /^#[0-9a-f]{6}$/;

function userError(message: string | RegExp): (error: unknown) => boolean
{
	return (error: unknown): boolean => error instanceof UserError && (typeof message === "string" ? error.message === message : message.test(error.message));
}

function setup(): { context: ReturnType<typeof createTestContext>; service: TierSetService }
{
	const context = createTestContext();
	return { context, service: context.deps.tierSets };
}

describe("dữ liệu bộ danh hiệu", () =>
{
	test("5 bộ, mỗi bộ đúng 8 bậc theo khoá vị trí, mốc level chung, màu hợp lệ, template đủ placeholder", () =>
	{
		assert.deepEqual([...TIER_SET_KEYS], ["tu-tien", "rank-game", "kiem-hiep", "cay-xanh", "vu-tru"]);
		for (const key of TIER_SET_KEYS)
		{
			const set = TIER_SETS[key];
			assert.equal(set.key, key);
			assert.ok(set.description.length <= 100, `${key}: mô tả quá dài`);
			assert.deepEqual(set.tiers.map(tier => tier.key), [...TIER_KEYS]);
			assert.deepEqual(set.tiers.map(tier => tier.minLevel), [...TIER_LEVELS]);
			assert.deepEqual(set.tiers.map(tier => tier.index), [0, 1, 2, 3, 4, 5, 6, 7]);
			assert.equal(new Set(set.tiers.map(tier => tier.name)).size, 8, `${key}: tên bậc trùng`);
			for (const tier of set.tiers)
			{
				assert.equal(tier.setKey, key);
				assert.match(tier.color, HEX);
				assert.match(tier.gradient[0], HEX);
				assert.match(tier.gradient[1], HEX);
				assert.ok(tier.name.length > 0 && tier.emoji.length > 0 && tier.breakthrough.length > 0);
			}
			assert.ok(set.texts.levelUp.length > 0);
			for (const template of set.texts.levelUp) assert.ok(template.includes("{user}") && template.includes("{level}"), `${key}: levelUp thiếu placeholder`);
			for (const placeholder of ["{user}", "{phrase}", "{emoji}", "{tier}", "{level}"]) assert.ok(set.texts.promotion.includes(placeholder), `${key}: promotion thiếu ${placeholder}`);
		}
	});

	test("bậc theo level giống nhau ở mọi bộ; tierUp theo bộ", () =>
	{
		for (const key of TIER_SET_KEYS)
		{
			const set = TIER_SETS[key];
			assert.equal(tierForLevel(9, set).key, "bac-3");
			assert.equal(tierForLevel(10, set).key, "bac-4");
			assert.equal(tierUp(14, 15, set)?.name, set.tiers[4].name);
		}
		assert.equal(tierForLevel(40, TIER_SETS["rank-game"]).name, "Thách Đấu");
	});

	test("applyTierOverrides chỉ thay tên/emoji có giá trị, giữ màu và mốc", () =>
	{
		const set = applyTierOverrides(TIER_SETS["rank-game"], [
			{ tierKey: "bac-8", name: "Huyền Thoại ezCloud", emoji: "🦄" },
			{ tierKey: "bac-1", name: null, emoji: "🥉" },
		]);
		assert.deepEqual([set.tiers[7].name, set.tiers[7].emoji, set.tiers[7].color], ["Huyền Thoại ezCloud", "🦄", TIER_SETS["rank-game"].tiers[7].color]);
		assert.deepEqual([set.tiers[0].name, set.tiers[0].emoji], ["Đồng", "🥉"]);
		assert.equal(TIER_SETS["rank-game"].tiers[7].name, "Thách Đấu", "không sửa bộ gốc");
	});
});

describe("tên bậc tuỳ chỉnh", () =>
{
	test("parseTierDisplayName tách emoji đầu chuỗi", () =>
	{
		assert.deepEqual(parseTierDisplayName(" 🟡 Kim Đan "), { emoji: "🟡", name: "Kim Đan" });
		assert.deepEqual(parseTierDisplayName("Kim Đan"), { emoji: null, name: "Kim Đan" });
		assert.deepEqual(parseTierDisplayName("🦄"), { emoji: "🦄", name: null });
		assert.deepEqual(parseTierDisplayName("👩‍💻 Kỹ Sư"), { emoji: "👩‍💻", name: "Kỹ Sư" });
		assert.deepEqual(parseTierDisplayName("   "), { emoji: null, name: null });
	});

	test("normalizeTierName: gộp khoảng trắng, giới hạn độ dài, chặn ký tự định dạng và emoji", () =>
	{
		assert.equal(normalizeTierName("  Huyền   Thoại  "), "Huyền Thoại");
		assert.throws(() => normalizeTierName("x".repeat(TIER_NAME_MAX + 1)), UserError);
		for (const bad of ["@everyone", "**Đậm**", "<@&123>", "a|b", "Tên​ẩn", "Sao ⭐"]) assert.throws(() => normalizeTierName(bad), UserError, bad);
	});

	test("normalizeTierEmoji: đúng một emoji Unicode", () =>
	{
		assert.equal(normalizeTierEmoji("🦄"), "🦄");
		assert.equal(normalizeTierEmoji("🇻🇳"), "🇻🇳");
		for (const bad of ["ab", "🦄🦄", "<:cat:123456789012345678>", "a"]) assert.throws(() => normalizeTierEmoji(bad), UserError, bad);
	});
});

describe("TierSetService", () =>
{
	test("guild chưa chọn dùng bộ mặc định; chọn bộ ghi audit, chọn lại bộ đang dùng không audit", () =>
	{
		const { context, service } = setup();
		assert.equal(service.currentKey(GUILD), DEFAULT_TIER_SET_KEY);
		assert.equal(service.current(GUILD).tiers[0].name, "Luyện Khí");

		assert.equal(service.select(GUILD, "rank-game", ADMIN).tiers[7].name, "Thách Đấu");
		service.select(GUILD, "rank-game", ADMIN);
		assert.equal(service.currentKey(GUILD), "rank-game");
		assert.equal(service.currentKey(OTHER_GUILD), DEFAULT_TIER_SET_KEY);
		const audits = context.deps.audit.list(GUILD, 10);
		assert.deepEqual(audits.map(entry => [entry.action, entry.targetId, entry.details]), [["tier_set.set", null, { from: "tu-tien", to: "rank-game" }]]);
	});

	test("khoá bộ sai bị từ chối; khoá lạ trong database quay về mặc định", () =>
	{
		const { context, service } = setup();
		const loose = service as unknown as { select(guildId: string, setKey: string, actorId: string): unknown };
		assert.throws(() => loose.select(GUILD, "pokemon", ADMIN), userError("Bộ danh hiệu không hợp lệ."));
		context.db.prepare("INSERT INTO tier_set_config (guild_id, set_key, updated_at) VALUES (?, 'bo-cu', 0)").run(GUILD);
		assert.equal(service.currentKey(GUILD), DEFAULT_TIER_SET_KEY);
	});

	test("đổi tên nhiều bậc trong một lần: validate hết trước khi ghi, mỗi bậc đổi một audit, không đổi thì không audit", () =>
	{
		const { context, service } = setup();
		service.select(GUILD, "rank-game", ADMIN);
		const set = service.rename(GUILD, [
			{ tierKey: "bac-8", name: "Huyền Thoại ezCloud", emoji: "🦄" },
			{ tierKey: "bac-1", name: null, emoji: "🥉" },
		], ADMIN);
		assert.deepEqual([set.tiers[7].name, set.tiers[7].emoji, set.tiers[0].name, set.tiers[0].emoji], ["Huyền Thoại ezCloud", "🦄", "Đồng", "🥉"]);

		assert.throws(() => service.rename(GUILD, [
			{ tierKey: "bac-2", name: "Bạc Mới", emoji: null },
			{ tierKey: "bac-3", name: "@everyone", emoji: null },
		], ADMIN), UserError);
		assert.equal(service.current(GUILD).tiers[1].name, "Bạc", "lỗi thì không ghi bậc nào");

		service.rename(GUILD, [{ tierKey: "bac-8", name: "Huyền Thoại ezCloud", emoji: "🦄" }], ADMIN);
		const renames = context.deps.audit.list(GUILD, 20).filter(entry => entry.action === "tier_name.set");
		assert.equal(renames.length, 2);
		assert.deepEqual(renames.map(entry => entry.details?.tierKey).sort(), ["bac-1", "bac-8"]);
	});

	test("tên tuỳ chỉnh lưu theo từng bộ: đổi bộ rồi quay lại vẫn còn; xoá tuỳ chỉnh một bậc bằng null", () =>
	{
		const { service } = setup();
		service.select(GUILD, "rank-game", ADMIN);
		service.rename(GUILD, [{ tierKey: "bac-8", name: "Huyền Thoại", emoji: null }], ADMIN);
		service.select(GUILD, "kiem-hiep", ADMIN);
		assert.equal(service.current(GUILD).tiers[7].name, "Võ Lâm Minh Chủ");
		service.select(GUILD, "rank-game", ADMIN);
		assert.equal(service.current(GUILD).tiers[7].name, "Huyền Thoại");

		service.rename(GUILD, [{ tierKey: "bac-8", name: null, emoji: null }], ADMIN);
		assert.equal(service.current(GUILD).tiers[7].name, "Thách Đấu");
		assert.deepEqual(service.overrides(GUILD, "rank-game"), []);
	});

	test("resetNames chỉ xoá tuỳ chỉnh của bộ đang dùng, audit kèm số bậc; không có gì thì không audit", () =>
	{
		const { context, service } = setup();
		service.rename(GUILD, [{ tierKey: "bac-1", name: "Phàm Nhân", emoji: null }, { tierKey: "bac-2", name: "Luyện Thể", emoji: null }], ADMIN);
		service.select(GUILD, "vu-tru", ADMIN);
		service.rename(GUILD, [{ tierKey: "bac-1", name: "Bụi Sao", emoji: null }], ADMIN);

		service.resetNames(GUILD, ADMIN);
		assert.equal(service.current(GUILD).tiers[0].name, "Thiên Thạch");
		assert.equal(service.overrides(GUILD, "tu-tien").length, 2, "bộ khác không bị xoá");
		service.resetNames(GUILD, ADMIN);
		const resets = context.deps.audit.list(GUILD, 20).filter(entry => entry.action === "tier_name.reset");
		assert.deepEqual(resets.map(entry => entry.details), [{ setKey: "vu-tru", count: 1 }]);
	});

	test("hồ sơ gamification dùng bộ của guild", () =>
	{
		const { context, service } = setup();
		const gamification = new GamificationService(context.db, context.deps);
		service.select(GUILD, "cay-xanh", ADMIN);
		const profile = gamification.profile(GUILD, "300000000000000001");
		assert.equal(profile.tierSet.key, "cay-xanh");
		assert.equal(profile.tier.name, "Hạt Giống");
		assert.equal(profile.nextTier?.name, "Nảy Mầm");
	});
});
