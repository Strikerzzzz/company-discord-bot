# Checklist chạy thật trên Discord

> Dùng cho lần chạy thật đầu tiên trên server Linux (Phase 11), sau khi cài theo `docs/DEPLOY.md`. Mục 11 kiểm bảng cấu hình `/config panel` và chế độ kênh tính XP (Phase 15, DEC-037), làm sau khi cập nhật lên bản Phase 15. Mục 12 kiểm trang web quản trị (Phase 16, DEC-039), làm sau khi cập nhật lên bản Phase 16 và bật web.
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
  - ít nhất 4 tài khoản: **A** có **Manage Server và Manage Roles**, role cao nhất của A nằm trên role của bot; **B** chỉ có role admin bot; **C** là thành viên thường, có role `Backend`; **D** là thành viên thường chưa nhắn tin lần nào (dùng cho mục 8);
  - cho mục 11: một người tạo được kênh mới (quyền Manage Channels), và A, B cùng online;
  - cho mục 12: một máy tính khác trong mạng công ty (hoặc qua VPN), một điện thoại vào được mạng đó, và quyền sửa `.env` trên server.
- [ ] Trên server chạy lệnh `systemd-run` ở DEPLOY mục 3.1 (selfcheck dưới user và sandbox của service): **không có dòng ❌**, exit code 0. Lần đầu có ⚠️ "Database chưa có" là bình thường; Node khác 24 cũng cho ⚠️.
- [ ] `systemctl start company-discord-bot`, rồi `journalctl -u company-discord-bot -f`: thấy "Bot đã sẵn sàng", không có lỗi, không có SIGSYS.

## 1. Khởi động và lệnh

- [ ] Gõ `/` trong server test: thấy `/rank`, `/leaderboard`, `/contribution`, `/poll`, `/ping`; A thấy thêm `/admin`, `/config`; C **không** thấy `/admin`, `/config`.
- [ ] `/ping` trả lời.
- [ ] Thư mục backup có file `bot-*.db` ngay sau lần khởi động đầu.
- [ ] (Nếu có server thứ hai) mời bot vào server không nằm trong `DISCORD_GUILD_IDS`: server đó **không có lệnh nào** của bot (bot chỉ đăng ký lệnh cho server trong danh sách); nhắn tin ở đó không được XP.

## 2. Cấu hình ban đầu

- [ ] A: `/config team add role:@Backend`, `/config team add role:@Frontend` → `/config team list` có 2 team.
- [ ] A: `/config admin-role them:<role admin bot>`, rồi vào **Server Settings → Integrations → bot** cho phép role đó dùng `/admin`, `/config` → B thấy và dùng được `/admin`, `/config`.
- [ ] `/config view` hiện đủ: chế độ kênh tính XP (mặc định "tất cả kênh (trừ kênh đã tắt)"), XP, vote (giới hạn XP ngày), contribution, admin, team, channel riêng, Bảng vàng, bộ danh hiệu và role.

> Từ bản Phase 15, các bước trên làm được bằng `/config panel` (DEPLOY mục 7); mục 11 kiểm chi tiết bảng này.

## 3. Activity XP

- [ ] C nhắn một câu bình thường ở `#chung` → `/admin xp view` của C có +10 XP. Nhắn câu khác trong vòng 60 giây → không cộng thêm.
- [ ] (Cách tin được XP > 60 giây) C nhắn "ok" → không được XP.
- [ ] (Cách > 60 giây) C nhắn lại đúng một câu đã gửi trong vòng 5 phút trước → không được XP (chống trùng).
- [ ] (Cách > 60 giây mỗi lần) Gửi ảnh không kèm chữ → được XP. Gửi ảnh kèm chữ quá ngắn → không. Gửi ảnh kèm chữ giải thích → được.
- [ ] Nhắn trong thread của `#chung` → tính theo cấu hình của `#chung`.
- [ ] `/config channel set kenh:#chung bat-xp:False` → nhắn ở `#chung` không được XP; bật lại thì được.
- [ ] PROP-030: `/config channel set kenh:#chung xp-moi-tin:20` → `/config channel list` ghi 20 XP/tin; `/config channel set kenh:#chung dung-chung-xp:True` → ghi "dùng giá trị chung", cấu hình bật/tắt XP giữ nguyên; nhập `xp-moi-tin` cùng `dung-chung-xp:True` → bị từ chối; `/admin audit` hiện "dùng giá trị chung" (không phải "không có").
- [ ] DEC-037, chế độ kênh bằng lệnh gõ tay (cách tin được XP > 60 giây mỗi lần thử):
  - `/config channel reset kenh:#chung` để xoá cấu hình riêng của dòng trên;
  - `/config channel mode che-do:Chỉ kênh được bật (kênh mới không tính XP)` → phản hồi báo chế độ mới và cảnh báo chưa bật kênh nào (nếu chưa có kênh nào bật riêng); C nhắn ở `#chung` → không được XP;
  - chạy lại đúng lệnh đó → bot báo server đang dùng chế độ này rồi, `/admin audit` không có dòng mới;
  - `/config channel set kenh:#chung bat-xp:True` → C nhắn ở `#chung` và trong thread của `#chung` → được XP;
  - `/config channel reset kenh:#chung` → nhắn ở `#chung` → không được XP (kênh quay về theo chế độ);
  - `/config channel mode che-do:Tất cả kênh (trừ kênh đã tắt)` → nhắn ở `#chung` → được XP như cũ. `/config channel list` ghi chế độ đang dùng ở cuối danh sách.
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

## 11. Bảng cấu hình `/config panel` và chế độ kênh (Phase 15, DEC-037)

