import { Statement } from "better-sqlite3";
import { Db } from "../../db/connection";
import { Clock } from "../../shared/clock";
import { UserError } from "../../shared/errors";
import {
	applyTierOverrides,
	DEFAULT_TIER_SET_KEY,
	isTierKey,
	isTierSetKey,
	TIER_SET_KEYS,
	TIER_SETS,
	TierKey,
	TierNameOverride,
	TierSet,
	TierSetKey,
	tierIndex,
} from "../activity/tiers";
import { AuditService } from "../audit/AuditService";

/** Thành viên chọn một bộ khi admin đang tắt tự chọn (DEC-047). */
export const PERSONAL_TIER_DISABLED = "Admin đang tắt tính năng tự chọn: server đang dùng một bộ danh hiệu chung cho mọi người.";
export const INVALID_TIER_SET_KEY = "Bộ danh hiệu không hợp lệ.";

/** Nguồn bộ danh hiệu hiển thị của một thành viên (DEC-047): lựa chọn của chính người đó, hoặc bộ chung của server. */
export type TierDisplaySource = "personal" | "server";

/** Bộ danh hiệu hiển thị của một thành viên (DEC-047) và các thông tin để giải thích vì sao. */
export interface MemberTierDisplay
{
	/** Bộ dùng cho thẻ /rank và lời chúc lên level/lên bậc của người này, đã áp tên/emoji tuỳ chỉnh của server cho bộ đó. */
	set: TierSet;
	/** "personal" = đang dùng lựa chọn của người này; "server" = bộ chung (chưa chọn, hoặc admin đang tắt tự chọn). */
	source: TierDisplaySource;
	/** Lựa chọn đã lưu của người này, kể cả khi admin đang tắt tự chọn; null = theo server (khoá lạ trong DB cũng là null). */
	choiceKey: TierSetKey | null;
	/** Công tắc "cho phép thành viên tự chọn bộ danh hiệu" của server. */
	allowPersonal: boolean;
	/** Bộ chung của server (đã áp tên tuỳ chỉnh): role Discord, bảng xếp hạng và Bảng vàng luôn theo bộ này. */
	serverSet: TierSet;
}

/** Số thành viên đang lưu lựa chọn một bộ (kể cả khi admin đang tắt tự chọn). */
export interface TierSetChoiceCount
{
	setKey: TierSetKey;
	count: number;
}

/** Giới hạn tên bậc tuỳ chỉnh (tính theo ký tự hiển thị). */
export const TIER_NAME_MAX = 32;
/** Giới hạn tên bậc tính theo đơn vị UTF-16 (cách Discord đếm độ dài), để ký tự ghép dài không làm vỡ giới hạn. */
export const TIER_NAME_MAX_UTF16 = 48;
const EMOJI_MAX_UTF16 = 16;
/** Số dấu kết hợp tối đa trên một ký tự hiển thị: tiếng Việt cần tối đa 2 (ví dụ "Ặ" khi chưa ghép NFC), nhiều hơn là chữ Zalgo. */
const MARKS_PER_GRAPHEME_MAX = 2;

