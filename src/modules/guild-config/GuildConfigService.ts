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
	MAX_GRANT_ROLES,
	NumericSettingKey,
	ROLE_GRANT_KEYS,
	RoleGrantKey,
	SETTING_LIMITS,
	XpChannelMode,
} from "./types";

/** Số kênh tối đa một lần bật/tắt hàng loạt (bằng số lựa chọn tối đa của một menu chọn kênh của Discord). */
export const MAX_BULK_CHANNELS = 25;
/** Số kênh tối đa một lần lưu trên trang web quản trị (hiện toàn bộ kênh của server; Discord cho tối đa 500 kênh). */
export const MAX_WEB_BULK_CHANNELS = 500;

/** Kết quả bật/tắt hàng loạt: kênh đã đổi trạng thái và kênh vốn đã đúng trạng thái (theo thứ tự đầu vào, đã bỏ trùng). */
export interface BulkChannelResult
{
	changed: string[];
	unchanged: string[];
}

/** Thay đổi một danh sách role được cấp quyền theo phần chênh lệch (changeRoleGrants). */
export interface RoleGrantChange
{
	/** Role cần có trong danh sách sau khi lưu. */
	add?: readonly string[];
	/** Role cần không còn trong danh sách sau khi lưu. */
	remove?: readonly string[];
}

/** Kết quả changeRoleGrants; các mảng theo thứ tự đầu vào, đã bỏ trùng (trừ `roleIds`). */
export interface RoleGrantResult
{
	/** Role vừa được thêm vào danh sách. */
	added: string[];
	/** Role vừa được bỏ khỏi danh sách. */
	removed: string[];
	/** Role trong `add` vốn đã có trong danh sách: không ghi. */
	alreadyGranted: string[];
	/** Role trong `remove` vốn không có trong danh sách: không ghi. */
	notGranted: string[];
	/** Danh sách sau khi lưu, cùng thứ tự với GuildSettings (created_at rồi role_id). */
	roleIds: string[];
}

/** Giá trị cột `kind` của bảng guild_role_grants ứng với từng danh sách role (migration 7, DEC-044). */
const GRANT_KINDS: Readonly<Record<RoleGrantKey, string>> = {
	adminRoleIds: "admin",
	pollCreatorRoleIds: "poll_creator",
};

/** Tên danh sách trong thông báo lỗi. */
const GRANT_LABELS: Readonly<Record<RoleGrantKey, string>> = {
	adminRoleIds: "role admin bot",
	pollCreatorRoleIds: "role được tạo vote",
};

interface GrantRow
{
	kind: string;
	role_id: string;
}

interface GuildRow
{
	xp_per_message: number;
	xp_cooldown_seconds: number;
	min_message_length: number;
	duplicate_window_seconds: number;
	level_up_announcements: number;
	level_up_channel_id: string | null;
	xp_channel_mode: string;
	default_poll_xp: number;
	poll_xp_daily_cap: number;
	contribution_vote_points: number;
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

/** Danh sách role mới của `key` (đã bỏ trùng, giữ thứ tự); UserError nếu quá MAX_GRANT_ROLES role. */
function normalizeGrantList(key: RoleGrantKey, roleIds: readonly string[]): string[]
{
	const unique = [...new Set(roleIds)];
	if (unique.length > MAX_GRANT_ROLES) throw new UserError(`Chỉ được đặt tối đa ${MAX_GRANT_ROLES} ${GRANT_LABELS[key]}.`);
	return unique;
}

/** Cấu hình theo guild và theo channel do admin chỉnh; mọi thay đổi được ghi audit log. */
export class GuildConfigService
{
	constructor(private readonly db: Db, private readonly clock: Clock, private readonly audit: AuditService)
	{}

	getSettings(guildId: string): GuildSettings
	{
		const grants = this.roleGrants(guildId);
		const row = this.db.prepare<[string], GuildRow>("SELECT * FROM guild_settings WHERE guild_id = ?").get(guildId);
		if (!row) return { ...DEFAULT_GUILD_SETTINGS, ...grants };
		return {
			xpPerMessage: row.xp_per_message,
			xpCooldownSeconds: row.xp_cooldown_seconds,
			minMessageLength: row.min_message_length,
			duplicateWindowSeconds: row.duplicate_window_seconds,
			levelUpAnnouncements: row.level_up_announcements === 1,
			levelUpChannelId: row.level_up_channel_id,
			// Cột có CHECK nên luôn hợp lệ; vẫn kiểm tra để giá trị lạ (DB sửa tay) rơi về mặc định thay vì lọt ra ngoài.
			xpChannelMode: isXpChannelMode(row.xp_channel_mode) ? row.xp_channel_mode : DEFAULT_GUILD_SETTINGS.xpChannelMode,
			defaultPollXp: row.default_poll_xp,
			pollXpDailyCap: row.poll_xp_daily_cap,
			contributionVotePoints: row.contribution_vote_points,
			...grants,
		};
	}

