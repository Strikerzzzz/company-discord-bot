/** Một trang của danh sách: trang bắt đầu từ 1, luôn có ít nhất 1 trang (kể cả khi danh sách rỗng). */
export interface ListPage<T>
{
	items: T[];
	page: number;
	totalPages: number;
	/** Tổng số mục khớp bộ lọc, ở mọi trang. */
	total: number;
	pageSize: number;
}

/** Số mục tối đa mỗi trang mà service nhận; lớn hơn thì kẹp về giá trị này. */
export const MAX_PAGE_SIZE = 100;

export interface PageWindow
{
	page: number;
	totalPages: number;
	pageSize: number;
	offset: number;
}

/** Kẹp `page` về trang hợp lệ gần nhất (không phải số nguyên thì về trang 1) và tính offset cho câu SQL. */
export function pageWindow(total: number, page: number, pageSize: number): PageWindow
{
	const size = Math.min(Math.max(1, Math.trunc(pageSize) || 1), MAX_PAGE_SIZE);
	const totalPages = Math.max(1, Math.ceil(total / size));
	const wanted = Number.isFinite(page) ? Math.trunc(page) : 1;
	const clamped = Math.min(Math.max(1, wanted), totalPages);
	return { page: clamped, totalPages, pageSize: size, offset: (clamped - 1) * size };
}
