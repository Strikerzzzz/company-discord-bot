import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDatabase } from "../src/db/connection";
import { runMigrations } from "../src/db/migrations";
import { formatAuditEntry } from "../src/discord/views/admin";
import { cutText, displaySprintName, isNumericOnlyName, normalizeAnswers, sprintNameKey } from "../src/modules/retro/answers";
import { confluencePageId, parseDocLink } from "../src/modules/retro/docLink";
import { canCreateRetro, canManageRetro } from "../src/modules/retro/permissions";
import { RETRO_NAME_IN_VOTE, RETRO_NEVER_POSTED, RetroService } from "../src/modules/retro/RetroService";
import { DEFAULT_RETRO_CONFIG, RETRO_IDEA_FIELDS, RETRO_LIMITS, RetroAnswersInput, RetroColumns, RetroField, RetroSession } from "../src/modules/retro/types";
import { PollService } from "../src/modules/poll/PollService";
import { createServices } from "../src/services";
import { UserError } from "../src/shared/errors";
import {
	ADMIN,
	CHANNEL_BOT,
	CHANNEL_GENERAL,
	createTestContext,
	FakeClock,
	GUILD,
	OTHER_GUILD,
	ROLE_BACKEND,
	ROLE_FRONTEND,
	ROLE_OTHER,
	TestContext,
	USER_A,
	USER_B,
	USER_C,
} from "./helpers";

const BOT = "900000000000000001";
const BASE = "https://confluence.congty.vn";
const DOC = `${BASE}/spaces/PMS/pages/123456/Retrospective+Sprint+24`;
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const USER_D = "300000000000000004";

interface Setup extends TestContext
{
	polls: PollService;
	retro: RetroService;
}

function setup(base: string | null = BASE, orderKey?: () => string): Setup
{
	const context = createTestContext();
	const polls = new PollService(context.db, context.deps);
	return { ...context, polls, retro: new RetroService(context.db, context.deps, polls, base, orderKey) };
}

/** Dãy khoá thứ tự cố định cho test: lần lượt trả các khoá trong `keys`. */
function keySequence(keys: readonly string[]): () => string
{
	let next = 0;
	return () =>
	{
		const key = keys[next];
		next++;
		assert.ok(key !== undefined, "hết khoá thứ tự giả");
		return key;
	};
}

const NO_COLUMNS: RetroColumns = { learned: [], improve: [], ideas: [], kudos: [], sprintName: [] };

function answers(overrides: Partial<Record<RetroField, string>> = {}): RetroAnswersInput
{
	return { learned: "", improve: "", ideas: "", kudos: "", sprintName: "", ...overrides };
}

/** Tạo phiên như /retro create (kể cả đã đăng tin có nút điền: message_id có giá trị). */
function createSession(s: Setup, overrides: Partial<Parameters<RetroService["create"]>[0]> = {}): RetroSession
{
	const created = s.retro.create({
		guildId: GUILD,
		channelId: CHANNEL_GENERAL,
		title: "Retrospective PMS Sprint 24",
		docUrl: null,
		teamRoleId: null,
		durationHours: null,
		createdBy: ADMIN,
		...overrides,
	});
	s.retro.attachMessage(created.guildId, created.id, String(600000000000000000n + BigInt(created.id)));
	return s.retro.get(created.guildId, created.id) ?? created;
}

function submit(s: Setup, sessionId: number, userId: string, overrides: Partial<Record<RetroField, string>>, roleIds: string[] = []): ReturnType<RetroService["submit"]>
{
	return s.retro.submit({ guildId: GUILD, sessionId, userId, roleIds, answers: answers(overrides), systemActorId: BOT });
}

function assertUserError(fn: () => unknown, message: string | RegExp): void
{
	assert.throws(fn, (error: unknown) =>
	{
		assert.ok(error instanceof UserError, `cần UserError, nhận được ${String(error)}`);
		if (typeof message === "string") assert.equal(error.message, message);
		else assert.match(error.message, message);
		return true;
	});
}

function auditActions(s: Setup): string[]
{
	return s.deps.audit.list(GUILD, 100).map(entry => entry.action).reverse();
}

/** Phiên đã đóng có các tên sprint đề xuất (theo thứ tự người A, B, C, D...). */
function closedWithNames(s: Setup, names: string[]): RetroSession
{
	const session = createSession(s);
	const users = [USER_A, USER_B, USER_C, USER_D];
	names.forEach((name, index) =>
	{
		const userId = index < users.length ? users[index] : `3100000000000000${String(index).padStart(2, "0")}`;
		submit(s, session.id, userId, { sprintName: name, learned: `ý ${index}` });
	});
	return s.retro.close(GUILD, session.id, ADMIN);
}

describe("retro: tạo phiên", () =>
{
	test("chuẩn hoá tiêu đề, lưu link Confluence có ID trang, team đã cấu hình, hạn; audit retro.create với kênh là đối tượng", (t) =>
	{
		const s = setup();
		s.deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		const session = createSession(s, { title: "  Retro   Sprint 24 ", docUrl: DOC, teamRoleId: ROLE_BACKEND, durationHours: 48 });
		t.diagnostic(JSON.stringify(session));

		assert.equal(session.title, "Retro Sprint 24");
		assert.equal(session.docUrl, DOC);
		assert.equal(session.docPageId, "123456");
		assert.equal(session.teamRoleId, ROLE_BACKEND);
		assert.equal(session.status, "open");
		assert.equal(session.closesAt, s.clock.now() + 48 * HOUR);
		assert.equal(session.participants, 0);
		assert.equal(session.acceptingAnswers, true);
		assert.equal(session.createdBy, ADMIN);

		const [entry] = s.deps.audit.list(GUILD, 1);
		assert.equal(entry.action, "retro.create");
		assert.equal(entry.targetId, CHANNEL_GENERAL);
		assert.deepEqual(entry.details, { sessionId: session.id, title: "Retro Sprint 24", teamRoleId: ROLE_BACKEND, docUrl: DOC, closesAt: session.closesAt });
	});

	test("tiêu đề 3–100 ký tự; hạn 1–720 giờ; team phải là team đã cấu hình", () =>
	{
		const s = setup();
		assertUserError(() => createSession(s, { title: "ab" }), /từ 3 đến 100 ký tự/);
		assertUserError(() => createSession(s, { title: "x".repeat(101) }), /từ 3 đến 100 ký tự/);
		assertUserError(() => createSession(s, { durationHours: 0 }), /từ 1 đến 720/);
		assertUserError(() => createSession(s, { durationHours: 721 }), /từ 1 đến 720/);
		assertUserError(() => createSession(s, { teamRoleId: ROLE_OTHER }), /team đã cấu hình/);
		assert.equal(createSession(s, { title: "x".repeat(100) }).title.length, 100);
	});

	test("một kênh chỉ có một phiên đang mở; kênh khác, hay sau khi đóng, thì tạo được", () =>
	{
		const s = setup();
		const first = createSession(s);
		assertUserError(() => createSession(s), new RegExp(`phiên retro #${first.id}`));
		assert.equal(createSession(s, { channelId: CHANNEL_BOT }).channelId, CHANNEL_BOT);
		s.retro.close(GUILD, first.id, ADMIN);
		const second = createSession(s);
		assert.equal(s.retro.findOpenInChannel(GUILD, CHANNEL_GENERAL)?.id, second.id);
		assert.equal(s.retro.latestInChannel(GUILD, CHANNEL_GENERAL)?.id, second.id);
		assert.equal(s.retro.get(OTHER_GUILD, second.id), null, "phiên của guild khác không đọc được");
	});

	test("link: đã cấu hình Confluence thì host phải trùng và có ID trang; chưa cấu hình thì vẫn lưu link", () =>
	{
		const s = setup();
		assertUserError(() => createSession(s, { docUrl: "https://evil.example/pages/123/x" }), /confluence\.congty\.vn/);
		assertUserError(() => createSession(s, { docUrl: `${BASE}/display/PMS/Retro` }), /mã trang/);
		assertUserError(() => createSession(s, { docUrl: "javascript:alert(1)" }), /không hợp lệ/);
		assertUserError(() => createSession(s, { docUrl: "https://user:pass@confluence.congty.vn/pages/1/x" }), /không hợp lệ/);
		assert.equal(createSession(s, { docUrl: "   " }).docUrl, null, "link toàn khoảng trắng coi như không có");

		const off = setup(null);
		const session = createSession(off, { docUrl: "https://wiki.khac.vn/display/PMS/Retro" });
		assert.equal(session.docUrl, "https://wiki.khac.vn/display/PMS/Retro");
		assert.equal(session.docPageId, null);
	});

	test("parseDocLink đọc ID trang từ các dạng link Confluence", () =>
	{
		assert.deepEqual(parseDocLink(`${BASE}/pages/viewpage.action?pageId=987`, BASE), { url: `${BASE}/pages/viewpage.action?pageId=987`, pageId: "987" });
		assert.equal(parseDocLink(`${BASE}/spaces/PMS/pages/42`, BASE).pageId, "42");
		assert.equal(parseDocLink("https://CONFLUENCE.congty.vn/pages/7/x", BASE).pageId, "7", "host không phân biệt hoa thường");
		assert.equal(confluencePageId(new URL("https://x.vn/pages/viewpage.action?pageId=abc")), null);
		assert.equal(confluencePageId(new URL("https://x.vn/pagesx/1")), null);
		assertUserError(() => parseDocLink("https://confluence.congty.vn:8443/pages/7/x", BASE), /confluence\.congty\.vn/);
		assertUserError(() => parseDocLink(`${BASE}/pages/1/${"x".repeat(RETRO_LIMITS.docUrlMax)}`, BASE), /không hợp lệ/);
	});
});

