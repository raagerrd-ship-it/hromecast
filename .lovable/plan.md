
# Plan: Visa uppdaterad status-tid varje minut i loggen

## Problem
Status-check-loggarna uppdaterar sina timestamps korrekt i bakgrunden, men eftersom de bara ändrar befintliga poster (inte skapar nya) så syns de inte som "nya händelser" i logglistan. Du ser bara URL-refresh-loggarna var 30:e minut.

## Lösning
Ändra logiken så att **statuscheck-loggarna alltid visas överst** med uppdaterad tid, oavsett om statusen har ändrats eller ej. Detta ger dig en "live-puls" som visar att systemet fungerar.

## Tekniska ändringar

### Fil 1: `bridge/index.js`

**Ändring i `checkAndActivateScreensaver()` (rad ~1218-1254)**

1. **Ta bort den tysta timestamp-uppdateringen**
   - Nuvarande logik uppdaterar bara timestamp utan att logga något nytt
   
2. **Gör om till en enda "sticky" statusrad**
   - Istället för 3 separata status-loggposter, konsolidera till 1 rad
   - Format: `📊 Status: [status] | Apps: [apps] | Tid: [HH:MM:SS]`
   - Uppdatera alltid denna enda rad med ny timestamp

3. **Alternativ: Lägg till en diskret "heartbeat"-logg**
   - En rad som bara visar "🔄 Kontroll: OK" med uppdaterad tid varje minut
   - Tar mindre plats i loggen

### Föreslagen implementering (alternativ 2 - minimal ändring)

```text
// I checkAndActivateScreensaver() efter att status är kontrollerad:

// Bygg en kompakt statuslogg
const statusEmoji = {
  'our_app': '✅',
  'idle': '⏸️', 
  'busy': '📺',
  'error': '❌'
}[result.status] || '❓';

const compactStatus = `${statusEmoji} ${result.status} | ${result.appList || 'none'}`;

// Uppdatera eller skapa den enda sticky-loggen
const now = new Date().toISOString();
const existingSticky = logBuffer.find(e => e.isStatusCheck);

if (existingSticky) {
  existingSticky.timestamp = now;
  existingSticky.message = `📊 Senast kontrollerat: ${compactStatus}`;
} else {
  logBuffer.push({
    timestamp: now,
    level: 'info',
    message: `📊 Senast kontrollerat: ${compactStatus}`,
    isStatusCheck: true
  });
}
```

## Resultat

- Du kommer se **en enda statusrad** i loggen som alltid visar senaste kontrollerad tid
- Raden uppdateras varje 60 sekunder (eller vad du ställt in `screensaverCheckInterval` till)
- Ingen spam - bara en rad som "rör sig" uppåt i loggen med ny tid
- Permanenta loggar (Cast, Stop, URL refresh) fortsätter fungera som vanligt

## Version

Bumpa till **v1.3.40** för spårning.

## Filer att ändra
- `bridge/index.js` - Förenklad statuslogg-logik
