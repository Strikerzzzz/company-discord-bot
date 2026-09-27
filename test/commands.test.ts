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

/** Discord giới hạn tổng số ký tự của name, description và value (kể cả option, choice) của một command. */
const COMMAND_TEXT_MAX = 8000;
/** Số subcommand/group/option tối đa ở mỗi cấp, và số choice tối đa của một option. */
const MAX_PER_LEVEL = 25;

interface OptionJson
{
	name: string;
	description?: string;
	options?: OptionJson[];
	choices?: { name: string; value: string | number }[];
}

/** Tổng số ký tự name/description/value của một option và mọi option, choice con; kiểm tra số lượng ở mỗi cấp. */
function textLength(option: OptionJson, path: string): number
{
	const children = option.options ?? [];
	const choices = option.choices ?? [];
	assert.ok(children.length <= MAX_PER_LEVEL, `${path}: ${children.length} option con`);
	assert.ok(choices.length <= MAX_PER_LEVEL, `${path}: ${choices.length} choice`);
	return option.name.length
		+ (option.description ?? "").length
		+ choices.reduce((sum, choice) => sum + choice.name.length + String(choice.value).length, 0)
		+ children.reduce((sum, child) => sum + textLength(child, `${path} ${child.name}`), 0);
}

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

	test("giới hạn Discord mà builder không tự kiểm tra: tổng ký tự ≤ 8000, ≤ 25 option/subcommand mỗi cấp và ≤ 25 choice", () =>
	{
		for (const command of commands)
		{
			const json = command.data.toJSON() as OptionJson;
			const total = textLength(json, `/${json.name}`);
			assert.ok(total <= COMMAND_TEXT_MAX, `/${json.name}: ${total} ký tự`);
		}
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
