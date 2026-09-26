import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { levelInfo, totalXpForLevel, xpToNextLevel } from "../src/modules/activity/levels";

describe("levels (DEC-022: 5n² + 50n + 100)", () =>
{
	test("XP cần để lên level kế tiếp", () =>
	{
		assert.equal(xpToNextLevel(0), 100);
		assert.equal(xpToNextLevel(1), 155);
		assert.equal(xpToNextLevel(9), 955);
	});

	test("tổng XP để đạt level", () =>
	{
		assert.equal(totalXpForLevel(0), 0);
		assert.equal(totalXpForLevel(1), 100);
		assert.equal(totalXpForLevel(2), 255);
		assert.equal(totalXpForLevel(5), 1150);
		assert.equal(totalXpForLevel(10), 4675);
	});

	test("levelInfo tại ranh giới level", () =>
	{
		assert.deepEqual(levelInfo(0), { level: 0, totalXp: 0, xpIntoLevel: 0, xpForNextLevel: 100 });
		assert.deepEqual(levelInfo(99), { level: 0, totalXp: 99, xpIntoLevel: 99, xpForNextLevel: 100 });
		assert.deepEqual(levelInfo(100), { level: 1, totalXp: 100, xpIntoLevel: 0, xpForNextLevel: 155 });
		assert.deepEqual(levelInfo(4675), { level: 10, totalXp: 4675, xpIntoLevel: 0, xpForNextLevel: xpToNextLevel(10) });
	});

	test("XP âm hoặc lẻ được chuẩn hoá", () =>
	{
		assert.equal(levelInfo(-50).level, 0);
		assert.equal(levelInfo(-50).totalXp, 0);
		assert.equal(levelInfo(150.9).totalXp, 150);
	});
});
