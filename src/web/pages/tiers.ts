// Trang "Danh hiệu" của web quản trị (DEC-039; DEC-031, DEC-033): chọn bộ danh hiệu, đổi tên bậc, gán role theo bậc, tạo/đồng
// bộ role. Nghiệp vụ giống hệt bảng `/config tier panel` trong Discord: cùng service, cùng hàm của tierRoleSetup, cùng cách chống
// ghi đè khi hai admin cùng mở trang (bộ lúc vẽ, dấu vân tay tên từng nhóm bậc, role lúc vẽ của từng bậc).
import { Guild, PermissionFlagsBits, Role } from "discord.js";
import { renameInput } from "../../discord/configOps";
import { formatNumber, roleMention } from "../../discord/format";
import { tierRoleSafetyIssue } from "../../discord/roleSync";
import {
	assignTierRole,
	BOT_MEMBER_UNAVAILABLE,
	callerManageRolesIssue,
	callerRoleIssue,
	clearTierRoleAssignment,
	otherRoleUsageIssue,
	syncTierSetRoles,
	TierRoleActor,
	tierRoleActor,
	TierRoleAssignment,
} from "../../discord/tierRoleSetup";
import {
	buildTierSetupReport,
	TIER_ROLE_DEDICATED_NOTE,
	TIER_ROLE_SYNC_NOTE,
	tierDisplayName,
	TierNameGroup,
	tierNamesFingerprint,
	tierRoleClearedText,
	tierTitle,
} from "../../discord/views/tierPanel";
import {
	applyTierOverrides,
	isTierSetKey,
	Tier,
	TIER_KEYS,
	TIER_SET_KEYS,
	TIER_SETS,
	TierKey,
	tierByKey,
	TierSet,
} from "../../modules/activity/tiers";
import { TIER_NAME_MAX } from "../../modules/gamification/TierSetService";
import { TierRoleMapping } from "../../modules/gamification/types";
import { UserError } from "../../shared/errors";
import { logger } from "../../shared/logger";
import { discordText, roleChip, roleLabel, sortedRoles } from "../format";
import { html, RawHtml } from "../html";
import { redirect, WebResponse } from "../http";
import { csrfField, guildUrl, redirectWithFlash, renderPage } from "../layout";
import { GuildPageContext, GuildRoute, PageModule } from "../types";

const PAGE_PATH = "/tiers";
const SET_PATH = "/tiers/set";
const NAMES_PATH = "/tiers/names";
const RESET_PATH = "/tiers/reset-names";
const ROLES_PATH = "/tiers/roles";
const SETUP_PATH = "/tiers/setup";

/** Độ dài tối đa (UTF-16) của ô tên bậc, bằng ô nhập của form đổi tên trong Discord (NAME_INPUT_MAX của tierPanel.ts). */
const NAME_INPUT_MAX = 72;
const NAME_GROUPS: readonly TierNameGroup[] = [1, 2];
const SNOWFLAKE = /^\d{17,20}$/u;

const LATEST_SHOWN = "Trang đã hiển thị dữ liệu mới nhất; hãy kiểm tra rồi thao tác lại nếu vẫn muốn.";
export const FORM_INVALID = "Form không hợp lệ hoặc đã cũ. Hãy tải lại trang rồi thử lại.";
export const INVALID_TIER_SET = "Bộ danh hiệu không hợp lệ.";
export const SET_CHANGED = `Bộ danh hiệu vừa được đổi ở nơi khác sau khi trang được tải, nên bot chưa lưu gì. ${LATEST_SHOWN}`;
export const NAMES_SET_CHANGED = `Bộ danh hiệu vừa được đổi sau khi trang được tải, nên bot chưa lưu tên nào. ${LATEST_SHOWN}`;
export const NAMES_CHANGED = `Tên bậc vừa được đổi ở nơi khác sau khi trang được tải, nên bot chưa lưu gì để không ghi đè. ${LATEST_SHOWN}`;
export const RESET_SET_CHANGED = `Bộ danh hiệu vừa được đổi sau khi trang được tải, nên bot chưa khôi phục tên nào. ${LATEST_SHOWN}`;
export const NAME_TOO_LONG = `Tên dài quá ${NAME_INPUT_MAX} ký tự. Bot chưa lưu tên nào.`;
export const ROLE_CHANGED = `Role của bậc này vừa được đổi ở nơi khác sau khi trang được tải. ${LATEST_SHOWN}`;
export const SELECTED_ROLE_UNAVAILABLE = "Không tìm thấy role vừa chọn trong server. Hãy tải lại trang rồi chọn lại.";
export const DUPLICATE_ROLE = "Mỗi role chỉ gán được cho một bậc, nhưng bạn đang chọn cùng một role cho nhiều bậc. Bot chưa lưu gì.";
/** Dòng cuối của lỗi lưu role khi bot chưa ghi gì (mọi lỗi ở giai đoạn kiểm tra: bot kiểm tra hết các bậc rồi mới ghi). */
export const NOTHING_SAVED = "Bot chưa lưu thay đổi nào.";
export const NO_CHANGE = "Không có gì thay đổi";
const MANAGE_ROLES_WARNING = "⚠️ Bot chưa có quyền **Manage Roles** nên chưa gán được role. "
	+ "Hãy cấp quyền này cho role của bot và kéo role của bot lên trên các role danh hiệu (Server Settings → Roles).";
