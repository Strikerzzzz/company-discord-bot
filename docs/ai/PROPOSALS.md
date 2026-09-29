# PROPOSALS

> Các đề xuất do AI hoặc thành viên team phát hiện nhưng **chưa được duyệt**.
> Chỉ triển khai khi người có quyền quyết định chuyển trạng thái sang `APPROVED`. AI không tự duyệt.
> Khi một proposal được duyệt: ghi quyết định vào `DECISIONS.md`. Khi đã triển khai xong: đổi trạng thái sang `IMPLEMENTED` và ghi ngày.

**Trạng thái hợp lệ:** `PROPOSED` · `APPROVED` · `REJECTED` · `IMPLEMENTED` · `DEFERRED`

## Mục lục

| Mã | Tên | Ưu tiên | Trạng thái |
| --- | --- | --- | --- |
| PROP-001 | Nâng toolchain TypeScript và tsconfig | HIGH (blocker) | IMPLEMENTED |
| PROP-002 | Nâng better-sqlite3 và cố định Node runtime | HIGH (blocker) | IMPLEMENTED |
| PROP-003 | Error boundary và xử lý async đúng | HIGH (blocker) | IMPLEMENTED |
| PROP-004 | Cập nhật dependency runtime, bỏ dependency trùng | HIGH | IMPLEMENTED |
| PROP-005 | Quản lý secret bằng environment variable | HIGH | IMPLEMENTED |
| PROP-006 | Tách git khỏi repo upstream public | MEDIUM | IMPLEMENTED (2026-09-24) |
| PROP-007 | Nền tảng database | HIGH | IMPLEMENTED |
| PROP-008 | Backup và restore SQLite | MEDIUM | IMPLEMENTED |
| PROP-009 | Chiến lược test không thêm dependency | MEDIUM | IMPLEMENTED |
| PROP-010 | ESLint dùng thông tin type | MEDIUM | IMPLEMENTED |
| PROP-011 | Cấu trúc module mục tiêu và composition root | HIGH | IMPLEMENTED |
| PROP-012 | Hardening tầng Discord | MEDIUM | IMPLEMENTED |
| PROP-013 | Phân quyền admin hai lớp và audit log | HIGH | IMPLEMENTED |
| PROP-014 | Sổ cái (ledger) cho mọi biến động điểm | MEDIUM | IMPLEMENTED |
| PROP-015 | Anti-spam không lưu nội dung tin nhắn | MEDIUM | IMPLEMENTED |
| PROP-016 | Snapshot team tại thời điểm ghi điểm | MEDIUM | IMPLEMENTED |
| PROP-017 | Chống gian lận vote contribution | MEDIUM | IMPLEMENTED |
| PROP-018 | Vận hành: logging tối giản và graceful shutdown | LOW | IMPLEMENTED |
| PROP-019 | Dọn code demo và viết lại README | LOW | IMPLEMENTED |
| PROP-020 | Leaderboard theo kỳ | LOW | IMPLEMENTED |
| PROP-021 | Metadata `package.json` của dự án | MEDIUM | IMPLEMENTED |
| PROP-022 | Khai báo `@types/node` tường minh | LOW | IMPLEMENTED |
| PROP-023 | Cố định line ending bằng `.gitattributes` | LOW | IMPLEMENTED |
| PROP-024 | Không để điểm contribution âm khi rút ghi nhận / gỡ sau khi admin đã trừ | MEDIUM | IMPLEMENTED |
| PROP-025 | Ghi nhận đóng góp qua modal (người ghi nhận tự viết tiêu đề, mô tả) | MEDIUM | DEFERRED |
| PROP-026 | Snapshot team của lượt ghi nhận: lúc gửi hay lúc được ghi nhận | LOW | IMPLEMENTED |
| PROP-027 | Tin có chữ ngắn kèm file đính kèm | LOW | REJECTED |
| PROP-028 | Giới hạn XP từ vote (người tạo tự vote, giới hạn mỗi ngày) | LOW | IMPLEMENTED |
| PROP-029 | Nút chuyển trang cho bảng xếp hạng | LOW | IMPLEMENTED |
| PROP-030 | Đưa riêng từng giá trị của channel về mặc định | LOW | IMPLEMENTED |
| PROP-031 | Rút rồi ghi nhận lại không được xoá hình phạt của admin | MEDIUM | IMPLEMENTED |
| PROP-032 | `/config admin-role` chỉ người có Manage Server đặt được | MEDIUM | REJECTED |
| PROP-033 | Bảng điều khiển cấu hình chung `/config panel` | MEDIUM | APPROVED |

---

## PROP-001 — Nâng toolchain TypeScript và tsconfig

### Vấn đề

`npm run build` fail với 97 lỗi, vì TypeScript 4.9.5 không đọc được file type của discord.js 14.18. Dùng TS 5.5 thì còn 5 lỗi: `target: ES6` không hỗ trợ BigInt, và `note.ts` gán `unknown` vào `Note` (LL-004).

### Đề xuất

- Nâng `typescript` lên 5.x (discord.js được build bằng `~5.5`).
- Đổi `target` sang `ES2022`, thêm `include: ["src"]`.
- Cân nhắc thêm `noImplicitOverride` và `noFallthroughCasesInSwitch`.
- Sửa tối thiểu 2 lỗi type ở `note.ts`, hoặc xoá file này nếu PROP-019 được duyệt cùng lúc.

### Lý do

Chưa build được thì không thể làm gì tiếp.

### Tác động

- **Code:** `package.json` (devDependency), `tsconfig.json`, `note.ts`.
- **Database:** Không.
- **Security:** Không.
- **Performance:** Không đáng kể; target cao hơn cho output gọn hơn.
- **UX:** Không.
- **Infrastructure:** Không.

### Độ ưu tiên

HIGH (blocker)

### Rủi ro

`@typescript-eslint` v5 không chính thức hỗ trợ TS 5.5, lint sẽ hiện cảnh báo. Cần xử lý cùng PROP-010.

### Trạng thái

IMPLEMENTED (2026-09-24, Phase 1). TypeScript 5.9.3, target ES2022, include, noImplicitOverride, noFallthroughCasesInSwitch.

---

## PROP-002 — Nâng better-sqlite3 và cố định Node runtime

### Vấn đề

`better-sqlite3@8.7.0` không có binary dựng sẵn cho Node 22, nên `npm ci` fail nếu máy không có C++ build tools (LL-005). Repo cũng không khai báo cần Node version nào.

### Đề xuất

- Nâng `better-sqlite3` (cùng `@types/better-sqlite3`) lên major mới nhất có binary dựng sẵn cho Node LTS mà production sẽ dùng.
- Khai báo `engines.node` trong `package.json`.
- Version Node cụ thể phụ thuộc PEND-005.

### Lý do

Giúp cài đặt lặp lại được trên máy dev và máy production, không cần bộ công cụ build C++.

### Tác động

