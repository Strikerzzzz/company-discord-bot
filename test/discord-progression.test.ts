import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { breakthroughText, LEVEL_UP_VARIANTS, levelUpText } from "../src/discord/views/progression";
import { tierByKey, TIERS } from "../src/modules/activity/tiers";
import { USER_A, USER_B } from "./helpers";

/** Mọi mention (<@id>, <@&id>, <#id>, @everyone, @here) có trong nội dung. */
function mentionsIn(text: string): string[]
{
	return text.match(/<@[!&]?\d+>|<#\d+>|@everyone|@here/g) ?? [];
}

describe("thông báo lên level", () =>
{
	test("có mention đúng người và level đã định dạng", () =>
	{
		const text = levelUpText(USER_A, 7);
		assert.deepEqual(mentionsIn(text), [`<@${USER_A}>`]);
		assert.ok(text.includes("**Level 7**"), text);
		assert.ok(levelUpText(USER_B, 1234).includes("**Level 1.234**"));
	});

	test("biến thể chọn xác định theo level: cùng level luôn cùng câu, các level liên tiếp dùng các câu khác nhau", () =>
	{
		assert.ok(LEVEL_UP_VARIANTS >= 3);
		assert.equal(levelUpText(USER_A, 5), levelUpText(USER_A, 5));

		const templateOf = (level: number): string => levelUpText(USER_A, level).replace(/\*\*Level [\d.]+\*\*/, "**Level N**");
		const firstRound = Array.from({ length: LEVEL_UP_VARIANTS }, (_, level) => templateOf(level));
		assert.equal(new Set(firstRound).size, LEVEL_UP_VARIANTS, "mỗi biến thể xuất hiện đúng một lần trong một vòng");
		for (let level = 0; level < LEVEL_UP_VARIANTS; level++)
		{
			assert.equal(templateOf(level + LEVEL_UP_VARIANTS), firstRound[level], `level ${level + LEVEL_UP_VARIANTS}`);
		}
	});

	test("level không hợp lệ (âm, thập phân) không làm lỗi", () =>
	{
		assert.doesNotThrow(() => levelUpText(USER_A, -1));
		assert.ok(levelUpText(USER_A, 2.5).includes(`<@${USER_A}>`));
	});
});

describe("thông báo đột phá cảnh giới", () =>
{
	test("đúng định dạng cho Trúc Cơ", () =>
	{
		assert.equal(
			breakthroughText(USER_A, tierByKey("bac-2"), 3),
			`⚡ Thiên kiếp giáng xuống… <@${USER_A}> đã đặt nền Trúc Cơ vững chắc! 🧱 Cảnh giới **Trúc Cơ** · Level 3`,
		);
	});

	test("mọi cảnh giới: có vế đột phá, emoji, tên, level và chỉ mention đúng người", () =>
	{
		for (const tier of TIERS)
		{
			const text = breakthroughText(USER_B, tier, tier.minLevel);
			assert.ok(text.startsWith("⚡ Thiên kiếp giáng xuống…"), tier.key);
			assert.ok(text.includes(`đã ${tier.breakthrough}!`), tier.key);
			assert.ok(text.includes(`${tier.emoji} Cảnh giới **${tier.name}**`), tier.key);
			assert.ok(text.endsWith(`Level ${tier.minLevel}`), tier.key);
			assert.deepEqual(mentionsIn(text), [`<@${USER_B}>`], tier.key);
		}
	});

	test("khác với thông báo lên level thường", () =>
	{
		const tier = tierByKey("bac-3");
		for (let level = 0; level < LEVEL_UP_VARIANTS; level++)
		{
			assert.notEqual(breakthroughText(USER_A, tier, level), levelUpText(USER_A, level));
		}
	});
});
