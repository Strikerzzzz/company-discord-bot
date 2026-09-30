// Trang "Bảng xếp hạng" (DEC-041). Chỗ giữ chỗ của nền móng Phase 17: agent phụ trách thay toàn bộ file, giữ tên export.
import { html } from "../html";
import { renderPage } from "../layout";
import { PageModule } from "../types";

export const leaderboardPage: PageModule = {
	routes: [
		{
			method: "GET",
			path: "/leaderboard",
			handler: ctx => renderPage(ctx, { nav: "leaderboard", title: "Bảng xếp hạng", body: html`<div class="card"><p class="muted">Đang xây dựng.</p></div>` }),
		},
	],
};
