# CURRENT STATE

> Đọc file này đầu tiên ở mỗi phiên. Cập nhật sau mỗi phase hoặc task đáng kể.
> Cập nhật lần cuối: **2026-09-30**

## 1. Phase hiện tại

**Bot đã chạy thật** (Phase 11), từ 2026-09-29 (DEC-036). `main` có đủ Phase 0–16. Không còn branch nào đang dở.

- Server: `192.168.0.206` (Ubuntu 22.04, máy dùng chung), systemd unit `company-discord-bot`, Node 22.23.2. Guild: server Discord **ezOne**; Application "ezOne Bot".
  - Bản đang chạy: **`8da7fe2`** (gồm Phase 15 và 16).
  - Trang web quản trị **đã bật** ở `http://192.168.0.206:8787`, bằng `deploy/enable-web.sh`: `ufw` chỉ mở cổng 8787 cho 10/8, 172.16/12, 192.168/16. Ngày 2026-09-30 đã có lượt đăng nhập admin thành công.
  - `main` mới hơn bản đang chạy chỉ ở script `deploy/enable-web.sh`, tài liệu và test.
- **DEC-041 (2026-09-30):** rule mới, mọi tính năng mới hay cũ đều phải quản lý được trên web. Có `test/web-parity.test.ts` kiểm tra tự động.
- **Phase 17 đã merge vào `main` (DEC-046, `c8359b6`) và đang chạy trên server** từ 2026-09-30 16:01 (migration 6 đã áp dụng). Còn: bot thiếu quyền ở kênh Bảng vàng (`1554360825995726899`), người phụ trách cấp quyền hoặc đổi kênh.
- **Phase 18 (DEC-044, DEC-047) trên branch `phase-18/quick-wins`**, chưa merge:
  - đã gộp:
    - "Chọn tất cả" cho bảng ô tick;
    - nhiều role admin bot và role tạo vote (migration 7, `guild_role_grants`);
    - bộ danh hiệu thứ 6 Mobile Legends, có `textColor`/`borderColor` cho bậc;
    - trang Kênh tính XP hiện mọi kênh cho admin (DEC-045);
  - kết quả: 1049/1050 test pass;
  - bộ danh hiệu cá nhân (migration 8, `/rank-style`) và nút ❓ trên thẻ `/rank` (DEC-047);
  - 3 review độc lập (bảo mật, đúng đắn; riêng phần DEC-047) không có lỗi CAO; đã sửa:
    - bảng role admin không có "Chọn tất cả", thêm role admin phải tick xác nhận;
    - nút ❓ chỉ nêu kênh người bấm xem được;
    - tiêu đề thẻ escape mention;
  - 1094/1095 test pass trên Windows; 1095/1095 trên server Linux (thư mục thử `~/deploy/p18-test`);
  - **chờ người phụ trách duyệt merge vào `main` và cài lên server** (migration 7 và 8: sao lưu trước).
- Chi tiết Phase 17 (giữ để tra cứu):
  - 7 trang web mới: Thành viên, Bảng xếp hạng, Contribution, Vote, Thống kê, Reset điểm, Sao lưu. `test/web-parity.test.ts` không còn mục nào thiếu.
  - Nền móng `src/discord/adminOps.ts`, dùng chung cho `/admin` và web.
  - Kênh nhận thông báo lên level (migration 6), đặt trên web hoặc bằng `/config xp kenh-thong-bao`.
  - Cách làm: nền móng, 3 agent song song, tích hợp. 1018/1019 test pass; test còn lại bỏ qua vì là test quyền thư mục kiểu Linux.
  - Đang chạy 2 review độc lập (bảo mật; tính đúng đắn). Sau đó chờ người phụ trách duyệt merge.
  - Sau khi cài: đặt kênh thông báo lên level là `#🤖bot-commands` (web, trang Cài đặt điểm), rồi kiểm theo `docs/TEST-PLAN.md` mục 13.
- Việc người phụ trách còn làm trên Discord hoặc web:
  - chuyển kênh tính XP sang "chỉ kênh được bật" và tick các kênh được tính;
  - reset điểm bằng `/admin xp reset-all` và `/admin contribution reset-all`;
  - kiểm theo `docs/TEST-PLAN.md`.
- Bot **chưa có quyền Manage Roles**: người mời bot không có quyền này. Role danh hiệu chờ chủ server bật quyền cho role của bot.

