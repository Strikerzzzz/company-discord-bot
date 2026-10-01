# CURRENT STATE

> Đọc file này đầu tiên ở mỗi phiên. Cập nhật sau mỗi phase hoặc task đáng kể.
> Cập nhật lần cuối: **2026-10-01**

## 1. Phase hiện tại

**Bot đang chạy thật** từ 2026-09-29 (DEC-036). `main` có đủ Phase 0–19.

- Server: `192.168.0.206` (Ubuntu 22.04, máy dùng chung), systemd unit `company-discord-bot`, Node 22.23.2. Guild: server Discord **ezOne**; Application "ezOne Bot".
  - Bản đang chạy: **`bb5189e`** (Phase 19, migration 9), cài ngày 2026-10-01. Selfcheck có 3 ⚠️ đã biết, không phải lỗi: Node 22 thay vì 24 (DEC-036); file `-wal` và "schema version cũ" khi bot cũ còn chạy lúc selfcheck (selfcheck chỉ đọc file chính).
  - Web quản trị bật ở `http://192.168.0.206:8787` (`deploy/enable-web.sh`).
  - Bảng vàng: đã chuyển sang `#🤖bot-commands` (2026-10-01, sau khi role bot được cấp View Channel, Send Messages, Attach Files).
  - Confluence (DEC-049): IT đã thêm route tới `docs.ezcloud.vn` (10.19.193.111) qua VPN của server; kiểm tra 2026-10-01: cổng 443 mở, HTTPS trả 401 khi không có token (cả curl và Node). Người phụ trách đã chạy `deploy/enable-confluence.sh` với token mới và báo chạy OK; chưa xem lại log vì máy dev tạm mất kết nối SSH tới server (VPN máy dev đổi dải 172.16.193.x).
- **Phase 20 (DEC-051, PROP-040) đang làm trên branch `phase-20/contribution-review`:** contribution có kênh riêng, phải được duyệt rồi mới mở 👍/👎, nút 👎 Không ghi nhận (điểm = max(0, 👍 − 👎)), XP cho người bấm, DM khi duyệt/từ chối, role duyệt.
  - Nền móng `1940485`: migration 10, cấu hình, `ContributionService` (duyệt, `vote`, event sàn, XP người bấm), `src/discord/contributionOps.ts`, `configOps.resolveContributionChannel`, `AdminActions.sendDirectMessage`.
  - 3 agent song song (service và test; tầng Discord; trang web) đã gộp, thêm "Đăng lại thẻ" trên web. 2 review độc lập (bảo mật; tính đúng đắn, có fuzz ~460×200 bước) không có lỗi CAO; 2 lỗi TRUNG BÌNH và các lỗi THẤP đã sửa (đăng lại thẻ không chuyển nội dung kênh riêng tư; role duyệt không làm role danh hiệu; lượt 👍 cũ không được XP người bấm...). `npm run check`: 1329/1330 pass (1 bỏ qua: quyền thư mục kiểu Linux).
  - **Chờ người phụ trách duyệt merge vào `main` và cài lên server** (migration 10: sao lưu trước).
  - Sau khi cài: chọn kênh contribution (PM đã tạo kênh), thêm role duyệt, chỉnh "Điểm mỗi lượt ghi nhận" nếu muốn (người phụ trách nêu ví dụ 2).
- Việc người phụ trách còn làm: chuyển kênh tính XP sang "chỉ kênh được bật" nếu chưa; kiểm theo `docs/TEST-PLAN.md` (mục 14 Phase 18, 15 retro); quyết định XP cho thả cảm xúc (đề xuất 2 XP/lượt cho người thả, tối đa 10 XP/ngày, cần intent `GuildMessageReactions`).
- Bot **chưa có quyền Manage Roles**: role danh hiệu chờ chủ server bật quyền cho role của bot.

Lịch sử Phase 17–19 (giữ để tra cứu):

