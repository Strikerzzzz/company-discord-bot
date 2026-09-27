# ARCHITECTURE

> Cập nhật lần cuối: 2026-09-27, Phase 12 (gamification và ảnh thẻ, branch `phase-12/gamification`). Phase 2–10 đã merge vào `main`.
> Mô tả kiến trúc **hiện tại**, theo source code thực tế.

## 1. Tổng quan

```
Discord ──► Tầng Discord (mỏng) ──► Service nghiệp vụ ──► Ledger / Repository ──► SQLite (1 file)
            events, commands,        modules/*              modules/ledger,
            views, guards            (không import          *Repository.ts
                                     discord.js)
```

- **Topology** (DEC-002, DEC-016): 1 process Node.js (Linux, Node 24 LTS), 1 file SQLite (WAL), kết nối ra Discord (API và CDN avatar, DEC-030). Không mở port, không có hạ tầng nào khác.
- **Hai hệ thống điểm độc lập** (DEC-004): Activity XP dùng `xp_events` + `member_xp`; Contribution Score dùng `contribution_events` + `member_contribution`. Hai hệ thống dùng hai instance `Ledger` riêng và không bao giờ cộng gộp.
- **Hướng phụ thuộc**: `discord` → `modules` → `db` / `shared`. ESLint chặn `src/modules/**`, `src/db/**`, `src/shared/**` import discord.js (DEC-007).

## 2. Cấu trúc thư mục

```
src/
├── index.ts                  Composition root: config → mở DB + migrate → services → lịch backup → client → login
├── config.ts                 Đọc và validate biến môi trường (DEC-015)
├── services.ts               AppServices + createServices(): khởi tạo mọi service bằng constructor injection
├── shared/                   clock (inject được), errors (UserError), logger (che token), time (ngày/tuần/tháng giờ Việt Nam)
├── db/
│   ├── connection.ts         openDatabase(): 1 connection, WAL, foreign_keys, busy_timeout
│   ├── migrations.ts         Migration nhúng trong code, version lưu ở PRAGMA user_version (append-only)
│   └── backup.ts             BackupService (db.backup(), giữ N bản) + lịch kiểm tra mỗi giờ (DEC-017)
├── modules/                  Nghiệp vụ, KHÔNG import discord.js
│   ├── deps.ts               ServiceDeps: clock, guildConfig, teams, audit, xpLedger, contributionLedger
│   ├── ledger/Ledger.ts      Sổ cái điểm append-only + cache tổng + snapshot team (PROP-014)
│   ├── guild-config/         Cấu hình guild/channel, giới hạn hợp lệ, permissions (isAdmin, canCreatePoll)
│   ├── team/                 Team = role do admin chỉ định; resolveTeams() tạo snapshot
│   ├── audit/                Nhật ký thao tác quản trị
│   ├── activity/             levels (5n²+50n+100), tiers (8 cảnh giới tu tiên), antiSpam (chống trùng trong RAM), ActivityService
│   ├── contribution/         ContributionService (bù điểm để tổng không âm, PROP-024) + ContributionRepository
│   ├── poll/                 PollService (giới hạn XP từ vote mỗi ngày, PROP-028) + PollRepository
│   ├── leaderboard/          12 bảng: cá nhân/team × activity/contribution × tổng/tuần/tháng; userStanding
│   ├── gamification/         GamificationService (hồ sơ: cảnh giới, chuỗi ngày, huy hiệu, XP tuần), streaks,
│   │                         achievements (15 huy hiệu), GamificationRepository, TierRoleService (role theo cảnh giới)
│   ├── live-board/           LiveBoardService: kênh và message của Bảng vàng
│   └── statistics/           Thống kê tổng quan 7 ngày cho admin
├── classes/                  Base class Command / ContextMenu / Event, DiscordClient (có `avatars`, `members`), ProcessManager
├── handlers/                 loadModules (nạp theo thư mục), EventHandler, InteractionHandler (deploy), ButtonHandler
├── events/                   clientReady (deploy, lịch đóng vote, lịch Bảng vàng), interactionCreate (dispatcher),
│                             messageCreate (XP, thông báo lên level/đột phá, đồng bộ role cảnh giới)
├── interactions/
│   ├── commands/             ping, rank, leaderboard, contribution, poll, admin, config
│   └── contextMenus/         RecognizeContribution ("Ghi nhận đóng góp")
└── discord/                  Helper của tầng Discord
    ├── guards.ts             requireGuildId, assertAdmin/checkAdmin, checkCanCreatePoll,
    │                         canSendMessages (chặn đăng hộ vào kênh chỉ đọc), canViewChannel/filterViewable
    ├── members.ts            roleIdsOf()
    ├── format.ts             Số vi-VN, truncate theo UTF-16, fitLines, disableMaskedLinks, DISCORD_LIMITS, mention, màu
    ├── messages.ts           Sửa message đã đăng (contribution, vote); lỗi chỉ ghi log
    ├── pollScheduler.ts      Tự đóng vote quá hạn và sửa message
    ├── cards/                Vẽ ảnh PNG bằng @napi-rs/canvas (DEC-030): rankCard, leaderboardCard, draw, decor, icons,
    │                         theme, fonts (tìm assets/fonts theo __dirname); types.ts là hợp đồng dữ liệu ảnh
    ├── cardData.ts           Dựng dữ liệu ảnh từ service (hàm thuần) + loader tên/avatar; rankSummaryText
    ├── avatars.ts            AvatarFetcher: tải avatar từ CDN Discord (allowlist host, timeout, giới hạn dung lượng, cache)
    ├── memberDirectory.ts    Tên hiển thị + avatar URL theo user ID: cache discord.js → cache TTL → REST từng người
    ├── liveBoard.ts          Bảng vàng: đăng/sửa message 2–3 ảnh, khoá theo guild, lịch 10 phút
    ├── roleSync.ts           Đồng bộ role cảnh giới (từng role một), tierRoleSafetyIssue (chặn role nguy hiểm)
    └── views/                Hàm thuần dựng embed/nút: activity, contribution, poll, admin, progression (lên level/đột phá)
assets/fonts/                 Be Vietnam Pro (4 weight) + OFL.txt
test/                         node:test + SQLite :memory: (xem mục 7)
deploy/                       Unit systemd
docs/DEPLOY.md                Runbook triển khai và vận hành
```

