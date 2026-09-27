// Hàm thuần dựng giao diện danh hiệu (DEC-031, DEC-033): bảng điều khiển Components V2, form đổi tên, danh sách role, báo cáo đồng bộ.
import { createHash } from "node:crypto";
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
import { COLORS, fitLines, formatNumber, roleMention, truncate } from "../format";
import type { TierRoleClearOutcome, TierRoleSetupEntry, TierRoleSetupResult } from "../tierRoleSetup";

export const TIER_PANEL_NAMESPACE = "tierui";

export const INVALID_PANEL_ACTION = "Bảng điều khiển này đã cũ hoặc không hợp lệ. Hãy mở lại bằng `/config tier panel`.";

/** Chú thích chung về thời điểm bot đổi role danh hiệu (DEC-031: bot không đọc danh sách thành viên). */
export const TIER_ROLE_SYNC_NOTE = "Role được cập nhật khi thành viên nhắn tin được XP; mỗi người chỉ giữ role của bậc danh hiệu hiện tại.";

/** Cảnh báo khi gán role danh hiệu: bot gỡ role này khỏi mọi người không ở đúng bậc, nên role phải dành riêng cho bậc. */
export const TIER_ROLE_DEDICATED_NOTE = "⚠️ Nên dùng role **mới tạo riêng** cho bậc danh hiệu: bot sẽ gỡ role này khỏi người không ở đúng bậc "
	+ "khi họ nhắn tin, và gán cho mọi người đạt bậc.";

/** Số bậc mỗi form đổi tên (form của Discord có tối đa 5 thành phần: 1 dòng hướng dẫn + 4 ô nhập). */
const TIERS_PER_FORM = 4;
/**
 * Độ dài tối đa (UTF-16) của ô nhập tên, cố định để không phụ thuộc giá trị đang có: đủ cho tên dài nhất TierSetService
 * nhận + khoảng trắng + emoji (tới 16 đơn vị UTF-16). Tên quá dài thì TierSetService báo lỗi khi lưu.
 */
const NAME_INPUT_MAX = 72;
/** Giới hạn nội dung một tin nhắn của Discord (UTF-16). */
const MESSAGE_CONTENT_MAX = 2000;
/** Giới hạn placeholder của menu chọn, và placeholder/mô tả của ô nhập trong form (UTF-16). */
const SELECT_PLACEHOLDER_MAX = 150;
const INPUT_PLACEHOLDER_MAX = 100;
const LABEL_DESCRIPTION_MAX = 100;
/** Số ký tự hex của dấu vân tay tên bậc trong customId của form đổi tên. */
const FINGERPRINT_LENGTH = 8;
const NO_ROLE = "none";

const SET_ID = `${TIER_PANEL_NAMESPACE}:set`;
const SETUP_ID = `${TIER_PANEL_NAMESPACE}:setup`;
const SET_KEYS_PATTERN = TIER_SET_KEYS.join("|");
const PANEL_ID = new RegExp(
	`^${TIER_PANEL_NAMESPACE}:(?:(set|setup)|reset:(${SET_KEYS_PATTERN})|role:(bac-[1-8]):(\\d{17,20}|${NO_ROLE})|rename:([12])`
		+ `|names:([12]):(${SET_KEYS_PATTERN}):([0-9a-f]{${FINGERPRINT_LENGTH}}))$`,
);

/** Nhóm bậc của một form đổi tên: 1 = bậc 1–4, 2 = bậc 5–8. */
export type TierNameGroup = 1 | 2;

/**
 * Thao tác mã hoá trong customId của bảng điều khiển. Các thao tác có thể ghi đè thay đổi của người khác mang theo trạng thái
 * lúc vẽ bảng, để bảng cũ không làm hỏng cấu hình mới:
 * - `tierui:set` menu chọn bộ; `tierui:setup` nút tạo/đồng bộ role; `tierui:rename:<nhóm>` nút mở form đổi tên;
 * - `tierui:role:<bậc>:<role lúc vẽ | none>` ô chọn role của một bậc (xoá lựa chọn chỉ bỏ gán nếu bậc vẫn giữ role đó);
 * - `tierui:reset:<bộ>` nút tên mặc định (chỉ khôi phục nếu bộ vẫn là bộ lúc vẽ);
 * - `tierui:names:<nhóm>:<bộ>:<vân tay>` form đổi tên, kèm bộ và dấu vân tay tên 4 bậc lúc mở form (tierNamesFingerprint),
 *   để không lưu đè nếu bộ hoặc tên vừa bị đổi.
 */
