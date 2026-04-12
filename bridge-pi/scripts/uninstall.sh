#!/bin/bash
# Cast Away — Uninstaller
# Cleans up both engine and UI systemd services

set -e

SERVICE_KEY="cast-away"

echo ""
echo "========================================"
echo "  Cast Away — Uninstall"
echo "========================================"
echo ""

# Stop and disable engine service
for unit in "$SERVICE_KEY-engine" "$SERVICE_KEY-ui"; do
    systemctl --user stop "$unit" 2>/dev/null || true
    systemctl --user disable "$unit" 2>/dev/null || true
    rm -f "$HOME/.config/systemd/user/$unit.service"
done

systemctl --user daemon-reload

echo "  ✓ Services removed"

# Remove install directory if passed as argument
INSTALL_DIR="${1:-}"
if [ -n "$INSTALL_DIR" ] && [ -d "$INSTALL_DIR" ]; then
    echo "  Removing $INSTALL_DIR..."
    rm -rf "$INSTALL_DIR"
    echo "  ✓ Files removed"
fi

echo ""
echo "  ✓ Cast Away uninstalled"
echo ""
