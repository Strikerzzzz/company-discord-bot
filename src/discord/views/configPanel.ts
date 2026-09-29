// Hàm thuần dựng bảng điều khiển cấu hình chung `/config panel` (PROP-033, DEC-037): Components V2, form sửa số, mã hoá customId.
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelSelectMenuBuilder,
	ChannelType,
	ContainerBuilder,
	InteractionReplyOptions,
	InteractionUpdateOptions,
	LabelBuilder,
	MessageFlags,
	ModalBuilder,
	RoleSelectMenuBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";
import { TierSet } from "../../modules/activity/tiers";
import {
	ChannelSettings,
	DEFAULT_GUILD_SETTINGS,
	GuildSettings,
	isXpChannelMode,
	NumericSettingKey,
	SETTING_LIMITS,
	XpChannelMode,
} from "../../modules/guild-config/types";
import { MAX_TEAMS } from "../../modules/team/TeamService";
import { UserError } from "../../shared/errors";
import { channelMention, COLORS, fitLines, formatNumber, roleMention, truncate } from "../format";
import { describeChannelSettings, inlineText, settingLine, xpChannelModeLabel } from "./admin";

// ---------- Hợp đồng chung (nền móng Phase 15): namespace, trang, thao tác, customId ----------

export const CONFIG_PANEL_NAMESPACE = "cfgui";

export const INVALID_CONFIG_PANEL = "Bảng cấu hình này đã cũ hoặc không hợp lệ. Hãy mở lại bằng `/config panel`.";

/** Loại channel có tin nhắn tính XP (kể cả chat trong kênh voice/stage và bài đăng trong kênh forum/media). */
export const XP_CHANNEL_TYPES = [
	ChannelType.GuildText,
	ChannelType.GuildAnnouncement,
	ChannelType.GuildForum,
	ChannelType.GuildVoice,
	ChannelType.GuildStageVoice,
	ChannelType.GuildMedia,
] as const;

/** Loại channel đặt được Bảng vàng: kênh chữ thường và kênh thông báo. */
export const BOARD_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

/**
 * Các trang của bảng:
 * - `home`: tổng quan (tóm tắt mọi cấu hình, như `/config view`);
 * - `channels`: chế độ kênh tính XP (DEC-037), bật/tắt XP cho nhiều kênh, danh sách kênh có cấu hình riêng;
 * - `teams`: thêm/bỏ role team, danh sách team;
 * - `xp`: XP mỗi tin, cooldown, độ dài tối thiểu, chống trùng (form), công tắc thông báo lên level;
 * - `poll`: XP mặc định khi vote, giới hạn XP vote mỗi ngày, điểm mỗi lượt ghi nhận (form), role được tạo vote;
 * - `board`: kênh Bảng vàng (và nút tắt), role admin bot, nút mở bảng danh hiệu.
 */
export type ConfigPanelPage = "home" | "channels" | "teams" | "xp" | "poll" | "board";

export const CONFIG_PANEL_PAGES: readonly ConfigPanelPage[] = ["home", "channels", "teams", "xp", "poll", "board"];

export function isConfigPanelPage(value: unknown): value is ConfigPanelPage
{
	return typeof value === "string" && (CONFIG_PANEL_PAGES as readonly string[]).includes(value);
}

/** Giá trị form XP lúc mở (mang trong customId của form, để chỉ lưu ô admin thật sự sửa). */
export type XpFormValues = Pick<GuildSettings, "xpPerMessage" | "xpCooldownSeconds" | "minMessageLength" | "duplicateWindowSeconds">;
/** Giá trị form vote/contribution lúc mở. */
export type PollFormValues = Pick<GuildSettings, "defaultPollXp" | "pollXpDailyCap" | "contributionVotePoints">;

/** Thứ tự ô trong form XP; customId của mỗi ô là khoá cấu hình. */
export const XP_FORM_KEYS = ["xpPerMessage", "xpCooldownSeconds", "minMessageLength", "duplicateWindowSeconds"] as const satisfies readonly NumericSettingKey[];
/** Thứ tự ô trong form vote/contribution; customId của mỗi ô là khoá cấu hình. */
export const POLL_FORM_KEYS = ["defaultPollXp", "pollXpDailyCap", "contributionVotePoints"] as const satisfies readonly NumericSettingKey[];

/**
 * Thao tác mã hoá trong customId (`cfgui:<...>`). Ý nghĩa từng thao tác và trang vẽ lại sau khi làm xong:
 * - `nav` (menu chọn trang, StringSelect; giá trị là ConfigPanelPage): chuyển trang, không ghi gì.
 * - `mode` (nút, trang channels): đặt chế độ kênh tính XP = `mode`. Đã đúng chế độ thì không ghi.
 * - `channels` (ChannelSelect nhiều kênh, tối đa 25, trang channels): `enabled` = true bật XP, false tắt XP cho các kênh chọn
 *   (GuildConfigService.setChannelsXpEnabled).
 * - `teams` (RoleSelect nhiều role, trang teams): `add` = true thêm các role làm team, false bỏ khỏi danh sách team.
 * - `announce` (nút, trang xp): đặt thông báo lên level = `enabled`.
 * - `xpForm` (nút, trang xp): mở form XP; `xpSave` (form): lưu, `drawn` là giá trị lúc mở form: ô nào admin không sửa
 *   (giá trị bằng `drawn`) thì không ghi, để không đè thay đổi của người khác trong lúc form đang mở.
 * - `pollForm` / `pollSave`: như trên cho vote/contribution (trang poll).
 * - `pollRole` (RoleSelect một role, cho phép bỏ chọn, trang poll): chọn = đặt role tạo vote; bỏ chọn = xoá role tạo vote,
 *   chỉ khi role hiện tại vẫn là `drawnRoleId` (role lúc vẽ bảng; null = chưa đặt).
 * - `board` (ChannelSelect một kênh, trang board): đặt kênh Bảng vàng (cùng kiểm tra quyền như `/config board`).
 * - `boardOff` (nút, trang board): tắt Bảng vàng.
 * - `adminRole` (RoleSelect một role, cho phép bỏ chọn, trang board): như `pollRole` cho role admin bot.
 * - `tierPanel` (nút, trang board): mở bảng danh hiệu `/config tier panel` trong một tin nhắn riêng mới.
 */