export const SETUP_ROLES_HINT = "Tên và màu các role đã gán chưa đổi: bấm **✨ Tạo/đồng bộ role** ở cuối trang để bot đổi theo "
	+ "(bot chỉ đổi tên role do bot tạo; role do admin tự gán giữ nguyên tên).";
const UNEXPECTED_ERROR = "Đã có lỗi xảy ra. Vui lòng thử lại sau.";

const TIERS_CSS = `
.tr-sets { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.tr-set { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); cursor: pointer; }
.tr-set:hover { border-color: var(--brand); }
.tr-set:has(input:checked) { border-color: var(--brand); background: #eef0fb; box-shadow: inset 0 0 0 1px var(--brand); }
.tr-set input { margin-top: 3px; flex-shrink: 0; }
.tr-set-body { display: flex; flex-direction: column; gap: 3px; }
.tr-set-name { font-weight: 700; }
.tr-set-desc { color: var(--muted); font-size: 13px; }
.tr-set-tiers { font-size: 13px; }
.tr-name-input { width: 100%; max-width: 360px; }
.tr-role-select { width: 100%; max-width: 300px; }
.tr-hint { color: var(--muted); font-size: 13px; margin-top: 2px; }
.tr-note { color: var(--muted); font-size: 13px; margin: 4px 0; }
`;

// ---------- Tiện ích ----------

function formOf(ctx: GuildPageContext): URLSearchParams
{
	const form = ctx.req.form;
	if (!form) throw new UserError(FORM_INVALID);
	return form;
}

/** Giá trị một ô của form; thiếu ô (form cũ hoặc bị sửa) thì UserError. */
function field(form: URLSearchParams, name: string): string
{
	const value = form.get(name);
	if (value === null) throw new UserError(FORM_INVALID);
	return value;
}

/** Ô role của form: rỗng = chưa gán; còn lại phải là ID Discord. */
function roleField(form: URLSearchParams, name: string): string | null
{
	const value = field(form, name);
	if (value === "") return null;
	if (!SNOWFLAKE.test(value)) throw new UserError(FORM_INVALID);
	return value;
}

/** Bậc mặc định (chưa áp tên tuỳ chỉnh) cùng vị trí trong bộ. */
function defaultTier(set: TierSet, tierKey: TierKey): Tier
{
	return tierByKey(tierKey, TIER_SETS[set.key]);
}

/** Bộ có bậc nào đang dùng tên hoặc emoji khác mặc định không (như nút "↺ Tên mặc định" của bảng Discord). */
function hasCustomNames(set: TierSet): boolean
{
	return set.tiers.some(tier => tierDisplayName(tier) !== tierDisplayName(defaultTier(set, tier.key)));
}

function assignedRole(mappings: readonly TierRoleMapping[], tierKey: TierKey): string | null
{
	return mappings.find(mapping => mapping.tierKey === tierKey)?.roleId ?? null;
}

/** "Bậc 3 · 🟡 Kim Đan", dùng trong thông báo lỗi và kết quả. */
function tierLabel(tier: Tier): string
{
	return `Bậc ${tier.index + 1} · ${tier.emoji} ${tier.name}`;
}

function unique(lines: readonly string[]): string[]
{
	return [...new Set(lines)];
}

// ---------- Trang (GET) ----------

function setSection(ctx: GuildPageContext, set: TierSet): RawHtml
{
	const { tierSets } = ctx.deps.services;
	const cards = TIER_SET_KEYS.map(key =>
	{
		const option = applyTierOverrides(TIER_SETS[key], tierSets.overrides(ctx.guild.id, key));
		const current = key === set.key;
		const names = option.tiers.map(tier => `${tier.emoji} ${tier.name}`).join(" → ");
		return html`<label class="tr-set"><input type="radio" name="set" value="${key}"${current ? html` checked` : ""}>
<span class="tr-set-body"><span class="tr-set-name">${option.name}${current ? html` <span class="badge ok">Đang dùng</span>` : ""}</span>
<span class="tr-set-desc">${option.description}</span><span class="tr-set-tiers">${names}</span></span></label>`;
	});
	return html`<section class="card"><h2>🎭 Bộ danh hiệu</h2>
<p class="muted">Mọi bộ có 8 bậc cùng mốc level. Đổi bộ chỉ đổi tên, emoji, màu và giọng văn thông báo; role đã gán theo bậc được giữ nguyên, tên bậc tuỳ chỉnh lưu riêng cho từng bộ.</p>
<form method="post" action="${guildUrl(ctx, SET_PATH)}">${csrfField(ctx)}<input type="hidden" name="drawnSet" value="${set.key}">
<div class="tr-sets">${cards}</div>
<div class="actions"><button class="btn btn-primary" type="submit">Lưu bộ danh hiệu</button></div></form></section>`;
}

