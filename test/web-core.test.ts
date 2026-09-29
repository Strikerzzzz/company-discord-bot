import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { UserError } from "../src/shared/errors";
import { discordText } from "../src/web/format";
import { escapeHtml, html, joinHtml, raw } from "../src/web/html";
import { csrfField, redirectWithFlash, renderPage } from "../src/web/layout";
import { SESSION_TTL_MS } from "../src/web/session";
import { SESSION_COOKIE, startWebServer, STATE_COOKIE } from "../src/web/server";
import type { PageModule } from "../src/web/types";
import { GUILD } from "./helpers";
import {
	ADMIN_USER,
	APP_ID,
	BASE_URL,
	call,
	CHANNEL_CHAT,
	createWebHarness,
	login,
	PLAIN_USER,
	ROLE_ADMIN_BOT,
	ROLE_ADMIN_USER,
	ROLE_TEAM_A,
	setCookieValue,
	STRANGER,
	withCsrf,
} from "./web-helpers";

/** Trang thử cho lõi web: GET hiện form, POST ghi flash thành công hoặc ném UserError. */
const TEST_PAGE: PageModule = {
	routes: [
		{
			method: "GET",
			path: "/thu",
			handler: ctx => renderPage(ctx, { nav: "overview", title: "Trang thử", body: html`<form method="post">${csrfField(ctx)}</form>` }),
		},
		{
			method: "POST",
			path: "/thu",
			handler: ctx =>
			{
				if (ctx.req.form?.get("loi") === "1") throw new UserError(`Không được: <#${CHANNEL_CHAT}> **đậm** <script>`);
				if (ctx.req.form?.get("loi") === "2") throw new Error("lỗi lạ");
				return redirectWithFlash(ctx, "/thu", "ok", `Đã lưu bởi ${ctx.actorId}.`);
			},
		},
	],
};

describe("web: HTML an toàn", () =>
{
	test("html escape mọi giá trị chèn vào (kể cả thuộc tính), trừ RawHtml; mảng được nối; null/false bị bỏ", () =>
	{
		const name = "<img src=x onerror=alert(1)> \"a\" & 'b'";
		assert.equal(html`<p title="${name}">${name}</p>`.html, `<p title="${escapeHtml(name)}">${escapeHtml(name)}</p>`);
		assert.ok(!html`${name}`.html.includes("<img"));
		assert.equal(html`<b>${raw("<i>x</i>")}</b>`.html, "<b><i>x</i></b>");
		assert.equal(html`${["<a>", raw("<br>"), 1, null, false, undefined]}`.html, "&lt;a&gt;<br>1");
		assert.equal(joinHtml(["a", raw("<b>b</b>"), null], raw(", ")).html, "a, <b>b</b>");
	});

	test("chữ kiểu Discord sang HTML: mention thành tên (tên được escape), đậm, mã, dòng -# nhỏ; HTML trong chữ bị escape", () =>
	{
		const harness = createWebHarness([TEST_PAGE]);
		const out = discordText(harness.world.guild, `Đặt <#${CHANNEL_CHAT}> và <@&${ROLE_TEAM_A}> **ok** \`/lenh\` <script>x</script>\n-# ghi chú`).html;
		assert.ok(out.includes("<span class=\"mention\">#chung</span>"), out);
		assert.ok(out.includes("<span class=\"mention\">@Backend</span>"), out);
		assert.ok(out.includes("<strong>ok</strong>") && out.includes("<code>/lenh</code>"), out);
		assert.ok(out.includes("&lt;script&gt;x&lt;/script&gt;") && !out.includes("<script>"), out);
		assert.ok(out.includes("<br><small class=\"muted\">ghi chú</small>"), out);
		assert.ok(discordText(harness.world.guild, "<#499999999999999999>").html.includes("kênh-không-còn"));
	});
});

