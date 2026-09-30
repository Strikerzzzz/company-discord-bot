// Test trang "Vote" của web quản trị (Phase 17, DEC-041): lịch sử có tab và phân trang, kết quả (phiếu ẩn danh), đóng vote,
// riêng tư theo kênh. Service thật trên SQLite :memory: và server Discord giả (test/web-helpers.ts).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ChannelType } from "discord.js";
import type { CreatePollInput, Poll } from "../src/modules/poll/types";
import type { WebResponse } from "../src/web/http";
import { HIDDEN_ITEM_TEXT, MESSAGE_EDIT_FAILED } from "../src/web/widgets";
import { CLOSE_CONFIRM_REQUIRED, INVALID_POLL_ID, POLL_CREATE_NOTE, POLL_PAGE_SIZE } from "../src/web/pages/polls";
import { DUPLICATE_POST_WINDOW_MS } from "../src/web/server";
import { GUILD } from "./helpers";
import {
	addChannel,
	ADMIN_USER,
	call,
	CHANNEL_CHAT,
	createWebHarness,
	login,
	LoggedIn,
	PLAIN_USER,
	ROLE_ADMIN_BOT,
	ROLE_ADMIN_USER,
	WebHarness,
	withCsrf,
} from "./web-helpers";

const CHANNEL_SECRET = "410000000000000099";
const SECRET_CHANNEL_NAME = "ban-giam-doc";
const MESSAGE_ID = "600000000000000002";

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

function createPoll(harness: WebHarness, overrides: Partial<CreatePollInput> = {}): Poll
{
	const poll = harness.services.polls.create({
		guildId: GUILD,
		creatorId: ADMIN_USER,
		question: "Đi team building ở đâu?",
		options: ["Đà Lạt", "Vũng Tàu", "Phú Quốc"],
		multiSelect: false,
		xpReward: 5,
		durationMinutes: null,
		...overrides,
	});
	harness.clock.advance(1000);
	return poll;
}

function vote(harness: WebHarness, pollId: number, userId: string, optionIndex: number): void
{
	harness.services.polls.vote({ guildId: GUILD, pollId, userId, optionIndex, roleIds: [] });
}

function closePoll(harness: WebHarness, auth: LoggedIn, form: Record<string, string>): Promise<WebResponse>
{
	return call(harness, pageUrl("/polls/close"), { cookies: auth.cookies, form: withCsrf(auth, form) });
}

/** Nội dung flash (kind + chữ) ở trang mà response chuyển hướng tới. */
async function flashAfter(harness: WebHarness, auth: LoggedIn, response: WebResponse): Promise<{ kind: string; text: string }>
{
	assert.equal(response.status, 303);
	const location = response.headers.Location ?? "";
	const page = await call(harness, location, { cookies: auth.cookies });
	assert.equal(page.status, 200, location);
	const match = /<div class="flash (ok|error)">(.*?)<\/div>/su.exec(page.body);
	assert.ok(match, `không có flash ở ${location}`);
	return { kind: match[1] ?? "", text: match[2] ?? "" };
}

/** Số dòng trong bảng (tbody) của trang danh sách. */
function rowCount(body: string): number
{
	const start = body.indexOf("<tbody>");
	if (start < 0) return 0;
	return body.slice(start, body.indexOf("</tbody>", start)).split("<tr>").length - 1;
}

