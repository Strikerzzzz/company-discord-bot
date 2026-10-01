import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Collection, Interaction, MessageFlags, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import type Command from "../src/classes/Command";
import type ContextMenu from "../src/classes/ContextMenu";
import type DiscordClient from "../src/classes/DiscordClient";
import { NO_CONTRIBUTION_CHANNEL } from "../src/discord/messages";
import InteractionCreate, { GUILD_NOT_SERVED, UNKNOWN_INTERACTION } from "../src/events/interactionCreate";
import RecognizeContribution from "../src/interactions/contextMenus/RecognizeContribution";
import { Contribution } from "../src/modules/contribution/types";
import { DEFAULT_GUILD_SETTINGS } from "../src/modules/guild-config/types";
import { AppServices } from "../src/services";
import { UserError } from "../src/shared/errors";
import { CHANNEL_GENERAL, GUILD, OTHER_GUILD, USER_A, USER_B } from "./helpers";

const GENERIC_ERROR = "Đã có lỗi xảy ra khi xử lý yêu cầu. Vui lòng thử lại sau.";

type Kind = "chat" | "button" | "select" | "modal" | "contextMenu" | "autocomplete";

/** Các loại component định tuyến theo namespace customId (buttonIds). */
const COMPONENT_KINDS = ["button", "select", "modal"] as const;

interface Call
{
	method: string;
	payload?: unknown;
}

interface FakeInteractionSpec
{
	kind: Kind;
	name?: string;
	guildId?: string | null;
	permissions?: bigint[];
}

/** Interaction giả: ghi lại mọi lời gọi trả lời và cập nhật trạng thái deferred/replied/ephemeral như discord.js. */
function fakeInteraction(spec: FakeInteractionSpec): { interaction: Interaction; calls: Call[] }
{
	const calls: Call[] = [];
	const guildId = spec.guildId === undefined ? GUILD : spec.guildId;
	const name = spec.name ?? "lenh";
	const state = { deferred: false, replied: false, ephemeral: null as boolean | null };
	const record = (method: string, payload?: unknown): Promise<unknown> =>
	{
		calls.push({ method, payload });
		return Promise.resolve({ id: "600000000000000009", channelId: CHANNEL_GENERAL });
	};
	const fake = {
		guildId,
		commandName: name,
		customId: name,
		user: { id: USER_B },
		member: guildId === null ? null : { roles: [] },
		memberPermissions: new PermissionsBitField(spec.permissions ?? [PermissionFlagsBits.SendMessages]),
		channel: { isThread: () => false, isDMBased: () => false, name: "general" },
		inGuild: () => guildId !== null,
		isChatInputCommand: () => spec.kind === "chat",
		isButton: () => spec.kind === "button",
		isAnySelectMenu: () => spec.kind === "select",
		isModalSubmit: () => spec.kind === "modal",
		isContextMenuCommand: () => spec.kind === "contextMenu",
		isMessageContextMenuCommand: () => spec.kind === "contextMenu",
		isAutocomplete: () => spec.kind === "autocomplete",
		isCommand: () => spec.kind === "chat" || spec.kind === "contextMenu",
		isMessageComponent: () => spec.kind === "button" || spec.kind === "select",
		isRepliable: () => spec.kind !== "autocomplete",
		reply: (payload: unknown) =>
		{
			state.replied = true;
			return record("reply", payload);
		},
		update: (payload: unknown) =>
		{
			state.replied = true;
			return record("update", payload);
		},
		deferUpdate: () =>
		{
			state.deferred = true;
			return record("deferUpdate");
		},
		deferReply: (payload?: { flags?: number }) =>
		{
			state.deferred = true;
			state.ephemeral = payload?.flags === MessageFlags.Ephemeral;
			return record("deferReply", payload);
		},
		editReply: (payload: unknown) =>
		{
			state.replied = true;
			return record("editReply", payload);
		},
		followUp: (payload: unknown) =>
		{
			state.replied = true;
			return record("followUp", payload);
		},
		deleteReply: () => record("deleteReply"),
		respond: (choices: unknown) => record("respond", choices),
		options: { getFocused: () => "" },
		targetMessage: {
			id: "600000000000000002",
			channelId: CHANNEL_GENERAL,
			author: { id: USER_A, bot: false },
			content: "",
		},
		guild: { members: { fetch: () => Promise.resolve({ roles: [] }) } },
	};
	Object.defineProperties(fake, {
		deferred: { get: () => state.deferred },
		replied: { get: () => state.replied },
		ephemeral: { get: () => state.ephemeral },
	});
	return { interaction: fake as unknown as Interaction, calls };
}

