#!/bin/bash
# Cast Away — Update script (fallback for Pi Control Center)
# PCC normally handles updates via release download.
# This script is called as fallback when releaseUrl is unavailable.
# PCC handles service restarts AFTER this script completes.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Find the git repo root
GIT_ROOT=""
if [ -d "$APP_DIR/.git" ]; then
    GIT_ROOT="$APP_DIR"
elif [ -d "$APP_DIR/../.git" ]; then
    GIT_ROOT="$(cd "$APP_DIR/.." && pwd)"
else
    echo "$(date '+%Y-%m-%d %H:%M:%S') [update] Not a git repo, skipping"
    exit 0
fi

cd "$GIT_ROOT"

# Determine where source files live relative to git root
if [ -d "$GIT_ROOT/bridge-pi" ]; then
    SOURCE_DIR="$GIT_ROOT/bridge-pi"
    DIFF_PATH="bridge-pi/"
else
    SOURCE_DIR="$GIT_ROOT"
    DIFF_PATH=""
fi

# Fetch latest
git fetch origin main --quiet 2>/dev/null || {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [update] Failed to fetch, skipping"
    exit 0
}

# Check if there are updates
LOCAL=$(git rev-parse HEAD 2>/dev/null)
REMOTE=$(git rev-parse origin/main 2>/dev/null)

if [ "$LOCAL" = "$REMOTE" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [update] Already up to date ($LOCAL)"
    exit 0
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') [update] Updating: $LOCAL -> $REMOTE"

# Graceful shutdown — stop screensaver and disconnect Chromecast before update
ENGINE_PORT="${ENGINE_PORT:-3052}"
curl -sf -X POST "http://localhost:${ENGINE_PORT}/api/prepare-update" 2>/dev/null && {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [update] Engine preparing for update..."
    sleep 2
} || true

# Pull changes — reset on failure to avoid stuck state
git pull origin main --quiet 2>/dev/null || {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [update] Pull failed, resetting to remote..."
    git reset --hard origin/main 2>/dev/null || {
        echo "$(date '+%Y-%m-%d %H:%M:%S') [update] Reset failed, skipping"
        exit 0
    }
}

# Check if relevant files changed
if [ -n "$DIFF_PATH" ]; then
    CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE" -- "$DIFF_PATH" 2>/dev/null | head -1)
else
    CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE" 2>/dev/null | head -1)
fi

if [ -z "$CHANGED" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [update] No relevant changes, skipping"
    exit 0
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') [update] Files changed, updating..."

# Reinstall engine dependencies if package.json changed
PKG_PATH="${DIFF_PATH}engine/package.json"
if [ -n "$DIFF_PATH" ]; then
    PKG_CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE" -- "$PKG_PATH" 2>/dev/null | head -1)
else
    PKG_CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE" -- "engine/package.json" 2>/dev/null | head -1)
fi

if [ -n "$PKG_CHANGED" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [update] engine/package.json changed, reinstalling deps..."
    ENGINE_DIR="$SOURCE_DIR/engine"
    if [ -d "$ENGINE_DIR" ]; then
        cd "$ENGINE_DIR" && npm install --omit=dev --quiet
    fi
fi

# PCC handles service restarts — do NOT restart here
echo "$(date '+%Y-%m-%d %H:%M:%S') [update] Done! Now at $(cd "$GIT_ROOT" && git rev-parse --short HEAD)"
