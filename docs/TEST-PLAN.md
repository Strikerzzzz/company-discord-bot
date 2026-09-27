# Checklist chạy thật trên Discord

> Dùng cho lần chạy thật đầu tiên trên server Linux (Phase 11), sau khi cài theo `docs/DEPLOY.md`.
> Mỗi mục ghi thao tác và kết quả mong đợi. Tick `[x]` khi đạt; mục không đạt thì ghi lại hiện tượng, ảnh chụp và dòng log `journalctl` liên quan.
> Các mục này là những gì test tự động không chứng minh được (Discord giả luôn "đúng ý" người viết test, LL-013).
> Làm theo thứ tự: các mục sau dùng cấu hình và dữ liệu tạo ở mục trước.

**Mẹo kiểm XP:** tin bị bỏ qua vì cooldown hay vì chống spam đều không có thông báo gì. Vì vậy mỗi lần thử phải cách tin **được XP** trước đó hơn 60 giây (cooldown mặc định), rồi xem kết quả bằng `/admin xp view thanh-vien:@C` (có lịch sử XP).

## 0. Chuẩn bị

- [ ] Developer Portal: **tắt Public Bot**, **bật Message Content Intent**.
- [ ] Mời bot bằng link có scope `bot applications.commands` và permissions `275146394624` (View Channels, Send Messages, Send Messages in Threads, Embed Links, Attach Files, Manage Roles).
- [ ] Server test có:
  - kênh `#chung` (mọi người chat), `#kenh-rieng` (chỉ một nhóm xem được, C không xem được), `#chi-doc` (thành viên không gửi được tin), `#bang-vang`, một thread trong `#chung`;
  - 2 role team (ví dụ `Backend`, `Frontend`) và 1 role admin bot;
  - ít nhất 4 tài khoản: **A** có **Manage Server và Manage Roles**, role cao nhất của A nằm trên role của bot; **B** chỉ có role admin bot; **C** là thành viên thường, có role `Backend`; **D** là thành viên thường chưa nhắn tin lần nào (dùng cho mục 7).
- [ ] Trên server chạy lệnh `systemd-run` ở DEPLOY mục 3.1 (selfcheck dưới user và sandbox của service): **không có dòng ❌**, exit code 0. Lần đầu có ⚠️ "Database chưa có" là bình thường; Node khác 24 cũng cho ⚠️.
- [ ] `systemctl start company-discord-bot`, rồi `journalctl -u company-discord-bot -f`: thấy "Bot đã sẵn sàng", không có lỗi, không có SIGSYS.

## 1. Khởi động và lệnh

- [ ] Gõ `/` trong server test: thấy `/rank`, `/leaderboard`, `/contribution`, `/poll`, `/ping`; A thấy thêm `/admin`, `/config`; C **không** thấy `/admin`, `/config`.
- [ ] `/ping` trả lời.
- [ ] Thư mục backup có file `bot-*.db` ngay sau lần khởi động đầu.
- [ ] (Nếu có server thứ hai) mời bot vào server không nằm trong `DISCORD_GUILD_IDS`: server đó **không có lệnh nào** của bot (bot chỉ đăng ký lệnh cho server trong danh sách); nhắn tin ở đó không được XP.

## 2. Cấu hình ban đầu

- [ ] A: `/config team add role:@Backend`, `/config team add role:@Frontend` → `/config team list` có 2 team.
- [ ] A: `/config admin-role role:<role admin bot>`, rồi vào **Server Settings → Integrations → bot** cho phép role đó dùng `/admin`, `/config` → B thấy và dùng được `/admin`, `/config`.
- [ ] `/config view` hiện đủ: XP, vote (giới hạn XP ngày), contribution, admin, team, channel riêng, Bảng vàng, bộ danh hiệu và role.

## 3. Activity XP

