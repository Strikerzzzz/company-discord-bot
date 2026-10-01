import { Statement } from "better-sqlite3";
import { Db } from "../../db/connection";

/**
 * Truy vấn đọc cho các chỉ số huy hiệu không nằm trong Ledger (DEC-029). Chỉ chứa SQL, không có quy tắc nghiệp vụ.
 * Mọi số đếm chỉ tính dữ liệu còn hiệu lực trong guild.
 */
export class GamificationRepository
{
	private readonly countRecognitionsReceived: Statement<[string, string], { n: number }>;
	private readonly countRecognitionsGiven: Statement<[string, string], { n: number }>;
	private readonly countPollsJoined: Statement<[string, string], { n: number }>;
	private readonly countActiveContributions: Statement<[string, string], { n: number }>;

	constructor(db: Db)
	{
		// Chỉ lượt 👍 (contribution_votes): lượt 👎 (contribution_downvotes) và event sàn cũng là event nguồn 'vote' của tác giả
		// nhưng không phải ghi nhận (DEC-051). Lượt có điểm đã bị huỷ (admin reset, contribution bị gỡ) không tính; rút ghi nhận thì
		// dòng vote đã bị xoá.
		this.countRecognitionsReceived = db.prepare(`
			SELECT COUNT(*) AS n
			FROM contributions c
			JOIN contribution_votes v ON v.contribution_id = c.id
			JOIN contribution_events e ON e.id = v.event_id
			WHERE c.guild_id = ? AND c.author_id = ? AND e.voided_at IS NULL`);
		this.countRecognitionsGiven = db.prepare(`
			SELECT COUNT(*) AS n
			FROM contribution_votes v
			JOIN contributions c ON c.id = v.contribution_id
			JOIN contribution_events e ON e.id = v.event_id
			WHERE c.guild_id = ? AND v.voter_id = ? AND e.voided_at IS NULL`);
		this.countPollsJoined = db.prepare(`
			SELECT COUNT(*) AS n
			FROM poll_participants pp
			JOIN polls p ON p.id = pp.poll_id
			WHERE p.guild_id = ? AND pp.user_id = ?`);
		this.countActiveContributions = db.prepare(
			"SELECT COUNT(*) AS n FROM contributions WHERE guild_id = ? AND author_id = ? AND status = 'active' AND review_state = 'approved'",
		);
	}

	/** Số lượt 👍 người khác ghi nhận contribution của người này mà điểm còn hiệu lực. */
	recognitionsReceived(guildId: string, userId: string): number
	{
		return this.countRecognitionsReceived.get(guildId, userId)?.n ?? 0;
	}

	/** Số lượt 👍 người này ghi nhận contribution của người khác mà điểm còn hiệu lực. */
	recognitionsGiven(guildId: string, userId: string): number
	{
		return this.countRecognitionsGiven.get(guildId, userId)?.n ?? 0;
	}

	/** Số vote (poll) người này đã tham gia, kể cả khi sau đó bỏ hết lựa chọn. */
	pollsJoined(guildId: string, userId: string): number
	{
		return this.countPollsJoined.get(guildId, userId)?.n ?? 0;
	}

	/** Số contribution còn hiệu lực (chưa bị gỡ) và đã được duyệt (DEC-051) người này là tác giả. */
	activeContributions(guildId: string, userId: string): number
	{
		return this.countActiveContributions.get(guildId, userId)?.n ?? 0;
	}
}
