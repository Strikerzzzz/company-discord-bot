# LESSONS LEARNED

> Bug, lỗi thiết kế và bài học quan trọng. Mỗi mục ghi rõ cách kiểm chứng để phiên sau không phải tìm lại từ đầu.
> Khi một lỗi đã được sửa: đổi "Trạng thái", giữ nguyên nội dung, vì bài học vẫn còn giá trị.

Format mỗi mục:

```
## LL-XXX — Tên
- Phát hiện / Mức độ / Trạng thái
- Hiện tượng / Nguyên nhân / Kiểm chứng / Bài học
```

---

## LL-001 — Lỗi trong command async làm sập toàn bộ process

- **Phát hiện:** 2026-09-24 (audit Phase 0) · **Mức độ:** Nghiêm trọng · **Trạng thái:** Đã sửa 2026-09-24 (PROP-003; lint `no-floating-promises` chặn tái phát, PROP-010)
- **Hiện tượng:** Bất kỳ exception nào trong `execute()` hay `executeButton()` của một command (ví dụ lỗi SQL) đều làm process Node thoát.
- **Nguyên nhân:**
  - `interactionCreate.ts` gọi `command.execute(interaction)` bên trong `try/catch` nhưng **không `await`**. Vì `execute` là hàm `async`, lỗi trở thành rejected promise mà không ai bắt.
  - `EventHandler` cũng bỏ qua promise do `event.execute()` trả về.
  - Từ Node 15, unhandled rejection mặc định làm process thoát.
  - TypeScript không cảnh báo, vì base class khai báo `execute(): void` và method trả về Promise vẫn tương thích với kiểu trả về `void`.
  - ESLint cũng không bắt được, vì config không dùng thông tin type.
- **Kiểm chứng:** Mô phỏng đúng pattern (base class có `execute()` đồng bộ, subclass `async` ném lỗi, gọi trong `try/catch` không có `await`) trên Node 22.12.0. Kết quả: khối `catch` không chạy, process thoát với exit code 1.
- **Bài học:**
  - Mọi Promise phải được `await` hoặc xử lý tường minh.
  - Handler async phải khai báo kiểu trả về `Promise<void>`.
  - Cần lint dùng thông tin type (`no-floating-promises`).
  - Cần lưới an toàn ở cấp process: `unhandledRejection` và `client.on("error")`.

## LL-002 — `resolveJsonModule` copy file chứa token vào `build/`

- **Phát hiện:** 2026-09-24 · **Mức độ:** Cao (security) · **Trạng thái:** Đã sửa 2026-09-24 (PROP-005: đọc từ env, bỏ `resolveJsonModule`; `build/` không còn file JSON)
- **Hiện tượng:** Sau khi `tsc` chạy, `build/config.json` chứa nguyên token. Sửa `src/config.json` không có tác dụng cho tới khi build lại. Thiếu `src/config.json` thì build fail.
- **Nguyên nhân:** `import { token } from "../config.json"` kết hợp với `resolveJsonModule: true` khiến `tsc` coi file JSON là module và emit nó vào `outDir`.
- **Kiểm chứng:** Build bản copy (bằng TS 5.5 để vượt qua LL-004): thư mục output có `config.json` giống hệt file nguồn.
- **Bài học:**
  - Không import file chứa secret như một module.
  - Secret phải được đọc lúc runtime từ environment.
  - `.gitignore` chỉ bảo vệ git, không bảo vệ build artifact.

## LL-003 — README của template không phản ánh đúng source code

- **Phát hiện:** 2026-09-24 · **Mức độ:** Trung bình · **Trạng thái:** Đã ghi nhận. Phase 1 đã sửa mục Configuration và Buttons; phần còn lại chờ PROP-019
- **Các điểm sai:**

  | README nói | Source code thực tế |
  | --- | --- |
  | Cần Node ≥ 16.9 | discord.js 14.18 yêu cầu Node ≥ 18 |
  | Comment `new Sqlite()` là tắt được SQLite | `ready.ts` vẫn gọi `Sqlite.setup()` |
  | `setup.sql` chạy "khi database start" | Chạy sau khi deploy command |
  | `/note` là "private" | Note dùng chung cho mọi user |
  | `npm run dev` chạy được | `ts-node` không được khai báo |

- **Bài học:** Luôn kiểm tra source code và chạy lệnh thật. Không suy luận từ README.

## LL-004 — Dải version `^` làm lockfile trôi, khiến TypeScript không đọc được type của discord.js

