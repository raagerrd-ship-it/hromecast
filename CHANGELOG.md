# Changelog

Alla betydande ändringar i Chromecast Bridge dokumenteras här.

Formatet är baserat på [Keep a Changelog](https://keepachangelog.com/sv/1.0.0/),
och projektet följer [Semantic Versioning](https://semver.org/lang/sv/).

## [1.2.2] - 2026-01-24

### Fixat
- **Sessionsstörning**: Tog bort health check-funktionen som skapade nya anslutningar och störde aktiva cast-sessioner
- **Förenklad logik**: Använder endast `screensaverActive`-flaggan för att undvika dubbla cast-försök

## [1.2.1] - 2026-01-24

### Fixat
- **Health check**: Verifierar att screensaver-appen fortfarande körs innan idle-check
- **Återanslutningsbugg**: Förhindrar att bridge försöker återansluta till redan körande screensaver
- **Konservativ felhantering**: Antar att appen körs vid timeout/error istället för att störa sessionen

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

Versionen hanteras automatiskt via edge-funktionen `get-version`.

**För att släppa en ny version:**

1. Öppna `supabase/functions/get-version/index.ts`
2. Uppdatera `VERSION_INFO`:
   - Ändra `version` till den nya versionen
   - Uppdatera `releasedAt` till dagens datum
   - Lägg till ändringar i `changelog`-arrayen
3. Publicera projektet

Allt synkas automatiskt:
- Webb-appen visar den nya versionen
- Nedladdade bridges får den nya versionen inbakad
- Användare ser varning om de har en äldre version
