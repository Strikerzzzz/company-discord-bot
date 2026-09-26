// Cấu hình pm2 (tuỳ chọn). Production khuyến nghị dùng systemd: xem deploy/company-discord-bot.service.
module.exports =
{
	apps :
	[{
		name: "company-discord-bot",
		script: "./build/index.js",
		node_args: "--env-file-if-exists=.env",
		shutdown_with_message: true,
		kill_timeout: 10000,
		ignore_watch: ["src", "data", "logs", "node_modules", ".vscode", ".github", ".git"],
		log_date_format: "DD-MM-YYYY HH:mm Z",
		error_file: "./logs/error.log",
		out_file: "./logs/output.log",
	}],
};
