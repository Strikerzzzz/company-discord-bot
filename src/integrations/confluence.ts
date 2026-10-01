// Ghi bảng retro vào Confluence nội bộ (DEC-049, ngoại lệ có phạm vi của luật protected số 3): chỉ đọc và sửa trang retro đã gắn,
// chỉ tới đúng host của CONFLUENCE_BASE_URL, xác thực bằng Personal Access Token (Bearer). Dùng `fetch` có sẵn của Node, không thêm
// dependency. Không log gì ở đây; lỗi là ConfluenceError với thông báo tiếng Việt ngắn, không bao giờ chứa token hay nội dung phản hồi.
import type { ConfluenceConfig } from "../config";
import { confluencePageId, DOC_LINK_INVALID, DOC_LINK_NO_PAGE_ID, docLinkWrongHost } from "../modules/retro/docLink";
import { RETRO_FIELD_TITLES, RETRO_FIELDS, RetroAnswers } from "../modules/retro/types";

export type ConfluenceFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Thời gian chờ tối đa của một request tới Confluence. */
export const CONFLUENCE_TIMEOUT_MS = 15_000;
/** Số lần thử tối đa khi Confluence báo xung đột phiên bản (409): lần đầu và 3 lần thử lại, mỗi lần đọc lại trang. */
export const CONFLUENCE_MAX_ATTEMPTS = 4;

export const CONFLUENCE_NETWORK_ERROR = "Không kết nối được Confluence (mạng lỗi hoặc quá thời gian chờ). Hãy thử ghi lại sau.";
export const CONFLUENCE_BAD_RESPONSE = "Phản hồi của Confluence không đúng định dạng mong đợi.";
export const CONFLUENCE_CONFLICT = `Trang Confluence đang được sửa cùng lúc (xung đột phiên bản), bot đã thử ${CONFLUENCE_MAX_ATTEMPTS} lần. Hãy ghi lại sau ít phút.`;
export const CONFLUENCE_BROKEN_SECTION = "Khu vực bot quản lý trên trang Confluence bị sửa dở (mất dấu kết thúc). Hãy xoá phần "
	+ "\"🤖 Retro từ Discord\" cũ trên trang rồi ghi lại.";

/** Lỗi khi ghi Confluence; `message` hiển thị được cho người quản lý và lưu vào phiên. */
export class ConfluenceError extends Error
{
	constructor(message: string)
	{
		super(message);
		this.name = "ConfluenceError";
	}
}

/** Dữ liệu khu vực retro bot ghi lên trang: ẩn danh, không có tên người viết. */
export interface RetroDocSection
{
	guildId: string;
	sessionId: number;
	title: string;
	/** Các phiếu ẩn danh, mỗi phiếu một dòng của bảng. */
	entries: readonly RetroAnswers[];
	/** Tên sprint đã chốt; null nếu chưa chốt. */
	winnerName: string | null;
}

/** Nơi ghi bảng retro; tầng Discord và web nhận qua RetroActions để test thay bằng bản giả. */
export interface RetroDocWriter
{
	/** Địa chỉ gốc của Confluence (để hiển thị). */
	readonly baseUrl: string;
	/**
	 * Ghi (hoặc thay) khu vực của phiên ở cuối trang `docUrl`. Ghi nhiều lần không nhân đôi khu vực, không đụng phần khác của trang.
	 * Ném ConfluenceError nếu lỗi.
	 */
	writeRetroSection(docUrl: string, section: RetroDocSection): Promise<void>;
}

interface ConfluencePage
{
	id: string;
	type: string;
	title: string;
	version: number;
	storage: string;
}

function isRecord(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null;
}

/** Trang Confluence từ JSON của GET /rest/api/content/{id}?expand=body.storage,version; null nếu sai định dạng. */
function toPage(json: unknown): ConfluencePage | null
{
	if (!isRecord(json) || typeof json.id !== "string" || typeof json.type !== "string" || typeof json.title !== "string") return null;
	const version = isRecord(json.version) ? json.version.number : undefined;
	const storage = isRecord(json.body) && isRecord(json.body.storage) ? json.body.storage.value : undefined;
	if (typeof version !== "number" || !Number.isSafeInteger(version) || typeof storage !== "string") return null;
	return { id: json.id, type: json.type, title: json.title, version, storage };
}

/** Thông báo cho mã HTTP lỗi của Confluence (không kèm nội dung phản hồi). */
export function confluenceStatusError(status: number): ConfluenceError
{
	if (status === 401) return new ConfluenceError("Confluence từ chối token (401): token sai, đã hết hạn hoặc đã bị thu hồi.");
	if (status === 403) return new ConfluenceError("Tài khoản của token không có quyền xem hoặc sửa trang này (403).");
	if (status === 404) return new ConfluenceError("Không tìm thấy trang Confluence (404): kiểm tra link, hoặc tài khoản của token chưa được xem trang.");
	return new ConfluenceError(`Confluence trả lỗi HTTP ${status}.`);
}

