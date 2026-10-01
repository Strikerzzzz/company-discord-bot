// Trang "Cài đặt retro" của web quản trị (DEC-041, DEC-049), nằm dưới mục Retro: XP khi điền retro, XP cho người đề xuất tên sprint
// được chọn, thời hạn vote tên sprint, và role quản lý retro (bảng ô tick như trang Quyền). Không có lệnh Discord tương ứng: đây là nơi
// duy nhất đổi các cài đặt này. Hai form riêng để một lần lưu không ghi dở: mỗi form mang giá trị lúc vẽ trong input ẩn và chỉ ghi phần
// admin thật sự đổi (như /config panel), nên hai admin hay hai tab không đè nhau. Bảng role quản lý KHÔNG có "Chọn tất cả": role trong
// danh sách được tạo phiên và quản lý mọi phiên retro (như bảng role admin bot, review bảo mật Phase 18). Role thêm vào phải qua
// assertUsableRole của configOps (không phải @everyone, role do integration quản lý, role danh hiệu).
import { assertUsableRole } from "../../discord/configOps";
import { formatNumber, roleMention } from "../../discord/format";
import {
	DEFAULT_RETRO_CONFIG,
	ManagerRoleResult,
	RETRO_CONFIG_KEYS,
	RETRO_CONFIG_LIMITS,
	RETRO_LIMITS,
	RetroConfig,
	RetroConfigKey,
} from "../../modules/retro/types";
import { UserError } from "../../shared/errors";
import { roleChip, sortedRoles } from "../format";
import { html, RawHtml } from "../html";
import { WebResponse } from "../http";
import { csrfField, guildUrl, redirectWithFlash, renderPage } from "../layout";
import { GuildPageContext, PageModule } from "../types";
import { isSnowflake } from "../widgets";
import { blockedReason, MISSING_ROLE_NOTE } from "./roles";

/** Trang cài đặt retro (GET) và nơi lưu XP, thời hạn vote (POST). */
export const RETRO_SETTINGS_PATH = "/retro/settings";
const ROLES_PATH = `${RETRO_SETTINGS_PATH}/roles`;
const DRAWN_PREFIX = "d:";
const ROLE_FIELD = "quan-ly";
const ROLE_DRAWN_PREFIX = "m:";
const NUMBER_TEXT = /^\d{1,9}$/u;

/** Việc của role quản lý retro trong thông báo lỗi của assertUsableRole. */
export const RETRO_MANAGER_ROLE_PURPOSE = "làm role quản lý retro";
export const RETRO_SETTINGS_STALE_FORM = "Form đã cũ hoặc không hợp lệ, nên bot chưa lưu gì. Hãy tải lại trang rồi thử lại.";
export const RETRO_SETTINGS_UNCHANGED = "Không có gì thay đổi.";

/** Ý nghĩa của từng ô số, hiện dưới ô cùng khoảng hợp lệ. */
const NUMBER_HINTS: Readonly<Record<RetroConfigKey, string>> = {
	fillXp: "Cộng một lần mỗi phiên cho người điền (sửa câu trả lời không được cộng thêm). 0 = không cộng.",
	proposerBonusXp: "Cộng cho mỗi người đã đề xuất tên sprint được chọn (thắng vote, hoặc được người quản lý chọn khi hoà). 0 = không cộng.",
	voteMinutes: "Vote tên sprint tự đóng sau số phút này (mặc định 1440 = 24 giờ). Người tham gia vote được XP như vote thường.",
};

function drawnName(key: string): string
{
	return `${DRAWN_PREFIX}${key}`;
}

function numberField(key: RetroConfigKey, value: number): RawHtml
{
	const { min, max, label } = RETRO_CONFIG_LIMITS[key];
	const id = `rt-cfg-${key}`;
	return html`<div class="field">
<label for="${id}">${label}</label>
<input type="number" id="${id}" name="${key}" value="${value}" min="${min}" max="${max}" step="1" required>
<input type="hidden" name="${drawnName(key)}" value="${value}">
<span class="hint">${NUMBER_HINTS[key]} Từ ${formatNumber(min)} đến ${formatNumber(max)}; mặc định ${formatNumber(DEFAULT_RETRO_CONFIG[key])}.</span>
</div>`;
}

function numbersCard(ctx: GuildPageContext, config: RetroConfig): RawHtml
{
	return html`<section class="card"><h2>⭐ XP và vote tên sprint</h2>
<form method="post" action="${guildUrl(ctx, RETRO_SETTINGS_PATH)}">${csrfField(ctx)}
${RETRO_CONFIG_KEYS.map(key => numberField(key, config[key]))}
<div class="actions"><button class="btn btn-primary" type="submit">💾 Lưu XP và thời hạn</button>
<span class="muted">Chỉ ô bạn sửa mới được lưu. XP retro ghi vào Activity XP với nguồn "admin", người thao tác là bot.</span></div>
</form></section>`;
}

interface RoleRow
{
	roleId: string;
	granted: boolean;
	reason: string | null;
}

