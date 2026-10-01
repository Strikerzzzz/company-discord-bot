import {
	AutocompleteInteraction,
	ButtonInteraction,
	ChatInputCommandInteraction,
	Interaction,
	MessageFlags,
	ModalSubmitInteraction,
	SlashCommandBuilder,
	SlashCommandIntegerOption,
	TextBasedChannel,
} from "discord.js";
import Command from "../../classes/Command";
import { assertCanSendMessages, canViewChannel, checkAdmin, memberAccess, requireGuildId } from "../../discord/guards";
import { roleIdsOf } from "../../discord/members";
import {
	assertBotCanUseRetroChannel,
	botActorId,
	closeRetroSession,
	createRetroSession,
	extendRetroSession,
	pickRetroName,
	remindRetro,
	reopenRetroSession,
	repostRetroSession,
	repostRetroSummary,
	RETRO_BOT_CANNOT_SEE,
	retroContext,
	retroDocReportLine,
	sessionMessageNote,
	startRetroVote,
	writeRetroDoc,
} from "../../discord/retroOps";
import {
	INVALID_RETRO_COMPONENT,
	NO_MENTIONS,
	parseRetroComponentId,
	RETRO_INPUT_IDS,
	RETRO_NAMESPACE,
	retroModal,
	retroSavedText,
	retroSessionMessage,
	retroStatusText,
} from "../../discord/views/retro";
import { canCreateRetro, canManageRetro, RetroAccess } from "../../modules/retro/permissions";
import { RETRO_NOT_ACCEPTING, RETRO_NOT_FOUND } from "../../modules/retro/RetroService";
import { RETRO_LIMITS, RetroAnswersInput, RetroSession } from "../../modules/retro/types";
import { UserError } from "../../shared/errors";
import { logger } from "../../shared/logger";

export const RETRO_CREATE_DENIED = "Chỉ admin bot hoặc người có role quản lý retro mới tạo được phiên retro.";
export const RETRO_NOT_MANAGER = "Chỉ người quản lý phiên retro (admin bot, người tạo phiên, hoặc role quản lý retro) mới dùng được lệnh này.";
export const NO_SESSION_HERE = "Kênh này chưa có phiên retro nào. Dùng `/retro create` để tạo, hoặc thêm option `id` để chọn phiên.";
export const RETRO_WRONG_CHANNEL = "Nút và form điền retro chỉ dùng được ngay trong kênh hoặc thread của phiên.";
/** Độ dài tối đa của option danh sách rút gọn: 10 tên × 80 ký tự cộng dấu phân cách. */
const SHORTLIST_INPUT_MAX = 1000;

/**
 * Retro sprint theo team (DEC-049). Không đặt adminOnly hay setDefaultMemberPermissions: người quản lý phiên có thể chỉ có role quản
 * lý retro (không có Manage Server), nên lệnh hiện cho mọi người và mỗi subcommand tự kiểm tra quyền trong code (canCreateRetro,
 * canManageRetro). Người không phải admin bot chỉ thao tác được phiên ở kênh/thread mình xem được. Thành viên điền retro qua nút
 * "📝 Điền retro" trên tin của phiên (form 5 ô), không qua subcommand.
 */
export default class RetroCmd extends Command
{
	override buttonIds = [RETRO_NAMESPACE];

