import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "path";
import Command from "../src/classes/Command";
import ContextMenu from "../src/classes/ContextMenu";
import Event from "../src/classes/Event";
import type DiscordClient from "../src/classes/DiscordClient";
import { loadModules } from "../src/handlers/loadModules";

// Command chỉ lưu client trong constructor, nên client giả là đủ để kiểm tra định nghĩa.
const fakeClient = {} as DiscordClient;
const SRC = join(__dirname, "..", "src");

describe("định nghĩa command gửi lên Discord", () =>
{
	const commands = loadModules(join(SRC, "interactions", "commands"), Command, fakeClient);
	const contextMenus = loadModules(join(SRC, "interactions", "contextMenus"), ContextMenu, fakeClient);

	test("mọi command build được JSON hợp lệ (builder tự validate độ dài, ký tự)", () =>
	{
		assert.ok(commands.length > 0);
		for (const command of commands) assert.doesNotThrow(() => command.data.toJSON(), `command ${command.data.name}`);
		for (const menu of contextMenus) assert.doesNotThrow(() => menu.data.toJSON(), `context menu ${menu.data.name}`);
	});

	test("tên command không trùng nhau", () =>
	{
		const names = commands.map(command => command.data.name);
		assert.equal(new Set(names).size, names.length);
		const menuNames = contextMenus.map(menu => menu.data.name);
		assert.equal(new Set(menuNames).size, menuNames.length);
	});

	test("command admin đặt đủ hai lớp quyền (PROP-013)", () =>
	{
		for (const command of commands.filter(c => c.adminOnly))
		{
			const json = command.data.toJSON();
			assert.ok(json.default_member_permissions, `/${json.name} thiếu setDefaultMemberPermissions`);
		}
	});

	test("namespace button không trùng giữa các command", () =>
	{
		const namespaces = commands.flatMap(command => command.buttonIds);
		assert.equal(new Set(namespaces).size, namespaces.length);
	});

	test("mọi event nạp được", () =>
	{
		const events = loadModules(join(SRC, "events"), Event, fakeClient);
		const names = events.map(event => event.name);
		assert.ok(names.includes("interactionCreate"));
		assert.ok(names.includes("clientReady"));
	});
});
