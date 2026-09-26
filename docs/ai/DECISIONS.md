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

### DEC-014 — Duyệt phạm vi Phase 1 và việc nâng dependency

- **Ngày:** 2026-09-24 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách (trả lời PEND-001, PEND-002)
- **Nội dung:**
  - Phase 1 gồm PROP-001, 002, 003, 004, 005, 010, 012, 021.
  - Được phép nâng version dependency và bỏ `@discordjs/rest`, `discord-api-types`.
- **Hệ quả:**
  - Các proposal trên chuyển sang `APPROVED`.
  - Chọn: TypeScript 5.9.x (bản 7.x chưa được typescript-eslint hỗ trợ); better-sqlite3 13.x (kèm sẵn binary N-API, không tải gì lúc cài); discord.js 14.27.x; ESLint 10.x + typescript-eslint 8.x (ban đầu chọn ESLint 9 vì máy dev chạy Node 22.12; sau khi máy lên 22.23 thì nâng lên 10).

### DEC-015 — Secret qua environment variable

- **Ngày:** 2026-09-24 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách (trả lời PEND-003)
- **Nội dung:**
  - Token và cấu hình đọc từ `process.env`.
  - File `.env` được nạp bằng tính năng có sẵn của Node (`--env-file`), không thêm `dotenv`.
  - Bỏ `src/config.json`.

### DEC-016 — Production chạy Linux, runtime Node 24 LTS

- **Ngày:** 2026-09-24 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách (trả lời một phần PEND-005)
- **Nội dung:**
  - Server production là Linux.
  - Runtime mục tiêu cho production là Node 24 LTS (hỗ trợ tới 04/2028).
  - Code phải chạy được trên Node ≥ 22.14 (`engines`), vì better-sqlite3 13 cần N-API 10 (LL-009).
  - Theo chỉ thị "cần thì cập nhật", máy dev đã nâng Node 22.12.0 → 22.23.2 qua winget (cùng major, không ảnh hưởng ABI của project khác).
- **Hệ quả:**
  - Process manager và máy chủ cụ thể vẫn đang chờ (PEND-005).
  - Không host trên nền tảng cloud không cần thiết (DEC-002).

### DEC-017 — Sao lưu database hàng ngày

- **Ngày:** 2026-09-24 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách
- **Nội dung:** Database của bot phải được sao lưu mỗi ngày.
- **Hệ quả:**
  - PROP-008 chuyển sang `APPROVED`, triển khai ở Phase 2.
  - Nơi lưu bản sao ngoài máy chủ: CHƯA XÁC ĐỊNH.

### DEC-018 — Mỗi phase làm trên một branch riêng

- **Ngày:** 2026-09-24 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách
- **Nội dung:**
  - Mỗi phase làm trên branch `phase-N/<tên>`, mỗi bước một commit.
  - Người phụ trách duyệt xong thì merge vào `main`.
  - `main` luôn là trạng thái đã được duyệt.

### DEC-019 — Duyệt PROP-022, PROP-023 và merge Phase 1 vào `main`

- **Ngày:** 2026-09-26 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách ("làm hết" các việc được đề xuất)
- **Nội dung:**
  - Duyệt PROP-022 (`@types/node` tường minh) và PROP-023 (`.gitattributes` eol=lf).
  - Merge branch `phase-1/on-dinh-nen` vào `main`.
- **Hệ quả:**
  - Bước 6 của Phase 1 (chạy thật trên Discord) vẫn còn mở, vì chưa có bot và server test.
  - Nếu bước 6 phát hiện lỗi, sửa trên branch mới tách từ `main`.

### DEC-020 — Bot trả lời người dùng bằng tiếng Việt

