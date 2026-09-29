# Checklist chạy thật trên Discord

> Dùng cho lần chạy thật đầu tiên trên server Linux (Phase 11), sau khi cài theo `docs/DEPLOY.md`. Mục 11 kiểm bảng cấu hình `/config panel` và chế độ kênh tính XP (Phase 15, DEC-037), làm sau khi cập nhật lên bản Phase 15.
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
  - cho mục 11: một người tạo được kênh mới (quyền Manage Channels), và A, B cùng online.
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
- [ ] Chọn lần lượt 6 trang: Tổng quan, Kênh, Team, XP, Vote, Bảng vàng và admin → mỗi lần bảng được thay tại chỗ; menu luôn hiện đúng trang đang xem.
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
- [ ] Cuối phần này: server ở chế độ "tất cả kênh", `#chung` tính XP (cần cho các bước sau).

**Team**

- [ ] Trang **Team**, menu "➕ Thêm team…": chọn cùng lúc 2 role chưa là team (ví dụ tạo tạm role `QA`, `Design`) → danh sách có thêm 2 team; `/config team list` khớp.
- [ ] Menu "➖ Bỏ team…": chọn 2 role đó → 2 team biến khỏi danh sách; team `Backend`, `Frontend` giữ nguyên.
- [ ] Menu thêm team: chọn một role danh hiệu (tạo ở mục 8; các bước chặn role danh hiệu bên dưới cần có ít nhất một role như vậy) → bị từ chối kèm lý do; danh sách team không đổi.

**XP**

- [ ] Trang **XP**, bấm "✏️ Sửa số" → form 4 ô điền sẵn giá trị hiện tại. Chỉ đổi ô XP mỗi tin nhắn thành 15, lưu → trang XP hiện 15, ba số còn lại giữ nguyên.
- [ ] Hai admin cùng mở form: A và B cùng bấm "✏️ Sửa số" (cả hai form đang hiện 15 XP). A đổi XP mỗi tin nhắn thành 20 rồi lưu. Sau đó B chỉ đổi cooldown thành 30 rồi lưu → kết quả: XP mỗi tin nhắn **20** (B không đè về 15), cooldown 30.
- [ ] Nhập sai ở ô XP mỗi tin nhắn (cho phép 0 đến 1000): `abc`, `-5`, `1001`, `10 XP` → mỗi lần bị từ chối, thông báo nêu tên ô và khoảng hợp lệ; mở lại trang XP: không số nào đổi.
- [ ] Dấu chấm, dấu phẩy và khoảng trắng được bỏ qua như dấu ngăn cách hàng nghìn: nhập `1.000` ở ô cooldown → lưu 1000 giây.
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
- [ ] Menu role admin bot: điền sẵn role admin bot hiện tại. Bỏ chọn → trang ghi role admin bot chưa đặt. Chọn lại role cũ → trang ghi lại role đó. Chọn một role danh hiệu → bị từ chối.
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

- [ ] Chuyển sang "chỉ kênh được bật", bật các kênh cần tính XP, rồi reset điểm theo DEPLOY mục 7.4 (`/admin backup` trước) → `/rank` của mọi người về 0, bảng xếp hạng trống; `/config view` giữ nguyên cấu hình; `/admin audit` có "Reset XP toàn server" và "Reset contribution toàn server".
