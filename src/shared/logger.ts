import { inspect } from "util";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Che các chuỗi nhạy cảm có thể lọt vào log: bot token và URL interaction/webhook có chứa token.
const REDACTIONS: [RegExp, string][] = [
	[/[\w-]{23,28}\.[\w-]{6}\.[\w-]{27,}/g, "[REDACTED_TOKEN]"],
	[/(\/(?:interactions|webhooks)\/\d+\/)[\w.-]+/g, "$1[REDACTED]"],
];

export function redact(text: string): string
{
	return REDACTIONS.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), text);
}

function parseLevel(value: string | undefined): LogLevel
{
	return value === "debug" || value === "warn" || value === "error" ? value : "info";
}

let minLevel = parseLevel(process.env.LOG_LEVEL);

function format(value: unknown): string
{
	if (typeof value === "string") return value;
	// Lỗi REST của discord.js mang theo requestBody (nội dung embed/tin nhắn gửi đi): không đưa vào log.
	if (value instanceof Error && "requestBody" in value)
	{
		const { requestBody: _omitted, ...rest } = value as Error & Record<string, unknown>;
		return `${value.stack ?? `${value.name}: ${value.message}`} ${inspect(rest, { depth: 2, breakLength: Infinity })}`;
	}
	return inspect(value, { depth: 4, breakLength: Infinity });
}

function write(level: LogLevel, message: string, details: unknown[]): void
{
	if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

	const line = redact([`${new Date().toISOString()} [${level.toUpperCase()}]`, message, ...details.map(format)].join(" "));
	if (level === "warn" || level === "error") console.error(line);
	else console.log(line);
}

export const logger = {
	debug: (message: string, ...details: unknown[]): void => write("debug", message, details),
	info: (message: string, ...details: unknown[]): void => write("info", message, details),
	warn: (message: string, ...details: unknown[]): void => write("warn", message, details),
	error: (message: string, ...details: unknown[]): void => write("error", message, details),
	setLevel: (level: LogLevel): void =>
	{
		minLevel = level;
	},
};
