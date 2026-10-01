// Thao tác retro dùng chung cho lệnh `/retro`, lịch quét và trang web quản trị (DEC-041, DEC-049): tạo phiên, đóng, mở lại, gia hạn,
// đăng lại tin của phiên và bảng tổng hợp, tạo vote tên sprint, chốt/chọn tên, nhắc, ghi Confluence. Quy tắc nằm ở RetroService; ở đây
// chỉ nối thêm tác dụng phụ lên Discord (đăng/sửa tin của phiên, đăng bảng tổng hợp, thông báo) và Confluence qua RetroActions, để web
// và test thay được. Thông báo trả về dùng markdown/mention kiểu Discord (web chuyển sang HTML bằng discordText). Lỗi hiển thị cho người
// dùng là UserError.
import { ChannelType, GuildBasedChannel, GuildMember, PermissionFlagsBits, PermissionsBitField, RESTJSONErrorCodes } from "discord.js";
import type { Guild, MessageCreateOptions } from "discord.js";
import type DiscordClient from "../classes/DiscordClient";
import { ConfluenceError, RetroDocSection, RetroDocWriter } from "../integrations/confluence";
import { Poll } from "../modules/poll/types";
import { RETRO_NOT_FOUND } from "../modules/retro/RetroService";
import { CreateRetroInput, RetroSession, RetroVoteOutcome } from "../modules/retro/types";
import type { AppServices } from "../services";
import { UserError } from "../shared/errors";
import { logger } from "../shared/logger";
import { botMemberOf } from "./configOps";
import { channelMention, formatNumber, relativeTime, roleMention } from "./format";
import { discordErrorCode } from "./memberDirectory";
import { pollMessage } from "./views/poll";
import {
	NO_MENTIONS,
	RetroComponentsPayload,
	retroReminderText,
	retroSessionMessage,
	retroSummaryMessage,
	retroTieText,
	retroWinnerText,
} from "./views/retro";

/** Vị trí một tin bot vừa đăng. */
export interface PostedRef
{
	channelId: string;
	messageId: string;
}

/**
 * Vì sao không đăng hay sửa được một tin của phiên:
 * - "archived": thread đang lưu trữ (Discord lỗi 50083), phải mở lại thread;
 * - "missing": tin hoặc kênh không còn (đã bị xoá);
 * - "failed": lỗi khác (thiếu quyền, Discord lỗi, mạng), đã ghi log.
 */
export type RetroMessageFailure = "archived" | "missing" | "failed";

/** Kết quả sửa tin của phiên: "ok", "none" (phiên chưa có tin trên Discord), hoặc lý do thất bại. */
export type RetroRefreshResult = "ok" | "none" | RetroMessageFailure;

/** Kết quả đăng một tin: vị trí tin, hoặc lý do thất bại. */
export type RetroPostResult = ({ ok: true } & PostedRef) | { ok: false; reason: RetroMessageFailure };

/**
 * Tác dụng phụ lên Discord và Confluence của thao tác retro. Bot dùng createRetroActions (DiscordClient.retroActions); web nhận qua
 * `WebDeps.retroActions`; test thay bằng bản giả.
 */
export interface RetroActions
{
	/** Nơi ghi bảng retro lên Confluence; null = chưa cấu hình CONFLUENCE_* (bỏ bước ghi, retro vẫn chạy). */
	readonly docWriter: RetroDocWriter | null;
	/** Sửa tin của phiên theo trạng thái hiện tại (nút, số người, trạng thái). Không ném lỗi. */
	refreshSessionMessage(client: DiscordClient, session: RetroSession): Promise<RetroRefreshResult>;
	/** Đăng một tin vào kênh/thread `channelId`. Không ném lỗi (lỗi đã ghi log). */
	post(client: DiscordClient, channelId: string, payload: MessageCreateOptions): Promise<RetroPostResult>;
}

/** Phân loại lỗi Discord khi đăng/sửa tin của phiên. */
export function retroMessageFailure(error: unknown): RetroMessageFailure
{
	const code = discordErrorCode(error);
	if (code === RESTJSONErrorCodes.InvalidActionOnArchivedThread) return "archived";
	if (code === RESTJSONErrorCodes.UnknownMessage || code === RESTJSONErrorCodes.UnknownChannel) return "missing";
	return "failed";
}

/** Đăng tin bằng bot (cần View Channel và Send Messages / Send Messages in Threads ở kênh đó). */
async function postToChannel(client: DiscordClient, channelId: string, payload: MessageCreateOptions): Promise<RetroPostResult>
{
	try
	{
		const channel = await client.channels.fetch(channelId);
		if (!channel?.isSendable())
		{
			logger.warn(`Không đăng được tin retro: kênh "${channelId}" không còn hoặc không gửi tin được.`);
			return { ok: false, reason: "missing" };
		}
		const message = await channel.send(payload);
		return { ok: true, channelId: message.channelId, messageId: message.id };
	}
	catch (error)
	{
		logger.warn(`Không đăng được tin retro vào kênh "${channelId}":`, error);
		return { ok: false, reason: retroMessageFailure(error) };
	}
}

