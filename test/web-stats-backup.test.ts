// Test trang "Thống kê" và "Sao lưu" của web quản trị (Phase 17, DEC-041): số liệu như `/admin stats`, giấu tên kênh riêng tư;
// sao lưu thủ công qua adminOps (audit, giới hạn 10 phút), không có đường tải file. Mỗi test sao lưu xoá thư mục backup của mình.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { ChannelType } from "discord.js";
import { MANUAL_BACKUP_COOLDOWN_MS } from "../src/discord/adminOps";
import { formatNumber } from "../src/discord/format";
import { PRIVATE_CHANNEL_LABEL } from "../src/web/format";
import { backupFileTime } from "../src/db/backup";
import { NO_BACKUPS } from "../src/web/pages/backup";
import { NO_CHANNEL_DATA } from "../src/web/pages/stats";
import { SESSION_COOKIE } from "../src/web/server";
import { formatDateTime } from "../src/web/widgets";
import { GUILD } from "./helpers";
import {
	addChannel,
	ADMIN_USER,
	call,
	CHANNEL_CHAT,
	CHANNEL_WORK,
	createWebHarness,
	ensureContributionChannel,
	login,
	LoggedIn,
	PLAIN_USER,
	ROLE_TEAM_A,
	WebHarness,
	withCsrf,
} from "./web-helpers";

const CHANNEL_SECRET = "410000000000000031";
const SECRET_NAME = "luong-thuong";
const MINUTE_MS = 60 * 1000;

function pageUrl(path: string): string
{
	return `/g/${GUILD}${path}`;
}

async function getPage(harness: WebHarness, auth: LoggedIn, path: string): Promise<string>
{
	const response = await call(harness, pageUrl(path), { cookies: auth.cookies });
	assert.equal(response.status, 200, `GET ${path}`);
	return response.body;
}

function statTile(label: string, value: number): string
{
	return `<div class="label">${label}</div><div class="value">${formatNumber(value)}</div>`;
}

/** Thông báo kết quả (flash) hiện ở lần GET kế tiếp. */
function flashOf(body: string): { kind: string; text: string } | null
{
	const match = /<div class="flash (ok|error)">([\s\S]*?)<\/div>/u.exec(body);
	return match ? { kind: match[1] ?? "", text: match[2] ?? "" } : null;
}

function manualFiles(harness: WebHarness): string[]
{
	const dir = harness.services.backup.directory;
	return existsSync(dir) ? readdirSync(dir).filter(name => name.startsWith("bot-manual-")) : [];
}

function backupAudits(harness: WebHarness): { actorId: string; file: unknown }[]
{
	return harness.services.audit.list(GUILD, 1000)
		.filter(entry => entry.action === "backup.manual")
		.map(entry => ({ actorId: entry.actorId, file: entry.details?.file }));
}

/** Chạy test với harness mới rồi luôn xoá thư mục backup của harness đó. */
async function withHarness(run: (harness: WebHarness) => Promise<void>): Promise<void>
{
	const harness = createWebHarness();
	try
	{
		await run(harness);
	}
	finally
	{
		rmSync(harness.services.backup.directory, { recursive: true, force: true });
	}
}

function awardMessage(harness: WebHarness, userId: string, channelId: string): void
{
	const result = harness.services.activity.handleMessage({ guildId: GUILD, userId, channelId, content: `Tin nhắn của ${userId}`, hasAttachments: false, roleIds: [] });
	assert.equal(result.awarded, true);
}

