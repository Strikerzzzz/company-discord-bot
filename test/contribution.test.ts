import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ContributionService } from "../src/modules/contribution/ContributionService";
import { SubmitContributionInput } from "../src/modules/contribution/types";
import { UserError } from "../src/shared/errors";
import {
	ADMIN,
	CHANNEL_GENERAL,
	createTestContext,
	GUILD,
	OTHER_GUILD,
	ROLE_BACKEND,
	ROLE_FRONTEND,
	ROLE_OTHER,
	TestContext,
	USER_A,
	USER_B,
	USER_C,
} from "./helpers";

const MESSAGE_ID = "600000000000000001";

function setup(): TestContext & { service: ContributionService }
{
	const context = createTestContext();
	return { ...context, service: new ContributionService(context.db, context.deps) };
}

function input(overrides: Partial<SubmitContributionInput> = {}): SubmitContributionInput
{
	return {
		guildId: GUILD,
		authorId: USER_A,
		submittedBy: USER_A,
		title: "Tối ưu build",
		description: "Giảm thời gian build CI từ 10 phút xuống 4 phút.",
		category: "cai-tien",
		link: null,
		authorRoleIds: [],
		...overrides,
	};
}

/** Mô phỏng dữ liệu sai kiểu đến từ Discord: TypeScript không cho phép nhưng runtime vẫn phải chặn. */
function withCategory(category: string): SubmitContributionInput
{
	return Object.assign(input(), { category });
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

function countRows(context: TestContext, table: "contributions" | "contribution_teams" | "contribution_events" | "xp_events"): number
{
	return context.db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0;
}

describe("ContributionService.submit", () =>
{
	test("tạo contribution đã trim, votes = 0, active, chưa có message", () =>
	{
		const context = setup();
		const { service, clock } = context;
		const created = service.submit(input({
			title: "  Tối ưu build  ",
			description: "\n  Giảm thời gian build.  \n",
			link: "  https://example.com/pr/1  ",
			submittedBy: USER_B,
		}));

		assert.deepEqual(created, {
			id: created.id,
			guildId: GUILD,
			authorId: USER_A,
			submittedBy: USER_B,
			title: "Tối ưu build",
			description: "Giảm thời gian build.",
			category: "cai-tien",
			link: "https://example.com/pr/1",
			channelId: null,
			messageId: null,
			status: "active",
			createdAt: clock.now(),
			votes: 0,
		});
		assert.deepEqual(service.get(GUILD, created.id), created);
	});

	test("link rỗng hoặc chỉ có khoảng trắng coi như null; chấp nhận http, https không phân biệt hoa thường", () =>
	{
		const { service } = setup();
		assert.equal(service.submit(input({ link: "" })).link, null);
		assert.equal(service.submit(input({ link: "   " })).link, null);
		assert.equal(service.submit(input({ link: "http://intranet.local/doc" })).link, "http://intranet.local/doc");
		assert.equal(service.submit(input({ link: "HTTPS://Example.com" })).link, "HTTPS://Example.com");
	});

	test("tiêu đề phải từ 3 đến 100 ký tự sau khi trim, tính theo code point", () =>
	{
		const context = setup();
		const { service } = context;
		const titleError = userError("Tiêu đề phải từ 3 đến 100 ký tự.");

		assert.throws(() => service.submit(input({ title: "ab" })), titleError);
		assert.throws(() => service.submit(input({ title: "   ab   " })), titleError);
		assert.throws(() => service.submit(input({ title: "" })), titleError);
		assert.throws(() => service.submit(input({ title: "x".repeat(101) })), titleError);
		assert.throws(() => service.submit(input({ title: "😀".repeat(101) })), titleError);

		assert.equal(service.submit(input({ title: "abc" })).title, "abc");
		assert.equal(service.submit(input({ title: "😀😀😀" })).title, "😀😀😀");
		assert.equal(service.submit(input({ title: "x".repeat(100) })).title.length, 100);
		assert.equal(service.submit(input({ title: "😀".repeat(100) })).title, "😀".repeat(100));
		assert.equal(countRows(context, "contributions"), 4);
	});

	test("mô tả không rỗng và tối đa 1500 ký tự", () =>
	{
		const context = setup();
		const { service } = context;
		assert.throws(() => service.submit(input({ description: "" })), userError("Mô tả không được để trống."));
		assert.throws(() => service.submit(input({ description: " \n\t " })), userError("Mô tả không được để trống."));
		assert.throws(() => service.submit(input({ description: "a".repeat(1501) })), userError("Mô tả tối đa 1500 ký tự."));
		assert.throws(() => service.submit(input({ description: "😀".repeat(1501) })), UserError);

		assert.equal(service.submit(input({ description: "a".repeat(1500) })).description.length, 1500);
		assert.equal(service.submit(input({ description: "😀".repeat(1500) })).description, "😀".repeat(1500));
		assert.equal(countRows(context, "contributions"), 2);
	});

	test("category phải thuộc CONTRIBUTION_CATEGORIES", () =>
	{
		const context = setup();
		assert.throws(() => context.service.submit(withCategory("sai-loai")), userError("Loại đóng góp không hợp lệ."));
		assert.throws(() => context.service.submit(withCategory("")), UserError);
		assert.equal(countRows(context, "contributions"), 0);
		assert.equal(context.service.submit(input({ category: "tai-lieu" })).category, "tai-lieu");
	});

	test("link phải là URL http/https tối đa 500 ký tự", () =>
	{
		const context = setup();
		const { service } = context;
		const linkError = userError("Link phải bắt đầu bằng http:// hoặc https://.");

		assert.throws(() => service.submit(input({ link: "ftp://example.com/file" })), linkError);
		assert.throws(() => service.submit(input({ link: "javascript:alert(1)" })), linkError);
		assert.throws(() => service.submit(input({ link: "example.com" })), linkError);
		assert.throws(() => service.submit(input({ link: "https://" })), linkError);
		assert.throws(() => service.submit(input({ link: "không phải link" })), linkError);

		const prefix = "https://example.com/";
		assert.throws(() => service.submit(input({ link: prefix + "a".repeat(501 - prefix.length) })), userError("Link tối đa 500 ký tự."));
		assert.equal(countRows(context, "contributions"), 0);

		const longest = prefix + "a".repeat(500 - prefix.length);
		assert.equal(service.submit(input({ link: longest })).link, longest);
	});

	test("lưu snapshot team của tác giả lúc gửi (chỉ role đang là team)", () =>
	{
		const context = setup();
		const { service, deps, db } = context;
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		deps.teams.add(GUILD, ROLE_FRONTEND, ADMIN);
		const created = service.submit(input({ authorRoleIds: [ROLE_OTHER, ROLE_FRONTEND, ROLE_BACKEND, ROLE_BACKEND] }));

		const roles = db.prepare<[number], { role_id: string }>("SELECT role_id FROM contribution_teams WHERE contribution_id = ? ORDER BY role_id")
			.all(created.id)
			.map(row => row.role_id);
		assert.deepEqual(roles, [ROLE_BACKEND, ROLE_FRONTEND]);
	});
});

describe("ContributionService.toggleVote", () =>
{
	test("ghi nhận, rút ghi nhận, cộng điểm cho tác giả", () =>
	{
		const { service, deps } = setup();
		const { id } = service.submit(input());

		const first = service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_B });
		assert.equal(first.voted, true);
		assert.equal(first.contribution.votes, 1);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);

		const second = service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_C });
		assert.equal(second.voted, true);
		assert.equal(second.contribution.votes, 2);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 2);

		const withdrawn = service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_B });
		assert.equal(withdrawn.voted, false);
		assert.equal(withdrawn.contribution.votes, 1);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);
		assert.equal(deps.contributionLedger.total(GUILD, USER_B), 0);
		assert.equal(deps.contributionLedger.total(GUILD, USER_C), 0);

		const again = service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_B });
		assert.equal(again.voted, true);
		assert.equal(again.contribution.votes, 2);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 2);
	});

	test("event ghi nhận có source vote, reference là id contribution, actor là người ghi nhận", () =>
	{
		const { service, deps } = setup();
		const { id } = service.submit(input());
		service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_B });
		const [event] = deps.contributionLedger.recent(GUILD, USER_A, 5);
		assert.equal(event.source, "vote");
		assert.equal(event.referenceId, String(id));
		assert.equal(event.actorId, USER_B);
		assert.equal(event.amount, 1);
	});

	test("không tự ghi nhận; người gửi hộ (khác tác giả) vẫn ghi nhận được", () =>
	{
		const { service, deps } = setup();
		const { id } = service.submit(input({ authorId: USER_A, submittedBy: USER_B }));
		assert.throws(
			() => service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_A }),
			userError("Bạn không thể tự ghi nhận đóng góp của chính mình."),
		);
		assert.equal(service.get(GUILD, id)?.votes, 0);
		assert.equal(service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_B }).voted, true);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);
		assert.equal(deps.contributionLedger.total(GUILD, USER_B), 0);
	});

	test("contribution không tồn tại thì báo lỗi", () =>
	{
		const { service } = setup();
		assert.throws(() => service.toggleVote({ guildId: GUILD, contributionId: 999, voterId: USER_B }), userError("Không tìm thấy contribution này."));
	});

	test("điểm mỗi lượt theo cấu hình tại thời điểm ghi nhận; rút thì trừ đúng số đã cộng", () =>
	{
		const { service, deps } = setup();
		const { id } = service.submit(input());

		service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_B });
		deps.guildConfig.updateSettings(GUILD, { contributionVotePoints: 5 }, ADMIN);
		service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_C });
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 6);

		service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_B });
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 5);

		deps.guildConfig.updateSettings(GUILD, { contributionVotePoints: 0 }, ADMIN);
		const zero = service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_B });
		assert.equal(zero.voted, true);
		assert.equal(zero.contribution.votes, 2);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 5);

		service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_C });
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
	});

	test("điểm team theo snapshot team của tác giả lúc gửi (DEC-024)", () =>
	{
		const { service, deps } = setup();
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		const { id } = service.submit(input({ authorRoleIds: [ROLE_BACKEND, ROLE_FRONTEND] }));

		deps.teams.add(GUILD, ROLE_FRONTEND, ADMIN);
		service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_B });
		service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_C });
		assert.deepEqual(deps.contributionLedger.teamTotals(GUILD, 10), [{ id: ROLE_BACKEND, total: 2 }]);

		const other = service.submit(input({ authorId: USER_B, authorRoleIds: [ROLE_FRONTEND] }));
		service.toggleVote({ guildId: GUILD, contributionId: other.id, voterId: USER_A });
		assert.deepEqual(deps.contributionLedger.teamTotals(GUILD, 10), [
			{ id: ROLE_BACKEND, total: 2 },
			{ id: ROLE_FRONTEND, total: 1 },
		]);

		service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_B });
		assert.deepEqual(deps.contributionLedger.teamTotals(GUILD, 10), [
			{ id: ROLE_BACKEND, total: 1 },
			{ id: ROLE_FRONTEND, total: 1 },
		]);
	});
});

