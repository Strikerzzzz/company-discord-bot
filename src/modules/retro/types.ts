import { ListPage } from "../../shared/paging";
import { Poll, POLL_LIMITS } from "../poll/types";

/**
 * Trạng thái phiên retro (DEC-049):
 * - "open": đang nhận câu trả lời (tới khi người quản lý đóng hoặc hết hạn);
 * - "closed": đã đóng, chưa có vote tên sprint;
 * - "voting": đã tạo vote tên sprint (vote còn mở, hoặc đã đóng mà hoà và chờ người quản lý chọn);
 * - "done": đã chốt tên sprint.
 */
export type RetroStatus = "open" | "closed" | "voting" | "done";

export const RETRO_STATUSES: readonly RetroStatus[] = ["open", "closed", "voting", "done"];

export function isRetroStatus(value: unknown): value is RetroStatus
{
	return RETRO_STATUSES.some(status => status === value);
}

/** 5 ô của phiếu, theo 5 cột của mẫu retro trên Confluence. */
export type RetroField = "learned" | "improve" | "ideas" | "kudos" | "sprintName";

export const RETRO_FIELDS: readonly RetroField[] = ["learned", "improve", "ideas", "kudos", "sprintName"];

export function isRetroField(value: unknown): value is RetroField
{
	return RETRO_FIELDS.some(field => field === value);
}

/** Tiêu đề 5 cột, đúng như mẫu retro trên Confluence (dùng cho bảng Discord, Confluence và web). */
export const RETRO_FIELD_TITLES: Readonly<Record<RetroField, string>> = {
	learned: "📚 Learned",
	improve: "👎 Thiếu sót",
	ideas: "🔮 Sáng tạo",
	kudos: "👍 Tuyên dương",
	sprintName: "🍀 Đặt tên sprint",
};

export const RETRO_LIMITS = {
	titleMin: 3,
	titleMax: 100,
	/** Mỗi ô Learned / Thiếu sót / Sáng tạo / Tuyên dương, tính theo ký tự (code point). */
	answerMax: 1000,
	/** Ô Đặt tên sprint; bằng độ dài tối đa của một lựa chọn vote. */
	sprintNameMax: POLL_LIMITS.optionLabelMax,
	docUrlMax: 500,
	durationHoursMin: 1,
	durationHoursMax: 30 * 24,
	/** Số role quản lý retro tối đa (bằng số lựa chọn tối đa của menu chọn role của Discord). */
	managerRolesMax: 25,
	/** Số tên tối đa trong một vote tên sprint (bằng số lựa chọn tối đa của vote). */
	voteOptionsMax: POLL_LIMITS.optionsMax,
} as const;

export type RetroConfigKey = "fillXp" | "proposerBonusXp" | "voteMinutes";

export const RETRO_CONFIG_KEYS: readonly RetroConfigKey[] = ["fillXp", "proposerBonusXp", "voteMinutes"];

/** Giới hạn hợp lệ và nhãn tiếng Việt của từng mục cấu hình retro. */
export const RETRO_CONFIG_LIMITS: Readonly<Record<RetroConfigKey, { min: number; max: number; label: string }>> = {
	fillXp: { min: 0, max: 1000, label: "XP khi điền retro" },
	proposerBonusXp: { min: 0, max: 10000, label: "XP cho người đề xuất tên sprint được chọn" },
	voteMinutes: { min: POLL_LIMITS.durationMinutesMin, max: POLL_LIMITS.durationMinutesMax, label: "Thời hạn vote tên sprint (phút)" },
};

export const DEFAULT_RETRO_CONFIG: Readonly<Record<RetroConfigKey, number>> = {
	fillXp: 20,
	proposerBonusXp: 100,
	voteMinutes: 1440,
};

/** Cấu hình retro của một guild. */
export interface RetroConfig
{
	/** XP cộng một lần mỗi phiên cho người điền (0 = không cộng). */
	fillXp: number;
	/** XP cộng cho MỖI người đã đề xuất tên sprint được chọn (0 = không cộng). */
	proposerBonusXp: number;
	/** Thời hạn vote tên sprint, phút. */
	voteMinutes: number;
	/** Role quản lý retro (ngoài admin bot và người tạo phiên), theo thứ tự thêm vào. */
	managerRoleIds: string[];
}

