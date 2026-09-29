# Company Discord Bot

Discord bot nội bộ cho gamification và ghi nhận đóng góp, với **hai hệ thống điểm độc lập**:

- **Activity XP**: tin nhắn hợp lệ → XP → Level → bảng xếp hạng (cá nhân và team). Có chống spam/farm: cooldown, bỏ tin quá ngắn hoặc trùng lặp, cấu hình theo từng channel. Mỗi server chọn **chế độ kênh tính XP**: tất cả kênh (trừ kênh đã tắt, mặc định), hoặc chỉ kênh được bật (kênh chưa bật, kể cả kênh tạo mới sau này, không tính XP).
- **Contribution Score**: nhân viên gửi đóng góp (ý tưởng, giải pháp, tài liệu, ...), đồng nghiệp bấm 👍 để ghi nhận → điểm → bảng xếp hạng (cá nhân và team).

Ngoài ra bot có **vote / bầu cử / lấy ý kiến**:
- phiếu ẩn danh;
- được đổi phiếu tới khi vote đóng;
- người tham gia được Activity XP một lần cho mỗi vote, tối đa một mức XP mỗi ngày do admin đặt (mặc định 25, 0 = không giới hạn).

**Gamification** (chỉ để hiển thị, không đổi công thức XP hay level):
- **Bộ danh hiệu chọn được**: 8 bậc theo level (mốc 0/3/6/10/15/20/30/40), mỗi server chọn một trong 5 bộ: Tu tiên (mặc định, Luyện Khí → Độ Kiếp), Rank game (Đồng → Thách Đấu), Kiếm hiệp (Tân Thủ → Võ Lâm Minh Chủ), Cây xanh (Hạt Giống → Đại Thụ Ngàn Năm), Vũ trụ (Thiên Thạch → Vũ Trụ). Mỗi bộ có giọng văn riêng cho thông báo lên level, thông báo lên bậc và chữ trên ảnh thẻ. Admin đổi được tên và emoji từng bậc.
- **Role danh hiệu**: mỗi bậc một Discord Role; bot tự thêm/bỏ để mỗi người giữ đúng role của bậc hiện tại. Bot tạo sẵn role (không có quyền gì, không cho @mention, màu theo bậc, tạo từ bậc 8 xuống bậc 1 để danh sách role đúng thứ tự) và đổi tên/màu role do bot tạo theo bộ đang dùng; role do admin tự gán giữ nguyên tên. Bỏ gán role do bot tạo thì bot xoá luôn role đó. Bot từ chối role có quyền quản trị/kiểm duyệt hoặc ai cũng @mention được (cần quyền Manage Roles).
- **Bảng điều khiển** `/config tier panel`: chọn bộ, chọn role cho từng bậc, đổi tên bậc, tạo/đồng bộ role, khôi phục tên mặc định.
- **Chuỗi ngày hoạt động** (số ngày liên tiếp có tin được XP) và **huy hiệu**.
- **Thẻ rank và bảng xếp hạng dạng ảnh**: bảng tổng, tuần này, tháng này; có nút chuyển loại điểm, phạm vi, kỳ và trang.
- **Bảng vàng**: một message bảng xếp hạng dạng ảnh bot giữ trong kênh do admin chọn và tự cập nhật định kỳ.

**Cấu hình bằng giao diện ngay trong Discord**: `/config panel` mở một bảng riêng cho admin (chỉ người mở thấy), có 6 trang (tổng quan, kênh tính XP, team, XP, vote, Bảng vàng và admin). Admin bấm nút, chọn kênh hay role trong menu, sửa số bằng form, không cần nhớ tên lệnh. Bảng nằm ngay trong Discord, không có link. Các lệnh gõ tay vẫn dùng được.

**Trang web quản trị (tuỳ chọn)**: admin cấu hình bằng trình duyệt trong mạng nội bộ, đăng nhập bằng tài khoản Discord. Xem mục **Trang web quản trị (tuỳ chọn)** bên dưới.

Team được xác định bằng Discord Role. Mọi quản trị thực hiện trong Discord (bảng cấu hình hoặc slash command), hoặc trên trang web quản trị nếu bật, và đều được ghi audit log.

Kiến trúc: **1 process Node.js + 1 file SQLite + Discord**. Trang web quản trị (nếu bật) chạy trong chính process này. Database của bot hoàn toàn độc lập.