/** Sửa tin của phiên (có nút "📝 Điền retro") theo trạng thái hiện tại. */
async function editSessionMessage(client: DiscordClient, session: RetroSession): Promise<RetroRefreshResult>
{
	if (session.messageId === null) return "none";
	try
	{
		const channel = await client.channels.fetch(session.channelId);
		if (!channel?.isTextBased())
		{
			logger.warn(`Không cập nhật được tin của phiên retro #${session.id}: kênh "${session.channelId}" không còn.`);
			return "missing";
		}
		await channel.messages.edit(session.messageId, retroSessionMessage(session));
		return "ok";
	}
	catch (error)
	{
		logger.warn(`Không cập nhật được tin của phiên retro #${session.id}:`, error);
		return retroMessageFailure(error);
	}
}

export function createRetroActions(docWriter: RetroDocWriter | null): RetroActions
{
	return { docWriter, refreshSessionMessage: editSessionMessage, post: postToChannel };
}

/** Những gì một thao tác retro cần: client (Discord), service, tác dụng phụ. */
export interface RetroContext
{
	client: DiscordClient;
	services: AppServices;
	actions: RetroActions;
}

/** Context retro của bot (dùng actions gắn trên client). */
export function retroContext(client: DiscordClient): RetroContext
{
	return { client, services: client.services, actions: client.retroActions };
}

/** ID của bot, ghi làm người thao tác của event XP retro (DEC-049). Lỗi hệ thống nếu bot chưa đăng nhập. */
export function botActorId(client: DiscordClient): string
{
	const id = client.user?.id ?? client.application?.id ?? null;
	if (id === null) throw new Error("Bot chưa đăng nhập Discord nên chưa có ID để ghi XP retro.");
	return id;
}

const REPOST_HINT = "dùng `/retro repost` (hoặc nút “Đăng lại tin của phiên” trên trang Retro của web) để đăng lại";
const UNARCHIVE_HINT = "Hãy mở lại thread (Unarchive, hoặc gửi một tin trong thread) rồi thử lại.";

export const SESSION_MESSAGE_NOT_UPDATED = `⚠️ Bot không sửa được tin của phiên (thiếu quyền, hoặc Discord lỗi). Nếu tin đã mất, ${REPOST_HINT}.`;
export const SESSION_MESSAGE_MISSING = `⚠️ Tin của phiên (có nút 📝 Điền retro) đã bị xoá nên bot không cập nhật được: ${REPOST_HINT}.`;
export const SESSION_MESSAGE_ARCHIVED = `⚠️ Thread của phiên đang lưu trữ nên bot không sửa được tin của phiên. ${UNARCHIVE_HINT}`;
export const SESSION_MESSAGE_NONE = `ℹ️ Phiên chưa có tin trên Discord (có nút 📝 Điền retro): ${REPOST_HINT}.`;
export const SUMMARY_NOT_POSTED = "⚠️ Bot không đăng được bảng tổng hợp vào kênh của phiên (thiếu quyền xem hoặc gửi tin?). Bot tự thử lại trong "
	+ "24 giờ; hoặc dùng `/retro summary` (nút “Đăng lại bảng tổng hợp” trên web) sau khi sửa quyền.";
export const SUMMARY_ARCHIVED = "⚠️ Thread của phiên đang lưu trữ nên bot không đăng được bảng tổng hợp. Hãy mở lại thread (Unarchive, hoặc gửi "
	+ "một tin trong thread) rồi dùng `/retro summary` (nút “Đăng lại bảng tổng hợp” trên web); bot cũng tự thử lại trong 24 giờ.";
export const ANNOUNCEMENT_NOT_POSTED = "⚠️ Bot không đăng được thông báo vào kênh của phiên (thiếu quyền xem hoặc gửi tin?).";
export const ANNOUNCEMENT_ARCHIVED = "⚠️ Thread của phiên đang lưu trữ nên bot không đăng được thông báo. Hãy mở lại thread để mọi người thấy kết quả.";
export const VOTE_NOT_POSTED = "Bot không đăng được tin vote vào kênh của phiên (thiếu quyền xem, gửi tin hoặc Embed Links?), nên đã huỷ vote vừa "
	+ "tạo. Hãy cấp quyền cho bot ở kênh đó rồi thử lại.";
export const VOTE_ARCHIVED = `Thread của phiên đang lưu trữ nên bot không đăng được tin vote, đã huỷ vote vừa tạo. ${UNARCHIVE_HINT}`;
export const SESSION_NOT_POSTED = "Bot không đăng được tin của phiên (có nút 📝 Điền retro) vào kênh đã chọn (thiếu quyền xem hoặc gửi tin?), "
	+ "nên đã đóng phiên vừa tạo. Hãy cấp quyền cho bot ở kênh đó rồi tạo lại.";
export const REPOST_NOT_POSTED = "Bot không đăng được tin vào kênh của phiên (thiếu quyền xem, gửi tin, hoặc kênh không còn). Hãy cấp quyền cho bot ở "
	+ "kênh đó rồi thử lại.";