Lịch sử Phase 15–16 (giữ để tra cứu):

- **Phase 16 (DEC-039) đã merge vào `main`** (DEC-040): trang web quản trị trong process bot, chỉ mạng nội bộ, đăng nhập bằng Discord. Đã cài lên server ngày 2026-09-29 (bản `8da7fe2`).
  - Nền móng (`bee039e`) đã xong:
    - `src/web/`: server, OAuth2, phiên, CSRF, Host/Origin, CSP, layout;
    - `src/discord/configOps.ts` dùng chung với `/config`;
    - cấu hình `WEB_*`, selfcheck;
    - 857 test pass.
  - 4 agent (tổng quan/kênh/team; cài đặt/quyền/Bảng vàng/nhật ký; danh hiệu; tài liệu) đã gộp.
  - 2 review độc lập (bảo mật; tính đúng đắn):
    - 1 lỗi CAO (trang Danh hiệu xoá nhầm role do bot tạo khi chuyển bậc, LL-022), 2 TRUNG BÌNH (kiểm tra trước khi ghi ở trang Danh hiệu; cookie dùng tên chung trên máy dùng chung) và các lỗi THẤP: đều đã sửa.
    - Quy tắc mới trên web: giấu tên kênh người đăng nhập không xem được; trang kênh ghi đổi chế độ sau cùng; mất quyền admin thì huỷ phiên; cookie `ezbot_*`.
    - Chấp nhận có ghi lại: role admin bot đổi được role admin trên web như lớp quyền 2 (PROP-032 đã bị từ chối; PROP-034 mở rộng cho web).
  - 938 test pass.
  - Bật web trên server (đã làm): biến `WEB_*` và `DISCORD_CLIENT_SECRET` trong `.env`, redirect trên Developer Portal, luật `ufw` cho cổng 8787 chỉ trong mạng nội bộ (trước đó `ufw` chặn 8787). Script: `deploy/enable-web.sh`.
- **Phase 15 (DEC-037) đã merge vào `main`** (DEC-038) và đã cài lên server:
  - `/config panel`: bảng cấu hình 6 trang (PROP-033);
  - chế độ kênh "chỉ kênh được bật" (migration 5, `/config channel mode`).
  - Nền móng và 3 agent (giao diện, handler, tài liệu); 2 review độc lập không có lỗi CAO; góp ý ngoài phạm vi ghi thành PROP-034, 035, 036.
  - Cập nhật server: `git archive` vào `~/deploy/src`, `npm ci && npm run check`, rồi `sudo bash ~/deploy/install.sh` và `sudo bash ~/deploy/start.sh`. Hai script nằm trong `deploy/` của repo.

## 2. Tính năng đã có

| Nhóm | Nội dung |
| --- | --- |
| Activity XP | XP cố định/tin (mặc định 10), cooldown 60s, level 5n²+50n+100, chống tin ngắn/trùng (trong RAM), cấu hình theo channel |
| Bộ danh hiệu | 5 bộ (Tu tiên, Rank game, Kiếm hiệp, Cây xanh, Vũ trụ) × 8 bậc cùng mốc level; admin chọn bộ, đổi tên/emoji từng bậc; thông báo, ảnh thẻ theo giọng văn và trang trí của bộ (DEC-033) |
| Role danh hiệu | Bảng điều khiển `/config tier panel` (menu chọn bộ, 8 ô chọn role, form đổi tên, nút tạo/đồng bộ role) và lệnh `/config tier …`; bot tự tạo role (không quyền), tự thêm/bỏ role khi thành viên nhắn tin được XP. Chặn role nguy hiểm, mentionable, trùng vai trò khác; người gán cần Manage Roles cấp server |
| Chuỗi ngày, huy hiệu | Chuỗi ngày hoạt động (giờ Việt Nam), 15 huy hiệu; chỉ hiển thị, không cộng điểm |
| Contribution | `/contribution submit/view/list`, context menu "Ghi nhận đóng góp", nút 👍; điểm không bao giờ âm (tự bù, PROP-024); rút ghi nhận khi tác giả đang bị phạt thì không ghi nhận lại được (PROP-031) |
| Vote/bầu cử | `/poll create/close/results/list`, ẩn danh, XP một lần; giới hạn XP từ vote mỗi ngày do admin đặt (mặc định 25) |
| `/rank` | Ảnh thẻ tu luyện (avatar, cảnh giới, level, tiến độ, hạng, XP tuần, contribution, chuỗi ngày, huy hiệu) kèm chữ tóm tắt huy hiệu |
| `/leaderboard` | Ảnh bảng xếp hạng; Activity/Contribution × cá nhân/team × tổng/tuần/tháng; nút chuyển bảng, trang, "Hạng của tôi" |
| Bảng vàng | `/config board`: một message 2–3 ảnh bảng xếp hạng, tự cập nhật 10 phút |
| Quản trị | `/admin xp|contribution|stats|audit|backup`; `/config` (XP, channel, team, admin-role, poll, contribution, tier, board) và `/config panel` |
| Web quản trị | `http://<server>:<WEB_PORT>`, đăng nhập Discord, chỉ mạng nội bộ (DEC-039). Phase 16: tổng quan, kênh, team, cài đặt điểm, quyền, Bảng vàng, danh hiệu, nhật ký. Phase 17 (branch, chưa merge): thành viên, bảng xếp hạng, contribution, vote, thống kê, reset điểm, sao lưu. Mọi tính năng phải có trên web (DEC-041) |
| Thông báo lên level | Bật/tắt; kênh nhận thông báo (DEC-043, branch Phase 17): đã chọn thì chỉ gửi vào kênh đó, chưa chọn thì gửi ở kênh vừa nhắn |
| Vận hành | Migration tự động (3 migration), backup hàng ngày, systemd hardening, runbook `docs/DEPLOY.md` |

