// Test nút "❓" của /rank và lệnh /rank-style (DEC-047): lời giải thích dựng từ cấu hình thật, giới hạn ký tự của Components V2,
// customId, câu trả lời của /rank-style. Lệnh chạy với service thật trên SQLite :memory:.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	ApplicationCommandOptionType,
	ButtonInteraction,
	ChatInputCommandInteraction,
	Collection,
	ComponentType,
	ContainerBuilder,
	GuildMember,
	InteractionReplyOptions,
	MessageFlags,
	PermissionFlagsBits,
	PermissionsBitField,
} from "discord.js";
import type Command from "../src/classes/Command";
import type DiscordClient from "../src/classes/DiscordClient";
import ButtonHandler from "../src/handlers/ButtonHandler";
import { openDatabase } from "../src/db/connection";
import { runMigrations } from "../src/db/migrations";
import {
	achievementLines,
	COMPONENTS_V2_TEXT_MAX,
	durationText,
	fitTextSections,
	INVALID_RANK_HELP_BUTTON,
	parseRankHelpId,
	RANK_HELP_ID,
	RANK_HELP_NAMESPACE,
	RANK_STYLE_SERVER_CHOICE,
	rankHelpReply,
	rankHelpSections,
	RankHelpData,
	rankStyleChoices,
	rankStyleResultText,
	tierDisplayLabel,
} from "../src/discord/views/rank";
import RankCmd from "../src/interactions/commands/rank";
import RankStyleCmd, { parseRankStyleChoice } from "../src/interactions/commands/rankStyle";
import { LEVEL_FORMULA_TEXT, totalXpForLevel, xpToNextLevel } from "../src/modules/activity/levels";
import { applyTierOverrides, DEFAULT_TIER_SET, TIER_KEYS, TIER_SET_KEYS, TIER_SETS, TierSet } from "../src/modules/activity/tiers";
import { ACHIEVEMENTS } from "../src/modules/gamification/achievements";
import {
	INVALID_TIER_SET_KEY,
	MemberTierDisplay,
	normalizeTierEmoji,
	normalizeTierName,
	PERSONAL_TIER_DISABLED,
} from "../src/modules/gamification/TierSetService";
import { ChannelSettings, DEFAULT_GUILD_SETTINGS, GuildSettings, SETTING_LIMITS } from "../src/modules/guild-config/types";
import { AppServices, createServices } from "../src/services";
import { UserError } from "../src/shared/errors";
import { ADMIN, CHANNEL_BOT, CHANNEL_GENERAL, FakeClock, GUILD, USER_A, USER_B } from "./helpers";

/** Số component tối đa của một message Components V2 (tính cả component lồng nhau). */
const COMPONENTS_V2_MAX = 40;

function userError(message: string): (error: unknown) => boolean
{
	return (error: unknown): boolean => error instanceof UserError && error.message === message;
}

function serverDisplay(set: TierSet = DEFAULT_TIER_SET, allowPersonal = true): MemberTierDisplay
{
	return { set, source: "server", choiceKey: null, allowPersonal, serverSet: set };
}

function helpData(overrides: Partial<RankHelpData> = {}): RankHelpData
{
	return { settings: { ...DEFAULT_GUILD_SETTINGS }, channels: [], display: serverDisplay(), ...overrides };
}

function helpText(data: RankHelpData): string
{
	return rankHelpSections(data).join("\n");
}

function totalLength(sections: readonly string[]): number
{
	return sections.reduce((sum, section) => sum + section.length, 0);
}

function channel(channelId: string, patch: Partial<ChannelSettings> = {}): ChannelSettings
{
	return { channelId, xpEnabled: true, xpPerMessage: null, xpCooldownSeconds: null, ...patch };
}

/** Đếm component (kể cả lồng nhau) của một khung Components V2. */
function componentCount(container: ContainerBuilder): number
{
	const json = container.toJSON();
	return 1 + json.components.reduce((sum, child) => sum + (child.type === ComponentType.Section ? 1 + child.components.length + 1 : 1), 0);
}

