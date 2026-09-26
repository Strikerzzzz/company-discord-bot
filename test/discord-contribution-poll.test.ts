import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import {
	ActionRowBuilder,
	APIEmbed,
	ButtonBuilder,
	ButtonInteraction,
	ChatInputCommandInteraction,
	EmbedBuilder,
	MessageContextMenuCommandInteraction,
	MessageFlags,
	PermissionFlagsBits,
	PermissionsBitField,
} from "discord.js";
import type DiscordClient from "../src/classes/DiscordClient";
import { progressBar } from "../src/discord/format";
import { refreshPollMessage, runPollSweep, startPollScheduler } from "../src/discord/pollScheduler";
import {
	contributionEmbed,
	contributionListEmbed,
	contributionListLine,
	contributionMessage,
	descriptionFromMessage,
	parseContributionButtonId,
	titleFromMessage,
} from "../src/discord/views/contribution";
import { parsePollButtonId, parsePollOptions, pollEmbed, pollMessage, pollSelectionText } from "../src/discord/views/poll";
import ContributionCmd from "../src/interactions/commands/contribution";
import PollCmd from "../src/interactions/commands/poll";
import RecognizeContribution from "../src/interactions/contextMenus/RecognizeContribution";
import { Contribution, ContributionVoteResult, SubmitContributionInput } from "../src/modules/contribution/types";
import { DEFAULT_GUILD_SETTINGS, GuildSettings } from "../src/modules/guild-config/types";
import { CreatePollInput, Poll, PollVoteResult } from "../src/modules/poll/types";
import { AppServices } from "../src/services";
import { UserError } from "../src/shared/errors";
import { ADMIN, CHANNEL_BOT, CHANNEL_GENERAL, GUILD, ROLE_BACKEND, ROLE_FRONTEND, ROLE_OTHER, USER_A, USER_B, USER_C } from "./helpers";

// ---------------------------------------------------------------------------------------------
// Dữ liệu mẫu và đối tượng giả (không cần Discord client hay database thật)
// ---------------------------------------------------------------------------------------------

const MESSAGE_ID = "600000000000000001";
const OTHER_MESSAGE_ID = "600000000000000002";
const CREATED_AT = Date.UTC(2026, 0, 1, 8, 0, 0);

type Rows = ActionRowBuilder<ButtonBuilder>[];

/** Payload mà command truyền cho reply/update/followUp (ép kiểu cho gọn trong test). */
interface Payload
{
	content?: string;
	embeds?: EmbedBuilder[];
	components?: Rows;
	flags?: number;
	withResponse?: boolean;
}

interface Attached
{
	guildId: string;
	id: number;
	channelId: string;
	messageId: string;
}

function makeContribution(overrides: Partial<Contribution> = {}): Contribution
{
	return {
		id: 7,
		guildId: GUILD,
		authorId: USER_A,
		submittedBy: USER_A,
		title: "Tối ưu thời gian build",
		description: "Giảm thời gian build CI từ 10 phút xuống 4 phút.",
		category: "cai-tien",
		link: null,
		channelId: null,
		messageId: null,
		status: "active",
		createdAt: CREATED_AT,
		votes: 3,
		...overrides,
	};
}

function makePoll(votes: number[], overrides: Partial<Poll> = {}): Poll
{
	return {
		id: 5,
		guildId: GUILD,
		creatorId: USER_A,
		question: "Team building ở đâu?",
		multiSelect: false,
		xpReward: 5,
		channelId: null,
		messageId: null,
		closesAt: null,
		closedAt: null,
		createdAt: CREATED_AT,
		open: true,
		options: votes.map((count, index) => ({ index, label: `Lựa chọn ${index + 1}`, votes: count })),
		participants: votes.reduce((sum, count) => sum + count, 0),
		...overrides,
	};
}

function embedJson(payload: Payload | undefined, index = 0): APIEmbed
{
	const embed = payload?.embeds?.[index];
	assert.ok(embed instanceof EmbedBuilder, "payload phải có embed");
	return embed.toJSON();
}

function buttonsOf(rows: Rows | undefined): { customId: string; label: string; disabled: boolean }[]
{
	return (rows ?? []).flatMap(row => row.components.map(button => button.toJSON())).map(json =>
	{
		assert.ok("custom_id" in json, "nút phải có customId");
		return { customId: json.custom_id, label: json.label ?? "", disabled: json.disabled ?? false };
	});
}

function field(embed: APIEmbed, name: string): string | undefined
{
	return embed.fields?.find(item => item.name === name)?.value;
}

class FakeContributions
{
	submitted: SubmitContributionInput[] = [];
	attached: Attached[] = [];
	toggles: { guildId: string; contributionId: number; voterId: string }[] = [];
	listCalls: { guildId: string; authorId?: string; limit: number }[] = [];
	stored = new Map<number, Contribution>();
	nextVoted = true;
	// Vị trí message công khai gốc mà toggleVote trả về (null = chưa đăng message).
	location: { channelId: string; messageId: string } | null = null;

	submit(input: SubmitContributionInput): Contribution
	{
		this.submitted.push(input);
		return makeContribution({ ...input, votes: 0 });
	}

	attachMessage(guildId: string, id: number, channelId: string, messageId: string): void
	{
		this.attached.push({ guildId, id, channelId, messageId });
	}

	get(_guildId: string, contributionId: number): Contribution | null
	{
		return this.stored.get(contributionId) ?? null;
	}

