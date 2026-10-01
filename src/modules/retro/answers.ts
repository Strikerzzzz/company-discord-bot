import { UserError } from "../../shared/errors";
import { RETRO_FIELD_TITLES, RETRO_FIELDS, RETRO_LIMITS, RetroAnswers, RetroAnswersInput, RetroField } from "./types";

// Kiểm tra và chuẩn hoá câu trả lời retro, tên sprint (DEC-049). Hàm thuần.

export const EMPTY_ANSWERS = "Hãy điền ít nhất một ô trước khi gửi.";
export const NUMERIC_SPRINT_NAME = "Tên sprint không được chỉ là số (luật của mẫu retro: cấm đặt tên sprint là số).";

/** Ký tự phân cách được bỏ qua khi xét tên "chỉ toàn số" (ví dụ "24", "2 4", "#24", "24.1", "24-25"). */
const NUMBER_SEPARATORS = /[\s.,:;#/_-]/gu;
const DIGITS_ONLY = /^\p{Nd}+$/u;
const WHITESPACE = /\s+/gu;
const graphemes = new Intl.Segmenter("vi", { granularity: "grapheme" });

function codePoints(text: string): number
{
	return Array.from(text).length;
}

/**
 * Cắt `text` còn tối đa `max` đơn vị UTF-16 (`.length`, cách Discord và PollService đếm), không cắt giữa một ký tự (emoji, chữ có
 * dấu tổ hợp) và không thêm dấu "…". Dùng khi điền sẵn form hay dựng câu hỏi vote, để không bỏ trống ô hay vượt giới hạn.
 */
export function cutText(text: string, max: number): string
{
	if (text.length <= max) return text;
	let end = 0;
	for (const { segment } of graphemes.segment(text))
	{
		if (end + segment.length > max) break;
		end += segment.length;
	}
	return text.slice(0, end);
}

/** Tên sprint một dòng: NFC, bỏ khoảng trắng hai đầu, gộp mọi khoảng trắng (kể cả xuống dòng) thành một dấu cách. */
export function displaySprintName(raw: string): string
{
	return raw.normalize("NFC").replace(WHITESPACE, " ").trim();
}

/** Khoá so sánh tên sprint: như displaySprintName, không phân biệt hoa thường. */
export function sprintNameKey(raw: string): string
{
	return displaySprintName(raw).toLocaleLowerCase("vi");
}

/** Tên chỉ gồm chữ số (bỏ qua khoảng trắng và dấu phân cách thường gặp). Tên rỗng không tính. */
export function isNumericOnlyName(raw: string): boolean
{
	const compact = raw.normalize("NFC").replace(NUMBER_SEPARATORS, "");
	return compact.length > 0 && DIGITS_ONLY.test(compact);
}

/** Một ô chữ: bỏ khoảng trắng hai đầu, rỗng thì null. UserError nếu dài quá. */
function answerText(field: RetroField, raw: string): string | null
{
	const text = raw.normalize("NFC").trim();
	if (text.length === 0) return null;
	if (field === "sprintName")
	{
		const name = displaySprintName(text);
		if (name.length > RETRO_LIMITS.sprintNameMax)
		{
			throw new UserError(`Tên sprint tối đa ${RETRO_LIMITS.sprintNameMax} ký tự.`);
		}
		if (isNumericOnlyName(name)) throw new UserError(NUMERIC_SPRINT_NAME);
		return name;
	}
	if (codePoints(text) > RETRO_LIMITS.answerMax)
	{
		throw new UserError(`Ô "${RETRO_FIELD_TITLES[field]}" tối đa ${RETRO_LIMITS.answerMax} ký tự.`);
	}
	return text;
}

/**
 * Chuẩn hoá 5 ô của phiếu: ô trống là null; mỗi ô tối đa RETRO_LIMITS.answerMax ký tự; tên sprint một dòng, tối đa
 * RETRO_LIMITS.sprintNameMax ký tự và không chỉ toàn số. UserError nếu không hợp lệ hoặc cả 5 ô đều trống.
 */
export function normalizeAnswers(input: RetroAnswersInput): RetroAnswers
{
	const answers: RetroAnswers = { learned: null, improve: null, ideas: null, kudos: null, sprintName: null };
	for (const field of RETRO_FIELDS) answers[field] = answerText(field, input[field]);
	if (RETRO_FIELDS.every(field => answers[field] === null)) throw new UserError(EMPTY_ANSWERS);
	return answers;
}

/** Phiếu còn ít nhất một ô có chữ. */
export function hasContent(answers: RetroAnswers): boolean
{
	return RETRO_FIELDS.some(field => answers[field] !== null);
}
