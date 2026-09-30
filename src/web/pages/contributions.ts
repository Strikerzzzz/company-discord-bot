// Trang "Contribution" của web quản trị (DEC-041): danh sách contribution (kể cả đã gỡ) có bộ lọc và phân trang, trang chi tiết,
// và gỡ contribution. Tương đương `/contribution view|list` và `/admin contribution remove`: gỡ đi qua removeContribution
// (adminOps, dùng chung với lệnh Discord) rồi sửa message công khai. Mục nằm trong kênh mà người đăng nhập không xem được thì
// giấu tiêu đề, mô tả, link và kênh (lệnh Discord báo "không tìm thấy"), nhưng vẫn gỡ được như `/admin contribution remove`.
import { removeContribution } from "../../discord/adminOps";
import { formatNumber, userMention } from "../../discord/format";
import { MemberDisplay } from "../../discord/memberDirectory";
import { categoryLabel, contributionMessageUrl } from "../../discord/views/contribution";
import { Contribution, ContributionListQuery } from "../../modules/contribution/types";
import { UserError } from "../../shared/errors";
import { canViewItemChannel, hiddenChannelIds } from "../discord";
import { channelLabel, PRIVATE_CHANNEL_LABEL } from "../format";
import { html, HtmlValue, RawHtml } from "../html";
import { WebResponse } from "../http";
import { csrfField, guildUrl, redirectWithFlash, renderPage } from "../layout";
import { GuildPageContext, PageModule } from "../types";
import { formatDateTime, metaList, HIDDEN_ITEM_TEXT, memberLink, pager, parsePositiveId, parseUserId, queryPage, withMessageEditNote } from "../widgets";

const PATH = "/contributions";
const VIEW_PATH = `${PATH}/view`;
const REMOVE_PATH = `${PATH}/remove`;
/** Số contribution mỗi trang của danh sách. */
export const CONTRIBUTION_PAGE_SIZE = 20;
const STATUS_PARAM = "tt";
const AUTHOR_PARAM = "u";
const CONFIRM_FIELD = "xac-nhan";

export const INVALID_CONTRIBUTION_ID = "Mã contribution không hợp lệ.";
export const REMOVE_CONFIRM_REQUIRED = "Hãy tick ô xác nhận trước khi gỡ.";
const INVALID_AUTHOR = "Tác giả phải là Discord user ID (17–20 chữ số) hoặc mention dạng <@ID>. Đang hiện contribution của mọi tác giả.";

type StatusFilter = ContributionListQuery["status"];

const STATUS_OPTIONS: readonly { value: StatusFilter; label: string }[] = [
	{ value: "active", label: "Còn hiệu lực" },
	{ value: "removed", label: "Đã gỡ" },
	{ value: "all", label: "Tất cả" },
];

/** Trạng thái lọc từ `?tt=`; giá trị khác (kể cả thiếu) là "active". */
function statusFilter(query: URLSearchParams): StatusFilter
{
	const text = query.get(STATUS_PARAM);
	return STATUS_OPTIONS.find(option => option.value === text)?.value ?? "active";
}

function requireContributionId(raw: string | null | undefined): number
{
	const id = parsePositiveId(raw);
	if (id === null) throw new UserError(INVALID_CONTRIBUTION_ID);
	return id;
}

function viewPath(id: number): string
{
	return `${VIEW_PATH}?id=${id}`;
}

/** Link chỉ được đặt vào href khi là http/https (cùng quy tắc với ContributionService khi gửi); còn lại null. */
function safeLink(link: string | null): string | null
{
	if (link === null) return null;
	try
	{
		const { protocol } = new URL(link);
		return protocol === "http:" || protocol === "https:" ? link : null;
	}
	catch
	{
		return null;
	}
}

function isHidden(contribution: Contribution, hidden: ReadonlySet<string>): boolean
{
	return contribution.channelId !== null && hidden.has(contribution.channelId);
}

