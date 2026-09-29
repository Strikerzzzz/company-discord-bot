// Trang "Danh hiệu" của web quản trị (DEC-039). Bản khung của nền móng Phase 16; agent trang hoàn thiện.
import { html } from "../html";
import { renderPage } from "../layout";
import { PageModule } from "../types";

export const tiersPage: PageModule = {
	routes: [
		{ method: "GET", path: "/tiers", handler: ctx => renderPage(ctx, { nav: "tiers", title: "Danh hiệu", body: html`<p class="muted">Đang xây dựng.</p>` }) },
	],
};