// Ký tự làm hỏng định dạng tin nhắn (markdown, mention).
const FORBIDDEN_NAME_CHARS = /[<>@*_~`|\\[\]]/u;
// Ký tự điều khiển, ký tự vô hình (Default_Ignorable) và ký tự trống trông như chữ (braille trống, Hangul filler).
const INVISIBLE_CHARS = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2800\u3164\uFFA0\u115F\u1160]/u;
// Dấu bao quanh (ví dụ U+20E3 keycap, U+20E0) biến chữ thường thành hình giống emoji.
const ENCLOSING_MARK = /\p{Me}/u;
const COMBINING_MARK = /\p{M}/gu;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;
// Đúng một emoji Unicode chuẩn (RGI): nhận keycap, cờ, chuỗi ZWJ; từ chối emoji kèm ZWNJ, tag hay dấu kết hợp thừa.
// Tạo bằng constructor vì TypeScript target ES2022 không nhận regex literal có cờ "v" (Node 22 hỗ trợ).
const RGI_EMOJI = new RegExp("^\\p{RGI_Emoji}$", "v");
// Link và lời mời vào server Discord (so sánh không phân biệt hoa thường).
const LINK_PATTERNS = ["://", "www.", "discord.gg", "discord.com/invite", "discordapp.com/invite"] as const;
const WHITESPACE = /\s+/gu;
const graphemes = new Intl.Segmenter("vi", { granularity: "grapheme" });

/** Một thay đổi tên/emoji của một bậc; name/emoji null = dùng mặc định của bộ. */
export interface TierRenameInput
{
	tierKey: TierKey;
	name: string | null;
	emoji: string | null;
}

export interface TierSetServiceApi
{
	/** Khoá bộ guild đang dùng (mặc định "tu-tien"). */
	currentKey(guildId: string): TierSetKey;
	/** Bộ guild đang dùng, đã áp tên/emoji tuỳ chỉnh của bộ đó. */
	current(guildId: string): TierSet;
	/** Tên/emoji tuỳ chỉnh của một bộ trong guild, theo thứ tự bậc. */
	overrides(guildId: string, setKey: TierSetKey): TierNameOverride[];
	/**
	 * Chọn bộ danh hiệu. Tên tuỳ chỉnh lưu theo từng bộ nên đổi qua lại không mất. Chọn lại bộ đang dùng thì không làm gì.
	 * Ghi audit "tier_set.set" (target null, details { from, to }). UserError nếu khoá bộ không hợp lệ.
	 */
	select(guildId: string, setKey: TierSetKey, actorId: string): TierSet;
	/**
	 * Đổi tên/emoji một hoặc nhiều bậc của bộ đang dùng, trong một transaction: validate hết rồi mới ghi, lỗi thì không ghi gì.
	 * Cả name và emoji null = xoá tuỳ chỉnh của bậc đó. Mỗi bậc thực sự đổi ghi một audit "tier_name.set"
	 * (target null, details { setKey, tierKey, name, emoji }). UserError nếu tên/emoji không hợp lệ.
	 */
	rename(guildId: string, entries: readonly TierRenameInput[], actorId: string): TierSet;
	/** Xoá mọi tên tuỳ chỉnh của bộ đang dùng. Ghi audit "tier_name.reset" (details { setKey, count }) nếu có gì để xoá. */
	resetNames(guildId: string, actorId: string): TierSet;
	/** Công tắc "cho phép thành viên tự chọn bộ danh hiệu" (DEC-047); mặc định bật. */
	allowPersonal(guildId: string): boolean;
	/**
	 * Bật/tắt cho phép thành viên tự chọn bộ. Lựa chọn đã lưu không bị xoá khi tắt. Giá trị không đổi thì không ghi gì và trả false;
	 * đổi thì ghi audit "tier_pref.allow" (target null, details { allowPersonal }) và trả true.
	 */
	setAllowPersonal(guildId: string, allowed: boolean, actorId: string): boolean;
	/** Bộ thành viên đã tự chọn (kể cả khi admin đang tắt tự chọn); null = theo server, hoặc khoá lạ trong DB. */
	memberChoice(guildId: string, userId: string): TierSetKey | null;
	/** Bộ danh hiệu hiển thị của một thành viên: bộ tự chọn nếu có và server cho phép, không thì bộ chung. */
	displayFor(guildId: string, userId: string): MemberTierDisplay;
	/**
	 * Thành viên tự chọn bộ cho chính mình (lệnh /rank-style), không ghi audit. `setKey` null = về theo server (xoá lựa chọn,
	 * luôn được). UserError nếu khoá bộ không hợp lệ, hoặc chọn một bộ khi admin đang tắt tự chọn (không ghi gì).
	 */
	chooseForMember(guildId: string, userId: string, setKey: TierSetKey | null): MemberTierDisplay;
	/**
	 * Admin xoá lựa chọn của một thành viên (người đó về theo server). Có lựa chọn thì ghi audit "tier_pref.clear"
	 * (target = userId, details { setKey } là khoá đã lưu) và trả khoá đó; không có thì không ghi gì và trả null.
	 */
	clearMemberChoice(guildId: string, userId: string, actorId: string): string | null;
	/** Số thành viên đang lưu lựa chọn từng bộ, theo thứ tự TIER_SET_KEYS (bộ không ai chọn là 0; khoá lạ không tính). */
	choiceCounts(guildId: string): TierSetChoiceCount[];
}

interface OverrideRow
{
	tier_key: string;
	name: string | null;
	emoji: string | null;
}

function graphemeList(text: string): string[]
{
	return Array.from(graphemes.segment(text), segment => segment.segment);
}

/** Đúng một emoji Unicode chuẩn (RGI), không kèm ký tự hay dấu thừa. */
function isRgiEmoji(text: string): boolean
{
	return RGI_EMOJI.test(text);
}

/** Ký tự hiển thị mang dáng emoji: emoji RGI, hoặc có ký tự mặc định hiện dạng emoji (™, © thì không). */
function looksLikeEmoji(grapheme: string): boolean
{
	return isRgiEmoji(grapheme) || EMOJI_PRESENTATION.test(grapheme);
}

function markCount(grapheme: string): number
{
	return grapheme.match(COMBINING_MARK)?.length ?? 0;
}

function containsLink(name: string): boolean
{
	const lower = name.toLowerCase();
	return LINK_PATTERNS.some(pattern => lower.includes(pattern));
}

/**
 * Tách chuỗi admin nhập (ví dụ "🟡 Kim Đan") thành emoji đầu chuỗi và tên. Chuỗi rỗng → cả hai null (dùng mặc định).
 * Emoji đầu chuỗi phải là đúng một emoji RGI (cùng tiêu chí với `normalizeTierEmoji`); nếu không, cả chuỗi là tên.
 * Không validate; gọi `rename` để kiểm tra.
 */
export function parseTierDisplayName(raw: string): { emoji: string | null; name: string | null }
{
	const text = raw.normalize("NFC").trim();
	if (text === "") return { emoji: null, name: null };
	const [first, ...rest] = graphemeList(text);
	if (first !== undefined && isRgiEmoji(first))
	{
		const name = rest.join("").trim();
		return { emoji: first, name: name === "" ? null : name };
	}
	return { emoji: null, name: text };
}

/** Tên bậc đã chuẩn hoá (NFC, gộp khoảng trắng), hoặc UserError nếu không hợp lệ. */
export function normalizeTierName(raw: string): string
{
	const name = raw.normalize("NFC").replace(WHITESPACE, " ").trim();
	const parts = graphemeList(name);
	if (parts.length === 0 || parts.length > TIER_NAME_MAX) throw new UserError(`Tên bậc phải dài từ 1 đến ${TIER_NAME_MAX} ký tự.`);
	if (FORBIDDEN_NAME_CHARS.test(name)) throw new UserError("Tên bậc không được chứa các ký tự < > @ * _ ~ ` | \\ [ ] hoặc ký tự điều khiển.");
	// Kiểm tra emoji trước ký tự vô hình: emoji ZWJ hay emoji kèm U+FE0F chứa ký tự vô hình, báo "chứa emoji" thì dễ hiểu hơn.
	if (parts.some(looksLikeEmoji)) throw new UserError("Tên bậc không được chứa emoji; hãy đặt emoji ở đầu (ví dụ \"🟡 Kim Đan\").");
	if (INVISIBLE_CHARS.test(name))
	{
		throw new UserError("Tên bậc không được chứa ký tự điều khiển, ký tự vô hình hoặc ký tự trống trông như khoảng trắng.");
	}
	if (ENCLOSING_MARK.test(name) || parts.some(part => markCount(part) > MARKS_PER_GRAPHEME_MAX))
	{
		throw new UserError(`Tên bậc không được chồng quá ${MARKS_PER_GRAPHEME_MAX} dấu lên một chữ hoặc dùng dấu bao quanh ký tự.`);
	}
	if (containsLink(name)) throw new UserError("Tên bậc không được chứa đường link hay lời mời vào server Discord.");
	if (!LETTER_OR_DIGIT.test(name)) throw new UserError("Tên bậc phải có ít nhất một chữ cái hoặc chữ số.");
	if (name.length > TIER_NAME_MAX_UTF16)
	{
		throw new UserError("Tên bậc quá dài: một số ký tự đặc biệt được Discord tính như 2 ký tự, hãy rút ngắn tên.");
	}
	return name;
}

