// Trang "Retro" của web quản trị (DEC-041, DEC-049):
// - danh sách phiên có lọc trạng thái và phân trang;
// - tạo phiên: bot đăng tin có nút "📝 Điền retro" vào kênh/thread đã chọn, cùng quy tắc với `/retro create` (createRetroSession);
// - chi tiết phiên: ai đã điền (chỉ tên, không gắn với nội dung), nội dung ẩn danh gom 5 cột, vote tên sprint, xuất chữ để dán vào
//   Confluence (đúng khu vực bot sẽ ghi), và mọi thao tác như `/retro close|reopen|extend|remind|vote|pick|write`, cộng phần chỉ có
//   trên web: xoá một ý, xoá nội dung phiên.
// Quy tắc nằm ở RetroService và src/discord/retroOps.ts (dùng chung với lệnh); mọi thao tác ghi audit với người đăng nhập.
// Riêng tư: phiên nằm trong kênh/thread người đăng nhập không xem được thì giấu tiêu đề, tên kênh, link tài liệu, nội dung và tên
// sprint, nhưng vẫn quản lý được như lệnh /retro của admin. Form xoá ý không mang mã phiếu (chỉ vị trí trong danh sách ẩn danh và dấu
// của chữ), để không dò được thứ tự gửi, tức không ghép được người với nội dung. Cài đặt retro nằm ở retroSettings.ts.
import { createHash } from "node:crypto";
import { ChannelType, GuildBasedChannel } from "discord.js";
import { channelMention, formatNumber } from "../../discord/format";
import { MemberDisplay } from "../../discord/memberDirectory";
import {
	canPostInChannel,
	closeRetroSession,
	createRetroSession,
	extendRetroSession,
	isRetroChannel,
	pickRetroName,
	remindRetro,
	reopenRetroSession,
	resolveRetroChannel,
	RetroContext,
	retroDocReportLine,
	retroDocSection,
	SESSION_NOT_POSTED,
	startRetroVote,
	writeRetroDoc,
} from "../../discord/retroOps";
import { retroDocStatusLine, retroStatusLabel } from "../../discord/views/retro";
import { buildRetroSection, RetroDocSection } from "../../integrations/confluence";
import { Poll } from "../../modules/poll/types";
import { RETRO_NO_SPRINT_NAME } from "../../modules/retro/RetroService";
import {
	AnonymousRetroEntry,
	isRetroField,
	RETRO_FIELD_TITLES,
	RETRO_FIELDS,
	RETRO_LIMITS,
	RetroField,
	RetroListQuery,
	RetroSession,
	SprintNameCandidate,
} from "../../modules/retro/types";
import { UserError } from "../../shared/errors";
import { canViewItemChannel, hiddenChannelIds } from "../discord";
import { channelLabel, discordText, PRIVATE_CHANNEL_LABEL, roleChip, roleLabel } from "../format";
import { html, RawHtml } from "../html";
import { WebResponse } from "../http";
import { csrfField, guildUrl, redirectWithFlash, renderPage } from "../layout";
import { GuildPageContext, PageModule } from "../types";
import {
	bulkChecked,
	bulkSelection,
	formatDateTime,
	HIDDEN_ITEM_TEXT,
	isSnowflake,
	memberLink,
	metaList,
	pager,
	parsePositiveId,
	queryPage,
	selectAllLinks,
} from "../widgets";
import { RETRO_SETTINGS_PATH } from "./retroSettings";

const PATH = "/retro";
const NEW_PATH = `${PATH}/new`;
const VIEW_PATH = `${PATH}/view`;
const CLOSE_PATH = `${PATH}/close`;
const REOPEN_PATH = `${PATH}/reopen`;
const EXTEND_PATH = `${PATH}/extend`;
const REMIND_PATH = `${PATH}/remind`;
const WRITE_PATH = `${PATH}/write`;
const VOTE_PATH = `${PATH}/vote`;
const PICK_PATH = `${PATH}/pick`;
const IDEA_DELETE_PATH = `${PATH}/idea-delete`;
const CONTENT_DELETE_PATH = `${PATH}/content-delete`;

/** Số phiên mỗi trang. */
export const RETRO_PAGE_SIZE = 20;
const STATUS_PARAM = "tt";
const ID_FIELD = "id";
const CONFIRM_FIELD = "xac-nhan";
const HOURS_FIELD = "han-gio";
const NAME_FIELD = "ten";
const ALL_NAMES_FIELD = "tat-ca";
const CHANNEL_FIELD = "kenh";
const TITLE_FIELD = "tieu-de";
const LINK_FIELD = "link";
const TEAM_FIELD = "team";
const IDEA_INDEX_FIELD = "muc";
const IDEA_FIELD_FIELD = "o";
const IDEA_DIGEST_FIELD = "kt";
const CONTENT_WORD_FIELD = "chu-xac-nhan";
/** Chữ phải gõ để xoá nội dung một phiên (thao tác phá huỷ, DEC-041). */
export const CONTENT_DELETE_WORD = "XOA";
const IDEA_DIGEST_LENGTH = 16;
const HOURS_TEXT = /^\d{1,6}$/u;
const INDEX_TEXT = /^\d{1,6}$/u;
const DIGEST_TEXT = /^[0-9a-f]{16}$/u;

export const INVALID_RETRO_ID = "Mã phiên retro không hợp lệ.";
export const CONFIRM_REQUIRED = "Hãy tick ô xác nhận trước khi thực hiện.";
export const CONTENT_DELETE_CONFIRM = `Để xoá nội dung phiên, hãy tick ô xác nhận và gõ chính xác: ${CONTENT_DELETE_WORD}`;
export const IDEA_STALE = "Ý này đã thay đổi hoặc đã bị xoá. Hãy tải lại trang rồi thử lại.";
export const SECRET_SESSION_NOTE = "🔒 Phiên này nằm trong kênh hoặc thread bạn không xem được trên Discord: trang giấu tiêu đề, tên kênh, link tài liệu, "
	+ "nội dung và tên sprint. Bạn vẫn đóng, mở lại, gia hạn, nhắc, ghi Confluence và xoá nội dung được như lệnh /retro.";
export const SECRET_CONTENT_DENIED = "Phiên này nằm trong kênh hoặc thread bạn không xem được trên Discord, nên trang không cho làm thao tác cần thấy "
	+ "nội dung hay tên sprint. Người quản lý trong kênh dùng lệnh /retro vote (option rut-gon) hoặc /retro pick.";
export const CHOOSE_CHANNEL = "Hãy chọn kênh hoặc thread để đăng phiên retro.";
export const CHANNEL_NOT_FOUND = "Không tìm thấy kênh này, hoặc bạn không xem được kênh này trên Discord.";
export const INVALID_TEAM = "Team không hợp lệ. Hãy tải lại trang rồi chọn lại.";
export const NO_NAMES_PICKED = `Hãy tick các tên đưa vào vote (từ 2 đến ${RETRO_LIMITS.voteOptionsMax} tên).`;
export const NAME_REQUIRED = "Hãy chọn một tên sprint.";
export const HOURS_INVALID = `Hạn phải là số giờ nguyên từ ${RETRO_LIMITS.durationHoursMin} đến ${RETRO_LIMITS.durationHoursMax} `
	+ `(${RETRO_LIMITS.durationHoursMax / 24} ngày).`;

