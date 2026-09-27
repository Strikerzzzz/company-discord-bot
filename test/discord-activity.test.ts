import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
	APIEmbed,
	ApplicationCommandOptionType,
	AttachmentBuilder,
	ChatInputCommandInteraction,
	EmbedBuilder,
	InteractionEditReplyOptions,
	Message,
	MessageFlags,
	PermissionFlagsBits,
	PermissionsBitField,
} from "discord.js";
import type DiscordClient from "../src/classes/DiscordClient";
import { NO_BADGE_TEXT } from "../src/discord/cardData";
import { LeaderboardCardData, RankCardData, RenderedCard } from "../src/discord/cards/types";
import { leaderboardEmbed, rankEmbed, RankView } from "../src/discord/views/activity";
import MessageCreate from "../src/events/messageCreate";
import { GuildMember } from "discord.js";
import { levelUpText, promotionText } from "../src/discord/views/progression";
import { applyTierOverrides, TIER_SETS, tierByKey, TierSet } from "../src/modules/activity/tiers";
import { TierRoleServiceApi, TierRoleSyncPlan } from "../src/modules/gamification/types";
import { cooldownMessage, RenderGate } from "../src/discord/renderGate";
import LeaderboardCmd from "../src/interactions/commands/leaderboard";
import RankCmd from "../src/interactions/commands/rank";
import { levelInfo } from "../src/modules/activity/levels";
import { DEFAULT_TIER_SET, nextTier, tierForLevel } from "../src/modules/activity/tiers";
import { ActivityProfile, ActivityServiceApi, MessageInput, MessageXpResult } from "../src/modules/activity/types";
import { ContributionProfile, ContributionServiceApi } from "../src/modules/contribution/types";
import { TierSetServiceApi } from "../src/modules/gamification/TierSetService";
import { ACHIEVEMENTS } from "../src/modules/gamification/achievements";
import { GamificationServiceApi } from "../src/modules/gamification/types";
import { GuildConfigService } from "../src/modules/guild-config/GuildConfigService";
import { DEFAULT_GUILD_SETTINGS } from "../src/modules/guild-config/types";
import { LeaderboardPage, LeaderboardPeriod, LeaderboardServiceApi, ScoreKind } from "../src/modules/leaderboard/LeaderboardService";
import { TeamService } from "../src/modules/team/TeamService";
import { AppServices } from "../src/services";
import { UserError } from "../src/shared/errors";
import { CHANNEL_GENERAL, GUILD, OTHER_GUILD, ROLE_BACKEND, ROLE_FRONTEND, ROLE_OTHER, USER_A, USER_B } from "./helpers";

const THREAD = "400000000000000009";
const BOT_ID = "900000000000000001";
const AVATAR = "https://cdn.discordapp.com/embed/avatars/0.png";
const EMPTY_BAR = "▱".repeat(12);
const HALF_BAR = "▰".repeat(6) + "▱".repeat(6);

// ---------- Fake service: chỉ cài những hàm tầng Discord dùng, ghi lại lời gọi để kiểm tra ----------

interface FakeServiceOptions
{
	xpResult?: MessageXpResult;
	levelUpAnnouncements?: boolean;
	activity?: ActivityProfile;
	contribution?: ContributionProfile;
	configuredTeams?: string[];
	board?: LeaderboardPage;
	/** Bộ danh hiệu guild đang dùng (mặc định Tu tiên). */
	tierSet?: TierSet;
}

interface BoardCall
{
	scope: "individual" | "team";
	guildId: string;
	kind: ScoreKind;
	period: LeaderboardPeriod;
	page: number;
}

interface FakeServices
{
	services: AppServices;
	messages: MessageInput[];
	profileCalls: string[];
	boardCalls: BoardCall[];
	/** Guild đã được hỏi bộ danh hiệu (tierSets.current). */
	tierSetCalls: string[];
}

function activityProfile(userId: string, totalXp: number, rank: number | null, totalRanked: number): ActivityProfile
{
	return { userId, level: levelInfo(totalXp), rank, totalRanked };
}

function contributionProfile(userId: string, score: number, rank: number | null, contributions: number): ContributionProfile
{
	return { userId, score, rank, totalRanked: rank === null ? 0 : 10, contributions };
}

const EMPTY_BOARD: LeaderboardPage = { entries: [], page: 1, totalPages: 1, totalEntries: 0, period: "all", since: null };

function createFakeServices(options: FakeServiceOptions = {}): FakeServices
{
	const messages: MessageInput[] = [];
	const profileCalls: string[] = [];
	const boardCalls: BoardCall[] = [];
	const tierSetCalls: string[] = [];

	const activity: Pick<ActivityServiceApi, "handleMessage" | "getProfile"> = {
		handleMessage: input =>
		{
			messages.push(input);
			return options.xpResult ?? { awarded: false, reason: "cooldown" };
		},
		getProfile: (_guildId, userId) =>
		{
			profileCalls.push(`activity:${userId}`);
			return options.activity ?? activityProfile(userId, 0, null, 0);
		},
	};
	const contributions: Pick<ContributionServiceApi, "getProfile"> = {
		getProfile: (_guildId, userId) =>
		{
			profileCalls.push(`contribution:${userId}`);
			return options.contribution ?? contributionProfile(userId, 0, null, 0);
		},
	};
	const teams: Pick<TeamService, "resolveTeams"> = {
		resolveTeams: (_guildId, roleIds) => (options.configuredTeams ?? []).filter(roleId => roleIds.includes(roleId)),
	};
	const guildConfig: Pick<GuildConfigService, "getSettings"> = {
		getSettings: () => ({ ...DEFAULT_GUILD_SETTINGS, levelUpAnnouncements: options.levelUpAnnouncements ?? true }),
	};
	const leaderboard: LeaderboardServiceApi = {
		individual: () => { throw new Error("không dùng trong test này"); },
		teams: () => { throw new Error("không dùng trong test này"); },
		query: ({ guildId, kind, scope, period, page }) =>
		{
			boardCalls.push({ scope, guildId, kind, period, page });
			return options.board ?? EMPTY_BOARD;
		},
		userStanding: () => { throw new Error("không dùng trong test này"); },
		userPosition: () => { throw new Error("không dùng trong test này"); },
	};

	const tierSets: Pick<TierSetServiceApi, "current"> = {
		current: guildId =>
		{
			tierSetCalls.push(guildId);
			return options.tierSet ?? DEFAULT_TIER_SET;
		},
	};

	const services = { activity, contributions, teams, guildConfig, leaderboard, tierSets } as unknown as AppServices;
	return { services, messages, profileCalls, boardCalls, tierSetCalls };
}

