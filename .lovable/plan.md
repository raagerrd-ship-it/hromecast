
# Förbättra Bridge Discovery och Anslutningsstabilitet

## Problem som ska lösas

1. **Discovery kräver flera försök** - Enheten hittas inte på första försöket
2. **Tappar TV-anslutning** - Även när TV:n är i idle-läge

## Rotorsaker

### Discovery-problem
- Early resolve timeout (3 sekunder) är för kort för vissa nätverk/enheter
- Max timeout (8 sekunder) kan vara för kort om TV:n precis vaknat
- `discoveredDevices` uppdateras inte inkrementellt under sökning
- Ingen retry-logik vid tom discovery

### Anslutningsproblem  
- `client.on('close')` triggar ingen omedelbar recovery
- 60 sekunders intervall mellan status-checks kan missa snabba disconnects
- Heartbeat-fel leder till recovery men discovery kan misslyckas

## Lösning

### 1. Förbättra Discovery-logik

**Öka timeouts och lägg till retry:**

```javascript
// Nya standardvärden i DEFAULT_CONFIG
discoveryTimeout: 10,        // 8 → 10 sekunder (mer tid för enheter att svara)
discoveryEarlyResolve: 4,    // 3 → 4 sekunder (lite mer marginal)
```

**Lägg till automatisk retry vid tom discovery:**

```javascript
async function discoverDevicesWithRetry(maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const devices = await discoverDevices();
    
    if (devices.length > 0) {
      return devices;
    }
    
    if (attempt < maxRetries) {
      log.info(`🔄 No devices found, retrying (${attempt}/${maxRetries})...`);
      await sleep(2000); // Vänta 2 sekunder mellan försök
    }
  }
  
  log.warn('⚠️ No devices found after retries');
  return [];
}
```

**Uppdatera API-endpoint att använda retry:**

```javascript
// POST /api/chromecasts/refresh
if (req.method === 'POST' && pathname === '/api/chromecasts/refresh') {
  const devices = await discoverDevicesWithRetry(3); // 3 försök
  // ...
}
```

### 2. Förbättra Connection Close-hantering

**Lägg till omedelbar status-check vid connection close:**

```javascript
client.on('close', () => {
  log.info('🔌 Connection closed');
  cleanup();
  
  // Om vi trodde vi var aktiva, gör en omedelbar status-check
  if (screensaverActive) {
    log.info('⚠️ Connection closed while active - checking status...');
    setTimeout(async () => {
      const config = loadConfig();
      if (config.selectedChromecast && config.enabled) {
        const result = await isChromecastIdleWithRecovery(config.selectedChromecast);
        if (result.status === 'idle') {
          log.info('🔄 Device idle after close - reactivating...');
          checkAndActivateScreensaver();
        } else if (result.status === 'our_app') {
          log.info('✅ Our app still running on device');
          screensaverActive = true;
        }
      }
    }, 3000); // Vänta 3 sekunder för eventuell cleanup
  }
});
```

### 3. Bevara existerande enheter vid misslyckad discovery

**Förhindra att listan töms vid timeout:**

```javascript
function discoverDevices() {
  return new Promise((resolve) => {
    log.info('🔍 Scanning for Chromecast devices...');
    
    const browser = bonjour.find({ type: 'googlecast' });
    const foundDevices = [];
    let resolved = false;
    
    // ... befintlig kod ...
    
    // Max timeout - behåll gamla enheter om inga nya hittas
    setTimeout(() => {
      // ... cleanup ...
      
      // OM inga enheter hittades, BEHÅLL de gamla
      if (foundDevices.length === 0 && discoveredDevices.length > 0) {
        log.info(`📡 Discovery timeout, keeping ${discoveredDevices.length} cached device(s)`);
        resolve(discoveredDevices);
      } else {
        discoveredDevices = foundDevices;
        log.info(`📡 Discovery complete: ${foundDevices.length} device(s)`);
        resolve(foundDevices);
      }
    }, maxTimeoutMs);
  });
}
```

## Fil som ändras

| Fil | Ändringar |
|-----|-----------|
| `bridge/index.js` | Discovery retry, förbättrad close-hantering, bevarade enheter vid timeout |

## Version

Bumpas till `1.3.10` med changelog-entry för förbättrad discovery och anslutningsstabilitet.

---

## Tekniska detaljer

### Sammanfattning av kodändringar

1. **DEFAULT_CONFIG** - Ökade timeouts för discovery
2. **discoverDevicesWithRetry()** - Ny funktion med automatisk retry
3. **discoverDevices()** - Behåll cachade enheter vid tom discovery
4. **client.on('close')** - Omedelbar status-check och re-connect vid oväntad stängning
5. **/api/chromecasts/refresh** - Använd retry-variant

### Förväntade förbättringar

- Användare ska hitta enheter på första försöket (tack vare retry)
- Om enheten inte svarar behålls cached-data (förhindrar tom lista)
- Connection close triggar omedelbar recovery istället för att vänta 60 sekunder
