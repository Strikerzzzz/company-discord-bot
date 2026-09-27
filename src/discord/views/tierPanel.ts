// Hàm thuần dựng giao diện danh hiệu (DEC-031, DEC-033): bảng điều khiển Components V2, form đổi tên, danh sách role, báo cáo đồng bộ.
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	EmbedBuilder,
	InteractionReplyOptions,
	InteractionUpdateOptions,
	LabelBuilder,
	MessageFlags,
	ModalBuilder,
	RoleSelectMenuBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	StringSelectMenuBuilder,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";
import { isTierKey, isTierSetKey, Tier, TIER_KEYS, TIER_SET_KEYS, TIER_SETS, TierKey, tierByKey, TierSet, TierSetKey } from "../../modules/activity/tiers";
import { TierRoleMapping } from "../../modules/gamification/types";
import { TIER_NAME_MAX } from "../../modules/gamification/TierSetService";
import { UserError } from "../../shared/errors";
import { COLORS, fitLines, formatNumber, roleMention } from "../format";
import type { TierRoleSetupEntry, TierRoleSetupResult } from "../tierRoleSetup";

export const TIER_PANEL_NAMESPACE = "tierui";

export const INVALID_PANEL_ACTION = "Bảng điều khiển này đã cũ hoặc không hợp lệ. Hãy mở lại bằng `/config tier panel`.";

/** Chú thích chung về thời điểm bot đổi role danh hiệu (DEC-031: bot không đọc danh sách thành viên). */
export const TIER_ROLE_SYNC_NOTE = "Role được cập nhật khi thành viên nhắn tin được XP; mỗi người chỉ giữ role của bậc danh hiệu hiện tại.";

/** Cảnh báo khi gán role danh hiệu: bot gỡ role này khỏi mọi người không ở đúng bậc, nên role phải dành riêng cho bậc. */
export const TIER_ROLE_DEDICATED_NOTE = "⚠️ Nên dùng role **mới tạo riêng** cho bậc danh hiệu: bot sẽ gỡ role này khỏi người không ở đúng bậc "
	+ "khi họ nhắn tin, và gán cho mọi người đạt bậc.";

/** Số bậc mỗi form đổi tên (form của Discord có tối đa 5 thành phần: 1 dòng hướng dẫn + 4 ô nhập). */
const TIERS_PER_FORM = 4;
/** Độ dài tối đa của ô nhập tên: tên (TIER_NAME_MAX) + khoảng trắng + emoji (tới 16 đơn vị UTF-16), làm tròn lên. */
const NAME_INPUT_MAX = 50;
/** Giới hạn nội dung một tin nhắn của Discord (UTF-16). */
const MESSAGE_CONTENT_MAX = 2000;

const SET_ID = `${TIER_PANEL_NAMESPACE}:set`;
const SETUP_ID = `${TIER_PANEL_NAMESPACE}:setup`;
const RESET_ID = `${TIER_PANEL_NAMESPACE}:reset`;
const PANEL_ID = new RegExp(
	`^${TIER_PANEL_NAMESPACE}:(?:(set|setup|reset)|role:(bac-[1-8])|rename:([12])|names:([12]):(${TIER_SET_KEYS.join("|")}))$`,
);

/** Nhóm bậc của một form đổi tên: 1 = bậc 1–4, 2 = bậc 5–8. */
export type TierNameGroup = 1 | 2;

/**
 * Thao tác mã hoá trong customId của bảng điều khiển:
 * - `tierui:set` menu chọn bộ; `tierui:role:<bậc>` ô chọn role của một bậc;
 * - `tierui:setup` nút tạo/đồng bộ role; `tierui:rename:<nhóm>` nút mở form đổi tên; `tierui:reset` nút tên mặc định;
 * - `tierui:names:<nhóm>:<bộ>` form đổi tên, kèm bộ lúc mở form để không lưu nhầm sang bộ khác nếu bộ vừa bị đổi.
 */
export type TierPanelAction =
	| { type: "set" }
	| { type: "setup" }
	| { type: "reset" }
	| { type: "role"; tierKey: TierKey }
	| { type: "rename"; group: TierNameGroup }
	| { type: "names"; group: TierNameGroup; setKey: TierSetKey };

