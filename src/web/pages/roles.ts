// Trang "Quyền" của web quản trị (DEC-039). Bản khung của nền móng Phase 16; agent trang hoàn thiện.
import { html } from "../html";
import { renderPage } from "../layout";
import { PageModule } from "../types";

export const rolesPage: PageModule = {
	routes: [
		{ method: "GET", path: "/roles", handler: ctx => renderPage(ctx, { nav: "roles", title: "Quyền", body: html`<p class="muted">Đang xây dựng.</p>` }) },
	],
};
