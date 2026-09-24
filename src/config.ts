// Cấu hình đọc từ biến môi trường (DEC-015). Khi chạy bằng npm script, file .env được nạp qua `node --env-file`.
// Không bao giờ đưa giá trị token vào log hay thông báo lỗi.

export interface BotConfig
{
	token: string;
	guildIds: string[];
}

// Discord snowflake: chuỗi số 17–20 chữ số.
const SNOWFLAKE = /^\d{17,20}$/;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig
{
	const token = requireEnv(env, "DISCORD_TOKEN");

	const guildIds = requireEnv(env, "DISCORD_GUILD_IDS")
		.split(",")
		.map(id => id.trim())
		.filter(id => id.length > 0);
	const invalidIds = guildIds.filter(id => !SNOWFLAKE.test(id));
	if (guildIds.length === 0 || invalidIds.length > 0)
	{
		throw new Error(`DISCORD_GUILD_IDS không hợp lệ: ${invalidIds.join(", ") || "(rỗng)"}. Cần danh sách guild ID cách nhau bằng dấu phẩy.`);
	}

	return { token, guildIds };
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string
{
	const value = env[name]?.trim();
	if (!value) throw new Error(`Thiếu biến môi trường ${name}. Xem .env.example.`);
	return value;
}
