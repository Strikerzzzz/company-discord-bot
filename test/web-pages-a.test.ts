// Test trang web quản trị của agent A (Phase 16, DEC-039): Tổng quan, Kênh tính XP, Team. Gọi bộ xử lý thật với service thật
// trên SQLite :memory: và server Discord giả (test/web-helpers.ts); form được "gửi như trình duyệt" từ HTML trang vừa vẽ.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ChannelType } from "discord.js";
import { NO_XP_CHANNEL_WARNING } from "../src/discord/views/configPanel";
import { MAX_TEAMS } from "../src/modules/team/TeamService";
import type { WebResponse } from "../src/web/http";
import { GUILD } from "./helpers";
import {
	addChannel,
	addRole,
	ADMIN_USER,
	call,
	CATEGORY_MAIN,
	CHANNEL_ANNOUNCE,
	CHANNEL_CHAT,
	CHANNEL_VOICE,
	CHANNEL_WORK,
	createWebHarness,
	login,
	LoggedIn,
	ROLE_ADMIN_BOT,
	ROLE_ADMIN_USER,
	ROLE_MANAGED,
	ROLE_TEAM_A,
	ROLE_TEAM_B,
	WebHarness,
} from "./web-helpers";

const EVIL = "<img src=x onerror=alert(1)>";
const EVIL_ESCAPED = "&lt;img src=x onerror=alert(1)&gt;";
const ROLE_EVIL = "510000000000000009";
const ROLE_TIER = "510000000000000010";
const CHANNEL_EVIL = "410000000000000009";
const CATEGORY_EVIL = "410000000000000010";
const CHANNEL_MISSING = "499999999999999999";
const ROLE_GONE = "520000000000000999";
const ALL_XP_CHANNELS = [CHANNEL_CHAT, CHANNEL_WORK, CHANNEL_VOICE, CHANNEL_ANNOUNCE];

type Fields = [string, string][];

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

