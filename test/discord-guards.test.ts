import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ChannelType, GuildMember, Interaction, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import type DiscordClient from "../src/classes/DiscordClient";
import { assertCanSendMessages, canSendMessages, canViewChannel, filterViewable } from "../src/discord/guards";
import { DEFAULT_GUILD_SETTINGS, GuildSettings } from "../src/modules/guild-config/types";
import { AppServices } from "../src/services";
import { UserError } from "../src/shared/errors";
import { ADMIN, CHANNEL_BOT, CHANNEL_GENERAL, GUILD, OTHER_GUILD, ROLE_BACKEND, USER_A, USER_B } from "./helpers";

const CHANNEL_PRIVATE = "400000000000000003";
const CHANNEL_DELETED = "400000000000000004";
const THREAD_PRIVATE = "400000000000000005";
const CHANNEL_FOREIGN = "400000000000000006";
const CHANNEL_UNKNOWN_PERMS = "400000000000000007";
const DM_CHANNEL = "400000000000000008";

// ---------- Interaction giả ----------

interface InteractionSpec
{
	userId?: string;
	roleIds?: string[];
	permissions?: bigint[] | null;
	thread?: boolean | null;
	member?: unknown;
}

function interactionOf(spec: InteractionSpec = {}): Interaction
{
	const channel = spec.thread === null || spec.thread === undefined ? null : { isThread: () => spec.thread };
	const fake = {
		guildId: GUILD,
		user: { id: spec.userId ?? USER_B },
		member: spec.member ?? { roles: spec.roleIds ?? [] },
		memberPermissions: spec.permissions === null ? null : new PermissionsBitField(spec.permissions ?? []),
		channel,
		inGuild: () => true,
	};
	return fake as unknown as Interaction;
}

// ---------- Channel và client giả ----------

interface ChannelSpec
{
	guildId?: string;
	type?: ChannelType;
	dm?: boolean;
	/** Người có View Channel. */
	viewers?: string[];
	/** Người có Manage Threads. */
	threadManagers?: string[];
	/** Thành viên của thread riêng tư. */
	threadMembers?: string[];
	/** permissionsFor trả về null (không tính được quyền, ví dụ member không có trong cache). */
	unknownPermissions?: boolean;
}

interface Recorder
{
	fetched: string[];
	permissionSubjects: unknown[];
	threadMemberLookups: string[];
}

function channelOf(spec: ChannelSpec, recorder: Recorder): unknown
{
	return {
		guildId: spec.guildId ?? GUILD,
		type: spec.type ?? ChannelType.GuildText,
		isDMBased: () => spec.dm ?? false,
		permissionsFor: (subject: unknown) =>
		{
			recorder.permissionSubjects.push(subject);
			if (spec.unknownPermissions) return null;
			const bits: bigint[] = [];
			const id = subject instanceof GuildMember ? USER_B : subject;
			if (typeof id === "string" && (spec.viewers ?? []).includes(id)) bits.push(PermissionFlagsBits.ViewChannel);
			if (typeof id === "string" && (spec.threadManagers ?? []).includes(id)) bits.push(PermissionFlagsBits.ManageThreads);
			return new PermissionsBitField(bits);
		},
		members: {
			fetch: ({ member }: { member: string }) =>
			{
				recorder.threadMemberLookups.push(member);
				return (spec.threadMembers ?? []).includes(member) ? Promise.resolve({ id: member }) : Promise.reject(new Error("Unknown Member"));
			},
		},
	};
}

const EVERYONE = [ADMIN, USER_A, USER_B];

