// Test trang "Retro" của web quản trị (Phase 19, DEC-041/DEC-049): danh sách có lọc và phân trang, tạo phiên trên web (đăng tin có nút
// điền vào kênh/thread qua hàm dùng chung với /retro create), trang chi tiết (ai đã điền chỉ hiện tên, nội dung ẩn danh, xuất chữ cho
// Confluence, escape), riêng tư theo kênh, CSRF, quyền. Service thật trên SQLite :memory: và server Discord giả.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ChannelType, MessageFlags, PermissionFlagsBits } from "discord.js";
import { DOC_WRITER_OFF_NOTE, RETRO_CHANNEL_INVALID, retroDocSection } from "../src/discord/retroOps";
import { buildRetroSection } from "../src/integrations/confluence";
import { PRIVATE_CHANNEL_LABEL } from "../src/web/format";
import { escapeHtml } from "../src/web/html";
import { NAV_ITEMS } from "../src/web/layout";
import {
	CHANNEL_NOT_FOUND,
	CHOOSE_CHANNEL,
	HOURS_INVALID,
	INVALID_RETRO_ID,
	RETRO_PAGE_SIZE,
	SECRET_SESSION_NOTE,
} from "../src/web/pages/retro";
import { HIDDEN_ITEM_TEXT } from "../src/web/widgets";
import { GUILD } from "./helpers";
import { createSession, fill, flashAfter, getPage, pageUrl, post, sectionOf } from "./web-retro-helpers";
import {
	addChannel,
	ADMIN_USER,
	BOT_ID,
	call,
	CHANNEL_ANNOUNCE,
	CHANNEL_CHAT,
	CHANNEL_VOICE,
	CHANNEL_WORK,
	createWebHarness,
	login,
	PLAIN_USER,
	ROLE_ADMIN_BOT,
	ROLE_ADMIN_USER,
	ROLE_TEAM_A,
	ROLE_TEAM_B,
	WebHarness,
} from "./web-helpers";

const CHANNEL_SECRET = "410000000000000099";
const CHANNEL_NO_BOT = "410000000000000098";
const CHANNEL_READ_ONLY = "410000000000000097";
const THREAD_PUBLIC = "410000000000000096";
const THREAD_ARCHIVED = "410000000000000095";
const THREAD_PRIVATE_MEMBER = "410000000000000094";
const THREAD_PRIVATE_OTHER = "410000000000000093";
const DOC = "https://confluence.test/pages/viewpage.action?pageId=777";
const THREAD_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessagesInThreads];

/** Thêm kênh riêng tư (admin không xem được) và các kênh/thread để thử ô chọn kênh. */
function addTestChannels(harness: WebHarness): void
{
	const { world } = harness;
	addChannel(world, { id: CHANNEL_SECRET, name: "ban-giam-doc", type: ChannelType.GuildText, position: 5, permissionsByMember: { [ADMIN_USER]: [] } });
	addChannel(world, { id: CHANNEL_NO_BOT, name: "khong-co-bot", type: ChannelType.GuildText, position: 6, permissionsByMember: { [BOT_ID]: [PermissionFlagsBits.ViewChannel] } });
	addChannel(world, { id: CHANNEL_READ_ONLY, name: "chi-doc", type: ChannelType.GuildText, position: 7, permissionsByMember: { [ADMIN_USER]: [PermissionFlagsBits.ViewChannel] } });
	const threadPermissions = { [ADMIN_USER]: THREAD_PERMISSIONS, [BOT_ID]: THREAD_PERMISSIONS };
	addChannel(world, { id: THREAD_PUBLIC, name: "retro-sprint-25", type: ChannelType.PublicThread, parentId: CHANNEL_WORK, permissionsByMember: threadPermissions });
	addChannel(world, { id: THREAD_ARCHIVED, name: "retro-cu", type: ChannelType.PublicThread, parentId: CHANNEL_WORK, archived: true, permissionsByMember: threadPermissions });
	addChannel(world, {
		id: THREAD_PRIVATE_MEMBER,
		name: "team-a-rieng",
		type: ChannelType.PrivateThread,
		parentId: CHANNEL_CHAT,
		threadMembers: [ADMIN_USER],
		permissionsByMember: threadPermissions,
	});
	addChannel(world, { id: THREAD_PRIVATE_OTHER, name: "team-b-rieng", type: ChannelType.PrivateThread, parentId: CHANNEL_CHAT, permissionsByMember: threadPermissions });
}

