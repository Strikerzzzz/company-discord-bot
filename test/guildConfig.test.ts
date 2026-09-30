import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GUILD_SETTINGS, MAX_GRANT_ROLES } from "../src/modules/guild-config/types";
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
		const next = deps.guildConfig.updateSettings(GUILD, { xpPerMessage: 15, adminRoleIds: [ROLE_BACKEND] }, ADMIN);
		assert.equal(next.xpPerMessage, 15);
		assert.equal(next.xpCooldownSeconds, DEFAULT_GUILD_SETTINGS.xpCooldownSeconds);
		assert.deepEqual(next.adminRoleIds, [ROLE_BACKEND]);
		assert.deepEqual(deps.guildConfig.getSettings(GUILD), next);
		assert.equal(deps.guildConfig.getSettings(OTHER_GUILD).xpPerMessage, DEFAULT_GUILD_SETTINGS.xpPerMessage);
		assert.deepEqual(deps.guildConfig.getSettings(OTHER_GUILD).adminRoleIds, []);
		const [entry] = deps.audit.list(GUILD, 5);
		assert.equal(entry.action, "config.update");
		assert.deepEqual(entry.details, { xpPerMessage: 15, adminRoleIds: [ROLE_BACKEND] });
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

describe("GuildConfigService: danh sách role được cấp quyền (DEC-044)", () =>
{
	const role = (index: number): string => `5600000000000000${String(index).padStart(2, "0")}`;

	test("updateSettings thay toàn bộ danh sách: bỏ trùng, role giữ lại không đổi thứ tự, role mới theo created_at rồi role_id", () =>
	{
		const { deps, clock } = createTestContext();
		const { guildConfig } = deps;
		guildConfig.updateSettings(GUILD, { adminRoleIds: [role(3), role(1), role(3)] }, ADMIN);
		assert.deepEqual(guildConfig.getSettings(GUILD).adminRoleIds, [role(1), role(3)], "cùng lúc thêm thì theo role_id");
		clock.advance(1000);
		guildConfig.updateSettings(GUILD, { adminRoleIds: [role(0), role(3)], pollCreatorRoleIds: [role(2)] }, ADMIN);
		const settings = guildConfig.getSettings(GUILD);
		assert.deepEqual(settings.adminRoleIds, [role(3), role(0)], "role 3 giữ mốc cũ nên đứng trước role 0 mới thêm");
		assert.deepEqual(settings.pollCreatorRoleIds, [role(2)]);
		assert.deepEqual(deps.audit.list(GUILD, 1)[0]?.details, { adminRoleIds: [role(0), role(3)], pollCreatorRoleIds: [role(2)] });
		assert.deepEqual(guildConfig.getSettings(OTHER_GUILD).pollCreatorRoleIds, []);

		guildConfig.updateSettings(GUILD, { xpPerMessage: 12 }, ADMIN);
		assert.deepEqual(guildConfig.getSettings(GUILD).adminRoleIds, [role(3), role(0)], "sửa mục khác không đụng danh sách role");
		guildConfig.updateSettings(GUILD, { adminRoleIds: [] }, ADMIN);
		assert.deepEqual(guildConfig.getSettings(GUILD).adminRoleIds, []);
	});

	test("updateSettings: quá MAX_GRANT_ROLES role (sau khi bỏ trùng) bị từ chối, không ghi gì kể cả mục khác", () =>
	{
		const { deps } = createTestContext();
		const full = Array.from({ length: MAX_GRANT_ROLES }, (_, index) => role(index));
		deps.guildConfig.updateSettings(GUILD, { pollCreatorRoleIds: [...full, ...full] }, ADMIN);
		assert.equal(deps.guildConfig.getSettings(GUILD).pollCreatorRoleIds.length, MAX_GRANT_ROLES);
		assert.throws(() => deps.guildConfig.updateSettings(GUILD, { xpPerMessage: 20, adminRoleIds: [...full, ROLE_BACKEND] }, ADMIN), /tối đa 25 role admin bot/);
		assert.equal(deps.guildConfig.getSettings(GUILD).xpPerMessage, DEFAULT_GUILD_SETTINGS.xpPerMessage);
		assert.deepEqual(deps.guildConfig.getSettings(GUILD).adminRoleIds, []);
	});

	test("changeRoleGrants: chỉ ghi phần chênh lệch, bỏ qua role vốn đúng trạng thái, một audit có danh sách mới và phần thêm/bỏ", () =>
	{
		const { deps } = createTestContext();
		const { guildConfig } = deps;
		const first = guildConfig.changeRoleGrants(GUILD, "adminRoleIds", { add: [ROLE_BACKEND, ROLE_FRONTEND, ROLE_BACKEND] }, ADMIN);
		assert.deepEqual(first, { added: [ROLE_BACKEND, ROLE_FRONTEND], removed: [], alreadyGranted: [], notGranted: [], roleIds: [ROLE_BACKEND, ROLE_FRONTEND] });

		const second = guildConfig.changeRoleGrants(GUILD, "adminRoleIds", { add: [ROLE_FRONTEND, ROLE_OTHER], remove: [ROLE_BACKEND, role(9)] }, ADMIN);
		assert.deepEqual(second, { added: [ROLE_OTHER], removed: [ROLE_BACKEND], alreadyGranted: [ROLE_FRONTEND], notGranted: [role(9)], roleIds: [ROLE_FRONTEND, ROLE_OTHER] });
		assert.deepEqual(guildConfig.getSettings(GUILD).adminRoleIds, [ROLE_FRONTEND, ROLE_OTHER]);
		assert.deepEqual(guildConfig.getSettings(GUILD).pollCreatorRoleIds, [], "danh sách còn lại không đổi");

		const audits = deps.audit.list(GUILD, 10);
		assert.equal(audits.length, 2);
		assert.deepEqual(audits[0]?.details, { adminRoleIds: [ROLE_FRONTEND, ROLE_OTHER], addedRoles: [ROLE_OTHER], removedRoles: [ROLE_BACKEND] });
		assert.deepEqual(audits[1]?.details, { adminRoleIds: [ROLE_BACKEND, ROLE_FRONTEND], addedRoles: [ROLE_BACKEND, ROLE_FRONTEND] });

		const nothing = guildConfig.changeRoleGrants(GUILD, "adminRoleIds", { add: [ROLE_OTHER], remove: [ROLE_BACKEND] }, ADMIN);
		assert.deepEqual(nothing, { added: [], removed: [], alreadyGranted: [ROLE_OTHER], notGranted: [ROLE_BACKEND], roleIds: [ROLE_FRONTEND, ROLE_OTHER] });
		assert.equal(deps.audit.list(GUILD, 10).length, 2, "không đổi gì thì không audit");
	});

	test("changeRoleGrants: vượt MAX_GRANT_ROLES hoặc vừa thêm vừa bỏ cùng role thì từ chối, không ghi gì; bỏ bớt trong cùng lần thì thêm được", () =>
	{
		const { deps } = createTestContext();
		const { guildConfig } = deps;
		const full = Array.from({ length: MAX_GRANT_ROLES }, (_, index) => role(index));
		guildConfig.changeRoleGrants(GUILD, "pollCreatorRoleIds", { add: full }, ADMIN);
		const before = deps.audit.list(GUILD, 10).length;
		assert.throws(() => guildConfig.changeRoleGrants(GUILD, "pollCreatorRoleIds", { add: [ROLE_BACKEND] }, ADMIN), /tối đa 25 role được tạo vote: đang có 25 role/);
		assert.throws(() => guildConfig.changeRoleGrants(GUILD, "adminRoleIds", { add: [ROLE_BACKEND], remove: [ROLE_BACKEND] }, ADMIN), UserError);
		assert.equal(deps.audit.list(GUILD, 10).length, before);
		assert.deepEqual(guildConfig.getSettings(GUILD).pollCreatorRoleIds, full);

		const swapped = guildConfig.changeRoleGrants(GUILD, "pollCreatorRoleIds", { add: [ROLE_BACKEND], remove: [role(0)] }, ADMIN);
		assert.deepEqual(swapped.added, [ROLE_BACKEND]);
		assert.equal(guildConfig.getSettings(GUILD).pollCreatorRoleIds.length, MAX_GRANT_ROLES);
		assert.doesNotThrow(() => guildConfig.changeRoleGrants(GUILD, "pollCreatorRoleIds", { add: [ROLE_BACKEND], remove: [role(1)] }, ADMIN), "role vốn có không tính là thêm");
	});

	test("guild chưa có dòng guild_settings vẫn đọc được danh sách role (changeRoleGrants không tạo dòng cấu hình)", () =>
	{
		const { deps, db } = createTestContext();
		deps.guildConfig.changeRoleGrants(GUILD, "adminRoleIds", { add: [ROLE_BACKEND] }, ADMIN);
		assert.deepEqual(db.prepare("SELECT COUNT(*) AS count FROM guild_settings").get(), { count: 0 });
		assert.deepEqual(deps.guildConfig.getSettings(GUILD), { ...DEFAULT_GUILD_SETTINGS, adminRoleIds: [ROLE_BACKEND] });
		assert.deepEqual(DEFAULT_GUILD_SETTINGS.adminRoleIds, [], "không sửa nhầm mảng của giá trị mặc định");
	});
});

