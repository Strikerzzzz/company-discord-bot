import {
	APIInteractionDataResolvedGuildMember,
	APIInteractionGuildMember,
	ChatInputCommandInteraction,
	GuildMember,
	SlashCommandBuilder,
	User,
} from "discord.js";
import Command from "../../classes/Command";
import { requireGuildId } from "../../discord/guards";
import { roleIdsOf } from "../../discord/members";
import { rankEmbed } from "../../discord/views/activity";
import { UserError } from "../../shared/errors";

const TARGET_OPTION = "thanh-vien";

type AnyMember = GuildMember | APIInteractionGuildMember | APIInteractionDataResolvedGuildMember | null;

// Hồ sơ điểm của một thành viên: Activity XP, Contribution và team (hai loại điểm hiển thị tách biệt, DEC-004).
export default class RankCmd extends Command
{
	data = new SlashCommandBuilder()
		.setName("rank")
		.setDescription("Xem level, Activity XP, điểm Contribution và team của bạn hoặc một thành viên")
		.addUserOption(option => option
			.setName(TARGET_OPTION)
			.setDescription("Thành viên cần xem (mặc định là bạn)"));

	async execute(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const chosen = interaction.options.getUser(TARGET_OPTION);
		const target = chosen ?? interaction.user;
		if (target.bot) throw new UserError("Bot không có điểm.");

		// Người được chọn có thể đã rời server: không có member thì coi như không thuộc team nào.
		const member = chosen ? interaction.options.getMember(TARGET_OPTION) : interaction.member;
		const { activity, contributions, teams } = this.client.services;

		await interaction.reply({
			embeds: [rankEmbed({
				displayName: displayNameOf(target, member),
				avatarUrl: avatarUrlOf(target, member),
				activity: activity.getProfile(guildId, target.id),
				contribution: contributions.getProfile(guildId, target.id),
				teamRoleIds: teams.resolveTeams(guildId, roleIdsOf(member)),
			})],
		});
	}
}

function displayNameOf(user: User, member: AnyMember): string
{
	if (member instanceof GuildMember) return member.displayName;
	return member?.nick ?? user.displayName;
}

function avatarUrlOf(user: User, member: AnyMember): string
{
	return member instanceof GuildMember ? member.displayAvatarURL() : user.displayAvatarURL();
}