/**
 * Ký tự hợp lệ trong XML 1.0: tab, xuống dòng, và các khoảng Char của đặc tả. Ký tự điều khiển khác, surrogate lẻ, U+FFFE/U+FFFF
 * làm Confluence từ chối cả trang.
 */
function isXmlChar(codePoint: number): boolean
{
	return codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd
		|| (codePoint >= 0x20 && codePoint <= 0xd7ff)
		|| (codePoint >= 0xe000 && codePoint <= 0xfffd)
		|| codePoint >= 0x10000;
}

/** Escape chữ người dùng trước khi chèn vào storage format (XHTML): bỏ ký tự XML không hợp lệ, rồi & < > " '. */
export function escapeXml(text: string): string
{
	return Array.from(text)
		.filter(char => isXmlChar(char.codePointAt(0) ?? 0))
		.join("")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll("\"", "&quot;")
		.replaceAll("'", "&#39;");
}

/** Chữ đánh dấu đầu/cuối khu vực của một phiên (tham số của macro anchor). */
export function retroSectionMarker(guildId: string, sessionId: number, edge: "start" | "end"): string
{
	return `ezbot-retro-${guildId}-${sessionId}-${edge}`;
}

function anchorMacro(marker: string): string
{
	return `<ac:structured-macro ac:name="anchor" ac:schema-version="1"><ac:parameter ac:name="">${escapeXml(marker)}</ac:parameter></ac:structured-macro>`;
}

/** Một ô của bảng: mỗi dòng chữ một đoạn <p>, dòng trống bị bỏ. */
function cell(text: string | null): string
{
	if (text === null) return "<td></td>";
	const paragraphs = text.split(/\r?\n/u).map(line => line.trim()).filter(line => line.length > 0).map(line => `<p>${escapeXml(line)}</p>`);
	return `<td>${paragraphs.join("")}</td>`;
}

/**
 * Khu vực retro bot quản lý (storage format), đặt ở cuối trang:
 * - macro anchor đánh dấu đầu (`ezbot-retro-<guild>-<phiên>-start`);
 * - tiêu đề `🤖 Retro từ Discord: <tên phiên>` và một dòng ghi chú "đừng sửa tay";
 * - bảng 5 cột đúng tiêu đề mẫu, mỗi phiếu một dòng, không có tên người viết;
 * - dòng "🏆 Tên sprint được chọn" khi đã chốt;
 * - macro anchor đánh dấu cuối.
 */
export function buildRetroSection(section: RetroDocSection): string
{
	const head = RETRO_FIELDS.map(field => `<th><p>${escapeXml(RETRO_FIELD_TITLES[field])}</p></th>`).join("");
	const rows = section.entries.length === 0
		? `<tr><td colspan="${RETRO_FIELDS.length}"><p><em>Chưa có câu trả lời.</em></p></td></tr>`
		: section.entries.map(entry => `<tr>${RETRO_FIELDS.map(field => cell(entry[field])).join("")}</tr>`).join("");
	const winner = section.winnerName === null ? "" : `<p>🏆 Tên sprint được chọn: <strong>${escapeXml(section.winnerName)}</strong></p>`;
	return [
		`<p>${anchorMacro(retroSectionMarker(section.guildId, section.sessionId, "start"))}</p>`,
		`<h2>🤖 Retro từ Discord: ${escapeXml(section.title)}</h2>`,
		"<p><em>Bot tự cập nhật từ Discord, đừng sửa tay trong khu vực này.</em></p>",
		`<table><tbody><tr>${head}</tr>${rows}</tbody></table>`,
		winner,
		`<p>${anchorMacro(retroSectionMarker(section.guildId, section.sessionId, "end"))}</p>`,
	].join("");
}

/**
 * Mẫu regex của macro anchor mang `marker`, chịu được thuộc tính Confluence tự thêm khi lưu (ac:macro-id, ac:schema-version, thứ tự
 * thuộc tính); có thể nằm trong một đoạn <p> riêng (khi đó lấy cả thẻ <p>).
 */
function anchorPattern(marker: string): string
{
	const escaped = marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
	const macro = `<ac:structured-macro\\b[^>]*\\bac:name=["']anchor["'][^>]*>(?:(?!</ac:structured-macro>)[\\s\\S])*?${escaped}`
		+ "(?:(?!</ac:structured-macro>)[\\s\\S])*?</ac:structured-macro>";
	return `(?:<p\\b[^>]*>\\s*${macro}\\s*</p>|${macro})`;
}