export const REPOST_ARCHIVED = `Thread của phiên đang lưu trữ nên bot không đăng được tin. ${UNARCHIVE_HINT}`;
export const DOC_WRITER_OFF_NOTE = "ℹ️ Đã lưu link tài liệu. Bot chưa bật ghi Confluence (CONFLUENCE_BASE_URL, CONFLUENCE_TOKEN) nên sẽ không ghi bảng vào trang.";
export const RETRO_CHANNEL_INVALID = "Phiên retro chỉ tạo được ở kênh văn bản, kênh thông báo hoặc thread đang hoạt động của server.";
export const RETRO_BOT_CANNOT_SEE = "Bot không xem được kênh hoặc thread này (với thread riêng tư: hãy thêm bot vào thread), nên không tạo phiên "
	+ "retro ở đây được.";
export const SUMMARY_WHILE_OPEN = "Phiên còn mở: bảng tổng hợp được đăng khi đóng phiên.";
/** Khoảng tối thiểu giữa hai lần nhắc của cùng một phiên (chống ping role team liên tục). */
export const REMIND_COOLDOWN_MS = 10 * 60 * 1000;
/** Khoảng tối thiểu giữa hai lần bấm "ghi lại vào Confluence" của cùng một phiên (lệnh hoặc web). */
export const DOC_WRITE_COOLDOWN_MS = 30 * 1000;
/** Bảng tổng hợp đăng lỗi thì lịch quét thử lại trong chừng này thời gian sau khi đóng. */
export const SUMMARY_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Ghi chú cho người quản lý khi không sửa được tin của phiên; null nếu không cần ghi chú. */
export function sessionMessageNote(result: RetroRefreshResult): string | null
{
	switch (result)
	{
	case "ok": return null;
	case "none": return SESSION_MESSAGE_NONE;
	case "archived": return SESSION_MESSAGE_ARCHIVED;
	case "missing": return SESSION_MESSAGE_MISSING;
	case "failed": return SESSION_MESSAGE_NOT_UPDATED;
	}
}

/** Thông báo theo lý do không đăng được: thread lưu trữ, hay lỗi khác. */
function failureText(reason: RetroMessageFailure, archived: string, other: string): string
{
	return reason === "archived" ? archived : other;
}

/**
 * Mốc thời gian theo phiên (lần nhắc gần nhất, lần ghi Confluence gần nhất), trong bộ nhớ. Tách theo bộ service (mỗi bot một bộ; test mỗi
 * thế giới một bộ) để không lẫn giữa các database.
 */
const cooldowns = new WeakMap<object, Map<string, number>>();

function cooldownMap(services: Pick<AppServices, "retro">): Map<string, number>
{
	let times = cooldowns.get(services.retro);
	if (!times)
	{
		times = new Map();
		cooldowns.set(services.retro, times);
	}
	return times;
}

function cooldownKey(kind: "remind" | "doc", guildId: string, sessionId: number): string
{
	return `${kind}:${guildId}:${sessionId}`;
}

/** Kết quả một lần ghi Confluence. */
export type RetroDocReport =
	| { status: "written" }
	| { status: "unchanged" }
	| { status: "skipped"; reason: string }
	| { status: "failed"; error: string };

/** Một dòng mô tả kết quả ghi Confluence cho người quản lý. */
export function retroDocReportLine(report: RetroDocReport): string
{
	switch (report.status)
	{
	case "written": return "📄 Đã ghi bảng retro vào Confluence.";
	case "unchanged": return "📄 Bảng retro trên Confluence đã đúng nội dung mới nhất, không cần ghi lại.";
	case "skipped": return `📄 Không ghi Confluence: ${report.reason}`;
	case "failed": return `❌ Ghi Confluence lỗi: ${report.error}`;
	}
}

/**
 * Dữ liệu khu vực retro của phiên trên Confluence: 5 cột ẩn danh (mỗi cột trộn riêng, không có người viết hay mã phiếu), tên sprint đã
 * chốt. Dùng chung cho lần ghi Confluence và phần "xuất chữ để dán" của trang web, để hai nơi luôn cùng nội dung.
 */
export function retroDocSection(services: Pick<AppServices, "retro">, session: RetroSession): RetroDocSection
{
	return {
		guildId: session.guildId,
		sessionId: session.id,
		title: session.title,
		columns: services.retro.columns(session.guildId, session.id),
		winnerName: session.winnerName,
	};
}

/** Lý do không ghi Confluence cho phiên này lúc này; null nếu ghi được. */
function docSkipReason(session: RetroSession, docWriter: RetroDocWriter | null): string | null
{
	if (session.docUrl === null) return "phiên chưa gắn link tài liệu.";
	if (docWriter === null) return "bot chưa bật ghi Confluence (CONFLUENCE_BASE_URL, CONFLUENCE_TOKEN).";
	if (session.contentDeletedAt !== null) return "nội dung phiên đã bị xoá.";
	if (session.status === "open") return "phiên còn mở: bảng chỉ ghi vào Confluence sau khi đóng, để không ai ghép người vừa điền với ý vừa thêm.";
	return null;
}