	list(guildId: string, options: { authorId?: string; limit: number }): Contribution[]
	{
		this.listCalls.push({ guildId, ...options });
		return [...this.stored.values()];
	}

	toggleVote(input: { guildId: string; contributionId: number; voterId: string }): ContributionVoteResult
	{
		this.toggles.push(input);
		const voted = this.nextVoted;
		this.nextVoted = !voted;
		return { voted, contribution: makeContribution({ id: input.contributionId, votes: voted ? 4 : 3, ...this.location }) };
	}
}

class FakePolls
{
	created: CreatePollInput[] = [];
	attached: Attached[] = [];
	votes: { guildId: string; pollId: number; userId: string; optionIndex: number; roleIds: readonly string[] }[] = [];
	closes: { guildId: string; pollId: number; actorId: string; actorIsAdmin: boolean }[] = [];
	closedPoll = makePoll([2, 1], { open: false, closedAt: CREATED_AT + 60_000, channelId: CHANNEL_GENERAL, messageId: MESSAGE_ID });

	create(input: CreatePollInput): Poll
	{
		this.created.push(input);
		return makePoll(input.options.map(() => 0), { question: input.question, multiSelect: input.multiSelect, xpReward: input.xpReward });
	}

	attachMessage(guildId: string, id: number, channelId: string, messageId: string): void
	{
		this.attached.push({ guildId, id, channelId, messageId });
	}

	vote(input: { guildId: string; pollId: number; userId: string; optionIndex: number; roleIds: readonly string[] }): PollVoteResult
	{
		this.votes.push(input);
		return { poll: makePoll([1, 1]), selected: [input.optionIndex], xpAwarded: 5 };
	}

	close(input: { guildId: string; pollId: number; actorId: string; actorIsAdmin: boolean }): Poll
	{
		this.closes.push(input);
		return this.closedPoll;
	}

	get(_guildId: string, pollId: number): Poll | null
	{
		return pollId === 5 ? makePoll([3, 1]) : null;
	}

	listOpen(_guildId: string): Poll[]
	{
		return [makePoll([1, 0])];
	}
}

interface FakeChannel
{
	isTextBased: () => boolean;
	messages: { edit: (messageId: string, payload: Payload) => Promise<void> };
}

/** Kênh giả ghi lại các lần sửa message; sửa message nằm trong `failFor` thì lỗi. */
function fakeChannel(edits: { messageId: string; payload: Payload }[], failFor: string[] = []): FakeChannel
{
	return {
		isTextBased: () => true,
		messages: {
			edit: (messageId, payload) =>
			{
				if (failFor.includes(messageId)) return Promise.reject(new Error("Missing Access"));
				edits.push({ messageId, payload });
				return Promise.resolve();
			},
		},
	};
}

interface Setup
{
	client: DiscordClient;
	contributions: FakeContributions;
	polls: FakePolls;
	edits: { messageId: string; payload: Payload }[];
}

function setup(settings: Partial<GuildSettings> = {}, channels: Record<string, FakeChannel> = {}): Setup
{
	const contributions = new FakeContributions();
	const polls = new FakePolls();
	const edits: { messageId: string; payload: Payload }[] = [];
	const allChannels: Record<string, FakeChannel> = { [CHANNEL_GENERAL]: fakeChannel(edits), ...channels };
	const services = {
		guildConfig: { getSettings: (): GuildSettings => ({ ...DEFAULT_GUILD_SETTINGS, ...settings }) },
		contributions,
		polls,
	};
	const client = {
		services: services as unknown as AppServices,
		channels: { fetch: (id: string) => Promise.resolve(allChannels[id] ?? null) },
	};
	return { client: client as unknown as DiscordClient, contributions, polls, edits };
}

interface MemberSpec
{
	userId?: string;
	roleIds?: string[];
	manageGuild?: boolean;
}

type OptionValues = Record<string, string | number | boolean>;

function chatInput(subcommand: string, values: OptionValues = {}, member: MemberSpec = {})
{
	const replies: Payload[] = [];
	const interaction = {
		guildId: GUILD,
		user: { id: member.userId ?? USER_B },
		member: { roles: member.roleIds ?? [] },
		memberPermissions: new PermissionsBitField(member.manageGuild ? PermissionFlagsBits.ManageGuild : 0n),
		inGuild: () => true,
		options: {
			getSubcommand: () => subcommand,
			getString: (name: string) => (typeof values[name] === "string" ? values[name] : null),
			getInteger: (name: string) => (typeof values[name] === "number" ? values[name] : null),
			getBoolean: (name: string) => (typeof values[name] === "boolean" ? values[name] : null),
			getUser: (name: string) => (typeof values[name] === "string" ? { id: values[name] } : null),
		},
		reply: (payload: Payload) =>
		{
			replies.push(payload);
			return Promise.resolve({ resource: { message: { id: MESSAGE_ID, channelId: CHANNEL_GENERAL } } });
		},
	};
	return { interaction: interaction as unknown as ChatInputCommandInteraction, replies };
}

function buttonPress(customId: string, member: MemberSpec = {}, messageId = MESSAGE_ID)
{
	const updates: Payload[] = [];
	const followUps: Payload[] = [];
	const interaction = {
		customId,
		message: { id: messageId },
		guildId: GUILD,
		user: { id: member.userId ?? USER_B },
		member: { roles: member.roleIds ?? [] },
		inGuild: () => true,
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
	};
	return { interaction: interaction as unknown as ButtonInteraction, updates, followUps };
}