## 3. Luồng chính

### 3.1 Khởi động
`index.ts`:
1. `loadConfig()`;
2. `openDatabase()` + `runMigrations()`, **trước** khi login (LL-007);
3. `createServices()`;
4. `startBackupSchedule()`;
5. `new DiscordClient(services, guildIds)`;
6. `ProcessManager` với các hook tắt: dừng backup → `client.destroy()` → `db.close()`;
7. `login()`.

Khi `clientReady`:
- deploy toàn bộ command theo guild, set global command về rỗng;
- khởi động lịch đóng vote (30 giây một lần);
- khởi động lịch Bảng vàng (10 phút một lần, lượt đầu sau 15 giây).

### 3.2 Tin nhắn → Activity XP
```
messageCreate  (bỏ qua bot, webhook, tin hệ thống, tin ngoài guild; thread → dùng channel cha)
  → ActivityService.handleMessage
      1. channel tắt XP?                 → channel_disabled
      2. chống trùng trong RAM (hash)    → duplicate      (DEC-023, không lưu nội dung)
      3. tin quá ngắn?                   → too_short
      4. transaction: cooldown theo member_xp.last_message_xp_at → cooldown
                      Ledger.record(xp, snapshot team) + cập nhật last_message_xp_at
  → lên level và bật thông báo → vượt mốc cảnh giới thì gửi thông báo "đột phá", ngược lại gửi "tu vi tăng tiến"
    (views/progression.ts; chỉ ping đúng người đó)
  → mọi tin được XP: syncTierRoles (thêm role cảnh giới hiện tại, bỏ role cảnh giới khác; DEC-031)
```

### 3.3 Contribution (DEC-025)
- **Gửi contribution**:
  - `/contribution submit` → `ContributionService.submit` (validate, lưu snapshot team của tác giả).
  - Context menu "Ghi nhận đóng góp": **không chép nội dung tin nhắn**. Chỉ lưu link, `source_message_id` và tiêu đề cố định kiểu "Đóng góp từ tin nhắn trong #kênh" (PEND-017). Mỗi tin nhắn chỉ là nguồn của một contribution còn hiệu lực. Context menu lấy role của tác giả qua REST sau khi `deferReply`.
  - Bot đăng message công khai kèm nút `contrib:<id>` và lưu vị trí message. Người không có quyền gửi tin ở kênh đó thì bị từ chối.
- **Bấm nút ghi nhận** → `toggleVote`:
  - không tự ghi nhận; đã ghi nhận thì rút (void event);
  - lượt đã bị admin reset thì không ghi nhận lại được (PEND-015);
  - điểm = `contributionVotePoints` tại thời điểm ghi nhận;
  - `votes` chỉ đếm lượt còn hiệu lực.
