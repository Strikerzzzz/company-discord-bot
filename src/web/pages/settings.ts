// Trang "Cài đặt điểm" của web quản trị (DEC-039): số của Activity XP, vote, contribution, thông báo lên level và kênh nhận
// thông báo (DEC-043). Cùng quy tắc với `/config xp`, `/config poll`, `/config contribution` và form của `/config panel`
// (panelSaveForm): đọc và kiểm tra mọi ô trước khi ghi, chỉ ghi ô có giá trị khác lúc vẽ trang để không đè thay đổi của admin khác.
import { Guild, GuildMember } from "discord.js";
import { isBoardChannel, resolveLevelUpChannel } from "../../discord/configOps";
import { formatNumber } from "../../discord/format";
import { describeSettingsPatch } from "../../discord/views/admin";
import { parseFormNumber } from "../../discord/views/configPanel";
import { DEFAULT_GUILD_SETTINGS, GuildSettings, NumericSettingKey, SETTING_LIMITS } from "../../modules/guild-config/types";
import { UserError } from "../../shared/errors";
import { canViewChannel, channelLabel } from "../format";
import { html, RawHtml } from "../html";
import { WebResponse } from "../http";
import { csrfField, guildUrl, redirectWithFlash, renderPage } from "../layout";
import { GuildPageContext, PageModule } from "../types";

const PATH = "/settings";
/** Tên input ẩn mang giá trị lúc vẽ của ô `key`. */
const DRAWN_PREFIX = "d:";
const ANNOUNCE_KEY = "levelUpAnnouncements";
const ANNOUNCE_CHANNEL_KEY = "levelUpChannelId";
const SNOWFLAKE = /^\d{17,20}$/u;

export const SETTINGS_STALE_FORM = "Form đã cũ hoặc không hợp lệ, nên bot chưa lưu gì. Hãy tải lại trang rồi thử lại.";
export const SETTINGS_UNCHANGED = "Không có gì thay đổi.";

interface NumberField
{
	key: NumericSettingKey;
	label: string;
	/** Ý nghĩa của ô, hiện dưới ô cùng khoảng hợp lệ. */
	hint: string;
}

interface FieldGroup
{
	title: string;
	fields: readonly NumberField[];
	/** Ghi chú cuối nhóm (tuỳ chọn). */
	note?: string;
}

const XP_GROUP: FieldGroup = {
	title: "⭐ Activity XP",
	fields: [
		{ key: "xpPerMessage", label: "XP mỗi tin nhắn", hint: "XP cho mỗi tin nhắn hợp lệ." },
		{ key: "xpCooldownSeconds", label: "Cooldown (giây)", hint: "Thời gian chờ giữa hai lần một người được XP từ tin nhắn." },
		{ key: "minMessageLength", label: "Độ dài tin tối thiểu (ký tự)", hint: "Tin ngắn hơn số ký tự này không được XP." },
		{ key: "duplicateWindowSeconds", label: "Khoảng chống trùng (giây)", hint: "Tin trùng tin trước đó của cùng người trong khoảng này không được XP." },
	],
	note: "XP hoặc cooldown riêng của từng kênh chỉnh ở trang Kênh tính XP (hoặc lệnh /config channel set); kênh có giá trị riêng thì dùng giá trị riêng đó.",
};

const POLL_GROUP: FieldGroup = {
	title: "🗳️ Vote",
	fields: [
		{ key: "defaultPollXp", label: "XP mặc định khi vote", hint: "XP cho mỗi người tham gia, khi admin không đặt XP riêng lúc tạo vote." },
		{ key: "pollXpDailyCap", label: "Giới hạn XP từ vote mỗi ngày", hint: "XP tối đa một người nhận từ vote trong một ngày giờ Việt Nam; 0 = không giới hạn." },
	],
	note: "Ai được tạo vote: xem trang Quyền. Admin luôn tạo được vote.",
};

const CONTRIBUTION_GROUP: FieldGroup = {
	title: "🤝 Contribution",
	fields: [
		{ key: "contributionVotePoints", label: "Điểm mỗi lượt ghi nhận", hint: "Điểm cộng cho tác giả contribution mỗi lượt ghi nhận." },
	],
};

