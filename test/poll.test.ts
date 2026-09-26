import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { SETTING_LIMITS } from "../src/modules/guild-config/types";
import { PollService } from "../src/modules/poll/PollService";
import { CreatePollInput, Poll, POLL_LIMITS, PollVoteResult } from "../src/modules/poll/types";
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

const MINUTE = 60_000;
const MESSAGE_ID = "600000000000000001";

function setup(): TestContext & { polls: PollService }
{
	const context = createTestContext();
	return { ...context, polls: new PollService(context.db, context.deps) };
}

function pollInput(overrides: Partial<CreatePollInput> = {}): CreatePollInput
{
	return {
		guildId: GUILD,
		creatorId: ADMIN,
		question: "Đi team building ở đâu?",
		options: ["Đà Lạt", "Vũng Tàu", "Phú Quốc"],
		multiSelect: false,
		xpReward: 5,
		durationMinutes: null,
		...overrides,
	};
}

function assertUserError(fn: () => unknown, message: string | RegExp): void
{
	assert.throws(fn, (error: unknown) =>
	{
		assert.ok(error instanceof UserError, `cần UserError, nhận được ${String(error)}`);
		if (typeof message === "string") assert.equal(error.message, message);
		else assert.match(error.message, message);
		return true;
	});
}

function votes(poll: Poll): number[]
{
	return poll.options.map(option => option.votes);
}

function countRows(context: TestContext, table: "polls" | "xp_events" | "contribution_events" | "member_contribution"): number
{
	// Tên bảng lấy từ union cố định trong test, không phải input.
	return context.db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0;
}