type StatusTab = RetroListQuery["status"];

const TABS: readonly { value: StatusTab; label: string }[] = [
	{ value: "all", label: "Tất cả" },
	{ value: "open", label: "🟢 Đang mở" },
	{ value: "closed", label: "🔒 Đã đóng" },
	{ value: "voting", label: "🗳️ Đang vote" },
	{ value: "done", label: "✅ Hoàn tất" },
];

const NONE = html`<span class="muted">—</span>`;

// ---------- Phần chung ----------

function retroContextOf(ctx: GuildPageContext): RetroContext
{
	return { client: ctx.deps.client, services: ctx.deps.services, actions: ctx.deps.retroActions };
}

function viewPath(sessionId: number): string
{
	return `${VIEW_PATH}?id=${sessionId}`;
}

function requireRetroId(raw: string | null | undefined): number
{
	const id = parsePositiveId(raw);
	if (id === null) throw new UserError(INVALID_RETRO_ID);
	return id;
}

function requireSession(ctx: GuildPageContext, sessionId: number): RetroSession
{
	const session = ctx.deps.services.retro.get(ctx.guild.id, sessionId);
	if (!session) throw new UserError(`Không tìm thấy phiên retro #${sessionId}.`);
	return session;
}

/** Người đăng nhập KHÔNG xem được kênh/thread của phiên (cùng quy tắc canViewItemChannel của trang Vote, Contribution). */
async function isSecret(ctx: GuildPageContext, session: RetroSession): Promise<boolean>
{
	return !(await canViewItemChannel(ctx.deps.client, ctx.guild, session.channelId, ctx.member));
}

function formOf(ctx: GuildPageContext): URLSearchParams
{
	return ctx.req.form ?? new URLSearchParams();
}

function requireConfirm(form: URLSearchParams): void
{
	if (form.get(CONFIRM_FIELD) !== "1") throw new UserError(CONFIRM_REQUIRED);
}

/** Số giờ (tuỳ chọn) từ ô nhập: rỗng thì null; chỉ nhận chữ số, khoảng hợp lệ do RetroService kiểm tra. */
function parseHours(raw: string | null): number | null
{
	const text = raw?.trim() ?? "";
	if (text === "") return null;
	if (!HOURS_TEXT.test(text)) throw new UserError(HOURS_INVALID);
	return Number(text);
}

/** Như parseHours nhưng bắt buộc nhập. */
function requireHours(raw: string | null): number
{
	const hours = parseHours(raw);
	if (hours === null) throw new UserError(HOURS_INVALID);
	return hours;
}

/** Tên kênh/thread của phiên; người đăng nhập không xem được thì PRIVATE_CHANNEL_LABEL (kể cả thread riêng tư mà họ chỉ xem được kênh cha). */
function sessionChannelLabel(ctx: GuildPageContext, session: RetroSession, secret: boolean): string
{
	return secret ? PRIVATE_CHANNEL_LABEL : channelLabel(ctx.guild, session.channelId, ctx.member);
}

/** Vote tên sprint của phiên (null nếu chưa có hoặc không còn). */
function sessionPoll(ctx: GuildPageContext, session: RetroSession): Poll | null
{
	return session.pollId === null ? null : ctx.deps.services.polls.get(ctx.guild.id, session.pollId);
}

/** Trạng thái phiên bằng chữ (cùng nhãn với tin của phiên trên Discord); phiên bí mật thì không nêu tên sprint. */
function statusHtml(ctx: GuildPageContext, session: RetroSession, secret: boolean): RawHtml
{
	const shown = secret ? { ...session, winnerName: null } : session;
	const pollOpen = sessionPoll(ctx, session)?.closedAt === null;
	return discordText(ctx.guild, retroStatusLabel(shown, pollOpen), ctx.member);
}

/** Hạn của phiên đang mở, hoặc lúc đóng. */
function deadlineText(session: RetroSession): string
{
	if (session.status === "open") return session.closesAt === null ? "Không tự đóng" : formatDateTime(session.closesAt);
	return session.closedAt === null ? "—" : `Đóng ${formatDateTime(session.closedAt)}`;
}

/** Tình trạng Confluence ngắn gọn cho danh sách. */
function docBadge(session: RetroSession, docEnabled: boolean): RawHtml
{
	if (session.docUrl === null) return NONE;
	if (!docEnabled) return html`<span class="badge">chỉ lưu link</span>`;
	if (session.confluenceError !== null) return html`<span class="badge off">lỗi</span>`;
	return session.confluenceWrittenAt === null ? html`<span class="badge">chưa ghi</span>` : html`<span class="badge ok">đã ghi</span>`;
}

function teamHtml(ctx: GuildPageContext, session: RetroSession): RawHtml
{
	return session.teamRoleId === null ? NONE : roleChip(ctx.guild, session.teamRoleId);
}

// ---------- Danh sách ----------

function statusTab(query: URLSearchParams): StatusTab
{
	const text = query.get(STATUS_PARAM);
	return TABS.find(tab => tab.value === text)?.value ?? "all";
}

function listRow(ctx: GuildPageContext, session: RetroSession, secret: boolean, docEnabled: boolean): RawHtml
{
	const winner = session.winnerName === null ? NONE : secret ? html`<span class="muted">🔒</span>` : html`${session.winnerName}`;
	return html`<tr>
<td><a href="${guildUrl(ctx, viewPath(session.id))}">#${session.id}</a></td>
<td class="rt-title">${secret ? html`<span class="muted">${HIDDEN_ITEM_TEXT}</span>` : session.title}</td>
<td>${sessionChannelLabel(ctx, session, secret)}</td>
<td>${teamHtml(ctx, session)}</td>
<td>${statusHtml(ctx, session, secret)}</td>
<td class="num">${formatNumber(session.participants)}</td>
<td class="rt-time">${deadlineText(session)}</td>
<td class="rt-title">${winner}</td>
<td>${docBadge(session, docEnabled)}</td>
</tr>`;
}

