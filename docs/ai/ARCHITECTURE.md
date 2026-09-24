# ARCHITECTURE

> Cập nhật lần cuối: 2026-09-24, sau Phase 1 bước 1–5 (branch `phase-1/on-dinh-nen`).
> Mô tả kiến trúc **hiện tại** (theo source code thực tế) và kiến trúc **mục tiêu**.
> Phần mục tiêu chưa được duyệt được đánh dấu rõ kèm mã proposal.

## 1. Kiến trúc hiện tại

### 1.1 Tổng quan

Khung "command framework" từ template open-source, đã được làm chắc ở Phase 1:

- Command và event được nạp tự động bằng cách quét thư mục (`loadModules`), có kiểm tra kiểu lúc runtime.
- Dispatcher `interactionCreate` là error boundary chung: lỗi trong một command không làm sập bot.
- Token và cấu hình đọc từ biến môi trường (`src/config.ts`).
- Vẫn chưa có tầng service, repository, migration hay test. Code demo (`note.ts`) vẫn gộp UI, SQL và format output.

```
Mong muốn :  Discord → Command/Event (mỏng) → Service → Repository → SQLite
Hiện tại  :  Discord → Event dispatcher (error boundary) → Command (làm tất cả) → static Sqlite → SQLite
```

### 1.2 Luồng khởi động

```
src/index.ts   main()
├── loadConfig()                                     đọc DISCORD_TOKEN, DISCORD_GUILD_IDS; thiếu hoặc sai → lỗi rõ ràng, exit(1)
├── new DiscordClient(guildIds)
│   ├── events       = new EventHandler(this)        loadModules(src/events) → client.on/once(name, listener có .catch)
│   ├── interactions = new InteractionHandler(this)  loadModules(commands) → commands; loadModules(contextMenus) → contextMenus
│   ├── buttons      = new ButtonHandler(this)       namespace trong Command.buttonIds → Command
│   ├── on("error")                                  log lỗi của discord.js client
│   └── new ProcessManager(this)                     SIGINT; message "shutdown" (chỉ win32) → destroy() rồi exit
├── new Sqlite()                                     instance thừa, không nằm trong singleton (LL-007, chờ PROP-007)
└── await client.login(token)
process.on("unhandledRejection")                     chỉ log (lưới an toàn cuối cùng)
```

Thứ tự khởi tạo class field (`events` → `interactions` → `buttons`) là quan trọng: `ButtonHandler` đọc `client.interactions.commands` đã được nạp. Toàn bộ việc nạp là đồng bộ (`readdirSync`, `require`), nên xong trước khi gọi `login()`.

### 1.3 Luồng runtime

```
Discord Gateway (intent: Guilds)
 ├─ "clientReady" ───────► events/ready.ts
 │                          ├─ await InteractionHandler.deploy(guildIds)
 │                          │    ├─ application.commands.set(tất cả command, guildId)   cho từng guild; lỗi một guild thì chỉ log
 │                          │    └─ application.commands.set([])                        dọn global command cũ
 │                          └─ Sqlite.setup()                                         exec db/setup.sql (vẫn SAU deploy, LL-007)
 └─ "interactionCreate" ─► events/interactionCreate.ts   (dispatcher + error boundary)
        ├─ isChatInputCommand ─► interactions.commands.get(name).execute()
        ├─ isButton           ─► buttons.resolve("<namespace>:<payload>").executeButton()
        ├─ isContextMenu      ─► interactions.contextMenus.get(name).execute()
        └─ isAutocomplete     ─► command.autocomplete() → cắt 25 → respond()
        lỗi bất kỳ ─► log + reply/followUp ephemeral (reply thất bại thì chỉ log)
                                   └─ (note.ts) Sqlite.prepare<Params, Row>(sql) → better-sqlite3 → db/data.db
```

Chưa có event `messageCreate`, nên hiện chưa có đường nào để nhận tin nhắn cho Activity XP.

### 1.4 Trách nhiệm từng thành phần

