// Trang "Thống kê" của web quản trị (DEC-041): số liệu như `/admin stats` (StatisticsService.summary), chia theo Activity XP,
// Contribution, Vote và Team, kèm các kênh sôi nổi nhất 7 ngày qua. Chỉ đọc; tên kênh admin không xem được bị giấu.
import { formatNumber } from "../../discord/format";
import { GuildStatistics } from "../../modules/statistics/types";
import { channelLabel } from "../format";
import { html, RawHtml } from "../html";
import { WebResponse } from "../http";
import { guildUrl, renderPage } from "../layout";
import { GuildPageContext, PageModule } from "../types";
import { formatDateTime } from "../widgets";

const PATH = "/stats";
export const NO_CHANNEL_DATA = "Chưa có dữ liệu.";

type Tile = readonly [label: string, value: number];

function tiles(items: readonly Tile[]): RawHtml
{
	return html`<div class="grid st-grid">${items.map(([label, value]) => html`<div class="stat"><div class="label">${label}</div><div class="value">${formatNumber(value)}</div></div>`)}</div>`;
}

function section(ctx: GuildPageContext, title: string, items: readonly Tile[], link: { path: string; text: string } | null): RawHtml
{
	const more = link === null ? "" : html`<a class="st-more" href="${guildUrl(ctx, link.path)}">${link.text} →</a>`;
	return html`<section class="card"><h2>${title}</h2>${tiles(items)}${more}</section>`;
}

function topChannels(ctx: GuildPageContext, stats: GuildStatistics): RawHtml
{
	const channels = stats.activity.topChannelsLast7Days;
	const content = channels.length === 0
		? html`<p class="muted">${NO_CHANNEL_DATA}</p>`
		: html`<table class="table st-table"><thead><tr><th>#</th><th>Kênh</th><th class="num">Lượt được XP</th></tr></thead>
<tbody>${channels.map((channel, index) => html`<tr><td class="st-index">${index + 1}</td><td>${channelLabel(ctx.guild, channel.channelId, ctx.member)}</td><td class="num">${formatNumber(channel.awards)}</td></tr>`)}</tbody></table>`;
	return html`<section class="card"><h2>🔥 Kênh sôi nổi nhất (7 ngày)</h2>
<p class="muted st-hint">Kênh có nhiều lượt được XP từ tin nhắn nhất. Kênh bạn không có quyền xem hiện là tên giấu.</p>${content}</section>`;
}

function renderStats(ctx: GuildPageContext): WebResponse
{
	const { services } = ctx.deps;
	const stats = services.statistics.summary(ctx.guild.id);
	const { activity, contribution, polls } = stats;
	return renderPage(ctx, {
		nav: "stats",
		title: "Thống kê",
		lead: "Như lệnh /admin stats. \"7 ngày\" là 7 × 24 giờ tính ngược từ lúc mở trang; Activity XP và Contribution thống kê riêng.",
		body: html`<p class="muted st-time">Số liệu lúc ${formatDateTime(services.clock.now())} (giờ Việt Nam). Tải lại trang để cập nhật.</p>
${section(ctx, "⭐ Activity XP", [
		["Thành viên có XP", activity.members],
		["Tổng XP", activity.totalXp],
		["XP trong 7 ngày", activity.xpLast7Days],
		["Lượt được XP từ tin nhắn (7 ngày)", activity.messageAwardsLast7Days],
	], { path: "/leaderboard", text: "Xem bảng xếp hạng" })}
${section(ctx, "🤝 Contribution", [
		["Contribution còn hiệu lực", contribution.total],
		["Mới trong 7 ngày", contribution.last7Days],
		["Lượt ghi nhận", contribution.votes],
		["Tổng điểm", contribution.totalScore],
	], { path: "/contributions", text: "Xem contribution" })}
${section(ctx, "🗳️ Vote", [
		["Tổng số vote", polls.total],
		["Đang mở", polls.open],
		["Lượt tham gia", polls.participations],
	], { path: "/polls", text: "Xem vote" })}
${section(ctx, "👥 Team", [["Team đang cấu hình", stats.teams]], { path: "/teams", text: "Sửa team" })}
${topChannels(ctx, stats)}`,
	});
}

export const statsPage: PageModule = {
	routes: [
		{ method: "GET", path: PATH, handler: renderStats },
	],
	css: `
.st-time { margin: -8px 0 16px; font-size: 14px; }
.st-grid { margin-bottom: 10px; }
.st-more { display: inline-block; font-weight: 600; font-size: 14px; }
.st-hint { margin: 0 0 10px; font-size: 14px; }
.st-index { width: 40px; color: var(--muted); }
`,
};
