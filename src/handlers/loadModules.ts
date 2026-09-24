import { existsSync, readdirSync } from "fs";
import { join } from "path";
import type DiscordClient from "../classes/DiscordClient";

// Chỉ nạp file code; bỏ qua .d.ts, .map và các file lạ có thể lọt vào thư mục.
const MODULE_FILE = /^(?!.*\.d\.ts$).*\.(js|ts)$/;

type ModuleClass<T> = abstract new (client: DiscordClient) => T;

/**
 * Nạp mọi file trong `directory`; mỗi file phải `export default` một class kế thừa `baseClass`.
 * File sai cấu trúc làm khởi động thất bại ngay, thay vì lỗi âm thầm lúc có người dùng gọi.
 */
export function loadModules<T>(directory: string, baseClass: ModuleClass<T>, client: DiscordClient): T[]
{
	if (!existsSync(directory)) return [];

	return readdirSync(directory)
		.filter(file => MODULE_FILE.test(file))
		.map(file =>
		{
			// eslint-disable-next-line @typescript-eslint/no-require-imports -- nạp động theo thư mục là cơ chế của loader
			const exported: unknown = require(join(directory, file));
			const moduleClass: unknown = typeof exported === "object" && exported !== null && "default" in exported
				? exported.default
				: exported;

			if (typeof moduleClass !== "function" || !(moduleClass.prototype instanceof baseClass))
			{
				throw new Error(`"${file}" phải export default một class kế thừa ${baseClass.name}.`);
			}

			// Đã kiểm tra ở trên: moduleClass là subclass (không abstract) của baseClass.
			return new (moduleClass as new (client: DiscordClient) => T)(client);
		});
}