function namesSection(ctx: GuildPageContext, set: TierSet): RawHtml
{
	const rows = set.tiers.map(tier =>
	{
		const id = `tr-name-${tier.key}`;
		const fallback = tierDisplayName(defaultTier(set, tier.key));
		return html`<tr><td><label for="${id}">Bậc ${tier.index + 1} · từ Level ${formatNumber(tier.minLevel)}</label></td>
<td><input class="tr-name-input" type="text" id="${id}" name="name:${tier.key}" value="${tierDisplayName(tier)}" placeholder="${fallback}" maxlength="${NAME_INPUT_MAX}">
<div class="tr-hint">Mặc định: ${fallback}</div></td></tr>`;
	});
	const fingerprints = NAME_GROUPS.map(group => html`<input type="hidden" name="fp${group}" value="${tierNamesFingerprint(set, group)}">`);
	const custom = hasCustomNames(set);
	return html`<section class="card"><h2>✏️ Tên bậc</h2>
<p class="muted">Bộ <strong>${set.name}</strong>. Đặt emoji ở đầu, ví dụ "🟡 Kim Đan"; tên tối đa ${TIER_NAME_MAX} ký tự, không chứa link. Để trống một ô để dùng lại tên mặc định.</p>
<form method="post" action="${guildUrl(ctx, NAMES_PATH)}">${csrfField(ctx)}<input type="hidden" name="drawnSet" value="${set.key}">${fingerprints}
<table class="table"><thead><tr><th>Bậc</th><th>Tên hiển thị (emoji và tên)</th></tr></thead><tbody>${rows}</tbody></table>
<div class="actions"><button class="btn btn-primary" type="submit">Lưu tên bậc</button></div></form>
<form method="post" action="${guildUrl(ctx, RESET_PATH)}" class="actions">${csrfField(ctx)}<input type="hidden" name="drawnSet" value="${set.key}">
<button class="btn" type="submit"${custom ? "" : html` disabled`}>↺ Khôi phục tên mặc định</button>
<span class="muted">${custom ? `Xoá mọi tên tuỳ chỉnh của bộ ${set.name}.` : "Bộ này đang dùng tên mặc định."}</span></form></section>`;
}

/** Cảnh báo phần role: bot thiếu Manage Roles (theo thông tin bot trong cache), người đăng nhập thiếu Manage Roles. */
function roleWarnings(ctx: GuildPageContext): RawHtml[]
{
	const warnings: string[] = [];
	const me = ctx.guild.members.me;
	if (!me) warnings.push(BOT_MEMBER_UNAVAILABLE);
	else if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) warnings.push(MANAGE_ROLES_WARNING);
	const callerIssue = callerManageRolesIssue(tierRoleActor(ctx.guild, ctx.member));
	if (callerIssue !== null) warnings.push(callerIssue);
	return warnings.map(text => html`<div class="warn-box">${discordText(ctx.guild, text)}</div>`);
}

function roleCell(guild: Guild, mapping: TierRoleMapping | undefined): RawHtml
{
	if (!mapping) return html`<span class="muted">chưa gán</span>`;
	const badge = mapping.createdByBot ? html` <span class="badge">do bot tạo</span>` : "";
	const warning = guild.roles.cache.has(mapping.roleId)
		? ""
		: html`<div class="tr-hint">⚠️ Role đã gán không còn trong server; bấm ✨ Tạo/đồng bộ role để tạo lại, hoặc chọn role khác.</div>`;
	return html`${roleChip(guild, mapping.roleId)}${badge}${warning}`;
}

/**
 * Lựa chọn của ô role một bậc: "— Chưa gán —" và các role gán được (bỏ @everyone, role do integration quản lý). Role đang gán
 * luôn là lựa chọn đang chọn, kể cả khi không còn trong server hay không nằm trong danh sách, để lưu form không bỏ gán nhầm.
 */
