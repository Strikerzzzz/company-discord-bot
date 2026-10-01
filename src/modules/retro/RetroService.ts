import { createHash, randomBytes } from "crypto";
import { Db, truncateWal } from "../../db/connection";
import { UserError } from "../../shared/errors";
import { ListPage, pageWindow } from "../../shared/paging";
import { ServiceDeps } from "../deps";
import { Poll, POLL_LIMITS, PollServiceApi } from "../poll/types";
import { cutText, displaySprintName, isNumericOnlyName, normalizeAnswers, sprintNameKey } from "./answers";
import { parseDocLink } from "./docLink";
import {
	CreateRetroInput,
	DEFAULT_RETRO_CONFIG,
	isRetroField,
	isRetroStatus,
	ManagerRoleChange,
	ManagerRoleResult,
	RETRO_CONFIG_KEYS,
	RETRO_CONFIG_LIMITS,
	RETRO_IDEA_FIELDS,
	RETRO_LIMITS,
	RetroAnswers,
	RetroColumns,
	RetroConfig,
	RetroConfigKey,
	RetroDocResult,
	RetroField,
	RetroIdeaDelete,
	RetroIdeaField,
	RetroListQuery,
	RetroServiceApi,
	RetroSession,
	RetroSubmitInput,
	RetroSubmitResult,
	RetroVoteOutcome,
	SprintNameCandidate,
} from "./types";

const MS_PER_HOUR = 60 * 60 * 1000;
/** Lỗi Confluence lưu tối đa chừng này ký tự. */
const DOC_ERROR_MAX = 300;

export const RETRO_NOT_FOUND = "Không tìm thấy phiên retro này.";
export const RETRO_NOT_ACCEPTING = "Phiên retro này đã đóng, không điền hay sửa câu trả lời được nữa.";
export const RETRO_CONTENT_DELETED = "Nội dung của phiên retro này đã bị xoá.";
export const RETRO_NO_SPRINT_NAME = "Chưa có ai đề xuất tên sprint trong phiên này.";
export const RETRO_IDEA_NOT_FOUND = "Không tìm thấy ý này (có thể đã bị xoá hoặc vừa thay đổi).";
export const RETRO_NAME_IN_VOTE = "Phiên đang vote tên sprint (hoặc chờ chọn tên khi hoà) nên không xoá được tên lúc này: tên có thể đang nằm "
	+ "trong vote. Hãy chốt tên xong rồi mới xoá.";
export const RETRO_NEVER_POSTED = "Phiên này chưa từng có tin trên Discord (bot không đăng được tin có nút 📝 Điền retro), nên chưa mở lại được. "
	+ "Hãy đăng lại tin của phiên trước (/retro repost, hoặc nút “Đăng lại tin của phiên” trên web), hoặc tạo phiên mới.";

/** Tên cột trong bảng retro_entries của từng ô (hằng số trong code, được phép ghép vào SQL). */
const FIELD_COLUMNS: Readonly<Record<RetroField, string>> = {
	learned: "learned",
	improve: "improve",
	ideas: "ideas",
	kudos: "kudos",
	sprintName: "sprint_name",
};

interface SessionRow
{
	id: number;
	guild_id: string;
	title: string;
	channel_id: string;
	message_id: string | null;
	team_role_id: string | null;
	doc_url: string | null;
	doc_page_id: string | null;
	status: string;
	closes_at: number | null;
	created_by: string;
	created_at: number;
	closed_at: number | null;
	poll_id: number | null;
	tie_names: string | null;
	winner_name: string | null;
	confluence_written_at: number | null;
	confluence_error: string | null;
	content_deleted_at: number | null;
	summary_posted_at: number | null;
	participants: number;
}

interface EntryRow
{
	id: number;
	user_id: string;
	learned: string | null;
	improve: string | null;
	ideas: string | null;
	kudos: string | null;
	sprint_name: string | null;
	team_role_ids: string;
	order_keys: string;
	submitted_at: number;
}

interface ConfigRow
{
	fill_xp: number;
	proposer_bonus_xp: number;
	vote_minutes: number;
}

/** Một ý trong một cột chữ, kèm mã phiếu: chỉ dùng trong service để xoá đúng ô, không bao giờ trả ra ngoài. */
interface ColumnIdea
{
	entryId: number;
	text: string;
}

type OrderKeys = Partial<Record<RetroIdeaField, string>>;

const SESSION_COLUMNS = "s.*, (SELECT COUNT(*) FROM retro_entries e WHERE e.session_id = s.id) AS participants";

function accepting(row: Pick<SessionRow, "status" | "closes_at">, now: number): boolean
{
	return row.status === "open" && (row.closes_at === null || now < row.closes_at);
}

function answersOf(row: Pick<EntryRow, "learned" | "improve" | "ideas" | "kudos" | "sprint_name">): RetroAnswers
{
	return { learned: row.learned, improve: row.improve, ideas: row.ideas, kudos: row.kudos, sprintName: row.sprint_name };
}

/** Mảng chuỗi JSON đã lưu (tie_names, team_role_ids); giá trị lạ thì null. */
function parseStringArray(text: string | null): string[] | null
{
	if (text === null) return null;
	try
	{
		const value: unknown = JSON.parse(text);
		return Array.isArray(value) && value.every(item => typeof item === "string") ? value : null;
	}
	catch
	{
		return null;
	}
}

/** Khoá ngẫu nhiên mới cho thứ tự hiển thị của một ô: 128 bit, không suy ra được từ mã phiếu, người viết hay thời điểm gửi. */
export function randomOrderKey(): string
{
	return randomBytes(16).toString("hex");
}

