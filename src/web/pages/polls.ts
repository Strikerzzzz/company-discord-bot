// Trang "Vote" của web quản trị (DEC-041): lịch sử vote có tab mở/đóng và phân trang, kết quả từng vote, đóng vote. Tương đương
// `/poll list|results|close`; tạo vote vẫn chỉ bằng `/poll create` trong Discord (vote được đăng vào kênh). Vote nằm trong kênh
// mà người đăng nhập không xem được thì không hiện câu hỏi và không mở hay đóng được (như `/poll results` báo "không tìm thấy").
// Phiếu ẩn danh (DEC-026): chỉ hiện số phiếu, không bao giờ hiện ai chọn gì.
import { messageLink } from "discord.js";
import { formatNumber } from "../../discord/format";
import { MemberDisplay } from "../../discord/memberDirectory";
import { Poll, PollListQuery } from "../../modules/poll/types";
import { UserError } from "../../shared/errors";
import { canViewItemChannel, hiddenChannelIds } from "../discord";
import { canViewChannel, channelLabel } from "../format";
import { html, HtmlValue, RawHtml } from "../html";
import { WebResponse } from "../http";
import { csrfField, guildUrl, redirectWithFlash, renderPage } from "../layout";
import { GuildPageContext, PageModule } from "../types";
import { formatDateTime, HIDDEN_ITEM_TEXT, memberLink, pager, parsePositiveId, queryPage, withMessageEditNote } from "../widgets";

const PATH = "/polls";
const VIEW_PATH = `${PATH}/view`;
const CLOSE_PATH = `${PATH}/close`;
/** Số vote mỗi trang của danh sách. */
export const POLL_PAGE_SIZE = 20;
const STATUS_PARAM = "tt";
const CONFIRM_FIELD = "xac-nhan";

export const INVALID_POLL_ID = "Mã vote không hợp lệ.";
export const CLOSE_CONFIRM_REQUIRED = "Hãy tick ô xác nhận trước khi đóng vote.";
export const POLL_CREATE_NOTE = "Vote tạo bằng lệnh /poll create trong Discord; trang này để xem lịch sử, kết quả và đóng vote.";

type StatusTab = PollListQuery["status"];

const TABS: readonly { value: StatusTab; label: string }[] = [
	{ value: "all", label: "Tất cả" },
	{ value: "open", label: "Đang mở" },
	{ value: "closed", label: "Đã đóng" },
];

/** Trạng thái hiển thị: "expired" là đã quá hạn nhưng lịch tự đóng chưa chạy tới (chưa có closedAt). */
type PollState = "open" | "expired" | "closed";

const STATE_BADGES: Readonly<Record<PollState, RawHtml>> = {
	open: html`<span class="badge ok">Đang mở</span>`,
	expired: html`<span class="badge warn">Hết hạn</span>`,
	closed: html`<span class="badge">Đã đóng</span>`,
};

const NONE = html`<span class="muted">—</span>`;

function pollState(poll: Poll, now: number): PollState
{
	if (poll.closedAt !== null) return "closed";
	return poll.closesAt !== null && poll.closesAt <= now ? "expired" : "open";
}

/** Tab từ `?tt=`; giá trị khác (kể cả thiếu) là "all". */
function statusTab(query: URLSearchParams): StatusTab
{
	const text = query.get(STATUS_PARAM);
	return TABS.find(tab => tab.value === text)?.value ?? "all";
}

function requirePollId(raw: string | null | undefined): number
{
	const id = parsePositiveId(raw);
	if (id === null) throw new UserError(INVALID_POLL_ID);
	return id;
}

function viewPath(id: number): string
{
	return `${VIEW_PATH}?id=${id}`;
}

function notFound(pollId: number): UserError
{
	return new UserError(`Không tìm thấy vote #${pollId}.`);
}

/** Vote theo mã; không có hoặc nằm trong kênh người đăng nhập không xem được thì báo "không tìm thấy" như `/poll results`. */
async function requireVisiblePoll(ctx: GuildPageContext, pollId: number): Promise<Poll>
{
	const poll = ctx.deps.services.polls.get(ctx.guild.id, pollId);
	if (!poll || !(await canViewItemChannel(ctx.deps.client, ctx.guild, poll.channelId, ctx.member))) throw notFound(pollId);
	return poll;
}

/** "Đóng <thời gian>", "Hạn <thời gian>" hoặc "Không giới hạn". */
function deadlineText(poll: Poll): string
{
	if (poll.closedAt !== null) return `Đóng ${formatDateTime(poll.closedAt)}`;
	return poll.closesAt === null ? "Không giới hạn" : `Hạn ${formatDateTime(poll.closesAt)}`;
}

function xpText(poll: Poll): string
{
	return poll.xpReward > 0 ? `+${formatNumber(poll.xpReward)} XP` : "Không có";
}

// ---------- Danh sách ----------