describe("PollService.create", () =>
{
	test("tạo vote: trim câu hỏi và lựa chọn, bỏ lựa chọn trống, đánh số từ 0, ghi audit", () =>
	{
		const { polls, deps, clock } = setup();
		const poll = polls.create(pollInput({
			question: "   Ăn trưa ở đâu?  ",
			options: ["  Cơm tấm ", "", "   ", "Phở", "Bún chả  "],
			multiSelect: true,
			xpReward: 7,
		}));

		assert.equal(poll.guildId, GUILD);
		assert.equal(poll.creatorId, ADMIN);
		assert.equal(poll.question, "Ăn trưa ở đâu?");
		assert.equal(poll.multiSelect, true);
		assert.equal(poll.xpReward, 7);
		assert.deepEqual(poll.options, [
			{ index: 0, label: "Cơm tấm", votes: 0 },
			{ index: 1, label: "Phở", votes: 0 },
			{ index: 2, label: "Bún chả", votes: 0 },
		]);
		assert.equal(poll.participants, 0);
		assert.equal(poll.open, true);
		assert.equal(poll.closesAt, null);
		assert.equal(poll.closedAt, null);
		assert.equal(poll.createdAt, clock.now());
		assert.equal(poll.channelId, null);
		assert.equal(poll.messageId, null);
		assert.deepEqual(polls.get(GUILD, poll.id), poll);

		const [entry] = deps.audit.list(GUILD, 5);
		assert.equal(entry.action, "poll.create");
		assert.equal(entry.actorId, ADMIN);
		assert.equal(entry.targetId, null);
		assert.deepEqual(entry.details, { pollId: poll.id, question: "Ăn trưa ở đâu?", xpReward: 7 });
	});

	test("audit poll.create ghi XP thưởng, kể cả khi bằng 0 hoặc ở mức tối đa", () =>
	{
		const { polls, deps } = setup();
		const zero = polls.create(pollInput({ xpReward: 0 }));
		const max = polls.create(pollInput({ xpReward: SETTING_LIMITS.defaultPollXp.max }));

		const details = deps.audit.list(GUILD, 5).filter(entry => entry.action === "poll.create").map(entry => entry.details);
		assert.deepEqual(details, [
			{ pollId: max.id, question: "Đi team building ở đâu?", xpReward: SETTING_LIMITS.defaultPollXp.max },
			{ pollId: zero.id, question: "Đi team building ở đâu?", xpReward: 0 },
		]);
	});

	test("có thời hạn thì closesAt = lúc tạo + số phút", () =>
	{
		const { polls, clock } = setup();
		const poll = polls.create(pollInput({ durationMinutes: 90 }));
		assert.equal(poll.closesAt, clock.now() + 90 * MINUTE);
		assert.equal(poll.open, true);
	});

	test("chấp nhận các giá trị biên", () =>
	{
		const { polls } = setup();
		const options = Array.from({ length: POLL_LIMITS.optionsMax }, (_, i) => `${i}`.padEnd(POLL_LIMITS.optionLabelMax, "x"));
		const poll = polls.create(pollInput({
			question: "a".repeat(POLL_LIMITS.questionMin),
			options,
			xpReward: 1000,
			durationMinutes: POLL_LIMITS.durationMinutesMax,
		}));
		assert.equal(poll.options.length, POLL_LIMITS.optionsMax);
		polls.create(pollInput({ question: "b".repeat(POLL_LIMITS.questionMax), options: ["A", "B"], xpReward: 0, durationMinutes: 1 }));
	});

	test("từ chối dữ liệu không hợp lệ bằng UserError tiếng Việt, không ghi gì vào database", () =>
	{
		const context = setup();
		const { polls, deps } = context;

		assertUserError(() => polls.create(pollInput({ question: "  ab  " })), /Câu hỏi phải dài từ 3 đến 200 ký tự/);
		assertUserError(() => polls.create(pollInput({ question: "a".repeat(201) })), /Câu hỏi/);
		assertUserError(() => polls.create(pollInput({ options: ["Có", "  ", ""] })), /từ 2 đến 10 lựa chọn/);
		assertUserError(() => polls.create(pollInput({ options: Array.from({ length: 11 }, (_, i) => `Lựa chọn ${i}`) })), /từ 2 đến 10 lựa chọn/);
		assertUserError(() => polls.create(pollInput({ options: ["Có", "k".repeat(81)] })), /tối đa 80 ký tự/);
		assertUserError(() => polls.create(pollInput({ options: ["Đồng ý", "  đồng Ý "] })), "Các lựa chọn không được trùng nhau.");
		assertUserError(() => polls.create(pollInput({ options: ["Việt".normalize("NFD"), "việt"] })), "Các lựa chọn không được trùng nhau.");
		assertUserError(() => polls.create(pollInput({ xpReward: -1 })), /XP cho người tham gia phải là số nguyên từ 0 đến 1000/);
		assertUserError(() => polls.create(pollInput({ xpReward: 1001 })), /XP/);
		assertUserError(() => polls.create(pollInput({ xpReward: 2.5 })), /XP/);
		assertUserError(() => polls.create(pollInput({ durationMinutes: 0 })), /Thời hạn/);
		assertUserError(() => polls.create(pollInput({ durationMinutes: 1.5 })), /Thời hạn/);
		assertUserError(() => polls.create(pollInput({ durationMinutes: POLL_LIMITS.durationMinutesMax + 1 })), /Thời hạn/);

		assert.equal(countRows(context, "polls"), 0);
		assert.equal(deps.audit.list(GUILD, 10).length, 0);
	});
});

