import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { loadConfluenceConfig, parseConfluenceBaseUrl, parseSpaceKeys } from "../src/config";
import {
	buildRetroSection,
	CONFLUENCE_BAD_RESPONSE,
	CONFLUENCE_BROKEN_SECTION,
	CONFLUENCE_CONFLICT,
	CONFLUENCE_MAX_ATTEMPTS,
	CONFLUENCE_NETWORK_ERROR,
	CONFLUENCE_NO_SPACES,
	CONFLUENCE_REDIRECT,
	ConfluenceClient,
	ConfluenceError,
	escapeXml,
	planRetroSection,
	replaceRetroSection,
	RetroDocSection,
	retroSectionMarker,
} from "../src/integrations/confluence";
import { RetroColumns } from "../src/modules/retro/types";
import { checkConfluenceConfig } from "../src/selfcheck/checks";
import { redactSecrets } from "../src/selfcheck/run";
import { GUILD } from "./helpers";

const BASE = "https://confluence.congty.vn";
const TOKEN = "NjQ5MzkxNDk2MjQ3OkCONFLUENCE-SECRET-token-xyz";
const PAGE_ID = "123456";
const DOC = `${BASE}/spaces/PMS/pages/${PAGE_ID}/Retrospective+Sprint+24`;
const ORIGINAL = "<h1>Retrospective - Pms Sprint 24</h1><table><tbody><tr><th>📚 Learned</th></tr><tr><td>Viết tay</td></tr></tbody></table>";

interface Request
{
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string | null;
	redirect: RequestRedirect | undefined;
	hasSignal: boolean;
}

interface FakePage
{
	id: string;
	type: string;
	title: string;
	version: number;
	storage: string;
}

/**
 * Confluence giả: một trang, kiểm tra token, version phải tăng đúng 1 (không thì 409), và khi lưu thì "chuẩn hoá" storage như
 * Confluence thật (thêm ac:macro-id vào macro, đảo thứ tự thuộc tính) để kiểm tra bot vẫn tìm lại được khu vực của mình.
 */
class FakeConfluence
{
	requests: Request[] = [];
	/** Mọi phản hồi đã trả, để kiểm tra bot đọc hoặc huỷ hết phần thân (giải phóng kết nối). */
	responses: Response[] = [];
	page: FakePage = { id: PAGE_ID, type: "page", title: "2026/09/18 Retrospective - Pms Sprint 24", version: 7, storage: ORIGINAL };
	/** Space của trang. */
	spaceKey = "PMS";
	/** Khác 0: mọi request bị chuyển hướng với mã này (giả lập SSO/proxy). */
	redirectWith = 0;

	fetch = (input: string, init?: RequestInit): Promise<Response> =>
	{
		const response = this.respond(input, init);
		return response.then(value =>
		{
			this.responses.push(value);
			return value;
		});
	};
	/** Số lần PUT tiếp theo trả 409 (giả lập người khác vừa sửa trang). */
	conflicts = 0;
	/** Mã lỗi trả cho mọi request (0 = không lỗi). */
	failWith = 0;
	/** true: fetch ném lỗi mạng. */
	offline = false;
	/** true: GET trả JSON sai định dạng. */
	garbage = false;