/** Câu trả lời của một phiếu; ô trống là null. */
export interface RetroAnswers
{
	learned: string | null;
	improve: string | null;
	ideas: string | null;
	kudos: string | null;
	sprintName: string | null;
}

export interface RetroSession
{
	id: number;
	guildId: string;
	title: string;
	/** Kênh hoặc thread nơi tạo phiên; mọi tin của phiên được đăng ở đây. */
	channelId: string;
	/** Tin có nút "📝 Điền retro"; null nếu chưa lưu được. */
	messageId: string | null;
	/** Role team được điền; null = ai xem được kênh cũng điền được. */
	teamRoleId: string | null;
	/** Link tài liệu (thường là trang Confluence); null nếu không gắn. */
	docUrl: string | null;
	/** ID trang Confluence đọc từ link; null nếu link không có ID trang. */
	docPageId: string | null;
	status: RetroStatus;
	/** Hạn tự đóng (ms); null = không tự đóng. */
	closesAt: number | null;
	createdBy: string;
	createdAt: number;
	closedAt: number | null;
	/** Vote tên sprint (PollService); null nếu chưa tạo. */
	pollId: number | null;
	/** Các tên hoà khi vote đóng, chờ người quản lý chọn; null nếu không có hoà đang chờ. */
	tieNames: string[] | null;
	winnerName: string | null;
	confluenceWrittenAt: number | null;
	/** Lỗi của lần ghi Confluence gần nhất (tiếng Việt, không chứa token); null nếu lần gần nhất thành công hoặc chưa ghi. */
	confluenceError: string | null;
	contentDeletedAt: number | null;
	/** Số người đã điền. */
	participants: number;
	/** Tính tại thời điểm đọc: status "open" và chưa quá hạn. */
	acceptingAnswers: boolean;
}

/** Một phiếu ẩn danh: không có người viết. `id` là mã phiếu, chỉ dùng để xoá một ý (web), không hiển thị. */
export interface AnonymousRetroEntry extends RetroAnswers
{
	id: number;
}

/** Nội dung ẩn danh gom theo 5 cột; cột "sprintName" là các tên đã bỏ trùng. */
export type RetroColumns = Readonly<Record<RetroField, readonly string[]>>;

/** Một tên sprint ứng viên sau khi bỏ trùng. */
export interface SprintNameCandidate
{
	/** Cách viết đầu tiên (đã bỏ khoảng trắng thừa). */
	name: string;
	/** Khoá so sánh (NFC, gộp khoảng trắng, chữ thường). */
	key: string;
	/** Người đã đề xuất tên này (theo thứ tự gửi). */
	proposerIds: string[];
}

export interface CreateRetroInput
{
	guildId: string;
	/** Kênh hoặc thread nơi chạy lệnh tạo. */
	channelId: string;
	title: string;
	/** Link tài liệu (tuỳ chọn); kiểm tra bằng parseDocLink. */
	docUrl: string | null;
	/** Role team (tuỳ chọn), phải là team đã cấu hình. */
	teamRoleId: string | null;
	/** Tự đóng sau số giờ này; null = không tự đóng. */
	durationHours: number | null;
	createdBy: string;
}

/** Chữ người dùng nhập vào 5 ô (chưa chuẩn hoá); chuỗi rỗng hoặc chỉ có khoảng trắng = ô trống. */
export type RetroAnswersInput = Readonly<Record<RetroField, string>>;

export interface RetroSubmitInput
{
	guildId: string;
	sessionId: number;
	userId: string;
	/** Role hiện có của người điền (kiểm tra role team, snapshot team của XP). */
	roleIds: readonly string[];
	answers: RetroAnswersInput;
	/** ID ghi làm người thao tác của event XP (tầng Discord dùng ID bot). */
	systemActorId: string;
}

export interface RetroSubmitResult
{
	session: RetroSession;
	answers: RetroAnswers;
	/** true nếu đây là lần gửi đầu tiên của người này trong phiên. */
	firstSubmit: boolean;
	/** XP vừa cộng (0 nếu không phải lần đầu hoặc XP điền retro là 0). */
	xpAwarded: number;
}

