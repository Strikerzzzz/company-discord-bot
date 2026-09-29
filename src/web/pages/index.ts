// Danh sách trang của web quản trị (DEC-039). Thêm trang: tạo module trong thư mục này rồi thêm vào PAGE_MODULES.
import { overviewPage } from "./overview";
import { channelsPage } from "./channels";
import { teamsPage } from "./teams";
import { settingsPage } from "./settings";
import { rolesPage } from "./roles";
import { boardPage } from "./board";
import { tiersPage } from "./tiers";
import { auditPage } from "./audit";
import { PageModule } from "../types";

export const PAGE_MODULES: readonly PageModule[] = [
	overviewPage,
	channelsPage,
	teamsPage,
	settingsPage,
	rolesPage,
	boardPage,
	tiersPage,
	auditPage,
];
