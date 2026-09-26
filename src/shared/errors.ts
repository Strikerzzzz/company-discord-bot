/**
 * Lỗi nghiệp vụ: thông báo (tiếng Việt) an toàn để hiển thị nguyên văn cho người dùng Discord.
 * Các lỗi khác (bug, lỗi hệ thống) chỉ hiện thông báo chung cho người dùng và được ghi log đầy đủ.
 */
export class UserError extends Error
{
	constructor(message: string)
	{
		super(message);
		this.name = "UserError";
	}
}
