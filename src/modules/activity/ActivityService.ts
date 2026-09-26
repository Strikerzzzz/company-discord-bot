import { Statement } from "better-sqlite3";
import { Db } from "../../db/connection";
import { UserError } from "../../shared/errors";
import { ServiceDeps } from "../deps";
import { LedgerEvent } from "../ledger/Ledger";
import { ContentSpamFilter } from "./antiSpam";
import { levelInfo } from "./levels";
import {
	ActivityProfile,
	ActivityServiceApi,
	MessageInput,
	MessageSkipReason,
	MessageXpResult,
	XpAdjustInput,
	XpEventSource,
	XpEventView,
} from "./types";

/** Giới hạn trị tuyệt đối của một lần admin cộng/trừ XP. */
export const MAX_XP_ADJUSTMENT = 1_000_000;
export const MAX_RECENT_EVENTS = 50;

const XP_SOURCES: readonly XpEventSource[] = ["message", "poll", "admin"];

function isXpSource(value: string): value is XpEventSource
{
	return XP_SOURCES.some(source => source === value);
}

function toEventView(event: LedgerEvent): XpEventView
{
	if (!isXpSource(event.source)) throw new Error(`Nguồn XP không hợp lệ trong database: ${event.source}`);
	return {
		id: event.id,
		amount: event.amount,
		source: event.source,
		referenceId: event.referenceId,
		actorId: event.actorId,
		reason: event.reason,
		createdAt: event.createdAt,
		voided: event.voidedAt !== null,
	};
}

function skip(reason: MessageSkipReason): MessageXpResult
{
	return { awarded: false, reason };
}

function formatXp(value: number): string
{
	return value.toLocaleString("vi-VN");
}

/**
 * Activity XP (DEC-022, DEC-023, DEC-024, DEC-027): XP cố định cho mỗi tin nhắn hợp lệ, cooldown theo người
 * (lưu ở member_xp.last_message_xp_at để sống qua restart), chống spam theo nội dung chỉ trong bộ nhớ,
 * snapshot team ở mỗi biến động, reset bằng cách huỷ event chứ không xoá.
 */
export class ActivityService implements ActivityServiceApi
{
	private readonly contentFilter = new ContentSpamFilter();
	private readonly selectLastMessageXpAt: Statement<[string, string], { last_message_xp_at: number | null }>;
	private readonly updateLastMessageXpAt: Statement<[number, string, string]>;

	constructor(private readonly db: Db, private readonly deps: ServiceDeps)
	{
		this.selectLastMessageXpAt = db.prepare("SELECT last_message_xp_at FROM member_xp WHERE guild_id = ? AND user_id = ?");
		this.updateLastMessageXpAt = db.prepare("UPDATE member_xp SET last_message_xp_at = ? WHERE guild_id = ? AND user_id = ?");
	}

	handleMessage(input: MessageInput): MessageXpResult
	{
		const { guildId, userId, channelId } = input;
		const effective = this.deps.guildConfig.effectiveChannelXp(guildId, channelId);
		if (!effective.enabled) return skip("channel_disabled");

		const settings = this.deps.guildConfig.getSettings(guildId);
		const now = this.deps.clock.now();
		const rejection = this.contentFilter.check({
			key: `${guildId}:${userId}`,
			content: input.content,
			hasAttachments: input.hasAttachments,
			now,
			minMessageLength: settings.minMessageLength,
			duplicateWindowSeconds: settings.duplicateWindowSeconds,
		});
		if (rejection) return skip(rejection);

		return this.db.transaction((): MessageXpResult =>
		{
			const lastAt = this.selectLastMessageXpAt.get(guildId, userId)?.last_message_xp_at ?? null;
			if (lastAt !== null && now - lastAt < effective.cooldownSeconds * 1000) return skip("cooldown");
			if (effective.xpPerMessage <= 0) return skip("no_xp");

			const levelBefore = levelInfo(this.deps.xpLedger.total(guildId, userId)).level;
			this.deps.xpLedger.record({
				guildId,
				userId,
				amount: effective.xpPerMessage,
				source: "message",
				referenceId: channelId,
				teamRoleIds: this.deps.teams.resolveTeams(guildId, input.roleIds),
			});
			this.updateLastMessageXpAt.run(now, guildId, userId);
			const totalXp = this.deps.xpLedger.total(guildId, userId);
			return { awarded: true, amount: effective.xpPerMessage, totalXp, levelBefore, levelAfter: levelInfo(totalXp).level };
		})();
	}

	getProfile(guildId: string, userId: string): ActivityProfile
	{
		const { rank, totalRanked } = this.deps.xpLedger.rank(guildId, userId);
		return { userId, level: levelInfo(this.deps.xpLedger.total(guildId, userId)), rank, totalRanked };
	}

	adjustXp(input: XpAdjustInput): { totalXp: number }
	{
		const { guildId, userId, delta, actorId } = input;
		if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_XP_ADJUSTMENT)
		{
			throw new UserError(`Số XP điều chỉnh phải là số nguyên khác 0, trong khoảng từ -${formatXp(MAX_XP_ADJUSTMENT)} đến ${formatXp(MAX_XP_ADJUSTMENT)}.`);
		}
		const reason = input.reason?.trim() || null;

		return this.db.transaction((): { totalXp: number } =>
		{
			const current = this.deps.xpLedger.total(guildId, userId);
			const totalXp = current + delta;
			if (totalXp < 0) throw new UserError(`Không thể trừ quá số XP hiện có (hiện có ${formatXp(current)} XP).`);

			this.deps.xpLedger.record({
				guildId,
				userId,
				amount: delta,
				source: "admin",
				actorId,
				reason,
				teamRoleIds: this.deps.teams.resolveTeams(guildId, input.roleIds),
			});
			this.deps.audit.record(guildId, actorId, "xp.adjust", userId, { delta, reason, totalXp });
			return { totalXp };
		})();
	}

	resetUser(guildId: string, userId: string, actorId: string): { voidedEvents: number }
	{
		return this.db.transaction((): { voidedEvents: number } =>
		{
			const voidedEvents = this.deps.xpLedger.voidUser(guildId, userId);
			this.deps.audit.record(guildId, actorId, "xp.reset_user", userId, { voidedEvents });
			return { voidedEvents };
		})();
	}

	resetAll(guildId: string, actorId: string): { voidedEvents: number; members: number }
	{
		return this.db.transaction((): { voidedEvents: number; members: number } =>
		{
			const { events, members } = this.deps.xpLedger.voidGuild(guildId);
			this.deps.audit.record(guildId, actorId, "xp.reset_all", null, { voidedEvents: events, members });
			return { voidedEvents: events, members };
		})();
	}

	recentEvents(guildId: string, userId: string, limit: number): XpEventView[]
	{
		const clamped = Math.min(MAX_RECENT_EVENTS, Math.max(1, Math.floor(limit) || 1));
		return this.deps.xpLedger.recent(guildId, userId, clamped).map(toEventView);
	}
}
