// Trang "Bảng xếp hạng" của web quản trị (DEC-041): 12 bảng như `/leaderboard` (Activity/Contribution × cá nhân/team ×
// tổng/tuần/tháng) qua LeaderboardService.query, dạng bảng có phân trang. Chỉ đọc; tham số lạ trong query về mặc định.
import { formatNumber } from "../../discord/format";
import type { MemberDisplay } from "../../discord/memberDirectory";
import { levelInfo } from "../../modules/activity/levels";
import { LeaderboardPage, LeaderboardPeriod, LeaderboardScope, ScoreKind } from "../../modules/leaderboard/LeaderboardService";
import { roleChip } from "../format";
import { html, RawHtml } from "../html";
import { WebResponse } from "../http";
import { guildUrl, renderPage } from "../layout";
import { GuildPageContext, PageModule } from "../types";
import { formatDateTime, memberLink, pager, queryPage } from "../widgets";

const PATH = "/leaderboard";
/** Số dòng mỗi trang của bảng trên web (ảnh trên Discord chỉ 10 dòng). */
export const LEADERBOARD_WEB_PAGE_SIZE = 25;
export const NO_LEADERBOARD_ENTRIES = "Chưa có ai có điểm trong kỳ này.";

const KIND_PARAM = "loai";
const SCOPE_PARAM = "pv";
const PERIOD_PARAM = "ky";

/** Một lựa chọn của hàng tab: giá trị cho service, giá trị trong query và nhãn. Phần tử đầu là mặc định. */
interface Choice<T extends string>
{
	value: T;
	param: string;
	label: string;
}

const KINDS: readonly Choice<ScoreKind>[] = [
	{ value: "activity", param: "activity", label: "⚡ Activity XP" },
	{ value: "contribution", param: "contribution", label: "🌟 Contribution" },
];
const SCOPES: readonly Choice<LeaderboardScope>[] = [
	{ value: "individual", param: "ca-nhan", label: "👤 Cá nhân" },
	{ value: "team", param: "team", label: "👥 Team" },
];
const PERIODS: readonly Choice<LeaderboardPeriod>[] = [
	{ value: "all", param: "all", label: "Tổng" },
	{ value: "week", param: "week", label: "Tuần này" },
	{ value: "month", param: "month", label: "Tháng này" },
];

/** Bảng đang xem, đọc từ query. */
interface BoardChoice
{
	kind: Choice<ScoreKind>;
	scope: Choice<LeaderboardScope>;
	period: Choice<LeaderboardPeriod>;
}

/** Lựa chọn có `param` đúng bằng giá trị trong query; không có hoặc sai thì lựa chọn mặc định (phần tử đầu). */
function pick<T extends string>(choices: readonly Choice<T>[], raw: string | null): Choice<T>
{
	const fallback = choices[0];
	if (fallback === undefined) throw new Error("Hàng tab của bảng xếp hạng không có lựa chọn nào.");
	return choices.find(choice => choice.param === raw) ?? fallback;
}

/** Đọc loại, phạm vi, kỳ từ query; chỉ nhận đúng các giá trị liệt kê. */
function boardChoiceOf(query: URLSearchParams): BoardChoice
{
	return {
		kind: pick(KINDS, query.get(KIND_PARAM)),
		scope: pick(SCOPES, query.get(SCOPE_PARAM)),
		period: pick(PERIODS, query.get(PERIOD_PARAM)),
	};
}

function boardParams(board: BoardChoice): Record<string, string>
{
	return { [KIND_PARAM]: board.kind.param, [SCOPE_PARAM]: board.scope.param, [PERIOD_PARAM]: board.period.param };
}

/** URL tới một bảng (luôn về trang 1). */
function boardUrl(ctx: GuildPageContext, board: BoardChoice): string
{
	return guildUrl(ctx, `${PATH}?${new URLSearchParams(boardParams(board)).toString()}`);
}

/** Một hàng tab: mỗi link đổi đúng một tham số, giữ hai tham số còn lại và về trang 1. */
function tabRow<T extends string>(ctx: GuildPageContext, label: string, choices: readonly Choice<T>[], current: Choice<T>, target: (choice: Choice<T>) => BoardChoice): RawHtml
{
	const links = choices.map(choice => choice.param === current.param
		? html`<a class="active" href="${boardUrl(ctx, target(choice))}" aria-current="page">${choice.label}</a>`
		: html`<a href="${boardUrl(ctx, target(choice))}">${choice.label}</a>`);
	return html`<div class="lb-tab-row"><span class="lb-tab-label muted">${label}</span><nav class="tabs">${links}</nav></div>`;
}

