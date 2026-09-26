import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { levelInfo, totalXpForLevel } from "../src/modules/activity/levels";
import { TIERS } from "../src/modules/activity/tiers";
import { ContributionService } from "../src/modules/contribution/ContributionService";
import { ACHIEVEMENTS } from "../src/modules/gamification/achievements";
import { GamificationService } from "../src/modules/gamification/GamificationService";
import { computeStreak } from "../src/modules/gamification/streaks";
import { GamificationProfile, StreakInfo } from "../src/modules/gamification/types";
import { PollService } from "../src/modules/poll/PollService";
import { vnDayNumber, vnDayStart } from "../src/shared/time";
import { ADMIN, createTestContext, GUILD, OTHER_GUILD, TestContext, USER_A, USER_B, USER_C } from "./helpers";

const TODAY = 20_000;
const HOUR = 3_600_000;
// Thứ Tư 30/09/2026 10:00 giờ Việt Nam; tuần bắt đầu 00:00 thứ Hai 28/09 (giờ Việt Nam).
const NOW = Date.UTC(2026, 8, 30, 3, 0);
const WEEK_START = Date.UTC(2026, 8, 27, 17, 0);
const NOW_DAY = vnDayNumber(NOW);

function streak(current: number, best: number, activeToday: boolean, lastActiveDay: number | null): StreakInfo
{
	return { current, best, activeToday, lastActiveDay };
}

/** Cách tính ngây thơ để đối chiếu: đếm lùi từ hôm nay (hoặc hôm qua) và từ cuối mỗi dãy. */
function naiveStreak(days: readonly number[], today: number): StreakInfo
{
	const set = new Set(days.filter(day => day <= today));
	const anchor = set.has(today) ? today : today - 1;
	let current = 0;
	while (set.has(anchor - current)) current++;
	let best = 0;
	for (const day of set)
	{
		if (set.has(day + 1)) continue;
		let length = 0;
		while (set.has(day - length)) length++;
		best = Math.max(best, length);
	}
	const last = set.size === 0 ? null : Math.max(...set);
	return { current, best, activeToday: set.has(today), lastActiveDay: last };
}

describe("computeStreak", () =>
{
	test("chưa từng hoạt động", () =>
	{
		assert.deepEqual(computeStreak([], TODAY), streak(0, 0, false, null));
	});

	test("chỉ hôm nay", () =>
	{
		assert.deepEqual(computeStreak([TODAY], TODAY), streak(1, 1, true, TODAY));
	});

	test("hôm nay chưa nhắn nhưng hôm qua có: chuỗi còn giữ", () =>
	{
		assert.deepEqual(computeStreak([TODAY - 1, TODAY - 2, TODAY - 3], TODAY), streak(3, 3, false, TODAY - 1));
	});

	test("bỏ trọn một ngày thì chuỗi hiện tại về 0, chuỗi dài nhất vẫn giữ", () =>
	{
		assert.deepEqual(computeStreak([TODAY - 2, TODAY - 3], TODAY), streak(0, 2, false, TODAY - 2));
	});

	test("chuỗi dài nhất lấy từ toàn bộ lịch sử", () =>
	{
		const days = [TODAY, TODAY - 1, TODAY - 5, TODAY - 6, TODAY - 7, TODAY - 8, TODAY - 20];
		assert.deepEqual(computeStreak(days, TODAY), streak(2, 4, true, TODAY));
	});

	test("ngày tương lai (đồng hồ lệch) bị bỏ qua", () =>
	{
		assert.deepEqual(computeStreak([TODAY + 3, TODAY + 1, TODAY, TODAY - 1], TODAY), streak(2, 2, true, TODAY));
		assert.deepEqual(computeStreak([TODAY + 1], TODAY), streak(0, 0, false, null));
	});

	test("đầu vào không sắp xếp hoặc có trùng vẫn đúng", () =>
	{
		assert.deepEqual(computeStreak([TODAY - 1, TODAY, TODAY, TODAY - 1, TODAY - 3], TODAY), streak(2, 2, true, TODAY));
	});

	test("khớp cách tính ngây thơ với mọi tập ngày trong 10 ngày gần nhất (kể cả 2 ngày tương lai)", () =>
	{
		const window = Array.from({ length: 12 }, (_, i) => TODAY + 2 - i);
		for (let mask = 0; mask < 1 << window.length; mask++)
		{
			const days = window.filter((_, i) => (mask & (1 << i)) !== 0);
			const actual = computeStreak(days, TODAY);
			assert.deepEqual(actual, naiveStreak(days, TODAY), `days=${days.join(",")}`);
			assert.ok(actual.best >= actual.current);
		}
	});
});