function roleOptions(guild: Guild, choices: readonly Role[], assignedId: string | null): RawHtml[]
{
	const options = [html`<option value=""${assignedId === null ? html` selected` : ""}>— Chưa gán —</option>`];
	if (assignedId !== null && !choices.some(role => role.id === assignedId))
	{
		const label = guild.roles.cache.has(assignedId) ? roleLabel(guild, assignedId) : `Role ${assignedId} (không còn trong server)`;
		options.push(html`<option value="${assignedId}" selected>${label}</option>`);
	}
	return [
		...options,
		...choices.map(role => html`<option value="${role.id}"${role.id === assignedId ? html` selected` : ""}>${roleLabel(guild, role.id)}</option>`),
	];
}

function rolesSection(ctx: GuildPageContext, set: TierSet, mappings: readonly TierRoleMapping[]): RawHtml
{
	const { guild } = ctx;
	const choices = sortedRoles(guild).filter(role => !role.managed);
	const byTier = new Map(mappings.map(mapping => [mapping.tierKey, mapping]));
	const rows = set.tiers.map(tier =>
	{
		const mapping = byTier.get(tier.key);
		const assigned = mapping?.roleId ?? null;
		const id = `tr-role-${tier.key}`;
		return html`<tr><td><label for="${id}">${discordText(guild, tierTitle(tier))}</label></td><td>${roleCell(guild, mapping)}</td>
<td><select class="tr-role-select" id="${id}" name="role:${tier.key}">${roleOptions(guild, choices, assigned)}</select>
<input type="hidden" name="drawnRole:${tier.key}" value="${assigned ?? ""}"></td></tr>`;
	});
	return html`<section class="card"><h2>🏷️ Role theo bậc</h2>${roleWarnings(ctx)}
<p class="tr-note">${discordText(guild, TIER_ROLE_DEDICATED_NOTE)}</p><p class="tr-note">${TIER_ROLE_SYNC_NOTE}</p>
<p class="muted">Chọn role cho từng bậc rồi bấm lưu; chọn "— Chưa gán —" để bỏ gán (role do bot tạo mà không chuyển sang bậc khác thì bot xoá luôn khỏi server). Có thể chuyển hay hoán đổi role giữa các bậc trong cùng một lần lưu. Bot chỉ xử lý những bậc bạn đổi, và kiểm tra hết các bậc đó trước khi lưu: có lỗi thì không lưu gì.</p>
<form method="post" action="${guildUrl(ctx, ROLES_PATH)}">${csrfField(ctx)}
<table class="table"><thead><tr><th>Bậc</th><th>Role đang gán</th><th>Đổi thành</th></tr></thead><tbody>${rows}</tbody></table>
<div class="actions"><button class="btn btn-primary" type="submit">Lưu role</button></div></form></section>`;
}

function setupSection(ctx: GuildPageContext): RawHtml
{
	return html`<section class="card"><h2>✨ Tạo/đồng bộ role</h2>
<p>Bot tạo role mới (không có quyền gì, màu theo bậc) cho bậc chưa gán role hoặc có role đã gán không còn trong server, và đổi tên, màu các role do bot tạo theo bộ và tên bậc đang dùng. Role do admin tự gán giữ nguyên tên.</p>
<p class="muted">Đổi bộ hay đổi tên bậc xong, bấm nút này để bot đổi tên và màu các role do bot tạo. Cần quyền <strong>Manage Roles</strong> (của bạn và của bot); role của bot phải nằm trên các role danh hiệu.</p>
<form method="post" action="${guildUrl(ctx, SETUP_PATH)}">${csrfField(ctx)}<button class="btn btn-primary" type="submit">✨ Tạo/đồng bộ role</button></form></section>`;
}

function showPage(ctx: GuildPageContext): WebResponse
{
	const { tierSets, tierRoles } = ctx.deps.services;
	const set = tierSets.current(ctx.guild.id);
	const mappings = tierRoles.list(ctx.guild.id);
	return renderPage(ctx, {
		nav: "tiers",
		title: "Danh hiệu",
		lead: `Bộ đang dùng: ${set.name} · role đã gán: ${mappings.length}/${set.tiers.length}. Thao tác giống bảng /config tier panel trong Discord.`,
		body: [setSection(ctx, set), namesSection(ctx, set), rolesSection(ctx, set, mappings), setupSection(ctx)],
	});
}

// ---------- Bộ danh hiệu và tên bậc (POST) ----------