/** Client giả: chỉ phục vụ GUILD; `user` là tài khoản bot (dùng khi kiểm tra quyền gửi tin của bot). */
function fakeClient(services: AppServices): DiscordClient
{
	return { services, guildIds: [GUILD], user: { id: BOT_ID } } as unknown as DiscordClient;
}

// ---------- Fake message ----------

interface FakeMessageOptions
{
	bot?: boolean;
	webhookId?: string | null;
	system?: boolean;
	inGuild?: boolean;
	guildId?: string;
	inThread?: boolean;
	sendable?: boolean;
	/** Quyền của bot ở channel; null = không tính được quyền. Mặc định: View Channel, Send Messages, Send Messages in Threads. */
	botPermissions?: bigint[] | null;
	/** Gửi thông báo thất bại (ví dụ thread bị khoá). */
	sendFails?: boolean;
	content?: string;
	attachments?: number;
	roleIds?: string[];
}

const BOT_CAN_SEND = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads];

function fakeMessage(options: FakeMessageOptions = {}): { message: Message; sent: unknown[]; permissionChecks: unknown[] }
{
	const sent: unknown[] = [];
	const permissionChecks: unknown[] = [];
	const inThread = options.inThread ?? false;
	const inGuild = options.inGuild ?? true;
	const botPermissions = options.botPermissions === undefined ? BOT_CAN_SEND : options.botPermissions;
	const message = {
		author: { id: USER_A, bot: options.bot ?? false },
		webhookId: options.webhookId ?? null,
		system: options.system ?? false,
		inGuild: () => inGuild,
		guildId: inGuild ? options.guildId ?? GUILD : null,
		channelId: inThread ? THREAD : CHANNEL_GENERAL,
		channel: {
			isThread: () => inThread,
			parentId: inThread ? CHANNEL_GENERAL : null,
			isSendable: () => options.sendable ?? true,
			permissionsFor: (user: unknown) =>
			{
				permissionChecks.push(user);
				return botPermissions === null ? null : new PermissionsBitField(botPermissions);
			},
			send: (payload: unknown) =>
			{
				if (options.sendFails) return Promise.reject(new Error("Thread is locked"));
				sent.push(payload);
				return Promise.resolve();
			},
		},
		content: options.content ?? "Chào buổi sáng cả nhà",
		attachments: { size: options.attachments ?? 0 },
		member: inGuild ? { roles: options.roleIds ?? [], guild: { id: options.guildId ?? GUILD } } : null,
	};
	return { message: message as unknown as Message, sent, permissionChecks };
}

const LEVEL_UP: MessageXpResult = { awarded: true, amount: 10, totalXp: 480, levelBefore: 2, levelAfter: 3 };

// ---------- Fake interaction ----------

interface FakeUser
{
	id: string;
	bot: boolean;
	displayName: string;
	displayAvatarURL: () => string;
}

function fakeUser(id: string, displayName: string, bot = false): FakeUser
{
	return { id, bot, displayName, displayAvatarURL: () => AVATAR };
}

interface InteractionOptions
{
	inGuild?: boolean;
	user?: FakeUser | null;
	member?: { nick: string | null; roles: string[] } | null;
	strings?: Record<string, string>;
	integers?: Record<string, number>;
	/** Người gọi có quyền gửi tin ở kênh hiện tại không (mặc định có). */
	canSend?: boolean;
	/** Bot có quyền Attach Files ở kênh hiện tại không (mặc định có). */
	canAttach?: boolean;
}

interface Calls
{
	/** Tham số của từng lần deferReply (undefined = trả lời công khai). */
	deferred: unknown[];
	edits: InteractionEditReplyOptions[];
}

const GUILD_ROLES = new Map([
	[ROLE_BACKEND, { name: "Backend", colors: { primaryColor: 0 } }],
	[ROLE_FRONTEND, { name: "Frontend", colors: { primaryColor: 0x3498db } }],
]);

function fakeInteraction(options: InteractionOptions = {}): { interaction: ChatInputCommandInteraction; calls: Calls }
{
	const calls: Calls = { deferred: [], edits: [] };
	const interaction = {
		inGuild: () => options.inGuild ?? true,
		guildId: GUILD,
		guild: { id: GUILD, roles: { cache: GUILD_ROLES } },
		user: fakeUser(USER_A, "Người A"),
		member: { nick: "Anh A", roles: [ROLE_BACKEND, ROLE_OTHER] },
		memberPermissions: new PermissionsBitField(options.canSend === false ? [] : [PermissionFlagsBits.SendMessages]),
		appPermissions: new PermissionsBitField(options.canAttach === false ? [] : [PermissionFlagsBits.AttachFiles]),
		channel: { isThread: () => false },
		options: {
			getUser: () => options.user ?? null,
			getMember: () => options.member ?? null,
			getString: (name: string, required?: boolean) =>
			{
				const value = options.strings?.[name];
				if (value === undefined && required) throw new Error(`Thiếu option ${name}`);
				return value ?? null;
			},
			getInteger: (name: string) => options.integers?.[name] ?? null,
		},
		deferReply: (payload?: unknown) =>
		{
			calls.deferred.push(payload);
			return Promise.resolve();
		},
		editReply: (payload: InteractionEditReplyOptions) =>
		{
			calls.edits.push(payload);
			return Promise.resolve();
		},
	};
	return { interaction: interaction as unknown as ChatInputCommandInteraction, calls };
}