interface TargetSpec
{
	authorId?: string;
	bot?: boolean;
	content: string;
	cachedRoles?: string[];
	fetchedRoles?: string[];
}

function messageMenu(target: TargetSpec)
{
	const replies: Payload[] = [];
	const authorId = target.authorId ?? USER_A;
	const interaction = {
		guildId: GUILD,
		user: { id: USER_B },
		inGuild: () => true,
		isMessageContextMenuCommand: () => true,
		targetMessage: {
			id: OTHER_MESSAGE_ID,
			author: { id: authorId, bot: target.bot ?? false },
			content: target.content,
			url: `https://discord.com/channels/${GUILD}/${CHANNEL_GENERAL}/${OTHER_MESSAGE_ID}`,
			member: target.cachedRoles ? { roles: target.cachedRoles } : null,
		},
		guild: {
			members: {
				fetch: (id: string) => (target.fetchedRoles && id === authorId
					? Promise.resolve({ roles: target.fetchedRoles })
					: Promise.reject(new Error("Unknown Member"))),
			},
		},
		reply: (payload: Payload) =>
		{
			replies.push(payload);
			return Promise.resolve({ resource: { message: { id: MESSAGE_ID, channelId: CHANNEL_GENERAL } } });
		},
	};
	return { interaction: interaction as unknown as MessageContextMenuCommandInteraction, replies };
}

/** Kiểm tra lỗi là UserError với đúng thông báo hiển thị cho người dùng. */
function userError(message: string): (error: unknown) => boolean
{
	return error => error instanceof UserError && error.message === message;
}

// ---------------------------------------------------------------------------------------------
// View: Contribution
// ---------------------------------------------------------------------------------------------

describe("view contribution", () =>
{
	test("embed active: tiêu đề, nội dung, tác giả, loại, link, footer; nút ghi nhận có số lượt", () =>
	{
		const contribution = makeContribution({ link: "https://example.com/pr/1" });
		const payload = contributionMessage(contribution);
		const embed = embedJson(payload);

		assert.equal(embed.title, "Tối ưu thời gian build");
		assert.equal(embed.description, contribution.description);
		assert.equal(field(embed, "Tác giả"), `<@${USER_A}>`);
		assert.equal(field(embed, "Người ghi nhận"), undefined);
		assert.equal(field(embed, "Loại"), "Cải tiến quy trình");
		assert.equal(field(embed, "Link"), "https://example.com/pr/1");
		assert.equal(field(embed, "Trạng thái"), undefined);
		assert.equal(embed.footer?.text, "Contribution #7");
		assert.equal(embed.timestamp, new Date(CREATED_AT).toISOString());
		assert.deepEqual(buttonsOf(payload.components), [{ customId: "contrib:7", label: "👍 Ghi nhận (3)", disabled: false }]);
	});

	test("ghi nhận hộ người khác thì có thêm field Người ghi nhận; không có link thì không có field Link", () =>
	{
		const embed = contributionEmbed(makeContribution({ submittedBy: USER_B })).toJSON();
		assert.equal(field(embed, "Tác giả"), `<@${USER_A}>`);
		assert.equal(field(embed, "Người ghi nhận"), `<@${USER_B}>`);
		assert.equal(field(embed, "Link"), undefined);
	});

	test("contribution đã gỡ: ghi rõ Đã bị gỡ, không có nút, màu khác active", () =>
	{
		const active = contributionMessage(makeContribution());
		const removed = contributionMessage(makeContribution({ status: "removed" }));

		assert.match(field(embedJson(removed), "Trạng thái") ?? "", /Đã bị gỡ/);
		assert.deepEqual(removed.components, []);
		assert.notEqual(embedJson(removed).color, embedJson(active).color);
	});

	test("dòng danh sách đúng định dạng, có link tới message nếu biết vị trí; danh sách rỗng", () =>
	{
		const line = contributionListLine(makeContribution({ title: "Sửa **lỗi**" }));
		assert.equal(line, `#7 · **Sửa \\*\\*lỗi\\*\\*** · 👍 3 · <t:${CREATED_AT / 1000}:R>`);

		const linked = contributionListLine(makeContribution({ channelId: CHANNEL_GENERAL, messageId: MESSAGE_ID }));
		assert.ok(linked.startsWith(`[#7](https://discord.com/channels/${GUILD}/${CHANNEL_GENERAL}/${MESSAGE_ID}) · `));

		const empty = contributionListEmbed([], USER_A).toJSON();
		assert.equal(empty.description, `Của <@${USER_A}>\n\nChưa có đóng góp nào.`);
	});

	test("parse customId contrib:<id>; sai định dạng thì UserError", () =>
	{
		assert.equal(parseContributionButtonId("contrib:7"), 7);
		assert.equal(parseContributionButtonId("contrib:123456789"), 123456789);

		for (const customId of ["contrib", "contrib:", "contrib:0", "contrib:-1", "contrib:abc", "contrib:1.5", "contrib:1:2", "poll:1", "contrib:99999999999999999"])
		{
			assert.throws(() => parseContributionButtonId(customId), userError("Nút không hợp lệ."), customId);
		}
	});

	test("tiêu đề và mô tả khi ghi nhận từ tin nhắn", () =>
	{
		assert.equal(titleFromMessage("  Viết tài liệu onboarding\nChi tiết ở dưới"), "Viết tài liệu onboarding");
		assert.equal(titleFromMessage("ok"), "Đóng góp từ tin nhắn");
		assert.equal(titleFromMessage(""), "Đóng góp từ tin nhắn");

		const longTitle = titleFromMessage("a".repeat(150));
		assert.equal(Array.from(longTitle).length, 100);
		assert.ok(longTitle.endsWith("…"));

		assert.equal(descriptionFromMessage("   "), "(Tin nhắn không có nội dung văn bản)");
		assert.equal(Array.from(descriptionFromMessage("b".repeat(2000))).length, 1500);
	});
});

