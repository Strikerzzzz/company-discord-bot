import { Guild, GuildMember, ImageURLOptions, RESTJSONErrorCodes, User } from "discord.js";
import { logger } from "../shared/logger";

/*
 * Tên hiển thị và avatar của thành viên để vẽ bảng xếp hạng (DEC-030). Thứ tự tra: cache riêng có hạn dùng, rồi REST
 * từng người, cuối cùng (chỉ khi REST lỗi tạm thời) mới dùng cache thành viên của discord.js làm dữ liệu dự phòng.
 * Bot không dùng intent GuildMembers nên không nhận cập nhật thành viên: cache của discord.js có thể giữ tên/avatar cũ
 * mãi, vì vậy không đọc nó trước, và REST gọi với cache: false để không nhét thêm vào cache đó (không giới hạn, không
 * có sweeper). Không dùng guild.members.fetch({ user: [...] }) vì đó là yêu cầu qua gateway (opcode 8), bị giới hạn
 * tần suất chặt.
 */

export interface MemberDisplay
{
	displayName: string;
	/** URL avatar PNG tĩnh (128 px) trên CDN của Discord; null nếu không biết người này. */
	avatarUrl: string | null;
	/** false nếu người này đã rời server (hoặc không tra được). */
	inGuild: boolean;
}

export const UNKNOWN_MEMBER_NAME = "Người dùng không rõ";

export interface MemberDirectoryOptions
{
	/** Thời gian giữ kết quả tra được (mặc định 10 phút). */
	ttlMs?: number;
	/** Thời gian giữ kết quả "không rõ" do lỗi tạm thời, để không gọi lại liên tục (mặc định 1 phút). */
	failureTtlMs?: number;
	/** Số mục tối đa trong cache LRU (mặc định 2000). */
	maxEntries?: number;
	/** Số request REST chạy đồng thời tối đa (mặc định 4). */
	concurrency?: number;
	now?: () => number;
}

interface CacheEntry
{
	value: MemberDisplay;
	expiresAt: number;
}

interface Lookup
{
	value: MemberDisplay;
	/** false = kết quả do lỗi tạm thời, giữ ngắn hơn. */
	reliable: boolean;
}

const AVATAR_OPTIONS: ImageURLOptions = { extension: "png", size: 128, forceStatic: true };

/** Mã lỗi JSON của Discord API (ví dụ 10007 Unknown Member) nếu `error` là lỗi REST của Discord; ngược lại null. */
export function discordErrorCode(error: unknown): number | null
{
	if (typeof error !== "object" || error === null || !("code" in error)) return null;
	return typeof error.code === "number" ? error.code : null;
}

function unknownMember(): MemberDisplay
{
	return { displayName: UNKNOWN_MEMBER_NAME, avatarUrl: null, inGuild: false };
}

function fromMember(member: GuildMember): MemberDisplay
{
	return { displayName: member.displayName, avatarUrl: member.displayAvatarURL(AVATAR_OPTIONS), inGuild: true };
}

function fromUser(user: User): MemberDisplay
{
	return { displayName: user.displayName, avatarUrl: user.displayAvatarURL(AVATAR_OPTIONS), inGuild: false };
}

export class MemberDirectory
{
	private readonly ttlMs: number;
	private readonly failureTtlMs: number;
	private readonly maxEntries: number;
	private readonly concurrency: number;
	private readonly now: () => number;
	private readonly cache = new Map<string, CacheEntry>();

	constructor(options: MemberDirectoryOptions = {})
	{
		this.ttlMs = options.ttlMs ?? 10 * 60 * 1000;
		this.failureTtlMs = options.failureTtlMs ?? 60 * 1000;
		this.maxEntries = Math.max(1, options.maxEntries ?? 2000);
		this.concurrency = Math.max(1, Math.floor(options.concurrency ?? 4));
		this.now = options.now ?? Date.now;
	}

	/** Số mục đang nằm trong cache riêng. */
	get size(): number
	{
		return this.cache.size;
	}

	/** Tên hiển thị và avatar của từng user ID (mỗi ID một mục, kể cả ID trùng hay không tra được). Không bao giờ throw. */
	async resolve(guild: Guild, userIds: readonly string[]): Promise<Map<string, MemberDisplay>>
	{
		const result = new Map<string, MemberDisplay>();
		try
		{
			const missing: string[] = [];
			for (const userId of new Set(userIds))
			{
				const found = this.fromCache(guild.id, userId);
				if (found) result.set(userId, found);
				else missing.push(userId);
			}

			const queue = [...missing];
			const worker = async (): Promise<void> =>
			{
				for (let userId = queue.shift(); userId !== undefined; userId = queue.shift())
				{
					const lookup = await this.lookup(guild, userId);
					this.remember(guild.id, userId, lookup);
					result.set(userId, lookup.value);
				}
			};
			await Promise.all(Array.from({ length: Math.min(this.concurrency, missing.length) }, worker));
		}
		catch (error)
		{
			logger.debug("Lỗi không mong đợi khi tra tên thành viên.", error);
		}

		for (const userId of userIds)
		{
			if (!result.has(userId)) result.set(userId, unknownMember());
		}
		return result;
	}

	private fromCache(guildId: string, userId: string): MemberDisplay | null
	{
		const key = `${guildId}:${userId}`;
		const cached = this.cache.get(key);
		if (!cached) return null;
		this.cache.delete(key);
		if (cached.expiresAt <= this.now()) return null;
		this.cache.set(key, cached);
		return cached.value;
	}

	private async lookup(guild: Guild, userId: string): Promise<Lookup>
	{
		try
		{
			return { value: fromMember(await guild.members.fetch({ user: userId, cache: false, force: true })), reliable: true };
		}
		catch (error)
		{
			if (discordErrorCode(error) !== RESTJSONErrorCodes.UnknownMember)
			{
				logger.debug(`Không tra được thành viên ${userId}:`, error);
				return this.fallback(guild, userId);
			}
		}

		try
		{
			return { value: fromUser(await guild.client.users.fetch(userId, { cache: false, force: true })), reliable: true };
		}
		catch (error)
		{
			logger.debug(`Không tra được user ${userId}:`, error);
			return { value: unknownMember(), reliable: discordErrorCode(error) === RESTJSONErrorCodes.UnknownUser };
		}
	}

	/**
	 * REST lỗi tạm thời (mạng, 5xx, rate limit): dùng thành viên trong cache của discord.js nếu có (có thể đã cũ nhưng
	 * vẫn hơn "không rõ"), ngược lại "không rõ". Cả hai đều chỉ giữ ngắn hạn để sớm thử lại REST.
	 */
	private fallback(guild: Guild, userId: string): Lookup
	{
		try
		{
			const member = guild.members.cache.get(userId);
			if (member) return { value: fromMember(member), reliable: false };
		}
		catch (error)
		{
			logger.debug(`Không đọc được thành viên ${userId} trong cache của discord.js:`, error);
		}
		return { value: unknownMember(), reliable: false };
	}

	private remember(guildId: string, userId: string, lookup: Lookup): void
	{
		const key = `${guildId}:${userId}`;
		this.cache.delete(key);
		this.cache.set(key, { value: lookup.value, expiresAt: this.now() + (lookup.reliable ? this.ttlMs : this.failureTtlMs) });
		while (this.cache.size > this.maxEntries)
		{
			const oldest = this.cache.keys().next();
			if (oldest.done) break;
			this.cache.delete(oldest.value);
		}
	}
}
