// Phiên đăng nhập của trang web quản trị (DEC-039): lưu trong bộ nhớ của process, khởi động lại bot thì phải đăng nhập lại.
// Cookie chỉ chứa token ngẫu nhiên; map lưu theo SHA-256 của token nên không giữ token gốc.
import { createHash, randomBytes } from "node:crypto";
import { Clock } from "../shared/clock";

/** Thời gian sống của một phiên (tuyệt đối, không gia hạn). */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
/** Số phiên tối đa giữ cùng lúc; vượt thì bỏ phiên cũ nhất. */
const MAX_SESSIONS = 500;

export type FlashKind = "ok" | "error";

/** Thông báo hiển thị một lần ở trang kế tiếp (sau khi POST rồi chuyển hướng). `text` dùng markdown/mention kiểu Discord. */
export interface Flash
{
	kind: FlashKind;
	text: string;
}

export interface WebSession
{
	/** Discord user ID của người đăng nhập; là actorId khi ghi audit. */
	userId: string;
	/** Tên hiển thị lúc đăng nhập (global name hoặc username). */
	displayName: string;
	/** Token chống CSRF, đặt trong mọi form POST (`_csrf`). */
	csrf: string;
	createdAt: number;
	expiresAt: number;
	flash: Flash | null;
}

function hashToken(token: string): string
{
	return createHash("sha256").update(token).digest("hex");
}

export function randomToken(): string
{
	return randomBytes(32).toString("base64url");
}

export class SessionStore
{
	private readonly sessions = new Map<string, WebSession>();

	constructor(private readonly clock: Clock, private readonly ttlMs = SESSION_TTL_MS)
	{}

	/** Tạo phiên mới; trả về token đặt vào cookie (chỉ trả một lần, store không giữ token gốc). */
	create(userId: string, displayName: string): { token: string; session: WebSession }
	{
		this.sweep();
		while (this.sessions.size >= MAX_SESSIONS)
		{
			const oldest = this.sessions.keys().next().value;
			if (oldest === undefined) break;
			this.sessions.delete(oldest);
		}
		const token = randomToken();
		const now = this.clock.now();
		const session: WebSession = { userId, displayName, csrf: randomToken(), createdAt: now, expiresAt: now + this.ttlMs, flash: null };
		this.sessions.set(hashToken(token), session);
		return { token, session };
	}

	/** Phiên còn hạn của token; hết hạn thì xoá và trả về null. */
	get(token: string | undefined): WebSession | null
	{
		if (!token) return null;
		const key = hashToken(token);
		const session = this.sessions.get(key);
		if (!session) return null;
		if (session.expiresAt <= this.clock.now())
		{
			this.sessions.delete(key);
			return null;
		}
		return session;
	}

	destroy(token: string | undefined): void
	{
		if (token) this.sessions.delete(hashToken(token));
	}

	get size(): number
	{
		return this.sessions.size;
	}

	private sweep(): void
	{
		const now = this.clock.now();
		for (const [key, session] of this.sessions)
		{
			if (session.expiresAt <= now) this.sessions.delete(key);
		}
	}
}
