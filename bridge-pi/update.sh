#!/bin/bash
# Cast Away – Auto-update script
# Pulls latest changes from GitHub and restarts the service if updated

set -e

DEFAULT_APP_NAME="cast-away"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Detect instance name from directory
DIR_NAME=$(basename "$SCRIPT_DIR")
if [ "$DIR_NAME" = "bridge-pi" ] || [ "$DIR_NAME" = "hromecast" ]; then
    SERVICE_NAME="$DEFAULT_APP_NAME"
else
    INSTANCE=$(echo "$DIR_NAME" | sed "s/^${DEFAULT_APP_NAME}-//")
    SERVICE_NAME="$DEFAULT_APP_NAME-$INSTANCE"
fi

# Check if we're in a git repo
if [ ! -d "$SCRIPT_DIR/.git" ] && [ ! -d "$SCRIPT_DIR/../.git" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [update] Not a git repo, skipping"
    exit 0
fi

# Find git root
GIT_ROOT="$SCRIPT_DIR"
if [ -d "$SCRIPT_DIR/../.git" ]; then
    GIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

cd "$GIT_ROOT"

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

# Check if bridge-pi files changed
CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE" -- bridge-pi/ 2>/dev/null | head -1)

if [ -z "$CHANGED" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [update] No bridge-pi changes, skipping restart"
    exit 0
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') [update] Bridge files changed, reinstalling..."

# Re-run installer in the bridge-pi directory
cd "$GIT_ROOT/bridge-pi"

# Install dependencies if package.json changed
if git diff --name-only "$LOCAL" "$REMOTE" -- bridge-pi/package.json | grep -q .; then
    APP_DIR="$HOME/.local/share/$SERVICE_NAME"
    if [ -d "$APP_DIR" ]; then
        cp bridge-pi/package.json "$APP_DIR/" 2>/dev/null || true
        cd "$APP_DIR" && npm install --production --quiet 2>/dev/null
        cd "$GIT_ROOT/bridge-pi"
    fi
fi

# Copy updated files to install directory
APP_DIR="$HOME/.local/share/$SERVICE_NAME"
if [ -d "$APP_DIR" ]; then
    for file in index.js package.json; do
        if [ -f "$file" ]; then
            cp "$file" "$APP_DIR/"
        fi
    done
    
    if [ -d "public" ]; then
        mkdir -p "$APP_DIR/public"
        cp -r public/* "$APP_DIR/public/"
    fi
    
    echo "$(date '+%Y-%m-%d %H:%M:%S') [update] Files copied, restarting service..."
    systemctl --user restart "$SERVICE_NAME" 2>/dev/null || true
    echo "$(date '+%Y-%m-%d %H:%M:%S') [update] Done! Now running $(git rev-parse --short HEAD)"
else
    echo "$(date '+%Y-%m-%d %H:%M:%S') [update] Install dir not found ($APP_DIR), run install-linux.sh first"
fi
