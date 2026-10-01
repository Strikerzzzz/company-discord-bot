// Test duyệt contribution trên web quản trị (Phase 20, DEC-051, DEC-041): danh sách lọc theo trạng thái duyệt, duyệt và từ chối
// qua contributionOps (sửa thẻ, nhắn riêng, audit), bảng lượt 👍/👎, riêng tư theo kênh, kênh contribution và XP người bấm ở trang
// Cài đặt điểm, role duyệt ở trang Quyền, thẻ Contribution ở trang Tổng quan. Gọi bộ xử lý thật với service thật trên SQLite
// :memory: (migration thật) và server Discord giả (test/web-helpers.ts); form "gửi như trình duyệt" từ HTML vừa vẽ.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { CARD_EDIT_FAILED, NOTICE_FAILED } from "../src/discord/contributionOps";
import type { Contribution, ContributionVoteResult, SubmitContributionInput } from "../src/modules/contribution/types";
import { CONTRIBUTION_LIMITS } from "../src/modules/contribution/types";
import { MAX_GRANT_ROLES } from "../src/modules/guild-config/types";
import type { WebResponse } from "../src/web/http";
import {
	CONTRIBUTION_PAGE_SIZE,
	HIDDEN_REASON_TEXT,
	INVALID_CONTRIBUTION_ID,
	PENDING_LIST_PATH,
	REJECT_REASON_FIELD,
	REPOST_HIDDEN,
} from "../src/web/pages/contributions";
import { REPOST_OTHER_CHANNEL } from "../src/discord/messages";
import { NO_CONTRIBUTION_CHANNEL, SETTINGS_STALE_FORM } from "../src/web/pages/settings";
import { DUPLICATE_POST_WINDOW_MS } from "../src/web/server";
import { HIDDEN_ITEM_TEXT } from "../src/web/widgets";
import { GUILD } from "./helpers";
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
	ensureContributionChannel,
	login,
	LoggedIn,
	PLAIN_USER,
	ROLE_ADMIN_BOT,
	ROLE_ADMIN_USER,
	ROLE_MANAGED,
	ROLE_TEAM_A,
	ROLE_TEAM_B,
	STRANGER,
	WebHarness,
	withCsrf,
} from "./web-helpers";

const CHANNEL_SECRET = "410000000000000099";
const SECRET_CHANNEL_NAME = "luong-thuong-bi-mat";
const CHANNEL_NO_EMBED = "410000000000000011";
const CHANNEL_NO_SEND = "410000000000000012";
const CHANNEL_GONE = "419999999999999999";
const MESSAGE_ID = "600000000000000001";
const REJECT_LENGTH_ERROR = `Lý do từ chối phải từ ${CONTRIBUTION_LIMITS.rejectReasonMin} đến ${CONTRIBUTION_LIMITS.rejectReasonMax} ký tự.`;

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

function post(harness: WebHarness, auth: LoggedIn, path: string, form: Record<string, string | string[]>): Promise<WebResponse>
{
	return call(harness, pageUrl(path), { cookies: auth.cookies, form: withCsrf(auth, form) });
}

/** Thông báo kết quả (flash) ở trang mà response chuyển hướng tới. */
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

/** Số dòng trong bảng đầu tiên (tbody) của trang. */
function rowCount(body: string): number
{
	const start = body.indexOf("<tbody>");
	if (start < 0) return 0;
	return body.slice(start, body.indexOf("</tbody>", start)).split("<tr>").length - 1;
}

/** Đoạn HTML của bảng lượt bấm ở trang chi tiết; rỗng nếu không có. */
function votersTable(body: string): string
{
	const start = body.indexOf("ct-voters");
	return start < 0 ? "" : body.slice(start, body.indexOf("</table>", start));
}

function occurrences(text: string, part: string): number
{
	return text.split(part).length - 1;
}

