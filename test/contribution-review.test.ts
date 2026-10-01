import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ContributionService } from "../src/modules/contribution/ContributionService";
import {
	ContributionListQuery,
	ContributionVoteAction,
	ContributionVoteInput,
	ContributionVoteKind,
	ContributionVoteResult,
} from "../src/modules/contribution/types";
import { LeaderboardService } from "../src/modules/leaderboard/LeaderboardService";
import { StatisticsService } from "../src/modules/statistics/StatisticsService";
import { UserError } from "../src/shared/errors";
import {
	BOT_ID,
	castVote,
	CONTRIBUTION_CHANNEL,
	contributionInput,
	ContributionTestContext,
	DOWN_REASON,
	enableContributions,
	setupContributions,
	submitApproved,
	voteDown,
	voteUp,
	withdrawVote,
} from "./contribution-helpers";
import {
	ADMIN,
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

const USER_D = "300000000000000004";
const USER_E = "300000000000000005";
const USER_F = "300000000000000006";
const USER_G = "300000000000000007";
const REVIEWER = "300000000000000010";

const NO_CHANNEL = "Admin chưa chọn kênh contribution nên chưa gửi được đóng góp. Hãy báo admin chọn kênh trên trang web quản trị hoặc bằng `/config contribution`.";
const NOT_APPROVED = "Đóng góp này đang chờ duyệt, chưa ghi nhận được.";
const REJECTED = "Đóng góp này không được duyệt nên không ghi nhận được.";
const SELF_VOTE = "Bạn không thể tự ghi nhận hay không ghi nhận đóng góp của chính mình.";
const VOTE_LOCKED = "Lượt của bạn cho đóng góp này đã bị khoá (do admin reset, hoặc vì lần bạn rút hay đổi lượt đã phải bù điểm cho tác giả đang bị trừ điểm) nên không đổi hay rút được nữa.";
const NOT_FOUND = "Không tìm thấy contribution này.";
const ALREADY_REMOVED = "Contribution này đã bị gỡ.";
const REJECT_REASON_ERROR = "Lý do từ chối phải từ 3 đến 300 ký tự.";
const DOWN_REASON_ERROR = "Lý do không ghi nhận phải từ 3 đến 200 ký tự.";
const FLOOR_REASON = "Tự động: điểm của contribution không âm khi 👎 nhiều hơn 👍 (DEC-051)";
const COMPENSATION_REASON = "Tự động bù để điểm không âm (PROP-024)";

/** 10:00 giờ Việt Nam thứ Ba 08/09/2026 (tuần bắt đầu thứ Hai 07/09) và thứ Ba 15/09/2026 (tuần bắt đầu 14/09), cùng tháng 9. */
const LAST_WEEK = Date.UTC(2026, 8, 8, 3, 0);
const THIS_WEEK = Date.UTC(2026, 8, 15, 3, 0);

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

function countRows(context: TestContext, table: "contributions" | "contribution_events" | "contribution_votes" | "contribution_downvotes" | "contribution_interaction_xp" | "xp_events"): number
{
	return context.db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0;
}

interface FloorRow
{
	id: number;
	amount: number;
	voided_at: number | null;
}

/** Mọi event sàn (nguồn 'vote', không actor) của contribution, cũ nhất trước, kể cả đã huỷ. */
function floorEvents(context: TestContext, contributionId: number): FloorRow[]
{
	return context.db.prepare<[string, string], FloorRow>(`
		SELECT id, amount, voided_at FROM contribution_events
		WHERE guild_id = ? AND reference_id = ? AND source = 'vote' AND actor_id IS NULL ORDER BY id`).all(GUILD, String(contributionId));
}

function activeFloorAmounts(context: TestContext, contributionId: number): number[]
{
	return floorEvents(context, contributionId).filter(row => row.voided_at === null).map(row => row.amount);
}

function floorEventId(context: TestContext, contributionId: number): number | null | undefined
{
	return context.db.prepare<[number], { floor_event_id: number | null }>("SELECT floor_event_id FROM contributions WHERE id = ?").get(contributionId)?.floor_event_id;
}

/** Đọc thẳng bảng tổng team, vì teamTotals chỉ trả team có tổng > 0 nên không thấy được tổng âm. */
function rawTeamTotal(context: TestContext, roleId: string): number
{
	return context.db.prepare<[string, string], { total: number }>("SELECT total FROM contribution_team_totals WHERE guild_id = ? AND role_id = ?")
		.get(GUILD, roleId)?.total ?? 0;
}

function eventTeams(context: TestContext, table: "contribution_event_teams" | "xp_event_teams", eventId: number): string[]
{
	return context.db.prepare<[number], { role_id: string }>(`SELECT role_id FROM ${table} WHERE event_id = ? ORDER BY role_id`)
		.all(eventId)
		.map(row => row.role_id);
}

function compensationAmounts(context: TestContext, userId: string): number[]
{
	return context.deps.contributionLedger.recent(GUILD, userId, 200)
		.filter(event => event.reason === COMPENSATION_REASON && event.voidedAt === null)
		.reverse()
		.map(event => event.amount);
}

function setPoints(context: TestContext, points: number): void
{
	context.deps.guildConfig.updateSettings(GUILD, { contributionVotePoints: points }, ADMIN);
}

/** Mô hình tham chiếu: lượt hiện có của từng người và số điểm của lượt lúc bấm. */
interface ModelVote
{
	kind: ContributionVoteKind;
	value: number;
}

type VoteModel = Map<string, ModelVote>;

function modelRaw(model: VoteModel): number
{
	let raw = 0;
	for (const vote of model.values()) raw += vote.kind === "up" ? vote.value : -vote.value;
	return raw;
}

function modelCount(model: VoteModel, kind: ContributionVoteKind): number
{
	return [...model.values()].filter(vote => vote.kind === kind).length;
}

/** Áp dụng thao tác vào mô hình; trả về kết quả mong đợi (current, change). */
function applyToModel(model: VoteModel, voterId: string, action: ContributionVoteAction, points: number): Pick<ContributionVoteResult, "current" | "change">
{
	const current = model.get(voterId)?.kind ?? null;
	const target = action === "withdraw" ? null : action;
	if (target === current) return { current, change: "unchanged" };
	if (target === null) model.delete(voterId);
	else model.set(voterId, { kind: target, value: points });
	return { current: target, change: current === null ? "added" : target === null ? "withdrawn" : "switched" };
}

/** Điểm, số lượt và event sàn của contribution khớp mô hình: điểm = max(0, Σ👍 − Σ👎), đúng một event sàn khi tổng âm. */
function assertMatchesModel(context: ContributionTestContext, contributionId: number, model: VoteModel, label: string): void
{
	const contribution = context.service.get(GUILD, contributionId);
	const raw = modelRaw(model);
	assert.equal(contribution?.score, Math.max(0, raw), `${label}: điểm`);
	assert.equal(contribution?.votes, modelCount(model, "up"), `${label}: số 👍`);
	assert.equal(contribution?.downvotes, modelCount(model, "down"), `${label}: số 👎`);
	assert.deepEqual(activeFloorAmounts(context, contributionId), raw < 0 ? [-raw] : [], `${label}: event sàn`);
}

function mulberry32(seed: number): () => number
{
	let state = seed >>> 0;
	return (): number =>
	{
		state = (state + 0x6D2B79F5) >>> 0;
		let mixed = state;
		mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
		mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
	};
}

function permutations<T>(items: readonly T[]): T[][]
{
	if (items.length <= 1) return [[...items]];
	const result: T[][] = [];
	items.forEach((item, index) =>
	{
		const rest = [...items.slice(0, index), ...items.slice(index + 1)];
		for (const tail of permutations(rest)) result.push([item, ...tail]);
	});
	return result;
}

describe("Contribution DEC-051: kênh contribution", () =>
{
	test("chưa chọn kênh thì không gửi được; chọn rồi mới gửi được; bỏ chọn thì lại chặn; mỗi guild cấu hình riêng", () =>
	{
		const context = createTestContext();
		const service = new ContributionService(context.db, context.deps);
		assert.throws(() => service.submit(contributionInput()), userError(NO_CHANNEL));
		assert.throws(() => service.submit(contributionInput({ sourceMessageId: "700000000000000001" })), userError(NO_CHANNEL));
		assert.equal(countRows(context, "contributions"), 0);

		enableContributions(context.deps.guildConfig, OTHER_GUILD);
		assert.throws(() => service.submit(contributionInput()), userError(NO_CHANNEL), "kênh của guild khác không mở guild này");
		assert.equal(service.submit(contributionInput({ guildId: OTHER_GUILD })).guildId, OTHER_GUILD);

		enableContributions(context.deps.guildConfig);
		assert.equal(context.deps.guildConfig.getSettings(GUILD).contributionChannelId, CONTRIBUTION_CHANNEL);
		const created = service.submit(contributionInput());
		assert.equal(created.channelId, null, "thẻ chưa đăng: tầng Discord đăng vào kênh rồi gọi attachMessage");

		context.deps.guildConfig.updateSettings(GUILD, { contributionChannelId: null }, ADMIN);
		assert.throws(() => service.submit(contributionInput()), userError(NO_CHANNEL));
		assert.equal(countRows(context, "contributions"), 2);
	});

	test("contribution mới ở trạng thái chờ duyệt, chưa bấm 👍/👎 được; không ghi event hay XP nào", () =>
	{
		const context = setupContributions();
		const { service } = context;
		const created = service.submit(contributionInput());
		assert.deepEqual(
			[created.reviewState, created.reviewedBy, created.reviewedAt, created.reviewReason, created.votes, created.downvotes, created.score],
			["pending", null, null, null, 0, 0, 0],
		);

		assert.throws(() => voteUp(service, created.id, USER_B), userError(NOT_APPROVED));
		assert.throws(() => voteDown(service, created.id, USER_B), userError(NOT_APPROVED));
		assert.throws(() => withdrawVote(service, created.id, USER_B), userError(NOT_APPROVED));
		assert.deepEqual(service.voterState(GUILD, created.id, USER_B), { current: null, locked: false });
		assert.equal(countRows(context, "contribution_events"), 0);
		assert.equal(countRows(context, "contribution_interaction_xp"), 0);
		assert.equal(countRows(context, "xp_events"), 0);
		assert.deepEqual(service.listVoters(GUILD, created.id), []);
	});
});

describe("Contribution DEC-051: duyệt và từ chối", () =>
{
	test("duyệt: mở 👍/👎, lưu người và lúc duyệt, ghi audit contribution.approve (target = tác giả)", () =>
	{
		const context = setupContributions();
		const { service, deps, clock } = context;
		const created = service.submit(contributionInput({ submittedBy: USER_C }));
		clock.advanceSeconds(30);

		const approved = service.approve(GUILD, created.id, REVIEWER);
		assert.deepEqual(
			[approved.reviewState, approved.reviewedBy, approved.reviewedAt, approved.reviewReason],
			["approved", REVIEWER, clock.now(), null],
		);
		assert.deepEqual(service.get(GUILD, created.id), approved);

		const [entry] = deps.audit.list(GUILD, 1);
		assert.deepEqual(
			[entry.action, entry.actorId, entry.targetId, entry.details],
			["contribution.approve", REVIEWER, USER_A, { contributionId: created.id, title: created.title }],
		);

		assert.equal(voteUp(service, created.id, USER_B).current, "up");
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);
	});

	test("người duyệt duyệt hoặc từ chối được contribution của chính mình; audit ghi người duyệt", () =>
	{
		const context = setupContributions();
		const { service, deps } = context;
		const own = service.submit(contributionInput({ authorId: REVIEWER, submittedBy: REVIEWER }));
		assert.equal(service.approve(GUILD, own.id, REVIEWER).reviewedBy, REVIEWER);
		assert.deepEqual([deps.audit.list(GUILD, 1)[0].actorId, deps.audit.list(GUILD, 1)[0].targetId], [REVIEWER, REVIEWER]);
		assert.throws(() => voteUp(service, own.id, REVIEWER), userError(SELF_VOTE), "duyệt bài mình không có nghĩa là tự ghi nhận được");

		const ownRejected = service.submit(contributionInput({ authorId: REVIEWER, submittedBy: REVIEWER, title: "Bài thứ hai" }));
		assert.equal(service.reject(GUILD, ownRejected.id, REVIEWER, "Trùng bài trước").reviewState, "rejected");
	});

	test("từ chối: lý do bắt buộc 3–300 ký tự (code point, sau khi trim); lưu lý do; audit contribution.reject; không bấm được", () =>
	{
		const context = setupContributions();
		const { service, deps, clock } = context;
		const created = service.submit(contributionInput());
		const auditBefore = deps.audit.list(GUILD, 100).length;

		for (const reason of ["", "   ", "ab", "  ab  ", "😀😀", "x".repeat(301), "😀".repeat(301)])
		{
			assert.throws(() => service.reject(GUILD, created.id, REVIEWER, reason), userError(REJECT_REASON_ERROR), `lý do "${reason.slice(0, 10)}"`);
		}
		assert.equal(service.get(GUILD, created.id)?.reviewState, "pending", "lý do sai thì không đổi gì");
		assert.equal(deps.audit.list(GUILD, 100).length, auditBefore);

		clock.advanceSeconds(5);
		const rejected = service.reject(GUILD, created.id, REVIEWER, "  Chưa có kết quả đo được  ");
		assert.deepEqual(
			[rejected.reviewState, rejected.reviewedBy, rejected.reviewedAt, rejected.reviewReason],
			["rejected", REVIEWER, clock.now(), "Chưa có kết quả đo được"],
		);
		const [entry] = deps.audit.list(GUILD, 1);
		assert.deepEqual(
			[entry.action, entry.actorId, entry.targetId, entry.details],
			["contribution.reject", REVIEWER, USER_A, { contributionId: created.id, title: created.title, reason: "Chưa có kết quả đo được" }],
		);

		assert.throws(() => voteUp(service, created.id, USER_B), userError(REJECTED));
		assert.throws(() => voteDown(service, created.id, USER_B), userError(REJECTED));
		assert.throws(() => withdrawVote(service, created.id, USER_B), userError(REJECTED));
		assert.equal(countRows(context, "contribution_events"), 0);

		assert.equal(service.reject(GUILD, service.submit(contributionInput()).id, REVIEWER, "abc").reviewReason, "abc");
		assert.equal(service.reject(GUILD, service.submit(contributionInput()).id, REVIEWER, "😀😀😀").reviewReason, "😀😀😀");
		assert.equal(service.reject(GUILD, service.submit(contributionInput()).id, REVIEWER, "😀".repeat(300)).reviewReason, "😀".repeat(300));
	});

	test("duyệt lại, từ chối lại, duyệt bài đã từ chối, bài đã gỡ, bài không tồn tại hay của guild khác đều báo lỗi", () =>
	{
		const context = setupContributions([GUILD, OTHER_GUILD]);
		const { service, deps } = context;
		const approved = submitApproved(service, contributionInput());
		const rejected = service.submit(contributionInput({ title: "Bị từ chối" }));
		service.reject(GUILD, rejected.id, REVIEWER, "Không phải đóng góp");
		const removed = service.submit(contributionInput({ title: "Bị gỡ khi đang chờ" }));
		service.remove(GUILD, removed.id, ADMIN);
		const auditBefore = deps.audit.list(GUILD, 100).length;

		assert.throws(() => service.approve(GUILD, approved.id, REVIEWER), userError(`Đóng góp #${approved.id} đã được duyệt.`));
		assert.throws(() => service.reject(GUILD, approved.id, REVIEWER, "Đổi ý"), userError(`Đóng góp #${approved.id} đã được duyệt.`));
		assert.throws(() => service.approve(GUILD, rejected.id, REVIEWER), userError(`Đóng góp #${rejected.id} đã bị từ chối.`));
		assert.throws(() => service.reject(GUILD, rejected.id, REVIEWER, "Lần nữa"), userError(`Đóng góp #${rejected.id} đã bị từ chối.`));
		assert.throws(() => service.approve(GUILD, removed.id, REVIEWER), userError(ALREADY_REMOVED));
		assert.throws(() => service.reject(GUILD, removed.id, REVIEWER, "Đã gỡ rồi"), userError(ALREADY_REMOVED));
		assert.throws(() => service.approve(GUILD, 999, REVIEWER), userError(NOT_FOUND));
		assert.throws(() => service.approve(OTHER_GUILD, approved.id, REVIEWER), userError(NOT_FOUND));
		assert.throws(() => service.reject(OTHER_GUILD, rejected.id, REVIEWER, "Guild khác"), userError(NOT_FOUND));

		assert.equal(deps.audit.list(GUILD, 100).length, auditBefore, "thao tác lỗi không ghi audit");
		assert.equal(service.get(GUILD, rejected.id)?.reviewReason, "Không phải đóng góp");
		assert.equal(service.get(GUILD, approved.id)?.reviewedBy, ADMIN);
	});

	test("admin vẫn gỡ được contribution chờ duyệt hoặc bị từ chối", () =>
	{
		const context = setupContributions();
		const { service, deps } = context;
		const pending = service.submit(contributionInput());
		const rejected = service.submit(contributionInput({ title: "Bị từ chối" }));
		service.reject(GUILD, rejected.id, REVIEWER, "Không phải đóng góp");

		assert.equal(service.remove(GUILD, pending.id, ADMIN).status, "removed");
		const removedRejected = service.remove(GUILD, rejected.id, ADMIN);
		assert.deepEqual([removedRejected.status, removedRejected.reviewState], ["removed", "rejected"]);
		assert.deepEqual(deps.audit.list(GUILD, 2).map(entry => entry.action), ["contribution.remove", "contribution.remove"]);
	});

	test("tin nhắn nguồn: bài chờ duyệt hay đã duyệt chặn gửi trùng; bài bị từ chối thì gửi lại được thành contribution mới", () =>
	{
		const SOURCE = "700000000000000001";
		const context = setupContributions();
		const { service } = context;
		const first = service.submit(contributionInput({ authorId: USER_B, sourceMessageId: SOURCE }));
		assert.throws(() => service.submit(contributionInput({ authorId: USER_B, sourceMessageId: SOURCE })), userError(`Tin nhắn này đã được ghi nhận thành đóng góp #${first.id}.`));

		service.reject(GUILD, first.id, REVIEWER, "Thiếu mô tả");
		const second = service.submit(contributionInput({ authorId: USER_B, sourceMessageId: SOURCE, description: "Mô tả đầy đủ hơn." }));
		assert.notEqual(second.id, first.id);
		assert.equal(second.reviewState, "pending");

		service.approve(GUILD, second.id, REVIEWER);
		assert.throws(() => service.submit(contributionInput({ authorId: USER_B, sourceMessageId: SOURCE })), userError(`Tin nhắn này đã được ghi nhận thành đóng góp #${second.id}.`));
		assert.equal(countRows(context, "contributions"), 2);
	});
});

