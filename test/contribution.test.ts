import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { SubmitContributionInput } from "../src/modules/contribution/types";
import { LedgerEvent } from "../src/modules/ledger/Ledger";
import { UserError } from "../src/shared/errors";
import {
	castVote,
	contributionInput,
	ContributionTestContext,
	setupContributions,
	submitApproved,
	voteUp,
	withdrawVote,
} from "./contribution-helpers";
import {
	ADMIN,
	CHANNEL_GENERAL,
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
const SELF_VOTE = "Bạn không thể tự ghi nhận hay không ghi nhận đóng góp của chính mình.";
const VOTE_LOCKED = "Lượt của bạn cho đóng góp này đã bị khoá (do admin reset, hoặc vì lần bạn rút hay đổi lượt đã phải bù điểm cho tác giả đang bị trừ điểm) nên không đổi hay rút được nữa.";

/** Kênh contribution đã chọn sẵn cho cả GUILD và OTHER_GUILD (DEC-051). */
function setup(): ContributionTestContext
{
	return setupContributions([GUILD, OTHER_GUILD]);
}

function input(overrides: Partial<SubmitContributionInput> = {}): SubmitContributionInput
{
	return contributionInput(overrides);
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

function countRows(context: TestContext, table: "contributions" | "contribution_teams" | "contribution_events" | "contribution_votes" | "xp_events"): number
{
	return context.db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0;
}

describe("ContributionService.submit", () =>
{
	test("tạo contribution đã trim, chờ duyệt, votes = 0, active, chưa có message", () =>
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
			downvotes: 0,
			score: 0,
			reviewState: "pending",
			reviewedBy: null,
			reviewedAt: null,
			reviewReason: null,
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

describe("ContributionService.vote: 👍 ghi nhận và rút", () =>
{
	test("ghi nhận, rút ghi nhận, cộng điểm cho tác giả", () =>
	{
		const { service, deps } = setup();
		const { id } = submitApproved(service, input());

		const first = voteUp(service, id, USER_B);
		assert.deepEqual([first.current, first.change, first.locked], ["up", "added", false]);
		assert.equal(first.contribution.votes, 1);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);

		const second = voteUp(service, id, USER_C);
		assert.deepEqual([second.current, second.change], ["up", "added"]);
		assert.equal(second.contribution.votes, 2);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 2);

		const withdrawn = withdrawVote(service, id, USER_B);
		assert.deepEqual([withdrawn.current, withdrawn.change, withdrawn.locked], [null, "withdrawn", false]);
		assert.equal(withdrawn.contribution.votes, 1);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);
		assert.equal(deps.contributionLedger.total(GUILD, USER_B), 0);
		assert.equal(deps.contributionLedger.total(GUILD, USER_C), 0);

		const again = voteUp(service, id, USER_B);
		assert.deepEqual([again.current, again.change], ["up", "added"]);
		assert.equal(again.contribution.votes, 2);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 2);
	});

	test("event ghi nhận có source vote, reference là id contribution, actor là người ghi nhận", () =>
	{
		const { service, deps } = setup();
		const { id } = submitApproved(service, input());
		voteUp(service, id, USER_B);
		const [event] = deps.contributionLedger.recent(GUILD, USER_A, 5);
		assert.equal(event.source, "vote");
		assert.equal(event.referenceId, String(id));
		assert.equal(event.actorId, USER_B);
		assert.equal(event.amount, 1);
	});

	test("không tự ghi nhận; người gửi hộ (khác tác giả) vẫn ghi nhận được", () =>
	{
		const { service, deps } = setup();
		const { id } = submitApproved(service, input({ authorId: USER_A, submittedBy: USER_B }));
		assert.throws(() => voteUp(service, id, USER_A), userError(SELF_VOTE));
		assert.equal(service.get(GUILD, id)?.votes, 0);
		assert.equal(voteUp(service, id, USER_B).current, "up");
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);
		assert.equal(deps.contributionLedger.total(GUILD, USER_B), 0);
	});

	test("contribution không tồn tại thì báo lỗi", () =>
	{
		const { service } = setup();
		assert.throws(() => voteUp(service, 999, USER_B), userError("Không tìm thấy contribution này."));
	});

	test("điểm mỗi lượt theo cấu hình tại thời điểm ghi nhận; rút thì trừ đúng số đã cộng", () =>
	{
		const { service, deps } = setup();
		const { id } = submitApproved(service, input());

		voteUp(service, id, USER_B);
		deps.guildConfig.updateSettings(GUILD, { contributionVotePoints: 5 }, ADMIN);
		voteUp(service, id, USER_C);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 6);

		withdrawVote(service, id, USER_B);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 5);

		deps.guildConfig.updateSettings(GUILD, { contributionVotePoints: 0 }, ADMIN);
		const zero = voteUp(service, id, USER_B);
		assert.equal(zero.current, "up");
		assert.equal(zero.contribution.votes, 2);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 5);

		withdrawVote(service, id, USER_C);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
	});

	test("điểm team theo snapshot team của tác giả lúc gửi (DEC-024)", () =>
	{
		const { service, deps } = setup();
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		const { id } = submitApproved(service, input({ authorRoleIds: [ROLE_BACKEND, ROLE_FRONTEND] }));

		deps.teams.add(GUILD, ROLE_FRONTEND, ADMIN);
		voteUp(service, id, USER_B);
		voteUp(service, id, USER_C);
		assert.deepEqual(deps.contributionLedger.teamTotals(GUILD, 10), [{ id: ROLE_BACKEND, total: 2 }]);

		const other = submitApproved(service, input({ authorId: USER_B, authorRoleIds: [ROLE_FRONTEND] }));
		voteUp(service, other.id, USER_A);
		assert.deepEqual(deps.contributionLedger.teamTotals(GUILD, 10), [
			{ id: ROLE_BACKEND, total: 2 },
			{ id: ROLE_FRONTEND, total: 1 },
		]);

		withdrawVote(service, id, USER_B);
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
		const created = submitApproved(service, input({ authorRoleIds: [ROLE_BACKEND] }));
		const kept = submitApproved(service, input({ title: "Contribution khác" }));
		voteUp(service, created.id, USER_B);
		voteUp(service, created.id, USER_C);
		voteUp(service, kept.id, USER_B);
		service.adjust({ guildId: GUILD, userId: USER_A, delta: 3, actorId: ADMIN, reason: null, roleIds: [] });
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 6);

		clock.advanceSeconds(60);
		const removed = service.remove(GUILD, created.id, ADMIN);
		assert.equal(removed.status, "removed");
		assert.equal(removed.votes, 0, "điểm của các lượt ghi nhận đã bị huỷ nên không còn lượt nào hiệu lực");
		assert.equal(countRows(context, "contribution_votes"), 3, "dòng ghi nhận vẫn được giữ để truy vết");
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

		assert.throws(() => voteUp(service, created.id, USER_B), userError("Contribution này đã bị gỡ."));
		assert.throws(() => withdrawVote(service, created.id, USER_C), userError("Contribution này đã bị gỡ."));
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

	test("tổng đang âm (dữ liệu cũ): vẫn cộng được, kể cả khi cộng xong vẫn âm; trừ thêm thì bị chặn", () =>
	{
		const { service, deps } = setup();
		deps.contributionLedger.record({ guildId: GUILD, userId: USER_A, amount: -5, source: "admin", reason: "dữ liệu cũ" });
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), -5);

		assert.deepEqual(service.adjust({ guildId: GUILD, userId: USER_A, delta: 2, actorId: ADMIN, reason: null, roleIds: [] }), { score: -3 });
		assert.throws(
			() => service.adjust({ guildId: GUILD, userId: USER_A, delta: -1, actorId: ADMIN, reason: null, roleIds: [] }),
			userError("Không thể trừ quá số điểm hiện có (hiện có -3 điểm)."),
		);
		assert.deepEqual(service.adjust({ guildId: GUILD, userId: USER_A, delta: 3, actorId: ADMIN, reason: null, roleIds: [] }), { score: 0 });
		assert.deepEqual(
			deps.audit.list(GUILD, 10).filter(entry => entry.action === "contribution.adjust").map(entry => entry.details),
			[{ delta: 3, reason: null, score: 0 }, { delta: 2, reason: null, score: -3 }],
		);
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
		const mine = submitApproved(service, input());
		const theirs = submitApproved(service, input({ authorId: USER_B }));
		voteUp(service, mine.id, USER_B);
		voteUp(service, mine.id, USER_C);
		voteUp(service, theirs.id, USER_C);
		service.adjust({ guildId: GUILD, userId: USER_A, delta: 5, actorId: ADMIN, reason: null, roleIds: [] });

		assert.deepEqual(service.resetUser(GUILD, USER_A, ADMIN), { voidedEvents: 3 });
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
		assert.equal(deps.contributionLedger.total(GUILD, USER_B), 1);
		assert.equal(countRows(context, "contribution_events"), 4);
		assert.equal(countRows(context, "contribution_votes"), 3);
		assert.equal(service.get(GUILD, mine.id)?.votes, 0, "lượt ghi nhận bị reset không còn hiệu lực");
		assert.equal(service.get(GUILD, theirs.id)?.votes, 1);

		const [entry] = deps.audit.list(GUILD, 1);
		assert.equal(entry.action, "contribution.reset_user");
		assert.equal(entry.targetId, USER_A);
		assert.deepEqual(entry.details, { voidedEvents: 3 });
	});

	test("resetAll huỷ điểm cả guild, không ảnh hưởng guild khác, ghi audit", () =>
	{
		const { service, deps } = setup();
		const mine = submitApproved(service, input());
		const theirs = submitApproved(service, input({ authorId: USER_B }));
		const elsewhere = submitApproved(service, input({ guildId: OTHER_GUILD }));
		voteUp(service, mine.id, USER_B);
		voteUp(service, theirs.id, USER_C);
		voteUp(service, elsewhere.id, USER_B, { guildId: OTHER_GUILD });

		assert.deepEqual(service.resetAll(GUILD, ADMIN), { voidedEvents: 2, members: 2 });
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
		assert.equal(deps.contributionLedger.total(GUILD, USER_B), 0);
		assert.equal(deps.contributionLedger.total(OTHER_GUILD, USER_A), 1);

		const [entry] = deps.audit.list(GUILD, 1);
		assert.equal(entry.action, "contribution.reset_all");
		assert.equal(entry.targetId, null);
		assert.deepEqual(entry.details, { voidedEvents: 2, members: 2 });
		assert.deepEqual(deps.audit.list(OTHER_GUILD, 20).filter(audit => audit.action.startsWith("contribution.reset")), []);
	});

});

