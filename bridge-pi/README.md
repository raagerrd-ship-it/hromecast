# Cast Away – Raspberry Pi Edition

Ren Chromecast-screensaver-bridge för Raspberry Pi. Inga Sonos-beroenden, inga molntjänster – allt körs lokalt.

## Hur det fungerar

1. Bridge:n körs på en Raspberry Pi (eller annan Linux-enhet) i ditt lokala nätverk
2. Den upptäcker Chromecast-enheter automatiskt via mDNS
3. Du konfigurerar skärmsläckaren via webbgränssnittet på `http://<pi-ip>:3000`
4. Bridge:n aktiverar skärmsläckaren automatiskt när Chromecast:en är inaktiv

## Snabbinstallation

```bash
cd cast-away-pi
chmod +x install-linux.sh
./install-linux.sh
```

## Manuell installation

### Förutsättningar
- Node.js 18 eller senare
- En enhet på samma nätverk som din Chromecast

### Steg

```bash
cd bridge-pi
npm install
cp .env.example .env
# Redigera .env med ditt DEVICE_ID
npm start
```

## Konfiguration

- `DEVICE_ID`: Unikt namn för denna bridge-instans
- `PORT`: HTTP-port för webbgränssnittet (standard: 3000)

## Webbgränssnitt

Öppna `http://<pi-ip>:3000` för att:
- Välja vilken Chromecast som ska användas
- Ange URL för skärmsläckaren
- Aktivera/inaktivera automatisk skärmsläckare
- Manuellt starta/stoppa casting

## Köra som bakgrundstjänst (systemd)

Installationsskriptet skapar automatiskt en systemd user service:

```bash
systemctl --user status cast-away
systemctl --user stop cast-away
systemctl --user start cast-away
journalctl --user -u cast-away -f
```

## Flera instanser

Kör flera bridge-instanser (t.ex. en per rum) genom att ange olika instansnamn vid installation. Varje instans får sin egen port och konfiguration.

## Felsökning

### Bridge:n hittar inte Chromecast
- Kontrollera att enheten är på samma nätverk som din Chromecast
- Kontrollera att mDNS/Bonjour inte blockeras av brandväggen
- Försök starta om din Chromecast

### Installationsfel

Ubuntu/Debian/Raspberry Pi OS:
```bash
sudo apt-get install libavahi-compat-libdnssd-dev
```

## Säkerhet

All data lagras lokalt i `config.json`. Ingen data skickas till molnet.