	data = new SlashCommandBuilder()
		.setName("retro")
		.setDescription("Retro sprint theo team: điền ẩn danh trong kênh/thread, tổng hợp, vote tên sprint")
		.addSubcommand(sub => sub
			.setName("create")
			.setDescription("Tạo phiên retro trong kênh/thread này (admin bot hoặc role quản lý retro)")
			.addStringOption(option => option
				.setName("ten")
				.setDescription("Tên phiên, ví dụ: Retrospective PMS Sprint 24")
				.setRequired(true)
				.setMinLength(RETRO_LIMITS.titleMin)
				.setMaxLength(RETRO_LIMITS.titleMax))
			.addStringOption(option => option
				.setName("link")
				.setDescription("Link trang Confluence của buổi retro (bot ghi bảng ẩn danh vào cuối trang)")
				.setMaxLength(RETRO_LIMITS.docUrlMax))
			.addRoleOption(option => option
				.setName("team")
				.setDescription("Chỉ team này điền được (team đã cấu hình); bỏ trống: ai xem được kênh cũng điền được"))
			.addIntegerOption(option => option
				.setName("han-gio")
				.setDescription("Tự đóng sau số giờ này (bỏ trống: người quản lý tự đóng)")
				.setMinValue(RETRO_LIMITS.durationHoursMin)
				.setMaxValue(RETRO_LIMITS.durationHoursMax)))
		.addSubcommand(sub => sub
			.setName("close")
			.setDescription("Đóng phiên: đăng bảng tổng hợp ẩn danh và ghi Confluence")
			.addIntegerOption(idOption))
		.addSubcommand(sub => sub
			.setName("reopen")
			.setDescription("Mở lại phiên đã đóng (chưa tạo vote tên sprint)")
			.addIntegerOption(idOption)
			.addIntegerOption(option => option
				.setName("han-gio")
				.setDescription("Tự đóng sau số giờ này (bỏ trống: không tự đóng)")
				.setMinValue(RETRO_LIMITS.durationHoursMin)
				.setMaxValue(RETRO_LIMITS.durationHoursMax)))
		.addSubcommand(sub => sub
			.setName("extend")
			.setDescription("Đặt hạn mới cho phiên đang mở")
			.addIntegerOption(option => option
				.setName("han-gio")
				.setDescription("Tự đóng sau số giờ này, tính từ bây giờ")
				.setRequired(true)
				.setMinValue(RETRO_LIMITS.durationHoursMin)
				.setMaxValue(RETRO_LIMITS.durationHoursMax))
			.addIntegerOption(idOption))
		.addSubcommand(sub => sub
			.setName("vote")
			.setDescription("Tạo vote tên sprint từ các tên được đề xuất (phiên đã đóng)")
			.addIntegerOption(idOption)
			.addStringOption(option => option
				.setName("rut-gon")
				.setDescription("Hơn 10 tên: chọn 2–10 tên đưa vào vote, cách nhau bằng dấu | (ví dụ: Rồng Lửa | Phượng Hoàng)")
				.setMaxLength(SHORTLIST_INPUT_MAX)))
		.addSubcommand(sub => sub
			.setName("status")
			.setDescription("Xem tình trạng phiên (admin bot thấy thêm danh sách người đã điền)")
			.addIntegerOption(idOption))
		.addSubcommand(sub => sub
			.setName("remind")
			.setDescription("Nhắc điền retro trong kênh của phiên (ping role team nếu có)")
			.addIntegerOption(idOption))
		.addSubcommand(sub => sub
			.setName("pick")
			.setDescription("Chọn tên sprint cuối cùng khi vote hoà (hoặc khi chỉ có một tên đề xuất)")
			.addStringOption(option => option
				.setName("ten")
				.setDescription("Tên sprint được chọn")
				.setRequired(true)
				.setMaxLength(RETRO_LIMITS.sprintNameMax)
				.setAutocomplete(true))
			.addIntegerOption(idOption))
		.addSubcommand(sub => sub
			.setName("write")
			.setDescription("Ghi lại bảng retro vào trang Confluence đã gắn")
			.addIntegerOption(idOption))
		.addSubcommand(sub => sub
			.setName("repost")
			.setDescription("Đăng lại tin của phiên (có nút 📝 Điền retro) khi tin cũ bị xoá hoặc bot không sửa được")
			.addIntegerOption(idOption))
		.addSubcommand(sub => sub
			.setName("summary")
			.setDescription("Đăng lại bảng tổng hợp ẩn danh của phiên đã đóng")
			.addIntegerOption(idOption));

