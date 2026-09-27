import {
	AnySelectMenuInteraction,
	ButtonInteraction,
	ChannelType,
	ChatInputCommandInteraction,
	Guild,
	GuildMember,
	MessageFlags,
	ModalMessageModalSubmitInteraction,
	ModalSubmitInteraction,
	PermissionFlagsBits,
	PermissionsBitField,
	RoleSelectMenuInteraction,
	SlashCommandBuilder,
	SlashCommandSubcommandBuilder,
	SlashCommandSubcommandGroupBuilder,
	StringSelectMenuInteraction,
} from "discord.js";
import Command from "../../classes/Command";
import { channelMention, roleMention } from "../../discord/format";
import { requireGuildId } from "../../discord/guards";
import { deleteLiveBoardMessage, refreshLiveBoard } from "../../discord/liveBoard";
import {
	assignTierRole,
	BOT_MEMBER_UNAVAILABLE,
	callerManageRolesIssue,
	syncTierSetRoles,
	TierRoleActor,
	tierRoleActor,
	TierRoleAssignment,
} from "../../discord/tierRoleSetup";
import {
	buildChannelListEmbed,
	buildConfigEmbed,
	buildTeamListEmbed,
	describeChannelSettings,
	describeSettingsPatch,
	ephemeral,
	ephemeralEmbed,
	settingLine,
} from "../../discord/views/admin";
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
	TierPanelData,
	tierPanelReply,
	tierPanelUpdate,
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
	Tier,
	TierKey,
	tierByKey,
	TierSet,
	TierSetKey,
} from "../../modules/activity/tiers";
import { parseTierDisplayName, TierRenameInput } from "../../modules/gamification/TierSetService";
import { TierRoleMapping } from "../../modules/gamification/types";
import { ChannelSettings, GuildSettings, NumericSettingKey, SETTING_LIMITS } from "../../modules/guild-config/types";
import { AppServices } from "../../services";
import { UserError } from "../../shared/errors";

const NO_CHANGE_MESSAGE = "Hãy chọn ít nhất một giá trị để thay đổi.";

/**
 * /admin và /config có default_member_permissions = Manage Server, nên Discord ẩn và chặn lệnh với người thiếu quyền đó
 * trước khi tới bot. Role admin bot chỉ dùng được hai lệnh khi server cho phép trong phần Integrations.
 */
const ADMIN_ROLE_INTEGRATION_HINT = "⚠️ Lưu ý: `/admin` và `/config` mặc định chỉ dành cho người có quyền Manage Server; "
	+ "Discord chặn những người khác trước khi lệnh tới bot. Để role này dùng được, vào **Server Settings → Integrations → chọn bot** "
	+ "rồi cho phép role này dùng `/admin` và `/config`.";

/** Loại channel có tin nhắn tính XP (kể cả chat trong kênh voice/stage và bài đăng trong kênh media). */
const XP_CHANNEL_TYPES = [
	ChannelType.GuildText,
	ChannelType.GuildAnnouncement,
	ChannelType.GuildForum,
	ChannelType.GuildVoice,
	ChannelType.GuildStageVoice,
	ChannelType.GuildMedia,
] as const;

/** Loại channel đặt được Bảng vàng: kênh chữ thường và kênh thông báo. */
const BOARD_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

type PermissionList = readonly (readonly [bigint, string])[];

/** Quyền bot cần ở kênh Bảng vàng để đăng message kèm ảnh (DEC-030). */
const BOARD_PERMISSIONS: PermissionList = [
	[PermissionFlagsBits.ViewChannel, "View Channel"],
	[PermissionFlagsBits.SendMessages, "Send Messages"],
	[PermissionFlagsBits.AttachFiles, "Attach Files"],
];

/** Quyền người gọi phải tự có ở kênh Bảng vàng, để không mượn bot đăng vào kênh mình không được gửi tin (LL-013). */
const BOARD_CALLER_PERMISSIONS: PermissionList = [
	[PermissionFlagsBits.ViewChannel, "View Channel"],
	[PermissionFlagsBits.SendMessages, "Send Messages"],
];

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

