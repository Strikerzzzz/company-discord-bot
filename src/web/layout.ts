// Khung trang của web quản trị (DEC-039): thanh trên, menu trái, thông báo kết quả (flash), form CSRF.
import { discordText } from "./format";
import { html, HtmlValue, RawHtml } from "./html";
import { htmlResponse, redirect, WebResponse } from "./http";
import { FlashKind } from "./session";
import { GuildPageContext, NavKey } from "./types";

export interface NavItem
{
	key: NavKey;
	/** Phần sau /g/<guildId>. */
	path: string;
	label: string;
	/** Nhóm trong menu; tên nhóm hiện trước mục đầu tiên của nhóm. */
	group: string;
}

const DATA_GROUP = "Dữ liệu";
const CONFIG_GROUP = "Cấu hình";
const SYSTEM_GROUP = "Hệ thống";

export const NAV_ITEMS: readonly NavItem[] = [
	{ key: "overview", path: "", label: "🏠 Tổng quan", group: DATA_GROUP },
	{ key: "members", path: "/members", label: "👤 Thành viên", group: DATA_GROUP },
	{ key: "leaderboard", path: "/leaderboard", label: "📊 Bảng xếp hạng", group: DATA_GROUP },
	{ key: "contributions", path: "/contributions", label: "🤝 Contribution", group: DATA_GROUP },
	{ key: "polls", path: "/polls", label: "🗳️ Vote", group: DATA_GROUP },
	{ key: "retro", path: "/retro", label: "🔁 Retro", group: DATA_GROUP },
	{ key: "stats", path: "/stats", label: "📈 Thống kê", group: DATA_GROUP },
	{ key: "channels", path: "/channels", label: "📺 Kênh tính XP", group: CONFIG_GROUP },
	{ key: "teams", path: "/teams", label: "👥 Team", group: CONFIG_GROUP },
	{ key: "settings", path: "/settings", label: "⭐ Cài đặt điểm", group: CONFIG_GROUP },
	{ key: "roles", path: "/roles", label: "🔐 Quyền", group: CONFIG_GROUP },
	{ key: "board", path: "/board", label: "🏆 Bảng vàng", group: CONFIG_GROUP },
	{ key: "tiers", path: "/tiers", label: "🏅 Danh hiệu", group: CONFIG_GROUP },
	{ key: "reset", path: "/reset", label: "♻️ Reset điểm", group: SYSTEM_GROUP },
	{ key: "backup", path: "/backup", label: "💾 Sao lưu", group: SYSTEM_GROUP },
	{ key: "audit", path: "/audit", label: "📜 Nhật ký", group: SYSTEM_GROUP },
];

/** URL tuyệt đối trong trang (bắt đầu bằng "/") tới trang `path` của guild hiện tại. */
export function guildUrl(ctx: Pick<GuildPageContext, "guild">, path = ""): string
{
	return `/g/${ctx.guild.id}${path}`;
}

/** Input ẩn chứa token CSRF; bắt buộc trong mọi form POST. */
export function csrfField(ctx: Pick<GuildPageContext, "session">): RawHtml
{
	return html`<input type="hidden" name="_csrf" value="${ctx.session.csrf}">`;
}

function titleOf(title: string): string
{
	return `${title} · Quản trị bot`;
}

/** Trang không thuộc guild (đăng nhập, lỗi): không có menu. */
export function renderPlainPage(title: string, body: HtmlValue, status = 200): WebResponse
{
	return htmlResponse(html`<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titleOf(title)}</title><link rel="stylesheet" href="/static/app.css"></head><body>${body}</body></html>`, status);
}

export interface PageSpec
{
	nav: NavKey;
	title: string;
	/** Dòng mô tả ngắn dưới tiêu đề (tuỳ chọn). */
	lead?: string;
	body: HtmlValue;
}

/** Trang của guild với layout đầy đủ. Đọc và xoá flash của phiên (flash chỉ hiện một lần). */
export function renderPage(ctx: GuildPageContext, page: PageSpec, status = 200): WebResponse
{
	const { guild, session, deps } = ctx;
	const flash = session.flash;
	session.flash = null;
	const botName = deps.client.user?.username ?? "Bot";
	const otherGuilds = deps.guildIds.filter(id => id !== guild.id && deps.client.guilds.cache.has(id));
	const nav = NAV_ITEMS.map((item, index) => html`${NAV_ITEMS[index - 1]?.group === item.group ? "" : html`<div class="nav-group">${item.group}</div>`}<a href="${guildUrl(ctx, item.path)}"${item.key === page.nav ? html` class="active"` : ""}>${item.label}</a>`);
	const switcher = otherGuilds.map(id => html` · <a href="/g/${id}">${deps.client.guilds.cache.get(id)?.name ?? id}</a>`);

	return htmlResponse(html`<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titleOf(page.title)}</title><link rel="stylesheet" href="/static/app.css"></head>
<body>
<header class="topbar"><div class="brand">⚙️ ${botName} · Quản trị</div>
<div class="who"><span>${guild.name}${switcher}</span><span>👤 ${session.displayName}</span>
<form method="post" action="/auth/logout">${csrfField(ctx)}<button class="btn btn-link" type="submit">Đăng xuất</button></form></div></header>
<div class="shell"><nav class="sidebar"><div class="guild">${guild.name}</div>${nav}</nav>
<main>${flash ? html`<div class="flash ${flash.kind}">${discordText(guild, flash.text, ctx.member)}</div>` : ""}
<h1>${page.title}</h1>${page.lead ? html`<p class="lead">${page.lead}</p>` : ""}
${page.body}</main></div>
</body></html>`, status);
}

/** Kết thúc một POST: đặt flash rồi chuyển hướng về trang `path` của guild (mẫu POST → chuyển hướng → GET). */
export function redirectWithFlash(ctx: GuildPageContext, path: string, kind: FlashKind, text: string): WebResponse
{
	ctx.session.flash = { kind, text };
	return redirect(guildUrl(ctx, path));
}