export type ConfigPanelAction =
	| { type: "nav" }
	| { type: "mode"; mode: XpChannelMode }
	| { type: "channels"; enabled: boolean }
	| { type: "teams"; add: boolean }
	| { type: "announce"; enabled: boolean }
	| { type: "xpForm" }
	| { type: "xpSave"; drawn: XpFormValues }
	| { type: "pollForm" }
	| { type: "pollSave"; drawn: PollFormValues }
	| { type: "pollRole"; drawnRoleId: string | null }
	| { type: "board" }
	| { type: "boardOff" }
	| { type: "adminRole"; drawnRoleId: string | null }
	| { type: "tierPanel" };

/** Trang vẽ lại sau một thao tác. */
export function pageOfAction(action: ConfigPanelAction): ConfigPanelPage
{
	switch (action.type)
	{
	case "nav": return "home";
	case "mode":
	case "channels": return "channels";
	case "teams": return "teams";
	case "announce":
	case "xpForm":
	case "xpSave": return "xp";
	case "pollForm":
	case "pollSave":
	case "pollRole": return "poll";
	case "board":
	case "boardOff":
	case "adminRole":
	case "tierPanel": return "board";
	}
}

const NO_ROLE = "none";
const NUMBER = "(\\d{1,6})";
const ROLE = `(\\d{17,20}|${NO_ROLE})`;
const PANEL_ID = new RegExp(
	`^${CONFIG_PANEL_NAMESPACE}:(?:(nav|xpform|pollform|board|boardoff|tier)`
		+ "|mode:(all|selected)|ch:(on|off)|team:(add|del)|ann:(on|off)"
		+ `|xpsave:${NUMBER}\\.${NUMBER}\\.${NUMBER}\\.${NUMBER}|pollsave:${NUMBER}\\.${NUMBER}\\.${NUMBER}`
		+ `|pollrole:${ROLE}|admin:${ROLE})$`,
);

/** customId của một thao tác (luôn ≤ 100 ký tự: số trong form tối đa 6 chữ số, role ID tối đa 20 chữ số). */
export function configPanelId(action: ConfigPanelAction): string
{
	const ns = CONFIG_PANEL_NAMESPACE;
	switch (action.type)
	{
	case "nav": return `${ns}:nav`;
	case "mode": return `${ns}:mode:${action.mode}`;
	case "channels": return `${ns}:ch:${action.enabled ? "on" : "off"}`;
	case "teams": return `${ns}:team:${action.add ? "add" : "del"}`;
	case "announce": return `${ns}:ann:${action.enabled ? "on" : "off"}`;
	case "xpForm": return `${ns}:xpform`;
	case "xpSave": return `${ns}:xpsave:${XP_FORM_KEYS.map(key => action.drawn[key]).join(".")}`;
	case "pollForm": return `${ns}:pollform`;
	case "pollSave": return `${ns}:pollsave:${POLL_FORM_KEYS.map(key => action.drawn[key]).join(".")}`;
	case "pollRole": return `${ns}:pollrole:${action.drawnRoleId ?? NO_ROLE}`;
	case "board": return `${ns}:board`;
	case "boardOff": return `${ns}:boardoff`;
	case "adminRole": return `${ns}:admin:${action.drawnRoleId ?? NO_ROLE}`;
	case "tierPanel": return `${ns}:tier`;
	}
}

function roleOf(value: string): string | null
{
	return value === NO_ROLE ? null : value;
}

