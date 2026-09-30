/** Chế độ kênh tính XP (DEC-037): "all" = mọi kênh trừ kênh đã tắt; "selected" = chỉ kênh admin bật riêng. */
export type XpChannelMode = "all" | "selected";

export const XP_CHANNEL_MODES: readonly XpChannelMode[] = ["all", "selected"];

export function isXpChannelMode(value: unknown): value is XpChannelMode
{
	return value === "all" || value === "selected";
}

export interface GuildSettings
{
	/** XP cho mỗi tin nhắn hợp lệ (DEC-022). */
	xpPerMessage: number;
	/** Cooldown giữa hai lần được XP từ tin nhắn, tính theo người (DEC-022). */
	xpCooldownSeconds: number;
	/** Tin ngắn hơn số ký tự này (sau khi chuẩn hoá) không được XP (DEC-023). */
	minMessageLength: number;
	/** Tin trùng với tin trước đó của cùng người trong khoảng này không được XP (DEC-023). */
	duplicateWindowSeconds: number;
	levelUpAnnouncements: boolean;
	/**
	 * Kênh nhận thông báo lên level/lên bậc (DEC-043): có giá trị thì chỉ gửi vào kênh này; null = gửi ở kênh thành viên vừa nhắn.
	 * Chỉ có tác dụng khi `levelUpAnnouncements` bật.
	 */
	levelUpChannelId: string | null;
	/** Kênh chưa có cấu hình riêng có tính XP không: "all" = có, "selected" = không (DEC-037). */
	xpChannelMode: XpChannelMode;
	/** XP mặc định cho người tham gia vote (DEC-026). */
	defaultPollXp: number;
	/** XP tối đa một người nhận từ vote trong một ngày giờ Việt Nam; 0 = không giới hạn (DEC-028). */
	pollXpDailyCap: number;
	/** Điểm cộng cho tác giả mỗi lượt ghi nhận contribution (DEC-025). */
	contributionVotePoints: number;
	/**
	 * Các role có quyền admin bot, ngoài những người có quyền Manage Server (DEC-044): có một role trong danh sách là admin.
	 * Tối đa MAX_GRANT_ROLES role, theo thứ tự được thêm (rồi theo ID). Rỗng = chỉ người có Manage Server.
	 */
	adminRoleIds: string[];
	/** Các role được phép tạo vote, ngoài admin (DEC-026, DEC-044). Tối đa MAX_GRANT_ROLES role; rỗng = chỉ admin. */
	pollCreatorRoleIds: string[];
}

/** Danh sách role được cấp quyền trong cấu hình (DEC-044): role admin bot, role được tạo vote. */
export type RoleGrantKey = "adminRoleIds" | "pollCreatorRoleIds";

export const ROLE_GRANT_KEYS: readonly RoleGrantKey[] = ["adminRoleIds", "pollCreatorRoleIds"];

/** Số role tối đa của mỗi danh sách role được cấp quyền (bằng số lựa chọn tối đa của một menu chọn role của Discord). */
export const MAX_GRANT_ROLES = 25;

export type NumericSettingKey = "xpPerMessage" | "xpCooldownSeconds" | "minMessageLength" | "duplicateWindowSeconds" | "defaultPollXp" | "pollXpDailyCap" | "contributionVotePoints";

export const DEFAULT_GUILD_SETTINGS: Readonly<GuildSettings> = {
	xpPerMessage: 10,
	xpCooldownSeconds: 60,
	minMessageLength: 5,
	duplicateWindowSeconds: 300,
	levelUpAnnouncements: true,
	levelUpChannelId: null,
	xpChannelMode: "all",
	defaultPollXp: 5,
	pollXpDailyCap: 25,
	contributionVotePoints: 1,
	adminRoleIds: [],
	pollCreatorRoleIds: [],
};

/** Giới hạn hợp lệ và nhãn tiếng Việt để báo lỗi. */
export const SETTING_LIMITS: Readonly<Record<NumericSettingKey, { min: number; max: number; label: string }>> = {
	xpPerMessage: { min: 0, max: 1000, label: "XP mỗi tin nhắn" },
	xpCooldownSeconds: { min: 0, max: 86400, label: "Cooldown (giây)" },
	minMessageLength: { min: 0, max: 200, label: "Độ dài tin tối thiểu" },
	duplicateWindowSeconds: { min: 0, max: 86400, label: "Khoảng chống trùng (giây)" },
	defaultPollXp: { min: 0, max: 1000, label: "XP mặc định khi vote" },
	pollXpDailyCap: { min: 0, max: 100000, label: "Giới hạn XP từ vote mỗi ngày" },
	contributionVotePoints: { min: 0, max: 100, label: "Điểm mỗi lượt ghi nhận" },
};

export interface ChannelSettings
{
	channelId: string;
	xpEnabled: boolean;
	/** null = dùng giá trị của guild. */
	xpPerMessage: number | null;
	/** null = dùng giá trị của guild. */
	xpCooldownSeconds: number | null;
}

export interface EffectiveChannelXp
{
	enabled: boolean;
	xpPerMessage: number;
	cooldownSeconds: number;
}
