// Test "chọn tất cả / bỏ chọn tất cả" trên bảng ô tick của web quản trị (Phase 18): `?chon=` chỉ đổi cách vẽ, input ẩn vẫn
// mang giá trị đang lưu, bấm Lưu thì trang chỉ ghi phần khác đi.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { GUILD } from "./helpers";
import { ADMIN_USER, call, CHANNEL_CHAT, CHANNEL_WORK, createWebHarness, login, ROLE_MANAGED, ROLE_TEAM_A, ROLE_TEAM_B, withCsrf } from "./web-helpers";

function checkboxes(body: string, name: string): { value: string; checked: boolean; disabled: boolean }[]
{
	return [...body.matchAll(/<input type="checkbox"[^>]*>/gu)]
		.map(match => match[0])
		.filter(tag => tag.includes(` name="${name}"`))
		.map(tag => ({
			value: /value="([^"]*)"/u.exec(tag)?.[1] ?? "",
			checked: /\schecked(?=[\s>])/u.test(tag),
			disabled: /\sdisabled(?=[\s>])/u.test(tag),
		}));
}

describe("web: chọn tất cả trên bảng ô tick", () =>
{
	test("trang Team: ?chon=tat-ca tick mọi role dùng được (role bị khoá vẫn không tick), chưa ghi gì; bấm Lưu thì thêm team", async () =>
	{
		const harness = createWebHarness();
		const auth = await login(harness, ADMIN_USER);
		const plain = await call(harness, `/g/${GUILD}/teams`, { cookies: auth.cookies });
		assert.ok(plain.body.includes("✅ Chọn tất cả") && plain.body.includes("⬜ Bỏ chọn tất cả"));
		assert.ok(checkboxes(plain.body, "team").every(box => !box.checked));

		const all = await call(harness, `/g/${GUILD}/teams?chon=tat-ca`, { cookies: auth.cookies });
		const boxes = checkboxes(all.body, "team");
		assert.ok(boxes.find(box => box.value === ROLE_TEAM_A)?.checked);
		assert.ok(boxes.find(box => box.value === ROLE_TEAM_B)?.checked);
		const managed = boxes.find(box => box.value === ROLE_MANAGED);
		assert.ok(managed?.disabled && !managed.checked);
		assert.ok(all.body.includes("chưa lưu"));
		assert.deepEqual(harness.services.teams.list(GUILD), []);
		assert.ok(all.body.includes(`name="t:${ROLE_TEAM_A}" value="0"`), "input ẩn vẫn là giá trị đang lưu");

		const form: Record<string, string | string[]> = { team: boxes.filter(box => box.checked).map(box => box.value) };
		for (const box of boxes) form[`t:${box.value}`] = "0";
		const saved = await call(harness, `/g/${GUILD}/teams`, { cookies: auth.cookies, form: withCsrf(auth, form) });
		assert.equal(saved.status, 303);
		assert.ok(harness.services.teams.list(GUILD).includes(ROLE_TEAM_A));
		assert.ok(harness.services.teams.list(GUILD).includes(ROLE_TEAM_B));
		assert.ok(!harness.services.teams.list(GUILD).includes(ROLE_MANAGED));
	});

	test("trang Kênh tính XP: ?chon=tat-ca tick mọi kênh, ?chon=bo-het bỏ tick mọi kênh; giá trị lạ vẽ như đang lưu", async () =>
	{
		const harness = createWebHarness();
		const auth = await login(harness, ADMIN_USER);
		harness.services.guildConfig.updateSettings(GUILD, { xpChannelMode: "selected" }, ADMIN_USER);
		harness.services.guildConfig.setChannelsXpEnabled(GUILD, [CHANNEL_CHAT], true, ADMIN_USER);

		const all = checkboxes((await call(harness, `/g/${GUILD}/channels?chon=tat-ca`, { cookies: auth.cookies })).body, "on");
		assert.ok(all.length >= 2 && all.every(box => box.checked));
		const none = checkboxes((await call(harness, `/g/${GUILD}/channels?chon=bo-het`, { cookies: auth.cookies })).body, "on");
		assert.ok(none.every(box => !box.checked));
		const odd = checkboxes((await call(harness, `/g/${GUILD}/channels?chon=abc`, { cookies: auth.cookies })).body, "on");
		assert.equal(odd.find(box => box.value === CHANNEL_CHAT)?.checked, true);
		assert.equal(odd.find(box => box.value === CHANNEL_WORK)?.checked, false);
		assert.equal(harness.services.guildConfig.effectiveChannelXp(GUILD, CHANNEL_WORK).enabled, false, "chỉ vẽ, không ghi");
	});
});