const CHANNELS: Record<string, ChannelSpec | "throw" | null> = {
	[CHANNEL_GENERAL]: { viewers: EVERYONE },
	[CHANNEL_BOT]: { viewers: EVERYONE },
	[CHANNEL_PRIVATE]: { viewers: [USER_A] },
	[CHANNEL_DELETED]: "throw",
	[THREAD_PRIVATE]: { type: ChannelType.PrivateThread, viewers: EVERYONE, threadMembers: [USER_A], threadManagers: [ADMIN] },
	[CHANNEL_FOREIGN]: { guildId: OTHER_GUILD, viewers: EVERYONE },
	[CHANNEL_UNKNOWN_PERMS]: { unknownPermissions: true },
	[DM_CHANNEL]: { dm: true },
};

function clientOf(settings: Partial<GuildSettings> = {}): { client: DiscordClient; recorder: Recorder }
{
	const recorder: Recorder = { fetched: [], permissionSubjects: [], threadMemberLookups: [] };
	const services = { guildConfig: { getSettings: (): GuildSettings => ({ ...DEFAULT_GUILD_SETTINGS, ...settings }) } };
	const client = {
		services: services as unknown as AppServices,
		channels: {
			fetch: (id: string) =>
			{
				recorder.fetched.push(id);
				const spec = CHANNELS[id];
				if (spec === "throw") return Promise.reject(new Error("Unknown Channel"));
				return Promise.resolve(spec ? channelOf(spec, recorder) : null);
			},
		},
	};
	return { client: client as unknown as DiscordClient, recorder };
}

const MANAGE_GUILD = [PermissionFlagsBits.ManageGuild];

describe("canSendMessages", () =>
{
	test("kênh thường cần Send Messages", () =>
	{
		assert.equal(canSendMessages(interactionOf({ thread: false, permissions: [PermissionFlagsBits.SendMessages] })), true);
		assert.equal(canSendMessages(interactionOf({ thread: false, permissions: [PermissionFlagsBits.SendMessagesInThreads] })), false);
		assert.equal(canSendMessages(interactionOf({ thread: false, permissions: [] })), false);
	});

	test("trong thread cần Send Messages in Threads", () =>
	{
		assert.equal(canSendMessages(interactionOf({ thread: true, permissions: [PermissionFlagsBits.SendMessagesInThreads] })), true);
		assert.equal(canSendMessages(interactionOf({ thread: true, permissions: [PermissionFlagsBits.SendMessages] })), false);
	});

	test("không rõ kênh thì dùng Send Messages; không có thông tin quyền thì từ chối", () =>
	{
		assert.equal(canSendMessages(interactionOf({ thread: null, permissions: [PermissionFlagsBits.SendMessages] })), true);
		assert.equal(canSendMessages(interactionOf({ thread: null, permissions: [PermissionFlagsBits.SendMessagesInThreads] })), false);
		assert.equal(canSendMessages(interactionOf({ permissions: null })), false);
	});

	test("assertCanSendMessages báo lỗi tiếng Việt", () =>
	{
		assert.throws(
			() => assertCanSendMessages(interactionOf({ permissions: [] })),
			(error: unknown) => error instanceof UserError && error.message === "Bạn không có quyền gửi tin nhắn trong kênh này.",
		);
		assert.doesNotThrow(() => assertCanSendMessages(interactionOf({ permissions: [PermissionFlagsBits.SendMessages] })));
	});
});