/** Chọn bộ (như menu chọn bộ của bảng Discord); bộ đã đổi sau khi trang được tải thì không ghi. */
function saveSet(ctx: GuildPageContext): WebResponse
{
	const { guild, actorId } = ctx;
	const { tierSets, tierRoles } = ctx.deps.services;
	const form = formOf(ctx);
	const key = form.get("set") ?? "";
	if (!isTierSetKey(key)) throw new UserError(INVALID_TIER_SET);
	const current = tierSets.currentKey(guild.id);
	if (field(form, "drawnSet") !== current) throw new UserError(SET_CHANGED);
	if (key === current) return redirectWithFlash(ctx, PAGE_PATH, "ok", `${NO_CHANGE}: server vẫn đang dùng bộ danh hiệu **${TIER_SETS[key].name}**.`);

	const set = tierSets.select(guild.id, key, actorId);
	const lines = [
		`Đã chọn bộ danh hiệu **${set.name}** (${set.tiers[0].name} → ${set.tiers[set.tiers.length - 1].name}). `
			+ "Tên bậc, emoji, màu và giọng văn thông báo đổi theo bộ này; role đã gán theo bậc được giữ nguyên.",
	];
	if (tierRoles.list(guild.id).length > 0) lines.push(SETUP_ROLES_HINT);
	return redirectWithFlash(ctx, PAGE_PATH, "ok", lines.join("\n"));
}

/**
 * Ô tên của một bậc. Dài hơn ô nhập (form bị sửa) thì từ chối ngay, trước khi phân tích emoji và tên, để một giá trị rất dài
 * không chiếm event loop.
 */
function nameField(form: URLSearchParams, set: TierSet, tierKey: TierKey): string
{
	const value = field(form, `name:${tierKey}`);
	if (value.length > NAME_INPUT_MAX) throw new UserError(`${tierLabel(tierByKey(tierKey, set))}: ${NAME_TOO_LONG}`);
	return value;
}

/**
 * Lưu tên 8 bậc (như form đổi tên của bảng Discord): bộ hoặc tên của nhóm bậc nào đã đổi sau khi trang được tải thì không lưu
 * gì. Mỗi ô qua renameInput (phần trùng mặc định lưu là null); TierSetService.rename validate hết rồi mới ghi, lỗi thì không ghi gì.
 */
function saveNames(ctx: GuildPageContext): WebResponse
{
	const { guild, actorId } = ctx;
	const { tierSets, tierRoles } = ctx.deps.services;
	const form = formOf(ctx);
	if (field(form, "drawnSet") !== tierSets.currentKey(guild.id)) throw new UserError(NAMES_SET_CHANGED);
	const before = tierSets.current(guild.id);
	if (NAME_GROUPS.some(group => field(form, `fp${group}`) !== tierNamesFingerprint(before, group))) throw new UserError(NAMES_CHANGED);

	const entries = TIER_KEYS.map(key => renameInput(before, key, nameField(form, before, key)));
	const after = tierSets.rename(guild.id, entries, actorId);
	const changed = after.tiers.filter(tier => tierDisplayName(tier) !== tierDisplayName(tierByKey(tier.key, before)));
	if (changed.length === 0) return redirectWithFlash(ctx, PAGE_PATH, "ok", `${NO_CHANGE}: bạn chưa sửa tên bậc nào.`);

	const lines = [
		`Đã lưu tên bậc của bộ **${after.name}**:`,
		...changed.map(tier =>
		{
			const isDefault = tierDisplayName(tier) === tierDisplayName(defaultTier(after, tier.key));
			return `• Bậc ${tier.index + 1}: ${tier.emoji} **${tier.name}**${isDefault ? " (tên mặc định)" : ""}`;
		}),
	];
	const mappings = tierRoles.list(guild.id);
	if (changed.some(tier => assignedRole(mappings, tier.key) !== null)) lines.push(SETUP_ROLES_HINT);
	return redirectWithFlash(ctx, PAGE_PATH, "ok", lines.join("\n"));
}

/** Khôi phục tên mặc định của bộ đang dùng, chỉ khi bộ vẫn là bộ lúc tải trang (như nút ↺ của bảng Discord). */
function resetNames(ctx: GuildPageContext): WebResponse
{
	const { guild, actorId } = ctx;
	const { tierSets, tierRoles } = ctx.deps.services;
	const form = formOf(ctx);
	const current = tierSets.currentKey(guild.id);
	if (field(form, "drawnSet") !== current) throw new UserError(RESET_SET_CHANGED);
	const hadCustomNames = tierSets.overrides(guild.id, current).length > 0;
	const set = tierSets.resetNames(guild.id, actorId);
	if (!hadCustomNames) return redirectWithFlash(ctx, PAGE_PATH, "ok", `${NO_CHANGE}: bộ **${set.name}** vốn đang dùng tên mặc định.`);

	const lines = [`Đã khôi phục tên mặc định cho mọi bậc của bộ **${set.name}**.`];
	if (tierRoles.list(guild.id).length > 0) lines.push(SETUP_ROLES_HINT);
	return redirectWithFlash(ctx, PAGE_PATH, "ok", lines.join("\n"));
}

// ---------- Role theo bậc (POST) ----------

