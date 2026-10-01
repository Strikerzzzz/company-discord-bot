// Trang "Cài đặt điểm" của web quản trị (DEC-039): số của Activity XP, vote, contribution, thông báo lên level và kênh nhận
// thông báo (DEC-043), kênh contribution và XP cho người bấm 👍/👎 contribution (DEC-051). Cùng quy tắc với `/config xp`,
// `/config poll`, `/config contribution` và form của `/config panel` (panelSaveForm): đọc và kiểm tra mọi ô trước khi ghi, chỉ ghi
// ô có giá trị khác lúc vẽ trang để không đè thay đổi của admin khác. Kênh chỉ được kiểm tra (resolveLevelUpChannel,
// resolveContributionChannel) khi admin đổi kênh đó.
import { Guild, GuildMember, PermissionFlagsBits } from "discord.js";
import { isBoardChannel, missingContributionBotPermissions, resolveContributionChannel, resolveLevelUpChannel } from "../../discord/configOps";
import { formatNumber } from "../../discord/format";
import { describeSettingsPatch } from "../../discord/views/admin";
import { parseFormNumber } from "../../discord/views/configPanel";
import { DEFAULT_GUILD_SETTINGS, GuildSettings, NumericSettingKey, SETTING_LIMITS } from "../../modules/guild-config/types";
import { UserError } from "../../shared/errors";
import { canViewChannel, channelLabel, discordText } from "../format";
import { html, RawHtml } from "../html";
import { WebResponse } from "../http";
import { csrfField, guildUrl, redirectWithFlash, renderPage } from "../layout";
import { GuildPageContext, PageModule } from "../types";
import { isSnowflake } from "../widgets";

const PATH = "/settings";
/** Tên input ẩn mang giá trị lúc vẽ của ô `key`. */
const DRAWN_PREFIX = "d:";
const ANNOUNCE_KEY = "levelUpAnnouncements";
const ANNOUNCE_CHANNEL_KEY = "levelUpChannelId";
const CONTRIBUTION_CHANNEL_KEY = "contributionChannelId";

export const SETTINGS_STALE_FORM = "Form đã cũ hoặc không hợp lệ, nên bot chưa lưu gì. Hãy tải lại trang rồi thử lại.";
export const SETTINGS_UNCHANGED = "Không có gì thay đổi.";
/** Cảnh báo khi guild chưa chọn kênh contribution (DEC-051). */
export const NO_CONTRIBUTION_CHANNEL = "Chưa chọn kênh contribution: thành viên chưa gửi được contribution.";

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
		{
			key: "contributionVotePoints",
			label: "Điểm mỗi lượt ghi nhận",
			hint: "Mỗi lượt 👍 Ghi nhận cộng chừng này điểm contribution cho tác giả, mỗi lượt 👎 Không ghi nhận trừ chừng này; điểm của một contribution không xuống dưới 0.",
		},
		{
			key: "contributionInteractionXp",
			label: "XP cho người bấm ghi nhận",
			hint: "Activity XP cho người bấm 👍 hoặc 👎 một contribution, một lần mỗi contribution (đổi 👍↔👎 giữ XP, rút lượt thì thu lại). Đây là XP hoạt động, không phải điểm contribution.",
		},
		{
			key: "contributionInteractionXpDailyCap",
			label: "Giới hạn XP từ contribution mỗi ngày",
			hint: "XP tối đa một người nhận từ bấm 👍/👎 contribution trong một ngày giờ Việt Nam, phần vượt không được cộng bù; 0 = không giới hạn.",
		},
	],
	note: "Contribution mới chờ duyệt rồi mới mở 👍/👎. Ai được duyệt: xem trang Quyền; admin luôn duyệt được.",
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