describe("web: địa chỉ, header bảo mật, tệp tĩnh", () =>
{
	test("/healthz trả ok không cần Host đúng; request sai Host (chống DNS rebinding) bị từ chối 421", async () =>
	{
		const harness = createWebHarness([TEST_PAGE]);
		assert.equal((await call(harness, "/healthz", { headers: { host: "evil.example" } })).status, 200);
		assert.equal((await call(harness, "/", { headers: { host: "evil.example:8787" } })).status, 421);
		assert.equal((await call(harness, "/")).status, 200);
	});

	test("mọi response có CSP chặt, chống nhúng iframe, không cache; CSS phục vụ ở /static/app.css", async () =>
	{
		const harness = createWebHarness([{ routes: [], css: ".rieng { color: red; }" }]);
		for (const target of ["/", "/khong-co", "/static/app.css", `/g/${GUILD}`])
		{
			const response = await call(harness, target);
			assert.match(response.headers["Content-Security-Policy"] ?? "", /default-src 'none'.*form-action 'self'.*frame-ancestors 'none'/u, target);
			assert.equal(response.headers["X-Frame-Options"], "DENY", target);
			assert.equal(response.headers["X-Content-Type-Options"], "nosniff", target);
			assert.equal(response.headers["Cache-Control"], "no-store", target);
		}
		const css = await call(harness, "/static/app.css");
		assert.equal(css.headers["Content-Type"], "text/css; charset=utf-8");
		assert.ok(css.body.includes(":root") && css.body.includes(".rieng { color: red; }"));
	});
});

describe("web: đăng nhập bằng Discord", () =>
{
	test("chưa đăng nhập: trang đăng nhập có nút Discord; chỉ hiện thông báo theo mã đã biết, không phản chiếu chữ từ URL", async () =>
	{
		const harness = createWebHarness([TEST_PAGE]);
		const page = await call(harness, "/");
		assert.ok(page.body.includes("href=\"/auth/login\"") && page.body.includes("Đăng nhập bằng Discord"));
		assert.ok((await call(harness, "/?loi=noadmin")).body.includes("không có quyền admin bot"));
		const injected = await call(harness, "/?loi=%3Cscript%3Ealert(1)%3C/script%3E");
		assert.ok(!injected.body.includes("alert(1)") && !injected.body.includes("<script>"));
	});

	test("/auth/login chuyển tới trang cho phép của Discord (scope identify, đúng redirect) và đặt cookie state HttpOnly", async () =>
	{
		const harness = createWebHarness([TEST_PAGE]);
		const response = await call(harness, "/auth/login");
		assert.equal(response.status, 303);
		const location = new URL(response.headers.Location ?? "");
		assert.equal(location.origin + location.pathname, "https://discord.com/oauth2/authorize");
		assert.equal(location.searchParams.get("client_id"), APP_ID);
		assert.equal(location.searchParams.get("scope"), "identify");
		assert.equal(location.searchParams.get("redirect_uri"), `${BASE_URL}/auth/callback`);
		const state = setCookieValue(response, STATE_COOKIE);
		assert.ok(state && state.length >= 32);
		assert.equal(location.searchParams.get("state"), state);
		const cookie = response.cookies.find(item => item.startsWith(`${STATE_COOKIE}=`)) ?? "";
		assert.match(cookie, /HttpOnly/);
		assert.match(cookie, /SameSite=Lax/);
		assert.match(cookie, /Path=\/auth/);
	});

	test("callback: state sai/thiếu, người dùng huỷ, code sai, không phải admin đều không tạo phiên", async () =>
	{
		const harness = createWebHarness([TEST_PAGE]);
		const state = setCookieValue(await call(harness, "/auth/login"), STATE_COOKIE) ?? "";
		const cases: [string, Record<string, string>, string][] = [
			[`/auth/callback?code=code${ADMIN_USER}&state=khac`, { [STATE_COOKIE]: state }, "expired"],
			[`/auth/callback?code=code${ADMIN_USER}&state=${state}`, {}, "expired"],
			[`/auth/callback?error=access_denied&state=${state}`, { [STATE_COOKIE]: state }, "denied"],
			[`/auth/callback?code=codesai1234&state=${state}`, { [STATE_COOKIE]: state }, "failed"],
			[`/auth/callback?code=code${PLAIN_USER}&state=${state}`, { [STATE_COOKIE]: state }, "noadmin"],
			[`/auth/callback?code=code${STRANGER}&state=${state}`, { [STATE_COOKIE]: state }, "noadmin"],
		];
		for (const [target, cookies, reason] of cases)
		{
			const response = await call(harness, target, { cookies });
			assert.equal(response.headers.Location, `/?loi=${reason}`, target);
			assert.equal(setCookieValue(response, SESSION_COOKIE), undefined, target);
		}
		assert.equal(harness.handler.sessions.size, 0);
	});

	test("admin (Manage Server) đăng nhập được: cookie phiên HttpOnly, vào thẳng trang server; admin nhờ role admin bot cũng được", async () =>
	{
		const harness = createWebHarness([TEST_PAGE]);
		const admin = await login(harness, ADMIN_USER);
		assert.equal(admin.session.userId, ADMIN_USER);
		assert.equal(admin.session.displayName, "Admin <b>");

		await assert.rejects(login(harness, ROLE_ADMIN_USER), /noadmin/);
		harness.services.guildConfig.updateSettings(GUILD, { adminRoleId: ROLE_ADMIN_BOT }, ADMIN_USER);
		const roleAdmin = await login(harness, ROLE_ADMIN_USER);
		const page = await call(harness, `/g/${GUILD}/thu`, { cookies: roleAdmin.cookies });
		assert.equal(page.status, 200);
	});

	test("đăng xuất cần token CSRF; xong thì phiên bị huỷ và cookie bị xoá", async () =>
	{
		const harness = createWebHarness([TEST_PAGE]);
		const auth = await login(harness, ADMIN_USER);
		assert.equal((await call(harness, "/auth/logout", { form: { _csrf: "sai" }, cookies: auth.cookies })).status, 403);
		const out = await call(harness, "/auth/logout", { form: withCsrf(auth), cookies: auth.cookies });
		assert.equal(out.headers.Location, "/?loi=out");
		assert.equal(setCookieValue(out, SESSION_COOKIE), "");
		assert.equal((await call(harness, `/g/${GUILD}/thu`, { cookies: auth.cookies })).headers.Location, "/");
	});
});

