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

### DEC-035 — Duyệt Phase 14

- **Ngày:** 2026-09-27 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách ("duyệt vào main nhé")
- **Nội dung:** merge `phase-14/hoan-tat` vào `main` (fast-forward tới `3495946`). Toàn bộ code đã sẵn sàng cho lần chạy thật; việc tiếp theo là cài trên server Linux theo `docs/DEPLOY.md` và kiểm theo `docs/TEST-PLAN.md`.

### DEC-036 — Server chạy thật và process manager (trả lời PEND-005)

- **Ngày:** 2026-09-29 · **Trạng thái:** CHỐT (riêng phần Node: tạm thời) · **Nguồn:** IT cấp server theo yêu cầu của người phụ trách; bản Node do Claude chọn khi cài và đã báo người phụ trách
- **Nội dung:**
  - Bot chạy trên máy Linux nội bộ **dùng chung** `192.168.0.206` (Ubuntu 22.04.5, 6 vCPU, 11 GB RAM, systemd 249; trên máy còn dịch vụ khác của IT). Process manager là **systemd** với unit `deploy/company-discord-bot.service`, cài theo `docs/DEPLOY.md` mục 3–4 (code thuộc root trong `/opt/company-discord-bot`, `data/` thuộc user `discordbot`, `.env` root 600).
  - **Node:** dùng Node 22.23.2 có sẵn trên máy (gói nodesource, `/usr/bin/node`), đúng bản đã chạy toàn bộ test, thay vì cài thêm Node 24. Lý do: không đổi runtime dùng chung của máy, Node 22 vẫn được cập nhật bảo mật qua apt. Selfcheck báo ⚠️ là bình thường. Nâng lên Node 24 khi máy có sẵn Node 24 hoặc khi chuyển sang máy riêng (DEC-016 vẫn là mục tiêu).
  - **Cách đưa code lên:** chưa có remote git (DEC-013, PEND-004) nên chép bằng `git archive`, cài dependency, build và chạy `npm run check` trong thư mục staging của tài khoản quản trị, rồi mới chép sang `/opt/company-discord-bot` bằng script. Bản đang chạy ghi trong `/opt/company-discord-bot/REVISION`.
  - Lần chạy đầu 2026-09-29 với bản `38238e8`: 782/782 test pass trên chính server; selfcheck trong sandbox của service 12 ✅, 2 ⚠️ (Node 22, database chưa có), 0 ❌; bot đăng ký 8 command cho guild và báo sẵn sàng.
  - Lúc mời bot, người mời chưa có quyền Manage Roles ở server nên bot **chưa có Manage Roles**. Role danh hiệu chỉ hoạt động sau khi chủ server bật quyền này cho role của bot (DEPLOY mục 2, 7.1).

### DEC-037 — Bảng điều khiển cấu hình chung và chế độ "chỉ kênh được bật"

- **Ngày:** 2026-09-29 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách ("có làm giao diện cho nhiều phần setup nữa nhé", "đánh tất cả các kênh là không tính điểm, sau này thêm kênh nào thì kênh đấy có tính điểm"; chọn "Chỉ kênh admin bật")
- **Nội dung:**
  - Duyệt **PROP-033**: thêm `/config panel`, bảng điều khiển Components V2 cho các cấu hình còn lại (kênh tính XP, team, XP và chống spam, vote và contribution, Bảng vàng, role admin), mở được bảng danh hiệu. Các lệnh gõ tay giữ nguyên. Làm ở Phase 15, branch `phase-15/config-panel`.
  - **Chế độ kênh tính XP** (business rule mới, do người phụ trách quyết): mỗi server chọn một trong hai chế độ:
    - `all` ("tất cả kênh"): cách hiện tại. Mọi kênh bot xem được đều tính XP, trừ kênh admin tắt.
    - `selected` ("chỉ kênh được bật"): kênh chỉ tính XP khi admin bật riêng. Kênh chưa có cấu hình riêng, **kể cả kênh tạo mới sau này**, đều không tính XP.
  - Cấu hình riêng của một kênh (bật hay tắt, XP và cooldown riêng) luôn thắng chế độ. Xoá cấu hình riêng (`/config channel reset`) thì kênh theo chế độ. Tin trong thread và bài trong forum theo kênh cha, như trước.
  - Mặc định vẫn là `all`, để không đổi hành vi của server đang chạy khi cập nhật. Server ezOne sẽ chuyển sang `selected` sau khi cập nhật, và reset toàn bộ điểm bằng `/admin xp reset-all` và `/admin contribution reset-all`.
  - Schema: migration 5 thêm cột `guild_settings.xp_channel_mode` (`'all'` hoặc `'selected'`, mặc định `'all'`). Backup cũ khôi phục vào code mới thì tự migrate; code cũ gặp DB mới thì từ chối chạy, như mọi migration.

### DEC-038 — Duyệt Phase 15

- **Ngày:** 2026-09-29 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách ("1 duyệt")
- **Nội dung:** merge `phase-15/config-panel` vào `main` (fast-forward tới `bd03308`): `/config panel`, chế độ kênh tính XP, sửa lỗi của 2 review độc lập, script cài đặt `deploy/install.sh` và `deploy/start.sh`. PROP-034, 035, 036 vẫn PROPOSED (chưa trả lời).

### DEC-039 — Trang web quản trị (duyệt PROP-037, ngoại lệ luật protected số 2 và 3)

