import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	LabelBuilder,
	messageLink,
	MessageFlags,
	MessageMentionOptions,
	ModalBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";
import { RETRO_FIELD_TITLES, RETRO_FIELDS, RETRO_LIMITS, RetroAnswers, RetroColumns, RetroField, RetroSession } from "../../modules/retro/types";
import { UserError } from "../../shared/errors";
import { channelMention, COLORS, dateTime, disableMaskedLinks, fitLines, formatNumber, relativeTime, roleMention, truncate, userMention } from "../format";

/*
 * Giao diện retro sprint (DEC-049): tin của phiên có nút "📝 Điền retro", form 5 ô, bảng tổng hợp ẩn danh khi đóng, thông báo tên
 * sprint. Hàm thuần, test được không cần Discord client. Mọi chữ người dùng viết đi qua `plainText` (escape markdown và ký tự mở
 * mention); mọi payload đặt allowedMentions rõ ràng.
 */

/** Namespace customId của nút và form retro (khai báo trong `buttonIds` của /retro). */
export const RETRO_NAMESPACE = "retro";
export const INVALID_RETRO_COMPONENT = "Nút hoặc form retro này không hợp lệ.";
/** Discord giới hạn tổng số ký tự của mọi TextDisplay trong một message Components V2. */
export const RETRO_TEXT_MAX = 4000;

/** "fill": nút mở form; "form": form 5 ô. Cả hai mang mã phiên. */
export type RetroComponentAction = "fill" | "form";

const COMPONENT_ID = /^retro:(fill|form):([1-9]\d{0,15})$/u;
const MODAL_TITLE_MAX = 45;
const LABEL_MAX = 45;
const IDEA_DISPLAY_MAX = 300;
const TITLE_DISPLAY_MAX = 100;
const NAME_LIST_MAX = 1500;
const PARTICIPANT_LIST_MAX = 1500;

/** customId của từng ô trong form (ổn định, không phụ thuộc thứ tự). */
export const RETRO_INPUT_IDS: Readonly<Record<RetroField, string>> = {
	learned: "learned",
	improve: "improve",
	ideas: "ideas",
	kudos: "kudos",
	sprintName: "sprint",
};

const FIELD_HINTS: Readonly<Record<RetroField, string>> = {
	learned: "Điều bạn học được trong sprint",
	improve: "Điều chưa tốt, cần cải thiện",
	ideas: "Ý tưởng mới, đề xuất thay đổi",
	kudos: "Muốn cảm ơn, khen ngợi ai hay điều gì",
	sprintName: `Đề xuất một tên cho sprint (tối đa ${RETRO_LIMITS.sprintNameMax} ký tự, không được chỉ là số)`,
};

/** Không ping ai. */
export const NO_MENTIONS: MessageMentionOptions = { parse: [] };

/** Payload Components V2 dùng chung cho reply, sửa và gửi tin. */
export interface RetroComponentsPayload
{
	components: ContainerBuilder[];
	flags: MessageFlags.IsComponentsV2;
	allowedMentions: MessageMentionOptions;
}

export function retroComponentId(action: RetroComponentAction, sessionId: number): string
{
	return `${RETRO_NAMESPACE}:${action}:${sessionId}`;
}

/** Hành động và mã phiên trong customId `retro:<fill|form>:<id>`; UserError nếu sai định dạng. */
export function parseRetroComponentId(customId: string): { action: RetroComponentAction; sessionId: number }
{
	const match = COMPONENT_ID.exec(customId);
	const sessionId = match ? Number(match[2]) : NaN;
	if (!match || !Number.isSafeInteger(sessionId)) throw new UserError(INVALID_RETRO_COMPONENT);
	return { action: match[1] === "fill" ? "fill" : "form", sessionId };
}

/**
 * Chữ người dùng viết, đưa vào tin nhắn: vô hiệu hoá masked link rồi thêm `\` trước ký tự markdown và ký tự mở mention (`<`, `>`,
 * `@`, `#`), để chữ như `<@&id>`, `@everyone` hay `**` không thành mention hay phá định dạng.
 */
