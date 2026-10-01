// Test các thao tác trên trang chi tiết Retro của web quản trị (Phase 19, DEC-041/DEC-049): đóng, mở lại, gia hạn, nhắc, ghi lại
// Confluence (thành công / lỗi / chưa cấu hình / không có link), xoá ý, xoá nội dung (có xác nhận), rút gọn + tạo vote tên sprint,
// chọn tên khi hoà hoặc khi chỉ có một tên, riêng tư theo kênh, CSRF, trang quay về khi lỗi. Đi qua retroOps thật (cùng hàm với lệnh
// /retro) với RetroActions giả: không gọi Discord hay Confluence thật.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ChannelType } from "discord.js";
import { DOC_WRITE_COOLDOWN_MS, VOTE_NOT_POSTED } from "../src/discord/retroOps";
import { RETRO_NAME_IN_VOTE } from "../src/modules/retro/RetroService";
import { escapeHtml } from "../src/web/html";
import {
	CONFIRM_REQUIRED,
	CONTENT_DELETE_CONFIRM,
	CONTENT_DELETE_WORD,
	CONTENT_WHILE_OPEN,
	HOURS_INVALID,
	IDEA_STALE,
	INVALID_RETRO_ID,
	NO_NAMES_PICKED,
	SECRET_CONTENT_DENIED,
} from "../src/web/pages/retro";
import { GUILD } from "./helpers";
import { closeSession, createSession, fill, flashAfter, getPage, ideaForm, pageUrl, post, sectionOf } from "./web-retro-helpers";
import {
	addChannel,
	ADMIN_USER,
	BOT_ID,
	call,
	CHANNEL_CHAT,
	CHANNEL_WORK,
	createWebHarness,
	login,
	LoggedIn,
	PLAIN_USER,
	ROLE_ADMIN_USER,
	ROLE_TEAM_A,
	ROLE_TEAM_B,
	WebHarness,
} from "./web-helpers";

const DOC = "https://confluence.test/pages/viewpage.action?pageId=777";
const HOUR = 60 * 60 * 1000;
const CHANNEL_SECRET = "410000000000000099";
const TOKEN_ERROR = "Confluence từ chối token (401): token sai, đã hết hạn hoặc đã bị thu hồi.";

/** User ID giả thứ `index` (không cần là thành viên server: người điền chỉ cần ID). */
function userId(index: number): string
{
	return `32000000000000${String(index).padStart(4, "0")}`;
}

async function setup(): Promise<{ harness: WebHarness; auth: LoggedIn }>
{
	const harness = createWebHarness();
	const auth = await login(harness, ADMIN_USER);
	return { harness, auth };
}

/** Phiên đã đóng (bằng service) với các tên sprint đề xuất, mỗi tên một người. */
function closedWithNames(harness: WebHarness, names: readonly string[], overrides: Parameters<typeof createSession>[1] = {}): number
{
	const session = createSession(harness, { docUrl: DOC, ...overrides });
	names.forEach((name, index) => fill(harness, session.id, userId(index), { sprintName: name, learned: `ý ${index}` }));
	harness.services.retro.close(GUILD, session.id, ADMIN_USER);
	return session.id;
}

function totalXp(harness: WebHarness, user: string): number
{
	return harness.services.activity.getProfile(GUILD, user).level.totalXp;
}

