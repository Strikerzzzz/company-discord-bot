// Bộ dựng test cho trang web quản trị (DEC-039): service thật trên SQLite :memory:, server Discord giả (guild, role, kênh,
// thành viên), fetch giả cho OAuth2 của Discord, gọi thẳng bộ xử lý thuần createWebHandler (không cần socket).
import { tmpdir } from "node:os";
import path from "node:path";
import { ChannelType, Collection, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import type { Guild, Role } from "discord.js";
import type DiscordClient from "../src/classes/DiscordClient";
import type { LiveBoardActions } from "../src/discord/configOps";
import { openDatabase } from "../src/db/connection";
import { runMigrations } from "../src/db/migrations";
import { AppServices, createServices } from "../src/services";
import type { WebRequest, WebResponse } from "../src/web/http";
import { createWebHandler, SESSION_COOKIE, STATE_COOKIE, WebHandler } from "../src/web/server";
import type { WebSession } from "../src/web/session";
import type { PageModule, WebDeps } from "../src/web/types";
import { FakeClock, GUILD } from "./helpers";

export const BASE_URL = "http://192.168.0.206:8787";
export const HOST = "192.168.0.206:8787";
export const APP_ID = "1554342618434109440";
export const GUILD_NAME = "ezOne";
/** Có quyền Manage Server. */
export const ADMIN_USER = "310000000000000001";
/** Chỉ có role admin bot (sau khi test đặt role đó làm role admin). */
export const ROLE_ADMIN_USER = "310000000000000002";
/** Thành viên thường. */
export const PLAIN_USER = "310000000000000003";
/** Không có trong server. */
export const STRANGER = "310000000000000004";
export const BOT_ID = APP_ID;
export const ROLE_ADMIN_BOT = "510000000000000001";
export const ROLE_TEAM_A = "510000000000000002";
export const ROLE_TEAM_B = "510000000000000003";
export const ROLE_MANAGED = "510000000000000004";
export const CATEGORY_MAIN = "410000000000000001";
export const CHANNEL_CHAT = "410000000000000002";
export const CHANNEL_WORK = "410000000000000003";
export const CHANNEL_VOICE = "410000000000000004";
export const CHANNEL_ANNOUNCE = "410000000000000005";

export interface FakeMemberSpec
{
	id: string;
	displayName: string;
	permissions: bigint[];
	roleIds: string[];
}

export interface FakeChannelSpec
{
	id: string;
	name: string;
	type: ChannelType;
	parentId?: string | null;
	position?: number;
	/** Quyền theo kênh của từng thành viên (mặc định: quyền cấp server của thành viên đó). */
	permissionsByMember?: Record<string, bigint[]>;
}

export interface FakeRoleSpec
{
	id: string;
	name: string;
	managed?: boolean;
	position?: number;
	color?: number;
}

export interface WebWorld
{
	guild: Guild;
	roles: Collection<string, Role>;
	channels: Collection<string, object>;
	members: Map<string, FakeMemberSpec>;
}

function memberObject(world: WebWorld, spec: FakeMemberSpec): object
{
	const roles = new Collection<string, Role>();
	for (const roleId of spec.roleIds)
	{
		const role = world.roles.get(roleId);
		if (role) roles.set(roleId, role);
	}
	return {
		id: spec.id,
		user: { id: spec.id, username: spec.displayName },
		displayName: spec.displayName,
		guild: world.guild,
		permissions: new PermissionsBitField(spec.permissions),
		roles: { cache: roles, highest: roles.first() ?? { id: GUILD, position: 0 } },
	};
}

export function addRole(world: WebWorld, spec: FakeRoleSpec): void
{
	world.roles.set(spec.id, {
		id: spec.id,
		name: spec.name,
		managed: spec.managed ?? false,
		position: spec.position ?? 1,
		color: spec.color ?? 0,
		hexColor: `#${(spec.color ?? 0).toString(16).padStart(6, "0")}`,
		permissions: new PermissionsBitField([]),
		guild: world.guild,
	} as unknown as Role);
}

export function addChannel(world: WebWorld, spec: FakeChannelSpec): void
{
	world.channels.set(spec.id, {
		id: spec.id,
		name: spec.name,
		type: spec.type,
		parentId: spec.parentId ?? null,
		position: spec.position ?? 0,
		rawPosition: spec.position ?? 0,
		guild: world.guild,
		guildId: world.guild.id,
		isThread: () => false,
		permissionsFor(member: { id: string }): PermissionsBitField
		{
			const own = spec.permissionsByMember?.[member.id];
			if (own) return new PermissionsBitField(own);
			const memberSpec = world.members.get(member.id);
			return new PermissionsBitField(memberSpec?.permissions ?? []);
		},
	});
}

export function setMember(world: WebWorld, spec: FakeMemberSpec): void
{
	world.members.set(spec.id, spec);
}

/** Server giả "ezOne": role admin bot, 2 role team, 1 role do integration quản lý; 1 category, 4 kênh; 3 thành viên và bot. */
export function createWorld(): WebWorld
{
	const roles = new Collection<string, Role>();
	const channels = new Collection<string, object>();
	const members = new Map<string, FakeMemberSpec>();
	const memberCache = new Collection<string, object>();
	const guild = {
		id: GUILD,
		name: GUILD_NAME,
		ownerId: ADMIN_USER,
		roles: { cache: roles, everyone: { id: GUILD } },
		channels: { cache: channels },
		members: {
			cache: memberCache,
			me: null as object | null,
			fetch: (options: { user: string }): Promise<object> =>
			{
				const spec = members.get(options.user);
				if (!spec) return Promise.reject(new Error("Unknown Member"));
				const member = memberObject(world, spec);
				memberCache.set(spec.id, member);
				return Promise.resolve(member);
			},
		},
	};
	const world: WebWorld = { guild: guild as unknown as Guild, roles, channels, members };

	addRole(world, { id: GUILD, name: "@everyone", position: 0 });
	addRole(world, { id: ROLE_ADMIN_BOT, name: "Admin bot", position: 5 });
	addRole(world, { id: ROLE_TEAM_A, name: "Backend", position: 3, color: 0x3498db });
	addRole(world, { id: ROLE_TEAM_B, name: "Frontend", position: 2 });
	addRole(world, { id: ROLE_MANAGED, name: "Bot khác", managed: true, position: 4 });
	addChannel(world, { id: CATEGORY_MAIN, name: "Chung", type: ChannelType.GuildCategory, position: 0 });
	addChannel(world, { id: CHANNEL_CHAT, name: "chung", type: ChannelType.GuildText, parentId: CATEGORY_MAIN, position: 1 });
	addChannel(world, { id: CHANNEL_WORK, name: "cong-viec", type: ChannelType.GuildText, parentId: CATEGORY_MAIN, position: 2 });
	addChannel(world, { id: CHANNEL_VOICE, name: "hop", type: ChannelType.GuildVoice, parentId: CATEGORY_MAIN, position: 3 });
	addChannel(world, { id: CHANNEL_ANNOUNCE, name: "thong-bao", type: ChannelType.GuildAnnouncement, position: 4 });

	setMember(world, { id: ADMIN_USER, displayName: "Admin <b>", permissions: [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages], roleIds: [] });
	setMember(world, { id: ROLE_ADMIN_USER, displayName: "Role Admin", permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages], roleIds: [ROLE_ADMIN_BOT] });
	setMember(world, { id: PLAIN_USER, displayName: "Thường", permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages], roleIds: [] });
	setMember(world, {
		id: BOT_ID,
		displayName: "ezOne Bot",
		permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ManageRoles],
		roleIds: [],
	});
	const botSpec = members.get(BOT_ID);
	if (botSpec) guild.members.me = memberObject(world, botSpec);
	return world;
}