describe("ContributionService: lượt ghi nhận sau khi admin reset", () =>
{
	const USER_D = "300000000000000004";

	function voteRows(context: TestContext, contributionId: number): string[]
	{
		return context.db.prepare<[number], { voter_id: string }>("SELECT voter_id FROM contribution_votes WHERE contribution_id = ? ORDER BY voter_id")
			.all(contributionId)
			.map(row => row.voter_id);
	}

	test("resetUser: người đã ghi nhận bấm lại hay rút đều bị từ chối, giữ nguyên dòng vote, điểm không quay về", () =>
	{
		const context = setup();
		const { service, deps } = context;
		const { id } = submitApproved(service, input());
		voteUp(service, id, USER_B);
		voteUp(service, id, USER_C);
		service.resetUser(GUILD, USER_A, ADMIN);

		for (const action of ["up", "withdraw"] as const)
		{
			assert.throws(() => castVote(service, id, USER_B, action), userError(VOTE_LOCKED));
			assert.throws(() => castVote(service, id, USER_C, action), userError(VOTE_LOCKED));
		}
		assert.deepEqual(service.voterState(GUILD, id, USER_B), { current: null, locked: true });
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
		assert.deepEqual(voteRows(context, id), [USER_B, USER_C]);
		assert.equal(service.get(GUILD, id)?.votes, 0);
		assert.equal(countRows(context, "contribution_events"), 2, "lượt bị từ chối không ghi thêm event nào");
	});

	test("người chưa từng ghi nhận vẫn ghi nhận và rút bình thường sau reset", () =>
	{
		const context = setup();
		const { service, deps } = context;
		const { id } = submitApproved(service, input());
		voteUp(service, id, USER_B);
		service.resetUser(GUILD, USER_A, ADMIN);

		const voted = voteUp(service, id, USER_D);
		assert.equal(voted.current, "up");
		assert.equal(voted.contribution.votes, 1, "chỉ đếm lượt còn hiệu lực");
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);

		assert.equal(withdrawVote(service, id, USER_D).current, null);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
		assert.equal(voteUp(service, id, USER_D).current, "up");
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);
		assert.throws(() => voteUp(service, id, USER_B), userError(VOTE_LOCKED));
		assert.deepEqual(voteRows(context, id), [USER_B, USER_D]);
	});

	test("resetAll: người đã ghi nhận không lấy lại được điểm; người mới ghi nhận được; guild khác không bị ảnh hưởng", () =>
	{
		const { service, deps } = setup();
		const { id } = submitApproved(service, input());
		const elsewhere = submitApproved(service, input({ guildId: OTHER_GUILD }));
		voteUp(service, id, USER_B);
		voteUp(service, elsewhere.id, USER_B, { guildId: OTHER_GUILD });
		service.resetAll(GUILD, ADMIN);

		assert.throws(() => voteUp(service, id, USER_B), userError(VOTE_LOCKED));
		assert.throws(() => withdrawVote(service, id, USER_B), userError(VOTE_LOCKED));
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);

		assert.equal(voteUp(service, id, USER_C).current, "up");
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);
		assert.equal(service.get(GUILD, id)?.votes, 1);

		const withdrawn = withdrawVote(service, elsewhere.id, USER_B, { guildId: OTHER_GUILD });
		assert.equal(withdrawn.current, null);
		assert.equal(deps.contributionLedger.total(OTHER_GUILD, USER_A), 0);
	});

	test("đã rút ghi nhận trước khi reset thì không còn lượt nào bị khoá, ghi nhận lại được", () =>
	{
		const { service, deps } = setup();
		const { id } = submitApproved(service, input());
		voteUp(service, id, USER_B);
		withdrawVote(service, id, USER_B);
		service.resetUser(GUILD, USER_A, ADMIN);

		assert.equal(voteUp(service, id, USER_B).current, "up");
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);
	});

	test("list, get và getProfile chỉ đếm lượt còn hiệu lực", () =>
	{
		const { service } = setup();
		const reset = submitApproved(service, input({ title: "Bị reset" }));
		voteUp(service, reset.id, USER_B);
		voteUp(service, reset.id, USER_C);
		service.resetUser(GUILD, USER_A, ADMIN);
		const fresh = submitApproved(service, input({ title: "Sau reset" }));
		voteUp(service, fresh.id, USER_B);
		voteUp(service, reset.id, USER_D);

		assert.deepEqual(service.list(GUILD, { limit: 10 }).map(c => [c.title, c.votes]), [["Sau reset", 1], ["Bị reset", 1]]);
		assert.equal(service.get(GUILD, reset.id)?.votes, 1);
		assert.equal(service.getProfile(GUILD, USER_A).score, 2);
	});
});