interface StubCommand
{
	adminOnly: boolean;
	executed: number;
	/** Tên các handler đã chạy, theo thứ tự. */
	handlers: string[];
	execute: (interaction: Interaction) => Promise<void>;
	executeButton: (interaction: Interaction) => Promise<void>;
	executeSelectMenu: (interaction: Interaction) => Promise<void>;
	executeModal: (interaction: Interaction) => Promise<void>;
	autocomplete: () => string[];
}

function stubCommand(behavior: (interaction: Interaction) => Promise<void> = () => Promise.resolve(), adminOnly = false): StubCommand
{
	const handle = (name: string) => (interaction: Interaction): Promise<void> =>
	{
		stub.executed++;
		stub.handlers.push(name);
		return behavior(interaction);
	};
	const stub: StubCommand = {
		adminOnly,
		executed: 0,
		handlers: [],
		execute: handle("execute"),
		executeButton: handle("executeButton"),
		executeSelectMenu: handle("executeSelectMenu"),
		executeModal: handle("executeModal"),
		autocomplete: () => ["gợi ý"],
	};
	return stub;
}

interface Registry
{
	commands?: Record<string, StubCommand>;
	contextMenus?: Record<string, unknown>;
	buttons?: Record<string, StubCommand>;
	services?: Partial<AppServices>;
}

function dispatcher(registry: Registry = {}): { event: InteractionCreate; client: DiscordClient }
{
	const commands = new Collection<string, Command>(Object.entries(registry.commands ?? {}).map(([name, command]) => [name, command as unknown as Command]));
	const contextMenus = new Collection<string, ContextMenu>(
		Object.entries(registry.contextMenus ?? {}).map(([name, menu]) => [name, menu as ContextMenu]),
	);
	const buttons = registry.buttons ?? {};
	const client = {
		guildIds: [GUILD],
		services: { guildConfig: { getSettings: () => DEFAULT_GUILD_SETTINGS }, ...registry.services },
		interactions: { commands, contextMenus },
		buttons: { resolve: (customId: string) => buttons[customId.split(":", 1)[0]] },
	} as unknown as DiscordClient;
	return { event: new InteractionCreate(client), client };
}

function methods(calls: Call[]): string[]
{
	return calls.map(call => call.method);
}

describe("dispatcher interactionCreate: guild và lệnh không xác định", () =>
{
	test("interaction ở guild không có trong DISCORD_GUILD_IDS: trả lời riêng rồi dừng, không chạy lệnh", async () =>
	{
		const command = stubCommand();
		const { event } = dispatcher({ commands: { lenh: command }, buttons: { lenh: command } });

		for (const kind of ["chat", ...COMPONENT_KINDS] as const)
		{
			const { interaction, calls } = fakeInteraction({ kind, guildId: OTHER_GUILD });
			await event.execute(interaction);
			assert.deepEqual(calls, [{ method: "reply", payload: { content: GUILD_NOT_SERVED, flags: MessageFlags.Ephemeral } }], kind);
		}
		assert.equal(command.executed, 0);

		const autocomplete = fakeInteraction({ kind: "autocomplete", guildId: OTHER_GUILD });
		await event.execute(autocomplete.interaction);
		assert.deepEqual(autocomplete.calls, [{ method: "respond", payload: [] }]);
	});

	test("interaction ngoài guild (DM) vẫn tới lệnh để lệnh tự báo lỗi phù hợp", async () =>
	{
		const command = stubCommand(() => Promise.reject(new UserError("Lệnh này chỉ dùng được trong server.")));
		const { event } = dispatcher({ commands: { lenh: command } });
		const { interaction, calls } = fakeInteraction({ kind: "chat", guildId: null });

		await event.execute(interaction);

		assert.equal(command.executed, 1);
		assert.deepEqual(calls, [{ method: "reply", payload: { content: "Lệnh này chỉ dùng được trong server.", flags: MessageFlags.Ephemeral } }]);
	});

	test("lệnh, context menu, nút, menu chọn hay form không còn handler: báo riêng thay vì im lặng", async () =>
	{
		const { event } = dispatcher();
		for (const kind of ["chat", ...COMPONENT_KINDS, "contextMenu"] as const)
		{
			const { interaction, calls } = fakeInteraction({ kind, name: "khong-con" });
			await event.execute(interaction);
			assert.deepEqual(calls, [{ method: "reply", payload: { content: UNKNOWN_INTERACTION, flags: MessageFlags.Ephemeral } }], kind);
		}

		const autocomplete = fakeInteraction({ kind: "autocomplete", name: "khong-con" });
		await event.execute(autocomplete.interaction);
		assert.deepEqual(autocomplete.calls, [{ method: "respond", payload: [] }]);
	});

	test("lệnh admin: người không có quyền bị chặn ở dispatcher", async () =>
	{
		const command = stubCommand(() => Promise.resolve(), true);
		const { event } = dispatcher({ commands: { lenh: command } });

		const denied = fakeInteraction({ kind: "chat" });
		await event.execute(denied.interaction);
		assert.equal(command.executed, 0);
		assert.deepEqual(denied.calls, [{ method: "reply", payload: { content: "Bạn không có quyền dùng lệnh này.", flags: MessageFlags.Ephemeral } }]);

		const allowed = fakeInteraction({ kind: "chat", permissions: [PermissionFlagsBits.ManageGuild] });
		await event.execute(allowed.interaction);
		assert.equal(command.executed, 1);
	});
});

