import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { GuildMember, OverwriteType, PermissionFlagsBits, PermissionsBitField, Role } from "discord.js";
import { FailureBackoff, syncTierRoles, tierRoleSafetyIssue } from "../src/discord/roleSync";
import { TierRoleService } from "../src/modules/gamification/TierRoleService";
import { TierRoleServiceApi } from "../src/modules/gamification/types";
import { ADMIN, CHANNEL_BOT, CHANNEL_GENERAL, createTestContext, GUILD, USER_A, USER_B } from "./helpers";

const BOT_ROLE = "520000000000000099";
const ROLE_LUYEN_KHI = "520000000000000001";
const ROLE_TRUC_CO = "520000000000000002";
const ROLE_KIM_DAN = "520000000000000003";
const ROLE_OTHER = "520000000000000042";
const REASON = "Cảnh giới tu luyện";
/** Level 7 thuộc cảnh giới Kim Đan (từ Level 6). */
const KIM_DAN_LEVEL = 7;
const MINUTE = 60_000;

interface OverwriteSpec
{
	id: string;
	type?: OverwriteType;
	allow?: bigint[];
	deny?: bigint[];
}

interface ChannelSpec
{
	id: string;
	overwrites: OverwriteSpec[];
	thread?: boolean;
}

/** Kênh giả có phân quyền riêng (permission overwrite); thread không có phân quyền riêng. */
function fakeChannel(spec: ChannelSpec): object
{
	const overwrites = spec.overwrites.map(overwrite => [overwrite.id, {
		id: overwrite.id,
		type: overwrite.type ?? OverwriteType.Role,
		allow: new PermissionsBitField(overwrite.allow ?? []),
		deny: new PermissionsBitField(overwrite.deny ?? []),
	}] as const);
	if (spec.thread) return { id: spec.id, isThread: (): boolean => true };
	return { id: spec.id, isThread: (): boolean => false, permissionOverwrites: { cache: new Map(overwrites) } };
}

interface RoleSpec
{
	id: string;
	position: number;
	managed?: boolean;
	permissions?: bigint[];
	guildId?: string;
	/** Các kênh của server (mặc định không có kênh nào). */
	channels?: ChannelSpec[];
}

function fakeRole(spec: RoleSpec): Role
{
	const channels = new Map((spec.channels ?? []).map(channel => [channel.id, fakeChannel(channel)]));
	return {
		id: spec.id,
		position: spec.position,
		managed: spec.managed ?? false,
		guild: { id: spec.guildId ?? GUILD, channels: { cache: channels } },
		permissions: new PermissionsBitField(spec.permissions ?? []),
	} as unknown as Role;
}

function fakeBot(options: { manageRoles?: boolean; highestPosition?: number } = {}): GuildMember
{
	return {
		permissions: new PermissionsBitField(options.manageRoles === false ? [] : [PermissionFlagsBits.ManageRoles]),
		roles: { highest: fakeRole({ id: BOT_ROLE, position: options.highestPosition ?? 10 }) },
	} as unknown as GuildMember;
}

interface RoleCall
{
	action: "add" | "remove";
	roleId: string;
	reason: string | undefined;
}

interface MemberSetup
{
	guildId?: string;
	/** User của member (mặc định USER_A). */
	userId?: string;
	/** Role member đang giữ. */
	roleIds: string[];
	/** Role của server có trong cache; mặc định ba role cảnh giới vị trí 1–3 và ROLE_OTHER. */
	guildRoles?: RoleSpec[];
	/** Bot trong server; null = không có trong cache. */
	bot?: GuildMember | null;
	/** Thêm/bỏ các role này thì Discord báo lỗi. */
	failing?: string[];
}