/** Client giả cho /rank và /leaderboard: tải avatar và tra tên thành viên (giả); RenderGate thật, mặc định mỗi client một gate. */
function cardClient(services: AppServices, avatarUrls: (string | null)[] = [], gate = new RenderGate()): DiscordClient
{
	return {
		services,
		guildIds: [GUILD],
		user: { id: BOT_ID },
		renderGate: gate,
		avatars: {
			get: (url: string | null) =>
			{
				avatarUrls.push(url);
				return Promise.resolve(null);
			},
		},
		members: {
			resolve: (_guild: unknown, userIds: readonly string[]) => Promise.resolve(new Map(userIds.map(id => [
				id,
				{ displayName: `Tên ${id.slice(-3)}`, avatarUrl: null, inGuild: true },
			]))),
		},
	} as unknown as DiscordClient;
}

/** Thêm hồ sơ gamification giả (level theo `totalXp`, chưa có huy hiệu, bậc theo `tierSet`) cho /rank. */
function withGamification(services: AppServices, totalXp = 0, tierSet: TierSet = DEFAULT_TIER_SET): AppServices
{
	const gamification: GamificationServiceApi = {
		profile: (_guildId, userId) =>
		{
			const level = levelInfo(totalXp);
			return {
				userId,
				level,
				tierSet,
				tier: tierForLevel(level.level, tierSet),
				nextTier: nextTier(level.level, tierSet),
				streak: { current: 0, best: 0, activeToday: false, lastActiveDay: null },
				stats: { messages: 0, bestStreak: 0, recognitionsReceived: 0, recognitionsGiven: 0, pollsJoined: 0, contributions: 0 },
				achievements: ACHIEVEMENTS.map(achievement => ({ achievement, unlocked: false, current: 0 })),
				weekly: { xp: 0, rank: null },
			};
		},
	};
	return { ...services, gamification };
}

function onlyEmbed(calls: Calls): APIEmbed
{
	assert.equal(calls.edits.length, 1);
	const embeds = calls.edits[0].embeds ?? [];
	assert.equal(embeds.length, 1);
	const [embed] = embeds;
	assert.ok(embed instanceof EmbedBuilder);
	return embed.toJSON();
}

function onlyFile(calls: Calls): AttachmentBuilder
{
	assert.equal(calls.edits.length, 1);
	const files = calls.edits[0].files ?? [];
	assert.equal(files.length, 1);
	const [file] = files;
	assert.ok(file instanceof AttachmentBuilder);
	return file;
}

function fieldValue(embed: APIEmbed, name: string): string
{
	const field = embed.fields?.find(f => f.name === name);
	assert.ok(field, `thiếu field "${name}"`);
	return field.value;
}

// ---------- Test ----------

describe("views Activity", () =>
{
	test("rankEmbed: ba phần tách biệt, số định dạng vi-VN, thanh tiến độ và hạng", () =>
	{
		const view: RankView = {
			displayName: "Anh A",
			avatarUrl: AVATAR,
			activity: activityProfile(USER_A, 1915, 3, 1234),
			contribution: contributionProfile(USER_A, 1234, 2, 5),
			teamRoleIds: [ROLE_BACKEND, ROLE_FRONTEND],
		};
		const embed = rankEmbed(view).toJSON();

		assert.equal(embed.author?.name, "Anh A");
		assert.equal(embed.author?.icon_url, AVATAR);
		assert.deepEqual(embed.fields?.map(f => f.name), ["⚡ Activity XP", "🌟 Contribution", "👥 Team"]);
		assert.equal(
			fieldValue(embed, "⚡ Activity XP"),
			`**Level 6** · 1.915 XP\n${HALF_BAR} 290/580 XP\nHạng: **#3**/1.234`,
		);
		assert.equal(fieldValue(embed, "🌟 Contribution"), "**1.234** điểm · 5 contribution\nHạng: **#2**/10");
		assert.equal(fieldValue(embed, "👥 Team"), `<@&${ROLE_BACKEND}>, <@&${ROLE_FRONTEND}>`);
	});

	test("rankEmbed: người chưa có điểm và chưa thuộc team", () =>
	{
		const embed = rankEmbed({
			displayName: "Người mới",
			avatarUrl: AVATAR,
			activity: activityProfile(USER_B, 0, null, 0),
			contribution: contributionProfile(USER_B, 0, null, 0),
			teamRoleIds: [],
		}).toJSON();

		assert.equal(fieldValue(embed, "⚡ Activity XP"), `**Level 0** · 0 XP\n${EMPTY_BAR} 0/100 XP\nHạng: Chưa có hạng`);
		assert.equal(fieldValue(embed, "🌟 Contribution"), "**0** điểm · 0 contribution\nHạng: Chưa có hạng");
		assert.equal(fieldValue(embed, "👥 Team"), "Chưa thuộc team nào");
	});

	test("leaderboardEmbed Activity cá nhân: medal, level, số định dạng, footer", () =>
	{
		const embed = leaderboardEmbed({
			kind: "activity",
			scope: "individual",
			page: {
				entries: [
					{ rank: 1, id: USER_A, value: 1915 },
					{ rank: 2, id: USER_B, value: 40 },
				],
				page: 1,
				totalPages: 2,
				totalEntries: 12,
				period: "all",
				since: null,
			},
		}).toJSON();

		assert.equal(embed.title, "🏆 Bảng xếp hạng Activity XP — Cá nhân");
		assert.equal(embed.description, `🥇 <@${USER_A}> — Level 6 · 1.915 XP\n🥈 <@${USER_B}> — Level 0 · 40 XP`);
		assert.equal(embed.footer?.text, "Trang 1/2 · 12 người");
	});

	test("leaderboardEmbed team: mention role, Activity chỉ hiện XP, Contribution hiện điểm, hạng từ 4 là #n", () =>
	{
		const page: LeaderboardPage = {
			entries: [
				{ rank: 3, id: ROLE_BACKEND, value: 1234 },
				{ rank: 4, id: ROLE_FRONTEND, value: 45 },
			],
			page: 2,
			totalPages: 2,
			totalEntries: 4,
			period: "all",
			since: null,
		};

		const activity = leaderboardEmbed({ kind: "activity", scope: "team", page }).toJSON();
		assert.equal(activity.title, "🏆 Bảng xếp hạng Activity XP — Team");
		assert.equal(activity.description, `🥉 <@&${ROLE_BACKEND}> — 1.234 XP\n#4 <@&${ROLE_FRONTEND}> — 45 XP`);
		assert.equal(activity.footer?.text, "Trang 2/2 · 4 team");

		const contribution = leaderboardEmbed({ kind: "contribution", scope: "team", page }).toJSON();
		assert.equal(contribution.title, "🏆 Bảng xếp hạng Contribution — Team");
		assert.equal(contribution.description, `🥉 <@&${ROLE_BACKEND}> — 1.234 điểm\n#4 <@&${ROLE_FRONTEND}> — 45 điểm`);
	});

	test("leaderboardEmbed Contribution cá nhân hiện điểm, không kèm level", () =>
	{
		const embed = leaderboardEmbed({
			kind: "contribution",
			scope: "individual",
			page: { entries: [{ rank: 1, id: USER_A, value: 12 }], page: 1, totalPages: 1, totalEntries: 1, period: "all", since: null },
		}).toJSON();
		assert.equal(embed.description, `🥇 <@${USER_A}> — 12 điểm`);
	});

	test("leaderboardEmbed rỗng", () =>
	{
		const embed = leaderboardEmbed({ kind: "contribution", scope: "individual", page: EMPTY_BOARD }).toJSON();
		assert.equal(embed.description, "Chưa có dữ liệu.");
		assert.equal(embed.footer?.text, "Trang 1/1 · 0 người");
	});
});

