# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Toàn bộ tài liệu trong repo viết bằng tiếng Việt. Tên biến, class, function, file, package và thuật ngữ kỹ thuật giữ nguyên tiếng Anh.

## Bắt đầu mỗi phiên

File này chỉ chứa **luật nền tảng, ổn định**. Trạng thái và bối cảnh chi tiết nằm trong `docs/ai/`:

| File | Khi nào đọc |
| --- | --- |
| `docs/ai/CURRENT_STATE.md` | **Luôn đọc đầu tiên**: phase hiện tại, lệnh nào đang chạy được, việc đang dở |
| `docs/ai/DECISIONS.md` | Trước khi thiết kế hoặc thay đổi bất cứ thứ gì: quyết định đã chốt và đang chờ |
| `docs/ai/ARCHITECTURE.md` | Trước khi thêm module, sửa luồng Discord hoặc database |
| `docs/ai/PROPOSALS.md` | Trước khi đề xuất cải tiến (tránh trùng); khi được giao triển khai một PROP |
| `docs/ai/LESSONS_LEARNED.md` | Khi gặp bug lạ; trước khi sửa vùng code từng có sự cố |
| `docs/ai/PROJECT_CONTEXT.md` | Khi cần hiểu yêu cầu sản phẩm |
| `docs/ai/ROADMAP.md` | Khi lập kế hoạch phase |

## Mục tiêu dự án

Discord bot nội bộ công ty cho gamification và ghi nhận đóng góp, với **hai hệ thống điểm độc lập**:

- **Activity XP**: tin nhắn hợp lệ → XP → Level → Activity Leaderboard (cá nhân và team).
- **Contribution Score**: contribution → vote/recognition → score → Contribution Leaderboard (cá nhân và team).

Team xác định bằng Discord Role. Admin thao tác bằng slash command (MVP không có dashboard).

Topology cố định: **1 process Node.js + 1 file SQLite + Discord**. Chi tiết yêu cầu: `docs/ai/PROJECT_CONTEXT.md`.

## Lệnh

```bash
npm ci           # cài dependency theo lockfile (.npmrc tắt install script, xem LL-008)
npm run build    # tsc → build/
npm run lint     # eslint . (flat config, có dùng thông tin type)
npm run dev      # build rồi chạy với file .env (node --env-file=.env)
npm run prod     # chạy build/index.js, nạp .env nếu có
npm run pm2      # pm2 start ecosystem.config.js   (pm2 phải cài global)
```

- Node ≥ 22.14 (better-sqlite3 13 cần N-API 10). Production dùng Node 24 LTS (DEC-016).
- Cấu hình: copy `.env.example` thành `.env` (`DISCORD_TOKEN`, `DISCORD_GUILD_IDS`). Không bao giờ commit `.env`.
- Chưa có test framework, chưa có script `test`, nên chưa có cách chạy một test đơn lẻ. Khi thêm test framework, cập nhật mục này.

## Kiến trúc

### Hiện tại (khung từ template open-source)

- `src/index.ts`: `loadConfig()` (đọc env) → `new DiscordClient(guildIds)` → `await login()`. Khởi động lỗi thì log rồi `exit(1)`.
- Constructor của `DiscordClient` tạo 3 handler dưới dạng class field theo thứ tự `events` → `interactions` → `buttons`. Nó cũng gắn listener `error` và `ProcessManager`, và đặt `allowedMentions` mặc định là không ping ai.
- **Tự nạp bằng file system** qua `handlers/loadModules.ts`:
  - Chỉ nạp file `.js`/`.ts` trong thư mục.
  - Mỗi file phải `export default` một class kế thừa `Event`, `Command` hoặc `ContextMenu`; sai thì bot không khởi động được.
  - `InteractionHandler` có 2 registry riêng: `commands` và `contextMenus`.
- **Thêm command:** tạo file `export default class X extends Command` trong `interactions/commands/`, không cần đăng ký thủ công. Mỗi lần khởi động, event `clientReady` sẽ:
  - deploy **toàn bộ** command lên từng guild trong `DISCORD_GUILD_IDS` (ghi đè toàn bộ command của guild);
  - set global command về rỗng. Bot không dùng global command.