function unescapeHtml(value: string): string
{
	return value.replace(/&quot;/gu, "\"").replace(/&#39;/gu, "'").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&amp;/gu, "&");
}

/** Các trường trình duyệt gửi khi bấm nút của form có action `path`: input (bỏ `disabled`, checkbox chưa tick), option đang chọn. */
function formFields(body: string, path: string): Fields
{
	const start = body.indexOf(`action="${pageUrl(path)}"`);
	assert.ok(start >= 0, `không có form ${path}`);
	const block = body.slice(start, body.indexOf("</form>", start));
	const fields: Fields = [];
	for (const [, attributes = ""] of block.matchAll(/<input\b([^>]*)>/gu))
	{
		const attrs = new Map<string, string>();
		for (const [, name = "", value = ""] of attributes.matchAll(/([a-zA-Z_:-]+)(?:="([^"]*)")?/gu)) attrs.set(name, unescapeHtml(value));
		const name = attrs.get("name");
		if (name === undefined || attrs.has("disabled")) continue;
		if (attrs.get("type") === "checkbox" && !attrs.has("checked")) continue;
		fields.push([name, attrs.get("value") ?? "on"]);
	}
	for (const match of block.matchAll(/<select[^>]*\sname="([^"]*)"[^>]*>([\s\S]*?)<\/select>/gu))
	{
		const options = [...(match[2] ?? "").matchAll(/<option([^>]*)>/gu)].map(option => option[1] ?? "");
		const chosen = options.find(option => / selected(?=[\s>]|$)/u.test(option)) ?? options[0] ?? "";
		fields.push([match[1] ?? "", unescapeHtml(/value="([^"]*)"/u.exec(chosen)?.[1] ?? "")]);
	}
	return fields;
}

/** Đổi giá trị trường một giá trị (`name`) thành `value`. */
function setField(fields: Fields, name: string, value: string): Fields
{
	return [...fields.filter(([key]) => key !== name), [name, value]];
}

function check(fields: Fields, name: string, value: string, checked: boolean): Fields
{
	const rest = fields.filter(([key, item]) => !(key === name && item === value));
	return checked ? [...rest, [name, value]] : rest;
}

function ticked(fields: Fields, name: string): string[]
{
	return fields.filter(([key]) => key === name).map(([, value]) => value);
}

function toForm(fields: Fields): Record<string, string[]>
{
	const form: Record<string, string[]> = {};
	for (const [name, value] of fields) (form[name] ??= []).push(value);
	return form;
}

/** POST các trường của form như trình duyệt (đã có `_csrf` lấy từ HTML) rồi trả về flash ở trang được chuyển hướng tới. */
async function submitFields(harness: WebHarness, auth: LoggedIn, path: string, fields: Fields): Promise<{ kind: string; text: string }>
{
	const response = await call(harness, pageUrl(path), { cookies: auth.cookies, form: toForm(fields) });
	assert.equal(response.headers.Location, pageUrl(path));
	return flashAfter(harness, auth, response);
}

function auditCount(harness: WebHarness): number
{
	return harness.services.audit.list(GUILD, 10_000).length;
}

/** Gửi contribution (chờ duyệt) qua service thật; chọn kênh contribution trước nếu chưa có. */
function submit(harness: WebHarness, overrides: Partial<SubmitContributionInput> = {}): Contribution
{
	ensureContributionChannel(harness);
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

/** 👍 hoặc 👎 qua service thật (người bấm không cần là thành viên của server giả). */
function vote(harness: WebHarness, contributionId: number, voterId: string, action: "up" | "down", reason: string | null = null): ContributionVoteResult
{
	const result = harness.services.contributions.vote({ guildId: GUILD, contributionId, voterId, action, reason, voterRoleIds: [], systemActorId: BOT_ID });
	harness.clock.advance(1000);
	return result;
}

function addSecretChannel(harness: WebHarness): void
{
	addChannel(harness.world, { id: CHANNEL_SECRET, name: SECRET_CHANNEL_NAME, type: ChannelType.GuildText, permissionsByMember: { [ADMIN_USER]: [] } });
}

describe("web contribution (DEC-051): danh sách theo trạng thái duyệt", () =>
{
	test("lọc Chờ duyệt / Đã duyệt / Bị từ chối / tất cả, badge, cột 👍 👎 điểm, lối vào nhanh Chờ duyệt (n)", async () =>
	{
		const harness = createWebHarness();
		const { contributions } = harness.services;
		const waiting = submit(harness, { title: "Đang chờ duyệt" });
		const approved = submit(harness, { title: "Đã được duyệt" });
		contributions.approve(GUILD, approved.id, ADMIN_USER);
		vote(harness, approved.id, ADMIN_USER, "up");
		vote(harness, approved.id, ROLE_ADMIN_USER, "up");
		vote(harness, approved.id, STRANGER, "down", "Chưa đủ chi tiết");
		const rejected = submit(harness, { title: "Bị từ chối rồi" });
		contributions.reject(GUILD, rejected.id, ADMIN_USER, "Trùng contribution khác");
		const removed = submit(harness, { title: "Chờ duyệt rồi bị gỡ" });
		contributions.remove(GUILD, removed.id, ADMIN_USER);
		const auth = await login(harness, ADMIN_USER);

		const all = await getPage(harness, auth, "/contributions");
		assert.equal(rowCount(all), 3, "mặc định: mọi trạng thái duyệt, chỉ contribution còn hiệu lực");
		assert.ok(all.includes("badge warn\">⏳ Chờ duyệt") && all.includes("badge ok\">✅ Đã duyệt") && all.includes("badge off\">❌ Bị từ chối"));
		assert.ok(all.includes(`href="${pageUrl(PENDING_LIST_PATH).replace(/&/gu, "&amp;")}"`) && all.includes("⏳ Chờ duyệt (1)"), "lối vào nhanh có số chờ duyệt");
		assert.ok(all.includes("<th class=\"num\" title=\"Lượt ghi nhận\">👍</th><th class=\"num\" title=\"Lượt không ghi nhận\">👎</th><th class=\"num\">Điểm</th>"));
		assert.match(all, /<td class="num">2<\/td>\n<td class="num">1<\/td>\n<td class="num">1<\/td>/u, "2 👍, 1 👎, điểm 1");
		assert.ok(all.includes("<option value=\"all\" selected>Tất cả</option>"));

		const pending = await getPage(harness, auth, "/contributions?dd=pending");
		assert.equal(rowCount(pending), 1);
		assert.ok(pending.includes(`href="${pageUrl(`/contributions/view?id=${waiting.id}`)}"`) && !pending.includes("Đã được duyệt"));
		assert.ok(pending.includes("<option value=\"pending\" selected>"));
		const onlyApproved = await getPage(harness, auth, "/contributions?dd=approved");
		assert.equal(rowCount(onlyApproved), 1);
		assert.ok(onlyApproved.includes("Đã được duyệt"));
		const onlyRejected = await getPage(harness, auth, "/contributions?dd=rejected");
		assert.equal(rowCount(onlyRejected), 1);
		assert.ok(onlyRejected.includes("Bị từ chối rồi"));
		const pendingAll = await getPage(harness, auth, "/contributions?dd=pending&tt=all");
		assert.equal(rowCount(pendingAll), 2, "kể cả contribution chờ duyệt đã bị gỡ");
		assert.ok(pendingAll.includes(`href="${pageUrl(`/contributions/view?id=${removed.id}`)}"`));
		assert.match(pendingAll, /<td class="ct-state"><span class="badge off">Đã gỡ<\/span><\/td>/u, "chờ duyệt rồi bị gỡ: chỉ hiện Đã gỡ");
		assert.equal(rowCount(await getPage(harness, auth, "/contributions?dd=xoa")), 3, "giá trị lạ về tất cả");
	});

	test("phân trang giữ bộ lọc duyệt; số chờ duyệt không tính contribution đã gỡ", async () =>
	{
		const harness = createWebHarness();
		for (let index = 1; index <= CONTRIBUTION_PAGE_SIZE + 1; index++) submit(harness, { title: `Chờ số ${index}` });
		const auth = await login(harness, ADMIN_USER);
		const first = await getPage(harness, auth, "/contributions?dd=pending");
		assert.equal(rowCount(first), CONTRIBUTION_PAGE_SIZE);
		assert.ok(first.includes(`href="${pageUrl("/contributions?tt=active&amp;dd=pending&amp;trang=2")}"`), "link trang sau giữ dd");
		assert.ok(first.includes(`⏳ Chờ duyệt (${CONTRIBUTION_PAGE_SIZE + 1})`));
		harness.services.contributions.remove(GUILD, 1, ADMIN_USER);
		assert.ok((await getPage(harness, auth, "/contributions")).includes(`⏳ Chờ duyệt (${CONTRIBUTION_PAGE_SIZE})`));
	});
});

describe("web contribution (DEC-051): duyệt và từ chối", () =>
{
	test("chi tiết: chỉ contribution còn hiệu lực đang chờ duyệt có form Duyệt và Từ chối (CSRF, lý do bắt buộc, giới hạn độ dài)", async () =>
	{
		const harness = createWebHarness();
		const { contributions } = harness.services;
		const waiting = submit(harness);
		const approved = submit(harness, { title: "Đã duyệt" });
		contributions.approve(GUILD, approved.id, ADMIN_USER);
		const removed = submit(harness, { title: "Đã gỡ" });
		contributions.remove(GUILD, removed.id, ADMIN_USER);
		const auth = await login(harness, ADMIN_USER);

		const page = await getPage(harness, auth, `/contributions/view?id=${waiting.id}`);
		for (const path of ["/contributions/approve", "/contributions/reject", "/contributions/remove"])
		{
			const start = page.indexOf(`action="${pageUrl(path)}"`);
			assert.ok(start >= 0, path);
			const form = page.slice(start, page.indexOf("</form>", start));
			assert.ok(form.includes(`name="_csrf" value="${auth.csrf}"`) && form.includes(`name="id" value="${waiting.id}"`), path);
		}
		const { rejectReasonMin, rejectReasonMax } = CONTRIBUTION_LIMITS;
		assert.ok(page.includes(`<textarea id="ct-reason" name="${REJECT_REASON_FIELD}" rows="3" minlength="${rejectReasonMin}" maxlength="${rejectReasonMax}" required></textarea>`));
		assert.ok(page.includes("badge warn\">⏳ Chờ duyệt") && !page.includes("Người duyệt"));
		assert.ok(!page.includes("ct-voters") && !page.includes("Lượt bấm"), "chờ duyệt thì chưa có bảng lượt bấm");
		assert.ok(!page.includes(" style="), "không có style inline (CSP)");

		const approvedPage = await getPage(harness, auth, `/contributions/view?id=${approved.id}`);
		assert.ok(!approvedPage.includes(`action="${pageUrl("/contributions/approve")}"`) && !approvedPage.includes(`action="${pageUrl("/contributions/reject")}"`));
		assert.ok(approvedPage.includes("Lượt bấm: 0") && approvedPage.includes("Chưa có ai bấm"));
		const removedPage = await getPage(harness, auth, `/contributions/view?id=${removed.id}`);
		assert.ok(!removedPage.includes(`action="${pageUrl("/contributions/approve")}"`) && removedPage.includes("đã bị gỡ"));
	});

	test("duyệt: người duyệt và audit là người đăng nhập, sửa thẻ, nhắn riêng tác giả và người ghi nhận, flash; duyệt lần hai báo lỗi về trang chi tiết", async () =>
	{
		const harness = createWebHarness();
		const { services } = harness;
		const contribution = submit(harness, { submittedBy: ROLE_ADMIN_USER, title: "Sửa lỗi đăng nhập" });
		services.contributions.attachMessage(GUILD, contribution.id, CHANNEL_CHAT, MESSAGE_ID);
		const auth = await login(harness, ADMIN_USER);
		const detailUrl = pageUrl(`/contributions/view?id=${contribution.id}`);

		const response = await post(harness, auth, "/contributions/approve", { id: String(contribution.id) });
		assert.equal(response.status, 303);
		assert.equal(response.headers.Location, detailUrl);
		const saved = services.contributions.get(GUILD, contribution.id);
		assert.equal(saved?.reviewState, "approved");
		assert.equal(saved.reviewedBy, ADMIN_USER);
		assert.equal(saved.reviewedAt, harness.clock.now());
		const [entry] = services.audit.list(GUILD, 1);
		assert.equal(entry?.action, "contribution.approve");
		assert.equal(entry.actorId, ADMIN_USER);
		assert.equal(entry.targetId, PLAIN_USER);
		assert.deepEqual(entry.details, { contributionId: contribution.id, title: "Sửa lỗi đăng nhập" });
		assert.deepEqual(harness.adminCalls, [`refreshContribution:${contribution.id}`, `sendDirectMessage:${PLAIN_USER}`, `sendDirectMessage:${ROLE_ADMIN_USER}`]);

		const flash = await flashAfter(harness, auth, response);
		assert.equal(flash.kind, "ok");
		assert.ok(flash.text.includes(`Đã duyệt đóng góp #${contribution.id}`) && flash.text.includes("Sửa lỗi đăng nhập"), flash.text);
		assert.ok(!flash.text.includes(CARD_EDIT_FAILED) && !flash.text.includes(NOTICE_FAILED));
		const after = await getPage(harness, auth, `/contributions/view?id=${contribution.id}`);
		assert.ok(after.includes("badge ok\">✅ Đã duyệt") && after.includes("<dt>Người duyệt</dt>") && after.includes("<dt>Lúc duyệt</dt>"));
		assert.ok(after.includes("Admin &lt;b&gt;"), "tên người duyệt được escape");
		assert.ok(!after.includes(`action="${pageUrl("/contributions/approve")}"`));

		harness.clock.advance(DUPLICATE_POST_WINDOW_MS);
		const again = await post(harness, auth, "/contributions/approve", { id: String(contribution.id) });
		assert.equal(again.headers.Location, detailUrl);
		assert.deepEqual(await flashAfter(harness, auth, again), { kind: "error", text: `Đóng góp #${contribution.id} đã được duyệt.` });
		const rejectApproved = await post(harness, auth, "/contributions/reject", { id: String(contribution.id), [REJECT_REASON_FIELD]: "Lý do hợp lệ" });
		assert.equal(rejectApproved.headers.Location, detailUrl);
		assert.equal((await flashAfter(harness, auth, rejectApproved)).kind, "error");
		assert.equal(harness.adminCalls.length, 3, "lỗi thì không sửa thẻ hay nhắn riêng thêm");
		assert.equal(services.contributions.get(GUILD, contribution.id)?.reviewState, "approved");
	});

	test("duyệt bài chưa có thẻ (đăng lỗi lúc gửi): flash nhắc Đăng lại thẻ (review Phase 20)", async () =>
	{
		const harness = createWebHarness();
		const contribution = submit(harness, { title: "Chưa có thẻ" });
		const auth = await login(harness, ADMIN_USER);
		const response = await post(harness, auth, "/contributions/approve", { id: String(contribution.id) });
		const flash = await flashAfter(harness, auth, response);
		assert.equal(flash.kind, "ok");
		assert.ok(flash.text.includes("chưa có thẻ trong Discord") && flash.text.includes("Đăng lại thẻ"), flash.text);
		assert.ok(!flash.text.includes(CARD_EDIT_FAILED), "chưa có thẻ thì không báo sửa thẻ lỗi");
	});

	test("đăng lại thẻ: chờ duyệt và đã duyệt có form, gọi repostContribution, flash; bị từ chối hoặc đã gỡ thì không có form và POST báo lỗi", async () =>
	{
		const harness = createWebHarness();
		const { services } = harness;
		const pending = submit(harness, { title: "Chưa có thẻ" });
		const auth = await login(harness, ADMIN_USER);
		const detail = await getPage(harness, auth, `/contributions/view?id=${pending.id}`);
		assert.ok(detail.includes(`action="${pageUrl("/contributions/repost")}"`), "bài chờ duyệt có form đăng lại thẻ");
		assert.ok(detail.includes("chưa có thẻ trong Discord"), "bài chưa có thẻ thì có cảnh báo");

		const response = await post(harness, auth, "/contributions/repost", { id: String(pending.id) });
		assert.equal(response.headers.Location, pageUrl(`/contributions/view?id=${pending.id}`));
		const flash = await flashAfter(harness, auth, response);
		assert.equal(flash.kind, "ok");
		assert.ok(flash.text.includes(`Đã đăng lại thẻ contribution #${pending.id}`), flash.text);
		assert.deepEqual(harness.adminCalls, [`repostContribution:${pending.id}`]);

		const rejected = submit(harness, { title: "Bị từ chối" });
		services.contributions.reject(GUILD, rejected.id, ADMIN_USER, "Không đủ thông tin");
		const rejectedPage = await getPage(harness, auth, `/contributions/view?id=${rejected.id}`);
		assert.ok(!rejectedPage.includes(`action="${pageUrl("/contributions/repost")}"`));
		harness.clock.advance(DUPLICATE_POST_WINDOW_MS);
		const refused = await post(harness, auth, "/contributions/repost", { id: String(rejected.id) });
		assert.deepEqual(await flashAfter(harness, auth, refused), { kind: "error", text: `Contribution #${rejected.id} đã bị từ chối nên không cần đăng lại thẻ.` });

		const elsewhere = submit(harness, { title: "Thẻ ở kênh khác" });
		services.contributions.approve(GUILD, elsewhere.id, ADMIN_USER);
		services.contributions.attachMessage(GUILD, elsewhere.id, CHANNEL_WORK, MESSAGE_ID);
		const elsewherePage = await getPage(harness, auth, `/contributions/view?id=${elsewhere.id}`);
		assert.ok(!elsewherePage.includes(`action="${pageUrl("/contributions/repost")}"`), "thẻ ở kênh khác kênh contribution: không có form");
		harness.clock.advance(DUPLICATE_POST_WINDOW_MS);
		const moved = await post(harness, auth, "/contributions/repost", { id: String(elsewhere.id) });
		assert.deepEqual(await flashAfter(harness, auth, moved), { kind: "error", text: REPOST_OTHER_CHANNEL });

		addSecretChannel(harness);
		services.guildConfig.updateSettings(GUILD, { contributionChannelId: CHANNEL_SECRET }, ADMIN_USER);
		const hidden = submit(harness, { title: "Thẻ ở kênh bí mật" });
		services.contributions.attachMessage(GUILD, hidden.id, CHANNEL_SECRET, MESSAGE_ID);
		const hiddenPage = await getPage(harness, auth, `/contributions/view?id=${hidden.id}`);
		assert.ok(!hiddenPage.includes(`action="${pageUrl("/contributions/repost")}"`), "admin không xem được kênh của thẻ: không có form");
		harness.clock.advance(DUPLICATE_POST_WINDOW_MS);
		const blind = await post(harness, auth, "/contributions/repost", { id: String(hidden.id) });
		assert.deepEqual(await flashAfter(harness, auth, blind), { kind: "error", text: REPOST_HIDDEN });

		services.contributions.remove(GUILD, pending.id, ADMIN_USER);
		harness.clock.advance(DUPLICATE_POST_WINDOW_MS);
		const removed = await post(harness, auth, "/contributions/repost", { id: String(pending.id) });
		assert.deepEqual(await flashAfter(harness, auth, removed), { kind: "error", text: `Contribution #${pending.id} đã bị gỡ nên không đăng lại thẻ.` });
		assert.equal(harness.adminCalls.length, 1, "lỗi thì không gọi đăng lại");
	});

	test("từ chối: lý do rỗng, quá ngắn, quá dài báo lỗi về đúng trang và không ghi gì; lý do hợp lệ được lưu, audit, nhắn riêng, admin xem được", async () =>
	{
		const harness = createWebHarness();
		const { services } = harness;
		const contribution = submit(harness, { title: "Ý tưởng cũ" });
		const auth = await login(harness, ADMIN_USER);
		const detailUrl = pageUrl(`/contributions/view?id=${contribution.id}`);
		const before = auditCount(harness);

		for (const reason of ["", "  ab  ", "a".repeat(CONTRIBUTION_LIMITS.rejectReasonMax + 1)])
		{
			const response = await post(harness, auth, "/contributions/reject", { id: String(contribution.id), [REJECT_REASON_FIELD]: reason });
			assert.equal(response.headers.Location, detailUrl, `lý do dài ${reason.length}`);
			assert.deepEqual(await flashAfter(harness, auth, response), { kind: "error", text: REJECT_LENGTH_ERROR });
		}
		const missing = await post(harness, auth, "/contributions/reject", { id: String(contribution.id) });
		assert.deepEqual(await flashAfter(harness, auth, missing), { kind: "error", text: REJECT_LENGTH_ERROR }, "thiếu ô lý do");
		assert.equal(services.contributions.get(GUILD, contribution.id)?.reviewState, "pending");
		assert.equal(auditCount(harness), before);
		assert.deepEqual(harness.adminCalls, []);

		const reason = "  Trùng với <b>#3</b> 😀  ";
		const response = await post(harness, auth, "/contributions/reject", { id: String(contribution.id), [REJECT_REASON_FIELD]: reason });
		assert.equal(response.headers.Location, detailUrl);
		const saved = services.contributions.get(GUILD, contribution.id);
		assert.equal(saved?.reviewState, "rejected");
		assert.equal(saved.reviewReason, "Trùng với <b>#3</b> 😀");
		assert.equal(saved.reviewedBy, ADMIN_USER);
		const [entry] = services.audit.list(GUILD, 1);
		assert.equal(entry?.action, "contribution.reject");
		assert.equal(entry.actorId, ADMIN_USER);
		assert.equal(entry.targetId, PLAIN_USER);
		assert.deepEqual(entry.details, { contributionId: contribution.id, title: "Ý tưởng cũ" }, "lý do không ghi vào audit");
		assert.deepEqual(harness.adminCalls, [`refreshContribution:${contribution.id}`, `sendDirectMessage:${PLAIN_USER}`], "người gửi là tác giả: nhắn một lần");

		const flash = await flashAfter(harness, auth, response);
		assert.equal(flash.kind, "ok");
		assert.ok(flash.text.includes(`Đã từ chối đóng góp #${contribution.id}`) && !flash.text.includes("Trùng với"), flash.text);
		const after = await getPage(harness, auth, `/contributions/view?id=${contribution.id}`);
		assert.ok(after.includes("badge off\">❌ Bị từ chối") && after.includes("<dt>Người từ chối</dt>") && after.includes("<dt>Lúc từ chối</dt>"));
		assert.ok(after.includes("<dt>Lý do từ chối</dt><dd><span class=\"ct-reason\">Trùng với &lt;b&gt;#3&lt;/b&gt; 😀</span></dd>"), "lý do được escape");
		assert.ok(!after.includes("<b>#3</b>"));
		assert.ok(!after.includes(`action="${pageUrl("/contributions/reject")}"`) && !after.includes("ct-voters"));
	});

	test("không sửa được thẻ và không nhắn riêng được: flash kèm cảnh báo của contributionOps", async () =>
	{
		const harness = createWebHarness();
		harness.deps.adminActions.refreshContribution = () => Promise.resolve(false);
		harness.deps.adminActions.sendDirectMessage = () => Promise.resolve(false);
		const contribution = submit(harness);
		harness.services.contributions.attachMessage(GUILD, contribution.id, CHANNEL_CHAT, MESSAGE_ID);
		const auth = await login(harness, ADMIN_USER);

		const flash = await flashAfter(harness, auth, await post(harness, auth, "/contributions/approve", { id: String(contribution.id) }));
		assert.equal(flash.kind, "ok");
		assert.ok(flash.text.includes(CARD_EDIT_FAILED) && flash.text.includes(NOTICE_FAILED), flash.text);
		assert.equal(harness.services.contributions.get(GUILD, contribution.id)?.reviewState, "approved");
	});

	test("bảo mật: CSRF sai, Origin lạ, người hết quyền admin bị 403 và không ghi gì; mã sai hoặc không có thì về danh sách", async () =>
	{
		const harness = createWebHarness();
		const { services } = harness;
		const contribution = submit(harness);
		const auth = await login(harness, ADMIN_USER);
		const id = String(contribution.id);

		const forged = await call(harness, pageUrl("/contributions/approve"), { cookies: auth.cookies, form: { _csrf: "sai", id } });
		assert.equal(forged.status, 403);
		const foreign = await call(harness, pageUrl("/contributions/reject"), {
			cookies: auth.cookies,
			form: withCsrf(auth, { id, [REJECT_REASON_FIELD]: "Lý do hợp lệ" }),
			headers: { origin: "http://evil.example" },
		});
		assert.equal(foreign.status, 403);

		services.guildConfig.updateSettings(GUILD, { adminRoleIds: [ROLE_ADMIN_BOT] }, ADMIN_USER);
		const former = await login(harness, ROLE_ADMIN_USER);
		services.guildConfig.updateSettings(GUILD, { adminRoleIds: [] }, ADMIN_USER);
		assert.equal((await post(harness, former, "/contributions/approve", { id })).status, 403, "mất quyền admin: 403 và phiên bị huỷ");
		assert.equal((await post(harness, former, "/contributions/reject", { id, [REJECT_REASON_FIELD]: "Lý do hợp lệ" })).status, 403);
		assert.equal(services.contributions.get(GUILD, contribution.id)?.reviewState, "pending");
		assert.deepEqual(harness.adminCalls, []);

		const invalid = await post(harness, auth, "/contributions/approve", { id: "1 OR 1=1" });
		assert.equal(invalid.headers.Location, pageUrl("/contributions"));
		assert.deepEqual(await flashAfter(harness, auth, invalid), { kind: "error", text: INVALID_CONTRIBUTION_ID });
		const unknown = await post(harness, auth, "/contributions/reject", { id: "999", [REJECT_REASON_FIELD]: "Lý do hợp lệ" });
		assert.equal(unknown.headers.Location, pageUrl("/contributions"));
		assert.deepEqual(await flashAfter(harness, auth, unknown), { kind: "error", text: "Không tìm thấy contribution này." });
	});
});

describe("web contribution (DEC-051): lượt 👍/👎 và riêng tư theo kênh", () =>
{
	test("bảng lượt bấm: người bấm có link hồ sơ, loại, lý do 👎 được escape, còn hiệu lực rồi đã huỷ sau khi reset", async () =>
	{
		const harness = createWebHarness();
		const { contributions } = harness.services;
		const contribution = submit(harness);
		contributions.approve(GUILD, contribution.id, ADMIN_USER);
		vote(harness, contribution.id, ADMIN_USER, "up");
		vote(harness, contribution.id, STRANGER, "down", "<b>Thiếu</b> số liệu");
		const auth = await login(harness, ADMIN_USER);

		const page = await getPage(harness, auth, `/contributions/view?id=${contribution.id}`);
		assert.ok(page.includes("Lượt bấm: 2"));
		assert.match(page, /<dt>👍 Lượt ghi nhận<\/dt><dd>1<\/dd><dt>👎 Lượt không ghi nhận<\/dt><dd>1<\/dd><dt>Điểm của contribution<\/dt><dd>0<\/dd>/u);
		const table = votersTable(page);
		assert.ok(table.includes(`href="${pageUrl(`/members/view?u=${ADMIN_USER}`)}"`) && table.includes(`href="${pageUrl(`/members/view?u=${STRANGER}`)}"`));
		assert.ok(table.includes("đã rời server"), "người bấm không còn trong server");
		assert.ok(table.indexOf(ADMIN_USER) < table.indexOf(STRANGER), "cũ nhất trước");
		assert.ok(table.includes("👍 Ghi nhận") && table.includes("👎 Không ghi nhận"));
		assert.ok(table.includes("<span class=\"ct-reason\">&lt;b&gt;Thiếu&lt;/b&gt; số liệu</span>") && !table.includes("<b>Thiếu</b>"));
		assert.equal(occurrences(table, "badge ok\">Còn hiệu lực"), 2);

		contributions.resetUser(GUILD, PLAIN_USER, ADMIN_USER);
		const reset = votersTable(await getPage(harness, auth, `/contributions/view?id=${contribution.id}`));
		assert.equal(occurrences(reset, "badge off\">Đã huỷ"), 2);
		assert.equal(occurrences(reset, "Còn hiệu lực"), 0);
	});

	test("kênh riêng tư: không lộ tiêu đề, lý do từ chối, lý do 👎; vẫn duyệt và từ chối được, thông báo không có tiêu đề", async () =>
	{
		const harness = createWebHarness();
		const { contributions } = harness.services;
		addSecretChannel(harness);
		const first = submit(harness, { title: "Bí mật lương thưởng", description: "Nội dung mật" });
		contributions.attachMessage(GUILD, first.id, CHANNEL_SECRET, MESSAGE_ID);
		const second = submit(harness, { title: "Bí mật thứ hai" });
		contributions.attachMessage(GUILD, second.id, CHANNEL_SECRET, "600000000000000002");
		const auth = await login(harness, ADMIN_USER);

		const pending = await getPage(harness, auth, `/contributions/view?id=${first.id}`);
		for (const leak of ["Bí mật lương thưởng", "Nội dung mật", SECRET_CHANNEL_NAME]) assert.ok(!pending.includes(leak), leak);
		assert.ok(pending.includes(HIDDEN_ITEM_TEXT) && pending.includes("Bạn không xem được nội dung contribution này"));
		assert.ok(pending.includes(`action="${pageUrl("/contributions/approve")}"`) && pending.includes(`action="${pageUrl("/contributions/reject")}"`));

		const approved = await flashAfter(harness, auth, await post(harness, auth, "/contributions/approve", { id: String(first.id) }));
		assert.equal(approved.kind, "ok");
		assert.ok(approved.text.includes(`Đã duyệt contribution #${first.id}`) && !approved.text.includes("Bí mật"), approved.text);
		vote(harness, first.id, STRANGER, "down", "Lý do mật của người bấm");
		const voted = await getPage(harness, auth, `/contributions/view?id=${first.id}`);
		assert.ok(!voted.includes("Lý do mật của người bấm") && voted.includes(HIDDEN_REASON_TEXT));
		assert.ok(votersTable(voted).includes(`href="${pageUrl(`/members/view?u=${STRANGER}`)}"`), "vẫn thấy ai bấm và loại lượt");

		const rejected = await flashAfter(harness, auth, await post(harness, auth, "/contributions/reject", { id: String(second.id), [REJECT_REASON_FIELD]: "Lý do từ chối mật" }));
		assert.equal(rejected.kind, "ok");
		assert.ok(rejected.text.includes(`Đã từ chối contribution #${second.id}`) && !rejected.text.includes("Bí mật"), rejected.text);
		assert.equal(contributions.get(GUILD, second.id)?.reviewReason, "Lý do từ chối mật");
		const rejectedPage = await getPage(harness, auth, `/contributions/view?id=${second.id}`);
		assert.ok(!rejectedPage.includes("Lý do từ chối mật") && !rejectedPage.includes("Bí mật thứ hai"));
		assert.ok(rejectedPage.includes("<dt>Lý do từ chối</dt>") && rejectedPage.includes(HIDDEN_REASON_TEXT) && rejectedPage.includes("<dt>Người từ chối</dt>"));

		const list = await getPage(harness, auth, "/contributions");
		for (const leak of ["Bí mật lương thưởng", "Bí mật thứ hai", SECRET_CHANNEL_NAME]) assert.ok(!list.includes(leak), leak);
	});
});

describe("web contribution (DEC-051): cấu hình", () =>
{
	test("Cài đặt điểm: chọn kênh contribution, XP người bấm và giới hạn ngày; chỉ ghi phần đổi; XP người bấm áp dụng ngay", async () =>
	{
		const harness = createWebHarness();
		const { services } = harness;
		const auth = await login(harness, ADMIN_USER);

		const body = await getPage(harness, auth, "/settings");
		assert.ok(body.includes("<select id=\"st-contributionChannelId\" name=\"contributionChannelId\">"));
		assert.ok(body.includes("<option value=\"\" selected>Chưa chọn (thành viên chưa gửi được contribution)</option>"));
		assert.ok(body.includes(NO_CONTRIBUTION_CHANNEL), "chưa chọn kênh thì cảnh báo");
		const select = body.slice(body.indexOf("name=\"contributionChannelId\""), body.indexOf("</select>", body.indexOf("name=\"contributionChannelId\"")));
		assert.ok(select.includes(`<option value="${CHANNEL_CHAT}">#chung</option>`) && select.includes(`<option value="${CHANNEL_ANNOUNCE}">`));
		assert.ok(!select.includes(`value="${CHANNEL_VOICE}"`), "không có kênh voice");
		assert.match(body, /name="contributionInteractionXp" value="5" min="0" max="100" step="1" required>/u);
		assert.match(body, /name="contributionInteractionXpDailyCap" value="25" min="0" max="100000" step="1" required>/u);
		assert.ok(body.includes("XP cho người bấm ghi nhận") && body.includes("Giới hạn XP từ contribution mỗi ngày"));
		assert.ok(body.includes("mỗi lượt 👎 Không ghi nhận trừ chừng này"), "mô tả điểm mỗi lượt theo 👍/👎");

		let fields = formFields(body, "/settings");
		fields = setField(setField(setField(fields, "contributionChannelId", CHANNEL_CHAT), "contributionInteractionXp", "7"), "contributionInteractionXpDailyCap", "10");
		const flash = await submitFields(harness, auth, "/settings", fields);
		assert.equal(flash.kind, "ok", flash.text);
		assert.ok(flash.text.includes("Kênh contribution") && flash.text.includes("#chung") && flash.text.includes("XP cho người bấm ghi nhận"), flash.text);
		const settings = services.guildConfig.getSettings(GUILD);
		assert.equal(settings.contributionChannelId, CHANNEL_CHAT);
		assert.equal(settings.contributionInteractionXp, 7);
		assert.equal(settings.contributionInteractionXpDailyCap, 10);
		const [entry] = services.audit.list(GUILD, 1);
		assert.equal(entry?.action, "config.update");
		assert.equal(entry.actorId, ADMIN_USER);
		assert.deepEqual(entry.details, { contributionInteractionXp: 7, contributionInteractionXpDailyCap: 10, contributionChannelId: CHANNEL_CHAT });

		const redrawn = await getPage(harness, auth, "/settings");
		assert.ok(redrawn.includes(`<option value="${CHANNEL_CHAT}" selected>#chung</option>`) && !redrawn.includes(NO_CONTRIBUTION_CHANNEL));
		assert.ok(redrawn.includes(`name="d:contributionChannelId" value="${CHANNEL_CHAT}"`));

		const one = submit(harness, { title: "Thứ nhất" });
		const two = submit(harness, { title: "Thứ hai" });
		services.contributions.approve(GUILD, one.id, ADMIN_USER);
		services.contributions.approve(GUILD, two.id, ADMIN_USER);
		const firstVote = vote(harness, one.id, ADMIN_USER, "up");
		const secondVote = vote(harness, two.id, ADMIN_USER, "down", "Chưa rõ ràng");
		assert.deepEqual([firstVote.xpAwarded, firstVote.xpCapped], [7, false]);
		assert.deepEqual([secondVote.xpAwarded, secondVote.xpCapped], [3, true], "giới hạn 10 XP mỗi ngày");
		assert.equal(services.activity.getProfile(GUILD, ADMIN_USER).level.totalXp, 10);
	});

	test("kênh contribution sai loại, không còn, người chọn hoặc bot thiếu quyền: báo lỗi, không ghi gì; trang cũ không đè; chọn lại Chưa chọn; cảnh báo kênh hỏng", async () =>
	{
		const harness = createWebHarness();
		const { services } = harness;
		addChannel(harness.world, { id: CHANNEL_NO_EMBED, name: "khong-embed", type: ChannelType.GuildText, position: 5, permissionsByMember: { [BOT_ID]: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] } });
		addChannel(harness.world, { id: CHANNEL_NO_SEND, name: "khong-gui", type: ChannelType.GuildText, position: 6, permissionsByMember: { [ADMIN_USER]: [PermissionFlagsBits.ViewChannel] } });
		const auth = await login(harness, ADMIN_USER);
		const fields = formFields(await getPage(harness, auth, "/settings"), "/settings");

		const cases: [string, string][] = [
			[CHANNEL_VOICE, "Kênh contribution phải là kênh văn bản hoặc kênh thông báo của server."],
			[CHANNEL_GONE, "Kênh contribution phải là kênh văn bản hoặc kênh thông báo của server."],
			[CHANNEL_NO_SEND, "Bạn không có quyền <strong>Send Messages</strong>"],
			[CHANNEL_NO_EMBED, "Bot thiếu quyền <strong>Embed Links</strong>"],
			["abc", SETTINGS_STALE_FORM],
		];
		for (const [channelId, message] of cases)
		{
			const flash = await submitFields(harness, auth, "/settings", setField(setField(fields, "contributionChannelId", channelId), "xpPerMessage", "12"));
			assert.equal(flash.kind, "error", channelId);
			assert.ok(flash.text.includes(message), `${channelId}: ${flash.text}`);
		}
		assert.equal(services.guildConfig.getSettings(GUILD).contributionChannelId, null);
		assert.equal(services.guildConfig.getSettings(GUILD).xpPerMessage, 10, "lỗi ở ô kênh thì không ghi ô nào");
		assert.equal(auditCount(harness), 0);

		services.guildConfig.updateSettings(GUILD, { contributionChannelId: CHANNEL_WORK }, ROLE_ADMIN_USER);
		assert.equal((await submitFields(harness, auth, "/settings", setField(fields, "xpPerMessage", "20"))).kind, "ok");
		assert.equal(services.guildConfig.getSettings(GUILD).contributionChannelId, CHANNEL_WORK, "form cũ không kéo kênh về trạng thái lúc vẽ");

		const fresh = formFields(await getPage(harness, auth, "/settings"), "/settings");
		const cleared = await submitFields(harness, auth, "/settings", setField(fresh, "contributionChannelId", ""));
		assert.ok(cleared.text.includes("chưa chọn"), cleared.text);
		assert.equal(services.guildConfig.getSettings(GUILD).contributionChannelId, null);

		services.guildConfig.updateSettings(GUILD, { contributionChannelId: CHANNEL_NO_EMBED }, ROLE_ADMIN_USER);
		const broken = await getPage(harness, auth, "/settings");
		assert.ok(broken.includes("Bot đang thiếu quyền <strong>Embed Links</strong> ở kênh contribution"));
		assert.ok(broken.includes(`<option value="${CHANNEL_NO_EMBED}" selected>#khong-embed</option>`));
		services.guildConfig.updateSettings(GUILD, { contributionChannelId: CHANNEL_GONE }, ROLE_ADMIN_USER);
		const gone = await getPage(harness, auth, "/settings");
		assert.ok(gone.includes("Kênh contribution đang đặt không còn trong server"));
		assert.ok(gone.includes(`<option value="${CHANNEL_GONE}" selected>`), "kênh đang đặt luôn có trong danh sách");
	});

	test("Quyền: bảng Role duyệt contribution thêm, bỏ, bỏ hết; không có Chọn tất cả (như bảng role admin); role managed bị khoá; audit", async () =>
	{
		const harness = createWebHarness();
		const { services } = harness;
		const auth = await login(harness, ADMIN_USER);
		const reviewers = (): string[] => services.guildConfig.getSettings(GUILD).contributionReviewerRoleIds;

		const body = await getPage(harness, auth, "/roles");
		assert.ok(body.includes(`✅ Role duyệt contribution: 0/${MAX_GRANT_ROLES}`) && body.includes("Chưa đặt role nào: chỉ admin bot duyệt được contribution."));
		assert.ok(body.includes("người duyệt được duyệt cả contribution của chính mình"));
		assert.match(body, new RegExp(`name="duyet" value="${ROLE_MANAGED}" disabled>`, "u"));
		assert.ok(!body.includes("chon-duyet="), "bảng role duyệt không có Chọn tất cả (review bảo mật Phase 20)");
		assert.ok(body.includes(`name="r:${ROLE_TEAM_A}" value="0"`));

		const added = await submitFields(harness, auth, "/roles", check(formFields(body, "/roles"), "duyet", ROLE_TEAM_A, true));
		assert.equal(added.kind, "ok", added.text);
		assert.ok(added.text.includes("role duyệt contribution") && added.text.includes("@Backend"), added.text);
		assert.deepEqual(reviewers(), [ROLE_TEAM_A]);
		assert.deepEqual(services.guildConfig.getSettings(GUILD).adminRoleIds, [], "không đụng bảng khác");
		const [entry] = services.audit.list(GUILD, 1);
		assert.equal(entry?.actorId, ADMIN_USER);
		assert.deepEqual(entry.details, { contributionReviewerRoleIds: [ROLE_TEAM_A], addedRoles: [ROLE_TEAM_A] });

		const ignored = formFields(await getPage(harness, auth, "/roles?chon-duyet=tat-ca"), "/roles");
		assert.deepEqual(ticked(ignored, "duyet"), [ROLE_TEAM_A], "tham số chọn tất cả bị bỏ qua: vẫn như đang lưu");
		const more = check(check(ignored, "duyet", ROLE_TEAM_B, true), "duyet", ROLE_ADMIN_BOT, true);
		assert.equal((await submitFields(harness, auth, "/roles", more)).kind, "ok");
		assert.deepEqual([...reviewers()].sort(), [ROLE_ADMIN_BOT, ROLE_TEAM_A, ROLE_TEAM_B].sort());

		const removeOne = check(formFields(await getPage(harness, auth, "/roles"), "/roles"), "duyet", ROLE_TEAM_B, false);
		assert.equal((await submitFields(harness, auth, "/roles", removeOne)).kind, "ok");
		assert.deepEqual([...reviewers()].sort(), [ROLE_ADMIN_BOT, ROLE_TEAM_A].sort());

		let none = formFields(await getPage(harness, auth, "/roles"), "/roles");
		for (const roleId of ticked(none, "duyet")) none = check(none, "duyet", roleId, false);
		assert.deepEqual(ticked(none, "duyet"), []);
		const clearedFlash = await submitFields(harness, auth, "/roles", none);
		assert.ok(clearedFlash.text.includes("Đã bỏ") && clearedFlash.text.includes("chưa đặt (chỉ admin)"), clearedFlash.text);
		assert.deepEqual(reviewers(), []);

		const forged = setField(formFields(await getPage(harness, auth, "/roles"), "/roles"), "duyet", ROLE_MANAGED);
		const rejected = await submitFields(harness, auth, "/roles", forged);
		assert.equal(rejected.kind, "error", "role managed không thêm được dù sửa form");
		assert.deepEqual(reviewers(), []);
	});

	test("Tổng quan: thẻ Contribution hiện kênh, điểm, XP người bấm, giới hạn ngày, số chờ duyệt có link; thẻ Quyền hiện role duyệt", async () =>
	{
		const harness = createWebHarness();
		const { services } = harness;
		const auth = await login(harness, ADMIN_USER);
		const empty = await getPage(harness, auth, "");
		assert.ok(empty.includes(NO_CONTRIBUTION_CHANNEL) && empty.includes("chưa chọn (chưa gửi được contribution)"));
		assert.ok(empty.includes("⏳ Chờ duyệt: <strong>0</strong> contribution"));

		services.guildConfig.updateSettings(GUILD, { contributionChannelId: CHANNEL_CHAT, contributionReviewerRoleIds: [ROLE_TEAM_A] }, ADMIN_USER);
		submit(harness);
		submit(harness, { title: "Thứ hai" });
		const body = await getPage(harness, auth, "");
		assert.ok(!body.includes(NO_CONTRIBUTION_CHANNEL));
		const start = body.indexOf("<h2>🤝 Contribution</h2>");
		assert.ok(start >= 0);
		const card = body.slice(start, body.indexOf("</section>", start));
		for (const part of ["Kênh contribution", "#chung", "Điểm mỗi lượt ghi nhận", "XP cho người bấm ghi nhận", "<strong>5 XP</strong>", "Giới hạn XP từ contribution mỗi ngày", "<strong>25 XP</strong>"])
		{
			assert.ok(card.includes(part), part);
		}
		assert.ok(card.includes(`href="${pageUrl(PENDING_LIST_PATH).replace(/&/gu, "&amp;")}"`) && card.includes("⏳ Chờ duyệt: <strong>2</strong> contribution"));
		const roles = body.slice(body.indexOf("<h2>🔐 Quyền</h2>"));
		assert.ok(roles.includes("Role duyệt contribution") && roles.includes("@Backend"));
	});
});
