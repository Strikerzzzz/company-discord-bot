// Trang "Quyền" của web quản trị (DEC-039, DEC-044): danh sách role admin bot và danh sách role được tạo vote, mỗi danh sách là
// một bảng ô tick mọi role của server (như trang Team). Cùng quy tắc với `/config admin-role`, `/config poll` và ô chọn nhiều role
// của `/config panel`: role thêm phải dùng được (assertUsableRole), tối đa MAX_GRANT_ROLES role mỗi danh sách. Lưu chỉ ghi phần
// khác với lúc vẽ trang (changeRoleGrants), nên hai admin hay hai tab không đè nhau; kiểm tra cả hai bảng rồi mới ghi.
import { Guild, PermissionFlagsBits, Role } from "discord.js";
import { assertUsableRole, ROLE_GRANT_PURPOSES, roleGrantChanged, roleGrantChangeLines } from "../../discord/configOps";
import { roleMention } from "../../discord/format";
import { RoleGrantResult } from "../../modules/guild-config/GuildConfigService";
import { MAX_GRANT_ROLES, RoleGrantKey } from "../../modules/guild-config/types";
import { UserError } from "../../shared/errors";
import { roleChip, sortedRoles } from "../format";
import { html, RawHtml } from "../html";
import { WebResponse } from "../http";
import { csrfField, guildUrl, redirectWithFlash, renderPage } from "../layout";
import { GuildPageContext, PageModule } from "../types";
import { BulkSelection, bulkChecked, bulkSelection, selectAllLinks } from "../widgets";

const PATH = "/roles";
const SNOWFLAKE = /^\d{17,20}$/u;

export const ROLES_STALE_FORM = "Form đã cũ hoặc không hợp lệ, nên bot chưa lưu gì. Hãy tải lại trang rồi thử lại.";
export const ROLES_UNCHANGED = "Không có gì thay đổi.";
/** Ghi chú của dòng role đã lưu nhưng không còn trong server. */
export const MISSING_ROLE_NOTE = "Role không còn trong server: bỏ tick để gỡ khỏi danh sách.";
const ADMIN_ROLE_INTEGRATION_NOTE = "-# Muốn role admin mới dùng lệnh `/admin`, `/config` trong Discord thì cho phép trong "
	+ "**Server Settings → Integrations → chọn bot**; trang web không cần bước này.";

/** Ô xác nhận bắt buộc khi một lần lưu thêm role admin bot (review bảo mật Phase 18). */
export const ADMIN_CONFIRM_FIELD = "xac-nhan-admin";
export const ADMIN_CONFIRM_REQUIRED = "Thêm role admin bot cần tick ô xác nhận ở bảng Role admin bot: mọi thành viên có role vừa thêm sẽ có toàn quyền quản trị bot. Bot chưa thay đổi gì.";

/**
 * Một bảng ô tick. Form gửi: checkbox `<field>` = role ID cho mỗi ô đang tick, input ẩn `<drawnPrefix><roleId>` = 1/0 (role có
 * trong danh sách lúc vẽ trang hay không) cho mọi dòng. "Chọn tất cả" dùng tham số riêng `selectParam` của từng bảng; bảng role
 * admin KHÔNG có "Chọn tất cả" (null): một cú bấm rồi Lưu sẽ biến mọi role, kể cả role team, thành admin bot (review bảo mật
 * Phase 18), và thêm role admin phải tick ô xác nhận ADMIN_CONFIRM_FIELD.
 */
interface GrantTable
{
	key: RoleGrantKey;
	title: string;
	/** Tên danh sách trong câu, ví dụ "role admin bot". */
	name: string;
	/** Tiêu đề cột ô tick. */
	column: string;
	field: string;
	drawnPrefix: string;
	/** Tham số "Chọn tất cả" của bảng; null = bảng không có "Chọn tất cả". */
	selectParam: string | null;
	hint: string;
	/** Chữ khi danh sách rỗng. */
	empty: string;
}

