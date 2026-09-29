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
npm run build    # dọn build/ rồi tsc (LL-010)
npm run lint     # eslint . (flat config, có dùng thông tin type)
npm test         # dọn build-test/, compile test/ rồi node --test
npm run check    # build + lint + test — phải pass trước khi coi một task là xong
npm run dev      # build rồi chạy với file .env (node --env-file=.env)
npm run prod     # chạy build/index.js, nạp .env nếu có
npm run selfcheck # sau khi build: tự kiểm tra môi trường (cấu hình, quyền ghi, DB, font, vẽ ảnh); không gọi mạng, không sửa DB
```

- Chạy một file test: `node --test build-test/test/activity.test.js`. Lọc theo tên: `node --test --test-name-pattern="cooldown" "build-test/test/**/*.test.js"`. Cả hai cách đều cần `npm test` hoặc `npx tsc -p test` chạy trước.
- Node ≥ 22.14 (better-sqlite3 13 cần N-API 10). Production dùng Node 24 LTS trên Linux (DEC-016); triển khai theo `docs/DEPLOY.md`.
- Cấu hình: copy `.env.example` thành `.env` (`DISCORD_TOKEN`, `DISCORD_GUILD_IDS`, tuỳ chọn `DATABASE_PATH`, `BACKUP_DIR`, `BACKUP_KEEP`, `LOG_LEVEL`). Không bao giờ commit `.env`.

## Kiến trúc

```
Discord → Command/Event (mỏng) → Service (src/modules) → Ledger/Repository → SQLite
```

Chi tiết và sơ đồ: `docs/ai/ARCHITECTURE.md`. Những điểm cần biết trước khi sửa code:

- **Composition root** là `src/index.ts` + `src/services.ts`: mở DB và migrate trước khi login; mọi service được tạo bằng constructor injection. Command và event lấy service qua `this.client.services`.
- **Business module** (`src/modules/**`) không import discord.js (ESLint chặn); chỉ nhận dữ liệu thuần (id, roleIds, timestamp). Lỗi hiển thị cho người dùng thì ném `UserError` với thông báo tiếng Việt.
- **Điểm** luôn đi qua `Ledger` (append-only + cache tổng + snapshot team). Có hai instance tách biệt, `xpLedger` và `contributionLedger`; không ghi thẳng vào bảng `member_*`.
- **Tự nạp theo thư mục** (`handlers/loadModules.ts`): mỗi file trong `events/`, `interactions/commands/`, `interactions/contextMenus/` phải `export default` một class kế thừa `Event` / `Command` / `ContextMenu`. Thêm command chỉ cần tạo file; khi `clientReady`, bot deploy toàn bộ command lên từng guild và xoá global command.
- **Dispatcher** `events/interactionCreate.ts` là error boundary duy nhất. Nó hiển thị `UserError` nguyên văn và kiểm tra `adminOnly` (lớp quyền 2).
- **Button**: `customId` có dạng `<namespace>:<payload>`. Namespace khai báo trong `buttonIds`; command tự validate payload.
- **Hiển thị**: dựng embed/nút bằng hàm thuần trong `src/discord/views/`, dùng helper trong `src/discord/format.ts`.
- **Trang web quản trị** (`src/web/`, DEC-039): tầng ngang hàng tầng Discord, chạy trong cùng process (node:http, tắt khi không đặt `WEB_PORT`). Đăng nhập bằng Discord OAuth2; server kiểm tra quyền admin ở mỗi request, CSRF và Host/Origin trước khi gọi trang. Trang gọi đúng service và `src/discord/configOps.ts` như lệnh `/config`, không tự viết lại quy tắc. HTML chỉ dựng bằng template `html` (tự escape); không style hay script inline (CSP).

Lỗi đã biết và bài học: `docs/ai/LESSONS_LEARNED.md`. Đọc trước khi sửa dispatcher, loader, ledger, migration hay cơ chế config.

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
2. Không tự thêm PostgreSQL, MySQL, MongoDB, Redis, Kafka, RabbitMQ, microservices, Kubernetes, API server riêng, database server riêng, external SaaS, cloud service, dashboard, Docker. (Ngoại lệ đã duyệt: trang web quản trị nhúng trong process bot, chỉ mạng nội bộ, DEC-039. Không mở rộng ngoại lệ này khi chưa có proposal mới.)
3. Không tự thêm external service hay network call.
4. Không tự cấp quyền Administrator.
5. Không tự quyết định hoặc thay đổi công thức scoring hay business rule.
6. Không tự thay đổi architecture lớn.
7. Không tự thêm dependency.

## Quy tắc database

- Chỉ một file SQLite do bot sở hữu, truy cập qua better-sqlite3.
- Chỉ dùng parameter binding (`?` hoặc named). Không bao giờ nối chuỗi vào SQL.
- Mọi thay đổi schema phải là một migration MỚI trong `src/db/migrations.ts` (version tăng dần). Không bao giờ sửa migration đã phát hành, không sửa schema bằng tay.
- Mọi bảng có `guild_id`. Reset hay gỡ chỉ đánh dấu `voided_at`, không xoá dòng dữ liệu (DEC-027).
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

### Chia việc cho nhiều agent song song

- Chốt interface và dữ liệu dùng chung trước. Hợp đồng phải ghi cả **ý nghĩa** của từng trường (ví dụ target và details của audit), không chỉ kiểu dữ liệu (LL-011).
- Mỗi agent chỉ sửa các file mình được giao, làm trong worktree riêng.
- Sau khi gộp, phải có test tích hợp chạy qua code thật của các bên.

### Test và hoàn tất task

Task chỉ được coi là xong khi `npm run check` (build + lint + test) pass, hoặc khi đã ghi rõ lý do lệnh fail. Service được test với SQLite `:memory:` và migration thật, không mock DB.

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
