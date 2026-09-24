# ARCHITECTURE

> Cập nhật lần cuối: 2026-09-24, audit Phase 0 tại commit `cdce792`.
> Mô tả kiến trúc **hiện tại** (theo source code thực tế) và kiến trúc **mục tiêu**.
> Phần mục tiêu chưa được duyệt được đánh dấu rõ kèm mã proposal.

## 1. Kiến trúc hiện tại

### 1.1 Tổng quan

Khung "command framework" từ template open-source:

- Command và event được nạp tự động bằng cách quét thư mục.
- Mỗi command tự đảm nhận mọi việc: khai báo slash command, đọc input, chạy SQL, định dạng output.
- SQLite được truy cập qua một static singleton.
- Không có tầng service, không có repository, không có migration, không có test.

```
Mong muốn :  Discord → Command/Event (mỏng) → Service → Repository → SQLite
Hiện tại  :  Discord → Event dispatcher → Command (làm tất cả) ─────→ static Sqlite → SQLite
```

### 1.2 Luồng khởi động

```
src/index.ts
├── new DiscordClient()                              constructor có side-effect
│   ├── events       = new EventHandler(this)        quét src/events/* → client.on/once(name, execute)
│   ├── interactions = new InteractionHandler(this)  quét interactions/commands + contextMenus → Collection<name, Command|ContextMenu>
│   ├── buttons      = new ButtonHandler(this)       gom Command.buttonIds → Collection<customId, Command>
│   ├── new ProcessManager(this)                     SIGINT; message "shutdown" (chỉ đăng ký trên win32)
│   └── this.login(token)                            token import từ src/config.json
└── new Sqlite()                                     instance thừa: không nằm trong singleton, không bao giờ được dùng
```

Thứ tự khởi tạo class field (`events` → `interactions` → `buttons`) là quan trọng: `ButtonHandler` đọc `client.interactions` đã được nạp. Các hàm `init()` được khai báo `async` nhưng thân hàm hoàn toàn đồng bộ (`readdirSync`, `require`), nên tất cả nạp xong trước khi gọi `login()`.

### 1.3 Luồng runtime

```
Discord Gateway (intent: Guilds; partial: Channel)
 ├─ "ready" ─────────────► events/ready.ts
 │                          ├─ await InteractionHandler.deploy()   REST PUT: guild command (theo guildIds) + global command
 │                          └─ Sqlite.setup()                      exec db/setup.sql (SAU khi deploy)
 └─ "interactionCreate" ─► events/interactionCreate.ts  (dispatcher duy nhất)
        ├─ isChatInputCommand ─► Command.execute()
        ├─ isButton           ─► ButtonHandler.get(customId).executeButton()
        ├─ isContextMenu      ─► ContextMenu.execute()
        └─ isAutocomplete     ─► Command.autocomplete() → interaction.respond()
                                   └─ (note.ts) Sqlite.prepare(sql) → better-sqlite3 → db/data.db
```

Chưa có event `messageCreate`, nên hiện chưa có đường nào để nhận tin nhắn cho Activity XP.

### 1.4 Trách nhiệm từng thành phần

| File | Trách nhiệm | Vấn đề đã biết |
| --- | --- | --- |
| `src/index.ts` | Entry point | Tạo `new Sqlite()` thừa (LL-007) |
| `classes/DiscordClient.ts` | Kế thừa `Client`; intents, partials, tạo handler, gọi login | Login trong constructor; `login()` không được await; không có `client.on("error")` |
| `classes/Command.ts`, `ContextMenu.ts`, `Event.ts` | Base class | Method ném lỗi "not implemented" thay vì `abstract`; `execute(): void` nhưng subclass là async (LL-001) |
| `classes/ProcessManager.ts` | Tắt bot có kiểm soát | Không xử lý SIGTERM; không đóng DB; message "shutdown" chỉ nghe trên win32 |
| `classes/Sqlite.ts` | Static singleton better-sqlite3; `prepare()`, `setup()` | Không PRAGMA, không migration, không transaction; mở 2 connection (LL-007) |
| `handlers/EventHandler.ts` | Nạp event động | `require` mọi file bất kể đuôi; promise trả về từ `execute` không được xử lý |
| `handlers/InteractionHandler.ts` | Nạp command/context menu; `deploy()` | Tạo REST client riêng bằng `@discordjs/rest` v1; `guildIds.forEach(async)` không được await; slash command và context menu dùng chung một Collection |
| `handlers/ButtonHandler.ts` | Map customId → Command | Chỉ so khớp chính xác; không hỗ trợ customId động (cần cho voting) |
| `events/interactionCreate.ts` | Dispatcher | Không await → `try/catch` vô dụng (LL-001); autocomplete không có try/catch; `catch` luôn gọi `reply` kể cả khi đã reply |
| `events/ready.ts` | Deploy command, rồi setup DB | Thứ tự sai: DB setup chạy sau một network call (LL-007) |
| `interactions/commands/*.ts`, `contextMenus/*.ts` | Code demo: `ping`, `clickme`, `note`, `Get User Info` | `note.ts` gộp UI, SQL và format; không có kiểm tra quyền |
| `db/setup.sql` | DDL bảng `notes` (demo) | Chạy lại mỗi lần start; không có version |
| `ecosystem.config.js` | Cấu hình pm2 | `wait_ready: true` nhưng code không gửi `process.send("ready")` |

