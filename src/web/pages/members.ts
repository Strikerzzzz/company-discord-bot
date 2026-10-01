// Trang "Thành viên" của web quản trị (DEC-041): tìm thành viên, danh sách theo XP hoặc contribution, hồ sơ một người (như
// `/admin xp view`) và cộng, trừ, reset điểm (như `/admin xp give|remove|reset` và `/admin contribution adjust|reset`). Mọi thao
// tác ghi đi qua src/discord/adminOps.ts nên cùng quy tắc với lệnh Discord, audit với người đăng nhập. Hồ sơ còn hiện bộ danh
// hiệu hiển thị của người đó (tự chọn bằng /rank-style hay theo server) và cho admin xoá lựa chọn đó (DEC-047).
import { GuildMember } from "discord.js";
import {
	AdjustTarget,
	adjustMemberContribution,
	adjustMemberXp,
	assertAdjustableUser,
	assertContributionDelta,
	assertXpAmount,
	BOT_TARGET,
	MAX_ADJUST,
	normalizeReason,
	REASON_MAX_LENGTH,
	RECENT_XP_EVENTS,
	resetMemberContribution,
	resetMemberXp,
	syncMemberTierRoles,
	USER_NOT_FOUND,
} from "../../discord/adminOps";
import { formatNumber, userMention } from "../../discord/format";
import { MemberDisplay, UNKNOWN_MEMBER_NAME } from "../../discord/memberDirectory";
import { rankText, signed, XP_SOURCE_LABELS } from "../../discord/views/admin";
import { tierDisplayLabel } from "../../discord/views/rank";
import { levelInfo } from "../../modules/activity/levels";
import { isTierSetKey, TIER_SETS, tierForLevel } from "../../modules/activity/tiers";
import { ActivityProfile, XpEventView } from "../../modules/activity/types";
import { Contribution, ContributionProfile } from "../../modules/contribution/types";
import { UserError } from "../../shared/errors";
import { logger } from "../../shared/logger";
import { hiddenChannelIds, lookupMember } from "../discord";
import { discordText } from "../format";
import { html, RawHtml } from "../html";
import { redirect, WebResponse } from "../http";
import { csrfField, guildUrl, redirectWithFlash, renderPage } from "../layout";
import { GuildPageContext, PageModule } from "../types";
import { formatDateTime, memberLink, memberUrl, pager, parseUserId, queryPage, requireUserId, userCell } from "../widgets";
import { contributionBadges } from "./contributions";

const PATH = "/members";
const VIEW_PATH = "/members/view";
const XP_PATH = "/members/xp";
const XP_RESET_PATH = "/members/xp-reset";
const CONTRIBUTION_PATH = "/members/contribution";
const CONTRIBUTION_RESET_PATH = "/members/contribution-reset";
const TIER_STYLE_CLEAR_PATH = "/members/tier-style-clear";
const SORT_PARAM = "xep";
const CONFIRM_FIELD = "xac-nhan";
const PAGE_SIZE = 25;
const SEARCH_LIMIT = 25;
const RECENT_CONTRIBUTIONS = 5;
/** Số ký tự tối đa của từ khoá tìm theo tên. */
export const SEARCH_MAX_LENGTH = 32;

export const SEARCH_TOO_LONG = `Từ khoá tìm theo tên tối đa ${SEARCH_MAX_LENGTH} ký tự. Hãy nhập ngắn hơn, hoặc dán ID thành viên.`;
export const SEARCH_UNAVAILABLE = "Không tìm được trên Discord lúc này (Discord đang lỗi hoặc mạng chậm). Hãy thử lại sau ít phút, hoặc dán ID thành viên.";
export const CONFIRM_REQUIRED = "Hãy tick ô xác nhận trước khi reset.";
export const INVALID_DIRECTION = "Hãy bấm nút Cộng XP hoặc Trừ XP.";
export const NO_TIER_CHOICE = "Không có gì thay đổi: người này chưa tự chọn bộ danh hiệu, vẫn đang hiển thị theo bộ của server.";
export const MEMBER_LEFT_NOTE = "Người này không còn trong server (hoặc bot không tìm thấy trên Discord). Vẫn xem và chỉnh điểm được như lệnh "
	+ "Discord: điểm mới không tính cho team nào và bot không đồng bộ role danh hiệu.";