function toGroup(value: string): TierNameGroup
{
	return value === "1" ? 1 : 2;
}

/** Đọc customId của bảng điều khiển; UserError nếu sai định dạng (customId cũ hoặc bị sửa). */
export function parseTierPanelId(customId: string): TierPanelAction
{
	const match = PANEL_ID.exec(customId);
	if (!match) throw new UserError(INVALID_PANEL_ACTION);
	const [, simple, tierKey, renameGroup, namesGroup, setKey] = match;
	if (simple === "set" || simple === "setup" || simple === "reset") return { type: simple };
	if (tierKey !== undefined && isTierKey(tierKey)) return { type: "role", tierKey };
	if (renameGroup !== undefined) return { type: "rename", group: toGroup(renameGroup) };
	if (namesGroup !== undefined && setKey !== undefined && isTierSetKey(setKey)) return { type: "names", group: toGroup(namesGroup), setKey };
	throw new UserError(INVALID_PANEL_ACTION);
}

export function tierRoleSelectId(tierKey: TierKey): string
{
	return `${TIER_PANEL_NAMESPACE}:role:${tierKey}`;
}

export function tierRenameButtonId(group: TierNameGroup): string
{
	return `${TIER_PANEL_NAMESPACE}:rename:${group}`;
}

export function tierRenameModalId(group: TierNameGroup, setKey: TierSetKey): string
{
	return `${TIER_PANEL_NAMESPACE}:names:${group}:${setKey}`;
}

/** Các bậc của một form đổi tên. */
export function tierKeysOfGroup(group: TierNameGroup): readonly TierKey[]
{
	return TIER_KEYS.slice((group - 1) * TIERS_PER_FORM, group * TIERS_PER_FORM);
}

/** "{emoji} {tên}" của một bậc, dạng admin nhập trong form đổi tên. */
export function tierDisplayName(tier: Tier): string
{
	return `${tier.emoji} ${tier.name}`;
}

/** "{emoji} **{tên}** (từ Level n)". */
export function tierTitle(tier: Tier): string
{
	return `${tier.emoji} **${tier.name}** (từ Level ${formatNumber(tier.minLevel)})`;
}

function colorOf(hex: string): number
{
	return Number.parseInt(hex.slice(1), 16);
}

/** Bậc mặc định (chưa áp tên tuỳ chỉnh) cùng vị trí trong bộ. */
function defaultTier(set: TierSet, tierKey: TierKey): Tier
{
	return tierByKey(tierKey, TIER_SETS[set.key]);
}

/** Bộ có bậc nào đang dùng tên hoặc emoji khác mặc định không. */
function hasCustomNames(set: TierSet): boolean
{
	return set.tiers.some(tier =>
	{
		const base = defaultTier(set, tier.key);
		return tier.name !== base.name || tier.emoji !== base.emoji;
	});
}

// ---------- Bảng điều khiển ----------

export interface TierPanelData
{
	/** Bộ guild đang dùng, đã áp tên tuỳ chỉnh. */
	set: TierSet;
	mappings: readonly TierRoleMapping[];
	/** Role đã gán nhưng không còn trong server (không điền sẵn vào ô chọn, và nhắc bấm ✨ để tạo lại). */
	missingRoleIds?: ReadonlySet<string>;
}