function listRow(ctx: GuildPageContext, poll: Poll, now: number, hidden: ReadonlySet<string>, displays: ReadonlyMap<string, MemberDisplay>): RawHtml
{
	const secret = poll.channelId !== null && hidden.has(poll.channelId);
	return html`<tr>
<td>${secret ? html`#${poll.id}` : html`<a href="${guildUrl(ctx, viewPath(poll.id))}">#${poll.id}</a>`}</td>
<td class="pl-question">${secret ? html`<span class="muted">${HIDDEN_ITEM_TEXT}</span>` : poll.question}</td>
<td>${STATE_BADGES[pollState(poll, now)]}</td>
<td class="num">${formatNumber(poll.participants)}</td>
<td class="num">${xpText(poll)}</td>
<td>${memberLink(ctx, poll.creatorId, displays.get(poll.creatorId))}</td>
<td class="pl-time">${formatDateTime(poll.createdAt)}</td>
<td class="pl-time">${deadlineText(poll)}</td>
</tr>`;
}

async function renderList(ctx: GuildPageContext): Promise<WebResponse>
{
	const { query } = ctx.req;
	const { client, services, adminActions, clock } = ctx.deps;
	const status = statusTab(query);
	const result = services.polls.listPage(ctx.guild.id, { status, page: queryPage(query), pageSize: POLL_PAGE_SIZE });
	const { items } = result;
	const now = clock.now();
	const hidden = await hiddenChannelIds(client, ctx.guild, items.map(poll => poll.channelId), ctx.member);
	const displays = await adminActions.displays(client, ctx.guild, [...new Set(items.map(poll => poll.creatorId))]);

	const tabs = html`<nav class="tabs">${TABS.map(tab =>
	{
		const href = guildUrl(ctx, tab.value === "all" ? PATH : `${PATH}?${STATUS_PARAM}=${tab.value}`);
		return html`<a href="${href}"${tab.value === status ? html` class="active"` : ""}>${tab.label}</a>`;
	})}</nav>`;
	const table = items.length === 0
		? html`<p class="muted">${status === "all" ? "Chưa có vote nào." : "Không có vote nào ở mục này."}</p>`
		: html`<table class="table">
<thead><tr><th>Mã</th><th>Câu hỏi</th><th>Trạng thái</th><th class="num">Người tham gia</th><th class="num">XP thưởng</th><th>Người tạo</th><th>Tạo lúc</th><th>Hạn / đóng lúc</th></tr></thead>
<tbody>${items.map(poll => listRow(ctx, poll, now, hidden, displays))}</tbody>
</table>`;

	return renderPage(ctx, {
		nav: "polls",
		title: "Vote",
		lead: "Lịch sử vote, bầu cử, lấy ý kiến của server (phiếu ẩn danh). Mở từng vote để xem kết quả hoặc đóng vote.",
		body: html`<section class="card"><p class="pl-note">${POLL_CREATE_NOTE}</p>
${tabs}<p class="pl-summary">${formatNumber(result.total)} vote.</p>
${table}${pager(ctx, PATH, { [STATUS_PARAM]: status === "all" ? "" : status }, result.page, result.totalPages)}</section>`,
	});
}

// ---------- Chi tiết ----------

function percent(votes: number, total: number): number
{
	return total > 0 ? Math.round((votes / total) * 100) : 0;
}

/** Bảng kết quả: số phiếu, phần trăm và thanh tỉ lệ (thẻ progress, vì CSP không cho style inline). */
function resultsTable(poll: Poll): RawHtml
{
	const totalVotes = poll.options.reduce((sum, option) => sum + option.votes, 0);
	const rows = poll.options.map(option =>
	{
		const share = percent(option.votes, totalVotes);
		return html`<tr>
<td class="pl-option">${option.index + 1}. ${option.label}</td>
<td class="pl-bar-cell"><progress class="pl-bar" max="${Math.max(totalVotes, 1)}" value="${option.votes}" aria-label="${share}%">${share}%</progress></td>
<td class="num">${formatNumber(option.votes)}</td>
<td class="num">${share}%</td>
</tr>`;
	});
	return html`<table class="table pl-results">
<thead><tr><th>Lựa chọn</th><th>Tỉ lệ</th><th class="num">Phiếu</th><th class="num">%</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<p class="muted pl-hint">Tỉ lệ tính trên tổng ${formatNumber(totalVotes)} phiếu của mọi lựa chọn${poll.multiSelect ? " (chọn nhiều: một người có thể góp nhiều phiếu)" : ""}.
Phiếu ẩn danh: chỉ có số phiếu, không ai xem được ai chọn gì.</p>`;
}

function metaList(rows: readonly (readonly [string, HtmlValue] | null)[]): RawHtml
{
	return html`<dl class="pl-meta">${rows.map(row => row === null ? "" : html`<dt>${row[0]}</dt><dd>${row[1]}</dd>`)}</dl>`;
}

function closeForm(ctx: GuildPageContext, poll: Poll): RawHtml
{
	return html`<section class="card danger-zone"><h2>Đóng vote</h2>
<p>Đóng vote ngay: thành viên không bấm chọn được nữa và message trong Discord chuyển sang "Đã đóng" kèm kết quả cuối. Không mở lại
được. Giống lệnh <code>/poll close</code>.</p>
<form method="post" action="${guildUrl(ctx, CLOSE_PATH)}">${csrfField(ctx)}<input type="hidden" name="id" value="${poll.id}">
<label class="check"><input type="checkbox" name="${CONFIRM_FIELD}" value="1" required> Tôi muốn đóng vote #${poll.id}</label>
<div class="actions"><button class="btn btn-danger" type="submit">Đóng vote</button></div>
</form></section>`;
}

async function renderDetail(ctx: GuildPageContext): Promise<WebResponse>
{
	const pollId = requirePollId(ctx.req.query.get("id"));
	const poll = await requireVisiblePoll(ctx, pollId);
	const { client, adminActions, clock } = ctx.deps;
	const state = pollState(poll, clock.now());
	const displays = await adminActions.displays(client, ctx.guild, [poll.creatorId]);
	const messageUrl = poll.channelId !== null && poll.messageId !== null ? messageLink(poll.channelId, poll.messageId, poll.guildId) : null;

	const meta = metaList([
		["Trạng thái", STATE_BADGES[state]],
		["Hình thức", `${poll.multiSelect ? "Chọn nhiều" : "Chọn một"} · Phiếu ẩn danh`],
		["Người tham gia", formatNumber(poll.participants)],
		["XP khi tham gia", xpText(poll)],
		["Người tạo", memberLink(ctx, poll.creatorId, displays.get(poll.creatorId))],
		["Tạo lúc", formatDateTime(poll.createdAt)],
		["Thời hạn", poll.closesAt === null ? "Không giới hạn" : formatDateTime(poll.closesAt)],
		poll.closedAt === null ? null : ["Đóng lúc", formatDateTime(poll.closedAt)],
		["Kênh", poll.channelId === null ? NONE : channelLabel(ctx.guild, poll.channelId, ctx.member)],
		messageUrl === null ? null : ["Trong Discord", html`<a href="${messageUrl}" rel="noopener noreferrer" target="_blank">Mở message của vote</a>`],
	]);
	const footer = state === "open"
		? closeForm(ctx, poll)
		: html`<p class="muted">${state === "expired" ? "Vote đã hết hạn; bot sẽ tự đóng và cập nhật message trong Discord trong giây lát." : "Vote đã đóng."}</p>`;

	return renderPage(ctx, {
		nav: "polls",
		title: `Vote #${pollId}`,
		body: html`<p><a href="${guildUrl(ctx, PATH)}">← Danh sách vote</a></p>
<section class="card"><h2 class="pl-question">🗳️ ${poll.question}</h2>
${resultsTable(poll)}
${meta}</section>
${footer}`,
	});
}