function unescapeHtml(value: string): string
{
	return value.replace(/&quot;/gu, "\"").replace(/&#39;/gu, "'").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&amp;/gu, "&");
}

/**
 * Các trường trình duyệt sẽ gửi khi bấm Lưu ở form POST tới `path`: input ẩn và ô số (kể cả trống), checkbox/radio đang tick;
 * bỏ input bị `disabled`. Chỉ đọc form của trang (không lấy form đăng xuất).
 */
function readForm(body: string, path: string): Fields
{
	const start = body.indexOf(`<form method="post" action="${pageUrl(path)}">`);
	assert.ok(start >= 0, `không thấy form của ${path}`);
	const form = body.slice(start, body.indexOf("</form>", start));
	const fields: Fields = [];
	for (const [, attributes = ""] of form.matchAll(/<input\b([^>]*)>/gu))
	{
		const attrs = new Map<string, string>();
		for (const [, name = "", value = ""] of attributes.matchAll(/([a-zA-Z_:-]+)(?:="([^"]*)")?/gu)) attrs.set(name, unescapeHtml(value));
		const name = attrs.get("name");
		if (name === undefined || attrs.has("disabled")) continue;
		const type = attrs.get("type") ?? "text";
		if ((type === "checkbox" || type === "radio") && !attrs.has("checked")) continue;
		fields.push([name, attrs.get("value") ?? ""]);
	}
	return fields;
}

/** Tick hoặc bỏ tick checkbox `name` = `value`. */
function check(fields: Fields, name: string, value: string, checked: boolean): Fields
{
	const rest = fields.filter(([key, item]) => !(key === name && item === value));
	return checked ? [...rest, [name, value]] : rest;
}

/** Đặt giá trị một trường (ô số, radio). */
function fill(fields: Fields, name: string, value: string): Fields
{
	return [...fields.filter(([key]) => key !== name), [name, value]];
}

function toForm(fields: Fields): Record<string, string[]>
{
	const form: Record<string, string[]> = {};
	for (const [name, value] of fields) (form[name] ??= []).push(value);
	return form;
}

/** Gửi form như trình duyệt; kiểm tra chuyển hướng về đúng trang (mẫu POST → chuyển hướng → GET). */
async function submit(harness: WebHarness, auth: LoggedIn, path: string, fields: Fields): Promise<WebResponse>
{
	const response = await call(harness, pageUrl(path), { form: toForm(fields), cookies: auth.cookies });
	assert.equal(response.status, 303, `POST ${path}`);
	assert.equal(response.headers.Location, pageUrl(path));
	return response;
}

/** Thông báo kết quả (flash) hiện ở lần GET kế tiếp. */
async function flashAfter(harness: WebHarness, auth: LoggedIn, path: string): Promise<{ kind: string; text: string }>
{
	const body = await getPage(harness, auth, path);
	const match = /<div class="flash (ok|error)">([\s\S]*?)<\/div>/u.exec(body);
	assert.ok(match, "không có flash");
	return { kind: match[1] ?? "", text: match[2] ?? "" };
}

async function adminPair(harness: WebHarness): Promise<[LoggedIn, LoggedIn]>
{
	harness.services.guildConfig.updateSettings(GUILD, { adminRoleId: ROLE_ADMIN_BOT }, ADMIN_USER);
	return [await login(harness, ADMIN_USER), await login(harness, ROLE_ADMIN_USER)];
}

function auditCount(harness: WebHarness): number
{
	return harness.services.audit.list(GUILD, 10_000).length;
}

function enabledChannels(harness: WebHarness): string[]
{
	return ALL_XP_CHANNELS.filter(id => harness.services.guildConfig.effectiveChannelXp(GUILD, id).enabled);
}

function addEvilData(harness: WebHarness): void
{
	addRole(harness.world, { id: ROLE_EVIL, name: EVIL, position: 1 });
	addChannel(harness.world, { id: CATEGORY_EVIL, name: EVIL, type: ChannelType.GuildCategory, position: 9 });
	addChannel(harness.world, { id: CHANNEL_EVIL, name: EVIL, type: ChannelType.GuildText, parentId: CATEGORY_EVIL, position: 10 });
	harness.services.teams.add(GUILD, ROLE_EVIL, ADMIN_USER);
	harness.services.guildConfig.setChannel(GUILD, CHANNEL_EVIL, { xpPerMessage: 7 }, ADMIN_USER);
}

describe("web trang A: hiển thị chung", () =>
{
	test("GET tổng quan, kênh, team trả 200 với đúng tiêu đề và mục menu đang chọn; tên role/kênh độc hại bị escape", async () =>
	{
		const harness = createWebHarness();
		addEvilData(harness);
		const auth = await login(harness, ADMIN_USER);
		const pages: [string, string, string][] = [["", "Tổng quan", "🏠 Tổng quan"], ["/channels", "Kênh tính XP", "📺 Kênh tính XP"], ["/teams", "Team", "👥 Team"]];
		for (const [path, title, nav] of pages)
		{
			const body = await getPage(harness, auth, path);
			assert.ok(body.includes(`<h1>${title}</h1>`), path);
			assert.ok(body.includes(`<a href="${pageUrl(path)}" class="active">${nav}</a>`), `menu ${path}`);
			assert.ok(!body.includes("<img"), `không có thẻ img lọt ra ở ${path}`);
			assert.ok(!body.includes("style=") && !body.includes("<script"), `không style/script inline ở ${path}`);
		}
		assert.ok((await getPage(harness, auth, "/teams")).includes(`@${EVIL_ESCAPED}`), "tên role độc hại hiện dạng chữ ở trang team");
		const channels = await getPage(harness, auth, "/channels");
		assert.ok(channels.includes(`#${EVIL_ESCAPED}`) && channels.includes(`📁 ${EVIL_ESCAPED}`), "tên kênh và danh mục độc hại hiện dạng chữ");
		assert.ok((await getPage(harness, auth, "")).includes(`@${EVIL_ESCAPED}`), "tên team độc hại ở trang tổng quan");
	});

	test("POST thiếu hoặc sai token CSRF ở trang kênh và trang team bị 403, không ghi gì", async () =>
	{
		const harness = createWebHarness();
		const auth = await login(harness, ADMIN_USER);
		const before = auditCount(harness);
		const channelForm = { mode: "selected", drawnMode: "all" };
		assert.equal((await call(harness, pageUrl("/channels"), { form: channelForm, cookies: auth.cookies })).status, 403);
		assert.equal((await call(harness, pageUrl("/channels"), { form: { ...channelForm, _csrf: "sai" }, cookies: auth.cookies })).status, 403);
		assert.equal((await call(harness, pageUrl("/teams"), { form: { team: ROLE_TEAM_A, [`t:${ROLE_TEAM_A}`]: "0" }, cookies: auth.cookies })).status, 403);
		assert.equal(harness.services.guildConfig.getSettings(GUILD).xpChannelMode, "all");
		assert.deepEqual(harness.services.teams.list(GUILD), []);
		assert.equal(auditCount(harness), before);
	});
});

describe("web trang A: kênh tính XP", () =>
{
	test("GET: mọi kênh tính XP được, nhóm theo danh mục; category không có ô chọn; ô tick theo trạng thái đang tính XP", async () =>
	{
		const harness = createWebHarness();
		const auth = await login(harness, ADMIN_USER);
		harness.services.guildConfig.setChannel(GUILD, CHANNEL_WORK, { xpEnabled: false, xpCooldownSeconds: 30 }, ADMIN_USER);
		const body = await getPage(harness, auth, "/channels");
		const fields = readForm(body, "/channels");
		assert.deepEqual(fields.filter(([name]) => name === "on").map(([, value]) => value).sort(), [CHANNEL_ANNOUNCE, CHANNEL_CHAT, CHANNEL_VOICE].sort());
		assert.ok(!body.includes(`value="${CATEGORY_MAIN}"`), "category không chọn được");
		assert.ok(body.includes("📁 Chung") && body.includes("Không có danh mục"));
		assert.ok(body.indexOf("thong-bao") < body.indexOf("📁 Chung"), "kênh không có danh mục đứng trước");
		assert.ok(body.indexOf("#chung") < body.indexOf("#cong-viec") && body.indexOf("#cong-viec") < body.indexOf("🔊 hop"));
		const drawn = new Map(fields.filter(([name]) => name.startsWith("d:")));
		assert.equal(drawn.get(`d:${CHANNEL_CHAT}`), "1||");
		assert.equal(drawn.get(`d:${CHANNEL_WORK}`), "0||30");
		assert.equal(new Map(fields).get("drawnMode"), "all");
		assert.equal(new Map(fields).get("mode"), "all");
		assert.ok(body.includes("cấu hình riêng") && body.includes("theo chế độ"));
		assert.ok(body.includes(`name="xp:${CHANNEL_CHAT}" value="" placeholder="10"`), "ô trống, placeholder là giá trị chung");
		assert.ok(body.includes(`name="cd:${CHANNEL_WORK}" value="30" placeholder="60"`));
		assert.ok(!body.includes("warn-box"), "chế độ tất cả kênh không cảnh báo");
	});

	test("đổi chế độ: ghi config.update; chế độ chỉ kênh được bật mà chưa bật kênh nào thì trang kênh và tổng quan cảnh báo", async () =>
	{
		const harness = createWebHarness();
		const auth = await login(harness, ADMIN_USER);
		const fields = readForm(await getPage(harness, auth, "/channels"), "/channels");
		await submit(harness, auth, "/channels", fill(fields, "mode", "selected"));
		assert.equal(harness.services.guildConfig.getSettings(GUILD).xpChannelMode, "selected");
		const [last] = harness.services.audit.list(GUILD, 1);
		assert.equal(last?.action, "config.update");
		assert.equal(last?.actorId, ADMIN_USER);
		assert.deepEqual(last?.details, { xpChannelMode: "selected" });
		const flash = await flashAfter(harness, auth, "/channels");
		assert.equal(flash.kind, "ok");
		assert.ok(flash.text.includes("Đã lưu: chế độ <strong>chỉ kênh được bật</strong>"), flash.text);
		assert.deepEqual(enabledChannels(harness), []);
		assert.ok((await getPage(harness, auth, "/channels")).includes(NO_XP_CHANNEL_WARNING));
		assert.ok((await getPage(harness, auth, "")).includes(NO_XP_CHANNEL_WARNING));

		await submit(harness, auth, "/channels", readForm(await getPage(harness, auth, "/channels"), "/channels"));
		assert.equal((await flashAfter(harness, auth, "/channels")).text, "Không có gì thay đổi.");
	});

	test("bật rồi tắt nhiều kênh một lần: effectiveChannelXp đổi, mỗi kênh một audit channel.set, flash tóm tắt", async () =>
	{
		const harness = createWebHarness();
		const auth = await login(harness, ADMIN_USER);
		harness.services.guildConfig.updateSettings(GUILD, { xpChannelMode: "selected" }, ADMIN_USER);
		let fields = readForm(await getPage(harness, auth, "/channels"), "/channels");
		for (const id of [CHANNEL_CHAT, CHANNEL_WORK, CHANNEL_ANNOUNCE]) fields = check(fields, "on", id, true);
		const before = auditCount(harness);
		await submit(harness, auth, "/channels", fields);
		assert.deepEqual(enabledChannels(harness), [CHANNEL_CHAT, CHANNEL_WORK, CHANNEL_ANNOUNCE]);
		const added = harness.services.audit.list(GUILD, 100).slice(0, auditCount(harness) - before);
		assert.deepEqual(added.map(entry => [entry.action, entry.targetId, entry.details, entry.actorId]).reverse(), [
			["channel.set", CHANNEL_CHAT, { xpEnabled: true }, ADMIN_USER],
			["channel.set", CHANNEL_WORK, { xpEnabled: true }, ADMIN_USER],
			["channel.set", CHANNEL_ANNOUNCE, { xpEnabled: true }, ADMIN_USER],
		]);
		const flash = await flashAfter(harness, auth, "/channels");
		assert.ok(flash.text.includes("bật XP 3 kênh") && flash.text.includes("#chung") && flash.text.includes("#thong-bao"), flash.text);

		fields = readForm(await getPage(harness, auth, "/channels"), "/channels");
		fields = check(check(fields, "on", CHANNEL_CHAT, false), "on", CHANNEL_WORK, false);
		await submit(harness, auth, "/channels", fields);
		assert.deepEqual(enabledChannels(harness), [CHANNEL_ANNOUNCE]);
		const [second, first] = harness.services.audit.list(GUILD, 2);
		assert.deepEqual([first?.targetId, first?.details], [CHANNEL_CHAT, { xpEnabled: false }]);
		assert.deepEqual([second?.targetId, second?.details], [CHANNEL_WORK, { xpEnabled: false }]);
		assert.ok((await flashAfter(harness, auth, "/channels")).text.includes("tắt XP 2 kênh"));
	});

	test("XP/cooldown riêng: đặt số thì lưu cấu hình riêng, để trống thì về null (dùng giá trị chung)", async () =>
	{
		const harness = createWebHarness();
		const auth = await login(harness, ADMIN_USER);
		let fields = readForm(await getPage(harness, auth, "/channels"), "/channels");
		fields = fill(fill(fields, `xp:${CHANNEL_CHAT}`, " 25 "), `cd:${CHANNEL_VOICE}`, "0");
		await submit(harness, auth, "/channels", fields);
		const { guildConfig, audit } = harness.services;
		assert.deepEqual(guildConfig.getChannel(GUILD, CHANNEL_CHAT), { channelId: CHANNEL_CHAT, xpEnabled: true, xpPerMessage: 25, xpCooldownSeconds: null });
		assert.equal(guildConfig.effectiveChannelXp(GUILD, CHANNEL_VOICE).cooldownSeconds, 0);
		assert.deepEqual(audit.list(GUILD, 2).map(entry => [entry.targetId, entry.details]).reverse(), [
			[CHANNEL_CHAT, { xpPerMessage: 25 }],
			[CHANNEL_VOICE, { xpCooldownSeconds: 0 }],
		]);
		assert.ok((await flashAfter(harness, auth, "/channels")).text.includes("đổi XP/cooldown riêng 2 kênh"));

		const body = await getPage(harness, auth, "/channels");
		assert.ok(body.includes(`name="d:${CHANNEL_CHAT}" value="1|25|"`) && body.includes(`name="xp:${CHANNEL_CHAT}" value="25"`));
		fields = fill(readForm(body, "/channels"), `xp:${CHANNEL_CHAT}`, "");
		await submit(harness, auth, "/channels", fields);
		assert.equal(guildConfig.getChannel(GUILD, CHANNEL_CHAT).xpPerMessage, null);
		assert.equal(guildConfig.effectiveChannelXp(GUILD, CHANNEL_CHAT).xpPerMessage, 10);
		const [last] = audit.list(GUILD, 1);
		assert.deepEqual([last?.action, last?.targetId, last?.details], ["channel.set", CHANNEL_CHAT, { xpPerMessage: null }]);
		assert.equal(guildConfig.getChannel(GUILD, CHANNEL_VOICE).xpCooldownSeconds, 0, "kênh không sửa giữ nguyên");
	});

	test("số sai (chữ, âm, thập phân, vượt giới hạn) bị từ chối và không ghi gì, kể cả phần hợp lệ trong cùng form", async () =>
	{
		const harness = createWebHarness();
		const auth = await login(harness, ADMIN_USER);
		const fields = readForm(await getPage(harness, auth, "/channels"), "/channels");
		const before = auditCount(harness);
		const cases: [string, string, RegExp][] = [
			[`xp:${CHANNEL_WORK}`, "abc", /XP mỗi tin nhắn phải là số nguyên từ 0 đến 1000/u],
			[`xp:${CHANNEL_WORK}`, "-5", /XP mỗi tin nhắn/u],
			[`xp:${CHANNEL_WORK}`, "1.5", /XP mỗi tin nhắn/u],
			[`xp:${CHANNEL_WORK}`, "1001", /XP mỗi tin nhắn/u],
			[`cd:${CHANNEL_WORK}`, "86401", /Cooldown \(giây\) phải là số nguyên từ 0 đến 86400/u],
		];
		for (const [name, value, message] of cases)
		{
			const valid = fill(fill(check(fields, "on", CHANNEL_CHAT, false), "mode", "selected"), `xp:${CHANNEL_ANNOUNCE}`, "40");
			await submit(harness, auth, "/channels", fill(valid, name, value));
			const flash = await flashAfter(harness, auth, "/channels");
			assert.equal(flash.kind, "error", `${name}=${value}`);
			assert.match(flash.text, message);
		}
		assert.equal(auditCount(harness), before);
		assert.equal(harness.services.guildConfig.getSettings(GUILD).xpChannelMode, "all");
		assert.deepEqual(enabledChannels(harness), ALL_XP_CHANNELS);
		assert.deepEqual(harness.services.guildConfig.listChannels(GUILD), []);
	});

	test("ID kênh lạ, category, kênh không tồn tại, thiếu trạng thái lúc vẽ đều bị từ chối và không ghi gì", async () =>
	{
		const harness = createWebHarness();
		const auth = await login(harness, ADMIN_USER);
		const fields = readForm(await getPage(harness, auth, "/channels"), "/channels");
		const before = auditCount(harness);
		const cases: [Fields, RegExp][] = [
			[[...fields, ["on", CATEGORY_MAIN], [`d:${CATEGORY_MAIN}`, "0||"]], /chỉ dùng được kênh chữ/u],
			[[...fields, [`xp:${CATEGORY_MAIN}`, "5"]], /chỉ dùng được kênh chữ/u],
			[[...fields, ["on", CHANNEL_MISSING], [`d:${CHANNEL_MISSING}`, "0||"]], /Không tìm thấy kênh/u],
			[[...fields, [`cd:${CHANNEL_MISSING}`, "5"]], /Không tìm thấy kênh/u],
			[[...fields, ["on", "abc"]], /mã kênh không hợp lệ/u],
			[[...fields, ["d:<script>", "1||"]], /mã kênh không hợp lệ/u],
			[fill(fields, `d:${CHANNEL_CHAT}`, "2|x|"), /Form đã cũ/u],
			[fields.filter(([name]) => name !== `d:${CHANNEL_WORK}`), /Form đã cũ/u],
			[fill(fields, "mode", "khac"), /Form đã cũ/u],
		];
		for (const [form, message] of cases)
		{
			await submit(harness, auth, "/channels", check(form, "on", CHANNEL_VOICE, false));
			const flash = await flashAfter(harness, auth, "/channels");
			assert.equal(flash.kind, "error");
			assert.match(flash.text, message);
			assert.ok(!flash.text.includes("<script>"));
		}
		assert.equal(auditCount(harness), before);
		assert.deepEqual(enabledChannels(harness), ALL_XP_CHANNELS);
	});

	test("hai admin cùng mở trang: B lưu từ trang cũ chỉ ghi phần B đổi, không đè kênh, số riêng và chế độ A vừa lưu", async () =>
	{
		const harness = createWebHarness();
		const [adminA, adminB] = await adminPair(harness);
		const formA = readForm(await getPage(harness, adminA, "/channels"), "/channels");
		const formB = readForm(await getPage(harness, adminB, "/channels"), "/channels");

		await submit(harness, adminA, "/channels", fill(check(formA, "on", CHANNEL_CHAT, false), `xp:${CHANNEL_WORK}`, "30"));
		await submit(harness, adminB, "/channels", check(formB, "on", CHANNEL_ANNOUNCE, false));
		const { guildConfig, audit } = harness.services;
		assert.deepEqual(enabledChannels(harness), [CHANNEL_WORK, CHANNEL_VOICE]);
		assert.equal(guildConfig.getChannel(GUILD, CHANNEL_WORK).xpPerMessage, 30);
		const [last] = audit.list(GUILD, 1);
		assert.deepEqual([last?.actorId, last?.targetId, last?.details], [ROLE_ADMIN_USER, CHANNEL_ANNOUNCE, { xpEnabled: false }]);

		const staleA = readForm(await getPage(harness, adminA, "/channels"), "/channels");
		const staleB = readForm(await getPage(harness, adminB, "/channels"), "/channels");
		await submit(harness, adminA, "/channels", fill(staleA, "mode", "selected"));
		const before = auditCount(harness);
		await submit(harness, adminB, "/channels", check(staleB, "on", CHANNEL_VOICE, false));
		assert.equal(guildConfig.getSettings(GUILD).xpChannelMode, "selected", "B không đổi lại chế độ");
		assert.equal(auditCount(harness), before, "kênh voice vốn đã tắt theo chế độ mới: không ghi");
		const flash = await flashAfter(harness, adminB, "/channels");
		assert.ok(flash.text.startsWith("Không có gì thay đổi.") && flash.text.includes("1 kênh vốn đã đúng trạng thái"), flash.text);
	});
});

describe("web trang A: team", () =>
{
	test("GET: bảng role (bỏ @everyone), role managed và role danh hiệu bị khoá kèm lý do; trạng thái lúc vẽ trong input ẩn", async () =>
	{
		const harness = createWebHarness();
		addRole(harness.world, { id: ROLE_TIER, name: "Luyện khí", position: 1 });
		harness.services.tierRoles.set(GUILD, "bac-1", ROLE_TIER, ADMIN_USER);
		harness.services.teams.add(GUILD, ROLE_TEAM_A, ADMIN_USER);
		const auth = await login(harness, ADMIN_USER);
		const body = await getPage(harness, auth, "/teams");
		assert.ok(body.includes(`Team đang có: 1/${MAX_TEAMS}`));
		assert.ok(!body.includes(`name="t:${GUILD}"`), "không có @everyone");
		assert.match(body, new RegExp(`value="${ROLE_MANAGED}" disabled>`, "u"));
		assert.match(body, new RegExp(`value="${ROLE_TIER}" disabled>`, "u"));
		assert.ok(body.includes("Role do bot hoặc integration quản lý") && body.includes("Role danh hiệu"));
		const fields = readForm(body, "/teams");
		assert.deepEqual(fields.filter(([name]) => name === "team").map(([, value]) => value), [ROLE_TEAM_A]);
		const drawn = new Map(fields);
		assert.equal(drawn.get(`t:${ROLE_TEAM_A}`), "1");
		assert.equal(drawn.get(`t:${ROLE_TEAM_B}`), "0");
		assert.ok(!body.includes("Team không còn trong server"));
	});

	test("thêm rồi bỏ nhiều role một lần: TeamService đổi, mỗi role một audit, flash tóm tắt", async () =>
	{
		const harness = createWebHarness();
		const auth = await login(harness, ADMIN_USER);
		let fields = readForm(await getPage(harness, auth, "/teams"), "/teams");
		fields = check(check(fields, "team", ROLE_TEAM_A, true), "team", ROLE_TEAM_B, true);
		await submit(harness, auth, "/teams", fields);
		const { teams, audit } = harness.services;
		assert.deepEqual([...teams.list(GUILD)].sort(), [ROLE_TEAM_A, ROLE_TEAM_B].sort());
		assert.deepEqual(audit.list(GUILD, 2).map(entry => [entry.action, entry.actorId]), [["team.add", ADMIN_USER], ["team.add", ADMIN_USER]]);
		const added = await flashAfter(harness, auth, "/teams");
		assert.ok(added.text.includes("Đã thêm") && added.text.includes("@Backend") && added.text.includes("@Frontend"), added.text);

		fields = readForm(await getPage(harness, auth, "/teams"), "/teams");
		fields = check(check(fields, "team", ROLE_TEAM_A, false), "team", ROLE_TEAM_B, false);
		await submit(harness, auth, "/teams", fields);
		assert.deepEqual(teams.list(GUILD), []);
		assert.deepEqual(audit.list(GUILD, 2).map(entry => entry.action), ["team.remove", "team.remove"]);
		assert.ok((await flashAfter(harness, auth, "/teams")).text.includes("Điểm lịch sử vẫn được giữ"));
	});

	test("gửi thẳng form (bỏ qua disabled): role managed, role danh hiệu, @everyone, role lạ bị từ chối, không ghi role hợp lệ đi kèm", async () =>
	{
		const harness = createWebHarness();
		addRole(harness.world, { id: ROLE_TIER, name: "Luyện khí", position: 1 });
		harness.services.tierRoles.set(GUILD, "bac-1", ROLE_TIER, ADMIN_USER);
		const auth = await login(harness, ADMIN_USER);
		const fields = check(readForm(await getPage(harness, auth, "/teams"), "/teams"), "team", ROLE_TEAM_A, true);
		const before = auditCount(harness);
		const cases: [Fields, RegExp][] = [
			[check(fields, "team", ROLE_MANAGED, true), /Không thể dùng role do bot hoặc integration quản lý làm team/u],
			[check(fields, "team", ROLE_TIER, true), /role của bậc danh hiệu/u],
			[[...fields, ["team", GUILD], [`t:${GUILD}`, "0"]], /Không thể dùng @everyone làm team/u],
			[[...fields, ["team", ROLE_GONE], [`t:${ROLE_GONE}`, "0"]], /Không tìm thấy role/u],
			[check(fields, "team", ROLE_TEAM_B, true).filter(([name]) => name !== `t:${ROLE_TEAM_B}`), /Form đã cũ/u],
			[fill(fields, `t:${ROLE_TEAM_B}`, "2"), /Form đã cũ/u],
			[[...fields, ["gone", ROLE_TEAM_B]], /vẫn còn trong server/u],
		];
		for (const [form, message] of cases)
		{
			await submit(harness, auth, "/teams", form);
			const flash = await flashAfter(harness, auth, "/teams");
			assert.equal(flash.kind, "error");
			assert.match(flash.text, message);
		}
		assert.deepEqual(harness.services.teams.list(GUILD), []);
		assert.equal(auditCount(harness), before);
	});

	test("vượt MAX_TEAMS thì không ghi gì; bỏ bớt trong cùng lần lưu thì thêm được", async () =>
	{
		const harness = createWebHarness();
		const existing = Array.from({ length: MAX_TEAMS - 1 }, (_, index) => `53000000000000${String(index).padStart(4, "0")}`);
		existing.forEach((id, index) => addRole(harness.world, { id, name: `Team ${index}`, position: 1 }));
		harness.services.teams.addMany(GUILD, existing, ADMIN_USER);
		const auth = await login(harness, ADMIN_USER);
		const fields = readForm(await getPage(harness, auth, "/teams"), "/teams");
		const before = auditCount(harness);

		await submit(harness, auth, "/teams", check(check(fields, "team", ROLE_TEAM_A, true), "team", ROLE_TEAM_B, true));
		const flash = await flashAfter(harness, auth, "/teams");
		assert.equal(flash.kind, "error");
		assert.ok(flash.text.includes(`tối đa ${MAX_TEAMS} team`) && flash.text.includes("Bot chưa thay đổi gì"), flash.text);
		assert.equal(harness.services.teams.list(GUILD).length, MAX_TEAMS - 1);
		assert.equal(auditCount(harness), before);

		const swap = check(check(check(fields, "team", ROLE_TEAM_A, true), "team", ROLE_TEAM_B, true), "team", existing[0] ?? "", false);
		await submit(harness, auth, "/teams", swap);
		const teams = harness.services.teams.list(GUILD);
		assert.equal(teams.length, MAX_TEAMS);
		assert.ok(teams.includes(ROLE_TEAM_A) && teams.includes(ROLE_TEAM_B) && !teams.includes(existing[0] ?? ""));
	});

	test("team có role đã bị xoá khỏi server: hiện ở mục riêng và gỡ được; ID không còn là team thì chỉ báo lại", async () =>
	{
		const harness = createWebHarness();
		harness.services.teams.addMany(GUILD, [ROLE_TEAM_A, ROLE_GONE], ADMIN_USER);
		const auth = await login(harness, ADMIN_USER);
		const body = await getPage(harness, auth, "/teams");
		assert.ok(body.includes("Team không còn trong server (1)") && body.includes(`role-không-còn (${ROLE_GONE})`));
		const fields = readForm(body, "/teams");
		await submit(harness, auth, "/teams", check(fields, "gone", ROLE_GONE, true));
		assert.deepEqual(harness.services.teams.list(GUILD), [ROLE_TEAM_A]);
		const [last] = harness.services.audit.list(GUILD, 1);
		assert.deepEqual([last?.action, last?.targetId, last?.actorId], ["team.remove", ROLE_GONE, ADMIN_USER]);
		assert.ok(!(await getPage(harness, auth, "/teams")).includes("Team không còn trong server"));

		const before = auditCount(harness);
		await submit(harness, auth, "/teams", check(fields, "gone", ROLE_GONE, true));
		const flash = await flashAfter(harness, auth, "/teams");
		assert.equal(flash.kind, "ok");
		assert.ok(flash.text.includes("Không có gì thay đổi.") && flash.text.includes("Vốn không phải team"), flash.text);
		assert.equal(auditCount(harness), before);
	});

	test("hai admin cùng mở trang: trang cũ không thêm lại team vừa bị bỏ, không bỏ team vừa được thêm", async () =>
	{
		const harness = createWebHarness();
		harness.services.teams.add(GUILD, ROLE_TEAM_A, ADMIN_USER);
		const [adminA, adminB] = await adminPair(harness);
		const formA = readForm(await getPage(harness, adminA, "/teams"), "/teams");
		const formB = readForm(await getPage(harness, adminB, "/teams"), "/teams");

		await submit(harness, adminA, "/teams", check(formA, "team", ROLE_TEAM_A, false));
		assert.deepEqual(harness.services.teams.list(GUILD), []);
		await submit(harness, adminB, "/teams", check(formB, "team", ROLE_TEAM_B, true));
		assert.deepEqual(harness.services.teams.list(GUILD), [ROLE_TEAM_B], "A đã bỏ Backend: trang cũ của B không thêm lại");
		const [last] = harness.services.audit.list(GUILD, 1);
		assert.deepEqual([last?.action, last?.targetId, last?.actorId], ["team.add", ROLE_TEAM_B, ROLE_ADMIN_USER]);

		const staleA = readForm(await getPage(harness, adminA, "/teams"), "/teams");
		await submit(harness, adminB, "/teams", check(readForm(await getPage(harness, adminB, "/teams"), "/teams"), "team", ROLE_TEAM_A, true));
		await submit(harness, adminA, "/teams", staleA);
		assert.deepEqual([...harness.services.teams.list(GUILD)].sort(), [ROLE_TEAM_A, ROLE_TEAM_B].sort(), "trang cũ của A không bỏ Backend vừa được B thêm lại");
	});
});

describe("web trang A: tổng quan", () =>
{
	test("chưa có gì: số liệu mặc định, không có hoạt động gần đây", async () =>
	{
		const harness = createWebHarness();
		const auth = await login(harness, ADMIN_USER);
		const body = await getPage(harness, auth, "");
		assert.ok(body.includes("tất cả kênh (trừ kênh đã tắt)") && body.includes("Đang tính XP: <strong>4/4</strong> kênh"), "kênh");
		assert.ok(body.includes(`Team: <strong>0/${MAX_TEAMS}</strong>`));
		assert.ok(body.includes("Bảng vàng: <strong>đang tắt</strong>"));
		assert.ok(body.includes("Role đã gán: <strong>0/8</strong> bậc"));
		assert.ok(body.includes("Chưa có thao tác quản trị nào được ghi lại."));
		assert.ok(!body.includes(NO_XP_CHANNEL_WARNING));
		for (const path of ["/channels", "/settings", "/teams", "/board", "/roles", "/tiers", "/audit"])
		{
			assert.ok(body.includes(`class="ov-more" href="${pageUrl(path)}"`), `link ${path}`);
		}
	});

	test("hiện đúng số liệu sau khi đổi cấu hình (qua web và service), kèm 5 hoạt động gần đây giờ Việt Nam", async () =>
	{
		const harness = createWebHarness();
		const auth = await login(harness, ADMIN_USER);
		const { guildConfig, teams, liveBoards, tierRoles } = harness.services;
		guildConfig.updateSettings(GUILD, { xpPerMessage: 15, adminRoleId: ROLE_ADMIN_BOT }, ADMIN_USER);
		liveBoards.setChannel(GUILD, CHANNEL_CHAT, ADMIN_USER);
		tierRoles.set(GUILD, "bac-1", ROLE_TEAM_B, ADMIN_USER);
		harness.clock.advance(60 * 60 * 1000);
		let fields = readForm(await getPage(harness, auth, "/teams"), "/teams");
		await submit(harness, auth, "/teams", check(fields, "team", ROLE_TEAM_A, true));
		fields = readForm(await getPage(harness, auth, "/channels"), "/channels");
		await submit(harness, auth, "/channels", fill(check(fields, "on", CHANNEL_WORK, false), `xp:${CHANNEL_CHAT}`, "20"));

		const body = await getPage(harness, auth, "");
		assert.ok(body.includes("Đang tính XP: <strong>3/4</strong> kênh") && body.includes("Kênh tắt riêng: <strong>1</strong>"), "kênh");
		assert.ok(body.includes("Kênh có XP hoặc cooldown riêng: <strong>1</strong>"));
		assert.ok(body.includes("XP mỗi tin nhắn: <strong>15 XP</strong>"));
		assert.ok(body.includes(`Team: <strong>1/${MAX_TEAMS}</strong>`) && body.includes("@Backend"));
		assert.ok(body.includes("Bảng vàng: <span class=\"mention\">#chung</span>"));
		assert.ok(body.includes("Role admin bot: <strong><span class=\"mention\">@Admin bot</span></strong>"));
		assert.ok(body.includes("Role đã gán: <strong>1/8</strong> bậc"));
		assert.ok(teams.list(GUILD).includes(ROLE_TEAM_A));

		const recent = body.slice(body.indexOf("📜 Hoạt động gần đây"));
		assert.equal((recent.match(/<td class="ov-time">/gu) ?? []).length, 5, "đúng 5 dòng mới nhất");
		assert.ok(recent.includes("<td class=\"ov-time\">08:00 01/01/2026</td>"), "giờ Việt Nam (UTC+7)");
		assert.ok(recent.includes("@Admin &lt;b&gt;"), "người thao tác (tên được escape)");
		assert.ok(recent.includes("<strong>Đặt cấu hình channel</strong> · <span class=\"mention\">#chung</span>"));
		assert.ok(recent.includes("XP mỗi tin nhắn: 20") && recent.includes("<strong>Thêm team</strong>"), "chi tiết audit");
		assert.ok(recent.includes("Đặt kênh Bảng vàng") && !recent.includes("Cập nhật cấu hình"), "mục cũ hơn 5 dòng không hiện");
		assert.ok(recent.includes(`href="${pageUrl("/audit")}">Xem nhật ký`));
	});

	test("chế độ chỉ kênh được bật: đếm kênh bật riêng và cảnh báo khi chưa bật kênh nào", async () =>
	{
		const harness = createWebHarness();
		const auth = await login(harness, ADMIN_USER);
		harness.services.guildConfig.updateSettings(GUILD, { xpChannelMode: "selected" }, ADMIN_USER);
		let body = await getPage(harness, auth, "");
		assert.ok(body.includes("Kênh bật riêng: <strong>0</strong>") && body.includes(NO_XP_CHANNEL_WARNING));
		harness.services.guildConfig.setChannelsXpEnabled(GUILD, [CHANNEL_CHAT, CHANNEL_MISSING], true, ADMIN_USER);
		body = await getPage(harness, auth, "");
		assert.ok(body.includes("Kênh bật riêng: <strong>1</strong>") && body.includes("Đang tính XP: <strong>1/4</strong> kênh"), "chỉ đếm kênh còn trong server");
		assert.ok(!body.includes(NO_XP_CHANNEL_WARNING));
		assert.ok(!(await getPage(harness, auth, "/channels")).includes(NO_XP_CHANNEL_WARNING));
	});
});
