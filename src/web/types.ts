// Hợp đồng chung của tầng web (DEC-039): phụ thuộc, context của trang, route. Agent viết trang chỉ cần file này, layout.ts,
// format.ts, html.ts và service trong `deps.services`.
import type { Guild, GuildMember } from "discord.js";
import type DiscordClient from "../classes/DiscordClient";
import type { WebConfig } from "../config";
import type { LiveBoardActions } from "../discord/configOps";
import type { AppServices } from "../services";
import type { Clock } from "../shared/clock";
import type { WebRequest, WebResponse } from "./http";
import type { FetchFn } from "./oauth";
import type { WebSession } from "./session";

export interface WebDeps
{
	client: DiscordClient;
	services: AppServices;
	/** Guild bot phục vụ (DISCORD_GUILD_IDS); web chỉ mở trang cho các guild này. */
	guildIds: readonly string[];
	config: WebConfig;
	/** fetch cho OAuth2 với Discord; test thay bằng hàm giả. */
	fetch: FetchFn;
	clock: Clock;
	/** Đăng/xoá message Bảng vàng (dùng chung với lệnh Discord); test thay bằng hàm giả. */
	liveBoardActions: LiveBoardActions;
}

/**
 * Context của một request tới trang của một guild. Server đã kiểm tra trước khi gọi handler:
 * - có phiên đăng nhập còn hạn;
 * - guild nằm trong `guildIds` và có trong cache của bot;
 * - người đăng nhập vừa được lấy lại từ Discord ở request này (`member`) và là admin bot (Manage Server hoặc role admin bot);
 * - với POST: body là form hợp lệ, token CSRF đúng, Origin (nếu có) đúng WEB_BASE_URL.
 */
export interface GuildPageContext
{
	req: WebRequest;
	deps: WebDeps;
	session: WebSession;
	guild: Guild;
	member: GuildMember;
	/** Discord user ID của người đăng nhập: truyền làm actorId cho mọi service ghi audit. */
	actorId: string;
}

/** Mục menu bên trái; mỗi trang một khoá. */
export type NavKey = "overview" | "channels" | "teams" | "settings" | "roles" | "board" | "tiers" | "audit";

/**
 * Một route của trang guild, gắn dưới `/g/<guildId>`. `path` là phần sau đó: "" (tổng quan) hoặc "/channels", ...
 *
 * Quy ước:
 * - GET trả về `renderPage(ctx, ...)` (layout.ts).
 * - POST xử lý form rồi trả về `redirectWithFlash(ctx, path, "ok", text)` (mẫu POST → chuyển hướng → GET). Lỗi nghiệp vụ thì
 *   ném `UserError`: server tự đặt flash lỗi và chuyển hướng về trang GET cùng đường dẫn, hoặc trang cha gần nhất có route GET
 *   (`/board/off` → `/board`), không ghi gì thêm.
 * - Mọi form POST phải có `csrfField(ctx)`. Đọc form bằng `ctx.req.form`. Không bao giờ tin giá trị form: kiểm tra lại ID kênh/role
 *   có trong `ctx.guild` và đúng loại; số đi qua `parseFormNumber` hoặc giới hạn của service.
 * - Form có thể bị hai admin mở cùng lúc: đặt giá trị lúc vẽ vào input ẩn và chỉ ghi phần admin thật sự đổi (như `/config panel`).
 */
export interface GuildRoute
{
	method: "GET" | "POST";
	path: string;
	handler(ctx: GuildPageContext): Promise<WebResponse> | WebResponse;
}

/** Một module trang: các route và CSS riêng (tuỳ chọn, nối vào /static/app.css; CSP chặn style inline). */
export interface PageModule
{
	routes: readonly GuildRoute[];
	css?: string;
}