describe("web: Retro — đóng, mở lại, gia hạn, nhắc", () =>
{
	test("đóng: cần tick xác nhận; đóng thì tắt nút, đăng bảng tổng hợp ẩn danh, ghi Confluence, audit với người đăng nhập; đóng lần hai báo lỗi", async () =>
	{
		const { harness, auth } = await setup();
		const session = createSession(harness, { docUrl: DOC });
		fill(harness, session.id, PLAIN_USER, { learned: "Học được nhiều" });
		fill(harness, session.id, ROLE_ADMIN_USER, { improve: "Họp dài" });

		const unchecked = await flashAfter(harness, auth, await post(harness, auth, "/retro/close", { id: String(session.id) }));
		assert.equal(unchecked.kind, "error");
		assert.ok(unchecked.text.includes(CONFIRM_REQUIRED));
		assert.equal(unchecked.location, pageUrl(`/retro/view?id=${session.id}`));
		assert.equal(harness.services.retro.get(GUILD, session.id)?.status, "open");

		const closed = await flashAfter(harness, auth, await post(harness, auth, "/retro/close", { id: String(session.id), "xac-nhan": "1" }));
		assert.equal(closed.kind, "ok");
		assert.ok(closed.text.includes("Đã đóng phiên retro #1 (2 người đã điền)"), closed.text);
		assert.ok(closed.text.includes("📄 Đã ghi bảng retro vào Confluence."));
		assert.equal(harness.services.retro.get(GUILD, session.id)?.status, "closed");
		assert.ok(harness.retroCalls.includes(`refreshSession:${session.id}`), "sửa tin của phiên (tắt nút)");
		assert.equal(harness.retroPosts.length, 1);
		assert.equal(harness.retroPosts[0]?.channelId, CHANNEL_CHAT, "bảng tổng hợp đăng trong kênh của phiên");
		const summary = JSON.stringify(harness.retroPosts[0]?.payload.components);
		assert.ok(summary.includes("Học được nhiều") && !summary.includes(PLAIN_USER), "bảng tổng hợp ẩn danh");
		assert.equal(harness.retroDoc.writes.length, 1);
		assert.ok(!JSON.stringify(harness.retroDoc.writes[0]).includes(PLAIN_USER), "Confluence không nhận người viết");
		const audit = harness.services.audit.list(GUILD, 20).find(entry => entry.action === "retro.close");
		assert.equal(audit?.actorId, ADMIN_USER);

		const again = await flashAfter(harness, auth, await post(harness, auth, "/retro/close", { id: String(session.id), "xac-nhan": "1" }));
		assert.equal(again.kind, "error");
		assert.ok(again.text.includes("Phiên retro này đã đóng."));
		assert.equal(again.location, pageUrl(`/retro/view?id=${session.id}`));
	});

	test("mở lại (số giờ tuỳ chọn) và gia hạn (bắt buộc số giờ); số giờ sai báo lỗi; gia hạn phiên đã đóng báo lỗi", async () =>
	{
		const { harness, auth } = await setup();
		const session = createSession(harness);
		harness.services.retro.close(GUILD, session.id, ADMIN_USER);
		const id = String(session.id);

		const badHours = await flashAfter(harness, auth, await post(harness, auth, "/retro/reopen", { id, "han-gio": "x" }));
		assert.equal(badHours.kind, "error");
		assert.ok(badHours.text.includes(escapeHtml(HOURS_INVALID)));

		const reopened = await flashAfter(harness, auth, await post(harness, auth, "/retro/reopen", { id, "han-gio": "5" }));
		assert.equal(reopened.kind, "ok");
		assert.ok(reopened.text.includes("Đã mở lại phiên retro #1"), reopened.text);
		assert.equal(harness.services.retro.get(GUILD, session.id)?.status, "open");
		assert.equal(harness.services.retro.get(GUILD, session.id)?.closesAt, harness.clock.now() + 5 * HOUR);

		const missing = await flashAfter(harness, auth, await post(harness, auth, "/retro/extend", { id, "han-gio": "" }));
		assert.equal(missing.kind, "error");
		assert.ok(missing.text.includes(escapeHtml(HOURS_INVALID)));
		const extended = await flashAfter(harness, auth, await post(harness, auth, "/retro/extend", { id, "han-gio": "3" }));
		assert.equal(extended.kind, "ok");
		assert.ok(extended.text.includes("Đã gia hạn phiên retro #1"));
		assert.equal(harness.services.retro.get(GUILD, session.id)?.closesAt, harness.clock.now() + 3 * HOUR);
		const audit = harness.services.audit.list(GUILD, 20).map(entry => `${entry.action}:${entry.actorId}`);
		assert.ok(audit.includes(`retro.reopen:${ADMIN_USER}`) && audit.includes(`retro.extend:${ADMIN_USER}`));

		harness.services.retro.close(GUILD, session.id, ADMIN_USER);
		const extendClosed = await flashAfter(harness, auth, await post(harness, auth, "/retro/extend", { id, "han-gio": "3" }));
		assert.equal(extendClosed.kind, "error");
		assert.ok(extendClosed.text.includes("Chỉ gia hạn được phiên đang mở"));
		const reopenForever = await flashAfter(harness, auth, await post(harness, auth, "/retro/reopen", { id, "han-gio": "" }));
		assert.equal(reopenForever.kind, "ok");
		assert.equal(harness.services.retro.get(GUILD, session.id)?.closesAt, null, "bỏ trống: không tự đóng");
	});

	test("nhắc: đăng trong kênh của phiên, chỉ ping role team; nhắc lại ngay bị chặn", async () =>
	{
		const { harness, auth } = await setup();
		harness.services.teams.add(GUILD, ROLE_TEAM_A, ADMIN_USER);
		const session = createSession(harness, { teamRoleId: ROLE_TEAM_A });
		const reminded = await flashAfter(harness, auth, await post(harness, auth, "/retro/remind", { id: String(session.id) }));
		assert.equal(reminded.kind, "ok");
		assert.ok(reminded.text.includes("Đã nhắc team điền retro"));
		const [posted] = harness.retroPosts;
		assert.equal(posted?.channelId, CHANNEL_CHAT);
		assert.deepEqual(posted?.payload.allowedMentions, { parse: [], roles: [ROLE_TEAM_A] });

		const again = await flashAfter(harness, auth, await post(harness, auth, "/retro/remind", { id: String(session.id) }));
		assert.equal(again.kind, "error");
		assert.ok(again.text.includes("vừa được nhắc"));
		assert.equal(harness.retroPosts.length, 1);
	});
});

