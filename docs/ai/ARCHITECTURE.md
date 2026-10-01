# ARCHITECTURE

> Cập nhật lần cuối: 2026-09-29, Phase 16 (trang web quản trị, branch `phase-16/web-admin`, DEC-039). Phase 0–15 đã merge vào `main`.
> Mô tả kiến trúc **hiện tại**, theo source code thực tế.

## 1. Tổng quan

```
Discord ─────► Tầng Discord (mỏng) ───┐
               events, commands,      │
               views, guards          ├──► Service nghiệp vụ ──► Ledger / Repository ──► SQLite (1 file)
                                      │    modules/*              modules/ledger,
Trình duyệt ──► Tầng web (mỏng) ──────┘    (không import          *Repository.ts
(mạng nội bộ)   src/web/, node:http,       discord.js)
                tuỳ chọn (WEB_PORT)
```

- **Topology** (DEC-002, DEC-016, DEC-039): 1 process Node.js (Linux, Node 24 LTS), 1 file SQLite (WAL), kết nối ra Discord (API, OAuth2 và CDN avatar, DEC-030). Không có hạ tầng nào khác. Không mở port, trừ cổng `WEB_PORT` của trang web quản trị tuỳ chọn: cổng này do chính process bot lắng nghe, chỉ dùng trong mạng nội bộ hoặc VPN (mục 3.7).
- **Hai hệ thống điểm độc lập** (DEC-004): Activity XP dùng `xp_events` + `member_xp`; Contribution Score dùng `contribution_events` + `member_contribution`. Hai hệ thống dùng hai instance `Ledger` riêng và không bao giờ cộng gộp.
- **Hướng phụ thuộc**: `discord` → `modules` → `db` / `shared`; `web` → `modules` và helper dùng chung của `discord` (chủ yếu `discord/configOps.ts`, mục 3.7). `discord` không import `web`; chỉ `index.ts` nối hai tầng. ESLint chặn `src/modules/**`, `src/db/**`, `src/shared/**` import discord.js (DEC-007). Tầng web được import discord.js (đối tượng `Guild`, `GuildMember` của bot), như tầng Discord.

## 2. Cấu trúc thư mục

```
src/
├── index.ts                  Composition root: config → mở DB + migrate → services → lịch backup → client → login;
│                             khi clientReady mở trang web quản trị nếu có WEB_PORT (mục 3.7)
├── selfcheck.ts              Entry point thứ hai (`npm run selfcheck`): tự kiểm tra môi trường trước khi bật bot; logic ở selfcheck/
│                             (không gọi mạng, không mở DB thật bằng SQLite: đọc header và chạy thử trên bản sao trong thư mục tạm, LL-020)
├── config.ts                 Đọc và validate biến môi trường (DEC-015); loadWebConfig (WEB_*, DISCORD_CLIENT_SECRET; null = web tắt)
├── services.ts               AppServices + createServices(): khởi tạo mọi service bằng constructor injection
├── shared/                   clock (inject được), errors (UserError), logger (che token và secret đã đăng ký), time (ngày/tuần/tháng giờ Việt Nam)
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
├── web/                      Trang web quản trị tuỳ chọn (DEC-039, mục 3.7): chạy trong process bot, chỉ mở khi có WEB_PORT
│   ├── server.ts             createWebHandler (thuần: Host, route, phiên, lấy lại member, isAdmin, CSRF/Origin, flash, error
│   │                         boundary của web) + readRequest, startWebServer (nối node:http, timeout, giới hạn body)
│   ├── http.ts               WebRequest/WebResponse, cookie (HttpOnly, SameSite=Lax), SECURITY_HEADERS (CSP), RateLimiter,
│   │                         safeEqual, MAX_FORM_BYTES (256 KB)
│   ├── oauth.ts              DiscordOAuth: URL cho phép (scope identify), đổi code lấy token → users/@me → bỏ token
│   ├── session.ts            SessionStore trong bộ nhớ: 8 giờ tuyệt đối, tối đa 500 phiên, khoá là SHA-256 của token; CSRF, flash
│   ├── types.ts              Hợp đồng trang: WebDeps, GuildPageContext, GuildRoute, PageModule, NavKey, quy ước form
│   ├── layout.ts             Khung trang (menu 8 mục NAV_ITEMS), renderPage/renderPlainPage, csrfField, redirectWithFlash
│   ├── html.ts               Template `html` tự escape mọi giá trị chèn vào, RawHtml
│   ├── format.ts             Tên kênh/role/người thay cho ID; discordText (markdown/mention kiểu Discord → HTML đã escape)
│   ├── assets.ts             CSS nền, phục vụ ở /static/app.css (CSP chặn style inline)
│   └── pages/                8 module trang (overview, channels, teams, settings, roles, board, tiers, audit); index.ts: PAGE_MODULES
└── discord/                  Helper của tầng Discord
    ├── configOps.ts          Kiểm tra và thao tác cấu hình dùng chung cho `/config` và web (DEC-039): role dùng được
    │                         (assertAssignableRole, assertNotTierRole, assertUsableRole), quyền kênh Bảng vàng của bot và người
    │                         gọi (assertBoardChannelAccess), moveLiveBoard/turnOffLiveBoard, LiveBoardActions
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
deploy/                       Unit systemd, install.sh, start.sh (unit không đổi khi bật web)
docs/DEPLOY.md                Runbook triển khai và vận hành
```

## 3. Luồng chính

### 3.1 Khởi động
`index.ts`:
1. `loadConfig()`, gồm `loadWebConfig()`: cấu hình web sai (đặt `WEB_PORT` mà thiếu hay sai `WEB_BASE_URL`, `DISCORD_CLIENT_SECRET`) thì bot từ chối khởi động;
2. `openDatabase()` + `runMigrations()`, **trước** khi login (LL-007);
3. `createServices()`;
4. `startBackupSchedule()`;
5. `new DiscordClient(services, guildIds)`;
6. nếu có `config.web`: đăng ký `client.once(ClientReady)` để mở web (bên dưới);
7. `ProcessManager` với các hook tắt: đóng web (nếu đang mở) → dừng backup → `client.destroy()` → `db.close()`;
8. `login()`.

