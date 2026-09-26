import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { redact } from "../src/shared/logger";

describe("redact", () =>
{
	test("che bot token dạng Discord", () =>
	{
		const token = `${"M".repeat(26)}.${"a".repeat(6)}.${"b".repeat(38)}`;
		const output = redact(`login với ${token} thất bại`);
		assert.ok(!output.includes(token));
		assert.ok(output.includes("[REDACTED_TOKEN]"));
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
});
