import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "perf_hooks";
import {
	ActionRowBuilder,
	APIEmbed,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonInteraction,
	ButtonStyle,
	ChatInputCommandInteraction,
	EmbedBuilder,
	InteractionEditReplyOptions,
	InteractionReplyOptions,
	MessageFlags,
	PermissionFlagsBits,
	PermissionsBitField,
} from "discord.js";
import type DiscordClient from "../src/classes/DiscordClient";
import {
	buildLeaderboardCardData,
	buildRankCardData,
	DELETED_ROLE_NAME,
	LeaderboardCardInput,
	leaderboardEmptyText,
	NO_BADGE_TEXT,
	periodLabel,
	rankSummaryText,
	roleColorHex,
} from "../src/discord/cardData";
import { LeaderboardCardData, RenderedCard } from "../src/discord/cards/types";
import { UNKNOWN_MEMBER_NAME } from "../src/discord/memberDirectory";
import { cooldownMessage, RenderGate } from "../src/discord/renderGate";
import LeaderboardCmd, {
	BoardState,
	boardComponents,
	boardMeId,
	boardViewId,
	INVALID_BOARD_BUTTON,
	NO_STANDING,
	parseBoardId,
} from "../src/interactions/commands/leaderboard";
import { levelInfo, totalXpForLevel } from "../src/modules/activity/levels";
import { applyTierOverrides, DEFAULT_TIER_SET, TIER_SETS, tierByKey, tierForLevel, nextTier, TierSet } from "../src/modules/activity/tiers";
import { ACHIEVEMENTS } from "../src/modules/gamification/achievements";
import { GamificationProfile } from "../src/modules/gamification/types";
import { LeaderboardPage, LeaderboardPeriod, LeaderboardScope, ScoreKind } from "../src/modules/leaderboard/LeaderboardService";
import { AppServices, createServices } from "../src/services";
import { UserError } from "../src/shared/errors";
import { startOfVnMonth, startOfVnWeek } from "../src/shared/time";
import { ADMIN, createTestContext, GUILD, ROLE_BACKEND, ROLE_FRONTEND, TestContext, USER_A, USER_B, USER_C } from "./helpers";

// Thứ Tư 30/09/2026 10:00 giờ Việt Nam: tuần bắt đầu thứ Hai 28/09, tháng 09/2026.
const NOW = Date.UTC(2026, 8, 30, 3, 0);
const WEEK_START = startOfVnWeek(NOW);
const MONTH_START = startOfVnMonth(NOW);
const BOT_ID = "900000000000000001";
const AVATAR_BYTES = Buffer.from("avatar");
const FAKE_CARD: RenderedCard = { png: Buffer.from("png"), fileName: "leaderboard.png", width: 1000, height: 400 };

function isUserError(message: string): (error: unknown) => boolean
{
	return error => error instanceof UserError && error.message === message;
}

// ---------- customId ----------

describe("customId của nút bảng xếp hạng", () =>
{
	test("xem bảng: dựng rồi đọc lại đúng trạng thái, luôn ngắn hơn 100 ký tự", () =>
	{
		const kinds: ScoreKind[] = ["activity", "contribution"];
		const scopes: LeaderboardScope[] = ["individual", "team"];
		const periods: LeaderboardPeriod[] = ["all", "week", "month"];
		for (const kind of kinds)
		{
			for (const scope of scopes)
			{
				for (const period of periods)
				{
					for (const page of [1, 7, 999_999])
					{
						const state: BoardState = { kind, scope, period, page, ownerId: "12345678901234567890" };
						const id = boardViewId(state);
						assert.ok(id.length <= 100, id);
						assert.deepEqual(parseBoardId(id), { type: "view", state });
					}
				}
			}
		}
		assert.equal(boardViewId({ kind: "contribution", scope: "team", period: "week", page: 3, ownerId: USER_A }), `lb:v:c:t:w:3:${USER_A}`);
	});

	test("hạng của tôi: dựng rồi đọc lại", () =>
	{
		assert.equal(boardMeId("activity", "month", USER_A), `lb:me:a:m:${USER_A}`);
		assert.deepEqual(parseBoardId(`lb:me:a:m:${USER_A}`), { type: "me", kind: "activity", period: "month", ownerId: USER_A });
		assert.deepEqual(parseBoardId(`lb:me:c:all:${USER_B}`), { type: "me", kind: "contribution", period: "all", ownerId: USER_B });
	});

	test("trang ngoài khoảng được kẹp về trang 1", () =>
	{
		for (const page of ["0", "000"])
		{
			const action = parseBoardId(`lb:v:a:i:all:${page}:${USER_A}`);
			assert.ok(action.type === "view");
			assert.equal(action.state.page, 1);
		}
	});

	test("sai định dạng thì báo \"Nút này không hợp lệ.\"", () =>
	{
		const invalid = [
			"lb",
			"lb:v",
			`lb:v:x:i:all:1:${USER_A}`,
			`lb:v:a:x:all:1:${USER_A}`,
			`lb:v:a:i:week:1:${USER_A}`,
			`lb:v:a:i:all:abc:${USER_A}`,
			`lb:v:a:i:all:-1:${USER_A}`,
			`lb:v:a:i:all:1234567:${USER_A}`,
			"lb:v:a:i:all:1:12345",
			"lb:v:a:i:all:1:123456789012345678901",
			`lb:v:a:i:all:1:${USER_A}:thua`,
			`lb:me:a:i:all:${USER_A}`,
			`lb:me:a:all:${USER_A}x`,
			"lb:x:kind",
			`poll:v:a:i:all:1:${USER_A}`,
			` lb:v:a:i:all:1:${USER_A}`,
		];
		for (const customId of invalid)
		{
			assert.throws(() => parseBoardId(customId), isUserError(INVALID_BOARD_BUTTON), customId);
		}
	});
});

// ---------- Hàng nút ----------

interface ButtonView
{
	id: string;
	label: string;
	emoji: string | null;
	style: ButtonStyle;
	disabled: boolean;
}