const GRANT_TABLES: readonly GrantTable[] = [
	{
		key: "adminRoleIds",
		title: "🔐 Role admin bot",
		name: "role admin bot",
		column: "Là role admin bot",
		field: "admin",
		drawnPrefix: "a:",
		selectParam: null,
		hint: "Người có ít nhất một role trong danh sách quản trị được bot: dùng trang web này, và dùng lệnh /admin, /config nếu server cho phép (xem ghi chú).",
		empty: "Chưa đặt role nào: chỉ người có quyền Manage Server là admin bot.",
	},
	{
		key: "pollCreatorRoleIds",
		title: "🗳️ Role được tạo vote",
		name: "role tạo vote",
		column: "Được tạo vote",
		field: "vote",
		drawnPrefix: "v:",
		selectParam: "chon-vote",
		hint: "Người có ít nhất một role trong danh sách tạo được vote. Admin luôn tạo được vote.",
		empty: "Chưa đặt role nào: chỉ admin tạo được vote.",
	},
];

/** Lý do role không thêm vào danh sách được (cùng quy tắc với assertUsableRole); null nếu dùng được. Trang Retro dùng lại cho role quản lý retro. */
export function blockedReason(role: Role | undefined, tierRoleIds: ReadonlySet<string>): string | null
{
	if (!role) return "Không còn trong server";
	if (role.managed) return "Role do bot hoặc integration quản lý";
	if (tierRoleIds.has(role.id)) return "Role danh hiệu (bot tự thêm và gỡ theo level)";
	return null;
}

// ---------- GET ----------

interface RowState
{
	roleId: string;
	granted: boolean;
	reason: string | null;
	checked: boolean;
}

/** Các dòng của một bảng: role của server theo vị trí, rồi role đã lưu mà không còn trong server (bỏ tick được để gỡ). */
function rowStates(guild: Guild, roleIds: readonly string[], tierRoleIds: ReadonlySet<string>, selection: BulkSelection): RowState[]
{
	const granted = new Set(roleIds);
	const gone = roleIds.filter(roleId => !guild.roles.cache.has(roleId));
	const rows = [...sortedRoles(guild).map(role => ({ roleId: role.id, reason: blockedReason(role, tierRoleIds) })), ...gone.map(roleId => ({ roleId, reason: blockedReason(undefined, tierRoleIds) }))];
	return rows.map(({ roleId, reason }) =>
	{
		const isGranted = granted.has(roleId);
		return { roleId, granted: isGranted, reason, checked: bulkChecked(selection, isGranted, reason === null) };
	});
}

function roleRow(guild: Guild, table: GrantTable, row: RowState): RawHtml
{
	const id = `${table.field}-${row.roleId}`;
	let note = "";
	if (row.reason !== null && guild.roles.cache.has(row.roleId)) note = `${row.reason}: ${row.granted ? "vẫn bỏ được, nhưng không thêm lại được." : "không dùng được."}`;
	else if (row.reason !== null) note = MISSING_ROLE_NOTE;
	return html`<tr>
<td><label for="${id}">${roleChip(guild, row.roleId)}</label><input type="hidden" name="${table.drawnPrefix}${row.roleId}" value="${row.granted ? 1 : 0}"></td>
<td><input type="checkbox" id="${id}" name="${table.field}" value="${row.roleId}"${row.checked ? html` checked` : ""}${row.reason !== null && !row.granted ? html` disabled` : ""}></td>
<td class="rl-note">${note}</td>
</tr>`;
}

function grantSection(ctx: GuildPageContext, table: GrantTable, roleIds: readonly string[], tierRoleIds: ReadonlySet<string>): RawHtml
{
	const { guild } = ctx;
	const selection = table.selectParam === null ? null : bulkSelection(ctx.req.query, table.selectParam);
	const rows = rowStates(guild, roleIds, tierRoleIds, selection);
	const checked = rows.filter(row => row.checked).length;
	const tooMany = checked > MAX_GRANT_ROLES
		? html`<div class="warn-box">Đang tick ${checked} role, nhiều hơn giới hạn ${MAX_GRANT_ROLES} ${table.name}: hãy bỏ tick bớt trước khi lưu.</div>`
		: "";
	const current = roleIds.length === 0 ? html`<p class="muted">${table.empty}</p>` : html`<p class="rl-chips">${roleIds.map(roleId => roleChip(guild, roleId))}</p>`;
	return html`<section class="card" id="rl-${table.field}"><h2>${table.title}: ${roleIds.length}/${MAX_GRANT_ROLES}</h2>
<p class="muted rl-hint">${table.hint}</p>
${current}
${rows.length === 0 ? html`<p class="muted">Server chưa có role nào ngoài @everyone.</p>` : html`${table.selectParam === null ? "" : selectAllLinks(ctx, PATH, selection, table.selectParam)}${tooMany}<div class="rl-scroll"><table class="table rl-table">
<thead><tr><th>Role</th><th>${table.column}</th><th>Ghi chú</th></tr></thead>
<tbody>${rows.map(row => roleRow(guild, table, row))}</tbody></table></div>`}
${table.key === "adminRoleIds" ? html`<label class="check rl-confirm"><input type="checkbox" name="${ADMIN_CONFIRM_FIELD}" value="1"> Khi thêm role admin bot: tôi hiểu mọi thành viên có role đó sẽ có <strong>toàn quyền quản trị bot</strong> (cấu hình, chỉnh và reset điểm, sao lưu). Chỉ cần tick khi có thêm role.</label>` : ""}
</section>`;
}