describe("PollService.vote", () =>
{
	test("chọn một: đổi phiếu, bấm lại lựa chọn đang chọn thì không đổi", () =>
	{
		const { polls } = setup();
		const { id } = polls.create(pollInput());

		let result = polls.vote({ guildId: GUILD, pollId: id, userId: USER_A, optionIndex: 0, roleIds: [] });
		assert.deepEqual(result.selected, [0]);
		assert.deepEqual(votes(result.poll), [1, 0, 0]);

		result = polls.vote({ guildId: GUILD, pollId: id, userId: USER_A, optionIndex: 2, roleIds: [] });
		assert.deepEqual(result.selected, [2]);
		assert.deepEqual(votes(result.poll), [0, 0, 1]);

		result = polls.vote({ guildId: GUILD, pollId: id, userId: USER_A, optionIndex: 2, roleIds: [] });
		assert.deepEqual(result.selected, [2]);
		assert.deepEqual(votes(result.poll), [0, 0, 1]);
		assert.equal(result.poll.participants, 1);
	});

	test("chọn nhiều: bấm để bật/tắt từng lựa chọn, selected tăng dần", () =>
	{
		const { polls } = setup();
		const { id } = polls.create(pollInput({ multiSelect: true }));

		polls.vote({ guildId: GUILD, pollId: id, userId: USER_A, optionIndex: 2, roleIds: [] });
		let result = polls.vote({ guildId: GUILD, pollId: id, userId: USER_A, optionIndex: 0, roleIds: [] });
		assert.deepEqual(result.selected, [0, 2]);
		assert.deepEqual(votes(result.poll), [1, 0, 1]);

		result = polls.vote({ guildId: GUILD, pollId: id, userId: USER_A, optionIndex: 2, roleIds: [] });
		assert.deepEqual(result.selected, [0]);
		assert.deepEqual(votes(result.poll), [1, 0, 0]);
	});

	test("participants là số người khác nhau đang có lựa chọn; số phiếu đếm theo từng lựa chọn", () =>
	{
		const { polls } = setup();
		const { id } = polls.create(pollInput({ multiSelect: true }));

		polls.vote({ guildId: GUILD, pollId: id, userId: USER_A, optionIndex: 0, roleIds: [] });
		polls.vote({ guildId: GUILD, pollId: id, userId: USER_A, optionIndex: 1, roleIds: [] });
		polls.vote({ guildId: GUILD, pollId: id, userId: USER_B, optionIndex: 1, roleIds: [] });
		const result = polls.vote({ guildId: GUILD, pollId: id, userId: USER_C, optionIndex: 2, roleIds: [] });
		assert.equal(result.poll.participants, 3);
		assert.deepEqual(votes(result.poll), [1, 2, 1]);

		const poll = polls.vote({ guildId: GUILD, pollId: id, userId: USER_C, optionIndex: 2, roleIds: [] }).poll;
		assert.equal(poll.participants, 2);
		assert.deepEqual(votes(poll), [1, 2, 0]);
	});

	test("phiếu ẩn danh: dữ liệu trả về không chứa ID người vote", () =>
	{
		const { polls } = setup();
		const { id } = polls.create(pollInput({ creatorId: USER_C }));
		polls.vote({ guildId: GUILD, pollId: id, userId: USER_A, optionIndex: 0, roleIds: [] });
		const result = polls.vote({ guildId: GUILD, pollId: id, userId: USER_B, optionIndex: 1, roleIds: [] });

		for (const poll of [result.poll, polls.get(GUILD, id), ...polls.listOpen(GUILD)])
		{
			const json = JSON.stringify(poll);
			assert.ok(!json.includes(USER_A));
			assert.ok(!json.includes(USER_B));
		}
	});

	test("XP chỉ cộng một lần cho mỗi người mỗi vote, vào Activity XP với source poll", () =>
	{
		const { polls, deps } = setup();
		const { id } = polls.create(pollInput({ xpReward: 5 }));

		assert.equal(polls.vote({ guildId: GUILD, pollId: id, userId: USER_A, optionIndex: 0, roleIds: [] }).xpAwarded, 5);
		assert.equal(polls.vote({ guildId: GUILD, pollId: id, userId: USER_A, optionIndex: 1, roleIds: [] }).xpAwarded, 0);
		assert.equal(polls.vote({ guildId: GUILD, pollId: id, userId: USER_A, optionIndex: 1, roleIds: [] }).xpAwarded, 0);
		assert.equal(polls.vote({ guildId: GUILD, pollId: id, userId: USER_B, optionIndex: 1, roleIds: [] }).xpAwarded, 5);

		assert.equal(deps.xpLedger.total(GUILD, USER_A), 5);
		assert.equal(deps.xpLedger.total(GUILD, USER_B), 5);
		const events = deps.xpLedger.recent(GUILD, USER_A, 10);
		assert.equal(events.length, 1);
		assert.equal(events[0].source, "poll");
		assert.equal(events[0].referenceId, String(id));
		assert.equal(events[0].amount, 5);
	});

	test("mỗi vote là một lần nhận XP riêng", () =>
	{
		const { polls, deps } = setup();
		const first = polls.create(pollInput({ xpReward: 5 }));
		const second = polls.create(pollInput({ xpReward: 3 }));
		polls.vote({ guildId: GUILD, pollId: first.id, userId: USER_A, optionIndex: 0, roleIds: [] });
		polls.vote({ guildId: GUILD, pollId: second.id, userId: USER_A, optionIndex: 0, roleIds: [] });
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 8);
	});

	test("xpReward = 0 thì không có event XP", () =>
	{
		const context = setup();
		const { polls, deps } = context;
		const { id } = polls.create(pollInput({ xpReward: 0 }));

		const result = polls.vote({ guildId: GUILD, pollId: id, userId: USER_A, optionIndex: 0, roleIds: [] });
		assert.equal(result.xpAwarded, 0);
		assert.equal(result.poll.participants, 1);
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 0);
		assert.equal(countRows(context, "xp_events"), 0);
	});

	test("bỏ hết lựa chọn rồi chọn lại không được XP lại", () =>
	{
		const { polls, deps } = setup();
		const { id } = polls.create(pollInput({ multiSelect: true, xpReward: 5 }));

		assert.equal(polls.vote({ guildId: GUILD, pollId: id, userId: USER_A, optionIndex: 1, roleIds: [] }).xpAwarded, 5);
		const cleared = polls.vote({ guildId: GUILD, pollId: id, userId: USER_A, optionIndex: 1, roleIds: [] });
		assert.deepEqual(cleared.selected, []);
		assert.equal(cleared.xpAwarded, 0);
		assert.equal(cleared.poll.participants, 0);

		const again = polls.vote({ guildId: GUILD, pollId: id, userId: USER_A, optionIndex: 0, roleIds: [] });
		assert.deepEqual(again.selected, [0]);
		assert.equal(again.xpAwarded, 0);
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 5);
		assert.equal(deps.xpLedger.recent(GUILD, USER_A, 10).length, 1);
	});

	test("event XP lưu snapshot team của người vote (DEC-024)", () =>
	{
		const { polls, deps } = setup();
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		deps.teams.add(GUILD, ROLE_FRONTEND, ADMIN);
		const { id } = polls.create(pollInput({ xpReward: 5 }));

		polls.vote({ guildId: GUILD, pollId: id, userId: USER_A, optionIndex: 0, roleIds: [ROLE_BACKEND, ROLE_OTHER] });
		polls.vote({ guildId: GUILD, pollId: id, userId: USER_B, optionIndex: 1, roleIds: [ROLE_BACKEND, ROLE_FRONTEND] });
		polls.vote({ guildId: GUILD, pollId: id, userId: USER_C, optionIndex: 1, roleIds: [] });

		assert.deepEqual(deps.xpLedger.teamTotals(GUILD, 10), [
			{ id: ROLE_BACKEND, total: 10 },
			{ id: ROLE_FRONTEND, total: 5 },
		]);
	});

	test("không ảnh hưởng tới Contribution ledger (DEC-004)", () =>
	{
		const context = setup();
		const { polls, deps } = context;
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		const { id } = polls.create(pollInput({ xpReward: 5 }));
		polls.vote({ guildId: GUILD, pollId: id, userId: USER_A, optionIndex: 0, roleIds: [ROLE_BACKEND] });

		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
		assert.deepEqual(deps.contributionLedger.teamTotals(GUILD, 10), []);
		assert.equal(countRows(context, "contribution_events"), 0);
		assert.equal(countRows(context, "member_contribution"), 0);
	});

	test("từ chối vote không tồn tại, của guild khác, hoặc lựa chọn không hợp lệ", () =>
	{
		const { polls, deps } = setup();
		const { id } = polls.create(pollInput());

		assertUserError(() => polls.vote({ guildId: GUILD, pollId: id + 100, userId: USER_A, optionIndex: 0, roleIds: [] }), "Không tìm thấy vote này.");
		assertUserError(() => polls.vote({ guildId: OTHER_GUILD, pollId: id, userId: USER_A, optionIndex: 0, roleIds: [] }), "Không tìm thấy vote này.");
		assertUserError(() => polls.vote({ guildId: GUILD, pollId: Number.NaN, userId: USER_A, optionIndex: 0, roleIds: [] }), "Không tìm thấy vote này.");
		for (const optionIndex of [-1, 3, 1.5, Number.NaN])
		{
			assertUserError(() => polls.vote({ guildId: GUILD, pollId: id, userId: USER_A, optionIndex, roleIds: [] }), "Lựa chọn không hợp lệ.");
		}

		const poll = polls.get(GUILD, id);
		assert.equal(poll?.participants, 0);
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 0);
	});

	test("từ chối vote đã đóng, giữ nguyên phiếu cũ", () =>
	{
		const { polls } = setup();
		const { id } = polls.create(pollInput());
		polls.vote({ guildId: GUILD, pollId: id, userId: USER_A, optionIndex: 0, roleIds: [] });
		polls.close({ guildId: GUILD, pollId: id, actorId: ADMIN, actorIsAdmin: true });

		assertUserError(() => polls.vote({ guildId: GUILD, pollId: id, userId: USER_A, optionIndex: 1, roleIds: [] }), "Vote này đã đóng.");
		assertUserError(() => polls.vote({ guildId: GUILD, pollId: id, userId: USER_B, optionIndex: 1, roleIds: [] }), "Vote này đã đóng.");
		const after = polls.get(GUILD, id);
		assert.ok(after);
		assert.deepEqual(votes(after), [1, 0, 0]);
	});

	test("quá hạn thì coi như đã đóng, kể cả khi closeDue chưa chạy", () =>
	{
		const { polls, clock, deps } = setup();
		const { id } = polls.create(pollInput({ durationMinutes: 10 }));

		clock.advance(10 * MINUTE - 1);
		assert.equal(polls.vote({ guildId: GUILD, pollId: id, userId: USER_A, optionIndex: 0, roleIds: [] }).poll.open, true);

		clock.advance(1);
		assert.equal(polls.get(GUILD, id)?.open, false);
		assert.equal(polls.get(GUILD, id)?.closedAt, null);
		assertUserError(() => polls.vote({ guildId: GUILD, pollId: id, userId: USER_B, optionIndex: 0, roleIds: [] }), "Vote này đã đóng.");
		assert.equal(deps.xpLedger.total(GUILD, USER_B), 0);
	});
});