/** Đọc customId của bảng; UserError(INVALID_CONFIG_PANEL) nếu sai định dạng (customId cũ hoặc bị sửa). */
export function parseConfigPanelId(customId: string): ConfigPanelAction
{
	const match = PANEL_ID.exec(customId);
	if (!match) throw new UserError(INVALID_CONFIG_PANEL);
	const [, simple, mode, channel, team, announce, x1, x2, x3, x4, p1, p2, p3, pollRole, adminRole] = match;
	switch (simple)
	{
	case "nav": return { type: "nav" };
	case "xpform": return { type: "xpForm" };
	case "pollform": return { type: "pollForm" };
	case "board": return { type: "board" };
	case "boardoff": return { type: "boardOff" };
	case "tier": return { type: "tierPanel" };
	default: break;
	}
	if (mode !== undefined && isXpChannelMode(mode)) return { type: "mode", mode };
	if (channel !== undefined) return { type: "channels", enabled: channel === "on" };
	if (team !== undefined) return { type: "teams", add: team === "add" };
	if (announce !== undefined) return { type: "announce", enabled: announce === "on" };
	if (x1 !== undefined && x2 !== undefined && x3 !== undefined && x4 !== undefined)
	{
		return {
			type: "xpSave",
			drawn: { xpPerMessage: Number(x1), xpCooldownSeconds: Number(x2), minMessageLength: Number(x3), duplicateWindowSeconds: Number(x4) },
		};
	}
	if (p1 !== undefined && p2 !== undefined && p3 !== undefined)
	{
		return { type: "pollSave", drawn: { defaultPollXp: Number(p1), pollXpDailyCap: Number(p2), contributionVotePoints: Number(p3) } };
	}
	if (pollRole !== undefined) return { type: "pollRole", drawnRoleId: roleOf(pollRole) };
	if (adminRole !== undefined) return { type: "adminRole", drawnRoleId: roleOf(adminRole) };
	throw new UserError(INVALID_CONFIG_PANEL);
}

/**
 * Đọc một ô số trong form: bỏ khoảng trắng, chỉ nhận chữ số (không nhận dấu chấm/phẩy, vì "2,5" hay "1.000" dễ bị hiểu
 * nhầm), phải là số nguyên trong SETTING_LIMITS; UserError tiếng Việt kèm nhãn nếu sai.
 */
export function parseFormNumber(raw: string, key: NumericSettingKey): number
{
	const limit = SETTING_LIMITS[key];
	const text = raw.replace(/\s/gu, "");
	const value = /^\d{1,9}$/u.test(text) ? Number(text) : Number.NaN;
	if (!Number.isInteger(value) || value < limit.min || value > limit.max)
	{
		throw new UserError(`${limit.label} phải là số nguyên từ ${limit.min} đến ${limit.max}, chỉ gồm chữ số `
			+ `(bạn nhập "${inlineText(raw, 20)}").`);
	}
	return value;
}

/** Dữ liệu dựng bảng; handler đọc từ service ngay trước khi vẽ. */
export interface ConfigPanelData
{
	settings: GuildSettings;
	/** Các kênh có cấu hình riêng (GuildConfigService.listChannels). */
	channels: readonly ChannelSettings[];
	/** Role team, theo thứ tự thêm. */
	teams: readonly string[];
	/** Kênh Bảng vàng; null = đang tắt. */
	boardChannelId: string | null;
	/** Bộ danh hiệu đang dùng (đã áp tên tuỳ chỉnh) và số bậc đã gán role, cho trang tổng quan. */
	tierSet: TierSet;
	tierRoleCount: number;
	/**
	 * ID role/kênh đang lưu trong cấu hình nhưng không còn trong server (role admin, role tạo vote, role team, kênh Bảng vàng):
	 * không điền sẵn vào menu chọn (Discord có thể từ chối ID không tồn tại) và hiện cảnh báo. Không truyền = coi như còn đủ.
	 */
	missingIds?: ReadonlySet<string>;
	/**
	 * Kết quả thao tác vừa làm (ví dụ "Đã bật XP cho 3 kênh"), hiển thị NGUYÊN VĂN trong một TextDisplay ở đầu trang;
	 * null/undefined = không có. Thay cho tin nhắn phản hồi riêng.
	 */
	notice?: string | null;
}

// ---------- Dựng giao diện ----------

/** Tổng số ký tự tối đa của mọi TextDisplay trong một tin nhắn Components V2 (UTF-16). */
const TEXT_TOTAL_MAX = 4000;
/**
 * Độ dài tối đa của notice (UTF-16). Notice do handler tạo, thường một vài câu nên luôn hiện nguyên văn; notice dài hơn mức này
 * (không nên có) bị cắt, để bảng không vượt giới hạn chữ của Discord.
 */
export const CONFIG_PANEL_NOTICE_MAX = 1500;
/** Cảnh báo khi đang ở chế độ "chỉ kênh được bật" mà chưa bật kênh nào (trang tổng quan và trang kênh). */
export const NO_XP_CHANNEL_WARNING = "⚠️ Chưa bật kênh nào, hiện không ai được XP từ tin nhắn.";
/** Trần độ dài một danh sách kênh hoặc team (UTF-16), để bảng không quá dài; phần còn lại gộp thành "… và N … khác". */
const LIST_MAX = 1500;
/** Số lựa chọn tối đa của một menu chọn. */
const SELECT_MAX_VALUES = 25;
/** Giới hạn mô tả của một ô trong form (UTF-16). */
const LABEL_DESCRIPTION_MAX = 100;
/** Độ dài tối đa của ô số trong form (parseFormNumber nhận tối đa 9 chữ số sau khi bỏ dấu ngăn cách). */
const NUMBER_INPUT_MAX = 9;

interface PageInfo
{
	emoji: string;
	label: string;
	/** Mô tả trong menu chọn trang (≤ 100 ký tự). */
	description: string;
}