describe("web: Retro — Confluence", () =>
{
	test("ghi lại thành công; lỗi thì báo lỗi và lưu để thử lại; chưa cấu hình thì nói rõ; phiên không có link thì bỏ qua", async () =>
	{
		const { harness, auth } = await setup();
		const session = createSession(harness, { docUrl: DOC });
		fill(harness, session.id, PLAIN_USER, { learned: "x" });
		const id = String(session.id);

		const whileOpen = await flashAfter(harness, auth, await post(harness, auth, "/retro/write", { id }));
		assert.equal(whileOpen.kind, "ok");
		assert.ok(whileOpen.text.includes("phiên còn mở"), whileOpen.text);
		assert.equal(harness.retroDoc.writes.length, 0, "phiên còn mở thì không ghi Confluence (giữ ẩn danh)");
		closeSession(harness, session.id);

		const written = await flashAfter(harness, auth, await post(harness, auth, "/retro/write", { id }));
		assert.equal(written.kind, "ok");
		assert.ok(written.text.includes("📄 Đã ghi bảng retro vào Confluence."));
		assert.equal(harness.retroDoc.writes.length, 1);
		assert.equal(harness.retroDoc.writes[0]?.docUrl, DOC);
		assert.notEqual(harness.services.retro.get(GUILD, session.id)?.confluenceWrittenAt, null);
		assert.ok(written.body.includes("Confluence: ✅ đã ghi"));

		const tooSoon = await flashAfter(harness, auth, await post(harness, auth, "/retro/write", { id }));
		assert.equal(tooSoon.kind, "error");
		assert.ok(tooSoon.text.includes("Vừa ghi Confluence cho phiên này"), tooSoon.text);
		assert.equal(harness.retroDoc.writes.length, 1, "bấm lại ngay thì không gọi Confluence (30 giây mỗi phiên)");

		harness.clock.advance(DOC_WRITE_COOLDOWN_MS);
		harness.retroDoc.error = TOKEN_ERROR;
		const failed = await flashAfter(harness, auth, await post(harness, auth, "/retro/write", { id }));
		assert.equal(failed.kind, "error");
		assert.ok(failed.text.includes("❌ Ghi Confluence lỗi: Confluence từ chối token (401)"), failed.text);
		assert.equal(harness.services.retro.get(GUILD, session.id)?.confluenceError, TOKEN_ERROR);
		assert.ok(failed.body.includes("lần ghi gần nhất lỗi"));

		harness.deps.retroActions = { ...harness.deps.retroActions, docWriter: null };
		const off = await flashAfter(harness, auth, await post(harness, auth, "/retro/write", { id }));
		assert.equal(off.kind, "ok");
		assert.ok(off.text.includes("📄 Không ghi Confluence: bot chưa bật ghi Confluence"), off.text);
		assert.ok(off.body.includes("Bot chưa bật ghi Confluence (CONFLUENCE_BASE_URL, CONFLUENCE_TOKEN), nên chỉ lưu link."));
		assert.ok(off.body.includes("📄 Xuất chữ để dán vào Confluence"), "vẫn xuất chữ để dán tay");
		assert.ok(!off.body.includes(pageUrl("/retro/write")), "không có nút ghi khi chưa cấu hình");

		const noLink = createSession(harness, { channelId: CHANNEL_WORK });
		harness.deps.retroActions = { ...harness.deps.retroActions, docWriter: harness.retroDoc };
		const skipped = await flashAfter(harness, auth, await post(harness, auth, "/retro/write", { id: String(noLink.id) }));
		assert.equal(skipped.kind, "ok");
		assert.ok(skipped.text.includes("📄 Không ghi Confluence: phiên chưa gắn link tài liệu."));
	});
});

