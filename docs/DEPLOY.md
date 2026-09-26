# Triển khai và vận hành

> Dành cho người cài đặt và vận hành bot trên server Linux. Kiến trúc: **1 process Node.js + 1 file SQLite + Discord**. Không cần database server, không mở port nào từ ngoài vào.

## 1. Yêu cầu

| Thành phần | Yêu cầu |
| --- | --- |
| Hệ điều hành | Linux có systemd ≥ 247 (ví dụ Ubuntu Server 24.04 LTS) |
| Node.js | **24 LTS** (tối thiểu 22.14, vì better-sqlite3 cần N-API 10) |
| Mạng ra ngoài | HTTPS/WSS cổng 443 tới `discord.com`, `gateway.discord.gg`; tới `registry.npmjs.org` khi cài đặt |
| Mạng vào | Không cần (trừ SSH để quản trị) |
| Tài nguyên | 1 vCPU, 1–2 GB RAM, ~20 GB ổ đĩa (tính cả bản sao lưu) |

Không cần C++ build tools: better-sqlite3 13 đã kèm sẵn binary, và `.npmrc` tắt install script (LL-008).

## 2. Chuẩn bị Discord Application

1. Vào https://discord.com/developers/applications và tạo Application. Nên có Application **riêng** cho test và cho production.
2. Tab **Installation**: bỏ chọn "User Install" nếu có.
3. Tab **Bot**:
   - **Tắt "Public Bot"**, để chỉ chủ Application mời được bot. Bot chỉ phục vụ các server trong `DISCORD_GUILD_IDS` và bỏ qua server khác, nhưng không nên để người ngoài mời bot.
   - Reset Token rồi lưu vào `.env`. Không gửi token qua chat hay email.
   - **Privileged Gateway Intents**: bật **Message Content Intent** (bắt buộc cho chống spam, DEC-023). Để **tắt** Server Members Intent và Presence Intent.
4. Tab **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`.
   - Bot Permissions: **View Channels, Send Messages, Send Messages in Threads, Embed Links**. Không cấp Administrator hay quyền quản lý nào.
   - Mở URL vừa tạo để mời bot vào server.
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
- không có capability; system call và address family bị giới hạn.

Nếu đổi `DATABASE_PATH` hoặc `BACKUP_DIR` ra ngoài thư mục `data/`, phải sửa `ReadWritePaths` cho khớp.

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
5. `/config poll` để đặt XP mặc định khi vote và role được tạo vote.
6. Kiểm tra lại bằng `/config view`.

Nên tắt quyền **Use Application Commands** của thành viên ở các kênh chỉ đọc (ví dụ #thong-bao). Bot cũng đã tự chặn việc đăng contribution hay vote vào kênh mà người đó không có quyền gửi tin.

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
| Bot không khởi động sau khi quay về bản cũ | Database mới hơn code; dùng lại bản code mới |