/** Khoá thứ tự đã lưu của các ô chữ (cột order_keys); giá trị lạ thì bỏ qua. */
function parseOrderKeys(text: string): OrderKeys
{
	const keys: OrderKeys = {};
	let value: unknown;
	try
	{
		value = JSON.parse(text);
	}
	catch
	{
		return keys;
	}
	if (typeof value !== "object" || value === null) return keys;
	for (const field of RETRO_IDEA_FIELDS)
	{
		const key: unknown = Reflect.get(value, field);
		if (typeof key === "string" && key.length > 0) keys[field] = key;
	}
	return keys;
}

/**
 * Khoá thứ tự của một ô: khoá ngẫu nhiên đã lưu; thiếu (dữ liệu lạ) thì băm chữ của ô, để thứ tự vẫn không phụ thuộc người viết, mã
 * phiếu hay thứ tự gửi.
 */
function orderKeyOf(keys: OrderKeys, field: RetroIdeaField, text: string): string
{
	return keys[field] ?? createHash("sha256").update(`${field}:${text}`).digest("hex");
}

function compareText(a: string, b: string): number
{
	return a < b ? -1 : a > b ? 1 : 0;
}

/** Tiêu đề một dòng; độ dài đếm theo UTF-16 như option `ten` của /retro create và PollService. */
function validateTitle(raw: string): string
{
	const title = raw.normalize("NFC").replace(/\s+/gu, " ").trim();
	if (title.length < RETRO_LIMITS.titleMin || title.length > RETRO_LIMITS.titleMax)
	{
		throw new UserError(`Tên phiên retro phải dài từ ${RETRO_LIMITS.titleMin} đến ${RETRO_LIMITS.titleMax} ký tự.`);
	}
	return title;
}

function validateHours(hours: number): void
{
	const { durationHoursMin: min, durationHoursMax: max } = RETRO_LIMITS;
	if (!Number.isInteger(hours) || hours < min || hours > max)
	{
		throw new UserError(`Hạn phải là số giờ nguyên từ ${min} đến ${max} (${max / 24} ngày).`);
	}
}

function validateConfigNumber(key: RetroConfigKey, value: number): void
{
	const limit = RETRO_CONFIG_LIMITS[key];
	if (!Number.isInteger(value) || value < limit.min || value > limit.max)
	{
		throw new UserError(`${limit.label} phải là số nguyên từ ${limit.min} đến ${limit.max}.`);
	}
}

/**
 * Retro sprint theo team (DEC-049):
 * - phiên gắn với một kênh/thread, tuỳ chọn một role team; mỗi người một phiếu 5 ô, sửa được tới khi đóng;
 * - lưu người điền để admin theo dõi, nhưng nội dung chỉ trả về ẩn danh, theo từng cột: mỗi ô có khoá ngẫu nhiên riêng (randomBytes,
 *   lưu trong order_keys) và mỗi cột xếp theo khoá của nó, nên thứ tự không suy ra được từ mã phiếu hay thứ tự gửi, và một hàng của
 *   bảng không phải câu trả lời của một người;
 * - XP (điền retro, người đề xuất tên thắng) ghi qua xpLedger với nguồn "admin" và người thao tác là ID hệ thống;
 * - vote tên sprint dùng PollService có sẵn; hoà thì người quản lý chọn.
 * Mọi thao tác ghi nhiều bước nằm trong một transaction.
 */
export class RetroService implements RetroServiceApi
{
	constructor(
		private readonly db: Db,
		private readonly deps: ServiceDeps,
		private readonly polls: PollServiceApi,
		/** CONFLUENCE_BASE_URL đã chuẩn hoá, hoặc null nếu chưa cấu hình (link tài liệu vẫn lưu, không kiểm tra host). */
		private readonly confluenceBaseUrl: string | null = null,
		/** Sinh khoá thứ tự hiển thị của một ô; test thay bằng dãy cố định. */
		private readonly newOrderKey: () => string = randomOrderKey,
	)
	{}