describe("web: trang Thống kê (DEC-041)", () =>
{
	test("chưa có dữ liệu: mọi số là 0, top kênh báo chưa có dữ liệu", async () =>
	{
		const harness = createWebHarness();
		const auth = await login(harness, ADMIN_USER);
		const body = await getPage(harness, auth, "/stats");
		assert.ok(body.includes(statTile("Thành viên có XP", 0)));
		assert.ok(body.includes(statTile("Tổng số vote", 0)));
		assert.ok(body.includes(NO_CHANNEL_DATA));
	});

	test("hiện đúng số của StatisticsService, top kênh theo thứ tự và giấu tên kênh admin không xem được, có link nhanh", async () =>
	{
		const harness = createWebHarness();
		const { services, world } = harness;
		addChannel(world, { id: CHANNEL_SECRET, name: SECRET_NAME, type: ChannelType.GuildText, permissionsByMember: { [ADMIN_USER]: [] } });
		const users = Array.from({ length: 6 }, (_, index) => `3300000000000000${String(index + 1).padStart(2, "0")}`);
		const channels = [CHANNEL_CHAT, CHANNEL_CHAT, CHANNEL_CHAT, CHANNEL_SECRET, CHANNEL_SECRET, CHANNEL_WORK];
		users.forEach((userId, index) => awardMessage(harness, userId, channels[index] ?? CHANNEL_CHAT));
		services.activity.adjustXp({ guildId: GUILD, userId: PLAIN_USER, delta: 1234, actorId: ADMIN_USER, reason: null, roleIds: [] });
		services.teams.add(GUILD, ROLE_TEAM_A, ADMIN_USER);
		ensureContributionChannel(harness);
		const contribution = services.contributions.submit({
			guildId: GUILD, authorId: PLAIN_USER, submittedBy: PLAIN_USER, title: "Viết tài liệu", description: "Mô tả", category: "y-tuong", link: null, authorRoleIds: [],
		});
		services.contributions.approve(GUILD, contribution.id, ADMIN_USER);
		const open = services.polls.create({ guildId: GUILD, creatorId: ADMIN_USER, question: "Ăn gì?", options: ["Phở", "Bún"], multiSelect: false, xpReward: 0, durationMinutes: null });
		const closed = services.polls.create({ guildId: GUILD, creatorId: ADMIN_USER, question: "Đi đâu?", options: ["Biển", "Núi"], multiSelect: false, xpReward: 0, durationMinutes: null });
		services.polls.vote({ guildId: GUILD, pollId: open.id, userId: PLAIN_USER, optionIndex: 0, roleIds: [] });
		services.polls.close({ guildId: GUILD, pollId: closed.id, actorId: ADMIN_USER, actorIsAdmin: true });

		const stats = services.statistics.summary(GUILD);
		assert.equal(stats.activity.members, 7);
		assert.equal(stats.activity.messageAwardsLast7Days, 6);
		assert.deepEqual([stats.polls.total, stats.polls.open, stats.polls.participations, stats.teams, stats.contribution.total], [2, 1, 1, 1, 1]);

		const auth = await login(harness, ADMIN_USER);
		const body = await getPage(harness, auth, "/stats");
		for (const [label, value] of [
			["Thành viên có XP", stats.activity.members],
			["Tổng XP", stats.activity.totalXp],
			["XP trong 7 ngày", stats.activity.xpLast7Days],
			["Lượt được XP từ tin nhắn (7 ngày)", stats.activity.messageAwardsLast7Days],
			["Contribution còn hiệu lực", stats.contribution.total],
			["Mới trong 7 ngày", stats.contribution.last7Days],
			["Lượt ghi nhận", stats.contribution.votes],
			["Tổng điểm", stats.contribution.totalScore],
			["Tổng số vote", stats.polls.total],
			["Đang mở", stats.polls.open],
			["Lượt tham gia", stats.polls.participations],
			["Team đang cấu hình", stats.teams],
		] as const)
		{
			assert.ok(body.includes(statTile(label, value)), `${label}: ${value}`);
		}
		assert.ok(body.includes(statTile("Tổng XP", 1234 + 60)), "1.294 XP: 6 tin nhắn × 10 XP và 1.234 XP admin cộng");

		const chat = body.indexOf("<td>#chung</td><td class=\"num\">3</td>");
		const secret = body.indexOf(`<td>${PRIVATE_CHANNEL_LABEL}</td><td class="num">2</td>`);
		const work = body.indexOf("<td>#cong-viec</td><td class=\"num\">1</td>");
		assert.ok(chat > 0 && secret > chat && work > secret, "top kênh theo số lượt, kênh riêng tư hiện tên giấu");
		assert.ok(!body.includes(SECRET_NAME), "không lộ tên kênh admin không xem được");
		for (const path of ["/leaderboard", "/contributions", "/polls"]) assert.ok(body.includes(`href="${pageUrl(path)}"`), path);
	});
});

