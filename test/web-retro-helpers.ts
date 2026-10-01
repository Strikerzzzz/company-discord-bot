// Phần dựng dùng chung cho test trang Retro của web quản trị (Phase 19, DEC-041/DEC-049): tạo phiên và phiếu bằng service thật,
// gọi trang, đọc flash sau khi chuyển hướng.
import assert from "node:assert/strict";
import type { CreateRetroInput, RetroAnswersInput, RetroSession } from "../src/modules/retro/types";
import type { WebResponse } from "../src/web/http";
import { DUPLICATE_POST_WINDOW_MS } from "../src/web/server";
import { GUILD } from "./helpers";
import { ADMIN_USER, BOT_ID, call, CHANNEL_CHAT, LoggedIn, WebHarness, withCsrf } from "./web-helpers";

export function pageUrl(path: string): string
{
	return `/g/${GUILD}${path}`;
}

export async function getPage(harness: WebHarness, auth: LoggedIn, path: string): Promise<string>
{
	const response = await call(harness, pageUrl(path), { cookies: auth.cookies });
	assert.equal(response.status, 200, `GET ${path}: ${response.body.slice(0, 300)}`);
	return response.body;
}

/**
 * POST form (kèm CSRF) tới trang của guild. Đẩy đồng hồ qua khoảng chống gửi trùng trước mỗi lần gửi, để hai lần gửi cùng nội dung
 * trong một test đều chạy thật.
 */
export function post(harness: WebHarness, auth: LoggedIn, path: string, form: Record<string, string | string[]> = {}): Promise<WebResponse>
{
	harness.clock.advance(DUPLICATE_POST_WINDOW_MS + 1);
	return call(harness, pageUrl(path), { cookies: auth.cookies, form: withCsrf(auth, form) });
}

/** Loại và chữ (HTML) của flash ở trang mà response chuyển hướng tới, cùng nơi chuyển tới. */
export async function flashAfter(harness: WebHarness, auth: LoggedIn, response: WebResponse): Promise<{ kind: string; text: string; location: string; body: string }>
{
	assert.equal(response.status, 303, response.body.slice(0, 300));
	const location = response.headers.Location ?? "";
	const page = await call(harness, location, { cookies: auth.cookies });
	assert.equal(page.status, 200, location);
	const match = /<div class="flash (ok|error)">(.*?)<\/div>/su.exec(page.body);
	assert.ok(match, `không có flash ở ${location}`);
	return { kind: match[1] ?? "", text: match[2] ?? "", location, body: page.body };
}

/**
 * Tạo phiên bằng service (như lệnh /retro create của admin, kể cả đã đăng tin có nút điền), mặc định ở CHANNEL_CHAT, không link, không
 * team, không hạn.
 */
export function createSession(harness: WebHarness, overrides: Partial<CreateRetroInput> = {}): RetroSession
{
	const created = harness.services.retro.create({
		guildId: GUILD,
		channelId: CHANNEL_CHAT,
		title: "Retrospective PMS Sprint 24",
		docUrl: null,
		teamRoleId: null,
		durationHours: null,
		createdBy: ADMIN_USER,
		...overrides,
	});
	harness.services.retro.attachMessage(GUILD, created.id, String(690000000000000000n + BigInt(created.id)));
	harness.clock.advance(1000);
	const session = harness.services.retro.get(GUILD, created.id);
	assert.ok(session);
	return session;
}

/** Đóng phiên bằng service (như /retro close, không đăng gì lên Discord). */
export function closeSession(harness: WebHarness, sessionId: number): RetroSession
{
	return harness.services.retro.close(GUILD, sessionId, ADMIN_USER);
}

/** Một người điền phiếu (ô không nêu là trống). */
export function fill(harness: WebHarness, sessionId: number, userId: string, answers: Partial<RetroAnswersInput>, roleIds: string[] = []): void
{
	harness.services.retro.submit({
		guildId: GUILD,
		sessionId,
		userId,
		roleIds,
		answers: { learned: "", improve: "", ideas: "", kudos: "", sprintName: "", ...answers },
		systemActorId: BOT_ID,
	});
	harness.clock.advance(1000);
}

/** Phần HTML từ tiêu đề `heading` tới hết thẻ section chứa nó (rỗng nếu không có). */
export function sectionOf(body: string, heading: string): string
{
	const at = body.indexOf(heading);
	if (at < 0) return "";
	const start = body.lastIndexOf("<section", at);
	const end = body.indexOf("</section>", at);
	return body.slice(start, end < 0 ? undefined : end);
}

/** Giá trị các input ẩn của form xoá ý chứa chữ `text` (HTML đã escape) trong trang chi tiết. */
export function ideaForm(body: string, text: string): Record<string, string>
{
	const at = body.indexOf(`<span class="rt-idea">${text}</span>`);
	assert.ok(at >= 0, `không thấy ý "${text}"`);
	const formEnd = body.indexOf("</form>", at);
	const chunk = body.slice(at, formEnd);
	const value = (name: string): string =>
	{
		const match = new RegExp(`name="${name}" value="([^"]*)"`, "u").exec(chunk);
		assert.ok(match, `không có input ${name}`);
		return match[1] ?? "";
	};
	return { id: value("id"), muc: value("muc"), o: value("o"), kt: value("kt") };
}
