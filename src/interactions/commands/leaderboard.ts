import {
	ActionRowBuilder,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonInteraction,
	ButtonStyle,
	ChatInputCommandInteraction,
	Guild,
	InteractionEditReplyOptions,
	MessageFlags,
	SlashCommandBuilder,
} from "discord.js";
import Command from "../../classes/Command";
import { CARD_PAGE_SIZE, loadLeaderboardCard, mustReplyPrivately } from "../../discord/cardData";
import { renderLeaderboardCard } from "../../discord/cards/leaderboardCard";
import { LeaderboardCardData, RenderedCard } from "../../discord/cards/types";
import { formatNumber } from "../../discord/format";
import { requireGuildId } from "../../discord/guards";
import { LeaderboardScope, leaderboardEmbed } from "../../discord/views/activity";
import { LeaderboardPeriod, ScoreKind } from "../../modules/leaderboard/LeaderboardService";
import { UserError } from "../../shared/errors";
import { logger } from "../../shared/logger";

const KIND_OPTION = "loai";
const SCOPE_OPTION = "pham-vi";
const PERIOD_OPTION = "ky";
const PAGE_OPTION = "trang";

export const BOARD_NAMESPACE = "lb";
export const INVALID_BOARD_BUTTON = "Nút này không hợp lệ.";
export const NO_STANDING = "Bạn chưa có điểm trong bảng này.";
const MAX_PAGE = 999_999;

/** Trạng thái một bảng xếp hạng đang hiển thị; `ownerId` là người được xem bảng này (dòng của họ được tô nổi bật). */
export interface BoardState
{
	kind: ScoreKind;
	scope: LeaderboardScope;
	period: LeaderboardPeriod;
	page: number;
	ownerId: string;
}

/** Hành động của một nút: xem một bảng cụ thể, hoặc nhảy tới trang có "hạng của tôi" (luôn là bảng cá nhân). */
export type BoardAction =
	| { type: "view"; state: BoardState }
	| { type: "me"; kind: ScoreKind; period: LeaderboardPeriod; ownerId: string };

const KIND_CODES: Readonly<Record<ScoreKind, string>> = { activity: "a", contribution: "c" };
const SCOPE_CODES: Readonly<Record<LeaderboardScope, string>> = { individual: "i", team: "t" };
const PERIOD_CODES: Readonly<Record<LeaderboardPeriod, string>> = { all: "all", week: "w", month: "m" };

const VIEW_ID = /^lb:v:([ac]):([it]):(all|w|m):(\d{1,6}):(\d{17,20})$/;
const ME_ID = /^lb:me:([ac]):(all|w|m):(\d{17,20})$/;

function clampPage(page: number): number
{
	return Math.min(MAX_PAGE, Math.max(1, Math.floor(page) || 1));
}

function decodeKind(code: string): ScoreKind
{
	return code === "c" ? "contribution" : "activity";
}

function decodePeriod(code: string): LeaderboardPeriod
{
	if (code === "w") return "week";
	if (code === "m") return "month";
	return "all";
}

/** customId của nút xem bảng: `lb:v:<a|c>:<i|t>:<all|w|m>:<page>:<ownerId>`. */
export function boardViewId(state: BoardState): string
{
	const { kind, scope, period, page, ownerId } = state;
	return `${BOARD_NAMESPACE}:v:${KIND_CODES[kind]}:${SCOPE_CODES[scope]}:${PERIOD_CODES[period]}:${clampPage(page)}:${ownerId}`;
}

/** customId của nút "Hạng của tôi": `lb:me:<a|c>:<all|w|m>:<ownerId>`. */
export function boardMeId(kind: ScoreKind, period: LeaderboardPeriod, ownerId: string): string
{
	return `${BOARD_NAMESPACE}:me:${KIND_CODES[kind]}:${PERIOD_CODES[period]}:${ownerId}`;
}

/** Đọc customId của nút bảng xếp hạng. UserError nếu sai định dạng (customId cũ hoặc bị sửa); trang được kẹp về >= 1. */
export function parseBoardId(customId: string): BoardAction
{
	const view = VIEW_ID.exec(customId);
	if (view)
	{
		return {
			type: "view",
			state: {
				kind: decodeKind(view[1]),
				scope: view[2] === "t" ? "team" : "individual",
				period: decodePeriod(view[3]),
				page: clampPage(Number(view[4])),
				ownerId: view[5],
			},
		};
	}
	const me = ME_ID.exec(customId);
	if (me) return { type: "me", kind: decodeKind(me[1]), period: decodePeriod(me[2]), ownerId: me[3] };
	throw new UserError(INVALID_BOARD_BUTTON);
}

/**
 * Nút đang chọn (hoặc không bấm được) có customId riêng `lb:x:<vị trí>`: Discord không cho hai nút trong cùng message
 * trùng customId, mà nút đang chọn nếu mã hoá trạng thái thì sẽ trùng với nút khác (ví dụ "Activity" và "Cá nhân" cùng
 * trỏ về bảng hiện tại). Các nút này bị vô hiệu hoá nên không bao giờ được bấm.
 */
