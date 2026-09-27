import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "path";
import {
	APIApplicationCommandOption,
	APIEmbed,
	ApplicationCommandOptionType,
	ChannelType,
	ChatInputCommandInteraction,
	EmbedBuilder,
	GuildMember,
	InteractionReplyOptions,
	MessageFlags,
	PermissionFlagsBits,
	PermissionsBitField,
} from "discord.js";
import type DiscordClient from "../src/classes/DiscordClient";
import {
	auditActionLabel,
	buildAuditEmbed,
	buildConfigEmbed,
	buildStatsEmbed,
	buildXpDetailEmbed,
	describeChannelSettings,
	formatAuditDetails,
	formatXpEvent,
	inlineText,
	signed,
} from "../src/discord/views/admin";
import { BackupKind } from "../src/db/backup";
import AdminCmd from "../src/interactions/commands/admin";
import ConfigCmd from "../src/interactions/commands/config";
import { levelInfo } from "../src/modules/activity/levels";
import { DEFAULT_TIER_SET } from "../src/modules/activity/tiers";
import { ActivityProfile, ActivityServiceApi, MessageXpResult, XpAdjustInput, XpEventView } from "../src/modules/activity/types";
import { AuditAction, AuditEntry } from "../src/modules/audit/AuditService";
import {
	Contribution,
	ContributionAdjustInput,
	ContributionProfile,
	ContributionServiceApi,
	ContributionVoteResult,
} from "../src/modules/contribution/types";
import { TierRoleService } from "../src/modules/gamification/TierRoleService";
import { ChannelSettings, DEFAULT_GUILD_SETTINGS, NumericSettingKey, SETTING_LIMITS } from "../src/modules/guild-config/types";
import { LiveBoardService } from "../src/modules/live-board/LiveBoardService";
import { GuildStatistics } from "../src/modules/statistics/types";
import { AppServices } from "../src/services";
import { ADMIN, CHANNEL_BOT, CHANNEL_GENERAL, createTestContext, GUILD, ROLE_BACKEND, ROLE_FRONTEND, ROLE_OTHER, TestContext, USER_A } from "./helpers";

const BOT_USER = "900000000000000001";
const NOW = Date.UTC(2026, 0, 1);
const MINUTE = 60_000;
const PUBLIC_MESSAGE = "600000000000000001";
const NO_CHANGE = "Hãy chọn ít nhất một giá trị để thay đổi.";
const RESET_REFUSED = "Để reset toàn bộ, nhập chính xác: XAC NHAN";

// Kiểm tra đủ mọi AuditAction lúc compile: thiếu một khoá là lỗi type.
const AUDIT_ACTIONS: Record<AuditAction, true> = {
	"config.update": true,
	"channel.set": true,
	"channel.reset": true,
	"team.add": true,
	"team.remove": true,
	"xp.adjust": true,
	"xp.reset_user": true,
	"xp.reset_all": true,
	"contribution.remove": true,
	"contribution.adjust": true,
	"contribution.reset_user": true,
	"contribution.reset_all": true,
	"poll.create": true,
	"poll.close": true,
	"tier_role.set": true,
	"tier_role.clear": true,
	"tier_role.setup": true,
	"tier_set.set": true,
	"tier_name.set": true,
	"tier_name.reset": true,
	"board.set": true,
	"board.clear": true,
	"backup.manual": true,
};
const ALL_ACTIONS = Object.keys(AUDIT_ACTIONS) as AuditAction[];

const SAMPLE_STATS: GuildStatistics = {
	activity: {
		members: 42,
		totalXp: 1234567,
		xpLast7Days: 8900,
		messageAwardsLast7Days: 1500,
		topChannelsLast7Days: [{ channelId: CHANNEL_GENERAL, awards: 1200 }, { channelId: CHANNEL_BOT, awards: 300 }],
	},
	contribution: { total: 17, last7Days: 4, votes: 2345, totalScore: 3000 },
	polls: { total: 6, open: 1, participations: 1024 },
	teams: 3,
};

function unused(): Error
{
	return new Error("Không dùng trong test này.");
}

function xpEvent(overrides: Partial<XpEventView>): XpEventView
{
	return { id: 1, amount: 10, source: "message", referenceId: null, actorId: null, reason: null, createdAt: NOW, voided: false, ...overrides };
}

function sampleContribution(id: number, posted: boolean): Contribution
{
	return {
		id,
		guildId: GUILD,
		authorId: USER_A,
		submittedBy: USER_A,
		title: "Tài liệu *onboarding*",
		description: "Mô tả",
		category: "tai-lieu",
		link: null,
		channelId: posted ? CHANNEL_GENERAL : null,
		messageId: posted ? PUBLIC_MESSAGE : null,
		status: "removed",
		createdAt: NOW,
		votes: 3,
	};
}

class FakeActivity implements ActivityServiceApi
{
	readonly adjustCalls: XpAdjustInput[] = [];
	readonly resetUserCalls: string[] = [];
	resetAllCalls = 0;
	recentLimit: number | null = null;
	totalXp = 1234;
	events: XpEventView[] = [xpEvent({ id: 2, amount: -50, source: "admin", reason: "spam", voided: true }), xpEvent({ id: 1 })];

	handleMessage(): MessageXpResult
	{
		throw unused();
	}

	getProfile(_guildId: string, userId: string): ActivityProfile
	{
		return { userId, level: levelInfo(this.totalXp), rank: 3, totalRanked: 20 };
	}

	adjustXp(input: XpAdjustInput): { totalXp: number }
	{
		this.adjustCalls.push(input);
		this.totalXp += input.delta;
		return { totalXp: this.totalXp };
	}

	resetUser(_guildId: string, userId: string): { voidedEvents: number }
	{
		this.resetUserCalls.push(userId);
		return { voidedEvents: 7 };
	}

	resetAll(): { voidedEvents: number; members: number }
	{
		this.resetAllCalls++;
		return { voidedEvents: 1500, members: 42 };
	}

	recentEvents(_guildId: string, _userId: string, limit: number): XpEventView[]
	{
		this.recentLimit = limit;
		return this.events;
	}
}

class FakeContributions implements ContributionServiceApi
{
	readonly adjustCalls: ContributionAdjustInput[] = [];
	readonly removed: number[] = [];
	readonly resetUserCalls: string[] = [];
	resetAllCalls = 0;
	/** Contribution bị gỡ đã có message công khai hay chưa. */
	posted = true;

	submit(): Contribution
	{
		throw unused();
	}

	attachMessage(): void
	{
		throw unused();
	}

	get(): Contribution | null
	{
		throw unused();
	}

	list(): Contribution[]
	{
		throw unused();
	}

	toggleVote(): ContributionVoteResult
	{
		throw unused();
	}

	remove(_guildId: string, contributionId: number): Contribution
	{
		this.removed.push(contributionId);
		return sampleContribution(contributionId, this.posted);
	}

	adjust(input: ContributionAdjustInput): { score: number }
	{
		this.adjustCalls.push(input);
		return { score: 12 + input.delta };
	}

	resetUser(_guildId: string, userId: string): { voidedEvents: number }
	{
		this.resetUserCalls.push(userId);
		return { voidedEvents: 3 };
	}

