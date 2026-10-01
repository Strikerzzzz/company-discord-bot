import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	AutocompleteInteraction,
	ButtonInteraction,
	ChannelType,
	ChatInputCommandInteraction,
	EmbedBuilder,
	MessageCreateOptions,
	MessageFlags,
	ModalBuilder,
	ModalSubmitInteraction,
	PermissionFlagsBits,
	PermissionsBitField,
} from "discord.js";
import type DiscordClient from "../src/classes/DiscordClient";
import { openDatabase } from "../src/db/connection";
import { runMigrations } from "../src/db/migrations";
import { afterPollClosed, runPollSweep } from "../src/discord/pollScheduler";
import { PostedRef, REMIND_COOLDOWN_MS, RetroActions, SUMMARY_NOT_POSTED, VOTE_NOT_POSTED } from "../src/discord/retroOps";
import { runRetroSweep } from "../src/discord/retroScheduler";
import { otherRoleUsage } from "../src/discord/tierRoleSetup";
import {
	parseRetroComponentId,
	plainText,
	RETRO_TEXT_MAX,
	retroComponentId,
	retroModal,
	retroSessionMessage,
	retroSummaryMessage,
	shareBudget,
} from "../src/discord/views/retro";
import RetroCmd, { NO_SESSION_HERE, RETRO_CREATE_DENIED, RETRO_NOT_MANAGER } from "../src/interactions/commands/retro";
import { ConfluenceError, RetroDocSection, RetroDocWriter } from "../src/integrations/confluence";
import { Ledger } from "../src/modules/ledger/Ledger";
import { RetroSession } from "../src/modules/retro/types";
import { AppServices, createServices } from "../src/services";
import { UserError } from "../src/shared/errors";
import { ADMIN, CHANNEL_BOT, CHANNEL_GENERAL, FakeClock, GUILD, ROLE_BACKEND, ROLE_FRONTEND, ROLE_OTHER, USER_A, USER_B, USER_C } from "./helpers";

const BOT = "900000000000000001";
const BASE = "https://confluence.congty.vn";
const DOC = `${BASE}/pages/viewpage.action?pageId=777`;
const SESSION_MESSAGE = "600000000000000101";
const OTHER_MESSAGE = "600000000000000102";
/** Kênh riêng tư: chỉ USER_A xem được. */
const CHANNEL_PRIVATE = "400000000000000003";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NO_SEND = "Bạn không có quyền gửi tin nhắn trong kênh này.";

// ---------------------------------------------------------------------------------------------
// Đối tượng giả: service thật trên SQLite :memory:, Discord và Confluence giả
// ---------------------------------------------------------------------------------------------

class FakeDoc implements RetroDocWriter
{
	readonly baseUrl = BASE;
	writes: { docUrl: string; section: RetroDocSection }[] = [];
	error: string | null = null;

	writeRetroSection(docUrl: string, section: RetroDocSection): Promise<void>
	{
		if (this.error !== null) return Promise.reject(new ConfluenceError(this.error));
		this.writes.push({ docUrl, section });
		return Promise.resolve();
	}
}

interface Post
{
	channelId: string;
	payload: MessageCreateOptions;
}

class FakeRetroActions implements RetroActions
{
	refreshed: RetroSession[] = [];
	posts: Post[] = [];
	failPost = false;

	constructor(public docWriter: RetroDocWriter | null)
	{}

	refreshSessionMessage(_client: DiscordClient, session: RetroSession): Promise<boolean>
	{
		this.refreshed.push(session);
		return Promise.resolve(true);
	}

	post(_client: DiscordClient, channelId: string, payload: MessageCreateOptions): Promise<PostedRef | null>
	{
		if (this.failPost) return Promise.resolve(null);
		this.posts.push({ channelId, payload });
		return Promise.resolve({ channelId, messageId: String(700000000000000000n + BigInt(this.posts.length)) });
	}
}

interface World
{
	services: AppServices;
	clock: FakeClock;
	client: DiscordClient;
	actions: FakeRetroActions;
	doc: FakeDoc;
	cmd: RetroCmd;
	/** Các lần sửa message qua REST (message vote). */
	edits: string[];
	/** Đọc tổng XP (cùng database). */
	xp: Ledger;
}

let dirCounter = 0;

function world(options: { docWriter?: boolean } = {}): World
{
	const db = openDatabase(":memory:");
	runMigrations(db);
	const clock = new FakeClock();
	dirCounter++;
	const services = createServices(db, { clock, backupDir: path.join(tmpdir(), `retro-test-${process.pid}-${dirCounter}`), backupKeep: 1, confluenceBaseUrl: BASE });
	const doc = new FakeDoc();
	const actions = new FakeRetroActions(options.docWriter === false ? null : doc);
	const edits: string[] = [];
	const channel = (viewers: string[] | null): object => ({
		guildId: GUILD,
		type: ChannelType.GuildText,
		isDMBased: () => false,
		isTextBased: () => true,
		permissionsFor: (subject: unknown) =>
		{
			if (typeof subject !== "string") return null;
			return new PermissionsBitField(viewers === null || viewers.includes(subject) ? [PermissionFlagsBits.ViewChannel] : []);
		},
		messages: {
			edit: (messageId: string) =>
			{
				edits.push(messageId);
				return Promise.resolve();
			},
		},
	});
	const channels: Record<string, object> = { [CHANNEL_GENERAL]: channel(null), [CHANNEL_BOT]: channel(null), [CHANNEL_PRIVATE]: channel([USER_A]) };
	const client = {
		services,
		retroActions: actions,
		user: { id: BOT },
		channels: { fetch: (id: string) => Promise.resolve(channels[id] ?? null) },
	} as unknown as DiscordClient;
	return { services, clock, client, actions, doc, cmd: new RetroCmd(client), edits, xp: new Ledger(db, "xp", clock) };
}

