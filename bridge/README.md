# Chromecast Bridge Service

Lokal tjänst för att styra Chromecast-skärmsläckare. Körs helt offline utan molnberoenden.

## Hur det fungerar

1. Bridge:n körs på en enhet i ditt lokala nätverk (samma nätverk som din Chromecast)
2. Den upptäcker Chromecast-enheter automatiskt via mDNS
3. Du konfigurerar skärmsläckaren via webbgränssnittet på `http://localhost:3000`
4. Bridge:n aktiverar skärmsläckaren automatiskt när Chromecast:en är inaktiv

## Snabbinstallation

### Windows

1. Ladda ner bridge-paketet
2. Högerklicka på `install-windows.ps1` → "Kör med PowerShell som administratör"
3. Öppna `http://localhost:3000` i webbläsaren

### Linux / Raspberry Pi

```bash
cd chromecast-bridge
chmod +x install-linux.sh
./install-linux.sh
```

## Manuell installation

### Förutsättningar
- Node.js 18 eller senare
- En enhet på samma nätverk som din Chromecast

### Steg

1. Navigera till bridge-mappen:
```bash
cd bridge
```

2. Installera beroenden:
```bash
npm install
```

3. Skapa din `.env`-fil:
```bash
cp .env.example .env
```

4. Redigera `.env`:
```env
DEVICE_ID=mitt-vardagsrum
PORT=3000
```

5. Starta bridge:n:
```bash
npm start
```

## Konfiguration

- `DEVICE_ID`: Unikt namn för denna bridge-instans (visas i webbgränssnittet)
- `PORT`: HTTP-port för webbgränssnittet (standard: 3000)

## Webbgränssnitt

Öppna `http://localhost:3000` (eller IP-adressen från nätverket) för att:
- Välja vilken Chromecast som ska användas
- Ange URL för skärmsläckaren
- Aktivera/inaktivera automatisk skärmsläckare
- Manuellt starta/stoppa casting

## Köra som bakgrundstjänst

### Linux (systemd)

Installationsskriptet skapar automatiskt en systemd user service. Användbara kommandon:

```bash
systemctl --user status chromecast-bridge
systemctl --user stop chromecast-bridge
systemctl --user start chromecast-bridge
journalctl --user -u chromecast-bridge -f
```

### Windows

Installationsskriptet skapar en Scheduled Task som startar vid systemstart.

## Felsökning

### Bridge:n hittar inte Chromecast
- Kontrollera att enheten är på samma nätverk som din Chromecast
- Kontrollera att mDNS/Bonjour inte blockeras av brandväggen
- Försök starta om din Chromecast

### Installationsfel på Linux

Om du får fel vid npm install, kan du behöva installera systemberoenden:

Ubuntu/Debian:
```bash
sudo apt-get install libavahi-compat-libdnssd-dev
```

## Flera instanser

Du kan köra flera bridge-instanser (t.ex. en per rum) genom att ange olika instansnamn vid installation. Varje instans får sin egen port och konfiguration.

## Säkerhet

All data lagras lokalt i `config.json`. Ingen data skickas till molnet.

## PCC-riktlinjer för tjänster

Om bridge:n körs under Pi Control Center gäller följande:

- Installera **inte** Node.js själv — PCC tillhandahåller Node.js v24.
- Behåll egna dependencies per tjänst i lokala `node_modules`; använd inte globala eller delade paket.
- Läs motorport från `process.env.PORT`.
- Om UI körs separat kan motorporten räknas som `UI_PORT + 50` eller läsas från `ENGINE_PORT`.
- Använd PCC:s kataloger:
  - config/secrets: `process.env.PCC_CONFIG_DIR`
  - loggar: `process.env.PCC_LOG_DIR`
- Deklarera PCC-behörigheter i tjänstedefinitionen. För Cast Away krävs `network` och `multicast`.
- Motorn ska exponera `GET /api/health` och returnera minst `status`, `uptime`, `memory.rss` och gärna `version`.
- Skriv inte egna systemd-tjänster om PCC redan hanterar appen.
- Lyssna på `SIGTERM` och stäng ner rent.
- Distribuera releaser som `dist.tar.gz` med färdigbyggd kod och prod-dependencies.
- Native-moduler ska rebuildas mot PCC:s Node v24 vid installation, inte mot en egen Node-installation.
- Kort regel: **PCC äger runtime, portar, resurser, loggar, config och behörigheter — tjänsten äger bara sin appkod och sina dependencies.**
