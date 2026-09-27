import {
	APIInteractionDataResolvedGuildMember,
	APIInteractionGuildMember,
	AttachmentBuilder,
	ChatInputCommandInteraction,
	GuildMember,
	ImageURLOptions,
	MessageFlags,
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
import { UserError } from "../../shared/errors";
import { logger } from "../../shared/logger";

const TARGET_OPTION = "thanh-vien";
const CARD_AVATAR: ImageURLOptions = { extension: "png", size: 256, forceStatic: true };

type AnyMember = GuildMember | APIInteractionGuildMember | APIInteractionDataResolvedGuildMember | null;

// Thẻ rank của một thành viên dạng ảnh (DEC-030): level, bậc danh hiệu theo bộ guild đang dùng (DEC-033), Activity XP,
// Contribution, chuỗi ngày, huy hiệu, team. Bộ danh hiệu đi theo hồ sơ gamification nên ảnh và phần chữ luôn cùng bộ.
// Hai loại điểm hiển thị tách biệt (DEC-004). Vẽ ảnh lỗi thì trả embed cũ.
export default class RankCmd extends Command
{
	data = new SlashCommandBuilder()
		.setName("rank")
		.setDescription("Xem thẻ rank (level, danh hiệu, điểm, huy hiệu) của bạn hoặc một thành viên")
		.addUserOption(option => option
			.setName(TARGET_OPTION)
			.setDescription("Thành viên cần xem (mặc định là bạn)"));

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
			await interaction.editReply({ content, files: [new AttachmentBuilder(card.png, { name: card.fileName })] });
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
		});
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
