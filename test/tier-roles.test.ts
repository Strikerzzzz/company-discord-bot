import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { TierRoleService } from "../src/modules/gamification/TierRoleService";
import { UserError } from "../src/shared/errors";
import { ADMIN, createTestContext, GUILD, OTHER_GUILD, ROLE_OTHER, TestContext, USER_A } from "./helpers";

const ROLE_LUYEN_KHI = "510000000000000001";
const ROLE_TRUC_CO = "510000000000000002";
const ROLE_KIM_DAN = "510000000000000003";
const ROLE_DO_KIEP = "510000000000000008";

/**
 * Cùng hình dạng với set/clear nhưng nhận chuỗi bất kỳ, để mô phỏng dữ liệu sai kiểu đến từ Discord mà không cần ép kiểu.
 * Gán được vì tham số của method được so sánh hai chiều (bivariant).
 */
interface LooseTierRoles
{
	set(guildId: string, tierKey: string, roleId: string, actorId: string): void;
	clear(guildId: string, tierKey: string, actorId: string): boolean;
}

function setup(): TestContext & { tierRoles: TierRoleService }
{
	const context = createTestContext();
	return { ...context, tierRoles: new TierRoleService(context.db, context.clock, context.deps.audit) };
}

function userError(message: string | RegExp): (error: unknown) => boolean
{
	return (error: unknown): boolean =>
	{
		assert.ok(error instanceof UserError, `Mong đợi UserError, nhận được ${String(error)}`);
		if (typeof message === "string") assert.equal(error.message, message);
		else assert.match(error.message, message);
		return true;
	};
}

function tierRoleAudits(context: TestContext, guildId = GUILD): { action: string; actorId: string; targetId: string | null; details: unknown }[]
{
	return context.deps.audit.list(guildId, 100)
		.filter(entry => entry.action === "tier_role.set" || entry.action === "tier_role.clear")
		.map(entry => ({ action: entry.action, actorId: entry.actorId, targetId: entry.targetId, details: entry.details }))
		.reverse();
}

function updatedAt(context: TestContext, tierKey: string): number | undefined
{
	return context.db.prepare<[string, string], { updated_at: number }>("SELECT updated_at FROM tier_roles WHERE guild_id = ? AND tier_key = ?")
		.get(GUILD, tierKey)?.updated_at;
}

