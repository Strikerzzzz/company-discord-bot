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
  - Riêng điểm của lượt ghi nhận contribution: dùng snapshot team của tác giả **lúc gửi** contribution, không phải lúc được ghi nhận (DEC-028, PROP-026).
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

### DEC-028 — Merge Phase 2–10; trả lời PEND-015 → PEND-020

- **Ngày:** 2026-09-26 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách ("duyệt tất cả vào main", trả lời 6 câu hỏi nghiệp vụ)
- **Nội dung:**
  - Merge `phase-2-10/hoan-thien-tinh-nang` vào `main` (fast-forward tới `cd007d0`).
  - PEND-015: giữ như đang làm. Lượt ghi nhận đã bị admin reset thì không ghi nhận lại được.
  - PEND-016 (PROP-024, phương án a): điểm contribution không bao giờ âm. Rút ghi nhận hoặc gỡ contribution làm tổng âm thì bot tự ghi một event bù (nguồn `admin`, `actor_id` null, `reference_id` null, lý do tự động) trong cùng transaction để tổng về 0. Event bù dùng snapshot team của contribution.
  - PEND-017 (PROP-025): giữ tiêu đề cố định cho context menu "Ghi nhận đóng góp" (người phụ trách trả lời "cũng oke"; AI hiểu là đồng ý với cách đang làm).
  - PEND-018 (PROP-026, phương án a): điểm của lượt ghi nhận tính cho team của tác giả **lúc gửi** contribution.
  - PEND-019: đã xác nhận ảnh kèm chữ giải thích (từ 5 ký tự trở lên sau chuẩn hoá, không trùng) được XP. Riêng ảnh kèm chữ quá ngắn vẫn giữ như cũ (không được XP); PROP-027 còn mở.
  - PEND-020 (PROP-028): admin đặt giới hạn **XP tối đa một người nhận từ vote trong một ngày** (giờ Việt Nam), cấu hình `pollXpDailyCap`, **mặc định 25**, 0 = không giới hạn. Vượt mức thì vẫn bỏ phiếu được, chỉ không được cộng thêm XP; phần XP bị cắt không được cộng bù về sau.
- **Hệ quả đã biết** (review 2026-09-27):
  - Hạn mức vote trong ngày tính theo XP vote còn hiệu lực, nên admin reset XP của một người thì hạn mức hôm đó của người đó cũng được trả lại.
  - Rút ghi nhận rồi ghi nhận lại có thể xoá một phần hình phạt của admin; đã chặn theo DEC-032 (PROP-031).

### DEC-029 — Gamification: cảnh giới tu tiên, chuỗi ngày, huy hiệu, bảng xếp hạng theo kỳ

- **Ngày:** 2026-09-26 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách (chọn phong cách "Tu tiên" và các tính năng thêm)
- **Nội dung:**
  - **Ngày, tuần, tháng** tính theo giờ Việt Nam (UTC+7). Tuần bắt đầu 00:00 thứ Hai (`src/shared/time.ts`).
  - **Cảnh giới** chỉ để hiển thị, không đổi công thức XP hay level (DEC-022). Mốc level: Luyện Khí 0, Trúc Cơ 3, Kim Đan 6, Nguyên Anh 10, Hóa Thần 15, Luyện Hư 20, Hợp Thể 30, Độ Kiếp 40 (`src/modules/activity/tiers.ts`). Lên cảnh giới mới thì có thông báo "đột phá" riêng.
  - **Chuỗi ngày hoạt động:** số ngày liên tiếp có ít nhất một tin nhắn được Activity XP. Hôm nay chưa nhắn thì chuỗi chưa mất; bỏ trọn một ngày thì về 0. Tính lại từ ledger (event `message` chưa huỷ), nên reset XP cũng xoá chuỗi. Chỉ hiển thị, không cộng XP.
  - **Huy hiệu:** 15 huy hiệu (`src/modules/gamification/achievements.ts`), tính lại từ dữ liệu còn hiệu lực mỗi lần xem. Chỉ hiển thị, không cộng điểm.
  - **Bảng xếp hạng theo kỳ** (PROP-020): tổng, tuần này, tháng này, cho cả Activity/Contribution × cá nhân/team. Điểm kỳ là tổng các event chưa huỷ phát sinh trong kỳ; không làm mất điểm tổng.
  - Làm rõ sau review 2026-09-27: người phụ trách chọn bảng kỳ "tính theo XP/điểm **kiếm được** trong kỳ". Vì vậy event bù tự động của PROP-024 (`source = 'admin'`, `actor_id` null) **không** tính vào bảng kỳ. Nếu tính, người vừa bị gỡ contribution (tổng bằng 0) sẽ lên top tuần/tháng và Bảng vàng.

