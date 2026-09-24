# DECISIONS

> Các quyết định kỹ thuật và sản phẩm **đã được chốt**, cùng danh sách quyết định đang chờ.
> Chỉ người có quyền quyết định mới chốt được. AI không tự thêm quyết định vào mục "Đã chốt".
> Ý tưởng chưa duyệt nằm trong `PROPOSALS.md`.

Format mỗi quyết định:

```
## DEC-XXX — Tên
- Ngày / Trạng thái / Nguồn
- Nội dung
- Hệ quả
```

Trạng thái hợp lệ: `CHỐT`, `THAY THẾ BỞI DEC-YYY`, `HUỶ`.

---

## Đã chốt

### DEC-001 — Giữ stack hiện tại

- **Ngày:** 2026-09-24 · **Trạng thái:** CHỐT · **Nguồn:** brief dự án
- **Nội dung:** Stack là TypeScript + Node.js + discord.js v14 + SQLite qua better-sqlite3. Không đổi stack.
- **Hệ quả:** Việc nâng version trong cùng stack (ví dụ TypeScript 5.x, better-sqlite3 major mới) không phải đổi stack, nhưng vẫn là thay đổi dependency nên cần được duyệt (PROP-001, PROP-002, PROP-004).

### DEC-002 — Topology: 1 process + 1 SQLite + Discord

- **Ngày:** 2026-09-24 · **Trạng thái:** CHỐT · **Nguồn:** brief dự án
- **Nội dung:** Một máy chạy một process Node.js, dùng một file SQLite. Không có API server, database server, message queue, cache server hay microservices.
- **Hệ quả:** Mọi thiết kế phải chạy được trong một process. Trạng thái trong bộ nhớ (ví dụ anti-spam) sẽ mất khi restart; phải tính đến điều này khi thiết kế.

### DEC-003 — Database của bot độc lập hoàn toàn

- **Ngày:** 2026-09-24 · **Trạng thái:** CHỐT · **Nguồn:** brief dự án
- **Nội dung:** Bot chỉ dùng database SQLite riêng. Không bao giờ truy cập database sản phẩm của công ty.
- **Hệ quả:** Không thêm driver hay connection string nào tới hệ thống khác.

### DEC-004 — Hai hệ thống điểm độc lập

- **Ngày:** 2026-09-24 · **Trạng thái:** CHỐT · **Nguồn:** brief dự án
- **Nội dung:** Activity XP và Contribution Score là hai hệ thống riêng: lưu riêng, tính riêng, xếp hạng riêng. Không bao giờ gộp thành một điểm. Contribution Score không được suy ra từ số lượng tin nhắn.
- **Hệ quả:** Có 4 bảng xếp hạng riêng biệt: activity/contribution × cá nhân/team.

### DEC-005 — Team xác định bằng Discord Role

- **Ngày:** 2026-09-24 · **Trạng thái:** CHỐT · **Nguồn:** brief dự án
- **Nội dung:** Team được suy ra từ Discord Role do admin cấu hình. Không xây database nhân viên hay team.
- **Hệ quả:** Cách xác định thành viên team phụ thuộc vào PEND-007.

### DEC-006 — Admin qua slash command, MVP không có dashboard

- **Ngày:** 2026-09-24 · **Trạng thái:** CHỐT · **Nguồn:** brief dự án
- **Nội dung:** Mọi chức năng admin ở MVP dùng slash command. Không xây dashboard.
- **Hệ quả:** Không mở HTTP server hay port nào.

### DEC-007 — Phân tầng mục tiêu

- **Ngày:** 2026-09-24 · **Trạng thái:** CHỐT · **Nguồn:** brief dự án
- **Nội dung:** `Discord → Command/Event → Service → Repository → SQLite`. Business module không phụ thuộc trực tiếp vào discord.js. Tầng Discord càng mỏng càng tốt.
- **Hệ quả:** Cấu trúc thư mục cụ thể chưa chốt (PROP-011).

### DEC-008 — Least privilege

- **Ngày:** 2026-09-24 · **Trạng thái:** CHỐT · **Nguồn:** brief dự án
- **Nội dung:** Bot chỉ có quyền tối thiểu đủ để hoạt động. Không dùng quyền Administrator.
- **Hệ quả:** Mỗi permission hoặc intent mới cần có lý do. Privileged intent phải được quyết định riêng (PEND-006, PEND-007).

### DEC-009 — Tận dụng foundation, không rewrite

- **Ngày:** 2026-09-24 · **Trạng thái:** CHỐT · **Nguồn:** brief dự án
- **Nội dung:** Giữ và cải thiện code tốt của template, thay đổi nhỏ và có kiểm soát. Không rewrite toàn bộ.
- **Hệ quả:** Khung loader và dispatcher được giữ lại (xem `ARCHITECTURE.md` mục 2.3).

