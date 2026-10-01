// Trang "Contribution" của web quản trị (DEC-041, DEC-051): danh sách contribution (kể cả đã gỡ) lọc theo trạng thái gỡ và trạng
// thái duyệt, có phân trang; trang chi tiết với lượt 👍/👎 kèm người bấm và lý do; duyệt, từ chối và gỡ contribution. Tương đương
// `/contribution view|list`, nút ✅ Duyệt / ❌ Từ chối trên thẻ và `/admin contribution remove`: duyệt và từ chối đi qua
// approveContribution/rejectContribution (contributionOps), gỡ đi qua removeContribution (adminOps), dùng chung với Discord rồi
// sửa thẻ công khai. Không có form tạo contribution: bài do thành viên gửi trong Discord.
// Mục nằm trong kênh mà người đăng nhập không xem được thì giấu tiêu đề, mô tả, link, kênh, lý do từ chối và lý do 👎 (lệnh
// Discord báo "không tìm thấy"), nhưng vẫn duyệt, từ chối và gỡ được: admin chịu trách nhiệm về contribution của cả server, như
// `/admin contribution remove` không kiểm tra kênh.
import { removeContribution } from "../../discord/adminOps";
import { approveContribution, rejectContribution, repostContribution, ReviewOutcome } from "../../discord/contributionOps";
import { formatNumber, userMention } from "../../discord/format";
import { MemberDisplay } from "../../discord/memberDirectory";
import { categoryLabel, contributionMessageUrl } from "../../discord/views/contribution";
import {
	Contribution,
	CONTRIBUTION_LIMITS,
	ContributionListQuery,
	ContributionReviewState,
	ContributionServiceApi,
	ContributionVoter,
} from "../../modules/contribution/types";
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
const APPROVE_PATH = `${PATH}/approve`;
const REJECT_PATH = `${PATH}/reject`;
const REPOST_PATH = `${PATH}/repost`;
/** Số contribution mỗi trang của danh sách. */
export const CONTRIBUTION_PAGE_SIZE = 20;
const STATUS_PARAM = "tt";
const REVIEW_PARAM = "dd";
const AUTHOR_PARAM = "u";
const CONFIRM_FIELD = "xac-nhan";
/** Tên ô lý do từ chối của form Từ chối. */
export const REJECT_REASON_FIELD = "ly-do";

export const INVALID_CONTRIBUTION_ID = "Mã contribution không hợp lệ.";
export const REMOVE_CONFIRM_REQUIRED = "Hãy tick ô xác nhận trước khi gỡ.";
/** Thay cho lý do (từ chối, 👎) của contribution nằm trong kênh người đăng nhập không xem được. */
export const HIDDEN_REASON_TEXT = "🔒 Ẩn (contribution nằm trong kênh bạn không xem được)";
const INVALID_AUTHOR = "Tác giả phải là Discord user ID (17–20 chữ số) hoặc mention dạng <@ID>. Đang hiện contribution của mọi tác giả.";

type StatusFilter = ContributionListQuery["status"];
type ReviewFilter = ContributionReviewState | "all";

const STATUS_OPTIONS: readonly { value: StatusFilter; label: string }[] = [
	{ value: "active", label: "Còn hiệu lực" },
	{ value: "removed", label: "Đã gỡ" },
	{ value: "all", label: "Tất cả" },
];

const REVIEW_OPTIONS: readonly { value: ReviewFilter; label: string }[] = [
	{ value: "all", label: "Tất cả" },
	{ value: "pending", label: "Chờ duyệt" },
	{ value: "approved", label: "Đã duyệt" },
	{ value: "rejected", label: "Bị từ chối" },
];

/** Trạng thái lọc từ `?tt=`; giá trị khác (kể cả thiếu) là "active". */
function statusFilter(query: URLSearchParams): StatusFilter
{
	const text = query.get(STATUS_PARAM);
	return STATUS_OPTIONS.find(option => option.value === text)?.value ?? "active";
}