describe("ContributionService.remove", () =>
{
	test("gỡ contribution huỷ điểm của nó, giữ điểm admin, ghi audit, không ghi nhận được nữa", () =>
	{
		const context = setup();
		const { service, deps, clock } = context;
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		const created = service.submit(input({ authorRoleIds: [ROLE_BACKEND] }));
		const kept = service.submit(input({ title: "Contribution khác" }));
		service.toggleVote({ guildId: GUILD, contributionId: created.id, voterId: USER_B });
		service.toggleVote({ guildId: GUILD, contributionId: created.id, voterId: USER_C });
		service.toggleVote({ guildId: GUILD, contributionId: kept.id, voterId: USER_B });
		service.adjust({ guildId: GUILD, userId: USER_A, delta: 3, actorId: ADMIN, reason: null, roleIds: [] });
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 6);

		clock.advanceSeconds(60);
		const removed = service.remove(GUILD, created.id, ADMIN);
		assert.equal(removed.status, "removed");
		assert.equal(removed.votes, 2);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 4);
		assert.deepEqual(deps.contributionLedger.teamTotals(GUILD, 10), []);
		assert.equal(service.get(GUILD, created.id)?.status, "removed");
		assert.deepEqual(service.list(GUILD, { limit: 10 }).map(c => c.id), [kept.id]);

		const row = context.db.prepare<[number], { removed_at: number; removed_by: string }>("SELECT removed_at, removed_by FROM contributions WHERE id = ?")
			.get(created.id);
		assert.deepEqual(row, { removed_at: clock.now(), removed_by: ADMIN });
		assert.equal(countRows(context, "contribution_events"), 4);

		const [entry] = deps.audit.list(GUILD, 1);
		assert.equal(entry.action, "contribution.remove");
		assert.equal(entry.actorId, ADMIN);
		assert.equal(entry.targetId, USER_A);
		assert.deepEqual(entry.details, { contributionId: created.id, title: created.title });

		assert.throws(() => service.toggleVote({ guildId: GUILD, contributionId: created.id, voterId: USER_B }), userError("Contribution này đã bị gỡ."));
		assert.throws(() => service.toggleVote({ guildId: GUILD, contributionId: created.id, voterId: USER_C }), userError("Contribution này đã bị gỡ."));
		assert.throws(() => service.remove(GUILD, created.id, ADMIN), userError("Contribution này đã bị gỡ."));
		assert.throws(() => service.remove(GUILD, 999, ADMIN), userError("Không tìm thấy contribution này."));
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 4);
	});
});