- **Phát hiện:** 2026-09-24 · **Mức độ:** Blocker · **Trạng thái:** Đã sửa 2026-09-24 (PROP-001: TypeScript 5.9.3)
- **Hiện tượng:** `npm run build` báo 97 lỗi, tất cả nằm trong `node_modules/discord.js/typings/index.d.ts`.
- **Nguyên nhân:**
  - `discord.js ^14.3.0` được resolve thành 14.18.0. File type của bản này dùng cú pháp `<const T>` của TypeScript 5.0.
  - Trong khi đó `typescript ^4.8.2` được resolve thành 4.9.5.
  - Đây là lỗi parse, nên `skipLibCheck` không giúp được.
  - Dùng TS 5.5 thì hết lỗi parse, nhưng còn 5 lỗi khác: 3 lỗi BigInt do `target: ES6`, 2 lỗi ở `note.ts` do `Statement.get()` trả về `unknown`.
- **Kiểm chứng:** Chạy `npm ci --ignore-scripts` rồi `npm run build` trên bản copy tại commit `cdce792`. Chạy thêm `npx -p typescript@5.5 tsc --noEmit` để so sánh.
- **Bài học:**
  - Kiểm tra version thực tế trong lockfile, không chỉ nhìn dải version trong `package.json`.
  - Khi nâng discord.js phải kiểm tra version TypeScript mà nó yêu cầu.

## LL-005 — Native module better-sqlite3 phụ thuộc Node ABI

- **Phát hiện:** 2026-09-24 · **Mức độ:** Blocker · **Trạng thái:** Đã sửa 2026-09-24 (PROP-002: better-sqlite3 13 kèm sẵn binary N-API; xem thêm LL-008, LL-009)
- **Hiện tượng:** `npm ci` fail trên Windows 11 + Node 22.12.0.
- **Nguyên nhân:**
  - `better-sqlite3@8.7.0` không có binary dựng sẵn cho Node 22 (log: `prebuild-install warn install No prebuilt binaries found (target=22.12.0 ...)`).
  - npm chuyển sang tự build bằng `node-gyp`, việc này cần Visual Studio Build Tools, mà máy không có.
- **Kiểm chứng:** Chạy `npm ci` và `npm rebuild better-sqlite3` trên bản copy.
- **Bài học:**
  - Version Node phải được cố định (`engines` hoặc tương đương) và khớp với version better-sqlite3 có binary dựng sẵn.
  - Nâng Node trên server production phải kiểm tra lại native module.
  - Install script tải file từ GitHub, nên máy không có internet ra ngoài sẽ cài không được.

## LL-006 — ESLint báo "No issues" không có nghĩa là code an toàn

- **Phát hiện:** 2026-09-24 · **Mức độ:** Trung bình · **Trạng thái:** Đã sửa 2026-09-24 (PROP-010: ESLint 10 + typescript-eslint recommendedTypeChecked). Ngay lần chạy đầu, lint mới đã bắt thêm lỗi cùng loại trong `ProcessManager`
- **Hiện tượng:** `npm run lint` báo 0 lỗi, trong khi code có lỗi nghiêm trọng LL-001.
- **Nguyên nhân:** `.eslintrc.cjs` không khai báo `parserOptions.project`, nên không dùng được các rule cần thông tin type như `@typescript-eslint/no-floating-promises`. Phần lớn rule hiện có chỉ là rule về style.
- **Bài học:** Không coi lint pass là bằng chứng về độ đúng của code.

## LL-007 — Khởi tạo database sai thứ tự và mở trùng connection

- **Phát hiện:** 2026-09-24 · **Mức độ:** Trung bình · **Trạng thái:** Đã sửa 2026-09-26 (PROP-007: một connection mở và migrate trong `index.ts` trước khi login; bỏ `Sqlite.ts`)
- **Hiện tượng:**
  1. `index.ts` gọi `new Sqlite()` trực tiếp. Instance này không được gán vào singleton `_instance`, nên lần gọi `Sqlite.prepare` hay `setup` đầu tiên lại tạo thêm một connection nữa. Kết quả: 2 connection, trong đó 1 connection không bao giờ được dùng hay đóng.
  2. `ready.ts` chạy `await deploy()` (network call) rồi mới `Sqlite.setup()`. Ở lần chạy đầu, trong khoảng chờ đó interaction có thể tới trước khi bảng tồn tại → lỗi "no such table" → sập bot (theo LL-001).
- **Bài học:**
  - Mở database và chạy migration **trước** khi login Discord.
  - Chỉ có một connection, và connection đó phải được inject vào nơi cần.