export function plainText(text: string): string
{
	return disableMaskedLinks(text).replace(/[\\*_~`|<>@#[\]]/gu, "\\$&");
}

/** Một ý trên một dòng: gộp khoảng trắng và xuống dòng, cắt gọn, rồi escape. */
function oneLine(text: string, max: number): string
{
	return plainText(truncate(text.replace(/\s+/gu, " ").trim(), max));
}

export function retroTitle(session: Pick<RetroSession, "title">): string
{
	return oneLine(session.title, TITLE_DISPLAY_MAX);
}

/** Trạng thái phiên bằng chữ. `pollOpen` = vote tên sprint còn mở (chỉ có ý nghĩa khi status "voting"). */
export function retroStatusLabel(session: RetroSession, pollOpen = true): string
{
	switch (session.status)
	{
	case "open": return session.acceptingAnswers ? "🟢 Đang nhận câu trả lời" : "⏳ Đã hết hạn, bot sắp đóng phiên";
	case "closed": return "🔒 Đã đóng";
	case "voting":
		if (session.tieNames !== null) return "⚖️ Vote tên sprint hoà, chờ người quản lý chọn tên";
		return pollOpen ? "🗳️ Đang vote tên sprint" : "🗳️ Vote tên sprint đã đóng, bot đang chốt kết quả";
	case "done": return session.winnerName === null ? "✅ Hoàn tất" : `✅ Hoàn tất · 🏆 ${oneLine(session.winnerName, RETRO_LIMITS.sprintNameMax)}`;
	}
}

function deadlineLine(session: RetroSession): string | null
{
	if (session.status !== "open") return null;
	return session.closesAt === null ? "⏰ Không tự đóng: người quản lý đóng bằng `/retro close`" : `⏰ Hạn: ${dateTime(session.closesAt)} (${relativeTime(session.closesAt)})`;
}

function separator(): SeparatorBuilder
{
	return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

/** Link tài liệu (URL đã chuẩn hoá khi lưu, không có dấu cách hay `>`), trong `<>` để Discord không hiện xem trước. */
function docLine(session: RetroSession): string | null
{
	return session.docUrl === null ? null : `📄 Tài liệu: <${session.docUrl}>`;
}

/** Nút "📝 Điền retro"; chỉ bấm được khi phiên đang mở. */
export function retroFillButton(session: RetroSession): ButtonBuilder
{
	return new ButtonBuilder()
		.setCustomId(retroComponentId("fill", session.id))
		.setStyle(ButtonStyle.Primary)
		.setLabel("📝 Điền retro")
		.setDisabled(session.status !== "open");
}

/**
 * Tin của phiên (Components V2): tiêu đề, trạng thái, link tài liệu, team, hạn, số người đã điền, nút "📝 Điền retro". Không bao giờ
 * có tên người điền.
 */
export function retroSessionMessage(session: RetroSession): RetroComponentsPayload
{
	const lines = [
		retroStatusLabel(session),
		docLine(session),
		session.teamRoleId === null ? "👥 Ai xem được kênh này cũng điền được" : `👥 Team: ${roleMention(session.teamRoleId)}`,
		deadlineLine(session),
		`✍️ Đã điền: **${formatNumber(session.participants)}** người`,
	].filter((line): line is string => line !== null);
	const container = new ContainerBuilder()
		.setAccentColor(session.status === "open" ? COLORS.primary : COLORS.neutral)
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🔁 Retro: ${retroTitle(session)}`))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n")))
		.addSeparatorComponents(separator())
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(
			"-# Câu trả lời ẩn danh: bảng tổng hợp và Confluence không ghi tên người viết. Bấm nút lần nữa để sửa câu trả lời tới khi phiên đóng.",
		))
		.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(retroFillButton(session)))
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Retro #${session.id}`));
	return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: NO_MENTIONS };
}

/** Form 5 ô (không bắt buộc), điền sẵn câu trả lời cũ nếu có. customId `retro:form:<id>`. */
export function retroModal(session: RetroSession, answers: RetroAnswers | null): ModalBuilder
{
	const modal = new ModalBuilder()
		.setCustomId(retroComponentId("form", session.id))
		.setTitle(truncate(`Retro: ${session.title.replace(/\s+/gu, " ")}`, MODAL_TITLE_MAX));
	for (const field of RETRO_FIELDS)
	{
		const isName = field === "sprintName";
		const max = isName ? RETRO_LIMITS.sprintNameMax : RETRO_LIMITS.answerMax;
		const input = new TextInputBuilder()
			.setCustomId(RETRO_INPUT_IDS[field])
			.setStyle(isName ? TextInputStyle.Short : TextInputStyle.Paragraph)
			.setRequired(false)
			.setMaxLength(max);
		const value = answers?.[field] ?? null;
		if (value !== null && value.length <= max) input.setValue(value);
		modal.addLabelComponents(new LabelBuilder()
			.setLabel(truncate(RETRO_FIELD_TITLES[field], LABEL_MAX))
			.setDescription(FIELD_HINTS[field])
			.setTextInputComponent(input));
	}
	return modal;
}

