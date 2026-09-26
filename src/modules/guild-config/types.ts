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
	/** XP mặc định cho người tham gia vote (DEC-026). */
	defaultPollXp: number;
	/** Điểm cộng cho tác giả mỗi lượt ghi nhận contribution (DEC-025). */
	contributionVotePoints: number;
	/** Role có quyền admin bot, ngoài những người có quyền Manage Server. */
	adminRoleId: string | null;
	/** Role được phép tạo vote, ngoài admin (DEC-026). */
	pollCreatorRoleId: string | null;
}

export type NumericSettingKey = "xpPerMessage" | "xpCooldownSeconds" | "minMessageLength" | "duplicateWindowSeconds" | "defaultPollXp" | "contributionVotePoints";

export const DEFAULT_GUILD_SETTINGS: Readonly<GuildSettings> = {
	xpPerMessage: 10,
	xpCooldownSeconds: 60,
	minMessageLength: 5,
	duplicateWindowSeconds: 300,
	levelUpAnnouncements: true,
	defaultPollXp: 5,
	contributionVotePoints: 1,
	adminRoleId: null,
	pollCreatorRoleId: null,
};

/** Giới hạn hợp lệ và nhãn tiếng Việt để báo lỗi. */
export const SETTING_LIMITS: Readonly<Record<NumericSettingKey, { min: number; max: number; label: string }>> = {
	xpPerMessage: { min: 0, max: 1000, label: "XP mỗi tin nhắn" },
	xpCooldownSeconds: { min: 0, max: 86400, label: "Cooldown (giây)" },
	minMessageLength: { min: 0, max: 200, label: "Độ dài tin tối thiểu" },
	duplicateWindowSeconds: { min: 0, max: 86400, label: "Khoảng chống trùng (giây)" },
	defaultPollXp: { min: 0, max: 1000, label: "XP mặc định khi vote" },
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