/**
 * Ghi (hoặc ghi lại) khu vực retro của phiên lên trang Confluence đã gắn, rồi lưu kết quả vào phiên (lỗi hiện trên web để thử lại).
 * Bỏ qua (không ghi, không đổi trạng thái) khi phiên không có link, chưa cấu hình Confluence, nội dung đã bị xoá, hoặc phiên còn mở.
 * `manual`: người quản lý bấm ghi lại (lệnh /retro write, web): mỗi phiên tối đa một lần trong DOC_WRITE_COOLDOWN_MS. Không ném lỗi
 * Confluence: lỗi được trả về trong báo cáo.
 */
export async function writeRetroDoc(ctx: RetroContext, guildId: string, sessionId: number, options: { manual?: boolean } = {}): Promise<RetroDocReport>
{
	const { services, actions } = ctx;
	const session = services.retro.get(guildId, sessionId);
	if (!session) throw new UserError(RETRO_NOT_FOUND);
	const skip = docSkipReason(session, actions.docWriter);
	if (skip !== null || actions.docWriter === null || session.docUrl === null) return { status: "skipped", reason: skip ?? "" };

	if (options.manual === true)
	{
		const writes = cooldownMap(services);
		const key = cooldownKey("doc", guildId, sessionId);
		const now = services.clock.now();
		const last = writes.get(key);
		if (last !== undefined && now - last < DOC_WRITE_COOLDOWN_MS)
		{
			const seconds = Math.ceil((last + DOC_WRITE_COOLDOWN_MS - now) / 1000);
			throw new UserError(`Vừa ghi Confluence cho phiên này. Hãy đợi khoảng ${seconds} giây rồi ghi lại.`);
		}
		writes.set(key, now);
	}

	let result: "written" | "unchanged";
	try
	{
		result = await actions.docWriter.writeRetroSection(session.docUrl, retroDocSection(services, session));
	}
	catch (error)
	{
		const message = error instanceof ConfluenceError ? error.message : "Lỗi không xác định khi ghi Confluence (xem log của bot).";
		if (!(error instanceof ConfluenceError)) logger.error(`Lỗi khi ghi Confluence cho phiên retro #${sessionId}:`, error);
		else logger.warn(`Ghi Confluence cho phiên retro #${sessionId} lỗi: ${message}`);
		services.retro.recordDocResult(guildId, sessionId, { ok: false, error: message });
		return { status: "failed", error: message };
	}
	services.retro.recordDocResult(guildId, sessionId, { ok: true });
	return { status: result };
}

/** Ghi chú kết quả ghi Confluence, trừ khi phiên không có link (khi đó không nhắc tới Confluence). */
function docNote(session: RetroSession, report: RetroDocReport): string[]
{
	return report.status === "skipped" && session.docUrl === null ? [] : [retroDocReportLine(report)];
}

/**
 * Đăng bảng tổng hợp ẩn danh của phiên (đã đóng) vào kênh của phiên; đăng được thì ghi nhận (summary_posted_at), để lịch quét không
 * đăng lại. Không ném lỗi Discord.
 */
export async function postRetroSummary(ctx: RetroContext, session: RetroSession): Promise<RetroPostResult>
{
	const { client, services, actions } = ctx;
	const summary = retroSummaryMessage(session, services.retro.columns(session.guildId, session.id));
	const posted = await actions.post(client, session.channelId, summary);
	if (posted.ok) services.retro.markSummaryPosted(session.guildId, session.id);
	return posted;
}

/**
 * Sau khi phiên vừa đóng (người quản lý hoặc hết hạn): tắt nút, đăng bảng tổng hợp ẩn danh, ghi Confluence. Trả về các dòng ghi chú.
 * Bảng đăng lỗi thì lịch quét thử lại (RetroService.pendingSummaries).
 */
export async function publishRetroClosed(ctx: RetroContext, session: RetroSession): Promise<string[]>
{
	const notes: string[] = [];
	const refreshed = sessionMessageNote(await ctx.actions.refreshSessionMessage(ctx.client, session));
	if (refreshed !== null) notes.push(refreshed);
	const posted = await postRetroSummary(ctx, session);
	if (!posted.ok) notes.push(failureText(posted.reason, SUMMARY_ARCHIVED, SUMMARY_NOT_POSTED));
	notes.push(...docNote(session, await writeRetroDoc(ctx, session.guildId, session.id)));
	return notes;
}

function withNotes(text: string, notes: readonly string[]): string
{
	return [text, ...notes].join("\n");
}

/** Loại kênh (không phải thread) tạo phiên retro được: kênh văn bản và kênh thông báo. */
const RETRO_TEXT_CHANNEL_TYPES: readonly ChannelType[] = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

/** Kênh tạo phiên retro được (DEC-049: kênh hoặc thread của team): kênh văn bản, kênh thông báo, hoặc thread chưa lưu trữ. */
export function isRetroChannel(channel: GuildBasedChannel): boolean
{
	if (channel.isThread()) return channel.archived !== true;
	return RETRO_TEXT_CHANNEL_TYPES.includes(channel.type);
}