describe("PollService.close", () =>
{
	test("chỉ người tạo hoặc admin đóng được; ghi audit poll.close", () =>
	{
		const { polls, deps, clock } = setup();
		const byCreator = polls.create(pollInput({ creatorId: USER_A }));
		const byAdmin = polls.create(pollInput({ creatorId: USER_A }));

		assertUserError(
			() => polls.close({ guildId: GUILD, pollId: byCreator.id, actorId: USER_B, actorIsAdmin: false }),
			"Chỉ người tạo vote hoặc admin mới đóng được vote.",
		);
		assert.equal(polls.get(GUILD, byCreator.id)?.open, true);

		clock.advance(MINUTE);
		const closed = polls.close({ guildId: GUILD, pollId: byCreator.id, actorId: USER_A, actorIsAdmin: false });
		assert.equal(closed.open, false);
		assert.equal(closed.closedAt, clock.now());

		const closedByAdmin = polls.close({ guildId: GUILD, pollId: byAdmin.id, actorId: USER_B, actorIsAdmin: true });
		assert.equal(closedByAdmin.open, false);

		const [last, first] = deps.audit.list(GUILD, 10).filter(entry => entry.action === "poll.close");
		assert.equal(first.actorId, USER_A);
		assert.equal(first.targetId, null);
		assert.deepEqual(first.details, { pollId: byCreator.id });
		assert.equal(last.actorId, USER_B);
		assert.deepEqual(last.details, { pollId: byAdmin.id });
	});

	test("từ chối đóng vote đã đóng, không tồn tại hoặc của guild khác", () =>
	{
		const { polls, deps } = setup();
		const { id } = polls.create(pollInput());
		polls.close({ guildId: GUILD, pollId: id, actorId: ADMIN, actorIsAdmin: true });

		assertUserError(() => polls.close({ guildId: GUILD, pollId: id, actorId: ADMIN, actorIsAdmin: true }), "Vote này đã đóng.");
		assertUserError(() => polls.close({ guildId: GUILD, pollId: id + 1, actorId: ADMIN, actorIsAdmin: true }), "Không tìm thấy vote này.");
		assertUserError(() => polls.close({ guildId: OTHER_GUILD, pollId: id, actorId: ADMIN, actorIsAdmin: true }), "Không tìm thấy vote này.");
		assert.equal(deps.audit.list(GUILD, 10).filter(entry => entry.action === "poll.close").length, 1);
	});
});

