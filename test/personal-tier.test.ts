// Bộ danh hiệu hiển thị cá nhân (DEC-047): TierSetService với SQLite :memory: và migration thật, rồi tích hợp qua code thật của
// tầng Discord (messageCreate, /rank, /leaderboard) để chắc lời chúc và thẻ theo bộ cá nhân, còn bảng xếp hạng theo bộ server.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	ChatInputCommandInteraction,
	ComponentType,
	ContainerBuilder,
	InteractionEditReplyOptions,
	Message,
	PermissionFlagsBits,
	PermissionsBitField,
} from "discord.js";
import type DiscordClient from "../src/classes/DiscordClient";
import { LeaderboardCardData, RankCardData, RenderedCard } from "../src/discord/cards/types";
import { RenderGate } from "../src/discord/renderGate";
import { levelUpText } from "../src/discord/views/progression";
import MessageCreate from "../src/events/messageCreate";
import LeaderboardCmd from "../src/interactions/commands/leaderboard";
import RankCmd from "../src/interactions/commands/rank";
import { openDatabase } from "../src/db/connection";
import { runMigrations } from "../src/db/migrations";
import { applyTierOverrides, DEFAULT_TIER_SET_KEY, TIER_SET_KEYS, TIER_SETS } from "../src/modules/activity/tiers";
import { GamificationService } from "../src/modules/gamification/GamificationService";
import { INVALID_TIER_SET_KEY, PERSONAL_TIER_DISABLED, TierSetService } from "../src/modules/gamification/TierSetService";
import { AppServices, createServices } from "../src/services";
import { UserError } from "../src/shared/errors";
import { ADMIN, CHANNEL_GENERAL, createTestContext, FakeClock, GUILD, OTHER_GUILD, USER_A, USER_B, USER_C } from "./helpers";

function userError(message: string): (error: unknown) => boolean
{
	return (error: unknown): boolean => error instanceof UserError && error.message === message;
}

function setup(): { context: ReturnType<typeof createTestContext>; service: TierSetService }
{
	const context = createTestContext();
	return { context, service: context.deps.tierSets };
}

function audits(context: ReturnType<typeof createTestContext>, prefix: string): { action: string; actorId: string; targetId: string | null; details: Record<string, unknown> | null }[]
{
	return context.deps.audit.list(GUILD, 100).filter(entry => entry.action.startsWith(prefix)).reverse();
}