/** GuildMember giả (qua được `instanceof GuildMember`), ghi lại các lần thêm/bỏ role. */
function fakeMember(setup: MemberSetup): { member: GuildMember; calls: RoleCall[] }
{
	const guildId = setup.guildId ?? GUILD;
	const calls: RoleCall[] = [];
	const roleSpecs = setup.guildRoles ?? [
		{ id: ROLE_LUYEN_KHI, position: 1 },
		{ id: ROLE_TRUC_CO, position: 2 },
		{ id: ROLE_KIM_DAN, position: 3 },
		{ id: ROLE_OTHER, position: 4 },
	];
	const guild = {
		id: guildId,
		members: { me: setup.bot === undefined ? fakeBot() : setup.bot },
		roles: { cache: new Map(roleSpecs.map(spec => [spec.id, fakeRole({ ...spec, guildId })])) },
	};
	const change = (action: RoleCall["action"]) => (roleId: string, reason?: string): Promise<void> =>
	{
		calls.push({ action, roleId, reason });
		return setup.failing?.includes(roleId) ? Promise.reject(new Error("Missing Permissions")) : Promise.resolve();
	};
	const fake = {
		guild,
		user: { id: setup.userId ?? USER_A },
		roles: { cache: new Map(setup.roleIds.map(id => [id, { id }])), add: change("add"), remove: change("remove") },
	};
	return { member: Object.setPrototypeOf(fake, GuildMember.prototype) as GuildMember, calls };
}

/** TierRoleService thật trên SQLite :memory:, đã gán role cho Luyện Khí, Trúc Cơ, Kim Đan ở các guild được chọn. */
function tierRolesFor(...guildIds: string[]): TierRoleService
{
	const context = createTestContext();
	const service = new TierRoleService(context.db, context.clock, context.deps.audit);
	for (const guildId of guildIds)
	{
		service.set(guildId, "bac-1", ROLE_LUYEN_KHI, ADMIN);
		service.set(guildId, "bac-2", ROLE_TRUC_CO, ADMIN);
		service.set(guildId, "bac-3", ROLE_KIM_DAN, ADMIN);
	}
	return service;
}

/**
 * Guild ID riêng cho từng test cần đếm cảnh báo hoặc gây lỗi API (cảnh báo có throttle theo guild, và lỗi API được nhớ
 * theo (guild, user, role) trong suốt process).
 */
let nextGuild = 0;
function uniqueGuild(): string
{
	nextGuild++;
	return `1000000000000009${String(nextGuild).padStart(2, "0")}`;
}

