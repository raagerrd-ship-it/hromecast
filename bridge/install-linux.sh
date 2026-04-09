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
    if [ -z "$CLEAN_NAME" ]; then
        echo "❌ Ogiltigt instansnamn – måste innehålla minst ett alfanumeriskt tecken."
        exit 1
    fi
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

# Säkerhetskontroll: APP_DIR måste vara en rimlig sökväg
if [ -z "$HOME" ] || [ -z "$APP_NAME" ] || [[ "$APP_DIR" != "$HOME/"* ]]; then
    echo "❌ Kunde inte bestämma installationsmapp (HOME=$HOME, APP=$APP_NAME)"
    exit 1
fi

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
echo "[1/7] Kontrollerar Node.js..."
if ! command -v node &> /dev/null; then
    echo "  Node.js hittades inte. Försöker installera..."
    
    if command -v apt-get &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif command -v dnf &> /dev/null; then
        sudo dnf install -y nodejs
    elif command -v pacman &> /dev/null; then
        sudo pacman -S nodejs npm
    else
        echo "  ❌ Kunde inte installera Node.js automatiskt."
        echo "     Installera Node.js 18+ manuellt: https://nodejs.org"
        exit 1
    fi
fi
echo "  ✓ Node.js $(node --version)"

# 2. Förbereda uppdatering - kopiera källfiler till temp först
echo "[2/7] Förbereder uppdatering..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGING_DIR=$(mktemp -d)
trap 'rm -rf "$STAGING_DIR"' EXIT

# Kopiera källfiler till staging INNAN vi tar bort APP_DIR
for file in index.js package.json package-lock.json; do
    if [ -f "$SCRIPT_DIR/$file" ]; then
        cp "$SCRIPT_DIR/$file" "$STAGING_DIR/"
    fi
done
if [ -d "$SCRIPT_DIR/public" ] && ls "$SCRIPT_DIR/public/"* &>/dev/null; then
    mkdir -p "$STAGING_DIR/public"
    cp -r "$SCRIPT_DIR/public/"* "$STAGING_DIR/public/"
fi
echo "  ✓ Källfiler staged"

# Verifiera att vi har nödvändiga filer
if [ ! -f "$STAGING_DIR/index.js" ] || [ ! -f "$STAGING_DIR/package.json" ]; then
    echo "  ❌ Saknar index.js eller package.json i källmappen!"
    echo "     Kontrollera att du kör scriptet från rätt katalog."
    exit 1
fi

# Försök pausa befintlig bridge gracefully
if systemctl --user is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    echo "  Pausar befintlig bridge..."
    
    curl -s -X POST "http://localhost:$PORT/api/prepare-update" --connect-timeout 3 > /dev/null 2>&1 && {
        echo "  ✓ Bridge pausad gracefully"
        sleep 2
    } || {
        echo "  ⚠️ Kunde inte pausa gracefully, fortsätter ändå..."
    }
    
    echo "  Stoppar befintlig tjänst..."
    systemctl --user stop "$SERVICE_NAME"
fi

# Ta bort gammal installation om den finns
if [ -d "$APP_DIR" ]; then
    echo "  Tar bort befintlig installation..."
    rm -rf "$APP_DIR"
fi

mkdir -p "$APP_DIR"
mkdir -p "$APP_DIR/public"

echo "  ✓ $APP_DIR"

# 3. Kopiera filer från staging
echo "[3/7] Kopierar filer..."

cp "$STAGING_DIR"/*.js "$APP_DIR/" 2>/dev/null || true
cp "$STAGING_DIR"/*.json "$APP_DIR/" 2>/dev/null || true
if [ -d "$STAGING_DIR/public" ] && ls "$STAGING_DIR/public/"* &>/dev/null; then
    cp -r "$STAGING_DIR/public/"* "$APP_DIR/public/"
fi

echo "  ✓ Filer kopierade"

# 4. Installera dependencies
echo "[4/7] Installerar dependencies..."
cd "$APP_DIR"
npm install --production
echo "  ✓ Dependencies installerade"

# 5. Skapa .env-fil
echo "[5/7] Skapar konfiguration..."
DEVICE_ID=$(hostname | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]-')
if [ -n "$CLEAN_NAME" ]; then
    DEVICE_ID="$DEVICE_ID-$CLEAN_NAME"
fi

cat > "$APP_DIR/.env" << EOF
# Chromecast Bridge Configuration
# Genererad $(date +"%Y-%m-%d %H:%M")

DEVICE_ID=$DEVICE_ID
PORT=$PORT
EOF

echo "  ✓ Device ID: $DEVICE_ID"
echo "  ✓ Port: $PORT"

# 6. Skapa systemd user service
echo "[6/7] Skapar systemd service..."
mkdir -p "$HOME/.config/systemd/user"

NODE_PATH=$(command -v node)
cat > "$HOME/.config/systemd/user/$SERVICE_NAME.service" << EOF
[Unit]
Description=Chromecast Bridge - $APP_NAME
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$NODE_PATH index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
EOF

# Skapa timer för nattlig omstart kl 05:00
cat > "$HOME/.config/systemd/user/$SERVICE_NAME-restart.service" << EOF
[Unit]
Description=Restart Chromecast Bridge - $APP_NAME

[Service]
Type=oneshot
ExecStart=/bin/systemctl --user restart $SERVICE_NAME
EOF

cat > "$HOME/.config/systemd/user/$SERVICE_NAME-restart.timer" << EOF
[Unit]
Description=Nightly restart of Chromecast Bridge - $APP_NAME

[Timer]
OnCalendar=*-*-* 05:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl --user enable "$SERVICE_NAME-restart.timer"
systemctl --user start "$SERVICE_NAME-restart.timer"

# 7. Aktivera och starta
echo "[7/7] Startar service..."

# Aktivera lingering för att köra services utan inloggning
loginctl enable-linger "$USER" 2>/dev/null || true

# Ladda om och starta service
systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME"
systemctl --user start "$SERVICE_NAME"

echo "  ✓ Service skapad och startad"

# Hämta IP-adress
IP_ADDR=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "okänd")

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