export interface WebHarness
{
	handler: WebHandler;
	services: AppServices;
	clock: FakeClock;
	world: WebWorld;
	deps: WebDeps;
	/** Các lần gọi thao tác Bảng vàng giả ("refresh:<guild>", "remove:<channel>"). */
	boardCalls: string[];
}

/** Bot giả đang sẵn sàng; OAuth2 giả: code "code-<userId>" đổi được thành người dùng đó. */
export function createWebHarness(modules?: readonly PageModule[]): WebHarness
{
	const db = openDatabase(":memory:");
	runMigrations(db);
	const clock = new FakeClock();
	const services = createServices(db, { clock, backupDir: path.join(tmpdir(), "web-test-backups-unused"), backupKeep: 3 });
	const world = createWorld();
	const boardCalls: string[] = [];
	const client = {
		guilds: { cache: new Collection([[GUILD, world.guild]]) },
		application: { id: APP_ID },
		user: { id: BOT_ID, username: "ezOne Bot" },
	} as unknown as DiscordClient;
	const liveBoardActions: LiveBoardActions = {
		refresh: (_client, guildId) =>
		{
			boardCalls.push(`refresh:${guildId}`);
			return Promise.resolve(true);
		},
		remove: (_client, board) =>
		{
			boardCalls.push(`remove:${board.channelId}`);
			return Promise.resolve(true);
		},
	};
	const deps: WebDeps = {
		client,
		services,
		guildIds: [GUILD],
		config: { port: 8787, host: "0.0.0.0", baseUrl: BASE_URL, clientSecret: "test-client-secret" },
		fetch: fakeDiscordFetch,
		clock,
		liveBoardActions,
	};
	return { handler: createWebHandler(deps, modules), services, clock, world, deps, boardCalls };
}