describe("event messageCreate", () =>
{
	interface PlanCall
	{
		guildId: string;
		level: number;
		roleIds: readonly string[];
	}

	/** Fake service của các test khác, thêm tierRoles giả trả về `plan` cố định và ghi lại lời gọi. */
	function messageServices(options: FakeServiceOptions = {}, plan: TierRoleSyncPlan = { add: [], remove: [] }): FakeServices & { planCalls: PlanCall[] }
	{
		const fake = createFakeServices(options);
		const planCalls: PlanCall[] = [];
		const tierRoles: Pick<TierRoleServiceApi, "plan"> = {
			plan: (guildId, level, roleIds) =>
			{
				planCalls.push({ guildId, level, roleIds });
				return plan;
			},
		};
		return { ...fake, services: { ...fake.services, tierRoles } as unknown as AppServices, planCalls };
	}

	/** GuildMember giả (qua được `instanceof GuildMember`); bot có Manage Roles, role cảnh giới nằm dưới role của bot. */
	function tierMember(roleIds: string[], addFails = false): { member: GuildMember; added: string[] }
	{
		const added: string[] = [];
		const role = (id: string, position: number): object => ({
			id,
			position,
			managed: false,
			guild: { id: GUILD, channels: { cache: new Map() } },
			permissions: new PermissionsBitField(),
		});
		const guild = {
			id: GUILD,
			members: { me: { permissions: new PermissionsBitField([PermissionFlagsBits.ManageRoles]), roles: { highest: role(BOT_ROLE, 10) } } },
			roles: { cache: new Map([[TIER_ROLE, role(TIER_ROLE, 1)]]) },
		};
		const roles = {
			cache: new Map(roleIds.map(id => [id, { id }])),
			add: (roleId: string) =>
			{
				if (addFails) return Promise.reject(new Error("Missing Permissions"));
				added.push(roleId);
				return Promise.resolve();
			},
			remove: () => Promise.resolve(),
		};
		return { member: Object.setPrototypeOf({ guild, user: { id: USER_A }, roles }, GuildMember.prototype) as GuildMember, added };
	}

	const BOT_ROLE = "510000000000000099";
	const TIER_ROLE = "510000000000000002";
	/** Lên level nhưng vẫn trong cảnh giới Trúc Cơ (3 → 4). LEVEL_UP (2 → 3) vượt mốc Trúc Cơ. */
	const PLAIN_LEVEL_UP: MessageXpResult = { awarded: true, amount: 10, totalXp: 800, levelBefore: 3, levelAfter: 4 };
	const NO_LEVEL_UP: MessageXpResult = { awarded: true, amount: 10, totalXp: 50, levelBefore: 0, levelAfter: 0 };

	const skipped: [string, FakeMessageOptions][] = [
		["bot", { bot: true }],
		["webhook", { webhookId: "600000000000000001" }],
		["tin hệ thống", { system: true }],
		["tin nhắn riêng (DM)", { inGuild: false }],
		["tin ở server không có trong DISCORD_GUILD_IDS", { guildId: OTHER_GUILD }],
	];
	for (const [label, options] of skipped)
	{
		test(`bỏ qua ${label}`, async () =>
		{
			const fake = messageServices({ xpResult: LEVEL_UP });
			const { message, sent } = fakeMessage(options);
			await new MessageCreate(fakeClient(fake.services)).execute(message);
			assert.equal(fake.messages.length, 0);
			assert.equal(sent.length, 0);
			assert.equal(fake.planCalls.length, 0);
		});
	}

	test("chuyển tin nhắn thành MessageInput", async () =>
	{
		const fake = messageServices();
		const { message, sent } = fakeMessage({ content: "Hôm nay deploy xong", attachments: 2, roleIds: [ROLE_BACKEND] });
		await new MessageCreate(fakeClient(fake.services)).execute(message);

		assert.deepEqual(fake.messages, [{
			guildId: GUILD,
			userId: USER_A,
			channelId: CHANNEL_GENERAL,
			content: "Hôm nay deploy xong",
			hasAttachments: true,
			roleIds: [ROLE_BACKEND],
		}]);
		assert.equal(sent.length, 0);
	});

	test("tin trong thread dùng channel cha", async () =>
	{
		const fake = messageServices();
		const { message } = fakeMessage({ inThread: true });
		await new MessageCreate(fakeClient(fake.services)).execute(message);
		assert.equal(fake.messages[0].channelId, CHANNEL_GENERAL);
		assert.equal(fake.messages[0].hasAttachments, false);
	});

	test("lên level thì thông báo theo bộ mặc định (Tu tiên) và chỉ ping đúng người đó; kiểm tra quyền của chính bot", async () =>
	{
		const fake = messageServices({ xpResult: PLAIN_LEVEL_UP });
		const { message, sent, permissionChecks } = fakeMessage();
		await new MessageCreate(fakeClient(fake.services)).execute(message);
		assert.deepEqual(sent, [{ content: levelUpText(DEFAULT_TIER_SET, USER_A, 4), allowedMentions: { users: [USER_A] } }]);
		assert.deepEqual(permissionChecks, [{ id: BOT_ID }]);
		assert.deepEqual(fake.tierSetCalls, [GUILD], "hỏi bộ danh hiệu của đúng guild, một lần");
	});

	test("lên level vượt mốc bậc thì gửi thông báo lên bậc thay cho thông báo lên level", async () =>
	{
		const fake = messageServices({ xpResult: LEVEL_UP });
		const { message, sent } = fakeMessage();
		await new MessageCreate(fakeClient(fake.services)).execute(message);
		assert.deepEqual(sent, [{ content: promotionText(DEFAULT_TIER_SET, USER_A, tierByKey("bac-2"), 3), allowedMentions: { users: [USER_A] } }]);
	});

	test("bộ danh hiệu của guild quyết định câu chữ: Rank game, có tên bậc tuỳ chỉnh", async () =>
	{
		const rankGame = applyTierOverrides(TIER_SETS["rank-game"], [{ tierKey: "bac-2", name: "Bạc Ròng", emoji: "🥈" }]);

		const plain = messageServices({ xpResult: PLAIN_LEVEL_UP, tierSet: rankGame });
		const first = fakeMessage();
		await new MessageCreate(fakeClient(plain.services)).execute(first.message);
		assert.deepEqual(first.sent, [{ content: levelUpText(rankGame, USER_A, 4), allowedMentions: { users: [USER_A] } }]);
		assert.equal(levelUpText(rankGame, USER_A, 4), `📈 <@${USER_A}> vừa lên **Level 4**!`);

		const promoted = messageServices({ xpResult: LEVEL_UP, tierSet: rankGame });
		const second = fakeMessage();
		await new MessageCreate(fakeClient(promoted.services)).execute(second.message);
		assert.deepEqual(second.sent, [{
			content: `🏆 Thăng hạng! <@${USER_A}> đã leo lên hạng Bạc! 🥈 Hạng **Bạc Ròng** · Level 3`,
			allowedMentions: { users: [USER_A] },
		}]);
	});

	test("không lên level, hoặc tắt thông báo, thì không cần hỏi bộ danh hiệu", async () =>
	{
		const quiet = messageServices({ xpResult: NO_LEVEL_UP });
		await new MessageCreate(fakeClient(quiet.services)).execute(fakeMessage().message);
		assert.deepEqual(quiet.tierSetCalls, []);

		const muted = messageServices({ xpResult: LEVEL_UP, levelUpAnnouncements: false });
		await new MessageCreate(fakeClient(muted.services)).execute(fakeMessage().message);
		assert.deepEqual(muted.tierSetCalls, []);
	});

	test("bot không có quyền gửi tin ở channel: bỏ qua thông báo, không gây lỗi", async () =>
	{
		const cases: [string, FakeMessageOptions][] = [
			["thiếu Send Messages", { botPermissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessagesInThreads] }],
			["thread: thiếu Send Messages in Threads", { inThread: true, botPermissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }],
			["không tính được quyền", { botPermissions: null }],
		];
		for (const [label, options] of cases)
		{
			const fake = messageServices({ xpResult: LEVEL_UP });
			const { message, sent } = fakeMessage(options);
			await new MessageCreate(fakeClient(fake.services)).execute(message);
			assert.equal(fake.messages.length, 1, label);
			assert.equal(sent.length, 0, label);
		}
	});

	test("thread: bot có Send Messages in Threads thì thông báo được", async () =>
	{
		const fake = messageServices({ xpResult: LEVEL_UP });
		const { message, sent } = fakeMessage({ inThread: true, botPermissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessagesInThreads] });
		await new MessageCreate(fakeClient(fake.services)).execute(message);
		assert.equal(sent.length, 1);
	});

	test("gửi thông báo thất bại chỉ ghi cảnh báo, XP vẫn đã được cộng, role vẫn được đồng bộ", async (t) =>
	{
		const warned = t.mock.method(console, "error", () => undefined);
		const fake = messageServices({ xpResult: LEVEL_UP });
		const { message } = fakeMessage({ sendFails: true });
		await new MessageCreate(fakeClient(fake.services)).execute(message);
		assert.equal(fake.messages.length, 1);
		assert.equal(warned.mock.callCount(), 1);
		assert.match(String(warned.mock.calls[0].arguments[0]), /\[WARN\]/);
		assert.equal(fake.planCalls.length, 1);
	});

	test("không thông báo khi admin tắt levelUpAnnouncements", async () =>
	{
		const fake = messageServices({ xpResult: LEVEL_UP, levelUpAnnouncements: false });
		const { message, sent } = fakeMessage();
		await new MessageCreate(fakeClient(fake.services)).execute(message);
		assert.equal(fake.messages.length, 1);
		assert.equal(sent.length, 0);
	});

	test("không thông báo khi được XP nhưng chưa lên level, không được XP, hoặc channel không gửi được", async () =>
	{
		const cases: [MessageXpResult, boolean][] = [
			[NO_LEVEL_UP, true],
			[{ awarded: false, reason: "duplicate" }, true],
			[LEVEL_UP, false],
		];
		for (const [xpResult, sendable] of cases)
		{
			const fake = messageServices({ xpResult });
			const { message, sent } = fakeMessage({ sendable });
			await new MessageCreate(fakeClient(fake.services)).execute(message);
			assert.equal(fake.messages.length, 1);
			assert.equal(sent.length, 0);
		}
	});

	test("mọi tin được XP đều đồng bộ role cảnh giới theo level mới (kể cả khi không lên level); tin không được XP thì không", async () =>
	{
		const awarded = messageServices({ xpResult: NO_LEVEL_UP });
		await new MessageCreate(fakeClient(awarded.services)).execute(fakeMessage({ roleIds: [ROLE_BACKEND] }).message);
		assert.deepEqual(awarded.planCalls, [{ guildId: GUILD, level: 0, roleIds: [ROLE_BACKEND] }]);

		const levelUp = messageServices({ xpResult: PLAIN_LEVEL_UP });
		await new MessageCreate(fakeClient(levelUp.services)).execute(fakeMessage().message);
		assert.deepEqual(levelUp.planCalls.map(call => call.level), [4]);

		const rejected = messageServices({ xpResult: { awarded: false, reason: "cooldown" } });
		await new MessageCreate(fakeClient(rejected.services)).execute(fakeMessage().message);
		assert.deepEqual(rejected.planCalls, []);
	});

	test("thêm role cảnh giới cho tác giả với lý do trong audit log của Discord", async () =>
	{
		const fake = messageServices({ xpResult: LEVEL_UP }, { add: [TIER_ROLE], remove: [] });
		const { member, added } = tierMember([ROLE_BACKEND]);
		const { message, sent } = fakeMessage();
		Object.assign(message, { member });
		await new MessageCreate(fakeClient(fake.services)).execute(message);

		assert.deepEqual(added, [TIER_ROLE]);
		assert.deepEqual(fake.planCalls, [{ guildId: GUILD, level: 3, roleIds: [ROLE_BACKEND] }]);
		assert.deepEqual(fake.messages[0].roleIds, [ROLE_BACKEND]);
		assert.equal(sent.length, 1);
	});

	test("lỗi khi đổi role chỉ ghi cảnh báo, không ảnh hưởng thông báo lên level", async (t) =>
	{
		const warned = t.mock.method(console, "error", () => undefined);
		const fake = messageServices({ xpResult: PLAIN_LEVEL_UP }, { add: [TIER_ROLE], remove: [] });
		const { member, added } = tierMember([], true);
		const { message, sent } = fakeMessage();
		Object.assign(message, { member });
		await new MessageCreate(fakeClient(fake.services)).execute(message);

		assert.deepEqual(added, []);
		assert.equal(sent.length, 1);
		assert.equal(warned.mock.callCount(), 1);
		assert.match(String(warned.mock.calls[0].arguments[0]), /\[WARN\] Không thêm được role cảnh giới/);
	});

	test("lỗi từ service được ném ra cho EventHandler", async () =>
	{
		const fake = messageServices();
		const services = { ...fake.services, activity: { handleMessage: () => { throw new Error("hỏng"); } } } as unknown as AppServices;
		const { message } = fakeMessage();
		await assert.rejects(new MessageCreate(fakeClient(services)).execute(message), /hỏng/);
	});
});