## Lệnh cho người dùng

| Lệnh | Chức năng |
| --- | --- |
| `/rank [thanh-vien]` | Ảnh thẻ rank: level, danh hiệu (theo bộ server đang dùng), XP, hạng tổng và tuần; điểm contribution; chuỗi ngày hoạt động, huy hiệu; team |
| `/leaderboard` | Ảnh bảng xếp hạng Activity hoặc Contribution, cá nhân hoặc team, tổng/tuần này/tháng này; nút để chuyển bảng và trang |
| `/contribution submit` | Gửi một đóng góp |
| `/contribution view` · `list` | Xem một đóng góp · danh sách đóng góp gần đây |
| Chuột phải tin nhắn → **Ghi nhận đóng góp** | Biến tin nhắn thành contribution cho tác giả tin nhắn |
| `/poll create` · `close` · `results` · `list` | Tạo vote, đóng vote, xem kết quả, xem vote đang mở. Chỉ admin hoặc role được cấp quyền mới tạo được |
| `/ping` | Kiểm tra bot còn hoạt động |

## Lệnh quản trị

Cần quyền **Manage Server** hoặc role admin do bot cấu hình.

| Lệnh | Chức năng |
| --- | --- |
| `/admin xp view · give · remove · reset · reset-all` | Xem, cộng, trừ, reset XP (role danh hiệu của người đó được cập nhật theo XP mới) |
| `/admin contribution adjust · remove · reset · reset-all` | Điều chỉnh điểm, gỡ contribution, reset |
| `/admin stats` · `audit` · `backup` | Thống kê, nhật ký quản trị, sao lưu ngay |
| `/config panel` | Bảng cấu hình chung (trả lời riêng), 6 trang: tổng quan; kênh tính XP (chế độ, bật/tắt nhiều kênh một lần); team; XP và chống spam; vote và contribution; Bảng vàng và role admin. Có nút mở bảng danh hiệu |
| `/config view · xp · team · admin-role · contribution` | Xem toàn bộ cấu hình; cấu hình XP, cooldown, team, quyền, điểm contribution |
| `/config channel mode · set · reset · list` | Chế độ kênh tính XP (tất cả kênh trừ kênh đã tắt, hoặc chỉ kênh được bật); bật/tắt XP, XP và cooldown riêng của một channel; xoá cấu hình riêng (channel quay về theo chế độ); xem danh sách |
| `/config poll` | XP mặc định khi vote, giới hạn XP từ vote mỗi ngày (`gioi-han-xp-ngay`), role được tạo vote |
| `/config tier panel` | Bảng điều khiển danh hiệu (trả lời riêng): menu chọn bộ, ô chọn role cho 8 bậc, nút đổi tên bậc, tạo/đồng bộ role, khôi phục tên mặc định |
| `/config tier style · rename · reset-names` | Chọn bộ danh hiệu; đổi tên và emoji một bậc; khôi phục tên mặc định của bộ đang dùng |
| `/config tier setup-roles` | Bot tạo role (không có quyền gì) cho bậc chưa có role và đổi tên/màu role do bot tạo theo bộ đang dùng; role do admin tự gán giữ nguyên tên (người thao tác cần Manage Roles) |
| `/config tier set-role · clear-role · list` | Gán, bỏ, xem role Discord của từng bậc (dùng role mới tạo riêng, không cho @mention; người gán cần Manage Roles; bỏ role do bot tạo thì bot xoá role đó) |
| `/config board kenh` · `tat` | Đặt kênh hoặc tắt Bảng vàng |

Reset toàn server (`reset-all`, phải nhập `XAC NHAN` để xác nhận) chỉ đánh dấu huỷ điểm cũ: không xoá dữ liệu, không đổi cấu hình (xem [docs/DEPLOY.md](docs/DEPLOY.md) mục 7.4).

## Trang web quản trị (tuỳ chọn)

Admin cấu hình bot bằng trình duyệt thay cho, hoặc cùng với, lệnh trong Discord (DEC-039). Hướng dẫn bật, dùng và xử lý sự cố: [docs/DEPLOY.md](docs/DEPLOY.md) mục 7.5.

