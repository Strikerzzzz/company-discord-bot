# ROADMAP

> Roadmap tổng thể. Cập nhật lần cuối: 2026-09-26.
> Theo DEC-021, Phase 2–10 được làm liên tục trên branch `phase-2-10/hoan-thien-tinh-nang`, kèm tính năng vote/bầu cử (DEC-026), và đã merge vào `main` (DEC-028).
> Phase 12 (gamification và ảnh thẻ, DEC-029…032) làm trên branch `phase-12/gamification`, đã merge vào `main`.
> Nguyên tắc: không xây feature trên nền chưa build được; viết test song song với code; mỗi phase nghiệp vụ chỉ bắt đầu khi các quyết định liên quan đã được chốt.

## Tổng quan

| Phase | Tên | Trạng thái | Phụ thuộc quyết định |
| --- | --- | --- | --- |
| 0 | Audit và khởi tạo AI Operating System | **HOÀN THÀNH, đã duyệt** (2026-09-24) | — |
| 1 | Ổn định nền | **Đã merge vào `main`**; còn bước 6 (chạy thật, gộp vào lần chạy thật của Phase 11) | DEC-014…019 |
| 2 | Nền database và test | **Đã merge vào `main`** (DEC-028) | DEC-021, DEC-027 |
| 3 | Phân quyền admin và cấu hình | **Đã merge vào `main`** | DEC-021 (PROP-013) |
| 4 | Activity XP | **Đã merge vào `main`** | DEC-022, DEC-023 |
| 5 | Level và Individual Activity Leaderboard | **Đã merge vào `main`** | DEC-022 |
| 6 | Team và Team Activity Leaderboard | **Đã merge vào `main`** | DEC-024 |
| 7 | Contribution | **Đã merge vào `main`**; PEND-015…018 đã trả lời (DEC-028) | DEC-025, DEC-028 |
| 8 | Voting và Contribution Score | **Đã merge vào `main`**, kèm vote/bầu cử (DEC-026) | DEC-025, DEC-026 |
| 9 | Contribution Leaderboards (cá nhân và team) | **Đã merge vào `main`** | DEC-024 |
| 10 | Admin nâng cao và Statistics | **Đã merge vào `main`** | — |
| 11 | Security review và Deployment | **Đã cài và chạy thật** trên `192.168.0.206` (DEC-036); đang kiểm theo `docs/TEST-PLAN.md` | DEC-036 |
| 12 | Gamification và giao diện ảnh | **Đã merge vào `main`** (DEC-032) | DEC-028…032 |
| 13 | Bộ danh hiệu chọn được, bảng điều khiển role | **Đã merge vào `main`** (DEC-034) | DEC-033 |
| 14 | Hoàn tất trước khi chạy thật | **Đã merge vào `main`** (DEC-035) | DEC-034 |
| 15 | Bảng cấu hình chung, chế độ kênh tính XP | **Đã merge vào `main`** (DEC-038) | DEC-037 |
| 16 | Trang web quản trị (mạng nội bộ, đăng nhập Discord) | **Đã merge vào `main`** (DEC-040) | DEC-039 |
| 19 | Retro sprint theo team, tự ghi Confluence, vote tên sprint | **Đã duyệt, đang làm** | DEC-049 |
| 17 | Web quản trị đủ tính năng (làm bù theo DEC-041), kênh thông báo lên level | **Đã code trên branch `phase-17/web-full`**, đang review; chờ duyệt merge | DEC-041, DEC-042, DEC-043 |

## Chi tiết

### Phase 0 — Audit và khởi tạo AI Operating System · HOÀN THÀNH

Audit toàn bộ repo; tạo `CLAUDE.md` và `docs/ai/`. Không sửa code. Người phụ trách đã duyệt. Tách git khỏi upstream (PROP-006, DEC-013).

### Phase 1 — Ổn định nền

- **Mục tiêu:** Repo cài được, build được, lint được trên máy sạch; bot không sập vì lỗi của một command. **Không thêm feature.**
- **Phạm vi đề xuất:**
  - PROP-021: metadata `package.json`, `"private": true`.
  - PROP-001: TypeScript 5.x và tsconfig.
  - PROP-002: better-sqlite3 và `engines.node`.
  - PROP-004: cập nhật dependency, bỏ `@discordjs/rest` và `discord-api-types`.
  - PROP-005: `.env` thay cho `config.json`.
  - PROP-003: error boundary và xử lý async.
  - PROP-012: hardening tầng Discord.
  - PROP-010: ESLint dùng thông tin type (có thể làm một phần).
- **Điều kiện hoàn thành:** `npm ci`, `npm run build`, `npm run lint` đều pass trên máy sạch. Bot đăng nhập được với token thật trên guild test. Một lỗi cố ý trong command không làm sập process. `build/` không chứa secret. `npm audit --omit=dev` không còn lỗ hổng high, hoặc đã ghi lý do chấp nhận.

