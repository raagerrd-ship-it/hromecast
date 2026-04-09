#!/bin/bash
# Cast Away - Linux Uninstaller

set -e

SERVICE_NAME="cast-away"
APP_DIR="$HOME/.local/share/$SERVICE_NAME"

echo ""
echo "========================================"
echo "  Cast Away Avinstallation"
echo "========================================"
echo ""

# Stoppa och inaktivera alla relaterade tjänster och timers
for unit in "$SERVICE_NAME" "$SERVICE_NAME-restart" "$SERVICE_NAME-update"; do
    systemctl --user stop "$unit" 2>/dev/null || true
    systemctl --user disable "$unit" 2>/dev/null || true
done
for timer in "$SERVICE_NAME-restart" "$SERVICE_NAME-update"; do
    systemctl --user stop "$timer.timer" 2>/dev/null || true
    systemctl --user disable "$timer.timer" 2>/dev/null || true
done

# Ta bort service- och timer-filer
echo "  Tar bort service-filer..."
rm -f "$HOME/.config/systemd/user/$SERVICE_NAME.service"
rm -f "$HOME/.config/systemd/user/$SERVICE_NAME-restart.service"
rm -f "$HOME/.config/systemd/user/$SERVICE_NAME-restart.timer"
rm -f "$HOME/.config/systemd/user/$SERVICE_NAME-update.service"
rm -f "$HOME/.config/systemd/user/$SERVICE_NAME-update.timer"

# Ta bort installationsmapp
if [ -d "$APP_DIR" ]; then
    echo "  Tar bort $APP_DIR..."
    rm -rf "$APP_DIR"
fi

systemctl --user daemon-reload

echo ""
echo "  ✓ Cast Away avinstallerad"
echo ""