/** Role mới của một bậc trong lần lưu. */
interface RoleTarget
{
	roleId: string;
	/** Role đang là role do bot tạo của một bậc khác: chuyển sang bậc này thì giữ cờ, để nút ✨ vẫn đổi tên được role đó. */
	createdByBot: boolean;
}

/** Một bậc admin đổi trên form (lựa chọn khác role lúc tải trang), đã qua kiểm tra. */
interface RoleChange
{
	/** Bậc theo bộ đang dùng lúc nhận form (để hiển thị). */
	tier: Tier;
	/** Role hiện tại của bậc, trùng role lúc tải trang (đã kiểm tra); null = chưa gán. */
	current: TierRoleMapping | null;
	/** Role mới; null = bỏ gán. */
	target: RoleTarget | null;
}

interface RolePlan
{
	changes: RoleChange[];
	/** ID các role được chọn cho một bậc trong lần lưu này: role cũ của một bậc mà nằm trong đây là role được chuyển, không xoá. */
	targetIds: ReadonlySet<string>;
}

/** Lỗi ở giai đoạn kiểm tra trước khi ghi: bot chưa lưu gì. */
function precheckError(tier: Tier, message: string): UserError
{
	return new UserError(`${tierLabel(tier)}: ${message}\n${NOTHING_SAVED}`);
}

/**
 * Lý do không gán được `role` cho một bậc trong lần lưu này; null nếu được. `owner` là mapping đang giữ role (nếu có),
 * `released` là role hiện tại của các bậc đổi (được gỡ trước khi gán). Chỉ đọc cache và cấu hình, không await: bot chưa có
 * trong cache (guild.members.me) thì assignTierRole kiểm tra thứ bậc sau, theo thông tin mới nhất của bot.
 */
function targetIssue(ctx: GuildPageContext, actor: TierRoleActor, role: Role, owner: TierRoleMapping | null, released: ReadonlySet<string>): string | null
{
	const { guild } = ctx;
	const { services } = ctx.deps;
	const callerIssue = callerRoleIssue(actor, role);
	if (callerIssue !== null) return callerIssue;
	if (owner !== null && !released.has(role.id))
	{
		const ownerLabel = tierLabel(tierByKey(owner.tierKey, services.tierSets.current(guild.id)));
		return `${roleMention(role.id)} đang là role của ${ownerLabel}. `
			+ `Muốn chuyển role này sang bậc khác, hãy đổi role của ${ownerLabel} (hoặc chọn "— Chưa gán —") trong cùng lần lưu.`;
	}
	const me = guild.members.me;
	return otherRoleUsageIssue(services, guild.id, role.id) ?? (me ? tierRoleSafetyIssue(role, me) : null);
}

/**
 * Các bậc admin đổi, kiểm tra hết mọi bậc trước khi ghi (không await, lỗi thì không ghi gì): form đúng dạng; role hiện tại
 * của bậc vẫn là role lúc tải trang (bảng cũ); role mới còn trong server, người đăng nhập tự gán được (callerRoleIssue), không
 * chọn cho nhiều bậc, không đang thuộc bậc khác mà bậc đó không nhả trong lần lưu này, không đang là role team/admin/tạo vote,
 * và an toàn với bot trong cache (tierRoleSafetyIssue).
 */
function planRoleChanges(ctx: GuildPageContext, actor: TierRoleActor): RolePlan
{
	const { guild } = ctx;
	const { tierSets, tierRoles } = ctx.deps.services;
	const form = formOf(ctx);
	const mappings = tierRoles.list(guild.id);
	const edits = tierSets.current(guild.id).tiers.flatMap(tier =>
	{
		const drawnRoleId = roleField(form, `drawnRole:${tier.key}`);
		const roleId = roleField(form, `role:${tier.key}`);
		if (roleId === drawnRoleId) return [];
		const current = mappings.find(mapping => mapping.tierKey === tier.key) ?? null;
		if ((current?.roleId ?? null) !== drawnRoleId) throw precheckError(tier, ROLE_CHANGED);
		return [{ tier, current, roleId }];
	});

	const released = new Set(edits.flatMap(edit => (edit.current === null ? [] : [edit.current.roleId])));
	const targetIds = new Set<string>();
	const changes = edits.map(({ tier, current, roleId }): RoleChange =>
	{
		if (roleId === null) return { tier, current, target: null };
		if (targetIds.has(roleId)) throw new UserError(DUPLICATE_ROLE);
		targetIds.add(roleId);
		const role = guild.roles.cache.get(roleId);
		if (!role) throw precheckError(tier, SELECTED_ROLE_UNAVAILABLE);
		const owner = mappings.find(mapping => mapping.roleId === roleId) ?? null;
		const issue = targetIssue(ctx, actor, role, owner, released);
		if (issue !== null) throw precheckError(tier, issue);
		return { tier, current, target: { roleId, createdByBot: owner?.createdByBot ?? false } };
	});
	return { changes, targetIds };
}