### Phase 2 — Nền database và test

- **Mục tiêu:** Có hạ tầng lưu trữ và kiểm thử cho các phase nghiệp vụ.
- **Phạm vi đề xuất:**
  - PROP-011: cấu trúc module và composition root.
  - PROP-007: connection, PRAGMA, migration runner, `data/bot.db`, init trước login.
  - PROP-009: test framework.
  - PROP-008: backup (ít nhất ở mức thủ công).
  - PROP-018: logger và graceful shutdown.
  - PROP-019: xoá demo và viết lại README.
- **Điều kiện hoàn thành:** Migration chạy được trên DB trống và DB có sẵn. `npm test` chạy được test mẫu với SQLite `:memory:`. Chưa có schema nghiệp vụ nào khi thiết kế chưa được duyệt.

### Phase 3 — Phân quyền admin và cấu hình

- **Mục tiêu:** Có admin guard hai lớp và audit log (PROP-013). Có command cấu hình channel XP bật/tắt, cooldown theo channel, excluded channel, team role.
- **Lý do đặt trước XP:** XP phụ thuộc cấu hình channel, và mọi thao tác admin đều cần guard.

### Phase 4 — Activity XP

- **Mục tiêu:** Tin nhắn hợp lệ → XP, qua cấu hình channel, cooldown, anti-spam và anti-farming.
- **Cần có trước:** Quyết định về intent `MessageContent` (PEND-006), công thức XP (PEND-008), quyết định về ledger (PROP-014) và quyền riêng tư (PROP-015).
- **Thay đổi quyền:** Thêm intent `GuildMessages`.

### Phase 5 — Level và Individual Activity Leaderboard

`/rank`, `/leaderboard` cho activity. Cần chốt đường cong level.

### Phase 6 — Team và Team Activity Leaderboard

Map role → team theo cấu hình, Team Activity Leaderboard. Cần chốt công thức team score và ngữ nghĩa thành viên team (PEND-007, PROP-016).

### Phase 7 — Contribution

Tạo, xem, kiểm duyệt contribution. Cần chốt cách tạo contribution (PEND-009).

### Phase 8 — Voting và Contribution Score

Vote qua button với customId động (PROP-012), chống gian lận (PROP-017), Contribution Score. Cần chốt công thức.

### Phase 9 — Contribution Leaderboards

Individual Contribution Leaderboard và Team Contribution Leaderboard. Tuỳ chọn thêm leaderboard theo kỳ (PROP-020).

### Phase 10 — Admin nâng cao và Statistics

Give/remove/reset XP và contribution (có xác nhận, ghi audit log), thống kê.

### Phase 12 — Gamification và giao diện ảnh · ĐÃ MERGE (DEC-032)

- **Mục tiêu:** làm level và bảng xếp hạng thú vị hơn, có giao diện riêng ngay trong Discord.
- **Phạm vi:**
  - DEC-028: điểm contribution không âm (PROP-024); giới hạn XP từ vote mỗi ngày (PROP-028).
  - DEC-029: cảnh giới tu tiên, chuỗi ngày hoạt động, huy hiệu, bảng xếp hạng tuần/tháng (PROP-020).
  - DEC-030: ảnh thẻ `/rank` và ảnh `/leaderboard` (`@napi-rs/canvas`, font Be Vietnam Pro), nút chuyển trang (PROP-029), Bảng vàng tự cập nhật.
  - DEC-031: tự gán role theo cảnh giới (quyền Manage Roles).
- **Cách làm:** nền móng chung, rồi đợt 1 (3 agent: dữ liệu theo kỳ và gamification; quy tắc nghiệp vụ; vẽ ảnh), rồi đợt 2 (2 agent: lệnh xem và Bảng vàng; cấu hình, sự kiện và role), sau đó review độc lập.
- **Điều kiện hoàn thành:** `npm run check` pass; ảnh render đúng trên máy dev Windows và trên Linux khi chạy thật; review độc lập không còn lỗi đã xác nhận.

### Phase 14 — Hoàn tất trước khi chạy thật · ĐÃ MERGE (DEC-035)

- **Phạm vi (DEC-034):** PROP-030 (đưa riêng XP/cooldown của channel về giá trị chung); ảnh bảng Contribution/team theo bộ danh hiệu; lệnh `npm run selfcheck` kiểm tra môi trường server trước khi bật bot; checklist chạy thật `docs/TEST-PLAN.md`.

### Phase 13 — Bộ danh hiệu chọn được, bảng điều khiển role · ĐÃ MERGE (DEC-034)