// ---------------------------------------------------------------------------------------------
// View: Vote
// ---------------------------------------------------------------------------------------------

describe("view vote", () =>
{
	test("số phiếu và tỉ lệ % trên tổng số phiếu; chưa có phiếu thì 0%", () =>
	{
		const description = pollEmbed(makePoll([3, 1, 0])).toJSON().description ?? "";
		assert.ok(description.includes(`**1. Lựa chọn 1**\n${progressBar(3, 4)} 3 phiếu (75%)`));
		assert.ok(description.includes(`**2. Lựa chọn 2**\n${progressBar(1, 4)} 1 phiếu (25%)`));
		assert.ok(description.includes(`**3. Lựa chọn 3**\n${progressBar(0, 4)} 0 phiếu (0%)`));

		const empty = pollEmbed(makePoll([0, 0])).toJSON().description ?? "";
		assert.equal((empty.match(/0 phiếu \(0%\)/g) ?? []).length, 2);

		const multi = pollEmbed(makePoll([2, 2, 1], { multiSelect: true, participants: 3 })).toJSON().description ?? "";
		assert.ok(multi.includes("2 phiếu (40%)"));
		assert.ok(multi.includes("1 phiếu (20%)"));
	});

	test("field Hình thức, XP, Thời hạn và footer", () =>
	{
		const closesAt = CREATED_AT + 3_600_000;
		const open = pollEmbed(makePoll([1, 2], { multiSelect: true, closesAt })).toJSON();
		assert.equal(open.title, "🗳️ Team building ở đâu?");
		assert.equal(field(open, "Hình thức"), "Chọn nhiều · Phiếu ẩn danh");
		assert.equal(field(open, "XP khi tham gia"), "+5 XP");
		assert.equal(field(open, "Thời hạn"), `<t:${closesAt / 1000}:R>`);
		assert.equal(open.footer?.text, "Vote #5 · 3 người tham gia");

		const unlimited = pollEmbed(makePoll([0, 0], { xpReward: 0 })).toJSON();
		assert.equal(field(unlimited, "Hình thức"), "Chọn một · Phiếu ẩn danh");
		assert.equal(field(unlimited, "XP khi tham gia"), "Không có");
		assert.equal(field(unlimited, "Thời hạn"), "Không giới hạn");
	});

	test("nút: customId poll:<id>:<index>, tối đa 5 nút mỗi hàng, label có số thứ tự", () =>
	{
		const rows = pollMessage(makePoll([0, 0, 0, 0, 0, 0, 0])).components;
		assert.deepEqual(rows.map(row => row.components.length), [5, 2]);

		const buttons = buttonsOf(rows);
		assert.deepEqual(buttons.map(button => button.customId), [0, 1, 2, 3, 4, 5, 6].map(i => `poll:5:${i}`));
		assert.equal(buttons[0].label, "1. Lựa chọn 1");
		assert.ok(buttons.every(button => !button.disabled));

		assert.deepEqual(pollMessage(makePoll(Array.from({ length: 10 }, () => 0))).components.map(row => row.components.length), [5, 5]);
	});

	test("label dài bị cắt để vừa giới hạn 80 ký tự của nút", () =>
	{
		const poll = makePoll([0, 0]);
		poll.options[1].label = "x".repeat(80);
		const label = buttonsOf(pollMessage(poll).components)[1].label;

		assert.ok(Array.from(label).length <= 80);
		assert.ok(label.startsWith("2. x"));
		assert.ok(label.endsWith("…"));
	});

	test("vote đã đóng: tiêu đề [Đã đóng], Thời hạn Đã đóng, mọi nút bị vô hiệu hoá", () =>
	{
		const payload = pollMessage(makePoll([1, 1], { open: false, closedAt: CREATED_AT, closesAt: CREATED_AT }));
		const embed = embedJson(payload);

		assert.equal(embed.title, "🗳️ [Đã đóng] Team building ở đâu?");
		assert.equal(field(embed, "Thời hạn"), "Đã đóng");
		const buttons = buttonsOf(payload.components);
		assert.equal(buttons.length, 2);
		assert.ok(buttons.every(button => button.disabled));
	});

	test("không lộ người vote: embed, nút và phản hồi không chứa mention hay ID người dùng", () =>
	{
		const poll = makePoll([2, 1], { creatorId: USER_A });
		const payload = pollMessage(poll);
		const rendered = JSON.stringify([payload.embeds.map(embed => embed.toJSON()), payload.components.map(row => row.toJSON())]);
		const feedback = pollSelectionText({ poll, selected: [0], xpAwarded: 0 });

		for (const text of [rendered, feedback])
		{
			assert.ok(!text.includes("<@"));
			for (const id of [USER_A, USER_B, USER_C]) assert.ok(!text.includes(id));
		}
	});

	test("phản hồi riêng cho người vote", () =>
	{
		const poll = makePoll([1, 1, 1]);
		assert.equal(pollSelectionText({ poll, selected: [0, 2], xpAwarded: 5 }), "Bạn đang chọn: Lựa chọn 1, Lựa chọn 3 · +5 XP");
		assert.equal(pollSelectionText({ poll, selected: [1], xpAwarded: 0 }), "Bạn đang chọn: Lựa chọn 2");
		assert.equal(pollSelectionText({ poll, selected: [], xpAwarded: 0 }), "Bạn chưa chọn lựa chọn nào.");
	});

	test("parse customId poll:<pollId>:<optionIndex>; sai định dạng thì UserError", () =>
	{
		assert.deepEqual(parsePollButtonId("poll:5:0"), { pollId: 5, optionIndex: 0 });
		assert.deepEqual(parsePollButtonId("poll:12:9"), { pollId: 12, optionIndex: 9 });

		for (const customId of ["poll", "poll:5", "poll:5:", "poll:0:1", "poll:5:10", "poll:5:-1", "poll:x:1", "poll:5:1:2", "contrib:5:1"])
		{
			assert.throws(() => parsePollButtonId(customId), userError("Nút không hợp lệ."), customId);
		}
	});

	test("tách lựa chọn theo dấu |, bỏ khoảng trắng và phần rỗng", () =>
	{
		assert.deepEqual(parsePollOptions(" Có | Không ||  Chưa rõ | "), ["Có", "Không", "Chưa rõ"]);
		assert.deepEqual(parsePollOptions("Một lựa chọn"), ["Một lựa chọn"]);
	});
});