describe("web: trang Sao lưu (DEC-041)", () =>
{
	test("tạo bản sao lưu: file xuất hiện, audit backup.manual có người thao tác, lần hai trong 10 phút bị từ chối", async () =>
	{
		await withHarness(async harness =>
		{
			const { services, clock } = harness;
			const auth = await login(harness, ADMIN_USER);
			const empty = await getPage(harness, auth, "/backup");
			assert.equal(empty.split(NO_BACKUPS).length - 1, 2, "chưa có bản thủ công lẫn tự động");
			assert.ok(empty.includes(`<form method="post" action="${pageUrl("/backup")}"><input type="hidden" name="_csrf" value="${auth.csrf}">`));
			assert.ok(!empty.includes(services.backup.directory.replace(/&/gu, "&amp;")), "không lộ đường dẫn thư mục trên server");
			assert.equal(existsSync(services.backup.directory), false, "mở trang không tạo thư mục sao lưu");

			const created = await call(harness, pageUrl("/backup"), { form: withCsrf(auth), cookies: auth.cookies });
			assert.equal(created.status, 303);
			assert.equal(created.headers.Location, pageUrl("/backup"));
			const files = manualFiles(harness);
			assert.equal(files.length, 1);
			const file = files[0] ?? "";
			assert.equal(backupFileTime(file), clock.now());
			assert.deepEqual(backupAudits(harness), [{ actorId: ADMIN_USER, file }]);

			const afterCreate = await getPage(harness, auth, "/backup");
			const ok = flashOf(afterCreate);
			assert.equal(ok?.kind, "ok");
			assert.ok(ok?.text.includes(`Đã sao lưu database: <code>${file}</code>`), ok?.text);
			assert.ok(afterCreate.includes(`<td class="bk-time">${formatDateTime(clock.now())}</td><td><code>${file}</code></td>`));

			clock.advance(5 * MINUTE_MS);
			const refused = await call(harness, pageUrl("/backup"), { form: withCsrf(auth), cookies: auth.cookies });
			assert.equal(refused.status, 303);
			assert.equal(refused.headers.Location, pageUrl("/backup"));
			const error = flashOf(await getPage(harness, auth, "/backup"));
			assert.equal(error?.kind, "error");
			assert.ok(error?.text.includes("Mỗi 10 phút chỉ tạo được một bản"), error?.text);
			assert.ok(error?.text.includes(`lúc ${formatDateTime(clock.now() - 5 * MINUTE_MS)}`), "mốc thời gian kiểu Discord đổi sang giờ Việt Nam");
			assert.ok(!error?.text.includes("&lt;t:"), error?.text);
			assert.equal(manualFiles(harness).length, 1);
			assert.equal(backupAudits(harness).length, 1);

			clock.advance(MANUAL_BACKUP_COOLDOWN_MS);
			await services.backup.createBackup("auto");
			assert.equal((await call(harness, pageUrl("/backup"), { form: withCsrf(auth), cookies: auth.cookies })).status, 303);
			const newest = manualFiles(harness).sort().at(-1) ?? "";
			const listed = await getPage(harness, auth, "/backup");
			assert.equal(manualFiles(harness).length, 2);
			const manualSection = listed.slice(listed.indexOf("Bản thủ công (2)"), listed.indexOf("Bản tự động (1)"));
			assert.ok(newest !== file && manualSection.indexOf(newest) >= 0 && manualSection.indexOf(newest) < manualSection.indexOf(file), "mới nhất trước");
			const autoFile = services.backup.list("auto")[0] ?? "";
			assert.ok(listed.indexOf(autoFile) > listed.indexOf("Bản tự động (1)"), "bản tự động nằm ở mục riêng");
			assert.ok(listed.includes("Bản thủ công (2)"));
		});
	});

	test("không có đường tải file: không link tới file .db, route lạ dưới /backup là 404", async () =>
	{
		await withHarness(async harness =>
		{
			const auth = await login(harness, ADMIN_USER);
			assert.equal((await call(harness, pageUrl("/backup"), { form: withCsrf(auth), cookies: auth.cookies })).status, 303);
			const file = manualFiles(harness)[0] ?? "";
			const body = await getPage(harness, auth, "/backup");
			assert.ok(body.includes(file));
			assert.ok(!/href="[^"]*\.db"/u.test(body), "không có link tới file sao lưu");
			assert.ok(!/\bdownload\b/u.test(body));
			for (const path of [`/backup/${file}`, `/backup/download?file=${file}`, "/backup/file"])
			{
				assert.equal((await call(harness, pageUrl(path), { cookies: auth.cookies })).status, 404, path);
			}
		});
	});

	test("POST sao lưu với token CSRF sai bị 403, không tạo file", async () =>
	{
		await withHarness(async harness =>
		{
			const auth = await login(harness, ADMIN_USER);
			const forged = await call(harness, pageUrl("/backup"), { form: { _csrf: "sai" }, cookies: auth.cookies });
			assert.equal(forged.status, 403);
			assert.deepEqual(manualFiles(harness), []);
			assert.deepEqual(backupAudits(harness), []);
		});
	});

	test("thành viên thường không vào được trang Bảng xếp hạng, Thống kê, Sao lưu và không tạo được bản sao lưu", async () =>
	{
		await withHarness(async harness =>
		{
			await assert.rejects(login(harness, PLAIN_USER), /đăng nhập thất bại/u);
			for (const path of ["/leaderboard", "/stats", "/backup"])
			{
				const { token } = harness.handler.sessions.create(PLAIN_USER, "Thường");
				assert.equal((await call(harness, pageUrl(path), { cookies: { [SESSION_COOKIE]: token } })).status, 403, path);
			}
			const { token, session } = harness.handler.sessions.create(PLAIN_USER, "Thường");
			const denied = await call(harness, pageUrl("/backup"), { form: { _csrf: session.csrf }, cookies: { [SESSION_COOKIE]: token } });
			assert.equal(denied.status, 403);
			assert.deepEqual(manualFiles(harness), []);
			assert.deepEqual(backupAudits(harness), []);
		});
	});
});