function buttonRows(components: unknown): ButtonView[][]
{
	assert.ok(Array.isArray(components));
	return components.map(row =>
	{
		assert.ok(row instanceof ActionRowBuilder);
		return row.components.map(component =>
		{
			assert.ok(component instanceof ButtonBuilder);
			const json = component.toJSON();
			assert.ok("custom_id" in json);
			return {
				id: json.custom_id,
				label: json.label ?? "",
				emoji: json.emoji?.name ?? null,
				style: json.style,
				disabled: json.disabled ?? false,
			};
		});
	});
}

function findButton(rows: ButtonView[][], label: string): ButtonView
{
	const button = rows.flat().find(candidate => candidate.label === label);
	assert.ok(button, `thiếu nút "${label}"`);
	return button;
}

describe("hàng nút bảng xếp hạng", () =>
{
	const base: BoardState = { kind: "activity", scope: "individual", period: "week", page: 2, ownerId: USER_A };

	test("ba hàng: loại điểm; phạm vi và kỳ; chuyển trang và hạng của tôi", () =>
	{
		const rows = buttonRows(boardComponents(base, 3));
		assert.deepEqual(rows.map(row => row.map(button => button.label)), [
			["Activity", "Contribution"],
			["Cá nhân", "Team", "Tổng", "Tuần", "Tháng"],
			["◀", "Trang 2/3", "▶", "Hạng của tôi"],
		]);
		assert.deepEqual(rows.flat().map(button => button.emoji), ["⚡", "🌟", "👤", "👥", null, null, null, null, null, null, "📍"]);
		const ids = rows.flat().map(button => button.id);
		assert.equal(new Set(ids).size, ids.length, "customId không được trùng trong một message");
		for (const id of ids) assert.ok(id.startsWith("lb:") && id.length <= 100, id);
	});

	test("nút đang chọn: Primary và bị vô hiệu hoá; nút khác trỏ tới bảng tương ứng ở trang 1", () =>
	{
		const rows = buttonRows(boardComponents(base, 3));
		for (const label of ["Activity", "Cá nhân", "Tuần"])
		{
			const button = findButton(rows, label);
			assert.equal(button.style, ButtonStyle.Primary, label);
			assert.equal(button.disabled, true, label);
		}
		for (const label of ["Contribution", "Team", "Tổng", "Tháng", "◀", "▶", "Hạng của tôi"])
		{
			const button = findButton(rows, label);
			assert.equal(button.style, ButtonStyle.Secondary, label);
			assert.equal(button.disabled, false, label);
		}
		assert.equal(findButton(rows, "Contribution").id, `lb:v:c:i:w:1:${USER_A}`);
		assert.equal(findButton(rows, "Team").id, `lb:v:a:t:w:1:${USER_A}`);
		assert.equal(findButton(rows, "Tổng").id, `lb:v:a:i:all:1:${USER_A}`);
		assert.equal(findButton(rows, "Tháng").id, `lb:v:a:i:m:1:${USER_A}`);
		assert.equal(findButton(rows, "◀").id, `lb:v:a:i:w:1:${USER_A}`);
		assert.equal(findButton(rows, "▶").id, `lb:v:a:i:w:3:${USER_A}`);
		assert.equal(findButton(rows, "Hạng của tôi").id, `lb:me:a:w:${USER_A}`);
		assert.equal(findButton(rows, "Trang 2/3").disabled, true);
	});

	test("biên trang: ◀ tắt ở trang đầu, ▶ tắt ở trang cuối", () =>
	{
		const only = buttonRows(boardComponents({ ...base, page: 1 }, 1));
		assert.equal(findButton(only, "◀").disabled, true);
		assert.equal(findButton(only, "▶").disabled, true);
		assert.equal(findButton(only, "Trang 1/1").disabled, true);

		const last = buttonRows(boardComponents({ ...base, page: 4 }, 4));
		assert.equal(findButton(last, "◀").disabled, false);
		assert.equal(findButton(last, "▶").disabled, true);
	});

	test("\"Hạng của tôi\" chỉ có ở bảng cá nhân", () =>
	{
		const team = buttonRows(boardComponents({ ...base, scope: "team", kind: "contribution", period: "all", page: 1 }, 1));
		assert.deepEqual(team[2].map(button => button.label), ["◀", "Trang 1/1", "▶"]);
		assert.equal(findButton(team, "Team").disabled, true);
		assert.equal(findButton(team, "Contribution").disabled, true);
		assert.equal(findButton(team, "Tổng").disabled, true);
	});
});

// ---------- Dữ liệu ảnh ----------

function boardPage(entries: [string, number, number][], overrides: Partial<LeaderboardPage> = {}): LeaderboardPage
{
	return {
		entries: entries.map(([id, rank, value]) => ({ id, rank, value })),
		page: 1,
		totalPages: 1,
		totalEntries: entries.length,
		period: "all",
		since: null,
		...overrides,
	};
}

function cardInput(overrides: Partial<LeaderboardCardInput>): LeaderboardCardInput
{
	return { kind: "activity", scope: "individual", page: boardPage([]), viewerId: null, tierSet: DEFAULT_TIER_SET, ...overrides };
}

