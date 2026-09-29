// Hàm thuần dựng bảng điều khiển cấu hình chung `/config panel` (PROP-033, DEC-037): Components V2, form sửa số, mã hoá customId.
import {
	ChannelType,
	ContainerBuilder,
	InteractionReplyOptions,
	InteractionUpdateOptions,
	LabelBuilder,
	MessageFlags,
	ModalBuilder,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";
import { TierSet } from "../../modules/activity/tiers";
import { ChannelSettings, GuildSettings, isXpChannelMode, NumericSettingKey, SETTING_LIMITS, XpChannelMode } from "../../modules/guild-config/types";
import { UserError } from "../../shared/errors";

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
 * Đọc một ô số trong form: bỏ khoảng trắng và dấu chấm/phẩy ngăn cách hàng nghìn ("1.000" = 1000), phải là số nguyên trong
 * SETTING_LIMITS; UserError tiếng Việt kèm nhãn nếu sai.
 */
export function parseFormNumber(raw: string, key: NumericSettingKey): number
{
	const limit = SETTING_LIMITS[key];
	const text = raw.replace(/[\s.,]/gu, "");
	const value = /^\d{1,9}$/u.test(text) ? Number(text) : Number.NaN;
	if (!Number.isInteger(value) || value < limit.min || value > limit.max)
	{
		throw new UserError(`${limit.label} phải là số nguyên từ ${limit.min} đến ${limit.max} (bạn nhập "${raw.trim().slice(0, 20)}").`);
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
	 * Kết quả thao tác vừa làm (ví dụ "Đã bật XP cho 3 kênh"), hiển thị NGUYÊN VĂN trong một TextDisplay ở đầu trang;
	 * null/undefined = không có. Thay cho tin nhắn phản hồi riêng.
	 */
	notice?: string | null;
}

// ---------- Dựng giao diện (agent giao diện hoàn thiện; bản tối thiểu dưới đây chỉ để handler và test chạy được) ----------

/**
 * Bảng cấu hình của một trang (Components V2). Mọi trang có menu chọn trang (`nav`, điền sẵn trang hiện tại) và hiện `notice`
 * nguyên văn nếu có. Tổng số component (tính cả lồng nhau) ≤ 40, mọi customId từ configPanelId.
 */
export function buildConfigPanel(page: ConfigPanelPage, data: ConfigPanelData): ContainerBuilder
{
	const container = new ContainerBuilder();
	if (data.notice) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(data.notice));
	return container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ⚙️ Cấu hình bot · ${page}`));
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

function numberInput(key: NumericSettingKey, value: number): LabelBuilder
{
	const limit = SETTING_LIMITS[key];
	return new LabelBuilder()
		.setLabel(limit.label)
		.setDescription(`Số nguyên từ ${limit.min} đến ${limit.max}`)
		.setTextInputComponent(new TextInputBuilder()
			.setCustomId(key)
			.setStyle(TextInputStyle.Short)
			.setRequired(true)
			.setMaxLength(9)
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
	const modal = new ModalBuilder().setCustomId(configPanelId({ type: "xpSave", drawn })).setTitle("Activity XP và chống spam");
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
	const modal = new ModalBuilder().setCustomId(configPanelId({ type: "pollSave", drawn })).setTitle("Vote và contribution");
	for (const key of POLL_FORM_KEYS) modal.addLabelComponents(numberInput(key, drawn[key]));
	return modal;
}