type SortKey = "xp" | "contribution";

const SORT_TABS: readonly { key: SortKey; label: string }[] = [
	{ key: "xp", label: "⭐ Theo XP" },
	{ key: "contribution", label: "🤝 Theo contribution" },
];

function sortOf(query: URLSearchParams): SortKey
{
	return query.get(SORT_PARAM) === "contribution" ? "contribution" : "xp";
}

function viewPath(userId: string): string
{
	return `${VIEW_PATH}?u=${userId}`;
}

function stat(label: string, value: string): RawHtml
{
	return html`<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

// ---------- GET /members ----------

function searchForm(ctx: GuildPageContext, text: string): RawHtml
{
	return html`<section class="card"><form method="get" action="${guildUrl(ctx, PATH)}" class="filters">
<div class="field mb-search"><label for="mb-q">Tìm thành viên</label>
<input type="text" id="mb-q" name="q" value="${text}" placeholder="Tên, @mention hoặc ID"></div>
<button class="btn btn-primary" type="submit">🔍 Tìm</button>
</form>
<p class="muted mb-hint">Tên (username hoặc nickname) bắt đầu bằng chữ bạn nhập, tối đa ${SEARCH_MAX_LENGTH} ký tự; hoặc dán ID/mention để mở thẳng hồ sơ,
kể cả người đã rời server.</p></section>`;
}

/** Kết quả tìm theo tên qua Discord; lỗi của Discord hay từ khoá quá dài chỉ hiện cảnh báo, trang vẫn hiện. */
async function searchSection(ctx: GuildPageContext, text: string): Promise<RawHtml>
{
	const back = html`<p><a href="${guildUrl(ctx, PATH)}">← Về danh sách theo điểm</a></p>`;
	if (Array.from(text).length > SEARCH_MAX_LENGTH) return html`<section class="card"><div class="warn-box">${SEARCH_TOO_LONG}</div>${back}</section>`;

	let found: GuildMember[];
	try
	{
		found = await ctx.deps.adminActions.searchMembers(ctx.guild, text, SEARCH_LIMIT);
	}
	catch (error)
	{
		logger.warn(`Trang web: không tìm được thành viên trên Discord ở server "${ctx.guild.id}":`, error);
		return html`<section class="card"><div class="warn-box">${SEARCH_UNAVAILABLE}</div>${back}</section>`;
	}

	const rows = found.map(member =>
	{
		const display: MemberDisplay = { displayName: member.displayName, avatarUrl: null, inGuild: true };
		return html`<tr><td><a href="${memberUrl(ctx, member.id)}">${userCell(member.id, display)}</a> <span class="muted">@${member.user.username}</span></td>
<td>${member.user.bot ? html`<span class="badge">bot</span>` : ""}</td>
<td><a class="btn" href="${memberUrl(ctx, member.id)}">Xem hồ sơ</a></td></tr>`;
	});
	const table = found.length === 0
		? html`<p class="muted">Không có thành viên nào có tên bắt đầu bằng “${text}”. Người đã rời server không tìm theo tên được: hãy dán ID.</p>`
		: html`<table class="table"><thead><tr><th>Thành viên</th><th>Loại</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
	return html`<section class="card"><h2>Kết quả tìm “${text}” (${found.length})</h2>
${table}
${found.length >= SEARCH_LIMIT ? html`<p class="muted">Chỉ hiện ${SEARCH_LIMIT} người đầu tiên; hãy nhập tên đầy đủ hơn.</p>` : ""}
${back}</section>`;
}

