import { Db } from "../../db/connection";
import { Clock } from "../../shared/clock";

/** Tên hành động được ghi vào audit log. Tầng Discord map sang nhãn tiếng Việt khi hiển thị. */
export type AuditAction =
	| "config.update"
	| "channel.set"
	| "channel.reset"
	| "team.add"
	| "team.remove"
	| "xp.adjust"
	| "xp.reset_user"
	| "xp.reset_all"
	| "contribution.remove"
	| "contribution.adjust"
	| "contribution.reset_user"
	| "contribution.reset_all"
	| "poll.create"
	| "poll.close"
	| "tier_role.set"
	| "tier_role.clear"
	| "tier_role.setup"
	| "tier_set.set"
	| "tier_name.set"
	| "tier_name.reset"
	| "board.set"
	| "board.clear"
	| "backup.manual";

export interface AuditEntry
{
	id: number;
	guildId: string;
	actorId: string;
	action: AuditAction;
	targetId: string | null;
	details: Record<string, unknown> | null;
	createdAt: number;
}

interface AuditRow
{
	id: number;
	guild_id: string;
	actor_id: string;
	action: AuditAction;
	target_id: string | null;
	details: string | null;
	created_at: number;
}

/** Nhật ký mọi thao tác quản trị: ai, lúc nào, làm gì, với ai (PROP-013). */
export class AuditService
{
	constructor(private readonly db: Db, private readonly clock: Clock)
	{}

	record(guildId: string, actorId: string, action: AuditAction, targetId: string | null = null, details: Record<string, unknown> | null = null): void
	{
		this.db.prepare("INSERT INTO audit_log (guild_id, actor_id, action, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)")
			.run(guildId, actorId, action, targetId, details ? JSON.stringify(details) : null, this.clock.now());
	}

	/** Các mục mới nhất trước. */
	list(guildId: string, limit: number): AuditEntry[]
	{
		return this.db.prepare<[string, number], AuditRow>("SELECT * FROM audit_log WHERE guild_id = ? ORDER BY created_at DESC, id DESC LIMIT ?")
			.all(guildId, limit)
			.map(row => ({
				id: row.id,
				guildId: row.guild_id,
				actorId: row.actor_id,
				action: row.action,
				targetId: row.target_id,
				details: row.details ? JSON.parse(row.details) as Record<string, unknown> : null,
				createdAt: row.created_at,
			}));
	}
}