Khi `clientReady`:
- deploy toàn bộ command theo guild, set global command về rỗng;
- khởi động lịch đóng vote (30 giây một lần);
- khởi động lịch Bảng vàng (10 phút một lần, lượt đầu sau 15 giây);
- nếu có `WEB_PORT`: `startWebServer()` (mục 3.7). Web mở **sau** khi bot sẵn sàng vì cần cache guild, role, kênh. Log `Trang web quản trị: <WEB_BASE_URL> (lắng nghe <host>:<port>).`; không mở được (ví dụ cổng bị chiếm) thì chỉ ghi log lỗi, bot vẫn chạy.

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
    (views/progression.ts; chỉ ping đúng người đó). Gửi vào kênh `guild_settings.level_up_channel_id` nếu admin đã chọn
    (DEC-043; kênh không còn hoặc bot thiếu View Channel/Send Messages thì bỏ qua và ghi cảnh báo, không gửi về kênh vừa
    nhắn); chưa chọn thì gửi ở kênh (thread) vừa nhắn
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

### 3.3 Contribution (DEC-025, DEC-051)
- **Kênh contribution** (`guild_settings.contribution_channel_id`, Phase 20): admin chọn trên web (Cài đặt điểm) hoặc `/config contribution kenh`, qua `configOps.resolveContributionChannel` (kênh văn bản/thông báo; người chọn xem và gửi được tin ở đó; bot có View Channel, Send Messages, Embed Links). Chưa chọn kênh thì `ContributionService.submit` ném UserError.
- **Gửi contribution** (gửi từ đâu cũng được, thẻ luôn đăng ở kênh contribution):
  - `/contribution submit` → `ContributionService.submit` (validate, lưu snapshot team của tác giả, trạng thái **chờ duyệt**).
  - Context menu "Ghi nhận đóng góp": **không chép nội dung tin nhắn**. Chỉ lưu link, `source_message_id` và tiêu đề cố định (PEND-017); tiêu đề không nêu tên kênh nguồn nếu `@everyone` không xem được kênh đó. Mỗi tin nhắn chỉ là nguồn của một contribution còn hiệu lực và chưa bị từ chối. Context menu lấy role của tác giả qua REST sau khi defer.
  - Người gửi phải xem được kênh contribution; bot kiểm tra quyền của mình (`missingContributionBotPermissions`) rồi đăng thẻ, lưu vị trí message (`attachMessage`) và trả lời riêng kèm link.
- **Duyệt** (`contributionOps.approveContribution` / `rejectContribution`, dùng chung cho nút trên thẻ và web):
  - người duyệt = admin bot hoặc có role trong `contributionReviewerRoleIds` (`canReviewContributions`, kiểm tra trong code mỗi lần); được duyệt cả bài của mình;
  - duyệt → thẻ mở nút 👍/👎; từ chối bắt buộc lý do (3–300), thẻ ghi "Không được duyệt" nhưng không hiện lý do;
  - sau khi duyệt hoặc từ chối, bot nhắn riêng (`AdminActions.sendDirectMessage`) cho tác giả và người gửi; lỗi DM chỉ ghi log. Không nhắn theo từng lượt 👍/👎.
  - audit `contribution.approve` / `contribution.reject` (target = tác giả).
- **👍 Ghi nhận / 👎 Không ghi nhận** → `ContributionService.vote({ action: "up" | "down" | "withdraw" })`, tầng Discord đọc `voterState` để biết bấm lại là rút hay đổi:
  - mỗi người một trong hai, đổi/rút được; không bấm bài của mình; 👎 bắt buộc lý do (3–200), chỉ admin và người duyệt xem (`listVoters`);
  - mỗi lượt một event trong `contribution_events` (👍 = `+contributionVotePoints`, 👎 = `−contributionVotePoints`, actor là người bấm, `reference_id` = contribution). Điểm của contribution = max(0, tổng các lượt): `recomputeFloor` ghi **event sàn chênh lệch** (nguồn `vote`, actor NULL, `reference_id` = contribution, amount có thể âm) mỗi khi max(0, −tổng các lượt) đổi, để tổng event sàn còn hiệu lực luôn bằng phần âm đó. Không huỷ event sàn cũ, nên mỗi thay đổi rơi đúng vào kỳ phát sinh (bị 👎 không làm điểm tuần/tháng tăng). Gỡ contribution (`voidByReference`) hay reset huỷ luôn các event sàn;
  - PROP-024/PROP-031: thao tác làm giảm điểm (rút 👍, thêm/đổi sang 👎) mà phải bù vì tác giả đang bị trừ điểm thì lượt bị khoá (rút 👍: giữ dòng `contribution_votes` với event đã huỷ; 👎: `contribution_downvotes.locked_at`). Lượt có event bị admin reset cũng bị khoá;
  - **XP người bấm**: lượt đầu tiên của một người trên một contribution được `contributionInteractionXp` Activity XP (xpLedger nguồn `admin`, actor là bot, `reference_id` = `contribution:<id>`), giới hạn `contributionInteractionXpDailyCap` mỗi ngày giờ VN; bảng `contribution_interaction_xp` giữ vĩnh viễn một dòng mỗi người mỗi contribution (`xp_event_id` NULL = không được XP). Đổi 👍↔👎 giữ XP; rút hẳn thì huỷ event XP và đặt `revoked_at`; bấm lại chỉ được lại đúng phần đã thu (theo hạn mức còn lại). XP bị admin reset hay bị hạn mức cắt không được bù; gỡ contribution hay rút bị khoá không thu XP người bấm. Migration 10 tạo sẵn dòng (`xp_event_id` NULL) cho mọi lượt 👍 cũ nên lượt cũ không được XP.
  - `votes` / `downvotes` chỉ đếm lượt còn hiệu lực; `score` là tổng event chưa huỷ của contribution.
