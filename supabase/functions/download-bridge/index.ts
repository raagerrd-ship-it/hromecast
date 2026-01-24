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
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { createClient } = require('@supabase/supabase-js');
const Chromecasts = require('chromecasts');
const Bonjour = require('bonjour-service').Bonjour;

// Configuration
const CONFIG_FILE = path.join(__dirname, 'config.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = parseInt(process.env.PORT || '3000');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const DEVICE_ID = process.env.DEVICE_ID || 'default-bridge';
const CUSTOM_APP_ID = 'FE376873';

// Initialize Supabase client (optional - for device reporting)
let supabase = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// Initialize Bonjour and Chromecasts
const bonjour = new Bonjour();
const chromecasts = Chromecasts();

// State
let discoveredDevices = [];
let currentDevice = null;
let keepAliveInterval = null;
let screensaverActive = false;

// Default config
const DEFAULT_CONFIG = {
  enabled: false,
  url: '',
  selectedChromecast: null,
  idleTimeout: 5
};

// ============ Network Utilities ============

function getNetworkIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function writeNetworkInfo() {
  const ip = getNetworkIP();
  const info = 'Chromecast Bridge - Nätverksinfo\\n' +
    '================================\\n' +
    'Startad: ' + new Date().toLocaleString('sv-SE') + '\\n' +
    'Device ID: ' + DEVICE_ID + '\\n\\n' +
    'Åtkomst från denna dator:\\n' +
    '  http://localhost:' + PORT + '\\n\\n' +
    'Åtkomst från mobil/annan enhet:\\n' +
    '  http://' + ip + ':' + PORT + '\\n\\n' +
    'mDNS (om stöds):\\n' +
    '  http://' + DEVICE_ID + '.local:' + PORT;
  try {
    fs.writeFileSync(path.join(__dirname, 'network-info.txt'), info);
  } catch (error) {
    console.error('Could not write network-info.txt:', error.message);
  }
}

// ============ Config Management ============

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error('Error loading config:', error.message);
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving config:', error.message);
    return false;
  }
}

// ============ Chromecast Discovery ============

function discoverDevices() {
  return new Promise((resolve) => {
    console.log('Scanning for Chromecast devices...');
    
    const browser = bonjour.find({ type: 'googlecast' });
    const foundDevices = [];
    
    browser.on('up', (service) => {
      const name = service.name || service.txt?.fn || 'Unknown';
      const host = service.addresses?.[0] || service.referer?.address || service.host;
      const port = service.port || 8009;
      
      if (host && !foundDevices.find(d => d.host === host)) {
        const device = { name, host, port };
        foundDevices.push(device);
        console.log('Found:', name, 'at', host + ':' + port);
        
        // Report to Supabase if connected
        if (supabase) {
          reportDiscoveredDevice(name, host, port);
        }
      }
    });
    
    setTimeout(() => {
      browser.stop();
      discoveredDevices = foundDevices;
      console.log('Discovery complete:', foundDevices.length, 'device(s)');
      resolve(foundDevices);
    }, 8000);
  });
}

async function reportDiscoveredDevice(name, host, port) {
  if (!supabase) return;
  try {
    await supabase.from('discovered_chromecasts').upsert({
      device_id: DEVICE_ID,
      chromecast_name: name,
      chromecast_host: host,
      chromecast_port: port,
      last_seen: new Date().toISOString()
    }, { onConflict: 'device_id,chromecast_name' });
  } catch (error) {
    console.error('Error reporting device:', error.message);
  }
}

// ============ Chromecast Control ============

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

async function isChromecastIdle(device) {
  return new Promise((resolve) => {
    if (!device) { resolve(true); return; }
    const timeout = setTimeout(() => resolve(true), 5000);
    try {
      device.status((err, status) => {
        clearTimeout(timeout);
        if (err) { resolve(true); return; }
        const isIdle = !status?.applications || status.applications.length === 0 ||
          status.applications.some(app => app.appId === CUSTOM_APP_ID);
        resolve(isIdle);
      });
    } catch (e) { clearTimeout(timeout); resolve(true); }
  });
}

function findDevice(name) {
  const device = discoveredDevices.find(d => d.name === name);
  if (!device) return null;
  
  // Find player in chromecasts
  const player = chromecasts.players.find(p => p.host === device.host || p.name === device.name);
  return player || null;
}