	private respond(input: string, init?: RequestInit): Promise<Response>
	{
		const headers = Object.fromEntries(new Headers(init?.headers).entries());
		const body = typeof init?.body === "string" ? init.body : null;
		this.requests.push({ url: input, method: init?.method ?? "GET", headers, body, redirect: init?.redirect, hasSignal: init?.signal instanceof AbortSignal });
		if (this.offline) return Promise.reject(new TypeError(`fetch failed: connect ECONNREFUSED ${input}`));
		if (this.redirectWith !== 0) return Promise.resolve(new Response(`<html>SSO ${TOKEN}</html>`, { status: this.redirectWith, headers: { Location: "https://sso.congty.vn/login" } }));
		if (this.failWith !== 0) return Promise.resolve(new Response(`<html>lỗi ${TOKEN}</html>`, { status: this.failWith }));
		if (headers.authorization !== `Bearer ${TOKEN}`) return Promise.resolve(new Response("unauthorized", { status: 401 }));
		const url = new URL(input);
		if (url.pathname !== `/rest/api/content/${PAGE_ID}`) return Promise.resolve(new Response("not found", { status: 404 }));
		if ((init?.method ?? "GET") === "GET")
		{
			if (this.garbage) return Promise.resolve(new Response("{\"id\": 1}", { status: 200 }));
			return Promise.resolve(Response.json({
				id: this.page.id,
				type: this.page.type,
				title: this.page.title,
				version: { number: this.page.version },
				space: { key: this.spaceKey, name: "Phòng PMS" },
				body: { storage: { value: this.page.storage, representation: "storage" } },
			}));
		}
		const json = JSON.parse(body ?? "{}") as { id: string; type: string; title: string; version: { number: number }; body: { storage: { value: string } } };
		if (this.conflicts > 0 || json.version.number !== this.page.version + 1)
		{
			this.conflicts = Math.max(0, this.conflicts - 1);
			this.page = { ...this.page, version: this.page.version + 1, storage: `${this.page.storage}<p>người khác vừa sửa</p>` };
			return Promise.resolve(new Response("conflict", { status: 409 }));
		}
		this.page = { ...this.page, version: json.version.number, title: json.title, type: json.type, storage: normalizeLikeConfluence(json.body.storage.value) };
		return Promise.resolve(Response.json({ id: PAGE_ID }));
	}
}

let macroCounter = 0;

/** Như Confluence khi lưu: macro có thêm ac:macro-id, thuộc tính đổi thứ tự. */
function normalizeLikeConfluence(storage: string): string
{
	return storage.replace(/<ac:structured-macro ac:name="anchor" ac:schema-version="1">/gu, () =>
	{
		macroCounter++;
		return `<ac:structured-macro ac:schema-version="1" ac:name="anchor" ac:macro-id="00000000-0000-0000-0000-${String(macroCounter).padStart(12, "0")}">`;
	});
}

function columns(overrides: Partial<Record<keyof RetroColumns, string[]>> = {}): RetroColumns
{
	return { learned: [], improve: [], ideas: [], kudos: [], sprintName: [], ...overrides };
}

function section(overrides: Partial<RetroDocSection> = {}): RetroDocSection
{
	return {
		guildId: GUILD,
		sessionId: 5,
		title: "Retrospective PMS Sprint 24",
		columns: columns({ learned: ["Học được cách review"], kudos: ["Cảm ơn QA"], sprintName: ["Rồng Lửa"] }),
		winnerName: null,
		...overrides,
	};
}

function client(fake: FakeConfluence, base = BASE, spaceKeys = ["pms"]): ConfluenceClient
{
	return new ConfluenceClient({ baseUrl: base, token: TOKEN, spaceKeys }, fake.fetch);
}

function count(text: string, part: string): number
{
	return text.split(part).length - 1;
}

async function confluenceError(promise: Promise<unknown>, message: string | RegExp): Promise<void>
{
	await assert.rejects(promise, (error: unknown) =>
	{
		assert.ok(error instanceof ConfluenceError, `cần ConfluenceError, nhận được ${String(error)}`);
		if (typeof message === "string") assert.equal(error.message, message);
		else assert.match(error.message, message);
		assert.ok(!error.message.includes(TOKEN), "thông báo lỗi không được chứa token");
		return true;
	});
}

