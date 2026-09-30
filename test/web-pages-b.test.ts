import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { DEFAULT_GUILD_SETTINGS } from "../src/modules/guild-config/types";
import { NO_AUDIT_ENTRIES } from "../src/web/pages/audit";
import { BOARD_CHANGED_ELSEWHERE, BOARD_SELECT_CHANNEL } from "../src/web/pages/board";
import { SETTINGS_STALE_FORM, SETTINGS_UNCHANGED } from "../src/web/pages/settings";
import { escapeHtml } from "../src/web/html";
import { DUPLICATE_POST_WINDOW_MS } from "../src/web/server";
import { GUILD } from "./helpers";
import {
	addChannel,
	addRole,
	ADMIN_USER,
	BOT_ID,
	call,
	CATEGORY_MAIN,
	CHANNEL_ANNOUNCE,
	CHANNEL_CHAT,
	CHANNEL_VOICE,
	CHANNEL_WORK,
	createWebHarness,
	LoggedIn,
	login,
	ROLE_ADMIN_BOT,
	ROLE_ADMIN_USER,
	ROLE_TEAM_A,
	WebHarness,
} from "./web-helpers";

const EVIL = "<img src=x onerror=alert(1)>";
const ROLE_EVIL = "510000000000000009";
const CHANNEL_EVIL = "410000000000000009";
const CHANNEL_GONE = "419999999999999999";
const USER_TARGET = "310000000000000009";

function url(path: string): string
{
	return `/g/${GUILD}${path}`;
}

function unescapeHtml(text: string): string
{
	return text.replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, "\"").replace(/&#39;/gu, "'").replace(/&amp;/gu, "&");
}

function attr(tag: string, name: string): string | null
{
	const match = new RegExp(`\\s${name}="([^"]*)"`, "u").exec(tag);
	return match ? unescapeHtml(match[1] ?? "") : null;
}

function hasAttr(tag: string, name: string): boolean
{
	return new RegExp(`\\s${name}(?=[\\s>]|$)`, "u").test(tag);
}

/** Dữ liệu trình duyệt gửi khi bấm nút của form có action `path` như lúc trang được vẽ: input, checkbox đang chọn, option đang chọn. */
function drawnForm(body: string, path: string): Record<string, string>
{
	const start = body.indexOf(`action="${url(path)}"`);
	assert.ok(start >= 0, `không có form ${path}`);
	const block = body.slice(start, body.indexOf("</form>", start));
	const fields: Record<string, string> = {};
	for (const tag of block.match(/<input[^>]*>/gu) ?? [])
	{
		const name = attr(tag, "name");
		if (name === null) continue;
		if (attr(tag, "type") === "checkbox" && !hasAttr(tag, "checked")) continue;
		fields[name] = attr(tag, "value") ?? "on";
	}
	for (const match of block.matchAll(/<select[^>]*\sname="([^"]*)"[^>]*>([\s\S]*?)<\/select>/gu))
	{
		const options = [...(match[2] ?? "").matchAll(/<option([^>]*)>/gu)].map(option => option[1] ?? "");
		const chosen = options.find(option => hasAttr(option, "selected")) ?? options[0] ?? "";
		fields[match[1] ?? ""] = attr(chosen, "value") ?? "";
	}
	return fields;
}

async function page(harness: WebHarness, auth: LoggedIn, path: string): Promise<string>
{
	const response = await call(harness, url(path), { cookies: auth.cookies });
	assert.equal(response.status, 200, path);
	return response.body;
}

/** POST form rồi mở trang được chuyển hướng tới (mặc định chính `path`); trả về HTML trang đó (có flash). */
async function submit(harness: WebHarness, auth: LoggedIn, path: string, form: Record<string, string>, back = path): Promise<string>
{
	const response = await call(harness, url(path), { form, cookies: auth.cookies });
	assert.equal(response.status, 303, path);
	assert.equal(response.headers.Location, url(back));
	return page(harness, auth, back);
}

function flashOf(body: string): { kind: string; html: string } | null
{
	const match = /<div class="flash (ok|error)">([\s\S]*?)<\/div>/u.exec(body);
	return match ? { kind: match[1] ?? "", html: match[2] ?? "" } : null;
}