/** Các dòng của bảng: role của server theo vị trí, rồi role đã lưu mà không còn trong server (bỏ tick được để gỡ). */
function roleRows(ctx: GuildPageContext, roleIds: readonly string[]): RoleRow[]
{
	const { guild } = ctx;
	const tierRoleIds = new Set(ctx.deps.services.tierRoles.list(guild.id).map(mapping => mapping.roleId));
	const granted = new Set(roleIds);
	const gone = roleIds.filter(roleId => !guild.roles.cache.has(roleId));
	return [
		...sortedRoles(guild).map(role => ({ roleId: role.id, granted: granted.has(role.id), reason: blockedReason(role, tierRoleIds) })),
		...gone.map(roleId => ({ roleId, granted: true, reason: blockedReason(undefined, tierRoleIds) })),
	];
}

function roleRow(ctx: GuildPageContext, row: RoleRow): RawHtml
{
	const id = `rt-mgr-${row.roleId}`;
	const inGuild = ctx.guild.roles.cache.has(row.roleId);
	let note = "";
	if (row.reason !== null && inGuild) note = `${row.reason}: ${row.granted ? "vẫn bỏ được, nhưng không thêm lại được." : "không dùng được."}`;
	else if (row.reason !== null) note = MISSING_ROLE_NOTE;
	return html`<tr>
<td><label for="${id}">${roleChip(ctx.guild, row.roleId)}</label><input type="hidden" name="${ROLE_DRAWN_PREFIX}${row.roleId}" value="${row.granted ? 1 : 0}"></td>
<td><input type="checkbox" id="${id}" name="${ROLE_FIELD}" value="${row.roleId}"${row.granted ? html` checked` : ""}${row.reason !== null && !row.granted ? html` disabled` : ""}></td>
<td class="rt-note">${note}</td>
</tr>`;
}

function rolesCard(ctx: GuildPageContext, config: RetroConfig): RawHtml
{
	const rows = roleRows(ctx, config.managerRoleIds);
	const current = config.managerRoleIds.length === 0
		? html`<p class="muted">Chưa đặt role nào: chỉ admin bot (và người tạo phiên, với phiên của mình) quản lý được retro.</p>`
		: html`<p class="rt-chips">${config.managerRoleIds.map(roleId => roleChip(ctx.guild, roleId))}</p>`;
	const table = rows.length === 0
		? html`<p class="muted">Server chưa có role nào ngoài @everyone.</p>`
		: html`<div class="rt-scroll"><table class="table rt-roles">
<thead><tr><th>Role</th><th>Quản lý retro</th><th>Ghi chú</th></tr></thead>
<tbody>${rows.map(row => roleRow(ctx, row))}</tbody></table></div>`;
	return html`<section class="card"><h2>🛡️ Role quản lý retro: ${config.managerRoleIds.length}/${RETRO_LIMITS.managerRolesMax}</h2>
<p class="muted rs-hint">Người có ít nhất một role trong danh sách tạo được phiên retro (bot đăng tin thay họ) và quản lý mọi phiên: đóng, mở lại, gia hạn,
nhắc, tạo vote tên sprint, chọn tên khi hoà, ghi lại Confluence. Họ không xem được danh sách người đã điền: chỉ admin bot thấy. Bảng này không có
"Chọn tất cả" để không lỡ tay biến mọi role thành người quản lý.</p>
${current}
<form method="post" action="${guildUrl(ctx, ROLES_PATH)}">${csrfField(ctx)}
${table}
<div class="actions"><button class="btn btn-primary" type="submit">💾 Lưu role quản lý retro</button>
<span class="muted">Chỉ các ô bạn đổi mới được lưu.</span></div>
</form></section>`;
}

function renderSettings(ctx: GuildPageContext): WebResponse
{
	const config = ctx.deps.services.retro.getConfig(ctx.guild.id);
	return renderPage(ctx, {
		nav: "retro",
		title: "Cài đặt retro",
		lead: "XP của retro sprint và ai quản lý được phiên retro (DEC-049). Mọi thay đổi được ghi vào nhật ký quản trị.",
		body: html`<p><a href="${guildUrl(ctx, "/retro")}">← Danh sách phiên retro</a></p>
${numbersCard(ctx, config)}
${rolesCard(ctx, config)}`,
	});
}

/** Số admin nhập ở ô `key`: chỉ chữ số (khoảng hợp lệ do RetroService kiểm tra). */
function enteredNumber(form: URLSearchParams, key: RetroConfigKey): number
{
	const text = (form.get(key) ?? "").trim();
	const { min, max, label } = RETRO_CONFIG_LIMITS[key];
	if (!NUMBER_TEXT.test(text)) throw new UserError(`${label} phải là số nguyên từ ${min} đến ${max}.`);
	return Number(text);
}

function drawnNumber(form: URLSearchParams, key: RetroConfigKey): number
{
	const text = form.get(drawnName(key)) ?? "";
	if (!NUMBER_TEXT.test(text)) throw new UserError(RETRO_SETTINGS_STALE_FORM);
	return Number(text);
}

