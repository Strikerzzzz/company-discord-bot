import { basename } from "path";
import { ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, SlashCommandSubcommandBuilder } from "discord.js";
import Command from "../../classes/Command";
import { formatNumber, userMention } from "../../discord/format";
import { requireGuildId } from "../../discord/guards";
import { roleIdsOf } from "../../discord/members";
import { buildAuditEmbed, buildStatsEmbed, buildXpDetailEmbed, ephemeral, ephemeralEmbed, inlineText } from "../../discord/views/admin";
import { AppServices } from "../../services";
import { UserError } from "../../shared/errors";

/** Chuỗi phải nhập đúng để reset toàn server. */
const RESET_CONFIRMATION = "XAC NHAN";
const MAX_ADJUST = 1_000_000;
const REASON_MAX_LENGTH = 200;
const RECENT_XP_EVENTS = 10;
const AUDIT_DEFAULT = 10;
const AUDIT_MAX = 25;
const TITLE_DISPLAY_MAX = 100;

interface AdminContext
{
	interaction: ChatInputCommandInteraction;
	guildId: string;
	actorId: string;
}

interface Target
{
	userId: string;
	roleIds: string[];
}

type SubcommandSetup = (sub: SlashCommandSubcommandBuilder) => SlashCommandSubcommandBuilder;

function addMember(sub: SlashCommandSubcommandBuilder, description: string): SlashCommandSubcommandBuilder
{
	return sub.addUserOption(option => option.setName("thanh-vien").setDescription(description).setRequired(true));
}