- **Ngày:** 2026-09-29 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách (chọn "Duyệt, làm trang web", "Chỉ mạng công ty/VPN", "Tài khoản Discord"; hỏi thêm "đăng nhập dùng chính cái đăng nhập discord luôn được không" → đúng là cách đã chọn)
- **Nội dung (ngoại lệ có phạm vi, không mở rộng sang dashboard hay server khác):**
  - Thêm trang web quản trị **chạy trong chính process của bot** (`node:http`, không thêm dependency), giữ topology 1 process + 1 SQLite. Tầng web `src/web/` ngang hàng tầng Discord, gọi đúng service như lệnh Discord.
  - **Chỉ mạng nội bộ công ty hoặc VPN.** Server `192.168.0.206` mở một cổng cấu hình được (`WEB_PORT`), không mở ra Internet. HTTP nội bộ; HTTPS khi IT cấp chứng chỉ. Không đặt `WEB_PORT` thì web tắt.
  - **Đăng nhập bằng tài khoản Discord** (OAuth2 authorization code, scope `identify`). Bot kiểm tra người đăng nhập có quyền admin bot trong server (Manage Server theo `member.permissions` hoặc role admin bot, giống lớp quyền 2), kiểm tra lại ở **mỗi request**. Không có mật khẩu riêng. Cần `DISCORD_CLIENT_SECRET` trong `.env` và redirect URL `<WEB_BASE_URL>/auth/callback` trên Developer Portal.
  - Phiên đăng nhập lưu **trong bộ nhớ** (khởi động lại bot thì đăng nhập lại), nên không thêm bảng. Cookie HttpOnly, SameSite=Lax. Có chống CSRF, kiểm tra Host/Origin, security header (CSP), giới hạn tần suất ở các đường dẫn chưa đăng nhập.
  - Network call mới chỉ tới Discord (OAuth2 token, `users/@me`), vẫn trong luật "chỉ gọi Discord API".
  - Trang: tổng quan; kênh (toàn bộ kênh, không giới hạn 25); team; cài đặt điểm (XP, vote, contribution); quyền (role admin, role tạo vote); Bảng vàng; danh hiệu (bộ, tên bậc, role); nhật ký quản trị. Mọi thao tác ghi audit với người thao tác là tài khoản Discord đã đăng nhập.
  - Làm ở Phase 16, branch `phase-16/web-admin`, có review bảo mật riêng trước khi merge.

### DEC-040 — Duyệt Phase 16

- **Ngày:** 2026-09-29 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách ("1 duyệt")
- **Nội dung:**
  - merge `phase-16/web-admin` vào `main` (fast-forward tới `1f35bee`): trang web quản trị 8 trang, sửa lỗi của 2 review độc lập (LL-022), 939 test pass trên bản sạch ở server Linux;
  - bản cài lên server gồm cả Phase 15 và Phase 16;
  - bật web cần: biến `WEB_*` và `DISCORD_CLIENT_SECRET` trong `.env`, redirect trên Developer Portal, luật `ufw` mở cổng 8787 trong mạng nội bộ.
  - PROP-034, 035, 036 vẫn PROPOSED.

### DEC-041 — Mọi tính năng đều phải quản lý được trên trang web quản trị

- **Ngày:** 2026-09-30 · **Trạng thái:** CHỐT (rule); phần làm bù cho tính năng cũ là Phase 17, chờ duyệt kế hoạch · **Nguồn:** người phụ trách ("đảm bảo cho tôi 1 rule là mọi tính năng mới thêm và cả tính năng cũ đều phải có giao diện quản lý ở cái con web view chúng ta đang có nhé")
- **Nội dung:**
  - **Rule thường trực** (chi tiết ở `CLAUDE.md`, mục "Quy tắc trang web quản trị"):
    - mọi việc admin làm được trên Discord đều phải làm được trên trang web quản trị, cùng quy tắc, dùng chung service và hàm trong `src/discord/`;
    - tính năng mới chỉ xong khi có trang web kèm test;
    - thao tác của thành viên gắn với Discord không bắt buộc có trên web, nhưng phần quản lý của nó thì bắt buộc.
  - **Phạm vi ngoại lệ DEC-039:** thêm trang nằm trong ngoại lệ đã duyệt. Hạ tầng (cùng process), phạm vi mạng (chỉ nội bộ hoặc VPN) và cách đăng nhập (Discord, kiểm quyền mỗi request) giữ nguyên. Mở rộng những thứ đó vẫn cần proposal mới. Luật protected số 2 trong `CLAUDE.md` đã ghi thêm câu này.
  - **Kiểm tra tự động:** `test/web-parity.test.ts` xếp loại từng subcommand và context menu (có trên web / chỉ có trên Discord kèm lý do / còn thiếu), kèm danh sách option lúc xếp loại. Lệnh, subcommand hay option mới chưa được xếp loại thì `npm run check` fail. Mục "còn thiếu" chỉ được là 17 mục có từ lúc chốt, và chỉ được bớt đi.
  - **Kiểm kê lúc chốt (2026-09-30):**
    - Đã có trên web: toàn bộ `/config` (Phase 16) và `/admin audit`.
    - Chỉ có trên Discord, vì là thao tác của thành viên: `/contribution submit`, context menu "Ghi nhận đóng góp", `/poll create`, `/rank`, `/ping`.
    - Còn thiếu (làm ở Phase 17):
      - `/admin xp view|give|remove|reset|reset-all`;
      - `/admin contribution adjust|remove|reset|reset-all`;
      - `/admin stats`, `/admin backup`;
      - `/contribution view|list`;
      - `/poll close|results|list`;
      - `/leaderboard`.