async function renderList(ctx: GuildPageContext): Promise<WebResponse>
{
	const { query } = ctx.req;
	const { client, services, retroActions } = ctx.deps;
	const status = statusTab(query);
	const result = services.retro.listPage(ctx.guild.id, { status, page: queryPage(query), pageSize: RETRO_PAGE_SIZE });
	const hidden = await hiddenChannelIds(client, ctx.guild, result.items.map(session => session.channelId), ctx.member);
	const docEnabled = retroActions.docWriter !== null;

	const tabs = html`<nav class="tabs">${TABS.map(tab =>
	{
		const href = guildUrl(ctx, tab.value === "all" ? PATH : `${PATH}?${STATUS_PARAM}=${tab.value}`);
		return html`<a href="${href}"${tab.value === status ? html` class="active"` : ""}>${tab.label}</a>`;
	})}</nav>`;
	let table: RawHtml;
	if (result.items.length > 0)
	{
		table = html`<table class="table">
<thead><tr><th>Mã</th><th>Tiêu đề</th><th>Kênh / thread</th><th>Team</th><th>Trạng thái</th><th class="num">Đã điền</th><th>Hạn / đóng lúc</th><th>Tên sprint</th><th>Confluence</th></tr></thead>
<tbody>${result.items.map(session => listRow(ctx, session, hidden.has(session.channelId), docEnabled))}</tbody>
</table>`;
	}
	else
	{
		table = html`<p class="muted">${status === "all" ? "Chưa có phiên retro nào. Bấm “Tạo phiên retro”, hoặc dùng lệnh /retro create trong kênh hay thread của team." : "Không có phiên nào ở mục này."}</p>`;
	}

	return renderPage(ctx, {
		nav: "retro",
		title: "Retro",
		lead: "Các phiên retro sprint theo team. Câu trả lời ẩn danh: bảng trên Discord và Confluence không có tên người viết.",
		body: html`<div class="actions rt-top"><a class="btn btn-primary" href="${guildUrl(ctx, NEW_PATH)}">➕ Tạo phiên retro</a>
<a class="btn" href="${guildUrl(ctx, RETRO_SETTINGS_PATH)}">⚙️ Cài đặt retro</a></div>
<section class="card">${tabs}<p class="rt-summary">${formatNumber(result.total)} phiên.</p>
${table}${pager(ctx, PATH, { [STATUS_PARAM]: status === "all" ? "" : status }, result.page, result.totalPages)}</section>`,
	});
}

// ---------- Tạo phiên ----------

interface ChannelOption
{
	id: string;
	label: string;
}

function rawPosition(channel: GuildBasedChannel): number
{
	return "rawPosition" in channel ? channel.rawPosition : 0;
}

/** Khoá sắp xếp: kênh theo vị trí trong server, thread nằm ngay sau kênh cha (theo tên). */
function channelSortKey(ctx: GuildPageContext, channel: GuildBasedChannel): [number, string, number, string]
{
	if (!channel.isThread()) return [rawPosition(channel), channel.id, 0, channel.name];
	const parent = channel.parentId === null ? undefined : ctx.guild.channels.cache.get(channel.parentId);
	return [parent ? rawPosition(parent) : Number.MAX_SAFE_INTEGER, channel.parentId ?? "", 1, channel.name];
}

function compareKeys(a: [number, string, number, string], b: [number, string, number, string]): number
{
	return a[0] - b[0] || a[1].localeCompare(b[1]) || a[2] - b[2] || a[3].localeCompare(b[3], "vi");
}

function channelOptionLabel(ctx: GuildPageContext, channel: GuildBasedChannel): string
{
	if (!channel.isThread()) return channelLabel(ctx.guild, channel.id, ctx.member);
	const parent = channel.parentId === null ? "" : `${channelLabel(ctx.guild, channel.parentId, ctx.member)} › `;
	return `${parent}🧵 ${channel.name}${channel.type === ChannelType.PrivateThread ? " (thread riêng tư)" : ""}`;
}

/**
 * Kênh chọn được để tạo phiên (từ cache của server): kênh văn bản, kênh thông báo, thread đang hoạt động mà người đăng nhập xem và
 * gửi tin được (thread riêng tư: phải là thành viên thread hoặc có Manage Threads), và bot gửi tin được. Bước lưu kiểm tra lại.
 */
async function channelOptions(ctx: GuildPageContext): Promise<ChannelOption[]>
{
	const { guild, member } = ctx;
	const me = guild.members.me;
	if (!me) return [];
	const candidates = [...guild.channels.cache.values()].filter(channel => isRetroChannel(channel) && canPostInChannel(channel, member) && canPostInChannel(channel, me));
	const hidden = await hiddenChannelIds(ctx.deps.client, guild, candidates.map(channel => channel.id), member);
	return candidates
		.filter(channel => !hidden.has(channel.id))
		.map(channel => ({ channel, key: channelSortKey(ctx, channel) }))
		.sort((a, b) => compareKeys(a.key, b.key))
		.map(({ channel }) => ({ id: channel.id, label: channelOptionLabel(ctx, channel) }));
}

async function renderNew(ctx: GuildPageContext): Promise<WebResponse>
{
	const options = await channelOptions(ctx);
	const teams = ctx.deps.services.teams.list(ctx.guild.id);
	const { titleMin, titleMax, docUrlMax, durationHoursMin, durationHoursMax } = RETRO_LIMITS;
	const channelField = options.length === 0
		? html`<div class="warn-box">Không có kênh nào chọn được: cần kênh văn bản, kênh thông báo hoặc thread đang hoạt động mà bạn xem và gửi tin được, và bot cũng gửi tin được.</div>`
		: html`<select id="rt-channel" name="${CHANNEL_FIELD}" required><option value="">— Chọn kênh hoặc thread —</option>
${options.map(option => html`<option value="${option.id}">${option.label}</option>`)}</select>`;
	const form = html`<form method="post" action="${guildUrl(ctx, NEW_PATH)}" class="rt-form">${csrfField(ctx)}
<div class="field"><label for="rt-channel">Kênh hoặc thread của team</label>
${channelField}
<span class="hint">Bot đăng tin có nút “📝 Điền retro” vào đây; số người đã điền, bảng tổng hợp và vote tên sprint cũng diễn ra ở đây. Mỗi kênh chỉ có một phiên đang mở.
Chỉ có kênh văn bản, kênh thông báo và thread đang hoạt động mà bạn xem và gửi tin được, và bot gửi tin được.</span></div>
<div class="field"><label for="rt-title-input">Tên phiên</label>
<input type="text" id="rt-title-input" name="${TITLE_FIELD}" required minlength="${titleMin}" maxlength="${titleMax}" placeholder="Retrospective PMS Sprint 24">
<span class="hint">Từ ${titleMin} đến ${titleMax} ký tự.</span></div>
<div class="field"><label for="rt-link">Link trang Confluence (tuỳ chọn)</label>
<input type="text" id="rt-link" name="${LINK_FIELD}" maxlength="${docUrlMax}" placeholder="https://…/pages/viewpage.action?pageId=…">
<span class="hint">Khi đóng phiên, bot ghi bảng ẩn danh vào cuối trang này (nếu đã bật ghi Confluence). Link phải có mã trang.</span></div>
<div class="field"><label for="rt-team">Team (tuỳ chọn)</label>
<select id="rt-team" name="${TEAM_FIELD}"><option value="">Không giới hạn: ai xem được kênh cũng điền được</option>
${teams.map(roleId => html`<option value="${roleId}">${roleLabel(ctx.guild, roleId)}</option>`)}</select>
<span class="hint">Chọn team thì chỉ người có role team đó điền được. Danh sách là các team đã cấu hình ở trang Team.</span></div>
<div class="field"><label for="rt-hours">Tự đóng sau (giờ, tuỳ chọn)</label>
<input type="number" id="rt-hours" name="${HOURS_FIELD}" min="${durationHoursMin}" max="${durationHoursMax}" step="1">
<span class="hint">Bỏ trống: người quản lý tự đóng. Từ ${durationHoursMin} đến ${durationHoursMax} giờ.</span></div>
<div class="actions"><button class="btn btn-primary" type="submit"${options.length === 0 ? html` disabled` : ""}>📝 Tạo phiên và đăng vào kênh</button></div>
</form>`;
	return renderPage(ctx, {
		nav: "retro",
		title: "Tạo phiên retro",
		lead: "Như lệnh /retro create gõ trong kênh hoặc thread của team: bot đăng tin có nút điền retro (form 5 ô ẩn danh) vào kênh bạn chọn.",
		body: html`<p><a href="${guildUrl(ctx, PATH)}">← Danh sách phiên retro</a></p><section class="card">${form}</section>`,
	});
}