function inactiveId(slot: string): string
{
	return `${BOARD_NAMESPACE}:x:${slot}`;
}

function choiceButton(label: string, emoji: string | null, selected: boolean, slot: string, target: BoardState): ButtonBuilder
{
	const button = new ButtonBuilder()
		.setLabel(label)
		.setStyle(selected ? ButtonStyle.Primary : ButtonStyle.Secondary)
		.setDisabled(selected)
		.setCustomId(selected ? inactiveId(slot) : boardViewId(target));
	return emoji ? button.setEmoji(emoji) : button;
}

function pageButton(label: string, slot: string, target: BoardState | null): ButtonBuilder
{
	return new ButtonBuilder()
		.setLabel(label)
		.setStyle(ButtonStyle.Secondary)
		.setDisabled(target === null)
		.setCustomId(target === null ? inactiveId(slot) : boardViewId(target));
}

/**
 * Ba hàng nút của bảng xếp hạng: loại điểm; phạm vi và kỳ; chuyển trang (kèm "Hạng của tôi" ở bảng cá nhân).
 * Đổi loại, phạm vi hay kỳ thì về trang 1. `state.page` phải là trang thật sự đang hiển thị (đã kẹp).
 */
export function boardComponents(state: BoardState, totalPages: number): ActionRowBuilder<ButtonBuilder>[]
{
	const { kind, scope, period, page, ownerId } = state;
	const first = { ...state, page: 1 };
	const kindRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
		choiceButton("Activity", "⚡", kind === "activity", "kind", { ...first, kind: "activity" }),
		choiceButton("Contribution", "🌟", kind === "contribution", "kind", { ...first, kind: "contribution" }),
	);
	const filterRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
		choiceButton("Cá nhân", "👤", scope === "individual", "scope", { ...first, scope: "individual" }),
		choiceButton("Team", "👥", scope === "team", "scope", { ...first, scope: "team" }),
		choiceButton("Tổng", null, period === "all", "period", { ...first, period: "all" }),
		choiceButton("Tuần", null, period === "week", "period", { ...first, period: "week" }),
		choiceButton("Tháng", null, period === "month", "period", { ...first, period: "month" }),
	);
	const pageRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
		pageButton("◀", "prev", page > 1 ? { ...state, page: page - 1 } : null),
		pageButton(`Trang ${formatNumber(page)}/${formatNumber(totalPages)}`, "page", null),
		pageButton("▶", "next", page < totalPages ? { ...state, page: page + 1 } : null),
	);
	if (scope === "individual")
	{
		pageRow.addComponents(new ButtonBuilder()
			.setLabel("Hạng của tôi")
			.setEmoji("📍")
			.setStyle(ButtonStyle.Secondary)
			.setCustomId(boardMeId(kind, period, ownerId)));
	}
	return [kindRow, filterRow, pageRow];
}