describe("retro: điền phiếu", () =>
{
	test("lần đầu cộng XP điền retro một lần (nguồn admin, người thao tác là bot, snapshot team); sửa lại không cộng thêm", () =>
	{
		const s = setup();
		s.deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		const session = createSession(s);

		const first = submit(s, session.id, USER_A, { learned: "Học được cách chia task", sprintName: "Rồng Lửa" }, [ROLE_BACKEND, ROLE_OTHER]);
		assert.equal(first.firstSubmit, true);
		assert.equal(first.xpAwarded, DEFAULT_RETRO_CONFIG.fillXp);
		assert.equal(first.session.participants, 1);
		assert.deepEqual(first.answers, { learned: "Học được cách chia task", improve: null, ideas: null, kudos: null, sprintName: "Rồng Lửa" });

		const [event] = s.deps.xpLedger.recent(GUILD, USER_A, 5);
		assert.equal(event.amount, 20);
		assert.equal(event.source, "admin");
		assert.equal(event.actorId, BOT);
		assert.equal(event.reason, "Retro Retrospective PMS Sprint 24: điền retro");
		assert.equal(event.referenceId, `retro:${session.id}`);
		assert.deepEqual(s.deps.xpLedger.teamTotals(GUILD, 10), [{ id: ROLE_BACKEND, total: 20 }]);

		const second = submit(s, session.id, USER_A, { improve: "Họp dài quá" }, [ROLE_BACKEND]);
		assert.equal(second.firstSubmit, false);
		assert.equal(second.xpAwarded, 0);
		assert.equal(second.session.participants, 1);
		assert.equal(s.deps.xpLedger.total(GUILD, USER_A), 20);
		assert.deepEqual(s.retro.getAnswers(GUILD, session.id, USER_A), { learned: null, improve: "Họp dài quá", ideas: null, kudos: null, sprintName: null }, "thay cả 5 ô");
		assert.equal(s.retro.getAnswers(GUILD, session.id, USER_B), null);
		assert.ok(!auditActions(s).some(action => action.startsWith("xp.")), "điền retro không ghi audit");
	});

	test("XP điền retro = 0 thì không ghi event XP", () =>
	{
		const s = setup();
		s.retro.updateConfig(GUILD, { fillXp: 0 }, ADMIN);
		const session = createSession(s);
		const result = submit(s, session.id, USER_A, { kudos: "Cảm ơn team QA" });
		assert.equal(result.xpAwarded, 0);
		assert.equal(result.firstSubmit, true);
		assert.deepEqual(s.deps.xpLedger.recent(GUILD, USER_A, 5), []);
	});

	test("phiên có team: chỉ thành viên team điền được; phiên đã đóng hoặc quá hạn thì không điền được", () =>
	{
		const s = setup();
		s.deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		const session = createSession(s, { teamRoleId: ROLE_BACKEND, durationHours: 2 });
		assertUserError(() => submit(s, session.id, USER_A, { learned: "x" }, [ROLE_FRONTEND]), new RegExp(`<@&${ROLE_BACKEND}>`));
		submit(s, session.id, USER_B, { learned: "x" }, [ROLE_BACKEND]);

		s.clock.advance(2 * HOUR);
		assert.equal(s.retro.get(GUILD, session.id)?.acceptingAnswers, false);
		assertUserError(() => submit(s, session.id, USER_B, { learned: "sửa" }, [ROLE_BACKEND]), /đã đóng/);

		const other = createSession(s, { channelId: CHANNEL_BOT });
		s.retro.close(GUILD, other.id, ADMIN);
		assertUserError(() => submit(s, other.id, USER_A, { learned: "x" }), /đã đóng/);
		assertUserError(() => submit(s, 999, USER_A, { learned: "x" }), "Không tìm thấy phiên retro này.");
	});

	test("kiểm tra ô: tối đa 1000 ký tự, tên sprint tối đa 80 ký tự và không chỉ toàn số, ít nhất một ô có chữ", () =>
	{
		const s = setup();
		const session = createSession(s);
		for (const name of ["24", " 2 4 ", "#24", "24-25", "24.1", "٢٤"])
		{
			assertUserError(() => submit(s, session.id, USER_A, { sprintName: name }), /không được chỉ là số/);
		}
		assertUserError(() => submit(s, session.id, USER_A, { learned: "a".repeat(1001) }), /tối đa 1000 ký tự/);
		assertUserError(() => submit(s, session.id, USER_A, { sprintName: "a".repeat(81) }), /tối đa 80 ký tự/);
		assertUserError(() => submit(s, session.id, USER_A, { learned: "   ", sprintName: "\n" }), /ít nhất một ô/);
		assert.equal(s.retro.get(GUILD, session.id)?.participants, 0, "lỗi thì không lưu gì");

		const ok = submit(s, session.id, USER_A, { learned: "😀".repeat(1000), sprintName: "  Sprint   24\n" });
		assert.equal(ok.answers.sprintName, "Sprint 24", "tên có chữ được, khoảng trắng gộp lại");
		assert.equal(Array.from(ok.answers.learned ?? "").length, 1000, "1000 emoji (đếm theo ký tự) vẫn hợp lệ");
	});

	test("hàm thuần: chuẩn hoá tên sprint, khoá so sánh và tên chỉ toàn số", () =>
	{
		assert.equal(displaySprintName("  Rồng\t\nLửa  "), "Rồng Lửa");
		assert.equal(sprintNameKey("RỒNG  LỬA"), sprintNameKey("rồng lửa"));
		assert.equal(sprintNameKey("Rồng Lửa".normalize("NFD")), sprintNameKey("Rồng Lửa"), "NFD và NFC là một");
		assert.equal(isNumericOnlyName("Sprint 24"), false);
		assert.equal(isNumericOnlyName(""), false);
		assert.equal(isNumericOnlyName("1/2"), true);
		assert.deepEqual(normalizeAnswers(answers({ ideas: "  dòng 1\n dòng 2 " })).ideas, "dòng 1\n dòng 2", "giữ xuống dòng trong ô");
	});
});

