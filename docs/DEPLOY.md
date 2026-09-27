# Triển khai và vận hành

> Dành cho người cài đặt và vận hành bot trên server Linux. Kiến trúc: **1 process Node.js + 1 file SQLite + Discord**. Không cần database server, không mở port nào từ ngoài vào.

## 1. Yêu cầu

| Thành phần | Yêu cầu |
| --- | --- |
| Hệ điều hành | Linux có systemd ≥ 247 (ví dụ Ubuntu Server 24.04 LTS) |
| Node.js | **24 LTS** (tối thiểu 22.14, vì better-sqlite3 cần N-API 10) |
| Mạng ra ngoài | HTTPS/WSS cổng 443 tới `discord.com`, `gateway.discord.gg`; tới `cdn.discordapp.com` để tải avatar vẽ lên ảnh thẻ (DEC-030); tới `registry.npmjs.org` khi cài đặt |
| Mạng vào | Không cần (trừ SSH để quản trị) |
| Tài nguyên | 1 vCPU, 1–2 GB RAM, ~20 GB ổ đĩa (tính cả bản sao lưu) |

Không cần C++ build tools: better-sqlite3 13 đã kèm sẵn binary, và `.npmrc` tắt install script (LL-008).

Ảnh thẻ `/rank`, `/leaderboard` và Bảng vàng do bot tự vẽ bằng `@napi-rs/canvas` (DEC-030):
- `npm ci` tự cài binary dựng sẵn đúng nền tảng (ví dụ `@napi-rs/canvas-linux-x64-gnu` trên Ubuntu x64), không cần cài Cairo hay thư viện đồ hoạ nào;
- font **Be Vietnam Pro** đã nằm trong repo (`assets/fonts/`, giấy phép SIL OFL 1.1 trong `OFL.txt`), không cần cài font lên server;
- nếu không tải được avatar (mạng chặn CDN, quá hạn), ảnh vẫn được vẽ với chữ cái đầu thay cho avatar.

## 2. Chuẩn bị Discord Application

1. Vào https://discord.com/developers/applications và tạo Application. Nên có Application **riêng** cho test và cho production.
2. Tab **Installation**: bỏ chọn "User Install" nếu có.
3. Tab **Bot**:
   - **Tắt "Public Bot"**, để chỉ chủ Application mời được bot. Bot chỉ phục vụ các server trong `DISCORD_GUILD_IDS` và bỏ qua server khác, nhưng không nên để người ngoài mời bot.
   - Reset Token rồi lưu vào `.env`. Không gửi token qua chat hay email.
   - **Privileged Gateway Intents**: bật **Message Content Intent** (bắt buộc cho chống spam, DEC-023). Để **tắt** Server Members Intent và Presence Intent.
4. Tab **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`.
   - Bot Permissions (đủ, không thừa):

     | Quyền | Giá trị | Dùng để |
     | --- | --- | --- |
     | View Channels | 1024 | Đọc tin nhắn để tính Activity XP |
     | Send Messages | 2048 | Thông báo lên level, đăng vote/contribution, Bảng vàng |
     | Send Messages in Threads | 274877906944 | Thông báo lên level trong thread |
     | Embed Links | 16384 | Embed của vote, contribution, lệnh quản trị |
     | Attach Files | 32768 | Ảnh thẻ `/rank`, `/leaderboard` và Bảng vàng (DEC-030) |
     | Manage Roles | 268435456 | Tự gán role danh hiệu theo level; tạo và đổi tên role danh hiệu (DEC-031, DEC-033) |

   - Tổng permissions: 1024 + 2048 + 274877906944 + 16384 + 32768 + 268435456 = **275146394624**. Link mời có dạng:
     `https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot+applications.commands&permissions=275146394624`
   - Không dùng role danh hiệu thì bỏ Manage Roles: 275146394624 − 268435456 = **274877959168** (danh hiệu vẫn hiện trên thông báo, `/rank` và bảng xếp hạng).
   - Không cấp Administrator hay quyền quản lý nào khác. Manage Roles chỉ cho bot gán các role **nằm dưới** role của bot, và bot tự từ chối role có quyền quản trị/kiểm duyệt (mục 7.1).
   - Mở URL vừa tạo để mời bot vào server.
   - Bot đã được mời từ trước (bản chưa có Attach Files, Manage Roles): mở lại link mời mới để cập nhật quyền, hoặc thêm hai quyền này cho role của bot trong **Server Settings → Roles**.
5. Lấy Server ID: trong Discord, bật Developer Mode, chuột phải vào server và chọn Copy Server ID.

## 3. Cài đặt lần đầu

Nguyên tắc phân quyền:
- mã nguồn thuộc **root**, nên user chạy bot không sửa được code;
- user `discordbot` chỉ sở hữu thư mục `data/` (quyền 700);
- `.env` thuộc root, quyền 600; systemd đọc file này trước khi hạ quyền.

```bash
# User hệ thống để chạy bot (không login, không home)
sudo useradd --system --no-create-home --shell /usr/sbin/nologin discordbot

