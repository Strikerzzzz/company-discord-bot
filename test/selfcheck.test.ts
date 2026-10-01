import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, utimesSync, writeFileSync, writeSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { createCanvas } from "@napi-rs/canvas";
import { openDatabase } from "../src/db/connection";
import { MIGRATIONS, runMigrations } from "../src/db/migrations";
import { findFontDir } from "../src/discord/cards/fonts";
import { checkConfig, checkEnvFileMode, checkNodeVersion, CheckResult, CheckStep, checkWebConfig, checkWritableDirectory } from "../src/selfcheck/checks";
import { checkDatabaseFile, checkMigrations, DatabaseReadOptions, loadSqliteToolkit, SqliteToolkit } from "../src/selfcheck/database";
import { CanvasToolkit, checkCanvas, checkRendering, loadCanvasToolkit, pngSize } from "../src/selfcheck/render";
import { oneLine, redactSecrets, runSelfCheck, SelfCheckOptions, SelfCheckReport } from "../src/selfcheck/run";

/** Token giả có dạng token bot, mang chuỗi đặc trưng để dò xem có bị in ra không. */
const TOKEN = "MTAwMDAwMDAwMDAwMDAwMDAx.SeLfCk.bi-mat-SELFCHECK-khong-duoc-in-ra";
const SECRET_MARK = "bi-mat-SELFCHECK";
const GUILDS = "100000000000000001,100000000000000002";
const LATEST = Math.max(...MIGRATIONS.map(migration => migration.version));
const IS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;
const POSIX_PERMISSIONS = process.platform !== "win32" && !IS_ROOT;

let root = "";
let caseNumber = 0;
let sqlite: SqliteToolkit;
let tinyPng: Buffer;

before(async () =>
{
	root = mkdtempSync(path.join(tmpdir(), "selfcheck-test-"));
	sqlite = await loadSqliteToolkit();
	tinyPng = createCanvas(4, 4).toBuffer("image/png");
});

after(() =>
{
	rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
});

function freshDir(): string
{
	caseNumber += 1;
	const dir = path.join(root, `case-${caseNumber}`);
	mkdirSync(dir);
	return dir;
}