- **Xem**: `/contribution view` trả lời riêng; người duyệt và admin thấy thêm lượt 👍/👎 kèm lý do và lý do từ chối; tác giả/người gửi thấy lý do từ chối bài của mình.
- **Admin gỡ contribution** (mọi trạng thái) → `voidByReference` huỷ mọi điểm của nó, và message gốc chuyển sang "Đã bị gỡ". XP người bấm đã nhận được giữ nguyên.
- **Đăng lại thẻ** (web, `contributionOps.repostContribution` → `AdminActions.repostContribution` = `messages.repostContributionCard`): kiểm tra kênh và quyền bot như lúc gửi, xoá thẻ cũ nếu còn, đăng thẻ mới, `attachMessage`. Chỉ cho bài còn hiệu lực, chờ duyệt hoặc đã duyệt.
- Contribution có từ trước migration 10 mang `review_state = 'approved'`: thẻ cũ (nút `contrib:<id>`) vẫn bấm 👍 được, lần bấm đầu sẽ vẽ lại thẻ có nút 👎.

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
    | `cfgui:pollroles:<8 hex>` | RoleSelect nhiều role (0–25), `poll` | Đặt danh sách role tạo vote (DEC-044) |
    | `cfgui:board` · `cfgui:boardoff` | ChannelSelect một kênh (`BOARD_CHANNEL_TYPES`) · nút, `board` | Đặt kênh Bảng vàng (kiểm tra quyền như `/config board`) · tắt Bảng vàng |
    | `cfgui:admins:<8 hex>` | RoleSelect nhiều role (0–25), `board` | Đặt danh sách role admin bot (DEC-044) |
    | `cfgui:tier` | Nút, `board` | Mở `/config tier panel` trong một tin nhắn trả lời riêng mới |

  - customId mang **trạng thái lúc vẽ** để bảng cũ không ghi đè thay đổi mới hơn (như `tierui`):
    - form mang giá trị lúc mở (`drawn`, `XpFormValues`/`PollFormValues`). Khi lưu, ô có giá trị bằng `drawn` thì không ghi, nên hai admin sửa hai ô khác nhau không đè nhau. Ô số đọc bằng `parseFormNumber`: bỏ khoảng trắng, chỉ nhận chữ số (dấu chấm hay dấu phẩy bị từ chối, vì "2,5" hay "1.000" dễ hiểu nhầm), phải là số nguyên trong `SETTING_LIMITS`;
    - `pollroles`/`admins` mang vân tay 8 hex (`roleListFingerprint`, sha256 của danh sách đã sắp xếp) của danh sách lúc vẽ. Danh sách hiện tại khác vân tay thì vẽ lại bảng và báo (`CONFIG_ROLES_CHANGED`), không ghi; khớp thì ghi phần chênh lệch (`changeRoleGrants`), chỉ kiểm tra role mới thêm. customId dạng cũ một role (`pollrole`, `admin`) được báo "bảng đã cũ".
  - Menu chọn (trừ `nav`) bị từ chối thì bảng được vẽ lại theo dữ liệu thật trước khi báo lỗi: nếu không, Discord vẫn hiện lựa chọn vừa bị từ chối trong khi customId giữ role lúc vẽ, và thao tác bỏ chọn kế tiếp sẽ xoá nhầm role đang đặt (review Phase 15).
  - `nav` không đánh dấu `default` (placeholder ghi trang đang xem), để chọn lại trang đang xem là làm mới trang.
  - Role/kênh đã lưu mà không còn trong cache của guild (`ConfigPanelData.missingIds`): không điền sẵn vào menu (Discord có thể từ chối ID không tồn tại) và hiện cảnh báo, như `missingRoleIds` của `tierui`.
  - Mọi thao tác đi qua đúng service và kiểm tra như lệnh gõ tay: chặn role danh hiệu làm team, role admin bot hay role tạo vote; kiểm tra quyền của bot và của người thao tác ở kênh Bảng vàng; audit như lệnh gõ tay.
  - `XP_CHANNEL_TYPES` và `BOARD_CHANNEL_TYPES` chuyển từ `config.ts` sang `configPanel.ts`, dùng chung cho option của lệnh gõ tay và menu của bảng. Menu kênh vì vậy không có thread và category.
- Dispatcher định tuyến nút, menu chọn và form theo namespace customId (`buttonIds`). Có 6 namespace: `lb` (`/leaderboard`), `contrib` (`/contribution`), `poll` (`/poll`), `tierui` và `cfgui` (`/config`), `rankhelp` (`/rank`, nút ❓, customId cố định `rankhelp:show`, DEC-047).
- `/rank` trả lời bằng Components V2 (Phase 18): Container (viền màu bậc) gồm Section có tiêu đề và accessory Button ❓ (góc trên bên phải), MediaGallery `attachment://rank.png`, TextDisplay tóm tắt. Bấm ❓: tin trả lời riêng, không ping, nội dung dựng từ cấu hình thật của server và bộ hiển thị của người bấm (`src/discord/views/rank.ts`), tổng chữ ≤ 4000.
- `/rank-style bo:<theo server | bộ>` (DEC-047): thành viên chọn bộ hiển thị cho mình; công tắc tắt thì chỉ chọn được "theo server". Admin bật/tắt và xoá lựa chọn trên web (trang Danh hiệu, hồ sơ thành viên). Component của command `adminOnly` cũng qua `assertAdmin` (DEC-033), nên người mất quyền admin bấm vào bảng cũ vẫn bị chặn.
- `/config tier set-role|clear-role|list`: gán role cho bậc; người gán cần Manage Roles; chặn role nguy hiểm (`tierRoleSafetyIssue`: quyền cấp server và overwrite theo kênh) và role trùng vai trò admin bot, tạo vote, team (chặn hai chiều). Lỗi API role được backoff 10 phút theo (guild, user, role). `/admin xp give|remove|reset` đồng bộ role của người được chỉnh sau khi trả lời.

### 3.6 Quyền xem và đăng

- **Xem**: `/contribution view|list`, `/poll results|list|close` chỉ hiện mục mà người gọi xem được kênh gốc (`canViewChannel`). Mục không xem được thì báo "không tìm thấy", để không lộ nội dung kênh riêng tư.
- **Đăng**: tạo nội dung công khai (contribution, vote) cần quyền gửi tin ở kênh đó. `/rank` và `/leaderboard` thì trả lời riêng khi người gọi không có quyền gửi tin.
- **Guild**: bot bỏ qua tin nhắn và interaction của guild không có trong `DISCORD_GUILD_IDS`.

### 3.7 Trang web quản trị (DEC-039)

> **Ngoại lệ có phạm vi** của luật protected số 2 (dashboard, API server) và số 3 (thêm endpoint nhận kết nối từ ngoài vào), theo DEC-039 (duyệt PROP-037): chỉ **web quản trị nhúng trong process bot, chỉ mạng nội bộ hoặc VPN, đăng nhập bằng Discord**. Ngoại lệ không mở rộng sang dashboard công khai, API cho hệ thống khác, server hay dịch vụ riêng, reverse proxy. Mọi mở rộng cần proposal mới.

Tầng web `src/web/` ngang hàng tầng Discord: nhận request từ trình duyệt, kiểm tra, rồi gọi đúng service (và `configOps`) như lệnh `/config`. Không thêm dependency: dùng `node:http`, `node:crypto` và `fetch` có sẵn của Node. HTML render phía server; CSP không cho chạy script nào, nên trang không có JavaScript phía client.