- **Code:** `package.json`, lockfile. API của better-sqlite3 gần như không đổi giữa các major (cần đọc changelog khi nâng).
- **Database:** Không đổi format file.
- **Security:** Có lợi: bỏ được `tar-fs` bản lỗi nếu `prebuild-install` mới dùng bản đã vá.
- **Performance:** Không.
- **UX:** Không.
- **Infrastructure:** Không còn cần build tools. Install script vẫn tải binary từ GitHub.

### Độ ưu tiên

HIGH (blocker)

### Rủi ro

Nếu server production không có internet ra ngoài, vẫn phải chuẩn bị binary thủ công.

### Trạng thái

IMPLEMENTED (2026-09-24, Phase 1). better-sqlite3 13.0.3 (kèm sẵn binary N-API 10), engines >=22.14.0; xem LL-008, LL-009.

---

## PROP-003 — Error boundary và xử lý async đúng

### Vấn đề

Mọi lỗi trong command hay event đều làm sập process (LL-001). Bất kỳ user nào gây ra lỗi cũng làm bot ngừng hoạt động, tương đương một cuộc tấn công DoS.

### Đề xuất

- `await` mọi lời gọi `execute` / `executeButton` / `autocomplete` trong dispatcher.
- Tạo một error boundary chung trong `interactionCreate`: log lỗi; nếu đã reply hoặc defer thì dùng `followUp`, ngược lại dùng `reply`.
- `EventHandler` bắt lỗi từ promise của mọi event.
- Chuyển base class sang `abstract` với kiểu trả về `Promise<void>`.
- Thêm `process.on("unhandledRejection")` (chỉ log) và `client.on("error")`.
- Await `login()`, await deploy cho từng guild.

### Lý do

Đây là lỗi runtime rõ ràng, có ảnh hưởng tới security (khả năng sẵn sàng của bot).

### Tác động

- **Code:** `interactionCreate.ts`, `EventHandler.ts`, `InteractionHandler.ts`, `DiscordClient.ts`, các base class.
- **Database:** Không.
- **Security:** Giảm nguy cơ DoS.
- **Performance:** Không.
- **UX:** User nhận thông báo lỗi thay vì bot biến mất.
- **Infrastructure:** Không.

### Độ ưu tiên

HIGH (blocker)

### Rủi ro

Thấp. Handler `unhandledRejection` chỉ nên log, không được nuốt lỗi một cách im lặng.

### Trạng thái

IMPLEMENTED (2026-09-24, Phase 1). Error boundary trong interactionCreate, EventHandler bắt reject, base class abstract, unhandledRejection chỉ log.

---

## PROP-004 — Cập nhật dependency runtime, bỏ dependency trùng

### Vấn đề

`npm audit` (2026-09-24) báo 13 lỗ hổng, trong đó 7 ở dependency production: undici, ws, lodash, tar-fs ở mức high; file-type, `@discordjs/rest`, discord.js ở mức moderate.

`@discordjs/rest` 1.7.1 trùng chức năng với bản 2.4.3 đã nằm sẵn trong discord.js, và kéo theo undici 5 cùng file-type. `discord-api-types` được khai báo riêng dù discord.js đã re-export (đã kiểm chứng: `require("discord.js").REST` và `.Routes` có sẵn).

### Đề xuất

- Nâng `discord.js` lên bản 14.x mới nhất.
- Bỏ `@discordjs/rest` và `discord-api-types` khỏi `dependencies`.
- `deploy()` dùng `REST` / `Routes` import từ discord.js, hoặc dùng `client.rest`.

### Lý do

Giảm số dependency và giảm bề mặt lỗ hổng. Tránh lệch version giữa các bản type.

### Tác động

- **Code:** `InteractionHandler.ts`, `package.json`.
- **Database:** Không.
- **Security:** Vá các lỗ hổng runtime.
- **Performance:** `node_modules` nhỏ hơn.
- **UX:** Không.
- **Infrastructure:** Không.

### Độ ưu tiên

HIGH

### Rủi ro

discord.js bản mới có thể đổi một số type hoặc deprecate API; cần build và chạy thử. Lưu ý: các lỗ hổng undici/ws chủ yếu khai thác được khi kết nối tới server độc hại, nên nguy cơ thực tế thấp, nhưng vẫn nên vá theo chính sách công ty.

### Trạng thái

IMPLEMENTED (2026-09-24, Phase 1). discord.js 14.27.0; bỏ @discordjs/rest và discord-api-types; deploy dùng application.commands.set(). npm audit: 0 lỗ hổng.

---

## PROP-005 — Quản lý secret bằng environment variable

### Vấn đề

Token nằm trong `src/config.json` và bị `tsc` copy sang `build/config.json` (LL-002). Build cũng phụ thuộc vào file secret. Config không được validate.

### Đề xuất

- Đọc `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID(S)`, `DATABASE_PATH` từ `process.env`.
- Khi chạy dev, dùng tính năng có sẵn của Node: `node --env-file=.env` hoặc `process.loadEnvFile()` (Node ≥ 20.12 / 21.7). **Không thêm `dotenv`.**
- Tạo một module config duy nhất: validate, lỗi thì dừng ngay với thông báo rõ ràng, và không bao giờ log giá trị secret.
- Thêm `.env.example`; thêm `.env` vào `.gitignore`.
- Bỏ `src/config.json` và `example_config.json`.

### Lý do

Secret không còn nằm trong build artifact. Build không còn cần secret. Khớp với layout triển khai trong brief (có `.env`).

### Tác động

- **Code:** `DiscordClient.ts`, `InteractionHandler.ts`, module config mới, `.gitignore`, README.
- **Database:** Đường dẫn DB cấu hình được.
- **Security:** Cải thiện rõ rệt.
- **Performance:** Không.
- **UX:** Không.
- **Infrastructure:** Server cần cung cấp biến môi trường hoặc file `.env`.

### Độ ưu tiên

HIGH

### Rủi ro

Cần thống nhất cách cấp `.env` trên production (quyền file chỉ cho user chạy bot đọc).

### Trạng thái

IMPLEMENTED (2026-09-24, Phase 1). src/config.ts đọc DISCORD_TOKEN, DISCORD_GUILD_IDS; .env qua --env-file; không còn cần clientId.

---

## PROP-006 — Tách git khỏi repo upstream public

### Vấn đề

`origin` trỏ tới repo public của bên thứ ba, nên có nguy cơ đẩy nhầm code công ty lên public.

### Đề xuất

- Đổi tên `origin` thành `upstream`, giữ lại để tham khảo template.
- Vô hiệu hoá push URL của `upstream`.
- Bỏ tracking của `main`.
- Remote nội bộ thêm sau, khi có URL.

### Lý do

Tránh đẩy nhầm code công ty lên public.

### Tác động

- **Code:** Không.
- **Database:** Không.
- **Security:** Giảm rủi ro lộ code.
- **Performance:** Không.
- **UX:** Không.
- **Infrastructure:** Tạm thời không có remote để push.

### Độ ưu tiên

MEDIUM

### Rủi ro

Không. Không rewrite history; giữ license MIT và copyright notice gốc.

### Trạng thái