describe("dữ liệu ảnh bảng xếp hạng", () =>
{
	test("tiêu đề và dòng phụ theo loại, phạm vi và kỳ (giờ Việt Nam)", () =>
	{
		const all = buildLeaderboardCardData(cardInput({}));
		assert.equal(all.title, "BẢNG XẾP HẠNG · ACTIVITY XP");
		assert.equal(all.subtitle, "Cá nhân · Tổng");

		const week = buildLeaderboardCardData(cardInput({ kind: "contribution", scope: "team", page: boardPage([], { period: "week", since: WEEK_START }) }));
		assert.equal(week.title, "BẢNG XẾP HẠNG · CONTRIBUTION");
		assert.equal(week.subtitle, "Team · Tuần này (từ 28/09)");

		const month = buildLeaderboardCardData(cardInput({ page: boardPage([], { period: "month", since: MONTH_START }) }));
		assert.equal(month.subtitle, "Cá nhân · Tháng này (09/2026)");

		assert.equal(periodLabel("month", startOfVnMonth(Date.UTC(2026, 8, 30, 17, 30))), "Tháng này (10/2026)", "00:30 ngày 01/10 giờ Việt Nam đã sang tháng 10");
		assert.equal(periodLabel("week", startOfVnWeek(Date.UTC(2026, 9, 4, 16, 59))), "Tuần này (từ 28/09)", "23:59 Chủ nhật vẫn thuộc tuần cũ");
		assert.equal(periodLabel("week", startOfVnWeek(Date.UTC(2026, 9, 4, 17, 0))), "Tuần này (từ 05/10)");
	});

	test("chân ảnh: trang và tổng số người/team", () =>
	{
		assert.equal(buildLeaderboardCardData(cardInput({ page: boardPage([], { page: 2, totalPages: 4, totalEntries: 37 }) })).footer, "Trang 2/4 · 37 người");
		assert.equal(buildLeaderboardCardData(cardInput({ scope: "team", page: boardPage([], { totalEntries: 3 }) })).footer, "Trang 1/1 · 3 team");
		assert.equal(buildLeaderboardCardData(cardInput({ page: boardPage([], { totalEntries: 1234, totalPages: 124 }) })).footer, "Trang 1/124 · 1.234 người");
	});

	test("chữ khi bảng rỗng theo kỳ và loại điểm", () =>
	{
		assert.equal(leaderboardEmptyText("activity", "individual", "week"), "Tuần này chưa ai ghi điểm — nhắn tin để mở hàng!");
		assert.equal(leaderboardEmptyText("activity", "team", "month"), "Tháng này chưa team nào ghi điểm — nhắn tin để mở hàng!");
		assert.equal(leaderboardEmptyText("contribution", "individual", "all"), "Chưa ai có điểm — gửi contribution để mở hàng!");
		assert.equal(buildLeaderboardCardData(cardInput({ page: boardPage([], { period: "week", since: WEEK_START }) })).emptyText, leaderboardEmptyText("activity", "individual", "week"));
	});

	test("Activity cá nhân theo kỳ: điểm của kỳ, cảnh giới và level theo tổng XP; dòng của người xem nổi bật", () =>
	{
		const bigXp = totalXpForLevel(45) + 10;
		const data = buildLeaderboardCardData(cardInput({
			page: boardPage([[USER_A, 1, 68_420], [USER_B, 2, 50], [USER_C, 3, 40]], { period: "week", since: WEEK_START }),
			people: new Map([[USER_A, { displayName: "Anh A", avatar: AVATAR_BYTES }], [USER_B, { displayName: "Người B", avatar: null }]]),
			totalXp: new Map([[USER_A, bigXp], [USER_B, totalXpForLevel(7)]]),
			viewerId: USER_B,
		}));

		assert.deepEqual(data.rows[0], {
			rank: 1,
			name: "Anh A",
			avatar: AVATAR_BYTES,
			value: "68.420 XP",
			detail: "Lv 45",
			tier: tierByKey("bac-8"),
			accentColor: null,
			highlight: false,
		});
		assert.equal(data.rows[1].tier?.key, "bac-3");
		assert.equal(data.rows[1].detail, "Lv 7");
		assert.equal(data.rows[1].highlight, true);
		assert.equal(data.rows[2].name, UNKNOWN_MEMBER_NAME, "không tra được tên");
		assert.equal(data.rows[2].detail, "Lv 0", "thiếu tổng XP thì dùng điểm của kỳ");
	});

	test("Activity cá nhân kỳ tổng: level theo chính điểm của dòng", () =>
	{
		const xp = totalXpForLevel(12);
		const [row] = buildLeaderboardCardData(cardInput({ page: boardPage([[USER_A, 1, xp]]) })).rows;
		assert.equal(row.detail, "Lv 12");
		assert.equal(row.tier?.key, tierForLevel(12).key);
	});

	test("bậc trên dòng theo bộ danh hiệu của guild ở bảng tuần và tháng (tên tuỳ chỉnh), vẫn theo level tổng", () =>
	{
		const kiemHiep = applyTierOverrides(TIER_SETS["kiem-hiep"], [{ tierKey: "bac-8", name: "Minh Chủ", emoji: "🐲" }]);
		for (const period of ["week", "month"] as const)
		{
			const data = buildLeaderboardCardData(cardInput({
				page: boardPage([[USER_A, 1, 500], [USER_B, 2, 50]], { period, since: period === "week" ? WEEK_START : MONTH_START }),
				totalXp: new Map([[USER_A, totalXpForLevel(45)], [USER_B, totalXpForLevel(10)]]),
				tierSet: kiemHiep,
			}));
			assert.deepEqual(data.rows.map(row => [row.tier?.setKey, row.tier?.key, row.tier?.name, row.detail]), [
				["kiem-hiep", "bac-8", "Minh Chủ", "Lv 45"],
				["kiem-hiep", "bac-4", "Tráng Sĩ", "Lv 10"],
			], period);
		}
		const [row] = buildLeaderboardCardData(cardInput({ page: boardPage([[USER_A, 1, totalXpForLevel(20)]]), tierSet: TIER_SETS["rank-game"] })).rows;
		assert.equal(row.tier?.name, "Tinh Anh", "kỳ tổng cũng theo bộ");
	});

	test("ảnh mọi bảng (Contribution, team, bảng trống) mang bộ danh hiệu của guild", () =>
	{
		const renamed = applyTierOverrides(TIER_SETS["cay-xanh"], [{ tierKey: "bac-8", name: "Cổ Thụ", emoji: null }]);
		const pages: [string, number, number][][] = [[], [[USER_A, 1, 120]]];
		for (const kind of ["activity", "contribution"] as const)
		{
			for (const scope of ["individual", "team"] as const)
			{
				for (const entries of pages)
				{
					const data = buildLeaderboardCardData(cardInput({ kind, scope, page: boardPage(entries), tierSet: renamed }));
					assert.equal(data.tierSet, renamed, `${kind} ${scope} ${entries.length}`);
				}
			}
		}
		assert.equal(buildLeaderboardCardData(cardInput({})).tierSet, DEFAULT_TIER_SET);
	});

	test("Contribution cá nhân: \"N điểm\", không có cảnh giới hay dòng phụ", () =>
	{
		const [row] = buildLeaderboardCardData(cardInput({ kind: "contribution", page: boardPage([[USER_A, 1, 1234]]), viewerId: USER_A })).rows;
		assert.equal(row.value, "1.234 điểm");
		assert.equal(row.tier, null);
		assert.equal(row.detail, null);
		assert.equal(row.highlight, true);
	});

	test("team: tên và màu role; role đã xoá; màu 0 là không màu; không tô nổi bật", () =>
	{
		const data = buildLeaderboardCardData(cardInput({
			scope: "team",
			page: boardPage([[ROLE_BACKEND, 1, 5000], [ROLE_FRONTEND, 2, 300], ["500000000000000077", 3, 10]]),
			roles: new Map([[ROLE_BACKEND, { name: "Backend", color: 0x3498db }], [ROLE_FRONTEND, { name: "Frontend", color: 0 }]]),
			viewerId: ROLE_BACKEND,
		}));
		assert.deepEqual(data.rows.map(row => [row.name, row.accentColor, row.value]), [
			["Backend", "#3498db", "5.000 XP"],
			["Frontend", null, "300 XP"],
			[DELETED_ROLE_NAME, null, "10 XP"],
		]);
		for (const row of data.rows)
		{
			assert.equal(row.avatar, null);
			assert.equal(row.detail, null);
			assert.equal(row.tier, null);
			assert.equal(row.highlight, false);
		}
		assert.equal(roleColorHex(0x00000f), "#00000f");
	});
});

