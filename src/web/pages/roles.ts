// Trang "Quyền" của web quản trị (DEC-039): role admin bot và role được tạo vote. Cùng quy tắc với `/config admin-role`,
// `/config poll role-tao-vote` và ô chọn role của `/config panel` (panelSettingRole): role phải dùng được (assertUsableRole),
// bỏ role chỉ khi role hiện tại vẫn là role lúc vẽ trang; kiểm tra cả hai ô rồi mới ghi một lần.
import { PermissionFlagsBits, Role } from "discord.js";
import { assertUsableRole } from "../../discord/configOps";
import { describeSettingsPatch } from "../../discord/views/admin";
import { GuildSettings } from "../../modules/guild-config/types";
import { UserError } from "../../shared/errors";
import { roleChip, sortedRoles } from "../format";
import { html, RawHtml } from "../html";
import { WebResponse } from "../http";
import { csrfField, guildUrl, redirectWithFlash, renderPage } from "../layout";
import { GuildPageContext, PageModule } from "../types";

const PATH = "/roles";
const DRAWN_PREFIX = "d:";
const SNOWFLAKE = /^\d{17,20}$/u;

export const ROLES_STALE_FORM = "Form đã cũ hoặc không hợp lệ, nên bot chưa lưu gì. Hãy tải lại trang rồi thử lại.";
export const ROLES_UNCHANGED = "Không có gì thay đổi.";
export const ROLE_NOT_FOUND = "Không tìm thấy role vừa chọn trong server (có thể role vừa bị xoá). Hãy tải lại trang rồi chọn lại.";
export const MISSING_ROLE_OPTION = "(không còn trong server)";
const ADMIN_ROLE_INTEGRATION_NOTE = "-# Muốn role này dùng lệnh `/admin`, `/config` trong Discord thì cho phép trong "
	+ "**Server Settings → Integrations → chọn bot**; trang web không cần bước này.";

type RoleKey = "adminRoleId" | "pollCreatorRoleId";

interface RoleSetting
{
	key: RoleKey;
	title: string;
	/** Tên mục trong thông báo, ví dụ "Role admin bot". */
	name: string;
	/** Việc của role trong thông báo lỗi, giống lệnh gõ tương ứng ("làm role admin bot"). */
	purpose: string;
	hint: string;
}

const ROLE_SETTINGS: readonly RoleSetting[] = [
	{
		key: "adminRoleId",
		title: "🔐 Role admin bot",
		name: "Role admin bot",
		purpose: "làm role admin bot",
		hint: "Người có role này quản trị được bot: dùng trang web này, và dùng lệnh /admin, /config nếu server cho phép (xem ghi chú).",
	},
	{
		key: "pollCreatorRoleId",
		title: "🗳️ Role được tạo vote",
		name: "Role tạo vote",
		purpose: "làm role tạo vote",
		hint: "Người có role này tạo được vote. Không đặt thì chỉ admin tạo được vote; admin luôn tạo được.",
	},
];

function drawnName(key: string): string
{
	return `${DRAWN_PREFIX}${key}`;
}

/** Vì sao role đang lưu không dùng được nữa; null nếu dùng được hoặc chưa đặt. */
type RoleProblem = "missing" | "managed" | "tier";

function roleProblem(role: Role | undefined, roleId: string | null, tierRoleIds: ReadonlySet<string>): RoleProblem | null
{
	if (roleId === null) return null;
	if (!role) return "missing";
	if (role.managed) return "managed";
	return tierRoleIds.has(role.id) ? "tier" : null;
}

function problemOptionLabel(problem: RoleProblem, role: Role | undefined, roleId: string): string
{
	switch (problem)
	{
	case "missing": return `Role đã lưu, ID ${roleId} ${MISSING_ROLE_OPTION}`;
	case "managed": return `@${role?.name ?? roleId} (role do bot hoặc integration quản lý, không dùng được)`;
	case "tier": return `@${role?.name ?? roleId} (role danh hiệu, không dùng được)`;
	}
}

function problemWarning(problem: RoleProblem): string
{
	switch (problem)
	{
	case "missing": return "⚠️ Role đã lưu không còn trong server. Hãy chọn role khác, hoặc chọn \"— Không đặt —\".";
	case "managed": return "⚠️ Role đang đặt do bot hoặc integration quản lý, không gán được cho thành viên. Hãy chọn role khác.";
	case "tier": return "⚠️ Role đang đặt là role danh hiệu: bot tự thêm và gỡ role này theo level. Hãy chọn role khác.";
	}
}

function roleField(ctx: GuildPageContext, setting: RoleSetting, current: string | null, usable: readonly Role[], tierRoleIds: ReadonlySet<string>): RawHtml
{
	const currentRole = current === null ? undefined : ctx.guild.roles.cache.get(current);
	const problem = roleProblem(currentRole, current, tierRoleIds);
	const id = `rl-${setting.key}`;
	const selected = html` selected`;
	const options = [
		html`<option value=""${current === null ? selected : ""}>— Không đặt —</option>`,
		problem !== null && current !== null ? html`<option value="${current}" selected>${problemOptionLabel(problem, currentRole, current)}</option>` : "",
		usable.map(role => html`<option value="${role.id}"${role.id === current ? selected : ""}>@${role.name}</option>`),
	];
	return html`<div class="field rl-field">
<label for="${id}">${setting.title}</label>
<div class="muted">Hiện tại: ${current === null ? "chưa đặt" : roleChip(ctx.guild, current)}</div>
<select id="${id}" name="${setting.key}">${options}</select>
<input type="hidden" name="${drawnName(setting.key)}" value="${current ?? ""}">
<span class="hint">${setting.hint}</span>
${problem !== null ? html`<div class="warn-box">${problemWarning(problem)}</div>` : ""}
</div>`;
}