describe("web: Retro — xoá ý và xoá nội dung", () =>
{
	test("xoá một ý: cần tick xác nhận; form cũ hay sai thì từ chối; xoá đúng ý, giữ ý khác; audit không ghi người viết", async () =>
	{
		const { harness, auth } = await setup();
		const session = createSession(harness);
		fill(harness, session.id, PLAIN_USER, { learned: "Ý tốt", improve: "Ý xấu <b>" });
		fill(harness, session.id, ROLE_ADMIN_USER, { learned: "Ý khác" });
		closeSession(harness, session.id);
		const body = await getPage(harness, auth, `/retro/view?id=${session.id}`);
		const form = ideaForm(body, "Ý xấu &lt;b&gt;");
		assert.equal(form.o, "improve");

		const unchecked = await flashAfter(harness, auth, await post(harness, auth, "/retro/idea-delete", form));
		assert.equal(unchecked.kind, "error");
		assert.ok(unchecked.text.includes(CONFIRM_REQUIRED));
		for (const forged of [{ ...form, kt: "0000000000000000" }, { ...form, o: "xyz" }, { ...form, muc: "9" }, { ...form, muc: "-1" }])
		{
			const stale = await flashAfter(harness, auth, await post(harness, auth, "/retro/idea-delete", { ...forged, "xac-nhan": "1" }));
			assert.equal(stale.kind, "error", JSON.stringify(forged));
			assert.ok(stale.text.includes(IDEA_STALE));
		}

		const deleted = await flashAfter(harness, auth, await post(harness, auth, "/retro/idea-delete", { ...form, "xac-nhan": "1" }));
		assert.equal(deleted.kind, "ok");
		assert.ok(deleted.text.includes("Đã xoá một ý ở cột “👎 Thiếu sót”"), deleted.text);
		const columns = harness.services.retro.columns(GUILD, session.id);
		const texts = [...columns.learned, ...columns.improve];
		assert.ok(!texts.includes("Ý xấu <b>"));
		assert.ok(texts.includes("Ý tốt") && texts.includes("Ý khác"), "ý khác còn nguyên");
		const audit = harness.services.audit.list(GUILD, 20).find(entry => entry.action === "retro.idea_delete");
		assert.equal(audit?.actorId, ADMIN_USER);
		assert.ok(!JSON.stringify(audit?.details).includes(PLAIN_USER), "audit không ghi người viết");
		assert.deepEqual(audit?.details, { sessionId: session.id, title: session.title, field: "improve" }, "audit không có mã phiếu");

		const twice = await flashAfter(harness, auth, await post(harness, auth, "/retro/idea-delete", { ...form, "xac-nhan": "1" }));
		assert.equal(twice.kind, "error");
		assert.ok(twice.text.includes(IDEA_STALE));
	});

	test("xoá nội dung: phiên đang mở bị từ chối; cần tick và gõ đúng chữ xác nhận; xoá thì giữ phiên, người đã điền và XP", async () =>
	{
		const { harness, auth } = await setup();
		const session = createSession(harness, { docUrl: DOC });
		fill(harness, session.id, PLAIN_USER, { learned: "Riêng tư A" });
		fill(harness, session.id, ROLE_ADMIN_USER, { kudos: "Riêng tư B" });
		const xpBefore = totalXp(harness, PLAIN_USER);
		const id = String(session.id);

		const whileOpen = await flashAfter(harness, auth, await post(harness, auth, "/retro/content-delete", { id, "xac-nhan": "1", "chu-xac-nhan": CONTENT_DELETE_WORD }));
		assert.equal(whileOpen.kind, "error");
		assert.ok(whileOpen.text.includes("Hãy đóng phiên retro trước khi xoá nội dung."));

		harness.services.retro.close(GUILD, session.id, ADMIN_USER);
		const detail = await getPage(harness, auth, `/retro/view?id=${session.id}`);
		assert.ok(sectionOf(detail, "🗑️ Xoá nội dung phiên").includes(pageUrl("/retro/content-delete")));
		const refusedForms: Record<string, string>[] = [{ id, "chu-xac-nhan": CONTENT_DELETE_WORD }, { id, "xac-nhan": "1" }, { id, "xac-nhan": "1", "chu-xac-nhan": "xoa" }];
		for (const form of refusedForms)
		{
			const refused = await flashAfter(harness, auth, await post(harness, auth, "/retro/content-delete", form));
			assert.equal(refused.kind, "error", JSON.stringify(form));
			assert.ok(refused.text.includes(escapeHtml(CONTENT_DELETE_CONFIRM)));
		}
		assert.equal(harness.services.retro.get(GUILD, session.id)?.contentDeletedAt, null);

		const deleted = await flashAfter(harness, auth, await post(harness, auth, "/retro/content-delete", { id, "xac-nhan": "1", "chu-xac-nhan": ` ${CONTENT_DELETE_WORD} ` }));
		assert.equal(deleted.kind, "ok");
		assert.ok(deleted.text.includes("Đã xoá hẳn nội dung của phiên retro #1"));
		const after = harness.services.retro.get(GUILD, session.id);
		assert.notEqual(after?.contentDeletedAt, null);
		assert.equal(after?.participants, 2);
		assert.deepEqual(harness.services.retro.columns(GUILD, session.id), { learned: [], improve: [], ideas: [], kudos: [], sprintName: [] });
		assert.deepEqual(harness.services.retro.participants(GUILD, session.id), [PLAIN_USER, ROLE_ADMIN_USER].sort());
		assert.equal(totalXp(harness, PLAIN_USER), xpBefore, "XP đã cộng giữ nguyên");
		assert.ok(!deleted.body.includes("Riêng tư A") && deleted.body.includes("Nội dung đã bị xoá"));
		assert.ok(!deleted.body.includes("<textarea"), "không còn gì để xuất");
		const audit = harness.services.audit.list(GUILD, 20).find(entry => entry.action === "retro.content_delete");
		assert.equal(audit?.actorId, ADMIN_USER);

		const twice = await flashAfter(harness, auth, await post(harness, auth, "/retro/content-delete", { id, "xac-nhan": "1", "chu-xac-nhan": CONTENT_DELETE_WORD }));
		assert.equal(twice.kind, "error");
		assert.ok(twice.text.includes("đã được xoá trước đó"));
	});
});