## 3. Kiểm chứng

Ngày 2026-09-27, trên máy dev (Windows, Node 22.23.2) và **bản copy sạch** (`git archive`):

| Hạng mục | Kết quả |
| --- | --- |
| `npm ci` (bản copy sạch) | OK |
| `npm run check` | OK: build, lint, **725/725 test** trên bản copy sạch (Phase 13, `phase-13/tier-sets`) |
| `npm audit` | 0 lỗ hổng |
| Vẽ ảnh từ `build/` với service thật | OK, kể cả bộ Rank game có tên bậc tuỳ chỉnh (font tiếng Việt đúng) |
| Khởi động từ bản build (token giả, DB mới) | Đủ 4 migration (23 bảng); nạp 7 command, 1 context menu, 3 event và 4 namespace component (`tierui`, `contrib`, `lb`, `poll`); tự backup; Discord từ chối token; token không lọt log |
| Test tích hợp | `test/integration.test.ts`, `test/integration-gamification.test.ts` (qua service thật và hàm vẽ thật) |
| Hiệu năng (200k event) | Bảng tuần ~7 ms, tháng ~28 ms, team tháng ~61 ms; "Hạng của tôi" với 2000 người bằng điểm ~55–75 ms (trước khi sửa ~7 s) |
| Review độc lập (3 agent) | Đúng đắn dữ liệu, Discord API, bảo mật: mọi lỗi kỹ thuật đã xác nhận đều đã sửa (LL-017); quy tắc nghiệp vụ còn lại đã chốt ở DEC-032 |

## 4. Việc tiếp theo

1. **Đã cài và bật** (2026-09-29, DEC-036). Còn:
   - smoke test ảnh (`/rank`, `/leaderboard`) và xem `journalctl` không có lỗi canvas hay SIGSYS;
   - cấu hình ban đầu (DEPLOY mục 7);
   - chủ server bật Manage Roles cho role "ezOne Bot", rồi tạo role danh hiệu.
   - Cập nhật phiên bản: upload `git archive` mới vào `~/deploy/src` của tài khoản quản trị bằng Git Bash (LL-021), chạy `npm ci && npm run check`, rồi `sudo bash ~/deploy/install.sh` và `sudo bash ~/deploy/start.sh`.
2. Những điểm cần kiểm trên Discord thật:
   - context menu (defer → REST lấy member → editReply);
   - thay ảnh khi bấm nút (`files` + `attachments: []`), kể cả message ephemeral; người khác bấm nút thì nhận bảng riêng;
   - `/rank`, `/leaderboard` trả lời riêng khi bot thiếu Attach Files;
   - role cảnh giới: `fetchMe`, thứ bậc role, chặn role có overwrite nguy hiểm, Audit Log của Discord có lý do;
   - Bảng vàng: đăng ngay khi đặt kênh, xoá khi đổi kênh hoặc tắt, tự đăng lại khi message bị xoá;
   - thông báo lên level/đột phá trong thread; quyền xem kênh riêng tư; `/config admin-role` kèm quyền trong Integrations.

