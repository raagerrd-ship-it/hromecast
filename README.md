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
