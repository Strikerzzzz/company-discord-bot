// Đăng nhập bằng tài khoản Discord (OAuth2 authorization code, scope `identify`, DEC-039). Chỉ gọi tới Discord API. Không lưu
// access token: đổi code lấy token, hỏi `users/@me` để biết người đăng nhập là ai, rồi bỏ token.
import { UserError } from "../shared/errors";

const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const DISCORD_API = "https://discord.com/api/v10";
const REQUEST_TIMEOUT_MS = 10_000;

export const LOGIN_FAILED = "Không đăng nhập được bằng Discord. Hãy thử lại; nếu vẫn lỗi, báo người vận hành bot kiểm tra cấu hình web.";

/** Người đăng nhập theo Discord. */
export interface DiscordIdentity
{
	id: string;
	/** Tên hiển thị: global name nếu có, không thì username. */
	displayName: string;
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null;
}

export class DiscordOAuth
{
	/**
	 * @param fetchFn fetch thật (Node) hoặc hàm giả khi test.
	 * @param clientId Application ID; hàm vì chỉ biết sau khi bot đăng nhập (null = chưa sẵn sàng).
	 * @param clientSecret Client Secret; không bao giờ đưa vào log hay lỗi.
	 * @param redirectUri `<WEB_BASE_URL>/auth/callback`, phải khớp redirect đã đăng ký trên Developer Portal.
	 */
	constructor(
		private readonly fetchFn: FetchFn,
		private readonly clientId: () => string | null,
		private readonly clientSecret: string,
		readonly redirectUri: string,
	)
	{}

	/** URL trang cho phép của Discord; `state` chống giả mạo đăng nhập (so với cookie khi quay về). */
	authorizeUrl(state: string): string
	{
		const params = new URLSearchParams({
			response_type: "code",
			client_id: this.requireClientId(),
			scope: "identify",
			redirect_uri: this.redirectUri,
			state,
			prompt: "none",
		});
		return `${DISCORD_AUTHORIZE_URL}?${params.toString()}`;
	}

	/** Đổi `code` lấy danh tính người đăng nhập. UserError(LOGIN_FAILED) khi Discord từ chối hoặc trả dữ liệu lạ. */
	async identify(code: string): Promise<DiscordIdentity>
	{
		const clientId = this.requireClientId();
		const tokenResponse = await this.fetchFn(`${DISCORD_API}/oauth2/token`, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Authorization: `Basic ${Buffer.from(`${clientId}:${this.clientSecret}`).toString("base64")}`,
			},
			body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: this.redirectUri }).toString(),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (!tokenResponse.ok) throw new UserError(LOGIN_FAILED);
		const token: unknown = await tokenResponse.json();
		if (!isRecord(token) || typeof token.access_token !== "string" || token.access_token.length === 0) throw new UserError(LOGIN_FAILED);

		const userResponse = await this.fetchFn(`${DISCORD_API}/users/@me`, {
			headers: { Authorization: `Bearer ${token.access_token}` },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (!userResponse.ok) throw new UserError(LOGIN_FAILED);
		const user: unknown = await userResponse.json();
		if (!isRecord(user) || typeof user.id !== "string" || !/^\d{17,20}$/u.test(user.id) || typeof user.username !== "string")
		{
			throw new UserError(LOGIN_FAILED);
		}
		const globalName = typeof user.global_name === "string" && user.global_name.length > 0 ? user.global_name : null;
		return { id: user.id, displayName: globalName ?? user.username };
	}

	private requireClientId(): string
	{
		const id = this.clientId();
		if (!id) throw new UserError("Bot đang khởi động, chưa đăng nhập được. Hãy thử lại sau ít giây.");
		return id;
	}
}
