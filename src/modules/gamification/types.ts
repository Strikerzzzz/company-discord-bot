import { LevelInfo } from "../activity/levels";
import { Tier, TierKey, TierSet } from "../activity/tiers";

/**
 * Chuỗi ngày hoạt động (DEC-029): số ngày liên tiếp (theo giờ Việt Nam) có ít nhất một tin nhắn được Activity XP.
 * Chỉ tính event nguồn "message" chưa huỷ, nên reset XP cũng xoá chuỗi. Chỉ để hiển thị, không cộng XP.
 */
export interface StreakInfo
{
	/**
	 * Chuỗi hiện tại. Còn giữ nếu ngày hoạt động gần nhất là hôm nay hoặc hôm qua (hôm nay chưa nhắn thì chuỗi chưa mất);
	 * về 0 nếu đã bỏ lỡ trọn một ngày.
	 */
	current: number;
	/** Chuỗi dài nhất từng có (luôn >= current). */
	best: number;
	/** Hôm nay (giờ Việt Nam) đã có tin được XP chưa. */
	activeToday: boolean;
	/** Số thứ tự ngày (src/shared/time.ts vnDayNumber) của ngày hoạt động gần nhất; null nếu chưa từng. */
	lastActiveDay: number | null;
}

/** Chỉ số dùng để xét huy hiệu. Mọi số đếm chỉ tính dữ liệu còn hiệu lực trong guild. */
export interface AchievementStats
{
	/** Số lần được XP từ tin nhắn (event "message" chưa huỷ). */
	messages: number;
	/** Chuỗi ngày hoạt động dài nhất. */
	bestStreak: number;
	/** Số lượt được người khác ghi nhận (event contribution nguồn "vote" chưa huỷ của người này). */
	recognitionsReceived: number;
	/** Số lượt người này ghi nhận người khác mà điểm còn hiệu lực (dòng contribution_votes có event chưa huỷ). */
	recognitionsGiven: number;
	/** Số vote người này đã tham gia (poll_participants). */
	pollsJoined: number;
	/** Số contribution còn hiệu lực người này là tác giả. */
	contributions: number;
}

export type AchievementStat = keyof AchievementStats;

export interface AchievementDefinition
{
	/** Khoá ổn định, kebab-case, không dấu. */
	key: string;
	/** Emoji hiển thị trong tin nhắn. */
	emoji: string;
	name: string;
	/** Điều kiện đạt, viết cho người dùng đọc. */
	description: string;
	stat: AchievementStat;
	/** Đạt khi stats[stat] >= threshold. */
	threshold: number;
}

export interface AchievementProgress
{
	achievement: AchievementDefinition;
	unlocked: boolean;
	/** Giá trị hiện tại của chỉ số (stats[achievement.stat]). */
	current: number;
}

export interface GamificationProfile
{
	userId: string;
	level: LevelInfo;
	/**
	 * Bộ danh hiệu hiển thị của người này (đã áp tên tuỳ chỉnh của server): bộ người đó tự chọn nếu server cho phép, không thì bộ
	 * guild đang dùng (DEC-033, DEC-047). Chỉ dùng cho thẻ /rank; role, bảng xếp hạng và Bảng vàng theo bộ của guild.
	 */
	tierSet: TierSet;
	/** Bậc theo level trong bộ hiển thị. */
	tier: Tier;
	/** null nếu đã ở bậc cao nhất. */
	nextTier: Tier | null;
	streak: StreakInfo;
	stats: AchievementStats;
	/** Đúng thứ tự của ACHIEVEMENTS (src/modules/gamification/achievements.ts), gồm cả huy hiệu chưa đạt. */
	achievements: AchievementProgress[];
	/** Activity XP tuần này (từ 00:00 thứ Hai giờ Việt Nam) và hạng tuần; rank null nếu tuần này chưa có XP. */
	weekly: { xp: number; rank: number | null };
}

export interface GamificationServiceApi
{
	/** Hồ sơ gamification của một người, theo bộ danh hiệu hiển thị của người đó (người chưa có dữ liệu vẫn trả hồ sơ với số 0). */
	profile(guildId: string, userId: string): GamificationProfile;
}

/** Role Discord gán cho một cảnh giới (DEC-031). */
export interface TierRoleMapping
{
	tierKey: TierKey;
	roleId: string;
	/** true nếu role do bot tự tạo bằng chức năng tạo/đồng bộ role (DEC-033). */
	createdByBot: boolean;
}

/** Kết quả một lần tạo/đồng bộ role theo bộ danh hiệu, để ghi audit "tier_role.setup". */
export interface TierRoleSetupSummary
{
	setKey: string;
	/** Số role bot vừa tạo mới (kể cả tạo lại cho role đã gán nhưng không còn trong server). */
	created: number;
	/** Số role do bot tạo được đổi tên/màu theo bộ. */
	renamed: number;
	/** Số bậc bỏ qua (role không an toàn, cao hơn bot hoặc người thao tác, lỗi API, bậc vừa đổi role giữa chừng...). */
	skipped: number;
	/** Role đã đổi tên/màu kèm tên trước khi đổi (để tra lại), theo thứ tự bot xử lý. */
	renamedRoles: { roleId: string; oldName: string }[];
	/** Role do admin tự gán mà bot giữ nguyên tên (bot chỉ đổi tên role do chính bot tạo). */
	keptRoles: string[];
	/** Role bot vừa tạo nhưng không dùng được (bậc đổi role giữa chừng, lỗi lưu) và cũng không xoá lại được: admin cần xoá thủ công. */
	orphanedRoles: string[];
}

/** Các thay đổi role cần làm để member chỉ giữ đúng role của cảnh giới hiện tại (DEC-031). */
export interface TierRoleSyncPlan
{
	add: string[];
	remove: string[];
}

export interface TierRoleServiceApi
{
	/** Các cảnh giới đã gán role, theo thứ tự TIERS. */
	list(guildId: string): TierRoleMapping[];
	/**
	 * Gán (hoặc đổi) role cho một cảnh giới. Ghi audit "tier_role.set" (target = roleId, details { tierKey }).
	 * UserError nếu role đang được gán cho cảnh giới khác trong guild. Không kiểm tra quyền Discord của role (việc của tầng Discord).
	 */
	set(guildId: string, tierKey: TierKey, roleId: string, actorId: string, options?: { createdByBot?: boolean }): void;
	/**
	 * Bỏ role của một cảnh giới. Ghi audit "tier_role.clear" (target = role cũ, details { tierKey }, thêm `deletedRoleId` nếu
	 * tầng Discord vừa xoá role đó khỏi server: role do bot tạo không còn dùng vào việc gì khác). false nếu vốn chưa gán.
	 */
	clear(guildId: string, tierKey: TierKey, actorId: string, options?: { deletedRoleId?: string }): boolean;
	/**
	 * Hàm thuần theo dữ liệu đã cấu hình: role cần thêm/bỏ để member có đúng một role cảnh giới, là role gán cho cảnh giới
	 * của `level` (nếu cảnh giới đó chưa gán role thì không thêm gì, nhưng vẫn bỏ role của các cảnh giới khác).
	 * Chỉ đụng tới các role có trong tier_roles của guild; guild chưa gán role nào thì trả về { add: [], remove: [] }.
	 */
	plan(guildId: string, level: number, memberRoleIds: readonly string[]): TierRoleSyncPlan;
	/** Ghi audit "tier_role.setup" (target null, details = summary) sau khi tầng Discord tạo/đổi tên role theo bộ. */
	recordSetup(guildId: string, actorId: string, summary: TierRoleSetupSummary): void;
}