## 5. Đang chờ người phụ trách quyết định

- PEND-004: remote git nội bộ. PEND-013: thời gian giữ dữ liệu. (PEND-005 đã giải quyết ở DEC-036.)
- Nơi chép bản sao lưu ra khỏi server (DEPLOY mục 6): cần IT chỉ định.

## 6. Cách làm việc với repo

- Kiểm chứng không làm bẩn repo: `git archive HEAD | tar -x -C <thư-mục-tạm>`, rồi `npm ci && npm run check` trong thư mục đó.
- Máy dev Windows: Bash tool làm mất dấu `\` trong `node -e '...'` **và cả trong heredoc** (LL-016); script có regex phải viết bằng Write/Edit. Working copy dùng LF (PROP-023); font và PNG đánh dấu binary trong `.gitattributes`.
- Worktree của agent nằm ở `.claude/worktrees/` (đã ignore); dọn sau khi merge (LL-012). Agent bị dừng giữa chừng thì kiểm worktree trước khi giao lại (LL-014).

## 7. Nhật ký cập nhật

| Ngày | Thay đổi |
| --- | --- |
| 2026-09-24 | Khởi tạo: audit Phase 0, tạo AI Operating System. Không sửa code. |
| 2026-09-24 | Phase 0 được duyệt. Remote `origin` → `upstream` (push bị vô hiệu hoá). |
| 2026-09-24 | Mở Phase 1 (DEC-014…018). Hoàn thành bước 1–5 cùng `.npmrc`; nâng Node máy dev lên 22.23.2. |
| 2026-09-26 | DEC-019: PROP-022/023; merge Phase 1 vào `main`. |
| 2026-09-26 | DEC-020…027: chốt quy tắc nghiệp vụ. Làm Phase 2–10 bằng 7 agent song song trên nền móng chung; 3 agent review độc lập; 2 agent sửa lỗi. 323 test. |
| 2026-09-26 | DEC-028: merge Phase 2–10 vào `main`; trả lời PEND-015…020. Mở Phase 12 (DEC-029…031). |
| 2026-09-27 | Phase 12: nền móng + 5 agent (2 đợt), 3 agent review độc lập, 2 agent sửa lỗi. 601 test. |
| 2026-09-27 | DEC-032: duyệt Phase 12, làm PROP-031, giữ nguyên PROP-027. Merge Phase 12 vào `main` (603 test). Chờ chạy thật. |
| 2026-09-27 | Phase 13 (DEC-033): nền móng + 3 agent (vẽ ảnh; bảng điều khiển và role; giọng văn), 3 agent review độc lập, 2 agent sửa lỗi. 725 test. |
| 2026-09-27 | DEC-034: merge Phase 13, không làm PROP-032. Phase 14: 2 agent (PROP-030 + ảnh bảng; selfcheck), checklist chạy thật, 1 review độc lập, 1 agent sửa lỗi. |
| 2026-09-27 | DEC-035: merge Phase 14 vào `main` (782 test). Code hoàn tất, chờ chạy thật. |
| 2026-09-29 | DEC-036: cài lên server `192.168.0.206` (systemd, Node 22.23.2). 782/782 test pass trên server, selfcheck 0 ❌, bot online ở server ezOne. LL-021 (pipe PowerShell chèn BOM/CRLF). |
| 2026-09-29 | DEC-037…040: Phase 15 (`/config panel`, chế độ kênh) và Phase 16 (web quản trị) merge vào `main`, cài lên server (`8da7fe2`), bật web ở cổng 8787 bằng `deploy/enable-web.sh`. |
| 2026-09-30 | DEC-041: rule mọi tính năng quản lý được trên web; `test/web-parity.test.ts`; đề xuất Phase 17 làm bù 17 mục còn thiếu. |
| 2026-09-30 | DEC-042: duyệt Phase 17 (nền móng adminOps, 3 agent, tích hợp; 7 trang mới). DEC-043: kênh nhận thông báo lên level (migration 6). PROP-038 (nhật ký giấu tiêu đề contribution ở kênh riêng tư). 1018/1019 test. |