describe("web: trang Vote — danh sách", () =>
{
	test("tab Tất cả / Đang mở / Đã đóng, trạng thái Hết hạn cho vote quá hạn chưa đóng, ghi chú tạo vote bằng lệnh Discord", async () =>
	{
		const harness = createWebHarness();
		const open = createPoll(harness, { question: "Vote đang mở" });
		createPoll(harness, { question: "Vote sắp hết hạn", durationMinutes: 1, xpReward: 0 });
		const closed = createPoll(harness, { question: "Vote đã đóng", creatorId: PLAIN_USER });
		harness.services.polls.close({ guildId: GUILD, pollId: closed.id, actorId: ADMIN_USER, actorIsAdmin: true });
		vote(harness, open.id, PLAIN_USER, 0);
		vote(harness, open.id, ROLE_ADMIN_USER, 1);
		harness.clock.advance(2 * 60_000);
		const auth = await login(harness, ADMIN_USER);

		const all = await getPage(harness, auth, "/polls");
		assert.ok(all.includes(POLL_CREATE_NOTE));
		assert.equal(rowCount(all), 3);
		for (const question of ["Vote đang mở", "Vote sắp hết hạn", "Vote đã đóng"]) assert.ok(all.includes(question), question);
		assert.ok(all.includes("badge ok\">Đang mở") && all.includes("badge warn\">Hết hạn") && all.includes("badge\">Đã đóng"));
		assert.ok(all.includes(`href="${pageUrl(`/polls/view?id=${open.id}`)}"`));
		assert.ok(all.includes("<td class=\"num\">2</td>"), "số người tham gia");
		assert.ok(all.includes("+5 XP") && all.includes("Không có"));
		assert.ok(all.includes("Admin &lt;b&gt;") && all.includes(`href="${pageUrl(`/members/view?u=${PLAIN_USER}`)}"`), "người tạo");
		assert.ok(all.includes("Không giới hạn") && all.includes("Hạn ") && all.includes("Đóng "));
		assert.ok(all.includes(`<a href="${pageUrl("/polls")}" class="active">Tất cả</a>`));

		const openTab = await getPage(harness, auth, "/polls?tt=open");
		assert.equal(rowCount(openTab), 1);
		assert.ok(openTab.includes("Vote đang mở"));
		assert.ok(openTab.includes(`<a href="${pageUrl("/polls?tt=open")}" class="active">Đang mở</a>`));
		const closedTab = await getPage(harness, auth, "/polls?tt=closed");
		assert.equal(rowCount(closedTab), 2);
		assert.ok(closedTab.includes("Vote sắp hết hạn") && closedTab.includes("Vote đã đóng") && !closedTab.includes("Vote đang mở"));
		assert.equal(rowCount(await getPage(harness, auth, "/polls?tt=xyz")), 3, "tab sai thì về Tất cả");
	});

	test("phân trang 20 vote mỗi trang, link trang giữ tab", async () =>
	{
		const harness = createWebHarness();
		for (let index = 1; index <= POLL_PAGE_SIZE + 3; index++) createPoll(harness, { question: `Câu hỏi số ${index}` });
		const auth = await login(harness, ADMIN_USER);

		const first = await getPage(harness, auth, "/polls?tt=open");
		assert.equal(rowCount(first), POLL_PAGE_SIZE);
		assert.ok(first.includes("Câu hỏi số 23<") && !first.includes("Câu hỏi số 3<"), "mới nhất trước");
		assert.ok(first.includes(`href="${pageUrl("/polls?tt=open&amp;trang=2")}"`));
		const second = await getPage(harness, auth, "/polls?tt=open&trang=2");
		assert.equal(rowCount(second), 3);
		assert.ok(second.includes("Câu hỏi số 1<") && second.includes("Câu hỏi số 3<"));
		assert.ok((await getPage(harness, auth, "/polls")).includes(`href="${pageUrl("/polls?trang=2")}"`), "tab Tất cả không thêm tham số");
	});
});