/** Danh sách thành viên có điểm, theo XP hoặc contribution (bảng xếp hạng cá nhân, tổng từ trước tới nay). */
async function listSection(ctx: GuildPageContext): Promise<RawHtml>
{
	const { guild, deps } = ctx;
	const sort = sortOf(ctx.req.query);
	const board = deps.services.leaderboard.query({
		guildId: guild.id,
		kind: sort === "xp" ? "activity" : "contribution",
		scope: "individual",
		period: "all",
		page: queryPage(ctx.req.query),
		pageSize: PAGE_SIZE,
	});
	const displays = await deps.adminActions.displays(deps.client, guild, board.entries.map(entry => entry.id));
	const isXp = sort === "xp";

	const tabs = SORT_TABS.map(tab => html`<a href="${guildUrl(ctx, `${PATH}?${SORT_PARAM}=${tab.key}`)}"${tab.key === sort ? html` class="active"` : ""}>${tab.label}</a>`);
	const rows = board.entries.map(entry => html`<tr><td class="num">#${formatNumber(entry.rank)}</td>
<td>${memberLink(ctx, entry.id, displays.get(entry.id))}</td>
${isXp ? html`<td class="num">${formatNumber(levelInfo(entry.value).level)}</td>` : ""}
<td class="num">${formatNumber(entry.value)} ${isXp ? "XP" : "điểm"}</td></tr>`);
	const table = board.entries.length === 0
		? html`<p class="muted">${isXp ? "Chưa có ai có XP." : "Chưa có ai có điểm contribution."}</p>`
		: html`<table class="table"><thead><tr><th class="num">Hạng</th><th>Thành viên</th>${isXp ? html`<th class="num">Level</th>` : ""}<th class="num">${isXp ? "Tổng XP" : "Điểm"}</th></tr></thead>
<tbody>${rows}</tbody></table>`;

	return html`<section class="card"><nav class="tabs">${tabs}</nav>
<p class="muted">${formatNumber(board.totalEntries)} thành viên có ${isXp ? "XP" : "điểm contribution"}. Bấm vào tên để xem hồ sơ và chỉnh điểm.
Thành viên chưa có điểm không có trong danh sách: tìm theo tên hoặc dán ID ở ô trên.</p>
${table}
${pager(ctx, PATH, { [SORT_PARAM]: sort }, board.page, board.totalPages)}</section>`;
}

async function renderMembers(ctx: GuildPageContext): Promise<WebResponse>
{
	const text = (ctx.req.query.get("q") ?? "").trim();
	const userId = parseUserId(text);
	if (userId !== null) return redirect(memberUrl(ctx, userId));
	const content = text.length > 0 ? await searchSection(ctx, text) : await listSection(ctx);
	return renderPage(ctx, {
		nav: "members",
		title: "Thành viên",
		lead: "Xem hồ sơ Activity XP và contribution của từng người; cộng, trừ hoặc reset điểm như lệnh /admin xp và /admin contribution.",
		body: html`${searchForm(ctx, text)}${content}`,
	});
}

// ---------- GET /members/view ----------

function headerCard(ctx: GuildPageContext, userId: string, display: MemberDisplay | undefined, notice: RawHtml | null): RawHtml
{
	return html`<section class="card"><p class="mb-who">${userCell(userId, display)}</p>
${notice}
<p class="mb-back"><a href="${guildUrl(ctx, PATH)}">← Danh sách thành viên</a></p></section>`;
}

function xpEventRow(event: XpEventView, displays: ReadonlyMap<string, MemberDisplay>): RawHtml
{
	const actor = event.actorId === null ? html`<span class="muted">—</span>` : html`${displays.get(event.actorId)?.displayName ?? UNKNOWN_MEMBER_NAME}`;
	const status = event.voided ? html`<span class="badge off">đã huỷ</span>` : html`<span class="badge ok">hiệu lực</span>`;
	return html`<tr${event.voided ? html` class="mb-voided"` : ""}>
<td class="mb-time">${formatDateTime(event.createdAt)}</td>
<td class="num mb-amount">${signed(event.amount)} XP</td>
<td>${XP_SOURCE_LABELS[event.source]}</td>
<td class="mb-reason">${event.reason ?? html`<span class="muted">—</span>`}</td>
<td>${actor}</td>
<td>${status}</td></tr>`;
}