	async execute(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const subcommand = interaction.options.getSubcommand(true);
		switch (subcommand)
		{
		case "create":
			await this.create(interaction);
			return;
		case "close":
			await this.manage(interaction, (guildId, session) => closeRetroSession(retroContext(this.client), guildId, session.id, interaction.user.id));
			return;
		case "reopen":
			await this.manage(interaction, (guildId, session) =>
				reopenRetroSession(retroContext(this.client), guildId, session.id, interaction.user.id, interaction.options.getInteger("han-gio")));
			return;
		case "extend":
			await this.manage(interaction, (guildId, session) =>
				extendRetroSession(retroContext(this.client), guildId, session.id, interaction.user.id, interaction.options.getInteger("han-gio", true)));
			return;
		case "vote":
			await this.manage(interaction, (guildId, session) =>
				startRetroVote(retroContext(this.client), guildId, session.id, interaction.user.id, parseShortlist(interaction.options.getString("rut-gon"))));
			return;
		case "status":
			await this.status(interaction);
			return;
		case "remind":
			await this.manage(interaction, (guildId, session) => remindRetro(retroContext(this.client), guildId, session.id));
			return;
		case "pick":
			await this.manage(interaction, (guildId, session) =>
				pickRetroName(retroContext(this.client), guildId, session.id, interaction.options.getString("ten", true), interaction.user.id));
			return;
		case "write":
			await this.manage(interaction, async (guildId, session) =>
				retroDocReportLine(await writeRetroDoc(retroContext(this.client), guildId, session.id, { manual: true })));
			return;
		case "repost":
			await this.manage(interaction, (guildId, session) => repostRetroSession(retroContext(this.client), guildId, session.id));
			return;
		case "summary":
			await this.manage(interaction, (guildId, session) => repostRetroSummary(retroContext(this.client), guildId, session.id));
			return;
		default:
			throw new Error(`Subcommand không được hỗ trợ: ${subcommand}`);
		}
	}

	/** Nút "📝 Điền retro": kiểm tra đúng kênh của phiên, phiên còn mở và role team, rồi mở form 5 ô điền sẵn câu trả lời cũ. */
	override async executeButton(interaction: ButtonInteraction): Promise<void>
	{
		const { action, sessionId } = parseRetroComponentId(interaction.customId);
		if (action !== "fill") throw new UserError(INVALID_RETRO_COMPONENT);
		const guildId = requireGuildId(interaction);
		const { retro } = this.client.services;
		const session = retro.get(guildId, sessionId);
		if (!session) throw new UserError(RETRO_NOT_FOUND);
		if (interaction.channelId !== session.channelId) throw new UserError(RETRO_WRONG_CHANNEL);
		if (!session.acceptingAnswers) throw new UserError(RETRO_NOT_ACCEPTING);
		if (session.teamRoleId !== null && !roleIdsOf(interaction.member).includes(session.teamRoleId))
		{
			throw new UserError(`Phiên retro này chỉ dành cho thành viên team <@&${session.teamRoleId}>.`);
		}
		await interaction.showModal(retroModal(session, retro.getAnswers(guildId, sessionId, interaction.user.id)));
	}

	/**
	 * Form 5 ô: chỉ nhận trong đúng kênh/thread của phiên; lưu phiếu (RetroService kiểm tra lại mọi điều kiện), trả lời riêng, cập nhật
	 * số người trên tin của phiên. Phiếu đã lưu thì không báo lỗi chỉ vì không cập nhật được tin của phiên (thread lưu trữ, tin bị xoá).
	 */
	override async executeModal(interaction: ModalSubmitInteraction): Promise<void>
	{
		const { action, sessionId } = parseRetroComponentId(interaction.customId);
		if (action !== "form") throw new UserError(INVALID_RETRO_COMPONENT);
		const guildId = requireGuildId(interaction);
		const target = this.client.services.retro.get(guildId, sessionId);
		if (!target) throw new UserError(RETRO_NOT_FOUND);
		if (interaction.channelId !== target.channelId) throw new UserError(RETRO_WRONG_CHANNEL);
		const answers: RetroAnswersInput = {
			learned: readInput(interaction, RETRO_INPUT_IDS.learned),
			improve: readInput(interaction, RETRO_INPUT_IDS.improve),
			ideas: readInput(interaction, RETRO_INPUT_IDS.ideas),
			kudos: readInput(interaction, RETRO_INPUT_IDS.kudos),
			sprintName: readInput(interaction, RETRO_INPUT_IDS.sprintName),
		};
		const result = this.client.services.retro.submit({
			guildId,
			sessionId,
			userId: interaction.user.id,
			roleIds: roleIdsOf(interaction.member),
			answers,
			systemActorId: botActorId(this.client),
		});
		const text = retroSavedText(result.firstSubmit, result.xpAwarded);

		if (interaction.isFromMessage() && interaction.message.id === result.session.messageId)
		{
			try
			{
				await interaction.update(retroSessionMessage(result.session));
				await interaction.followUp({ content: text, flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS })
					.catch((error: unknown) => logger.warn(`Không gửi được xác nhận đã lưu phiếu của phiên retro #${sessionId}:`, error));
				return;
			}
			catch (error)
			{
				logger.warn(`Không cập nhật được tin của phiên retro #${sessionId} khi lưu phiếu (phiếu vẫn đã lưu):`, error);
			}
		}
		try
		{
			await interaction.reply({ content: text, flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS });
		}
		catch (error)
		{
			logger.warn(`Không gửi được xác nhận đã lưu phiếu của phiên retro #${sessionId} (phiếu vẫn đã lưu):`, error);
		}
		const note = sessionMessageNote(await this.client.retroActions.refreshSessionMessage(this.client, result.session));
		if (note !== null) logger.warn(`Phiên retro #${sessionId}: ${note}`);
	}

