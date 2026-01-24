import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Simple ZIP file creation without external dependencies
function createZip(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const entries: { name: string; data: Uint8Array; crc: number; offset: number }[] = [];
  
  // CRC32 calculation
  function crc32(data: Uint8Array): number {
    let crc = 0xFFFFFFFF;
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
    for (let i = 0; i < data.length; i++) {
      crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // Calculate total size
  let totalSize = 0;
  for (const [name, content] of Object.entries(files)) {
    const fileName = "chromecast-bridge/" + name;
    const data = encoder.encode(content);
    totalSize += 30 + fileName.length + data.length; // Local file header + data
    totalSize += 46 + fileName.length; // Central directory entry
  }
  totalSize += 22; // End of central directory

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);
  let offset = 0;
  let centralOffset = 0;

  // Write local file headers and data
  for (const [name, content] of Object.entries(files)) {
    const fileName = "chromecast-bridge/" + name;
    const fileNameBytes = encoder.encode(fileName);
    const data = encoder.encode(content);
    const crc = crc32(data);

    entries.push({ name: fileName, data, crc, offset });

    // Local file header
    view.setUint32(offset, 0x04034B50, true); offset += 4; // Signature
    view.setUint16(offset, 20, true); offset += 2; // Version needed
    view.setUint16(offset, 0, true); offset += 2; // Flags
    view.setUint16(offset, 0, true); offset += 2; // Compression (none)
    view.setUint16(offset, 0, true); offset += 2; // Mod time
    view.setUint16(offset, 0, true); offset += 2; // Mod date
    view.setUint32(offset, crc, true); offset += 4; // CRC32
    view.setUint32(offset, data.length, true); offset += 4; // Compressed size
    view.setUint32(offset, data.length, true); offset += 4; // Uncompressed size
    view.setUint16(offset, fileNameBytes.length, true); offset += 2; // File name length
    view.setUint16(offset, 0, true); offset += 2; // Extra field length

    uint8.set(fileNameBytes, offset); offset += fileNameBytes.length;
    uint8.set(data, offset); offset += data.length;
  }

  centralOffset = offset;

  // Write central directory
  for (const entry of entries) {
    const fileNameBytes = encoder.encode(entry.name);

    view.setUint32(offset, 0x02014B50, true); offset += 4; // Signature
    view.setUint16(offset, 20, true); offset += 2; // Version made by
    view.setUint16(offset, 20, true); offset += 2; // Version needed
    view.setUint16(offset, 0, true); offset += 2; // Flags
    view.setUint16(offset, 0, true); offset += 2; // Compression
    view.setUint16(offset, 0, true); offset += 2; // Mod time
    view.setUint16(offset, 0, true); offset += 2; // Mod date
    view.setUint32(offset, entry.crc, true); offset += 4; // CRC32
    view.setUint32(offset, entry.data.length, true); offset += 4; // Compressed size
    view.setUint32(offset, entry.data.length, true); offset += 4; // Uncompressed size
    view.setUint16(offset, fileNameBytes.length, true); offset += 2; // File name length
    view.setUint16(offset, 0, true); offset += 2; // Extra field length
    view.setUint16(offset, 0, true); offset += 2; // Comment length
    view.setUint16(offset, 0, true); offset += 2; // Disk number
    view.setUint16(offset, 0, true); offset += 2; // Internal attrs
    view.setUint32(offset, 0, true); offset += 4; // External attrs
    view.setUint32(offset, entry.offset, true); offset += 4; // Offset

    uint8.set(fileNameBytes, offset); offset += fileNameBytes.length;
  }

  const centralSize = offset - centralOffset;

  // End of central directory
  view.setUint32(offset, 0x06054B50, true); offset += 4; // Signature
  view.setUint16(offset, 0, true); offset += 2; // Disk number
  view.setUint16(offset, 0, true); offset += 2; // Central dir disk
  view.setUint16(offset, entries.length, true); offset += 2; // Entries on disk
  view.setUint16(offset, entries.length, true); offset += 2; // Total entries
  view.setUint32(offset, centralSize, true); offset += 4; // Central dir size
  view.setUint32(offset, centralOffset, true); offset += 4; // Central dir offset
  view.setUint16(offset, 0, true); // Comment length

  return uint8.slice(0, offset + 2);
}

// Bridge files content
const files: Record<string, string> = {
  "index.js": `require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const chromecasts = require('chromecasts');
const Bonjour = require('bonjour-service').Bonjour;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const DEVICE_ID = process.env.DEVICE_ID;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL) || 5000;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !DEVICE_ID) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const bonjour = new Bonjour();
const CUSTOM_APP_ID = 'FE376873';

let currentDevice = null;
let discoveredDevices = [];
let keepAliveInterval = null;

function keepSessionAlive() {
  if (keepAliveInterval) clearInterval(keepAliveInterval);
  keepAliveInterval = setInterval(() => {
    if (currentDevice) {
      try {
        currentDevice.status(() => {});
      } catch (e) {}
    }
  }, 5000);
}

async function reportDiscoveredDevice(name, host, port) {
  try {
    await supabase.from('discovered_chromecasts').upsert({
      device_id: DEVICE_ID,
      chromecast_name: name,
      chromecast_host: host,
      chromecast_port: port || 8009,
      last_seen: new Date().toISOString()
    }, { onConflict: 'device_id,chromecast_name' });
    console.log('Found device:', name);
  } catch (error) {
    console.error('Error reporting device:', error.message);
  }
}

async function getSelectedChromecast() {
  try {
    const { data } = await supabase
      .from('screensaver_settings')
      .select('selected_chromecast_id, discovered_chromecasts(chromecast_name, chromecast_host, chromecast_port)')
      .eq('device_id', DEVICE_ID)
      .single();
    
    if (data?.discovered_chromecasts) {
      return {
        name: data.discovered_chromecasts.chromecast_name,
        host: data.discovered_chromecasts.chromecast_host,
        port: data.discovered_chromecasts.chromecast_port
      };
    }
  } catch (error) {}
  return null;
}

async function getScreensaverSettings() {
  try {
    const { data } = await supabase
      .from('screensaver_settings')
      .select('*')
      .eq('device_id', DEVICE_ID)
      .single();
    return data;
  } catch (error) {}
  return null;
}

async function isChromecastIdle() {
  return new Promise((resolve) => {
    if (!currentDevice) { resolve(true); return; }
    const timeout = setTimeout(() => resolve(true), 5000);
    try {
      currentDevice.status((err, status) => {
        clearTimeout(timeout);
        if (err) { resolve(true); return; }
        const isIdle = !status?.applications || status.applications.length === 0 ||
          status.applications.some(app => app.appId === CUSTOM_APP_ID);
        resolve(isIdle);
      });
    } catch (e) { clearTimeout(timeout); resolve(true); }
  });
}

async function checkAndActivateScreensaver() {
  const settings = await getScreensaverSettings();
  if (!settings?.enabled || !settings?.url) return;
  
  const selectedDevice = await getSelectedChromecast();
  if (!selectedDevice) return;
  
  const idle = await isChromecastIdle();
  if (idle) {
    console.log('Chromecast idle, activating screensaver...');
    try {
      await castMedia(settings.url);
      await supabase
        .from('screensaver_settings')
        .update({ screensaver_active: true, last_idle_check: new Date().toISOString() })
        .eq('device_id', DEVICE_ID);
    } catch (error) {
      console.error('Failed to activate screensaver:', error.message);
    }
  }
}

function discoverDevices() {
  return new Promise((resolve) => {
    console.log('Starting Chromecast discovery...');
    discoveredDevices = [];
    
    const browser = bonjour.find({ type: 'googlecast' });
    
    browser.on('up', async (service) => {
      const name = service.name || service.txt?.fn || 'Unknown';
      const host = service.addresses?.[0] || service.host;
      const port = service.port || 8009;
      
      if (host && !discoveredDevices.find(d => d.host === host)) {
        discoveredDevices.push({ name, host, port });
        await reportDiscoveredDevice(name, host, port);
      }
    });
    
    setTimeout(() => {
      browser.stop();
      console.log('Found', discoveredDevices.length, 'Chromecast device(s)');
      resolve();
    }, 10000);
  });
}

async function castMedia(url) {
  const selectedDevice = await getSelectedChromecast();
  if (!selectedDevice) throw new Error('No Chromecast selected');
  
  return new Promise((resolve, reject) => {
    const player = chromecasts.find({ name: selectedDevice.name });
    if (!player) { reject(new Error('Device not found')); return; }
    
    currentDevice = player;
    console.log('Casting to', selectedDevice.name);
    
    player.play(url, { type: 'text/html', autoplay: true, appId: CUSTOM_APP_ID }, (err) => {
      if (err) reject(err);
      else { keepSessionAlive(); resolve({ success: true }); }
    });
  });
}

async function processPendingCommands() {
  try {
    const { data: commands } = await supabase
      .from('cast_commands')
      .select('*')
      .eq('device_id', DEVICE_ID)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    
    if (!commands?.length) return;
    
    for (const command of commands) {
      console.log('Processing command:', command.command_type);
      try {
        if (command.command_type === 'cast') await castMedia(command.url);
        await supabase.from('cast_commands')
          .update({ status: 'completed', processed_at: new Date().toISOString() })
          .eq('id', command.id);
      } catch (error) {
        await supabase.from('cast_commands')
          .update({ status: 'failed', error_message: error.message, processed_at: new Date().toISOString() })
          .eq('id', command.id);
      }
    }
  } catch (error) {}
}

function subscribeToCommands() {
  return supabase
    .channel('cast_commands')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cast_commands', filter: 'device_id=eq.' + DEVICE_ID }, () => processPendingCommands())
    .subscribe();
}

async function main() {
  console.log('');
  console.log('Chromecast Bridge Service');
  console.log('Device ID:', DEVICE_ID);
  console.log('');
  
  await discoverDevices();
  subscribeToCommands();
  await processPendingCommands();
  
  setInterval(processPendingCommands, POLL_INTERVAL);
  setInterval(checkAndActivateScreensaver, 60000);
  setInterval(discoverDevices, 30 * 60 * 1000);
  
  console.log('Bridge running. Press Ctrl+C to stop.');
  
  process.on('SIGINT', () => {
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    bonjour.destroy();
    process.exit(0);
  });
}

main().catch(console.error);
`,

  "package.json": `{
  "name": "chromecast-bridge",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "bonjour-service": "^1.2.1",
    "chromecasts": "^1.10.2",
    "dotenv": "^16.3.1"
  }
}
`,

  ".env.example": `SUPABASE_URL=https://umxwaxzmoxwasryjibhe.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
DEVICE_ID=mitt-hem
POLL_INTERVAL=5000
`,

  "README.md": `# Chromecast Bridge

## Snabbinstallation

### Windows
Hgerklicka pa install-windows.ps1 och valj "Kor med PowerShell"

### Linux / Raspberry Pi
chmod +x install-linux.sh && ./install-linux.sh

## Avinstallation
Kor uninstall-windows.ps1 eller ./uninstall-linux.sh
`,

  "install-windows.ps1": `$AppDir = "$env:APPDATA\\ChromecastBridge"
$TaskName = "ChromecastBridge"

Write-Host "Chromecast Bridge Installer" -ForegroundColor Cyan

$nodeVersion = $null
try { $nodeVersion = node --version 2>$null } catch {}
if (-not $nodeVersion) {
    Write-Host "Installerar Node.js..."
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

if (Test-Path $AppDir) { Remove-Item -Path $AppDir -Recurse -Force }
New-Item -ItemType Directory -Path $AppDir -Force | Out-Null

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Copy-Item -Path "$ScriptDir\\index.js" -Destination $AppDir -ErrorAction SilentlyContinue
Copy-Item -Path "$ScriptDir\\package.json" -Destination $AppDir -ErrorAction SilentlyContinue

Set-Location $AppDir
npm install --production 2>&1 | Out-Null

$DeviceId = $env:COMPUTERNAME.ToLower() -replace '[^a-z0-9-]', '-'
@"
SUPABASE_URL=https://umxwaxzmoxwasryjibhe.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVteHdheHptb3h3YXNyeWppYmhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0OTc3OTgsImV4cCI6MjA4MDA3Mzc5OH0.R4hVdnkp310Wk-g0jZfy52EwxfV6z3Pfnv6uwhsf0ps
DEVICE_ID=$DeviceId
POLL_INTERVAL=5000
"@ | Out-File -FilePath "$AppDir\\.env" -Encoding UTF8

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
$NodePath = (Get-Command node).Source
$Action = New-ScheduledTaskAction -Execute $NodePath -Argument "index.js" -WorkingDirectory $AppDir
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Host "Installation klar! Device ID: $DeviceId" -ForegroundColor Green
Read-Host "Tryck Enter"
`,

  "uninstall-windows.ps1": `$AppDir = "$env:APPDATA\\ChromecastBridge"
$TaskName = "ChromecastBridge"
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
if (Test-Path $AppDir) { Remove-Item -Path $AppDir -Recurse -Force }
Write-Host "Avinstallation klar!" -ForegroundColor Green
Read-Host "Tryck Enter"
`,

  "install-linux.sh": `#!/bin/bash
set -e
APP_DIR="$HOME/.local/share/chromecast-bridge"
SERVICE_NAME="chromecast-bridge"

if ! command -v node &> /dev/null; then
    if command -v apt-get &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi
fi

mkdir -p "$APP_DIR"
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/index.js" "$APP_DIR/" 2>/dev/null || true
cp "$SCRIPT_DIR/package.json" "$APP_DIR/" 2>/dev/null || true
cd "$APP_DIR" && npm install --production

DEVICE_ID=$(hostname | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]-')
cat > "$APP_DIR/.env" << EOF
SUPABASE_URL=https://umxwaxzmoxwasryjibhe.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVteHdheHptb3h3YXNyeWppYmhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0OTc3OTgsImV4cCI6MjA4MDA3Mzc5OH0.R4hVdnkp310Wk-g0jZfy52EwxfV6z3Pfnv6uwhsf0ps
DEVICE_ID=$DEVICE_ID
POLL_INTERVAL=5000
EOF

mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/$SERVICE_NAME.service" << EOF
[Unit]
Description=Chromecast Bridge
After=network-online.target
[Service]
WorkingDirectory=$APP_DIR
ExecStart=$(which node) index.js
Restart=always
[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME"
systemctl --user start "$SERVICE_NAME"
echo "Installation klar! Device ID: $DEVICE_ID"
`,

  "uninstall-linux.sh": `#!/bin/bash
SERVICE_NAME="chromecast-bridge"
APP_DIR="$HOME/.local/share/chromecast-bridge"
systemctl --user stop "$SERVICE_NAME" 2>/dev/null || true
systemctl --user disable "$SERVICE_NAME" 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/$SERVICE_NAME.service"
systemctl --user daemon-reload
rm -rf "$APP_DIR"
echo "Avinstallation klar!"
`
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const zipData = createZip(files);
    
    // Create a proper ArrayBuffer copy to avoid SharedArrayBuffer issues
    const arrayBuffer = new ArrayBuffer(zipData.length);
    new Uint8Array(arrayBuffer).set(zipData);

    return new Response(arrayBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=chromecast-bridge.zip",
      },
    });
  } catch (err) {
    const error = err as Error;
    console.error("Error generating ZIP:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
