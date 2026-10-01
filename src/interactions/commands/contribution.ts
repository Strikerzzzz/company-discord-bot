import { ButtonInteraction, ChatInputCommandInteraction, MessageFlags, MessageMentionOptions, ModalSubmitInteraction, SlashCommandBuilder } from "discord.js";
import Command from "../../classes/Command";
import type DiscordClient from "../../classes/DiscordClient";
import { DEFAULT_ADMIN_ACTIONS } from "../../discord/adminOps";
import { approveContribution, ContributionReviewActions, rejectContribution } from "../../discord/contributionOps";
import { canViewChannel, checkCanReviewContributions, filterViewable, requireGuildId } from "../../discord/guards";
import { roleIdsOf } from "../../discord/members";
import { postContributionCard, refreshContributionMessage, requireContributionCardChannel } from "../../discord/messages";
import {
	CONTRIBUTION_BUTTON_NAMESPACE,
	CONTRIBUTION_LIST_LIMIT,
	CONTRIBUTION_REASON_INPUT,
	contributionDetailMessage,
	contributionListEmbed,
	contributionMessage,
	contributionSubmittedText,
	downvoteReasonModal,
	INVALID_CONTRIBUTION_COMPONENT,
	parseCategory,
	parseContributionComponentId,
	rejectReasonModal,
	reviewClosedText,
	voteFeedback,
} from "../../discord/views/contribution";
import { Contribution, CONTRIBUTION_CATEGORIES, CONTRIBUTION_LIMITS, ContributionVoteAction, ContributionVoteResult } from "../../modules/contribution/types";
import { UserError } from "../../shared/errors";
import { logger } from "../../shared/logger";

/** Số contribution lấy từ service cho /contribution list trước khi lọc theo quyền xem kênh (service giới hạn 50). */
const LIST_FETCH_LIMIT = 50;
const NO_MENTIONS: MessageMentionOptions = { parse: [] };

export const REVIEW_DENIED = "Chỉ admin bot hoặc người có role duyệt contribution mới duyệt hoặc từ chối được đóng góp.";

/**
 * Gửi, xem, duyệt và ghi nhận Contribution (DEC-025, DEC-051). Thành viên gửi từ đâu cũng được, bot đăng thẻ ở kênh contribution
 * admin đã chọn; thẻ mới ở trạng thái chờ duyệt (nút ✅ Duyệt, ❌ Từ chối, chỉ người duyệt bấm được, kiểm tra quyền trong code mỗi lần
 * bấm), duyệt xong mới có nút 👍 Ghi nhận và 👎 Không ghi nhận. Lý do từ chối, lý do 👎 và tên người bấm không hiện công khai.
 */
export default class ContributionCmd extends Command
{
	override buttonIds = [CONTRIBUTION_BUTTON_NAMESPACE];
	/** Sửa thẻ và nhắn riêng kết quả duyệt (contributionOps); test thay bằng hàm giả. */
	reviewActions: ContributionReviewActions = DEFAULT_ADMIN_ACTIONS;

