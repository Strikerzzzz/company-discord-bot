import { Interaction, PermissionFlagsBits } from "discord.js";
import { canCreatePoll, isAdmin, MemberAccess } from "../modules/guild-config/permissions";
import { AppServices } from "../services";
import { UserError } from "../shared/errors";
import { roleIdsOf } from "./members";

/** Guild ID của interaction; UserError nếu lệnh được dùng ngoài server. */
export function requireGuildId(interaction: Interaction): string
{
	if (!interaction.inGuild()) throw new UserError("Lệnh này chỉ dùng được trong server.");
	return interaction.guildId;
}

export function memberAccess(interaction: Interaction): MemberAccess
{
	return {
		hasManageGuild: interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false,
		roleIds: roleIdsOf(interaction.member),
	};
}

export function checkAdmin(interaction: Interaction, services: AppServices): boolean
{
	if (!interaction.inGuild()) return false;
	return isAdmin(memberAccess(interaction), services.guildConfig.getSettings(interaction.guildId));
}

/** Lớp kiểm tra quyền thứ hai (PROP-013). */
export function assertAdmin(interaction: Interaction, services: AppServices): void
{
	requireGuildId(interaction);
	if (!checkAdmin(interaction, services)) throw new UserError("Bạn không có quyền dùng lệnh này.");
}

export function checkCanCreatePoll(interaction: Interaction, services: AppServices): boolean
{
	if (!interaction.inGuild()) return false;
	return canCreatePoll(memberAccess(interaction), services.guildConfig.getSettings(interaction.guildId));
}