interface Setup extends TestContext
{
	gamification: GamificationService;
	contributions: ContributionService;
	polls: PollService;
}

function setup(): Setup
{
	const context = createTestContext();
	context.clock.current = NOW;
	return {
		...context,
		gamification: new GamificationService(context.db, context.deps),
		contributions: new ContributionService(context.db, context.deps),
		polls: new PollService(context.db, context.deps),
	};
}

/** Ghi `count` event XP nguồn "message" vào ngày `day` (giờ Việt Nam), cách nhau 1 phút, rồi đưa đồng hồ về NOW. */
function messagesOn(context: TestContext, day: number, count: number, userId = USER_A, guildId = GUILD): number[]
{
	const ids: number[] = [];
	for (let i = 0; i < count; i++)
	{
		context.clock.current = vnDayStart(day) + HOUR + i * 60_000;
		ids.push(context.deps.xpLedger.record({ guildId, userId, amount: 1, source: "message" }).id);
	}
	context.clock.current = NOW;
	return ids;
}

function unlockedKeys(profile: GamificationProfile): string[]
{
	return profile.achievements.filter(progress => progress.unlocked).map(progress => progress.achievement.key);
}

function submit(context: Setup, authorId: string, title: string): number
{
	return context.contributions.submit({
		guildId: GUILD,
		authorId,
		submittedBy: authorId,
		title,
		description: "Mô tả đóng góp.",
		category: "cai-tien",
		link: null,
		authorRoleIds: [],
	}).id;
}

function joinPoll(context: Setup, userId: string, guildId = GUILD): void
{
	const poll = context.polls.create({
		guildId,
		creatorId: ADMIN,
		question: "Đi team building ở đâu?",
		options: ["Đà Lạt", "Vũng Tàu"],
		multiSelect: false,
		xpReward: 0,
		durationMinutes: null,
	});
	context.polls.vote({ guildId, pollId: poll.id, userId, optionIndex: 0, roleIds: [] });
}