function saveNumbers(ctx: GuildPageContext): WebResponse
{
	const form = ctx.req.form ?? new URLSearchParams();
	const patch: Partial<Record<RetroConfigKey, number>> = {};
	for (const key of RETRO_CONFIG_KEYS)
	{
		const value = enteredNumber(form, key);
		if (value !== drawnNumber(form, key)) patch[key] = value;
	}
	const changed = RETRO_CONFIG_KEYS.filter(key => patch[key] !== undefined);
	if (changed.length === 0) return redirectWithFlash(ctx, RETRO_SETTINGS_PATH, "ok", RETRO_SETTINGS_UNCHANGED);

	const { retro } = ctx.deps.services;
	const before = retro.getConfig(ctx.guild.id);
	const after = retro.updateConfig(ctx.guild.id, patch, ctx.actorId);
	const lines = changed.map(key => `${RETRO_CONFIG_LIMITS[key].label}: ${formatNumber(before[key])} → **${formatNumber(after[key])}**`);
	return redirectWithFlash(ctx, RETRO_SETTINGS_PATH, "ok", ["Đã cập nhật cài đặt retro:", ...lines].join("\n"));
}

/**
 * Phần admin đổi ở bảng role, so với lúc vẽ (input ẩn): role tick mà lúc vẽ chưa có là thêm (phải có trong server và qua
 * assertUsableRole), role bỏ tick mà lúc vẽ đang có là bỏ. Ô tick không có input ẩn tương ứng thì coi là form cũ.
 */
function readRoleChange(ctx: GuildPageContext, form: URLSearchParams): { add: string[]; remove: string[] }
{
	const drawn = new Map<string, boolean>();
	for (const [name, value] of form)
	{
		if (!name.startsWith(ROLE_DRAWN_PREFIX)) continue;
		const roleId = name.slice(ROLE_DRAWN_PREFIX.length);
		if (!isSnowflake(roleId) || (value !== "0" && value !== "1")) throw new UserError(RETRO_SETTINGS_STALE_FORM);
		drawn.set(roleId, value === "1");
	}
	const ticked = new Set(form.getAll(ROLE_FIELD));
	for (const roleId of ticked)
	{
		if (!drawn.has(roleId)) throw new UserError(RETRO_SETTINGS_STALE_FORM);
	}
	const add = [...drawn].filter(([roleId, granted]) => !granted && ticked.has(roleId)).map(([roleId]) => roleId);
	const remove = [...drawn].filter(([roleId, granted]) => granted && !ticked.has(roleId)).map(([roleId]) => roleId);
	for (const roleId of add)
	{
		const role = ctx.guild.roles.cache.get(roleId);
		if (!role) throw new UserError(`Không tìm thấy role ${roleMention(roleId)} trong server (có thể vừa bị xoá). Hãy tải lại trang rồi thử lại.`);
		assertUsableRole(ctx.deps.services, ctx.guild.id, role, RETRO_MANAGER_ROLE_PURPOSE);
	}
	return { add, remove };
}

function roleChangeLines(result: ManagerRoleResult): string[]
{
	const mentions = (roleIds: readonly string[]): string => roleIds.map(roleMention).join(", ");
	const lines: string[] = [];
	if (result.added.length > 0) lines.push(`Đã thêm ${mentions(result.added)} vào danh sách role quản lý retro.`);
	if (result.removed.length > 0) lines.push(`Đã bỏ ${mentions(result.removed)} khỏi danh sách role quản lý retro.`);
	lines.push(`Role quản lý retro: ${result.roleIds.length === 0 ? "chưa đặt" : mentions(result.roleIds)}`);
	return lines;
}

function saveRoles(ctx: GuildPageContext): WebResponse
{
	const change = readRoleChange(ctx, ctx.req.form ?? new URLSearchParams());
	if (change.add.length === 0 && change.remove.length === 0) return redirectWithFlash(ctx, RETRO_SETTINGS_PATH, "ok", RETRO_SETTINGS_UNCHANGED);
	const result = ctx.deps.services.retro.changeManagerRoles(ctx.guild.id, change, ctx.actorId);
	const changed = result.added.length > 0 || result.removed.length > 0;
	const lines = [changed ? "Đã cập nhật role quản lý retro:" : RETRO_SETTINGS_UNCHANGED, ...roleChangeLines(result)];
	return redirectWithFlash(ctx, RETRO_SETTINGS_PATH, "ok", lines.join("\n"));
}

export const retroSettingsPage: PageModule = {
	routes: [
		{ method: "GET", path: RETRO_SETTINGS_PATH, handler: renderSettings },
		{ method: "POST", path: RETRO_SETTINGS_PATH, handler: saveNumbers },
		{ method: "POST", path: ROLES_PATH, handler: saveRoles },
	],
	css: `
.rs-hint { font-size: 13px; margin: 0 0 8px; }
.rt-chips .chip { margin: 2px 6px 2px 0; }
.rt-scroll { overflow-x: auto; }
.rt-roles td label { cursor: pointer; }
.rt-note { color: var(--muted); font-size: 13px; }
`,
};
