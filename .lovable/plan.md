

# Ta bort bevarande av config.json vid uppdatering

## Bakgrund
Tidigare implementerades logik för att bevara `config.json` vid uppdateringar så att användare inte förlorar sin screensaver-URL och inställningar. Men eftersom vi nu gör många ändringar i konfigurationsstrukturen (nya fält, nya standardvärden), är det bättre att låta användare börja med en ren installation.

## Ändringar

### bridge/install-linux.sh

**Ta bort (rad 96-101):**
```bash
# Spara befintlig config.json om den finns
CONFIG_BACKUP=""
if [ -f "$APP_DIR/config.json" ]; then
    echo "  Sparar befintlig konfiguration (URL, enhet etc.)..."
    CONFIG_BACKUP=$(cat "$APP_DIR/config.json")
fi
```

**Ta bort (rad 112-116):**
```bash
# Återställ config.json om den fanns
if [ -n "$CONFIG_BACKUP" ]; then
    echo "$CONFIG_BACKUP" > "$APP_DIR/config.json"
    echo "  ✓ Konfiguration återställd"
fi
```

### bridge/install-windows.ps1

**Ta bort (rad 138-144):**
```powershell
# Spara befintlig config.json om den finns
$ConfigBackup = $null
$ConfigPath = "$AppDir\config.json"
if (Test-Path $ConfigPath) {
    Write-Host "  Sparar befintlig konfiguration (URL, enhet etc.)..." -ForegroundColor Gray
    $ConfigBackup = Get-Content -Path $ConfigPath -Raw
}
```

**Ta bort (rad 153-157):**
```powershell
# Återställ config.json om den fanns
if ($ConfigBackup) {
    $ConfigBackup | Out-File -FilePath $ConfigPath -Encoding UTF8 -NoNewline
    Write-Host "  Konfiguration aterstall" -ForegroundColor Green
}
```

## Effekt
- Vid uppdatering kommer användaren behöva konfigurera om sin screensaver-URL och välja Chromecast igen
- Alla nya standardvärden och inställningar appliceras automatiskt
- Undviker problem med inkompatibla konfigurationsfält från tidigare versioner

## Versionsbump
Bumpas till `1.3.12` med kort changelog-notis om att konfiguration inte längre bevaras vid uppdatering.

