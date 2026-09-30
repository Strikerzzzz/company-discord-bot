// Máy chủ web quản trị (DEC-039): bộ xử lý thuần `createWebHandler` (định tuyến, đăng nhập Discord, kiểm tra quyền admin ở mỗi
// request, CSRF, flash) và phần nối với node:http `startWebServer`. Chạy trong chính process của bot.
import { createHash } from "node:crypto";
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
	rateLimitKey,
	redirect,
	safeEqual,
	SECURITY_HEADERS,
	serializeCookie,
	textResponse,
	WebRequest,
	WebResponse,
} from "./http";
import { DISCORD_UNAVAILABLE, DiscordUnavailableError, fetchMember } from "./discord";
import { renderPlainPage } from "./layout";
import { DiscordIdentity, DiscordOAuth, LOGIN_FAILED } from "./oauth";
import { PAGE_MODULES } from "./pages";
import { randomToken, SESSION_TTL_MS, SessionStore, WebSession } from "./session";
import { GuildPageContext, GuildRoute, PageModule, WebDeps } from "./types";

/**
 * Tên cookie có tiền tố riêng của bot: server dùng chung với dịch vụ khác, mà trình duyệt gửi cookie theo host chứ không theo
 * cổng, nên tên chung như "sid" dễ bị app khác đọc nhầm hoặc ghi đè (review bảo mật Phase 16). Với HTTPS thêm tiền tố `__Host-`.
 */
export const SESSION_COOKIE = "ezbot_sid";
export const STATE_COOKIE = "ezbot_oauth_state";
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
	discord: "Không kiểm tra được quyền với Discord (Discord đang lỗi hoặc mạng chậm). Hãy thử lại sau ít phút.",
	gone: "Tài khoản của bạn không còn quyền admin bot ở server nào; phiên đăng nhập đã bị huỷ.",
	out: "Bạn đã đăng xuất.",
};

/**
 * POST trùng (cùng người, đường dẫn và nội dung form, không tính token CSRF) trong khoảng này dùng lại kết quả của lần đầu thay
 * vì chạy lại: trang không có JavaScript để khoá nút, nên bấm đúp "Cộng XP" không được cộng hai lần (review Phase 17).
 */
export const DUPLICATE_POST_WINDOW_MS = 5000;
const MAX_RECENT_POSTS = 1000;

/** Trang quay về do route chỉ định (`GuildRoute.errorRedirect`): đường dẫn con chữ thường, kèm query đơn giản (không ký tự lạ). */
const ERROR_REDIRECT = /^(?:\/[a-z0-9-]+)*(?:\?[A-Za-z0-9=&%._~-]*)?$/u;

export interface WebHandler
{
	handle(req: WebRequest): Promise<WebResponse>;
	readonly sessions: SessionStore;
}

function withSecurityHeaders(response: WebResponse): WebResponse
{
	return { ...response, headers: { ...SECURITY_HEADERS, ...response.headers } };
}

/** 405 kèm header Allow (chỉ GET và POST; HEAD chỉ cho /healthz). */
function methodNotAllowed(): WebResponse
{
	const response = textResponse("Phương thức không được hỗ trợ.", 405);
	response.headers.Allow = "GET, POST";
	return response;
}

function messagePage(title: string, message: string, status: number): WebResponse
{
	return renderPlainPage(title, html`<div class="login"><div class="card"><h1>${title}</h1><p>${message}</p>
<p><a class="btn" href="/">Về trang chính</a></p></div></div>`, status);
}

function loginPage(reason: string | null): WebResponse
{
	const message = reason !== null && Object.hasOwn(LOGIN_MESSAGES, reason) ? LOGIN_MESSAGES[reason] ?? null : null;
	return renderPlainPage("Đăng nhập", html`<div class="login"><div class="card">
<h1>⚙️ Quản trị bot</h1>
<p class="lead">Chỉ admin bot của server (có quyền Manage Server hoặc role admin bot) mới vào được.</p>
${message ? html`<div class="flash ${reason === "out" ? "ok" : "error"}">${message}</div>` : ""}
<p><a class="btn btn-discord" href="/auth/login">Đăng nhập bằng Discord</a></p>
<p class="muted">Bạn đăng nhập trên trang của Discord; bot chỉ biết tài khoản Discord của bạn là ai, không thấy mật khẩu.</p>
</div></div>`);
}