// ---------------------------------------------------------------------------------------------
// /poll và nút vote
// ---------------------------------------------------------------------------------------------

describe("/poll", () =>
{
	const createValues: OptionValues = { "cau-hoi": "Ăn trưa ở đâu?", "lua-chon": "Cơm | Phở | Bún" };

	test("create: người không có quyền bị từ chối, không tạo vote", async () =>
	{
		const { client, polls } = setup({ pollCreatorRoleId: ROLE_BACKEND });
		const { interaction, replies } = chatInput("create", createValues, { roleIds: [ROLE_OTHER] });

		await assert.rejects(new PollCmd(client).execute(interaction), userError("Bạn không có quyền tạo vote."));
		assert.equal(polls.created.length, 0);
		assert.equal(replies.length, 0);
	});

	test("create: role tạo vote nhưng không phải admin thì không được đặt XP riêng", async () =>
	{
		const { client, polls } = setup({ pollCreatorRoleId: ROLE_BACKEND });
		const { interaction } = chatInput("create", { ...createValues, xp: 50 }, { roleIds: [ROLE_BACKEND] });

		await assert.rejects(new PollCmd(client).execute(interaction), userError("Chỉ admin mới đặt được XP riêng cho vote."));
		assert.equal(polls.created.length, 0);
	});

	test("create: role tạo vote dùng XP mặc định của guild; trả lời công khai rồi lưu vị trí message", async () =>
	{
		const { client, polls } = setup({ pollCreatorRoleId: ROLE_BACKEND, defaultPollXp: 7 });
		const { interaction, replies } = chatInput("create", createValues, { userId: USER_B, roleIds: [ROLE_BACKEND] });

		await new PollCmd(client).execute(interaction);

		assert.deepEqual(polls.created, [{
			guildId: GUILD,
			creatorId: USER_B,
			question: "Ăn trưa ở đâu?",
			options: ["Cơm", "Phở", "Bún"],
			multiSelect: false,
			xpReward: 7,
			durationMinutes: null,
		}]);
		assert.equal(replies.length, 1);
		assert.equal(replies[0].withResponse, true);
		assert.equal(replies[0].flags, undefined);
		assert.equal(embedJson(replies[0]).title, "🗳️ Ăn trưa ở đâu?");
		assert.equal(buttonsOf(replies[0].components).length, 3);
		assert.deepEqual(polls.attached, [{ guildId: GUILD, id: 5, channelId: CHANNEL_GENERAL, messageId: MESSAGE_ID }]);
	});

	test("create: admin (Manage Server hoặc role admin) đặt được XP riêng, chọn nhiều và thời hạn", async () =>
	{
		const byPermission = setup();
		const first = chatInput("create", { ...createValues, xp: 20, "nhieu-lua-chon": true, "thoi-han-phut": 60 }, { manageGuild: true });
		await new PollCmd(byPermission.client).execute(first.interaction);
		assert.equal(byPermission.polls.created[0].xpReward, 20);
		assert.equal(byPermission.polls.created[0].multiSelect, true);
		assert.equal(byPermission.polls.created[0].durationMinutes, 60);

		const byRole = setup({ adminRoleId: ROLE_FRONTEND });
		const second = chatInput("create", { ...createValues, xp: 0 }, { roleIds: [ROLE_FRONTEND] });
		await new PollCmd(byRole.client).execute(second.interaction);
		assert.equal(byRole.polls.created[0].xpReward, 0);
	});

	test("nút vote: gọi service kèm role, cập nhật embed, phản hồi riêng kèm XP", async () =>
	{
		const { client, polls } = setup();
		const { interaction, updates, followUps } = buttonPress("poll:5:1", { userId: USER_C, roleIds: [ROLE_BACKEND] });

		await new PollCmd(client).executeButton(interaction);

		assert.deepEqual(polls.votes, [{ guildId: GUILD, pollId: 5, userId: USER_C, optionIndex: 1, roleIds: [ROLE_BACKEND] }]);
		assert.equal(updates.length, 1);
		assert.equal(embedJson(updates[0]).footer?.text, "Vote #5 · 2 người tham gia");
		assert.equal(buttonsOf(updates[0].components).length, 2);
		assert.deepEqual(followUps, [{ content: "Bạn đang chọn: Lựa chọn 2 · +5 XP", flags: MessageFlags.Ephemeral }]);
	});

	test("nút vote sai định dạng: UserError, không gọi service", async () =>
	{
		const { client, polls } = setup();
		const { interaction, updates } = buttonPress("poll:abc:1");

		await assert.rejects(new PollCmd(client).executeButton(interaction), userError("Nút không hợp lệ."));
		assert.equal(polls.votes.length, 0);
		assert.equal(updates.length, 0);
	});

	test("close: truyền quyền admin, trả lời riêng kèm kết quả, sửa message gốc sang trạng thái đóng", async () =>
	{
		const { client, polls, edits } = setup();
		const { interaction, replies } = chatInput("close", { id: 5 }, { userId: ADMIN, manageGuild: true });

		await new PollCmd(client).execute(interaction);

		assert.deepEqual(polls.closes, [{ guildId: GUILD, pollId: 5, actorId: ADMIN, actorIsAdmin: true }]);
		assert.equal(replies[0].content, "Đã đóng vote.");
		assert.equal(replies[0].flags, MessageFlags.Ephemeral);
		assert.equal(embedJson(replies[0]).title, "🗳️ [Đã đóng] Team building ở đâu?");
		assert.equal(edits.length, 1);
		assert.equal(edits[0].messageId, MESSAGE_ID);
		assert.ok(buttonsOf(edits[0].payload.components).every(button => button.disabled));
	});

	test("close: sửa message gốc lỗi thì chỉ ghi log, lệnh vẫn thành công", async (t) =>
	{
		const logged = t.mock.method(console, "error", () => undefined);
		const edits: { messageId: string; payload: Payload }[] = [];
		const { client, polls } = setup({}, { [CHANNEL_GENERAL]: fakeChannel(edits, [MESSAGE_ID]) });
		const { interaction, replies } = chatInput("close", { id: 5 }, { userId: USER_A });

		await new PollCmd(client).execute(interaction);

		assert.equal(polls.closes[0].actorIsAdmin, false);
		assert.equal(replies[0].content, "Đã đóng vote.");
		assert.equal(edits.length, 0);
		assert.equal(logged.mock.callCount(), 1);
	});

	test("results và list trả lời riêng; vote không tồn tại thì UserError", async () =>
	{
		const { client } = setup();
		const command = new PollCmd(client);

		const results = chatInput("results", { id: 5 });
		await command.execute(results.interaction);
		assert.equal(results.replies[0].flags, MessageFlags.Ephemeral);
		assert.equal(results.replies[0].components, undefined);
		assert.ok(embedJson(results.replies[0]).description?.includes("3 phiếu (75%)"));

		await assert.rejects(command.execute(chatInput("results", { id: 99 }).interaction), userError("Không tìm thấy vote #99."));

		const list = chatInput("list");
		await command.execute(list.interaction);
		assert.equal(list.replies[0].flags, MessageFlags.Ephemeral);
		assert.equal(embedJson(list.replies[0]).title, "🗳️ Vote đang mở");
	});
});