const GUILD_UNAVAILABLE = "Không đọc được thông tin server. Vui lòng thử lại sau.";
const INVALID_TIER = "Bậc danh hiệu không hợp lệ.";
const INVALID_TIER_SET = "Bộ danh hiệu không hợp lệ.";
const SELECTED_ROLE_UNAVAILABLE = "Không tìm thấy role vừa chọn trong server. Vui lòng thử lại.";
const MANAGE_ROLES_WARNING = "⚠️ Bot chưa có quyền **Manage Roles** nên chưa gán được role. "
	+ "Hãy cấp quyền này cho role của bot và kéo role của bot lên trên các role danh hiệu (Server Settings → Roles).";
const SETUP_ROLES_HINT = "Tên và màu các role đã gán chưa đổi: dùng `/config tier setup-roles` (hoặc nút ✨ trong `/config tier panel`) "
	+ "để bot đổi theo.";
const RENAME_SET_CHANGED = "Bộ danh hiệu vừa được đổi trong lúc bạn nhập tên, nên bot chưa lưu gì. Hãy mở lại form đổi tên.";

/** Thao tác với message Bảng vàng (tầng Discord, src/discord/liveBoard.ts). */
export interface LiveBoardActions
{
	refresh: typeof refreshLiveBoard;
	remove: typeof deleteLiveBoardMessage;
}

interface SettingOption
{
	name: string;
	key: NumericSettingKey;
	description: string;
}

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
	return sub.addBooleanOption(option => option
		.setName("thong-bao-len-level")
		.setDescription("Bật hoặc tắt thông báo khi thành viên lên level"));
}

function channelSetSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder
{
	addChannel(sub.setName("set").setDescription("Đặt cấu hình XP riêng cho một channel"), "Channel cần cấu hình");
	sub.addBooleanOption(option => option.setName("bat-xp").setDescription("Bật hoặc tắt XP trong channel này"));
	addSettingOption(sub, { name: "xp-moi-tin", key: "xpPerMessage", description: "XP mỗi tin nhắn trong channel này" });
	return addSettingOption(sub, { name: "cooldown-giay", key: "xpCooldownSeconds", description: "Cooldown riêng trong channel này (giây)" });
}

function pollSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder
{
	sub.setName("poll").setDescription("Cấu hình vote: XP mặc định, giới hạn XP mỗi ngày và role được tạo vote");
	addSettingOption(sub, { name: "xp-mac-dinh", key: "defaultPollXp", description: "XP mặc định cho người tham gia vote" });
	addSettingOption(sub, {
		name: "gioi-han-xp-ngay",
		key: "pollXpDailyCap",
		description: "XP tối đa một người nhận từ vote trong một ngày (0 = không giới hạn)",
	});
	return sub
		.addRoleOption(option => option.setName("role-tao-vote").setDescription("Role được phép tạo vote (ngoài admin)"))
		.addBooleanOption(option => option.setName("xoa-role-tao-vote").setDescription("Xoá role tạo vote (chỉ admin tạo được vote)"));
}

function contributionSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder
{
	sub.setName("contribution").setDescription("Cấu hình điểm contribution");
	return addSettingOption(sub, { name: "diem-moi-luot", key: "contributionVotePoints", description: "Điểm cộng cho tác giả mỗi lượt ghi nhận" }, true);
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
			.setDescription("Bot tạo role cho bậc chưa có role, đổi tên và màu role đã gán theo bộ đang dùng"));
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

function botMemberOf(interaction: ChatInputCommandInteraction<"cached">): GuildMember
{
	const me = interaction.guild.members.me;
	if (!me) throw new UserError(BOT_MEMBER_UNAVAILABLE);
	return me;
}

/** Tên (in đậm) các quyền trong `list` mà `permissions` không có. */
function missingPermissions(permissions: Readonly<PermissionsBitField>, list: PermissionList): string[]
{
	return list.filter(([flag]) => !permissions.has(flag)).map(([, name]) => `**${name}**`);
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
	}
	if (!assignment.botCanManageRoles) notes.push(MANAGE_ROLES_WARNING);
	return notes;
}

/** Phản hồi sau khi bỏ role của một bậc. */
function clearedNote(previousRoleId: string, tier: Tier): string
{
	return `Đã bỏ ${roleMention(previousRoleId)} khỏi bậc ${tierTitle(tier)}. Bot không tự gỡ role đó khỏi những người đang có; nếu cần, hãy gỡ thủ công.`;
}

function collapseSpaces(text: string): string
{
	return text.replace(/\s+/gu, " ").trim();
}

