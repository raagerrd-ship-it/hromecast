
# Plan: URL Refresh Timer Fix ✅ KLAR

## Problem (löst)
När en ny cast startades i `castMedia()` uppdaterades inte `lastUrlRefreshTime`. Detta gjorde att URL refresh-intervallet beräknades från bridge-starttiden istället för från när casten faktiskt startade.

## Lösning (implementerad)

### 1. Reset timer vid cast ✅
Lagt till `lastUrlRefreshTime = Date.now()` i `castMedia()` efter lyckad cast.

### 2. Förenklad URL-refresh logik ✅
- Borttagen: Separat `refreshUrlInterval` setting (30 min default)
- Ny logik: URL skickas automatiskt 2 minuter innan `receiverAutoRefresh` (45 min default)
- Resultat: URL skickas vid ~43 min, receiver laddar om vid 45 min

### 3. Städat debug-loggar ✅
- Flyttat `[DEBUG]` receiver-meddelanden till `log.debug()`
- Flyttat `[RECOVERY] Checking device status...` till `log.debug()`
- Debug-loggar sparas alltid i buffer men visas bara om debug-filtret är aktivt

## Filer ändrade
- `bridge/index.js` - Timer-fix, förenklad refresh-logik, debug-loggar
- `bridge/public/index.html` - Borttagen URL-refresh setting
- `bridge/public/app.js` - Borttagen URL-refresh setting

## Resultat

| Före | Efter |
|------|-------|
| URL refresh triggades direkt efter cast (127+ min) | Triggas 2 min innan receiver auto-refresh |
| Två separata timers | En timer styr allt |
| Debug-loggar visades alltid | Debug-loggar dolda som default |