function separator(): SeparatorBuilder
{
	return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function headerText({ set, mappings }: TierPanelData): string
{
	const levels = set.tiers.map(tier => formatNumber(tier.minLevel)).join(" · ");
	return [
		"## 🏅 Bảng điều khiển danh hiệu",
		`Bộ đang dùng: **${set.name}** · ${set.description}`,
		`Mốc level: ${levels} · Role đã gán: **${mappings.length}/${set.tiers.length}**`,
		"-# Chọn role ở từng bậc để gán ngay, xoá lựa chọn để bỏ gán. Nên dùng role mới tạo riêng, hoặc bấm ✨ để bot tự tạo. "
			+ "Đổi bộ hay đổi tên bậc xong, bấm ✨ để đổi tên và màu role theo.",
		`-# ${TIER_ROLE_SYNC_NOTE}`,
	].join("\n");
}

function setSelect(current: TierSetKey): StringSelectMenuBuilder
{
	return new StringSelectMenuBuilder()
		.setCustomId(SET_ID)
		.setPlaceholder("Chọn bộ danh hiệu")
		.setMinValues(1)
		.setMaxValues(1)
		.addOptions(TIER_SET_KEYS.map(key => ({
			label: TIER_SETS[key].name,
			value: key,
			description: TIER_SETS[key].description,
			default: key === current,
		})));
}

function tierLine(tier: Tier, missing: boolean): string
{
	const line = `${tier.emoji} **${tier.name}** · từ Level ${formatNumber(tier.minLevel)}`;
	return missing ? `${line}\n-# ⚠️ Role đã gán không còn trong server; bấm ✨ để tạo lại hoặc chọn role khác.` : line;
}

function roleSelect(tier: Tier, roleId: string | null): RoleSelectMenuBuilder
{
	const select = new RoleSelectMenuBuilder()
		.setCustomId(tierRoleSelectId(tier.key))
		.setPlaceholder(`Chọn role cho ${tier.name}`)
		.setMinValues(0)
		.setMaxValues(1);
	return roleId === null ? select : select.setDefaultRoles(roleId);
}

function panelButtons(set: TierSet): ButtonBuilder[]
{
	return [
		new ButtonBuilder().setCustomId(SETUP_ID).setStyle(ButtonStyle.Primary).setLabel("✨ Tạo/đồng bộ role"),
		new ButtonBuilder().setCustomId(tierRenameButtonId(1)).setStyle(ButtonStyle.Secondary).setLabel("✏️ Đổi tên bậc 1–4"),
		new ButtonBuilder().setCustomId(tierRenameButtonId(2)).setStyle(ButtonStyle.Secondary).setLabel("✏️ Đổi tên bậc 5–8"),
		new ButtonBuilder().setCustomId(RESET_ID).setStyle(ButtonStyle.Secondary).setLabel("↺ Tên mặc định").setDisabled(!hasCustomNames(set)),
	];
}

/**
 * Bảng điều khiển danh hiệu (Components V2): tiêu đề và bộ đang dùng, menu chọn bộ, mỗi bậc một dòng chữ kèm ô chọn role
 * (điền sẵn role đang gán), hàng nút thao tác. Tổng 35 component (tính cả lồng nhau), dưới giới hạn 40 của Discord.
 */
export function buildTierPanel(data: TierPanelData): ContainerBuilder
{
	const { set } = data;
	const roleByTier = new Map(data.mappings.map(mapping => [mapping.tierKey, mapping.roleId]));
	const container = new ContainerBuilder()
		.setAccentColor(colorOf(set.tiers[set.tiers.length - 1].color))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText(data)))
		.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(setSelect(set.key)))
		.addSeparatorComponents(separator());
	for (const tier of set.tiers)
	{
		const roleId = roleByTier.get(tier.key) ?? null;
		const missing = roleId !== null && (data.missingRoleIds?.has(roleId) ?? false);
		container
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(tierLine(tier, missing)))
			.addActionRowComponents(new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(roleSelect(tier, missing ? null : roleId)));
	}
	return container
		.addSeparatorComponents(separator())
		.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(panelButtons(set)));
}

/** Phản hồi mở bảng điều khiển: trả lời riêng, Components V2 (không kèm content hay embed). */
export function tierPanelReply(data: TierPanelData): InteractionReplyOptions
{
	return { components: [buildTierPanel(data)], flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 };
}

/** Nội dung thay cho bảng điều khiển hiện có (update, hoặc editReply sau deferUpdate). */
export function tierPanelUpdate(data: TierPanelData): InteractionUpdateOptions
{
	return { components: [buildTierPanel(data)], flags: MessageFlags.IsComponentsV2 };
}

/** Gợi ý sau khi đổi bộ mà đang có role gán theo bậc. */
export function tierSetChangedHint(set: TierSet): string
{
	return `Đã chuyển sang bộ **${set.name}**. Tên và màu của các role đã gán chưa đổi: bấm **✨ Tạo/đồng bộ role** để bot đổi theo bộ mới.`;
}

// ---------- Form đổi tên ----------

