// Trang "Tổng quan" của web quản trị (DEC-039): tóm tắt mọi cấu hình (như trang tổng quan của `/config panel`), vài số liệu từ
// StatisticsService và các thao tác quản trị gần đây. Chỉ đọc; mỗi thẻ có link tới trang sửa tương ứng.
import { channelMention, formatNumber, roleMention } from "../../discord/format";
import { auditActionLabel, settingLine } from "../../discord/views/admin";
import { NO_XP_CHANNEL_WARNING } from "../../discord/views/configPanel";
import { AuditEntry } from "../../modules/audit/AuditService";
import { GuildSettings } from "../../modules/guild-config/types";
import { MAX_TEAMS } from "../../modules/team/TeamService";
import { auditDetailsHtml, auditTargetLabel, discordText, userLabel } from "../format";
import { html, RawHtml } from "../html";
import { WebResponse } from "../http";
import { guildUrl, renderPage } from "../layout";
import { GuildPageContext, PageModule } from "../types";
import { xpChannelsOf } from "./channels";

/** Số thao tác gần đây hiện ở trang tổng quan. */
const RECENT_AUDIT_LIMIT = 5;
/** Số team hiện tên trong thẻ Team; phần còn lại gộp thành "và N team khác". */
const TEAM_CHIPS_MAX = 8;

const VN_TIME = new Intl.DateTimeFormat("vi-VN", {
	timeZone: "Asia/Ho_Chi_Minh",
	day: "2-digit",
	month: "2-digit",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
});

const XP_KEYS = ["xpPerMessage", "xpCooldownSeconds", "minMessageLength", "duplicateWindowSeconds", "levelUpAnnouncements", "levelUpChannelId"] as const;
const POLL_KEYS = ["defaultPollXp", "pollXpDailyCap", "contributionVotePoints"] as const;
const ROLE_KEYS = ["adminRoleId", "pollCreatorRoleId"] as const;

/** Danh sách dòng kiểu Discord ("• Nhãn: **giá trị**", mention) thành <ul>; bỏ dấu "• " đầu dòng. */
function lines(ctx: GuildPageContext, texts: readonly string[]): RawHtml
{
	return html`<ul class="ov-list">${texts.map(text => html`<li>${discordText(ctx.guild, text.replace(/^• /u, ""), ctx.member)}</li>`)}</ul>`;
}

function settingTexts(settings: GuildSettings, keys: readonly (keyof GuildSettings)[]): string[]
{
	return keys.map(key => settingLine(key, settings[key]));
}

function card(ctx: GuildPageContext, title: string, path: string, linkText: string, content: RawHtml): RawHtml
{
	return html`<section class="card ov-card"><h2>${title}</h2>${content}<a class="ov-more" href="${guildUrl(ctx, path)}">${linkText} →</a></section>`;
}

function channelCard(ctx: GuildPageContext, settings: GuildSettings): RawHtml
{
	const { guild } = ctx;
	const { guildConfig } = ctx.deps.services;
	const mode = settings.xpChannelMode;
	const channels = xpChannelsOf(guild);
	const existing = new Set(channels.map(channel => channel.id));
	const enabled = channels.filter(channel => guildConfig.effectiveChannelXp(guild.id, channel.id).enabled).length;
	const rows = guildConfig.listChannels(guild.id).filter(row => existing.has(row.channelId));
	const pinned = rows.filter(row => row.xpEnabled === (mode === "selected")).length;
	const custom = rows.filter(row => row.xpEnabled && (row.xpPerMessage !== null || row.xpCooldownSeconds !== null)).length;
	const texts = [
		settingLine("xpChannelMode", mode),
		`Đang tính XP: **${formatNumber(enabled)}/${formatNumber(channels.length)}** kênh`,
		mode === "all" ? `Kênh tắt riêng: **${formatNumber(pinned)}**` : `Kênh bật riêng: **${formatNumber(pinned)}**`,
	];
	if (custom > 0) texts.push(`Kênh có XP hoặc cooldown riêng: **${formatNumber(custom)}**`);
	const warning = mode === "selected" && enabled === 0 ? html`<div class="warn-box">${NO_XP_CHANNEL_WARNING}</div>` : "";
	return card(ctx, "📺 Kênh tính XP", "/channels", "Sửa kênh", html`${lines(ctx, texts)}${warning}`);
}

function teamCard(ctx: GuildPageContext): RawHtml
{
	const teams = ctx.deps.services.teams.list(ctx.guild.id);
	const shown = teams.slice(0, TEAM_CHIPS_MAX).map(roleMention);
	if (teams.length > TEAM_CHIPS_MAX) shown.push(`và ${formatNumber(teams.length - TEAM_CHIPS_MAX)} team khác`);
	const texts = [`Team: **${formatNumber(teams.length)}/${formatNumber(MAX_TEAMS)}**`];
	if (shown.length > 0) texts.push(shown.join(", "));
	return card(ctx, "👥 Team", "/teams", "Sửa team", lines(ctx, texts));
}