const RANK_CARD: RenderedCard = { png: Buffer.from("png"), fileName: "rank.png", width: 1000, height: 460 };
const BOARD_CARD: RenderedCard = { png: Buffer.from("png"), fileName: "leaderboard.png", width: 1000, height: 400 };

/** /rank với hàm vẽ giả: ghi lại dữ liệu ảnh; `fail` = giả lập vẽ lỗi. */
function rankCommand(services: AppServices, options: { avatarUrls?: (string | null)[]; fail?: boolean; gate?: RenderGate } = {}): { command: RankCmd; cards: RankCardData[] }
{
	const command = new RankCmd(cardClient(services, options.avatarUrls, options.gate));
	const cards: RankCardData[] = [];
	command.renderCard = data =>
	{
		cards.push(data);
		return options.fail ? Promise.reject(new Error("canvas hỏng")) : Promise.resolve(RANK_CARD);
	};
	return { command, cards };
}

function leaderboardCommand(services: AppServices): { command: LeaderboardCmd; cards: LeaderboardCardData[] }
{
	const command = new LeaderboardCmd(cardClient(services));
	const cards: LeaderboardCardData[] = [];
	command.renderCard = data =>
	{
		cards.push(data);
		return Promise.resolve(BOARD_CARD);
	};
	return { command, cards };
}