describe("ContributionService: tin nhắn nguồn (sourceMessageId)", () =>
{
	const SOURCE = "700000000000000001";
	const OTHER_SOURCE = "700000000000000002";

	function sourceOf(context: TestContext, contributionId: number): string | null | undefined
	{
		return context.db.prepare<[number], { source_message_id: string | null }>("SELECT source_message_id FROM contributions WHERE id = ?")
			.get(contributionId)?.source_message_id;
	}

	test("lưu tin nhắn nguồn; một tin chỉ ghi nhận được thành một contribution còn hiệu lực trong guild", () =>
	{
		const context = setup();
		const { service } = context;
		const first = service.submit(input({ authorId: USER_B, submittedBy: USER_A, sourceMessageId: SOURCE }));
		assert.equal(sourceOf(context, first.id), SOURCE);

		const duplicate = userError(`Tin nhắn này đã được ghi nhận thành đóng góp #${first.id}.`);
		assert.throws(() => service.submit(input({ authorId: USER_B, submittedBy: USER_C, sourceMessageId: SOURCE })), duplicate);
		assert.throws(() => service.submit(input({ authorId: USER_B, submittedBy: USER_A, sourceMessageId: SOURCE, title: "Tiêu đề khác" })), duplicate);
		assert.equal(countRows(context, "contributions"), 1);

		assert.notEqual(service.submit(input({ authorId: USER_B, sourceMessageId: OTHER_SOURCE })).id, first.id);
		assert.equal(service.submit(input({ guildId: OTHER_GUILD, authorId: USER_B, sourceMessageId: SOURCE })).guildId, OTHER_GUILD);
		assert.equal(countRows(context, "contributions"), 3);
	});

	test("contribution không có tin nhắn nguồn (/contribution submit) không bị giới hạn", () =>
	{
		const context = setup();
		const { service } = context;
		const withoutField = service.submit(input());
		const withNull = service.submit(input({ sourceMessageId: null }));
		service.submit(input({ sourceMessageId: null }));
		assert.equal(sourceOf(context, withoutField.id), null);
		assert.equal(sourceOf(context, withNull.id), null);
		assert.equal(countRows(context, "contributions"), 3);
	});

	test("contribution nguồn bị gỡ thì tin nhắn được ghi nhận lại", () =>
	{
		const { service } = setup();
		const first = service.submit(input({ authorId: USER_B, sourceMessageId: SOURCE }));
		service.remove(GUILD, first.id, ADMIN);

		const second = service.submit(input({ authorId: USER_B, sourceMessageId: SOURCE }));
		assert.notEqual(second.id, first.id);
		assert.throws(
			() => service.submit(input({ authorId: USER_B, sourceMessageId: SOURCE })),
			userError(`Tin nhắn này đã được ghi nhận thành đóng góp #${second.id}.`),
		);
	});

	test("không nhân điểm: điểm của một tin nhắn chỉ đến từ một contribution", () =>
	{
		const { service, deps } = setup();
		const { id } = submitApproved(service, input({ authorId: USER_B, submittedBy: USER_A, sourceMessageId: SOURCE }));
		assert.throws(() => service.submit(input({ authorId: USER_B, submittedBy: USER_C, sourceMessageId: SOURCE })), UserError);
		voteUp(service, id, USER_A);
		voteUp(service, id, USER_C);
		assert.equal(deps.contributionLedger.total(GUILD, USER_B), 2);
	});

	test("unique index là lớp chặn cuối ở tầng database", () =>
	{
		const context = setup();
		const first = context.service.submit(input({ sourceMessageId: SOURCE }));
		const insert = context.db.prepare<[string, string]>(`
			INSERT INTO contributions (guild_id, author_id, submitted_by, title, description, category, source_message_id, status, created_at)
			VALUES (?, 'u', 'u', 'Tiêu đề', 'Mô tả', 'khac', ?, 'active', 0)`);
		assert.throws(() => insert.run(GUILD, SOURCE), /UNIQUE constraint failed/);

		context.service.remove(GUILD, first.id, ADMIN);
		insert.run(GUILD, SOURCE);
		assert.equal(countRows(context, "contributions"), 2);
	});
});

