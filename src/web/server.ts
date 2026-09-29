// Máy chủ web quản trị (DEC-039): bộ xử lý thuần `createWebHandler` (định tuyến, đăng nhập Discord, kiểm tra quyền admin ở mỗi
// request, CSRF, flash) và phần nối với node:http `startWebServer`. Chạy trong chính process của bot.
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { Guild, GuildMember, PermissionFlagsBits } from "discord.js";
import { isAdmin } from "../modules/guild-config/permissions";
import { UserError } from "../shared/errors";
import { logger } from "../shared/logger";
import { BASE_CSS } from "./assets";
import { html } from "./html";
import {
	MAX_FORM_BYTES,
	parseCookies,
	RateLimiter,
	redirect,
	safeEqual,
	SECURITY_HEADERS,
	serializeCookie,
	textResponse,
	WebRequest,
	WebResponse,
} from "./http";
import { renderPlainPage } from "./layout";
import { DiscordIdentity, DiscordOAuth, LOGIN_FAILED } from "./oauth";
import { PAGE_MODULES } from "./pages";
import { randomToken, SESSION_TTL_MS, SessionStore, WebSession } from "./session";
import { GuildPageContext, GuildRoute, PageModule, WebDeps } from "./types";

export const SESSION_COOKIE = "sid";
export const STATE_COOKIE = "oauth_state";
const STATE_TTL_SECONDS = 600;
/** `/g/<guildId>` và phần đường dẫn con (chỉ chữ thường, số, gạch ngang). */
const GUILD_PATH = /^\/g\/(\d{17,20})((?:\/[a-z0-9-]+)*)$/u;
/** Mã code OAuth2 của Discord: chữ và số, độ dài hợp lý. */
const OAUTH_CODE = /^[A-Za-z0-9]{10,100}$/u;

/** Lý do quay về trang đăng nhập; chỉ nhận các mã này (không phản chiếu chữ tuỳ ý từ URL). */
const LOGIN_MESSAGES: Readonly<Record<string, string>> = {
	denied: "Bạn đã huỷ đăng nhập trên Discord.",
	expired: "Lượt đăng nhập đã hết hạn hoặc không hợp lệ. Hãy bấm đăng nhập lại.",
	failed: LOGIN_FAILED,
	noadmin: "Tài khoản Discord này không có quyền admin bot ở server nào bot đang phục vụ (cần Manage Server hoặc role admin bot).",
	busy: "Bạn thao tác quá nhanh. Hãy đợi một phút rồi thử lại.",
	starting: "Bot đang khởi động, chưa đăng nhập được. Hãy thử lại sau ít giây.",
	out: "Bạn đã đăng xuất.",
};

export interface WebHandler
{
	handle(req: WebRequest): Promise<WebResponse>;
	readonly sessions: SessionStore;
}

function withSecurityHeaders(response: WebResponse): WebResponse
{
	return { ...response, headers: { ...SECURITY_HEADERS, ...response.headers } };
}

function messagePage(title: string, message: string, status: number): WebResponse
{
	return renderPlainPage(title, html`<div class="login"><div class="card"><h1>${title}</h1><p>${message}</p>
<p><a class="btn" href="/">Về trang chính</a></p></div></div>`, status);
}

function loginPage(reason: string | null): WebResponse
{
	const message = reason === null ? null : LOGIN_MESSAGES[reason] ?? null;
	return renderPlainPage("Đăng nhập", html`<div class="login"><div class="card">
<h1>⚙️ Quản trị bot</h1>
<p class="lead">Chỉ admin bot của server (có quyền Manage Server hoặc role admin bot) mới vào được.</p>
${message ? html`<div class="flash ${reason === "out" ? "ok" : "error"}">${message}</div>` : ""}
<p><a class="btn btn-discord" href="/auth/login">Đăng nhập bằng Discord</a></p>
<p class="muted">Bạn đăng nhập trên trang của Discord; bot chỉ biết tài khoản Discord của bạn là ai, không thấy mật khẩu.</p>
</div></div>`);
}

/** Lấy lại thông tin thành viên từ Discord (không dùng cache, để quyền luôn mới nhất); null nếu không còn trong server hoặc lỗi. */
async function fetchMember(guild: Guild, userId: string): Promise<GuildMember | null>
{
	try
	{
		return await guild.members.fetch({ user: userId, force: true });
	}
	catch
	{
		return null;
	}
}

