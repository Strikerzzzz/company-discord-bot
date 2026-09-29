// Trang "Tổng quan" của web quản trị (DEC-039). Bản khung của nền móng Phase 16; agent trang hoàn thiện.
import { html } from "../html";
import { renderPage } from "../layout";
import { PageModule } from "../types";

export const overviewPage: PageModule = {
	routes: [
		{ method: "GET", path: "", handler: ctx => renderPage(ctx, { nav: "overview", title: "Tổng quan", body: html`<p class="muted">Đang xây dựng.</p>` }) },
	],
};
