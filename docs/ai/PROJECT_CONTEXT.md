# PROJECT CONTEXT

> Bối cảnh tổng thể của dự án. Nguồn: brief của người phụ trách dự án (2026-09-24) và kết quả audit source code ở Phase 0.
> Yêu cầu sản phẩm thay đổi → cập nhật file này. Quyết định kỹ thuật → ghi vào `DECISIONS.md`.

## 1. Mục đích

Xây dựng Discord bot **nội bộ công ty** phục vụ:

- **Gamification** hoạt động trên Discord (Activity XP).
- **Ghi nhận đóng góp** có giá trị của nhân viên (Contribution).

Đây là công cụ nội bộ, không phải sản phẩm SaaS. Ưu tiên theo thứ tự: đơn giản, dễ vận hành, an toàn, dễ test.

## 2. Nguồn gốc repository

| Mục | Giá trị |
| --- | --- |
| Upstream | `Retr0-01/discordjs-core-bot` v2.0.0 (template open-source) |
| License | MIT, © 2022 Retr0-01 (`LICENCE.md`) |
| Remote `upstream` | `https://github.com/Retr0-01/discordjs-core-bot.git` (public, của bên thứ ba). Chỉ fetch, push bị vô hiệu hoá (DEC-013) |
| Remote nội bộ | CHƯA XÁC ĐỊNH. Hiện chỉ làm việc local |
| Branch | `main` (chỉ có một branch local) |
| Commit mới nhất khi tiếp quản | `cdce792` "update depends" (2025-03-29) |
| Commit đầu tiên | "Init" (2022-09-03) |
| Code đặc thù công ty | Chưa có (tính tới Phase 0) |

## 3. Yêu cầu sản phẩm

### 3.1 Activity XP

Luồng: tin nhắn hợp lệ → Activity XP → Level → Activity Leaderboard.

Yêu cầu:

- XP, Level, Rank.
- Individual Activity Leaderboard và Team Activity Leaderboard.
- Cooldown; cooldown cấu hình được theo channel.
- Anti-spam, chống farm XP.
- Cấu hình XP theo channel; tắt được XP ở từng channel (excluded channel).
- Admin điều chỉnh và reset được XP.

**Không được cộng XP cho mọi tin nhắn.** Ví dụ phải bị chặn: một người gửi liên tục `ok`, `ok`, `ok`, `haha`, `haha`, `abc`, `abc` để farm XP.

### 3.2 Contribution

Hoàn toàn độc lập với Activity XP. Contribution Score **không** được cộng từ số lượng tin nhắn.

Luồng: contribution (ý tưởng, giải pháp, cải tiến quy trình, tài liệu, chia sẻ kiến thức, ...) → người khác vote/recognize → Contribution Score → Contribution Leaderboard.

**Không được gộp** Activity XP và Contribution Score thành một loại điểm.

### 3.3 Team

- Team xác định chủ yếu bằng Discord Role (ví dụ: Backend, Frontend, QA, DevOps, Product; role thực tế do công ty cấu hình).
- Không xây hệ thống employee/team database phức tạp nếu Discord Role đã đủ.
- Cần 4 bảng xếp hạng: Individual Activity, Team Activity, Individual Contribution, Team Contribution.
- **Công thức tính team score: CHƯA QUYẾT ĐỊNH.**

### 3.4 Channel

Hỗ trợ cấu hình theo từng channel. Ví dụ trong brief (chỉ để minh hoạ, **không hard-code**):

| Channel | Quy tắc ví dụ |
| --- | --- |
| `#general`, `#knowledge` | Có XP |
| `#contribution` | Có XP hoặc có rule riêng (chưa quyết) |
| `#bot`, `#announcements` | Không có XP |

Admin phải cấu hình được các quy tắc này.

### 3.5 Admin

- Xem / give / remove / reset XP.
- Xem / điều chỉnh / reset contribution score.
- Cấu hình channel XP, cooldown, excluded channel, team role.
- Xem leaderboard, statistics.
- Audit log.
- MVP dùng slash command. Dashboard không bắt buộc, và không xây chỉ vì có sẵn trong template (template hiện không có dashboard).

### 3.6 Database ở mức khái niệm

Brief liệt kê các nhóm dữ liệu có thể cần, **chỉ mang tính định hướng, không phải schema**:
`users`, `activity_xp`, `channel_xp_config`, `contributions`, `contribution_votes`, `team_config`, `guild_config`, `admin_actions`, `statistics`.

Schema nghiệp vụ chỉ được tạo sau khi thiết kế được duyệt.

## 4. Ràng buộc

### 4.1 Hạ tầng

- Mục tiêu: 1 server hoặc máy + 1 process Node.js + 1 file SQLite.
- Layout triển khai ví dụ trong brief: `src/`, `data/bot.db`, `.env`, `package.json`.
- Danh sách những thứ bị cấm tự ý thêm: xem mục "Luật bảo vệ" trong `CLAUDE.md`.

### 4.2 Database

Bot dùng database riêng, **không bao giờ** truy cập database sản phẩm của công ty.

### 4.3 Bảo mật

Bot có ít quyền nhất nhưng vẫn đủ để hoạt động (least privilege). Không dùng Administrator.

### 4.4 Cách làm việc

- Không rewrite toàn bộ. Tận dụng code tốt, thay đổi nhỏ và có kiểm soát.
- Không tự quyết định scoring formula.
- Mọi thay đổi architecture lớn phải được giải thích và duyệt trước.

## 5. Ngoài phạm vi (non-goals)

- Dashboard hoặc web UI ở MVP.
- Tích hợp với hệ thống hoặc database sản phẩm của công ty.
- Hệ thống quản lý nhân sự/team riêng.
- Triển khai nhiều instance, scale ngang.

## 6. Thuật ngữ

| Thuật ngữ | Nghĩa trong dự án |
| --- | --- |
| Activity XP | Điểm phản ánh hoạt động nhắn tin hợp lệ trên Discord |
| Level / Rank | Cấp độ suy ra từ XP / thứ hạng trên leaderboard. Công thức chưa quyết |
| Contribution | Một đóng góp có giá trị do nhân viên đưa ra, được người khác ghi nhận |
| Contribution Score | Điểm từ vote/recognition cho contribution; độc lập với XP |
| Team | Nhóm suy ra từ Discord Role đã được admin cấu hình |
| Guild | Discord server |
| Excluded channel | Channel không tính XP |
| Protected rule | Luật nền tảng trong `CLAUDE.md`, chỉ đổi qua proposal được duyệt |