	/**
	 * Lưu các mục cấu hình trong `patch` (mục không có giữ nguyên) trong một transaction, kèm một dòng audit `config.update` có
	 * đúng các mục đó. Danh sách role (`adminRoleIds`, `pollCreatorRoleIds`) được THAY TOÀN BỘ bằng mảng mới (bỏ trùng, tối đa
	 * MAX_GRANT_ROLES); role vẫn còn trong danh sách giữ thứ tự cũ. Thêm hoặc bỏ một phần thì dùng changeRoleGrants.
	 */
	updateSettings(guildId: string, patch: Partial<GuildSettings>, actorId: string): GuildSettings
	{
		for (const key of Object.keys(SETTING_LIMITS) as NumericSettingKey[])
		{
			const value = patch[key];
			if (value !== undefined) validateNumber(key, value);
		}
		if (patch.xpChannelMode !== undefined && !isXpChannelMode(patch.xpChannelMode)) throw new UserError("Chế độ kênh tính XP không hợp lệ.");
		const grantLists: Partial<Record<RoleGrantKey, string[]>> = {};
		for (const key of ROLE_GRANT_KEYS)
		{
			const value = patch[key];
			if (value !== undefined) grantLists[key] = normalizeGrantList(key, value);
		}

		const next: GuildSettings = { ...this.getSettings(guildId), ...patch };
		this.db.transaction(() =>
		{
			this.db.prepare(`
				INSERT INTO guild_settings (guild_id, xp_per_message, xp_cooldown_seconds, min_message_length, duplicate_window_seconds,
					level_up_announcements, level_up_channel_id, xp_channel_mode, default_poll_xp, poll_xp_daily_cap, contribution_vote_points,
					updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT (guild_id) DO UPDATE SET
					xp_per_message = excluded.xp_per_message,
					xp_cooldown_seconds = excluded.xp_cooldown_seconds,
					min_message_length = excluded.min_message_length,
					duplicate_window_seconds = excluded.duplicate_window_seconds,
					level_up_announcements = excluded.level_up_announcements,
					level_up_channel_id = excluded.level_up_channel_id,
					xp_channel_mode = excluded.xp_channel_mode,
					default_poll_xp = excluded.default_poll_xp,
					poll_xp_daily_cap = excluded.poll_xp_daily_cap,
					contribution_vote_points = excluded.contribution_vote_points,
					updated_at = excluded.updated_at`,
			).run(
				guildId, next.xpPerMessage, next.xpCooldownSeconds, next.minMessageLength, next.duplicateWindowSeconds,
				next.levelUpAnnouncements ? 1 : 0, next.levelUpChannelId, next.xpChannelMode, next.defaultPollXp, next.pollXpDailyCap, next.contributionVotePoints,
				this.clock.now(),
			);
			for (const key of ROLE_GRANT_KEYS)
			{
				const roleIds = grantLists[key];
				if (roleIds !== undefined) this.replaceGrants(guildId, key, roleIds);
			}
			this.audit.record(guildId, actorId, "config.update", null, { ...patch, ...grantLists });
		})();
		return this.getSettings(guildId);
	}

	/**
	 * Thêm và bỏ role của một danh sách role được cấp quyền theo phần chênh lệch, trong một transaction (bảng cấu hình, web,
	 * lệnh gõ; DEC-044), để hai admin sửa cùng lúc không đè nhau: role trong `add` vốn đã có và role trong `remove` vốn không có
	 * thì bỏ qua. UserError nếu một role vừa ở `add` vừa ở `remove`, hoặc danh sách sau khi lưu quá MAX_GRANT_ROLES role (kiểm tra
	 * trước khi ghi, nên lỗi thì không ghi gì). Có thay đổi thì ghi một dòng audit `config.update` với details
	 * `{ <key>: danh sách sau khi lưu, addedRoles: role vừa thêm, removedRoles: role vừa bỏ }` (khoá có mảng rỗng thì bỏ).
	 * Không kiểm tra role dùng được hay không: đó là việc của tầng Discord (configOps.assertUsableRole).
	 */
	changeRoleGrants(guildId: string, key: RoleGrantKey, change: RoleGrantChange, actorId: string): RoleGrantResult
	{
		const add = [...new Set(change.add ?? [])];
		const remove = [...new Set(change.remove ?? [])];
		if (add.some(roleId => remove.includes(roleId))) throw new UserError("Không thể vừa thêm vừa bỏ cùng một role.");

		return this.db.transaction((): RoleGrantResult =>
		{
			const current = this.grantList(guildId, key);
			const granted = new Set(current);
			const added = add.filter(roleId => !granted.has(roleId));
			const removed = remove.filter(roleId => granted.has(roleId));
			const size = current.length - removed.length + added.length;
			if (added.length > 0 && size > MAX_GRANT_ROLES)
			{
				throw new UserError(`Chỉ được đặt tối đa ${MAX_GRANT_ROLES} ${GRANT_LABELS[key]}: đang có ${current.length} role, `
					+ `lưu thay đổi này sẽ thành ${size} role. Hãy bỏ bớt trước. Bot chưa thay đổi gì.`);
			}
			const alreadyGranted = add.filter(roleId => granted.has(roleId));
			const notGranted = remove.filter(roleId => !granted.has(roleId));
			if (added.length === 0 && removed.length === 0) return { added, removed, alreadyGranted, notGranted, roleIds: current };

			const kind = GRANT_KINDS[key];
			const deleteGrant = this.db.prepare("DELETE FROM guild_role_grants WHERE guild_id = ? AND kind = ? AND role_id = ?");
			for (const roleId of removed) deleteGrant.run(guildId, kind, roleId);
			this.insertGrants(guildId, kind, added);
			const roleIds = this.grantList(guildId, key);
			const details: Record<string, unknown> = { [key]: roleIds };
			if (added.length > 0) details.addedRoles = added;
			if (removed.length > 0) details.removedRoles = removed;
			this.audit.record(guildId, actorId, "config.update", null, details);
			return { added, removed, alreadyGranted, notGranted, roleIds };
		})();
	}