/** Các giá trị `<option value>` của ô chọn kênh. */
function channelOptions(body: string): string[]
{
	const select = /<select id="rt-channel"[^>]*>([\s\S]*?)<\/select>/u.exec(body)?.[1] ?? "";
	return [...select.matchAll(/<option value="(\d*)"/gu)].map(match => match[1] ?? "").filter(value => value !== "");
}

describe("web: trang Retro — danh sách", () =>
{
	test("menu 🔁 Retro; danh sách có trạng thái, số người điền, tên sprint; phiên ở kênh riêng tư bị giấu tiêu đề, tên kênh và tên sprint", async () =>
	{
		const item = NAV_ITEMS.find(nav => nav.key === "retro");
		assert.deepEqual(item, { key: "retro", path: "/retro", label: "🔁 Retro", group: "Dữ liệu" });

		const harness = createWebHarness();
		addTestChannels(harness);
		const { retro } = harness.services;
		const open = createSession(harness, { title: "Retro <b>Sprint 24</b>" });
		fill(harness, open.id, PLAIN_USER, { learned: "a" });
		const done = createSession(harness, { channelId: CHANNEL_WORK, title: "Retro Sprint 23", docUrl: DOC });
		fill(harness, done.id, PLAIN_USER, { sprintName: "Tên Duy Nhất" });
		retro.close(GUILD, done.id, ADMIN_USER);
		retro.pickName({ guildId: GUILD, sessionId: done.id, name: "Tên Duy Nhất", actorId: ADMIN_USER, systemActorId: BOT_ID });
		const secret = createSession(harness, { channelId: CHANNEL_SECRET, title: "Retro bí mật" });
		fill(harness, secret.id, PLAIN_USER, { sprintName: "Tên Kín" });
		retro.close(GUILD, secret.id, ADMIN_USER);
		retro.pickName({ guildId: GUILD, sessionId: secret.id, name: "Tên Kín", actorId: ADMIN_USER, systemActorId: BOT_ID });

		const auth = await login(harness, ADMIN_USER);
		const body = await getPage(harness, auth, "/retro");
		assert.match(body, /<h1>Retro<\/h1>/u);
		assert.match(body, /3 phiên\./u);
		assert.ok(body.includes("Retro &lt;b&gt;Sprint 24&lt;/b&gt;"), "tiêu đề được escape");
		assert.ok(body.includes("🟢 Đang nhận câu trả lời"));
		assert.ok(body.includes("✅ Hoàn tất · 🏆 Tên Duy Nhất"));
		assert.ok(body.includes(`href="${pageUrl(`/retro/view?id=${open.id}`)}"`), "link tới trang chi tiết");
		assert.ok(body.includes(`href="${pageUrl("/retro/new")}"`), "nút tạo phiên");
		assert.ok(body.includes(`href="${pageUrl("/retro/settings")}"`), "link cài đặt");
		assert.ok(body.includes("chưa ghi"), "trạng thái Confluence của phiên có link");
		assert.ok(!body.includes("Retro bí mật") && !body.includes("Tên Kín") && !body.includes("ban-giam-doc"), "phiên ở kênh không xem được bị giấu");
		assert.ok(body.includes(HIDDEN_ITEM_TEXT));
		assert.ok(body.includes(PRIVATE_CHANNEL_LABEL));
		assert.ok(body.includes(`href="/g/${GUILD}/retro" class="active"`), "mục menu đang chọn");

		const doneTab = await getPage(harness, auth, "/retro?tt=done");
		assert.match(doneTab, /2 phiên\./u);
		assert.ok(!doneTab.includes("Retro &lt;b&gt;Sprint 24"), "tab Hoàn tất không có phiên đang mở");
		assert.ok(doneTab.includes(`href="${pageUrl("/retro?tt=done")}" class="active"`));
		const openTab = await getPage(harness, auth, "/retro?tt=open");
		assert.match(openTab, /1 phiên\./u);
	});

	test("phân trang 20 phiên mỗi trang, link trang giữ tab; chưa có phiên thì hướng dẫn tạo; thành viên thường không vào được", async () =>
	{
		const harness = createWebHarness();
		const auth = await login(harness, ADMIN_USER);
		assert.match(await getPage(harness, auth, "/retro"), /Chưa có phiên retro nào/u);
		await assert.rejects(login(harness, PLAIN_USER));

		for (let index = 0; index < RETRO_PAGE_SIZE + 3; index++)
		{
			const session = createSession(harness, { title: `Retro số ${index}` });
			harness.services.retro.close(GUILD, session.id, ADMIN_USER);
		}
		const first = await getPage(harness, auth, "/retro?tt=closed");
		assert.match(first, /23 phiên\./u);
		assert.ok(first.includes("Trang 1/2"));
		assert.ok(first.includes(`href="${pageUrl("/retro?tt=closed&amp;trang=2")}"`), "link trang sau giữ tab");
		const second = await getPage(harness, auth, "/retro?tt=closed&trang=2");
		assert.equal(second.split("Retro số ").length - 1, 3);
	});
});