function envFor(dir: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv
{
	return {
		DISCORD_TOKEN: TOKEN,
		DISCORD_GUILD_IDS: GUILDS,
		DATABASE_PATH: path.join(dir, "data", "bot.db"),
		BACKUP_DIR: path.join(dir, "data", "backups"),
		...overrides,
	};
}

function byStep(results: readonly CheckResult[], step: CheckStep): CheckResult[]
{
	return results.filter(result => result.step === step);
}

function statuses(results: readonly CheckResult[], step: CheckStep): string[]
{
	return byStep(results, step).map(result => result.status);
}

function assertNoSecret(lines: readonly string[]): void
{
	for (const line of lines)
	{
		assert.ok(!line.includes(TOKEN) && !line.includes(SECRET_MARK), `dòng in ra chứa token: ${line}`);
	}
}

function sha256(file: string): string
{
	return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Ghi đè từ trang thứ 2 trở đi (tối đa 8 trang) bằng byte rác: giả lập file hỏng, hoặc bản sao chép đúng lúc bot đang ghi. */
function corruptPages(file: string): void
{
	const size = statSync(file).size;
	const fd = openSync(file, "r+");
	try
	{
		const header = Buffer.alloc(2);
		readSync(fd, header, 0, 2, 16);
		const pageSize = header.readUInt16BE(0) === 1 ? 65536 : header.readUInt16BE(0);
		const garbage = Buffer.alloc(Math.min(size - pageSize, pageSize * 8), 0xa5);
		writeSync(fd, garbage, 0, garbage.length, pageSize);
	}
	finally
	{
		closeSync(fd);
	}
}

interface DbCheck
{
	results: CheckResult[];
	/** Các lần nghỉ giữa hai lần chép lại (ms). */
	sleeps: number[];
	/** Đích của từng lần chép. */
	copies: string[];
}

/**
 * checkDatabaseFile với thư mục tạm riêng và không nghỉ thật giữa các lần chép lại. Sau khi kiểm tra, thư mục tạm phải
 * trống: bản sao và file -journal/-wal/-shm của nó đều đã bị xoá.
 */
async function checkDb(file: string, toolkit: SqliteToolkit = sqlite, options: Partial<DatabaseReadOptions> = {}): Promise<DbCheck>
{
	const tempRoot = freshDir();
	const sleeps: number[] = [];
	const copies: string[] = [];
	const copy = options.copyFile ?? copyFileSync;
	const results = await checkDatabaseFile(file, toolkit, {
		tempRoot,
		sleep: ms =>
		{
			sleeps.push(ms);
			return Promise.resolve();
		},
		...options,
		copyFile: (source, destination) =>
		{
			copies.push(destination);
			copy(source, destination);
		},
	});
	assert.deepEqual(readdirSync(tempRoot), [], "thư mục tạm của bản sao phải được xoá");
	return { results, sleeps, copies };
}

/** Chép rồi làm hỏng bản sao ở những lần chép được chọn (đếm từ 1); `afterCopy` giả lập bot ghi vào file thật. */
function tornCopy(tornAttempts: readonly number[], afterCopy: (source: string, attempt: number) => void = () => undefined): (source: string, destination: string) => void
{
	let attempt = 0;
	return (source, destination) =>
	{
		attempt += 1;
		copyFileSync(source, destination);
		if (tornAttempts.includes(attempt)) corruptPages(destination);
		afterCopy(source, attempt);
	};
}

/** File database thật của bot đã chạy migration tới `upTo`; `userVersion` ghi đè schema version (giả lập DB từ code mới hơn). */
function createDatabase(file: string, upTo: number, userVersion?: number): void
{
	mkdirSync(path.dirname(file), { recursive: true });
	const db = openDatabase(file);
	runMigrations(db, MIGRATIONS.filter(migration => migration.version <= upTo));
	if (userVersion !== undefined) db.pragma(`user_version = ${userVersion}`);
	db.close();
}

function fakeCanvas(overrides: Partial<CanvasToolkit> = {}): CanvasToolkit
{
	const card = { png: tinyPng, fileName: "card.png", width: 4, height: 4 };
	return {
		fontFamily: "Font giả",
		findFontDir: () => "assets/fonts",
		ensureFonts: () => undefined,
		renderRankCard: () => Promise.resolve({ ...card, fileName: "rank.png" }),
		renderLeaderboardCard: () => Promise.resolve({ ...card, fileName: "leaderboard.png" }),
		decodeImage: () => Promise.resolve({ width: 4, height: 4 }),
		sampleAvatar: () => tinyPng,
		...overrides,
	};
}

interface RunOutput extends SelfCheckReport
{
	lines: string[];
	dir: string;
}

/**
 * Máy test đang bận có thể vẽ lâu hơn ngưỡng cảnh báo vẽ chậm của selfcheck. Test chạy toàn bộ dùng đồng hồ đứng yên vì
 * không đo hiệu năng; ngưỡng đó được kiểm riêng bằng đồng hồ giả trong test "vẽ chậm".
 */
const FROZEN_CLOCK = (): number => 0;

/** Chạy selfcheck với môi trường giả hợp lệ (Node 24, Linux, SQLite thật, canvas giả nhanh), ghi đè từng phần theo test. */
async function run(overrides: Partial<SelfCheckOptions> = {}, envOverrides: NodeJS.ProcessEnv = {}, dir = freshDir()): Promise<RunOutput>
{
	const lines: string[] = [];
	const report = await runSelfCheck({
		env: envFor(dir, envOverrides),
		nodeVersion: "24.9.0",
		platform: "linux",
		arch: "x64",
		cwd: dir,
		write: line => lines.push(line),
		loadCanvas: () => Promise.resolve(fakeCanvas()),
		now: FROZEN_CLOCK,
		...overrides,
	});
	assertNoSecret(lines);
	for (const line of lines)
	{
		assert.ok(!/\p{Cc}/u.test(line), `dòng in ra có ký tự điều khiển: ${JSON.stringify(line)}`);
	}
	return { ...report, lines, dir };
}

describe("selfcheck: phiên bản Node", () =>
{
	test("dưới 22.14 là lỗi, 24 là chuẩn, bản khác chạy được nhưng cảnh báo", () =>
	{
		const cases: [string, string][] = [
			["18.20.4", "fail"],
			["22.13.1", "fail"],
			["22.14.0", "warn"],
			["22.23.2", "warn"],
			["23.11.0", "warn"],
			["24.0.0", "ok"],
			["v24.9.1", "ok"],
			["26.0.0", "warn"],
			["không-phải-số", "fail"],
		];
		for (const [version, expected] of cases)
		{
			assert.equal(checkNodeVersion(version).status, expected, version);
		}
		assert.match(checkNodeVersion("22.13.1").message, /22\.14/);
	});
});

describe("selfcheck: cấu hình", () =>
{
	test("đủ cấu hình: báo có token, số guild và đường dẫn như loadConfig", () =>
	{
		const dir = freshDir();
		const { results, paths } = checkConfig(envFor(dir, { BACKUP_KEEP: "30" }));
		assert.deepEqual(results.map(result => result.status), ["ok", "ok", "ok", "ok", "ok"]);
		assert.equal(results[0].message, "DISCORD_TOKEN: có.");
		assert.match(results[1].message, /2 guild hợp lệ/);
		assert.match(results[2].message, /giữ 30 bản/);
		assert.deepEqual(paths, { databasePath: path.join(dir, "data", "bot.db"), backupDir: path.join(dir, "data", "backups") });
		assertNoSecret(results.map(result => result.message));
	});

	test("thiếu token: lỗi, nhưng vẫn kiểm tra guild và đường dẫn", () =>
	{
		const dir = freshDir();
		const { results, paths } = checkConfig(envFor(dir, { DISCORD_TOKEN: "   " }));
		assert.deepEqual(results.map(result => result.status), ["fail", "ok", "ok", "ok", "ok"]);
		assert.match(results[0].message, /DISCORD_TOKEN: chưa có/);
		assert.ok(paths);
	});

	test("token không giống token bot: cảnh báo, không in token hay độ dài", () =>
	{
		const secret = "client-secret-SELFCHECK-abcdef";
		const { results } = checkConfig(envFor(freshDir(), { DISCORD_TOKEN: secret }));
		assert.equal(results[0].status, "warn");
		assert.ok(!results[0].message.includes(secret));
		assert.ok(!results[0].message.includes(String(secret.length)));
	});

	test("guild ID sai: lỗi chỉ nêu vị trí mục sai, không in giá trị; đường dẫn vẫn dùng được cho các bước sau", () =>
	{
		const { results, paths } = checkConfig(envFor(freshDir(), { DISCORD_GUILD_IDS: "abc,100000000000000001" }));
		assert.deepEqual(statuses(results, "config"), ["ok", "fail", "ok", "ok", "ok"]);
		assert.match(results[1].message, /^DISCORD_GUILD_IDS không hợp lệ: mục thứ 1 không phải guild ID/);
		assert.ok(!results[1].message.includes("abc"));
		assert.ok(paths);

		const secret = "client-secret-SELFCHECK-guild";
		const several = checkConfig(envFor(freshDir(), { DISCORD_GUILD_IDS: `100000000000000001,${secret}, ,x\ny,12` })).results[1];
		assert.equal(several.status, "fail");
		assert.match(several.message, /mục thứ 2, 4, 5 không phải guild ID/);
		assert.ok(!several.message.includes(secret) && !several.message.includes("x") && !several.message.includes("\n"), several.message);

		const many = checkConfig(envFor(freshDir(), { DISCORD_GUILD_IDS: "a,b,c,d,e,f,g" })).results[1];
		assert.match(many.message, /mục thứ 1, 2, 3, 4, 5 và 2 mục khác/);
		assert.match(checkConfig(envFor(freshDir(), { DISCORD_GUILD_IDS: " , ," })).results[1].message, /không có guild ID nào/);
	});

	test("BACKUP_KEEP sai và guild sai: báo cả hai lỗi; không có đường dẫn", () =>
	{
		const { results, paths } = checkConfig(envFor(freshDir(), { DISCORD_GUILD_IDS: "", BACKUP_KEEP: "0" }));
		assert.deepEqual(results.map(result => result.status), ["ok", "fail", "fail", "ok", "ok"]);
		assert.match(results[1].message, /DISCORD_GUILD_IDS/);
		assert.match(results[2].message, /BACKUP_KEEP/);
		assert.equal(paths, null);
	});

	test("trang web quản trị: tắt khi không có WEB_PORT; bật thì báo cổng, địa chỉ, redirect; thiếu hay sai thì lỗi không in secret", () =>
	{
		const off = checkWebConfig({});
		assert.equal(off.status, "ok");
		assert.match(off.message, /tắt/);

		const secret = "client-secret-SELFCHECK-web";
		const on = checkWebConfig({ WEB_PORT: "8787", WEB_BASE_URL: "http://192.168.0.206:8787/", DISCORD_CLIENT_SECRET: secret });
		assert.equal(on.status, "ok");
		assert.match(on.message, /0\.0\.0\.0:8787/);
		assert.match(on.message, /http:\/\/192\.168\.0\.206:8787\/auth\/callback/);
		assert.ok(!on.message.includes(secret));

		const mismatch = checkWebConfig({ WEB_PORT: "8787", WEB_BASE_URL: "http://192.168.0.206:9000", DISCORD_CLIENT_SECRET: secret });
		assert.equal(mismatch.status, "warn");
		assert.match(mismatch.message, /9000.*8787/u);
		assert.equal(checkWebConfig({ WEB_PORT: "8443", WEB_BASE_URL: "https://admin.example", DISCORD_CLIENT_SECRET: secret }).status, "warn", "https không ghi cổng = 443");

		for (const env of [
			{ WEB_PORT: "8787", WEB_BASE_URL: "http://192.168.0.206:8787" },
			{ WEB_PORT: "80", WEB_BASE_URL: "http://192.168.0.206", DISCORD_CLIENT_SECRET: secret },
			{ WEB_PORT: "8787", WEB_BASE_URL: "ftp://x/y", DISCORD_CLIENT_SECRET: secret },
			{ WEB_PORT: "8787", WEB_BASE_URL: "http://192.168.0.206:8787/admin", DISCORD_CLIENT_SECRET: secret },
			{ WEB_PORT: "8787", WEB_BASE_URL: "http://192.168.0.206:8787", DISCORD_CLIENT_SECRET: `${secret} x` },
		])
		{
			const result = checkWebConfig(env);
			assert.equal(result.status, "fail", JSON.stringify(env.WEB_BASE_URL));
			assert.ok(!result.message.includes(secret), result.message);
		}
	});

	test("LOG_LEVEL lạ: cảnh báo bot sẽ dùng info, không in lại giá trị (kể cả giá trị có xuống dòng hay mã ANSI)", () =>
	{
		for (const value of ["verbose", "debug\n✅ Môi trường sẵn sàng.", "\u001b[31mSECRET-LOG"])
		{
			const { results } = checkConfig(envFor(freshDir(), { LOG_LEVEL: value }));
			const last = results[results.length - 1];
			assert.equal(last.status, "warn");
			assert.equal(last.message, "LOG_LEVEL không hợp lệ, bot sẽ dùng info. Dùng một trong: debug, info, warn, error.");
		}
		assert.equal(checkConfig(envFor(freshDir(), { LOG_LEVEL: "warn" })).results.length, 5);
	});

	test("token quá ngắn: lỗi \"không giống token bot\", không in token hay độ dài", () =>
	{
		for (const token of ["Zq9", "q".repeat(19)])
		{
			const [result] = checkConfig(envFor(freshDir(), { DISCORD_TOKEN: `  ${token}  ` })).results;
			assert.equal(result.status, "fail", token);
			assert.match(result.message, /không giống token bot/);
			assert.ok(!result.message.includes(token) && !/\d/.test(result.message), result.message);
		}
		assert.equal(checkConfig(envFor(freshDir(), { DISCORD_TOKEN: "q".repeat(20) })).results[0].status, "warn");
	});

	test("token còn khoảng trắng hoặc xuống dòng ở giữa sau khi trim: lỗi, bot chắc chắn đăng nhập lỗi", () =>
	{
		for (const token of [`${TOKEN.slice(0, 30)} ${TOKEN.slice(30)}`, `${TOKEN.slice(0, 30)}\n${TOKEN.slice(30)}`, `${TOKEN}\t.x`])
		{
			const [result] = checkConfig(envFor(freshDir(), { DISCORD_TOKEN: ` ${token}\n` })).results;
			assert.equal(result.status, "fail");
			assert.match(result.message, /khoảng trắng hoặc xuống dòng ở giữa/);
			assertNoSecret([result.message]);
		}
	});
});

describe("selfcheck: thư mục ghi được", () =>
{
	test("thư mục có sẵn: ghi được và không để lại file tạm", () =>
	{
		const dir = freshDir();
		const result = checkWritableDirectory("Thư mục database", dir);
		assert.equal(result.status, "ok");
		assert.deepEqual(readdirSync(dir), []);
	});

	test("thư mục chưa có: tạo thử được rồi xoá lại toàn bộ phần vừa tạo", () =>
	{
		const dir = freshDir();
		const result = checkWritableDirectory("Thư mục backup", path.join(dir, "a", "b", "c"));
		assert.equal(result.status, "ok");
		assert.match(result.message, /chưa có; đã tạo thử rồi xoá/);
		assert.deepEqual(readdirSync(dir), []);
	});

	test("đường dẫn đi qua một file: lỗi, không tạo gì", () =>
	{
		const dir = freshDir();
		writeFileSync(path.join(dir, "file.txt"), "x");
		const nested = checkWritableDirectory("Thư mục database", path.join(dir, "file.txt", "data"));
		assert.equal(nested.status, "fail");
		const itself = checkWritableDirectory("Thư mục database", path.join(dir, "file.txt"));
		assert.equal(itself.status, "fail");
		assert.match(itself.message, /không phải thư mục/);
		assert.deepEqual(readdirSync(dir), ["file.txt"]);
	});

	test("thư mục không có quyền ghi: lỗi kèm gợi ý", { skip: !POSIX_PERMISSIONS }, () =>
	{
		const dir = freshDir();
		const locked = path.join(dir, "locked");
		mkdirSync(locked, { mode: 0o500 });
		try
		{
			const result = checkWritableDirectory("Thư mục database", locked);
			assert.equal(result.status, "fail");
			assert.match(result.message, /quyền ghi/);
		}
		finally
		{
			chmodSync(locked, 0o700);
		}
	});
});

describe("selfcheck: database", () =>
{
	test("chưa có database: cảnh báo sẽ được tạo, không tạo file", async () =>
	{
		const file = path.join(freshDir(), "bot.db");
		const { results } = await checkDb(file);
		assert.deepEqual(results.map(result => result.status), ["warn"]);
		assert.match(results[0].message, /sẽ được tạo khi bot chạy/);
		assert.equal(existsSync(file), false);
	});

	test("database khớp code: ổn; file thật không đổi, không sinh -wal/-shm, bản sao chỉ nằm trong thư mục tạm và được xoá", async () =>
	{
		const dir = freshDir();
		const file = path.join(dir, "bot.db");
		createDatabase(file, LATEST);
		const original = sha256(file);
		const opened: string[] = [];
		const spy: SqliteToolkit = {
			...sqlite,
			openCopy: copy =>
			{
				opened.push(copy);
				return sqlite.openCopy(copy);
			},
		};
		const { results, copies, sleeps } = await checkDb(file, spy);
		assert.deepEqual(results.map(result => result.status), ["ok", "ok"]);
		assert.match(results[0].message, new RegExp(`schema version ${LATEST}, khớp code`));
		assert.match(results[1].message, /quick_check trên bản sao trong thư mục tạm/);
		assert.equal(sha256(file), original);
		assert.deepEqual(readdirSync(dir), ["bot.db"]);
		assert.equal(copies.length, 1);
		assert.deepEqual(opened, copies);
		assert.ok(!copies[0].startsWith(dir), copies[0]);
		assert.equal(existsSync(path.dirname(copies[0])), false, "thư mục tạm riêng của lần kiểm tra đã bị xoá");
		assert.deepEqual(sleeps, []);
	});

	test("database cũ hơn code: cảnh báo, chạy thử migration trên bản sao, file thật giữ version cũ", async () =>
	{
		const dir = freshDir();
		const file = path.join(dir, "bot.db");
		createDatabase(file, 2);
		const original = sha256(file);
		const { results } = await checkDb(file);
		assert.deepEqual(results.map(result => result.status), ["warn", "ok", "ok"]);
		assert.match(results[0].message, new RegExp(`schema version 2, cũ hơn code \\(${LATEST}\\)`));
		assert.match(results[2].message, new RegExp(`Chạy thử ${LATEST - 2} migration \\(version 2 → ${LATEST}\\)`));
		assert.equal(sha256(file), original);
		assert.deepEqual(readdirSync(dir), ["bot.db"]);
		const db = openDatabase(file);
		assert.equal(db.pragma("user_version", { simple: true }), 2);
		db.close();
	});

	test("chạy thử migration lỗi trên bản sao (lỗi lặp lại, file không đổi): báo lỗi", async () =>
	{
		const file = path.join(freshDir(), "bot.db");
		createDatabase(file, 1);
		const broken: SqliteToolkit = { ...sqlite, runMigrations: () => { throw new Error("migration hỏng"); } };
		const { results, sleeps } = await checkDb(file, broken);
		assert.deepEqual(results.map(result => result.status), ["warn", "ok", "fail"]);
		assert.match(results[2].message, /migration hỏng/);
		assert.equal(sleeps.length, 2);
	});

	test("database mới hơn code: lỗi, code cũ hơn database", async () =>
	{
		const file = path.join(freshDir(), "bot.db");
		createDatabase(file, LATEST, LATEST + 1);
		const { results } = await checkDb(file);
		assert.deepEqual(results.map(result => result.status), ["fail"]);
		assert.match(results[0].message, /mới hơn code/);
	});

	test("file không phải SQLite hoặc rỗng", async () =>
	{
		const dir = freshDir();
		const text = path.join(dir, "text.db");
		writeFileSync(text, "đây không phải database ".repeat(20));
		assert.deepEqual((await checkDb(text)).results.map(result => result.status), ["fail"]);
		const empty = path.join(dir, "empty.db");
		writeFileSync(empty, "");
		assert.deepEqual((await checkDb(empty)).results.map(result => result.status), ["warn"]);
		assert.deepEqual((await checkDb(dir)).results.map(result => result.status), ["fail"]);
	});

	test("bot đang chạy (file -wal còn dữ liệu): cảnh báo và vẫn kiểm tra được", async () =>
	{
		const file = path.join(freshDir(), "bot.db");
		mkdirSync(path.dirname(file), { recursive: true });
		const running = openDatabase(file);
		try
		{
			runMigrations(running);
			const { results } = await checkDb(file);
			assert.equal(results[0].status, "warn");
			assert.match(results[0].message, /-wal chưa gộp/);
			assert.ok(results.every(result => result.status !== "fail"));
		}
		finally
		{
			running.close();
		}
	});

	test("file database không ghi được: lỗi; bản sao vẫn chạy thử migration được", { skip: IS_ROOT }, async () =>
	{
		const file = path.join(freshDir(), "bot.db");
		createDatabase(file, LATEST - 1);
		chmodSync(file, 0o400);
		try
		{
			const { results } = await checkDb(file);
			assert.equal(results[0].status, "fail");
			assert.match(results[0].message, /không ghi được/);
			assert.deepEqual(results.slice(1).map(result => result.status), ["warn", "ok", "ok"]);
		}
		finally
		{
			chmodSync(file, 0o600);
		}
	});

	test("bản sao bị rách một lần (chép đúng lúc bot checkpoint): chép lại, kiểm lại, kết quả ổn", async () =>
	{
		const file = path.join(freshDir(), "bot.db");
		createDatabase(file, LATEST);
		const original = sha256(file);
		const { results, sleeps, copies } = await checkDb(file, sqlite, { copyFile: tornCopy([1]) });
		assert.deepEqual(results.map(result => result.status), ["ok", "ok"]);
		assert.equal(copies.length, 2);
		assert.equal(sleeps.length, 1);
		assert.ok(sleeps[0] > 0);
		assert.equal(sha256(file), original);
	});

	test("bản sao lỗi cả 3 lần, file thật đổi thời điểm sửa giữa các lần chép (bot đang ghi): chỉ cảnh báo, không khuyên khôi phục", async () =>
	{
		const dir = freshDir();
		const file = path.join(dir, "bot.db");
		createDatabase(file, LATEST);
		const original = sha256(file);
		const base = statSync(file).mtime.getTime();
		const touch = (source: string, attempt: number): void => utimesSync(source, new Date(base), new Date(base + attempt * 5000));
		const { results, sleeps, copies } = await checkDb(file, sqlite, { copyFile: tornCopy([1, 2, 3], touch) });
		assert.deepEqual(results.map(result => result.status), ["ok", "warn"]);
		assert.match(results[1].message, /kết quả kiểm tra database không tin cậy khi bot đang ghi/);
		assert.match(results[1].message, /Dừng bot rồi chạy lại selfcheck để kiểm chắc chắn/);
		assert.ok(!/khôi phục từ/i.test(results[1].message), results[1].message);
		assert.equal(copies.length, 3);
		assert.equal(sleeps.length, 2);
		assert.equal(sha256(file), original);
		assert.deepEqual(readdirSync(dir), ["bot.db"]);
	});

	test("bản sao lỗi cả 3 lần và file -wal có dữ liệu: chỉ cảnh báo, không khuyên khôi phục", async () =>
	{
		const file = path.join(freshDir(), "bot.db");
		createDatabase(file, LATEST);
		writeFileSync(`${file}-wal`, Buffer.alloc(4096, 1));
		const { results } = await checkDb(file, sqlite, { copyFile: tornCopy([1, 2, 3]) });
		assert.deepEqual(results.map(result => result.status), ["warn", "ok", "warn"]);
		assert.match(results[0].message, /-wal chưa gộp/);
		assert.match(results[2].message, /không tin cậy khi bot đang ghi/);
		assert.ok(!/khôi phục từ/i.test(results[2].message), results[2].message);
	});

	test("database hỏng thật (lỗi lặp lại, file không đổi, không có -wal): lỗi kèm lời khuyên khôi phục backup", async () =>
	{
		const dir = freshDir();
		const file = path.join(dir, "bot.db");
		createDatabase(file, LATEST);
		corruptPages(file);
		const corrupted = sha256(file);
		const { results, sleeps, copies } = await checkDb(file);
		assert.deepEqual(results.map(result => result.status), ["ok", "fail"]);
		assert.match(results[1].message, /có dấu hiệu hỏng/);
		assert.match(results[1].message, /lặp lại ở cả 3 lần chép/);
		assert.match(results[1].message, /Khôi phục từ bản sao lưu/);
		assert.ok(!/\p{Cc}/u.test(results[1].message), results[1].message);
		assert.equal(copies.length, 3);
		assert.equal(sleeps.length, 2);
		assert.equal(sha256(file), corrupted);
		assert.deepEqual(readdirSync(dir), ["bot.db"]);
	});

	test("ổ tạm không đủ chỗ: cảnh báo, chỉ kiểm tra header, không chép", async () =>
	{
		const file = path.join(freshDir(), "bot.db");
		createDatabase(file, LATEST);
		const { results, copies } = await checkDb(file, sqlite, { freeBytes: () => 1024 * 1024 });
		assert.deepEqual(results.map(result => result.status), ["ok", "warn"]);
		assert.match(results[1].message, /không đủ chỗ cho bản sao database/);
		assert.deepEqual(copies, []);

		const unknown = await checkDb(file, sqlite, { freeBytes: () => null });
		assert.deepEqual(unknown.results.map(result => result.status), ["ok", "ok"]);
	});

	test("không chép được sang thư mục tạm, hoặc không tạo được thư mục tạm: cảnh báo kèm gợi ý", async () =>
	{
		const file = path.join(freshDir(), "bot.db");
		createDatabase(file, LATEST);
		const full = (): void =>
		{
			throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
		};
		const { results } = await checkDb(file, sqlite, { copyFile: full });
		assert.deepEqual(results.map(result => result.status), ["ok", "warn"]);
		assert.match(results[1].message, /Không chép được database sang thư mục tạm/);
		assert.match(results[1].message, /Ổ đĩa đã đầy/);

		const missingRoot = await checkDatabaseFile(file, sqlite, { tempRoot: path.join(freshDir(), "khong-co") });
		assert.deepEqual(missingRoot.map(result => result.status), ["ok", "warn"]);
		assert.match(missingRoot[1].message, /Không tạo được thư mục tạm/);
	});

	test("migration chạy được trên database trống trong bộ nhớ", () =>
	{
		const result = checkMigrations(sqlite);
		assert.equal(result.status, "ok");
		assert.match(result.message, new RegExp(`schema version ${LATEST}`));
		assert.equal(checkMigrations({ ...sqlite, latestVersion: LATEST + 1 }).status, "fail");
	});
});

describe("selfcheck: canvas, font và vẽ ảnh", () =>
{
	test("nạp canvas thật, tìm và đăng ký được font, vẽ được thẻ rank và bảng xếp hạng", async () =>
	{
		const canvas = await checkCanvas(loadCanvasToolkit, "linux", "x64");
		assert.deepEqual(canvas.results.map(result => result.status), ["ok", "ok"]);
		assert.ok(canvas.toolkit);
		const rendered = await checkRendering(canvas.toolkit, () => performance.now());
		for (const result of rendered)
		{
			assert.ok(result.status === "ok" || (result.status === "warn" && result.message.includes(" chậm: ")), result.message);
		}
		assert.match(rendered[0].message, /^Vẽ thẻ rank( chậm)?: PNG 1000×\d+, \d+ KB, vẽ mất \d+ ms/);
		assert.match(rendered[1].message, /^Vẽ bảng xếp hạng( chậm)?: PNG 1000×\d+/);
	});

	test("canvas không nạp được: lỗi kèm gợi ý npm ci, bỏ qua font", async () =>
	{
		const canvas = await checkCanvas(() => Promise.reject(new Error("Cannot find module '@napi-rs/canvas-linux-x64-gnu'")), "linux", "x64");
		assert.deepEqual(canvas.results.map(result => result.status), ["fail"]);
		assert.match(canvas.results[0].message, /npm ci/);
		assert.equal(canvas.toolkit, null);
	});

	test("không tìm thấy font: lỗi ở bước font", async () =>
	{
		const missing = freshDir();
		const canvas = await checkCanvas(() => Promise.resolve(fakeCanvas({ findFontDir: () => findFontDir(missing) })), "linux", "x64");
		assert.deepEqual(canvas.results.map(result => result.status), ["ok", "fail"]);
		assert.match(canvas.results[1].message, /Không tìm thấy font/);
		assert.equal(canvas.toolkit, null);
	});

	test("ảnh vẽ ra hỏng, vẽ lỗi, đọc lại lệch kích thước hoặc vẽ chậm", async () =>
	{
		const notPng = fakeCanvas({ renderRankCard: () => Promise.resolve({ png: Buffer.from("không phải PNG"), fileName: "rank.png", width: 4, height: 4 }) });
		assert.deepEqual((await checkRendering(notPng, () => 0)).map(result => result.status), ["fail", "ok"]);

		const throws = fakeCanvas({ renderLeaderboardCard: () => Promise.reject(new Error("Skia lỗi")) });
		const thrown = await checkRendering(throws, () => 0);
		assert.equal(thrown[1].status, "fail");
		assert.match(thrown[1].message, /Skia lỗi/);

		const mismatch = fakeCanvas({ decodeImage: () => Promise.resolve({ width: 1, height: 1 }) });
		assert.deepEqual((await checkRendering(mismatch, () => 0)).map(result => result.status), ["fail", "fail"]);

		let clock = 0;
		const slow = await checkRendering(fakeCanvas(), () => (clock += 3000));
		assert.deepEqual(slow.map(result => result.status), ["warn", "warn"]);
		assert.match(slow[0].message, /chậm/);
	});

	test("pngSize đọc kích thước từ IHDR, từ chối bytes không phải PNG", () =>
	{
		assert.deepEqual(pngSize(tinyPng), { width: 4, height: 4 });
		assert.equal(pngSize(Buffer.from("xin chào")), null);
		assert.equal(pngSize(Buffer.alloc(0)), null);
	});
});

describe("selfcheck: quyền file .env", () =>
{
	test("600 là ổn; group hoặc người khác có quyền thì cảnh báo", () =>
	{
		assert.equal(checkEnvFileMode("/opt/bot/.env", 0o100600).status, "ok");
		assert.equal(checkEnvFileMode("/opt/bot/.env", 0o100400).status, "ok");
		const readable = checkEnvFileMode("/opt/bot/.env", 0o100644);
		assert.equal(readable.status, "warn");
		assert.match(readable.message, /644/);
		assert.match(readable.message, /chmod 600/);
		assert.equal(checkEnvFileMode("/opt/bot/.env", 0o100640).status, "warn");
	});
});

describe("selfcheck: chạy toàn bộ", () =>
{
	test("môi trường đủ (SQLite và canvas thật): exit code 0, in từng bước và tổng kết, không lộ token", async () =>
	{
		const { results, lines, exitCode } = await run({ loadCanvas: undefined });
		assert.equal(exitCode, 0);
		assert.equal(lines[0], "Tự kiểm tra môi trường (selfcheck): không kết nối Discord, không gọi mạng, không sửa database.");
		assert.match(lines[lines.length - 1], /^Tổng kết: \d+ ✅ · 1 ⚠️ · 0 ❌\. Bật bot được/);
		assert.deepEqual(results.filter(result => result.status !== "ok").map(result => result.step), ["database"]);
		for (const step of ["node", "config", "directories", "sqlite", "migrations", "canvas", "fonts", "render"] as const)
		{
			assert.ok(byStep(results, step).length > 0, step);
		}
		assert.equal(results.length + 3, lines.length);
		assert.ok(lines.includes("✅ DISCORD_TOKEN: có."));
	});

	test("thiếu token: exit code 1", async () =>
	{
		const { lines, exitCode } = await run({}, { DISCORD_TOKEN: "" });
		assert.equal(exitCode, 1);
		assert.ok(lines.some(line => line.startsWith("❌ DISCORD_TOKEN: chưa có.")));
		assert.match(lines[lines.length - 1], /1 ❌\. Có lỗi/);
	});

	test("token bị dán nhầm vào DISCORD_GUILD_IDS: báo lỗi nhưng không in token", async () =>
	{
		const { lines, exitCode } = await run({}, { DISCORD_GUILD_IDS: TOKEN });
		assert.equal(exitCode, 1);
		assert.ok(lines.some(line => line.startsWith("❌ DISCORD_GUILD_IDS không hợp lệ: mục thứ 1 không phải guild ID")));
		assert.ok(!lines.some(line => line.includes("[đã ẩn]")));
	});

	test("token rất ngắn: dòng token báo lỗi, output không bị thay chuỗi thành [đã ẩn]", async () =>
	{
		const { lines, exitCode } = await run({}, { DISCORD_TOKEN: "e" });
		assert.equal(exitCode, 1);
		assert.equal(lines[0], "Tự kiểm tra môi trường (selfcheck): không kết nối Discord, không gọi mạng, không sửa database.");
		assert.ok(lines.some(line => line.startsWith("❌ DISCORD_TOKEN: có, nhưng quá ngắn, không giống token bot")));
		assert.ok(!lines.some(line => line.includes("[đã ẩn]")), lines.join("\n"));
		assert.equal(redactSecrets(`x ${"q".repeat(20)} y`, { DISCORD_TOKEN: "q".repeat(20) }), "x [đã ẩn] y");
		assert.equal(redactSecrets(`x ${"q".repeat(19)} y`, { DISCORD_TOKEN: ` ${"q".repeat(19)} ` }), `x ${"q".repeat(19)} y`);
	});

	test("token có xuống dòng ở giữa: lỗi, không in token, không có dòng giả", async () =>
	{
		const token = `${TOKEN.slice(0, 30)}\n${TOKEN.slice(30)}`;
		const { lines, exitCode } = await run({ loadSqlite: () => Promise.reject(new Error(`lỗi lạ ${token}`)) }, { DISCORD_TOKEN: token });
		assert.equal(exitCode, 1);
		assert.ok(lines.some(line => line.startsWith("❌ DISCORD_TOKEN: có khoảng trắng hoặc xuống dòng ở giữa")));
		assert.ok(lines.some(line => line.includes("lỗi lạ [đã ẩn]")));
	});

	test("chạy bằng root trên Linux: cảnh báo kết quả kiểm quyền ghi không có ý nghĩa", async () =>
	{
		const asRoot = await run({ uid: 0 });
		const rootLines = byStep(asRoot.results, "directories").filter(result => result.message.includes("khi chạy bằng root"));
		assert.deepEqual(rootLines.map(result => result.status), ["warn"]);
		assert.match(rootLines[0].message, /không có ý nghĩa khi chạy bằng root; chạy dưới user của service \(docs\/DEPLOY\.md mục 3\.1\)/);
		assert.equal(asRoot.exitCode, 0);

		for (const options of [{ uid: 1001 }, { uid: 0, platform: "win32" as const }, {}])
		{
			const { results } = await run(options);
			assert.ok(!results.some(result => result.message.includes("khi chạy bằng root")), JSON.stringify(options));
		}
	});

	test("lỗi từ thư viện có chứa token cũng bị che", async () =>
	{
		const { lines, exitCode } = await run({ loadSqlite: () => Promise.reject(new Error(`lỗi lạ ${TOKEN}`)) });
		assert.equal(exitCode, 1);
		assert.ok(lines.some(line => line.includes("lỗi lạ [đã ẩn]")));
	});

	test("Node quá cũ: exit code 1", async () =>
	{
		const { results, exitCode } = await run({ nodeVersion: "20.18.0" });
		assert.equal(exitCode, 1);
		assert.deepEqual(statuses(results, "node"), ["fail"]);
	});

	test("better-sqlite3 không nạp được: lỗi, bỏ qua database nhưng vẫn kiểm tra font và vẽ ảnh", async () =>
	{
		const { results, exitCode } = await run({ loadSqlite: () => Promise.reject(new Error("invalid ELF header")) });
		assert.equal(exitCode, 1);
		assert.deepEqual(statuses(results, "sqlite"), ["fail"]);
		assert.deepEqual(statuses(results, "database"), ["warn"]);
		assert.deepEqual(statuses(results, "migrations"), []);
		assert.deepEqual(statuses(results, "render"), ["ok", "ok"]);
	});

	test("canvas không nạp được hoặc không thấy font: exit code 1, bỏ qua vẽ ảnh", async () =>
	{
		const noCanvas = await run({ loadCanvas: () => Promise.reject(new Error("không có binary")) });
		assert.equal(noCanvas.exitCode, 1);
		assert.deepEqual(statuses(noCanvas.results, "canvas"), ["fail"]);
		assert.deepEqual(statuses(noCanvas.results, "render"), ["warn"]);

		const missing = freshDir();
		const noFont = await run({ loadCanvas: () => Promise.resolve(fakeCanvas({ findFontDir: () => findFontDir(missing) })) });
		assert.equal(noFont.exitCode, 1);
		assert.deepEqual(statuses(noFont.results, "fonts"), ["fail"]);
		assert.deepEqual(statuses(noFont.results, "render"), ["warn"]);
	});

	test("database mới hơn code: exit code 1; database cũ hơn: exit code 0", async () =>
	{
		const newer = freshDir();
		createDatabase(path.join(newer, "data", "bot.db"), LATEST, LATEST + 1);
		assert.equal((await run({}, {}, newer)).exitCode, 1);

		const older = freshDir();
		createDatabase(path.join(older, "data", "bot.db"), 1);
		const report = await run({}, {}, older);
		assert.equal(report.exitCode, 0);
		assert.deepEqual(statuses(report.results, "database"), ["warn", "ok", "ok"]);
	});

	test("thư mục database không ghi được: exit code 1", async () =>
	{
		const dir = freshDir();
		writeFileSync(path.join(dir, "data"), "file chắn đường");
		const { results, exitCode } = await run({}, {}, dir);
		assert.equal(exitCode, 1);
		assert.ok(statuses(results, "directories").includes("fail"));
	});

	test("cấu hình lỗi tới mức không có đường dẫn: bỏ qua thư mục và database", async () =>
	{
		const { results, exitCode } = await run({}, { BACKUP_KEEP: "khong-phai-so" });
		assert.equal(exitCode, 1);
		assert.deepEqual(statuses(results, "directories"), ["warn"]);
		assert.deepEqual(statuses(results, "database"), []);
		assert.deepEqual(statuses(results, "migrations"), ["ok"]);
	});

	test("file .env: chỉ kiểm tra trên Linux; người khác đọc được thì cảnh báo", async () =>
	{
		const dir = freshDir();
		const envFile = path.join(dir, ".env");
		writeFileSync(envFile, "DISCORD_TOKEN=\n");
		chmodSync(envFile, 0o644);
		const linux = await run({}, {}, dir);
		assert.deepEqual(statuses(linux.results, "env-file"), ["warn"]);
		const windows = await run({ platform: "win32" }, {}, dir);
		assert.deepEqual(statuses(windows.results, "env-file"), []);
		if (POSIX_PERMISSIONS)
		{
			chmodSync(envFile, 0o600);
			assert.deepEqual(statuses((await run({}, {}, dir)).results, "env-file"), ["ok"]);
		}
	});
});

describe("selfcheck: che token", () =>
{
	test("che token nguyên văn, token có dấu cách thừa và chuỗi có dạng token", () =>
	{
		const env = { DISCORD_TOKEN: `  ${TOKEN}  ` };
		assert.equal(redactSecrets(`a ${TOKEN} b`, env), "a [đã ẩn] b");
		assert.equal(redactSecrets(`a  ${TOKEN}   b`, env), "a[đã ẩn] b");
		assert.ok(!redactSecrets("x MTAwMDAwMDAwMDAwMDAwMDAy.AbCdEf.abcdefghijklmnopqrstuvwxyz123 y", {}).includes("abcdefghijklmnopqrstuvwxyz123"));
		assert.equal(redactSecrets("không có gì", { DISCORD_TOKEN: "   " }), "không có gì");
	});

	test("mỗi kết quả là đúng một dòng: ký tự điều khiển (xuống dòng, ESC của mã ANSI) thành dấu cách", () =>
	{
		assert.equal(oneLine("a\nb\r\nc\u001b[31md\te"), "a b  c [31md e");
		assert.equal(oneLine("Tổng kết: 1 ✅ · 0 ⚠️ · 0 ❌."), "Tổng kết: 1 ✅ · 0 ⚠️ · 0 ❌.");
	});
});

describe("selfcheck: entry point build/selfcheck.js", () =>
{
	const entry = path.join(__dirname, "..", "src", "selfcheck.js");

	function childEnv(dir: string, overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv
	{
		const env: NodeJS.ProcessEnv = { ...process.env };
		for (const name of ["DISCORD_TOKEN", "DISCORD_GUILD_IDS", "DATABASE_PATH", "BACKUP_DIR", "BACKUP_KEEP", "LOG_LEVEL", "NODE_TEST_CONTEXT", "NODE_OPTIONS"])
		{
			delete env[name];
		}
		return { ...env, ...envFor(dir), ...overrides };
	}

	test("chạy thật như npm run selfcheck: exit code 0 khi đủ, 1 khi thiếu token; stdout không chứa token", () =>
	{
		const dir = freshDir();
		const good = spawnSync(process.execPath, [entry], { cwd: dir, env: childEnv(dir, {}), encoding: "utf8", timeout: 60_000 });
		assert.equal(good.status, 0, good.stdout + good.stderr);
		assert.match(good.stdout, /Tổng kết: \d+ ✅ · \d+ ⚠️ · 0 ❌/);
		assert.match(good.stdout, /(✅ Vẽ bảng xếp hạng|⚠️ Vẽ bảng xếp hạng chậm): PNG/);
		assertNoSecret([good.stdout, good.stderr]);

		const bad = spawnSync(process.execPath, [entry], { cwd: dir, env: childEnv(dir, { DISCORD_TOKEN: "" }), encoding: "utf8", timeout: 60_000 });
		assert.equal(bad.status, 1, bad.stdout + bad.stderr);
		assert.match(bad.stdout, /❌ DISCORD_TOKEN: chưa có\./);
		assertNoSecret([bad.stdout, bad.stderr]);
		assert.deepEqual(readdirSync(dir), []);
	});
});