### 1.5 Hướng phụ thuộc hiện tại

- Command phụ thuộc trực tiếp vào static `Sqlite` và class `DiscordClient` cụ thể. Command truy cập mọi thứ qua `this.client` (kiểu service locator).
- `config.json` được import trực tiếp ở 2 nơi: `DiscordClient.ts`, `InteractionHandler.ts`.
- Có import vòng giữa `DiscordClient` → handlers → `Command`/`Event` → `DiscordClient`. Phía `Command`/`Event` chỉ dùng `DiscordClient` làm type, nên TypeScript lược bỏ khi compile và không gây lỗi runtime.
- Các handler kế thừa `Collection` của discord.js, tức là dùng inheritance thay vì composition.

### 1.6 Cấu hình và secret

- `src/config.json` (gitignored) chứa `token`, `clientId`, `guildIds`; file mẫu là `src/example_config.json`.
- Được import qua `resolveJsonModule`, nên `tsc` **copy nguyên file sang `build/config.json`** (LL-002). Hệ quả là build cũng fail nếu thiếu file này.
- Không dùng biến môi trường.

### 1.7 Giao tiếp ra bên ngoài

| Thời điểm | Đích | Qua |
| --- | --- | --- |
| Runtime | Discord Gateway (WebSocket) | discord.js |
| Runtime | Discord REST API | discord.js (`@discordjs/rest` 2.x bên trong) + `@discordjs/rest` 1.x khai báo riêng |
| Cài đặt | GitHub Releases (binary dựng sẵn); nếu không có thì node-gyp tải Node headers | install script của `better-sqlite3` (`prebuild-install`) |

Không có webhook, telemetry, HTTP server hay port nào được mở.

### 1.8 Dependency runtime

```
discord.js 14.18.0 ─┬─ @discordjs/rest 2.4.3 ── undici 6.21.1
                    ├─ @discordjs/ws ── ws 8.18.1
                    └─ @discordjs/builders ── @sapphire/shapeshift ── lodash
@discordjs/rest 1.7.1 ── undici 5.29.0, file-type        (trùng chức năng với bản bên trong discord.js)
discord-api-types 0.37.119                                (discord.js đã re-export)
better-sqlite3 8.7.0 ── prebuild-install ── tar-fs       (native addon)
```

## 2. Kiến trúc mục tiêu

### 2.1 Phần đã chốt (DEC-007)

```
Discord → Command/Event (mỏng) → Service → Repository → SQLite
```

- Business module **không phụ thuộc discord.js**. Module nhận dữ liệu thuần: `userId`, `channelId`, `roleIds[]`, timestamp, ...
- Tầng Discord càng mỏng càng tốt: nhận event, chuyển đổi dữ liệu, gọi service, định dạng phản hồi.
- Activity XP và Contribution là hai miền dữ liệu tách biệt (DEC-004).
- Topology: 1 process + 1 file SQLite (DEC-002).

### 2.2 Cấu trúc module đề xuất — CHƯA DUYỆT (PROP-011)

```
src/
├── index.ts          Composition root: config → DB → migrate → repositories/services → client → login
├── config/           Đọc và validate cấu hình; lỗi thì dừng ngay
├── discord/          Tầng giao tiếp Discord, tái sử dụng khung loader/dispatcher hiện có
│   ├── loader/       Từ EventHandler / InteractionHandler / ButtonHandler
│   ├── guards/       Error boundary, kiểm tra quyền admin
│   ├── events/       ready, interactionCreate, messageCreate
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

| Hiện có | Dự kiến |
| --- | --- |
| `EventHandler`, `InteractionHandler` (phần nạp) | Giữ, sửa cách xử lý async và lọc file |
| `ButtonHandler` | Giữ, thêm so khớp theo prefix |
| `interactionCreate.ts` | Giữ làm dispatcher, thêm error boundary và kiểm tra quyền |
| Base class `Command` / `ContextMenu` / `Event` | Giữ ý tưởng, chuyển sang `abstract`, nhận service qua tham số |
| `InteractionHandler.deploy()` | Sửa: dùng REST có sẵn của discord.js |
| `Sqlite` | Thay bằng connection được inject + migration (PROP-007) |
| `ProcessManager` | Sửa (PROP-018) |
| Demo command, `setup.sql`, `types/Note.ts` | Xoá khi đã có command thật (PROP-019) |

## 3. Topology triển khai

| | Hiện tại | Hướng mục tiêu (theo brief) |
| --- | --- | --- |
| Process | 1 process Node (pm2 tuỳ chọn) | 1 process Node |
| Database | `<root>/db/data.db` | `data/bot.db` |
| Secret | `src/config.json` (bị copy vào `build/`) | `.env` (PROP-005) |
| Hạ tầng khác | Không | Không |