const PAGE_INFO: Readonly<Record<ConfigPanelPage, PageInfo>> = {
	home: { emoji: "🏠", label: "Tổng quan", description: "Tóm tắt toàn bộ cấu hình" },
	channels: { emoji: "📺", label: "Kênh tính XP", description: "Chế độ kênh, bật hoặc tắt tính XP cho từng kênh" },
	teams: { emoji: "👥", label: "Team", description: "Thêm hoặc bỏ role team" },
	xp: { emoji: "⭐", label: "Activity XP", description: "XP mỗi tin, cooldown, chống spam, thông báo lên level" },
	poll: { emoji: "🗳️", label: "Vote và contribution", description: "XP khi vote, giới hạn mỗi ngày, điểm ghi nhận, role tạo vote" },
	board: { emoji: "🏆", label: "Bảng vàng và quyền", description: "Kênh Bảng vàng, role admin bot, bảng danh hiệu" },
};

const XP_SETTING_KEYS = ["xpPerMessage", "xpCooldownSeconds", "minMessageLength", "duplicateWindowSeconds", "levelUpAnnouncements"] as const;
const POLL_SETTING_KEYS = ["defaultPollXp", "pollXpDailyCap", "contributionVotePoints", "pollCreatorRoleId"] as const;

const MODE_BUTTON_LABELS: Readonly<Record<XpChannelMode, string>> = {
	all: "🌐 Tất cả kênh",
	selected: "🎯 Chỉ kênh được bật",
};

const MODE_DETAILS: Readonly<Record<XpChannelMode, string>> = {
	all: "Mọi kênh bot xem được đều tính XP, kể cả kênh tạo mới sau này; chỉ kênh bị tắt riêng là không tính.",
	selected: "Chỉ kênh được bật riêng mới tính XP; kênh chưa bật, kể cả kênh tạo mới sau này, không tính.",
};

const HOME_NOTE = "-# Chọn mục ở menu trên để sửa. Các lệnh gõ tay `/config …` vẫn dùng được.";

const CHANNELS_NOTE = [
	"-# Tin trong thread và bài trong forum tính theo kênh cha. Mỗi lần chọn được tối đa 25 kênh.",
	"-# XP hoặc cooldown riêng của từng kênh chỉnh bằng `/config channel set`; `/config channel reset` đưa kênh về theo chế độ.",
].join("\n");

const TEAMS_NOTE = "-# Điểm team chỉ tính từ lúc role được thêm làm team; bỏ team thì điểm lịch sử vẫn giữ. Không dùng role danh hiệu làm team.";

const XP_NOTE = [
	"-# Cooldown là thời gian chờ giữa hai lần một người được XP từ tin nhắn. Tin ngắn hơn độ dài tối thiểu, hoặc trùng tin trước đó "
		+ "của cùng người trong khoảng chống trùng, không được XP.",
	"-# XP hoặc cooldown riêng của từng kênh chỉnh bằng `/config channel set`.",
].join("\n");

const POLL_NOTE = "-# XP mặc định dùng khi admin không đặt XP riêng lúc tạo vote. Giới hạn XP từ vote tính theo ngày giờ Việt Nam; "
	+ "0 là không giới hạn. Điểm ghi nhận cộng cho tác giả contribution. Admin luôn tạo được vote.";

const ADMIN_NOTE = "-# Người có quyền Manage Server luôn là admin. Role admin muốn dùng lệnh thì cần được cho phép trong "
	+ "**Server Settings → Integrations**.";

function textDisplay(content: string): TextDisplayBuilder
{
	return new TextDisplayBuilder().setContent(content);
}