async function createSession(ctx: GuildPageContext): Promise<WebResponse>
{
	const form = formOf(ctx);
	const { guild, member } = ctx;
	const { client } = ctx.deps;
	const channelId = (form.get(CHANNEL_FIELD) ?? "").trim();
	if (channelId === "") throw new UserError(CHOOSE_CHANNEL);
	if (!isSnowflake(channelId) || !guild.channels.cache.has(channelId) || !(await canViewItemChannel(client, guild, channelId, member)))
	{
		throw new UserError(CHANNEL_NOT_FOUND);
	}
	const channel = resolveRetroChannel(guild, channelId, member);
	const team = (form.get(TEAM_FIELD) ?? "").trim();
	if (team !== "" && !isSnowflake(team)) throw new UserError(INVALID_TEAM);
	const link = (form.get(LINK_FIELD) ?? "").trim();

	const retroCtx = retroContextOf(ctx);
	const { session, notes } = await createRetroSession(retroCtx, {
		guildId: guild.id,
		channelId: channel.id,
		title: form.get(TITLE_FIELD) ?? "",
		docUrl: link === "" ? null : link,
		teamRoleId: team === "" ? null : team,
		durationHours: parseHours(form.get(HOURS_FIELD)),
		createdBy: ctx.actorId,
	}, async payload =>
	{
		const posted = await retroCtx.actions.post(retroCtx.client, channel.id, payload);
		if (posted === null) throw new UserError(SESSION_NOT_POSTED);
		return posted.messageId;
	});
	const text = [`Đã tạo phiên retro #${session.id} và đăng tin có nút “📝 Điền retro” vào ${channelMention(session.channelId)}.`, ...notes];
	return redirectWithFlash(ctx, viewPath(session.id), "ok", text.join("\n"));
}

// ---------- Chi tiết ----------

function idField(session: RetroSession): RawHtml
{
	return html`<input type="hidden" name="${ID_FIELD}" value="${session.id}">`;
}

function infoCard(ctx: GuildPageContext, session: RetroSession, secret: boolean, poll: Poll | null, displays: ReadonlyMap<string, MemberDisplay>): RawHtml
{
	const docEnabled = ctx.deps.retroActions.docWriter !== null;
	let doc: RawHtml = NONE;
	if (session.docUrl !== null) doc = secret ? html`<span class="muted">🔒</span>` : html`<a href="${session.docUrl}" rel="noopener noreferrer" target="_blank">${session.docUrl}</a>`;
	const pollLink = poll === null ? null : html`<a href="${guildUrl(ctx, `/polls/view?id=${poll.id}`)}">Vote #${poll.id}</a> ${poll.closedAt === null ? html`<span class="badge ok">đang mở</span>` : html`<span class="badge">đã đóng</span>`}`;
	const meta = metaList("rt-meta", [
		["Trạng thái", statusHtml(ctx, session, secret)],
		["Kênh / thread", sessionChannelLabel(ctx, session, secret)],
		["Team", session.teamRoleId === null ? "Không giới hạn: ai xem được kênh cũng điền được" : roleChip(ctx.guild, session.teamRoleId)],
		session.status === "open" ? ["Hạn", session.closesAt === null ? "Không tự đóng: người quản lý đóng" : formatDateTime(session.closesAt)] : null,
		session.closedAt === null ? null : ["Đóng lúc", formatDateTime(session.closedAt)],
		["Đã điền", `${formatNumber(session.participants)} người`],
		["Người tạo", memberLink(ctx, session.createdBy, displays.get(session.createdBy))],
		["Tạo lúc", formatDateTime(session.createdAt)],
		["Tài liệu", doc],
		["Confluence", discordText(ctx.guild, retroDocStatusLine(session, docEnabled), ctx.member)],
		pollLink === null ? null : ["Vote tên sprint", pollLink],
		session.winnerName === null ? null : ["Tên sprint", secret ? html`<span class="muted">🔒</span>` : html`🏆 <strong>${session.winnerName}</strong>`],
		session.contentDeletedAt === null ? null : ["Nội dung", `🗑️ Đã xoá lúc ${formatDateTime(session.contentDeletedAt)}`],
	]);
	return html`<section class="card"><h2 class="rt-title">${secret ? HIDDEN_ITEM_TEXT : `🔁 ${session.title}`}</h2>
${secret ? html`<div class="warn-box">${SECRET_SESSION_NOTE}</div>` : ""}
${meta}</section>`;
}

function postForm(ctx: GuildPageContext, action: string, session: RetroSession, inner: RawHtml): RawHtml
{
	return html`<form method="post" action="${guildUrl(ctx, action)}" class="rt-action">${csrfField(ctx)}${idField(session)}${inner}</form>`;
}

function hoursInput(id: string, required: boolean): RawHtml
{
	return html`<input type="number" id="${id}" name="${HOURS_FIELD}" min="${RETRO_LIMITS.durationHoursMin}" max="${RETRO_LIMITS.durationHoursMax}" step="1"${required ? html` required` : ""}>`;
}

