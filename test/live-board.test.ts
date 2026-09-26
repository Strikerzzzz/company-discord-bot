import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { LiveBoardService } from "../src/modules/live-board/LiveBoardService";
import { ADMIN, CHANNEL_BOT, CHANNEL_GENERAL, createTestContext, GUILD, OTHER_GUILD, TestContext, USER_A } from "./helpers";

const MESSAGE_ID = "600000000000000001";
const OTHER_MESSAGE_ID = "600000000000000002";

function setup(): TestContext & { boards: LiveBoardService }
{
	const context = createTestContext();
	return { ...context, boards: new LiveBoardService(context.db, context.clock, context.deps.audit) };
}

function boardAudits(context: TestContext, guildId = GUILD): { action: string; actorId: string; targetId: string | null; details: unknown }[]
{
	return context.deps.audit.list(guildId, 100)
		.filter(entry => entry.action === "board.set" || entry.action === "board.clear")
		.map(entry => ({ action: entry.action, actorId: entry.actorId, targetId: entry.targetId, details: entry.details }))
		.reverse();
}

describe("LiveBoardService.setChannel", () =>
{
	test("chưa bật thì get null, listAll rỗng", () =>
	{
		const { boards } = setup();
		assert.equal(boards.get(GUILD), null);
		assert.deepEqual(boards.listAll(), []);
	});

	test("bật lần đầu: chưa có message, previous null, ghi audit board.set (target = channel)", () =>
	{
		const context = setup();
		const { boards, clock } = context;
		const { board, previous } = boards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);

		assert.deepEqual(board, { guildId: GUILD, channelId: CHANNEL_GENERAL, messageId: null, updatedAt: clock.now() });
		assert.equal(previous, null);
		assert.deepEqual(boards.get(GUILD), board);
		assert.deepEqual(boardAudits(context), [{ action: "board.set", actorId: ADMIN, targetId: CHANNEL_GENERAL, details: null }]);
	});

	test("chuyển channel: trả bảng cũ (kèm message cũ để tầng Discord xoá), message mới về null", () =>
	{
		const context = setup();
		const { boards, clock } = context;
		boards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		boards.setMessage(GUILD, CHANNEL_GENERAL, MESSAGE_ID);
		const before = boards.get(GUILD);

		clock.advanceSeconds(60);
		const { board, previous } = boards.setChannel(GUILD, CHANNEL_BOT, USER_A);
		assert.deepEqual(previous, before);
		assert.equal(previous?.messageId, MESSAGE_ID);
		assert.deepEqual(board, { guildId: GUILD, channelId: CHANNEL_BOT, messageId: null, updatedAt: clock.now() });
		assert.deepEqual(boardAudits(context).map(entry => [entry.actorId, entry.targetId]), [[ADMIN, CHANNEL_GENERAL], [USER_A, CHANNEL_BOT]]);
	});

	test("đặt lại đúng channel đang dùng: vẫn đưa message về null để bot đăng lại, vẫn ghi audit", () =>
	{
		const context = setup();
		const { boards } = context;
		boards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		boards.setMessage(GUILD, CHANNEL_GENERAL, MESSAGE_ID);

		const { board, previous } = boards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		assert.equal(previous?.channelId, CHANNEL_GENERAL);
		assert.equal(previous?.messageId, MESSAGE_ID);
		assert.equal(board.channelId, CHANNEL_GENERAL);
		assert.equal(board.messageId, null);
		assert.equal(boardAudits(context).length, 2);
	});
});

describe("LiveBoardService.setMessage", () =>
{
	test("lưu message khi Bảng vàng vẫn ở đúng channel; lưu null khi message không còn; không ghi audit", () =>
	{
		const context = setup();
		const { boards, clock } = context;
		boards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);

		clock.advanceSeconds(30);
		assert.equal(boards.setMessage(GUILD, CHANNEL_GENERAL, MESSAGE_ID), true);
		assert.deepEqual(boards.get(GUILD), { guildId: GUILD, channelId: CHANNEL_GENERAL, messageId: MESSAGE_ID, updatedAt: clock.now() });

		assert.equal(boards.setMessage(GUILD, CHANNEL_GENERAL, null), true);
		assert.equal(boards.get(GUILD)?.messageId, null);
		assert.equal(boardAudits(context).length, 1);
	});

	test("không ghi khi admin đã chuyển channel trong lúc bot đang đăng, khi Bảng vàng đã tắt, hay khi sai guild", () =>
	{
		const { boards } = setup();
		boards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		boards.setChannel(GUILD, CHANNEL_BOT, ADMIN);
		assert.equal(boards.setMessage(GUILD, CHANNEL_GENERAL, MESSAGE_ID), false);
		assert.equal(boards.get(GUILD)?.messageId, null);

		assert.equal(boards.setMessage(OTHER_GUILD, CHANNEL_BOT, MESSAGE_ID), false);
		assert.equal(boards.get(OTHER_GUILD), null);

		boards.disable(GUILD, ADMIN);
		assert.equal(boards.setMessage(GUILD, CHANNEL_BOT, OTHER_MESSAGE_ID), false);
		assert.equal(boards.get(GUILD), null);
	});
});

describe("LiveBoardService.disable", () =>
{
	test("tắt: xoá cấu hình, trả bảng cũ, audit board.clear với channel cũ; đang tắt thì trả null, không audit", () =>
	{
		const context = setup();
		const { boards } = context;
		assert.equal(boards.disable(GUILD, ADMIN), null);
		assert.equal(boardAudits(context).length, 0);

		boards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		boards.setMessage(GUILD, CHANNEL_GENERAL, MESSAGE_ID);
		const before = boards.get(GUILD);

		assert.deepEqual(boards.disable(GUILD, USER_A), before);
		assert.equal(boards.get(GUILD), null);
		assert.deepEqual(boards.listAll(), []);
		assert.equal(boards.disable(GUILD, USER_A), null);
		assert.deepEqual(boardAudits(context), [
			{ action: "board.set", actorId: ADMIN, targetId: CHANNEL_GENERAL, details: null },
			{ action: "board.clear", actorId: USER_A, targetId: CHANNEL_GENERAL, details: null },
		]);
	});

	test("bật lại sau khi tắt thì previous là null", () =>
	{
		const { boards } = setup();
		boards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		boards.disable(GUILD, ADMIN);
		assert.equal(boards.setChannel(GUILD, CHANNEL_BOT, ADMIN).previous, null);
	});
});

describe("LiveBoardService: nhiều guild", () =>
{
	test("listAll trả mọi Bảng vàng đang bật, sắp theo guild_id; các guild độc lập", () =>
	{
		const context = setup();
		const { boards } = context;
		boards.setChannel(OTHER_GUILD, CHANNEL_BOT, ADMIN);
		boards.setChannel(GUILD, CHANNEL_GENERAL, ADMIN);
		boards.setMessage(OTHER_GUILD, CHANNEL_BOT, OTHER_MESSAGE_ID);

		assert.deepEqual(boards.listAll().map(board => [board.guildId, board.channelId, board.messageId]), [
			[GUILD, CHANNEL_GENERAL, null],
			[OTHER_GUILD, CHANNEL_BOT, OTHER_MESSAGE_ID],
		]);

		boards.disable(GUILD, ADMIN);
		assert.deepEqual(boards.listAll().map(board => board.guildId), [OTHER_GUILD]);
		assert.equal(boardAudits(context, OTHER_GUILD).length, 1);
		assert.equal(boardAudits(context, GUILD).length, 2);
	});
});