interface MemberSpec
{
	userId?: string;
	roleIds?: string[];
	manageGuild?: boolean;
	/** Quyền gửi tin ở kênh hiện tại (mặc định có). */
	canSend?: boolean;
	channelId?: string;
}

interface Payload
{
	content?: string;
	embeds?: EmbedBuilder[];
	components?: { toJSON(): unknown }[];
	flags?: number;
	allowedMentions?: unknown;
	withResponse?: boolean;
}

type Values = Record<string, string | number | { id: string }>;

function chatInput(subcommand: string, values: Values = {}, member: MemberSpec = {})
{
	const replies: Payload[] = [];
	const deferred: Payload[] = [];
	const edits: Payload[] = [];
	const followUps: Payload[] = [];
	const permissions = [
		...(member.canSend === false ? [] : [PermissionFlagsBits.SendMessages]),
		...(member.manageGuild ? [PermissionFlagsBits.ManageGuild] : []),
	];
	const interaction = {
		guildId: GUILD,
		channelId: member.channelId ?? CHANNEL_GENERAL,
		user: { id: member.userId ?? USER_B },
		member: { roles: member.roleIds ?? [] },
		memberPermissions: new PermissionsBitField(permissions),
		channel: { isThread: () => false },
		inGuild: () => true,
		options: {
			getSubcommand: () => subcommand,
			getString: (name: string) => (typeof values[name] === "string" ? values[name] : null),
			getInteger: (name: string) => (typeof values[name] === "number" ? values[name] : null),
			getRole: (name: string) => (typeof values[name] === "object" ? values[name] : null),
		},
		reply: (payload: Payload) =>
		{
			replies.push(payload);
			return Promise.resolve({ resource: { message: { id: SESSION_MESSAGE, channelId: member.channelId ?? CHANNEL_GENERAL } } });
		},
		deferReply: (payload: Payload) =>
		{
			deferred.push(payload);
			return Promise.resolve();
		},
		editReply: (payload: Payload) =>
		{
			edits.push(payload);
			return Promise.resolve();
		},
		followUp: (payload: Payload) =>
		{
			followUps.push(payload);
			return Promise.resolve();
		},
	};
	return { interaction: interaction as unknown as ChatInputCommandInteraction, replies, deferred, edits, followUps };
}

function buttonPress(customId: string, member: MemberSpec = {})
{
	const modals: ModalBuilder[] = [];
	const interaction = {
		customId,
		guildId: GUILD,
		user: { id: member.userId ?? USER_B },
		member: { roles: member.roleIds ?? [] },
		inGuild: () => true,
		showModal: (modal: ModalBuilder) =>
		{
			modals.push(modal);
			return Promise.resolve();
		},
	};
	return { interaction: interaction as unknown as ButtonInteraction, modals };
}

function modalSubmit(customId: string, inputs: Record<string, string>, member: MemberSpec = {}, messageId: string | null = SESSION_MESSAGE)
{
	const updates: Payload[] = [];
	const followUps: Payload[] = [];
	const replies: Payload[] = [];
	const interaction = {
		customId,
		guildId: GUILD,
		user: { id: member.userId ?? USER_B },
		member: { roles: member.roleIds ?? [] },
		inGuild: () => true,
		fields: {
			getTextInputValue: (id: string) =>
			{
				const value = inputs[id];
				if (value === undefined) throw new Error(`thiếu ô ${id}`);
				return value;
			},
		},
		isFromMessage: () => messageId !== null,
		message: messageId === null ? null : { id: messageId },
		update: (payload: Payload) =>
		{
			updates.push(payload);
			return Promise.resolve();
		},
		followUp: (payload: Payload) =>
		{
			followUps.push(payload);
			return Promise.resolve();
		},
		reply: (payload: Payload) =>
		{
			replies.push(payload);
			return Promise.resolve();
		},
	};
	return { interaction: interaction as unknown as ModalSubmitInteraction, updates, followUps, replies };
}

function autocompleteFor(focused: string, member: MemberSpec = {}): AutocompleteInteraction
{
	return {
		guildId: GUILD,
		channelId: CHANNEL_GENERAL,
		user: { id: member.userId ?? USER_B },
		member: { roles: member.roleIds ?? [] },
		memberPermissions: new PermissionsBitField(member.manageGuild ? [PermissionFlagsBits.ManageGuild] : []),
		inGuild: () => true,
		options: { getInteger: () => null, getFocused: () => focused },
	} as unknown as AutocompleteInteraction;
}

function userError(message: string | RegExp): (error: unknown) => boolean
{
	return error => error instanceof UserError && (typeof message === "string" ? error.message === message : message.test(error.message));
}

function hasToJSON(value: unknown): value is { toJSON(): unknown }
{
	return typeof value === "object" && value !== null && "toJSON" in value && typeof value.toJSON === "function";
}

/** Mọi chữ của các TextDisplay trong payload Components V2. */
function texts(payload: { components?: readonly unknown[] } | undefined): string[]
{
	const found: string[] = [];
	const visit = (node: unknown): void =>
	{
		if (Array.isArray(node))
		{
			node.forEach(visit);
			return;
		}
		if (typeof node !== "object" || node === null) return;
		if ("type" in node && node.type === 10 && "content" in node && typeof node.content === "string") found.push(node.content);
		for (const value of Object.values(node)) visit(value);
	};
	for (const component of payload?.components ?? []) visit(hasToJSON(component) ? component.toJSON() : component);
	return found;
}

/** customId và trạng thái của mọi nút trong payload. */
function buttons(payload: { components?: readonly unknown[] } | undefined): { customId: string; disabled: boolean }[]
{
	const found: { customId: string; disabled: boolean }[] = [];
	const visit = (node: unknown): void =>
	{
		if (Array.isArray(node))
		{
			node.forEach(visit);
			return;
		}
		if (typeof node !== "object" || node === null) return;
		if ("type" in node && node.type === 2 && "custom_id" in node && typeof node.custom_id === "string")
		{
			found.push({ customId: node.custom_id, disabled: "disabled" in node && node.disabled === true });
		}
		for (const value of Object.values(node)) visit(value);
	};
	for (const component of payload?.components ?? []) visit(hasToJSON(component) ? component.toJSON() : component);
	return found;
}