/** Các thao tác quản lý hợp lệ với trạng thái hiện tại (RetroService vẫn kiểm tra lại khi lưu). */
function actionsCard(ctx: GuildPageContext, session: RetroSession): RawHtml
{
	const parts: RawHtml[] = [];
	if (session.status === "open")
	{
		parts.push(postForm(ctx, CLOSE_PATH, session, html`<h3>🔒 Đóng phiên</h3>
<p class="muted">Tắt nút điền, đăng bảng tổng hợp ẩn danh vào kênh của phiên và ghi Confluence (nếu có link), như <code>/retro close</code>.</p>
<label class="check"><input type="checkbox" name="${CONFIRM_FIELD}" value="1" required> Tôi muốn đóng phiên retro #${session.id}</label>
<div class="actions"><button class="btn btn-primary" type="submit">🔒 Đóng phiên</button></div>`));
		parts.push(postForm(ctx, EXTEND_PATH, session, html`<h3>⏰ Gia hạn</h3>
<div class="field"><label for="rt-extend">Tự đóng sau (giờ, tính từ bây giờ)</label>${hoursInput("rt-extend", true)}</div>
<div class="actions"><button class="btn" type="submit">⏰ Đặt hạn mới</button></div>`));
	}
	if (session.acceptingAnswers)
	{
		parts.push(postForm(ctx, REMIND_PATH, session, html`<h3>📣 Nhắc điền</h3>
<p class="muted">Bot nhắc trong kênh của phiên (ping role team nếu phiên có team); mỗi phiên nhắc tối đa một lần trong 10 phút.</p>
<div class="actions"><button class="btn" type="submit">📣 Nhắc điền retro</button></div>`));
	}
	if (session.status === "closed" && session.contentDeletedAt === null)
	{
		parts.push(postForm(ctx, REOPEN_PATH, session, html`<h3>🔓 Mở lại</h3>
<p class="muted">Mở lại phiên đã đóng (chưa tạo vote tên sprint) để mọi người điền hoặc sửa tiếp, như <code>/retro reopen</code>.</p>
<div class="field"><label for="rt-reopen">Tự đóng sau (giờ, tuỳ chọn)</label>${hoursInput("rt-reopen", false)}<span class="hint">Bỏ trống: không tự đóng.</span></div>
<div class="actions"><button class="btn" type="submit">🔓 Mở lại phiên</button></div>`));
	}
	parts.push(confluenceAction(ctx, session));
	return html`<section class="card"><h2>⚙️ Quản lý phiên</h2><div class="rt-actions">${parts}</div></section>`;
}

function confluenceAction(ctx: GuildPageContext, session: RetroSession): RawHtml
{
	const head = html`<h3>📄 Confluence</h3>`;
	if (session.contentDeletedAt !== null) return html`<div class="rt-action">${head}<p class="muted">Nội dung phiên đã bị xoá nên không ghi Confluence nữa.</p></div>`;
	if (session.docUrl === null)
	{
		return html`<div class="rt-action">${head}<p class="muted">Phiên chưa gắn link tài liệu nên bot không ghi Confluence. Vẫn dán tay được bằng phần “Xuất chữ để dán vào Confluence”.</p></div>`;
	}
	if (ctx.deps.retroActions.docWriter === null)
	{
		return html`<div class="rt-action">${head}<p class="muted">Bot chưa bật ghi Confluence (CONFLUENCE_BASE_URL, CONFLUENCE_TOKEN), nên chỉ lưu link.
Hãy dùng phần “Xuất chữ để dán vào Confluence” bên dưới để dán tay.</p></div>`;
	}
	return postForm(ctx, WRITE_PATH, session, html`${head}
<p class="muted">Ghi (hoặc ghi lại) bảng ẩn danh vào cuối trang đã gắn, như <code>/retro write</code>. Ghi nhiều lần không nhân đôi bảng.</p>
<div class="actions"><button class="btn" type="submit">📄 Ghi lại vào Confluence</button></div>`);
}

function participantsCard(ctx: GuildPageContext, participants: readonly string[], displays: ReadonlyMap<string, MemberDisplay>): RawHtml
{
	const list = participants.length === 0
		? html`<p class="muted">Chưa có ai điền.</p>`
		: html`<ul class="rt-people">${participants.map(userId => html`<li>${memberLink(ctx, userId, displays.get(userId))}</li>`)}</ul>`;
	return html`<section class="card"><h2>✍️ Ai đã điền (${formatNumber(participants.length)})</h2>
<p class="muted rt-hint">Chỉ admin bot thấy danh sách này (DEC-049), xếp theo ID, không theo thứ tự gửi. Nội dung bên dưới ẩn danh và không gắn với tên;
bảng trên Discord và Confluence không có tên người viết.</p>
${list}</section>`;
}

/** Dấu của chữ một ý, để form xoá ý nhận ra đúng ý mà không mang mã phiếu. */
function ideaDigest(text: string): string
{
	return createHash("sha256").update(text).digest("hex").slice(0, IDEA_DIGEST_LENGTH);
}

function ideaItem(ctx: GuildPageContext, session: RetroSession, index: number, field: RetroField, text: string): RawHtml
{
	return html`<li><span class="rt-idea">${text}</span>
<details class="rt-delete"><summary>🗑️ Xoá</summary>${postForm(ctx, IDEA_DELETE_PATH, session, html`<input type="hidden" name="${IDEA_INDEX_FIELD}" value="${index}">
<input type="hidden" name="${IDEA_FIELD_FIELD}" value="${field}"><input type="hidden" name="${IDEA_DIGEST_FIELD}" value="${ideaDigest(text)}">
<label class="check"><input type="checkbox" name="${CONFIRM_FIELD}" value="1" required> Xoá ý không phù hợp này (không khôi phục được)</label>
<button class="btn btn-danger rt-small" type="submit">Xoá ý</button>`)}</details></li>`;
}

function contentCard(ctx: GuildPageContext, session: RetroSession, entries: readonly AnonymousRetroEntry[]): RawHtml
{
	const head = html`<h2>📋 Nội dung ẩn danh</h2>`;
	if (session.contentDeletedAt !== null) return html`<section class="card">${head}<p class="muted">🗑️ Nội dung đã bị xoá lúc ${formatDateTime(session.contentDeletedAt)}.</p></section>`;
	if (entries.length === 0) return html`<section class="card">${head}<p class="muted">Chưa có nội dung.</p></section>`;
	const columns = RETRO_FIELDS.map(field =>
	{
		const items = entries.flatMap((entry, index) =>
		{
			const text = entry[field];
			return text === null ? [] : [ideaItem(ctx, session, index, field, text)];
		});
		return html`<div class="rt-col"><h3>${RETRO_FIELD_TITLES[field]} (${formatNumber(items.length)})</h3>
${items.length === 0 ? html`<p class="muted">Trống.</p>` : html`<ul class="rt-ideas">${items}</ul>`}</div>`;
	});
	return html`<section class="card">${head}
<p class="muted rt-hint">Thứ tự trộn cố định, không theo thứ tự gửi. Cột “Đặt tên sprint” hiện mọi tên như đã gửi; phần vote bên dưới đã bỏ trùng.
Xoá một ý không sửa bảng tổng hợp đã đăng trong Discord; trang Confluence cập nhật khi bấm “Ghi lại vào Confluence”.</p>
<div class="rt-columns">${columns}</div></section>`;
}

function pickForm(ctx: GuildPageContext, session: RetroSession, names: readonly string[]): RawHtml
{
	return postForm(ctx, PICK_PATH, session, html`<div class="rt-names">${names.map((name, index) => html`<label class="check"><input type="radio" name="${NAME_FIELD}" value="${name}" required${index === 0 ? html` checked` : ""}> ${name}</label>`)}</div>
<label class="check"><input type="checkbox" name="${CONFIRM_FIELD}" value="1" required> Chốt tên này: không đổi lại được; bot công bố trong kênh, cộng XP cho người đề xuất và ghi Confluence</label>
<div class="actions"><button class="btn btn-primary" type="submit">🏆 Chốt tên sprint</button></div>`);
}

