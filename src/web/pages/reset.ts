// Trang "Reset điểm" của web quản trị (DEC-041): reset Activity XP hoặc điểm contribution của toàn server, như
// `/admin xp reset-all` và `/admin contribution reset-all`. Phải nhập đúng chuỗi xác nhận (kiểm tra trong adminOps, cùng hàm với
// lệnh Discord); service đánh dấu huỷ mọi biến động, không xoá dòng (DEC-027), và ghi audit với người đăng nhập.
import { RESET_ALL_TIER_ROLE_NOTE, RESET_CONFIRMATION, resetAllContribution, resetAllXp } from "../../discord/adminOps";
import { formatNumber } from "../../discord/format";
import { html, RawHtml } from "../html";
import { WebResponse } from "../http";
import { csrfField, guildUrl, redirectWithFlash, renderPage } from "../layout";
import { GuildPageContext, PageModule } from "../types";

const PATH = "/reset";
const XP_PATH = "/reset/xp";
const CONTRIBUTION_PATH = "/reset/contribution";
const CONFIRM_FIELD = "xac-nhan";

function confirmForm(ctx: GuildPageContext, action: string, id: string, button: string): RawHtml
{
	return html`<form method="post" action="${guildUrl(ctx, action)}" class="rs-form">${csrfField(ctx)}
<div class="field"><label for="${id}">Nhập ${RESET_CONFIRMATION} để xác nhận</label>
<input type="text" id="${id}" name="${CONFIRM_FIELD}" autocomplete="off" spellcheck="false" required>
<span class="hint">Gõ đúng <code>${RESET_CONFIRMATION}</code>: chữ hoa, không dấu, có một dấu cách.</span></div>
<button class="btn btn-danger" type="submit">${button}</button>
</form>`;
}

function backupHint(ctx: GuildPageContext): RawHtml
{
	return html`<p class="muted rs-backup">Nên tạo bản sao lưu trước ở trang <a href="${guildUrl(ctx, "/backup")}">💾 Sao lưu</a>, để còn khôi phục được nếu cần.</p>`;
}

function renderReset(ctx: GuildPageContext): WebResponse
{
	const { activity, contribution } = ctx.deps.services.statistics.summary(ctx.guild.id);
	const undo = html`<li>Dữ liệu không bị xoá mà chỉ đánh dấu huỷ (DEC-027), nhưng <strong>không hoàn tác được trên web</strong>.</li>`;

	const xpCard = html`<section class="card danger-zone"><h2>♻️ Reset XP toàn server</h2>
<ul class="rs-list">
<li>Mọi biến động XP của mọi thành viên bị huỷ: tổng XP và level của mọi người về 0, bảng xếp hạng Activity (cá nhân, team, tuần, tháng) về 0.</li>
${undo}
<li>${RESET_ALL_TIER_ROLE_NOTE}</li>
</ul>
<p class="rs-now">Hiện có: <strong>${formatNumber(activity.members)}</strong> thành viên có XP · tổng <strong>${formatNumber(activity.totalXp)}</strong> XP.</p>
${backupHint(ctx)}
${confirmForm(ctx, XP_PATH, "rs-xp", "♻️ Reset XP toàn server")}
</section>`;

	const contributionCard = html`<section class="card danger-zone"><h2>♻️ Reset điểm contribution toàn server</h2>
<ul class="rs-list">
<li>Mọi điểm contribution của mọi thành viên bị huỷ (điểm từ lượt ghi nhận và điểm admin cộng/trừ): tổng điểm về 0, bảng xếp hạng Contribution về 0.</li>
<li>Các contribution vẫn giữ nguyên, không bị gỡ; lượt ghi nhận đã có không được tính lại.</li>
${undo}
</ul>
<p class="rs-now">Hiện có: tổng <strong>${formatNumber(contribution.totalScore)}</strong> điểm · <strong>${formatNumber(contribution.total)}</strong> contribution còn hiệu lực · <strong>${formatNumber(contribution.votes)}</strong> lượt ghi nhận.</p>
${backupHint(ctx)}
${confirmForm(ctx, CONTRIBUTION_PATH, "rs-contribution", "♻️ Reset điểm contribution toàn server")}
</section>`;

	return renderPage(ctx, {
		nav: "reset",
		title: "Reset điểm",
		lead: "Đưa Activity XP hoặc điểm contribution của cả server về 0, như /admin xp reset-all và /admin contribution reset-all. "
			+ "Muốn reset một người: mở hồ sơ của người đó ở trang Thành viên.",
		body: html`${xpCard}${contributionCard}`,
	});
}

function resetXp(ctx: GuildPageContext): WebResponse
{
	const text = resetAllXp(ctx.deps.services, ctx.guild.id, ctx.actorId, ctx.req.form?.get(CONFIRM_FIELD) ?? "");
	return redirectWithFlash(ctx, PATH, "ok", text);
}

function resetContribution(ctx: GuildPageContext): WebResponse
{
	const text = resetAllContribution(ctx.deps.services, ctx.guild.id, ctx.actorId, ctx.req.form?.get(CONFIRM_FIELD) ?? "");
	return redirectWithFlash(ctx, PATH, "ok", text);
}

export const resetPage: PageModule = {
	routes: [
		{ method: "GET", path: PATH, handler: renderReset },
		{ method: "POST", path: XP_PATH, handler: resetXp },
		{ method: "POST", path: CONTRIBUTION_PATH, handler: resetContribution },
	],
	css: `
.rs-list { margin: 0 0 10px; padding-left: 20px; }
.rs-list li { margin-bottom: 4px; }
.rs-now { margin: 8px 0; }
.rs-backup { font-size: 13px; margin: 0 0 12px; }
.rs-form .field input { max-width: 260px; }
`,
};
