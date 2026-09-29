import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { logger, redact, registerSecret } from "../src/shared/logger";

describe("redact", () =>
{
	test("che bot token dạng Discord", () =>
	{
		const token = `${"M".repeat(26)}.${"a".repeat(6)}.${"b".repeat(38)}`;
		const output = redact(`login với ${token} thất bại`);
		assert.ok(!output.includes(token));
		assert.ok(output.includes("[REDACTED_TOKEN]"));
	});

	test("che secret đã đăng ký theo giá trị (Client Secret của web, DEC-039); chuỗi quá ngắn không đăng ký", () =>
	{
		const secret = "Zk3-test-client-secret-VALUE_42";
		registerSecret(secret);
		registerSecret("abc");
		const output = redact(`đổi code thất bại với secret=${secret} và lại ${secret}; abc giữ nguyên`);
		assert.ok(!output.includes(secret));
		assert.equal(output.split("[REDACTED_SECRET]").length, 3);
		assert.ok(output.includes("abc giữ nguyên"));
	});

	test("che token trong URL interaction/webhook", () =>
	{
		const output = redact("POST https://discord.com/api/v10/interactions/123456789/aW50ZXJhY3Rpb24tdG9rZW4.xyz/callback");
		assert.ok(output.includes("/interactions/123456789/[REDACTED]/callback"));
		assert.ok(!output.includes("aW50ZXJhY3Rpb24tdG9rZW4"));
	});

	test("không đụng tới văn bản bình thường", () =>
	{
		assert.equal(redact("Đã cộng 10 XP cho 300000000000000001"), "Đã cộng 10 XP cho 300000000000000001");
	});

	test("lỗi REST không in requestBody (nội dung embed) nhưng vẫn giữ mã lỗi", (t) =>
	{
		const lines: string[] = [];
		t.mock.method(console, "error", (line: string) => lines.push(line));
		const error = Object.assign(new Error("Unknown Message"), { code: 10008, status: 404, requestBody: { json: { embeds: [{ title: "Nội dung bí mật" }] } } });
		logger.warn("Không sửa được message:", error);
		assert.equal(lines.length, 1);
		assert.ok(lines[0].includes("Unknown Message"));
		assert.ok(lines[0].includes("10008"));
		assert.ok(!lines[0].includes("Nội dung bí mật"));
	});
});
