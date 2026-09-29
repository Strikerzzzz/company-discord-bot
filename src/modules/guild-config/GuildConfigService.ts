import { Db } from "../../db/connection";
import { Clock } from "../../shared/clock";
import { UserError } from "../../shared/errors";
import { AuditService } from "../audit/AuditService";
import {
	ChannelSettings,
	DEFAULT_GUILD_SETTINGS,
	EffectiveChannelXp,
	GuildSettings,
	isXpChannelMode,
	NumericSettingKey,
	SETTING_LIMITS,
	XpChannelMode,
} from "./types";

/** Số kênh tối đa một lần bật/tắt hàng loạt (bằng số lựa chọn tối đa của một menu chọn kênh của Discord). */
export const MAX_BULK_CHANNELS = 25;

/** Kết quả bật/tắt hàng loạt: kênh đã đổi trạng thái và kênh vốn đã đúng trạng thái (theo thứ tự đầu vào, đã bỏ trùng). */
export interface BulkChannelResult
{
	changed: string[];
	unchanged: string[];
}

interface GuildRow
{
	xp_per_message: number;
	xp_cooldown_seconds: number;
	min_message_length: number;
	duplicate_window_seconds: number;
	level_up_announcements: number;
	xp_channel_mode: string;
	default_poll_xp: number;
	poll_xp_daily_cap: number;
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

/** Cấu hình của kênh chưa có cấu hình riêng: bật XP theo chế độ kênh của guild (DEC-037), dùng giá trị chung. */
function defaultChannel(channelId: string, mode: XpChannelMode): ChannelSettings
{
	return { channelId, xpEnabled: mode === "all", xpPerMessage: null, xpCooldownSeconds: null };
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
			// Cột có CHECK nên luôn hợp lệ; vẫn kiểm tra để giá trị lạ (DB sửa tay) rơi về mặc định thay vì lọt ra ngoài.
			xpChannelMode: isXpChannelMode(row.xp_channel_mode) ? row.xp_channel_mode : DEFAULT_GUILD_SETTINGS.xpChannelMode,
			defaultPollXp: row.default_poll_xp,
			pollXpDailyCap: row.poll_xp_daily_cap,
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
		if (patch.xpChannelMode !== undefined && !isXpChannelMode(patch.xpChannelMode)) throw new UserError("Chế độ kênh tính XP không hợp lệ.");

		const next: GuildSettings = { ...this.getSettings(guildId), ...patch };
		this.db.transaction(() =>
		{
			this.db.prepare(`
				INSERT INTO guild_settings (guild_id, xp_per_message, xp_cooldown_seconds, min_message_length, duplicate_window_seconds,
					level_up_announcements, xp_channel_mode, default_poll_xp, poll_xp_daily_cap, contribution_vote_points, admin_role_id,
					poll_creator_role_id, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT (guild_id) DO UPDATE SET
					xp_per_message = excluded.xp_per_message,
					xp_cooldown_seconds = excluded.xp_cooldown_seconds,
					min_message_length = excluded.min_message_length,
					duplicate_window_seconds = excluded.duplicate_window_seconds,
					level_up_announcements = excluded.level_up_announcements,
					xp_channel_mode = excluded.xp_channel_mode,
					default_poll_xp = excluded.default_poll_xp,
					poll_xp_daily_cap = excluded.poll_xp_daily_cap,
					contribution_vote_points = excluded.contribution_vote_points,
					admin_role_id = excluded.admin_role_id,
					poll_creator_role_id = excluded.poll_creator_role_id,
					updated_at = excluded.updated_at`,
			).run(
				guildId, next.xpPerMessage, next.xpCooldownSeconds, next.minMessageLength, next.duplicateWindowSeconds,
				next.levelUpAnnouncements ? 1 : 0, next.xpChannelMode, next.defaultPollXp, next.pollXpDailyCap, next.contributionVotePoints, next.adminRoleId, next.pollCreatorRoleId,
				this.clock.now(),
			);
			this.audit.record(guildId, actorId, "config.update", null, { ...patch });
		})();
		return next;
	}

	private channelRow(guildId: string, channelId: string): ChannelRow | undefined
	{
		return this.db.prepare<[string, string], ChannelRow>("SELECT * FROM channel_settings WHERE guild_id = ? AND channel_id = ?")
			.get(guildId, channelId);
	}

	private writeChannel(guildId: string, channel: ChannelSettings): void
	{
		this.db.prepare(`
			INSERT INTO channel_settings (guild_id, channel_id, xp_enabled, xp_per_message, xp_cooldown_seconds, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (guild_id, channel_id) DO UPDATE SET
				xp_enabled = excluded.xp_enabled,
				xp_per_message = excluded.xp_per_message,
				xp_cooldown_seconds = excluded.xp_cooldown_seconds,
				updated_at = excluded.updated_at`,
		).run(guildId, channel.channelId, channel.xpEnabled ? 1 : 0, channel.xpPerMessage, channel.xpCooldownSeconds, this.clock.now());
	}

