import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "../src/db/connection";
import { ServiceDeps } from "../src/modules/deps";
import { GuildStatistics } from "../src/modules/statistics/types";
import { STATISTICS_WINDOW_MS, StatisticsService } from "../src/modules/statistics/StatisticsService";
import {
	ADMIN,
	CHANNEL_BOT,
	CHANNEL_GENERAL,
	createTestContext,
	GUILD,
	OTHER_GUILD,
	ROLE_BACKEND,
	ROLE_FRONTEND,
	USER_A,
	USER_B,
	USER_C,
} from "./helpers";

const HOUR_MS = 60 * 60 * 1000;

const EMPTY: GuildStatistics = {
	activity: { members: 0, totalXp: 0, xpLast7Days: 0, messageAwardsLast7Days: 0, topChannelsLast7Days: [] },
	contribution: { total: 0, last7Days: 0, votes: 0, totalScore: 0 },
	polls: { total: 0, open: 0, participations: 0 },
	teams: 0,
};

function channel(index: number): string
{
	return `4000000000000001${String(index).padStart(2, "0")}`;
}

function messageXp(deps: ServiceDeps, guildId: string, userId: string, channelId: string, amount = 10): number
{
	return deps.xpLedger.record({ guildId, userId, amount, source: "message", referenceId: channelId }).id;
}

