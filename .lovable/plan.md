
# Plan: Fixa URL Refresh Timer vid Ny Cast

## Problem
När en ny cast startas i `castMedia()` uppdateras inte `lastUrlRefreshTime`. Detta gör att URL refresh-intervallet beräknas från bridge-starttiden istället för från när casten faktiskt startade.

**Symptom i loggen:**
```
19:50:29 ✅ Cast successful
19:50:31 ⏰ URL refresh interval reached (127 min)  ← FEL!
```

## Lösning
Lägg till `lastUrlRefreshTime = Date.now()` i `castMedia()` direkt efter att URL:en skickats till receivern.

## Tekniska ändringar

### `bridge/index.js`
**Rad ~1030-1032** - Efter "Cast successful":

```javascript
log.info('✅ Cast successful - keeping connection alive indefinitely');
screensaverActive = true;
lastUrlRefreshTime = Date.now(); // <-- LÄGG TILL: Reset URL refresh timer
stopRecoveryCheck();
```

## Resultat

| Före | Efter |
|------|-------|
| URL refresh triggas direkt efter cast (127+ min) | URL refresh triggas efter konfigurerat intervall (30 min default) |
| Baseras på bridge-starttid | Baseras på senaste URL-sändning |

## Filer att ändra
1. `bridge/index.js` - Lägg till en rad i `castMedia()`
