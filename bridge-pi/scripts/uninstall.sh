#!/bin/bash
# Cast Away — Uninstaller
# systemd services are managed by Pi Control Center — this script only cleans files

INSTALL_DIR="${1:-/opt/cast-away}"

if [ -n "$INSTALL_DIR" ] && [ -d "$INSTALL_DIR" ]; then
    echo "  Removing $INSTALL_DIR..."
    rm -rf "$INSTALL_DIR"
    echo "  ✓ Files removed"
fi

echo "  ✓ Cast Away uninstalled"