> Bắt đầu khi server đang ở chế độ "tất cả kênh" (mặc định). Mẹo kiểm XP ở đầu file vẫn áp dụng: mỗi lần thử cách tin được XP trước đó hơn 60 giây, xem kết quả bằng `/admin xp view thanh-vien:@C`.
> Sau mỗi thao tác trên bảng, kết quả mong đợi luôn gồm: bảng được thay tại chỗ (không sinh tin nhắn mới) và có một dòng báo kết quả ở đầu bảng.

**Mở bảng và chuyển trang**

- [ ] A gõ `/config panel` → bảng hiện, **chỉ A thấy**, có menu chọn trang; trang **Tổng quan** khớp với `/config view` (có dòng chế độ kênh tính XP).
- [ ] Chọn lần lượt 6 trang: Tổng quan, Kênh, Team, XP, Vote, Bảng vàng và admin → mỗi lần bảng được thay tại chỗ; chữ mờ của menu ghi đúng trang đang xem ("📍 Đang xem: …"). Chọn lại đúng trang đang xem → bảng được làm mới.
- [ ] Mở bảng trên **mobile**: chuyển trang, mở menu chọn kênh và chọn role, mở form "✏️ Sửa số" → hiển thị đủ chữ, không vỡ khung, bấm được mọi nút.
- [ ] Để bảng mở hơn 15 phút rồi bấm → vẫn hoạt động.

**Chế độ kênh và bật/tắt nhiều kênh**

- [ ] Trang **Kênh**, bấm nút "chỉ kênh được bật" → dòng báo kết quả có cảnh báo chưa bật kênh nào (nếu chưa có kênh nào bật riêng); danh sách chuyển sang "kênh đang tính XP". C nhắn ở `#chung` → **không** được XP.
- [ ] Menu "➕ Bật tính XP cho kênh…": chọn cùng lúc `#chung` và `#kenh-rieng` → báo đã bật 2 kênh, danh sách có 2 kênh này. C nhắn ở `#chung` → được XP; nhắn trong thread của `#chung` → được XP (thread theo kênh cha).
- [ ] Menu chọn kênh không liệt kê thread và category; mỗi lần chọn được tối đa 25 kênh.
- [ ] Chọn lại `#chung` ở menu bật → kênh vẫn bật, `/admin audit` không có dòng mới cho `#chung`.
- [ ] Menu "➖ Tắt tính XP cho kênh…": chọn `#chung` → `#chung` biến khỏi danh sách. C nhắn ở `#chung` và trong thread của `#chung` → **không** được XP.
- [ ] Tạo kênh mới `#kenh-moi`, C nhắn ở đó → **không** được XP. Bật `#kenh-moi` trên bảng → C nhắn lại → được XP.
- [ ] `/config channel reset kenh:#kenh-moi` → chọn lại trang Kênh trong menu: `#kenh-moi` không còn trong danh sách; C nhắn ở đó → không được XP.
- [ ] Bấm nút "tất cả kênh" → danh sách chuyển sang "kênh đang tắt XP"; C nhắn ở `#kenh-moi` và `#chung` → được XP.
- [ ] Menu tắt: chọn `#chi-doc` → `#chi-doc` có trong danh sách kênh đang tắt. Chuyển sang "chỉ kênh được bật" rồi về lại "tất cả kênh" → `#chi-doc` **vẫn tắt** (cấu hình riêng thắng chế độ).
- [ ] Ở chế độ "tất cả kênh", trang Kênh có dòng nhắc số kênh **được bật riêng** (ví dụ `#chung`, `#kenh-rieng` đã bật ở trên): các kênh này vẫn tính XP nếu chuyển sang "chỉ kênh được bật".
- [ ] Cuối phần này: server ở chế độ "tất cả kênh", `#chung` tính XP (cần cho các bước sau).

**Team**

- [ ] Trang **Team**, menu "➕ Thêm team…": chọn cùng lúc 2 role chưa là team (ví dụ tạo tạm role `QA`, `Design`) → danh sách có thêm 2 team; `/config team list` khớp.
- [ ] Menu "➖ Bỏ team…": chọn 2 role đó → 2 team biến khỏi danh sách; team `Backend`, `Frontend` giữ nguyên.
- [ ] Menu thêm team: chọn một role danh hiệu (tạo ở mục 8; các bước chặn role danh hiệu bên dưới cần có ít nhất một role như vậy) → bị từ chối kèm lý do; danh sách team không đổi.

**XP**

- [ ] Trang **XP**, bấm "✏️ Sửa số" → form 4 ô điền sẵn giá trị hiện tại. Chỉ đổi ô XP mỗi tin nhắn thành 15, lưu → trang XP hiện 15, ba số còn lại giữ nguyên.
- [ ] Hai admin cùng mở form: A và B cùng bấm "✏️ Sửa số" (cả hai form đang hiện 15 XP). A đổi XP mỗi tin nhắn thành 20 rồi lưu. Sau đó B chỉ đổi cooldown thành 30 rồi lưu → kết quả: XP mỗi tin nhắn **20** (B không đè về 15), cooldown 30.
- [ ] Nhập sai ở ô XP mỗi tin nhắn (cho phép 0 đến 1000): `abc`, `-5`, `1001`, `10 XP` → mỗi lần bị từ chối, thông báo nêu tên ô và khoảng hợp lệ; mở lại trang XP: không số nào đổi.
- [ ] Ô số chỉ nhận chữ số: nhập `1.000` hoặc `2,5` → bị từ chối ("chỉ gồm chữ số"); nhập `1 000` (có khoảng trắng) ở ô cooldown → lưu 1000 giây.
- [ ] Nút bật/tắt thông báo lên level → dòng "Thông báo lên level" trên trang đổi theo; `/config view` khớp.
- [ ] Trả lại mặc định trước khi sang phần tiếp: 10 XP mỗi tin, cooldown 60 giây, thông báo lên level bật.

