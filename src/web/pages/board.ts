// Trang "Bảng vàng" của web quản trị (DEC-030, DEC-039): đặt kênh hoặc tắt Bảng vàng. Cùng quy tắc với `/config board` và
// trang Bảng vàng của `/config panel` (panelSetBoard): kênh lấy từ cache của server và phải đúng loại, người thao tác và bot
// phải đủ quyền ở kênh (assertBoardChannelAccess), rồi dùng chung moveLiveBoard / turnOffLiveBoard.
import { CategoryChannel, ChannelType, Guild } from "discord.js";
import { assertBoardChannelAccess, BoardChannel, botMemberOf, isBoardChannel, moveLiveBoard, turnOffLiveBoard } from "../../discord/configOps";
import { channelMention } from "../../discord/format";
import { LiveBoard } from "../../modules/live-board/LiveBoardService";
import { UserError } from "../../shared/errors";
import { channelLabel } from "../format";
import { html, RawHtml } from "../html";
import { WebResponse } from "../http";
import { csrfField, guildUrl, redirectWithFlash, renderPage } from "../layout";
import { GuildPageContext, PageModule } from "../types";

const PATH = "/board";
const OFF_PATH = "/board/off";
const CHANNEL_FIELD = "channelId";
const DRAWN_FIELD = "d:channelId";
const SNOWFLAKE = /^\d{17,20}$/u;

export const BOARD_STALE_FORM = "Form đã cũ hoặc không hợp lệ, nên bot chưa làm gì. Hãy tải lại trang rồi thử lại.";
export const BOARD_SELECT_CHANNEL = "Hãy chọn kênh đặt Bảng vàng.";
export const BOARD_CHANNEL_NOT_FOUND = "Không tìm thấy kênh vừa chọn: kênh có thể đã bị xoá, hoặc bot không có quyền **View Channel** ở kênh đó. "
	+ "Hãy tải lại trang rồi chọn lại.";
export const BOARD_CHANGED_ELSEWHERE = "Bảng vàng vừa được đổi ở nơi khác sau khi bạn mở trang, nên bot chưa làm gì. "
	+ "Hãy tải lại trang, kiểm tra rồi thao tác lại.";

interface ChannelGroup
{
	/** null = kênh không thuộc category nào (Discord xếp trên cùng). */
	category: CategoryChannel | null;
	channels: BoardChannel[];
}

function byPosition(a: { rawPosition: number; id: string }, b: { rawPosition: number; id: string }): number
{
	return a.rawPosition - b.rawPosition || a.id.localeCompare(b.id);
}

/** Kênh đặt được Bảng vàng, nhóm theo category và sắp theo vị trí như danh sách kênh của Discord. */
function boardChannelGroups(guild: Guild): ChannelGroup[]
{
	const loose: BoardChannel[] = [];
	const byCategory = new Map<string, ChannelGroup & { category: CategoryChannel }>();
	for (const channel of guild.channels.cache.values())
	{
		if (!isBoardChannel(channel)) continue;
		const parent = channel.parentId === null ? undefined : guild.channels.cache.get(channel.parentId);
		if (parent?.type !== ChannelType.GuildCategory)
		{
			loose.push(channel);
			continue;
		}
		const group = byCategory.get(parent.id);
		if (group) group.channels.push(channel);
		else byCategory.set(parent.id, { category: parent, channels: [channel] });
	}
	const groups: ChannelGroup[] = [...byCategory.values()].sort((a, b) => byPosition(a.category, b.category));
	if (loose.length > 0) groups.unshift({ category: null, channels: loose });
	for (const group of groups) group.channels.sort(byPosition);
	return groups;
}

function channelOptions(guild: Guild, selectedId: string | null): { options: RawHtml; count: number }
{
	const groups = boardChannelGroups(guild);
	const option = (channel: BoardChannel): RawHtml =>
		html`<option value="${channel.id}"${channel.id === selectedId ? html` selected` : ""}>${channelLabel(guild, channel.id)}</option>`;
	const hasSelected = groups.some(group => group.channels.some(channel => channel.id === selectedId));
	const options = html`${hasSelected ? "" : html`<option value="" selected>— Chọn kênh —</option>`}
${groups.map(group => group.category === null
		? group.channels.map(option)
		: html`<optgroup label="${group.category.name}">${group.channels.map(option)}</optgroup>`)}`;
	return { options, count: groups.reduce((total, group) => total + group.channels.length, 0) };
}

function statusCard(guild: Guild, board: LiveBoard | null): RawHtml
{
	if (board === null)
	{
		return html`<section class="card"><h2>Trạng thái</h2><p><span class="badge off">Đang tắt</span> Chọn kênh bên dưới để bật Bảng vàng.</p></section>`;
	}
	const missing = !guild.channels.cache.has(board.channelId);
	return html`<section class="card"><h2>Trạng thái</h2>
<p><span class="badge ok">Đang bật</span> ở <strong>${channelLabel(guild, board.channelId)}</strong>. Bot giữ một message bảng xếp hạng ở đó và tự cập nhật định kỳ.</p>
${missing ? html`<div class="warn-box">⚠️ Bot không còn thấy kênh này (đã bị xoá hoặc bot mất quyền xem). Hãy chọn kênh khác hoặc tắt Bảng vàng.</div>` : ""}
${!missing && board.messageId === null ? html`<p class="muted">Chưa có message bảng xếp hạng ở kênh này; bot sẽ đăng ở lần cập nhật định kỳ tiếp theo.</p>` : ""}
</section>`;
}