- **Ghi chú Phase 1:** Từ Phase 1, lỗi "no such table" không còn làm sập bot nhờ error boundary (LL-001). Người dùng chỉ nhận thông báo lỗi, nhưng thứ tự khởi tạo vẫn sai cho tới PROP-007.

## LL-008 — `npm ci` tự chạy `node-gyp rebuild` dù package khai báo `"gypfile": false`

- **Phát hiện:** 2026-09-24 (Phase 1) · **Mức độ:** Cao (chặn cài đặt trên server) · **Trạng thái:** Đã xử lý bằng `.npmrc` `ignore-scripts=true`
- **Hiện tượng:** Trong repo, `npm install` chạy bình thường; trên bản copy sạch, `npm ci` fail với `gyp ERR! Could not find any Visual Studio installation`.
- **Nguyên nhân:**
  - better-sqlite3 13 có file `binding.gyp` (để ai muốn thì tự build) nhưng khai báo `"gypfile": false` và kèm sẵn binary.
  - `npm install` đọc manifest đầy đủ nên tôn trọng khai báo này.
  - `package-lock.json` không lưu trường `gypfile`. Khi `npm ci` cài theo lockfile, npm thấy có `binding.gyp` mà không có install script, nên mặc định chạy `node-gyp rebuild`.
- **Kiểm chứng:** Chạy `git archive HEAD` sang thư mục tạm rồi `npm ci`: fail. Thêm `.npmrc` với `ignore-scripts=true`: `npm ci`, build, lint đều pass; module load được trên Node 22.23 và 24.21.
- **Bài học:**
  - Kết quả `npm install` trên máy dev không chứng minh được `npm ci` trên máy sạch; phải kiểm chứng bằng bản copy sạch.
  - Dự án không dựa vào install script (rule trong `CLAUDE.md`). Dependency mới nào thật sự cần install script phải được duyệt riêng.

## LL-009 — `engines` của better-sqlite3 13 ghi thiếu: cần N-API 10 (Node ≥ 22.14)

- **Phát hiện:** 2026-09-24 (Phase 1) · **Mức độ:** Cao · **Trạng thái:** Đã xử lý (máy dev lên Node 22.23.2; `engines` của dự án là `>=22.14.0`)
- **Hiện tượng:** Trên Node 22.12.0, chỉ cần load binary của better-sqlite3 13.0.3 là process **segfault** (exit 139), không có thông báo lỗi dễ hiểu.
- **Nguyên nhân:** `binding.gyp` build với `NAPI_VERSION=10`. N-API 10 chỉ có từ Node 22.14 / 23.6, trong khi `engines` của package ghi `>=22`.
- **Kiểm chứng:** Node 22.12.0 (N-API 9): segfault. Node 22.23.3 và 24.21.0 (N-API 10): chạy bình thường (chạy thử qua `npx -p node@<version>`).
- **Bài học:**
  - Không tin hoàn toàn vào `engines` của native module; phải chạy thử trên đúng version Node sẽ dùng.
  - Server production phải dùng Node ≥ 22.14; mục tiêu là Node 24 LTS (DEC-016).

## LL-010 — `tsc` không xoá file cũ trong `build/`, mà loader nạp mọi file trong thư mục

- **Phát hiện:** 2026-09-26 (Phase 2) · **Mức độ:** Cao · **Trạng thái:** Đã xử lý (`scripts/clean.cjs`)
- **Hiện tượng (dự đoán trước khi xảy ra):** Sau khi xoá `note.ts`, `clickme.ts`, `GetUserInfo.ts`, `Sqlite.ts`, các file `.js` tương ứng vẫn còn trong `build/`. Loader `require` mọi file trong `build/interactions/commands/`, nên sẽ nạp lại command đã xoá, và command đó `require` tới `Sqlite` không còn tồn tại, làm crash lúc khởi động.
- **Nguyên nhân:** `tsc` chỉ ghi đè hoặc thêm file, không bao giờ xoá output cũ. Cơ chế tự nạp theo thư mục khiến file rác trở thành code chạy thật.
- **Cách xử lý:** `npm run build` và `npm test` chạy `node scripts/clean.cjs <thư mục>` trước khi compile (không dùng pre-script được, vì `.npmrc ignore-scripts=true` tắt cả pre/post script).
- **Bài học:** Build phải luôn bắt đầu từ thư mục sạch. Khi deploy, luôn chạy `npm run build`, không copy chồng `build/` cũ.

## LL-011 — Agent chạy song song ngầm hiểu khác nhau về dữ liệu nằm ngoài interface

