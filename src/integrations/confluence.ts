// Ghi bảng retro vào Confluence nội bộ (DEC-049, ngoại lệ có phạm vi của luật protected số 3): chỉ đọc và sửa trang retro đã gắn,
// chỉ tới đúng host của CONFLUENCE_BASE_URL, chỉ trang thuộc các space trong CONFLUENCE_SPACE_KEYS, xác thực bằng Personal Access Token
// (Bearer). Dùng `fetch` có sẵn của Node, không thêm dependency. Không log gì ở đây; lỗi là ConfluenceError với thông báo tiếng Việt
// ngắn, không bao giờ chứa token hay nội dung phản hồi.
import type { ConfluenceConfig } from "../config";
import { confluencePageId, DOC_LINK_INVALID, DOC_LINK_NO_PAGE_ID, docLinkWrongHost } from "../modules/retro/docLink";
import { RETRO_FIELD_TITLES, RETRO_FIELDS, RetroColumns } from "../modules/retro/types";

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
export const CONFLUENCE_REDIRECT = "Confluence chuyển hướng request của bot (HTTP 3xx), nên bot không gửi tiếp: kiểm tra CONFLUENCE_BASE_URL "
	+ "(đúng địa chỉ gốc, https) và SSO/proxy của Confluence (Personal Access Token phải dùng được trực tiếp với REST API).";
export const CONFLUENCE_NO_SPACES = "Bot chưa cấu hình CONFLUENCE_SPACE_KEYS (danh sách space được phép ghi, ví dụ P2) nên từ chối ghi Confluence. "
	+ "Người phụ trách server chạy lại deploy/enable-confluence.sh để đặt danh sách space.";

/** Lỗi khi ghi Confluence; `message` hiển thị được cho người quản lý và lưu vào phiên. */
export class ConfluenceError extends Error
{
	constructor(message: string)
	{
		super(message);
		this.name = "ConfluenceError";
	}
}

/** Thông báo khi trang thuộc space không có trong CONFLUENCE_SPACE_KEYS. */
export function confluenceSpaceDenied(spaceKey: string, allowed: readonly string[]): string
{
	return `Trang này thuộc space "${spaceKey}", không nằm trong danh sách space bot được ghi (CONFLUENCE_SPACE_KEYS: ${allowed.join(", ")}). `
		+ "Hãy gắn link trang retro trong space được phép, hoặc nhờ người phụ trách server thêm space này.";
}

/** Dữ liệu khu vực retro bot ghi lên trang: ẩn danh, không có tên người viết. */
export interface RetroDocSection
{
	guildId: string;
	sessionId: number;
	title: string;
	/**
	 * Nội dung theo 5 cột (RetroService.columns): mỗi cột là danh sách ý trộn riêng, cột tên sprint đã bỏ trùng và theo chữ cái. Bảng có
	 * số hàng bằng cột dài nhất; một hàng không phải câu trả lời của một người.
	 */
	columns: RetroColumns;
	/** Tên sprint đã chốt; null nếu chưa chốt. */
	winnerName: string | null;
}

/** "written": đã ghi trang; "unchanged": khu vực trên trang đã đúng nội dung này nên không ghi lại (không tạo phiên bản mới). */
export type RetroDocWriteResult = "written" | "unchanged";

/** Nơi ghi bảng retro; tầng Discord và web nhận qua RetroActions để test thay bằng bản giả. */
export interface RetroDocWriter
{
	/** Địa chỉ gốc của Confluence (để hiển thị). */
	readonly baseUrl: string;
	/**
	 * Ghi (hoặc thay) khu vực của phiên ở cuối trang `docUrl`. Ghi nhiều lần không nhân đôi khu vực, không đụng phần khác của trang;
	 * khu vực không đổi thì không ghi. Ném ConfluenceError nếu lỗi.
	 */
	writeRetroSection(docUrl: string, section: RetroDocSection): Promise<RetroDocWriteResult>;
}

interface ConfluencePage
{
	id: string;
	type: string;
	title: string;
	version: number;
	storage: string;
	spaceKey: string;
}

function isRecord(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null;
}

/** Trang Confluence từ JSON của GET /rest/api/content/{id}?expand=space,body.storage,version; null nếu sai định dạng. */
function toPage(json: unknown): ConfluencePage | null
{
	if (!isRecord(json) || typeof json.id !== "string" || typeof json.type !== "string" || typeof json.title !== "string") return null;
	const version = isRecord(json.version) ? json.version.number : undefined;
	const storage = isRecord(json.body) && isRecord(json.body.storage) ? json.body.storage.value : undefined;
	const spaceKey = isRecord(json.space) ? json.space.key : undefined;
	if (typeof version !== "number" || !Number.isSafeInteger(version) || typeof storage !== "string" || typeof spaceKey !== "string") return null;
	return { id: json.id, type: json.type, title: json.title, version, storage, spaceKey };
}

