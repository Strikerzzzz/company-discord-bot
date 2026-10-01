// Trang "Retro" của web quản trị (DEC-041, DEC-049): bản tối thiểu của phần lõi Phase 19, liệt kê các phiên retro (tiêu đề, kênh, trạng
// thái, số người đã điền) có phân trang. Chi tiết phiên, ai đã điền, nội dung ẩn danh, xoá ý / xoá nội dung, tạo vote, chọn tên, ghi
// Confluence và cài đặt retro sẽ được bổ sung trên trang này (dùng RetroService và src/discord/retroOps.ts, như lệnh /retro). Phiên nằm
// trong kênh mà người đăng nhập không xem được thì giấu tiêu đề và tên kênh.
import { formatNumber } from "../../discord/format";
import { retroStatusLabel } from "../../discord/views/retro";
import { RetroSession } from "../../modules/retro/types";
import { hiddenChannelIds } from "../discord";
import { channelLabel, discordText } from "../format";
import { html, RawHtml } from "../html";
import { WebResponse } from "../http";
import { renderPage } from "../layout";
import { GuildPageContext, PageModule } from "../types";
import { formatDateTime, HIDDEN_ITEM_TEXT, pager, queryPage } from "../widgets";

const PATH = "/retro";
/** Số phiên mỗi trang. */
export const RETRO_PAGE_SIZE = 20;

function listRow(ctx: GuildPageContext, session: RetroSession, hidden: ReadonlySet<string>): RawHtml
{
	const secret = hidden.has(session.channelId);
	return html`<tr>
<td>#${session.id}</td>
<td class="rt-title">${secret ? html`<span class="muted">${HIDDEN_ITEM_TEXT}</span>` : session.title}</td>
<td>${channelLabel(ctx.guild, session.channelId, ctx.member)}</td>
<td>${discordText(ctx.guild, retroStatusLabel(secret ? { ...session, winnerName: null } : session), ctx.member)}</td>
<td class="num">${formatNumber(session.participants)}</td>
<td class="rt-time">${formatDateTime(session.createdAt)}</td>
</tr>`;
}

async function renderList(ctx: GuildPageContext): Promise<WebResponse>
{
	const { client, services } = ctx.deps;
	const result = services.retro.listPage(ctx.guild.id, { status: "all", page: queryPage(ctx.req.query), pageSize: RETRO_PAGE_SIZE });
	const hidden = await hiddenChannelIds(client, ctx.guild, result.items.map(session => session.channelId), ctx.member);
	const table = result.items.length === 0
		? html`<p class="muted">Chưa có phiên retro nào. Tạo phiên bằng lệnh <code>/retro create</code> trong kênh hoặc thread của team.</p>`
		: html`<table class="table">
<thead><tr><th>Mã</th><th>Tiêu đề</th><th>Kênh</th><th>Trạng thái</th><th class="num">Đã điền</th><th>Tạo lúc</th></tr></thead>
<tbody>${result.items.map(session => listRow(ctx, session, hidden))}</tbody>
</table>`;

	return renderPage(ctx, {
		nav: "retro",
		title: "Retro",
		lead: "Các phiên retro sprint theo team. Câu trả lời ẩn danh: bảng trên Discord và Confluence không có tên người viết.",
		body: html`<section class="card"><p class="rt-summary">${formatNumber(result.total)} phiên.</p>
${table}${pager(ctx, PATH, {}, result.page, result.totalPages)}</section>`,
	});
}

export const retroPage: PageModule = {
	routes: [
		{ method: "GET", path: PATH, handler: renderList },
	],
	css: `
.rt-summary { margin: 0 0 10px; color: var(--muted); }
.rt-title { overflow-wrap: anywhere; }
.rt-time { white-space: nowrap; }
`,
};
