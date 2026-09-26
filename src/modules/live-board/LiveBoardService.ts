import { Statement } from "better-sqlite3";
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

interface LiveBoardRow
{
	guild_id: string;
	channel_id: string;
	message_id: string | null;
	updated_at: number;
}

function toLiveBoard(row: LiveBoardRow): LiveBoard
{
	return { guildId: row.guild_id, channelId: row.channel_id, messageId: row.message_id, updatedAt: row.updated_at };
}

/**
 * Cấu hình "Bảng vàng" (DEC-030): mỗi guild tối đa một channel. Đây là cấu hình, không phải điểm, nên tắt thì xoá dòng.
 * Service chỉ lưu vị trí; việc đăng, sửa, xoá message và lập lịch cập nhật thuộc tầng Discord.
 */
export class LiveBoardService implements LiveBoardServiceApi
{
	private readonly selectOne: Statement<[string], LiveBoardRow>;
	private readonly selectAll: Statement<[], LiveBoardRow>;
	private readonly upsertChannel: Statement<[string, string, number]>;
	private readonly deleteOne: Statement<[string]>;
	private readonly updateMessage: Statement<[string | null, number, string, string]>;

	constructor(private readonly db: Db, private readonly clock: Clock, private readonly audit: AuditService)
	{
		this.selectOne = db.prepare("SELECT * FROM live_boards WHERE guild_id = ?");
		this.selectAll = db.prepare("SELECT * FROM live_boards ORDER BY guild_id");
		this.upsertChannel = db.prepare(`
			INSERT INTO live_boards (guild_id, channel_id, message_id, updated_at) VALUES (?, ?, NULL, ?)
			ON CONFLICT (guild_id) DO UPDATE SET channel_id = excluded.channel_id, message_id = NULL, updated_at = excluded.updated_at`);
		this.deleteOne = db.prepare("DELETE FROM live_boards WHERE guild_id = ?");
		this.updateMessage = db.prepare("UPDATE live_boards SET message_id = ?, updated_at = ? WHERE guild_id = ? AND channel_id = ?");
	}

	get(guildId: string): LiveBoard | null
	{
		const row = this.selectOne.get(guildId);
		return row ? toLiveBoard(row) : null;
	}

	listAll(): LiveBoard[]
	{
		return this.selectAll.all().map(toLiveBoard);
	}

	/**
	 * Đặt lại đúng channel đang dùng cũng được coi là một lần đặt: vẫn đưa message_id về null (bot sẽ đăng lại message mới,
	 * hữu ích khi message cũ bị xoá hay hỏng) và vẫn ghi audit. Khi đó `previous` là chính bảng đó trước khi đặt lại.
	 */
	setChannel(guildId: string, channelId: string, actorId: string): { board: LiveBoard; previous: LiveBoard | null }
	{
		return this.db.transaction((): { board: LiveBoard; previous: LiveBoard | null } =>
		{
			const previous = this.get(guildId);
			this.upsertChannel.run(guildId, channelId, this.clock.now());
			this.audit.record(guildId, actorId, "board.set", channelId);
			const board = this.get(guildId);
			if (!board) throw new Error(`Không đọc lại được Bảng vàng của guild ${guildId} vừa ghi.`);
			return { board, previous };
		})();
	}

	disable(guildId: string, actorId: string): LiveBoard | null
	{
		return this.db.transaction((): LiveBoard | null =>
		{
			const previous = this.get(guildId);
			if (!previous) return null;
			this.deleteOne.run(guildId);
			this.audit.record(guildId, actorId, "board.clear", previous.channelId);
			return previous;
		})();
	}

	setMessage(guildId: string, channelId: string, messageId: string | null): boolean
	{
		return this.updateMessage.run(messageId, this.clock.now(), guildId, channelId).changes > 0;
	}
}