/**
 * Chuỗi admin nhập cho một bậc ("🟡 Kim Đan", chỉ tên, chỉ emoji, hoặc rỗng) thành thay đổi để lưu. Phần trùng với
 * mặc định của bộ lưu là null (dùng mặc định), để ô điền sẵn mà admin không sửa không biến thành tên tuỳ chỉnh.
 */
function renameInput(set: TierSet, tierKey: TierKey, raw: string): TierRenameInput
{
	const parsed = parseTierDisplayName(raw);
	const base = tierByKey(tierKey, TIER_SETS[set.key]);
	return {
		tierKey,
		name: parsed.name !== null && collapseSpaces(parsed.name) === base.name ? null : parsed.name,
		emoji: parsed.emoji === base.emoji ? null : parsed.emoji,
	};
}

/** Chặn @everyone và role do bot/integration quản lý (không gán được cho người dùng). */
function assertAssignableRole(role: { id: string; managed: boolean }, guildId: string, purpose: string): void
{
	if (role.id === guildId) throw new UserError(`Không thể dùng @everyone ${purpose}.`);
	if (role.managed) throw new UserError(`Không thể dùng role do bot hoặc integration quản lý ${purpose}.`);
}

function requireChange(patch: object): void
{
	if (Object.keys(patch).length === 0) throw new UserError(NO_CHANGE_MESSAGE);
}

// Cấu hình bot theo server. Hai lớp quyền: ManageGuild (Discord) + adminOnly (dispatcher, áp cả cho component của bảng điều khiển).
export default class ConfigCmd extends Command
{
	override adminOnly = true;

	override buttonIds = [TIER_PANEL_NAMESPACE];

	/** Điểm inject để test thay bằng hàm giả; mặc định là các hàm thật của tầng Discord. */
	liveBoardActions: LiveBoardActions = { refresh: refreshLiveBoard, remove: deleteLiveBoardMessage };

