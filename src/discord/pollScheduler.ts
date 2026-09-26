import DiscordClient from "../classes/DiscordClient";
import { Poll } from "../modules/poll/types";
import { logger } from "../shared/logger";
import { pollMessage } from "./views/poll";

/**
 * Cập nhật message gốc của vote theo trạng thái hiện tại (dùng sau khi vote bị đóng).
 * Không ném lỗi: message có thể đã bị xoá hoặc bot mất quyền; chỉ ghi log. Trả về true nếu đã sửa được.
 */
export async function refreshPollMessage(client: DiscordClient, poll: Poll): Promise<boolean>
{
	if (poll.channelId === null || poll.messageId === null) return false;

	try
	{
		const channel = await client.channels.fetch(poll.channelId);
		if (!channel?.isTextBased())
		{
			logger.warn(`Không cập nhật được message của vote #${poll.id}: channel "${poll.channelId}" không còn hoặc không phải kênh văn bản.`);
			return false;
		}
		await channel.messages.edit(poll.messageId, pollMessage(poll));
		return true;
	}
	catch (error)
	{
		logger.warn(`Không cập nhật được message của vote #${poll.id}:`, error);
		return false;
	}
}

/** Một lượt: đóng mọi vote quá hạn rồi cập nhật message của từng vote. Trả về số vote vừa đóng. */
export async function runPollSweep(client: DiscordClient): Promise<number>
{
	let closed: Poll[];
	try
	{
		closed = client.services.polls.closeDue();
	}
	catch (error)
	{
		logger.error("Không đóng được các vote quá hạn:", error);
		return 0;
	}

	for (const poll of closed) await refreshPollMessage(client, poll);
	if (closed.length > 0) logger.info(`Đã tự đóng ${closed.length} vote quá hạn.`);
	return closed.length;
}

/** Định kỳ đóng vote quá hạn. Không chạy chồng lượt; timer không giữ process sống. Trả về hàm dừng lịch. */
export function startPollScheduler(client: DiscordClient, intervalMs = 30_000): () => void
{
	let running = false;

	const timer = setInterval(() =>
	{
		if (running) return;
		running = true;
		runPollSweep(client)
			.finally(() =>
			{
				running = false;
			})
			.catch((error: unknown) => logger.error("Lỗi trong lịch tự đóng vote:", error));
	}, intervalMs);
	timer.unref();

	return () => clearInterval(timer);
}