// ---------------------------------------------------------------------------------------------
// /contribution, nút ghi nhận và context menu
// ---------------------------------------------------------------------------------------------

describe("/contribution", () =>
{
	test("submit: tác giả là người gửi, kèm role; trả lời công khai rồi lưu vị trí message", async () =>
	{
		const { client, contributions } = setup();
		const values = { "tieu-de": "Viết tài liệu deploy", "noi-dung": "Tài liệu từng bước", loai: "tai-lieu", link: "https://example.com/doc" };
		const { interaction, replies } = chatInput("submit", values, { userId: USER_A, roleIds: [ROLE_BACKEND, ROLE_FRONTEND] });

		await new ContributionCmd(client).execute(interaction);

		assert.deepEqual(contributions.submitted, [{
			guildId: GUILD,
			authorId: USER_A,
			submittedBy: USER_A,
			title: "Viết tài liệu deploy",
			description: "Tài liệu từng bước",
			category: "tai-lieu",
			link: "https://example.com/doc",
			authorRoleIds: [ROLE_BACKEND, ROLE_FRONTEND],
		}]);
		assert.equal(replies[0].withResponse, true);
		assert.equal(replies[0].flags, undefined);
		assert.equal(field(embedJson(replies[0]), "Loại"), "Tài liệu");
		assert.deepEqual(buttonsOf(replies[0].components).map(button => button.customId), ["contrib:7"]);
		assert.deepEqual(contributions.attached, [{ guildId: GUILD, id: 7, channelId: CHANNEL_GENERAL, messageId: MESSAGE_ID }]);
	});

	test("submit: loại không hợp lệ thì UserError", async () =>
	{
		const { client, contributions } = setup();
		const { interaction } = chatInput("submit", { "tieu-de": "abc", "noi-dung": "x", loai: "khong-co" });

		await assert.rejects(new ContributionCmd(client).execute(interaction), userError("Loại đóng góp không hợp lệ."));
		assert.equal(contributions.submitted.length, 0);
	});

	test("nút ghi nhận: bấm để ghi nhận, bấm lại để rút; cập nhật số lượt và phản hồi riêng", async () =>
	{
		const { client, contributions } = setup();
		const command = new ContributionCmd(client);

		const first = buttonPress("contrib:7", { userId: USER_B });
		await command.executeButton(first.interaction);
		assert.deepEqual(contributions.toggles, [{ guildId: GUILD, contributionId: 7, voterId: USER_B }]);
		assert.equal(buttonsOf(first.updates[0].components)[0].label, "👍 Ghi nhận (4)");
		assert.deepEqual(first.followUps, [{ content: "✅ Bạn đã ghi nhận đóng góp này.", flags: MessageFlags.Ephemeral }]);

		const second = buttonPress("contrib:7", { userId: USER_B });
		await command.executeButton(second.interaction);
		assert.equal(buttonsOf(second.updates[0].components)[0].label, "👍 Ghi nhận (3)");
		assert.deepEqual(second.followUps, [{ content: "↩️ Bạn đã rút ghi nhận.", flags: MessageFlags.Ephemeral }]);
	});

	test("nút ghi nhận ở bản xem riêng: cập nhật cả message công khai gốc; bấm trên message gốc thì không sửa thêm", async () =>
	{
		const { client, contributions, edits } = setup();
		contributions.location = { channelId: CHANNEL_GENERAL, messageId: MESSAGE_ID };
		const command = new ContributionCmd(client);

		await command.executeButton(buttonPress("contrib:7", { userId: USER_B }, OTHER_MESSAGE_ID).interaction);
		assert.deepEqual(edits.map(edit => edit.messageId), [MESSAGE_ID]);
		assert.equal(buttonsOf(edits[0].payload.components)[0].label, "👍 Ghi nhận (4)");

		await command.executeButton(buttonPress("contrib:7", { userId: USER_B }, MESSAGE_ID).interaction);
		assert.equal(edits.length, 1);
	});

	test("nút ghi nhận sai định dạng: UserError, không gọi service", async () =>
	{
		const { client, contributions } = setup();
		const { interaction } = buttonPress("contrib:abc");

		await assert.rejects(new ContributionCmd(client).executeButton(interaction), userError("Nút không hợp lệ."));
		assert.equal(contributions.toggles.length, 0);
	});

	test("view: active có nút, đã gỡ thì không có nút; không tìm thấy thì UserError", async () =>
	{
		const { client, contributions } = setup();
		contributions.stored.set(7, makeContribution());
		contributions.stored.set(8, makeContribution({ id: 8, status: "removed" }));
		const command = new ContributionCmd(client);

		const active = chatInput("view", { id: 7 });
		await command.execute(active.interaction);
		assert.equal(active.replies[0].flags, MessageFlags.Ephemeral);
		assert.equal(buttonsOf(active.replies[0].components).length, 1);

		const removed = chatInput("view", { id: 8 });
		await command.execute(removed.interaction);
		assert.deepEqual(removed.replies[0].components, []);
		assert.match(field(embedJson(removed.replies[0]), "Trạng thái") ?? "", /Đã bị gỡ/);

		await assert.rejects(command.execute(chatInput("view", { id: 99 }).interaction), userError("Không tìm thấy đóng góp #99."));
	});

	test("list: lọc theo thành viên, tối đa 10, trả lời riêng", async () =>
	{
		const { client, contributions } = setup();
		contributions.stored.set(7, makeContribution());
		const { interaction, replies } = chatInput("list", { "thanh-vien": USER_A });

		await new ContributionCmd(client).execute(interaction);

		assert.deepEqual(contributions.listCalls, [{ guildId: GUILD, authorId: USER_A, limit: 10 }]);
		assert.equal(replies[0].flags, MessageFlags.Ephemeral);
		assert.ok(embedJson(replies[0]).description?.includes("#7 · **Tối ưu thời gian build** · 👍 3"));
	});
});