	data = new SlashCommandBuilder()
		.setName("contribution")
		.setDescription("Gửi và xem đóng góp để được duyệt và ghi nhận")
		.addSubcommand(sub => sub
			.setName("submit")
			.setDescription("Gửi một đóng góp của bạn: bot đăng vào kênh contribution, chờ duyệt rồi mọi người ghi nhận")
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

	/** Nút trên thẻ công khai: 👍, 👎, ✅ Duyệt, ❌ Từ chối (xem ContributionComponentAction). */
	override async executeButton(interaction: ButtonInteraction): Promise<void>
	{
		const { action, contributionId } = parseContributionComponentId(interaction.customId);
		const guildId = requireGuildId(interaction);
		switch (action)
		{
		case "up":
			await this.upvote(interaction, guildId, contributionId);
			return;
		case "down":
			await this.downvote(interaction, guildId, contributionId);
			return;
		case "approve":
			await this.approve(interaction, guildId, contributionId);
			return;
		case "reject":
			await this.openReject(interaction, guildId, contributionId);
			return;
		default:
			throw new UserError(INVALID_CONTRIBUTION_COMPONENT);
		}
	}

	/** Form lý do mở từ nút của thẻ: lý do từ chối hoặc lý do 👎. */
	override async executeModal(interaction: ModalSubmitInteraction): Promise<void>
	{
		const { action, contributionId } = parseContributionComponentId(interaction.customId);
		const guildId = requireGuildId(interaction);
		if (action === "rejectform") await this.submitReject(interaction, guildId, contributionId);
		else if (action === "downform") await this.submitDownvote(interaction, guildId, contributionId);
		else throw new UserError(INVALID_CONTRIBUTION_COMPONENT);
	}

	// ---------- 👍 / 👎 (DEC-051) ----------

	/** 👍: đang 👍 thì rút, còn lại (chưa bấm hoặc đang 👎) thì chọn 👍. */
	private async upvote(interaction: ButtonInteraction, guildId: string, contributionId: number): Promise<void>
	{
		const state = this.client.services.contributions.voterState(guildId, contributionId, interaction.user.id);
		const result = this.vote(interaction, guildId, contributionId, state.current === "up" ? "withdraw" : "up", null);
		await this.showVoteResult(interaction, guildId, result);
	}

	/** 👎: đang 👎 thì rút (không cần lý do); còn lại mở form lý do sau khi chắc chắn người này còn chọn được 👎. */
	private async downvote(interaction: ButtonInteraction, guildId: string, contributionId: number): Promise<void>
	{
		const state = this.client.services.contributions.voterState(guildId, contributionId, interaction.user.id);
		if (state.current === "down")
		{
			await this.showVoteResult(interaction, guildId, this.vote(interaction, guildId, contributionId, "withdraw", null));
			return;
		}
		// Thao tác không đổi gì (giữ đúng lượt đang có): service kiểm tra mọi điều kiện (contribution còn hiệu lực, đã duyệt, người bấm
		// không phải tác giả, lượt không bị khoá) và ném đúng UserError mà không ghi gì, để không bắt nhập lý do rồi mới báo lỗi.
		this.vote(interaction, guildId, contributionId, state.current ?? "withdraw", null);
		await interaction.showModal(downvoteReasonModal(contributionId));
	}

	/** Form lý do 👎: service kiểm tra lại mọi điều kiện (trạng thái có thể đã đổi trong lúc form mở). */
	private async submitDownvote(interaction: ModalSubmitInteraction, guildId: string, contributionId: number): Promise<void>
	{
		const result = this.vote(interaction, guildId, contributionId, "down", readReason(interaction));
		await this.showVoteResult(interaction, guildId, result);
	}

	private vote(
		interaction: ButtonInteraction | ModalSubmitInteraction,
		guildId: string,
		contributionId: number,
		action: ContributionVoteAction,
		reason: string | null,
	): ContributionVoteResult
	{
		return this.client.services.contributions.vote({
			guildId,
			contributionId,
			voterId: interaction.user.id,
			action,
			reason,
			voterRoleIds: roleIdsOf(interaction.member),
			systemActorId: this.botId(),
		});
	}

	/** ID của bot: người thao tác của event XP người bấm (DEC-051, như XP retro). Lỗi hệ thống nếu bot chưa đăng nhập. */
	private botId(): string
	{
		const id = this.client.user?.id ?? null;
		if (id === null) throw new Error("Bot chưa đăng nhập Discord nên chưa có ID để ghi XP cho người bấm.");
		return id;
	}

	/**
	 * Sửa thẻ vừa bấm theo số lượt mới rồi trả lời riêng (kết quả, XP). Không nhắn gì cho tác giả theo từng lượt (DEC-051). Form không
	 * gắn với thẻ (hiếm) thì trả lời riêng rồi sửa thẻ qua vị trí đã lưu. Lượt đã lưu thì không báo lỗi chỉ vì không gửi được phản hồi.
	 */
	private async showVoteResult(interaction: ButtonInteraction | ModalSubmitInteraction, guildId: string, result: ContributionVoteResult): Promise<void>
	{
		const content = voteFeedback(result, this.client.services.guildConfig.getSettings(guildId).contributionInteractionXpDailyCap);
		const card = contributionMessage(result.contribution);
		if (interaction.isButton() || interaction.isFromMessage())
		{
			await interaction.update(card);
			await interaction.followUp({ content, flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS })
				.catch((error: unknown) => logger.warn(`Không gửi được phản hồi lượt bấm contribution #${result.contribution.id}:`, error));
			return;
		}
		await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS });
		await refreshContributionMessage(this.client, result.contribution);
	}

	// ---------- Duyệt / từ chối (DEC-051) ----------

	/** Quyền duyệt kiểm tra trong code mỗi lần bấm hay gửi form (role có thể vừa bị gỡ). */
	private assertCanReview(interaction: ButtonInteraction | ModalSubmitInteraction): void
	{
		if (!checkCanReviewContributions(interaction, this.client.services)) throw new UserError(REVIEW_DENIED);
	}

	/**
	 * Contribution còn chờ duyệt thì trả về để duyệt/từ chối. Thẻ đã cũ (đã được duyệt, bị từ chối hoặc bị gỡ ở nơi khác) thì vẽ lại thẻ
	 * theo trạng thái hiện tại, báo riêng và trả về null.
	 */
	private async pendingOrRedraw(interaction: ButtonInteraction, guildId: string, contributionId: number): Promise<Contribution | null>
	{
		const contribution = this.client.services.contributions.get(guildId, contributionId);
		if (!contribution) throw new UserError(`Không tìm thấy đóng góp #${contributionId}.`);
		if (contribution.status === "active" && contribution.reviewState === "pending") return contribution;
		await interaction.update(contributionMessage(contribution));
		await interaction.followUp({ content: reviewClosedText(contribution), flags: MessageFlags.Ephemeral });
		return null;
	}

	/** ✅ Duyệt: sửa thẻ (mở nút 👍/👎) và nhắn riêng cho tác giả qua contributionOps (dùng chung với web), rồi báo riêng kết quả. */
	private async approve(interaction: ButtonInteraction, guildId: string, contributionId: number): Promise<void>
	{
		this.assertCanReview(interaction);
		if (await this.pendingOrRedraw(interaction, guildId, contributionId) === null) return;
		// Sửa thẻ và nhắn riêng có thể mất vài giây.
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const outcome = await approveContribution(this.client, this.client.services, this.reviewActions, guildId, contributionId, interaction.user.id);
		await interaction.editReply({ content: outcome.text, allowedMentions: NO_MENTIONS });
	}

	/** ❌ Từ chối: mở form nhập lý do. */
	private async openReject(interaction: ButtonInteraction, guildId: string, contributionId: number): Promise<void>
	{
		this.assertCanReview(interaction);
		if (await this.pendingOrRedraw(interaction, guildId, contributionId) === null) return;
		await interaction.showModal(rejectReasonModal(contributionId));
	}

	/**
	 * Form lý do từ chối: kiểm tra lại quyền; service kiểm tra lý do và trạng thái (UserError nếu contribution đã được duyệt, bị từ chối
	 * hay bị gỡ trong lúc form mở). Lý do chỉ gửi riêng cho tác giả, không hiện trên thẻ.
	 */
	private async submitReject(interaction: ModalSubmitInteraction, guildId: string, contributionId: number): Promise<void>
	{
		this.assertCanReview(interaction);
		const reason = readReason(interaction);
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const outcome = await rejectContribution(this.client, this.client.services, this.reviewActions, guildId, contributionId, interaction.user.id, reason);
		await interaction.editReply({ content: outcome.text, allowedMentions: NO_MENTIONS });
	}

	// ---------- Subcommand ----------

	/**
	 * Gửi từ bất kỳ kênh nào (DEC-051): kiểm tra kênh contribution (requireContributionCardChannel) trước khi tạo bản ghi chờ duyệt,
	 * đăng thẻ ở kênh đó, rồi trả lời riêng kèm link.
	 */
	private async submit(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const category = parseCategory(interaction.options.getString("loai", true));
		// Lấy kênh và đăng thẻ là gọi REST: defer trước để không quá hạn 3 giây.
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const channel = await requireContributionCardChannel(this.client, interaction);

		const { services } = this.client;
		const contribution = services.contributions.submit({
			guildId,
			authorId: interaction.user.id,
			submittedBy: interaction.user.id,
			title: interaction.options.getString("tieu-de", true),
			description: interaction.options.getString("noi-dung", true),
			category,
			link: interaction.options.getString("link"),
			authorRoleIds: roleIdsOf(interaction.member),
		});
		const posted = await postContributionCard(services, channel, contribution);
		await interaction.editReply({ content: contributionSubmittedText(posted ?? contribution, channel.id, posted !== null), allowedMentions: NO_MENTIONS });
	}

	/**
	 * Bản xem riêng, không có nút thao tác. Người không xem được kênh của thẻ nhận "không tìm thấy" như với mã không tồn tại. Người duyệt
	 * và admin thấy thêm người duyệt, danh sách lượt 👍/👎 kèm tên và lý do; lý do từ chối chỉ hiện cho tác giả, người gửi, người duyệt
	 * và admin (DEC-051).
	 */
	private async view(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const contributionId = interaction.options.getInteger("id", true);
		// Kiểm tra quyền xem kênh có thể cần gọi REST: defer trước để không quá hạn 3 giây.
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const { contributions } = this.client.services;
		const contribution = contributions.get(guildId, contributionId);
		const reviewer = checkCanReviewContributions(interaction, this.client.services);
		if (!contribution || !(await canSeeContribution(this.client, interaction, contribution, reviewer)))
		{
			throw new UserError(`Không tìm thấy đóng góp #${contributionId}.`);
		}

		const involved = isInvolved(contribution, interaction.user.id);
		const detail = contributionDetailMessage(contribution, {
			showReviewReason: reviewer || involved,
			voters: reviewer ? contributions.listVoters(guildId, contributionId) : null,
		});
		await interaction.editReply({ ...detail, allowedMentions: NO_MENTIONS });
	}

	/** Chỉ liệt kê đóng góp thuộc kênh người gọi xem được. */
	private async list(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const member = interaction.options.getUser("thanh-vien");
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const reviewer = checkCanReviewContributions(interaction, this.client.services);
		const recent = this.client.services.contributions.list(guildId, { authorId: member?.id, limit: LIST_FETCH_LIMIT })
			.filter(contribution => contribution.channelId !== null || reviewer || isInvolved(contribution, interaction.user.id));
		const visible = (await filterViewable(this.client, interaction, recent)).slice(0, CONTRIBUTION_LIST_LIMIT);

		await interaction.editReply({ embeds: [contributionListEmbed(visible, member?.id ?? null)] });
	}
}

/** Người dùng là tác giả hoặc người gửi contribution. */
function isInvolved(contribution: Contribution, userId: string): boolean
{
	return userId === contribution.authorId || userId === contribution.submittedBy;
}

/**
 * Người gọi xem được contribution: theo quyền xem kênh của thẻ; contribution chưa có thẻ (đăng lỗi lúc gửi, chưa biết kênh) thì chỉ
 * tác giả, người gửi, người duyệt và admin (review bảo mật Phase 20).
 */
async function canSeeContribution(client: DiscordClient, interaction: ChatInputCommandInteraction, contribution: Contribution, reviewer: boolean): Promise<boolean>
{
	if (contribution.channelId === null) return reviewer || isInvolved(contribution, interaction.user.id);
	return canViewChannel(client, interaction, contribution.channelId);
}

/** Lý do trong form (ô CONTRIBUTION_REASON_INPUT); không có ô đó (form lạ) thì coi như trống để service báo lỗi độ dài. */
function readReason(interaction: ModalSubmitInteraction): string
{
	try
	{
		return interaction.fields.getTextInputValue(CONTRIBUTION_REASON_INPUT);
	}
	catch
	{
		return "";
	}
}
