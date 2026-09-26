import { ButtonInteraction, ChatInputCommandInteraction, CommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";
import Command from "../../classes/Command";
import { requireGuildId } from "../../discord/guards";
import { roleIdsOf } from "../../discord/members";
import {
	CONTRIBUTION_BUTTON_NAMESPACE,
	CONTRIBUTION_LIST_LIMIT,
	contributionListEmbed,
	contributionMessage,
	parseCategory,
	parseContributionButtonId,
	voteFeedback,
} from "../../discord/views/contribution";
import { Contribution, CONTRIBUTION_CATEGORIES, CONTRIBUTION_LIMITS, ContributionServiceApi } from "../../modules/contribution/types";
import { UserError } from "../../shared/errors";
import { logger } from "../../shared/logger";

/**
 * Trả lời CÔNG KHAI bằng embed + nút ghi nhận, rồi lưu vị trí message để cập nhật sau này.
 * Dùng chung cho /contribution submit và context menu "Ghi nhận đóng góp".
 */
export async function publishContribution(interaction: CommandInteraction, contributions: ContributionServiceApi, contribution: Contribution): Promise<void>
{
	const response = await interaction.reply({ ...contributionMessage(contribution), withResponse: true });
	const message = response.resource?.message;
	if (!message)
	{
		logger.warn(`Không lấy được message của contribution #${contribution.id}; message sẽ không được cập nhật về sau.`);
		return;
	}
	contributions.attachMessage(contribution.guildId, contribution.id, message.channelId, message.id);
}

// Gửi, xem và ghi nhận Contribution (DEC-025).
export default class ContributionCmd extends Command
{
	override buttonIds = [CONTRIBUTION_BUTTON_NAMESPACE];

	data = new SlashCommandBuilder()
		.setName("contribution")
		.setDescription("Gửi và xem đóng góp để mọi người ghi nhận")
		.addSubcommand(sub => sub
			.setName("submit")
			.setDescription("Gửi một đóng góp của bạn để mọi người ghi nhận")
			.addStringOption(option => option
				.setName("tieu-de")
				.setDescription("Tiêu đề ngắn gọn của đóng góp")
				.setRequired(true)
				.setMinLength(CONTRIBUTION_LIMITS.titleMin)
				.setMaxLength(CONTRIBUTION_LIMITS.titleMax))
			.addStringOption(option => option
				.setName("noi-dung")
				.setDescription("Mô tả chi tiết đóng góp")
				.setRequired(true)
				.setMaxLength(CONTRIBUTION_LIMITS.descriptionMax))
			.addStringOption(option => option
				.setName("loai")
				.setDescription("Loại đóng góp")
				.setRequired(true)
				.addChoices(...CONTRIBUTION_CATEGORIES.map(category => ({ name: category.label, value: category.value }))))
			.addStringOption(option => option
				.setName("link")
				.setDescription("Link liên quan (http hoặc https)")
				.setMaxLength(CONTRIBUTION_LIMITS.linkMax)))
		.addSubcommand(sub => sub
			.setName("view")
			.setDescription("Xem chi tiết một đóng góp")
			.addIntegerOption(option => option
				.setName("id")
				.setDescription("Mã số đóng góp (số sau dấu #)")
				.setRequired(true)
				.setMinValue(1)))
		.addSubcommand(sub => sub
			.setName("list")
			.setDescription(`Xem ${CONTRIBUTION_LIST_LIMIT} đóng góp mới nhất`)
			.addUserOption(option => option
				.setName("thanh-vien")
				.setDescription("Chỉ xem đóng góp của thành viên này")));

	async execute(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const subcommand = interaction.options.getSubcommand(true);
		switch (subcommand)
		{
		case "submit":
			await this.submit(interaction);
			return;
		case "view":
			await this.view(interaction);
			return;
		case "list":
			await this.list(interaction);
			return;
		default:
			throw new Error(`Subcommand không được hỗ trợ: ${subcommand}`);
		}
	}

	// Bấm nút ghi nhận: bấm lần nữa để rút (DEC-025).
	override async executeButton(interaction: ButtonInteraction): Promise<void>
	{
		const contributionId = parseContributionButtonId(interaction.customId);
		const guildId = requireGuildId(interaction);
		const result = this.client.services.contributions.toggleVote({ guildId, contributionId, voterId: interaction.user.id });

		await interaction.update(contributionMessage(result.contribution));
		await interaction.followUp({ content: voteFeedback(result.voted), flags: MessageFlags.Ephemeral });
	}

	private async submit(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const { contributions } = this.client.services;
		const contribution = contributions.submit({
			guildId,
			authorId: interaction.user.id,
			submittedBy: interaction.user.id,
			title: interaction.options.getString("tieu-de", true),
			description: interaction.options.getString("noi-dung", true),
			category: parseCategory(interaction.options.getString("loai", true)),
			link: interaction.options.getString("link"),
			authorRoleIds: roleIdsOf(interaction.member),
		});

		await publishContribution(interaction, contributions, contribution);
	}

	private async view(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const contributionId = interaction.options.getInteger("id", true);
		const contribution = this.client.services.contributions.get(guildId, contributionId);
		if (!contribution) throw new UserError(`Không tìm thấy đóng góp #${contributionId}.`);

		await interaction.reply({ ...contributionMessage(contribution), flags: MessageFlags.Ephemeral });
	}

	private async list(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const member = interaction.options.getUser("thanh-vien");
		const contributions = this.client.services.contributions.list(guildId, {
			authorId: member?.id,
			limit: CONTRIBUTION_LIST_LIMIT,
		});

		await interaction.reply({ embeds: [contributionListEmbed(contributions, member?.id ?? null)], flags: MessageFlags.Ephemeral });
	}
}