**Vote**

- [ ] Trang **Vote**, bấm "✏️ Sửa số" → form 3 ô điền sẵn (XP mặc định khi vote, giới hạn XP vote mỗi ngày, điểm mỗi lượt ghi nhận). Đặt giới hạn = 0 → trang ghi "không giới hạn". Nhập số ngoài khoảng → bị từ chối như form XP. Trả giới hạn về 25.
- [ ] Menu role tạo vote: chọn `Backend` → C (có role `Backend`) `/poll create` được. Bỏ chọn → trang ghi "chưa đặt (chỉ admin)"; C `/poll create` → bị từ chối.
- [ ] Bảng cũ: A chọn lại `Backend` ở menu role tạo vote. B chạy `/config poll role-tao-vote:@Frontend`. A bỏ chọn trên bảng của mình (bảng này chưa được vẽ lại, vẫn hiện `Backend`) → bot **không** xoá role, vẽ lại bảng hiện `@Frontend` và báo role vừa bị đổi ở nơi khác.
- [ ] Menu role tạo vote: chọn một role danh hiệu → bị từ chối kèm lý do. Cuối cùng đặt lại role tạo vote như trước khi test.

**Bảng vàng và admin**

- [ ] Menu kênh Bảng vàng: chọn `#bang-vang` → bot đăng bảng ở đó (như mục 5), trang ghi kênh mới. Nút "Tắt Bảng vàng" → message Bảng vàng bị xoá, trang ghi đang tắt.
- [ ] Chọn một kênh bot thiếu Attach Files → báo "Bot thiếu quyền" kèm tên quyền, Bảng vàng không đổi. Người thao tác không gửi được tin ở kênh đã chọn (bot có đủ quyền ở đó) → báo "Bạn không có quyền".
- [ ] Menu role admin bot: điền sẵn role admin bot hiện tại. Bỏ chọn → trang ghi role admin bot chưa đặt. Chọn lại role cũ → trang ghi lại role đó. Chọn một role danh hiệu → bị từ chối, và bảng được vẽ lại: menu hiện lại **role admin cũ** (không giữ role danh hiệu vừa chọn), role admin bot không đổi.
- [ ] Role hoặc kênh đã lưu bị xoá: tạo role tạm, đặt làm role tạo vote trên trang Vote, rồi xoá role đó trong Server Settings → Roles. Mở lại trang Vote → có cảnh báo "Role đã lưu không còn trong server", menu không điền sẵn, bảng vẫn dùng được. Đặt lại role tạo vote như cũ. (Tương tự với kênh Bảng vàng: trang Bảng vàng báo "Bot không còn thấy kênh này".)
- [ ] Người không còn là admin bấm bảng cũ: B mở `/config panel`; A đổi role admin bot sang role khác mà B không có; B bấm nút hoặc chọn menu bất kỳ trên bảng đang mở → bị từ chối ("Bạn không có quyền dùng lệnh này"), không có gì thay đổi. A đặt lại role admin bot như cũ.
- [ ] Nút "🏅 Mở bảng danh hiệu" → bảng danh hiệu (như mục 8) mở trong một **tin nhắn riêng mới**; bảng cấu hình vẫn còn và dùng tiếp được.

**Audit log và lệnh gõ tay**

- [ ] `/admin audit` có đủ các thao tác vừa làm trên bảng, đúng người thực hiện:
  - đổi chế độ: "Cập nhật cấu hình", ghi chế độ kênh mới;
  - bật/tắt kênh: mỗi kênh đổi trạng thái có một dòng "Đặt cấu hình channel";
  - thêm/bỏ team: "Thêm team", "Bỏ team";
  - lưu form: "Cập nhật cấu hình", **chỉ có ô đã sửa** (lần lưu của B chỉ có cooldown);
  - thông báo lên level, role tạo vote, role admin bot: "Cập nhật cấu hình";
  - Bảng vàng: "Đặt kênh Bảng vàng", "Tắt Bảng vàng".
- [ ] Lệnh gõ tay vẫn chạy như cũ và khớp với bảng: đổi bằng `/config xp`, `/config channel mode`, `/config team add` rồi mở lại `/config panel` → bảng hiện giá trị mới.

**Chốt khi đưa vào dùng thật (server ezOne)**

- [ ] Chuyển sang "chỉ kênh được bật", xem danh sách "Kênh đang tính XP" trên trang Kênh: tắt các kênh thừa (ví dụ kênh đã bật riêng lúc kiểm thử), bật các kênh cần tính XP, rồi reset điểm theo DEPLOY mục 7.4 (`/admin backup` trước) → `/rank` của mọi người về 0, bảng xếp hạng trống; `/config view` giữ nguyên cấu hình; `/admin audit` có "Reset XP toàn server" và "Reset contribution toàn server".

## 12. Trang web quản trị (Phase 16, DEC-039)

> Làm sau khi cập nhật lên bản Phase 16. Cách bật web, biến `.env` và Developer Portal: DEPLOY mục 7.5. Ví dụ dưới đây dùng `WEB_BASE_URL=http://192.168.0.206:8787`; thay bằng giá trị thật nếu khác.
> Dùng A, B, C như mục 0: A có Manage Server và Manage Roles; B chỉ có role admin bot; C là thành viên thường có role `Backend`.
> Sau mỗi lần bấm lưu trên web, kết quả mong đợi luôn gồm: trang tải lại, có dòng báo kết quả ở đầu trang (xanh là đã lưu, đỏ là bị từ chối và không có gì thay đổi).