function addReason(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder
{
	return sub.addStringOption(option => option
		.setName("ly-do")
		.setDescription("Lý do (ghi vào nhật ký quản trị)")
		.setMaxLength(REASON_MAX_LENGTH));
}

/** Subcommand chỉ có option thành viên. */
function memberSubcommand(name: string, description: string, memberDescription: string): SubcommandSetup
{
	return sub => addMember(sub.setName(name).setDescription(description), memberDescription);
}

/** Subcommand cộng hoặc trừ XP: thành viên, số XP (luôn dương), lý do. */
function xpAdjustSubcommand(name: string, description: string, amountDescription: string): SubcommandSetup
{
	return sub =>
	{
		addMember(sub.setName(name).setDescription(description), "Thành viên được điều chỉnh XP");
		sub.addIntegerOption(option => option
			.setName("so-xp")
			.setDescription(amountDescription)
			.setMinValue(1)
			.setMaxValue(MAX_ADJUST)
			.setRequired(true));
		return addReason(sub);
	};
}

function contributionAdjustSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder
{
	addMember(sub.setName("adjust").setDescription("Cộng hoặc trừ điểm contribution của một thành viên"), "Thành viên được điều chỉnh điểm");
	sub.addIntegerOption(option => option
		.setName("diem")
		.setDescription("Số điểm: dương để cộng, âm để trừ, khác 0")
		.setMinValue(-MAX_ADJUST)
		.setMaxValue(MAX_ADJUST)
		.setRequired(true));
	return addReason(sub);
}

/** Subcommand reset toàn server, bắt nhập chuỗi xác nhận. */
function resetAllSubcommand(description: string): SubcommandSetup
{
	return sub => sub
		.setName("reset-all")
		.setDescription(description)
		.addStringOption(option => option
			.setName("xac-nhan")
			.setDescription(`Nhập chính xác ${RESET_CONFIRMATION} để xác nhận`)
			.setRequired(true));
}

/** Thành viên được thao tác và role hiện có của họ (snapshot team). Không cho thao tác với bot. */
function targetOf(interaction: ChatInputCommandInteraction): Target
{
	const user = interaction.options.getUser("thanh-vien", true);
	if (user.bot) throw new UserError("Không thể thao tác với bot.");
	return { userId: user.id, roleIds: roleIdsOf(interaction.options.getMember("thanh-vien")) };
}

function reasonOf(interaction: ChatInputCommandInteraction): string | null
{
	const reason = interaction.options.getString("ly-do")?.trim() ?? "";
	return reason.length > 0 ? reason : null;
}

function assertConfirmed(interaction: ChatInputCommandInteraction): void
{
	if (interaction.options.getString("xac-nhan", true).trim() !== RESET_CONFIRMATION)
	{
		throw new UserError(`Để reset toàn bộ, nhập chính xác: ${RESET_CONFIRMATION}`);
	}
}

// Lệnh quản trị điểm, thống kê, nhật ký và sao lưu. Hai lớp quyền: ManageGuild (Discord) + adminOnly (dispatcher).
export default class AdminCmd extends Command
{
	override adminOnly = true;

	data = new SlashCommandBuilder()
		.setName("admin")
		.setDescription("Quản trị điểm, thống kê, nhật ký và sao lưu của bot")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.addSubcommandGroup(group => group
			.setName("xp")
			.setDescription("Quản lý Activity XP của thành viên")
			.addSubcommand(memberSubcommand("view", "Xem level, XP, hạng và các biến động XP gần nhất của thành viên", "Thành viên cần xem"))
			.addSubcommand(xpAdjustSubcommand("give", "Cộng XP cho một thành viên", "Số XP cộng thêm (1 đến 1.000.000)"))
			.addSubcommand(xpAdjustSubcommand("remove", "Trừ XP của một thành viên", "Số XP trừ đi (1 đến 1.000.000)"))
			.addSubcommand(memberSubcommand("reset", "Reset toàn bộ XP của một thành viên", "Thành viên cần reset XP"))
			.addSubcommand(resetAllSubcommand("Reset XP của toàn bộ thành viên trong server")))
		.addSubcommandGroup(group => group
			.setName("contribution")
			.setDescription("Quản lý điểm contribution")
			.addSubcommand(contributionAdjustSubcommand)
			.addSubcommand(sub => sub
				.setName("remove")
				.setDescription("Gỡ một contribution và huỷ toàn bộ điểm của nó")
				.addIntegerOption(option => option.setName("id").setDescription("Mã số contribution").setMinValue(1).setRequired(true)))
			.addSubcommand(memberSubcommand("reset", "Reset toàn bộ điểm contribution của một thành viên", "Thành viên cần reset điểm"))
			.addSubcommand(resetAllSubcommand("Reset điểm contribution của toàn bộ thành viên trong server")))
		.addSubcommand(sub => sub
			.setName("stats")
			.setDescription("Xem thống kê hoạt động của server"))
		.addSubcommand(sub => sub
			.setName("audit")
			.setDescription("Xem nhật ký thao tác quản trị gần nhất")
			.addIntegerOption(option => option
				.setName("so-luong")
				.setDescription(`Số mục hiển thị (1 đến ${AUDIT_MAX}, mặc định ${AUDIT_DEFAULT})`)
				.setMinValue(1)
				.setMaxValue(AUDIT_MAX)))
		.addSubcommand(sub => sub
			.setName("backup")
			.setDescription("Sao lưu database ngay bây giờ"));

	private get services(): AppServices
	{
		return this.client.services;
	}

	async execute(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const context: AdminContext = { interaction, guildId: requireGuildId(interaction), actorId: interaction.user.id };
		const group = interaction.options.getSubcommandGroup();
		const subcommand = interaction.options.getSubcommand();

		if (group === "xp") await this.executeXp(context, subcommand);
		else if (group === "contribution") await this.executeContribution(context, subcommand);
		else if (subcommand === "stats") await this.showStats(context);
		else if (subcommand === "audit") await this.showAudit(context);
		else if (subcommand === "backup") await this.backup(context);
		else throw new Error(`Subcommand không hợp lệ: /admin ${group ?? ""} ${subcommand}`);
	}

	private async executeXp(context: AdminContext, subcommand: string): Promise<void>
	{
		switch (subcommand)
		{
		case "view":
			await this.viewXp(context);
			break;
		case "give":
			await this.adjustXp(context, 1);
			break;
		case "remove":
			await this.adjustXp(context, -1);
			break;
		case "reset":
			await this.resetUserXp(context);
			break;
		case "reset-all":
			await this.resetAllXp(context);
			break;
		default:
			throw new Error(`Subcommand không hợp lệ: /admin xp ${subcommand}`);
		}
	}

	private async executeContribution(context: AdminContext, subcommand: string): Promise<void>
	{
		switch (subcommand)
		{
		case "adjust":
			await this.adjustContribution(context);
			break;
		case "remove":
			await this.removeContribution(context);
			break;
		case "reset":
			await this.resetUserContribution(context);
			break;
		case "reset-all":
			await this.resetAllContribution(context);
			break;
		default:
			throw new Error(`Subcommand không hợp lệ: /admin contribution ${subcommand}`);
		}
	}

	private async viewXp({ interaction, guildId }: AdminContext): Promise<void>
	{
		const { userId } = targetOf(interaction);
		const profile = this.services.activity.getProfile(guildId, userId);
		const events = this.services.activity.recentEvents(guildId, userId, RECENT_XP_EVENTS);
		await interaction.reply(ephemeralEmbed(buildXpDetailEmbed(profile, events)));
	}

	private async adjustXp({ interaction, guildId, actorId }: AdminContext, sign: 1 | -1): Promise<void>
	{
		const target = targetOf(interaction);
		const amount = interaction.options.getInteger("so-xp", true);
		const { totalXp } = this.services.activity.adjustXp({
			guildId,
			userId: target.userId,
			delta: sign * amount,
			actorId,
			reason: reasonOf(interaction),
			roleIds: target.roleIds,
		});
		const action = sign > 0
			? `Đã cộng ${formatNumber(amount)} XP cho ${userMention(target.userId)}`
			: `Đã trừ ${formatNumber(amount)} XP của ${userMention(target.userId)}`;
		await interaction.reply(ephemeral(`${action}. Tổng: ${formatNumber(totalXp)} XP.`));
	}

	private async resetUserXp({ interaction, guildId, actorId }: AdminContext): Promise<void>
	{
		const { userId } = targetOf(interaction);
		const { voidedEvents } = this.services.activity.resetUser(guildId, userId, actorId);
		await interaction.reply(ephemeral(`Đã reset XP của ${userMention(userId)} (huỷ ${formatNumber(voidedEvents)} biến động). Tổng: 0 XP.`));
	}

	private async resetAllXp({ interaction, guildId, actorId }: AdminContext): Promise<void>
	{
		assertConfirmed(interaction);
		const { voidedEvents, members } = this.services.activity.resetAll(guildId, actorId);
		await interaction.reply(ephemeral(
			`Đã reset XP toàn server: huỷ ${formatNumber(voidedEvents)} biến động của ${formatNumber(members)} thành viên.`,
		));
	}

	private async adjustContribution({ interaction, guildId, actorId }: AdminContext): Promise<void>
	{
		const target = targetOf(interaction);
		const delta = interaction.options.getInteger("diem", true);
		if (delta === 0) throw new UserError("Số điểm phải khác 0.");
		const { score } = this.services.contributions.adjust({
			guildId,
			userId: target.userId,
			delta,
			actorId,
			reason: reasonOf(interaction),
			roleIds: target.roleIds,
		});
		const action = delta > 0
			? `Đã cộng ${formatNumber(delta)} điểm contribution cho ${userMention(target.userId)}`
			: `Đã trừ ${formatNumber(-delta)} điểm contribution của ${userMention(target.userId)}`;
		await interaction.reply(ephemeral(`${action}. Tổng: ${formatNumber(score)} điểm.`));
	}

	private async removeContribution({ interaction, guildId, actorId }: AdminContext): Promise<void>
	{
		const id = interaction.options.getInteger("id", true);
		const removed = this.services.contributions.remove(guildId, id, actorId);
		await interaction.reply(ephemeral(
			`Đã gỡ contribution #${removed.id} "${inlineText(removed.title, TITLE_DISPLAY_MAX)}" của ${userMention(removed.authorId)}. Toàn bộ điểm của contribution này đã bị huỷ.`,
		));
	}

	private async resetUserContribution({ interaction, guildId, actorId }: AdminContext): Promise<void>
	{
		const { userId } = targetOf(interaction);
		const { voidedEvents } = this.services.contributions.resetUser(guildId, userId, actorId);
		await interaction.reply(ephemeral(
			`Đã reset điểm contribution của ${userMention(userId)} (huỷ ${formatNumber(voidedEvents)} biến động). Tổng: 0 điểm.`,
		));
	}

	private async resetAllContribution({ interaction, guildId, actorId }: AdminContext): Promise<void>
	{
		assertConfirmed(interaction);
		const { voidedEvents, members } = this.services.contributions.resetAll(guildId, actorId);
		await interaction.reply(ephemeral(
			`Đã reset điểm contribution toàn server: huỷ ${formatNumber(voidedEvents)} biến động của ${formatNumber(members)} thành viên.`,
		));
	}

	private async showStats({ interaction, guildId }: AdminContext): Promise<void>
	{
		await interaction.reply(ephemeralEmbed(buildStatsEmbed(this.services.statistics.summary(guildId))));
	}

	private async showAudit({ interaction, guildId }: AdminContext): Promise<void>
	{
		const limit = interaction.options.getInteger("so-luong") ?? AUDIT_DEFAULT;
		await interaction.reply(ephemeralEmbed(buildAuditEmbed(this.services.audit.list(guildId, limit))));
	}

	private async backup({ interaction, guildId, actorId }: AdminContext): Promise<void>
	{
		// Sao lưu có thể mất vài giây: defer trước để không quá hạn 3 giây của interaction.
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const file = basename(await this.services.backup.createBackup());
		this.services.audit.record(guildId, actorId, "backup.manual", null, { file });
		await interaction.editReply(`Đã sao lưu database: \`${file}\`.`);
	}
}