function xpCard(ctx: GuildPageContext, profile: ActivityProfile, events: readonly XpEventView[], displays: ReadonlyMap<string, MemberDisplay>): RawHtml
{
	const set = ctx.deps.services.tierSets.current(ctx.guild.id);
	const { level } = profile;
	const tier = tierForLevel(level.level, set);
	const history = events.length === 0
		? html`<p class="muted">Chưa có biến động nào.</p>`
		: html`<div class="mb-scroll"><table class="table mb-events"><thead><tr><th>Thời gian</th><th class="num">XP</th><th>Nguồn</th><th>Lý do</th><th>Người thao tác</th><th>Trạng thái</th></tr></thead>
<tbody>${events.map(event => xpEventRow(event, displays))}</tbody></table></div>`;
	return html`<section class="card"><h2>⭐ Activity XP</h2>
<div class="grid">
${stat("Level", formatNumber(level.level))}
${stat("Tổng XP", formatNumber(level.totalXp))}
${stat("Xếp hạng", rankText(profile.rank, profile.totalRanked))}
${stat(set.texts.tierLabel, `${tier.emoji} ${tier.name}`)}
</div>
<div class="mb-progress-row"><label for="mb-progress">Tiến độ lên level ${formatNumber(level.level + 1)}</label>
<progress id="mb-progress" class="mb-progress" value="${level.xpIntoLevel}" max="${level.xpForNextLevel}"></progress>
<span class="muted">${formatNumber(level.xpIntoLevel)} / ${formatNumber(level.xpForNextLevel)} XP</span></div>
<h3>${RECENT_XP_EVENTS} biến động gần nhất</h3>
${history}
</section>`;
}

function contributionRow(ctx: GuildPageContext, contribution: Contribution, hidden: ReadonlySet<string>): RawHtml
{
	const title = contribution.channelId !== null && hidden.has(contribution.channelId)
		? html`<span class="muted">(ở kênh bạn không xem được)</span>`
		: html`${contribution.title}`;
	return html`<tr><td><a href="${guildUrl(ctx, `/contributions/view?id=${contribution.id}`)}">#${contribution.id}</a></td>
<td class="mb-title">${title}</td><td class="mb-state">${contributionBadges(contribution)}</td><td class="num">${formatNumber(contribution.votes)}</td>
<td class="num">${formatNumber(contribution.downvotes)}</td><td class="num">${formatNumber(contribution.score)}</td>
<td class="mb-time">${formatDateTime(contribution.createdAt)}</td></tr>`;
}

/** Thẻ contribution của hồ sơ: điểm, hạng, số contribution đã duyệt và đang chờ duyệt (DEC-051), các contribution gần nhất. */
function contributionCard(ctx: GuildPageContext, profile: ContributionProfile, pending: number, recent: readonly Contribution[], hidden: ReadonlySet<string>): RawHtml
{
	const list = recent.length === 0
		? html`<p class="muted">Chưa có contribution nào.</p>`
		: html`<div class="mb-scroll"><table class="table"><thead><tr><th>Mã</th><th>Tiêu đề</th><th>Trạng thái</th><th class="num" title="Lượt ghi nhận">👍</th><th class="num" title="Lượt không ghi nhận">👎</th><th class="num">Điểm</th><th>Ngày tạo</th></tr></thead>
<tbody>${recent.map(contribution => contributionRow(ctx, contribution, hidden))}</tbody></table></div>`;
	return html`<section class="card"><h2>🤝 Contribution</h2>
<div class="grid">
${stat("Điểm", formatNumber(profile.score))}
${stat("Xếp hạng", rankText(profile.rank, profile.totalRanked))}
${stat("Contribution đã duyệt", formatNumber(profile.contributions))}
${stat("Chờ duyệt", formatNumber(pending))}
</div>
<h3>${RECENT_CONTRIBUTIONS} contribution gần nhất</h3>
${list}
</section>`;
}