**Luồng request**

```
node:http (WEB_HOST:WEB_PORT; requestTimeout 15 s, headersTimeout 10 s, keepAliveTimeout 5 s)
  → readRequest: chỉ GET/POST (khác → 405); POST chỉ nhận application/x-www-form-urlencoded (khác → 415),
                 body ≤ MAX_FORM_BYTES 256 KB (quá → 413); các lỗi này trả lời kèm Connection: close
  → createWebHandler.handle (bộ xử lý thuần, test gọi thẳng; mọi response thêm SECURITY_HEADERS; lỗi lạ → trang 500 + log)
      1. GET hoặc HEAD /healthz        → "ok" (không kiểm Host, không cần đăng nhập); HEAD khác → 405 kèm Allow
      2. Host ≠ host của WEB_BASE_URL   → 421 "Sai địa chỉ truy cập" (chống DNS rebinding)
      3. GET /static/app.css           → BASE_CSS + css của các PageModule
      4. đọc phiên từ cookie `ezbot_sid` (`__Host-ezbot_sid` khi https)
      5. route chung: GET / (trang đăng nhập, hoặc chuyển tới guild đầu tiên mà người đó là admin; không còn ở đâu → huỷ phiên)
                      · GET /auth/login · GET /auth/callback · POST /auth/logout (Origin khác → 403 kể cả khi chưa có phiên;
                      còn phiên thì cần CSRF)
      6. /g/<guildId><subpath>:
           chưa có phiên                         → GET: 303 về "/"; POST: 403
           GET: RateLimiter theo user (600 lần/phút) → 429
           guild không thuộc DISCORD_GUILD_IDS hoặc không có trong cache → 404
           lấy lại member qua REST (guild.members.fetch({ force: true }), không dùng cache)
             Discord báo 404 (không còn trong server) → coi là không phải admin; lỗi khác (Discord lỗi, mạng) → 503, giữ phiên
             → isAdmin (Manage Server theo member.permissions hoặc role admin bot; cùng hàm với lớp quyền 2) → không đạt: 403 và huỷ phiên
           POST: RateLimiter theo user (120 lần/phút) → 429
                 token `_csrf` khớp phiên (safeEqual) và Origin (nếu trình duyệt gửi) = WEB_BASE_URL → không đạt: 403
           tìm GuildRoute theo method + subpath     → không có: 404
           handler trang (GuildPageContext: req, deps, session, guild, member, actorId) → service / configOps
             UserError: POST → flash lỗi + 303 về GET cùng trang (hoặc trang cha gần nhất có GET: /board/off → /board);
             GET → trang lỗi 400. Lỗi khác: log + thông báo chung
```

**Đăng nhập** (OAuth2 authorization code, scope `identify`, `src/web/oauth.ts`):
- `GET /auth/login`: giới hạn tần suất theo IP (30 lần/phút) → state ngẫu nhiên vào cookie `ezbot_oauth_state` (Path=/auth, 10 phút; https: `__Host-`, Path=/) → 303 tới `discord.com/oauth2/authorize` với `redirect_uri=<WEB_BASE_URL>/auth/callback`, `prompt=none` (người đã cho phép từ trước thì Discord không hỏi lại).
- `GET /auth/callback`:
  - giới hạn tần suất theo IP; có `error` (người dùng huỷ) → về trang đăng nhập;
  - so `state` với cookie (safeEqual), `code` đúng định dạng;
  - `DiscordOAuth.identify`: POST `oauth2/token` (Basic auth bằng Application ID và `DISCORD_CLIENT_SECRET`), rồi GET `users/@me`, timeout 10 giây. **Access token bị bỏ ngay**, không lưu;
  - tìm guild đầu tiên trong `DISCORD_GUILD_IDS` mà người này là admin (member lấy qua REST). Không có → về trang đăng nhập với mã `noadmin`; Discord lỗi → mã `discord`. Có → tạo phiên, đặt cookie phiên, 303 tới `/g/<guildId>`.
- Trang đăng nhập chỉ hiện thông báo theo mã cố định (`?loi=denied|expired|failed|noadmin|busy|starting|discord|gone|out`, tra bằng `Object.hasOwn`), không phản chiếu chữ từ URL.
- Application ID lấy từ client sau khi login (`client.application.id`), nên không cần biến môi trường riêng.

**Phiên và form:**
- `SessionStore` trong bộ nhớ process. Cookie chỉ chứa token ngẫu nhiên 32 byte; map lưu theo SHA-256 của token. Hạn 8 giờ tuyệt đối, không gia hạn; tối đa 500 phiên (vượt thì bỏ phiên cũ nhất) và 5 phiên mỗi người (vượt thì bỏ phiên cũ nhất của chính người đó). Khởi động lại bot là mất mọi phiên. Đăng xuất chỉ huỷ phiên hiện tại.
- Mỗi phiên có một token CSRF; mọi form POST có `csrfField(ctx)`.
- Mẫu POST → xử lý → `redirectWithFlash` (303) → GET. Flash lưu trong phiên, hiện một lần.
- Form mang giá trị lúc vẽ trong input ẩn và chỉ ghi phần admin thật sự đổi, như customId mang trạng thái của `/config panel` (mục 3.5), để hai tab hay hai admin không đè nhau.
- Không tin giá trị form: kiểm tra lại ID kênh/role có trong guild và đúng loại; số đi qua `parseFormNumber` hoặc giới hạn của service (quy ước trong `src/web/types.ts`).

