// Trang "Team" của web quản trị (DEC-039, DEC-005): chọn role nào là team trong bảng mọi role của server, và gỡ team có role đã
// bị xoá khỏi server (menu chọn role của Discord không làm được). Cùng nghiệp vụ với `/config team` và `/config panel`: role thêm
// qua assertUsableRole, ghi qua TeamService (addMany kiểm tra MAX_TEAMS trong một transaction), audit với người đăng nhập.
import { Guild, Role } from "discord.js";
import { assertUsableRole } from "../../discord/configOps";
import { roleMention } from "../../discord/format";
import { BulkTeamResult, MAX_TEAMS } from "../../modules/team/TeamService";
import { UserError } from "../../shared/errors";
import { roleChip, sortedRoles } from "../format";
import { html, RawHtml } from "../html";
import { WebResponse } from "../http";
import { csrfField, guildUrl, redirectWithFlash, renderPage } from "../layout";
import { GuildPageContext, PageModule } from "../types";
import { BulkSelection, bulkChecked, bulkSelection, selectAllLinks } from "../widgets";

const PATH = "/teams";
const SNOWFLAKE = /^\d{17,20}$/u;
const STALE_FORM = "Form đã cũ hoặc không hợp lệ. Hãy tải lại trang rồi thử lại.";
const TEAM_PURPOSE = "làm team";

/** Lý do role không thêm làm team được (cùng quy tắc với assertUsableRole); null nếu dùng được. */
function blockedReason(role: Role, tierRoleIds: ReadonlySet<string>): string | null
{
	if (role.managed) return "Role do bot hoặc integration quản lý";
	if (tierRoleIds.has(role.id)) return "Role danh hiệu (bot tự thêm và gỡ theo level)";
	return null;
}

// ---------- GET ----------

function roleRow(guild: Guild, role: Role, isTeam: boolean, reason: string | null, selection: BulkSelection): RawHtml
{
	const id = role.id;
	const note = reason === null ? "" : `${reason}: ${isTeam ? "vẫn bỏ team được, nhưng không thêm lại được." : "không dùng làm team được."}`;
	const checked = bulkChecked(selection, isTeam, reason === null);
	return html`<tr>
<td><label for="team-${id}">${roleChip(guild, id)}</label><input type="hidden" name="t:${id}" value="${isTeam ? 1 : 0}"></td>
<td><input type="checkbox" id="team-${id}" name="team" value="${id}"${checked ? html` checked` : ""}${reason !== null && !isTeam ? html` disabled` : ""}></td>
<td class="tm-note">${note}</td>
</tr>`;
}

function renderTeams(ctx: GuildPageContext): WebResponse
{
	const { guild } = ctx;
	const { teams, tierRoles } = ctx.deps.services;
	const teamIds = teams.list(guild.id);
	const teamSet = new Set(teamIds);
	const tierRoleIds = new Set(tierRoles.list(guild.id).map(mapping => mapping.roleId));
	const roles = sortedRoles(guild);
	const gone = teamIds.filter(roleId => !guild.roles.cache.has(roleId));
	const selection = bulkSelection(ctx.req.query);

	const goneSection = gone.length === 0 ? "" : html`<section class="card"><h2>Team không còn trong server (${gone.length})</h2>
<p class="muted">Role của các team này đã bị xoá khỏi server nên không còn ai thuộc team. Tick để gỡ khỏi danh sách team (điểm lịch sử vẫn giữ).</p>
${gone.map(roleId => html`<label class="check"><input type="checkbox" name="gone" value="${roleId}"> Gỡ ${roleChip(guild, roleId)}</label>`)}
</section>`;

	return renderPage(ctx, {
		nav: "teams",
		title: "Team",
		lead: "Team là role Discord do admin chọn: thành viên có role nào thì thuộc team đó.",
		body: html`<form method="post" action="${guildUrl(ctx, PATH)}">${csrfField(ctx)}
<section class="card"><h2>Team đang có: ${teamIds.length}/${MAX_TEAMS}</h2>
${teamIds.length === 0 ? html`<p class="muted">Chưa có team nào. Tick role ở bảng dưới rồi bấm Lưu để thêm.</p>` : html`<p class="tm-chips">${teamIds.map(roleId => roleChip(guild, roleId))}</p>`}
<p class="muted tm-hint">Điểm team chỉ tính từ lúc role được thêm làm team; bỏ team thì điểm lịch sử vẫn giữ (thêm lại sẽ hiện lại). Tối đa ${MAX_TEAMS} team.</p>
</section>
${goneSection}
<section class="card"><h2>Role của server (${roles.length})</h2>
${roles.length === 0 ? html`<p class="muted">Server chưa có role nào ngoài @everyone.</p>` : html`${selectAllLinks(ctx, PATH, selection)}<div class="tm-scroll"><table class="table tm-table">
<thead><tr><th>Role</th><th>Là team</th><th>Ghi chú</th></tr></thead>
<tbody>${roles.map(role => roleRow(guild, role, teamSet.has(role.id), blockedReason(role, tierRoleIds), selection))}</tbody></table></div>`}
</section>
<div class="actions"><button class="btn btn-primary" type="submit">💾 Lưu thay đổi</button></div>
</form>`,
	});
}

