# CURRENT STATE

> Đọc file này đầu tiên ở mỗi phiên. Cập nhật sau mỗi phase hoặc task đáng kể.
> Cập nhật lần cuối: **2026-09-24**

## 1. Phase hiện tại

**Phase 0 — Audit và khởi tạo AI Operating System: HOÀN THÀNH, đã được duyệt.**

Đang **chờ người phụ trách duyệt** phạm vi Phase 1 và các quyết định trong `DECISIONS.md` → "Đang chờ quyết định". **Chưa được phép bắt đầu Phase 1.**

## 2. Snapshot repository

| Mục | Giá trị |
| --- | --- |
| Branch | `main` = `cdce792` (commit cuối của upstream, không tracking remote nào). Tài liệu Phase 0 nằm trên branch `phase-0/ai-os-init` |
| Remote | Chỉ có `upstream` → `https://github.com/Retr0-01/discordjs-core-bot.git` (public, bên thứ ba). Chỉ fetch; push bị vô hiệu hoá (DEC-013) |
| Remote nội bộ | CHƯA XÁC ĐỊNH. Hiện chỉ làm việc local, chưa publish |
| License | MIT, © 2022 Retr0-01 |
| Code đặc thù công ty | Chưa có |

## 3. Tình trạng build và công cụ

Kiểm chứng ngày 2026-09-24 trên Windows 11, Node 22.12.0, npm 10.9.0. Các lệnh chạy trên **bản copy cô lập** (xem mục 6) tại commit `cdce792`, không đụng tới repo.

| Lệnh | Kết quả | Nguyên nhân |
| --- | --- | --- |
| `npm ci` | **FAIL** | better-sqlite3 8.7.0 không có binary dựng sẵn cho Node 22; node-gyp không tìm thấy Visual Studio (LL-005) |
| `npm ci --ignore-scripts` | OK (213 package) | Bỏ qua bước build native, nên **bot vẫn không chạy được** |
| `npm run build` | **FAIL**, 97 lỗi | TypeScript 4.9.5 không đọc được file type của discord.js 14.18 (LL-004) |
| `tsc` với TS 5.5 (thử tạm) | FAIL, 5 lỗi | 3 lỗi do `target: ES6` (BigInt), 2 lỗi `unknown` → `Note` ở `note.ts` |
| `npm run lint` | OK, 0 lỗi | Không đáng tin: lint không dùng thông tin type (LL-006) |
| Test | Không có | Không có test framework, không có script `test` |
| `npm audit` | 13 lỗ hổng (4 moderate, 9 high) | 7 trong số đó ở dependency production. Chi tiết: PROP-004 |
| Chạy bot | Chưa thử | Chưa cài và build được; cũng không có token thật |

## 4. Blocker

| # | Blocker | Chi tiết | Hướng xử lý |
| --- | --- | --- | --- |
| B1 | Không compile được | LL-004 | PROP-001 |
| B2 | Không cài được trên Node 22 nếu thiếu C++ build tools | LL-005 | PROP-002 |
| B3 | Lỗi bất kỳ trong command hay event làm sập process | LL-001 | PROP-003 |

## 5. Đã hoàn thành

- [x] Audit toàn bộ source, dependency, security, database, TypeScript (2026-09-24).
- [x] Tạo `CLAUDE.md` và `docs/ai/` (PROJECT_CONTEXT, ARCHITECTURE, DECISIONS, LESSONS_LEARNED, PROPOSALS, CURRENT_STATE, ROADMAP).
- [x] Ghi 12 quyết định đã chốt (DEC-001…012) từ brief, 13 quyết định đang chờ (PEND-001…013), 7 bài học (LL-001…007), 20 proposal (PROP-001…020).
- [x] Tách git khỏi upstream public, làm việc local (PROP-006 → IMPLEMENTED, DEC-013). Tách phần metadata thành PROP-021.
- [x] Commit tài liệu Phase 0 lên branch local `phase-0/ai-os-init`.

## 6. Cách kiểm chứng mà không làm bẩn repo

Dùng khi cần chạy `npm ci`, build hoặc audit mà chưa muốn tạo `node_modules` hay sửa gì trong repo:

```bash
git archive HEAD | tar -x -C <thư-mục-tạm>
cd <thư-mục-tạm>
npm ci --ignore-scripts                  # hoặc npm ci để kiểm tra native build
cp src/example_config.json src/config.json   # code import file này lúc compile
npm run build; npm run lint; npm audit
```

## 7. Việc tiếp theo (sau khi được duyệt)

1. Người phụ trách trả lời các PEND, ưu tiên PEND-001, 002, 003, 005.
2. Duyệt hoặc từ chối các proposal của Phase 1 (xem `ROADMAP.md`).
3. Bắt đầu Phase 1 — ổn định nền.

## 8. Nhật ký cập nhật

| Ngày | Thay đổi |
| --- | --- |
| 2026-09-24 | Khởi tạo: audit Phase 0, tạo AI Operating System. Không sửa code. |
| 2026-09-24 | Phase 0 được duyệt. Remote `origin` → `upstream` (push bị vô hiệu hoá), bỏ tracking của `main`. Commit tài liệu lên `phase-0/ai-os-init`. |