describe("PollService.closeDue và listOpen", () =>
{
	test("closeDue đóng các vote tới hạn ở mọi guild, không ghi audit", () =>
	{
		const { polls, clock, deps } = setup();
		const short = polls.create(pollInput({ durationMinutes: 10 }));
		const otherGuild = polls.create(pollInput({ guildId: OTHER_GUILD, durationMinutes: 10 }));
		const long = polls.create(pollInput({ durationMinutes: 60 }));
		const forever = polls.create(pollInput({ durationMinutes: null }));

		clock.advance(10 * MINUTE - 1);
		assert.deepEqual(polls.closeDue(), []);

		clock.advance(1);
		const closed = polls.closeDue();
		assert.deepEqual(closed.map(poll => poll.id).sort((a, b) => a - b), [short.id, otherGuild.id]);
		for (const poll of closed)
		{
			assert.equal(poll.open, false);
			assert.equal(poll.closedAt, clock.now());
		}
		assert.deepEqual(polls.closeDue(), []);

		clock.advance(50 * MINUTE);
		assert.deepEqual(polls.closeDue().map(poll => poll.id), [long.id]);
		assert.equal(polls.get(GUILD, forever.id)?.open, true);

		clock.advance(365 * 24 * 60 * MINUTE);
		assert.deepEqual(polls.closeDue(), []);
		assert.equal(deps.audit.list(GUILD, 20).filter(entry => entry.action === "poll.close").length, 0);
		assert.equal(deps.audit.list(OTHER_GUILD, 20).filter(entry => entry.action === "poll.close").length, 0);
	});

	test("closeDue bỏ qua vote đã được đóng tay", () =>
	{
		const { polls, clock } = setup();
		const { id } = polls.create(pollInput({ durationMinutes: 5 }));
		clock.advance(MINUTE);
		polls.close({ guildId: GUILD, pollId: id, actorId: ADMIN, actorIsAdmin: true });
		const closedAt = clock.now();

		clock.advance(10 * MINUTE);
		assert.deepEqual(polls.closeDue(), []);
		assert.equal(polls.get(GUILD, id)?.closedAt, closedAt);
	});

	test("listOpen: vote đang mở của guild, mới nhất trước, bỏ vote đã đóng hoặc quá hạn", () =>
	{
		const { polls, clock } = setup();
		const expiring = polls.create(pollInput({ durationMinutes: 5 }));
		clock.advance(MINUTE);
		const older = polls.create(pollInput());
		clock.advance(MINUTE);
		const closed = polls.create(pollInput());
		clock.advance(MINUTE);
		const newest = polls.create(pollInput());
		polls.create(pollInput({ guildId: OTHER_GUILD }));
		polls.close({ guildId: GUILD, pollId: closed.id, actorId: ADMIN, actorIsAdmin: true });

		assert.deepEqual(polls.listOpen(GUILD).map(poll => poll.id), [newest.id, older.id, expiring.id]);
		clock.advance(2 * MINUTE);
		assert.deepEqual(polls.listOpen(GUILD).map(poll => poll.id), [newest.id, older.id]);
		assert.ok(polls.listOpen(GUILD).every(poll => poll.open));
	});
});