// ---------- POST ----------

function mentions(roleIds: readonly string[]): string
{
	return roleIds.map(roleMention).join(", ");
}

/** Kết quả lưu: role đã thêm/bỏ và role vốn đúng trạng thái (cùng ý với phản hồi của `/config panel`). */
function resultText(added: BulkTeamResult, removed: BulkTeamResult): string
{
	const lines: string[] = [];
	if (added.changed.length > 0) lines.push(`Đã thêm ${mentions(added.changed)} làm team. Điểm team chỉ tính từ các lượt kiếm điểm kể từ bây giờ.`);
	if (removed.changed.length > 0) lines.push(`Đã bỏ ${mentions(removed.changed)} khỏi danh sách team. Điểm lịch sử vẫn được giữ.`);
	if (lines.length === 0) lines.push("Không có gì thay đổi.");
	if (added.unchanged.length > 0) lines.push(`-# Vốn đã là team: ${mentions(added.unchanged)}.`);
	if (removed.unchanged.length > 0) lines.push(`-# Vốn không phải team: ${mentions(removed.unchanged)}.`);
	return lines.join("\n");
}

const NO_CHANGE: BulkTeamResult = { changed: [], unchanged: [] };

function saveTeams(ctx: GuildPageContext): WebResponse
{
	const { guild, actorId } = ctx;
	const guildId = guild.id;
	const form = ctx.req.form ?? new URLSearchParams();
	const { services } = ctx.deps;

	const drawn = new Map<string, boolean>();
	for (const [key, value] of form)
	{
		if (!key.startsWith("t:")) continue;
		const roleId = key.slice(2);
		if (!SNOWFLAKE.test(roleId) || (value !== "0" && value !== "1")) throw new UserError(STALE_FORM);
		drawn.set(roleId, value === "1");
	}
	const ticked = new Set(form.getAll("team"));
	for (const roleId of ticked)
	{
		if (!drawn.has(roleId)) throw new UserError(STALE_FORM);
	}

	const adds = [...drawn].filter(([roleId, wasTeam]) => !wasTeam && ticked.has(roleId)).map(([roleId]) => roleId);
	const removes = [...drawn].filter(([roleId, wasTeam]) => wasTeam && !ticked.has(roleId)).map(([roleId]) => roleId);
	for (const roleId of adds)
	{
		const role = guild.roles.cache.get(roleId);
		if (!role) throw new UserError(`Không tìm thấy role ${roleMention(roleId)} trong server (có thể vừa bị xoá). Hãy tải lại trang rồi thử lại.`);
		assertUsableRole(services, guildId, role, TEAM_PURPOSE);
	}
	const gone = [...new Set(form.getAll("gone"))];
	for (const roleId of gone)
	{
		if (!SNOWFLAKE.test(roleId)) throw new UserError(STALE_FORM);
		if (guild.roles.cache.has(roleId)) throw new UserError(`${roleMention(roleId)} vẫn còn trong server: hãy bỏ tick role đó ở bảng role.`);
	}

	const current = new Set(services.teams.list(guildId));
	const removals = [...new Set([...removes, ...gone])];
	const after = new Set(current);
	for (const roleId of removals) after.delete(roleId);
	for (const roleId of adds) after.add(roleId);
	if (after.size > MAX_TEAMS && adds.some(roleId => !current.has(roleId)))
	{
		throw new UserError(`Chỉ được cấu hình tối đa ${MAX_TEAMS} team: server đang có ${current.size} team, lưu thay đổi này sẽ thành `
			+ `${after.size} team. Hãy bỏ bớt team trước. Bot chưa thay đổi gì.`);
	}

	const removed = removals.length > 0 ? services.teams.removeMany(guildId, removals, actorId) : NO_CHANGE;
	const added = adds.length > 0 ? services.teams.addMany(guildId, adds, actorId) : NO_CHANGE;
	return redirectWithFlash(ctx, PATH, "ok", resultText(added, removed));
}

export const teamsPage: PageModule = {
	routes: [
		{ method: "GET", path: PATH, handler: renderTeams },
		{ method: "POST", path: PATH, handler: saveTeams },
	],
	css: `
.tm-chips .chip { margin: 2px 6px 2px 0; }
.tm-hint { font-size: 13px; margin: 8px 0 0; }
.tm-scroll { overflow-x: auto; }
.tm-table td label { cursor: pointer; }
.tm-note { color: var(--muted); font-size: 13px; }
`,
};
