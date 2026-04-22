# Cast Away – Raspberry Pi Edition

Ren Chromecast-screensaver-bridge för Raspberry Pi. Inga Sonos-beroenden, inga molntjänster – allt körs lokalt.

## Arkitektur

Cast Away körs som en tjänst i **Pi Control Center** (PCC) med två komponenter:

- **Engine** (`engine/index.js`) — Node.js-backend som hanterar Chromecast-discovery, casting och API
- **UI** (`dist/`) — Statiskt webbgränssnitt för konfiguration

Portkonvention: Om UI körs på port `N`, lyssnar engine på port `N + 50`.

## Installation via Pi Control Center

Cast Away installeras och hanteras automatiskt via PCC. Se [Pi Control Center](https://github.com/raagerrd-ship-it/pi-control-center) för instruktioner.

Tjänsten definieras i `service.json` och inkluderar installations-, uppdaterings- och avinstallationsskript i `scripts/`.

### PCC-regler för tjänsten

- Installera **inte** Node.js själv — PCC tillhandahåller Node.js v24.
- Behåll egna dependencies per tjänst i lokala `node_modules`; använd inte globala eller delade paket.
- Läs engine-port från `process.env.PORT`.
- UI ska antingen räkna engine-port som `UI_PORT + 50` eller läsa `ENGINE_PORT` om den finns.
- Använd alltid PCC:s kataloger via miljövariabler:
  - inställningar/konfiguration: `process.env.PCC_CONFIG_DIR`
  - persistent data/state/cache/användardata: `process.env.PCC_DATA_DIR`
  - loggar: `process.env.PCC_LOG_DIR`
- Spara inställningar i `PCC_CONFIG_DIR/settings.json`.
- Spara aldrig viktig data i `/opt/`; den katalogen är endast appkod och kan ersättas vid uppdatering.
- Hårdkoda inte PCC-sökvägar som `/etc/pi-control-center/...` eller `/var/lib/pi-control-center/...`; läs alltid från miljövariablerna.
- Deklarera PCC-behörigheter i `service.json`. För Cast Away krävs `network` och `multicast`.
- Implementera `GET /api/health` i engine och returnera minst `status`, `uptime`, `memory.rss` och gärna `version`.
- Skriv inte egna systemd-tjänster när PCC hanterar livscykeln.
- Lyssna på `SIGTERM` och stäng ner rent.
- Distribuera releaser som `dist.tar.gz` med färdigbyggd kod och prod-dependencies.
- Native-moduler ska rebuildas mot PCC:s Node v24 vid installation, inte mot en egen Node-installation.
- Kort regel: **PCC äger runtime, portar, resurser, loggar, config och behörigheter — tjänsten äger bara sin appkod och sina dependencies.**

## Manuell utveckling

### Förutsättningar
- Node.js 18 eller senare
- En enhet på samma nätverk som din Chromecast

### Steg

```bash
cd bridge-pi/engine
npm install
cp .env.example .env
# Redigera .env med ditt DEVICE_ID
npm start
```

## Konfiguration

- `DEVICE_ID`: Unikt namn för denna bridge-instans
- `PORT`: HTTP-port för engine (standard: 3052 via PCC)

## API-endpoints

| Endpoint | Beskrivning |
|---|---|
| `/api/health` | Hälsostatus (PCC-kompatibel) |
| `/api/version` | Version och git-info |
| `/api/status` | Hårdvarustatus (CPU, minne, temperatur) |
| `/api/devices` | Upptäckta Chromecast-enheter |
| `/api/config` | Läs/skriv konfiguration |

## Felsökning

### Bridge:n hittar inte Chromecast
- Kontrollera att enheten är på samma nätverk som din Chromecast
- Kontrollera att mDNS/Bonjour inte blockeras av brandväggen
- Försök starta om din Chromecast

### Installationsfel

Ubuntu/Debian/Raspberry Pi OS:
```bash
sudo apt-get install libavahi-compat-libdnssd-dev
```

## Säkerhet

All data lagras lokalt i PCC:s kataloger (`PCC_CONFIG_DIR`, `PCC_DATA_DIR`, `PCC_LOG_DIR`). Ingen data skickas till molnet.
