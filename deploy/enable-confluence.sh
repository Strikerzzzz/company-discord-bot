#!/usr/bin/env bash
# Bật ghi retro vào Confluence nội bộ (DEC-049) trên server: ghi CONFLUENCE_BASE_URL, CONFLUENCE_TOKEN và CONFLUENCE_SPACE_KEYS vào .env
# (hỏi token ẩn, không in, không vào lịch sử lệnh), rồi thử token với Confluence (header đọc từ stdin, token không nằm trên dòng lệnh).
# Không khởi động lại bot: chạy start.sh sau đó.
# Chạy: sudo bash ~/deploy/enable-confluence.sh https://confluence.congty.vn
# Tắt: xoá các dòng CONFLUENCE_* trong .env rồi chạy start.sh.
set -euo pipefail

APP=/opt/company-discord-bot
ENV_FILE="$APP/.env"
DEFAULT_SPACES="P2"
TMP=""

# File tạm chứa token: luôn xoá khi script dừng giữa chừng (lỗi, Ctrl+C). Sau khi mv thành công thì không còn file tạm để xoá.
cleanup() {
	if [ -n "$TMP" ] && [ -f "$TMP" ]; then rm -f "$TMP"; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if [ "$(id -u)" -ne 0 ]; then echo "Hãy chạy bằng: sudo bash ~/deploy/enable-confluence.sh <CONFLUENCE_BASE_URL>"; exit 1; fi
BASE_URL="${1:-}"
BASE_URL="${BASE_URL%/}"
if ! [[ "$BASE_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{2,5})?(/[A-Za-z0-9._~-]+)*$ ]]; then
	echo "Cần CONFLUENCE_BASE_URL dạng https://<địa chỉ>[/đường-dẫn-gốc], ví dụ: sudo bash ~/deploy/enable-confluence.sh https://confluence.congty.vn"
	echo "Chỉ nhận https: token không được gửi qua kết nối không mã hoá."
	exit 1
fi
if [ ! -f "$ENV_FILE" ]; then echo "Chưa có $ENV_FILE: chạy install.sh trước."; exit 1; fi

echo "[1/4] Personal Access Token của Confluence (Confluence → ảnh đại diện → Profile → Personal Access Tokens → Create token)"
echo "      Nên dùng tài khoản riêng cho bot, chỉ có quyền sửa các trang retro. KHÔNG gửi token qua chat."
echo "      Dán vào rồi nhấn Enter. Màn hình sẽ KHÔNG hiện gì khi dán, đó là bình thường."
TOKEN=""
read -rs -p "      Token: " TOKEN
echo
if [ -z "$TOKEN" ] || [[ "$TOKEN" =~ [[:space:]] ]]; then echo "Token rỗng hoặc có khoảng trắng. Chưa ghi gì."; exit 1; fi
if [ "${#TOKEN}" -lt 16 ]; then echo "Token quá ngắn, có thể dán thiếu. Chưa ghi gì."; exit 1; fi

echo "[2/4] Các space bot được ghi (CONFLUENCE_SPACE_KEYS): khoá space cách nhau bằng dấu phẩy, ví dụ P2 hoặc P2,PMS."
echo "      Bot chỉ ghi vào trang thuộc các space này (khoá space nằm trong link …/spaces/<KHOÁ>/… hoặc Space tools → Overview)."
SPACES=""
read -r -p "      Space [$DEFAULT_SPACES]: " SPACES
SPACES="${SPACES:-$DEFAULT_SPACES}"
SPACES="$(printf '%s' "$SPACES" | tr -d '[:space:]')"
if ! [[ "$SPACES" =~ ^~?[A-Za-z0-9_.@-]+(,~?[A-Za-z0-9_.@-]+)*$ ]]; then
	echo "Danh sách space không hợp lệ: \"$SPACES\". Ví dụ đúng: P2 hoặc P2,PMS. Chưa ghi gì."
	exit 1
fi

echo "[3/4] Thử token với Confluence ($BASE_URL/rest/api/user/current)"
STATUS="$(printf 'Authorization: Bearer %s\n' "$TOKEN" | curl -sS -o /dev/null -w '%{http_code}' --max-time 15 --proto '=https' -H @- "$BASE_URL/rest/api/user/current" 2>/dev/null || true)"
case "$STATUS" in
	200) echo "      Confluence nhận token." ;;
	401) echo "      Confluence từ chối token (401): token sai hoặc đã hết hạn. Chưa ghi gì."; unset TOKEN; exit 1 ;;
	301|302|303|307|308) echo "      Confluence chuyển hướng (HTTP $STATUS): kiểm tra địa chỉ gốc và SSO. Bot không theo chuyển hướng (để không gửi token đi nơi khác). Vẫn ghi cấu hình." ;;
	000|"")
		echo "      Không kết nối được Confluence từ server (mạng, DNS hoặc chứng chỉ). Vẫn ghi cấu hình; kiểm tra lại mạng trước khi dùng."
		echo "      Nếu Confluence dùng chứng chỉ của CA nội bộ: chép file PEM của CA lên server (ví dụ /etc/ssl/certs/ca-noi-bo.pem), thêm dòng"
		echo "      NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-noi-bo.pem vào $ENV_FILE, và thử lại bằng curl --cacert <file PEM>."
		echo "      KHÔNG tắt kiểm tra chứng chỉ (không dùng curl -k hay NODE_TLS_REJECT_UNAUTHORIZED=0)."
		;;
	*) echo "      Confluence trả HTTP $STATUS. Vẫn ghi cấu hình; nếu ghi retro lỗi, lỗi sẽ hiện trên trang Retro của web quản trị." ;;
esac

echo "[4/4] Ghi cấu hình Confluence vào $ENV_FILE (giữ nguyên các dòng khác)"
TMP="$(mktemp "$APP/.env.XXXXXX")"
chmod 600 "$TMP"
grep -vE '^[[:space:]]*(CONFLUENCE_BASE_URL|CONFLUENCE_TOKEN|CONFLUENCE_SPACE_KEYS)[[:space:]]*=' "$ENV_FILE" > "$TMP" || true
{
	echo ""
	echo "# --- Ghi retro vào Confluence (enable-confluence.sh) ---"
	echo "CONFLUENCE_BASE_URL=$BASE_URL"
	printf 'CONFLUENCE_TOKEN=%s\n' "$TOKEN"
	echo "CONFLUENCE_SPACE_KEYS=$SPACES"
} >> "$TMP"
unset TOKEN
chown root:root "$TMP"
mv "$TMP" "$ENV_FILE"
TMP=""
chmod 600 "$ENV_FILE"
echo "      CONFLUENCE_BASE_URL=$BASE_URL, CONFLUENCE_SPACE_KEYS=$SPACES, CONFLUENCE_TOKEN: đã ghi (không in ra)."

echo
echo "XONG. Tiếp theo:"
echo "  1) sudo bash ~/deploy/start.sh   (selfcheck, không lỗi thì khởi động lại bot)"
echo "  2) Tạo phiên bằng /retro create kèm link trang Confluence thuộc space $SPACES (…/pages/<số>/… hoặc …viewpage.action?pageId=<số>)."