	resetAll(): { voidedEvents: number; members: number }
	{
		this.resetAllCalls++;
		return { voidedEvents: 80, members: 9 };
	}

	getProfile(): ContributionProfile
	{
		throw unused();
	}
}

/** Backup giả: ghi lại loại bản sao lưu được yêu cầu; `latest` là thời điểm bản thủ công gần nhất. */
class FakeBackup
{
	readonly created: BackupKind[] = [];
	readonly latestQueries: BackupKind[] = [];
	latest: number | null = null;

	constructor(private readonly path: string)
	{}

	createBackup(kind: BackupKind): Promise<string>
	{
		this.created.push(kind);
		return Promise.resolve(this.path);
	}

	latestBackupAt(kind: BackupKind): number | null
	{
		this.latestQueries.push(kind);
		return this.latest;
	}
}

interface MessageEdit
{
	channelId: string;
	messageId: string;
	payload: { embeds?: EmbedBuilder[]; components?: unknown[] };
}

interface Harness
{
	context: TestContext;
	activity: FakeActivity;
	contributions: FakeContributions;
	backup: FakeBackup;
	backupPath: string;
	/** Các lần bot sửa message công khai. */
	messageEdits: MessageEdit[];
	/** Sửa message thì lỗi (ví dụ message đã bị xoá). */
	failEdits: { value: boolean };
	tierRoles: TierRoleService;
	liveBoards: LiveBoardService;
	admin: AdminCmd;
	config: ConfigCmd;
}

/**
 * GuildConfig, Team, Audit, TierRole, LiveBoard là service thật trên SQLite :memory:;
 * Activity, Contribution, Statistics, Backup là fake.
 */
function createHarness(): Harness
{
	const context = createTestContext();
	const tierRoles = new TierRoleService(context.db, context.clock, context.deps.audit);
	const liveBoards = new LiveBoardService(context.db, context.clock, context.deps.audit);
	const activity = new FakeActivity();
	const contributions = new FakeContributions();
	const backupPath = join("/srv", "company-bot", "backups", "bot-manual-2026-01-01T00-00-00-000Z.db");
	const backup = new FakeBackup(backupPath);
	const messageEdits: MessageEdit[] = [];
	const failEdits = { value: false };
	const services = {
		clock: context.clock,
		guildConfig: context.deps.guildConfig,
		teams: context.deps.teams,
		audit: context.deps.audit,
		tierSets: context.deps.tierSets,
		activity,
		contributions,
		statistics: { summary: (): GuildStatistics => SAMPLE_STATS },
		tierRoles,
		liveBoards,
		backup,
	} as unknown as AppServices;
	const channels = {
		fetch: (channelId: string) => Promise.resolve({
			isTextBased: () => true,
			messages: {
				edit: (messageId: string, payload: MessageEdit["payload"]) =>
				{
					if (failEdits.value) return Promise.reject(new Error("Unknown Message"));
					messageEdits.push({ channelId, messageId, payload });
					return Promise.resolve();
				},
			},
		}),
	};
	const client = { services, channels } as unknown as DiscordClient;
	return {
		context,
		activity,
		contributions,
		backup,
		backupPath,
		messageEdits,
		failEdits,
		tierRoles,
		liveBoards,
		admin: new AdminCmd(client),
		config: new ConfigCmd(client),
	};
}

interface Invocation
{
	group?: string;
	subcommand: string;
	options?: Record<string, unknown>;
	/** Member của option thanh-vien: dữ liệu API thô (chỉ cần roles) hoặc GuildMember giả (fakeGuildMember). */
	member?: { roles: string[] } | GuildMember;
}

interface FakeInteraction
{
	interaction: ChatInputCommandInteraction;
	replies: InteractionReplyOptions[];
	deferred: unknown[];
	edits: unknown[];
}

/** Interaction giả: chỉ có những gì command dùng tới (option, reply, defer). */
function invoke(call: Invocation): FakeInteraction
{
	const values = call.options ?? {};
	const get = (name: string): unknown => (Object.hasOwn(values, name) ? values[name] : null);
	const replies: InteractionReplyOptions[] = [];
	const deferred: unknown[] = [];
	const edits: unknown[] = [];
	const fake = {
		guildId: GUILD,
		user: { id: ADMIN, bot: false },
		inGuild: (): boolean => true,
		options: {
			getSubcommandGroup: (): string | null => call.group ?? null,
			getSubcommand: (): string => call.subcommand,
			getUser: get,
			getMember: (): unknown => call.member ?? null,
			getInteger: get,
			getString: get,
			getBoolean: get,
			getRole: get,
			getChannel: get,
		},
		reply: (payload: InteractionReplyOptions): Promise<void> =>
		{
			replies.push(payload);
			return Promise.resolve();
		},
		deferReply: (payload: unknown): Promise<void> =>
		{
			deferred.push(payload);
			return Promise.resolve();
		},
		editReply: (payload: unknown): Promise<void> =>
		{
			edits.push(payload);
			return Promise.resolve();
		},
	};
	return { interaction: fake as unknown as ChatInputCommandInteraction, replies, deferred, edits };
}

async function run(command: AdminCmd | ConfigCmd, call: Invocation): Promise<FakeInteraction>
{
	const fake = invoke(call);
	await command.execute(fake.interaction);
	return fake;
}

async function rejects(command: AdminCmd | ConfigCmd, call: Invocation, message: string): Promise<void>
{
	const fake = invoke(call);
	await assert.rejects(command.execute(fake.interaction), { name: "UserError", message });
	assert.equal(fake.replies.length, 0);
}

function onlyReply(fake: FakeInteraction): InteractionReplyOptions
{
	assert.equal(fake.replies.length, 1);
	const [reply] = fake.replies;
	assert.equal(reply.flags, MessageFlags.Ephemeral, "mọi reply phải là ephemeral");
	return reply;
}

function replyText(fake: FakeInteraction): string
{
	const { content } = onlyReply(fake);
	assert.ok(typeof content === "string");
	return content;
}

function replyEmbed(fake: FakeInteraction): APIEmbed
{
	const embed = onlyReply(fake).embeds?.[0];
	assert.ok(embed);
	return "toJSON" in embed ? embed.toJSON() : embed;
}

/** Toàn bộ chữ trong embed, để tìm nội dung mà không phụ thuộc bố cục. */
function embedText(embed: APIEmbed): string
{
	const fields = (embed.fields ?? []).map(field => `${field.name}\n${field.value}`);
	return [embed.title, embed.description, ...fields, embed.footer?.text].filter(part => part !== undefined).join("\n");
}

const user = (id: string, bot = false): { id: string; bot: boolean } => ({ id, bot });
const role = (id: string, managed = false): { id: string; managed: boolean } => ({ id, managed });
const channel = (id: string): { id: string; type: ChannelType } => ({ id, type: ChannelType.GuildText });
const MEMBER = { roles: [ROLE_BACKEND] };

const ROLE_LUYEN_KHI = "510000000000000001";
const ROLE_TRUC_CO = "510000000000000002";
const BOT_ROLE = "510000000000000099";

interface RoleChange
{
	action: "add" | "remove";
	roleId: string;
	reason: string | undefined;
}