### DEC-042 — Duyệt Phase 17: web quản trị đủ tính năng

- **Ngày:** 2026-09-30 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách ("1 oke có", "2 tạo vote bằng lệnh trên discord và có thể quản lý lịch sử trên web cũng được", "duyệt làm hết đi nhé")
- **Nội dung:**
  - Làm bù 17 mục còn thiếu của DEC-041 trên branch `phase-17/web-full`: nền móng, 3 agent song song, 2 review độc lập (bảo mật; tính đúng đắn). Merge vào `main` vẫn chờ duyệt ở cuối phase.
  - **Được chỉnh và reset điểm trên web** như lệnh `/admin`:
    - cộng/trừ/reset XP và điểm contribution của một người;
    - reset toàn server, phải gõ `XAC NHAN` như lệnh;
    - mọi thao tác ghi audit với người đăng nhập.
  - **Vote vẫn chỉ tạo bằng lệnh `/poll create`** trong Discord. Web quản lý lịch sử vote: danh sách (mở/đóng), kết quả, đóng vote. Phiếu vẫn ẩn danh (DEC-026).
  - Các trang mới:
    - Thành viên: tìm theo tên hoặc ID, hồ sơ, chỉnh điểm;
    - Bảng xếp hạng: 12 bảng dạng bảng;
    - Contribution: danh sách, chi tiết, gỡ;
    - Vote;
    - Thống kê;
    - Reset điểm;
    - Sao lưu: tạo bản sao lưu, xem danh sách. **Không tải file database qua web**, vì file chứa dữ liệu của mọi thành viên.
  - Quy tắc dùng chung đặt ở `src/discord/adminOps.ts`; lệnh `/admin` cũng chuyển sang dùng nó.
  - Web chỉ chỉnh điểm cho tài khoản Discord thật và không phải bot, như option `thanh-vien` của lệnh.
  - Mục trong kênh mà admin đăng nhập không xem được: giấu tiêu đề, câu hỏi và tên kênh. Chi tiết vote thì báo "không tìm thấy", như `/poll results`. Contribution vẫn gỡ được, như `/admin contribution remove` (lệnh này không kiểm tra kênh).

### DEC-043 — Kênh nhận thông báo lên level

- **Ngày:** 2026-09-30 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách ("tin nhắn tăng level cần có chỗ setup là các tin nhắn thông báo như này thì nó sẽ thông báo cụ thể vào kênh nào - hiện tại thì tôi mong muốn nó sẽ thông báo chỉ vào kênh #🤖bot-commands", "phải có chỗ setup cho tôi đó nhé"; kèm ảnh bot chúc mừng lên level ngay trong thread công việc)
- **Nội dung (business rule do người phụ trách quyết):**
  - Admin chọn **một kênh nhận thông báo lên level và lên bậc**. Đã chọn thì bot **chỉ** gửi vào kênh đó, không gửi vào kênh hay thread thành viên vừa nhắn.
  - Kênh đã chọn bị xoá hoặc bot mất quyền gửi tin thì bot bỏ qua thông báo và ghi cảnh báo vào log; **không** gửi về kênh vừa nhắn.
  - Chưa chọn (mặc định) thì như trước: gửi ở kênh vừa nhắn. Thiết lập "thông báo lên level" bật/tắt giữ nguyên, và tắt thì không gửi ở đâu cả.
  - Chỉ nhận kênh văn bản hoặc kênh thông báo. Người đặt phải tự xem và gửi được tin ở kênh đó (LL-013); bot cần View Channel và Send Messages.
  - Nơi đặt:
    - web, trang Cài đặt điểm;
    - lệnh `/config xp kenh-thong-bao:<kênh>` (bỏ bằng `bo-kenh-thong-bao:True`);
    - `/config view` và `/config panel` hiện kênh đang đặt.
  - Schema: migration 6 thêm cột `guild_settings.level_up_channel_id` (NULL = kênh vừa nhắn). Backup cũ khôi phục vào code mới thì tự migrate; code cũ gặp DB mới thì từ chối chạy, như mọi migration.
  - Server ezOne sẽ đặt kênh `#🤖bot-commands` sau khi cập nhật.

### DEC-044 — Phase 18: chọn tất cả, nhiều role quyền, bộ danh hiệu Mobile Legends