describe("/rank", () =>
{
	test("định nghĩa: option thanh-vien kiểu user, không bắt buộc", () =>
	{
		const json = new RankCmd(fakeClient(createFakeServices().services)).data.toJSON();
		assert.equal(json.name, "rank");
		assert.ok(json.description.length <= 100);
		assert.deepEqual(json.options?.map(o => [o.name, o.type, o.required ?? false]), [["thanh-vien", ApplicationCommandOptionType.User, false]]);
	});

	test("mặc định xem thẻ của chính người gọi: ảnh kèm phần chữ, team lấy từ role của họ", async () =>
	{
		const fake = createFakeServices({
			configuredTeams: [ROLE_BACKEND, ROLE_FRONTEND],
			activity: activityProfile(USER_A, 1915, 1, 3),
		});
		const avatarUrls: (string | null)[] = [];
		const { command, cards } = rankCommand(withGamification(fake.services, 1915), { avatarUrls });
		const { interaction, calls } = fakeInteraction();
		await command.execute(interaction);

		assert.deepEqual(fake.profileCalls, [`activity:${USER_A}`, `contribution:${USER_A}`]);
		assert.deepEqual(calls.deferred, [undefined], "có quyền gửi tin thì trả lời công khai");
		assert.equal(cards.length, 1);
		assert.equal(cards[0].displayName, "Anh A");
		assert.equal(cards[0].level.level, 6);
		assert.equal(cards[0].tier.key, "bac-3");
		assert.equal(cards[0].activity.rank, 1);
		assert.deepEqual(cards[0].teamNames, ["Backend"]);
		assert.deepEqual(avatarUrls, [AVATAR]);

		assert.equal(onlyFile(calls).name, "rank.png");
		assert.equal(calls.edits[0].content, `🟡 Cảnh giới **Kim Đan** · Level 6\n${NO_BADGE_TEXT}\n🎯 Sắp đạt: 💬 Khai Khẩu (0/100)`);
		assert.equal(calls.edits[0].embeds, undefined);
	});

	test("guild dùng bộ khác: ảnh và phần chữ theo bộ đó (tên gọi bậc, tên bậc, emoji)", async () =>
	{
		const cayXanh = TIER_SETS["cay-xanh"];
		const fake = createFakeServices({ activity: activityProfile(USER_A, 1915, 1, 3) });
		const { command, cards } = rankCommand(withGamification(fake.services, 1915, cayXanh));
		const { interaction, calls } = fakeInteraction();
		await command.execute(interaction);

		assert.equal(cards[0].tierSet.key, "cay-xanh");
		assert.equal(cards[0].tier.name, "Cây Non");
		assert.equal(cards[0].nextTier?.name, "Ra Hoa");
		assert.ok(String(calls.edits[0].content).startsWith("🌿 Giai đoạn **Cây Non** · Level 6\n"), String(calls.edits[0].content));
	});

	test("người không được gửi tin ở kênh, hoặc bot thiếu Attach Files, chỉ nhận kết quả riêng", async () =>
	{
		for (const options of [{ canSend: false }, { canAttach: false }])
		{
			const { command } = rankCommand(withGamification(createFakeServices().services));
			const { interaction, calls } = fakeInteraction(options);
			await command.execute(interaction);
			assert.deepEqual(calls.deferred, [{ flags: MessageFlags.Ephemeral }]);
			assert.equal(onlyFile(calls).name, "rank.png");
		}
	});

	test("xem thành viên khác: dùng member được chọn", async () =>
	{
		const fake = createFakeServices({ configuredTeams: [ROLE_BACKEND, ROLE_FRONTEND] });
		const { command, cards } = rankCommand(withGamification(fake.services));
		const { interaction } = fakeInteraction({
			user: fakeUser(USER_B, "Người B"),
			member: { nick: null, roles: [ROLE_FRONTEND] },
		});
		await command.execute(interaction);

		assert.deepEqual(fake.profileCalls, [`activity:${USER_B}`, `contribution:${USER_B}`]);
		assert.equal(cards[0].displayName, "Người B");
		assert.deepEqual(cards[0].teamNames, ["Frontend"]);
	});

	test("thành viên đã rời server: không có team", async () =>
	{
		const fake = createFakeServices({ configuredTeams: [ROLE_BACKEND] });
		const { command, cards } = rankCommand(withGamification(fake.services));
		const { interaction } = fakeInteraction({ user: fakeUser(USER_B, "Người B"), member: null });
		await command.execute(interaction);
		assert.equal(cards[0].displayName, "Người B");
		assert.deepEqual(cards[0].teamNames, []);
	});

	test("vẽ ảnh lỗi: trả embed cũ kèm phần chữ, ghi log lỗi", async (t) =>
	{
		const logged = t.mock.method(console, "error", () => undefined);
		const fake = createFakeServices({ configuredTeams: [ROLE_BACKEND], activity: activityProfile(USER_A, 1915, 1, 3) });
		const { command } = rankCommand(withGamification(fake.services, 1915), { fail: true });
		const { interaction, calls } = fakeInteraction();
		await command.execute(interaction);

		const embed = onlyEmbed(calls);
		assert.equal(embed.author?.name, "Anh A");
		assert.match(fieldValue(embed, "⚡ Activity XP"), /\*\*Level 6\*\*/);
		assert.equal(fieldValue(embed, "👥 Team"), `<@&${ROLE_BACKEND}>`);
		assert.match(calls.edits[0].content ?? "", /^🟡 Cảnh giới \*\*Kim Đan\*\* · Level 6/);
		assert.equal(calls.edits[0].files, undefined);
		assert.equal(logged.mock.callCount(), 1);
		assert.match(String(logged.mock.calls[0].arguments[0]), /\[ERROR\]/);
	});

	test("cooldown 3 giây theo người, dùng chung với /leaderboard: bị chặn thì báo lỗi riêng trước khi defer", async () =>
	{
		let now = 1_000_000;
		const gate = new RenderGate({ now: () => now });
		const services = withGamification(createFakeServices().services);
		const { command, cards } = rankCommand(services, { gate });
		await command.execute(fakeInteraction().interaction);

		now += 2_500;
		const blocked = fakeInteraction();
		await assert.rejects(command.execute(blocked.interaction), (error: unknown) => error instanceof UserError && error.message === cooldownMessage(500));
		assert.deepEqual(blocked.calls.deferred, []);
		const board = new LeaderboardCmd(cardClient(services, [], gate));
		const blockedBoard = fakeInteraction();
		await assert.rejects(board.execute(blockedBoard.interaction), (error: unknown) => error instanceof UserError && error.message === "Bạn thao tác nhanh quá, thử lại sau 1 giây nhé.");
		assert.deepEqual(blockedBoard.calls.deferred, []);

		now += 500;
		const later = fakeInteraction();
		await command.execute(later.interaction);
		assert.equal(onlyFile(later.calls).name, "rank.png");
		assert.equal(cards.length, 2);
	});

	test("chọn bot thì báo lỗi cho người dùng", async () =>
	{
		const fake = createFakeServices();
		const { command } = rankCommand(withGamification(fake.services));
		const { interaction, calls } = fakeInteraction({ user: fakeUser("700000000000000001", "Bot", true) });
		await assert.rejects(
			command.execute(interaction),
			(error: unknown) => error instanceof UserError && error.message === "Bot không có điểm.",
		);
		assert.equal(fake.profileCalls.length, 0);
		assert.equal(calls.deferred.length, 0);
	});

	test("ngoài server thì báo lỗi cho người dùng", async () =>
	{
		const { interaction } = fakeInteraction({ inGuild: false });
		await assert.rejects(rankCommand(createFakeServices().services).command.execute(interaction), UserError);
	});
});