describe("web: Retro — vote tên sprint và chọn tên", () =>
{
	test("≤ 10 tên: tick sẵn mọi tên; không tick tên nào bị từ chối; rút gọn 2 tên thì tạo vote đúng 2 tên, đăng tin vote trong kênh của phiên", async () =>
	{
		const { harness, auth } = await setup();
		const id = closedWithNames(harness, ["Rồng Lửa", "Phượng Hoàng", "Kỳ Lân"]);
		const body = await getPage(harness, auth, `/retro/view?id=${id}`);
		const vote = sectionOf(body, "🍀 Tên sprint và vote");
		assert.equal(vote.split(" checked>").length - 1, 3, "mọi tên được tick sẵn");
		assert.ok(vote.includes(`href="${pageUrl(`/retro/view?id=${id}&amp;chon=bo-het`)}"`), "link bỏ chọn tất cả giữ mã phiên");

		const none = await flashAfter(harness, auth, await post(harness, auth, "/retro/vote", { id: String(id) }));
		assert.equal(none.kind, "error");
		assert.ok(none.text.includes(NO_NAMES_PICKED));

		const created = await flashAfter(harness, auth, await post(harness, auth, "/retro/vote", { id: String(id), ten: ["Rồng Lửa", "Kỳ Lân"] }));
		assert.equal(created.kind, "ok");
		assert.ok(created.text.includes("Đã tạo vote tên sprint #1 với 2 tên"), created.text);
		const session = harness.services.retro.get(GUILD, id);
		assert.equal(session?.status, "voting");
		const poll = harness.services.polls.get(GUILD, session?.pollId ?? 0);
		assert.deepEqual(poll?.options.map(option => option.label), ["Rồng Lửa", "Kỳ Lân"]);
		assert.equal(poll?.multiSelect, false);
		assert.equal(harness.retroPosts.at(-1)?.channelId, CHANNEL_CHAT, "tin vote đăng trong kênh của phiên");
		assert.notEqual(poll?.messageId, null, "gắn tin vote");
		assert.equal(harness.services.audit.list(GUILD, 20).find(entry => entry.action === "retro.vote")?.actorId, ADMIN_USER);
		assert.ok(created.body.includes(`href="${pageUrl("/polls/view?id=1")}"`), "trang chi tiết trỏ tới vote");
	});

	test("> 10 tên: không tick sẵn, nhắc chọn danh sách rút gọn; Chọn tất cả tick hết; gửi quá 10 tên bị từ chối; 3 tên thì tạo được", async () =>
	{
		const { harness, auth } = await setup();
		const names = Array.from({ length: 11 }, (_, index) => `Tên số ${String.fromCharCode(65 + index)}`);
		const id = closedWithNames(harness, names);
		const body = await getPage(harness, auth, `/retro/view?id=${id}`);
		const vote = sectionOf(body, "🍀 Tên sprint và vote");
		assert.ok(vote.includes("Có 11 tên, nhiều hơn 10 lựa chọn"));
		assert.equal(vote.split(" checked>").length - 1, 0);
		const all = sectionOf(await getPage(harness, auth, `/retro/view?id=${id}&chon=tat-ca`), "🍀 Tên sprint và vote");
		assert.equal(all.split(" checked>").length - 1, 11);
		assert.ok(all.includes("chưa lưu"));

		const tooMany = await flashAfter(harness, auth, await post(harness, auth, "/retro/vote", { id: String(id), ten: names }));
		assert.equal(tooMany.kind, "error");
		assert.ok(tooMany.text.includes("Danh sách rút gọn phải có từ 2 đến 10 tên khác nhau."));
		const notCandidate = await flashAfter(harness, auth, await post(harness, auth, "/retro/vote", { id: String(id), ten: ["Tên số A", "Tên lạ"] }));
		assert.equal(notCandidate.kind, "error");
		assert.ok(notCandidate.text.includes("không có trong các tên được đề xuất"));

		const created = await flashAfter(harness, auth, await post(harness, auth, "/retro/vote", { id: String(id), ten: ["Tên số A", "Tên số B", "Tên số K"] }));
		assert.equal(created.kind, "ok");
		assert.deepEqual(harness.services.polls.get(GUILD, 1)?.options.map(option => option.label), ["Tên số A", "Tên số B", "Tên số K"]);
	});

	test("vote hoà: chọn tên cuối cùng trong các tên hoà (cần xác nhận); tên ngoài danh sách bị từ chối; chốt thì cộng XP người đề xuất, công bố, ghi Confluence", async () =>
	{
		const { harness, auth } = await setup();
		const id = closedWithNames(harness, ["Rồng Lửa", "Phượng Hoàng"]);
		await post(harness, auth, "/retro/vote", { id: String(id), ten: ["Rồng Lửa", "Phượng Hoàng"] });
		const pollId = harness.services.retro.get(GUILD, id)?.pollId ?? 0;
		harness.services.polls.vote({ guildId: GUILD, pollId, userId: PLAIN_USER, optionIndex: 0, roleIds: [] });
		harness.services.polls.vote({ guildId: GUILD, pollId, userId: ROLE_ADMIN_USER, optionIndex: 1, roleIds: [] });
		harness.services.polls.vote({ guildId: GUILD, pollId, userId: "310000000000000771", optionIndex: 0, roleIds: [] });
		harness.services.polls.vote({ guildId: GUILD, pollId, userId: "310000000000000772", optionIndex: 1, roleIds: [] });
		harness.services.polls.close({ guildId: GUILD, pollId, actorId: ADMIN_USER, actorIsAdmin: true });
		assert.equal(harness.services.retro.finalizeVote(GUILD, id, BOT_ID).kind, "tie");

		const body = await getPage(harness, auth, `/retro/view?id=${id}`);
		const vote = sectionOf(body, "🍀 Tên sprint và vote");
		assert.ok(vote.includes("Vote tên sprint hoà"));
		assert.ok(vote.includes("value=\"Rồng Lửa\"") && vote.includes("value=\"Phượng Hoàng\""));

		const unchecked = await flashAfter(harness, auth, await post(harness, auth, "/retro/pick", { id: String(id), ten: "Rồng Lửa" }));
		assert.equal(unchecked.kind, "error");
		assert.ok(unchecked.text.includes(CONFIRM_REQUIRED));
		const outsider = await flashAfter(harness, auth, await post(harness, auth, "/retro/pick", { id: String(id), ten: "Kỳ Lân", "xac-nhan": "1" }));
		assert.equal(outsider.kind, "error");
		assert.ok(outsider.text.includes("Chỉ chọn được một trong các tên"));

		const xpBefore = totalXp(harness, userId(0));
		const writesBefore = harness.retroDoc.writes.length;
		const picked = await flashAfter(harness, auth, await post(harness, auth, "/retro/pick", { id: String(id), ten: "rồng  lửa", "xac-nhan": "1" }));
		assert.equal(picked.kind, "ok");
		assert.ok(picked.text.includes("Đã chốt tên sprint &quot;Rồng Lửa&quot;"), picked.text);
		const session = harness.services.retro.get(GUILD, id);
		assert.equal(session?.status, "done");
		assert.equal(session?.winnerName, "Rồng Lửa");
		assert.equal(totalXp(harness, userId(0)), xpBefore + 100, "người đề xuất tên được chọn được cộng XP");
		assert.ok(String(harness.retroPosts.at(-1)?.payload.content).includes("🏆 Tên sprint được chọn"));
		assert.equal(harness.retroDoc.writes.length, writesBefore + 1, "ghi Confluence kèm tên đã chốt");
		assert.equal(harness.services.audit.list(GUILD, 20).find(entry => entry.action === "retro.pick")?.actorId, ADMIN_USER);
		assert.ok(picked.body.includes("🏆 Tên sprint được chọn: <strong>Rồng Lửa</strong>"));
	});

	test("chỉ một tên được đề xuất: không cần vote, chốt tên đó; bot không đăng được tin vote thì huỷ vote, báo lỗi", async () =>
	{
		const { harness, auth } = await setup();
		const single = closedWithNames(harness, ["Duy Nhất"]);
		const body = await getPage(harness, auth, `/retro/view?id=${single}`);
		assert.ok(body.includes("Chỉ có một tên được đề xuất, không cần vote"));
		const picked = await flashAfter(harness, auth, await post(harness, auth, "/retro/pick", { id: String(single), ten: "Duy Nhất", "xac-nhan": "1" }));
		assert.equal(picked.kind, "ok");
		assert.equal(harness.services.retro.get(GUILD, single)?.winnerName, "Duy Nhất");

		const two = closedWithNames(harness, ["Một", "Hai"], { channelId: CHANNEL_WORK });
		harness.deps.retroActions = { ...harness.deps.retroActions, post: () => Promise.resolve({ ok: false, reason: "failed" }) };
		const failed = await flashAfter(harness, auth, await post(harness, auth, "/retro/vote", { id: String(two), ten: ["Một", "Hai"] }));
		assert.equal(failed.kind, "error");
		assert.ok(failed.text.includes(escapeHtml(VOTE_NOT_POSTED)));
		const reverted = harness.services.retro.get(GUILD, two);
		assert.equal(reverted?.status, "closed");
		assert.equal(reverted?.pollId, null);
	});

	test("phiên ở kênh không xem được: không hiện tên; chỉ tạo được vote với toàn bộ tên; xoá ý, rút gọn, chọn tên bị từ chối", async () =>
	{
		const { harness, auth } = await setup();
		addChannel(harness.world, { id: CHANNEL_SECRET, name: "ban-giam-doc", type: ChannelType.GuildText, permissionsByMember: { [ADMIN_USER]: [] } });
		const id = closedWithNames(harness, ["Tên Kín A", "Tên Kín B"], { channelId: CHANNEL_SECRET });
		const body = await getPage(harness, auth, `/retro/view?id=${id}`);
		assert.ok(!body.includes("Tên Kín"));
		assert.ok(body.includes("Tạo vote với toàn bộ 2 tên"));

		const digest = createHash("sha256").update("ý 0").digest("hex").slice(0, 16);
		const ideaDenied = await flashAfter(harness, auth, await post(harness, auth, "/retro/idea-delete", { id: String(id), muc: "0", o: "learned", kt: digest, "xac-nhan": "1" }));
		assert.equal(ideaDenied.kind, "error");
		assert.ok(ideaDenied.text.includes(escapeHtml(SECRET_CONTENT_DENIED)));
		assert.equal(harness.services.retro.columns(GUILD, id).learned.length, 2, "không xoá gì");
		const shortlistDenied = await flashAfter(harness, auth, await post(harness, auth, "/retro/vote", { id: String(id), ten: ["Tên Kín A", "Tên Kín B"] }));
		assert.equal(shortlistDenied.kind, "error");
		assert.ok(shortlistDenied.text.includes(escapeHtml(SECRET_CONTENT_DENIED)));

		const created = await flashAfter(harness, auth, await post(harness, auth, "/retro/vote", { id: String(id), "tat-ca": "1" }));
		assert.equal(created.kind, "ok");
		assert.equal(harness.services.polls.get(GUILD, 1)?.options.length, 2);
		assert.ok(!created.body.includes("Tên Kín"), "flash và trang không lộ tên");

		const pickDenied = await flashAfter(harness, auth, await post(harness, auth, "/retro/pick", { id: String(id), ten: "Tên Kín A", "xac-nhan": "1" }));
		assert.equal(pickDenied.kind, "error");
		assert.ok(pickDenied.text.includes(escapeHtml(SECRET_CONTENT_DENIED)));
	});
});

