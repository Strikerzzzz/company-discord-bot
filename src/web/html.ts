// Dựng HTML an toàn cho trang web quản trị (DEC-039): mọi giá trị chèn vào template đều được escape, trừ khi đã là RawHtml
// (HTML do chính code dựng). Không bao giờ ghép chuỗi HTML bằng tay với dữ liệu từ Discord, database hay request.

const RAW_HTML = Symbol("rawHtml");

/** Đoạn HTML đã an toàn (dựng bằng `html` hoặc `raw` với chuỗi hằng). */
export interface RawHtml
{
	readonly [RAW_HTML]: true;
	readonly html: string;
}

/** Giá trị chèn được vào template: chuỗi và số được escape; null/undefined/false bị bỏ; mảng được nối liền. */
export type HtmlValue = string | number | RawHtml | null | undefined | false | readonly HtmlValue[];

export function isRawHtml(value: unknown): value is RawHtml
{
	return typeof value === "object" && value !== null && RAW_HTML in value;
}

/**
 * Đánh dấu một chuỗi là HTML an toàn. CHỈ dùng cho chuỗi hằng trong code (thẻ, CSS) hoặc HTML đã được escape; không bao giờ
 * dùng cho dữ liệu người dùng.
 */
export function raw(htmlText: string): RawHtml
{
	return { [RAW_HTML]: true, html: htmlText };
}

const ESCAPES: Readonly<Record<string, string>> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	"\"": "&quot;",
	"'": "&#39;",
};

/** Escape cho cả nội dung thẻ và giá trị thuộc tính (luôn đặt thuộc tính trong dấu nháy kép). */
export function escapeHtml(value: string): string
{
	return value.replace(/[&<>"']/gu, char => ESCAPES[char] ?? char);
}

function render(value: HtmlValue): string
{
	if (value === null || value === undefined || value === false) return "";
	if (Array.isArray(value)) return value.map(render).join("");
	if (isRawHtml(value)) return value.html;
	if (typeof value === "number") return escapeHtml(String(value));
	if (typeof value === "string") return escapeHtml(value);
	return "";
}

/** Template tag: `html\`<p>${userText}</p>\`` escape mọi giá trị chèn vào (trừ RawHtml), trả về RawHtml. */
export function html(strings: TemplateStringsArray, ...values: readonly HtmlValue[]): RawHtml
{
	let out = strings[0] ?? "";
	values.forEach((value, index) =>
	{
		out += render(value) + (strings[index + 1] ?? "");
	});
	return raw(out);
}

/** Nối nhiều đoạn HTML (mỗi phần tử được escape nếu không phải RawHtml). */
export function joinHtml(parts: readonly HtmlValue[], separator: RawHtml = raw("")): RawHtml
{
	return raw(parts.map(render).filter(part => part.length > 0).join(separator.html));
}