describe("Contribution DEC-051: 👍 Ghi nhận / 👎 Không ghi nhận", () =>
{
	test("👍 và 👎 loại trừ nhau: đổi, rút, bấm lại; số lượt và điểm theo lượt hiện có", () =>
	{
		const context = setupContributions();
		const { service, deps } = context;
		const { id } = submitApproved(service, contributionInput());

		const down = voteDown(service, id, USER_B);
		assert.deepEqual([down.current, down.change, down.locked], ["down", "added", false]);
		assert.deepEqual([down.contribution.votes, down.contribution.downvotes, down.contribution.score], [0, 1, 0]);
		assert.deepEqual(service.voterState(GUILD, id, USER_B), { current: "down", locked: false });

		const up = voteUp(service, id, USER_B);
		assert.deepEqual([up.current, up.change, up.locked], ["up", "switched", false]);
		assert.deepEqual([up.contribution.votes, up.contribution.downvotes, up.contribution.score], [1, 0, 1]);
		assert.equal(countRows(context, "contribution_downvotes"), 0, "đổi sang 👍 thì bỏ dòng 👎");

		const backDown = voteDown(service, id, USER_B, { reason: "Đổi ý sau khi đọc kỹ" });
		assert.deepEqual([backDown.current, backDown.change], ["down", "switched"]);
		assert.deepEqual([backDown.contribution.votes, backDown.contribution.downvotes, backDown.contribution.score], [0, 1, 0]);
		assert.equal(countRows(context, "contribution_votes"), 0, "đổi sang 👎 thì bỏ dòng 👍");

		const withdrawn = withdrawVote(service, id, USER_B);
		assert.deepEqual([withdrawn.current, withdrawn.change, withdrawn.locked], [null, "withdrawn", false]);
		assert.deepEqual([withdrawn.contribution.votes, withdrawn.contribution.downvotes, withdrawn.contribution.score], [0, 0, 0]);
		assert.deepEqual(service.voterState(GUILD, id, USER_B), { current: null, locked: false });

		assert.equal(voteUp(service, id, USER_B).change, "added");
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);
		assert.equal(deps.contributionLedger.total(GUILD, USER_B), 0);
	});

	test("event của lượt: 👍 dương, 👎 âm bằng điểm mỗi lượt lúc bấm, nguồn vote, actor là người bấm, reference là contribution", () =>
	{
		const context = setupContributions();
		const { service, deps } = context;
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		const { id } = submitApproved(service, contributionInput({ authorRoleIds: [ROLE_BACKEND] }));
		setPoints(context, 2);
		voteUp(service, id, USER_B);
		voteDown(service, id, USER_C);
		const [downEvent, upEvent] = deps.contributionLedger.recent(GUILD, USER_A, 5);
		assert.deepEqual(
			[downEvent.amount, downEvent.source, downEvent.actorId, downEvent.referenceId, downEvent.userId],
			[-2, "vote", USER_C, String(id), USER_A],
		);
		assert.deepEqual([upEvent.amount, upEvent.actorId], [2, USER_B]);
		assert.deepEqual(eventTeams(context, "contribution_event_teams", downEvent.id), [ROLE_BACKEND], "👎 cũng theo snapshot team của tác giả");
		assert.equal(rawTeamTotal(context, ROLE_BACKEND), 0);
	});

	test("bấm đúng lượt đang có, hoặc rút khi chưa có lượt: unchanged, không ghi gì, không đổi lý do", () =>
	{
		const context = setupContributions();
		const { service } = context;
		const { id } = submitApproved(service, contributionInput());
		voteUp(service, id, USER_B);
		voteDown(service, id, USER_C, { reason: "Lý do ban đầu" });
		const events = countRows(context, "contribution_events");
		const xpEvents = countRows(context, "xp_events");

		const sameUp = voteUp(service, id, USER_B);
		assert.deepEqual(
			[sameUp.current, sameUp.change, sameUp.locked, sameUp.xpAwarded, sameUp.xpCapped, sameUp.xpRevoked],
			["up", "unchanged", false, 0, false, 0],
		);
		const sameDown = voteDown(service, id, USER_C, { reason: "Lý do khác hẳn" });
		assert.deepEqual([sameDown.current, sameDown.change], ["down", "unchanged"]);
		const nothing = withdrawVote(service, id, USER_D);
		assert.deepEqual([nothing.current, nothing.change, nothing.xpRevoked], [null, "unchanged", 0]);

		assert.equal(countRows(context, "contribution_events"), events);
		assert.equal(countRows(context, "xp_events"), xpEvents);
		assert.equal(service.listVoters(GUILD, id).find(voter => voter.userId === USER_C)?.reason, "Lý do ban đầu");
		assert.deepEqual(service.voterState(GUILD, id, USER_D), { current: null, locked: false });
	});

	test("👎 bắt buộc lý do 3–200 ký tự (trim, code point); lý do sai thì không đổi gì, kể cả khi đang 👍", () =>
	{
		const context = setupContributions();
		const { service } = context;
		const { id } = submitApproved(service, contributionInput());
		voteUp(service, id, USER_B);
		const events = countRows(context, "contribution_events");
		const xpEvents = countRows(context, "xp_events");

		for (const reason of [null, "", "  ", "ab", "  ab ", "😀😀", "x".repeat(201), "😀".repeat(201)])
		{
			assert.throws(() => voteDown(service, id, USER_C, { reason }), userError(DOWN_REASON_ERROR));
			assert.throws(() => voteDown(service, id, USER_B, { reason }), userError(DOWN_REASON_ERROR));
		}
		assert.deepEqual(service.voterState(GUILD, id, USER_B), { current: "up", locked: false }, "lượt 👍 cũ giữ nguyên");
		assert.deepEqual(service.voterState(GUILD, id, USER_C), { current: null, locked: false });
		assert.equal(countRows(context, "contribution_events"), events);
		assert.equal(countRows(context, "xp_events"), xpEvents);

		voteDown(service, id, USER_C, { reason: "  Thiếu số liệu đo  " });
		voteDown(service, id, USER_D, { reason: "😀😀😀" });
		voteDown(service, id, USER_E, { reason: "x".repeat(200) });
		const reasons = service.listVoters(GUILD, id).filter(voter => voter.kind === "down").map(voter => voter.reason);
		assert.deepEqual(reasons, ["Thiếu số liệu đo", "😀😀😀", "x".repeat(200)]);

		voteUp(service, id, USER_F, { reason: "bỏ qua với 👍" });
		assert.equal(service.listVoters(GUILD, id).find(voter => voter.userId === USER_F)?.reason, null);
	});

	test("không tự bấm 👍/👎 hay rút trên contribution mình là tác giả; người gửi hộ bấm được", () =>
	{
		const context = setupContributions();
		const { service } = context;
		const { id } = submitApproved(service, contributionInput({ submittedBy: USER_B }));
		for (const action of ["up", "down", "withdraw"] as const)
		{
			assert.throws(() => castVote(service, id, USER_A, action, { reason: DOWN_REASON }), userError(SELF_VOTE));
		}
		assert.equal(countRows(context, "contribution_events"), 0);
		assert.equal(voteDown(service, id, USER_B).current, "down");
	});

	test("contribution không tồn tại, của guild khác, đã gỡ; thao tác lạ lúc chạy đều báo lỗi", () =>
	{
		const context = setupContributions([GUILD, OTHER_GUILD]);
		const { service } = context;
		const { id } = submitApproved(service, contributionInput());
		assert.throws(() => voteUp(service, 999, USER_B), userError(NOT_FOUND));
		assert.throws(() => voteDown(service, id, USER_B, { guildId: OTHER_GUILD }), userError(NOT_FOUND));
		const valid: ContributionVoteInput = { guildId: GUILD, contributionId: id, voterId: USER_B, action: "up", reason: null, voterRoleIds: [], systemActorId: BOT_ID };
		assert.throws(() => service.vote(Object.assign(valid, { action: "sideways" })), userError("Thao tác không hợp lệ."));

		service.remove(GUILD, id, ADMIN);
		assert.throws(() => voteDown(service, id, USER_B), userError(ALREADY_REMOVED));
		assert.equal(countRows(context, "contribution_events"), 0);
	});

	test("điểm mỗi lượt bằng 0: lượt vẫn được đếm, điểm không đổi", () =>
	{
		const context = setupContributions();
		const { service, deps } = context;
		const { id } = submitApproved(service, contributionInput());
		voteUp(service, id, USER_B);
		setPoints(context, 0);
		const down = voteDown(service, id, USER_C);
		assert.deepEqual([down.contribution.votes, down.contribution.downvotes, down.contribution.score], [1, 1, 1]);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);
		assert.deepEqual(activeFloorAmounts(context, id), []);
	});
});