describe("/leaderboard", () =>
{
	test("định nghĩa: loai, pham-vi, ky và trang đều tuỳ chọn; xử lý nút namespace lb", () =>
	{
		const command = new LeaderboardCmd(fakeClient(createFakeServices().services));
		const json = command.data.toJSON();
		assert.equal(json.name, "leaderboard");
		assert.ok(json.description.length <= 100);
		const options = json.options ?? [];
		assert.deepEqual(options.map(o => [o.name, o.required ?? false]), [["loai", false], ["pham-vi", false], ["ky", false], ["trang", false]]);
		for (const option of options) assert.ok(option.description.length <= 100, option.name);

		const [kind, scope, period, page] = options;
		assert.ok("choices" in kind && "choices" in scope && "choices" in period && "min_value" in page);
		assert.deepEqual(kind.choices?.map(c => c.value), ["activity", "contribution"]);
		assert.deepEqual(scope.choices?.map(c => c.value), ["ca-nhan", "team"]);
		assert.deepEqual(period.choices?.map(c => [c.name, c.value]), [["Tổng", "tong"], ["Tuần này", "tuan"], ["Tháng này", "thang"]]);
		assert.equal(page.min_value, 1);
		assert.deepEqual(command.buttonIds, ["lb"]);
	});

	test("mặc định: bảng Activity cá nhân, kỳ tổng, trang 1; ảnh kèm nút", async () =>
	{
		const fake = createFakeServices({
			board: { entries: [{ rank: 1, id: USER_A, value: 1915 }], page: 1, totalPages: 1, totalEntries: 1, period: "all", since: null },
		});
		const { command, cards } = leaderboardCommand(fake.services);
		const { interaction, calls } = fakeInteraction();
		await command.execute(interaction);

		assert.deepEqual(fake.boardCalls, [{ scope: "individual", guildId: GUILD, kind: "activity", period: "all", page: 1 }]);
		assert.deepEqual(calls.deferred, [undefined], "có quyền gửi tin thì trả lời công khai");
		assert.equal(onlyFile(calls).name, "leaderboard.png");
		assert.equal(calls.edits[0].components?.length, 3);
		assert.deepEqual(cards[0].rows.map(row => [row.name, row.value, row.detail, row.highlight]), [[`Tên ${USER_A.slice(-3)}`, "1.915 XP", "Lv 6", true]]);
	});

	test("người không được gửi tin ở kênh chỉ nhận bảng xếp hạng riêng", async () =>
	{
		const fake = createFakeServices();
		const { command } = leaderboardCommand(fake.services);
		const { interaction, calls } = fakeInteraction({ canSend: false });
		await command.execute(interaction);
		assert.deepEqual(calls.deferred, [{ flags: MessageFlags.Ephemeral }]);
		assert.equal(onlyFile(calls).name, "leaderboard.png");
	});

	test("bậc trên các dòng theo bộ danh hiệu của guild (tên tuỳ chỉnh), hỏi bộ đúng guild", async () =>
	{
		const vuTru = applyTierOverrides(TIER_SETS["vu-tru"], [{ tierKey: "bac-3", name: "Trái Đất", emoji: null }]);
		const fake = createFakeServices({
			board: { entries: [{ rank: 1, id: USER_A, value: 1915 }], page: 1, totalPages: 1, totalEntries: 1, period: "all", since: null },
			tierSet: vuTru,
		});
		const { command, cards } = leaderboardCommand(fake.services);
		await command.execute(fakeInteraction().interaction);

		assert.deepEqual(fake.tierSetCalls, [GUILD]);
		assert.equal(cards[0].rows[0].tier?.setKey, "vu-tru");
		assert.equal(cards[0].rows[0].tier?.name, "Trái Đất");
	});

	test("bảng team Contribution tuần này, trang được chọn", async () =>
	{
		const fake = createFakeServices();
		const { command, cards } = leaderboardCommand(fake.services);
		const { interaction } = fakeInteraction({ strings: { "loai": "contribution", "pham-vi": "team", "ky": "tuan" }, integers: { trang: 2 } });
		await command.execute(interaction);

		assert.deepEqual(fake.boardCalls, [{ scope: "team", guildId: GUILD, kind: "contribution", period: "week", page: 2 }]);
		assert.equal(cards[0].title, "BẢNG XẾP HẠNG · CONTRIBUTION");
		assert.equal(cards[0].footer, "Trang 1/1 · 0 team");
	});

	test("giá trị option không hợp lệ thì báo lỗi cho người dùng", async () =>
	{
		const fake = createFakeServices();
		const { command } = leaderboardCommand(fake.services);
		const invalid: Record<string, string>[] = [{ "loai": "xp" }, { "pham-vi": "phong-ban" }, { "ky": "nam" }];
		for (const strings of invalid)
		{
			const { interaction, calls } = fakeInteraction({ strings });
			await assert.rejects(command.execute(interaction), UserError);
			assert.equal(calls.deferred.length, 0);
		}
		assert.equal(fake.boardCalls.length, 0);
	});
});