describe("tierRoleSafetyIssue", () =>
{
	const bot = fakeBot();

	test("role thường, nằm dưới role cao nhất của bot: dùng được", () =>
	{
		assert.equal(tierRoleSafetyIssue(fakeRole({ id: ROLE_KIM_DAN, position: 3 }), bot), null);
		const harmless = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ChangeNickname];
		assert.equal(tierRoleSafetyIssue(fakeRole({ id: ROLE_KIM_DAN, position: 9, permissions: harmless }), bot), null);
	});

	test("chặn @everyone và role do integration quản lý", () =>
	{
		assert.equal(tierRoleSafetyIssue(fakeRole({ id: GUILD, position: 0 }), bot), "Không thể dùng @everyone làm role danh hiệu.");
		assert.equal(
			tierRoleSafetyIssue(fakeRole({ id: ROLE_KIM_DAN, position: 3, managed: true }), bot),
			"Không thể dùng role do bot hoặc integration quản lý làm role danh hiệu.",
		);
	});

	test("chặn từng quyền quản trị/kiểm duyệt/đặc biệt, nêu tên quyền (DEC-031)", () =>
	{
		const dangerous: [bigint, string][] = [
			[PermissionFlagsBits.Administrator, "Administrator"],
			[PermissionFlagsBits.ManageGuild, "Manage Server"],
			[PermissionFlagsBits.ManageRoles, "Manage Roles"],
			[PermissionFlagsBits.ManageChannels, "Manage Channels"],
			[PermissionFlagsBits.ManageWebhooks, "Manage Webhooks"],
			[PermissionFlagsBits.ManageGuildExpressions, "Manage Expressions"],
			[PermissionFlagsBits.ManageEvents, "Manage Events"],
			[PermissionFlagsBits.ManageThreads, "Manage Threads"],
			[PermissionFlagsBits.ManageMessages, "Manage Messages"],
			[PermissionFlagsBits.ManageNicknames, "Manage Nicknames"],
			[PermissionFlagsBits.KickMembers, "Kick Members"],
			[PermissionFlagsBits.BanMembers, "Ban Members"],
			[PermissionFlagsBits.ModerateMembers, "Timeout Members"],
			[PermissionFlagsBits.MentionEveryone, "Mention Everyone"],
			[PermissionFlagsBits.ViewAuditLog, "View Audit Log"],
			[PermissionFlagsBits.MoveMembers, "Move Members"],
			[PermissionFlagsBits.MuteMembers, "Mute Members"],
			[PermissionFlagsBits.DeafenMembers, "Deafen Members"],
			[PermissionFlagsBits.PinMessages, "Pin Messages"],
			[PermissionFlagsBits.BypassSlowmode, "Bypass Slowmode"],
			[PermissionFlagsBits.ViewGuildInsights, "View Server Insights"],
		];
		for (const [flag, name] of dangerous)
		{
			const issue = tierRoleSafetyIssue(fakeRole({ id: ROLE_KIM_DAN, position: 3, permissions: [flag] }), bot) ?? "";
			assert.ok(issue.includes(`<@&${ROLE_KIM_DAN}>`), name);
			assert.ok(issue.includes(`(${name})`), `${name}: ${issue}`);
		}

		const several = tierRoleSafetyIssue(fakeRole({ id: ROLE_KIM_DAN, position: 3, permissions: [PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers] }), bot);
		assert.ok(several?.includes("(Kick Members, Ban Members)"));
	});

	test("chặn role được phân quyền riêng của kênh cho phép quyền nguy hiểm, nêu kênh và quyền", () =>
	{
		const role = fakeRole({
			id: ROLE_KIM_DAN,
			position: 3,
			channels: [
				{ id: CHANNEL_GENERAL, overwrites: [{ id: ROLE_KIM_DAN, allow: [PermissionFlagsBits.SendMessages] }] },
				{ id: CHANNEL_BOT, overwrites: [{ id: ROLE_KIM_DAN, allow: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.PinMessages] }] },
			],
		});
		assert.equal(
			tierRoleSafetyIssue(role, bot),
			`Không thể dùng <@&${ROLE_KIM_DAN}> làm role danh hiệu vì phân quyền riêng của kênh cấp cho role này quyền quản trị hoặc kiểm duyệt: `
				+ `<#${CHANNEL_BOT}> (Manage Messages, Pin Messages). Hãy gỡ các quyền đó trong phần phân quyền của kênh, hoặc dùng role mới tạo riêng cho bậc danh hiệu.`,
		);
	});

	test("phân quyền riêng: nêu tối đa 3 kênh rồi \"và n kênh khác\"", () =>
	{
		const channels = Array.from({ length: 5 }, (_, index) => ({
			id: `40000000000000010${index}`,
			overwrites: [{ id: ROLE_KIM_DAN, allow: [PermissionFlagsBits.MentionEveryone] }],
		}));
		const issue = tierRoleSafetyIssue(fakeRole({ id: ROLE_KIM_DAN, position: 3, channels }), bot) ?? "";
		assert.ok(issue.includes("<#400000000000000100> (Mention Everyone), <#400000000000000101> (Mention Everyone), <#400000000000000102> (Mention Everyone) và 2 kênh khác."), issue);
	});

	test("phân quyền riêng không nguy hiểm thì dùng được: chỉ cho phép quyền thường, chỉ chặn (deny), của member khác hoặc role khác, thread", () =>
	{
		const role = fakeRole({
			id: ROLE_KIM_DAN,
			position: 3,
			channels: [
				{ id: "400000000000000201", overwrites: [{ id: ROLE_KIM_DAN, allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] }] },
				{ id: "400000000000000202", overwrites: [{ id: ROLE_KIM_DAN, deny: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ViewChannel] }] },
				{ id: "400000000000000203", overwrites: [{ id: ROLE_KIM_DAN, type: OverwriteType.Member, allow: [PermissionFlagsBits.ManageMessages] }] },
				{ id: "400000000000000204", overwrites: [{ id: ROLE_OTHER, allow: [PermissionFlagsBits.Administrator] }] },
				{ id: "400000000000000205", overwrites: [], thread: true },
			],
		});
		assert.equal(tierRoleSafetyIssue(role, bot), null);
	});

	test("chặn role không thấp hơn role cao nhất của bot, hướng dẫn kéo role của bot lên trên", () =>
	{
		for (const position of [10, 11])
		{
			const issue = tierRoleSafetyIssue(fakeRole({ id: ROLE_KIM_DAN, position }), bot) ?? "";
			assert.ok(issue.includes(`role cao nhất của bot (<@&${BOT_ROLE}>)`), issue);
			assert.ok(issue.includes("kéo role của bot lên trên"), issue);
		}
		assert.equal(tierRoleSafetyIssue(fakeRole({ id: ROLE_KIM_DAN, position: 9 }), bot), null);
	});
});

