// Trang "Reset điểm" (DEC-041). Chỗ giữ chỗ của nền móng Phase 17: agent phụ trách thay toàn bộ file, giữ tên export.
import { html } from "../html";
import { renderPage } from "../layout";
import { PageModule } from "../types";

export const resetPage: PageModule = {
	routes: [
		{
			method: "GET",
			path: "/reset",
			handler: ctx => renderPage(ctx, { nav: "reset", title: "Reset điểm", body: html`<div class="card"><p class="muted">Đang xây dựng.</p></div>` }),
		},
	],
};
