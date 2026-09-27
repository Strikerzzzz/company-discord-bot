import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Guild, ImageURLOptions } from "discord.js";
import { discordErrorCode, MemberDirectory, UNKNOWN_MEMBER_NAME } from "../src/discord/memberDirectory";
import { GUILD, OTHER_GUILD, USER_A, USER_B, USER_C } from "./helpers";

const MINUTE = 60_000;

interface FakeProfile
{
	id: string;
	displayName: string;
	displayAvatarURL: (options?: ImageURLOptions) => string;
}

function profile(id: string, displayName: string, avatarOptions: (ImageURLOptions | undefined)[] = []): FakeProfile
{
	return {
		id,
		displayName,
		displayAvatarURL: options =>
		{
			avatarOptions.push(options);
			return `https://cdn.discordapp.com/avatars/${id}/a.png?size=${options?.size ?? 0}`;
		},
	};
}

function discordError(code: number): Error
{
	return Object.assign(new Error(`Discord API error ${code}`), { code });
}

type Outcome = FakeProfile | Error | (() => Promise<FakeProfile>);

interface FakeGuildOptions
{
	id?: string;
	cached?: FakeProfile[];
	members?: Record<string, Outcome>;
	users?: Record<string, Outcome>;
}

interface FakeGuild
{
	guild: Guild;
	memberFetches: string[];
	userFetches: string[];
}

function settle(outcome: Outcome | undefined, fallback: Error): Promise<FakeProfile>
{
	if (outcome === undefined) return Promise.reject(fallback);
	if (outcome instanceof Error) return Promise.reject(outcome);
	if (typeof outcome === "function") return outcome();
	return Promise.resolve(outcome);
}

function fakeGuild(options: FakeGuildOptions = {}): FakeGuild
{
	const memberFetches: string[] = [];
	const userFetches: string[] = [];
	const cache = new Map((options.cached ?? []).map(member => [member.id, member]));
	const guild = {
		id: options.id ?? GUILD,
		members: {
			cache,
			fetch: (userId: unknown) =>
			{
				assert.equal(typeof userId, "string", "phải gọi REST từng người bằng user ID, không dùng fetch({ user: [...] })");
				memberFetches.push(String(userId));
				return settle(options.members?.[String(userId)], discordError(10007));
			},
		},
		client: {
			users: {
				fetch: (userId: string) =>
				{
					userFetches.push(userId);
					return settle(options.users?.[userId], discordError(10013));
				},
			},
		},
	};
	return { guild: guild as unknown as Guild, memberFetches, userFetches };
}

