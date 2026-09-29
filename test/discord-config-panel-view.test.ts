import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ButtonStyle, ComponentType, MessageFlags } from "discord.js";
import { COLORS } from "../src/discord/format";
import { describeChannelSettings } from "../src/discord/views/admin";
import {
	BOARD_CHANNEL_TYPES,
	buildPollSettingsModal,
	buildXpSettingsModal,
	CONFIG_PANEL_NOTICE_MAX,
	CONFIG_PANEL_PAGES,
	ConfigPanelData,
	configPanelId,
	ConfigPanelPage,
	configPanelReply,
	configPanelUpdate,
	NO_XP_CHANNEL_WARNING,
	parseConfigPanelId,
	POLL_FORM_KEYS,
	XP_CHANNEL_TYPES,
	XP_FORM_KEYS,
} from "../src/discord/views/configPanel";
import { TIER_SETS } from "../src/modules/activity/tiers";
import { ChannelSettings, DEFAULT_GUILD_SETTINGS, GuildSettings, SETTING_LIMITS, XP_CHANNEL_MODES, XpChannelMode } from "../src/modules/guild-config/types";
import { MAX_TEAMS } from "../src/modules/team/TeamService";
import { CHANNEL_BOT, CHANNEL_GENERAL, ROLE_BACKEND, ROLE_FRONTEND } from "./helpers";

const ROLE_ADMIN = "600000000000000001";
const ROLE_POLL = "600000000000000002";
const CHANNEL_BOARD = "700000000000000001";
const CHANNEL_MUTED = "400000000000000003";
const NOTICE = "Đã bật XP cho 3 kênh: <#400000000000000001>, <#400000000000000002>, <#400000000000000003>.";

/** ID dạng snowflake dài nhất (20 chữ số), để thử giới hạn độ dài. */
function longId(prefix: number, index: number): string
{
	return `${prefix}${String(index).padStart(19, "0")}`;
}

// ---------- Dữ liệu mẫu ----------

function settingsOf(mode: XpChannelMode, patch: Partial<GuildSettings> = {}): GuildSettings
{
	return { ...DEFAULT_GUILD_SETTINGS, xpChannelMode: mode, ...patch };
}

function emptyData(mode: XpChannelMode): ConfigPanelData
{
	return { settings: settingsOf(mode), channels: [], teams: [], boardChannelId: null, tierSet: TIER_SETS["tu-tien"], tierRoleCount: 0 };
}

const OWN_XP_CHANNEL: ChannelSettings = { channelId: CHANNEL_GENERAL, xpEnabled: true, xpPerMessage: 20, xpCooldownSeconds: null };

function fullData(mode: XpChannelMode): ConfigPanelData
{
	return {
		settings: settingsOf(mode, {
			xpPerMessage: 15,
			xpCooldownSeconds: 30,
			minMessageLength: 3,
			duplicateWindowSeconds: 120,
			levelUpAnnouncements: false,
			defaultPollXp: 8,
			pollXpDailyCap: 0,
			contributionVotePoints: 2,
			adminRoleId: ROLE_ADMIN,
			pollCreatorRoleId: ROLE_POLL,
		}),
		channels: [
			OWN_XP_CHANNEL,
			{ channelId: CHANNEL_BOT, xpEnabled: true, xpPerMessage: null, xpCooldownSeconds: null },
			{ channelId: CHANNEL_MUTED, xpEnabled: false, xpPerMessage: null, xpCooldownSeconds: null },
		],
		teams: [ROLE_BACKEND, ROLE_FRONTEND],
		boardChannelId: CHANNEL_BOARD,
		tierSet: TIER_SETS["tu-tien"],
		tierRoleCount: 5,
		notice: NOTICE,
	};
}

const EXTREME_CHANNELS = 200;

