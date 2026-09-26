export const POLL_LIMITS = {
	questionMin: 3,
	questionMax: 200,
	optionsMin: 2,
	optionsMax: 10,
	optionLabelMax: 80,
	durationMinutesMin: 1,
	durationMinutesMax: 30 * 24 * 60,
} as const;

export interface PollOptionResult
{
	index: number;
	label: string;
	/** Số người chọn lựa chọn này (phiếu ẩn danh: chỉ có số lượng, DEC-026). */
	votes: number;
}

export interface Poll
{
	id: number;
	guildId: string;
	creatorId: string;
	question: string;
	multiSelect: boolean;
	xpReward: number;
	channelId: string | null;
	messageId: string | null;
	closesAt: number | null;
	closedAt: number | null;
	createdAt: number;
	/** Tính tại thời điểm đọc: chưa đóng và chưa quá hạn. */
	open: boolean;
	options: PollOptionResult[];
	/** Số người đã tham gia. */
	participants: number;
}

export interface CreatePollInput
{
	guildId: string;
	creatorId: string;
	question: string;
	options: readonly string[];
	multiSelect: boolean;
	/** XP cho mỗi người tham gia; tầng Discord quyết định giá trị (admin đặt hoặc mặc định của guild). */
	xpReward: number;
	/** null = không tự đóng. */
	durationMinutes: number | null;
}

export interface PollVoteResult
{
	poll: Poll;
	/** Các lựa chọn hiện tại của người vote, tăng dần. */
	selected: number[];
	/** XP vừa được cộng ở lần bấm này (0 nếu đã nhận trước đó, vote không có XP, hoặc đã chạm giới hạn ngày). */
	xpAwarded: number;
	/**
	 * true nếu đây là lần tham gia đầu tiên, vote có XP, nhưng XP bị giảm (kể cả về 0) vì giới hạn XP từ vote trong ngày
	 * (DEC-028). Lượt tham gia vẫn được tính; phần XP bị cắt không được cộng bù về sau.
	 */
	xpCapped: boolean;
	/** Giới hạn XP từ vote mỗi ngày của guild tại thời điểm bấm; 0 = không giới hạn. */
	dailyCap: number;
}

export interface PollServiceApi
{
	/** Validate và tạo vote. Ghi audit "poll.create". UserError nếu không hợp lệ. */
	create(input: CreatePollInput): Poll;
	attachMessage(guildId: string, pollId: number, channelId: string, messageId: string): void;
	get(guildId: string, pollId: number): Poll | null;
	/**
	 * Bấm một lựa chọn. Chọn một: đặt phiếu thành lựa chọn đó. Chọn nhiều: bật/tắt lựa chọn đó.
	 * Lần tham gia đầu tiên được cộng XP (vào Activity XP). UserError nếu vote đã đóng, không tồn tại hoặc lựa chọn sai.
	 */
	vote(input: { guildId: string; pollId: number; userId: string; optionIndex: number; roleIds: readonly string[] }): PollVoteResult;
	/** Người tạo hoặc admin đóng vote. Ghi audit "poll.close". UserError nếu không có quyền hoặc đã đóng. */
	close(input: { guildId: string; pollId: number; actorId: string; actorIsAdmin: boolean }): Poll;
	/** Đóng mọi vote đã quá hạn (mọi guild). Trả về các vote vừa đóng để tầng Discord cập nhật message. */
	closeDue(): Poll[];
	/** Vote đang mở của guild, mới nhất trước. */
	listOpen(guildId: string): Poll[];
}
