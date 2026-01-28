# Chromecast Bridge - Windows Installer (Multi-Instance Support)
# Hogerklicka -> "Kor med PowerShell" eller dubbelklicka
# Kors vid systemstart (fore inloggning)

param([switch]$Elevated)

# Fix console encoding for Swedish characters
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# Funktion for att pausa vid fel
function Pause-OnError {
    param([string]$Message)
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "  FEL UPPSTOD!" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host $Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Tryck valfri tangent for att stanga..." -ForegroundColor Gray
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

# Auto-elevate till admin om inte redan admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    if (-not $Elevated) {
        Write-Host ""
        Write-Host "Begar administratorsrattigheter..." -ForegroundColor Yellow
        Write-Host "Klicka 'Ja' i dialogrutan som visas." -ForegroundColor Gray
        Start-Sleep -Seconds 1
        
        try {
            $scriptPath = $MyInvocation.MyCommand.Path
            if (-not $scriptPath) {
                $scriptPath = $PSCommandPath
            }
            Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -Elevated" -Verb RunAs
        } catch {
            Pause-OnError "Kunde inte begara admin-rattigheter: $($_.Exception.Message)"
        }
        exit
    } else {
        Pause-OnError "Scriptet kraver administratorsrattigheter men kunde inte elevera."
    }
}

$ErrorActionPreference = "Stop"
$DefaultAppName = "ChromecastBridge"
$DefaultPort = 3000

try {

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Chromecast Bridge Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Fraga om instansnamn for multi-instance stod
Write-Host "Om du vill kora flera bridges (t.ex. en per rum), ge varje en unik namn." -ForegroundColor Gray
Write-Host "Lamna tomt for standardinstallation." -ForegroundColor Gray
Write-Host ""
$InstanceName = Read-Host "Instansnamn (tryck Enter for standard)"

if ([string]::IsNullOrWhiteSpace($InstanceName)) {
    $AppName = $DefaultAppName
    $TaskName = $DefaultAppName
    $Port = $DefaultPort
} else {
    $CleanName = $InstanceName -replace '[^a-zA-Z0-9-]', ''
    $AppName = "$DefaultAppName-$CleanName"
    $TaskName = "$DefaultAppName-$CleanName"
    
    # Fraga om port for multi-instance
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
Write-Host "[1/8] Kontrollerar Node.js..." -ForegroundColor Yellow
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
        Pause-OnError "Kunde inte installera Node.js automatiskt. Ladda ner manuellt fran: https://nodejs.org"
    }
}
$nodeVersion = node --version
Write-Host "  Node.js $nodeVersion OK" -ForegroundColor Green

# 2. Forbereda uppdatering - pausa aktiv bridge
Write-Host "[2/8] Forbereder uppdatering..." -ForegroundColor Yellow

# Kolla om task finns och bridge kors
$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Write-Host "  Befintlig installation hittad" -ForegroundColor Gray
    
    # Forsok anropa prepare-update (fungerar om bridge kors oavsett task-state)
    try {
        Write-Host "  Pausar bridge gracefully..." -ForegroundColor Gray
        $response = Invoke-RestMethod -Uri "http://localhost:$Port/api/prepare-update" -Method Post -TimeoutSec 5 -ErrorAction Stop
        Write-Host "  Bridge pausad" -ForegroundColor Green
        Start-Sleep -Seconds 2
    } catch {
        Write-Host "  Bridge svarar inte (kanske inte startad), fortsatter..." -ForegroundColor Yellow
    }
    
    # Avregistrera task HELT for att undvika auto-restart
    Write-Host "  Tar bort scheduled task (aterupprättas i steg 7)..." -ForegroundColor Gray
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
} else {
    Write-Host "  Ny installation" -ForegroundColor Gray
}

# 3. Skapa app-mapp (bevara config.json)
Write-Host "[3/8] Skapar app-mapp..." -ForegroundColor Yellow

if (Test-Path $AppDir) {
    Write-Host "  Tar bort befintlig installation..." -ForegroundColor Gray
    Remove-Item -Path $AppDir -Recurse -Force
}
New-Item -ItemType Directory -Path $AppDir -Force | Out-Null
New-Item -ItemType Directory -Path "$AppDir\public" -Force | Out-Null

Write-Host "  $AppDir" -ForegroundColor Green