/** 200 kênh đều có XP và cooldown riêng (một nửa bật, một nửa tắt), 25 team, ID dài nhất, số lớn nhất, notice dài nhất. */
function extremeData(mode: XpChannelMode): ConfigPanelData
{
	const channels: ChannelSettings[] = Array.from({ length: EXTREME_CHANNELS }, (_, index) => ({
		channelId: longId(4, index),
		xpEnabled: index % 2 === 0,
		xpPerMessage: SETTING_LIMITS.xpPerMessage.max,
		xpCooldownSeconds: SETTING_LIMITS.xpCooldownSeconds.max,
	}));
	return {
		settings: settingsOf(mode, {
			xpPerMessage: SETTING_LIMITS.xpPerMessage.max,
			xpCooldownSeconds: SETTING_LIMITS.xpCooldownSeconds.max,
			minMessageLength: SETTING_LIMITS.minMessageLength.max,
			duplicateWindowSeconds: SETTING_LIMITS.duplicateWindowSeconds.max,
			defaultPollXp: SETTING_LIMITS.defaultPollXp.max,
			pollXpDailyCap: SETTING_LIMITS.pollXpDailyCap.max,
			contributionVotePoints: SETTING_LIMITS.contributionVotePoints.max,
			adminRoleId: longId(6, 1),
			pollCreatorRoleId: longId(6, 2),
		}),
		channels,
		teams: Array.from({ length: MAX_TEAMS }, (_, index) => longId(5, index)),
		boardChannelId: longId(7, 1),
		tierSet: TIER_SETS["kiem-hiep"],
		tierRoleCount: 8,
		notice: "Đã cập nhật <#12345678901234567890>. ".repeat(100).slice(0, CONFIG_PANEL_NOTICE_MAX),
	};
}

const DATASETS: readonly { name: string; build: (mode: XpChannelMode) => ConfigPanelData }[] = [
	{ name: "rỗng", build: emptyData },
	{ name: "đầy đủ", build: fullData },
	{ name: "cực đoan", build: extremeData },
];

// ---------- Đọc JSON của component ----------

interface JsonNode
{
	type: ComponentType;
	custom_id?: string;
	content?: string;
	label?: string;
	description?: string;
	placeholder?: string;
	value?: string;
	style?: number;
	required?: boolean;
	max_length?: number;
	min_values?: number;
	max_values?: number;
	disabled?: boolean;
	accent_color?: number;
	title?: string;
	channel_types?: number[];
	default_values?: { id: string; type: string }[];
	options?: { label: string; value: string; description?: string; default?: boolean; emoji?: { name?: string } }[];
	components?: JsonNode[];
	component?: JsonNode;
}

function toJson(value: unknown): JsonNode
{
	return JSON.parse(JSON.stringify(value)) as JsonNode;
}

/** Mọi component trong cây (kể cả chính nó và component lồng trong label). */
function flatten(node: JsonNode): JsonNode[]
{
	return [node, ...(node.components ?? []).flatMap(flatten), ...(node.component ? flatten(node.component) : [])];
}

/** Bảng của một trang, đọc từ phản hồi mở bảng (đúng một container). */
function panelOf(page: ConfigPanelPage, data: ConfigPanelData): JsonNode
{
	const payload = toJson(configPanelReply(page, data)) as unknown as { components: JsonNode[] };
	assert.equal(payload.components.length, 1);
	assert.equal(payload.components[0].type, ComponentType.Container);
	return payload.components[0];
}

function textsOf(panel: JsonNode): string[]
{
	return flatten(panel).filter(node => node.type === ComponentType.TextDisplay).map(node => node.content ?? "");
}

function panelText(panel: JsonNode): string
{
	return textsOf(panel).join("\n");
}

function nodeById(panel: JsonNode, customId: string): JsonNode
{
	const node = flatten(panel).find(candidate => candidate.custom_id === customId);
	assert.ok(node, `không có component ${customId}`);
	return node;
}

/** TextDisplay bắt đầu bằng `prefix`. */
function textStartingWith(panel: JsonNode, prefix: string): string
{
	const found = textsOf(panel).find(content => content.startsWith(prefix));
	assert.ok(found !== undefined, `không có đoạn chữ bắt đầu bằng ${prefix}`);
	return found;
}

