import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GUILD_SETTINGS } from "../src/modules/guild-config/types";
import { canCreatePoll, isAdmin } from "../src/modules/guild-config/permissions";
import { MAX_TEAMS } from "../src/modules/team/TeamService";
import { UserError } from "../src/shared/errors";
import { ADMIN, CHANNEL_BOT, CHANNEL_GENERAL, createTestContext, GUILD, OTHER_GUILD, ROLE_BACKEND, ROLE_FRONTEND, ROLE_OTHER } from "./helpers";

describe("GuildConfigService", () =>
{
	test("guild chưa cấu hình dùng giá trị mặc định", () =>
	{
		const { deps } = createTestContext();
		assert.deepEqual(deps.guildConfig.getSettings(GUILD), DEFAULT_GUILD_SETTINGS);
	});

	test("cập nhật một phần, giữ nguyên phần còn lại, ghi audit, không ảnh hưởng guild khác", () =>
	{
		const { deps } = createTestContext();
		const next = deps.guildConfig.updateSettings(GUILD, { xpPerMessage: 15, adminRoleId: ROLE_BACKEND }, ADMIN);
		assert.equal(next.xpPerMessage, 15);
		assert.equal(next.xpCooldownSeconds, DEFAULT_GUILD_SETTINGS.xpCooldownSeconds);
		assert.deepEqual(deps.guildConfig.getSettings(GUILD), next);
		assert.equal(deps.guildConfig.getSettings(OTHER_GUILD).xpPerMessage, DEFAULT_GUILD_SETTINGS.xpPerMessage);
		const [entry] = deps.audit.list(GUILD, 5);
		assert.equal(entry.action, "config.update");
		assert.deepEqual(entry.details, { xpPerMessage: 15, adminRoleId: ROLE_BACKEND });
	});

	test("từ chối giá trị ngoài giới hạn bằng UserError tiếng Việt", () =>
	{
		const { deps } = createTestContext();
		assert.throws(() => deps.guildConfig.updateSettings(GUILD, { xpPerMessage: -1 }, ADMIN), UserError);
		assert.throws(() => deps.guildConfig.updateSettings(GUILD, { xpCooldownSeconds: 1.5 }, ADMIN), /Cooldown/);
		assert.equal(deps.audit.list(GUILD, 5).length, 0);
	});

	test("cấu hình channel đè lên guild; reset quay về mặc định", () =>
	{
		const { deps } = createTestContext();
		deps.guildConfig.updateSettings(GUILD, { xpPerMessage: 12, xpCooldownSeconds: 30 }, ADMIN);
		deps.guildConfig.setChannel(GUILD, CHANNEL_BOT, { xpEnabled: false }, ADMIN);
		deps.guildConfig.setChannel(GUILD, CHANNEL_GENERAL, { xpPerMessage: 20 }, ADMIN);

		assert.deepEqual(deps.guildConfig.effectiveChannelXp(GUILD, CHANNEL_BOT), { enabled: false, xpPerMessage: 12, cooldownSeconds: 30 });
		assert.deepEqual(deps.guildConfig.effectiveChannelXp(GUILD, CHANNEL_GENERAL), { enabled: true, xpPerMessage: 20, cooldownSeconds: 30 });
		assert.equal(deps.guildConfig.listChannels(GUILD).length, 2);

		deps.guildConfig.setChannel(GUILD, CHANNEL_GENERAL, { xpPerMessage: null }, ADMIN);
		assert.equal(deps.guildConfig.effectiveChannelXp(GUILD, CHANNEL_GENERAL).xpPerMessage, 12);

		assert.equal(deps.guildConfig.resetChannel(GUILD, CHANNEL_BOT, ADMIN), true);
		assert.equal(deps.guildConfig.resetChannel(GUILD, CHANNEL_BOT, ADMIN), false);
		assert.equal(deps.guildConfig.effectiveChannelXp(GUILD, CHANNEL_BOT).enabled, true);
		assert.throws(() => deps.guildConfig.setChannel(GUILD, CHANNEL_GENERAL, { xpCooldownSeconds: 999999 }, ADMIN), UserError);
	});
});

