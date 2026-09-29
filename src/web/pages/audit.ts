// Trang "Nhật ký quản trị" của web quản trị (DEC-039): các thao tác quản trị mới nhất (AuditService.list), như `/admin audit`
// nhưng hiện tên kênh, role, người thay cho mention, và thời gian theo giờ Việt Nam.
import { Guild } from "discord.js";
import { auditActionLabel, auditTargetKind, formatAuditDetails } from "../../discord/views/admin";
import { AuditEntry } from "../../modules/audit/AuditService";
import { channelLabel, discordText, roleLabel, userLabel } from "../format";
import { html, RawHtml } from "../html";
import { WebResponse } from "../http";
import { guildUrl, renderPage } from "../layout";
import { GuildPageContext, PageModule } from "../types";

const PATH = "/audit";
/** Số mục mặc định; `?so=` chỉ nhận các giá trị trong AUDIT_LIMITS, giá trị khác về mặc định. */
export const DEFAULT_AUDIT_LIMIT = 50;
export const AUDIT_LIMITS: readonly number[] = [DEFAULT_AUDIT_LIMIT, 100, 200];
export const NO_AUDIT_ENTRIES = "Chưa có thao tác nào";

const TIME_FORMAT = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "medium" });

/** Số mục cần hiện theo `?so=`; chỉ nhận đúng chữ số của một giá trị trong AUDIT_LIMITS. */
export function auditLimit(query: URLSearchParams): number
{
	const text = query.get("so");
	return AUDIT_LIMITS.find(limit => String(limit) === text) ?? DEFAULT_AUDIT_LIMIT;
}

/** Tên thành viên kèm ID nhỏ; không có trong cache thì userLabel đã ghi "người dùng <ID>", không lặp lại ID. */
function userCell(guild: Guild, userId: string): RawHtml
{
	return guild.members.cache.has(userId)
		? html`${userLabel(guild, userId)}<br><small class="muted au-id">${userId}</small>`
		: html`${userLabel(guild, userId)}`;
}

/** Đối tượng của mục audit bằng tên (kênh, role, người); ID khác hiện nguyên văn; không có thì gạch ngang. */
function targetCell(guild: Guild, entry: AuditEntry): RawHtml
{
	const { targetId } = entry;
	if (targetId === null) return html`<span class="muted">—</span>`;
	switch (auditTargetKind(entry.action))
	{
	case "user": return userCell(guild, targetId);
	case "role": return html`${roleLabel(guild, targetId)}`;
	case "channel": return html`${channelLabel(guild, targetId)}`;
	case "none": return html`${targetId}`;
	}
}

/**
 * Bỏ dấu `\` mà escapeMarkdown (qua inlineText) chèn trước ký tự markdown trong chữ người dùng nhập, để web hiện đúng chữ gốc
 * ("a_b" thay vì "a\_b"). Chỉ đổi cách hiển thị: discordText vẫn escape HTML toàn bộ trước khi đổi `**đậm**` và `` `mã` ``.
 */
function withoutMarkdownEscapes(text: string): string
{
	return text.replace(/\\([\\*_`~|])/gu, "$1");
}

function entryRow(guild: Guild, entry: AuditEntry): RawHtml
{
	const details = formatAuditDetails(entry.details, entry.action);
	return html`<tr>
<td class="au-time">${TIME_FORMAT.format(entry.createdAt)}</td>
<td>${userCell(guild, entry.actorId)}</td>
<td>${auditActionLabel(entry.action)}</td>
<td>${targetCell(guild, entry)}</td>
<td class="au-details">${details === null ? html`<span class="muted">—</span>` : discordText(guild, withoutMarkdownEscapes(details))}</td>
</tr>`;
}

function renderAudit(ctx: GuildPageContext): WebResponse
{
	const limit = auditLimit(ctx.req.query);
	const entries = ctx.deps.services.audit.list(ctx.guild.id, limit);
	const limitLinks = AUDIT_LIMITS.map(value => value === limit
		? html` <span class="badge ok">${value}</span>`
		: html` <a href="${guildUrl(ctx, PATH)}?so=${value}">${value}</a>`);
	const table = entries.length === 0
		? html`<p class="muted">${NO_AUDIT_ENTRIES}.</p>`
		: html`<div class="au-wrap"><table class="table au-table">
<thead><tr><th>Thời gian</th><th>Người thao tác</th><th>Hành động</th><th>Đối tượng</th><th>Chi tiết</th></tr></thead>
<tbody>${entries.map(entry => entryRow(ctx.guild, entry))}</tbody>
</table></div>`;
	const body = html`<section class="card">
<p class="au-limits">Hiện ${entries.length} mục mới nhất · Số mục:${limitLinks}</p>
${table}
</section>`;
	return renderPage(ctx, {
		nav: "audit",
		title: "Nhật ký quản trị",
		lead: "Ai đã đổi gì, lúc nào (giờ Việt Nam): mọi thao tác quản trị từ lệnh Discord và từ trang web này.",
		body,
	});
}

export const auditPage: PageModule = {
	routes: [
		{ method: "GET", path: PATH, handler: renderAudit },
	],
	css: `
.au-wrap { overflow-x: auto; }
.au-table td { vertical-align: top; }
.au-time { white-space: nowrap; }
.au-id { font-size: 12px; }
.au-details { overflow-wrap: anywhere; }
.au-limits { margin-top: 0; }
`,
};
