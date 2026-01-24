#!/bin/bash
# Chromecast Bridge - Linux/Raspberry Pi Installer
# Kör som: chmod +x install-linux.sh && ./install-linux.sh

set -e

APP_NAME="chromecast-bridge"
APP_DIR="$HOME/.local/share/$APP_NAME"
SERVICE_NAME="chromecast-bridge"

echo ""
echo "========================================"
echo "  Chromecast Bridge Installer"
echo "========================================"
echo ""

# Kontrollera om vi kör som root
if [ "$EUID" -eq 0 ]; then
    echo "Kör inte detta script som root/sudo."
    echo "Kör som vanlig användare istället."
    exit 1
fi

# 1. Kontrollera/installera Node.js
echo "[1/6] Kontrollerar Node.js..."
if ! command -v node &> /dev/null; then
    echo "  Node.js hittades inte. Installerar..."
    
    # Detektera distro
    if command -v apt-get &> /dev/null; then
        # Debian/Ubuntu/Raspberry Pi OS
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif command -v dnf &> /dev/null; then
        # Fedora
        sudo dnf install -y nodejs
    elif command -v pacman &> /dev/null; then
        # Arch
        sudo pacman -S nodejs npm
    else
        echo "  Kunde inte installera Node.js automatiskt."
        echo "  Installera manuellt: https://nodejs.org"
        exit 1
    fi
fi
NODE_VERSION=$(node --version)
echo "  Node.js $NODE_VERSION OK"

# 2. Skapa app-mapp
echo "[2/6] Skapar app-mapp..."
mkdir -p "$APP_DIR"
echo "  $APP_DIR"

# 3. Kopiera bridge-filer
echo "[3/6] Kopierar filer..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/index.js" "$APP_DIR/" 2>/dev/null || true
cp "$SCRIPT_DIR/package.json" "$APP_DIR/" 2>/dev/null || true
cp "$SCRIPT_DIR/package-lock.json" "$APP_DIR/" 2>/dev/null || true
echo "  Filer kopierade"

# 4. Installera dependencies
echo "[4/6] Installerar dependencies..."
cd "$APP_DIR"
npm install --production 2>&1 | tail -1
echo "  Dependencies installerade"

# 5. Skapa .env-fil
echo "[5/6] Skapar konfiguration..."
DEVICE_ID=$(hostname | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]-')
cat > "$APP_DIR/.env" << EOF
# Chromecast Bridge Configuration
# Genererad automatiskt $(date '+%Y-%m-%d %H:%M')

SUPABASE_URL=https://umxwaxzmoxwasryjibhe.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVteHdheHptb3h3YXNyeWppYmhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0OTc3OTgsImV4cCI6MjA4MDA3Mzc5OH0.R4hVdnkp310Wk-g0jZfy52EwxfV6z3Pfnv6uwhsf0ps
DEVICE_ID=$DEVICE_ID
POLL_INTERVAL=5000
EOF
echo "  Device ID: $DEVICE_ID"

# 6. Skapa systemd user service
echo "[6/6] Skapar autostart-tjänst..."
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/$SERVICE_NAME.service" << EOF
[Unit]
Description=Chromecast Bridge Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$(which node) index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
EOF

# Aktivera och starta tjänsten
systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME"
systemctl --user start "$SERVICE_NAME"

echo "  Systemd service skapad och startad"

echo ""
echo "========================================"
echo "  Installation klar!"
echo "========================================"
echo ""
echo "Bridge körs nu och startar automatiskt vid inloggning."
echo ""
echo "Device ID: $DEVICE_ID"
echo "Använd detta ID i webbappen för att konfigurera."
echo ""
echo "Kommandon:"
echo "  Status:  systemctl --user status $SERVICE_NAME"
echo "  Loggar:  journalctl --user -u $SERVICE_NAME -f"
echo "  Stoppa:  systemctl --user stop $SERVICE_NAME"
echo "  Starta:  systemctl --user start $SERVICE_NAME"
echo ""
echo "För att avinstallera, kör: ./uninstall-linux.sh"
echo ""