// ---------- Thẻ rank ----------

interface ProfileOptions
{
	totalXp?: number;
	streak?: number;
	unlocked?: string[];
	current?: Record<string, number>;
	tierSet?: TierSet;
}

function gamificationProfile(options: ProfileOptions = {}): GamificationProfile
{
	const level = levelInfo(options.totalXp ?? 0);
	const unlocked = new Set(options.unlocked ?? []);
	const tierSet = options.tierSet ?? DEFAULT_TIER_SET;
	return {
		userId: USER_A,
		level,
		tierSet,
		tier: tierForLevel(level.level, tierSet),
		nextTier: nextTier(level.level, tierSet),
		streak: { current: options.streak ?? 0, best: Math.max(options.streak ?? 0, 3), activeToday: true, lastActiveDay: 1 },
		stats: { messages: 0, bestStreak: 0, recognitionsReceived: 0, recognitionsGiven: 0, pollsJoined: 0, contributions: 0 },
		achievements: ACHIEVEMENTS.map(achievement => ({
			achievement,
			unlocked: unlocked.has(achievement.key),
			current: options.current?.[achievement.key] ?? (unlocked.has(achievement.key) ? achievement.threshold : 0),
		})),
		weekly: { xp: 1240, rank: 2 },
	};
}

describe("thẻ rank và phần chữ đi kèm", () =>
{
	test("buildRankCardData ghép đúng các hồ sơ", () =>
	{
		const profile = gamificationProfile({ totalXp: totalXpForLevel(7) + 95, streak: 12, unlocked: ["khai-khau", "kien-tri"] });
		const data = buildRankCardData({
			displayName: "Anh A",
			avatar: AVATAR_BYTES,
			activity: { userId: USER_A, level: profile.level, rank: 3, totalRanked: 37 },
			contribution: { userId: USER_A, score: 86, rank: 4, totalRanked: 21, contributions: 12 },
			gamification: profile,
			teamNames: ["Backend"],
		});
		assert.deepEqual(data, {
			displayName: "Anh A",
			avatar: AVATAR_BYTES,
			level: profile.level,
			tierSet: DEFAULT_TIER_SET,
			tier: tierByKey("bac-3"),
			nextTier: tierByKey("bac-4"),
			activity: { rank: 3, totalRanked: 37, weeklyXp: 1240, weeklyRank: 2 },
			contribution: { score: 86, rank: 4, totalRanked: 21, contributions: 12 },
			streak: { current: 12, best: 12, activeToday: true },
			achievements: { unlocked: 2, total: ACHIEVEMENTS.length },
			teamNames: ["Backend"],
		});
	});

	test("cảnh giới, chuỗi ngày, huy hiệu đã đạt và huy hiệu sắp đạt", () =>
	{
		const text = rankSummaryText(gamificationProfile({
			totalXp: totalXpForLevel(7),
			streak: 12,
			unlocked: ["khai-khau", "duoc-cong-nhan"],
			current: { "kien-tri": 5, "hoat-ngon": 700 },
		}));
		assert.equal(text, [
			"🟡 Cảnh giới **Kim Đan** · Level 7",
			"🔥 Chuỗi 12 ngày",
			"💬 Khai Khẩu · 🌟 Được Công Nhận",
			"🎯 Sắp đạt: 🔥 Kiên Trì (5/7)",
		].join("\n"));
	});

	test("chuỗi 0 thì không có dòng chuỗi; chưa có huy hiệu thì có lời động viên", () =>
	{
		const text = rankSummaryText(gamificationProfile());
		assert.equal(text, ["🌱 Cảnh giới **Luyện Khí** · Level 0", NO_BADGE_TEXT, "🎯 Sắp đạt: 💬 Khai Khẩu (0/100)"].join("\n"));
		assert.ok(!NO_BADGE_TEXT.includes("tu luyện"), "lời động viên trung tính, hợp mọi bộ");
	});

	test("dòng bậc theo bộ danh hiệu của hồ sơ: tên gọi bậc, tên và emoji (kể cả tuỳ chỉnh)", () =>
	{
		const expected: Record<string, string> = {
			"tu-tien": "🟡 Cảnh giới **Kim Đan** · Level 7",
			"rank-game": "🟡 Hạng **Vàng** · Level 7",
			"kiem-hiep": "🛡️ Danh hiệu **Hiệp Sĩ** · Level 7",
			"cay-xanh": "🌿 Giai đoạn **Cây Non** · Level 7",
			"vu-tru": "🌍 Thiên thể **Hành Tinh** · Level 7",
			"mobile-legends": "🦁 Rank **Cao Thủ** · Level 7",
		};
		for (const set of Object.values(TIER_SETS))
		{
			const [first] = rankSummaryText(gamificationProfile({ totalXp: totalXpForLevel(7), tierSet: set })).split("\n");
			assert.equal(first, expected[set.key], set.key);
		}
		const renamed = applyTierOverrides(TIER_SETS["rank-game"], [{ tierKey: "bac-3", name: "Vàng Son", emoji: "🥇" }]);
		const [line] = rankSummaryText(gamificationProfile({ totalXp: totalXpForLevel(7), tierSet: renamed })).split("\n");
		assert.equal(line, "🥇 Hạng **Vàng Son** · Level 7");
	});

	test("quá 6 huy hiệu thì ghi \"+k\"; sắp đạt hoà tỉ lệ thì theo thứ tự huy hiệu", () =>
	{
		const keys = ACHIEVEMENTS.slice(0, 8).map(achievement => achievement.key);
		const text = rankSummaryText(gamificationProfile({ unlocked: keys, current: { "tri-am": 5, "cong-dan-guong-mau": 1, "ba-nhac": 25 } }));
		const lines = text.split("\n");
		const shown = ACHIEVEMENTS.slice(0, 6).map(achievement => `${achievement.emoji} ${achievement.name}`);
		assert.equal(lines[1], [...shown, "+2"].join(" · "));
		assert.equal(lines[2], "🎯 Sắp đạt: 🤝 Tri Âm (5/10)", "Tri Âm và Bá Nhạc cùng 50%, Tri Âm đứng trước");
	});

	test("đạt hết huy hiệu thì không còn dòng sắp đạt", () =>
	{
		const text = rankSummaryText(gamificationProfile({ unlocked: ACHIEVEMENTS.map(achievement => achievement.key), streak: 1 }));
		assert.ok(!text.includes("🎯"));
		assert.ok(text.endsWith(`+${ACHIEVEMENTS.length - 6}`));
	});
});