describe("web: phân quyền và form", () =>
{
	test("trang server: chưa đăng nhập thì về trang chính; server không phục vụ thì 404; hết hạn phiên thì phải đăng nhập lại", async () =>
	{
		const harness = createWebHarness([TEST_PAGE]);
		assert.equal((await call(harness, `/g/${GUILD}/thu`)).headers.Location, "/");
		const auth = await login(harness, ADMIN_USER);
		assert.equal((await call(harness, "/g/100000000000000999/thu", { cookies: auth.cookies })).status, 404);
		assert.equal((await call(harness, `/g/${GUILD}/khong-co`, { cookies: auth.cookies })).status, 404);

		const page = await call(harness, `/g/${GUILD}/thu`, { cookies: auth.cookies });
		assert.equal(page.status, 200);
		assert.ok(page.body.includes(`href="/g/${GUILD}/channels"`), "có menu");
		assert.ok(page.body.includes(`name="_csrf" value="${auth.csrf}"`));
		assert.ok(page.body.includes("Admin &lt;b&gt;") && !page.body.includes("Admin <b>"), "tên người dùng được escape");

		harness.clock.advance(SESSION_TTL_MS + 1);
		assert.equal((await call(harness, `/g/${GUILD}/thu`, { cookies: auth.cookies })).headers.Location, "/");
	});

	test("quyền được kiểm tra lại ở mỗi request: mất quyền admin thì trang bị chặn ngay", async () =>
	{
		const harness = createWebHarness([TEST_PAGE]);
		harness.services.guildConfig.updateSettings(GUILD, { adminRoleId: ROLE_ADMIN_BOT }, ADMIN_USER);
		const auth = await login(harness, ROLE_ADMIN_USER);
		harness.services.guildConfig.updateSettings(GUILD, { adminRoleId: null }, ADMIN_USER);
		assert.equal((await call(harness, `/g/${GUILD}/thu`, { cookies: auth.cookies })).status, 403);
		assert.equal((await call(harness, `/g/${GUILD}/thu`, { form: withCsrf(auth), cookies: auth.cookies })).status, 403);
	});

	test("POST cần token CSRF đúng và Origin (nếu có) là chính trang; lỗi nghiệp vụ thành flash lỗi, flash chỉ hiện một lần", async () =>
	{
		const harness = createWebHarness([TEST_PAGE]);
		const auth = await login(harness, ADMIN_USER);
		const target = `/g/${GUILD}/thu`;
		assert.equal((await call(harness, target, { form: {}, cookies: auth.cookies })).status, 403);
		assert.equal((await call(harness, target, { form: { _csrf: "sai" }, cookies: auth.cookies })).status, 403);
		assert.equal((await call(harness, target, { form: withCsrf(auth), cookies: auth.cookies, headers: { origin: "http://evil.example" } })).status, 403);

		const saved = await call(harness, target, { form: withCsrf(auth), cookies: auth.cookies });
		assert.equal(saved.status, 303);
		assert.equal(saved.headers.Location, target);
		const shown = await call(harness, target, { cookies: auth.cookies });
		assert.ok(shown.body.includes("class=\"flash ok\"") && shown.body.includes(`Đã lưu bởi ${ADMIN_USER}.`));
		assert.ok(!(await call(harness, target, { cookies: auth.cookies })).body.includes("class=\"flash"), "flash chỉ hiện một lần");

		const refused = await call(harness, target, { form: withCsrf(auth, { loi: "1" }), cookies: auth.cookies });
		assert.equal(refused.headers.Location, target);
		const error = (await call(harness, target, { cookies: auth.cookies })).body;
		assert.ok(error.includes("class=\"flash error\"") && error.includes("#chung") && error.includes("<strong>đậm</strong>") && !error.includes("<script>"));

		await call(harness, target, { form: withCsrf(auth, { loi: "2" }), cookies: auth.cookies });
		assert.ok((await call(harness, target, { cookies: auth.cookies })).body.includes("Đã có lỗi xảy ra"), "lỗi lạ không lộ chi tiết");
	});
});