**Mô hình bảo mật:**
- Chỉ mạng nội bộ hoặc VPN: ràng buộc về hạ tầng (không mở cổng ra Internet, `docs/DEPLOY.md` mục 7.5), code không tự chặn theo IP.
- Xác thực bằng Discord (OAuth2 `identify`). Phân quyền bằng đúng `isAdmin` của lớp quyền 2, kiểm tra lại ở **mỗi request** với member lấy mới từ Discord. Không có mật khẩu; không lưu access token hay refresh token.
- Cookie `ezbot_sid` và `ezbot_oauth_state`: HttpOnly, SameSite=Lax (để cookie state đi theo khi Discord chuyển hướng về callback); khi `WEB_BASE_URL` là https thì thêm `Secure` và tiền tố `__Host-`. Tên có tiền tố riêng vì server dùng chung, mà trình duyệt gửi cookie theo host chứ không theo cổng: dịch vụ khác trên cùng máy vẫn nhận được cookie (rủi ro còn lại, DEPLOY 7.5 khuyên dùng tên miền nội bộ riêng cho bot).
- CSRF: token theo phiên cho mọi POST; Origin (nếu trình duyệt gửi) phải là WEB_BASE_URL cho mọi POST, kể cả đăng xuất khi chưa có phiên.
- Kiểm tra Host (421) chống DNS rebinding; `/healthz` là ngoại lệ duy nhất.
- `SECURITY_HEADERS` cho mọi response: CSP `default-src 'none'; style-src 'self'; img-src 'self' https://cdn.discordapp.com; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Cache-Control: no-store`.
- Escape: mọi HTML dựng bằng template `html` (tự escape giá trị chèn vào). Chữ kiểu Discord từ service hay `UserError` đi qua `discordText`: bỏ ký tự điều khiển, escape, thay mention bằng chỗ đánh dấu, xử lý markdown, rồi mới điền tên (tên có `**` hay backtick không làm lồng thẻ sai).
- Riêng tư: tên kênh mà người đăng nhập không có View Channel được giấu (`PRIVATE_CHANNEL_LABEL`, như "No access" của Discord) ở flash, tổng quan, nhật ký, Bảng vàng; trang kênh ẩn và không cho sửa các kênh đó.
- Giới hạn tần suất: `/auth/login` và `/auth/callback` 30 lần/phút mỗi IP (IPv6 gộp theo /64, không đọc X-Forwarded-For); GET trang guild 600 và POST 120 lần/phút mỗi người. Map đầy thì bỏ khoá cũ nhất. Body form ≤ 256 KB; có timeout request.
- Secret: `DISCORD_CLIENT_SECRET` chỉ đọc từ env qua `config.ts`, không bao giờ đưa vào log hay thông báo lỗi. `index.ts` đăng ký token và Client Secret với `registerSecret` của logger, nên nếu lỡ xuất hiện trong log thì bị che theo giá trị. Selfcheck chỉ báo "có".
- HTTP nội bộ: cookie đi không mã hoá trong mạng công ty (rủi ro đã nêu ở PROP-037, chấp nhận ở DEC-039). HTTPS cần chứng chỉ do IT cấp; `startWebServer` hiện chỉ phục vụ HTTP, gắn chứng chỉ là thay đổi code cần duyệt riêng (chỉ đổi `WEB_BASE_URL` sang https sẽ làm hỏng đăng nhập vì cookie `Secure`).
- Quyền đổi role admin bot trên web giống lớp quyền 2 (DEC-039): người chỉ có role admin bot đổi được role đó, và thành viên role mới thành admin web ngay (không có bước Integrations như lệnh Discord). Đã chấp nhận vì PROP-032 bị từ chối; trang Quyền cảnh báo tự khoá quyền.
- Không thêm quyền bot hay intent: lấy member qua REST không cần Server Members Intent.

**Dùng chung với `/config`: `src/discord/configOps.ts`**
- Tách từ `interactions/commands/config.ts` ở nền móng Phase 16, để lệnh Discord và web luôn cùng quy tắc:
  - role gán được (không phải @everyone hay role managed), không phải role danh hiệu, dùng được làm role admin bot, role tạo vote hay team;
  - quyền của bot và của người thao tác ở kênh Bảng vàng (LL-013);
  - `moveLiveBoard` / `turnOffLiveBoard`.
- Thông báo trả về dùng markdown/mention kiểu Discord; web chuyển sang HTML bằng `discordText`.
- `LiveBoardActions` (đăng/xoá message Bảng vàng) inject qua `WebDeps.liveBoardActions`; test thay bằng hàm giả.
- `GuildConfigService.setChannelsXpEnabled` nhận thêm `maxChannels`: menu Discord giữ `MAX_BULK_CHANNELS` (25), web dùng `MAX_WEB_BULK_CHANNELS` (500).

**Cấu hình** (`loadWebConfig` trong `src/config.ts`, mẫu trong `.env.example`):

| Biến | Ý nghĩa |
| --- | --- |
| `WEB_PORT` | 1024–65535. Không đặt → `config.web = null`, web tắt |
| `WEB_BASE_URL` | Bắt buộc khi bật. Chỉ `http(s)://host[:port]`, chuẩn hoá thành `url.origin`. Dùng cho redirect OAuth2 và kiểm tra Host/Origin |
| `DISCORD_CLIENT_SECRET` | Bắt buộc khi bật. Không được chứa khoảng trắng |
| `WEB_HOST` | Địa chỉ lắng nghe, mặc định `0.0.0.0` |

- Selfcheck: `checkWebConfig` (dùng đúng `loadWebConfig`) in trạng thái tắt/bật, địa chỉ lắng nghe và redirect cần đăng ký; lỗi chỉ nêu tên biến.
- Unit systemd không đổi: cổng > 1024 không cần capability; `RestrictAddressFamilies` đã có `AF_INET` và `AF_INET6`.

**Database:** Phase 16 không đổi schema. Phiên lưu trong bộ nhớ, nên phương án bảng phiên của PROP-037 không làm (DEC-039). Phase 17 không thêm migration cho web; migration 6 là của DEC-043 (kênh thông báo lên level, mục 4). Mọi thao tác ghi đi qua service có sẵn, audit với `actorId` là Discord user ID của người đăng nhập.

**Trang:** 15 module trong `src/web/pages/` (`NavKey` → đường dẫn dưới `/g/<guildId>`), menu chia 3 nhóm (`NavItem.group`):

| Nhóm | Trang (đường dẫn) | Tương ứng lệnh |
| --- | --- | --- |
| Dữ liệu | `overview` (rỗng) | `/config view` |
| | `members` `/members`, `/members/view?u=<userId>`; POST `/members/xp`, `/members/xp-reset`, `/members/contribution`, `/members/contribution-reset` | `/admin xp view·give·remove·reset`, `/admin contribution adjust·reset` |
| | `leaderboard` `/leaderboard?loai=&pv=&ky=&trang=` | `/leaderboard` |
| | `contributions` `/contributions?tt=&dd=&u=&trang=`, `/contributions/view?id=`; POST `/contributions/approve`, `/contributions/reject`, `/contributions/repost`, `/contributions/remove` | `/contribution list·view`, nút ✅/❌ trên thẻ, `/admin contribution remove` |
| | `polls` `/polls?tt=&trang=`, `/polls/view?id=`; POST `/polls/close` | `/poll list·results·close` (tạo vote chỉ bằng lệnh, DEC-042) |
| | `stats` `/stats` | `/admin stats` |
| Cấu hình | `channels`, `teams`, `settings`, `roles`, `board`, `tiers` | `/config …` |
| Hệ thống | `reset` `/reset`; POST `/reset/xp`, `/reset/contribution` | `/admin xp reset-all`, `/admin contribution reset-all` |
| | `backup` `/backup`; POST `/backup` | `/admin backup` (không có đường tải file) |
| Dữ liệu | `retro` `/retro`, `/retro/new`, `/retro/view?id=`, `/retro/settings` (Phase 19) | `/retro …` |
| | `audit` `/audit` | `/admin audit` |