- **Mục tiêu:** hệ thống danh hiệu/role "có lựa chọn chứ không cứng" (DEC-033).
- **Phạm vi:**
  - 5 bộ danh hiệu (Tu tiên, Rank game, Kiếm hiệp, Cây xanh, Vũ trụ), 8 bậc cùng mốc; admin chọn bộ, đổi tên/emoji từng bậc.
  - Bot tự tạo/đổi tên role theo bộ.
  - Bảng điều khiển `/config tier panel` bằng Components V2 (menu chọn bộ, 8 ô chọn role, form đổi tên).
  - Ảnh thẻ và thông báo theo giọng văn từng bộ.
- **Cách làm:** nền móng (dữ liệu bộ, TierSetService, migration 4) → 3 agent song song (vẽ ảnh; bảng điều khiển và role; giọng văn và tài liệu) → review độc lập.

### Phase 17 — Web quản trị đủ tính năng · ĐÃ CODE, CHỜ MERGE (DEC-042)

- **Mục tiêu:** làm bù 17 mục còn thiếu trên web (danh sách ở DEC-041), để `PENDING_AT_DEC_041` trong `test/web-parity.test.ts` về rỗng.
- **Trang dự kiến:**
  - Thành viên: tìm, xem hồ sơ, cộng/trừ/reset XP và contribution của một người. Sau khi chỉnh XP thì đồng bộ role danh hiệu như lệnh.
  - Reset toàn server: gõ chữ xác nhận như lệnh.
  - Contribution: danh sách, chi tiết, gỡ.
  - Vote: danh sách, kết quả, đóng vote (cập nhật message trong Discord).
  - Bảng xếp hạng: dạng bảng.
  - Thống kê.
  - Sao lưu: tạo bản sao lưu, xem danh sách; không tải file database qua web.
- **Cách làm:** nền móng (tách logic dùng chung khỏi `admin.ts` sang `src/discord/adminOps.ts`), agent song song theo trang, review bảo mật và tính đúng đắn độc lập.
- **Làm thêm (DEC-043):** kênh nhận thông báo lên level (migration 6), theo yêu cầu của người phụ trách trong lúc làm Phase 17.

### Phase 11 — Security review và Deployment

- Rà soát permission và OAuth scope thực tế trên Developer Portal (hiện CHƯA XÁC ĐỊNH).
- Rà soát privileged intent; chạy `npm audit`; kiểm tra log.
- Backup định kỳ và diễn tập restore (PROP-008).
- Chọn process manager, viết runbook vận hành.

## Lịch sử thay đổi roadmap

| Ngày | Thay đổi |
| --- | --- |
| 2026-09-24 | Tạo bản nháp đầu tiên từ kết quả audit Phase 0 |
| 2026-09-24 | Phase 0 được duyệt. PROP-006 (git) đã triển khai; phần metadata tách thành PROP-021 và đưa vào Phase 1 |
| 2026-09-24 | Phase 1 được duyệt và đang làm; bước 1–5 xong. Thêm `.npmrc ignore-scripts` vào Phase 1 (LL-008) |
| 2026-09-26 | Thêm PROP-022, PROP-023 vào Phase 1 và làm xong; merge Phase 1 vào `main` (DEC-019). Còn bước 6 |
| 2026-09-26 | DEC-021: Phase 2–10 làm liên tục trên một branch, thêm tính năng vote/bầu cử (DEC-026). Đã code, test (323) và qua review độc lập. Phase 11 chờ server Linux |
| 2026-09-26 | DEC-028: merge Phase 2–10 vào `main`. Thêm Phase 12 (gamification và ảnh thẻ, DEC-029…031) |
| 2026-09-27 | DEC-032: duyệt và merge Phase 12 vào `main` |
| 2026-09-27 | DEC-033: thêm Phase 13 (5 bộ danh hiệu, bot tự tạo role, bảng điều khiển trực quan) |
| 2026-09-27 | DEC-034: merge Phase 13 vào `main`; thêm Phase 14 (hoàn tất trước khi chạy thật) |
| 2026-09-27 | DEC-035: merge Phase 14 vào `main`; còn Phase 11 (chạy thật trên server) |
| 2026-09-29 | DEC-036: Phase 11 đã cài và chạy thật trên server `192.168.0.206` |
| 2026-09-29 | DEC-037: thêm Phase 15 (`/config panel`, chế độ kênh "chỉ kênh được bật") |
| 2026-09-29 | DEC-038: merge Phase 15 vào `main` |
| 2026-09-29 | DEC-039: thêm Phase 16 (trang web quản trị) |
| 2026-09-29 | DEC-040: merge Phase 16 vào `main` |
| 2026-09-30 | DEC-041: rule "mọi tính năng quản lý được trên web"; thêm Phase 17 (làm bù cho tính năng cũ), chờ duyệt |
| 2026-09-30 | DEC-042: duyệt Phase 17; DEC-043: thêm kênh thông báo lên level vào Phase 17 |
