// Trang "Kênh tính XP" của web quản trị (DEC-039, DEC-037): chế độ kênh và toàn bộ kênh tính XP được của server trong một form
// (không giới hạn 25 kênh như menu chọn của Discord), bật/tắt và XP/cooldown riêng từng kênh. Cùng nghiệp vụ với `/config panel`
// và `/config channel set`: ghi qua GuildConfigService, mỗi thay đổi có audit với người đăng nhập.
import { CategoryChannel, ChannelType, Guild, GuildBasedChannel } from "discord.js";
import { channelMention } from "../../discord/format";
import { xpChannelModeLabel } from "../../discord/views/admin";
import { NO_XP_CHANNEL_WARNING, parseFormNumber, XP_CHANNEL_TYPES } from "../../discord/views/configPanel";
import { BulkChannelResult, MAX_WEB_BULK_CHANNELS } from "../../modules/guild-config/GuildConfigService";
import { ChannelSettings, GuildSettings, isXpChannelMode, SETTING_LIMITS, XP_CHANNEL_MODES, XpChannelMode } from "../../modules/guild-config/types";
import { UserError } from "../../shared/errors";
import { channelLabel } from "../format";
import { html, RawHtml } from "../html";
import { WebResponse } from "../http";
import { csrfField, guildUrl, redirectWithFlash, renderPage } from "../layout";
import { GuildPageContext, PageModule } from "../types";

const PATH = "/channels";
const SNOWFLAKE = /^\d{17,20}$/u;
/** Trạng thái lúc vẽ của một kênh trong input ẩn `d:<id>`: "bật|XP riêng|cooldown riêng", phần trống = dùng giá trị chung. */
const DRAWN_STATE = /^([01])\|(\d{0,9})\|(\d{0,9})$/u;
/** Số kênh tối đa liệt kê tên trong thông báo kết quả; phần còn lại gộp thành "và N kênh khác". */
const SUMMARY_MENTIONS_MAX = 10;
const STALE_FORM = "Form đã cũ hoặc không hợp lệ. Hãy tải lại trang rồi thử lại.";

const MODE_DETAILS: Readonly<Record<XpChannelMode, string>> = {
	all: "Mọi kênh bot xem được đều tính XP, kể cả kênh tạo mới sau này; chỉ kênh bị tắt riêng là không tính.",
	selected: "Chỉ kênh được bật riêng mới tính XP; kênh chưa bật, kể cả kênh tạo mới sau này, không tính.",
};

/** Kênh chọn được để tính XP (cùng loại với menu chọn kênh của `/config panel`). */
export type XpChannel = Extract<GuildBasedChannel, { type: (typeof XP_CHANNEL_TYPES)[number] }>;

export function isXpChannel(channel: GuildBasedChannel): channel is XpChannel
{
	return XP_CHANNEL_TYPES.some(type => type === channel.type);
}

/** Mọi kênh tính XP được trong cache của server (không gồm category và thread). */
export function xpChannelsOf(guild: Guild): XpChannel[]
{
	return [...guild.channels.cache.values()].filter(isXpChannel);
}

interface ChannelState
{
	enabled: boolean;
	xpPerMessage: number | null;
	xpCooldownSeconds: number | null;
}

/** Một dòng của bảng kênh: kênh, trạng thái lúc vẽ và có dòng cấu hình riêng (listChannels) hay không. */
interface ChannelEntry
{
	channel: XpChannel;
	state: ChannelState;
	custom: boolean;
}

interface ChannelGroup
{
	/** null = nhóm kênh không có danh mục. */
	category: CategoryChannel | null;
	entries: ChannelEntry[];
}

function byPosition(a: { position: number; id: string }, b: { position: number; id: string }): number
{
	return a.position - b.position || a.id.localeCompare(b.id);
}

/** Trong một danh mục, Discord xếp kênh voice/stage sau các kênh chữ. */
function voiceRank(channel: XpChannel): number
{
	return channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice ? 1 : 0;
}

/** Nhóm kênh theo danh mục (như danh sách kênh của Discord): kênh không có danh mục trước, rồi từng danh mục theo vị trí. */
function groupEntries(guild: Guild, entries: readonly ChannelEntry[]): ChannelGroup[]
{
	const categories = [...guild.channels.cache.values()]
		.filter((channel): channel is CategoryChannel => channel.type === ChannelType.GuildCategory)
		.sort(byPosition);
	const known = new Set(categories.map(category => category.id));
	const sorted = [...entries].sort((a, b) => voiceRank(a.channel) - voiceRank(b.channel) || byPosition(a.channel, b.channel));
	const orphan = (parentId: string | null): boolean => parentId === null || !known.has(parentId);
	const groups: ChannelGroup[] = [{ category: null, entries: sorted.filter(entry => orphan(entry.channel.parentId)) }];
	for (const category of categories) groups.push({ category, entries: sorted.filter(entry => entry.channel.parentId === category.id) });
	return groups.filter(group => group.entries.length > 0);
}