- **Ngày:** 2026-09-30 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách ("các cái ô checkbox thì cần có ô chọn tất cả nữa nhé", "ô chọn quyền cho chọn nhiều nhiều nhé", "thêm 1 bộ level rank mới như cái ảnh tôi gửi", "bộ kia rank trong Mobile Legends nhé"; kèm ảnh trang Team, trang Quyền và 8 huy hiệu rank)
- **Nội dung:**
  - **Chọn tất cả / bỏ chọn tất cả** cho bảng ô tick trên web (trang Team, Kênh tính XP, bảng role của trang Quyền):
    - làm bằng link `?chon=tat-ca|bo-het`: trang vẽ lại với mọi ô đã tick hoặc bỏ tick; bot chưa lưu gì cho tới khi admin bấm Lưu;
    - **ngoại lệ, theo review bảo mật Phase 18:**
      - bảng role admin bot không có "Chọn tất cả": một cú bấm rồi Lưu sẽ biến mọi role, kể cả role team, thành admin bot;
      - mỗi lần lưu có thêm role admin phải tick ô xác nhận "toàn quyền quản trị bot";
    - không thêm JavaScript: CSP của web vẫn cấm script (DEC-039).
  - **Nhiều role admin bot và nhiều role được tạo vote** (quy tắc quyền do người phụ trách quyết):
    - mỗi loại tối đa 25 role;
    - có **một** role trong danh sách admin là admin bot, như có quyền Manage Server; có một role trong danh sách tạo vote là tạo được vote;
    - mỗi role vẫn qua các kiểm tra cũ: không phải @everyone, role do integration quản lý hay role danh hiệu.
    - Schema: migration 7, bảng `guild_role_grants`, chép giá trị cũ sang; hai cột cũ `admin_role_id` và `poll_creator_role_id` về NULL, không dùng nữa.
    - Nơi đổi:
      - lệnh `/config admin-role them|bo|bo-het`;
      - lệnh `/config poll role-tao-vote|bo-role-tao-vote|xoa-role-tao-vote`;
      - `/config panel`: menu chọn nhiều role;
      - web, trang Quyền: bảng ô tick.
  - **Bộ danh hiệu thứ 6 "Mobile Legends"** (khoá `mobile-legends`):
    - 8 bậc cùng mốc level như các bộ khác. Tên và màu theo bảng người phụ trách gửi sau đó (thay cho tên tiếng Anh ban đầu):
      - Đấu Sĩ (Warrior) #B06A3B, Tinh Anh (Elite) #8A9BB0, Cao Thủ (Master) #E3A62B, Đại Cao Thủ (Grandmaster) #4FB3D9;
      - Sử Thi (Epic) #22A79A, Huyền Thoại (Legend) #E5842A, Thần Thoại (Mythic) #B84BD6, Vinh Quang (Mythical Glory) #7B3FE4 viền #E0364B;
      - mỗi bậc có màu chữ riêng trên nền màu bậc (`Tier.textColor`); bậc 8 có viền (`Tier.borderColor`);
      - tên tiếng Anh nằm trong câu lên bậc và mô tả bộ;
    - huy hiệu trên ảnh thẻ do bot tự vẽ bằng canvas, theo màu và hình gợi ý của rank. Không dùng ảnh huy hiệu gốc của game (bản quyền);
    - chọn được ở mọi nơi như các bộ khác (web, `/config tier style`, bảng danh hiệu).
  - Làm trên branch `phase-18/quick-wins` (tách từ Phase 17), có review trước khi merge.

### DEC-045 — Trang Kênh tính XP hiện mọi kênh cho admin bot

- **Ngày:** 2026-09-30 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách ("cái chỗ chọn kênh tăng exp ấy -> hiển thị tất cả các kênh cho người có quyền quản trị ra nhé, chứ tôi vào 1 số kênh bị ẩn đi thì sao tôi quản trị đc")
- **Nội dung:**
  - Trang **Kênh tính XP** trên web hiện và cho sửa **mọi kênh** tính XP được, kể cả kênh riêng tư mà tài khoản đăng nhập không xem được trên Discord. Các kênh đó có nhãn 🔒 và một dòng ghi chú.
  - Quyết định này thay cho quy tắc của review bảo mật Phase 16 ("trang kênh ẩn và không cho sửa các kênh người đăng nhập không xem được"), **chỉ ở trang Kênh tính XP**.
  - Các nơi khác vẫn giữ quy tắc riêng tư: flash, tổng quan, nhật ký, Bảng vàng, ô chọn kênh thông báo, contribution, vote.
  - Người vào được web luôn là admin bot (Manage Server hoặc role admin bot, DEC-039).

### DEC-046 — Merge Phase 17 vào main và cài lên server

- **Ngày:** 2026-09-30 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách ("chạy lại 2 lượt rồi vào main rồi lên server lên")
- **Nội dung:**
  - 2 review độc lập (bảo mật; tính đúng đắn và API Discord) chạy lại trên `1af1eaa..3a6a126`. Kết quả: không có lỗi CAO; review đúng đắn có 4 lỗi TRUNG BÌNH, 2 review có tổng cộng 10 lỗi THẤP.
  - Đã sửa ở `18a4ce8`, gồm:
    - chống gửi trùng (bấm đúp);
    - khoá sao lưu;
    - lõi `channelAccess` dùng chung cho lệnh và web;
    - form XP phải chọn Cộng/Trừ;
    - snowflake không vượt giới hạn 64 bit;
    - cảnh báo kênh thông báo có giới hạn tần suất;
    - thêm test.
  - Còn lại ghi vào PROP-038 (mở rộng): nhật ký hiện câu hỏi vote và tiêu đề contribution ở kênh riêng tư.
  - Merge `phase-17/web-full` vào `main` rồi cài lên server `192.168.0.206` (có migration 6: sao lưu trước khi cài).

### DEC-047 — Mỗi thành viên tự chọn bộ danh hiệu hiển thị; nút "?" giải thích trên thẻ /rank