describe("ContributionService.adjust", () =>
{
	test("cộng/trừ điểm, ghi ledger admin với snapshot team và audit", () =>
	{
		const { service, deps } = setup();
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);

		assert.deepEqual(service.adjust({ guildId: GUILD, userId: USER_A, delta: 10, actorId: ADMIN, reason: "thưởng", roleIds: [ROLE_BACKEND, ROLE_OTHER] }), { score: 10 });
		assert.deepEqual(service.adjust({ guildId: GUILD, userId: USER_A, delta: -4, actorId: ADMIN, reason: null, roleIds: [ROLE_BACKEND] }), { score: 6 });

		const [latest, first] = deps.contributionLedger.recent(GUILD, USER_A, 5);
		assert.equal(first.source, "admin");
		assert.equal(first.referenceId, null);
		assert.equal(first.actorId, ADMIN);
		assert.equal(first.reason, "thưởng");
		assert.equal(latest.amount, -4);
		assert.deepEqual(deps.contributionLedger.teamTotals(GUILD, 10), [{ id: ROLE_BACKEND, total: 6 }]);

		const entries = deps.audit.list(GUILD, 5).filter(entry => entry.action === "contribution.adjust");
		assert.equal(entries.length, 2);
		assert.equal(entries[0].targetId, USER_A);
		assert.deepEqual(entries[0].details, { delta: -4, reason: null, score: 6 });
		assert.deepEqual(entries[1].details, { delta: 10, reason: "thưởng", score: 10 });
	});

	test("không cho trừ quá số điểm hiện có; trừ về đúng 0 thì được", () =>
	{
		const { service, deps } = setup();
		service.adjust({ guildId: GUILD, userId: USER_A, delta: 6, actorId: ADMIN, reason: null, roleIds: [] });
		assert.throws(
			() => service.adjust({ guildId: GUILD, userId: USER_A, delta: -7, actorId: ADMIN, reason: null, roleIds: [] }),
			userError("Không thể trừ quá số điểm hiện có (hiện có 6 điểm)."),
		);
		assert.throws(
			() => service.adjust({ guildId: GUILD, userId: USER_B, delta: -1, actorId: ADMIN, reason: null, roleIds: [] }),
			userError("Không thể trừ quá số điểm hiện có (hiện có 0 điểm)."),
		);
		assert.deepEqual(service.adjust({ guildId: GUILD, userId: USER_A, delta: -6, actorId: ADMIN, reason: null, roleIds: [] }), { score: 0 });
		assert.equal(deps.audit.list(GUILD, 10).filter(entry => entry.action === "contribution.adjust").length, 2);
	});

	test("delta phải là số nguyên khác 0, trị tuyệt đối tối đa 1.000.000", () =>
	{
		const context = setup();
		const { service } = context;
		for (const delta of [0, 1.5, -0.5, 1_000_001, -1_000_001, Number.NaN, Number.POSITIVE_INFINITY])
		{
			assert.throws(() => service.adjust({ guildId: GUILD, userId: USER_A, delta, actorId: ADMIN, reason: null, roleIds: [] }), UserError);
		}
		assert.equal(countRows(context, "contribution_events"), 0);
		assert.deepEqual(service.adjust({ guildId: GUILD, userId: USER_A, delta: 1_000_000, actorId: ADMIN, reason: null, roleIds: [] }), { score: 1_000_000 });
		assert.deepEqual(service.adjust({ guildId: GUILD, userId: USER_A, delta: -1_000_000, actorId: ADMIN, reason: null, roleIds: [] }), { score: 0 });
	});
});

