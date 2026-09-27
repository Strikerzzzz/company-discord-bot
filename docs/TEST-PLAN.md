# Checklist chạy thật trên Discord

> Dùng cho lần chạy thật đầu tiên trên server Linux (Phase 11), sau khi cài theo `docs/DEPLOY.md`.
> Mỗi mục ghi thao tác và kết quả mong đợi. Tick `[x]` khi đạt; mục không đạt thì ghi lại hiện tượng, ảnh chụp và dòng log `journalctl` liên quan.
> Các mục này là những gì test tự động không chứng minh được (Discord giả luôn "đúng ý" người viết test, LL-013).

## 0. Chuẩn bị

- [ ] Developer Portal: **tắt Public Bot**, **bật Message Content Intent**.
- [ ] Mời bot bằng link có scope `bot applications.commands` và permissions `275146394624` (View Channels, Send Messages, Send Messages in Threads, Embed Links, Attach Files, Manage Roles).
- [ ] Server test có:
  - kênh `#chung` (mọi người chat), `#kenh-rieng` (chỉ một nhóm xem được), `#chi-doc` (thành viên không gửi được tin), `#bang-vang`, một thread trong `#chung`;
  - 2 role team (ví dụ `Backend`, `Frontend`), 1 role admin bot;
  - ít nhất 3 tài khoản: **A** có Manage Server; **B** chỉ có role admin bot; **C** là thành viên thường.
- [ ] Trên server: `npm run selfcheck` (theo DEPLOY, chạy dưới user và sandbox của service): mọi dòng ✅.
- [ ] `systemctl start company-discord-bot`, rồi `journalctl -u company-discord-bot -f`: thấy "Bot đã sẵn sàng", không có lỗi, không có SIGSYS.

## 1. Khởi động và lệnh

- [ ] Gõ `/` trong server test: thấy `/rank`, `/leaderboard`, `/contribution`, `/poll`, `/ping`; A thấy thêm `/admin`, `/config`; C **không** thấy `/admin`, `/config`.
- [ ] `/ping` trả lời.
- [ ] Thư mục backup có file `bot-*.db` ngay sau lần khởi động đầu.
- [ ] (Nếu có server thứ hai) mời bot vào server không nằm trong `DISCORD_GUILD_IDS`: bot không cộng XP; gõ lệnh thì nhận "Bot không hoạt động ở server này."

## 2. Activity XP và danh hiệu

- [ ] C nhắn một câu bình thường ở `#chung` → `/rank` của C có XP. Nhắn tiếp trong vòng 60 giây → không cộng thêm.
- [ ] Nhắn "ok" hoặc nhắn lại đúng câu cũ → không được XP.
- [ ] Gửi ảnh không kèm chữ → được XP (sau cooldown). Gửi ảnh kèm chữ quá ngắn → không. Gửi ảnh kèm chữ giải thích → được.
- [ ] Nhắn trong thread của `#chung` → tính theo cấu hình của `#chung`.
- [ ] `/config channel set kenh:#chung bat-xp:False` → nhắn ở `#chung` không được XP; bật lại thì được.
- [ ] `/admin xp give` cho C đủ để lên level → thông báo lên level đăng ở kênh, **chỉ ping C**.
- [ ] Cho C vượt mốc bậc (ví dụ lên Level 3) → thông báo lên bậc theo giọng văn của bộ đang dùng.
- [ ] Thông báo lên level trong thread gửi được (thread chưa archive).

## 3. `/rank` và `/leaderboard` (ảnh)

- [ ] `/rank` → ảnh thẻ hiện đúng: avatar, tên tiếng Việt có dấu, bậc, level, thanh tiến độ, hạng, XP tuần, contribution, chuỗi ngày, huy hiệu; kèm phần chữ tóm tắt.
- [ ] `/rank thanh-vien:@người-đã-rời-server` → vẫn hiện tên và avatar.
- [ ] Gõ `/rank` ở `#chi-doc` (C không gửi được tin) → bot trả lời **riêng** (chỉ C thấy).
- [ ] Tạm bỏ Attach Files của bot ở một kênh → `/rank`, `/leaderboard` ở kênh đó trả lời riêng.
- [ ] `/leaderboard` → ảnh bảng xếp hạng kèm 3 hàng nút. Bấm Activity/Contribution, Cá nhân/Team, Tổng/Tuần/Tháng, ◀ ▶ → ảnh **được thay** (không chồng ảnh cũ).
- [ ] Người khác bấm nút trên bảng của A → người đó nhận **bảng riêng**, bảng của A không đổi.
- [ ] "📍 Hạng của tôi" → nhảy tới trang có mình, dòng của mình được tô nổi bật.
- [ ] Bấm nút liên tục → sau vài lần nhận "Bạn thao tác nhanh quá…".
- [ ] Emoji ◀ ▶ 📍 ⚡ trên nút hiển thị ổn trên desktop và mobile.

## 4. Bảng vàng

- [ ] `/config board kenh:#bang-vang` → bot đăng ngay 2–3 ảnh (Activity tuần, Contribution tháng, team tuần nếu có team).
- [ ] Đổi sang kênh khác → message ở kênh cũ bị xoá, kênh mới có bảng.
- [ ] Có XP mới → trong khoảng 10 phút, ảnh được sửa (không đăng message mới).
- [ ] Xoá tay message Bảng vàng → trong khoảng 1 giờ bot đăng lại.
- [ ] `/config board tat:True` → bot xoá message.
- [ ] Kênh bot thiếu Attach Files → `/config board` báo lỗi rõ quyền thiếu.