/**
 * GuildMember giả (qua được `instanceof GuildMember`) đang giữ `roleIds`. Server có hai role cảnh giới nằm dưới role cao nhất
 * của bot (BOT_ROLE), bot có Manage Roles. Ghi lại các lần bot thêm/bỏ role.
 */
function fakeGuildMember(roleIds: string[]): { member: GuildMember; changes: RoleChange[] }
{
	const changes: RoleChange[] = [];
	const guildRole = (id: string, position: number): object => ({
		id,
		position,
		managed: false,
		guild: { id: GUILD, channels: { cache: new Map() } },
		permissions: new PermissionsBitField(),
	});
	const guild = {
		id: GUILD,
		members: { me: { permissions: new PermissionsBitField([PermissionFlagsBits.ManageRoles]), roles: { highest: guildRole(BOT_ROLE, 10) } } },
		roles: {
			cache: new Map([
				[ROLE_LUYEN_KHI, guildRole(ROLE_LUYEN_KHI, 1)],
				[ROLE_TRUC_CO, guildRole(ROLE_TRUC_CO, 2)],
				[BOT_ROLE, guildRole(BOT_ROLE, 10)],
			]),
		},
	};
	const record = (action: RoleChange["action"]) => (roleId: string, reason?: string): Promise<void> =>
	{
		changes.push({ action, roleId, reason });
		return Promise.resolve();
	};
	const fake = { guild, user: { id: USER_A }, roles: { cache: new Map(roleIds.map(id => [id, { id }])), add: record("add"), remove: record("remove") } };
	return { member: Object.setPrototypeOf(fake, GuildMember.prototype) as GuildMember, changes };
}

function children(option: APIApplicationCommandOption): APIApplicationCommandOption[]
{
	if (option.type === ApplicationCommandOptionType.Subcommand || option.type === ApplicationCommandOptionType.SubcommandGroup)
	{
		return option.options ?? [];
	}
	return [];
}

function optionAt(options: readonly APIApplicationCommandOption[] | undefined, ...path: string[]): APIApplicationCommandOption
{
	let current: readonly APIApplicationCommandOption[] = options ?? [];
	let found: APIApplicationCommandOption | undefined;
	for (const name of path)
	{
		found = current.find(option => option.name === name);
		assert.ok(found, `không có option ${path.join(" ")}`);
		current = children(found);
	}
	assert.ok(found);
	return found;
}

function names(options: readonly APIApplicationCommandOption[]): string[]
{
	return options.map(option => option.name);
}

function integerRange(option: APIApplicationCommandOption): { min?: number; max?: number; required: boolean }
{
	if (option.type !== ApplicationCommandOptionType.Integer) throw new Error(`${option.name} không phải option số nguyên`);
	return { min: option.min_value, max: option.max_value, required: option.required ?? false };
}

function allOptions(options: readonly APIApplicationCommandOption[]): APIApplicationCommandOption[]
{
	return options.flatMap(option => [option, ...allOptions(children(option))]);
}

describe("định nghĩa /admin và /config", () =>
{
	const { admin, config } = createHarness();
	const adminJson = admin.data.toJSON();
	const configJson = config.data.toJSON();

	test("hai lớp quyền: adminOnly và default_member_permissions = Manage Server (PROP-013)", () =>
	{
		for (const command of [admin, config])
		{
			assert.equal(command.adminOnly, true);
			assert.equal(command.data.toJSON().default_member_permissions, PermissionFlagsBits.ManageGuild.toString());
		}
	});

	test("cấu trúc subcommand đúng spec, tên tiếng Anh", () =>
	{
		assert.deepEqual(names(adminJson.options ?? []), ["xp", "contribution", "stats", "audit", "backup"]);
		assert.deepEqual(names(children(optionAt(adminJson.options, "xp"))), ["view", "give", "remove", "reset", "reset-all"]);
		assert.deepEqual(names(children(optionAt(adminJson.options, "contribution"))), ["adjust", "remove", "reset", "reset-all"]);
		assert.deepEqual(
			names(configJson.options ?? []),
			["view", "xp", "channel", "team", "admin-role", "poll", "contribution", "tier", "board"],
		);
		assert.deepEqual(names(children(optionAt(configJson.options, "channel"))), ["set", "reset", "list"]);
		assert.deepEqual(names(children(optionAt(configJson.options, "team"))), ["add", "remove", "list"]);
		assert.deepEqual(
			names(children(optionAt(configJson.options, "tier"))),
			["panel", "set-role", "clear-role", "list", "style", "rename", "reset-names", "setup-roles"],
		);
		assert.deepEqual(names(children(optionAt(configJson.options, "poll"))), ["xp-mac-dinh", "gioi-han-xp-ngay", "role-tao-vote", "xoa-role-tao-vote"]);
	});

	test("tên option tiếng Việt không dấu kebab-case, mô tả không quá 100 ký tự (DEC-020)", () =>
	{
		for (const json of [adminJson, configJson])
		{
			assert.ok(json.description.length <= 100);
			for (const option of allOptions(json.options ?? []))
			{
				assert.match(option.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, option.name);
				assert.ok(option.description.length <= 100, option.name);
			}
		}
	});

	test("/admin: giới hạn so-xp, diem, so-luong", () =>
	{
		assert.deepEqual(integerRange(optionAt(adminJson.options, "xp", "give", "so-xp")), { min: 1, max: 1_000_000, required: true });
		assert.deepEqual(integerRange(optionAt(adminJson.options, "xp", "remove", "so-xp")), { min: 1, max: 1_000_000, required: true });
		assert.deepEqual(integerRange(optionAt(adminJson.options, "contribution", "adjust", "diem")), { min: -1_000_000, max: 1_000_000, required: true });
		assert.deepEqual(integerRange(optionAt(adminJson.options, "audit", "so-luong")), { min: 1, max: 25, required: false });
	});

	test("/config: min/max lấy theo SETTING_LIMITS; channel nhận text, announcement, forum, voice, stage, media", () =>
	{
		const expectRange = (key: NumericSettingKey, required: boolean, ...path: string[]): void =>
		{
			const { min, max } = SETTING_LIMITS[key];
			assert.deepEqual(integerRange(optionAt(configJson.options, ...path)), { min, max, required }, path.join(" "));
		};
		expectRange("xpPerMessage", false, "xp", "xp-moi-tin");
		expectRange("xpCooldownSeconds", false, "xp", "cooldown-giay");
		expectRange("minMessageLength", false, "xp", "do-dai-toi-thieu");
		expectRange("duplicateWindowSeconds", false, "xp", "chong-trung-giay");
		expectRange("xpPerMessage", false, "channel", "set", "xp-moi-tin");
		expectRange("xpCooldownSeconds", false, "channel", "set", "cooldown-giay");
		expectRange("defaultPollXp", false, "poll", "xp-mac-dinh");
		expectRange("pollXpDailyCap", false, "poll", "gioi-han-xp-ngay");
		expectRange("contributionVotePoints", true, "contribution", "diem-moi-luot");

		const expectedTypes = [
			ChannelType.GuildText,
			ChannelType.GuildAnnouncement,
			ChannelType.GuildForum,
			ChannelType.GuildVoice,
			ChannelType.GuildStageVoice,
			ChannelType.GuildMedia,
		];
		for (const subcommand of ["set", "reset"])
		{
			const kenh = optionAt(configJson.options, "channel", subcommand, "kenh");
			assert.equal(kenh.type, ApplicationCommandOptionType.Channel);
			if (kenh.type === ApplicationCommandOptionType.Channel) assert.deepEqual(kenh.channel_types, expectedTypes, subcommand);
		}
	});
});