function statusBadge(contribution: Contribution): RawHtml
{
	return contribution.status === "active" ? html`<span class="badge ok">Còn hiệu lực</span>` : html`<span class="badge off">Đã gỡ</span>`;
}

const NONE = html`<span class="muted">—</span>`;
const NOTHING_HIDDEN: ReadonlySet<string> = new Set();

/** Tên kênh gốc; kênh người đăng nhập không xem được (kể cả thread riêng tư) luôn hiện PRIVATE_CHANNEL_LABEL. */
function channelCell(ctx: GuildPageContext, channelId: string | null, hidden: ReadonlySet<string>): HtmlValue
{
	if (channelId === null) return NONE;
	return hidden.has(channelId) ? PRIVATE_CHANNEL_LABEL : channelLabel(ctx.guild, channelId, ctx.member);
}

// ---------- Danh sách ----------

function listRow(ctx: GuildPageContext, item: Contribution, hidden: ReadonlySet<string>, displays: ReadonlyMap<string, MemberDisplay>): RawHtml
{
	const secret = isHidden(item, hidden);
	return html`<tr>
<td><a href="${guildUrl(ctx, viewPath(item.id))}">#${item.id}</a></td>
<td class="ct-title">${secret ? html`<span class="muted">${HIDDEN_ITEM_TEXT}</span>` : item.title}</td>
<td>${secret ? NONE : categoryLabel(item.category)}</td>
<td>${memberLink(ctx, item.authorId, displays.get(item.authorId))}</td>
<td class="num">${formatNumber(item.votes)}</td>
<td>${channelCell(ctx, item.channelId, hidden)}</td>
<td class="ct-time">${formatDateTime(item.createdAt)}</td>
<td>${statusBadge(item)}</td>
</tr>`;
}

async function renderList(ctx: GuildPageContext): Promise<WebResponse>
{
	const { query } = ctx.req;
	const { client, services, adminActions } = ctx.deps;
	const status = statusFilter(query);
	const authorInput = query.get(AUTHOR_PARAM)?.trim() ?? "";
	const authorId = authorInput === "" ? null : parseUserId(authorInput);
	const invalidAuthor = authorInput !== "" && authorId === null;

	const result = services.contributions.listPage(ctx.guild.id, {
		authorId: authorId ?? undefined,
		status,
		page: queryPage(query),
		pageSize: CONTRIBUTION_PAGE_SIZE,
	});
	const { items } = result;
	const hidden = await hiddenChannelIds(client, ctx.guild, items.map(item => item.channelId), ctx.member);
	const userIds = [...new Set([...items.map(item => item.authorId), ...(authorId === null ? [] : [authorId])])];
	const displays = await adminActions.displays(client, ctx.guild, userIds);

	const statusOptions = STATUS_OPTIONS.map(option => html`<option value="${option.value}"${option.value === status ? html` selected` : ""}>${option.label}</option>`);
	const filtered = status !== "active" || authorInput !== "";
	const filters = html`<form method="get" action="${guildUrl(ctx, PATH)}" class="filters">
<div class="field"><label for="ct-status">Trạng thái</label><select id="ct-status" name="${STATUS_PARAM}">${statusOptions}</select></div>
<div class="field"><label for="ct-author">Tác giả</label><input type="text" id="ct-author" name="${AUTHOR_PARAM}" value="${authorInput}" placeholder="User ID hoặc <@ID>"></div>
<button class="btn btn-primary" type="submit">Lọc</button>${filtered ? html` <a class="btn" href="${guildUrl(ctx, PATH)}">Bỏ lọc</a>` : ""}
</form>${invalidAuthor ? html`<div class="warn-box">${INVALID_AUTHOR}</div>` : ""}`;

	const owner = authorId === null ? "" : html` của ${memberLink(ctx, authorId, displays.get(authorId))}`;
	const summary = html`<p class="ct-summary">${formatNumber(result.total)} contribution${owner}.</p>`;
	const table = items.length === 0
		? html`<p class="muted">${filtered ? "Không có contribution nào khớp bộ lọc." : "Chưa có contribution nào."}</p>`
		: html`<table class="table">
<thead><tr><th>Mã</th><th>Tiêu đề</th><th>Loại</th><th>Tác giả</th><th class="num">Lượt ghi nhận</th><th>Kênh</th><th>Thời gian</th><th>Trạng thái</th></tr></thead>
<tbody>${items.map(item => listRow(ctx, item, hidden, displays))}</tbody>
</table>`;
	const pagerParams = { [STATUS_PARAM]: status, [AUTHOR_PARAM]: authorId ?? "" };

	return renderPage(ctx, {
		nav: "contributions",
		title: "Contribution",
		lead: "Đóng góp thành viên gửi bằng /contribution submit hoặc ghi nhận từ tin nhắn. Mở từng contribution để xem chi tiết hoặc gỡ.",
		body: html`<section class="card">${filters}${summary}${table}${pager(ctx, PATH, pagerParams, result.page, result.totalPages)}</section>`,
	});
}

