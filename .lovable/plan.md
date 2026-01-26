

# Fixa 60-sekunders statusloggning

## Problem
Statusloggningen försvann helt på grund av två buggar:

### Bugg 1: Index blir ogiltigt
När `addToLogBuffer()` anropas av andra loggar (t.ex. "Söker efter enheter...") och buffern är full, körs `logBuffer.shift()`. Detta minskar alla index med 1, men `lastStatusCheckIndex` uppdateras inte - så den pekar på fel post eller utanför buffern.

### Bugg 2: Ingen initial post vid start
Om screensavern redan är aktiv vid start och status inte ändras, skapas aldrig någon statuspost eftersom `lastLoggedCheckStatus` börjar som `null` och sedan sätts till `'our_app'` - men ingen post skapas förrän status **ändras**.

## Lösning
Istället för att spåra index, sök efter posten med `isStatusCheck: true` direkt i buffern:

```javascript
// Hitta befintlig statuspost
const existingIndex = logBuffer.findIndex(e => e.isStatusCheck);

if (currentCheckKey !== lastLoggedCheckStatus || existingIndex === -1) {
  // Status ändrad ELLER ingen post finns ännu - skapa/ersätt
  lastLoggedCheckStatus = currentCheckKey;
  
  // Ta bort gammal statuspost om den finns
  if (existingIndex >= 0) {
    logBuffer.splice(existingIndex, 1);
  }
  
  // Lägg till ny
  logBuffer.push({
    timestamp: new Date().toISOString(),
    level: 'info',
    message: `📡 Statusändring (${checkTime}): ${statusText}`,
    isStatusCheck: true
  });
} else {
  // Status oförändrad - uppdatera bara tidsstämpel
  logBuffer[existingIndex].timestamp = new Date().toISOString();
  logBuffer[existingIndex].message = `📡 Senaste kontroll (${checkTime}): ${statusText}`;
}
```

## Fördelar
- Ingen sårbar indexspårning
- Alltid hittar rätt post via `isStatusCheck`-flaggan
- Skapar alltid en post första gången (fixar bugg 2)
- Robust mot bufferrotation

## Filändringar

| Fil | Ändring |
|-----|---------|
| `bridge/index.js` | Ersätt index-logik med findIndex-sökning |
| `supabase/functions/download-bridge/index.ts` | Samma ändring i INDEX_JS |
| `supabase/functions/get-version/index.ts` | Version 1.3.21 |