	/**
	 * Gợi ý tên cho `/retro pick`: các tên chọn được của phiên, chỉ cho người quản lý. Người quản lý không phải admin bot chỉ được gợi ý
	 * khi đang gõ ngay trong kênh của phiên (chắc chắn xem được kênh đó), để không dò được tên của phiên ở kênh mình không xem được.
	 */
	override autocomplete(interaction: AutocompleteInteraction): string[]
	{
		if (!interaction.inGuild()) return [];
		const session = this.findSession(interaction, interaction.guildId, interaction.options.getInteger("id"));
		if (!session || !this.canManage(interaction, session)) return [];
		if (session.channelId !== interaction.channelId && !checkAdmin(interaction, this.client.services)) return [];
		const needle = interaction.options.getFocused().toLocaleLowerCase("vi");
		return this.client.services.retro.pickableNames(session.guildId, session.id).filter(name => name.toLocaleLowerCase("vi").includes(needle));
	}

	private access(interaction: Interaction): RetroAccess
	{
		return { userId: interaction.user.id, ...memberAccess(interaction) };
	}

	private canManage(interaction: Interaction, session: RetroSession): boolean
	{
		const { guildConfig, retro } = this.client.services;
		return canManageRetro(this.access(interaction), guildConfig.getSettings(session.guildId), retro.getConfig(session.guildId), session);
	}

	/** Phiên theo `id`, hoặc phiên mới nhất của kênh/thread đang gõ lệnh; null nếu không có. */
	private findSession(interaction: Interaction, guildId: string, id: number | null): RetroSession | null
	{
		const { retro } = this.client.services;
		if (id !== null) return retro.get(guildId, id);
		return interaction.channelId === null ? null : retro.latestInChannel(guildId, interaction.channelId);
	}

	/**
	 * Phiên theo `id` (hoặc phiên mới nhất của kênh đang gõ) mà người gọi được biết tới: admin bot thấy mọi phiên; người khác chỉ thấy
	 * phiên ở kênh/thread mình xem được (canViewChannel, như trang web giấu phiên bí mật). Không thấy thì báo "không tìm thấy" y như phiên
	 * không tồn tại, để không lộ tiêu đề, tên sprint, hay việc phiên có tồn tại.
	 */
	private async requireVisibleSession(interaction: ChatInputCommandInteraction, guildId: string): Promise<RetroSession>
	{
		const id = interaction.options.getInteger("id");
		const session = this.findSession(interaction, guildId, id);
		const visible = session !== null
			&& (checkAdmin(interaction, this.client.services) || await canViewChannel(this.client, interaction, session.channelId));
		if (!session || !visible) throw new UserError(id === null ? NO_SESSION_HERE : `Không tìm thấy phiên retro #${id}.`);
		return session;
	}