async function castMedia(chromecastName, url) {
  return new Promise((resolve, reject) => {
    const player = findDevice(chromecastName);
    if (!player) {
      reject(new Error('Device "' + chromecastName + '" not found'));
      return;
    }
    
    currentDevice = player;
    console.log('Casting to', chromecastName + ':', url);
    
    player.play(url, { type: 'text/html', autoplay: true, appId: CUSTOM_APP_ID }, (err) => {
      if (err) {
        console.error('Cast failed:', err.message);
        reject(err);
      } else {
        console.log('Cast successful');
        screensaverActive = true;
        keepSessionAlive();
        resolve({ success: true });
      }
    });
  });
}

async function stopCast(chromecastName) {
  return new Promise((resolve, reject) => {
    const player = findDevice(chromecastName);
    if (!player) {
      reject(new Error('Device "' + chromecastName + '" not found'));
      return;
    }
    
    try {
      player.stop(() => {
        screensaverActive = false;
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        console.log('Cast stopped');
        resolve({ success: true });
      });
    } catch (error) {
      reject(error);
    }
  });
}

// ============ Auto-Screensaver ============

async function checkAndActivateScreensaver() {
  const config = loadConfig();
  if (!config.enabled || !config.url || !config.selectedChromecast) return;
  
  const player = findDevice(config.selectedChromecast);
  if (!player) return;
  
  const idle = await isChromecastIdle(player);
  if (idle && !screensaverActive) {
    console.log('Device idle, activating screensaver...');
    try {
      await castMedia(config.selectedChromecast, config.url);
    } catch (error) {
      console.error('Failed to activate screensaver:', error.message);
    }
  }
}

