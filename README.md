# Chromecast Screensaver Bridge

Casta webbsidor till din Chromecast som en skärmsläckare när enheten är inaktiv.

🌐 **Live app**: [hromecast.lovable.app](https://hromecast.lovable.app)

## Funktioner

- 🖥️ Casta valfri webbsida till Chromecast
- ⏰ Automatisk skärmsläckare när Chromecast är inaktiv
- 🔍 Automatisk upptäckt av Chromecast-enheter
- 🎛️ Webbaserad dashboard för konfiguration
- 🔄 Automatiska uppdateringar

## Arkitektur

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Webb-app      │     │   Bridge        │     │   Chromecast    │
│   (React)       │────▶│   (Node.js)     │────▶│   (Custom App)  │
│                 │     │   Lokalt        │     │   FE376873      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

- **Webb-app**: React-frontend för nedladdning och dokumentation
- **Bridge**: Node.js-server som körs lokalt i ditt nätverk
- **Custom Receiver**: Chromecast-app som visar webbsidor i fullskärm

## PCC-kontrakt för tjänster

För tjänster som körs under Pi Control Center gäller samma basregler:

- Installera **inte** Node.js själv — PCC tillhandahåller Node.js v24.
- Varje tjänst behåller sina egna dependencies i lokala `node_modules`.
- Läs motorport från `process.env.PORT`.
- UI kan räkna motorport som `UI_PORT + 50` eller använda `ENGINE_PORT`.
- Använd PCC-kataloger för config/secrets (`process.env.PCC_CONFIG_DIR`) och loggar (`process.env.PCC_LOG_DIR`).
- Deklarera behörigheter i tjänstedefinitionen (`service.json`/`services.json`), t.ex. `network` och `multicast` för Cast Away eller `bluetooth` för Lotus.
- Motorn ska erbjuda `GET /api/health` med minst `status`, `uptime`, `memory.rss` och gärna `version`.
- Skriv inte egna systemtjänster om PCC redan hanterar runtime och livscykel.
- Lyssna på `SIGTERM` och stäng ner rent.
- Publicera releaser som `dist.tar.gz` med färdigbyggd kod och prod-dependencies.
- Rebuilda native-moduler mot PCC:s Node v24 vid installation.
- Kort regel: **PCC äger runtime, portar, resurser, loggar, config och behörigheter — tjänsten äger bara sin appkod och sina dependencies.**

## Installation

1. Besök [hromecast.lovable.app/setup](https://hromecast.lovable.app/setup)
2. Ladda ner bridge-paketet
3. Följ installationsguiden för ditt operativsystem

## Utveckling

```bash
# Installera dependencies
npm install

# Starta utvecklingsserver
npm run dev
```

## Teknologier

- **Frontend**: React, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend**: Supabase Edge Functions
- **Bridge**: Node.js, castv2, Bonjour

## Licens

MIT
