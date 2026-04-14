#!/bin/bash
# Cast Away — Install script for Pi Control Center
# PCC handles systemd units automatically.
# This script installs dependencies and verifies the environment.

set -euo pipefail
trap 'echo "❌ Error on line $LINENO (exit code: $?)" >&2' ERR

# Accept PCC flags (handled by PCC, not used here)
while [[ $# -gt 0 ]]; do
  case $1 in
    --port) shift 2 ;;
    --core) shift 2 ;;
    *) shift ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo "========================================"
echo "  Cast Away — Install"
echo "========================================"
echo ""

# Verify file structure
if [ ! -f "$APP_DIR/engine/index.js" ]; then
    echo "❌ Missing engine/index.js"
    exit 1
fi

if [ ! -f "$APP_DIR/engine/package.json" ]; then
    echo "❌ Missing engine/package.json"
    exit 1
fi

if [ ! -d "$APP_DIR/dist" ]; then
    echo "⚠️  Missing dist/ directory (UI will not be available)"
fi

# Check system dependency for mDNS/Bonjour
echo "[1/3] Checking system dependencies..."
if ! dpkg -s libavahi-compat-libdnssd-dev &>/dev/null; then
    echo "  ⚠️  libavahi-compat-libdnssd-dev not found"
    echo "  Installing (required for Chromecast discovery)..."
    sudo apt-get install -y libavahi-compat-libdnssd-dev
    echo "  ✓ libavahi installed"
else
    echo "  ✓ libavahi available"
fi

# Check Node.js
echo "[2/3] Checking Node.js..."
if ! command -v node &>/dev/null; then
    echo "  ❌ Node.js not found. Install Node.js 18+ first."
    exit 1
fi
echo "  ✓ Node.js $(node --version)"

# Install engine dependencies
echo "[3/3] Installing engine dependencies..."
cd "$APP_DIR/engine"
npm install --omit=dev --quiet
echo "  ✓ Dependencies installed"

echo ""
echo "========================================"
echo "  Installation complete!"
echo "========================================"
echo ""
