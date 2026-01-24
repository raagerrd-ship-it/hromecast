# Chromecast Bridge - Windows Uninstaller
# Kör som: Högerklicka → "Kör med PowerShell"

$ErrorActionPreference = "Stop"
$AppName = "ChromecastBridge"
$AppDir = "$env:APPDATA\$AppName"
$TaskName = "ChromecastBridge"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Chromecast Bridge Uninstaller" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Stoppa och ta bort Scheduled Task
Write-Host "[1/2] Tar bort autostart-tjänst..." -ForegroundColor Yellow
try {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "  Scheduled Task borttagen" -ForegroundColor Green
} catch {
    Write-Host "  Ingen Scheduled Task hittades" -ForegroundColor Gray
}

# 2. Ta bort app-mapp
Write-Host "[2/2] Tar bort filer..." -ForegroundColor Yellow
if (Test-Path $AppDir) {
    Remove-Item -Path $AppDir -Recurse -Force
    Write-Host "  $AppDir borttagen" -ForegroundColor Green
} else {
    Write-Host "  Ingen installation hittades" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Avinstallation klar!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Read-Host "Tryck Enter för att stänga"