describe("web: máy chủ HTTP thật", () =>
{
	test("nối node:http: /healthz, header bảo mật, chỉ nhận form cho POST, chặn body quá lớn, phương thức lạ", async () =>
	{
		const harness = createWebHarness([TEST_PAGE]);
		const server = await startWebServer({ ...harness.deps, config: { ...harness.deps.config, port: 0, host: "127.0.0.1" } }, [TEST_PAGE]);
		const send = (method: string, target: string, body?: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, unknown>; body: string }> =>
			new Promise((resolve, reject) =>
			{
				const req = httpRequest({ host: "127.0.0.1", port: server.port, method, path: target, headers }, res =>
				{
					const chunks: Buffer[] = [];
					res.on("data", (chunk: Buffer) => chunks.push(chunk));
					res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
				});
				req.on("error", reject);
				if (body !== undefined) req.write(body);
				req.end();
			});
		try
		{
			const health = await send("GET", "/healthz");
			assert.equal(health.status, 200);
			assert.equal(health.body, "ok");
			assert.equal(health.headers["x-frame-options"], "DENY");
			assert.equal((await send("POST", "/auth/logout", "{}", { "Content-Type": "application/json", host: "192.168.0.206:8787" })).status, 415);
			// Body quá lớn: server trả 413 ngay khi vượt giới hạn, không đọc tiếp; client đang gửi dở có thể nhận 413 hoặc bị ngắt kết nối.
			const tooLarge = await send("POST", "/auth/logout", "a=".repeat(200_000), { "Content-Type": "application/x-www-form-urlencoded", host: "192.168.0.206:8787" })
				.then(response => response.status, (error: unknown) => (error instanceof Error && /ECONNRESET|EPIPE/u.test(error.message) ? 413 : -1));
			assert.equal(tooLarge, 413);
			assert.equal((await send("PUT", "/")).status, 405);
			const home = await send("GET", "/", undefined, { host: "192.168.0.206:8787" });
			assert.equal(home.status, 200);
			assert.ok(home.body.startsWith("<!doctype html>"));
		}
		finally
		{
			await server.close();
		}
	});
});