describe("ContributionService reset", () =>
{
	test("resetUser chỉ huỷ điểm của người đó, không xoá dữ liệu, ghi audit", () =>
	{
		const context = setup();
		const { service, deps } = context;
		const mine = service.submit(input());
		const theirs = service.submit(input({ authorId: USER_B }));
		service.toggleVote({ guildId: GUILD, contributionId: mine.id, voterId: USER_B });
		service.toggleVote({ guildId: GUILD, contributionId: mine.id, voterId: USER_C });
		service.toggleVote({ guildId: GUILD, contributionId: theirs.id, voterId: USER_C });
		service.adjust({ guildId: GUILD, userId: USER_A, delta: 5, actorId: ADMIN, reason: null, roleIds: [] });

		assert.deepEqual(service.resetUser(GUILD, USER_A, ADMIN), { voidedEvents: 3 });
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
		assert.equal(deps.contributionLedger.total(GUILD, USER_B), 1);
		assert.equal(countRows(context, "contribution_events"), 4);
		assert.equal(service.get(GUILD, mine.id)?.votes, 2);

		const [entry] = deps.audit.list(GUILD, 1);
		assert.equal(entry.action, "contribution.reset_user");
		assert.equal(entry.targetId, USER_A);
		assert.deepEqual(entry.details, { voidedEvents: 3 });
	});

	test("resetAll huỷ điểm cả guild, không ảnh hưởng guild khác, ghi audit", () =>
	{
		const { service, deps } = setup();
		const mine = service.submit(input());
		const theirs = service.submit(input({ authorId: USER_B }));
		const elsewhere = service.submit(input({ guildId: OTHER_GUILD }));
		service.toggleVote({ guildId: GUILD, contributionId: mine.id, voterId: USER_B });
		service.toggleVote({ guildId: GUILD, contributionId: theirs.id, voterId: USER_C });
		service.toggleVote({ guildId: OTHER_GUILD, contributionId: elsewhere.id, voterId: USER_B });

		assert.deepEqual(service.resetAll(GUILD, ADMIN), { voidedEvents: 2, members: 2 });
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
		assert.equal(deps.contributionLedger.total(GUILD, USER_B), 0);
		assert.equal(deps.contributionLedger.total(OTHER_GUILD, USER_A), 1);

		const [entry] = deps.audit.list(GUILD, 1);
		assert.equal(entry.action, "contribution.reset_all");
		assert.equal(entry.targetId, null);
		assert.deepEqual(entry.details, { voidedEvents: 2, members: 2 });
		assert.equal(deps.audit.list(OTHER_GUILD, 5).length, 0);
	});

	test("sau reset vẫn rút và ghi nhận lại đúng, tổng không âm", () =>
	{
		const { service, deps } = setup();
		const { id } = service.submit(input());
		service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_B });
		service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_C });
		service.resetUser(GUILD, USER_A, ADMIN);

		const withdrawn = service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_B });
		assert.equal(withdrawn.voted, false);
		assert.equal(withdrawn.contribution.votes, 1);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);

		const revoted = service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_B });
		assert.equal(revoted.voted, true);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);

		service.resetAll(GUILD, ADMIN);
		assert.equal(service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_C }).voted, false);
		assert.equal(service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_B }).voted, false);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
		assert.equal(service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_C }).voted, true);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);
		assert.equal(service.get(GUILD, id)?.votes, 1);
	});
});