function separator(): SeparatorBuilder
{
	return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

type PanelRowComponent = ButtonBuilder | ChannelSelectMenuBuilder | RoleSelectMenuBuilder | StringSelectMenuBuilder;

function row<T extends PanelRowComponent>(...components: T[]): ActionRowBuilder<T>
{
	return new ActionRowBuilder<T>().addComponents(...components);
}

function button(action: ConfigPanelAction, label: string, style: ButtonStyle): ButtonBuilder
{
	return new ButtonBuilder().setCustomId(configPanelId(action)).setLabel(label).setStyle(style);
}

/** Một danh sách có tiêu đề in đậm; các dòng cắt vừa `max` ký tự (luôn giữ tiêu đề), phần bị cắt gộp thành "… và N {unit} khác". */
function listSection(head: string, lines: readonly string[], empty: string, max: number, unit: string): string
{
	const title = `**${head}**`;
	const body = lines.length === 0
		? empty
		: fitLines(lines, Math.max(0, max - title.length - 1), hidden => `… và ${formatNumber(hidden)} ${unit} khác`);
	return `${title}\n${body}`;
}

function settingLines(settings: GuildSettings, keys: readonly (keyof GuildSettings)[]): string[]
{
	return keys.map(key => settingLine(key, settings[key]));
}

/** Kênh có XP hoặc cooldown riêng (khác giá trị chung của server). */
function hasOwnXp(channel: ChannelSettings): boolean
{
	return channel.xpPerMessage !== null || channel.xpCooldownSeconds !== null;
}

function tierSummary({ tierSet, tierRoleCount }: ConfigPanelData): string
{
	return `bộ **${tierSet.name}** · role đã gán **${formatNumber(tierRoleCount)}/${formatNumber(tierSet.tiers.length)}**`;
}

// ---------- Khung chung: tiêu đề, notice, menu chọn trang ----------

/**
 * Menu chọn trang. Không đánh dấu `default` cho trang hiện tại (placeholder ghi trang đang xem), để chọn lại đúng trang đó
 * vẫn sinh interaction, tức là làm mới trang.
 */
function navSelect(page: ConfigPanelPage): StringSelectMenuBuilder
{
	return new StringSelectMenuBuilder()
		.setCustomId(configPanelId({ type: "nav" }))
		.setPlaceholder(`📍 Đang xem: ${PAGE_INFO[page].label} · chọn để chuyển trang hoặc làm mới`)
		.setMinValues(1)
		.setMaxValues(1)
		.addOptions(CONFIG_PANEL_PAGES.map(key => ({
			label: PAGE_INFO[key].label,
			value: key,
			description: PAGE_INFO[key].description,
			emoji: { name: PAGE_INFO[key].emoji },
		})));
}

function isMissing(data: ConfigPanelData, id: string | null): boolean
{
	return id !== null && (data.missingIds?.has(id) ?? false);
}

const MISSING_ROLE_NOTE = "⚠️ Role đã lưu không còn trong server.";

// ---------- Trang tổng quan ----------

function homeText(data: ConfigPanelData): string
{
	const { settings, channels, teams, boardChannelId } = data;
	const mode = settings.xpChannelMode;
	const enabled = channels.filter(channel => channel.xpEnabled).length;
	const custom = channels.filter(channel => channel.xpEnabled && hasOwnXp(channel)).length;
	const channelLines = [
		"**📺 Kênh tính XP**",
		`• Chế độ: **${xpChannelModeLabel(mode)}**`,
		mode === "all"
			? `• Kênh đang tắt riêng: **${formatNumber(channels.length - enabled)}**`
			: `• Kênh đang bật: **${formatNumber(enabled)}**`,
	];
	if (custom > 0) channelLines.push(`• Kênh có XP hoặc cooldown riêng: **${formatNumber(custom)}**`);
	if (mode === "selected" && enabled === 0) channelLines.push(NO_XP_CHANNEL_WARNING);

	const sections = [
		channelLines,
		["**⭐ Activity XP**", ...settingLines(settings, XP_SETTING_KEYS)],
		["**🗳️ Vote và 🤝 contribution**", ...settingLines(settings, POLL_SETTING_KEYS)],
		[
			"**👥 Team, 🏆 Bảng vàng và 🔐 quyền**",
			`• Team: **${formatNumber(teams.length)}/${formatNumber(MAX_TEAMS)}**`,
			`• Bảng vàng: ${boardChannelId === null ? "**đang tắt**" : channelMention(boardChannelId)}`,
			settingLine("adminRoleId", settings.adminRoleId),
			`• Danh hiệu: ${tierSummary(data)}`,
		],
	];
	return sections.map(lines => lines.join("\n")).join("\n\n");
}

function addHomePage(container: ContainerBuilder, data: ConfigPanelData): void
{
	container.addTextDisplayComponents(textDisplay(homeText(data)), textDisplay(HOME_NOTE));
}

// ---------- Trang kênh tính XP ----------

/** "• #kênh", kèm mô tả nếu kênh đang bật XP và có XP hoặc cooldown riêng. */
function channelLine(channel: ChannelSettings, settings: GuildSettings): string
{
	const mention = channelMention(channel.channelId);
	return channel.xpEnabled && hasOwnXp(channel) ? `• ${mention}: ${describeChannelSettings(channel, settings)}` : `• ${mention}`;
}

/**
 * Danh sách kênh theo chế độ, gọn trong `max` ký tự: chế độ selected liệt kê kênh đang tính XP (cảnh báo nếu chưa có kênh nào);
 * chế độ all liệt kê kênh đang tắt XP, rồi kênh đang bật có XP hoặc cooldown riêng (nếu có).
 */
function channelListText({ settings, channels }: ConfigPanelData, max: number): string
{
	const line = (channel: ChannelSettings): string => channelLine(channel, settings);
	if (settings.xpChannelMode === "selected")
	{
		const enabled = channels.filter(channel => channel.xpEnabled).map(line);
		const empty = `${NO_XP_CHANNEL_WARNING} Chọn kênh ở ô ➕ bên dưới để bật.`;
		return listSection(`Kênh đang tính XP (${formatNumber(enabled.length)})`, enabled, empty, max, "kênh");
	}

	const disabled = channels.filter(channel => !channel.xpEnabled).map(line);
	const disabledHead = `Kênh đang tắt XP (${formatNumber(disabled.length)})`;
	const custom = channels.filter(channel => channel.xpEnabled && hasOwnXp(channel)).map(line);
	if (custom.length === 0) return listSection(disabledHead, disabled, "Không có kênh nào bị tắt.", max, "kênh");

	const gap = "\n\n";
	const customHead = `Kênh có XP hoặc cooldown riêng (${formatNumber(custom.length)})`;
	const customNeed = customHead.length + 5 + custom.join("\n").length;
	const reserve = Math.min(Math.floor(max / 2), customNeed) + gap.length;
	const first = listSection(disabledHead, disabled, "Không có kênh nào bị tắt.", max - reserve, "kênh");
	return first + gap + listSection(customHead, custom, "", max - first.length - gap.length, "kênh");
}

function modeButton(mode: XpChannelMode, current: XpChannelMode): ButtonBuilder
{
	const active = mode === current;
	const label = active ? `${MODE_BUTTON_LABELS[mode]} · đang dùng` : MODE_BUTTON_LABELS[mode];
	return button({ type: "mode", mode }, label, active ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(active);
}

function channelsSelect(enabled: boolean): ChannelSelectMenuBuilder
{
	return new ChannelSelectMenuBuilder()
		.setCustomId(configPanelId({ type: "channels", enabled }))
		.setPlaceholder(enabled ? "➕ Bật tính XP cho kênh…" : "➖ Tắt tính XP cho kênh…")
		.setChannelTypes(...XP_CHANNEL_TYPES)
		.setMinValues(1)
		.setMaxValues(SELECT_MAX_VALUES);
}

/**
 * Kênh có trạng thái lưu riêng mà chế độ hiện tại không cần tới (chế độ all: kênh bật riêng không có XP/cooldown riêng;
 * chế độ selected: kênh tắt riêng). Không liệt kê, chỉ nhắc số lượng vì chúng giữ nguyên trạng thái khi đổi chế độ.
 */
function pinnedChannelsNote({ settings, channels }: ConfigPanelData): string | null
{
	if (settings.xpChannelMode === "all")
	{
		const pinned = channels.filter(channel => channel.xpEnabled && !hasOwnXp(channel)).length;
		return pinned === 0 ? null : `-# ${formatNumber(pinned)} kênh được bật riêng: vẫn tính XP nếu chuyển sang chế độ chỉ kênh được bật.`;
	}
	const pinned = channels.filter(channel => !channel.xpEnabled).length;
	return pinned === 0 ? null : `-# ${formatNumber(pinned)} kênh bị tắt riêng: vẫn tắt nếu chuyển sang chế độ tất cả kênh.`;
}

function addChannelsPage(container: ContainerBuilder, data: ConfigPanelData, budget: number): void
{
	const mode = data.settings.xpChannelMode;
	const pinned = pinnedChannelsNote(data);
	const modeText = [`**Chế độ hiện tại: ${xpChannelModeLabel(mode)}**`, MODE_DETAILS[mode], ...(pinned === null ? [] : [pinned])].join("\n");
	const listMax = Math.min(LIST_MAX, budget - modeText.length - CHANNELS_NOTE.length);
	container
		.addTextDisplayComponents(textDisplay(modeText))
		.addActionRowComponents(row(modeButton("all", mode), modeButton("selected", mode)))
		.addSeparatorComponents(separator())
		.addTextDisplayComponents(textDisplay(channelListText(data, listMax)))
		.addActionRowComponents(row(channelsSelect(true)), row(channelsSelect(false)))
		.addTextDisplayComponents(textDisplay(CHANNELS_NOTE));
}

// ---------- Trang team ----------

/** Ô chọn role thêm hoặc bỏ team; khoá lại khi đã đủ MAX_TEAMS team (thêm) hoặc chưa có team nào (bỏ). */
function teamSelect(add: boolean, teamCount: number): RoleSelectMenuBuilder
{
	const full = teamCount >= MAX_TEAMS;
	const none = teamCount === 0;
	let placeholder = add ? "➕ Thêm team…" : "➖ Bỏ team…";
	if (add && full) placeholder = `Đã đủ ${formatNumber(MAX_TEAMS)} team, hãy bỏ bớt trước khi thêm`;
	if (!add && none) placeholder = "Chưa có team nào để bỏ";
	return new RoleSelectMenuBuilder()
		.setCustomId(configPanelId({ type: "teams", add }))
		.setPlaceholder(placeholder)
		.setMinValues(1)
		.setMaxValues(Math.min(SELECT_MAX_VALUES, MAX_TEAMS))
		.setDisabled(add ? full : none);
}

function addTeamsPage(container: ContainerBuilder, data: ConfigPanelData, budget: number): void
{
	const { teams } = data;
	const lines = teams.map((roleId, index) => `${index + 1}. ${roleMention(roleId)}${isMissing(data, roleId) ? " ⚠️ không còn trong server" : ""}`);
	const head = `Team đang có (${formatNumber(teams.length)}/${formatNumber(MAX_TEAMS)})`;
	const empty = "Chưa có team nào. Chọn role ở ô ➕ bên dưới để thêm.";
	const listMax = Math.min(LIST_MAX, budget - TEAMS_NOTE.length);
	container
		.addTextDisplayComponents(textDisplay(listSection(head, lines, empty, listMax, "team")))
		.addActionRowComponents(row(teamSelect(true, teams.length)), row(teamSelect(false, teams.length)))
		.addTextDisplayComponents(textDisplay(TEAMS_NOTE));
}

// ---------- Trang Activity XP ----------

function addXpPage(container: ContainerBuilder, { settings }: ConfigPanelData): void
{
	const announce = settings.levelUpAnnouncements;
	container
		.addTextDisplayComponents(textDisplay(["**⭐ Activity XP và chống spam**", ...settingLines(settings, XP_SETTING_KEYS), XP_NOTE].join("\n")))
		.addActionRowComponents(row(
			button({ type: "xpForm" }, "✏️ Sửa số", ButtonStyle.Primary),
			button(
				{ type: "announce", enabled: !announce },
				announce ? "🔕 Tắt thông báo lên level" : "🔔 Bật thông báo lên level",
				ButtonStyle.Secondary,
			),
		));
}

// ---------- Trang vote và contribution ----------

/** Ô chọn một role, cho phép bỏ chọn; điền sẵn role hiện tại nếu có và còn trong server (`prefill`). */
function singleRoleSelect(action: ConfigPanelAction, placeholder: string, roleId: string | null, prefill: boolean): RoleSelectMenuBuilder
{
	const select = new RoleSelectMenuBuilder()
		.setCustomId(configPanelId(action))
		.setPlaceholder(placeholder)
		.setMinValues(0)
		.setMaxValues(1);
	return roleId === null || !prefill ? select : select.setDefaultRoles(roleId);
}

function addPollPage(container: ContainerBuilder, data: ConfigPanelData): void
{
	const { settings } = data;
	const roleId = settings.pollCreatorRoleId;
	const missing = isMissing(data, roleId);
	const lines = ["**🗳️ Vote và 🤝 contribution**", ...settingLines(settings, POLL_SETTING_KEYS)];
	if (missing) lines.push(`${MISSING_ROLE_NOTE} Chọn role khác, hoặc xoá bằng \`/config poll xoa-role-tao-vote:True\`.`);
	container
		.addTextDisplayComponents(textDisplay([...lines, POLL_NOTE].join("\n")))
		.addActionRowComponents(row(button({ type: "pollForm" }, "✏️ Sửa số", ButtonStyle.Primary)))
		.addActionRowComponents(row(singleRoleSelect(
			{ type: "pollRole", drawnRoleId: roleId },
			"Role được tạo vote (bỏ chọn = chỉ admin)",
			roleId,
			!missing,
		)));
}

// ---------- Trang Bảng vàng và quyền ----------

function boardSelect(boardChannelId: string | null, prefill: boolean): ChannelSelectMenuBuilder
{
	const select = new ChannelSelectMenuBuilder()
		.setCustomId(configPanelId({ type: "board" }))
		.setPlaceholder(boardChannelId === null ? "Chọn kênh đặt Bảng vàng…" : "Chuyển Bảng vàng sang kênh khác…")
		.setChannelTypes(...BOARD_CHANNEL_TYPES)
		.setMinValues(1)
		.setMaxValues(1);
	return boardChannelId === null || !prefill ? select : select.setDefaultChannels(boardChannelId);
}

function addBoardPage(container: ContainerBuilder, data: ConfigPanelData): void
{
	const { settings, boardChannelId } = data;
	const boardMissing = isMissing(data, boardChannelId);
	let boardText = boardChannelId === null
		? "Đang tắt. Chọn kênh bên dưới để bật."
		: `Đang đặt ở ${channelMention(boardChannelId)}; bot giữ một message bảng xếp hạng ở đó và tự cập nhật định kỳ.`;
	if (boardMissing) boardText += "\n⚠️ Bot không còn thấy kênh này (đã bị xoá hoặc bot mất quyền xem). Chọn kênh khác hoặc tắt Bảng vàng.";
	const adminRoleId = settings.adminRoleId;
	const adminMissing = isMissing(data, adminRoleId);
	const adminLines = ["**🔐 Quyền admin bot**", settingLine("adminRoleId", adminRoleId)];
	if (adminMissing) adminLines.push(`${MISSING_ROLE_NOTE} Chọn role khác, hoặc xoá bằng \`/config admin-role\` (bỏ trống role).`);
	container
		.addTextDisplayComponents(textDisplay(`**🏆 Bảng vàng**\n${boardText}`))
		.addActionRowComponents(row(boardSelect(boardChannelId, !boardMissing)))
		.addActionRowComponents(row(button({ type: "boardOff" }, "Tắt Bảng vàng", ButtonStyle.Danger).setDisabled(boardChannelId === null)))
		.addSeparatorComponents(separator())
		.addTextDisplayComponents(textDisplay([...adminLines, ADMIN_NOTE].join("\n")))
		.addActionRowComponents(row(singleRoleSelect(
			{ type: "adminRole", drawnRoleId: adminRoleId },
			"Role admin bot (bỏ chọn = chỉ người có Manage Server)",
			adminRoleId,
			!adminMissing,
		)))
		.addSeparatorComponents(separator())
		.addTextDisplayComponents(textDisplay(`**🏅 Danh hiệu:** ${tierSummary(data)}`))
		.addActionRowComponents(row(button({ type: "tierPanel" }, "🏅 Mở bảng danh hiệu", ButtonStyle.Secondary)));
}

/**
 * Bảng cấu hình của một trang (Components V2, màu nhấn COLORS.primary): tiêu đề kèm tên trang, `notice` nguyên văn nếu có
 * (dài quá CONFIG_PANEL_NOTICE_MAX thì cắt), menu chọn trang (`nav`, placeholder ghi trang đang xem), rồi nội dung trang.
 * Trang nhiều nhất (board) có 19 component tính cả lồng nhau, dưới giới hạn 40; danh sách kênh và team cắt bằng fitLines để
 * tổng chữ của mọi TextDisplay ≤ 4.000. Mọi customId từ configPanelId.
 */
export function buildConfigPanel(page: ConfigPanelPage, data: ConfigPanelData): ContainerBuilder
{
	const title = `## ⚙️ Bảng cấu hình bot · ${PAGE_INFO[page].label}`;
	const notice = data.notice ? truncate(data.notice, CONFIG_PANEL_NOTICE_MAX) : null;
	const container = new ContainerBuilder().setAccentColor(COLORS.primary).addTextDisplayComponents(textDisplay(title));
	if (notice) container.addTextDisplayComponents(textDisplay(notice));
	container.addActionRowComponents(row(navSelect(page))).addSeparatorComponents(separator());

	const budget = TEXT_TOTAL_MAX - title.length - (notice?.length ?? 0);
	switch (page)
	{
	case "home": addHomePage(container, data); break;
	case "channels": addChannelsPage(container, data, budget); break;
	case "teams": addTeamsPage(container, data, budget); break;
	case "xp": addXpPage(container, data); break;
	case "poll": addPollPage(container, data); break;
	case "board": addBoardPage(container, data); break;
	}
	return container;
}

/** Phản hồi mở bảng: trả lời riêng, Components V2. */
export function configPanelReply(page: ConfigPanelPage, data: ConfigPanelData): InteractionReplyOptions
{
	return { components: [buildConfigPanel(page, data)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 };
}

/** Nội dung thay cho bảng hiện có (update, hoặc editReply sau deferUpdate). */
export function configPanelUpdate(page: ConfigPanelPage, data: ConfigPanelData): InteractionUpdateOptions
{
	return { components: [buildConfigPanel(page, data)], flags: MessageFlags.IsComponentsV2 };
}

// ---------- Form sửa số ----------

interface FormField
{
	/** Nhãn ô (≤ 45 ký tự). */
	label: string;
	/** Ý nghĩa, đứng đầu mô tả ô; mô tả còn ghi khoảng hợp lệ theo SETTING_LIMITS. */
	hint: string;
}

const FORM_FIELDS: Readonly<Record<NumericSettingKey, FormField>> = {
	xpPerMessage: { label: "XP mỗi tin nhắn", hint: "XP cho mỗi tin nhắn hợp lệ" },
	xpCooldownSeconds: { label: "Cooldown (giây)", hint: "Thời gian chờ giữa hai lần một người được XP từ tin nhắn" },
	minMessageLength: { label: "Độ dài tin tối thiểu (ký tự)", hint: "Tin ngắn hơn số ký tự này không được XP" },
	duplicateWindowSeconds: { label: "Khoảng chống trùng (giây)", hint: "Tin trùng tin trước đó của cùng người trong khoảng này không được XP" },
	defaultPollXp: { label: "XP mặc định khi vote", hint: "XP cho mỗi người tham gia, khi admin không đặt riêng lúc tạo vote" },
	pollXpDailyCap: { label: "Giới hạn XP từ vote mỗi ngày", hint: "XP tối đa một người nhận từ vote mỗi ngày; 0 = không giới hạn" },
	contributionVotePoints: { label: "Điểm mỗi lượt ghi nhận", hint: "Điểm cộng cho tác giả contribution mỗi lượt ghi nhận" },
};

/** Ô số bắt buộc, customId là khoá cấu hình, điền sẵn giá trị hiện tại; mô tả ghi ý nghĩa và khoảng hợp lệ. */
function numberInput(key: NumericSettingKey, value: number): LabelBuilder
{
	const { min, max } = SETTING_LIMITS[key];
	const field = FORM_FIELDS[key];
	return new LabelBuilder()
		.setLabel(field.label)
		.setDescription(truncate(`${field.hint}. Từ ${formatNumber(min)} đến ${formatNumber(max)}.`, LABEL_DESCRIPTION_MAX))
		.setTextInputComponent(new TextInputBuilder()
			.setCustomId(key)
			.setStyle(TextInputStyle.Short)
			.setRequired(true)
			.setMaxLength(NUMBER_INPUT_MAX)
			.setPlaceholder(`Mặc định: ${formatNumber(DEFAULT_GUILD_SETTINGS[key])}`)
			.setValue(String(value)));
}

/** Form XP: 4 ô số điền sẵn giá trị hiện tại; customId của form là configPanelId({ type: "xpSave", drawn }). */
export function buildXpSettingsModal(settings: GuildSettings): ModalBuilder
{
	const drawn: XpFormValues = {
		xpPerMessage: settings.xpPerMessage,
		xpCooldownSeconds: settings.xpCooldownSeconds,
		minMessageLength: settings.minMessageLength,
		duplicateWindowSeconds: settings.duplicateWindowSeconds,
	};
	const modal = new ModalBuilder().setCustomId(configPanelId({ type: "xpSave", drawn })).setTitle("⭐ Activity XP và chống spam");
	for (const key of XP_FORM_KEYS) modal.addLabelComponents(numberInput(key, drawn[key]));
	return modal;
}

/** Form vote/contribution: 3 ô số điền sẵn; customId là configPanelId({ type: "pollSave", drawn }). */
export function buildPollSettingsModal(settings: GuildSettings): ModalBuilder
{
	const drawn: PollFormValues = {
		defaultPollXp: settings.defaultPollXp,
		pollXpDailyCap: settings.pollXpDailyCap,
		contributionVotePoints: settings.contributionVotePoints,
	};
	const modal = new ModalBuilder().setCustomId(configPanelId({ type: "pollSave", drawn })).setTitle("🗳️ Vote và contribution");
	for (const key of POLL_FORM_KEYS) modal.addLabelComponents(numberInput(key, drawn[key]));
	return modal;
}
