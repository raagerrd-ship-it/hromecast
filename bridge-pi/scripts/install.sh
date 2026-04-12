#!/bin/bash
# Cast Away — Fallback installer for Pi Control Center
# Pi Control Center normally handles systemd units automatically.
# This script installs dependencies and verifies the file structure.

set -euo pipefail
trap 'echo "❌ Error on line $LINENO (exit code: $?)" >&2' ERR

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
    echo "⚠️ Missing dist/ directory (UI will not be available)"
fi

# Check Node.js
echo "[1/2] Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "  ❌ Node.js not found. Install Node.js 18+ first."
    exit 1
fi
echo "  ✓ Node.js $(node --version)"

# Install engine dependencies
echo "[2/2] Installing engine dependencies..."
cd "$APP_DIR/engine"
npm install --production --quiet
echo "  ✓ Dependencies installed"

echo ""
echo "========================================"
echo "  Installation complete!"
echo "========================================"
echo ""
