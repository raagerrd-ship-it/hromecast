#!/bin/bash
# Cast Away — Auto-update script
# Pulls latest changes from GitHub and restarts the engine if updated

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVICE_NAME="cast-away-engine"

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
    echo "$(date '+%Y-%m-%d %H:%M:%S') [update] No relevant changes, skipping restart"
    exit 0
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') [update] Files changed, updating..."

# Reinstall engine dependencies if package.json changed
PKG_PATH="${DIFF_PATH}engine/package.json"
PKG_CHANGED=""
if [ -n "$DIFF_PATH" ]; then
    PKG_CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE" -- "$PKG_PATH" 2>/dev/null | head -1)
else
    PKG_CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE" -- "engine/package.json" 2>/dev/null | head -1)
fi

if [ -n "$PKG_CHANGED" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [update] engine/package.json changed, reinstalling deps..."
    ENGINE_DIR="$SOURCE_DIR/engine"
    if [ -d "$ENGINE_DIR" ]; then
        cd "$ENGINE_DIR" && npm install --production --quiet
    fi
fi

# Restart engine service
echo "$(date '+%Y-%m-%d %H:%M:%S') [update] Restarting engine..."
systemctl --user restart "$SERVICE_NAME" 2>/dev/null || true

# Restart UI service if UI files changed
UI_CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE" -- "${DIFF_PATH}public/" 2>/dev/null | head -1)
if [ -n "$UI_CHANGED" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [update] UI files changed, restarting UI..."
    systemctl --user restart "cast-away-ui" 2>/dev/null || true
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') [update] Done! Now running $(cd "$GIT_ROOT" && git rev-parse --short HEAD)"