- **Ngày:** 2026-09-30 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách ("1 người có thể custom lại hiển thị rank theo ý muốn sở thích cá nhân, kiểu người thì rank liên minh, người thì cây cỏ"; "Thêm 1 nút ? vào bên trên góc phải của ô thông báo rank để dẫn qua trang giải thích các metrics và cách để cày chúng"; trả lời đề xuất: "a được, b được, c có, oke trang giải thích theo như bạn")
- **Nội dung:**
  - **Bộ danh hiệu cá nhân:**
    - thành viên tự chọn một trong các bộ danh hiệu để hiển thị cho **chính mình**;
    - chỉ đổi **thẻ `/rank` và lời chúc lên level/lên bậc của người đó** (a);
    - **role Discord, bảng xếp hạng và Bảng vàng vẫn theo bộ chung của server** (b);
    - admin có công tắc "cho phép thành viên tự chọn" trên web, **mặc định bật** (c); tắt thì mọi người hiển thị theo bộ chung, lựa chọn đã lưu vẫn giữ;
    - admin xem và xoá lựa chọn của từng người trên trang Thành viên (DEC-041).
  - **Nút "?" trên thẻ `/rank`:**
    - nút ở góc trên bên phải phần trả lời `/rank` (giao diện Components V2 của Discord);
    - bấm vào thì bot gửi **tin nhắn giải thích chỉ người bấm thấy**: cách được XP (theo cấu hình hiện tại của server: XP mỗi tin, cooldown, độ dài tối thiểu, chống trùng, kênh tính XP), level, các bậc của bộ đang hiển thị, chuỗi ngày, huy hiệu, contribution, vote, bảng tuần/tháng;
    - không dùng trang web: thành viên thường không vào được web quản trị (DEC-039).
  - Làm ở Phase 18, sau khi gộp phần nhiều role quyền (migration 7) và bộ Mobile Legends.
  - Schema: migration 8.
    - Bảng `member_tier_prefs (guild_id, user_id, set_key, updated_at)`.
    - Công tắc đặt ở cột `tier_set_config.allow_personal` (mặc định 1, thuộc TierSetService), không đặt ở `guild_settings`: các cột của `guild_settings` không có giá trị mặc định, và `updateSettings` ghi lại cả dòng.
  - Công tắc tắt: thành viên vẫn chọn lại được "theo server"; chọn một bộ khác thì bị từ chối.
  - Lệnh `/rank-style bo:<…>`, audit `tier_pref.allow`, `tier_pref.clear`.
  - Nút ❓ có customId `rankhelp:show`.

### DEC-048 — Merge Phase 18 vào main và cài lên server

- **Ngày:** 2026-09-30 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách ("duyệt nhé")
- **Nội dung:**
  - Merge `phase-18/quick-wins` vào `main`: chọn tất cả, nhiều role quyền (migration 7), bộ Mobile Legends, trang Kênh tính XP hiện mọi kênh (DEC-045), bộ danh hiệu cá nhân và nút ❓ (migration 8).
  - 3 review độc lập không có lỗi CAO. Lỗi TRUNG BÌNH đã sửa: bảng role admin bỏ "Chọn tất cả" và bắt tick xác nhận; nút ❓ chỉ nêu kênh người bấm xem được.
  - Kiểm thử: 1094/1095 test trên Windows, 1095/1095 trên server Linux.
  - Cài lên `192.168.0.206`: sao lưu trước, vì có migration 7 và 8.

### DEC-049 — Phase 19: Retro sprint theo team, tự ghi vào Confluence (duyệt PROP-039, ngoại lệ luật protected số 3)