/**
 * Cảnh báo tự khoá quyền (PROP-034 chưa duyệt nên chỉ cảnh báo, không chặn): người đăng nhập không có Manage Server thì là admin
 * chỉ nhờ role admin bot (server đã kiểm tra là admin), nên đổi hoặc bỏ role đó làm họ mất quyền ngay.
 */
function lockoutWarning(ctx: GuildPageContext, adminRoleId: string | null): RawHtml | null
{
	if (ctx.member.permissions.has(PermissionFlagsBits.ManageGuild)) return null;
	return html`<div class="warn-box rl-lockout">⚠️ Bạn không có quyền Manage Server và đang là admin bot chỉ nhờ role admin bot
${adminRoleId === null ? "" : roleChip(ctx.guild, adminRoleId)}. Nếu đổi role admin bot sang role bạn không có, hoặc bỏ role admin bot,
bạn sẽ <strong>mất quyền quản trị ngay lập tức</strong> (kể cả trang này), và chỉ người có Manage Server mới khôi phục được.</div>`;
}

function renderRoles(ctx: GuildPageContext): WebResponse
{
	const { guildConfig, tierRoles } = ctx.deps.services;
	const settings = guildConfig.getSettings(ctx.guild.id);
	const tierRoleIds = new Set(tierRoles.list(ctx.guild.id).map(mapping => mapping.roleId));
	const usable = sortedRoles(ctx.guild).filter(role => !role.managed && !tierRoleIds.has(role.id));
	const body = html`${lockoutWarning(ctx, settings.adminRoleId)}
<form method="post" action="${guildUrl(ctx, PATH)}" class="card rl-form">${csrfField(ctx)}
${ROLE_SETTINGS.map(setting => roleField(ctx, setting, settings[setting.key], usable, tierRoleIds))}
<div class="actions"><button class="btn btn-primary" type="submit">Lưu quyền</button></div>
</form>
<section class="card rl-notes"><h2>Ghi chú</h2><ul>
<li>Người có quyền <strong>Manage Server</strong> luôn là admin bot, dù đặt role nào.</li>
<li>Role admin muốn dùng lệnh <code>/admin</code>, <code>/config</code> trong Discord thì phải được cho phép trong
<strong>Server Settings → Integrations → chọn bot</strong>. Trang web này không cần bước đó.</li>
<li>Danh sách không có @everyone, role do bot hoặc integration quản lý, và role danh hiệu (bot tự gán theo level).</li>
</ul></section>`;
	return renderPage(ctx, {
		nav: "roles",
		title: "Quyền",
		lead: "Ai quản trị được bot và ai được tạo vote. Mọi thay đổi được ghi vào nhật ký quản trị.",
		body,
	});
}

/**
 * Giá trị mới của một ô chọn role; undefined = không đổi. Chỉ xét ô khác giá trị lúc vẽ; bỏ role chỉ khi role hiện tại vẫn là
 * role lúc vẽ (như panelSettingRole), để trang cũ không xoá role vừa được người khác đặt.
 */
function roleChoice(ctx: GuildPageContext, form: URLSearchParams, setting: RoleSetting, current: string | null): string | null | undefined
{
	const selected = form.get(setting.key);
	const drawn = form.get(drawnName(setting.key));
	if (selected === null || drawn === null || (drawn !== "" && !SNOWFLAKE.test(drawn))) throw new UserError(ROLES_STALE_FORM);
	if (selected === drawn) return undefined;
	if (selected === "")
	{
		if (current !== drawn)
		{
			throw new UserError(`${setting.name} vừa được đổi ở nơi khác sau khi bạn mở trang, nên bot chưa lưu gì. Hãy tải lại trang, kiểm tra rồi thao tác lại.`);
		}
		return null;
	}
	const role = ctx.guild.roles.cache.get(selected);
	if (!role) throw new UserError(ROLE_NOT_FOUND);
	assertUsableRole(ctx.deps.services, ctx.guild.id, role, setting.purpose);
	return role.id === current ? undefined : role.id;
}

function saveRoles(ctx: GuildPageContext): WebResponse
{
	const form = ctx.req.form ?? new URLSearchParams();
	const { guildConfig } = ctx.deps.services;
	const settings = guildConfig.getSettings(ctx.guild.id);
	const patch: Partial<GuildSettings> = {};
	for (const setting of ROLE_SETTINGS)
	{
		const value = roleChoice(ctx, form, setting, settings[setting.key]);
		if (value !== undefined) patch[setting.key] = value;
	}
	if (Object.keys(patch).length === 0) return redirectWithFlash(ctx, PATH, "ok", ROLES_UNCHANGED);

	guildConfig.updateSettings(ctx.guild.id, patch, ctx.actorId);
	const lines = ["Đã cập nhật quyền:", ...describeSettingsPatch(patch)];
	if (patch.adminRoleId) lines.push(ADMIN_ROLE_INTEGRATION_NOTE);
	return redirectWithFlash(ctx, PATH, "ok", lines.join("\n"));
}

export const rolesPage: PageModule = {
	routes: [
		{ method: "GET", path: PATH, handler: renderRoles },
		{ method: "POST", path: PATH, handler: saveRoles },
	],
	css: `
.rl-field select { min-width: 280px; }
.rl-field + .rl-field { margin-top: 22px; }
.rl-lockout { background: var(--err-bg); border-color: #f5c2bf; font-weight: 600; margin-bottom: 18px; }
.rl-notes ul { margin: 0; padding-left: 20px; }
.rl-notes li + li { margin-top: 6px; }
`,
};