IMPLEMENTED (2026-09-24, theo chỉ thị của người phụ trách, xem DEC-013). Phần metadata `package.json` trước đây nằm trong proposal này đã được tách thành PROP-021.

---

## PROP-007 — Nền tảng database

### Vấn đề

Không có migration, PRAGMA, transaction hay repository. Có 2 connection. Schema được tạo sau khi login và sau cả deploy (LL-007). DB nằm chung thư mục `db/` với file source.

### Đề xuất

- Chỉ **một** connection better-sqlite3, mở ở composition root và inject vào nơi cần. Bỏ static `Sqlite.prepare`.
- Đặt PRAGMA khi mở: `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout` hợp lý.
- Migration runner tối giản: các file `NNN_ten.sql` chạy theo thứ tự, lưu version bằng `PRAGMA user_version`, mỗi migration trong một transaction. **Không thêm dependency.**
- Đường dẫn DB lấy từ config, mặc định `data/bot.db`; thêm `data/` vào `.gitignore`.
- Mở DB và migrate **trước** `login()`.
- Repository theo từng module; helper transaction dùng `db.transaction()`.

### Lý do

Là nền cho mọi feature có lưu dữ liệu. Schema cần thay đổi được theo thời gian mà không phải sửa bằng tay.

### Tác động

- **Code:** `Sqlite.ts`, `index.ts`, `ready.ts`, thư mục migrations.
- **Database:** Thay đổi cách khởi tạo; chưa có schema nghiệp vụ.
- **Security:** Không đổi.
- **Performance:** WAL giúp đọc và ghi không chặn nhau.
- **UX:** Không.
- **Infrastructure:** File DB chuyển sang `data/`; WAL tạo thêm các file `-wal` và `-shm`.

### Độ ưu tiên

HIGH

### Rủi ro

- WAL: backup phải dùng `db.backup()` hoặc checkpoint, không được copy file thô khi bot đang chạy (xem PROP-008).
- File migration `.sql` phải được đưa theo khi deploy, hoặc nhúng vào code.

### Trạng thái

IMPLEMENTED (2026-09-26, Phase 2–10). src/db/connection.ts, migrations.ts (2 migration, user_version), DB mở và migrate trước login; data/bot.db.

---

## PROP-008 — Backup và restore SQLite

### Vấn đề

Hiện không có cơ chế backup nào. Dữ liệu điểm và contribution sẽ là tài sản của team.

### Đề xuất

- Dùng `db.backup()` có sẵn của better-sqlite3 (online, an toàn với WAL), chạy định kỳ trong process và/hoặc qua một admin command.
- Giữ N bản gần nhất trong thư mục cấu hình được.
- Viết quy trình restore và diễn tập restore trước khi đưa lên production.

### Lý do

Chống mất dữ liệu do lỗi thao tác, lỗi migration hoặc hỏng ổ đĩa.

### Tác động

- **Code:** Module backup nhỏ.
- **Database:** Không đổi schema.
- **Security:** File backup chứa dữ liệu nội bộ, cần phân quyền thư mục.
- **Performance:** Backup online có tác động nhỏ.
- **UX:** Không.
- **Infrastructure:** Cần dung lượng đĩa. Nơi lưu bản sao ngoài máy: CHƯA XÁC ĐỊNH (không tự thêm cloud).

### Độ ưu tiên

MEDIUM (HIGH trước khi lên production)

### Rủi ro

Backup nằm cùng máy thì không chống được hỏng máy.

### Trạng thái

IMPLEMENTED (2026-09-26, Phase 2–10). BackupService: tự động mỗi ngày, bản thủ công xoay vòng riêng, /admin backup; runbook khôi phục trong docs/DEPLOY.md.

---

## PROP-009 — Chiến lược test không thêm dependency

### Vấn đề

Không có test framework, không có test nào. Code hiện tại không test được vì dùng static singleton và constructor có side-effect.

### Đề xuất

- Dùng `node:test` và `node:assert` có sẵn trong Node, **không thêm Jest hay Vitest**.
- Test business logic (service, hàm thuần) với better-sqlite3 `:memory:` và migration thật, không mock DB.
- Inject `Clock` để test cooldown mà không phải sleep.
- Cách chạy TypeScript, chọn một trong hai:
  - (a) compile bằng `tsc` với một tsconfig riêng cho test, rồi chạy `node --test` trên output;
  - (b) dùng `--experimental-strip-types` của Node (còn experimental).
- Thêm script `test` và `check` (build + lint + test).

### Lý do

Business logic phải dễ test (yêu cầu của dự án). Không thêm dependency.

### Tác động

- **Code:** Thư mục test, script mới, có thể thêm tsconfig cho test.
- **Database:** Không.
- **Security:** Không.
- **Performance:** Không.
- **UX:** Không.
- **Infrastructure:** Không.

### Độ ưu tiên

MEDIUM (cần có trước Phase 4)

### Rủi ro

Phương án (a) phải tránh đưa file test vào build production. Phương án (b) phụ thuộc tính năng experimental.

### Trạng thái

IMPLEMENTED (2026-09-26, Phase 2–10). node:test + SQLite :memory:, test/tsconfig.json, npm test / npm run check; 323 test.

---

## PROP-010 — ESLint dùng thông tin type

### Vấn đề

Lint hiện không dùng thông tin type, nên không bắt được lỗi LL-001 (LL-006). ESLint 8 đã hết hỗ trợ; `@typescript-eslint` v5 không hỗ trợ chính thức TS 5.5.

### Đề xuất

- Bật lint dùng thông tin type (`parserOptions.project`).
- Bật `@typescript-eslint/no-floating-promises`, `no-misused-promises`, `no-explicit-any` (ở mức warn hoặc error).
- Nâng ESLint và typescript-eslint lên bản còn được hỗ trợ; khi đó cần chuyển sang flat config.

### Lý do

Ngăn loại lỗi nghiêm trọng nhất đã tìm thấy quay lại.

### Tác động

- **Code:** `.eslintrc.cjs` (hoặc `eslint.config.*`), devDependencies.
- **Database:** Không.
- **Security:** Gián tiếp có lợi.
- **Performance:** Lint chậm hơn (không đáng kể với repo nhỏ).
- **UX:** Không.
- **Infrastructure:** Không.

### Độ ưu tiên

MEDIUM

### Rủi ro

Chuyển sang flat config tốn công. Có thể làm theo từng bước: trước tiên bật type-aware trên ESLint 8 (kèm cảnh báo về version), nâng cấp sau.

### Trạng thái

IMPLEMENTED (2026-09-24, Phase 1). ESLint 10.11 + typescript-eslint 8.70 recommendedTypeChecked, flat config eslint.config.mjs.

---

## PROP-011 — Cấu trúc module mục tiêu và composition root

### Vấn đề

DEC-007 đã chốt phân tầng, nhưng chưa có cấu trúc thư mục và quy ước cụ thể. Nếu không chốt trước Phase 2, mỗi feature sẽ tự đặt cách tổ chức riêng.

### Đề xuất

