#!/usr/bin/env bash
# Tự kiểm tra môi trường (selfcheck, docs/DEPLOY.md mục 3.1) dưới đúng user và sandbox của service,
# chỉ khi không có lỗi mới bật (hoặc khởi động lại) bot.
# Dùng sau install.sh (docs/DEPLOY.md mục 5). Chạy: sudo bash ~/deploy/start.sh
set -uo pipefail

APP=/opt/company-discord-bot

if [ "$(id -u)" -ne 0 ]; then echo "Hãy chạy bằng: sudo bash ~/deploy/start.sh"; exit 1; fi
cd "$APP"

echo "=== Tự kiểm tra (selfcheck) ==="
systemd-run --wait --pipe --collect \
	--unit=company-discord-bot-selfcheck \
	--uid=discordbot --gid=discordbot \
	-p WorkingDirectory=/opt/company-discord-bot \
	-p EnvironmentFile=/opt/company-discord-bot/.env \
	-p UMask=0077 \
	-p MemoryMax=1G \
	-p NoNewPrivileges=yes \
	-p ProtectSystem=strict \
	-p ProtectHome=yes \
	-p PrivateTmp=yes \
	-p PrivateDevices=yes \
	-p ReadWritePaths=/opt/company-discord-bot/data \
	-p CapabilityBoundingSet= \
	-p AmbientCapabilities= \
	-p "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6" \
	-p SystemCallFilter=@system-service \
	-p SystemCallErrorNumber=EPERM \
	-p SystemCallArchitectures=native \
	-p ProtectKernelTunables=yes \
	-p ProtectKernelModules=yes \
	-p ProtectKernelLogs=yes \
	-p ProtectControlGroups=yes \
	-p ProtectClock=yes \
	-p ProtectHostname=yes \
	-p ProtectProc=invisible \
	-p RestrictNamespaces=yes \
	-p RestrictRealtime=yes \
	-p RestrictSUIDSGID=yes \
	-p LockPersonality=yes \
	/usr/bin/node build/selfcheck.js
code=$?
echo "selfcheck exit code: $code"
if [ "$code" -ne 0 ]; then
	echo
	echo "CÓ LỖI (dòng ❌ phía trên). Bot CHƯA được bật. Sửa rồi chạy lại: sudo bash ~/deploy/start.sh"
	exit 1
fi

echo
echo "=== Bật bot ==="
systemctl enable company-discord-bot
systemctl restart company-discord-bot
sleep 10
systemctl --no-pager status company-discord-bot | head -12
echo
echo "=== Log 30 dòng gần nhất ==="
journalctl -u company-discord-bot -n 30 --no-pager
