import { LevelInfo } from "./levels";

/** Dữ liệu thuần của một tin nhắn, do tầng Discord trích ra (module không phụ thuộc discord.js). */
export interface MessageInput
{
	guildId: string;
	userId: string;
	channelId: string;
	/** Nội dung gốc; chỉ dùng trong bộ nhớ để chống spam, không bao giờ lưu (DEC-023). */
	content: string;
	hasAttachments: boolean;
	/** Toàn bộ role hiện có của người gửi (dùng để lấy snapshot team). */
	roleIds: readonly string[];
}

export type MessageSkipReason = "channel_disabled" | "duplicate" | "too_short" | "cooldown" | "no_xp";

export type MessageXpResult =
	| { awarded: false; reason: MessageSkipReason }
	| { awarded: true; amount: number; totalXp: number; levelBefore: number; levelAfter: number };

export interface ActivityProfile
{
	userId: string;
	level: LevelInfo;
	/** null nếu chưa có XP. */
	rank: number | null;
	/** Số người có XP > 0 trong guild. */
	totalRanked: number;
}

export interface XpAdjustInput
{
	guildId: string;
	userId: string;
	/** Dương = cộng, âm = trừ; khác 0. */
	delta: number;
	actorId: string;
	reason: string | null;
	/** Role hiện có của người được điều chỉnh (snapshot team). */
	roleIds: readonly string[];
}

export type XpEventSource = "message" | "poll" | "admin";

export interface XpEventView
{
	id: number;
	amount: number;
	source: XpEventSource;
	referenceId: string | null;
	actorId: string | null;
	reason: string | null;
	createdAt: number;
	voided: boolean;
}

export interface ActivityServiceApi
{
	/** Xét một tin nhắn: kiểm tra channel, chống trùng/tin ngắn, cooldown; nếu hợp lệ thì cộng XP. */
	handleMessage(input: MessageInput): MessageXpResult;
	getProfile(guildId: string, userId: string): ActivityProfile;
	/** Admin cộng/trừ XP. UserError nếu delta = 0, |delta| quá lớn hoặc kết quả âm. Ghi audit. */
	adjustXp(input: XpAdjustInput): { totalXp: number };
	/** Reset XP một người (void mọi event). Ghi audit. */
	resetUser(guildId: string, userId: string, actorId: string): { voidedEvents: number };
	/** Reset XP cả guild. Ghi audit. */
	resetAll(guildId: string, actorId: string): { voidedEvents: number; members: number };
	/** Event gần nhất của một người, mới nhất trước (kể cả event đã huỷ). */
	recentEvents(guildId: string, userId: string, limit: number): XpEventView[];
}