describe("PollService: guild và message", () =>
{
	test("các guild độc lập: không đọc, vote hay nhận XP chéo guild", () =>
	{
		const { polls, deps } = setup();
		const mine = polls.create(pollInput());
		const theirs = polls.create(pollInput({ guildId: OTHER_GUILD }));

		assert.equal(polls.get(OTHER_GUILD, mine.id), null);
		assert.equal(polls.get(GUILD, theirs.id), null);
		assert.deepEqual(polls.listOpen(GUILD).map(poll => poll.id), [mine.id]);
		assert.deepEqual(polls.listOpen(OTHER_GUILD).map(poll => poll.id), [theirs.id]);

		polls.vote({ guildId: OTHER_GUILD, pollId: theirs.id, userId: USER_A, optionIndex: 0, roleIds: [] });
		assert.equal(deps.xpLedger.total(OTHER_GUILD, USER_A), 5);
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 0);
		assert.equal(polls.get(GUILD, mine.id)?.participants, 0);
		assert.equal(deps.audit.list(GUILD, 10).length, 1);
		assert.equal(deps.audit.list(OTHER_GUILD, 10).length, 1);
	});

	test("get trả null khi không có vote", () =>
	{
		const { polls } = setup();
		assert.equal(polls.get(GUILD, 1), null);
		assert.equal(polls.get(GUILD, Number.NaN), null);
	});

	test("attachMessage lưu vị trí message; vote không có trong guild thì báo lỗi", () =>
	{
		const { polls } = setup();
		const { id } = polls.create(pollInput());

		polls.attachMessage(GUILD, id, CHANNEL_GENERAL, MESSAGE_ID);
		const poll = polls.get(GUILD, id);
		assert.equal(poll?.channelId, CHANNEL_GENERAL);
		assert.equal(poll?.messageId, MESSAGE_ID);

		assertUserError(() => polls.attachMessage(OTHER_GUILD, id, CHANNEL_GENERAL, MESSAGE_ID), "Không tìm thấy vote này.");
		assertUserError(() => polls.attachMessage(GUILD, id + 1, CHANNEL_GENERAL, MESSAGE_ID), "Không tìm thấy vote này.");
	});
});