/** Trả lời riêng sau khi lưu phiếu. */
export function retroSavedText(firstSubmit: boolean, xpAwarded: number): string
{
	const head = firstSubmit ? "✅ Đã lưu câu trả lời retro (ẩn danh)." : "✅ Đã cập nhật câu trả lời retro (ẩn danh).";
	const xp = xpAwarded > 0 ? ` +${formatNumber(xpAwarded)} XP.` : "";
	return `${head}${xp} Bạn có thể bấm lại nút để sửa tới khi phiên đóng.`;
}

// ---------- Bảng tổng hợp ----------

/**
 * Chia `budget` ký tự cho các cột: cột ngắn lấy đủ, phần dư chia đều cho cột dài hơn. Trả về ngân sách của từng cột (cùng thứ
 * tự với `needs`).
 */
export function shareBudget(needs: readonly number[], budget: number): number[]
{
	const shares = needs.map(() => 0);
	let remaining = Math.max(0, budget);
	const order = needs.map((need, index) => ({ need, index })).sort((a, b) => a.need - b.need);
	order.forEach(({ need, index }, position) =>
	{
		const fair = Math.floor(remaining / (order.length - position));
		shares[index] = Math.min(need, fair);
		remaining -= shares[index];
	});
	return shares;
}

function columnHeading(field: RetroField, count: number): string
{
	return `**${RETRO_FIELD_TITLES[field]}** (${formatNumber(count)})`;
}

/**
 * Bảng tổng hợp ẩn danh khi đóng phiên (Components V2): gom theo 5 cột, mỗi ý một dòng; cắt gọn để tổng chữ không vượt 4000 ký tự
 * (phần bị cắt ghi "… và N ý khác"). Có link tài liệu thì ghi "xem đầy đủ" ở cuối.
 */
export function retroSummaryMessage(session: RetroSession, columns: RetroColumns): RetroComponentsPayload
{
	const header = `## 📋 Tổng hợp retro: ${retroTitle(session)}\n-# Ẩn danh · ${formatNumber(session.participants)} người đã điền`;
	const footer = session.docUrl === null ? null : `📄 Xem đầy đủ trên Confluence: <${session.docUrl}>`;
	const filled = RETRO_FIELDS.filter(field => columns[field].length > 0);
	const container = new ContainerBuilder().setAccentColor(COLORS.success).addTextDisplayComponents(new TextDisplayBuilder().setContent(header));

	if (filled.length === 0)
	{
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent("Chưa có ai điền retro."));
	}
	else
	{
		const blocks = filled.map(field => ({ field, heading: columnHeading(field, columns[field].length), lines: columns[field].map(text => `• ${oneLine(text, IDEA_DISPLAY_MAX)}`) }));
		const fixed = header.length + (footer?.length ?? 0) + blocks.reduce((sum, block) => sum + block.heading.length + 1, 0);
		const needs = blocks.map(block => block.lines.join("\n").length);
		const shares = shareBudget(needs, RETRO_TEXT_MAX - fixed - 20);
		blocks.forEach((block, index) =>
		{
			const body = fitLines(block.lines, shares[index], hidden => `… và ${formatNumber(hidden)} ý khác`);
			container.addSeparatorComponents(separator());
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body.length > 0 ? `${block.heading}\n${body}` : block.heading));
		});
	}
	if (footer !== null) container.addSeparatorComponents(separator()).addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));
	return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: NO_MENTIONS };
}

// ---------- Vote tên sprint, nhắc, trạng thái ----------

/** Thông báo tên sprint được chọn (không nêu người đề xuất, vì bảng retro ẩn danh). */
export function retroWinnerText(session: RetroSession, name: string, proposers: number, xpEach: number): string
{
	const head = `🏆 Tên sprint được chọn cho retro **${retroTitle(session)}**: **${oneLine(name, RETRO_LIMITS.sprintNameMax)}**`;
	const xp = xpEach > 0 && proposers > 0 ? `\nNgười đề xuất tên này được cộng ${formatNumber(xpEach)} XP. Cảm ơn mọi người đã tham gia!` : "\nCảm ơn mọi người đã tham gia!";
	return `${head}${xp}`;
}