describe("ContributionService tách biệt", () =>
{
	test("không ảnh hưởng Activity XP (DEC-004)", () =>
	{
		const context = setup();
		const { service, deps } = context;
		deps.xpLedger.record({ guildId: GUILD, userId: USER_A, amount: 40, source: "message" });

		const { id } = service.submit(input());
		service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_B });
		service.adjust({ guildId: GUILD, userId: USER_A, delta: 7, actorId: ADMIN, reason: null, roleIds: [] });
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 40);
		assert.equal(deps.xpLedger.total(GUILD, USER_B), 0);

		service.remove(GUILD, id, ADMIN);
		service.resetUser(GUILD, USER_A, ADMIN);
		service.resetAll(GUILD, ADMIN);
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 40);
		assert.equal(countRows(context, "xp_events"), 1);
		assert.equal(deps.xpLedger.recent(GUILD, USER_A, 5)[0].voidedAt, null);
	});

	test("các guild độc lập", () =>
	{
		const { service, deps } = setup();
		deps.guildConfig.updateSettings(OTHER_GUILD, { contributionVotePoints: 9 }, ADMIN);
		const { id } = service.submit(input());

		assert.equal(service.get(OTHER_GUILD, id), null);
		assert.deepEqual(service.list(OTHER_GUILD, { limit: 10 }), []);
		assert.throws(() => service.toggleVote({ guildId: OTHER_GUILD, contributionId: id, voterId: USER_B }), userError("Không tìm thấy contribution này."));
		assert.throws(() => service.remove(OTHER_GUILD, id, ADMIN), userError("Không tìm thấy contribution này."));

		service.attachMessage(OTHER_GUILD, id, CHANNEL_GENERAL, MESSAGE_ID);
		assert.equal(service.get(GUILD, id)?.messageId, null);

		service.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_B });
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);
		assert.equal(deps.contributionLedger.total(OTHER_GUILD, USER_A), 0);
		assert.deepEqual(service.getProfile(OTHER_GUILD, USER_A), { userId: USER_A, score: 0, rank: null, totalRanked: 0, contributions: 0 });

		service.resetAll(OTHER_GUILD, ADMIN);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);
	});
});

