#!/usr/bin/env bash
# Cài (hoặc cập nhật) bot từ bản đã build sẵn trong thư mục staging của tài khoản quản trị (mặc định ~/deploy/src), khi
# server chưa có remote git (DEC-036). Làm theo docs/DEPLOY.md mục 3-4: code thuộc root, chỉ data/ thuộc discordbot,
# .env root 600. Không bật hay khởi động lại bot: bước đó nằm trong start.sh, chạy sau selfcheck.
# Chạy: sudo bash ~/deploy/install.sh   (đổi thư mục staging: sudo STAGING=/đường/dẫn bash install.sh)
set -euo pipefail

APP=/opt/company-discord-bot
UNIT=/etc/systemd/system/company-discord-bot.service

if [ "$(id -u)" -ne 0 ]; then echo "Hãy chạy bằng: sudo bash ~/deploy/install.sh"; exit 1; fi
ADMIN_USER="${SUDO_USER:-}"
if [ -z "$ADMIN_USER" ] || [ "$ADMIN_USER" = "root" ]; then echo "Hãy chạy bằng sudo từ tài khoản quản trị (không đăng nhập thẳng bằng root)."; exit 1; fi
ADMIN_HOME="$(getent passwd "$ADMIN_USER" | cut -d: -f6)"
STAGING="${STAGING:-$ADMIN_HOME/deploy}"
SRC="$STAGING/src"

for f in build/index.js build/selfcheck.js deploy/company-discord-bot.service .env.example node_modules/better-sqlite3/package.json; do
	if [ ! -e "$SRC/$f" ]; then echo "Thiếu $SRC/$f (chưa build xong?)"; exit 1; fi
done
if [ "$(command -v node)" != "/usr/bin/node" ]; then echo "node không nằm ở /usr/bin/node, cần sửa ExecStart trong unit"; exit 1; fi

echo "[1/6] User hệ thống discordbot"
if getent passwd discordbot >/dev/null; then echo "  đã có"; else useradd --system --no-create-home --shell /usr/sbin/nologin discordbot; echo "  đã tạo"; fi

echo "[2/6] Chép code vào $APP (giữ nguyên data/ và .env)"
install -d -m 755 -o root -g root "$APP"
find "$APP" -mindepth 1 -maxdepth 1 ! -name data ! -name .env -exec rm -rf {} +
tar -C "$SRC" --exclude=./build-test --exclude=./data --exclude=./.env -cf - . | tar -C "$APP" --no-same-owner --no-same-permissions -xf -
if [ -f "$STAGING/REVISION" ]; then install -m 644 -o root -g root "$STAGING/REVISION" "$APP/REVISION"; echo "  bản: $(cat "$APP/REVISION")"; fi

echo "[3/6] Thư mục dữ liệu (chỉ discordbot truy cập)"
install -d -m 700 -o discordbot -g discordbot "$APP/data"

echo "[4/6] File cấu hình .env (root, quyền 600)"
if [ -f "$APP/.env" ]; then echo "  đã có, giữ nguyên"; else install -m 600 -o root -g root "$APP/.env.example" "$APP/.env"; echo "  đã tạo từ .env.example"; fi
chown root:root "$APP/.env"
chmod 600 "$APP/.env"

echo "[5/6] Cài systemd unit (chưa bật hay khởi động lại)"
install -m 644 -o root -g root "$APP/deploy/company-discord-bot.service" "$UNIT"
systemctl daemon-reload

echo "[6/6] Cho tài khoản $ADMIN_USER đọc log hệ thống không cần sudo (nhóm systemd-journal)"
usermod -aG systemd-journal "$ADMIN_USER"

echo
echo "XONG. Bước tiếp theo:"
echo "  - Lần đầu: sudo nano $APP/.env  -> điền DISCORD_TOKEN và DISCORD_GUILD_IDS (Ctrl+O, Enter để lưu; Ctrl+X để thoát)"
echo "  - Rồi: sudo bash $STAGING/start.sh  (selfcheck, không có lỗi thì bật hoặc khởi động lại bot)"
