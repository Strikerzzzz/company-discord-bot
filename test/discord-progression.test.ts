import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { levelUpText, promotionText } from "../src/discord/views/progression";
import { applyTierOverrides, DEFAULT_TIER_SET, TIER_SETS, tierByKey, TierSet } from "../src/modules/activity/tiers";
import { USER_A, USER_B } from "./helpers";

const ALL_SETS: readonly TierSet[] = Object.values(TIER_SETS);

/** Mọi mention (<@id>, <@&id>, <#id>, @everyone, @here) có trong nội dung. */
function mentionsIn(text: string): string[]
{
	return text.match(/<@[!&]?\d+>|<#\d+>|@everyone|@here/g) ?? [];
}

/** Placeholder chưa được thay còn sót lại. */
function leftoverPlaceholders(text: string): string[]
{
	return text.match(/\{(user|level|tier|emoji|phrase)\}/g) ?? [];
}

describe("thông báo lên level", () =>
{
	test("có mention đúng người và level đã định dạng, ở mọi bộ", () =>
	{
		for (const set of ALL_SETS)
		{
			const text = levelUpText(set, USER_A, 7);
			assert.deepEqual(mentionsIn(text), [`<@${USER_A}>`], set.key);
			assert.ok(text.includes("**Level 7**"), `${set.key}: ${text}`);
			assert.deepEqual(leftoverPlaceholders(text), [], set.key);
			assert.ok(levelUpText(set, USER_B, 1234).includes("**Level 1.234**"), set.key);
		}
	});

	test("câu chữ theo bộ: mỗi bộ dùng đúng các câu của mình, các bộ khác nhau thì khác câu", () =>
	{
		assert.equal(levelUpText(DEFAULT_TIER_SET, USER_A, 4), `✨ Tu vi tăng tiến! <@${USER_A}> đã đạt **Level 4**.`);
		assert.equal(levelUpText(TIER_SETS["rank-game"], USER_A, 4), `📈 <@${USER_A}> vừa lên **Level 4**!`);
		for (const set of ALL_SETS)
		{
			const expected = set.texts.levelUp.map(template => template.replace("{user}", `<@${USER_A}>`).replace("{level}", "12"));
			assert.ok(expected.includes(levelUpText(set, USER_A, 12)), set.key);
		}
		const texts = new Set(ALL_SETS.map(set => levelUpText(set, USER_A, 5)));
		assert.equal(texts.size, ALL_SETS.length);
	});

	test("biến thể chọn xác định theo level: cùng level luôn cùng câu, các level liên tiếp dùng các câu khác nhau", () =>
	{
		for (const set of ALL_SETS)
		{
			const count = set.texts.levelUp.length;
			assert.ok(count >= 3, set.key);
			assert.equal(levelUpText(set, USER_A, 5), levelUpText(set, USER_A, 5));

			const templateOf = (level: number): string => levelUpText(set, USER_A, level).replace(/\*\*Level [\d.]+\*\*/, "**Level N**");
			const firstRound = Array.from({ length: count }, (_, level) => templateOf(level));
			assert.equal(new Set(firstRound).size, count, `${set.key}: mỗi biến thể xuất hiện đúng một lần trong một vòng`);
			for (let level = 0; level < count; level++)
			{
				assert.equal(templateOf(level + count), firstRound[level], `${set.key} level ${level + count}`);
			}
		}
	});

	test("level không hợp lệ (âm, thập phân, NaN) không làm lỗi", () =>
	{
		assert.doesNotThrow(() => levelUpText(DEFAULT_TIER_SET, USER_A, -1));
		assert.ok(levelUpText(DEFAULT_TIER_SET, USER_A, 2.5).includes(`<@${USER_A}>`));
		assert.ok(levelUpText(DEFAULT_TIER_SET, USER_A, Number.NaN).includes(`<@${USER_A}>`));
	});

	test("bộ không có câu lên level nào thì dùng câu trung tính", () =>
	{
		const empty: TierSet = { ...DEFAULT_TIER_SET, texts: { ...DEFAULT_TIER_SET.texts, levelUp: [] } };
		assert.equal(levelUpText(empty, USER_A, 3), `🎉 <@${USER_A}> đã đạt **Level 3**.`);
	});
});

describe("thông báo lên bậc", () =>
{
	test("đúng định dạng cho Trúc Cơ (Tu tiên) và Bạc (Rank game)", () =>
	{
		assert.equal(
			promotionText(DEFAULT_TIER_SET, USER_A, tierByKey("bac-2"), 3),
			`⚡ Thiên kiếp giáng xuống… <@${USER_A}> đã đặt nền Trúc Cơ vững chắc! 🧱 Cảnh giới **Trúc Cơ** · Level 3`,
		);
		const rankGame = TIER_SETS["rank-game"];
		assert.equal(
			promotionText(rankGame, USER_A, tierByKey("bac-2", rankGame), 3),
			`🏆 Thăng hạng! <@${USER_A}> đã leo lên hạng Bạc! ⚪ Hạng **Bạc** · Level 3`,
		);
	});

	test("mọi bộ, mọi bậc: có vế lên bậc, emoji, tên, level, không sót placeholder và chỉ mention đúng người", () =>
	{
		for (const set of ALL_SETS)
		{
			for (const tier of set.tiers)
			{
				const label = `${set.key}/${tier.key}`;
				const text = promotionText(set, USER_B, tier, tier.minLevel);
				assert.ok(text.includes(`đã ${tier.breakthrough}!`), label);
				assert.ok(text.includes(`${tier.emoji} ${set.texts.tierLabel} **${tier.name}**`), label);
				assert.ok(text.endsWith(`Level ${tier.minLevel}`), label);
				assert.deepEqual(leftoverPlaceholders(text), [], label);
				assert.deepEqual(mentionsIn(text), [`<@${USER_B}>`], label);
			}
		}
	});

	test("tên và emoji tuỳ chỉnh của admin được dùng; vế lên bậc giữ nguyên", () =>
	{
		const set = applyTierOverrides(TIER_SETS["rank-game"], [{ tierKey: "bac-3", name: "Vàng Son", emoji: "🥇" }]);
		const text = promotionText(set, USER_A, tierByKey("bac-3", set), 6);
		assert.equal(text, `🏆 Thăng hạng! <@${USER_A}> đã chạm tới hạng Vàng! 🥇 Hạng **Vàng Son** · Level 6`);
	});

	test("thay placeholder an toàn: giá trị không bị quét lại, ký tự $ giữ nguyên, placeholder lạ giữ nguyên chữ", () =>
	{
		const set = applyTierOverrides(DEFAULT_TIER_SET, [{ tierKey: "bac-2", name: "{user} $& {level}", emoji: null }]);
		const text = promotionText(set, USER_A, tierByKey("bac-2", set), 3);
		assert.ok(text.includes("**{user} $& {level}**"), text);
		assert.deepEqual(mentionsIn(text), [`<@${USER_A}>`]);

		const custom: TierSet = { ...DEFAULT_TIER_SET, texts: { ...DEFAULT_TIER_SET.texts, promotion: "{user} {unknown} {tier}" } };
		assert.equal(promotionText(custom, USER_A, tierByKey("bac-1", custom), 0), `<@${USER_A}> {unknown} Luyện Khí`);
	});

	test("khác với thông báo lên level thường, ở mọi bộ", () =>
	{
		for (const set of ALL_SETS)
		{
			const tier = tierByKey("bac-3", set);
			for (let level = 0; level < set.texts.levelUp.length; level++)
			{
				assert.notEqual(promotionText(set, USER_A, tier, level), levelUpText(set, USER_A, level), set.key);
			}
		}
	});
});