describe("MemberDirectory", () =>
{
	test("member có trong cache của discord.js: không gọi REST, avatar PNG tĩnh 128 px", async () =>
	{
		const avatarOptions: (ImageURLOptions | undefined)[] = [];
		const fake = fakeGuild({ cached: [profile(USER_A, "Anh A", avatarOptions)] });
		const result = await new MemberDirectory().resolve(fake.guild, [USER_A]);

		assert.deepEqual(result.get(USER_A), {
			displayName: "Anh A",
			avatarUrl: `https://cdn.discordapp.com/avatars/${USER_A}/a.png?size=128`,
			inGuild: true,
		});
		assert.deepEqual(avatarOptions, [{ extension: "png", size: 128, forceStatic: true }]);
		assert.deepEqual(fake.memberFetches, []);
	});

	test("không có trong cache: gọi REST từng người, kết quả được giữ trong cache riêng tới khi hết hạn", async () =>
	{
		let now = 1_000_000;
		const directory = new MemberDirectory({ now: () => now, ttlMs: 10 * MINUTE });
		const fake = fakeGuild({ members: { [USER_A]: profile(USER_A, "Anh A") } });

		const first = await directory.resolve(fake.guild, [USER_A]);
		assert.deepEqual(first.get(USER_A)?.displayName, "Anh A");
		assert.equal(first.get(USER_A)?.inGuild, true);
		assert.deepEqual(fake.memberFetches, [USER_A]);

		now += 10 * MINUTE - 1;
		await directory.resolve(fake.guild, [USER_A]);
		assert.deepEqual(fake.memberFetches, [USER_A], "còn hạn thì không gọi lại");

		now += 1;
		await directory.resolve(fake.guild, [USER_A]);
		assert.deepEqual(fake.memberFetches, [USER_A, USER_A], "hết hạn thì gọi lại");
	});

	test("cache riêng theo từng guild", async () =>
	{
		const directory = new MemberDirectory();
		const one = fakeGuild({ members: { [USER_A]: profile(USER_A, "A ở server 1") } });
		const two = fakeGuild({ id: OTHER_GUILD, members: { [USER_A]: profile(USER_A, "A ở server 2") } });
		assert.equal((await directory.resolve(one.guild, [USER_A])).get(USER_A)?.displayName, "A ở server 1");
		assert.equal((await directory.resolve(two.guild, [USER_A])).get(USER_A)?.displayName, "A ở server 2");
	});

	test("đã rời server (10007): lấy tên và avatar của user, inGuild false", async () =>
	{
		const avatarOptions: (ImageURLOptions | undefined)[] = [];
		const fake = fakeGuild({ members: { [USER_B]: discordError(10007) }, users: { [USER_B]: profile(USER_B, "Người B", avatarOptions) } });
		const result = await new MemberDirectory().resolve(fake.guild, [USER_B]);

		assert.deepEqual(result.get(USER_B), {
			displayName: "Người B",
			avatarUrl: `https://cdn.discordapp.com/avatars/${USER_B}/a.png?size=128`,
			inGuild: false,
		});
		assert.deepEqual(avatarOptions, [{ extension: "png", size: 128, forceStatic: true }]);
		assert.deepEqual(fake.userFetches, [USER_B]);
	});

	test("không tra được user: \"Người dùng không rõ\", không có avatar", async () =>
	{
		const fake = fakeGuild({ members: { [USER_C]: discordError(10007) }, users: { [USER_C]: discordError(10013) } });
		const directory = new MemberDirectory();
		const result = await directory.resolve(fake.guild, [USER_C]);
		assert.deepEqual(result.get(USER_C), { displayName: UNKNOWN_MEMBER_NAME, avatarUrl: null, inGuild: false });

		await directory.resolve(fake.guild, [USER_C]);
		assert.deepEqual(fake.memberFetches, [USER_C], "user không tồn tại được giữ trong cache như kết quả bình thường");
	});

	test("lỗi khác (mạng, 5xx): không thử users.fetch, giữ kết quả ngắn hạn rồi thử lại", async () =>
	{
		let now = 0;
		const directory = new MemberDirectory({ now: () => now, failureTtlMs: MINUTE });
		const fake = fakeGuild({ members: { [USER_A]: new Error("socket hang up") } });

		const result = await directory.resolve(fake.guild, [USER_A]);
		assert.deepEqual(result.get(USER_A), { displayName: UNKNOWN_MEMBER_NAME, avatarUrl: null, inGuild: false });
		assert.deepEqual(fake.userFetches, []);

		now += MINUTE - 1;
		await directory.resolve(fake.guild, [USER_A]);
		assert.equal(fake.memberFetches.length, 1);
		now += 1;
		await directory.resolve(fake.guild, [USER_A]);
		assert.equal(fake.memberFetches.length, 2);
	});

	test("ID trùng chỉ tra một lần; kết quả có đủ mọi ID; không bao giờ throw", async () =>
	{
		const fake = fakeGuild({ cached: [profile(USER_A, "Anh A")], members: { [USER_B]: profile(USER_B, "Người B") } });
		const result = await new MemberDirectory().resolve(fake.guild, [USER_B, USER_A, USER_B, USER_C]);
		assert.deepEqual([...result.keys()].sort(), [USER_A, USER_B, USER_C].sort());
		assert.equal(result.get(USER_C)?.displayName, UNKNOWN_MEMBER_NAME);
		assert.deepEqual(fake.memberFetches, [USER_B, USER_C]);

		const broken = { id: GUILD, members: { cache: { get: () => { throw new Error("hỏng"); } } } } as unknown as Guild;
		const fallback = await new MemberDirectory().resolve(broken, [USER_A]);
		assert.deepEqual(fallback.get(USER_A), { displayName: UNKNOWN_MEMBER_NAME, avatarUrl: null, inGuild: false });
	});

	test("tối đa 4 request REST đồng thời", async () =>
	{
		const ids = Array.from({ length: 10 }, (_, index) => `3000000000000010${String(index).padStart(2, "0")}`);
		let active = 0;
		let peak = 0;
		const members: Record<string, Outcome> = {};
		for (const id of ids)
		{
			members[id] = async () =>
			{
				active++;
				peak = Math.max(peak, active);
				await new Promise(resolve => setTimeout(resolve, 5));
				active--;
				return profile(id, `Người ${id.slice(-2)}`);
			};
		}
		const fake = fakeGuild({ members });
		const result = await new MemberDirectory().resolve(fake.guild, ids);

		assert.equal(peak, 4);
		assert.equal(fake.memberFetches.length, 10);
		assert.deepEqual(ids.map(id => result.get(id)?.displayName), ids.map(id => `Người ${id.slice(-2)}`));
	});

	test("cache LRU giới hạn số mục", async () =>
	{
		const directory = new MemberDirectory({ maxEntries: 2 });
		const fake = fakeGuild({ members: { [USER_A]: profile(USER_A, "A"), [USER_B]: profile(USER_B, "B"), [USER_C]: profile(USER_C, "C") } });
		await directory.resolve(fake.guild, [USER_A]);
		await directory.resolve(fake.guild, [USER_B]);
		await directory.resolve(fake.guild, [USER_A]);
		await directory.resolve(fake.guild, [USER_C]);
		assert.equal(directory.size, 2);

		fake.memberFetches.length = 0;
		await directory.resolve(fake.guild, [USER_A, USER_B]);
		assert.deepEqual(fake.memberFetches, [USER_B], "B dùng lâu nhất nên bị bỏ trước");
	});

	test("discordErrorCode chỉ đọc mã số của lỗi", () =>
	{
		assert.equal(discordErrorCode(discordError(10008)), 10008);
		assert.equal(discordErrorCode(Object.assign(new Error("x"), { code: "ECONNRESET" })), null);
		assert.equal(discordErrorCode("10008"), null);
		assert.equal(discordErrorCode(null), null);
	});
});
