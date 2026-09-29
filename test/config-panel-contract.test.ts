import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
	CONFIG_PANEL_NAMESPACE,
	ConfigPanelAction,
	configPanelId,
	INVALID_CONFIG_PANEL,
	pageOfAction,
	parseConfigPanelId,
	parseFormNumber,
} from "../src/discord/views/configPanel";
import { UserError } from "../src/shared/errors";

const ROLE = "600000000000000001";

const ACTIONS: readonly ConfigPanelAction[] = [
	{ type: "nav" },
	{ type: "mode", mode: "all" },
	{ type: "mode", mode: "selected" },
	{ type: "channels", enabled: true },
	{ type: "channels", enabled: false },
	{ type: "teams", add: true },
	{ type: "teams", add: false },
	{ type: "announce", enabled: true },
	{ type: "announce", enabled: false },
	{ type: "xpForm" },
	{ type: "xpSave", drawn: { xpPerMessage: 10, xpCooldownSeconds: 86400, minMessageLength: 0, duplicateWindowSeconds: 300 } },
	{ type: "pollForm" },
	{ type: "pollSave", drawn: { defaultPollXp: 5, pollXpDailyCap: 100000, contributionVotePoints: 1 } },
	{ type: "pollRole", drawnRoleId: ROLE },
	{ type: "pollRole", drawnRoleId: null },
	{ type: "board" },
	{ type: "boardOff" },
	{ type: "adminRole", drawnRoleId: ROLE },
	{ type: "adminRole", drawnRoleId: null },
	{ type: "tierPanel" },
];

describe("hợp đồng customId của bảng cấu hình (PROP-033)", () =>
{
	test("mọi thao tác mã hoá rồi đọc lại đúng, customId ≤ 100 ký tự, đúng namespace và không trùng nhau", () =>
	{
		const ids = new Set<string>();
		for (const action of ACTIONS)
		{
			const id = configPanelId(action);
			assert.ok(id.length <= 100, id);
			assert.ok(id.startsWith(`${CONFIG_PANEL_NAMESPACE}:`), id);
			assert.deepEqual(parseConfigPanelId(id), action);
			ids.add(id);
		}
		assert.equal(ids.size, ACTIONS.length);
	});

	test("customId sai hoặc của bảng khác bị từ chối bằng UserError", () =>
	{
		for (const id of ["cfgui", "cfgui:", "cfgui:mode:khac", "cfgui:xpsave:1.2.3", "cfgui:xpsave:1.2.3.1234567", "cfgui:pollrole:123", "tierui:set", "cfgui:nav:x"])
		{
			assert.throws(() => parseConfigPanelId(id), (error: unknown) => error instanceof UserError && error.message === INVALID_CONFIG_PANEL, id);
		}
	});

	test("trang vẽ lại theo thao tác", () =>
	{
		assert.equal(pageOfAction({ type: "channels", enabled: true }), "channels");
		assert.equal(pageOfAction({ type: "xpSave", drawn: { xpPerMessage: 1, xpCooldownSeconds: 1, minMessageLength: 1, duplicateWindowSeconds: 1 } }), "xp");
		assert.equal(pageOfAction({ type: "adminRole", drawnRoleId: null }), "board");
	});

	test("đọc ô số trong form: bỏ khoảng trắng, chỉ nhận chữ số, kiểm tra giới hạn", () =>
	{
		assert.equal(parseFormNumber(" 15 ", "xpPerMessage"), 15);
		assert.equal(parseFormNumber("1 000", "pollXpDailyCap"), 1000);
		assert.equal(parseFormNumber("0", "pollXpDailyCap"), 0);
		assert.throws(() => parseFormNumber("1.000", "pollXpDailyCap"), /chỉ gồm chữ số/);
		assert.throws(() => parseFormNumber("2,5", "xpPerMessage"), UserError);
		assert.throws(() => parseFormNumber("-1", "xpPerMessage"), /XP mỗi tin nhắn/);
		assert.throws(() => parseFormNumber("1001", "xpPerMessage"), UserError);
		assert.throws(() => parseFormNumber("abc", "xpCooldownSeconds"), /Cooldown/);
		assert.throws(() => parseFormNumber("", "minMessageLength"), UserError);
		assert.throws(() => parseFormNumber("1e3", "xpPerMessage"), UserError);
	});
});