- **Ngày:** 2026-09-30 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách (gửi trang "2026/09/18 Retrospective - Pms Sprint 24"; "mỗi team sẽ có kênh riêng và mỗi team sẽ họp retro riêng… kiểm soát linh hoạt trong cái đoạn chat thread đó của team đó"; "phải tự ghi vào confluence ấy - chấp nhận tích hợp thêm tool"; trả lời 6 điểm: 1 chấp nhận, 2 ghi tên cho admin theo dõi còn doc và Discord ẩn danh, 3 lưu theo phiên rồi xoá theo admin điều phối, 4 có cộng XP, 5 tham gia vote tên được XP như thường và người đề xuất tên thắng được cộng nhiều XP, 6 ghi vào Confluence)
- **Nội dung:**
  - **Phiên retro theo team:**
    - mỗi phiên gắn với một kênh hoặc thread của team, là nơi chạy `/retro create`, và tuỳ chọn một role team (DEC-024);
    - có role team thì chỉ người có role đó điền được; không có thì ai xem được kênh cũng điền được;
    - mọi thứ của phiên diễn ra trong thread hoặc kênh đó: nút điền, số người đã điền, bảng tổng hợp, vote tên sprint, công bố tên thắng.
  - **Tạo phiên:** bằng `/retro create` trong kênh hoặc thread của team, hoặc trên web (chọn kênh/thread). Người tạo phải là admin bot hoặc có role quản lý retro, và phải gửi được tin ở kênh đó.
  - **Người quản lý phiên:**
    - admin bot, người tạo phiên, và role "quản lý retro" (tối đa 25 role, đặt trên web);
    - trong thread họ làm được: đóng, mở lại, gia hạn, nhắc người chưa điền, tạo vote tên, ghi lại vào Confluence.
  - **Form điền:**
    - modal đúng 5 ô theo 5 cột của mẫu Confluence: Learned, Thiếu sót, Sáng tạo, Tuyên dương, Đặt tên sprint;
    - ô trống được, mỗi người một phiếu, sửa được tới khi đóng;
    - tên sprint chỉ toàn số bị từ chối, theo luật của mẫu: "cấm đặt tên Sprint là số".
  - **Ẩn danh:**
    - database lưu người điền để **admin bot** theo dõi (web và `/retro status`): chỉ danh sách ai đã điền, không ghép với nội dung; người quản lý retro không phải admin chỉ thấy số lượng;
    - nội dung chỉ hiện trên web và Confluence khi phiên đã đóng, để không ghép được tên người vừa điền với ý vừa thêm. Nhật ký không ghi mã phiếu;
    - bot không đếm được ai chưa điền: không có intent GuildMembers; `/retro remind` ping role team;
    - bảng trên Discord và trên Confluence không có tên người viết.
  - **Lưu nội dung** (quyết định đầu tiên cho phép lưu chữ người dùng viết):
    - câu trả lời lưu theo phiên;
    - admin xoá nội dung một phiên trên web (xoá hẳn chữ, giữ thông tin phiên và XP đã cộng). Đây là ngoại lệ có chủ ý của DEC-027, vì là dữ liệu riêng tư, không phải điểm.
  - **XP** (admin chỉnh trên web; ghi qua `xpLedger` với nguồn `admin`, người thao tác là bot, lý do "Retro …"):
    - điền retro: cộng một lần mỗi phiên, mặc định 20 XP;
    - tham gia vote tên sprint: như vote thường;
    - người đề xuất tên thắng: mặc định 100 XP. Nhiều người cùng đề xuất tên đó thì mỗi người đều được.
    - Vote hoà: người quản lý chọn tên cuối cùng trong các tên hoà.
  - **Vote tên sprint:**
    - người quản lý bấm tạo sau buổi họp;
    - bot gom cột "Đặt tên sprint": bỏ trùng (không phân biệt hoa thường, dấu cách), bỏ tên chỉ toàn số;
    - tạo vote bằng hệ thống vote hiện có, mỗi người chọn 1 tên, hạn mặc định 24 giờ;
    - nhiều hơn 10 tên thì người quản lý chọn danh sách rút gọn trên web.
  - **Confluence** (ngoại lệ luật protected số 3, chỉ trong phạm vi này):
    - bot gọi REST API của Confluence nội bộ tại `CONFLUENCE_BASE_URL`, xác thực bằng `CONFLUENCE_TOKEN` (Personal Access Token, header Bearer);
    - khi đóng phiên (và khi người quản lý bấm "ghi lại"), bot ghi vào **một khu vực riêng ở cuối trang** đã gắn, không chèn vào bảng người khác đang sửa. Khu vực gồm:
      - macro anchor đầu và cuối;
      - tiêu đề "🤖 Retro từ Discord: <tên phiên>";
      - bảng 5 cột đúng như mẫu, không có tên. **Mỗi cột trộn riêng** bằng khoá ngẫu nhiên, nên một hàng không phải câu trả lời của một người (review bảo mật Phase 19). Cột tên sprint là các tên đã bỏ trùng, xếp theo chữ cái;
      - dòng "🏆 Tên sprint được chọn" khi đã chốt;
    - ghi lại thì thay đúng khu vực đó, không ghi trùng; mất dấu kết thúc thì báo lỗi, không đoán;
    - web có nút xuất chữ của khu vực này để dán tay, dùng khi server chưa vào được Confluence;
    - **chỉ ghi khi phiên đã đóng**, và chỉ vào trang thuộc space trong `CONFLUENCE_SPACE_KEYS` (danh sách rỗng thì từ chối ghi). Lý do: tránh bot bị dùng để sửa trang bất kỳ mà token có quyền;
    - nội dung không đổi thì không ghi; ghi tay tối đa một lần mỗi 30 giây cho mỗi phiên;
    - chỉ nhận link trang cùng host với `CONFLUENCE_BASE_URL`, để không gửi token sang nơi khác;
    - không thêm dependency (dùng `fetch` có sẵn); lỗi được ghi lại và hiện trên web để thử lại;
    - không đặt `CONFLUENCE_*` thì mọi phần khác của retro vẫn chạy, chỉ bỏ bước ghi Confluence.
  - **Token:**
    - người phụ trách nhập trên server bằng script `deploy/enable-confluence.sh` (hỏi ẩn, ghi vào `.env` root 600);
    - không gửi token qua chat hay commit;
    - nên dùng token của tài khoản dùng riêng cho bot, chỉ có quyền sửa các trang retro.
    - Token cá nhân đã gửi trong chat ngày 2026-09-30 cần được thu hồi.
  - **Web** (DEC-041): trang Retro gồm:
    - danh sách phiên và trạng thái;
    - chi tiết phiên, ai đã điền (chỉ admin thấy) và nội dung ẩn danh;
    - xoá ý không phù hợp, chọn danh sách tên rút gọn, tạo vote, ghi lại vào Confluence, xoá nội dung phiên;
    - cài đặt XP retro và role quản lý retro.
  - Phase 19, branch `phase-19/retro`. Schema là migration 9 (`retro_*`); bảng `xp_events` không đổi.

### DEC-050 — Chống cày XP retro; merge Phase 19 vào main

- **Ngày:** 2026-10-01 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách ("có thưởng tên chiến thắng và có điền retro sẽ được exp, giới hạn như bạn đề ra thôi"; trước đó hỏi "đủ điều kiện để lên code mới chưa")
- **Nội dung:**
  - **Chống cày XP retro** (quy tắc tính điểm, review bảo mật và đúng đắn Phase 19 chỉ ra role quản lý retro tự cày được khoảng 120 XP mỗi vòng):
    - a. Người đề xuất tên thắng chỉ được thưởng khi tên đó thắng một **vote thật**: ít nhất 2 lựa chọn (`MIN_BONUS_VOTE_OPTIONS`) và ít nhất 3 người bỏ phiếu (`MIN_BONUS_VOTERS`). Vote thật bị hoà rồi người quản lý chọn thì vẫn thưởng; chốt tay tên duy nhất (không có vote) thì không thưởng.
    - b. XP điền retro: mỗi người **tối đa một lần mỗi ngày** giờ Việt Nam, tính chung mọi phiên của server. Phiếu thứ hai trong ngày vẫn được lưu nhưng không cộng XP; người điền được báo lý do.
  - Merge `phase-19/retro` vào `main` và cài lên server (migration 9: sao lưu trước).
  - Confluence: server chưa vào được `docs.ezcloud.vn` (thiếu route 10.19.193.0/24 qua VPN). Người phụ trách xin IT; trong lúc chờ, dùng phần xuất chữ trên web.