describe("web: Retro — bảo vệ form", () =>
{
	test("thiếu hoặc sai CSRF: 403, không đổi gì; mã phiên sai hoặc không có: báo lỗi về danh sách", async () =>
	{
		const { harness, auth } = await setup();
		const session = createSession(harness);
		const noToken = await call(harness, pageUrl("/retro/close"), { cookies: auth.cookies, form: { id: String(session.id), "xac-nhan": "1" } });
		assert.equal(noToken.status, 403);
		const wrongToken = await call(harness, pageUrl("/retro/content-delete"), { cookies: auth.cookies, form: { _csrf: "sai", id: String(session.id) } });
		assert.equal(wrongToken.status, 403);
		assert.equal(harness.services.retro.get(GUILD, session.id)?.status, "open");

		const missing = await flashAfter(harness, auth, await post(harness, auth, "/retro/close", { id: "999", "xac-nhan": "1" }));
		assert.equal(missing.kind, "error");
		assert.equal(missing.location, pageUrl("/retro"));
		assert.ok(missing.text.includes("Không tìm thấy phiên retro"));
		const invalid = await flashAfter(harness, auth, await post(harness, auth, "/retro/remind", { id: "abc" }));
		assert.equal(invalid.location, pageUrl("/retro"));
		assert.ok(invalid.text.includes(INVALID_RETRO_ID));
	});
});