/** Số dòng kênh hiển thị và số kênh bị gộp vào dòng "… và N kênh khác" của một danh sách. */
function listedAndHidden(section: string): { listed: number; hidden: number }
{
	const listed = section.split("\n").filter(line => line.startsWith("• <#")).length;
	const match = /… và (\d+) kênh khác/.exec(section);
	return { listed, hidden: match ? Number(match[1]) : 0 };
}

/** Kiểm tra mọi giới hạn của Discord cho một bảng; trả về số component (tính cả lồng nhau). */
function assertWithinLimits(panel: JsonNode, label: string): number
{
	const nodes = flatten(panel);
	assert.ok(nodes.length <= 40, `${label}: ${nodes.length} component`);
	assert.equal(panel.accent_color, COLORS.primary, label);

	const texts = textsOf(panel);
	const total = texts.reduce((sum, content) => sum + content.length, 0);
	assert.ok(total <= 4000, `${label}: ${total} ký tự`);
	assert.ok(texts.every(content => content.length >= 1), label);

	const ids = nodes.map(node => node.custom_id).filter((id): id is string => id !== undefined);
	assert.equal(new Set(ids).size, ids.length, `${label}: customId trùng`);
	for (const id of ids)
	{
		assert.ok(id.length <= 100, id);
		assert.doesNotThrow(() => parseConfigPanelId(id), id);
	}
	for (const node of nodes)
	{
		if (node.placeholder !== undefined) assert.ok(node.placeholder.length <= 150, `${label}: ${node.placeholder}`);
		if (node.type === ComponentType.Button) assert.ok((node.label ?? "").length <= 80, `${label}: ${node.label}`);
		if (node.type === ComponentType.ActionRow) assert.ok((node.components ?? []).length <= 5, label);
		for (const option of node.options ?? [])
		{
			assert.ok(option.label.length <= 100, option.label);
			assert.ok((option.description ?? "").length <= 100, option.description);
		}
	}
	return nodes.length;
}

// ---------- Khung chung ----------

