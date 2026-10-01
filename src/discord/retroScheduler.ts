import DiscordClient from "../classes/DiscordClient";
import { RetroSession } from "../modules/retro/types";
import { logger } from "../shared/logger";
import { postRetroSummary, publishRetroClosed, retroContext, settleRetroVote, SUMMARY_RETRY_WINDOW_MS } from "./retroOps";

/** Kết quả một lượt quét retro. */
export interface RetroSweepResult
{
	/** Số phiên vừa tự đóng vì hết hạn. */
	closed: number;
	/** Số phiên có vote tên sprint vừa được chốt hoặc ghi nhận hoà. */
	settled: number;
	/** Số bảng tổng hợp vừa đăng bù (đóng rồi mà chưa đăng được: bot khởi động lại, Discord lỗi). */
	summaries: number;
}

/** Đăng bù bảng tổng hợp lỗi thì đợi ít nhất chừng này rồi mới thử lại phiên đó. */
export const SUMMARY_RETRY_DELAY_MS = 5 * 60 * 1000;

/** Lần thử đăng bù tiếp theo của từng phiên (theo bộ service, để test mỗi thế giới riêng), trong bộ nhớ. */
const nextSummaryTry = new WeakMap<object, Map<string, number>>();

function retryTimes(client: DiscordClient): Map<string, number>
{
	let times = nextSummaryTry.get(client.services.retro);
	if (!times)
	{
		times = new Map();
		nextSummaryTry.set(client.services.retro, times);
	}
	return times;
}

/**
 * Đăng bù bảng tổng hợp của các phiên đã đóng trong 24 giờ qua mà chưa đăng được (RetroService.pendingSummaries), trừ các phiên vừa
 * đóng ở lượt này. Lỗi thì đợi SUMMARY_RETRY_DELAY_MS mới thử lại phiên đó. Trả về số bảng đã đăng.
 */
async function retrySummaries(client: DiscordClient, skip: ReadonlySet<number>): Promise<number>
{
	const ctx = retroContext(client);
	const now = ctx.services.clock.now();
	let pending: RetroSession[] = [];
	try
	{
		pending = ctx.services.retro.pendingSummaries(now - SUMMARY_RETRY_WINDOW_MS);
	}
	catch (error)
	{
		logger.error("Không đọc được các phiên retro chờ đăng bảng tổng hợp:", error);
	}
	const times = retryTimes(client);
	let posted = 0;
	for (const session of pending)
	{
		const key = `${session.guildId}:${session.id}`;
		if (skip.has(session.id) || (times.get(key) ?? 0) > now) continue;
		try
		{
			const result = await postRetroSummary(ctx, session);
			if (result.ok)
			{
				times.delete(key);
				posted++;
				logger.info(`Đã đăng bù bảng tổng hợp của phiên retro #${session.id}.`);
			}
			else
			{
				times.set(key, now + SUMMARY_RETRY_DELAY_MS);
				logger.warn(`Chưa đăng bù được bảng tổng hợp của phiên retro #${session.id} (${result.reason}); thử lại sau.`);
			}
		}
		catch (error)
		{
			times.set(key, now + SUMMARY_RETRY_DELAY_MS);
			logger.error(`Lỗi khi đăng bù bảng tổng hợp của phiên retro #${session.id}:`, error);
		}
	}
	return posted;
}

/**
 * Một lượt (DEC-049): đóng các phiên retro quá hạn (tắt nút, đăng bảng tổng hợp, ghi Confluence), đăng bù bảng tổng hợp của phiên đã đóng
 * mà chưa đăng được, rồi chốt các vote tên sprint đã đóng mà chưa chốt (ví dụ bot khởi động lại đúng lúc vote đóng). Lỗi của một phiên
 * không chặn phiên khác.
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

	const summaries = await retrySummaries(client, new Set(closed.map(session => session.id)));

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
	return { closed: closed.length, settled, summaries };
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