describe("ContributionService tách biệt", () =>
{
	test("điểm contribution không ảnh hưởng Activity XP (DEC-004); người bấm chỉ nhận XP người bấm (DEC-051)", () =>
	{
		const context = setup();
		const { service, deps } = context;
		deps.xpLedger.record({ guildId: GUILD, userId: USER_A, amount: 40, source: "message" });

		const { id } = submitApproved(service, input());
		const vote = voteUp(service, id, USER_B);
		service.adjust({ guildId: GUILD, userId: USER_A, delta: 7, actorId: ADMIN, reason: null, roleIds: [] });
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 40, "tác giả không được XP từ điểm contribution");
		assert.equal(vote.xpAwarded, 5);
		assert.equal(deps.xpLedger.total(GUILD, USER_B), 5, "XP người bấm là Activity XP riêng, không phải điểm contribution");
		assert.equal(deps.contributionLedger.total(GUILD, USER_B), 0);

		service.remove(GUILD, id, ADMIN);
		service.resetUser(GUILD, USER_A, ADMIN);
		service.resetAll(GUILD, ADMIN);
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 40);
		assert.equal(deps.xpLedger.total(GUILD, USER_B), 5, "gỡ hay reset Contribution không đụng tới XP");
		assert.equal(countRows(context, "xp_events"), 2);
		assert.equal(deps.xpLedger.recent(GUILD, USER_A, 5)[0].voidedAt, null);
	});

	test("các guild độc lập", () =>
	{
		const { service, deps } = setup();
		deps.guildConfig.updateSettings(OTHER_GUILD, { contributionVotePoints: 9 }, ADMIN);
		const { id } = submitApproved(service, input());

		assert.equal(service.get(OTHER_GUILD, id), null);
		assert.deepEqual(service.list(OTHER_GUILD, { limit: 10 }), []);
		assert.throws(() => voteUp(service, id, USER_B, { guildId: OTHER_GUILD }), userError("Không tìm thấy contribution này."));
		assert.throws(() => service.remove(OTHER_GUILD, id, ADMIN), userError("Không tìm thấy contribution này."));
		assert.throws(() => service.approve(OTHER_GUILD, id, ADMIN), userError("Không tìm thấy contribution này."));

		service.attachMessage(OTHER_GUILD, id, CHANNEL_GENERAL, MESSAGE_ID);
		assert.equal(service.get(GUILD, id)?.messageId, null);

		voteUp(service, id, USER_B);
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
		const oldest = submitApproved(service, input({ title: "Cũ nhất" }));
		clock.advanceSeconds(10);
		const sameTimeFirst = service.submit(input({ title: "Cùng giờ 1", authorId: USER_B }));
		const sameTimeSecond = service.submit(input({ title: "Cùng giờ 2" }));
		clock.advanceSeconds(10);
		const removed = service.submit(input({ title: "Bị gỡ" }));
		service.remove(GUILD, removed.id, ADMIN);
		voteUp(service, oldest.id, USER_B);

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

	test("getProfile: điểm, hạng và số contribution còn hiệu lực (đã duyệt)", () =>
	{
		const { service } = setup();
		const first = submitApproved(service, input());
		submitApproved(service, input({ title: "Thứ hai" }));
		const removed = submitApproved(service, input({ title: "Bị gỡ" }));
		submitApproved(service, input({ authorId: USER_B, submittedBy: USER_A }));
		service.remove(GUILD, removed.id, ADMIN);
		voteUp(service, first.id, USER_B);
		service.adjust({ guildId: GUILD, userId: USER_C, delta: 5, actorId: ADMIN, reason: null, roleIds: [] });

		assert.deepEqual(service.getProfile(GUILD, USER_A), { userId: USER_A, score: 1, rank: 2, totalRanked: 2, contributions: 2 });
		assert.deepEqual(service.getProfile(GUILD, USER_C), { userId: USER_C, score: 5, rank: 1, totalRanked: 2, contributions: 0 });
		assert.deepEqual(service.getProfile(GUILD, USER_B), { userId: USER_B, score: 0, rank: null, totalRanked: 2, contributions: 1 });
	});
});

