#!/bin/bash
# Chromecast Bridge - Linux/Raspberry Pi Uninstaller
# Kör som: chmod +x uninstall-linux.sh && ./uninstall-linux.sh

set -e

APP_NAME="chromecast-bridge"
APP_DIR="$HOME/.local/share/$APP_NAME"
SERVICE_NAME="chromecast-bridge"

echo ""
echo "========================================"
echo "  Chromecast Bridge Uninstaller"
echo "========================================"
echo ""

# 1. Stoppa och ta bort systemd service
echo "[1/2] Tar bort autostart-tjänst..."
systemctl --user stop "$SERVICE_NAME" 2>/dev/null || true
systemctl --user disable "$SERVICE_NAME" 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/$SERVICE_NAME.service"
systemctl --user daemon-reload
echo "  Systemd service borttagen"

# 2. Ta bort app-mapp
echo "[2/2] Tar bort filer..."
if [ -d "$APP_DIR" ]; then
    rm -rf "$APP_DIR"
    echo "  $APP_DIR borttagen"
else
    echo "  Ingen installation hittades"
fi

echo ""
echo "========================================"
echo "  Avinstallation klar!"
echo "========================================"
echo ""
