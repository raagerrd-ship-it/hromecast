# Chromecast Bridge - Windows Uninstaller (Multi-Instance Support)
# Högerklicka → "Kör med PowerShell"

$ErrorActionPreference = "SilentlyContinue"
$DefaultAppName = "ChromecastBridge"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Chromecast Bridge Avinstallation" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Lista alla installerade instanser
Write-Host "Söker efter installerade bridges..." -ForegroundColor Yellow
Write-Host ""

$Tasks = Get-ScheduledTask | Where-Object { $_.TaskName -like "ChromecastBridge*" }
$Folders = Get-ChildItem "$env:APPDATA" -Directory | Where-Object { $_.Name -like "ChromecastBridge*" }

if ($Tasks.Count -eq 0 -and $Folders.Count -eq 0) {
    Write-Host "Inga Chromecast Bridge-installationer hittades." -ForegroundColor Gray
    Read-Host "Tryck Enter för att avsluta"
    exit 0
}

Write-Host "Hittade följande installationer:" -ForegroundColor White
$index = 1
$Installations = @()

foreach ($task in $Tasks) {
    $taskName = $task.TaskName
    $folderPath = "$env:APPDATA\$taskName"
    
    Write-Host "  [$index] $taskName" -ForegroundColor Cyan
    if (Test-Path $folderPath) {
        Write-Host "      Mapp: $folderPath" -ForegroundColor Gray
    }
    
    $Installations += @{
        TaskName = $taskName
        FolderPath = $folderPath
    }
    $index++
}

# Lägg till eventuella mappar utan task
foreach ($folder in $Folders) {
    $folderName = $folder.Name
    $existsInTasks = $Installations | Where-Object { $_.TaskName -eq $folderName }
    
    if (-not $existsInTasks) {
        Write-Host "  [$index] $folderName (endast mapp)" -ForegroundColor Yellow
        Write-Host "      Mapp: $($folder.FullName)" -ForegroundColor Gray
        
        $Installations += @{
            TaskName = $null
            FolderPath = $folder.FullName
        }
        $index++
    }
}

Write-Host ""
Write-Host "  [A] Avinstallera ALLA" -ForegroundColor Red
Write-Host "  [0] Avbryt" -ForegroundColor Gray
Write-Host ""

$choice = Read-Host "Välj installation att avinstallera"

if ($choice -eq "0" -or [string]::IsNullOrWhiteSpace($choice)) {
    Write-Host "Avbryter." -ForegroundColor Gray
    exit 0
}

$toUninstall = @()

if ($choice -eq "A" -or $choice -eq "a") {
    $toUninstall = $Installations
} else {
    $choiceNum = [int]$choice
    if ($choiceNum -ge 1 -and $choiceNum -le $Installations.Count) {
        $toUninstall += $Installations[$choiceNum - 1]
    } else {
        Write-Host "Ogiltigt val." -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "Avinstallerar..." -ForegroundColor Yellow

foreach ($install in $toUninstall) {
    $taskName = $install.TaskName
    $folderPath = $install.FolderPath
    
    if ($taskName) {
        Write-Host "  Stoppar task: $taskName" -ForegroundColor Gray
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        
        Write-Host "  Tar bort task: $taskName" -ForegroundColor Gray
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    }
    
    if ($folderPath -and (Test-Path $folderPath)) {
        Write-Host "  Tar bort mapp: $folderPath" -ForegroundColor Gray
        Remove-Item -Path $folderPath -Recurse -Force -ErrorAction SilentlyContinue
    }
    
    $displayName = if ($taskName) { $taskName } else { Split-Path $folderPath -Leaf }
    Write-Host "  ✓ $displayName avinstallerad" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Avinstallation klar!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Read-Host "Tryck Enter för att stänga"