/**
 * Bộ danh hiệu hiển thị của người này (DEC-047): tự chọn bằng /rank-style hay theo server, và nút xoá lựa chọn (người đó về theo
 * server). Không có lựa chọn đã lưu thì không có nút.
 */
function tierStyleCard(ctx: GuildPageContext, userId: string): RawHtml
{
	const display = ctx.deps.services.tierSets.displayFor(ctx.guild.id, userId);
	const clear = display.choiceKey === null
		? html`<p class="muted mb-note">Người này chưa tự chọn bộ nào (lệnh /rank-style).</p>`
		: html`<form method="post" action="${guildUrl(ctx, TIER_STYLE_CLEAR_PATH)}" class="actions">${csrfField(ctx)}${userField(userId)}
<button class="btn" type="submit">Xoá lựa chọn, về theo server</button>
<span class="muted">Chỉ đổi thẻ /rank và lời chúc lên level của người này; người này vẫn tự chọn lại được bằng /rank-style.</span></form>`;
	return html`<section class="card"><h2>🎨 Bộ danh hiệu hiển thị</h2>
<p>Bộ hiển thị: ${discordText(ctx.guild, tierDisplayLabel(display))}</p>
<p class="muted mb-note">Dùng cho thẻ /rank và lời chúc lên level, lên bậc của người này. Role Discord, bảng xếp hạng và Bảng vàng luôn theo bộ của server (${display.serverSet.name}).</p>
${clear}</section>`;
}

function userField(userId: string): RawHtml
{
	return html`<input type="hidden" name="u" value="${userId}">`;
}

function reasonField(id: string): RawHtml
{
	return html`<div class="field"><label for="${id}">Lý do (tuỳ chọn)</label>
<input type="text" id="${id}" name="ly-do" maxlength="${REASON_MAX_LENGTH}">
<span class="hint">Ghi vào nhật ký quản trị, tối đa ${REASON_MAX_LENGTH} ký tự.</span></div>`;
}

function adjustCard(ctx: GuildPageContext, userId: string, member: GuildMember | null): RawHtml
{
	const note = member === null
		? "Người này không còn trong server: điểm mới không tính cho team nào và bot không đồng bộ role danh hiệu."
		: "Điểm mới tính cho team theo role hiện có của người này; sau khi đổi XP, bot tự đồng bộ role danh hiệu theo level mới.";
	return html`<section class="card"><h2>✏️ Điều chỉnh điểm</h2>
<div class="mb-forms">
<form method="post" action="${guildUrl(ctx, XP_PATH)}" class="mb-form">${csrfField(ctx)}${userField(userId)}
<h3>Activity XP</h3>
<div class="field"><label for="mb-xp">Số XP</label>
<input type="number" id="mb-xp" name="so-xp" min="1" max="${MAX_ADJUST}" step="1" required>
<span class="hint">Số nguyên từ 1 đến ${formatNumber(MAX_ADJUST)}. Không trừ quá số XP hiện có.</span></div>
<fieldset class="mb-direction"><legend>Cộng hay trừ</legend>
<label class="check"><input type="radio" name="huong" value="cong" required> ➕ Cộng XP</label>
<label class="check"><input type="radio" name="huong" value="tru" required> ➖ Trừ XP</label></fieldset>
${reasonField("mb-xp-reason")}
<div class="actions"><button class="btn btn-primary" type="submit">💾 Lưu XP</button></div>
</form>
<form method="post" action="${guildUrl(ctx, CONTRIBUTION_PATH)}" class="mb-form">${csrfField(ctx)}${userField(userId)}
<h3>Điểm contribution</h3>
<div class="field"><label for="mb-points">Số điểm</label>
<input type="number" id="mb-points" name="diem" min="-${MAX_ADJUST}" max="${MAX_ADJUST}" step="1" required>
<span class="hint">Số nguyên khác 0: dương để cộng, âm để trừ (từ -${formatNumber(MAX_ADJUST)} đến ${formatNumber(MAX_ADJUST)}). Không trừ quá số điểm hiện có.</span></div>
${reasonField("mb-points-reason")}
<div class="actions"><button class="btn btn-primary" type="submit">💾 Lưu điểm contribution</button></div>
</form>
</div>
<p class="muted mb-note">${note}</p>
</section>`;
}