/** Thẻ một nhóm: `before` (tuỳ chọn) đặt trước các ô số, `after` sau các ô số. */
function groupCard(group: FieldGroup, settings: GuildSettings, after: RawHtml | null = null, before: RawHtml | null = null): RawHtml
{
	return html`<section class="card st-group"><h2>${group.title}</h2>
${before}
${group.fields.map(field => numberInput(field, settings[field.key]))}
${after}
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

/** Lý do bot hiện không gửi được thông báo vào kênh đang đặt (kênh bị xoá, bot thiếu quyền); null nếu gửi được. */
function brokenAnnounceChannel(guild: Guild, channelId: string): string | null
{
	const channel = guild.channels.cache.get(channelId);
	if (!channel) return "Kênh đang đặt không còn trong server: bot không gửi thông báo lên level nữa. Hãy chọn kênh khác.";
	const me = guild.members.me;
	if (!me || !channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]))
	{
		return "Bot đang thiếu quyền View Channel hoặc Send Messages ở kênh này, nên không gửi được thông báo lên level. Hãy cấp lại quyền cho bot hoặc chọn kênh khác.";
	}
	return null;
}

/**
 * Lý do bot hiện không đăng được thẻ contribution vào kênh đang đặt (DEC-051: kênh bị xoá, bot thiếu View Channel, Send Messages
 * hoặc Embed Links), dạng chữ kiểu Discord (tên quyền in đậm); null nếu đăng được.
 */
function brokenContributionChannel(guild: Guild, channelId: string): string | null
{
	const channel = guild.channels.cache.get(channelId);
	if (!channel) return "Kênh contribution đang đặt không còn trong server: thành viên không gửi được contribution. Hãy chọn kênh khác.";
	const me = guild.members.me;
	const missing = me ? missingContributionBotPermissions(channel, me) : ["**View Channel**"];
	if (missing.length === 0) return null;
	return `Bot đang thiếu quyền ${missing.join(", ")} ở kênh contribution, nên không đăng hay sửa được thẻ contribution (thành viên gửi sẽ bị báo lỗi). `
		+ "Hãy cấp lại quyền cho bot hoặc chọn kênh khác.";
}

interface ChannelFieldSpec
{
	key: typeof ANNOUNCE_CHANNEL_KEY | typeof CONTRIBUTION_CHANNEL_KEY;
	label: string;
	/** Chữ của lựa chọn "không đặt kênh" (giá trị rỗng). */
	emptyLabel: string;
	hint: string;
	/** Cảnh báo (chữ kiểu Discord) hiện trên ô; null nếu không có. */
	warning: string | null;
}

/**
 * Ô chọn kênh (kênh nhận thông báo lên level, DEC-043; kênh contribution, DEC-051): kênh văn bản và kênh thông báo mà người đăng
 * nhập xem được, theo thứ tự trong server. Kênh đang đặt luôn có trong danh sách (tên bị giấu nếu người đăng nhập không xem được,
 * ghi rõ nếu kênh không còn). Input ẩn mang kênh lúc vẽ để chỉ ghi khi admin đổi.
 */
function channelField(guild: Guild, viewer: GuildMember, current: string | null, spec: ChannelFieldSpec): RawHtml
{
	const channels = [...guild.channels.cache.values()]
		.filter(channel => isBoardChannel(channel) && canViewChannel(guild, channel.id, viewer))
		.sort((a, b) => ("rawPosition" in a ? a.rawPosition : 0) - ("rawPosition" in b ? b.rawPosition : 0));
	const listed = new Set(channels.map(channel => channel.id));
	const options = channels.map(channel => html`<option value="${channel.id}"${channel.id === current ? html` selected` : ""}>${channelLabel(guild, channel.id, viewer)}</option>`);
	const currentOption = current !== null && !listed.has(current) ? html`<option value="${current}" selected>${channelLabel(guild, current, viewer)}</option>` : "";
	const id = `st-${spec.key}`;
	return html`<div class="field">
<label for="${id}">${spec.label}</label>
${spec.warning === null ? "" : html`<div class="warn-box">${discordText(guild, spec.warning, viewer)}</div>`}
<select id="${id}" name="${spec.key}">
<option value=""${current === null ? html` selected` : ""}>${spec.emptyLabel}</option>
${currentOption}${options}
</select>
<input type="hidden" name="${drawnName(spec.key)}" value="${current ?? ""}">
<span class="hint">${spec.hint}</span>
</div>`;
}

function announceChannelField(guild: Guild, viewer: GuildMember, current: string | null): RawHtml
{
	return channelField(guild, viewer, current, {
		key: ANNOUNCE_CHANNEL_KEY,
		label: "Kênh nhận thông báo lên level",
		emptyLabel: "Kênh thành viên vừa nhắn (mặc định)",
		hint: "Chọn một kênh (ví dụ kênh lệnh bot) thì bot chỉ gửi thông báo vào kênh đó, không gửi vào kênh hay thread công việc. Bot cần quyền View Channel và Send Messages ở kênh này; kênh bị xoá hoặc bot mất quyền thì bot không gửi thông báo.",
		warning: current === null ? null : brokenAnnounceChannel(guild, current),
	});
}

/** Ô chọn kênh contribution (DEC-051): mọi contribution mới được đăng ở kênh này, dù thành viên gửi từ đâu. */
function contributionChannelField(guild: Guild, viewer: GuildMember, current: string | null): RawHtml
{
	return channelField(guild, viewer, current, {
		key: CONTRIBUTION_CHANNEL_KEY,
		label: "Kênh contribution",
		emptyLabel: "Chưa chọn (thành viên chưa gửi được contribution)",
		hint: "Thành viên gửi contribution từ bất kỳ đâu (/contribution submit hoặc chuột phải \"Ghi nhận đóng góp\"), bot luôn đăng thẻ vào kênh này để duyệt rồi bấm 👍/👎. "
			+ "Người gửi phải xem được kênh; bot cần View Channel, Send Messages và Embed Links ở kênh này; người chọn kênh phải tự xem và gửi được tin ở kênh đó.",
		warning: current === null ? NO_CONTRIBUTION_CHANNEL : brokenContributionChannel(guild, current),
	});
}

function renderSettings(ctx: GuildPageContext): WebResponse
{
	const settings = ctx.deps.services.guildConfig.getSettings(ctx.guild.id);
	const body = html`<form method="post" action="${guildUrl(ctx, PATH)}" class="st-form">${csrfField(ctx)}
${groupCard(XP_GROUP, settings, html`${announceField(settings.levelUpAnnouncements)}${announceChannelField(ctx.guild, ctx.member, settings.levelUpChannelId)}`)}
${groupCard(POLL_GROUP, settings)}
${groupCard(CONTRIBUTION_GROUP, settings, null, contributionChannelField(ctx.guild, ctx.member, settings.contributionChannelId))}
<div class="actions"><button class="btn btn-primary" type="submit">Lưu cài đặt</button>
<span class="muted">Chỉ những ô bạn sửa mới được lưu; ô khác giữ nguyên, kể cả khi admin khác vừa đổi.</span></div>
</form>`;
	return renderPage(ctx, {
		nav: "settings",
		title: "Cài đặt điểm",
		lead: "Cách tính Activity XP, XP khi vote, điểm contribution và kênh contribution cho cả server. Mọi thay đổi được ghi vào nhật ký quản trị.",
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

/** Giá trị (lúc vẽ hoặc đã chọn) của một ô kênh: "" hoặc ID kênh; UserError nếu sai định dạng. */
function channelValue(form: URLSearchParams, name: string): string
{
	const text = form.get(name) ?? "";
	if (text !== "" && !isSnowflake(text)) throw new UserError(SETTINGS_STALE_FORM);
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
	const contributionChannel = channelValue(form, CONTRIBUTION_CHANNEL_KEY);
	const contributionChannelChanged = contributionChannel !== channelValue(form, drawnName(CONTRIBUTION_CHANNEL_KEY));
	const contributionChannelId = contributionChannelChanged && contributionChannel !== ""
		? resolveContributionChannel(ctx.guild, contributionChannel, ctx.member)
		: null;

	const patch: Partial<GuildSettings> = {};
	for (const { key, value, drawn } of values)
	{
		if (value !== drawn) patch[key] = value;
	}
	if (announce !== announceDrawn) patch.levelUpAnnouncements = announce;
	if (announceChannelChanged) patch.levelUpChannelId = levelUpChannelId;
	if (contributionChannelChanged) patch.contributionChannelId = contributionChannelId;
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