Thêm trang: tạo module export `PageModule` (`routes`, `css` tuỳ chọn), thêm vào `PAGE_MODULES`; cần mục menu thì thêm `NavKey` và `NAV_ITEMS`.

**Phủ tính năng (DEC-041):**
- Mọi việc admin làm được trên Discord phải có trên web. `test/web-parity.test.ts` đọc định nghĩa lệnh thật (`loadModules`, như `commands.test.ts`) và đối chiếu từng subcommand và context menu với bảng `COVERAGE`. Mỗi mục có tên option lúc xếp loại và thuộc một trong ba loại:
  - `web`: đường dẫn GET có thật trong `PAGE_MODULES`;
  - `discordOnly`: kèm lý do;
  - `pending`: chỉ các mục trong `PENDING_AT_DEC_041`.
- Lệnh, subcommand hay option mới chưa xếp loại thì test fail.
- Phase 17 (DEC-042) đã làm hết 17 mục ban đầu, nên `PENDING_AT_DEC_041` rỗng: không lệnh nào được ở loại `pending`.
- Logic dùng chung giữa lệnh và trang đặt trong `src/discord/` theo mẫu `configOps.ts`: hàm nhận `client`/`services` và dữ liệu thuần, trả thông báo kiểu Discord, và các tác dụng phụ lên Discord inject được để test.

**Thao tác quản trị dùng chung: `src/discord/adminOps.ts` (Phase 17)**
- Quy tắc và thông báo của `/admin xp|contribution|backup`, dùng chung cho lệnh `/admin` và web. Gồm hằng số (`RESET_CONFIRMATION`, `MAX_ADJUST`, `REASON_MAX_LENGTH`, `MANUAL_BACKUP_COOLDOWN_MS`...), kiểm tra đầu vào (`normalizeReason`, `assertXpAmount`, `assertContributionDelta`, `assertResetConfirmation`) và thao tác:
  - `adjustMemberXp`, `resetMemberXp`, `resetAllXp`;
  - `adjustMemberContribution`, `resetMemberContribution`, `resetAllContribution`;
  - `removeContribution`;
  - `syncMemberTierRoles`;
  - `assertManualBackupAllowed`, `createManualBackup`;
  - `assertAdjustableUser`: tài khoản thật, không phải bot, như option `thanh-vien`.
- `AdminActions` (`WebDeps.adminActions`, mặc định `DEFAULT_ADMIN_ACTIONS`): tác dụng phụ lên Discord inject được để test:
  - sửa message contribution/vote;
  - `syncTierRoles`;
  - `searchMembers`: REST `members/search`, không cần intent GuildMembers;
  - `displays`: MemberDirectory;
  - `fetchUser`: REST, null nếu không có tài khoản.
- Lệnh trả lời trước rồi mới gọi API role hoặc sửa message (giới hạn 3 giây của interaction). Web gọi xong rồi mới chuyển hướng; đồng bộ role hay sửa message thất bại thì nối một dòng cảnh báo vào thông báo.

**Phần chung của các trang dữ liệu (Phase 17)**
- `src/web/discord.ts`:
  - `fetchMember` (server kiểm quyền);
  - `lookupMember` (trang lấy thành viên được thao tác; Discord lỗi thì UserError);
  - `canViewItemChannel` / `hiddenChannelIds`: cùng quy tắc `canViewChannel` của lệnh, người xem luôn là admin. Kênh không còn thì xem được; thread riêng tư cần là thành viên hoặc có Manage Threads.
