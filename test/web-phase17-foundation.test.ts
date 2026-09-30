import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ChannelType } from "discord.js";
import {
	adjustMemberContribution,
	adjustMemberXp,
	assertContributionDelta,
	assertXpAmount,
	MAX_ADJUST,
	normalizeReason,
	REASON_MAX_LENGTH,
	resetAllContribution,
	resetAllXp,
	syncMemberTierRoles,
} from "../src/discord/adminOps";
import { pageWindow, MAX_PAGE_SIZE } from "../src/shared/paging";
import { UserError } from "../src/shared/errors";
import { canViewItemChannel, hiddenChannelIds, lookupMember } from "../src/web/discord";
import { html } from "../src/web/html";
import { csrfField, renderPage } from "../src/web/layout";
import type { PageModule } from "../src/web/types";
import { pager, parsePositiveId, parseUserId, queryPage, requireUserId, userCell } from "../src/web/widgets";
import { GUILD } from "./helpers";
import {
	addChannel,
	ADMIN_USER,
	call,
	CHANNEL_CHAT,
	createWebHarness,
	login,
	PLAIN_USER,
	STRANGER,
	withCsrf,
} from "./web-helpers";

const PRIVATE_CHANNEL = "410000000000000099";

describe("nền móng Phase 17: phân trang", () =>
{
	test("pageWindow kẹp trang về khoảng hợp lệ, danh sách rỗng vẫn có 1 trang", () =>
	{
		assert.deepEqual(pageWindow(0, 5, 10), { page: 1, totalPages: 1, pageSize: 10, offset: 0 });
		assert.deepEqual(pageWindow(25, 3, 10), { page: 3, totalPages: 3, pageSize: 10, offset: 20 });
		assert.deepEqual(pageWindow(25, 99, 10), { page: 3, totalPages: 3, pageSize: 10, offset: 20 });
		assert.equal(pageWindow(25, -4, 10).page, 1);
		assert.equal(pageWindow(25, Number.NaN, 10).page, 1);
		assert.equal(pageWindow(1000, 1, 5000).pageSize, MAX_PAGE_SIZE);
		assert.equal(pageWindow(10, 1, 0).pageSize, 1);
	});

	test("PollService.listPage lọc mở/đóng (kể cả vote quá hạn chưa được quét), mới nhất trước", () =>
	{
		const { services, clock } = createWebHarness();
		const create = (question: string, durationMinutes: number | null): number =>
		{
			const poll = services.polls.create({ guildId: GUILD, creatorId: ADMIN_USER, question, options: ["Có", "Không"], multiSelect: false, xpReward: 0, durationMinutes });
			clock.advance(1000);
			return poll.id;
		};
		const openId = create("Vote mở", null);
		const expiringId = create("Vote hết hạn", 1);
		const closedId = create("Vote đã đóng", null);
		services.polls.close({ guildId: GUILD, pollId: closedId, actorId: ADMIN_USER, actorIsAdmin: true });
		clock.advance(2 * 60_000);

		const ids = (status: "open" | "closed" | "all"): number[] => services.polls.listPage(GUILD, { status, page: 1, pageSize: 10 }).items.map(poll => poll.id);
		assert.deepEqual(ids("open"), [openId]);
		assert.deepEqual(ids("closed"), [closedId, expiringId]);
		assert.deepEqual(ids("all"), [closedId, expiringId, openId]);

		const second = services.polls.listPage(GUILD, { status: "all", page: 2, pageSize: 2 });
		assert.deepEqual(second.items.map(poll => poll.id), [openId]);
		assert.equal(second.total, 3);
		assert.equal(second.totalPages, 2);
		assert.equal(services.polls.listPage("100000000000000002", { status: "all", page: 1, pageSize: 10 }).total, 0);
	});

	test("ContributionService.listPage lọc theo tác giả và trạng thái (kể cả đã gỡ)", () =>
	{
		const { services, clock } = createWebHarness();
		const submit = (authorId: string, title: string): number =>
		{
			const contribution = services.contributions.submit({
				guildId: GUILD, authorId, submittedBy: authorId, title, description: "Mô tả", category: "y-tuong", link: null, authorRoleIds: [],
			});
			clock.advance(1000);
			return contribution.id;
		};
		const a1 = submit(PLAIN_USER, "Ý tưởng một");
		const b1 = submit(ADMIN_USER, "Ý tưởng hai");
		const a2 = submit(PLAIN_USER, "Ý tưởng ba");
		services.contributions.remove(GUILD, a1, ADMIN_USER);

		const ids = (status: "active" | "removed" | "all", authorId?: string): number[] =>
			services.contributions.listPage(GUILD, { authorId, status, page: 1, pageSize: 10 }).items.map(item => item.id);
		assert.deepEqual(ids("all"), [a2, b1, a1]);
		assert.deepEqual(ids("active"), [a2, b1]);
		assert.deepEqual(ids("removed"), [a1]);
		assert.deepEqual(ids("all", PLAIN_USER), [a2, a1]);
		assert.deepEqual(ids("active", PLAIN_USER), [a2]);
		assert.equal(services.contributions.listPage(GUILD, { status: "all", page: 1, pageSize: 2 }).totalPages, 2);
	});
});