function resetForm(ctx: GuildPageContext, userId: string, action: string, id: string, confirmText: string, button: string): RawHtml
{
	return html`<form method="post" action="${guildUrl(ctx, action)}" class="mb-form">${csrfField(ctx)}${userField(userId)}
<label class="check" for="${id}"><input type="checkbox" id="${id}" name="${CONFIRM_FIELD}" value="1" required> ${confirmText}</label>
<div class="actions"><button class="btn btn-danger" type="submit">${button}</button></div>
</form>`;
}

function resetCard(ctx: GuildPageContext, userId: string): RawHtml
{
	return html`<section class="card danger-zone"><h2>♻️ Reset điểm của thành viên</h2>
<p class="muted">Mọi biến động của người này bị đánh dấu huỷ (dữ liệu không bị xoá, DEC-027) và tổng về 0. Không hoàn tác được trên web.</p>
<div class="mb-forms">
${resetForm(ctx, userId, XP_RESET_PATH, "mb-reset-xp", "Tôi hiểu: reset toàn bộ XP của người này về 0", "Reset XP")}
${resetForm(ctx, userId, CONTRIBUTION_RESET_PATH, "mb-reset-points", "Tôi hiểu: reset toàn bộ điểm contribution của người này về 0", "Reset điểm contribution")}
</div></section>`;
}

async function renderMemberView(ctx: GuildPageContext): Promise<WebResponse>
{
	const { guild, deps } = ctx;
	const { services } = deps;
	const userId = requireUserId(ctx.req.query.get("u"));
	const member = await lookupMember(guild, userId);
	const lead = "Hồ sơ Activity XP và contribution, như lệnh /admin xp view.";
	const formerUser = member === null ? await deps.adminActions.fetchUser(deps.client, userId) : null;
	if (member === null && formerUser === null) throw new UserError(USER_NOT_FOUND);

	if (member === null && formerUser?.bot)
	{
		return renderPage(ctx, {
			nav: "members",
			title: UNKNOWN_MEMBER_NAME,
			lead,
			body: headerCard(ctx, userId, undefined, html`<div class="warn-box">${BOT_TARGET} Bot không nhận XP hay điểm contribution.</div>`),
		});
	}

	if (member?.user.bot)
	{
		const display: MemberDisplay = { displayName: member.displayName, avatarUrl: null, inGuild: true };
		return renderPage(ctx, {
			nav: "members",
			title: member.displayName,
			lead,
			body: headerCard(ctx, userId, display, html`<div class="warn-box">${BOT_TARGET} Bot không nhận XP hay điểm contribution.</div>`),
		});
	}

	const profile = services.activity.getProfile(guild.id, userId);
	const events = services.activity.recentEvents(guild.id, userId, RECENT_XP_EVENTS);
	const contribution = services.contributions.getProfile(guild.id, userId);
	const recent = services.contributions.listPage(guild.id, { authorId: userId, status: "all", page: 1, pageSize: RECENT_CONTRIBUTIONS }).items;
	const pending = services.contributions.listPage(guild.id, { authorId: userId, status: "active", review: "pending", page: 1, pageSize: 1 }).total;
	const actorIds = events.map(event => event.actorId).filter((id): id is string => id !== null);
	const [displays, hidden] = await Promise.all([
		deps.adminActions.displays(deps.client, guild, [...new Set([userId, ...actorIds])]),
		hiddenChannelIds(deps.client, guild, recent.map(item => item.channelId), ctx.member),
	]);
	const cached = displays.get(userId);
	const display: MemberDisplay = {
		displayName: member?.displayName ?? cached?.displayName ?? UNKNOWN_MEMBER_NAME,
		avatarUrl: cached?.avatarUrl ?? null,
		inGuild: member !== null,
	};

	return renderPage(ctx, {
		nav: "members",
		title: display.displayName,
		lead,
		body: html`${headerCard(ctx, userId, display, member === null ? html`<div class="warn-box">${MEMBER_LEFT_NOTE}</div>` : null)}
${xpCard(ctx, profile, events, displays)}
${tierStyleCard(ctx, userId)}
${contributionCard(ctx, contribution, pending, recent, hidden)}
${adjustCard(ctx, userId, member)}
${resetCard(ctx, userId)}`,
	});
}