/** Phần của kênh cần để tính quyền theo kênh (kênh trong cache của server). */
interface PermissionScope
{
	permissionsFor(member: GuildMember): Readonly<PermissionsBitField> | null;
}

/** Phần của kênh cần để tính quyền gửi tin. */
interface PostChannel extends PermissionScope
{
	isThread(): boolean;
}

/** `member` xem và gửi được tin ở kênh không (quyền theo kênh; trong thread là Send Messages in Threads). */
export function canPostInChannel(channel: PostChannel, member: GuildMember): boolean
{
	const send = channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
	return channel.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, send]) ?? false;
}

/** Kênh/thread của phiên, đủ để kiểm tra bot: ID, có phải thread không, loại kênh (thread riêng tư). */
export interface RetroBotChannel
{
	id: string;
	type: ChannelType;
	isThread(): boolean;
}

/** Quyền bot cần ở kênh/thread của phiên: xem kênh, gửi tin (thread: gửi tin trong thread), nhúng link (tin vote là embed). */
function retroBotPermissions(isThread: boolean): readonly (readonly [bigint, string])[]
{
	return [
		[PermissionFlagsBits.ViewChannel, "View Channel"],
		isThread ? [PermissionFlagsBits.SendMessagesInThreads, "Send Messages in Threads"] : [PermissionFlagsBits.SendMessages, "Send Messages"],
		[PermissionFlagsBits.EmbedLinks, "Embed Links"],
	];
}

/**
 * Kiểm tra bot dùng được kênh/thread của phiên retro (dùng chung `/retro create` và trang web): đủ quyền View Channel, Send Messages
 * (thread: Send Messages in Threads) và Embed Links (tin vote là embed); thread riêng tư thì bot phải là thành viên thread, không thì
 * báo cần thêm bot vào thread. `botPermissions`: quyền của bot ở kênh (interaction.appPermissions, hoặc permissionsFor của
 * guild.members.me); `isBotThreadMember` chỉ được gọi với thread riêng tư. UserError nêu đúng quyền thiếu.
 */
export async function assertBotCanUseRetroChannel(
	channel: RetroBotChannel,
	botPermissions: Readonly<PermissionsBitField> | null,
	isBotThreadMember: () => Promise<boolean>,
): Promise<void>
{
	const required = retroBotPermissions(channel.isThread());
	const missing = botPermissions === null ? required : required.filter(([flag]) => !botPermissions.has(flag));
	if (missing.length > 0)
	{
		throw new UserError(`Bot thiếu quyền ${missing.map(([, name]) => `**${name}**`).join(", ")} ở ${channelMention(channel.id)}. `
			+ "Hãy cấp quyền cho bot ở kênh đó rồi thử lại.");
	}
	if (channel.type === ChannelType.PrivateThread && !(await isBotThreadMember()))
	{
		throw new UserError(`Bot chưa là thành viên của thread riêng tư ${channelMention(channel.id)} nên không đăng hay sửa tin ở đó được. `
			+ "Hãy thêm bot vào thread (nhắc tên bot trong thread, hoặc mời bot vào) rồi thử lại.");
	}
}

/** `userId` có là thành viên của thread không (hỏi Discord; lỗi, kể cả 404, coi là không). Kênh không phải thread thì true. */
export async function threadHasMember(channel: GuildBasedChannel, userId: string): Promise<boolean>
{
	if (!channel.isThread()) return true;
	try
	{
		await channel.members.fetch({ member: userId });
		return true;
	}
	catch
	{
		return false;
	}
}

/** Bot dùng được kênh để đăng phiên retro không (assertBotCanUseRetroChannel, không ném lỗi). */
export async function botCanUseRetroChannel(channel: GuildBasedChannel, bot: GuildMember): Promise<boolean>
{
	const scope: PermissionScope = channel;
	try
	{
		await assertBotCanUseRetroChannel(channel, scope.permissionsFor(bot), () => threadHasMember(channel, bot.id));
		return true;
	}
	catch (error)
	{
		if (error instanceof UserError) return false;
		throw error;
	}
}

/**
 * Kênh để tạo phiên retro từ web, cùng điều kiện với `/retro create` gõ ngay trong kênh đó: kênh văn bản, kênh thông báo hoặc thread
 * đang hoạt động có trong server; người tạo phải tự xem và gửi được tin ở đó (tin của phiên được đăng thay người tạo, LL-013); bot phải
 * dùng được kênh (assertBotCanUseRetroChannel). UserError nếu không đạt.
 */
export async function resolveRetroChannel(guild: Guild, channelId: string, caller: GuildMember): Promise<GuildBasedChannel>
{
	const channel = guild.channels.cache.get(channelId);
	if (!channel || !isRetroChannel(channel)) throw new UserError(RETRO_CHANNEL_INVALID);
	if (!canPostInChannel(channel, caller))
	{
		throw new UserError(`Bạn không có quyền xem hoặc gửi tin nhắn ở ${channelMention(channel.id)}, nên không thể tạo phiên retro ở đó.`);
	}
	const bot = botMemberOf(guild);
	const scope: PermissionScope = channel;
	await assertBotCanUseRetroChannel(channel, scope.permissionsFor(bot), () => threadHasMember(channel, bot.id));
	return channel;
}

