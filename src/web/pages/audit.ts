// Trang "Nhật ký quản trị" của web quản trị (DEC-039). Bản khung của nền móng Phase 16; agent trang hoàn thiện.
import { html } from "../html";
import { renderPage } from "../layout";
import { PageModule } from "../types";

export const auditPage: PageModule = {
	routes: [
		{ method: "GET", path: "/audit", handler: ctx => renderPage(ctx, { nav: "audit", title: "Nhật ký quản trị", body: html`<p class="muted">Đang xây dựng.</p>` }) },
	],
};