### DEC-010 — Tiếng Việt cho tài liệu

- **Ngày:** 2026-09-24 · **Trạng thái:** CHỐT · **Nguồn:** brief dự án
- **Nội dung:** Mọi nội dung do AI tạo trong repo viết bằng tiếng Việt. Tên biến, class, function, file, package và thuật ngữ kỹ thuật giữ tiếng Anh.

### DEC-011 — Quy trình AI Operating System

- **Ngày:** 2026-09-24 · **Trạng thái:** CHỐT · **Nguồn:** brief dự án
- **Nội dung:**
  - `CLAUDE.md` chứa luật nền tảng; `docs/ai/` chứa context, trạng thái và lịch sử.
  - Cải tiến do AI phát hiện phải ghi vào `PROPOSALS.md` và chỉ triển khai khi được duyệt.
  - Protected rule chỉ được đổi qua proposal.
- **Hệ quả:** Quy trình chi tiết nằm trong `CLAUDE.md`, mục "Quy trình".

### DEC-012 — Scoring formula do người có quyền quyết định

- **Ngày:** 2026-09-24 · **Trạng thái:** CHỐT · **Nguồn:** brief dự án
- **Nội dung:** Công thức XP, level, team score và contribution score không được AI tự quyết định. Mỗi công thức phải được chốt thành một DEC riêng trước khi code.

### DEC-013 — Repo là của team, làm việc local, chưa publish

- **Ngày:** 2026-09-24 · **Trạng thái:** CHỐT · **Nguồn:** chỉ thị của người phụ trách
- **Nội dung:**
  - Remote `origin` (repo public `Retr0-01/discordjs-core-bot`) được đổi tên thành `upstream`, chỉ dùng để fetch tham khảo.
  - Push URL của `upstream` bị vô hiệu hoá.
  - `main` không còn tracking `upstream/main`.
  - Commit chỉ nằm ở local; chưa publish lên đâu.
- **Hệ quả:**
  - `git push` luôn fail cho tới khi có remote nội bộ.
  - Muốn publish sau này thì thêm remote mới (URL CHƯA XÁC ĐỊNH) theo chỉ thị.
  - Không rewrite history; giữ license MIT.

---

## Đang chờ quyết định

| Mã | Câu hỏi | Ảnh hưởng tới | Liên quan |
| --- | --- | --- | --- |
| PEND-001 | Có duyệt phạm vi Phase 1 (ổn định nền) như đề xuất không? | Toàn bộ phase sau | `ROADMAP.md`, PROP-001…005, 010, 012, 021 |
| PEND-002 | Có cho phép nâng version dependency (TypeScript 5.x, better-sqlite3 major, discord.js 14.x mới nhất) và bỏ `@discordjs/rest`, `discord-api-types` không? | Phase 1 | PROP-001, 002, 004 |
| PEND-003 | Có chuyển secret từ `src/config.json` sang `.env` (dùng tính năng có sẵn của Node, không thêm dotenv) không? | Phase 1 | PROP-005 |
| PEND-004 | URL remote git nội bộ là gì, và khi nào publish? | Khi cần publish (hiện chưa cần, DEC-013) | CHƯA XÁC ĐỊNH |
| PEND-005 | Production chạy Windows hay Linux? Dùng process manager nào (pm2, systemd, Windows service)? Node version nào? | Phase 1, Phase 11 | PROP-002, 018 |
| PEND-006 | Có bật privileged intent `MessageContent` cho anti-spam không? | Phase 4 | PROP-015 |
| PEND-007 | Thành viên team tính theo role tại thời điểm ghi điểm (snapshot) hay role hiện tại (cần intent `GuildMembers`)? | Phase 6 | PROP-016 |
| PEND-008 | Công thức: XP mỗi tin nhắn, đường cong level, team score, contribution score | Phase 4–9 | DEC-012 |
| PEND-009 | Contribution được tạo bằng cách nào (slash command, context menu trên message)? Quy tắc vote: tự vote, số vote mỗi người, trọng số? | Phase 7–8 | PROP-017 |
| PEND-010 | Bot phục vụ một guild hay nhiều guild? | Phase 2 (thiết kế schema) | — |
| PEND-011 | Chọn test framework | Phase 2 | PROP-009 |
| PEND-012 | Duyệt cấu trúc module mục tiêu | Phase 2 | PROP-011 |
| PEND-013 | Chính sách lưu và giữ dữ liệu (nội dung tin nhắn, thời gian giữ log/audit) | Phase 2, 4 | PROP-014, 015 |