**Cấu hình và selfcheck**

- [ ] Chưa đặt `WEB_PORT`: selfcheck (`sudo bash ~/deploy/start.sh`) có dòng ✅ "Trang web quản trị: tắt (không đặt WEB_PORT)."; từ máy khác `curl http://192.168.0.206:8787/healthz` → không kết nối được.
- [ ] Đặt `WEB_PORT=8787` và `WEB_BASE_URL` nhưng để trống `DISCORD_CLIENT_SECRET` → selfcheck có ❌ nêu tên biến `DISCORD_CLIENT_SECRET`, exit code 1, script báo bot **chưa** được bật lại; bot bản đang chạy vẫn chạy và trả lời `/ping`.
- [ ] Lần lượt thử `WEB_PORT=80` và `WEB_BASE_URL=http://192.168.0.206:8787/admin` → mỗi lần có ❌ nêu tên biến sai. Không dòng nào in giá trị Client Secret.
- [ ] Cấu hình đúng theo DEPLOY mục 7.5 → selfcheck có ✅ "Trang web quản trị: bật, lắng nghe 0.0.0.0:8787, địa chỉ http://192.168.0.206:8787; DISCORD_CLIENT_SECRET: có. Redirect cần đăng ký …: http://192.168.0.206:8787/auth/callback". Redirect này có đúng từng ký tự trong Developer Portal → OAuth2 → Redirects.
- [ ] Sau khi script khởi động lại bot: log có "Bot đã sẵn sàng" rồi `Trang web quản trị: http://192.168.0.206:8787 (lắng nghe 0.0.0.0:8787).`; không có "Không mở được trang web quản trị". Đọc qua log: không thấy Client Secret.

**Kết nối và địa chỉ truy cập**

- [ ] Từ một máy khác trong mạng công ty: `curl http://192.168.0.206:8787/healthz` → `ok`. Mở `http://192.168.0.206:8787` trong trình duyệt → trang đăng nhập có nút "Đăng nhập bằng Discord".
- [ ] (Nếu có VPN) từ máy ở ngoài công ty đã bật VPN: như trên. Tắt VPN (hoặc dùng 4G của điện thoại) → không mở được.
- [ ] Mở bằng địa chỉ khác `WEB_BASE_URL` → mã **421**, chữ "Sai địa chỉ truy cập", không có trang đăng nhập:
  - trên server: `curl -i http://127.0.0.1:8787/`;
  - từ máy khác: `curl -i -H "Host: vi-du.local" http://192.168.0.206:8787/` (giả một tên miền lạ trỏ về server);
  - cùng hai cách đó với `/healthz` → vẫn trả `ok`.
- [ ] `curl -i http://192.168.0.206:8787/` → có header `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`.

**Đăng nhập**

- [ ] A bấm "Đăng nhập bằng Discord" → trang của Discord ghi ứng dụng "ezOne Bot" và chỉ xin biết thông tin tài khoản (scope `identify`); bấm cho phép → về trang **Tổng quan** của server. Thanh trên có tên A và nút "Đăng xuất".
- [ ] B (chỉ có role admin bot, không có Manage Server) đăng nhập → vào được như A, dù chưa cho phép gì thêm trong Integrations.
- [ ] C đăng nhập → quay về trang đăng nhập với thông báo "Tài khoản Discord này không có quyền admin bot …". C gõ thẳng `http://192.168.0.206:8787/g/<Server ID>` → về trang đăng nhập.
- [ ] (Nếu có) một tài khoản Discord không ở trong server đăng nhập → bị từ chối như C.
- [ ] Bấm "Đăng nhập bằng Discord" rồi bấm **Huỷ** trên trang của Discord → về trang đăng nhập với "Bạn đã huỷ đăng nhập trên Discord."; không vào được trang quản trị.
- [ ] Sau một lần đăng nhập thành công, chép URL `/auth/callback?…` trong lịch sử trình duyệt, mở lại → "Lượt đăng nhập đã hết hạn hoặc không hợp lệ", không có phiên mới.
- [ ] Log có `Đăng nhập web: người dùng "<ID của A>".` và `Đăng nhập web bị từ chối: …` cho C.

**Mất quyền giữa chừng**

- [ ] B đăng nhập và mở trang **Cài đặt điểm**. A gỡ role admin bot khỏi B (hoặc đổi role admin bot sang role mà B không có). B bấm lưu form đang mở → "Không có quyền", không có gì thay đổi (kiểm bằng `/config view`). B tải lại trang → vẫn "Không có quyền".
- [ ] A trả lại quyền cho B → B tải lại trang là vào được, không cần đăng nhập lại.

**Từng trang** (A làm; sau mỗi lần lưu so với Discord)

- [ ] **Tổng quan**: khớp với `/config view` (chế độ kênh tính XP, XP, vote, contribution, role admin, team, kênh riêng, Bảng vàng, bộ danh hiệu).
- [ ] **Kênh tính XP**:
  - hiện toàn bộ kênh của server trên một trang, kể cả khi server có hơn 25 kênh;
  - đổi chế độ kênh → `/config channel list` ghi chế độ mới ở cuối danh sách;
  - tick bật `#chung`, bỏ tick `#chi-doc`, lưu → `/config channel list` và trang **Kênh** của `/config panel` khớp; C nhắn ở `#chung` (theo mẹo kiểm XP đầu file) → được XP;
  - đặt XP riêng 20 và cooldown riêng 30 cho `#chung` → `/config channel list` ghi đúng; đưa về giá trị chung → ghi "dùng giá trị chung";
  - lưu mà không đổi gì → `/admin audit` không có dòng mới.