### DEC-030 — Giao diện bằng ảnh thẻ, Bảng vàng, nút chuyển trang

- **Ngày:** 2026-09-26 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách (chọn "Ảnh thẻ rank như MEE6", phương án ghi rõ là thêm dependency)
- **Nội dung:**
  - `/rank` và `/leaderboard` trả về **ảnh PNG** do bot vẽ.
  - Thêm dependency `@napi-rs/canvas` **1.0.9** (pin chính xác; MIT; binary dựng sẵn cho từng nền tảng qua optionalDependencies; không có install script, nên chạy được với `ignore-scripts=true`). Đây là ngoại lệ đã duyệt của luật protected #7.
  - Font **Be Vietnam Pro** (SIL OFL 1.1) nằm trong `assets/fonts/`, kèm `OFL.txt`. Ảnh không vẽ emoji; emoji nằm ở phần chữ của tin nhắn.
  - **Tải avatar từ CDN của Discord** để vẽ lên ảnh. Đây là ngoại lệ có kiểm soát của nguyên tắc "chỉ gọi Discord API": chỉ chấp nhận host `cdn.discordapp.com` qua HTTPS (sau review 2026-09-27: bỏ `media.discordapp.net` vì không dùng tới và host này phục vụ file người dùng tải lên), chỉ ảnh PNG/JPEG/WebP (không GIF), có timeout, giới hạn dung lượng và cache trong bộ nhớ. Không gọi host nào khác.
  - **Bảng vàng:** admin chọn một channel, bot giữ ở đó một message bảng xếp hạng dạng ảnh và tự cập nhật định kỳ.
  - Bảng xếp hạng có **nút** chuyển loại điểm, phạm vi, kỳ và trang (PROP-029).
  - Bot cần thêm quyền **Attach Files**.
  - Sau review 2026-09-27: vẽ ảnh có cooldown 3 giây mỗi người và tối đa 2 lần vẽ đồng thời, để một người spam không làm bot đứng.

### DEC-031 — Tự gán role Discord theo cảnh giới

- **Ngày:** 2026-09-26 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách (chọn "Tự gán role theo danh hiệu", phương án ghi rõ cần quyền Manage Roles)
- **Nội dung:**
  - Admin gán role cho từng cảnh giới bằng `/config`. Lên hoặc xuống cảnh giới thì bot thêm role của cảnh giới hiện tại và bỏ role của các cảnh giới khác (mỗi người chỉ giữ một role cảnh giới).
  - Bot cần thêm quyền **Manage Roles** (nới least privilege đã được duyệt). Role của bot phải nằm trên các role cảnh giới.
  - Không cho gán role nguy hiểm: `@everyone`, role do integration quản lý, role có quyền quản trị/kiểm duyệt (Administrator, Manage Server, Manage Roles, Manage Channels, Kick/Ban, Manage Messages, Mention Everyone, Manage Webhooks, Moderate Members...), và role không thấp hơn role cao nhất của bot.
  - Đồng bộ role khi thành viên có tin nhắn được XP. Bot không đọc danh sách thành viên, vì không dùng intent `GuildMembers`.