describe("dispatcher interactionCreate: component (nút, menu chọn, form)", () =>
{
	test("định tuyến theo namespace customId tới đúng handler của command", async () =>
	{
		const command = stubCommand();
		const { event } = dispatcher({ buttons: { bang: command } });
		for (const kind of COMPONENT_KINDS)
		{
			const { interaction, calls } = fakeInteraction({ kind, name: "bang:payload" });
			await event.execute(interaction);
			assert.deepEqual(calls, [], kind);
		}
		assert.deepEqual(command.handlers, ["executeButton", "executeSelectMenu", "executeModal"]);
	});

	test("component của lệnh admin: người không có quyền admin bị chặn ở dispatcher như lệnh gõ (DEC-033)", async () =>
	{
		const command = stubCommand(() => Promise.resolve(), true);
		const { event } = dispatcher({ buttons: { bang: command } });

		for (const kind of COMPONENT_KINDS)
		{
			const denied = fakeInteraction({ kind, name: "bang:payload" });
			await event.execute(denied.interaction);
			assert.deepEqual(denied.calls, [{ method: "reply", payload: { content: "Bạn không có quyền dùng lệnh này.", flags: MessageFlags.Ephemeral } }], kind);
		}
		assert.equal(command.executed, 0);

		for (const kind of COMPONENT_KINDS)
		{
			const allowed = fakeInteraction({ kind, name: "bang:payload", permissions: [PermissionFlagsBits.ManageGuild] });
			await event.execute(allowed.interaction);
		}
		assert.deepEqual(command.handlers, ["executeButton", "executeSelectMenu", "executeModal"]);
	});

	test("component của lệnh không phải admin (contribution, poll, leaderboard) không bị kiểm tra quyền admin", async () =>
	{
		const command = stubCommand();
		const { event } = dispatcher({ buttons: { contrib: command } });
		for (const kind of COMPONENT_KINDS)
		{
			const { interaction, calls } = fakeInteraction({ kind, name: "contrib:1" });
			await event.execute(interaction);
			assert.deepEqual(calls, [], kind);
		}
		assert.equal(command.executed, 3);
	});

	test("lỗi sau khi đã cập nhật message của component: báo riêng bằng follow-up, không sửa message", async () =>
	{
		const command = stubCommand(async interaction =>
		{
			if (!interaction.isAnySelectMenu()) return;
			await interaction.update({ content: "bảng mới" });
			throw new UserError("Không gán được role này.");
		});
		const { event } = dispatcher({ buttons: { bang: command } });
		const { interaction, calls } = fakeInteraction({ kind: "select", name: "bang:role" });

		await event.execute(interaction);

		assert.deepEqual(methods(calls), ["update", "followUp"]);
		assert.deepEqual(calls[1].payload, { content: "Không gán được role này.", flags: MessageFlags.Ephemeral });
	});

	test("lỗi sau deferUpdate: báo riêng bằng follow-up", async () =>
	{
		const command = stubCommand(async interaction =>
		{
			if (!interaction.isButton()) return;
			await interaction.deferUpdate();
			throw new UserError("Bot chưa có quyền.");
		});
		const { event } = dispatcher({ buttons: { bang: command } });
		const { interaction, calls } = fakeInteraction({ kind: "button", name: "bang:setup" });

		await event.execute(interaction);

		assert.deepEqual(methods(calls), ["deferUpdate", "followUp"]);
		assert.deepEqual(calls[1].payload, { content: "Bot chưa có quyền.", flags: MessageFlags.Ephemeral });
	});
});

