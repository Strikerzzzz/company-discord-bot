import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";
import Command from "../../classes/Command";
import { requireGuildId } from "../../discord/guards";
import { RANK_STYLE_SERVER_CHOICE, rankStyleChoices, rankStyleResultText } from "../../discord/views/rank";
import { isTierSetKey, TierSetKey } from "../../modules/activity/tiers";
import { INVALID_TIER_SET_KEY } from "../../modules/gamification/TierSetService";
import { UserError } from "../../shared/errors";

export const RANK_STYLE_OPTION = "bo";

/** Giá trị option `bo`: null = theo server; UserError nếu không phải lựa chọn đã khai báo. */
export function parseRankStyleChoice(value: string): TierSetKey | null
{
	if (value === RANK_STYLE_SERVER_CHOICE) return null;
	if (isTierSetKey(value)) return value;
	throw new UserError(INVALID_TIER_SET_KEY);
}

// Thành viên tự chọn bộ danh hiệu hiển thị cho chính mình (DEC-047): chỉ đổi thẻ /rank (ai xem thẻ của người đó cũng thấy theo
// bộ này) và lời chúc lên level/lên bậc của người đó. Role Discord, bảng xếp hạng và Bảng vàng vẫn theo bộ chung của server.
// Admin tắt tự chọn (trang Danh hiệu của web quản trị) thì chọn bộ bị từ chối; về "theo server" thì luôn được. Trả lời riêng.
export default class RankStyleCmd extends Command
{
	data = new SlashCommandBuilder()
		.setName("rank-style")
		.setDescription("Chọn bộ danh hiệu hiển thị trên thẻ /rank và lời chúc lên level của riêng bạn")
		.addStringOption(option => option
			.setName(RANK_STYLE_OPTION)
			.setDescription("Bộ danh hiệu cho riêng bạn; role và bảng xếp hạng vẫn theo bộ của server")
			.setRequired(true)
			.addChoices(...rankStyleChoices()));

	async execute(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const setKey = parseRankStyleChoice(interaction.options.getString(RANK_STYLE_OPTION, true));
		const display = this.client.services.tierSets.chooseForMember(guildId, interaction.user.id, setKey);
		await interaction.reply({ content: rankStyleResultText(display), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
	}
}