describe("ContributionService: điểm không âm (PROP-024)", () =>
{
	const COMPENSATION_REASON = "Tự động bù để điểm không âm (PROP-024)";
	const USER_D = "300000000000000004";

	/** Các event bù của một người, theo thứ tự ghi. */
	function compensations(context: TestContext, userId: string): LedgerEvent[]
	{
		return context.deps.contributionLedger.recent(GUILD, userId, 100)
			.filter(event => event.reason === COMPENSATION_REASON)
			.reverse();
	}

	/** Đọc thẳng bảng tổng team, vì teamTotals chỉ trả team có tổng > 0 nên không thấy được tổng âm. */
	function rawTeamTotal(context: TestContext, roleId: string): number | undefined
	{
		return context.db.prepare<[string, string], { total: number }>("SELECT total FROM contribution_team_totals WHERE guild_id = ? AND role_id = ?")
			.get(GUILD, roleId)?.total;
	}

	function eventTeams(context: TestContext, eventId: number): string[]
	{
		return context.db.prepare<[number], { role_id: string }>("SELECT role_id FROM contribution_event_teams WHERE event_id = ? ORDER BY role_id")
			.all(eventId)
			.map(row => row.role_id);
	}

	test("ví dụ trong PROP-024: 2 ghi nhận, admin trừ 2, gỡ contribution thì tổng là 0 chứ không phải -2", () =>
	{
		const context = setup();
		const { service, deps, clock } = context;
		const created = submitApproved(service, input());
		voteUp(service, created.id, USER_B);
		voteUp(service, created.id, USER_C);
		service.adjust({ guildId: GUILD, userId: USER_A, delta: -2, actorId: ADMIN, reason: "phạt", roleIds: [] });
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);

		clock.advanceSeconds(60);
		service.remove(GUILD, created.id, ADMIN);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
		assert.equal(countRows(context, "contribution_events"), 4, "2 ghi nhận + 1 admin trừ + 1 event bù");

		const [compensation] = compensations(context, USER_A);
		assert.deepEqual(compensation, {
			id: compensation.id,
			guildId: GUILD,
			userId: USER_A,
			amount: 2,
			source: "admin",
			referenceId: null,
			actorId: null,
			reason: COMPENSATION_REASON,
			createdAt: clock.now(),
			voidedAt: null,
		});

		const [entry] = deps.audit.list(GUILD, 1);
		assert.equal(entry.action, "contribution.remove");
		assert.equal(entry.targetId, USER_A);
		assert.deepEqual(entry.details, { contributionId: created.id, title: created.title, compensated: 2 });
	});

	test("rút ghi nhận sau khi admin trừ: tự bù về 0, không ghi audit; người rút không ghi nhận lại được (PROP-031)", () =>
	{
		const context = setup();
		const { service, deps } = context;
		const { id } = submitApproved(service, input());
		voteUp(service, id, USER_B);
		voteUp(service, id, USER_C);
		service.adjust({ guildId: GUILD, userId: USER_A, delta: -2, actorId: ADMIN, reason: null, roleIds: [] });
		const auditCount = deps.audit.list(GUILD, 100).length;

		const withdrawn = withdrawVote(service, id, USER_B);
		assert.deepEqual([withdrawn.current, withdrawn.change, withdrawn.locked], [null, "withdrawn", true]);
		assert.equal(withdrawn.contribution.votes, 1);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
		assert.deepEqual(compensations(context, USER_A).map(event => [event.amount, event.source, event.actorId, event.referenceId]), [[1, "admin", null, null]]);

		assert.equal(withdrawVote(service, id, USER_C).locked, true);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
		assert.deepEqual(compensations(context, USER_A).map(event => event.amount), [1, 1]);
		assert.equal(deps.audit.list(GUILD, 100).length, auditCount, "rút ghi nhận không ghi audit");

		// Ghi nhận lại bị chặn, nên hình phạt −2 của admin không bị xoá dần.
		for (const voterId of [USER_B, USER_C])
		{
			assert.throws(() => voteUp(service, id, voterId), { name: "UserError", message: /bị khoá/ });
			assert.deepEqual(service.voterState(GUILD, id, voterId), { current: null, locked: true });
		}
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
		assert.equal(service.get(GUILD, id)?.votes, 0);
	});

	test("rút ghi nhận khi không phải bù thì vẫn ghi nhận lại bình thường (PROP-031 chỉ khoá lần rút có bù)", () =>
	{
		const context = setup();
		const { service, deps } = context;
		const { id } = submitApproved(service, input());
		voteUp(service, id, USER_B);
		voteUp(service, id, USER_C);
		service.adjust({ guildId: GUILD, userId: USER_A, delta: -1, actorId: ADMIN, reason: null, roleIds: [] });

		const withdrawn = withdrawVote(service, id, USER_B);
		assert.deepEqual([withdrawn.current, withdrawn.locked], [null, false]);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
		assert.equal(compensations(context, USER_A).length, 0);

		const again = voteUp(service, id, USER_B);
		assert.deepEqual([again.current, again.locked], ["up", false]);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);
	});

	test("chỉ bù đúng phần âm khi admin trừ một phần", () =>
	{
		const context = setup();
		const { service, deps } = context;
		const { id } = submitApproved(service, input());
		deps.guildConfig.updateSettings(GUILD, { contributionVotePoints: 3 }, ADMIN);
		voteUp(service, id, USER_B);
		voteUp(service, id, USER_C);
		service.adjust({ guildId: GUILD, userId: USER_A, delta: -4, actorId: ADMIN, reason: null, roleIds: [] });
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 2);

		withdrawVote(service, id, USER_B);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
		assert.deepEqual(compensations(context, USER_A).map(event => event.amount), [1]);
	});

	test("event bù dùng snapshot team của contribution: điểm team không âm và khớp điểm thành viên", () =>
	{
		const context = setup();
		const { service, deps } = context;
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		const penalized = submitApproved(service, input({ authorRoleIds: [ROLE_BACKEND] }));
		const teammate = submitApproved(service, input({ authorId: USER_B, authorRoleIds: [ROLE_BACKEND] }));
		voteUp(service, penalized.id, USER_B);
		voteUp(service, penalized.id, USER_C);
		voteUp(service, teammate.id, USER_C);
		service.adjust({ guildId: GUILD, userId: USER_A, delta: -2, actorId: ADMIN, reason: null, roleIds: [ROLE_BACKEND] });
		assert.equal(rawTeamTotal(context, ROLE_BACKEND), 1);

		withdrawVote(service, penalized.id, USER_B);
		assert.equal(rawTeamTotal(context, ROLE_BACKEND), 1);

		service.remove(GUILD, penalized.id, ADMIN);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
		assert.equal(deps.contributionLedger.total(GUILD, USER_B), 1);
		assert.equal(rawTeamTotal(context, ROLE_BACKEND), 1, "team chỉ còn điểm của USER_B, không bị kéo âm");
		assert.deepEqual(deps.contributionLedger.teamTotals(GUILD, 10), [{ id: ROLE_BACKEND, total: 1 }]);
		assert.deepEqual(compensations(context, USER_A).map(event => eventTeams(context, event.id)), [[ROLE_BACKEND], [ROLE_BACKEND]]);
	});

	test("không bù khi tổng vẫn >= 0; audit contribution.remove không có compensated", () =>
	{
		const context = setup();
		const { service, deps } = context;
		const created = submitApproved(service, input());
		voteUp(service, created.id, USER_B);
		voteUp(service, created.id, USER_C);
		service.adjust({ guildId: GUILD, userId: USER_A, delta: -1, actorId: ADMIN, reason: null, roleIds: [] });

		withdrawVote(service, created.id, USER_B);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
		service.adjust({ guildId: GUILD, userId: USER_A, delta: 5, actorId: ADMIN, reason: null, roleIds: [] });
		service.remove(GUILD, created.id, ADMIN);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 4);
		assert.deepEqual(compensations(context, USER_A), []);

		const [entry] = deps.audit.list(GUILD, 1);
		assert.equal(entry.action, "contribution.remove");
		assert.deepEqual(entry.details, { contributionId: created.id, title: created.title });
	});

	test("event bù không bị huỷ khi sau đó gỡ chính contribution ấy hay contribution khác", () =>
	{
		const context = setup();
		const { service, deps } = context;
		const first = submitApproved(service, input());
		const second = submitApproved(service, input({ title: "Đóng góp thứ hai" }));
		voteUp(service, first.id, USER_B);
		voteUp(service, first.id, USER_C);
		voteUp(service, second.id, USER_B);
		service.adjust({ guildId: GUILD, userId: USER_A, delta: -3, actorId: ADMIN, reason: null, roleIds: [] });

		withdrawVote(service, first.id, USER_B);
		service.remove(GUILD, first.id, ADMIN);
		service.remove(GUILD, second.id, ADMIN);

		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
		assert.deepEqual(compensations(context, USER_A).map(event => [event.amount, event.voidedAt]), [[1, null], [1, null], [1, null]]);
		const compensated = deps.audit.list(GUILD, 10)
			.filter(entry => entry.action === "contribution.remove")
			.map(entry => entry.details?.compensated);
		assert.deepEqual(compensated, [1, 1]);
	});

	test("reset user vẫn đưa tổng về 0 như cũ, huỷ cả event bù; sau đó ghi nhận mới cộng bình thường", () =>
	{
		const context = setup();
		const { service, deps } = context;
		const created = submitApproved(service, input());
		voteUp(service, created.id, USER_B);
		voteUp(service, created.id, USER_C);
		service.adjust({ guildId: GUILD, userId: USER_A, delta: -2, actorId: ADMIN, reason: null, roleIds: [] });
		service.remove(GUILD, created.id, ADMIN);

		assert.deepEqual(service.resetUser(GUILD, USER_A, ADMIN), { voidedEvents: 2 }, "admin trừ + event bù (2 ghi nhận đã bị huỷ khi gỡ)");
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
		assert.equal(compensations(context, USER_A).length, 1);
		assert.ok(compensations(context, USER_A).every(event => event.voidedAt !== null));

		const fresh = submitApproved(service, input({ title: "Sau reset" }));
		voteUp(service, fresh.id, USER_D);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);
	});
});