- [ ] **Team**:
  - thêm 2 role chưa là team (ví dụ tạo tạm `QA`, `Design`) → `/config team list` khớp; bỏ 2 team đó → khớp;
  - thêm một role danh hiệu làm team → bị từ chối kèm lý do;
  - tạo role tạm, thêm làm team, rồi xoá role đó trong Server Settings → Roles → trang Team có mục team mà role đã bị xoá; gỡ ở đó → `/config team list` không còn team này.
- [ ] **Cài đặt điểm**:
  - đổi XP mỗi tin thành 15 → `/config view` và trang XP của `/config panel` hiện 15, các số khác giữ nguyên;
  - nhập `abc`, `-5`, `1001` vào ô XP mỗi tin → mỗi lần bị từ chối, thông báo nêu tên ô và khoảng hợp lệ; không số nào đổi;
  - đặt giới hạn XP vote mỗi ngày = 0 → `/config view` ghi "không giới hạn"; đổi điểm mỗi lượt ghi nhận contribution → `/config view` khớp;
  - bật/tắt thông báo lên level → `/config view` khớp;
  - trả lại mặc định: 10 XP mỗi tin, cooldown 60 giây, giới hạn XP vote 25, thông báo lên level bật.
- [ ] **Quyền**:
  - đặt role tạo vote là `Backend` → C `/poll create` được; bỏ → C bị từ chối;
  - chọn một role danh hiệu làm role admin bot hay role tạo vote → bị từ chối, không đổi gì;
  - A đổi role admin bot rồi đặt lại như cũ → `/config view` khớp sau mỗi lần (cẩn thận: B mất quyền trong lúc đổi).
- [ ] **Bảng vàng**:
  - chọn `#bang-vang` → bot đăng bảng ở đó (như mục 5); tắt → message Bảng vàng bị xoá; `/config view` khớp;
  - chọn kênh bot thiếu Attach Files → "Bot thiếu quyền" kèm tên quyền;
  - người thao tác không gửi được tin ở kênh đã chọn → "Bạn không có quyền".
- [ ] **Danh hiệu**:
  - chọn bộ "Rank game" → `/config tier list` và `/config tier panel` khớp;
  - đổi tên bậc 2 → `/config tier panel` hiện tên mới; tên có link hoặc `@everyone` → bị từ chối;
  - A gán role cho một bậc, bấm tạo/đồng bộ role → kết quả như mục 8;
  - B (không có Manage Roles) gán role hay tạo role → bị từ chối.
- [ ] **Nhật ký**: có đủ các thao tác vừa làm, khớp với `/admin audit`.
- [ ] Lệnh gõ tay vẫn như cũ: đổi bằng `/config xp` hoặc `/config team add` rồi tải lại trang web → trang hiện giá trị mới.

**Hai tab cùng lưu**

- [ ] A mở trang **Cài đặt điểm** ở hai tab (hoặc A và B cùng mở), cả hai đang hiện 10 XP mỗi tin. Tab 1 đổi XP mỗi tin thành 20, lưu. Tab 2 (chưa tải lại) chỉ đổi cooldown thành 30, lưu → XP mỗi tin **20** (tab 2 không đè về 10), cooldown 30. `/admin audit`: lần lưu thứ hai chỉ có cooldown.
- [ ] Trang **Kênh tính XP** ở hai tab: tab 1 bật kênh X, lưu. Tab 2 (chưa tải lại, vẫn hiện X tắt) bật kênh Y, lưu → cả X và Y đều bật.
- [ ] Trả lại cấu hình như trước khi test.

**Dữ liệu lạ hiển thị an toàn**

- [ ] Tạo role tạm tên `<b>đậm</b><img src=x>` và thêm làm team (trên web). Mở trang Team, Tổng quan, Nhật ký và dòng báo kết quả → tên role hiện **nguyên văn** (thấy cả dấu `<` `>`), không in đậm, không có ảnh vỡ, không có hộp thoại bật lên.
- [ ] (Tuỳ chọn) Đổi tên hiển thị Discord (display name) của tài khoản B thành `<i>nghiêng</i>`, B đăng nhập lại → thanh trên hiện nguyên văn, không in nghiêng.
- [ ] Bỏ team và xoá role tạm; trả lại tên hiển thị của B.

**Đăng xuất và phiên**

- [ ] Bấm "Đăng xuất" → về trang đăng nhập với "Bạn đã đăng xuất."; bấm Back của trình duyệt rồi tải lại → vẫn về trang đăng nhập.
- [ ] Đăng nhập cùng tài khoản ở hai trình duyệt; đăng xuất ở một → trình duyệt kia vẫn dùng được.
- [ ] Đang đăng nhập, khởi động lại bot (`sudo systemctl restart company-discord-bot`) → tải lại trang: về trang đăng nhập, phải đăng nhập lại. Bấm lưu một form mở từ trước khi khởi động lại → "Phiên đăng nhập đã hết hạn", không có gì thay đổi.
- [ ] Mở một trang ở tab 1; ở tab 2 đăng xuất rồi đăng nhập lại; quay về tab 1 bấm lưu → "Form đã cũ hoặc không hợp lệ", không có gì thay đổi. Tải lại tab 1 → lưu được.
- [ ] (Tuỳ chọn) Để trình duyệt đăng nhập hơn 8 giờ → phải đăng nhập lại.

