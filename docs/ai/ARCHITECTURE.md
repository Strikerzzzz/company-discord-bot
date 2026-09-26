# ARCHITECTURE

> Cập nhật lần cuối: 2026-09-26, sau khi hoàn thiện Phase 2–10 và sửa lỗi từ đợt review độc lập (branch `phase-2-10/hoan-thien-tinh-nang`).
> Mô tả kiến trúc **hiện tại**, theo source code thực tế.

## 1. Tổng quan

```
Discord ──► Tầng Discord (mỏng) ──► Service nghiệp vụ ──► Ledger / Repository ──► SQLite (1 file)
            events, commands,        modules/*              modules/ledger,
            views, guards            (không import          *Repository.ts
                                     discord.js)
```

- **Topology** (DEC-002, DEC-016): 1 process Node.js (Linux, Node 24 LTS), 1 file SQLite (WAL), kết nối ra Discord. Không mở port, không có hạ tầng nào khác.
- **Hai hệ thống điểm độc lập** (DEC-004): Activity XP dùng `xp_events` + `member_xp`; Contribution Score dùng `contribution_events` + `member_contribution`. Hai hệ thống dùng hai instance `Ledger` riêng và không bao giờ cộng gộp.
- **Hướng phụ thuộc**: `discord` → `modules` → `db` / `shared`. ESLint chặn `src/modules/**`, `src/db/**`, `src/shared/**` import discord.js (DEC-007).

## 2. Cấu trúc thư mục

```
src/
├── index.ts                  Composition root: config → mở DB + migrate → services → lịch backup → client → login
├── config.ts                 Đọc và validate biến môi trường (DEC-015)
├── services.ts               AppServices + createServices(): khởi tạo mọi service bằng constructor injection
├── shared/                   clock (inject được), errors (UserError), logger (che token)
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
│   ├── activity/             levels (5n²+50n+100), antiSpam (chuẩn hoá, chống trùng trong RAM), ActivityService
│   ├── contribution/         ContributionService + ContributionRepository
│   ├── poll/                 PollService + PollRepository (vote/bầu cử ẩn danh)
│   ├── leaderboard/          4 bảng xếp hạng (cá nhân/team × activity/contribution), phân trang
│   └── statistics/           Thống kê tổng quan 7 ngày cho admin
├── classes/                  Base class Command / ContextMenu / Event, DiscordClient, ProcessManager
├── handlers/                 loadModules (nạp theo thư mục), EventHandler, InteractionHandler (deploy), ButtonHandler
├── events/                   clientReady (deploy + lịch đóng vote), interactionCreate (dispatcher), messageCreate (XP)
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
    └── views/                Hàm thuần dựng embed/nút: activity, contribution, poll, admin
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
- khởi động lịch đóng vote (30 giây một lần).

### 3.2 Tin nhắn → Activity XP
```
messageCreate  (bỏ qua bot, webhook, tin hệ thống, tin ngoài guild; thread → dùng channel cha)
  → ActivityService.handleMessage
      1. channel tắt XP?                 → channel_disabled
      2. chống trùng trong RAM (hash)    → duplicate      (DEC-023, không lưu nội dung)
      3. tin quá ngắn?                   → too_short
      4. transaction: cooldown theo member_xp.last_message_xp_at → cooldown
                      Ledger.record(xp, snapshot team) + cập nhật last_message_xp_at
  → lên level và bật thông báo → gửi "🎉 Chúc mừng" (chỉ ping đúng người đó)
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
- Lịch `pollScheduler` gọi `closeDue()`, rồi sửa message sang trạng thái đóng.

### 3.5 Quản trị
- Dispatcher kiểm tra `adminOnly` (lớp 2) cho `/admin` và `/config`; command khai báo thêm `setDefaultMemberPermissions(ManageGuild)` (lớp 1).
- Mọi thay đổi điểm và cấu hình ghi `audit_log`. Reset chỉ void event (DEC-027).

### 3.6 Quyền xem và đăng

- **Xem**: `/contribution view|list`, `/poll results|list|close` chỉ hiện mục mà người gọi xem được kênh gốc (`canViewChannel`). Mục không xem được thì báo "không tìm thấy", để không lộ nội dung kênh riêng tư.
- **Đăng**: tạo nội dung công khai (contribution, vote) cần quyền gửi tin ở kênh đó. `/rank` và `/leaderboard` thì trả lời riêng khi người gọi không có quyền gửi tin.
- **Guild**: bot bỏ qua tin nhắn và interaction của guild không có trong `DISCORD_GUILD_IDS`.

## 4. Dữ liệu

| Nhóm | Bảng |
| --- | --- |
| Cấu hình | `guild_settings`, `channel_settings`, `team_roles` |
| Activity XP | `xp_events` (ledger), `xp_event_teams` (snapshot team), `member_xp` (tổng + last_message_xp_at), `xp_team_totals` (cache điểm team) |
| Contribution | `contributions` (có `source_message_id`), `contribution_teams`, `contribution_events`, `contribution_event_teams`, `member_contribution`, `contribution_team_totals`, `contribution_votes` |
| Vote | `polls`, `poll_options`, `poll_votes`, `poll_participants` (XP một lần) |
| Quản trị | `audit_log` |

Migration:
- **1**: toàn bộ schema ban đầu.
- **2**:
  - bảng cache `*_team_totals` (backfill từ các event còn hiệu lực), giúp bảng xếp hạng team không phải quét toàn bộ event;
  - `contributions.source_message_id` + unique index một phần `(guild_id, source_message_id) WHERE source_message_id IS NOT NULL AND status = 'active'`.

Quy tắc:
- bảng gốc có `guild_id`; bảng con (options, votes, teams, ...) được lọc qua bảng cha;
- ledger chỉ thêm dòng, không sửa hay xoá (void bằng `voided_at`);
- bảng `member_*` và `*_team_totals` là cache, luôn cập nhật trong cùng transaction với ledger;
- hạng tính theo competition ranking (`RANK()`: hoà điểm thì cùng hạng), giống nhau ở `/rank` và `/leaderboard`;
- không có cột nào chứa nội dung tin nhắn.

## 5. Bảo mật

- Intent: `Guilds`, `GuildMessages`, `MessageContent` (privileged, DEC-023). Không dùng `GuildMembers` hay `GuildPresences`.
- Quyền bot tối thiểu: View Channels, Send Messages, Send Messages in Threads, Embed Links (`docs/DEPLOY.md`).
- `allowedMentions` rỗng ở cấp client; chỉ thông báo lên level mới ping người được nhắc.
- Secret chỉ lấy từ env; logger che token; `build/` không chứa file cấu hình.
- `.npmrc ignore-scripts=true`; systemd chạy bằng user riêng và chỉ được ghi vào `data/`.

## 6. Giao tiếp ra bên ngoài

| Thời điểm | Đích |
| --- | --- |
| Runtime | Discord Gateway (WebSocket) và Discord REST, qua discord.js |
| Cài đặt | npm registry (không có install script; binary better-sqlite3 nằm sẵn trong package) |

## 7. Test

- `npm test` compile vào `build-test/` rồi chạy `node --test`.
- Service được test với SQLite `:memory:` và migration thật, không mock DB.
- Tầng Discord được test bằng fake interaction/service.
- `test/integration.test.ts` chạy kịch bản end-to-end qua toàn bộ service thật.
- `test/audit-view.test.ts` kiểm hiển thị audit với dữ liệu thật (LL-011).
- `test/commands.test.ts` kiểm mọi command build được JSON, không trùng tên, và command admin có đủ hai lớp quyền.