- **Xem**: `/contribution view` trả lời riêng, không có nút; có nút link tới bài đăng gốc.
- **Admin gỡ contribution** → `voidByReference` huỷ mọi điểm của nó, và message gốc chuyển sang "Đã bị gỡ".

### 3.4 Vote / bầu cử (DEC-026)
- `/poll create`: chỉ admin hoặc role tạo vote; XP riêng chỉ admin đặt được. Nút có dạng `poll:<id>:<index>`.
- Bấm nút: chọn một thì đổi phiếu, chọn nhiều thì bật/tắt. Lần tham gia đầu được XP (Activity) một lần. Phiếu ẩn danh.
- XP từ vote bị giới hạn theo ngày giờ Việt Nam (`pollXpDailyCap`, mặc định 25, DEC-028); phần bị cắt không cộng bù.
- Lịch `pollScheduler` gọi `closeDue()`, rồi sửa message sang trạng thái đóng.

### 3.4b Hồ sơ, bảng xếp hạng và Bảng vàng (DEC-029, DEC-030)
- `/rank`: `deferReply` → hồ sơ Activity + Contribution + Gamification → tải avatar (CDN) → `renderRankCard` → ảnh + `rankSummaryText` (cảnh giới, chuỗi ngày, huy hiệu, huy hiệu sắp đạt). Vẽ lỗi thì dùng embed cũ.
- `/leaderboard`: `query()` theo loại/phạm vi/kỳ → tên + avatar của ≤ 10 người (MemberDirectory, AvatarFetcher) → `renderLeaderboardCard` + 3 hàng nút.
  - Namespace nút `lb`: `lb:v:<a|c>:<i|t>:<all|w|m>:<page>:<ownerId>`, `lb:me:<a|c>:<all|w|m>:<ownerId>`. Nút disabled dùng `lb:x:<vị trí>` để customId không trùng.
  - Chủ bảng bấm thì sửa message (thay ảnh bằng `files` + `attachments: []`); người khác bấm thì nhận bảng riêng (ephemeral).
- Trả lời riêng khi người gọi không có quyền gửi tin, hoặc bot không có Attach Files ở kênh (`mustReplyPrivately`).
- Bảng vàng: `/config board` đặt kênh → `LiveBoardService` → `refreshLiveBoard(force)`. Lịch 10 phút sửa message khi chữ ký dữ liệu đổi. Nội dung: Activity cá nhân tuần, Contribution cá nhân tháng, Activity team tuần (nếu có team).

### 3.5 Quản trị
- Dispatcher kiểm tra `adminOnly` (lớp 2) cho `/admin` và `/config`; command khai báo thêm `setDefaultMemberPermissions(ManageGuild)` (lớp 1).
- Mọi thay đổi điểm và cấu hình ghi `audit_log`. Reset chỉ void event (DEC-027).
- `/config tier set-role|clear-role|list`: gán role cho cảnh giới; người gán cần Manage Roles; chặn role nguy hiểm (`tierRoleSafetyIssue`: quyền cấp server và overwrite theo kênh) và role trùng vai trò admin bot, tạo vote, team (chặn hai chiều). Lỗi API role được backoff 10 phút theo (guild, user, role). `/admin xp give|remove|reset` đồng bộ role của người được chỉnh sau khi trả lời.

### 3.6 Quyền xem và đăng

- **Xem**: `/contribution view|list`, `/poll results|list|close` chỉ hiện mục mà người gọi xem được kênh gốc (`canViewChannel`). Mục không xem được thì báo "không tìm thấy", để không lộ nội dung kênh riêng tư.
- **Đăng**: tạo nội dung công khai (contribution, vote) cần quyền gửi tin ở kênh đó. `/rank` và `/leaderboard` thì trả lời riêng khi người gọi không có quyền gửi tin.
- **Guild**: bot bỏ qua tin nhắn và interaction của guild không có trong `DISCORD_GUILD_IDS`.

## 4. Dữ liệu

| Nhóm | Bảng |
| --- | --- |
| Cấu hình | `guild_settings` (có `poll_xp_daily_cap`), `channel_settings`, `team_roles`, `tier_roles`, `live_boards` |
| Activity XP | `xp_events` (ledger), `xp_event_teams` (snapshot team), `member_xp` (tổng + last_message_xp_at), `xp_team_totals` (cache điểm team) |
| Contribution | `contributions` (có `source_message_id`), `contribution_teams`, `contribution_events`, `contribution_event_teams`, `member_contribution`, `contribution_team_totals`, `contribution_votes` |
| Vote | `polls`, `poll_options`, `poll_votes`, `poll_participants` (XP một lần) |
| Quản trị | `audit_log` |