/** Thông báo cho mã HTTP lỗi của Confluence (không kèm nội dung phản hồi). */
export function confluenceStatusError(status: number): ConfluenceError
{
	if (status >= 300 && status < 400) return new ConfluenceError(CONFLUENCE_REDIRECT);
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

/** Số hàng của bảng 5 cột: bằng cột dài nhất. */
export function retroRowCount(columns: RetroColumns): number
{
	return Math.max(0, ...RETRO_FIELDS.map(field => columns[field].length));
}

/**
 * Khu vực retro bot quản lý (storage format), đặt ở cuối trang:
 * - macro anchor đánh dấu đầu (`ezbot-retro-<guild>-<phiên>-start`);
 * - tiêu đề `🤖 Retro từ Discord: <tên phiên>` và một dòng ghi chú "đừng sửa tay";
 * - bảng 5 cột đúng tiêu đề mẫu, mỗi cột là danh sách ý trộn riêng, số hàng bằng cột dài nhất (cột ngắn hơn để ô trống), không có tên
 *   người viết; một hàng không phải câu trả lời của một người;
 * - dòng "🏆 Tên sprint được chọn" khi đã chốt;
 * - macro anchor đánh dấu cuối.
 */
export function buildRetroSection(section: RetroDocSection): string
{
	const head = RETRO_FIELDS.map(field => `<th><p>${escapeXml(RETRO_FIELD_TITLES[field])}</p></th>`).join("");
	const count = retroRowCount(section.columns);
	const rows = count === 0
		? `<tr><td colspan="${RETRO_FIELDS.length}"><p><em>Chưa có câu trả lời.</em></p></td></tr>`
		: Array.from({ length: count }, (_, row) => `<tr>${RETRO_FIELDS.map(field => cell(section.columns[field].at(row) ?? null)).join("")}</tr>`).join("");
	const winner = section.winnerName === null ? "" : `<p>🏆 Tên sprint được chọn: <strong>${escapeXml(section.winnerName)}</strong></p>`;
	return [
		`<p>${anchorMacro(retroSectionMarker(section.guildId, section.sessionId, "start"))}</p>`,
		`<h2>🤖 Retro từ Discord: ${escapeXml(section.title)}</h2>`,
		"<p><em>Bot tự cập nhật từ Discord, đừng sửa tay trong khu vực này. Mỗi cột trộn thứ tự riêng: một hàng không phải câu trả lời của một người.</em></p>",
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

/** Bỏ phần Confluence tự thêm vào thẻ mở macro khi lưu (ac:macro-id, thứ tự thuộc tính), để so khu vực cũ với khu vực mới. */
function canonicalSection(text: string): string
{
	return text.replace(/<ac:structured-macro\b[^>]*>/gu, "<ac:structured-macro>");
}

const LAYOUT_OPEN = /<ac:layout\b/u;
const LAYOUT_CLOSE = "</ac:layout>";

/**
 * Thêm khu vực vào cuối trang. Trang dùng layout (`<ac:layout>`): mọi nội dung phải nằm trong một layout-section, nên khu vực được đặt
 * trong một layout-section một cột mới, cuối layout (không chèn vào ô của người khác, không để chữ nằm ngoài layout). Trang không có
 * layout: nối vào cuối (kể cả sau đoạn `auto-cursor-target` của trình sửa).
 */
function appendSection(storage: string, block: string): string
{
	const close = storage.lastIndexOf(LAYOUT_CLOSE);
	if (close < 0 || !LAYOUT_OPEN.test(storage)) return `${storage}${block}`;
	const section = `<ac:layout-section ac:type="single"><ac:layout-cell>${block}</ac:layout-cell></ac:layout-section>`;
	return `${storage.slice(0, close)}${section}${storage.slice(close)}`;
}

/** Kết quả đặt khu vực của phiên vào nội dung trang. */
export interface RetroSectionPlan
{
	storage: string;
	/** false: khu vực cũ đã đúng `block` (sau khi bỏ phần Confluence tự thêm), không cần ghi. */
	changed: boolean;
}

/**
 * Nội dung trang sau khi đặt `block` vào khu vực của phiên: có khu vực cũ (đủ dấu đầu và cuối) thì thay đúng khu vực đó (giống hệt
 * thì báo không đổi), chưa có thì thêm vào cuối trang (appendSection). Mất dấu cuối thì ném ConfluenceError thay vì đoán, để không xoá
 * nhầm phần người khác viết.
 */
export function planRetroSection(storage: string, guildId: string, sessionId: number, block: string): RetroSectionPlan
{
	const start = anchorPattern(retroSectionMarker(guildId, sessionId, "start"));
	const end = anchorPattern(retroSectionMarker(guildId, sessionId, "end"));
	const found = new RegExp(`${start}[\\s\\S]*?${end}`, "u").exec(storage);
	if (found)
	{
		if (canonicalSection(found[0]) === canonicalSection(block)) return { storage, changed: false };
		return { storage: `${storage.slice(0, found.index)}${block}${storage.slice(found.index + found[0].length)}`, changed: true };
	}
	if (new RegExp(start, "u").test(storage)) throw new ConfluenceError(CONFLUENCE_BROKEN_SECTION);
	return { storage: appendSection(storage, block), changed: true };
}

/** Như planRetroSection, chỉ trả về nội dung trang. */
export function replaceRetroSection(storage: string, guildId: string, sessionId: number, block: string): string
{
	return planRetroSection(storage, guildId, sessionId, block).storage;
}

/** Đọc bỏ phần thân phản hồi (kể cả phản hồi lỗi) để trả kết nối về pool; lỗi khi huỷ thì bỏ qua. */
async function discardBody(response: Response): Promise<void>
{
	if (response.body === null || response.bodyUsed) return;
	try
	{
		await response.body.cancel();
	}
	catch
	{
		return;
	}
}

/** Phản hồi chuyển hướng: mã 3xx (redirect "manual"), hoặc phản hồi rỗng kiểu "opaqueredirect" của chuẩn fetch. */
function isRedirect(response: Response): boolean
{
	return response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400);
}

/** Client REST của Confluence Server/Data Center (API /rest/api/content). */
export class ConfluenceClient implements RetroDocWriter
{
	readonly baseUrl: string;
	private readonly host: string;
	private readonly spaceKeys: ReadonlySet<string>;

	constructor(
		private readonly config: ConfluenceConfig,
		private readonly fetchFn: ConfluenceFetch,
		private readonly timeoutMs = CONFLUENCE_TIMEOUT_MS,
	)
	{
		this.baseUrl = config.baseUrl;
		this.host = new URL(config.baseUrl).host;
		this.spaceKeys = new Set(config.spaceKeys.map(key => key.toUpperCase()));
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

	async writeRetroSection(docUrl: string, section: RetroDocSection): Promise<RetroDocWriteResult>
	{
		const pageId = this.pageIdOf(docUrl);
		if (this.spaceKeys.size === 0) throw new ConfluenceError(CONFLUENCE_NO_SPACES);
		const block = buildRetroSection(section);
		for (let attempt = 1; attempt <= CONFLUENCE_MAX_ATTEMPTS; attempt++)
		{
			const page = await this.getPage(pageId);
			if (!this.spaceKeys.has(page.spaceKey.toUpperCase())) throw new ConfluenceError(confluenceSpaceDenied(page.spaceKey, this.config.spaceKeys));
			const plan = planRetroSection(page.storage, section.guildId, section.sessionId, block);
			if (!plan.changed) return "unchanged";
			if (await this.putPage(page, plan.storage)) return "written";
		}
		throw new ConfluenceError(CONFLUENCE_CONFLICT);
	}

	private async getPage(pageId: string): Promise<ConfluencePage>
	{
		const response = await this.request("GET", `/rest/api/content/${pageId}?expand=space,body.storage,version`);
		if (!response.ok)
		{
			await discardBody(response);
			throw confluenceStatusError(response.status);
		}
		let json: unknown;
		try
		{
			json = await response.json();
		}
		catch
		{
			await discardBody(response);
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
		await discardBody(response);
		if (response.status === 409) return false;
		if (!response.ok) throw confluenceStatusError(response.status);
		return true;
	}

	/**
	 * Một request tới Confluence: header Bearer, có thời gian chờ, không theo redirect (redirect "manual": token không đi sang địa chỉ
	 * khác; phản hồi 3xx thành lỗi CONFLUENCE_REDIRECT rõ ràng thay vì "lỗi mạng").
	 */
	private async request(method: "GET" | "PUT", path: string, body?: string): Promise<Response>
	{
		const headers: Record<string, string> = { Authorization: `Bearer ${this.config.token}`, Accept: "application/json" };
		if (body !== undefined) headers["Content-Type"] = "application/json";
		let response: Response;
		try
		{
			response = await this.fetchFn(`${this.baseUrl}${path}`, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(this.timeoutMs) });
		}
		catch
		{
			throw new ConfluenceError(CONFLUENCE_NETWORK_ERROR);
		}
		if (isRedirect(response))
		{
			await discardBody(response);
			throw new ConfluenceError(CONFLUENCE_REDIRECT);
		}
		return response;
	}
}
