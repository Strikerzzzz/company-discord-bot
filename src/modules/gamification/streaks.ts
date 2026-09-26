import { StreakInfo } from "./types";

/**
 * Chuỗi ngày hoạt động (DEC-029) từ danh sách ngày có hoạt động (số thứ tự ngày giờ Việt Nam, xem vnDayNumber).
 * - current: số ngày liên tiếp kết thúc ở ngày hoạt động gần nhất, nếu ngày đó là hôm nay hoặc hôm qua; ngược lại 0.
 * - best: dãy ngày liên tiếp dài nhất trong toàn bộ lịch sử (luôn >= current).
 *
 * Đầu vào thường giảm dần và không trùng (Ledger.activeDays) nhưng hàm vẫn tự sắp xếp và bỏ trùng.
 * Ngày sau `today` (event ghi lúc đồng hồ máy chủ bị lệch về tương lai) bị bỏ qua hoàn toàn, cho cả current, best,
 * activeToday lẫn lastActiveDay, tới khi thật sự tới ngày đó; nhờ vậy hồ sơ không bao giờ báo hoạt động "ngày mai".
 */
export function computeStreak(daysDesc: readonly number[], today: number): StreakInfo
{
	const days = [...new Set(daysDesc)].filter(day => day <= today).sort((a, b) => b - a);
	if (days.length === 0) return { current: 0, best: 0, activeToday: false, lastActiveDay: null };

	let best = 0;
	let run = 0;
	let latestRun = 0;
	days.forEach((day, index) =>
	{
		run = index > 0 && days[index - 1] - day === 1 ? run + 1 : 1;
		// run === index + 1 nghĩa là mọi ngày từ đầu danh sách tới đây đều liên tiếp: vẫn đang ở dãy của ngày gần nhất.
		if (run === index + 1) latestRun = run;
		best = Math.max(best, run);
	});

	const lastActiveDay = days[0];
	return {
		current: lastActiveDay >= today - 1 ? latestRun : 0,
		best,
		activeToday: lastActiveDay === today,
		lastActiveDay,
	};
}