describe("Confluence: ghi khu vực retro", () =>
{
	test("GET rồi PUT đúng API: header Bearer, không theo redirect, có thời gian chờ; version + 1, giữ title và type; thêm khu vực ở cuối trang", async () =>
	{
		const fake = new FakeConfluence();
		assert.equal(await client(fake).writeRetroSection(DOC, section()), "written");

		assert.equal(fake.requests.length, 2);
		const [get, put] = fake.requests;
		assert.equal(get.method, "GET");
		assert.equal(get.url, `${BASE}/rest/api/content/${PAGE_ID}?expand=space,body.storage,version`);
		assert.equal(put.method, "PUT");
		assert.equal(put.url, `${BASE}/rest/api/content/${PAGE_ID}`);
		for (const request of fake.requests)
		{
			assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
			assert.equal(request.headers.accept, "application/json");
			assert.equal(request.redirect, "manual", "không theo redirect: token không đi sang địa chỉ khác");
			assert.ok(request.hasSignal, "có thời gian chờ");
		}
		assert.ok(fake.responses.every(response => response.bodyUsed), "đọc hoặc huỷ phần thân của mọi phản hồi (trả kết nối)");
		assert.equal(put.headers["content-type"], "application/json");
		const body = JSON.parse(put.body ?? "{}") as Record<string, unknown>;
		assert.deepEqual(body.version, { number: 8, minorEdit: true, message: "Bot cập nhật bảng retro từ Discord" });
		assert.equal(body.title, "2026/09/18 Retrospective - Pms Sprint 24");
		assert.equal(body.type, "page");
		assert.equal(body.id, PAGE_ID);

		const storage = fake.page.storage;
		assert.ok(storage.startsWith(ORIGINAL), "phần người khác viết giữ nguyên, khu vực bot ở cuối");
		assert.equal(fake.page.version, 8);
		assert.match(storage, /<h2>🤖 Retro từ Discord: Retrospective PMS Sprint 24<\/h2>/u);
		assert.match(storage, /Bot tự cập nhật từ Discord, đừng sửa tay trong khu vực này/u);
		assert.match(storage, /<th><p>📚 Learned<\/p><\/th><th><p>👎 Thiếu sót<\/p><\/th><th><p>🔮 Sáng tạo<\/p><\/th><th><p>👍 Tuyên dương<\/p><\/th><th><p>🍀 Đặt tên sprint<\/p><\/th>/u);
		assert.equal(count(storage, "<tr>"), 2 + 2, "2 dòng của bảng cũ + tiêu đề bảng mới + 1 hàng (cột dài nhất có 1 ý)");
		assert.ok(storage.includes("<tr><td><p>Học được cách review</p></td><td></td><td></td><td><p>Cảm ơn QA</p></td><td><p>Rồng Lửa</p></td></tr>"),
			"mỗi cột là danh sách riêng: hàng gom ý thứ n của mỗi cột, không phải phiếu của một người");
		assert.match(storage, /một hàng không phải câu trả lời của một người/u);
		assert.ok(!storage.includes("🏆"), "chưa chốt tên thì chưa có dòng tên sprint");
	});

	test("ghi lại (sau khi Confluence chuẩn hoá macro) thay đúng khu vực cũ, không nhân đôi; có tên thắng thì thêm dòng 🏆", async () =>
	{
		const fake = new FakeConfluence();
		const writer = client(fake);
		await writer.writeRetroSection(DOC, section());
		assert.match(fake.page.storage, /ac:macro-id=/u, "Confluence giả đã chuẩn hoá macro");
		fake.page = { ...fake.page, storage: `${fake.page.storage}<p>Ghi chú viết sau khu vực của bot</p>` };

		await writer.writeRetroSection(DOC, section({ columns: columns({ ideas: ["Ý mới $& $1 $$"] }), winnerName: "Rồng Lửa" }));
		const storage = fake.page.storage;
		assert.equal(count(storage, "🤖 Retro từ Discord"), 1);
		assert.equal(count(storage, retroSectionMarker(GUILD, 5, "start")), 1);
		assert.equal(count(storage, retroSectionMarker(GUILD, 5, "end")), 1);
		assert.ok(!storage.includes("Học được cách review"), "dòng cũ được thay");
		assert.ok(storage.includes("<p>Ý mới $&amp; $1 $$</p>"), "chuỗi $ trong nội dung không bị hiểu là mẫu thay thế");
		assert.ok(storage.includes("<p>🏆 Tên sprint được chọn: <strong>Rồng Lửa</strong></p>"));
		assert.ok(storage.startsWith(ORIGINAL));
		assert.ok(storage.endsWith("<p>Ghi chú viết sau khu vực của bot</p>"), "phần viết sau khu vực giữ nguyên");

		await writer.writeRetroSection(DOC, section({ sessionId: 6, title: "Phiên khác", columns: columns() }));
		assert.equal(count(fake.page.storage, "🤖 Retro từ Discord"), 2, "mỗi phiên một khu vực riêng");
		assert.ok(fake.page.storage.includes("<td colspan=\"5\"><p><em>Chưa có câu trả lời.</em></p></td>"));
		await writer.writeRetroSection(DOC, section({ sessionId: 6, title: "Phiên khác", columns: columns({ kudos: ["Mới"] }) }));
		assert.equal(count(fake.page.storage, "🤖 Retro từ Discord"), 2);
		assert.equal(count(fake.page.storage, "Chưa có câu trả lời"), 0);
		assert.ok(fake.page.storage.includes("<p>Ý mới $&amp; $1 $$</p>"), "khu vực của phiên 5 không bị đụng");
	});

	test("mọi chữ người dùng được escape XML; xuống dòng thành nhiều <p>; ký tự XML không hợp lệ bị bỏ", async () =>
	{
		const fake = new FakeConfluence();
		const nasty = "<script>alert(\"x\")</script> & 'a'\u0001\n\n  dòng hai  \r\ndòng ba";
		await client(fake).writeRetroSection(DOC, section({ title: "Retro <b>&</b>", columns: columns({ improve: [nasty], sprintName: ["</td><td>"] }), winnerName: "<i>Rồng</i>" }));
		const storage = fake.page.storage;
		assert.ok(storage.includes("<h2>🤖 Retro từ Discord: Retro &lt;b&gt;&amp;&lt;/b&gt;</h2>"));
		assert.ok(storage.includes("<td><p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;a&#39;</p><p>dòng hai</p><p>dòng ba</p></td>"), storage);
		assert.ok(storage.includes("<td><p>&lt;/td&gt;&lt;td&gt;</p></td>"));
		assert.ok(storage.includes("<strong>&lt;i&gt;Rồng&lt;/i&gt;</strong>"));
		assert.ok(!storage.includes("<script>"));
		assert.equal(escapeXml("a\u0000b￾c\uD800d😀"), "abcd😀");
	});

	test("409 (xung đột phiên bản): đọc lại trang và thử lại, tối đa 4 lần; vẫn xung đột thì báo lỗi", async () =>
	{
		const fake = new FakeConfluence();
		fake.conflicts = 2;
		await client(fake).writeRetroSection(DOC, section());
		assert.deepEqual(fake.requests.map(request => request.method), ["GET", "PUT", "GET", "PUT", "GET", "PUT"]);
		assert.ok(fake.page.storage.includes("<p>người khác vừa sửa</p><p>người khác vừa sửa</p>"), "giữ thay đổi của người khác");
		assert.equal(count(fake.page.storage, "🤖 Retro từ Discord"), 1);

		const busy = new FakeConfluence();
		busy.conflicts = 100;
		await confluenceError(client(busy).writeRetroSection(DOC, section()), CONFLUENCE_CONFLICT);
		assert.equal(busy.requests.filter(request => request.method === "PUT").length, CONFLUENCE_MAX_ATTEMPTS);
	});

	test("chỉ gửi token tới đúng host của CONFLUENCE_BASE_URL: link host khác hoặc không có ID trang bị từ chối trước khi gọi mạng", async () =>
	{
		const fake = new FakeConfluence();
		const writer = client(fake);
		await confluenceError(writer.writeRetroSection("https://evil.example/pages/123456/x", section()), /confluence\.congty\.vn/);
		await confluenceError(writer.writeRetroSection("https://confluence.congty.vn.evil.example/pages/123456/x", section()), /confluence\.congty\.vn/);
		await confluenceError(writer.writeRetroSection(`${BASE}/display/PMS/Retro`, section()), /mã trang/);
		await confluenceError(writer.writeRetroSection("không phải url", section()), /không hợp lệ/);
		assert.equal(fake.requests.length, 0);
	});

	test("CONFLUENCE_BASE_URL có đường dẫn gốc: API gọi dưới đường dẫn đó", async () =>
	{
		const fake = new FakeConfluence();
		const requests: string[] = [];
		const writer = new ConfluenceClient({ baseUrl: `${BASE}/wiki`, token: TOKEN, spaceKeys: ["PMS"] }, (input, init) =>
		{
			requests.push(input);
			return fake.fetch(input.replace("/wiki/", "/"), init);
		});
		await writer.writeRetroSection(`${BASE}/wiki/pages/viewpage.action?pageId=${PAGE_ID}`, section());
		assert.deepEqual(requests, [`${BASE}/wiki/rest/api/content/${PAGE_ID}?expand=space,body.storage,version`, `${BASE}/wiki/rest/api/content/${PAGE_ID}`]);
	});

	test("lỗi HTTP, mạng và phản hồi sai định dạng thành thông báo ngắn tiếng Việt, không chứa token hay nội dung phản hồi", async () =>
	{
		const cases: [number, RegExp][] = [[401, /token sai/], [403, /không có quyền/], [404, /Không tìm thấy trang/], [500, /HTTP 500/]];
		for (const [status, message] of cases)
		{
			const fake = new FakeConfluence();
			fake.failWith = status;
			await confluenceError(client(fake).writeRetroSection(DOC, section()), message);
			assert.equal(fake.requests.length, 1, "lỗi ở GET thì không PUT");
		}
		const offline = new FakeConfluence();
		offline.offline = true;
		await confluenceError(client(offline).writeRetroSection(DOC, section()), CONFLUENCE_NETWORK_ERROR);
		const garbage = new FakeConfluence();
		garbage.garbage = true;
		await confluenceError(client(garbage).writeRetroSection(DOC, section()), CONFLUENCE_BAD_RESPONSE);
		const wrongToken = new FakeConfluence();
		await confluenceError(new ConfluenceClient({ baseUrl: BASE, token: "sai", spaceKeys: ["PMS"] }, wrongToken.fetch).writeRetroSection(DOC, section()), /401/);
		for (const fake of [wrongToken, garbage])
		{
			assert.ok(fake.responses.every(response => response.bodyUsed), "phản hồi lỗi cũng được đọc hoặc huỷ phần thân");
		}
	});

	test("Confluence chuyển hướng (SSO, sai địa chỉ gốc): báo lỗi rõ, không theo chuyển hướng, không PUT, huỷ phần thân", async () =>
	{
		for (const status of [301, 302, 307])
		{
			const fake = new FakeConfluence();
			fake.redirectWith = status;
			await confluenceError(client(fake).writeRetroSection(DOC, section()), CONFLUENCE_REDIRECT);
			assert.deepEqual(fake.requests.map(request => request.url), [`${BASE}/rest/api/content/${PAGE_ID}?expand=space,body.storage,version`]);
			assert.ok(fake.responses.every(response => response.bodyUsed));
		}
	});

	test("khu vực trên trang đã đúng nội dung (sau khi Confluence chuẩn hoá macro): chỉ GET, không PUT, không tạo phiên bản mới", async () =>
	{
		const fake = new FakeConfluence();
		const writer = client(fake);
		assert.equal(await writer.writeRetroSection(DOC, section()), "written");
		assert.match(fake.page.storage, /ac:macro-id=/u);
		const version = fake.page.version;
		assert.equal(await writer.writeRetroSection(DOC, section()), "unchanged");
		assert.deepEqual(fake.requests.map(request => request.method), ["GET", "PUT", "GET"]);
		assert.equal(fake.page.version, version);
		assert.equal(await writer.writeRetroSection(DOC, section({ winnerName: "Rồng Lửa" })), "written", "đổi nội dung thì ghi");
	});

	test("chỉ ghi trang thuộc space trong CONFLUENCE_SPACE_KEYS (so không phân biệt hoa thường); danh sách rỗng thì từ chối trước khi gọi mạng", async () =>
	{
		const other = new FakeConfluence();
		other.spaceKey = "HR";
		await confluenceError(client(other).writeRetroSection(DOC, section()), /space "HR".*CONFLUENCE_SPACE_KEYS: pms/u);
		assert.deepEqual(other.requests.map(request => request.method), ["GET"], "đọc space rồi dừng, không PUT");
		assert.equal(other.page.storage, ORIGINAL);

		const empty = new FakeConfluence();
		await confluenceError(client(empty, BASE, []).writeRetroSection(DOC, section()), CONFLUENCE_NO_SPACES);
		assert.equal(empty.requests.length, 0);

		const allowed = new FakeConfluence();
		allowed.spaceKey = "P2";
		assert.equal(await client(allowed, BASE, ["PMS", "p2"]).writeRetroSection(DOC, section()), "written");
	});

	test("trang dùng layout (ac:layout, auto-cursor-target): khu vực nằm trong một layout-section một cột mới cuối layout; ghi lại thay đúng chỗ", async () =>
	{
		const layout = "<ac:layout><ac:layout-section ac:type=\"single\"><ac:layout-cell><h1>Retro</h1><p class=\"auto-cursor-target\"><br /></p>"
			+ "<table><tbody><tr><th>📚 Learned</th></tr></tbody></table><p class=\"auto-cursor-target\"><br /></p></ac:layout-cell></ac:layout-section>"
			+ "<ac:layout-section ac:type=\"two_equal\"><ac:layout-cell><p>trái</p></ac:layout-cell><ac:layout-cell><p>phải</p></ac:layout-cell></ac:layout-section></ac:layout>";
		const fake = new FakeConfluence();
		fake.page = { ...fake.page, storage: layout };
		const writer = client(fake);
		await writer.writeRetroSection(DOC, section());
		const storage = fake.page.storage;
		assert.ok(storage.endsWith("</ac:layout-cell></ac:layout-section></ac:layout>"), "không có chữ nằm ngoài layout");
		const added = storage.slice(storage.lastIndexOf("<ac:layout-section"));
		assert.ok(added.startsWith("<ac:layout-section ac:type=\"single\"><ac:layout-cell><p><ac:structured-macro"), "khu vực trong layout-section một cột mới");
		assert.ok(added.includes("🤖 Retro từ Discord"));
		assert.ok(storage.includes("<ac:layout-cell><p>phải</p></ac:layout-cell>"), "không chèn vào ô của người khác");

		await writer.writeRetroSection(DOC, section({ columns: columns({ kudos: ["Mới"] }) }));
		assert.equal(count(fake.page.storage, "🤖 Retro từ Discord"), 1);
		assert.equal(count(fake.page.storage, "<ac:layout-section"), 3, "ghi lại không thêm section mới");
		assert.ok(fake.page.storage.includes("<p>Mới</p>"));

		const plain = planRetroSection("<p>a</p><p class=\"auto-cursor-target\"><br /></p>", GUILD, 5, "KHU");
		assert.deepEqual(plain, { storage: "<p>a</p><p class=\"auto-cursor-target\"><br /></p>KHU", changed: true }, "trang không layout: nối vào cuối");
	});

	test("khu vực bị sửa dở (mất dấu kết thúc): báo lỗi, không ghi đè phần khác của trang", async () =>
	{
		const fake = new FakeConfluence();
		const start = buildRetroSection(section()).split("<h2>")[0];
		fake.page = { ...fake.page, storage: `${ORIGINAL}${start}<h2>Phần ai đó viết tiếp</h2>` };
		await confluenceError(client(fake).writeRetroSection(DOC, section()), CONFLUENCE_BROKEN_SECTION);
		assert.deepEqual(fake.requests.map(request => request.method), ["GET"]);
	});

	test("replaceRetroSection: dấu macro nằm ngoài <p> vẫn tìm được; chưa có khu vực thì thêm vào cuối", () =>
	{
		const block = buildRetroSection(section());
		const bare = block.replaceAll("<p><ac:structured-macro", "<ac:structured-macro").replaceAll("</ac:structured-macro></p>", "</ac:structured-macro>");
		const replaced = replaceRetroSection(`đầu${bare}cuối`, GUILD, 5, "MỚI");
		assert.equal(replaced, "đầuMỚIcuối");
		assert.equal(replaceRetroSection("trang", GUILD, 5, "MỚI"), "trangMỚI");
		assert.equal(replaceRetroSection(`x${block}y`, GUILD, 6, "MỚI"), `x${block}yMỚI`, "khu vực của phiên khác không bị thay");
	});
});