	create(input: CreateRetroInput): RetroSession
	{
		const title = validateTitle(input.title);
		const rawDoc = input.docUrl?.trim() ?? "";
		const doc = rawDoc.length > 0 ? parseDocLink(rawDoc, this.confluenceBaseUrl) : null;
		if (input.durationHours !== null) validateHours(input.durationHours);

		return this.db.transaction((): RetroSession =>
		{
			const { guildId, channelId, teamRoleId } = input;
			if (teamRoleId !== null && !this.deps.teams.list(guildId).includes(teamRoleId))
			{
				throw new UserError("Role team phải là một team đã cấu hình (trang Team trên web, hoặc /config team add).");
			}
			const open = this.findOpenRow(guildId, channelId);
			if (open) throw new UserError(`Kênh này đang có phiên retro #${open.id} "${open.title}" chưa đóng. Hãy đóng phiên đó trước khi tạo phiên mới.`);

			const now = this.deps.clock.now();
			const closesAt = input.durationHours === null ? null : now + input.durationHours * MS_PER_HOUR;
			const result = this.db.prepare(`
				INSERT INTO retro_sessions (guild_id, title, channel_id, team_role_id, doc_url, doc_page_id, status, closes_at, created_by, created_at)
				VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
			).run(guildId, title, channelId, teamRoleId, doc?.url ?? null, doc?.pageId ?? null, closesAt, input.createdBy, now);
			const sessionId = Number(result.lastInsertRowid);
			this.deps.audit.record(guildId, input.createdBy, "retro.create", channelId, {
				sessionId,
				title,
				teamRoleId,
				docUrl: doc?.url ?? null,
				closesAt,
			});
			return this.load(sessionId);
		})();
	}

	attachMessage(guildId: string, sessionId: number, messageId: string): void
	{
		const changed = Number.isSafeInteger(sessionId)
			&& this.db.prepare("UPDATE retro_sessions SET message_id = ? WHERE guild_id = ? AND id = ?").run(messageId, guildId, sessionId).changes > 0;
		if (!changed) throw new UserError(RETRO_NOT_FOUND);
	}

	get(guildId: string, sessionId: number): RetroSession | null
	{
		const row = this.findRow(guildId, sessionId);
		return row ? this.toSession(row) : null;
	}

	findOpenInChannel(guildId: string, channelId: string): RetroSession | null
	{
		const row = this.findOpenRow(guildId, channelId);
		return row ? this.toSession(row) : null;
	}

	latestInChannel(guildId: string, channelId: string): RetroSession | null
	{
		const row = this.db.prepare<[string, string], SessionRow>(
			`SELECT ${SESSION_COLUMNS} FROM retro_sessions s WHERE s.guild_id = ? AND s.channel_id = ? ORDER BY s.created_at DESC, s.id DESC LIMIT 1`,
		).get(guildId, channelId);
		return row ? this.toSession(row) : null;
	}

	findByPoll(guildId: string, pollId: number): RetroSession | null
	{
		if (!Number.isSafeInteger(pollId)) return null;
		const row = this.db.prepare<[string, number], SessionRow>(`SELECT ${SESSION_COLUMNS} FROM retro_sessions s WHERE s.guild_id = ? AND s.poll_id = ?`)
			.get(guildId, pollId);
		return row ? this.toSession(row) : null;
	}

	listPage(guildId: string, query: RetroListQuery): ListPage<RetroSession>
	{
		const status = query.status === "all" || isRetroStatus(query.status) ? query.status : "all";
		const filter = { guild: guildId, status };
		const where = "s.guild_id = @guild AND (@status = 'all' OR s.status = @status)";
		const total = this.db.prepare<[typeof filter], { n: number }>(`SELECT COUNT(*) AS n FROM retro_sessions s WHERE ${where}`).get(filter)?.n ?? 0;
		const window = pageWindow(total, query.page, query.pageSize);
		const rows = this.db.prepare<[typeof filter & { limit: number; offset: number }], SessionRow>(
			`SELECT ${SESSION_COLUMNS} FROM retro_sessions s WHERE ${where} ORDER BY s.created_at DESC, s.id DESC LIMIT @limit OFFSET @offset`,
		).all({ ...filter, limit: window.pageSize, offset: window.offset });
		return { items: rows.map(row => this.toSession(row)), page: window.page, totalPages: window.totalPages, total, pageSize: window.pageSize };
	}

	submit(input: RetroSubmitInput): RetroSubmitResult
	{
		const answers = normalizeAnswers(input.answers);
		const { guildId, sessionId, userId } = input;

		return this.db.transaction((): RetroSubmitResult =>
		{
			const now = this.deps.clock.now();
			const row = this.requireRow(guildId, sessionId);
			if (!accepting(row, now)) throw new UserError(RETRO_NOT_ACCEPTING);
			if (row.team_role_id !== null && !input.roleIds.includes(row.team_role_id))
			{
				throw new UserError(`Phiên retro này chỉ dành cho thành viên team <@&${row.team_role_id}>.`);
			}

			const teams = JSON.stringify(this.deps.teams.resolveTeams(guildId, input.roleIds));
			const existing = this.db.prepare<[number, string], EntryRow>("SELECT * FROM retro_entries WHERE session_id = ? AND user_id = ?")
				.get(row.id, userId);
			if (existing)
			{
				const keys = JSON.stringify(this.orderKeys(answers, existing));
				this.db.prepare(`
					UPDATE retro_entries SET learned = ?, improve = ?, ideas = ?, kudos = ?, sprint_name = ?, team_role_ids = ?, order_keys = ?, updated_at = ?
					WHERE id = ?`,
				).run(answers.learned, answers.improve, answers.ideas, answers.kudos, answers.sprintName, teams, keys, now, existing.id);
				return { session: this.load(row.id), answers, firstSubmit: false, xpAwarded: 0 };
			}

			const fillXp = this.getConfig(guildId).fillXp;
			let eventId: number | null = null;
			if (fillXp > 0)
			{
				eventId = this.deps.xpLedger.record({
					guildId,
					userId,
					amount: fillXp,
					source: "admin",
					referenceId: `retro:${row.id}`,
					actorId: input.systemActorId,
					reason: `Retro ${row.title}: điền retro`,
					teamRoleIds: this.deps.teams.resolveTeams(guildId, input.roleIds),
				}).id;
			}
			this.db.prepare(`
				INSERT INTO retro_entries (session_id, guild_id, user_id, learned, improve, ideas, kudos, sprint_name, team_role_ids, order_keys,
					fill_xp_event_id, submitted_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(row.id, guildId, userId, answers.learned, answers.improve, answers.ideas, answers.kudos, answers.sprintName, teams,
				JSON.stringify(this.orderKeys(answers, null)), eventId, now, now);
			return { session: this.load(row.id), answers, firstSubmit: true, xpAwarded: eventId === null ? 0 : fillXp };
		})();
	}

	getAnswers(guildId: string, sessionId: number, userId: string): RetroAnswers | null
	{
		const row = this.findRow(guildId, sessionId);
		if (!row) return null;
		const entry = this.db.prepare<[number, string], EntryRow>("SELECT * FROM retro_entries WHERE session_id = ? AND user_id = ?").get(row.id, userId);
		return entry ? answersOf(entry) : null;
	}

	participants(guildId: string, sessionId: number): string[]
	{
		const row = this.findRow(guildId, sessionId);
		if (!row) return [];
		return this.db.prepare<[number], { user_id: string }>("SELECT user_id FROM retro_entries WHERE session_id = ? ORDER BY user_id")
			.all(row.id)
			.map(entry => entry.user_id);
	}

	columns(guildId: string, sessionId: number): RetroColumns
	{
		const row = this.findRow(guildId, sessionId);
		if (!row) return { learned: [], improve: [], ideas: [], kudos: [], sprintName: [] };
		const entries = this.entryRows(row.id);
		const texts = (field: RetroIdeaField): string[] => this.ideaColumn(entries, field).map(idea => idea.text);
		return {
			learned: texts("learned"),
			improve: texts("improve"),
			ideas: texts("ideas"),
			kudos: texts("kudos"),
			sprintName: this.candidates(row.id).map(candidate => candidate.name),
		};
	}

	sprintNameCandidates(guildId: string, sessionId: number): SprintNameCandidate[]
	{
		const row = this.findRow(guildId, sessionId);
		return row ? this.candidates(row.id) : [];
	}

	close(guildId: string, sessionId: number, actorId: string): RetroSession
	{
		return this.db.transaction((): RetroSession =>
		{
			const row = this.requireRow(guildId, sessionId);
			if (row.status !== "open") throw new UserError("Phiên retro này đã đóng.");
			this.db.prepare("UPDATE retro_sessions SET status = 'closed', closed_at = ? WHERE id = ?").run(this.deps.clock.now(), row.id);
			this.deps.audit.record(guildId, actorId, "retro.close", row.channel_id, { sessionId: row.id, title: row.title });
			return this.load(row.id);
		})();
	}

	closeDue(): RetroSession[]
	{
		return this.db.transaction((): RetroSession[] =>
		{
			const now = this.deps.clock.now();
			const due = this.db.prepare<[number], { id: number }>(
				"SELECT id FROM retro_sessions WHERE status = 'open' AND closes_at IS NOT NULL AND closes_at <= ? ORDER BY closes_at, id",
			).all(now);
			const markClosed = this.db.prepare("UPDATE retro_sessions SET status = 'closed', closed_at = ? WHERE id = ? AND status = 'open'");
			return due.filter(({ id }) => markClosed.run(now, id).changes > 0).map(({ id }) => this.load(id));
		})();
	}

	reopen(guildId: string, sessionId: number, actorId: string, durationHours: number | null): RetroSession
	{
		if (durationHours !== null) validateHours(durationHours);
		return this.db.transaction((): RetroSession =>
		{
			const row = this.requireRow(guildId, sessionId);
			if (row.status === "open") throw new UserError("Phiên retro này đang mở.");
			if (row.status !== "closed") throw new UserError("Phiên retro này đã có vote tên sprint nên không mở lại được.");
			if (row.content_deleted_at !== null) throw new UserError(`${RETRO_CONTENT_DELETED} Không mở lại được.`);
			if (row.message_id === null) throw new UserError(RETRO_NEVER_POSTED);
			const open = this.findOpenRow(guildId, row.channel_id);
			if (open) throw new UserError(`Kênh này đang có phiên retro #${open.id} "${open.title}" mở. Hãy đóng phiên đó trước.`);

			const now = this.deps.clock.now();
			const closesAt = durationHours === null ? null : now + durationHours * MS_PER_HOUR;
			this.db.prepare("UPDATE retro_sessions SET status = 'open', closed_at = NULL, closes_at = ?, summary_posted_at = NULL WHERE id = ?")
				.run(closesAt, row.id);
			this.deps.audit.record(guildId, actorId, "retro.reopen", row.channel_id, { sessionId: row.id, title: row.title, closesAt });
			return this.load(row.id);
		})();
	}

	extend(guildId: string, sessionId: number, actorId: string, durationHours: number): RetroSession
	{
		validateHours(durationHours);
		return this.db.transaction((): RetroSession =>
		{
			const row = this.requireRow(guildId, sessionId);
			if (row.status !== "open") throw new UserError("Chỉ gia hạn được phiên đang mở; phiên đã đóng thì dùng mở lại.");
			const closesAt = this.deps.clock.now() + durationHours * MS_PER_HOUR;
			this.db.prepare("UPDATE retro_sessions SET closes_at = ? WHERE id = ?").run(closesAt, row.id);
			this.deps.audit.record(guildId, actorId, "retro.extend", row.channel_id, { sessionId: row.id, title: row.title, closesAt });
			return this.load(row.id);
		})();
	}

	deleteIdea(input: RetroIdeaDelete): RetroSession
	{
		const { guildId, field, index, text, actorId } = input;
		if (!isRetroField(field)) throw new UserError("Ô cần xoá không hợp lệ.");
		if (!Number.isSafeInteger(index) || index < 0) throw new UserError(RETRO_IDEA_NOT_FOUND);
		return this.db.transaction((): RetroSession =>
		{
			const row = this.requireRow(guildId, input.sessionId);
			const entries = this.entryRows(row.id);
			if (field === "sprintName")
			{
				if (row.status === "voting") throw new UserError(RETRO_NAME_IN_VOTE);
				const candidate = this.candidates(row.id).at(index);
				if (!candidate || candidate.name !== text) throw new UserError(RETRO_IDEA_NOT_FOUND);
				const clear = this.db.prepare("UPDATE retro_entries SET sprint_name = NULL WHERE id = ?");
				for (const entry of entries)
				{
					if (entry.sprint_name !== null && sprintNameKey(entry.sprint_name) === candidate.key) clear.run(entry.id);
				}
			}
			else
			{
				const idea = this.ideaColumn(entries, field).at(index);
				if (!idea || idea.text !== text) throw new UserError(RETRO_IDEA_NOT_FOUND);
				this.db.prepare(`UPDATE retro_entries SET ${FIELD_COLUMNS[field]} = NULL WHERE id = ?`).run(idea.entryId);
			}
			this.deps.audit.record(guildId, actorId, "retro.idea_delete", row.channel_id, { sessionId: row.id, title: row.title, field });
			return this.load(row.id);
		})();
	}

	deleteContent(guildId: string, sessionId: number, actorId: string): RetroSession
	{
		const session = this.db.transaction((): RetroSession =>
		{
			const row = this.requireRow(guildId, sessionId);
			if (row.content_deleted_at !== null) throw new UserError("Nội dung của phiên retro này đã được xoá trước đó.");
			if (row.status === "open") throw new UserError("Hãy đóng phiên retro trước khi xoá nội dung.");
			if (row.status === "voting") throw new UserError("Phiên đang vote tên sprint (hoặc chờ chọn tên khi hoà): hãy chốt tên xong rồi mới xoá nội dung.");

			const entries = this.db.prepare(
				"UPDATE retro_entries SET learned = NULL, improve = NULL, ideas = NULL, kudos = NULL, sprint_name = NULL WHERE session_id = ?",
			).run(row.id).changes;
			this.db.prepare("UPDATE retro_sessions SET content_deleted_at = ? WHERE id = ?").run(this.deps.clock.now(), row.id);
			this.deps.audit.record(guildId, actorId, "retro.content_delete", row.channel_id, { sessionId: row.id, title: row.title, entries });
			return this.load(row.id);
		})();
		truncateWal(this.db);
		return session;
	}

	startVote(input: { guildId: string; sessionId: number; actorId: string; names?: readonly string[] }): { session: RetroSession; poll: Poll }
	{
		const { guildId, actorId } = input;
		return this.db.transaction((): { session: RetroSession; poll: Poll } =>
		{
			const row = this.requireRow(guildId, input.sessionId);
			if (row.status === "open") throw new UserError("Hãy đóng phiên retro trước khi tạo vote tên sprint.");
			if (row.status === "voting") throw new UserError(`Phiên này đã có vote tên sprint (vote #${row.poll_id ?? "?"}).`);
			if (row.status === "done") throw new UserError("Phiên này đã chốt tên sprint.");
			if (row.content_deleted_at !== null) throw new UserError(`${RETRO_CONTENT_DELETED} Không còn tên để vote.`);

			const names = this.voteNames(this.candidates(row.id), input.names ?? []);
			const config = this.getConfig(guildId);
			const poll = this.polls.create({
				guildId,
				creatorId: actorId,
				question: cutText(`🍀 Đặt tên sprint · Retro ${row.title}`, POLL_LIMITS.questionMax),
				options: names,
				multiSelect: false,
				xpReward: this.deps.guildConfig.getSettings(guildId).defaultPollXp,
				durationMinutes: config.voteMinutes,
			});
			this.db.prepare("UPDATE retro_sessions SET status = 'voting', poll_id = ?, tie_names = NULL WHERE id = ?").run(poll.id, row.id);
			this.deps.audit.record(guildId, actorId, "retro.vote", row.channel_id, { sessionId: row.id, title: row.title, pollId: poll.id, options: names.length });
			return { session: this.load(row.id), poll };
		})();
	}

	cancelVote(guildId: string, sessionId: number, actorId: string): RetroSession
	{
		return this.db.transaction((): RetroSession =>
		{
			const row = this.requireRow(guildId, sessionId);
			if (row.status !== "voting" || row.poll_id === null) throw new UserError("Phiên này không có vote tên sprint để huỷ.");
			const poll = this.polls.get(guildId, row.poll_id);
			if (poll && poll.participants > 0) throw new UserError("Vote tên sprint đã có người bỏ phiếu nên không huỷ được.");
			if (poll && poll.closedAt === null) this.polls.close({ guildId, pollId: poll.id, actorId, actorIsAdmin: true });
			this.db.prepare("UPDATE retro_sessions SET status = 'closed', poll_id = NULL, tie_names = NULL WHERE id = ?").run(row.id);
			return this.load(row.id);
		})();
	}

	finalizeVote(guildId: string, sessionId: number, systemActorId: string): RetroVoteOutcome
	{
		return this.db.transaction((): RetroVoteOutcome =>
		{
			const row = this.requireRow(guildId, sessionId);
			if (row.status !== "voting" || row.poll_id === null || row.tie_names !== null) return { kind: "unchanged", session: this.toSession(row) };
			const poll = this.polls.get(guildId, row.poll_id);
			if (!poll || poll.closedAt === null) return { kind: "unchanged", session: this.toSession(row) };

			const most = Math.max(0, ...poll.options.map(option => option.votes));
			const top = poll.options.filter(option => option.votes === most).map(option => option.label);
			if (top.length === 1) return this.decide(row, top[0], systemActorId);

			this.db.prepare("UPDATE retro_sessions SET tie_names = ? WHERE id = ?").run(JSON.stringify(top), row.id);
			return { kind: "tie", session: this.load(row.id), names: top };
		})();
	}

	pendingVoteResults(): RetroSession[]
	{
		return this.db.prepare<[], SessionRow>(`
			SELECT ${SESSION_COLUMNS}
			FROM retro_sessions s
			JOIN polls p ON p.id = s.poll_id
			WHERE s.status = 'voting' AND s.tie_names IS NULL AND p.closed_at IS NOT NULL
			ORDER BY s.id`,
		).all().map(row => this.toSession(row));
	}

	pickName(input: { guildId: string; sessionId: number; name: string; actorId: string; systemActorId: string }): RetroVoteOutcome
	{
		const { guildId, actorId } = input;
		return this.db.transaction((): RetroVoteOutcome =>
		{
			const row = this.requireRow(guildId, input.sessionId);
			const allowed = this.pickable(row);
			if (allowed.length === 0)
			{
				throw new UserError(row.status === "done"
					? "Phiên này đã chốt tên sprint."
					: "Chỉ chọn tên được khi vote tên sprint hoà, hoặc khi phiên đã đóng mà chỉ có đúng một tên đề xuất.");
			}
			const key = sprintNameKey(input.name);
			const name = allowed.find(candidate => sprintNameKey(candidate) === key);
			if (name === undefined) throw new UserError(`Chỉ chọn được một trong các tên: ${allowed.map(candidate => `"${candidate}"`).join(", ")}.`);

			const outcome = this.decide(row, name, input.systemActorId);
			this.deps.audit.record(guildId, actorId, "retro.pick", row.channel_id, { sessionId: row.id, title: row.title, name });
			return outcome;
		})();
	}

	pickableNames(guildId: string, sessionId: number): string[]
	{
		const row = this.findRow(guildId, sessionId);
		return row ? this.pickable(row) : [];
	}

	recordDocResult(guildId: string, sessionId: number, result: RetroDocResult): RetroSession
	{
		return this.db.transaction((): RetroSession =>
		{
			const row = this.requireRow(guildId, sessionId);
			if (result.ok)
			{
				this.db.prepare("UPDATE retro_sessions SET confluence_written_at = ?, confluence_error = NULL WHERE id = ?").run(this.deps.clock.now(), row.id);
			}
			else
			{
				this.db.prepare("UPDATE retro_sessions SET confluence_error = ? WHERE id = ?").run(Array.from(result.error).slice(0, DOC_ERROR_MAX).join(""), row.id);
			}
			return this.load(row.id);
		})();
	}

	markSummaryPosted(guildId: string, sessionId: number): RetroSession
	{
		return this.db.transaction((): RetroSession =>
		{
			const row = this.requireRow(guildId, sessionId);
			this.db.prepare("UPDATE retro_sessions SET summary_posted_at = ? WHERE id = ?").run(this.deps.clock.now(), row.id);
			return this.load(row.id);
		})();
	}

	pendingSummaries(closedSince: number): RetroSession[]
	{
		return this.db.prepare<[number], SessionRow>(`
			SELECT ${SESSION_COLUMNS}
			FROM retro_sessions s
			WHERE s.status <> 'open' AND s.closed_at IS NOT NULL AND s.closed_at >= ? AND s.summary_posted_at IS NULL
				AND s.message_id IS NOT NULL AND s.content_deleted_at IS NULL
			ORDER BY s.closed_at, s.id`,
		).all(closedSince).map(row => this.toSession(row));
	}

	getConfig(guildId: string): RetroConfig
	{
		const row = this.db.prepare<[string], ConfigRow>("SELECT fill_xp, proposer_bonus_xp, vote_minutes FROM retro_config WHERE guild_id = ?").get(guildId);
		return {
			fillXp: row?.fill_xp ?? DEFAULT_RETRO_CONFIG.fillXp,
			proposerBonusXp: row?.proposer_bonus_xp ?? DEFAULT_RETRO_CONFIG.proposerBonusXp,
			voteMinutes: row?.vote_minutes ?? DEFAULT_RETRO_CONFIG.voteMinutes,
			managerRoleIds: this.managerRoles(guildId),
		};
	}

	updateConfig(guildId: string, patch: Partial<Record<RetroConfigKey, number>>, actorId: string): RetroConfig
	{
		const changes: Partial<Record<RetroConfigKey, number>> = {};
		for (const key of RETRO_CONFIG_KEYS)
		{
			const value = patch[key];
			if (value === undefined) continue;
			validateConfigNumber(key, value);
			changes[key] = value;
		}
		if (Object.keys(changes).length === 0) throw new UserError("Hãy chọn ít nhất một giá trị để thay đổi.");

		this.db.transaction(() =>
		{
			const next = { ...this.getConfig(guildId), ...changes };
			this.db.prepare(`
				INSERT INTO retro_config (guild_id, fill_xp, proposer_bonus_xp, vote_minutes, updated_at)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT (guild_id) DO UPDATE SET
					fill_xp = excluded.fill_xp,
					proposer_bonus_xp = excluded.proposer_bonus_xp,
					vote_minutes = excluded.vote_minutes,
					updated_at = excluded.updated_at`,
			).run(guildId, next.fillXp, next.proposerBonusXp, next.voteMinutes, this.deps.clock.now());
			this.deps.audit.record(guildId, actorId, "retro.config", null, { ...changes });
		})();
		return this.getConfig(guildId);
	}

	changeManagerRoles(guildId: string, change: ManagerRoleChange, actorId: string): ManagerRoleResult
	{
		const add = [...new Set(change.add ?? [])];
		const remove = [...new Set(change.remove ?? [])];
		if (add.some(roleId => remove.includes(roleId))) throw new UserError("Không thể vừa thêm vừa bỏ cùng một role.");

		return this.db.transaction((): ManagerRoleResult =>
		{
			const current = this.managerRoles(guildId);
			const added = add.filter(roleId => !current.includes(roleId));
			const removed = remove.filter(roleId => current.includes(roleId));
			const size = current.length - removed.length + added.length;
			if (added.length > 0 && size > RETRO_LIMITS.managerRolesMax)
			{
				throw new UserError(`Chỉ được đặt tối đa ${RETRO_LIMITS.managerRolesMax} role quản lý retro: đang có ${current.length} role, `
					+ `lưu thay đổi này sẽ thành ${size} role. Bot chưa thay đổi gì.`);
			}
			if (added.length === 0 && removed.length === 0) return { added, removed, roleIds: current };

			const deleteRole = this.db.prepare("DELETE FROM retro_manager_roles WHERE guild_id = ? AND role_id = ?");
			for (const roleId of removed) deleteRole.run(guildId, roleId);
			const insertRole = this.db.prepare("INSERT INTO retro_manager_roles (guild_id, role_id, created_at) VALUES (?, ?, ?)");
			const now = this.deps.clock.now();
			for (const roleId of added) insertRole.run(guildId, roleId, now);
			const roleIds = this.managerRoles(guildId);
			const details: Record<string, unknown> = { managerRoleIds: roleIds };
			if (added.length > 0) details.addedRoles = added;
			if (removed.length > 0) details.removedRoles = removed;
			this.deps.audit.record(guildId, actorId, "retro.config", null, details);
			return { added, removed, roleIds };
		})();
	}

	// ---------- Nội bộ ----------

	/**
	 * Khoá thứ tự của các ô chữ sau khi lưu `answers`: ô đổi chữ (hay phiếu mới) nhận khoá ngẫu nhiên mới, ô giữ nguyên chữ giữ khoá cũ
	 * (sửa một ô không làm đảo thứ tự các cột khác).
	 */
	private orderKeys(answers: RetroAnswers, existing: EntryRow | null): OrderKeys
	{
		const previous = existing ? parseOrderKeys(existing.order_keys) : {};
		const keys: OrderKeys = {};
		for (const field of RETRO_IDEA_FIELDS)
		{
			const kept = existing !== null && answersOf(existing)[field] === answers[field] ? previous[field] : undefined;
			keys[field] = kept ?? this.newOrderKey();
		}
		return keys;
	}

	/** Các ý của một cột chữ, xếp theo khoá ngẫu nhiên riêng của từng ô (trùng khoá thì theo chữ). */
	private ideaColumn(entries: readonly EntryRow[], field: RetroIdeaField): ColumnIdea[]
	{
		return entries
			.flatMap(entry =>
			{
				const text = answersOf(entry)[field];
				return text === null ? [] : [{ entryId: entry.id, text, key: orderKeyOf(parseOrderKeys(entry.order_keys), field, text) }];
			})
			.sort((a, b) => compareText(a.key, b.key) || compareText(a.text, b.text))
			.map(({ entryId, text }) => ({ entryId, text }));
	}

	/** Chốt tên `name` (đúng cách viết của ứng viên): cộng XP cho mọi người đề xuất tên đó, phiên sang "done". Gọi trong transaction. */
	private decide(row: SessionRow, name: string, systemActorId: string): RetroVoteOutcome
	{
		const key = sprintNameKey(name);
		const proposers = this.entryRows(row.id).filter(entry => entry.sprint_name !== null && sprintNameKey(entry.sprint_name) === key);
		const xpEach = this.getConfig(row.guild_id).proposerBonusXp;
		if (xpEach > 0)
		{
			for (const entry of proposers)
			{
				this.deps.xpLedger.record({
					guildId: row.guild_id,
					userId: entry.user_id,
					amount: xpEach,
					source: "admin",
					referenceId: `retro:${row.id}`,
					actorId: systemActorId,
					reason: `Retro ${row.title}: tên sprint được chọn`,
					teamRoleIds: parseStringArray(entry.team_role_ids) ?? [],
				});
			}
		}
		this.db.prepare("UPDATE retro_sessions SET status = 'done', winner_name = ?, tie_names = NULL WHERE id = ?").run(name, row.id);
		return { kind: "winner", session: this.load(row.id), name, proposerIds: proposers.map(entry => entry.user_id), xpEach };
	}

	/** Tên người quản lý chọn được lúc này: các tên hoà, hoặc tên duy nhất của phiên đã đóng chưa có vote. */
	private pickable(row: SessionRow): string[]
	{
		if (row.status === "voting") return parseStringArray(row.tie_names) ?? [];
		if (row.status === "closed" && row.content_deleted_at === null)
		{
			const candidates = this.candidates(row.id);
			return candidates.length === 1 ? [candidates[0].name] : [];
		}
		return [];
	}

	/**
	 * Danh sách tên đưa vào vote: toàn bộ ứng viên, hoặc danh sách rút gọn (mỗi tên phải là ứng viên); 2–10 tên, mỗi tên không dài quá
	 * một lựa chọn vote (UTF-16, như PollService) để lỗi nêu đúng tên cần bỏ.
	 */
	private voteNames(candidates: readonly SprintNameCandidate[], shortlist: readonly string[]): string[]
	{
		if (candidates.length === 0) throw new UserError(RETRO_NO_SPRINT_NAME);
		const max = RETRO_LIMITS.voteOptionsMax;
		const picked = shortlist.map(name => name.trim()).filter(name => name.length > 0);
		let names: string[];
		if (picked.length === 0)
		{
			if (candidates.length === 1)
			{
				throw new UserError(`Chỉ có một tên được đề xuất ("${candidates[0].name}"), không cần vote: người quản lý chốt tên này bằng chức năng chọn tên.`);
			}
			if (candidates.length > max)
			{
				throw new UserError(`Có ${candidates.length} tên được đề xuất, nhưng một vote chỉ có tối đa ${max} lựa chọn. Hãy chọn danh sách `
					+ `rút gọn từ 2 đến ${max} tên (trang Retro của web quản trị, hoặc option rut-gon của /retro vote).`);
			}
			names = candidates.map(candidate => candidate.name);
		}
		else
		{
			const byKey = new Map(candidates.map(candidate => [candidate.key, candidate.name]));
			names = [];
			for (const raw of picked)
			{
				const name = byKey.get(sprintNameKey(raw));
				if (name === undefined) throw new UserError(`"${displaySprintName(raw)}" không có trong các tên được đề xuất.`);
				if (!names.includes(name)) names.push(name);
			}
			if (names.length < 2 || names.length > max) throw new UserError(`Danh sách rút gọn phải có từ 2 đến ${max} tên khác nhau.`);
		}
		const tooLong = names.filter(name => name.length > POLL_LIMITS.optionLabelMax);
		if (tooLong.length > 0)
		{
			throw new UserError(`Tên sprint dài quá ${POLL_LIMITS.optionLabelMax} ký tự (giới hạn một lựa chọn vote) nên không đưa vào vote được: `
				+ `${tooLong.map(name => `"${name}"`).join(", ")}. Hãy xoá tên đó trên trang Retro của web, hoặc chọn danh sách rút gọn không có tên đó.`);
		}
		return names;
	}

	/** Ứng viên tên sprint của phiên: bỏ trùng theo sprintNameKey (giữ cách viết gửi sớm nhất), bỏ tên chỉ toàn số; xếp theo tên. */
	private candidates(sessionId: number): SprintNameCandidate[]
	{
		const byKey = new Map<string, SprintNameCandidate>();
		for (const entry of this.entryRows(sessionId))
		{
			if (entry.sprint_name === null) continue;
			const name = displaySprintName(entry.sprint_name);
			if (name.length === 0 || isNumericOnlyName(name)) continue;
			const key = sprintNameKey(name);
			const found = byKey.get(key);
			if (found) found.proposerIds.push(entry.user_id);
			else byKey.set(key, { name, key, proposerIds: [entry.user_id] });
		}
		return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, "vi") || compareText(a.key, b.key));
	}