# Mã nguồn thuộc root (từ repo nội bộ hoặc bản copy)
sudo git clone <repo-nội-bộ> /opt/company-discord-bot
cd /opt/company-discord-bot

# Cài dependency và build (an toàn khi chạy bằng root vì .npmrc tắt install script)
sudo npm ci
sudo npm run build

# Thư mục dữ liệu: chỉ user chạy bot truy cập được
sudo install -d -m 700 -o discordbot -g discordbot data

# Cấu hình bí mật
sudo install -m 600 .env.example .env
sudo nano .env                 # điền DISCORD_TOKEN, DISCORD_GUILD_IDS
```

## 4. Chạy như service (systemd)

```bash
sudo cp deploy/company-discord-bot.service /etc/systemd/system/
# Kiểm tra trong file: đường dẫn node (`which node`), WorkingDirectory, User
sudo systemctl daemon-reload
sudo systemctl enable --now company-discord-bot
sudo systemctl status company-discord-bot
journalctl -u company-discord-bot -f     # thấy "Bot đã sẵn sàng" là chạy tốt
```

Unit đã giới hạn quyền của process:
- chỉ ghi được vào `/opt/company-discord-bot/data`;
- `UMask=0077`, nên file database và backup chỉ user `discordbot` đọc được. Phiếu vote "ẩn danh" vẫn lưu ai chọn gì trong DB, nên file DB phải được bảo vệ;
- không có capability; system call và address family bị giới hạn. System call ngoài danh sách cho phép bị trả lỗi (`SystemCallErrorNumber=EPERM`) thay vì giết process bằng SIGSYS, để thư viện vẽ ảnh native không làm sập bot;
- trần bộ nhớ `MemoryMax=1G`: vượt trần thì process bị dừng và systemd tự khởi động lại.

Nếu đổi `DATABASE_PATH` hoặc `BACKUP_DIR` ra ngoài thư mục `data/`, phải sửa `ReadWritePaths` cho khớp.

**Kiểm tra nhanh sau khi cài** (smoke test, làm cả sau mỗi lần cập nhật):
1. Trong Discord, chạy `/rank` và `/leaderboard` ở một kênh bot được gửi tin: phải thấy **ảnh** thẻ rank và ảnh bảng xếp hạng (không chỉ có phần chữ).
2. Xem log: `journalctl -u company-discord-bot --since "10 min ago"`. Không được có lỗi vẽ ảnh (`canvas`, `Skia`, "Không vẽ được ảnh"), không có dòng `SIGSYS` hay `code=killed`.
3. Nếu ảnh không hiện: kiểm tra quyền **Attach Files** của bot ở kênh đó (mục 8). Nếu log có lỗi syscall/SIGSYS: báo lại người phụ trách kèm log; tạm thời có thể comment dòng `SystemCallFilter=` trong unit rồi `daemon-reload` và restart để xác nhận nguyên nhân.

## 5. Cập nhật phiên bản

```bash
cd /opt/company-discord-bot
sudo git pull
sudo npm ci
sudo npm run build          # luôn build lại từ đầu, không copy chồng build/ cũ (LL-010)
sudo systemctl restart company-discord-bot
```

- Migration database chạy tự động khi bot khởi động.
- Nếu database mới hơn code (ví dụ lỡ quay về bản cũ), bot từ chối khởi động để tránh hỏng dữ liệu.

## 6. Sao lưu và khôi phục (DEC-017)

**Sao lưu tự động:**
- Mỗi giờ bot kiểm tra một lần; nếu bản gần nhất đã cũ hơn 24 giờ thì tạo bản mới trong `data/backups/`, tên dạng `bot-<thời điểm UTC>.db`.
- Giữ `BACKUP_KEEP` bản mới nhất (mặc định 14).
- Admin có thể sao lưu ngay bằng `/admin backup` (tối đa một lần mỗi 10 phút). Bản thủ công tên dạng `bot-manual-...db`, xoay vòng riêng, không đẩy mất bản hàng ngày.

**Chép bản sao ra khỏi server** (bắt buộc, để chống hỏng máy). Ví dụ cron hằng ngày:

```bash
# /etc/cron.d/company-discord-bot-backup — chép sang nơi lưu nội bộ do IT chỉ định.
# Thư mục đích phải có quyền 700 và chỉ tài khoản vận hành truy cập được (file backup chứa toàn bộ dữ liệu).
30 3 * * * discordbot rsync -a --chmod=D700,F600 /opt/company-discord-bot/data/backups/ <nơi-lưu-nội-bộ>/company-discord-bot/
```

**Khôi phục:**

```bash
sudo systemctl stop company-discord-bot
cd /opt/company-discord-bot/data
sudo mv bot.db bot.db.broken            # giữ lại bản lỗi để điều tra
sudo rm -f bot.db-wal bot.db-shm
sudo install -m 600 -o discordbot -g discordbot backups/<bản-cần-khôi-phục>.db bot.db
sudo systemctl start company-discord-bot
```

Sau khi khôi phục, **kiểm tra kênh Bảng vàng** (mục 7.2):
- bot chỉ nhớ message bảng xếp hạng có trong bản sao lưu. Message Bảng vàng bot đăng **sau** thời điểm sao lưu (ví dụ sau khi đổi kênh, hoặc đăng lại vì message cũ bị xoá) không còn do bot quản lý: bot không sửa, không xoá message đó;
- xoá tay các message bảng xếp hạng thừa. Không chắc message nào bot đang dùng thì xoá hết message bảng xếp hạng trong kênh, rồi chạy lại `/config board kenh:<kênh>` để bot đăng một message mới và quản lý message đó;
- nếu kênh Bảng vàng trong bản sao lưu khác kênh đang muốn dùng, cũng chạy lại `/config board kenh:<kênh>`, rồi xoá tay message thừa ở kênh cũ.

Nên diễn tập khôi phục một lần trước khi đưa vào dùng chính thức.

## 7. Cấu hình ban đầu trong Discord

Người có quyền **Manage Server** chạy các lệnh sau (mọi thay đổi đều được ghi audit log):

1. `/config team add` cho từng role team (Backend, Frontend, QA, ...).
2. `/config channel set` để tắt XP ở channel bot, announcements, ...
3. `/config xp` nếu muốn chỉnh XP mỗi tin, cooldown, độ dài tối thiểu hoặc khoảng chống trùng.
4. `/config admin-role` nếu muốn một role khác (không có Manage Server) cũng có quyền admin bot. **Cần làm thêm một bước:**
   - vào Server Settings → Integrations → chọn bot;
   - cho phép role đó dùng lệnh `/admin` và `/config`.

   Lý do: hai lệnh này mặc định chỉ hiện với người có Manage Server, và Discord chặn trước khi yêu cầu tới được bot.
5. `/config poll` để đặt XP mặc định khi vote, role được tạo vote và `gioi-han-xp-ngay`: XP tối đa một người nhận từ vote trong một ngày (giờ Việt Nam; mặc định 25, **0 = không giới hạn**; DEC-028).
6. Bộ danh hiệu và role danh hiệu (tuỳ chọn; role cần quyền Manage Roles, DEC-031, DEC-033): `/config tier panel`, xem mục 7.1.
7. Bảng vàng (tuỳ chọn, DEC-030), xem mục 7.2.
8. Kiểm tra lại bằng `/config view`.

Nên tắt quyền **Use Application Commands** của thành viên ở các kênh chỉ đọc (ví dụ #thong-bao). Bot cũng đã tự chặn việc đăng contribution hay vote vào kênh mà người đó không có quyền gửi tin.

### 7.1. Danh hiệu và role danh hiệu

Mỗi thành viên có một **bậc danh hiệu** theo level: 8 bậc, mốc level 0, 3, 6, 10, 15, 20, 30, 40. Danh hiệu chỉ để hiển thị (thông báo lên level, `/rank`, bảng xếp hạng, Bảng vàng), không đổi công thức XP hay level. Mỗi server chọn một trong 5 bộ có sẵn (DEC-033):

| Bộ | Bậc 1 → bậc 8 | Tên gọi bậc |
| --- | --- | --- |
| Tu tiên (mặc định) | Luyện Khí, Trúc Cơ, Kim Đan, Nguyên Anh, Hóa Thần, Luyện Hư, Hợp Thể, Độ Kiếp | Cảnh giới |
| Rank game | Đồng, Bạc, Vàng, Bạch Kim, Kim Cương, Tinh Anh, Cao Thủ, Thách Đấu | Hạng |
| Kiếm hiệp | Tân Thủ, Kiếm Khách, Hiệp Sĩ, Tráng Sĩ, Đại Hiệp, Tông Sư, Chưởng Môn, Võ Lâm Minh Chủ | Danh hiệu |
| Cây xanh | Hạt Giống, Nảy Mầm, Cây Non, Ra Hoa, Kết Trái, Cây Lớn, Cổ Thụ, Đại Thụ Ngàn Năm | Giai đoạn |
| Vũ trụ | Thiên Thạch, Tiểu Hành Tinh, Hành Tinh, Ngôi Sao, Sao Khổng Lồ, Tinh Vân, Thiên Hà, Vũ Trụ | Thiên thể |

Mỗi bộ có giọng văn riêng cho thông báo lên level, thông báo lên bậc và chữ trên ảnh thẻ. Đổi bộ có hiệu lực ngay với thông báo, `/rank` và `/leaderboard`; Bảng vàng đổi chậm nhất ở lượt cập nhật định kỳ kế tiếp (khoảng 10 phút).

#### Bảng điều khiển `/config tier panel`

Cách dễ nhất là chạy `/config tier panel`. Bảng chỉ admin dùng được và bot trả lời riêng cho người gọi. Bảng gồm:

- menu **chọn bộ danh hiệu**;
- 8 ô **chọn role**, mỗi bậc một ô, điền sẵn role đang gán;
- nút **đổi tên bậc**: mở form để sửa tên và emoji của từng bậc trong bộ đang dùng;
- nút **tạo/đồng bộ role**, xem "Cách 1" bên dưới;
- nút **khôi phục tên mặc định** của bộ đang dùng.

Mọi thao tác trên bảng được kiểm tra quyền giống lệnh gõ tay và ghi vào audit log. Các lệnh gõ tay tương ứng:

| Lệnh | Việc |
| --- | --- |
| `/config tier style` | Chọn bộ danh hiệu |
| `/config tier rename` | Đổi tên và emoji một bậc của bộ đang dùng |
| `/config tier reset-names` | Khôi phục tên mặc định của bộ đang dùng |
| `/config tier setup-roles` | Tạo role cho bậc chưa có role; đổi tên và màu role đã gán theo bộ đang dùng |
| `/config tier set-role` · `clear-role` | Gán hoặc bỏ role của một bậc |
| `/config tier list` | Xem bộ đang dùng và role của từng bậc |

Quy tắc đổi tên bậc:

- Tên dài 1 đến 32 ký tự, không chứa các ký tự `<` `>` `@` `*` `_` `~` `` ` `` `|` `\` `[` `]` hay ký tự điều khiển (để tên không làm hỏng định dạng tin nhắn hoặc thành mention).
- Emoji là đúng một emoji Unicode, đặt ở đầu tên, ví dụ `🟡 Kim Đan`. Emoji riêng của server không dùng được. Bỏ trống thì dùng tên và emoji mặc định.
- Tên tuỳ chỉnh lưu theo từng bộ: đổi sang bộ khác rồi quay lại thì tên cũ vẫn còn. Màu và mốc level luôn theo bộ, không đổi được.

#### Role danh hiệu

Tính năng này tuỳ chọn. Chưa gán role cho bậc nào thì bot không đụng tới role của ai. Khi đã gán, bot giữ cho mỗi thành viên **đúng một** role danh hiệu, là role của bậc hiện tại. Role gán theo **vị trí bậc** (bậc 1 đến bậc 8, dùng chung cho mọi bộ), nên đổi bộ không làm mất role đã gán.

Role của bot là role mang tên bot mà Discord tự tạo khi mời bot vào server. Role danh hiệu là một role khác, dành riêng cho việc này. Có hai cách để có role danh hiệu:

**Cách 1: bot tự tạo (khuyên dùng).** Bấm nút **tạo/đồng bộ role** trên bảng điều khiển, hoặc chạy `/config tier setup-roles`.

- Bậc chưa có role: bot tạo role mới mang tên bậc, màu theo bộ. Role do bot tạo **không có quyền gì**; đừng cấp thêm quyền cho các role này về sau.
- Bậc đã có role: bot đổi tên và màu role đó theo bộ đang dùng. Sau khi đổi bộ hoặc đổi tên bậc, bấm lại nút này để tên role khớp với danh hiệu.
- Bot bỏ qua role không an toàn hoặc không thấp hơn role của bot, rồi báo số role đã tạo, đã đổi tên và đã bỏ qua.

**Cách 2: admin tự tạo role** trong **Server Settings → Roles**, rồi chọn trong ô của bậc tương ứng trên bảng điều khiển (hoặc `/config tier set-role`). Không cần tạo đủ 8 role. Không dùng lại role đang có ý nghĩa khác (role nhân viên, role mở kênh, role team, role admin bot, role tạo vote): bot **gỡ** role danh hiệu khỏi mọi người không ở đúng bậc khi họ nhắn tin, và **gán** cho mọi người đủ level. Bot từ chối role đang là role admin bot, role tạo vote hoặc role team; ngược lại, role danh hiệu cũng không đặt được làm các role đó.

Điều kiện chung cho cả hai cách:

1. **Role của bot vẫn phải nằm trên mọi role danh hiệu** (kéo trong Server Settings → Roles). Discord chỉ cho bot gán, đổi tên role nằm dưới role cao nhất của bot. Không cần và không nên đặt role của bot cao hơn mức đó (ví dụ trên role quản lý).
2. Role danh hiệu **không được có** quyền quản trị/kiểm duyệt: Administrator, Manage Server, Manage Roles, Manage Channels, Manage Webhooks, Manage Expressions, Manage Events, Manage Threads, Manage Messages, Manage Nicknames, Kick/Ban/Timeout Members, Mention Everyone, View Audit Log, Move/Mute/Deafen Members, Pin Messages, Bypass Slowmode, View Server Insights. Điều này áp dụng cả ở **phân quyền riêng của từng kênh** (permission overwrite): role được cho phép một trong các quyền trên ở bất kỳ kênh hay category nào cũng bị từ chối. Bot kiểm tra lại mỗi lần định gán hoặc đổi tên role, nên cấp thêm quyền nguy hiểm sau này thì bot ngừng dùng role đó.
3. Người gán role, tạo hoặc đồng bộ role phải tự làm được việc đó theo luật của Discord: có quyền **Manage Roles** và role danh hiệu nằm dưới role cao nhất của mình (chủ server luôn được). Người chỉ có role admin bot mà không có Manage Roles thì không gán, tạo hay đồng bộ role được.
4. Kiểm tra bằng `/config tier list` hoặc `/config view`.

Lưu ý:
- Bot không đọc danh sách thành viên (không dùng Server Members Intent), nên role chỉ được cập nhật khi thành viên **nhắn tin được XP**, hoặc khi admin dùng `/admin xp give/remove/reset` cho người đó. Sau `/admin xp reset-all`, role của từng người tự cập nhật khi họ nhắn tin.
- Thêm hoặc bỏ role cho một người mà Discord báo lỗi (ví dụ thiếu quyền) thì bot ghi cảnh báo vào log và **chờ 10 phút** mới thử lại với đúng người và role đó. Sửa quyền xong mà role chưa đổi ngay là bình thường.
- Bỏ gán hoặc đổi role của một bậc thì bot không tự gỡ role cũ khỏi những người đang có và không xoá role đó khỏi server; gỡ thủ công hoặc xoá role cũ nếu cần.

### 7.2. Bảng vàng

Bảng vàng là một message bảng xếp hạng dạng ảnh bot giữ trong một kênh và tự cập nhật định kỳ.

1. Tạo kênh riêng (ví dụ `#bang-vang`), nên để thành viên chỉ đọc: chặn Send Messages của @everyone, cho phép bot **View Channel, Send Messages, Attach Files** ở kênh đó, và cho phép người sẽ chạy `/config board` (ví dụ role quản lý) gửi tin ở kênh đó.
2. Bật: `/config board kenh:#bang-vang`. Bot kiểm tra quyền, đăng bảng ngay và xoá message bảng cũ nếu trước đó đặt ở kênh khác. Người chạy lệnh cũng phải **xem được và gửi được tin** ở kênh đó; bot từ chối nếu không.
3. Tắt: `/config board tat:True` (bot xoá message bảng). Message bảng lỡ bị xoá tay: chạy lại lệnh bật với cùng kênh để bot đăng lại.