describe("views quản trị", () =>
{
	test("mọi AuditAction có nhãn tiếng Việt riêng", () =>
	{
		const labels = ALL_ACTIONS.map(auditActionLabel);
		for (const [index, label] of labels.entries())
		{
			assert.ok(label.length > 0);
			assert.notEqual(label, ALL_ACTIONS[index]);
		}
		assert.equal(new Set(labels).size, labels.length);
		assert.equal(auditActionLabel("xp.reset_all"), "Reset XP toàn server");
	});

	test("số có dấu dùng định dạng vi-VN và dấu trừ U+2212", () =>
	{
		assert.equal(signed(1234), "+1.234");
		assert.equal(signed(-1234567), "−1.234.567");
	});

	test("dòng biến động XP: dấu, số, nguồn, lý do đã escape, thời gian tương đối", () =>
	{
		assert.equal(formatXpEvent(xpEvent({ amount: 10 })), `**+10 XP** · tin nhắn · <t:${NOW / 1000}:R>`);
		const adminLine = formatXpEvent(xpEvent({ amount: -1500, source: "admin", reason: "spam *link*" }));
		assert.equal(adminLine, `**−1.500 XP** · admin · spam \\*link\\* · <t:${NOW / 1000}:R>`);
		assert.match(formatXpEvent(xpEvent({ amount: 5, source: "poll" })), /· vote ·/);
		assert.ok(!formatXpEvent(xpEvent({ reason: "dòng 1\n\ndòng 2" })).includes("\n"));
		assert.equal(inlineText("  a\n b  ", 50), "a b");
	});

	test("event đã huỷ bị gạch ngang", () =>
	{
		const line = formatXpEvent(xpEvent({ amount: 10, voided: true }));
		assert.ok(line.startsWith("~~**+10 XP**"));
		assert.ok(line.endsWith("~~ (đã huỷ)"));
		assert.ok(!formatXpEvent(xpEvent({ amount: 10 })).includes("~~"));
	});

	test("embed chi tiết XP: level, tổng XP, hạng, biến động", () =>
	{
		const profile: ActivityProfile = { userId: USER_A, level: levelInfo(1234), rank: 3, totalRanked: 1500 };
		const embed = buildXpDetailEmbed(profile, [xpEvent({ amount: 10 }), xpEvent({ amount: -5, voided: true })], DEFAULT_TIER_SET).toJSON();
		assert.ok(embed.description?.includes(`<@${USER_A}>`));
		assert.ok(embed.description?.includes("~~"));
		const fields = Object.fromEntries((embed.fields ?? []).map(field => [field.name, field.value]));
		assert.equal(fields["Level"], String(levelInfo(1234).level));
		assert.equal(fields["Tổng XP"], "1.234");
		assert.equal(fields["Hạng"], "#3 / 1.500");
		assert.equal(fields["Cảnh giới"], "🧱 Trúc Cơ");

		const empty = buildXpDetailEmbed({ ...profile, rank: null, level: levelInfo(0) }, [], DEFAULT_TIER_SET).toJSON();
		assert.ok(empty.description?.includes("Chưa có biến động nào."));
		assert.ok(embedText(empty).includes("Chưa xếp hạng"));
	});

	test("embed thống kê: số định dạng vi-VN, top channel dạng <#id>", () =>
	{
		const text = embedText(buildStatsEmbed(SAMPLE_STATS).toJSON());
		assert.ok(text.includes("Tổng XP: **1.234.567**"));
		assert.ok(text.includes("Lượt ghi nhận: **2.345**"));
		assert.ok(text.includes(`1. <#${CHANNEL_GENERAL}> · **1.200** lượt`));
		assert.ok(text.includes(`2. <#${CHANNEL_BOT}>`));

		const quiet = { ...SAMPLE_STATS, activity: { ...SAMPLE_STATS.activity, topChannelsLast7Days: [] } };
		assert.ok(embedText(buildStatsEmbed(quiet).toJSON()).includes("Chưa có dữ liệu."));
	});

	test("embed audit: nhãn tiếng Việt, người thực hiện, đối tượng theo loại, chi tiết", () =>
	{
		const entry = (id: number, action: AuditAction, targetId: string | null, details: Record<string, unknown> | null): AuditEntry =>
			({ id, guildId: GUILD, actorId: ADMIN, action, targetId, details, createdAt: NOW });
		const embed = buildAuditEmbed([
			entry(3, "xp.adjust", USER_A, { delta: -50, reason: "spam" }),
			entry(2, "team.add", ROLE_BACKEND, null),
			entry(1, "config.update", null, { xpPerMessage: 15, levelUpAnnouncements: false, adminRoleId: ROLE_FRONTEND }),
		]).toJSON();
		const description = embed.description ?? "";
		assert.ok(description.includes(`**Điều chỉnh XP** · <t:${NOW / 1000}:f>`));
		assert.ok(description.includes(`Người thực hiện: <@${ADMIN}> · Đối tượng: <@${USER_A}>`));
		assert.ok(description.includes("Thay đổi: −50 · Lý do: spam"));
		assert.ok(description.includes(`Đối tượng: <@&${ROLE_BACKEND}>`));
		assert.ok(description.includes(`XP mỗi tin nhắn: 15 · Thông báo lên level: Tắt · Role admin bot: <@&${ROLE_FRONTEND}>`));
		assert.ok(!description.includes("xp.adjust"));

		assert.equal(formatAuditDetails({ adminRoleId: null }), "Role admin bot: không có");
		assert.equal(formatAuditDetails({}), null);
		assert.ok(buildAuditEmbed([]).toJSON().description?.includes("Chưa có thao tác quản trị nào"));
	});

	test("embed audit 25 mục dài vẫn trong giới hạn của Discord", () =>
	{
		const entries: AuditEntry[] = Array.from({ length: 25 }, (_, index) => ({
			id: index,
			guildId: GUILD,
			actorId: ADMIN,
			action: "xp.adjust",
			targetId: USER_A,
			details: { delta: 1000000, reason: "x".repeat(200), note: "y".repeat(200) },
			createdAt: NOW,
		}));
		const embed = buildAuditEmbed(entries).toJSON();
		assert.ok((embed.description ?? "").length <= 4096);
		assert.match(embed.description ?? "", /… và \d+ mục khác/);
	});

	test("embed cấu hình: đủ mọi mục, team và channel riêng", () =>
	{
		const channels: ChannelSettings[] = [
			{ channelId: CHANNEL_BOT, xpEnabled: false, xpPerMessage: null, xpCooldownSeconds: null },
			{ channelId: CHANNEL_GENERAL, xpEnabled: true, xpPerMessage: 20, xpCooldownSeconds: 30 },
		];
		const gamification = {
			boardChannelId: CHANNEL_GENERAL,
			tierRoles: [{ tierKey: "bac-1", roleId: ROLE_LUYEN_KHI, createdByBot: false }, { tierKey: "bac-2", roleId: ROLE_TRUC_CO, createdByBot: false }] as const,
			tierSet: DEFAULT_TIER_SET,
		};
		const embed = buildConfigEmbed({ ...DEFAULT_GUILD_SETTINGS, pollCreatorRoleId: ROLE_OTHER }, [ROLE_BACKEND, ROLE_FRONTEND], channels, gamification).toJSON();
		const text = embedText(embed);
		for (const expected of [
			"XP mỗi tin nhắn: **10 XP**",
			"Cooldown: **60 giây**",
			"Độ dài tối thiểu: **5 ký tự**",
			"Chống trùng: **300 giây**",
			"Thông báo lên level: **Bật**",
			"XP mặc định khi vote: **5 XP**",
			"Giới hạn XP từ vote mỗi ngày: **25 XP**",
			`Role tạo vote: **<@&${ROLE_OTHER}>**`,
			"Điểm mỗi lượt ghi nhận: **1 điểm**",
			"Role admin bot: **chưa đặt**",
			`1. <@&${ROLE_BACKEND}>`,
			`2. <@&${ROLE_FRONTEND}>`,
			`<#${CHANNEL_BOT}>: tắt XP`,
			`<#${CHANNEL_GENERAL}>: bật XP, 20 XP/tin, cooldown 30 giây`,
			`🏆 Bảng vàng\n<#${CHANNEL_GENERAL}>`,
			"Danh hiệu: bộ Tu tiên · role đã gán 2/8",
			`🌱 Luyện Khí (Lv 0+): <@&${ROLE_LUYEN_KHI}>`,
			`🧱 Trúc Cơ (Lv 3+): <@&${ROLE_TRUC_CO}>`,
		])
		{
			assert.ok(text.includes(expected), `thiếu "${expected}"`);
		}

		const empty = embedText(buildConfigEmbed({ ...DEFAULT_GUILD_SETTINGS, pollXpDailyCap: 0 }, [], [], { boardChannelId: null, tierRoles: [], tierSet: DEFAULT_TIER_SET }).toJSON());
		assert.ok(empty.includes("Chưa có team nào"));
		assert.ok(empty.includes("Mọi channel dùng cấu hình chung"));
		assert.ok(empty.includes("Giới hạn XP từ vote mỗi ngày: **không giới hạn**"));
		assert.ok(empty.includes("Đang tắt. Dùng `/config board` để bật."));
		assert.ok(empty.includes("Chưa gán role nào. Dùng `/config tier set-role` để gán."));
	});

	test("embed cấu hình rất nhiều channel vẫn vừa giới hạn field", () =>
	{
		const channels: ChannelSettings[] = Array.from({ length: 200 }, (_, index) => ({
			channelId: `4000000000000${String(index).padStart(5, "0")}`,
			xpEnabled: true,
			xpPerMessage: 100,
			xpCooldownSeconds: 3600,
		}));
		const embed = buildConfigEmbed(DEFAULT_GUILD_SETTINGS, [], channels, { boardChannelId: null, tierRoles: [], tierSet: DEFAULT_TIER_SET }).toJSON();
		const field = embed.fields?.find(candidate => candidate.name.startsWith("📺"));
		assert.ok(field);
		assert.ok(field.value.length <= 1024);
		assert.match(field.value, /… và \d+ channel khác/);
	});

	test("mô tả cấu hình channel", () =>
	{
		const base = { channelId: CHANNEL_GENERAL, xpEnabled: true, xpPerMessage: null, xpCooldownSeconds: null };
		assert.equal(describeChannelSettings(base), "bật XP, dùng giá trị chung");
		assert.equal(describeChannelSettings({ ...base, xpCooldownSeconds: 90 }), "bật XP, cooldown 90 giây");
		assert.equal(describeChannelSettings({ ...base, xpEnabled: false, xpPerMessage: 5 }), "tắt XP");
	});

	test("văn bản một dòng do người dùng nhập: masked link bị vô hiệu hoá", () =>
	{
		assert.equal(inlineText("Sửa [tài liệu](https://evil.example)", 100), "Sửa tài liệu (https://evil.example)");
	});
});

