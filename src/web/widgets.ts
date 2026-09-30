// Phần dựng dùng chung cho các trang dữ liệu của web quản trị (DEC-041): phân trang, đọc tham số, ô thành viên, thời gian.
import type { MemberDisplay } from "../discord/memberDirectory";
import { UNKNOWN_MEMBER_NAME } from "../discord/memberDirectory";
import { UserError } from "../shared/errors";
import { html, HtmlValue, RawHtml } from "./html";
import { guildUrl } from "./layout";
import { GuildPageContext } from "./types";

/** Tên tham số trang trong query (`?trang=2`). */
export const PAGE_PARAM = "trang";
/** Tham số "chọn tất cả" của trang có bảng ô tick (`?chon=tat-ca` hoặc `?chon=bo-het`). */
export const SELECT_ALL_PARAM = "chon";

/**
 * Chọn hàng loạt trên trang có bảng ô tick (trang không có JavaScript, CSP): "all" = vẽ lại trang với mọi ô tick được đã tick,
 * "none" = mọi ô bỏ tick, null = như đang lưu. Chỉ đổi cách vẽ, chưa ghi gì: input ẩn vẫn mang giá trị đang lưu, admin bấm Lưu thì
 * trang chỉ ghi phần khác đi.
 */
export type BulkSelection = "all" | "none" | null;

export function bulkSelection(query: URLSearchParams): BulkSelection
{
	const value = query.get(SELECT_ALL_PARAM);
	if (value === "tat-ca") return "all";
	if (value === "bo-het") return "none";
	return null;
}

/** Ô tick có được tick khi vẽ không: theo chọn hàng loạt nếu có (ô bị khoá không tick thêm), không thì theo giá trị đang lưu. */
export function bulkChecked(selection: BulkSelection, saved: boolean, selectable = true): boolean
{
	if (selection === "all") return saved || selectable;
	if (selection === "none") return false;
	return saved;
}

/**
 * Link "✅ Chọn tất cả · ⬜ Bỏ chọn tất cả" cho bảng ô tick của trang `path`; đang chọn hàng loạt thì thêm lời nhắc chưa lưu và
 * link về như đang lưu.
 */
export function selectAllLinks(ctx: Pick<GuildPageContext, "guild">, path: string, selection: BulkSelection): RawHtml
{
	const link = (value: string): string => guildUrl(ctx, `${path}?${SELECT_ALL_PARAM}=${value}`);
	const pending = selection === null
		? ""
		: html`<div class="warn-box">${selection === "all" ? "Đã tick sẵn mọi ô." : "Đã bỏ tick mọi ô."} Bot <strong>chưa lưu</strong> gì: xem lại rồi bấm Lưu, hoặc <a href="${guildUrl(ctx, path)}">về như đang lưu</a>.</div>`;
	return html`<p class="select-all"><a href="${link("tat-ca")}">✅ Chọn tất cả</a> · <a href="${link("bo-het")}">⬜ Bỏ chọn tất cả</a></p>${pending}`;
}
const MAX_PAGE_NUMBER = 1_000_000;
const SNOWFLAKE = /^\d{17,20}$/u;
const USER_MENTION = /^<@!?(\d{17,20})>$/u;
const POSITIVE_INT = /^\d{1,9}$/u;
/** Avatar chỉ lấy từ CDN của Discord (CSP chỉ cho phép `img-src https://cdn.discordapp.com`). */
const DISCORD_CDN = "https://cdn.discordapp.com/";

/** Thay cho tiêu đề (câu hỏi) của mục nằm trong kênh người đăng nhập không xem được (contribution, vote). */
export const HIDDEN_ITEM_TEXT = "🔒 Nằm trong kênh bạn không xem được";
/** Nối vào thông báo khi bot không sửa được message đã đăng trong Discord. */
export const MESSAGE_EDIT_FAILED = "Không sửa được message trong Discord (có thể message đã bị xoá hoặc bot mất quyền).";

/** Thông báo kết quả, kèm cảnh báo nếu message đã đăng trong Discord (có `messageId`) không sửa được. */
export function withMessageEditNote(text: string, refreshed: boolean, messageId: string | null): string
{
	return !refreshed && messageId !== null ? `${text}\n${MESSAGE_EDIT_FAILED}` : text;
}

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

/** Snowflake lớn nhất Discord nhận (số nguyên không dấu 64 bit); ID 20 chữ số lớn hơn thì Discord trả lỗi 400. */
const MAX_SNOWFLAKE = 2n ** 64n - 1n;

/** Chuỗi là snowflake Discord hợp lệ: 17–20 chữ số và không vượt số nguyên không dấu 64 bit. */
export function isSnowflake(text: string): boolean
{
	return SNOWFLAKE.test(text) && BigInt(text) <= MAX_SNOWFLAKE;
}

/** Discord user ID từ ô nhập: ID (17–20 chữ số) hoặc mention `<@id>`; null nếu không phải. */
export function parseUserId(raw: string | null | undefined): string | null
{
	const text = raw?.trim() ?? "";
	const id = SNOWFLAKE.test(text) ? text : USER_MENTION.exec(text)?.[1] ?? null;
	return id !== null && isSnowflake(id) ? id : null;
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

/** Danh sách "nhãn: giá trị" (thẻ dl) của trang chi tiết; dòng null bị bỏ. `className` là class CSS riêng của trang. */
export function metaList(className: string, rows: readonly (readonly [string, HtmlValue] | null)[]): RawHtml
{
	return html`<dl class="${className}">${rows.map(row => row === null ? "" : html`<dt>${row[0]}</dt><dd>${row[1]}</dd>`)}</dl>`;
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
