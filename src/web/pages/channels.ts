// Trang "Kênh tính XP" của web quản trị (DEC-039). Bản khung của nền móng Phase 16; agent trang hoàn thiện.
import { html } from "../html";
import { renderPage } from "../layout";
import { PageModule } from "../types";

export const channelsPage: PageModule = {
	routes: [
		{ method: "GET", path: "/channels", handler: ctx => renderPage(ctx, { nav: "channels", title: "Kênh tính XP", body: html`<p class="muted">Đang xây dựng.</p>` }) },
	],
};
