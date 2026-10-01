import {
	AnySelectMenuInteraction,
	ButtonInteraction,
	ChannelSelectMenuInteraction,
	ChatInputCommandInteraction,
	Guild,
	GuildMember,
	MessageComponentInteraction,
	MessageFlags,
	ModalMessageModalSubmitInteraction,
	ModalSubmitInteraction,
	PermissionFlagsBits,
	RoleSelectMenuInteraction,
	SlashCommandBuilder,
	SlashCommandSubcommandBuilder,
	SlashCommandSubcommandGroupBuilder,
	StringSelectMenuInteraction,
} from "discord.js";
import Command from "../../classes/Command";
import { channelMention, roleMention } from "../../discord/format";
import {
	assertBoardChannelAccess,
	assertUsableRole,
	botMemberOf,
	DEFAULT_LIVE_BOARD_ACTIONS,
	isBoardChannel,
	LiveBoardActions,
	moveLiveBoard,
	renameInput,
	resolveContributionChannel,
	resolveLevelUpChannel,
	ROLE_GRANT_PURPOSES,
	roleGrantChanged,
	roleGrantChangeLines,
	turnOffLiveBoard,
} from "../../discord/configOps";
import { requireGuildId } from "../../discord/guards";
import {
	assignTierRole,
	callerManageRolesIssue,
	callerRoleIssue,
	clearTierRoleAssignment,
	syncTierSetRoles,
	TierRoleActor,
	tierRoleActor,
	TierRoleAssignment,
} from "../../discord/tierRoleSetup";
import {
	buildChannelListEmbed,
	buildConfigEmbed,
	buildTeamListEmbed,
	channelModeChangedText,
	describeChannelSettings,
	describeSettingsPatch,
	ephemeral,
	ephemeralEmbed,
	settingLine,
	xpChannelModeLabel,
} from "../../discord/views/admin";
import {
	BOARD_CHANNEL_TYPES,
	buildPollSettingsModal,
	buildXpSettingsModal,
	CONFIG_PANEL_NAMESPACE,
	ConfigPanelAction,
	ConfigPanelData,
	ConfigPanelPage,
	configPanelReply,
	configPanelUpdate,
	GRANT_ACTION_KEYS,
	INVALID_CONFIG_PANEL,
	isConfigPanelPage,
	pageOfAction,
	parseConfigPanelId,
	parseFormNumber,
	POLL_FORM_KEYS,
	roleListFingerprint,
	XP_CHANNEL_TYPES,
	XP_FORM_KEYS,
} from "../../discord/views/configPanel";
import {
	buildTierRenameModal,
	buildTierRoleListEmbed,
	buildTierSetupReport,
	INVALID_PANEL_ACTION,
	parseTierPanelId,
	TIER_PANEL_NAMESPACE,
	TIER_ROLE_DEDICATED_NOTE,
	TIER_ROLE_SYNC_NOTE,
	tierKeysOfGroup,
	TierNameGroup,
	tierNamesFingerprint,
	TierPanelData,
	tierPanelReply,
	tierPanelUpdate,
	tierRoleClearedText,
	tierSetChangedHint,
	tierTitle,
} from "../../discord/views/tierPanel";
import {
	isTierKey,
	isTierSetKey,
	TIER_KEYS,
	TIER_LEVELS,
	TIER_SET_KEYS,
	TIER_SETS,
	TierKey,
	tierByKey,
	TierSetKey,
} from "../../modules/activity/tiers";
import { TierRoleMapping } from "../../modules/gamification/types";
import { BulkChannelResult, RoleGrantResult } from "../../modules/guild-config/GuildConfigService";
import {
	ChannelSettings,
	GuildSettings,
	isXpChannelMode,
	NumericSettingKey,
	RoleGrantKey,
	SETTING_LIMITS,
	XP_CHANNEL_MODES,
	XpChannelMode,
} from "../../modules/guild-config/types";
import { AppServices } from "../../services";
import { UserError } from "../../shared/errors";
import { logger } from "../../shared/logger";

const NO_CHANGE_MESSAGE = "Hãy chọn ít nhất một giá trị để thay đổi.";

/**
 * /admin và /config có default_member_permissions = Manage Server, nên Discord ẩn và chặn lệnh với người thiếu quyền đó
 * trước khi tới bot. Role admin bot chỉ dùng được hai lệnh khi server cho phép trong phần Integrations.
 */
const ADMIN_ROLE_INTEGRATION_HINT = "⚠️ Lưu ý: `/admin` và `/config` mặc định chỉ dành cho người có quyền Manage Server; "
	+ "Discord chặn những người khác trước khi lệnh tới bot. Để role này dùng được, vào **Server Settings → Integrations → chọn bot** "
	+ "rồi cho phép role này dùng `/admin` và `/config`.";

const ADMIN_ROLE_ADD_OPTION = "them";
const ADMIN_ROLE_REMOVE_OPTION = "bo";
const ADMIN_ROLE_CLEAR_OPTION = "bo-het";
const POLL_ROLE_ADD_OPTION = "role-tao-vote";
const POLL_ROLE_REMOVE_OPTION = "bo-role-tao-vote";
const POLL_ROLE_CLEAR_OPTION = "xoa-role-tao-vote";
const CONTRIBUTION_CHANNEL_OPTION = "kenh";
const REVIEWER_ROLE_ADD_OPTION = "role-duyet";
const REVIEWER_ROLE_REMOVE_OPTION = "bo-role-duyet";
const REVIEWER_ROLE_CLEAR_OPTION = "xoa-role-duyet";

export const ADMIN_ROLE_NO_OPTION = "Hãy chọn ít nhất một: `them` để thêm role admin bot, `bo` để bỏ một role, hoặc `bo-het` = True để xoá hết.";
export const ADMIN_ROLE_CONFLICT = "`bo-het` = True xoá mọi role admin bot, nên không dùng cùng `them` hay `bo`.";
export const POLL_ROLE_CONFLICT = "`xoa-role-tao-vote` = True xoá mọi role tạo vote, nên không dùng cùng `role-tao-vote` hay `bo-role-tao-vote`.";
export const REVIEWER_ROLE_CONFLICT = "`xoa-role-duyet` = True xoá mọi role duyệt contribution, nên không dùng cùng `role-duyet` hay `bo-role-duyet`.";

/** Dòng đầu phản hồi khi cấu hình contribution vừa đổi (`/config contribution`, bảng cấu hình). */
const CONTRIBUTION_UPDATED = "Đã cập nhật cấu hình contribution:";

/** Dòng đầu phản hồi khi một danh sách role được cấp quyền vừa đổi (DEC-044). */
const ROLE_GRANT_HEADINGS: Readonly<Record<RoleGrantKey, string>> = {
	adminRoleIds: "Đã cập nhật role admin bot. Người có quyền Manage Server vẫn luôn là admin.",
	pollCreatorRoleIds: "Đã cập nhật cấu hình vote:",
	contributionReviewerRoleIds: CONTRIBUTION_UPDATED,
};

/**
 * Phản hồi sau khi đổi danh sách role admin bot hoặc role tạo vote (lệnh `/config admin-role`, bảng cấu hình): kết quả từng role
 * và danh sách sau khi lưu; có thêm role admin bot thì nhắc cho phép role trong Integrations.
 */
function roleGrantNotice(key: RoleGrantKey, result: RoleGrantResult): string
{
	const lines = [roleGrantChanged(result) ? ROLE_GRANT_HEADINGS[key] : "Không có gì thay đổi:", ...roleGrantChangeLines(key, result)];
	if (key === "adminRoleIds" && result.added.length > 0) lines.push(ADMIN_ROLE_INTEGRATION_HINT);
	return lines.join("\n");
}

/** Lựa chọn bậc dạng trung tính "Bậc 3 (Lv 6+)", vì tên bậc đổi theo bộ và theo từng server (DEC-033); value là khoá bậc. */
const TIER_CHOICES = TIER_KEYS.map((key, index) => ({ name: `Bậc ${index + 1} (Lv ${TIER_LEVELS[index]}+)`, value: key }));

/** Lựa chọn bộ danh hiệu, ví dụ "Tu tiên (Luyện Khí → Độ Kiếp)"; value là khoá bộ. */
const TIER_SET_CHOICES = TIER_SET_KEYS.map(key =>
{
	const { name, tiers } = TIER_SETS[key];
	return { name: `${name} (${tiers[0].name} → ${tiers[tiers.length - 1].name})`, value: key };
});

/** Độ dài tối đa của option tên bậc (emoji + tên); kiểm tra chi tiết do TierSetService làm. */
const TIER_NAME_OPTION_MAX = 60;

/** Lựa chọn chế độ kênh tính XP (DEC-037); value là XpChannelMode. */
const XP_CHANNEL_MODE_CHOICES = XP_CHANNEL_MODES.map(mode => ({
	name: mode === "all" ? "Tất cả kênh (trừ kênh đã tắt)" : "Chỉ kênh được bật (kênh mới không tính XP)",
	value: mode,
}));

const LEVEL_UP_CHANNEL_OPTION = "kenh-thong-bao";
const LEVEL_UP_CHANNEL_CLEAR_OPTION = "bo-kenh-thong-bao";
export const LEVEL_UP_CHANNEL_CONFLICT = "Chỉ chọn một: `kenh-thong-bao` để đặt kênh nhận thông báo lên level, hoặc `bo-kenh-thong-bao` = True để thông báo ở kênh thành viên vừa nhắn.";
const CHANNEL_USE_GUILD_XP = "dung-chung-xp";
const CHANNEL_USE_GUILD_COOLDOWN = "dung-chung-cooldown";
export const CHANNEL_XP_CONFLICT = "Chỉ chọn một: `xp-moi-tin` để đặt XP riêng cho channel, hoặc `dung-chung-xp` = True để dùng XP chung của server.";
export const CHANNEL_COOLDOWN_CONFLICT = "Chỉ chọn một: `cooldown-giay` để đặt cooldown riêng cho channel, "
	+ "hoặc `dung-chung-cooldown` = True để dùng cooldown chung của server.";

const GUILD_UNAVAILABLE = "Không đọc được thông tin server. Vui lòng thử lại sau.";
const INVALID_TIER = "Bậc danh hiệu không hợp lệ.";
const INVALID_TIER_SET = "Bộ danh hiệu không hợp lệ.";
const SELECTED_ROLE_UNAVAILABLE = "Không tìm thấy role vừa chọn trong server. Vui lòng thử lại.";
const MANAGE_ROLES_WARNING = "⚠️ Bot chưa có quyền **Manage Roles** nên chưa gán được role. "
	+ "Hãy cấp quyền này cho role của bot và kéo role của bot lên trên các role danh hiệu (Server Settings → Roles).";
