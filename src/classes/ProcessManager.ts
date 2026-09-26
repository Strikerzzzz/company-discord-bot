import { logger } from "../shared/logger";

export type ShutdownHook = () => unknown;

/**
 * Tắt bot có kiểm soát: chạy lần lượt các hook (dừng lịch, đóng kết nối Discord, đóng database) rồi thoát.
 * SIGINT (Ctrl+C, pm2), SIGTERM (systemd) và message "shutdown" (pm2 trên Windows).
 */
export default class ProcessManager
{
	private shuttingDown = false;

	constructor(private readonly hooks: readonly ShutdownHook[])
	{
		process.on("SIGINT", () => this.shutdown("SIGINT"));
		process.on("SIGTERM", () => this.shutdown("SIGTERM"));

		if (process.platform === "win32")
		{
			process.on("message", (msg) =>
			{
				if (msg === "shutdown") this.shutdown("SHUTDOWN");
			});
		}
	}

	private shutdown(signal: string): void
	{
		if (this.shuttingDown) return;
		this.shuttingDown = true;
		logger.info(`Nhận tín hiệu ${signal}, đang tắt bot...`);
		void this.runHooks().finally(() => process.exit(0));
	}

	private async runHooks(): Promise<void>
	{
		for (const hook of this.hooks)
		{
			try
			{
				await hook();
			}
			catch (error)
			{
				logger.error("Lỗi khi tắt bot:", error);
			}
		}
	}
}
