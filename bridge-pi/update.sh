#!/bin/bash
# Cast Away – Auto-update script
# Pulls latest changes from GitHub and restarts the service if updated

set -e

DEFAULT_APP_NAME="cast-away"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR"

# Detect service name from directory
DIR_NAME=$(basename "$SCRIPT_DIR")
if [ "$DIR_NAME" = "$DEFAULT_APP_NAME" ]; then
    SERVICE_NAME="$DEFAULT_APP_NAME"
else
    INSTANCE=$(echo "$DIR_NAME" | sed "s/^${DEFAULT_APP_NAME}-//")
    SERVICE_NAME="$DEFAULT_APP_NAME-$INSTANCE"
fi

# Find the git repo root — could be APP_DIR itself or a parent
GIT_ROOT=""
if [ -d "$SCRIPT_DIR/.git" ]; then
    GIT_ROOT="$SCRIPT_DIR"
elif [ -d "$SCRIPT_DIR/../.git" ]; then
    GIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else
    echo "$(date '+%Y-%m-%d %H:%M:%S') [update] Not a git repo, skipping"
    exit 0
fi

cd "$GIT_ROOT"

# Determine where bridge-pi source files live relative to git root
# Could be a monorepo (files in bridge-pi/) or standalone repo (files in root)
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

# Pull changes
git pull origin main --quiet

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

# If source dir != app dir, copy files over
if [ "$SOURCE_DIR" != "$APP_DIR" ]; then
    for file in index.js package.json; do
        if [ -f "$SOURCE_DIR/$file" ]; then
            cp "$SOURCE_DIR/$file" "$APP_DIR/"
        fi
    done
    if [ -d "$SOURCE_DIR/public" ]; then
        mkdir -p "$APP_DIR/public"
        cp -r "$SOURCE_DIR/public/"* "$APP_DIR/public/"
    fi
fi

# Reinstall dependencies if package.json changed
PKG_CHANGED=""
if [ -n "$DIFF_PATH" ]; then
    PKG_CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE" -- "${DIFF_PATH}package.json" 2>/dev/null | head -1)
else
    PKG_CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE" -- "package.json" 2>/dev/null | head -1)
fi

if [ -n "$PKG_CHANGED" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [update] package.json changed, reinstalling deps..."
    cd "$APP_DIR" && npm install --production --quiet 2>/dev/null
fi

# Restart service
echo "$(date '+%Y-%m-%d %H:%M:%S') [update] Restarting service..."
systemctl --user restart "$SERVICE_NAME" 2>/dev/null || true
echo "$(date '+%Y-%m-%d %H:%M:%S') [update] Done! Now running $(cd "$GIT_ROOT" && git rev-parse --short HEAD)"