function boardCard(ctx: GuildPageContext): RawHtml
{
	const board = ctx.deps.services.liveBoards.get(ctx.guild.id);
	const text = board === null ? "Bảng vàng: **đang tắt**" : `Bảng vàng: ${channelMention(board.channelId)} (tự cập nhật định kỳ)`;
	return card(ctx, "🏆 Bảng vàng", "/board", "Sửa Bảng vàng", lines(ctx, [text]));
}

function tierCard(ctx: GuildPageContext): RawHtml
{
	const { tierSets, tierRoles } = ctx.deps.services;
	const set = tierSets.current(ctx.guild.id);
	const assigned = tierRoles.list(ctx.guild.id).length;
	return card(ctx, "🏅 Danh hiệu", "/tiers", "Sửa danh hiệu", lines(ctx, [
		`Bộ đang dùng: **${set.name}**`,
		`Role đã gán: **${formatNumber(assigned)}/${formatNumber(set.tiers.length)}** bậc`,
	]));
}

function statsRow(ctx: GuildPageContext): RawHtml
{
	const stats = ctx.deps.services.statistics.summary(ctx.guild.id);
	const tiles: [string, number][] = [
		["Thành viên có XP", stats.activity.members],
		["XP trong 7 ngày qua", stats.activity.xpLast7Days],
	];
	return html`<div class="grid ov-stats">${tiles.map(([label, value]) => html`<div class="stat"><div class="label">${label}</div><div class="value">${formatNumber(value)}</div></div>`)}</div>`;
}

function auditRow(ctx: GuildPageContext, entry: AuditEntry): RawHtml
{
	const target = auditTargetLabel(ctx.guild, entry.action, entry.targetId, ctx.member);
	const details = auditDetailsHtml(ctx.guild, entry.action, entry.details, ctx.member);
	return html`<tr>
<td class="ov-time">${VN_TIME.format(entry.createdAt)}</td>
<td>${userLabel(ctx.guild, entry.actorId)}</td>
<td><strong>${auditActionLabel(entry.action)}</strong>${target === null ? "" : html` · <span class="mention">${target}</span>`}</td>
<td>${details ?? html`<span class="muted">—</span>`}</td>
</tr>`;
}

function recentCard(ctx: GuildPageContext): RawHtml
{
	const entries = ctx.deps.services.audit.list(ctx.guild.id, RECENT_AUDIT_LIMIT);
	const content = entries.length === 0
		? html`<p class="muted">Chưa có thao tác quản trị nào được ghi lại.</p>`
		: html`<div class="ov-scroll"><table class="table ov-audit"><thead><tr><th>Thời gian</th><th>Người thao tác</th><th>Thao tác</th><th>Chi tiết</th></tr></thead>
<tbody>${entries.map(entry => auditRow(ctx, entry))}</tbody></table></div>`;
	return card(ctx, "📜 Hoạt động gần đây", "/audit", "Xem nhật ký", content);
}

function renderOverview(ctx: GuildPageContext): WebResponse
{
	const settings = ctx.deps.services.guildConfig.getSettings(ctx.guild.id);
	return renderPage(ctx, {
		nav: "overview",
		title: "Tổng quan",
		lead: "Tóm tắt cấu hình bot ở server này. Bấm link ở từng thẻ để sửa; mọi thay đổi được ghi vào nhật ký quản trị.",
		body: html`${statsRow(ctx)}
<div class="grid ov-grid">
${channelCard(ctx, settings)}
${card(ctx, "⭐ Activity XP", "/settings", "Sửa cài đặt điểm", lines(ctx, settingTexts(settings, XP_KEYS)))}
${card(ctx, "🗳️ Vote và 🤝 contribution", "/settings", "Sửa cài đặt điểm", lines(ctx, settingTexts(settings, POLL_KEYS)))}
${teamCard(ctx)}
${boardCard(ctx)}
${card(ctx, "🔐 Quyền", "/roles", "Sửa quyền", lines(ctx, [...settingTexts(settings, ROLE_KEYS), "Người có quyền Manage Server luôn là admin."]))}
${tierCard(ctx)}
</div>
${recentCard(ctx)}`,
	});
}

export const overviewPage: PageModule = {
	routes: [
		{ method: "GET", path: "", handler: renderOverview },
	],
	css: `
.ov-stats { margin-bottom: 14px; }
.ov-grid { margin-bottom: 18px; }
.ov-grid .card { margin-bottom: 0; }
.ov-card { display: flex; flex-direction: column; }
.ov-list { list-style: none; padding: 0; margin: 0 0 10px; }
.ov-list li { padding: 2px 0; }
.ov-more { margin-top: auto; font-weight: 600; font-size: 14px; }
.ov-scroll { overflow-x: auto; margin-bottom: 10px; }
.ov-time { white-space: nowrap; color: var(--muted); }
`,
};