const MANAGER = { userId: USER_C, roleIds: [ROLE_OTHER] };
const ADMIN_MEMBER = { userId: ADMIN, manageGuild: true };

function fields(values: Partial<Record<"learned" | "improve" | "ideas" | "kudos" | "sprint", string>>): Record<string, string>
{
	return { learned: "", improve: "", ideas: "", kudos: "", sprint: "", ...values };
}

/** Tạo phiên bằng lệnh (admin), trả về phiên đã lưu. */
async function createByCommand(w: World, values: Values = {}, member: MemberSpec = ADMIN_MEMBER): Promise<RetroSession>
{
	const call = chatInput("create", { ten: "Retrospective PMS Sprint 24", ...values }, member);
	await w.cmd.execute(call.interaction);
	const session = w.services.retro.latestInChannel(GUILD, member.channelId ?? CHANNEL_GENERAL);
	assert.ok(session);
	return session;
}

async function fill(w: World, session: RetroSession, userId: string, values: Parameters<typeof fields>[0], roleIds: string[] = []): Promise<ReturnType<typeof modalSubmit>>
{
	const call = modalSubmit(retroComponentId("form", session.id), fields(values), { userId, roleIds });
	await w.cmd.executeModal(call.interaction);
	return call;
}

// ---------------------------------------------------------------------------------------------
// Lệnh /retro create, nút và form
// ---------------------------------------------------------------------------------------------