// ---------- POST ----------

interface MemberTarget
{
	/** null nếu người này không còn trong server. */
	member: GuildMember | null;
	target: AdjustTarget;
}

function formOf(ctx: GuildPageContext): URLSearchParams
{
	return ctx.req.form ?? new URLSearchParams();
}

/**
 * Lấy lại thành viên từ Discord (role mới nhất cho snapshot team), như option `thanh-vien` của lệnh: không cho thao tác với bot
 * hay ID không phải tài khoản Discord (assertAdjustableUser).
 */
async function memberTarget(ctx: GuildPageContext, userId: string): Promise<MemberTarget>
{
	const member = await lookupMember(ctx.guild, userId);
	await assertAdjustableUser(ctx.deps.adminActions, ctx.deps.client, member, userId);
	return {
		member,
		target: { guildId: ctx.guild.id, userId, roleIds: member ? [...member.roles.cache.keys()] : [], actorId: ctx.actorId },
	};
}

/** Số XP từ ô nhập: chỉ chữ số (không dấu chấm, phẩy hay dấu trừ), rồi kiểm tra khoảng bằng assertXpAmount. */
export function parseXpAmount(raw: string | null | undefined): number
{
	const text = raw?.trim() ?? "";
	const amount = /^\d{1,9}$/u.test(text) ? Number(text) : Number.NaN;
	assertXpAmount(amount);
	return amount;
}

/** Điểm contribution từ ô nhập: chữ số, cho phép dấu "-" ở đầu, rồi kiểm tra bằng assertContributionDelta (khác 0, trong khoảng). */
export function parseContributionDelta(raw: string | null | undefined): number
{
	const text = raw?.trim() ?? "";
	const delta = /^-?\d{1,9}$/u.test(text) ? Number(text) : Number.NaN;
	assertContributionDelta(delta);
	return delta;
}

function directionOf(raw: string | null): 1 | -1
{
	if (raw === "cong") return 1;
	if (raw === "tru") return -1;
	throw new UserError(INVALID_DIRECTION);
}

function assertConfirmed(form: URLSearchParams): void
{
	if (!form.has(CONFIRM_FIELD)) throw new UserError(CONFIRM_REQUIRED);
}

function withLine(text: string, line: string | null): string
{
	return line === null ? text : `${text}\n${line}`;
}

async function adjustXp(ctx: GuildPageContext): Promise<WebResponse>
{
	const form = formOf(ctx);
	const userId = requireUserId(form.get("u"));
	const sign = directionOf(form.get("huong"));
	const amount = parseXpAmount(form.get("so-xp"));
	const reason = normalizeReason(form.get("ly-do"));
	const { member, target } = await memberTarget(ctx, userId);
	const { services, adminActions } = ctx.deps;
	const { text, totalXp } = adjustMemberXp(services, target, sign, amount, reason);
	const line = await syncMemberTierRoles(adminActions, services, member, totalXp);
	return redirectWithFlash(ctx, viewPath(userId), "ok", withLine(text, line));
}

async function resetXp(ctx: GuildPageContext): Promise<WebResponse>
{
	const form = formOf(ctx);
	const userId = requireUserId(form.get("u"));
	assertConfirmed(form);
	const { member, target } = await memberTarget(ctx, userId);
	const { services, adminActions } = ctx.deps;
	const { text, totalXp } = resetMemberXp(services, target);
	const line = await syncMemberTierRoles(adminActions, services, member, totalXp);
	return redirectWithFlash(ctx, viewPath(userId), "ok", withLine(text, line));
}

