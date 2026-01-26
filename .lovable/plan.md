

# Kodrensning och Optimering v1.3.23

## Sammanfattning
Städa upp koden efter de senaste optimeringarna genom att ta bort oanvända funktioner, konstanter och konfigurationsvärden.

## Identifierade Problem

### 1. Oanvänd konfigurationsvärde
`discoveryInterval: 30` finns kvar i `DEFAULT_CONFIG` men används inte längre efter att vi tog bort den löpande discovery.

### 2. Oanvänd funktion
`periodicDiscoveryWithReconnect()` (rad 585-588) anropas inte längre och kan tas bort.

### 3. Inkonsekvent cooldown-hantering
`COOLDOWN_AFTER_TAKEOVER` på rad 1134 refererar till en konstant som inte existerar - bör använda config-värdet.

### 4. Duplicerad retry-logik
`castMediaWithRetry()` wrapper-funktionen (rad 964-976) är inte nödvändig eftersom `castMedia()` redan har inbyggd retry-logik.

## Ändringar

| Fil | Ändring |
|-----|---------|
| `bridge/index.js` | Ta bort `discoveryInterval` från DEFAULT_CONFIG |
| `bridge/index.js` | Ta bort `periodicDiscoveryWithReconnect()` |
| `bridge/index.js` | Fixa COOLDOWN_AFTER_TAKEOVER att använda config |
| `bridge/index.js` | Ta bort oanvänd `castMediaWithRetry()` |
| `supabase/functions/download-bridge/index.ts` | Samma ändringar i INDEX_JS |
| `supabase/functions/get-version/index.ts` | Version 1.3.23 |

## Tekniska detaljer

### Före (DEFAULT_CONFIG)
```javascript
const DEFAULT_CONFIG = {
  // ...
  discoveryInterval: 30, // <-- oanvänd
  // ...
};
```

### Efter
```javascript
const DEFAULT_CONFIG = {
  // ...
  // discoveryInterval borttagen - discovery körs bara vid start/återanslutning/manuellt
  // ...
};
```

### Fixa cooldown-referens
```javascript
// Före (rad 1134):
if (!skipCooldown && lastTakeoverTime > 0 && timeSinceTakeover < COOLDOWN_AFTER_TAKEOVER) {

// Efter:
const cooldownMs = (config.cooldownAfterTakeover || 30) * 1000;
if (!skipCooldown && lastTakeoverTime > 0 && timeSinceTakeover < cooldownMs) {
```

## Resultat
- Renare kod utan döda funktioner
- Konsekvent konfigurationshantering
- Mindre förvirring vid framtida underhåll
- Ingen funktionalitetsändring

