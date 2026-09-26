import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { disableMaskedLinks, fitLines, truncate } from "../src/discord/format";

// Surrogate lẻ (nửa emoji): Discord từ chối hoặc hiển thị ký tự lỗi.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function assertFits(result: string, max: number): void
{
	assert.ok(result.length <= max, `độ dài ${result.length} > ${max}`);
	assert.ok(!LONE_SURROGATE.test(result), "có surrogate lẻ");
}

describe("truncate", () =>
{
	test("chuỗi vừa giới hạn giữ nguyên; dài hơn thì cắt đúng max và thêm …", () =>
	{
		assert.equal(truncate("abc", 3), "abc");
		assert.equal(truncate("abcdef", 4), "abc…");
		assert.equal(truncate("abcdef", 1), "…");
		assert.equal(truncate("abcdef", 0), "");
	});

	test("đếm theo UTF-16 như Discord: nhãn toàn emoji vẫn vừa giới hạn, không cắt đôi emoji", () =>
	{
		const emoji = "😀".repeat(100);
		for (const max of [1, 2, 3, 4, 5, 6, 79, 80, 100, 101])
		{
			const result = truncate(emoji, max);
			assertFits(result, max);
			assert.ok(result.endsWith("…"));
		}
		assert.equal(truncate("😀😀😀", 4), "😀…");
		assert.equal(truncate("😀😀😀", 3), "😀…");
		assert.equal(truncate("😀😀😀", 2), "…");
	});

	test("không tách emoji ghép (ZWJ) hay dấu tổ hợp khỏi ký tự gốc", () =>
	{
		const family = "👨‍👩‍👧‍👦";
		assert.equal(truncate(family.repeat(3), 15), `${family}…`);
		assert.equal(truncate(family.repeat(3), 11), "…");

		const decomposed = "é".repeat(10);
		assert.equal(truncate(decomposed, 6), "éé…");
		assert.equal(truncate("Tiếng Việt có dấu", 9), "Tiếng Vi…");
	});
});

describe("fitLines", () =>
{
	test("vừa thì nối nguyên; không vừa thì bỏ dòng cuối và báo số dòng bị ẩn", () =>
	{
		const lines = Array.from({ length: 10 }, (_, index) => `dòng ${index}...`);
		assert.equal(fitLines(lines, 1000, () => "x"), lines.join("\n"));

		const fitted = fitLines(lines, 50, hidden => `+${hidden}`);
		assert.ok(fitted.length <= 50);
		const kept = fitted.split("\n").length - 1;
		assert.ok(fitted.endsWith(`+${10 - kept}`));
	});

	test("total: mục đã bị cắt trước vẫn được tính vào dòng cuối", () =>
	{
		assert.equal(fitLines(["a", "b"], 100, hidden => `… và ${hidden} mục khác`, { total: 5 }), "a\nb\n… và 3 mục khác");
		assert.equal(fitLines(["aaaa", "bbbb"], 12, hidden => `+${hidden}`, { total: 5 }), "aaaa\nbbbb\n+3");
		assert.equal(fitLines(["aaaa", "bbbb"], 11, hidden => `+${hidden}`, { total: 5 }), "aaaa\n+4");
	});

	test("separator tuỳ chọn; không dòng nào vừa thì chỉ còn dòng báo, cắt cho vừa", () =>
	{
		assert.equal(fitLines(["a", "b"], 100, () => "", { separator: "\n\n" }), "a\n\nb");
		const result = fitLines(["x".repeat(50)], 10, hidden => `ẩn ${hidden} dòng rất rất dài`);
		assert.ok(result.length <= 10);
		assert.ok(result.startsWith("ẩn 1"));
	});
});

describe("disableMaskedLinks", () =>
{
	test("masked link thành chữ (url), lộ rõ địa chỉ thật", () =>
	{
		assert.equal(disableMaskedLinks("Xem [trang nội bộ](https://evil.example/login) nhé"), "Xem trang nội bộ (https://evil.example/login) nhé");
		assert.equal(disableMaskedLinks("[a](<https://x.example>) và [b](https://y.example \"tiêu đề\")"), "a (<https://x.example>) và b (https://y.example \"tiêu đề\")");
	});

	test("link lồng nhau hoặc url có ngoặc không còn dựng được thành link", () =>
	{
		for (const text of [
			"[a [b](https://c.example)](https://d.example)",
			"[wiki](https://vi.wikipedia.org/wiki/A_(B))",
			"[x](https://a.example)(https://b.example)",
		])
		{
			const result = disableMaskedLinks(text);
			assert.ok(!result.includes("]("), `${text} → ${result}`);
		}
	});

	test("văn bản thường, ngoặc vuông hay ngoặc tròn đứng riêng giữ nguyên", () =>
	{
		for (const text of ["Không có link", "[WIP] sửa lỗi (gấp)", "https://example.com/a", "mảng[0] (x)"])
		{
			assert.equal(disableMaskedLinks(text), text);
		}
	});
});
