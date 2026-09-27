# CURRENT STATE

> Đọc file này đầu tiên ở mỗi phiên. Cập nhật sau mỗi phase hoặc task đáng kể.
> Cập nhật lần cuối: **2026-09-27**

## 1. Phase hiện tại

**Phase 12 — Gamification và giao diện ảnh: ĐÃ CODE XONG, đã test, đã review độc lập và sửa lỗi** (DEC-028…031).

- Branch: `phase-12/gamification`, **chưa merge vào `main`**; chờ người phụ trách duyệt.
- `main` đã có Phase 0–10 (Phase 2–10 merge ngày 2026-09-26, DEC-028).
- **Chưa chạy thật trên Discord.** Server Linux cấp ngày thứ 2; lần chạy thật gộp Phase 1 bước 6, Phase 11 và kiểm Phase 12.

## 2. Tính năng đã có

| Nhóm | Nội dung |
| --- | --- |
| Activity XP | XP cố định/tin (mặc định 10), cooldown 60s, level 5n²+50n+100, chống tin ngắn/trùng (trong RAM), cấu hình theo channel |
| Cảnh giới tu tiên | 8 cảnh giới theo level (Luyện Khí → Độ Kiếp), thông báo "đột phá" khi vượt mốc, thông báo lên level theo phong cách tu tiên |
| Role cảnh giới | `/config tier set-role|clear-role|list`; bot tự thêm/bỏ role khi thành viên nhắn tin được XP. Chặn role nguy hiểm, role trùng vai trò khác; người gán cần Manage Roles |
| Chuỗi ngày, huy hiệu | Chuỗi ngày hoạt động (giờ Việt Nam), 15 huy hiệu; chỉ hiển thị, không cộng điểm |
| Contribution | `/contribution submit/view/list`, context menu "Ghi nhận đóng góp", nút 👍; điểm không bao giờ âm (tự bù, PROP-024) |
| Vote/bầu cử | `/poll create/close/results/list`, ẩn danh, XP một lần; giới hạn XP từ vote mỗi ngày do admin đặt (mặc định 25) |
| `/rank` | Ảnh thẻ tu luyện (avatar, cảnh giới, level, tiến độ, hạng, XP tuần, contribution, chuỗi ngày, huy hiệu) kèm chữ tóm tắt huy hiệu |
| `/leaderboard` | Ảnh bảng xếp hạng; Activity/Contribution × cá nhân/team × tổng/tuần/tháng; nút chuyển bảng, trang, "Hạng của tôi" |
| Bảng vàng | `/config board`: một message 2–3 ảnh bảng xếp hạng, tự cập nhật 10 phút |
| Quản trị | `/admin xp|contribution|stats|audit|backup`; `/config` (XP, channel, team, admin-role, poll, contribution, tier, board) |
| Vận hành | Migration tự động (3 migration), backup hàng ngày, systemd hardening, runbook `docs/DEPLOY.md` |

## 3. Kiểm chứng

Ngày 2026-09-27, trên máy dev (Windows, Node 22.23.2) và **bản copy sạch** (`git archive`):

| Hạng mục | Kết quả |
| --- | --- |
| `npm ci` (bản copy sạch) | OK |
| `npm run check` | OK: build, lint, **601/601 test** |
| `npm audit` | 0 lỗ hổng |
| Vẽ ảnh từ `build/` với service thật | OK (thẻ rank và bảng xếp hạng, font tiếng Việt đúng) |
| Khởi động từ bản build (token giả, DB mới) | Đủ 3 migration (21 bảng); nạp 7 command, 1 context menu, 3 event và 3 namespace nút; tự backup; Discord từ chối token; token không lọt log |
| Test tích hợp | `test/integration.test.ts`, `test/integration-gamification.test.ts` (qua service thật và hàm vẽ thật) |
| Hiệu năng (200k event) | Bảng tuần ~7 ms, tháng ~28 ms, team tháng ~61 ms; "Hạng của tôi" với 2000 người bằng điểm ~55–75 ms (trước khi sửa ~7 s) |
| Review độc lập (3 agent) | Đúng đắn dữ liệu, Discord API, bảo mật: mọi lỗi kỹ thuật đã xác nhận đều đã sửa (LL-017); còn 1 quy tắc nghiệp vụ chờ quyết định (PROP-031) |

## 4. Việc tiếp theo

1. Người phụ trách duyệt `phase-12/gamification` → merge vào `main` (DEC-018).
2. Trả lời PEND-021 (PROP-031) và PEND-019.
3. **Ngày thứ 2, chạy thật** theo `docs/DEPLOY.md`:
   - tạo Discord Application (tắt Public Bot, bật Message Content Intent);
   - mời bot bằng link có permissions `275146394624` (gồm Attach Files và Manage Roles);
   - tạo role cảnh giới mới riêng, kéo role của bot lên ngay trên chúng;
   - cài trên server Linux với systemd, rồi smoke test ảnh (`/rank`, `/leaderboard`) và xem `journalctl` không có lỗi canvas/SIGSYS.
4. Những điểm cần kiểm trên Discord thật:
   - context menu (defer → REST lấy member → editReply);
   - thay ảnh khi bấm nút (`files` + `attachments: []`), kể cả message ephemeral; người khác bấm nút thì nhận bảng riêng;
   - `/rank`, `/leaderboard` trả lời riêng khi bot thiếu Attach Files;
   - role cảnh giới: `fetchMe`, thứ bậc role, chặn role có overwrite nguy hiểm, Audit Log của Discord có lý do;
   - Bảng vàng: đăng ngay khi đặt kênh, xoá khi đổi kênh hoặc tắt, tự đăng lại khi message bị xoá;
   - thông báo lên level/đột phá trong thread; quyền xem kênh riêng tư; `/config admin-role` kèm quyền trong Integrations.

## 5. Đang chờ người phụ trách quyết định

- PEND-021 (PROP-031): rút ghi nhận rồi ghi nhận lại có xoá được hình phạt của admin không. **Đang làm:** có.
- PEND-019 (PROP-027): ảnh kèm chữ **quá ngắn** có được XP không. **Đang làm:** không (ảnh kèm chữ từ 5 ký tự trở lên thì được).
- PEND-004: remote git nội bộ. PEND-005: máy chủ cụ thể và process manager (đề xuất systemd). PEND-013: thời gian giữ dữ liệu.

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
| 2026-09-27 | Phase 12: nền móng + 5 agent (2 đợt), 3 agent review độc lập, 2 agent sửa lỗi. 601 test. Chờ duyệt và chạy thật. |