async function adjustContribution(ctx: GuildPageContext): Promise<WebResponse>
{
	const form = formOf(ctx);
	const userId = requireUserId(form.get("u"));
	const delta = parseContributionDelta(form.get("diem"));
	const reason = normalizeReason(form.get("ly-do"));
	const { target } = await memberTarget(ctx, userId);
	return redirectWithFlash(ctx, viewPath(userId), "ok", adjustMemberContribution(ctx.deps.services, target, delta, reason));
}

async function resetContribution(ctx: GuildPageContext): Promise<WebResponse>
{
	const form = formOf(ctx);
	const userId = requireUserId(form.get("u"));
	assertConfirmed(form);
	const { target } = await memberTarget(ctx, userId);
	return redirectWithFlash(ctx, viewPath(userId), "ok", resetMemberContribution(ctx.deps.services, target));
}

/**
 * Admin xoá bộ danh hiệu người này tự chọn (DEC-047): người đó về theo server. Không cần người đó còn trong server (chỉ xoá một
 * dòng cấu hình hiển thị). Service ghi audit "tier_pref.clear" với người đăng nhập.
 */
function clearTierStyle(ctx: GuildPageContext): WebResponse
{
	const userId = requireUserId(formOf(ctx).get("u"));
	const { tierSets } = ctx.deps.services;
	const cleared = tierSets.clearMemberChoice(ctx.guild.id, userId, ctx.actorId);
	if (cleared === null) return redirectWithFlash(ctx, viewPath(userId), "ok", NO_TIER_CHOICE);
	const name = isTierSetKey(cleared) ? TIER_SETS[cleared].name : cleared;
	return redirectWithFlash(ctx, viewPath(userId), "ok",
		`Đã xoá bộ danh hiệu tự chọn (**${name}**) của ${userMention(userId)}: từ giờ người này hiển thị theo bộ của server (**${tierSets.current(ctx.guild.id).name}**).`);
}

/** Lỗi của form ở trang hồ sơ quay về đúng hồ sơ đó; `u` sai thì hàm ném và server về `/members`. */
function backToProfile(ctx: GuildPageContext): string
{
	return viewPath(requireUserId(ctx.req.form?.get("u")));
}

export const membersPage: PageModule = {
	routes: [
		{ method: "GET", path: PATH, handler: renderMembers },
		{ method: "GET", path: VIEW_PATH, handler: renderMemberView },
		{ method: "POST", path: XP_PATH, handler: adjustXp, errorRedirect: backToProfile },
		{ method: "POST", path: XP_RESET_PATH, handler: resetXp, errorRedirect: backToProfile },
		{ method: "POST", path: CONTRIBUTION_PATH, handler: adjustContribution, errorRedirect: backToProfile },
		{ method: "POST", path: CONTRIBUTION_RESET_PATH, handler: resetContribution, errorRedirect: backToProfile },
		{ method: "POST", path: TIER_STYLE_CLEAR_PATH, handler: clearTierStyle, errorRedirect: backToProfile },
	],
	css: `
.mb-search { flex: 1; max-width: 420px; }
.mb-hint { font-size: 13px; margin: 0; }
.mb-who { margin: 0 0 8px; font-size: 17px; font-weight: 600; }
.mb-back { margin: 8px 0 0; }
.mb-progress-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 14px 0 4px; }
.mb-progress-row label { font-weight: 600; }
.mb-progress { width: 100%; max-width: 320px; height: 14px; accent-color: var(--brand); }
.mb-scroll { overflow-x: auto; }
.mb-time, .mb-state { white-space: nowrap; }
.mb-amount { white-space: nowrap; font-weight: 600; }
.mb-reason, .mb-title { overflow-wrap: anywhere; }
.mb-voided td:not(:last-child) { text-decoration: line-through; color: var(--muted); }
.mb-forms { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px 28px; }
.mb-form h3 { margin-top: 0; }
.mb-form .field input { max-width: 260px; }
.mb-note { font-size: 13px; margin: 12px 0 0; }
.mb-direction { border: 0; padding: 0; margin: 0 0 14px; }
.mb-direction legend { font-weight: 600; padding: 0; margin-bottom: 4px; }
`,
};