describe("TierSetService: bộ hiển thị cá nhân (DEC-047)", () =>
{
	test("mặc định: cho phép tự chọn, chưa ai chọn nên mọi người theo bộ của server", () =>
	{
		const { service } = setup();
		service.select(GUILD, "rank-game", ADMIN);
		assert.equal(service.allowPersonal(GUILD), true);
		assert.equal(service.allowPersonal(OTHER_GUILD), true);
		assert.equal(service.memberChoice(GUILD, USER_A), null);
		const display = service.displayFor(GUILD, USER_A);
		assert.equal(display.source, "server");
		assert.equal(display.set.key, "rank-game");
		assert.equal(display.serverSet.key, "rank-game");
		assert.equal(display.choiceKey, null);
		assert.equal(display.allowPersonal, true);
		assert.deepEqual(service.choiceCounts(GUILD), TIER_SET_KEYS.map(setKey => ({ setKey, count: 0 })));
	});

	test("thành viên tự chọn: bộ riêng của người đó (áp tên tuỳ chỉnh của server cho bộ đó), người khác và server khác không đổi, không audit", () =>
	{
		const { context, service } = setup();
		service.select(GUILD, "cay-xanh", ADMIN);
		service.rename(GUILD, [{ tierKey: "bac-2", name: "Mầm Non", emoji: null }], ADMIN);
		service.select(GUILD, "rank-game", ADMIN);
		const auditsBefore = context.deps.audit.list(GUILD, 100).length;

		const chosen = service.chooseForMember(GUILD, USER_A, "cay-xanh");
		assert.equal(chosen.source, "personal");
		assert.equal(chosen.set.key, "cay-xanh");
		assert.equal(chosen.set.tiers[1].name, "Mầm Non", "tên tuỳ chỉnh của server cho bộ Cây xanh vẫn áp dụng");
		assert.equal(chosen.serverSet.key, "rank-game");
		assert.equal(service.displayFor(GUILD, USER_B).set.key, "rank-game");
		assert.equal(service.displayFor(OTHER_GUILD, USER_A).set.key, DEFAULT_TIER_SET_KEY);
		assert.equal(service.currentKey(GUILD), "rank-game", "bộ của server không đổi");
		assert.equal(context.deps.audit.list(GUILD, 100).length, auditsBefore, "thành viên tự chọn không ghi audit");

		const same = service.chooseForMember(GUILD, USER_B, "rank-game");
		assert.equal(same.source, "personal", "chọn đúng bộ của server vẫn là tự chọn (server đổi bộ thì người này giữ bộ đã chọn)");
		service.select(GUILD, "vu-tru", ADMIN);
		assert.equal(service.displayFor(GUILD, USER_B).set.key, "rank-game");
		assert.equal(service.displayFor(GUILD, USER_C).set.key, "vu-tru");

		service.chooseForMember(GUILD, USER_A, "kiem-hiep");
		assert.equal(service.memberChoice(GUILD, USER_A), "kiem-hiep", "chọn lại thì thay lựa chọn cũ");
		const back = service.chooseForMember(GUILD, USER_A, null);
		assert.equal(back.source, "server");
		assert.equal(service.memberChoice(GUILD, USER_A), null);
	});

	test("khoá bộ sai bị từ chối, không lưu gì", () =>
	{
		const { service } = setup();
		const loose = service as unknown as { chooseForMember(guildId: string, userId: string, setKey: string): unknown };
		assert.throws(() => loose.chooseForMember(GUILD, USER_A, "pokemon"), userError(INVALID_TIER_SET_KEY));
		assert.equal(service.memberChoice(GUILD, USER_A), null);
	});

	test("admin tắt tự chọn: mọi người theo server, lựa chọn đã lưu vẫn giữ; chọn bộ bị từ chối, về theo server vẫn được; bật lại dùng lại", () =>
	{
		const { context, service } = setup();
		service.chooseForMember(GUILD, USER_A, "cay-xanh");
		service.chooseForMember(GUILD, USER_B, "vu-tru");

		assert.equal(service.setAllowPersonal(GUILD, false, ADMIN), true);
		assert.equal(service.allowPersonal(GUILD), false);
		assert.equal(service.allowPersonal(OTHER_GUILD), true, "công tắc theo từng server");
		const off = service.displayFor(GUILD, USER_A);
		assert.equal(off.source, "server");
		assert.equal(off.set.key, DEFAULT_TIER_SET_KEY);
		assert.equal(off.choiceKey, "cay-xanh", "lựa chọn vẫn giữ");
		assert.equal(off.allowPersonal, false);

		assert.throws(() => service.chooseForMember(GUILD, USER_A, "kiem-hiep"), userError(PERSONAL_TIER_DISABLED));
		assert.equal(service.memberChoice(GUILD, USER_A), "cay-xanh", "bị từ chối thì không ghi gì");
		service.chooseForMember(GUILD, USER_B, null);
		assert.equal(service.memberChoice(GUILD, USER_B), null);

		assert.equal(service.setAllowPersonal(GUILD, false, ADMIN), false, "đặt lại đúng giá trị đang có thì không ghi gì");
		assert.equal(service.setAllowPersonal(GUILD, true, USER_C), true);
		assert.equal(service.displayFor(GUILD, USER_A).set.key, "cay-xanh", "bật lại thì dùng lại lựa chọn cũ");

		assert.deepEqual(audits(context, "tier_pref").map(entry => [entry.action, entry.actorId, entry.targetId, entry.details]), [
			["tier_pref.allow", ADMIN, null, { allowPersonal: false }],
			["tier_pref.allow", USER_C, null, { allowPersonal: true }],
		]);
	});

	test("đổi công tắc không đụng tới bộ của server: guild chưa có cấu hình dùng bộ mặc định, guild đã chọn bộ giữ nguyên bộ", () =>
	{
		const { context, service } = setup();
		service.setAllowPersonal(GUILD, false, ADMIN);
		assert.equal(service.currentKey(GUILD), DEFAULT_TIER_SET_KEY);
		assert.deepEqual(audits(context, "tier_set"), [], "tạo dòng cấu hình để lưu công tắc không phải là chọn bộ");
		service.select(GUILD, "rank-game", ADMIN);
		assert.equal(service.allowPersonal(GUILD), false, "chọn bộ không đổi công tắc");
		service.setAllowPersonal(GUILD, true, ADMIN);
		assert.equal(service.currentKey(GUILD), "rank-game");
		assert.deepEqual(audits(context, "tier_set").map(entry => entry.details), [{ from: "tu-tien", to: "rank-game" }]);
	});

	test("admin xoá lựa chọn của một người: audit với người thao tác, trả về bộ đã xoá; chưa chọn thì không ghi gì", () =>
	{
		const { context, service } = setup();
		service.chooseForMember(GUILD, USER_A, "cay-xanh");
		assert.equal(service.clearMemberChoice(GUILD, USER_A, ADMIN), "cay-xanh");
		assert.equal(service.memberChoice(GUILD, USER_A), null);
		assert.equal(service.clearMemberChoice(GUILD, USER_A, ADMIN), null);
		assert.equal(service.clearMemberChoice(GUILD, USER_B, ADMIN), null);
		assert.deepEqual(audits(context, "tier_pref").map(entry => [entry.action, entry.actorId, entry.targetId, entry.details]), [
			["tier_pref.clear", ADMIN, USER_A, { setKey: "cay-xanh" }],
		]);
	});

	test("khoá bộ lạ trong database (sửa tay, bộ đã bị bỏ) đọc như theo server, không được đếm; admin vẫn xoá được", () =>
	{
		const { context, service } = setup();
		context.db.prepare("INSERT INTO member_tier_prefs (guild_id, user_id, set_key, updated_at) VALUES (?, ?, 'bo-cu', 0)").run(GUILD, USER_A);
		assert.equal(service.memberChoice(GUILD, USER_A), null);
		const display = service.displayFor(GUILD, USER_A);
		assert.equal(display.source, "server");
		assert.equal(display.choiceKey, null);
		assert.ok(service.choiceCounts(GUILD).every(entry => entry.count === 0));
		assert.equal(service.clearMemberChoice(GUILD, USER_A, ADMIN), "bo-cu");
		assert.equal(context.db.prepare("SELECT COUNT(*) AS n FROM member_tier_prefs").pluck().get(), 0);
	});

	test("đếm theo bộ: theo thứ tự TIER_SET_KEYS, theo từng server, gồm cả lựa chọn đang bị tắt", () =>
	{
		const { service } = setup();
		service.chooseForMember(GUILD, USER_A, "cay-xanh");
		service.chooseForMember(GUILD, USER_B, "cay-xanh");
		service.chooseForMember(GUILD, USER_C, "mobile-legends");
		service.chooseForMember(OTHER_GUILD, USER_A, "vu-tru");
		service.setAllowPersonal(GUILD, false, ADMIN);
		const counts = service.choiceCounts(GUILD);
		assert.deepEqual(counts.map(entry => entry.setKey), [...TIER_SET_KEYS]);
		assert.deepEqual(Object.fromEntries(counts.filter(entry => entry.count > 0).map(entry => [entry.setKey, entry.count])), { "cay-xanh": 2, "mobile-legends": 1 });
	});

	test("hồ sơ gamification (thẻ /rank) theo bộ hiển thị của người đó; tắt tự chọn thì theo server", () =>
	{
		const { context, service } = setup();
		const gamification = new GamificationService(context.db, context.deps);
		service.select(GUILD, "rank-game", ADMIN);
		service.chooseForMember(GUILD, USER_A, "cay-xanh");
		assert.equal(gamification.profile(GUILD, USER_A).tierSet.key, "cay-xanh");
		assert.equal(gamification.profile(GUILD, USER_A).tier.name, "Hạt Giống");
		assert.equal(gamification.profile(GUILD, USER_B).tierSet.key, "rank-game");
		service.setAllowPersonal(GUILD, false, ADMIN);
		assert.equal(gamification.profile(GUILD, USER_A).tierSet.key, "rank-game");
	});
});