function candidateRow(candidate: SprintNameCandidate, index: number, checked: boolean): RawHtml
{
	const id = `rt-name-${index}`;
	return html`<tr><td><input type="checkbox" id="${id}" name="${NAME_FIELD}" value="${candidate.name}"${checked ? html` checked` : ""}></td>
<td class="rt-title"><label for="${id}">${candidate.name}</label></td>
<td class="num">${formatNumber(candidate.proposerIds.length)}</td></tr>`;
}

function voteForm(ctx: GuildPageContext, session: RetroSession, candidates: readonly SprintNameCandidate[]): RawHtml
{
	const max = RETRO_LIMITS.voteOptionsMax;
	const selection = bulkSelection(ctx.req.query);
	const tooMany = candidates.length > max;
	const voteMinutes = ctx.deps.services.retro.getConfig(ctx.guild.id).voteMinutes;
	return postForm(ctx, VOTE_PATH, session, html`${tooMany ? html`<div class="warn-box">Có ${formatNumber(candidates.length)} tên, nhiều hơn ${max} lựa chọn của một vote: hãy tick từ 2 đến ${max} tên cho danh sách rút gọn.</div>` : ""}
${selectAllLinks(ctx, viewPath(session.id), selection)}
<table class="table rt-candidates"><thead><tr><th>Đưa vào vote</th><th>Tên sprint</th><th class="num">Số người đề xuất</th></tr></thead>
<tbody>${candidates.map((candidate, index) => candidateRow(candidate, index, bulkChecked(selection, !tooMany)))}</tbody></table>
<p class="muted rt-hint">Mỗi người chọn 1 tên; vote tự đóng sau ${formatNumber(voteMinutes)} phút (trang Cài đặt retro). Vote xong bot tự chốt tên, cộng XP cho người đề xuất;
hoà thì quay lại đây để chọn tên cuối cùng.</p>
<div class="actions"><button class="btn btn-primary" type="submit">🗳️ Tạo vote tên sprint</button></div>`);
}

function candidateNames(candidates: readonly SprintNameCandidate[]): RawHtml
{
	return candidates.length === 0 ? html`<p class="muted">Chưa có tên nào được đề xuất.</p>` : html`<ul class="rt-ideas">${candidates.map(candidate => html`<li>${candidate.name}</li>`)}</ul>`;
}

/** Phần vote tên sprint theo trạng thái phiên. Phiên bí mật không hiện tên: chỉ tạo được vote với toàn bộ tên (không cần thấy tên). */
function voteCard(ctx: GuildPageContext, session: RetroSession, poll: Poll | null, secret: boolean): RawHtml
{
	const { retro } = ctx.deps.services;
	const head = html`<h2>🍀 Tên sprint và vote</h2>`;
	const candidates = retro.sprintNameCandidates(ctx.guild.id, session.id);
	const pickable = retro.pickableNames(ctx.guild.id, session.id);
	const secretNote = html`<p class="muted">${SECRET_CONTENT_DENIED}</p>`;
	let body: RawHtml;
	switch (session.status)
	{
	case "done":
		body = html`<p>🏆 Tên sprint được chọn: ${session.winnerName === null ? NONE : secret ? html`<span class="muted">🔒</span>` : html`<strong>${session.winnerName}</strong>`}</p>`;
		break;
	case "voting":
		if (pickable.length > 0)
		{
			body = html`<p>⚖️ Vote tên sprint hoà. Người quản lý chọn tên cuối cùng trong các tên hoà.</p>${secret ? secretNote : pickForm(ctx, session, pickable)}`;
		}
		else
		{
			const link = poll === null ? html`vote` : html`<a href="${guildUrl(ctx, `/polls/view?id=${poll.id}`)}">vote #${poll.id}</a>`;
			body = html`<p>🗳️ Đang có ${link}. Vote xong bot tự chốt tên, công bố trong kênh và cộng XP cho người đề xuất.</p>`;
		}
		break;
	case "open":
		body = html`<p class="muted">Phiên còn mở: đóng phiên rồi mới tạo vote tên sprint. Các tên đã được đề xuất (${formatNumber(candidates.length)}):</p>${secret ? "" : candidateNames(candidates)}`;
		break;
	case "closed":
		body = closedVoteBody(ctx, session, candidates, pickable, secret);
		break;
	}
	return html`<section class="card">${head}${body}</section>`;
}

/** Phần vote của phiên đã đóng, chưa có vote: chưa có tên, chốt tên duy nhất, hoặc tạo vote (phiên bí mật: chỉ với toàn bộ tên). */
function closedVoteBody(ctx: GuildPageContext, session: RetroSession, candidates: readonly SprintNameCandidate[], pickable: readonly string[], secret: boolean): RawHtml
{
	if (session.contentDeletedAt !== null) return html`<p class="muted">Nội dung phiên đã bị xoá: không còn tên để vote.</p>`;
	if (candidates.length === 0) return html`<p class="muted">${RETRO_NO_SPRINT_NAME}</p>`;
	if (pickable.length > 0)
	{
		return html`<p>Chỉ có một tên được đề xuất, không cần vote: chốt tên này.</p>${secret ? html`<p class="muted">${SECRET_CONTENT_DENIED}</p>` : pickForm(ctx, session, pickable)}`;
	}
	if (!secret) return voteForm(ctx, session, candidates);
	if (candidates.length > RETRO_LIMITS.voteOptionsMax) return html`<p class="muted">${SECRET_CONTENT_DENIED}</p>`;
	return postForm(ctx, VOTE_PATH, session, html`<input type="hidden" name="${ALL_NAMES_FIELD}" value="1">
<p>Có ${formatNumber(candidates.length)} tên được đề xuất.</p>
<div class="actions"><button class="btn btn-primary" type="submit">🗳️ Tạo vote với toàn bộ ${formatNumber(candidates.length)} tên</button></div>`);
}

/** Bảng xem trước khu vực bot ghi lên Confluence (cùng dữ liệu retroDocSection), để bôi đen rồi chép sang trình sửa của Confluence. */
function docPreview(section: RetroDocSection): RawHtml
{
	const rows = section.entries.length === 0
		? html`<tr><td colspan="${RETRO_FIELDS.length}"><em>Chưa có câu trả lời.</em></td></tr>`
		: section.entries.map(entry => html`<tr>${RETRO_FIELDS.map(field => html`<td class="rt-cell">${entry[field] ?? ""}</td>`)}</tr>`);
	return html`<div class="rt-preview"><h3>🤖 Retro từ Discord: ${section.title}</h3>
<table class="table rt-doc"><thead><tr>${RETRO_FIELDS.map(field => html`<th>${RETRO_FIELD_TITLES[field]}</th>`)}</tr></thead><tbody>${rows}</tbody></table>
${section.winnerName === null ? "" : html`<p>🏆 Tên sprint được chọn: <strong>${section.winnerName}</strong></p>`}</div>`;
}

