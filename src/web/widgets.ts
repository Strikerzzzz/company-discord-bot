// Phần dựng dùng chung cho các trang dữ liệu của web quản trị (DEC-041): phân trang, đọc tham số, ô thành viên, thời gian.
import type { MemberDisplay } from "../discord/memberDirectory";
import { UNKNOWN_MEMBER_NAME } from "../discord/memberDirectory";
import { UserError } from "../shared/errors";
import { html, RawHtml } from "./html";
import { guildUrl } from "./layout";
import { GuildPageContext } from "./types";

/** Tên tham số trang trong query (`?trang=2`). */
export const PAGE_PARAM = "trang";
const MAX_PAGE_NUMBER = 1_000_000;
const SNOWFLAKE = /^\d{17,20}$/u;
const USER_MENTION = /^<@!?(\d{17,20})>$/u;
const POSITIVE_INT = /^\d{1,9}$/u;
/** Avatar chỉ lấy từ CDN của Discord (CSP chỉ cho phép `img-src https://cdn.discordapp.com`). */
const DISCORD_CDN = "https://cdn.discordapp.com/";

const TIME_FORMAT = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" });

/** Ngày giờ theo giờ Việt Nam, ví dụ "30/9/26 09:04". */
export function formatDateTime(ms: number): string
{
	return TIME_FORMAT.format(ms);
}

/** Số trang từ query (`?trang=`): chỉ nhận chữ số, ngoài khoảng hoặc sai thì trang 1. Service tự kẹp trang vượt quá. */
export function queryPage(query: URLSearchParams): number
{
	const text = query.get(PAGE_PARAM) ?? "";
	if (!POSITIVE_INT.test(text)) return 1;
	const page = Number(text);
	return page >= 1 && page <= MAX_PAGE_NUMBER ? page : 1;
}

/** Số nguyên dương (mã contribution, mã vote) từ chuỗi; null nếu không phải toàn chữ số hoặc bằng 0. */
export function parsePositiveId(raw: string | null | undefined): number | null
{
	const text = raw?.trim() ?? "";
	if (!POSITIVE_INT.test(text)) return null;
	const id = Number(text);
	return id >= 1 ? id : null;
}

/** Discord user ID từ ô nhập: ID (17–20 chữ số) hoặc mention `<@id>`; null nếu không phải. */
export function parseUserId(raw: string | null | undefined): string | null
{
	const text = raw?.trim() ?? "";
	if (SNOWFLAKE.test(text)) return text;
	return USER_MENTION.exec(text)?.[1] ?? null;
}

/** Như parseUserId nhưng ném UserError khi không hợp lệ (dùng cho input ẩn của form). */
export function requireUserId(raw: string | null | undefined): string
{
	const userId = parseUserId(raw);
	if (userId === null) throw new UserError("Mã thành viên không hợp lệ.");
	return userId;
}

/**
 * Link phân trang "‹ Trước · Trang x/y · Sau ›" tới `path` của guild, giữ các tham số lọc trong `params` (giá trị rỗng bị bỏ).
 * Chỉ một trang thì không hiện gì.
 */
export function pager(ctx: Pick<GuildPageContext, "guild">, path: string, params: Readonly<Record<string, string>>, page: number, totalPages: number): RawHtml
{
	if (totalPages <= 1) return html``;
	const link = (target: number): string =>
	{
		const query = new URLSearchParams();
		for (const [name, value] of Object.entries(params)) if (value !== "") query.set(name, value);
		query.set(PAGE_PARAM, String(target));
		return guildUrl(ctx, `${path}?${query.toString()}`);
	};
	return html`<nav class="pager">${page > 1 ? html`<a class="btn" href="${link(page - 1)}">‹ Trước</a>` : ""}
<span class="current">Trang ${page}/${totalPages}</span>${page < totalPages ? html`<a class="btn" href="${link(page + 1)}">Sau ›</a>` : ""}</nav>`;
}

/** Avatar (chỉ khi URL thuộc CDN của Discord), tên hiển thị và ghi chú nếu người này đã rời server. */
export function userCell(userId: string, display: MemberDisplay | undefined): RawHtml
{
	const name = display?.displayName ?? UNKNOWN_MEMBER_NAME;
	const avatar = display?.avatarUrl?.startsWith(DISCORD_CDN) ? html`<img src="${display.avatarUrl}" alt="" loading="lazy">` : "";
	const left = display && !display.inGuild ? html` <span class="badge warn">đã rời server</span>` : "";
	return html`<span class="user-cell">${avatar}<span>${name}</span></span>${left} <span class="muted">${userId}</span>`;
}

/** URL trang hồ sơ thành viên (`/members/view?u=<userId>`) của guild hiện tại. */
export function memberUrl(ctx: Pick<GuildPageContext, "guild">, userId: string): string
{
	return guildUrl(ctx, `/members/view?u=${userId}`);
}

/** userCell kèm link tới trang hồ sơ thành viên. */
export function memberLink(ctx: Pick<GuildPageContext, "guild">, userId: string, display: MemberDisplay | undefined): RawHtml
{
	return html`<a href="${memberUrl(ctx, userId)}">${userCell(userId, display)}</a>`;
}