**Audit ghi đúng người**

- [ ] `/admin audit` và trang **Nhật ký**: mỗi thao tác trên web ghi người thực hiện là đúng tài khoản Discord đã đăng nhập (A hoặc B), không phải bot; nội dung giống khi làm bằng lệnh Discord.

**Điện thoại**

- [ ] Điện thoại trong mạng công ty (Wi-Fi nội bộ hoặc VPN): đăng nhập được (Discord có thể mở app Discord để hỏi cho phép); menu, danh sách kênh và các form hiển thị đủ chữ, không phải kéo ngang cả trang, bấm được mọi nút; đăng xuất được.

**Tắt web**

- [ ] Xoá `WEB_PORT`, chạy `sudo bash ~/deploy/start.sh` → selfcheck ghi "tắt"; từ máy khác `/healthz` không kết nối được; bot vẫn chạy, lệnh Discord bình thường. Bật lại nếu tiếp tục dùng web.

## 13. Web quản trị đủ tính năng và kênh thông báo lên level (Phase 17, DEC-041…043)

> Làm sau khi cập nhật lên bản Phase 17. Dùng A, B, C như mục 0. Chạy thử trên một thành viên thử nghiệm (ví dụ C); xong thì trả lại điểm.
> Nên tạo bản sao lưu trước (trang **Sao lưu**), vì mục này có reset điểm.

**Kênh nhận thông báo lên level (DEC-043)**

- [ ] Trang **Cài đặt điểm**, ô "Kênh nhận thông báo lên level" đang là "Kênh thành viên vừa nhắn (mặc định)". Danh sách chỉ có kênh văn bản và kênh thông báo mà A xem được; không có kênh thoại, danh mục.
- [ ] Chọn `#🤖bot-commands`, lưu → báo "Kênh thông báo lên level: #🤖bot-commands"; `/config view` và trang Tổng quan khớp; `/admin audit` có một dòng đổi cấu hình của A.
- [ ] Cho C lên level (A cộng XP cho C trên trang **Thành viên** cho gần mốc, rồi C nhắn một tin hợp lệ trong một thread công việc) → lời chúc mừng xuất hiện ở `#🤖bot-commands` và ping C; **không** có tin nào trong thread.
- [ ] Tạm bỏ quyền Send Messages của bot ở `#🤖bot-commands`, cho C lên level lần nữa → không có tin ở đâu cả; log có cảnh báo "kênh thông báo … không còn hoặc bot thiếu quyền". Trả lại quyền.
- [ ] Chọn một kênh mà bot không gửi được tin → bị từ chối "Bot thiếu quyền …", không có gì thay đổi.
- [ ] `/config xp bo-kenh-thong-bao:True` → `/config view` ghi "kênh thành viên vừa nhắn". `/config xp kenh-thong-bao:#🤖bot-commands` → đặt lại được. Chọn cả hai option cùng lúc → bị từ chối.

**Thành viên**

- [ ] Trang **Thành viên**: tab "Theo XP" và "Theo contribution" khớp `/leaderboard` kỳ tổng; tên và avatar đúng; phân trang giữ tab.
- [ ] Gõ vài chữ đầu tên C vào ô tìm → có C; dán ID của C (hoặc mention `<@ID>`) → mở thẳng hồ sơ C.
- [ ] Hồ sơ C khớp `/admin xp view thanh-vien:C` (level, tổng XP, hạng, cảnh giới, biến động gần nhất).
- [ ] Cộng 100 XP cho C kèm lý do "test web" → báo "Đã cộng 100 XP cho @C…"; `/admin xp view` khớp; nếu C vượt mốc bậc và bot có Manage Roles thì role danh hiệu của C đổi theo, và thông báo có dòng 🏅. Trừ lại 100 XP → về như cũ.
- [ ] Nhập `1.000`, `2,5`, `0`, `-3` vào ô XP → mỗi lần bị từ chối, điểm không đổi, trang vẫn ở hồ sơ C.
- [ ] Cộng 5 rồi trừ 5 điểm contribution cho C → `/rank thanh-vien:C` khớp. Trừ nhiều hơn điểm hiện có → bị từ chối (điểm không âm).
- [ ] Bấm reset XP mà không tick ô xác nhận → bị từ chối. Tick rồi reset (chỉ làm trên tài khoản thử nghiệm) → C về 0 XP; `/admin audit` có dòng reset do A.
- [ ] Mở hồ sơ bot (dán ID của bot) → báo không thao tác được với bot, không có form. Dán một ID bịa (17–20 chữ số) → "Không tìm thấy tài khoản Discord có ID này".

**Bảng xếp hạng, Thống kê**

- [ ] 12 tổ hợp loại × phạm vi × kỳ của trang **Bảng xếp hạng** khớp `/leaderboard` tương ứng (điểm và thứ tự); bảng team hiện tên role.
- [ ] Trang **Thống kê** khớp `/admin stats`. Kênh riêng tư mà A không xem được hiện "#kênh-riêng-tư".

**Contribution**

- [ ] Trang **Contribution** liệt kê giống `/contribution list`; lọc theo C và "Đã gỡ" hoạt động; phân trang giữ bộ lọc.
- [ ] Mở một contribution thử nghiệm → nội dung khớp `/contribution view`; link mở đúng message trong Discord.
- [ ] Gỡ contribution đó (tick xác nhận) → trang báo đã gỡ; message trong Discord chuyển "Đã bị gỡ", mất nút; điểm của tác giả bị huỷ (`/rank`); `/admin audit` có dòng gỡ do A.
- [ ] Contribution đăng trong kênh A không xem được (nếu có): danh sách và chi tiết không hiện tiêu đề, nội dung, tên kênh.

