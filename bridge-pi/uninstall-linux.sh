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

# Stoppa och inaktivera alla relaterade tjänster
for unit in "$SERVICE_NAME" "$SERVICE_NAME-restart" "$SERVICE_NAME-update"; do
    if systemctl --user is-active --quiet "$unit" 2>/dev/null || \
       systemctl --user is-enabled --quiet "$unit" 2>/dev/null; then
        echo "  Stoppar $unit..."
        systemctl --user stop "$unit" 2>/dev/null || true
        systemctl --user disable "$unit" 2>/dev/null || true
    fi
done

# Ta bort service-filer
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