describe("FailureBackoff", () =>
{
	test("khoá vừa lỗi bị chặn trong đúng khoảng thời gian, khoá khác không bị ảnh hưởng", () =>
	{
		const backoff = new FailureBackoff(10 * MINUTE, 100);
		backoff.record("a", 0);
		assert.equal(backoff.isBlocked("a", 0), true);
		assert.equal(backoff.isBlocked("a", 10 * MINUTE - 1), true);
		assert.equal(backoff.isBlocked("b", 1), false);
		assert.equal(backoff.isBlocked("a", 10 * MINUTE), false);
	});

	test("lỗi lại thì tính lại từ lần lỗi mới nhất", () =>
	{
		const backoff = new FailureBackoff(10 * MINUTE, 100);
		backoff.record("a", 0);
		backoff.record("a", 8 * MINUTE);
		assert.equal(backoff.isBlocked("a", 15 * MINUTE), true);
		assert.equal(backoff.isBlocked("a", 18 * MINUTE), false);
	});

	test("tự dọn mục hết hạn và không vượt giới hạn số mục (bỏ mục cũ nhất)", () =>
	{
		const backoff = new FailureBackoff(10 * MINUTE, 3);
		backoff.record("a", 0);
		backoff.record("b", MINUTE);
		backoff.record("c", 2 * MINUTE);
		backoff.record("a", 3 * MINUTE);
		assert.equal(backoff.size, 3);
		backoff.record("d", 4 * MINUTE);
		assert.equal(backoff.size, 3);
		assert.equal(backoff.isBlocked("b", 4 * MINUTE), false, "mục cũ nhất bị bỏ khi vượt giới hạn");
		assert.equal(backoff.isBlocked("a", 4 * MINUTE), true, "ghi lại thì chuyển xuống cuối, không bị bỏ trước");

		assert.equal(backoff.isBlocked("zzz", 13 * MINUTE + 1), false);
		assert.equal(backoff.size, 1, "các mục hết hạn được dọn khi dùng");
		assert.equal(backoff.isBlocked("d", 13 * MINUTE + 1), true);
		assert.equal(backoff.isBlocked("d", 14 * MINUTE), false);
		assert.equal(backoff.size, 0);
	});
});

