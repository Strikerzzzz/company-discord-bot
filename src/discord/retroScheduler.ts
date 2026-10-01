import DiscordClient from "../classes/DiscordClient";
import { RetroSession } from "../modules/retro/types";
import { logger } from "../shared/logger";
import { publishRetroClosed, retroContext, settleRetroVote } from "./retroOps";

/** Kết quả một lượt quét retro. */
export interface RetroSweepResult
{
	/** Số phiên vừa tự đóng vì hết hạn. */
	closed: number;
	/** Số phiên có vote tên sprint vừa được chốt hoặc ghi nhận hoà. */
	settled: number;
}

/**
 * Một lượt (DEC-049): đóng các phiên retro quá hạn (tắt nút, đăng bảng tổng hợp, ghi Confluence), rồi chốt các vote tên sprint đã
 * đóng mà chưa chốt (ví dụ bot khởi động lại đúng lúc vote đóng). Lỗi của một phiên không chặn phiên khác.
 */
export async function runRetroSweep(client: DiscordClient): Promise<RetroSweepResult>
{
	const ctx = retroContext(client);
	let closed: RetroSession[] = [];
	try
	{
		closed = ctx.services.retro.closeDue();
	}
	catch (error)
	{
		logger.error("Không đóng được các phiên retro quá hạn:", error);
	}
	for (const session of closed)
	{
		try
		{
			for (const note of await publishRetroClosed(ctx, session)) logger.warn(`Phiên retro #${session.id} (tự đóng): ${note}`);
		}
		catch (error)
		{
			logger.error(`Lỗi khi đăng kết quả phiên retro #${session.id} vừa tự đóng:`, error);
		}
	}
	if (closed.length > 0) logger.info(`Đã tự đóng ${closed.length} phiên retro quá hạn.`);

	let pending: RetroSession[] = [];
	try
	{
		pending = ctx.services.retro.pendingVoteResults();
	}
	catch (error)
	{
		logger.error("Không đọc được các vote tên sprint chờ chốt:", error);
	}
	let settled = 0;
	for (const session of pending)
	{
		try
		{
			const { outcome, notes } = await settleRetroVote(ctx, session.guildId, session.id);
			if (outcome.kind !== "unchanged") settled++;
			for (const note of notes) logger.warn(`Phiên retro #${session.id}: ${note}`);
		}
		catch (error)
		{
			logger.error(`Không chốt được vote tên sprint của phiên retro #${session.id}:`, error);
		}
	}
	return { closed: closed.length, settled };
}

/** Định kỳ quét retro. Không chạy chồng lượt; timer không giữ process sống. Trả về hàm dừng lịch. */
export function startRetroScheduler(client: DiscordClient, intervalMs = 30_000): () => void
{
	let running = false;

	const timer = setInterval(() =>
	{
		if (running) return;
		running = true;
		runRetroSweep(client)
			.finally(() =>
			{
				running = false;
			})
			.catch((error: unknown) => logger.error("Lỗi trong lịch quét retro:", error));
	}, intervalMs);
	timer.unref();

	return () => clearInterval(timer);
}