	/**
	 * Subcommand quản lý: trả lời riêng (defer trước vì có thể gọi Discord và Confluence); phiên phải thấy được (requireVisibleSession) và
	 * người gọi phải là người quản lý phiên.
	 */
	private async manage(interaction: ChatInputCommandInteraction, run: (guildId: string, session: RetroSession) => Promise<string>): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const session = await this.requireVisibleSession(interaction, guildId);
		if (!this.canManage(interaction, session)) throw new UserError(RETRO_NOT_MANAGER);
		const text = await run(guildId, session);
		await interaction.editReply({ content: text, allowedMentions: NO_MENTIONS });
	}

	/**
	 * Bot dùng được kênh/thread đang gõ lệnh để làm phiên retro không (quyền theo interaction.appPermissions; thread riêng tư thì bot phải
	 * là thành viên). Kênh không có trong cache mà cũng không lấy được thì bot không xem được kênh.
	 */
	private async assertBotCanUseHere(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const channel = interaction.channel ?? await this.fetchTextChannel(interaction.channelId);
		if (!channel) throw new UserError(RETRO_BOT_CANNOT_SEE);
		const botId = botActorId(this.client);
		await assertBotCanUseRetroChannel(channel, interaction.appPermissions, async () =>
		{
			if (!channel.isThread()) return true;
			try
			{
				await channel.members.fetch({ member: botId });
				return true;
			}
			catch
			{
				return false;
			}
		});
	}

	private async fetchTextChannel(channelId: string): Promise<TextBasedChannel | null>
	{
		try
		{
			const channel = await this.client.channels.fetch(channelId);
			return channel?.isTextBased() ? channel : null;
		}
		catch
		{
			return null;
		}
	}

	private async create(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const { services } = this.client;
		if (!canCreateRetro(this.access(interaction), services.guildConfig.getSettings(guildId), services.retro.getConfig(guildId)))
		{
			throw new UserError(RETRO_CREATE_DENIED);
		}
		// Tin của phiên được đăng công khai thay người tạo: phải có quyền gửi tin ở kênh này; bot cũng phải đăng, sửa tin và gửi vote ở đây.
		assertCanSendMessages(interaction);
		await this.assertBotCanUseHere(interaction);

		const { session, notes } = await createRetroSession(retroContext(this.client), {
			guildId,
			channelId: interaction.channelId,
			title: interaction.options.getString("ten", true),
			docUrl: interaction.options.getString("link"),
			teamRoleId: interaction.options.getRole("team")?.id ?? null,
			durationHours: interaction.options.getInteger("han-gio"),
			createdBy: interaction.user.id,
		}, async payload =>
		{
			const response = await interaction.reply({ ...payload, withResponse: true });
			return response.resource?.message?.id ?? null;
		});

		for (const note of notes)
		{
			await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS })
				.catch((error: unknown) => logger.warn(`Không gửi được ghi chú cho người tạo phiên retro #${session.id}:`, error));
		}
	}

	/**
	 * Tình trạng phiên (trả lời riêng). Người quản lý thấy thêm tình trạng Confluence; danh sách người đã điền chỉ admin bot thấy
	 * (DEC-049: ghi tên lại cho admin theo dõi), người quản lý khác chỉ thấy số người. Phiên ở kênh người gọi không xem được thì "không
	 * tìm thấy" (trừ admin bot).
	 */
	private async status(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const session = await this.requireVisibleSession(interaction, guildId);
		const manager = this.canManage(interaction, session);
		const participants = checkAdmin(interaction, this.client.services) ? this.client.services.retro.participants(guildId, session.id) : null;
		const content = retroStatusText(session, { manager, participants }, this.client.retroActions.docWriter !== null);
		await interaction.editReply({ content, allowedMentions: NO_MENTIONS });
	}
}

/** Option `id` (tuỳ chọn) chung của các subcommand quản lý. */
function idOption(option: SlashCommandIntegerOption): SlashCommandIntegerOption
{
	return option.setName("id").setDescription("Mã phiên retro (bỏ trống: phiên mới nhất của kênh/thread này)").setMinValue(1);
}

/** Giá trị một ô của form; ô không có trong form (form cũ) coi như để trống. */
function readInput(interaction: ModalSubmitInteraction, customId: string): string
{
	try
	{
		return interaction.fields.getTextInputValue(customId);
	}
	catch
	{
		return "";
	}
}

/** Tách option `rut-gon` theo dấu `|`; bỏ trống thì undefined (dùng toàn bộ tên). */
export function parseShortlist(raw: string | null): string[] | undefined
{
	if (raw === null) return undefined;
	const names = raw.split("|").map(name => name.trim()).filter(name => name.length > 0);
	return names.length > 0 ? names : undefined;
}