describe("web: trang Retro — tạo phiên", () =>
{
	test("ô chọn kênh: kênh văn bản, kênh thông báo, thread đang hoạt động mà admin xem và gửi được, bot gửi được; thread nằm sau kênh cha", async () =>
	{
		const harness = createWebHarness();
		addTestChannels(harness);
		harness.services.teams.add(GUILD, ROLE_TEAM_A, ADMIN_USER);
		const auth = await login(harness, ADMIN_USER);
		const body = await getPage(harness, auth, "/retro/new");

		assert.deepEqual(channelOptions(body), [CHANNEL_CHAT, THREAD_PRIVATE_MEMBER, CHANNEL_WORK, THREAD_PUBLIC, CHANNEL_ANNOUNCE]);
		assert.ok(body.includes("#cong-viec › 🧵 retro-sprint-25"));
		assert.ok(body.includes("#chung › 🧵 team-a-rieng (thread riêng tư)"));
		assert.ok(!body.includes("ban-giam-doc") && !body.includes("team-b-rieng") && !body.includes("retro-cu"));
		assert.ok(!body.includes(`value="${CHANNEL_VOICE}"`) && !body.includes(`value="${CHANNEL_NO_BOT}"`) && !body.includes(`value="${CHANNEL_READ_ONLY}"`));
		assert.ok(body.includes(`<option value="${ROLE_TEAM_A}">@Backend</option>`), "team đã cấu hình");
		assert.ok(!body.includes(`<option value="${ROLE_TEAM_B}">`), "role chưa là team thì không có");
	});

	test("tạo phiên: bot đăng tin Components V2 có nút điền vào kênh đã chọn, lưu tin, team, link, hạn; audit với người đăng nhập", async () =>
	{
		const harness = createWebHarness();
		harness.services.teams.add(GUILD, ROLE_TEAM_A, ADMIN_USER);
		const auth = await login(harness, ADMIN_USER);
		const response = await post(harness, auth, "/retro/new", { kenh: CHANNEL_WORK, "tieu-de": "Retro <b>Sprint 25</b>", link: DOC, team: ROLE_TEAM_A, "han-gio": "24" });
		const flash = await flashAfter(harness, auth, response);
		assert.equal(flash.kind, "ok");
		assert.ok(flash.text.includes("Đã tạo phiên retro #1"), flash.text);
		assert.ok(flash.text.includes("#cong-viec"));
		assert.ok(!flash.text.includes(DOC_WRITER_OFF_NOTE), "đã bật ghi Confluence thì không có ghi chú");
		assert.equal(flash.location, pageUrl("/retro/view?id=1"));

		const session = harness.services.retro.get(GUILD, 1);
		assert.ok(session);
		assert.equal(session.channelId, CHANNEL_WORK);
		assert.equal(session.title, "Retro <b>Sprint 25</b>");
		assert.equal(session.teamRoleId, ROLE_TEAM_A);
		assert.equal(session.docUrl, DOC);
		assert.equal(session.closesAt, harness.clock.now() + 24 * 60 * 60 * 1000);
		assert.equal(session.createdBy, ADMIN_USER);
		assert.equal(session.status, "open");

		assert.equal(harness.retroPosts.length, 1);
		const [posted] = harness.retroPosts;
		assert.equal(posted.channelId, CHANNEL_WORK);
		assert.equal(posted.payload.flags, MessageFlags.IsComponentsV2);
		assert.deepEqual(posted.payload.allowedMentions, { parse: [] });
		assert.ok(JSON.stringify(posted.payload.components).includes("\"custom_id\":\"retro:fill:1\""), "tin có nút 📝 Điền retro của phiên");
		assert.equal(session.messageId, "700000000000000001", "lưu tin vừa đăng để cập nhật số người");

		const created = harness.services.audit.list(GUILD, 10).find(entry => entry.action === "retro.create");
		assert.equal(created?.actorId, ADMIN_USER);
		assert.equal(created?.targetId, CHANNEL_WORK);
		assert.ok(flash.body.includes("Retro &lt;b&gt;Sprint 25&lt;/b&gt;"), "trang chi tiết escape tiêu đề");
	});

	test("tạo phiên trong thread đang hoạt động; chưa bật ghi Confluence thì vẫn lưu link và báo", async () =>
	{
		const harness = createWebHarness();
		addTestChannels(harness);
		harness.deps.retroActions = { ...harness.deps.retroActions, docWriter: null };
		const auth = await login(harness, ADMIN_USER);
		const flash = await flashAfter(harness, auth, await post(harness, auth, "/retro/new", { kenh: THREAD_PUBLIC, "tieu-de": "Retro trong thread", link: DOC }));
		assert.equal(flash.kind, "ok");
		assert.ok(flash.text.includes("Bot chưa bật ghi Confluence"), flash.text);
		assert.equal(harness.services.retro.get(GUILD, 1)?.channelId, THREAD_PUBLIC);
		assert.equal(harness.retroPosts[0]?.channelId, THREAD_PUBLIC);
	});

	test("kênh không hợp lệ, không xem được, admin hoặc bot thiếu quyền, kênh đã có phiên mở, team hay hạn sai: báo lỗi, không tạo gì", async () =>
	{
		const harness = createWebHarness();
		addTestChannels(harness);
		const auth = await login(harness, ADMIN_USER);
		const base = { "tieu-de": "Retro Sprint 25" };
		const cases: [Record<string, string>, string][] = [
			[{ ...base, kenh: "" }, CHOOSE_CHANNEL],
			[{ ...base, kenh: "abc" }, CHANNEL_NOT_FOUND],
			[{ ...base, kenh: "410000000000000001234" }, CHANNEL_NOT_FOUND],
			[{ ...base, kenh: "419999999999999999" }, CHANNEL_NOT_FOUND],
			[{ ...base, kenh: CHANNEL_SECRET }, CHANNEL_NOT_FOUND],
			[{ ...base, kenh: THREAD_PRIVATE_OTHER }, CHANNEL_NOT_FOUND],
			[{ ...base, kenh: CHANNEL_VOICE }, RETRO_CHANNEL_INVALID],
			[{ ...base, kenh: THREAD_ARCHIVED }, RETRO_CHANNEL_INVALID],
			[{ ...base, kenh: CHANNEL_READ_ONLY }, "Bạn không có quyền xem hoặc gửi tin nhắn ở"],
			[{ ...base, kenh: CHANNEL_NO_BOT }, "Bot thiếu quyền"],
			[{ ...base, kenh: CHANNEL_CHAT, team: ROLE_TEAM_B }, "Role team phải là một team đã cấu hình"],
			[{ ...base, kenh: CHANNEL_CHAT, team: "abc" }, "Team không hợp lệ"],
			[{ ...base, kenh: CHANNEL_CHAT, "han-gio": "abc" }, HOURS_INVALID],
			[{ ...base, kenh: CHANNEL_CHAT, "han-gio": "0" }, "Hạn phải là số giờ nguyên"],
			[{ "tieu-de": "ab", kenh: CHANNEL_CHAT }, "Tên phiên retro phải dài từ 3 đến 100 ký tự."],
			[{ ...base, kenh: CHANNEL_CHAT, link: "javascript:alert(1)" }, "Link tài liệu không hợp lệ"],
		];
		for (const [form, message] of cases)
		{
			const flash = await flashAfter(harness, auth, await post(harness, auth, "/retro/new", form));
			assert.equal(flash.kind, "error", JSON.stringify(form));
			assert.ok(flash.text.includes(escapeHtml(message)), `${JSON.stringify(form)}: ${flash.text}`);
			assert.equal(flash.location, pageUrl("/retro/new"));
		}
		assert.equal(harness.services.retro.listPage(GUILD, { status: "all", page: 1, pageSize: 10 }).total, 0);
		assert.equal(harness.retroPosts.length, 0);

		createSession(harness, { channelId: CHANNEL_CHAT });
		const busy = await flashAfter(harness, auth, await post(harness, auth, "/retro/new", { ...base, kenh: CHANNEL_CHAT }));
		assert.equal(busy.kind, "error");
		assert.match(busy.text, /đang có phiên retro #1 .* chưa đóng/u);
		assert.equal(harness.retroPosts.length, 0);
	});

	test("bot không đăng được tin của phiên: đóng phiên vừa tạo, báo lỗi; kênh vẫn tạo phiên khác được", async () =>
	{
		const harness = createWebHarness();
		const realActions = harness.deps.retroActions;
		harness.deps.retroActions = { ...realActions, post: () => Promise.resolve(null) };
		const auth = await login(harness, ADMIN_USER);
		const flash = await flashAfter(harness, auth, await post(harness, auth, "/retro/new", { kenh: CHANNEL_CHAT, "tieu-de": "Retro Sprint 25" }));
		assert.equal(flash.kind, "error");
		assert.ok(flash.text.includes("Bot không đăng được tin của phiên"), flash.text);
		assert.equal(harness.services.retro.get(GUILD, 1)?.status, "closed");
		assert.equal(harness.services.retro.findOpenInChannel(GUILD, CHANNEL_CHAT), null);

		harness.deps.retroActions = realActions;
		const again = await flashAfter(harness, auth, await post(harness, auth, "/retro/new", { kenh: CHANNEL_CHAT, "tieu-de": "Retro Sprint 25 (lại)" }));
		assert.equal(again.kind, "ok");
		assert.equal(harness.services.retro.findOpenInChannel(GUILD, CHANNEL_CHAT)?.id, 2);
	});

	test("thiếu CSRF: 403, không tạo phiên; admin mất quyền: 403", async () =>
	{
		const harness = createWebHarness();
		harness.services.guildConfig.changeRoleGrants(GUILD, "adminRoleIds", { add: [ROLE_ADMIN_BOT] }, ADMIN_USER);
		const auth = await login(harness, ROLE_ADMIN_USER);
		const forged = await call(harness, pageUrl("/retro/new"), { cookies: auth.cookies, form: { kenh: CHANNEL_CHAT, "tieu-de": "Retro giả" } });
		assert.equal(forged.status, 403);
		assert.equal(harness.services.retro.findOpenInChannel(GUILD, CHANNEL_CHAT), null);
		assert.equal(harness.retroPosts.length, 0);

		harness.services.guildConfig.changeRoleGrants(GUILD, "adminRoleIds", { remove: [ROLE_ADMIN_BOT] }, ADMIN_USER);
		const denied = await call(harness, pageUrl("/retro/new"), { cookies: auth.cookies });
		assert.equal(denied.status, 403);
	});
});

describe("web: trang Retro — chi tiết", () =>
{
	test("thông tin phiên; ai đã điền chỉ là danh sách tên; nội dung ẩn danh gom 5 cột, escape, không gắn tên; xuất đúng khu vực bot ghi Confluence", async () =>
	{
		const harness = createWebHarness();
		const session = createSession(harness, { title: "Retro <b>24</b>", docUrl: DOC });
		fill(harness, session.id, PLAIN_USER, { learned: "Học <script>alert(1)</script>", sprintName: "Rồng Lửa" });
		fill(harness, session.id, ROLE_ADMIN_USER, { improve: "Họp dài\ndòng hai", kudos: "Cảm ơn **team** <@&510000000000000002>", sprintName: "rồng  lửa" });
		const auth = await login(harness, ADMIN_USER);
		const body = await getPage(harness, auth, `/retro/view?id=${session.id}`);

		assert.match(body, /<h1>Retro #1<\/h1>/u);
		assert.ok(body.includes("🔁 Retro &lt;b&gt;24&lt;/b&gt;"), "tiêu đề escape");
		assert.ok(body.includes("#chung"));
		assert.ok(body.includes(`href="${DOC}"`), "link tài liệu");
		assert.ok(body.includes("Confluence: chưa ghi."));

		const people = sectionOf(body, "✍️ Ai đã điền (2)");
		assert.ok(people.includes("Thường") && people.includes("Role Admin"), "tên người đã điền");
		assert.ok(people.includes(`/members/view?u=${PLAIN_USER}`) && people.includes(`/members/view?u=${ROLE_ADMIN_USER}`));
		assert.ok(!people.includes("Học") && !people.includes("Họp dài"), "danh sách tên không kèm nội dung");

		const content = sectionOf(body, "📋 Nội dung ẩn danh");
		assert.ok(content.includes("Học &lt;script&gt;alert(1)&lt;/script&gt;"), "nội dung escape");
		assert.ok(!body.includes("<script>"), "không có script thật");
		assert.ok(content.includes("Họp dài\ndòng hai"));
		assert.ok(content.includes("Cảm ơn **team** &lt;@&amp;510000000000000002&gt;"), "chữ người dùng hiện nguyên văn, không thành mention hay định dạng");
		assert.ok(content.includes("📚 Learned (1)") && content.includes("👎 Thiếu sót (1)") && content.includes("🍀 Đặt tên sprint (2)"));
		for (const forbidden of [PLAIN_USER, ROLE_ADMIN_USER, "Thường", "Role Admin"]) assert.ok(!content.includes(forbidden), `nội dung không gắn với ${forbidden}`);
		assert.ok(content.includes("name=\"muc\"") && content.includes("name=\"kt\""), "form xoá ý mang vị trí và dấu của chữ");
		assert.ok(!/name="(entry|entryId|phieu)"/u.test(content), "form xoá ý không mang mã phiếu");

		const exported = sectionOf(body, "📄 Xuất chữ để dán vào Confluence");
		const storage = buildRetroSection(retroDocSection(harness.services, session));
		assert.ok(exported.includes(`<textarea class="rt-export" readonly rows="10" spellcheck="false" aria-label="Mã nguồn khu vực retro (storage format)">${escapeHtml(storage)}</textarea>`),
			"ô chữ chứa đúng khu vực bot sẽ ghi (storage format)");
		assert.ok(storage.includes(`ezbot-retro-${GUILD}-${session.id}-start`) && !storage.includes(PLAIN_USER));
		assert.ok(exported.includes("🤖 Retro từ Discord: Retro &lt;b&gt;24&lt;/b&gt;"), "bảng xem trước để chép");
		assert.ok(exported.includes("Cách 1") && exported.includes("Cách 2"), "hướng dẫn dán");

		assert.ok(body.includes("Phiên còn mở: đóng phiên rồi mới tạo vote"));
		assert.ok(body.includes("Chỉ xoá được nội dung khi phiên đã đóng"));
		assert.ok(body.includes(pageUrl("/retro/close")) && body.includes(pageUrl("/retro/extend")) && body.includes(pageUrl("/retro/remind")));
		assert.ok(!body.includes(pageUrl("/retro/reopen")), "phiên đang mở thì không có mở lại");
	});

	test("phiên ở kênh không xem được: giấu tiêu đề, tên kênh, link, nội dung, tên sprint; vẫn quản lý được", async () =>
	{
		const harness = createWebHarness();
		addChannel(harness.world, { id: CHANNEL_SECRET, name: "ban-giam-doc", type: ChannelType.GuildText, permissionsByMember: { [ADMIN_USER]: [] } });
		const session = createSession(harness, { channelId: CHANNEL_SECRET, title: "Retro bí mật", docUrl: DOC });
		fill(harness, session.id, PLAIN_USER, { learned: "Bí mật nội bộ", sprintName: "Tên Kín" });
		const auth = await login(harness, ADMIN_USER);
		const body = await getPage(harness, auth, `/retro/view?id=${session.id}`);
		for (const secret of ["Retro bí mật", "Bí mật nội bộ", "Tên Kín", "ban-giam-doc", DOC, "Xuất chữ để dán"]) assert.ok(!body.includes(secret), `lộ "${secret}"`);
		assert.ok(body.includes(escapeHtml(SECRET_SESSION_NOTE)));
		assert.ok(body.includes(PRIVATE_CHANNEL_LABEL));
		assert.ok(body.includes(HIDDEN_ITEM_TEXT));
		assert.ok(body.includes(pageUrl("/retro/close")), "vẫn đóng được như /retro close của admin");
		assert.ok(body.includes("Thường"), "admin vẫn thấy ai đã điền");
	});

	test("mã phiên sai hoặc không có: trang lỗi 400", async () =>
	{
		const harness = createWebHarness();
		const auth = await login(harness, ADMIN_USER);
		const missing = await call(harness, pageUrl("/retro/view?id=99"), { cookies: auth.cookies });
		assert.equal(missing.status, 400);
		assert.ok(missing.body.includes("Không tìm thấy phiên retro #99."));
		const invalid = await call(harness, pageUrl("/retro/view?id=abc"), { cookies: auth.cookies });
		assert.equal(invalid.status, 400);
		assert.ok(invalid.body.includes(INVALID_RETRO_ID));
	});
});
