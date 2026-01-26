
# Slutfinish: Toast-notifikationer, Restart-progress och Konfigurerbart Auto-Refresh

## Sammanfattning
Tre slutliga förbättringar för att göra bridge-dashboarden och Chromecast receiver komplett:
1. Toast-notifikationssystem för feedback
2. Visuell nedräkning under omstart
3. Konfigurerbart auto-refresh intervall för receiver

---

## 1. Toast-notifikationssystem

### Beskrivning
Ett icke-blockerande notifikationssystem som visar feedback vid:
- Inställningar sparade
- Cast startad/stoppad
- Återställning till standardvärden
- Fel vid API-anrop
- Kopiering av URL

### Ändringar

**bridge/public/style.css**
Lägg till styling för toast-container och animationer:
```css
.toast-container {
  position: fixed;
  bottom: 1rem;
  right: 1rem;
  z-index: 1000;
  display: flex;
  flex-direction: column-reverse;
  gap: 0.5rem;
}

.toast {
  padding: 0.75rem 1rem;
  border-radius: 8px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  animation: toast-in 0.3s ease-out;
}

.toast.success { border-left: 3px solid var(--success); }
.toast.error { border-left: 3px solid var(--danger); }
.toast.info { border-left: 3px solid var(--primary); }

@keyframes toast-in {
  from { opacity: 0; transform: translateX(100%); }
  to { opacity: 1; transform: translateX(0); }
}
```

**bridge/public/index.html**
Lägg till toast-container före script-taggen:
```html
<div id="toast-container" class="toast-container"></div>
```

**bridge/public/app.js**
Ny funktion `showToast(message, type)` och integration i:
- `saveSettings()` - "Inställningar sparade"
- `startCast()` - "Cast startad"
- `stopCast()` - "Cast stoppad"
- Reset-knappar - "Återställt till standard"
- Copy URL - redan implementerad inline, flytta till toast

---

## 2. Visuell nedräkning under omstart

### Beskrivning
Ersätter nuvarande "Startar om..." med en visuell nedräknings-overlay som visar:
- Återanslutnings-progress
- Sekund-räknare
- Animerad spinner

### Ändringar

**bridge/public/style.css**
```css
.restart-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 999;
  gap: 1rem;
}

.restart-spinner {
  width: 48px;
  height: 48px;
  border: 3px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.restart-timer {
  font-size: 1.25rem;
  color: var(--text);
}
```

**bridge/public/index.html**
Lägg till overlay-element (dolt som standard):
```html
<div id="restart-overlay" class="restart-overlay" style="display: none;">
  <div class="restart-spinner"></div>
  <div class="restart-message">Startar om bridge...</div>
  <div class="restart-timer" id="restart-timer">0s</div>
</div>
```

**bridge/public/app.js**
Uppdatera restart-logiken:
- Visa overlay vid omstart
- Starta en räknare som tickar varje sekund
- Visa "Återansluter..." när polling börjar
- Dölj overlay när anslutning återupprättad

---

## 3. Konfigurerbart Auto-Refresh för Receiver

### Beskrivning
Exponera det hårdkodade 45-minuters auto-refresh intervallet i dashboarden.

### Ändringar

**bridge/index.js**
Lägg till i DEFAULT_CONFIG:
```javascript
receiverAutoRefresh: 45  // Auto-refresh receiver (minuter)
```

**bridge/public/index.html**
Lägg till i Cast & Session-gruppen:
```html
<div class="form-group">
  <label for="receiver-auto-refresh-input">Receiver auto-refresh (min)</label>
  <input type="number" id="receiver-auto-refresh-input" min="15" max="120" step="5" value="45">
  <span class="hint">Hur ofta receiver startar om för minnesrensning (standard: 45)</span>
</div>
```

**bridge/public/app.js**
- Lägg till element-referens
- Uppdatera loadSettings och settingsInputs
- Lägg till i DEFAULT_VALUES och resetCastBtn

**public/chromecast-receiver.html**
Ändra så den tar emot refresh-intervall via URL-parameter:
```javascript
// Läs från URL eller default till 45 minuter
const urlParams = new URLSearchParams(window.location.search);
const refreshMinutes = parseInt(urlParams.get('refresh') || '45', 10);
const refreshMs = refreshMinutes * 60 * 1000;

setInterval(() => {
  console.log('Auto-refresh to clear memory');
  window.location.reload();
}, refreshMs);
```

**bridge/index.js**
Uppdatera castMedia() för att skicka refresh-parameter:
```javascript
const config = loadConfig();
const refreshParam = config.receiverAutoRefresh || 45;
const urlWithParams = `${url}?refresh=${refreshParam}`;
```

---

## Versionshantering
Bumpa till `1.3.13` med changelog:
- SV: "Toast-notifikationer, visuell omstarts-progress, konfigurerbart receiver auto-refresh"
- EN: "Toast notifications, visual restart progress, configurable receiver auto-refresh"

---

## Filöversikt

| Fil | Ändringar |
|-----|-----------|
| `bridge/public/style.css` | Toast och overlay styling |
| `bridge/public/index.html` | Toast-container, overlay, ny setting |
| `bridge/public/app.js` | Toast-funktion, overlay-logik, ny setting-hantering |
| `bridge/index.js` | DEFAULT_CONFIG, cast URL med parameter |
| `public/chromecast-receiver.html` | Läs refresh från URL-parameter |
| `supabase/functions/get-version/index.ts` | Version 1.3.13 + changelog |
