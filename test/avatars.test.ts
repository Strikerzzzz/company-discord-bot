import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { AVATAR_HOSTS, AvatarFetcher, DEFAULT_AVATAR_MAX_BYTES, parseAvatarUrl } from "../src/discord/avatars";
import { logger } from "../src/shared/logger";

const AVATAR_URL = "https://cdn.discordapp.com/avatars/300000000000000001/a1b2c3.png?size=256";
const OTHER_URL = "https://cdn.discordapp.com/guilds/100000000000000001/users/300000000000000002/avatars/d4e5f6.png?size=128";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

interface Call
{
	url: string;
	init: RequestInit | undefined;
}

type Handler = (url: string, init: RequestInit | undefined) => Promise<Response> | Response;

function fakeFetch(handler: Handler): { fetchImpl: typeof fetch; calls: Call[] }
{
	const calls: Call[] = [];
	const fetchImpl: typeof fetch = async (input, init) =>
	{
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		calls.push({ url, init });
		return await handler(url, init);
	};
	return { fetchImpl, calls };
}

function imageResponse(body: BodyInit | null = PNG, headers: Record<string, string> = { "content-type": "image/png" }, status = 200): Response
{
	return new Response(body, { status, headers });
}

/** Stream trả về `chunks` khúc, mỗi khúc `size` byte; đếm số lần bị đọc. */
function chunkedStream(chunks: number, size: number): { stream: ReadableStream<Uint8Array>; pulls: () => number }
{
	let pulled = 0;
	const stream = new ReadableStream<Uint8Array>({
		pull(controller)
		{
			pulled++;
			if (pulled > chunks) controller.close();
			else controller.enqueue(new Uint8Array(size).fill(7));
		},
	});
	return { stream, pulls: () => pulled };
}

/**
 * Timer của AbortSignal.timeout là unref: với fetch giả không có socket nào giữ event loop, process sẽ thoát trước khi quá hạn.
 * Giữ event loop sống trong lúc chạy `run` (khi chạy thật, socket của fetch làm việc này).
 */
async function keepingAlive<T>(run: () => Promise<T>): Promise<T>
{
	const timer = setInterval(() => undefined, 1000);
	try
	{
		return await run();
	}
	finally
	{
		clearInterval(timer);
	}
}

/** Promise bị reject khi signal của request bị huỷ (mô phỏng fetch thật khi quá hạn). */
function rejectOnAbort(init: RequestInit | undefined): Promise<Response>
{
	return new Promise<Response>((_resolve, reject) =>
	{
		const signal = init?.signal;
		if (!signal) return;
		signal.addEventListener("abort", () => reject(signal.reason instanceof Error ? signal.reason : new Error("aborted")));
	});
}

describe("parseAvatarUrl", () =>
{
	test("chỉ nhận URL https của cdn.discordapp.com (avatar user, avatar theo server, avatar mặc định)", () =>
	{
		assert.deepEqual(AVATAR_HOSTS, ["cdn.discordapp.com"]);
		assert.equal(parseAvatarUrl(AVATAR_URL)?.hostname, "cdn.discordapp.com");
		assert.equal(parseAvatarUrl(OTHER_URL)?.hostname, "cdn.discordapp.com");
		assert.equal(parseAvatarUrl("https://CDN.DiscordApp.com/embed/avatars/0.png")?.hostname, "cdn.discordapp.com");
	});

	test("từ chối media.discordapp.net (phục vụ file người dùng tải lên), http, host lạ, credentials, port riêng và chuỗi không phải URL", () =>
	{
		const rejected = [
			null,
			"",
			"not a url",
			"https://media.discordapp.net/avatars/300000000000000002/d4e5f6.webp?size=128",
			"https://media.discordapp.net/attachments/1/2/bom.png",
			"http://cdn.discordapp.com/avatars/1/a.png",
			"https://evil.example.com/avatars/1/a.png",
			"https://cdn.discordapp.com.evil.com/a.png",
			"https://discordapp.com/a.png",
			"https://cdn.discordapp.com./a.png",
			"https://user:pass@cdn.discordapp.com/a.png",
			"https://user@cdn.discordapp.com/a.png",
			"https://cdn.discordapp.com:8443/a.png",
			"file:///etc/passwd",
			"data:image/png;base64,iVBORw0KGgo=",
			`https://cdn.discordapp.com/${"a".repeat(3000)}.png`,
		];
		for (const url of rejected) assert.equal(parseAvatarUrl(url), null, String(url));
	});
});

