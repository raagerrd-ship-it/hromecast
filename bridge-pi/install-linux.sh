#!/bin/bash
# Cast Away - Raspberry Pi Installer (Pi Dashboard Integration)

set -euo pipefail

# Fånga fel och rapportera vilken rad som failade
trap 'echo "❌ Fel på rad $LINENO (exit-kod: $?)" >&2' ERR

DEFAULT_APP_NAME="cast-away"
DEFAULT_PORT=3000
DEFAULT_CORE=0

# Parse arguments from Pi Dashboard
PORT=$DEFAULT_PORT
CPU_CORE=$DEFAULT_CORE

while [[ $# -gt 0 ]]; do
  case $1 in
    --port)
      if [[ $# -lt 2 ]]; then
        echo "❌ --port kräver ett värde"
        exit 1
      fi
      PORT="$2"
      shift 2
      ;;
    --core)
      if [[ $# -lt 2 ]]; then
        echo "❌ --core kräver ett värde"
        exit 1
      fi
      CPU_CORE="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

APP_NAME="$DEFAULT_APP_NAME"
SERVICE_NAME="$DEFAULT_APP_NAME"
CURRENT_USER="$(id -un)"

# Säkerställ att HOME är satt
if [ -z "${HOME:-}" ]; then
    if command -v getent >/dev/null 2>&1; then
        HOME="$(getent passwd "$CURRENT_USER" | cut -d: -f6 || true)"
    fi

    if [ -z "${HOME:-}" ]; then
        HOME="$(eval echo "~$CURRENT_USER")"
    fi

    export HOME
fi

APP_DIR="$HOME/.local/share/$APP_NAME"
SYSTEMD_DIR="$HOME/.config/systemd/user"
WORK_DIR="$APP_DIR"
INSTALL_MODE="staged"

# Säkerhetskontroll: APP_DIR måste vara en rimlig sökväg
if [ -z "$HOME" ] || [ -z "$APP_NAME" ] || [[ "$APP_DIR" != "$HOME/"* ]]; then
    echo "❌ Kunde inte bestämma installationsmapp (HOME=$HOME, APP=$APP_NAME)"
    exit 1
fi

# Validera argument så vi inte skriver trasig config/systemd-unit
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
    echo "❌ Ogiltig port: $PORT"
    exit 1
fi

if ! [[ "$CPU_CORE" =~ ^[0-9,-]+$ ]]; then
    echo "❌ Ogiltigt CPU-kärnevärde: $CPU_CORE"
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
echo "  Användare: $CURRENT_USER"
echo ""

# Kontrollera att vi inte kör som root
if [ "${EUID:-$(id -u)}" -eq 0 ]; then
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

# 2. Förbered källa/installationsläge
echo "[2/7] Förbereder installation..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGING_DIR=$(mktemp -d)
trap 'rm -rf "$STAGING_DIR"' EXIT

# Om scriptet körs från en git-klon direkt i APP_DIR ska vi INTE radera repot.
# Då kör vi tjänsten direkt från bridge-pi/ så att .git bevaras för auto-update.
if { [ "$SCRIPT_DIR" = "$APP_DIR" ] || [[ "$SCRIPT_DIR" == "$APP_DIR/"* ]]; } && [ -d "$APP_DIR/.git" ]; then
    INSTALL_MODE="repo"
    WORK_DIR="$SCRIPT_DIR"
    echo "  ✓ Git-klon upptäckt, bevarar repo i $APP_DIR"
    echo "  ✓ Körkatalog: $WORK_DIR"
else
    # Kopiera källfiler till staging INNAN vi tar bort APP_DIR
    for file in index.js package.json package-lock.json update.sh uninstall-linux.sh; do
        if [ -f "$SCRIPT_DIR/$file" ]; then
            cp "$SCRIPT_DIR/$file" "$STAGING_DIR/"
        fi
    done

    if [ -d "$SCRIPT_DIR/public" ] && ls "$SCRIPT_DIR/public/"* &>/dev/null; then
        mkdir -p "$STAGING_DIR/public"
        cp -r "$SCRIPT_DIR/public/"* "$STAGING_DIR/public/"
    fi

    echo "  ✓ Källfiler staged"
fi

# Verifiera att vi har nödvändiga filer
if [ "$INSTALL_MODE" = "repo" ]; then
    if [ ! -f "$WORK_DIR/index.js" ] || [ ! -f "$WORK_DIR/package.json" ]; then
        echo "  ❌ Saknar index.js eller package.json i git-klonen!"
        echo "     Kontrollera att du kör scriptet från rätt katalog."
        exit 1
    fi
else
    if [ ! -f "$STAGING_DIR/index.js" ] || [ ! -f "$STAGING_DIR/package.json" ]; then
        echo "  ❌ Saknar index.js eller package.json i källmappen!"
        echo "     Kontrollera att du kör scriptet från rätt katalog."
        exit 1
    fi
fi

# Stoppa befintlig tjänst innan vi rör filer
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

# 3. Förbered körkatalog
echo "[3/7] Förbereder körkatalog..."
if [ "$INSTALL_MODE" = "repo" ]; then
    mkdir -p "$WORK_DIR/public"
    chmod +x "$WORK_DIR/update.sh" "$WORK_DIR/uninstall-linux.sh" 2>/dev/null || true
    echo "  ✓ Använder befintlig git-klon"
else
    # Ta bort gammal installation om den finns
    if [ -d "$APP_DIR" ]; then
        echo "  Tar bort befintlig installation..."
        rm -rf "$APP_DIR"
    fi

    mkdir -p "$WORK_DIR"
    mkdir -p "$WORK_DIR/public"

    cp "$STAGING_DIR"/*.js "$WORK_DIR/" 2>/dev/null || true
    cp "$STAGING_DIR"/*.json "$WORK_DIR/" 2>/dev/null || true
    cp "$STAGING_DIR"/*.sh "$WORK_DIR/" 2>/dev/null || true
    if [ -d "$STAGING_DIR/public" ] && ls "$STAGING_DIR/public/"* &>/dev/null; then
        cp -r "$STAGING_DIR/public/"* "$WORK_DIR/public/"
    fi

    chmod +x "$WORK_DIR/update.sh" "$WORK_DIR/uninstall-linux.sh" 2>/dev/null || true
    echo "  ✓ Filer kopierade till $WORK_DIR"
fi

if [ ! -f "$WORK_DIR/index.js" ] || [ ! -f "$WORK_DIR/package.json" ]; then
    echo "  ❌ Installationen blev ofullständig – saknar index.js eller package.json i $WORK_DIR"
    exit 1
fi

# 4. Installera dependencies
echo "[4/7] Installerar dependencies..."
cd "$WORK_DIR"
npm install --production
echo "  ✓ Dependencies installerade"

# 5. Skapa .env-fil
echo "[5/7] Skapar konfiguration..."
DEVICE_ID=$(hostname | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]-')

cat > "$WORK_DIR/.env" << EOF
# Cast Away Configuration
# Genererad $(date +"%Y-%m-%d %H:%M")

DEVICE_ID=$DEVICE_ID
PORT=$PORT
EOF

echo "  ✓ Device ID: $DEVICE_ID"
echo "  ✓ Port: $PORT"

# 6. Skapa systemd user service
echo "[6/7] Skapar systemd service..."
mkdir -p "$SYSTEMD_DIR"

NODE_PATH=$(command -v node)
cat > "$SYSTEMD_DIR/$SERVICE_NAME.service" << EOF
[Unit]
Description=Cast Away - $APP_NAME
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$WORK_DIR
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

cat > "$SYSTEMD_DIR/$SERVICE_NAME-restart.service" << EOF
[Unit]
Description=Restart Cast Away - $APP_NAME

[Service]
Type=oneshot
ExecStart=/bin/systemctl --user restart $SERVICE_NAME
EOF

cat > "$SYSTEMD_DIR/$SERVICE_NAME-restart.timer" << EOF
[Unit]
Description=Nightly restart of Cast Away - $APP_NAME

[Timer]
OnCalendar=*-*-* 05:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

if [ -f "$WORK_DIR/update.sh" ]; then
    cat > "$SYSTEMD_DIR/$SERVICE_NAME-update.service" << EOF
[Unit]
Description=Auto-update Cast Away - $APP_NAME

[Service]
Type=oneshot
WorkingDirectory=$WORK_DIR
ExecStart=/bin/bash $WORK_DIR/update.sh
Environment=HOME=$HOME
EOF

    cat > "$SYSTEMD_DIR/$SERVICE_NAME-update.timer" << EOF
[Unit]
Description=Hourly auto-update check for Cast Away - $APP_NAME

[Timer]
OnCalendar=*-*-* *:15:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
fi

echo "  ✓ Systemd-filer skapade"

# 7. Aktivera timers och starta service
echo "[7/7] Aktiverar service..."

# Aktivera lingering för att köra services utan inloggning
loginctl enable-linger "$CURRENT_USER" 2>/dev/null || true

# Ladda om så systemd ser nya unit-filer innan enable/start
systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME-restart.timer"
systemctl --user start "$SERVICE_NAME-restart.timer"

if [ -f "$WORK_DIR/update.sh" ]; then
    systemctl --user enable "$SERVICE_NAME-update.timer"
    systemctl --user start "$SERVICE_NAME-update.timer"
    echo "  ✓ Auto-update aktiverat (kollar varje timme)"
else
    systemctl --user disable --now "$SERVICE_NAME-update.timer" 2>/dev/null || true
    echo "  ⚠️ update.sh saknas, auto-update ej konfigurerat"
fi

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
echo "  Kör från:  $WORK_DIR"
echo ""