// ---------- Chi tiết ----------

function removeForm(ctx: GuildPageContext, contribution: Contribution): RawHtml
{
	return html`<section class="card danger-zone"><h2>Gỡ contribution</h2>
<p>Gỡ sẽ huỷ toàn bộ điểm của contribution này (điểm tác giả nhận từ mọi lượt ghi nhận). Message trong Discord chuyển sang "Đã bị gỡ"
và không ghi nhận thêm được. Không hoàn tác được. Giống lệnh <code>/admin contribution remove</code>.</p>
<form method="post" action="${guildUrl(ctx, REMOVE_PATH)}">${csrfField(ctx)}<input type="hidden" name="id" value="${contribution.id}">
<label class="check"><input type="checkbox" name="${CONFIRM_FIELD}" value="1" required> Tôi hiểu: gỡ contribution #${contribution.id} và huỷ toàn bộ điểm của nó</label>
<div class="actions"><button class="btn btn-danger" type="submit">Gỡ contribution</button></div>
</form></section>`;
}

function visibleDetail(ctx: GuildPageContext, contribution: Contribution, displays: ReadonlyMap<string, MemberDisplay>): RawHtml
{
	const link = safeLink(contribution.link);
	const messageUrl = contributionMessageUrl(contribution);
	const { authorId, submittedBy } = contribution;
	const meta = metaList("ct-meta", [
		["Trạng thái", statusBadge(contribution)],
		["Loại", categoryLabel(contribution.category)],
		["Tác giả", memberLink(ctx, authorId, displays.get(authorId))],
		submittedBy === authorId ? null : ["Người ghi nhận", memberLink(ctx, submittedBy, displays.get(submittedBy))],
		["Lượt ghi nhận", formatNumber(contribution.votes)],
		["Kênh", channelCell(ctx, contribution.channelId, NOTHING_HIDDEN)],
		["Thời gian", formatDateTime(contribution.createdAt)],
		link === null ? null : ["Link", html`<a href="${link}" rel="noopener noreferrer nofollow" target="_blank">${link}</a>`],
		messageUrl === null ? null : ["Trong Discord", html`<a href="${messageUrl}" rel="noopener noreferrer" target="_blank">Mở message của contribution</a>`],
	]);
	return html`<section class="card"><h2 class="ct-title">#${contribution.id} · ${contribution.title}</h2>
${meta}
<h3>Mô tả</h3><p class="ct-desc">${contribution.description}</p></section>`;
}

function hiddenDetail(ctx: GuildPageContext, contribution: Contribution, displays: ReadonlyMap<string, MemberDisplay>): RawHtml
{
	const { authorId } = contribution;
	const meta = metaList("ct-meta", [
		["Trạng thái", statusBadge(contribution)],
		["Tác giả", memberLink(ctx, authorId, displays.get(authorId))],
		["Lượt ghi nhận", formatNumber(contribution.votes)],
		["Thời gian", formatDateTime(contribution.createdAt)],
	]);
	return html`<section class="card"><h2>#${contribution.id}</h2>
<div class="warn-box">${HIDDEN_ITEM_TEXT}: tiêu đề, mô tả, link và kênh của contribution này được ẩn. Bạn vẫn gỡ được contribution
(như lệnh <code>/admin contribution remove</code>).</div>
${meta}</section>`;
}

