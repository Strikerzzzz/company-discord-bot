// Test trang "Contribution" của web quản trị (Phase 17, DEC-041): danh sách có bộ lọc và phân trang, chi tiết, gỡ contribution,
// riêng tư theo kênh. Service thật trên SQLite :memory: và server Discord giả (test/web-helpers.ts).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ChannelType } from "discord.js";
import type { Contribution, SubmitContributionInput } from "../src/modules/contribution/types";
import { UserError } from "../src/shared/errors";
import { PRIVATE_CHANNEL_LABEL } from "../src/web/format";
import type { WebResponse } from "../src/web/http";
import { CONTRIBUTION_PAGE_SIZE, INVALID_CONTRIBUTION_ID, REMOVE_CONFIRM_REQUIRED } from "../src/web/pages/contributions";
import { HIDDEN_ITEM_TEXT, MESSAGE_EDIT_FAILED } from "../src/web/widgets";
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
const SECRET_CHANNEL_NAME = "luong-thuong-bi-mat";
const MESSAGE_ID = "600000000000000001";

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

function submit(harness: WebHarness, overrides: Partial<SubmitContributionInput> = {}): Contribution
{
	const contribution = harness.services.contributions.submit({
		guildId: GUILD,
		authorId: PLAIN_USER,
		submittedBy: PLAIN_USER,
		title: "Tài liệu onboarding",
		description: "Viết tài liệu cho người mới",
		category: "tai-lieu",
		link: null,
		authorRoleIds: [],
		...overrides,
	});
	harness.clock.advance(1000);
	return contribution;
}

