import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
	APIEmbed,
	ApplicationCommandOptionType,
	ChatInputCommandInteraction,
	EmbedBuilder,
	Message,
	MessageFlags,
	PermissionFlagsBits,
	PermissionsBitField,
} from "discord.js";
import type DiscordClient from "../src/classes/DiscordClient";
import { leaderboardEmbed, levelUpMessage, rankEmbed, RankView } from "../src/discord/views/activity";
import MessageCreate from "../src/events/messageCreate";
import { GuildMember } from "discord.js";
import { breakthroughText, levelUpText } from "../src/discord/views/progression";
import { tierByKey } from "../src/modules/activity/tiers";
import { TierRoleServiceApi, TierRoleSyncPlan } from "../src/modules/gamification/types";
import LeaderboardCmd from "../src/interactions/commands/leaderboard";
import RankCmd from "../src/interactions/commands/rank";
import { levelInfo } from "../src/modules/activity/levels";
import { ActivityProfile, ActivityServiceApi, MessageInput, MessageXpResult } from "../src/modules/activity/types";
import { ContributionProfile, ContributionServiceApi } from "../src/modules/contribution/types";
import { GuildConfigService } from "../src/modules/guild-config/GuildConfigService";
import { DEFAULT_GUILD_SETTINGS } from "../src/modules/guild-config/types";
import { LeaderboardPage, LeaderboardServiceApi, ScoreKind } from "../src/modules/leaderboard/LeaderboardService";
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
}

interface BoardCall
{
	scope: "individual" | "team";
	guildId: string;
	kind: ScoreKind;
	page: number;
}

interface FakeServices
{
	services: AppServices;
	messages: MessageInput[];
	profileCalls: string[];
	boardCalls: BoardCall[];
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
		individual: (guildId, kind, page) =>
		{
			boardCalls.push({ scope: "individual", guildId, kind, page });
			return options.board ?? EMPTY_BOARD;
		},
		teams: (guildId, kind, page) =>
		{
			boardCalls.push({ scope: "team", guildId, kind, page });
			return options.board ?? EMPTY_BOARD;
		},
		query: () => { throw new Error("không dùng trong test này"); },
		userStanding: () => { throw new Error("không dùng trong test này"); },
	};

	const services = { activity, contributions, teams, guildConfig, leaderboard } as unknown as AppServices;
	return { services, messages, profileCalls, boardCalls };
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
}

interface Reply
{
	embeds: EmbedBuilder[];
	flags?: number;
}

function fakeInteraction(options: InteractionOptions = {}): { interaction: ChatInputCommandInteraction; replies: Reply[] }
{
	const replies: Reply[] = [];
	const interaction = {
		inGuild: () => options.inGuild ?? true,
		guildId: GUILD,
		user: fakeUser(USER_A, "Người A"),
		member: { nick: "Anh A", roles: [ROLE_BACKEND, ROLE_OTHER] },
		memberPermissions: new PermissionsBitField(options.canSend === false ? [] : [PermissionFlagsBits.SendMessages]),
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
		reply: (payload: Reply) =>
		{
			replies.push(payload);
			return Promise.resolve();
		},
	};
	return { interaction: interaction as unknown as ChatInputCommandInteraction, replies };
}