/** Emoji của bậc (đúng một emoji Unicode chuẩn), hoặc UserError nếu không hợp lệ. */
export function normalizeTierEmoji(raw: string): string
{
	const emoji = raw.normalize("NFC").trim();
	if (emoji.length > EMOJI_MAX_UTF16 || !isRgiEmoji(emoji))
	{
		throw new UserError("Emoji của bậc phải là đúng một emoji Unicode chuẩn, không kèm ký tự hay dấu thừa (emoji riêng của server không dùng được).");
	}
	return emoji;
}

/**
 * Bộ danh hiệu của từng guild (DEC-033): chọn một trong các bộ có sẵn, đổi tên/emoji từng bậc. Mốc level và màu luôn theo bộ.
 * Thêm bộ hiển thị cá nhân (DEC-047): mỗi thành viên tự chọn bộ cho thẻ /rank và lời chúc lên level của mình, khi server cho
 * phép (cột tier_set_config.allow_personal). Đây là cấu hình (không phải điểm), nên xoá tuỳ chỉnh hay lựa chọn thì xoá dòng.
 */
export class TierSetService implements TierSetServiceApi
{
	private readonly selectConfig: Statement<[string], { set_key: string }>;
	private readonly upsertConfig: Statement<[string, string, number]>;
	private readonly selectOverrides: Statement<[string, string], OverrideRow>;
	private readonly upsertOverride: Statement<[string, string, string, string | null, string | null, number]>;
	private readonly deleteOverride: Statement<[string, string, string]>;
	private readonly deleteOverrides: Statement<[string, string]>;
	private readonly selectAllowPersonal: Statement<[string], { allow_personal: number }>;
	private readonly upsertAllowPersonal: Statement<[string, string, number, number]>;
	private readonly selectChoice: Statement<[string, string], { set_key: string }>;
	private readonly upsertChoice: Statement<[string, string, string, number]>;
	private readonly deleteChoice: Statement<[string, string]>;
	private readonly countChoices: Statement<[string], { set_key: string; n: number }>;