function exportCard(ctx: GuildPageContext, session: RetroSession): RawHtml
{
	const head = html`<h2>📄 Xuất chữ để dán vào Confluence</h2>`;
	if (session.contentDeletedAt !== null) return html`<section class="card">${head}<p class="muted">Nội dung phiên đã bị xoá: không còn gì để xuất.</p></section>`;
	const section = retroDocSection(ctx.deps.services, session);
	return html`<section class="card">${head}
<p class="muted rt-hint">Phương án dự phòng khi bot chưa ghi được vào Confluence (chưa cấu hình, hoặc server chưa vào được Confluence). Đây đúng là khu vực bot sẽ ghi:
tiêu đề, bảng 5 cột ẩn danh (mỗi phiếu một dòng, không có tên người viết) và tên sprint đã chốt.</p>
<h3>Cách 1: chép bảng (dễ nhất)</h3>
<p class="rt-hint">Bôi đen từ tiêu đề tới hết bảng xem trước dưới đây, bấm Ctrl+C; mở trang Confluence ở chế độ sửa, đặt con trỏ ở cuối trang rồi bấm Ctrl+V:
Confluence giữ nguyên dạng bảng.</p>
${docPreview(section)}
<h3>Cách 2: dán mã nguồn (storage format)</h3>
<p class="rt-hint">Nếu Confluence của bạn có trình sửa mã nguồn trang (Source Editor, storage format), chép toàn bộ ô dưới đây và dán vào cuối mã nguồn.
Khu vực có dấu anchor của bot, nên khi bot ghi được Confluence, lần ghi sau thay đúng khu vực này thay vì thêm bảng mới.</p>
<textarea class="rt-export" readonly rows="10" spellcheck="false" aria-label="Mã nguồn khu vực retro (storage format)">${buildRetroSection(section)}</textarea>
<p class="muted rt-hint">Bảng chép theo cách 1 không có dấu anchor: nếu sau này bot ghi được Confluence, bot thêm khu vực riêng ở cuối trang; khi đó hãy xoá bảng đã dán tay để không bị trùng.</p>
</section>`;
}

function deleteContentCard(ctx: GuildPageContext, session: RetroSession): RawHtml
{
	if (session.contentDeletedAt !== null) return html``;
	const head = html`<h2>🗑️ Xoá nội dung phiên</h2>`;
	if (session.status === "open" || session.status === "voting")
	{
		return html`<section class="card danger-zone">${head}<p class="muted">Chỉ xoá được nội dung khi phiên đã đóng và không còn vote tên sprint đang chờ (hoặc chờ chọn tên khi hoà).</p></section>`;
	}
	return html`<section class="card danger-zone">${head}
<ul class="rt-list">
<li>Xoá hẳn chữ của mọi phiếu trong phiên (DEC-049): <strong>không khôi phục được</strong>, kể cả từ trang này.</li>
<li>Giữ thông tin phiên, danh sách người đã điền và XP đã cộng.</li>
<li>Không sửa bảng tổng hợp đã đăng trong Discord và bảng đã ghi trên Confluence: hãy tự xoá ở đó nếu cần.</li>
</ul>
${postForm(ctx, CONTENT_DELETE_PATH, session, html`<label class="check"><input type="checkbox" name="${CONFIRM_FIELD}" value="1" required> Tôi muốn xoá vĩnh viễn nội dung của phiên retro #${session.id}</label>
<div class="field"><label for="rt-word">Nhập ${CONTENT_DELETE_WORD} để xác nhận</label>
<input type="text" id="rt-word" name="${CONTENT_WORD_FIELD}" autocomplete="off" spellcheck="false" required>
<span class="hint">Gõ đúng <code>${CONTENT_DELETE_WORD}</code>: chữ hoa, không dấu.</span></div>
<div class="actions"><button class="btn btn-danger" type="submit">🗑️ Xoá nội dung phiên</button></div>`)}
</section>`;
}

async function renderDetail(ctx: GuildPageContext): Promise<WebResponse>
{
	const sessionId = requireRetroId(ctx.req.query.get(ID_FIELD));
	const session = requireSession(ctx, sessionId);
	const secret = await isSecret(ctx, session);
	const { client, services, adminActions } = ctx.deps;
	const participants = services.retro.participants(ctx.guild.id, sessionId);
	const displays = await adminActions.displays(client, ctx.guild, [...new Set([session.createdBy, ...participants])]);
	const poll = sessionPoll(ctx, session);
	const content = secret
		? html``
		: html`${contentCard(ctx, session, services.retro.anonymousEntries(ctx.guild.id, sessionId))}`;

	return renderPage(ctx, {
		nav: "retro",
		title: `Retro #${sessionId}`,
		body: html`<p><a href="${guildUrl(ctx, PATH)}">← Danh sách phiên retro</a></p>
${infoCard(ctx, session, secret, poll, displays)}
${actionsCard(ctx, session)}
${participantsCard(ctx, participants, displays)}
${content}
${voteCard(ctx, session, poll, secret)}
${secret ? "" : exportCard(ctx, session)}
${deleteContentCard(ctx, session)}`,
	});
}

// ---------- Thao tác ----------

function sessionIdOf(ctx: GuildPageContext): number
{
	return requireRetroId(formOf(ctx).get(ID_FIELD));
}

function flashBack(ctx: GuildPageContext, sessionId: number, text: string): WebResponse
{
	return redirectWithFlash(ctx, viewPath(sessionId), "ok", text);
}

async function closeSession(ctx: GuildPageContext): Promise<WebResponse>
{
	const sessionId = sessionIdOf(ctx);
	requireConfirm(formOf(ctx));
	return flashBack(ctx, sessionId, await closeRetroSession(retroContextOf(ctx), ctx.guild.id, sessionId, ctx.actorId));
}

async function reopenSession(ctx: GuildPageContext): Promise<WebResponse>
{
	const sessionId = sessionIdOf(ctx);
	const hours = parseHours(formOf(ctx).get(HOURS_FIELD));
	return flashBack(ctx, sessionId, await reopenRetroSession(retroContextOf(ctx), ctx.guild.id, sessionId, ctx.actorId, hours));
}

async function extendSession(ctx: GuildPageContext): Promise<WebResponse>
{
	const sessionId = sessionIdOf(ctx);
	const hours = requireHours(formOf(ctx).get(HOURS_FIELD));
	return flashBack(ctx, sessionId, await extendRetroSession(retroContextOf(ctx), ctx.guild.id, sessionId, ctx.actorId, hours));
}

async function remindSession(ctx: GuildPageContext): Promise<WebResponse>
{
	const sessionId = sessionIdOf(ctx);
	return flashBack(ctx, sessionId, await remindRetro(retroContextOf(ctx), ctx.guild.id, sessionId));
}

async function writeDoc(ctx: GuildPageContext): Promise<WebResponse>
{
	const sessionId = sessionIdOf(ctx);
	const report = await writeRetroDoc(retroContextOf(ctx), ctx.guild.id, sessionId);
	return redirectWithFlash(ctx, viewPath(sessionId), report.status === "failed" ? "error" : "ok", retroDocReportLine(report));
}

/** Phiên cho thao tác cần thấy nội dung hay tên sprint: không cho nếu người đăng nhập không xem được kênh của phiên. */
async function requireVisibleSession(ctx: GuildPageContext, sessionId: number): Promise<RetroSession>
{
	const session = requireSession(ctx, sessionId);
	if (await isSecret(ctx, session)) throw new UserError(SECRET_CONTENT_DENIED);
	return session;
}

