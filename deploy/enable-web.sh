#!/usr/bin/env bash
# Bật trang web quản trị (DEC-039) trên server: ghi cấu hình web vào .env (hỏi Client Secret ẩn, không in, không vào lịch sử
# lệnh), mở cổng trên ufw chỉ cho các dải mạng nội bộ. Không khởi động lại bot: chạy start.sh sau đó.
# Chạy: sudo bash ~/deploy/enable-web.sh http://192.168.0.206:8787
set -euo pipefail

APP=/opt/company-discord-bot
ENV_FILE="$APP/.env"
PRIVATE_NETS=("10.0.0.0/8" "172.16.0.0/12" "192.168.0.0/16")

if [ "$(id -u)" -ne 0 ]; then echo "Hãy chạy bằng: sudo bash ~/deploy/enable-web.sh <WEB_BASE_URL>"; exit 1; fi
BASE_URL="${1:-}"
if ! [[ "$BASE_URL" =~ ^http://([A-Za-z0-9.-]+):([0-9]{4,5})$ ]]; then
	echo "Cần WEB_BASE_URL dạng http://<địa chỉ>:<cổng>, ví dụ: sudo bash ~/deploy/enable-web.sh http://192.168.0.206:8787"
	exit 1
fi
HOST="${BASH_REMATCH[1]}"
PORT="${BASH_REMATCH[2]}"
if [ "$PORT" -lt 1024 ] || [ "$PORT" -gt 65535 ]; then echo "Cổng phải từ 1024 đến 65535."; exit 1; fi
if [ ! -f "$ENV_FILE" ]; then echo "Chưa có $ENV_FILE: chạy install.sh trước."; exit 1; fi

echo "[1/3] Client Secret (Developer Portal → OAuth2 → Client Secret → Reset Secret)"
echo "      Dán vào rồi nhấn Enter. Màn hình sẽ KHÔNG hiện gì khi dán, đó là bình thường."
SECRET=""
read -rs -p "      Client Secret: " SECRET
echo
if [ -z "$SECRET" ] || [[ "$SECRET" =~ [[:space:]] ]]; then echo "Client Secret rỗng hoặc có khoảng trắng. Chưa ghi gì."; exit 1; fi
if [ "${#SECRET}" -lt 16 ]; then echo "Client Secret quá ngắn, có thể dán thiếu. Chưa ghi gì."; exit 1; fi

echo "[2/3] Ghi cấu hình web vào $ENV_FILE (giữ nguyên các dòng khác)"
TMP="$(mktemp "$APP/.env.XXXXXX")"
chmod 600 "$TMP"
grep -vE '^[[:space:]]*(WEB_PORT|WEB_BASE_URL|WEB_HOST|DISCORD_CLIENT_SECRET)[[:space:]]*=' "$ENV_FILE" > "$TMP" || true
{
	echo ""
	echo "# --- Trang web quản trị (enable-web.sh) ---"
	echo "WEB_PORT=$PORT"
	echo "WEB_BASE_URL=$BASE_URL"
	if [[ "$HOST" =~ ^[0-9.]+$ ]]; then echo "WEB_HOST=$HOST"; fi
	printf 'DISCORD_CLIENT_SECRET=%s\n' "$SECRET"
} >> "$TMP"
unset SECRET
chown root:root "$TMP"
mv "$TMP" "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "      WEB_PORT=$PORT, WEB_BASE_URL=$BASE_URL, DISCORD_CLIENT_SECRET: đã ghi (không in ra)."

echo "[3/3] Mở cổng $PORT trên ufw, chỉ cho mạng nội bộ (${PRIVATE_NETS[*]})"
if command -v ufw >/dev/null && ufw status | grep -q "^Status: active"; then
	for net in "${PRIVATE_NETS[@]}"; do
		ufw allow proto tcp from "$net" to any port "$PORT" comment "ezone-bot web" | sed 's/^/      /'
	done
else
	echo "      ufw không bật: bỏ qua. Nếu có firewall khác, nhờ IT mở cổng $PORT cho mạng nội bộ."
fi

echo
echo "XONG. Tiếp theo:"
echo "  1) Developer Portal → OAuth2 → Redirects: có đúng dòng $BASE_URL/auth/callback (đã Lưu)."
echo "  2) sudo bash ~/deploy/start.sh   (selfcheck, không lỗi thì khởi động lại bot và mở web)"