describe("nền móng Phase 17: adminOps dùng chung cho /admin và web", () =>
{
	test("kiểm tra đầu vào: lý do, số XP, điểm contribution", () =>
	{
		assert.equal(normalizeReason("  "), null);
		assert.equal(normalizeReason(undefined), null);
		assert.equal(normalizeReason("  thưởng  "), "thưởng");
		assert.equal(normalizeReason("😀".repeat(REASON_MAX_LENGTH)), "😀".repeat(REASON_MAX_LENGTH));
		assert.throws(() => normalizeReason("a".repeat(REASON_MAX_LENGTH + 1)), UserError);
		assert.throws(() => assertXpAmount(0), UserError);
		assert.throws(() => assertXpAmount(1.5), UserError);
		assert.throws(() => assertXpAmount(MAX_ADJUST + 1), UserError);
		assertXpAmount(MAX_ADJUST);
		assert.throws(() => assertContributionDelta(0), { message: "Số điểm phải khác 0." });
		assert.throws(() => assertContributionDelta(-MAX_ADJUST - 1), UserError);
		assertContributionDelta(-5);
	});

	test("cộng/trừ và reset toàn server đi qua service, reset cần đúng chuỗi xác nhận", () =>
	{
		const { services } = createWebHarness();
		const target = { guildId: GUILD, userId: PLAIN_USER, roleIds: [], actorId: ADMIN_USER };
		const given = adjustMemberXp(services, target, 1, 120, "thưởng");
		assert.equal(given.totalXp, 120);
		assert.match(given.text, /Đã cộng 120 XP/u);
		assert.match(adjustMemberContribution(services, target, 7, null), /Tổng: 7 điểm/u);

		assert.throws(() => resetAllXp(services, GUILD, ADMIN_USER, "xac nhan"), UserError);
		assert.equal(services.activity.getProfile(GUILD, PLAIN_USER).level.totalXp, 120);
		assert.match(resetAllXp(services, GUILD, ADMIN_USER, " XAC NHAN "), /Đã reset XP toàn server/u);
		assert.equal(services.activity.getProfile(GUILD, PLAIN_USER).level.totalXp, 0);
		assert.throws(() => resetAllContribution(services, GUILD, ADMIN_USER, ""), UserError);
		assert.match(resetAllContribution(services, GUILD, ADMIN_USER, "XAC NHAN"), /contribution toàn server/u);
	});

	test("syncMemberTierRoles: bỏ qua người đã rời server, gọi AdminActions với level mới", async () =>
	{
		const harness = createWebHarness();
		const { services, deps, world } = harness;
		assert.equal(await syncMemberTierRoles(deps.adminActions, services, null, 5000), null);
		const member = await lookupMember(world.guild, PLAIN_USER);
		assert.ok(member);
		harness.tierSync.result = { added: ["510000000000000002"], removed: [], skipped: [] };
		const line = await syncMemberTierRoles(deps.adminActions, services, member, 0);
		assert.deepEqual(harness.adminCalls, [`syncTierRoles:${PLAIN_USER}:0`]);
		assert.match(line ?? "", /đã thêm/u);
	});
});