// 12 bảng xếp hạng dạng ảnh (DEC-029, DEC-030): Activity/Contribution × cá nhân/team × tổng/tuần/tháng, có nút chuyển.
// Hai loại điểm luôn tách biệt (DEC-004). Vẽ ảnh lỗi thì trả embed cũ, vẫn kèm nút.
export default class LeaderboardCmd extends Command
{
	data = new SlashCommandBuilder()
		.setName("leaderboard")
		.setDescription("Xem bảng xếp hạng Activity XP hoặc Contribution (cá nhân/team, tổng/tuần/tháng)")
		.addStringOption(option => option
			.setName(KIND_OPTION)
			.setDescription("Loại điểm cần xếp hạng (mặc định: Activity XP)")
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
		.addStringOption(option => option
			.setName(PERIOD_OPTION)
			.setDescription("Kỳ xếp hạng (mặc định: tổng từ trước tới nay)")
			.addChoices(
				{ name: "Tổng", value: "tong" },
				{ name: "Tuần này", value: "tuan" },
				{ name: "Tháng này", value: "thang" },
			))
		.addIntegerOption(option => option
			.setName(PAGE_OPTION)
			.setDescription("Số trang (mặc định: trang 1)")
			.setMinValue(1));

	override buttonIds = [BOARD_NAMESPACE];

	// Hàm vẽ ảnh; test thay bằng hàm giả để kiểm tra dữ liệu và nhánh dự phòng.
	renderCard: (data: LeaderboardCardData) => Promise<RenderedCard> = renderLeaderboardCard;

	async execute(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const state: BoardState = {
			kind: parseKind(interaction.options.getString(KIND_OPTION)),
			scope: parseScope(interaction.options.getString(SCOPE_OPTION)),
			period: parsePeriod(interaction.options.getString(PERIOD_OPTION)),
			page: clampPage(interaction.options.getInteger(PAGE_OPTION) ?? 1),
			ownerId: interaction.user.id,
		};

		// Cooldown kiểm tra trước khi defer: bị chặn thì dispatcher trả lời riêng ngay (UserError).
		this.client.renderGate.assertCooldown(interaction.user.id);
		await interaction.deferReply(mustReplyPrivately(interaction) ? { flags: MessageFlags.Ephemeral } : undefined);
		await interaction.editReply(await this.boardMessage(interaction.guild, guildId, state));
	}

	/**
	 * Chủ bảng bấm nút: thay ảnh trong chính message đó. Người khác bấm: không đổi message của người khác, mà nhận riêng
	 * một bảng mới do họ làm chủ. Luôn defer trước khi đọc dữ liệu, vì bảng theo kỳ phải cộng từ ledger.
	 */
	override async executeButton(interaction: ButtonInteraction): Promise<void>
	{
		const guildId = requireGuildId(interaction);
		const action = parseBoardId(interaction.customId);
		const viewerId = interaction.user.id;

		// Bị cooldown thì trả lời riêng (UserError) và không đổi message.
		this.client.renderGate.assertCooldown(viewerId);
		const ownsMessage = (action.type === "view" ? action.state.ownerId : action.ownerId) === viewerId;
		if (ownsMessage) await interaction.deferUpdate();
		else await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const state = action.type === "view" ? { ...action.state, ownerId: viewerId } : this.standingState(guildId, action, viewerId);
		if (!state)
		{
			// deferUpdate không có phản hồi riêng để sửa, nên báo bằng followUp riêng; deferReply riêng thì sửa chính nó.
			if (ownsMessage) await interaction.followUp({ content: NO_STANDING, flags: MessageFlags.Ephemeral });
			else await interaction.editReply({ content: NO_STANDING });
			return;
		}
		await interaction.editReply(await this.boardMessage(interaction.guild, guildId, state));
	}

	/**
	 * Bảng cá nhân ở trang có người bấm (vị trí trong đúng thứ tự hiển thị, nên nhóm hoà điểm tràn trang vẫn đúng trang);
	 * null nếu người bấm chưa có điểm trong kỳ. Tính vị trí chỉ quét ledger của kỳ một lần.
	 */
	private standingState(guildId: string, action: Extract<BoardAction, { type: "me" }>, viewerId: string): BoardState | null
	{
		const { kind, period } = action;
		const position = this.client.services.leaderboard.userPosition(guildId, kind, period, viewerId);
		if (position === null) return null;
		return { kind, scope: "individual", period, page: Math.floor(position / CARD_PAGE_SIZE) + 1, ownerId: viewerId };
	}

	/**
	 * Nội dung message bảng xếp hạng: ảnh (hoặc embed nếu vẽ lỗi) và các nút; luôn thay toàn bộ ảnh, embed, nút cũ.
	 * Bậc trên các dòng theo bộ danh hiệu guild đang dùng (DEC-033).
	 */
	private async boardMessage(guild: Guild | null, guildId: string, state: BoardState): Promise<InteractionEditReplyOptions>
	{
		const tierSet = this.client.services.tierSets.current(guildId);
		const loaded = await loadLeaderboardCard(this.client, guild, guildId, { ...state, viewerId: state.ownerId, tierSet });
		const components = boardComponents({ ...state, page: loaded.page.page }, loaded.page.totalPages);

		const card = await this.tryRender(loaded.data);
		if (card)
		{
			return { embeds: [], files: [new AttachmentBuilder(card.png, { name: card.fileName })], attachments: [], components };
		}
		const embed = leaderboardEmbed({ kind: state.kind, scope: state.scope, page: loaded.page });
		return { embeds: [embed], files: [], attachments: [], components };
	}

	/** Ảnh bảng xếp hạng (vẽ qua semaphore toàn process), hoặc null nếu vẽ lỗi (đã ghi log; người dùng nhận embed thay thế). */
	private async tryRender(data: LeaderboardCardData): Promise<RenderedCard | null>
	{
		try
		{
			return await this.client.renderGate.run(() => this.renderCard(data));
		}
		catch (error)
		{
			logger.error("Không vẽ được ảnh bảng xếp hạng, trả về embed thay thế:", error);
			return null;
		}
	}
}

function parseKind(value: string | null): ScoreKind
{
	if (value === null || value === "activity") return "activity";
	if (value === "contribution") return value;
	throw new UserError("Loại bảng xếp hạng không hợp lệ.");
}

function parseScope(value: string | null): LeaderboardScope
{
	if (value === null || value === "ca-nhan") return "individual";
	if (value === "team") return "team";
	throw new UserError("Phạm vi bảng xếp hạng không hợp lệ.");
}

function parsePeriod(value: string | null): LeaderboardPeriod
{
	if (value === null || value === "tong") return "all";
	if (value === "tuan") return "week";
	if (value === "thang") return "month";
	throw new UserError("Kỳ xếp hạng không hợp lệ.");
}
