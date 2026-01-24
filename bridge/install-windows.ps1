# Chromecast Bridge - Windows Installer
# Kör som: Högerklicka → "Kör med PowerShell"

$ErrorActionPreference = "Stop"
$AppName = "ChromecastBridge"
$AppDir = "$env:APPDATA\$AppName"
$TaskName = "ChromecastBridge"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Chromecast Bridge Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Kontrollera/installera Node.js
Write-Host "[1/6] Kontrollerar Node.js..." -ForegroundColor Yellow
$nodeVersion = $null
try {
    $nodeVersion = node --version 2>$null
} catch {}

if (-not $nodeVersion) {
    Write-Host "  Node.js hittades inte. Installerar via winget..." -ForegroundColor Gray
    try {
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
        # Uppdatera PATH för aktuell session
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    } catch {
        Write-Host "  VARNING: Kunde inte installera Node.js automatiskt." -ForegroundColor Red
        Write-Host "  Ladda ner manuellt från: https://nodejs.org" -ForegroundColor Red
        Write-Host ""
        Read-Host "Tryck Enter för att avsluta"
        exit 1
    }
}
$nodeVersion = node --version
Write-Host "  Node.js $nodeVersion OK" -ForegroundColor Green

# 2. Skapa app-mapp
Write-Host "[2/6] Skapar app-mapp..." -ForegroundColor Yellow
if (Test-Path $AppDir) {
    Write-Host "  Tar bort befintlig installation..." -ForegroundColor Gray
    Remove-Item -Path $AppDir -Recurse -Force
}
New-Item -ItemType Directory -Path $AppDir -Force | Out-Null
Write-Host "  $AppDir" -ForegroundColor Green

# 3. Kopiera bridge-filer
Write-Host "[3/6] Kopierar filer..." -ForegroundColor Yellow
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$filesToCopy = @("index.js", "package.json", "package-lock.json")

foreach ($file in $filesToCopy) {
    $sourcePath = Join-Path $ScriptDir $file
    if (Test-Path $sourcePath) {
        Copy-Item -Path $sourcePath -Destination $AppDir
        Write-Host "  Kopierade $file" -ForegroundColor Gray
    }
}
Write-Host "  Filer kopierade" -ForegroundColor Green

# 4. Installera dependencies
Write-Host "[4/6] Installerar dependencies (detta kan ta några minuter)..." -ForegroundColor Yellow
Set-Location $AppDir
npm install --production 2>&1 | Out-Null
Write-Host "  Dependencies installerade" -ForegroundColor Green

# 5. Skapa .env-fil
Write-Host "[5/6] Skapar konfiguration..." -ForegroundColor Yellow
$DeviceId = $env:COMPUTERNAME.ToLower() -replace '[^a-z0-9-]', '-'
$EnvContent = @"
# Chromecast Bridge Configuration
# Genererad automatiskt $(Get-Date -Format "yyyy-MM-dd HH:mm")

SUPABASE_URL=https://umxwaxzmoxwasryjibhe.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVteHdheHptb3h3YXNyeWppYmhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0OTc3OTgsImV4cCI6MjA4MDA3Mzc5OH0.R4hVdnkp310Wk-g0jZfy52EwxfV6z3Pfnv6uwhsf0ps
DEVICE_ID=$DeviceId
POLL_INTERVAL=5000
"@
$EnvContent | Out-File -FilePath "$AppDir\.env" -Encoding UTF8
Write-Host "  Device ID: $DeviceId" -ForegroundColor Green

# 6. Skapa Scheduled Task
Write-Host "[6/6] Skapar autostart-tjänst..." -ForegroundColor Yellow

# Ta bort eventuell befintlig task
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# Hitta node.exe
$NodePath = (Get-Command node).Source

# Skapa task som körs vid login
$Action = New-ScheduledTaskAction -Execute $NodePath -Argument "index.js" -WorkingDirectory $AppDir
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description "Chromecast Bridge - Skickar screensaver till Chromecast" | Out-Null

Write-Host "  Scheduled Task skapad" -ForegroundColor Green

# Starta tjänsten direkt
Write-Host ""
Write-Host "Startar bridge..." -ForegroundColor Yellow
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Installation klar!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Bridge körs nu och startar automatiskt vid inloggning." -ForegroundColor White
Write-Host ""
Write-Host "Device ID: $DeviceId" -ForegroundColor Cyan
Write-Host "Använd detta ID i webbappen för att konfigurera." -ForegroundColor Gray
Write-Host ""
Write-Host "För att avinstallera, kör: uninstall-windows.ps1" -ForegroundColor Gray
Write-Host ""
Read-Host "Tryck Enter för att stänga"