// Contribution và poll được seed bằng SQL trực tiếp theo schema, không phụ thuộc ContributionService/PollService.
function insertContribution(db: Db, guildId: string, authorId: string, createdAt: number, status: "active" | "removed" = "active"): number
{
	const result = db.prepare(`
		INSERT INTO contributions (guild_id, author_id, submitted_by, title, description, category, status, created_at, removed_at, removed_by)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(guildId, authorId, authorId, "Tiêu đề", "Mô tả", "other", status, createdAt,
		status === "removed" ? createdAt : null, status === "removed" ? ADMIN : null);
	return Number(result.lastInsertRowid);
}

/** Một lượt ghi nhận: ghi điểm vào ledger contribution rồi thêm dòng contribution_votes trỏ tới event đó. */
function insertVote(db: Db, deps: ServiceDeps, guildId: string, contributionId: number, authorId: string, voterId: string): void
{
	const event = deps.contributionLedger.record({ guildId, userId: authorId, amount: 1, source: "vote", referenceId: String(contributionId), actorId: voterId });
	db.prepare("INSERT INTO contribution_votes (contribution_id, voter_id, event_id, created_at) VALUES (?, ?, ?, ?)")
		.run(contributionId, voterId, event.id, event.createdAt);
}

interface PollSeed
{
	createdAt: number;
	closesAt?: number | null;
	closedAt?: number | null;
}

function insertPoll(db: Db, guildId: string, seed: PollSeed): number
{
	const result = db.prepare(`
		INSERT INTO polls (guild_id, creator_id, question, multi_select, xp_reward, closes_at, closed_at, created_at)
		VALUES (?, ?, ?, 0, 5, ?, ?, ?)`,
	).run(guildId, ADMIN, "Câu hỏi?", seed.closesAt ?? null, seed.closedAt ?? null, seed.createdAt);
	return Number(result.lastInsertRowid);
}

function insertParticipant(db: Db, pollId: number, userId: string, votedAt: number, xpEventId: number | null = null): void
{
	db.prepare("INSERT INTO poll_participants (poll_id, user_id, xp_event_id, first_voted_at) VALUES (?, ?, ?, ?)")
		.run(pollId, userId, xpEventId, votedAt);
}

describe("StatisticsService", () =>
{
	test("guild chưa có dữ liệu: mọi số bằng 0, danh sách rỗng", () =>
	{
		const { db, deps } = createTestContext();
		assert.deepEqual(new StatisticsService(db, deps).summary(GUILD), EMPTY);
	});

	test("Activity XP: tổng, số người, dữ liệu trong và ngoài cửa sổ 7 ngày", () =>
	{
		const { db, deps, clock } = createTestContext();
		const stats = new StatisticsService(db, deps);

		messageXp(deps, GUILD, USER_A, CHANNEL_GENERAL, 10);
		deps.xpLedger.record({ guildId: GUILD, userId: USER_B, amount: 40, source: "admin", actorId: ADMIN });

		clock.advance(STATISTICS_WINDOW_MS);
		messageXp(deps, GUILD, USER_A, CHANNEL_BOT, 7);
		deps.xpLedger.record({ guildId: GUILD, userId: USER_C, amount: 5, source: "poll", referenceId: "1" });

		const atBoundary = stats.summary(GUILD).activity;
		assert.equal(atBoundary.members, 3);
		assert.equal(atBoundary.totalXp, 62);
		assert.equal(atBoundary.xpLast7Days, 62, "event đúng mốc now - 7 ngày vẫn nằm trong cửa sổ");
		assert.equal(atBoundary.messageAwardsLast7Days, 2);

		clock.advance(1);
		const after = stats.summary(GUILD).activity;
		assert.equal(after.members, 3);
		assert.equal(after.totalXp, 62, "tổng XP không phụ thuộc cửa sổ 7 ngày");
		assert.equal(after.xpLast7Days, 12);
		assert.equal(after.messageAwardsLast7Days, 1);
		assert.deepEqual(after.topChannelsLast7Days, [{ channelId: CHANNEL_BOT, awards: 1 }]);
	});

	test("event XP đã huỷ không được tính; người bị reset không còn trong số thành viên có XP", () =>
	{
		const { db, deps } = createTestContext();
		const voided = messageXp(deps, GUILD, USER_A, CHANNEL_GENERAL, 10);
		messageXp(deps, GUILD, USER_A, CHANNEL_GENERAL, 10);
		messageXp(deps, GUILD, USER_B, CHANNEL_BOT, 10);
		messageXp(deps, GUILD, USER_B, CHANNEL_BOT, 10);
		messageXp(deps, GUILD, USER_B, CHANNEL_BOT, 10);
		deps.xpLedger.voidEvent(voided);
		deps.xpLedger.voidUser(GUILD, USER_B);

		const activity = new StatisticsService(db, deps).summary(GUILD).activity;
		assert.equal(activity.members, 1);
		assert.equal(activity.totalXp, 10);
		assert.equal(activity.xpLast7Days, 10);
		assert.equal(activity.messageAwardsLast7Days, 1);
		assert.deepEqual(activity.topChannelsLast7Days, [{ channelId: CHANNEL_GENERAL, awards: 1 }]);
	});

	test("top channel: sắp theo số lần giảm dần, hoà theo channelId tăng dần, tối đa 5, chỉ tính XP từ tin nhắn", () =>
	{
		const { db, deps } = createTestContext();
		const awardsByChannel: [number, number][] = [[6, 1], [2, 4], [4, 2], [1, 3], [3, 2], [5, 2], [7, 3]];
		for (const [index, awards] of awardsByChannel)
		{
			for (let i = 0; i < awards; i++) messageXp(deps, GUILD, USER_A, channel(index), 1);
		}
		deps.xpLedger.record({ guildId: GUILD, userId: USER_A, amount: 1, source: "poll", referenceId: channel(9) });
		deps.xpLedger.record({ guildId: GUILD, userId: USER_A, amount: 1, source: "poll", referenceId: channel(9) });
		deps.xpLedger.record({ guildId: GUILD, userId: USER_A, amount: 1, source: "poll", referenceId: channel(9) });
		deps.xpLedger.record({ guildId: GUILD, userId: USER_A, amount: 1, source: "poll", referenceId: channel(9) });
		deps.xpLedger.record({ guildId: GUILD, userId: USER_A, amount: 1, source: "poll", referenceId: channel(9) });

		const activity = new StatisticsService(db, deps).summary(GUILD).activity;
		assert.deepEqual(activity.topChannelsLast7Days, [
			{ channelId: channel(2), awards: 4 },
			{ channelId: channel(1), awards: 3 },
			{ channelId: channel(7), awards: 3 },
			{ channelId: channel(3), awards: 2 },
			{ channelId: channel(4), awards: 2 },
		]);
		assert.equal(activity.messageAwardsLast7Days, 17);
		assert.equal(activity.xpLast7Days, 22);
	});

	test("top channel bỏ qua event cũ hơn 7 ngày", () =>
	{
		const { db, deps, clock } = createTestContext();
		messageXp(deps, GUILD, USER_A, CHANNEL_GENERAL);
		messageXp(deps, GUILD, USER_A, CHANNEL_GENERAL);
		messageXp(deps, GUILD, USER_A, CHANNEL_GENERAL);
		clock.advance(STATISTICS_WINDOW_MS + HOUR_MS);
		messageXp(deps, GUILD, USER_A, CHANNEL_BOT);

		const activity = new StatisticsService(db, deps).summary(GUILD).activity;
		assert.deepEqual(activity.topChannelsLast7Days, [{ channelId: CHANNEL_BOT, awards: 1 }]);
	});

	test("Contribution: chỉ tính contribution active; lượt ghi nhận của contribution bị gỡ không tính", () =>
	{
		const { db, deps, clock } = createTestContext();
		const stats = new StatisticsService(db, deps);

		const old = insertContribution(db, GUILD, USER_A, clock.now());
		insertVote(db, deps, GUILD, old, USER_A, USER_B);
		insertVote(db, deps, GUILD, old, USER_A, USER_C);

		clock.advance(STATISTICS_WINDOW_MS + HOUR_MS);
		const recent = insertContribution(db, GUILD, USER_B, clock.now());
		insertVote(db, deps, GUILD, recent, USER_B, USER_A);
		const removed = insertContribution(db, GUILD, USER_C, clock.now());
		insertVote(db, deps, GUILD, removed, USER_C, USER_A);
		insertVote(db, deps, GUILD, removed, USER_C, USER_B);
		db.prepare("UPDATE contributions SET status = 'removed', removed_at = ?, removed_by = ? WHERE id = ?").run(clock.now(), ADMIN, removed);
		deps.contributionLedger.voidByReference(GUILD, String(removed));
		insertContribution(db, GUILD, USER_A, clock.now(), "removed");

		assert.deepEqual(stats.summary(GUILD).contribution, { total: 2, last7Days: 1, votes: 3, totalScore: 3 });
	});

	test("Contribution Score tách biệt với Activity XP (DEC-004); tổng chỉ cộng các dòng dương", () =>
	{
		const { db, deps } = createTestContext();
		deps.contributionLedger.record({ guildId: GUILD, userId: USER_A, amount: 4, source: "admin", actorId: ADMIN });
		deps.contributionLedger.record({ guildId: GUILD, userId: USER_B, amount: -2, source: "admin", actorId: ADMIN });
		deps.xpLedger.record({ guildId: GUILD, userId: USER_C, amount: -3, source: "admin", actorId: ADMIN });

		const summary = new StatisticsService(db, deps).summary(GUILD);
		assert.equal(summary.contribution.totalScore, 4);
		assert.equal(summary.activity.totalXp, 0);
		assert.equal(summary.activity.members, 0);
	});

	test("Poll: đếm tổng, poll đang mở (chưa đóng, chưa quá hạn) và lượt tham gia", () =>
	{
		const { db, deps, clock } = createTestContext();
		const now = clock.now();
		const openNoDeadline = insertPoll(db, GUILD, { createdAt: now });
		const openWithDeadline = insertPoll(db, GUILD, { createdAt: now, closesAt: now + HOUR_MS });
		const closed = insertPoll(db, GUILD, { createdAt: now, closesAt: now + HOUR_MS, closedAt: now });
		insertPoll(db, GUILD, { createdAt: now, closedAt: now });
		insertPoll(db, GUILD, { createdAt: now - 2 * HOUR_MS, closesAt: now - HOUR_MS });
		insertPoll(db, GUILD, { createdAt: now - HOUR_MS, closesAt: now });

		const xpEvent = deps.xpLedger.record({ guildId: GUILD, userId: USER_A, amount: 5, source: "poll", referenceId: String(openNoDeadline) });
		insertParticipant(db, openNoDeadline, USER_A, now, xpEvent.id);
		insertParticipant(db, openNoDeadline, USER_B, now);
		insertParticipant(db, openWithDeadline, USER_A, now);
		insertParticipant(db, closed, USER_C, now);

		const stats = new StatisticsService(db, deps);
		assert.deepEqual(stats.summary(GUILD).polls, { total: 6, open: 2, participations: 4 });

		clock.advance(HOUR_MS);
		assert.deepEqual(stats.summary(GUILD).polls, { total: 6, open: 1, participations: 4 }, "poll tới hạn mà chưa được đóng không còn là đang mở");
	});

	test("số team đang cấu hình", () =>
	{
		const { db, deps } = createTestContext();
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		deps.teams.add(GUILD, ROLE_FRONTEND, ADMIN);
		deps.teams.add(OTHER_GUILD, ROLE_BACKEND, ADMIN);
		deps.teams.remove(GUILD, ROLE_FRONTEND, ADMIN);

		assert.equal(new StatisticsService(db, deps).summary(GUILD).teams, 1);
	});

	test("không lẫn dữ liệu giữa hai guild", () =>
	{
		const { db, deps, clock } = createTestContext();
		const now = clock.now();
		messageXp(deps, OTHER_GUILD, USER_A, CHANNEL_GENERAL, 25);
		deps.xpLedger.record({ guildId: OTHER_GUILD, userId: USER_B, amount: 5, source: "poll" });
		const contribution = insertContribution(db, OTHER_GUILD, USER_A, now);
		insertVote(db, deps, OTHER_GUILD, contribution, USER_A, USER_B);
		const poll = insertPoll(db, OTHER_GUILD, { createdAt: now });
		insertParticipant(db, poll, USER_A, now);
		deps.teams.add(OTHER_GUILD, ROLE_BACKEND, ADMIN);

		messageXp(deps, GUILD, USER_C, CHANNEL_BOT, 3);

		const stats = new StatisticsService(db, deps);
		assert.deepEqual(stats.summary(GUILD), {
			...EMPTY,
			activity: {
				members: 1,
				totalXp: 3,
				xpLast7Days: 3,
				messageAwardsLast7Days: 1,
				topChannelsLast7Days: [{ channelId: CHANNEL_BOT, awards: 1 }],
			},
		});
		assert.deepEqual(stats.summary(OTHER_GUILD), {
			activity: {
				members: 2,
				totalXp: 30,
				xpLast7Days: 30,
				messageAwardsLast7Days: 1,
				topChannelsLast7Days: [{ channelId: CHANNEL_GENERAL, awards: 1 }],
			},
			contribution: { total: 1, last7Days: 1, votes: 1, totalScore: 1 },
			polls: { total: 1, open: 1, participations: 1 },
			teams: 1,
		});
	});
});
