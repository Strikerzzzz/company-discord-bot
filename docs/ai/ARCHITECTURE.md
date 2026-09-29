# ARCHITECTURE

> Cập nhật lần cuối: 2026-09-29, Phase 15 (bảng cấu hình `/config panel` và chế độ kênh tính XP, branch `phase-15/config-panel`, DEC-037). Phase 0–14 đã merge vào `main`.
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
├── selfcheck.ts              Entry point thứ hai (`npm run selfcheck`): tự kiểm tra môi trường trước khi bật bot; logic ở selfcheck/
│                             (không gọi mạng, không mở DB thật bằng SQLite: đọc header và chạy thử trên bản sao trong thư mục tạm, LL-020)
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
│   ├── guild-config/         Cấu hình guild/channel, chế độ kênh tính XP (DEC-037, mục 3.2b), bật/tắt XP hàng loạt
│   │                         (setChannelsXpEnabled), giới hạn hợp lệ, permissions (isAdmin, canCreatePoll)
│   ├── team/                 Team = role do admin chỉ định; resolveTeams() tạo snapshot
│   ├── audit/                Nhật ký thao tác quản trị
│   ├── activity/             levels (5n²+50n+100), tiers (5 bộ danh hiệu × 8 bậc cùng mốc, khoá bậc bac-1…bac-8, giọng văn theo bộ), antiSpam (chống trùng trong RAM), ActivityService
│   ├── contribution/         ContributionService (bù điểm để tổng không âm, PROP-024) + ContributionRepository
│   ├── poll/                 PollService (giới hạn XP từ vote mỗi ngày, PROP-028) + PollRepository
│   ├── leaderboard/          12 bảng: cá nhân/team × activity/contribution × tổng/tuần/tháng; userStanding
│   ├── gamification/         GamificationService (hồ sơ: bộ và bậc danh hiệu, chuỗi ngày, huy hiệu, XP tuần), streaks,
│   │                         achievements (15 huy hiệu), GamificationRepository, TierRoleService (role theo bậc),
│   │                         TierSetService (bộ đang dùng, tên/emoji tuỳ chỉnh theo bộ, DEC-033)
│   ├── live-board/           LiveBoardService: kênh và message của Bảng vàng
│   └── statistics/           Thống kê tổng quan 7 ngày cho admin
├── classes/                  Base class Command / ContextMenu / Event, DiscordClient (có `avatars`, `members`, `renderGate`), ProcessManager
├── handlers/                 loadModules (nạp theo thư mục), EventHandler, InteractionHandler (deploy), ButtonHandler
├── events/                   clientReady (deploy, lịch đóng vote, lịch Bảng vàng), interactionCreate (dispatcher: lệnh, nút, menu chọn, form),
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
    │                         theme, fonts (tìm assets/fonts theo __dirname); types.ts là hợp đồng dữ liệu ảnh.
    │                         Theo bộ danh hiệu (DEC-033): emblems (40 biểu tượng bậc), frames (khung avatar), styles
    │                         (nền, hiệu ứng bậc cao nhất). Mọi bảng (kể cả Contribution, team, bảng trống) trang trí theo
    │                         `LeaderboardCardData.tierSet` của guild
    ├── cardData.ts           Dựng dữ liệu ảnh từ service (hàm thuần) + loader tên/avatar; rankSummaryText
    ├── avatars.ts            AvatarFetcher: tải avatar từ CDN Discord (allowlist host, timeout, giới hạn dung lượng, cache)
    ├── memberDirectory.ts    Tên hiển thị + avatar URL theo user ID: cache discord.js → cache TTL → REST từng người
    ├── liveBoard.ts          Bảng vàng: đăng/sửa message 2–3 ảnh, khoá theo guild, lịch 10 phút, tự kiểm lại mỗi giờ
    ├── renderGate.ts         Cooldown vẽ ảnh 3 giây mỗi người (/rank, /leaderboard, nút lb) + tối đa 2 lần vẽ đồng thời
    ├── roleSync.ts           Đồng bộ role danh hiệu (từng role một), tierRoleSafetyIssue (chặn role nguy hiểm)
    ├── tierRoleSetup.ts      Bot tạo role (không quyền) / đổi tên, màu role đã gán theo bộ; khoá chống chạy trùng theo guild
    └── views/                Hàm thuần dựng embed/nút: activity, contribution, poll, admin (có nhãn chế độ kênh), progression
                              (thông báo theo bộ), tierPanel (bảng điều khiển danh hiệu, Components V2), configPanel (bảng cấu
                              hình chung `/config panel`, Components V2, hợp đồng customId `cfgui`, form sửa số; mục 3.5)
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
      1. channel không tính XP?          → channel_disabled  (cấu hình riêng tắt XP, hoặc không có cấu hình riêng
                                                              mà chế độ kênh là `selected`; mục 3.2b)
      2. chống trùng trong RAM (hash)    → duplicate      (DEC-023, không lưu nội dung)
      3. tin quá ngắn?                   → too_short
      4. transaction: cooldown theo member_xp.last_message_xp_at → cooldown
                      Ledger.record(xp, snapshot team) + cập nhật last_message_xp_at
  → lên level và bật thông báo → vượt mốc cảnh giới thì gửi thông báo "đột phá", ngược lại gửi "tu vi tăng tiến"
    (views/progression.ts; chỉ ping đúng người đó)
  → mọi tin được XP: syncTierRoles (thêm role cảnh giới hiện tại, bỏ role cảnh giới khác; DEC-031)