describe("canViewChannel", () =>
{
	test("mục chưa gắn kênh: ai cũng xem được, không gọi Discord", async () =>
	{
		const { client, recorder } = clientOf();
		assert.equal(await canViewChannel(client, interactionOf(), null), true);
		assert.deepEqual(recorder.fetched, []);
	});

	test("cần View Channel ở kênh gốc", async () =>
	{
		const { client } = clientOf();
		assert.equal(await canViewChannel(client, interactionOf({ userId: USER_B }), CHANNEL_GENERAL), true);
		assert.equal(await canViewChannel(client, interactionOf({ userId: USER_A }), CHANNEL_PRIVATE), true);
		assert.equal(await canViewChannel(client, interactionOf({ userId: USER_B }), CHANNEL_PRIVATE), false);
	});

	test("admin bot không xem được kênh riêng tư mà Discord không cho họ xem", async () =>
	{
		const { client } = clientOf({ adminRoleIds: [ROLE_BACKEND] });
		assert.equal(await canViewChannel(client, interactionOf({ userId: ADMIN, permissions: MANAGE_GUILD }), CHANNEL_PRIVATE), false);
		assert.equal(await canViewChannel(client, interactionOf({ userId: USER_B, roleIds: [ROLE_BACKEND] }), CHANNEL_PRIVATE), false);
	});

	test("kênh không còn, không lấy được, thuộc guild khác, là DM hoặc không tính được quyền: chỉ admin xem được", async () =>
	{
		const { client } = clientOf({ adminRoleIds: [ROLE_BACKEND] });
		const unreachable = [CHANNEL_DELETED, "400000000000000404", CHANNEL_FOREIGN, DM_CHANNEL, CHANNEL_UNKNOWN_PERMS];
		for (const channelId of unreachable)
		{
			assert.equal(await canViewChannel(client, interactionOf({ userId: USER_B }), channelId), false, channelId);
			assert.equal(await canViewChannel(client, interactionOf({ userId: ADMIN, permissions: MANAGE_GUILD }), channelId), true, channelId);
			assert.equal(await canViewChannel(client, interactionOf({ userId: USER_A, roleIds: [ROLE_BACKEND] }), channelId), true, channelId);
		}
	});

	test("thread riêng tư: cần là thành viên thread hoặc có Manage Threads", async () =>
	{
		const { client, recorder } = clientOf();
		assert.equal(await canViewChannel(client, interactionOf({ userId: USER_A }), THREAD_PRIVATE), true);
		assert.equal(await canViewChannel(client, interactionOf({ userId: USER_B }), THREAD_PRIVATE), false);
		assert.deepEqual(recorder.threadMemberLookups, [USER_A, USER_B]);

		assert.equal(await canViewChannel(client, interactionOf({ userId: ADMIN }), THREAD_PRIVATE), true);
		assert.deepEqual(recorder.threadMemberLookups, [USER_A, USER_B], "có Manage Threads thì không cần hỏi Discord");
	});

	test("member là GuildMember thì tính quyền trên chính member đó; dữ liệu thô thì dùng user ID", async () =>
	{
		const { client, recorder } = clientOf();
		const member = Object.create(GuildMember.prototype) as GuildMember;
		assert.equal(await canViewChannel(client, interactionOf({ member }), CHANNEL_GENERAL), true);
		assert.equal(recorder.permissionSubjects[0], member);

		await canViewChannel(client, interactionOf({ userId: USER_A }), CHANNEL_GENERAL);
		assert.equal(recorder.permissionSubjects[1], USER_A);
	});
});

describe("filterViewable", () =>
{
	test("giữ đúng thứ tự, bỏ mục không xem được, mỗi kênh chỉ kiểm tra một lần", async () =>
	{
		const { client, recorder } = clientOf();
		const items = [
			{ id: 1, channelId: CHANNEL_GENERAL },
			{ id: 2, channelId: CHANNEL_PRIVATE },
			{ id: 3, channelId: null },
			{ id: 4, channelId: CHANNEL_GENERAL },
			{ id: 5, channelId: CHANNEL_DELETED },
			{ id: 6, channelId: CHANNEL_PRIVATE },
			{ id: 7, channelId: CHANNEL_BOT },
		];

		const visible = await filterViewable(client, interactionOf({ userId: USER_B }), items);
		assert.deepEqual(visible.map(item => item.id), [1, 3, 4, 7]);
		assert.deepEqual([...recorder.fetched].sort(), [CHANNEL_GENERAL, CHANNEL_PRIVATE, CHANNEL_DELETED, CHANNEL_BOT].sort());

		const forA = await filterViewable(client, interactionOf({ userId: USER_A }), items);
		assert.deepEqual(forA.map(item => item.id), [1, 2, 3, 4, 6, 7]);
	});
});
