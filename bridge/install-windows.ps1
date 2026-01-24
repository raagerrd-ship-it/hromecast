# Chromecast Bridge - Windows Installer (Multi-Instance Support)
# Högerklicka → "Kör med PowerShell"

$ErrorActionPreference = "Stop"
$DefaultAppName = "ChromecastBridge"
$DefaultPort = 3000

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Chromecast Bridge Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Fråga om instansnamn för multi-instance stöd
Write-Host "Om du vill köra flera bridges (t.ex. en per rum), ge varje en unik namn." -ForegroundColor Gray
Write-Host "Lämna tomt för standardinstallation." -ForegroundColor Gray
Write-Host ""
$InstanceName = Read-Host "Instansnamn (tryck Enter för standard)"

if ([string]::IsNullOrWhiteSpace($InstanceName)) {
    $AppName = $DefaultAppName
    $TaskName = $DefaultAppName
    $Port = $DefaultPort
} else {
    $CleanName = $InstanceName -replace '[^a-zA-Z0-9-]', ''
    $AppName = "$DefaultAppName-$CleanName"
    $TaskName = "$DefaultAppName-$CleanName"
    
    # Fråga om port för multi-instance
    $PortInput = Read-Host "Port (standard: $DefaultPort)"
    if ([string]::IsNullOrWhiteSpace($PortInput)) {
        $Port = $DefaultPort
    } else {
        $Port = [int]$PortInput
    }
}

$AppDir = "$env:APPDATA\$AppName"

Write-Host ""
Write-Host "Installation:" -ForegroundColor Yellow
Write-Host "  Namn: $AppName" -ForegroundColor Gray
Write-Host "  Port: $Port" -ForegroundColor Gray
Write-Host "  Mapp: $AppDir" -ForegroundColor Gray
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
New-Item -ItemType Directory -Path "$AppDir\public" -Force | Out-Null
Write-Host "  $AppDir" -ForegroundColor Green

# 3. Kopiera bridge-filer
Write-Host "[3/6] Kopierar filer..." -ForegroundColor Yellow
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Kopiera huvudfiler
$mainFiles = @("index.js", "package.json", "package-lock.json")
foreach ($file in $mainFiles) {
    $sourcePath = Join-Path $ScriptDir $file
    if (Test-Path $sourcePath) {
        Copy-Item -Path $sourcePath -Destination $AppDir
        Write-Host "  Kopierade $file" -ForegroundColor Gray
    }
}

# Kopiera public-mapp
$publicDir = Join-Path $ScriptDir "public"
if (Test-Path $publicDir) {
    Copy-Item -Path "$publicDir\*" -Destination "$AppDir\public" -Recurse
    Write-Host "  Kopierade public-mapp" -ForegroundColor Gray
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
if (-not [string]::IsNullOrWhiteSpace($InstanceName)) {
    $DeviceId = "$DeviceId-$CleanName"
}

$EnvContent = @"
# Chromecast Bridge Configuration
# Genererad automatiskt $(Get-Date -Format "yyyy-MM-dd HH:mm")

SUPABASE_URL=https://umxwaxzmoxwasryjibhe.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVteHdheHptb3h3YXNyeWppYmhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0OTc3OTgsImV4cCI6MjA4MDA3Mzc5OH0.R4hVdnkp310Wk-g0jZfy52EwxfV6z3Pfnv6uwhsf0ps
DEVICE_ID=$DeviceId
PORT=$Port
"@
$EnvContent | Out-File -FilePath "$AppDir\.env" -Encoding UTF8
Write-Host "  Device ID: $DeviceId" -ForegroundColor Green
Write-Host "  Port: $Port" -ForegroundColor Green

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

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description "Chromecast Bridge - $AppName" | Out-Null

Write-Host "  Scheduled Task skapad" -ForegroundColor Green

# Starta tjänsten direkt
Write-Host ""
Write-Host "Startar bridge..." -ForegroundColor Yellow
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Installation klar!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Öppna webbläsaren och gå till:" -ForegroundColor White
Write-Host ""
Write-Host "  http://localhost:$Port" -ForegroundColor Cyan
Write-Host ""
Write-Host "Där kan du välja Chromecast och konfigurera screensaver." -ForegroundColor Gray
Write-Host ""
Write-Host "Device ID: $DeviceId" -ForegroundColor Yellow
Write-Host "Task Name: $TaskName" -ForegroundColor Yellow
Write-Host ""
Write-Host "Bridge startar automatiskt vid inloggning." -ForegroundColor Gray
Write-Host ""
Write-Host "För att avinstallera, kör: uninstall-windows.ps1" -ForegroundColor Gray
Write-Host ""
Read-Host "Tryck Enter för att stänga"