- **Chạy trong chính process của bot**: không có server hay dịch vụ riêng, không cần cài thêm gì. Web tắt khi không đặt `WEB_PORT`.
- **Chỉ dùng trong mạng nội bộ công ty hoặc qua VPN.** Không mở cổng ra Internet.
- **Đăng nhập bằng tài khoản Discord** (scope `identify`: bot chỉ biết bạn là ai), không có mật khẩu riêng. Chỉ người có Manage Server hoặc role admin bot vào được; quyền được kiểm tra lại ở mỗi lần mở trang hay bấm lưu. Phiên đăng nhập 8 giờ, khởi động lại bot thì phải đăng nhập lại.
- **Các trang**: tổng quan; kênh tính XP (toàn bộ kênh cùng lúc, XP và cooldown riêng); team; cài đặt điểm (XP, chống spam, vote, contribution); quyền (role admin bot, role tạo vote); Bảng vàng; danh hiệu (bộ, tên bậc, role theo bậc); nhật ký quản trị.
- Mọi thao tác được kiểm tra như lệnh Discord và ghi audit log với người thao tác là tài khoản Discord đã đăng nhập. Lệnh và bảng trong Discord giữ nguyên.

| Biến môi trường | Bắt buộc khi bật web | Ý nghĩa |
| --- | --- | --- |
| `WEB_PORT` | ✅ (đặt là bật) | Cổng HTTP, 1024–65535, ví dụ `8787`. Bỏ trống thì web tắt |
| `WEB_BASE_URL` | ✅ | Địa chỉ admin mở trong trình duyệt, không có "/" ở cuối, ví dụ `http://192.168.0.206:8787`. Phải đăng ký `<WEB_BASE_URL>/auth/callback` ở Developer Portal → OAuth2 → Redirects |
| `DISCORD_CLIENT_SECRET` | ✅ | Client Secret của Discord Application (OAuth2 → Reset Secret). Bí mật như token |
| `WEB_HOST` | | Địa chỉ lắng nghe (mặc định `0.0.0.0`) |

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
npm run selfcheck       # sau khi build: tự kiểm tra môi trường (Node, cấu hình, thư mục, DB, font, vẽ ảnh), không kết nối Discord; trên server xem docs/DEPLOY.md mục 3.1
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

Bốn biến `WEB_PORT`, `WEB_BASE_URL`, `DISCORD_CLIENT_SECRET`, `WEB_HOST` chỉ dùng cho trang web quản trị (xem mục **Trang web quản trị (tuỳ chọn)** ở trên).

Các con số nghiệp vụ (XP mỗi tin, cooldown, điểm mỗi lượt ghi nhận, XP khi vote, ...) do admin chỉnh trong Discord bằng `/config` (hoặc trên trang web quản trị), không nằm trong file cấu hình.

## Triển khai

Xem [docs/DEPLOY.md](docs/DEPLOY.md): tạo Discord Application (quyền tối thiểu, bật Message Content Intent), cài đặt trên Linux, chạy bằng systemd, sao lưu và khôi phục, cấu hình ban đầu bằng `/config panel`, chế độ kênh tính XP, bắt đầu lại từ đầu (reset điểm, giữ cấu hình), bộ danh hiệu và role danh hiệu, Bảng vàng, trang web quản trị (tuỳ chọn), xử lý sự cố. Checklist chạy thật trên Discord: [docs/TEST-PLAN.md](docs/TEST-PLAN.md).

Quyền của bot: View Channels, Send Messages, Send Messages in Threads, Embed Links, **Attach Files** (ảnh thẻ, Bảng vàng) và **Manage Roles** (gán, tạo, đổi tên và xoá role danh hiệu do bot tạo; role của bot phải nằm trên các role này; muốn thấy màu danh hiệu thì kéo role danh hiệu lên trên role có màu khác, vẫn dưới role của bot). Không dùng Administrator. Font Be Vietnam Pro (SIL OFL 1.1) nằm sẵn trong `assets/fonts/`.

## Tài liệu dự án

- [CLAUDE.md](CLAUDE.md): luật nền tảng của dự án (kiến trúc, coding, security, quy trình).
- [docs/ai/](docs/ai/): bối cảnh, kiến trúc, quyết định kỹ thuật, bài học, đề xuất, trạng thái, roadmap.

## Ghi công

Dự án phát triển từ template mã nguồn mở [discordjs-core-bot](https://github.com/Retr0-01/discordjs-core-bot) (© 2022 Retr0-01, giấy phép MIT, xem [LICENCE.md](LICENCE.md)).