/**
 * Đăng tin của phiên vừa tạo: trả về ID tin (null nếu đã đăng mà không biết ID), ném lỗi nếu không đăng được. Lệnh trả lời chính
 * interaction; web nhờ bot gửi tin vào kênh (RetroActions.post).
 */
export type RetroSessionPublisher = (payload: RetroComponentsPayload) => Promise<string | null>;

/**
 * Tạo phiên retro (RetroService.create kiểm tra tiêu đề, link, team, hạn và "một kênh một phiên mở") rồi đăng tin có nút
 * "📝 Điền retro" vào kênh/thread của phiên bằng `publish` và lưu ID tin. Không đăng được thì đóng phiên vừa tạo, để kênh không bị giữ
 * bởi một phiên không ai bấm điền được, rồi ném lại lỗi. Người gọi đã kiểm tra quyền tạo phiên, quyền gửi tin của người tạo và quyền
 * của bot ở kênh. Trả về phiên (đã gắn tin) và các ghi chú cho người tạo.
 */
export async function createRetroSession(ctx: RetroContext, input: CreateRetroInput, publish: RetroSessionPublisher): Promise<{ session: RetroSession; notes: string[] }>
{
	const { services, actions } = ctx;
	const created = services.retro.create(input);
	let messageId: string | null;
	try
	{
		messageId = await publish(retroSessionMessage(created));
	}
	catch (error)
	{
		try
		{
			services.retro.close(created.guildId, created.id, input.createdBy);
		}
		catch (closeError)
		{
			logger.warn(`Không đóng được phiên retro #${created.id} sau khi đăng tin thất bại:`, closeError);
		}
		throw error;
	}
	const notes: string[] = [];
	if (messageId !== null)
	{
		services.retro.attachMessage(created.guildId, created.id, messageId);
	}
	else
	{
		logger.warn(`Không lấy được message của phiên retro #${created.id}; tin sẽ không được cập nhật số người và trạng thái.`);
		notes.push(SESSION_MESSAGE_NONE);
	}
	if (created.docUrl !== null && actions.docWriter === null) notes.push(DOC_WRITER_OFF_NOTE);
	return { session: services.retro.get(created.guildId, created.id) ?? created, notes };
}

/** Người quản lý đóng phiên (lệnh hoặc web). */
export async function closeRetroSession(ctx: RetroContext, guildId: string, sessionId: number, actorId: string): Promise<string>
{
	const session = ctx.services.retro.close(guildId, sessionId, actorId);
	const notes = await publishRetroClosed(ctx, session);
	const head = `Đã đóng phiên retro #${session.id} (${formatNumber(session.participants)} người đã điền)`;
	const posted = ctx.services.retro.get(guildId, sessionId)?.summaryPostedAt !== null;
	return withNotes(posted ? `${head} và đăng bảng tổng hợp ẩn danh.` : `${head}.`, notes);
}

async function refreshNote(ctx: RetroContext, session: RetroSession): Promise<string[]>
{
	const note = sessionMessageNote(await ctx.actions.refreshSessionMessage(ctx.client, session));
	return note === null ? [] : [note];
}

function deadlineText(session: RetroSession): string
{
	return session.closesAt === null ? "không tự đóng" : `tự đóng ${relativeTime(session.closesAt)}`;
}

/** Mở lại phiên đã đóng (phiên chưa từng có tin thì RetroService chặn: phải đăng lại tin trước). */
export async function reopenRetroSession(ctx: RetroContext, guildId: string, sessionId: number, actorId: string, durationHours: number | null): Promise<string>
{
	const session = ctx.services.retro.reopen(guildId, sessionId, actorId, durationHours);
	return withNotes(`Đã mở lại phiên retro #${session.id} (${deadlineText(session)}).`, await refreshNote(ctx, session));
}

/** Đặt hạn mới cho phiên đang mở. */
export async function extendRetroSession(ctx: RetroContext, guildId: string, sessionId: number, actorId: string, durationHours: number): Promise<string>
{
	const session = ctx.services.retro.extend(guildId, sessionId, actorId, durationHours);
	return withNotes(`Đã gia hạn phiên retro #${session.id}: ${deadlineText(session)}.`, await refreshNote(ctx, session));
}

/**
 * Đăng lại tin của phiên (có nút "📝 Điền retro", theo trạng thái hiện tại) vào kênh của phiên và lưu tin mới làm tin của phiên: dùng khi
 * tin cũ bị xoá, hoặc bot không sửa được tin cũ. Tin cũ (nếu còn) không được cập nhật nữa; nút trên tin cũ vẫn mở đúng form của phiên.
 */
