# Triển khai và vận hành

> Dành cho người cài đặt và vận hành bot trên server Linux. Kiến trúc: **1 process Node.js + 1 file SQLite + Discord**. Không cần database server, không mở port nào từ ngoài vào.

## 1. Yêu cầu

| Thành phần | Yêu cầu |
| --- | --- |
| Hệ điều hành | Linux (ví dụ Ubuntu Server 24.04 LTS) |
| Node.js | **24 LTS** (tối thiểu 22.14, vì better-sqlite3 cần N-API 10) |
| Mạng ra ngoài | HTTPS/WSS cổng 443 tới `discord.com`, `gateway.discord.gg`; tới `registry.npmjs.org` khi cài đặt |
| Mạng vào | Không cần (trừ SSH để quản trị) |
| Tài nguyên | 1 vCPU, 1–2 GB RAM, ~20 GB ổ đĩa (tính cả bản sao lưu) |

Không cần C++ build tools: better-sqlite3 13 đã kèm sẵn binary, và `.npmrc` tắt install script (LL-008).

## 2. Chuẩn bị Discord Application

1. Vào https://discord.com/developers/applications và tạo Application. Nên có Application **riêng** cho test và cho production.
2. Tab **Bot**:
   - Reset Token rồi lưu vào `.env` (không gửi token qua chat hay email).
   - **Privileged Gateway Intents**: bật **Message Content Intent** (bắt buộc cho chống spam, DEC-023). Để **tắt** Server Members Intent và Presence Intent.
3. Tab **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`.
   - Bot Permissions: **View Channels, Send Messages, Send Messages in Threads, Embed Links**. Không cấp Administrator hay bất kỳ quyền quản lý nào.
   - Mở URL vừa tạo để mời bot vào server.
4. Lấy Server ID: trong Discord, bật Developer Mode, chuột phải vào server và chọn Copy Server ID.

## 3. Cài đặt lần đầu

```bash
# User riêng để chạy bot, không dùng root
sudo useradd --system --create-home --shell /usr/sbin/nologin discordbot

# Mã nguồn (từ repo nội bộ hoặc bản copy)
sudo mkdir -p /opt/company-discord-bot
sudo chown discordbot:discordbot /opt/company-discord-bot
sudo -u discordbot git clone <repo-nội-bộ> /opt/company-discord-bot   # hoặc copy mã nguồn vào đây
cd /opt/company-discord-bot

# Cài dependency và build
sudo -u discordbot npm ci
sudo -u discordbot npm run build

# Cấu hình
sudo -u discordbot cp .env.example .env
sudo -u discordbot nano .env           # điền DISCORD_TOKEN, DISCORD_GUILD_IDS
sudo chmod 600 .env
sudo -u discordbot mkdir -p data

# Chạy thử ở foreground: thấy "Bot đã sẵn sàng" là được, Ctrl+C để dừng
sudo -u discordbot npm run prod
```

## 4. Chạy như service (systemd)

```bash
sudo cp deploy/company-discord-bot.service /etc/systemd/system/
# Kiểm tra: đường dẫn node (`which node`), WorkingDirectory, User
sudo systemctl daemon-reload
sudo systemctl enable --now company-discord-bot
sudo systemctl status company-discord-bot
journalctl -u company-discord-bot -f     # xem log
```

Unit đã giới hạn quyền: process chỉ được ghi vào `/opt/company-discord-bot/data`. Nếu đổi `DATABASE_PATH` hoặc `BACKUP_DIR` ra ngoài thư mục này, phải sửa `ReadWritePaths` cho khớp.

## 5. Cập nhật phiên bản

```bash
cd /opt/company-discord-bot
sudo -u discordbot git pull
sudo -u discordbot npm ci
sudo -u discordbot npm run build
sudo systemctl restart company-discord-bot
```

- Migration database chạy tự động khi bot khởi động.
- Nếu database mới hơn code (ví dụ lỡ quay về bản cũ), bot từ chối khởi động để tránh hỏng dữ liệu.

## 6. Sao lưu và khôi phục (DEC-017)

**Sao lưu tự động:**
- Mỗi giờ bot kiểm tra một lần; nếu bản gần nhất đã cũ hơn 24 giờ thì tạo bản mới trong `data/backups/`, tên dạng `bot-<thời điểm UTC>.db`.
- Giữ `BACKUP_KEEP` bản mới nhất (mặc định 14).
- Admin có thể sao lưu ngay bằng `/admin backup`.

**Chép bản sao ra khỏi server** (bắt buộc, để chống hỏng máy). Ví dụ cron hằng ngày:

```bash
# /etc/cron.d/company-discord-bot-backup — chép sang nơi lưu nội bộ do IT chỉ định
30 3 * * * discordbot rsync -a /opt/company-discord-bot/data/backups/ <nơi-lưu-nội-bộ>/company-discord-bot/
```

**Khôi phục:**

```bash
sudo systemctl stop company-discord-bot
cd /opt/company-discord-bot/data
sudo -u discordbot mv bot.db bot.db.broken            # giữ lại bản lỗi để điều tra
sudo -u discordbot rm -f bot.db-wal bot.db-shm
sudo -u discordbot cp backups/<bản-cần-khôi-phục>.db bot.db
sudo systemctl start company-discord-bot
```

Nên diễn tập khôi phục một lần trước khi đưa vào dùng chính thức.

## 7. Cấu hình ban đầu trong Discord

Người có quyền **Manage Server** chạy các lệnh sau (mọi thay đổi đều được ghi audit log):

1. `/config team add` cho từng role team (Backend, Frontend, QA, ...).
2. `/config channel set` để tắt XP ở channel bot, announcements, ...
3. `/config xp` nếu muốn chỉnh XP mỗi tin, cooldown, độ dài tối thiểu hoặc khoảng chống trùng.
4. `/config admin-role` nếu muốn một role khác cũng có quyền admin bot.
5. `/config poll` để đặt XP mặc định khi vote và role được tạo vote.
6. Kiểm tra lại bằng `/config view`.

## 8. Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp |
| --- | --- |
| `Thiếu biến môi trường DISCORD_TOKEN` | `.env` thiếu, sai chỗ, hoặc service không đọc được (kiểm tra `EnvironmentFile`, quyền file) |
| `TokenInvalid` | Token sai hoặc đã bị reset |
| `Used disallowed intents` | Chưa bật Message Content Intent trên Developer Portal |
| Không thấy slash command | Sai `DISCORD_GUILD_IDS`, hoặc bot được mời thiếu scope `applications.commands` |
| Không cộng XP | Channel đang tắt XP (`/config channel list`), tin quá ngắn/trùng, đang cooldown, hoặc bot không xem được channel |
| Không gửi được thông báo lên level | Bot thiếu quyền Send Messages ở channel đó |
| Bot không khởi động sau khi quay về bản cũ | Database mới hơn code; dùng lại bản code mới |
