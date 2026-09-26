import { ButtonInteraction, ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";
import Command from "../../classes/Command";
import { checkAdmin, checkCanCreatePoll, requireGuildId } from "../../discord/guards";
import { roleIdsOf } from "../../discord/members";
import { refreshPollMessage } from "../../discord/pollScheduler";
import {
	parsePollButtonId,
	parsePollOptions,
	POLL_BUTTON_NAMESPACE,
	pollEmbed,
	pollListEmbed,
	pollMessage,
	pollSelectionText,
} from "../../discord/views/poll";
import { SETTING_LIMITS } from "../../modules/guild-config/types";
import { POLL_LIMITS } from "../../modules/poll/types";
import { UserError } from "../../shared/errors";
import { logger } from "../../shared/logger";

// Độ dài tối đa của chuỗi lựa chọn: 10 lựa chọn × 80 ký tự cộng dấu phân cách.
const OPTIONS_INPUT_MAX = 1000;

// Vote / bầu cử / lấy ý kiến với phiếu ẩn danh (DEC-026).
export default class PollCmd extends Command
{
	override buttonIds = [POLL_BUTTON_NAMESPACE];

	data = new SlashCommandBuilder()
		.setName("poll")
		.setDescription("Tạo và quản lý vote, bầu cử, lấy ý kiến (phiếu ẩn danh)")
		.addSubcommand(sub => sub
			.setName("create")
			.setDescription("Tạo một vote mới")
			.addStringOption(option => option
				.setName("cau-hoi")
				.setDescription("Câu hỏi của vote")
				.setRequired(true)
				.setMinLength(POLL_LIMITS.questionMin)
				.setMaxLength(POLL_LIMITS.questionMax))
			.addStringOption(option => option
				.setName("lua-chon")
				.setDescription(`${POLL_LIMITS.optionsMin}–${POLL_LIMITS.optionsMax} lựa chọn, phân cách bằng dấu | (ví dụ: Có | Không | Chưa rõ)`)
				.setRequired(true)
				.setMaxLength(OPTIONS_INPUT_MAX))
			.addBooleanOption(option => option
				.setName("nhieu-lua-chon")
				.setDescription("Cho phép chọn nhiều lựa chọn (mặc định: chỉ chọn một)"))
			.addIntegerOption(option => option
				.setName("thoi-han-phut")
				.setDescription("Tự đóng sau số phút này (bỏ trống: không tự đóng)")
				.setMinValue(POLL_LIMITS.durationMinutesMin)
				.setMaxValue(POLL_LIMITS.durationMinutesMax))
			.addIntegerOption(option => option
				.setName("xp")
				.setDescription("XP cho mỗi người tham gia (chỉ admin; bỏ trống: mức mặc định của server)")
				.setMinValue(SETTING_LIMITS.defaultPollXp.min)
				.setMaxValue(SETTING_LIMITS.defaultPollXp.max)))
		.addSubcommand(sub => sub
			.setName("close")
			.setDescription("Đóng một vote (người tạo hoặc admin)")
			.addIntegerOption(option => option
				.setName("id")
				.setDescription("Mã số vote (số sau dấu #)")
				.setRequired(true)
				.setMinValue(1)))
		.addSubcommand(sub => sub
			.setName("results")
			.setDescription("Xem kết quả một vote")
			.addIntegerOption(option => option
				.setName("id")
				.setDescription("Mã số vote (số sau dấu #)")
				.setRequired(true)
				.setMinValue(1)))
		.addSubcommand(sub => sub
			.setName("list")
			.setDescription("Xem các vote đang mở"));

	async execute(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const subcommand = interaction.options.getSubcommand(true);
		switch (subcommand)
		{
		case "create":
			await this.create(interaction);
			return;
		case "close":
			await this.close(interaction);
			return;
		case "results":
			await this.results(interaction);
			return;
		case "list":
			await this.list(interaction);
			return;
		default:
			throw new Error(`Subcommand không được hỗ trợ: ${subcommand}`);
		}
	}

	// Bấm một lựa chọn: chọn một thì đổi phiếu, chọn nhiều thì bật/tắt lựa chọn đó.
	override async executeButton(interaction: ButtonInteraction): Promise<void>
	{
		const { pollId, optionIndex } = parsePollButtonId(interaction.customId);
		const guildId = requireGuildId(interaction);
		const result = this.client.services.polls.vote({
			guildId,
			pollId,
			userId: interaction.user.id,
			optionIndex,
			roleIds: roleIdsOf(interaction.member),
		});

		await interaction.update(pollMessage(result.poll));
		await interaction.followUp({ content: pollSelectionText(result), flags: MessageFlags.Ephemeral });
	}

	private async create(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const { services } = this.client;
		if (!checkCanCreatePoll(interaction, services)) throw new UserError("Bạn không có quyền tạo vote.");

		// Người tạo không phải admin chỉ dùng mức XP mặc định (DEC-026).
		const xp = interaction.options.getInteger("xp");
		if (xp !== null && !checkAdmin(interaction, services)) throw new UserError("Chỉ admin mới đặt được XP riêng cho vote.");

		const poll = services.polls.create({
			guildId,
			creatorId: interaction.user.id,
			question: interaction.options.getString("cau-hoi", true),
			options: parsePollOptions(interaction.options.getString("lua-chon", true)),
			multiSelect: interaction.options.getBoolean("nhieu-lua-chon") ?? false,
			xpReward: xp ?? services.guildConfig.getSettings(guildId).defaultPollXp,
			durationMinutes: interaction.options.getInteger("thoi-han-phut"),
		});

		const response = await interaction.reply({ ...pollMessage(poll), withResponse: true });
		const message = response.resource?.message;
		if (!message)
		{
			logger.warn(`Không lấy được message của vote #${poll.id}; message sẽ không được cập nhật khi vote đóng.`);
			return;
		}
		services.polls.attachMessage(guildId, poll.id, message.channelId, message.id);
	}

	private async close(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const { services } = this.client;
		const poll = services.polls.close({
			guildId,
			pollId: interaction.options.getInteger("id", true),
			actorId: interaction.user.id,
			actorIsAdmin: checkAdmin(interaction, services),
		});

		// Trả lời trước (hạn 3 giây của interaction), sau đó mới sửa message gốc; lỗi khi sửa chỉ ghi log.
		await interaction.reply({ content: "Đã đóng vote.", embeds: [pollEmbed(poll)], flags: MessageFlags.Ephemeral });
		await refreshPollMessage(this.client, poll);
	}

	private async results(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const pollId = interaction.options.getInteger("id", true);
		const poll = this.client.services.polls.get(guildId, pollId);
		if (!poll) throw new UserError(`Không tìm thấy vote #${pollId}.`);

		await interaction.reply({ embeds: [pollEmbed(poll)], flags: MessageFlags.Ephemeral });
	}

	private async list(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const polls = this.client.services.polls.listOpen(guildId);

		await interaction.reply({ embeds: [pollListEmbed(polls)], flags: MessageFlags.Ephemeral });
	}
}