function onlyEmbed(replies: Reply[]): APIEmbed
{
	assert.equal(replies.length, 1);
	assert.equal(replies[0].embeds.length, 1);
	return replies[0].embeds[0].toJSON();
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
	test("levelUpMessage mention đúng người và level", () =>
	{
		assert.equal(levelUpMessage(USER_A, 3), `🎉 Chúc mừng <@${USER_A}> đã lên **Level 3**!`);
	});

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
		const role = (id: string, position: number): object => ({ id, position, managed: false, guild: { id: GUILD }, permissions: new PermissionsBitField() });
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
		return { member: Object.setPrototypeOf({ guild, roles }, GuildMember.prototype) as GuildMember, added };
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

	test("lên level thì thông báo phong cách tu tiên và chỉ ping đúng người đó; kiểm tra quyền của chính bot", async () =>
	{
		const fake = messageServices({ xpResult: PLAIN_LEVEL_UP });
		const { message, sent, permissionChecks } = fakeMessage();
		await new MessageCreate(fakeClient(fake.services)).execute(message);
		assert.deepEqual(sent, [{ content: levelUpText(USER_A, 4), allowedMentions: { users: [USER_A] } }]);
		assert.deepEqual(permissionChecks, [{ id: BOT_ID }]);
	});

	test("lên level vượt mốc cảnh giới thì gửi thông báo đột phá thay cho thông báo lên level", async () =>
	{
		const fake = messageServices({ xpResult: LEVEL_UP });
		const { message, sent } = fakeMessage();
		await new MessageCreate(fakeClient(fake.services)).execute(message);
		assert.deepEqual(sent, [{ content: breakthroughText(USER_A, tierByKey("truc-co"), 3), allowedMentions: { users: [USER_A] } }]);
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

describe("/rank", () =>
{
	test("định nghĩa: option thanh-vien kiểu user, không bắt buộc", () =>
	{
		const json = new RankCmd(fakeClient(createFakeServices().services)).data.toJSON();
		assert.equal(json.name, "rank");
		assert.ok(json.description.length <= 100);
		assert.deepEqual(json.options?.map(o => [o.name, o.type, o.required ?? false]), [["thanh-vien", ApplicationCommandOptionType.User, false]]);
	});

	test("mặc định xem hồ sơ của chính người gọi, team lấy từ role của họ", async () =>
	{
		const fake = createFakeServices({
			configuredTeams: [ROLE_BACKEND, ROLE_FRONTEND],
			activity: activityProfile(USER_A, 1915, 1, 3),
		});
		const { interaction, replies } = fakeInteraction();
		await new RankCmd(fakeClient(fake.services)).execute(interaction);

		assert.deepEqual(fake.profileCalls, [`activity:${USER_A}`, `contribution:${USER_A}`]);
		const embed = onlyEmbed(replies);
		assert.equal(embed.author?.name, "Anh A");
		assert.match(fieldValue(embed, "⚡ Activity XP"), /\*\*Level 6\*\*/);
		assert.equal(fieldValue(embed, "👥 Team"), `<@&${ROLE_BACKEND}>`);
		assert.equal(replies[0].flags, undefined, "có quyền gửi tin thì trả lời công khai");
	});

	test("người không được gửi tin ở kênh chỉ nhận kết quả riêng", async () =>
	{
		const fake = createFakeServices();
		const { interaction, replies } = fakeInteraction({ canSend: false });
		await new RankCmd(fakeClient(fake.services)).execute(interaction);
		assert.equal(onlyEmbed(replies).author?.name, "Anh A");
		assert.equal(replies[0].flags, MessageFlags.Ephemeral);
	});

	test("xem thành viên khác: dùng member được chọn", async () =>
	{
		const fake = createFakeServices({ configuredTeams: [ROLE_BACKEND, ROLE_FRONTEND] });
		const { interaction, replies } = fakeInteraction({
			user: fakeUser(USER_B, "Người B"),
			member: { nick: null, roles: [ROLE_FRONTEND] },
		});
		await new RankCmd(fakeClient(fake.services)).execute(interaction);

		assert.deepEqual(fake.profileCalls, [`activity:${USER_B}`, `contribution:${USER_B}`]);
		const embed = onlyEmbed(replies);
		assert.equal(embed.author?.name, "Người B");
		assert.equal(fieldValue(embed, "👥 Team"), `<@&${ROLE_FRONTEND}>`);
	});

	test("thành viên đã rời server: không có team", async () =>
	{
		const fake = createFakeServices({ configuredTeams: [ROLE_BACKEND] });
		const { interaction, replies } = fakeInteraction({ user: fakeUser(USER_B, "Người B"), member: null });
		await new RankCmd(fakeClient(fake.services)).execute(interaction);
		assert.equal(fieldValue(onlyEmbed(replies), "👥 Team"), "Chưa thuộc team nào");
	});

	test("chọn bot thì báo lỗi cho người dùng", async () =>
	{
		const fake = createFakeServices();
		const { interaction, replies } = fakeInteraction({ user: fakeUser("700000000000000001", "Bot", true) });
		await assert.rejects(
			new RankCmd(fakeClient(fake.services)).execute(interaction),
			(error: unknown) => error instanceof UserError && error.message === "Bot không có điểm.",
		);
		assert.equal(fake.profileCalls.length, 0);
		assert.equal(replies.length, 0);
	});

	test("ngoài server thì báo lỗi cho người dùng", async () =>
	{
		const { interaction } = fakeInteraction({ inGuild: false });
		await assert.rejects(new RankCmd(fakeClient(createFakeServices().services)).execute(interaction), UserError);
	});
});

describe("/leaderboard", () =>
{
	test("định nghĩa: loai bắt buộc, pham-vi và trang tuỳ chọn", () =>
	{
		const json = new LeaderboardCmd(fakeClient(createFakeServices().services)).data.toJSON();
		assert.equal(json.name, "leaderboard");
		assert.ok(json.description.length <= 100);
		const options = json.options ?? [];
		assert.deepEqual(options.map(o => [o.name, o.required ?? false]), [["loai", true], ["pham-vi", false], ["trang", false]]);
		for (const option of options) assert.ok(option.description.length <= 100, option.name);

		const [kind, scope, page] = options;
		assert.ok("choices" in kind && "choices" in scope && "min_value" in page);
		assert.deepEqual(kind.choices?.map(c => c.value), ["activity", "contribution"]);
		assert.deepEqual(scope.choices?.map(c => c.value), ["ca-nhan", "team"]);
		assert.equal(page.min_value, 1);
	});

	test("mặc định: bảng cá nhân, trang 1", async () =>
	{
		const fake = createFakeServices({
			board: { entries: [{ rank: 1, id: USER_A, value: 1915 }], page: 1, totalPages: 1, totalEntries: 1, period: "all", since: null },
		});
		const { interaction, replies } = fakeInteraction({ strings: { loai: "activity" } });
		await new LeaderboardCmd(fakeClient(fake.services)).execute(interaction);

		assert.deepEqual(fake.boardCalls, [{ scope: "individual", guildId: GUILD, kind: "activity", page: 1 }]);
		const embed = onlyEmbed(replies);
		assert.equal(embed.title, "🏆 Bảng xếp hạng Activity XP — Cá nhân");
		assert.equal(embed.description, `🥇 <@${USER_A}> — Level 6 · 1.915 XP`);
		assert.equal(replies[0].flags, undefined, "có quyền gửi tin thì trả lời công khai");
	});

	test("người không được gửi tin ở kênh chỉ nhận bảng xếp hạng riêng", async () =>
	{
		const fake = createFakeServices();
		const { interaction, replies } = fakeInteraction({ strings: { loai: "activity" }, canSend: false });
		await new LeaderboardCmd(fakeClient(fake.services)).execute(interaction);
		assert.equal(onlyEmbed(replies).title, "🏆 Bảng xếp hạng Activity XP — Cá nhân");
		assert.equal(replies[0].flags, MessageFlags.Ephemeral);
	});

	test("bảng team Contribution, trang được chọn", async () =>
	{
		const fake = createFakeServices();
		const { interaction, replies } = fakeInteraction({ strings: { "loai": "contribution", "pham-vi": "team" }, integers: { trang: 2 } });
		await new LeaderboardCmd(fakeClient(fake.services)).execute(interaction);

		assert.deepEqual(fake.boardCalls, [{ scope: "team", guildId: GUILD, kind: "contribution", page: 2 }]);
		const embed = onlyEmbed(replies);
		assert.equal(embed.title, "🏆 Bảng xếp hạng Contribution — Team");
		assert.equal(embed.description, "Chưa có dữ liệu.");
		assert.equal(embed.footer?.text, "Trang 1/1 · 0 team");
	});

	test("giá trị option không hợp lệ thì báo lỗi cho người dùng", async () =>
	{
		const fake = createFakeServices();
		const command = new LeaderboardCmd(fakeClient(fake.services));
		const badKind = fakeInteraction({ strings: { loai: "xp" } });
		await assert.rejects(command.execute(badKind.interaction), UserError);
		const badScope = fakeInteraction({ strings: { "loai": "activity", "pham-vi": "phong-ban" } });
		await assert.rejects(command.execute(badScope.interaction), UserError);
		assert.equal(fake.boardCalls.length, 0);
	});
});