| File | Trách nhiệm | Vấn đề còn lại |
| --- | --- | --- |
| `src/index.ts` | Composition root tối giản: config → client → login | Còn `new Sqlite()` thừa (LL-007) |
| `src/config.ts` | Đọc và validate biến môi trường, không log secret | — |
| `classes/DiscordClient.ts` | Kế thừa `Client`; intent `Guilds`, `allowedMentions` rỗng, tạo handler, listener `error` | Handler được tạo trong constructor (khó test) |
| `classes/Command.ts`, `ContextMenu.ts`, `Event.ts` | Base class abstract, handler trả về `Promise<void>` | Command nhận cả `DiscordClient` (service locator), chưa nhận service riêng (PROP-011) |
| `classes/ProcessManager.ts` | Tắt bot: đợi `destroy()` rồi exit | Không xử lý SIGTERM, không đóng DB (PROP-018) |
| `classes/Sqlite.ts` | Static singleton better-sqlite3; `prepare<Params, Row>()`, `setup()` | Không PRAGMA, migration, transaction; 2 connection (PROP-007) |
| `handlers/loadModules.ts` | Nạp module theo thư mục: chỉ `.js`/`.ts`, kiểm tra class kế thừa base | — |
| `handlers/EventHandler.ts` | Đăng ký event, bắt reject của mọi listener | — |
| `handlers/InteractionHandler.ts` | Registry `commands` / `contextMenus`; `deploy()` theo guild | — |
| `handlers/ButtonHandler.ts` | Namespace → Command; chặn namespace trùng hoặc chứa `:` | — |
| `events/interactionCreate.ts` | Dispatcher + error boundary | Chưa có kiểm tra quyền (PROP-013) |
| `events/ready.ts` | Event `clientReady`: deploy, rồi setup DB | Thứ tự sai (LL-007) |
| `interactions/commands/*.ts`, `contextMenus/*.ts` | Code demo: `ping`, `clickme`, `note`, `Get User Info` | `note.ts` gộp UI + SQL; không kiểm tra quyền (PROP-019) |
| `db/setup.sql` | DDL bảng `notes` (demo) | Chạy lại mỗi lần start; không có version |
| `ecosystem.config.js` | Cấu hình pm2, nạp `.env` qua `node_args` | `wait_ready: true` nhưng code không gửi `ready` (PROP-018) |

### 1.5 Hướng phụ thuộc hiện tại

- Command phụ thuộc trực tiếp vào static `Sqlite` và class `DiscordClient` cụ thể (kiểu service locator).
- Config chỉ được đọc một lần ở `index.ts`; `guildIds` được truyền vào `DiscordClient`.
- Có import vòng giữa `DiscordClient` → handlers → base class → `DiscordClient`. Phía base class và `loadModules` chỉ dùng `DiscordClient` làm type, nên không gây lỗi runtime.
- `EventHandler` và `ButtonHandler` kế thừa `Collection`; `InteractionHandler` dùng composition (2 Collection).

### 1.6 Cấu hình và secret

- Biến môi trường: `DISCORD_TOKEN`, `DISCORD_GUILD_IDS` (xem `.env.example`).
- `npm run dev` dùng `node --env-file=.env`; `npm run prod` và pm2 dùng `--env-file-if-exists=.env`. Không dùng dotenv.
- Không còn import JSON (`resolveJsonModule` đã tắt); `build/` không chứa secret.
- `.npmrc`: `ignore-scripts=true` (LL-008).

### 1.7 Giao tiếp ra bên ngoài

| Thời điểm | Đích | Qua |
| --- | --- | --- |
| Runtime | Discord Gateway (WebSocket) | discord.js |
| Runtime | Discord REST API | discord.js (`@discordjs/rest` 2.x bên trong) |
| Cài đặt | npm registry | `npm ci` (không có install script nào chạy; binary của better-sqlite3 nằm sẵn trong package) |

Không có webhook, telemetry, HTTP server hay port nào được mở.

### 1.8 Dependency

```
Runtime
discord.js 14.27.0 ─┬─ @discordjs/rest 2.6.3 ── undici 6.28.1
                    ├─ @discordjs/ws ── ws 8.21.3
                    └─ @discordjs/builders, discord-api-types, ... (nội bộ discord.js)
better-sqlite3 13.0.3                            binary N-API 10 kèm sẵn (linux/win32/darwin, x64/arm64); cần Node ≥ 22.14

Dev
typescript 5.9.3 · eslint 10.11 · @eslint/js 10 · typescript-eslint 8.70 · @types/better-sqlite3 9.6
```