describe("dispatcher interactionCreate: error boundary", () =>
{
	test("lỗi trước khi trả lời: reply riêng", async () =>
	{
		const { event } = dispatcher({ commands: { lenh: stubCommand(() => Promise.reject(new UserError("Sai rồi."))) } });
		const { interaction, calls } = fakeInteraction({ kind: "chat" });
		await event.execute(interaction);
		assert.deepEqual(calls, [{ method: "reply", payload: { content: "Sai rồi.", flags: MessageFlags.Ephemeral } }]);
	});

	test("lỗi sau khi defer riêng: thay \"đang suy nghĩ...\" bằng thông báo lỗi", async () =>
	{
		const command = stubCommand(async interaction =>
		{
			if (!interaction.isChatInputCommand()) return;
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			throw new UserError("Không tìm thấy.");
		});
		const { event } = dispatcher({ commands: { lenh: command } });
		const { interaction, calls } = fakeInteraction({ kind: "chat" });

		await event.execute(interaction);

		assert.deepEqual(methods(calls), ["deferReply", "editReply"]);
		assert.deepEqual(calls[1].payload, { content: "Không tìm thấy.", embeds: [], components: [] });
	});

	test("lỗi sau khi defer công khai: xoá phản hồi đang chờ rồi báo lỗi riêng, không để lỗi hiện công khai", async () =>
	{
		const command = stubCommand(async interaction =>
		{
			if (!interaction.isChatInputCommand()) return;
			await interaction.deferReply();
			throw new UserError("Tin nhắn này đã được ghi nhận.");
		});
		const { event } = dispatcher({ commands: { lenh: command } });
		const { interaction, calls } = fakeInteraction({ kind: "chat" });

		await event.execute(interaction);

		assert.deepEqual(methods(calls), ["deferReply", "deleteReply", "followUp"]);
		assert.deepEqual(calls[2].payload, { content: "Tin nhắn này đã được ghi nhận.", flags: MessageFlags.Ephemeral });
	});

	test("lỗi hệ thống sau khi đã trả lời: follow-up riêng với thông báo chung, ghi log lỗi", async (t) =>
	{
		const logged = t.mock.method(console, "error", () => undefined);
		const command = stubCommand(async interaction =>
		{
			if (!interaction.isChatInputCommand()) return;
			await interaction.reply({ content: "ok" });
			throw new Error("database is locked");
		});
		const { event } = dispatcher({ commands: { lenh: command } });
		const { interaction, calls } = fakeInteraction({ kind: "chat" });

		await event.execute(interaction);

		assert.deepEqual(methods(calls), ["reply", "followUp"]);
		assert.deepEqual(calls[1].payload, { content: GENERIC_ERROR, flags: MessageFlags.Ephemeral });
		assert.equal(logged.mock.callCount(), 1);
	});

	test("context menu Ghi nhận đóng góp: lỗi sau khi defer riêng (chưa chọn kênh contribution) hiện ngay trong phản hồi riêng", async () =>
	{
		const contributions = {
			submit: (): Contribution =>
			{
				throw new Error("không được gọi khi chưa chọn kênh contribution");
			},
		};
		const registry: Registry = { services: { contributions } as unknown as Partial<AppServices> };
		const { event, client } = dispatcher(registry);
		const menu = new RecognizeContribution(client);
		client.interactions.contextMenus.set("Ghi nhận đóng góp", menu);
		const { interaction, calls } = fakeInteraction({ kind: "contextMenu", name: "Ghi nhận đóng góp" });

		await event.execute(interaction);

		assert.deepEqual(methods(calls), ["deferReply", "editReply"]);
		assert.deepEqual(calls[0].payload, { flags: MessageFlags.Ephemeral }, "defer riêng: thẻ đăng ở kênh contribution");
		assert.deepEqual(calls[1].payload, { content: NO_CONTRIBUTION_CHANNEL, embeds: [], components: [] });
	});
});