/** Trang quay về sau lỗi nghiệp vụ do route chỉ định; null nếu route không chỉ định, hàm lỗi hoặc kết quả sai định dạng. */
function routeErrorRedirect(route: GuildRoute, ctx: GuildPageContext): string | null
{
	if (!route.errorRedirect) return null;
	try
	{
		const target = route.errorRedirect(ctx);
		return ERROR_REDIRECT.test(target) ? target : null;
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
	const getLimiter = new RateLimiter(600, 60_000);
	const routes: readonly GuildRoute[] = modules.flatMap(module => module.routes);
	const recentPosts = new Map<string, { at: number; response: Promise<WebResponse> }>();
	const css = [BASE_CSS, ...modules.map(module => module.css ?? "")].join("\n");
	const secure = deps.config.baseUrl.startsWith("https:");
	const expectedHost = new URL(deps.config.baseUrl).host.toLowerCase();
	const sessionCookie = secure ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE;
	const stateCookie = secure ? `__Host-${STATE_COOKIE}` : STATE_COOKIE;
	const statePath = secure ? "/" : "/auth";

	function isAdminMember(guild: Guild, member: GuildMember): boolean
	{
		return isAdmin(
			{ hasManageGuild: member.permissions.has(PermissionFlagsBits.ManageGuild), roleIds: [...member.roles.cache.keys()] },
			deps.services.guildConfig.getSettings(guild.id),
		);
	}

	/**
	 * Trang GET để quay về sau khi POST ở `subpath` bị lỗi: chính `subpath` nếu có route GET, không thì bỏ dần đoạn cuối
	 * (`/board/off` → `/board`, `/tiers/set` → `/tiers`), cuối cùng là trang tổng quan.
	 */
	function pageAfterPost(subpath: string): string
	{
		let path = subpath;
		while (path.length > 0 && !routes.some(entry => entry.method === "GET" && entry.path === path))
		{
			path = path.slice(0, path.lastIndexOf("/"));
		}
		return path;
	}

	function servedGuild(guildId: string): Guild | null
	{
		return deps.guildIds.includes(guildId) ? deps.client.guilds.cache.get(guildId) ?? null : null;
	}

	function clearCookie(name: string, path = "/"): string
	{
		return serializeCookie(name, "", { maxAgeSeconds: 0, path, secure });
	}

	/** Server đầu tiên (theo DISCORD_GUILD_IDS) mà người dùng là admin bot; null nếu không có. Ném DiscordUnavailableError khi Discord lỗi. */
	async function firstAdminGuild(userId: string): Promise<string | null>
	{
		for (const guildId of deps.guildIds)
		{
			const guild = servedGuild(guildId);
			const member = guild ? await fetchMember(guild, userId) : null;
			if (guild && member && isAdminMember(guild, member)) return guildId;
		}
		return null;
	}

	/** Huỷ phiên của request (người dùng không còn quyền) và trả cookie xoá phiên kèm response. */
	function dropSession(req: WebRequest, response: WebResponse): WebResponse
	{
		sessions.destroy(req.cookies.get(sessionCookie));
		response.cookies.push(clearCookie(sessionCookie));
		return response;
	}

	async function home(req: WebRequest, session: WebSession | null): Promise<WebResponse>
	{
		if (!session) return loginPage(req.query.get("loi"));
		if (!deps.guildIds.some(id => deps.client.guilds.cache.has(id)))
		{
			return messagePage("Bot đang khởi động", "Bot chưa sẵn sàng hoặc không còn ở server nào. Hãy thử lại sau ít giây.", 503);
		}
		const guildId = await firstAdminGuild(session.userId);
		return guildId === null ? dropSession(req, redirect("/?loi=gone")) : redirect(`/g/${guildId}`);
	}

	function login(req: WebRequest): WebResponse
	{
		if (!authLimiter.allow(rateLimitKey(req.ip), deps.clock.now())) return redirect("/?loi=busy");
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
		response.cookies.push(serializeCookie(stateCookie, state, { maxAgeSeconds: STATE_TTL_SECONDS, path: statePath, secure }));
		return response;
	}

	async function callback(req: WebRequest): Promise<WebResponse>
	{
		const fail = (reason: string): WebResponse =>
		{
			const response = redirect(`/?loi=${reason}`);
			response.cookies.push(clearCookie(stateCookie, statePath));
			return response;
		};
		if (!authLimiter.allow(rateLimitKey(req.ip), deps.clock.now())) return fail("busy");
		if (req.query.has("error")) return fail("denied");
		const state = req.query.get("state") ?? "";
		const expected = req.cookies.get(stateCookie) ?? "";
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

		let allowedGuild: string | null;
		try
		{
			allowedGuild = await firstAdminGuild(identity.id);
		}
		catch (error)
		{
			if (!(error instanceof DiscordUnavailableError)) throw error;
			logger.warn("Đăng nhập web: không lấy được thông tin thành viên từ Discord:", error.cause);
			return fail("discord");
		}
		if (allowedGuild === null)
		{
			logger.info(`Đăng nhập web bị từ chối: người dùng "${identity.id}" không phải admin bot ở server nào.`);
			return fail("noadmin");
		}

		const { token } = sessions.create(identity.id, identity.displayName);
		logger.info(`Đăng nhập web: người dùng "${identity.id}".`);
		const response = redirect(`/g/${allowedGuild}`);
		response.cookies.push(serializeCookie(sessionCookie, token, { maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000), secure }));
		response.cookies.push(clearCookie(stateCookie, statePath));
		return response;
	}

	/** Origin (nếu trình duyệt gửi) phải là chính trang; áp cho mọi POST, kể cả khi chưa có phiên (đăng xuất). */
	function originAllowed(req: WebRequest): boolean
	{
		const origin = req.headers.origin;
		return origin === undefined || origin === deps.config.baseUrl;
	}

	/** Kiểm tra form POST: có form, token CSRF đúng, Origin (nếu trình duyệt gửi) là chính trang. */
	function postAllowed(req: WebRequest, session: WebSession): boolean
	{
		if (!originAllowed(req)) return false;
		const token = req.form?.get("_csrf") ?? "";
		return token.length > 0 && safeEqual(token, session.csrf);
	}

	/** Khoá nhận diện một lần gửi form: người gửi, đường dẫn và các trường form (trừ `_csrf`), không phụ thuộc thứ tự trường. */
	function postKey(req: WebRequest, session: WebSession): string
	{
		const fields = [...(req.form ?? new URLSearchParams())]
			.filter(([name]) => name !== "_csrf")
			.sort(([a, x], [b, y]) => a.localeCompare(b) || x.localeCompare(y));
		return createHash("sha256").update(JSON.stringify([session.userId, req.path, fields])).digest("hex");
	}

	/** Kết quả của lần gửi y hệt còn trong DUPLICATE_POST_WINDOW_MS (kể cả lần đang chạy dở); không có thì chạy `run` và ghi nhớ. */
	function deduplicatePost(key: string, run: () => Promise<WebResponse>): Promise<WebResponse>
	{
		const now = deps.clock.now();
		for (const [oldKey, entry] of recentPosts)
		{
			if (now - entry.at < DUPLICATE_POST_WINDOW_MS && recentPosts.size <= MAX_RECENT_POSTS) break;
			recentPosts.delete(oldKey);
		}
		const previous = recentPosts.get(key);
		if (previous && now - previous.at < DUPLICATE_POST_WINDOW_MS) return previous.response;
		const response = run();
		recentPosts.set(key, { at: now, response });
		return response;
	}

	function logout(req: WebRequest, session: WebSession | null): WebResponse
	{
		const invalid = session ? !postAllowed(req, session) : !originAllowed(req);
		if (invalid) return messagePage("Không hợp lệ", "Yêu cầu đăng xuất không hợp lệ. Hãy tải lại trang rồi thử lại.", 403);
		return dropSession(req, redirect("/?loi=out"));
	}

	async function guildRoute(req: WebRequest, session: WebSession | null, guildId: string, subpath: string): Promise<WebResponse>
	{
		if (!session) return req.method === "GET" ? redirect("/") : messagePage("Chưa đăng nhập", "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.", 403);
		if (req.method === "GET" && !getLimiter.allow(`user:${session.userId}`, deps.clock.now()))
		{
			return messagePage("Quá nhanh", "Bạn thao tác quá nhanh. Hãy đợi một phút rồi thử lại.", 429);
		}
		const guild = servedGuild(guildId);
		if (!guild) return messagePage("Không tìm thấy", "Bot không phục vụ server này, hoặc đang khởi động.", 404);
		let member: GuildMember | null;
		try
		{
			member = await fetchMember(guild, session.userId);
		}
		catch (error)
		{
			if (!(error instanceof DiscordUnavailableError)) throw error;
			logger.warn(`Trang web: không lấy được thông tin thành viên từ Discord ở server "${guildId}":`, error.cause);
			return messagePage("Tạm thời không kiểm tra được quyền", DISCORD_UNAVAILABLE, 503);
		}
		if (!member || !isAdminMember(guild, member))
		{
			// Mất quyền (hoặc rời server): huỷ phiên luôn, để cookie cũ không còn dùng được và không gọi Discord mỗi lần bấm.
			return dropSession(req, messagePage("Không có quyền", "Tài khoản của bạn không (còn) có quyền admin bot ở server này. Phiên đăng nhập đã bị huỷ.", 403));
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
		const run = async (): Promise<WebResponse> =>
		{
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
					return redirect(`/g/${guildId}${routeErrorRedirect(matched, ctx) ?? pageAfterPost(subpath)}`);
				}
				// Trang lỗi không hiện flash: bỏ flash đang chờ (từ POST trước) để nó không hiện muộn ở trang sau.
				session.flash = null;
				return error instanceof UserError ? messagePage("Không thực hiện được", message, 400) : messagePage("Lỗi", message, 500);
			}
		};
		return req.method === "POST" ? deduplicatePost(postKey(req, session), run) : run();
	}

	async function route(req: WebRequest): Promise<WebResponse>
	{
		if ((req.method === "GET" || req.method === "HEAD") && req.path === "/healthz") return textResponse("ok");
		if (req.method === "HEAD") return methodNotAllowed();
		if ((req.headers.host ?? "").toLowerCase() !== expectedHost)
		{
			return textResponse("Sai địa chỉ truy cập: hãy mở trang bằng địa chỉ đã cấu hình (WEB_BASE_URL).", 421);
		}
		if (req.method === "GET" && req.path === "/static/app.css") return textResponse(css, 200, "text/css; charset=utf-8");

		const session = sessions.get(req.cookies.get(sessionCookie));
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
	if (method !== "GET" && method !== "POST" && method !== "HEAD") throw new HttpError(405, "Phương thức không được hỗ trợ.");
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
		if (status === 405) response.headers.Allow = "GET, POST";
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