describe("/retro create", () =>
{
	test("chỉ admin bot hoặc role quản lý retro tạo được; người tạo phải gửi được tin ở kênh", async () =>
	{
		const w = world();
		await assert.rejects(w.cmd.execute(chatInput("create", { ten: "Retro" }, { userId: USER_A }).interaction), userError(RETRO_CREATE_DENIED));
		w.services.retro.changeManagerRoles(GUILD, { add: [ROLE_OTHER] }, ADMIN);
		await assert.rejects(w.cmd.execute(chatInput("create", { ten: "Retro" }, { ...MANAGER, canSend: false }).interaction), userError(NO_SEND));
		assert.equal(w.services.retro.latestInChannel(GUILD, CHANNEL_GENERAL), null);

		const session = await createByCommand(w, {}, MANAGER);
		assert.equal(session.createdBy, USER_C);
		assert.equal(session.channelId, CHANNEL_GENERAL);
	});

	test("đăng tin Components V2 có nút điền, lưu message; gắn team và link; một kênh chỉ một phiên đang mở", async () =>
	{
		const w = world();
		w.services.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		const call = chatInput("create", { ten: "Retro Sprint 24", link: DOC, team: { id: ROLE_BACKEND }, "han-gio": 24 }, ADMIN_MEMBER);
		await w.cmd.execute(call.interaction);

		const session = w.services.retro.latestInChannel(GUILD, CHANNEL_GENERAL);
		assert.ok(session);
		assert.equal(session.messageId, SESSION_MESSAGE);
		assert.equal(session.teamRoleId, ROLE_BACKEND);
		assert.equal(session.docPageId, "777");
		assert.equal(session.closesAt, w.clock.now() + 24 * HOUR);
		const [reply] = call.replies;
		assert.equal(reply.flags, MessageFlags.IsComponentsV2);
		assert.equal(reply.withResponse, true);
		assert.deepEqual(reply.allowedMentions, { parse: [] });
		assert.deepEqual(buttons(reply), [{ customId: `retro:fill:${session.id}`, disabled: false }]);
		const text = texts(reply).join("\n");
		assert.match(text, /## 🔁 Retro: Retro Sprint 24/u);
		assert.ok(text.includes(`👥 Team: <@&${ROLE_BACKEND}>`));
		assert.ok(text.includes(`📄 Tài liệu: <${DOC}>`));
		assert.match(text, /Đã điền: \*\*0\*\* người/u);
		assert.equal(call.followUps.length, 0, "Confluence đã bật thì không có ghi chú");

		await assert.rejects(w.cmd.execute(chatInput("create", { ten: "Phiên hai" }, ADMIN_MEMBER).interaction), userError(/chưa đóng/));
		await assert.rejects(w.cmd.execute(chatInput("create", { ten: "Phiên hai", team: { id: ROLE_FRONTEND } }, { ...ADMIN_MEMBER, channelId: CHANNEL_BOT }).interaction), userError(/team đã cấu hình/));
	});

	test("chưa bật ghi Confluence: vẫn lưu link và báo riêng cho người tạo", async () =>
	{
		const w = world({ docWriter: false });
		const call = chatInput("create", { ten: "Retro", link: DOC }, ADMIN_MEMBER);
		await w.cmd.execute(call.interaction);
		assert.equal(call.followUps.length, 1);
		assert.match(call.followUps[0].content ?? "", /chưa bật ghi Confluence/);
		assert.equal(call.followUps[0].flags, MessageFlags.Ephemeral);
	});
});

describe("nút 📝 Điền retro và form", () =>
{
	test("nút mở form 5 ô, điền sẵn câu trả lời cũ; phiên có team thì người ngoài team bị từ chối; phiên đóng thì không mở form", async () =>
	{
		const w = world();
		w.services.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		const session = await createByCommand(w, { team: { id: ROLE_BACKEND } });

		const outsider = buttonPress(retroComponentId("fill", session.id), { userId: USER_A, roleIds: [ROLE_FRONTEND] });
		await assert.rejects(w.cmd.executeButton(outsider.interaction), userError(/chỉ dành cho thành viên team/));
		assert.equal(outsider.modals.length, 0);

		const empty = buttonPress(retroComponentId("fill", session.id), { userId: USER_A, roleIds: [ROLE_BACKEND] });
		await w.cmd.executeButton(empty.interaction);
		const json = empty.modals[0].toJSON();
		assert.equal(json.custom_id, `retro:form:${session.id}`);
		assert.equal(json.components.length, 5);

		await fill(w, session, USER_A, { learned: "Học được nhiều", sprint: "Rồng Lửa" }, [ROLE_BACKEND]);
		const again = buttonPress(retroComponentId("fill", session.id), { userId: USER_A, roleIds: [ROLE_BACKEND] });
		await w.cmd.executeButton(again.interaction);
		const prefilled = JSON.stringify(again.modals[0].toJSON());
		assert.ok(prefilled.includes("\"value\":\"Học được nhiều\""), prefilled);
		assert.ok(prefilled.includes("\"value\":\"Rồng Lửa\""), prefilled);

		w.services.retro.close(GUILD, session.id, ADMIN);
		await assert.rejects(w.cmd.executeButton(buttonPress(retroComponentId("fill", session.id), { userId: USER_A, roleIds: [ROLE_BACKEND] }).interaction), userError(/đã đóng/));
		await assert.rejects(w.cmd.executeButton(buttonPress(retroComponentId("form", session.id)).interaction), userError(/không hợp lệ/));
		await assert.rejects(w.cmd.executeButton(buttonPress("retro:fill:abc").interaction), userError(/không hợp lệ/));
		await assert.rejects(w.cmd.executeButton(buttonPress(retroComponentId("fill", 999)).interaction), userError("Không tìm thấy phiên retro này."));
	});

	test("gửi form: sửa tin của phiên (số người), trả lời riêng 'ẩn danh' kèm XP lần đầu; sửa lại không cộng XP", async () =>
	{
		const w = world();
		const session = await createByCommand(w);
		const first = await fill(w, session, USER_A, { learned: "Học được nhiều" });
		assert.equal(first.updates.length, 1);
		assert.match(texts(first.updates[0]).join("\n"), /Đã điền: \*\*1\*\* người/u);
		assert.ok(!texts(first.updates[0]).join("\n").includes(USER_A), "tin của phiên không có tên người điền");
		assert.equal(first.followUps[0].flags, MessageFlags.Ephemeral);
		assert.match(first.followUps[0].content ?? "", /Đã lưu câu trả lời retro \(ẩn danh\)\. \+20 XP/u);

		const second = await fill(w, session, USER_A, { kudos: "Cảm ơn" });
		assert.match(second.followUps[0].content ?? "", /Đã cập nhật/);
		assert.ok(!(second.followUps[0].content ?? "").includes("XP"));
		assert.equal(w.xp.total(GUILD, USER_A), 20);

		const elsewhere = modalSubmit(retroComponentId("form", session.id), fields({ ideas: "Ý tưởng" }), { userId: USER_B }, OTHER_MESSAGE);
		await w.cmd.executeModal(elsewhere.interaction);
		assert.equal(elsewhere.updates.length, 0, "form không gửi từ tin của phiên thì không sửa tin đó bằng update");
		assert.equal(elsewhere.replies[0].flags, MessageFlags.Ephemeral);
		assert.equal(w.actions.refreshed.at(-1)?.participants, 2);

		await assert.rejects(w.cmd.executeModal(modalSubmit(retroComponentId("form", session.id), fields({ sprint: "24" }), { userId: USER_C }).interaction), userError(/không được chỉ là số/));
		await assert.rejects(w.cmd.executeModal(modalSubmit(retroComponentId("fill", session.id), fields({ learned: "x" })).interaction), userError(/không hợp lệ/));
		const partial = modalSubmit(retroComponentId("form", session.id), { learned: "chỉ có một ô" }, { userId: USER_C });
		await w.cmd.executeModal(partial.interaction);
		assert.deepEqual(w.services.retro.getAnswers(GUILD, session.id, USER_C), { learned: "chỉ có một ô", improve: null, ideas: null, kudos: null, sprintName: null }, "ô thiếu trong form cũ coi như trống");
	});
});

// ---------------------------------------------------------------------------------------------
// Quản lý phiên
// ---------------------------------------------------------------------------------------------

describe("/retro quản lý phiên", () =>
{
	test("người không phải quản lý bị từ chối; người tạo phiên quản lý được phiên của mình kể cả khi đã mất role quản lý", async () =>
	{
		const w = world();
		w.services.retro.changeManagerRoles(GUILD, { add: [ROLE_OTHER] }, ADMIN);
		const session = await createByCommand(w, {}, MANAGER);
		await assert.rejects(w.cmd.execute(chatInput("close", {}, { userId: USER_A }).interaction), userError(RETRO_NOT_MANAGER));
		await assert.rejects(w.cmd.execute(chatInput("close", {}, { userId: USER_A, channelId: CHANNEL_BOT }).interaction), userError(NO_SESSION_HERE));
		await assert.rejects(w.cmd.execute(chatInput("close", { id: 999 }, ADMIN_MEMBER).interaction), userError("Không tìm thấy phiên retro #999."));

		w.services.retro.changeManagerRoles(GUILD, { remove: [ROLE_OTHER] }, ADMIN);
		const call = chatInput("extend", { "han-gio": 5 }, { userId: USER_C });
		await w.cmd.execute(call.interaction);
		assert.equal(call.deferred[0].flags, MessageFlags.Ephemeral);
		assert.match(call.edits[0].content ?? "", new RegExp(`Đã gia hạn phiên retro #${session.id}`));
		assert.equal(w.services.retro.get(GUILD, session.id)?.closesAt, w.clock.now() + 5 * HOUR);
		assert.equal(w.actions.refreshed.at(-1)?.id, session.id);
	});

	test("đóng: tắt nút trên tin, đăng bảng tổng hợp ẩn danh trong kênh, ghi Confluence; báo kết quả riêng cho người quản lý", async () =>
	{
		const w = world();
		const session = await createByCommand(w, { link: DOC });
		await fill(w, session, USER_A, { learned: "Học <@&500000000000000001> @everyone", sprint: "Rồng Lửa" });
		await fill(w, session, USER_B, { improve: "Họp dài", sprint: "rồng  lửa" });

		const call = chatInput("close", {}, ADMIN_MEMBER);
		await w.cmd.execute(call.interaction);
		const closed = w.services.retro.get(GUILD, session.id);
		assert.equal(closed?.status, "closed");
		assert.deepEqual(buttons(retroSessionMessage(w.actions.refreshed.at(-1) ?? session)), [{ customId: `retro:fill:${session.id}`, disabled: true }]);

		const [summary] = w.actions.posts;
		assert.equal(summary.channelId, CHANNEL_GENERAL);
		assert.equal(summary.payload.flags, MessageFlags.IsComponentsV2);
		assert.deepEqual(summary.payload.allowedMentions, { parse: [] });
		const text = texts(summary.payload).join("\n");
		assert.match(text, /Tổng hợp retro: Retrospective PMS Sprint 24/u);
		assert.match(text, /\*\*📚 Learned\*\* \(1\)/u);
		assert.match(text, /\*\*🍀 Đặt tên sprint\*\* \(1\)\n• Rồng Lửa/u);
		assert.ok(text.includes("\\<\\@&500000000000000001\\> \\@everyone"), "mention trong chữ người dùng bị vô hiệu hoá");
		assert.ok(!text.includes(USER_A) && !text.includes(USER_B), "không có người viết");
		assert.ok(text.includes(`Xem đầy đủ trên Confluence: <${DOC}>`));

		assert.equal(w.doc.writes.length, 1);
		const { docUrl, section } = w.doc.writes[0];
		assert.equal(docUrl, DOC);
		assert.equal(section.entries.length, 2);
		assert.ok(!JSON.stringify(section).includes(USER_A), "Confluence không nhận người viết");
		assert.equal(section.winnerName, null);
		assert.notEqual(w.services.retro.get(GUILD, session.id)?.confluenceWrittenAt, null);

		const reply = call.edits[0].content ?? "";
		assert.match(reply, /Đã đóng phiên retro #\d+ \(2 người đã điền\)/u);
		assert.ok(reply.includes("📄 Đã ghi bảng retro vào Confluence."));
		await assert.rejects(w.cmd.execute(chatInput("close", {}, ADMIN_MEMBER).interaction), userError("Phiên retro này đã đóng."));
	});

	test("đóng khi Confluence lỗi hoặc không đăng được bảng: phiên vẫn đóng, lỗi được lưu và báo cho người quản lý", async () =>
	{
		const w = world();
		const session = await createByCommand(w, { link: DOC });
		await fill(w, session, USER_A, { learned: "x" });
		w.doc.error = "Confluence từ chối token (401): token sai, đã hết hạn hoặc đã bị thu hồi.";
		w.actions.failPost = true;

		const call = chatInput("close", {}, ADMIN_MEMBER);
		await w.cmd.execute(call.interaction);
		const reply = call.edits[0].content ?? "";
		assert.ok(reply.includes(SUMMARY_NOT_POSTED));
		assert.ok(reply.includes("❌ Ghi Confluence lỗi: Confluence từ chối token (401)"));
		const closed = w.services.retro.get(GUILD, session.id);
		assert.equal(closed?.status, "closed");
		assert.match(closed?.confluenceError ?? "", /401/);

		w.doc.error = null;
		const write = chatInput("write", {}, ADMIN_MEMBER);
		await w.cmd.execute(write.interaction);
		assert.equal(write.edits[0].content, "📄 Đã ghi bảng retro vào Confluence.");
		assert.equal(w.services.retro.get(GUILD, session.id)?.confluenceError, null);
	});

	test("ghi lại khi phiên không có link: báo bỏ qua; mở lại phiên đã đóng", async () =>
	{
		const w = world();
		const session = await createByCommand(w);
		w.services.retro.close(GUILD, session.id, ADMIN);
		const write = chatInput("write", {}, ADMIN_MEMBER);
		await w.cmd.execute(write.interaction);
		assert.equal(write.edits[0].content, "📄 Không ghi Confluence: phiên chưa gắn link tài liệu.");

		const reopen = chatInput("reopen", { "han-gio": 2 }, ADMIN_MEMBER);
		await w.cmd.execute(reopen.interaction);
		assert.match(reopen.edits[0].content ?? "", /Đã mở lại phiên retro/);
		assert.equal(w.services.retro.get(GUILD, session.id)?.status, "open");
	});

	test("status: người quản lý thấy danh sách người đã điền; thành viên chỉ thấy số người; phiên ở kênh không xem được thì 'không tìm thấy'", async () =>
	{
		const w = world();
		const session = await createByCommand(w, { link: DOC });
		await fill(w, session, USER_A, { learned: "x" });
		await fill(w, session, USER_B, { learned: "y" });

		const manager = chatInput("status", {}, ADMIN_MEMBER);
		await w.cmd.execute(manager.interaction);
		const managerText = manager.edits[0].content ?? "";
		assert.match(managerText, /Đã điền: \*\*2\*\* người/u);
		assert.ok(managerText.includes(`<@${USER_A}>, <@${USER_B}>`), managerText);
		assert.match(managerText, /Confluence: chưa ghi\./u);
		assert.deepEqual(manager.edits[0].allowedMentions, { parse: [] });

		const member = chatInput("status", {}, { userId: USER_C });
		await w.cmd.execute(member.interaction);
		const memberText = member.edits[0].content ?? "";
		assert.match(memberText, /Đã điền: \*\*2\*\* người/u);
		assert.ok(!memberText.includes(USER_A) && !memberText.includes("Confluence"), memberText);

		const hidden = await createByCommand(w, { ten: "Retro riêng" }, { ...ADMIN_MEMBER, channelId: CHANNEL_PRIVATE });
		await assert.rejects(w.cmd.execute(chatInput("status", { id: hidden.id }, { userId: USER_C }).interaction), userError(`Không tìm thấy phiên retro #${hidden.id}.`));
		const visible = chatInput("status", { id: hidden.id }, { userId: USER_A });
		await w.cmd.execute(visible.interaction);
		assert.match(visible.edits[0].content ?? "", /Retro riêng/);
	});

	test("remind: ping đúng role team (allowedMentions chỉ role đó), mỗi phiên 10 phút một lần; không có team thì không ping; phiên đóng thì không nhắc", async () =>
	{
		const w = world();
		w.services.teams.add(GUILD, ROLE_BACKEND, ADMIN);
		const session = await createByCommand(w, { team: { id: ROLE_BACKEND } });
		const call = chatInput("remind", {}, ADMIN_MEMBER);
		await w.cmd.execute(call.interaction);
		const [post] = w.actions.posts;
		assert.equal(post.channelId, CHANNEL_GENERAL);
		assert.deepEqual(post.payload.allowedMentions, { parse: [], roles: [ROLE_BACKEND] });
		assert.ok((post.payload.content ?? "").startsWith(`⏰ <@&${ROLE_BACKEND}> ơi`));
		assert.ok((post.payload.content ?? "").includes(`https://discord.com/channels/${GUILD}/${CHANNEL_GENERAL}/${SESSION_MESSAGE}`));
		assert.equal(call.edits[0].content, "Đã nhắc team điền retro trong kênh của phiên.");

		await assert.rejects(w.cmd.execute(chatInput("remind", {}, ADMIN_MEMBER).interaction), userError(/vừa được nhắc/));
		w.clock.advance(REMIND_COOLDOWN_MS);
		await w.cmd.execute(chatInput("remind", {}, ADMIN_MEMBER).interaction);
		assert.equal(w.actions.posts.length, 2);

		const plain = await createByCommand(w, { ten: "Không team" }, { ...ADMIN_MEMBER, channelId: CHANNEL_BOT });
		await w.cmd.execute(chatInput("remind", { id: plain.id }, ADMIN_MEMBER).interaction);
		const last = w.actions.posts.at(-1);
		assert.deepEqual(last?.payload.allowedMentions, { parse: [] });
		assert.ok((last?.payload.content ?? "").startsWith("⏰ Mọi người ơi"));

		w.services.retro.close(GUILD, session.id, ADMIN);
		w.clock.advance(REMIND_COOLDOWN_MS);
		await assert.rejects(w.cmd.execute(chatInput("remind", { id: session.id }, ADMIN_MEMBER).interaction), userError(/không còn nhận câu trả lời/));
	});
});

// ---------------------------------------------------------------------------------------------
// Vote tên sprint → chốt → XP
// ---------------------------------------------------------------------------------------------

describe("/retro vote và chốt tên sprint", () =>
{
	async function closedSession(w: World, names: string[]): Promise<RetroSession>
	{
		const session = await createByCommand(w, { link: DOC });
		const users = [USER_A, USER_B, USER_C, "300000000000000004"];
		for (const [index, name] of names.entries()) await fill(w, session, users[index], { sprint: name, learned: `ý ${index}` });
		w.services.retro.close(GUILD, session.id, ADMIN);
		return session;
	}

	test("tạo vote: đăng tin vote vào kênh của phiên và gắn message; vote đóng thì bot công bố tên thắng, cộng XP người đề xuất, ghi Confluence", async () =>
	{
		const w = world();
		const session = await closedSession(w, ["Rồng Lửa", "Bão Tố", "rồng lửa"]);
		const call = chatInput("vote", {}, ADMIN_MEMBER);
		await w.cmd.execute(call.interaction);

		const voting = w.services.retro.get(GUILD, session.id);
		assert.equal(voting?.status, "voting");
		const pollId = voting?.pollId ?? 0;
		const [post] = w.actions.posts;
		assert.equal(post.channelId, CHANNEL_GENERAL);
		assert.ok(post.payload.embeds?.length === 1);
		assert.deepEqual(post.payload.allowedMentions, { parse: [] });
		const poll = w.services.polls.get(GUILD, pollId);
		assert.equal(poll?.messageId, "700000000000000001");
		assert.equal(poll?.channelId, CHANNEL_GENERAL);
		assert.deepEqual(poll?.options.map(option => option.label), ["Bão Tố", "Rồng Lửa"]);
		assert.match(call.edits[0].content ?? "", new RegExp(`Đã tạo vote tên sprint #${pollId} với 2 tên`));

		w.services.polls.vote({ guildId: GUILD, pollId, userId: USER_A, optionIndex: 1, roleIds: [] });
		w.services.polls.vote({ guildId: GUILD, pollId, userId: USER_B, optionIndex: 1, roleIds: [] });
		const xpA = w.xp.total(GUILD, USER_A);
		const xpC = w.xp.total(GUILD, USER_C);
		const closedPoll = w.services.polls.close({ guildId: GUILD, pollId, actorId: ADMIN, actorIsAdmin: true });
		await afterPollClosed(w.client, closedPoll);

		assert.deepEqual(w.edits, ["700000000000000001"], "message vote được sửa sang trạng thái đóng");
		const done = w.services.retro.get(GUILD, session.id);
		assert.equal(done?.status, "done");
		assert.equal(done?.winnerName, "Rồng Lửa");
		assert.equal(w.xp.total(GUILD, USER_A), xpA + 100, "A đề xuất tên thắng");
		assert.equal(w.xp.total(GUILD, USER_C), xpC + 100, "C đề xuất cùng tên (khác cách viết) cũng được");
		const announcement = w.actions.posts.at(-1);
		assert.ok((announcement?.payload.content ?? "").startsWith("🏆 Tên sprint được chọn cho retro **Retrospective PMS Sprint 24**: **Rồng Lửa**"));
		assert.match(announcement?.payload.content ?? "", /được cộng 100 XP/u);
		assert.ok(!(announcement?.payload.content ?? "").includes(USER_A), "không nêu người đề xuất");
		assert.deepEqual(announcement?.payload.allowedMentions, { parse: [] });
		assert.equal(w.doc.writes.at(-1)?.section.winnerName, "Rồng Lửa");

		const posts = w.actions.posts.length;
		await afterPollClosed(w.client, closedPoll);
		assert.equal(w.actions.posts.length, posts, "gọi lại không công bố lần hai");
		assert.equal(w.xp.total(GUILD, USER_A), xpA + 100);
	});

	test("không đăng được tin vote: huỷ vote vừa tạo, phiên về 'closed', báo lỗi", async () =>
	{
		const w = world();
		const session = await closedSession(w, ["Một", "Hai"]);
		w.actions.failPost = true;
		await assert.rejects(w.cmd.execute(chatInput("vote", {}, ADMIN_MEMBER).interaction), userError(VOTE_NOT_POSTED));
		const reverted = w.services.retro.get(GUILD, session.id);
		assert.equal(reverted?.status, "closed");
		assert.equal(reverted?.pollId, null);
		assert.equal(w.services.polls.listOpen(GUILD).length, 0);
	});

	test("hơn 10 tên: báo chọn danh sách rút gọn; option rut-gon tạo vote với đúng các tên đó", async () =>
	{
		const w = world();
		const session = await createByCommand(w);
		for (let index = 0; index < 11; index++)
		{
			await fill(w, session, `3400000000000000${String(index).padStart(2, "0")}`, { sprint: `Tên ${String.fromCharCode(65 + index)}` });
		}
		w.services.retro.close(GUILD, session.id, ADMIN);
		await assert.rejects(w.cmd.execute(chatInput("vote", {}, ADMIN_MEMBER).interaction), userError(/Có 11 tên được đề xuất/));
		await w.cmd.execute(chatInput("vote", { "rut-gon": "tên b | Tên C|  | TÊN D" }, ADMIN_MEMBER).interaction);
		const poll = w.services.polls.get(GUILD, w.services.retro.get(GUILD, session.id)?.pollId ?? 0);
		assert.deepEqual(poll?.options.map(option => option.label), ["Tên B", "Tên C", "Tên D"]);
	});

	test("vote hết hạn (lịch tự đóng vote) và hoà: bot báo hoà; người quản lý chọn bằng /retro pick (gợi ý tên hoà); thành viên không chọn được", async () =>
	{
		const w = world();
		const session = await closedSession(w, ["Alpha", "Beta"]);
		await w.cmd.execute(chatInput("vote", {}, ADMIN_MEMBER).interaction);
		const pollId = w.services.retro.get(GUILD, session.id)?.pollId ?? 0;
		w.services.polls.vote({ guildId: GUILD, pollId, userId: USER_A, optionIndex: 0, roleIds: [] });
		w.services.polls.vote({ guildId: GUILD, pollId, userId: USER_B, optionIndex: 1, roleIds: [] });
		w.clock.advance(24 * HOUR);
		assert.equal(await runPollSweep(w.client), 1);

		const tie = w.actions.posts.at(-1)?.payload.content ?? "";
		assert.match(tie, /hoà giữa: \*\*Alpha\*\*, \*\*Beta\*\*/u);
		assert.match(tie, /\/retro pick/u);
		assert.deepEqual(w.services.retro.get(GUILD, session.id)?.tieNames, ["Alpha", "Beta"]);
		assert.deepEqual(w.cmd.autocomplete(autocompleteFor("", ADMIN_MEMBER)), ["Alpha", "Beta"]);
		assert.deepEqual(w.cmd.autocomplete(autocompleteFor("bE", ADMIN_MEMBER)), ["Beta"]);
		assert.deepEqual(w.cmd.autocomplete(autocompleteFor("", { userId: USER_A })), [], "không gợi ý cho người không quản lý");

		await assert.rejects(w.cmd.execute(chatInput("pick", { ten: "Beta" }, { userId: USER_A }).interaction), userError(RETRO_NOT_MANAGER));
		const xpB = w.xp.total(GUILD, USER_B);
		const pick = chatInput("pick", { ten: "beta" }, ADMIN_MEMBER);
		await w.cmd.execute(pick.interaction);
		assert.match(pick.edits[0].content ?? "", /Đã chốt tên sprint "Beta"/);
		assert.equal(w.xp.total(GUILD, USER_B), xpB + 100);
		assert.match(w.actions.posts.at(-1)?.payload.content ?? "", /\*\*Beta\*\*/u);
		assert.equal(w.doc.writes.at(-1)?.section.winnerName, "Beta");
	});

	test("lịch quét retro: tự đóng phiên quá hạn (bảng tổng hợp, Confluence) và chốt nốt vote đã đóng mà chưa chốt", async () =>
	{
		const w = world();
		const due = await createByCommand(w, { "han-gio": 1, link: DOC });
		await fill(w, due, USER_A, { learned: "x", sprint: "Một" });
		await fill(w, due, USER_B, { learned: "y", sprint: "Hai" });
		w.clock.advance(HOUR);

		assert.deepEqual(await runRetroSweep(w.client), { closed: 1, settled: 0 });
		assert.equal(w.services.retro.get(GUILD, due.id)?.status, "closed");
		assert.match(texts(w.actions.posts.at(-1)?.payload).join("\n"), /Tổng hợp retro/u);
		assert.equal(w.doc.writes.length, 1);
		assert.equal(w.actions.refreshed.at(-1)?.status, "closed");

		const { poll } = w.services.retro.startVote({ guildId: GUILD, sessionId: due.id, actorId: ADMIN });
		w.services.polls.vote({ guildId: GUILD, pollId: poll.id, userId: USER_C, optionIndex: 0, roleIds: [] });
		w.services.polls.close({ guildId: GUILD, pollId: poll.id, actorId: ADMIN, actorIsAdmin: true });
		assert.deepEqual(await runRetroSweep(w.client), { closed: 0, settled: 1 });
		assert.equal(w.services.retro.get(GUILD, due.id)?.winnerName, "Hai");
		assert.deepEqual(await runRetroSweep(w.client), { closed: 0, settled: 0 });
	});
});

// ---------------------------------------------------------------------------------------------
// View và phần dùng chung
// ---------------------------------------------------------------------------------------------

describe("view retro", () =>
{
	function sessionOf(overrides: Partial<RetroSession> = {}): RetroSession
	{
		return {
			id: 5,
			guildId: GUILD,
			title: "Retro **Sprint** <@123456789012345678>",
			channelId: CHANNEL_GENERAL,
			messageId: SESSION_MESSAGE,
			teamRoleId: null,
			docUrl: null,
			docPageId: null,
			status: "closed",
			closesAt: null,
			createdBy: ADMIN,
			createdAt: 0,
			closedAt: 0,
			pollId: null,
			tieNames: null,
			winnerName: null,
			confluenceWrittenAt: null,
			confluenceError: null,
			contentDeletedAt: null,
			participants: 250,
			acceptingAnswers: false,
			...overrides,
		};
	}

	test("bảng tổng hợp rất dài vẫn ≤ 4000 ký tự, ghi '… và N ý khác'; cột trống không hiện; tiêu đề được escape", () =>
	{
		const long = (prefix: string): string[] => Array.from({ length: 250 }, (_, index) => `${prefix} ${index} ${"chữ ".repeat(80)}`);
		const payload = retroSummaryMessage(sessionOf({ docUrl: DOC }), { learned: long("học"), improve: long("thiếu"), ideas: [], kudos: ["Cảm ơn"], sprintName: long("tên").slice(0, 30) });
		const all = texts(payload);
		const total = all.reduce((sum, text) => sum + text.length, 0);
		assert.ok(total <= RETRO_TEXT_MAX, `tổng ${total} ký tự`);
		const joined = all.join("\n");
		assert.match(joined, /… và \d+ ý khác/u);
		assert.ok(!joined.includes("🔮 Sáng tạo"), "cột không có ý thì không hiện");
		assert.ok(joined.includes("**👍 Tuyên dương** (1)\n• Cảm ơn"));
		assert.ok(joined.includes("Retro \\*\\*Sprint\\*\\* \\<\\@123456789012345678\\>"));
		assert.ok(joined.endsWith(`Xem đầy đủ trên Confluence: <${DOC}>`));
		assert.match(texts(retroSummaryMessage(sessionOf({ participants: 0 }), { learned: [], improve: [], ideas: [], kudos: [], sprintName: [] })).join("\n"), /Chưa có ai điền retro/u);
	});

	test("chia ngân sách ký tự: cột ngắn lấy đủ, phần dư chia cho cột dài", () =>
	{
		assert.deepEqual(shareBudget([10, 1000, 1000], 1000), [10, 495, 495]);
		assert.deepEqual(shareBudget([5, 5], 1000), [5, 5]);
		assert.deepEqual(shareBudget([100], -5), [0]);
	});

	test("tin của phiên theo trạng thái; form 5 nhãn ≤ 45 ký tự; customId đọc lại được; plainText chặn mention và markdown", () =>
	{
		const done = texts(retroSessionMessage(sessionOf({ status: "done", winnerName: "Rồng_Lửa" }))).join("\n");
		assert.match(done, /✅ Hoàn tất · 🏆 Rồng\\_Lửa/u);
		const tie = texts(retroSessionMessage(sessionOf({ status: "voting", tieNames: ["A", "B"] }))).join("\n");
		assert.match(tie, /Vote tên sprint hoà/u);
		const open = retroSessionMessage(sessionOf({ status: "open", acceptingAnswers: true, closesAt: 1_800_000_000_000, teamRoleId: ROLE_BACKEND }));
		assert.match(texts(open).join("\n"), /⏰ Hạn: <t:1800000000:f>/u);
		assert.deepEqual(buttons(open), [{ customId: "retro:fill:5", disabled: false }]);

		const modal = retroModal(sessionOf({ title: "x".repeat(100) }), { learned: "a", improve: null, ideas: null, kudos: null, sprintName: "Tên" }).toJSON();
		assert.ok(modal.title.length <= 45);
		const labels = JSON.stringify(modal);
		for (const label of ["📚 Learned", "👎 Thiếu sót", "🔮 Sáng tạo", "👍 Tuyên dương", "🍀 Đặt tên sprint"]) assert.ok(labels.includes(label), label);

		assert.deepEqual(parseRetroComponentId("retro:fill:42"), { action: "fill", sessionId: 42 });
		assert.deepEqual(parseRetroComponentId("retro:form:7"), { action: "form", sessionId: 7 });
		for (const bad of ["retro:fill:0", "retro:fill:", "retro:x:1", "retro:fill:1:2", "poll:fill:1", "retro:fill:99999999999999999"])
		{
			assert.throws(() => parseRetroComponentId(bad), (error: unknown) => error instanceof UserError, bad);
		}
		assert.equal(plainText("<@&1> @here [link](https://x) **b** #kênh"), "\\<\\@&1\\> \\@here link (https://x) \\*\\*b\\*\\* \\#kênh");
	});

	test("role quản lý retro không dùng được làm role danh hiệu (chặn hai chiều, LL-017)", () =>
	{
		const w = world();
		w.services.retro.changeManagerRoles(GUILD, { add: [ROLE_OTHER] }, ADMIN);
		assert.equal(otherRoleUsage(w.services, GUILD, ROLE_OTHER), "role quản lý retro");
		assert.equal(otherRoleUsage(w.services, GUILD, ROLE_FRONTEND), null);
	});
});