const NUMBER_KEYS: readonly NumericSettingKey[] = [XP_GROUP, POLL_GROUP, CONTRIBUTION_GROUP].flatMap(group => group.fields.map(field => field.key));

function drawnName(key: string): string
{
	return `${DRAWN_PREFIX}${key}`;
}

function numberInput(field: NumberField, value: number): RawHtml
{
	const { min, max } = SETTING_LIMITS[field.key];
	const id = `st-${field.key}`;
	return html`<div class="field">
<label for="${id}">${field.label}</label>
<input type="number" id="${id}" name="${field.key}" value="${value}" min="${min}" max="${max}" step="1" required>
<input type="hidden" name="${drawnName(field.key)}" value="${value}">
<span class="hint">${field.hint} Từ ${formatNumber(min)} đến ${formatNumber(max)}; mặc định ${formatNumber(DEFAULT_GUILD_SETTINGS[field.key])}.</span>
</div>`;
}

function groupCard(group: FieldGroup, settings: GuildSettings, extra: RawHtml | null = null): RawHtml
{
	return html`<section class="card st-group"><h2>${group.title}</h2>
${group.fields.map(field => numberInput(field, settings[field.key]))}
${extra}
${group.note ? html`<p class="muted st-note">${group.note}</p>` : ""}
</section>`;
}

function announceField(enabled: boolean): RawHtml
{
	return html`<div class="field">
<label class="check" for="st-${ANNOUNCE_KEY}"><input type="checkbox" id="st-${ANNOUNCE_KEY}" name="${ANNOUNCE_KEY}" value="1"${enabled ? html` checked` : ""}>
Thông báo khi thành viên lên level</label>
<input type="hidden" name="${drawnName(ANNOUNCE_KEY)}" value="${enabled ? "1" : "0"}">
<span class="hint">Bật thì khi một người lên level (hoặc lên bậc danh hiệu), bot gửi lời chúc mừng vào kênh chọn ở ô dưới.</span>
</div>`;
}

/**
 * Ô chọn kênh nhận thông báo lên level (DEC-043): kênh văn bản và kênh thông báo mà người đăng nhập xem được, theo thứ tự trong
 * server. Kênh đang đặt luôn có trong danh sách (tên bị giấu nếu người đăng nhập không xem được, ghi rõ nếu kênh không còn).
 */
function announceChannelField(guild: Guild, viewer: GuildMember, current: string | null): RawHtml
{
	const channels = [...guild.channels.cache.values()]
		.filter(channel => isBoardChannel(channel) && canViewChannel(guild, channel.id, viewer))
		.sort((a, b) => ("rawPosition" in a ? a.rawPosition : 0) - ("rawPosition" in b ? b.rawPosition : 0));
	const listed = new Set(channels.map(channel => channel.id));
	const options = channels.map(channel => html`<option value="${channel.id}"${channel.id === current ? html` selected` : ""}>${channelLabel(guild, channel.id, viewer)}</option>`);
	const currentOption = current !== null && !listed.has(current) ? html`<option value="${current}" selected>${channelLabel(guild, current, viewer)}</option>` : "";
	return html`<div class="field">
<label for="st-${ANNOUNCE_CHANNEL_KEY}">Kênh nhận thông báo lên level</label>
<select id="st-${ANNOUNCE_CHANNEL_KEY}" name="${ANNOUNCE_CHANNEL_KEY}">
<option value=""${current === null ? html` selected` : ""}>Kênh thành viên vừa nhắn (mặc định)</option>
${currentOption}${options}
</select>
<input type="hidden" name="${drawnName(ANNOUNCE_CHANNEL_KEY)}" value="${current ?? ""}">
<span class="hint">Chọn một kênh (ví dụ kênh lệnh bot) thì bot chỉ gửi thông báo vào kênh đó, không gửi vào kênh hay thread công việc. Bot cần quyền View Channel và Send Messages ở kênh này; kênh bị xoá hoặc bot mất quyền thì bot không gửi thông báo.</span>
</div>`;
}