/**
 * Form đổi tên 4 bậc của một nhóm: mỗi ô điền sẵn "{emoji} {tên}" hiện tại, không bắt buộc (để trống = tên mặc định).
 * customId của mỗi ô là khoá bậc.
 */
export function buildTierRenameModal(set: TierSet, group: TierNameGroup): ModalBuilder
{
	const keys = tierKeysOfGroup(group);
	const first = TIER_KEYS.indexOf(keys[0]) + 1;
	const modal = new ModalBuilder()
		.setCustomId(tierRenameModalId(group, set.key))
		.setTitle(`Đổi tên bậc ${first}–${first + keys.length - 1} · bộ ${set.name}`)
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(
			`Đặt emoji ở đầu, ví dụ "🟡 Kim Đan"; tên tối đa ${TIER_NAME_MAX} ký tự. Để trống một ô để dùng lại tên mặc định.`,
		));
	for (const key of keys)
	{
		const tier = tierByKey(key, set);
		const value = tierDisplayName(tier);
		const fallback = tierDisplayName(defaultTier(set, key));
		modal.addLabelComponents(new LabelBuilder()
			.setLabel(`Bậc ${tier.index + 1} · từ Level ${formatNumber(tier.minLevel)}`)
			.setDescription(`Để trống = tên mặc định: ${fallback}`)
			.setTextInputComponent(new TextInputBuilder()
				.setCustomId(key)
				.setStyle(TextInputStyle.Short)
				.setRequired(false)
				.setMaxLength(Math.max(NAME_INPUT_MAX, value.length))
				.setPlaceholder(fallback)
				.setValue(value)));
	}
	return modal;
}

// ---------- Danh sách và báo cáo ----------

/** Danh sách 8 bậc của bộ đang dùng: emoji, tên, mốc level và role đã gán (hoặc "chưa gán"). */
export function buildTierRoleListEmbed(set: TierSet, mappings: readonly TierRoleMapping[]): EmbedBuilder
{
	const roleByTier = new Map(mappings.map(mapping => [mapping.tierKey, mapping.roleId]));
	const lines = set.tiers.map(tier =>
	{
		const roleId = roleByTier.get(tier.key);
		return `${tier.emoji} **${tier.name}** · từ Level ${formatNumber(tier.minLevel)} · ${roleId === undefined ? "chưa gán" : roleMention(roleId)}`;
	});

	return new EmbedBuilder()
		.setColor(COLORS.primary)
		.setTitle(`🏅 Role danh hiệu · bộ ${set.name} (${mappings.length}/${set.tiers.length})`)
		.setDescription(lines.join("\n"))
		.setFooter({ text: TIER_ROLE_SYNC_NOTE });
}

function setupEntryLine(entry: TierRoleSetupEntry): string | null
{
	const title = `${entry.tier.emoji} **${entry.tier.name}**`;
	const role = entry.roleId === null ? "" : ` ${roleMention(entry.roleId)}`;
	switch (entry.status)
	{
	case "created": return `• ${title}: đã tạo${role}`;
	case "recreated": return `• ${title}: role cũ không còn, đã tạo lại${role}`;
	case "renamed": return `• ${title}: đã đổi tên và màu${role}`;
	case "skipped": return `• ${title}: bỏ qua${role}. ${entry.reason ?? ""}`.trimEnd();
	case "unchanged": return null;
	}
}

/** Báo cáo một lần tạo/đồng bộ role: số đếm, rồi từng bậc có thay đổi hoặc bị bỏ qua (kèm lý do); vừa một tin nhắn. */
export function buildTierSetupReport(set: TierSet, result: TierRoleSetupResult): string
{
	const { summary } = result;
	const unchanged = result.entries.filter(entry => entry.status === "unchanged").length;
	const head = `✨ Đồng bộ role theo bộ **${set.name}**: tạo mới **${summary.created}** · đổi tên **${summary.renamed}** · `
		+ `giữ nguyên **${unchanged}** · bỏ qua **${summary.skipped}**.`;
	const lines = result.entries.map(setupEntryLine).filter((line): line is string => line !== null);
	return fitLines([head, ...lines, `-# ${TIER_ROLE_SYNC_NOTE}`], MESSAGE_CONTENT_MAX, hidden => `… và ${hidden} dòng khác`);
}