### DEC-051 — Contribution: kênh riêng, duyệt trước khi mở ghi nhận, nút "Không ghi nhận", XP cho người bấm (duyệt PROP-040)

- **Ngày:** 2026-10-01 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách (yêu cầu "Contribution phải được ghi nhận và phải có kênh được chỉ định… phải được duyệt thì mới được mở cho mọi người vote", "có nút không ghi nhận… hệ thống công bằng"; trả lời PROP-040 "1 oke, 2 B, 3 được (người có quyền vẫn duyệt được bài của chính mình), 4 oke, 5 a, 6 oke, 7 người tương tác cũng được điểm"; chọn cả 4 phương án đề xuất ở câu hỏi bổ sung)
- **Nội dung** (thay DEC-025 ở những điểm dưới đây):
  - **Kênh Contribution:**
    - admin chọn trên web (trang Cài đặt điểm) hoặc bằng `/config contribution`;
    - thành viên gửi từ bất kỳ đâu (`/contribution submit`, chuột phải "Ghi nhận đóng góp"), nhưng thẻ luôn được đăng ở kênh này; người gửi nhận trả lời riêng kèm link;
    - chưa chọn kênh thì không gửi được, bot báo cần admin chọn kênh;
    - người gửi phải xem được kênh Contribution; bot cần View Channel, Send Messages, Embed Links ở kênh đó (kiểm tra khi admin chọn kênh và khi gửi).
  - **Duyệt, phương án B (một kênh):**
    - contribution mới ở trạng thái **chờ duyệt**: thẻ công khai ghi "⏳ Chờ duyệt", kèm nút ✅ Duyệt và ❌ Từ chối;
    - chỉ người duyệt bấm được (kiểm tra quyền trong code mỗi lần bấm); duyệt xong thẻ mới mở nút 👍/👎;
    - web có danh sách "Chờ duyệt", duyệt và từ chối được (DEC-041).
  - **Người duyệt:**
    - admin bot, và các role "duyệt contribution" (nhiều role, tối đa 25) do admin chọn trên trang Quyền hoặc bằng `/config contribution`;
    - người duyệt **được duyệt cả bài của chính mình** (người phụ trách chọn); audit ghi người duyệt.
  - **Từ chối:**
    - bắt buộc ghi lý do (tối đa 300 ký tự);
    - thẻ đổi thành "❌ Không được duyệt", **lý do không hiện công khai**, chỉ gửi cho tác giả và hiện cho admin trên web;
    - contribution bị từ chối không tính điểm; gửi lại được dưới dạng contribution mới (kể cả từ cùng tin nhắn nguồn).
  - **👍 Ghi nhận / 👎 Không ghi nhận** (phương án a):
    - mỗi người chọn **một** trong hai cho mỗi contribution, đổi hoặc rút được; không bấm cho contribution mà mình là tác giả;
    - 👎 bắt buộc ghi lý do (tối đa 200 ký tự);
    - công khai chỉ hiện số lượng; danh sách người bấm và lý do chỉ admin (web) và người duyệt (`/contribution view`) xem được;
    - **điểm của một contribution = max(0, tổng 👍 − tổng 👎)**, mỗi lượt có giá trị bằng "Điểm mỗi lượt ghi nhận" (`contributionVotePoints`) lúc bấm; 👎 không trừ sang điểm của contribution khác. Cách ghi: mỗi lượt một event (👍 dương, 👎 âm), cộng các event "sàn" (nguồn `vote`, không có actor, `reference_id` = contribution) ghi **phần chênh lệch** mỗi khi phần âm đổi, để tổng event sàn còn hiệu lực luôn bằng max(0, −tổng các lượt). Ghi chênh lệch (không huỷ rồi ghi lại cả phần sàn) để bị 👎 không bao giờ làm điểm kỳ hiện tại tăng (review Phase 20);
    - giữ PROP-024 (tổng của tác giả không âm) và PROP-031: thao tác làm giảm điểm (rút 👍, thêm hoặc đổi sang 👎) mà phải bù vì tác giả đang bị trừ điểm thì lượt đó bị **khoá**, không đổi hay rút được nữa. Lượt có event đã bị admin reset cũng bị khoá như trước.
  - **XP cho người bấm** (người phụ trách: "kích thích mọi người tương tác"):
    - mỗi người được **+5 Activity XP** (`contributionInteractionXp`, 0–100) một lần cho mỗi contribution, bấm 👍 hay 👎 như nhau;
    - đổi 👍↔👎 giữ XP; rút hẳn thì thu lại XP; bấm lại sau khi rút thì được lại đúng phần đã thu (nếu còn hạn mức ngày);
    - tối đa **25 XP mỗi ngày** giờ Việt Nam từ contribution (`contributionInteractionXpDailyCap`, 0 = không giới hạn); phần bị cắt không được cộng bù, XP đã bị admin reset cũng không lấy lại được bằng cách rút rồi bấm lại;
    - admin gỡ contribution thì người bấm vẫn giữ XP đã nhận; rút 👍 mà bị khoá (PROP-031) thì người bấm cũng giữ XP (không bấm lại được, không bị phạt thay tác giả);
    - lượt 👍 có từ trước Phase 20 coi như đã tương tác, **không được XP người bấm** (kể cả rút rồi bấm lại), để không thành cách cày XP trên contribution cũ (review Phase 20, cùng tinh thần DEC-050);
    - XP ghi vào `xpLedger` nguồn `admin`, actor là bot, `reference_id` = `contribution:<id>`, như XP retro (DEC-049); không đổi CHECK của `xp_events`;
    - điểm contribution vẫn tách khỏi XP (DEC-004): XP người bấm là Activity XP như tham gia vote, không phải điểm contribution.
  - **Điểm cho tác giả mỗi lượt:** vẫn là `contributionVotePoints` (mặc định 1). Người phụ trách nêu ví dụ 2 điểm: chỉnh trên web, không đổi mặc định trong code.
  - **Thông báo:** bot chỉ nhắn riêng (DM) cho tác giả, và người gửi nếu khác tác giả, khi contribution **được duyệt** và khi **bị từ chối** (kèm lý do). Không nhắn theo từng lượt 👍/👎. Người tắt DM thì bỏ qua, không báo lỗi.
  - **Contribution cũ** (trước migration 10): coi như đã duyệt, giữ ở kênh cũ, ghi nhận được như trước.
  - Contribution chờ duyệt hoặc bị từ chối không bấm 👍/👎 được; admin vẫn gỡ được.
  - Contribution từ chuột phải "Ghi nhận đóng góp": tiêu đề không nêu tên kênh nguồn nếu `@everyone` không xem được kênh đó (thẻ nằm ở kênh Contribution công khai).
  - **Đăng lại thẻ** (trang web, chi tiết contribution): khi thẻ đăng lỗi lúc gửi hoặc bị xoá tay, admin đăng lại thẻ vào kênh contribution đang chọn (thẻ cũ nếu còn bị xoá); chỉ cho bài chờ duyệt hoặc đã duyệt, còn hiệu lực.
  - **Hệ quả đã biết** (review Phase 20): tổng điểm luôn đúng, nhưng bảng tuần/tháng có thể lệch khi một lượt của kỳ trước bị rút hoặc đổi (event của kỳ trước bị huỷ, như rút ghi nhận trước Phase 20). Trường hợp hiếm: bài đang 0 điểm, đổi lượt 👍 của kỳ trước sang 👎 có thể làm điểm kỳ này của tác giả nhích lên tối đa bằng điểm của lượt 👍 đó. Chấp nhận; sửa triệt để cần ghi event đảo thay cho huỷ, ảnh hưởng toàn bộ ledger contribution.
  - Schema: migration 10 (cột duyệt của `contributions`, bảng `contribution_downvotes`, bảng `contribution_interaction_xp` có `revoked_at`, ba cột cấu hình mới, thêm loại `contribution_reviewer` cho `guild_role_grants`). Triển khai ở Phase 20, branch `phase-20/contribution-review`.