**Vote**

- [ ] Trang **Vote** có ghi chú "tạo vote bằng /poll create"; tab Đang mở/Đã đóng khớp `/poll list`.
- [ ] B tạo một vote thử bằng `/poll create`, vài người bấm chọn. Trên web, kết quả khớp `/poll results`, không có tên người vote.
- [ ] Đóng vote trên web (tick xác nhận) → message vote trong Discord chuyển sang đã đóng, nút bị vô hiệu; `/poll results` ghi đã đóng.

**Reset điểm, Sao lưu**

- [ ] Trang **Reset điểm**: gõ sai chuỗi (ví dụ `xac nhan`) → bị từ chối, điểm không đổi. (Chỉ làm tiếp khi thật sự muốn reset toàn server, ví dụ đúng đợt bắt đầu tính điểm lại theo DEPLOY mục 7.4.) Gõ `XAC NHAN` → reset; `/leaderboard` trống; `/admin audit` có dòng reset toàn server do A.
- [ ] Trang **Sao lưu**: bấm tạo → báo tên file; file có trong thư mục backup trên server; bấm lại ngay → bị từ chối "Mỗi 10 phút chỉ tạo được một bản" kèm giờ Việt Nam (không phải chuỗi `<t:…>`). Trang không có link tải file.

**Quyền và an toàn**

- [ ] C gõ thẳng `http://192.168.0.206:8787/g/<Server ID>/members` → không vào được.
- [ ] Tên hoặc tiêu đề có `<b>` (contribution thử, câu hỏi vote thử) hiện nguyên văn ở danh sách, chi tiết và dòng báo kết quả.

## 14. Phase 18: chọn tất cả, nhiều role quyền, bộ Mobile Legends, bộ cá nhân, nút ❓ (DEC-044…047)

> Làm sau khi cập nhật lên bản Phase 18 (có migration 7 và 8: sao lưu bằng `/admin backup` trước khi cài).

**Chọn tất cả**

- [ ] Trang **Team** và **Kênh tính XP**: bấm "✅ Chọn tất cả" → mọi ô tick sẵn, có dòng "chưa lưu"; tải lại trang không bấm Lưu → không có gì thay đổi. Bấm Lưu → lưu đúng.
- [ ] Trang **Quyền**: bảng role tạo vote có "Chọn tất cả"; bảng role admin **không** có.

**Nhiều role quyền**

- [ ] Sau khi cài: role admin bot và role tạo vote đang đặt từ trước vẫn còn (migration 7 chép sang).
- [ ] Trang **Quyền**: tick thêm một role admin mà không tick ô xác nhận → bị từ chối, không đổi gì; tick ô xác nhận → lưu; người có role đó vào được web.
- [ ] `/config admin-role them:@X`, `bo:@X`, `bo-het:True` hoạt động; `bo-het` đi cùng option khác → bị từ chối.
- [ ] `/config poll role-tao-vote:@Backend` rồi `role-tao-vote:@Frontend` → cả hai role tạo được vote; `bo-role-tao-vote:@Backend` → chỉ còn Frontend.
- [ ] `/config panel`: menu role admin và role tạo vote chọn được nhiều role; A và B cùng mở bảng, B đổi trước → bảng của A báo đã có người đổi, không ghi đè.

**Bộ Mobile Legends**

- [ ] Trang **Danh hiệu** chọn bộ "Mobile Legends" → `/rank` hiện nhãn bậc đúng màu (Đấu Sĩ nâu đồng … Vinh Quang tím viền đỏ), `/leaderboard` và Bảng vàng vẽ theo bộ mới; role danh hiệu đổi tên theo bộ (nút tạo/đồng bộ role).

**Bộ danh hiệu cá nhân**

- [ ] C chạy `/rank-style bo:Cây xanh` → `/rank` của C (ai xem cũng vậy) theo bộ Cây xanh; lời chúc lên level của C theo giọng Cây xanh; role danh hiệu của C và `/leaderboard` vẫn theo bộ của server.
- [ ] Trang **Danh hiệu**: thống kê có 1 người chọn Cây xanh. Tắt công tắc "cho phép tự chọn" → `/rank` của C về bộ server; C `/rank-style bo:Kiếm hiệp` → bị từ chối; bật lại → C lại hiện Cây xanh.
- [ ] Hồ sơ C trên trang **Thành viên**: dòng "Bộ hiển thị: Cây xanh (tự chọn)"; bấm xoá lựa chọn → về theo server; `/admin audit` có dòng do A.

**Nút ❓**

- [ ] `/rank` → nút ❓ ở góc trên bên phải; ảnh thẻ hiện đầy đủ; người khác bấm ❓ → nhận lời giải thích riêng (không ai khác thấy), không ping ai.
- [ ] Lời giải thích đúng với cấu hình hiện tại (XP mỗi tin, cooldown, chế độ kênh, XP vote, điểm mỗi lượt ghi nhận) và bộ hiển thị của người bấm; đổi XP mỗi tin trên web rồi bấm ❓ lại → số mới.

## 15. Retro sprint (Phase 19, DEC-049)

> Làm sau khi cài bản Phase 19 (migration 9: sao lưu trước). Dùng một thread thử của một team; A là admin, C là thành viên có role team, D là thành viên không có role team.