/** Trạng thái duyệt lọc từ `?dd=`; giá trị khác (kể cả thiếu) là "all". */
function reviewFilter(query: URLSearchParams): ReviewFilter
{
	const text = query.get(REVIEW_PARAM);
	return REVIEW_OPTIONS.find(option => option.value === text)?.value ?? "all";
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

/** Đường dẫn danh sách contribution đang chờ duyệt (còn hiệu lực), dùng cho lối vào nhanh ở trang này và trang Tổng quan. */
export const PENDING_LIST_PATH = `${PATH}?${STATUS_PARAM}=active&${REVIEW_PARAM}=pending`;

/** Số contribution còn hiệu lực đang chờ duyệt của guild (DEC-051). */
export function pendingContributionCount(contributions: Pick<ContributionServiceApi, "listPage">, guildId: string): number
{
	return contributions.listPage(guildId, { status: "active", review: "pending", page: 1, pageSize: 1 }).total;
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

const REVIEW_BADGES: Readonly<Record<ContributionReviewState, RawHtml>> = {
	pending: html`<span class="badge warn">⏳ Chờ duyệt</span>`,
	approved: html`<span class="badge ok">✅ Đã duyệt</span>`,
	rejected: html`<span class="badge off">❌ Bị từ chối</span>`,
};
const REMOVED_BADGE = html`<span class="badge off">Đã gỡ</span>`;

/**
 * Badge trạng thái của contribution: trạng thái duyệt (DEC-051), thêm "Đã gỡ" nếu admin đã gỡ. Contribution bị gỡ khi đang chờ
 * duyệt chỉ hiện "Đã gỡ" (không duyệt được nữa). Trang hồ sơ thành viên dùng lại.
 */
export function contributionBadges(contribution: Contribution): RawHtml
{
	if (contribution.status === "active") return REVIEW_BADGES[contribution.reviewState];
	return contribution.reviewState === "pending" ? REMOVED_BADGE : html`${REMOVED_BADGE} ${REVIEW_BADGES[contribution.reviewState]}`;
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
<td class="num">${formatNumber(item.downvotes)}</td>
<td class="num">${formatNumber(item.score)}</td>
<td>${channelCell(ctx, item.channelId, hidden)}</td>
<td class="ct-time">${formatDateTime(item.createdAt)}</td>
<td class="ct-state">${contributionBadges(item)}</td>
</tr>`;
}

function options<T extends string>(list: readonly { value: T; label: string }[], current: T): RawHtml[]
{
	return list.map(option => html`<option value="${option.value}"${option.value === current ? html` selected` : ""}>${option.label}</option>`);
}

async function renderList(ctx: GuildPageContext): Promise<WebResponse>
{
	const { query } = ctx.req;
	const { client, services, adminActions } = ctx.deps;
	const status = statusFilter(query);
	const review = reviewFilter(query);
	const authorInput = query.get(AUTHOR_PARAM)?.trim() ?? "";
	const authorId = authorInput === "" ? null : parseUserId(authorInput);
	const invalidAuthor = authorInput !== "" && authorId === null;

	const result = services.contributions.listPage(ctx.guild.id, {
		authorId: authorId ?? undefined,
		status,
		review,
		page: queryPage(query),
		pageSize: CONTRIBUTION_PAGE_SIZE,
	});
	const { items } = result;
	const pending = pendingContributionCount(services.contributions, ctx.guild.id);
	const hidden = await hiddenChannelIds(client, ctx.guild, items.map(item => item.channelId), ctx.member);
	const userIds = [...new Set([...items.map(item => item.authorId), ...(authorId === null ? [] : [authorId])])];
	const displays = await adminActions.displays(client, ctx.guild, userIds);

	const pendingView = status === "active" && review === "pending" && authorInput === "";
	const quick = html`<p class="ct-quick"><a class="btn${pending > 0 ? " btn-primary" : ""}" href="${guildUrl(ctx, PENDING_LIST_PATH)}"${pendingView ? html` aria-current="page"` : ""}>⏳ Chờ duyệt (${formatNumber(pending)})</a></p>`;
	const filtered = status !== "active" || review !== "all" || authorInput !== "";
	const filters = html`<form method="get" action="${guildUrl(ctx, PATH)}" class="filters">
<div class="field"><label for="ct-review">Duyệt</label><select id="ct-review" name="${REVIEW_PARAM}">${options(REVIEW_OPTIONS, review)}</select></div>
<div class="field"><label for="ct-status">Trạng thái</label><select id="ct-status" name="${STATUS_PARAM}">${options(STATUS_OPTIONS, status)}</select></div>
<div class="field"><label for="ct-author">Tác giả</label><input type="text" id="ct-author" name="${AUTHOR_PARAM}" value="${authorInput}" placeholder="User ID hoặc <@ID>"></div>
<button class="btn btn-primary" type="submit">Lọc</button>${filtered ? html` <a class="btn" href="${guildUrl(ctx, PATH)}">Bỏ lọc</a>` : ""}
</form>${invalidAuthor ? html`<div class="warn-box">${INVALID_AUTHOR}</div>` : ""}`;

	const owner = authorId === null ? "" : html` của ${memberLink(ctx, authorId, displays.get(authorId))}`;
	const summary = html`<p class="ct-summary">${formatNumber(result.total)} contribution${owner}.</p>`;
	const table = items.length === 0
		? html`<p class="muted">${filtered ? "Không có contribution nào khớp bộ lọc." : "Chưa có contribution nào."}</p>`
		: html`<div class="ct-scroll"><table class="table">
<thead><tr><th>Mã</th><th>Tiêu đề</th><th>Loại</th><th>Tác giả</th><th class="num" title="Lượt ghi nhận">👍</th><th class="num" title="Lượt không ghi nhận">👎</th><th class="num">Điểm</th><th>Kênh</th><th>Thời gian</th><th>Trạng thái</th></tr></thead>
<tbody>${items.map(item => listRow(ctx, item, hidden, displays))}</tbody>
</table></div>`;
	const pagerParams = { [STATUS_PARAM]: status, [REVIEW_PARAM]: review === "all" ? "" : review, [AUTHOR_PARAM]: authorId ?? "" };

	return renderPage(ctx, {
		nav: "contributions",
		title: "Contribution",
		lead: "Đóng góp thành viên gửi bằng /contribution submit hoặc ghi nhận từ tin nhắn. Contribution mới chờ duyệt rồi mới mở 👍/👎; mở từng contribution để duyệt, từ chối, xem lượt bấm hoặc gỡ.",
		body: html`<section class="card">${quick}${filters}${summary}${table}${pager(ctx, PATH, pagerParams, result.page, result.totalPages)}</section>`,
	});
}

// ---------- Chi tiết ----------

export const REPOST_HIDDEN = "Bạn không xem được kênh của thẻ contribution này nên không đăng lại được.";

/** Thẻ đăng lại được: chưa có thẻ, hoặc thẻ đang ở đúng kênh contribution hiện tại (như contributionOps.repostContribution). */
function canRepost(ctx: GuildPageContext, contribution: Contribution): boolean
{
	return contribution.channelId === null || contribution.channelId === ctx.deps.services.guildConfig.getSettings(ctx.guild.id).contributionChannelId;
}

/** Form đăng lại thẻ (contribution còn hiệu lực, chờ duyệt hoặc đã duyệt): khi thẻ đăng lỗi lúc gửi hoặc bị xoá tay. */
function repostForm(ctx: GuildPageContext, contribution: Contribution): RawHtml
{
	const missing = contribution.messageId === null
		? html`<div class="warn-box">Contribution này chưa có thẻ trong Discord (bot đăng lỗi lúc gửi), nên chưa ai bấm duyệt hay 👍/👎 được trên Discord.</div>`
		: "";
	return html`<section class="card"><h2>📮 Đăng lại thẻ</h2>
${missing}<p>Bot đăng lại thẻ của contribution này vào kênh contribution đang chọn, theo trạng thái hiện tại, và xoá thẻ cũ nếu còn. Dùng khi thẻ bị xoá
hoặc đăng lỗi. Không đổi điểm hay lượt bấm.</p>
<form method="post" action="${guildUrl(ctx, REPOST_PATH)}">${csrfField(ctx)}<input type="hidden" name="id" value="${contribution.id}">
<div class="actions"><button class="btn" type="submit">📮 Đăng lại thẻ #${contribution.id}</button></div>
</form></section>`;
}

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

/** Form Duyệt và Từ chối cho contribution còn hiệu lực đang chờ duyệt (như nút ✅ Duyệt / ❌ Từ chối trên thẻ, DEC-051). */
function reviewForms(ctx: GuildPageContext, contribution: Contribution, visible: boolean): RawHtml
{
	const { rejectReasonMin, rejectReasonMax } = CONTRIBUTION_LIMITS;
	const hiddenNote = visible
		? ""
		: html`<div class="warn-box">Bạn không xem được nội dung contribution này. Bạn vẫn duyệt hoặc từ chối được (admin chịu trách nhiệm cho cả server), nhưng nên hỏi người xem được kênh trước.</div>`;
	return html`<section class="card ct-review"><h2>⏳ Duyệt contribution</h2>
<p>Contribution đang chờ duyệt: chưa ai bấm 👍/👎 được. <strong>Duyệt</strong> thì thẻ trong kênh mở nút 👍 Ghi nhận / 👎 Không ghi nhận.
<strong>Từ chối</strong> thì thẻ đổi thành "Không được duyệt" và contribution không tính điểm (tác giả gửi lại được dưới dạng contribution mới).
Bot nhắn riêng kết quả cho tác giả (và người ghi nhận nếu khác). Giống nút ✅ Duyệt / ❌ Từ chối trên thẻ.</p>
${hiddenNote}
<form method="post" action="${guildUrl(ctx, APPROVE_PATH)}" class="ct-approve">${csrfField(ctx)}<input type="hidden" name="id" value="${contribution.id}">
<button class="btn btn-primary" type="submit">✅ Duyệt contribution #${contribution.id}</button>
</form>
<form method="post" action="${guildUrl(ctx, REJECT_PATH)}" class="ct-reject">${csrfField(ctx)}<input type="hidden" name="id" value="${contribution.id}">
<div class="field"><label for="ct-reason">Lý do từ chối</label>
<textarea id="ct-reason" name="${REJECT_REASON_FIELD}" rows="3" minlength="${rejectReasonMin}" maxlength="${rejectReasonMax}" required></textarea>
<span class="hint">Bắt buộc, từ ${rejectReasonMin} đến ${rejectReasonMax} ký tự. Lý do không hiện công khai trên thẻ: bot chỉ gửi riêng cho tác giả, và admin xem được ở trang này.</span></div>
<div class="actions"><button class="btn btn-danger" type="submit">❌ Từ chối</button></div>
</form></section>`;
}

/** Các dòng về việc duyệt (người duyệt, lúc duyệt, lý do từ chối) của trang chi tiết; rỗng khi đang chờ duyệt. */
function reviewRows(ctx: GuildPageContext, contribution: Contribution, displays: ReadonlyMap<string, MemberDisplay>, visible: boolean): (readonly [string, HtmlValue] | null)[]
{
	const { reviewState, reviewedBy, reviewedAt, reviewReason } = contribution;
	if (reviewState === "pending") return [];
	if (reviewedBy === null) return [["Duyệt", html`<span class="muted">Contribution có từ trước khi có bước duyệt: coi như đã duyệt.</span>`]];
	const rejected = reviewState === "rejected";
	return [
		[rejected ? "Người từ chối" : "Người duyệt", memberLink(ctx, reviewedBy, displays.get(reviewedBy))],
		reviewedAt === null ? null : [rejected ? "Lúc từ chối" : "Lúc duyệt", formatDateTime(reviewedAt)],
		rejected ? ["Lý do từ chối", visible ? html`<span class="ct-reason">${reviewReason ?? ""}</span>` : html`<span class="muted">${HIDDEN_REASON_TEXT}</span>`] : null,
	];
}

function countRows(contribution: Contribution): (readonly [string, HtmlValue])[]
{
	return [
		["👍 Lượt ghi nhận", formatNumber(contribution.votes)],
		["👎 Lượt không ghi nhận", formatNumber(contribution.downvotes)],
		["Điểm của contribution", formatNumber(contribution.score)],
	];
}

function visibleDetail(ctx: GuildPageContext, contribution: Contribution, displays: ReadonlyMap<string, MemberDisplay>): RawHtml
{
	const link = safeLink(contribution.link);
	const messageUrl = contributionMessageUrl(contribution);
	const { authorId, submittedBy } = contribution;
	const meta = metaList("ct-meta", [
		["Trạng thái", contributionBadges(contribution)],
		["Loại", categoryLabel(contribution.category)],
		["Tác giả", memberLink(ctx, authorId, displays.get(authorId))],
		submittedBy === authorId ? null : ["Người ghi nhận", memberLink(ctx, submittedBy, displays.get(submittedBy))],
		...countRows(contribution),
		["Kênh", channelCell(ctx, contribution.channelId, NOTHING_HIDDEN)],
		["Thời gian", formatDateTime(contribution.createdAt)],
		...reviewRows(ctx, contribution, displays, true),
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
		["Trạng thái", contributionBadges(contribution)],
		["Tác giả", memberLink(ctx, authorId, displays.get(authorId))],
		...countRows(contribution),
		["Thời gian", formatDateTime(contribution.createdAt)],
		...reviewRows(ctx, contribution, displays, false),
	]);
	return html`<section class="card"><h2>#${contribution.id}</h2>
<div class="warn-box">${HIDDEN_ITEM_TEXT}: tiêu đề, mô tả, link, kênh, lý do từ chối và lý do 👎 của contribution này được ẩn. Bạn vẫn
duyệt, từ chối hoặc gỡ được contribution (như lệnh <code>/admin contribution remove</code>).</div>
${meta}</section>`;
}

const VOTE_KIND_LABELS = { up: "👍 Ghi nhận", down: "👎 Không ghi nhận" } as const;

function voterState(voter: ContributionVoter): RawHtml
{
	if (!voter.active) return html`<span class="badge off">Đã huỷ</span>`;
	return voter.locked ? html`<span class="badge ok">Còn hiệu lực</span> <span class="badge warn">🔒 Bị khoá</span>` : html`<span class="badge ok">Còn hiệu lực</span>`;
}

function voterRow(ctx: GuildPageContext, voter: ContributionVoter, displays: ReadonlyMap<string, MemberDisplay>, visible: boolean): RawHtml
{
	let reason: HtmlValue = NONE;
	if (voter.kind === "down") reason = visible ? html`<span class="ct-reason">${voter.reason ?? ""}</span>` : html`<span class="muted">${HIDDEN_REASON_TEXT}</span>`;
	return html`<tr>
<td>${memberLink(ctx, voter.userId, displays.get(voter.userId))}</td>
<td class="ct-kind">${VOTE_KIND_LABELS[voter.kind]}</td>
<td>${reason}</td>
<td class="ct-state">${voterState(voter)}</td>
<td class="ct-time">${formatDateTime(voter.createdAt)}</td>
</tr>`;
}

/**
 * Bảng lượt 👍/👎 kèm người bấm (DEC-051: chỉ admin trên web và người duyệt bằng `/contribution view` xem được; công khai chỉ hiện
 * số lượng). Contribution chờ duyệt hoặc bị từ chối không có lượt nào nên không hiện bảng.
 */
function votersSection(ctx: GuildPageContext, contribution: Contribution, voters: readonly ContributionVoter[], displays: ReadonlyMap<string, MemberDisplay>, visible: boolean): RawHtml | null
{
	if (contribution.reviewState !== "approved" && voters.length === 0) return null;
	const content = voters.length === 0
		? html`<p class="muted">Chưa có ai bấm 👍 hay 👎.</p>`
		: html`<div class="ct-scroll"><table class="table ct-voters">
<thead><tr><th>Người bấm</th><th>Lượt</th><th>Lý do</th><th>Trạng thái</th><th>Thời gian</th></tr></thead>
<tbody>${voters.map(voter => voterRow(ctx, voter, displays, visible))}</tbody>
</table></div>`;
	return html`<section class="card"><h2>👍/👎 Lượt bấm: ${formatNumber(voters.length)}</h2>
<p class="muted ct-hint">Công khai chỉ hiện số lượng; danh sách người bấm và lý do 👎 chỉ admin (trang này) và người duyệt (lệnh <code>/contribution view</code>) xem được.
"Đã huỷ": điểm của lượt đã bị admin reset hoặc gỡ. "Bị khoá": người bấm không đổi hay rút lượt được nữa (lượt đã huỷ cũng vậy).</p>
${content}</section>`;
}

async function renderDetail(ctx: GuildPageContext): Promise<WebResponse>
{
	const id = requireContributionId(ctx.req.query.get("id"));
	const { client, services, adminActions } = ctx.deps;
	const contribution = services.contributions.get(ctx.guild.id, id);
	if (!contribution) throw new UserError(`Không tìm thấy contribution #${id}.`);

	const voters = services.contributions.listVoters(ctx.guild.id, id);
	const visible = await canViewItemChannel(client, ctx.guild, contribution.channelId, ctx.member);
	const people = [contribution.authorId, contribution.submittedBy, ...(contribution.reviewedBy === null ? [] : [contribution.reviewedBy]), ...voters.map(voter => voter.userId)];
	const displays = await adminActions.displays(client, ctx.guild, [...new Set(people)]);
	const detail = visible ? visibleDetail(ctx, contribution, displays) : hiddenDetail(ctx, contribution, displays);
	const active = contribution.status === "active";

	return renderPage(ctx, {
		nav: "contributions",
		title: `Contribution #${id}`,
		body: html`<p><a href="${guildUrl(ctx, PATH)}">← Danh sách contribution</a></p>
${detail}
${active && contribution.reviewState === "pending" ? reviewForms(ctx, contribution, visible) : ""}
${votersSection(ctx, contribution, voters, displays, visible)}
${active && contribution.reviewState !== "rejected" && visible && canRepost(ctx, contribution) ? repostForm(ctx, contribution) : ""}
${active ? removeForm(ctx, contribution) : html`<p class="muted">Contribution này đã bị gỡ: toàn bộ điểm của nó đã bị huỷ.</p>`}`,
	});
}

// ---------- Duyệt, từ chối ----------

/**
 * Thông báo sau khi duyệt hoặc từ chối: nguyên văn ReviewOutcome.text (contributionOps). Contribution trong kênh người đăng nhập
 * không xem được thì thay dòng đầu (có tiêu đề) bằng câu không có tiêu đề, giữ các dòng cảnh báo sau đó.
 */
async function reviewFlash(ctx: GuildPageContext, outcome: ReviewOutcome): Promise<string>
{
	const { contribution } = outcome;
	if (await canViewItemChannel(ctx.deps.client, ctx.guild, contribution.channelId, ctx.member)) return outcome.text;
	const head = contribution.reviewState === "approved"
		? `✅ Đã duyệt contribution #${contribution.id} của ${userMention(contribution.authorId)}.`
		: `❌ Đã từ chối contribution #${contribution.id} của ${userMention(contribution.authorId)}. Lý do chỉ gửi riêng cho tác giả, không hiện trên thẻ.`;
	return [head, ...outcome.text.split("\n").slice(1)].join("\n");
}

async function approve(ctx: GuildPageContext): Promise<WebResponse>
{
	const id = requireContributionId(ctx.req.form?.get("id"));
	const { client, services, adminActions } = ctx.deps;
	const outcome = await approveContribution(client, services, adminActions, ctx.guild.id, id, ctx.actorId);
	return redirectWithFlash(ctx, viewPath(id), "ok", await reviewFlash(ctx, outcome));
}

/** Từ chối với lý do trong form; độ dài lý do do ContributionService kiểm tra (UserError quay về trang chi tiết). */
async function reject(ctx: GuildPageContext): Promise<WebResponse>
{
	const form = ctx.req.form ?? new URLSearchParams();
	const id = requireContributionId(form.get("id"));
	const reason = form.get(REJECT_REASON_FIELD) ?? "";
	const { client, services, adminActions } = ctx.deps;
	const outcome = await rejectContribution(client, services, adminActions, ctx.guild.id, id, ctx.actorId, reason);
	return redirectWithFlash(ctx, viewPath(id), "ok", await reviewFlash(ctx, outcome));
}

/**
 * Đăng lại thẻ qua contributionOps.repostContribution (kiểm tra kênh và quyền bot ở tầng Discord). Admin không xem được kênh của thẻ
 * thì không được đăng lại (trang chi tiết đang giấu nội dung đó).
 */
async function repost(ctx: GuildPageContext): Promise<WebResponse>
{
	const id = requireContributionId(ctx.req.form?.get("id"));
	const { client, services, adminActions } = ctx.deps;
	const contribution = services.contributions.get(ctx.guild.id, id);
	if (contribution && !(await canViewItemChannel(client, ctx.guild, contribution.channelId, ctx.member))) throw new UserError(REPOST_HIDDEN);
	const text = await repostContribution(client, services, adminActions, ctx.guild.id, id);
	return redirectWithFlash(ctx, viewPath(id), "ok", text);
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

/** Lỗi khi duyệt, từ chối hoặc gỡ quay về trang chi tiết nếu contribution có thật; mã sai hoặc không có thì ném để server về danh sách. */
function detailErrorRedirect(ctx: GuildPageContext): string
{
	const id = requireContributionId(ctx.req.form?.get("id"));
	if (!ctx.deps.services.contributions.get(ctx.guild.id, id)) throw new UserError(`Không tìm thấy contribution #${id}.`);
	return viewPath(id);
}

export const contributionsPage: PageModule = {
	routes: [
		{ method: "GET", path: PATH, handler: renderList },
		{ method: "GET", path: VIEW_PATH, handler: renderDetail },
		{ method: "POST", path: APPROVE_PATH, handler: approve, errorRedirect: detailErrorRedirect },
		{ method: "POST", path: REJECT_PATH, handler: reject, errorRedirect: detailErrorRedirect },
		{ method: "POST", path: REPOST_PATH, handler: repost, errorRedirect: detailErrorRedirect },
		{ method: "POST", path: REMOVE_PATH, handler: remove, errorRedirect: detailErrorRedirect },
	],
	css: `
.ct-title { overflow-wrap: anywhere; }
.ct-time { white-space: nowrap; }
.ct-state { white-space: nowrap; }
.ct-kind { white-space: nowrap; }
.ct-scroll { overflow-x: auto; }
.ct-quick { margin: 0 0 12px; }
.ct-summary { margin: 0 0 10px; color: var(--muted); }
.ct-hint { font-size: 13px; margin: 0 0 10px; }
.ct-meta { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 18px; margin: 0; }
.ct-meta dt { color: var(--muted); font-weight: 600; }
.ct-meta dd { margin: 0; overflow-wrap: anywhere; }
.ct-desc { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
.ct-reason { white-space: pre-wrap; overflow-wrap: anywhere; }
.ct-approve { margin: 0 0 16px; }
.ct-reject textarea { max-width: 560px; }
`,
};