describe("Contribution DEC-051: điểm = max(0, Σ👍 − Σ👎)", () =>
{
	interface Step
	{
		voterId: string;
		action: ContributionVoteAction;
		points: number;
	}

	test("mọi thứ tự của 5 thao tác (kể cả đổi lượt và điểm mỗi lượt đổi giữa các lượt) cho đúng điểm sau từng bước", () =>
	{
		const context = setupContributions();
		const { service, deps } = context;
		deps.guildConfig.updateSettings(GUILD, { contributionInteractionXpDailyCap: 0 }, ADMIN);
		const steps: Step[] = [
			{ voterId: USER_B, action: "up", points: 3 },
			{ voterId: USER_C, action: "down", points: 1 },
			{ voterId: USER_D, action: "down", points: 2 },
			{ voterId: USER_E, action: "up", points: 1 },
			{ voterId: USER_C, action: "up", points: 2 },
		];
		let expectedAuthorTotal = 0;
		const orders = permutations(steps);
		assert.equal(orders.length, 120);
		for (const [index, order] of orders.entries())
		{
			const { id } = submitApproved(service, contributionInput({ title: `Hoán vị ${index}` }));
			const model: VoteModel = new Map();
			for (const step of order)
			{
				setPoints(context, step.points);
				const expected = applyToModel(model, step.voterId, step.action, step.points);
				const result = castVote(service, id, step.voterId, step.action, { reason: DOWN_REASON });
				assert.deepEqual([result.current, result.change, result.locked], [expected.current, expected.change, false], `hoán vị ${index}`);
				assert.equal(result.contribution.score, Math.max(0, modelRaw(model)), `hoán vị ${index}`);
				assertMatchesModel(context, id, model, `hoán vị ${index}`);
			}
			expectedAuthorTotal += Math.max(0, modelRaw(model));
			assert.equal(deps.contributionLedger.total(GUILD, USER_A), expectedAuthorTotal, `hoán vị ${index}: tổng tác giả = tổng điểm các contribution`);
		}
		assert.deepEqual(compensationAmounts(context, USER_A), [], "không có admin trừ điểm thì không bao giờ cần bù");
	});

	test("thao tác ngẫu nhiên (có seed): điểm, số lượt, event sàn, tổng tác giả, tổng team và XP người bấm luôn khớp mô hình", () =>
	{
		const voters = [USER_B, USER_C, USER_D, USER_E, USER_F];
		const actions: ContributionVoteAction[] = ["up", "down", "withdraw"];
		for (const seed of [1, 42, 2026])
		{
			const context = setupContributions();
			const { service, deps } = context;
			deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
			const { id } = submitApproved(service, contributionInput({ authorRoleIds: [ROLE_BACKEND] }));
			const random = mulberry32(seed);
			const model: VoteModel = new Map();
			let points = 1;
			for (let step = 0; step < 200; step++)
			{
				if (random() < 0.15)
				{
					points = Math.floor(random() * 4);
					setPoints(context, points);
				}
				const voterId = voters[Math.floor(random() * voters.length)];
				const action = actions[Math.floor(random() * actions.length)];
				const label = `seed ${seed}, bước ${step}`;
				const expected = applyToModel(model, voterId, action, points);
				const result = castVote(service, id, voterId, action, { reason: DOWN_REASON });
				assert.deepEqual([result.current, result.change, result.locked], [expected.current, expected.change, false], label);
				assertMatchesModel(context, id, model, label);
				const score = Math.max(0, modelRaw(model));
				assert.equal(deps.contributionLedger.total(GUILD, USER_A), score, `${label}: tổng tác giả`);
				assert.equal(rawTeamTotal(context, ROLE_BACKEND), score, `${label}: tổng team không âm`);
				assert.equal(deps.xpLedger.total(GUILD, voterId), model.has(voterId) ? 5 : 0, `${label}: XP người bấm`);
				assert.deepEqual(service.voterState(GUILD, id, voterId), { current: model.get(voterId)?.kind ?? null, locked: false }, label);
			}
			assert.ok(floorEvents(context, id).length > 0, `seed ${seed}: kịch bản có đi qua trạng thái âm`);
		}
	});

	test("event sàn: có đúng một event còn hiệu lực khi tổng âm, bằng phần âm, theo snapshot team; huỷ (không xoá) khi không cần", () =>
	{
		const context = setupContributions();
		const { service, deps } = context;
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		const { id } = submitApproved(service, contributionInput({ authorRoleIds: [ROLE_BACKEND] }));
		const assertFloor = (amounts: number[], label: string): void =>
		{
			assert.deepEqual(activeFloorAmounts(context, id), amounts, label);
			assert.equal(deps.contributionLedger.total(GUILD, USER_A), service.get(GUILD, id)?.score, `${label}: tổng tác giả = điểm contribution`);
			assert.ok(rawTeamTotal(context, ROLE_BACKEND) >= 0, `${label}: tổng team không âm`);
		};

		voteUp(service, id, USER_B);
		voteDown(service, id, USER_C);
		assertFloor([], "1 👍 1 👎: tổng 0, chưa cần sàn");
		assert.equal(floorEventId(context, id), null);

		voteDown(service, id, USER_D);
		assertFloor([1], "tổng −1");
		const [first] = floorEvents(context, id);
		const firstEvent = deps.contributionLedger.getEvent(first.id);
		assert.deepEqual(
			[firstEvent?.source, firstEvent?.actorId, firstEvent?.referenceId, firstEvent?.userId, firstEvent?.reason],
			["vote", null, String(id), USER_A, FLOOR_REASON],
		);
		assert.deepEqual(eventTeams(context, "contribution_event_teams", first.id), [ROLE_BACKEND]);
		assert.equal(floorEventId(context, id), first.id);

		setPoints(context, 2);
		voteDown(service, id, USER_E);
		assertFloor([3], "tổng −3: sàn cũ bị huỷ, sàn mới bằng 3");
		withdrawVote(service, id, USER_B);
		assertFloor([4], "rút 👍: tổng −4");
		voteDown(service, id, USER_F);
		voteDown(service, id, USER_F);
		assertFloor([6], "bấm lại đúng 👎 không đổi gì");

		for (const voterId of [USER_C, USER_D, USER_E, USER_F]) withdrawVote(service, id, voterId);
		assertFloor([], "rút hết 👎: không còn sàn");
		assert.equal(floorEventId(context, id), null);
		const history = floorEvents(context, id);
		assert.deepEqual(history.map(row => row.amount), [1, 3, 4, 6, 5, 4, 2], "mọi event sàn cũ còn nguyên, đã huỷ");
		assert.ok(history.every(row => row.voided_at !== null));
		assert.deepEqual(compensationAmounts(context, USER_A), []);
	});

	test("👎 không trừ sang contribution khác của cùng tác giả", () =>
	{
		const context = setupContributions();
		const { service, deps } = context;
		const good = submitApproved(service, contributionInput({ title: "Đóng góp tốt" }));
		const weak = submitApproved(service, contributionInput({ title: "Đóng góp yếu" }));
		voteUp(service, good.id, USER_B);
		voteUp(service, good.id, USER_C);
		for (const voterId of [USER_B, USER_C, USER_D]) voteDown(service, weak.id, voterId);

		assert.equal(service.get(GUILD, good.id)?.score, 2);
		assert.deepEqual([service.get(GUILD, weak.id)?.score, service.get(GUILD, weak.id)?.downvotes], [0, 3]);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 2);
		assert.equal(service.getProfile(GUILD, USER_A).score, 2);
	});

	test("điểm theo kỳ: trong một kỳ bằng đúng điểm contribution (không âm); qua kỳ chỉ mất đúng phần đã có, bảng kỳ không hiện số âm", () =>
	{
		const context = setupContributions();
		const { service, deps, clock } = context;
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		const board = new LeaderboardService(deps);
		const standing = (period: "week" | "month"): { rank: number | null; value: number } =>
		{
			const { rank, value } = board.userStanding(GUILD, "contribution", period, USER_A);
			return { rank, value };
		};

		clock.current = THIS_WEEK;
		const same = submitApproved(service, contributionInput({ authorRoleIds: [ROLE_BACKEND] }));
		for (const voterId of [USER_B, USER_C, USER_D]) voteDown(service, same.id, voterId);
		assert.deepEqual(standing("week"), { rank: null, value: 0 }, "chỉ có 👎 trong kỳ: 0 chứ không phải −3");
		voteUp(service, same.id, USER_E);
		voteUp(service, same.id, USER_F);
		assert.deepEqual(standing("week"), { rank: null, value: 0 });
		voteUp(service, same.id, USER_G);
		withdrawVote(service, same.id, USER_B);
		assert.equal(service.get(GUILD, same.id)?.score, 1);
		assert.deepEqual(standing("week"), { rank: 1, value: 1 });
		assert.deepEqual(standing("month"), { rank: 1, value: 1 });
		assert.deepEqual(board.query({ guildId: GUILD, kind: "contribution", scope: "team", period: "week", page: 1 }).entries, [{ rank: 1, id: ROLE_BACKEND, value: 1 }]);

		const crossContext = setupContributions();
		const crossBoard = new LeaderboardService(crossContext.deps);
		crossContext.clock.current = LAST_WEEK;
		const cross = submitApproved(crossContext.service, contributionInput());
		voteUp(crossContext.service, cross.id, USER_B);
		voteUp(crossContext.service, cross.id, USER_C);
		crossContext.clock.current = THIS_WEEK;
		for (const voterId of [USER_D, USER_E, USER_F]) voteDown(crossContext.service, cross.id, voterId);
		assert.equal(crossContext.service.get(GUILD, cross.id)?.score, 0);
		const week = crossBoard.userStanding(GUILD, "contribution", "week", USER_A);
		assert.deepEqual([week.rank, week.value], [null, -2], "tuần này mất đúng 2 điểm đã có (2 → 0), không phải −3");
		assert.deepEqual(crossBoard.query({ guildId: GUILD, kind: "contribution", scope: "individual", period: "week", page: 1 }).entries, []);
		const month = crossBoard.userStanding(GUILD, "contribution", "month", USER_A);
		assert.deepEqual([month.rank, month.value], [null, 0], "cả tháng: bằng điểm hiện có");
		assert.equal(crossContext.deps.contributionLedger.total(GUILD, USER_A), 0);
	});
});