describe("context menu Ghi nhận đóng góp", () =>
{
	test("tin nhắn của bot bị từ chối", async () =>
	{
		const { client, contributions } = setup();
		const { interaction } = messageMenu({ content: "Tôi là bot", bot: true });

		await assert.rejects(new RecognizeContribution(client).execute(interaction), userError("Không thể ghi nhận tin nhắn của bot."));
		assert.equal(contributions.submitted.length, 0);
	});

	test("điểm thuộc về tác giả tin nhắn, người bấm là người ghi nhận; trả lời công khai rồi lưu vị trí", async () =>
	{
		const { client, contributions } = setup();
		const { interaction, replies } = messageMenu({ content: "Script backup tự động\nChạy mỗi đêm lúc 2h", cachedRoles: [ROLE_BACKEND] });

		await new RecognizeContribution(client).execute(interaction);

		assert.deepEqual(contributions.submitted, [{
			guildId: GUILD,
			authorId: USER_A,
			submittedBy: USER_B,
			title: "Script backup tự động",
			description: "Script backup tự động\nChạy mỗi đêm lúc 2h",
			category: "khac",
			link: `https://discord.com/channels/${GUILD}/${CHANNEL_GENERAL}/${OTHER_MESSAGE_ID}`,
			authorRoleIds: [ROLE_BACKEND],
		}]);
		assert.equal(replies[0].flags, undefined);
		assert.equal(field(embedJson(replies[0]), "Người ghi nhận"), `<@${USER_B}>`);
		assert.deepEqual(contributions.attached, [{ guildId: GUILD, id: 7, channelId: CHANNEL_GENERAL, messageId: MESSAGE_ID }]);
	});

	test("tin nhắn rỗng hoặc quá ngắn dùng tiêu đề và mô tả mặc định; member chưa có trong cache thì lấy qua REST", async () =>
	{
		const { client, contributions } = setup();
		const { interaction } = messageMenu({ content: "", fetchedRoles: [ROLE_FRONTEND] });

		await new RecognizeContribution(client).execute(interaction);

		assert.equal(contributions.submitted[0].title, "Đóng góp từ tin nhắn");
		assert.equal(contributions.submitted[0].description, "(Tin nhắn không có nội dung văn bản)");
		assert.deepEqual(contributions.submitted[0].authorRoleIds, [ROLE_FRONTEND]);
	});

	test("tác giả đã rời server: không có role, vẫn ghi nhận được", async (t) =>
	{
		t.mock.method(console, "log", () => undefined);
		const { client, contributions } = setup();
		const { interaction } = messageMenu({ content: "Hướng dẫn dùng VPN mới" });

		await new RecognizeContribution(client).execute(interaction);

		assert.deepEqual(contributions.submitted[0].authorRoleIds, []);
	});
});