describe("Confluence: cấu hình", () =>
{
	test("không đặt gì: tắt; đặt một nửa hoặc sai: lỗi không chứa token; base URL được chuẩn hoá", () =>
	{
		assert.equal(loadConfluenceConfig({}), null);
		assert.equal(loadConfluenceConfig({ CONFLUENCE_BASE_URL: "  ", CONFLUENCE_TOKEN: "" }), null);
		assert.throws(() => loadConfluenceConfig({ CONFLUENCE_TOKEN: TOKEN }), /thiếu CONFLUENCE_BASE_URL/);
		assert.throws(() => loadConfluenceConfig({ CONFLUENCE_BASE_URL: BASE }), /thiếu CONFLUENCE_TOKEN/);
		for (const env of [
			{ CONFLUENCE_BASE_URL: BASE, CONFLUENCE_TOKEN: `${TOKEN} x` },
			{ CONFLUENCE_BASE_URL: "http://confluence.congty.vn", CONFLUENCE_TOKEN: TOKEN },
			{ CONFLUENCE_BASE_URL: `${BASE}/?a=1`, CONFLUENCE_TOKEN: TOKEN },
			{ CONFLUENCE_BASE_URL: "không phải url", CONFLUENCE_TOKEN: TOKEN },
		])
		{
			assert.throws(() => loadConfluenceConfig(env), (error: unknown) => error instanceof Error && !error.message.includes(TOKEN));
		}
		assert.deepEqual(loadConfluenceConfig({ CONFLUENCE_BASE_URL: ` ${BASE}/ `, CONFLUENCE_TOKEN: ` ${TOKEN} ` }), { baseUrl: BASE, token: TOKEN, spaceKeys: [] });
		assert.deepEqual(loadConfluenceConfig({ CONFLUENCE_BASE_URL: BASE, CONFLUENCE_TOKEN: TOKEN, CONFLUENCE_SPACE_KEYS: " P2, pms ,P2,," })?.spaceKeys, ["P2", "pms"]);
		assert.equal(loadConfluenceConfig({ CONFLUENCE_SPACE_KEYS: "P2" }), null, "chỉ có danh sách space thì vẫn tắt");
		assert.equal(parseConfluenceBaseUrl("https://Wiki.CongTy.vn:8443/confluence//"), "https://wiki.congty.vn:8443/confluence");
	});

	test("CONFLUENCE_SPACE_KEYS: tách theo dấu phẩy, bỏ trùng không phân biệt hoa thường; khoá lạ thì lỗi", () =>
	{
		assert.deepEqual(parseSpaceKeys(""), []);
		assert.deepEqual(parseSpaceKeys("P2"), ["P2"]);
		assert.deepEqual(parseSpaceKeys("P2,p2,~nguyen.tien,PMS_2"), ["P2", "~nguyen.tien", "PMS_2"]);
		for (const bad of ["P2;PMS", "P 2", "<script>", "P2,~"])
		{
			assert.throws(() => parseSpaceKeys(bad), /CONFLUENCE_SPACE_KEYS có khoá space không hợp lệ/, bad);
		}
	});

	test("selfcheck báo bật/tắt và danh sách space, không in token; chưa đặt space thì cảnh báo; redactSecrets che CONFLUENCE_TOKEN", () =>
	{
		const off = checkConfluenceConfig({});
		assert.equal(off.status, "ok");
		assert.match(off.message, /tắt/);
		const on = checkConfluenceConfig({ CONFLUENCE_BASE_URL: BASE, CONFLUENCE_TOKEN: TOKEN, CONFLUENCE_SPACE_KEYS: "P2,PMS" });
		assert.equal(on.status, "ok");
		assert.match(on.message, /bật, địa chỉ https:\/\/confluence\.congty\.vn; CONFLUENCE_TOKEN: có; space được ghi: P2, PMS\./);
		assert.ok(!on.message.includes(TOKEN));
		const noSpaces = checkConfluenceConfig({ CONFLUENCE_BASE_URL: BASE, CONFLUENCE_TOKEN: TOKEN });
		assert.equal(noSpaces.status, "warn");
		assert.match(noSpaces.message, /chưa đặt CONFLUENCE_SPACE_KEYS/);
		assert.ok(!noSpaces.message.includes(TOKEN));
		assert.equal(checkConfluenceConfig({ CONFLUENCE_BASE_URL: BASE, CONFLUENCE_TOKEN: TOKEN, CONFLUENCE_SPACE_KEYS: "P 2" }).status, "fail");
		const broken = checkConfluenceConfig({ CONFLUENCE_TOKEN: TOKEN });
		assert.equal(broken.status, "fail");
		assert.ok(!broken.message.includes(TOKEN));
		assert.equal(redactSecrets(`lỗi với token ${TOKEN} ở đây`, { CONFLUENCE_TOKEN: TOKEN }), "lỗi với token [đã ẩn] ở đây");
		assert.ok(!redactSecrets(`token ${TOKEN}`, { CONFLUENCE_TOKEN: ` ${TOKEN}\n` }).includes(TOKEN), "giá trị có khoảng trắng hai đầu vẫn bị che");
	});
});
