# Chromecast Screensaver - Installationsguide

Denna guide beskriver hur du sätter upp Chromecast-screensaver i ett nytt hem.

## Förutsättningar

- En dator (Windows/Mac/Linux) som alltid är igång på samma nätverk som Chromecast
- Node.js 18 eller högre installerat
- En Chromecast-enhet på nätverket

---

## Steg 1: Klona projektet

```bash
git clone <repository-url>
cd <project-folder>
```

## Steg 2: Konfigurera bridge-tjänsten

1. Gå till bridge-mappen:
   ```bash
   cd bridge
   ```

2. Installera beroenden:
   ```bash
   npm install
   ```

3. Skapa `.env`-fil:
   ```bash
   cp .env.example .env
   ```

4. Redigera `.env` med dina uppgifter:
   ```env
   SUPABASE_URL=https://umxwaxzmoxwasryjibhe.supabase.co
   SUPABASE_ANON_KEY=<din-anon-key>
   DEVICE_ID=mitt-hem
   POLL_INTERVAL=5000
   ```
   
   > **Tips:** Använd ett unikt `DEVICE_ID` för varje hem (t.ex. `stockholm`, `goteborg`)

## Steg 3: Starta bridge-tjänsten

```bash
node index-castv2-windows.js
```

Du bör se loggar som:
```
🔍 Starting Chromecast discovery...
📺 Found 2 Chromecast device(s)
✅ Selected device: Chromecast Ultra
```

## Steg 4: Konfigurera via webbgränssnittet

1. Öppna webbappen: https://hromecast.lovable.app
2. Välj rätt Chromecast i dropdown-menyn
3. Aktivera screensaver och ange URL
4. Klicka "Spara"

## Steg 5: Kör som Windows-tjänst (valfritt)

För att bridge ska starta automatiskt vid omstart:

### Alternativ A: Task Scheduler

1. Öppna Task Scheduler
2. Skapa en ny uppgift som körs vid inloggning
3. Ange kommando: `node C:\path\to\bridge\index-castv2-windows.js`

### Alternativ B: NSSM (rekommenderas)

1. Ladda ner NSSM: https://nssm.cc/
2. Installera som tjänst:
   ```cmd
   nssm install ChromecastBridge "C:\Program Files\nodejs\node.exe" "C:\path\to\bridge\index-castv2-windows.js"
   nssm set ChromecastBridge AppDirectory "C:\path\to\bridge"
   nssm start ChromecastBridge
   ```

---

## Felsökning

| Problem | Lösning |
|---------|---------|
| Hittar ingen Chromecast | Kontrollera att enheten är på samma nätverk |
| Bridge startar inte | Verifiera att `.env` har korrekta uppgifter |
| Screensaver startar inte | Kontrollera Activity Log i webbappen |
| IP-adress ändrad | Bridge hanterar detta automatiskt |

## Kontrollera status

Öppna webbappen och kolla Activity Log för att se:
- Bridge online/offline status
- Screensaver-händelser
- Chromecast-status

---

## Snabbkommando

```bash
cd bridge && node index-castv2-windows.js
```