/** Chữ của mọi TextDisplay trong một phản hồi Components V2. */
function replyTexts(reply: InteractionReplyOptions): string[]
{
	const [top, ...rest] = reply.components ?? [];
	assert.equal(rest.length, 0);
	assert.ok(top instanceof ContainerBuilder);
	return top.toJSON().components.flatMap(child => (child.type === ComponentType.TextDisplay ? [child.content] : []));
}

describe("lời giải thích của nút ❓ (DEC-047)", () =>
{
	test("cấu hình mặc định: XP mỗi tin, cooldown, độ dài tối thiểu, chống trùng, mọi kênh, level, bậc, huy hiệu, contribution, vote, mẹo, /rank-style", () =>
	{
		const text = helpText(helpData());
		for (const expected of [
			"Mỗi tin nhắn hợp lệ được **10 XP**",
			"Cooldown **1 phút**",
			"**tất cả kênh** bot xem được.",
			"tin ngắn hơn **5 ký tự**",
			"trùng một tin bạn đã gửi trong **5 phút** gần đây",
			"tin gửi khi còn cooldown",
			"tin của bot",
			"Tin chỉ có ảnh hoặc file vẫn được tính",
			"thread và bài trong forum tính theo kênh cha",
			`cần **${LEVEL_FORMULA_TEXT} XP**`,
			`Lv 5: ${totalXpForLevel(5).toLocaleString("vi-VN")}`,
			"### 🏅 Cảnh giới: bộ Tu tiên (bộ của server)",
			"🌱 **Luyện Khí** · Level 0",
			`⚡ **Độ Kiếp** · Level 40 (${totalXpForLevel(40).toLocaleString("vi-VN")} XP)`,
			"Chuỗi ngày: số ngày liên tiếp (giờ Việt Nam)",
			"💬 Khai Khẩu · 🗣️ Hoạt Ngôn · 📢 Thao Thao Bất Tuyệt: 100 / 1.000 / 10.000 tin được XP",
			"`/leaderboard` có bảng tuần",
			"`/contribution submit`",
			"**Ghi nhận đóng góp**",
			"tác giả được **1 điểm**",
			"Không tự ghi nhận cho mình",
			"lần đầu được **5 XP**",
			"Tối đa **25 XP** từ vote mỗi ngày",
			"### 💡 Mẹo cày hợp lệ",
			"Spam, gửi lại tin cũ hay tin quá ngắn không được tính",
			"`/rank-style`",
			"Bạn đang dùng: **Tu tiên** (theo server).",
		])
		{
			assert.ok(text.includes(expected), `thiếu: ${expected}\n---\n${text}`);
		}
		assert.ok(!text.includes("Một số kênh có XP hoặc cooldown riêng"));
		assert.ok(!text.includes("Tin nhắn hiện **không được XP**"));
	});

	test("số theo cấu hình thật của server; giá trị 0 đổi câu cho đúng nghĩa", () =>
	{
		const custom: GuildSettings = { ...DEFAULT_GUILD_SETTINGS, xpPerMessage: 15, xpCooldownSeconds: 45, minMessageLength: 8, duplicateWindowSeconds: 7200, defaultPollXp: 12, pollXpDailyCap: 40, contributionVotePoints: 3 };
		const text = helpText(helpData({ settings: custom }));
		for (const expected of ["**15 XP**", "Cooldown **45 giây**", "**8 ký tự**", "trong **2 giờ** gần đây", "**12 XP**", "Tối đa **40 XP**", "được **3 điểm**"])
		{
			assert.ok(text.includes(expected), expected);
		}

		const zero: GuildSettings = { ...DEFAULT_GUILD_SETTINGS, xpPerMessage: 0, xpCooldownSeconds: 0, minMessageLength: 0, duplicateWindowSeconds: 0, defaultPollXp: 0, pollXpDailyCap: 0, contributionVotePoints: 0 };
		const zeroText = helpText(helpData({ settings: zero }));
		for (const expected of [
			"Tin nhắn hiện **không được XP**",
			"Không có cooldown",
			"Không được tính: tin của bot.",
			"Tham gia vote mặc định không được XP",
			"Không giới hạn XP từ vote mỗi ngày",
			"Lượt ghi nhận hiện không cộng điểm",
		])
		{
			assert.ok(zeroText.includes(expected), expected);
		}
		for (const absent of ["tin gửi khi còn cooldown", "ký tự**", "gần đây", "**0 XP**"]) assert.ok(!zeroText.includes(absent), absent);
	});

	test("chế độ kênh: 'chỉ kênh được bật' liệt kê kênh đang bật (mention, không ping), chưa bật kênh nào thì nói rõ; 'tất cả kênh' đếm kênh bị tắt", () =>
	{
		const selected: GuildSettings = { ...DEFAULT_GUILD_SETTINGS, xpChannelMode: "selected" };
		const none = helpText(helpData({ settings: selected, channels: [channel(CHANNEL_GENERAL, { xpEnabled: false })] }));
		assert.ok(none.includes("**chỉ các kênh admin bật riêng**"));
		assert.ok(none.includes("Hiện chưa bật kênh nào, nên tin nhắn chưa được XP."));

		const some = helpText(helpData({ settings: selected, channels: [channel(CHANNEL_GENERAL), channel(CHANNEL_BOT, { xpPerMessage: 20 })] }));
		assert.ok(some.includes(`Đang bật: <#${CHANNEL_GENERAL}>, <#${CHANNEL_BOT}>.`), some);
		assert.ok(some.includes("Một số kênh có XP hoặc cooldown riêng do admin đặt."));

		const many = Array.from({ length: 40 }, (_, index) => channel(`4000000000000${String(index).padStart(5, "0")}`));
		const manyText = helpText(helpData({ settings: selected, channels: many }));
		assert.match(manyText, /và 3\d kênh khác\./u);

		const all = helpText(helpData({ channels: [channel(CHANNEL_GENERAL, { xpEnabled: false }), channel(CHANNEL_BOT, { xpEnabled: false })] }));
		assert.ok(all.includes("**tất cả kênh** bot xem được, trừ 2 kênh admin đã tắt."));
		assert.ok(!all.includes("<#"), "chế độ tất cả kênh không liệt kê kênh");
	});

	test("bậc theo bộ hiển thị của người bấm (tên tuỳ chỉnh của server); công tắc tắt thì không nhắc /rank-style", () =>
	{
		const serverSet = TIER_SETS["rank-game"];
		const personal = applyTierOverrides(TIER_SETS["cay-xanh"], [{ tierKey: "bac-8", name: "Rừng Già", emoji: "🌲" }]);
		const display: MemberTierDisplay = { set: personal, source: "personal", choiceKey: "cay-xanh", allowPersonal: true, serverSet };
		const text = helpText(helpData({ display }));
		assert.ok(text.includes("### 🏅 Giai đoạn: bộ Cây xanh (bộ bạn tự chọn)"));
		assert.ok(text.includes("🌲 **Rừng Già** · Level 40"));
		assert.ok(text.includes("Role Discord, bảng xếp hạng và Bảng vàng dùng bộ của server (**Rank game**)."));
		assert.ok(text.includes("Bạn đang dùng: **Cây xanh** (tự chọn)."));
		assert.ok(!text.includes("Thách Đấu"), "không liệt kê bậc của bộ server");

		const disabled = helpText(helpData({ display: { ...serverDisplay(serverSet, false), choiceKey: "cay-xanh" } }));
		assert.ok(!disabled.includes("/rank-style"));
		assert.ok(!disabled.includes("Đổi kiểu hiển thị"));
		assert.ok(disabled.includes("### 🏅 Hạng: bộ Rank game (bộ của server)"));
	});

	test("huy hiệu: mọi huy hiệu đều có mặt, gộp theo chỉ số, ngưỡng lấy từ module gamification", () =>
	{
		const lines = achievementLines();
		assert.equal(lines.length, new Set(ACHIEVEMENTS.map(achievement => achievement.stat)).size);
		const joined = lines.join("\n");
		for (const achievement of ACHIEVEMENTS) assert.ok(joined.includes(`${achievement.emoji} ${achievement.name}`), achievement.name);
		assert.ok(joined.includes("🔥 Kiên Trì · 🧘 Chuyên Cần · 🏔️ Bách Nhật Bền Bỉ: 7 / 30 / 100 ngày liên tiếp"));
	});

	test("chữ công thức level khớp xpToNextLevel", () =>
	{
		assert.equal(LEVEL_FORMULA_TEXT, "5n² + 50n + 100");
		for (let n = 0; n <= 60; n++) assert.equal(xpToNextLevel(n), 5 * n * n + 50 * n + 100);
	});

	test("trường hợp dài nhất vẫn trong giới hạn 4000 ký tự của Components V2 và không bị cắt; ≤ 40 component", () =>
	{
		const longName = `${"Ặ".repeat(16)}${"𝔸".repeat(16)}`;
		const longEmoji = "👩‍👩‍👧‍👦";
		assert.equal(normalizeTierName(longName), longName, "tên bậc dài nhất vẫn hợp lệ");
		assert.equal(normalizeTierEmoji(longEmoji), longEmoji, "emoji dài nhất vẫn hợp lệ");
		const renamed = TIER_KEYS.map(tierKey => ({ tierKey, name: longName, emoji: longEmoji }));
		const worstSettings: GuildSettings = {
			...DEFAULT_GUILD_SETTINGS,
			xpPerMessage: SETTING_LIMITS.xpPerMessage.max,
			xpCooldownSeconds: SETTING_LIMITS.xpCooldownSeconds.max - 1,
			minMessageLength: SETTING_LIMITS.minMessageLength.max,
			duplicateWindowSeconds: SETTING_LIMITS.duplicateWindowSeconds.max - 1,
			defaultPollXp: SETTING_LIMITS.defaultPollXp.max,
			pollXpDailyCap: SETTING_LIMITS.pollXpDailyCap.max,
			contributionVotePoints: SETTING_LIMITS.contributionVotePoints.max,
			xpChannelMode: "selected",
		};
		const channels = Array.from({ length: 500 }, (_, index) => channel(`${"9".repeat(15)}${String(index).padStart(5, "0")}`, { xpPerMessage: 5 }));
		let longest = 0;
		for (const personalKey of TIER_SET_KEYS)
		{
			for (const serverKey of TIER_SET_KEYS)
			{
				const set = applyTierOverrides(TIER_SETS[personalKey], renamed);
				const serverSet = applyTierOverrides(TIER_SETS[serverKey], renamed);
				const display: MemberTierDisplay = { set, source: "personal", choiceKey: personalKey, allowPersonal: true, serverSet };
				const data = helpData({ settings: worstSettings, channels, display });
				const sections = rankHelpSections(data);
				longest = Math.max(longest, totalLength(sections));
				assert.ok(totalLength(sections) <= COMPONENTS_V2_TEXT_MAX, `${personalKey}/${serverKey}: ${totalLength(sections)} ký tự`);
				assert.equal(sections.length, 9, "đủ 9 phần, không phần nào bị bỏ");
				assert.ok(sections.every(section => !section.endsWith("…")), "không phần nào bị cắt");
				assert.ok(sections[8]?.endsWith("(tự chọn)."));
				const reply = rankHelpReply(data);
				const [container] = reply.components ?? [];
				assert.ok(container instanceof ContainerBuilder);
				assert.ok(componentCount(container) <= COMPONENTS_V2_MAX);
			}
		}
		assert.ok(longest > 3000, `trường hợp dài nhất đủ dài để có ý nghĩa (${longest})`);
	});

	test("chốt chặn tổng ký tự: phần vượt bị cắt kèm dấu …, các phần sau bị bỏ", () =>
	{
		assert.deepEqual(fitTextSections(["abc", "defgh", "ij"], 10), ["abc", "defgh", "ij"]);
		assert.deepEqual(fitTextSections(["abc", "defgh", "ij"], 6), ["abc", "de…"]);
		assert.deepEqual(fitTextSections(["abcdef", "gh"], 6), ["abcdef"]);
	});

	test("trả lời: chỉ người bấm thấy, Components V2, không ping ai, không kèm content hay embed", () =>
	{
		const reply = rankHelpReply(helpData({ settings: { ...DEFAULT_GUILD_SETTINGS, xpChannelMode: "selected" }, channels: [channel(CHANNEL_GENERAL)] }));
		assert.equal(reply.flags, MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
		assert.deepEqual(reply.allowedMentions, { parse: [] });
		assert.equal(reply.content, undefined);
		assert.equal(reply.embeds, undefined);
		const texts = replyTexts(reply);
		assert.equal(texts.length, 9);
		assert.ok(texts[0]?.startsWith("## ❓ Thẻ rank: các chỉ số và cách cày"));
		assert.ok(texts.every(text => text.length > 0));
	});

	test("durationText: giây, phút, giờ", () =>
	{
		assert.equal(durationText(0), "0 giây");
		assert.equal(durationText(45), "45 giây");
		assert.equal(durationText(60), "1 phút");
		assert.equal(durationText(90), "90 giây");
		assert.equal(durationText(300), "5 phút");
		assert.equal(durationText(7200), "2 giờ");
		assert.equal(durationText(86_399), "86.399 giây");
	});

	test("customId của nút: chỉ nhận đúng customId đã phát", () =>
	{
		assert.equal(RANK_HELP_ID, "rankhelp:show");
		assert.ok(RANK_HELP_ID.startsWith(`${RANK_HELP_NAMESPACE}:`));
		assert.doesNotThrow(() => parseRankHelpId(RANK_HELP_ID));
		for (const bad of ["rankhelp", "rankhelp:", "rankhelp:show:1", "rankhelp:other", `rankhelp:show:${USER_A}`, "lb:v:a:i:all:1:1"])
		{
			assert.throws(() => parseRankHelpId(bad), userError(INVALID_RANK_HELP_BUTTON), bad);
		}
	});
});

describe("câu chữ của /rank-style", () =>
{
	test("lựa chọn: 'Theo server (mặc định)' rồi mọi bộ theo thứ tự, tên kèm mô tả, trong giới hạn 100 ký tự", () =>
	{
		const choices = rankStyleChoices();
		assert.deepEqual(choices[0], { name: "Theo server (mặc định)", value: RANK_STYLE_SERVER_CHOICE });
		assert.deepEqual(choices.slice(1).map(choice => choice.value), [...TIER_SET_KEYS]);
		for (const choice of choices.slice(1))
		{
			const set = TIER_SETS[parseRankStyleChoice(choice.value) ?? "tu-tien"];
			assert.ok(choice.name.startsWith(`${set.name}: `), choice.name);
			assert.ok(choice.name.length <= 100, choice.name);
		}
		assert.ok(choices.some(choice => choice.name.includes("Hạt Giống → Đại Thụ Ngàn Năm")));
	});

	test("đọc lựa chọn: theo server = null, khoá bộ hợp lệ, còn lại UserError", () =>
	{
		assert.equal(parseRankStyleChoice(RANK_STYLE_SERVER_CHOICE), null);
		assert.equal(parseRankStyleChoice("cay-xanh"), "cay-xanh");
		for (const bad of ["", "pokemon", "Theo server", "TU-TIEN"]) assert.throws(() => parseRankStyleChoice(bad), userError(INVALID_TIER_SET_KEY), bad);
	});

	test("câu xác nhận và nhãn bộ hiển thị", () =>
	{
		const serverSet = TIER_SETS["tu-tien"];
		const personal: MemberTierDisplay = { set: TIER_SETS["cay-xanh"], source: "personal", choiceKey: "cay-xanh", allowPersonal: true, serverSet };
		assert.equal(rankStyleResultText(personal), "✅ Đã chọn bộ **Cây xanh** cho thẻ /rank và lời chúc lên level của bạn: 🌰 Hạt Giống → 🏞️ Đại Thụ Ngàn Năm.\n"
			+ "Role Discord, bảng xếp hạng và Bảng vàng vẫn theo bộ của server (**Tu tiên**).");
		assert.equal(rankStyleResultText(serverDisplay(serverSet)), "✅ Đã chuyển về bộ danh hiệu của server (**Tu tiên**).");
		assert.equal(rankStyleResultText(serverDisplay(serverSet, false)), `✅ Đã chuyển về bộ danh hiệu của server (**Tu tiên**).\n${PERSONAL_TIER_DISABLED}`);

		assert.equal(tierDisplayLabel(personal), "**Cây xanh** (tự chọn)");
		assert.equal(tierDisplayLabel(serverDisplay(serverSet)), "**Tu tiên** (theo server)");
		assert.equal(tierDisplayLabel({ ...serverDisplay(serverSet, false), choiceKey: "vu-tru" }), "**Tu tiên** (theo server; đã chọn Vũ trụ nhưng admin đang tắt tự chọn)");
	});
});

// ---------- Lệnh chạy với service thật ----------

let backupCounter = 0;

function realServices(): AppServices
{
	const db = openDatabase(":memory:");
	runMigrations(db);
	backupCounter += 1;
	return createServices(db, { clock: new FakeClock(), backupDir: path.join(tmpdir(), `rank-help-test-${process.pid}-${backupCounter}`), backupKeep: 1 });
}

function commandClient(services: AppServices): DiscordClient
{
	return { services, guildIds: [GUILD] } as unknown as DiscordClient;
}

interface Replies
{
	replies: InteractionReplyOptions[];
}

function styleInteraction(value: string, options: { userId?: string; inGuild?: boolean } = {}): { interaction: ChatInputCommandInteraction } & Replies
{
	const replies: InteractionReplyOptions[] = [];
	const interaction = {
		inGuild: () => options.inGuild ?? true,
		guildId: GUILD,
		user: { id: options.userId ?? USER_A },
		options: {
			getString: (name: string, required?: boolean) =>
			{
				if (name !== "bo" && required) throw new Error(`Thiếu option ${name}`);
				return value;
			},
		},
		reply: (payload: InteractionReplyOptions) =>
		{
			replies.push(payload);
			return Promise.resolve();
		},
	};
	return { interaction: interaction as unknown as ChatInputCommandInteraction, replies };
}

/**
 * Nút ❓ giả: `channelIds` là kênh có trong cache của server; người bấm là GuildMember xem được mọi kênh đó trừ `hiddenIds`
 * (kênh riêng tư với họ).
 */
function helpButton(customId: string, userId: string, channelIds: readonly string[] = [], hiddenIds: readonly string[] = []): { interaction: ButtonInteraction } & Replies
{
	const replies: InteractionReplyOptions[] = [];
	const cachedChannel = (id: string): object => ({
		id,
		permissionsFor: (): PermissionsBitField => new PermissionsBitField(hiddenIds.includes(id) ? [] : [PermissionFlagsBits.ViewChannel]),
	});
	const interaction = {
		inGuild: () => true,
		guildId: GUILD,
		customId,
		user: { id: userId },
		member: Object.setPrototypeOf({ id: userId, user: { id: userId } }, GuildMember.prototype) as GuildMember,
		guild: { id: GUILD, channels: { cache: new Map(channelIds.map(id => [id, cachedChannel(id)])) } },
		reply: (payload: InteractionReplyOptions) =>
		{
			replies.push(payload);
			return Promise.resolve();
		},
	};
	return { interaction: interaction as unknown as ButtonInteraction, replies };
}

describe("lệnh /rank-style (service thật)", () =>
{
	test("định nghĩa: tên, mô tả, option bo bắt buộc với đủ lựa chọn", () =>
	{
		const json = new RankStyleCmd(commandClient(realServices())).data.toJSON();
		assert.equal(json.name, "rank-style");
		assert.ok(json.description.length <= 100);
		const [option, ...rest] = json.options ?? [];
		assert.equal(rest.length, 0);
		assert.equal(option?.name, "bo");
		assert.equal(option?.type, ApplicationCommandOptionType.String);
		assert.equal(option?.required, true);
		assert.ok(option && option.description.length <= 100);
		assert.ok(option && "choices" in option);
		assert.deepEqual(option.choices?.map(choice => choice.value), [RANK_STYLE_SERVER_CHOICE, ...TIER_SET_KEYS]);
	});

	test("chọn bộ: lưu lựa chọn của chính người gọi, trả lời riêng kèm câu xác nhận, không ping; không ghi audit", async () =>
	{
		const services = realServices();
		services.tierSets.select(GUILD, "rank-game", ADMIN);
		const auditsBefore = services.audit.list(GUILD, 100).length;
		const command = new RankStyleCmd(commandClient(services));
		const { interaction, replies } = styleInteraction("cay-xanh");
		await command.execute(interaction);

		assert.equal(services.tierSets.memberChoice(GUILD, USER_A), "cay-xanh");
		assert.equal(services.tierSets.memberChoice(GUILD, USER_B), null);
		assert.equal(replies.length, 1);
		assert.equal(replies[0]?.flags, MessageFlags.Ephemeral);
		assert.deepEqual(replies[0]?.allowedMentions, { parse: [] });
		assert.equal(replies[0]?.content, rankStyleResultText(services.tierSets.displayFor(GUILD, USER_A)));
		assert.match(String(replies[0]?.content), /Cây xanh[\s\S]*Rank game/u);
		assert.equal(services.audit.list(GUILD, 100).length, auditsBefore, "thành viên tự chọn không ghi audit");

		const back = styleInteraction(RANK_STYLE_SERVER_CHOICE);
		await command.execute(back.interaction);
		assert.equal(services.tierSets.memberChoice(GUILD, USER_A), null);
		assert.equal(back.replies[0]?.content, "✅ Đã chuyển về bộ danh hiệu của server (**Rank game**).");
	});

	test("admin tắt tự chọn: chọn bộ bị từ chối (không lưu), về theo server vẫn được", async () =>
	{
		const services = realServices();
		const command = new RankStyleCmd(commandClient(services));
		await command.execute(styleInteraction("vu-tru").interaction);
		services.tierSets.setAllowPersonal(GUILD, false, ADMIN);

		const refused = styleInteraction("cay-xanh");
		await assert.rejects(command.execute(refused.interaction), userError(PERSONAL_TIER_DISABLED));
		assert.equal(refused.replies.length, 0);
		assert.equal(services.tierSets.memberChoice(GUILD, USER_A), "vu-tru", "lựa chọn cũ vẫn giữ");

		const back = styleInteraction(RANK_STYLE_SERVER_CHOICE);
		await command.execute(back.interaction);
		assert.equal(services.tierSets.memberChoice(GUILD, USER_A), null);
		assert.match(String(back.replies[0]?.content), /server đang dùng một bộ danh hiệu chung cho mọi người/u);
	});

	test("giá trị lạ hoặc ngoài server: báo lỗi, không lưu gì", async () =>
	{
		const services = realServices();
		const command = new RankStyleCmd(commandClient(services));
		await assert.rejects(command.execute(styleInteraction("pokemon").interaction), userError(INVALID_TIER_SET_KEY));
		await assert.rejects(command.execute(styleInteraction("cay-xanh", { inGuild: false }).interaction), UserError);
		assert.deepEqual(services.tierSets.choiceCounts(GUILD).filter(entry => entry.count > 0), []);
	});
});

describe("nút ❓ của /rank (service thật)", () =>
{
	test("khai báo namespace rankhelp; dispatcher định tuyến customId của nút về /rank", () =>
	{
		const services = realServices();
		const rank = new RankCmd(commandClient(services));
		assert.deepEqual(rank.buttonIds, [RANK_HELP_NAMESPACE]);
		const client = { interactions: { commands: new Collection<string, Command>([["rank", rank]]) } } as unknown as DiscordClient;
		const handler = new ButtonHandler(client);
		assert.equal(handler.resolve(RANK_HELP_ID), rank);
	});

	test("ai bấm cũng nhận lời giải thích riêng theo cấu hình thật và bộ hiển thị của chính người bấm", async () =>
	{
		const services = realServices();
		services.guildConfig.updateSettings(GUILD, { xpPerMessage: 7, xpCooldownSeconds: 30, minMessageLength: 3, duplicateWindowSeconds: 600, xpChannelMode: "selected", defaultPollXp: 9, pollXpDailyCap: 18, contributionVotePoints: 2 }, ADMIN);
		services.guildConfig.setChannel(GUILD, CHANNEL_GENERAL, { xpEnabled: true }, ADMIN);
		services.guildConfig.setChannel(GUILD, CHANNEL_BOT, { xpEnabled: true }, ADMIN);
		services.tierSets.select(GUILD, "kiem-hiep", ADMIN);
		services.tierSets.rename(GUILD, [{ tierKey: "bac-1", name: "Tân Binh", emoji: null }], ADMIN);
		services.tierSets.chooseForMember(GUILD, USER_B, "vu-tru");
		const auditsBefore = services.audit.list(GUILD, 100).length;
		const rank = new RankCmd(commandClient(services));

		const owner = helpButton(RANK_HELP_ID, USER_A, [CHANNEL_GENERAL]);
		await rank.executeButton(owner.interaction);
		assert.equal(owner.replies.length, 1);
		const ownerReply = owner.replies[0];
		assert.ok(ownerReply);
		assert.equal(ownerReply.flags, MessageFlags.Ephemeral | MessageFlags.IsComponentsV2);
		assert.deepEqual(ownerReply.allowedMentions, { parse: [] });
		const ownerText = replyTexts(ownerReply).join("\n");
		for (const expected of ["**7 XP**", "Cooldown **30 giây**", "**3 ký tự**", "trong **10 phút**", "**9 XP**", "Tối đa **18 XP**", "được **2 điểm**", "### 🏅 Danh hiệu: bộ Kiếm hiệp (bộ của server)", "**Tân Binh** · Level 0"])
		{
			assert.ok(ownerText.includes(expected), `thiếu: ${expected}`);
		}
		assert.ok(ownerText.includes(`Đang bật: <#${CHANNEL_GENERAL}>.`), "chỉ liệt kê kênh còn trong server");
		assert.ok(!ownerText.includes(CHANNEL_BOT));

		const restricted = helpButton(RANK_HELP_ID, USER_A, [CHANNEL_GENERAL, CHANNEL_BOT], [CHANNEL_BOT]);
		await rank.executeButton(restricted.interaction);
		const restrictedReply = restricted.replies[0];
		assert.ok(restrictedReply);
		const restrictedText = replyTexts(restrictedReply).join("\n");
		assert.ok(restrictedText.includes(`Đang bật: <#${CHANNEL_GENERAL}>.`) && !restrictedText.includes(CHANNEL_BOT), "không nêu kênh người bấm không xem được (ID hay số lượng)");

		const other = helpButton(RANK_HELP_ID, USER_B, [CHANNEL_GENERAL, CHANNEL_BOT]);
		await rank.executeButton(other.interaction);
		const otherReply = other.replies[0];
		assert.ok(otherReply);
		const otherText = replyTexts(otherReply).join("\n");
		assert.ok(otherText.includes("### 🏅 Thiên thể: bộ Vũ trụ (bộ bạn tự chọn)"), "người khác bấm: theo bộ của chính họ");
		assert.ok(otherText.includes("Bạn đang dùng: **Vũ trụ** (tự chọn)."));
		assert.ok(otherText.includes("Bảng vàng dùng bộ của server (**Kiếm hiệp**)"));
		assert.equal(services.audit.list(GUILD, 100).length, auditsBefore, "chỉ đọc, không ghi gì");
	});

	test("customId lạ bị từ chối trước khi trả lời", async () =>
	{
		const rank = new RankCmd(commandClient(realServices()));
		const { interaction, replies } = helpButton("rankhelp:khac", USER_A);
		await assert.rejects(rank.executeButton(interaction), userError(INVALID_RANK_HELP_BUTTON));
		assert.equal(replies.length, 0);
	});
});