describe("web: trang Vote — chi tiết", () =>
{
	test("kết quả từng lựa chọn (số phiếu, phần trăm, thanh progress), không có ai chọn gì; câu hỏi và lựa chọn được escape", async () =>
	{
		const harness = createWebHarness();
		const poll = createPoll(harness, { question: "<script>alert(1)</script> Trưa nay ăn gì?", options: ["<b>Phở</b>", "Bún chả", "Cơm tấm"] });
		harness.services.polls.attachMessage(GUILD, poll.id, CHANNEL_CHAT, MESSAGE_ID);
		vote(harness, poll.id, PLAIN_USER, 0);
		vote(harness, poll.id, ROLE_ADMIN_USER, 0);
		vote(harness, poll.id, ADMIN_USER, 1);
		const auth = await login(harness, ADMIN_USER);

		const page = await getPage(harness, auth, `/polls/view?id=${poll.id}`);
		assert.ok(!page.includes("<script") && !page.includes(" style="), "không có script hay style inline");
		assert.ok(page.includes("&lt;script&gt;alert(1)&lt;/script&gt; Trưa nay ăn gì?"));
		assert.ok(page.includes("1. &lt;b&gt;Phở&lt;/b&gt;") && !page.includes("<b>Phở</b>"));
		assert.ok(page.includes("<progress class=\"pl-bar\" max=\"3\" value=\"2\""));
		assert.ok(page.includes("<progress class=\"pl-bar\" max=\"3\" value=\"0\""));
		for (const share of ["67%", "33%", "0%"]) assert.ok(page.includes(`<td class="num">${share}</td>`), share);
		assert.match(page, /<dt>Người tham gia<\/dt><dd>3<\/dd>/u);
		assert.ok(page.includes("Chọn một · Phiếu ẩn danh") && page.includes("+5 XP") && page.includes("#chung"));
		assert.ok(page.includes(`href="https://discord.com/channels/${GUILD}/${CHANNEL_CHAT}/${MESSAGE_ID}"`));
		for (const voter of [PLAIN_USER, ROLE_ADMIN_USER, "Thường", "Role Admin"]) assert.ok(!page.includes(voter), `không lộ người vote ${voter}`);
		assert.ok(page.includes(`action="${pageUrl("/polls/close")}"`) && page.includes(`name="id" value="${poll.id}"`));
		assert.ok(page.includes("name=\"xac-nhan\"") && page.includes("btn btn-danger"));

		const empty = createPoll(harness, { question: "Chưa ai vote", multiSelect: true });
		const emptyPage = await getPage(harness, auth, `/polls/view?id=${empty.id}`);
		assert.ok(emptyPage.includes("<progress class=\"pl-bar\" max=\"1\" value=\"0\""), "chưa có phiếu: max 1 để progress hợp lệ");
		assert.ok(emptyPage.includes("Chọn nhiều") && !emptyPage.includes("discord.com/channels"));
	});

	test("vote hết hạn chưa đóng: không có form đóng; mã sai hoặc không có: trang lỗi 400", async () =>
	{
		const harness = createWebHarness();
		const poll = createPoll(harness, { durationMinutes: 1 });
		harness.clock.advance(2 * 60_000);
		const auth = await login(harness, ADMIN_USER);
		const page = await getPage(harness, auth, `/polls/view?id=${poll.id}`);
		assert.ok(page.includes("badge warn\">Hết hạn") && page.includes("tự đóng") && !page.includes("name=\"xac-nhan\""));

		const invalid = await call(harness, pageUrl("/polls/view?id=0"), { cookies: auth.cookies });
		assert.equal(invalid.status, 400);
		assert.ok(invalid.body.includes(INVALID_POLL_ID));
		const missing = await call(harness, pageUrl("/polls/view?id=999"), { cookies: auth.cookies });
		assert.equal(missing.status, 400);
		assert.ok(missing.body.includes("Không tìm thấy vote #999."));
	});

	test("kênh riêng tư: danh sách giấu câu hỏi, trang chi tiết 400, không đóng được", async () =>
	{
		const harness = createWebHarness();
		addChannel(harness.world, { id: CHANNEL_SECRET, name: SECRET_CHANNEL_NAME, type: ChannelType.GuildText, permissionsByMember: { [ADMIN_USER]: [] } });
		const secret = createPoll(harness, { question: "Tăng lương cho ai?", options: ["Anh A", "Chị B"] });
		harness.services.polls.attachMessage(GUILD, secret.id, CHANNEL_SECRET, MESSAGE_ID);
		createPoll(harness, { question: "Vote công khai" });
		const auth = await login(harness, ADMIN_USER);

		const list = await getPage(harness, auth, "/polls");
		assert.ok(list.includes("Vote công khai") && list.includes(HIDDEN_ITEM_TEXT));
		for (const leak of ["Tăng lương cho ai?", SECRET_CHANNEL_NAME, `/polls/view?id=${secret.id}`]) assert.ok(!list.includes(leak), leak);

		const detail = await call(harness, pageUrl(`/polls/view?id=${secret.id}`), { cookies: auth.cookies });
		assert.equal(detail.status, 400);
		assert.ok(detail.body.includes(`Không tìm thấy vote #${secret.id}.`));
		for (const leak of ["Tăng lương", "Anh A", SECRET_CHANNEL_NAME]) assert.ok(!detail.body.includes(leak), leak);

		const response = await closePoll(harness, auth, { id: String(secret.id), "xac-nhan": "1" });
		assert.equal(response.headers.Location, pageUrl(`/polls/view?id=${secret.id}`));
		const back = await call(harness, response.headers.Location ?? "", { cookies: auth.cookies });
		assert.equal(back.status, 400);
		assert.ok(back.body.includes(`Không tìm thấy vote #${secret.id}.`));
		assert.ok(!(await getPage(harness, auth, "/polls")).includes("class=\"flash"), "trang lỗi bỏ flash, không hiện muộn ở trang sau");
		assert.equal(harness.services.polls.get(GUILD, secret.id)?.closedAt, null);
		assert.deepEqual(harness.adminCalls, []);
	});
});

