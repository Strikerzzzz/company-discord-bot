import { ButtonInteraction, ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";
import Command from "../../classes/Command";
import { assertCanSendMessages, canViewChannel, checkAdmin, checkCanCreatePoll, filterViewable, requireGuildId } from "../../discord/guards";
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
	pollXpCapNotice,
} from "../../discord/views/poll";
import { SETTING_LIMITS } from "../../modules/guild-config/types";
import { Poll, POLL_LIMITS } from "../../modules/poll/types";
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
		// Vote được đăng công khai thay người tạo: phải có quyền gửi tin ở kênh này.
		assertCanSendMessages(interaction);

		const settings = services.guildConfig.getSettings(guildId);
		const poll = services.polls.create({
			guildId,
			creatorId: interaction.user.id,
			question: interaction.options.getString("cau-hoi", true),
			options: parsePollOptions(interaction.options.getString("lua-chon", true)),
			multiSelect: interaction.options.getBoolean("nhieu-lua-chon") ?? false,
			xpReward: xp ?? settings.defaultPollXp,
			durationMinutes: interaction.options.getInteger("thoi-han-phut"),
		});

		const response = await interaction.reply({ ...pollMessage(poll), withResponse: true });
		const message = response.resource?.message;
		if (message) services.polls.attachMessage(guildId, poll.id, message.channelId, message.id);
		else logger.warn(`Không lấy được message của vote #${poll.id}; message sẽ không được cập nhật khi vote đóng.`);

		await this.sendCapNotice(interaction, poll, settings.pollXpDailyCap);
	}

	/** Ghi chú riêng cho người tạo nếu XP của vote vượt giới hạn XP từ vote mỗi ngày; gửi lỗi chỉ ghi cảnh báo (vote đã tạo xong). */
	private async sendCapNotice(interaction: ChatInputCommandInteraction, poll: Poll, dailyCap: number): Promise<void>
	{
		const notice = pollXpCapNotice(poll.xpReward, dailyCap);
		if (notice === null) return;
		try
		{
			await interaction.followUp({ content: notice, flags: MessageFlags.Ephemeral });
		}
		catch (error)
		{
			logger.warn(`Không gửi được ghi chú giới hạn XP cho người tạo vote #${poll.id}:`, error);
		}
	}

	private async close(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const pollId = interaction.options.getInteger("id", true);
		const { services } = this.client;
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		// Đóng vote hiển thị kết quả, nên cũng chỉ dành cho người xem được kênh của vote.
		await this.requireVisiblePoll(interaction, guildId, pollId);
		const poll = services.polls.close({ guildId, pollId, actorId: interaction.user.id, actorIsAdmin: checkAdmin(interaction, services) });

		// Trả lời trước, sau đó mới sửa message gốc; lỗi khi sửa chỉ ghi log.
		await interaction.editReply({ content: "Đã đóng vote.", embeds: [pollEmbed(poll)] });
		await refreshPollMessage(this.client, poll);
	}

	private async results(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const pollId = interaction.options.getInteger("id", true);
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const poll = await this.requireVisiblePoll(interaction, guildId, pollId);
		await interaction.editReply({ embeds: [pollEmbed(poll)] });
	}

	/** Chỉ liệt kê vote thuộc kênh người gọi xem được. */
	private async list(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const polls = await filterViewable(this.client, interaction, this.client.services.polls.listOpen(guildId));
		await interaction.editReply({ embeds: [pollListEmbed(polls)] });
	}

	/** Vote theo mã; người không xem được kênh của vote nhận "không tìm thấy" như với mã không tồn tại. */
	private async requireVisiblePoll(interaction: ChatInputCommandInteraction, guildId: string, pollId: number): Promise<Poll>
	{
		const poll = this.client.services.polls.get(guildId, pollId);
		if (!poll || !(await canViewChannel(this.client, interaction, poll.channelId))) throw new UserError(`Không tìm thấy vote #${pollId}.`);
		return poll;
	}
}
