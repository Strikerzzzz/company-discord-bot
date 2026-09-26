# CURRENT STATE

> Đọc file này đầu tiên ở mỗi phiên. Cập nhật sau mỗi phase hoặc task đáng kể.
> Cập nhật lần cuối: **2026-09-26**

## 1. Phase hiện tại

**Phase 1 — Ổn định nền: gần xong.** Bước 1–5 cùng PROP-022, PROP-023 đã xong, đã kiểm chứng và **đã merge vào `main`** (DEC-019). **Còn bước 6 (chạy bot thật trên server test)**, đang chờ người phụ trách cung cấp bot và server test.

- Phase 0: hoàn thành, đã duyệt, đã merge vào `main`.
- Nếu bước 6 phát hiện lỗi: sửa trên branch mới tách từ `main`.

## 2. Snapshot repository

| Mục | Giá trị |
| --- | --- |
| `main` | Đã gồm toàn bộ Phase 0 và Phase 1 (trừ bước 6) |
| Branch cũ | `phase-0/ai-os-init`, `phase-1/on-dinh-nen`: đã merge, giữ để tham khảo |
| Remote | Chỉ có `upstream` → repo public của template (chỉ fetch, push bị vô hiệu hoá, DEC-013) |
| Remote nội bộ | CHƯA XÁC ĐỊNH. Hiện chỉ làm việc local |
| License | MIT, © 2022 Retr0-01 |
| Code nghiệp vụ | Chưa có (đúng phạm vi Phase 1) |

## 3. Tình trạng build và công cụ

Kiểm chứng ngày 2026-09-24 trên **bản copy sạch** (`git archive`) và trong repo. Máy dev: Windows 11, Node **22.23.2** (đã nâng từ 22.12.0, xem LL-009), npm 10.9.8.

| Lệnh | Kết quả |
| --- | --- |
| `npm ci` (bản copy sạch) | OK. `.npmrc` tắt install script (LL-008) |
| `npm run build` | OK, 0 lỗi; `build/` không có file JSON và không chứa secret |
| `npm run lint` | OK, 0 lỗi (ESLint 10 + typescript-eslint có dùng thông tin type) |
| `npm audit` | **0 lỗ hổng** (trước Phase 1: 13, trong đó 9 high) |
| better-sqlite3 | Load được trên Node 22.23.2 và Node 24.21.0 (thử qua npx) |
| Khởi động khi thiếu hoặc sai config | Báo lỗi rõ ràng, exit 1, không in token |
| Khởi động với token giả | Discord trả `TokenInvalid`, exit 1, không in token |
| Test tự động | Chưa có test framework (PROP-009, Phase 2). Phase 1 kiểm chứng bằng script tạm ngoài repo |
| Chạy bot thật trên Discord | **Chưa**: chờ bước 6 |

## 4. Blocker của Phase 0

| # | Blocker | Trạng thái |
| --- | --- | --- |
| B1 | Không compile được | **Đã xử lý**: PROP-001 |
| B2 | Không cài được trên Node 22 nếu thiếu C++ build tools | **Đã xử lý**: PROP-002, `.npmrc` (LL-008) |
| B3 | Lỗi bất kỳ trong command hay event làm sập process | **Đã xử lý**: PROP-003; lint chặn tái phát (PROP-010) |

## 5. Phase 1: chi tiết

| Bước | Nội dung | Commit | Trạng thái |
| --- | --- | --- | --- |
| 0 | Ghi quyết định mở Phase 1 (DEC-014…018) | `1a70099` | Xong |
| 1 | TypeScript 5.9, better-sqlite3 13, discord.js 14.27; bỏ 2 dependency; metadata `package.json` | `41ba1fe` | Xong |
| 2 | Error boundary, async đúng, base class abstract | `b8a6c3a` | Xong |
| 3 | Secret qua biến môi trường / `.env` | `03f9c9f` | Xong |
| 4 | Hardening tầng Discord | `f7d03b4`, `5d828a7` | Xong |
| 5 | ESLint 10 có dùng thông tin type | `b9c3200`, `68cc49f` | Xong |
| — | `.npmrc ignore-scripts` (phát hiện khi kiểm chứng trên bản copy sạch) | `b9d8218` | Xong |
| — | PROP-022 `@types/node` ^24 | `17d809d` | Xong |
| — | PROP-023 `.gitattributes` eol=lf | `3d6c0e7` | Xong |
| 6 | Chạy bot thật trên server test: login, deploy command, `/ping`, lỗi cố ý không làm sập bot | — | **Chờ bot và server test** |

Ngoài repo: Node của máy dev đã được nâng 22.12.0 → 22.23.2 qua winget, theo chỉ thị "cần thì cập nhật" (DEC-016).

**Điều kiện hoàn thành Phase 1** (theo `ROADMAP.md`):
- `npm ci`, build, lint pass trên máy sạch: ✅
- `build/` không chứa secret: ✅
- Không còn lỗ hổng high trong dependency production: ✅ (0 lỗ hổng)
- Lỗi cố ý trong command không làm sập process: ✅ (kiểm chứng bằng interaction giả; cần xác nhận lại trên Discord thật ở bước 6)
- Bot login được trên guild test: ⏳ bước 6

## 6. Cách kiểm chứng mà không làm bẩn repo

```bash
git archive HEAD | tar -x -C <thư-mục-tạm>
cd <thư-mục-tạm>
npm ci
npm run build && npm run lint && npm audit
```

Ghi chú khi chạy script trên máy dev (Windows):
- Git Bash làm mất dấu `\` khi truyền đối số `node -e '...'` sang `node.exe`, nên script có regex hoặc escape phải viết ra file rồi chạy.
- Từ PROP-023, working copy dùng LF trên mọi máy.

## 7. Việc tiếp theo

1. Người phụ trách chuẩn bị Discord Application test và server test, rồi tạo `.env` trên máy dev để chạy bước 6.
2. Người phụ trách xin cấp server Linux nội bộ (PEND-005).
3. Trả lời các PEND còn mở trước Phase 2: PEND-010, 011, 012, 013, 014.
4. Duyệt hoặc từ chối PROP-007, 009, 011 (phạm vi Phase 2).

## 8. Nhật ký cập nhật

| Ngày | Thay đổi |
| --- | --- |
| 2026-09-24 | Khởi tạo: audit Phase 0, tạo AI Operating System. Không sửa code. |
| 2026-09-24 | Phase 0 được duyệt. Remote `origin` → `upstream` (push bị vô hiệu hoá), bỏ tracking của `main`. Commit tài liệu lên `phase-0/ai-os-init`. |
| 2026-09-24 | Merge Phase 0 vào `main`. Mở Phase 1 (DEC-014…018). Hoàn thành bước 1–5 cùng `.npmrc`; nâng Node máy dev lên 22.23.2. Chờ bước 6. |
| 2026-09-26 | DEC-019: làm PROP-022, PROP-023; merge Phase 1 vào `main`. Bước 6 vẫn chờ bot và server test. |