	constructor(private readonly db: Db, private readonly clock: Clock, private readonly audit: AuditService)
	{
		this.selectConfig = db.prepare("SELECT set_key FROM tier_set_config WHERE guild_id = ?");
		this.upsertConfig = db.prepare(`
			INSERT INTO tier_set_config (guild_id, set_key, updated_at) VALUES (?, ?, ?)
			ON CONFLICT (guild_id) DO UPDATE SET set_key = excluded.set_key, updated_at = excluded.updated_at`);
		this.selectOverrides = db.prepare("SELECT tier_key, name, emoji FROM tier_name_overrides WHERE guild_id = ? AND set_key = ?");
		this.upsertOverride = db.prepare(`
			INSERT INTO tier_name_overrides (guild_id, set_key, tier_key, name, emoji, updated_at) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (guild_id, set_key, tier_key) DO UPDATE SET name = excluded.name, emoji = excluded.emoji, updated_at = excluded.updated_at`);
		this.deleteOverride = db.prepare("DELETE FROM tier_name_overrides WHERE guild_id = ? AND set_key = ? AND tier_key = ?");
		this.deleteOverrides = db.prepare("DELETE FROM tier_name_overrides WHERE guild_id = ? AND set_key = ?");
		this.selectAllowPersonal = db.prepare("SELECT allow_personal FROM tier_set_config WHERE guild_id = ?");
		// Guild chưa có dòng thì tạo dòng với bộ đang dùng (mặc định); dòng đã có chỉ đổi công tắc, giữ nguyên bộ.
		this.upsertAllowPersonal = db.prepare(`
			INSERT INTO tier_set_config (guild_id, set_key, updated_at, allow_personal) VALUES (?, ?, ?, ?)
			ON CONFLICT (guild_id) DO UPDATE SET allow_personal = excluded.allow_personal, updated_at = excluded.updated_at`);
		this.selectChoice = db.prepare("SELECT set_key FROM member_tier_prefs WHERE guild_id = ? AND user_id = ?");
		this.upsertChoice = db.prepare(`
			INSERT INTO member_tier_prefs (guild_id, user_id, set_key, updated_at) VALUES (?, ?, ?, ?)
			ON CONFLICT (guild_id, user_id) DO UPDATE SET set_key = excluded.set_key, updated_at = excluded.updated_at`);
		this.deleteChoice = db.prepare("DELETE FROM member_tier_prefs WHERE guild_id = ? AND user_id = ?");
		this.countChoices = db.prepare("SELECT set_key, COUNT(*) AS n FROM member_tier_prefs WHERE guild_id = ? GROUP BY set_key");
	}