# 4. Kopiera bridge-filer
Write-Host "[4/8] Kopierar filer..." -ForegroundColor Yellow
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

# 5. Installera dependencies
Write-Host "[5/8] Installerar dependencies (detta kan ta nagra minuter)..." -ForegroundColor Yellow
Set-Location $AppDir
$env:npm_config_loglevel = "error"
& cmd /c "npm install --omit=dev 2>&1" | Out-Null
Write-Host "  Dependencies installerade" -ForegroundColor Green

# 6. Skapa .env-fil
Write-Host "[6/8] Skapar konfiguration..." -ForegroundColor Yellow
$DeviceId = $env:COMPUTERNAME.ToLower() -replace '[^a-z0-9-]', '-'
if (-not [string]::IsNullOrWhiteSpace($InstanceName)) {
    $DeviceId = "$DeviceId-$CleanName"
}

$EnvContent = @"
# Chromecast Bridge Configuration
# Genererad automatiskt $(Get-Date -Format "yyyy-MM-dd HH:mm")

DEVICE_ID=$DeviceId
PORT=$Port
"@
$EnvContent | Out-File -FilePath "$AppDir\.env" -Encoding UTF8
Write-Host "  Device ID: $DeviceId" -ForegroundColor Green
Write-Host "  Port: $Port" -ForegroundColor Green

# 7. Skapa Scheduled Task (kors vid systemstart som SYSTEM)
Write-Host "[7/8] Skapar autostart-tjanst..." -ForegroundColor Yellow

# Ta bort eventuell befintlig task
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# Hitta node.exe
$NodePath = (Get-Command node).Source

# Skapa task som kors vid systemstart som SYSTEM-anvandare
$Action = New-ScheduledTaskAction -Execute $NodePath -Argument "index.js" -WorkingDirectory $AppDir
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 9999)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description "Chromecast Bridge - $AppName (startar vid systemstart)" | Out-Null

# Verifiera att tasken skapades
$createdTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $createdTask) {
    Pause-OnError "Kunde inte skapa scheduled task '$TaskName'. Kontrollera att du har admin-rattigheter."
}
Write-Host "  Scheduled Task skapad (kors vid systemstart)" -ForegroundColor Green

# 8. Oppna brandvagg for mobil-atkomst
Write-Host "[8/8] Konfigurerar brandvagg..." -ForegroundColor Yellow
$FirewallRuleName = "Chromecast Bridge - $AppName (Port $Port)"

# Ta bort eventuell befintlig regel
Remove-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue

# Skapa ny regel for inkommande trafik
try {
    New-NetFirewallRule -DisplayName $FirewallRuleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private,Domain -Description "Tillater atkomst till Chromecast Bridge fran andra enheter pa narverket" | Out-Null
    Write-Host "  Brandvaggsregel skapad for port $Port" -ForegroundColor Green
} catch {
    Write-Host "  Kunde inte skapa brandvaggsregel: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "  Du kan behova oppna port $Port manuellt i Windows-brandvaggen" -ForegroundColor Yellow
}

# Starta tjansten direkt
Write-Host ""
Write-Host "Startar bridge..." -ForegroundColor Yellow
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

# Verifiera att tasken kors
$taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
$taskState = (Get-ScheduledTask -TaskName $TaskName).State

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Installation klar!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Oppna webblasaren och ga till:" -ForegroundColor White
Write-Host ""
Write-Host "  http://localhost:$Port" -ForegroundColor Cyan
Write-Host ""
Write-Host "Dar kan du valja Chromecast och konfigurera screensaver." -ForegroundColor Gray
Write-Host ""
Write-Host "Device ID: $DeviceId" -ForegroundColor Yellow
Write-Host "Task Name: $TaskName" -ForegroundColor Yellow
Write-Host "Task Status: $taskState" -ForegroundColor Yellow
Write-Host ""
Write-Host "Bridge startar automatiskt vid systemstart (fore inloggning)." -ForegroundColor Green
Write-Host ""
Write-Host "For att avinstallera, kor: uninstall-windows.ps1" -ForegroundColor Gray

} catch {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "  FEL UPPSTOD!" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Felmeddelande: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Stack trace:" -ForegroundColor Gray
    Write-Host $_.ScriptStackTrace -ForegroundColor Gray
}

Write-Host ""
Write-Host "Tryck valfri tangent for att stanga..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
