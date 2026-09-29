import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Db } from "../src/db/connection";
import { ActivityService, MAX_RECENT_EVENTS, MAX_XP_ADJUSTMENT } from "../src/modules/activity/ActivityService";
import { ContentSpamFilter, contentLength, DuplicateTracker, normalizeContent } from "../src/modules/activity/antiSpam";
import { MessageInput, MessageXpResult } from "../src/modules/activity/types";
import { UserError } from "../src/shared/errors";
import {
	ADMIN,
	CHANNEL_BOT,
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

function message(overrides: Partial<MessageInput> = {}): MessageInput
{
	return {
		guildId: GUILD,
		userId: USER_A,
		channelId: CHANNEL_GENERAL,
		content: "Chào buổi sáng cả nhà",
		hasAttachments: false,
		roleIds: [],
		...overrides,
	};
}

function setup(): TestContext & { activity: ActivityService }
{
	const context = createTestContext();
	return { ...context, activity: new ActivityService(context.db, context.deps) };
}

function outcome(result: MessageXpResult): string
{
	return result.awarded ? "awarded" : result.reason;
}

function lastMessageXpAt(db: Db, guildId: string, userId: string): number | null | undefined
{
	return db.prepare<[string, string], { last_message_xp_at: number | null }>("SELECT last_message_xp_at FROM member_xp WHERE guild_id = ? AND user_id = ?")
		.get(guildId, userId)?.last_message_xp_at;
}

function quoteIdentifier(name: string): string
{
	return `"${name.replaceAll("\"", "\"\"")}"`;
}

/** Mọi giá trị chuỗi trong mọi cột của mọi bảng (bao trùm các cột TEXT). */
function allStoredStrings(db: Db): string[]
{
	const tables = db.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").all();
	const values: string[] = [];
	for (const { name } of tables)
	{
		const rows = db.prepare<[], Record<string, unknown>>(`SELECT * FROM ${quoteIdentifier(name)}`).all();
		for (const row of rows)
		{
			for (const value of Object.values(row))
			{
				if (typeof value === "string") values.push(value);
			}
		}
	}
	return values;
}

describe("antiSpam: chuẩn hoá nội dung", () =>
{
	test("chữ thường, bỏ mention và custom emoji, gộp khoảng trắng, trim", () =>
	{
		const raw = "  Xin   CHÀO <@123> <@!456> <@&789> <#1011>\n\tmọi <:vui:1213> người <a:quay_tron:1415>  ";
		assert.equal(normalizeContent(raw), "xin chào mọi người");
		assert.equal(normalizeContent("<@123><:x:1>"), "");
	});

	test("rút chuỗi ký tự lặp dài còn 3 ký tự", () =>
	{
		assert.equal(normalizeContent("Haaaaaaaa!!!!!!"), "haaa!!!");
		assert.equal(normalizeContent("😀😀😀😀😀😀"), "😀😀😀");
		assert.equal(normalizeContent("hoooo hooo"), "hooo hooo");
	});

	test("chuẩn hoá Unicode NFC và bỏ ký tự vô hình dùng để né chống trùng", () =>
	{
		const decomposed = "Tiếng Việt";
		assert.equal(normalizeContent(decomposed), normalizeContent("Tiếng Việt"));
		assert.equal(normalizeContent("xin​ chào‍­"), "xin chào");
	});

	test("độ dài tính theo code point", () =>
	{
		assert.equal(contentLength("tiếng việt"), 10);
		assert.equal(contentLength("😀🎉🔥👍"), 4);
		assert.equal(contentLength(normalizeContent("Tiếng")), 5);
	});
});

describe("antiSpam: DuplicateTracker", () =>
{
	test("trùng trong window thì báo trùng; luôn ghi nhận nên window trượt theo lần gặp gần nhất", () =>
	{
		const tracker = new DuplicateTracker();
		assert.equal(tracker.checkAndRecord("g:u", "xin chào", 0, 10_000), false);
		assert.equal(tracker.checkAndRecord("g:u", "xin chào", 9_999, 10_000), true);
		assert.equal(tracker.checkAndRecord("g:u", "xin chào", 19_998, 10_000), true);
		assert.equal(tracker.checkAndRecord("g:u", "xin chào", 29_998, 10_000), false);
		assert.equal(tracker.checkAndRecord("g:other", "xin chào", 29_998, 10_000), false);
	});

	test("window = 0 tắt chống trùng và bỏ lịch sử của người đó", () =>
	{
		const tracker = new DuplicateTracker();
		tracker.checkAndRecord("g:u", "xin chào", 0, 10_000);
		assert.equal(tracker.checkAndRecord("g:u", "xin chào", 1, 0), false);
		assert.equal(tracker.checkAndRecord("g:u", "xin chào", 2, 0), false);
		assert.equal(tracker.trackedKeys, 0);
	});

	test("dọn nội dung hết hạn theo từng người và quét toàn bộ định kỳ", () =>
	{
		const tracker = new DuplicateTracker({ sweepIntervalMs: 60_000 });
		tracker.checkAndRecord("g:u1", "một", 0, 10_000);
		tracker.checkAndRecord("g:u2", "hai", 0, 10_000);
		tracker.checkAndRecord("g:u1", "ba", 5_000, 10_000);
		assert.equal(tracker.entryCount("g:u1"), 2);

		tracker.checkAndRecord("g:u1", "bốn", 15_000, 10_000);
		assert.equal(tracker.entryCount("g:u1"), 1);
		assert.equal(tracker.trackedKeys, 2);

		tracker.checkAndRecord("g:u3", "năm", 60_000, 10_000);
		assert.equal(tracker.trackedKeys, 1);
		assert.equal(tracker.entryCount("g:u1"), 0);
		assert.equal(tracker.entryCount("g:u2"), 0);
	});

	test("giới hạn số nội dung nhớ cho mỗi người, bỏ nội dung cũ nhất", () =>
	{
		const tracker = new DuplicateTracker({ maxEntriesPerKey: 3 });
		for (const text of ["a", "b", "c", "d"]) tracker.checkAndRecord("g:u", text, 0, 60_000);
		assert.equal(tracker.entryCount("g:u"), 3);
		assert.equal(tracker.checkAndRecord("g:u", "a", 1, 60_000), false);
		assert.equal(tracker.checkAndRecord("g:u", "d", 2, 60_000), true);
		assert.equal(tracker.entryCount("g:u"), 3);
	});

	test("ContentSpamFilter: tin chỉ có file đính kèm không bị xét nội dung; min = 0 tắt kiểm tra độ dài", () =>
	{
		const filter = new ContentSpamFilter();
		const base = { key: "g:u", now: 0, minMessageLength: 5, duplicateWindowSeconds: 300 };
		assert.equal(filter.check({ ...base, content: "", hasAttachments: true }), null);
		assert.equal(filter.check({ ...base, content: " <@1> ", hasAttachments: true }), null);
		assert.equal(filter.check({ ...base, content: "", hasAttachments: false }), "too_short");
		assert.equal(filter.check({ ...base, content: "ok", hasAttachments: false, minMessageLength: 0 }), null);
		assert.equal(filter.check({ ...base, content: "ok", hasAttachments: false, minMessageLength: 0 }), "duplicate");
	});
});

describe("ActivityService.handleMessage", () =>
{
	test("tin hợp lệ được XP mặc định, ghi ledger và lưu thời điểm được XP", () =>
	{
		const { activity, deps, db, clock } = setup();
		assert.deepEqual(activity.handleMessage(message()), { awarded: true, amount: 10, totalXp: 10, levelBefore: 0, levelAfter: 0 });
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 10);
		const [event] = deps.xpLedger.recent(GUILD, USER_A, 5);
		assert.equal(event.source, "message");
		assert.equal(event.referenceId, CHANNEL_GENERAL);
		assert.equal(event.actorId, null);
		assert.equal(lastMessageXpAt(db, GUILD, USER_A), clock.now());
	});

	test("channel bị tắt XP: channel_disabled, không ghi nhận vào chống trùng", () =>
	{
		const { activity, deps } = setup();
		deps.guildConfig.setChannel(GUILD, CHANNEL_BOT, { xpEnabled: false }, ADMIN);
		assert.deepEqual(activity.handleMessage(message({ channelId: CHANNEL_BOT })), { awarded: false, reason: "channel_disabled" });
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 0);
		assert.equal(outcome(activity.handleMessage(message())), "awarded");
	});

	test("chế độ 'selected': tin ở kênh chưa bật không được XP; bật kênh thì được (DEC-037)", () =>
	{
		const { activity, deps } = setup();
		deps.guildConfig.updateSettings(GUILD, { xpChannelMode: "selected" }, ADMIN);
		assert.deepEqual(activity.handleMessage(message()), { awarded: false, reason: "channel_disabled" });
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 0);
		deps.guildConfig.setChannelsXpEnabled(GUILD, [message().channelId], true, ADMIN);
		assert.equal(outcome(activity.handleMessage(message())), "awarded");
	});

	test("tin trùng (sau chuẩn hoá) trong window: duplicate", () =>
	{
		const { activity, clock } = setup();
		assert.equal(outcome(activity.handleMessage(message())), "awarded");
		clock.advanceSeconds(61);
		assert.deepEqual(activity.handleMessage(message()), { awarded: false, reason: "duplicate" });
		clock.advanceSeconds(61);
		const disguised = "  CHÀO   buổi sáng <@300000000000000002> cả nhà <:vui:123> ";
		assert.equal(outcome(activity.handleMessage(message({ content: disguised }))), "duplicate");
		assert.equal(outcome(activity.handleMessage(message({ content: "Hôm nay deploy bản mới" }))), "awarded");
	});

	test("tin ngắn: too_short, kể cả tin rỗng hay chỉ có mention khi không có file đính kèm", () =>
	{
		const { activity, deps } = setup();
		for (const content of ["hi", "", "   ", "<@123> <:x:1>", "😀🎉🔥👍", "haaaaaaaaaaa"])
		{
			assert.deepEqual(activity.handleMessage(message({ content })), { awarded: false, reason: "too_short" }, content);
		}
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 0);
		assert.equal(outcome(activity.handleMessage(message({ content: "abcde" }))), "awarded");
	});

	test("chuỗi farm ok/haha/abc không lần nào được XP với cấu hình mặc định", () =>
	{
		const { activity, deps, clock } = setup();
		const outcomes = ["ok", "ok", "ok", "haha", "haha", "abc", "abc"].map(content =>
		{
			clock.advanceSeconds(61);
			return outcome(activity.handleMessage(message({ content })));
		});
		assert.deepEqual(outcomes, ["too_short", "duplicate", "duplicate", "too_short", "duplicate", "too_short", "duplicate"]);
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 0);
		assert.equal(deps.xpLedger.recent(GUILD, USER_A, 10).length, 0);
	});

	test("cooldown 60 giây theo người; đủ cooldown thì tin hợp lệ được XP", () =>
	{
		const { activity, deps, clock } = setup();
		assert.equal(outcome(activity.handleMessage(message({ content: "tin nhắn thứ nhất" }))), "awarded");
		clock.advanceSeconds(59);
		assert.deepEqual(activity.handleMessage(message({ content: "tin nhắn thứ hai" })), { awarded: false, reason: "cooldown" });
		clock.advance(999);
		assert.equal(outcome(activity.handleMessage(message({ content: "tin nhắn thứ ba" }))), "cooldown");
		assert.equal(outcome(activity.handleMessage(message({ userId: USER_B, content: "tin nhắn của B" }))), "awarded");
		clock.advance(1);
		assert.deepEqual(activity.handleMessage(message({ content: "tin nhắn thứ tư" })), { awarded: true, amount: 10, totalXp: 20, levelBefore: 0, levelAfter: 0 });
		assert.equal(deps.xpLedger.total(GUILD, USER_B), 10);
	});

	test("cooldown sống qua restart (lưu trong database)", () =>
	{
		const { activity, db, deps, clock } = setup();
		assert.equal(outcome(activity.handleMessage(message())), "awarded");
		const restarted = new ActivityService(db, deps);
		clock.advanceSeconds(30);
		assert.equal(outcome(restarted.handleMessage(message({ content: "sau khi khởi động lại" }))), "cooldown");
		clock.advanceSeconds(30);
		assert.equal(outcome(restarted.handleMessage(message({ content: "đã hết cooldown rồi" }))), "awarded");
	});

	test("XP mỗi tin = 0 (guild hoặc channel): no_xp, không ghi gì", () =>
	{
		const { activity, deps, db } = setup();
		deps.guildConfig.setChannel(GUILD, CHANNEL_BOT, { xpPerMessage: 0 }, ADMIN);
		assert.deepEqual(activity.handleMessage(message({ channelId: CHANNEL_BOT })), { awarded: false, reason: "no_xp" });
		deps.guildConfig.updateSettings(GUILD, { xpPerMessage: 0 }, ADMIN);
		assert.equal(outcome(activity.handleMessage(message({ content: "một tin nhắn khác" }))), "no_xp");
		assert.equal(deps.xpLedger.recent(GUILD, USER_A, 10).length, 0);
		assert.equal(lastMessageXpAt(db, GUILD, USER_A), undefined);
	});

	test("channel đè XP và cooldown của guild", () =>
	{
		const { activity, deps, clock } = setup();
		deps.guildConfig.setChannel(GUILD, CHANNEL_BOT, { xpPerMessage: 25, xpCooldownSeconds: 10 }, ADMIN);
		const inBot = (content: string): MessageXpResult => activity.handleMessage(message({ channelId: CHANNEL_BOT, content }));

		assert.deepEqual(inBot("thảo luận kỹ thuật"), { awarded: true, amount: 25, totalXp: 25, levelBefore: 0, levelAfter: 0 });
		clock.advanceSeconds(10);
		assert.equal(outcome(inBot("tiếp tục thảo luận")), "awarded");
		clock.advanceSeconds(10);
		assert.equal(outcome(activity.handleMessage(message({ content: "sang kênh chung" }))), "cooldown");
		clock.advanceSeconds(50);
		assert.deepEqual(activity.handleMessage(message({ content: "kênh chung lần nữa" })), { awarded: true, amount: 10, totalXp: 60, levelBefore: 0, levelAfter: 0 });
	});

	test("tin chỉ có file đính kèm được xét, chỉ áp dụng cooldown", () =>
	{
		const { activity, deps, clock } = setup();
		const attachmentOnly = message({ content: "", hasAttachments: true });
		assert.equal(outcome(activity.handleMessage(attachmentOnly)), "awarded");
		clock.advanceSeconds(1);
		assert.equal(outcome(activity.handleMessage(attachmentOnly)), "cooldown");
		clock.advanceSeconds(60);
		assert.equal(outcome(activity.handleMessage(message({ content: "<@123>", hasAttachments: true }))), "awarded");
		clock.advanceSeconds(60);
		assert.equal(outcome(activity.handleMessage(message({ content: "ok", hasAttachments: true }))), "too_short");
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 20);
	});

	test("hết window thì tin trùng lại được xét; window = 0 tắt chống trùng", () =>
	{
		const { activity, deps, clock } = setup();
		assert.equal(outcome(activity.handleMessage(message())), "awarded");
		clock.advanceSeconds(100);
		assert.equal(outcome(activity.handleMessage(message())), "duplicate");
		clock.advanceSeconds(299);
		assert.equal(outcome(activity.handleMessage(message())), "duplicate");
		clock.advanceSeconds(300);
		assert.equal(outcome(activity.handleMessage(message())), "awarded");

		deps.guildConfig.updateSettings(GUILD, { duplicateWindowSeconds: 0, xpCooldownSeconds: 0 }, ADMIN);
		assert.equal(outcome(activity.handleMessage(message())), "awarded");
		assert.equal(outcome(activity.handleMessage(message())), "awarded");
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 40);
	});

	test("lên level theo công thức 5n² + 50n + 100", () =>
	{
		const { activity, deps } = setup();
		deps.guildConfig.updateSettings(GUILD, { xpPerMessage: 60, xpCooldownSeconds: 0 }, ADMIN);
		assert.deepEqual(activity.handleMessage(message({ content: "tin số một" })), { awarded: true, amount: 60, totalXp: 60, levelBefore: 0, levelAfter: 0 });
		assert.deepEqual(activity.handleMessage(message({ content: "tin số hai" })), { awarded: true, amount: 60, totalXp: 120, levelBefore: 0, levelAfter: 1 });
		activity.adjustXp({ guildId: GUILD, userId: USER_A, delta: 130, actorId: ADMIN, reason: null, roleIds: [] });
		assert.deepEqual(activity.handleMessage(message({ content: "tin số ba" })), { awarded: true, amount: 60, totalXp: 310, levelBefore: 1, levelAfter: 2 });
		assert.equal(activity.getProfile(GUILD, USER_A).level.level, 2);
	});

	test("snapshot team lúc được XP (DEC-024)", () =>
	{
		const { activity, deps, clock } = setup();
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		deps.teams.add(GUILD, ROLE_FRONTEND, ADMIN);

		activity.handleMessage(message({ userId: USER_A, roleIds: [ROLE_BACKEND, ROLE_OTHER] }));
		activity.handleMessage(message({ userId: USER_B, roleIds: [ROLE_BACKEND, ROLE_FRONTEND] }));
		activity.handleMessage(message({ userId: USER_C, roleIds: [] }));
		assert.deepEqual(deps.xpLedger.teamTotals(GUILD, 10), [
			{ id: ROLE_BACKEND, total: 20 },
			{ id: ROLE_FRONTEND, total: 10 },
		]);

		clock.advanceSeconds(60);
		activity.handleMessage(message({ userId: USER_A, content: "chuyển sang team frontend", roleIds: [ROLE_FRONTEND] }));
		assert.deepEqual(deps.xpLedger.teamTotals(GUILD, 10), [
			{ id: ROLE_BACKEND, total: 20 },
			{ id: ROLE_FRONTEND, total: 20 },
		]);
	});

	test("các guild độc lập: cấu hình, cooldown, chống trùng và điểm", () =>
	{
		const { activity, deps } = setup();
		deps.guildConfig.updateSettings(OTHER_GUILD, { xpPerMessage: 30 }, ADMIN);
		deps.guildConfig.setChannel(OTHER_GUILD, CHANNEL_BOT, { xpEnabled: false }, ADMIN);

		assert.equal(outcome(activity.handleMessage(message())), "awarded");
		assert.deepEqual(activity.handleMessage(message({ guildId: OTHER_GUILD })), { awarded: true, amount: 30, totalXp: 30, levelBefore: 0, levelAfter: 0 });
		assert.equal(outcome(activity.handleMessage(message({ guildId: OTHER_GUILD, channelId: CHANNEL_BOT }))), "channel_disabled");
		assert.equal(outcome(activity.handleMessage(message({ channelId: CHANNEL_BOT, content: "kênh bot vẫn bật ở guild này" }))), "cooldown");
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 10);
		assert.equal(deps.xpLedger.total(OTHER_GUILD, USER_A), 30);
	});

	test("database không chứa nội dung tin nhắn hay hash của nội dung (DEC-023)", () =>
	{
		const { activity, deps, db, clock } = setup();
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		const secret = "Bí Mật Nội Bộ ZXQV-7781 của dự án Alpha";
		const normalized = normalizeContent(secret);
		const seen = [
			activity.handleMessage(message({ content: secret, roleIds: [ROLE_BACKEND] })),
			activity.handleMessage(message({ content: secret })),
			activity.handleMessage(message({ content: "ZXQV" })),
			activity.handleMessage(message({ content: "ZXQV-7781 lần hai", hasAttachments: true })),
			activity.handleMessage(message({ userId: USER_B, content: secret, channelId: CHANNEL_BOT })),
		].map(outcome);
		assert.deepEqual(seen, ["awarded", "duplicate", "too_short", "cooldown", "awarded"]);
		clock.advanceSeconds(3600);
		assert.equal(outcome(activity.handleMessage(message({ content: `${secret} bản cập nhật` }))), "awarded");
		activity.adjustXp({ guildId: GUILD, userId: USER_A, delta: 5, actorId: ADMIN, reason: "thưởng tuần", roleIds: [ROLE_BACKEND] });
		activity.resetUser(GUILD, USER_B, ADMIN);

		const stored = allStoredStrings(db);
		assert.ok(stored.includes("thưởng tuần"), "phép quét phải thấy được dữ liệu chuỗi đã ghi");
		const needles = [
			"zxqv",
			"bí mật",
			normalized,
			createHash("sha256").update(normalized).digest("base64"),
			createHash("sha256").update(normalized).digest("hex"),
			createHash("sha256").update(secret).digest("hex"),
		];
		for (const value of stored)
		{
			const lower = value.toLowerCase();
			for (const needle of needles) assert.ok(!lower.includes(needle.toLowerCase()), `database chứa nội dung tin nhắn: ${value}`);
		}
	});
});

