// Danh sách trang của web quản trị (DEC-039, DEC-041). Thêm trang: tạo module trong thư mục này rồi thêm vào PAGE_MODULES.
import { overviewPage } from "./overview";
import { membersPage } from "./members";
import { leaderboardPage } from "./leaderboard";
import { contributionsPage } from "./contributions";
import { pollsPage } from "./polls";
import { retroPage } from "./retro";
import { retroSettingsPage } from "./retroSettings";
import { statsPage } from "./stats";
import { channelsPage } from "./channels";
import { teamsPage } from "./teams";
import { settingsPage } from "./settings";
import { rolesPage } from "./roles";
import { boardPage } from "./board";
import { tiersPage } from "./tiers";
import { resetPage } from "./reset";
import { backupPage } from "./backup";
import { auditPage } from "./audit";
import { PageModule } from "../types";

export const PAGE_MODULES: readonly PageModule[] = [
	overviewPage,
	membersPage,
	leaderboardPage,
	contributionsPage,
	pollsPage,
	retroPage,
	retroSettingsPage,
	statsPage,
	channelsPage,
	teamsPage,
	settingsPage,
	rolesPage,
	boardPage,
	tiersPage,
	resetPage,
	backupPage,
	auditPage,
];