	currentKey(guildId: string): TierSetKey
	{
		const stored = this.selectConfig.get(guildId)?.set_key;
		// Khoá lạ (sửa tay DB, hoặc bộ đã bị bỏ ở phiên bản sau) thì quay về bộ mặc định.
		return stored !== undefined && isTierSetKey(stored) ? stored : DEFAULT_TIER_SET_KEY;
	}

	current(guildId: string): TierSet
	{
		const key = this.currentKey(guildId);
		return applyTierOverrides(TIER_SETS[key], this.overrides(guildId, key));
	}

	overrides(guildId: string, setKey: TierSetKey): TierNameOverride[]
	{
		return this.selectOverrides.all(guildId, setKey)
			.filter((row): row is OverrideRow & { tier_key: TierKey } => isTierKey(row.tier_key))
			.map(row => ({ tierKey: row.tier_key, name: row.name, emoji: row.emoji }))
			.sort((a, b) => tierIndex(a.tierKey) - tierIndex(b.tierKey));
	}

	select(guildId: string, setKey: TierSetKey, actorId: string): TierSet
	{
		if (!isTierSetKey(setKey)) throw new UserError(INVALID_TIER_SET_KEY);
		return this.db.transaction((): TierSet =>
		{
			const from = this.currentKey(guildId);
			if (from !== setKey || this.selectConfig.get(guildId) === undefined)
			{
				this.upsertConfig.run(guildId, setKey, this.clock.now());
				if (from !== setKey) this.audit.record(guildId, actorId, "tier_set.set", null, { from, to: setKey });
			}
			return this.current(guildId);
		})();
	}

	rename(guildId: string, entries: readonly TierRenameInput[], actorId: string): TierSet
	{
		const normalized = entries.map(entry =>
		{
			if (!isTierKey(entry.tierKey)) throw new UserError("Bậc danh hiệu không hợp lệ.");
			return {
				tierKey: entry.tierKey,
				name: entry.name === null || entry.name.trim() === "" ? null : normalizeTierName(entry.name),
				emoji: entry.emoji === null || entry.emoji.trim() === "" ? null : normalizeTierEmoji(entry.emoji),
			};
		});
		const keys = new Set(normalized.map(entry => entry.tierKey));
		if (keys.size !== normalized.length) throw new UserError("Mỗi bậc chỉ được đổi tên một lần trong cùng một lần lưu.");

		return this.db.transaction((): TierSet =>
		{
			const setKey = this.currentKey(guildId);
			const existing = new Map(this.overrides(guildId, setKey).map(override => [override.tierKey, override]));
			const now = this.clock.now();
			for (const entry of normalized)
			{
				const before = existing.get(entry.tierKey);
				if ((before?.name ?? null) === entry.name && (before?.emoji ?? null) === entry.emoji) continue;
				if (entry.name === null && entry.emoji === null) this.deleteOverride.run(guildId, setKey, entry.tierKey);
				else this.upsertOverride.run(guildId, setKey, entry.tierKey, entry.name, entry.emoji, now);
				this.audit.record(guildId, actorId, "tier_name.set", null, { setKey, tierKey: entry.tierKey, name: entry.name, emoji: entry.emoji });
			}
			return this.current(guildId);
		})();
	}

