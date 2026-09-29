import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GUILD_SETTINGS } from "../src/modules/guild-config/types";
import { canCreatePoll, isAdmin } from "../src/modules/guild-config/permissions";
import { MAX_BULK_CHANNELS } from "../src/modules/guild-config/GuildConfigService";
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

	test("chế độ 'selected': kênh chưa cấu hình (kể cả kênh mới) không tính XP; kênh bật riêng tính; reset quay về không tính (DEC-037)", () =>
	{
		const { deps } = createTestContext();
		const NEW_CHANNEL = "700000000000000099";
		deps.guildConfig.setChannel(GUILD, CHANNEL_BOT, { xpEnabled: false }, ADMIN);
		deps.guildConfig.updateSettings(GUILD, { xpChannelMode: "selected" }, ADMIN);

		assert.equal(deps.guildConfig.getSettings(GUILD).xpChannelMode, "selected");
		assert.equal(deps.guildConfig.effectiveChannelXp(GUILD, NEW_CHANNEL).enabled, false);
		assert.equal(deps.guildConfig.getChannel(GUILD, NEW_CHANNEL).xpEnabled, false);
		assert.equal(deps.guildConfig.effectiveChannelXp(GUILD, CHANNEL_BOT).enabled, false);

		deps.guildConfig.setChannel(GUILD, CHANNEL_GENERAL, { xpEnabled: true }, ADMIN);
		assert.equal(deps.guildConfig.effectiveChannelXp(GUILD, CHANNEL_GENERAL).enabled, true);
		deps.guildConfig.setChannel(GUILD, NEW_CHANNEL, { xpPerMessage: 20 }, ADMIN);
		assert.equal(deps.guildConfig.effectiveChannelXp(GUILD, NEW_CHANNEL).enabled, false, "đặt XP riêng không tự bật kênh");

		deps.guildConfig.resetChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		assert.equal(deps.guildConfig.effectiveChannelXp(GUILD, CHANNEL_GENERAL).enabled, false);

		deps.guildConfig.updateSettings(GUILD, { xpChannelMode: "all" }, ADMIN);
		assert.equal(deps.guildConfig.effectiveChannelXp(GUILD, CHANNEL_GENERAL).enabled, true);
		assert.equal(deps.guildConfig.effectiveChannelXp(GUILD, CHANNEL_BOT).enabled, false, "kênh tắt riêng vẫn tắt khi về chế độ all");
		assert.equal(deps.guildConfig.getSettings(OTHER_GUILD).xpChannelMode, "all");
	});

	test("chế độ kênh không hợp lệ bị từ chối, không ghi gì", () =>
	{
		const { deps } = createTestContext();
		const bad: unknown = "khac";
		// Cố ý ép kiểu sai để thử kiểm tra lúc chạy (giá trị từ nguồn không kiểm soát được, như DB sửa tay).
		const patch = { xpChannelMode: bad } as Partial<Parameters<typeof deps.guildConfig.updateSettings>[1]>;
		assert.throws(() => deps.guildConfig.updateSettings(GUILD, patch, ADMIN), /Chế độ kênh/);
		assert.equal(deps.audit.list(GUILD, 5).length, 0);
	});

	test("bật/tắt hàng loạt: bỏ qua kênh đã đúng trạng thái, lưu trạng thái thành cấu hình riêng, giữ XP riêng, audit từng kênh", () =>
	{
		const { deps } = createTestContext();
		const C3 = "700000000000000099";
		deps.guildConfig.updateSettings(GUILD, { xpChannelMode: "selected" }, ADMIN);
		deps.guildConfig.setChannel(GUILD, C3, { xpPerMessage: 20 }, ADMIN);
		const auditBefore = deps.audit.list(GUILD, 50).length;

		const enabled = deps.guildConfig.setChannelsXpEnabled(GUILD, [CHANNEL_GENERAL, C3, CHANNEL_GENERAL], true, ADMIN);
		assert.deepEqual(enabled, { changed: [CHANNEL_GENERAL, C3], unchanged: [] });
		assert.deepEqual(deps.guildConfig.effectiveChannelXp(GUILD, C3), { enabled: true, xpPerMessage: 20, cooldownSeconds: 60 });
		assert.equal(deps.audit.list(GUILD, 50).length, auditBefore + 2);
		assert.deepEqual(deps.audit.list(GUILD, 1)[0].details, { xpEnabled: true });

		assert.deepEqual(deps.guildConfig.setChannelsXpEnabled(GUILD, [CHANNEL_GENERAL, CHANNEL_BOT], true, ADMIN), {
			changed: [CHANNEL_BOT],
			unchanged: [CHANNEL_GENERAL],
		});

		const disabled = deps.guildConfig.setChannelsXpEnabled(GUILD, [CHANNEL_GENERAL, C3], false, ADMIN);
		assert.deepEqual(disabled.changed, [CHANNEL_GENERAL, C3]);
		const rows = new Map(deps.guildConfig.listChannels(GUILD).map(channel => [channel.channelId, channel]));
		assert.deepEqual(rows.get(CHANNEL_GENERAL), { channelId: CHANNEL_GENERAL, xpEnabled: false, xpPerMessage: null, xpCooldownSeconds: null });
		assert.deepEqual(rows.get(C3), { channelId: C3, xpEnabled: false, xpPerMessage: 20, xpCooldownSeconds: null });

		deps.guildConfig.updateSettings(GUILD, { xpChannelMode: "all" }, ADMIN);
		assert.equal(deps.guildConfig.effectiveChannelXp(GUILD, CHANNEL_GENERAL).enabled, false, "kênh admin đã tắt vẫn tắt khi đổi chế độ");

		assert.throws(() => deps.guildConfig.setChannelsXpEnabled(GUILD, [], true, ADMIN), UserError);
		const tooMany = Array.from({ length: MAX_BULK_CHANNELS + 1 }, (_, index) => `7000000000000001${String(index).padStart(2, "0")}`);
		assert.throws(() => deps.guildConfig.setChannelsXpEnabled(GUILD, tooMany, true, ADMIN), UserError);
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

	test("thêm/bỏ nhiều team một lần: bỏ trùng, role đã đúng trạng thái là unchanged, audit từng role, vượt giới hạn thì không thêm gì", () =>
	{
		const { deps } = createTestContext();
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		assert.deepEqual(deps.teams.addMany(GUILD, [ROLE_FRONTEND, ROLE_BACKEND, ROLE_FRONTEND, ROLE_OTHER], ADMIN), {
			changed: [ROLE_FRONTEND, ROLE_OTHER],
			unchanged: [ROLE_BACKEND],
		});
		assert.deepEqual(deps.teams.list(GUILD).sort(), [ROLE_BACKEND, ROLE_FRONTEND, ROLE_OTHER].sort());
		assert.deepEqual(deps.teams.removeMany(GUILD, [ROLE_OTHER, "600000000000000099"], ADMIN), { changed: [ROLE_OTHER], unchanged: ["600000000000000099"] });
		assert.deepEqual(deps.audit.list(GUILD, 10).map(entry => entry.action), ["team.remove", "team.add", "team.add", "team.add"]);

		const many = Array.from({ length: MAX_TEAMS }, (_, index) => `6000000000000001${String(index).padStart(2, "0")}`);
		assert.throws(() => deps.teams.addMany(GUILD, many, ADMIN), /Bot chưa thêm role nào/);
		assert.equal(deps.teams.list(GUILD).length, 2);
	});

	test("thêm nhiều team là một transaction: lỗi giữa chừng thì không role nào được lưu, không audit nào", () =>
	{
		const { deps } = createTestContext();
		const record = deps.audit.record.bind(deps.audit);
		let calls = 0;
		deps.audit.record = (...args: Parameters<typeof record>): ReturnType<typeof record> =>
		{
			calls += 1;
			if (calls === 2) throw new Error("đĩa đầy (giả lập)");
			return record(...args);
		};
		assert.throws(() => deps.teams.addMany(GUILD, [ROLE_BACKEND, ROLE_FRONTEND], ADMIN), /đĩa đầy/);
		deps.audit.record = record;
		assert.deepEqual(deps.teams.list(GUILD), []);
		assert.deepEqual(deps.audit.list(GUILD, 10), []);
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