describe("ContributionService đọc dữ liệu", () =>
{
	test("attachMessage lưu vị trí message", () =>
	{
		const { service } = setup();
		const { id } = service.submit(input());
		service.attachMessage(GUILD, id, CHANNEL_GENERAL, MESSAGE_ID);
		const stored = service.get(GUILD, id);
		assert.equal(stored?.channelId, CHANNEL_GENERAL);
		assert.equal(stored?.messageId, MESSAGE_ID);
	});

	test("get trả null nếu không tồn tại", () =>
	{
		const { service } = setup();
		assert.equal(service.get(GUILD, 1), null);
	});

	test("list: chỉ contribution còn hiệu lực, mới nhất trước, lọc theo tác giả, kèm số ghi nhận", () =>
	{
		const { service, clock } = setup();
		const oldest = service.submit(input({ title: "Cũ nhất" }));
		clock.advanceSeconds(10);
		const sameTimeFirst = service.submit(input({ title: "Cùng giờ 1", authorId: USER_B }));
		const sameTimeSecond = service.submit(input({ title: "Cùng giờ 2" }));
		clock.advanceSeconds(10);
		const removed = service.submit(input({ title: "Bị gỡ" }));
		service.remove(GUILD, removed.id, ADMIN);
		service.toggleVote({ guildId: GUILD, contributionId: oldest.id, voterId: USER_B });

		assert.deepEqual(service.list(GUILD, { limit: 10 }).map(c => c.id), [sameTimeSecond.id, sameTimeFirst.id, oldest.id]);
		assert.deepEqual(service.list(GUILD, { authorId: USER_A, limit: 10 }).map(c => c.id), [sameTimeSecond.id, oldest.id]);
		assert.deepEqual(service.list(GUILD, { authorId: USER_C, limit: 10 }), []);
		assert.equal(service.list(GUILD, { authorId: USER_A, limit: 10 })[1].votes, 1);
	});

	test("list kẹp limit trong khoảng 1..50", () =>
	{
		const { service } = setup();
		for (let i = 0; i < 55; i++) service.submit(input({ title: `Contribution ${i}` }));
		assert.equal(service.list(GUILD, { limit: 0 }).length, 1);
		assert.equal(service.list(GUILD, { limit: -5 }).length, 1);
		assert.equal(service.list(GUILD, { limit: Number.NaN }).length, 1);
		assert.equal(service.list(GUILD, { limit: 2.9 }).length, 2);
		assert.equal(service.list(GUILD, { limit: 100 }).length, 50);
		assert.equal(service.list(GUILD, { authorId: USER_A, limit: 100 }).length, 50);
	});

	test("getProfile: điểm, hạng và số contribution còn hiệu lực", () =>
	{
		const { service } = setup();
		const first = service.submit(input());
		service.submit(input({ title: "Thứ hai" }));
		const removed = service.submit(input({ title: "Bị gỡ" }));
		service.submit(input({ authorId: USER_B, submittedBy: USER_A }));
		service.remove(GUILD, removed.id, ADMIN);
		service.toggleVote({ guildId: GUILD, contributionId: first.id, voterId: USER_B });
		service.adjust({ guildId: GUILD, userId: USER_C, delta: 5, actorId: ADMIN, reason: null, roleIds: [] });

		assert.deepEqual(service.getProfile(GUILD, USER_A), { userId: USER_A, score: 1, rank: 2, totalRanked: 2, contributions: 2 });
		assert.deepEqual(service.getProfile(GUILD, USER_C), { userId: USER_C, score: 5, rank: 1, totalRanked: 2, contributions: 0 });
		assert.deepEqual(service.getProfile(GUILD, USER_B), { userId: USER_B, score: 0, rank: null, totalRanked: 2, contributions: 1 });
	});
});