const SETUP_ROLES_HINT = "Tên và màu các role đã gán chưa đổi: dùng `/config tier setup-roles` (hoặc nút ✨ trong `/config tier panel`) "
	+ "để bot đổi theo (bot chỉ đổi tên role do bot tạo; role do admin tự gán giữ nguyên tên).";
export const RENAME_SET_CHANGED = "Bộ danh hiệu vừa được đổi trong lúc bạn nhập tên, nên bot chưa lưu gì. Hãy mở lại form đổi tên.";
export const RENAME_NAMES_CHANGED = "Tên bậc vừa được đổi ở nơi khác trong lúc bạn nhập, nên bot chưa lưu gì để không ghi đè. "
	+ "Bảng đã được cập nhật; hãy mở lại form đổi tên.";
export const RESET_SET_CHANGED = "Bộ danh hiệu vừa được đổi sau khi bảng này được vẽ, nên bot chưa khôi phục tên nào. "
	+ "Bảng đã được cập nhật; hãy kiểm tra rồi bấm lại nếu vẫn muốn.";
export const PANEL_ROLE_CHANGED = "Role của bậc này vừa được đổi ở nơi khác sau khi bảng được vẽ, nên bot chưa bỏ gán gì. "
	+ "Bảng đã được cập nhật; hãy kiểm tra rồi thao tác lại.";

// ---------- Bảng cấu hình chung `/config panel` (PROP-033, DEC-037) ----------

export const CONFIG_ROLES_CHANGED = "Danh sách role này vừa được đổi ở nơi khác sau khi bảng được vẽ, nên bot chưa lưu gì. "
	+ "Bảng đã được cập nhật; hãy kiểm tra rồi chọn lại.";
export const SELECT_AT_LEAST_ONE_ROLE = "Hãy chọn ít nhất một role.";
export const SELECTED_CHANNEL_UNAVAILABLE = "Không tìm thấy kênh vừa chọn trong server. Vui lòng thử lại.";
export const BOARD_CHANNEL_NOT_VISIBLE = "Bot không thấy kênh vừa chọn: có thể bot chưa có quyền **View Channel** ở kênh đó. "
	+ "Hãy cấp quyền View Channel, Send Messages, Attach Files cho bot ở kênh đó rồi chọn lại.";
export const FORM_UNCHANGED = "Không có gì thay đổi: bạn chưa sửa ô nào trong form.";

/** Component của bảng cấu hình trả lời bằng cách sửa chính bảng (update hoặc deferUpdate + editReply). */
type PanelComponentInteraction = ButtonInteraction | AnySelectMenuInteraction;

export type { LiveBoardActions } from "../../discord/configOps";

interface SettingOption
{
	name: string;
	key: NumericSettingKey;
	description: string;
}

/** Option số của `/config contribution` (DEC-051), map sang mục cấu hình của guild. */
const CONTRIBUTION_SETTING_OPTIONS: readonly SettingOption[] = [
	{ name: "diem-moi-luot", key: "contributionVotePoints", description: "Điểm cộng (👍) hoặc trừ (👎) cho tác giả mỗi lượt" },
	{ name: "xp-nguoi-bam", key: "contributionInteractionXp", description: "Activity XP cho người bấm 👍 hoặc 👎, một lần mỗi contribution" },
	{
		name: "gioi-han-xp-ngay",
		key: "contributionInteractionXpDailyCap",
		description: "XP tối đa một người nhận từ bấm 👍/👎 trong một ngày (0 = không giới hạn)",
	},
];

/** Option số của `/config xp`, map sang mục cấu hình của guild. */
const XP_SETTING_OPTIONS: readonly SettingOption[] = [
	{ name: "xp-moi-tin", key: "xpPerMessage", description: "XP cho mỗi tin nhắn hợp lệ" },
	{ name: "cooldown-giay", key: "xpCooldownSeconds", description: "Thời gian chờ giữa hai lần được XP của một người (giây)" },
	{ name: "do-dai-toi-thieu", key: "minMessageLength", description: "Số ký tự tối thiểu để tin nhắn được XP" },
	{ name: "chong-trung-giay", key: "duplicateWindowSeconds", description: "Tin trùng tin trước đó trong khoảng này (giây) không được XP" },
];

interface ConfigContext
{
	interaction: ChatInputCommandInteraction;
	guildId: string;
	actorId: string;
}

/** Option số nguyên có min/max lấy theo SETTING_LIMITS để Discord chặn giá trị sai ngay từ đầu. */
function addSettingOption(sub: SlashCommandSubcommandBuilder, option: SettingOption, required = false): SlashCommandSubcommandBuilder
{
	const limit = SETTING_LIMITS[option.key];
	return sub.addIntegerOption(builder => builder
		.setName(option.name)
		.setDescription(option.description)
		.setMinValue(limit.min)
		.setMaxValue(limit.max)
		.setRequired(required));
}

function addChannel(sub: SlashCommandSubcommandBuilder, description: string): SlashCommandSubcommandBuilder
{
	return sub.addChannelOption(option => option
		.setName("kenh")
		.setDescription(description)
		.addChannelTypes(...XP_CHANNEL_TYPES)
		.setRequired(true));
}

function addRole(sub: SlashCommandSubcommandBuilder, description: string, required: boolean): SlashCommandSubcommandBuilder
{
	return sub.addRoleOption(option => option.setName("role").setDescription(description).setRequired(required));
}

function xpSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder
{
	sub.setName("xp").setDescription("Chỉnh cấu hình Activity XP chung của server");
	for (const option of XP_SETTING_OPTIONS) addSettingOption(sub, option);
	return sub
		.addBooleanOption(option => option
			.setName("thong-bao-len-level")
			.setDescription("Bật hoặc tắt thông báo khi thành viên lên level"))
		.addChannelOption(option => option
			.setName(LEVEL_UP_CHANNEL_OPTION)
			.setDescription("Kênh nhận thông báo lên level (chỉ gửi vào kênh này)")
			.addChannelTypes(...BOARD_CHANNEL_TYPES))
		.addBooleanOption(option => option
			.setName(LEVEL_UP_CHANNEL_CLEAR_OPTION)
			.setDescription("True: bỏ kênh riêng, thông báo ở kênh thành viên vừa nhắn"));
}

function channelSetSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder
{
	addChannel(sub.setName("set").setDescription("Đặt cấu hình XP riêng cho một channel"), "Channel cần cấu hình");
	sub.addBooleanOption(option => option.setName("bat-xp").setDescription("Bật hoặc tắt XP trong channel này"));
	addSettingOption(sub, { name: "xp-moi-tin", key: "xpPerMessage", description: "XP mỗi tin nhắn trong channel này" });
	sub.addBooleanOption(option => option
		.setName(CHANNEL_USE_GUILD_XP)
		.setDescription("True: channel này dùng XP mỗi tin chung của server (bỏ XP riêng)"));
	addSettingOption(sub, { name: "cooldown-giay", key: "xpCooldownSeconds", description: "Cooldown riêng trong channel này (giây)" });
	return sub.addBooleanOption(option => option
		.setName(CHANNEL_USE_GUILD_COOLDOWN)
		.setDescription("True: channel này dùng cooldown chung của server (bỏ cooldown riêng)"));
}

/** Giá trị riêng của channel theo option: số nếu có nhập, null nếu chọn dùng giá trị chung, undefined nếu không đổi (PROP-030). */
function channelOverride(value: number | null, useGuild: boolean, conflict: string): number | null | undefined
{
	if (value !== null && useGuild) throw new UserError(conflict);
	if (value !== null) return value;
	return useGuild ? null : undefined;
}

function pollSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder
{
	sub.setName("poll").setDescription("Cấu hình vote: XP mặc định, giới hạn XP mỗi ngày và các role được tạo vote");
	addSettingOption(sub, { name: "xp-mac-dinh", key: "defaultPollXp", description: "XP mặc định cho người tham gia vote" });
	addSettingOption(sub, {
		name: "gioi-han-xp-ngay",
		key: "pollXpDailyCap",
		description: "XP tối đa một người nhận từ vote trong một ngày (0 = không giới hạn)",
	});
	return sub
		.addRoleOption(option => option.setName(POLL_ROLE_ADD_OPTION).setDescription("Thêm một role được phép tạo vote (ngoài admin)"))
		.addRoleOption(option => option.setName(POLL_ROLE_REMOVE_OPTION).setDescription("Bỏ một role khỏi danh sách role được tạo vote"))
		.addBooleanOption(option => option.setName(POLL_ROLE_CLEAR_OPTION).setDescription("True: xoá hết role tạo vote (chỉ admin tạo được vote)"));
}

function adminRoleSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder
{
	return sub
		.setName("admin-role")
		.setDescription("Thêm hoặc bỏ role được dùng lệnh admin của bot (được đặt nhiều role)")
		.addRoleOption(option => option.setName(ADMIN_ROLE_ADD_OPTION).setDescription("Thêm role này vào danh sách role admin bot"))
		.addRoleOption(option => option.setName(ADMIN_ROLE_REMOVE_OPTION).setDescription("Bỏ role này khỏi danh sách role admin bot"))
		.addBooleanOption(option => option
			.setName(ADMIN_ROLE_CLEAR_OPTION)
			.setDescription("True: xoá hết role admin bot (chỉ người có Manage Server là admin)"));
}

/**
 * `/config contribution` (DEC-051): mọi option đều không bắt buộc (chọn ít nhất một). Kênh lưu qua resolveContributionChannel như web;
 * role duyệt như role tạo vote của `/config poll`.
 */
function contributionSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder
{
	sub.setName("contribution").setDescription("Cấu hình contribution: kênh đăng, điểm mỗi lượt, XP người bấm, role duyệt");
	for (const option of CONTRIBUTION_SETTING_OPTIONS) addSettingOption(sub, option);
	return sub
		.addChannelOption(option => option
			.setName(CONTRIBUTION_CHANNEL_OPTION)
			.setDescription("Kênh bot đăng mọi contribution mới (thành viên gửi từ đâu cũng vào kênh này)")
			.addChannelTypes(...BOARD_CHANNEL_TYPES))
		.addRoleOption(option => option.setName(REVIEWER_ROLE_ADD_OPTION).setDescription("Thêm một role được duyệt contribution (ngoài admin)"))
		.addRoleOption(option => option.setName(REVIEWER_ROLE_REMOVE_OPTION).setDescription("Bỏ một role khỏi danh sách role duyệt contribution"))
		.addBooleanOption(option => option.setName(REVIEWER_ROLE_CLEAR_OPTION).setDescription("True: xoá hết role duyệt (chỉ admin duyệt được contribution)"));
}