function expectFlash(body: string, kind: "ok" | "error", ...parts: string[]): void
{
	const flash = flashOf(body);
	assert.ok(flash, "không có flash");
	assert.equal(flash.kind, kind, flash.html);
	for (const part of parts) assert.ok(flash.html.includes(part), `flash thiếu "${part}": ${flash.html}`);
}

function auditCount(harness: WebHarness): number
{
	return harness.services.audit.list(GUILD, 1000).length;
}

async function setup(userId = ADMIN_USER): Promise<{ harness: WebHarness; auth: LoggedIn }>
{
	const harness = createWebHarness();
	return { harness, auth: await login(harness, userId) };
}

describe("web: trang cài đặt điểm", () =>
{
	test("vẽ đủ các ô số (min/max theo giới hạn), checkbox thông báo lên level và input ẩn giá trị lúc vẽ", async () =>
	{
		const { harness, auth } = await setup();
		const body = await page(harness, auth, "/settings");
		assert.match(body, /<input type="number" id="st-xpPerMessage" name="xpPerMessage" value="10" min="0" max="1000" step="1" required>/u);
		assert.match(body, /name="pollXpDailyCap" value="25" min="0" max="100000"/u);
		assert.match(body, /name="contributionVotePoints" value="1" min="0" max="100"/u);
		assert.ok(body.includes("0 = không giới hạn"));
		const form = drawnForm(body, "/settings");
		assert.equal(form._csrf, auth.csrf);
		assert.equal(form["d:xpCooldownSeconds"], "60");
		assert.equal(form.levelUpAnnouncements, "1");
		assert.equal(form["d:levelUpAnnouncements"], "1");
		for (const title of ["⭐ Activity XP", "🗳️ Vote", "🤝 Contribution"]) assert.ok(body.includes(title), title);
	});

	test("lưu chỉ các ô đã đổi: audit config.update chỉ có đúng các khoá đó", async () =>
	{
		const { harness, auth } = await setup();
		const form = drawnForm(await page(harness, auth, "/settings"), "/settings");
		const body = await submit(harness, auth, "/settings", { ...form, xpPerMessage: "15", pollXpDailyCap: "0" });
		expectFlash(body, "ok", "Đã cập nhật cài đặt điểm", "XP mỗi tin nhắn", "<strong>15 XP</strong>", "không giới hạn");

		const settings = harness.services.guildConfig.getSettings(GUILD);
		assert.equal(settings.xpPerMessage, 15);
		assert.equal(settings.pollXpDailyCap, 0);
		assert.equal(settings.xpCooldownSeconds, DEFAULT_GUILD_SETTINGS.xpCooldownSeconds);
		const [entry] = harness.services.audit.list(GUILD, 1);
		assert.equal(entry?.action, "config.update");
		assert.equal(entry.actorId, ADMIN_USER);
		assert.deepEqual(entry.details, { xpPerMessage: 15, pollXpDailyCap: 0 });
		assert.ok(body.includes("name=\"xpPerMessage\" value=\"15\""), "trang vẽ lại giá trị mới");
	});

	test("trang cũ không đè thay đổi của admin khác ở ô không sửa (kể cả checkbox)", async () =>
	{
		const { harness, auth } = await setup();
		const stale = drawnForm(await page(harness, auth, "/settings"), "/settings");
		harness.services.guildConfig.updateSettings(GUILD, { xpCooldownSeconds: 120, levelUpAnnouncements: false, contributionVotePoints: 3 }, ROLE_ADMIN_USER);

		await submit(harness, auth, "/settings", { ...stale, xpPerMessage: "20" });
		const settings = harness.services.guildConfig.getSettings(GUILD);
		assert.equal(settings.xpPerMessage, 20);
		assert.equal(settings.xpCooldownSeconds, 120);
		assert.equal(settings.levelUpAnnouncements, false);
		assert.equal(settings.contributionVotePoints, 3);
		assert.deepEqual(harness.services.audit.list(GUILD, 1)[0]?.details, { xpPerMessage: 20 });
	});

	test("số sai hoặc ngoài giới hạn: không ghi ô nào, báo lỗi kèm tên ô", async () =>
	{
		const { harness, auth } = await setup();
		const form = drawnForm(await page(harness, auth, "/settings"), "/settings");
		const before = auditCount(harness);
		const cases: [string, string, string][] = [
			["xpPerMessage", "abc", "XP mỗi tin nhắn"],
			["xpPerMessage", "1001", "XP mỗi tin nhắn"],
			["xpCooldownSeconds", "-1", "Cooldown (giây)"],
			["pollXpDailyCap", "1.000", "Giới hạn XP từ vote mỗi ngày"],
			["contributionVotePoints", "", "Điểm mỗi lượt ghi nhận"],
		];
		for (const [key, value, label] of cases)
		{
			const body = await submit(harness, auth, "/settings", { ...form, minMessageLength: "12", [key]: value });
			expectFlash(body, "error", label);
		}
		assert.equal(auditCount(harness), before);
		assert.deepEqual(harness.services.guildConfig.getSettings(GUILD), { ...DEFAULT_GUILD_SETTINGS });
	});

	test("form thiếu hoặc sai giá trị lúc vẽ bị từ chối, không ghi gì; không đổi gì thì báo không có gì thay đổi", async () =>
	{
		const { harness, auth } = await setup();
		const form = drawnForm(await page(harness, auth, "/settings"), "/settings");
		const withoutDrawn: Record<string, string> = { ...form, xpPerMessage: "30" };
		delete withoutDrawn["d:xpPerMessage"];
		expectFlash(await submit(harness, auth, "/settings", withoutDrawn), "error", SETTINGS_STALE_FORM);
		expectFlash(await submit(harness, auth, "/settings", { ...form, "d:levelUpAnnouncements": "x" }), "error", SETTINGS_STALE_FORM);
		assert.equal(auditCount(harness), 0);

		expectFlash(await submit(harness, auth, "/settings", form), "ok", SETTINGS_UNCHANGED);
		assert.equal(auditCount(harness), 0);
	});

	test("bật/tắt thông báo lên level: checkbox không gửi = tắt", async () =>
	{
		const { harness, auth } = await setup();
		const form = drawnForm(await page(harness, auth, "/settings"), "/settings");
		const off: Record<string, string> = { ...form };
		delete off.levelUpAnnouncements;
		const body = await submit(harness, auth, "/settings", off);
		expectFlash(body, "ok", "Thông báo lên level", "Tắt");
		assert.equal(harness.services.guildConfig.getSettings(GUILD).levelUpAnnouncements, false);
		assert.deepEqual(harness.services.audit.list(GUILD, 1)[0]?.details, { levelUpAnnouncements: false });

		const redrawn = drawnForm(body, "/settings");
		assert.equal(redrawn.levelUpAnnouncements, undefined, "checkbox vẽ lại ở trạng thái tắt");
		assert.equal(redrawn["d:levelUpAnnouncements"], "0");
		await submit(harness, auth, "/settings", { ...redrawn, levelUpAnnouncements: "1" });
		assert.equal(harness.services.guildConfig.getSettings(GUILD).levelUpAnnouncements, true);
	});
});