- **Button:** `customId` có dạng `<namespace>:<payload>`. Command khai báo namespace trong `buttonIds` và tự validate payload.
- `events/interactionCreate.ts` là dispatcher duy nhất và là **error boundary** cho mọi interaction: lỗi trong command chỉ ảnh hưởng tới interaction đó. Kiểm tra quyền sau này đặt ở đây.
- `events/ready.ts` (event `clientReady`) gọi `deploy()` trước, rồi mới `Sqlite.setup()` (chạy `db/setup.sql`).
- `classes/Sqlite.ts` là static singleton của better-sqlite3, dùng file `<root>/db/data.db`. Code gọi `Sqlite.prepare<Params, Row>(sql)`.
- Trong code demo (`note.ts`), UI, business logic và SQL nằm chung một command class. **Không lặp lại** kiểu này ở code mới.

Các lỗi đã biết và bài học được ghi trong `docs/ai/LESSONS_LEARNED.md`. Đọc trước khi sửa dispatcher, loader, `Sqlite.ts` hay cơ chế config.

### Mục tiêu (đã chốt)

```
Discord → Command/Event (mỏng) → Service → Repository → SQLite
```

- Business module **không import discord.js**. Module chỉ nhận dữ liệu thuần (id, roleIds, timestamp, ...). Tầng Discord chỉ chuyển đổi dữ liệu và gọi service.
- Cấu trúc module chi tiết: `docs/ai/ARCHITECTURE.md`. Phần chưa được duyệt được đánh dấu là proposal.

## Nguyên tắc coding

- TypeScript `strict`, CommonJS. Không dùng `any` hay `as` cast nếu không ghi rõ lý do; ưu tiên type guard.
- Mọi Promise phải được `await` hoặc xử lý lỗi tường minh. Handler async phải khai báo kiểu trả về `Promise<void>`.
- Để business logic test được, dependency truyền qua constructor thay vì truy cập static singleton hay biến global. Không thêm DI container.
- Code style do `eslint.config.mjs` quy định: tab, Allman brace, double quote, trailing comma cho nhiều dòng, không inline comment. Chạy `npm run lint` thay vì tự đoán.
- Thay đổi nhỏ, có kiểm chứng. Tận dụng code tốt, không rewrite vì sở thích.

## Nguyên tắc security

- **Least privilege.** Không dùng Administrator, Manage Guild, Manage Roles, Manage Messages, Ban/Kick nếu không có yêu cầu đã duyệt. Chỉ thêm intent khi cần. **Privileged intent** (`MessageContent`, `GuildMembers`, `GuildPresences`) phải có quyết định trong `DECISIONS.md`.
- **Admin command có hai lớp bảo vệ:** `setDefaultMemberPermissions` **và** kiểm tra quyền trong code. Lớp Discord có thể bị admin server nới lỏng, nên không được chỉ dựa vào nó.
- **Secret** không được nằm trong source, commit, log hay **build artifact**. Secret chỉ đọc từ biến môi trường qua `src/config.ts`. Không import file chứa secret bằng `import ... from "*.json"`: nếu bật `resolveJsonModule`, `tsc` sẽ copy file đó vào `build/` (LL-002).
- Khi bot gửi lại nội dung do user nhập, phải chặn mention bằng `allowedMentions`.
- Không gọi network nào ngoài Discord API. Không webhook, telemetry, SaaS.
- Không dựa vào install script của dependency: `.npmrc` đặt `ignore-scripts=true`. Dependency mới cần install script phải được duyệt riêng.
- Không lưu nội dung tin nhắn vào database khi chưa có quyết định.

## Luật bảo vệ (protected) — không tự thay đổi

Chỉ được thay đổi thông qua proposal đã được duyệt (xem mục Quy trình):

1. Không truy cập database sản phẩm của công ty. Database của bot hoàn toàn độc lập.
2. Không tự thêm PostgreSQL, MySQL, MongoDB, Redis, Kafka, RabbitMQ, microservices, Kubernetes, API server riêng, database server riêng, external SaaS, cloud service, dashboard, Docker.
3. Không tự thêm external service hay network call.
4. Không tự cấp quyền Administrator.
5. Không tự quyết định hoặc thay đổi công thức scoring hay business rule.
6. Không tự thay đổi architecture lớn.
7. Không tự thêm dependency.

## Quy tắc database