describe("Contribution DEC-051: khoá lượt khi phải bù cho tác giả đang bị trừ điểm (PROP-024, PROP-031)", () =>
{
	/** Contribution của USER_A có 👍 của B và C; admin trừ 2 điểm nên tổng của tác giả là 0. */
	function penalized(): ContributionTestContext & { id: number }
	{
		const context = setupContributions();
		const { id } = submitApproved(context.service, contributionInput());
		voteUp(context.service, id, USER_B);
		voteUp(context.service, id, USER_C);
		context.service.adjust({ guildId: GUILD, userId: USER_A, delta: -2, actorId: ADMIN, reason: "Trùng nội dung", roleIds: [] });
		assert.equal(context.deps.contributionLedger.total(GUILD, USER_A), 0);
		return { ...context, id };
	}

	interface LockCase
	{
		label: string;
		voterId: string;
		run: (context: ContributionTestContext, id: number) => ContributionVoteResult;
		current: ContributionVoteKind | null;
		change: ContributionVoteResult["change"];
		compensated: number;
	}

	const cases: LockCase[] = [
		{ label: "thêm 👎", voterId: USER_D, run: (context, id) => voteDown(context.service, id, USER_D), current: "down", change: "added", compensated: 1 },
		{ label: "đổi 👍 → 👎", voterId: USER_B, run: (context, id) => voteDown(context.service, id, USER_B), current: "down", change: "switched", compensated: 2 },
		{ label: "rút 👍", voterId: USER_B, run: (context, id) => withdrawVote(context.service, id, USER_B), current: null, change: "withdrawn", compensated: 1 },
	];

	for (const lockCase of cases)
	{
		test(`${lockCase.label} khi tác giả bị trừ điểm về 0: bù về 0, lượt bị khoá, không đổi hay rút được nữa`, () =>
		{
			const context = penalized();
			const { service, deps, id } = context;
			const auditBefore = deps.audit.list(GUILD, 100).length;
			const result = lockCase.run(context, id);
			assert.deepEqual([result.current, result.change, result.locked], [lockCase.current, lockCase.change, true]);
			assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
			assert.deepEqual(compensationAmounts(context, USER_A), [lockCase.compensated]);
			assert.deepEqual(service.voterState(GUILD, id, lockCase.voterId), { current: lockCase.current, locked: true });
			assert.equal(deps.audit.list(GUILD, 100).length, auditBefore, "khoá lượt không ghi audit");

			const events = countRows(context, "contribution_events");
			for (const action of ["up", "down", "withdraw"] as const)
			{
				assert.throws(() => castVote(service, id, lockCase.voterId, action, { reason: DOWN_REASON }), userError(VOTE_LOCKED), action);
			}
			assert.equal(countRows(context, "contribution_events"), events, "lượt bị khoá không ghi thêm event");
			assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0, "hình phạt của admin không bị xoá dần");

			const voter = service.listVoters(GUILD, id).find(row => row.userId === lockCase.voterId);
			assert.equal(voter?.locked, true);
			assert.equal(voter?.active, lockCase.current !== null, "rút 👍 bị khoá: dòng giữ lại, event đã huỷ");

			assert.deepEqual([voteUp(service, id, USER_E).locked, deps.contributionLedger.total(GUILD, USER_A)], [false, 1], "người khác vẫn ghi nhận được");
		});
	}

	test("rút 👎 và đổi 👎 → 👍 (tăng điểm) không bao giờ bị khoá, kể cả khi tác giả đang bị trừ điểm", () =>
	{
		const context = setupContributions();
		const { service, deps } = context;
		const { id } = submitApproved(service, contributionInput());
		for (const voterId of [USER_B, USER_C, USER_D]) voteUp(service, id, voterId);
		voteDown(service, id, USER_E);
		voteDown(service, id, USER_F);
		service.adjust({ guildId: GUILD, userId: USER_A, delta: -1, actorId: ADMIN, reason: null, roleIds: [] });
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);

		const withdrawn = withdrawVote(service, id, USER_E);
		assert.deepEqual([withdrawn.current, withdrawn.locked], [null, false]);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);
		service.adjust({ guildId: GUILD, userId: USER_A, delta: -1, actorId: ADMIN, reason: null, roleIds: [] });

		const switched = voteUp(service, id, USER_F);
		assert.deepEqual([switched.current, switched.change, switched.locked], ["up", "switched", false]);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 2);
		assert.deepEqual(service.voterState(GUILD, id, USER_E), { current: null, locked: false });
		assert.deepEqual(service.voterState(GUILD, id, USER_F), { current: "up", locked: false });

		const again = voteDown(service, id, USER_E);
		assert.deepEqual([again.current, again.locked], ["down", false], "tổng vẫn dương nên không phải bù, không khoá");
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);
		assert.deepEqual(compensationAmounts(context, USER_A), []);
	});

	test("thao tác giảm điểm mà sàn đã giữ contribution ở 0 thì không làm tổng giảm, không phải bù, không khoá", () =>
	{
		const context = setupContributions();
		const { service, deps } = context;
		const other = submitApproved(service, contributionInput({ title: "Đóng góp khác" }));
		voteUp(service, other.id, USER_F);
		voteUp(service, other.id, USER_G);
		const { id } = submitApproved(service, contributionInput());
		voteUp(service, id, USER_B);
		voteDown(service, id, USER_C);
		voteDown(service, id, USER_D);
		service.adjust({ guildId: GUILD, userId: USER_A, delta: -2, actorId: ADMIN, reason: null, roleIds: [] });
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);

		assert.equal(withdrawVote(service, id, USER_B).locked, false);
		assert.equal(voteDown(service, id, USER_E).locked, false);
		assert.deepEqual(activeFloorAmounts(context, id), [3]);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
		assert.deepEqual(compensationAmounts(context, USER_A), []);
		assert.equal(voteUp(service, id, USER_B).locked, false, "rút không bị khoá thì bấm lại được");
	});
});