/** Bậc bỏ gán role do bot tạo mà role không được chuyển sang bậc nào trong lần lưu: bot xoá role khỏi server (bước 2). */
function deletesRole(change: RoleChange, targetIds: ReadonlySet<string>): boolean
{
	const { current } = change;
	return change.target === null && current !== null && current.createdByBot && !targetIds.has(current.roleId);
}

/**
 * Bước 1 (không await, liền sau bước kiểm tra): gỡ role hiện tại của mọi bậc đổi, trừ các bậc của bước 2. Role được chuyển
 * sang bậc khác chỉ được gỡ khỏi bậc cũ, không bị xoá. Trả về các dòng báo lại cho bậc bỏ gán (bậc đổi role báo ở bước 3).
 */
function releaseRoles(ctx: GuildPageContext, actor: TierRoleActor, plan: RolePlan): string[]
{
	const lines: string[] = [];
	for (const change of plan.changes)
	{
		const { tier, current } = change;
		if (current === null || deletesRole(change, plan.targetIds)) continue;
		ctx.deps.services.tierRoles.clear(ctx.guild.id, tier.key, actor.id);
		if (change.target !== null) continue;
		lines.push(plan.targetIds.has(current.roleId)
			? `Đã bỏ ${roleMention(current.roleId)} khỏi bậc ${tierTitle(tier)} để chuyển sang bậc khác.`
			: tierRoleClearedText({ status: "cleared", roleId: current.roleId, deletion: { kind: "none" } }, tier));
	}
	return lines;
}

/**
 * Bước 2: bỏ gán role do bot tạo không còn dùng ở bậc nào, bằng đúng hàm của bảng Discord (xoá role khỏi server nếu đủ điều
 * kiện rồi gỡ ngay, để audit "tier_role.clear" ghi được `deletedRoleId`).
 */
async function clearUnusedBotRole(ctx: GuildPageContext, actor: TierRoleActor, tier: Tier): Promise<string[]>
{
	const outcome = await clearTierRoleAssignment(ctx.guild, actor, ctx.deps.services, tier.key);
	return [tierRoleClearedText(outcome, tier)];
}

/**
 * Ghi chú sau khi gán role mới cho một bậc (như bảng Discord): role cũ không còn do bot quản lý (trừ khi được chuyển sang
 * bậc khác), bot chưa có Manage Roles.
 */
function assignmentNotes(previous: TierRoleMapping | null, targetIds: ReadonlySet<string>, assignment: TierRoleAssignment): string[]
{
	const notes: string[] = [];
	if (previous !== null && !targetIds.has(previous.roleId))
	{
		notes.push(`Role cũ ${roleMention(previous.roleId)} không còn do bot quản lý; bot không tự gỡ role đó khỏi những người đang có.`);
		if (previous.createdByBot) notes.push("Role cũ do bot tạo; nếu không dùng nữa, hãy xoá thủ công trong **Server Settings → Roles**.");
	}
	if (!assignment.botCanManageRoles) notes.push(MANAGE_ROLES_WARNING);
	return notes;
}

/** Bước 3: gán role mới cho một bậc bằng đúng hàm của bảng Discord (kiểm tra lại quyền, thứ bậc theo thông tin mới nhất của bot). */
async function assignRole(ctx: GuildPageContext, actor: TierRoleActor, plan: RolePlan, change: RoleChange, target: RoleTarget): Promise<string[]>
{
	const { guild } = ctx;
	const role = guild.roles.cache.get(target.roleId);
	if (!role) throw new UserError(SELECTED_ROLE_UNAVAILABLE);
	const assignment = await assignTierRole(guild, actor, ctx.deps.services, change.tier.key, role, { createdByBot: target.createdByBot });
	return [`Đã gán ${roleMention(role.id)} cho bậc ${tierTitle(change.tier)}.`, ...assignmentNotes(change.current, plan.targetIds, assignment)];
}

/** Một bước ghi có gọi Discord (bước 2 hoặc 3). */
interface RoleStep
{
	tier: Tier;
	/** Bước gán role mới: bot dừng ở bước này hoặc trước đó thì bậc chưa có role. */
	assigns: boolean;
	run: () => Promise<string[]>;
}

function assignStep(ctx: GuildPageContext, actor: TierRoleActor, plan: RolePlan, change: RoleChange, target: RoleTarget): RoleStep
{
	return { tier: change.tier, assigns: true, run: () => assignRole(ctx, actor, plan, change, target) };
}