describe("web: trang Vote — đóng vote", () =>
{
	test("đóng vote của người khác: closedAt, audit với người đăng nhập, sửa message, flash; đóng lần hai báo lỗi về trang chi tiết", async () =>
	{
		const harness = createWebHarness();
		const { services } = harness;
		const poll = createPoll(harness, { creatorId: PLAIN_USER });
		services.polls.attachMessage(GUILD, poll.id, CHANNEL_CHAT, MESSAGE_ID);
		const auth = await login(harness, ADMIN_USER);
		const detailUrl = pageUrl(`/polls/view?id=${poll.id}`);

		const response = await closePoll(harness, auth, { id: String(poll.id), "xac-nhan": "1" });
		assert.equal(response.status, 303);
		assert.equal(response.headers.Location, detailUrl);
		assert.equal(services.polls.get(GUILD, poll.id)?.closedAt, harness.clock.now());
		const [entry] = services.audit.list(GUILD, 1);
		assert.equal(entry?.action, "poll.close");
		assert.equal(entry?.actorId, ADMIN_USER);
		assert.deepEqual(entry?.details, { pollId: poll.id });
		assert.deepEqual(harness.adminCalls, [`refreshPoll:${poll.id}`]);
		assert.deepEqual(await flashAfter(harness, auth, response), { kind: "ok", text: `Đã đóng vote #${poll.id}.` });

		const after = await getPage(harness, auth, `/polls/view?id=${poll.id}`);
		assert.ok(after.includes("badge\">Đã đóng") && after.includes("<dt>Đóng lúc</dt>") && !after.includes("name=\"xac-nhan\""));

		harness.clock.advance(DUPLICATE_POST_WINDOW_MS);
		const again = await closePoll(harness, auth, { id: String(poll.id), "xac-nhan": "1" });
		assert.equal(again.headers.Location, detailUrl);
		assert.deepEqual(await flashAfter(harness, auth, again), { kind: "error", text: "Vote này đã đóng." });
		assert.equal(harness.adminCalls.length, 1);
	});

	test("chưa tick xác nhận hoặc mã sai: báo lỗi, không đóng", async () =>
	{
		const harness = createWebHarness();
		const poll = createPoll(harness);
		const auth = await login(harness, ADMIN_USER);

		const unchecked = await closePoll(harness, auth, { id: String(poll.id) });
		assert.equal(unchecked.headers.Location, pageUrl(`/polls/view?id=${poll.id}`));
		assert.deepEqual(await flashAfter(harness, auth, unchecked), { kind: "error", text: CLOSE_CONFIRM_REQUIRED });
		assert.equal(harness.services.polls.get(GUILD, poll.id)?.closedAt, null);

		const invalid = await closePoll(harness, auth, { id: "abc", "xac-nhan": "1" });
		assert.equal(invalid.headers.Location, pageUrl("/polls"));
		assert.deepEqual(await flashAfter(harness, auth, invalid), { kind: "error", text: INVALID_POLL_ID });
		assert.deepEqual(harness.adminCalls, []);
	});

	test("không sửa được message trong Discord thì thông báo kèm cảnh báo", async () =>
	{
		const harness = createWebHarness();
		harness.deps.adminActions.refreshPoll = () => Promise.resolve(false);
		const posted = createPoll(harness);
		harness.services.polls.attachMessage(GUILD, posted.id, CHANNEL_CHAT, MESSAGE_ID);
		const unposted = createPoll(harness);
		const auth = await login(harness, ADMIN_USER);

		const first = await flashAfter(harness, auth, await closePoll(harness, auth, { id: String(posted.id), "xac-nhan": "1" }));
		assert.equal(first.kind, "ok");
		assert.ok(first.text.includes(`Đã đóng vote #${posted.id}.`) && first.text.includes(MESSAGE_EDIT_FAILED), first.text);
		const second = await flashAfter(harness, auth, await closePoll(harness, auth, { id: String(unposted.id), "xac-nhan": "1" }));
		assert.equal(second.text, `Đã đóng vote #${unposted.id}.`);
	});

	test("token CSRF sai bị 403; người không phải admin không vào được trang và không đóng được", async () =>
	{
		const harness = createWebHarness();
		const { services } = harness;
		const poll = createPoll(harness);
		const admin = await login(harness, ADMIN_USER);
		const forged = await call(harness, pageUrl("/polls/close"), { cookies: admin.cookies, form: { _csrf: "sai", id: String(poll.id), "xac-nhan": "1" } });
		assert.equal(forged.status, 403);
		assert.equal(services.polls.get(GUILD, poll.id)?.closedAt, null);

		await assert.rejects(login(harness, PLAIN_USER), "thành viên thường không đăng nhập được");
		services.guildConfig.updateSettings(GUILD, { adminRoleIds: [ROLE_ADMIN_BOT] }, ADMIN_USER);
		const former = await login(harness, ROLE_ADMIN_USER);
		services.guildConfig.updateSettings(GUILD, { adminRoleIds: [] }, ADMIN_USER);
		assert.equal((await call(harness, pageUrl("/polls"), { cookies: former.cookies })).status, 403);
		const denied = await call(harness, pageUrl("/polls/close"), { cookies: former.cookies, form: withCsrf(former, { id: String(poll.id), "xac-nhan": "1" }) });
		assert.equal(denied.status, 403);
		assert.equal(services.polls.get(GUILD, poll.id)?.closedAt, null);
		assert.deepEqual(harness.adminCalls, []);
	});
});