describe("/admin", () =>
{
	test("xp view: embed hồ sơ và 10 biến động gần nhất", async () =>
	{
		const { admin, activity } = createHarness();
		const embed = replyEmbed(await run(admin, { group: "xp", subcommand: "view", options: { "thanh-vien": user(USER_A) } }));
		assert.equal(activity.recentLimit, 10);
		assert.ok(embed.description?.includes(`<@${USER_A}>`));
		assert.ok(embed.description?.includes("~~**−50 XP** · admin · spam"));
	});

	test("xp give: delta dương, lý do đã trim, role của thành viên; reply tổng mới", async () =>
	{
		const { admin, activity } = createHarness();
		const fake = await run(admin, {
			group: "xp",
			subcommand: "give",
			options: { "thanh-vien": user(USER_A), "so-xp": 50, "ly-do": "  thưởng  " },
			member: MEMBER,
		});
		assert.deepEqual(activity.adjustCalls, [{ guildId: GUILD, userId: USER_A, delta: 50, actorId: ADMIN, reason: "thưởng", roleIds: [ROLE_BACKEND] }]);
		assert.equal(replyText(fake), `Đã cộng 50 XP cho <@${USER_A}>. Tổng: 1.284 XP.`);
	});

	test("xp remove: delta âm, lý do trống thành null", async () =>
	{
		const { admin, activity } = createHarness();
		const fake = await run(admin, { group: "xp", subcommand: "remove", options: { "thanh-vien": user(USER_A), "so-xp": 50, "ly-do": "   " } });
		assert.equal(activity.adjustCalls[0].delta, -50);
		assert.equal(activity.adjustCalls[0].reason, null);
		assert.deepEqual(activity.adjustCalls[0].roleIds, []);
		assert.equal(replyText(fake), `Đã trừ 50 XP của <@${USER_A}>. Tổng: 1.184 XP.`);
	});

	test("không thao tác được với bot", async () =>
	{
		const { admin, activity, contributions } = createHarness();
		const target = { "thanh-vien": user(BOT_USER, true) };
		await rejects(admin, { group: "xp", subcommand: "give", options: { ...target, "so-xp": 5 } }, "Không thể thao tác với bot.");
		await rejects(admin, { group: "xp", subcommand: "view", options: target }, "Không thể thao tác với bot.");
		await rejects(admin, { group: "contribution", subcommand: "reset", options: target }, "Không thể thao tác với bot.");
		assert.equal(activity.adjustCalls.length, 0);
		assert.equal(contributions.resetUserCalls.length, 0);
	});

	test("xp reset một thành viên", async () =>
	{
		const { admin, activity } = createHarness();
		const fake = await run(admin, { group: "xp", subcommand: "reset", options: { "thanh-vien": user(USER_A) } });
		assert.deepEqual(activity.resetUserCalls, [USER_A]);
		assert.ok(replyText(fake).includes("huỷ 7 biến động"));
	});

	test("xp reset-all: sai chuỗi xác nhận thì từ chối, đúng thì reset", async () =>
	{
		const { admin, activity } = createHarness();
		for (const wrong of ["xac nhan", "XÁC NHẬN", "XAC  NHAN"])
		{
			await rejects(admin, { group: "xp", subcommand: "reset-all", options: { "xac-nhan": wrong } }, RESET_REFUSED);
		}
		assert.equal(activity.resetAllCalls, 0);

		const fake = await run(admin, { group: "xp", subcommand: "reset-all", options: { "xac-nhan": "XAC NHAN" } });
		assert.equal(activity.resetAllCalls, 1);
		assert.equal(
			replyText(fake),
			"Đã reset XP toàn server: huỷ 1.500 biến động của 42 thành viên.\nRole cảnh giới sẽ tự cập nhật khi từng thành viên nhắn tin được XP.",
		);
	});

	test("xp give: thành viên là GuildMember thì đồng bộ role cảnh giới theo tổng XP mới, rồi sửa phản hồi thêm một dòng", async () =>
	{
		const { admin, tierRoles } = createHarness();
		tierRoles.set(GUILD, "bac-1", ROLE_LUYEN_KHI, ADMIN);
		tierRoles.set(GUILD, "bac-2", ROLE_TRUC_CO, ADMIN);
		const { member, changes } = fakeGuildMember([ROLE_BACKEND, ROLE_LUYEN_KHI]);

		const fake = await run(admin, { group: "xp", subcommand: "give", options: { "thanh-vien": user(USER_A), "so-xp": 50 }, member });
		const text = `Đã cộng 50 XP cho <@${USER_A}>. Tổng: 1.284 XP.`;
		assert.equal(replyText(fake), text, "trả lời trước khi gọi API role");
		assert.deepEqual(changes, [
			{ action: "add", roleId: ROLE_TRUC_CO, reason: "Cảnh giới tu luyện (admin điều chỉnh XP)" },
			{ action: "remove", roleId: ROLE_LUYEN_KHI, reason: "Cảnh giới tu luyện (admin điều chỉnh XP)" },
		]);
		assert.deepEqual(fake.edits, [`${text}\n☯️ Role cảnh giới: đã thêm <@&${ROLE_TRUC_CO}> · đã bỏ <@&${ROLE_LUYEN_KHI}>.`]);
	});

	test("xp reset: về Level 0 thì chuyển về role Luyện Khí; xp remove không đổi cảnh giới thì không sửa phản hồi", async () =>
	{
		const { admin, tierRoles } = createHarness();
		tierRoles.set(GUILD, "bac-1", ROLE_LUYEN_KHI, ADMIN);
		tierRoles.set(GUILD, "bac-2", ROLE_TRUC_CO, ADMIN);

		const reset = fakeGuildMember([ROLE_TRUC_CO]);
		const fake = await run(admin, { group: "xp", subcommand: "reset", options: { "thanh-vien": user(USER_A) }, member: reset.member });
		assert.deepEqual(reset.changes.map(change => [change.action, change.roleId]), [["add", ROLE_LUYEN_KHI], ["remove", ROLE_TRUC_CO]]);
		assert.equal(fake.edits.length, 1);
		assert.ok(String(fake.edits[0]).startsWith(`${replyText(fake)}\n☯️ Role cảnh giới:`));

		const unchanged = fakeGuildMember([ROLE_TRUC_CO]);
		const removed = await run(admin, { group: "xp", subcommand: "remove", options: { "thanh-vien": user(USER_A), "so-xp": 10 }, member: unchanged.member });
		assert.deepEqual(unchanged.changes, []);
		assert.deepEqual(removed.edits, []);
	});

	test("xp give: role cảnh giới không đổi được (nằm trên role của bot) thì phản hồi ghi rõ", async (t) =>
	{
		t.mock.method(console, "error", () => undefined);
		const { admin, tierRoles } = createHarness();
		tierRoles.set(GUILD, "bac-2", BOT_ROLE, ADMIN);
		const { member, changes } = fakeGuildMember([]);

		const fake = await run(admin, { group: "xp", subcommand: "give", options: { "thanh-vien": user(USER_A), "so-xp": 50 }, member });
		assert.deepEqual(changes, []);
		assert.equal(fake.edits.length, 1);
		assert.match(
			String(fake.edits[0]),
			new RegExp(`không đổi được <@&${BOT_ROLE}> \\(kiểm tra quyền Manage Roles và thứ bậc role của bot; vừa lỗi thì bot chờ 10 phút mới thử lại\\)`),
		);
	});

	test("contribution adjust: từ chối 0, cộng và trừ đúng dấu", async () =>
	{
		const { admin, contributions } = createHarness();
		const target = { "thanh-vien": user(USER_A) };
		await rejects(admin, { group: "contribution", subcommand: "adjust", options: { ...target, diem: 0 } }, "Số điểm phải khác 0.");
		assert.equal(contributions.adjustCalls.length, 0);

		const minus = await run(admin, { group: "contribution", subcommand: "adjust", options: { ...target, diem: -5 }, member: MEMBER });
		assert.equal(replyText(minus), `Đã trừ 5 điểm contribution của <@${USER_A}>. Tổng: 7 điểm.`);
		const plus = await run(admin, { group: "contribution", subcommand: "adjust", options: { ...target, diem: 5, "ly-do": "hỗ trợ" } });
		assert.equal(replyText(plus), `Đã cộng 5 điểm contribution cho <@${USER_A}>. Tổng: 17 điểm.`);
		assert.deepEqual(contributions.adjustCalls.map(call => [call.delta, call.reason, call.roleIds]), [[-5, null, [ROLE_BACKEND]], [5, "hỗ trợ", []]]);
	});

	test("contribution remove: gỡ theo id, tiêu đề được escape; message công khai chuyển sang Đã bị gỡ, không còn nút", async () =>
	{
		const { admin, contributions, messageEdits } = createHarness();
		const text = replyText(await run(admin, { group: "contribution", subcommand: "remove", options: { id: 12 } }));
		assert.deepEqual(contributions.removed, [12]);
		assert.ok(text.includes("#12"));
		assert.ok(text.includes("Tài liệu \\*onboarding\\*"));
		assert.ok(text.includes(`<@${USER_A}>`));

		assert.equal(messageEdits.length, 1);
		const [edit] = messageEdits;
		assert.deepEqual([edit.channelId, edit.messageId], [CHANNEL_GENERAL, PUBLIC_MESSAGE]);
		assert.deepEqual(edit.payload.components, []);
		const embed = edit.payload.embeds?.[0]?.toJSON();
		assert.match(embed?.fields?.find(field => field.name === "Trạng thái")?.value ?? "", /Đã bị gỡ/);
	});

	test("contribution remove: sửa message công khai lỗi chỉ ghi cảnh báo; chưa có message thì không sửa gì", async (t) =>
	{
		const warned = t.mock.method(console, "error", () => undefined);
		const failing = createHarness();
		failing.failEdits.value = true;
		replyText(await run(failing.admin, { group: "contribution", subcommand: "remove", options: { id: 12 } }));
		assert.equal(warned.mock.callCount(), 1);
		assert.match(String(warned.mock.calls[0].arguments[0]), /\[WARN\].*contribution #12/);

		const unposted = createHarness();
		unposted.contributions.posted = false;
		replyText(await run(unposted.admin, { group: "contribution", subcommand: "remove", options: { id: 13 } }));
		assert.equal(unposted.messageEdits.length, 0);
	});

	test("contribution reset và reset-all", async () =>
	{
		const { admin, contributions } = createHarness();
		await run(admin, { group: "contribution", subcommand: "reset", options: { "thanh-vien": user(USER_A) } });
		assert.deepEqual(contributions.resetUserCalls, [USER_A]);

		await rejects(admin, { group: "contribution", subcommand: "reset-all", options: { "xac-nhan": "ok" } }, RESET_REFUSED);
		assert.equal(contributions.resetAllCalls, 0);
		const fake = await run(admin, { group: "contribution", subcommand: "reset-all", options: { "xac-nhan": "XAC NHAN" } });
		assert.equal(contributions.resetAllCalls, 1);
		assert.equal(replyText(fake), "Đã reset điểm contribution toàn server: huỷ 80 biến động của 9 thành viên.");
	});

	test("stats: embed thống kê", async () =>
	{
		const { admin } = createHarness();
		const embed = replyEmbed(await run(admin, { subcommand: "stats" }));
		assert.ok(embedText(embed).includes("Thành viên có XP: **42**"));
	});

	test("audit: mặc định 10 mục, có thể giới hạn số lượng", async () =>
	{
		const { admin, context } = createHarness();
		for (let index = 0; index < 12; index++)
		{
			context.deps.audit.record(GUILD, ADMIN, "team.add", ROLE_BACKEND);
			context.clock.advanceSeconds(1);
		}
		context.deps.audit.record(GUILD, ADMIN, "backup.manual", null, { file: "bot.db" });

		const latest = replyEmbed(await run(admin, { subcommand: "audit", options: { "so-luong": 1 } }));
		assert.equal(latest.footer?.text, "1 mục mới nhất");
		assert.ok(latest.description?.includes("**Sao lưu thủ công**"));
		assert.ok(latest.description?.includes("File: bot.db"));

		const standard = replyEmbed(await run(admin, { subcommand: "audit" }));
		assert.equal(standard.footer?.text, "10 mục mới nhất");
	});

	test("backup: tạo bản thủ công, defer ephemeral, chỉ lộ tên file, ghi audit", async () =>
	{
		const { admin, context, backup, backupPath } = createHarness();
		const fake = await run(admin, { subcommand: "backup" });
		assert.deepEqual(backup.created, ["manual"]);
		assert.deepEqual(backup.latestQueries, ["manual"]);
		assert.deepEqual(fake.deferred, [{ flags: MessageFlags.Ephemeral }]);
		assert.deepEqual(fake.edits, ["Đã sao lưu database: `bot-manual-2026-01-01T00-00-00-000Z.db`."]);
		assert.ok(!String(fake.edits[0]).includes("backups"));
		assert.ok(backupPath.includes("backups"));

		const [entry] = context.deps.audit.list(GUILD, 1);
		assert.equal(entry.action, "backup.manual");
		assert.equal(entry.actorId, ADMIN);
		assert.deepEqual(entry.details, { file: "bot-manual-2026-01-01T00-00-00-000Z.db" });
	});

	test("backup: bản thủ công gần nhất chưa đủ 10 phút thì từ chối, báo thời điểm thử lại", async () =>
	{
		const { admin, context, backup } = createHarness();
		const now = context.clock.now();
		backup.latest = now - 3 * MINUTE;

		const fake = invoke({ subcommand: "backup" });
		await assert.rejects(admin.execute(fake.interaction), (error: unknown) =>
		{
			assert.ok(error instanceof Error && error.name === "UserError");
			assert.ok(error.message.includes(`<t:${Math.floor((now - 3 * MINUTE) / 1000)}:R>`));
			assert.ok(error.message.includes(`<t:${Math.floor((now + 7 * MINUTE) / 1000)}:R>`));
			return true;
		});
		assert.deepEqual(fake.deferred, [], "từ chối trước khi defer");
		assert.deepEqual(backup.created, []);
		assert.equal(context.deps.audit.list(GUILD, 5).length, 0);
	});

	test("backup: đủ 10 phút, chưa có bản nào, hoặc bản mang thời điểm tương lai thì cho phép", async () =>
	{
		for (const offset of [-10 * MINUTE, -60 * MINUTE, 5 * MINUTE, null])
		{
			const { admin, context, backup } = createHarness();
			backup.latest = offset === null ? null : context.clock.now() + offset;
			await run(admin, { subcommand: "backup" });
			assert.deepEqual(backup.created, ["manual"], String(offset));
		}
	});
});

describe("/config", () =>
{
	test("view: embed toàn bộ cấu hình từ database, kể cả Bảng vàng và role cảnh giới", async () =>
	{
		const { config, context, liveBoards, tierRoles } = createHarness();
		context.deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		context.deps.guildConfig.setChannel(GUILD, CHANNEL_BOT, { xpEnabled: false }, ADMIN);
		const before = embedText(replyEmbed(await run(config, { subcommand: "view" })));
		assert.ok(before.includes(`<@&${ROLE_BACKEND}>`));
		assert.ok(before.includes(`<#${CHANNEL_BOT}>: tắt XP`));
		assert.ok(before.includes("Đang tắt. Dùng `/config board` để bật."));
		assert.ok(before.includes("role đã gán 0/8"));

		liveBoards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		tierRoles.set(GUILD, "bac-3", ROLE_FRONTEND, ADMIN);
		const after = embedText(replyEmbed(await run(config, { subcommand: "view" })));
		assert.ok(after.includes(`🏆 Bảng vàng\n<#${CHANNEL_GENERAL}>`));
		assert.ok(after.includes(`🟡 Kim Đan (Lv 6+): <@&${ROLE_FRONTEND}>`));
	});

	test("xp: không chọn giá trị nào thì từ chối, không ghi audit", async () =>
	{
		const { config, context } = createHarness();
		await rejects(config, { subcommand: "xp" }, NO_CHANGE);
		assert.equal(context.deps.audit.list(GUILD, 5).length, 0);
	});

	test("xp: cập nhật một phần, giữ nguyên phần còn lại, ghi audit", async () =>
	{
		const { config, context } = createHarness();
		const fake = await run(config, { subcommand: "xp", options: { "xp-moi-tin": 15, "chong-trung-giay": 120, "thong-bao-len-level": false } });
		const settings = context.deps.guildConfig.getSettings(GUILD);
		assert.equal(settings.xpPerMessage, 15);
		assert.equal(settings.duplicateWindowSeconds, 120);
		assert.equal(settings.levelUpAnnouncements, false);
		assert.equal(settings.xpCooldownSeconds, DEFAULT_GUILD_SETTINGS.xpCooldownSeconds);
		assert.equal(
			replyText(fake),
			"Đã cập nhật cấu hình Activity XP:\n• XP mỗi tin nhắn: **15 XP**\n• Chống trùng: **120 giây**\n• Thông báo lên level: **Tắt**",
		);
		const [entry] = context.deps.audit.list(GUILD, 1);
		assert.equal(entry.action, "config.update");
		assert.equal(entry.actorId, ADMIN);
	});

	test("channel set: phải chọn ít nhất một giá trị ngoài kenh", async () =>
	{
		const { config, context } = createHarness();
		await rejects(config, { group: "channel", subcommand: "set", options: { kenh: channel(CHANNEL_GENERAL) } }, NO_CHANGE);
		assert.deepEqual(context.deps.guildConfig.listChannels(GUILD), []);

		const off = await run(config, { group: "channel", subcommand: "set", options: { kenh: channel(CHANNEL_BOT), "bat-xp": false } });
		assert.equal(replyText(off), `Đã cập nhật cấu hình XP của <#${CHANNEL_BOT}>: tắt XP.`);
		const custom = await run(config, {
			group: "channel",
			subcommand: "set",
			options: { kenh: channel(CHANNEL_GENERAL), "xp-moi-tin": 20, "cooldown-giay": 30 },
		});
		assert.ok(replyText(custom).endsWith("bật XP, 20 XP/tin, cooldown 30 giây."));
		assert.deepEqual(context.deps.guildConfig.effectiveChannelXp(GUILD, CHANNEL_GENERAL), { enabled: true, xpPerMessage: 20, cooldownSeconds: 30 });
	});

	test("channel reset: báo khi vốn không có cấu hình riêng; list hiển thị channel", async () =>
	{
		const { config, context } = createHarness();
		context.deps.guildConfig.setChannel(GUILD, CHANNEL_BOT, { xpEnabled: false }, ADMIN);
		const listed = embedText(replyEmbed(await run(config, { group: "channel", subcommand: "list" })));
		assert.ok(listed.includes(`<#${CHANNEL_BOT}>: tắt XP`));
		assert.ok(listed.includes("Cấu hình chung: 10 XP/tin, cooldown 60 giây."));

		const first = await run(config, { group: "channel", subcommand: "reset", options: { kenh: channel(CHANNEL_BOT) } });
		assert.ok(replyText(first).startsWith("Đã xoá cấu hình riêng"));
		const again = await run(config, { group: "channel", subcommand: "reset", options: { kenh: channel(CHANNEL_BOT) } });
		assert.equal(replyText(again), `<#${CHANNEL_BOT}> vốn không có cấu hình riêng.`);
	});

	test("team add: chặn @everyone và role managed, báo khi đã là team", async () =>
	{
		const { config, context } = createHarness();
		await rejects(config, { group: "team", subcommand: "add", options: { role: role(GUILD) } }, "Không thể dùng @everyone làm team.");
		await rejects(
			config,
			{ group: "team", subcommand: "add", options: { role: role(ROLE_OTHER, true) } },
			"Không thể dùng role do bot hoặc integration quản lý làm team.",
		);
		assert.deepEqual(context.deps.teams.list(GUILD), []);

		const added = await run(config, { group: "team", subcommand: "add", options: { role: role(ROLE_BACKEND) } });
		assert.ok(replyText(added).startsWith(`Đã thêm <@&${ROLE_BACKEND}> làm team.`));
		const duplicate = await run(config, { group: "team", subcommand: "add", options: { role: role(ROLE_BACKEND) } });
		assert.equal(replyText(duplicate), `<@&${ROLE_BACKEND}> đã là team.`);
		assert.deepEqual(context.deps.teams.list(GUILD), [ROLE_BACKEND]);
	});

	test("team remove và list", async () =>
	{
		const { config, context } = createHarness();
		context.deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		context.deps.teams.add(GUILD, ROLE_FRONTEND, ADMIN);
		const listed = replyEmbed(await run(config, { group: "team", subcommand: "list" }));
		assert.ok(listed.description?.includes(`2. <@&${ROLE_FRONTEND}>`));

		const removed = await run(config, { group: "team", subcommand: "remove", options: { role: role(ROLE_BACKEND) } });
		assert.ok(replyText(removed).startsWith(`Đã bỏ <@&${ROLE_BACKEND}>`));
		const missing = await run(config, { group: "team", subcommand: "remove", options: { role: role(ROLE_BACKEND) } });
		assert.equal(replyText(missing), `<@&${ROLE_BACKEND}> không phải team.`);
		assert.deepEqual(context.deps.teams.list(GUILD), [ROLE_FRONTEND]);
	});

	test("admin-role: đặt, chặn @everyone / managed, bỏ trống thì xoá", async () =>
	{
		const { config, context } = createHarness();
		await rejects(config, { subcommand: "admin-role", options: { role: role(GUILD) } }, "Không thể dùng @everyone làm role admin bot.");
		await rejects(
			config,
			{ subcommand: "admin-role", options: { role: role(ROLE_OTHER, true) } },
			"Không thể dùng role do bot hoặc integration quản lý làm role admin bot.",
		);

		const set = replyText(await run(config, { subcommand: "admin-role", options: { role: role(ROLE_BACKEND) } }));
		assert.equal(context.deps.guildConfig.getSettings(GUILD).adminRoleId, ROLE_BACKEND);
		assert.ok(set.startsWith(`Đã đặt <@&${ROLE_BACKEND}> làm role admin bot.`));
		assert.ok(set.includes("Server Settings → Integrations"), "phải nhắc cấp quyền dùng lệnh trong Integrations");
		assert.ok(set.includes("`/admin`") && set.includes("`/config`"));
		const cleared = await run(config, { subcommand: "admin-role" });
		assert.equal(context.deps.guildConfig.getSettings(GUILD).adminRoleId, null);
		assert.ok(replyText(cleared).startsWith("Đã xoá role admin bot."));
	});

	test("poll: phải chọn ít nhất một giá trị, không vừa đặt vừa xoá role", async () =>
	{
		const { config, context } = createHarness();
		await rejects(config, { subcommand: "poll" }, NO_CHANGE);
		await rejects(config, { subcommand: "poll", options: { "xoa-role-tao-vote": false } }, NO_CHANGE);
		await rejects(
			config,
			{ subcommand: "poll", options: { "role-tao-vote": role(ROLE_FRONTEND), "xoa-role-tao-vote": true } },
			"Không thể vừa đặt vừa xoá role tạo vote.",
		);
		await rejects(config, { subcommand: "poll", options: { "role-tao-vote": role(GUILD) } }, "Không thể dùng @everyone làm role tạo vote.");

		const fake = await run(config, { subcommand: "poll", options: { "xp-mac-dinh": 8, "role-tao-vote": role(ROLE_FRONTEND) } });
		assert.equal(replyText(fake), `Đã cập nhật cấu hình vote:\n• XP mặc định khi vote: **8 XP**\n• Role tạo vote: **<@&${ROLE_FRONTEND}>**`);
		let settings = context.deps.guildConfig.getSettings(GUILD);
		assert.equal(settings.defaultPollXp, 8);
		assert.equal(settings.pollCreatorRoleId, ROLE_FRONTEND);

		await run(config, { subcommand: "poll", options: { "xoa-role-tao-vote": true } });
		settings = context.deps.guildConfig.getSettings(GUILD);
		assert.equal(settings.pollCreatorRoleId, null);
		assert.equal(settings.defaultPollXp, 8);
	});

	test("contribution: cập nhật điểm mỗi lượt ghi nhận", async () =>
	{
		const { config, context } = createHarness();
		const fake = await run(config, { subcommand: "contribution", options: { "diem-moi-luot": 3 } });
		assert.equal(context.deps.guildConfig.getSettings(GUILD).contributionVotePoints, 3);
		assert.equal(replyText(fake), "Đã cập nhật cấu hình contribution:\n• Điểm mỗi lượt ghi nhận: **3 điểm**");
	});
});