/** Kết quả chốt vote tên sprint. */
export type RetroVoteOutcome =
	/** Không có gì mới: vote còn mở, phiên không ở trạng thái vote, hoặc đã xử lý trước đó (không cộng XP lần hai). */
	| { kind: "unchanged"; session: RetroSession }
	/** Vote đóng mà hoà: phiên chờ người quản lý chọn một trong `names`. */
	| { kind: "tie"; session: RetroSession; names: string[] }
	/** Vừa chốt tên: mỗi người trong `proposerIds` được cộng `xpEach` XP (0 = không cộng). */
	| { kind: "winner"; session: RetroSession; name: string; proposerIds: string[]; xpEach: number };

export interface RetroListQuery
{
	status: RetroStatus | "all";
	/** Bắt đầu từ 1; ngoài khoảng thì kẹp. */
	page: number;
	/** 1 đến MAX_PAGE_SIZE; ngoài khoảng thì kẹp. */
	pageSize: number;
}

/** Thay đổi danh sách role quản lý retro theo phần chênh lệch. */
export interface ManagerRoleChange
{
	add?: readonly string[];
	remove?: readonly string[];
}

export interface ManagerRoleResult
{
	added: string[];
	removed: string[];
	/** Danh sách sau khi lưu. */
	roleIds: string[];
}

/** Kết quả một lần ghi Confluence, để lưu vào phiên. */
export type RetroDocResult = { ok: true } | { ok: false; error: string };