// ---------- Tích hợp với tầng Discord (service thật) ----------

const BOT_ID = "900000000000000001";
const CARD: RenderedCard = { png: Buffer.from("png"), fileName: "rank.png", width: 1000, height: 460 };
let backupCounter = 0;

interface World
{
	services: AppServices;
	clock: FakeClock;
	client: DiscordClient;
}

function world(): World
{
	const db = openDatabase(":memory:");
	runMigrations(db);
	const clock = new FakeClock();
	backupCounter += 1;
	const services = createServices(db, { clock, backupDir: path.join(tmpdir(), `personal-tier-test-${process.pid}-${backupCounter}`), backupKeep: 1 });
	const client = {
		services,
		guildIds: [GUILD],
		user: { id: BOT_ID },
		renderGate: new RenderGate({ now: () => clock.now() }),
		avatars: { get: () => Promise.resolve(null) },
		members: {
			resolve: (_guild: unknown, userIds: readonly string[]) => Promise.resolve(new Map(userIds.map(id => [id, { displayName: `Tên ${id.slice(-1)}`, avatarUrl: null, inGuild: true }]))),
		},
	} as unknown as DiscordClient;
	return { services, clock, client };
}

/** Tin nhắn giả của USER_A ở kênh thường; bot gửi được tin; `sent` ghi lại thông báo bot gửi. */
function userMessage(content: string): { message: Message; sent: { content?: string }[] }
{
	const sent: { content?: string }[] = [];
	const message = {
		author: { id: USER_A, bot: false },
		webhookId: null,
		system: false,
		inGuild: () => true,
		guildId: GUILD,
		channelId: CHANNEL_GENERAL,
		channel: {
			isThread: () => false,
			isSendable: () => true,
			permissionsFor: () => new PermissionsBitField([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]),
			send: (payload: { content?: string }) =>
			{
				sent.push(payload);
				return Promise.resolve();
			},
		},
		guild: { id: GUILD, channels: { cache: new Map() } },
		content,
		attachments: { size: 0 },
		member: null,
	};
	return { message: message as unknown as Message, sent };
}

