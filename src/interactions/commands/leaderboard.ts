import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";
import Command from "../../classes/Command";
import { canSendMessages, requireGuildId } from "../../discord/guards";
import { LeaderboardScope, leaderboardEmbed } from "../../discord/views/activity";
import { ScoreKind } from "../../modules/leaderboard/LeaderboardService";
import { UserError } from "../../shared/errors";

const KIND_OPTION = "loai";
const SCOPE_OPTION = "pham-vi";
const PAGE_OPTION = "trang";

// 4 bảng xếp hạng: cá nhân/team × Activity XP/Contribution; hai loại điểm luôn tách biệt (DEC-004).
export default class LeaderboardCmd extends Command
{
	data = new SlashCommandBuilder()
		.setName("leaderboard")
		.setDescription("Xem bảng xếp hạng Activity XP hoặc Contribution, theo cá nhân hoặc team")
		.addStringOption(option => option
			.setName(KIND_OPTION)
			.setDescription("Loại điểm cần xếp hạng")
			.setRequired(true)
			.addChoices(
				{ name: "Activity XP", value: "activity" },
				{ name: "Contribution", value: "contribution" },
			))
		.addStringOption(option => option
			.setName(SCOPE_OPTION)
			.setDescription("Xếp hạng theo cá nhân hay theo team (mặc định: cá nhân)")
			.addChoices(
				{ name: "Cá nhân", value: "ca-nhan" },
				{ name: "Team", value: "team" },
			))
		.addIntegerOption(option => option
			.setName(PAGE_OPTION)
			.setDescription("Số trang (mặc định: trang 1)")
			.setMinValue(1));

	async execute(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const kind = parseKind(interaction.options.getString(KIND_OPTION, true));
		const scope = parseScope(interaction.options.getString(SCOPE_OPTION));
		const page = interaction.options.getInteger(PAGE_OPTION) ?? 1;

		const { leaderboard } = this.client.services;
		const result = scope === "team"
			? leaderboard.teams(guildId, kind, page)
			: leaderboard.individual(guildId, kind, page);

		// Người không được gửi tin ở kênh này chỉ nhận kết quả riêng, không đăng công khai qua bot.
		await interaction.reply({
			embeds: [leaderboardEmbed({ kind, scope, page: result })],
			flags: canSendMessages(interaction) ? undefined : MessageFlags.Ephemeral,
		});
	}
}

function parseKind(value: string): ScoreKind
{
	if (value === "activity" || value === "contribution") return value;
	throw new UserError("Loại bảng xếp hạng không hợp lệ.");
}

function parseScope(value: string | null): LeaderboardScope
{
	if (value === null || value === "ca-nhan") return "individual";
	if (value === "team") return "team";
	throw new UserError("Phạm vi bảng xếp hạng không hợp lệ.");
}