// ---------- Lệnh /leaderboard và nút (service thật trên SQLite :memory:) ----------

interface Calls
{
	deferReply: unknown[];
	deferUpdate: number;
	edits: InteractionEditReplyOptions[];
	replies: InteractionReplyOptions[];
	followUps: InteractionReplyOptions[];
}

function newCalls(): Calls
{
	return { deferReply: [], deferUpdate: 0, edits: [], replies: [], followUps: [] };
}

/** Số lần interaction đã được phản hồi theo bất kỳ cách nào (defer, reply, sửa, followUp). */
function responseCount(calls: Calls): number
{
	return calls.deferReply.length + calls.deferUpdate + calls.edits.length + calls.replies.length + calls.followUps.length;
}

interface RoleInfo
{
	name: string;
	colors: { primaryColor: number };
}

function fakeGuild(roles: Record<string, RoleInfo> = {}): unknown
{
	return { id: GUILD, roles: { cache: new Map(Object.entries(roles)) } };
}

function recorder(calls: Calls): Record<string, unknown>
{
	return {
		deferReply: (options: unknown) =>
		{
			calls.deferReply.push(options);
			return Promise.resolve();
		},
		deferUpdate: () =>
		{
			calls.deferUpdate++;
			return Promise.resolve();
		},
		editReply: (payload: InteractionEditReplyOptions) =>
		{
			calls.edits.push(payload);
			return Promise.resolve();
		},
		reply: (payload: InteractionReplyOptions) =>
		{
			calls.replies.push(payload);
			return Promise.resolve();
		},
		followUp: (payload: InteractionReplyOptions) =>
		{
			calls.followUps.push(payload);
			return Promise.resolve();
		},
	};
}

interface CommandOptions
{
	userId?: string;
	strings?: Record<string, string>;
	integers?: Record<string, number>;
	canSend?: boolean;
	canAttach?: boolean;
	guild?: unknown;
}

function fakeCommand(options: CommandOptions = {}): { interaction: ChatInputCommandInteraction; calls: Calls }
{
	const calls = newCalls();
	const interaction = {
		inGuild: () => true,
		guildId: GUILD,
		guild: options.guild ?? fakeGuild(),
		user: { id: options.userId ?? USER_A },
		member: null,
		memberPermissions: new PermissionsBitField(options.canSend === false ? [] : [PermissionFlagsBits.SendMessages]),
		appPermissions: new PermissionsBitField(options.canAttach === false ? [] : [PermissionFlagsBits.AttachFiles]),
		channel: { isThread: () => false },
		options: {
			getString: (name: string) => options.strings?.[name] ?? null,
			getInteger: (name: string) => options.integers?.[name] ?? null,
		},
		...recorder(calls),
	};
	return { interaction: interaction as unknown as ChatInputCommandInteraction, calls };
}

function fakeButton(customId: string, userId: string, guild: unknown = fakeGuild()): { interaction: ButtonInteraction; calls: Calls }
{
	const calls = newCalls();
	const interaction = { customId, inGuild: () => true, guildId: GUILD, guild, user: { id: userId }, ...recorder(calls) };
	return { interaction: interaction as unknown as ButtonInteraction, calls };
}

interface Harness extends TestContext
{
	services: AppServices;
	command: LeaderboardCmd;
	gate: RenderGate;
	rendered: LeaderboardCardData[];
	resolved: string[][];
	avatarUrls: (string | null)[];
}

function harness(render: (data: LeaderboardCardData) => Promise<RenderedCard> = () => Promise.resolve(FAKE_CARD)): Harness
{
	const context = createTestContext();
	context.clock.current = NOW;
	const services = createServices(context.db, { clock: context.clock, backupDir: "khong-dung", backupKeep: 1 });
	const resolved: string[][] = [];
	const avatarUrls: (string | null)[] = [];
	const gate = new RenderGate({ now: () => context.clock.now() });
	const client = {
		services,
		guildIds: [GUILD],
		user: { id: BOT_ID },
		renderGate: gate,
		members: {
			resolve: (_guild: unknown, userIds: readonly string[]) =>
			{
				resolved.push([...userIds]);
				return Promise.resolve(new Map(userIds.map(id => [id, {
					displayName: `Tên ${id.slice(-3)}`,
					avatarUrl: `https://cdn.discordapp.com/avatars/${id}/a.png`,
					inGuild: true,
				}])));
			},
		},
		avatars: {
			get: (url: string | null) =>
			{
				avatarUrls.push(url);
				return Promise.resolve(url?.includes(USER_A) ? AVATAR_BYTES : null);
			},
		},
	} as unknown as DiscordClient;

	const rendered: LeaderboardCardData[] = [];
	const command = new LeaderboardCmd(client);
	command.renderCard = data =>
	{
		rendered.push(data);
		return render(data);
	};
	return { ...context, services, command, gate, rendered, resolved, avatarUrls };
}