- [ ] C nhắn một câu bình thường ở `#chung` → `/admin xp view` của C có +10 XP. Nhắn câu khác trong vòng 60 giây → không cộng thêm.
- [ ] (Cách tin được XP > 60 giây) C nhắn "ok" → không được XP.
- [ ] (Cách > 60 giây) C nhắn lại đúng một câu đã gửi trong vòng 5 phút trước → không được XP (chống trùng).
- [ ] (Cách > 60 giây mỗi lần) Gửi ảnh không kèm chữ → được XP. Gửi ảnh kèm chữ quá ngắn → không. Gửi ảnh kèm chữ giải thích → được.
- [ ] Nhắn trong thread của `#chung` → tính theo cấu hình của `#chung`.
- [ ] `/config channel set kenh:#chung bat-xp:False` → nhắn ở `#chung` không được XP; bật lại thì được.
- [ ] PROP-030: `/config channel set kenh:#chung xp-moi-tin:20` → `/config channel list` ghi 20 XP/tin; `/config channel set kenh:#chung dung-chung-xp:True` → ghi "dùng giá trị chung", cấu hình bật/tắt XP giữ nguyên; nhập `xp-moi-tin` cùng `dung-chung-xp:True` → bị từ chối; `/admin audit` hiện "dùng giá trị chung" (không phải "không có").
- [ ] **Thông báo lên level** chỉ phát khi thành viên nhắn tin được XP (không phát khi admin cộng XP): `/admin xp view` xem C còn bao nhiêu XP tới level kế; `/admin xp give` cộng tới **gần** mốc; C nhắn một tin hợp lệ (sau cooldown) → thông báo lên level đăng ở kênh, **chỉ ping C**.
- [ ] Thông báo lên bậc: đưa C tới gần Level 3 (Level 3 cần tổng 475 XP) rồi nhắn một tin hợp lệ → thông báo lên bậc theo giọng văn của bộ đang dùng.
- [ ] Thông báo lên level khi nhắn trong thread (thread chưa archive) gửi được.

## 4. `/rank` và `/leaderboard` (ảnh)

- [ ] `/rank` → ảnh thẻ hiện đúng: avatar, tên tiếng Việt có dấu, bậc, level, thanh tiến độ, hạng, XP tuần, contribution, chuỗi ngày, huy hiệu; kèm phần chữ tóm tắt.
- [ ] `/rank thanh-vien:@người-đã-rời-server` → vẫn hiện tên và avatar.
- [ ] Gõ `/rank` ở `#chi-doc` (C không gửi được tin) → bot trả lời **riêng** (chỉ C thấy).
- [ ] Tạm bỏ Attach Files của bot ở một kênh → `/rank`, `/leaderboard` ở kênh đó trả lời riêng.
- [ ] `/leaderboard` → ảnh bảng xếp hạng kèm 3 hàng nút. Bấm Activity/Contribution, Cá nhân/Team, Tổng/Tuần/Tháng, ◀ ▶ → ảnh **được thay** (không chồng ảnh cũ). Bảng team có 2 team đã thêm ở mục 2.
- [ ] Bảng Contribution, bảng team và bảng trống cũng trang trí theo bộ danh hiệu đang dùng.
- [ ] Người khác bấm nút trên bảng của A → người đó nhận **bảng riêng**, bảng của A không đổi.
- [ ] "📍 Hạng của tôi" → nhảy tới trang có mình, dòng của mình được tô nổi bật.
- [ ] Bấm nút liên tục → sau vài lần nhận "Bạn thao tác nhanh quá…".
- [ ] Emoji ◀ ▶ 📍 ⚡ trên nút hiển thị ổn trên desktop và mobile.

## 5. Bảng vàng

- [ ] `/config board kenh:#bang-vang` → bot đăng ngay 3 ảnh (Activity tuần, Contribution tháng, team tuần).
- [ ] Đổi sang kênh khác → message ở kênh cũ bị xoá, kênh mới có bảng.
- [ ] Có XP mới → trong khoảng 10 phút, ảnh được sửa (không đăng message mới).
- [ ] Xoá tay message Bảng vàng → chậm nhất khoảng 70 phút sau bot đăng lại (kiểm lại mỗi giờ, quét mỗi 10 phút).
- [ ] `/config board tat:True` → bot xoá message.
- [ ] Kênh bot thiếu Attach Files → `/config board` báo lỗi rõ quyền thiếu.

## 6. Contribution

- [ ] `/contribution submit` → bài đăng công khai có nút 👍.
- [ ] Chuột phải một tin nhắn của C → Apps → "Ghi nhận đóng góp" → có contribution với tiêu đề "Đóng góp từ tin nhắn trong #kênh", **không chép nội dung tin**.
- [ ] Ghi nhận lại đúng tin nhắn đó → bị từ chối (một tin chỉ ghi nhận một lần).
- [ ] C bấm 👍 bài của chính C → bị từ chối. A bấm 👍 → điểm của C tăng; bấm lại → rút.
- [ ] A ghi nhận C; `/admin contribution adjust thanh-vien:@C diem:-1` trừ điểm C về 0; A rút ghi nhận → điểm C vẫn là 0 (không âm), A nhận thông báo không ghi nhận lại được; A bấm lại → bị từ chối.
- [ ] Contribution tạo ở `#kenh-rieng`: C dùng `/contribution view` với mã của nó → "không tìm thấy"; `/contribution list` của C không có contribution đó.
- [ ] `/admin contribution remove id:<mã>` → bài đăng gốc chuyển sang "Đã bị gỡ".