## 8. Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp |
| --- | --- |
| `Thiếu biến môi trường DISCORD_TOKEN` | `.env` thiếu, sai chỗ, hoặc service không đọc được (kiểm tra `EnvironmentFile`, quyền file) |
| `TokenInvalid` | Token sai hoặc đã bị reset |
| `Used disallowed intents` | Chưa bật Message Content Intent trên Developer Portal |
| Không thấy slash command | Sai `DISCORD_GUILD_IDS`, hoặc bot được mời thiếu scope `applications.commands` |
| Role admin bot không thấy `/admin` | Chưa cho phép role đó trong Server Settings → Integrations (mục 7.4) |
| Không cộng XP | Channel đang tắt XP (`/config channel list`), tin quá ngắn/trùng, đang cooldown, hoặc bot không xem được channel |
| Không gửi được thông báo lên level | Bot thiếu quyền Send Messages ở channel đó (bot bỏ qua và không báo lỗi) |
| Message vote hoặc contribution cũ không cập nhật | Message nằm trong thread đã archive hoặc đã bị xoá; Discord không cho sửa. Dữ liệu vẫn đúng (xem bằng `/poll results`, `/contribution view`) |
| Ảnh `/rank`, `/leaderboard` hoặc Bảng vàng không hiện | Bot thiếu quyền **Attach Files** ở kênh đó (mục 2.4); kiểm tra cả quyền riêng của kênh |
| `/config board` báo thiếu quyền | "Bot thiếu quyền": cấp cho bot View Channel, Send Messages, Attach Files ở kênh Bảng vàng. "Bạn không có quyền": người chạy lệnh phải xem được và gửi được tin ở kênh đó (mục 7.2) |
| Bảng vàng không còn message hoặc không cập nhật | Message bị xoá tay hoặc bot mất quyền ở kênh; cấp lại quyền rồi chạy lại `/config board kenh:<kênh>` |
| Ảnh có chữ cái thay cho avatar | Server không tải được avatar từ `cdn.discordapp.com` (firewall, mạng chậm); ảnh vẫn dùng được |
| Role danh hiệu không đổi | Bot thiếu **Manage Roles**, hoặc role của bot nằm dưới role danh hiệu (kéo role của bot lên ngay trên), hoặc role danh hiệu đã bị cấp quyền quản trị/kiểm duyệt ở server hay ở phân quyền riêng của một kênh (bot từ chối gán). Role chỉ cập nhật khi thành viên nhắn tin được XP; sau một lần lỗi, bot chờ 10 phút mới thử lại với người đó. Log của bot có cảnh báo kèm ID role |
| Nút tạo/đồng bộ role (hoặc `/config tier setup-roles`) báo bỏ qua một số bậc | Role đã gán của bậc đó nằm trên role của bot, có quyền quản trị/kiểm duyệt, hoặc Discord báo lỗi (ví dụ server đã đủ số role tối đa). Kéo role của bot lên trên, gỡ quyền nguy hiểm hoặc bỏ gán role đó rồi bấm lại (mục 7.1) |
| Tên role không khớp danh hiệu sau khi đổi bộ hoặc đổi tên bậc | Bấm lại nút **tạo/đồng bộ role** trên `/config tier panel` để bot đổi tên và màu role theo bộ đang dùng |
| Đổi tên bậc bị từ chối | Tên quá 32 ký tự, chứa ký tự định dạng hoặc mention (danh sách ở mục 7.1), chứa emoji ở giữa tên, hoặc dùng emoji riêng của server |
| `/config tier set-role` hoặc ô chọn role trên bảng điều khiển từ chối role | Đọc lý do trong phản hồi: @everyone, role do integration quản lý, role đang là role admin bot/role tạo vote/role team, người gán thiếu Manage Roles hoặc role không thấp hơn role cao nhất của người gán, role có quyền nguy hiểm (kể cả ở phân quyền riêng của kênh), hoặc role không thấp hơn role của bot (mục 7.1) |
| `/config admin-role`, `/config poll role-tao-vote` hoặc `/config team add` báo role đang là role danh hiệu | Role danh hiệu do bot tự thêm/gỡ theo level, không dùng được vào việc khác. Chọn role khác, hoặc bỏ gán bằng `/config tier panel` hay `/config tier clear-role` trước |
| Người vote báo không được cộng XP | Đã chạm giới hạn XP từ vote trong ngày (`/config poll gioi-han-xp-ngay`); bot có ghi rõ trong phản hồi riêng |
| Bot không khởi động sau khi quay về bản cũ | Database mới hơn code; dùng lại bản code mới |
