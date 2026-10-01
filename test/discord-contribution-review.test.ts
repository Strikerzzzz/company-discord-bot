import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
	ActionRowBuilder,
	APIEmbed,
	ButtonBuilder,
	ButtonInteraction,
	ButtonStyle,
	ChannelType,
	ChatInputCommandInteraction,
	EmbedBuilder,
	MessageContextMenuCommandInteraction,
	MessageFlags,
	ModalBuilder,
	ModalSubmitInteraction,
	PermissionFlagsBits,
	PermissionsBitField,
} from "discord.js";
import type DiscordClient from "../src/classes/DiscordClient";
import {
	CONTRIBUTION_REASON_INPUT,
	contributionComponentId,
	contributionDetailMessage,
	contributionListLine,
	contributionMessage,
	contributionSubmittedText,
	contributionVotersEmbed,
	downvoteReasonModal,
	parseContributionComponentId,
	rejectReasonModal,
	reviewClosedText,
	voteFeedback,
} from "../src/discord/views/contribution";
import ConfigCmd, { REVIEWER_ROLE_CONFLICT } from "../src/interactions/commands/config";
import ContributionCmd, { REVIEW_DENIED } from "../src/interactions/commands/contribution";
import RecognizeContribution from "../src/interactions/contextMenus/RecognizeContribution";
import { ContributionService } from "../src/modules/contribution/ContributionService";
import { Contribution, ContributionVoter } from "../src/modules/contribution/types";
import { TierRoleService } from "../src/modules/gamification/TierRoleService";
import { DEFAULT_GUILD_SETTINGS, GuildSettings } from "../src/modules/guild-config/types";
import { AppServices } from "../src/services";
import { UserError } from "../src/shared/errors";
import { ADMIN, CHANNEL_GENERAL, createTestContext, GUILD, ROLE_BACKEND, ROLE_FRONTEND, ROLE_OTHER, TestContext, USER_A, USER_B, USER_C } from "./helpers";

// Phase 20 (DEC-051), tầng Discord: thẻ contribution theo trạng thái duyệt, customId, nút ✅/❌/👍/👎 và form lý do, quyền duyệt,
// `/contribution view` theo người xem, tiêu đề context menu khi kênh nguồn riêng tư, `/config contribution`. Luồng nút và form chạy
// qua ContributionService thật trên SQLite :memory: (test tích hợp với code của agent service, LL-011); Discord là đối tượng giả.

const CHANNEL_CONTRIB = "400000000000000004";
const CHANNEL_SOURCE = "400000000000000005";
const CHANNEL_VOICE = "400000000000000006";
const CARD_MESSAGE_ID = "600000000000000004";
const SOURCE_MESSAGE_ID = "600000000000000005";
const BOT_USER = "900000000000000001";
const ROLE_REVIEWER = "500000000000000010";
const USER_D = "300000000000000004";
const OUTSIDER = "300000000000000099";
const BOT_MEMBER = { id: BOT_USER, user: { id: BOT_USER } };
const CARD_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
const CREATED_AT = Date.UTC(2026, 0, 1, 8, 0, 0);
const SECRET_REASON = "Trùng ý tưởng #12 của team khác";
const NO_MENTIONS = { parse: [] };

type Rows = ActionRowBuilder<ButtonBuilder>[];

interface Payload
{
	content?: string;
	embeds?: EmbedBuilder[];
	components?: Rows;
	flags?: number;
	allowedMentions?: { parse?: string[] };
}

interface Recorded
{
	method: string;
	payload?: unknown;
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
		channelId: CHANNEL_CONTRIB,
		messageId: CARD_MESSAGE_ID,
		status: "active",
		createdAt: CREATED_AT,
		votes: 0,
		downvotes: 0,
		score: 0,
		reviewState: "pending",
		reviewedBy: null,
		reviewedAt: null,
		reviewReason: null,
		...overrides,
	};
}

function voter(overrides: Partial<ContributionVoter> = {}): ContributionVoter
{
	return { userId: USER_B, kind: "up", reason: null, active: true, locked: false, createdAt: CREATED_AT, ...overrides };
}

function embedsOf(payload: unknown): APIEmbed[]
{
	const embeds = (payload as Payload | undefined)?.embeds ?? [];
	return embeds.map(embed => embed.toJSON());
}

function field(embed: APIEmbed | undefined, name: string): string | undefined
{
	return embed?.fields?.find(item => item.name === name)?.value;
}

function buttonsOf(payload: unknown): { customId: string; label: string; style: number }[]
{
	const rows = (payload as Payload | undefined)?.components ?? [];
	return rows.flatMap(row => row.components.map(button => button.toJSON())).map(data =>
	{
		assert.ok("custom_id" in data, "nút phải có customId");
		return { customId: data.custom_id, label: data.label ?? "", style: data.style };
	});
}

function json(value: unknown): string
{
	return JSON.stringify(value);
}

function userError(pattern: string | RegExp): (error: unknown) => boolean
{
	return error => error instanceof UserError && (typeof pattern === "string" ? error.message === pattern : pattern.test(error.message));
}

/** Nội dung text của một lời gọi trả lời (reply/followUp/editReply). */
function contentOf(recorded: Recorded | undefined): string
{
	assert.ok(recorded, "thiếu lời gọi trả lời");
	return String((recorded.payload as Payload).content ?? "");
}

// ---------------------------------------------------------------------------------------------
// Hàm thuần: thẻ, danh sách, bản xem riêng, form, phản hồi
// ---------------------------------------------------------------------------------------------