describe("TierRoleService.set và list", () =>
{
	test("list theo thứ tự TIERS dù gán theo thứ tự nào; guild chưa gán thì rỗng", () =>
	{
		const { tierRoles } = setup();
		assert.deepEqual(tierRoles.list(GUILD), []);

		tierRoles.set(GUILD, "do-kiep", ROLE_DO_KIEP, ADMIN);
		tierRoles.set(GUILD, "luyen-khi", ROLE_LUYEN_KHI, ADMIN);
		tierRoles.set(GUILD, "kim-dan", ROLE_KIM_DAN, ADMIN);
		assert.deepEqual(tierRoles.list(GUILD), [
			{ tierKey: "luyen-khi", roleId: ROLE_LUYEN_KHI },
			{ tierKey: "kim-dan", roleId: ROLE_KIM_DAN },
			{ tierKey: "do-kiep", roleId: ROLE_DO_KIEP },
		]);
		assert.deepEqual(tierRoles.list(OTHER_GUILD), []);
	});

	test("gán ghi updated_at và audit tier_role.set (target = role, details { tierKey })", () =>
	{
		const context = setup();
		const { tierRoles, clock } = context;
		tierRoles.set(GUILD, "truc-co", ROLE_TRUC_CO, ADMIN);

		assert.equal(updatedAt(context, "truc-co"), clock.now());
		assert.deepEqual(tierRoleAudits(context), [
			{ action: "tier_role.set", actorId: ADMIN, targetId: ROLE_TRUC_CO, details: { tierKey: "truc-co" } },
		]);
	});

	test("gán lại đúng role đó cho đúng cảnh giới đó thì không làm gì, không ghi audit", () =>
	{
		const context = setup();
		const { tierRoles, clock } = context;
		tierRoles.set(GUILD, "truc-co", ROLE_TRUC_CO, ADMIN);
		const firstUpdate = clock.now();

		clock.advanceSeconds(60);
		tierRoles.set(GUILD, "truc-co", ROLE_TRUC_CO, USER_A);
		assert.equal(updatedAt(context, "truc-co"), firstUpdate);
		assert.equal(tierRoleAudits(context).length, 1);
	});

	test("đổi role của một cảnh giới: thay role cũ, role cũ dùng lại được cho cảnh giới khác", () =>
	{
		const context = setup();
		const { tierRoles, clock } = context;
		tierRoles.set(GUILD, "kim-dan", ROLE_KIM_DAN, ADMIN);
		clock.advanceSeconds(60);
		tierRoles.set(GUILD, "kim-dan", ROLE_OTHER, ADMIN);

		assert.deepEqual(tierRoles.list(GUILD), [{ tierKey: "kim-dan", roleId: ROLE_OTHER }]);
		assert.equal(updatedAt(context, "kim-dan"), clock.now());
		tierRoles.set(GUILD, "truc-co", ROLE_KIM_DAN, ADMIN);
		assert.deepEqual(tierRoles.list(GUILD), [
			{ tierKey: "truc-co", roleId: ROLE_KIM_DAN },
			{ tierKey: "kim-dan", roleId: ROLE_OTHER },
		]);
		assert.deepEqual(tierRoleAudits(context).map(entry => [entry.targetId, entry.details]), [
			[ROLE_KIM_DAN, { tierKey: "kim-dan" }],
			[ROLE_OTHER, { tierKey: "kim-dan" }],
			[ROLE_KIM_DAN, { tierKey: "truc-co" }],
		]);
	});

	test("role đang gán cho cảnh giới khác thì báo lỗi nêu tên cảnh giới đó, không đổi dữ liệu", () =>
	{
		const context = setup();
		const { tierRoles } = context;
		tierRoles.set(GUILD, "kim-dan", ROLE_KIM_DAN, ADMIN);
		tierRoles.set(GUILD, "truc-co", ROLE_TRUC_CO, ADMIN);

		const conflict = userError("Role này đang được gán cho cảnh giới Kim Đan. Hãy bỏ gán ở cảnh giới đó trước.");
		assert.throws(() => tierRoles.set(GUILD, "do-kiep", ROLE_KIM_DAN, ADMIN), conflict);
		assert.throws(() => tierRoles.set(GUILD, "truc-co", ROLE_KIM_DAN, ADMIN), conflict);
		assert.deepEqual(tierRoles.list(GUILD), [
			{ tierKey: "truc-co", roleId: ROLE_TRUC_CO },
			{ tierKey: "kim-dan", roleId: ROLE_KIM_DAN },
		]);
		assert.equal(tierRoleAudits(context).length, 2);
	});

	test("cùng một role được gán ở guild khác; các guild độc lập", () =>
	{
		const context = setup();
		const { tierRoles } = context;
		tierRoles.set(GUILD, "kim-dan", ROLE_KIM_DAN, ADMIN);
		tierRoles.set(OTHER_GUILD, "do-kiep", ROLE_KIM_DAN, ADMIN);

		assert.deepEqual(tierRoles.list(GUILD), [{ tierKey: "kim-dan", roleId: ROLE_KIM_DAN }]);
		assert.deepEqual(tierRoles.list(OTHER_GUILD), [{ tierKey: "do-kiep", roleId: ROLE_KIM_DAN }]);
		assert.equal(tierRoleAudits(context, OTHER_GUILD).length, 1);
	});

	test("khoá cảnh giới sai (dữ liệu từ Discord) thì báo lỗi, không ghi gì", () =>
	{
		const context = setup();
		const loose: LooseTierRoles = context.tierRoles;
		assert.throws(() => loose.set(GUILD, "tran-tien", ROLE_OTHER, ADMIN), userError("Cảnh giới không hợp lệ."));
		assert.throws(() => loose.set(GUILD, "", ROLE_OTHER, ADMIN), userError("Cảnh giới không hợp lệ."));
		assert.throws(() => loose.clear(GUILD, "tran-tien", ADMIN), userError("Cảnh giới không hợp lệ."));
		assert.deepEqual(context.tierRoles.list(GUILD), []);
		assert.equal(tierRoleAudits(context).length, 0);
	});

	test("list bỏ qua khoá lạ trong database (sửa tay)", () =>
	{
		const context = setup();
		context.db.prepare("INSERT INTO tier_roles (guild_id, tier_key, role_id, updated_at) VALUES (?, 'khoa-la', ?, 0)").run(GUILD, ROLE_OTHER);
		context.tierRoles.set(GUILD, "luyen-khi", ROLE_LUYEN_KHI, ADMIN);
		assert.deepEqual(context.tierRoles.list(GUILD), [{ tierKey: "luyen-khi", roleId: ROLE_LUYEN_KHI }]);
		assert.throws(() => context.tierRoles.set(GUILD, "truc-co", ROLE_OTHER, ADMIN), userError(/cảnh giới khoa-la\./));
	});
});

