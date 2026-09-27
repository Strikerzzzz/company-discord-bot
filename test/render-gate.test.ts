import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { cooldownMessage, DEFAULT_MAX_CONCURRENT_RENDERS, DEFAULT_RENDER_COOLDOWN_MS, RenderGate } from "../src/discord/renderGate";
import { UserError } from "../src/shared/errors";
import { USER_A, USER_B } from "./helpers";

/** Một lời hứa mở được từ bên ngoài, để giữ một lần vẽ "đang chạy" tới khi test cho phép kết thúc. */
function deferred(): { promise: Promise<void>; resolve: () => void }
{
	let resolve: () => void = () => undefined;
	const promise = new Promise<void>(done =>
	{
		resolve = done;
	});
	return { promise, resolve };
}

/** Chờ các microtask/macrotask đang xếp hàng chạy xong. */
function settle(): Promise<void>
{
	return new Promise(resolve => setImmediate(resolve));
}

describe("RenderGate: cooldown theo người", () =>
{
	test("mặc định 3 giây và tối đa 2 lần vẽ đồng thời", () =>
	{
		assert.equal(DEFAULT_RENDER_COOLDOWN_MS, 3000);
		assert.equal(DEFAULT_MAX_CONCURRENT_RENDERS, 2);
	});

	test("lần đầu được phép; trong 3 giây bị chặn và trả về thời gian còn lại; lần bị chặn không kéo dài cooldown", () =>
	{
		let now = 1_000_000;
		const gate = new RenderGate({ now: () => now });
		assert.equal(gate.tryUse(USER_A), 0);
		now += 1000;
		assert.equal(gate.tryUse(USER_A), 2000);
		now += 1999;
		assert.equal(gate.tryUse(USER_A), 1);
		now += 1;
		assert.equal(gate.tryUse(USER_A), 0, "đủ 3 giây kể từ lần được phép (không tính các lần bị chặn)");
		assert.equal(gate.tryUse(USER_A), 3000, "lần vừa được phép bắt đầu cooldown mới");
	});

	test("mỗi người một cooldown riêng", () =>
	{
		let now = 0;
		const gate = new RenderGate({ now: () => now });
		assert.equal(gate.tryUse(USER_A), 0);
		assert.equal(gate.tryUse(USER_B), 0);
		now += 500;
		assert.equal(gate.tryUse(USER_A), 2500);
		assert.equal(gate.tryUse(USER_B), 2500);
	});

	test("assertCooldown ném UserError \"Bạn thao tác nhanh quá, thử lại sau N giây nhé.\" (N làm tròn lên)", () =>
	{
		let now = 0;
		const gate = new RenderGate({ now: () => now });
		gate.assertCooldown(USER_A);
		now += 1;
		assert.throws(() => gate.assertCooldown(USER_A), (error: unknown) => error instanceof UserError && error.message === "Bạn thao tác nhanh quá, thử lại sau 3 giây nhé.");
		now += 2000;
		assert.throws(() => gate.assertCooldown(USER_A), (error: unknown) => error instanceof UserError && error.message === "Bạn thao tác nhanh quá, thử lại sau 1 giây nhé.");
		now += 999;
		gate.assertCooldown(USER_A);

		assert.equal(cooldownMessage(1), "Bạn thao tác nhanh quá, thử lại sau 1 giây nhé.");
		assert.equal(cooldownMessage(1000), "Bạn thao tác nhanh quá, thử lại sau 1 giây nhé.");
		assert.equal(cooldownMessage(1001), "Bạn thao tác nhanh quá, thử lại sau 2 giây nhé.");
		assert.equal(cooldownMessage(0), "Bạn thao tác nhanh quá, thử lại sau 1 giây nhé.");
	});

	test("Map cooldown tự dọn mục hết hạn, không phình theo số người từng dùng", () =>
	{
		let now = 0;
		const gate = new RenderGate({ now: () => now });
		for (let index = 0; index < 5000; index++) gate.tryUse(`user-${index}`);
		assert.equal(gate.trackedUsers, 5000);

		now += 1500;
		gate.tryUse("user-moi");
		assert.equal(gate.trackedUsers, 5001, "chưa hết hạn thì còn giữ");

		now += 1500;
		gate.tryUse("user-khac");
		assert.equal(gate.trackedUsers, 2, "5000 mục đã hết hạn được dọn");
		assert.equal(gate.tryUse("user-0"), 0);
	});

	test("đồng hồ hệ thống bị chỉnh lùi: không khoá người dùng lâu hơn một cooldown", () =>
	{
		let now = 10 * 60 * 60 * 1000;
		const gate = new RenderGate({ now: () => now });
		assert.equal(gate.tryUse(USER_A), 0);
		gate.tryUse(USER_B);
		now -= 60 * 60 * 1000;
		assert.equal(gate.tryUse(USER_A), 0);
		assert.equal(gate.tryUse(USER_A), 3000);
		assert.equal(gate.trackedUsers, 1, "mốc ở tương lai của USER_B được dọn");
	});

	test("cooldownMs = 0 thì không chặn", () =>
	{
		const gate = new RenderGate({ cooldownMs: 0, now: () => 5 });
		assert.equal(gate.tryUse(USER_A), 0);
		assert.equal(gate.tryUse(USER_A), 0);
	});
});

