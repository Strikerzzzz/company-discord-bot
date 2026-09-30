// Trang "Sao lưu" của web quản trị (DEC-041, DEC-017): như `/admin backup`, tạo bản sao lưu thủ công qua adminOps (tối đa một
// bản mỗi 10 phút, audit "backup.manual") và xem danh sách bản thủ công, bản tự động. Web chỉ hiện tên file: không có đường
// dẫn tải, vì file database chứa dữ liệu của mọi thành viên (chép ra ngoài server theo docs/DEPLOY.md mục 6).
import { existsSync } from "node:fs";
import { assertManualBackupAllowed, createManualBackup } from "../../discord/adminOps";
import { formatNumber } from "../../discord/format";
import { BackupKind, BackupService } from "../../db/backup";
import { UserError } from "../../shared/errors";
import { html, RawHtml } from "../html";
import { WebResponse } from "../http";
import { csrfField, guildUrl, redirectWithFlash, renderPage } from "../layout";
import { GuildPageContext, PageModule } from "../types";
import { formatDateTime } from "../widgets";

const PATH = "/backup";
export const NO_BACKUPS = "Chưa có bản nào.";

/** Tên file sao lưu (`bot-<ISO>.db`, `bot-manual-<ISO>.db`, ISO đã thay `:` và `.` bằng `-`): lấy lại thời điểm UTC. */
const BACKUP_FILE_TIME = /^bot-(?:manual-)?(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.db$/u;
/** Mốc thời gian kiểu Discord (`<t:giây:R>`) trong thông báo của adminOps; web không hiện được nên đổi sang giờ Việt Nam. */
const DISCORD_TIMESTAMP = /<t:(\d{1,12})(?::[a-zA-Z])?>/gu;

/** Thời điểm tạo bản sao lưu đọc từ tên file; null nếu tên không đúng dạng. */
export function backupFileTime(fileName: string): number | null
{
	const match = BACKUP_FILE_TIME.exec(fileName);
	if (!match) return null;
	const [, date, hour, minute, second, ms] = match;
	const time = Date.parse(`${date}T${hour}:${minute}:${second}.${ms}Z`);
	return Number.isNaN(time) ? null : time;
}

/** Thay mốc thời gian kiểu Discord bằng "lúc <ngày giờ Việt Nam>". */
function webTimes(text: string): string
{
	return text.replace(DISCORD_TIMESTAMP, (_, seconds: string) => `lúc ${formatDateTime(Number(seconds) * 1000)}`);
}

/** Bản sao lưu một loại, cũ nhất trước. Thư mục chưa có thì rỗng: BackupService.list tự tạo thư mục, trang GET không tạo gì. */
function listBackups(backup: BackupService, kind: BackupKind): string[]
{
	return existsSync(backup.directory) ? backup.list(kind) : [];
}

function backupRow(fileName: string): RawHtml
{
	const time = backupFileTime(fileName);
	return html`<tr><td class="bk-time">${time === null ? html`<span class="muted">—</span>` : formatDateTime(time)}</td><td><code>${fileName}</code></td></tr>`;
}

function backupTable(title: string, files: readonly string[], hint: string): RawHtml
{
	const newestFirst = [...files].reverse();
	const content = newestFirst.length === 0
		? html`<p class="muted">${NO_BACKUPS}</p>`
		: html`<table class="table bk-table"><thead><tr><th>Thời điểm (giờ Việt Nam)</th><th>Tên file</th></tr></thead>
<tbody>${newestFirst.map(backupRow)}</tbody></table>`;
	return html`<section class="card"><h2>${title} (${formatNumber(files.length)})</h2><p class="muted bk-hint">${hint}</p>${content}</section>`;
}

function renderBackup(ctx: GuildPageContext): WebResponse
{
	const { backup } = ctx.deps.services;
	return renderPage(ctx, {
		nav: "backup",
		title: "Sao lưu",
		lead: "Như lệnh /admin backup: sao lưu database của bot ngay bây giờ và xem các bản đang giữ trên server.",
		body: html`<section class="card"><h2>Tạo bản sao lưu thủ công</h2>
<p>Bản thủ công xoay vòng riêng, không đẩy mất bản tự động hằng ngày. Mỗi 10 phút chỉ tạo được một bản.</p>
<form method="post" action="${guildUrl(ctx, PATH)}">${csrfField(ctx)}
<div class="actions"><button class="btn btn-primary" type="submit">💾 Tạo bản sao lưu ngay</button></div>
</form>
<div class="warn-box">Web không cho tải file database: file chứa dữ liệu của mọi thành viên. Chép bản sao ra ngoài server là việc của
người quản trị server (docs/DEPLOY.md mục 6).</div>
</section>
${backupTable("Bản thủ công", listBackups(backup, "manual"), "Do admin tạo bằng nút trên hoặc lệnh /admin backup. Mới nhất trước.")}
${backupTable("Bản tự động", listBackups(backup, "auto"), "Bot kiểm tra mỗi giờ và tạo một bản khi bản gần nhất đã cũ hơn 24 giờ. Mới nhất trước.")}
<p class="muted bk-dir">Mỗi loại giữ số bản mới nhất theo biến môi trường BACKUP_KEEP (mặc định 14). Thư mục trên server: <code>${backup.directory}</code></p>`,
	});
}

async function createBackup(ctx: GuildPageContext): Promise<WebResponse>
{
	const { services } = ctx.deps;
	try
	{
		assertManualBackupAllowed(services);
	}
	catch (error)
	{
		if (error instanceof UserError) throw new UserError(webTimes(error.message));
		throw error;
	}
	const text = await createManualBackup(services, ctx.guild.id, ctx.actorId);
	return redirectWithFlash(ctx, PATH, "ok", text);
}

export const backupPage: PageModule = {
	routes: [
		{ method: "GET", path: PATH, handler: renderBackup },
		{ method: "POST", path: PATH, handler: createBackup },
	],
	css: `
.bk-hint { margin: 0 0 10px; font-size: 14px; }
.bk-time { white-space: nowrap; }
.bk-table code { overflow-wrap: anywhere; }
.bk-dir { font-size: 13px; overflow-wrap: anywhere; }
`,
};