describe("Contribution DEC-051: reset và gỡ", () =>
{
	test("resetUser: mọi lượt cũ (👍, 👎) và event sàn bị huỷ, lượt cũ bị khoá; lượt mới tính lại từ đầu", () =>
	{
		const context = setupContributions();
		const { service, deps } = context;
		const { id } = submitApproved(service, contributionInput());
		voteUp(service, id, USER_B);
		voteDown(service, id, USER_C);
		voteDown(service, id, USER_D);
		assert.deepEqual(activeFloorAmounts(context, id), [1]);

		assert.deepEqual(service.resetUser(GUILD, USER_A, ADMIN), { voidedEvents: 4 });
		const afterReset = service.get(GUILD, id);
		assert.deepEqual([afterReset?.votes, afterReset?.downvotes, afterReset?.score], [0, 0, 0]);
		assert.deepEqual(activeFloorAmounts(context, id), []);
		for (const voterId of [USER_B, USER_C, USER_D])
		{
			assert.deepEqual(service.voterState(GUILD, id, voterId), { current: null, locked: true });
			assert.throws(() => voteUp(service, id, voterId), userError(VOTE_LOCKED));
			assert.throws(() => withdrawVote(service, id, voterId), userError(VOTE_LOCKED));
		}
		assert.ok(service.listVoters(GUILD, id).every(voter => !voter.active && voter.locked));

		voteDown(service, id, USER_E);
		assert.deepEqual(activeFloorAmounts(context, id), [1], "sàn chỉ tính lượt còn hiệu lực");
		assert.equal(service.get(GUILD, id)?.score, 0);
		voteUp(service, id, USER_F);
		voteUp(service, id, USER_G);
		assert.deepEqual(activeFloorAmounts(context, id), []);
		assert.equal(service.get(GUILD, id)?.score, 1);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);
	});

	test("resetAll: lượt cũ bị khoá, người mới bấm được, guild khác không bị ảnh hưởng", () =>
	{
		const context = setupContributions([GUILD, OTHER_GUILD]);
		const { service, deps } = context;
		const { id } = submitApproved(service, contributionInput());
		const elsewhere = submitApproved(service, contributionInput({ guildId: OTHER_GUILD }));
		voteDown(service, id, USER_B);
		voteDown(service, elsewhere.id, USER_B, { guildId: OTHER_GUILD });
		service.resetAll(GUILD, ADMIN);

		assert.throws(() => voteUp(service, id, USER_B), userError(VOTE_LOCKED));
		assert.equal(voteUp(service, id, USER_C).current, "up");
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);
		assert.deepEqual(service.voterState(GUILD, elsewhere.id, USER_B), { current: null, locked: false }, "contribution của guild khác không có trong GUILD");
		assert.equal(withdrawVote(service, elsewhere.id, USER_B, { guildId: OTHER_GUILD }).current, null);
	});

	test("gỡ contribution huỷ mọi lượt và cả event sàn; không cần bù khi sàn đang giữ 0; audit không có compensated", () =>
	{
		const context = setupContributions();
		const { service, deps } = context;
		const { id } = submitApproved(service, contributionInput());
		voteUp(service, id, USER_B);
		for (const voterId of [USER_C, USER_D, USER_E]) voteDown(service, id, voterId);
		assert.deepEqual(activeFloorAmounts(context, id), [2]);

		const removed = service.remove(GUILD, id, ADMIN);
		assert.deepEqual([removed.status, removed.votes, removed.downvotes, removed.score], ["removed", 0, 0, 0]);
		assert.deepEqual(activeFloorAmounts(context, id), []);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
		assert.deepEqual(compensationAmounts(context, USER_A), []);
		assert.deepEqual(deps.audit.list(GUILD, 1)[0].details, { contributionId: id, title: removed.title });
		assert.equal(countRows(context, "contribution_downvotes"), 3, "dòng 👎 vẫn giữ để truy vết");
		assert.throws(() => voteUp(service, id, USER_F), userError(ALREADY_REMOVED));
		assert.throws(() => withdrawVote(service, id, USER_C), userError(ALREADY_REMOVED));
	});

	test("gỡ contribution có 👎 khi tác giả bị admin trừ điểm: bù đúng phần âm (PROP-024)", () =>
	{
		const context = setupContributions();
		const { service, deps } = context;
		const { id } = submitApproved(service, contributionInput());
		for (const voterId of [USER_B, USER_C, USER_D]) voteUp(service, id, voterId);
		voteDown(service, id, USER_E);
		service.adjust({ guildId: GUILD, userId: USER_A, delta: -2, actorId: ADMIN, reason: null, roleIds: [] });

		service.remove(GUILD, id, ADMIN);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
		assert.deepEqual(compensationAmounts(context, USER_A), [2]);
		assert.deepEqual(deps.audit.list(GUILD, 1)[0].details, { contributionId: id, title: "Tối ưu build", compensated: 2 });
	});
});

