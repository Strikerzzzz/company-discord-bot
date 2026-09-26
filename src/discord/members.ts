import { APIInteractionDataResolvedGuildMember, APIInteractionGuildMember, GuildMember } from "discord.js";

/** Danh sách role ID của một member, dù discord.js trả về GuildMember (có cache) hay dữ liệu API thô. */
export function roleIdsOf(member: GuildMember | APIInteractionGuildMember | APIInteractionDataResolvedGuildMember | null | undefined): string[]
{
	if (!member) return [];
	if (member instanceof GuildMember) return [...member.roles.cache.keys()];
	return [...member.roles];
}
