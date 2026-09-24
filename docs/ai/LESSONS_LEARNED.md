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

- **Phát hiện:** 2026-09-24 · **Mức độ:** Trung bình · **Trạng thái:** Chưa sửa (PROP-007)
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
