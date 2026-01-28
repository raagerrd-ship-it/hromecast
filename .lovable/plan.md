
# Plan: Loggfiltrering i Bridge Dashboard (v1.3.43)

## Sammanfattning
Lägg till möjlighet att filtrera loggar efter typ/kategori i dashboarden. Användaren kan välja vilka loggtyper som ska visas via knappar/checkboxar.

## Loggkategorier

Baserat på nuvarande loggmönster definieras följande kategorier:

| Kategori | Mönster | Exempel |
|----------|---------|---------|
| `debug` | `[DEBUG]` | Protokollhandskakningar, CONNECT, RECEIVER_STATUS |
| `cast` | Cast-relaterat | "Cast successful", "Launching app", "Sending URL" |
| `status` | Heartbeat/status | Statusloggar med emoji |
| `error` | Fel | Felmeddelanden |
| `system` | Övrigt | Startup, reconnect, refresh |

## Tekniska ändringar

### 1. `bridge/index.js`
- Lägg till `category`-fält på varje loggpost
- Kategorisera baserat på meddelandeinnehåll i `addLog()`-funktionen
- Bumpa version till **1.3.43**

```javascript
function addLog(level, message) {
  // Determine category based on message content
  let category = 'system';
  if (message.includes('[DEBUG]')) {
    category = 'debug';
  } else if (message.includes('Cast') || message.includes('Launching') || message.includes('Sending URL')) {
    category = 'cast';
  } else if (message.startsWith('📊') || message.includes('Heartbeat')) {
    category = 'status';
  } else if (level === 'error' || message.includes('❌') || message.includes('Failed')) {
    category = 'error';
  }
  
  logBuffer.push({
    timestamp: new Date().toISOString(),
    level,
    message,
    category  // NEW
  });
}
```

### 2. `bridge/public/index.html`
- Lägg till filter-knappar i logg-sektionens header

```html
<section class="card logs-card">
  <div class="card-header">
    <h2>Loggar</h2>
    <div class="log-filters">
      <button class="log-filter active" data-filter="all">Alla</button>
      <button class="log-filter active" data-filter="cast">Cast</button>
      <button class="log-filter active" data-filter="status">Status</button>
      <button class="log-filter" data-filter="debug">Debug</button>
      <button class="log-filter active" data-filter="error">Fel</button>
    </div>
    <button id="clear-logs-btn" ...>Rensa</button>
  </div>
  ...
</section>
```

### 3. `bridge/public/app.js`
- Spara filterinställningar i `localStorage`
- Filtrera loggar innan rendering
- Hantera klick på filter-knappar

```javascript
// Filter state (debug OFF by default)
let logFilters = JSON.parse(localStorage.getItem('logFilters')) || {
  all: true,
  cast: true,
  status: true,
  debug: false,  // Hidden by default
  error: true,
  system: true
};

function updateLogs(logs) {
  // Filter logs based on active filters
  const filteredLogs = logs.filter(log => {
    if (logFilters.all) return true;
    return logFilters[log.category || 'system'];
  });
  // ... render filteredLogs
}

// Filter button click handlers
document.querySelectorAll('.log-filter').forEach(btn => {
  btn.addEventListener('click', () => {
    const filter = btn.dataset.filter;
    if (filter === 'all') {
      // Toggle all
    } else {
      logFilters[filter] = !logFilters[filter];
    }
    localStorage.setItem('logFilters', JSON.stringify(logFilters));
    loadStatus(); // Refresh logs
  });
});
```

### 4. `bridge/public/style.css`
- Stilar för filter-knappar

```css
.log-filters {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
}

.log-filter {
  padding: 0.25rem 0.5rem;
  font-size: 0.7rem;
  border-radius: 4px;
  background: var(--bg-secondary);
  opacity: 0.5;
}

.log-filter.active {
  opacity: 1;
  background: var(--accent);
}
```

### 5. `supabase/functions/get-version/index.ts`
- Uppdatera version till **1.3.43**
- Lägg till changelog-entry

## Användarupplevelse

- **Debug-loggar dolda som standard** - Minskar brus för vanliga användare
- **Klicka för att toggla** - Enkelt att visa/dölja kategorier
- **Sparas i webbläsaren** - Inställningar bevaras mellan sessioner
- **"Alla"-knapp** - Snabbt sätt att visa/dölja allt

## Filer att ändra
1. `bridge/index.js` - Lägg till kategori på loggar
2. `bridge/public/index.html` - Filter-knappar i UI
3. `bridge/public/app.js` - Filtreringslogik
4. `bridge/public/style.css` - Stilar för filter-knappar
5. `supabase/functions/get-version/index.ts` - Version och changelog
