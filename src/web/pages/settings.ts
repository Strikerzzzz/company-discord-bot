// Trang "Cài đặt điểm" của web quản trị (DEC-039). Bản khung của nền móng Phase 16; agent trang hoàn thiện.
import { html } from "../html";
import { renderPage } from "../layout";
import { PageModule } from "../types";

export const settingsPage: PageModule = {
	routes: [
		{ method: "GET", path: "/settings", handler: ctx => renderPage(ctx, { nav: "settings", title: "Cài đặt điểm", body: html`<p class="muted">Đang xây dựng.</p>` }) },
	],
};
