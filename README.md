# Company Discord Bot

Discord bot nội bộ cho gamification và ghi nhận đóng góp, với **hai hệ thống điểm độc lập**:

- **Activity XP**: tin nhắn hợp lệ → XP → Level → bảng xếp hạng (cá nhân và team). Có chống spam/farm: cooldown, bỏ tin quá ngắn hoặc trùng lặp, cấu hình theo từng channel.
- **Contribution Score**: nhân viên gửi đóng góp (ý tưởng, giải pháp, tài liệu, ...), đồng nghiệp bấm 👍 để ghi nhận → điểm → bảng xếp hạng (cá nhân và team).

Ngoài ra bot có **vote / bầu cử / lấy ý kiến**:
- phiếu ẩn danh;
- được đổi phiếu tới khi vote đóng;
- người tham gia được Activity XP một lần cho mỗi vote.

Team được xác định bằng Discord Role. Mọi quản trị thực hiện bằng slash command và được ghi audit log.

Kiến trúc: **1 process Node.js + 1 file SQLite + Discord**. Database của bot hoàn toàn độc lập.

## Lệnh cho người dùng

| Lệnh | Chức năng |
| --- | --- |
| `/rank [thanh-vien]` | Level, XP, hạng; điểm contribution; team |
| `/leaderboard loai [pham-vi] [trang]` | Bảng xếp hạng Activity hoặc Contribution, theo cá nhân hoặc team |
| `/contribution submit` | Gửi một đóng góp |
| `/contribution view` · `list` | Xem một đóng góp · danh sách đóng góp gần đây |
| Chuột phải tin nhắn → **Ghi nhận đóng góp** | Biến tin nhắn thành contribution cho tác giả tin nhắn |
| `/poll create` · `close` · `results` · `list` | Tạo vote, đóng vote, xem kết quả, xem vote đang mở. Chỉ admin hoặc role được cấp quyền mới tạo được |
| `/ping` | Kiểm tra bot còn hoạt động |

## Lệnh quản trị

Cần quyền **Manage Server** hoặc role admin do bot cấu hình.

| Lệnh | Chức năng |
| --- | --- |
| `/admin xp view · give · remove · reset · reset-all` | Xem, cộng, trừ, reset XP |
| `/admin contribution adjust · remove · reset · reset-all` | Điều chỉnh điểm, gỡ contribution, reset |
| `/admin stats` · `audit` · `backup` | Thống kê, nhật ký quản trị, sao lưu ngay |
| `/config view · xp · channel · team · admin-role · poll · contribution` | Cấu hình XP, cooldown, channel, team, quyền |

## Phát triển

Yêu cầu: Node.js ≥ 22.14 (production dùng Node 24 LTS).

```bash
npm ci                  # cài dependency (không chạy install script, xem .npmrc)
cp .env.example .env    # điền DISCORD_TOKEN, DISCORD_GUILD_IDS
npm run dev             # build rồi chạy bot với .env
npm run build           # dọn build/ rồi compile TypeScript
npm run lint            # ESLint (có dùng thông tin type)
npm test                # compile và chạy toàn bộ test (node:test, SQLite trong bộ nhớ)
npm run check           # build + lint + test
```

Chạy một phần test (sau khi `npm test` hoặc `npx tsc -p test` đã compile):

```bash
node --test build-test/test/activity.test.js                              # một file
node --test --test-name-pattern="cooldown" "build-test/test/**/*.test.js"  # theo tên test
```

## Cấu hình

| Biến môi trường | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `DISCORD_TOKEN` | ✅ | Token của bot |
| `DISCORD_GUILD_IDS` | ✅ | ID các server được đăng ký slash command, cách nhau bằng dấu phẩy |
| `DATABASE_PATH` | | File SQLite (mặc định `data/bot.db`) |
| `BACKUP_DIR` | | Thư mục sao lưu (mặc định `data/backups`) |
| `BACKUP_KEEP` | | Số bản sao lưu giữ lại (mặc định 14) |
| `LOG_LEVEL` | | `debug`, `info`, `warn`, `error` (mặc định `info`) |

Các con số nghiệp vụ (XP mỗi tin, cooldown, điểm mỗi lượt ghi nhận, XP khi vote, ...) do admin chỉnh trong Discord bằng `/config`, không nằm trong file cấu hình.

## Triển khai

Xem [docs/DEPLOY.md](docs/DEPLOY.md): tạo Discord Application (quyền tối thiểu, bật Message Content Intent), cài đặt trên Linux, chạy bằng systemd, sao lưu và khôi phục, xử lý sự cố.

## Tài liệu dự án

- [CLAUDE.md](CLAUDE.md): luật nền tảng của dự án (kiến trúc, coding, security, quy trình).
- [docs/ai/](docs/ai/): bối cảnh, kiến trúc, quyết định kỹ thuật, bài học, đề xuất, trạng thái, roadmap.

## Ghi công

Dự án phát triển từ template mã nguồn mở [discordjs-core-bot](https://github.com/Retr0-01/discordjs-core-bot) (© 2022 Retr0-01, giấy phép MIT, xem [LICENCE.md](LICENCE.md)).