export type TierPanelAction =
	| { type: "set" }
	| { type: "setup" }
	| { type: "reset"; setKey: TierSetKey }
	| { type: "role"; tierKey: TierKey; drawnRoleId: string | null }
	| { type: "rename"; group: TierNameGroup }
	| { type: "names"; group: TierNameGroup; setKey: TierSetKey; fingerprint: string };

function toGroup(value: string): TierNameGroup
{
	return value === "1" ? 1 : 2;
}

/** Đọc customId của bảng điều khiển; UserError nếu sai định dạng (customId cũ hoặc bị sửa). */
export function parseTierPanelId(customId: string): TierPanelAction
{
	const match = PANEL_ID.exec(customId);
	if (!match) throw new UserError(INVALID_PANEL_ACTION);
	const [, simple, resetSet, tierKey, drawnRole, renameGroup, namesGroup, namesSet, fingerprint] = match;
	if (simple === "set" || simple === "setup") return { type: simple };
	if (resetSet !== undefined && isTierSetKey(resetSet)) return { type: "reset", setKey: resetSet };
	if (tierKey !== undefined && drawnRole !== undefined && isTierKey(tierKey))
	{
		return { type: "role", tierKey, drawnRoleId: drawnRole === NO_ROLE ? null : drawnRole };
	}
	if (renameGroup !== undefined) return { type: "rename", group: toGroup(renameGroup) };
	if (namesGroup !== undefined && namesSet !== undefined && fingerprint !== undefined && isTierSetKey(namesSet))
	{
		return { type: "names", group: toGroup(namesGroup), setKey: namesSet, fingerprint };
	}
	throw new UserError(INVALID_PANEL_ACTION);
}

/** customId ô chọn role của một bậc, kèm role đang gán lúc vẽ bảng (null = chưa gán). */
export function tierRoleSelectId(tierKey: TierKey, drawnRoleId: string | null): string
{
	return `${TIER_PANEL_NAMESPACE}:role:${tierKey}:${drawnRoleId ?? NO_ROLE}`;
}

export function tierResetButtonId(setKey: TierSetKey): string
{
	return `${TIER_PANEL_NAMESPACE}:reset:${setKey}`;
}

export function tierRenameButtonId(group: TierNameGroup): string
{
	return `${TIER_PANEL_NAMESPACE}:rename:${group}`;
}

/** Các bậc của một form đổi tên. */
export function tierKeysOfGroup(group: TierNameGroup): readonly TierKey[]
{
	return TIER_KEYS.slice((group - 1) * TIERS_PER_FORM, group * TIERS_PER_FORM);
}

/** Dấu vân tay ngắn (8 ký tự hex) của tên và emoji hiện tại của các bậc trong một nhóm, để nhận ra form đổi tên đã cũ. */
export function tierNamesFingerprint(set: TierSet, group: TierNameGroup): string
{
	const names = tierKeysOfGroup(group).map(key =>
	{
		const tier = tierByKey(key, set);
		return [tier.emoji, tier.name];
	});
	return createHash("sha256").update(JSON.stringify(names)).digest("hex").slice(0, FINGERPRINT_LENGTH);
}