function renderSettings(ctx: GuildPageContext): WebResponse
{
	const settings = ctx.deps.services.guildConfig.getSettings(ctx.guild.id);
	const body = html`<form method="post" action="${guildUrl(ctx, PATH)}" class="st-form">${csrfField(ctx)}
${groupCard(XP_GROUP, settings, html`${announceField(settings.levelUpAnnouncements)}${announceChannelField(ctx.guild, ctx.member, settings.levelUpChannelId)}`)}
${groupCard(POLL_GROUP, settings)}
${groupCard(CONTRIBUTION_GROUP, settings)}
<div class="actions"><button class="btn btn-primary" type="submit">Lưu cài đặt</button>
<span class="muted">Chỉ những ô bạn sửa mới được lưu; ô khác giữ nguyên, kể cả khi admin khác vừa đổi.</span></div>
</form>`;
	return renderPage(ctx, {
		nav: "settings",
		title: "Cài đặt điểm",
		lead: "Cách tính Activity XP, XP khi vote và điểm contribution cho cả server. Mọi thay đổi được ghi vào nhật ký quản trị.",
		body,
	});
}

/** Giá trị lúc vẽ của một ô số (input ẩn); UserError nếu thiếu hoặc không phải số, vì form không do trang này dựng. */
function drawnNumber(form: URLSearchParams, key: NumericSettingKey): number
{
	const text = form.get(drawnName(key)) ?? "";
	if (!/^\d{1,9}$/u.test(text)) throw new UserError(SETTINGS_STALE_FORM);
	return Number(text);
}

function drawnFlag(form: URLSearchParams, key: string): boolean
{
	const text = form.get(drawnName(key));
	if (text !== "1" && text !== "0") throw new UserError(SETTINGS_STALE_FORM);
	return text === "1";
}

/** Giá trị (lúc vẽ hoặc đã chọn) của ô kênh thông báo: "" hoặc ID kênh; UserError nếu sai định dạng. */
function channelValue(form: URLSearchParams, name: string): string
{
	const text = form.get(name) ?? "";
	if (text !== "" && !SNOWFLAKE.test(text)) throw new UserError(SETTINGS_STALE_FORM);
	return text;
}

/** Phần cấu hình admin thật sự đổi trên form: đọc và kiểm tra mọi ô trước (lỗi thì không ghi gì), rồi so với giá trị lúc vẽ. */
function settingsPatchFromForm(ctx: GuildPageContext, form: URLSearchParams): Partial<GuildSettings>
{
	const values = NUMBER_KEYS.map(key => ({ key, value: parseFormNumber(form.get(key) ?? "", key), drawn: drawnNumber(form, key) }));
	const announce = form.has(ANNOUNCE_KEY);
	const announceDrawn = drawnFlag(form, ANNOUNCE_KEY);
	const announceChannel = channelValue(form, ANNOUNCE_CHANNEL_KEY);
	const announceChannelDrawn = channelValue(form, drawnName(ANNOUNCE_CHANNEL_KEY));
	const announceChannelChanged = announceChannel !== announceChannelDrawn;
	const levelUpChannelId = announceChannelChanged && announceChannel !== "" ? resolveLevelUpChannel(ctx.guild, announceChannel, ctx.member) : null;

	const patch: Partial<GuildSettings> = {};
	for (const { key, value, drawn } of values)
	{
		if (value !== drawn) patch[key] = value;
	}
	if (announce !== announceDrawn) patch.levelUpAnnouncements = announce;
	if (announceChannelChanged) patch.levelUpChannelId = levelUpChannelId;
	return patch;
}

function saveSettings(ctx: GuildPageContext): WebResponse
{
	const patch = settingsPatchFromForm(ctx, ctx.req.form ?? new URLSearchParams());
	if (Object.keys(patch).length === 0) return redirectWithFlash(ctx, PATH, "ok", SETTINGS_UNCHANGED);
	ctx.deps.services.guildConfig.updateSettings(ctx.guild.id, patch, ctx.actorId);
	return redirectWithFlash(ctx, PATH, "ok", `Đã cập nhật cài đặt điểm:\n${describeSettingsPatch(patch).join("\n")}`);
}

export const settingsPage: PageModule = {
	routes: [
		{ method: "GET", path: PATH, handler: renderSettings },
		{ method: "POST", path: PATH, handler: saveSettings },
	],
	css: `
.st-group .field input[type=number] { max-width: 180px; }
.st-note { font-size: 13px; margin: 4px 0 0; }
`,
};