	/** Hai danh sách role được cấp quyền của guild (bảng guild_role_grants), theo created_at rồi role_id. */
	private roleGrants(guildId: string): Pick<GuildSettings, RoleGrantKey>
	{
		const grants: Pick<GuildSettings, RoleGrantKey> = { adminRoleIds: [], pollCreatorRoleIds: [] };
		const rows = this.db.prepare<[string], GrantRow>("SELECT kind, role_id FROM guild_role_grants WHERE guild_id = ? ORDER BY created_at, role_id")
			.all(guildId);
		for (const row of rows)
		{
			if (row.kind === GRANT_KINDS.adminRoleIds) grants.adminRoleIds.push(row.role_id);
			else if (row.kind === GRANT_KINDS.pollCreatorRoleIds) grants.pollCreatorRoleIds.push(row.role_id);
		}
		return grants;
	}

	private grantList(guildId: string, key: RoleGrantKey): string[]
	{
		return this.db.prepare<[string, string], { role_id: string }>(
			"SELECT role_id FROM guild_role_grants WHERE guild_id = ? AND kind = ? ORDER BY created_at, role_id",
		).all(guildId, GRANT_KINDS[key]).map(row => row.role_id);
	}

	private insertGrants(guildId: string, kind: string, roleIds: readonly string[]): void
	{
		const insert = this.db.prepare("INSERT INTO guild_role_grants (guild_id, kind, role_id, created_at) VALUES (?, ?, ?, ?)");
		const now = this.clock.now();
		for (const roleId of roleIds) insert.run(guildId, kind, roleId, now);
	}

	/** Đặt danh sách `key` đúng bằng `roleIds` (đã bỏ trùng): xoá role không còn, thêm role mới; role giữ lại không đổi thứ tự. */
	private replaceGrants(guildId: string, key: RoleGrantKey, roleIds: readonly string[]): void
	{
		const kind = GRANT_KINDS[key];
		const current = new Set(this.grantList(guildId, key));
		const wanted = new Set(roleIds);
		const deleteGrant = this.db.prepare("DELETE FROM guild_role_grants WHERE guild_id = ? AND kind = ? AND role_id = ?");
		for (const roleId of current)
		{
			if (!wanted.has(roleId)) deleteGrant.run(guildId, kind, roleId);
		}
		this.insertGrants(guildId, kind, roleIds.filter(roleId => !current.has(roleId)));
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
	 * thì bỏ qua (không ghi, không audit). Kênh đổi trạng thái được lưu thành cấu hình riêng (như `/config channel set`),
	 * giữ nguyên XP/cooldown riêng nếu có, nên trạng thái admin đặt vẫn giữ khi đổi chế độ kênh về sau. Mỗi kênh đổi trạng
	 * thái có một dòng audit `channel.set` với `xpEnabled`. UserError nếu danh sách rỗng hoặc quá `maxChannels` kênh (sau khi
	 * bỏ trùng; mặc định MAX_BULK_CHANNELS cho menu Discord, web dùng MAX_WEB_BULK_CHANNELS).
	 */
	setChannelsXpEnabled(guildId: string, channelIds: readonly string[], enabled: boolean, actorId: string, maxChannels = MAX_BULK_CHANNELS): BulkChannelResult
	{
		const unique = [...new Set(channelIds)];
		if (unique.length === 0) throw new UserError("Hãy chọn ít nhất một kênh.");
		if (unique.length > maxChannels) throw new UserError(`Mỗi lần chỉ bật hoặc tắt tối đa ${maxChannels} kênh.`);

		return this.db.transaction((): BulkChannelResult =>
		{
			const mode = this.getSettings(guildId).xpChannelMode;
			const result: BulkChannelResult = { changed: [], unchanged: [] };
			for (const channelId of unique)
			{
				const row = this.channelRow(guildId, channelId);
				const current = row ? toChannel(row) : defaultChannel(channelId, mode);
				if (current.xpEnabled === enabled)
				{
					result.unchanged.push(channelId);
					continue;
				}
				this.writeChannel(guildId, { ...current, xpEnabled: enabled });
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