describe("TierRoleService.clear", () =>
{
	test("bỏ gán: xoá cấu hình, audit tier_role.clear với role cũ; chưa gán thì trả false, không audit", () =>
	{
		const context = setup();
		const { tierRoles } = context;
		assert.equal(tierRoles.clear(GUILD, "kim-dan", ADMIN), false);
		assert.equal(tierRoleAudits(context).length, 0);

		tierRoles.set(GUILD, "kim-dan", ROLE_KIM_DAN, ADMIN);
		tierRoles.set(GUILD, "truc-co", ROLE_TRUC_CO, ADMIN);
		assert.equal(tierRoles.clear(GUILD, "kim-dan", USER_A), true);
		assert.deepEqual(tierRoles.list(GUILD), [{ tierKey: "truc-co", roleId: ROLE_TRUC_CO }]);
		assert.equal(tierRoles.clear(GUILD, "kim-dan", USER_A), false);

		assert.deepEqual(tierRoleAudits(context).slice(2), [
			{ action: "tier_role.clear", actorId: USER_A, targetId: ROLE_KIM_DAN, details: { tierKey: "kim-dan" } },
		]);
	});

	test("sau khi bỏ gán, role đó gán được cho cảnh giới khác", () =>
	{
		const { tierRoles } = setup();
		tierRoles.set(GUILD, "kim-dan", ROLE_KIM_DAN, ADMIN);
		tierRoles.clear(GUILD, "kim-dan", ADMIN);
		tierRoles.set(GUILD, "do-kiep", ROLE_KIM_DAN, ADMIN);
		assert.deepEqual(tierRoles.list(GUILD), [{ tierKey: "do-kiep", roleId: ROLE_KIM_DAN }]);
	});

	test("chỉ bỏ gán trong đúng guild", () =>
	{
		const { tierRoles } = setup();
		tierRoles.set(GUILD, "kim-dan", ROLE_KIM_DAN, ADMIN);
		tierRoles.set(OTHER_GUILD, "kim-dan", ROLE_KIM_DAN, ADMIN);
		assert.equal(tierRoles.clear(OTHER_GUILD, "kim-dan", ADMIN), true);
		assert.deepEqual(tierRoles.list(GUILD), [{ tierKey: "kim-dan", roleId: ROLE_KIM_DAN }]);
		assert.deepEqual(tierRoles.list(OTHER_GUILD), []);
	});
});