describe("web: trang Bảng vàng", () =>
{
	test("đang tắt: chọn kênh (chỉ kênh chữ/thông báo, theo vị trí), không có nút tắt; đặt kênh thì đăng bảng và ghi audit", async () =>
	{
		const { harness, auth } = await setup();
		const body = await page(harness, auth, "/board");
		assert.ok(body.includes("Đang tắt"));
		assert.ok(!body.includes(`action="${url("/board/off")}"`), "không có form tắt khi đang tắt");
		assert.ok(!body.includes(`<option value="${CHANNEL_VOICE}"`) && !body.includes(`<option value="${CATEGORY_MAIN}"`));
		const announce = body.indexOf(`<option value="${CHANNEL_ANNOUNCE}"`);
		const chat = body.indexOf(`<option value="${CHANNEL_CHAT}"`);
		const work = body.indexOf(`<option value="${CHANNEL_WORK}"`);
		assert.ok(announce >= 0 && announce < chat && chat < work, "kênh ngoài category trước, rồi theo vị trí trong category");
		assert.ok(body.includes("<optgroup label=\"Chung\">"));

		const form = drawnForm(body, "/board");
		assert.equal(form.channelId, "");
		const saved = await submit(harness, auth, "/board", { ...form, channelId: CHANNEL_CHAT });
		expectFlash(saved, "ok", "Đã đặt Bảng vàng ở", "#chung");
		assert.deepEqual(harness.boardCalls, [`refresh:${GUILD}`]);
		assert.equal(harness.services.liveBoards.get(GUILD)?.channelId, CHANNEL_CHAT);
		const [entry] = harness.services.audit.list(GUILD, 1);
		assert.equal(entry?.action, "board.set");
		assert.equal(entry.targetId, CHANNEL_CHAT);
		assert.equal(entry.actorId, ADMIN_USER);
		assert.ok(saved.includes(`action="${url("/board/off")}"`) && saved.includes("btn btn-danger"), "đang bật thì có nút tắt");
		assert.equal(drawnForm(saved, "/board").channelId, CHANNEL_CHAT, "kênh hiện tại được chọn sẵn");
	});

	test("đổi kênh thì xoá message bảng ở kênh cũ rồi đăng ở kênh mới", async () =>
	{
		const { harness, auth } = await setup();
		harness.services.liveBoards.setChannel(GUILD, CHANNEL_CHAT, ADMIN_USER);
		harness.services.liveBoards.setMessage(GUILD, CHANNEL_CHAT, "610000000000000001");
		const form = drawnForm(await page(harness, auth, "/board"), "/board");
		assert.equal(form["d:channelId"], CHANNEL_CHAT);
		await submit(harness, auth, "/board", { ...form, channelId: CHANNEL_ANNOUNCE });
		assert.deepEqual(harness.boardCalls, [`remove:${CHANNEL_CHAT}`, `refresh:${GUILD}`]);
		assert.equal(harness.services.liveBoards.get(GUILD)?.channelId, CHANNEL_ANNOUNCE);
	});

	test("người thao tác hoặc bot thiếu quyền ở kênh bị từ chối, không ghi gì", async () =>
	{
		const { harness, auth } = await setup();
		addChannel(harness.world, { id: "410000000000000006", name: "khoa-nguoi", type: ChannelType.GuildText, position: 5, permissionsByMember: { [ADMIN_USER]: [PermissionFlagsBits.ViewChannel] } });
		addChannel(harness.world, {
			id: "410000000000000007",
			name: "khoa-bot",
			type: ChannelType.GuildText,
			position: 6,
			permissionsByMember: { [BOT_ID]: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
		});
		const form = drawnForm(await page(harness, auth, "/board"), "/board");
		expectFlash(await submit(harness, auth, "/board", { ...form, channelId: "410000000000000006" }), "error", "Bạn không có quyền <strong>Send Messages</strong>", "#khoa-nguoi");
		expectFlash(await submit(harness, auth, "/board", { ...form, channelId: "410000000000000007" }), "error", "Bot thiếu quyền <strong>Attach Files</strong>");
		assert.deepEqual(harness.boardCalls, []);
		assert.equal(harness.services.liveBoards.get(GUILD), null);
		assert.equal(auditCount(harness), 0);
	});

	test("kênh voice, category, không tồn tại, chưa chọn, hoặc form thiếu giá trị lúc vẽ bị từ chối", async () =>
	{
		const { harness, auth } = await setup();
		const form = drawnForm(await page(harness, auth, "/board"), "/board");
		expectFlash(await submit(harness, auth, "/board", { ...form, channelId: CHANNEL_VOICE }), "error", "kênh chữ hoặc kênh thông báo", "🔊 hop");
		expectFlash(await submit(harness, auth, "/board", { ...form, channelId: CATEGORY_MAIN }), "error", "kênh chữ hoặc kênh thông báo");
		expectFlash(await submit(harness, auth, "/board", { ...form, channelId: CHANNEL_GONE }), "error", "Không tìm thấy kênh vừa chọn");
		expectFlash(await submit(harness, auth, "/board", { ...form, channelId: "" }), "error", BOARD_SELECT_CHANNEL);
		const noDrawn: Record<string, string> = { ...form, channelId: CHANNEL_CHAT };
		delete noDrawn["d:channelId"];
		expectFlash(await submit(harness, auth, "/board", noDrawn), "error", "Form đã cũ");
		assert.deepEqual(harness.boardCalls, []);
		assert.equal(harness.services.liveBoards.get(GUILD), null);
	});

	test("trang cũ không kéo Bảng vàng về kênh cũ; đặt lại đúng kênh hiện tại thì đăng lại bảng", async () =>
	{
		const { harness, auth } = await setup();
		harness.services.liveBoards.setChannel(GUILD, CHANNEL_CHAT, ADMIN_USER);
		const stale = drawnForm(await page(harness, auth, "/board"), "/board");
		harness.services.liveBoards.setChannel(GUILD, CHANNEL_WORK, ROLE_ADMIN_USER);
		expectFlash(await submit(harness, auth, "/board", stale), "error", BOARD_CHANGED_ELSEWHERE);
		assert.equal(harness.services.liveBoards.get(GUILD)?.channelId, CHANNEL_WORK);
		assert.deepEqual(harness.boardCalls, []);

		const fresh = drawnForm(await page(harness, auth, "/board"), "/board");
		expectFlash(await submit(harness, auth, "/board", fresh), "ok", "#cong-viec");
		assert.deepEqual(harness.boardCalls, [`refresh:${GUILD}`]);
	});

	test("tắt Bảng vàng: xoá message cũ, ghi audit; tắt lần nữa thì báo vốn đang tắt", async () =>
	{
		const { harness, auth } = await setup();
		harness.services.liveBoards.setChannel(GUILD, CHANNEL_CHAT, ADMIN_USER);
		harness.services.liveBoards.setMessage(GUILD, CHANNEL_CHAT, "610000000000000001");
		const off = drawnForm(await page(harness, auth, "/board"), "/board/off");
		const body = await submit(harness, auth, "/board/off", off, "/board");
		expectFlash(body, "ok", "Đã tắt Bảng vàng và xoá message", "#chung");
		assert.deepEqual(harness.boardCalls, [`remove:${CHANNEL_CHAT}`]);
		assert.equal(harness.services.liveBoards.get(GUILD), null);
		const [entry] = harness.services.audit.list(GUILD, 1);
		assert.equal(entry?.action, "board.clear");
		assert.equal(entry.targetId, CHANNEL_CHAT);
		assert.ok(body.includes("Đang tắt") && !body.includes(`action="${url("/board/off")}"`));

		harness.clock.advance(DUPLICATE_POST_WINDOW_MS);
		expectFlash(await submit(harness, auth, "/board/off", off, "/board"), "ok", "Bảng vàng vốn đang tắt.");
	});

	test("kênh Bảng vàng không còn: cảnh báo; tên kênh độc hại luôn bị escape", async () =>
	{
		const { harness, auth } = await setup();
		harness.services.liveBoards.setChannel(GUILD, CHANNEL_GONE, ADMIN_USER);
		const missing = await page(harness, auth, "/board");
		assert.ok(missing.includes("Bot không còn thấy kênh này") && missing.includes("kênh-không-còn"));
		assert.equal(drawnForm(missing, "/board").channelId, "", "không chọn sẵn kênh không còn");

		addChannel(harness.world, { id: CHANNEL_EVIL, name: EVIL, type: ChannelType.GuildText, position: 9 });
		const body = await page(harness, auth, "/board");
		assert.ok(!body.includes(EVIL) && body.includes(escapeHtml(EVIL)));
		const saved = await submit(harness, auth, "/board", { ...drawnForm(body, "/board"), channelId: CHANNEL_EVIL });
		assert.ok(!saved.includes(EVIL));
		expectFlash(saved, "ok", `#${escapeHtml(EVIL)}`);
	});
});

describe("web: trang nhật ký quản trị", () =>
{
	test("chưa có mục nào", async () =>
	{
		const { harness, auth } = await setup();
		assert.ok((await page(harness, auth, "/audit")).includes(NO_AUDIT_ENTRIES));
	});

	test("hiện thao tác vừa làm: giờ Việt Nam, người thao tác, hành động, đối tượng bằng tên kênh/role/người, chi tiết", async () =>
	{
		const { harness, auth } = await setup();
		await submit(harness, auth, "/roles", { ...drawnForm(await page(harness, auth, "/roles"), "/roles"), admin: ROLE_ADMIN_BOT });
		await submit(harness, auth, "/board", { ...drawnForm(await page(harness, auth, "/board"), "/board"), channelId: CHANNEL_CHAT });
		harness.services.teams.add(GUILD, ROLE_TEAM_A, ADMIN_USER);
		harness.services.audit.record(GUILD, ADMIN_USER, "xp.adjust", USER_TARGET, { delta: 5, reason: "thưởng dự_án *a* ~b~" });

		const body = await page(harness, auth, "/audit");
		assert.ok(body.includes("07:00:00"), "giờ Việt Nam (UTC+7)");
		assert.ok(body.includes("@Admin &lt;b&gt;") && body.includes(`<small class="muted au-id">${ADMIN_USER}</small>`), "người thao tác kèm ID");
		for (const text of ["Cập nhật cấu hình", "Đặt kênh Bảng vàng", "Thêm team", "Điều chỉnh XP"]) assert.ok(body.includes(text), text);
		assert.ok(body.includes("<td>#chung</td>"), "đối tượng kênh");
		assert.ok(body.includes("<td>@Backend</td>"), "đối tượng role");
		assert.ok(body.includes(`<td>người dùng ${USER_TARGET}</td>`), "đối tượng người (không có trong cache: không lặp ID)");
		assert.ok(body.includes("Role admin bot: <span class=\"mention\">@Admin bot</span>"), "chi tiết dùng tên role");
		assert.ok(body.includes("Thay đổi: +5 · Lý do: thưởng dự_án *a* ~b~"), "chữ người dùng nhập hiện nguyên văn, không có dấu \\ của markdown");
	});

	test("?so= chỉ nhận 100 hoặc 200 (mặc định 50)", async () =>
	{
		const { harness, auth } = await setup();
		for (let index = 0; index < 120; index++) harness.services.guildConfig.updateSettings(GUILD, { xpPerMessage: index % 50 }, ADMIN_USER);
		const rows = (body: string): number => body.split("<td class=\"au-time\">").length - 1;
		assert.equal(rows(await page(harness, auth, "/audit")), 50);
		assert.equal(rows(await page(harness, auth, "/audit?so=100")), 100);
		assert.equal(rows(await page(harness, auth, "/audit?so=200")), 120);
		for (const query of ["abc", "75", "1000", "100.0", "-1", ""])
		{
			assert.equal(rows(await page(harness, auth, `/audit?so=${query}`)), 50, query);
		}
	});

	test("chi tiết và đối tượng độc hại bị escape", async () =>
	{
		const { harness, auth } = await setup();
		harness.services.audit.record(GUILD, ADMIN_USER, "xp.adjust", USER_TARGET, { delta: -3, reason: `<script>alert(1)</script> ${EVIL}` });
		harness.services.audit.record(GUILD, ADMIN_USER, "backup.manual", EVIL, { file: EVIL });
		addRole(harness.world, { id: ROLE_EVIL, name: EVIL });
		harness.services.teams.add(GUILD, ROLE_EVIL, ADMIN_USER);
		const body = await page(harness, auth, "/audit");
		assert.ok(!body.includes("<script>alert(1)") && !body.includes(EVIL), "không có HTML thô");
		assert.ok(body.includes("&lt;script&gt;"));
		assert.ok(body.includes(`@${escapeHtml(EVIL)}`), "tên role độc hại được escape");
	});
});

describe("web: kênh nhận thông báo lên level (DEC-043)", () =>
{
	const PRIVATE_TEXT = "410000000000000061";
	const BOT_MUTED = "410000000000000062";

	function announceSelect(body: string): string
	{
		const match = /<select id="st-levelUpChannelId"[\s\S]*?<\/select>/u.exec(body);
		assert.ok(match, "không có ô chọn kênh thông báo");
		return match[0];
	}

	test("ô chọn có mặc định 'kênh vừa nhắn' và chỉ kênh văn bản/thông báo người đăng nhập xem được", async () =>
	{
		const { harness, auth } = await setup();
		addChannel(harness.world, { id: PRIVATE_TEXT, name: "bi-mat", type: ChannelType.GuildText, permissionsByMember: { [ADMIN_USER]: [] } });
		const select = announceSelect(await page(harness, auth, "/settings"));
		assert.ok(select.includes("<option value=\"\" selected>Kênh thành viên vừa nhắn (mặc định)</option>"), select);
		for (const id of [CHANNEL_CHAT, CHANNEL_WORK, CHANNEL_ANNOUNCE]) assert.ok(select.includes(`value="${id}"`), id);
		for (const id of [CHANNEL_VOICE, CATEGORY_MAIN, PRIVATE_TEXT]) assert.ok(!select.includes(`value="${id}"`), id);
		assert.ok(!select.includes("bi-mat"));
	});

	test("chọn kênh rồi lưu: chỉ ghi kênh thông báo, có audit; chọn lại mặc định thì về null", async () =>
	{
		const { harness, auth } = await setup();
		const form = drawnForm(await page(harness, auth, "/settings"), "/settings");
		const before = auditCount(harness);
		const body = await submit(harness, auth, "/settings", { ...form, levelUpChannelId: CHANNEL_WORK });
		expectFlash(body, "ok", "Kênh thông báo lên level", "#cong-viec");
		const settings = harness.services.guildConfig.getSettings(GUILD);
		assert.equal(settings.levelUpChannelId, CHANNEL_WORK);
		assert.equal(settings.xpPerMessage, DEFAULT_GUILD_SETTINGS.xpPerMessage);
		assert.equal(auditCount(harness), before + 1);
		assert.ok(announceSelect(body).includes(`<option value="${CHANNEL_WORK}" selected>`));

		const redrawn = drawnForm(body, "/settings");
		assert.equal(redrawn["d:levelUpChannelId"], CHANNEL_WORK);
		expectFlash(await submit(harness, auth, "/settings", { ...redrawn, levelUpChannelId: "" }), "ok", "kênh thành viên vừa nhắn");
		assert.equal(harness.services.guildConfig.getSettings(GUILD).levelUpChannelId, null);
	});

	test("từ chối kênh thoại, kênh người đăng nhập không gửi được tin, kênh bot không gửi được tin, giá trị sai định dạng", async () =>
	{
		const { harness, auth } = await setup();
		addChannel(harness.world, { id: PRIVATE_TEXT, name: "bi-mat", type: ChannelType.GuildText, permissionsByMember: { [ADMIN_USER]: [] } });
		addChannel(harness.world, { id: BOT_MUTED, name: "chi-doc", type: ChannelType.GuildText, permissionsByMember: { [BOT_ID]: [PermissionFlagsBits.ViewChannel] } });
		const form = drawnForm(await page(harness, auth, "/settings"), "/settings");
		expectFlash(await submit(harness, auth, "/settings", { ...form, levelUpChannelId: CHANNEL_VOICE }), "error", "kênh văn bản hoặc kênh thông báo");
		expectFlash(await submit(harness, auth, "/settings", { ...form, levelUpChannelId: PRIVATE_TEXT }), "error", "Bạn không có quyền");
		expectFlash(await submit(harness, auth, "/settings", { ...form, levelUpChannelId: BOT_MUTED }), "error", "Bot thiếu quyền", "Send Messages");
		expectFlash(await submit(harness, auth, "/settings", { ...form, levelUpChannelId: "abc" }), "error", SETTINGS_STALE_FORM);
		assert.equal(harness.services.guildConfig.getSettings(GUILD).levelUpChannelId, null);
	});
});