describe("PollService: giới hạn XP từ vote mỗi ngày (PROP-028)", () =>
{
	/** 00:00 ngày 02/01/2026 giờ Việt Nam = 17:00 UTC ngày 01/01. Đồng hồ test bắt đầu lúc 07:00 giờ Việt Nam ngày 01/01. */
	const NEXT_VN_DAY = Date.UTC(2026, 0, 1, 17, 0, 0);

	type PollContext = ReturnType<typeof setup>;

	/** Tạo một vote mới rồi cho userId bấm lựa chọn đầu tiên. */
	function voteNew(context: PollContext, overrides: Partial<CreatePollInput> = {}, userId = USER_A): PollVoteResult
	{
		const poll = context.polls.create(pollInput(overrides));
		return context.polls.vote({ guildId: poll.guildId, pollId: poll.id, userId, optionIndex: 0, roleIds: [] });
	}

	function revote(context: PollContext, pollId: number, optionIndex: number): PollVoteResult
	{
		return context.polls.vote({ guildId: GUILD, pollId, userId: USER_A, optionIndex, roleIds: [] });
	}

	function summary(result: PollVoteResult): [number, boolean, number]
	{
		return [result.xpAwarded, result.xpCapped, result.dailyCap];
	}

	function participantEventId(context: PollContext, pollId: number, userId: string): number | null | undefined
	{
		return context.db.prepare<[number, string], { xp_event_id: number | null }>("SELECT xp_event_id FROM poll_participants WHERE poll_id = ? AND user_id = ?")
			.get(pollId, userId)?.xp_event_id;
	}

	test("mặc định 25 XP mỗi ngày: XP 5 mỗi vote thì vote thứ 6 trong ngày không được XP nhưng vẫn tính là đã tham gia", () =>
	{
		const context = setup();
		const { deps } = context;
		assert.equal(deps.guildConfig.getSettings(GUILD).pollXpDailyCap, 25);

		for (let i = 0; i < 5; i++) assert.deepEqual(summary(voteNew(context)), [5, false, 25]);
		const sixth = voteNew(context);
		assert.deepEqual(summary(sixth), [0, true, 25]);
		assert.deepEqual(sixth.selected, [0]);
		assert.equal(sixth.poll.participants, 1);
		assert.equal(participantEventId(context, sixth.poll.id, USER_A), null);
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 25);
		assert.equal(countRows(context, "xp_events"), 5, "bị cắt về 0 thì không ghi event XP");

		assert.deepEqual(summary(voteNew(context, {}, USER_B)), [5, false, 25], "giới hạn tính riêng từng người");
	});

	test("cắt một phần: XP 20 với giới hạn 25 thì được 20, rồi 5, rồi 0", () =>
	{
		const context = setup();
		const { deps } = context;
		const first = voteNew(context, { xpReward: 20 });
		const second = voteNew(context, { xpReward: 20 });
		const third = voteNew(context, { xpReward: 20 });

		assert.deepEqual(summary(first), [20, false, 25]);
		assert.deepEqual(summary(second), [5, true, 25]);
		assert.deepEqual(summary(third), [0, true, 25]);
		const events = deps.xpLedger.recent(GUILD, USER_A, 10).reverse();
		assert.deepEqual(events.map(event => [event.amount, event.source, event.referenceId]), [
			[20, "poll", String(first.poll.id)],
			[5, "poll", String(second.poll.id)],
		]);
		assert.equal(participantEventId(context, second.poll.id, USER_A), events[1].id);
		assert.equal(participantEventId(context, third.poll.id, USER_A), null);
	});

	test("sang ngày mới (00:00 giờ Việt Nam = 17:00 UTC) được nhận lại; phần bị cắt hôm trước không được cộng bù", () =>
	{
		const context = setup();
		const { deps, clock } = context;
		const big = voteNew(context, { xpReward: 30, multiSelect: true });
		const small = voteNew(context, { multiSelect: true });
		assert.deepEqual(summary(big), [25, true, 25]);
		assert.deepEqual(summary(small), [0, true, 25]);

		clock.current = NEXT_VN_DAY - 1;
		assert.deepEqual(summary(voteNew(context)), [0, true, 25], "23:59:59.999 giờ Việt Nam vẫn là ngày cũ");

		clock.current = NEXT_VN_DAY;
		assert.deepEqual(summary(revote(context, big.poll.id, 1)), [0, false, 25]);
		assert.deepEqual(summary(revote(context, small.poll.id, 1)), [0, false, 25]);
		assert.deepEqual(summary(voteNew(context, { xpReward: 30 })), [25, true, 25]);
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 50);
	});

	test("giới hạn 0 là không giới hạn", () =>
	{
		const context = setup();
		const { deps } = context;
		deps.guildConfig.updateSettings(GUILD, { pollXpDailyCap: 0 }, ADMIN);

		for (let i = 0; i < 10; i++) assert.deepEqual(summary(voteNew(context)), [5, false, 0]);
		assert.deepEqual(summary(voteNew(context, { xpReward: SETTING_LIMITS.defaultPollXp.max })), [SETTING_LIMITS.defaultPollXp.max, false, 0]);
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 50 + SETTING_LIMITS.defaultPollXp.max);
	});

	test("XP từ vote đã bị admin reset (event đã huỷ) không tính vào phần đã dùng", () =>
	{
		const context = setup();
		const { deps } = context;
		const first = voteNew(context);
		for (let i = 0; i < 4; i++) voteNew(context);
		assert.equal(voteNew(context).xpAwarded, 0);

		const firstEventId = participantEventId(context, first.poll.id, USER_A);
		assert.ok(typeof firstEventId === "number");
		deps.xpLedger.voidEvent(firstEventId);
		assert.deepEqual(summary(voteNew(context)), [5, false, 25]);
		assert.deepEqual(summary(voteNew(context)), [0, true, 25]);

		deps.xpLedger.voidUser(GUILD, USER_A);
		assert.deepEqual(summary(voteNew(context, { xpReward: 30 })), [25, true, 25]);
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 25);
	});

	test("XP từ tin nhắn, từ admin và từ vote ở guild khác không tính vào giới hạn", () =>
	{
		const context = setup();
		const { deps } = context;
		deps.xpLedger.record({ guildId: GUILD, userId: USER_A, amount: 100, source: "message" });
		deps.xpLedger.record({ guildId: GUILD, userId: USER_A, amount: 50, source: "admin", actorId: ADMIN });
		assert.deepEqual(summary(voteNew(context, { guildId: OTHER_GUILD, xpReward: 25 })), [25, false, 25]);

		assert.deepEqual(summary(voteNew(context, { xpReward: 25 })), [25, false, 25]);
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 175);
		assert.equal(deps.xpLedger.total(OTHER_GUILD, USER_A), 25);
	});

	test("xpCapped chỉ true ở lần tham gia đầu của vote có XP; dailyCap luôn là giới hạn hiện tại", () =>
	{
		const context = setup();
		const { deps } = context;
		const first = voteNew(context, { xpReward: 20, multiSelect: true });
		assert.deepEqual(summary(revote(context, first.poll.id, 1)), [0, false, 25]);

		deps.guildConfig.updateSettings(GUILD, { pollXpDailyCap: 10 }, ADMIN);
		const lowered = voteNew(context, { multiSelect: true });
		assert.deepEqual(summary(lowered), [0, true, 10], "đã dùng 20, vượt giới hạn mới 10");
		assert.deepEqual(summary(revote(context, lowered.poll.id, 1)), [0, false, 10]);
		assert.deepEqual(summary(voteNew(context, { xpReward: 0 })), [0, false, 10], "vote không có XP thì không bị coi là bị cắt");

		deps.guildConfig.updateSettings(GUILD, { pollXpDailyCap: 30 }, ADMIN);
		assert.deepEqual(summary(revote(context, lowered.poll.id, 2)), [0, false, 30], "nới giới hạn cũng không cộng bù cho vote đã tham gia");
		assert.deepEqual(summary(voteNew(context, { xpReward: 20 })), [10, true, 30]);
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 30);
	});
});