- **Ngày:** 2026-09-26 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách (trả lời PEND-014)
- **Nội dung:**
  - Mọi nội dung bot hiển thị trên Discord (reply, embed, nút, mô tả command, option) viết bằng tiếng Việt.
  - Tên command và subcommand giữ ngắn gọn bằng tiếng Anh (ví dụ `/rank`, `/leaderboard`) để dễ gõ; tên option dùng tiếng Việt không dấu (ví dụ `thanh-vien`).

### DEC-021 — Hoàn thiện toàn bộ tính năng trước khi chạy thật

- **Ngày:** 2026-09-26 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách ("code hoàn thiện tất cả mọi tính năng tôi yêu cầu và thử nghiệm")
- **Nội dung:**
  - Làm Phase 2–10 liên tục trên một branch `phase-2-10/hoan-thien-tinh-nang`, commit theo từng phần. Kiểm chứng bằng test tự động.
  - Chạy bot thật sau khi có server Linux.
  - Duyệt các proposal kỹ thuật cần cho việc này: PROP-007, 009, 011, 013, 014, 018, 019.
- **Hệ quả:**
  - Ngoại lệ so với DEC-018 (mỗi phase một branch): gộp các phase vào một branch.
  - Người phụ trách review một lần trước khi merge vào `main`.

### DEC-022 — Công thức Activity XP và Level

- **Ngày:** 2026-09-26 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách (trả lời PEND-008)
- **Nội dung:**
  - Mỗi tin nhắn hợp lệ được một lượng XP cố định do admin đặt (mặc định **10**, có thể đặt riêng theo channel).
  - Cooldown mặc định **60 giây** mỗi người, admin chỉnh được, có thể đặt riêng theo channel.
  - Level: cần **5n² + 50n + 100** XP để lên từ level n lên level n+1 (level bắt đầu từ 0).

### DEC-023 — Chống spam bằng nội dung tin nhắn, không lưu nội dung

- **Ngày:** 2026-09-26 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách (trả lời PEND-006; duyệt PROP-015)
- **Nội dung:**
  - Bật intent `GuildMessages` và privileged intent `MessageContent`.
  - Tin nhắn không được XP nếu: quá ngắn (mặc định dưới **5** ký tự sau khi chuẩn hoá, admin chỉnh), hoặc trùng với tin trước đó của chính người đó trong một khoảng thời gian (mặc định **300 giây**, admin chỉnh), hoặc đang trong cooldown.
  - Tin chỉ có file đính kèm vẫn được xét (chỉ áp dụng cooldown).
  - Nội dung chỉ xử lý trong bộ nhớ; **không ghi nội dung hay hash vào database**.

### DEC-024 — Điểm team là tổng, tính theo team lúc kiếm điểm

- **Ngày:** 2026-09-26 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách (trả lời PEND-007 và phần team của PEND-008; duyệt PROP-016)
- **Nội dung:**
  - Mỗi lần phát sinh điểm (XP hoặc contribution), lưu kèm các role team người đó có tại thời điểm đó.
  - Điểm team là tổng điểm theo snapshot này; người có nhiều role team thì điểm tính cho mọi team đó.
  - Chỉ hiển thị team đang được cấu hình.
- **Hệ quả:** Không cần intent `GuildMembers`.

### DEC-025 — Quy tắc Contribution

- **Ngày:** 2026-09-26 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách (trả lời PEND-009; duyệt PROP-017)
- **Nội dung:**
  - Ai cũng gửi được contribution: qua `/contribution submit`, hoặc chuột phải vào một tin nhắn và chọn "Ghi nhận đóng góp" (điểm thuộc về tác giả tin nhắn).
  - Người khác bấm nút 👍 để ghi nhận. Mỗi người 1 lần mỗi contribution; không tự ghi nhận cho mình; bấm lại để rút.
  - Mỗi lượt ghi nhận cộng cho tác giả một số điểm do admin đặt (mặc định **1**).
  - Admin gỡ được contribution (điểm của nó bị huỷ) và điều chỉnh hoặc reset điểm; mọi thao tác ghi vào audit log.