## 7. Vote

- [ ] A `/poll create` (có thời hạn ngắn, ví dụ 2 phút) → bài vote có nút.
- [ ] C bấm chọn → nhận phản hồi riêng "+5 XP"; đổi phiếu → không cộng thêm XP.
- [ ] Tạo nhiều vote có XP để C vượt 25 XP/ngày → phản hồi báo đã chạm giới hạn.
- [ ] Hết hạn → vote tự đóng, bài đăng chuyển trạng thái đóng. `/poll results`, `/poll list`, `/poll close` (vote khác) chạy đúng.
- [ ] C (không có quyền tạo vote) `/poll create` → bị từ chối.
- [ ] Vote tạo ở `#kenh-rieng`: C không xem được kết quả qua `/poll results`.

## 8. Bộ danh hiệu và role (DEC-031, DEC-033)

- [ ] A `/config tier panel` → bảng điều khiển hiện đúng (khung, menu chọn bộ, 8 ô chọn role, 4 nút) trên **desktop và mobile**.
- [ ] Chọn bộ "Rank game" → bảng vẽ lại theo bộ mới; `/rank` và thông báo lên bậc dùng giọng văn Rank game.
- [ ] Bấm ✨ Tạo/đồng bộ role → bot tạo 8 role: đúng tên và màu, **không có quyền gì**, bậc 1 nằm dưới cùng, bậc 8 trên cùng, tất cả nằm dưới role của bot. Discord Audit Log có lý do tiếng Việt.
- [ ] Đổi bộ khác rồi bấm ✨ → bot đổi tên và màu các role do bot tạo.
- [ ] Gán một role do admin tự tạo cho một bậc (thay role do bot tạo) → role cũ do bot tạo **không** bị xoá, chỉ có lời nhắc xoá tay. Bấm ✨ → role của admin **giữ nguyên tên**, báo cáo ghi "giữ nguyên".
- [ ] Ô chọn role: chọn role → gán ngay; xoá lựa chọn → bỏ gán (Discord có gửi thao tác xoá). Role do bot tạo bị A bỏ gán thì bị xoá khỏi server.
- [ ] ✏️ Đổi tên bậc 1–4 → form mở được (kể cả trên mobile); đổi tên **bậc 2** (ví dụ "⚪ Silver Pro") → bảng cập nhật. Đưa D lên bậc 2 (give gần Level 3 rồi D nhắn tin) → thông báo dùng câu "vượt mốc Level 3".
- [ ] Nhập tên có link, `@everyone` hoặc ký tự lạ → bị từ chối với lý do rõ ràng.
- [ ] Chọn một role bật "Allow anyone to @mention", role có quyền Manage Messages (kể cả chỉ ở một kênh), role nằm trên role của bot, role team, role admin bot → đều bị từ chối.
- [ ] B (chỉ có role admin bot, không có Manage Roles): mở được bảng, chọn bộ, đổi tên và khôi phục tên được; gán role hoặc bấm ✨ thì bị từ chối; bỏ gán được nhưng role do bot tạo **không** bị xoá.
- [ ] D nhắn tin được XP lần đầu → được gắn role bậc 1; lên bậc 2 → role bậc 1 bị gỡ, gắn role bậc 2.
- [ ] Để bảng điều khiển mở hơn 15 phút rồi bấm → vẫn hoạt động.

## 9. Quản trị

- [ ] `/admin xp give` làm C đổi bậc → phản hồi có thêm dòng "🏅 Role danh hiệu: …".
- [ ] `/admin stats`, `/admin audit` hiện đúng; audit có các thao tác vừa làm.
- [ ] `/admin backup` tạo file `bot-manual-*.db`; chạy lại trong vòng 10 phút → bị từ chối, báo thời điểm thử lại.
- [ ] `/admin xp reset-all xac-nhan:sai` → bị từ chối; không có gì bị reset.

## 10. Vận hành

- [ ] `systemctl restart company-discord-bot` → dữ liệu còn nguyên, bot online lại.
- [ ] `kill -9 <pid>` → systemd tự khởi động lại.
- [ ] Sau 24 giờ: có backup tự động mới; số bản backup tự động không vượt `BACKUP_KEEP` (mặc định 14).
- [ ] Diễn tập khôi phục theo DEPLOY mục 6 trên một bản sao; kiểm tra kênh Bảng vàng và xoá tay message thừa nếu có.
- [ ] `journalctl` không có lỗi lặp lại, không có token trong log.