describe("retro: đọc nội dung ẩn danh", () =>
{
	test("người đã điền sắp theo ID; nội dung ẩn danh theo cột, không có người viết hay mã phiếu, thứ tự ổn định và không theo thứ tự gửi", () =>
	{
		const s = setup();
		const session = createSession(s);
		const users = Array.from({ length: 12 }, (_, index) => `3200000000000000${String(index).padStart(2, "0")}`);
		users.forEach((userId, index) => submit(s, session.id, userId, { learned: `ý số ${index}` }));
		submit(s, session.id, USER_A, { kudos: "Cảm ơn" });

		assert.deepEqual(s.retro.participants(GUILD, session.id), [...users, USER_A].sort());
		const columns = s.retro.columns(GUILD, session.id);
		assert.deepEqual(Object.keys(columns).sort(), ["ideas", "improve", "kudos", "learned", "sprintName"]);
		assert.equal(columns.learned.length, 12);
		assert.ok(columns.learned.every(text => typeof text === "string"), "chỉ có chữ, không có mã phiếu hay người viết");
		assert.deepEqual(s.retro.columns(GUILD, session.id), columns, "gọi lại cùng thứ tự (khoá lưu trong DB)");
		assert.notDeepEqual(columns.learned, users.map((_, index) => `ý số ${index}`), "không lộ thứ tự gửi");
		assert.deepEqual(columns.kudos, ["Cảm ơn"]);
		assert.deepEqual(columns.improve, []);
		assert.deepEqual(s.retro.participants(OTHER_GUILD, session.id), []);
		assert.deepEqual(s.retro.columns(OTHER_GUILD, session.id), NO_COLUMNS);
	});

	test("thứ tự mỗi cột theo khoá ngẫu nhiên lưu trong DB (randomBytes): không tính lại được từ mã phiếu hay mã phiên, khác giữa hai phiên giống hệt", () =>
	{
		const s = setup();
		const sessions = [createSession(s), createSession(s, { channelId: CHANNEL_BOT })];
		const texts = Array.from({ length: 12 }, (_, index) => `ý ${String(index).padStart(2, "0")}`);
		for (const session of sessions)
		{
			texts.forEach((text, index) => submit(s, session.id, `3300000000000000${String(index).padStart(2, "0")}`, { learned: text }));
		}
		const rows = s.db.prepare<[], { id: number; session_id: number; learned: string; order_keys: string }>(
			"SELECT id, session_id, learned, order_keys FROM retro_entries ORDER BY id").all();
		for (const row of rows)
		{
			const keys = JSON.parse(row.order_keys) as Record<string, string>;
			assert.deepEqual(Object.keys(keys).sort(), ["ideas", "improve", "kudos", "learned"], "mỗi ô chữ một khoá riêng");
			for (const key of Object.values(keys)) assert.match(key, /^[0-9a-f]{32}$/u, "khoá 128 bit ngẫu nhiên");
			assert.equal(new Set(Object.values(keys)).size, 4, "4 ô của cùng một phiếu có 4 khoá khác nhau");
		}
		const [first, second] = sessions.map(session => s.retro.columns(GUILD, session.id).learned);
		assert.notDeepEqual(first, second, "hai phiên cùng nội dung, cùng thứ tự gửi vẫn trộn khác nhau");

		const oldShuffle = (sessionId: number): string[] => rows
			.filter(row => row.session_id === sessionId)
			.map(row => ({ text: row.learned, key: createHash("sha256").update(`retro:${sessionId}:${row.id}`).digest("hex") }))
			.sort((a, b) => (a.key < b.key ? -1 : 1))
			.map(item => item.text);
		assert.notDeepEqual(first, oldShuffle(sessions[0].id), "không còn là sha256(phiên, mã phiếu): ai biết mã phiếu cũng không tính lại được");
		assert.notDeepEqual(first, texts, "không theo mã phiếu tăng dần");
	});

	test("mỗi cột trộn độc lập: một hàng của bảng không phải toàn bộ câu trả lời của một người; sửa một ô chỉ đổi vị trí ô đó", () =>
	{
		const keys = [
			"a1", "z1", "m1", "z9",
			"z2", "a2", "m2", "a9",
			"m3", "m4", "a3", "m9",
		];
		const s = setup(BASE, keySequence([...keys, "b0"]));
		const session = createSession(s);
		submit(s, session.id, USER_A, { learned: "A học", improve: "A thiếu", ideas: "A ý tưởng", kudos: "A cảm ơn" });
		submit(s, session.id, USER_B, { learned: "B học", improve: "B thiếu", ideas: "B ý tưởng", kudos: "B cảm ơn" });
		submit(s, session.id, USER_C, { learned: "C học", improve: "C thiếu", ideas: "C ý tưởng", kudos: "C cảm ơn" });

		const columns = s.retro.columns(GUILD, session.id);
		assert.deepEqual(columns.learned, ["A học", "C học", "B học"]);
		assert.deepEqual(columns.improve, ["B thiếu", "C thiếu", "A thiếu"]);
		assert.deepEqual(columns.ideas, ["C ý tưởng", "A ý tưởng", "B ý tưởng"]);
		assert.deepEqual(columns.kudos, ["B cảm ơn", "C cảm ơn", "A cảm ơn"]);
		for (let row = 0; row < 3; row++)
		{
			const authors = new Set(RETRO_IDEA_FIELDS.map(field => columns[field][row].charAt(0)));
			assert.ok(authors.size > 1, `hàng ${row} gom ý của nhiều người, không phải phiếu của một người`);
		}

		submit(s, session.id, USER_A, { learned: "A học", improve: "A thiếu (sửa)", ideas: "A ý tưởng", kudos: "A cảm ơn" });
		const after = s.retro.columns(GUILD, session.id);
		assert.deepEqual(after.learned, columns.learned, "ô không đổi giữ vị trí");
		assert.deepEqual(after.improve, ["B thiếu", "A thiếu (sửa)", "C thiếu"], "ô vừa sửa nhận khoá mới (b0)");
	});

	test("ứng viên tên sprint: bỏ trùng (NFC, khoảng trắng, hoa thường), giữ cách viết gửi sớm nhất, nhớ mọi người đề xuất, bỏ tên chỉ toàn số", () =>
	{
		const s = setup();
		const session = createSession(s);
		submit(s, session.id, USER_B, { sprintName: "Rồng  Lửa" });
		s.clock.advance(1000);
		submit(s, session.id, USER_A, { sprintName: "rồng lửa" });
		s.clock.advance(1000);
		submit(s, session.id, USER_C, { sprintName: "RỒNG LỬA".normalize("NFD") });
		submit(s, session.id, USER_D, { sprintName: "Bão Tố" });
		s.db.prepare("INSERT INTO retro_entries (session_id, guild_id, user_id, sprint_name, submitted_at, updated_at) VALUES (?, ?, ?, '42', 0, 0)")
			.run(session.id, GUILD, "330000000000000001");

		assert.deepEqual(s.retro.sprintNameCandidates(GUILD, session.id).map(({ name, proposerIds }) => ({ name, proposerIds })), [
			{ name: "Bão Tố", proposerIds: [USER_D] },
			{ name: "Rồng Lửa", proposerIds: [USER_B, USER_A, USER_C] },
		]);
		assert.deepEqual(s.retro.columns(GUILD, session.id).sprintName, ["Bão Tố", "Rồng Lửa"]);
	});
});