describe("permissions (PROP-013)", () =>
{
	const settings = { adminRoleId: ROLE_BACKEND, pollCreatorRoleId: ROLE_FRONTEND };

	test("isAdmin: Manage Server hoặc role admin đã cấu hình", () =>
	{
		assert.equal(isAdmin({ hasManageGuild: true, roleIds: [] }, { adminRoleId: null }), true);
		assert.equal(isAdmin({ hasManageGuild: false, roleIds: [ROLE_BACKEND] }, settings), true);
		assert.equal(isAdmin({ hasManageGuild: false, roleIds: [ROLE_OTHER] }, settings), false);
		assert.equal(isAdmin({ hasManageGuild: false, roleIds: [ROLE_BACKEND] }, { adminRoleId: null }), false);
	});

	test("canCreatePoll: admin hoặc role tạo vote (DEC-026)", () =>
	{
		assert.equal(canCreatePoll({ hasManageGuild: false, roleIds: [ROLE_FRONTEND] }, settings), true);
		assert.equal(canCreatePoll({ hasManageGuild: false, roleIds: [ROLE_BACKEND] }, settings), true);
		assert.equal(canCreatePoll({ hasManageGuild: false, roleIds: [ROLE_OTHER] }, settings), false);
	});
});

describe("TeamService", () =>
{
	test("thêm, bỏ, liệt kê team và ghi audit", () =>
	{
		const { deps } = createTestContext();
		assert.equal(deps.teams.add(GUILD, ROLE_BACKEND, ADMIN), true);
		assert.equal(deps.teams.add(GUILD, ROLE_BACKEND, ADMIN), false);
		deps.teams.add(GUILD, ROLE_FRONTEND, ADMIN);
		assert.deepEqual(deps.teams.list(GUILD), [ROLE_BACKEND, ROLE_FRONTEND]);
		assert.deepEqual(deps.teams.list(OTHER_GUILD), []);
		assert.equal(deps.teams.remove(GUILD, ROLE_BACKEND, ADMIN), true);
		assert.equal(deps.teams.remove(GUILD, ROLE_BACKEND, ADMIN), false);
		assert.deepEqual(deps.audit.list(GUILD, 10).map(e => e.action), ["team.remove", "team.add", "team.add"]);
	});

	test("resolveTeams lấy giao giữa role của member và team", () =>
	{
		const { deps } = createTestContext();
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		deps.teams.add(GUILD, ROLE_FRONTEND, ADMIN);
		assert.deepEqual(deps.teams.resolveTeams(GUILD, [ROLE_OTHER, ROLE_FRONTEND]), [ROLE_FRONTEND]);
		assert.deepEqual(deps.teams.resolveTeams(GUILD, []), []);
	});

	test(`giới hạn tối đa ${MAX_TEAMS} team`, () =>
	{
		const { deps } = createTestContext();
		for (let i = 0; i < MAX_TEAMS; i++) deps.teams.add(GUILD, `6000000000000000${String(i).padStart(2, "0")}`, ADMIN);
		assert.throws(() => deps.teams.add(GUILD, ROLE_OTHER, ADMIN), UserError);
	});
});

describe("AuditService", () =>
{
	test("ghi và đọc, mới nhất trước, có giới hạn số lượng", () =>
	{
		const { deps, clock } = createTestContext();
		deps.audit.record(GUILD, ADMIN, "xp.adjust", "u1", { delta: 5 });
		clock.advanceSeconds(1);
		deps.audit.record(GUILD, ADMIN, "backup.manual");
		const entries = deps.audit.list(GUILD, 1);
		assert.equal(entries.length, 1);
		assert.equal(entries[0].action, "backup.manual");
		assert.equal(entries[0].details, null);
		assert.deepEqual(deps.audit.list(GUILD, 5)[1].details, { delta: 5 });
	});
});
