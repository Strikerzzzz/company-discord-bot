import { Db } from "../../db/connection";
import { Clock } from "../../shared/clock";
import { UserError } from "../../shared/errors";
import { AuditService } from "../audit/AuditService";
import { ChannelSettings, DEFAULT_GUILD_SETTINGS, EffectiveChannelXp, GuildSettings, NumericSettingKey, SETTING_LIMITS } from "./types";

interface GuildRow
{
	xp_per_message: number;
	xp_cooldown_seconds: number;
	min_message_length: number;
	duplicate_window_seconds: number;
	level_up_announcements: number;
	default_poll_xp: number;
	contribution_vote_points: number;
	admin_role_id: string | null;
	poll_creator_role_id: string | null;
}

interface ChannelRow
{
	channel_id: string;
	xp_enabled: number;
	xp_per_message: number | null;
	xp_cooldown_seconds: number | null;
}

function toChannel(row: ChannelRow): ChannelSettings
{
	return {
		channelId: row.channel_id,
		xpEnabled: row.xp_enabled === 1,
		xpPerMessage: row.xp_per_message,
		xpCooldownSeconds: row.xp_cooldown_seconds,
	};
}

function validateNumber(key: NumericSettingKey, value: number): void
{
	const limit = SETTING_LIMITS[key];
	if (!Number.isInteger(value) || value < limit.min || value > limit.max)
	{
		throw new UserError(`${limit.label} phải là số nguyên từ ${limit.min} đến ${limit.max}.`);
	}
}

/** Cấu hình theo guild và theo channel do admin chỉnh; mọi thay đổi được ghi audit log. */
export class GuildConfigService
{
	constructor(private readonly db: Db, private readonly clock: Clock, private readonly audit: AuditService)
	{}

	getSettings(guildId: string): GuildSettings
	{
		const row = this.db.prepare<[string], GuildRow>("SELECT * FROM guild_settings WHERE guild_id = ?").get(guildId);
		if (!row) return { ...DEFAULT_GUILD_SETTINGS };
		return {
			xpPerMessage: row.xp_per_message,
			xpCooldownSeconds: row.xp_cooldown_seconds,
			minMessageLength: row.min_message_length,
			duplicateWindowSeconds: row.duplicate_window_seconds,
			levelUpAnnouncements: row.level_up_announcements === 1,
			defaultPollXp: row.default_poll_xp,
			contributionVotePoints: row.contribution_vote_points,
			adminRoleId: row.admin_role_id,
			pollCreatorRoleId: row.poll_creator_role_id,
		};
	}

	updateSettings(guildId: string, patch: Partial<GuildSettings>, actorId: string): GuildSettings
	{
		for (const key of Object.keys(SETTING_LIMITS) as NumericSettingKey[])
		{
			const value = patch[key];
			if (value !== undefined) validateNumber(key, value);
		}

		const next: GuildSettings = { ...this.getSettings(guildId), ...patch };
		this.db.transaction(() =>
		{
			this.db.prepare(`
				INSERT INTO guild_settings (guild_id, xp_per_message, xp_cooldown_seconds, min_message_length, duplicate_window_seconds,
					level_up_announcements, default_poll_xp, contribution_vote_points, admin_role_id, poll_creator_role_id, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT (guild_id) DO UPDATE SET
					xp_per_message = excluded.xp_per_message,
					xp_cooldown_seconds = excluded.xp_cooldown_seconds,
					min_message_length = excluded.min_message_length,
					duplicate_window_seconds = excluded.duplicate_window_seconds,
					level_up_announcements = excluded.level_up_announcements,
					default_poll_xp = excluded.default_poll_xp,
					contribution_vote_points = excluded.contribution_vote_points,
					admin_role_id = excluded.admin_role_id,
					poll_creator_role_id = excluded.poll_creator_role_id,
					updated_at = excluded.updated_at`,
			).run(
				guildId, next.xpPerMessage, next.xpCooldownSeconds, next.minMessageLength, next.duplicateWindowSeconds,
				next.levelUpAnnouncements ? 1 : 0, next.defaultPollXp, next.contributionVotePoints, next.adminRoleId, next.pollCreatorRoleId,
				this.clock.now(),
			);
			this.audit.record(guildId, actorId, "config.update", null, { ...patch });
		})();
		return next;
	}

	getChannel(guildId: string, channelId: string): ChannelSettings
	{
		const row = this.db.prepare<[string, string], ChannelRow>("SELECT * FROM channel_settings WHERE guild_id = ? AND channel_id = ?")
			.get(guildId, channelId);
		return row ? toChannel(row) : { channelId, xpEnabled: true, xpPerMessage: null, xpCooldownSeconds: null };
	}

	/** Đặt cấu hình riêng cho channel. Trường bỏ qua giữ nguyên; truyền null để quay về giá trị của guild. */
	setChannel(guildId: string, channelId: string, patch: Partial<Omit<ChannelSettings, "channelId">>, actorId: string): ChannelSettings
	{
		if (patch.xpPerMessage != null) validateNumber("xpPerMessage", patch.xpPerMessage);
		if (patch.xpCooldownSeconds != null) validateNumber("xpCooldownSeconds", patch.xpCooldownSeconds);

		const next: ChannelSettings = { ...this.getChannel(guildId, channelId), ...patch, channelId };
		this.db.transaction(() =>
		{
			this.db.prepare(`
				INSERT INTO channel_settings (guild_id, channel_id, xp_enabled, xp_per_message, xp_cooldown_seconds, updated_at)
				VALUES (?, ?, ?, ?, ?, ?)
				ON CONFLICT (guild_id, channel_id) DO UPDATE SET
					xp_enabled = excluded.xp_enabled,
					xp_per_message = excluded.xp_per_message,
					xp_cooldown_seconds = excluded.xp_cooldown_seconds,
					updated_at = excluded.updated_at`,
			).run(guildId, channelId, next.xpEnabled ? 1 : 0, next.xpPerMessage, next.xpCooldownSeconds, this.clock.now());
			this.audit.record(guildId, actorId, "channel.set", channelId, { ...patch });
		})();
		return next;
	}

	/** Xoá cấu hình riêng của channel (quay về mặc định: bật XP, dùng giá trị guild). Trả về false nếu vốn không có. */
	resetChannel(guildId: string, channelId: string, actorId: string): boolean
	{
		return this.db.transaction((): boolean =>
		{
			const removed = this.db.prepare("DELETE FROM channel_settings WHERE guild_id = ? AND channel_id = ?").run(guildId, channelId).changes > 0;
			if (removed) this.audit.record(guildId, actorId, "channel.reset", channelId);
			return removed;
		})();
	}

	listChannels(guildId: string): ChannelSettings[]
	{
		return this.db.prepare<[string], ChannelRow>("SELECT * FROM channel_settings WHERE guild_id = ? ORDER BY channel_id")
			.all(guildId)
			.map(toChannel);
	}

	/** Giá trị thực tế áp dụng cho một channel (cấu hình channel đè lên cấu hình guild). */
	effectiveChannelXp(guildId: string, channelId: string): EffectiveChannelXp
	{
		const guild = this.getSettings(guildId);
		const channel = this.getChannel(guildId, channelId);
		return {
			enabled: channel.xpEnabled,
			xpPerMessage: channel.xpPerMessage ?? guild.xpPerMessage,
			cooldownSeconds: channel.xpCooldownSeconds ?? guild.xpCooldownSeconds,
		};
	}
}
