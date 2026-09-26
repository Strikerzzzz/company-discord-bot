# CURRENT STATE

> Đọc file này đầu tiên ở mỗi phiên. Cập nhật sau mỗi phase hoặc task đáng kể.
> Cập nhật lần cuối: **2026-09-26**

## 1. Phase hiện tại

**Phase 2–10 — Hoàn thiện toàn bộ tính năng: ĐÃ CODE XONG, đã test tự động và đã qua review độc lập** (DEC-021).

- Branch: `phase-2-10/hoan-thien-tinh-nang`, **chưa merge vào `main`**; chờ người phụ trách review.
- **Chưa chạy thật trên Discord.** Server Linux sẽ được cấp ngày thứ 2. Bước 6 của Phase 1 được gộp vào lần chạy thật này.
- Phase 0 và Phase 1 (trừ bước 6) đã merge vào `main`.

## 2. Tính năng đã có

| Nhóm | Nội dung |
| --- | --- |
| Activity XP | XP cố định/tin (mặc định 10), cooldown (60s), level 5n²+50n+100, chống tin ngắn/trùng (trong RAM), cấu hình theo channel, thông báo lên level |
| Contribution | `/contribution submit/view/list`, context menu "Ghi nhận đóng góp" (không chép nội dung tin nhắn), nút 👍 ghi nhận/rút, chống tự ghi nhận, chống ghi nhận trùng một tin nhắn |
| Vote/bầu cử | `/poll create/close/results/list`, chọn một/nhiều, ẩn danh, đổi phiếu, XP một lần, tự đóng theo thời hạn |
| Bảng xếp hạng | `/rank`, `/leaderboard`: activity/contribution × cá nhân/team; hoà điểm cùng hạng |
| Quản trị | `/admin xp`, `/admin contribution`, `/admin stats`, `/admin audit`, `/admin backup`; `/config` (XP, channel, team, admin-role, poll, contribution) |
| Vận hành | Migration tự động, backup hàng ngày, systemd unit có hardening, runbook `docs/DEPLOY.md` |

## 3. Kiểm chứng

Ngày 2026-09-26, trên máy dev (Windows, Node 22.23.2) và **bản copy sạch** (`git archive`):

| Hạng mục | Kết quả |
| --- | --- |
| `npm ci` (bản copy sạch) | OK |
| `npm run check` | OK: build, lint, **323/323 test** |
| `npm audit` | 0 lỗ hổng |
| Khởi động từ bản build (token giả, DB mới) | Migration chạy, nạp đủ 7 command + 1 context menu + 3 event + 2 namespace nút, tự backup, Discord từ chối token, token không lọt log |
| Test tích hợp | `test/integration.test.ts`: luồng end-to-end qua service thật |
| Review độc lập (3 agent) | Đúng đắn/dữ liệu, Discord API, bảo mật: mọi lỗi đã xác nhận đều được sửa, trừ các mục là quy tắc nghiệp vụ (xem mục 5) |
| Hiệu năng bảng xếp hạng team | 200k event: khoảng 0,07 ms mỗi lệnh (trước khi sửa: khoảng 1,1 s) |

## 4. Việc tiếp theo

1. Người phụ trách review branch `phase-2-10/hoan-thien-tinh-nang`, duyệt thì merge vào `main` (DEC-018).
2. **Ngày thứ 2, chạy thật** theo `docs/DEPLOY.md`:
   - tạo Discord Application test (tắt Public Bot, bật Message Content Intent);
   - cài trên server Linux, systemd;
   - thử toàn bộ lệnh trên server test.
3. Những điểm cần kiểm trên Discord thật (test giả không chứng minh được):
   - context menu: `deferReply` → REST lấy member → `editReply`, và lỗi sau khi defer công khai (`deleteReply` + `followUp` ephemeral);
   - thông báo lên level trong thread; sửa message trong thread đã archive;
   - kiểm tra quyền xem kênh riêng tư và thread riêng tư;
   - cấu hình `/config admin-role` kèm quyền trong Integrations.
4. Trả lời các câu hỏi nghiệp vụ PEND-015 → PEND-020 (mục 5).

## 5. Đang chờ người phụ trách quyết định

- PEND-015: ngữ nghĩa reset contribution. Đang làm: lượt đã bị reset không ghi nhận lại được.
- PEND-016: điểm contribution có được âm không (PROP-024).
- PEND-017: context menu có dùng modal để người ghi nhận tự viết tiêu đề không (PROP-025).
- PEND-018: snapshot team của lượt ghi nhận, lấy lúc gửi hay lúc được ghi nhận (PROP-026).
- PEND-019: ảnh kèm chữ ngắn có được XP không (PROP-027).
- PEND-020: có giới hạn XP từ vote không (PROP-028).
- PEND-004: remote git nội bộ. PEND-005: máy chủ cụ thể và process manager (đề xuất systemd). PEND-013: thời gian giữ dữ liệu.

## 6. Cách làm việc với repo

- Kiểm chứng không làm bẩn repo: `git archive HEAD | tar -x -C <thư-mục-tạm>`, rồi `npm ci && npm run check` trong thư mục đó.
- Máy dev Windows: Git Bash làm mất dấu `\` khi truyền `node -e '...'`, nên script có regex phải viết ra file. Working copy dùng LF (PROP-023).
- Worktree của agent nằm ở `.claude/worktrees/` (đã ignore); dọn sau khi merge (LL-012).

## 7. Nhật ký cập nhật

| Ngày | Thay đổi |
| --- | --- |
| 2026-09-24 | Khởi tạo: audit Phase 0, tạo AI Operating System. Không sửa code. |
| 2026-09-24 | Phase 0 được duyệt. Remote `origin` → `upstream` (push bị vô hiệu hoá). |
| 2026-09-24 | Mở Phase 1 (DEC-014…018). Hoàn thành bước 1–5 cùng `.npmrc`; nâng Node máy dev lên 22.23.2. |
| 2026-09-26 | DEC-019: PROP-022/023; merge Phase 1 vào `main`. |
| 2026-09-26 | DEC-020…027: chốt quy tắc nghiệp vụ. Làm Phase 2–10 bằng 7 agent song song trên nền móng chung; 3 agent review độc lập; 2 agent sửa lỗi. 323 test. Chờ review và chạy thật. |
