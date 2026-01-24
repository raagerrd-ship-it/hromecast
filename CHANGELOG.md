# Changelog

Alla betydande ändringar i Chromecast Bridge dokumenteras här.

Formatet är baserat på [Keep a Changelog](https://keepachangelog.com/sv/1.0.0/),
och projektet följer [Semantic Versioning](https://semver.org/lang/sv/).

## [1.1.0] - 2025-01-24

### Tillagt
- **Versionsvisning**: Bridge-tjänsten returnerar nu sin version via `/api/status`
- **Versionsvarning**: Webb-appen visar en varning om din lokala bridge har en äldre version
- **Senaste version i footer**: Startsidan visar nu senaste tillgängliga version
- **Versionsskript**: Nytt skript `scripts/update-version.js` för att uppdatera version på alla ställen

### Förbättrat
- Refaktorerat `downloadBridge`-funktionen till en gemensam hook (`useDownloadBridge`)
- Fixat kopiera-knappens state så varje knapp har oberoende feedback
- Översatt NotFound-sidan till svenska

### Städat
- Tagit bort oanvända databastabeller (`screensaver_settings`, `cast_commands`, `discovered_chromecasts`)
- Tagit bort hårdkodad fallback-URL i Chromecast-receiver
- Tagit bort oanvända importer

## [1.0.0] - 2025-01-17

### Tillagt
- **Offline-first arkitektur**: Helt lokal drift utan molnberoenden
- **Lokal dashboard**: Webb-baserat gränssnitt på `localhost:3000`
- **Chromecast-upptäckt**: Automatisk upptäckt av Chromecasts via mDNS/Bonjour
- **Screensaver-funktion**: Visa automatiskt en webbsida när Chromecast är inaktiv
- **Custom receiver**: Egen Chromecast-app (FE376873) för att visa webbsidor
- **Multi-instans**: Stöd för flera bridge-instanser på samma nätverk
- **mDNS-publicering**: Bridge:n annonserar sig som `device-id.local`
- **Installationsscript**: Enkla installerare för Windows och Linux
- **Webb-app**: Landningssida med discovery av lokala bridges

### Tekniskt
- Node.js-baserad bridge-tjänst
- Använder `chromecasts` och `bonjour-service` för nätverkskommunikation
- Konfiguration sparas i lokal `config.json`
- Stöd för castv2-client för kommunikation med custom receiver

---

## Versionshantering

För att uppdatera versionen, kör:

```bash
node scripts/update-version.js patch   # 1.1.0 → 1.1.1
node scripts/update-version.js minor   # 1.1.0 → 1.2.0
node scripts/update-version.js major   # 1.1.0 → 2.0.0
```

Skriptet uppdaterar automatiskt:
- `src/config/version.ts`
- `bridge/index.js`
- `supabase/functions/download-bridge/index.ts`

Glöm inte att uppdatera denna CHANGELOG när du släpper en ny version!
