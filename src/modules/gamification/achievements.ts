import { AchievementDefinition } from "./types";

/**
 * Huy hiệu thành tích (DEC-029): chỉ để hiển thị, không cộng điểm. Tính lại từ dữ liệu sẵn có mỗi lần xem,
 * nên dữ liệu bị reset hay gỡ thì huy hiệu tương ứng cũng mất. Thứ tự ở đây là thứ tự hiển thị.
 */
export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
	{ key: "khai-khau", emoji: "💬", name: "Khai Khẩu", description: "100 tin nhắn được XP", stat: "messages", threshold: 100 },
	{ key: "hoat-ngon", emoji: "🗣️", name: "Hoạt Ngôn", description: "1.000 tin nhắn được XP", stat: "messages", threshold: 1_000 },
	{ key: "thao-thao-bat-tuyet", emoji: "📢", name: "Thao Thao Bất Tuyệt", description: "10.000 tin nhắn được XP", stat: "messages", threshold: 10_000 },
	{ key: "kien-tri", emoji: "🔥", name: "Kiên Trì", description: "Chuỗi 7 ngày hoạt động liên tiếp", stat: "bestStreak", threshold: 7 },
	{ key: "be-quan", emoji: "🧘", name: "Bế Quan Tu Luyện", description: "Chuỗi 30 ngày hoạt động liên tiếp", stat: "bestStreak", threshold: 30 },
	{ key: "bach-nhat", emoji: "🏔️", name: "Bách Nhật Trúc Cơ", description: "Chuỗi 100 ngày hoạt động liên tiếp", stat: "bestStreak", threshold: 100 },
	{ key: "duoc-cong-nhan", emoji: "🌟", name: "Được Công Nhận", description: "Được ghi nhận đóng góp lần đầu", stat: "recognitionsReceived", threshold: 1 },
	{ key: "danh-chan-mot-phuong", emoji: "🎖️", name: "Danh Chấn Một Phương", description: "Được ghi nhận 10 lần", stat: "recognitionsReceived", threshold: 10 },
	{ key: "danh-chan-thien-ha", emoji: "🏆", name: "Danh Chấn Thiên Hạ", description: "Được ghi nhận 50 lần", stat: "recognitionsReceived", threshold: 50 },
	{ key: "tri-am", emoji: "🤝", name: "Tri Âm", description: "Ghi nhận đóng góp của người khác 10 lần", stat: "recognitionsGiven", threshold: 10 },
	{ key: "ba-nhac", emoji: "🐎", name: "Bá Nhạc", description: "Ghi nhận đóng góp của người khác 50 lần", stat: "recognitionsGiven", threshold: 50 },
	{ key: "cong-dan-guong-mau", emoji: "🗳️", name: "Công Dân Gương Mẫu", description: "Tham gia 5 cuộc vote", stat: "pollsJoined", threshold: 5 },
	{ key: "tieng-noi-tap-the", emoji: "📣", name: "Tiếng Nói Tập Thể", description: "Tham gia 25 cuộc vote", stat: "pollsJoined", threshold: 25 },
	{ key: "gop-gach", emoji: "🧱", name: "Góp Gạch Xây Nhà", description: "Có contribution đầu tiên", stat: "contributions", threshold: 1 },
	{ key: "tru-cot", emoji: "🏛️", name: "Trụ Cột", description: "Có 10 contribution", stat: "contributions", threshold: 10 },
];