function encodeState(state: ChannelState): string
{
	return `${state.enabled ? 1 : 0}|${state.xpPerMessage ?? ""}|${state.xpCooldownSeconds ?? ""}`;
}

function decodeState(value: string | null): ChannelState
{
	const match = value === null ? null : DRAWN_STATE.exec(value);
	if (!match) throw new UserError(STALE_FORM);
	const xp = match[2] ?? "";
	const cooldown = match[3] ?? "";
	return {
		enabled: match[1] === "1",
		xpPerMessage: xp === "" ? null : Number(xp),
		xpCooldownSeconds: cooldown === "" ? null : Number(cooldown),
	};
}

// ---------- GET ----------

function modeOption(mode: XpChannelMode, current: XpChannelMode): RawHtml
{
	return html`<label class="check"><input type="radio" name="mode" value="${mode}"${mode === current ? html` checked` : ""}>
<strong>${xpChannelModeLabel(mode)}</strong>${mode === current ? html` <span class="badge ok">đang dùng</span>` : ""}</label>
<p class="ch-mode-desc muted">${MODE_DETAILS[mode]}</p>`;
}

function numberInput(name: string, value: number | null, fallback: number, key: "xpPerMessage" | "xpCooldownSeconds", label: string): RawHtml
{
	const limit = SETTING_LIMITS[key];
	return html`<input class="ch-num" type="number" name="${name}" value="${value ?? ""}" placeholder="${fallback}" min="${limit.min}" max="${limit.max}" step="1" inputmode="numeric" aria-label="${label}">`;
}

function channelRow(guild: Guild, { channel, state, custom }: ChannelEntry, settings: GuildSettings): RawHtml
{
	const id = channel.id;
	const label = channelLabel(guild, id);
	return html`<tr>
<td><label for="on-${id}">${label}</label><input type="hidden" name="d:${id}" value="${encodeState(state)}"></td>
<td><input type="checkbox" id="on-${id}" name="on" value="${id}"${state.enabled ? html` checked` : ""}></td>
<td>${custom ? html`<span class="badge ch-own">cấu hình riêng</span>` : html`<span class="badge">theo chế độ</span>`}</td>
<td>${numberInput(`xp:${id}`, state.xpPerMessage, settings.xpPerMessage, "xpPerMessage", `XP mỗi tin riêng của ${label}`)}</td>
<td>${numberInput(`cd:${id}`, state.xpCooldownSeconds, settings.xpCooldownSeconds, "xpCooldownSeconds", `Cooldown riêng của ${label}`)}</td>
</tr>`;
}