describe("RenderGate: semaphore toàn process", () =>
{
	test("tối đa 2 lần vẽ chạy cùng lúc; lần thứ 3 chờ tới khi có chỗ; thứ tự vào trước ra trước", async () =>
	{
		const gate = new RenderGate();
		const holds = [deferred(), deferred(), deferred(), deferred()];
		const started: number[] = [];
		const runs = holds.map((hold, index) => gate.run(async () =>
		{
			started.push(index);
			await hold.promise;
			return index;
		}));
		await settle();
		assert.deepEqual(started, [0, 1]);
		assert.equal(gate.activeRenders, 2);
		assert.equal(gate.queuedRenders, 2);

		holds[1].resolve();
		await settle();
		assert.deepEqual(started, [0, 1, 2], "lần chờ đầu tiên được chạy khi có chỗ");
		assert.equal(gate.activeRenders, 2);
		assert.equal(gate.queuedRenders, 1);

		holds[0].resolve();
		holds[2].resolve();
		holds[3].resolve();
		assert.deepEqual(await Promise.all(runs), [0, 1, 2, 3]);
		assert.deepEqual(started, [0, 1, 2, 3]);
		assert.equal(gate.activeRenders, 0);
		assert.equal(gate.queuedRenders, 0);
	});

	test("lỗi của lần vẽ được ném lại nguyên vẹn và vẫn trả chỗ (kể cả lỗi ném đồng bộ)", async () =>
	{
		const gate = new RenderGate({ maxConcurrent: 1 });
		await assert.rejects(gate.run(() => Promise.reject(new Error("canvas hỏng"))), /canvas hỏng/);
		await assert.rejects(gate.run((): Promise<number> =>
		{
			throw new Error("ném đồng bộ");
		}), /ném đồng bộ/);
		assert.equal(gate.activeRenders, 0);
		assert.equal(await gate.run(() => Promise.resolve("ok")), "ok");
	});

	test("maxConcurrent tuỳ chỉnh; giá trị không hợp lệ được nâng lên 1", async () =>
	{
		for (const [maxConcurrent, expected] of [[3, 3], [0, 1], [-5, 1]])
		{
			const gate = new RenderGate({ maxConcurrent });
			let active = 0;
			let peak = 0;
			await Promise.all(Array.from({ length: 6 }, () => gate.run(async () =>
			{
				active++;
				peak = Math.max(peak, active);
				await settle();
				active--;
			})));
			assert.equal(peak, expected, `maxConcurrent=${maxConcurrent}`);
		}
	});
});
