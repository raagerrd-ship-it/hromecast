

## Plan: Skapa separat Raspberry Pi-version (bridge-pi/)

Behåller nuvarande `bridge/` intakt med all Sonos+Chromecast-kod. Skapar en ny mapp `bridge-pi/` som är en ren Chromecast-only version för Raspberry Pi.

### Vad som skapas

```text
bridge-pi/
├── index.js           # Ren Chromecast-logik (~1800 rader, kopierad från bridge/ minus Sonos)
├── package.json       # cast-away-pi 1.4.0
├── .env.example       # Bara DEVICE_ID + PORT
├── install-linux.sh   # Pi-optimerad installer
├── uninstall-linux.sh # Kopierad från bridge/
├── public/            # Samma filer som bridge/public/
│   ├── index.html
│   ├── app.js
│   └── style.css
└── README.md          # Uppdaterad för ren Chromecast
```

### Vad som tas bort ur bridge-pi/index.js

Allt mellan sektionerna "Sonos UPnP Helpers" (rad 174) och "Circuit Breaker" (rad 1165):
- Sonos SOAP/UPnP-funktioner
- Sonos event subscription + SSE
- Bridge push till brew-monitor (Supabase)
- Sonos-specifika konstanter och state-variabler (`SONOS_IP`, `SUPABASE_PUSH_URL`, `BRIDGE_SECRET`, etc.)
- Stale-position-detektion
- Sonos API-routes i HTTP-servern (`/api/sonos/*`, `/api/sonos/status`, `/api/sonos/events`, etc.)

### Vad som behålls

- Chromecast mDNS discovery (bonjour-service)
- Cast-session (castv2, launch, URL, keep-alive, heartbeat)
- Screensaver-logik (idle detection, auto-launch, circuit breaker, IP recovery)
- Config-system, structured logging, log buffer
- HTTP server med Chromecast API-routes
- Webbpanel (public/)

### Övriga ändringar

1. **`bridge-pi/package.json`** — namn `cast-away-pi`, version `1.4.0`, bara `castv2`, `bonjour-service`, `dotenv`
2. **`bridge-pi/.env.example`** — bara `DEVICE_ID` och `PORT`
3. **`bridge-pi/install-linux.sh`** — "Cast Away"-branding, anpassad för Pi
4. **`bridge-pi/README.md`** — ren Chromecast-dokumentation utan Sonos-referenser
5. **`supabase/functions/get-version/index.ts`** — ny version `1.4.0` med changelog-entry för Pi-edition
6. **`bridge/` lämnas helt orörd**

### Tekniska detaljer

- `BRIDGE_VERSION` sätts till `'1.4.0'` i bridge-pi/index.js
- Alla 542 Sonos-referenser i index.js elimineras
- HTTP-servern förenklas: alla `/api/sonos/*`-routes tas bort
- `categorizeLog` uppdateras (ta bort sonos-kategorin om den finns)

