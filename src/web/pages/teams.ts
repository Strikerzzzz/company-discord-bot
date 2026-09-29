// Trang "Team" của web quản trị (DEC-039). Bản khung của nền móng Phase 16; agent trang hoàn thiện.
import { html } from "../html";
import { renderPage } from "../layout";
import { PageModule } from "../types";

export const teamsPage: PageModule = {
	routes: [
		{ method: "GET", path: "/teams", handler: ctx => renderPage(ctx, { nav: "teams", title: "Team", body: html`<p class="muted">Đang xây dựng.</p>` }) },
	],
};
