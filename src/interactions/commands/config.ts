import { APIRole, ChannelType, ChatInputCommandInteraction, PermissionFlagsBits, Role, SlashCommandBuilder, SlashCommandSubcommandBuilder } from "discord.js";
import Command from "../../classes/Command";
import { channelMention, roleMention } from "../../discord/format";
import { requireGuildId } from "../../discord/guards";
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
import { ChannelSettings, GuildSettings, NumericSettingKey, SETTING_LIMITS } from "../../modules/guild-config/types";
import { AppServices } from "../../services";
import { UserError } from "../../shared/errors";

const NO_CHANGE_MESSAGE = "Hãy chọn ít nhất một giá trị để thay đổi.";

/** Loại channel có tin nhắn tính XP. */
const XP_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum] as const;

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
	sub.setName("poll").setDescription("Cấu hình vote: XP mặc định và role được tạo vote");
	addSettingOption(sub, { name: "xp-mac-dinh", key: "defaultPollXp", description: "XP mặc định cho người tham gia vote" });
	return sub
		.addRoleOption(option => option.setName("role-tao-vote").setDescription("Role được phép tạo vote (ngoài admin)"))
		.addBooleanOption(option => option.setName("xoa-role-tao-vote").setDescription("Xoá role tạo vote (chỉ admin tạo được vote)"));
}

function contributionSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder
{
	sub.setName("contribution").setDescription("Cấu hình điểm contribution");
	return addSettingOption(sub, { name: "diem-moi-luot", key: "contributionVotePoints", description: "Điểm cộng cho tác giả mỗi lượt ghi nhận" }, true);
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
		.addSubcommand(contributionSubcommand);

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
		else if (subcommand === "view") await this.view(context);
		else if (subcommand === "xp") await this.updateXp(context);
		else if (subcommand === "admin-role") await this.updateAdminRole(context);
		else if (subcommand === "poll") await this.updatePoll(context);
		else if (subcommand === "contribution") await this.updateContribution(context);
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

	private async view({ interaction, guildId }: ConfigContext): Promise<void>
	{
		const { guildConfig, teams } = this.services;
		const embed = buildConfigEmbed(guildConfig.getSettings(guildId), teams.list(guildId), guildConfig.listChannels(guildId));
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
			await context.interaction.reply(ephemeral(
				`Đã đặt ${roleMention(role.id)} làm role admin bot. Người có quyền Manage Server vẫn luôn là admin.`,
			));
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
}
