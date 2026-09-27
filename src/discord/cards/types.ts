import { LevelInfo } from "../../modules/activity/levels";
import { Tier, TierSet } from "../../modules/activity/tiers";

/*
 * Dữ liệu đầu vào của ảnh thẻ (DEC-030). Hàm vẽ chỉ nhận dữ liệu đã chuẩn bị sẵn (tên hiển thị, bytes avatar, chuỗi đã định dạng),
 * không gọi service, database hay mạng. Ảnh không vẽ được emoji (font không có), nên dữ liệu ở đây không chứa emoji;
 * tầng gọi (command) đặt emoji ở phần chữ của tin nhắn đi kèm.
 */

/** Bytes ảnh avatar (PNG/JPEG/WebP) đã tải sẵn; null = vẽ chữ cái đầu của tên trên nền màu. */
export type AvatarImage = Buffer | null;

export interface RankCardData
{
	/** Tên hiển thị trong server (nickname hoặc display name); có thể chứa ký tự font không hỗ trợ. */
	displayName: string;
	avatar: AvatarImage;
	level: LevelInfo;
	/** Bộ danh hiệu guild đang dùng (DEC-033): giọng văn trên thẻ (texts.maxTier, texts.idleToday, texts.tierLabel) và kiểu trang trí theo bộ. */
	tierSet: TierSet;
	tier: Tier;
	/** null nếu đã ở cảnh giới cao nhất. */
	nextTier: Tier | null;
	activity: {
		/** Hạng tổng Activity XP; null nếu chưa có XP. */
		rank: number | null;
		totalRanked: number;
		/** Activity XP tuần này (từ thứ Hai, giờ Việt Nam). */
		weeklyXp: number;
		/** Hạng tuần; null nếu tuần này chưa có XP. */
		weeklyRank: number | null;
	};
	contribution: {
		score: number;
		rank: number | null;
		totalRanked: number;
		/** Số contribution còn hiệu lực. */
		contributions: number;
	};
	streak: {
		current: number;
		best: number;
		activeToday: boolean;
	};
	achievements: {
		unlocked: number;
		total: number;
	};
	/** Tên các role team (không phải mention), có thể rỗng. */
	teamNames: string[];
}

export interface LeaderboardCardRow
{
	rank: number;
	/** Tên hiển thị của người (hoặc tên role của team). */
	name: string;
	/** Avatar của người; null với team hoặc khi không tải được. */
	avatar: AvatarImage;
	/** Điểm đã định dạng, ví dụ "68.420 XP" hoặc "12 điểm". */
	value: string;
	/** Dòng phụ đã định dạng, ví dụ "Lv 31"; null nếu không có. */
	detail: string | null;
	/** Cảnh giới (theo level tổng) cho bảng Activity cá nhân; null với bảng khác. */
	tier: Tier | null;
	/** Màu nhấn "#rrggbb" (ví dụ màu role của team); null = dùng màu mặc định. */
	accentColor: string | null;
	/** true = dòng của người đang xem, vẽ nổi bật. */
	highlight: boolean;
}

export interface LeaderboardCardData
{
	/** Tiêu đề lớn, ví dụ "BẢNG XẾP HẠNG · ACTIVITY XP". */
	title: string;
	/** Dòng phụ, ví dụ "Cá nhân · Tuần này (từ 29/09)". */
	subtitle: string;
	/** Tối đa 10 dòng, đã sắp theo hạng. */
	rows: LeaderboardCardRow[];
	/** Chân ảnh, ví dụ "Trang 1/4 · 37 người". */
	footer: string;
	/** Chữ hiển thị khi rows rỗng, ví dụ "Chưa có ai trên bảng này". */
	emptyText: string;
}

/** Ảnh đã vẽ, gửi lên Discord dưới dạng file đính kèm. */
export interface RenderedCard
{
	png: Buffer;
	/** Tên file đính kèm (chỉ gồm a-z, 0-9, "-", kết thúc bằng ".png"), ví dụ "rank.png". */
	fileName: string;
	width: number;
	height: number;
}