Migration:
- **1**: toàn bộ schema ban đầu.
- **2**:
  - bảng cache `*_team_totals` (backfill từ các event còn hiệu lực), giúp bảng xếp hạng team không phải quét toàn bộ event;
  - `contributions.source_message_id` + unique index một phần `(guild_id, source_message_id) WHERE source_message_id IS NOT NULL AND status = 'active'`.
- **3** (Phase 12):
  - `guild_settings.poll_xp_daily_cap` (mặc định 25);
  - `tier_roles` (unique theo role trong guild), `live_boards`;
  - index cho bảng theo kỳ (`idx_*_events_period`), chuỗi ngày và XP vote trong ngày (`idx_xp_events_user_source`), huy hiệu (`idx_contribution_votes_voter`, `idx_poll_participants_user`). Xem LL-015.
  - Không đổi gì với backup/restore: vẫn một file SQLite. Chuỗi ngày và huy hiệu tính lại từ ledger, không có bảng riêng.

Quy tắc:
- bảng gốc có `guild_id`; bảng con (options, votes, teams, ...) được lọc qua bảng cha;
- ledger chỉ thêm dòng, không sửa hay xoá (void bằng `voided_at`);
- bảng `member_*` và `*_team_totals` là cache, luôn cập nhật trong cùng transaction với ledger;
- hạng tính theo competition ranking (`RANK()`: hoà điểm thì cùng hạng), giống nhau ở `/rank` và `/leaderboard`;
- không có cột nào chứa nội dung tin nhắn.

## 5. Bảo mật

- Intent: `Guilds`, `GuildMessages`, `MessageContent` (privileged, DEC-023). Không dùng `GuildMembers` hay `GuildPresences`.
- Quyền bot tối thiểu: View Channels, Send Messages, Send Messages in Threads, Embed Links, Attach Files (ảnh thẻ, DEC-030), Manage Roles (role cảnh giới, DEC-031) (`docs/DEPLOY.md`).
- Role cảnh giới: không nhận `@everyone`, role managed, role có quyền quản trị/kiểm duyệt, role không thấp hơn role cao nhất của bot; kiểm tra lại mỗi lần thêm role.
- `allowedMentions` rỗng ở cấp client; chỉ thông báo lên level/đột phá mới ping người được nhắc.
- Secret chỉ lấy từ env; logger che token; `build/` không chứa file cấu hình.
- `.npmrc ignore-scripts=true`; systemd chạy bằng user riêng và chỉ được ghi vào `data/`.

## 6. Giao tiếp ra bên ngoài

| Thời điểm | Đích |
| --- | --- |
| Runtime | Discord Gateway (WebSocket) và Discord REST, qua discord.js |
| Runtime | CDN avatar của Discord (`cdn.discordapp.com`, `media.discordapp.net`), HTTPS, không theo redirect, qua `AvatarFetcher` (DEC-030) |
| Cài đặt | npm registry (không có install script; binary better-sqlite3 và `@napi-rs/canvas` nằm sẵn trong package theo nền tảng) |

## 7. Test

- `npm test` compile vào `build-test/` rồi chạy `node --test`.
- Service được test với SQLite `:memory:` và migration thật, không mock DB.
- Tầng Discord được test bằng fake interaction/service.
- `test/integration.test.ts` chạy kịch bản end-to-end qua toàn bộ service thật; `test/integration-gamification.test.ts` làm tương tự cho Phase 12, gồm cả vẽ ảnh thật.
- Hiệu năng: `test/ledger-perf.test.ts` (bảng team tổng), `test/ledger-period-perf.test.ts` (bảng theo kỳ, 200k event).
- Ảnh: `test/cards.test.ts` vẽ thật và kiểm PNG; lệnh `/rank`, `/leaderboard` cho phép thay hàm vẽ (`renderCard`) trong test. `/config board` cho phép thay hàm Bảng vàng (`liveBoardActions`).
- `test/audit-view.test.ts` kiểm hiển thị audit với dữ liệu thật (LL-011).
- `test/commands.test.ts` kiểm mọi command build được JSON, không trùng tên, và command admin có đủ hai lớp quyền.