- Chỉ một file SQLite do bot sở hữu, truy cập qua better-sqlite3.
- Chỉ dùng parameter binding (`?` hoặc named). Không bao giờ nối chuỗi vào SQL.
- Khi đã có migration runner, mọi thay đổi schema phải đi qua migration có đánh số. Không sửa schema bằng tay.
- Thao tác ghi nhiều bước phải nằm trong transaction. Không để `await` chen giữa bước đọc và bước ghi của cùng một thao tác.
- Không tạo schema nghiệp vụ khi thiết kế chưa được duyệt.
- Activity XP và Contribution Score lưu tách biệt, không bao giờ cộng gộp thành một điểm.
- Mọi thay đổi schema phải đánh giá tác động tới backup và restore.

## Quy tắc business logic

- Không cộng XP cho mọi tin nhắn: tin nhắn phải qua cấu hình channel, cooldown và anti-spam/anti-farming.
- Channel, cooldown, team role, ... là cấu hình của admin, không hard-code.
- Team được suy ra từ Discord Role đã cấu hình. Không xây database nhân viên hay team.
- Công thức XP, level, team score, contribution score do người có quyền quyết định. Phải ghi vào `DECISIONS.md` trước khi code.
- Business logic phải test được mà không cần Discord client thật.

## Quy trình

### Trước khi thay đổi architecture hoặc luật protected

1. Giải thích vấn đề và phương án.
2. Ghi proposal vào `docs/ai/PROPOSALS.md` với trạng thái `PROPOSED`.
3. Chờ người có quyền duyệt. Không tự chuyển sang `APPROVED`.
4. Sau khi được duyệt: ghi vào `DECISIONS.md`, triển khai, cập nhật `ARCHITECTURE.md`, đổi trạng thái proposal sang `IMPLEMENTED`.

### Cải tiến phát hiện ngoài phạm vi task

Không tự code; ghi vào `PROPOSALS.md`.

Các trường hợp ngoại lệ dưới đây được phép sửa tối thiểu, nhưng phải ghi lại vào `CURRENT_STATE.md` hoặc `LESSONS_LEARNED.md`:

- lỗi compile;
- lỗi runtime rõ ràng;
- lỗi security nghiêm trọng;
- lỗi làm task hiện tại không thể hoàn thành;
- vi phạm rule đã chốt.

### Test và hoàn tất task

Task chỉ được coi là xong khi `npm run build`, `npm run lint` và test (khi đã có) đều pass, hoặc khi đã ghi rõ lý do lệnh fail.

Self-review trước khi báo xong:

- **Code:** compile, lint, test; không có `any` vô lý, code thừa hay logic trùng lặp.
- **Architecture:** business module có phụ thuộc discord.js không? Coupling có tăng không?
- **Security:** có permission hay intent mới không? Có secret lọt vào đâu không? Có thêm external request không? Attack surface có rộng ra không?
- **Database:** schema có đổi không? Có migration chưa? Có cần transaction không? Ảnh hưởng tới backup ra sao?
- **Docs:** có decision, lesson, proposal hay thay đổi architecture nào cần ghi không?

### Cập nhật tài liệu AI

| Thay đổi | File cần cập nhật |
| --- | --- |
| Hoàn thành phase hoặc task đáng kể | `CURRENT_STATE.md` |
| Quyết định kỹ thuật được chốt | `DECISIONS.md` |
| Kiến trúc, dependency hoặc schema thay đổi | `ARCHITECTURE.md` |
| Bug nghiêm trọng, lỗi thiết kế, bài học | `LESSONS_LEARNED.md` |
| Ý tưởng cải tiến chưa duyệt | `PROPOSALS.md` |
| Phase được thêm, bớt hoặc đổi thứ tự | `ROADMAP.md` |

Chỉ đưa vào CLAUDE.md những quy tắc ổn định, lâu dài và áp dụng cho toàn dự án. Thông tin theo task hoặc phase nằm trong `docs/ai/`.

## Git

- Không force push, không rewrite hay xoá history, không commit khi chưa được yêu cầu.
- Repo hiện **chỉ làm việc local** (DEC-013). Remote `upstream` là repo open-source gốc (public, của bên thứ ba), chỉ dùng để fetch tham khảo; push URL đã bị vô hiệu hoá. Không có remote nào để push.
- Không tự thêm remote hay push khi chưa có URL và chỉ thị của người phụ trách. Remote nội bộ: CHƯA XÁC ĐỊNH.
- Repo phái sinh từ project license MIT, phải giữ `LICENCE.md`.
