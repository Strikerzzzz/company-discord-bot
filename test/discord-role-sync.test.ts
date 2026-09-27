import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { GuildMember, PermissionFlagsBits, PermissionsBitField, Role } from "discord.js";
import { syncTierRoles, tierRoleSafetyIssue } from "../src/discord/roleSync";
import { TierRoleService } from "../src/modules/gamification/TierRoleService";
import { TierRoleServiceApi } from "../src/modules/gamification/types";
import { ADMIN, createTestContext, GUILD } from "./helpers";

const BOT_ROLE = "520000000000000099";
const ROLE_LUYEN_KHI = "520000000000000001";
const ROLE_TRUC_CO = "520000000000000002";
const ROLE_KIM_DAN = "520000000000000003";
const ROLE_OTHER = "520000000000000042";
const REASON = "Cảnh giới tu luyện";
/** Level 7 thuộc cảnh giới Kim Đan (từ Level 6). */
const KIM_DAN_LEVEL = 7;

interface RoleSpec
{
	id: string;
	position: number;
	managed?: boolean;
	permissions?: bigint[];
	guildId?: string;
}

function fakeRole(spec: RoleSpec): Role
{
	return {
		id: spec.id,
		position: spec.position,
		managed: spec.managed ?? false,
		guild: { id: spec.guildId ?? GUILD },
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
	const fake = { guild, roles: { cache: new Map(setup.roleIds.map(id => [id, { id }])), add: change("add"), remove: change("remove") } };
	return { member: Object.setPrototypeOf(fake, GuildMember.prototype) as GuildMember, calls };
}

/** TierRoleService thật trên SQLite :memory:, đã gán role cho Luyện Khí, Trúc Cơ, Kim Đan ở các guild được chọn. */
function tierRolesFor(...guildIds: string[]): TierRoleService
{
	const context = createTestContext();
	const service = new TierRoleService(context.db, context.clock, context.deps.audit);
	for (const guildId of guildIds)
	{
		service.set(guildId, "luyen-khi", ROLE_LUYEN_KHI, ADMIN);
		service.set(guildId, "truc-co", ROLE_TRUC_CO, ADMIN);
		service.set(guildId, "kim-dan", ROLE_KIM_DAN, ADMIN);
	}
	return service;
}

/** Guild ID riêng cho từng test cần đếm cảnh báo (cảnh báo có throttle theo guild trong suốt process). */
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
		assert.equal(tierRoleSafetyIssue(fakeRole({ id: GUILD, position: 0 }), bot), "Không thể dùng @everyone làm role cảnh giới.");
		assert.equal(
			tierRoleSafetyIssue(fakeRole({ id: ROLE_KIM_DAN, position: 3, managed: true }), bot),
			"Không thể dùng role do bot hoặc integration quản lý làm role cảnh giới.",
		);
	});

	test("chặn từng quyền quản trị/kiểm duyệt, nêu tên quyền (DEC-031)", () =>
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
		tierRoles.set(GUILD, "truc-co", ROLE_TRUC_CO, ADMIN);
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

	test("lỗi API: role đó vào skipped, các role khác vẫn được xử lý, không ném lỗi, cảnh báo có throttle theo guild", async (t) =>
	{
		const warned = t.mock.method(console, "error", () => undefined);
		let now = Date.UTC(2026, 0, 1);
		t.mock.method(Date, "now", () => now);
		const guildId = uniqueGuild();
		const tierRoles = tierRolesFor(guildId);
		const run = async (): Promise<unknown> =>
		{
			const { member, calls } = fakeMember({ guildId, roleIds: [ROLE_LUYEN_KHI], failing: [ROLE_KIM_DAN] });
			const result = await syncTierRoles(member, KIM_DAN_LEVEL, tierRoles, REASON);
			assert.equal(calls.length, 2, "vẫn bỏ role cũ dù thêm role mới lỗi");
			return result;
		};

		assert.deepEqual(await run(), { added: [], removed: [ROLE_LUYEN_KHI], skipped: [ROLE_KIM_DAN] });
		assert.equal(warned.mock.callCount(), 1);
		assert.match(String(warned.mock.calls[0].arguments[0]), new RegExp(`\\[WARN\\] Không thêm được role cảnh giới "${ROLE_KIM_DAN}"`));

		now += 9 * 60_000;
		await run();
		assert.equal(warned.mock.callCount(), 1, "trong 10 phút không cảnh báo lại");

		now += 2 * 60_000;
		await run();
		assert.equal(warned.mock.callCount(), 2, "sau 10 phút cảnh báo lại");
	});

	test("service lỗi (ví dụ database) cũng không làm syncTierRoles ném lỗi", async (t) =>
	{
		const warned = t.mock.method(console, "error", () => undefined);
		const broken: TierRoleServiceApi = {
			list: () => [],
			set: () => undefined,
			clear: () => false,
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