## 5. Contribution

- [ ] `/contribution submit` → bài đăng công khai có nút 👍.
- [ ] Chuột phải một tin nhắn của C → Apps → "Ghi nhận đóng góp" → có contribution với tiêu đề "Đóng góp từ tin nhắn trong #kênh", **không chép nội dung tin**.
- [ ] Ghi nhận lại đúng tin nhắn đó → bị từ chối (một tin chỉ ghi nhận một lần).
- [ ] C bấm 👍 bài của chính C → bị từ chối. A bấm 👍 → điểm của C tăng; bấm lại → rút.
- [ ] A ghi nhận C; `/admin contribution adjust thanh-vien:@C diem:-1` trừ điểm C về 0; A rút ghi nhận → điểm C vẫn là 0 (không âm), A nhận thông báo không ghi nhận lại được; A bấm lại → bị từ chối.
- [ ] Contribution tạo ở `#kenh-rieng`: C (không xem được kênh đó) dùng `/contribution view` với mã của nó → "không tìm thấy".
- [ ] `/admin contribution remove id:<mã>` → bài đăng gốc chuyển sang "Đã bị gỡ".

## 6. Vote

- [ ] A `/poll create` (có thời hạn ngắn, ví dụ 2 phút) → bài vote có nút.
- [ ] C bấm chọn → nhận phản hồi riêng "+5 XP"; đổi phiếu → không cộng thêm XP.
- [ ] Tạo nhiều vote có XP để C vượt 25 XP/ngày → phản hồi báo đã chạm giới hạn.
- [ ] Hết hạn → vote tự đóng, bài đăng chuyển trạng thái đóng.
- [ ] C (không có quyền tạo vote) `/poll create` → bị từ chối.

## 7. Bộ danh hiệu và role (DEC-031, DEC-033)

- [ ] A `/config tier panel` → bảng điều khiển hiện đúng (khung, menu chọn bộ, 8 ô chọn role, 4 nút) trên **desktop và mobile**.
- [ ] Chọn bộ "Rank game" → bảng vẽ lại theo bộ mới; `/rank` và thông báo lên bậc dùng giọng văn Rank game.
- [ ] Bấm ✨ Tạo/đồng bộ role → bot tạo 8 role: đúng tên và màu, **không có quyền gì**, bậc 1 nằm dưới cùng, bậc 8 trên cùng, tất cả nằm dưới role của bot. Discord Audit Log có lý do tiếng Việt.
- [ ] Đổi bộ khác rồi bấm ✨ → bot đổi tên và màu các role do bot tạo.
- [ ] Gán một role do admin tự tạo cho một bậc rồi bấm ✨ → role đó **giữ nguyên tên**, báo cáo ghi "giữ nguyên".
- [ ] Ô chọn role: chọn role → gán ngay; xoá lựa chọn → bỏ gán (Discord có gửi thao tác xoá). Role do bot tạo bị bỏ gán thì bị xoá khỏi server.
- [ ] ✏️ Đổi tên bậc → form mở được (kể cả trên mobile); đổi "Thách Đấu" thành "🦄 Huyền Thoại" → bảng cập nhật; thông báo lên bậc dùng câu "vượt mốc Level N".
- [ ] Nhập tên có link, `@everyone` hoặc ký tự lạ → bị từ chối với lý do rõ ràng.
- [ ] Chọn một role bật "Allow anyone to @mention", role có quyền Manage Messages (kể cả chỉ ở một kênh), role nằm trên role của bot, role team, role admin bot → đều bị từ chối.
- [ ] B (chỉ có role admin bot, không có Manage Roles): mở được bảng, chọn bộ được; gán role hoặc bấm ✨ thì bị từ chối.
- [ ] C nhắn tin được XP ở bậc 1 → được gắn role bậc 1; lên bậc 2 → role bậc 1 bị gỡ, gắn role bậc 2.
- [ ] Để bảng điều khiển mở hơn 15 phút rồi bấm → vẫn hoạt động.

## 8. Quản trị

- [ ] `/config view` hiện đủ: XP, vote (giới hạn XP ngày), contribution, admin, team, channel riêng, Bảng vàng, bộ danh hiệu và role.
- [ ] `/config admin-role` đặt role admin bot, rồi vào **Server Settings → Integrations → bot** cho phép role đó dùng `/admin`, `/config` → B dùng được `/admin`, `/config`.
- [ ] `/admin xp give` làm C đổi bậc → phản hồi có thêm dòng "🏅 Role danh hiệu: …".
- [ ] `/admin stats`, `/admin audit` hiện đúng; audit có các thao tác vừa làm.
- [ ] `/admin backup` tạo file `bot-manual-*.db`.

## 9. Vận hành

- [ ] `systemctl restart company-discord-bot` → dữ liệu còn nguyên, bot online lại.
- [ ] `kill -9 <pid>` → systemd tự khởi động lại.
- [ ] Sau 24 giờ: có backup tự động mới; số bản giữ đúng `BACKUP_KEEP`.
- [ ] Diễn tập khôi phục theo DEPLOY mục 6 trên một bản sao; kiểm tra kênh Bảng vàng và xoá tay message thừa nếu có.
- [ ] `journalctl` không có lỗi lặp lại, không có token trong log.