	/** Phiếu của phiên theo thứ tự gửi (chỉ dùng nội bộ; nội dung trả ra ngoài luôn đã trộn hoặc xếp theo tên). */
	private entryRows(sessionId: number): EntryRow[]
	{
		return this.db.prepare<[number], EntryRow>("SELECT * FROM retro_entries WHERE session_id = ? ORDER BY submitted_at, id").all(sessionId);
	}

	private managerRoles(guildId: string): string[]
	{
		return this.db.prepare<[string], { role_id: string }>("SELECT role_id FROM retro_manager_roles WHERE guild_id = ? ORDER BY created_at, role_id")
			.all(guildId)
			.map(row => row.role_id);
	}

	private findRow(guildId: string, sessionId: number): SessionRow | null
	{
		if (!Number.isSafeInteger(sessionId)) return null;
		return this.db.prepare<[string, number], SessionRow>(`SELECT ${SESSION_COLUMNS} FROM retro_sessions s WHERE s.guild_id = ? AND s.id = ?`)
			.get(guildId, sessionId) ?? null;
	}

	private requireRow(guildId: string, sessionId: number): SessionRow
	{
		const row = this.findRow(guildId, sessionId);
		if (!row) throw new UserError(RETRO_NOT_FOUND);
		return row;
	}