- **Bổ sung sau review độc lập** (2026-09-27, sửa lỗi bảo mật; không nới quyền):
  - Role cảnh giới không được trùng role admin bot, role tạo vote hay role team, và ngược lại. Kiểm tra cả hai chiều.
  - Người gán role cảnh giới phải có Manage Roles, và role phải thấp hơn role cao nhất của họ (trừ chủ server). Đây đúng là phép kiểm tra Discord áp cho người thường khi gán role, nên bot không thành đường vòng để tự cấp role.
  - Không nhận role có quyền nguy hiểm ở cấp server **hoặc** qua permission overwrite của bất kỳ kênh nào. Danh sách quyền nguy hiểm thêm Pin Messages, Bypass Slowmode, View Server Insights.
  - Tên lệnh theo DEC-020: `/config tier set-role|clear-role|list`, `/config board`.
  - Bổ sung sau review Phase 13: không nhận role bật "cho phép mọi người @mention", vì role danh hiệu bậc thấp gần như ai cũng có. Danh sách quyền nguy hiểm thêm Create Expressions, Create Events, View Creator Monetization Analytics.

### DEC-032 — Duyệt Phase 12; chặn xoá hình phạt; giữ nguyên quy tắc ảnh kèm chữ ngắn

- **Ngày:** 2026-09-27 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách ("1 duyệt / 2 oke theo bạn đi / 3 oke")
- **Nội dung:**
  - Duyệt và merge `phase-12/gamification` vào `main`.
  - PEND-021 (PROP-031, phương án a): nếu một lượt rút ghi nhận làm phát sinh điểm bù (tác giả đang bị admin trừ điểm), người rút **không ghi nhận lại** được contribution đó. Bot giữ dòng vote với event đã huỷ, giống lượt đã bị reset (PEND-015). Phản hồi khi rút có báo rõ lý do. Lượt rút không phải bù thì vẫn ghi nhận lại bình thường.
  - PEND-019 (PROP-027): người phụ trách trả lời "oke" cho câu hỏi kèm ghi chú "hiện là không"; AI hiểu là **giữ nguyên**. Ảnh kèm chữ quá ngắn (dưới 5 ký tự sau chuẩn hoá) không được XP; ảnh không kèm chữ hoặc ảnh kèm chữ từ 5 ký tự trở lên thì được.

### DEC-033 — Bộ danh hiệu chọn được, bot tự tạo role, bảng điều khiển trực quan

- **Ngày:** 2026-09-27 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách (muốn hệ thống danh hiệu "có lựa chọn chứ không cứng"; chọn thêm 4 bộ, cho đổi tên từng bậc, bot tự tạo/đổi tên role, "giao diện gán role trực quan")
- **Nội dung:**
  - **5 bộ có sẵn:** Tu tiên (mặc định), Rank game (Đồng → Thách Đấu), Kiếm hiệp (Tân Thủ → Võ Lâm Minh Chủ), Cây xanh (Hạt Giống → Đại Thụ Ngàn Năm), Vũ trụ (Thiên Thạch → Vũ Trụ). Dữ liệu nằm ở `src/modules/activity/tiers.ts`.
  - Mọi bộ có **8 bậc cùng mốc level** 0/3/6/10/15/20/30/40. Bậc là vị trí dùng chung (`bac-1` … `bac-8`), nên đổi bộ không làm mất role đã gán theo bậc. Chỉ để hiển thị, không đổi công thức XP/level (DEC-022).
  - Mỗi guild chọn một bộ. Admin đổi được **tên và emoji** từng bậc (tối đa 32 ký tự, không chứa ký tự định dạng hay mention). Tên tuỳ chỉnh lưu theo từng bộ, nên đổi qua lại không mất. Màu và mốc level luôn theo bộ.
  - Mỗi bộ có **giọng văn riêng**: thông báo lên level, thông báo lên bậc, chữ trên ảnh thẻ.
  - **Bot tự tạo role** (không có quyền gì, màu theo bậc) cho bậc chưa gán role, và **đổi tên/màu** role đã gán sang bộ đang dùng. Bot chỉ đụng role cảnh giới đã qua kiểm tra an toàn (DEC-031) và thấp hơn role của bot. Người thao tác phải có Manage Roles.
  - **Bảng điều khiển** `/config tier panel` (chỉ admin, trả lời riêng): menu chọn bộ, 8 ô chọn role (mỗi bậc một ô, điền sẵn role hiện tại), nút đổi tên bậc (form), nút tạo/đồng bộ role, nút khôi phục tên mặc định. Mọi thao tác kiểm tra quyền như lệnh gõ tay.
  - Component (nút, menu, form) của lệnh admin được kiểm tra quyền admin ở dispatcher, giống lệnh gõ (lớp quyền 2).
  - Hai huy hiệu mang tên tu tiên đổi sang tên trung tính cho hợp mọi bộ: "Bế Quan Tu Luyện" → "Chuyên Cần", "Bách Nhật Trúc Cơ" → "Bách Nhật Bền Bỉ".
