import DiscordClient from "./classes/DiscordClient";
import Sqlite from "./classes/Sqlite";
import { token } from "./config.json";

// Lưới an toàn cuối cùng: lỗi async không có ai bắt thì chỉ ghi log, không để process thoát (LL-001).
process.on("unhandledRejection", (reason) =>
{
	console.error("Unhandled promise rejection:", reason);
});

async function main(): Promise<void>
{
	const client = new DiscordClient();
	new Sqlite();
	await client.login(token);
}

main().catch((error: unknown) =>
{
	console.error("Không khởi động được bot:", error);
	process.exit(1);
});