export interface RetroServiceApi
{
	/** Tạo phiên (kiểm tra tiêu đề, link, team, hạn; một kênh chỉ một phiên đang mở). Audit "retro.create". */
	create(input: CreateRetroInput): RetroSession;
	/** Lưu tin có nút của phiên. UserError nếu không có phiên. */
	attachMessage(guildId: string, sessionId: number, messageId: string): void;
	get(guildId: string, sessionId: number): RetroSession | null;
	/** Phiên đang mở ("open") của một kênh/thread, hoặc null. */
	findOpenInChannel(guildId: string, channelId: string): RetroSession | null;
	/** Phiên tạo gần nhất của một kênh/thread (mọi trạng thái), hoặc null: phiên mà lệnh quản lý không có option id dùng tới. */
	latestInChannel(guildId: string, channelId: string): RetroSession | null;
	/** Phiên có vote tên sprint là `pollId`, hoặc null. */
	findByPoll(guildId: string, pollId: number): RetroSession | null;
	/** Một trang phiên của guild (web), mới nhất trước. */
	listPage(guildId: string, query: RetroListQuery): ListPage<RetroSession>;
	/**
	 * Lưu phiếu của một người (thay cả 5 ô). Lần gửi đầu cộng XP điền retro qua xpLedger (nguồn "admin", người thao tác là
	 * `systemActorId`, snapshot team theo roleIds). UserError nếu phiên không nhận câu trả lời, người điền không có role team, hay ô
	 * không hợp lệ.
	 */
	submit(input: RetroSubmitInput): RetroSubmitResult;
	/** Câu trả lời của chính người đó (điền sẵn form), hoặc null nếu chưa điền. */
	getAnswers(guildId: string, sessionId: number, userId: string): RetroAnswers | null;
	/** User ID của những người đã điền, sắp theo ID (chỉ cho người quản lý / admin; không kèm thời điểm để không đoán được ai viết gì). */
	participants(guildId: string, sessionId: number): string[];
	/** Các phiếu ẩn danh (bỏ phiếu không còn chữ), thứ tự trộn cố định theo phiên (không lộ thứ tự gửi). */
	anonymousEntries(guildId: string, sessionId: number): AnonymousRetroEntry[];
	/** Nội dung ẩn danh gom theo 5 cột, cùng thứ tự với anonymousEntries; cột tên sprint đã bỏ trùng. */
	columns(guildId: string, sessionId: number): RetroColumns;
	/** Tên sprint ứng viên: bỏ trùng (NFC, gộp khoảng trắng, không phân biệt hoa thường), bỏ tên chỉ toàn số; theo thứ tự gửi. */
	sprintNameCandidates(guildId: string, sessionId: number): SprintNameCandidate[];
	/** Người quản lý đóng phiên đang mở. Audit "retro.close". */
	close(guildId: string, sessionId: number, actorId: string): RetroSession;
	/** Đóng mọi phiên quá hạn (mọi guild), không audit. Trả về các phiên vừa đóng. */
	closeDue(): RetroSession[];
	/** Mở lại phiên đã đóng (chưa có vote), hạn mới tuỳ chọn. Audit "retro.reopen". */
	reopen(guildId: string, sessionId: number, actorId: string, durationHours: number | null): RetroSession;
	/** Đặt hạn mới cho phiên đang mở: sau `durationHours` giờ kể từ bây giờ. Audit "retro.extend". */
	extend(guildId: string, sessionId: number, actorId: string, durationHours: number): RetroSession;
	/** Xoá một ý (một ô của một phiếu). Audit "retro.idea_delete" (không ghi người viết). */
	deleteIdea(guildId: string, sessionId: number, entryId: number, field: RetroField, actorId: string): RetroSession;
	/**
	 * Xoá hẳn chữ của mọi phiếu trong phiên (giữ phiên, người đã điền và XP đã cộng). Chỉ khi phiên đã đóng và không còn vote đang
	 * chờ. Audit "retro.content_delete".
	 */
	deleteContent(guildId: string, sessionId: number, actorId: string): RetroSession;
	/**
	 * Tạo vote tên sprint cho phiên đã đóng bằng PollService (chọn một, XP mặc định của server, thời hạn vote_minutes của retro).
	 * `names` là danh sách rút gọn (bắt buộc khi có hơn 10 tên), mỗi tên phải là một ứng viên. Audit "retro.vote".
	 */
	startVote(input: { guildId: string; sessionId: number; actorId: string; names?: readonly string[] }): { session: RetroSession; poll: Poll };
	/** Huỷ vote vừa tạo (khi bot không đăng được tin vote): đóng vote, phiên về "closed". Chỉ khi chưa ai bỏ phiếu. */
	cancelVote(guildId: string, sessionId: number, actorId: string): RetroSession;
	/**
	 * Chốt vote tên sprint sau khi vote đóng: nhiều phiếu nhất thắng (cộng XP người đề xuất); hoà thì chờ người quản lý chọn.
	 * Gọi lại nhiều lần an toàn (không cộng XP lần hai).
	 */
	finalizeVote(guildId: string, sessionId: number, systemActorId: string): RetroVoteOutcome;
	/** Phiên đang "voting" có vote đã đóng mà chưa chốt và chưa ghi nhận hoà (mọi guild): lịch quét chốt nốt. */
	pendingVoteResults(): RetroSession[];
	/**
	 * Người quản lý chọn tên: khi vote hoà (trong các tên hoà), hoặc khi phiên đã đóng mà chỉ có đúng một tên đề xuất.
	 * Cộng XP người đề xuất như khi thắng vote. Audit "retro.pick".
	 */
	pickName(input: { guildId: string; sessionId: number; name: string; actorId: string; systemActorId: string }): RetroVoteOutcome;
	/** Các tên người quản lý chọn được bằng pickName lúc này (rỗng nếu không chọn được). */
	pickableNames(guildId: string, sessionId: number): string[];
	/** Lưu kết quả lần ghi Confluence. */
	recordDocResult(guildId: string, sessionId: number, result: RetroDocResult): RetroSession;
	getConfig(guildId: string): RetroConfig;
	/** Lưu các mục XP/thời hạn trong `patch`. Audit "retro.config" với đúng các mục đó. */
	updateConfig(guildId: string, patch: Partial<Record<RetroConfigKey, number>>, actorId: string): RetroConfig;
	/** Thêm/bỏ role quản lý retro theo phần chênh lệch (tối đa 25). Có thay đổi thì audit "retro.config". */
	changeManagerRoles(guildId: string, change: ManagerRoleChange, actorId: string): ManagerRoleResult;
}