- **Hệ quả:** migration 4 (khoá bậc mới, `tier_roles.created_by_bot`, `tier_set_config`, `tier_name_overrides`); audit mới `tier_set.set`, `tier_name.set`, `tier_name.reset`, `tier_role.setup`.
- **Bổ sung sau review độc lập** (2026-09-27, sửa lỗi bảo mật/hiển thị; không nới quyền):
  - Nút tạo/đồng bộ role **chỉ tự đổi tên/màu role do bot tạo**. Role do admin tự gán thì giữ nguyên tên, bot chỉ báo lại, để không lặng lẽ đổi tên một role có sẵn.
  - Bỏ gán một role do bot tạo thì bot **xoá role đó**, nếu người thao tác có Manage Roles. Nhờ vậy không tích tụ role mồ côi.
  - Tên bậc không được chứa link hay invite, ký tự vô hình hoặc giả chữ, hay chuỗi dấu kết hợp (Zalgo). Tối đa 32 ký tự và 48 đơn vị UTF-16. Emoji phải là một emoji Unicode chuẩn (RGI). Thông báo công khai tắt xem trước link.
  - Bậc đã đổi tên thì thông báo lên bậc dùng vế trung tính "vượt mốc Level N" thay cho vế có tên mặc định, để câu không tự mâu thuẫn.

### DEC-034 — Duyệt Phase 13; giữ quyền đổi role admin cho role admin bot; hoàn tất việc còn lại trước khi chạy thật

- **Ngày:** 2026-09-27 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách ("1 duyệt / 2 role admin bot cũng được mà, tôi chỉ có role đấy, cứ để thế đi / còn việc gì không, nếu còn làm hết đi nhé")
- **Nội dung:**
  - Duyệt và merge `phase-13/tier-sets` vào `main`.
  - PROP-032 **không làm**: người có role admin bot tiếp tục dùng được `/config admin-role`. Người phụ trách chính là người chỉ có role admin bot, nên hạn chế này sẽ khoá chính họ.
  - "Làm hết việc còn lại" (Phase 14, branch `phase-14/hoan-tat`), gồm:
    - PROP-030: đưa riêng XP hoặc cooldown của một channel về giá trị chung.
    - Ảnh bảng Contribution và bảng team trang trí theo bộ danh hiệu của guild, như bảng Activity (DEC-033).
    - Lệnh tự kiểm tra môi trường `npm run selfcheck` để chạy trên server trước khi bật bot, không kết nối Discord.
    - Checklist chạy thật trên Discord (`docs/TEST-PLAN.md`).

---

## Đang chờ quyết định

| Mã | Câu hỏi | Ảnh hưởng tới | Liên quan |
| --- | --- | --- | --- |
| PEND-004 | URL remote git nội bộ là gì, và khi nào publish? | Khi cần publish (hiện chưa cần, DEC-013) | CHƯA XÁC ĐỊNH |
| PEND-005 | Máy chủ Linux cụ thể (sẽ cấp ngày thứ 2) và process manager (đề xuất systemd) | Chạy thật, Phase 11 | DEC-016, PROP-018 |
| PEND-013 | Thời gian giữ ledger và audit log (tạm thời: giữ vĩnh viễn; không lưu nội dung tin nhắn theo DEC-023) | Vận hành lâu dài | PROP-014 |

**Đã giải quyết:** PEND-001, PEND-002 → DEC-014 · PEND-003 → DEC-015 · PEND-005 (một phần: OS, Node version) → DEC-016 · PEND-006 → DEC-023 · PEND-007 → DEC-024 · PEND-008 → DEC-022, DEC-024, DEC-025 · PEND-009 → DEC-025 · PEND-010 → DEC-027 · PEND-011, PEND-012 → DEC-021 · PEND-014 → DEC-020 · PEND-015, PEND-016, PEND-017, PEND-018, PEND-020 → DEC-028 · PEND-019, PEND-021 → DEC-032.