describe("syncTierRoles", () =>
{
	test("guild chưa gán role cảnh giới, hoặc member đã đúng role: không gọi API", async () =>
	{
		const none = fakeMember({ roleIds: [ROLE_OTHER] });
		assert.deepEqual(await syncTierRoles(none.member, KIM_DAN_LEVEL, tierRolesFor(), REASON), { added: [], removed: [], skipped: [] });
		assert.deepEqual(none.calls, []);

		const correct = fakeMember({ roleIds: [ROLE_KIM_DAN, ROLE_OTHER] });
		assert.deepEqual(await syncTierRoles(correct.member, KIM_DAN_LEVEL, tierRolesFor(GUILD), REASON), { added: [], removed: [], skipped: [] });
		assert.deepEqual(correct.calls, []);
	});

	test("thêm role cảnh giới hiện tại, bỏ role của cảnh giới khác, không đụng role khác; từng role một, kèm lý do", async () =>
	{
		const { member, calls } = fakeMember({ roleIds: [ROLE_LUYEN_KHI, ROLE_TRUC_CO, ROLE_OTHER] });
		const result = await syncTierRoles(member, KIM_DAN_LEVEL, tierRolesFor(GUILD), REASON);

		assert.deepEqual(result, { added: [ROLE_KIM_DAN], removed: [ROLE_LUYEN_KHI, ROLE_TRUC_CO], skipped: [] });
		assert.deepEqual(calls, [
			{ action: "add", roleId: ROLE_KIM_DAN, reason: REASON },
			{ action: "remove", roleId: ROLE_LUYEN_KHI, reason: REASON },
			{ action: "remove", roleId: ROLE_TRUC_CO, reason: REASON },
		]);
	});

	test("cảnh giới hiện tại chưa gán role: chỉ bỏ role của cảnh giới khác", async () =>
	{
		const context = createTestContext();
		const tierRoles = new TierRoleService(context.db, context.clock, context.deps.audit);
		tierRoles.set(GUILD, "bac-2", ROLE_TRUC_CO, ADMIN);
		const { member, calls } = fakeMember({ roleIds: [ROLE_TRUC_CO] });

		assert.deepEqual(await syncTierRoles(member, 0, tierRoles, REASON), { added: [], removed: [ROLE_TRUC_CO], skipped: [] });
		assert.deepEqual(calls.map(call => call.action), ["remove"]);
	});

	test("bot thiếu Manage Roles hoặc không có trong cache: bỏ qua toàn bộ, không gọi API, cảnh báo", async (t) =>
	{
		const warned = t.mock.method(console, "error", () => undefined);
		const guildId = uniqueGuild();
		const tierRoles = tierRolesFor(guildId, GUILD);

		const noPermission = fakeMember({ guildId, roleIds: [ROLE_LUYEN_KHI], bot: fakeBot({ manageRoles: false }) });
		const result = await syncTierRoles(noPermission.member, KIM_DAN_LEVEL, tierRoles, REASON);
		assert.deepEqual(result, { added: [], removed: [], skipped: [ROLE_KIM_DAN, ROLE_LUYEN_KHI] });
		assert.deepEqual(noPermission.calls, []);
		assert.equal(warned.mock.callCount(), 1);
		assert.match(String(warned.mock.calls[0].arguments[0]), /\[WARN\].*Manage Roles/);

		const noBot = fakeMember({ roleIds: [], bot: null });
		assert.deepEqual(await syncTierRoles(noBot.member, KIM_DAN_LEVEL, tierRoles, REASON), { added: [], removed: [], skipped: [ROLE_KIM_DAN] });
		assert.deepEqual(noBot.calls, []);
	});

	test("role không quản lý được (cao hơn bot, không có trong cache, do integration quản lý) bị bỏ qua; role khác vẫn được đổi", async (t) =>
	{
		t.mock.method(console, "error", () => undefined);
		const tierRoles = tierRolesFor(GUILD);

		const higher = fakeMember({
			roleIds: [ROLE_LUYEN_KHI],
			guildRoles: [{ id: ROLE_LUYEN_KHI, position: 1 }, { id: ROLE_KIM_DAN, position: 20 }],
		});
		assert.deepEqual(await syncTierRoles(higher.member, KIM_DAN_LEVEL, tierRoles, REASON), { added: [], removed: [ROLE_LUYEN_KHI], skipped: [ROLE_KIM_DAN] });
		assert.deepEqual(higher.calls.map(call => [call.action, call.roleId]), [["remove", ROLE_LUYEN_KHI]]);

		const missing = fakeMember({ roleIds: [ROLE_TRUC_CO], guildRoles: [{ id: ROLE_KIM_DAN, position: 3 }] });
		assert.deepEqual(await syncTierRoles(missing.member, KIM_DAN_LEVEL, tierRoles, REASON), { added: [ROLE_KIM_DAN], removed: [], skipped: [ROLE_TRUC_CO] });

		const managed = fakeMember({ roleIds: [ROLE_TRUC_CO], guildRoles: [{ id: ROLE_TRUC_CO, position: 2, managed: true }, { id: ROLE_KIM_DAN, position: 3 }] });
		assert.deepEqual(await syncTierRoles(managed.member, KIM_DAN_LEVEL, tierRoles, REASON), { added: [ROLE_KIM_DAN], removed: [], skipped: [ROLE_TRUC_CO] });
	});

	test("role cảnh giới bị admin cấp thêm quyền nguy hiểm sau khi gán: không tự gán nữa, nhưng vẫn gỡ được", async (t) =>
	{
		t.mock.method(console, "error", () => undefined);
		const tierRoles = tierRolesFor(GUILD);
		const guildRoles = [{ id: ROLE_LUYEN_KHI, position: 1 }, { id: ROLE_KIM_DAN, position: 3, permissions: [PermissionFlagsBits.ManageMessages] }];

		const climbing = fakeMember({ roleIds: [], guildRoles });
		assert.deepEqual(await syncTierRoles(climbing.member, KIM_DAN_LEVEL, tierRoles, REASON), { added: [], removed: [], skipped: [ROLE_KIM_DAN] });
		assert.deepEqual(climbing.calls, []);

		const reset = fakeMember({ roleIds: [ROLE_KIM_DAN], guildRoles });
		assert.deepEqual(await syncTierRoles(reset.member, 0, tierRoles, REASON), { added: [ROLE_LUYEN_KHI], removed: [ROLE_KIM_DAN], skipped: [] });
	});

	test("role cảnh giới bị cấp quyền nguy hiểm trong phân quyền riêng của một kênh sau khi gán: không tự gán nữa, nhưng vẫn gỡ được", async (t) =>
	{
		t.mock.method(console, "error", () => undefined);
		const tierRoles = tierRolesFor(GUILD);
		const channels = [{ id: CHANNEL_GENERAL, overwrites: [{ id: ROLE_KIM_DAN, allow: [PermissionFlagsBits.ManageThreads] }] }];
		const guildRoles = [{ id: ROLE_LUYEN_KHI, position: 1, channels }, { id: ROLE_KIM_DAN, position: 3, channels }];

		const climbing = fakeMember({ roleIds: [], guildRoles });
		assert.deepEqual(await syncTierRoles(climbing.member, KIM_DAN_LEVEL, tierRoles, REASON), { added: [], removed: [], skipped: [ROLE_KIM_DAN] });
		assert.deepEqual(climbing.calls, []);

		const reset = fakeMember({ roleIds: [ROLE_KIM_DAN], guildRoles });
		assert.deepEqual(await syncTierRoles(reset.member, 0, tierRoles, REASON), { added: [ROLE_LUYEN_KHI], removed: [ROLE_KIM_DAN], skipped: [] });
	});

	test("lỗi API: role đó vào skipped, các role khác vẫn được xử lý, không ném lỗi, có cảnh báo", async (t) =>
	{
		const warned = t.mock.method(console, "error", () => undefined);
		const guildId = uniqueGuild();
		const { member, calls } = fakeMember({ guildId, roleIds: [ROLE_LUYEN_KHI], failing: [ROLE_KIM_DAN] });

		assert.deepEqual(await syncTierRoles(member, KIM_DAN_LEVEL, tierRolesFor(guildId), REASON), { added: [], removed: [ROLE_LUYEN_KHI], skipped: [ROLE_KIM_DAN] });
		assert.equal(calls.length, 2, "vẫn bỏ role cũ dù thêm role mới lỗi");
		assert.equal(warned.mock.callCount(), 1);
		assert.match(String(warned.mock.calls[0].arguments[0]), new RegExp(`\\[WARN\\] Không thêm được role cảnh giới "${ROLE_KIM_DAN}"`));
	});

	test("sau khi lỗi, không gọi lại API cho đúng (guild, user, role) đó trong 10 phút; người khác, role khác không bị ảnh hưởng", async (t) =>
	{
		t.mock.method(console, "error", () => undefined);
		let now = Date.UTC(2026, 0, 1);
		t.mock.method(Date, "now", () => now);
		const guildId = uniqueGuild();
		const tierRoles = tierRolesFor(guildId);
		const run = async (userId: string, failing: string[]): Promise<{ result: unknown; calls: string[] }> =>
		{
			const { member, calls } = fakeMember({ guildId, userId, roleIds: [ROLE_LUYEN_KHI], failing });
			const result = await syncTierRoles(member, KIM_DAN_LEVEL, tierRoles, REASON);
			return { result, calls: calls.map(call => `${call.action} ${call.roleId}`) };
		};

		const first = await run(USER_A, [ROLE_KIM_DAN]);
		assert.deepEqual(first.calls, [`add ${ROLE_KIM_DAN}`, `remove ${ROLE_LUYEN_KHI}`]);

		now += 9 * MINUTE;
		const blocked = await run(USER_A, []);
		assert.deepEqual(blocked.result, { added: [], removed: [ROLE_LUYEN_KHI], skipped: [ROLE_KIM_DAN] });
		assert.deepEqual(blocked.calls, [`remove ${ROLE_LUYEN_KHI}`], "không gọi lại API thêm role vừa lỗi, role khác vẫn đổi");

		const otherUser = await run(USER_B, []);
		assert.deepEqual(otherUser.result, { added: [ROLE_KIM_DAN], removed: [ROLE_LUYEN_KHI], skipped: [] });

		now += MINUTE;
		const retried = await run(USER_A, []);
		assert.deepEqual(retried.result, { added: [ROLE_KIM_DAN], removed: [ROLE_LUYEN_KHI], skipped: [] }, "hết 10 phút thì thử lại");
	});

	test("bỏ role lỗi cũng được nhớ: lần sau trong 10 phút không gọi lại API bỏ role đó", async (t) =>
	{
		t.mock.method(console, "error", () => undefined);
		const guildId = uniqueGuild();
		const tierRoles = tierRolesFor(guildId);

		const failed = fakeMember({ guildId, roleIds: [ROLE_KIM_DAN, ROLE_TRUC_CO], failing: [ROLE_TRUC_CO] });
		assert.deepEqual(await syncTierRoles(failed.member, KIM_DAN_LEVEL, tierRoles, REASON), { added: [], removed: [], skipped: [ROLE_TRUC_CO] });
		assert.equal(failed.calls.length, 1);

		const again = fakeMember({ guildId, roleIds: [ROLE_KIM_DAN, ROLE_TRUC_CO] });
		assert.deepEqual(await syncTierRoles(again.member, KIM_DAN_LEVEL, tierRoles, REASON), { added: [], removed: [], skipped: [ROLE_TRUC_CO] });
		assert.deepEqual(again.calls, []);
	});

	test("cảnh báo lỗi API có throttle theo guild: nhiều người lỗi trong 10 phút chỉ cảnh báo một lần", async (t) =>
	{
		const warned = t.mock.method(console, "error", () => undefined);
		let now = Date.UTC(2026, 0, 1);
		t.mock.method(Date, "now", () => now);
		const guildId = uniqueGuild();
		const tierRoles = tierRolesFor(guildId);
		const fail = async (userId: string): Promise<void> =>
		{
			const { member, calls } = fakeMember({ guildId, userId, roleIds: [], failing: [ROLE_KIM_DAN] });
			await syncTierRoles(member, KIM_DAN_LEVEL, tierRoles, REASON);
			assert.equal(calls.length, 1);
		};

		await fail(USER_A);
		now += 9 * MINUTE;
		await fail(USER_B);
		assert.equal(warned.mock.callCount(), 1, "trong 10 phút không cảnh báo lại");

		now += 2 * MINUTE;
		await fail("300000000000000099");
		assert.equal(warned.mock.callCount(), 2, "sau 10 phút cảnh báo lại");
	});

	test("service lỗi (ví dụ database) cũng không làm syncTierRoles ném lỗi", async (t) =>
	{
		const warned = t.mock.method(console, "error", () => undefined);
		const broken: TierRoleServiceApi = {
			list: () => [],
			set: () => undefined,
			clear: () => false,
			recordSetup: () => undefined,
			plan: () =>
			{
				throw new Error("database is locked");
			},
		};
		const { member, calls } = fakeMember({ guildId: uniqueGuild(), roleIds: [] });
		assert.deepEqual(await syncTierRoles(member, KIM_DAN_LEVEL, broken, REASON), { added: [], removed: [], skipped: [] });
		assert.deepEqual(calls, []);
		assert.equal(warned.mock.callCount(), 1);
	});
});
