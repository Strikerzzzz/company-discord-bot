import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction } from "discord.js";
import Command from "../../classes/Command";

// Example slash command. Demonstrates button components.
export default class ClickMeCmd extends Command
{
	data = new SlashCommandBuilder()
		.setName("clickme")
		.setDescription("Sends some cool buttons.")
	override global = true;
	override buttonIds = ["clickMeButton", "dontClickMeButton"];

	async execute(interaction: ChatInputCommandInteraction): Promise<void>
	{
		const buttons = new ActionRowBuilder<ButtonBuilder>()
			.addComponents(
				new ButtonBuilder()
					.setCustomId("clickMeButton")
					.setLabel("Click Me")
					.setStyle(ButtonStyle.Primary),
				new ButtonBuilder()
					.setCustomId("dontClickMeButton")
					.setLabel("Don't Click Me")
					.setStyle(ButtonStyle.Danger),
			);

		await interaction.reply({ content: "I think you should...", components: [buttons] });
	}

	override async executeButton(interaction: ButtonInteraction): Promise<void>
	{
		if (interaction.customId === "clickMeButton")
		{
			await interaction.reply("Thank you for clicking me :)");
		}
		else
		{
			await interaction.reply("Why did you click me? :(");
		}
	}
}