// ---------- Đóng ----------

async function close(ctx: GuildPageContext): Promise<WebResponse>
{
	const form = ctx.req.form ?? new URLSearchParams();
	const pollId = requirePollId(form.get("id"));
	if (form.get(CONFIRM_FIELD) !== "1") throw new UserError(CLOSE_CONFIRM_REQUIRED);
	await requireVisiblePoll(ctx, pollId);

	const poll = ctx.deps.services.polls.close({ guildId: ctx.guild.id, pollId, actorId: ctx.actorId, actorIsAdmin: true });
	const refreshed = await ctx.deps.adminActions.refreshPoll(ctx.deps.client, poll);
	return redirectWithFlash(ctx, viewPath(pollId), "ok", withMessageEditNote(`Đã đóng vote #${pollId}.`, refreshed, poll.messageId));
}

/**
 * Lỗi khi đóng quay về trang chi tiết nếu vote có thật và (theo cache) nằm trong kênh người đăng nhập xem được; còn lại ném để
 * server về danh sách, không chuyển tới trang chi tiết sẽ báo "không tìm thấy".
 */
function closeErrorRedirect(ctx: GuildPageContext): string
{
	const pollId = requirePollId(ctx.req.form?.get("id"));
	const poll = ctx.deps.services.polls.get(ctx.guild.id, pollId);
	if (!poll || (poll.channelId !== null && !canViewChannel(ctx.guild, poll.channelId, ctx.member))) throw notFound(pollId);
	return viewPath(pollId);
}

export const pollsPage: PageModule = {
	routes: [
		{ method: "GET", path: PATH, handler: renderList },
		{ method: "GET", path: VIEW_PATH, handler: renderDetail },
		{ method: "POST", path: CLOSE_PATH, handler: close, errorRedirect: closeErrorRedirect },
	],
	css: `
.pl-note { margin-top: 0; color: var(--muted); }
.pl-summary { margin: 0 0 10px; color: var(--muted); }
.pl-question { overflow-wrap: anywhere; }
.pl-time { white-space: nowrap; }
.pl-option { overflow-wrap: anywhere; }
.pl-bar-cell { width: 40%; min-width: 120px; }
.pl-bar { width: 100%; height: 14px; accent-color: var(--brand); }
.pl-hint { font-size: 13px; }
.pl-meta { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 18px; margin: 16px 0 0; }
.pl-meta dt { color: var(--muted); font-weight: 600; }
.pl-meta dd { margin: 0; overflow-wrap: anywhere; }
`,
};