describe("permissions (PROP-013, DEC-044)", () =>
{
	const settings = { adminRoleIds: [ROLE_OTHER, ROLE_BACKEND], pollCreatorRoleIds: [ROLE_FRONTEND] };

	test("isAdmin: Manage Server hoặc có ít nhất một role trong danh sách role admin", () =>
	{
		assert.equal(isAdmin({ hasManageGuild: true, roleIds: [] }, { adminRoleIds: [] }), true);
		assert.equal(isAdmin({ hasManageGuild: false, roleIds: [ROLE_BACKEND] }, settings), true, "role thứ hai trong danh sách cũng là admin");
		assert.equal(isAdmin({ hasManageGuild: false, roleIds: [ROLE_OTHER] }, settings), true);
		assert.equal(isAdmin({ hasManageGuild: false, roleIds: [ROLE_FRONTEND] }, settings), false);
		assert.equal(isAdmin({ hasManageGuild: false, roleIds: [] }, settings), false);
		assert.equal(isAdmin({ hasManageGuild: false, roleIds: [ROLE_BACKEND] }, { adminRoleIds: [] }), false);
	});

	test("canCreatePoll: admin hoặc có một role tạo vote (DEC-026)", () =>
	{
		assert.equal(canCreatePoll({ hasManageGuild: false, roleIds: [ROLE_FRONTEND] }, settings), true);
		assert.equal(canCreatePoll({ hasManageGuild: false, roleIds: [ROLE_BACKEND] }, settings), true);
		assert.equal(canCreatePoll({ hasManageGuild: false, roleIds: ["500000000000000077"] }, settings), false);
		assert.equal(canCreatePoll({ hasManageGuild: false, roleIds: [ROLE_FRONTEND] }, { adminRoleIds: [], pollCreatorRoleIds: [] }), false);
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
