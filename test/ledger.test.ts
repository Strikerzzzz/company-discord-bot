import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "../src/db/connection";
import { LedgerKind, RankedEntry } from "../src/modules/ledger/Ledger";
import { createTestContext, GUILD, OTHER_GUILD, ROLE_BACKEND, ROLE_FRONTEND, ROLE_OTHER, USER_A, USER_B, USER_C, ADMIN } from "./helpers";

// Tên bảng là hằng số trong test, không phải input.
const TABLES = {
	xp: { events: "xp_events", teams: "xp_event_teams", members: "member_xp", teamTotals: "xp_team_totals" },
	contribution: { events: "contribution_events", teams: "contribution_event_teams", members: "member_contribution", teamTotals: "contribution_team_totals" },
} as const;

/** PRNG có seed để kịch bản ngẫu nhiên tái lập được khi test fail. */
function mulberry32(seed: number): () => number
{
	let state = seed >>> 0;
	return (): number =>
	{
		state = (state + 0x6D2B79F5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

interface KeyedTotal
{
	guild_id: string;
	key: string;
	total: number;
}

/** Map "guild|key" → tổng, bỏ các dòng bằng 0 (cache có thể giữ dòng 0, tính lại thì không có dòng). */
function nonZeroTotals(rows: KeyedTotal[]): Map<string, number>
{
	return new Map(rows.filter(row => row.total !== 0).map(row => [`${row.guild_id}|${row.key}`, row.total]));
}

function assertCacheMatchesLedger(db: Db, kind: LedgerKind, context: string): void
{
	const t = TABLES[kind];
	const cachedTeams = db.prepare<[], KeyedTotal>(`SELECT guild_id, role_id AS key, total FROM ${t.teamTotals}`).all();
	const recomputedTeams = db.prepare<[], KeyedTotal>(`
		SELECT e.guild_id, et.role_id AS key, SUM(e.amount) AS total
		FROM ${t.events} e JOIN ${t.teams} et ON et.event_id = e.id
		WHERE e.voided_at IS NULL
		GROUP BY e.guild_id, et.role_id`).all();
	assert.deepEqual(nonZeroTotals(cachedTeams), nonZeroTotals(recomputedTeams), `tổng team lệch ledger (${context})`);

	const cachedMembers = db.prepare<[], KeyedTotal>(`SELECT guild_id, user_id AS key, total FROM ${t.members}`).all();
	const recomputedMembers = db.prepare<[], KeyedTotal>(`
		SELECT guild_id, user_id AS key, SUM(amount) AS total FROM ${t.events} WHERE voided_at IS NULL GROUP BY guild_id, user_id`).all();
	assert.deepEqual(nonZeroTotals(cachedMembers), nonZeroTotals(recomputedMembers), `tổng thành viên lệch ledger (${context})`);
}

/** Xếp hạng team tính thẳng từ ledger (cách làm trước khi có cache) để đối chiếu. */
function expectedTeamRanking(db: Db, kind: LedgerKind, guildId: string): RankedEntry[]
{
	const t = TABLES[kind];
	const rows = db.prepare<[string], { id: string; total: number }>(`
		SELECT et.role_id AS id, SUM(e.amount) AS total
		FROM ${t.teams} et
		JOIN ${t.events} e ON e.id = et.event_id
		JOIN team_roles r ON r.guild_id = e.guild_id AND r.role_id = et.role_id
		WHERE e.guild_id = ? AND e.voided_at IS NULL
		GROUP BY et.role_id
		HAVING SUM(e.amount) > 0
		ORDER BY total DESC, id ASC`).all(guildId);
	return rows.map(row => ({ ...row, rank: 1 + rows.filter(other => other.total > row.total).length }));
}

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

	test("rank và top: chỉ tính người có điểm > 0, hoà điểm cùng hạng, hiển thị theo user_id", () =>
	{
		const { deps } = createTestContext();
		const ledger = deps.xpLedger;
		ledger.record({ guildId: GUILD, userId: USER_B, amount: 50, source: "message" });
		ledger.record({ guildId: GUILD, userId: USER_A, amount: 50, source: "message" });
		ledger.record({ guildId: GUILD, userId: USER_C, amount: 80, source: "message" });
		ledger.record({ guildId: GUILD, userId: ADMIN, amount: 0, source: "admin" });

		assert.deepEqual(ledger.top(GUILD, 10), [
			{ id: USER_C, total: 80, rank: 1 },
			{ id: USER_A, total: 50, rank: 2 },
			{ id: USER_B, total: 50, rank: 2 },
		]);
		assert.deepEqual(ledger.rank(GUILD, USER_C), { rank: 1, totalRanked: 3 });
		assert.deepEqual(ledger.rank(GUILD, USER_A), { rank: 2, totalRanked: 3 });
		assert.deepEqual(ledger.rank(GUILD, USER_B), { rank: 2, totalRanked: 3 });
		assert.deepEqual(ledger.rank(GUILD, ADMIN), { rank: null, totalRanked: 3 });
	});

	test("top: hạng tính trên toàn bảng rồi mới phân trang (1, 2, 2, 2, 5)", () =>
	{
		const { deps } = createTestContext();
		const ledger = deps.xpLedger;
		const totals: [string, number][] = [["u1", 100], ["u2", 90], ["u3", 90], ["u4", 90], ["u5", 80]];
		for (const [userId, amount] of totals) ledger.record({ guildId: GUILD, userId, amount, source: "admin" });

		assert.deepEqual(ledger.top(GUILD, 2, 0), [{ id: "u1", total: 100, rank: 1 }, { id: "u2", total: 90, rank: 2 }]);
		assert.deepEqual(ledger.top(GUILD, 2, 2), [{ id: "u3", total: 90, rank: 2 }, { id: "u4", total: 90, rank: 2 }]);
		assert.deepEqual(ledger.top(GUILD, 2, 4), [{ id: "u5", total: 80, rank: 5 }]);
		const all = ledger.top(GUILD, 10);
		for (const [userId] of totals)
		{
			assert.equal(ledger.rank(GUILD, userId).rank, all.find(row => row.id === userId)?.rank);
		}
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
		assert.deepEqual(ledger.topTeams(GUILD, 10), [
			{ id: ROLE_BACKEND, total: 40, rank: 1 },
			{ id: ROLE_FRONTEND, total: 30, rank: 2 },
		]);
		assert.equal(ledger.countTeams(GUILD), 2);
	});

	test("topTeams: team hoà điểm cùng hạng, hạng đúng cả ở trang sau", () =>
	{
		const { deps } = createTestContext();
		const ledger = deps.contributionLedger;
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		deps.teams.add(GUILD, ROLE_FRONTEND, ADMIN);
		deps.teams.add(GUILD, ROLE_OTHER, ADMIN);
		ledger.record({ guildId: GUILD, userId: USER_A, amount: 5, source: "admin", teamRoleIds: [ROLE_BACKEND, ROLE_FRONTEND] });
		ledger.record({ guildId: GUILD, userId: USER_B, amount: 3, source: "admin", teamRoleIds: [ROLE_OTHER] });

		assert.deepEqual(ledger.topTeams(GUILD, 1, 0), [{ id: ROLE_BACKEND, total: 5, rank: 1 }]);
		assert.deepEqual(ledger.topTeams(GUILD, 1, 1), [{ id: ROLE_FRONTEND, total: 5, rank: 1 }]);
		assert.deepEqual(ledger.topTeams(GUILD, 1, 2), [{ id: ROLE_OTHER, total: 3, rank: 3 }]);
		assert.equal(ledger.countTeams(GUILD), 3);
	});

	test("tổng team cập nhật đúng qua voidEvent, voidByReference, voidUser, voidGuild", () =>
	{
		const { deps } = createTestContext();
		const ledger = deps.contributionLedger;
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		deps.teams.add(GUILD, ROLE_FRONTEND, ADMIN);
		deps.teams.add(OTHER_GUILD, ROLE_BACKEND, ADMIN);
		const both = [ROLE_BACKEND, ROLE_FRONTEND];

		const single = ledger.record({ guildId: GUILD, userId: USER_A, amount: 4, source: "admin", teamRoleIds: both });
		ledger.record({ guildId: GUILD, userId: USER_A, amount: 2, source: "vote", referenceId: "9", teamRoleIds: [ROLE_BACKEND] });
		ledger.record({ guildId: GUILD, userId: USER_B, amount: 3, source: "vote", referenceId: "9", teamRoleIds: both });
		ledger.record({ guildId: GUILD, userId: USER_B, amount: 10, source: "admin", teamRoleIds: [ROLE_FRONTEND] });
		ledger.record({ guildId: GUILD, userId: USER_C, amount: 7, source: "admin", teamRoleIds: [ROLE_BACKEND] });
		ledger.record({ guildId: OTHER_GUILD, userId: USER_A, amount: 6, source: "admin", teamRoleIds: [ROLE_BACKEND] });
		assert.deepEqual(ledger.teamTotals(GUILD, 10), [{ id: ROLE_FRONTEND, total: 17 }, { id: ROLE_BACKEND, total: 16 }]);

		ledger.voidEvent(single.id);
		ledger.voidEvent(single.id);
		assert.deepEqual(ledger.teamTotals(GUILD, 10), [{ id: ROLE_FRONTEND, total: 13 }, { id: ROLE_BACKEND, total: 12 }]);

		assert.equal(ledger.voidByReference(GUILD, "9"), 2);
		assert.deepEqual(ledger.teamTotals(GUILD, 10), [{ id: ROLE_FRONTEND, total: 10 }, { id: ROLE_BACKEND, total: 7 }]);

		assert.equal(ledger.voidUser(GUILD, USER_B), 1);
		assert.deepEqual(ledger.teamTotals(GUILD, 10), [{ id: ROLE_BACKEND, total: 7 }]);
		assert.equal(ledger.countTeams(GUILD), 1);

		ledger.voidGuild(GUILD);
		assert.deepEqual(ledger.teamTotals(GUILD, 10), []);
		assert.equal(ledger.countTeams(GUILD), 0);
		assert.deepEqual(ledger.teamTotals(OTHER_GUILD, 10), [{ id: ROLE_BACKEND, total: 6 }]);

		ledger.record({ guildId: GUILD, userId: USER_A, amount: 1, source: "admin", teamRoleIds: [ROLE_FRONTEND] });
		assert.deepEqual(ledger.teamTotals(GUILD, 10), [{ id: ROLE_FRONTEND, total: 1 }]);
	});

	test("team bị bỏ cấu hình thì ẩn, cấu hình lại thì hiện đủ điểm cũ theo snapshot", () =>
	{
		const { deps } = createTestContext();
		const ledger = deps.xpLedger;
		ledger.record({ guildId: GUILD, userId: USER_A, amount: 25, source: "message", teamRoleIds: [ROLE_BACKEND] });
		assert.deepEqual(ledger.teamTotals(GUILD, 10), []);

		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		assert.deepEqual(ledger.teamTotals(GUILD, 10), [{ id: ROLE_BACKEND, total: 25 }]);
		deps.teams.remove(GUILD, ROLE_BACKEND, ADMIN);
		assert.equal(ledger.countTeams(GUILD), 0);
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		assert.deepEqual(ledger.teamTotals(GUILD, 10), [{ id: ROLE_BACKEND, total: 25 }]);
	});

	for (const kind of ["xp", "contribution"] as const)
	{
		test(`cache tổng team và tổng thành viên luôn bằng giá trị tính lại từ ledger (${kind}, thao tác ngẫu nhiên)`, () =>
		{
			const { db, deps } = createTestContext();
			const ledger = kind === "xp" ? deps.xpLedger : deps.contributionLedger;
			const sources = kind === "xp" ? ["message", "poll", "admin"] : ["vote", "admin"];
			const guilds = [GUILD, OTHER_GUILD];
			const users = [USER_A, USER_B, USER_C, ADMIN];
			const roles = [ROLE_BACKEND, ROLE_FRONTEND, ROLE_OTHER, "500000000000000003"];
			const references = ["1", "2", "3", null];
			deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
			deps.teams.add(GUILD, ROLE_FRONTEND, ADMIN);
			deps.teams.add(GUILD, ROLE_OTHER, ADMIN);
			deps.teams.add(OTHER_GUILD, ROLE_FRONTEND, ADMIN);

			const random = mulberry32(kind === "xp" ? 20260926 : 424242);
			const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
			const counts = { record: 0, voidEvent: 0, voidByReference: 0, voidUser: 0, voidGuild: 0 };
			let lastEventId = 0;
			let maxRankedTeams = 0;

			for (let step = 0; step < 1500; step++)
			{
				const roll = random();
				const guildId = pick(guilds);
				if (roll < 0.6)
				{
					const teamRoleIds = roles.filter(() => random() < 0.4);
					const amount = Math.floor(random() * 26) - 5;
					lastEventId = ledger.record({ guildId, userId: pick(users), amount, source: pick(sources), referenceId: pick(references), teamRoleIds }).id;
					counts.record++;
				}
				else if (roll < 0.8)
				{
					if (ledger.voidEvent(1 + Math.floor(random() * Math.max(1, lastEventId)))) counts.voidEvent++;
				}
				else if (roll < 0.9)
				{
					counts.voidByReference += ledger.voidByReference(guildId, pick(references) ?? "1");
				}
				else if (roll < 0.985)
				{
					counts.voidUser += ledger.voidUser(guildId, pick(users));
				}
				else
				{
					ledger.voidGuild(guildId);
					counts.voidGuild++;
				}

				assertCacheMatchesLedger(db, kind, `bước ${step}`);
				for (const guild of guilds)
				{
					const ranking = ledger.topTeams(guild, 100);
					assert.deepEqual(ranking, expectedTeamRanking(db, kind, guild), `xếp hạng team ở bước ${step}`);
					maxRankedTeams = Math.max(maxRankedTeams, ranking.length);
				}
			}

			// Kịch bản phải thật sự đi qua mọi đường ghi và có bảng xếp hạng nhiều team, nếu không phép so sánh ở trên không chứng minh được gì.
			for (const [operation, count] of Object.entries(counts)) assert.ok(count > 0, `không có thao tác ${operation} nào có tác dụng`);
			assert.ok(maxRankedTeams >= 3, `bảng xếp hạng team chưa từng có đủ 3 team (tối đa ${maxRankedTeams})`);
		});
	}

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
