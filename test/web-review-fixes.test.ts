// Test các chỗ sửa sau 2 review độc lập của Phase 17: chống gửi trùng (bấm đúp), khoá sao lưu thủ công, AdminActions mặc định
// với lỗi của Discord, lõi kiểm tra quyền xem kênh dùng chung cho lệnh và web.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import type DiscordClient from "../src/classes/DiscordClient";
import { BACKUP_IN_PROGRESS, createManualBackup, DEFAULT_ADMIN_ACTIONS, USER_LOOKUP_UNAVAILABLE } from "../src/discord/adminOps";
import { channelAccess } from "../src/discord/guards";
import { UserError } from "../src/shared/errors";
import { canViewItemChannel, lookupMember } from "../src/web/discord";
import { DUPLICATE_POST_WINDOW_MS } from "../src/web/server";
import { isSnowflake, parseUserId } from "../src/web/widgets";
import { GUILD } from "./helpers";
import { ADMIN_USER, call, CHANNEL_CHAT, createWebHarness, login, PLAIN_USER, withCsrf } from "./web-helpers";

function discordError(status: number): Error
{
	return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe("sửa sau review Phase 17", () =>
{
	test("bấm đúp: hai POST y hệt trong khoảng chống trùng chỉ cộng XP một lần; hết khoảng thì gửi lại được", async () =>
	{
		const harness = createWebHarness();
		const auth = await login(harness, ADMIN_USER);
		const form = withCsrf(auth, { u: PLAIN_USER, "so-xp": "100", huong: "cong", "ly-do": "" });
		const [first, second] = await Promise.all([
			call(harness, `/g/${GUILD}/members/xp`, { cookies: auth.cookies, form }),
			call(harness, `/g/${GUILD}/members/xp`, { cookies: auth.cookies, form }),
		]);
		assert.equal(first.status, 303);
		assert.equal(second.headers.Location, first.headers.Location);
		assert.equal(harness.services.activity.getProfile(GUILD, PLAIN_USER).level.totalXp, 100);
		assert.equal(harness.services.audit.list(GUILD, 10).filter(entry => entry.action === "xp.adjust").length, 1);

		harness.clock.advance(DUPLICATE_POST_WINDOW_MS);
		await call(harness, `/g/${GUILD}/members/xp`, { cookies: auth.cookies, form });
		assert.equal(harness.services.activity.getProfile(GUILD, PLAIN_USER).level.totalXp, 200);
	});

	test("khoá sao lưu: hai yêu cầu cùng lúc chỉ một yêu cầu chạy, yêu cầu kia bị từ chối", async () =>
	{
		const harness = createWebHarness();
		try
		{
			const results = await Promise.allSettled([
				createManualBackup(harness.services, GUILD, ADMIN_USER),
				createManualBackup(harness.services, GUILD, ADMIN_USER),
			]);
			assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
			const rejected = results.find(result => result.status === "rejected");
			assert.ok(rejected?.status === "rejected" && rejected.reason instanceof UserError && rejected.reason.message === BACKUP_IN_PROGRESS);
			assert.equal(harness.services.backup.list("manual").length, 1);
		}
		finally
		{
			rmSync(harness.services.backup.directory, { recursive: true, force: true });
		}
	});

	test("DEFAULT_ADMIN_ACTIONS.fetchUser: 404 thành null, lỗi khác thành UserError, có tài khoản thì trả cờ bot", async () =>
	{
		const clientWith = (fetch: () => Promise<{ bot: boolean }>): DiscordClient => ({ users: { fetch } }) as unknown as DiscordClient;
		assert.deepEqual(await DEFAULT_ADMIN_ACTIONS.fetchUser(clientWith(() => Promise.resolve({ bot: true })), PLAIN_USER), { bot: true });
		assert.equal(await DEFAULT_ADMIN_ACTIONS.fetchUser(clientWith(() => Promise.reject(discordError(404))), PLAIN_USER), null);
		await assert.rejects(DEFAULT_ADMIN_ACTIONS.fetchUser(clientWith(() => Promise.reject(discordError(503))), PLAIN_USER), { message: USER_LOOKUP_UNAVAILABLE });
	});

	test("channelAccess: 404 là kênh không còn, lỗi khác là không rõ; web giấu mục khi không rõ và nhớ kết quả", async () =>
	{
		const harness = createWebHarness();
		const { deps, world } = harness;
		const viewer = await lookupMember(world.guild, ADMIN_USER);
		assert.ok(viewer);
		let calls = 0;
		const fail = (status: number): void =>
		{
			Object.assign(deps.client, { channels: { fetch: (): Promise<never> =>
			{
				calls += 1;
				return Promise.reject(discordError(status));
			} } });
		};

		fail(404);
		assert.equal(await channelAccess(deps.client, GUILD, CHANNEL_CHAT, viewer), "gone");
		assert.equal(await canViewItemChannel(deps.client, world.guild, CHANNEL_CHAT, viewer, 0), true, "kênh đã xoá: admin xem được");

		fail(403);
		calls = 0;
		assert.equal(await channelAccess(deps.client, GUILD, "410000000000000555", viewer), "unknown");
		assert.equal(await canViewItemChannel(deps.client, world.guild, "410000000000000555", viewer, 1000), false);
		assert.equal(await canViewItemChannel(deps.client, world.guild, "410000000000000555", viewer, 2000), false);
		assert.equal(calls, 2, "lần thứ hai trong 1 phút dùng kết quả đã nhớ, không gọi Discord");
		await canViewItemChannel(deps.client, world.guild, "410000000000000555", viewer, 1000 + 61_000);
		assert.equal(calls, 3, "hết hạn thì hỏi lại");
	});

	test("snowflake vượt số nguyên không dấu 64 bit bị từ chối", () =>
	{
		assert.equal(isSnowflake("18446744073709551615"), true);
		assert.equal(isSnowflake("18446744073709551616"), false);
		assert.equal(parseUserId("99999999999999999999"), null);
		assert.equal(parseUserId("<@99999999999999999999>"), null);
	});

	test("form cộng/trừ XP: phải chọn Cộng hoặc Trừ (Enter không mặc định là cộng)", async () =>
	{
		const harness = createWebHarness();
		const auth = await login(harness, ADMIN_USER);
		const page = await call(harness, `/g/${GUILD}/members/view?u=${PLAIN_USER}`, { cookies: auth.cookies });
		assert.ok(page.body.includes("<input type=\"radio\" name=\"huong\" value=\"cong\" required>"));
		assert.ok(page.body.includes("<input type=\"radio\" name=\"huong\" value=\"tru\" required>"));
		const missing = await call(harness, `/g/${GUILD}/members/xp`, { cookies: auth.cookies, form: withCsrf(auth, { u: PLAIN_USER, "so-xp": "5", "ly-do": "" }) });
		assert.equal(missing.status, 303);
		assert.equal(harness.services.activity.getProfile(GUILD, PLAIN_USER).level.totalXp, 0);
	});
});