describe("ActivityService: hồ sơ và thao tác admin", () =>
{
	test("getProfile: level, rank, tổng số người có XP", () =>
	{
		const { activity } = setup();
		assert.deepEqual(activity.getProfile(GUILD, USER_A), {
			userId: USER_A,
			level: { level: 0, totalXp: 0, xpIntoLevel: 0, xpForNextLevel: 100 },
			rank: null,
			totalRanked: 0,
		});
		activity.adjustXp({ guildId: GUILD, userId: USER_A, delta: 300, actorId: ADMIN, reason: null, roleIds: [] });
		activity.adjustXp({ guildId: GUILD, userId: USER_B, delta: 120, actorId: ADMIN, reason: null, roleIds: [] });
		assert.deepEqual(activity.getProfile(GUILD, USER_A), {
			userId: USER_A,
			level: { level: 2, totalXp: 300, xpIntoLevel: 45, xpForNextLevel: 220 },
			rank: 1,
			totalRanked: 2,
		});
		assert.equal(activity.getProfile(GUILD, USER_B).rank, 2);
		assert.equal(activity.getProfile(GUILD, USER_C).rank, null);
		assert.equal(activity.getProfile(OTHER_GUILD, USER_A).totalRanked, 0);
	});

	test("adjustXp cộng/trừ, ghi ledger nguồn admin kèm snapshot team và audit", () =>
	{
		const { activity, deps } = setup();
		deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		const adjust = (delta: number, reason: string | null, roleIds: string[]): { totalXp: number } =>
			activity.adjustXp({ guildId: GUILD, userId: USER_A, delta, actorId: ADMIN, reason, roleIds });

		assert.deepEqual(adjust(150, "  Thưởng sự kiện  ", [ROLE_BACKEND]), { totalXp: 150 });
		assert.deepEqual(adjust(-50, null, []), { totalXp: 100 });
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 100);
		assert.deepEqual(deps.xpLedger.teamTotals(GUILD, 10), [{ id: ROLE_BACKEND, total: 150 }]);

		const events = activity.recentEvents(GUILD, USER_A, 10);
		assert.deepEqual(events.map(e => [e.amount, e.source, e.actorId, e.reason, e.voided]), [
			[-50, "admin", ADMIN, null, false],
			[150, "admin", ADMIN, "Thưởng sự kiện", false],
		]);

		const audit = deps.audit.list(GUILD, 10).filter(entry => entry.action === "xp.adjust");
		assert.equal(audit.length, 2);
		assert.equal(audit[0].actorId, ADMIN);
		assert.equal(audit[0].targetId, USER_A);
		assert.deepEqual(audit[0].details, { delta: -50, reason: null, totalXp: 100 });
		assert.deepEqual(audit[1].details, { delta: 150, reason: "Thưởng sự kiện", totalXp: 150 });
	});

	test("adjustXp từ chối delta không hợp lệ bằng UserError", () =>
	{
		const { activity, deps } = setup();
		const adjust = (delta: number): { totalXp: number } =>
			activity.adjustXp({ guildId: GUILD, userId: USER_A, delta, actorId: ADMIN, reason: null, roleIds: [] });

		for (const delta of [0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_XP_ADJUSTMENT + 1, -MAX_XP_ADJUSTMENT - 1])
		{
			assert.throws(() => adjust(delta), UserError, String(delta));
		}
		assert.equal(deps.audit.list(GUILD, 10).length, 0);
		assert.deepEqual(adjust(MAX_XP_ADJUSTMENT), { totalXp: MAX_XP_ADJUSTMENT });
		assert.deepEqual(adjust(-MAX_XP_ADJUSTMENT), { totalXp: 0 });
	});

	test("adjustXp không cho tổng âm, không ghi gì khi bị từ chối", () =>
	{
		const { activity, deps } = setup();
		const adjust = (delta: number): { totalXp: number } =>
			activity.adjustXp({ guildId: GUILD, userId: USER_A, delta, actorId: ADMIN, reason: "trừ", roleIds: [] });

		adjust(30);
		assert.throws(() => adjust(-31), (error: unknown) => error instanceof UserError && /hiện có 30 XP/.test(error.message));
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 30);
		assert.equal(deps.xpLedger.recent(GUILD, USER_A, 10).length, 1);
		assert.equal(deps.audit.list(GUILD, 10).length, 1);
		assert.deepEqual(adjust(-30), { totalXp: 0 });
	});

	test("resetUser huỷ event (không xoá), đưa tổng về 0, ghi audit", () =>
	{
		const { activity, deps, db } = setup();
		activity.handleMessage(message());
		activity.adjustXp({ guildId: GUILD, userId: USER_A, delta: 40, actorId: ADMIN, reason: null, roleIds: [] });
		activity.handleMessage(message({ userId: USER_B }));

		assert.deepEqual(activity.resetUser(GUILD, USER_A, ADMIN), { voidedEvents: 2 });
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 0);
		assert.equal(deps.xpLedger.total(GUILD, USER_B), 10);
		assert.equal(activity.getProfile(GUILD, USER_A).rank, null);
		assert.ok(activity.recentEvents(GUILD, USER_A, 10).every(e => e.voided));
		assert.equal(db.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM xp_events").get()?.n, 3);

		const [entry] = deps.audit.list(GUILD, 1);
		assert.equal(entry.action, "xp.reset_user");
		assert.equal(entry.targetId, USER_A);
		assert.deepEqual(entry.details, { voidedEvents: 2 });
		assert.deepEqual(activity.resetUser(GUILD, USER_A, ADMIN), { voidedEvents: 0 });
	});

	test("resetAll chỉ ảnh hưởng guild được chọn, ghi audit", () =>
	{
		const { activity, deps } = setup();
		activity.handleMessage(message());
		activity.adjustXp({ guildId: GUILD, userId: USER_B, delta: 20, actorId: ADMIN, reason: null, roleIds: [] });
		activity.handleMessage(message({ guildId: OTHER_GUILD }));

		assert.deepEqual(activity.resetAll(GUILD, ADMIN), { voidedEvents: 2, members: 2 });
		assert.equal(deps.xpLedger.total(GUILD, USER_A), 0);
		assert.equal(deps.xpLedger.total(GUILD, USER_B), 0);
		assert.equal(deps.xpLedger.countRanked(GUILD), 0);
		assert.equal(deps.xpLedger.total(OTHER_GUILD, USER_A), 10);

		const [entry] = deps.audit.list(GUILD, 1);
		assert.equal(entry.action, "xp.reset_all");
		assert.equal(entry.targetId, null);
		assert.deepEqual(entry.details, { voidedEvents: 2, members: 2 });
		assert.equal(deps.audit.list(OTHER_GUILD, 10).length, 0);
	});

	test("recentEvents: map đúng trường, mới nhất trước, kẹp limit trong 1..50", () =>
	{
		const { activity, clock } = setup();
		activity.handleMessage(message());
		for (let i = 1; i <= 60; i++)
		{
			clock.advanceSeconds(1);
			activity.adjustXp({ guildId: GUILD, userId: USER_A, delta: i, actorId: ADMIN, reason: null, roleIds: [] });
		}

		assert.equal(activity.recentEvents(GUILD, USER_A, 100).length, MAX_RECENT_EVENTS);
		assert.equal(activity.recentEvents(GUILD, USER_A, 0).length, 1);
		assert.equal(activity.recentEvents(GUILD, USER_A, -5).length, 1);
		assert.equal(activity.recentEvents(GUILD, USER_A, Number.NaN).length, 1);
		assert.deepEqual(activity.recentEvents(GUILD, USER_A, 3).map(e => e.amount), [60, 59, 58]);
		assert.equal(activity.recentEvents(OTHER_GUILD, USER_A, 5).length, 0);
	});

	test("recentEvents: event từ tin nhắn có nguồn message, referenceId là channel", () =>
	{
		const { activity, clock } = setup();
		activity.handleMessage(message({ channelId: CHANNEL_BOT }));
		const [event] = activity.recentEvents(GUILD, USER_A, 5);
		assert.deepEqual(event, {
			id: event.id,
			amount: 10,
			source: "message",
			referenceId: CHANNEL_BOT,
			actorId: null,
			reason: null,
			createdAt: clock.now(),
			voided: false,
		});
	});
});
