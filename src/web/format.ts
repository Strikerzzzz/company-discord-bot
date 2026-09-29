// Hiển thị dữ liệu Discord trên web (DEC-039): tên kênh/role thay cho ID, chuyển phần markdown/mention kiểu Discord trong
// thông báo của service và configOps sang HTML (sau khi đã escape).
import { ChannelType, Guild, Role } from "discord.js";
import { escapeHtml, html, raw, RawHtml } from "./html";

/** "#tên-kênh", hoặc ghi rõ kênh không còn (bot không thấy) kèm ID. */
export function channelLabel(guild: Guild, channelId: string): string
{
	const channel = guild.channels.cache.get(channelId);
	if (!channel) return `#kênh-không-còn (${channelId})`;
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

/** Role của server từ cao xuống thấp (như Server Settings → Roles), bỏ @everyone. */
export function sortedRoles(guild: Guild): Role[]
{
	return [...guild.roles.cache.values()]
		.filter(role => role.id !== guild.id)
		.sort((a, b) => b.position - a.position || a.id.localeCompare(b.id));
}

/** Tên thành viên nếu có trong cache, không thì "người dùng <ID>". */
export function userLabel(guild: Guild, userId: string): string
{
	const member = guild.members.cache.get(userId);
	return member ? `@${member.displayName}` : `người dùng ${userId}`;
}

/**
 * Chuyển chuỗi kiểu Discord (thông báo của service, UserError, configOps) sang HTML an toàn: escape toàn bộ trước, rồi đổi
 * mention `<#id>`, `<@&id>`, `<@id>` sang tên; `**đậm**`, `` `mã` ``; dòng bắt đầu bằng `-# ` thành chữ nhỏ; xuống dòng thành <br>.
 */
export function discordText(guild: Guild, text: string): RawHtml
{
	const lines = escapeHtml(text).split("\n").map(line =>
	{
		const small = line.startsWith("-# ");
		let out = small ? line.slice(3) : line;
		out = out
			.replace(/&lt;#(\d{17,20})&gt;/gu, (_, id: string) => `<span class="mention">${escapeHtml(channelLabel(guild, id))}</span>`)
			.replace(/&lt;@&amp;(\d{17,20})&gt;/gu, (_, id: string) => `<span class="mention">${escapeHtml(roleLabel(guild, id))}</span>`)
			.replace(/&lt;@!?(\d{17,20})&gt;/gu, (_, id: string) => `<span class="mention">${escapeHtml(userLabel(guild, id))}</span>`)
			.replace(/\*\*(.+?)\*\*/gu, "<strong>$1</strong>")
			.replace(/`([^`]+)`/gu, "<code>$1</code>");
		return small ? `<small class="muted">${out}</small>` : out;
	});
	return raw(lines.join("<br>"));
}