describe("thẻ contribution theo trạng thái duyệt (hàm thuần)", () =>
{
	test("chờ duyệt: ghi ⏳ Chờ duyệt, nút ✅ Duyệt (xanh) và ❌ Từ chối (đỏ), không có nút 👍/👎 hay điểm", () =>
	{
		const payload = contributionMessage(makeContribution());
		const [embed] = embedsOf(payload);
		assert.equal(field(embed, "Trạng thái"), "⏳ Chờ duyệt");
		assert.equal(field(embed, "Điểm"), undefined);
		assert.deepEqual(buttonsOf(payload), [
			{ customId: "contrib:approve:7", label: "✅ Duyệt", style: ButtonStyle.Success },
			{ customId: "contrib:reject:7", label: "❌ Từ chối", style: ButtonStyle.Danger },
		]);
	});

	test("đã duyệt: nút 👍 Ghi nhận (n) giữ customId cũ contrib:<id>, nút 👎 Không ghi nhận (n), hiện điểm, không có trạng thái", () =>
	{
		const payload = contributionMessage(makeContribution({ reviewState: "approved", reviewedBy: USER_C, votes: 1234, downvotes: 2, score: 1232 }));
		const [embed] = embedsOf(payload);
		assert.equal(field(embed, "Trạng thái"), undefined);
		assert.equal(field(embed, "Điểm"), "**1.232** điểm");
		assert.deepEqual(buttonsOf(payload), [
			{ customId: "contrib:7", label: "👍 Ghi nhận (1.234)", style: ButtonStyle.Success },
			{ customId: "contrib:down:7", label: "👎 Không ghi nhận (2)", style: ButtonStyle.Secondary },
		]);
		assert.ok(!json(payload).includes(USER_C), "thẻ công khai không ghi người duyệt");
	});

	test("bị từ chối: ❌ Không được duyệt, không nút, KHÔNG có lý do từ chối ở đâu trên thẻ", () =>
	{
		const payload = contributionMessage(makeContribution({ reviewState: "rejected", reviewedBy: USER_C, reviewedAt: CREATED_AT, reviewReason: SECRET_REASON }));
		assert.equal(field(embedsOf(payload)[0], "Trạng thái"), "❌ Không được duyệt");
		assert.deepEqual(payload.components, []);
		assert.ok(!json(payload).includes("Trùng ý tưởng"), "lý do từ chối không hiện công khai");
	});

	test("đã gỡ (kể cả khi còn chờ duyệt): ⛔ Đã bị gỡ, không nút; màu khác thẻ đã duyệt", () =>
	{
		for (const reviewState of ["pending", "approved", "rejected"] as const)
		{
			const payload = contributionMessage(makeContribution({ status: "removed", reviewState }));
			assert.equal(field(embedsOf(payload)[0], "Trạng thái"), "⛔ Đã bị gỡ", reviewState);
			assert.deepEqual(payload.components, [], reviewState);
		}
		const approved = embedsOf(contributionMessage(makeContribution({ reviewState: "approved" })))[0];
		const pending = embedsOf(contributionMessage(makeContribution()))[0];
		assert.notEqual(approved.color, pending.color);
	});

	test("dòng danh sách hiện trạng thái duyệt; đã duyệt thì 👍/👎", () =>
	{
		assert.match(contributionListLine(makeContribution()), / · ⏳ chờ duyệt · /);
		assert.match(contributionListLine(makeContribution({ reviewState: "rejected", reviewReason: SECRET_REASON })), / · ❌ không được duyệt · /);
		assert.ok(!contributionListLine(makeContribution({ reviewState: "rejected", reviewReason: SECRET_REASON })).includes("Trùng"));
		assert.match(contributionListLine(makeContribution({ status: "removed" })), / · ⛔ đã gỡ · /);
		assert.match(contributionListLine(makeContribution({ reviewState: "approved", votes: 5, downvotes: 2 })), / · 👍 5 · 👎 2 · /);
	});

	test("bản xem riêng: lý do từ chối chỉ khi showReviewReason; người duyệt và danh sách lượt bấm chỉ khi có voters", () =>
	{
		const rejected = makeContribution({ reviewState: "rejected", reviewedBy: USER_C, reviewedAt: CREATED_AT, reviewReason: SECRET_REASON });

		const plain = contributionDetailMessage(rejected);
		assert.equal(plain.embeds.length, 1);
		assert.ok(!json(plain).includes("Trùng ý tưởng") && !json(plain).includes(USER_C));
		assert.ok(plain.components.flatMap(row => row.components).every(button => button.toJSON().style === ButtonStyle.Link), "chỉ có nút link, không có nút thao tác");

		const involved = contributionDetailMessage(rejected, { showReviewReason: true });
		assert.equal(field(embedsOf(involved)[0], "Lý do không duyệt (không hiện công khai)"), SECRET_REASON);
		assert.ok(!json(involved).includes(USER_C), "tác giả không thấy ai từ chối");

		const reviewer = contributionDetailMessage(rejected, { showReviewReason: true, voters: [] });
		assert.equal(field(embedsOf(reviewer)[0], "Người từ chối"), `<@${USER_C}> · <t:${CREATED_AT / 1000}:R>`);
		assert.equal(reviewer.embeds.length, 2);

		const approved = contributionDetailMessage(makeContribution({ reviewState: "approved", reviewedBy: USER_C, reviewedAt: CREATED_AT }), { voters: [voter()] });
		assert.equal(field(embedsOf(approved)[0], "Người duyệt"), `<@${USER_C}> · <t:${CREATED_AT / 1000}:R>`);
		assert.deepEqual(
			(approved.components[0]?.components ?? []).map(button => button.toJSON()).map(button => ("label" in button ? button.label : "")),
			["Mở bài đăng để ghi nhận"],
		);
		assert.deepEqual(
			(contributionDetailMessage(makeContribution()).components[0]?.components ?? []).map(button => button.toJSON()).map(button => ("label" in button ? button.label : "")),
			["Mở bài đăng"],
		);
	});

	test("danh sách lượt bấm: mention người bấm, lý do 👎 (vô hiệu masked link, escape markdown), lượt đã huỷ / khoá, số lượt còn hiệu lực", () =>
	{
		const embed = contributionVotersEmbed([
			voter({ userId: USER_B, kind: "up" }),
			voter({ userId: USER_C, kind: "down", reason: "Xem [đây](https://evil.example) *gấp*" }),
			voter({ userId: ADMIN, kind: "up", active: false, locked: true }),
			voter({ userId: USER_D, kind: "down", reason: "Chưa rõ", locked: true }),
		]).toJSON();
		assert.equal(embed.title, "Lượt bấm: 👍 1 · 👎 2");
		const lines = (embed.description ?? "").split("\n");
		assert.equal(lines[0], `👍 <@${USER_B}> · <t:${CREATED_AT / 1000}:R>`);
		assert.equal(lines[1], `👎 <@${USER_C}> · <t:${CREATED_AT / 1000}:R> · lý do: Xem đây (https://evil.example) \\*gấp\\*`);
		assert.ok(lines[2].endsWith(" · đã huỷ"), lines[2]);
		assert.ok(lines[3].endsWith(" · lý do: Chưa rõ · 🔒 đã khoá"), lines[3]);
		assert.match(embed.footer?.text ?? "", /Chỉ người duyệt và admin/);

		assert.equal(contributionVotersEmbed([]).toJSON().description, "Chưa có ai bấm 👍 hay 👎.");
		const many = contributionVotersEmbed(Array.from({ length: 300 }, (_, index) => voter({
			userId: `3000000000000${String(index).padStart(5, "0")}`,
			kind: "down",
			reason: "x".repeat(200),
		}))).toJSON();
		assert.ok((many.description ?? "").length <= 4096);
		assert.match(many.description ?? "", /… và \d+ lượt khác$/);
	});

	test("form lý do: customId, tiêu đề ≤ 45 ký tự, một ô bắt buộc với độ dài theo DEC-051", () =>
	{
		const reject = rejectReasonModal(1234567890123456).toJSON();
		assert.equal(reject.custom_id, "contrib:rejectform:1234567890123456");
		assert.ok(reject.title.length <= 45, reject.title);
		const down = downvoteReasonModal(7).toJSON();
		assert.equal(down.custom_id, "contrib:downform:7");
		for (const [modal, min, max] of [[reject, 3, 300], [down, 3, 200]] as const)
		{
			const text = json(modal);
			assert.ok(text.includes(`"custom_id":"${CONTRIBUTION_REASON_INPUT}"`), text);
			assert.ok(text.includes(`"min_length":${min}`) && text.includes(`"max_length":${max}`) && text.includes("\"required\":true"), text);
		}
	});

	test("phản hồi riêng cho người bấm: kết quả, XP nhận, XP bị hạn mức cắt, XP thu lại, lượt bị khoá", () =>
	{
		const none = { xpAwarded: 0, xpCapped: false, xpRevoked: 0, locked: false };
		assert.equal(voteFeedback({ ...none, current: "up", change: "added", xpAwarded: 5 }, 25), "✅ Bạn đã ghi nhận đóng góp này.\n+5 XP");
		assert.equal(voteFeedback({ ...none, current: "up", change: "switched" }, 25), "✅ Bạn đã đổi sang ghi nhận đóng góp này.");
		assert.equal(
			voteFeedback({ ...none, current: "down", change: "added", xpAwarded: 3, xpCapped: true }, 25),
			"👎 Bạn đã chọn không ghi nhận đóng góp này. Lý do chỉ người duyệt và admin xem được.\n+3 XP (đã chạm giới hạn 25 XP từ bấm ghi nhận hôm nay)",
		);
		assert.equal(
			voteFeedback({ ...none, current: "down", change: "switched", locked: true }, 25),
			"👎 Bạn đã đổi sang không ghi nhận đóng góp này. Lý do chỉ người duyệt và admin xem được. "
				+ "Vì tác giả đang bị admin trừ điểm, lượt của bạn bị khoá: bạn không đổi hay rút được nữa.",
		);
		assert.equal(
			voteFeedback({ ...none, current: "up", change: "added", xpCapped: true }, 1000),
			"✅ Bạn đã ghi nhận đóng góp này.\nBạn đã nhận đủ 1.000 XP từ bấm ghi nhận hôm nay nên lần này không được cộng XP.",
		);
		assert.equal(voteFeedback({ ...none, current: null, change: "withdrawn", xpRevoked: 5 }, 25),
			"↩️ Bạn đã rút lượt của mình.\nĐã thu lại 5 XP bạn nhận khi bấm cho đóng góp này.");
		assert.equal(voteFeedback({ ...none, current: "down", change: "unchanged" }, 25), "Bạn đang 👎 không ghi nhận đóng góp này rồi.");
		assert.equal(voteFeedback({ ...none, current: null, change: "unchanged" }, 25), "Bạn chưa bấm 👍 hay 👎 cho đóng góp này.");
	});

	test("trả lời người gửi: đã đăng (kèm link, nhắc tin riêng khi có kết quả); đăng thất bại (còn chờ duyệt, báo admin)", () =>
	{
		const own = contributionSubmittedText(makeContribution({ title: "Sửa **lỗi** [x](https://evil.example)" }), CHANNEL_CONTRIB, true);
		assert.ok(own.startsWith(`📨 Đã gửi đóng góp #7 "Sửa \\*\\*lỗi\\*\\* x (https://evil.example)" vào <#${CHANNEL_CONTRIB}>.`), own);
		assert.ok(own.includes("Bot sẽ nhắn riêng cho bạn khi có kết quả duyệt."), own);
		assert.ok(own.endsWith(`https://discord.com/channels/${GUILD}/${CHANNEL_CONTRIB}/${CARD_MESSAGE_ID}`), own);

		const forOther = contributionSubmittedText(makeContribution({ submittedBy: USER_B }), CHANNEL_CONTRIB, true);
		assert.ok(forOther.includes(`Bot sẽ nhắn riêng cho bạn và <@${USER_A}> khi có kết quả duyệt.`), forOther);

		const failed = contributionSubmittedText(makeContribution({ channelId: null, messageId: null }), CHANNEL_CONTRIB, false);
		assert.match(failed, /^⚠️ Đã lưu đóng góp #7 .* không đăng được thẻ vào <#400000000000000004>.*chờ duyệt.*trang web quản trị/);
	});

	test("thẻ đã cũ khi bấm ✅/❌: báo trạng thái hiện tại", () =>
	{
		assert.match(reviewClosedText(makeContribution({ reviewState: "approved" })), /đã được duyệt rồi/);
		assert.match(reviewClosedText(makeContribution({ reviewState: "rejected" })), /đã bị từ chối rồi/);
		assert.match(reviewClosedText(makeContribution({ status: "removed" })), /đã bị gỡ/);
	});
});

describe("customId của thẻ contribution", () =>
{
	test("mã hoá rồi đọc lại đúng cho mọi thao tác; 👍 giữ dạng cũ contrib:<id>", () =>
	{
		for (const action of ["up", "down", "approve", "reject", "downform", "rejectform"] as const)
		{
			for (const contributionId of [1, 7, 9007199254740991])
			{
				const id = contributionComponentId(action, contributionId);
				assert.ok(id.length <= 100, id);
				assert.deepEqual(parseContributionComponentId(id), { action, contributionId }, id);
			}
		}
		assert.equal(contributionComponentId("up", 7), "contrib:7");
		assert.equal(contributionComponentId("down", 7), "contrib:down:7");
	});

	test("sai định dạng thì UserError (không tin dữ liệu từ client)", () =>
	{
		for (const customId of [
			"contrib:up:7", "contrib:approve", "contrib:approve:", "contrib:approve:0", "contrib:approve:-1", "contrib:approve:1:2",
			"contrib:APPROVE:1", "contrib:down:abc", "contrib:reject:01", "contrib:downform:9999999999999999", "contrib::7", "xcontrib:down:7",
			"contrib:remove:7", " contrib:down:7",
		])
		{
			assert.throws(() => parseContributionComponentId(customId), userError("Nút không hợp lệ."), customId);
		}
	});
});

// ---------------------------------------------------------------------------------------------
// Luồng nút và form qua ContributionService thật
// ---------------------------------------------------------------------------------------------

interface Actor
{
	userId?: string;
	roleIds?: string[];
	manageGuild?: boolean;
}

interface Harness
{
	context: TestContext;
	contributions: ContributionService;
	command: ContributionCmd;
	client: DiscordClient;
	/** Thẻ contributionOps yêu cầu sửa (reviewActions.refreshContribution). */
	refreshed: Contribution[];
	/** Tin nhắn riêng bot gửi (reviewActions.sendDirectMessage). */
	dms: { userId: string; content: string }[];
	/** Các lần sửa message trong kênh contribution qua client.channels (refreshContributionMessage). */
	edits: { messageId: string; payload: unknown }[];
	/** Các thẻ bot đăng vào kênh contribution. */
	sent: unknown[];
}

function createHarness(settings: Partial<GuildSettings> = {}): Harness
{
	const context = createTestContext();
	context.deps.guildConfig.updateSettings(GUILD, { contributionChannelId: CHANNEL_CONTRIB, contributionReviewerRoleIds: [ROLE_REVIEWER], ...settings }, ADMIN);
	const contributions = new ContributionService(context.db, context.deps);
	const services = { guildConfig: context.deps.guildConfig, contributions } as unknown as AppServices;
	const refreshed: Contribution[] = [];
	const dms: { userId: string; content: string }[] = [];
	const edits: { messageId: string; payload: unknown }[] = [];
	const sent: unknown[] = [];
	const contribChannel = {
		id: CHANNEL_CONTRIB,
		guildId: GUILD,
		type: ChannelType.GuildText,
		guild: { members: { me: BOT_MEMBER } },
		isDMBased: () => false,
		isTextBased: () => true,
		permissionsFor: (subject: unknown) => new PermissionsBitField(subject === BOT_MEMBER ? CARD_PERMISSIONS : [PermissionFlagsBits.ViewChannel]),
		send: (payload: unknown) =>
		{
			sent.push(payload);
			return Promise.resolve({ id: CARD_MESSAGE_ID, channelId: CHANNEL_CONTRIB });
		},
		messages: {
			edit: (messageId: string, payload: unknown) =>
			{
				edits.push({ messageId, payload });
				return Promise.resolve();
			},
		},
	};
	const client = {
		services,
		user: { id: BOT_USER },
		guilds: { cache: new Map([[GUILD, { name: "Công ty ABC" }]]) },
		channels: { fetch: (channelId: string) => Promise.resolve(channelId === CHANNEL_CONTRIB ? contribChannel : null) },
	} as unknown as DiscordClient;
	const command = new ContributionCmd(client);
	command.reviewActions = {
		refreshContribution: (_client, contribution) =>
		{
			refreshed.push(contribution);
			return Promise.resolve(true);
		},
		sendDirectMessage: (_client, userId, content) =>
		{
			dms.push({ userId, content });
			return Promise.resolve(true);
		},
	};
	return { context, contributions, command, client, refreshed, dms, edits, sent };
}

/** Contribution chờ duyệt của `authorId` (gửi bởi `submittedBy`), đã có thẻ trong kênh contribution. */
function submitPending(harness: Harness, authorId = USER_A, submittedBy = authorId): Contribution
{
	const created = harness.contributions.submit({
		guildId: GUILD,
		authorId,
		submittedBy,
		title: "Tối ưu thời gian build",
		description: "Giảm thời gian build CI.",
		category: "cai-tien",
		link: null,
		authorRoleIds: [],
	});
	harness.contributions.attachMessage(GUILD, created.id, CHANNEL_CONTRIB, CARD_MESSAGE_ID);
	return current(harness, created.id);
}

function submitApproved(harness: Harness, authorId = USER_A): Contribution
{
	return harness.contributions.approve(GUILD, submitPending(harness, authorId).id, ADMIN);
}

function current(harness: Harness, contributionId: number): Contribution
{
	const contribution = harness.contributions.get(GUILD, contributionId);
	assert.ok(contribution, `không có contribution #${contributionId}`);
	return contribution;
}

/** Nút hoặc form giả trên thẻ contribution: ghi lại mọi lời gọi trả lời theo thứ tự. */
function component(kind: "button" | "modal", customId: string, actor: Actor = {}, options: { reason?: string; fromMessage?: boolean } = {})
{
	const calls: Recorded[] = [];
	const record = (method: string, payload?: unknown): Promise<void> =>
	{
		calls.push({ method, payload });
		return Promise.resolve();
	};
	const interaction = {
		customId,
		guildId: GUILD,
		user: { id: actor.userId ?? USER_B },
		member: { roles: actor.roleIds ?? [] },
		memberPermissions: new PermissionsBitField(actor.manageGuild ? [PermissionFlagsBits.ManageGuild] : []),
		message: { id: CARD_MESSAGE_ID },
		inGuild: () => true,
		isButton: () => kind === "button",
		isFromMessage: () => options.fromMessage ?? true,
		fields: {
			getTextInputValue: (key: string) =>
			{
				if (key !== CONTRIBUTION_REASON_INPUT || options.reason === undefined) throw new Error(`Form thiếu ô "${key}"`);
				return options.reason;
			},
		},
		update: (payload: unknown) => record("update", payload),
		followUp: (payload: unknown) => record("followUp", payload),
		reply: (payload: unknown) => record("reply", payload),
		showModal: (payload: unknown) => record("showModal", payload),
		deferReply: (payload: unknown) => record("deferReply", payload),
		editReply: (payload: unknown) => record("editReply", payload),
	};
	return { interaction, calls };
}

async function press(harness: Harness, customId: string, actor: Actor = {}): Promise<Recorded[]>
{
	const { interaction, calls } = component("button", customId, actor);
	await harness.command.executeButton(interaction as unknown as ButtonInteraction);
	return calls;
}

async function submitForm(harness: Harness, customId: string, reason: string, actor: Actor = {}, fromMessage = true): Promise<Recorded[]>
{
	const { interaction, calls } = component("modal", customId, actor, { reason, fromMessage });
	await harness.command.executeModal(interaction as unknown as ModalSubmitInteraction);
	return calls;
}

function methods(calls: readonly Recorded[]): string[]
{
	return calls.map(call => call.method);
}

const REVIEWER: Actor = { userId: USER_C, roleIds: [ROLE_REVIEWER] };

describe("duyệt và từ chối qua nút trên thẻ (DEC-051)", () =>
{
	test("người không có quyền duyệt bấm ✅/❌ hoặc gửi form từ chối: báo riêng, không đổi gì, không nhắn ai", async () =>
	{
		const harness = createHarness();
		const contribution = submitPending(harness);
		for (const actor of [{ userId: USER_B }, { userId: USER_B, roleIds: [ROLE_OTHER] }, { userId: USER_A }])
		{
			await assert.rejects(press(harness, `contrib:approve:${contribution.id}`, actor), userError(REVIEW_DENIED));
			await assert.rejects(press(harness, `contrib:reject:${contribution.id}`, actor), userError(REVIEW_DENIED));
			await assert.rejects(submitForm(harness, `contrib:rejectform:${contribution.id}`, "Không phù hợp", actor), userError(REVIEW_DENIED));
		}
		assert.equal(current(harness, contribution.id).reviewState, "pending");
		assert.deepEqual(harness.dms, []);
		assert.deepEqual(harness.context.deps.audit.list(GUILD, 10).filter(entry => entry.action.startsWith("contribution.")), []);
	});

	test("role duyệt bấm ✅: defer riêng, duyệt, sửa thẻ (mở 👍/👎), nhắn riêng tác giả, báo kết quả không ping ai; audit ghi người duyệt", async () =>
	{
		const harness = createHarness();
		const contribution = submitPending(harness);
		const calls = await press(harness, `contrib:approve:${contribution.id}`, REVIEWER);

		assert.deepEqual(methods(calls), ["deferReply", "editReply"]);
		assert.deepEqual(calls[0].payload, { flags: MessageFlags.Ephemeral });
		assert.match(contentOf(calls[1]), /^✅ Đã duyệt đóng góp #\d+/);
		assert.deepEqual((calls[1].payload as Payload).allowedMentions, NO_MENTIONS);
		assert.equal(current(harness, contribution.id).reviewState, "approved");
		assert.equal(harness.refreshed.length, 1);
		assert.deepEqual(buttonsOf(contributionMessage(harness.refreshed[0])).map(button => button.customId), [`contrib:${contribution.id}`, `contrib:down:${contribution.id}`]);
		assert.deepEqual(harness.dms.map(dm => dm.userId), [USER_A]);
		assert.match(harness.dms[0].content, /đã được duyệt/);
		const audit = harness.context.deps.audit.list(GUILD, 1)[0];
		assert.equal(audit?.action, "contribution.approve");
		assert.equal(audit?.actorId, USER_C);
	});

	test("admin (Manage Server) duyệt được cả bài của chính mình; tác giả và người gửi khác nhau thì cả hai nhận tin riêng", async () =>
	{
		const harness = createHarness();
		const own = submitPending(harness, ADMIN);
		await press(harness, `contrib:approve:${own.id}`, { userId: ADMIN, manageGuild: true });
		assert.equal(current(harness, own.id).reviewState, "approved");

		const recognized = submitPending(harness, USER_A, USER_B);
		await press(harness, `contrib:approve:${recognized.id}`, { userId: ADMIN, manageGuild: true });
		assert.deepEqual(harness.dms.slice(1).map(dm => dm.userId).sort(), [USER_A, USER_B].sort());
	});

	test("thẻ đã cũ (đã được duyệt hoặc bị gỡ ở nơi khác): vẽ lại thẻ theo trạng thái hiện tại và báo riêng, không duyệt lần nữa", async () =>
	{
		const harness = createHarness();
		const contribution = submitApproved(harness);
		const calls = await press(harness, `contrib:approve:${contribution.id}`, REVIEWER);
		assert.deepEqual(methods(calls), ["update", "followUp"]);
		assert.deepEqual(buttonsOf(calls[0].payload).map(button => button.customId), [`contrib:${contribution.id}`, `contrib:down:${contribution.id}`]);
		assert.match(contentOf(calls[1]), /đã được duyệt rồi/);
		assert.equal((calls[1].payload as Payload).flags, MessageFlags.Ephemeral);

		harness.contributions.remove(GUILD, contribution.id, ADMIN);
		const removed = await press(harness, `contrib:reject:${contribution.id}`, REVIEWER);
		assert.deepEqual(methods(removed), ["update", "followUp"]);
		assert.match(contentOf(removed[1]), /đã bị gỡ/);
		assert.deepEqual(harness.dms, []);
		assert.equal(harness.context.deps.audit.list(GUILD, 10).filter(entry => entry.action === "contribution.approve").length, 1);
	});

	test("❌ Từ chối: mở form lý do; gửi form thì từ chối, lý do chỉ có trong tin riêng cho tác giả và audit, không có trên thẻ hay phản hồi", async () =>
	{
		const harness = createHarness();
		const contribution = submitPending(harness);
		const opened = await press(harness, `contrib:reject:${contribution.id}`, REVIEWER);
		assert.deepEqual(methods(opened), ["showModal"]);
		assert.deepEqual((opened[0].payload as ModalBuilder).toJSON(), rejectReasonModal(contribution.id).toJSON());

		const calls = await submitForm(harness, `contrib:rejectform:${contribution.id}`, `  ${SECRET_REASON}  `, REVIEWER);
		assert.deepEqual(methods(calls), ["deferReply", "editReply"]);
		const rejected = current(harness, contribution.id);
		assert.equal(rejected.reviewState, "rejected");
		assert.equal(rejected.reviewReason, SECRET_REASON);
		assert.ok(!contentOf(calls[1]).includes("Trùng ý tưởng"), "phản hồi cho người duyệt không lặp lại lý do");
		assert.ok(!json(contributionMessage(harness.refreshed[0])).includes("Trùng ý tưởng"), "thẻ công khai không có lý do");
		assert.deepEqual(harness.dms.map(dm => dm.userId), [USER_A]);
		assert.ok(harness.dms[0].content.includes(SECRET_REASON), harness.dms[0].content);
		assert.deepEqual(harness.context.deps.audit.list(GUILD, 1)[0]?.details, { contributionId: contribution.id, title: contribution.title, reason: SECRET_REASON });
	});

	test("form từ chối: lý do quá ngắn, hoặc contribution vừa được duyệt trong lúc form mở: báo lỗi, không đổi, không nhắn ai", async () =>
	{
		const harness = createHarness();
		const contribution = submitPending(harness);
		await assert.rejects(submitForm(harness, `contrib:rejectform:${contribution.id}`, "ok", REVIEWER), userError(/Lý do từ chối phải từ 3 đến 300 ký tự/));
		assert.equal(current(harness, contribution.id).reviewState, "pending");

		harness.contributions.approve(GUILD, contribution.id, ADMIN);
		await assert.rejects(submitForm(harness, `contrib:rejectform:${contribution.id}`, SECRET_REASON, REVIEWER), userError(/đã được duyệt/));
		assert.equal(current(harness, contribution.id).reviewState, "approved");
		assert.deepEqual(harness.dms, []);
	});

	test("người duyệt mất role trong lúc form từ chối đang mở: form bị từ chối", async () =>
	{
		const harness = createHarness();
		const contribution = submitPending(harness);
		await press(harness, `contrib:reject:${contribution.id}`, REVIEWER);
		harness.context.deps.guildConfig.updateSettings(GUILD, { contributionReviewerRoleIds: [] }, ADMIN);
		await assert.rejects(submitForm(harness, `contrib:rejectform:${contribution.id}`, SECRET_REASON, REVIEWER), userError(REVIEW_DENIED));
		assert.equal(current(harness, contribution.id).reviewState, "pending");
	});
});

describe("👍 Ghi nhận / 👎 Không ghi nhận qua nút và form (DEC-051)", () =>
{
	test("thẻ chờ duyệt, tác giả tự bấm: service từ chối, thẻ không đổi", async () =>
	{
		const harness = createHarness();
		const waiting = submitPending(harness);
		await assert.rejects(press(harness, `contrib:${waiting.id}`), userError(/đang chờ duyệt/));
		await assert.rejects(press(harness, `contrib:down:${waiting.id}`), userError(/đang chờ duyệt/));

		const open = submitApproved(harness);
		await assert.rejects(press(harness, `contrib:${open.id}`, { userId: USER_A }), userError(/chính mình/));
		await assert.rejects(press(harness, `contrib:down:${open.id}`, { userId: USER_A }), userError(/chính mình/));
		assert.deepEqual(harness.contributions.listVoters(GUILD, open.id), []);
	});

	test("👍 rồi bấm lại: ghi nhận (+XP cho người bấm, actor là bot) rồi rút (thu lại XP); thẻ cập nhật số lượt; không nhắn tác giả", async () =>
	{
		const harness = createHarness();
		const contribution = submitApproved(harness);
		const first = await press(harness, `contrib:${contribution.id}`, { userId: USER_B, roleIds: [ROLE_BACKEND] });
		assert.deepEqual(methods(first), ["update", "followUp"]);
		assert.equal(buttonsOf(first[0].payload)[0].label, "👍 Ghi nhận (1)");
		assert.deepEqual(first[1].payload, { content: "✅ Bạn đã ghi nhận đóng góp này.\n+5 XP", flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS });
		assert.equal(harness.context.deps.xpLedger.total(GUILD, USER_B), 5);
		const actors = harness.context.db.prepare<[string], { actor_id: string | null }>("SELECT actor_id FROM xp_events WHERE user_id = ?").all(USER_B);
		assert.deepEqual(actors, [{ actor_id: BOT_USER }]);

		const second = await press(harness, `contrib:${contribution.id}`, { userId: USER_B });
		assert.equal(buttonsOf(second[0].payload)[0].label, "👍 Ghi nhận (0)");
		assert.equal(contentOf(second[1]), "↩️ Bạn đã rút lượt của mình.\nĐã thu lại 5 XP bạn nhận khi bấm cho đóng góp này.");
		assert.equal(harness.context.deps.xpLedger.total(GUILD, USER_B), 0);
		assert.deepEqual(harness.dms, [], "không nhắn tác giả theo từng lượt");
	});

	test("👎: mở form lý do (chưa ghi gì); gửi form thì ghi 👎 kèm lý do, thẻ chỉ hiện số lượt; bấm 👎 lần nữa thì rút, không mở form", async () =>
	{
		const harness = createHarness();
		const contribution = submitApproved(harness);
		const opened = await press(harness, `contrib:down:${contribution.id}`, { userId: USER_B });
		assert.deepEqual(methods(opened), ["showModal"]);
		assert.deepEqual((opened[0].payload as ModalBuilder).toJSON(), downvoteReasonModal(contribution.id).toJSON());
		assert.deepEqual(harness.contributions.listVoters(GUILD, contribution.id), []);

		const voted = await submitForm(harness, `contrib:downform:${contribution.id}`, SECRET_REASON, { userId: USER_B });
		assert.deepEqual(methods(voted), ["update", "followUp"]);
		assert.equal(buttonsOf(voted[0].payload)[1].label, "👎 Không ghi nhận (1)");
		assert.ok(!json(voted[0].payload).includes("Trùng ý tưởng") && !json(voted[0].payload).includes(USER_B), "thẻ không lộ lý do hay người bấm");
		assert.equal(
			contentOf(voted[1]),
			"👎 Bạn đã chọn không ghi nhận đóng góp này. Lý do chỉ người duyệt và admin xem được.\n+5 XP",
		);
		assert.deepEqual(harness.contributions.listVoters(GUILD, contribution.id).map(entry => [entry.userId, entry.kind, entry.reason]), [[USER_B, "down", SECRET_REASON]]);

		const withdrawn = await press(harness, `contrib:down:${contribution.id}`, { userId: USER_B });
		assert.deepEqual(methods(withdrawn), ["update", "followUp"]);
		assert.equal(buttonsOf(withdrawn[0].payload)[1].label, "👎 Không ghi nhận (0)");
		assert.match(contentOf(withdrawn[1]), /^↩️ Bạn đã rút lượt của mình\./);
		assert.deepEqual(harness.dms, []);
	});

	test("đổi 👎 → 👍 và 👍 → 👎 giữ XP (không cộng thêm, không thu lại)", async () =>
	{
		const harness = createHarness();
		const contribution = submitApproved(harness);
		await submitForm(harness, `contrib:downform:${contribution.id}`, "Chưa đủ chi tiết", { userId: USER_B });
		const toUp = await press(harness, `contrib:${contribution.id}`, { userId: USER_B });
		assert.equal(contentOf(toUp[1]), "✅ Bạn đã đổi sang ghi nhận đóng góp này.");
		const toDown = await submitForm(harness, `contrib:downform:${contribution.id}`, "Chưa đủ chi tiết", { userId: USER_B });
		assert.equal(contentOf(toDown[1]), "👎 Bạn đã đổi sang không ghi nhận đóng góp này. Lý do chỉ người duyệt và admin xem được.");
		assert.equal(harness.context.deps.xpLedger.total(GUILD, USER_B), 5);
	});

	test("form 👎: lý do quá ngắn hoặc contribution bị gỡ trong lúc form mở: báo lỗi, không ghi lượt", async () =>
	{
		const harness = createHarness();
		const contribution = submitApproved(harness);
		await assert.rejects(submitForm(harness, `contrib:downform:${contribution.id}`, "no", { userId: USER_B }), userError(/Lý do không ghi nhận phải từ 3 đến 200 ký tự/));
		harness.contributions.remove(GUILD, contribution.id, ADMIN);
		await assert.rejects(submitForm(harness, `contrib:downform:${contribution.id}`, SECRET_REASON, { userId: USER_B }), userError(/đã bị gỡ/));
		assert.deepEqual(harness.contributions.listVoters(GUILD, contribution.id), []);
	});

	test("hạn mức XP mỗi ngày từ contribution: phần bị cắt nói rõ trong phản hồi", async () =>
	{
		const harness = createHarness({ contributionInteractionXp: 5, contributionInteractionXpDailyCap: 7 });
		const first = submitApproved(harness);
		const second = submitApproved(harness);
		const third = submitApproved(harness);
		assert.equal(contentOf((await press(harness, `contrib:${first.id}`))[1]), "✅ Bạn đã ghi nhận đóng góp này.\n+5 XP");
		assert.equal(
			contentOf((await press(harness, `contrib:${second.id}`))[1]),
			"✅ Bạn đã ghi nhận đóng góp này.\n+2 XP (đã chạm giới hạn 7 XP từ bấm ghi nhận hôm nay)",
		);
		assert.equal(
			contentOf((await press(harness, `contrib:${third.id}`))[1]),
			"✅ Bạn đã ghi nhận đóng góp này.\nBạn đã nhận đủ 7 XP từ bấm ghi nhận hôm nay nên lần này không được cộng XP.",
		);
	});

	test("form 👎 không gắn với thẻ (hiếm): trả lời riêng rồi sửa thẻ qua vị trí đã lưu", async () =>
	{
		const harness = createHarness();
		const contribution = submitApproved(harness);
		const calls = await submitForm(harness, `contrib:downform:${contribution.id}`, SECRET_REASON, { userId: USER_B }, false);
		assert.deepEqual(methods(calls), ["reply"]);
		assert.equal((calls[0].payload as Payload).flags, MessageFlags.Ephemeral);
		assert.equal(harness.edits.length, 1);
		assert.equal(harness.edits[0].messageId, CARD_MESSAGE_ID);
		assert.equal(buttonsOf(harness.edits[0].payload)[1].label, "👎 Không ghi nhận (1)");
	});

	test("thẻ cũ trước DEC-051 (chỉ có nút contrib:<id>) vẫn ghi nhận được", async () =>
	{
		const harness = createHarness();
		const contribution = submitApproved(harness);
		const calls = await press(harness, contributionComponentId("up", contribution.id));
		assert.deepEqual(methods(calls), ["update", "followUp"]);
		assert.equal(current(harness, contribution.id).votes, 1);
	});
});

// ---------------------------------------------------------------------------------------------
// /contribution view theo người xem
// ---------------------------------------------------------------------------------------------

function viewCommand(contributionId: number, actor: Actor = {})
{
	const calls: Recorded[] = [];
	const interaction = {
		guildId: GUILD,
		user: { id: actor.userId ?? USER_B },
		member: { roles: actor.roleIds ?? [] },
		memberPermissions: new PermissionsBitField(actor.manageGuild ? [PermissionFlagsBits.ManageGuild] : []),
		inGuild: () => true,
		options: {
			getSubcommand: () => "view",
			getInteger: (name: string) => (name === "id" ? contributionId : null),
		},
		deferReply: (payload: unknown) =>
		{
			calls.push({ method: "deferReply", payload });
			return Promise.resolve();
		},
		editReply: (payload: unknown) =>
		{
			calls.push({ method: "editReply", payload });
			return Promise.resolve();
		},
	};
	return { interaction: interaction as unknown as ChatInputCommandInteraction, calls };
}

async function view(harness: Harness, contributionId: number, actor: Actor = {}): Promise<Payload>
{
	const { interaction, calls } = viewCommand(contributionId, actor);
	await harness.command.execute(interaction);
	assert.deepEqual(methods(calls), ["deferReply", "editReply"]);
	const payload = calls[1].payload as Payload;
	assert.deepEqual(payload.allowedMentions, NO_MENTIONS, "không ping người bấm hay người duyệt");
	return payload;
}

describe("/contribution view theo người xem (DEC-051)", () =>
{
	test("người duyệt và admin thấy người duyệt, danh sách 👍/👎 kèm tên và lý do; thành viên khác chỉ thấy số lượt", async () =>
	{
		const harness = createHarness();
		const contribution = submitApproved(harness);
		await press(harness, `contrib:${contribution.id}`, { userId: USER_B });
		await submitForm(harness, `contrib:downform:${contribution.id}`, SECRET_REASON, { userId: USER_D });

		for (const actor of [REVIEWER, { userId: ADMIN, manageGuild: true }])
		{
			const payload = await view(harness, contribution.id, actor);
			const [card, voters] = embedsOf(payload);
			assert.equal(field(card, "Người duyệt"), `<@${ADMIN}> · <t:${Math.floor((contribution.reviewedAt ?? 0) / 1000)}:R>`);
			assert.equal(voters?.title, "Lượt bấm: 👍 1 · 👎 1");
			assert.ok((voters?.description ?? "").includes(`👍 <@${USER_B}>`));
			assert.ok((voters?.description ?? "").includes(`👎 <@${USER_D}>`) && (voters?.description ?? "").includes(SECRET_REASON));
		}

		for (const actor of [{ userId: USER_C }, { userId: USER_A }])
		{
			const payload = await view(harness, contribution.id, actor);
			assert.equal(embedsOf(payload).length, 1);
			assert.ok(!json(payload).includes(SECRET_REASON) && !json(payload).includes(USER_B) && !json(payload).includes(USER_D));
		}
	});

	test("bài bị từ chối: tác giả và người gửi thấy lý do; người duyệt thấy lý do; người khác không thấy", async () =>
	{
		const harness = createHarness();
		const contribution = submitPending(harness, USER_A, USER_B);
		harness.contributions.reject(GUILD, contribution.id, ADMIN, SECRET_REASON);
		for (const actor of [{ userId: USER_A }, { userId: USER_B }, REVIEWER])
		{
			const payload = await view(harness, contribution.id, actor);
			assert.equal(field(embedsOf(payload)[0], "Lý do không duyệt (không hiện công khai)"), SECRET_REASON, actor.userId);
		}
		const outsider = await view(harness, contribution.id, { userId: OUTSIDER });
		assert.ok(!json(outsider).includes("Trùng ý tưởng"));
		assert.equal(field(embedsOf(outsider)[0], "Trạng thái"), "❌ Không được duyệt");
	});
});

// ---------------------------------------------------------------------------------------------
// /contribution submit và context menu qua service thật
// ---------------------------------------------------------------------------------------------

describe("gửi contribution qua service thật (DEC-051)", () =>
{
	test("/contribution submit: bản ghi chờ duyệt, thẻ ⏳ đăng ở kênh contribution kèm nút ✅/❌, vị trí thẻ được lưu", async () =>
	{
		const harness = createHarness();
		const calls: Recorded[] = [];
		const values: Record<string, string> = { "tieu-de": "Tài liệu onboarding", "noi-dung": "Hướng dẫn cho người mới", loai: "tai-lieu" };
		const interaction = {
			guildId: GUILD,
			user: { id: USER_A },
			member: { roles: [] },
			inGuild: () => true,
			options: {
				getSubcommand: () => "submit",
				getString: (name: string) => values[name] ?? null,
			},
			deferReply: (payload: unknown) =>
			{
				calls.push({ method: "deferReply", payload });
				return Promise.resolve();
			},
			editReply: (payload: unknown) =>
			{
				calls.push({ method: "editReply", payload });
				return Promise.resolve();
			},
		};
		await harness.command.execute(interaction as unknown as ChatInputCommandInteraction);

		const [created] = harness.contributions.list(GUILD, { limit: 10 });
		assert.ok(created);
		assert.equal(created.reviewState, "pending");
		assert.equal(created.channelId, CHANNEL_CONTRIB);
		assert.equal(created.messageId, CARD_MESSAGE_ID);
		assert.equal(harness.sent.length, 1);
		assert.equal(field(embedsOf(harness.sent[0])[0], "Trạng thái"), "⏳ Chờ duyệt");
		assert.match(contentOf(calls[1]), /chờ duyệt/);
	});

	function contextMenu(everyoneCanView: boolean)
	{
		const everyone = { id: GUILD };
		const calls: Recorded[] = [];
		const interaction = {
			guildId: GUILD,
			user: { id: USER_B },
			member: { roles: [] },
			inGuild: () => true,
			isMessageContextMenuCommand: () => true,
			channel: {
				id: CHANNEL_SOURCE,
				name: "ban-giam-doc",
				type: ChannelType.GuildText,
				isDMBased: () => false,
				permissionsFor: (subject: unknown) => new PermissionsBitField(subject === everyone && everyoneCanView ? [PermissionFlagsBits.ViewChannel] : []),
			},
			targetMessage: { id: SOURCE_MESSAGE_ID, channelId: CHANNEL_SOURCE, author: { id: USER_A, bot: false }, system: false },
			guild: { roles: { everyone }, members: { fetch: () => Promise.resolve({ roles: [] }) } },
			deferReply: (payload: unknown) =>
			{
				calls.push({ method: "deferReply", payload });
				return Promise.resolve();
			},
			editReply: (payload: unknown) =>
			{
				calls.push({ method: "editReply", payload });
				return Promise.resolve();
			},
		};
		return { interaction: interaction as unknown as MessageContextMenuCommandInteraction, calls };
	}

	test("context menu ở kênh @everyone không xem được: tiêu đề chung (không lộ tên kênh) trên thẻ công khai; link tới tin gốc vẫn giữ", async () =>
	{
		const harness = createHarness();
		const { interaction, calls } = contextMenu(false);
		await new RecognizeContribution(harness.client).execute(interaction);

		const [created] = harness.contributions.list(GUILD, { limit: 10 });
		assert.ok(created);
		assert.equal(created.title, "Đóng góp từ tin nhắn");
		assert.equal(created.link, `https://discord.com/channels/${GUILD}/${CHANNEL_SOURCE}/${SOURCE_MESSAGE_ID}`);
		assert.equal(created.reviewState, "pending");
		assert.ok(!json(harness.sent).includes("ban-giam-doc"));
		assert.deepEqual(calls[0].payload, { flags: MessageFlags.Ephemeral });
	});

	test("context menu ở kênh công khai: tiêu đề nêu tên kênh", async () =>
	{
		const harness = createHarness();
		await new RecognizeContribution(harness.client).execute(contextMenu(true).interaction);
		assert.equal(harness.contributions.list(GUILD, { limit: 10 })[0]?.title, "Đóng góp từ tin nhắn trong #ban-giam-doc");
	});
});

// ---------------------------------------------------------------------------------------------
// /config contribution
// ---------------------------------------------------------------------------------------------

interface ConfigHarness
{
	context: TestContext;
	config: ConfigCmd;
}

const CALLER = { id: ADMIN, user: { id: ADMIN } };
const CALLER_CHANNEL_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];

function guildChannel(id: string, type: ChannelType, caller: bigint[], bot: bigint[]): object
{
	return { id, type, permissionsFor: (member: unknown) => new PermissionsBitField(member === BOT_MEMBER ? bot : caller) };
}

function createConfigHarness(): ConfigHarness
{
	const context = createTestContext();
	const tierRoles = new TierRoleService(context.db, context.clock, context.deps.audit);
	const services = {
		guildConfig: context.deps.guildConfig,
		tierRoles,
		tierSets: context.deps.tierSets,
		audit: context.deps.audit,
	} as unknown as AppServices;
	return { context, config: new ConfigCmd({ services } as unknown as DiscordClient) };
}

const CONFIG_CHANNELS = new Map<string, object>([
	[CHANNEL_CONTRIB, guildChannel(CHANNEL_CONTRIB, ChannelType.GuildText, CALLER_CHANNEL_PERMISSIONS, CARD_PERMISSIONS)],
	[CHANNEL_GENERAL, guildChannel(CHANNEL_GENERAL, ChannelType.GuildText, [PermissionFlagsBits.ViewChannel], CARD_PERMISSIONS)],
	[CHANNEL_SOURCE, guildChannel(CHANNEL_SOURCE, ChannelType.GuildText, CALLER_CHANNEL_PERMISSIONS, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])],
	[CHANNEL_VOICE, guildChannel(CHANNEL_VOICE, ChannelType.GuildVoice, CALLER_CHANNEL_PERMISSIONS, CARD_PERMISSIONS)],
]);