describe("TierRoleService.plan", () =>
{
	function configured(): TierRoleService
	{
		const { tierRoles } = setup();
		tierRoles.set(GUILD, "luyen-khi", ROLE_LUYEN_KHI, ADMIN);
		tierRoles.set(GUILD, "truc-co", ROLE_TRUC_CO, ADMIN);
		tierRoles.set(GUILD, "kim-dan", ROLE_KIM_DAN, ADMIN);
		return tierRoles;
	}

	test("guild chưa gán role nào thì không thêm, không bỏ gì", () =>
	{
		const { tierRoles } = setup();
		assert.deepEqual(tierRoles.plan(GUILD, 50, [ROLE_OTHER, ROLE_KIM_DAN]), { add: [], remove: [] });
	});

	test("thêm role của cảnh giới hiện tại nếu thiếu, bỏ role của cảnh giới khác, không đụng role khác", () =>
	{
		const tierRoles = configured();
		assert.deepEqual(tierRoles.plan(GUILD, 0, []), { add: [ROLE_LUYEN_KHI], remove: [] });
		assert.deepEqual(tierRoles.plan(GUILD, 2, [ROLE_OTHER]), { add: [ROLE_LUYEN_KHI], remove: [] });
		assert.deepEqual(tierRoles.plan(GUILD, 3, [ROLE_LUYEN_KHI, ROLE_OTHER]), { add: [ROLE_TRUC_CO], remove: [ROLE_LUYEN_KHI] });
		assert.deepEqual(tierRoles.plan(GUILD, 5, [ROLE_OTHER, ROLE_TRUC_CO]), { add: [], remove: [] });
		assert.deepEqual(tierRoles.plan(GUILD, 6, [ROLE_TRUC_CO]), { add: [ROLE_KIM_DAN], remove: [ROLE_TRUC_CO] });
	});

	test("xuống cảnh giới cũng đổi role", () =>
	{
		const tierRoles = configured();
		assert.deepEqual(tierRoles.plan(GUILD, 4, [ROLE_KIM_DAN]), { add: [ROLE_TRUC_CO], remove: [ROLE_KIM_DAN] });
	});

	test("remove không trùng và theo thứ tự cảnh giới, không phụ thuộc thứ tự role của member", () =>
	{
		const tierRoles = configured();
		assert.deepEqual(
			tierRoles.plan(GUILD, 7, [ROLE_TRUC_CO, ROLE_OTHER, ROLE_KIM_DAN, ROLE_LUYEN_KHI, ROLE_TRUC_CO]),
			{ add: [], remove: [ROLE_LUYEN_KHI, ROLE_TRUC_CO] },
		);
		assert.deepEqual(tierRoles.plan(GUILD, 1, [ROLE_KIM_DAN, ROLE_TRUC_CO, ROLE_KIM_DAN]), { add: [ROLE_LUYEN_KHI], remove: [ROLE_TRUC_CO, ROLE_KIM_DAN] });
	});

	test("cảnh giới hiện tại chưa gán role thì không thêm gì nhưng vẫn bỏ role cảnh giới khác", () =>
	{
		const tierRoles = configured();
		assert.deepEqual(tierRoles.plan(GUILD, 12, [ROLE_KIM_DAN, ROLE_OTHER]), { add: [], remove: [ROLE_KIM_DAN] });
		assert.deepEqual(tierRoles.plan(GUILD, 100, []), { add: [], remove: [] });
	});

	test("level âm hoặc không hợp lệ coi như level 0", () =>
	{
		const tierRoles = configured();
		assert.deepEqual(tierRoles.plan(GUILD, -5, [ROLE_KIM_DAN]), { add: [ROLE_LUYEN_KHI], remove: [ROLE_KIM_DAN] });
		assert.deepEqual(tierRoles.plan(GUILD, Number.NaN, []), { add: [ROLE_LUYEN_KHI], remove: [] });
	});

	test("chỉ dùng cấu hình của đúng guild", () =>
	{
		const tierRoles = configured();
		assert.deepEqual(tierRoles.plan(OTHER_GUILD, 6, [ROLE_LUYEN_KHI, ROLE_TRUC_CO]), { add: [], remove: [] });
	});
});