/**
 * Lỗi ở một bước gọi Discord, sau khi đã kiểm tra xong và đã gỡ role cũ của các bậc đổi: báo bậc lỗi, các bậc chưa gán được
 * role mới (hiện chưa có role) và những gì đã lưu.
 */
function stoppedAt(tier: Tier, error: unknown, unassigned: readonly Tier[], saved: readonly string[]): UserError
{
	if (!(error instanceof UserError)) logger.error(`Lỗi khi lưu role danh hiệu trên web (${tier.key}):`, error);
	const message = error instanceof UserError ? error.message : UNEXPECTED_ERROR;
	const lines = [`${tierLabel(tier)}: ${message}`, "Bot dừng ở bậc này."];
	if (unassigned.length > 0)
	{
		lines.push(`Chưa gán được role mới cho: ${unassigned.map(tierLabel).join(", ")}. Các bậc này hiện chưa có role; hãy chọn lại role cho chúng.`);
	}
	lines.push(...(saved.length === 0 ? [NOTHING_SAVED] : ["Đã lưu:", ...saved]));
	return new UserError(unique(lines).join("\n"));
}

/**
 * Lưu role theo bậc. Kiểm tra hết mọi bậc trước (planRoleChanges), có lỗi thì không ghi gì; rồi ghi theo thứ tự: (1) gỡ role
 * hiện tại của mọi bậc đổi, (2) bỏ gán và xoá role do bot tạo không còn dùng ở bậc nào, (3) gán role mới. Nhờ vậy hoán đổi
 * hay chuyển vòng role giữa các bậc đều được, và role do bot tạo được chuyển sang bậc khác không bị xoá. Bước 2 và 3 gọi
 * Discord nên vẫn có thể lỗi: khi đó bot dừng và báo rõ những gì đã lưu, bậc nào chưa gán được role mới.
 */
async function saveRoles(ctx: GuildPageContext): Promise<WebResponse>
{
	const actor = tierRoleActor(ctx.guild, ctx.member);
	const plan = planRoleChanges(ctx, actor);
	if (plan.changes.length === 0) return redirectWithFlash(ctx, PAGE_PATH, "ok", `${NO_CHANGE}: bạn chưa đổi role của bậc nào.`);

	const saved = releaseRoles(ctx, actor, plan);
	const steps: RoleStep[] = [
		...plan.changes
			.filter(change => deletesRole(change, plan.targetIds))
			.map(change => ({ tier: change.tier, assigns: false, run: () => clearUnusedBotRole(ctx, actor, change.tier) })),
		...plan.changes.flatMap(change => (change.target === null ? [] : [assignStep(ctx, actor, plan, change, change.target)])),
	];
	for (const [index, step] of steps.entries())
	{
		try
		{
			saved.push(...await step.run());
		}
		catch (error)
		{
			const unassigned = steps.slice(index).filter(pending => pending.assigns).map(pending => pending.tier);
			throw stoppedAt(step.tier, error, unassigned, saved);
		}
	}
	return redirectWithFlash(ctx, PAGE_PATH, "ok", unique(saved).join("\n"));
}

/** Tạo/đồng bộ role theo bộ đang dùng (như nút ✨ của bảng Discord); kiểm tra quyền người đăng nhập trước. */
async function setupRoles(ctx: GuildPageContext): Promise<WebResponse>
{
	const actor = tierRoleActor(ctx.guild, ctx.member);
	const issue = callerManageRolesIssue(actor);
	if (issue !== null) throw new UserError(issue);
	const set = ctx.deps.services.tierSets.current(ctx.guild.id);
	const result = await syncTierSetRoles(ctx.guild, set, ctx.deps.services, actor);
	return redirectWithFlash(ctx, PAGE_PATH, "ok", buildTierSetupReport(set, result));
}

/** GET tới đường dẫn của một form (tải lại sau khi POST lỗi, hoặc mở trực tiếp): về trang chính, flash vẫn giữ. */
function backToPage(ctx: GuildPageContext): WebResponse
{
	return redirect(guildUrl(ctx, PAGE_PATH));
}

const POST_ROUTES: readonly GuildRoute[] = [
	{ method: "POST", path: SET_PATH, handler: saveSet },
	{ method: "POST", path: NAMES_PATH, handler: saveNames },
	{ method: "POST", path: RESET_PATH, handler: resetNames },
	{ method: "POST", path: ROLES_PATH, handler: saveRoles },
	{ method: "POST", path: SETUP_PATH, handler: setupRoles },
];

export const tiersPage: PageModule = {
	routes: [
		{ method: "GET", path: PAGE_PATH, handler: showPage },
		...POST_ROUTES,
		...POST_ROUTES.map((route): GuildRoute => ({ method: "GET", path: route.path, handler: backToPage })),
	],
	css: TIERS_CSS,
};