async function configContribution(harness: ConfigHarness, options: Record<string, unknown>): Promise<string>
{
	const replies: Payload[] = [];
	const get = (name: string): unknown => (Object.hasOwn(options, name) ? options[name] : null);
	const interaction = {
		guildId: GUILD,
		user: { id: ADMIN },
		member: CALLER,
		guild: { id: GUILD, channels: { cache: CONFIG_CHANNELS }, members: { me: BOT_MEMBER } },
		inGuild: () => true,
		inCachedGuild: () => true,
		options: {
			getSubcommandGroup: () => null,
			getSubcommand: () => "contribution",
			getInteger: get,
			getBoolean: get,
			getRole: get,
			getChannel: get,
		},
		reply: (payload: Payload) =>
		{
			replies.push(payload);
			return Promise.resolve();
		},
	};
	await harness.config.execute(interaction as unknown as ChatInputCommandInteraction);
	assert.equal(replies.length, 1);
	assert.equal(replies[0].flags, MessageFlags.Ephemeral);
	return replies[0].content ?? "";
}

const role = (id: string, managed = false): { id: string; managed: boolean } => ({ id, managed });
const channel = (id: string): { id: string } => ({ id });

describe("/config contribution (DEC-051)", () =>
{
	test("kenh: người gọi và bot đủ quyền thì lưu, có audit; diem-moi-luot không còn bắt buộc", async () =>
	{
		const harness = createConfigHarness();
		const text = await configContribution(harness, { kenh: channel(CHANNEL_CONTRIB) });
		assert.equal(text, `Đã cập nhật cấu hình contribution:\n• Kênh contribution: **<#${CHANNEL_CONTRIB}>**`);
		assert.equal(harness.context.deps.guildConfig.getSettings(GUILD).contributionChannelId, CHANNEL_CONTRIB);
		assert.deepEqual(harness.context.deps.audit.list(GUILD, 1)[0]?.details, { contributionChannelId: CHANNEL_CONTRIB });
	});

	test("kenh bị từ chối (người gọi không gửi được tin, bot thiếu Embed Links, kênh voice): báo rõ, không lưu gì kể cả số đi kèm", async () =>
	{
		const harness = createConfigHarness();
		const cases: [string, RegExp][] = [
			[CHANNEL_GENERAL, /Bạn không có quyền \*\*Send Messages\*\* ở <#400000000000000001>, nên không thể chọn kênh đó làm kênh contribution/],
			[CHANNEL_SOURCE, /Bot thiếu quyền \*\*Embed Links\*\* ở <#400000000000000005>/],
			[CHANNEL_VOICE, /Kênh contribution phải là kênh văn bản hoặc kênh thông báo/],
		];
		for (const [channelId, message] of cases)
		{
			await assert.rejects(configContribution(harness, { kenh: channel(channelId), "xp-nguoi-bam": 9 }), userError(message), channelId);
		}
		const settings = harness.context.deps.guildConfig.getSettings(GUILD);
		assert.equal(settings.contributionChannelId, null);
		assert.equal(settings.contributionInteractionXp, DEFAULT_GUILD_SETTINGS.contributionInteractionXp);
		assert.deepEqual(harness.context.deps.audit.list(GUILD, 10), []);
	});

	test("xp-nguoi-bam và gioi-han-xp-ngay: lưu và báo theo thứ tự cố định", async () =>
	{
		const harness = createConfigHarness();
		const text = await configContribution(harness, { "gioi-han-xp-ngay": 0, "xp-nguoi-bam": 8, "diem-moi-luot": 2 });
		assert.equal(text, [
			"Đã cập nhật cấu hình contribution:",
			"• Điểm mỗi lượt ghi nhận: **2 điểm**",
			"• XP cho người bấm ghi nhận: **8 XP**",
			"• Giới hạn XP từ contribution mỗi ngày: **không giới hạn**",
		].join("\n"));
		const settings = harness.context.deps.guildConfig.getSettings(GUILD);
		assert.deepEqual([settings.contributionVotePoints, settings.contributionInteractionXp, settings.contributionInteractionXpDailyCap], [2, 8, 0]);
	});

	test("role-duyet / bo-role-duyet / xoa-role-duyet như role tạo vote; role sai hay xung đột thì không lưu gì; không chọn gì thì báo", async () =>
	{
		const harness = createConfigHarness();
		const { guildConfig } = harness.context.deps;
		await assert.rejects(configContribution(harness, {}), userError("Hãy chọn ít nhất một giá trị để thay đổi."));
		await assert.rejects(configContribution(harness, { "xoa-role-duyet": false }), userError("Hãy chọn ít nhất một giá trị để thay đổi."));
		await assert.rejects(configContribution(harness, { "role-duyet": role(ROLE_BACKEND), "xoa-role-duyet": true }), userError(REVIEWER_ROLE_CONFLICT));
		await assert.rejects(configContribution(harness, { "bo-role-duyet": role(ROLE_BACKEND), "xoa-role-duyet": true }), userError(REVIEWER_ROLE_CONFLICT));
		await assert.rejects(
			configContribution(harness, { "role-duyet": role(GUILD), "xp-nguoi-bam": 9 }),
			userError("Không thể dùng @everyone làm role duyệt contribution."),
		);
		await assert.rejects(
			configContribution(harness, { "role-duyet": role(ROLE_OTHER, true) }),
			userError("Không thể dùng role do bot hoặc integration quản lý làm role duyệt contribution."),
		);
		assert.equal(guildConfig.getSettings(GUILD).contributionInteractionXp, DEFAULT_GUILD_SETTINGS.contributionInteractionXp, "role sai thì không lưu số đi kèm");

		assert.equal(await configContribution(harness, { "role-duyet": role(ROLE_BACKEND), "xp-nguoi-bam": 9 }), [
			"Đã cập nhật cấu hình contribution:",
			"• XP cho người bấm ghi nhận: **9 XP**",
			`Đã thêm <@&${ROLE_BACKEND}> vào danh sách role duyệt contribution.`,
			`• Role duyệt contribution: **<@&${ROLE_BACKEND}>**`,
		].join("\n"));
		harness.context.clock.advance(1000);
		await configContribution(harness, { "role-duyet": role(ROLE_FRONTEND) });
		assert.deepEqual(guildConfig.getSettings(GUILD).contributionReviewerRoleIds, [ROLE_BACKEND, ROLE_FRONTEND]);

		const removed = await configContribution(harness, { "bo-role-duyet": role(ROLE_BACKEND) });
		assert.equal(removed, `Đã cập nhật cấu hình contribution:\nĐã bỏ <@&${ROLE_BACKEND}> khỏi danh sách role duyệt contribution.\n• Role duyệt contribution: **<@&${ROLE_FRONTEND}>**`);
		const unchanged = await configContribution(harness, { "bo-role-duyet": role(ROLE_BACKEND) });
		assert.ok(unchanged.startsWith("Không có gì thay đổi:"), unchanged);

		const cleared = await configContribution(harness, { "xoa-role-duyet": true });
		assert.deepEqual(guildConfig.getSettings(GUILD).contributionReviewerRoleIds, []);
		assert.ok(cleared.endsWith("• Role duyệt contribution: **chưa đặt (chỉ admin)**"), cleared);
	});

	test("role duyệt vừa đặt có hiệu lực ngay với nút ✅ trên thẻ", async () =>
	{
		const harness = createHarness({ contributionReviewerRoleIds: [] });
		const contribution = submitPending(harness);
		await assert.rejects(press(harness, `contrib:approve:${contribution.id}`, { userId: USER_C, roleIds: [ROLE_BACKEND] }), userError(REVIEW_DENIED));
		harness.context.deps.guildConfig.changeRoleGrants(GUILD, "contributionReviewerRoleIds", { add: [ROLE_BACKEND] }, ADMIN);
		await press(harness, `contrib:approve:${contribution.id}`, { userId: USER_C, roleIds: [ROLE_BACKEND] });
		assert.equal(current(harness, contribution.id).reviewState, "approved");
	});
});
