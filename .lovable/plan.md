

# Plan: Bevara URL genom auto-refresh

## Problem
Receivern förlorar URL-staten när auto-refresh (45 min) triggar `window.location.reload()`. Resultatet är att TV:n visar "Ready to cast..." istället för att fortsätta visa webbplatsen.

## Lösning
Spara den aktuella URL:en i `localStorage` innan auto-refresh och ladda om den automatiskt efter att receivern startat om.

## Tekniska ändringar

### Fil: `public/chromecast-receiver.html`

1. **Spara URL i localStorage när den laddas**
   - I `loadWebsite(url)` funktionen, spara URL:en: `localStorage.setItem('lastUrl', url)`

2. **Återställ URL efter auto-refresh**
   - Efter att receivern initialiserats, kontrollera om det finns en sparad URL
   - Om ja, ladda den automatiskt: `loadWebsite(localStorage.getItem('lastUrl'))`

3. **Uppdatera versionsnummer**
   - Bumpa till v1.3.39 för att spåra ändringen

## Pseudokod

```text
function loadWebsite(url) {
  // ... existing code ...
  currentUrl = url;
  localStorage.setItem('lastUrl', url);  // <-- NY RAD
  // ... rest of function ...
}

// Efter context.start():
const savedUrl = localStorage.getItem('lastUrl');
if (savedUrl) {
  log('info', 'Restoring saved URL: ' + savedUrl);
  loadWebsite(savedUrl);
}
```

## Förväntad effekt
- TV:n kommer automatiskt att visa samma webbplats efter auto-refresh
- Ingen manuell åtgärd krävs från användaren
- Bridge behöver inte skicka URL:en igen

