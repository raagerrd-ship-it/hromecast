#!/bin/bash
# Cast Away — Update script (fallback for Pi Control Center)
# Downloads the latest release tarball from GitHub instead of using git pull,
# because the release version is only baked into the tarball (not committed to the repo).
# PCC handles service restarts AFTER this script completes.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

REPO="raagerrd-ship-it/hromecast"
RELEASE_URL="https://github.com/${REPO}/releases/latest/download/dist.tar.gz"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [update] $*"
}

# Sanity check — must look like our app dir
if [ ! -d "$APP_DIR/engine" ] || [ ! -f "$APP_DIR/engine/package.json" ]; then
    log "APP_DIR ($APP_DIR) does not look like Cast Away install, aborting"
    exit 1
fi

# Read currently installed version
CURRENT_VERSION=$(node -p "require('$APP_DIR/engine/package.json').version" 2>/dev/null || echo "unknown")
log "Current installed version: $CURRENT_VERSION"

# Resolve latest release tag from GitHub API (best-effort)
LATEST_TAG=$(curl -sf "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name"\s*:\s*"([^"]+)".*/\1/' || true)
LATEST_VERSION="${LATEST_TAG#v}"

if [ -n "$LATEST_VERSION" ] && [ "$LATEST_VERSION" = "$CURRENT_VERSION" ]; then
    log "Already up to date ($CURRENT_VERSION)"
    exit 0
fi

log "Latest release: ${LATEST_VERSION:-unknown} — downloading tarball..."

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

if ! curl -fsSL "$RELEASE_URL" -o "$TMP_DIR/dist.tar.gz"; then
    log "Failed to download $RELEASE_URL, aborting"
    exit 1
fi

mkdir -p "$TMP_DIR/extract"
if ! tar xzf "$TMP_DIR/dist.tar.gz" -C "$TMP_DIR/extract"; then
    log "Failed to extract tarball, aborting"
    exit 1
fi

# Verify extracted payload
if [ ! -f "$TMP_DIR/extract/engine/package.json" ]; then
    log "Tarball missing engine/package.json, aborting"
    exit 1
fi

NEW_VERSION=$(node -p "require('$TMP_DIR/extract/engine/package.json').version" 2>/dev/null || echo "unknown")
log "Tarball version: $NEW_VERSION"

# Graceful shutdown — stop screensaver and disconnect Chromecast before swap
ENGINE_PORT="${ENGINE_PORT:-${PORT:-3052}}"
curl -sf -X POST "http://localhost:${ENGINE_PORT}/api/prepare-update" >/dev/null 2>&1 && {
    log "Engine preparing for update..."
    sleep 2
} || true

# Swap in new files (engine/, dist/, scripts/, service.json)
log "Installing new files into $APP_DIR..."
for item in engine dist scripts service.json; do
    SRC="$TMP_DIR/extract/$item"
    DEST="$APP_DIR/$item"
    if [ ! -e "$SRC" ]; then
        log "  - skipping $item (not in tarball)"
        continue
    fi
    if [ -d "$SRC" ]; then
        rm -rf "$DEST"
        cp -r "$SRC" "$DEST"
    else
        cp -f "$SRC" "$DEST"
    fi
done

chmod +x "$APP_DIR/scripts/"*.sh 2>/dev/null || true

log "Done! Updated $CURRENT_VERSION -> $NEW_VERSION"
