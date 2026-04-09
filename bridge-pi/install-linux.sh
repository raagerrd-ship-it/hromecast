#!/bin/bash
# Cast Away - Raspberry Pi Installer (Pi Dashboard Integration)

set -e

DEFAULT_APP_NAME="cast-away"
DEFAULT_PORT=3000
DEFAULT_CORE=0

# Parse arguments from Pi Dashboard
PORT=$DEFAULT_PORT
CPU_CORE=$DEFAULT_CORE

while [[ $# -gt 0 ]]; do
  case $1 in
    --port) PORT="$2"; shift 2 ;;
    --core) CPU_CORE="$2"; shift 2 ;;
    *) shift ;;
  esac
done

APP_NAME="$DEFAULT_APP_NAME"
SERVICE_NAME="$DEFAULT_APP_NAME"
APP_DIR="$HOME/.local/share/$APP_NAME"

# Säkerhetskontroll: APP_DIR måste vara en rimlig sökväg
if [ -z "$HOME" ] || [ -z "$APP_NAME" ] || [[ "$APP_DIR" != "$HOME/"* ]]; then
    echo "❌ Kunde inte bestämma installationsmapp (HOME=$HOME, APP=$APP_NAME)"
    exit 1
fi

echo ""
echo "========================================"
echo "  Cast Away – Raspberry Pi Installer"
echo "========================================"
echo ""
echo "  Port: $PORT"
echo "  CPU-kärna: $CPU_CORE"
echo "  Mapp: $APP_DIR"
echo ""

# Kontrollera att vi inte kör som root
if [ "$EUID" -eq 0 ]; then
    echo "❌ Kör inte detta script som root!"
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

# 1b. Kontrollera swap (Pi Zero 2 W har bara 512MB RAM)
SWAP_TOTAL=$(free -m 2>/dev/null | awk '/^Swap:/{print $2}' || echo "0")
if [ "$SWAP_TOTAL" -lt 100 ] 2>/dev/null; then
    echo ""
    echo "  ⚠️ Liten eller ingen swap detekterad (${SWAP_TOTAL}MB)"
    echo "  Rekommendation: Aktivera minst 256MB swap för stabilitet"
    echo "  sudo dphys-swapfile setup && sudo dphys-swapfile swapon"
    echo ""
fi

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
if [ -f "$SCRIPT_DIR/update.sh" ]; then
    cp "$SCRIPT_DIR/update.sh" "$STAGING_DIR/"
fi
echo "  ✓ Källfiler staged"

# Verifiera att vi har nödvändiga filer
if [ ! -f "$STAGING_DIR/index.js" ] || [ ! -f "$STAGING_DIR/package.json" ]; then
    echo "  ❌ Saknar index.js eller package.json i källmappen!"
    echo "     Kontrollera att du kör scriptet från rätt katalog."
    exit 1
fi

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

cat > "$APP_DIR/.env" << EOF
# Cast Away Configuration
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
Description=Cast Away - $APP_NAME
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$NODE_PATH --max-old-space-size=128 --expose-gc --single-threaded --v8-pool-size=0 index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=UV_THREADPOOL_SIZE=1

# CPU-dedikering för Pi Zero 2 W
AllowedCPUs=$CPU_CORE
CPUQuota=100%
Nice=-5

[Install]
WantedBy=default.target
EOF

# Skapa timer för nattlig omstart kl 05:00
cat > "$HOME/.config/systemd/user/$SERVICE_NAME-restart.service" << EOF
[Unit]
Description=Restart Cast Away - $APP_NAME

[Service]
Type=oneshot
ExecStart=/bin/systemctl --user restart $SERVICE_NAME
EOF

cat > "$HOME/.config/systemd/user/$SERVICE_NAME-restart.timer" << EOF
[Unit]
Description=Nightly restart of Cast Away - $APP_NAME

[Timer]
OnCalendar=*-*-* 05:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl --user enable "$SERVICE_NAME-restart.timer"
systemctl --user start "$SERVICE_NAME-restart.timer"

# 7. Auto-update via git (om update.sh finns)
echo "[7/7] Konfigurerar auto-update..."
if [ -f "$STAGING_DIR/update.sh" ]; then
    cp "$STAGING_DIR/update.sh" "$APP_DIR/update.sh"
    chmod +x "$APP_DIR/update.sh"
    
    cat > "$HOME/.config/systemd/user/$SERVICE_NAME-update.service" << EOF
[Unit]
Description=Auto-update Cast Away - $APP_NAME

[Service]
Type=oneshot
WorkingDirectory=$APP_DIR
ExecStart=/bin/bash $APP_DIR/update.sh
Environment=HOME=$HOME
EOF

    cat > "$HOME/.config/systemd/user/$SERVICE_NAME-update.timer" << EOF
[Unit]
Description=Hourly auto-update check for Cast Away - $APP_NAME

[Timer]
OnCalendar=*-*-* *:15:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

    systemctl --user enable "$SERVICE_NAME-update.timer"
    systemctl --user start "$SERVICE_NAME-update.timer"
    echo "  ✓ Auto-update aktiverat (kollar varje timme)"
else
    echo "  ⚠️ update.sh saknas, auto-update ej konfigurerat"
fi

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
echo "  http://localhost:$PORT"
echo "  http://$IP_ADDR:$PORT"
echo ""
echo "  Device ID: $DEVICE_ID"
echo "  Service:   $SERVICE_NAME"
echo "  CPU-kärna: $CPU_CORE"
echo ""
