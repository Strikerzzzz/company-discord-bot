import type DiscordClient from "../classes/DiscordClient";
import { LiveBoard } from "../modules/live-board/LiveBoardService";

/**
 * Đăng (nếu chưa có message) hoặc sửa message Bảng vàng của một guild theo dữ liệu hiện tại (DEC-030).
 * `force`: bỏ qua kiểm tra "dữ liệu không đổi so với lần cập nhật trước" (dùng ngay sau khi admin đặt kênh).
 * Không ném lỗi (chỉ ghi log). Trả về true nếu đã đăng hoặc sửa được message; false nếu guild chưa bật Bảng vàng,
 * dữ liệu không đổi, hoặc gặp lỗi.
 */
export function refreshLiveBoard(client: DiscordClient, guildId: string, options: { force?: boolean } = {}): Promise<boolean>
{
	return Promise.reject(new Error(`Chưa triển khai: refreshLiveBoard (${client.guildIds.length}, ${guildId}, ${String(options.force)}).`));
}

/** Xoá message của một Bảng vàng cũ (sau khi admin đổi kênh hoặc tắt). Không ném lỗi. Trả về true nếu đã xoá. */
export function deleteLiveBoardMessage(client: DiscordClient, board: LiveBoard): Promise<boolean>
{
	return Promise.reject(new Error(`Chưa triển khai: deleteLiveBoardMessage (${client.guildIds.length}, ${board.guildId}).`));
}

/** Định kỳ cập nhật Bảng vàng của mọi guild đang phục vụ. Không chạy chồng lượt; timer không giữ process sống. Trả về hàm dừng lịch. */
export function startLiveBoardScheduler(client: DiscordClient, intervalMs = 10 * 60_000): () => void
{
	throw new Error(`Chưa triển khai: startLiveBoardScheduler (${client.guildIds.length}, ${intervalMs}).`);
}