export function createWebHandler(deps: WebDeps, modules: readonly PageModule[] = PAGE_MODULES): WebHandler
{
	const sessions = new SessionStore(deps.clock);
	const oauth = new DiscordOAuth(
		deps.fetch,
		() => deps.client.application?.id ?? deps.client.user?.id ?? null,
		deps.config.clientSecret,
		`${deps.config.baseUrl}/auth/callback`,
	);
	const authLimiter = new RateLimiter(30, 60_000);
	const postLimiter = new RateLimiter(120, 60_000);
	const routes: readonly GuildRoute[] = modules.flatMap(module => module.routes);
	const css = [BASE_CSS, ...modules.map(module => module.css ?? "")].join("\n");
	const secure = deps.config.baseUrl.startsWith("https:");
	const expectedHost = new URL(deps.config.baseUrl).host.toLowerCase();

	function isAdminMember(guild: Guild, member: GuildMember): boolean
	{
		return isAdmin(
			{ hasManageGuild: member.permissions.has(PermissionFlagsBits.ManageGuild), roleIds: [...member.roles.cache.keys()] },
			deps.services.guildConfig.getSettings(guild.id),
		);
	}

	function servedGuild(guildId: string): Guild | null
	{
		return deps.guildIds.includes(guildId) ? deps.client.guilds.cache.get(guildId) ?? null : null;
	}

	function clearCookie(name: string, path = "/"): string
	{
		return serializeCookie(name, "", { maxAgeSeconds: 0, path, secure });
	}

	function home(req: WebRequest, session: WebSession | null): WebResponse
	{
		if (!session) return loginPage(req.query.get("loi"));
		const first = deps.guildIds.find(id => deps.client.guilds.cache.has(id));
		if (!first) return messagePage("Bot đang khởi động", "Bot chưa sẵn sàng hoặc không còn ở server nào. Hãy thử lại sau ít giây.", 503);
		return redirect(`/g/${first}`);
	}

	function login(req: WebRequest): WebResponse
	{
		if (!authLimiter.allow(`ip:${req.ip}`, deps.clock.now())) return redirect("/?loi=busy");
		const state = randomToken();
		let location: string;
		try
		{
			location = oauth.authorizeUrl(state);
		}
		catch
		{
			return redirect("/?loi=starting");
		}
		const response = redirect(location);
		response.cookies.push(serializeCookie(STATE_COOKIE, state, { maxAgeSeconds: STATE_TTL_SECONDS, path: "/auth", secure }));
		return response;
	}

	async function callback(req: WebRequest): Promise<WebResponse>
	{
		const fail = (reason: string): WebResponse =>
		{
			const response = redirect(`/?loi=${reason}`);
			response.cookies.push(clearCookie(STATE_COOKIE, "/auth"));
			return response;
		};
		if (!authLimiter.allow(`ip:${req.ip}`, deps.clock.now())) return fail("busy");
		if (req.query.has("error")) return fail("denied");
		const state = req.query.get("state") ?? "";
		const expected = req.cookies.get(STATE_COOKIE) ?? "";
		const code = req.query.get("code") ?? "";
		if (expected.length === 0 || !safeEqual(state, expected) || !OAUTH_CODE.test(code)) return fail("expired");

		let identity: DiscordIdentity;
		try
		{
			identity = await oauth.identify(code);
		}
		catch (error)
		{
			if (!(error instanceof UserError)) logger.warn("Đăng nhập web: không đổi được mã OAuth2 với Discord:", error);
			return fail("failed");
		}

		let allowedGuild: string | null = null;
		for (const guildId of deps.guildIds)
		{
			const guild = servedGuild(guildId);
			const member = guild ? await fetchMember(guild, identity.id) : null;
			if (guild && member && isAdminMember(guild, member))
			{
				allowedGuild = guildId;
				break;
			}
		}
		if (allowedGuild === null)
		{
			logger.info(`Đăng nhập web bị từ chối: người dùng "${identity.id}" không phải admin bot ở server nào.`);
			return fail("noadmin");
		}

		const { token } = sessions.create(identity.id, identity.displayName);
		logger.info(`Đăng nhập web: người dùng "${identity.id}".`);
		const response = redirect(`/g/${allowedGuild}`);
		response.cookies.push(serializeCookie(SESSION_COOKIE, token, { maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000), secure }));
		response.cookies.push(clearCookie(STATE_COOKIE, "/auth"));
		return response;
	}

	/** Kiểm tra form POST: có form, token CSRF đúng, Origin (nếu trình duyệt gửi) là chính trang. */
	function postAllowed(req: WebRequest, session: WebSession): boolean
	{
		const origin = req.headers.origin;
		if (origin !== undefined && origin !== deps.config.baseUrl) return false;
		const token = req.form?.get("_csrf") ?? "";
		return token.length > 0 && safeEqual(token, session.csrf);
	}

	function logout(req: WebRequest, session: WebSession | null): WebResponse
	{
		if (session && !postAllowed(req, session)) return messagePage("Không hợp lệ", "Yêu cầu đăng xuất không hợp lệ. Hãy tải lại trang rồi thử lại.", 403);
		sessions.destroy(req.cookies.get(SESSION_COOKIE));
		const response = redirect("/?loi=out");
		response.cookies.push(clearCookie(SESSION_COOKIE));
		return response;
	}

	async function guildRoute(req: WebRequest, session: WebSession | null, guildId: string, subpath: string): Promise<WebResponse>
	{
		if (!session) return req.method === "GET" ? redirect("/") : messagePage("Chưa đăng nhập", "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.", 403);
		const guild = servedGuild(guildId);
		if (!guild) return messagePage("Không tìm thấy", "Bot không phục vụ server này, hoặc đang khởi động.", 404);
		const member = await fetchMember(guild, session.userId);
		if (!member || !isAdminMember(guild, member))
		{
			return messagePage("Không có quyền", "Tài khoản của bạn không (còn) có quyền admin bot ở server này.", 403);
		}
		if (req.method === "POST")
		{
			if (!postLimiter.allow(`user:${session.userId}`, deps.clock.now()))
			{
				return messagePage("Quá nhanh", "Bạn thao tác quá nhanh. Hãy đợi một phút rồi thử lại.", 429);
			}
			if (!postAllowed(req, session))
			{
				return messagePage("Không hợp lệ", "Form đã cũ hoặc không hợp lệ. Hãy tải lại trang rồi thử lại.", 403);
			}
		}
		const matched = routes.find(entry => entry.method === req.method && entry.path === subpath);
		if (!matched) return messagePage("Không tìm thấy", "Trang này không tồn tại.", 404);

		const ctx: GuildPageContext = { req, deps, session, guild, member, actorId: session.userId };
		try
		{
			return await matched.handler(ctx);
		}
		catch (error)
		{
			if (!(error instanceof UserError)) logger.error(`Lỗi trang web ${req.method} ${req.path}:`, error);
			const message = error instanceof UserError ? error.message : "Đã có lỗi xảy ra. Vui lòng thử lại sau.";
			if (req.method === "POST")
			{
				session.flash = { kind: "error", text: message };
				return redirect(`/g/${guildId}${subpath}`);
			}
			return error instanceof UserError ? messagePage("Không thực hiện được", message, 400) : messagePage("Lỗi", message, 500);
		}
	}

	async function route(req: WebRequest): Promise<WebResponse>
	{
		if (req.method === "GET" && req.path === "/healthz") return textResponse("ok");
		if ((req.headers.host ?? "").toLowerCase() !== expectedHost)
		{
			return textResponse("Sai địa chỉ truy cập: hãy mở trang bằng địa chỉ đã cấu hình (WEB_BASE_URL).", 421);
		}
		if (req.method === "GET" && req.path === "/static/app.css") return textResponse(css, 200, "text/css; charset=utf-8");

		const session = sessions.get(req.cookies.get(SESSION_COOKIE));
		if (req.method === "GET" && req.path === "/") return home(req, session);
		if (req.method === "GET" && req.path === "/auth/login") return login(req);
		if (req.method === "GET" && req.path === "/auth/callback") return callback(req);
		if (req.method === "POST" && req.path === "/auth/logout") return logout(req, session);
		const match = GUILD_PATH.exec(req.path);
		if (match?.[1] !== undefined) return guildRoute(req, session, match[1], match[2] ?? "");
		return messagePage("Không tìm thấy", "Trang này không tồn tại.", 404);
	}

	return {
		sessions,
		async handle(req: WebRequest): Promise<WebResponse>
		{
			try
			{
				return withSecurityHeaders(await route(req));
			}
			catch (error)
			{
				logger.error(`Lỗi web ${req.method} ${req.path}:`, error);
				return withSecurityHeaders(messagePage("Lỗi", "Đã có lỗi xảy ra. Vui lòng thử lại sau.", 500));
			}
		},
	};
}

