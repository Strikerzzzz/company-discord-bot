import { UserError } from "../../shared/errors";
import { RETRO_LIMITS } from "./types";

/** Link tài liệu của phiên retro đã kiểm tra. */
export interface DocLink
{
	/** URL đã chuẩn hoá (URL.href). */
	url: string;
	/** ID trang Confluence đọc từ link; null nếu link không có ID trang (chỉ chấp nhận khi chưa cấu hình Confluence). */
	pageId: string | null;
}

const PAGE_ID = /^\d{1,20}$/u;
const PAGE_PATH = /\/pages\/(\d{1,20})(?:\/|$)/u;

export const DOC_LINK_INVALID = "Link tài liệu không hợp lệ: cần một địa chỉ http(s) đầy đủ, ví dụ link trang Confluence copy từ trình duyệt.";
export const DOC_LINK_NO_PAGE_ID = "Không đọc được mã trang từ link Confluence. Hãy dán link dạng …/pages/<số>/… hoặc "
	+ "…/pages/viewpage.action?pageId=<số> (trên Confluence: bấm ··· → Page Information, rồi copy link trên thanh địa chỉ).";

/** Thông báo khi link không nằm trên Confluence đã cấu hình: bot chỉ gửi token tới đúng host của CONFLUENCE_BASE_URL. */
export function docLinkWrongHost(host: string): string
{
	return `Link phải là một trang trên Confluence của công ty (${host}): bot chỉ gửi token tới đúng địa chỉ đã cấu hình.`;
}

/** ID trang Confluence trong đường dẫn `…/pages/<id>/…` hoặc tham số `pageId=<id>` (viewpage.action); null nếu không có. */
export function confluencePageId(url: URL): string | null
{
	const byPath = PAGE_PATH.exec(url.pathname);
	if (byPath) return byPath[1];
	const byQuery = url.searchParams.get("pageId");
	return byQuery !== null && PAGE_ID.test(byQuery) ? byQuery : null;
}

function parseUrl(raw: string): URL
{
	const text = raw.trim();
	if (text.length === 0 || text.length > RETRO_LIMITS.docUrlMax) throw new UserError(DOC_LINK_INVALID);
	let url: URL;
	try
	{
		url = new URL(text);
	}
	catch
	{
		throw new UserError(DOC_LINK_INVALID);
	}
	if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "") throw new UserError(DOC_LINK_INVALID);
	return url;
}

/**
 * Kiểm tra link tài liệu của phiên retro (DEC-049):
 * - http(s), không chứa tài khoản, tối đa RETRO_LIMITS.docUrlMax ký tự;
 * - đã cấu hình Confluence (`confluenceBaseUrl` khác null): host phải trùng host của CONFLUENCE_BASE_URL và link phải có ID trang;
 * - chưa cấu hình: vẫn lưu link (bot không ghi), ID trang đọc được thì giữ để dùng khi bật Confluence sau này.
 * UserError nếu không hợp lệ.
 */
export function parseDocLink(raw: string, confluenceBaseUrl: string | null): DocLink
{
	const url = parseUrl(raw);
	const pageId = confluencePageId(url);
	if (confluenceBaseUrl !== null)
	{
		const base = new URL(confluenceBaseUrl);
		if (url.host !== base.host) throw new UserError(docLinkWrongHost(base.host));
		if (pageId === null) throw new UserError(DOC_LINK_NO_PAGE_ID);
	}
	return { url: url.href, pageId };
}