describe("AvatarFetcher", () =>
{
	test("URL không hợp lệ trả về null mà không gọi mạng", async () =>
	{
		const { fetchImpl, calls } = fakeFetch(() => imageResponse());
		const fetcher = new AvatarFetcher({ fetchImpl });
		for (const url of [null, "http://cdn.discordapp.com/a.png", "https://evil.example.com/a.png", "https://a:b@cdn.discordapp.com/a.png", "https://cdn.discordapp.com:444/a.png"])
		{
			assert.equal(await fetcher.get(url), null);
		}
		assert.equal(calls.length, 0);
	});

	test("tải thành công: trả về bytes, không theo redirect, có timeout", async () =>
	{
		const { fetchImpl, calls } = fakeFetch(() => imageResponse());
		const fetcher = new AvatarFetcher({ fetchImpl });
		const bytes = await fetcher.get(AVATAR_URL);
		assert.deepEqual(bytes, PNG);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].url, AVATAR_URL);
		assert.equal(calls[0].init?.redirect, "error");
		assert.ok(calls[0].init?.signal instanceof AbortSignal);
		assert.deepEqual(calls[0].init?.headers, { accept: "image/png, image/jpeg, image/webp" }, "không xin GIF");
	});

	test("cache: lần gọi sau không gọi mạng; hết TTL thì tải lại", async () =>
	{
		let now = 1_000_000;
		const { fetchImpl, calls } = fakeFetch(() => imageResponse());
		const fetcher = new AvatarFetcher({ fetchImpl, ttlMs: 60_000, now: () => now });
		await fetcher.get(AVATAR_URL);
		await fetcher.get(AVATAR_URL);
		assert.equal(calls.length, 1);
		now += 59_999;
		await fetcher.get(AVATAR_URL);
		assert.equal(calls.length, 1);
		now += 2;
		assert.deepEqual(await fetcher.get(AVATAR_URL), PNG);
		assert.equal(calls.length, 2);
	});

	test("gộp các request đồng thời cho cùng URL", async () =>
	{
		let release: () => void = () => undefined;
		const gate = new Promise<void>(resolve =>
		{
			release = resolve;
		});
		const { fetchImpl, calls } = fakeFetch(async () =>
		{
			await gate;
			return imageResponse();
		});
		const fetcher = new AvatarFetcher({ fetchImpl });
		const pending = Promise.all([fetcher.get(AVATAR_URL), fetcher.get(AVATAR_URL), fetcher.get(AVATAR_URL), fetcher.get(OTHER_URL)]);
		release();
		const results = await pending;
		assert.equal(calls.length, 2);
		for (const result of results) assert.deepEqual(result, PNG);
	});

	test("quá hạn khi chờ phản hồi trả về null", async () =>
	{
		const { fetchImpl } = fakeFetch((_url, init) => rejectOnAbort(init));
		const fetcher = new AvatarFetcher({ fetchImpl, timeoutMs: 30 });
		const started = Date.now();
		assert.equal(await keepingAlive(() => fetcher.get(AVATAR_URL)), null);
		assert.ok(Date.now() - started < 2000);
	});

	test("quá hạn khi đang đọc body trả về null", async () =>
	{
		const { fetchImpl } = fakeFetch((_url, init) =>
		{
			const stream = new ReadableStream<Uint8Array>({
				start(controller)
				{
					controller.enqueue(new Uint8Array(10));
					init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
				},
			});
			return imageResponse(stream);
		});
		const fetcher = new AvatarFetcher({ fetchImpl, timeoutMs: 30 });
		assert.equal(await keepingAlive(() => fetcher.get(AVATAR_URL)), null);
	});

	test("chỉ nhận content-type PNG/JPEG/WebP; GIF, SVG, định dạng ảnh khác, không phải ảnh hoặc thiếu content-type trả về null", async () =>
	{
		const invalid = ["text/html", "image/gif", "image/svg+xml", "image/avif", "image/bmp", "image/pngx", "image/", "application/octet-stream", null];
		for (const type of invalid)
		{
			const { fetchImpl } = fakeFetch(() => imageResponse(PNG, type === null ? {} : { "content-type": type }));
			assert.equal(await new AvatarFetcher({ fetchImpl }).get(AVATAR_URL), null, String(type));
		}
		for (const type of ["image/png", "image/jpeg", "Image/WebP; charset=binary"])
		{
			const { fetchImpl } = fakeFetch(() => imageResponse(PNG, { "content-type": type }));
			assert.deepEqual(await new AvatarFetcher({ fetchImpl }).get(AVATAR_URL), PNG, type);
		}
	});

	test("giới hạn mặc định 512 KB", async () =>
	{
		assert.equal(DEFAULT_AVATAR_MAX_BYTES, 512 * 1024);
		const declared = fakeFetch(() => imageResponse(PNG, { "content-type": "image/png", "content-length": String(DEFAULT_AVATAR_MAX_BYTES + 1) }));
		assert.equal(await new AvatarFetcher({ fetchImpl: declared.fetchImpl }).get(AVATAR_URL), null);

		const tooBig = chunkedStream(513, 1024);
		const big = fakeFetch(() => imageResponse(tooBig.stream));
		assert.equal(await new AvatarFetcher({ fetchImpl: big.fetchImpl }).get(AVATAR_URL), null);

		const exact = chunkedStream(512, 1024);
		const ok = fakeFetch(() => imageResponse(exact.stream));
		assert.equal((await new AvatarFetcher({ fetchImpl: ok.fetchImpl }).get(AVATAR_URL))?.length, DEFAULT_AVATAR_MAX_BYTES);
	});

	test("HTTP lỗi hoặc body rỗng trả về null", async () =>
	{
		const notFound = fakeFetch(() => imageResponse(PNG, { "content-type": "image/png" }, 404));
		assert.equal(await new AvatarFetcher({ fetchImpl: notFound.fetchImpl }).get(AVATAR_URL), null);
		const empty = fakeFetch(() => imageResponse(new Uint8Array(0)));
		assert.equal(await new AvatarFetcher({ fetchImpl: empty.fetchImpl }).get(AVATAR_URL), null);
	});

	test("content-length vượt giới hạn trả về null", async () =>
	{
		const { fetchImpl } = fakeFetch(() => imageResponse(PNG, { "content-type": "image/png", "content-length": "5000" }));
		assert.equal(await new AvatarFetcher({ fetchImpl, maxBytes: 1000 }).get(AVATAR_URL), null);
	});

	test("body vượt giới hạn khi đọc stream: trả về null và dừng đọc", async () =>
	{
		const source = chunkedStream(100, 400);
		const { fetchImpl } = fakeFetch(() => imageResponse(source.stream));
		assert.equal(await new AvatarFetcher({ fetchImpl, maxBytes: 1000 }).get(AVATAR_URL), null);
		assert.ok(source.pulls() < 10, `đọc ${source.pulls()} khúc`);

		const small = chunkedStream(2, 400);
		const ok = fakeFetch(() => imageResponse(small.stream));
		const bytes = await new AvatarFetcher({ fetchImpl: ok.fetchImpl, maxBytes: 1000 }).get(AVATAR_URL);
		assert.equal(bytes?.length, 800);
	});

	test("lỗi được cache ngắn rồi thử lại sau failureTtl", async () =>
	{
		let now = 0;
		let fail = true;
		const { fetchImpl, calls } = fakeFetch(() =>
		{
			if (fail) throw new Error("mạng lỗi");
			return imageResponse();
		});
		const fetcher = new AvatarFetcher({ fetchImpl, failureTtlMs: 1000, ttlMs: 100_000, now: () => now });
		assert.equal(await fetcher.get(AVATAR_URL), null);
		assert.equal(await fetcher.get(AVATAR_URL), null);
		assert.equal(calls.length, 1);
		fail = false;
		now += 1001;
		assert.deepEqual(await fetcher.get(AVATAR_URL), PNG);
		assert.equal(calls.length, 2);
	});

	test("không bao giờ throw: fetch ném lỗi đồng bộ, fetch reject, hay body đứt giữa chừng", async () =>
	{
		const throwing = new AvatarFetcher({
			fetchImpl: (): Promise<Response> =>
			{
				throw new Error("boom");
			},
		});
		assert.equal(await throwing.get(AVATAR_URL), null);

		const rejecting = new AvatarFetcher({ fetchImpl: () => Promise.reject(new TypeError("fetch failed")) });
		assert.equal(await rejecting.get(AVATAR_URL), null);

		const brokenBody = fakeFetch(() => imageResponse(new ReadableStream<Uint8Array>({
			pull(controller)
			{
				controller.error(new Error("đứt kết nối"));
			},
		})));
		assert.equal(await new AvatarFetcher({ fetchImpl: brokenBody.fetchImpl }).get(AVATAR_URL), null);
	});

	test("LRU: vượt maxEntries thì bỏ URL ít dùng nhất", async () =>
	{
		const { fetchImpl, calls } = fakeFetch(() => imageResponse());
		const fetcher = new AvatarFetcher({ fetchImpl, maxEntries: 2 });
		const url = (id: number): string => `https://cdn.discordapp.com/avatars/${id}/hash.png`;
		await fetcher.get(url(1));
		await fetcher.get(url(2));
		await fetcher.get(url(1));
		await fetcher.get(url(3));
		assert.equal(fetcher.size, 2);
		assert.equal(calls.length, 3);
		await fetcher.get(url(1));
		assert.equal(calls.length, 3);
		await fetcher.get(url(2));
		assert.equal(calls.length, 4);
	});

	test("log chỉ ghi hostname + path, không ghi query string", async (t) =>
	{
		const lines: string[] = [];
		t.mock.method(console, "log", (line: string) => lines.push(line));
		logger.setLevel("debug");
		try
		{
			const { fetchImpl } = fakeFetch(() => imageResponse(PNG, { "content-type": "image/png" }, 500));
			await new AvatarFetcher({ fetchImpl }).get("https://cdn.discordapp.com/avatars/1/abc.png?size=256&ex=secretvalue");
		}
		finally
		{
			logger.setLevel("info");
		}
		assert.ok(lines.some(line => line.includes("cdn.discordapp.com/avatars/1/abc.png")));
		assert.ok(lines.every(line => !line.includes("secretvalue")));
	});
});
