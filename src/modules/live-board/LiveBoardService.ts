import { Db } from "../../db/connection";
import { Clock } from "../../shared/clock";
import { AuditService } from "../audit/AuditService";

/** "Bảng vàng" của một guild: message bảng xếp hạng bot tự cập nhật trong một channel (DEC-030). */
export interface LiveBoard
{
	guildId: string;
	channelId: string;
	/** Message bot đã đăng; null = chưa đăng (hoặc message cũ không còn, cần đăng lại). */
	messageId: string | null;
	updatedAt: number;
}

export interface LiveBoardServiceApi
{
	get(guildId: string): LiveBoard | null;
	/** Mọi Bảng vàng đang bật (mọi guild), để bộ lập lịch cập nhật. Tầng Discord tự lọc theo DISCORD_GUILD_IDS. */
	listAll(): LiveBoard[];
	/**
	 * Bật hoặc chuyển Bảng vàng sang channel khác. messageId về null (message ở channel cũ, nếu có, do tầng Discord tự xoá
	 * dựa trên giá trị trả về `previous`). Ghi audit "board.set" (target = channelId).
	 */
	setChannel(guildId: string, channelId: string, actorId: string): { board: LiveBoard; previous: LiveBoard | null };
	/** Tắt Bảng vàng. Trả về bảng cũ (để tầng Discord xoá message), null nếu vốn đang tắt. Ghi audit "board.clear" (target = channel cũ). */
	disable(guildId: string, actorId: string): LiveBoard | null;
	/**
	 * Lưu message vừa đăng (hoặc null khi message không còn). Chỉ ghi nếu Bảng vàng vẫn đang ở đúng `channelId`
	 * (tránh ghi đè khi admin vừa chuyển channel trong lúc bot đang đăng). Không ghi audit. Trả về true nếu đã ghi.
	 */
	setMessage(guildId: string, channelId: string, messageId: string | null): boolean;
}

export class LiveBoardService implements LiveBoardServiceApi
{
	constructor(private readonly db: Db, private readonly clock: Clock, private readonly audit: AuditService)
	{}

	get(guildId: string): LiveBoard | null
	{
		throw new Error(`Chưa triển khai: LiveBoardService.get (${guildId}, ${this.db.name}).`);
	}

	listAll(): LiveBoard[]
	{
		throw new Error(`Chưa triển khai: LiveBoardService.listAll (${this.clock.now()}).`);
	}

	setChannel(guildId: string, channelId: string, actorId: string): { board: LiveBoard; previous: LiveBoard | null }
	{
		throw new Error(`Chưa triển khai: LiveBoardService.setChannel (${guildId}, ${channelId}, ${actorId}, ${typeof this.audit}).`);
	}

	disable(guildId: string, actorId: string): LiveBoard | null
	{
		throw new Error(`Chưa triển khai: LiveBoardService.disable (${guildId}, ${actorId}).`);
	}

	setMessage(guildId: string, channelId: string, messageId: string | null): boolean
	{
		throw new Error(`Chưa triển khai: LiveBoardService.setMessage (${guildId}, ${channelId}, ${messageId}).`);
	}
}
