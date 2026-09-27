import { errorText } from "./selfcheck/checks";
import { oneLine, redactSecrets, runSelfCheck } from "./selfcheck/run";

/**
 * Entry point của `npm run selfcheck` (DEC-034): kiểm tra môi trường trước khi bật bot. Không kết nối Discord,
 * không gọi mạng, không sửa database, không in token. Exit code 1 nếu có bước ❌.
 */
async function main(): Promise<void>
{
	const report = await runSelfCheck({
		env: process.env,
		nodeVersion: process.versions.node,
		platform: process.platform,
		arch: process.arch,
		cwd: process.cwd(),
		uid: process.getuid?.(),
		write: line => console.log(line),
	});
	process.exitCode = report.exitCode;
}

main().catch((error: unknown) =>
{
	console.error(`❌ Selfcheck dừng giữa chừng vì lỗi không lường trước: ${oneLine(redactSecrets(errorText(error), process.env))}`);
	process.exitCode = 1;
});
