import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestContext, GUILD, OTHER_GUILD, ROLE_BACKEND, ROLE_FRONTEND, ROLE_OTHER, USER_A, USER_B, USER_C, ADMIN } from "./helpers";

describe("Ledger", () =>
{
	test("record cộng dồn tổng và lưu snapshot team", () =>
	{
		const { deps } = createTestContext();
		const ledger = deps.xpLedger;
		const event = ledger.record({ guildId: GUILD, userId: USER_A, amount: 10, source: "message", referenceId: "c1", teamRoleIds: [ROLE_BACKEND, ROLE_BACKEND] });
		ledger.record({ guildId: GUILD, userId: USER_A, amount: 5, source: "poll" });
		assert.equal(event.amount, 10);
		assert.equal(event.voidedAt, null);
		assert.equal(ledger.total(GUILD, USER_A), 15);
		assert.equal(ledger.total(OTHER_GUILD, USER_A), 0);
	});

	test("voidEvent trừ khỏi tổng và chỉ huỷ một lần", () =>
	{
		const { deps } = createTestContext();
		const ledger = deps.xpLedger;
		const event = ledger.record({ guildId: GUILD, userId: USER_A, amount: 10, source: "message" });
		assert.ok(ledger.voidEvent(event.id)?.voidedAt);
		assert.equal(ledger.voidEvent(event.id), null);
		assert.equal(ledger.total(GUILD, USER_A), 0);
	});

	test("voidByReference, voidUser, voidGuild", () =>
	{
		const { deps } = createTestContext();
		const ledger = deps.contributionLedger;
		ledger.record({ guildId: GUILD, userId: USER_A, amount: 1, source: "vote", referenceId: "7" });
		ledger.record({ guildId: GUILD, userId: USER_A, amount: 1, source: "vote", referenceId: "7" });
		ledger.record({ guildId: GUILD, userId: USER_A, amount: 1, source: "vote", referenceId: "8" });
		ledger.record({ guildId: GUILD, userId: USER_B, amount: 4, source: "admin" });
		ledger.record({ guildId: OTHER_GUILD, userId: USER_B, amount: 9, source: "admin" });

		assert.equal(ledger.voidByReference(GUILD, "7"), 2);
		assert.equal(ledger.total(GUILD, USER_A), 1);
		assert.equal(ledger.voidUser(GUILD, USER_A), 1);
		assert.equal(ledger.total(GUILD, USER_A), 0);
		assert.deepEqual(ledger.voidGuild(GUILD), { events: 1, members: 1 });
		assert.equal(ledger.total(GUILD, USER_B), 0);
		assert.equal(ledger.total(OTHER_GUILD, USER_B), 9);
	});

	test("rank và top: chỉ tính người có điểm > 0, hoà theo user_id", () =>
	{
		const { deps } = createTestContext();
		const ledger = deps.xpLedger;
		ledger.record({ guildId: GUILD, userId: USER_B, amount: 50, source: "message" });
		ledger.record({ guildId: GUILD, userId: USER_A, amount: 50, source: "message" });
		ledger.record({ guildId: GUILD, userId: USER_C, amount: 80, source: "message" });

		assert.deepEqual(ledger.top(GUILD, 10), [
			{ id: USER_C, total: 80 },
			{ id: USER_A, total: 50 },
			{ id: USER_B, total: 50 },
		]);
		assert.deepEqual(ledger.rank(GUILD, USER_C), { rank: 1, totalRanked: 3 });
		assert.deepEqual(ledger.rank(GUILD, USER_B), { rank: 2, totalRanked: 3 });
		assert.deepEqual(ledger.rank(GUILD, ADMIN), { rank: null, totalRanked: 3 });
	});

	test("điểm team theo snapshot, chỉ tính team đang cấu hình, bỏ event đã huỷ (DEC-024)", () =>
	{
		const { deps } = createTestContext();
		const ledger = deps.xpLedger;
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		deps.teams.add(GUILD, ROLE_FRONTEND, ADMIN);

		ledger.record({ guildId: GUILD, userId: USER_A, amount: 10, source: "message", teamRoleIds: [ROLE_BACKEND] });
		ledger.record({ guildId: GUILD, userId: USER_B, amount: 30, source: "message", teamRoleIds: [ROLE_BACKEND, ROLE_FRONTEND] });
		const voided = ledger.record({ guildId: GUILD, userId: USER_C, amount: 100, source: "message", teamRoleIds: [ROLE_FRONTEND] });
		ledger.record({ guildId: GUILD, userId: USER_C, amount: 70, source: "message", teamRoleIds: [ROLE_OTHER] });
		ledger.voidEvent(voided.id);

		assert.deepEqual(ledger.teamTotals(GUILD, 10), [
			{ id: ROLE_BACKEND, total: 40 },
			{ id: ROLE_FRONTEND, total: 30 },
		]);
		assert.equal(ledger.countTeams(GUILD), 2);
	});

	test("XP và contribution là hai ledger tách biệt (DEC-004)", () =>
	{
		const { deps } = createTestContext();
		deps.xpLedger.record({ guildId: GUILD, userId: USER_A, amount: 10, source: "message" });
		deps.contributionLedger.record({ guildId: GUILD, userId: USER_A, amount: 2, source: "vote" });
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 10);
		assert.equal(deps.contributionLedger.total(GUILD, USER_A), 2);
	});

	test("recent trả về event mới nhất trước, kể cả event đã huỷ", () =>
	{
		const { deps, clock } = createTestContext();
		const first = deps.xpLedger.record({ guildId: GUILD, userId: USER_A, amount: 1, source: "message" });
		clock.advanceSeconds(10);
		deps.xpLedger.record({ guildId: GUILD, userId: USER_A, amount: 2, source: "admin", actorId: ADMIN, reason: "thưởng" });
		deps.xpLedger.voidEvent(first.id);
		const recent = deps.xpLedger.recent(GUILD, USER_A, 10);
		assert.deepEqual(recent.map(e => e.amount), [2, 1]);
		assert.equal(recent[0].reason, "thưởng");
		assert.notEqual(recent[1].voidedAt, null);
	});
});