function seedXp(context: TestContext, userId: string, amount: number): void
{
	context.deps.xpLedger.record({ guildId: GUILD, userId, amount, source: "message" });
}

function seedContribution(context: TestContext, userId: string, amount: number): void
{
	context.deps.contributionLedger.record({ guildId: GUILD, userId, amount, source: "admin", actorId: ADMIN });
}

function seededIds(count: number, prefix = "3000000000000002"): string[]
{
	return Array.from({ length: count }, (_, index) => `${prefix}${String(index).padStart(2, "0")}`);
}

function onlyFile(payload: InteractionEditReplyOptions): AttachmentBuilder
{
	assert.equal(payload.files?.length, 1);
	const [file] = payload.files ?? [];
	assert.ok(file instanceof AttachmentBuilder);
	return file;
}

function onlyEmbed(payload: InteractionEditReplyOptions): APIEmbed
{
	assert.equal(payload.embeds?.length, 1);
	const [embed] = payload.embeds ?? [];
	assert.ok(embed instanceof EmbedBuilder);
	return embed.toJSON();
}

describe("/leaderboard: ảnh và nút", () =>
{
	test("lệnh: ảnh bảng theo kỳ đã chọn, tên và avatar của người trong trang, ba hàng nút của chủ bảng", async () =>
	{
		const h = harness();
		seedXp(h, USER_A, 500);
		seedXp(h, USER_B, 800);
		const { interaction, calls } = fakeCommand({ strings: { ky: "tuan" } });
		await h.command.execute(interaction);

		assert.deepEqual(calls.deferReply, [undefined], "được gửi tin và bot có Attach Files thì trả lời công khai");
		assert.equal(calls.edits.length, 1);
		const [payload] = calls.edits;
		assert.equal(onlyFile(payload).name, "leaderboard.png");
		assert.deepEqual(payload.embeds, []);
		assert.deepEqual(payload.attachments, []);

		assert.equal(h.rendered.length, 1);
		const [data] = h.rendered;
		assert.equal(data.subtitle, "Cá nhân · Tuần này (từ 28/09)");
		assert.deepEqual(data.rows.map(row => [row.rank, row.name, row.value, row.highlight, row.avatar]), [
			[1, `Tên ${USER_B.slice(-3)}`, "800 XP", false, null],
			[2, `Tên ${USER_A.slice(-3)}`, "500 XP", true, AVATAR_BYTES],
		]);
		assert.deepEqual(h.resolved, [[USER_B, USER_A]]);
		assert.equal(h.avatarUrls.length, 2);

		const rows = buttonRows(payload.components);
		assert.equal(findButton(rows, "Tuần").disabled, true);
		assert.equal(findButton(rows, "Tổng").id, `lb:v:a:i:all:1:${USER_A}`);
	});

	test("lệnh: người không được gửi tin, hoặc bot thiếu Attach Files, thì nhận bảng riêng", async () =>
	{
		for (const options of [{ canSend: false }, { canAttach: false }])
		{
			const h = harness();
			const { interaction, calls } = fakeCommand(options);
			await h.command.execute(interaction);
			assert.deepEqual(calls.deferReply, [{ flags: MessageFlags.Ephemeral }]);
			assert.equal(calls.edits.length, 1);
		}
	});

	test("bậc trên ảnh theo bộ danh hiệu guild đang dùng, đọc lại mỗi lần vẽ: đổi tên bậc thì lần bấm nút sau thấy ngay", async () =>
	{
		const h = harness();
		seedXp(h, USER_A, 500);
		h.services.tierSets.select(GUILD, "rank-game", ADMIN);
		await h.command.execute(fakeCommand({ strings: { ky: "tuan" } }).interaction);
		assert.deepEqual(h.rendered[0].rows.map(row => [row.tier?.setKey, row.tier?.key, row.tier?.name]), [["rank-game", "bac-2", "Bạc"]]);

		h.services.tierSets.rename(GUILD, [{ tierKey: "bac-2", name: "Bạc Ròng", emoji: null }], ADMIN);
		h.clock.advanceSeconds(5);
		const view = boardViewId({ kind: "activity", scope: "individual", period: "week", page: 1, ownerId: USER_A });
		await h.command.executeButton(fakeButton(view, USER_A).interaction);
		assert.equal(h.rendered.length, 2);
		assert.equal(h.rendered[1].rows[0].tier?.name, "Bạc Ròng");
	});

	test("bảng team: tên và màu role từ server", async () =>
	{
		const h = harness();
		h.services.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		h.deps.xpLedger.record({ guildId: GUILD, userId: USER_A, amount: 300, source: "message", teamRoleIds: [ROLE_BACKEND] });
		const guild = fakeGuild({ [ROLE_BACKEND]: { name: "Backend", colors: { primaryColor: 0x3498db } } });
		const { interaction } = fakeCommand({ strings: { "pham-vi": "team" }, guild });
		await h.command.execute(interaction);

		assert.deepEqual(h.rendered[0].rows.map(row => [row.name, row.accentColor, row.value]), [["Backend", "#3498db", "300 XP"]]);
		assert.deepEqual(h.resolved, [], "bảng team không tra thành viên");
		assert.equal(h.rendered[0].tierSet.key, "tu-tien");

		h.services.tierSets.select(GUILD, "vu-tru", ADMIN);
		h.clock.advanceSeconds(5);
		await h.command.execute(fakeCommand({ strings: { "pham-vi": "team" }, guild }).interaction);
		assert.equal(h.rendered[1].tierSet.key, "vu-tru", "bảng team trang trí theo bộ danh hiệu guild đang dùng");
	});

	test("chủ bảng bấm nút: sửa chính message đó, thay ảnh cũ bằng ảnh mới", async () =>
	{
		const h = harness();
		seededIds(15).forEach((id, index) => seedXp(h, id, 1000 - index));
		const { interaction, calls } = fakeButton(`lb:v:a:i:all:2:${USER_A}`, USER_A);
		await h.command.executeButton(interaction);

		assert.equal(calls.deferUpdate, 1);
		assert.deepEqual(calls.deferReply, []);
		assert.equal(calls.edits.length, 1);
		const [payload] = calls.edits;
		assert.deepEqual(payload.attachments, [], "bỏ ảnh cũ");
		assert.equal(onlyFile(payload).name, "leaderboard.png");
		assert.equal(h.rendered[0].footer, "Trang 2/2 · 15 người");
		assert.deepEqual(h.rendered[0].rows.map(row => row.rank), [11, 12, 13, 14, 15]);
		const rows = buttonRows(payload.components);
		assert.equal(findButton(rows, "▶").disabled, true);
		assert.equal(findButton(rows, "◀").id, `lb:v:a:i:all:1:${USER_A}`);
	});

	test("trang quá xa được kẹp về trang cuối", async () =>
	{
		const h = harness();
		seedXp(h, USER_A, 10);
		const { interaction, calls } = fakeButton(`lb:v:a:i:all:999999:${USER_A}`, USER_A);
		await h.command.executeButton(interaction);
		assert.ok(findButton(buttonRows(calls.edits[0].components), "Trang 1/1"));
	});

	test("người khác bấm nút: không đụng message của chủ bảng, nhận riêng bảng mới do mình làm chủ", async () =>
	{
		const h = harness();
		seedContribution(h, USER_A, 5);
		seedContribution(h, USER_B, 3);
		const { interaction, calls } = fakeButton(`lb:v:c:i:m:1:${USER_A}`, USER_B);
		await h.command.executeButton(interaction);

		assert.equal(calls.deferUpdate, 0);
		assert.deepEqual(calls.deferReply, [{ flags: MessageFlags.Ephemeral }]);
		assert.equal(calls.edits.length, 1);
		assert.deepEqual(h.rendered[0].rows.map(row => [row.value, row.highlight]), [["5 điểm", false], ["3 điểm", true]]);
		const rows = buttonRows(calls.edits[0].components);
		assert.equal(findButton(rows, "Hạng của tôi").id, `lb:me:c:m:${USER_B}`);
		assert.equal(findButton(rows, "Tổng").id, `lb:v:c:i:all:1:${USER_B}`);
	});

	test("\"Hạng của tôi\": nhảy tới trang có người bấm", async () =>
	{
		const h = harness();
		const others = seededIds(25);
		others.forEach((id, index) => seedXp(h, id, 1000 - index));
		seedXp(h, USER_A, 970);
		const { interaction, calls } = fakeButton(`lb:me:a:all:${USER_A}`, USER_A);
		await h.command.executeButton(interaction);

		assert.equal(calls.deferUpdate, 1);
		assert.equal(h.rendered[0].footer, "Trang 3/3 · 26 người");
		assert.ok(h.rendered[0].rows.some(row => row.highlight));
	});

	test("\"Hạng của tôi\": nhóm hoà điểm tràn sang trang sau thì vẫn tìm đúng trang", async () =>
	{
		const h = harness();
		[USER_A, USER_B, USER_C].forEach(id => seedContribution(h, id, 5));
		const tied = seededIds(25);
		tied.forEach(id => seedContribution(h, id, 1));
		const viewer = tied[24];
		const { interaction, calls } = fakeButton(`lb:me:c:all:${USER_A}`, viewer);
		await h.command.executeButton(interaction);

		assert.deepEqual(calls.deferReply, [{ flags: MessageFlags.Ephemeral }], "người khác bấm thì nhận bảng riêng");
		const data = h.rendered.at(-1);
		assert.equal(data?.footer, "Trang 3/3 · 28 người");
		assert.deepEqual(data?.rows.filter(row => row.highlight).map(row => row.rank), [4]);
	});

	test("\"Hạng của tôi\" trên bảng của người khác khi chưa có điểm: defer riêng rồi báo trong chính phản hồi riêng đó", async () =>
	{
		const h = harness();
		seedXp(h, USER_B, 100);
		const { interaction, calls } = fakeButton(`lb:me:a:w:${USER_B}`, USER_A);
		await h.command.executeButton(interaction);

		assert.deepEqual(calls.deferReply, [{ flags: MessageFlags.Ephemeral }]);
		assert.deepEqual(calls.edits, [{ content: NO_STANDING }]);
		assert.equal(calls.deferUpdate, 0);
		assert.deepEqual(calls.replies, []);
		assert.deepEqual(calls.followUps, []);
		assert.equal(h.rendered.length, 0);
	});

	test("\"Hạng của tôi\" trên bảng của mình khi chưa có điểm: deferUpdate, không đổi message, báo riêng bằng followUp", async () =>
	{
		const h = harness();
		seedXp(h, USER_B, 100);
		const { interaction, calls } = fakeButton(`lb:me:a:w:${USER_A}`, USER_A);
		await h.command.executeButton(interaction);

		assert.equal(calls.deferUpdate, 1);
		assert.deepEqual(calls.followUps, [{ content: NO_STANDING, flags: MessageFlags.Ephemeral }]);
		assert.deepEqual(calls.edits, [], "không sửa message của bảng");
		assert.deepEqual(calls.deferReply, []);
		assert.equal(h.rendered.length, 0);
	});

	test("\"Hạng của tôi\": defer trước khi đọc dữ liệu; chỉ tính vị trí một lần và không dò từng trang", async (t) =>
	{
		const h = harness();
		seedXp(h, USER_B, 100);
		seedXp(h, USER_A, 50);
		const { interaction, calls } = fakeButton(`lb:me:a:m:${USER_A}`, USER_A);
		const deferredAtPosition: number[] = [];
		const position = t.mock.method(h.services.leaderboard, "userPosition", (guildId: string, kind: ScoreKind, period: LeaderboardPeriod, userId: string) =>
		{
			deferredAtPosition.push(calls.deferUpdate);
			assert.deepEqual([guildId, kind, period, userId], [GUILD, "activity", "month", USER_A]);
			return 1;
		});
		const query = t.mock.method(h.services.leaderboard, "query");
		const standing = t.mock.method(h.services.leaderboard, "userStanding");
		await h.command.executeButton(interaction);

		assert.deepEqual(deferredAtPosition, [1], "đã deferUpdate trước khi tính vị trí");
		assert.equal(position.mock.callCount(), 1);
		assert.equal(query.mock.callCount(), 1, "chỉ lấy đúng trang để vẽ");
		assert.equal(standing.mock.callCount(), 0);
		assert.deepEqual(h.rendered[0].rows.map(row => [row.rank, row.highlight]), [[1, false], [2, true]]);
	});

	test("\"Hạng của tôi\": nhóm 2000 người hoà điểm ở kỳ tháng, người cuối nhóm bấm → đúng trang, dưới 1 giây", async () =>
	{
		const h = harness();
		const tied = Array.from({ length: 2000 }, (_, index) => `3200000000000${String(index).padStart(5, "0")}`);
		h.db.transaction(() =>
		{
			for (const userId of tied) seedXp(h, userId, 10);
		})();
		seedXp(h, USER_A, 500);
		const viewer = tied[tied.length - 1];
		const { interaction, calls } = fakeButton(`lb:me:a:m:${viewer}`, viewer);

		const started = performance.now();
		await h.command.executeButton(interaction);
		const elapsed = performance.now() - started;

		// Ngưỡng rộng (máy bận có thể chậm vài lần); lỗi cần bắt là quét lặp cỡ vài giây (LL-017).
		assert.ok(elapsed < 1000, `mất ${elapsed.toFixed(1)} ms`);
		assert.equal(calls.deferUpdate, 1);
		const data = h.rendered.at(-1);
		assert.equal(data?.footer, "Trang 201/201 · 2.001 người");
		assert.deepEqual(data?.rows.filter(row => row.highlight).map(row => row.rank), [2], "hoà điểm: cùng hạng 2");
		assert.ok(findButton(buttonRows(calls.edits[0].components), "Trang 201/201"));
	});

	test("nút sai định dạng: báo lỗi cho người dùng, không đổi gì", async () =>
	{
		const h = harness();
		const { interaction, calls } = fakeButton("lb:v:a:i:all:1:khong-phai-id", USER_A);
		await assert.rejects(h.command.executeButton(interaction), isUserError(INVALID_BOARD_BUTTON));
		assert.equal(calls.deferUpdate + calls.deferReply.length + calls.edits.length, 0);
	});

	test("cooldown 3 giây theo người (dùng chung cho lệnh và nút): bị chặn thì báo lỗi riêng trước khi defer, không đổi message", async () =>
	{
		const h = harness();
		seedXp(h, USER_A, 10);
		const first = fakeCommand();
		await h.command.execute(first.interaction);
		assert.equal(first.calls.edits.length, 1);

		h.clock.advance(1200);
		const button = fakeButton(`lb:v:a:i:w:1:${USER_A}`, USER_A);
		await assert.rejects(h.command.executeButton(button.interaction), isUserError(cooldownMessage(1800)));
		assert.equal(cooldownMessage(1800), "Bạn thao tác nhanh quá, thử lại sau 2 giây nhé.");
		assert.equal(responseCount(button.calls), 0, "không defer, không sửa message");

		const again = fakeCommand();
		await assert.rejects(h.command.execute(again.interaction), isUserError(cooldownMessage(1800)));
		assert.equal(responseCount(again.calls), 0);

		const other = fakeButton(`lb:v:a:i:w:1:${USER_A}`, USER_B);
		await h.command.executeButton(other.interaction);
		assert.equal(other.calls.edits.length, 1, "người khác không bị ảnh hưởng");

		h.clock.advance(1800);
		const later = fakeButton(`lb:v:a:i:w:1:${USER_A}`, USER_A);
		await h.command.executeButton(later.interaction);
		assert.equal(later.calls.deferUpdate, 1, "hết 3 giây thì dùng lại được");
		assert.equal(h.rendered.length, 3);
	});

	test("nút sai định dạng hoặc option không hợp lệ không tính vào cooldown", async () =>
	{
		const h = harness();
		await assert.rejects(h.command.executeButton(fakeButton("lb:v:a:i:all:1:sai", USER_A).interaction), isUserError(INVALID_BOARD_BUTTON));
		await assert.rejects(h.command.execute(fakeCommand({ strings: { ky: "nam" } }).interaction), UserError);
		assert.equal(h.gate.trackedUsers, 0);
		const ok = fakeCommand();
		await h.command.execute(ok.interaction);
		assert.equal(ok.calls.edits.length, 1);
	});

	test("vẽ ảnh đi qua semaphore: ba người gọi cùng lúc thì tối đa 2 lần vẽ chạy đồng thời", async () =>
	{
		let active = 0;
		let peak = 0;
		const h = harness(async () =>
		{
			active++;
			peak = Math.max(peak, active);
			await new Promise(resolve => setTimeout(resolve, 15));
			active--;
			return FAKE_CARD;
		});
		seedXp(h, USER_A, 10);
		const runs = [USER_A, USER_B, USER_C].map(userId => fakeCommand({ userId }));
		await Promise.all(runs.map(run => h.command.execute(run.interaction)));

		assert.equal(peak, 2);
		assert.equal(h.rendered.length, 3);
		for (const run of runs) assert.equal(onlyFile(run.calls.edits[0]).name, "leaderboard.png");
		assert.equal(h.gate.activeRenders, 0);
	});

	test("vẽ ảnh lỗi: embed cũ có ghi kỳ, vẫn kèm nút, bỏ ảnh cũ", async (t) =>
	{
		const logged = t.mock.method(console, "error", () => undefined);
		const h = harness(() => Promise.reject(new Error("canvas hỏng")));
		seedXp(h, USER_A, 120);
		const { interaction, calls } = fakeButton(`lb:v:a:i:w:1:${USER_A}`, USER_A);
		await h.command.executeButton(interaction);

		const [payload] = calls.edits;
		const embed = onlyEmbed(payload);
		assert.equal(embed.title, "🏆 Bảng xếp hạng Activity XP — Cá nhân · Tuần này");
		assert.equal(embed.description, `🥇 <@${USER_A}> — 120 XP`);
		assert.deepEqual(payload.files, []);
		assert.deepEqual(payload.attachments, []);
		assert.equal(buttonRows(payload.components).length, 3);
		assert.equal(logged.mock.callCount(), 1);
		assert.match(String(logged.mock.calls[0].arguments[0]), /\[ERROR\]/);
	});
});
