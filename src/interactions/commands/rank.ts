import {
	APIInteractionDataResolvedGuildMember,
	APIInteractionGuildMember,
	AttachmentBuilder,
	ButtonInteraction,
	ChatInputCommandInteraction,
	GuildMember,
	ImageURLOptions,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
	User,
} from "discord.js";
import Command from "../../classes/Command";
import { buildRankCardData, mustReplyPrivately, RankCardInput, rankSummaryText } from "../../discord/cardData";
import { renderRankCard } from "../../discord/cards/rankCard";
import { RankCardData, RenderedCard } from "../../discord/cards/types";
import { requireGuildId } from "../../discord/guards";
import { roleIdsOf } from "../../discord/members";
import { rankEmbed } from "../../discord/views/activity";
import { parseRankHelpId, RANK_HELP_NAMESPACE, rankCardReply, rankFallbackComponents, rankHelpReply } from "../../discord/views/rank";
import { UserError } from "../../shared/errors";
import { logger } from "../../shared/logger";

const TARGET_OPTION = "thanh-vien";
const CARD_AVATAR: ImageURLOptions = { extension: "png", size: 256, forceStatic: true };

type AnyMember = GuildMember | APIInteractionGuildMember | APIInteractionDataResolvedGuildMember | null;

// Thẻ rank của một thành viên dạng ảnh (DEC-030): level, bậc danh hiệu theo bộ hiển thị của người được xem (bộ tự chọn nếu
// server cho phép, không thì bộ guild đang dùng; DEC-033, DEC-047), Activity XP, Contribution, chuỗi ngày, huy hiệu, team. Bộ
// danh hiệu đi theo hồ sơ gamification nên ảnh và phần chữ luôn cùng bộ. Hai loại điểm hiển thị tách biệt (DEC-004).
// Phản hồi là khung Components V2 có nút "❓" ở góc trên bên phải (DEC-047); bấm nút thì người bấm nhận riêng lời giải thích.
// Vẽ ảnh lỗi thì trả embed cũ kèm nút "❓".
export default class RankCmd extends Command
{
	data = new SlashCommandBuilder()
		.setName("rank")
		.setDescription("Xem thẻ rank (level, danh hiệu, điểm, huy hiệu) của bạn hoặc một thành viên")
		.addUserOption(option => option
			.setName(TARGET_OPTION)
			.setDescription("Thành viên cần xem (mặc định là bạn)"));

	override buttonIds = [RANK_HELP_NAMESPACE];

	// Hàm vẽ ảnh thẻ; test thay bằng hàm giả để kiểm tra dữ liệu và nhánh dự phòng.
	renderCard: (data: RankCardData) => Promise<RenderedCard> = renderRankCard;

	async execute(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const chosen = interaction.options.getUser(TARGET_OPTION);
		const target = chosen ?? interaction.user;
		if (target.bot) throw new UserError("Bot không có điểm.");

		// Người được chọn có thể đã rời server: không có member thì coi như không thuộc team nào.
		const member = chosen ? interaction.options.getMember(TARGET_OPTION) : interaction.member;

		// Cooldown kiểm tra trước khi defer: bị chặn thì dispatcher trả lời riêng ngay (UserError).
		this.client.renderGate.assertCooldown(interaction.user.id);
		// Tải avatar và vẽ ảnh có thể mất vài giây, nên defer trước.
		await interaction.deferReply(mustReplyPrivately(interaction) ? { flags: MessageFlags.Ephemeral } : undefined);

		const { activity, contributions, gamification, teams } = this.client.services;
		const teamRoleIds = teams.resolveTeams(guildId, roleIdsOf(member));
		const input: Omit<RankCardInput, "avatar"> = {
			displayName: displayNameOf(target, member),
			activity: activity.getProfile(guildId, target.id),
			contribution: contributions.getProfile(guildId, target.id),
			gamification: gamification.profile(guildId, target.id),
			teamNames: teamRoleIds.flatMap(roleId =>
			{
				const role = interaction.guild?.roles.cache.get(roleId);
				return role ? [role.name] : [];
			}),
		};
		const content = rankSummaryText(input.gamification);

		const card = await this.tryRender(input, cardAvatarUrlOf(target, member));
		if (card)
		{
			await interaction.editReply({
				...rankCardReply({ displayName: input.displayName, summary: content, fileName: card.fileName, accentColor: input.gamification.tier.color }),
				files: [new AttachmentBuilder(card.png, { name: card.fileName })],
			});
			return;
		}

		await interaction.editReply({
			content,
			embeds: [rankEmbed({
				displayName: input.displayName,
				avatarUrl: avatarUrlOf(target, member),
				activity: input.activity,
				contribution: input.contribution,
				teamRoleIds,
			})],
			components: rankFallbackComponents(),
		});
	}

	/**
	 * Nút "❓" trên thẻ: ai bấm cũng được (kể cả không phải chủ thẻ), người bấm nhận riêng lời giải thích dựng từ cấu hình hiện tại
	 * của server và bộ danh hiệu hiển thị của chính người bấm. Chỉ đọc cấu hình, không ghi gì, không vẽ ảnh nên không cần cooldown.
	 */
	override async executeButton(interaction: ButtonInteraction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		parseRankHelpId(interaction.customId);
		const { guildConfig, tierSets } = this.client.services;
		const guild = interaction.guild;
		const member = interaction.member instanceof GuildMember ? interaction.member : null;
		// Chỉ nêu kênh người bấm xem được (LL-013, review Phase 18): kênh riêng tư không lộ ID hay số lượng. Không có cache của guild
		// hoặc của người bấm thì không nêu kênh nào.
		const channels = guildConfig.listChannels(guildId).filter(channel =>
		{
			const found = guild?.channels.cache.get(channel.channelId);
			return found !== undefined && member !== null && (found.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel) ?? false);
		});
		await interaction.reply(rankHelpReply({
			settings: guildConfig.getSettings(guildId),
			channels,
			display: tierSets.displayFor(guildId, interaction.user.id),
		}));
	}

	/**
	 * Ảnh thẻ, hoặc null nếu vẽ lỗi (đã ghi log; người dùng nhận embed thay thế). Tải avatar ở ngoài semaphore để
	 * lần chờ mạng không giữ chỗ vẽ; chỉ phần vẽ đi qua semaphore toàn process.
	 */
	private async tryRender(input: Omit<RankCardInput, "avatar">, avatarUrl: string): Promise<RenderedCard | null>
	{
		try
		{
			const avatar = await this.client.avatars.get(avatarUrl);
			const data = buildRankCardData({ ...input, avatar });
			return await this.client.renderGate.run(() => this.renderCard(data));
		}
		catch (error)
		{
			logger.error("Không vẽ được ảnh thẻ /rank, trả về embed thay thế:", error);
			return null;
		}
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

function cardAvatarUrlOf(user: User, member: AnyMember): string
{
	return member instanceof GuildMember ? member.displayAvatarURL(CARD_AVATAR) : user.displayAvatarURL(CARD_AVATAR);
}