/**
 * Cảnh báo tự khoá quyền (PROP-034 chưa duyệt nên chỉ cảnh báo, không chặn): người đăng nhập không có Manage Server thì là admin
 * chỉ nhờ các role admin bot mình đang có (server đã kiểm tra là admin); bỏ hết các role đó khỏi danh sách làm họ mất quyền ngay.
 */
function lockoutWarning(ctx: GuildPageContext, adminRoleIds: readonly string[]): RawHtml | null
{
	if (ctx.member.permissions.has(PermissionFlagsBits.ManageGuild)) return null;
	const own = adminRoleIds.filter(roleId => ctx.member.roles.cache.has(roleId));
	return html`<div class="warn-box rl-lockout">⚠️ Bạn không có quyền Manage Server và đang là admin bot chỉ nhờ role admin bot
${own.map(roleId => roleChip(ctx.guild, roleId))}. Nếu bỏ ${own.length > 1 ? "hết các role này" : "role này"} khỏi danh sách role admin bot,
bạn sẽ <strong>mất quyền quản trị ngay lập tức</strong> (kể cả trang này), và chỉ người có Manage Server hoặc role admin bot khác mới khôi phục được.</div>`;
}

function renderRoles(ctx: GuildPageContext): WebResponse
{
	const { guildConfig, tierRoles } = ctx.deps.services;
	const settings = guildConfig.getSettings(ctx.guild.id);
	const tierRoleIds = new Set(tierRoles.list(ctx.guild.id).map(mapping => mapping.roleId));
	const body = html`${lockoutWarning(ctx, settings.adminRoleIds)}
<form method="post" action="${guildUrl(ctx, PATH)}">${csrfField(ctx)}
${GRANT_TABLES.map(table => grantSection(ctx, table, settings[table.key], tierRoleIds))}
<div class="actions"><button class="btn btn-primary" type="submit">💾 Lưu quyền</button></div>
</form>
<section class="card rl-notes"><h2>Ghi chú</h2><ul>
<li>Người có quyền <strong>Manage Server</strong> luôn là admin bot, dù đặt role nào.</li>
<li>Role admin muốn dùng lệnh <code>/admin</code>, <code>/config</code> trong Discord thì phải được cho phép trong
<strong>Server Settings → Integrations → chọn bot</strong>. Trang web này không cần bước đó.</li>
<li>Không chọn được @everyone, role do bot hoặc integration quản lý, và role danh hiệu (bot tự gán theo level). Mỗi danh sách tối đa ${MAX_GRANT_ROLES} role.</li>
<li>Bot chỉ lưu các ô bạn đổi so với lúc mở trang, nên không đè thay đổi của admin khác trong lúc bạn đang sửa.</li>
</ul></section>`;
	return renderPage(ctx, {
		nav: "roles",
		title: "Quyền",
		lead: "Ai quản trị được bot và ai được tạo vote. Mọi thay đổi được ghi vào nhật ký quản trị.",
		body,
	});
}

// ---------- POST ----------

interface GrantChange
{
	table: GrantTable;
	add: string[];
	remove: string[];
}

/**
 * Phần admin đổi ở một bảng, so với trạng thái lúc vẽ (input ẩn): role tick mà lúc vẽ chưa có là thêm (phải có trong server và
 * qua assertUsableRole), role bỏ tick mà lúc vẽ đang có là bỏ. Ô tick không có input ẩn tương ứng thì coi là form cũ.
 */
