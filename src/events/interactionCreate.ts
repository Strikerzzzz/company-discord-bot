import Event from "../classes/Event";
import { Events, Interaction, InteractionReplyOptions, MessageFlags } from "discord.js";
import { assertAdmin, checkAdmin } from "../discord/guards";
import { UserError } from "../shared/errors";
import { logger } from "../shared/logger";

// Discord chỉ nhận tối đa 25 lựa chọn cho một autocomplete.
const MAX_AUTOCOMPLETE_CHOICES = 25;
const GENERIC_ERROR = "Đã có lỗi xảy ra khi xử lý yêu cầu. Vui lòng thử lại sau.";
export const GUILD_NOT_SERVED = "Bot không hoạt động ở server này.";
export const UNKNOWN_INTERACTION = "Lệnh này không còn tồn tại hoặc vừa được cập nhật. Vui lòng thử lại.";

export default class InteractionCreate extends Event
{
	name = Events.InteractionCreate;

	// Error boundary cho mọi interaction: lỗi trong command chỉ ảnh hưởng tới interaction đó, không làm sập bot.
	async execute(interaction: Interaction): Promise<void>
	{
		try
		{
			await this.dispatch(interaction);
		}
		catch (error)
		{
			if (error instanceof UserError)
			{
				logger.debug(`Từ chối interaction ${describe(interaction)}: ${error.message}`);
				await replyWith(interaction, error.message);
			}
			else
			{
				logger.error(`Lỗi khi xử lý interaction ${describe(interaction)}:`, error);
				await replyWith(interaction, GENERIC_ERROR);
			}
		}
	}

	private async dispatch(interaction: Interaction): Promise<void>
	{
		// Chỉ phục vụ các server đã cấu hình (DISCORD_GUILD_IDS); bot bị mời vào server lạ thì không xử lý gì.
		if (interaction.guildId !== null && !this.client.guildIds.includes(interaction.guildId))
		{
			logger.debug(`Bỏ qua interaction ${describe(interaction)} từ guild ngoài danh sách "${interaction.guildId}".`);
			await rejectWith(interaction, GUILD_NOT_SERVED);
			return;
		}

		if (interaction.isChatInputCommand())
		{
			const command = this.client.interactions.commands.get(interaction.commandName);
			if (!command)
			{
				await rejectWith(interaction, UNKNOWN_INTERACTION);
				return;
			}

			// Kiểm tra quyền tập trung (lớp 2, PROP-013).
			if (command.adminOnly) assertAdmin(interaction, this.client.services);
			await command.execute(interaction);
		}
		else if (interaction.isButton())
		{
			const command = this.client.buttons.resolve(interaction.customId);
			if (!command)
			{
				await rejectWith(interaction, UNKNOWN_INTERACTION);
				return;
			}

			await command.executeButton(interaction);
		}
		else if (interaction.isContextMenuCommand())
		{
			const contextMenu = this.client.interactions.contextMenus.get(interaction.commandName);
			if (!contextMenu)
			{
				await rejectWith(interaction, UNKNOWN_INTERACTION);
				return;
			}

			await contextMenu.execute(interaction);
		}
		else if (interaction.isAutocomplete())
		{
			const command = this.client.interactions.commands.get(interaction.commandName);
			// Không gợi ý dữ liệu của lệnh không còn tồn tại, hay của lệnh admin cho người không có quyền.
			if (!command || (command.adminOnly && !checkAdmin(interaction, this.client.services)))
			{
				await interaction.respond([]);
				return;
			}
			const choices = command.autocomplete(interaction).slice(0, MAX_AUTOCOMPLETE_CHOICES);
			await interaction.respond(choices.map(choice => ({ name: choice, value: choice })));
		}
	}
}

function describe(interaction: Interaction): string
{
	if (interaction.isCommand() || interaction.isAutocomplete()) return `"${interaction.commandName}"`;
	if (interaction.isMessageComponent()) return `"${interaction.customId}"`;
	return `type ${interaction.type}`;
}

/** Từ chối một interaction không xử lý được: trả lời riêng nếu reply được, autocomplete thì trả danh sách rỗng. */
async function rejectWith(interaction: Interaction, content: string): Promise<void>
{
	if (interaction.isAutocomplete())
	{
		await interaction.respond([]);
		return;
	}
	if (interaction.isRepliable()) await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function replyWith(interaction: Interaction, content: string): Promise<void>
{
	// Autocomplete không reply được, chỉ ghi log.
	if (!interaction.isRepliable()) return;

	const payload: InteractionReplyOptions = { content, flags: MessageFlags.Ephemeral };

	try
	{
		if (!interaction.deferred && !interaction.replied)
		{
			await interaction.reply(payload);
		}
		else if (interaction.isCommand() && interaction.deferred && !interaction.replied)
		{
			// Lệnh đã defer nhưng chưa trả lời: thông báo lỗi thay cho "đang suy nghĩ...".
			if (interaction.ephemeral)
			{
				await interaction.editReply({ content, embeds: [], components: [] });
			}
			else
			{
				// Defer công khai: không để lỗi hiện công khai; xoá "đang suy nghĩ..." rồi báo lỗi riêng.
				await interaction.deleteReply().catch((deleteError: unknown) =>
					logger.warn("Không xoá được phản hồi đang chờ của interaction:", deleteError));
				await interaction.followUp(payload);
			}
		}
		else
		{
			await interaction.followUp(payload);
		}
	}
	catch (replyError)
	{
		logger.error("Không gửi được thông báo lỗi cho người dùng:", replyError);
	}
}