- **Hệ quả:** Giới hạn số contribution mỗi ngày và thống kê vote qua lại (trong PROP-017) chưa làm.

### DEC-026 — Tính năng vote / bầu cử / lấy ý kiến

- **Ngày:** 2026-09-26 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách (yêu cầu tính năng mới và chọn quy tắc)
- **Nội dung:**
  - Admin, hoặc người có role được admin cấp quyền, tạo vote: câu hỏi + 2–10 lựa chọn, chọn 1 hoặc nhiều, thời hạn tự đóng (tuỳ chọn).
  - Phiếu **ẩn danh**: chỉ hiển thị số lượng. Được đổi phiếu tới khi vote đóng.
  - Người vote được XP **một lần** cho mỗi vote; XP cộng vào **Activity XP**.
  - XP mặc định do admin cấu hình (mặc định **5**). Admin đặt được XP riêng khi tạo vote; người tạo không phải admin chỉ dùng mức mặc định.
  - Người tạo vote hoặc admin đóng được vote.

### DEC-027 — Dữ liệu tách theo guild, reset không xoá dữ liệu

- **Ngày:** 2026-09-26 · **Trạng thái:** CHỐT · **Nguồn:** quyết định kỹ thuật trong phạm vi DEC-021 (trả lời PEND-010)
- **Nội dung:**
  - Mọi bảng đều có `guild_id`; cấu hình và điểm của từng guild độc lập.
  - Mọi biến động điểm lưu thành ledger append-only (PROP-014).
  - Reset hoặc gỡ không xoá dòng dữ liệu nào, chỉ đánh dấu `voided_at`, nên luôn truy vết được.

---

## Đang chờ quyết định

| Mã | Câu hỏi | Ảnh hưởng tới | Liên quan |
| --- | --- | --- | --- |
| PEND-004 | URL remote git nội bộ là gì, và khi nào publish? | Khi cần publish (hiện chưa cần, DEC-013) | CHƯA XÁC ĐỊNH |
| PEND-005 | Máy chủ Linux cụ thể (sẽ cấp ngày thứ 2) và process manager (đề xuất systemd) | Chạy thật, Phase 11 | DEC-016, PROP-018 |
| PEND-013 | Thời gian giữ ledger và audit log (tạm thời: giữ vĩnh viễn; không lưu nội dung tin nhắn theo DEC-023) | Vận hành lâu dài | PROP-014 |
| PEND-015 | Xác nhận ngữ nghĩa reset contribution. **Đang làm:** lượt ghi nhận đã bị admin reset không ghi nhận lại được (chống vượt reset); người chưa từng ghi nhận vẫn ghi nhận bình thường | Contribution | Review 2026-09-26 |
| PEND-016 | Điểm contribution có được âm không? | Contribution | PROP-024 |
| PEND-017 | Context menu "Ghi nhận đóng góp": dùng modal cho người ghi nhận tự viết tiêu đề? **Đang làm:** chỉ lưu link, tiêu đề cố định, không chép nội dung tin nhắn | Contribution | PROP-025 |
| PEND-018 | Snapshot team của lượt ghi nhận: lúc gửi (**đang làm**) hay lúc được ghi nhận | Điểm team | PROP-026 |
| PEND-019 | Ảnh kèm chữ ngắn có được XP không? | Activity XP | PROP-027 |
| PEND-020 | Có giới hạn XP từ vote (người tạo tự vote, số vote mỗi ngày) không? | Vote | PROP-028 |

**Đã giải quyết:** PEND-001, PEND-002 → DEC-014 · PEND-003 → DEC-015 · PEND-005 (một phần: OS, Node version) → DEC-016 · PEND-006 → DEC-023 · PEND-007 → DEC-024 · PEND-008 → DEC-022, DEC-024, DEC-025 · PEND-009 → DEC-025 · PEND-010 → DEC-027 · PEND-011, PEND-012 → DEC-021 · PEND-014 → DEC-020.