function renderBoard(ctx: GuildPageContext): WebResponse
{
	const board = ctx.deps.services.liveBoards.get(ctx.guild.id);
	const current = board?.channelId ?? null;
	const { options, count } = channelOptions(ctx.guild, current);
	const offForm = board === null ? "" : html`<section class="card"><h2>Tắt Bảng vàng</h2>
<form method="post" action="${guildUrl(ctx, OFF_PATH)}" class="actions">${csrfField(ctx)}
<button class="btn btn-danger" type="submit">Tắt Bảng vàng</button>
<span class="muted">Bot ngừng cập nhật và xoá message bảng xếp hạng ở kênh hiện tại.</span></form></section>`;
	const body = html`${statusCard(ctx.guild, board)}
<section class="card"><h2>${board === null ? "Bật Bảng vàng" : "Đổi kênh"}</h2>
<form method="post" action="${guildUrl(ctx, PATH)}">${csrfField(ctx)}
<div class="field bd-field"><label for="bd-channel">Kênh Bảng vàng</label>
<select id="bd-channel" name="${CHANNEL_FIELD}" required>${options}</select>
<input type="hidden" name="${DRAWN_FIELD}" value="${current ?? ""}">
<span class="hint">Kênh chữ hoặc kênh thông báo. Chọn lại đúng kênh đang đặt rồi bấm nút để bot đăng lại bảng (ví dụ khi message cũ bị xoá).</span>
${count === 0 ? html`<div class="warn-box">Bot không thấy kênh chữ hay kênh thông báo nào. Hãy cấp quyền View Channel cho bot ở kênh muốn dùng.</div>` : ""}
</div>
<div class="actions"><button class="btn btn-primary" type="submit">Đặt Bảng vàng</button></div>
</form></section>
${offForm}
<section class="card bd-notes"><h2>Ghi chú</h2><ul>
<li>Bot cần quyền <strong>View Channel</strong>, <strong>Send Messages</strong>, <strong>Attach Files</strong> ở kênh Bảng vàng.</li>
<li>Bạn cũng phải tự xem và gửi tin được ở kênh đó: bot không đăng hộ vào kênh bạn không được gửi tin.</li>
<li>Bot đăng một message gồm 3 ảnh bảng xếp hạng và tự cập nhật khoảng 10 phút một lần. Đổi kênh thì bot xoá message ở kênh cũ.</li>
</ul></section>`;
	return renderPage(ctx, {
		nav: "board",
		title: "Bảng vàng",
		lead: "Bảng xếp hạng bot tự đăng và cập nhật trong một kênh của server. Mọi thay đổi được ghi vào nhật ký quản trị.",
		body,
	});
}

async function setBoard(ctx: GuildPageContext): Promise<WebResponse>
{
	const form = ctx.req.form ?? new URLSearchParams();
	const channelId = form.get(CHANNEL_FIELD) ?? "";
	const drawn = form.get(DRAWN_FIELD);
	if (drawn === null || (drawn !== "" && !SNOWFLAKE.test(drawn))) throw new UserError(BOARD_STALE_FORM);
	if (channelId === "") throw new UserError(BOARD_SELECT_CHANNEL);
	const channel = ctx.guild.channels.cache.get(channelId);
	if (!channel) throw new UserError(BOARD_CHANNEL_NOT_FOUND);
	if (!isBoardChannel(channel))
	{
		throw new UserError(`Bảng vàng chỉ đặt được ở kênh chữ hoặc kênh thông báo; ${channelMention(channel.id)} không phải loại kênh này.`);
	}
	const { client, services, liveBoardActions } = ctx.deps;
	const current = services.liveBoards.get(ctx.guild.id)?.channelId ?? "";
	if (channel.id === drawn && current !== drawn) throw new UserError(BOARD_CHANGED_ELSEWHERE);
	assertBoardChannelAccess(channel, ctx.member, botMemberOf(ctx.guild));

	const text = await moveLiveBoard(client, services, liveBoardActions, ctx.guild.id, channel.id, ctx.actorId);
	return redirectWithFlash(ctx, PATH, "ok", text);
}

async function turnOffBoard(ctx: GuildPageContext): Promise<WebResponse>
{
	const { client, services, liveBoardActions } = ctx.deps;
	const text = await turnOffLiveBoard(client, services, liveBoardActions, ctx.guild.id, ctx.actorId);
	return redirectWithFlash(ctx, PATH, "ok", text);
}

export const boardPage: PageModule = {
	routes: [
		{ method: "GET", path: PATH, handler: renderBoard },
		{ method: "POST", path: PATH, handler: setBoard },
		{ method: "POST", path: OFF_PATH, handler: turnOffBoard },
	],
	css: `
.bd-field select { min-width: 280px; }
.bd-notes ul { margin: 0; padding-left: 20px; }
.bd-notes li + li { margin-top: 6px; }
`,
};