function renderChannels(ctx: GuildPageContext): WebResponse
{
	const { guild } = ctx;
	const { guildConfig } = ctx.deps.services;
	const settings = guildConfig.getSettings(guild.id);
	const mode = settings.xpChannelMode;
	const rows = new Map(guildConfig.listChannels(guild.id).map(row => [row.channelId, row]));
	const entries = xpChannelsOf(guild).map((channel): ChannelEntry =>
	{
		const row = rows.get(channel.id);
		return {
			channel,
			state: {
				enabled: guildConfig.effectiveChannelXp(guild.id, channel.id).enabled,
				xpPerMessage: row?.xpPerMessage ?? null,
				xpCooldownSeconds: row?.xpCooldownSeconds ?? null,
			},
			custom: row !== undefined,
		};
	});
	const enabledCount = entries.filter(entry => entry.state.enabled).length;

	const body = entries.length === 0
		? html`<p class="muted">Bot chưa thấy kênh nào tính XP được (kênh chữ, thông báo, forum, media, voice, stage). Kiểm tra quyền xem kênh của bot.</p>`
		: html`<table class="table ch-table">
<thead><tr><th>Kênh</th><th>Tính XP</th><th>Trạng thái</th><th>XP mỗi tin</th><th>Cooldown (giây)</th></tr></thead>
<tbody>${groupEntries(guild, entries).map(group => html`
<tr class="ch-cat"><th colspan="5">${group.category ? html`📁 ${group.category.name}` : "Không có danh mục"}</th></tr>
${group.entries.map(entry => channelRow(guild, entry, settings))}`)}
</tbody></table>`;

	return renderPage(ctx, {
		nav: "channels",
		title: "Kênh tính XP",
		lead: "Chọn kênh nào tính Activity XP, và XP hoặc cooldown riêng của từng kênh.",
		body: html`<form method="post" action="${guildUrl(ctx, PATH)}">${csrfField(ctx)}
<input type="hidden" name="drawnMode" value="${mode}">
<section class="card"><h2>Chế độ</h2>
${XP_CHANNEL_MODES.map(option => modeOption(option, mode))}
<p class="muted ch-note">Đổi chế độ: kênh chưa có cấu hình riêng sẽ theo chế độ mới. Ô tick ở bảng dưới chỉ ghi cho kênh bạn đổi so với lúc mở trang; muốn chọn kênh theo chế độ mới, hãy lưu chế độ trước rồi tick sau.</p>
</section>
<section class="card"><h2>Kênh (${entries.length})</h2>
<p>Đang tính XP: <strong>${enabledCount}/${entries.length}</strong> kênh. Giá trị chung: <strong>${settings.xpPerMessage} XP</strong> mỗi tin, cooldown <strong>${settings.xpCooldownSeconds} giây</strong> (sửa ở <a href="${guildUrl(ctx, "/settings")}">Cài đặt điểm</a>); ô trống là dùng giá trị chung.</p>
${mode === "selected" && enabledCount === 0 ? html`<div class="warn-box">${NO_XP_CHANNEL_WARNING} Tick kênh bên dưới rồi bấm Lưu để bật.</div>` : ""}
<div class="ch-scroll">${body}</div>
<p class="muted ch-note">Tin trong thread và bài trong forum tính theo kênh cha. Danh mục (category) không chọn được: hãy tick từng kênh trong đó. "Cấu hình riêng" là kênh đã được bật, tắt hoặc đặt XP riêng; kênh "theo chế độ" đổi theo chế độ ở trên.</p>
</section>
<div class="actions"><button class="btn btn-primary" type="submit">💾 Lưu thay đổi</button></div>
</form>`,
	});
}

// ---------- POST ----------

interface ChannelEdit
{
	id: string;
	drawn: ChannelState;
	next: ChannelState;
}

/** ID mọi kênh form nhắc tới (`on`, `d:<id>`, `xp:<id>`, `cd:<id>`), theo thứ tự xuất hiện. */
function referencedChannelIds(form: URLSearchParams): string[]
{
	const ids = new Set<string>(form.getAll("on"));
	for (const key of form.keys())
	{
		const match = /^(?:d|xp|cd):(.*)$/su.exec(key);
		if (match) ids.add(match[1] ?? "");
	}
	return [...ids];
}

function assertXpChannel(guild: Guild, id: string): void
{
	if (!SNOWFLAKE.test(id)) throw new UserError(`Form có mã kênh không hợp lệ. ${STALE_FORM}`);
	const channel = guild.channels.cache.get(id);
	if (!channel) throw new UserError(`Không tìm thấy kênh ${channelMention(id)} trong server (có thể vừa bị xoá). Hãy tải lại trang rồi thử lại.`);
	if (!isXpChannel(channel))
	{
		throw new UserError(`Không bật/tắt XP được cho ${channelMention(id)}: chỉ dùng được kênh chữ, kênh thông báo, forum, media, `
			+ "kênh voice hoặc stage (tin trong thread theo kênh cha).");
	}
}

/** Ô XP/cooldown riêng: không có trong form = giữ giá trị lúc vẽ; trống = dùng giá trị chung (null); còn lại qua parseFormNumber. */
function parseOverride(raw: string | null, drawn: number | null, key: "xpPerMessage" | "xpCooldownSeconds"): number | null
{
	if (raw === null) return drawn;
	if (raw.trim() === "") return null;
	return parseFormNumber(raw, key);
}

function mentionSummary(ids: readonly string[]): string
{
	const shown = ids.slice(0, SUMMARY_MENTIONS_MAX).map(channelMention).join(", ");
	return ids.length > SUMMARY_MENTIONS_MAX ? `${shown} và ${ids.length - SUMMARY_MENTIONS_MAX} kênh khác` : shown;
}

const NO_CHANGE: BulkChannelResult = { changed: [], unchanged: [] };