// ---------- Nối với node:http ----------

class HttpError extends Error
{
	constructor(readonly status: number, message: string)
	{
		super(message);
	}
}

function headerRecord(message: IncomingMessage): Record<string, string | undefined>
{
	const headers: Record<string, string | undefined> = {};
	for (const [name, value] of Object.entries(message.headers))
	{
		headers[name] = Array.isArray(value) ? value.join(", ") : value;
	}
	return headers;
}

async function readBody(message: IncomingMessage, limit: number): Promise<string>
{
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of message)
	{
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
		size += buffer.length;
		if (size > limit) throw new HttpError(413, "Dữ liệu gửi lên quá lớn.");
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}

/** Đọc request của node:http thành WebRequest; chỉ nhận GET và POST, POST chỉ nhận form urlencoded. */
export async function readRequest(message: IncomingMessage): Promise<WebRequest>
{
	const method = message.method ?? "GET";
	if (method !== "GET" && method !== "POST") throw new HttpError(405, "Phương thức không được hỗ trợ.");
	const url = new URL(message.url ?? "/", "http://localhost");
	const headers = headerRecord(message);
	let form: URLSearchParams | null = null;
	if (method === "POST")
	{
		const type = (headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
		if (type !== "application/x-www-form-urlencoded") throw new HttpError(415, "Chỉ nhận dữ liệu form.");
		form = new URLSearchParams(await readBody(message, MAX_FORM_BYTES));
	}
	return {
		method,
		path: url.pathname,
		query: url.searchParams,
		headers,
		cookies: parseCookies(headers.cookie),
		form,
		ip: message.socket.remoteAddress ?? "",
	};
}

function send(res: ServerResponse, response: WebResponse): void
{
	res.statusCode = response.status;
	for (const [name, value] of Object.entries(response.headers)) res.setHeader(name, value);
	if (response.cookies.length > 0) res.setHeader("Set-Cookie", response.cookies);
	res.end(response.body);
}

async function serve(handler: WebHandler, message: IncomingMessage, res: ServerResponse): Promise<void>
{
	let request: WebRequest;
	try
	{
		request = await readRequest(message);
	}
	catch (error)
	{
		const status = error instanceof HttpError ? error.status : 400;
		const text = error instanceof HttpError ? error.message : "Yêu cầu không hợp lệ.";
		// Body chưa đọc hết (quá lớn, sai loại): đóng kết nối để client không gửi request kế tiếp trên kết nối dở dang.
		const response = withSecurityHeaders(textResponse(text, status));
		response.headers.Connection = "close";
		send(res, response);
		return;
	}
	send(res, await handler.handle(request));
}

export interface WebServerHandle
{
	/** Cổng thật đang lắng nghe (hữu ích khi cấu hình cổng 0 trong test). */
	port: number;
	close(): Promise<void>;
}

/** Mở máy chủ HTTP của web quản trị theo `deps.config` (cổng, địa chỉ). */
export async function startWebServer(deps: WebDeps, modules: readonly PageModule[] = PAGE_MODULES): Promise<WebServerHandle>
{
	const handler = createWebHandler(deps, modules);
	const server = createServer((message, res) =>
	{
		serve(handler, message, res).catch((error: unknown) =>
		{
			logger.error("Lỗi khi trả lời request web:", error);
			if (!res.headersSent) send(res, withSecurityHeaders(textResponse("Lỗi máy chủ.", 500)));
			else res.destroy();
		});
	});
	server.requestTimeout = 15_000;
	server.headersTimeout = 10_000;
	server.keepAliveTimeout = 5_000;
	await new Promise<void>((resolve, reject) =>
	{
		server.once("error", reject);
		server.listen(deps.config.port, deps.config.host, () =>
		{
			server.off("error", reject);
			resolve();
		});
	});
	const address = server.address();
	const port = typeof address === "object" && address !== null ? address.port : deps.config.port;
	return {
		port,
		close: () => new Promise<void>(resolve =>
		{
			server.close(() => resolve());
			server.closeAllConnections();
		}),
	};
}
