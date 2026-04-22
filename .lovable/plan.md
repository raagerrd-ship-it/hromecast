
Mål: minska RAM-användningen på Pi utan att försämra stabiliteten i cast-flödet.

1. Strama åt UI-minnet först
- Göra förhandsvisningen lazy: skapa inte `<iframe>` förrän användaren aktivt öppnar preview eller fokuserar URL-fältet.
- Avlasta loggvyn: sluta rendera hela logglistan på varje statuspoll, och hämta loggar separat med lägre frekvens än status.
- Pausa UI-polling när sidan är dold (`visibilitychange`) så dashboarden inte fortsätter dra minne/CPU i bakgrunden.
- Undvika onödiga DOM-omsättningar i `bridge-pi/public/app.js` genom att bara uppdatera version, status och loggar när datan faktiskt ändrats.

2. Minska minnesfotavtrycket i engine
- Sänka standardstorleken på `logBuffer` ytterligare och göra den adaptiv efter tillgängligt RAM.
- Göra loggning billigare: inte lagra `args` i minnet om de är tomma eller stora, och trunkera långa meddelanden innan de sparas i buffer.
- Rensa cache för upptäckta enheter mer aggressivt när ingen cast är aktiv, så `discoveredDevices` inte hålls längre än nödvändigt.
- Se över heartbeat/recovery-timers så endast exakt de intervall som behövs lever samtidigt.

3. Göra underhållsloopen snålare
- Byta från fast minnesunderhåll var 5:e minut till enklare tröskelstyrt underhåll, så GC-hint och loggtrimning bara sker när heap/RSS faktiskt är förhöjt.
- Undvika extra minnesarbete i friskt läge, särskilt när Pi:n bara står idle.

4. Minska overhead från status-endpoints
- Låta `/api/status` bli lättare genom att inte alltid bygga hela minnes/status-objektet för UI om inget ändrats.
- Flytta logghämtning till separat, enklare polling i UI i stället för att varje `loadStatus()` också laddar `/api/logs`.

5. Bevara nuvarande stabila delar
- Behålla lazy Bonjour/destroyBonjour-flödet eftersom det redan är en bra minnesoptimering.
- Behålla config-cache på 5 sekunder eftersom den minskar onödiga diskläsningar utan stor RAM-kostnad.
- Behålla receiverns minimala Chromecast-implementation; där finns sannolikt liten vinst jämfört med engine/UI.

Filer att uppdatera
- `bridge-pi/public/app.js`
- `bridge-pi/engine/index.js`
- Eventuellt `bridge-pi/README.md` om nya driftrekommendationer eller standardvärden ändras

Teknisk riktning
- Låg risk / hög nytta:
  - lazy preview-iframe
  - separat loggpolling
  - pause-on-hidden i UI
  - mindre/adaptiv loggbuffer
  - billigare loggobjekt
- Medelrisk / valfritt:
  - mer aggressiv rensning av discovered devices
  - ändrad underhålls/GC-strategi
- Inte prioriterat:
  - större omarkitektur av cast-klienten, eftersom nuvarande minnesprofil redan verkar vara ganska snål och fungerande på din Pi

Förväntad effekt
- Mest märkbar minskning kommer sannolikt från UI:t när dashboarden är öppen.
- Engine-vinsten blir främst jämnare minnesnivåer över tid, inte dramatisk minskning.
- Total effekt bör vara lägre toppar i RSS och mindre onödig aktivitet när systemet står still.

Verifiering efter implementation
- Jämföra `/api/health` och `/api/status` före/efter för RSS och heapUsed.
- Kontrollera att discovery, cast, recovery och update-flödet fortfarande fungerar.
- Bekräfta att UI inte fortsätter polla fullt när fliken är dold.
- Testa långkörning på Pi för att se om minnet stabiliseras bättre över tid.