describe("nền móng Phase 17: web", () =>
{
	test("widgets: đọc ID, trang; pager giữ bộ lọc; userCell escape tên và chỉ nhận avatar từ CDN Discord", () =>
	{
		assert.equal(parseUserId(" 310000000000000003 "), PLAIN_USER);
		assert.equal(parseUserId("<@!310000000000000003>"), PLAIN_USER);
		assert.equal(parseUserId("<@310000000000000003>"), PLAIN_USER);
		assert.equal(parseUserId("abc"), null);
		assert.equal(parseUserId("1234"), null);
		assert.throws(() => requireUserId("x"), UserError);
		assert.equal(parsePositiveId("12"), 12);
		assert.equal(parsePositiveId("0"), null);
		assert.equal(parsePositiveId("-3"), null);
		assert.equal(parsePositiveId("1e3"), null);
		assert.equal(queryPage(new URLSearchParams("trang=3")), 3);
		assert.equal(queryPage(new URLSearchParams("trang=abc")), 1);
		assert.equal(queryPage(new URLSearchParams("")), 1);

		const { guild } = createWebHarness().world;
		assert.equal(pager({ guild }, "/polls", { loc: "open" }, 1, 1).html, "");
		const links = pager({ guild }, "/polls", { loc: "open", q: "" }, 2, 3).html;
		assert.ok(links.includes(`/g/${GUILD}/polls?loc=open&amp;trang=1`), links);
		assert.ok(links.includes(`/g/${GUILD}/polls?loc=open&amp;trang=3`), links);
		assert.ok(links.includes("Trang 2/3"));

		const cell = userCell(PLAIN_USER, { displayName: "<b>X</b>", avatarUrl: "https://evil.example/a.png", inGuild: false }).html;
		assert.ok(!cell.includes("<b>X</b>") && cell.includes("&lt;b&gt;X&lt;/b&gt;"));
		assert.ok(!cell.includes("evil.example"));
		assert.ok(cell.includes("đã rời server"));
		assert.ok(userCell(PLAIN_USER, { displayName: "A", avatarUrl: "https://cdn.discordapp.com/avatars/1/a.png", inGuild: true }).html.includes("<img"));
	});

	test("errorRedirect: lỗi của POST quay về trang do route chỉ định; giá trị sai định dạng thì về pageAfterPost", async () =>
	{
		const module: PageModule = {
			routes: [
				{ method: "GET", path: "/thu", handler: ctx => renderPage(ctx, { nav: "overview", title: "Thử", body: html`${csrfField(ctx)}` }) },
				{
					method: "POST",
					path: "/thu/sai",
					handler: () =>
					{
						throw new UserError("Lỗi thử");
					},
					errorRedirect: ctx => `/thu/view?u=${ctx.req.form?.get("u") ?? ""}`,
				},
			],
		};
		const harness = createWebHarness([module]);
		const auth = await login(harness, ADMIN_USER);
		const good = await call(harness, `/g/${GUILD}/thu/sai`, { cookies: auth.cookies, form: withCsrf(auth, { u: "310000000000000003" }) });
		assert.equal(good.status, 303);
		assert.equal(good.headers.Location, `/g/${GUILD}/thu/view?u=310000000000000003`);
		const bad = await call(harness, `/g/${GUILD}/thu/sai`, { cookies: auth.cookies, form: withCsrf(auth, { u: "x\r\nSet-Cookie: a=b" }) });
		assert.equal(bad.headers.Location, `/g/${GUILD}/thu`);
		const page = await call(harness, `/g/${GUILD}/thu`, { cookies: auth.cookies });
		assert.ok(page.body.includes("Lỗi thử"));
	});

	test("canViewItemChannel: chưa gắn kênh hay kênh không còn thì xem được; thiếu View Channel thì không", async () =>
	{
		const harness = createWebHarness();
		const { world, deps } = harness;
		addChannel(world, { id: PRIVATE_CHANNEL, name: "bi-mat", type: ChannelType.GuildText, permissionsByMember: { [ADMIN_USER]: [] } });
		const viewer = await lookupMember(world.guild, ADMIN_USER);
		assert.ok(viewer);
		assert.equal(await canViewItemChannel(deps.client, world.guild, null, viewer), true);
		assert.equal(await canViewItemChannel(deps.client, world.guild, CHANNEL_CHAT, viewer), true);
		assert.equal(await canViewItemChannel(deps.client, world.guild, "410000000000000777", viewer), true);
		assert.equal(await canViewItemChannel(deps.client, world.guild, PRIVATE_CHANNEL, viewer), false);
		assert.deepEqual([...await hiddenChannelIds(deps.client, world.guild, [PRIVATE_CHANNEL, null, CHANNEL_CHAT, PRIVATE_CHANNEL], viewer)], [PRIVATE_CHANNEL]);
	});

	test("lookupMember: null khi không còn trong server, UserError khi Discord lỗi", async () =>
	{
		const { world } = createWebHarness();
		assert.equal(await lookupMember(world.guild, STRANGER), null);
		world.discordDown = true;
		await assert.rejects(lookupMember(world.guild, PLAIN_USER), UserError);
	});

	test("menu có nhóm Dữ liệu / Cấu hình / Hệ thống và mọi mục trỏ tới trang có thật", async () =>
	{
		const harness = createWebHarness();
		const auth = await login(harness, ADMIN_USER);
		const page = await call(harness, `/g/${GUILD}`, { cookies: auth.cookies });
		for (const group of ["Dữ liệu", "Cấu hình", "Hệ thống"]) assert.ok(page.body.includes(`<div class="nav-group">${group}</div>`), group);
		const links = [...page.body.matchAll(/<a href="(\/g\/\d+[^"]*)"/gu)].map(match => match[1] ?? "");
		for (const path of ["/members", "/leaderboard", "/contributions", "/polls", "/stats", "/reset", "/backup"])
		{
			assert.ok(links.includes(`/g/${GUILD}${path}`), path);
			assert.equal((await call(harness, `/g/${GUILD}${path}`, { cookies: auth.cookies })).status, 200, path);
		}
	});
});
