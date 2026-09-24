import DiscordClient from "./DiscordClient";

export default class ProcessManager
{
	readonly client: DiscordClient;

	constructor(client: DiscordClient)
	{
		this.client = client;

		// This will allow a graceful restart/reload/stop of the process.
		process.on("SIGINT", () => this.shutdown("SIGINT"));

		// The same thing but for Windows because it can't receive the other messages
		if (process.platform === "win32")
		{
			process.on("message", (msg) =>
			{
				if (msg === "shutdown") this.shutdown("SHUTDOWN");
			});
		}
	}

	// destroy() trả về Promise: đợi đóng kết nối Discord xong (hoặc lỗi) rồi mới thoát.
	private shutdown(signal: string): void
	{
		console.log(`RECEIVED A '${signal}' SIGNAL - SHUTTING DOWN`);
		void this.client.destroy().finally(() => process.exit());
	}
}
