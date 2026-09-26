import { MessageEditOptions } from "discord.js";
import type DiscordClient from "../classes/DiscordClient";
import { Contribution } from "../modules/contribution/types";
import { logger } from "../shared/logger";
import { contributionMessage } from "./views/contribution";

/** Vị trí message công khai bot đã đăng (null nếu chưa lưu được). */
export interface PostedMessage
{
	channelId: string | null;
	messageId: string | null;
}

/**
 * Sửa một message công khai bot đã đăng. Không ném lỗi (kể cả khi dựng nội dung lỗi): message có thể đã bị xoá
 * hoặc bot mất quyền, khi đó chỉ ghi log. `label` dùng trong log (ví dụ "vote #5"). Trả về true nếu đã sửa được.
 */
export async function editPostedMessage(
	client: DiscordClient,
	posted: PostedMessage,
	render: () => MessageEditOptions,
	label: string,
): Promise<boolean>
{
	if (posted.channelId === null || posted.messageId === null) return false;

	try
	{
		const payload = render();
		const channel = await client.channels.fetch(posted.channelId);
		if (!channel?.isTextBased())
		{
			logger.warn(`Không cập nhật được message của ${label}: channel "${posted.channelId}" không còn hoặc không phải kênh văn bản.`);
			return false;
		}
		await channel.messages.edit(posted.messageId, payload);
		return true;
	}
	catch (error)
	{
		logger.warn(`Không cập nhật được message của ${label}:`, error);
		return false;
	}
}

/** Cập nhật message công khai của contribution theo trạng thái hiện tại (ví dụ sau khi bị gỡ: bỏ nút, ghi "Đã bị gỡ"). */
export function refreshContributionMessage(client: DiscordClient, contribution: Contribution): Promise<boolean>
{
	return editPostedMessage(client, contribution, () => contributionMessage(contribution), `contribution #${contribution.id}`);
}
