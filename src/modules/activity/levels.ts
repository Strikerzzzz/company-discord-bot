export interface LevelInfo
{
	level: number;
	totalXp: number;
	/** XP đã có trong level hiện tại. */
	xpIntoLevel: number;
	/** XP cần để lên level kế tiếp, tính từ đầu level hiện tại. */
	xpForNextLevel: number;
}

/** Công thức của xpToNextLevel dạng chữ, để giải thích cho thành viên (nút "?" của /rank, DEC-047). Đổi công thức thì đổi cả chữ. */
export const LEVEL_FORMULA_TEXT = "5n² + 50n + 100";

/** XP cần để lên từ level n lên n+1: 5n² + 50n + 100 (DEC-022). */
export function xpToNextLevel(level: number): number
{
	return 5 * level * level + 50 * level + 100;
}

/** Tổng XP cần để đạt một level (level 0 = 0 XP). */
export function totalXpForLevel(level: number): number
{
	let total = 0;
	for (let n = 0; n < level; n++) total += xpToNextLevel(n);
	return total;
}

export function levelInfo(totalXp: number): LevelInfo
{
	const xp = Math.max(0, Math.floor(totalXp));
	let level = 0;
	let remaining = xp;
	while (remaining >= xpToNextLevel(level))
	{
		remaining -= xpToNextLevel(level);
		level++;
	}
	return { level, totalXp: xp, xpIntoLevel: remaining, xpForNextLevel: xpToNextLevel(level) };
}