	resetNames(guildId: string, actorId: string): TierSet
	{
		return this.db.transaction((): TierSet =>
		{
			const setKey = this.currentKey(guildId);
			const count = this.deleteOverrides.run(guildId, setKey).changes;
			if (count > 0) this.audit.record(guildId, actorId, "tier_name.reset", null, { setKey, count });
			return this.current(guildId);
		})();
	}

	allowPersonal(guildId: string): boolean
	{
		return (this.selectAllowPersonal.get(guildId)?.allow_personal ?? 1) !== 0;
	}

	setAllowPersonal(guildId: string, allowed: boolean, actorId: string): boolean
	{
		return this.db.transaction((): boolean =>
		{
			if (this.allowPersonal(guildId) === allowed) return false;
			this.upsertAllowPersonal.run(guildId, this.currentKey(guildId), this.clock.now(), allowed ? 1 : 0);
			this.audit.record(guildId, actorId, "tier_pref.allow", null, { allowPersonal: allowed });
			return true;
		})();
	}

	memberChoice(guildId: string, userId: string): TierSetKey | null
	{
		const stored = this.selectChoice.get(guildId, userId)?.set_key;
		// Khoá lạ (sửa tay DB, hoặc bộ đã bị bỏ ở phiên bản sau) thì coi như theo server.
		return stored !== undefined && isTierSetKey(stored) ? stored : null;
	}

	displayFor(guildId: string, userId: string): MemberTierDisplay
	{
		const serverSet = this.current(guildId);
		const choiceKey = this.memberChoice(guildId, userId);
		const allowPersonal = this.allowPersonal(guildId);
		if (choiceKey === null || !allowPersonal) return { set: serverSet, source: "server", choiceKey, allowPersonal, serverSet };
		const set = choiceKey === serverSet.key ? serverSet : applyTierOverrides(TIER_SETS[choiceKey], this.overrides(guildId, choiceKey));
		return { set, source: "personal", choiceKey, allowPersonal, serverSet };
	}

	chooseForMember(guildId: string, userId: string, setKey: TierSetKey | null): MemberTierDisplay
	{
		if (setKey !== null && !isTierSetKey(setKey)) throw new UserError(INVALID_TIER_SET_KEY);
		return this.db.transaction((): MemberTierDisplay =>
		{
			if (setKey === null)
			{
				this.deleteChoice.run(guildId, userId);
			}
			else
			{
				if (!this.allowPersonal(guildId)) throw new UserError(PERSONAL_TIER_DISABLED);
				this.upsertChoice.run(guildId, userId, setKey, this.clock.now());
			}
			return this.displayFor(guildId, userId);
		})();
	}

	clearMemberChoice(guildId: string, userId: string, actorId: string): string | null
	{
		return this.db.transaction((): string | null =>
		{
			const stored = this.selectChoice.get(guildId, userId)?.set_key;
			if (stored === undefined) return null;
			this.deleteChoice.run(guildId, userId);
			this.audit.record(guildId, actorId, "tier_pref.clear", userId, { setKey: stored });
			return stored;
		})();
	}

	choiceCounts(guildId: string): TierSetChoiceCount[]
	{
		const counts = new Map(this.countChoices.all(guildId).map(row => [row.set_key, row.n]));
		return TIER_SET_KEYS.map(setKey => ({ setKey, count: counts.get(setKey) ?? 0 }));
	}
}