function readChange(ctx: GuildPageContext, form: URLSearchParams, table: GrantTable): GrantChange
{
	const drawn = new Map<string, boolean>();
	for (const [name, value] of form)
	{
		if (!name.startsWith(table.drawnPrefix)) continue;
		const roleId = name.slice(table.drawnPrefix.length);
		if (!SNOWFLAKE.test(roleId) || (value !== "0" && value !== "1")) throw new UserError(ROLES_STALE_FORM);
		drawn.set(roleId, value === "1");
	}
	const ticked = new Set(form.getAll(table.field));
	for (const roleId of ticked)
	{
		if (!drawn.has(roleId)) throw new UserError(ROLES_STALE_FORM);
	}
	const add = [...drawn].filter(([roleId, granted]) => !granted && ticked.has(roleId)).map(([roleId]) => roleId);
	const remove = [...drawn].filter(([roleId, granted]) => granted && !ticked.has(roleId)).map(([roleId]) => roleId);
	for (const roleId of add)
	{
		const role = ctx.guild.roles.cache.get(roleId);
		if (!role) throw new UserError(`Không tìm thấy role ${roleMention(roleId)} trong server (có thể vừa bị xoá). Hãy tải lại trang rồi thử lại.`);
		assertUsableRole(ctx.deps.services, ctx.guild.id, role, ROLE_GRANT_PURPOSES[table.key]);
	}
	return { table, add, remove };
}

/** Danh sách sau khi lưu không được quá MAX_GRANT_ROLES role (kiểm tra cả hai bảng trước khi ghi bảng nào, như changeRoleGrants). */
function assertWithinLimit(current: readonly string[], change: GrantChange): void
{
	const granted = new Set(current);
	const added = change.add.filter(roleId => !granted.has(roleId)).length;
	const size = current.length - change.remove.filter(roleId => granted.has(roleId)).length + added;
	if (added > 0 && size > MAX_GRANT_ROLES)
	{
		throw new UserError(`Chỉ được đặt tối đa ${MAX_GRANT_ROLES} ${change.table.name}: đang có ${current.length} role, lưu thay đổi này sẽ `
			+ `thành ${size} role. Hãy bỏ tick bớt. Bot chưa thay đổi gì.`);
	}
}

function saveRoles(ctx: GuildPageContext): WebResponse
{
	const form = ctx.req.form ?? new URLSearchParams();
	const { guildConfig } = ctx.deps.services;
	const changes = GRANT_TABLES.map(table => readChange(ctx, form, table)).filter(change => change.add.length > 0 || change.remove.length > 0);
	if (changes.length === 0) return redirectWithFlash(ctx, PATH, "ok", ROLES_UNCHANGED);

	const addsAdmin = changes.some(change => change.table.key === "adminRoleIds" && change.add.length > 0);
	if (addsAdmin && form.get(ADMIN_CONFIRM_FIELD) !== "1") throw new UserError(ADMIN_CONFIRM_REQUIRED);
	const settings = guildConfig.getSettings(ctx.guild.id);
	for (const change of changes) assertWithinLimit(settings[change.table.key], change);
	const results: [GrantTable, RoleGrantResult][] = changes.map(change => [
		change.table,
		guildConfig.changeRoleGrants(ctx.guild.id, change.table.key, { add: change.add, remove: change.remove }, ctx.actorId),
	]);

	const changed = results.some(([, result]) => roleGrantChanged(result));
	const lines = [changed ? "Đã cập nhật quyền:" : ROLES_UNCHANGED, ...results.flatMap(([table, result]) => roleGrantChangeLines(table.key, result))];
	if (results.some(([table, result]) => table.key === "adminRoleIds" && result.added.length > 0)) lines.push(ADMIN_ROLE_INTEGRATION_NOTE);
	return redirectWithFlash(ctx, PATH, "ok", lines.join("\n"));
}

export const rolesPage: PageModule = {
	routes: [
		{ method: "GET", path: PATH, handler: renderRoles },
		{ method: "POST", path: PATH, handler: saveRoles },
	],
	css: `
.rl-hint { font-size: 13px; margin: 0 0 8px; }
.rl-confirm { margin-top: 12px; }
.rl-chips .chip { margin: 2px 6px 2px 0; }
.rl-scroll { overflow-x: auto; }
.rl-table td label { cursor: pointer; }
.rl-note { color: var(--muted); font-size: 13px; }
.rl-lockout { background: var(--err-bg); border-color: #f5c2bf; font-weight: 600; margin-bottom: 18px; }
.rl-notes ul { margin: 0; padding-left: 20px; }
.rl-notes li + li { margin-top: 6px; }
`,
};
