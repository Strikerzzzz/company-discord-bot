// Trang "Bảng vàng" của web quản trị (DEC-039). Bản khung của nền móng Phase 16; agent trang hoàn thiện.
import { html } from "../html";
import { renderPage } from "../layout";
import { PageModule } from "../types";

export const boardPage: PageModule = {
	routes: [
		{ method: "GET", path: "/board", handler: ctx => renderPage(ctx, { nav: "board", title: "Bảng vàng", body: html`<p class="muted">Đang xây dựng.</p>` }) },
	],
};