```

### 3.2b Chế độ kênh tính XP (DEC-037)
- `guild_settings.xp_channel_mode` (`XpChannelMode`): `all` (mặc định, giữ hành vi cũ) hoặc `selected`.
- Quy tắc trong `GuildConfigService.getChannel` / `effectiveChannelXp`:
  - channel có dòng `channel_settings` (cấu hình riêng) → dùng dòng đó. Cấu hình riêng **luôn thắng** chế độ;
  - channel không có dòng → `xpEnabled = (mode === "all")`, XP và cooldown lấy theo guild. Channel tạo sau này không có dòng nên theo chế độ;
  - `/config channel reset` xoá dòng → channel quay về theo chế độ;
  - thread và bài forum dùng channel cha (`messageCreate`), như trước.
- Đổi chế độ: `updateSettings({ xpChannelMode })`, audit `config.update`. `/config channel mode` không ghi gì khi chế độ không đổi. Phản hồi (`channelModeChangedText`, views/admin.ts) cảnh báo khi chuyển sang `selected` mà chưa bật channel nào.
- `setChannelsXpEnabled(guildId, channelIds, enabled, actorId)` → `{ changed, unchanged }`, dùng cho menu kênh của `/config panel`:
  - bỏ trùng; rỗng hoặc quá `MAX_BULK_CHANNELS` (25, bằng số lựa chọn tối đa của ChannelSelect) → `UserError`;
  - một transaction, đọc chế độ bên trong transaction;
  - channel đã đúng trạng thái → `unchanged`, không ghi, không audit;
  - channel đổi trạng thái → ghi dòng (như `setChannel`), giữ XP/cooldown riêng nếu có. Trạng thái admin đặt vì vậy giữ nguyên khi đổi chế độ về sau;
  - mỗi channel đổi trạng thái có một audit `channel.set` với `{ xpEnabled }`.
- Hệ quả: channel vốn đã đúng trạng thái theo chế độ **lúc thao tác** thì không có dòng. Ví dụ ở `all`, bật bằng bảng một channel chưa có dòng là `unchanged`; đổi sang `selected` sau đó thì channel này không tính XP. `setChannel` (`/config channel set`) luôn ghi dòng, kể cả khi chỉ đặt XP hay cooldown riêng: khi đó trạng thái bật/tắt hiện hành (có thể đến từ chế độ) được lưu cứng vào dòng.
- Hiển thị: `xpChannelModeLabel` (views/admin.ts) cho `/config view`, chân `/config channel list` và audit (`xpChannelMode`).

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
- `/config tier panel`: bảng điều khiển (ephemeral, Components V2): menu chọn bộ, 8 ô chọn role (RoleSelect, điền sẵn), nút đổi tên (form 4 ô), tạo/đồng bộ role, khôi phục tên. Namespace `tierui`. `/config tier style|rename|reset-names|setup-roles` là lệnh gõ tay tương ứng.
  - customId mang trạng thái lúc vẽ để panel cũ không ghi đè: `tierui:reset:<setKey>`, `tierui:role:<bậc>:<roleId|none>`, `tierui:names:<nhóm>:<setKey>:<8 hex vân tay tên>`. Trạng thái đã đổi thì bot vẽ lại panel và báo riêng.
  - Nút ✨ (`tierRoleSetup.ts`) chỉ đổi tên/màu role do bot tạo (`created_by_bot`), tạo role từ bậc 8 xuống bậc 1, dừng khi server đủ số role (30005); audit `tier_role.setup` ghi trong `finally`, bỏ qua khi không có thay đổi.
  - Bỏ gán role do bot tạo (`clearTierRoleAssignment`, dùng chung cho `clear-role` và panel) thì xoá role đó nếu người gọi có Manage Roles; audit `tier_role.clear` có `deletedRoleId`.
- `/config panel` (PROP-033, DEC-037): bảng cấu hình chung (ephemeral, Components V2), namespace `cfgui`. View thuần ở `src/discord/views/configPanel.ts`; handler trong `config.ts`. `/config view|xp|channel|team|admin-role|poll|contribution|board` là lệnh gõ tay tương ứng, giữ nguyên.
  - 6 trang (`ConfigPanelPage`): `home` (tổng quan), `channels` (chế độ kênh, bật/tắt nhiều channel, danh sách channel đang tính XP ở `selected` hoặc đang tắt ở `all`), `teams`, `xp`, `poll` (vote và contribution), `board` (Bảng vàng, role admin bot, nút mở bảng danh hiệu). Chọn trang bằng menu `cfgui:nav`.
  - Dữ liệu vẽ (`ConfigPanelData`) đọc từ service ngay trước khi vẽ. Kết quả thao tác hiện nguyên văn trong `notice` ở đầu trang, thay cho tin phản hồi riêng. Mỗi message ≤ 40 component; mọi customId dựng bằng `configPanelId`.
  - Hợp đồng customId (`configPanelId` / `parseConfigPanelId`; sai định dạng → `UserError(INVALID_CONFIG_PANEL)`, luôn ≤ 100 ký tự):

    | customId | Component, trang | Việc |
    | --- | --- | --- |
    | `cfgui:nav` | StringSelect, mọi trang | Chuyển trang (giá trị là trang), không ghi gì |
    | `cfgui:mode:<all\|selected>` | Nút, `channels` | Đặt chế độ kênh; đã đúng chế độ thì không ghi |
    | `cfgui:ch:<on\|off>` | ChannelSelect ≤ 25 (`XP_CHANNEL_TYPES`), `channels` | `setChannelsXpEnabled` bật hoặc tắt |
    | `cfgui:team:<add\|del>` | RoleSelect nhiều role, `teams` | Thêm hoặc bỏ team (`TeamService.addMany`/`removeMany`, một transaction, kiểm tra `MAX_TEAMS` bên trong) |
    | `cfgui:ann:<on\|off>` | Nút, `xp` | Đặt thông báo lên level |
    | `cfgui:xpform` → `cfgui:xpsave:<xp>.<cooldown>.<độ dài>.<chống trùng>` | Nút mở form 4 ô → form, `xp` | Lưu các ô đã sửa |
    | `cfgui:pollform` → `cfgui:pollsave:<xp vote>.<giới hạn ngày>.<điểm ghi nhận>` | Nút mở form 3 ô → form, `poll` | Lưu các ô đã sửa |
    | `cfgui:pollrole:<roleId\|none>` | RoleSelect một role, cho bỏ chọn, `poll` | Đặt hoặc xoá role tạo vote |
    | `cfgui:board` · `cfgui:boardoff` | ChannelSelect một kênh (`BOARD_CHANNEL_TYPES`) · nút, `board` | Đặt kênh Bảng vàng (kiểm tra quyền như `/config board`) · tắt Bảng vàng |
    | `cfgui:admin:<roleId\|none>` | RoleSelect một role, cho bỏ chọn, `board` | Đặt hoặc xoá role admin bot |
    | `cfgui:tier` | Nút, `board` | Mở `/config tier panel` trong một tin nhắn trả lời riêng mới |

  - customId mang **trạng thái lúc vẽ** để bảng cũ không ghi đè thay đổi mới hơn (như `tierui`):
    - form mang giá trị lúc mở (`drawn`, `XpFormValues`/`PollFormValues`). Khi lưu, ô có giá trị bằng `drawn` thì không ghi, nên hai admin sửa hai ô khác nhau không đè nhau. Ô số đọc bằng `parseFormNumber`: bỏ khoảng trắng, chỉ nhận chữ số (dấu chấm hay dấu phẩy bị từ chối, vì "2,5" hay "1.000" dễ hiểu nhầm), phải là số nguyên trong `SETTING_LIMITS`;
    - `pollrole`/`admin` mang `drawnRoleId` (role lúc vẽ, `none` = chưa đặt). Chọn role thì đặt (chọn đúng role đang đặt thì không ghi); bỏ chọn chỉ xoá khi role hiện tại vẫn là `drawnRoleId`, ngược lại vẽ lại bảng và báo.
  - Menu chọn (trừ `nav`) bị từ chối thì bảng được vẽ lại theo dữ liệu thật trước khi báo lỗi: nếu không, Discord vẫn hiện lựa chọn vừa bị từ chối trong khi customId giữ role lúc vẽ, và thao tác bỏ chọn kế tiếp sẽ xoá nhầm role đang đặt (review Phase 15).
  - `nav` không đánh dấu `default` (placeholder ghi trang đang xem), để chọn lại trang đang xem là làm mới trang.
  - Role/kênh đã lưu mà không còn trong cache của guild (`ConfigPanelData.missingIds`): không điền sẵn vào menu (Discord có thể từ chối ID không tồn tại) và hiện cảnh báo, như `missingRoleIds` của `tierui`.
  - Mọi thao tác đi qua đúng service và kiểm tra như lệnh gõ tay: chặn role danh hiệu làm team, role admin bot hay role tạo vote; kiểm tra quyền của bot và của người thao tác ở kênh Bảng vàng; audit như lệnh gõ tay.
  - `XP_CHANNEL_TYPES` và `BOARD_CHANNEL_TYPES` chuyển từ `config.ts` sang `configPanel.ts`, dùng chung cho option của lệnh gõ tay và menu của bảng. Menu kênh vì vậy không có thread và category.
- Dispatcher định tuyến nút, menu chọn và form theo namespace customId (`buttonIds`). Có 5 namespace: `lb` (`/leaderboard`), `contrib` (`/contribution`), `poll` (`/poll`), `tierui` và `cfgui` (`/config`). Component của command `adminOnly` cũng qua `assertAdmin` (DEC-033), nên người mất quyền admin bấm vào bảng cũ vẫn bị chặn.
- `/config tier set-role|clear-role|list`: gán role cho bậc; người gán cần Manage Roles; chặn role nguy hiểm (`tierRoleSafetyIssue`: quyền cấp server và overwrite theo kênh) và role trùng vai trò admin bot, tạo vote, team (chặn hai chiều). Lỗi API role được backoff 10 phút theo (guild, user, role). `/admin xp give|remove|reset` đồng bộ role của người được chỉnh sau khi trả lời.

### 3.6 Quyền xem và đăng

- **Xem**: `/contribution view|list`, `/poll results|list|close` chỉ hiện mục mà người gọi xem được kênh gốc (`canViewChannel`). Mục không xem được thì báo "không tìm thấy", để không lộ nội dung kênh riêng tư.
- **Đăng**: tạo nội dung công khai (contribution, vote) cần quyền gửi tin ở kênh đó. `/rank` và `/leaderboard` thì trả lời riêng khi người gọi không có quyền gửi tin.
- **Guild**: bot bỏ qua tin nhắn và interaction của guild không có trong `DISCORD_GUILD_IDS`.

## 4. Dữ liệu

| Nhóm | Bảng |
| --- | --- |
| Cấu hình | `guild_settings` (có `poll_xp_daily_cap`, `xp_channel_mode`), `channel_settings` (cấu hình riêng, thắng chế độ kênh), `team_roles`, `tier_roles` (có `created_by_bot`), `tier_set_config`, `tier_name_overrides`, `live_boards` |
| Activity XP | `xp_events` (ledger), `xp_event_teams` (snapshot team), `member_xp` (tổng + last_message_xp_at), `xp_team_totals` (cache điểm team) |
| Contribution | `contributions` (có `source_message_id`), `contribution_teams`, `contribution_events`, `contribution_event_teams`, `member_contribution`, `contribution_team_totals`, `contribution_votes` |
| Vote | `polls`, `poll_options`, `poll_votes`, `poll_participants` (XP một lần) |
| Quản trị | `audit_log` |

Migration (5 migration, version lưu ở `PRAGMA user_version`):
- **1**: toàn bộ schema ban đầu.
- **2**:
  - bảng cache `*_team_totals` (backfill từ các event còn hiệu lực), giúp bảng xếp hạng team không phải quét toàn bộ event;
  - `contributions.source_message_id` + unique index một phần `(guild_id, source_message_id) WHERE source_message_id IS NOT NULL AND status = 'active'`.
- **3** (Phase 12):
  - `guild_settings.poll_xp_daily_cap` (mặc định 25);
  - `tier_roles` (unique theo role trong guild), `live_boards`;
  - index cho bảng theo kỳ (`idx_*_events_period`), chuỗi ngày và XP vote trong ngày (`idx_xp_events_user_source`), huy hiệu (`idx_contribution_votes_voter`, `idx_poll_participants_user`). Xem LL-015.
  - Không đổi gì với backup/restore: vẫn một file SQLite. Chuỗi ngày và huy hiệu tính lại từ ledger, không có bảng riêng.
- **4** (Phase 13): đổi khoá cảnh giới cũ trong `tier_roles` sang `bac-N`, thêm `created_by_bot`; bảng `tier_set_config` (bộ đang dùng) và `tier_name_overrides` (tên/emoji tuỳ chỉnh theo bộ). Backup/restore không đổi.
- **5** (Phase 15, DEC-037): `guild_settings.xp_channel_mode TEXT NOT NULL DEFAULT 'all'`, `CHECK (xp_channel_mode IN ('all', 'selected'))`. Guild đang chạy nhận `all`, nên hành vi không đổi khi cập nhật. `getSettings` vẫn kiểm tra giá trị đọc ra (giá trị lạ rơi về mặc định).
  - Backup/restore: vẫn một file SQLite, không có file mới.
  - Backup cũ (version ≤ 4) khôi phục vào code mới thì tự migrate lên 5 lúc khởi động, với chế độ `all`. Guild đã chuyển sang `selected` phải chọn lại chế độ và bật lại channel sau khi khôi phục (DEPLOY mục 6).
  - Code cũ (migration ≤ 4) gặp DB version 5 thì từ chối khởi động, như mọi migration; selfcheck của code cũ báo ❌.

Quy tắc:
- bảng gốc có `guild_id`; bảng con (options, votes, teams, ...) được lọc qua bảng cha;
- ledger chỉ thêm dòng, không sửa hay xoá (void bằng `voided_at`);
- bảng `member_*` và `*_team_totals` là cache, luôn cập nhật trong cùng transaction với ledger;
- `channel_settings` chỉ là cấu hình riêng: channel không có dòng thì theo `guild_settings.xp_channel_mode` (mục 3.2b);
- hạng tính theo competition ranking (`RANK()`: hoà điểm thì cùng hạng), giống nhau ở `/rank` và `/leaderboard`;
- không có cột nào chứa nội dung tin nhắn.

## 5. Bảo mật

- Intent: `Guilds`, `GuildMessages`, `MessageContent` (privileged, DEC-023). Không dùng `GuildMembers` hay `GuildPresences`.
- Quyền bot tối thiểu: View Channels, Send Messages, Send Messages in Threads, Embed Links, Attach Files (ảnh thẻ, DEC-030), Manage Roles (role cảnh giới, DEC-031) (`docs/DEPLOY.md`).
- Role danh hiệu: không nhận `@everyone`, role managed, role mentionable, role có quyền quản trị/kiểm duyệt (cấp server hoặc overwrite kênh), role không thấp hơn role cao nhất của bot; kiểm tra lại mỗi lần thêm role. Quyền Manage Roles của người gọi lấy ở cấp server (`member.permissions`, LL-019).
- `allowedMentions` rỗng ở cấp client; chỉ thông báo lên level/đột phá mới ping người được nhắc.
- Bảng `/config panel` không thêm quyền bot hay intent. Bề mặt mới là component namespace `cfgui`: dispatcher kiểm tra admin (lớp 2) cho mọi component, customId được đọc bằng regex chặt, ô số kiểm tra theo `SETTING_LIMITS`, role/kênh chọn trong menu đi qua cùng kiểm tra với lệnh gõ tay.
- Secret chỉ lấy từ env; logger che token; `build/` không chứa file cấu hình.
- `.npmrc ignore-scripts=true`; systemd chạy bằng user riêng và chỉ được ghi vào `data/`.

## 6. Giao tiếp ra bên ngoài

| Thời điểm | Đích |
| --- | --- |
| Runtime | Discord Gateway (WebSocket) và Discord REST, qua discord.js |
| Runtime | CDN avatar của Discord (chỉ `cdn.discordapp.com`), HTTPS, không theo redirect, chỉ PNG/JPEG/WebP tối đa 512 KB, qua `AvatarFetcher` (DEC-030) |
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
- Phase 15: `test/config-panel-contract.test.ts` kiểm hợp đồng customId `cfgui` (mã hoá rồi đọc lại, ≤ 100 ký tự, không trùng, từ chối customId lạ) và `parseFormNumber`; `test/guildConfig.test.ts` kiểm chế độ kênh và `setChannelsXpEnabled`; `test/activity.test.ts` kiểm tin ở channel chưa bật khi chế độ `selected`; `test/migrations.test.ts` kiểm migration 5 trên DB version 4 có sẵn cấu hình.