	/** Cấu hình hiệu lực của channel: cấu hình riêng nếu có, không thì mặc định theo chế độ kênh của guild (DEC-037). */
	getChannel(guildId: string, channelId: string): ChannelSettings
	{
		const row = this.channelRow(guildId, channelId);
		return row ? toChannel(row) : defaultChannel(channelId, this.getSettings(guildId).xpChannelMode);
	}

	/** Đặt cấu hình riêng cho channel. Trường bỏ qua giữ nguyên; truyền null để quay về giá trị của guild. */
	setChannel(guildId: string, channelId: string, patch: Partial<Omit<ChannelSettings, "channelId">>, actorId: string): ChannelSettings
	{
		if (patch.xpPerMessage != null) validateNumber("xpPerMessage", patch.xpPerMessage);
		if (patch.xpCooldownSeconds != null) validateNumber("xpCooldownSeconds", patch.xpCooldownSeconds);

		const next: ChannelSettings = { ...this.getChannel(guildId, channelId), ...patch, channelId };
		this.db.transaction(() =>
		{
			this.writeChannel(guildId, next);
			this.audit.record(guildId, actorId, "channel.set", channelId, { ...patch });
		})();
		return next;
	}

	/**
	 * Bật hoặc tắt XP cho nhiều channel cùng lúc (bảng điều khiển, DEC-037), trong một transaction. Kênh đã đúng trạng thái
	 * thì bỏ qua (không ghi, không audit). Kênh không có XP/cooldown riêng mà trạng thái mới trùng mặc định của chế độ kênh
	 * thì xoá cấu hình riêng thay vì ghi, để bảng channel_settings chỉ chứa kênh khác mặc định; kênh có XP/cooldown riêng
	 * giữ nguyên các giá trị đó. Mỗi kênh đổi trạng thái có một dòng audit `channel.set` với `xpEnabled`.
	 * UserError nếu danh sách rỗng hoặc quá MAX_BULK_CHANNELS kênh (sau khi bỏ trùng).
	 */
	setChannelsXpEnabled(guildId: string, channelIds: readonly string[], enabled: boolean, actorId: string): BulkChannelResult
	{
		const unique = [...new Set(channelIds)];
		if (unique.length === 0) throw new UserError("Hãy chọn ít nhất một kênh.");
		if (unique.length > MAX_BULK_CHANNELS) throw new UserError(`Mỗi lần chỉ bật hoặc tắt tối đa ${MAX_BULK_CHANNELS} kênh.`);

		return this.db.transaction((): BulkChannelResult =>
		{
			const mode = this.getSettings(guildId).xpChannelMode;
			const result: BulkChannelResult = { changed: [], unchanged: [] };
			const remove = this.db.prepare("DELETE FROM channel_settings WHERE guild_id = ? AND channel_id = ?");
			for (const channelId of unique)
			{
				const row = this.channelRow(guildId, channelId);
				const current = row ? toChannel(row) : defaultChannel(channelId, mode);
				if (current.xpEnabled === enabled)
				{
					result.unchanged.push(channelId);
					continue;
				}
				const next: ChannelSettings = { ...current, xpEnabled: enabled };
				const matchesDefault = next.xpPerMessage === null && next.xpCooldownSeconds === null && enabled === (mode === "all");
				if (matchesDefault) remove.run(guildId, channelId);
				else this.writeChannel(guildId, next);
				this.audit.record(guildId, actorId, "channel.set", channelId, { xpEnabled: enabled });
				result.changed.push(channelId);
			}
			return result;
		})();
	}

	/** Xoá cấu hình riêng của channel (quay về mặc định theo chế độ kênh, dùng giá trị guild). Trả về false nếu vốn không có. */
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

	/** Giá trị thực tế áp dụng cho một channel (cấu hình channel đè lên cấu hình guild và chế độ kênh). */
	effectiveChannelXp(guildId: string, channelId: string): EffectiveChannelXp
	{
		const guild = this.getSettings(guildId);
		const row = this.channelRow(guildId, channelId);
		const channel = row ? toChannel(row) : defaultChannel(channelId, guild.xpChannelMode);
		return {
			enabled: channel.xpEnabled,
			xpPerMessage: channel.xpPerMessage ?? guild.xpPerMessage,
			cooldownSeconds: channel.xpCooldownSeconds ?? guild.xpCooldownSeconds,
		};
	}
}