### DEC-052 — Merge Phase 20 vào main và cài lên server

- **Ngày:** 2026-10-02 · **Trạng thái:** CHỐT · **Nguồn:** người phụ trách ("duyệt nhét và kết nối tới máy chủ rồi", trả lời bản tổng kết Phase 20 có 4 điểm AI tự quyết)
- **Nội dung:**
  - Merge `phase-20/contribution-review` vào `main` và cài lên server (migration 10: bấm sao lưu trên web hoặc `/admin backup` trước khi cài).
  - Đồng ý 4 điểm AI tự quyết sau review (đã ghi trong DEC-051): lượt 👍 trước Phase 20 không được XP người bấm; rút 👍 bị khoá thì người bấm giữ XP; lý do từ chối không ghi vào nhật ký quản trị; chấp nhận độ lệch hiếm của bảng tuần/tháng khi lượt kỳ trước bị đổi.
  - PROP-041 (giới hạn số contribution mỗi ngày) vẫn PROPOSED.
  - Confluence: lần chạy `enable-confluence.sh` ngày 2026-10-01 không ghi gì (script cần địa chỉ Confluence làm tham số, hướng dẫn trước đó thiếu tham số); chạy lại `sudo bash ~/deploy/enable-confluence.sh https://docs.ezcloud.vn` cùng lần cài này.

---

## Đang chờ quyết định

| Mã | Câu hỏi | Ảnh hưởng tới | Liên quan |
| --- | --- | --- | --- |
| PEND-004 | URL remote git nội bộ là gì, và khi nào publish? | Khi cần publish (hiện chưa cần, DEC-013) | CHƯA XÁC ĐỊNH |
| PEND-013 | Thời gian giữ ledger và audit log (tạm thời: giữ vĩnh viễn; không lưu nội dung tin nhắn theo DEC-023) | Vận hành lâu dài | PROP-014 |

**Đã giải quyết:** PEND-001, PEND-002 → DEC-014 · PEND-003 → DEC-015 · PEND-005 → DEC-016, DEC-036 · PEND-006 → DEC-023 · PEND-007 → DEC-024 · PEND-008 → DEC-022, DEC-024, DEC-025 · PEND-009 → DEC-025 · PEND-010 → DEC-027 · PEND-011, PEND-012 → DEC-021 · PEND-014 → DEC-020 · PEND-015, PEND-016, PEND-017, PEND-018, PEND-020 → DEC-028 · PEND-019, PEND-021 → DEC-032.
