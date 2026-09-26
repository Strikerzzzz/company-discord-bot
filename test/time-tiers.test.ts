import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { nextTier, tierForLevel, TIERS, tierUp } from "../src/modules/activity/tiers";
import { formatVnDayMonth, startOfVnDay, startOfVnMonth, startOfVnWeek, vnDayNumber, vnDayStart } from "../src/shared/time";

// 2026-09-29 là thứ Ba. 00:00 giờ Việt Nam = 17:00 UTC ngày hôm trước.
const TUE_0930_VN = Date.UTC(2026, 8, 29, 2, 30);

describe("giờ Việt Nam", () =>
{
	test("ranh giới ngày là 00:00 giờ Việt Nam (17:00 UTC hôm trước)", () =>
	{
		assert.equal(startOfVnDay(TUE_0930_VN), Date.UTC(2026, 8, 28, 17, 0));
		assert.equal(vnDayNumber(Date.UTC(2026, 8, 28, 16, 59, 59, 999)) + 1, vnDayNumber(Date.UTC(2026, 8, 28, 17, 0)));
		assert.equal(vnDayStart(vnDayNumber(TUE_0930_VN)), startOfVnDay(TUE_0930_VN));
	});

	test("khớp công thức SQL (created_at + 25200000) / 86400000", () =>
	{
		for (const ms of [0, TUE_0930_VN, Date.UTC(2026, 11, 31, 16, 59), Date.UTC(2026, 11, 31, 17, 0)])
		{
			assert.equal(vnDayNumber(ms), Math.trunc((ms + 25_200_000) / 86_400_000));
		}
	});

	test("tuần bắt đầu 00:00 thứ Hai giờ Việt Nam", () =>
	{
		const monday = Date.UTC(2026, 8, 27, 17, 0);
		assert.equal(startOfVnWeek(TUE_0930_VN), monday);
		assert.equal(startOfVnWeek(monday), monday);
		assert.equal(startOfVnWeek(monday - 1), Date.UTC(2026, 8, 20, 17, 0));
		assert.equal(startOfVnWeek(Date.UTC(2026, 9, 4, 16, 59)), monday);
	});

	test("tháng bắt đầu 00:00 ngày 1 giờ Việt Nam, kể cả đầu năm", () =>
	{
		assert.equal(startOfVnMonth(TUE_0930_VN), Date.UTC(2026, 7, 31, 17, 0));
		assert.equal(startOfVnMonth(Date.UTC(2026, 11, 31, 17, 30)), Date.UTC(2026, 11, 31, 17, 0));
		assert.equal(startOfVnMonth(Date.UTC(2026, 11, 31, 16, 30)), Date.UTC(2026, 10, 30, 17, 0));
	});

	test("định dạng ngày/tháng theo giờ Việt Nam", () =>
	{
		assert.equal(formatVnDayMonth(Date.UTC(2026, 8, 27, 17, 0)), "28/09");
		assert.equal(formatVnDayMonth(TUE_0930_VN), "29/09");
	});
});

describe("cảnh giới", () =>
{
	test("bảng cảnh giới tăng dần và bắt đầu từ level 0", () =>
	{
		assert.equal(TIERS[0].minLevel, 0);
		for (let i = 1; i < TIERS.length; i++) assert.ok(TIERS[i].minLevel > TIERS[i - 1].minLevel);
		assert.deepEqual(TIERS.map(tier => tier.minLevel), [0, 3, 6, 10, 15, 20, 30, 40]);
	});

	test("tierForLevel và nextTier theo mốc", () =>
	{
		assert.equal(tierForLevel(0).name, "Luyện Khí");
		assert.equal(tierForLevel(2).name, "Luyện Khí");
		assert.equal(tierForLevel(3).name, "Trúc Cơ");
		assert.equal(tierForLevel(39).name, "Hợp Thể");
		assert.equal(tierForLevel(99).name, "Độ Kiếp");
		assert.equal(tierForLevel(-5).name, "Luyện Khí");
		assert.equal(nextTier(9)?.name, "Nguyên Anh");
		assert.equal(nextTier(40), null);
	});

	test("tierUp chỉ trả về cảnh giới khi vượt mốc", () =>
	{
		assert.equal(tierUp(4, 5), null);
		assert.equal(tierUp(5, 6)?.name, "Kim Đan");
		assert.equal(tierUp(2, 11)?.name, "Nguyên Anh");
		assert.equal(tierUp(11, 2), null);
	});
});
