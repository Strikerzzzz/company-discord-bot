import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isAbsolute } from "path";
import { loadConfig } from "../src/config";

const BASE = { DISCORD_TOKEN: "token-giả", DISCORD_GUILD_IDS: "100000000000000001, 100000000000000002" };

describe("loadConfig", () =>
{
	test("đọc token, danh sách guild và giá trị mặc định", () =>
	{
		const config = loadConfig({ ...BASE });
		assert.equal(config.token, "token-giả");
		assert.deepEqual(config.guildIds, ["100000000000000001", "100000000000000002"]);
		assert.ok(isAbsolute(config.databasePath) && config.databasePath.endsWith("bot.db"));
		assert.ok(isAbsolute(config.backupDir));
		assert.equal(config.backupKeep, 14);
	});

	test("ghi đè đường dẫn DB, thư mục backup và số bản giữ lại", () =>
	{
		const config = loadConfig({ ...BASE, DATABASE_PATH: "custom/x.db", BACKUP_DIR: "custom/bk", BACKUP_KEEP: "30" });
		assert.ok(config.databasePath.endsWith("x.db"));
		assert.ok(isAbsolute(config.databasePath));
		assert.equal(config.backupKeep, 30);
	});

	test("báo lỗi rõ ràng và không lộ token", () =>
	{
		assert.throws(() => loadConfig({ DISCORD_GUILD_IDS: BASE.DISCORD_GUILD_IDS }), /DISCORD_TOKEN/);
		assert.throws(() => loadConfig({ ...BASE, DISCORD_GUILD_IDS: "abc" }), /DISCORD_GUILD_IDS không hợp lệ: abc/);
		assert.throws(() => loadConfig({ ...BASE, BACKUP_KEEP: "0" }), /BACKUP_KEEP/);
		try
		{
			loadConfig({ ...BASE, DISCORD_GUILD_IDS: "" });
			assert.fail("phải ném lỗi");
		}
		catch (error)
		{
			assert.ok(!String(error).includes("token-giả"));
		}
	});
});