function giveXp(services: AppServices, userId: string, delta: number): void
{
	services.activity.adjustXp({ guildId: GUILD, userId, delta, actorId: ADMIN, reason: null, roleIds: [] });
}

function commandInteraction(viewerId: string, target: { id: string; name: string } | null): { interaction: ChatInputCommandInteraction; edits: InteractionEditReplyOptions[] }
{
	const edits: InteractionEditReplyOptions[] = [];
	const user = (id: string, name: string): object => ({ id, bot: false, displayName: name, displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png" });
	const interaction = {
		inGuild: () => true,
		guildId: GUILD,
		guild: { id: GUILD, roles: { cache: new Map() } },
		user: user(viewerId, `Người ${viewerId.slice(-1)}`),
		member: { nick: null, roles: [] },
		memberPermissions: new PermissionsBitField([PermissionFlagsBits.SendMessages]),
		appPermissions: new PermissionsBitField([PermissionFlagsBits.AttachFiles]),
		channel: { isThread: () => false },
		options: {
			getUser: () => (target ? user(target.id, target.name) : null),
			getMember: () => (target ? { nick: null, roles: [] } : null),
			getString: () => null,
			getInteger: () => null,
		},
		deferReply: () => Promise.resolve(),
		editReply: (payload: InteractionEditReplyOptions) =>
		{
			edits.push(payload);
			return Promise.resolve();
		},
	};
	return { interaction: interaction as unknown as ChatInputCommandInteraction, edits };
}

/** Chữ tóm tắt dưới ảnh của thẻ /rank (TextDisplay cuối của khung Components V2). */
function rankSummary(edit: InteractionEditReplyOptions | undefined): string
{
	const [top] = edit?.components ?? [];
	assert.ok(top instanceof ContainerBuilder);
	const last = top.toJSON().components.at(-1);
	assert.ok(last?.type === ComponentType.TextDisplay);
	return last.content;
}

describe("tích hợp: bộ cá nhân qua tầng Discord (DEC-047)", () =>
{
	test("messageCreate: lời chúc lên level theo bộ người đó tự chọn (kèm tên tuỳ chỉnh của server); tắt tự chọn thì theo bộ server", async () =>
	{
		const { services, clock, client } = world();
		services.tierSets.select(GUILD, "cay-xanh", ADMIN);
		services.tierSets.rename(GUILD, [{ tierKey: "bac-1", name: "Hạt Mầm", emoji: null }], ADMIN);
		services.tierSets.select(GUILD, "rank-game", ADMIN);
		services.tierSets.chooseForMember(GUILD, USER_A, "cay-xanh");
		const event = new MessageCreate(client);

		giveXp(services, USER_A, 90);
		const first = userMessage("Hôm nay deploy xong bản mới");
		await event.execute(first.message);
		const personal = applyTierOverrides(TIER_SETS["cay-xanh"], [{ tierKey: "bac-1", name: "Hạt Mầm", emoji: null }]);
		assert.deepEqual(first.sent.map(payload => payload.content), [levelUpText(personal, USER_A, 1)]);
		assert.notEqual(levelUpText(personal, USER_A, 1), levelUpText(TIER_SETS["rank-game"], USER_A, 1));

		services.tierSets.setAllowPersonal(GUILD, false, ADMIN);
		clock.advanceSeconds(61);
		giveXp(services, USER_A, 145);
		const second = userMessage("Chiều nay họp review sprint");
		await event.execute(second.message);
		assert.deepEqual(second.sent.map(payload => payload.content), [levelUpText(TIER_SETS["rank-game"], USER_A, 2)]);
	});

	test("/rank: thẻ của một người theo bộ người đó chọn, ai xem cũng vậy; người chưa chọn theo server", async () =>
	{
		const { services, clock, client } = world();
		services.tierSets.select(GUILD, "rank-game", ADMIN);
		services.tierSets.chooseForMember(GUILD, USER_A, "cay-xanh");
		giveXp(services, USER_A, 1915);
		const command = new RankCmd(client);
		const cards: RankCardData[] = [];
		command.renderCard = data =>
		{
			cards.push(data);
			return Promise.resolve(CARD);
		};

		const byOther = commandInteraction(USER_B, { id: USER_A, name: "A" });
		await command.execute(byOther.interaction);
		assert.equal(cards[0]?.tierSet.key, "cay-xanh", "người khác xem thẻ của A: theo bộ A chọn");
		assert.equal(cards[0]?.tier.name, "Cây Non");
		assert.ok(rankSummary(byOther.edits[0]).startsWith("🌿 Giai đoạn **Cây Non** · Level 6"));

		clock.advanceSeconds(5);
		const own = commandInteraction(USER_B, null);
		await command.execute(own.interaction);
		assert.equal(cards[1]?.tierSet.key, "rank-game", "B chưa chọn: theo bộ server");
		assert.ok(rankSummary(own.edits[0]).startsWith("🟤 Hạng **Đồng** · Level 0"));
	});

	test("/leaderboard: bậc trên bảng luôn theo bộ server, kể cả khi người xem và người trên bảng tự chọn bộ khác", async () =>
	{
		const { services, client } = world();
		services.tierSets.select(GUILD, "rank-game", ADMIN);
		services.tierSets.chooseForMember(GUILD, USER_A, "cay-xanh");
		giveXp(services, USER_A, 1915);
		const command = new LeaderboardCmd(client);
		const cards: LeaderboardCardData[] = [];
		command.renderCard = data =>
		{
			cards.push(data);
			return Promise.resolve({ ...CARD, fileName: "leaderboard.png" });
		};

		await command.execute(commandInteraction(USER_A, null).interaction);
		assert.equal(cards[0]?.tierSet.key, "rank-game");
		assert.equal(cards[0]?.rows[0]?.tier?.setKey, "rank-game");
		assert.equal(cards[0]?.rows[0]?.tier?.name, "Vàng");
	});
});
