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
| PROP-007 | Nền tảng database | HIGH | PROPOSED |
| PROP-008 | Backup và restore SQLite | MEDIUM | APPROVED |
| PROP-009 | Chiến lược test không thêm dependency | MEDIUM | PROPOSED |
| PROP-010 | ESLint dùng thông tin type | MEDIUM | IMPLEMENTED |
| PROP-011 | Cấu trúc module mục tiêu và composition root | HIGH | PROPOSED |
| PROP-012 | Hardening tầng Discord | MEDIUM | IMPLEMENTED |
| PROP-013 | Phân quyền admin hai lớp và audit log | HIGH | PROPOSED |
| PROP-014 | Sổ cái (ledger) cho mọi biến động điểm | MEDIUM | PROPOSED |
| PROP-015 | Anti-spam không lưu nội dung tin nhắn | MEDIUM | PROPOSED |
| PROP-016 | Snapshot team tại thời điểm ghi điểm | MEDIUM | PROPOSED |
| PROP-017 | Chống gian lận vote contribution | MEDIUM | PROPOSED |
| PROP-018 | Vận hành: logging tối giản và graceful shutdown | LOW | PROPOSED |
| PROP-019 | Dọn code demo và viết lại README | LOW | PROPOSED |
| PROP-020 | Leaderboard theo kỳ | LOW | PROPOSED |
| PROP-021 | Metadata `package.json` của dự án | MEDIUM | IMPLEMENTED |
| PROP-022 | Khai báo `@types/node` tường minh | LOW | PROPOSED |
| PROP-023 | Cố định line ending bằng `.gitattributes` | LOW | PROPOSED |

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

PROPOSED

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

APPROVED (2026-09-24, DEC-017: sao lưu hàng ngày; triển khai ở Phase 2)

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

PROPOSED

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

PROPOSED

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

PROPOSED

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

PROPOSED

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

PROPOSED

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

PROPOSED

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

PROPOSED

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

PROPOSED

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

PROPOSED

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

PROPOSED

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

PROPOSED

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

PROPOSED
