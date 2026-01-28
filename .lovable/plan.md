
# Plan: Enkel heartbeat-logg med bevarad historik (v1.3.42)

## Sammanfattning
Ta bort "sticky"-konceptet helt. Varje minut jämförs den nya statusen med den senaste heartbeat-loggen:

- **Samma status** → Ta bort gamla, lägg till ny (uppdaterad tid)
- **Annan status** → Behåll gamla som historik, lägg till ny

## Tekniska ändringar

### Fil: `bridge/index.js`

**Ändring 1: Rad 1214-1232 - Ny jämförelselogik**

Nuvarande kod:
```javascript
// ALWAYS log status check so it's visible in dashboard (v1.3.41)
// Find existing sticky status entry and remove it first
const existingIdx = logBuffer.findIndex(entry => entry.isStatusCheck);
if (existingIdx !== -1) {
  logBuffer.splice(existingIdx, 1);
}

// Add new sticky entry at the end (will be sorted to top by timestamp in dashboard)
logBuffer.push({
  timestamp: now,
  level: 'info',
  message: `📊 ${compactStatus}`,
  isStatusCheck: true
});
```

Ny kod:
```javascript
// Heartbeat logging with deduplication (v1.3.42)
// Same status = replace (update time only)
// Different status = keep old as history, add new
const newMessage = `📊 ${compactStatus}`;
const existingIdx = logBuffer.findIndex(entry => entry.isHeartbeat);

if (existingIdx !== -1) {
  const existing = logBuffer[existingIdx];
  
  if (existing.message === newMessage) {
    // SAME status - remove old, add new with updated time
    logBuffer.splice(existingIdx, 1);
  } else {
    // DIFFERENT status - keep old as history (remove heartbeat flag)
    existing.isHeartbeat = false;
  }
}

// Add new heartbeat entry
logBuffer.push({
  timestamp: now,
  level: 'info',
  message: newMessage,
  isHeartbeat: true  // Used only to find this entry next time
});

// Trim buffer if needed
while (logBuffer.length > LOG_BUFFER_SIZE) {
  logBuffer.shift();
}
```

**Ändring 2: Rad 10 - Bumpa version**
```javascript
const BRIDGE_VERSION = '1.3.42';
```

**Ändring 3: Ta bort extra "Statusändring"-logg (rad 1234-1239)**

Eftersom vi nu bevarar gamla heartbeat-loggar som historik när status ändras, behövs inte den separata "🔄 Statusändring"-loggen längre. Den kan tas bort för att undvika duplicering.

## Resultat

Exempel på hur loggen kommer se ut:

```text
08:05:15  📊 ✅ Skärmsläckare aktiv | Apps: DADDDD    ← Senaste (uppdateras varje minut)
08:02:15  📊 ⏸️ Inaktiv | Apps: none                  ← Bevarad (status ändrades vid 08:03)
07:45:00  ✅ URL refresh sent to receiver
07:31:22  📊 ✅ Skärmsläckare aktiv | Apps: DADDDD    ← Bevarad (blev inaktiv vid 08:02)
```

- Ingen "sticky"-logik - allt sorteras kronologiskt automatiskt
- `isHeartbeat`-flaggan används bara internt för att hitta rätt post att jämföra med
- Historik bevaras när status ändras

## Filer att ändra
- `bridge/index.js`
