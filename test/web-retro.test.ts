// Test trang "Retro" tối thiểu của web quản trị (Phase 19 phần lõi, DEC-041/DEC-049): danh sách phiên, trạng thái, số người đã điền,
// giấu tiêu đề phiên ở kênh người đăng nhập không xem được. Service thật trên SQLite :memory: và server Discord giả.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ChannelType } from "discord.js";
import { NAV_ITEMS } from "../src/web/layout";
import { HIDDEN_ITEM_TEXT } from "../src/web/widgets";
import { GUILD } from "./helpers";
import { addChannel, ADMIN_USER, call, CHANNEL_CHAT, CHANNEL_WORK, createWebHarness, login, PLAIN_USER } from "./web-helpers";

const CHANNEL_SECRET = "410000000000000099";

describe("web: trang Retro (tối thiểu)", () =>
{
	test("menu có mục 🔁 Retro trong nhóm Dữ liệu; danh sách phiên có trạng thái và số người điền; phiên ở kênh riêng tư bị giấu tiêu đề", async () =>
	{
		const item = NAV_ITEMS.find(nav => nav.key === "retro");
		assert.deepEqual(item, { key: "retro", path: "/retro", label: "🔁 Retro", group: "Dữ liệu" });

		const harness = createWebHarness();
		addChannel(harness.world, { id: CHANNEL_SECRET, name: "ban-giam-doc", type: ChannelType.GuildText, permissionsByMember: { [ADMIN_USER]: [] } });
		const { retro } = harness.services;
		const open = retro.create({ guildId: GUILD, channelId: CHANNEL_CHAT, title: "Retro <b>Sprint 24</b>", docUrl: null, teamRoleId: null, durationHours: null, createdBy: ADMIN_USER });
		retro.submit({ guildId: GUILD, sessionId: open.id, userId: PLAIN_USER, roleIds: [], answers: { learned: "a", improve: "", ideas: "", kudos: "", sprintName: "" }, systemActorId: "bot" });
		harness.clock.advance(1000);
		const done = retro.create({ guildId: GUILD, channelId: CHANNEL_WORK, title: "Retro Sprint 23", docUrl: null, teamRoleId: null, durationHours: null, createdBy: ADMIN_USER });
		retro.submit({ guildId: GUILD, sessionId: done.id, userId: PLAIN_USER, roleIds: [], answers: { learned: "", improve: "", ideas: "", kudos: "", sprintName: "Tên Duy Nhất" }, systemActorId: "bot" });
		retro.close(GUILD, done.id, ADMIN_USER);
		retro.pickName({ guildId: GUILD, sessionId: done.id, name: "Tên Duy Nhất", actorId: ADMIN_USER, systemActorId: "bot" });
		harness.clock.advance(1000);
		retro.create({ guildId: GUILD, channelId: CHANNEL_SECRET, title: "Retro bí mật", docUrl: null, teamRoleId: null, durationHours: null, createdBy: ADMIN_USER });

		const auth = await login(harness, ADMIN_USER);
		const response = await call(harness, `/g/${GUILD}/retro`, { cookies: auth.cookies });
		assert.equal(response.status, 200);
		const body = response.body;
		assert.match(body, /<h1>Retro<\/h1>/u);
		assert.match(body, /3 phiên\./u);
		assert.ok(body.includes("Retro &lt;b&gt;Sprint 24&lt;/b&gt;"), "tiêu đề được escape");
		assert.ok(body.includes("🟢 Đang nhận câu trả lời"));
		assert.ok(body.includes("✅ Hoàn tất · 🏆 Tên Duy Nhất"));
		assert.ok(!body.includes("Retro bí mật"), "phiên ở kênh không xem được bị giấu tiêu đề");
		assert.ok(body.includes(HIDDEN_ITEM_TEXT));
		assert.ok(!body.includes("ban-giam-doc"), "tên kênh riêng tư bị giấu");
		assert.ok(body.includes("href=\"/g/" + GUILD + "/retro\" class=\"active\""), "mục menu đang chọn");
	});

	test("chưa có phiên: hướng dẫn tạo bằng /retro create; thành viên thường không vào được", async () =>
	{
		const harness = createWebHarness();
		const auth = await login(harness, ADMIN_USER);
		const response = await call(harness, `/g/${GUILD}/retro`, { cookies: auth.cookies });
		assert.equal(response.status, 200);
		assert.match(response.body, /Chưa có phiên retro nào/u);
		await assert.rejects(login(harness, PLAIN_USER));
	});
});
