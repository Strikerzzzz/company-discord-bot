# ROADMAP

> Roadmap tổng thể. Cập nhật lần cuối: 2026-09-26.
> **Phase 2 trở đi là BẢN NHÁP, chưa được duyệt.** Thứ tự và phạm vi có thể đổi theo quyết định của người phụ trách.
> Nguyên tắc: không xây feature trên nền chưa build được; viết test song song từ Phase 2, không dồn về cuối; mỗi phase nghiệp vụ chỉ bắt đầu khi các quyết định liên quan đã được chốt.

## Tổng quan

| Phase | Tên | Trạng thái | Phụ thuộc quyết định |
| --- | --- | --- | --- |
| 0 | Audit và khởi tạo AI Operating System | **HOÀN THÀNH, đã duyệt** (2026-09-24) | — |
| 1 | Ổn định nền | **Gần xong**: đã merge vào `main`, còn bước 6 (chạy thật) | Đã duyệt (DEC-014…019) |
| 2 | Nền database và test | Nháp | PEND-010, 011, 012, 013 |
| 3 | Phân quyền admin và cấu hình | Nháp | PROP-013 |
| 4 | Activity XP | Nháp | PEND-006, 008 |
| 5 | Level và Individual Activity Leaderboard | Nháp | PEND-008 |
| 6 | Team và Team Activity Leaderboard | Nháp | PEND-007, 008 |
| 7 | Contribution | Nháp | PEND-009 |
| 8 | Voting và Contribution Score | Nháp | PEND-008, 009 |
| 9 | Contribution Leaderboards (cá nhân và team) | Nháp | PEND-007, 008 |
| 10 | Admin nâng cao và Statistics | Nháp | — |
| 11 | Security review và Deployment | Nháp | PEND-005 |

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
