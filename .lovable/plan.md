
# Gör fler inställningar konfigurerbara och förbättra beskrivningar

## Mål
1. Exponera alla relevanta hårdkodade värden i dashboarden
2. Lägga till tydliga beskrivningar med standardvärden för varje inställning
3. Gruppera inställningar logiskt för bättre översikt

## Nya konfigurerbara inställningar

### Lägg till i DEFAULT_CONFIG:
| Nyckel | Standard | Beskrivning |
|--------|----------|-------------|
| `cooldownAfterTakeover` | 30 sek | Väntetid efter att annan app tagit över |
| `recoveryCheckInterval` | 10 sek | Hur ofta kontrollera återhämtning |
| `circuitBreakerThreshold` | 5 | Antal fel innan circuit breaker |
| `circuitBreakerCooldown` | 5 min | Paus när circuit breaker öppen |

### Lägg till i dashboarden (saknas idag):
| Nyckel | Standard | Beskrivning |
|--------|----------|-------------|
| `discoveryEarlyResolve` | 4 sek | Tidig avslutning av sökning |
| `idleStatusTimeout` | 5 sek | Timeout för idle-kontroll |

## Dashboard-uppdateringar

### Ny gruppering av inställningar

**Grupp 1: Sökning & Discovery**
- Enhetsökning (min) - standard: 30
- Sök-timeout (sek) - standard: 10
- Tidig avslutning (sek) - standard: 4
- Retry-väntetid (sek) - standard: 5
- Antal sökförsök - standard: 3

**Grupp 2: Cast & Session**
- Screensaver-kontroll (sek) - standard: 60
- Keep-alive ping (sek) - standard: 5
- Idle-timeout (sek) - standard: 5
- Cast retry-fördröjning (sek) - standard: 2
- Cast max försök - standard: 3

**Grupp 3: Återhämtning & Skydd**
- Cooldown efter takeover (sek) - standard: 30
- Recovery-kontroll intervall (sek) - standard: 10
- Circuit breaker tröskel - standard: 5
- Circuit breaker paus (min) - standard: 5

### Förbättrade beskrivningar
Varje inställning får:
1. Tydlig label
2. Förklarande hint-text
3. Standardvärde visas i hint: `(standard: X)`

## Tekniska ändringar

### bridge/index.js
1. Lägg till nya nycklar i `DEFAULT_CONFIG`:
   ```javascript
   cooldownAfterTakeover: 30,        // Väntetid efter takeover (sek)
   recoveryCheckInterval: 10,        // Interval för recovery (sek)
   circuitBreakerThreshold: 5,       // Antal fel innan breaker
   circuitBreakerCooldown: 5,        // Breaker paus (min)
   ```

2. Uppdatera hårdkodade konstanter att läsa från config:
   - `COOLDOWN_AFTER_TAKEOVER` → `config.cooldownAfterTakeover * 1000`
   - `BASE_RECOVERY_CHECK_INTERVAL` → `config.recoveryCheckInterval * 1000`
   - `CIRCUIT_BREAKER_THRESHOLD` → `config.circuitBreakerThreshold`
   - `circuitBreakerState.cooldownMs` → `config.circuitBreakerCooldown * 60 * 1000`

### bridge/public/index.html
1. Omstrukturera settings-sektionen med tre grupper
2. Lägg till nya input-fält med förbättrade hints som inkluderar standardvärden
3. Varje hint får formatet: `Förklaring (standard: X)`

### bridge/public/app.js
1. Lägg till nya element-referenser
2. Uppdatera `loadSettings()` för nya fält
3. Uppdatera `settingsInputs` array med nya mappningar

## Fil-ändringar

| Fil | Ändringar |
|-----|-----------|
| `bridge/index.js` | Ny config-nycklar, dynamiska värden istället för konstanter |
| `bridge/public/index.html` | Grupperade inställningar, nya fält, förbättrade hints |
| `bridge/public/app.js` | Nya element-hanterare, load/save för nya fält |

## Exempel på förbättrad hint-text

**Före:**
```
Hur ofta kontrollera om enheten är ledig
```

**Efter:**
```
Hur ofta kontrollera om enheten är ledig (standard: 60)
```

## Version
Bumpas till `1.3.11` med changelog för "alla timing-inställningar nu konfigurerbara".
