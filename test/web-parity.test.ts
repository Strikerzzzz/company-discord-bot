import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "path";
import Command from "../src/classes/Command";
import ContextMenu from "../src/classes/ContextMenu";
import type DiscordClient from "../src/classes/DiscordClient";
import { loadModules } from "../src/handlers/loadModules";
import { PAGE_MODULES } from "../src/web/pages";

// DEC-041: mọi việc admin làm được trên Discord phải làm được trên trang web quản trị. Mỗi subcommand và context menu được
// xếp vào đúng một loại trong COVERAGE, kèm danh sách option lúc xếp loại. Thêm lệnh, subcommand hay option mà chưa cập nhật
// COVERAGE (và trang web tương ứng) thì test fail.

const fakeClient = {} as DiscordClient;
const SRC = join(__dirname, "..", "src");
const SUB_COMMAND = 1;
const SUB_COMMAND_GROUP = 2;

/**
 * - `web`: làm được trên các trang này (đường dẫn GET dưới `/g/<guildId>`, "" là trang Tổng quan), đủ mọi option.
 * - `discordOnly`: thao tác của thành viên gắn với Discord, không phải việc quản lý (DEC-041); phải ghi lý do.
 * - `pending`: còn thiếu trên web lúc chốt DEC-041, chỉ được dùng cho mục có trong PENDING_AT_DEC_041.
 */
type Coverage =
	| { options: readonly string[]; web: readonly string[] }
	| { options: readonly string[]; discordOnly: string }
	| { options: readonly string[]; pending: string };

/**
 * Việc còn thiếu trên web. Lúc chốt DEC-041 (2026-09-30) có 17 mục; Phase 17 đã làm hết (DEC-042), nên từ nay không lệnh nào được
 * xếp vào `pending`: tính năng mới phải có trang web ngay.
 */
const PENDING_AT_DEC_041: ReadonlySet<string> = new Set<string>();

const COVERAGE: Readonly<Record<string, Coverage>> = {
	"/admin xp view": { options: ["thanh-vien"], web: ["/members/view"] },
	"/admin xp give": { options: ["ly-do", "so-xp", "thanh-vien"], web: ["/members/view"] },
	"/admin xp remove": { options: ["ly-do", "so-xp", "thanh-vien"], web: ["/members/view"] },
	"/admin xp reset": { options: ["thanh-vien"], web: ["/members/view"] },
	"/admin xp reset-all": { options: ["xac-nhan"], web: ["/reset"] },
	"/admin contribution adjust": { options: ["diem", "ly-do", "thanh-vien"], web: ["/members/view"] },
	"/admin contribution remove": { options: ["id"], web: ["/contributions/view"] },
	"/admin contribution reset": { options: ["thanh-vien"], web: ["/members/view"] },
	"/admin contribution reset-all": { options: ["xac-nhan"], web: ["/reset"] },
	"/admin stats": { options: [], web: ["/stats"] },
	"/admin audit": { options: ["so-luong"], web: ["/audit"] },
	"/admin backup": { options: [], web: ["/backup"] },
	"/config view": { options: [], web: [""] },
	"/config panel": { options: [], web: [""] },
	"/config xp": {
		options: ["bo-kenh-thong-bao", "chong-trung-giay", "cooldown-giay", "do-dai-toi-thieu", "kenh-thong-bao", "thong-bao-len-level", "xp-moi-tin"],
		web: ["/settings"],
	},
	"/config channel set": {
		options: ["bat-xp", "cooldown-giay", "dung-chung-cooldown", "dung-chung-xp", "kenh", "xp-moi-tin"],
		web: ["/channels"],
	},
	"/config channel reset": { options: ["kenh"], web: ["/channels"] },
	"/config channel list": { options: [], web: ["/channels"] },
	"/config channel mode": { options: ["che-do"], web: ["/channels"] },
	"/config team add": { options: ["role"], web: ["/teams"] },
	"/config team remove": { options: ["role"], web: ["/teams"] },
	"/config team list": { options: [], web: ["/teams"] },
	"/config admin-role": { options: ["bo", "bo-het", "them"], web: ["/roles"] },
	"/config poll": { options: ["bo-role-tao-vote", "gioi-han-xp-ngay", "role-tao-vote", "xoa-role-tao-vote", "xp-mac-dinh"], web: ["/settings", "/roles"] },
	"/config contribution": { options: ["diem-moi-luot"], web: ["/settings"] },
	"/config tier panel": { options: [], web: ["/tiers"] },
	"/config tier set-role": { options: ["bac", "role"], web: ["/tiers"] },
	"/config tier clear-role": { options: ["bac"], web: ["/tiers"] },
	"/config tier list": { options: [], web: ["/tiers"] },
	"/config tier style": { options: ["bo"], web: ["/tiers"] },
	"/config tier rename": { options: ["bac", "ten"], web: ["/tiers"] },
	"/config tier reset-names": { options: [], web: ["/tiers"] },
	"/config tier setup-roles": { options: [], web: ["/tiers"] },
	"/config board": { options: ["kenh", "tat"], web: ["/board"] },
	"/contribution submit": { options: ["link", "loai", "noi-dung", "tieu-de"], discordOnly: "thành viên đăng đóng góp vào kênh" },
	"/contribution view": { options: ["id"], web: ["/contributions/view"] },
	"/contribution list": { options: ["thanh-vien"], web: ["/contributions"] },
	"/leaderboard": { options: ["ky", "loai", "pham-vi", "trang"], web: ["/leaderboard"] },
	"/ping": { options: [], discordOnly: "kiểm tra bot còn phản hồi, không có gì để quản lý" },
	"/poll create": {
		options: ["cau-hoi", "lua-chon", "nhieu-lua-chon", "thoi-han-phut", "xp"],
		discordOnly: "đăng vote vào kênh; vote đã tạo được quản lý trên web",
	},
	"/poll close": { options: ["id"], web: ["/polls/view"] },
	"/poll results": { options: ["id"], web: ["/polls/view"] },
	"/poll list": { options: [], web: ["/polls"] },
	"/rank": { options: ["thanh-vien"], discordOnly: "thẻ hồ sơ trong Discord; admin xem hồ sơ thành viên như /admin xp view" },
	"/rank-style": {
		options: ["bo"],
		discordOnly: "thành viên tự chọn bộ danh hiệu hiển thị cho chính mình; admin bật/tắt cho phép tự chọn và xem số người chọn từng bộ ở trang Danh hiệu, xem và xoá lựa chọn của từng người ở hồ sơ trang Thành viên",
	},
	"menu:Ghi nhận đóng góp": { options: [], discordOnly: "thành viên ghi nhận tin nhắn của người khác ngay trong Discord" },
	"/retro create": {
		options: ["han-gio", "link", "team", "ten"],
		discordOnly: "đăng phiên retro (tin có nút điền) vào đúng kênh hoặc thread của team nơi gõ lệnh; phiên đã tạo được quản lý trên trang Retro",
	},
	"/retro close": { options: ["id"], web: ["/retro"] },
	"/retro reopen": { options: ["han-gio", "id"], web: ["/retro"] },
	"/retro extend": { options: ["han-gio", "id"], web: ["/retro"] },
	"/retro vote": { options: ["id", "rut-gon"], web: ["/retro"] },
	"/retro status": { options: ["id"], web: ["/retro"] },
	"/retro remind": { options: ["id"], web: ["/retro"] },
	"/retro pick": { options: ["id", "ten"], web: ["/retro"] },
	"/retro write": { options: ["id"], web: ["/retro"] },
};