export async function repostRetroSession(ctx: RetroContext, guildId: string, sessionId: number): Promise<string>
{
	const { client, services, actions } = ctx;
	const session = services.retro.get(guildId, sessionId);
	if (!session) throw new UserError(RETRO_NOT_FOUND);
	const posted = await actions.post(client, session.channelId, retroSessionMessage(session));
	if (!posted.ok) throw new UserError(failureText(posted.reason, REPOST_ARCHIVED, REPOST_NOT_POSTED));
	services.retro.attachMessage(guildId, sessionId, posted.messageId);
	return `Đã đăng lại tin của phiên retro #${session.id} (có nút 📝 Điền retro) trong ${channelMention(session.channelId)}. `
		+ "Từ giờ bot cập nhật tin mới này; tin cũ (nếu còn) giữ nguyên.";
}

/** Đăng lại bảng tổng hợp ẩn danh của phiên đã đóng (người quản lý bấm, ví dụ khi bảng đăng lỗi hoặc bị xoá). */
export async function repostRetroSummary(ctx: RetroContext, guildId: string, sessionId: number): Promise<string>
{
	const session = ctx.services.retro.get(guildId, sessionId);
	if (!session) throw new UserError(RETRO_NOT_FOUND);
	if (session.status === "open") throw new UserError(SUMMARY_WHILE_OPEN);
	if (session.contentDeletedAt !== null) throw new UserError("Nội dung của phiên retro này đã bị xoá nên không còn bảng tổng hợp để đăng.");
	const posted = await postRetroSummary(ctx, session);
	if (!posted.ok) throw new UserError(failureText(posted.reason, REPOST_ARCHIVED, REPOST_NOT_POSTED));
	return `Đã đăng lại bảng tổng hợp ẩn danh của phiên retro #${session.id} trong ${channelMention(session.channelId)}.`;
}

/**
 * Tạo vote tên sprint (RetroService.startVote) rồi đăng tin vote vào kênh của phiên. Không đăng được thì huỷ vote vừa tạo và báo
 * lỗi, để không có vote mà không ai bấm được.
 */
export async function startRetroVote(ctx: RetroContext, guildId: string, sessionId: number, actorId: string, names?: readonly string[]): Promise<string>
{
	const { client, services, actions } = ctx;
	const { session, poll } = services.retro.startVote({ guildId, sessionId, actorId, names });
	const posted = await actions.post(client, session.channelId, { ...pollMessage(poll), allowedMentions: NO_MENTIONS });
	if (!posted.ok)
	{
		const reverted = services.retro.cancelVote(guildId, sessionId, actorId);
		await actions.refreshSessionMessage(client, reverted);
		throw new UserError(failureText(posted.reason, VOTE_ARCHIVED, VOTE_NOT_POSTED));
	}
	services.polls.attachMessage(guildId, poll.id, posted.channelId, posted.messageId);
	const notes = await refreshNote(ctx, session);
	const closes = poll.closesAt === null ? "" : `, tự đóng ${relativeTime(poll.closesAt)}`;
	return withNotes(`Đã tạo vote tên sprint #${poll.id} với ${formatNumber(poll.options.length)} tên${closes}. Vote xong bot tự chốt tên và cộng XP cho người đề xuất.`, notes);
}

/**
 * Đăng kết quả chốt vote (thắng hoặc hoà) lên Discord và ghi Confluence khi đã có tên. Trả về các dòng ghi chú. `docInBackground`:
 * ghi Confluence chạy nền (lỗi chỉ ghi log và lưu vào phiên), để vòng quét vote không phải chờ Confluence.
 */
export async function publishRetroOutcome(ctx: RetroContext, outcome: RetroVoteOutcome, options: { docInBackground?: boolean } = {}): Promise<string[]>
{
	if (outcome.kind === "unchanged") return [];
	const { client, actions } = ctx;
	const { session } = outcome;
	const notes = await refreshNote(ctx, session);
	const text = outcome.kind === "winner"
		? retroWinnerText(session, outcome.name, outcome.proposerIds.length, outcome.xpEach)
		: retroTieText(session, outcome.names);
	const posted = await actions.post(client, session.channelId, { content: text, allowedMentions: NO_MENTIONS });
	if (!posted.ok) notes.push(failureText(posted.reason, ANNOUNCEMENT_ARCHIVED, ANNOUNCEMENT_NOT_POSTED));
	if (outcome.kind !== "winner") return notes;

	if (options.docInBackground === true)
	{
		writeRetroDoc(ctx, session.guildId, session.id)
			.then(report =>
			{
				if (report.status === "failed") logger.warn(`Phiên retro #${session.id}: ${retroDocReportLine(report)}`);
			})
			.catch((error: unknown) => logger.error(`Lỗi khi ghi Confluence cho phiên retro #${session.id} sau khi chốt tên:`, error));
		return notes;
	}
	notes.push(...docNote(session, await writeRetroDoc(ctx, session.guildId, session.id)));
	return notes;
}

/** Chốt vote tên sprint của phiên nếu vote đã đóng (gọi lại an toàn), rồi đăng kết quả. */
export async function settleRetroVote(
	ctx: RetroContext,
	guildId: string,
	sessionId: number,
	options: { docInBackground?: boolean } = {},
): Promise<{ outcome: RetroVoteOutcome; notes: string[] }>
{
	const outcome = ctx.services.retro.finalizeVote(guildId, sessionId, botActorId(ctx.client));
	const notes = await publishRetroOutcome(ctx, outcome, options);
	return { outcome, notes };
}