/**
 * Nội dung trang sau khi đặt `block` vào khu vực của phiên: có khu vực cũ (đủ dấu đầu và cuối) thì thay đúng khu vực đó, chưa có
 * thì thêm vào cuối trang. Mất dấu cuối thì ném ConfluenceError thay vì đoán, để không xoá nhầm phần người khác viết.
 */
export function replaceRetroSection(storage: string, guildId: string, sessionId: number, block: string): string
{
	const start = anchorPattern(retroSectionMarker(guildId, sessionId, "start"));
	const end = anchorPattern(retroSectionMarker(guildId, sessionId, "end"));
	const whole = new RegExp(`${start}[\\s\\S]*?${end}`, "u");
	if (whole.test(storage)) return storage.replace(whole, () => block);
	if (new RegExp(start, "u").test(storage)) throw new ConfluenceError(CONFLUENCE_BROKEN_SECTION);
	return `${storage}${block}`;
}

/** Client REST của Confluence Server/Data Center (API /rest/api/content). */
export class ConfluenceClient implements RetroDocWriter
{
	readonly baseUrl: string;
	private readonly host: string;

	constructor(
		private readonly config: ConfluenceConfig,
		private readonly fetchFn: ConfluenceFetch,
		private readonly timeoutMs = CONFLUENCE_TIMEOUT_MS,
	)
	{
		this.baseUrl = config.baseUrl;
		this.host = new URL(config.baseUrl).host;
	}

	/** ID trang của link: link phải cùng host với CONFLUENCE_BASE_URL (không bao giờ gửi token sang host khác) và có ID trang. */
	pageIdOf(docUrl: string): string
	{
		let url: URL;
		try
		{
			url = new URL(docUrl);
		}
		catch
		{
			throw new ConfluenceError(DOC_LINK_INVALID);
		}
		if (url.host !== this.host) throw new ConfluenceError(docLinkWrongHost(this.host));
		const pageId = confluencePageId(url);
		if (pageId === null) throw new ConfluenceError(DOC_LINK_NO_PAGE_ID);
		return pageId;
	}

	async writeRetroSection(docUrl: string, section: RetroDocSection): Promise<void>
	{
		const pageId = this.pageIdOf(docUrl);
		const block = buildRetroSection(section);
		for (let attempt = 1; attempt <= CONFLUENCE_MAX_ATTEMPTS; attempt++)
		{
			const page = await this.getPage(pageId);
			const storage = replaceRetroSection(page.storage, section.guildId, section.sessionId, block);
			if (await this.putPage(page, storage)) return;
		}
		throw new ConfluenceError(CONFLUENCE_CONFLICT);
	}

	private async getPage(pageId: string): Promise<ConfluencePage>
	{
		const response = await this.request("GET", `/rest/api/content/${pageId}?expand=body.storage,version`);
		if (!response.ok) throw confluenceStatusError(response.status);
		let json: unknown;
		try
		{
			json = await response.json();
		}
		catch
		{
			throw new ConfluenceError(CONFLUENCE_BAD_RESPONSE);
		}
		const page = toPage(json);
		if (!page) throw new ConfluenceError(CONFLUENCE_BAD_RESPONSE);
		return page;
	}

	/** Ghi nội dung mới với version + 1, giữ title và type. true nếu đã ghi; false nếu xung đột phiên bản (409). */
	private async putPage(page: ConfluencePage, storage: string): Promise<boolean>
	{
		const body = JSON.stringify({
			id: page.id,
			type: page.type,
			title: page.title,
			version: { number: page.version + 1, minorEdit: true, message: "Bot cập nhật bảng retro từ Discord" },
			body: { storage: { value: storage, representation: "storage" } },
		});
		const response = await this.request("PUT", `/rest/api/content/${page.id}`, body);
		if (response.status === 409) return false;
		if (!response.ok) throw confluenceStatusError(response.status);
		return true;
	}

	/** Một request tới Confluence: header Bearer, không theo redirect (token không đi sang địa chỉ khác), có thời gian chờ. */
	private async request(method: "GET" | "PUT", path: string, body?: string): Promise<Response>
	{
		const headers: Record<string, string> = { Authorization: `Bearer ${this.config.token}`, Accept: "application/json" };
		if (body !== undefined) headers["Content-Type"] = "application/json";
		try
		{
			return await this.fetchFn(`${this.baseUrl}${path}`, { method, headers, body, redirect: "error", signal: AbortSignal.timeout(this.timeoutMs) });
		}
		catch
		{
			throw new ConfluenceError(CONFLUENCE_NETWORK_ERROR);
		}
	}
}