export function tierRenameModalId(group: TierNameGroup, setKey: TierSetKey, fingerprint: string): string
{
	return `${TIER_PANEL_NAMESPACE}:names:${group}:${setKey}:${fingerprint}`;
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
		"-# Chọn role ở từng bậc để gán ngay, xoá lựa chọn để bỏ gán (role do bot tạo thì bot xoá luôn). Nên dùng role mới tạo "
			+ "riêng, hoặc bấm ✨ để bot tự tạo. Đổi bộ hay đổi tên bậc xong, bấm ✨ để bot đổi tên và màu các role do bot tạo.",
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

/**
 * Ô chọn role của một bậc. customId mang role đang gán (kể cả role không còn trong server), còn lựa chọn điền sẵn chỉ có
 * khi role còn trong server (`prefill`).
 */
function roleSelect(tier: Tier, roleId: string | null, prefill: boolean): RoleSelectMenuBuilder
{
	const select = new RoleSelectMenuBuilder()
		.setCustomId(tierRoleSelectId(tier.key, roleId))
		.setPlaceholder(truncate(`Chọn role cho ${tier.name}`, SELECT_PLACEHOLDER_MAX))
		.setMinValues(0)
		.setMaxValues(1);
	return roleId === null || !prefill ? select : select.setDefaultRoles(roleId);
}

function panelButtons(set: TierSet): ButtonBuilder[]
{
	return [
		new ButtonBuilder().setCustomId(SETUP_ID).setStyle(ButtonStyle.Primary).setLabel("✨ Tạo/đồng bộ role"),
		new ButtonBuilder().setCustomId(tierRenameButtonId(1)).setStyle(ButtonStyle.Secondary).setLabel("✏️ Đổi tên bậc 1–4"),
		new ButtonBuilder().setCustomId(tierRenameButtonId(2)).setStyle(ButtonStyle.Secondary).setLabel("✏️ Đổi tên bậc 5–8"),
		new ButtonBuilder()
			.setCustomId(tierResetButtonId(set.key))
			.setStyle(ButtonStyle.Secondary)
			.setLabel("↺ Tên mặc định")
			.setDisabled(!hasCustomNames(set)),
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
			.addActionRowComponents(new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(roleSelect(tier, roleId, !missing)));
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
	return `Đã chuyển sang bộ **${set.name}**. Tên và màu của các role đã gán chưa đổi: bấm **✨ Tạo/đồng bộ role** để bot đổi theo bộ mới `
		+ "(bot chỉ đổi tên role do bot tạo; role do admin tự gán giữ nguyên tên).";
}

// ---------- Form đổi tên ----------

/**
 * Form đổi tên 4 bậc của một nhóm: mỗi ô điền sẵn "{emoji} {tên}" hiện tại, không bắt buộc (để trống = tên mặc định).
 * customId của mỗi ô là khoá bậc; customId của form mang bộ và dấu vân tay tên hiện tại (tierNamesFingerprint).
 * Độ dài tối đa của ô cố định (NAME_INPUT_MAX); tên hợp lệ luôn vừa, còn giá trị dài hơn (không thể có qua TierSetService)
 * thì không điền sẵn để builder không ném lỗi.
 */
export function buildTierRenameModal(set: TierSet, group: TierNameGroup): ModalBuilder
{
	const keys = tierKeysOfGroup(group);
	const first = TIER_KEYS.indexOf(keys[0]) + 1;
	const modal = new ModalBuilder()
		.setCustomId(tierRenameModalId(group, set.key, tierNamesFingerprint(set, group)))
		.setTitle(`Đổi tên bậc ${first}–${first + keys.length - 1} · bộ ${set.name}`)
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(
			`Đặt emoji ở đầu, ví dụ "🟡 Kim Đan"; tên tối đa ${TIER_NAME_MAX} ký tự, không chứa link. Để trống một ô để dùng lại tên mặc định.`,
		));
	for (const key of keys)
	{
		const tier = tierByKey(key, set);
		const value = tierDisplayName(tier);
		const fallback = tierDisplayName(defaultTier(set, key));
		const input = new TextInputBuilder()
			.setCustomId(key)
			.setStyle(TextInputStyle.Short)
			.setRequired(false)
			.setMaxLength(NAME_INPUT_MAX)
			.setPlaceholder(truncate(fallback, INPUT_PLACEHOLDER_MAX));
		if (value.length <= NAME_INPUT_MAX) input.setValue(value);
		modal.addLabelComponents(new LabelBuilder()
			.setLabel(`Bậc ${tier.index + 1} · từ Level ${formatNumber(tier.minLevel)}`)
			.setDescription(truncate(`Để trống = tên mặc định: ${fallback}`, LABEL_DESCRIPTION_MAX))
			.setTextInputComponent(input));
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

function withNote(line: string, note: string | null): string
{
	return note === null ? line : `${line}. ${note}`;
}

function setupEntryLine(entry: TierRoleSetupEntry): string | null
{
	const title = `${entry.tier.emoji} **${entry.tier.name}**`;
	const role = entry.roleId === null ? "" : ` ${roleMention(entry.roleId)}`;
	switch (entry.status)
	{
	case "created": return `• ${title}: đã tạo${role}`;
	case "recreated": return `• ${title}: role cũ không còn, đã tạo lại${role}`;
	case "renamed": return withNote(`• ${title}: đã đổi tên và màu${role}`, entry.reason);
	case "kept": return `• ${title}: giữ nguyên tên${role} (role do admin tự gán)`;
	case "skipped": return withNote(`• ${title}: bỏ qua${role}`, entry.reason);
	case "unchanged": return null;
	}
}

/** Dòng cảnh báo đặt ngay sau dòng số đếm (trước danh sách từng bậc, để không bị cắt khi báo cáo dài). */
function setupWarnings(result: TierRoleSetupResult): string[]
{
	const warnings: string[] = [];
	if (result.setChangedMeanwhile)
	{
		warnings.push("⚠️ Bộ danh hiệu hoặc tên bậc vừa được đổi trong lúc bot đang đồng bộ, nên tên role có thể chưa theo tên mới. "
			+ "Hãy bấm lại **✨ Tạo/đồng bộ role** (hoặc chạy lại `/config tier setup-roles`).");
	}
	const orphaned = result.summary.orphanedRoles;
	if (orphaned.length > 0)
	{
		warnings.push(`⚠️ Bot vừa tạo nhưng không dùng được, cũng không xoá lại được: ${orphaned.map(roleMention).join(", ")}. `
			+ "Hãy xoá thủ công trong **Server Settings → Roles**.");
	}
	return warnings;
}

/** Ghi chú cuối báo cáo: role do admin gán giữ nguyên tên, thứ tự role để thấy màu danh hiệu. */
function setupFootnotes(result: TierRoleSetupResult): string[]
{
	const notes: string[] = [];
	if (result.summary.keptRoles.length > 0)
	{
		notes.push("-# Bot chỉ đổi tên role do bot tạo. Muốn role do admin tự gán theo tên mới thì đổi tên thủ công trong "
			+ "**Server Settings → Roles**, hoặc bỏ gán rồi bấm ✨ để bot tạo role mới.");
	}
	if (result.summary.created + result.summary.renamed > 0)
	{
		notes.push("-# Muốn thấy màu danh hiệu trên tên thành viên: trong **Server Settings → Roles**, kéo các role danh hiệu lên trên "
			+ "role có màu khác (ví dụ role team) và vẫn nằm dưới role của bot.");
	}
	notes.push(`-# ${TIER_ROLE_SYNC_NOTE}`);
	return notes;
}

/**
 * Báo cáo một lần tạo/đồng bộ role: số đếm, cảnh báo (bộ vừa đổi, role mồ côi), từng bậc có thay đổi, giữ nguyên tên hoặc
 * bị bỏ qua (kèm lý do), rồi ghi chú; vừa một tin nhắn.
 */
export function buildTierSetupReport(set: TierSet, result: TierRoleSetupResult): string
{
	const { summary } = result;
	const unchanged = result.entries.filter(entry => entry.status === "unchanged").length;
	const head = `✨ Đồng bộ role theo bộ **${set.name}**: tạo mới **${summary.created}** · đổi tên **${summary.renamed}** · `
		+ `giữ nguyên tên **${summary.keptRoles.length}** · đã đúng **${unchanged}** · bỏ qua **${summary.skipped}**.`;
	const lines = result.entries.map(setupEntryLine).filter((line): line is string => line !== null);
	return fitLines(
		[head, ...setupWarnings(result), ...lines, ...setupFootnotes(result)],
		MESSAGE_CONTENT_MAX,
		hidden => `… và ${hidden} dòng khác`,
	);
}

/** Phản hồi sau khi bỏ role của một bậc (`/config tier clear-role` hoặc xoá lựa chọn trên bảng điều khiển). */
export function tierRoleClearedText(outcome: TierRoleClearOutcome, tier: Tier): string
{
	const title = tierTitle(tier);
	if (outcome.status === "unassigned" || outcome.roleId === null) return `Bậc ${title} chưa được gán role.`;
	const role = roleMention(outcome.roleId);
	if (outcome.status === "changed")
	{
		const lines = [`Bậc ${title} vừa được đổi role trong lúc bot xử lý, nên bot chưa bỏ gán gì. Hãy kiểm tra lại bằng \`/config tier list\`.`];
		if (outcome.deletion.kind === "deleted") lines.push(`Role do bot tạo ${role} đã bị xoá khỏi server.`);
		return lines.join("\n");
	}
	const cleared = `Đã bỏ ${role} khỏi bậc ${title}. Bot không tự gỡ role đó khỏi những người đang có; nếu cần, hãy gỡ thủ công.`;
	switch (outcome.deletion.kind)
	{
	case "none": return cleared;
	case "absent": return `Đã bỏ ${role} khỏi bậc ${title} (role này đã không còn trong server).`;
	case "deleted": return `Đã bỏ gán và xoá role do bot tạo của bậc ${title} khỏi server, vì role này không còn dùng vào việc gì khác `
		+ "(thành viên đang có role đó cũng không còn role này).";
	case "kept": return `${cleared}\n⚠️ Role này do bot tạo nhưng bot chưa xoá khỏi server: ${outcome.deletion.reason} `
		+ "Nếu không dùng nữa, hãy xoá thủ công trong **Server Settings → Roles**.";
	}
}
