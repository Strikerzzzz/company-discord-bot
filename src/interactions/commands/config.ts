import {
	APIRole,
	ChannelType,
	ChatInputCommandInteraction,
	GuildMember,
	MessageFlags,
	PermissionFlagsBits,
	Role,
	SlashCommandBuilder,
	SlashCommandSubcommandBuilder,
	SlashCommandSubcommandGroupBuilder,
} from "discord.js";
import Command from "../../classes/Command";
import { channelMention, formatNumber, roleMention } from "../../discord/format";
import { requireGuildId } from "../../discord/guards";
import { deleteLiveBoardMessage, refreshLiveBoard } from "../../discord/liveBoard";
import { tierRoleSafetyIssue } from "../../discord/roleSync";
import {
	buildChannelListEmbed,
	buildConfigEmbed,
	buildTeamListEmbed,
	buildTierRoleListEmbed,
	describeChannelSettings,
	describeSettingsPatch,
	ephemeral,
	ephemeralEmbed,
	settingLine,
	TIER_ROLE_SYNC_NOTE,
} from "../../discord/views/admin";
import { isTierKey, Tier, tierByKey, TIERS } from "../../modules/activity/tiers";
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

/** Quyền bot cần ở kênh Bảng vàng để đăng message kèm ảnh (DEC-030). */
const BOARD_PERMISSIONS: readonly (readonly [bigint, string])[] = [
	[PermissionFlagsBits.ViewChannel, "View Channel"],
	[PermissionFlagsBits.SendMessages, "Send Messages"],
	[PermissionFlagsBits.AttachFiles, "Attach Files"],
];

/** Lựa chọn cảnh giới, ví dụ "Luyện Khí (Lv 0+)"; value là khoá cảnh giới. */
const TIER_CHOICES = TIERS.map(tier => ({ name: `${tier.name} (Lv ${tier.minLevel}+)`, value: tier.key }));

const GUILD_UNAVAILABLE = "Không đọc được thông tin server. Vui lòng thử lại sau.";
const BOT_MEMBER_UNAVAILABLE = "Không đọc được thông tin của bot trong server. Vui lòng thử lại sau.";
const MANAGE_ROLES_WARNING = "⚠️ Bot chưa có quyền **Manage Roles** nên chưa gán được role. "
	+ "Hãy cấp quyền này cho role của bot và kéo role của bot lên trên các role cảnh giới (Server Settings → Roles).";

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
		.setName("canh-gioi")
		.setDescription("Cảnh giới tu luyện")
		.setRequired(true)
		.addChoices(...TIER_CHOICES));
}

function tierRoleGroup(group: SlashCommandSubcommandGroupBuilder): SlashCommandSubcommandGroupBuilder
{
	return group
		.setName("canh-gioi")
		.setDescription("Role Discord bot tự gán theo cảnh giới tu luyện")
		.addSubcommand(sub => addRole(
			tierOption(sub.setName("gan-role").setDescription("Gán role cho một cảnh giới")),
			"Role bot sẽ tự gán cho thành viên đạt cảnh giới này",
			true,
		))
		.addSubcommand(sub => tierOption(sub.setName("bo-role").setDescription("Bỏ role của một cảnh giới")))
		.addSubcommand(sub => sub.setName("list").setDescription("Xem role của từng cảnh giới"));
}

function liveBoardSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder
{
	return sub
		.setName("bang-vang")
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

function tierOf(interaction: ChatInputCommandInteraction): Tier
{
	const key = interaction.options.getString("canh-gioi", true);
	if (!isTierKey(key)) throw new UserError("Cảnh giới không hợp lệ.");
	return tierByKey(key);
}

function tierTitle(tier: Tier): string
{
	return `${tier.emoji} **${tier.name}** (từ Level ${formatNumber(tier.minLevel)})`;
}

/** Role đang gán cho cảnh giới `tier`; null nếu chưa gán. */
function assignedRole(mappings: readonly TierRoleMapping[], tier: Tier): string | null
{
	return mappings.find(mapping => mapping.tierKey === tier.key)?.roleId ?? null;
}

/** Chặn @everyone và role do bot/integration quản lý (không gán được cho người dùng). */
function assertAssignableRole(role: Role | APIRole, guildId: string, purpose: string): void
{
	if (role.id === guildId) throw new UserError(`Không thể dùng @everyone ${purpose}.`);
	if (role.managed) throw new UserError(`Không thể dùng role do bot hoặc integration quản lý ${purpose}.`);
}

function requireChange(patch: object): void
{
	if (Object.keys(patch).length === 0) throw new UserError(NO_CHANGE_MESSAGE);
}

// Cấu hình bot theo server. Hai lớp quyền: ManageGuild (Discord) + adminOnly (dispatcher).
export default class ConfigCmd extends Command
{
	override adminOnly = true;

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
		.addSubcommandGroup(tierRoleGroup)
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
		else if (group === "canh-gioi") await this.executeTierRoles(context, subcommand);
		else if (subcommand === "view") await this.view(context);
		else if (subcommand === "xp") await this.updateXp(context);
		else if (subcommand === "admin-role") await this.updateAdminRole(context);
		else if (subcommand === "poll") await this.updatePoll(context);
		else if (subcommand === "contribution") await this.updateContribution(context);
		else if (subcommand === "bang-vang") await this.updateLiveBoard(context);
		else throw new Error(`Subcommand không hợp lệ: /config ${group ?? ""} ${subcommand}`);
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

	private async executeTierRoles(context: ConfigContext, subcommand: string): Promise<void>
	{
		switch (subcommand)
		{
		case "gan-role":
			await this.assignTierRole(context);
			break;
		case "bo-role":
			await this.clearTierRole(context);
			break;
		case "list":
			await context.interaction.reply(ephemeralEmbed(buildTierRoleListEmbed(this.services.tierRoles.list(context.guildId))));
			break;
		default:
			throw new Error(`Subcommand không hợp lệ: /config canh-gioi ${subcommand}`);
		}
	}

	private async view({ interaction, guildId }: ConfigContext): Promise<void>
	{
		const { guildConfig, teams, liveBoards, tierRoles } = this.services;
		const embed = buildConfigEmbed(guildConfig.getSettings(guildId), teams.list(guildId), guildConfig.listChannels(guildId), {
			boardChannelId: liveBoards.get(guildId)?.channelId ?? null,
			tierRoles: tierRoles.list(guildId),
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

	/** Gán role cho một cảnh giới sau khi kiểm tra role an toàn và bot quản lý được (DEC-031). */
	private async assignTierRole({ interaction: base, guildId, actorId }: ConfigContext): Promise<void>
	{
		const interaction = requireCachedGuild(base);
		const tier = tierOf(interaction);
		const role = interaction.options.getRole("role", true);
		const me = botMemberOf(interaction);
		const issue = tierRoleSafetyIssue(role, me);
		if (issue !== null) throw new UserError(issue);

		const { tierRoles } = this.services;
		const previous = assignedRole(tierRoles.list(guildId), tier);
		tierRoles.set(guildId, tier.key, role.id, actorId);

		const lines = [`Đã gán ${roleMention(role.id)} cho cảnh giới ${tierTitle(tier)}.`, TIER_ROLE_SYNC_NOTE];
		if (previous !== null && previous !== role.id)
		{
			lines.push(`Role cũ ${roleMention(previous)} không còn do bot quản lý; bot không tự gỡ role đó khỏi những người đang có.`);
		}
		if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) lines.push(MANAGE_ROLES_WARNING);
		await interaction.reply(ephemeral(lines.join("\n")));
	}

	private async clearTierRole({ interaction, guildId, actorId }: ConfigContext): Promise<void>
	{
		const tier = tierOf(interaction);
		const { tierRoles } = this.services;
		const previous = assignedRole(tierRoles.list(guildId), tier);
		if (previous === null || !tierRoles.clear(guildId, tier.key, actorId))
		{
			await interaction.reply(ephemeral(`Cảnh giới ${tierTitle(tier)} chưa được gán role.`));
			return;
		}
		await interaction.reply(ephemeral(
			`Đã bỏ ${roleMention(previous)} khỏi cảnh giới ${tierTitle(tier)}. Bot không tự gỡ role đó khỏi những người đang có; nếu cần, hãy gỡ thủ công.`,
		));
	}

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
		const permissions = channel.permissionsFor(botMemberOf(interaction));
		const missing = BOARD_PERMISSIONS.filter(([flag]) => !permissions.has(flag)).map(([, name]) => `**${name}**`);
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
