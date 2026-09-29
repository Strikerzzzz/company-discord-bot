import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ComponentType } from "discord.js";
import {
	BOARD_CHANNEL_TYPES,
	buildConfigPanel,
	CONFIG_PANEL_PAGES,
	ConfigPanelAction,
	ConfigPanelData,
	parseConfigPanelId,
	XP_CHANNEL_TYPES,
} from "../src/discord/views/configPanel";
import { TIER_SETS } from "../src/modules/activity/tiers";
import { DEFAULT_GUILD_SETTINGS, XpChannelMode } from "../src/modules/guild-config/types";

const ROLE_ADMIN = "600000000000000001";
const ROLE_POLL = "600000000000000002";
const ROLE_TEAM = "600000000000000003";
const CHANNEL_A = "700000000000000001";
const CHANNEL_B = "700000000000000002";

interface Interactive
{
	type: number;
	customId: string;
	minValues?: number;
	maxValues?: number;
	channelTypes?: readonly number[];
	disabled?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null;
}

/** Mọi component có customId trong JSON của bảng (đi qua container và action row lồng nhau). */
function interactives(node: unknown, found: Interactive[] = []): Interactive[]
{
	if (Array.isArray(node))
	{
		for (const child of node) interactives(child, found);
		return found;
	}
	if (!isRecord(node)) return found;
	const { type, custom_id: customId } = node;
	if (typeof type === "number" && typeof customId === "string")
	{
		found.push({
			type,
			customId,
			minValues: typeof node.min_values === "number" ? node.min_values : undefined,
			maxValues: typeof node.max_values === "number" ? node.max_values : undefined,
			channelTypes: Array.isArray(node.channel_types) ? node.channel_types.filter((value): value is number => typeof value === "number") : undefined,
			disabled: typeof node.disabled === "boolean" ? node.disabled : undefined,
		});
	}
	if (Array.isArray(node.components)) interactives(node.components, found);
	if (isRecord(node.accessory)) interactives(node.accessory, found);
	return found;
}

/** Loại component mà handler (config.ts: configPanelButton / configPanelSelect) chấp nhận cho từng thao tác. */
const EXPECTED_TYPE: Readonly<Record<ConfigPanelAction["type"], number | null>> = {
	nav: ComponentType.StringSelect,
	mode: ComponentType.Button,
	channels: ComponentType.ChannelSelect,
	teams: ComponentType.RoleSelect,
	announce: ComponentType.Button,
	xpForm: ComponentType.Button,
	pollForm: ComponentType.Button,
	pollRole: ComponentType.RoleSelect,
	board: ComponentType.ChannelSelect,
	boardOff: ComponentType.Button,
	adminRole: ComponentType.RoleSelect,
	tierPanel: ComponentType.Button,
	xpSave: null,
	pollSave: null,
};

function data(mode: XpChannelMode): ConfigPanelData
{
	return {
		settings: { ...DEFAULT_GUILD_SETTINGS, xpChannelMode: mode, adminRoleId: ROLE_ADMIN, pollCreatorRoleId: ROLE_POLL },
		channels: [
			{ channelId: CHANNEL_A, xpEnabled: true, xpPerMessage: 20, xpCooldownSeconds: null },
			{ channelId: CHANNEL_B, xpEnabled: false, xpPerMessage: null, xpCooldownSeconds: null },
		],
		teams: [ROLE_TEAM],
		boardChannelId: CHANNEL_A,
		tierSet: TIER_SETS["rank-game"],
		tierRoleCount: 2,
	};
}

describe("bảng cấu hình: giao diện (agent A) khớp handler (agent B)", () =>
{
	for (const mode of ["all", "selected"] as const)
	{
		test(`mọi component có customId trên 6 trang (chế độ ${mode}) đúng loại handler nhận, đúng ràng buộc lựa chọn`, () =>
		{
			const seen = new Set<ConfigPanelAction["type"]>();
			for (const page of CONFIG_PANEL_PAGES)
			{
				for (const component of interactives(buildConfigPanel(page, data(mode)).toJSON()))
				{
					const action = parseConfigPanelId(component.customId);
					seen.add(action.type);
					assert.equal(component.type, EXPECTED_TYPE[action.type], `${page}: ${component.customId}`);
					if (action.type === "channels")
					{
						assert.deepEqual(component.channelTypes, [...XP_CHANNEL_TYPES], component.customId);
						assert.equal(component.minValues, 1);
						assert.ok((component.maxValues ?? 1) <= 25);
					}
					if (action.type === "board")
					{
						assert.deepEqual(component.channelTypes, [...BOARD_CHANNEL_TYPES]);
						assert.equal(component.maxValues, 1);
					}
					if (action.type === "pollRole" || action.type === "adminRole")
					{
						assert.equal(component.minValues, 0, "bỏ chọn phải gửi được thao tác (min_values = 0)");
						assert.equal(component.maxValues, 1);
						assert.equal(action.drawnRoleId, action.type === "pollRole" ? ROLE_POLL : ROLE_ADMIN);
					}
					if (action.type === "announce") assert.equal(action.enabled, !DEFAULT_GUILD_SETTINGS.levelUpAnnouncements);
					if (action.type === "mode") assert.equal(component.disabled === true, action.mode === mode, "nút chế độ đang dùng bị khoá");
				}
			}
			const reachable: readonly ConfigPanelAction["type"][] = [
				"nav", "mode", "channels", "teams", "announce", "xpForm", "pollForm", "pollRole", "board", "boardOff", "adminRole", "tierPanel",
			];
			for (const type of reachable) assert.ok(seen.has(type), `không có component nào cho thao tác ${type}`);
		});
	}
});