function periodNote(page: LeaderboardPage): RawHtml
{
	if (page.since === null) return html`<p class="muted lb-note">Kỳ Tổng: toàn bộ điểm từ trước tới nay.</p>`;
	const start = page.period === "week" ? "00:00 thứ Hai" : "00:00 ngày 1";
	return html`<p class="muted lb-note">Kỳ này tính từ ${start} theo giờ Việt Nam: bắt đầu <strong>${formatDateTime(page.since)}</strong>.
Điểm của kỳ là điểm kiếm được trong kỳ (các biến động chưa bị huỷ phát sinh từ mốc trên), không phải tổng điểm hiện có.</p>`;
}

function teamNote(ctx: GuildPageContext): RawHtml
{
	const none = ctx.deps.services.teams.list(ctx.guild.id).length === 0 ? html` Server chưa cấu hình team nào.` : "";
	return html`<p class="muted lb-note">Bảng team chỉ gồm các team đang cấu hình (xem <a href="${guildUrl(ctx, "/teams")}">trang Team</a>);
điểm team chỉ tính từ lúc role được thêm làm team.${none}</p>`;
}

async function boardTable(ctx: GuildPageContext, board: BoardChoice, page: LeaderboardPage): Promise<RawHtml>
{
	if (page.entries.length === 0) return html`<p class="muted lb-empty">${NO_LEADERBOARD_ENTRIES}</p>`;
	const kind = board.kind.value;
	const team = board.scope.value === "team";
	const withLevel = kind === "activity" && !team && page.period === "all";
	const displays = team ? new Map<string, MemberDisplay>() : await ctx.deps.adminActions.displays(ctx.deps.client, ctx.guild, page.entries.map(entry => entry.id));
	const unit = kind === "activity" ? "XP" : "Điểm";
	const rows = page.entries.map(entry => html`<tr>
<td class="lb-rank">#${entry.rank}</td>
<td>${team ? roleChip(ctx.guild, entry.id) : memberLink(ctx, entry.id, displays.get(entry.id))}</td>
${withLevel ? html`<td class="num">${formatNumber(levelInfo(entry.value).level)}</td>` : ""}
<td class="num">${formatNumber(entry.value)}</td>
</tr>`);
	return html`<table class="table lb-table">
<thead><tr><th>Hạng</th><th>${team ? "Team" : "Thành viên"}</th>${withLevel ? html`<th class="num">Level</th>` : ""}<th class="num">${unit}</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

async function renderLeaderboard(ctx: GuildPageContext): Promise<WebResponse>
{
	const board = boardChoiceOf(ctx.req.query);
	const page = ctx.deps.services.leaderboard.query({
		guildId: ctx.guild.id,
		kind: board.kind.value,
		scope: board.scope.value,
		period: board.period.value,
		page: queryPage(ctx.req.query),
		pageSize: LEADERBOARD_WEB_PAGE_SIZE,
	});
	const unit = board.scope.value === "team" ? "team" : "người";
	const tabs = html`${tabRow(ctx, "Loại điểm", KINDS, board.kind, kind => ({ ...board, kind }))}
${tabRow(ctx, "Phạm vi", SCOPES, board.scope, scope => ({ ...board, scope }))}
${tabRow(ctx, "Kỳ", PERIODS, board.period, period => ({ ...board, period }))}`;

	return renderPage(ctx, {
		nav: "leaderboard",
		title: "Bảng xếp hạng",
		lead: "Như lệnh /leaderboard: Activity XP và Contribution luôn xếp hạng riêng, không cộng gộp. Hoà điểm thì cùng hạng.",
		body: html`<section class="card lb-controls">${tabs}</section>
<section class="card">
<h2>${board.kind.label} · ${board.scope.label} · ${board.period.label}</h2>
<p class="lb-summary">${formatNumber(page.totalEntries)} ${unit} có điểm · Trang ${formatNumber(page.page)}/${formatNumber(page.totalPages)}</p>
${periodNote(page)}
${board.scope.value === "team" ? teamNote(ctx) : ""}
${await boardTable(ctx, board, page)}
${pager(ctx, PATH, boardParams(board), page.page, page.totalPages)}
</section>`,
	});
}

export const leaderboardPage: PageModule = {
	routes: [
		{ method: "GET", path: PATH, handler: renderLeaderboard },
	],
	css: `
.lb-controls .tabs { margin-bottom: 0; }
.lb-tab-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 4px 0; }
.lb-tab-label { width: 80px; font-size: 13px; font-weight: 600; }
.lb-summary { margin: 0 0 6px; font-weight: 600; }
.lb-note { margin: 0 0 10px; font-size: 14px; }
.lb-empty { margin: 12px 0 0; }
.lb-rank { white-space: nowrap; font-weight: 700; width: 70px; }
.lb-table td { vertical-align: middle; }
`,
};