function removeContribution(harness: WebHarness, auth: LoggedIn, form: Record<string, string>): Promise<WebResponse>
{
	return call(harness, pageUrl("/contributions/remove"), { cookies: auth.cookies, form: withCsrf(auth, form) });
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

function addSecretChannel(harness: WebHarness): void
{
	addChannel(harness.world, { id: CHANNEL_SECRET, name: SECRET_CHANNEL_NAME, type: ChannelType.GuildText, permissionsByMember: { [ADMIN_USER]: [] } });
}

describe("web: trang Contribution — danh sách", () =>
{
	test("mặc định chỉ hiện contribution còn hiệu lực; lọc theo trạng thái và tác giả; tham số sai thì về mặc định", async () =>
	{
		const harness = createWebHarness();
		const { services } = harness;
		const idea = submit(harness, { title: "Ý tưởng tiết kiệm điện", category: "y-tuong" });
		services.contributions.attachMessage(GUILD, idea.id, CHANNEL_CHAT, MESSAGE_ID);
		submit(harness, { authorId: ADMIN_USER, submittedBy: ADMIN_USER, title: "Giải pháp sao lưu", category: "giai-phap" });
		const deploy = submit(harness, { title: "Cải tiến quy trình deploy", category: "cai-tien" });
		services.contributions.remove(GUILD, deploy.id, ADMIN_USER);
		const auth = await login(harness, ADMIN_USER);

		const list = await getPage(harness, auth, "/contributions");
		assert.ok(list.includes("Ý tưởng tiết kiệm điện") && list.includes("Giải pháp sao lưu"));
		assert.ok(!list.includes("Cải tiến quy trình deploy"), "mặc định không hiện contribution đã gỡ");
		assert.equal(rowCount(list), 2);
		assert.ok(list.includes(`href="${pageUrl(`/contributions/view?id=${idea.id}`)}"`));
		assert.ok(list.includes("#chung"), "tên kênh gốc");
		assert.ok(list.includes("Ý tưởng") && list.includes("Giải pháp"), "nhãn loại");
		assert.ok(list.includes(`href="${pageUrl(`/members/view?u=${PLAIN_USER}`)}"`) && list.includes("Thường"), "tác giả có link hồ sơ");
		assert.ok(list.includes("Admin &lt;b&gt;") && !list.includes("Admin <b>"), "tên tác giả được escape");
		assert.ok(list.includes("badge ok\">Còn hiệu lực"));
		assert.ok(list.includes("2 contribution"));

		const removed = await getPage(harness, auth, "/contributions?tt=removed");
		assert.equal(rowCount(removed), 1);
		assert.ok(removed.includes("Cải tiến quy trình deploy") && removed.includes("badge off\">Đã gỡ"));
		assert.ok(removed.includes("<option value=\"removed\" selected>"));
		assert.equal(rowCount(await getPage(harness, auth, "/contributions?tt=all")), 3);
		const bogus = await getPage(harness, auth, "/contributions?tt=xoa");
		assert.equal(rowCount(bogus), 2);
		assert.ok(!bogus.includes("Cải tiến quy trình deploy"));

		const mine = await getPage(harness, auth, `/contributions?u=${PLAIN_USER}`);
		assert.equal(rowCount(mine), 1);
		assert.ok(mine.includes("Ý tưởng tiết kiệm điện") && !mine.includes("Giải pháp sao lưu"));
		const mention = await getPage(harness, auth, `/contributions?tt=all&u=${encodeURIComponent(`<@${PLAIN_USER}>`)}`);
		assert.equal(rowCount(mention), 2);
		assert.ok(mention.includes("Cải tiến quy trình deploy") && !mention.includes("Giải pháp sao lưu"));
		assert.equal(rowCount(await getPage(harness, auth, `/contributions?u=${ROLE_ADMIN_USER}`)), 0);

		const invalid = await getPage(harness, auth, `/contributions?u=${encodeURIComponent("<b>abc</b>")}`);
		assert.ok(invalid.includes("class=\"warn-box\""), "tác giả sai định dạng thì cảnh báo");
		assert.ok(invalid.includes("value=\"&lt;b&gt;abc&lt;/b&gt;\"") && !invalid.includes("<b>abc</b>"), "giữ ô nhập, đã escape");
		assert.equal(rowCount(invalid), 2, "bỏ lọc tác giả");
	});

	test("phân trang 20 mục mỗi trang, mới nhất trước; link trang giữ bộ lọc", async () =>
	{
		const harness = createWebHarness();
		for (let index = 1; index <= CONTRIBUTION_PAGE_SIZE + 5; index++) submit(harness, { title: `Đóng góp số ${index}` });
		submit(harness, { authorId: ADMIN_USER, submittedBy: ADMIN_USER, title: "Của admin" });
		const auth = await login(harness, ADMIN_USER);

		const first = await getPage(harness, auth, `/contributions?u=${PLAIN_USER}`);
		assert.equal(rowCount(first), CONTRIBUTION_PAGE_SIZE);
		assert.ok(first.includes("Đóng góp số 25") && !first.includes("Đóng góp số 5<"));
		assert.ok(first.includes("Trang 1/2"));
		assert.ok(first.includes(`href="${pageUrl(`/contributions?tt=active&amp;u=${PLAIN_USER}&amp;trang=2`)}"`), "link trang sau giữ bộ lọc");

		const second = await getPage(harness, auth, `/contributions?tt=active&u=${PLAIN_USER}&trang=2`);
		assert.equal(rowCount(second), 5);
		assert.ok(second.includes("Đóng góp số 1<") && second.includes("Đóng góp số 5<") && !second.includes("Của admin"));
		assert.ok(second.includes(`href="${pageUrl(`/contributions?tt=active&amp;u=${PLAIN_USER}&amp;trang=1`)}"`));
		assert.equal(rowCount(await getPage(harness, auth, `/contributions?u=${PLAIN_USER}&trang=99`)), 5, "trang vượt quá bị kẹp về trang cuối");
		assert.equal(rowCount(await getPage(harness, auth, "/contributions?trang=abc")), CONTRIBUTION_PAGE_SIZE);
	});
});

describe("web: trang Contribution — chi tiết", () =>
{
	test("đủ thông tin, mô tả giữ xuống dòng, link an toàn mở tab mới, link tới message trong Discord; nội dung được escape", async () =>
	{
		const harness = createWebHarness();
		const { services } = harness;
		const contribution = submit(harness, {
			submittedBy: ADMIN_USER,
			title: "<script>alert(1)</script> Tài liệu",
			description: "Dòng 1 <b>đậm</b>\nDòng 2",
			link: "https://example.com/a?b=1&c=\"><script>",
		});
		services.contributions.attachMessage(GUILD, contribution.id, CHANNEL_CHAT, MESSAGE_ID);
		services.contributions.toggleVote({ guildId: GUILD, contributionId: contribution.id, voterId: ADMIN_USER });
		const auth = await login(harness, ADMIN_USER);

		const page = await getPage(harness, auth, `/contributions/view?id=${contribution.id}`);
		assert.ok(!page.includes("<script"), "không có thẻ script nào");
		assert.ok(page.includes("&lt;script&gt;alert(1)&lt;/script&gt; Tài liệu"));
		assert.ok(page.includes("<p class=\"ct-desc\">Dòng 1 &lt;b&gt;đậm&lt;/b&gt;\nDòng 2</p>"), "mô tả escape và giữ xuống dòng");
		assert.ok(page.includes("<a href=\"https://example.com/a?b=1&amp;c=&quot;&gt;&lt;script&gt;\" rel=\"noopener noreferrer nofollow\" target=\"_blank\">"));
		assert.ok(page.includes(`href="https://discord.com/channels/${GUILD}/${CHANNEL_CHAT}/${MESSAGE_ID}"`));
		assert.ok(page.includes("Tài liệu") && page.includes("#chung"));
		assert.ok(page.includes("Người ghi nhận") && page.includes("Admin &lt;b&gt;"), "người ghi nhận khác tác giả");
		assert.match(page, /<dt>Lượt ghi nhận<\/dt><dd>1<\/dd>/u);
		assert.ok(page.includes(`action="${pageUrl("/contributions/remove")}"`) && page.includes(`name="id" value="${contribution.id}"`));
		assert.ok(page.includes("name=\"xac-nhan\"") && page.includes("btn btn-danger"));
		assert.ok(!page.includes(" style="), "không có style inline (CSP)");

		const plain = submit(harness, { title: "Không có link" });
		const plainPage = await getPage(harness, auth, `/contributions/view?id=${plain.id}`);
		assert.ok(!plainPage.includes("Người ghi nhận") && !plainPage.includes("<dt>Link</dt>") && !plainPage.includes("discord.com/channels"));
	});

	test("link javascript: không vào được (service chặn) và trang không tạo href lạ", async () =>
	{
		const harness = createWebHarness();
		assert.throws(() => submit(harness, { link: "javascript:alert(1)" }), UserError);
		assert.throws(() => submit(harness, { link: "data:text/html,<b>x</b>" }), UserError);
		const upper = submit(harness, { link: "HTTPS://EXAMPLE.COM/x" });
		const auth = await login(harness, ADMIN_USER);
		const page = await getPage(harness, auth, `/contributions/view?id=${upper.id}`);
		assert.ok(page.includes("href=\"HTTPS://EXAMPLE.COM/x\""));
		const hrefs = [...page.matchAll(/href="([^"]*)"/gu)].map(match => match[1] ?? "");
		for (const href of hrefs) assert.match(href, /^(\/|https:\/\/|HTTPS:\/\/)/u, href);
	});

	test("mã sai hoặc không có thì trang lỗi 400", async () =>
	{
		const harness = createWebHarness();
		const auth = await login(harness, ADMIN_USER);
		const invalid = await call(harness, pageUrl("/contributions/view?id=abc"), { cookies: auth.cookies });
		assert.equal(invalid.status, 400);
		assert.ok(invalid.body.includes(INVALID_CONTRIBUTION_ID));
		const missing = await call(harness, pageUrl("/contributions/view?id=999"), { cookies: auth.cookies });
		assert.equal(missing.status, 400);
		assert.ok(missing.body.includes("Không tìm thấy contribution #999."));
	});

	test("kênh riêng tư: danh sách và chi tiết không lộ tiêu đề, mô tả, link, tên kênh; vẫn gỡ được và thông báo không có tiêu đề", async () =>
	{
		const harness = createWebHarness();
		const { services } = harness;
		addSecretChannel(harness);
		const secret = submit(harness, { title: "Bí mật lương thưởng", description: "Nội dung mật", link: "https://secret.example/x" });
		services.contributions.attachMessage(GUILD, secret.id, CHANNEL_SECRET, MESSAGE_ID);
		submit(harness, { title: "Công khai" });
		const auth = await login(harness, ADMIN_USER);

		const list = await getPage(harness, auth, "/contributions");
		assert.ok(list.includes("Công khai"));
		assert.ok(list.includes(HIDDEN_ITEM_TEXT) && list.includes(PRIVATE_CHANNEL_LABEL));
		for (const leak of ["Bí mật lương thưởng", SECRET_CHANNEL_NAME]) assert.ok(!list.includes(leak), leak);
		assert.ok(list.includes(`href="${pageUrl(`/contributions/view?id=${secret.id}`)}"`), "vẫn mở được để gỡ");

		const detail = await getPage(harness, auth, `/contributions/view?id=${secret.id}`);
		for (const leak of ["Bí mật lương thưởng", "Nội dung mật", "secret.example", SECRET_CHANNEL_NAME, "discord.com/channels"])
		{
			assert.ok(!detail.includes(leak), leak);
		}
		assert.ok(detail.includes("được ẩn") && detail.includes("name=\"xac-nhan\""));

		const response = await removeContribution(harness, auth, { id: String(secret.id), "xac-nhan": "1" });
		assert.equal(response.headers.Location, pageUrl(`/contributions/view?id=${secret.id}`));
		assert.equal(services.contributions.get(GUILD, secret.id)?.status, "removed");
		assert.deepEqual(harness.adminCalls, [`refreshContribution:${secret.id}`]);
		const flash = await flashAfter(harness, auth, response);
		assert.equal(flash.kind, "ok");
		assert.ok(flash.text.includes(`Đã gỡ contribution #${secret.id}`) && !flash.text.includes("Bí mật"), flash.text);
	});
});

describe("web: trang Contribution — gỡ", () =>
{
	test("gỡ: huỷ điểm, audit với người đăng nhập, sửa message trong Discord, flash; gỡ lần hai báo lỗi về trang chi tiết", async () =>
	{
		const harness = createWebHarness();
		const { services } = harness;
		const contribution = submit(harness, { title: "Sửa lỗi đăng nhập" });
		services.contributions.attachMessage(GUILD, contribution.id, CHANNEL_CHAT, MESSAGE_ID);
		services.contributions.toggleVote({ guildId: GUILD, contributionId: contribution.id, voterId: ADMIN_USER });
		assert.ok(services.contributions.getProfile(GUILD, PLAIN_USER).score > 0);
		const auth = await login(harness, ADMIN_USER);
		const detailUrl = pageUrl(`/contributions/view?id=${contribution.id}`);

		const response = await removeContribution(harness, auth, { id: String(contribution.id), "xac-nhan": "1" });
		assert.equal(response.status, 303);
		assert.equal(response.headers.Location, detailUrl);
		assert.equal(services.contributions.get(GUILD, contribution.id)?.status, "removed");
		assert.equal(services.contributions.getProfile(GUILD, PLAIN_USER).score, 0, "toàn bộ điểm bị huỷ");
		const [entry] = services.audit.list(GUILD, 1);
		assert.equal(entry?.action, "contribution.remove");
		assert.equal(entry?.actorId, ADMIN_USER);
		assert.equal(entry?.targetId, PLAIN_USER);
		assert.deepEqual(harness.adminCalls, [`refreshContribution:${contribution.id}`]);

		const flash = await flashAfter(harness, auth, response);
		assert.equal(flash.kind, "ok");
		assert.ok(flash.text.includes(`Đã gỡ contribution #${contribution.id}`) && flash.text.includes("Sửa lỗi đăng nhập"), flash.text);
		assert.ok(!flash.text.includes(MESSAGE_EDIT_FAILED));
		const after = await getPage(harness, auth, `/contributions/view?id=${contribution.id}`);
		assert.ok(after.includes("badge off\">Đã gỡ") && !after.includes("name=\"xac-nhan\""), "đã gỡ thì không còn form gỡ");

		const again = await removeContribution(harness, auth, { id: String(contribution.id), "xac-nhan": "1" });
		assert.equal(again.headers.Location, detailUrl);
		assert.deepEqual(await flashAfter(harness, auth, again), { kind: "error", text: "Contribution này đã bị gỡ." });
		assert.equal(harness.adminCalls.length, 1);
	});

	test("chưa tick xác nhận, mã sai hoặc không có: báo lỗi, không gỡ gì", async () =>
	{
		const harness = createWebHarness();
		const { services } = harness;
		const contribution = submit(harness);
		const auth = await login(harness, ADMIN_USER);

		const unchecked = await removeContribution(harness, auth, { id: String(contribution.id) });
		assert.equal(unchecked.headers.Location, pageUrl(`/contributions/view?id=${contribution.id}`));
		assert.deepEqual(await flashAfter(harness, auth, unchecked), { kind: "error", text: REMOVE_CONFIRM_REQUIRED });
		assert.equal(services.contributions.get(GUILD, contribution.id)?.status, "active");

		const invalid = await removeContribution(harness, auth, { id: "1 OR 1=1", "xac-nhan": "1" });
		assert.equal(invalid.headers.Location, pageUrl("/contributions"));
		assert.deepEqual(await flashAfter(harness, auth, invalid), { kind: "error", text: INVALID_CONTRIBUTION_ID });

		const missing = await removeContribution(harness, auth, { id: "999", "xac-nhan": "1" });
		assert.equal(missing.headers.Location, pageUrl("/contributions"), "không có thì về danh sách");
		assert.deepEqual(await flashAfter(harness, auth, missing), { kind: "error", text: "Không tìm thấy contribution này." });
		assert.deepEqual(harness.adminCalls, []);
	});

	test("không sửa được message trong Discord thì thông báo kèm cảnh báo (chỉ khi contribution có message)", async () =>
	{
		const harness = createWebHarness();
		const { services } = harness;
		harness.deps.adminActions.refreshContribution = () => Promise.resolve(false);
		const posted = submit(harness);
		services.contributions.attachMessage(GUILD, posted.id, CHANNEL_CHAT, MESSAGE_ID);
		const unposted = submit(harness, { title: "Chưa đăng" });
		const auth = await login(harness, ADMIN_USER);

		const first = await flashAfter(harness, auth, await removeContribution(harness, auth, { id: String(posted.id), "xac-nhan": "1" }));
		assert.equal(first.kind, "ok");
		assert.ok(first.text.includes(MESSAGE_EDIT_FAILED), first.text);
		const second = await flashAfter(harness, auth, await removeContribution(harness, auth, { id: String(unposted.id), "xac-nhan": "1" }));
		assert.ok(!second.text.includes(MESSAGE_EDIT_FAILED), second.text);
	});

	test("token CSRF sai bị 403; người không phải admin không vào được trang và không gỡ được", async () =>
	{
		const harness = createWebHarness();
		const { services } = harness;
		const contribution = submit(harness);
		const admin = await login(harness, ADMIN_USER);
		const forged = await call(harness, pageUrl("/contributions/remove"), { cookies: admin.cookies, form: { _csrf: "sai", id: String(contribution.id), "xac-nhan": "1" } });
		assert.equal(forged.status, 403);
		assert.equal(services.contributions.get(GUILD, contribution.id)?.status, "active");

		await assert.rejects(login(harness, PLAIN_USER), "thành viên thường không đăng nhập được");
		services.guildConfig.updateSettings(GUILD, { adminRoleIds: [ROLE_ADMIN_BOT] }, ADMIN_USER);
		const former = await login(harness, ROLE_ADMIN_USER);
		services.guildConfig.updateSettings(GUILD, { adminRoleIds: [] }, ADMIN_USER);
		assert.equal((await call(harness, pageUrl("/contributions"), { cookies: former.cookies })).status, 403);
		const denied = await call(harness, pageUrl("/contributions/remove"), { cookies: former.cookies, form: withCsrf(former, { id: String(contribution.id), "xac-nhan": "1" }) });
		assert.equal(denied.status, 403);
		assert.equal(services.contributions.get(GUILD, contribution.id)?.status, "active");
		assert.deepEqual(harness.adminCalls, []);
	});
});