interface OptionJson
{
	name: string;
	type?: number;
	options?: OptionJson[];
}

/** Mỗi subcommand (hoặc command không có subcommand) thành một mục `"/lệnh nhóm sub"` kèm tên option đã sắp xếp. */
function leaves(prefix: string, options: readonly OptionJson[] | undefined, out: Map<string, string[]>): void
{
	const subs = (options ?? []).filter(option => option.type === SUB_COMMAND || option.type === SUB_COMMAND_GROUP);
	if (subs.length === 0)
	{
		out.set(prefix, (options ?? []).map(option => option.name).sort());
		return;
	}
	for (const sub of subs) leaves(`${prefix} ${sub.name}`, sub.options, out);
}

function discordActions(): Map<string, string[]>
{
	const actions = new Map<string, string[]>();
	for (const command of loadModules(join(SRC, "interactions", "commands"), Command, fakeClient))
	{
		const json = command.data.toJSON() as OptionJson;
		leaves(`/${json.name}`, json.options, actions);
	}
	for (const menu of loadModules(join(SRC, "interactions", "contextMenus"), ContextMenu, fakeClient))
	{
		actions.set(`menu:${menu.data.name}`, []);
	}
	return actions;
}

describe("mọi tính năng quản lý được trên trang web (DEC-041)", () =>
{
	const actions = discordActions();

	test("mọi subcommand và context menu đều đã xếp loại trong COVERAGE", () =>
	{
		const missing = [...actions.keys()].filter(key => !Object.hasOwn(COVERAGE, key));
		assert.deepEqual(missing, [], "Lệnh mới phải có trang web quản lý (DEC-041), rồi thêm vào COVERAGE trong test/web-parity.test.ts");
	});

	test("COVERAGE không còn mục của lệnh đã bỏ", () =>
	{
		const stale = Object.keys(COVERAGE).filter(key => !actions.has(key));
		assert.deepEqual(stale, []);
	});

	test("option của mỗi lệnh khớp lúc xếp loại: thêm option thì trang web cũng phải có ô tương ứng", () =>
	{
		for (const [key, options] of actions)
		{
			const coverage = COVERAGE[key];
			if (coverage === undefined) continue;
			assert.deepEqual(options, [...coverage.options].sort(), `${key}: option đã đổi, kiểm tra lại trang web rồi cập nhật COVERAGE`);
		}
	});

	test("đường dẫn web trỏ tới trang có thật", () =>
	{
		const pages = new Set(PAGE_MODULES.flatMap(module => module.routes).filter(route => route.method === "GET").map(route => route.path));
		for (const [key, coverage] of Object.entries(COVERAGE))
		{
			if (!("web" in coverage)) continue;
			assert.ok(coverage.web.length > 0, `${key}: thiếu trang web`);
			for (const path of coverage.web) assert.ok(pages.has(path), `${key}: không có trang GET "${path}"`);
		}
	});

	test("việc còn thiếu chỉ được bớt đi: tính năng mới không được xếp vào pending", () =>
	{
		for (const [key, coverage] of Object.entries(COVERAGE))
		{
			if ("pending" in coverage) assert.ok(PENDING_AT_DEC_041.has(key), `${key}: tính năng mới phải có trang web ngay (DEC-041)`);
		}
	});

	test("mục chỉ có trên Discord phải ghi lý do", () =>
	{
		for (const [key, coverage] of Object.entries(COVERAGE))
		{
			if ("discordOnly" in coverage) assert.ok(coverage.discordOnly.trim().length > 0, `${key}: thiếu lý do`);
		}
	});
});
