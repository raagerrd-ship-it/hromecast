
# Ta bort mDNS-publicering och mDNS-URL från dashboarden

## Sammanfattning
Ta bort den onödiga mDNS-publiceringen av bridge-tjänsten och dess URL-visning i dashboarden. Chromecast-upptäckten (som faktiskt använder mDNS) behålls oförändrad.

## Vad som tas bort

### 1. mDNS-publicering av bridge (bridge/index.js)

**Rad 1438-1445 - Ta bort:**
```javascript
// Publish mDNS service
bonjour.publish({
  name: `${os.hostname()}-${DEVICE_ID}`,
  type: 'http',
  port: PORT,
  txt: { path: '/', version: BRIDGE_VERSION }
});
log.info(`📡 mDNS published: ${os.hostname()}-${DEVICE_ID}.local`);
```

**Rad 1465 - Ta bort:**
```javascript
bonjour.unpublishAll();
```

**Rad 1302-1304 - Ta bort mdnsUrl från /api/status:**
```javascript
mdnsUrl: `http://${DEVICE_ID}.local:${PORT}`,
```

**Rad 430-433 - Ta bort mDNS från network-info.txt:**
```
mDNS (om stöds):
  http://${DEVICE_ID}.local:${PORT}
```

### 2. Dashboard HTML (bridge/public/index.html)

**Rad 233-236 - Ta bort:**
```html
<div class="network-row">
  <span class="network-label">mDNS:</span>
  <code id="mdns-url">-</code>
</div>
```

### 3. Dashboard JavaScript (bridge/public/app.js)

**Rad 60 - Ta bort:**
```javascript
mdnsUrl: document.getElementById('mdns-url'),
```

**Rad 319-321 - Ta bort:**
```javascript
if (data.mdnsUrl && elements.mdnsUrl) {
  elements.mdnsUrl.textContent = data.mdnsUrl;
}
```

## Vad som behålls

Chromecast-upptäckten via mDNS behålls helt oförändrad:
```javascript
const browser = bonjour.find({ type: 'googlecast' });
```

## Filändringar

| Fil | Ändring |
|-----|---------|
| `bridge/index.js` | Ta bort publish, unpublishAll, mdnsUrl i API och network-info.txt |
| `bridge/public/index.html` | Ta bort mDNS-raden i nätverkssektionen |
| `bridge/public/app.js` | Ta bort mdnsUrl element och uppdateringslogik |
| `supabase/functions/download-bridge/index.ts` | Uppdatera INDEX_JS och PUBLIC_APP_JS |
| `supabase/functions/get-version/index.ts` | Bumpa version till 1.3.20 |

## Resultat

- Enklare kod utan onödig mDNS-publicering
- Renare dashboard utan oanvändbar mDNS-URL
- Chromecast-upptäckt fungerar precis som förut
- Mindre förvirring för användare (ingen visad URL som ändå inte fungerar)
