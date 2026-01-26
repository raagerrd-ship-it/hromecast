
# Plan: Fixa duplicerad config och kodrensning i Bridge

## Sammanfattning
Åtgärda det identifierade kodproblemet med duplicerad `config`-deklaration i `main()`-funktionen samt införa några mindre förbättringar för kodkvalitet.

---

## Ändringar

### 1. Ta bort duplicerad config-deklaration
**Fil:** `bridge/index.js`

I `main()`-funktionen finns två identiska deklarationer:
- **Rad 1445:** `const config = loadConfig();`
- **Rad 1476:** `const config = loadConfig();`

Den andra deklarationen är redundant och bör tas bort. Koden på rad 1476 kan återanvända den befintliga `config`-variabeln från rad 1445 eftersom ingen konfigurationsändring sker däremellan.

### 2. Konvertera raw console-anrop till log-objektet
**Fil:** `bridge/index.js`

Tre ställen använder direkt `console.error` istället för det strukturerade `log.error`:
- **Rad 435:** `console.error('Could not write network-info.txt:', error.message);`
- **Rad 448:** `console.error('Error loading config:', error.message);`
- **Rad 458:** `console.error('Error saving config:', error.message);`

Dessa bör ändras till `log.error` för konsekvent loggning och för att loggar ska synas i dashboardens loggvisning.

---

## Teknisk implementation

```text
┌─────────────────────────────────────────────────────────┐
│ bridge/index.js - main() funktion                       │
├─────────────────────────────────────────────────────────┤
│ FÖRE:                                                   │
│   1445: const config = loadConfig();                    │
│   ...                                                   │
│   1476: const config = loadConfig(); ← DUPLICERAT       │
│   1480: const screensaverMs = (config.screensaverCheck  │
│                                                         │
│ EFTER:                                                  │
│   1445: const config = loadConfig();                    │
│   ...                                                   │
│   1476: (rad borttagen)                                 │
│   1480: const screensaverMs = (config.screensaverCheck  │
│         (återanvänder config från rad 1445)             │
└─────────────────────────────────────────────────────────┘
```

---

## Verifiering efter implementation
- Bridge startar utan fel
- Screensaver-intervallet initieras korrekt
- Loggar från config-operationer syns i dashboard
