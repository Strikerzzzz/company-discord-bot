// Hiển thị dữ liệu Discord trên web (DEC-039): tên kênh/role thay cho ID, chuyển phần markdown/mention kiểu Discord trong
// thông báo của service và configOps sang HTML (sau khi đã escape).
import { ChannelType, Guild, GuildMember, PermissionFlagsBits, Role } from "discord.js";
import { auditTargetKind, formatAuditDetails } from "../discord/views/admin";
import { AuditAction } from "../modules/audit/AuditService";
import { escapeHtml, html, raw, RawHtml } from "./html";

/** Tên thay cho kênh mà người xem không có quyền xem (như "No access" của Discord): không lộ tên kênh riêng tư. */
export const PRIVATE_CHANNEL_LABEL = "#kênh-riêng-tư";

/** Người xem (admin đang đăng nhập) có xem được kênh không; không truyền người xem thì coi như xem được. */
export function canViewChannel(guild: Guild, channelId: string, viewer: GuildMember | undefined): boolean
{
	if (!viewer) return true;
	const channel = guild.channels.cache.get(channelId);
	if (!channel) return true;
	return channel.permissionsFor(viewer)?.has(PermissionFlagsBits.ViewChannel) ?? false;
}

/**
 * "#tên-kênh", ghi rõ kênh không còn (bot không thấy) kèm ID, hoặc PRIVATE_CHANNEL_LABEL nếu `viewer` không xem được kênh
 * (review bảo mật Phase 16: web không được lộ tên kênh mà Discord giấu với chính người đó).
 */
export function channelLabel(guild: Guild, channelId: string, viewer?: GuildMember): string
{
	const channel = guild.channels.cache.get(channelId);
	if (!channel) return `#kênh-không-còn (${channelId})`;
	if (!canViewChannel(guild, channelId, viewer)) return PRIVATE_CHANNEL_LABEL;
	const prefix = channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice ? "🔊 " : "#";
	return `${prefix}${channel.name}`;
}

/** "@tên-role", hoặc ghi rõ role không còn kèm ID. */
export function roleLabel(guild: Guild, roleId: string): string
{
	const role = guild.roles.cache.get(roleId);
	return role ? `@${role.name}` : `@role-không-còn (${roleId})`;
}

/** Chip tên role (có chấm màu của role nếu có màu). */
export function roleChip(guild: Guild, roleId: string): RawHtml
{
	const role = guild.roles.cache.get(roleId);
	const missing = role === undefined;
	return html`<span class="chip${missing ? " chip-missing" : ""}">${roleLabel(guild, roleId)}</span>`;
}

/**
 * Role của server từ cao xuống thấp (như Server Settings → Roles), bỏ @everyone. Dùng `rawPosition` (getter `position` của
 * discord.js tự sắp lại mọi role mỗi lần gọi, tốn O(n log n)).
 */
export function sortedRoles(guild: Guild): Role[]
{
	return [...guild.roles.cache.values()]
		.filter(role => role.id !== guild.id)
		.sort((a, b) => b.rawPosition - a.rawPosition || a.id.localeCompare(b.id));
}

/** Tên thành viên nếu có trong cache, không thì "người dùng <ID>". */
export function userLabel(guild: Guild, userId: string): string
{
	const member = guild.members.cache.get(userId);
	return member ? `@${member.displayName}` : `người dùng ${userId}`;
}

/** Tên đối tượng của một mục audit (kênh, role, người) theo loại hành động; ID khác trả nguyên văn; null nếu không có. */
export function auditTargetLabel(guild: Guild, action: AuditAction, targetId: string | null, viewer?: GuildMember): string | null
{
	if (targetId === null) return null;
	switch (auditTargetKind(action))
	{
	case "user": return userLabel(guild, targetId);
	case "role": return roleLabel(guild, targetId);
	case "channel": return channelLabel(guild, targetId, viewer);
	case "none": return targetId;
	}
}

/**
 * Chi tiết của một mục audit dạng HTML; null nếu không có. formatAuditDetails escape markdown kiểu Discord (chèn `\` trước
 * `_`, `*`...) cho tin nhắn Discord; trên web bỏ các dấu đó để hiện đúng chữ gốc ("a_b"), rồi discordText vẫn escape HTML toàn bộ.
 */
export function auditDetailsHtml(guild: Guild, action: AuditAction, details: Record<string, unknown> | null, viewer?: GuildMember): RawHtml | null
{
	const text = formatAuditDetails(details, action);
	return text === null ? null : discordText(guild, text.replace(/\\([\\*_`~|])/gu, "$1"), viewer);
}

/** Ký tự đánh dấu chỗ đặt mention trong lúc xử lý markdown (vùng dùng riêng của Unicode, đã bị loại khỏi chữ đầu vào). */
const SLOT = "";
const SLOT_PATTERN = new RegExp(`${SLOT}(\\d+)${SLOT}`, "gu");

/** Bỏ ký tự điều khiển (trừ tab và xuống dòng) và ký tự đánh dấu SLOT khỏi chữ đầu vào. */
function cleanInput(text: string): string
{
	return [...text].filter(char =>
	{
		const code = char.codePointAt(0) ?? 0;
		return char !== SLOT && (code >= 32 || code === 9 || code === 10) && code !== 127;
	}).join("");
}

/**
 * Chuyển chuỗi kiểu Discord (thông báo của service, UserError, configOps) sang HTML an toàn: bỏ ký tự điều khiển, escape toàn
 * bộ; mention `<#id>`, `<@&id>`, `<@id>` được thay bằng chỗ đánh dấu trước khi xử lý `**đậm**` và `` `mã` ``, rồi mới điền tên
 * (tên có dấu `*` hay backtick không làm lồng thẻ sai); dòng bắt đầu bằng `-# ` thành chữ nhỏ; xuống dòng thành <br>.
 * `viewer` (nếu có) để giấu tên kênh người đó không xem được.
 */
export function discordText(guild: Guild, text: string, viewer?: GuildMember): RawHtml
{
	const lines = escapeHtml(cleanInput(text)).split("\n").map(line =>
	{
		const small = line.startsWith("-# ");
		const mentions: string[] = [];
		const slot = (label: string): string =>
		{
			mentions.push(`<span class="mention">${escapeHtml(label)}</span>`);
			return `${SLOT}${mentions.length - 1}${SLOT}`;
		};
		const out = (small ? line.slice(3) : line)
			.replace(/&lt;#(\d{17,20})&gt;/gu, (_, id: string) => slot(channelLabel(guild, id, viewer)))
			.replace(/&lt;@&amp;(\d{17,20})&gt;/gu, (_, id: string) => slot(roleLabel(guild, id)))
			.replace(/&lt;@!?(\d{17,20})&gt;/gu, (_, id: string) => slot(userLabel(guild, id)))
			.replace(/\*\*(.+?)\*\*/gu, "<strong>$1</strong>")
			.replace(/`([^`]+)`/gu, "<code>$1</code>")
			.replace(SLOT_PATTERN, (_, index: string) => mentions[Number(index)] ?? "");
		return small ? `<small class="muted">${out}</small>` : out;
	});
	return raw(lines.join("<br>"));
}
