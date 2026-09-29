// Kiểu request/response và tiện ích HTTP thuần cho trang web quản trị (DEC-039). Không phụ thuộc node:http để test được
// bằng dữ liệu giả; phần nối với socket nằm ở server.ts.
import { timingSafeEqual } from "node:crypto";
import { RawHtml } from "./html";

/** Request đã được đọc và chuẩn hoá. */
export interface WebRequest
{
	method: string;
	/** Đường dẫn đã bỏ query, luôn bắt đầu bằng "/". */
	path: string;
	query: URLSearchParams;
	/** Header viết thường. */
	headers: Readonly<Record<string, string | undefined>>;
	cookies: ReadonlyMap<string, string>;
	/** Form (application/x-www-form-urlencoded) của request POST; null với GET. */
	form: URLSearchParams | null;
	/** Địa chỉ IP phía client (để giới hạn tần suất); "" nếu không rõ. */
	ip: string;
}

export interface WebResponse
{
	status: number;
	headers: Record<string, string>;
	/** Các header Set-Cookie. */
	cookies: string[];
	body: string;
}

/** Kích thước tối đa của body form (byte). Form lớn nhất (trang kênh) vẫn dưới mức này nhiều. */
export const MAX_FORM_BYTES = 256 * 1024;

/**
 * Header bảo mật cho mọi response: CSP chặt (không script, chỉ CSS và ảnh của chính trang, avatar từ CDN Discord; form chỉ gửi
 * về chính trang), không cho nhúng iframe, không đoán MIME, không cache. Referrer-Policy `same-origin`: không gửi Referer ra
 * ngoài; với form trong trang, trình duyệt vẫn gửi Origin thật (policy `no-referrer` làm Origin thành "null").
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
	"Content-Security-Policy": "default-src 'none'; style-src 'self'; img-src 'self' https://cdn.discordapp.com; form-action 'self'; "
		+ "frame-ancestors 'none'; base-uri 'none'",
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
	"Referrer-Policy": "same-origin",
	"Cache-Control": "no-store",
};

export function htmlResponse(body: RawHtml, status = 200): WebResponse
{
	return { status, headers: { "Content-Type": "text/html; charset=utf-8" }, cookies: [], body: `<!doctype html>\n${body.html}` };
}

export function textResponse(body: string, status = 200, contentType = "text/plain; charset=utf-8"): WebResponse
{
	return { status, headers: { "Content-Type": contentType }, cookies: [], body };
}

/** Chuyển hướng (mặc định 303 để trình duyệt GET lại sau khi POST). Chỉ nhận đường dẫn nội bộ hoặc URL do code dựng. */
export function redirect(location: string, status = 303): WebResponse
{
	return { status, headers: { Location: location }, cookies: [], body: "" };
}

/** Đọc header Cookie thành map; giá trị lỗi mã hoá thì bỏ qua. */
export function parseCookies(header: string | undefined): Map<string, string>
{
	const cookies = new Map<string, string>();
	if (!header) return cookies;
	for (const part of header.split(";"))
	{
		const index = part.indexOf("=");
		if (index <= 0) continue;
		const name = part.slice(0, index).trim();
		try
		{
			cookies.set(name, decodeURIComponent(part.slice(index + 1).trim()));
		}
		catch
		{
			continue;
		}
	}
	return cookies;
}

export interface CookieOptions
{
	maxAgeSeconds: number;
	path?: string;
	/** Chỉ gửi qua HTTPS (bật khi WEB_BASE_URL là https). */
	secure: boolean;
}

/** Set-Cookie luôn HttpOnly và SameSite=Lax (cookie đi theo khi Discord chuyển hướng về /auth/callback). */
export function serializeCookie(name: string, value: string, options: CookieOptions): string
{
	const parts = [`${name}=${encodeURIComponent(value)}`, `Max-Age=${options.maxAgeSeconds}`, `Path=${options.path ?? "/"}`, "HttpOnly", "SameSite=Lax"];
	if (options.secure) parts.push("Secure");
	return parts.join("; ");
}

/** So sánh hai chuỗi bí mật (CSRF token, OAuth state) không lộ thời gian. */
export function safeEqual(a: string, b: string): boolean
{
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Khoá giới hạn tần suất theo IP: IPv4 (kể cả dạng IPv6-mapped `::ffff:a.b.c.d`) giữ nguyên; IPv6 gộp theo /64, để một máy
 * không lách giới hạn bằng cách xoay địa chỉ trong dải của mình.
 */
export function rateLimitKey(ip: string): string
{
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu.exec(ip);
	if (mapped?.[1]) return `ip:${mapped[1]}`;
	if (!ip.includes(":")) return `ip:${ip}`;
	const [head = "", tail = ""] = ip.toLowerCase().split("::");
	const left = head.length > 0 ? head.split(":") : [];
	const right = tail.length > 0 ? tail.split(":") : [];
	const groups = ip.includes("::") ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
	return `ip6:${groups.slice(0, 4).map(group => group.replace(/^0+(?=.)/u, "")).join(":")}`;
}

/** Giới hạn tần suất đơn giản theo khoá (IP, phiên): tối đa `limit` lần trong mỗi cửa sổ `windowMs`. */
export class RateLimiter
{
	private readonly hits = new Map<string, { count: number; resetAt: number }>();

	constructor(private readonly limit: number, private readonly windowMs: number, private readonly maxKeys = 10_000)
	{}

	/** true nếu còn được phép (và tính thêm một lần). Map đầy thì bỏ khoá cũ nhất, không chặn nhầm khoá mới. */
	allow(key: string, now: number): boolean
	{
		const entry = this.hits.get(key);
		if (!entry || entry.resetAt <= now)
		{
			if (this.hits.size >= this.maxKeys) this.sweep(now);
			while (this.hits.size >= this.maxKeys)
			{
				const oldest = this.hits.keys().next().value;
				if (oldest === undefined) break;
				this.hits.delete(oldest);
			}
			this.hits.delete(key);
			this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
			return true;
		}
		entry.count += 1;
		return entry.count <= this.limit;
	}

	private sweep(now: number): void
	{
		for (const [key, entry] of this.hits)
		{
			if (entry.resetAt <= now) this.hits.delete(key);
		}
	}
}