function saveChannels(ctx: GuildPageContext): WebResponse
{
	const { guild, actorId } = ctx;
	const guildId = guild.id;
	const form = ctx.req.form ?? new URLSearchParams();
	const { guildConfig } = ctx.deps.services;

	const mode = form.get("mode");
	const drawnMode = form.get("drawnMode");
	if (!isXpChannelMode(mode) || !isXpChannelMode(drawnMode)) throw new UserError(STALE_FORM);

	const ids = referencedChannelIds(form);
	for (const id of ids) assertXpChannel(guild, id);
	const ticked = new Set(form.getAll("on"));
	const edits: ChannelEdit[] = ids.map(id =>
	{
		const drawn = decodeState(form.get(`d:${id}`));
		return {
			id,
			drawn,
			next: {
				enabled: ticked.has(id),
				xpPerMessage: parseOverride(form.get(`xp:${id}`), drawn.xpPerMessage, "xpPerMessage"),
				xpCooldownSeconds: parseOverride(form.get(`cd:${id}`), drawn.xpCooldownSeconds, "xpCooldownSeconds"),
			},
		};
	});
	const toEnable = edits.filter(edit => edit.next.enabled && !edit.drawn.enabled).map(edit => edit.id);
	const toDisable = edits.filter(edit => !edit.next.enabled && edit.drawn.enabled).map(edit => edit.id);
	if (toEnable.length > MAX_WEB_BULK_CHANNELS || toDisable.length > MAX_WEB_BULK_CHANNELS)
	{
		throw new UserError(`Mỗi lần chỉ bật hoặc tắt tối đa ${MAX_WEB_BULK_CHANNELS} kênh.`);
	}

	const summary: string[] = [];
	if (mode !== drawnMode && guildConfig.getSettings(guildId).xpChannelMode !== mode)
	{
		guildConfig.updateSettings(guildId, { xpChannelMode: mode }, actorId);
		summary.push(`chế độ **${xpChannelModeLabel(mode)}**`);
	}
	const enabled = toEnable.length > 0 ? guildConfig.setChannelsXpEnabled(guildId, toEnable, true, actorId, MAX_WEB_BULK_CHANNELS) : NO_CHANGE;
	const disabled = toDisable.length > 0 ? guildConfig.setChannelsXpEnabled(guildId, toDisable, false, actorId, MAX_WEB_BULK_CHANNELS) : NO_CHANGE;
	if (enabled.changed.length > 0) summary.push(`bật XP ${enabled.changed.length} kênh (${mentionSummary(enabled.changed)})`);
	if (disabled.changed.length > 0) summary.push(`tắt XP ${disabled.changed.length} kênh (${mentionSummary(disabled.changed)})`);

	const overridden: string[] = [];
	for (const { id, drawn, next } of edits)
	{
		const current = guildConfig.getChannel(guildId, id);
		const patch: Partial<Omit<ChannelSettings, "channelId">> = {};
		if (next.xpPerMessage !== drawn.xpPerMessage && next.xpPerMessage !== current.xpPerMessage) patch.xpPerMessage = next.xpPerMessage;
		if (next.xpCooldownSeconds !== drawn.xpCooldownSeconds && next.xpCooldownSeconds !== current.xpCooldownSeconds)
		{
			patch.xpCooldownSeconds = next.xpCooldownSeconds;
		}
		if (Object.keys(patch).length === 0) continue;
		guildConfig.setChannel(guildId, id, patch, actorId);
		overridden.push(id);
	}
	if (overridden.length > 0) summary.push(`đổi XP/cooldown riêng ${overridden.length} kênh (${mentionSummary(overridden)})`);

	const lines = [summary.length === 0 ? "Không có gì thay đổi." : `Đã lưu: ${summary.join("; ")}.`];
	const unchanged = enabled.unchanged.length + disabled.unchanged.length;
	if (unchanged > 0) lines.push(`-# ${unchanged} kênh vốn đã đúng trạng thái (theo chế độ kênh, hoặc admin khác vừa đổi), bot bỏ qua.`);
	return redirectWithFlash(ctx, PATH, "ok", lines.join("\n"));
}

export const channelsPage: PageModule = {
	routes: [
		{ method: "GET", path: PATH, handler: renderChannels },
		{ method: "POST", path: PATH, handler: saveChannels },
	],
	css: `
.ch-mode-desc { margin: 0 0 10px 25px; font-size: 14px; }
.ch-note { font-size: 13px; margin: 10px 0 0; }
.ch-scroll { overflow-x: auto; }
.ch-table tr.ch-cat th { background: #f7f8fc; color: var(--text); font-size: 13px; text-transform: uppercase; letter-spacing: .03em; padding-top: 12px; }
.ch-table td label { font-weight: 600; cursor: pointer; }
.ch-num { width: 110px; }
.badge.ch-own { background: #e6e8fd; color: var(--brand-dark); }
`,
};
