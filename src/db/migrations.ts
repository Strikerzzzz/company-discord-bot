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
	{
		version: 9,
		name: "retro",
		sql: `
			-- Phiên retro sprint theo team (DEC-049). Mỗi phiên gắn với một kênh hoặc thread (nơi chạy /retro create) và tuỳ chọn một
			-- role team. status: 'open' (đang nhận câu trả lời), 'closed' (đã đóng), 'voting' (đang vote tên sprint), 'done' (đã chốt
			-- tên). tie_names: JSON mảng tên hoà khi vote đóng mà hoà (chờ người quản lý chọn); NULL = không có hoà đang chờ.
			-- confluence_*: kết quả lần ghi Confluence gần nhất. content_deleted_at: admin đã xoá nội dung (chữ) của phiên.
			-- summary_posted_at: lúc bot đăng được bảng tổng hợp của lần đóng gần nhất; NULL = chưa đăng (lịch quét thử lại, mở lại thì
			-- về NULL).
			CREATE TABLE retro_sessions (
				id INTEGER PRIMARY KEY,
				guild_id TEXT NOT NULL,
				title TEXT NOT NULL,
				channel_id TEXT NOT NULL,
				message_id TEXT,
				team_role_id TEXT,
				doc_url TEXT,
				doc_page_id TEXT,
				status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'voting', 'done')),
				closes_at INTEGER,
				created_by TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				closed_at INTEGER,
				poll_id INTEGER REFERENCES polls (id),
				tie_names TEXT,
				winner_name TEXT,
				confluence_written_at INTEGER,
				confluence_error TEXT,
				content_deleted_at INTEGER,
				summary_posted_at INTEGER
			);
			CREATE INDEX idx_retro_sessions_guild ON retro_sessions (guild_id, created_at);
			CREATE INDEX idx_retro_sessions_channel ON retro_sessions (guild_id, channel_id, created_at);
			CREATE INDEX idx_retro_sessions_due ON retro_sessions (status, closes_at);
			-- Một kênh chỉ có một phiên đang mở; một vote chỉ thuộc một phiên.
			CREATE UNIQUE INDEX idx_retro_sessions_open_channel ON retro_sessions (guild_id, channel_id) WHERE status = 'open';
			CREATE UNIQUE INDEX idx_retro_sessions_poll ON retro_sessions (poll_id) WHERE poll_id IS NOT NULL;

			-- Phiếu retro: mỗi người một phiếu mỗi phiên, sửa được tới khi đóng. Đây là chữ người dùng viết (DEC-049): chỉ hiển thị ẩn
			-- danh; admin xoá nội dung thì các cột chữ về NULL (xoá hẳn, ngoại lệ có chủ ý của DEC-027), dòng giữ lại để biết ai đã
			-- điền. team_role_ids: JSON role team của người điền lúc gửi lần gần nhất (snapshot cho XP người đề xuất tên thắng).
			-- fill_xp_event_id: event XP "điền retro" (một lần mỗi phiên), NULL nếu XP điền retro là 0.
			-- order_keys: JSON khoá ngẫu nhiên (randomBytes) của từng ô chữ, sinh lại khi ô đổi; mỗi cột được xếp theo khoá riêng của
			-- nó khi hiển thị, nên thứ tự không suy ra được từ mã phiếu hay thứ tự gửi, và một hàng không gom câu trả lời của một người.
			CREATE TABLE retro_entries (
				id INTEGER PRIMARY KEY,
				session_id INTEGER NOT NULL REFERENCES retro_sessions (id),
				guild_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				learned TEXT,
				improve TEXT,
				ideas TEXT,
				kudos TEXT,
				sprint_name TEXT,
				team_role_ids TEXT NOT NULL DEFAULT '[]',
				order_keys TEXT NOT NULL DEFAULT '{}',
				fill_xp_event_id INTEGER REFERENCES xp_events (id),
				submitted_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				UNIQUE (session_id, user_id)
			);

			-- XP của retro do admin chỉnh (DEC-049); guild chưa có dòng = mặc định 20 / 100 / 1440 phút.
			CREATE TABLE retro_config (
				guild_id TEXT PRIMARY KEY,
				fill_xp INTEGER NOT NULL DEFAULT 20,
				proposer_bonus_xp INTEGER NOT NULL DEFAULT 100,
				vote_minutes INTEGER NOT NULL DEFAULT 1440,
				updated_at INTEGER NOT NULL
			);

			-- Role "quản lý retro" (tối đa 25 role mỗi guild, RetroService kiểm tra).
			CREATE TABLE retro_manager_roles (
				guild_id TEXT NOT NULL,
				role_id TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				PRIMARY KEY (guild_id, role_id)
			);
		`,
	},
	{
		version: 10,
		name: "contribution_review",
		sql: `
			-- Duyệt contribution (DEC-051). review_state: 'pending' = chờ duyệt (chưa bấm 👍/👎 được); 'approved' = đã duyệt, cũng là
			-- giá trị của contribution có từ trước migration này; 'rejected' = bị từ chối (không tính điểm). reviewed_by/reviewed_at:
			-- người và lúc duyệt hoặc từ chối (NULL với contribution cũ). review_reason: lý do từ chối (không hiện công khai).
			-- Event "sàn" (nguồn 'vote', actor NULL, reference_id = id) đưa điểm của contribution về 0 khi 👎 nhiều hơn 👍 nằm trong
			-- contribution_events, không cần cột riêng: mỗi lần tính lại ghi một event chênh lệch, tổng các event sàn chưa huỷ bằng phần âm.
			ALTER TABLE contributions ADD COLUMN review_state TEXT NOT NULL DEFAULT 'approved' CHECK (review_state IN ('pending', 'approved', 'rejected'));
			ALTER TABLE contributions ADD COLUMN reviewed_by TEXT;
			ALTER TABLE contributions ADD COLUMN reviewed_at INTEGER;
			ALTER TABLE contributions ADD COLUMN review_reason TEXT;

			-- Contribution bị từ chối không chặn việc gửi lại cùng tin nhắn nguồn.
			DROP INDEX idx_contributions_source_message;
			CREATE UNIQUE INDEX idx_contributions_source_message ON contributions (guild_id, source_message_id)
				WHERE source_message_id IS NOT NULL AND status = 'active' AND review_state <> 'rejected';
			CREATE INDEX idx_contributions_review ON contributions (guild_id, review_state, created_at);

			-- Lượt 👎 Không ghi nhận (DEC-051): event_id là event âm trong contribution_events; reason bắt buộc (chỉ admin và người
			-- duyệt xem). locked_at: lượt bị khoá vì lần thêm/đổi sang 👎 phải bù điểm cho tác giả đang bị trừ (PROP-031), không
			-- đổi hay rút được nữa. Rút 👎 thì xoá dòng (event vẫn còn, đã huỷ), giống contribution_votes.
			CREATE TABLE contribution_downvotes (
				contribution_id INTEGER NOT NULL REFERENCES contributions (id),
				guild_id TEXT NOT NULL,
				voter_id TEXT NOT NULL,
				event_id INTEGER NOT NULL REFERENCES contribution_events (id),
				reason TEXT NOT NULL,
				locked_at INTEGER,
				created_at INTEGER NOT NULL,
				PRIMARY KEY (contribution_id, voter_id)
			);
			CREATE INDEX idx_contribution_downvotes_voter ON contribution_downvotes (guild_id, voter_id);

			-- XP cho người bấm 👍/👎 (DEC-051): một dòng mỗi người mỗi contribution, giữ vĩnh viễn (kể cả khi rút). xp_event_id: event
			-- XP gần nhất (NULL = không được XP: cấu hình 0 hoặc hết hạn mức ngày). revoked_at: lúc rút hẳn đã huỷ event XP đó (event vẫn
			-- còn, đã huỷ, nên biết số XP); bấm lại thì được lại tối đa chừng đó trong hạn mức ngày và revoked_at về NULL. Event bị admin
			-- reset, hoặc lần trước được 0 hay bị cắt, thì không bao giờ được cộng bù.
			CREATE TABLE contribution_interaction_xp (
				contribution_id INTEGER NOT NULL REFERENCES contributions (id),
				guild_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				xp_event_id INTEGER REFERENCES xp_events (id),
				revoked_at INTEGER,
				created_at INTEGER NOT NULL,
				PRIMARY KEY (contribution_id, user_id)
			);
			CREATE INDEX idx_contribution_interaction_xp_user ON contribution_interaction_xp (guild_id, user_id, created_at);
			-- Lượt 👍 có từ trước migration này coi như đã tương tác, không được XP (review Phase 20): không có dòng thì rút rồi bấm lại
			-- sẽ được XP như lần đầu, thành cách cày XP trên các contribution cũ.
			INSERT INTO contribution_interaction_xp (contribution_id, guild_id, user_id, xp_event_id, revoked_at, created_at)
				SELECT v.contribution_id, c.guild_id, v.voter_id, NULL, NULL, v.created_at
				FROM contribution_votes v JOIN contributions c ON c.id = v.contribution_id;

			-- Cấu hình (DEC-051): kênh đăng thẻ contribution (NULL = chưa chọn, chưa gửi được), XP cho người bấm và hạn mức ngày (0 =
			-- không giới hạn).
			ALTER TABLE guild_settings ADD COLUMN contribution_channel_id TEXT;
			ALTER TABLE guild_settings ADD COLUMN contribution_interaction_xp INTEGER NOT NULL DEFAULT 5;
			ALTER TABLE guild_settings ADD COLUMN contribution_interaction_xp_daily_cap INTEGER NOT NULL DEFAULT 25;

			-- Thêm loại 'contribution_reviewer' (role duyệt contribution, ngoài admin) cho guild_role_grants: CHECK không sửa được
			-- nên dựng lại bảng, chép nguyên dữ liệu (bảng không có index phụ, không bảng nào tham chiếu tới).
			CREATE TABLE guild_role_grants_v10 (
				guild_id TEXT NOT NULL,
				kind TEXT NOT NULL CHECK (kind IN ('admin', 'poll_creator', 'contribution_reviewer')),
				role_id TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				PRIMARY KEY (guild_id, kind, role_id)
			);
			INSERT INTO guild_role_grants_v10 (guild_id, kind, role_id, created_at)
				SELECT guild_id, kind, role_id, created_at FROM guild_role_grants;
			DROP TABLE guild_role_grants;
			ALTER TABLE guild_role_grants_v10 RENAME TO guild_role_grants;
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
