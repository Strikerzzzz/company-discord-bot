import { Db } from "./connection";

export interface Migration
{
	version: number;
	name: string;
	sql: string;
}

/**
 * Migration nhúng trong code (không đọc file .sql lúc chạy) để deploy chỉ cần thư mục build/.
 * Quy tắc: chỉ THÊM migration mới với version tăng dần; không bao giờ sửa migration đã phát hành.
 */
export const MIGRATIONS: readonly Migration[] = [
	{
		version: 1,
		name: "init",
		sql: `
			DROP TABLE IF EXISTS notes;

			CREATE TABLE guild_settings (
				guild_id TEXT PRIMARY KEY,
				xp_per_message INTEGER NOT NULL,
				xp_cooldown_seconds INTEGER NOT NULL,
				min_message_length INTEGER NOT NULL,
				duplicate_window_seconds INTEGER NOT NULL,
				level_up_announcements INTEGER NOT NULL,
				default_poll_xp INTEGER NOT NULL,
				contribution_vote_points INTEGER NOT NULL,
				admin_role_id TEXT,
				poll_creator_role_id TEXT,
				updated_at INTEGER NOT NULL
			);

			CREATE TABLE channel_settings (
				guild_id TEXT NOT NULL,
				channel_id TEXT NOT NULL,
				xp_enabled INTEGER NOT NULL,
				xp_per_message INTEGER,
				xp_cooldown_seconds INTEGER,
				updated_at INTEGER NOT NULL,
				PRIMARY KEY (guild_id, channel_id)
			);

			CREATE TABLE team_roles (
				guild_id TEXT NOT NULL,
				role_id TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				PRIMARY KEY (guild_id, role_id)
			);

			-- Activity XP: ledger append-only. Reset/gỡ chỉ đánh dấu voided_at (DEC-027).
			CREATE TABLE xp_events (
				id INTEGER PRIMARY KEY,
				guild_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				amount INTEGER NOT NULL,
				source TEXT NOT NULL CHECK (source IN ('message', 'poll', 'admin')),
				reference_id TEXT,
				actor_id TEXT,
				reason TEXT,
				created_at INTEGER NOT NULL,
				voided_at INTEGER
			);
			CREATE INDEX idx_xp_events_user ON xp_events (guild_id, user_id);
			CREATE INDEX idx_xp_events_created ON xp_events (guild_id, created_at);
			CREATE INDEX idx_xp_events_reference ON xp_events (guild_id, reference_id);

			-- Snapshot role team của người nhận điểm tại thời điểm phát sinh (DEC-024).
			CREATE TABLE xp_event_teams (
				event_id INTEGER NOT NULL REFERENCES xp_events (id),
				role_id TEXT NOT NULL,
				PRIMARY KEY (event_id, role_id)
			);
			CREATE INDEX idx_xp_event_teams_role ON xp_event_teams (role_id);

			-- Tổng XP (cache của ledger) và thời điểm được XP từ tin nhắn gần nhất (cooldown sống qua restart).
			CREATE TABLE member_xp (
				guild_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				total INTEGER NOT NULL DEFAULT 0,
				last_message_xp_at INTEGER,
				PRIMARY KEY (guild_id, user_id)
			);
			CREATE INDEX idx_member_xp_rank ON member_xp (guild_id, total DESC);

			-- Contribution: hoàn toàn tách biệt với Activity XP (DEC-004).
			CREATE TABLE contributions (
				id INTEGER PRIMARY KEY,
				guild_id TEXT NOT NULL,
				author_id TEXT NOT NULL,
				submitted_by TEXT NOT NULL,
				title TEXT NOT NULL,
				description TEXT NOT NULL,
				category TEXT NOT NULL,
				link TEXT,
				channel_id TEXT,
				message_id TEXT,
				status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
				created_at INTEGER NOT NULL,
				removed_at INTEGER,
				removed_by TEXT
			);
			CREATE INDEX idx_contributions_guild ON contributions (guild_id, created_at);
			CREATE INDEX idx_contributions_author ON contributions (guild_id, author_id);

			CREATE TABLE contribution_teams (
				contribution_id INTEGER NOT NULL REFERENCES contributions (id),
				role_id TEXT NOT NULL,
				PRIMARY KEY (contribution_id, role_id)
			);

			CREATE TABLE contribution_events (
				id INTEGER PRIMARY KEY,
				guild_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				amount INTEGER NOT NULL,
				source TEXT NOT NULL CHECK (source IN ('vote', 'admin')),
				reference_id TEXT,
				actor_id TEXT,
				reason TEXT,
				created_at INTEGER NOT NULL,
				voided_at INTEGER
			);
			CREATE INDEX idx_contribution_events_user ON contribution_events (guild_id, user_id);
			CREATE INDEX idx_contribution_events_created ON contribution_events (guild_id, created_at);
			CREATE INDEX idx_contribution_events_reference ON contribution_events (guild_id, reference_id);

			CREATE TABLE contribution_event_teams (
				event_id INTEGER NOT NULL REFERENCES contribution_events (id),
				role_id TEXT NOT NULL,
				PRIMARY KEY (event_id, role_id)
			);
			CREATE INDEX idx_contribution_event_teams_role ON contribution_event_teams (role_id);

			CREATE TABLE member_contribution (
				guild_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				total INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (guild_id, user_id)
			);
			CREATE INDEX idx_member_contribution_rank ON member_contribution (guild_id, total DESC);

			-- Mỗi người ghi nhận một contribution tối đa một lần; rút ghi nhận thì xoá dòng và void event.
			CREATE TABLE contribution_votes (
				contribution_id INTEGER NOT NULL REFERENCES contributions (id),
				voter_id TEXT NOT NULL,
				event_id INTEGER NOT NULL REFERENCES contribution_events (id),
				created_at INTEGER NOT NULL,
				PRIMARY KEY (contribution_id, voter_id)
			);

			-- Vote / bầu cử / lấy ý kiến (DEC-026). Phiếu ẩn danh: chỉ hiển thị số lượng.
			CREATE TABLE polls (
				id INTEGER PRIMARY KEY,
				guild_id TEXT NOT NULL,
				creator_id TEXT NOT NULL,
				question TEXT NOT NULL,
				multi_select INTEGER NOT NULL,
				xp_reward INTEGER NOT NULL,
				channel_id TEXT,
				message_id TEXT,
				closes_at INTEGER,
				closed_at INTEGER,
				created_at INTEGER NOT NULL
			);
			CREATE INDEX idx_polls_guild ON polls (guild_id, created_at);
			CREATE INDEX idx_polls_due ON polls (closed_at, closes_at);

			CREATE TABLE poll_options (
				poll_id INTEGER NOT NULL REFERENCES polls (id),
				option_index INTEGER NOT NULL,
				label TEXT NOT NULL,
				PRIMARY KEY (poll_id, option_index)
			);

			CREATE TABLE poll_votes (
				poll_id INTEGER NOT NULL,
				user_id TEXT NOT NULL,
				option_index INTEGER NOT NULL,
				created_at INTEGER NOT NULL,
				PRIMARY KEY (poll_id, user_id, option_index),
				FOREIGN KEY (poll_id, option_index) REFERENCES poll_options (poll_id, option_index)
			);

			-- Người đã tham gia vote: XP chỉ cộng một lần cho mỗi người ở mỗi vote.
			CREATE TABLE poll_participants (
				poll_id INTEGER NOT NULL REFERENCES polls (id),
				user_id TEXT NOT NULL,
				xp_event_id INTEGER REFERENCES xp_events (id),
				first_voted_at INTEGER NOT NULL,
				PRIMARY KEY (poll_id, user_id)
			);

			CREATE TABLE audit_log (
				id INTEGER PRIMARY KEY,
				guild_id TEXT NOT NULL,
				actor_id TEXT NOT NULL,
				action TEXT NOT NULL,
				target_id TEXT,
				details TEXT,
				created_at INTEGER NOT NULL
			);
			CREATE INDEX idx_audit_log_guild ON audit_log (guild_id, created_at);
		`,
	},
	{
		version: 2,
		name: "team_totals_and_contribution_source",
		sql: `
			-- Tổng điểm theo team (cache của ledger theo snapshot team, DEC-024), cập nhật trong cùng transaction với ledger.
			-- Lưu mọi role từng có trong snapshot, kể cả role chưa hoặc không còn là team; lúc đọc mới lọc theo team_roles.
			CREATE TABLE xp_team_totals (
				guild_id TEXT NOT NULL,
				role_id TEXT NOT NULL,
				total INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (guild_id, role_id)
			);

			CREATE TABLE contribution_team_totals (
				guild_id TEXT NOT NULL,
				role_id TEXT NOT NULL,
				total INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (guild_id, role_id)
			);

			INSERT INTO xp_team_totals (guild_id, role_id, total)
			SELECT e.guild_id, et.role_id, SUM(e.amount)
			FROM xp_event_teams et
			JOIN xp_events e ON e.id = et.event_id
			WHERE e.voided_at IS NULL
			GROUP BY e.guild_id, et.role_id;

			INSERT INTO contribution_team_totals (guild_id, role_id, total)
			SELECT e.guild_id, et.role_id, SUM(e.amount)
			FROM contribution_event_teams et
			JOIN contribution_events e ON e.id = et.event_id
			WHERE e.voided_at IS NULL
			GROUP BY e.guild_id, et.role_id;

			-- Tin nhắn nguồn khi ghi nhận qua context menu: mỗi tin chỉ là nguồn của một contribution còn hiệu lực trong guild.
			ALTER TABLE contributions ADD COLUMN source_message_id TEXT;
			CREATE UNIQUE INDEX idx_contributions_source_message ON contributions (guild_id, source_message_id)
				WHERE source_message_id IS NOT NULL AND status = 'active';
		`,
	},
	{
		version: 3,
		name: "gamification",
		sql: `
			-- Giới hạn XP một người nhận từ vote trong một ngày giờ Việt Nam; 0 = không giới hạn (DEC-028).
			ALTER TABLE guild_settings ADD COLUMN poll_xp_daily_cap INTEGER NOT NULL DEFAULT 25;

			-- Role Discord tự gán theo cảnh giới (DEC-031). tier_key là khoá trong src/modules/activity/tiers.ts.
			CREATE TABLE tier_roles (
				guild_id TEXT NOT NULL,
				tier_key TEXT NOT NULL,
				role_id TEXT NOT NULL,
				updated_at INTEGER NOT NULL,
				PRIMARY KEY (guild_id, tier_key)
			);
			CREATE UNIQUE INDEX idx_tier_roles_role ON tier_roles (guild_id, role_id);

			-- "Bảng vàng": message bảng xếp hạng bot tự cập nhật trong một channel (DEC-030). message_id null = chưa đăng.
			CREATE TABLE live_boards (
				guild_id TEXT PRIMARY KEY,
				channel_id TEXT NOT NULL,
				message_id TEXT,
				updated_at INTEGER NOT NULL
			);

			-- Bảng xếp hạng tuần/tháng: quét theo khoảng thời gian, chỉ gồm event chưa huỷ (DEC-029). SQLite không coi partial index
			-- "voided_at IS NULL" là index phủ, nên vẫn đọc dòng bảng; 200k event: bảng tháng khoảng 25 ms, team tháng khoảng 56 ms.
			CREATE INDEX idx_xp_events_period ON xp_events (guild_id, created_at, user_id, amount) WHERE voided_at IS NULL;
			CREATE INDEX idx_contribution_events_period ON contribution_events (guild_id, created_at, user_id, amount) WHERE voided_at IS NULL;
			-- Chuỗi ngày hoạt động, số tin được XP, XP từ vote trong ngày: theo người và nguồn.
			CREATE INDEX idx_xp_events_user_source ON xp_events (guild_id, user_id, source, created_at) WHERE voided_at IS NULL;
			CREATE INDEX idx_contribution_votes_voter ON contribution_votes (voter_id);
			CREATE INDEX idx_poll_participants_user ON poll_participants (user_id);
		`,
	},
	{
		version: 4,
		name: "tier_sets",
		sql: `
			-- Bậc danh hiệu dùng khoá vị trí chung cho mọi bộ (DEC-033): đổi khoá cảnh giới tu tiên cũ sang bac-1 … bac-8.
			UPDATE tier_roles SET tier_key = CASE tier_key
				WHEN 'luyen-khi' THEN 'bac-1'
				WHEN 'truc-co' THEN 'bac-2'
				WHEN 'kim-dan' THEN 'bac-3'
				WHEN 'nguyen-anh' THEN 'bac-4'
				WHEN 'hoa-than' THEN 'bac-5'
				WHEN 'luyen-hu' THEN 'bac-6'
				WHEN 'hop-the' THEN 'bac-7'
				WHEN 'do-kiep' THEN 'bac-8'
				ELSE tier_key END;
			-- 1 = role do bot tự tạo bằng chức năng tạo/đồng bộ role (chỉ để hiển thị và dọn dẹp; quy tắc an toàn áp dụng như nhau).
			ALTER TABLE tier_roles ADD COLUMN created_by_bot INTEGER NOT NULL DEFAULT 0;

			-- Bộ danh hiệu guild đang dùng; không có dòng = bộ mặc định (tu-tien).
			CREATE TABLE tier_set_config (
				guild_id TEXT PRIMARY KEY,
				set_key TEXT NOT NULL,
				updated_at INTEGER NOT NULL
			);

			-- Tên/emoji tuỳ chỉnh theo từng bộ, nên đổi sang bộ khác rồi quay lại vẫn giữ. NULL = dùng mặc định của bộ.
			CREATE TABLE tier_name_overrides (
				guild_id TEXT NOT NULL,
				set_key TEXT NOT NULL,
				tier_key TEXT NOT NULL,
				name TEXT,
				emoji TEXT,
				updated_at INTEGER NOT NULL,
				PRIMARY KEY (guild_id, set_key, tier_key)
			);
		`,
	},
	{
		version: 5,
		name: "xp_channel_mode",
		sql: `
			-- Chế độ kênh tính XP (DEC-037): 'all' = mọi kênh trừ kênh đã tắt; 'selected' = chỉ kênh admin bật riêng.
			-- Cấu hình riêng của kênh (channel_settings) luôn thắng chế độ.
			ALTER TABLE guild_settings ADD COLUMN xp_channel_mode TEXT NOT NULL DEFAULT 'all' CHECK (xp_channel_mode IN ('all', 'selected'));
		`,
	},
	{
		version: 6,
		name: "level_up_channel",
		sql: `
			-- Kênh nhận thông báo lên level/lên bậc (DEC-043). NULL = gửi ở kênh thành viên vừa nhắn (hành vi trước đây).
			ALTER TABLE guild_settings ADD COLUMN level_up_channel_id TEXT;
		`,
	},
	{
		version: 7,
		name: "role_grants",
		sql: `
			-- Nhiều role admin bot và nhiều role được tạo vote (DEC-044): mỗi dòng cấp một quyền cho một role. kind 'admin' = role
			-- admin bot (ngoài người có Manage Server), 'poll_creator' = role được tạo vote (ngoài admin). Thứ tự hiển thị theo
			-- created_at rồi role_id; tối đa 25 role mỗi loại do GuildConfigService kiểm tra.
			CREATE TABLE guild_role_grants (
				guild_id TEXT NOT NULL,
				kind TEXT NOT NULL CHECK (kind IN ('admin', 'poll_creator')),
				role_id TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				PRIMARY KEY (guild_id, kind, role_id)
			);

			-- Chép role đang đặt ở hai cột cũ (mỗi loại một role) sang bảng mới, giữ mốc thời gian lần sửa cấu hình cuối.
			INSERT INTO guild_role_grants (guild_id, kind, role_id, created_at)
				SELECT guild_id, 'admin', admin_role_id, updated_at FROM guild_settings WHERE admin_role_id IS NOT NULL;
			INSERT INTO guild_role_grants (guild_id, kind, role_id, created_at)
				SELECT guild_id, 'poll_creator', poll_creator_role_id, updated_at FROM guild_settings WHERE poll_creator_role_id IS NOT NULL;

			-- Hai cột cũ giữ lại (không xoá cột) nhưng về NULL: từ version 7 code không đọc hay ghi hai cột này nữa.
			UPDATE guild_settings SET admin_role_id = NULL, poll_creator_role_id = NULL;
		`,
	},
	{
		version: 8,
		name: "member_tier_prefs",
		sql: `
			-- Bộ danh hiệu mỗi thành viên tự chọn để hiển thị cho chính mình (DEC-047): chỉ đổi thẻ /rank và lời chúc lên level/lên
			-- bậc của người đó; role, bảng xếp hạng, Bảng vàng vẫn theo bộ chung của server. Không có dòng = theo server. set_key là
			-- khoá trong src/modules/activity/tiers.ts; khoá lạ (DB sửa tay, bộ đã bị bỏ) được đọc như "theo server". Đây là lựa chọn
			-- hiển thị, không phải điểm, nên bỏ lựa chọn thì xoá dòng.
			CREATE TABLE member_tier_prefs (
				guild_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				set_key TEXT NOT NULL,
				updated_at INTEGER NOT NULL,
				PRIMARY KEY (guild_id, user_id)
			);

			-- Công tắc "cho phép thành viên tự chọn bộ danh hiệu" (DEC-047), mặc định bật; guild chưa có dòng tier_set_config cũng là bật.
			-- Tắt thì mọi người hiển thị theo bộ chung, lựa chọn đã lưu vẫn giữ để bật lại thì dùng lại.
			ALTER TABLE tier_set_config ADD COLUMN allow_personal INTEGER NOT NULL DEFAULT 1 CHECK (allow_personal IN (0, 1));
		`,
	},
];

export function currentSchemaVersion(db: Db): number
{
	return db.pragma("user_version", { simple: true }) as number;
}

/**
 * Chạy các migration chưa áp dụng, mỗi migration trong một transaction; version lưu ở PRAGMA user_version.
 * Từ chối chạy nếu database mới hơn code (tránh code cũ ghi đè schema mới).
 */
export function runMigrations(db: Db, migrations: readonly Migration[] = MIGRATIONS): number
{
	const latest = migrations.reduce((max, migration) => Math.max(max, migration.version), 0);
	const current = currentSchemaVersion(db);
	if (current > latest)
	{
		throw new Error(`Database đang ở schema version ${current}, mới hơn code (tối đa ${latest}). Hãy cập nhật code bot.`);
	}

	const pending = migrations.filter(migration => migration.version > current).sort((a, b) => a.version - b.version);
	for (const migration of pending)
	{
		db.transaction(() =>
		{
			db.exec(migration.sql);
			// version là số nguyên do code định nghĩa, không phải input người dùng.
			db.pragma(`user_version = ${Math.trunc(migration.version)}`);
		})();
	}
	return pending.length;
}