function tierOption(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder
{
	return sub.addStringOption(option => option
		.setName("bac")
		.setDescription("Bậc danh hiệu (tên từng bậc theo bộ đang dùng: xem /config tier list)")
		.setRequired(true)
		.addChoices(...TIER_CHOICES));
}

function tierGroup(group: SlashCommandSubcommandGroupBuilder): SlashCommandSubcommandGroupBuilder
{
	return group
		.setName("tier")
		.setDescription("Bộ danh hiệu, tên bậc và role Discord bot tự gán theo bậc")
		.addSubcommand(sub => sub
			.setName("panel")
			.setDescription("Mở bảng điều khiển danh hiệu: chọn bộ, gán role từng bậc, đổi tên bậc, tạo role"))
		.addSubcommand(sub => addRole(
			tierOption(sub.setName("set-role").setDescription("Gán role cho một bậc danh hiệu (nên dùng role mới tạo riêng)")),
			"Role mới tạo riêng, bot sẽ tự gán cho thành viên đạt bậc này",
			true,
		))
		.addSubcommand(sub => tierOption(sub.setName("clear-role").setDescription("Bỏ role của một bậc danh hiệu")))
		.addSubcommand(sub => sub.setName("list").setDescription("Xem role của từng bậc danh hiệu"))
		.addSubcommand(sub => sub
			.setName("style")
			.setDescription("Chọn bộ danh hiệu: tên, emoji, màu các bậc và giọng văn thông báo")
			.addStringOption(option => option
				.setName("bo")
				.setDescription("Bộ danh hiệu")
				.setRequired(true)
				.addChoices(...TIER_SET_CHOICES)))
		.addSubcommand(sub => tierOption(sub.setName("rename").setDescription("Đổi tên và emoji một bậc của bộ đang dùng"))
			.addStringOption(option => option
				.setName("ten")
				.setDescription("Tên mới, emoji đặt ở đầu (ví dụ \"🟡 Kim Đan\"); bỏ trống để dùng lại tên mặc định")
				.setMaxLength(TIER_NAME_OPTION_MAX)))
		.addSubcommand(sub => sub.setName("reset-names").setDescription("Khôi phục tên mặc định cho mọi bậc của bộ đang dùng"))
		.addSubcommand(sub => sub
			.setName("setup-roles")
			.setDescription("Bot tạo role cho bậc chưa có role, đổi tên và màu role do bot tạo theo bộ đang dùng"));
}

function liveBoardSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder
{
	return sub
		.setName("board")
		.setDescription("Đặt kênh Bảng vàng (bảng xếp hạng dạng ảnh tự cập nhật) hoặc tắt Bảng vàng")
		.addChannelOption(option => option
			.setName("kenh")
			.setDescription("Kênh đăng Bảng vàng")
			.addChannelTypes(...BOARD_CHANNEL_TYPES))
		.addBooleanOption(option => option
			.setName("tat")
			.setDescription("Chọn True để tắt Bảng vàng và xoá message bảng xếp hạng cũ"));
}

/** Interaction trong server có trong cache (để đọc role, channel và quyền của bot); UserError nếu không có. */
function requireCachedGuild(interaction: ChatInputCommandInteraction): ChatInputCommandInteraction<"cached">
{
	if (!interaction.inCachedGuild()) throw new UserError(GUILD_UNAVAILABLE);
	return interaction;
}

/** customId thuộc bảng cấu hình chung (namespace `cfgui`); còn lại là bảng danh hiệu (`tierui`). */
function isConfigPanelCustomId(customId: string): boolean
{
	return customId.split(":", 1)[0] === CONFIG_PANEL_NAMESPACE;
}

/** Role đã chọn trong menu chọn role, theo dữ liệu Discord gửi kèm hoặc cache của server; UserError nếu không có. */
function selectedRole(interaction: RoleSelectMenuInteraction, roleId: string): { id: string; managed: boolean }
{
	const role = interaction.roles.get(roleId) ?? interaction.guild?.roles.cache.get(roleId);
	if (!role) throw new UserError(SELECTED_ROLE_UNAVAILABLE);
	return role;
}

/**
 * Kênh đã chọn trong menu chọn kênh bật/tắt XP. Discord đã lọc loại kênh theo menu, nhưng bot vẫn kiểm tra lại (không tin
 * dữ liệu từ client): kênh phải có trong dữ liệu Discord gửi kèm và thuộc XP_CHANNEL_TYPES.
 */
function selectedXpChannel(interaction: ChannelSelectMenuInteraction, channelId: string): string
{
	const channel = interaction.channels.get(channelId);
	if (!channel) throw new UserError(SELECTED_CHANNEL_UNAVAILABLE);
	if (!XP_CHANNEL_TYPES.some(type => type === channel.type))
	{
		throw new UserError(`Không bật/tắt XP được cho ${channelMention(channel.id)}: chỉ dùng được kênh chữ, kênh thông báo, forum, media, `
			+ "kênh voice hoặc stage (tin trong thread theo kênh cha).");
	}
	return channel.id;
}

function mentionList(ids: readonly string[], mention: (id: string) => string): string
{
	return ids.map(mention).join(", ");
}

/**
 * Kết quả bật/tắt XP nhiều kênh trên bảng: kênh đã đổi, kênh vốn đúng trạng thái; nhắc khi chế độ kênh (DEC-037) vốn đã cho
 * các kênh đó trạng thái này (bật kênh ở chế độ tất cả kênh, tắt kênh ở chế độ chỉ kênh được bật).
 */
function channelsToggledText(enabled: boolean, mode: XpChannelMode, result: BulkChannelResult): string
{
	const verb = enabled ? "bật" : "tắt";
	const lines: string[] = [];
	if (result.changed.length > 0) lines.push(`Đã ${verb} XP cho ${mentionList(result.changed, channelMention)}.`);
	if (result.unchanged.length > 0) lines.push(`Vốn đã ${verb} XP: ${mentionList(result.unchanged, channelMention)}.`);
	if (result.unchanged.length > 0 && enabled === (mode === "all"))
	{
		lines.push(enabled
			? `-# Server đang dùng chế độ **${xpChannelModeLabel(mode)}**: kênh không bị tắt riêng vốn đã tính XP, chỉ cần bật lại kênh đã tắt.`
			: `-# Server đang dùng chế độ **${xpChannelModeLabel(mode)}**: kênh chưa được bật riêng vốn không tính XP, chỉ cần tắt kênh đã bật.`);
	}
	return lines.join("\n");
}

/** Kết quả thêm hoặc bỏ nhiều team trên bảng: role đã đổi và role vốn đúng trạng thái (cùng ý với `/config team add|remove`). */
function teamsChangedText(add: boolean, changed: readonly string[], unchanged: readonly string[]): string
{
	const lines: string[] = [];
	if (changed.length > 0)
	{
		lines.push(add
			? `Đã thêm ${mentionList(changed, roleMention)} làm team. Điểm team chỉ tính từ các lượt kiếm điểm kể từ bây giờ.`
			: `Đã bỏ ${mentionList(changed, roleMention)} khỏi danh sách team. Điểm lịch sử vẫn được giữ.`);
	}
	if (unchanged.length > 0) lines.push(add ? `Vốn đã là team: ${mentionList(unchanged, roleMention)}.` : `Vốn không phải team: ${mentionList(unchanged, roleMention)}.`);
	return lines.join("\n");
}

function tierKeyOf(interaction: ChatInputCommandInteraction): TierKey
{
	const key = interaction.options.getString("bac", true);
	if (!isTierKey(key)) throw new UserError(INVALID_TIER);
	return key;
}

/** Role đang gán cho bậc `tierKey`; null nếu chưa gán. */
function assignedRole(mappings: readonly TierRoleMapping[], tierKey: TierKey): string | null
{
	return mappings.find(mapping => mapping.tierKey === tierKey)?.roleId ?? null;
}

/** Người thao tác role danh hiệu, từ interaction trong server có trong cache. */
function actorOf(interaction: { guild: Guild; member: GuildMember }): TierRoleActor
{
	return tierRoleActor(interaction.guild, interaction.member);
}

/** Ghi chú sau khi gán role cho một bậc: role cũ không còn do bot quản lý, bot chưa có Manage Roles. */
function assignmentNotes(roleId: string, assignment: TierRoleAssignment): string[]
{
	const notes: string[] = [];
	const previous = assignment.previousRoleId;
	if (previous !== null && previous !== roleId)
	{
		notes.push(`Role cũ ${roleMention(previous)} không còn do bot quản lý; bot không tự gỡ role đó khỏi những người đang có.`);
		if (assignment.previousCreatedByBot) notes.push("Role cũ do bot tạo; nếu không dùng nữa, hãy xoá thủ công trong **Server Settings → Roles**.");
	}
	if (!assignment.botCanManageRoles) notes.push(MANAGE_ROLES_WARNING);
	return notes;
}

function requireChange(patch: object): void
{
	if (Object.keys(patch).length === 0) throw new UserError(NO_CHANGE_MESSAGE);
}

// Cấu hình bot theo server. Hai lớp quyền: ManageGuild (Discord) + adminOnly (dispatcher, áp cả cho component của bảng điều khiển).
export default class ConfigCmd extends Command
{
	override adminOnly = true;

	override buttonIds = [TIER_PANEL_NAMESPACE, CONFIG_PANEL_NAMESPACE];

	/** Điểm inject để test thay bằng hàm giả; mặc định là các hàm thật của tầng Discord. */
	liveBoardActions: LiveBoardActions = DEFAULT_LIVE_BOARD_ACTIONS;

	data = new SlashCommandBuilder()
		.setName("config")
		.setDescription("Cấu hình bot cho server")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.addSubcommand(sub => sub
			.setName("view")
			.setDescription("Xem toàn bộ cấu hình hiện tại"))
		.addSubcommand(sub => sub
			.setName("panel")
			.setDescription("Mở bảng cấu hình trực quan: kênh tính XP, team, XP, vote, Bảng vàng, role admin"))
		.addSubcommand(xpSubcommand)
		.addSubcommandGroup(group => group
			.setName("channel")
			.setDescription("Cấu hình XP riêng cho từng channel")
			.addSubcommand(channelSetSubcommand)
			.addSubcommand(sub => addChannel(sub
				.setName("reset")
				.setDescription("Xoá cấu hình riêng, channel dùng lại cấu hình chung"), "Channel cần xoá cấu hình riêng"))
			.addSubcommand(sub => sub
				.setName("list")
				.setDescription("Xem các channel có cấu hình riêng"))
			.addSubcommand(sub => sub
				.setName("mode")
				.setDescription("Chọn kênh nào tính XP: tất cả kênh (trừ kênh tắt), hoặc chỉ kênh được bật")
				.addStringOption(option => option
					.setName("che-do")
					.setDescription("Chế độ kênh tính XP")
					.setRequired(true)
					.addChoices(...XP_CHANNEL_MODE_CHOICES))))
		.addSubcommandGroup(group => group
			.setName("team")
			.setDescription("Quản lý team (mỗi team là một Discord Role)")
			.addSubcommand(sub => addRole(sub
				.setName("add")
				.setDescription("Thêm một role làm team"), "Role đại diện cho team", true))
			.addSubcommand(sub => addRole(sub
				.setName("remove")
				.setDescription("Bỏ một role khỏi danh sách team"), "Role cần bỏ khỏi danh sách team", true))
			.addSubcommand(sub => sub
				.setName("list")
				.setDescription("Xem danh sách team")))
		.addSubcommand(adminRoleSubcommand)
		.addSubcommand(pollSubcommand)
		.addSubcommand(contributionSubcommand)
		.addSubcommandGroup(tierGroup)
		.addSubcommand(liveBoardSubcommand);

	private get services(): AppServices
	{
		return this.client.services;
	}

	async execute(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const context: ConfigContext = { interaction, guildId: requireGuildId(interaction), actorId: interaction.user.id };
		const group = interaction.options.getSubcommandGroup();
		const subcommand = interaction.options.getSubcommand();

		if (group === "channel") await this.executeChannel(context, subcommand);
		else if (group === "team") await this.executeTeam(context, subcommand);
		else if (group === "tier") await this.executeTier(context, subcommand);
		else if (subcommand === "view") await this.view(context);
		else if (subcommand === "panel") await interaction.reply(configPanelReply("home", this.configPanelData(context.guildId, context.interaction.guild)));
		else if (subcommand === "xp") await this.updateXp(context);
		else if (subcommand === "admin-role") await this.updateAdminRole(context);
		else if (subcommand === "poll") await this.updatePoll(context);
		else if (subcommand === "contribution") await this.updateContribution(context);
		else if (subcommand === "board") await this.updateLiveBoard(context);
		else throw new Error(`Subcommand không hợp lệ: /config ${group ?? ""} ${subcommand}`);
	}

	/**
	 * Nút của bảng cấu hình chung (`cfgui`, xem configPanelButton) hoặc của bảng điều khiển danh hiệu (`tierui`): tạo/đồng bộ
	 * role, mở form đổi tên, khôi phục tên mặc định.
	 */
	override async executeButton(interaction: ButtonInteraction): Promise<void>
	{
		if (isConfigPanelCustomId(interaction.customId))
		{
			await this.configPanelButton(interaction, parseConfigPanelId(interaction.customId));
			return;
		}
		const action = parseTierPanelId(interaction.customId);
		const guildId = requireGuildId(interaction);
		switch (action.type)
		{
		case "setup":
			await this.panelSetupRoles(interaction);
			break;
		case "rename":
			await interaction.showModal(buildTierRenameModal(this.services.tierSets.current(guildId), action.group));
			break;
		case "reset":
			await this.panelResetNames(interaction, action.setKey);
			break;
		default:
			throw new UserError(INVALID_PANEL_ACTION);
		}
	}

	/**
	 * Menu chọn của bảng cấu hình chung (`cfgui`, xem configPanelSelect) hoặc của bảng điều khiển danh hiệu (`tierui`): chọn bộ
	 * (StringSelect) hoặc gán role cho một bậc (RoleSelect).
	 */
	override async executeSelectMenu(interaction: AnySelectMenuInteraction): Promise<void>
	{
		if (isConfigPanelCustomId(interaction.customId))
		{
			await this.configPanelSelect(interaction, parseConfigPanelId(interaction.customId));
			return;
		}
		const action = parseTierPanelId(interaction.customId);
		if (action.type === "set" && interaction.isStringSelectMenu()) await this.panelSelectSet(interaction);
		else if (action.type === "role" && interaction.isRoleSelectMenu()) await this.panelAssignRole(interaction, action.tierKey, action.drawnRoleId);
		else throw new UserError(INVALID_PANEL_ACTION);
	}

	/**
	 * Form mở từ nút của một bảng (nên cập nhật được chính bảng đó): form số của bảng cấu hình chung (`cfgui`, xem
	 * configPanelModal) hoặc form đổi tên bậc của bảng điều khiển danh hiệu (`tierui`).
	 */
	override async executeModal(interaction: ModalSubmitInteraction): Promise<void>
	{
		if (isConfigPanelCustomId(interaction.customId))
		{
			await this.configPanelModal(interaction, parseConfigPanelId(interaction.customId));
			return;
		}
		const action = parseTierPanelId(interaction.customId);
		if (action.type !== "names" || !interaction.isFromMessage()) throw new UserError(INVALID_PANEL_ACTION);
		await this.panelRename(interaction, action.group, action.setKey, action.fingerprint);
	}

	private async executeChannel(context: ConfigContext, subcommand: string): Promise<void>
	{
		switch (subcommand)
		{
		case "set":
			await this.setChannel(context);
			break;
		case "reset":
			await this.resetChannel(context);
			break;
		case "list":
			await this.listChannels(context);
			break;
		case "mode":
			await this.setChannelMode(context);
			break;
		default:
			throw new Error(`Subcommand không hợp lệ: /config channel ${subcommand}`);
		}
	}

	private async executeTeam(context: ConfigContext, subcommand: string): Promise<void>
	{
		switch (subcommand)
		{
		case "add":
			await this.addTeam(context);
			break;
		case "remove":
			await this.removeTeam(context);
			break;
		case "list":
			await context.interaction.reply(ephemeralEmbed(buildTeamListEmbed(this.services.teams.list(context.guildId))));
			break;
		default:
			throw new Error(`Subcommand không hợp lệ: /config team ${subcommand}`);
		}
	}

	private async executeTier(context: ConfigContext, subcommand: string): Promise<void>
	{
		const { interaction, guildId } = context;
		switch (subcommand)
		{
		case "panel":
			await interaction.reply(tierPanelReply(this.panelData(guildId, interaction.guild)));
			break;
		case "set-role":
			await this.assignTierRoleCommand(context);
			break;
		case "clear-role":
			await this.clearTierRole(context);
			break;
		case "list":
			await interaction.reply(ephemeralEmbed(buildTierRoleListEmbed(this.services.tierSets.current(guildId), this.services.tierRoles.list(guildId))));
			break;
		case "style":
			await this.selectTierSet(context);
			break;
		case "rename":
			await this.renameTier(context);
			break;
		case "reset-names":
			await this.resetTierNames(context);
			break;
		case "setup-roles":
			await this.setupTierRoles(context);
			break;
		default:
			throw new Error(`Subcommand không hợp lệ: /config tier ${subcommand}`);
		}
	}

	private async view({ interaction, guildId }: ConfigContext): Promise<void>
	{
		const { guildConfig, teams, liveBoards, tierRoles, tierSets } = this.services;
		const embed = buildConfigEmbed(guildConfig.getSettings(guildId), teams.list(guildId), guildConfig.listChannels(guildId), {
			boardChannelId: liveBoards.get(guildId)?.channelId ?? null,
			tierRoles: tierRoles.list(guildId),
			tierSet: tierSets.current(guildId),
		});
		await interaction.reply(ephemeralEmbed(embed));
	}

	private updateSettings({ guildId, actorId }: ConfigContext, patch: Partial<GuildSettings>): GuildSettings
	{
		return this.services.guildConfig.updateSettings(guildId, patch, actorId);
	}

	private async updateXp(context: ConfigContext): Promise<void>
	{
		const { options } = context.interaction;
		const patch: Partial<GuildSettings> = {};
		for (const option of XP_SETTING_OPTIONS)
		{
			const value = options.getInteger(option.name);
			if (value !== null) patch[option.key] = value;
		}
		const announcements = options.getBoolean("thong-bao-len-level");
		if (announcements !== null) patch.levelUpAnnouncements = announcements;
		const levelUpChannel = this.levelUpChannelPatch(context);
		if (levelUpChannel !== undefined) patch.levelUpChannelId = levelUpChannel;
		requireChange(patch);

		this.updateSettings(context, patch);
		await context.interaction.reply(ephemeral(`Đã cập nhật cấu hình Activity XP:\n${describeSettingsPatch(patch).join("\n")}`));
	}

	/** Kênh thông báo lên level từ option (DEC-043): ID đã kiểm tra quyền, null nếu bỏ kênh riêng, undefined nếu không đổi. */
	private levelUpChannelPatch({ interaction: base }: ConfigContext): string | null | undefined
	{
		const channelOption = base.options.getChannel(LEVEL_UP_CHANNEL_OPTION);
		const clear = base.options.getBoolean(LEVEL_UP_CHANNEL_CLEAR_OPTION) ?? false;
		if (channelOption && clear) throw new UserError(LEVEL_UP_CHANNEL_CONFLICT);
		if (clear) return null;
		if (!channelOption) return undefined;
		const interaction = requireCachedGuild(base);
		return resolveLevelUpChannel(interaction.guild, channelOption.id, interaction.member);
	}

	private async setChannel({ interaction, guildId, actorId }: ConfigContext): Promise<void>
	{
		const { options } = interaction;
		const channel = options.getChannel("kenh", true);
		const patch: Partial<Omit<ChannelSettings, "channelId">> = {};
		const enabled = options.getBoolean("bat-xp");
		if (enabled !== null) patch.xpEnabled = enabled;
		const xpPerMessage = channelOverride(
			options.getInteger("xp-moi-tin"),
			options.getBoolean(CHANNEL_USE_GUILD_XP) ?? false,
			CHANNEL_XP_CONFLICT,
		);
		if (xpPerMessage !== undefined) patch.xpPerMessage = xpPerMessage;
		const cooldown = channelOverride(
			options.getInteger("cooldown-giay"),
			options.getBoolean(CHANNEL_USE_GUILD_COOLDOWN) ?? false,
			CHANNEL_COOLDOWN_CONFLICT,
		);
		if (cooldown !== undefined) patch.xpCooldownSeconds = cooldown;
		requireChange(patch);

		const { guildConfig } = this.services;
		const next = guildConfig.setChannel(guildId, channel.id, patch, actorId);
		const summary = describeChannelSettings(next, guildConfig.getSettings(guildId));
		await interaction.reply(ephemeral(`Đã cập nhật cấu hình XP của ${channelMention(channel.id)}: ${summary}.`));
	}

	private async resetChannel({ interaction, guildId, actorId }: ConfigContext): Promise<void>
	{
		const channel = interaction.options.getChannel("kenh", true);
		const { guildConfig } = this.services;
		const removed = guildConfig.resetChannel(guildId, channel.id, actorId);
		const consequence = guildConfig.getSettings(guildId).xpChannelMode === "all"
			? "và **tính XP** (server đang dùng chế độ tất cả kênh)"
			: "và **không tính XP** (server đang dùng chế độ chỉ kênh được bật)";
		await interaction.reply(ephemeral(removed
			? `Đã xoá cấu hình riêng của ${channelMention(channel.id)}. Channel này dùng lại cấu hình chung ${consequence}.`
			: `${channelMention(channel.id)} vốn không có cấu hình riêng.`));
	}

	private async setChannelMode({ interaction, guildId, actorId }: ConfigContext): Promise<void>
	{
		const mode = interaction.options.getString("che-do", true);
		if (!isXpChannelMode(mode)) throw new UserError("Chế độ kênh tính XP không hợp lệ.");
		await interaction.reply(ephemeral(this.applyChannelMode(guildId, mode, actorId)));
	}

	/**
	 * Đổi chế độ kênh tính XP (DEC-037), dùng chung cho `/config channel mode` và bảng cấu hình; trả về phản hồi. Chế độ
	 * không đổi thì chỉ báo lại, không ghi audit.
	 */
	private applyChannelMode(guildId: string, mode: XpChannelMode, actorId: string): string
	{
		const { guildConfig } = this.services;
		if (guildConfig.getSettings(guildId).xpChannelMode === mode) return `Server đang dùng chế độ này rồi: ${settingLine("xpChannelMode", mode)}`;
		guildConfig.updateSettings(guildId, { xpChannelMode: mode }, actorId);
		return channelModeChangedText(mode, guildConfig.listChannels(guildId));
	}

	private async listChannels({ interaction, guildId }: ConfigContext): Promise<void>
	{
		const { guildConfig } = this.services;
		await interaction.reply(ephemeralEmbed(buildChannelListEmbed(guildConfig.listChannels(guildId), guildConfig.getSettings(guildId))));
	}

	private async addTeam({ interaction, guildId, actorId }: ConfigContext): Promise<void>
	{
		const role = interaction.options.getRole("role", true);
		this.assertUsableRole(guildId, role, "làm team");
		const added = this.services.teams.add(guildId, role.id, actorId);
		await interaction.reply(ephemeral(added
			? `Đã thêm ${roleMention(role.id)} làm team. Điểm team chỉ tính từ các lượt kiếm điểm kể từ bây giờ.`
			: `${roleMention(role.id)} đã là team.`));
	}

	private async removeTeam({ interaction, guildId, actorId }: ConfigContext): Promise<void>
	{
		const role = interaction.options.getRole("role", true);
		const removed = this.services.teams.remove(guildId, role.id, actorId);
		await interaction.reply(ephemeral(removed
			? `Đã bỏ ${roleMention(role.id)} khỏi danh sách team. Điểm lịch sử vẫn được giữ.`
			: `${roleMention(role.id)} không phải team.`));
	}

	/**
	 * `/config admin-role` (DEC-044): `them` thêm một role (qua assertUsableRole), `bo` bỏ một role, `bo-het` xoá hết; `them` và
	 * `bo` dùng cùng lúc được, `bo-het` thì không đi cùng option khác.
	 */
	private async updateAdminRole(context: ConfigContext): Promise<void>
	{
		const { options } = context.interaction;
		const add = options.getRole(ADMIN_ROLE_ADD_OPTION);
		const remove = options.getRole(ADMIN_ROLE_REMOVE_OPTION);
		const clear = options.getBoolean(ADMIN_ROLE_CLEAR_OPTION) ?? false;
		if (clear && (add || remove)) throw new UserError(ADMIN_ROLE_CONFLICT);
		if (!add && !remove && !clear) throw new UserError(ADMIN_ROLE_NO_OPTION);
		if (add) this.assertUsableRole(context.guildId, add, ROLE_GRANT_PURPOSES.adminRoleIds);

		const result = this.changeRoleGrants(context, "adminRoleIds", add?.id ?? null, remove?.id ?? null, clear);
		await context.interaction.reply(ephemeral(roleGrantNotice("adminRoleIds", result)));
	}

	/**
	 * `/config poll`: số (XP mặc định, giới hạn XP mỗi ngày) và danh sách role tạo vote (`role-tao-vote` thêm, `bo-role-tao-vote`
	 * bỏ, `xoa-role-tao-vote` xoá hết; DEC-044). Đổi role trước (có thể bị từ chối vì quá giới hạn), rồi mới lưu số, để lỗi
	 * không để lại thay đổi dở.
	 */
	private async updatePoll(context: ConfigContext): Promise<void>
	{
		const { options } = context.interaction;
		const patch: Partial<GuildSettings> = {};
		const xp = options.getInteger("xp-mac-dinh");
		if (xp !== null) patch.defaultPollXp = xp;
		const dailyCap = options.getInteger("gioi-han-xp-ngay");
		if (dailyCap !== null) patch.pollXpDailyCap = dailyCap;
		const add = options.getRole(POLL_ROLE_ADD_OPTION);
		const remove = options.getRole(POLL_ROLE_REMOVE_OPTION);
		const clear = options.getBoolean(POLL_ROLE_CLEAR_OPTION) ?? false;
		if (clear && (add || remove)) throw new UserError(POLL_ROLE_CONFLICT);
		const hasNumbers = Object.keys(patch).length > 0;
		if (!hasNumbers && !add && !remove && !clear) throw new UserError(NO_CHANGE_MESSAGE);
		if (add) this.assertUsableRole(context.guildId, add, ROLE_GRANT_PURPOSES.pollCreatorRoleIds);

		const roles = add || remove || clear
			? this.changeRoleGrants(context, "pollCreatorRoleIds", add?.id ?? null, remove?.id ?? null, clear)
			: null;
		if (hasNumbers) this.updateSettings(context, patch);
		const changed = hasNumbers || (roles !== null && roleGrantChanged(roles));
		const lines = [
			changed ? "Đã cập nhật cấu hình vote:" : "Không có gì thay đổi:",
			...describeSettingsPatch(patch),
			...(roles === null ? [] : roleGrantChangeLines("pollCreatorRoleIds", roles)),
		];
		await context.interaction.reply(ephemeral(lines.join("\n")));
	}

	/**
	 * Đổi danh sách role `key` theo option của lệnh gõ: thêm `add` (đã qua assertUsableRole), bỏ `remove`, hoặc bỏ hết (`clear`),
	 * qua changeRoleGrants (một transaction, một audit; role vốn đúng trạng thái thì bỏ qua).
	 */
	private changeRoleGrants(context: ConfigContext, key: RoleGrantKey, add: string | null, remove: string | null, clear: boolean): RoleGrantResult
	{
		const { guildConfig } = this.services;
		const change = clear
			? { remove: guildConfig.getSettings(context.guildId)[key] }
			: { add: add === null ? [] : [add], remove: remove === null ? [] : [remove] };
		return guildConfig.changeRoleGrants(context.guildId, key, change, context.actorId);
	}

	/**
	 * `/config contribution` (DEC-051): số (điểm mỗi lượt, XP người bấm, giới hạn XP mỗi ngày), kênh contribution (người gọi và bot phải
	 * đủ quyền ở kênh đó, resolveContributionChannel) và danh sách role duyệt (`role-duyet` thêm, `bo-role-duyet` bỏ, `xoa-role-duyet` xoá
	 * hết; như role tạo vote). Kiểm tra kênh và role trước, đổi role rồi mới lưu số và kênh, để lỗi không để lại thay đổi dở.
	 */
	private async updateContribution(context: ConfigContext): Promise<void>
	{
		const { options } = context.interaction;
		const patch: Partial<GuildSettings> = {};
		for (const option of CONTRIBUTION_SETTING_OPTIONS)
		{
			const value = options.getInteger(option.name);
			if (value !== null) patch[option.key] = value;
		}
		const channelOption = options.getChannel(CONTRIBUTION_CHANNEL_OPTION);
		const add = options.getRole(REVIEWER_ROLE_ADD_OPTION);
		const remove = options.getRole(REVIEWER_ROLE_REMOVE_OPTION);
		const clear = options.getBoolean(REVIEWER_ROLE_CLEAR_OPTION) ?? false;
		if (clear && (add || remove)) throw new UserError(REVIEWER_ROLE_CONFLICT);
		if (Object.keys(patch).length === 0 && !channelOption && !add && !remove && !clear) throw new UserError(NO_CHANGE_MESSAGE);
		if (channelOption)
		{
			const interaction = requireCachedGuild(context.interaction);
			patch.contributionChannelId = resolveContributionChannel(interaction.guild, channelOption.id, interaction.member);
		}
		if (add) this.assertUsableRole(context.guildId, add, ROLE_GRANT_PURPOSES.contributionReviewerRoleIds);

		const roles = add || remove || clear
			? this.changeRoleGrants(context, "contributionReviewerRoleIds", add?.id ?? null, remove?.id ?? null, clear)
			: null;
		const hasSettings = Object.keys(patch).length > 0;
		if (hasSettings) this.updateSettings(context, patch);
		const changed = hasSettings || (roles !== null && roleGrantChanged(roles));
		const lines = [
			changed ? CONTRIBUTION_UPDATED : "Không có gì thay đổi:",
			...describeSettingsPatch(patch),
			...(roles === null ? [] : roleGrantChangeLines("contributionReviewerRoleIds", roles)),
		];
		await context.interaction.reply(ephemeral(lines.join("\n")));
	}

	/**
	 * Role dùng được vào một việc của bot (team, role admin bot, role tạo vote, role duyệt contribution): không phải @everyone hay
	 * role do integration quản lý, không phải role danh hiệu. Dùng chung cho lệnh gõ và bảng cấu hình.
	 */
	private assertUsableRole(guildId: string, role: { id: string; managed: boolean }, purpose: string): void
	{
		assertUsableRole(this.services, guildId, role, purpose);
	}

	// ---------- Danh hiệu (DEC-031, DEC-033) ----------

	/** Dữ liệu dựng bảng điều khiển; `guild` (nếu có trong cache) để nhận ra role đã gán nhưng không còn trong server. */
	private panelData(guildId: string, guild: Guild | null): TierPanelData
	{
		const mappings = this.services.tierRoles.list(guildId);
		const missingRoleIds = new Set(guild ? mappings.filter(mapping => !guild.roles.cache.has(mapping.roleId)).map(mapping => mapping.roleId) : []);
		return { set: this.services.tierSets.current(guildId), mappings, missingRoleIds };
	}

	/**
	 * Gán role cho một bậc (dùng chung kiểm tra với ô chọn role của bảng điều khiển, xem assignTierRole). Kiểm tra đồng bộ
	 * (bậc, quyền người gọi) trả lời ngay; tải lại thông tin bot là gọi REST nên defer trước để không quá hạn 3 giây.
	 */
	private async assignTierRoleCommand({ interaction: base, guildId }: ConfigContext): Promise<void>
	{
		const interaction = requireCachedGuild(base);
		const tier = tierByKey(tierKeyOf(interaction), this.services.tierSets.current(guildId));
		const role = interaction.options.getRole("role", true);
		const actor = actorOf(interaction);
		const callerIssue = callerRoleIssue(actor, role);
		if (callerIssue !== null) throw new UserError(callerIssue);

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const assignment = await assignTierRole(interaction.guild, actor, this.services, tier.key, role);
		const lines = [`Đã gán ${roleMention(role.id)} cho bậc ${tierTitle(tier)}.`, TIER_ROLE_SYNC_NOTE, TIER_ROLE_DEDICATED_NOTE];
		lines.push(...assignmentNotes(role.id, assignment));
		await interaction.editReply(lines.join("\n"));
	}

	/** Bỏ role của một bậc; role do bot tạo thì xoá luôn khỏi server nếu đủ điều kiện (xem clearTierRoleAssignment). */
	private async clearTierRole({ interaction: base, guildId }: ConfigContext): Promise<void>
	{
		const interaction = requireCachedGuild(base);
		const tier = tierByKey(tierKeyOf(interaction), this.services.tierSets.current(guildId));
		// Xoá role do bot tạo phải tải lại thông tin bot và gọi API xoá role: defer trước để không quá hạn 3 giây.
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const outcome = await clearTierRoleAssignment(interaction.guild, actorOf(interaction), this.services, tier.key);
		await interaction.editReply(tierRoleClearedText(outcome, tier));
	}

	private async selectTierSet({ interaction, guildId, actorId }: ConfigContext): Promise<void>
	{
		const key = interaction.options.getString("bo", true);
		if (!isTierSetKey(key)) throw new UserError(INVALID_TIER_SET);
		const { tierSets, tierRoles } = this.services;
		if (tierSets.currentKey(guildId) === key)
		{
			await interaction.reply(ephemeral(`Server đang dùng bộ danh hiệu **${TIER_SETS[key].name}**.`));
			return;
		}
		const set = tierSets.select(guildId, key, actorId);
		const lines = [
			`Đã chọn bộ danh hiệu **${set.name}** (${set.tiers[0].name} → ${set.tiers[set.tiers.length - 1].name}). `
				+ "Tên bậc, emoji, màu và giọng văn thông báo đổi theo bộ này; role đã gán theo bậc được giữ nguyên.",
		];
		if (tierRoles.list(guildId).length > 0) lines.push(SETUP_ROLES_HINT);
		await interaction.reply(ephemeral(lines.join("\n")));
	}

	private async renameTier({ interaction, guildId, actorId }: ConfigContext): Promise<void>
	{
		const tierKey = tierKeyOf(interaction);
		const raw = interaction.options.getString("ten") ?? "";
		const { tierSets, tierRoles } = this.services;
		const set = tierSets.rename(guildId, [renameInput(tierSets.current(guildId), tierKey, raw)], actorId);
		const tier = tierByKey(tierKey, set);

		const lines = [raw.trim() === ""
			? `Bậc ${tier.index + 1} dùng lại tên mặc định của bộ **${set.name}**: ${tierTitle(tier)}.`
			: `Đã đổi tên bậc ${tier.index + 1} của bộ **${set.name}** thành ${tierTitle(tier)}.`];
		if (assignedRole(tierRoles.list(guildId), tierKey) !== null) lines.push(SETUP_ROLES_HINT);
		await interaction.reply(ephemeral(lines.join("\n")));
	}

	private async resetTierNames({ interaction, guildId, actorId }: ConfigContext): Promise<void>
	{
		const { tierSets, tierRoles } = this.services;
		const hadCustomNames = tierSets.overrides(guildId, tierSets.currentKey(guildId)).length > 0;
		const set = tierSets.resetNames(guildId, actorId);
		if (!hadCustomNames)
		{
			await interaction.reply(ephemeral(`Bộ **${set.name}** vốn đang dùng tên mặc định.`));
			return;
		}
		const lines = [`Đã khôi phục tên mặc định cho mọi bậc của bộ **${set.name}**.`];
		if (tierRoles.list(guildId).length > 0) lines.push(SETUP_ROLES_HINT);
		await interaction.reply(ephemeral(lines.join("\n")));
	}

	/** Tạo/đồng bộ role theo bộ đang dùng; kiểm tra quyền người gọi trước khi defer để lỗi được trả lời ngay. */
	private async setupTierRoles({ interaction: base, guildId }: ConfigContext): Promise<void>
	{
		const interaction = requireCachedGuild(base);
		const actor = actorOf(interaction);
		const issue = callerManageRolesIssue(actor);
		if (issue !== null) throw new UserError(issue);

		// Tạo hay đổi tên tới 8 role có thể mất vài giây: defer trước để không quá hạn 3 giây của interaction.
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const set = this.services.tierSets.current(guildId);
		const result = await syncTierSetRoles(interaction.guild, set, this.services, actor);
		await interaction.editReply(buildTierSetupReport(set, result));
	}

	private async panelSelectSet(interaction: StringSelectMenuInteraction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const key = interaction.values[0];
		if (key === undefined || !isTierSetKey(key)) throw new UserError(INVALID_TIER_SET);
		const changed = this.services.tierSets.currentKey(guildId) !== key;
		const set = this.services.tierSets.select(guildId, key, interaction.user.id);
		const data = this.panelData(guildId, interaction.guild);
		await interaction.update(tierPanelUpdate(data));
		if (changed && data.mappings.length > 0) await interaction.followUp(ephemeral(tierSetChangedHint(set)));
	}

	/**
	 * Vẽ lại bảng điều khiển sau deferUpdate. Lỗi (tin nhắn riêng đã bị đóng, Unknown Message, Discord lỗi 5xx) chỉ ghi cảnh
	 * báo, để không che kết quả hay lỗi gốc của thao tác chính.
	 */
	private async redrawPanel(interaction: MessageComponentInteraction<"cached">): Promise<void>
	{
		try
		{
			await interaction.editReply(tierPanelUpdate(this.panelData(interaction.guildId, interaction.guild)));
		}
		catch (error)
		{
			logger.warn(`Không vẽ lại được bảng điều khiển danh hiệu ở server "${interaction.guildId}":`, error);
		}
	}

	/**
	 * Ô chọn role của một bậc: chọn role là gán ngay (cùng kiểm tra với `/config tier set-role`), xoá lựa chọn là bỏ gán.
	 * Luôn vẽ lại bảng theo dữ liệu thật, nên khi lỗi ô chọn trở về role đang gán; lỗi gốc được ném lại sau khi vẽ để
	 * dispatcher báo riêng (lỗi vẽ lại không che lỗi gốc).
	 */
	private async panelAssignRole(interaction: RoleSelectMenuInteraction, tierKey: TierKey, drawnRoleId: string | null): Promise<void>
	{
		if (!interaction.inCachedGuild()) throw new UserError(GUILD_UNAVAILABLE);
		// Kiểm tra thứ bậc role phải tải lại thông tin bot từ Discord: defer trước để không quá hạn 3 giây.
		await interaction.deferUpdate();
		let notes: string[] = [];
		let failure: { error: unknown } | null = null;
		try
		{
			notes = await this.applyPanelRole(interaction, tierKey, drawnRoleId);
		}
		catch (error)
		{
			failure = { error };
		}
		await this.redrawPanel(interaction);
		if (failure !== null) throw failure.error;
		if (notes.length > 0) await interaction.followUp(ephemeral(notes.join("\n")));
	}

	/**
	 * Gán hoặc bỏ gán role theo lựa chọn; trả về ghi chú cần báo riêng cho người thao tác. Xoá lựa chọn chỉ bỏ gán nếu bậc
	 * vẫn giữ đúng role lúc vẽ bảng (`drawnRoleId`), để bảng cũ không bỏ gán role vừa được người khác gán.
	 */
	private async applyPanelRole(interaction: RoleSelectMenuInteraction<"cached">, tierKey: TierKey, drawnRoleId: string | null): Promise<string[]>
	{
		const { guild, guildId } = interaction;
		const actor = actorOf(interaction);
		const roleId = interaction.values[0];
		if (roleId === undefined)
		{
			const current = assignedRole(this.services.tierRoles.list(guildId), tierKey);
			if (current !== drawnRoleId) throw new UserError(PANEL_ROLE_CHANGED);
			if (current === null) return [];
			const outcome = await clearTierRoleAssignment(guild, actor, this.services, tierKey);
			return [tierRoleClearedText(outcome, tierByKey(tierKey, this.services.tierSets.current(guildId)))];
		}
		const role = interaction.roles.get(roleId) ?? guild.roles.cache.get(roleId);
		if (!role) throw new UserError(SELECTED_ROLE_UNAVAILABLE);
		return assignmentNotes(role.id, await assignTierRole(guild, actor, this.services, tierKey, role));
	}

	/** Nút ✨: tạo/đồng bộ role rồi vẽ lại bảng và báo riêng kết quả từng bậc (báo cáo vẫn gửi dù vẽ lại bảng lỗi). */
	private async panelSetupRoles(interaction: ButtonInteraction): Promise<void>
	{
		if (!interaction.inCachedGuild()) throw new UserError(GUILD_UNAVAILABLE);
		const { guild, guildId } = interaction;
		const actor = actorOf(interaction);
		const issue = callerManageRolesIssue(actor);
		if (issue !== null) throw new UserError(issue);

		await interaction.deferUpdate();
		const set = this.services.tierSets.current(guildId);
		const result = await syncTierSetRoles(guild, set, this.services, actor);
		await this.redrawPanel(interaction);
		await interaction.followUp(ephemeral(buildTierSetupReport(set, result)));
	}

	/** Nút ↺: khôi phục tên mặc định của bộ đang dùng, chỉ khi bộ vẫn là bộ lúc vẽ bảng (`setKey`). */
	private async panelResetNames(interaction: ButtonInteraction, setKey: TierSetKey): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const { tierSets } = this.services;
		if (tierSets.currentKey(guildId) !== setKey)
		{
			await interaction.update(tierPanelUpdate(this.panelData(guildId, interaction.guild)));
			throw new UserError(RESET_SET_CHANGED);
		}
		tierSets.resetNames(guildId, interaction.user.id);
		await interaction.update(tierPanelUpdate(this.panelData(guildId, interaction.guild)));
	}

	/**
	 * Lưu form đổi tên (DEC-033): mỗi ô tách emoji đầu chuỗi và tên; để trống là tên mặc định. Validate hết trước khi ghi
	 * (TierSetService.rename): lỗi thì không đổi gì và dispatcher báo riêng. Bộ đã đổi, hoặc tên các bậc trong form đã đổi
	 * (dấu vân tay khác lúc mở form), thì không lưu để không ghi đè thay đổi của người khác.
	 */
	private async panelRename(interaction: ModalMessageModalSubmitInteraction, group: TierNameGroup, setKey: TierSetKey, fingerprint: string): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const { tierSets } = this.services;
		const stale = tierSets.currentKey(guildId) !== setKey
			? RENAME_SET_CHANGED
			: tierNamesFingerprint(tierSets.current(guildId), group) !== fingerprint ? RENAME_NAMES_CHANGED : null;
		if (stale !== null)
		{
			await interaction.update(tierPanelUpdate(this.panelData(guildId, interaction.guild)));
			throw new UserError(stale);
		}
		const set = tierSets.current(guildId);
		const entries = tierKeysOfGroup(group).map(key => renameInput(set, key, interaction.fields.getTextInputValue(key)));
		tierSets.rename(guildId, entries, interaction.user.id);
		await interaction.update(tierPanelUpdate(this.panelData(guildId, interaction.guild)));
	}

	// ---------- Bảng vàng ----------

	/** Đặt kênh hoặc tắt Bảng vàng (DEC-030); phải chọn đúng một trong hai. */
	private async updateLiveBoard(context: ConfigContext): Promise<void>
	{
		const { options } = context.interaction;
		const hasChannel = options.getChannel("kenh") !== null;
		const disable = options.getBoolean("tat") ?? false;
		if (hasChannel && disable) throw new UserError("Chỉ chọn một: `kenh` để đặt Bảng vàng, hoặc `tat` để tắt.");
		if (disable)
		{
			await this.disableLiveBoard(context);
			return;
		}
		if (!hasChannel) throw new UserError("Hãy chọn `kenh` để đặt Bảng vàng, hoặc chọn `tat` = True để tắt Bảng vàng.");
		await this.setLiveBoardChannel(context);
	}

	private async setLiveBoardChannel({ interaction: base, guildId, actorId }: ConfigContext): Promise<void>
	{
		const interaction = requireCachedGuild(base);
		const channel = interaction.options.getChannel("kenh", true, BOARD_CHANNEL_TYPES);
		assertBoardChannelAccess(channel, interaction.member, botMemberOf(interaction.guild));

		// Xoá message cũ, vẽ và đăng bảng mới có thể mất vài giây: defer trước để không quá hạn 3 giây của interaction.
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		await interaction.editReply(await this.moveLiveBoard(guildId, channel.id, actorId));
	}

	private async disableLiveBoard({ interaction, guildId, actorId }: ConfigContext): Promise<void>
	{
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		await interaction.editReply(await this.turnOffLiveBoard(guildId, actorId));
	}

	/**
	 * Lưu kênh Bảng vàng (đã qua assertBoardChannelAccess), xoá message bảng cũ nếu có, rồi đăng bảng ở kênh mới ngay; trả về
	 * phản hồi. Dùng chung cho `/config board` và bảng cấu hình; gọi sau khi đã defer vì có thể mất vài giây.
	 */
	private moveLiveBoard(guildId: string, channelId: string, actorId: string): Promise<string>
	{
		return moveLiveBoard(this.client, this.services, this.liveBoardActions, guildId, channelId, actorId);
	}

	/** Tắt Bảng vàng và xoá message bảng xếp hạng cũ nếu có; trả về phản hồi. Dùng chung cho `/config board tat` và bảng cấu hình. */
	private turnOffLiveBoard(guildId: string, actorId: string): Promise<string>
	{
		return turnOffLiveBoard(this.client, this.services, this.liveBoardActions, guildId, actorId);
	}

	// ---------- Bảng cấu hình chung `/config panel` (PROP-033, DEC-037) ----------

	/**
	 * Dữ liệu dựng bảng cấu hình, đọc từ service ngay trước khi vẽ; `notice` là kết quả thao tác vừa làm. `guild` (nếu có trong
	 * cache) để nhận ra role/kênh đã lưu nhưng không còn trong server: bảng không điền sẵn các ID đó và hiện cảnh báo.
	 */
	private configPanelData(guildId: string, guild: Guild | null, notice: string | null = null): ConfigPanelData
	{
		const { guildConfig, teams, liveBoards, tierSets, tierRoles } = this.services;
		const settings = guildConfig.getSettings(guildId);
		const teamIds = teams.list(guildId);
		const boardChannelId = liveBoards.get(guildId)?.channelId ?? null;
		const missingIds = new Set<string>();
		if (guild)
		{
			for (const roleId of [...settings.adminRoleIds, ...settings.pollCreatorRoleIds, ...settings.contributionReviewerRoleIds, ...teamIds])
			{
				if (!guild.roles.cache.has(roleId)) missingIds.add(roleId);
			}
			for (const channelId of [boardChannelId, settings.contributionChannelId])
			{
				if (channelId !== null && !guild.channels.cache.has(channelId)) missingIds.add(channelId);
			}
		}
		return {
			settings,
			channels: guildConfig.listChannels(guildId),
			teams: teamIds,
			boardChannelId,
			tierSet: tierSets.current(guildId),
			tierRoleCount: tierRoles.list(guildId).length,
			missingIds,
			notice,
		};
	}

	/** Thay bảng hiện có bằng trang `page`, kèm kết quả thao tác (`notice`). */
	private async updateConfigPanel(interaction: PanelComponentInteraction, page: ConfigPanelPage, notice: string | null = null): Promise<void>
	{
		await interaction.update(configPanelUpdate(page, this.configPanelData(requireGuildId(interaction), interaction.guild, notice)));
	}

	/** Nút của bảng cấu hình: đổi chế độ kênh, bật/tắt thông báo lên level, mở form, tắt Bảng vàng, mở bảng danh hiệu. */
	private async configPanelButton(interaction: ButtonInteraction, action: ConfigPanelAction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const actorId = interaction.user.id;
		const page = pageOfAction(action);
		switch (action.type)
		{
		case "mode":
			await this.updateConfigPanel(interaction, page, this.applyChannelMode(guildId, action.mode, actorId));
			break;
		case "announce":
		{
			const patch: Partial<GuildSettings> = { levelUpAnnouncements: action.enabled };
			if (this.services.guildConfig.getSettings(guildId).levelUpAnnouncements === action.enabled)
			{
				await this.updateConfigPanel(interaction, page, `Không có gì thay đổi:\n${describeSettingsPatch(patch).join("\n")}`);
				break;
			}
			this.services.guildConfig.updateSettings(guildId, patch, actorId);
			await this.updateConfigPanel(interaction, page, `Đã cập nhật cấu hình Activity XP:\n${describeSettingsPatch(patch).join("\n")}`);
			break;
		}
		case "xpForm":
			await interaction.showModal(buildXpSettingsModal(this.services.guildConfig.getSettings(guildId)));
			break;
		case "pollForm":
			await interaction.showModal(buildPollSettingsModal(this.services.guildConfig.getSettings(guildId)));
			break;
		case "boardOff":
			await this.deferredConfigPanelAction(interaction, page, () => this.turnOffLiveBoard(guildId, actorId));
			break;
		case "tierPanel":
			await interaction.reply(tierPanelReply(this.panelData(guildId, interaction.guild)));
			break;
		default:
			throw new UserError(INVALID_CONFIG_PANEL);
		}
	}

	/**
	 * Menu chọn của bảng cấu hình. Thao tác bị từ chối trước khi bot trả lời thì vẽ lại bảng theo dữ liệu thật rồi mới ném lại
	 * lỗi (dispatcher báo riêng): nếu không, Discord vẫn hiện lựa chọn vừa bị từ chối trong khi customId giữ role lúc vẽ, và
	 * thao tác "hoàn tác" kế tiếp (bỏ chọn) sẽ xoá nhầm role đang đặt (như panelAssignRole của bảng danh hiệu).
	 */
	private async configPanelSelect(interaction: AnySelectMenuInteraction, action: ConfigPanelAction): Promise<void>
	{
		try
		{
			await this.routeConfigPanelSelect(interaction, action);
		}
		catch (error)
		{
			if (action.type !== "nav" && !interaction.replied && !interaction.deferred)
			{
				try
				{
					await this.updateConfigPanel(interaction, pageOfAction(action));
				}
				catch (redrawError)
				{
					logger.warn(`Không vẽ lại được bảng cấu hình sau thao tác bị từ chối ở server "${interaction.guildId ?? ""}":`, redrawError);
				}
			}
			throw error;
		}
	}

	/** Loại menu phải khớp thao tác trong customId, không thì báo bảng đã cũ. */
	private async routeConfigPanelSelect(interaction: AnySelectMenuInteraction, action: ConfigPanelAction): Promise<void>
	{
		const page = pageOfAction(action);
		if (action.type === "nav" && interaction.isStringSelectMenu()) await this.panelNavigate(interaction);
		else if (action.type === "channels" && interaction.isChannelSelectMenu()) await this.panelToggleChannels(interaction, action.enabled, page);
		else if (action.type === "board" && interaction.isChannelSelectMenu()) await this.panelSetBoard(interaction, page);
		else if (action.type === "teams" && interaction.isRoleSelectMenu()) await this.panelTeams(interaction, action.add, page);
		else if (action.type === "pollRoles" && interaction.isRoleSelectMenu()) await this.panelRoleGrants(interaction, GRANT_ACTION_KEYS.pollRoles, action.fingerprint, page);
		else if (action.type === "contribChannel" && interaction.isChannelSelectMenu()) await this.panelSetContributionChannel(interaction, page);
		else if (action.type === "reviewRoles" && interaction.isRoleSelectMenu()) await this.panelRoleGrants(interaction, GRANT_ACTION_KEYS.reviewRoles, action.fingerprint, page);
		else if (action.type === "adminRoles" && interaction.isRoleSelectMenu()) await this.panelRoleGrants(interaction, GRANT_ACTION_KEYS.adminRoles, action.fingerprint, page);
		else throw new UserError(INVALID_CONFIG_PANEL);
	}

	/** Form số của bảng cấu hình; phải mở từ nút của bảng (để cập nhật được chính bảng đó). */
	private async configPanelModal(interaction: ModalSubmitInteraction, action: ConfigPanelAction): Promise<void>
	{
		if (!interaction.isFromMessage()) throw new UserError(INVALID_CONFIG_PANEL);
		const page = pageOfAction(action);
		if (action.type === "xpSave") await this.panelSaveForm(interaction, XP_FORM_KEYS, action.drawn, "Activity XP", page);
		else if (action.type === "pollSave") await this.panelSaveForm(interaction, POLL_FORM_KEYS, action.drawn, "vote và contribution", page);
		else throw new UserError(INVALID_CONFIG_PANEL);
	}

	/** Chuyển trang; giá trị menu phải là một trang hợp lệ (không tin dữ liệu từ client). */
	private async panelNavigate(interaction: StringSelectMenuInteraction): Promise<void>
	{
		const page = interaction.values[0];
		if (!isConfigPanelPage(page)) throw new UserError(INVALID_CONFIG_PANEL);
		await this.updateConfigPanel(interaction, page);
	}

	/** Bật hoặc tắt XP cho các kênh đã chọn (tối đa 25, GuildConfigService.setChannelsXpEnabled); mỗi kênh đổi trạng thái có một dòng audit. */
	private async panelToggleChannels(interaction: ChannelSelectMenuInteraction, enabled: boolean, page: ConfigPanelPage): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const channelIds = interaction.values.map(channelId => selectedXpChannel(interaction, channelId));
		const { guildConfig } = this.services;
		const result = guildConfig.setChannelsXpEnabled(guildId, channelIds, enabled, interaction.user.id);
		await this.updateConfigPanel(interaction, page, channelsToggledText(enabled, guildConfig.getSettings(guildId).xpChannelMode, result));
	}

	/**
	 * Thêm hoặc bỏ nhiều role team. Thêm: mọi role qua cùng kiểm tra với `/config team add`, và tổng số team sau khi thêm không
	 * vượt MAX_TEAMS (TeamService.addMany, một transaction); lỗi thì không thêm role nào.
	 */
	private async panelTeams(interaction: RoleSelectMenuInteraction, add: boolean, page: ConfigPanelPage): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const actorId = interaction.user.id;
		if (interaction.values.length === 0) throw new UserError(SELECT_AT_LEAST_ONE_ROLE);
		const roles = [...new Set(interaction.values)].map(roleId => selectedRole(interaction, roleId));
		const { teams } = this.services;
		if (add) for (const role of roles) this.assertUsableRole(guildId, role, "làm team");
		const roleIds = roles.map(role => role.id);
		const { changed, unchanged } = add ? teams.addMany(guildId, roleIds, actorId) : teams.removeMany(guildId, roleIds, actorId);
		await this.updateConfigPanel(interaction, page, teamsChangedText(add, changed, unchanged));
	}

	/**
	 * Lưu form số (XP, hoặc vote và contribution): validate mọi ô trước khi ghi; chỉ ghi ô có giá trị khác lúc mở form (`drawn`),
	 * để không đè thay đổi của người khác trong lúc form đang mở.
	 */
	private async panelSaveForm(
		interaction: ModalMessageModalSubmitInteraction,
		keys: readonly NumericSettingKey[],
		drawn: Readonly<Partial<Record<NumericSettingKey, number>>>,
		label: string,
		page: ConfigPanelPage,
	): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const values = keys.map(key => ({ key, value: parseFormNumber(interaction.fields.getTextInputValue(key), key) }));
		const patch: Partial<GuildSettings> = {};
		for (const { key, value } of values)
		{
			if (value !== drawn[key]) patch[key] = value;
		}
		const changed = Object.keys(patch).length > 0;
		if (changed) this.services.guildConfig.updateSettings(guildId, patch, interaction.user.id);
		const notice = changed ? `Đã cập nhật cấu hình ${label}:\n${describeSettingsPatch(patch).join("\n")}` : FORM_UNCHANGED;
		await interaction.update(configPanelUpdate(page, this.configPanelData(guildId, interaction.guild, notice)));
	}

	/**
	 * Ô chọn nhiều role của danh sách role tạo vote, role duyệt contribution hoặc role admin bot (DEC-044, DEC-051). Danh sách hiện
	 * tại phải khớp vân tay lúc vẽ bảng (`fingerprint`); không khớp (có người vừa đổi) thì vẽ lại bảng rồi báo riêng, không ghi gì.
	 * Khớp thì danh sách = các role đang chọn: role mới qua cùng kiểm tra với `/config admin-role them` và `/config poll role-tao-vote`;
	 * ghi phần chênh lệch bằng changeRoleGrants (một transaction, một audit). Role đã lưu mà không còn trong server không được điền
	 * sẵn, nên lưu là bỏ.
	 */
	private async panelRoleGrants(interaction: RoleSelectMenuInteraction, key: RoleGrantKey, fingerprint: string, page: ConfigPanelPage): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const { guildConfig } = this.services;
		const current = guildConfig.getSettings(guildId)[key];
		if (roleListFingerprint(current) !== fingerprint)
		{
			await this.updateConfigPanel(interaction, page);
			throw new UserError(CONFIG_ROLES_CHANGED);
		}
		const granted = new Set(current);
		const selected = new Set(interaction.values);
		const added = [...selected].filter(roleId => !granted.has(roleId)).map(roleId => selectedRole(interaction, roleId));
		for (const role of added) this.assertUsableRole(guildId, role, ROLE_GRANT_PURPOSES[key]);
		const result = guildConfig.changeRoleGrants(
			guildId,
			key,
			{ add: added.map(role => role.id), remove: current.filter(roleId => !selected.has(roleId)) },
			interaction.user.id,
		);
		await this.updateConfigPanel(interaction, page, roleGrantNotice(key, result));
	}

	/**
	 * Đặt kênh contribution từ bảng (DEC-051): cùng kiểm tra với `/config contribution kenh` và web (resolveContributionChannel: kênh văn
	 * bản/thông báo trong cache của server, người gọi và bot đủ quyền). Đã đúng kênh thì không ghi.
	 */
	private async panelSetContributionChannel(interaction: ChannelSelectMenuInteraction, page: ConfigPanelPage): Promise<void>
	{
		if (!interaction.inCachedGuild()) throw new UserError(GUILD_UNAVAILABLE);
		const { guild, guildId } = interaction;
		const selected = interaction.values[0];
		if (selected === undefined || !guild.channels.cache.has(selected)) throw new UserError(SELECTED_CHANNEL_UNAVAILABLE);
		const channelId = resolveContributionChannel(guild, selected, interaction.member);
		const { guildConfig } = this.services;
		const patch: Partial<GuildSettings> = { contributionChannelId: channelId };
		if (guildConfig.getSettings(guildId).contributionChannelId === channelId)
		{
			await this.updateConfigPanel(interaction, page, `Không có gì thay đổi:\n${describeSettingsPatch(patch).join("\n")}`);
			return;
		}
		guildConfig.updateSettings(guildId, patch, interaction.user.id);
		await this.updateConfigPanel(interaction, page, `${CONTRIBUTION_UPDATED}\n${describeSettingsPatch(patch).join("\n")}`);
	}

	/**
	 * Đặt kênh Bảng vàng từ bảng: kênh lấy đầy đủ từ cache của server (để tính quyền), cùng kiểm tra với `/config board`.
	 * Lỗi kiểm tra được báo ngay (trước defer); đăng bảng mất vài giây nên phần còn lại chạy sau deferUpdate.
	 */
	private async panelSetBoard(interaction: ChannelSelectMenuInteraction, page: ConfigPanelPage): Promise<void>
	{
		if (!interaction.inCachedGuild()) throw new UserError(GUILD_UNAVAILABLE);
		const { guild, guildId } = interaction;
		const channelId = interaction.values[0];
		const channel = channelId === undefined ? undefined : guild.channels.cache.get(channelId);
		if (!channel) throw new UserError(BOARD_CHANNEL_NOT_VISIBLE);
		if (!isBoardChannel(channel))
		{
			throw new UserError(`Bảng vàng chỉ đặt được ở kênh chữ hoặc kênh thông báo; ${channelMention(channel.id)} không phải loại kênh này.`);
		}
		assertBoardChannelAccess(channel, interaction.member, botMemberOf(guild));
		await this.deferredConfigPanelAction(interaction, page, () => this.moveLiveBoard(guildId, channel.id, interaction.user.id));
	}

	/**
	 * Thao tác của bảng mất vài giây (đăng hoặc xoá message Bảng vàng): deferUpdate, chạy `run`, rồi vẽ lại bảng kèm kết quả.
	 * Lỗi của thao tác được ném lại sau khi vẽ lại bảng để dispatcher báo riêng (như panelAssignRole).
	 */
	private async deferredConfigPanelAction(interaction: PanelComponentInteraction, page: ConfigPanelPage, run: () => Promise<string>): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		await interaction.deferUpdate();
		let notice: string | null = null;
		let failure: { error: unknown } | null = null;
		try
		{
			notice = await run();
		}
		catch (error)
		{
			failure = { error };
		}
		await this.redrawConfigPanel(interaction, guildId, page, notice);
		if (failure !== null) throw failure.error;
	}

	/**
	 * Vẽ lại bảng cấu hình sau deferUpdate. Lỗi (tin nhắn riêng đã bị đóng, Unknown Message, Discord lỗi 5xx) chỉ ghi cảnh báo,
	 * để không che kết quả hay lỗi gốc của thao tác chính.
	 */
	private async redrawConfigPanel(interaction: MessageComponentInteraction, guildId: string, page: ConfigPanelPage, notice: string | null): Promise<void>
	{
		try
		{
			await interaction.editReply(configPanelUpdate(page, this.configPanelData(guildId, interaction.guild, notice)));
		}
		catch (error)
		{
			logger.warn(`Không vẽ lại được bảng cấu hình ở server "${guildId}":`, error);
		}
	}
}