/** Thông báo vote hoà: người quản lý chọn tên cuối cùng. */
export function retroTieText(session: RetroSession, names: readonly string[]): string
{
	const list = fitLines(names.map(name => `**${oneLine(name, RETRO_LIMITS.sprintNameMax)}**`), NAME_LIST_MAX, hidden => `và ${hidden} tên khác`, { separator: ", " });
	return `⚖️ Vote tên sprint của retro **${retroTitle(session)}** hoà giữa: ${list}.\n`
		+ "Người quản lý phiên chọn tên cuối cùng bằng `/retro pick` (hoặc trên trang Retro của web quản trị).";
}

/** Tin nhắc điền retro; có role team thì nhắc role đó (người gửi đặt allowedMentions chỉ cho đúng role này). */
export function retroReminderText(session: RetroSession): string
{
	const who = session.teamRoleId === null ? "Mọi người" : roleMention(session.teamRoleId);
	const deadline = session.closesAt === null ? "" : ` Hạn: ${relativeTime(session.closesAt)}.`;
	const where = session.messageId === null ? "ở tin của phiên" : `ở tin của phiên: ${messageLink(session.channelId, session.messageId, session.guildId)}`;
	return `⏰ ${who} ơi, nhớ điền retro **${retroTitle(session)}** nhé! Đã có **${formatNumber(session.participants)}** người điền.${deadline}\n`
		+ `Ai chưa điền thì bấm nút **📝 Điền retro** ${where}`;
}

/** Tình trạng ghi Confluence của phiên, một dòng. `docEnabled` = bot đã cấu hình ghi Confluence. */
export function retroDocStatusLine(session: RetroSession, docEnabled: boolean): string
{
	if (session.docUrl === null) return "Confluence: phiên chưa gắn link tài liệu.";
	if (!docEnabled) return "Confluence: bot chưa bật ghi Confluence (CONFLUENCE_BASE_URL, CONFLUENCE_TOKEN), chỉ lưu link.";
	if (session.confluenceError !== null) return `Confluence: ❌ lần ghi gần nhất lỗi: ${plainText(session.confluenceError)}`;
	return session.confluenceWrittenAt === null ? "Confluence: chưa ghi." : `Confluence: ✅ đã ghi ${relativeTime(session.confluenceWrittenAt)}.`;
}

/** Người xem `/retro status` thấy thêm những gì. */
export interface RetroStatusAudience
{
	/** Người quản lý phiên: thấy thêm tình trạng Confluence và nội dung đã xoá hay chưa. */
	manager: boolean;
	/** Danh sách người đã điền, chỉ cho admin bot (DEC-049: ghi tên cho admin theo dõi); null thì không hiện tên. */
	participants: readonly string[] | null;
}

export const PARTICIPANTS_ADMIN_ONLY = "-# Danh sách người đã điền chỉ admin bot xem được (`/retro status` của admin, hoặc trang Retro của web quản trị).";

/** Trả lời riêng của `/retro status`: trạng thái, kênh, số người đã điền; thêm phần theo `audience`. */
export function retroStatusText(session: RetroSession, audience: RetroStatusAudience, docEnabled: boolean): string
{
	const { participants } = audience;
	const lines = [
		`**🔁 Retro #${session.id}: ${retroTitle(session)}**`,
		`Trạng thái: ${retroStatusLabel(session)}`,
		`Kênh: ${channelMention(session.channelId)}`,
		deadlineLine(session),
		`✍️ Đã điền: **${formatNumber(session.participants)}** người`,
	].filter((line): line is string => line !== null);
	if (participants !== null)
	{
		lines.push(participants.length === 0
			? "Người đã điền: chưa có ai."
			: `Người đã điền: ${fitLines(participants.map(userMention), PARTICIPANT_LIST_MAX, hidden => `và ${hidden} người khác`, { separator: ", " })}`);
	}
	else if (audience.manager)
	{
		lines.push(PARTICIPANTS_ADMIN_ONLY);
	}
	if (audience.manager || participants !== null)
	{
		lines.push(retroDocStatusLine(session, docEnabled));
		if (session.contentDeletedAt !== null) lines.push("🗑️ Nội dung phiên đã bị xoá.");
	}
	return lines.join("\n");
}