`npm audit` (2026-09-24): 0 lỗ hổng.

## 2. Kiến trúc mục tiêu

### 2.1 Phần đã chốt (DEC-007)

```
Discord → Command/Event (mỏng) → Service → Repository → SQLite
```

- Business module **không phụ thuộc discord.js**. Module nhận dữ liệu thuần: `userId`, `channelId`, `roleIds[]`, timestamp, ...
- Tầng Discord càng mỏng càng tốt: nhận event, chuyển đổi dữ liệu, gọi service, định dạng phản hồi.
- Activity XP và Contribution là hai miền dữ liệu tách biệt (DEC-004).
- Topology: 1 process + 1 file SQLite (DEC-002). Production chạy Linux, Node 24 LTS (DEC-016).

### 2.2 Cấu trúc module đề xuất — CHƯA DUYỆT (PROP-011)

```
src/
├── index.ts          Composition root: config → DB → migrate → repositories/services → client → login
├── config/           Đọc và validate cấu hình; lỗi thì dừng ngay
├── discord/          Tầng giao tiếp Discord, tái sử dụng khung loader/dispatcher hiện có
│   ├── loader/       Từ EventHandler / InteractionHandler / ButtonHandler / loadModules
│   ├── guards/       Error boundary, kiểm tra quyền admin
│   ├── events/       clientReady, interactionCreate, messageCreate
│   └── commands/
├── modules/          Business logic, KHÔNG import discord.js
│   ├── activity/     XP, cooldown, anti-spam, level
│   ├── contribution/ Contribution, vote, score
│   ├── leaderboard/  Truy vấn đọc cho 4 bảng xếp hạng
│   ├── team/         Xác định team từ role ID đã cấu hình
│   ├── guild-config/ Cấu hình channel, cooldown, team role
│   ├── admin/        Điều chỉnh/reset điểm + audit log
│   └── statistics/
├── db/               Connection + PRAGMA, migrations/, backup
└── shared/           Logger, kiểu lỗi, Clock
```

Hướng phụ thuộc đề xuất: `discord/` → `modules/` → `db/`. Không được đi theo chiều ngược lại.

### 2.3 Tái sử dụng code hiện có

| Hiện có | Trạng thái |
| --- | --- |
| `EventHandler`, `InteractionHandler`, `loadModules` | Đã sửa ở Phase 1 (async, lọc file, tách registry). Giữ |
| `ButtonHandler` | Đã hỗ trợ namespace ở Phase 1. Giữ |
| `interactionCreate.ts` | Đã có error boundary ở Phase 1; còn thiếu kiểm tra quyền (PROP-013) |
| Base class `Command` / `ContextMenu` / `Event` | Đã abstract ở Phase 1; còn phải nhận service qua tham số (PROP-011) |
| `InteractionHandler.deploy()` | Đã dùng `application.commands.set()` ở Phase 1 |
| `Sqlite` | Thay bằng connection được inject + migration (PROP-007) |
| `ProcessManager` | Sửa tiếp (PROP-018) |
| Demo command, `setup.sql`, `types/Note.ts` | Xoá khi đã có command thật (PROP-019) |

## 3. Topology triển khai

| | Hiện tại | Hướng mục tiêu |
| --- | --- | --- |
| Máy chủ | Máy dev Windows (Node 22.23) | Server Linux, Node 24 LTS (DEC-016); máy cụ thể CHƯA XÁC ĐỊNH (PEND-005) |
| Process | 1 process Node (pm2 tuỳ chọn) | 1 process Node; process manager chờ quyết (PEND-005) |
| Database | `<root>/db/data.db` | `data/bot.db` (PROP-007), sao lưu hàng ngày (DEC-017) |
| Secret | Biến môi trường / `.env` | Biến môi trường / `.env` với quyền file chỉ cho user chạy bot |
| Hạ tầng khác | Không | Không |