async function renderDetail(ctx: GuildPageContext): Promise<WebResponse>
{
	const id = requireContributionId(ctx.req.query.get("id"));
	const { client, services, adminActions } = ctx.deps;
	const contribution = services.contributions.get(ctx.guild.id, id);
	if (!contribution) throw new UserError(`Không tìm thấy contribution #${id}.`);

	const visible = await canViewItemChannel(client, ctx.guild, contribution.channelId, ctx.member);
	const displays = await adminActions.displays(client, ctx.guild, [...new Set([contribution.authorId, contribution.submittedBy])]);
	const detail = visible ? visibleDetail(ctx, contribution, displays) : hiddenDetail(ctx, contribution, displays);

	return renderPage(ctx, {
		nav: "contributions",
		title: `Contribution #${id}`,
		body: html`<p><a href="${guildUrl(ctx, PATH)}">← Danh sách contribution</a></p>
${detail}
${contribution.status === "active" ? removeForm(ctx, contribution) : html`<p class="muted">Contribution này đã bị gỡ: toàn bộ điểm của nó đã bị huỷ.</p>`}`,
	});
}

// ---------- Gỡ ----------

/**
 * Gỡ như `/admin contribution remove` (không kiểm tra kênh). Thông báo của removeContribution có tiêu đề; contribution trong kênh
 * người đăng nhập không xem được thì thông báo bỏ tiêu đề, như trang chi tiết đã giấu.
 */
async function remove(ctx: GuildPageContext): Promise<WebResponse>
{
	const form = ctx.req.form ?? new URLSearchParams();
	const id = requireContributionId(form.get("id"));
	if (form.get(CONFIRM_FIELD) !== "1") throw new UserError(REMOVE_CONFIRM_REQUIRED);

	const { client, services, adminActions } = ctx.deps;
	const { text, removed } = removeContribution(services, ctx.guild.id, id, ctx.actorId);
	const refreshed = await adminActions.refreshContribution(client, removed);
	const visible = await canViewItemChannel(client, ctx.guild, removed.channelId, ctx.member);
	const result = visible ? text : `Đã gỡ contribution #${removed.id} của ${userMention(removed.authorId)}. Toàn bộ điểm của contribution này đã bị huỷ.`;
	return redirectWithFlash(ctx, viewPath(id), "ok", withMessageEditNote(result, refreshed, removed.messageId));
}

/** Lỗi khi gỡ quay về trang chi tiết nếu contribution có thật; mã sai hoặc không có thì ném để server về danh sách. */
function removeErrorRedirect(ctx: GuildPageContext): string
{
	const id = requireContributionId(ctx.req.form?.get("id"));
	if (!ctx.deps.services.contributions.get(ctx.guild.id, id)) throw new UserError(`Không tìm thấy contribution #${id}.`);
	return viewPath(id);
}

export const contributionsPage: PageModule = {
	routes: [
		{ method: "GET", path: PATH, handler: renderList },
		{ method: "GET", path: VIEW_PATH, handler: renderDetail },
		{ method: "POST", path: REMOVE_PATH, handler: remove, errorRedirect: removeErrorRedirect },
	],
	css: `
.ct-title { overflow-wrap: anywhere; }
.ct-time { white-space: nowrap; }
.ct-summary { margin: 0 0 10px; color: var(--muted); }
.ct-meta { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 18px; margin: 0; }
.ct-meta dt { color: var(--muted); font-weight: 600; }
.ct-meta dd { margin: 0; overflow-wrap: anywhere; }
.ct-desc { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
`,
};