async function deleteIdea(ctx: GuildPageContext): Promise<WebResponse>
{
	const form = formOf(ctx);
	const sessionId = sessionIdOf(ctx);
	requireConfirm(form);
	const indexText = form.get(IDEA_INDEX_FIELD) ?? "";
	const field = form.get(IDEA_FIELD_FIELD);
	const digest = form.get(IDEA_DIGEST_FIELD) ?? "";
	if (!INDEX_TEXT.test(indexText) || !isRetroField(field) || !DIGEST_TEXT.test(digest)) throw new UserError(IDEA_STALE);
	await requireVisibleSession(ctx, sessionId);

	const { retro } = ctx.deps.services;
	const entry = retro.anonymousEntries(ctx.guild.id, sessionId).at(Number(indexText));
	const text = entry?.[field] ?? null;
	if (!entry || text === null || ideaDigest(text) !== digest) throw new UserError(IDEA_STALE);
	retro.deleteIdea(ctx.guild.id, sessionId, entry.id, field, ctx.actorId);
	return flashBack(ctx, sessionId, `Đã xoá một ý ở cột “${RETRO_FIELD_TITLES[field]}” của phiên retro #${sessionId}. `
		+ "Bảng tổng hợp đã đăng trong Discord không đổi; trang Confluence cập nhật khi bấm “Ghi lại vào Confluence”.");
}

function deleteContent(ctx: GuildPageContext): WebResponse
{
	const form = formOf(ctx);
	const sessionId = sessionIdOf(ctx);
	if (form.get(CONFIRM_FIELD) !== "1" || (form.get(CONTENT_WORD_FIELD) ?? "").trim() !== CONTENT_DELETE_WORD) throw new UserError(CONTENT_DELETE_CONFIRM);
	ctx.deps.services.retro.deleteContent(ctx.guild.id, sessionId, ctx.actorId);
	return flashBack(ctx, sessionId, `Đã xoá hẳn nội dung của phiên retro #${sessionId}. Thông tin phiên, danh sách người đã điền và XP đã cộng vẫn giữ.`);
}

async function startVote(ctx: GuildPageContext): Promise<WebResponse>
{
	const form = formOf(ctx);
	const sessionId = sessionIdOf(ctx);
	let names: string[] | undefined;
	if (form.get(ALL_NAMES_FIELD) === "1")
	{
		requireSession(ctx, sessionId);
	}
	else
	{
		names = form.getAll(NAME_FIELD);
		if (names.length === 0) throw new UserError(NO_NAMES_PICKED);
		await requireVisibleSession(ctx, sessionId);
	}
	return flashBack(ctx, sessionId, await startRetroVote(retroContextOf(ctx), ctx.guild.id, sessionId, ctx.actorId, names));
}

async function pickName(ctx: GuildPageContext): Promise<WebResponse>
{
	const form = formOf(ctx);
	const sessionId = sessionIdOf(ctx);
	requireConfirm(form);
	const name = form.get(NAME_FIELD) ?? "";
	if (name.trim() === "") throw new UserError(NAME_REQUIRED);
	await requireVisibleSession(ctx, sessionId);
	return flashBack(ctx, sessionId, await pickRetroName(retroContextOf(ctx), ctx.guild.id, sessionId, name, ctx.actorId));
}

/** Lỗi của thao tác quay về trang chi tiết nếu phiên có thật; mã sai hoặc không có thì ném để server về danh sách. */
function detailErrorRedirect(ctx: GuildPageContext): string
{
	const sessionId = sessionIdOf(ctx);
	requireSession(ctx, sessionId);
	return viewPath(sessionId);
}

export const retroPage: PageModule = {
	routes: [
		{ method: "GET", path: PATH, handler: renderList },
		{ method: "GET", path: NEW_PATH, handler: renderNew },
		{ method: "POST", path: NEW_PATH, handler: createSession },
		{ method: "GET", path: VIEW_PATH, handler: renderDetail },
		{ method: "POST", path: CLOSE_PATH, handler: closeSession, errorRedirect: detailErrorRedirect },
		{ method: "POST", path: REOPEN_PATH, handler: reopenSession, errorRedirect: detailErrorRedirect },
		{ method: "POST", path: EXTEND_PATH, handler: extendSession, errorRedirect: detailErrorRedirect },
		{ method: "POST", path: REMIND_PATH, handler: remindSession, errorRedirect: detailErrorRedirect },
		{ method: "POST", path: WRITE_PATH, handler: writeDoc, errorRedirect: detailErrorRedirect },
		{ method: "POST", path: VOTE_PATH, handler: startVote, errorRedirect: detailErrorRedirect },
		{ method: "POST", path: PICK_PATH, handler: pickName, errorRedirect: detailErrorRedirect },
		{ method: "POST", path: IDEA_DELETE_PATH, handler: deleteIdea, errorRedirect: detailErrorRedirect },
		{ method: "POST", path: CONTENT_DELETE_PATH, handler: deleteContent, errorRedirect: detailErrorRedirect },
	],
	css: `
.rt-top { margin: 0 0 14px; }
.rt-summary { margin: 0 0 10px; color: var(--muted); }
.rt-title { overflow-wrap: anywhere; }
.rt-time { white-space: nowrap; }
.rt-hint { font-size: 13px; }
.rt-form .field { max-width: 560px; }
.rt-form select, .rt-form input[type=text] { width: 100%; }
.rt-meta { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 18px; margin: 12px 0 0; }
.rt-meta dt { color: var(--muted); font-weight: 600; }
.rt-meta dd { margin: 0; overflow-wrap: anywhere; }
.rt-actions { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
.rt-action { border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; margin: 0; }
.rt-action h3 { margin-top: 0; }
.rt-action .field { margin-bottom: 6px; }
.rt-people { margin: 0; padding-left: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 6px 18px; }
.rt-columns { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
.rt-col h3 { margin-top: 0; }
.rt-ideas { margin: 0; padding-left: 18px; }
.rt-ideas li { margin-bottom: 8px; }
.rt-idea { white-space: pre-line; overflow-wrap: anywhere; }
.rt-delete summary { cursor: pointer; color: var(--muted); font-size: 13px; }
.rt-delete .rt-action { border: 0; padding: 4px 0 0; }
.rt-small { padding: 4px 10px; font-size: 13px; }
.rt-names { display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px; }
.rt-candidates td label { cursor: pointer; }
.rt-preview { border: 1px dashed var(--line); border-radius: 8px; padding: 10px 14px; margin: 8px 0 14px; background: #fff; }
.rt-preview h3 { margin-top: 0; }
.rt-doc th, .rt-doc td { border: 1px solid var(--line); vertical-align: top; }
.rt-cell { white-space: pre-line; overflow-wrap: anywhere; }
.rt-export { max-width: 100%; font-family: Consolas, "Courier New", monospace; font-size: 12px; }
.rt-list { margin: 0 0 10px; padding-left: 20px; }
.rt-list li { margin-bottom: 4px; }
`,
};