describe("Contribution DEC-051: XP cho người bấm", () =>
{
	interface XpRow
	{
		id: number;
		amount: number;
		source: string;
		actor_id: string | null;
		reference_id: string | null;
		voided_at: number | null;
	}

	function xpEvents(context: TestContext, userId: string): XpRow[]
	{
		return context.db.prepare<[string, string], XpRow>("SELECT id, amount, source, actor_id, reference_id, voided_at FROM xp_events WHERE guild_id = ? AND user_id = ? ORDER BY id")
			.all(GUILD, userId);
	}

	test("+contributionInteractionXp một lần mỗi contribution (👍 hay 👎 như nhau); nguồn admin, actor là bot, reference contribution:<id>, team theo role người bấm", () =>
	{
		const context = setupContributions();
		const { service, deps } = context;
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		const first = submitApproved(service, contributionInput());
		const second = submitApproved(service, contributionInput({ title: "Thứ hai" }));

		const up = voteUp(service, first.id, USER_B, { voterRoleIds: [ROLE_BACKEND, ROLE_OTHER] });
		assert.deepEqual([up.xpAwarded, up.xpCapped, up.xpRevoked], [5, false, 0]);
		const down = voteDown(service, second.id, USER_B, { voterRoleIds: [ROLE_BACKEND] });
		assert.deepEqual([down.xpAwarded, down.xpCapped], [5, false]);

		const events = xpEvents(context, USER_B);
		assert.deepEqual(events.map(row => [row.amount, row.source, row.actor_id, row.reference_id, row.voided_at]), [
			[5, "admin", BOT_ID, `contribution:${first.id}`, null],
			[5, "admin", BOT_ID, `contribution:${second.id}`, null],
		]);
		assert.deepEqual(eventTeams(context, "xp_event_teams", events[0].id), [ROLE_BACKEND]);
		assert.deepEqual(deps.xpLedger.teamTotals(GUILD, 10), [{ id: ROLE_BACKEND, total: 10 }]);
		assert.equal(deps.xpLedger.total(GUILD, USER_B), 10);
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 0, "tác giả không nhận XP người bấm");
	});

	test("đổi 👍↔👎 giữ XP; rút thì thu lại; bấm lại sau khi rút thì được lại", () =>
	{
		const context = setupContributions();
		const { service, deps } = context;
		const { id } = submitApproved(service, contributionInput());
		voteUp(service, id, USER_B);

		const switched = voteDown(service, id, USER_B);
		assert.deepEqual([switched.xpAwarded, switched.xpRevoked], [0, 0]);
		assert.equal(voteUp(service, id, USER_B).xpAwarded, 0);
		assert.equal(xpEvents(context, USER_B).length, 1, "đổi lượt không ghi event XP mới");
		assert.equal(deps.xpLedger.total(GUILD, USER_B), 5);

		const withdrawn = withdrawVote(service, id, USER_B);
		assert.deepEqual([withdrawn.xpAwarded, withdrawn.xpRevoked], [0, 5]);
		assert.equal(deps.xpLedger.total(GUILD, USER_B), 0);
		assert.notEqual(xpEvents(context, USER_B)[0].voided_at, null, "event XP bị huỷ, không xoá");
		assert.equal(countRows(context, "contribution_interaction_xp"), 0);

		const again = voteDown(service, id, USER_B);
		assert.deepEqual([again.xpAwarded, again.xpCapped], [5, false]);
		assert.equal(deps.xpLedger.total(GUILD, USER_B), 5);
		assert.equal(xpEvents(context, USER_B).length, 2);
	});

	test("hạn mức ngày theo giờ Việt Nam: cắt phần vượt (xpCapped), không cộng bù khi đổi lượt; rút trả lại hạn mức; sang ngày mới có lại", () =>
	{
		const context = setupContributions();
		const { service, deps, clock } = context;
		deps.guildConfig.updateSettings(GUILD, { contributionInteractionXp: 10, contributionInteractionXpDailyCap: 25 }, ADMIN);
		clock.current = Date.UTC(2026, 0, 1, 1, 0);
		const ids = Array.from({ length: 7 }, (_, index) => submitApproved(service, contributionInput({ title: `Đóng góp ${index}` })).id);
		const xp = (result: ContributionVoteResult): [number, boolean] => [result.xpAwarded, result.xpCapped];

		assert.deepEqual(xp(voteUp(service, ids[0], USER_B)), [10, false]);
		assert.deepEqual(xp(voteUp(service, ids[1], USER_B)), [10, false]);
		assert.deepEqual(xp(voteUp(service, ids[2], USER_B)), [5, true]);
		assert.deepEqual(xp(voteUp(service, ids[3], USER_B)), [0, true]);
		assert.equal(deps.xpLedger.total(GUILD, USER_B), 25);
		assert.deepEqual(xp(voteDown(service, ids[3], USER_B)), [0, false], "đổi lượt không cộng bù phần bị cắt");
		assert.deepEqual(xp(voteDown(service, ids[2], USER_B)), [0, false]);

		assert.equal(withdrawVote(service, ids[0], USER_B).xpRevoked, 10);
		assert.deepEqual(xp(voteUp(service, ids[4], USER_B)), [10, false], "rút trả lại hạn mức trong ngày");
		assert.equal(deps.xpLedger.total(GUILD, USER_B), 25);

		clock.current = Date.UTC(2026, 0, 1, 16, 59, 59, 999);
		assert.deepEqual(xp(voteUp(service, ids[5], USER_B)), [0, true], "23:59:59.999 giờ Việt Nam vẫn là cùng ngày");
		assert.deepEqual(xp(voteUp(service, ids[0], USER_C)), [10, false], "hạn mức tính riêng từng người");

		clock.current = Date.UTC(2026, 0, 1, 17, 0);
		assert.deepEqual(xp(voteUp(service, ids[6], USER_B)), [10, false], "00:00 giờ Việt Nam: ngày mới");
		assert.deepEqual(xp(voteUp(service, ids[0], USER_B)), [10, false]);
		assert.deepEqual(xp(voteUp(service, ids[1], USER_D)), [10, false]);
		assert.equal(deps.xpLedger.total(GUILD, USER_B), 45);
	});

	test("cấu hình XP bằng 0 thì không có XP; hạn mức 0 là không giới hạn", () =>
	{
		const context = setupContributions();
		const { service, deps } = context;
		const ids = Array.from({ length: 7 }, (_, index) => submitApproved(service, contributionInput({ title: `Đóng góp ${index}` })).id);

		deps.guildConfig.updateSettings(GUILD, { contributionInteractionXp: 0 }, ADMIN);
		const none = voteUp(service, ids[0], USER_B);
		assert.deepEqual([none.xpAwarded, none.xpCapped, none.xpRevoked], [0, false, 0]);
		assert.equal(countRows(context, "xp_events"), 0);
		assert.deepEqual([withdrawVote(service, ids[0], USER_B).xpRevoked, countRows(context, "contribution_interaction_xp")], [0, 0]);

		deps.guildConfig.updateSettings(GUILD, { contributionInteractionXp: 5, contributionInteractionXpDailyCap: 0 }, ADMIN);
		for (const id of ids)
		{
			const result = voteUp(service, id, USER_C);
			assert.deepEqual([result.xpAwarded, result.xpCapped], [5, false]);
		}
		assert.equal(deps.xpLedger.total(GUILD, USER_C), 35);
	});

	test("XP người bấm và điểm contribution tách biệt (DEC-004): reset bên này không đụng bên kia", () =>
	{
		const context = setupContributions();
		const { service, deps } = context;
		const { id } = submitApproved(service, contributionInput());
		voteUp(service, id, USER_B);
		voteDown(service, id, USER_C);
		voteUp(service, id, USER_D);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 1);
		assert.deepEqual([USER_B, USER_C, USER_D].map(user => deps.contributionLedger.total(GUILD, user)), [0, 0, 0], "người bấm không có điểm contribution");

		deps.xpLedger.voidUser(GUILD, USER_B);
		assert.equal(service.get(GUILD, id)?.score, 1, "reset XP người bấm không đổi điểm contribution");
		assert.deepEqual(service.voterState(GUILD, id, USER_B), { current: "up", locked: false });
		assert.equal(voteDown(service, id, USER_B).xpAwarded, 0, "đã có dòng XP (dù event bị reset) thì đổi lượt không cộng lại");
		assert.equal(withdrawVote(service, id, USER_B).xpRevoked, 0, "event XP đã bị reset thì không thu lại gì");

		service.resetUser(GUILD, USER_A, ADMIN);
		assert.deepEqual([deps.xpLedger.total(GUILD, USER_C), deps.xpLedger.total(GUILD, USER_D)], [5, 5], "reset điểm contribution không đụng XP người bấm");
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 0);
	});
});

