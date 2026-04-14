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

All data lagras lokalt i `config.json`. Ingen data skickas till molnet.