- [ ] A gõ `/retro create ten:"Sprint thử" team:@Backend han-gio:1` trong thread → tin có nút 📝 Điền retro, "Đã điền 0 người".
- [ ] C bấm nút → form 5 ô; điền, gửi → "Đã lưu (ẩn danh)", tin gốc thành "Đã điền 1 người"; C được +20 XP (`/rank`). C bấm lại → form điền sẵn câu cũ; sửa → không cộng XP lần hai.
- [ ] Tên sprint chỉ toàn số (ví dụ `24`) → bị từ chối. D bấm nút → bị từ chối (không thuộc team).
- [ ] `/retro status`: A thấy tên người đã điền; một người quản lý retro không phải admin chỉ thấy số người.
- [ ] `/retro close` → nút bị tắt, bảng tổng hợp ẩn danh (không có tên) hiện trong thread.
- [ ] Trang web **Retro**: phiên vừa đóng có danh sách người đã điền (tên), nội dung 5 cột không có tên; xoá một ý (tick xác nhận) → biến mất; phần "xuất chữ" có bảng dán được.
- [ ] (Khi server vào được Confluence và đã chạy `enable-confluence.sh`) phiên có link trang: đóng phiên → cuối trang có khu vực "🤖 Retro từ Discord" với bảng 5 cột ẩn danh; bấm "Ghi lại" → khu vực được thay, không nhân đôi; phần người khác viết không bị đổi.
- [ ] `/retro vote` → vote tên sprint trong thread; vài người bấm chọn; đóng vote (`/poll close` hoặc hết hạn) → bot công bố tên thắng (không nêu người đề xuất), người đề xuất được +100 XP, Confluence có dòng "🏆 Tên sprint được chọn".
- [ ] Hoà: `/retro pick` chọn tên → như trên. Chỉ có một tên đề xuất: `/retro vote` báo dùng `pick`.
- [ ] Web **Retro → Cài đặt**: đổi XP điền retro, XP người đề xuất, thời hạn vote, thêm role quản lý retro → có hiệu lực ở phiên tiếp theo; `/admin audit` ghi đúng người.
- [ ] Web: xoá nội dung phiên (tick + gõ XOA) → nội dung mất, danh sách người đã điền và XP vẫn giữ.

## 16. Contribution có kênh riêng, duyệt, 👎, XP người bấm (Phase 20, DEC-051)

> Làm sau khi cài bản Phase 20 (migration 10: sao lưu trước). A là admin, R là thành viên có role duyệt contribution, C và D là thành viên thường.

- [ ] Trước khi chọn kênh: C gõ `/contribution submit` → bot báo admin chưa chọn kênh contribution.
- [ ] Web **Cài đặt điểm**: A chọn kênh contribution (kênh PM đã tạo) → lưu được. Chọn một kênh bot thiếu quyền → báo thiếu quyền, không lưu. Đặt XP cho người bấm 5, giới hạn ngày 25.
- [ ] Web **Quyền**: thêm role duyệt contribution cho R → `/config view` hiện role đó.
- [ ] C gõ `/contribution submit` ở một kênh bất kỳ → C nhận trả lời riêng kèm link; thẻ "⏳ Chờ duyệt" hiện ở kênh contribution, có nút ✅ Duyệt và ❌ Từ chối. D bấm Duyệt → bị từ chối (không có quyền).
- [ ] C chuột phải tin của D trong một kênh riêng tư → "Ghi nhận đóng góp" → thẻ ở kênh contribution không nêu tên kênh riêng tư.
- [ ] R bấm ❌ Từ chối một bài → form lý do; gửi → thẻ đổi thành "Không được duyệt" (không hiện lý do); tác giả nhận tin nhắn riêng kèm lý do. Gửi lại bài mới từ cùng tin nhắn nguồn → được.
- [ ] R bấm ✅ Duyệt bài của C → thẻ có nút 👍 Ghi nhận và 👎 Không ghi nhận; C nhận đúng một tin nhắn riêng. R duyệt được cả bài của chính R.
- [ ] D bấm 👍 → +5 XP (`/rank`), bài +1 điểm (theo "Điểm mỗi lượt ghi nhận"). D bấm 👎 → form lý do; gửi → đổi sang 👎, không cộng thêm XP; điểm bài về 0. D bấm 👎 lần nữa → rút, XP 5 bị thu lại.
- [ ] Bài có 1 👍 mà 3 người 👎 → điểm bài là 0, không âm; tổng contribution của tác giả không bị trừ sang bài khác.
- [ ] C (tác giả) bấm 👍/👎 bài của mình → bị từ chối. Tác giả không nhận tin nhắn nào khi có người bấm.
- [ ] Bấm 👍 ở 6 bài trong một ngày với XP 5, giới hạn 25 → bài thứ 6 không được XP, bot báo đã hết hạn mức hôm nay.
- [ ] `/contribution view <id>`: R và A thấy danh sách người bấm 👍/👎 kèm lý do; D chỉ thấy số lượng.
- [ ] Web **Contribution**: lọc "Chờ duyệt"; trang chi tiết duyệt/từ chối được (từ chối bắt buộc lý do), thẻ trong Discord đổi theo; bảng lượt 👍/👎 có tên và lý do; Nhật ký ghi "Duyệt contribution"/"Từ chối contribution" với người thao tác.
- [ ] Xoá tay thẻ của một bài chờ duyệt → web, chi tiết contribution, bấm **Đăng lại thẻ** → thẻ mới hiện ở kênh contribution, bấm duyệt được.
- [ ] Thẻ contribution cũ (trước Phase 20) vẫn bấm 👍 được; lần bấm đầu vẽ lại thẻ có nút 👎.
- [ ] `/config contribution kenh:#... xp-nguoi-bam:5 gioi-han-xp-ngay:25 role-duyet:@R` → kết quả giống web.