- Phase 17 (DEC-042, merge DEC-046): web quản trị đủ tính năng (thành viên, bảng xếp hạng, contribution, vote, thống kê, reset điểm, sao lưu), `src/discord/adminOps.ts`, kênh thông báo lên level (migration 6, DEC-043), DEC-041 + `test/web-parity.test.ts`.
- Phase 18 (DEC-044, DEC-047, merge DEC-048): chọn tất cả, nhiều role admin/tạo vote (migration 7), bộ danh hiệu Mobile Legends, bộ danh hiệu cá nhân (migration 8, `/rank-style`), nút ❓ trên thẻ `/rank`, trang Kênh tính XP hiện mọi kênh cho admin (DEC-045).
- Phase 19 (DEC-049, DEC-050): retro sprint theo team trong kênh/thread, ẩn danh trên Discord và Confluence, vote tên sprint, XP điền retro (1 lần/ngày) và thưởng tên thắng (chỉ khi vote thật), tự ghi vào Confluence nội bộ (migration 9).

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
| Contribution | `/contribution submit/view/list`, context menu "Ghi nhận đóng góp", nút 👍; điểm không bao giờ âm (tự bù, PROP-024); rút ghi nhận khi tác giả đang bị phạt thì không ghi nhận lại được (PROP-031). Phase 20 (branch): kênh riêng, duyệt, 👎, XP người bấm (DEC-051) |
| Vote/bầu cử | `/poll create/close/results/list`, ẩn danh, XP một lần; giới hạn XP từ vote mỗi ngày do admin đặt (mặc định 25) |
| `/rank` | Ảnh thẻ tu luyện (avatar, cảnh giới, level, tiến độ, hạng, XP tuần, contribution, chuỗi ngày, huy hiệu) kèm chữ tóm tắt huy hiệu |
| `/leaderboard` | Ảnh bảng xếp hạng; Activity/Contribution × cá nhân/team × tổng/tuần/tháng; nút chuyển bảng, trang, "Hạng của tôi" |
| Bảng vàng | `/config board`: một message 2–3 ảnh bảng xếp hạng, tự cập nhật 10 phút |
| Quản trị | `/admin xp|contribution|stats|audit|backup`; `/config` (XP, channel, team, admin-role, poll, contribution, tier, board) và `/config panel` |
| Web quản trị | `http://<server>:<WEB_PORT>`, đăng nhập Discord, chỉ mạng nội bộ (DEC-039). Phase 16: tổng quan, kênh, team, cài đặt điểm, quyền, Bảng vàng, danh hiệu, nhật ký. Phase 17 (branch, chưa merge): thành viên, bảng xếp hạng, contribution, vote, thống kê, reset điểm, sao lưu. Mọi tính năng phải có trên web (DEC-041) |
| Thông báo lên level | Bật/tắt; kênh nhận thông báo (DEC-043, branch Phase 17): đã chọn thì chỉ gửi vào kênh đó, chưa chọn thì gửi ở kênh vừa nhắn |
| Retro | `/retro` theo kênh/thread của team, ẩn danh, vote tên sprint, ghi Confluence nội bộ (Phase 19, DEC-049) |
| Vận hành | Migration tự động (9 migration trên `main`, migration 10 ở Phase 20), backup hàng ngày, systemd hardening, runbook `docs/DEPLOY.md` |

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
| 2026-09-30 | DEC-041…048: Phase 17 (web đủ tính năng) và Phase 18 (chọn tất cả, nhiều role, bộ Mobile Legends, bộ danh hiệu cá nhân, nút ❓) merge vào `main` và cài lên server. |
| 2026-10-01 | DEC-049, DEC-050: Phase 19 (retro, Confluence) merge và cài (`bb5189e`). Bảng vàng chuyển sang `#🤖bot-commands`. Server vào được Confluence; bật ghi Confluence. |
| 2026-10-01 | DEC-051 (PROP-040): mở Phase 20, contribution có kênh riêng, duyệt, 👎, XP người bấm. Nền móng `1940485`, 3 agent song song. |
