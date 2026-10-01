import DiscordClient from "../classes/DiscordClient";
import { Poll } from "../modules/poll/types";
import { logger } from "../shared/logger";
import { editPostedMessage } from "./messages";
import { settleRetroPoll } from "./retroOps";
import { pollMessage } from "./views/poll";

/**
 * Cập nhật message gốc của vote theo trạng thái hiện tại (dùng sau khi vote bị đóng).
 * Không ném lỗi: message có thể đã bị xoá hoặc bot mất quyền; chỉ ghi log. Trả về true nếu đã sửa được.
 */
export function refreshPollMessage(client: DiscordClient, poll: Poll): Promise<boolean>
{
	return editPostedMessage(client, poll, () => pollMessage(poll), `vote #${poll.id}`);
}

/**
 * Việc cần làm sau khi một vote bị đóng (lệnh, web hay lịch tự đóng): sửa message của vote, rồi nếu là vote tên sprint của một phiên
 * retro thì chốt tên (DEC-049). Không ném lỗi. Trả về true nếu đã sửa được message của vote.
 */
export async function afterPollClosed(client: DiscordClient, poll: Poll): Promise<boolean>
{
	const refreshed = await refreshPollMessage(client, poll);
	await settleRetroPoll(client, poll);
	return refreshed;
}

/** Một lượt: đóng mọi vote quá hạn rồi cập nhật message của từng vote (và chốt vote tên sprint). Trả về số vote vừa đóng. */
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

	for (const poll of closed) await afterPollClosed(client, poll);
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