describe("retro: đóng, mở lại, gia hạn", () =>
{
	test("đóng có audit; đóng lần hai lỗi; mở lại với hạn mới; gia hạn chỉ phiên đang mở", () =>
	{
		const s = setup();
		const session = createSession(s, { durationHours: 5 });
		const extended = s.retro.extend(GUILD, session.id, USER_B, 10);
		assert.equal(extended.closesAt, s.clock.now() + 10 * HOUR);

		const closed = s.retro.close(GUILD, session.id, USER_B);
		assert.equal(closed.status, "closed");
		assert.equal(closed.closedAt, s.clock.now());
		assert.equal(closed.acceptingAnswers, false);
		assertUserError(() => s.retro.close(GUILD, session.id, USER_B), "Phiên retro này đã đóng.");
		assertUserError(() => s.retro.extend(GUILD, session.id, USER_B, 1), /Chỉ gia hạn được phiên đang mở/);

		const reopened = s.retro.reopen(GUILD, session.id, USER_B, 3);
		assert.equal(reopened.status, "open");
		assert.equal(reopened.closedAt, null);
		assert.equal(reopened.closesAt, s.clock.now() + 3 * HOUR);
		assertUserError(() => s.retro.reopen(GUILD, session.id, USER_B, null), "Phiên retro này đang mở.");
		s.retro.close(GUILD, session.id, USER_B);
		assert.equal(s.retro.reopen(GUILD, session.id, USER_B, null).closesAt, null);

		const entries = s.deps.audit.list(GUILD, 10).reverse().filter(entry => entry.action !== "retro.create");
		assert.deepEqual(entries.map(entry => [entry.action, entry.actorId, entry.targetId]), [
			["retro.extend", USER_B, CHANNEL_GENERAL],
			["retro.close", USER_B, CHANNEL_GENERAL],
			["retro.reopen", USER_B, CHANNEL_GENERAL],
			["retro.close", USER_B, CHANNEL_GENERAL],
			["retro.reopen", USER_B, CHANNEL_GENERAL],
		]);
		assert.deepEqual(entries[2].details, { sessionId: session.id, title: session.title, closesAt: reopened.closesAt });
	});

	test("mở lại bị chặn khi kênh đã có phiên khác đang mở, khi đã có vote, hoặc nội dung đã bị xoá", () =>
	{
		const s = setup();
		const session = createSession(s);
		s.retro.close(GUILD, session.id, ADMIN);
		createSession(s);
		assertUserError(() => s.retro.reopen(GUILD, session.id, ADMIN, null), /đang có phiên retro #/);

		const t = setup();
		const withVote = closedWithNames(t, ["A1", "B1"]);
		t.retro.startVote({ guildId: GUILD, sessionId: withVote.id, actorId: ADMIN });
		assertUserError(() => t.retro.reopen(GUILD, withVote.id, ADMIN, null), /đã có vote/);

		const u = setup();
		const deleted = closedWithNames(u, ["A1"]);
		u.retro.deleteContent(GUILD, deleted.id, ADMIN);
		assertUserError(() => u.retro.reopen(GUILD, deleted.id, ADMIN, null), /đã bị xoá/);
	});

	test("closeDue chỉ đóng phiên đang mở đã quá hạn, mọi guild, không audit", () =>
	{
		const s = setup();
		const soon = createSession(s, { durationHours: 1 });
		const later = createSession(s, { channelId: CHANNEL_BOT, durationHours: 5 });
		const other = s.retro.create({ guildId: OTHER_GUILD, channelId: CHANNEL_GENERAL, title: "Retro khác", docUrl: null, teamRoleId: null, durationHours: 1, createdBy: ADMIN });
		const endless = s.retro.create({ guildId: OTHER_GUILD, channelId: CHANNEL_BOT, title: "Không hạn", docUrl: null, teamRoleId: null, durationHours: null, createdBy: ADMIN });

		assert.deepEqual(s.retro.closeDue(), []);
		s.clock.advance(HOUR);
		assert.deepEqual(s.retro.closeDue().map(session => session.id).sort(), [soon.id, other.id].sort());
		assert.deepEqual(s.retro.closeDue(), [], "gọi lại không đóng lần hai");
		assert.equal(s.retro.get(GUILD, later.id)?.status, "open");
		assert.equal(s.retro.get(OTHER_GUILD, endless.id)?.status, "open");
		assert.ok(!auditActions(s).includes("retro.close"));
	});
});

describe("retro: xoá ý và xoá nội dung", () =>
{
	test("xoá một ý theo cột và vị trí (đúng chữ): ô về null; audit chỉ có mã phiên, tiêu đề và cột (không mã phiếu, không người viết)", () =>
	{
		const s = setup();
		const session = createSession(s);
		submit(s, session.id, USER_A, { learned: "Nội dung không phù hợp", kudos: "Cảm ơn" });
		submit(s, session.id, USER_B, { learned: "Ý tốt" });
		const index = s.retro.columns(GUILD, session.id).learned.indexOf("Nội dung không phù hợp");
		const del = (field: RetroField, at: number, text: string): RetroSession =>
			s.retro.deleteIdea({ guildId: GUILD, sessionId: session.id, field, index: at, text, actorId: ADMIN });

		assertUserError(() => del("learned", index, "chữ khác"), /Không tìm thấy ý này/);
		del("learned", index, "Nội dung không phù hợp");
		assert.deepEqual(s.retro.getAnswers(GUILD, session.id, USER_A), { learned: null, improve: null, ideas: null, kudos: "Cảm ơn", sprintName: null });
		assert.deepEqual(s.retro.columns(GUILD, session.id).learned, ["Ý tốt"]);
		const [audit] = s.deps.audit.list(GUILD, 1);
		assert.equal(audit.action, "retro.idea_delete");
		assert.equal(audit.targetId, CHANNEL_GENERAL);
		assert.deepEqual(audit.details, { sessionId: session.id, title: session.title, field: "learned" }, "không có entryId hay gì ghép được người với ý");
		assert.ok(!JSON.stringify(audit).includes(USER_A), "audit không lộ người viết");
		assert.ok(!formatAuditEntry(audit).includes("Mã phiếu"), "nhật ký không hiện mã phiếu");

		assertUserError(() => del("learned", 5, "Ý tốt"), /Không tìm thấy ý này/);
		assertUserError(() => del("learned", -1, "Ý tốt"), /Không tìm thấy ý này/);
		del("kudos", 0, "Cảm ơn");
		assert.deepEqual(s.retro.columns(GUILD, session.id).kudos, []);
		assert.equal(s.retro.get(GUILD, session.id)?.participants, 2, "vẫn tính là đã điền");
	});

	test("xoá tên sprint: xoá tên đó ở mọi phiếu đã đề xuất (mọi cách viết); đang vote (kể cả chờ chọn khi hoà) thì chặn; đã chốt thì xoá được", () =>
	{
		const s = setup();
		const session = createSession(s);
		submit(s, session.id, USER_A, { sprintName: "Tên Xấu", learned: "a" });
		submit(s, session.id, USER_B, { sprintName: "tên  xấu" });
		submit(s, session.id, USER_C, { sprintName: "Rồng Lửa" });
		submit(s, session.id, USER_D, { sprintName: "Bão Tố" });
		s.retro.close(GUILD, session.id, ADMIN);
		assert.deepEqual(s.retro.columns(GUILD, session.id).sprintName, ["Bão Tố", "Rồng Lửa", "Tên Xấu"], "đã bỏ trùng, theo chữ cái");

		s.retro.deleteIdea({ guildId: GUILD, sessionId: session.id, field: "sprintName", index: 2, text: "Tên Xấu", actorId: ADMIN });
		assert.deepEqual(s.retro.columns(GUILD, session.id).sprintName, ["Bão Tố", "Rồng Lửa"]);
		assert.equal(s.retro.getAnswers(GUILD, session.id, USER_B)?.sprintName, null);
		assert.equal(s.retro.getAnswers(GUILD, session.id, USER_A)?.learned, "a");

		const { poll } = s.retro.startVote({ guildId: GUILD, sessionId: session.id, actorId: ADMIN });
		assertUserError(() => s.retro.deleteIdea({ guildId: GUILD, sessionId: session.id, field: "sprintName", index: 0, text: "Bão Tố", actorId: ADMIN }), RETRO_NAME_IN_VOTE);
		s.polls.close({ guildId: GUILD, pollId: poll.id, actorId: ADMIN, actorIsAdmin: true });
		assert.equal(s.retro.finalizeVote(GUILD, session.id, BOT).kind, "tie");
		assertUserError(() => s.retro.deleteIdea({ guildId: GUILD, sessionId: session.id, field: "sprintName", index: 0, text: "Bão Tố", actorId: ADMIN }), RETRO_NAME_IN_VOTE);
		s.retro.pickName({ guildId: GUILD, sessionId: session.id, name: "Rồng Lửa", actorId: ADMIN, systemActorId: BOT });
		s.retro.deleteIdea({ guildId: GUILD, sessionId: session.id, field: "sprintName", index: 0, text: "Bão Tố", actorId: ADMIN });
		assert.deepEqual(s.retro.columns(GUILD, session.id).sprintName, ["Rồng Lửa"]);
	});

	test("xoá nội dung phiên: chỉ khi đã đóng và không còn vote chờ; xoá hẳn chữ, giữ người đã điền và XP; không xoá lần hai", () =>
	{
		const s = setup();
		const session = createSession(s);
		submit(s, session.id, USER_A, { learned: "bí mật", sprintName: "Rồng Lửa" });
		submit(s, session.id, USER_B, { improve: "riêng tư", sprintName: "Bão Tố" });
		assertUserError(() => s.retro.deleteContent(GUILD, session.id, ADMIN), /đóng phiên retro trước/);

		s.retro.close(GUILD, session.id, ADMIN);
		s.retro.startVote({ guildId: GUILD, sessionId: session.id, actorId: ADMIN });
		assertUserError(() => s.retro.deleteContent(GUILD, session.id, ADMIN), /đang vote tên sprint/);
		const poll = s.retro.get(GUILD, session.id)?.pollId ?? 0;
		s.polls.vote({ guildId: GUILD, pollId: poll, userId: USER_C, optionIndex: 1, roleIds: [] });
		s.polls.close({ guildId: GUILD, pollId: poll, actorId: ADMIN, actorIsAdmin: true });
		s.retro.finalizeVote(GUILD, session.id, BOT);

		const xpBefore = s.deps.xpLedger.total(GUILD, USER_A);
		const deleted = s.retro.deleteContent(GUILD, session.id, ADMIN);
		assert.equal(deleted.contentDeletedAt, s.clock.now());
		assert.equal(deleted.participants, 2);
		assert.equal(deleted.winnerName, "Rồng Lửa");
		const rows = s.db.prepare<[number], { learned: string | null; improve: string | null; sprint_name: string | null }>(
			"SELECT learned, improve, sprint_name FROM retro_entries WHERE session_id = ?").all(session.id);
		assert.deepEqual(rows, [{ learned: null, improve: null, sprint_name: null }, { learned: null, improve: null, sprint_name: null }]);
		assert.deepEqual(s.retro.participants(GUILD, session.id), [USER_A, USER_B]);
		assert.equal(s.deps.xpLedger.total(GUILD, USER_A), xpBefore, "XP đã cộng giữ nguyên");
		const [audit] = s.deps.audit.list(GUILD, 1);
		assert.equal(audit.action, "retro.content_delete");
		assert.deepEqual(audit.details, { sessionId: session.id, title: session.title, entries: 2 });
		assertUserError(() => s.retro.deleteContent(GUILD, session.id, ADMIN), /đã được xoá trước đó/);
	});
});

describe("retro: vote tên sprint", () =>
{
	test("tạo vote cho phiên đã đóng: một lựa chọn, XP mặc định của server, thời hạn theo cấu hình retro, người tạo là người quản lý", () =>
	{
		const s = setup();
		s.deps.guildConfig.updateSettings(GUILD, { defaultPollXp: 7 }, ADMIN);
		s.retro.updateConfig(GUILD, { voteMinutes: 90 }, ADMIN);
		const open = createSession(s);
		submit(s, open.id, USER_A, { sprintName: "Phượng Hoàng" });
		submit(s, open.id, USER_B, { sprintName: "Bão Tố" });
		assertUserError(() => s.retro.startVote({ guildId: GUILD, sessionId: open.id, actorId: USER_C }), /đóng phiên retro trước/);
		s.retro.close(GUILD, open.id, USER_C);

		const { session, poll } = s.retro.startVote({ guildId: GUILD, sessionId: open.id, actorId: USER_C });
		assert.equal(session.status, "voting");
		assert.equal(session.pollId, poll.id);
		assert.deepEqual(poll.options.map(option => option.label), ["Bão Tố", "Phượng Hoàng"]);
		assert.equal(poll.multiSelect, false);
		assert.equal(poll.xpReward, 7);
		assert.equal(poll.creatorId, USER_C);
		assert.equal(poll.closesAt, s.clock.now() + 90 * MINUTE);
		assert.match(poll.question, /Đặt tên sprint · Retro Retrospective PMS Sprint 24/);
		assert.equal(s.retro.findByPoll(GUILD, poll.id)?.id, session.id);
		const [audit] = s.deps.audit.list(GUILD, 1);
		assert.equal(audit.action, "retro.vote");
		assert.deepEqual(audit.details, { sessionId: session.id, title: session.title, pollId: poll.id, options: 2 });
		assertUserError(() => s.retro.startVote({ guildId: GUILD, sessionId: open.id, actorId: USER_C }), new RegExp(`vote #${poll.id}`));
	});

	test("không có tên hay chỉ một tên thì không tạo vote; hơn 10 tên thì phải có danh sách rút gọn 2–10 tên có trong ứng viên", () =>
	{
		const none = setup();
		const empty = closedWithNames(none, []);
		assertUserError(() => none.retro.startVote({ guildId: GUILD, sessionId: empty.id, actorId: ADMIN }), /Chưa có ai đề xuất/);

		const one = setup();
		const single = closedWithNames(one, ["Duy Nhất", "duy  nhất"]);
		assertUserError(() => one.retro.startVote({ guildId: GUILD, sessionId: single.id, actorId: ADMIN }), /Chỉ có một tên được đề xuất \("Duy Nhất"\)/);

		const many = setup();
		const names = Array.from({ length: 11 }, (_, index) => `Tên ${String.fromCharCode(65 + index)}`);
		const big = closedWithNames(many, names);
		assertUserError(() => many.retro.startVote({ guildId: GUILD, sessionId: big.id, actorId: ADMIN }), /Có 11 tên được đề xuất/);
		assertUserError(() => many.retro.startVote({ guildId: GUILD, sessionId: big.id, actorId: ADMIN, names: ["Tên A", "Không Có"] }), /"Không Có" không có trong/);
		assertUserError(() => many.retro.startVote({ guildId: GUILD, sessionId: big.id, actorId: ADMIN, names: ["Tên A", "tên  a"] }), /từ 2 đến 10 tên/);
		assert.equal(many.retro.get(GUILD, big.id)?.status, "closed", "lỗi thì không đổi gì");

		const { poll } = many.retro.startVote({ guildId: GUILD, sessionId: big.id, actorId: ADMIN, names: ["tên c", " TÊN A ", "Tên K", "Tên C"] });
		assert.deepEqual(poll.options.map(option => option.label), ["Tên C", "Tên A", "Tên K"], "dùng cách viết của ứng viên, bỏ trùng");
	});

	test("vote đóng: tên nhiều phiếu nhất thắng, MỖI người đề xuất tên đó được cộng XP (snapshot team lúc điền); chốt lại không cộng lần hai", () =>
	{
		const s = setup();
		s.deps.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		s.deps.teams.add(GUILD, ROLE_FRONTEND, ADMIN);
		s.retro.updateConfig(GUILD, { fillXp: 0, proposerBonusXp: 150 }, ADMIN);
		const session = createSession(s);
		submit(s, session.id, USER_A, { sprintName: "Rồng Lửa" }, [ROLE_BACKEND]);
		submit(s, session.id, USER_B, { sprintName: "rồng lửa" }, [ROLE_FRONTEND]);
		submit(s, session.id, USER_C, { sprintName: "Bão Tố" }, [ROLE_BACKEND]);
		s.retro.close(GUILD, session.id, ADMIN);
		const { poll } = s.retro.startVote({ guildId: GUILD, sessionId: session.id, actorId: ADMIN });

		assert.deepEqual(s.retro.finalizeVote(GUILD, session.id, BOT).kind, "unchanged", "vote còn mở");
		s.polls.vote({ guildId: GUILD, pollId: poll.id, userId: USER_A, optionIndex: 1, roleIds: [] });
		s.polls.vote({ guildId: GUILD, pollId: poll.id, userId: USER_B, optionIndex: 1, roleIds: [] });
		s.polls.vote({ guildId: GUILD, pollId: poll.id, userId: USER_C, optionIndex: 0, roleIds: [] });
		s.polls.close({ guildId: GUILD, pollId: poll.id, actorId: ADMIN, actorIsAdmin: true });
		assert.deepEqual(s.retro.pendingVoteResults().map(item => item.id), [session.id]);

		const xpA = s.deps.xpLedger.total(GUILD, USER_A);
		const outcome = s.retro.finalizeVote(GUILD, session.id, BOT);
		assert.equal(outcome.kind, "winner");
		if (outcome.kind !== "winner") return;
		assert.equal(outcome.name, "Rồng Lửa");
		assert.deepEqual(outcome.proposerIds, [USER_A, USER_B]);
		assert.equal(outcome.xpEach, 150);
		assert.equal(outcome.session.status, "done");
		assert.equal(outcome.session.winnerName, "Rồng Lửa");
		assert.equal(s.deps.xpLedger.total(GUILD, USER_A), xpA + 150);
		const [bonus] = s.deps.xpLedger.recent(GUILD, USER_B, 1);
		assert.deepEqual([bonus.amount, bonus.source, bonus.actorId, bonus.reason], [150, "admin", BOT, "Retro Retrospective PMS Sprint 24: tên sprint được chọn"]);
		assert.equal(s.deps.xpLedger.total(GUILD, USER_C), poll.xpReward, "người đề xuất tên thua chỉ có XP vote");
		assert.deepEqual(s.deps.xpLedger.teamTotals(GUILD, 10).map(entry => [entry.id, entry.total]).sort(), [
			[ROLE_BACKEND, 150],
			[ROLE_FRONTEND, 150],
		].sort(), "bonus theo team lúc điền; XP vote không có team vì vote với roleIds rỗng");

		assert.equal(s.retro.finalizeVote(GUILD, session.id, BOT).kind, "unchanged");
		assert.equal(s.deps.xpLedger.total(GUILD, USER_A), xpA + 150, "không cộng lần hai");
		assert.deepEqual(s.retro.pendingVoteResults(), []);
	});

	test("hoà: chờ người quản lý chọn trong các tên hoà (không phân biệt hoa thường); chọn xong cộng XP và audit retro.pick", () =>
	{
		const s = setup();
		const session = closedWithNames(s, ["Alpha Team", "Beta Squad", "Gamma"]);
		const { poll } = s.retro.startVote({ guildId: GUILD, sessionId: session.id, actorId: ADMIN });
		s.polls.vote({ guildId: GUILD, pollId: poll.id, userId: USER_A, optionIndex: 0, roleIds: [] });
		s.polls.vote({ guildId: GUILD, pollId: poll.id, userId: USER_B, optionIndex: 1, roleIds: [] });
		assertUserError(() => s.retro.pickName({ guildId: GUILD, sessionId: session.id, name: "Alpha Team", actorId: ADMIN, systemActorId: BOT }), /Chỉ chọn tên được khi/);
		s.polls.close({ guildId: GUILD, pollId: poll.id, actorId: ADMIN, actorIsAdmin: true });

		const tie = s.retro.finalizeVote(GUILD, session.id, BOT);
		assert.equal(tie.kind, "tie");
		if (tie.kind !== "tie") return;
		assert.deepEqual(tie.names, ["Alpha Team", "Beta Squad"]);
		assert.deepEqual(tie.session.tieNames, ["Alpha Team", "Beta Squad"]);
		assert.equal(tie.session.status, "voting");
		assert.equal(s.retro.finalizeVote(GUILD, session.id, BOT).kind, "unchanged", "không báo hoà lần hai");
		assert.deepEqual(s.retro.pendingVoteResults(), []);
		assert.deepEqual(s.retro.pickableNames(GUILD, session.id), ["Alpha Team", "Beta Squad"]);

		assertUserError(() => s.retro.pickName({ guildId: GUILD, sessionId: session.id, name: "Gamma", actorId: ADMIN, systemActorId: BOT }), /"Alpha Team", "Beta Squad"/);
		const xpB = s.deps.xpLedger.total(GUILD, USER_B);
		const picked = s.retro.pickName({ guildId: GUILD, sessionId: session.id, name: " beta   SQUAD ", actorId: USER_C, systemActorId: BOT });
		assert.equal(picked.kind, "winner");
		assert.equal(picked.session.winnerName, "Beta Squad");
		assert.equal(s.deps.xpLedger.total(GUILD, USER_B), xpB + DEFAULT_RETRO_CONFIG.proposerBonusXp);
		const [audit] = s.deps.audit.list(GUILD, 1);
		assert.deepEqual([audit.action, audit.actorId, audit.targetId, audit.details], ["retro.pick", USER_C, CHANNEL_GENERAL, { sessionId: session.id, title: session.title, name: "Beta Squad" }]);
		assertUserError(() => s.retro.pickName({ guildId: GUILD, sessionId: session.id, name: "Beta Squad", actorId: ADMIN, systemActorId: BOT }), "Phiên này đã chốt tên sprint.");
	});

	test("vote không ai bỏ phiếu: mọi tên hoà; chỉ một tên đề xuất thì người quản lý chọn tên đó mà không cần vote", () =>
	{
		const s = setup();
		const session = closedWithNames(s, ["Một", "Hai"]);
		const { poll } = s.retro.startVote({ guildId: GUILD, sessionId: session.id, actorId: ADMIN });
		s.polls.close({ guildId: GUILD, pollId: poll.id, actorId: ADMIN, actorIsAdmin: true });
		const outcome = s.retro.finalizeVote(GUILD, session.id, BOT);
		assert.equal(outcome.kind, "tie");

		const t = setup();
		const single = closedWithNames(t, ["Độc Nhất"]);
		assert.deepEqual(t.retro.pickableNames(GUILD, single.id), ["Độc Nhất"]);
		const picked = t.retro.pickName({ guildId: GUILD, sessionId: single.id, name: "độc nhất", actorId: ADMIN, systemActorId: BOT });
		assert.equal(picked.kind, "winner");
		assert.equal(picked.session.status, "done");
		assert.equal(t.deps.xpLedger.total(GUILD, USER_A), DEFAULT_RETRO_CONFIG.fillXp + DEFAULT_RETRO_CONFIG.proposerBonusXp);

		const u = setup();
		const two = closedWithNames(u, ["Một", "Hai"]);
		assert.deepEqual(u.retro.pickableNames(GUILD, two.id), [], "hai tên trở lên phải vote");
	});

	test("huỷ vote vừa tạo khi chưa ai bỏ phiếu: đóng vote, phiên về 'closed'; có phiếu rồi thì không huỷ được", () =>
	{
		const s = setup();
		const session = closedWithNames(s, ["Một", "Hai"]);
		const { poll } = s.retro.startVote({ guildId: GUILD, sessionId: session.id, actorId: ADMIN });
		const reverted = s.retro.cancelVote(GUILD, session.id, ADMIN);
		assert.equal(reverted.status, "closed");
		assert.equal(reverted.pollId, null);
		assert.notEqual(s.polls.get(GUILD, poll.id)?.closedAt, null);
		assertUserError(() => s.retro.cancelVote(GUILD, session.id, ADMIN), /không có vote/);

		const again = s.retro.startVote({ guildId: GUILD, sessionId: session.id, actorId: ADMIN });
		s.polls.vote({ guildId: GUILD, pollId: again.poll.id, userId: USER_C, optionIndex: 0, roleIds: [] });
		assertUserError(() => s.retro.cancelVote(GUILD, session.id, ADMIN), /đã có người bỏ phiếu/);
	});
});

describe("retro: Confluence, cấu hình, quyền", () =>
{
	test("lưu kết quả ghi Confluence: thành công xoá lỗi cũ; lỗi được cắt gọn", () =>
	{
		const s = setup();
		const session = createSession(s, { docUrl: DOC });
		const failed = s.retro.recordDocResult(GUILD, session.id, { ok: false, error: "x".repeat(500) });
		assert.equal(failed.confluenceError?.length, 300);
		assert.equal(failed.confluenceWrittenAt, null);
		s.clock.advance(1000);
		const written = s.retro.recordDocResult(GUILD, session.id, { ok: true });
		assert.equal(written.confluenceError, null);
		assert.equal(written.confluenceWrittenAt, s.clock.now());
	});

	test("cấu hình: mặc định 20 / 100 / 1440; kiểm tra giới hạn; audit chỉ ghi mục đã đổi", () =>
	{
		const s = setup();
		assert.deepEqual(s.retro.getConfig(GUILD), { fillXp: 20, proposerBonusXp: 100, voteMinutes: 1440, managerRoleIds: [] });
		assertUserError(() => s.retro.updateConfig(GUILD, { fillXp: -1 }, ADMIN), /XP khi điền retro phải là số nguyên từ 0 đến 1000/);
		assertUserError(() => s.retro.updateConfig(GUILD, { voteMinutes: 0 }, ADMIN), /Thời hạn vote/);
		assertUserError(() => s.retro.updateConfig(GUILD, { proposerBonusXp: 1.5 }, ADMIN), /số nguyên/);
		assertUserError(() => s.retro.updateConfig(GUILD, {}, ADMIN), /ít nhất một giá trị/);

		const updated = s.retro.updateConfig(GUILD, { proposerBonusXp: 300 }, ADMIN);
		assert.deepEqual(updated, { fillXp: 20, proposerBonusXp: 300, voteMinutes: 1440, managerRoleIds: [] });
		s.retro.updateConfig(GUILD, { fillXp: 5 }, ADMIN);
		assert.equal(s.retro.getConfig(GUILD).proposerBonusXp, 300, "mục không đổi giữ nguyên");
		assert.deepEqual(s.deps.audit.list(GUILD, 2).map(entry => [entry.action, entry.details]), [["retro.config", { fillXp: 5 }], ["retro.config", { proposerBonusXp: 300 }]]);
		assert.equal(s.retro.getConfig(OTHER_GUILD).proposerBonusXp, 100);
	});

	test("role quản lý retro: thêm/bỏ theo phần chênh lệch, tối đa 25, audit khi có đổi", () =>
	{
		const s = setup();
		const result = s.retro.changeManagerRoles(GUILD, { add: [ROLE_BACKEND, ROLE_FRONTEND, ROLE_BACKEND] }, ADMIN);
		assert.deepEqual(result, { added: [ROLE_BACKEND, ROLE_FRONTEND], removed: [], roleIds: [ROLE_BACKEND, ROLE_FRONTEND] });
		assert.deepEqual(s.retro.changeManagerRoles(GUILD, { add: [ROLE_BACKEND], remove: [ROLE_OTHER] }, ADMIN).roleIds, [ROLE_BACKEND, ROLE_FRONTEND]);
		assert.equal(s.deps.audit.list(GUILD, 10).length, 1, "không đổi gì thì không audit");
		assertUserError(() => s.retro.changeManagerRoles(GUILD, { add: [ROLE_OTHER], remove: [ROLE_OTHER] }, ADMIN), /vừa thêm vừa bỏ/);
		assert.deepEqual(s.retro.changeManagerRoles(GUILD, { remove: [ROLE_FRONTEND] }, ADMIN).roleIds, [ROLE_BACKEND]);
		const [audit] = s.deps.audit.list(GUILD, 1);
		assert.deepEqual(audit.details, { managerRoleIds: [ROLE_BACKEND], removedRoles: [ROLE_FRONTEND] });

		const many = Array.from({ length: 25 }, (_, index) => `5200000000000000${String(index).padStart(2, "0")}`);
		assertUserError(() => s.retro.changeManagerRoles(GUILD, { add: many }, ADMIN), /tối đa 25 role/);
		assert.deepEqual(s.retro.getConfig(GUILD).managerRoleIds, [ROLE_BACKEND]);
	});

	test("quyền: tạo phiên = admin bot hoặc role quản lý retro; quản lý phiên = thêm người tạo phiên", () =>
	{
		const settings = { adminRoleIds: [ROLE_OTHER] };
		const config = { managerRoleIds: [ROLE_BACKEND] };
		const session = { createdBy: USER_A };
		const plain = { userId: USER_B, hasManageGuild: false, roleIds: [ROLE_FRONTEND] };
		assert.equal(canCreateRetro(plain, settings, config), false);
		assert.equal(canManageRetro(plain, settings, config, session), false);
		assert.equal(canCreateRetro({ ...plain, roleIds: [ROLE_BACKEND] }, settings, config), true);
		assert.equal(canCreateRetro({ ...plain, roleIds: [ROLE_OTHER] }, settings, config), true);
		assert.equal(canCreateRetro({ ...plain, hasManageGuild: true }, settings, config), true);
		assert.equal(canManageRetro({ ...plain, userId: USER_A }, settings, config, session), true, "người tạo phiên");
		assert.equal(canCreateRetro({ ...plain, userId: USER_A }, settings, config), false, "người tạo phiên không vì thế mà tạo được phiên mới");
	});

	test("audit retro hiển thị đúng dữ liệu service thật: kênh là đối tượng, mã phiên, hạn, ô bị xoá, role quản lý (LL-011)", () =>
	{
		const s = setup();
		const session = createSession(s, { durationHours: 2 });
		submit(s, session.id, USER_A, { learned: "xoá tôi", kudos: "giữ" });
		s.retro.deleteIdea({ guildId: GUILD, sessionId: session.id, field: "learned", index: 0, text: "xoá tôi", actorId: ADMIN });
		s.retro.changeManagerRoles(GUILD, { add: [ROLE_BACKEND] }, ADMIN);

		const byAction = new Map(s.deps.audit.list(GUILD, 10).map(item => [item.action, formatAuditEntry(item)]));
		const created = byAction.get("retro.create") ?? "";
		assert.match(created, /Tạo phiên retro/);
		assert.ok(created.includes(`Đối tượng: <#${CHANNEL_GENERAL}>`), created);
		assert.ok(created.includes(`Mã phiên retro: ${session.id}`), created);
		assert.ok(created.includes(`Hạn: <t:${Math.floor((session.closesAt ?? 0) / 1000)}:f>`), created);
		const idea = byAction.get("retro.idea_delete") ?? "";
		assert.ok(idea.includes("Ô: 📚 Learned"), idea);
		assert.ok(!idea.includes(USER_A) && !idea.includes("Mã phiếu"), idea);
		const config = byAction.get("retro.config") ?? "";
		assert.ok(config.includes(`Role quản lý retro: <@&${ROLE_BACKEND}>`), config);
	});
});

describe("retro: sửa sau review Phase 19", () =>
{
	test("độ dài tên sprint và tiêu đề đếm theo UTF-16 như Discord và PollService; cutText cắt an toàn không tách emoji", () =>
	{
		const s = setup();
		assert.equal(createSession(s, { title: "😀".repeat(50) }).title.length, 100);
		assertUserError(() => createSession(s, { channelId: CHANNEL_BOT, title: "😀".repeat(51) }), /từ 3 đến 100 ký tự/);
		const session = createSession(s, { channelId: "400000000000000077" });
		assert.equal(submit(s, session.id, USER_A, { sprintName: "😀".repeat(40) }).answers.sprintName?.length, 80);
		assertUserError(() => submit(s, session.id, USER_B, { sprintName: "😀".repeat(41) }), /Tên sprint tối đa 80 ký tự/);

		assert.equal(cutText("abc", 5), "abc");
		assert.equal(cutText("ab😀c", 3), "ab", "không để lại nửa emoji");
		assert.equal(cutText("👨‍👩‍👧x", 8), "👨‍👩‍👧", "giữ nguyên cụm emoji");
		assert.equal(cutText("éé", 3), "é", "không tách dấu tổ hợp");
	});

	test("tạo vote: tên dài quá một lựa chọn vote (dữ liệu cũ) thì báo đúng tên đó, không tạo vote", () =>
	{
		const s = setup();
		const session = createSession(s);
		submit(s, session.id, USER_A, { sprintName: "Ngắn" });
		submit(s, session.id, USER_B, { sprintName: "Tên khác" });
		const long = `${"😀".repeat(41)}`;
		s.db.prepare("UPDATE retro_entries SET sprint_name = ? WHERE user_id = ?").run(long, USER_B);
		s.retro.close(GUILD, session.id, ADMIN);
		assertUserError(() => s.retro.startVote({ guildId: GUILD, sessionId: session.id, actorId: ADMIN }), new RegExp(`dài quá 80 ký tự.*"${long}"`, "u"));
		assert.equal(s.retro.get(GUILD, session.id)?.status, "closed");
		assert.equal(s.polls.listOpen(GUILD).length, 0);
	});

	test("mở lại: phiên chưa từng có tin trên Discord thì chặn (phải đăng lại tin trước); mở lại thì bảng tổng hợp lần đóng sau được đăng lại", () =>
	{
		const s = setup();
		const raw = s.retro.create({ guildId: GUILD, channelId: CHANNEL_GENERAL, title: "Retro chưa đăng", docUrl: null, teamRoleId: null, durationHours: null, createdBy: ADMIN });
		s.retro.close(GUILD, raw.id, ADMIN);
		assertUserError(() => s.retro.reopen(GUILD, raw.id, ADMIN, null), RETRO_NEVER_POSTED);
		s.retro.attachMessage(GUILD, raw.id, "600000000000000999");
		s.retro.markSummaryPosted(GUILD, raw.id);
		assert.notEqual(s.retro.get(GUILD, raw.id)?.summaryPostedAt, null);
		const reopened = s.retro.reopen(GUILD, raw.id, ADMIN, null);
		assert.equal(reopened.status, "open");
		assert.equal(reopened.summaryPostedAt, null, "lần đóng sau đăng bảng tổng hợp mới");
	});

	test("bảng tổng hợp chờ đăng: phiên đã đóng, có tin, còn nội dung, trong khoảng thời gian; đăng rồi thì thôi", () =>
	{
		const s = setup();
		const closedNow = createSession(s);
		const openOne = createSession(s, { channelId: CHANNEL_BOT });
		const neverPosted = s.retro.create({ guildId: GUILD, channelId: "400000000000000071", title: "Không có tin", docUrl: null, teamRoleId: null, durationHours: null, createdBy: ADMIN });
		const deleted = createSession(s, { channelId: "400000000000000072" });
		s.retro.close(GUILD, closedNow.id, ADMIN);
		s.retro.close(GUILD, neverPosted.id, ADMIN);
		s.retro.close(GUILD, deleted.id, ADMIN);
		s.retro.deleteContent(GUILD, deleted.id, ADMIN);
		const since = s.clock.now() - HOUR;
		assert.deepEqual(s.retro.pendingSummaries(since).map(session => session.id), [closedNow.id]);
		assert.equal(s.retro.get(GUILD, openOne.id)?.summaryPostedAt, null);

		s.clock.advance(2 * HOUR);
		assert.deepEqual(s.retro.pendingSummaries(s.clock.now() - HOUR), [], "đóng quá lâu thì không tự đăng bù nữa");
		assert.deepEqual(s.retro.pendingSummaries(since).map(session => session.id), [closedNow.id]);
		assert.equal(s.retro.markSummaryPosted(GUILD, closedNow.id).summaryPostedAt, s.clock.now());
		assert.deepEqual(s.retro.pendingSummaries(since), []);
	});

	test("xoá nội dung phiên: file database bật secure_delete và WAL được checkpoint, cắt về 0 byte ngay sau khi xoá", () =>
	{
		const dir = mkdtempSync(path.join(tmpdir(), "retro-wal-"));
		const db = openDatabase(path.join(dir, "bot.db"));
		try
		{
			runMigrations(db);
			assert.equal(db.pragma("secure_delete", { simple: true }), 1, "secure_delete bật cho kết nối của bot");
			const services = createServices(db, { clock: new FakeClock(), backupDir: path.join(dir, "backups"), backupKeep: 1 });
			const session = services.retro.create({ guildId: GUILD, channelId: CHANNEL_GENERAL, title: "Retro WAL", docUrl: null, teamRoleId: null, durationHours: null, createdBy: ADMIN });
			services.retro.submit({ guildId: GUILD, sessionId: session.id, userId: USER_A, roleIds: [], answers: answers({ learned: "chữ riêng tư".repeat(80) }), systemActorId: BOT });
			services.retro.close(GUILD, session.id, ADMIN);
			assert.ok(statSync(path.join(dir, "bot.db-wal")).size > 0, "đã có dữ liệu trong WAL trước khi xoá");
			services.retro.deleteContent(GUILD, session.id, ADMIN);
			assert.equal(statSync(path.join(dir, "bot.db-wal")).size, 0, "WAL không còn bản cũ của trang chứa chữ");
		}
		finally
		{
			db.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