describe("Contribution DEC-051: đọc dữ liệu", () =>
{
	test("listVoters: cũ nhất trước (cùng lúc thì theo user ID), kèm loại, lý do, còn hiệu lực, bị khoá", () =>
	{
		const context = setupContributions([GUILD, OTHER_GUILD]);
		const { service, clock } = context;
		const { id } = submitApproved(service, contributionInput());
		const startedAt = clock.now();
		voteUp(service, id, USER_B);
		clock.advanceSeconds(1);
		voteUp(service, id, USER_D);
		voteDown(service, id, USER_C, { reason: "  Thiếu số liệu  " });
		clock.advanceSeconds(1);
		voteDown(service, id, USER_E);
		clock.advanceSeconds(1);
		voteUp(service, id, USER_E);
		voteUp(service, id, USER_F);
		withdrawVote(service, id, USER_F);

		const rows = (): [string, string, string | null, boolean, boolean, number][] => service.listVoters(GUILD, id)
			.map(voter => [voter.userId, voter.kind, voter.reason, voter.active, voter.locked, voter.createdAt - startedAt]);
		assert.deepEqual(rows(), [
			[USER_B, "up", null, true, false, 0],
			[USER_C, "down", "Thiếu số liệu", true, false, 1000],
			[USER_D, "up", null, true, false, 1000],
			[USER_E, "up", null, true, false, 3000],
		]);

		service.adjust({ guildId: GUILD, userId: USER_A, delta: -2, actorId: ADMIN, reason: null, roleIds: [] });
		voteDown(service, id, USER_G);
		assert.deepEqual(rows().at(-1), [USER_G, "down", DOWN_REASON, true, true, 3000], "lượt 👎 phải bù: còn hiệu lực nhưng bị khoá");

		service.resetUser(GUILD, USER_A, ADMIN);
		assert.ok(service.listVoters(GUILD, id).every(voter => !voter.active && voter.locked), "reset: mọi lượt hết hiệu lực và bị khoá");
		assert.deepEqual(service.listVoters(GUILD, 999), []);
		assert.deepEqual(service.listVoters(OTHER_GUILD, id), []);
	});

	test("listPage lọc theo trạng thái duyệt, kết hợp với trạng thái gỡ và tác giả; list bỏ bài bị từ chối; getProfile chỉ đếm bài đã duyệt", () =>
	{
		const context = setupContributions();
		const { service, clock } = context;
		const pendingA = service.submit(contributionInput({ title: "A chờ duyệt" }));
		clock.advanceSeconds(1);
		const approvedA = submitApproved(service, contributionInput({ title: "A đã duyệt" }));
		clock.advanceSeconds(1);
		const rejectedB = service.submit(contributionInput({ authorId: USER_B, title: "B bị từ chối" }));
		service.reject(GUILD, rejectedB.id, REVIEWER, "Không phải đóng góp");
		clock.advanceSeconds(1);
		const removedB = submitApproved(service, contributionInput({ authorId: USER_B, title: "B đã duyệt rồi bị gỡ" }));
		service.remove(GUILD, removedB.id, ADMIN);
		clock.advanceSeconds(1);
		const removedPendingA = service.submit(contributionInput({ title: "A chờ duyệt rồi bị gỡ" }));
		service.remove(GUILD, removedPendingA.id, ADMIN);

		const ids = (query: ContributionListQuery): number[] => service.listPage(GUILD, query).items.map(item => item.id);
		const base = { page: 1, pageSize: 20 };
		assert.deepEqual(ids({ ...base, status: "all", review: "pending" }), [removedPendingA.id, pendingA.id]);
		assert.deepEqual(ids({ ...base, status: "active", review: "pending" }), [pendingA.id]);
		assert.deepEqual(ids({ ...base, status: "all", review: "approved" }), [removedB.id, approvedA.id]);
		assert.deepEqual(ids({ ...base, status: "removed", review: "approved" }), [removedB.id]);
		assert.deepEqual(ids({ ...base, status: "all", review: "rejected" }), [rejectedB.id]);
		assert.deepEqual(ids({ ...base, status: "active", review: "all" }), [rejectedB.id, approvedA.id, pendingA.id]);
		assert.equal(service.listPage(GUILD, { ...base, status: "all" }).total, 5);
		assert.equal(service.listPage(GUILD, { ...base, status: "all", review: "all" }).total, 5);
		assert.deepEqual(ids({ ...base, status: "all", review: "approved", authorId: USER_A }), [approvedA.id]);
		const pendingPage = service.listPage(GUILD, { page: 1, pageSize: 1, status: "all", review: "pending" });
		assert.deepEqual([pendingPage.total, pendingPage.totalPages, pendingPage.items.length], [2, 2, 1]);
		assert.equal(service.listPage(GUILD, { ...base, status: "all", review: "rejected" }).items[0].reviewReason, "Không phải đóng góp");

		assert.deepEqual(service.list(GUILD, { limit: 10 }).map(item => item.id), [approvedA.id, pendingA.id], "list: còn hiệu lực, gồm chờ duyệt, bỏ bị từ chối");
		assert.deepEqual(service.list(GUILD, { authorId: USER_B, limit: 10 }), []);

		assert.equal(service.getProfile(GUILD, USER_A).contributions, 1, "chỉ bài đã duyệt còn hiệu lực");
		assert.equal(service.getProfile(GUILD, USER_B).contributions, 0);
		service.approve(GUILD, pendingA.id, REVIEWER);
		assert.equal(service.getProfile(GUILD, USER_A).contributions, 2);
	});

	test("thống kê: chỉ đếm contribution đã duyệt; lượt ghi nhận chỉ đếm 👍; tổng điểm theo max(0, 👍 − 👎)", () =>
	{
		const context = setupContributions();
		const { service, db, deps } = context;
		const stats = new StatisticsService(db, deps);
		const approved = submitApproved(service, contributionInput());
		voteUp(service, approved.id, USER_B);
		voteUp(service, approved.id, USER_C);
		voteDown(service, approved.id, USER_D);
		const negative = submitApproved(service, contributionInput({ authorId: USER_B, authorRoleIds: [ROLE_FRONTEND] }));
		voteDown(service, negative.id, USER_A);
		voteDown(service, negative.id, USER_C);
		service.submit(contributionInput({ title: "Chờ duyệt" }));
		const rejected = service.submit(contributionInput({ title: "Bị từ chối" }));
		service.reject(GUILD, rejected.id, REVIEWER, "Không phải đóng góp");

		assert.deepEqual(stats.summary(GUILD).contribution, { total: 2, last7Days: 2, votes: 2, totalScore: 1 });
	});
});