	data = new SlashCommandBuilder()
		.setName("config")
		.setDescription("Cấu hình bot cho server")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.addSubcommand(sub => sub
			.setName("view")
			.setDescription("Xem toàn bộ cấu hình hiện tại"))
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
				.setDescription("Xem các channel có cấu hình riêng")))
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
		.addSubcommand(sub => addRole(sub
			.setName("admin-role")
			.setDescription("Đặt hoặc xoá role được dùng lệnh admin của bot"), "Role admin bot (bỏ trống để xoá role admin)", false))
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
		else if (subcommand === "xp") await this.updateXp(context);
		else if (subcommand === "admin-role") await this.updateAdminRole(context);
		else if (subcommand === "poll") await this.updatePoll(context);
		else if (subcommand === "contribution") await this.updateContribution(context);
		else if (subcommand === "board") await this.updateLiveBoard(context);
		else throw new Error(`Subcommand không hợp lệ: /config ${group ?? ""} ${subcommand}`);
	}

	/** Nút của bảng điều khiển danh hiệu: tạo/đồng bộ role, mở form đổi tên, khôi phục tên mặc định. */
	override async executeButton(interaction: ButtonInteraction): Promise<void>
	{
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
			this.services.tierSets.resetNames(guildId, interaction.user.id);
			await interaction.update(tierPanelUpdate(this.panelData(guildId, interaction.guild)));
			break;
		default:
			throw new UserError(INVALID_PANEL_ACTION);
		}
	}

	/** Menu chọn của bảng điều khiển: chọn bộ (StringSelect) hoặc gán role cho một bậc (RoleSelect). */
	override async executeSelectMenu(interaction: AnySelectMenuInteraction): Promise<void>
	{
		const action = parseTierPanelId(interaction.customId);
		if (action.type === "set" && interaction.isStringSelectMenu()) await this.panelSelectSet(interaction);
		else if (action.type === "role" && interaction.isRoleSelectMenu()) await this.panelAssignRole(interaction, action.tierKey);
		else throw new UserError(INVALID_PANEL_ACTION);
	}

	/** Form đổi tên bậc, mở từ nút của bảng điều khiển (nên cập nhật được chính bảng đó). */
	override async executeModal(interaction: ModalSubmitInteraction): Promise<void>
	{
		const action = parseTierPanelId(interaction.customId);
		if (action.type !== "names" || !interaction.isFromMessage()) throw new UserError(INVALID_PANEL_ACTION);
		await this.panelRename(interaction, action.group, action.setKey);
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
		requireChange(patch);

		this.updateSettings(context, patch);
		await context.interaction.reply(ephemeral(`Đã cập nhật cấu hình Activity XP:\n${describeSettingsPatch(patch).join("\n")}`));
	}

	private async setChannel({ interaction, guildId, actorId }: ConfigContext): Promise<void>
	{
		const { options } = interaction;
		const channel = options.getChannel("kenh", true);
		const patch: Partial<Omit<ChannelSettings, "channelId">> = {};
		const enabled = options.getBoolean("bat-xp");
		if (enabled !== null) patch.xpEnabled = enabled;
		const xpPerMessage = options.getInteger("xp-moi-tin");
		if (xpPerMessage !== null) patch.xpPerMessage = xpPerMessage;
		const cooldown = options.getInteger("cooldown-giay");
		if (cooldown !== null) patch.xpCooldownSeconds = cooldown;
		requireChange(patch);

		const next = this.services.guildConfig.setChannel(guildId, channel.id, patch, actorId);
		await interaction.reply(ephemeral(`Đã cập nhật cấu hình XP của ${channelMention(channel.id)}: ${describeChannelSettings(next)}.`));
	}

	private async resetChannel({ interaction, guildId, actorId }: ConfigContext): Promise<void>
	{
		const channel = interaction.options.getChannel("kenh", true);
		const removed = this.services.guildConfig.resetChannel(guildId, channel.id, actorId);
		await interaction.reply(ephemeral(removed
			? `Đã xoá cấu hình riêng của ${channelMention(channel.id)}. Channel này dùng lại cấu hình chung.`
			: `${channelMention(channel.id)} vốn không có cấu hình riêng.`));
	}

	private async listChannels({ interaction, guildId }: ConfigContext): Promise<void>
	{
		const { guildConfig } = this.services;
		await interaction.reply(ephemeralEmbed(buildChannelListEmbed(guildConfig.listChannels(guildId), guildConfig.getSettings(guildId))));
	}

	private async addTeam({ interaction, guildId, actorId }: ConfigContext): Promise<void>
	{
		const role = interaction.options.getRole("role", true);
		assertAssignableRole(role, guildId, "làm team");
		this.assertNotTierRole(guildId, role.id, "làm team");
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

	private async updateAdminRole(context: ConfigContext): Promise<void>
	{
		const role = context.interaction.options.getRole("role");
		if (role)
		{
			assertAssignableRole(role, context.guildId, "làm role admin bot");
			this.assertNotTierRole(context.guildId, role.id, "làm role admin bot");
			this.updateSettings(context, { adminRoleId: role.id });
			await context.interaction.reply(ephemeral([
				`Đã đặt ${roleMention(role.id)} làm role admin bot. Người có quyền Manage Server vẫn luôn là admin.`,
				ADMIN_ROLE_INTEGRATION_HINT,
			].join("\n")));
			return;
		}
		this.updateSettings(context, { adminRoleId: null });
		await context.interaction.reply(ephemeral("Đã xoá role admin bot. Chỉ người có quyền Manage Server dùng được lệnh admin."));
	}

	private async updatePoll(context: ConfigContext): Promise<void>
	{
		const { options } = context.interaction;
		const patch: Partial<GuildSettings> = {};
		const xp = options.getInteger("xp-mac-dinh");
		if (xp !== null) patch.defaultPollXp = xp;
		const dailyCap = options.getInteger("gioi-han-xp-ngay");
		if (dailyCap !== null) patch.pollXpDailyCap = dailyCap;
		const role = options.getRole("role-tao-vote");
		const clearRole = options.getBoolean("xoa-role-tao-vote") ?? false;
		if (role && clearRole) throw new UserError("Không thể vừa đặt vừa xoá role tạo vote.");
		if (role)
		{
			assertAssignableRole(role, context.guildId, "làm role tạo vote");
			this.assertNotTierRole(context.guildId, role.id, "làm role tạo vote");
			patch.pollCreatorRoleId = role.id;
		}
		if (clearRole) patch.pollCreatorRoleId = null;
		requireChange(patch);

		this.updateSettings(context, patch);
		await context.interaction.reply(ephemeral(`Đã cập nhật cấu hình vote:\n${describeSettingsPatch(patch).join("\n")}`));
	}

	private async updateContribution(context: ConfigContext): Promise<void>
	{
		const points = context.interaction.options.getInteger("diem-moi-luot", true);
		const next = this.updateSettings(context, { contributionVotePoints: points });
		await context.interaction.reply(ephemeral(
			`Đã cập nhật cấu hình contribution:\n${settingLine("contributionVotePoints", next.contributionVotePoints)}`,
		));
	}

	/** Role danh hiệu không được dùng vào việc khác: bot tự thêm và gỡ role danh hiệu theo level của từng người (DEC-031). */
	private assertNotTierRole(guildId: string, roleId: string, purpose: string): void
	{
		const mapping = this.services.tierRoles.list(guildId).find(entry => entry.roleId === roleId);
		if (!mapping) return;
		const tier = tierByKey(mapping.tierKey, this.services.tierSets.current(guildId));
		throw new UserError(`Không thể dùng ${roleMention(roleId)} ${purpose} vì role này đang là role của bậc danh hiệu ${tier.name}: `
			+ "bot tự thêm và gỡ role danh hiệu theo level của từng người. Hãy chọn role khác, hoặc bỏ gán bằng `/config tier clear-role` trước.");
	}

	// ---------- Danh hiệu (DEC-031, DEC-033) ----------

	/** Dữ liệu dựng bảng điều khiển; `guild` (nếu có trong cache) để nhận ra role đã gán nhưng không còn trong server. */
	private panelData(guildId: string, guild: Guild | null): TierPanelData
	{
		const mappings = this.services.tierRoles.list(guildId);
		const missingRoleIds = new Set(guild ? mappings.filter(mapping => !guild.roles.cache.has(mapping.roleId)).map(mapping => mapping.roleId) : []);
		return { set: this.services.tierSets.current(guildId), mappings, missingRoleIds };
	}

	/** Gán role cho một bậc (dùng chung kiểm tra với ô chọn role của bảng điều khiển, xem assignTierRole). */
	private async assignTierRoleCommand({ interaction: base, guildId }: ConfigContext): Promise<void>
	{
		const interaction = requireCachedGuild(base);
		const tier = tierByKey(tierKeyOf(interaction), this.services.tierSets.current(guildId));
		const role = interaction.options.getRole("role", true);
		const assignment = await assignTierRole(interaction.guild, actorOf(interaction), this.services, tier.key, role);

		const lines = [`Đã gán ${roleMention(role.id)} cho bậc ${tierTitle(tier)}.`, TIER_ROLE_SYNC_NOTE, TIER_ROLE_DEDICATED_NOTE];
		lines.push(...assignmentNotes(role.id, assignment));
		await interaction.reply(ephemeral(lines.join("\n")));
	}

	private async clearTierRole({ interaction, guildId, actorId }: ConfigContext): Promise<void>
	{
		const tier = tierByKey(tierKeyOf(interaction), this.services.tierSets.current(guildId));
		const { tierRoles } = this.services;
		const previous = assignedRole(tierRoles.list(guildId), tier.key);
		if (previous === null || !tierRoles.clear(guildId, tier.key, actorId))
		{
			await interaction.reply(ephemeral(`Bậc ${tierTitle(tier)} chưa được gán role.`));
			return;
		}
		await interaction.reply(ephemeral(clearedNote(previous, tier)));
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
	 * Ô chọn role của một bậc: chọn role là gán ngay (cùng kiểm tra với `/config tier set-role`), xoá lựa chọn là bỏ gán.
	 * Luôn vẽ lại bảng theo dữ liệu thật, nên khi lỗi ô chọn trở về role đang gán; lỗi được dispatcher báo riêng.
	 */
	private async panelAssignRole(interaction: RoleSelectMenuInteraction, tierKey: TierKey): Promise<void>
	{
		if (!interaction.inCachedGuild()) throw new UserError(GUILD_UNAVAILABLE);
		const { guild, guildId } = interaction;
		// Kiểm tra thứ bậc role phải tải lại thông tin bot từ Discord: defer trước để không quá hạn 3 giây.
		await interaction.deferUpdate();
		let notes: string[];
		try
		{
			notes = await this.applyPanelRole(interaction, tierKey);
		}
		finally
		{
			await interaction.editReply(tierPanelUpdate(this.panelData(guildId, guild)));
		}
		if (notes.length > 0) await interaction.followUp(ephemeral(notes.join("\n")));
	}

	/** Gán hoặc bỏ gán role theo lựa chọn; trả về ghi chú cần báo riêng cho người thao tác. */
	private async applyPanelRole(interaction: RoleSelectMenuInteraction<"cached">, tierKey: TierKey): Promise<string[]>
	{
		const { guild, guildId } = interaction;
		const actor = actorOf(interaction);
		const roleId = interaction.values[0];
		if (roleId === undefined)
		{
			const previous = assignedRole(this.services.tierRoles.list(guildId), tierKey);
			if (previous === null || !this.services.tierRoles.clear(guildId, tierKey, actor.id)) return [];
			return [clearedNote(previous, tierByKey(tierKey, this.services.tierSets.current(guildId)))];
		}
		const role = interaction.roles.get(roleId) ?? guild.roles.cache.get(roleId);
		if (!role) throw new UserError(SELECTED_ROLE_UNAVAILABLE);
		return assignmentNotes(role.id, await assignTierRole(guild, actor, this.services, tierKey, role));
	}

	/** Nút ✨: tạo/đồng bộ role rồi vẽ lại bảng và báo riêng kết quả từng bậc. */
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
		await interaction.editReply(tierPanelUpdate(this.panelData(guildId, guild)));
		await interaction.followUp(ephemeral(buildTierSetupReport(set, result)));
	}

	/**
	 * Lưu form đổi tên (DEC-033): mỗi ô tách emoji đầu chuỗi và tên; để trống là tên mặc định. Validate hết trước khi ghi
	 * (TierSetService.rename): lỗi thì không đổi gì và dispatcher báo riêng. Bộ đã đổi kể từ lúc mở form thì không lưu.
	 */
	private async panelRename(interaction: ModalMessageModalSubmitInteraction, group: TierNameGroup, setKey: TierSetKey): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const { tierSets } = this.services;
		if (tierSets.currentKey(guildId) !== setKey)
		{
			await interaction.update(tierPanelUpdate(this.panelData(guildId, interaction.guild)));
			throw new UserError(RENAME_SET_CHANGED);
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
		const callerMissing = missingPermissions(channel.permissionsFor(interaction.member), BOARD_CALLER_PERMISSIONS);
		if (callerMissing.length > 0)
		{
			throw new UserError(`Bạn không có quyền ${callerMissing.join(", ")} ở ${channelMention(channel.id)}, nên không thể đặt Bảng vàng ở kênh đó.`);
		}
		const missing = missingPermissions(channel.permissionsFor(botMemberOf(interaction)), BOARD_PERMISSIONS);
		if (missing.length > 0)
		{
			throw new UserError(`Bot thiếu quyền ${missing.join(", ")} ở ${channelMention(channel.id)}. Hãy cấp quyền cho bot ở kênh đó rồi thử lại.`);
		}

		// Xoá message cũ, vẽ và đăng bảng mới có thể mất vài giây: defer trước để không quá hạn 3 giây của interaction.
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const { previous } = this.services.liveBoards.setChannel(guildId, channel.id, actorId);
		if (previous?.messageId) await this.liveBoardActions.remove(this.client, previous);
		const posted = await this.liveBoardActions.refresh(this.client, guildId, { force: true });

		const lines = [`Đã đặt Bảng vàng ở ${channelMention(channel.id)}. Bot giữ một message bảng xếp hạng ở đó và tự cập nhật định kỳ.`];
		if (!posted)
		{
			lines.push("⚠️ Chưa đăng được bảng xếp hạng lên kênh này (xem log của bot). Bot sẽ thử lại ở lần cập nhật định kỳ tiếp theo.");
		}
		await interaction.editReply(lines.join("\n"));
	}

	private async disableLiveBoard({ interaction, guildId, actorId }: ConfigContext): Promise<void>
	{
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const previous = this.services.liveBoards.disable(guildId, actorId);
		if (!previous)
		{
			await interaction.editReply("Bảng vàng vốn đang tắt.");
			return;
		}

		const channel = channelMention(previous.channelId);
		if (!previous.messageId)
		{
			await interaction.editReply(`Đã tắt Bảng vàng ở ${channel}.`);
			return;
		}
		const deleted = await this.liveBoardActions.remove(this.client, previous);
		await interaction.editReply(deleted
			? `Đã tắt Bảng vàng và xoá message bảng xếp hạng ở ${channel}.`
			: `Đã tắt Bảng vàng. Không xoá được message bảng xếp hạng cũ ở ${channel} (có thể đã bị xoá); nếu còn, bạn có thể tự xoá.`);
	}
}