- **Phát hiện:** 2026-09-26 (tích hợp Phase 2–10) · **Mức độ:** Trung bình · **Trạng thái:** Đã sửa; có test chặn tái phát
- **Hiện tượng:** Giao diện `/admin audit` hiển thị target của `contribution.remove` thành `contribution #<id>`. Thực tế service ghi target là **tác giả** (user ID) và để mã contribution trong `details`. Nếu không sửa, audit sẽ hiện `contribution #300000000000000001`.
- **Nguyên nhân:** Interface TypeScript chỉ quy định kiểu (`targetId: string | null`), không quy định ý nghĩa. Agent làm giao diện và agent làm service làm cùng lúc, mỗi bên tự giả định. Test của mỗi bên chỉ dùng fake của chính mình nên đều pass.
- **Cách xử lý:** Sửa view cho khớp dữ liệu thật; thêm `test/audit-view.test.ts` dựng audit từ **service thật** rồi kiểm tra phần hiển thị.
- **Bài học:**
  - Khi chia việc song song, hợp đồng phải ghi cả **ý nghĩa** của từng trường (target là gì, details có key nào), không chỉ kiểu dữ liệu.
  - Luôn có test tích hợp chạy qua code thật của cả hai phía.

## LL-012 — Worktree của agent nằm trong thư mục repo bị git và ESLint quét

- **Phát hiện:** 2026-09-26 · **Mức độ:** Thấp · **Trạng thái:** Đã xử lý (ignore `.claude/worktrees/`)
- **Hiện tượng:**
  - `git status` hiện `.claude/` là untracked.
  - `eslint .` quét cả source trong các worktree, nên chạy rất chậm (một lượt lint + test mất hơn 3 phút) và có thể báo lỗi của code không thuộc branch hiện tại.
- **Bài học:** Khi dùng worktree cho agent, thêm thư mục worktree vào `.gitignore` và ignore của ESLint ngay từ đầu. Sau khi merge thì dọn worktree.

## LL-013 — Review độc lập tìm ra lỗi mà hàng trăm test không bắt được

- **Phát hiện:** 2026-09-26 (sau khi hoàn thiện Phase 2–10, 242 test pass) · **Mức độ:** Cao · **Trạng thái:** Đã sửa các lỗi đã xác nhận
- **Hiện tượng:** Ba agent review độc lập (đúng đắn/dữ liệu, Discord API, bảo mật) tìm ra các lỗi thật, trong khi toàn bộ test đều pass:
  - lộ nội dung contribution/vote của kênh riêng tư qua `/…view|list|results` (dò ID tăng dần);
  - context menu chép nội dung tin nhắn vào DB (vi phạm luật; lỗi nằm ngay trong spec giao cho agent);
  - admin reset điểm bị người dùng vượt qua bằng cách bấm ghi nhận 2 lần;
  - một tin nhắn ghi nhận được nhiều lần, nên điểm bị nhân lên;
  - bảng xếp hạng team quét toàn bộ event (200k event mất khoảng 1,1 s, bot đứng im, DoS);
  - thành viên đăng bài vào kênh chỉ đọc thông qua bot;
  - server lạ vẫn được tính XP.
- **Nguyên nhân:**
  - Test chỉ kiểm những gì người viết spec đã nghĩ tới; fake Discord luôn "đúng ý" người viết test.
  - Lỗi về quyền, lạm dụng và hiệu năng ở quy mô lớn nằm ngoài những gì spec mô tả.
- **Bài học:**
  - Với mọi thay đổi lớn, chạy review độc lập theo từng góc nhìn (đúng đắn, API bên ngoài, bảo mật/lạm dụng), yêu cầu reviewer **kiểm chứng** từng lỗi.
  - Spec giao việc phải được đối chiếu với luật trong `CLAUDE.md`, vì chính spec cũng có thể sai.
  - Mỗi lệnh đọc dữ liệu phải trả lời được câu hỏi: người gọi có quyền xem dữ liệu này không.

## LL-014 — Agent bị dừng khi phiên kết thúc: kiểm tra worktree trước khi giao lại

- **Phát hiện:** 2026-09-27 (Phase 12, agent vẽ ảnh) · **Mức độ:** Thấp · **Trạng thái:** Đã xử lý
- **Hiện tượng:** Phiên Claude Code kết thúc khi agent đang chạy nền. Harness báo agent "không hoàn thành", nhưng thực ra agent đã commit xong toàn bộ code, test và ảnh mẫu; chỉ chưa kịp gửi báo cáo.
- **Bài học:** Khi agent bị dừng, trước khi giao lại việc cho agent khác:
  - xem `git log` và `git status` trong worktree của agent đó;
  - chạy `npm run check` ngay trong worktree;
  - review nhanh phần code nhạy cảm, rồi mới gộp.
  Làm vậy tránh làm lại việc đã xong.