// ---------------------------------------------------------------------------------------------
// Lịch tự đóng vote
// ---------------------------------------------------------------------------------------------

describe("pollScheduler", () =>
{
	function closedPoll(id: number, channelId: string | null, messageId: string | null): Poll
	{
		return makePoll([1, 2], { id, open: false, closedAt: CREATED_AT, closesAt: CREATED_AT, channelId, messageId });
	}

	type FetchChannel = (id: string) => Promise<FakeChannel | null>;

	function schedulerClient(closeDue: () => Poll[], fetch: FetchChannel): DiscordClient
	{
		const client = { services: { polls: { closeDue } }, channels: { fetch } };
		return client as unknown as DiscordClient;
	}

	/** fetch giả theo bảng channel; "throw" = Discord báo lỗi (ví dụ channel đã bị xoá). */
	function fetchFrom(channels: Record<string, FakeChannel | "throw">): FetchChannel
	{
		return id =>
		{
			const channel = channels[id];
			if (channel === "throw") return Promise.reject(new Error("Unknown Channel"));
			return Promise.resolve(channel ?? null);
		};
	}

	test("sửa đúng message của từng vote vừa đóng; lỗi ở một vote không chặn vote khác", async (t) =>
	{
		t.mock.method(console, "log", () => undefined);
		const logged = t.mock.method(console, "error", () => undefined);
		const edits: { messageId: string; payload: Payload }[] = [];
		const notText: FakeChannel = { isTextBased: () => false, messages: { edit: () => Promise.reject(new Error("không được gọi")) } };
		const client = schedulerClient(() => [
			closedPoll(1, CHANNEL_GENERAL, "700000000000000001"),
			closedPoll(2, CHANNEL_GENERAL, "700000000000000002"),
			closedPoll(3, null, null),
			closedPoll(4, "800000000000000404", "700000000000000004"),
			closedPoll(5, CHANNEL_BOT, "700000000000000005"),
			closedPoll(6, CHANNEL_GENERAL, "700000000000000006"),
		], fetchFrom({
			[CHANNEL_GENERAL]: fakeChannel(edits, ["700000000000000002"]),
			[CHANNEL_BOT]: notText,
			"800000000000000404": "throw",
		}));

		assert.equal(await runPollSweep(client), 6);

		assert.deepEqual(edits.map(edit => edit.messageId), ["700000000000000001", "700000000000000006"]);
		for (const edit of edits)
		{
			assert.ok(embedJson(edit.payload).title?.startsWith("🗳️ [Đã đóng]"));
			assert.ok(buttonsOf(edit.payload.components).every(button => button.disabled));
		}
		assert.equal(logged.mock.callCount(), 3);
	});

	test("closeDue lỗi thì chỉ ghi log, trả về 0", async (t) =>
	{
		const logged = t.mock.method(console, "error", () => undefined);
		const client = schedulerClient(() =>
		{
			throw new Error("database is locked");
		}, fetchFrom({}));

		assert.equal(await runPollSweep(client), 0);
		assert.equal(logged.mock.callCount(), 1);
	});

	test("refreshPollMessage bỏ qua vote chưa có message", async () =>
	{
		const client = schedulerClient(() => [], fetchFrom({}));
		assert.equal(await refreshPollMessage(client, closedPoll(1, null, null)), false);
	});

	test("không chạy chồng lượt; dừng lịch thì không chạy thêm", async (t) =>
	{
		t.mock.method(console, "log", () => undefined);
		let release: () => void = () => undefined;
		const gate = new Promise<void>(resolve =>
		{
			release = resolve;
		});
		const edits: { messageId: string; payload: Payload }[] = [];
		const channel = fakeChannel(edits);
		let sweeps = 0;
		const client = schedulerClient(() =>
		{
			sweeps++;
			return [closedPoll(sweeps, CHANNEL_GENERAL, MESSAGE_ID)];
		}, () => gate.then(() => channel));

		const stop = startPollScheduler(client, 5);
		for (let i = 0; i < 100 && sweeps < 1; i++) await delay(5);
		await delay(50);
		assert.equal(sweeps, 1, "lượt đầu còn đang chờ thì không được chạy lượt mới");

		release();
		for (let i = 0; i < 100 && sweeps < 2; i++) await delay(5);
		assert.ok(sweeps >= 2, "lượt đầu xong thì lịch chạy tiếp");

		stop();
		await delay(20);
		const afterStop = sweeps;
		await delay(40);
		assert.equal(sweeps, afterStop);
		assert.ok(edits.length >= 1);
	});
});
