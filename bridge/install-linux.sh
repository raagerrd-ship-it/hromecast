#!/bin/bash
# Chromecast Bridge - Linux/Raspberry Pi Installer (Multi-Instance Support)

set -e

DEFAULT_APP_NAME="chromecast-bridge"
DEFAULT_PORT=3000

echo ""
echo "========================================"
echo "  Chromecast Bridge Installer"
echo "========================================"
echo ""

# Fråga om instansnamn
echo "Om du vill köra flera bridges (t.ex. en per rum), ge varje ett unikt namn."
echo "Lämna tomt för standardinstallation."
echo ""
read -p "Instansnamn (tryck Enter för standard): " INSTANCE_NAME

if [ -z "$INSTANCE_NAME" ]; then
    APP_NAME="$DEFAULT_APP_NAME"
    SERVICE_NAME="$DEFAULT_APP_NAME"
    PORT=$DEFAULT_PORT
else
    CLEAN_NAME=$(echo "$INSTANCE_NAME" | tr -cd '[:alnum:]-' | tr '[:upper:]' '[:lower:]')
    APP_NAME="$DEFAULT_APP_NAME-$CLEAN_NAME"
    SERVICE_NAME="$DEFAULT_APP_NAME-$CLEAN_NAME"
    
    read -p "Port (standard: $DEFAULT_PORT): " PORT_INPUT
    if [ -z "$PORT_INPUT" ]; then
        PORT=$DEFAULT_PORT
    else
        PORT=$PORT_INPUT
    fi
fi

APP_DIR="$HOME/.local/share/$APP_NAME"

echo ""
echo "Installation:"
echo "  Namn: $APP_NAME"
echo "  Port: $PORT"
echo "  Mapp: $APP_DIR"
echo ""

# Kontrollera att vi inte kör som root
if [ "$EUID" -eq 0 ]; then
    echo "❌ Kör inte detta script som root!"
    echo "   Använd: ./install-linux.sh"
    exit 1
fi

# 1. Kontrollera/installera Node.js
echo "[1/6] Kontrollerar Node.js..."
if ! command -v node &> /dev/null; then
    echo "  Node.js hittades inte. Försöker installera..."
    
    if command -v apt-get &> /dev/null; then
        # Debian/Ubuntu/Raspberry Pi
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif command -v dnf &> /dev/null; then
        # Fedora
        sudo dnf install -y nodejs
    elif command -v pacman &> /dev/null; then
        # Arch
        sudo pacman -S nodejs npm
    else
        echo "  ❌ Kunde inte installera Node.js automatiskt."
        echo "     Installera Node.js 18+ manuellt: https://nodejs.org"
        exit 1
    fi
fi
echo "  ✓ Node.js $(node --version)"

# 2. Skapa app-mapp
echo "[2/6] Skapar app-mapp..."
mkdir -p "$APP_DIR"
mkdir -p "$APP_DIR/public"
echo "  ✓ $APP_DIR"

# 3. Kopiera filer
echo "[3/6] Kopierar filer..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Kopiera huvudfiler
for file in index.js package.json package-lock.json; do
    if [ -f "$SCRIPT_DIR/$file" ]; then
        cp "$SCRIPT_DIR/$file" "$APP_DIR/"
        echo "  Kopierade $file"
    fi
done

# Kopiera public-mapp
if [ -d "$SCRIPT_DIR/public" ]; then
    cp -r "$SCRIPT_DIR/public/"* "$APP_DIR/public/"
    echo "  Kopierade public-mapp"
fi

echo "  ✓ Filer kopierade"

# 4. Installera dependencies
echo "[4/6] Installerar dependencies..."
cd "$APP_DIR"
npm install --production
echo "  ✓ Dependencies installerade"

# 5. Skapa .env-fil
echo "[5/6] Skapar konfiguration..."
DEVICE_ID=$(hostname | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]-')
if [ -n "$CLEAN_NAME" ]; then
    DEVICE_ID="$DEVICE_ID-$CLEAN_NAME"
fi

cat > "$APP_DIR/.env" << EOF
# Chromecast Bridge Configuration
# Genererad $(date +"%Y-%m-%d %H:%M")

SUPABASE_URL=https://umxwaxzmoxwasryjibhe.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVteHdheHptb3h3YXNyeWppYmhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0OTc3OTgsImV4cCI6MjA4MDA3Mzc5OH0.R4hVdnkp310Wk-g0jZfy52EwxfV6z3Pfnv6uwhsf0ps
DEVICE_ID=$DEVICE_ID
PORT=$PORT
EOF

echo "  ✓ Device ID: $DEVICE_ID"
echo "  ✓ Port: $PORT"

# 6. Skapa systemd user service
echo "[6/6] Skapar systemd service..."
mkdir -p "$HOME/.config/systemd/user"

cat > "$HOME/.config/systemd/user/$SERVICE_NAME.service" << EOF
[Unit]
Description=Chromecast Bridge - $APP_NAME
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

# Aktivera lingering för att köra services utan inloggning
loginctl enable-linger "$USER" 2>/dev/null || true

# Ladda om och starta service
systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME"
systemctl --user start "$SERVICE_NAME"

echo "  ✓ Service skapad och startad"

# Hämta IP-adress
IP_ADDR=$(hostname -I | awk '{print $1}')

echo ""
echo "========================================"
echo "  Installation klar!"
echo "========================================"
echo ""
echo "Öppna webbläsaren och gå till:"
echo ""
echo "  Lokal:  http://localhost:$PORT"
echo "  LAN:    http://$IP_ADDR:$PORT"
echo ""
echo "Där kan du välja Chromecast och konfigurera screensaver."
echo ""
echo "Device ID: $DEVICE_ID"
echo "Service:   $SERVICE_NAME"
echo ""
echo "Användbara kommandon:"
echo "  Status:  systemctl --user status $SERVICE_NAME"
echo "  Loggar:  journalctl --user -u $SERVICE_NAME -f"
echo "  Stoppa:  systemctl --user stop $SERVICE_NAME"
echo "  Starta:  systemctl --user start $SERVICE_NAME"
echo ""
echo "För att avinstallera: ./uninstall-linux.sh"
echo ""