describe("bảng cấu hình: khung chung (hàm thuần)", () =>
{
	test("6 trang × dữ liệu rỗng, đầy đủ, cực đoan × hai chế độ kênh: ≤ 40 component, ≤ 4.000 ký tự, customId hợp lệ", () =>
	{
		for (const page of CONFIG_PANEL_PAGES)
		{
			for (const mode of XP_CHANNEL_MODES)
			{
				for (const dataset of DATASETS)
				{
					assertWithinLimits(panelOf(page, dataset.build(mode)), `${page}/${mode}/${dataset.name}`);
				}
			}
		}
	});

	test("tiêu đề kèm tên trang, rồi menu chọn trang: 6 lựa chọn có emoji, label, description; default là trang hiện tại", () =>
	{
		for (const page of CONFIG_PANEL_PAGES)
		{
			const panel = panelOf(page, emptyData("all"));
			assert.ok(textsOf(panel)[0].startsWith("## ⚙️ Bảng cấu hình bot · "), textsOf(panel)[0]);
			const nav = nodeById(panel, configPanelId({ type: "nav" }));
			assert.equal(nav.type, ComponentType.StringSelect);
			assert.equal(nav.min_values, 1);
			assert.equal(nav.max_values, 1);
			assert.deepEqual(nav.options?.map(option => option.value), [...CONFIG_PANEL_PAGES]);
			assert.deepEqual(nav.options?.map(option => option.default ?? false), CONFIG_PANEL_PAGES.map(key => key === page), page);
			for (const option of nav.options ?? [])
			{
				assert.ok(option.label.length > 0 && (option.description ?? "").length > 0, option.value);
				assert.ok((option.emoji?.name ?? "").length > 0, option.value);
			}
			assert.equal(flatten(panel)[1].type, ComponentType.TextDisplay, "tiêu đề đứng đầu");
			assert.equal(flatten(panel)[2].type, ComponentType.ActionRow, "không có notice thì menu đứng ngay sau tiêu đề");
		}
	});

	test("notice hiện nguyên văn trong TextDisplay riêng, giữa tiêu đề và menu; notice dài quá mức tối đa thì bị cắt", () =>
	{
		for (const page of CONFIG_PANEL_PAGES)
		{
			const panel = panelOf(page, fullData("selected"));
			assert.equal(textsOf(panel)[1], NOTICE, page);
			assert.ok(JSON.stringify(panel).includes(JSON.stringify(NOTICE).slice(1, -1)), page);
			assert.equal(flatten(panel)[3].type, ComponentType.ActionRow, "menu chọn trang ngay sau notice");
		}
		const longest = extremeData("all").notice ?? "";
		assert.equal(longest.length, CONFIG_PANEL_NOTICE_MAX);
		assert.equal(textsOf(panelOf("channels", extremeData("all")))[1], longest);

		const tooLong = "Đ".repeat(CONFIG_PANEL_NOTICE_MAX + 500);
		const cut = textsOf(panelOf("teams", { ...extremeData("all"), notice: tooLong }))[1];
		assert.ok(cut.length <= CONFIG_PANEL_NOTICE_MAX && cut.startsWith("ĐĐĐ") && cut.endsWith("…"), String(cut.length));

		for (const notice of [null, undefined, ""])
		{
			assert.equal(textsOf(panelOf("home", { ...fullData("all"), notice })).length, 3, "tiêu đề + tóm tắt + ghi chú");
		}
	});

	test("reply riêng kèm IsComponentsV2; update chỉ kèm IsComponentsV2; cùng một container", () =>
	{
		const data = fullData("all");
		const reply = configPanelReply("xp", data);
		const update = configPanelUpdate("xp", data);
		assert.equal(reply.flags, MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
		assert.equal(update.flags, MessageFlags.IsComponentsV2);
		assert.deepEqual(toJson(update.components), toJson(reply.components));
	});
});

// ---------- Từng trang ----------

describe("bảng cấu hình: nội dung từng trang (hàm thuần)", () =>
{
	test("tổng quan: chế độ kênh và số kênh, 4 giá trị XP, thông báo lên level, vote, contribution, team, Bảng vàng, admin, danh hiệu", () =>
	{
		const text = panelText(panelOf("home", fullData("all")));
		for (const expected of [
			"• Chế độ: **tất cả kênh (trừ kênh đã tắt)**",
			"• Kênh đang tắt riêng: **1**",
			"• Kênh có XP hoặc cooldown riêng: **1**",
			"• XP mỗi tin nhắn: **15 XP**",
			"• Cooldown: **30 giây**",
			"• Độ dài tối thiểu: **3 ký tự**",
			"• Chống trùng: **120 giây**",
			"• Thông báo lên level: **Tắt**",
			"• XP mặc định khi vote: **8 XP**",
			"• Giới hạn XP từ vote mỗi ngày: **không giới hạn**",
			`• Role tạo vote: **<@&${ROLE_POLL}>**`,
			"• Điểm mỗi lượt ghi nhận: **2 điểm**",
			`• Team: **2/${MAX_TEAMS}**`,
			`• Bảng vàng: <#${CHANNEL_BOARD}>`,
			`• Role admin bot: **<@&${ROLE_ADMIN}>**`,
			"• Danh hiệu: bộ **Tu tiên** · role đã gán **5/8**",
			"-# Chọn mục ở menu trên để sửa. Các lệnh gõ tay `/config …` vẫn dùng được.",
		])
		{
			assert.ok(text.includes(expected), `thiếu "${expected}" trong:\n${text}`);
		}
		assert.ok(!text.includes(NO_XP_CHANNEL_WARNING));

		const selected = panelText(panelOf("home", fullData("selected")));
		assert.ok(selected.includes("• Chế độ: **chỉ kênh được bật**\n• Kênh đang bật: **2**"), selected);

		const empty = panelText(panelOf("home", emptyData("selected")));
		assert.ok(empty.includes("• Kênh đang bật: **0**"), empty);
		assert.ok(empty.includes(NO_XP_CHANNEL_WARNING), empty);
		assert.ok(empty.includes("• Bảng vàng: **đang tắt**"), empty);
		assert.ok(empty.includes("• Role admin bot: **chưa đặt**"), empty);
		assert.ok(empty.includes(`• Team: **0/${MAX_TEAMS}**`), empty);
	});

	test("kênh, chế độ selected chưa bật kênh nào: cảnh báo; nút chế độ đang dùng xanh và khoá, nút còn lại bấm được", () =>
	{
		const panel = panelOf("channels", emptyData("selected"));
		const text = panelText(panel);
		assert.ok(text.includes("**Chế độ hiện tại: chỉ kênh được bật**"), text);
		assert.ok(textStartingWith(panel, "**Kênh đang tính XP (0)**").includes(NO_XP_CHANNEL_WARNING), text);

		const current = nodeById(panel, configPanelId({ type: "mode", mode: "selected" }));
		assert.equal(current.style, ButtonStyle.Success);
		assert.equal(current.disabled, true);
		const other = nodeById(panel, configPanelId({ type: "mode", mode: "all" }));
		assert.equal(other.style, ButtonStyle.Secondary);
		assert.equal(other.disabled ?? false, false);

		const all = panelOf("channels", emptyData("all"));
		assert.equal(nodeById(all, configPanelId({ type: "mode", mode: "all" })).disabled, true);
		assert.equal(nodeById(all, configPanelId({ type: "mode", mode: "all" })).style, ButtonStyle.Success);
		assert.equal(nodeById(all, configPanelId({ type: "mode", mode: "selected" })).disabled ?? false, false);
		assert.ok(textStartingWith(all, "**Kênh đang tắt XP (0)**").includes("Không có kênh nào bị tắt."));
		assert.ok(!panelText(all).includes(NO_XP_CHANNEL_WARNING));
	});

	test("kênh, chế độ selected: liệt kê kênh đang tính XP, kênh có XP riêng mô tả bằng describeChannelSettings, không liệt kê kênh tắt", () =>
	{
		const data = fullData("selected");
		const list = textStartingWith(panelOf("channels", data), "**Kênh đang tính XP (2)**");
		assert.ok(list.includes(`• <#${CHANNEL_GENERAL}>: ${describeChannelSettings(OWN_XP_CHANNEL, data.settings)}`), list);
		assert.ok(list.split("\n").includes(`• <#${CHANNEL_BOT}>`), list);
		assert.ok(!list.includes(CHANNEL_MUTED), list);
		assert.ok(!panelText(panelOf("channels", data)).includes(NO_XP_CHANNEL_WARNING));
	});

	test("kênh, chế độ all: liệt kê kênh đang tắt XP, rồi kênh đang bật có XP hoặc cooldown riêng", () =>
	{
		const data = fullData("all");
		const list = textStartingWith(panelOf("channels", data), "**Kênh đang tắt XP (1)**");
		const [disabled, custom] = list.split("\n\n");
		assert.equal(disabled, `**Kênh đang tắt XP (1)**\n• <#${CHANNEL_MUTED}>`);
		assert.equal(custom, `**Kênh có XP hoặc cooldown riêng (1)**\n• <#${CHANNEL_GENERAL}>: ${describeChannelSettings(OWN_XP_CHANNEL, data.settings)}`);
	});

	test("kênh: hai ChannelSelect bật/tắt XP, đúng loại kênh, chọn 1–25 kênh; có ghi chú thread/forum và /config channel set", () =>
	{
		const panel = panelOf("channels", fullData("all"));
		for (const enabled of [true, false])
		{
			const select = nodeById(panel, configPanelId({ type: "channels", enabled }));
			assert.equal(select.type, ComponentType.ChannelSelect);
			assert.deepEqual(select.channel_types, [...XP_CHANNEL_TYPES]);
			assert.equal(select.min_values, 1);
			assert.equal(select.max_values, 25);
			assert.equal(select.placeholder, enabled ? "➕ Bật tính XP cho kênh…" : "➖ Tắt tính XP cho kênh…");
		}
		const text = panelText(panel);
		assert.ok(text.includes("thread") && text.includes("forum") && text.includes("kênh cha"), text);
		assert.ok(text.includes("`/config channel set`"), text);
	});

	test("kênh, 200 kênh có cấu hình riêng: danh sách cắt kèm \"… và N kênh khác\", số kênh hiện + N = tổng", () =>
	{
		const selected = textStartingWith(panelOf("channels", extremeData("selected")), `**Kênh đang tính XP (${EXTREME_CHANNELS / 2})**`);
		const shown = listedAndHidden(selected);
		assert.ok(shown.listed > 0 && shown.hidden > 0, selected);
		assert.equal(shown.listed + shown.hidden, EXTREME_CHANNELS / 2);

		const all = textStartingWith(panelOf("channels", extremeData("all")), `**Kênh đang tắt XP (${EXTREME_CHANNELS / 2})**`);
		const [disabled, custom] = all.split("\n\n");
		assert.ok(custom.startsWith(`**Kênh có XP hoặc cooldown riêng (${EXTREME_CHANNELS / 2})**`), custom);
		for (const section of [disabled, custom])
		{
			const counts = listedAndHidden(section);
			assert.ok(counts.listed > 0 && counts.hidden > 0, section);
			assert.equal(counts.listed + counts.hidden, EXTREME_CHANNELS / 2);
		}
	});

	test("team: danh sách N/MAX_TEAMS, hai RoleSelect thêm/bỏ chọn 1–min(25, MAX_TEAMS) role, ghi chú điểm team", () =>
	{
		const panel = panelOf("teams", fullData("all"));
		const list = textStartingWith(panel, `**Team đang có (2/${MAX_TEAMS})**`);
		assert.equal(list, `**Team đang có (2/${MAX_TEAMS})**\n1. <@&${ROLE_BACKEND}>\n2. <@&${ROLE_FRONTEND}>`);
		for (const add of [true, false])
		{
			const select = nodeById(panel, configPanelId({ type: "teams", add }));
			assert.equal(select.type, ComponentType.RoleSelect);
			assert.equal(select.min_values, 1);
			assert.equal(select.max_values, Math.min(25, MAX_TEAMS));
			assert.equal(select.placeholder, add ? "➕ Thêm team…" : "➖ Bỏ team…");
			assert.equal(select.disabled ?? false, false);
		}
		const text = panelText(panel);
		assert.ok(text.includes("điểm lịch sử vẫn giữ") && text.includes("role danh hiệu"), text);
	});

	test("team: đủ MAX_TEAMS team thì khoá ô thêm, chưa có team thì khoá ô bỏ; 25 team hiện đủ", () =>
	{
		const full = panelOf("teams", extremeData("all"));
		assert.equal(nodeById(full, configPanelId({ type: "teams", add: true })).disabled, true);
		assert.equal(nodeById(full, configPanelId({ type: "teams", add: false })).disabled ?? false, false);
		const list = textStartingWith(full, `**Team đang có (${MAX_TEAMS}/${MAX_TEAMS})**`);
		assert.equal(list.split("\n").length, MAX_TEAMS + 1, list);

		const empty = panelOf("teams", emptyData("all"));
		assert.equal(nodeById(empty, configPanelId({ type: "teams", add: false })).disabled, true);
		assert.equal(nodeById(empty, configPanelId({ type: "teams", add: true })).disabled ?? false, false);
		assert.ok(textStartingWith(empty, `**Team đang có (0/${MAX_TEAMS})**`).includes("Chưa có team nào"));
	});

	test("Activity XP: dòng cấu hình, nút sửa số, nút đảo thông báo lên level nói rõ hành động", () =>
	{
		const off = panelOf("xp", fullData("all"));
		const text = panelText(off);
		for (const expected of ["• XP mỗi tin nhắn: **15 XP**", "• Cooldown: **30 giây**", "• Độ dài tối thiểu: **3 ký tự**", "• Chống trùng: **120 giây**", "• Thông báo lên level: **Tắt**"])
		{
			assert.ok(text.includes(expected), expected);
		}
		assert.equal(nodeById(off, configPanelId({ type: "xpForm" })).label, "✏️ Sửa số");
		assert.equal(nodeById(off, configPanelId({ type: "announce", enabled: true })).label, "🔔 Bật thông báo lên level");

		const on = panelOf("xp", emptyData("all"));
		assert.equal(nodeById(on, configPanelId({ type: "announce", enabled: false })).label, "🔕 Tắt thông báo lên level");
		assert.ok(!flatten(on).some(node => node.custom_id === configPanelId({ type: "announce", enabled: true })));
	});

	test("vote và contribution: dòng cấu hình, nút sửa số, RoleSelect một role điền sẵn role tạo vote; drawnRoleId khớp settings", () =>
	{
		const panel = panelOf("poll", fullData("all"));
		const text = panelText(panel);
		for (const expected of ["• XP mặc định khi vote: **8 XP**", "• Giới hạn XP từ vote mỗi ngày: **không giới hạn**", "• Điểm mỗi lượt ghi nhận: **2 điểm**", `• Role tạo vote: **<@&${ROLE_POLL}>**`])
		{
			assert.ok(text.includes(expected), expected);
		}
		assert.equal(nodeById(panel, configPanelId({ type: "pollForm" })).label, "✏️ Sửa số");
		const select = nodeById(panel, configPanelId({ type: "pollRole", drawnRoleId: ROLE_POLL }));
		assert.equal(select.type, ComponentType.RoleSelect);
		assert.equal(select.min_values, 0);
		assert.equal(select.max_values, 1);
		assert.deepEqual(select.default_values, [{ id: ROLE_POLL, type: "role" }]);
		assert.equal(select.placeholder, "Role được tạo vote (bỏ chọn = chỉ admin)");
		assert.deepEqual(parseConfigPanelId(select.custom_id ?? ""), { type: "pollRole", drawnRoleId: ROLE_POLL });

		const empty = nodeById(panelOf("poll", emptyData("all")), configPanelId({ type: "pollRole", drawnRoleId: null }));
		assert.equal(empty.default_values, undefined);
		assert.deepEqual(parseConfigPanelId(empty.custom_id ?? ""), { type: "pollRole", drawnRoleId: null });
	});

	test("Bảng vàng và quyền: kênh điền sẵn, nút tắt, role admin điền sẵn, nút mở bảng danh hiệu", () =>
	{
		const panel = panelOf("board", fullData("all"));
		const text = panelText(panel);
		assert.ok(text.includes(`<#${CHANNEL_BOARD}>`), text);
		assert.ok(text.includes(`• Role admin bot: **<@&${ROLE_ADMIN}>**`), text);
		assert.ok(text.includes("Manage Server") && text.includes("Server Settings → Integrations"), text);
		assert.ok(text.includes("bộ **Tu tiên** · role đã gán **5/8**"), text);

		const board = nodeById(panel, configPanelId({ type: "board" }));
		assert.equal(board.type, ComponentType.ChannelSelect);
		assert.deepEqual(board.channel_types, [...BOARD_CHANNEL_TYPES]);
		assert.equal(board.min_values, 1);
		assert.equal(board.max_values, 1);
		assert.deepEqual(board.default_values, [{ id: CHANNEL_BOARD, type: "channel" }]);

		const off = nodeById(panel, configPanelId({ type: "boardOff" }));
		assert.equal(off.label, "Tắt Bảng vàng");
		assert.equal(off.style, ButtonStyle.Danger);
		assert.equal(off.disabled ?? false, false);

		const admin = nodeById(panel, configPanelId({ type: "adminRole", drawnRoleId: ROLE_ADMIN }));
		assert.equal(admin.type, ComponentType.RoleSelect);
		assert.equal(admin.min_values, 0);
		assert.equal(admin.max_values, 1);
		assert.deepEqual(admin.default_values, [{ id: ROLE_ADMIN, type: "role" }]);
		assert.deepEqual(parseConfigPanelId(admin.custom_id ?? ""), { type: "adminRole", drawnRoleId: ROLE_ADMIN });

		assert.equal(nodeById(panel, configPanelId({ type: "tierPanel" })).label, "🏅 Mở bảng danh hiệu");
	});

	test("Bảng vàng và quyền khi chưa cấu hình: không điền sẵn, nút tắt bị khoá, role admin mang none", () =>
	{
		const panel = panelOf("board", emptyData("all"));
		assert.ok(panelText(panel).includes("Đang tắt"));
		assert.equal(nodeById(panel, configPanelId({ type: "board" })).default_values, undefined);
		assert.equal(nodeById(panel, configPanelId({ type: "boardOff" })).disabled, true);
		const admin = nodeById(panel, configPanelId({ type: "adminRole", drawnRoleId: null }));
		assert.equal(admin.default_values, undefined);
		assert.ok(panelText(panel).includes("• Role admin bot: **chưa đặt**"));
	});
});

// ---------- Form sửa số ----------

describe("bảng cấu hình: form sửa số (hàm thuần)", () =>
{
	function assertForm(modal: JsonNode, keys: readonly string[], values: Record<string, number>): void
	{
		assert.ok((modal.title ?? "").length >= 1 && (modal.title ?? "").length <= 45, modal.title);
		assert.ok((modal.custom_id ?? "").length <= 100);
		const labels = modal.components ?? [];
		assert.ok(labels.length <= 5);
		assert.equal(labels.length, keys.length);
		for (const label of labels)
		{
			assert.equal(label.type, ComponentType.Label);
			assert.ok((label.label ?? "").length >= 1 && (label.label ?? "").length <= 45, label.label);
			const description = label.description ?? "";
			assert.ok(description.length >= 1 && description.length <= 100, description);
			assert.ok(!description.endsWith("…"), `mô tả bị cắt: ${description}`);
		}
		const inputs = labels.map(label => label.component);
		assert.deepEqual(inputs.map(input => input?.custom_id), [...keys]);
		assert.deepEqual(inputs.map(input => input?.value), keys.map(key => String(values[key])));
		for (const input of inputs)
		{
			assert.equal(input?.type, ComponentType.TextInput);
			assert.equal(input?.required, true);
		}
	}

	test("form XP: customId parse ra đúng giá trị lúc mở, 4 ô điền sẵn và bắt buộc, trong giới hạn của Discord", () =>
	{
		for (const data of [emptyData("all"), fullData("all"), extremeData("selected")])
		{
			const { settings } = data;
			const modal = toJson(buildXpSettingsModal(settings));
			const drawn = {
				xpPerMessage: settings.xpPerMessage,
				xpCooldownSeconds: settings.xpCooldownSeconds,
				minMessageLength: settings.minMessageLength,
				duplicateWindowSeconds: settings.duplicateWindowSeconds,
			};
			assert.deepEqual(parseConfigPanelId(modal.custom_id ?? ""), { type: "xpSave", drawn });
			assertForm(modal, XP_FORM_KEYS, drawn);
		}
		const description = toJson(buildXpSettingsModal(DEFAULT_GUILD_SETTINGS)).components?.[1].description ?? "";
		assert.ok(description.includes("Thời gian chờ giữa hai lần") && description.includes("86.400"), description);
	});

	test("form vote/contribution: customId parse ra đúng giá trị lúc mở, 3 ô điền sẵn và bắt buộc; ghi rõ 0 = không giới hạn", () =>
	{
		for (const data of [emptyData("all"), fullData("all"), extremeData("selected")])
		{
			const { settings } = data;
			const modal = toJson(buildPollSettingsModal(settings));
			const drawn = { defaultPollXp: settings.defaultPollXp, pollXpDailyCap: settings.pollXpDailyCap, contributionVotePoints: settings.contributionVotePoints };
			assert.deepEqual(parseConfigPanelId(modal.custom_id ?? ""), { type: "pollSave", drawn });
			assertForm(modal, POLL_FORM_KEYS, drawn);
		}
		const cap = toJson(buildPollSettingsModal(DEFAULT_GUILD_SETTINGS)).components?.[1].description ?? "";
		assert.ok(cap.includes("0 = không giới hạn"), cap);
	});
});