function jsonResponse(status: number, body: unknown): Response
{
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** fetch giả của Discord: /oauth2/token nhận code "code-<userId>", /users/@me trả người dùng tương ứng token. */
export function fakeDiscordFetch(input: string, init?: RequestInit): Promise<Response>
{
	if (input.endsWith("/oauth2/token"))
	{
		const body = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
		const code = body.get("code") ?? "";
		const userId = /^code(\d{17,20})$/u.exec(code)?.[1];
		return Promise.resolve(userId ? jsonResponse(200, { access_token: `tok-${userId}`, token_type: "Bearer" }) : jsonResponse(400, { error: "invalid_grant" }));
	}
	if (input.endsWith("/users/@me"))
	{
		const headers = new Headers(init?.headers);
		const userId = /^Bearer tok-(\d{17,20})$/u.exec(headers.get("Authorization") ?? "")?.[1];
		return Promise.resolve(userId
			? jsonResponse(200, { id: userId, username: `user${userId.slice(-2)}`, global_name: userId === ADMIN_USER ? "Admin <b>" : null })
			: jsonResponse(401, { message: "401: Unauthorized" }));
	}
	return Promise.resolve(new Response("not found", { status: 404 }));
}

export interface CallOptions
{
	method?: "GET" | "POST";
	form?: Record<string, string | string[]>;
	cookies?: Record<string, string>;
	headers?: Record<string, string>;
	ip?: string;
}

/** Gọi bộ xử lý như một request thật: Host đúng mặc định; POST mặc định có Origin là chính trang. */
export function call(harness: WebHarness, target: string, options: CallOptions = {}): Promise<WebResponse>
{
	const method = options.method ?? (options.form ? "POST" : "GET");
	const url = new URL(target, BASE_URL);
	let form: URLSearchParams | null = null;
	if (method === "POST")
	{
		form = new URLSearchParams();
		for (const [name, value] of Object.entries(options.form ?? {}))
		{
			for (const item of Array.isArray(value) ? value : [value]) form.append(name, item);
		}
	}
	const headers: Record<string, string | undefined> = { host: HOST, ...(method === "POST" ? { origin: BASE_URL } : {}), ...options.headers };
	const request: WebRequest = {
		method,
		path: url.pathname,
		query: url.searchParams,
		headers,
		cookies: new Map(Object.entries(options.cookies ?? {})),
		form,
		ip: options.ip ?? "10.0.0.1",
	};
	return harness.handler.handle(request);
}

/** Giá trị cookie `name` trong các Set-Cookie của response; undefined nếu không có. */
export function setCookieValue(response: WebResponse, name: string): string | undefined
{
	for (const cookie of response.cookies)
	{
		const [pair] = cookie.split(";");
		const index = pair?.indexOf("=") ?? -1;
		if (pair && index > 0 && pair.slice(0, index) === name) return decodeURIComponent(pair.slice(index + 1));
	}
	return undefined;
}

export interface LoggedIn
{
	cookies: Record<string, string>;
	session: WebSession;
	csrf: string;
}

/** Đăng nhập qua đúng luồng OAuth2 (login → callback); ném lỗi nếu không vào được. */
export async function login(harness: WebHarness, userId: string): Promise<LoggedIn>
{
	const start = await call(harness, "/auth/login");
	const state = setCookieValue(start, STATE_COOKIE);
	if (!state) throw new Error("không có cookie state");
	const done = await call(harness, `/auth/callback?code=code${userId}&state=${encodeURIComponent(state)}`, { cookies: { [STATE_COOKIE]: state } });
	const token = setCookieValue(done, SESSION_COOKIE);
	if (!token) throw new Error(`đăng nhập thất bại: ${done.status} ${done.headers.Location ?? ""}`);
	const session = harness.handler.sessions.get(token);
	if (!session) throw new Error("không có phiên");
	return { cookies: { [SESSION_COOKIE]: token }, session, csrf: session.csrf };
}

/** Form POST kèm token CSRF của phiên. */
export function withCsrf(auth: LoggedIn, form: Record<string, string | string[]> = {}): Record<string, string | string[]>
{
	return { _csrf: auth.csrf, ...form };
}