describe("web: Retro — ẩn danh, đăng lại, nhắc không ping được (review Phase 19)", () =>
{
	test("phiên đang mở: form xoá ý gửi tay (đoán chữ) bị từ chối, không xoá gì", async () =>
	{
		const { harness, auth } = await setup();
		const session = createSession(harness);
		fill(harness, session.id, PLAIN_USER, { learned: "Không có" });
		const digest = createHash("sha256").update("Không có").digest("hex").slice(0, 16);
		const refused = await flashAfter(harness, auth, await post(harness, auth, "/retro/idea-delete", { id: String(session.id), muc: "0", o: "learned", kt: digest, "xac-nhan": "1" }));
		assert.equal(refused.kind, "error");
		assert.ok(refused.text.includes(escapeHtml(CONTENT_WHILE_OPEN)), refused.text);
		assert.deepEqual(harness.services.retro.columns(GUILD, session.id).learned, ["Không có"]);
	});

	test("xoá tên sprint: xoá tên đó ở mọi phiếu đã đề xuất (mọi cách viết); đang vote thì chặn", async () =>
	{
		const { harness, auth } = await setup();
		const session = createSession(harness);
		fill(harness, session.id, PLAIN_USER, { sprintName: "Tên Tục", learned: "a" });
		fill(harness, session.id, ROLE_ADMIN_USER, { sprintName: "tên  tục" });
		fill(harness, session.id, userId(1), { sprintName: "Rồng Lửa" });
		fill(harness, session.id, userId(2), { sprintName: "Phượng Hoàng" });
		closeSession(harness, session.id);
		const body = await getPage(harness, auth, `/retro/view?id=${session.id}`);
		const form = ideaForm(body, "Tên Tục");
		assert.equal(form.o, "sprintName");

		const deleted = await flashAfter(harness, auth, await post(harness, auth, "/retro/idea-delete", { ...form, "xac-nhan": "1" }));
		assert.equal(deleted.kind, "ok", deleted.text);
		assert.ok(deleted.text.includes("một tên sprint (ở mọi phiếu đã đề xuất tên đó)"), deleted.text);
		assert.deepEqual(harness.services.retro.columns(GUILD, session.id).sprintName, ["Phượng Hoàng", "Rồng Lửa"]);
		assert.equal(harness.services.retro.getAnswers(GUILD, session.id, ROLE_ADMIN_USER)?.sprintName, null, "cách viết khác của cùng tên cũng bị xoá");
		assert.equal(harness.services.retro.getAnswers(GUILD, session.id, PLAIN_USER)?.learned, "a", "ô khác giữ nguyên");

		await post(harness, auth, "/retro/vote", { id: String(session.id), ten: ["Phượng Hoàng", "Rồng Lửa"] });
		const voting = await getPage(harness, auth, `/retro/view?id=${session.id}`);
		assert.ok(voting.includes("Đang vote tên sprint: chốt tên xong mới xoá được tên."));
		assert.ok(!sectionOf(voting, "📋 Nội dung ẩn danh").includes("name=\"o\" value=\"sprintName\""), "không có form xoá tên khi đang vote");
		const digest = createHash("sha256").update("Rồng Lửa").digest("hex").slice(0, 16);
		const blocked = await flashAfter(harness, auth, await post(harness, auth, "/retro/idea-delete", { id: String(session.id), muc: "1", o: "sprintName", kt: digest, "xac-nhan": "1" }));
		assert.equal(blocked.kind, "error");
		assert.ok(blocked.text.includes(escapeHtml(RETRO_NAME_IN_VOTE)), blocked.text);
		assert.deepEqual(harness.services.retro.columns(GUILD, session.id).sprintName, ["Phượng Hoàng", "Rồng Lửa"]);
	});

	test("đăng lại tin của phiên: bot đăng tin mới có nút điền và cập nhật tin mới từ đó; đăng lại bảng tổng hợp sau khi đóng", async () =>
	{
		const { harness, auth } = await setup();
		const session = createSession(harness);
		fill(harness, session.id, PLAIN_USER, { learned: "Ý của phiên" });
		const reposted = await flashAfter(harness, auth, await post(harness, auth, "/retro/repost", { id: String(session.id) }));
		assert.equal(reposted.kind, "ok");
		assert.ok(reposted.text.includes(`Đã đăng lại tin của phiên retro #${session.id}`), reposted.text);
		const [posted] = harness.retroPosts;
		assert.equal(posted?.channelId, CHANNEL_CHAT);
		assert.ok(JSON.stringify(posted?.payload.components).includes(`"custom_id":"retro:fill:${session.id}"`));
		assert.equal(harness.services.retro.get(GUILD, session.id)?.messageId, "700000000000000001", "tin mới thành tin của phiên");

		const tooEarly = await flashAfter(harness, auth, await post(harness, auth, "/retro/summary", { id: String(session.id) }));
		assert.equal(tooEarly.kind, "error");
		assert.ok(tooEarly.text.includes("Phiên còn mở"));

		closeSession(harness, session.id);
		const summary = await flashAfter(harness, auth, await post(harness, auth, "/retro/summary", { id: String(session.id) }));
		assert.equal(summary.kind, "ok", summary.text);
		assert.ok(JSON.stringify(harness.retroPosts.at(-1)?.payload.components).includes("Ý của phiên"), "bảng tổng hợp có nội dung");
		assert.notEqual(harness.services.retro.get(GUILD, session.id)?.summaryPostedAt, null);
		assert.ok(summary.body.includes("Đã đăng lúc"), "trang ghi bảng tổng hợp đã đăng");

		harness.deps.retroActions = { ...harness.deps.retroActions, post: () => Promise.resolve({ ok: false, reason: "archived" }) };
		const archived = await flashAfter(harness, auth, await post(harness, auth, "/retro/repost", { id: String(session.id) }));
		assert.equal(archived.kind, "error");
		assert.ok(archived.text.includes("Thread của phiên đang lưu trữ"), archived.text);
	});

	test("nhắc khi role team không cho mention và bot thiếu Mention Everyone: vẫn đăng nhưng nói rõ không ping được, không báo “Đã nhắc”", async () =>
	{
		const { harness, auth } = await setup();
		harness.services.teams.add(GUILD, ROLE_TEAM_B, ADMIN_USER);
		const session = createSession(harness, { teamRoleId: ROLE_TEAM_B });
		const reminded = await flashAfter(harness, auth, await post(harness, auth, "/retro/remind", { id: String(session.id) }));
		assert.equal(reminded.kind, "ok");
		assert.ok(reminded.text.includes("KHÔNG ping được"), reminded.text);
		assert.ok(!reminded.text.includes("Đã nhắc"), reminded.text);
		assert.deepEqual(harness.retroPosts[0]?.payload.allowedMentions, { parse: [] }, "không xin ping role không ping được");
	});
});