// ============ HTTP Server ============

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function serveStatic(filePath, res) {
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'text/plain';
  
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

function sendJson(res, data, status) {
  status = status || 200;
  res.writeHead(status, { 
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const pathname = url.pathname;
  
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // API Routes
  if (pathname.startsWith('/api/')) {
    try {
      // GET /api/settings
      if (req.method === 'GET' && pathname === '/api/settings') {
        const config = loadConfig();
        sendJson(res, { 
          ...config, 
          deviceId: DEVICE_ID,
          screensaverActive: screensaverActive 
        });
        return;
      }
      
      // POST /api/settings
      if (req.method === 'POST' && pathname === '/api/settings') {
        const body = await parseBody(req);
        const config = loadConfig();
        const newConfig = { ...config, ...body };
        saveConfig(newConfig);
        sendJson(res, { success: true, config: newConfig });
        return;
      }
      
      // GET /api/chromecasts
      if (req.method === 'GET' && pathname === '/api/chromecasts') {
        sendJson(res, { devices: discoveredDevices });
        return;
      }
      
      // POST /api/chromecasts/refresh
      if (req.method === 'POST' && pathname === '/api/chromecasts/refresh') {
        const devices = await discoverDevices();
        sendJson(res, { devices: devices });
        return;
      }
      
      // POST /api/cast
      if (req.method === 'POST' && pathname === '/api/cast') {
        const body = await parseBody(req);
        const config = loadConfig();
        const chromecastName = body.chromecast || config.selectedChromecast;
        const castUrl = body.url || config.url;
        
        if (!chromecastName || !castUrl) {
          sendJson(res, { error: 'Missing chromecast or url' }, 400);
          return;
        }
        
        await castMedia(chromecastName, castUrl);
        sendJson(res, { success: true });
        return;
      }
      
      // POST /api/stop
      if (req.method === 'POST' && pathname === '/api/stop') {
        const config = loadConfig();
        if (config.selectedChromecast) {
          await stopCast(config.selectedChromecast);
        }
        sendJson(res, { success: true });
        return;
      }
      
      // GET /api/status
      if (req.method === 'GET' && pathname === '/api/status') {
        const config = loadConfig();
        const networkIP = getNetworkIP();
        sendJson(res, {
          deviceId: DEVICE_ID,
          port: PORT,
          networkIP: networkIP,
          networkUrl: 'http://' + networkIP + ':' + PORT,
          mdnsUrl: 'http://' + DEVICE_ID + '.local:' + PORT,
          devices: discoveredDevices.length,
          selectedChromecast: config.selectedChromecast,
          screensaverActive: screensaverActive,
          uptime: process.uptime()
        });
        return;
      }
      
      sendJson(res, { error: 'Not found' }, 404);
    } catch (error) {
      sendJson(res, { error: error.message }, 500);
    }
    return;
  }
  
  // Serve static files
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(PUBLIC_DIR, filePath);
  
  // Security: prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  
  serveStatic(filePath, res);
});

// ============ Main ============

async function main() {
  const networkIP = getNetworkIP();
  
  console.log('');
  console.log('========================================');
  console.log('  Chromecast Bridge Service');
  console.log('========================================');
  console.log('');
  console.log('Device ID:', DEVICE_ID);
  console.log('');
  console.log('Åtkomst:');
  console.log('  Lokal:    http://localhost:' + PORT);
  console.log('  Nätverk:  http://' + networkIP + ':' + PORT);
  console.log('  mDNS:     http://' + DEVICE_ID + '.local:' + PORT);
  console.log('');
  
  // Write network info to file
  writeNetworkInfo();
  console.log('Nätverksinfo sparad till: network-info.txt');
  console.log('');
  
  // Initial discovery
  await discoverDevices();
  
  // Start chromecasts library discovery
  chromecasts.on('update', (player) => {
    console.log('Chromecasts lib found:', player.name);
  });
  
  // Start HTTP server
  server.listen(PORT, '0.0.0.0', () => {
    console.log('Server running');
    
    // Publish mDNS service
    try {
      bonjour.publish({
        name: DEVICE_ID,
        type: 'http',
        port: PORT,
        txt: { 
          type: 'chromecast-bridge',
          version: '1.0.0'
        }
      });
      console.log('mDNS publicerad:', DEVICE_ID + '.local');
    } catch (error) {
      console.error('mDNS publishing failed:', error.message);
    }
  });
  
  // Periodic discovery
  setInterval(discoverDevices, 30 * 60 * 1000);
  
  // Screensaver check every minute
  setInterval(checkAndActivateScreensaver, 60000);
  
  // Update network info periodically
  setInterval(writeNetworkInfo, 5 * 60 * 1000);
  
  console.log('');
  console.log('Press Ctrl+C to stop.');
  
  process.on('SIGINT', () => {
    console.log('');
    console.log('Shutting down...');
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    bonjour.destroy();
    server.close();
    process.exit(0);
  });
}

main().catch(console.error);
`,

  "package.json": `{
  "name": "chromecast-bridge",
  "version": "2.0.0",
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

  ".env.example": `# Chromecast Bridge Configuration

# Supabase (optional - for cloud sync)
SUPABASE_URL=https://umxwaxzmoxwasryjibhe.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here

# Bridge settings
DEVICE_ID=mitt-hem
PORT=3000
`,

  "README.md": `# Chromecast Bridge

Lokal bridge-tjänst för att styra Chromecast från ditt nätverk.

## Snabbinstallation

### Windows
Högerklicka på \`install-windows.ps1\` och välj "Kör med PowerShell"

### Linux / Raspberry Pi
\`\`\`bash
chmod +x install-linux.sh && ./install-linux.sh
\`\`\`

## Användning

Efter installation, öppna webbläsaren och gå till:

- **Lokal:** http://localhost:3000
- **Från annan enhet:** http://<din-dators-ip>:3000

## Multi-instance

Du kan köra flera bridges på samma dator (t.ex. en per rum).
Installern frågar efter instansnamn och port.

## Avinstallation

Kör \`uninstall-windows.ps1\` eller \`./uninstall-linux.sh\`
`,

  "public/index.html": `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chromecast Bridge</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="container">
    <header>
      <h1>📺 Chromecast Bridge</h1>
      <div class="status" id="status">
        <span class="status-dot"></span>
        <span id="status-text">Ansluter...</span>
      </div>
    </header>

    <main>
      <section class="card">
        <div class="card-header">
          <h2>Välj Chromecast</h2>
          <button id="refresh-btn" class="btn btn-secondary" title="Sök efter enheter">🔄 Sök</button>
        </div>
        <div class="card-content">
          <select id="chromecast-select">
            <option value="">-- Välj enhet --</option>
          </select>
          <p class="hint" id="device-count">Söker efter enheter...</p>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <h2>Screensaver</h2>
          <label class="switch">
            <input type="checkbox" id="enabled-toggle">
            <span class="slider"></span>
          </label>
        </div>
        <div class="card-content">
          <div class="form-group">
            <label for="url-input">URL att visa</label>
            <input type="url" id="url-input" placeholder="https://example.com/screensaver">
          </div>
          <div class="screensaver-status" id="screensaver-status">
            <span class="status-indicator off"></span>
            <span>Inaktiv</span>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <h2>Kontroller</h2>
        </div>
        <div class="card-content controls">
          <button id="cast-btn" class="btn btn-primary">▶️ Starta nu</button>
          <button id="stop-btn" class="btn btn-danger">⏹️ Stoppa</button>
        </div>
      </section>

      <section class="card preview-card">
        <div class="card-header">
          <h2>Förhandsvisning</h2>
        </div>
        <div class="card-content">
          <div class="preview-container" id="preview-container">
            <p class="preview-placeholder">Ange en URL ovan för att se förhandsvisning</p>
          </div>
        </div>
      </section>
    </main>

    <footer>
      <section class="card network-card">
        <div class="card-header">
          <h2>📱 Anslut från mobil</h2>
        </div>
        <div class="card-content">
          <div class="network-info">
            <div class="network-row">
              <span class="network-label">Nätverks-URL:</span>
              <code id="network-url">-</code>
              <button id="copy-url-btn" class="btn btn-small">📋 Kopiera</button>
            </div>
            <div class="network-row">
              <span class="network-label">mDNS:</span>
              <code id="mdns-url">-</code>
            </div>
          </div>
          <p class="hint">Öppna denna adress i din mobil för att konfigurera bridge:n</p>
        </div>
      </section>
      <p class="footer-info">Device ID: <code id="device-id">-</code> | Port: <code id="port">-</code></p>
    </footer>
  </div>

  <script src="app.js"></script>
</body>
</html>
`,

  "public/style.css": `* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

:root {
  --bg: #0a0a0a;
  --bg-card: #141414;
  --bg-hover: #1a1a1a;
  --text: #fafafa;
  --text-muted: #a1a1aa;
  --primary: #3b82f6;
  --primary-hover: #2563eb;
  --danger: #ef4444;
  --danger-hover: #dc2626;
  --success: #22c55e;
  --border: #27272a;
  --radius: 12px;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  line-height: 1.5;
}

.container {
  max-width: 600px;
  margin: 0 auto;
  padding: 1rem;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding: 1rem 0;
}

header h1 {
  font-size: 1.5rem;
  font-weight: 600;
}

.status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--text-muted);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  animation: pulse 2s infinite;
}

.status-dot.online {
  background: var(--success);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

main {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid var(--border);
}

.card-header h2 {
  font-size: 1rem;
  font-weight: 500;
}

.card-content {
  padding: 1rem;
}

select, input[type="url"], input[type="text"] {
  width: 100%;
  padding: 0.75rem 1rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-size: 1rem;
  outline: none;
  transition: border-color 0.2s;
}

select:hover, input:hover {
  border-color: var(--text-muted);
}

select:focus, input:focus {
  border-color: var(--primary);
}

.form-group {
  margin-bottom: 1rem;
}

.form-group label {
  display: block;
  font-size: 0.875rem;
  color: var(--text-muted);
  margin-bottom: 0.5rem;
}

.hint {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 0.5rem;
}

.switch {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 26px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--border);
  transition: 0.3s;
  border-radius: 26px;
}

.slider:before {
  position: absolute;
  content: "";
  height: 20px;
  width: 20px;
  left: 3px;
  bottom: 3px;
  background-color: var(--text);
  transition: 0.3s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: var(--primary);
}

input:checked + .slider:before {
  transform: translateX(22px);
}

.btn {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-primary {
  background: var(--primary);
  color: white;
}

.btn-primary:hover {
  background: var(--primary-hover);
}

.btn-secondary {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
}

.btn-secondary:hover {
  background: var(--bg-hover);
}

.btn-danger {
  background: var(--danger);
  color: white;
}

.btn-danger:hover {
  background: var(--danger-hover);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.controls {
  display: flex;
  gap: 0.5rem;
}

.controls .btn {
  flex: 1;
}

.screensaver-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--bg);
  border-radius: 8px;
  font-size: 0.875rem;
}

.status-indicator {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--text-muted);
}

.status-indicator.on {
  background: var(--success);
  box-shadow: 0 0 10px var(--success);
}

.preview-container {
  aspect-ratio: 16/9;
  background: var(--bg);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-placeholder {
  color: var(--text-muted);
  font-size: 0.875rem;
  text-align: center;
  padding: 2rem;
}

.preview-container iframe {
  width: 100%;
  height: 100%;
  border: none;
}

footer {
  margin-top: 2rem;
}

footer .network-card {
  text-align: left;
}

.network-info {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.network-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.network-label {
  font-size: 0.875rem;
  color: var(--text-muted);
  min-width: 100px;
}

.network-row code {
  background: var(--bg);
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  font-family: monospace;
  font-size: 0.875rem;
  flex: 1;
  word-break: break-all;
}

.btn-small {
  padding: 0.5rem 0.75rem;
  font-size: 0.75rem;
}

.footer-info {
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 1rem;
}

.footer-info code {
  background: var(--bg-card);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-family: monospace;
}

@media (max-width: 480px) {
  .controls {
    flex-direction: column;
  }
  
  header {
    flex-direction: column;
    gap: 0.5rem;
    text-align: center;
  }
}
`,

  "public/app.js": `// API helpers
const API_BASE = '';

async function api(path, options) {
  options = options || {};
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  return res.json();
}

// DOM elements
const elements = {
  status: document.getElementById('status'),
  statusText: document.getElementById('status-text'),
  chromecastSelect: document.getElementById('chromecast-select'),
  refreshBtn: document.getElementById('refresh-btn'),
  deviceCount: document.getElementById('device-count'),
  enabledToggle: document.getElementById('enabled-toggle'),
  urlInput: document.getElementById('url-input'),
  screensaverStatus: document.getElementById('screensaver-status'),
  castBtn: document.getElementById('cast-btn'),
  stopBtn: document.getElementById('stop-btn'),
  previewContainer: document.getElementById('preview-container'),
  deviceId: document.getElementById('device-id'),
  port: document.getElementById('port'),
  networkUrl: document.getElementById('network-url'),
  mdnsUrl: document.getElementById('mdns-url'),
  copyUrlBtn: document.getElementById('copy-url-btn')
};

// State
var state = {
  settings: {},
  devices: [],
  isLoading: false
};

// ============ UI Updates ============

function updateStatus(online, text) {
  var dot = elements.status.querySelector('.status-dot');
  if (online) {
    dot.classList.add('online');
  } else {
    dot.classList.remove('online');
  }
  elements.statusText.textContent = text;
}

function updateDeviceList(devices) {
  var select = elements.chromecastSelect;
  var currentValue = select.value;
  
  select.innerHTML = '<option value="">-- Välj enhet --</option>';
  
  devices.forEach(function(device) {
    var option = document.createElement('option');
    option.value = device.name;
    option.textContent = device.name;
    select.appendChild(option);
  });
  
  if (currentValue && devices.find(function(d) { return d.name === currentValue; })) {
    select.value = currentValue;
  } else if (state.settings.selectedChromecast) {
    select.value = state.settings.selectedChromecast;
  }
  
  elements.deviceCount.textContent = devices.length + ' enhet(er) hittade';
}

function updateScreensaverStatus(active) {
  var statusEl = elements.screensaverStatus;
  var indicator = statusEl.querySelector('.status-indicator');
  var text = statusEl.querySelector('span:last-child');
  
  if (active) {
    indicator.classList.add('on');
    indicator.classList.remove('off');
  } else {
    indicator.classList.remove('on');
    indicator.classList.add('off');
  }
  text.textContent = active ? 'Aktiv på TV' : 'Inaktiv';
}

function updatePreview(url) {
  var container = elements.previewContainer;
  
  if (!url) {
    container.innerHTML = '<p class="preview-placeholder">Ange en URL ovan för att se förhandsvisning</p>';
    return;
  }
  
  container.innerHTML = '<iframe src="' + url + '" sandbox="allow-scripts allow-same-origin"></iframe>';
}

function setLoading(loading) {
  state.isLoading = loading;
  elements.refreshBtn.disabled = loading;
  elements.castBtn.disabled = loading;
  elements.stopBtn.disabled = loading;
}

// ============ API Calls ============

async function loadSettings() {
  try {
    var data = await api('/api/settings');
    state.settings = data;
    
    elements.enabledToggle.checked = data.enabled;
    elements.urlInput.value = data.url || '';
    elements.deviceId.textContent = data.deviceId || '-';
    
    if (data.selectedChromecast) {
      elements.chromecastSelect.value = data.selectedChromecast;
    }
    
    updateScreensaverStatus(data.screensaverActive);
    updatePreview(data.url);
    updateStatus(true, 'Ansluten');
  } catch (error) {
    console.error('Failed to load settings:', error);
    updateStatus(false, 'Kunde inte ansluta');
  }
}

async function loadDevices() {
  try {
    var data = await api('/api/chromecasts');
    state.devices = data.devices || [];
    updateDeviceList(state.devices);
  } catch (error) {
    console.error('Failed to load devices:', error);
  }
}

async function loadStatus() {
  try {
    var data = await api('/api/status');
    elements.port.textContent = data.port || '-';
    updateScreensaverStatus(data.screensaverActive);
    
    // Update network URL display
    if (data.networkUrl && elements.networkUrl) {
      elements.networkUrl.textContent = data.networkUrl;
    }
    if (data.mdnsUrl && elements.mdnsUrl) {
      elements.mdnsUrl.textContent = data.mdnsUrl;
    }
  } catch (error) {
    console.error('Failed to load status:', error);
  }
}

async function saveSettings(updates) {
  try {
    var newSettings = Object.assign({}, state.settings, updates);
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify(updates)
    });
    state.settings = newSettings;
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

async function refreshDevices() {
  setLoading(true);
  elements.deviceCount.textContent = 'Söker...';
  
  try {
    var data = await api('/api/chromecasts/refresh', { method: 'POST' });
    state.devices = data.devices || [];
    updateDeviceList(state.devices);
  } catch (error) {
    console.error('Failed to refresh devices:', error);
    elements.deviceCount.textContent = 'Sökning misslyckades';
  }
  
  setLoading(false);
}

async function startCast() {
  setLoading(true);
  
  try {
    await api('/api/cast', { method: 'POST' });
    updateScreensaverStatus(true);
  } catch (error) {
    console.error('Cast failed:', error);
    alert('Kunde inte starta cast: ' + error.message);
  }
  
  setLoading(false);
}

async function stopCast() {
  setLoading(true);
  
  try {
    await api('/api/stop', { method: 'POST' });
    updateScreensaverStatus(false);
  } catch (error) {
    console.error('Stop failed:', error);
  }
  
  setLoading(false);
}

// ============ Event Handlers ============

elements.chromecastSelect.addEventListener('change', function(e) {
  saveSettings({ selectedChromecast: e.target.value || null });
});

elements.enabledToggle.addEventListener('change', function(e) {
  saveSettings({ enabled: e.target.checked });
});

elements.urlInput.addEventListener('change', function(e) {
  var url = e.target.value.trim();
  saveSettings({ url: url });
  updatePreview(url);
});

elements.refreshBtn.addEventListener('click', refreshDevices);
elements.castBtn.addEventListener('click', startCast);
elements.stopBtn.addEventListener('click', stopCast);

if (elements.copyUrlBtn) {
  elements.copyUrlBtn.addEventListener('click', function() {
    var url = elements.networkUrl ? elements.networkUrl.textContent : null;
    if (url && url !== '-') {
      navigator.clipboard.writeText(url).then(function() {
        elements.copyUrlBtn.textContent = '✓ Kopierad!';
        setTimeout(function() {
          elements.copyUrlBtn.textContent = '📋 Kopiera';
        }, 2000);
      });
    }
  });
}

// ============ Init ============

async function init() {
  updateStatus(false, 'Ansluter...');
  
  await loadSettings();
  await loadDevices();
  await loadStatus();
  
  setInterval(loadStatus, 10000);
}

init();
`,

  "install-windows.ps1": `$ErrorActionPreference = "Stop"
$DefaultAppName = "ChromecastBridge"
$DefaultPort = 3000

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Chromecast Bridge Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Om du vill köra flera bridges, ge varje ett unikt namn." -ForegroundColor Gray
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
    $PortInput = Read-Host "Port (standard: $DefaultPort)"
    if ([string]::IsNullOrWhiteSpace($PortInput)) { $Port = $DefaultPort } else { $Port = [int]$PortInput }
}

$AppDir = "$env:APPDATA\\$AppName"

Write-Host ""
Write-Host "Installation: $AppName på port $Port" -ForegroundColor Yellow
Write-Host ""

$nodeVersion = $null
try { $nodeVersion = node --version 2>$null } catch {}
if (-not $nodeVersion) {
    Write-Host "Installerar Node.js..."
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

if (Test-Path $AppDir) { Remove-Item -Path $AppDir -Recurse -Force }
New-Item -ItemType Directory -Path $AppDir -Force | Out-Null
New-Item -ItemType Directory -Path "$AppDir\\public" -Force | Out-Null

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Copy-Item -Path "$ScriptDir\\index.js" -Destination $AppDir -ErrorAction SilentlyContinue
Copy-Item -Path "$ScriptDir\\package.json" -Destination $AppDir -ErrorAction SilentlyContinue
if (Test-Path "$ScriptDir\\public") {
    Copy-Item -Path "$ScriptDir\\public\\*" -Destination "$AppDir\\public" -Recurse
}

Set-Location $AppDir
npm install --production 2>&1 | Out-Null

$DeviceId = $env:COMPUTERNAME.ToLower() -replace '[^a-z0-9-]', '-'
if (-not [string]::IsNullOrWhiteSpace($InstanceName)) { $DeviceId = "$DeviceId-$CleanName" }

@"
SUPABASE_URL=https://umxwaxzmoxwasryjibhe.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVteHdheHptb3h3YXNyeWppYmhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0OTc3OTgsImV4cCI6MjA4MDA3Mzc5OH0.R4hVdnkp310Wk-g0jZfy52EwxfV6z3Pfnv6uwhsf0ps
DEVICE_ID=$DeviceId
PORT=$Port
"@ | Out-File -FilePath "$AppDir\\.env" -Encoding UTF8

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
$NodePath = (Get-Command node).Source
$Action = New-ScheduledTaskAction -Execute $NodePath -Argument "index.js" -WorkingDirectory $AppDir
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Installation klar!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Öppna: http://localhost:$Port" -ForegroundColor Cyan
Write-Host ""
Write-Host "Device ID: $DeviceId" -ForegroundColor Yellow
Write-Host ""
Read-Host "Tryck Enter"
`,

  "uninstall-windows.ps1": `$ErrorActionPreference = "SilentlyContinue"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Chromecast Bridge Avinstallation" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$Tasks = Get-ScheduledTask | Where-Object { $_.TaskName -like "ChromecastBridge*" }
$Folders = Get-ChildItem "$env:APPDATA" -Directory | Where-Object { $_.Name -like "ChromecastBridge*" }

if ($Tasks.Count -eq 0 -and $Folders.Count -eq 0) {
    Write-Host "Inga installationer hittades." -ForegroundColor Gray
    Read-Host "Tryck Enter"
    exit 0
}

Write-Host "Hittade:" -ForegroundColor White
$index = 1
$Installations = @()

foreach ($task in $Tasks) {
    Write-Host "  [$index] $($task.TaskName)" -ForegroundColor Cyan
    $Installations += @{ TaskName = $task.TaskName; FolderPath = "$env:APPDATA\\$($task.TaskName)" }
    $index++
}

Write-Host ""
Write-Host "  [A] Avinstallera ALLA" -ForegroundColor Red
Write-Host "  [0] Avbryt" -ForegroundColor Gray
Write-Host ""

$choice = Read-Host "Välj"

if ($choice -eq "0" -or [string]::IsNullOrWhiteSpace($choice)) { exit 0 }

$toUninstall = @()
if ($choice -eq "A" -or $choice -eq "a") { $toUninstall = $Installations }
else {
    $choiceNum = [int]$choice
    if ($choiceNum -ge 1 -and $choiceNum -le $Installations.Count) {
        $toUninstall += $Installations[$choiceNum - 1]
    }
}

foreach ($install in $toUninstall) {
    if ($install.TaskName) {
        Stop-ScheduledTask -TaskName $install.TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $install.TaskName -Confirm:$false -ErrorAction SilentlyContinue
    }
    if ($install.FolderPath -and (Test-Path $install.FolderPath)) {
        Remove-Item -Path $install.FolderPath -Recurse -Force -ErrorAction SilentlyContinue
    }
    Write-Host "  Avinstallerad: $($install.TaskName)" -ForegroundColor Green
}

Write-Host ""
Write-Host "Klart!" -ForegroundColor Green
Read-Host "Tryck Enter"
`,

  "install-linux.sh": `#!/bin/bash
set -e

DEFAULT_PORT=3000

echo ""
echo "========================================"
echo "  Chromecast Bridge Installer"
echo "========================================"
echo ""

read -p "Instansnamn (Enter för standard): " INSTANCE_NAME

if [ -z "$INSTANCE_NAME" ]; then
    APP_NAME="chromecast-bridge"
    SERVICE_NAME="chromecast-bridge"
    PORT=$DEFAULT_PORT
else
    CLEAN_NAME=$(echo "$INSTANCE_NAME" | tr -cd '[:alnum:]-' | tr '[:upper:]' '[:lower:]')
    APP_NAME="chromecast-bridge-$CLEAN_NAME"
    SERVICE_NAME="chromecast-bridge-$CLEAN_NAME"
    read -p "Port (standard: $DEFAULT_PORT): " PORT_INPUT
    PORT=\${PORT_INPUT:-$DEFAULT_PORT}
fi

APP_DIR="$HOME/.local/share/$APP_NAME"

if [ "$EUID" -eq 0 ]; then
    echo "Kör inte som root!"
    exit 1
fi

if ! command -v node &> /dev/null; then
    if command -v apt-get &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi
fi

mkdir -p "$APP_DIR/public"
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/index.js" "$APP_DIR/" 2>/dev/null || true
cp "$SCRIPT_DIR/package.json" "$APP_DIR/" 2>/dev/null || true
[ -d "$SCRIPT_DIR/public" ] && cp -r "$SCRIPT_DIR/public/"* "$APP_DIR/public/"

cd "$APP_DIR" && npm install --production

DEVICE_ID=$(hostname | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]-')
[ -n "$CLEAN_NAME" ] && DEVICE_ID="$DEVICE_ID-$CLEAN_NAME"

cat > "$APP_DIR/.env" << EOF
SUPABASE_URL=https://umxwaxzmoxwasryjibhe.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVteHdheHptb3h3YXNyeWppYmhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0OTc3OTgsImV4cCI6MjA4MDA3Mzc5OH0.R4hVdnkp310Wk-g0jZfy52EwxfV6z3Pfnv6uwhsf0ps
DEVICE_ID=$DEVICE_ID
PORT=$PORT
EOF

mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/$SERVICE_NAME.service" << EOF
[Unit]
Description=Chromecast Bridge - $APP_NAME
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

IP_ADDR=$(hostname -I | awk '{print $1}')

echo ""
echo "========================================"
echo "  Installation klar!"
echo "========================================"
echo ""
echo "Öppna: http://localhost:$PORT"
echo "LAN:   http://$IP_ADDR:$PORT"
echo ""
echo "Device ID: $DEVICE_ID"
echo ""
`,

  "uninstall-linux.sh": `#!/bin/bash

echo ""
echo "========================================"
echo "  Chromecast Bridge Avinstallation"
echo "========================================"
echo ""

SERVICES=$(systemctl --user list-units --all --type=service 2>/dev/null | grep "chromecast-bridge" | awk '{print $1}' | sed 's/.service$//')

if [ -z "$SERVICES" ]; then
    echo "Inga installationer hittades."
    exit 0
fi

echo "Hittade:"
index=1
declare -a INSTALLATIONS
for service in $SERVICES; do
    echo "  [$index] $service"
    INSTALLATIONS+=("$service")
    ((index++))
done

echo ""
echo "  [A] Avinstallera ALLA"
echo "  [0] Avbryt"
echo ""

read -p "Välj: " choice

[ -z "$choice" ] || [ "$choice" = "0" ] && exit 0

declare -a TO_UNINSTALL
if [ "$choice" = "A" ] || [ "$choice" = "a" ]; then
    TO_UNINSTALL=("\${INSTALLATIONS[@]}")
else
    idx=$((choice - 1))
    [ $idx -ge 0 ] && [ $idx -lt \${#INSTALLATIONS[@]} ] && TO_UNINSTALL=("\${INSTALLATIONS[$idx]}")
fi

for service in "\${TO_UNINSTALL[@]}"; do
    systemctl --user stop "$service" 2>/dev/null || true
    systemctl --user disable "$service" 2>/dev/null || true
    rm -f "$HOME/.config/systemd/user/$service.service"
    rm -rf "$HOME/.local/share/$service"
    echo "  Avinstallerad: $service"
done

systemctl --user daemon-reload

echo ""
echo "Klart!"
echo ""
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