describe("GamificationService.profile", () =>
{
	test("người chưa có dữ liệu: mọi số bằng 0, cảnh giới Luyện Khí, không lỗi", () =>
	{
		const { gamification } = setup();
		const profile = gamification.profile(GUILD, USER_A);

		assert.equal(profile.userId, USER_A);
		assert.deepEqual(profile.level, levelInfo(0));
		assert.equal(profile.tier.name, "Luyện Khí");
		assert.equal(profile.nextTier?.key, "truc-co");
		assert.deepEqual(profile.streak, streak(0, 0, false, null));
		assert.deepEqual(profile.stats, {
			messages: 0, bestStreak: 0, recognitionsReceived: 0, recognitionsGiven: 0, pollsJoined: 0, contributions: 0,
		});
		assert.deepEqual(profile.achievements.map(progress => progress.achievement), [...ACHIEVEMENTS]);
		assert.ok(profile.achievements.every(progress => !progress.unlocked && progress.current === 0));
		assert.deepEqual(profile.weekly, { xp: 0, rank: null });
	});

	test("level và cảnh giới theo tổng XP; cảnh giới cao nhất thì không có cảnh giới kế tiếp", () =>
	{
		const context = setup();
		const { deps, gamification } = context;
		deps.xpLedger.record({ guildId: GUILD, userId: USER_A, amount: totalXpForLevel(3), source: "admin" });
		const profile = gamification.profile(GUILD, USER_A);
		assert.equal(profile.level.level, 3);
		assert.equal(profile.tier.key, "truc-co");
		assert.equal(profile.nextTier?.key, "kim-dan");

		deps.xpLedger.record({ guildId: GUILD, userId: USER_B, amount: totalXpForLevel(45), source: "admin" });
		const top = gamification.profile(GUILD, USER_B);
		assert.equal(top.tier.key, TIERS[TIERS.length - 1].key);
		assert.equal(top.nextTier, null);
	});

	test("chuỗi ngày và số tin nhắn chỉ tính event message chưa huỷ; huy hiệu mở đúng mốc", () =>
	{
		const context = setup();
		const { deps, gamification } = context;
		for (let back = 7; back >= 1; back--) messagesOn(context, NOW_DAY - back, back === 1 ? 16 : 14);
		const dayTenAgo = messagesOn(context, NOW_DAY - 10, 1);

		let profile = gamification.profile(GUILD, USER_A);
		assert.equal(profile.stats.messages, 101);
		assert.deepEqual(profile.streak, streak(7, 7, false, NOW_DAY - 1), "hôm nay chưa nhắn: chuỗi 7 ngày vẫn giữ");
		assert.deepEqual(unlockedKeys(profile), ["khai-khau", "kien-tri"]);
		const khaiKhau = profile.achievements.find(progress => progress.achievement.key === "khai-khau");
		assert.equal(khaiKhau?.current, 101);

		deps.xpLedger.voidEvent(dayTenAgo[0]);
		deps.xpLedger.voidEvent(messagesOn(context, NOW_DAY - 12, 1)[0]);
		deps.xpLedger.record({ guildId: GUILD, userId: USER_A, amount: 50, source: "admin" });
		context.clock.current = vnDayStart(NOW_DAY - 11) + HOUR;
		deps.xpLedger.record({ guildId: GUILD, userId: USER_A, amount: 5, source: "poll" });
		context.clock.current = NOW;
		profile = gamification.profile(GUILD, USER_A);
		assert.equal(profile.stats.messages, 100, "event đã huỷ và XP từ vote/admin không tính là tin nhắn");
		assert.deepEqual(profile.streak, streak(7, 7, false, NOW_DAY - 1));
		assert.deepEqual(unlockedKeys(profile), ["khai-khau", "kien-tri"]);

		deps.xpLedger.voidEvent(deps.xpLedger.recent(GUILD, USER_A, 200).find(event => event.source === "message" && event.voidedAt === null)?.id ?? -1);
		assert.deepEqual(unlockedKeys(gamification.profile(GUILD, USER_A)), ["kien-tri"], "99 tin thì mất Khai Khẩu");

		messagesOn(context, NOW_DAY, 1);
		assert.deepEqual(gamification.profile(GUILD, USER_A).streak, streak(8, 8, true, NOW_DAY));
	});

	test("bỏ trọn một ngày thì chuỗi hiện tại về 0; reset XP xoá cả chuỗi và số tin", () =>
	{
		const context = setup();
		const { deps, gamification } = context;
		messagesOn(context, NOW_DAY - 4, 1);
		messagesOn(context, NOW_DAY - 3, 1);
		messagesOn(context, NOW_DAY - 2, 1);
		assert.deepEqual(gamification.profile(GUILD, USER_A).streak, streak(0, 3, false, NOW_DAY - 2));

		deps.xpLedger.voidUser(GUILD, USER_A);
		const profile = gamification.profile(GUILD, USER_A);
		assert.deepEqual(profile.streak, streak(0, 0, false, null));
		assert.equal(profile.stats.messages, 0);
	});

	test("ghi nhận nhận được/đã cho và contribution chỉ tính dữ liệu còn hiệu lực", () =>
	{
		const context = setup();
		const { contributions, gamification } = context;
		const first = submit(context, USER_A, "Tối ưu build");
		const second = submit(context, USER_A, "Viết tài liệu");
		contributions.toggleVote({ guildId: GUILD, contributionId: first, voterId: USER_B });
		contributions.toggleVote({ guildId: GUILD, contributionId: first, voterId: USER_C });
		contributions.toggleVote({ guildId: GUILD, contributionId: second, voterId: USER_B });

		let author = gamification.profile(GUILD, USER_A);
		assert.equal(author.stats.recognitionsReceived, 3);
		assert.equal(author.stats.contributions, 2);
		assert.deepEqual(unlockedKeys(author), ["duoc-cong-nhan", "gop-gach"]);
		assert.equal(gamification.profile(GUILD, USER_B).stats.recognitionsGiven, 2);
		assert.equal(gamification.profile(GUILD, USER_C).stats.recognitionsGiven, 1);

		contributions.toggleVote({ guildId: GUILD, contributionId: second, voterId: USER_B });
		assert.equal(gamification.profile(GUILD, USER_B).stats.recognitionsGiven, 1, "rút ghi nhận thì không tính");

		contributions.remove(GUILD, first, ADMIN);
		author = gamification.profile(GUILD, USER_A);
		assert.equal(author.stats.recognitionsReceived, 0);
		assert.equal(author.stats.contributions, 1);
		assert.deepEqual(unlockedKeys(author), ["gop-gach"]);
		assert.equal(gamification.profile(GUILD, USER_B).stats.recognitionsGiven, 0, "contribution bị gỡ thì lượt ghi nhận không còn hiệu lực");
		assert.equal(gamification.profile(GUILD, USER_C).stats.recognitionsGiven, 0);
		assert.equal(gamification.profile(OTHER_GUILD, USER_A).stats.contributions, 0);
	});

	test("admin reset Contribution thì lượt ghi nhận đã cho không còn tính", () =>
	{
		const context = setup();
		const { contributions, gamification } = context;
		const id = submit(context, USER_A, "Tối ưu build");
		contributions.toggleVote({ guildId: GUILD, contributionId: id, voterId: USER_B });
		contributions.resetUser(GUILD, USER_A, ADMIN);

		assert.equal(gamification.profile(GUILD, USER_B).stats.recognitionsGiven, 0);
		assert.equal(gamification.profile(GUILD, USER_A).stats.recognitionsReceived, 0);
		assert.equal(gamification.profile(GUILD, USER_A).stats.contributions, 1, "reset điểm không gỡ contribution");
	});

	test("số vote đã tham gia theo guild; đủ 5 thì mở huy hiệu", () =>
	{
		const context = setup();
		const { gamification } = context;
		for (let i = 0; i < 4; i++) joinPoll(context, USER_A);
		joinPoll(context, USER_A, OTHER_GUILD);
		assert.equal(gamification.profile(GUILD, USER_A).stats.pollsJoined, 4);
		assert.deepEqual(unlockedKeys(gamification.profile(GUILD, USER_A)), []);

		joinPoll(context, USER_A);
		const profile = gamification.profile(GUILD, USER_A);
		assert.equal(profile.stats.pollsJoined, 5);
		assert.deepEqual(unlockedKeys(profile), ["cong-dan-guong-mau"]);
		assert.equal(gamification.profile(OTHER_GUILD, USER_A).stats.pollsJoined, 1);
	});

	test("XP tuần tính mọi nguồn từ 00:00 thứ Hai giờ Việt Nam, kèm hạng tuần", () =>
	{
		const context = setup();
		const { deps, clock, gamification } = context;
		clock.current = WEEK_START - 1;
		deps.xpLedger.record({ guildId: GUILD, userId: USER_A, amount: 500, source: "message" });
		clock.current = WEEK_START;
		deps.xpLedger.record({ guildId: GUILD, userId: USER_A, amount: 10, source: "message" });
		deps.xpLedger.record({ guildId: GUILD, userId: USER_A, amount: 5, source: "poll" });
		deps.xpLedger.record({ guildId: GUILD, userId: USER_B, amount: 40, source: "message" });
		deps.xpLedger.record({ guildId: OTHER_GUILD, userId: USER_C, amount: 99, source: "message" });
		const voided = deps.xpLedger.record({ guildId: GUILD, userId: USER_A, amount: 100, source: "message" });
		deps.xpLedger.voidEvent(voided.id);
		clock.current = NOW;

		const profile = gamification.profile(GUILD, USER_A);
		assert.deepEqual(profile.weekly, { xp: 15, rank: 2 });
		assert.equal(profile.level.totalXp, 515);
		assert.deepEqual(gamification.profile(GUILD, USER_B).weekly, { xp: 40, rank: 1 });
		assert.deepEqual(gamification.profile(GUILD, USER_C).weekly, { xp: 0, rank: null });
	});
});