	private findOpenRow(guildId: string, channelId: string): SessionRow | null
	{
		return this.db.prepare<[string, string], SessionRow>(
			`SELECT ${SESSION_COLUMNS} FROM retro_sessions s WHERE s.guild_id = ? AND s.channel_id = ? AND s.status = 'open'`,
		).get(guildId, channelId) ?? null;
	}

	/** Đọc lại một phiên vừa ghi; không có là lỗi hệ thống (bug). */
	private load(sessionId: number): RetroSession
	{
		const row = this.db.prepare<[number], SessionRow>(`SELECT ${SESSION_COLUMNS} FROM retro_sessions s WHERE s.id = ?`).get(sessionId);
		if (!row) throw new Error(`Không đọc lại được phiên retro ${sessionId} vừa ghi.`);
		return this.toSession(row);
	}

	private toSession(row: SessionRow): RetroSession
	{
		if (!isRetroStatus(row.status)) throw new Error(`Trạng thái phiên retro không hợp lệ trong database: ${row.status}`);
		return {
			id: row.id,
			guildId: row.guild_id,
			title: row.title,
			channelId: row.channel_id,
			messageId: row.message_id,
			teamRoleId: row.team_role_id,
			docUrl: row.doc_url,
			docPageId: row.doc_page_id,
			status: row.status,
			closesAt: row.closes_at,
			createdBy: row.created_by,
			createdAt: row.created_at,
			closedAt: row.closed_at,
			pollId: row.poll_id,
			tieNames: parseStringArray(row.tie_names),
			winnerName: row.winner_name,
			confluenceWrittenAt: row.confluence_written_at,
			confluenceError: row.confluence_error,
			contentDeletedAt: row.content_deleted_at,
			summaryPostedAt: row.summary_posted_at,
			participants: row.participants,
			acceptingAnswers: accepting(row, this.deps.clock.now()),
		};
	}
}