/**
 * Gọi sau khi một vote bị đóng (tay, web hay hết hạn): nếu là vote tên sprint của một phiên retro thì chốt tên (hoặc báo hoà). Ghi
 * Confluence chạy nền để không chặn vòng quét vote. Không ném lỗi: lỗi chỉ ghi log, lịch quét retro sẽ thử lại.
 */
export async function settleRetroPoll(client: DiscordClient, poll: Poll): Promise<void>
{
	try
	{
		const session = client.services.retro.findByPoll(poll.guildId, poll.id);
		if (!session) return;
		const { notes } = await settleRetroVote(retroContext(client), session.guildId, session.id, { docInBackground: true });
		for (const note of notes) logger.warn(`Phiên retro #${session.id}: ${note}`);
	}
	catch (error)
	{
		logger.error(`Không chốt được vote tên sprint #${poll.id}:`, error);
	}
}

/** Người quản lý chọn tên (vote hoà, hoặc phiên chỉ có một tên đề xuất). */
export async function pickRetroName(ctx: RetroContext, guildId: string, sessionId: number, name: string, actorId: string): Promise<string>
{
	const outcome = ctx.services.retro.pickName({ guildId, sessionId, name, actorId, systemActorId: botActorId(ctx.client) });
	const notes = await publishRetroOutcome(ctx, outcome);
	const chosen = outcome.kind === "winner" ? outcome.name : name;
	return withNotes(`Đã chốt tên sprint "${chosen}" cho phiên retro #${sessionId}.`, notes);
}

/**
 * Bot ping được role `roleId` trong kênh `channelId` không: role cho phép mọi người mention, hoặc bot có Mention Everyone ở kênh đó
 * (theo cache của server). Không có role hay server trong cache thì coi là không.
 */
export function canPingRole(client: DiscordClient, guildId: string, channelId: string, roleId: string): boolean
{
	const guild = client.guilds.cache.get(guildId);
	const role = guild?.roles.cache.get(roleId);
	if (!guild || !role) return false;
	if (role.mentionable) return true;
	const me = guild.members.me;
	if (!me) return false;
	const channel: PermissionScope | undefined = guild.channels.cache.get(channelId);
	const permissions = channel ? channel.permissionsFor(me) : me.permissions;
	return permissions?.has(PermissionFlagsBits.MentionEveryone) ?? false;
}

/**
 * Nhắc điền retro trong kênh của phiên: có role team thì ping đúng role đó (allowedMentions chỉ role này), không thì nhắc không ping.
 * Role không cho mention và bot thiếu Mention Everyone thì vẫn đăng lời nhắc nhưng báo rõ là không ping được. Mỗi phiên nhắc tối đa
 * một lần trong REMIND_COOLDOWN_MS.
 */
export async function remindRetro(ctx: RetroContext, guildId: string, sessionId: number): Promise<string>
{
	const { client, services, actions } = ctx;
	const session = services.retro.get(guildId, sessionId);
	if (!session) throw new UserError(RETRO_NOT_FOUND);
	if (!session.acceptingAnswers) throw new UserError("Phiên retro này không còn nhận câu trả lời nên không cần nhắc.");
	const reminders = cooldownMap(services);
	const key = cooldownKey("remind", guildId, sessionId);
	const now = services.clock.now();
	const last = reminders.get(key);
	if (last !== undefined && now - last < REMIND_COOLDOWN_MS)
	{
		throw new UserError(`Phiên này vừa được nhắc. Hãy đợi tới ${relativeTime(last + REMIND_COOLDOWN_MS)} rồi nhắc lại.`);
	}
	reminders.set(key, now);

	const pingable = session.teamRoleId !== null && canPingRole(client, guildId, session.channelId, session.teamRoleId);
	const allowedMentions = session.teamRoleId !== null && pingable ? { parse: [], roles: [session.teamRoleId] } : NO_MENTIONS;
	const posted = await actions.post(client, session.channelId, { content: retroReminderText(session), allowedMentions });
	if (!posted.ok)
	{
		reminders.delete(key);
		throw new UserError(failureText(posted.reason, REPOST_ARCHIVED, ANNOUNCEMENT_NOT_POSTED.replace("⚠️ ", "")));
	}
	if (session.teamRoleId === null) return "Đã nhắc điền retro trong kênh của phiên (không ping ai).";
	if (pingable) return "Đã nhắc team điền retro trong kênh của phiên.";
	return `⚠️ Đã đăng lời nhắc trong kênh của phiên nhưng KHÔNG ping được team ${roleMention(session.teamRoleId)}: role này không cho phép mọi người `
		+ "mention và bot thiếu quyền **Mention Everyone** ở kênh đó, nên không ai nhận thông báo. Bật “Allow anyone to @mention this role” cho "
		+ "role (Server Settings → Roles) hoặc cấp Mention Everyone cho bot, rồi nhắc lại sau 10 phút.";
}