## LL-015 — SQLite: partial index `WHERE voided_at IS NULL` không được coi là index phủ; planner có thể chọn thứ tự join tệ

- **Phát hiện:** 2026-09-26 (Phase 12, bảng xếp hạng theo kỳ) · **Mức độ:** Trung bình · **Trạng thái:** Đã xử lý
- **Hiện tượng:**
  - Index `(guild_id, created_at, user_id, amount) WHERE voided_at IS NULL` vẫn phải đọc dòng bảng, trái với comment ban đầu. SQLite chỉ coi cột trong điều kiện partial là "đã biết" khi điều kiện có dạng `col = hằng` hoặc `col IS hằng`, không phải `IS NULL`.
  - Truy vấn team theo kỳ: planner tra `team_roles` trước snapshot, bảng team tháng mất khoảng 240 ms với 200k event.
- **Xử lý:**
  - Dùng `CROSS JOIN` để cố định thứ tự event → snapshot → team_roles, còn khoảng 56 ms.
  - Có thử index phủ thật (thêm `voided_at` vào index): chỉ nhanh hơn khoảng 10%, nên không đổi, chỉ sửa comment.
- **Bài học:**
  - Mọi truy vấn quét nhiều dòng phải có test hiệu năng với dữ liệu lớn và kiểm `EXPLAIN QUERY PLAN`.
  - Không ghi trong comment rằng index "chỉ cần đọc index" khi chưa kiểm chứng.

## LL-016 — Bash tool trên máy dev Windows làm mất dấu `\` cả trong heredoc

- **Phát hiện:** 2026-09-26 · **Mức độ:** Thấp · **Trạng thái:** Đã biết, có cách tránh
- **Hiện tượng:** Script Node viết ra file bằng heredoc `<<'EOF'` qua Bash tool bị mất một dấu `\`: `\\d` thành `\d`, `\\|` thành `\|` (chính đoạn này khi ghi bằng heredoc cũng bị mất dấu như vậy). Hậu quả là chuỗi neo không khớp, hoặc regex không hợp lệ. Hiện tượng giống lỗi của `node -e` đã ghi ở `CURRENT_STATE.md`.
- **Bài học:** Script có `\` (regex, escape) thì viết bằng công cụ Write/Edit, không qua heredoc. Script sửa file phải kiểm tra chuỗi neo và báo lỗi nếu không khớp, không được lặng lẽ bỏ qua.

## LL-017 — Hai tính năng đã duyệt, mỗi cái đúng một mình, ghép lại thì sai; và role tự gán là bề mặt leo thang quyền

- **Phát hiện:** 2026-09-27 (review độc lập Phase 12, lúc đó cả 556 test đều pass) · **Mức độ:** Cao · **Trạng thái:** Đã sửa các lỗi đã xác nhận; PROP-031 chờ quyết định
- **Hiện tượng:**
  - Event bù điểm (PROP-024) mang thời điểm hiện tại, nên bảng tuần/tháng (DEC-029) tính nó là "điểm kiếm được". Kết quả: người vừa bị gỡ contribution lại lên top Bảng vàng. Mỗi tính năng có test riêng đều pass.
  - Role cảnh giới (DEC-031) chỉ kiểm quyền của role, không kiểm vai trò của role trong bot (role admin bot, role tạo vote, role team), cũng không kiểm quyền của người gán. Người chỉ có role admin bot có thể biến mọi người thành admin bot, hoặc tự cấp role cho mình.
  - "Hạng của tôi" dò từng trang khi nhiều người bằng điểm, nên mất tới khoảng 7–10 giây và chặn event loop. Test dùng dữ liệu nhỏ nên không thấy.
  - Tên subcommand mới bằng tiếng Việt, trái DEC-020, do spec giao cho agent viết sai.
- **Bài học:**
  - Tính năng mới đọc ledger theo thời gian phải xét **mọi loại event**, kể cả event do hệ thống tự sinh (bù, điều chỉnh).
  - Tính năng để bot thay người dùng làm một việc cần quyền (gán role, đăng bài) phải kiểm tra **cả quyền của người gọi**, không chỉ quyền của bot. Đồng thời phải chặn xung đột với những vai trò khác của cùng đối tượng.
  - Test hiệu năng phải gồm trường hợp xấu nhất về phân bố dữ liệu (nhiều người bằng điểm), không chỉ tổng số dòng.
  - Spec giao việc phải đối chiếu với DECISIONS (quy tắc đặt tên, ngôn ngữ) trước khi giao.