- Áp dụng cấu trúc ở `ARCHITECTURE.md` mục 2.2: `config/`, `discord/`, `modules/<domain>/`, `db/`, `shared/`.
- `src/index.ts` là composition root: tạo mọi đối tượng bằng constructor injection thủ công, không dùng DI container.
- Command và event nhận service qua một context object, thay vì truy cập static.
- Quy tắc: `modules/` không import `discord.js`.

### Lý do

Business logic test được, tầng Discord mỏng, dễ bảo trì lâu dài.

### Tác động

- **Code:** Di chuyển file theo từng bước. Không rewrite; khung loader được giữ.
- **Database:** Không.
- **Security:** Không.
- **Performance:** Không.
- **UX:** Không.
- **Infrastructure:** Không.

### Độ ưu tiên

HIGH (cần chốt trước Phase 2)

### Rủi ro

Nếu làm quá tay thì thành over-engineering. Chỉ tạo module khi có feature thật cần đến.

### Trạng thái

IMPLEMENTED (2026-09-26, Phase 2–10). modules/*, services.ts (constructor injection), tầng Discord mỏng; ESLint chặn modules import discord.js.

---

## PROP-012 — Hardening tầng Discord

### Vấn đề

- Command `global = true` dùng được cả trong DM.
- Không đặt `allowedMentions`, nên nội dung do user nhập có thể ping `@everyone` hoặc role nếu bot có quyền.
- Loader `require` mọi file bất kể đuôi.
- Slash command và context menu dùng chung một Collection, cùng các ép kiểu `as`.
- `ButtonHandler` không hỗ trợ customId động (cần cho voting).
- Còn `Partials.Channel` dù không dùng DM.

### Đề xuất

- Bot nội bộ chỉ deploy command lên guild; tắt dùng command trong DM.
- Đặt `allowedMentions: { parse: [] }` ở cấp client (bật lại có chủ đích khi cần).
- Loader chỉ nạp file `.js` / `.ts` (bỏ `.d.ts` và `.map`).
- Tách registry của slash command và context menu, bỏ các ép kiểu `as`.
- Button so khớp theo prefix: customId có dạng `<namespace>:<payload>`, và phải validate payload.
- Bỏ `Partials.Channel`.

### Lý do

Giảm attack surface, chuẩn bị hạ tầng cho voting.

### Tác động

- **Code:** `DiscordClient.ts`, các handler, `interactionCreate.ts`, base class.
- **Database:** Không.
- **Security:** Cải thiện.
- **Performance:** Không.
- **UX:** Command không còn xuất hiện trong DM.
- **Infrastructure:** Không.

### Độ ưu tiên

MEDIUM

### Rủi ro

Nếu sau này cần command trong DM thì phải mở lại có chủ đích.

### Trạng thái

IMPLEMENTED (2026-09-24, Phase 1). Chỉ đăng ký command theo guild (global set rỗng), allowedMentions, loadModules(), tách registry, button namespace, bỏ Partials.Channel.

---

## PROP-013 — Phân quyền admin hai lớp và audit log

### Vấn đề

Không có bất kỳ kiểm tra quyền nào. Brief yêu cầu các chức năng admin và audit log.

### Đề xuất

- **Lớp 1:** `setDefaultMemberPermissions` cho mọi admin command (ví dụ Manage Guild) để Discord ẩn command với người thường.
- **Lớp 2:** guard trong code kiểm tra user có role admin đã cấu hình **hoặc** có permission tương ứng. Guard chạy tập trung ở dispatcher.
- Mọi thao tác thay đổi điểm hoặc cấu hình của admin được ghi vào audit log: ai, lúc nào, làm gì, giá trị trước và sau, lý do.
- Thao tác nguy hiểm (reset) phải qua bước xác nhận (button hoặc modal).

### Lý do

Lớp 1 có thể bị admin server nới lỏng trong Integrations, nên lớp 2 là bắt buộc. Audit log giúp minh bạch trong môi trường công ty.

### Tác động

- **Code:** Guard, module admin.
- **Database:** Cần bảng audit (thiết kế ở Phase 3).
- **Security:** Cải thiện mạnh.
- **Performance:** Không đáng kể.
- **UX:** Admin có thêm bước xác nhận.
- **Infrastructure:** Không.

### Độ ưu tiên

HIGH (trước mọi admin command)

### Rủi ro

Cấu hình role admin sai có thể khoá hết admin. Cần có đường dự phòng, ví dụ chủ server hoặc permission Manage Guild luôn qua được.

### Trạng thái

IMPLEMENTED (2026-09-26, Phase 2–10). setDefaultMemberPermissions(ManageGuild) + adminOnly ở dispatcher; audit_log cho mọi thay đổi; reset toàn bộ cần xác nhận "XAC NHAN".

---

## PROP-014 — Sổ cái (ledger) cho mọi biến động điểm

### Vấn đề

Nếu chỉ lưu tổng điểm, sẽ không thể audit, không thể tính lại khi công thức thay đổi, không làm được leaderboard theo kỳ, và khó hoàn tác thao tác của admin.

### Đề xuất

- Mỗi biến động điểm (XP từ tin nhắn, admin give/remove/reset, vote contribution) ghi thành một dòng append-only: `user`, loại điểm, số điểm, nguồn, `actor`, thời điểm, team snapshot (xem PROP-016).
- Tổng điểm có thể được cache trong bảng riêng, cập nhật trong **cùng transaction** với việc ghi ledger.
- XP và Contribution có ledger hoặc loại riêng, không trộn khi tính tổng (DEC-004).

### Lý do

Minh bạch, dễ debug, hỗ trợ statistics và reset theo kỳ. Ở quy mô công ty, dung lượng không đáng kể.

### Tác động

- **Code:** Repository của activity và contribution.
- **Database:** Định hình thiết kế schema của Phase 4–8.
- **Security:** Dữ liệu audit đầy đủ hơn.
- **Performance:** Cần index theo user và thời gian. Tính tổng qua bảng cache.
- **UX:** Không trực tiếp.
- **Infrastructure:** Không.

### Độ ưu tiên

MEDIUM (cần quyết trước khi thiết kế schema Phase 4)

### Rủi ro

Bảng ledger tăng dần theo thời gian; cần chính sách giữ hoặc gộp dữ liệu (PEND-013).

### Trạng thái

IMPLEMENTED (2026-09-26, Phase 2–10). modules/ledger/Ledger.ts: ledger append-only, void thay vì xoá, cache member_* và *_team_totals.

---

## PROP-015 — Anti-spam không lưu nội dung tin nhắn

### Vấn đề

Muốn chặn kiểu "ok ok haha" thì phải đọc nội dung tin nhắn, tức là cần privileged intent `MessageContent`. Lưu nội dung tin nhắn nhân viên vào DB là rủi ro về quyền riêng tư.

### Đề xuất

- Nếu bật `MessageContent` (PEND-006): chỉ xử lý nội dung trong bộ nhớ (chuẩn hoá, độ dài, hash để phát hiện trùng lặp trong một khoảng thời gian gần). **Không ghi nội dung hoặc hash vào DB.**
- Nếu không bật: anti-spam chỉ dựa trên các tín hiệu không cần nội dung (tần suất, cooldown, tệp đính kèm).
- Các ngưỡng cụ thể là business rule, cần được quyết định riêng.

### Lý do

Cân bằng giữa việc chặn farm XP và quyền riêng tư, đúng tinh thần least privilege.

### Tác động

- **Code:** Module activity.
- **Database:** Không lưu nội dung.
- **Security:** Giảm rủi ro dữ liệu nhạy cảm.
- **Performance:** Cache nhỏ trong bộ nhớ.
- **UX:** Không.
- **Infrastructure:** Cần bật intent trên Developer Portal nếu chọn phương án có đọc nội dung.

### Độ ưu tiên

MEDIUM

### Rủi ro

Trạng thái trong bộ nhớ mất khi restart, dẫn tới một khoảng ngắn anti-spam kém chính xác hơn.

### Trạng thái

IMPLEMENTED (2026-09-26, Phase 2–10). antiSpam.ts: chống trùng bằng hash trong RAM, không lưu nội dung; context menu cũng không chép nội dung tin nhắn.

---

## PROP-016 — Snapshot team tại thời điểm ghi điểm

### Vấn đề

Team leaderboard cần biết thành viên của từng team. Liệt kê toàn bộ thành viên của một role cần privileged intent `GuildMembers`. Ngoài ra còn câu hỏi: khi một người chuyển team, điểm cũ tính cho team nào?

### Đề xuất

Khi ghi điểm, lưu kèm team của user tại thời điểm đó, lấy từ `message.member.roles` hoặc `interaction.member.roles` (có sẵn trong payload, **không cần `GuildMembers`**). Team leaderboard được tổng hợp từ snapshot này.

### Lý do

Không cần thêm privileged intent. Kết quả lịch sử ổn định, không bị ảnh hưởng khi role thay đổi sau này.

### Tác động

- **Code:** Module team và activity.
- **Database:** Thêm cột team trong ledger.
- **Security:** Tránh được một privileged intent.
- **Performance:** Không.
- **UX:** Điểm cũ ở lại với team cũ.
- **Infrastructure:** Không.

### Độ ưu tiên

MEDIUM

### Rủi ro

Đây là **business rule** (ngữ nghĩa của team score), nên cần được quyết định (PEND-007). Người thuộc nhiều team cùng lúc cũng cần một quy tắc riêng.

### Trạng thái

IMPLEMENTED (2026-09-26, Phase 2–10). Snapshot team ở mọi event (xp_event_teams, contribution_event_teams); không dùng intent GuildMembers.

---

## PROP-017 — Chống gian lận vote contribution

### Vấn đề

Vote có thể bị lạm dụng: tự vote cho mình, vote nhiều lần, hai người vote qua lại cho nhau, tạo contribution rác.

### Đề xuất

Các quy tắc gợi ý, mỗi quy tắc cần được duyệt:

- Không tự vote cho contribution của mình.
- Mỗi người một vote cho mỗi contribution, enforce bằng unique constraint trong DB.
- Cho phép rút vote.
- Giới hạn số contribution mỗi người tạo trong một ngày.
- Admin ẩn hoặc gỡ được contribution và vote; mọi thao tác ghi vào audit log.
- Thống kê cặp vote qua lại để admin xem xét; không tự động phạt.

### Lý do

Contribution Score chỉ có giá trị khi khó bị thao túng.

### Tác động

- **Code:** Module contribution.
- **Database:** Unique constraint, trạng thái của contribution.
- **Security:** Chống lạm dụng.
- **Performance:** Không.
- **UX:** User nhận thông báo rõ khi vote bị từ chối.
- **Infrastructure:** Không.

### Độ ưu tiên

MEDIUM (trước Phase 8)

### Rủi ro

Quy tắc quá chặt làm giảm việc sử dụng. Đây là business rule, cần được quyết định (PEND-009).

### Trạng thái

IMPLEMENTED (2026-09-26, Phase 2–10). Một phần: không tự ghi nhận, mỗi người một lần, rút được, admin gỡ/điều chỉnh có audit, chống ghi nhận trùng một tin nhắn, chống vượt reset. Chưa làm: giới hạn mỗi ngày, thống kê vote qua lại.

---

## PROP-018 — Vận hành: logging tối giản và graceful shutdown

### Vấn đề

- Log chỉ dùng `console`, không có level, không che thông tin nhạy cảm; lỗi từ Discord API có thể in ra URL chứa interaction token.
- `ProcessManager` không xử lý SIGTERM, không đóng DB, chỉ nghe message "shutdown" trên win32.
- `ecosystem.config.js` bật `wait_ready`, nhưng code không gửi `ready`.

### Đề xuất

- Một wrapper logger mỏng dựa trên `console`: có level, timestamp, và che token cùng các URL interaction. **Không thêm thư viện logging.**
- Xử lý SIGINT và SIGTERM: `client.destroy()`, rồi `db.close()`, rồi thoát.
- Sửa hoặc bỏ cấu hình pm2 tuỳ theo PEND-005.

### Lý do

Log sạch hơn, tắt bot an toàn hơn.

### Tác động

- **Code:** `ProcessManager.ts`, logger mới, `ecosystem.config.js`.
- **Database:** DB được đóng đúng cách.
- **Security:** Giảm rò rỉ trong log.
- **Performance:** Không.
- **UX:** Không.
- **Infrastructure:** Tuỳ theo process manager được chọn.

### Độ ưu tiên

LOW

### Rủi ro

Thấp.

### Trạng thái

IMPLEMENTED (2026-09-26, Phase 2–10). shared/logger.ts (level, che token, bỏ requestBody), ProcessManager (SIGINT/SIGTERM, đóng DB), systemd unit.

---

## PROP-019 — Dọn code demo và viết lại README

### Vấn đề

- `/note`, `/clickme`, "Get User Info", `types/Note.ts` và bảng `notes` là code demo.
- `/note remove` cho phép bất kỳ ai xoá note.
- README mô tả template và có nhiều chỗ sai (LL-003).

### Đề xuất

- Xoá code demo khi đã có command thật để làm mẫu, dự kiến cuối Phase 2.
- Giữ `/ping` làm health check (chuyển sang chỉ trong guild).
- Viết lại README cho dự án: mục đích, cài đặt, cấu hình, chạy, backup. Giữ phần ghi công upstream.

### Lý do

Giảm nhiễu và attack surface; tài liệu đúng với code.

### Tác động

- **Code:** Xoá file.
- **Database:** Bảng `notes` trong các DB cũ vẫn còn, cần migration để drop nếu cần.
- **Security:** Bỏ được một điểm có thể bị lạm dụng.
- **Performance:** Không.
- **UX:** Không.
- **Infrastructure:** Không.

### Độ ưu tiên

LOW

### Rủi ro

Không.

### Trạng thái

IMPLEMENTED (2026-09-26, Phase 2–10). Xoá note/clickme/Get User Info/Sqlite/setup.sql; README tiếng Việt.

---

## PROP-020 — Leaderboard theo kỳ

### Vấn đề

Leaderboard tính từ đầu tới nay khiến người mới khó có cơ hội lên hạng, lâu dần giảm động lực.

### Đề xuất

Ngoài leaderboard toàn thời gian, có thêm leaderboard theo tuần, tháng hoặc quý. Leaderboard theo kỳ được tính từ ledger (PROP-014), không cần reset dữ liệu.

### Lý do

Hợp với mục tiêu gamification nội bộ và tạo nhịp ghi nhận định kỳ.

### Tác động

- **Code:** Module leaderboard.
- **Database:** Cần ledger có timestamp và index.
- **Security:** Không.
- **Performance:** Query theo khoảng thời gian, cần index.
- **UX:** Thêm tuỳ chọn kỳ trong `/leaderboard`.
- **Infrastructure:** Không.

### Độ ưu tiên

LOW

### Rủi ro

Đây là business rule (định nghĩa kỳ, múi giờ), cần được quyết định.

### Trạng thái

IMPLEMENTED (2026-09-27, Phase 12): bảng tuần/tháng theo giờ Việt Nam cho Activity/Contribution × cá nhân/team; không tính event bù tự động.

---

## PROP-021 — Metadata `package.json` của dự án

### Vấn đề

`package.json` vẫn mang `name` (`discordjs-core-bot`), `author`, `homepage`, `repository`, `bugs`, `description` của upstream, và không có `"private": true`.

### Đề xuất

- Đổi `name` và `description` cho dự án.
- Bỏ hoặc sửa `homepage`, `repository`, `bugs` (URL nội bộ CHƯA XÁC ĐỊNH, nên tạm thời bỏ).
- Đặt `"private": true` để `npm publish` không thể chạy nhầm.
- Giữ `license: "MIT"`.

### Lý do

Tránh publish nhầm lên npm; metadata phản ánh đúng dự án.

### Tác động

- **Code:** Chỉ `package.json`.
- **Database:** Không.
- **Security:** Chặn publish nhầm.
- **Performance:** Không.
- **UX:** Không.
- **Infrastructure:** Không.

### Độ ưu tiên

MEDIUM

### Rủi ro

Không.

### Trạng thái

IMPLEMENTED (2026-09-24, Phase 1). name company-discord-bot, version 0.1.0, private: true, engines; bỏ metadata upstream.

---

## PROP-022 — Khai báo `@types/node` tường minh

### Vấn đề

Code dùng type của Node (`process`, `NodeJS.ProcessEnv`, `__dirname`), nhưng `@types/node` không được khai báo. Hiện nó chỉ có mặt gián tiếp qua `@types/better-sqlite3` với range `"*"`, nên version thực tế có thể là type của Node 26 trong khi runtime là Node 22/24. Nếu package kia đổi dependency, build có thể hỏng mà không rõ lý do.

### Đề xuất

Thêm `@types/node` vào `devDependencies` với range khớp runtime production (`^24`, theo DEC-016).

### Lý do

Type khớp với runtime thật; build không phụ thuộc vào dependency gián tiếp.

### Tác động

- **Code:** `package.json`, lockfile (package vốn đã có trong `node_modules`).
- **Database:** Không.
- **Security:** Không.
- **Performance:** Không.
- **UX:** Không.
- **Infrastructure:** Không.

### Độ ưu tiên

LOW

### Rủi ro

Không đáng kể. Là thêm một devDependency, nên cần duyệt theo luật protected.

### Trạng thái

IMPLEMENTED (2026-09-26, DEC-019). `@types/node` ^24.19.0; cả cây dependency dedupe về bản này (trước đó là 22.13 gián tiếp).

---

## PROP-023 — Cố định line ending bằng `.gitattributes`

### Vấn đề

Máy dev (Windows) bật `core.autocrlf=true`, nên file trong working copy là CRLF, còn repo lưu LF và server Linux nhận LF. Trong Phase 1, một script sửa file đã chạy sai vì không tính tới CRLF.

### Đề xuất

Thêm `.gitattributes` với `* text=auto eol=lf`, để mọi máy đều checkout LF.

### Lý do

Hành vi giống nhau giữa Windows và Linux; tránh lỗi âm thầm khi script đọc file hoặc khi so sánh diff.

### Tác động

- **Code:** Một file cấu hình git; có thể phải normalize lại line ending một lần.
- **Database:** Không.
- **Security:** Không.
- **Performance:** Không.
- **UX:** Không.
- **Infrastructure:** Không.

### Độ ưu tiên

LOW

### Rủi ro

Commit normalize ban đầu có thể làm diff lớn nếu repo đang lẫn CRLF (hiện repo lưu LF, nên dự kiến diff nhỏ).

### Trạng thái

IMPLEMENTED (2026-09-26, DEC-019). Không có diff chuẩn hoá (repo vốn lưu LF cả 38 file); working copy trên máy dev đã được checkout lại toàn bộ sang LF.

---

## PROP-024 — Không để điểm contribution âm khi rút ghi nhận / gỡ sau khi admin đã trừ

### Vấn đề

`adjust` chặn tổng âm, nhưng rút ghi nhận (`voidEvent`) và gỡ contribution (`voidByReference`) thì trừ thẳng vào tổng. Ví dụ: A có 2 điểm từ ghi nhận → admin trừ 2 (tổng 0) → admin gỡ contribution → tổng **-2**. Người bị phạt bị trừ hai lần cho cùng một contribution; điểm team cũng giảm theo. Phát hiện ở đợt review 2026-09-26.

### Đề xuất

Chọn một trong hai:
- (a) Khi void làm tổng âm, ghi thêm một event bù (source `admin`, lý do tự động) trong cùng transaction để tổng về 0.
- (b) Cho phép âm, hiển thị đúng số âm.

Khuyến nghị (a).

### Lý do

Tránh phạt hai lần; con số dễ hiểu với người dùng.

### Tác động

- **Code:** ContributionService.
- **Database:** Thêm event bù; không đổi schema.
- **Security:** Không.
- **Performance:** Không.
- **UX:** Điểm không âm.
- **Infrastructure:** Không.

### Độ ưu tiên

MEDIUM

### Rủi ro

Đây là quy tắc nghiệp vụ (DEC-012), cần người phụ trách chốt.

### Trạng thái

IMPLEMENTED (2026-09-27, Phase 12): ContributionService.compensateNegative, event bù nguồn admin, actor null.

---

## PROP-025 — Ghi nhận đóng góp qua modal

### Vấn đề

Luật dự án cấm lưu nội dung tin nhắn khi chưa có quyết định, nên context menu "Ghi nhận đóng góp" chỉ lưu link, với tiêu đề cố định kiểu "Đóng góp từ tin nhắn trong #kênh". Danh sách contribution vì thế khó phân biệt.

### Đề xuất

Khi bấm "Ghi nhận đóng góp", bot mở modal để người ghi nhận tự viết tiêu đề (bắt buộc) và mô tả ngắn (lý do ghi nhận). Nội dung do chính người ghi nhận nhập, không chép từ tin nhắn.

### Lý do

Contribution có tiêu đề rõ ràng, đúng tinh thần "ghi nhận", mà không vi phạm luật lưu nội dung.

### Tác động

- **Code:** Context menu và thêm cơ chế định tuyến modal submit trong dispatcher (giống button).
- **Database:** Không.
- **Security:** Không lưu nội dung người khác.
- **Performance:** Không.
- **UX:** Thêm một bước điền form.
- **Infrastructure:** Không.

### Độ ưu tiên

MEDIUM

### Rủi ro

Thêm một loại interaction cần test trên Discord thật.

### Trạng thái

DEFERRED (2026-09-26, DEC-028): người phụ trách đồng ý giữ tiêu đề cố định.

---

## PROP-026 — Snapshot team của lượt ghi nhận

### Vấn đề

Điểm của lượt ghi nhận đang tính cho team của tác giả **lúc gửi** contribution (lưu ở `contribution_teams`). DEC-024 ghi "team tại thời điểm phát sinh điểm", tức là lúc được ghi nhận. Nếu tác giả chuyển team giữa hai thời điểm này thì điểm vẫn vào team cũ.

### Đề xuất

- (a) Giữ nguyên và sửa câu chữ DEC-024/025 cho khớp. Lý do kỹ thuật: lúc người khác bấm ghi nhận, bot không biết role hiện tại của tác giả nếu không có intent GuildMembers, trừ khi gọi REST mỗi lần bấm.
- (b) Mỗi lần ghi nhận thì gọi REST lấy role hiện tại của tác giả.

Khuyến nghị (a).

### Lý do

Đơn giản, không cần intent hay request thêm; contribution thuộc về team nơi nó được tạo ra.

### Tác động

- **Code:** (a) chỉ sửa tài liệu; (b) sửa button handler và service.
- **Database:** Không.
- **Security:** Không.
- **Performance:** (b) thêm một REST call mỗi lần bấm.
- **UX:** Không đáng kể.
- **Infrastructure:** Không.

### Độ ưu tiên

LOW

### Rủi ro

Đây là quy tắc nghiệp vụ, cần người phụ trách chốt.

### Trạng thái

IMPLEMENTED (2026-09-26, DEC-028): phương án (a), giữ snapshot lúc gửi; đã sửa câu chữ DEC-024.

---

## PROP-027 — Tin có chữ ngắn kèm file đính kèm

### Vấn đề

Theo DEC-023: tin chỉ có ảnh thì được XP (chỉ áp dụng cooldown), nhưng ảnh kèm caption ngắn (ví dụ "ok") lại bị loại vì quá ngắn.

### Đề xuất

- (a) Tin có file đính kèm thì bỏ kiểm tra độ dài tối thiểu (vẫn chống trùng, vẫn cooldown).
- (b) Giữ nguyên.

### Lý do

Hành vi nhất quán hơn với người dùng.

### Tác động

- **Code:** `antiSpam.ts`.
- **Database:** Không.
- **Security:** Không.
- **Performance:** Không.
- **UX:** Ít trường hợp khó hiểu hơn.
- **Infrastructure:** Không.

### Độ ưu tiên

LOW

### Rủi ro

Đây là quy tắc nghiệp vụ, cần người phụ trách chốt.

### Trạng thái

REJECTED (2026-09-27, DEC-032): giữ nguyên; ảnh kèm chữ quá ngắn không được XP, ảnh kèm chữ từ 5 ký tự trở lên hoặc ảnh không kèm chữ thì được.

---

## PROP-028 — Giới hạn XP từ vote

### Vấn đề

Người có quyền tạo vote có thể tạo, tự vote, đóng, rồi lặp lại để lấy XP (mặc định 5 XP mỗi vote). Admin có thể đặt XP riêng tới 1000. Audit đã ghi mức XP (từ đợt sửa 2026-09-26), nhưng không có giới hạn.

### Đề xuất

Chọn một hoặc nhiều:
- người tạo không nhận XP ở vote của chính mình;
- giới hạn số vote có XP mà một người nhận được mỗi ngày;
- giới hạn XP tối đa của một vote thấp hơn 1000.

### Lý do

Chống lạm dụng từ người có quyền tạo vote.

### Tác động

- **Code:** PollService.
- **Database:** Có thể cần truy vấn theo ngày.
- **Security:** Giảm lạm dụng.
- **Performance:** Không đáng kể.
- **UX:** Không.
- **Infrastructure:** Không.

### Độ ưu tiên

LOW

### Rủi ro

Đây là quy tắc nghiệp vụ. Người tạo vote hiện là admin hoặc role được tin cậy, nên rủi ro thấp.

### Trạng thái

IMPLEMENTED (2026-09-27, Phase 12): giới hạn XP từ vote mỗi ngày giờ Việt Nam (pollXpDailyCap, mặc định 25).

---

## PROP-029 — Nút chuyển trang cho bảng xếp hạng

### Vấn đề

`/leaderboard` chuyển trang bằng option `trang`; phải gõ lại lệnh.

### Đề xuất

Thêm nút ◀ ▶ với customId dạng `lb:<loai>:<pham-vi>:<trang>` để chuyển trang ngay trên message.

### Lý do

Tiện hơn cho người dùng.

### Tác động

- **Code:** Command leaderboard và view.
- **Database:** Không.
- **Security:** Không.
- **Performance:** Mỗi lần bấm là một truy vấn (đã được tối ưu bằng bảng cache).
- **UX:** Tốt hơn.
- **Infrastructure:** Không.

### Độ ưu tiên

LOW

### Rủi ro

Thấp.

### Trạng thái

IMPLEMENTED (2026-09-27, Phase 12): nút lb chuyển loại điểm, phạm vi, kỳ, trang và "Hạng của tôi" trên ảnh bảng xếp hạng.

---

## PROP-030 — Đưa riêng từng giá trị của channel về mặc định

### Vấn đề

Discord option không truyền được giá trị "trống", nên muốn một channel quay về XP hoặc cooldown chung phải chạy `/config channel reset`, lệnh này xoá cả cấu hình bật/tắt XP.

### Đề xuất

Thêm option kiểu boolean cho `/config channel set` (tên thực tế khi làm: `dung-chung-xp`, `dung-chung-cooldown`).

### Lý do

Admin chỉnh cấu hình chính xác hơn.

### Tác động

- **Code:** Command config.
- **Database:** Không.
- **Security:** Không.
- **Performance:** Không.
- **UX:** Tốt hơn.
- **Infrastructure:** Không.

### Độ ưu tiên

LOW

### Rủi ro

Thấp.

### Trạng thái

IMPLEMENTED (2026-09-27, Phase 14): option `dung-chung-xp`, `dung-chung-cooldown` đưa giá trị riêng của channel về giá trị chung (null), giữ cấu hình bật/tắt XP; vừa nhập số vừa chọn dùng chung thì báo lỗi.

---

## PROP-031 — Rút rồi ghi nhận lại không được xoá hình phạt của admin

### Vấn đề

Cách bù điểm đã chốt ở DEC-028 (PROP-024, phương án a) có lỗ hổng. Ví dụ:
1. B, C, D ghi nhận A, A có 3 điểm.
2. Admin phạt −3, A còn 0.
3. B, C, D lần lượt rút ghi nhận. Mỗi lần rút, tổng thành −1 và bot bù +1, nên A vẫn 0.
4. Cả ba ghi nhận lại. A có **3 điểm**, hình phạt mất hết.

Không cần thông đồng: bấm nhầm rồi bấm lại cũng làm mất vĩnh viễn một phần hình phạt. Cả reviewer dữ liệu lẫn reviewer bảo mật (2026-09-27) đều phát hiện lỗi này.

### Đề xuất

Chọn một trong các phương án:
- (a) Nếu một lượt rút ghi nhận đã phát sinh điểm bù, người đó không được ghi nhận lại contribution đó (giống lượt đã bị reset, PEND-015).
- (b) Mô hình "nợ": ghi nhận lại sau khi đã bù thì khấu trừ phần bù trước, chỉ phần còn dư mới cộng điểm.
- (c) Chấp nhận như hiện tại và ghi rõ là hạn chế trong DEC-028.

Khuyến nghị (a): đơn giản, nhất quán với cách xử lý lượt đã bị reset, dễ giải thích cho người dùng.

### Lý do

Hình phạt của admin phải có hiệu lực; người dùng không được tự huỷ nó bằng thao tác thông thường.

### Tác động

- **Code:** `ContributionService.toggleVote`. Với (a), cần biết lượt rút nào đã phát sinh bù, ví dụ lưu `event_id` của event bù vào dòng vote thay vì xoá dòng vote.
- **Database:** (a) hoặc (b) có thể cần thêm cột hoặc migration mới.
- **Security:** Giảm lạm dụng.
- **Performance:** Không.
- **UX:** (a) người đã rút sau khi bị phạt sẽ không bấm ghi nhận lại được, và nhận thông báo lý do.
- **Infrastructure:** Không.

### Độ ưu tiên

MEDIUM

### Rủi ro

Đây là quy tắc nghiệp vụ (PEND-021), cần người phụ trách chốt.

### Trạng thái

IMPLEMENTED (2026-09-27, DEC-032): phương án (a). Lần rút làm phát sinh điểm bù thì giữ dòng vote (event đã huỷ), người rút không ghi nhận lại được; phản hồi báo rõ lý do.

---

## PROP-032 — `/config admin-role` chỉ người có Manage Server đặt được

### Vấn đề

Người có role admin bot, kể cả khi không có quyền Manage Server, dùng được `/config admin-role` để trỏ role admin bot sang bất kỳ role nào. Ví dụ, họ có thể bỏ gán một role danh hiệu mà gần như mọi thành viên đang giữ, rồi đặt role đó làm role admin bot. Cách này biến nhiều người thành admin bot. Reviewer bảo mật Phase 13 ghi nhận vấn đề này (có từ Phase 3, Phase 13 không mở thêm đường mới).

### Đề xuất

Chỉ người có Manage Server cấp server (`member.permissions`, LL-019), hoặc chủ server, mới đổi được `/config admin-role`. Người chỉ có role admin bot vẫn dùng được các lệnh cấu hình khác.

### Lý do

Quyền "chỉ định ai là admin bot" nên thuộc người quản trị server thật, không thuộc chính admin bot.

### Tác động

- **Code:** `config.ts` (`updateAdminRole`).
- **Database:** Không.
- **Security:** Đóng một đường tự mở rộng quyền trong bot.
- **UX:** Admin bot không tự đổi được role admin.
- **Infrastructure:** Không.

### Độ ưu tiên

MEDIUM

### Rủi ro

Đổi quy tắc phân quyền (PROP-013, DEC-021), nên cần người phụ trách duyệt.

### Trạng thái

REJECTED (2026-09-27, DEC-034): người phụ trách chỉ có role admin bot, nên giữ quyền đổi role admin cho role này.

## PROP-033 — Bảng điều khiển cấu hình chung `/config panel`

### Vấn đề

Người phụ trách yêu cầu "có giao diện setup". Hiện mới có giao diện cho bộ danh hiệu và role (`/config tier panel`, DEC-033). Các cấu hình còn lại vẫn phải gõ từng slash command: team, channel tính XP, XP và chống spam, vote, contribution, Bảng vàng, role admin. Người không quen lệnh khó nhớ tên option và khó thấy tổng thể.

### Đề xuất

Thêm `/config panel`: một bảng Components V2 trả lời riêng cho admin, cùng kiểu với `/config tier panel`. Bảng có các trang chọn bằng menu hoặc nút:

- **Tổng quan:** tóm tắt cấu hình như `/config view`.
- **Kênh:** menu chọn nhiều channel để tắt XP, và menu chọn channel để bật lại; danh sách channel đang tắt XP hoặc có cấu hình riêng.
- **Team:** menu chọn nhiều role làm team (chọn thêm, bỏ chọn là gỡ).
- **XP và chống spam:** nút mở form nhập XP mỗi tin, cooldown, độ dài tối thiểu, khoảng chống trùng; công tắc thông báo lên level.
- **Vote và contribution:** form nhập XP mặc định khi vote, giới hạn XP từ vote mỗi ngày, điểm mỗi 👍; menu chọn role được tạo vote.
- **Bảng vàng và admin:** menu chọn kênh Bảng vàng (kèm nút tắt); menu chọn role admin bot.
- Nút mở `/config tier panel`.

Mọi thao tác đi qua đúng service và kiểm tra như lệnh gõ tay: quyền hai lớp, chặn role danh hiệu làm team hoặc admin, kiểm tra quyền kênh Bảng vàng. Mọi thao tác ghi audit log. customId mang trạng thái lúc vẽ, để không ghi đè thay đổi mới hơn (như tier panel ở Phase 13). Các lệnh gõ tay giữ nguyên.

### Lý do

Admin cấu hình bằng chuột, thấy ngay tổng thể, không cần nhớ tên option. Dùng lại khung đã kiểm chứng của `/config tier panel`, gồm dispatcher, `adminOnly` cho component và renderGate.

### Tác động

- **Code:** view mới `src/discord/views/configPanel.ts`, handler trong `config.ts` (namespace component mới), test cho view và luồng.
- **Database:** Không đổi schema, dùng service có sẵn.
- **Security:** Không thêm quyền hay intent. Bề mặt mới là các component, được kiểm tra `adminOnly` như tier panel.
- **UX:** Thêm một cách cấu hình trực quan.
- **Infrastructure:** Không. Sau khi merge, cập nhật server bằng quy trình ở DEC-036.

### Độ ưu tiên

MEDIUM

### Rủi ro

Giới hạn của Discord: một menu chọn tối đa 25 mục, một message tối đa 40 component, form tối đa 5 ô. Vì vậy bảng phải chia trang. Không đổi business rule nào.

### Trạng thái

APPROVED (2026-09-29, DEC-037), kèm chế độ "chỉ kênh được bật". Đang làm ở Phase 15.