- `src/web/widgets.ts`: `queryPage` (`?trang=`), `pager` (giữ bộ lọc), `parseUserId` (ID hoặc mention), `parsePositiveId`, `userCell`/`memberLink` (avatar chỉ từ `cdn.discordapp.com`), `formatDateTime`, `HIDDEN_ITEM_TEXT`, `withMessageEditNote`.
- `GuildRoute.errorRedirect`: POST của trang chi tiết chỉ định trang GET để quay về khi có lỗi (ví dụ `/members/view?u=<id>`). Server chỉ nhận đường dẫn con chữ thường kèm query đơn giản (`ERROR_REDIRECT`); sai định dạng hoặc hàm ném lỗi thì dùng `pageAfterPost`.
- `discordText` đổi mốc thời gian `<t:giây:kiểu>` thành giờ Việt Nam và bỏ dấu `\` của markdown đã escape, nên thông báo của adminOps và service hiện đúng trên web.
- Danh sách có phân trang ở tầng service: `PollService.listPage` (mở/đóng tính tại thời điểm đọc, như `Poll.open`), `ContributionService.listPage` (lọc tác giả, trạng thái kể cả đã gỡ). Kẹp trang bằng `src/shared/paging.ts`; SQL dùng named parameter.
- Riêng tư: mục trong kênh admin không xem được bị giấu tiêu đề, câu hỏi, tên kênh và link. Chi tiết vote thì 400 "không tìm thấy" (như `/poll results`); contribution vẫn gỡ được (như `/admin contribution remove`).
- Sao lưu: web chỉ tạo bản sao lưu và liệt kê tên file, không có route đọc file. `BackupService.list` không tạo thư mục khi chỉ đọc.

### 3.8 Retro sprint theo team (Phase 19, DEC-049)

- **Module** `src/modules/retro/` (`services.retro`, không import discord.js):
  - phiên gắn kênh hoặc thread và tuỳ chọn role team; mỗi kênh một phiên mở (unique index một phần);
  - phiếu theo người, 5 cột: Learned, Thiếu sót, Sáng tạo, Tuyên dương, Đặt tên sprint; điền lại được tới khi đóng;
  - ứng viên tên sprint: bỏ trùng theo NFC, không phân biệt hoa thường; bỏ tên chỉ toàn số; nhớ người đề xuất;
  - XP ghi qua `xpLedger`, nguồn `admin`, người thao tác là bot:
    - điền: `fill_xp`, mỗi phiên một lần;
    - người đề xuất tên thắng: `proposer_bonus_xp`, chốt trong transaction nên gọi lại cũng không cộng lần hai;
  - quyền: `permissions.ts` `canCreateRetro` (admin bot hoặc role quản lý retro) và `canManageRetro` (thêm người tạo phiên).
- **Thao tác dùng chung lệnh và web** `src/discord/retroOps.ts`:
  - `createRetroSession`;
  - `closeRetroSession`, `reopenRetroSession`, `extendRetroSession`;
  - `startRetroVote`, `pickRetroName`, `remindRetro`;
  - `writeRetroDoc`, `retroDocSection`;
  - `RetroActions` (ghi Confluence, sửa/đăng tin) inject được để test.
- **Discord:**
  - lệnh `/retro create|close|reopen|extend|vote|status|remind|pick|write|repost|summary`; không đặt `setDefaultMemberPermissions`, để role quản lý retro dùng được; quyền kiểm trong code;
  - người quản lý không phải admin phải xem được kênh của phiên (`requireVisibleSession`), không thì báo "không tìm thấy";
  - bot phải có View Channel, Send Messages (thread: Send Messages in Threads), Embed Links ở kênh của phiên, và là thành viên nếu đó là thread riêng tư (`assertBotCanUseRetroChannel`, dùng chung cho lệnh và web);
  - nút `retro:fill:<id>` mở form `retro:form:<id>` gồm 5 ô;
  - `retroScheduler` chạy mỗi 30 giây: tự đóng phiên quá hạn, chốt vote tên đã đóng;
  - `afterPollClosed` móc vào lúc vote đóng (lệnh, lịch quét, web);
  - `/retro status`: chỉ admin bot thấy tên người đã điền.
- **Confluence** `src/integrations/confluence.ts`:
  - REST Data Center: GET `/rest/api/content/{id}?expand=body.storage,version`, PUT với version+1; header Bearer, `redirect: "error"`, timeout 15 giây; gặp 409 thì đọc lại và thử lại;
  - chỉ gọi host `CONFLUENCE_BASE_URL` (bắt buộc https); `redirect: "manual"`, phản hồi 3xx báo lỗi rõ; luôn đọc hoặc huỷ phần thân phản hồi;
  - chỉ ghi vào trang thuộc space trong `CONFLUENCE_SPACE_KEYS` (GET `expand=space`); không ghi khi khu vực không đổi; trang dùng `<ac:layout>` thì thêm một layout-section một cột ở cuối;
  - bot quản lý một khu vực cuối trang, giữa macro anchor `ezbot-retro-<guild>-<phiên>-start` và `…-end`: tiêu đề, bảng 5 cột ẩn danh, tên sprint đã chốt; ghi lại thì thay đúng khu vực đó;
  - lỗi lưu vào `confluence_error`, hiện trên web, có nút ghi lại;
  - không đặt `CONFLUENCE_*` thì bỏ bước ghi;
  - token được `registerSecret`, selfcheck che.
- **Web:**
  - `/retro` (danh sách), `/retro/new` (tạo phiên), `/retro/view?id=` (chi tiết, thao tác, xuất chữ để dán tay);
  - `/retro/settings` (XP, thời hạn vote, role quản lý; bảng role không có "Chọn tất cả");
  - phiên ở kênh admin không xem được: vẫn quản lý được, nhưng giấu tiêu đề, kênh, nội dung.

## 4. Dữ liệu

| Nhóm | Bảng |
| --- | --- |
| Cấu hình | `guild_settings` (có `poll_xp_daily_cap`, `xp_channel_mode`, `level_up_channel_id`, `contribution_channel_id`, `contribution_interaction_xp`, `contribution_interaction_xp_daily_cap`), `guild_role_grants` (role admin bot, role tạo vote, role duyệt contribution), `channel_settings` (cấu hình riêng, thắng chế độ kênh), `team_roles`, `tier_roles` (có `created_by_bot`), `tier_set_config`, `tier_name_overrides`, `live_boards` |
| Retro | `retro_sessions`, `retro_entries`, `retro_config`, `retro_manager_roles` (Phase 19) |
| Activity XP | `xp_events` (ledger), `xp_event_teams` (snapshot team), `member_xp` (tổng + last_message_xp_at), `xp_team_totals` (cache điểm team) |
| Contribution | `contributions` (có `source_message_id` và cột duyệt), `contribution_teams`, `contribution_events`, `contribution_event_teams`, `member_contribution`, `contribution_team_totals`, `contribution_votes` (👍), `contribution_downvotes` (👎), `contribution_interaction_xp` (XP người bấm) |
| Vote | `polls`, `poll_options`, `poll_votes`, `poll_participants` (XP một lần) |
| Quản trị | `audit_log` |

Migration (10 migration sau Phase 20; version lưu ở `PRAGMA user_version`):
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
- Phase 16 (trang web quản trị, DEC-039) **không** thêm migration: phiên đăng nhập web chỉ lưu trong bộ nhớ (mục 3.7).
- **6** (DEC-043): `guild_settings.level_up_channel_id TEXT` (NULL = gửi thông báo lên level ở kênh vừa nhắn, như trước). Guild đang chạy nhận NULL nên hành vi không đổi khi cập nhật.
  - Backup/restore: vẫn một file SQLite. Backup cũ (≤ 5) khôi phục vào code mới thì tự migrate lên 6, kênh thông báo trở về NULL: đặt lại sau khi khôi phục.
  - Code cũ (≤ 5) gặp DB version 6 thì từ chối khởi động; selfcheck của code cũ báo ❌.
- **7** (Phase 18, DEC-044): bảng `guild_role_grants (guild_id, kind 'admin'|'poll_creator', role_id, created_at)`, khoá chính `(guild_id, kind, role_id)`. Role đang đặt ở `guild_settings.admin_role_id` / `poll_creator_role_id` được chép sang, rồi hai cột cũ về NULL (không xoá cột, code không dùng nữa). `GuildSettings.adminRoleIds` / `pollCreatorRoleIds` là danh sách (tối đa `MAX_GRANT_ROLES` = 25); `isAdmin`/`canCreatePoll` xét có ít nhất một role. `GuildConfigService.changeRoleGrants` đổi theo phần chênh lệch trong một transaction, audit `config.update`.
  - Backup/restore: vẫn một file SQLite; backup cũ tự migrate lên 7 (giữ role đã đặt). Code cũ (≤ 6) gặp DB version 7 thì từ chối khởi động.
- **8** (Phase 18, DEC-047): bảng `member_tier_prefs (guild_id, user_id, set_key, updated_at)` (bộ danh hiệu hiển thị của từng người) và cột `tier_set_config.allow_personal INTEGER NOT NULL DEFAULT 1 CHECK (0,1)` (công tắc cho phép tự chọn; guild chưa có dòng thì coi là bật). Khoá bộ lạ đọc như "theo server".
  - `TierSetService.displayFor(guildId, userId)`: bộ hiển thị (đã áp tên tuỳ chỉnh của server cho bộ đó) dùng cho thẻ `/rank` (GamificationService.profile) và lời chúc lên level/lên bậc (messageCreate). Role danh hiệu, `/leaderboard`, Bảng vàng vẫn dùng `tierSets.current` (bộ của server).
  - Backup/restore: một file SQLite; backup cũ tự migrate lên 8 (không có lựa chọn cá nhân, công tắc bật). Code cũ (≤ 7) gặp DB version 8 thì từ chối khởi động.
- **9** (Phase 19, DEC-049): retro sprint.
  - Bảng `retro_sessions`: unique index một phần `(guild_id, channel_id) WHERE status='open'`, unique `poll_id`, cột `tie_names` (JSON).
  - Bảng `retro_entries`: `id` tự tăng, `UNIQUE(session_id, user_id)`, 5 cột chữ, `team_role_ids` (snapshot), `fill_xp_event_id`.
  - Bảng `retro_config` (mặc định 20 / 100 / 1440 phút) và `retro_manager_roles`.
  - Xoá nội dung một phiên thì đặt các cột chữ về NULL (DEC-049, ngoại lệ có chủ ý của DEC-027).
  - Thêm cột `retro_entries.order_keys` (khoá ngẫu nhiên 128 bit cho từng ô; mỗi cột trộn riêng) và `retro_sessions.summary_posted_at` (lịch quét đăng bù bảng tổng hợp).
  - Xoá nội dung: kết nối bật `PRAGMA secure_delete=ON` (đặt trong `openDatabase`), sau khi xoá thì chạy `wal_checkpoint(TRUNCATE)`. Backup cũ và lịch sử trang Confluence vẫn giữ bản cũ.
  - Code cũ (≤ 8) gặp DB version 9 thì từ chối khởi động.
- **10** (Phase 20, DEC-051): duyệt contribution, 👎, XP người bấm.
  - `contributions`: thêm `review_state TEXT NOT NULL DEFAULT 'approved' CHECK (pending|approved|rejected)` (dòng cũ nhận `approved`), `reviewed_by`, `reviewed_at`, `review_reason`. Unique index nguồn tin nhắn dựng lại, bỏ qua bài bị từ chối: `... WHERE source_message_id IS NOT NULL AND status = 'active' AND review_state <> 'rejected'`; thêm index `(guild_id, review_state, created_at)`.
  - Bảng `contribution_downvotes (contribution_id, guild_id, voter_id, event_id, reason, locked_at, created_at)`, khoá chính `(contribution_id, voter_id)`; bảng `contribution_interaction_xp (contribution_id, guild_id, user_id, xp_event_id, revoked_at, created_at)`.
  - `guild_settings`: `contribution_channel_id`, `contribution_interaction_xp` (mặc định 5), `contribution_interaction_xp_daily_cap` (mặc định 25).
  - `guild_role_grants` dựng lại để CHECK nhận thêm `contribution_reviewer` (chép nguyên dữ liệu).
  - Backup/restore: vẫn một file SQLite; backup cũ tự migrate lên 10 (contribution cũ coi như đã duyệt, chưa có kênh contribution: admin chọn lại). Code cũ (≤ 9) gặp DB version 10 thì từ chối khởi động.

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
- Trang web quản trị (DEC-039, mục 3.7): tắt mặc định. Khi bật, bề mặt mới là một cổng HTTP trong mạng nội bộ. Không thêm quyền bot hay intent. Có đăng nhập Discord (`identify`), kiểm tra admin ở mỗi request, CSRF, kiểm tra Host/Origin, CSP, giới hạn tần suất, escape mọi dữ liệu hiển thị.
- Secret (`DISCORD_TOKEN`, `DISCORD_CLIENT_SECRET`) chỉ lấy từ env; logger che token và secret đã đăng ký (`registerSecret`); `build/` không chứa file cấu hình.
- `.npmrc ignore-scripts=true`; systemd chạy bằng user riêng và chỉ được ghi vào `data/`.

## 6. Giao tiếp ra bên ngoài

| Thời điểm | Đích |
| --- | --- |
| Runtime | Discord Gateway (WebSocket) và Discord REST, qua discord.js |
| Runtime | CDN avatar của Discord (chỉ `cdn.discordapp.com`), HTTPS, không theo redirect, chỉ PNG/JPEG/WebP tối đa 512 KB, qua `AvatarFetcher` (DEC-030) |
| Runtime, khi admin đăng nhập web | Discord OAuth2: POST `discord.com/api/v10/oauth2/token`, GET `users/@me`, timeout 10 giây, qua `DiscordOAuth` (DEC-039) |
| Runtime, chiều vào (chỉ khi bật web) | Trình duyệt trong mạng nội bộ/VPN → cổng `WEB_PORT` (HTTP) do chính process bot lắng nghe (DEC-039) |
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
- Phase 16 (trang web quản trị):
  - `test/web-helpers.ts` là bộ dựng dùng chung: service thật trên SQLite `:memory:`, server Discord giả (guild, role, kênh, thành viên với quyền và role), `fakeDiscordFetch` thay OAuth2 của Discord, gọi thẳng bộ xử lý thuần `createWebHandler` (không cần socket). Có sẵn `login()` (đi hết luồng OAuth2 giả, trả cookie và token CSRF), `call()`, `withCsrf()`, `setCookieValue()`, các ID mẫu (`ADMIN_USER`, `ROLE_ADMIN_USER`, `PLAIN_USER`, `STRANGER`, …);
  - `test/web-core.test.ts`: HTML escape và `discordText`, Host sai → 421, header bảo mật, luồng đăng nhập (state, huỷ, không phải admin), đăng xuất cần CSRF, quyền kiểm lại ở mỗi request, CSRF/Origin cho POST, flash; một test chạy qua `node:http` thật (chỉ nhận form, chặn body quá lớn, phương thức lạ);
  - `test/selfcheck.test.ts` kiểm `checkWebConfig` (tắt, bật, lỗi không in secret);
  - test của từng trang dùng cùng bộ dựng `web-helpers.ts`.
