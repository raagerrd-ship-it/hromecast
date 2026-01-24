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

// ============================================================================
// BRIDGE FILES - Offline version (no cloud dependencies)
// Last updated: 2026-01-24
// ============================================================================

const INDEX_JS = `require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const Chromecasts = require('chromecasts');
const Bonjour = require('bonjour-service').Bonjour;

// Configuration
const CONFIG_FILE = path.join(__dirname, 'config.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = parseInt(process.env.PORT || '3000');
const DEVICE_ID = process.env.DEVICE_ID || 'default-bridge';
const CUSTOM_APP_ID = 'FE376873';

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
  const info = \`Chromecast Bridge - Nätverksinfo
================================
Startad: \${new Date().toLocaleString('sv-SE')}
Device ID: \${DEVICE_ID}

Åtkomst från denna dator:
  http://localhost:\${PORT}

Åtkomst från mobil/annan enhet:
  http://\${ip}:\${PORT}

mDNS (om stöds):
  http://\${DEVICE_ID}.local:\${PORT}
\`;
  try {
    fs.writeFileSync(path.join(__dirname, 'network-info.txt'), info.trim());
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
    console.log('🔍 Scanning for Chromecast devices...');
    
    const browser = bonjour.find({ type: 'googlecast' });
    const foundDevices = [];
    
    browser.on('up', (service) => {
      const name = service.name || service.txt?.fn || 'Unknown';
      const host = service.addresses?.[0] || service.referer?.address || service.host;
      const port = service.port || 8009;
      
      if (host && !foundDevices.find(d => d.host === host)) {
        const device = { name, host, port };
        foundDevices.push(device);
        console.log(\`✅ Found: \${name} at \${host}:\${port}\`);
      }
    });
    
    setTimeout(() => {
      browser.stop();
      discoveredDevices = foundDevices;
      console.log(\`📡 Discovery complete: \${foundDevices.length} device(s)\`);
      resolve(foundDevices);
    }, 8000);
  });
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
      reject(new Error(\`Device "\${chromecastName}" not found\`));
      return;
    }
    
    currentDevice = player;
    console.log(\`📺 Casting to \${chromecastName}: \${url}\`);
    
    player.play(url, { type: 'text/html', autoplay: true, appId: CUSTOM_APP_ID }, (err) => {
      if (err) {
        console.error('❌ Cast failed:', err.message);
        reject(err);
      } else {
        console.log('✅ Cast successful');
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
      reject(new Error(\`Device "\${chromecastName}" not found\`));
      return;
    }
    
    try {
      player.stop(() => {
        screensaverActive = false;
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        console.log('⏹️ Cast stopped');
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
    console.log('💤 Device idle, activating screensaver...');
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

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, \`http://localhost:\${PORT}\`);
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
          screensaverActive 
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
        sendJson(res, { devices });
        return;
      }
      
      // POST /api/cast
      if (req.method === 'POST' && pathname === '/api/cast') {
        const body = await parseBody(req);
        const config = loadConfig();
        const chromecastName = body.chromecast || config.selectedChromecast;
        const url = body.url || config.url;
        
        if (!chromecastName || !url) {
          sendJson(res, { error: 'Missing chromecast or url' }, 400);
          return;
        }
        
        await castMedia(chromecastName, url);
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
          networkUrl: \`http://\${networkIP}:\${PORT}\`,
          mdnsUrl: \`http://\${DEVICE_ID}.local:\${PORT}\`,
          devices: discoveredDevices.length,
          selectedChromecast: config.selectedChromecast,
          screensaverActive,
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
  console.log('╔════════════════════════════════════════╗');
  console.log('║     Chromecast Bridge Service          ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');
  console.log(\`📍 Device ID: \${DEVICE_ID}\`);
  console.log('');
  console.log('🌐 Åtkomst:');
  console.log(\`   Lokal:    http://localhost:\${PORT}\`);
  console.log(\`   Nätverk:  http://\${networkIP}:\${PORT}\`);
  console.log(\`   mDNS:     http://\${DEVICE_ID}.local:\${PORT}\`);
  console.log('');
  
  // Write network info to file (for background services)
  writeNetworkInfo();
  console.log(\`📄 Nätverksinfo sparad till: network-info.txt\`);
  console.log('');
  
  // Initial discovery
  await discoverDevices();
  
  // Start chromecasts library discovery
  chromecasts.on('update', (player) => {
    console.log(\`📡 Chromecasts lib found: \${player.name}\`);
  });
  
  // Start HTTP server
  server.listen(PORT, '0.0.0.0', () => {
    console.log(\`🚀 Server running\`);
    
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
      console.log(\`📡 mDNS publicerad: \${DEVICE_ID}.local\`);
    } catch (error) {
      console.error('mDNS publishing failed:', error.message);
    }
  });
  
  // Periodic discovery
  setInterval(discoverDevices, 30 * 60 * 1000);
  
  // Screensaver check every minute
  setInterval(checkAndActivateScreensaver, 60000);
  
  // Update network info periodically (in case IP changes)
  setInterval(writeNetworkInfo, 5 * 60 * 1000);
  
  console.log('');
  console.log('Press Ctrl+C to stop.');
  
  process.on('SIGINT', () => {
    console.log('\\n👋 Shutting down...');
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    bonjour.destroy();
    server.close();
    process.exit(0);
  });
}

main().catch(console.error);`;

const PACKAGE_JSON = `{
  "name": "chromecast-bridge",
  "version": "1.0.0",
  "description": "Local service for controlling Chromecast screensaver",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "bonjour-service": "^1.3.0",
    "chromecasts": "^1.10.1",
    "dotenv": "^16.3.1"
  }
}`;

const ENV_EXAMPLE = `# Bridge Configuration
DEVICE_ID=my-bridge
PORT=3000`;

const PUBLIC_INDEX_HTML = `<!DOCTYPE html>
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
      <!-- Device Selection -->
      <section class="card">
        <div class="card-header">
          <h2>Välj Chromecast</h2>
          <button id="refresh-btn" class="btn btn-secondary" title="Sök efter enheter">
            🔄 Sök
          </button>
        </div>
        <div class="card-content">
          <select id="chromecast-select">
            <option value="">-- Välj enhet --</option>
          </select>
          <p class="hint" id="device-count">Söker efter enheter...</p>
        </div>
      </section>

      <!-- Screensaver Settings -->
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

      <!-- Controls -->
      <section class="card">
        <div class="card-header">
          <h2>Kontroller</h2>
        </div>
        <div class="card-content controls">
          <button id="cast-btn" class="btn btn-primary">
            ▶️ Starta nu
          </button>
          <button id="stop-btn" class="btn btn-danger">
            ⏹️ Stoppa
          </button>
        </div>
      </section>

      <!-- Preview -->
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
</html>`;

const PUBLIC_STYLE_CSS = `* {
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

/* Form elements */
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

/* Toggle switch */
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

/* Buttons */
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

/* Screensaver status */
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

/* Preview */
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

/* Footer */
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

/* Responsive */
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

/* Loading state */
.loading {
  pointer-events: none;
  opacity: 0.7;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}`;

const PUBLIC_APP_JS = `// API helpers
const API_BASE = '';

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
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
let state = {
  settings: {},
  devices: [],
  isLoading: false
};

// ============ UI Updates ============

function updateStatus(online, text) {
  const dot = elements.status.querySelector('.status-dot');
  dot.classList.toggle('online', online);
  elements.statusText.textContent = text;
}

function updateDeviceList(devices) {
  const select = elements.chromecastSelect;
  const currentValue = select.value;
  
  // Keep first option
  select.innerHTML = '<option value="">-- Välj enhet --</option>';
  
  devices.forEach(device => {
    const option = document.createElement('option');
    option.value = device.name;
    option.textContent = device.name;
    select.appendChild(option);
  });
  
  // Restore selection if still available
  if (currentValue && devices.find(d => d.name === currentValue)) {
    select.value = currentValue;
  } else if (state.settings.selectedChromecast) {
    select.value = state.settings.selectedChromecast;
  }
  
  elements.deviceCount.textContent = devices.length + ' enhet(er) hittade';
}

function updateScreensaverStatus(active) {
  const statusEl = elements.screensaverStatus;
  const indicator = statusEl.querySelector('.status-indicator');
  const text = statusEl.querySelector('span:last-child');
  
  indicator.classList.toggle('on', active);
  indicator.classList.toggle('off', !active);
  text.textContent = active ? 'Aktiv på TV' : 'Inaktiv';
}

function updatePreview(url) {
  const container = elements.previewContainer;
  
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
  
  if (loading) {
    elements.refreshBtn.classList.add('spin');
  } else {
    elements.refreshBtn.classList.remove('spin');
  }
}

// ============ API Calls ============

async function loadSettings() {
  try {
    const data = await api('/api/settings');
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
    const data = await api('/api/chromecasts');
    state.devices = data.devices || [];
    updateDeviceList(state.devices);
  } catch (error) {
    console.error('Failed to load devices:', error);
  }
}

async function loadStatus() {
  try {
    const data = await api('/api/status');
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
    const newSettings = { ...state.settings, ...updates };
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
    const data = await api('/api/chromecasts/refresh', { method: 'POST' });
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

elements.chromecastSelect.addEventListener('change', (e) => {
  saveSettings({ selectedChromecast: e.target.value || null });
});

elements.enabledToggle.addEventListener('change', (e) => {
  saveSettings({ enabled: e.target.checked });
});

elements.urlInput.addEventListener('change', (e) => {
  const url = e.target.value.trim();
  saveSettings({ url });
  updatePreview(url);
});

elements.refreshBtn.addEventListener('click', refreshDevices);
elements.castBtn.addEventListener('click', startCast);
elements.stopBtn.addEventListener('click', stopCast);

if (elements.copyUrlBtn) {
  elements.copyUrlBtn.addEventListener('click', () => {
    const url = elements.networkUrl?.textContent;
    if (url && url !== '-') {
      navigator.clipboard.writeText(url).then(() => {
        elements.copyUrlBtn.textContent = '✓ Kopierad!';
        setTimeout(() => {
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
  
  // Poll status every 10 seconds
  setInterval(loadStatus, 10000);
}

init();`;

const INSTALL_WINDOWS_PS1 = `# Chromecast Bridge - Windows Installer
# Högerklicka → "Kör med PowerShell som administratör"

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
    
    $PortInput = Read-Host "Port (standard: $DefaultPort)"
    if ([string]::IsNullOrWhiteSpace($PortInput)) {
        $Port = $DefaultPort
    } else {
        $Port = [int]$PortInput
    }
}

$AppDir = "$env:APPDATA\\$AppName"

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
New-Item -ItemType Directory -Path "$AppDir\\public" -Force | Out-Null
Write-Host "  $AppDir" -ForegroundColor Green

# 3. Kopiera bridge-filer
Write-Host "[3/6] Kopierar filer..." -ForegroundColor Yellow
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$mainFiles = @("index.js", "package.json", "package-lock.json")
foreach ($file in $mainFiles) {
    $sourcePath = Join-Path $ScriptDir $file
    if (Test-Path $sourcePath) {
        Copy-Item -Path $sourcePath -Destination $AppDir
        Write-Host "  Kopierade $file" -ForegroundColor Gray
    }
}

$publicDir = Join-Path $ScriptDir "public"
if (Test-Path $publicDir) {
    Copy-Item -Path "$publicDir\\*" -Destination "$AppDir\\public" -Recurse
    Write-Host "  Kopierade public-mapp" -ForegroundColor Gray
}

Write-Host "  Filer kopierade" -ForegroundColor Green

# 4. Installera dependencies
Write-Host "[4/6] Installerar dependencies..." -ForegroundColor Yellow
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
DEVICE_ID=$DeviceId
PORT=$Port
"@
$EnvContent | Out-File -FilePath "$AppDir\\.env" -Encoding UTF8
Write-Host "  Device ID: $DeviceId" -ForegroundColor Green
Write-Host "  Port: $Port" -ForegroundColor Green

# 6. Skapa Scheduled Task
Write-Host "[6/6] Skapar autostart-tjänst..." -ForegroundColor Yellow

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host ""
    Write-Host "VARNING: Kör scriptet som administratör för att bridge:n" -ForegroundColor Yellow
    Write-Host "ska kunna starta vid systemstart." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Högerklicka på install-windows.ps1 och välj:" -ForegroundColor Gray
    Write-Host "'Kör med PowerShell som administratör'" -ForegroundColor Cyan
    Write-Host ""
    Read-Host "Tryck Enter för att avsluta"
    exit 1
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$NodePath = (Get-Command node).Source

$Action = New-ScheduledTaskAction -Execute $NodePath -Argument "index.js" -WorkingDirectory $AppDir
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 9999)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description "Chromecast Bridge - $AppName" | Out-Null

Write-Host "  Scheduled Task skapad" -ForegroundColor Green

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
Write-Host "Device ID: $DeviceId" -ForegroundColor Yellow
Write-Host ""
Write-Host "För att avinstallera, kör: uninstall-windows.ps1" -ForegroundColor Gray
Write-Host ""
Read-Host "Tryck Enter för att stänga"`;

const UNINSTALL_WINDOWS_PS1 = `# Chromecast Bridge - Windows Uninstaller

$ErrorActionPreference = "SilentlyContinue"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Chromecast Bridge Avinstallation" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

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
    $folderPath = "$env:APPDATA\\$taskName"
    
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
Read-Host "Tryck Enter för att stänga"`;

const INSTALL_LINUX_SH = `#!/bin/bash
# Chromecast Bridge - Linux/Raspberry Pi Installer

set -e

DEFAULT_APP_NAME="chromecast-bridge"
DEFAULT_PORT=3000

echo ""
echo "========================================"
echo "  Chromecast Bridge Installer"
echo "========================================"
echo ""

echo "Om du vill köra flera bridges (t.ex. en per rum), ge varje ett unikt namn."
echo "Lämna tomt för standardinstallation."
echo ""
read -p "Instansnamn (tryck Enter för standard): " INSTANCE_NAME

if [ -z "$INSTANCE_NAME" ]; then
    APP_NAME="$DEFAULT_APP_NAME"
    SERVICE_NAME="$DEFAULT_APP_NAME"
    PORT=$DEFAULT_PORT
else
    CLEAN_NAME=$(echo "$INSTANCE_NAME" | tr -cd '[:alnum:]-' | tr '[:upper:]' '[:lower:]')
    APP_NAME="$DEFAULT_APP_NAME-$CLEAN_NAME"
    SERVICE_NAME="$DEFAULT_APP_NAME-$CLEAN_NAME"
    
    read -p "Port (standard: $DEFAULT_PORT): " PORT_INPUT
    if [ -z "$PORT_INPUT" ]; then
        PORT=$DEFAULT_PORT
    else
        PORT=$PORT_INPUT
    fi
fi

APP_DIR="$HOME/.local/share/$APP_NAME"

echo ""
echo "Installation:"
echo "  Namn: $APP_NAME"
echo "  Port: $PORT"
echo "  Mapp: $APP_DIR"
echo ""

if [ "$EUID" -eq 0 ]; then
    echo "❌ Kör inte detta script som root!"
    echo "   Använd: ./install-linux.sh"
    exit 1
fi

echo "[1/6] Kontrollerar Node.js..."
if ! command -v node &> /dev/null; then
    echo "  Node.js hittades inte. Försöker installera..."
    
    if command -v apt-get &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif command -v dnf &> /dev/null; then
        sudo dnf install -y nodejs
    elif command -v pacman &> /dev/null; then
        sudo pacman -S nodejs npm
    else
        echo "  ❌ Kunde inte installera Node.js automatiskt."
        echo "     Installera Node.js 18+ manuellt: https://nodejs.org"
        exit 1
    fi
fi
echo "  ✓ Node.js $(node --version)"

echo "[2/6] Skapar app-mapp..."
mkdir -p "$APP_DIR"
mkdir -p "$APP_DIR/public"
echo "  ✓ $APP_DIR"

echo "[3/6] Kopierar filer..."
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"

for file in index.js package.json package-lock.json; do
    if [ -f "$SCRIPT_DIR/$file" ]; then
        cp "$SCRIPT_DIR/$file" "$APP_DIR/"
        echo "  Kopierade $file"
    fi
done

if [ -d "$SCRIPT_DIR/public" ]; then
    cp -r "$SCRIPT_DIR/public/"* "$APP_DIR/public/"
    echo "  Kopierade public-mapp"
fi

echo "  ✓ Filer kopierade"

echo "[4/6] Installerar dependencies..."
cd "$APP_DIR"
npm install --production
echo "  ✓ Dependencies installerade"

echo "[5/6] Skapar konfiguration..."
DEVICE_ID=$(hostname | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]-')
if [ -n "$CLEAN_NAME" ]; then
    DEVICE_ID="$DEVICE_ID-$CLEAN_NAME"
fi

cat > "$APP_DIR/.env" << EOF
# Chromecast Bridge Configuration
DEVICE_ID=$DEVICE_ID
PORT=$PORT
EOF

echo "  ✓ Device ID: $DEVICE_ID"
echo "  ✓ Port: $PORT"

echo "[6/6] Skapar systemd service..."
mkdir -p "$HOME/.config/systemd/user"

cat > "$HOME/.config/systemd/user/$SERVICE_NAME.service" << EOF
[Unit]
Description=Chromecast Bridge - $APP_NAME
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$(which node) index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
EOF

loginctl enable-linger "$USER" 2>/dev/null || true

systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME"
systemctl --user start "$SERVICE_NAME"

echo "  ✓ Service skapad och startad"

IP_ADDR=$(hostname -I | awk '{print $1}')

echo ""
echo "========================================"
echo "  Installation klar!"
echo "========================================"
echo ""
echo "Öppna webbläsaren och gå till:"
echo ""
echo "  Lokal:  http://localhost:$PORT"
echo "  LAN:    http://$IP_ADDR:$PORT"
echo ""
echo "Device ID: $DEVICE_ID"
echo "Service:   $SERVICE_NAME"
echo ""
echo "Användbara kommandon:"
echo "  Status:  systemctl --user status $SERVICE_NAME"
echo "  Loggar:  journalctl --user -u $SERVICE_NAME -f"
echo "  Stoppa:  systemctl --user stop $SERVICE_NAME"
echo "  Starta:  systemctl --user start $SERVICE_NAME"
echo ""
echo "För att avinstallera: ./uninstall-linux.sh"
echo ""`;

const UNINSTALL_LINUX_SH = `#!/bin/bash
# Chromecast Bridge - Linux Uninstaller

echo ""
echo "========================================"
echo "  Chromecast Bridge Avinstallation"
echo "========================================"
echo ""

echo "Söker efter installerade bridges..."
echo ""

SERVICES=$(systemctl --user list-units --all --type=service | grep "chromecast-bridge" | awk '{print $1}' | sed 's/.service$//')
FOLDERS=$(find "$HOME/.local/share" -maxdepth 1 -type d -name "chromecast-bridge*" 2>/dev/null)

declare -a INSTALLATIONS

index=1

for service in $SERVICES; do
    folder="$HOME/.local/share/$service"
    echo "  [$index] $service"
    if [ -d "$folder" ]; then
        echo "      Mapp: $folder"
    fi
    INSTALLATIONS+=("$service|$folder")
    ((index++))
done

for folder in $FOLDERS; do
    folder_name=$(basename "$folder")
    exists=false
    for install in "\${INSTALLATIONS[@]}"; do
        if [[ "$install" == *"$folder_name"* ]]; then
            exists=true
            break
        fi
    done
    
    if [ "$exists" = false ]; then
        echo "  [$index] $folder_name (endast mapp)"
        echo "      Mapp: $folder"
        INSTALLATIONS+=("|$folder")
        ((index++))
    fi
done

if [ \${#INSTALLATIONS[@]} -eq 0 ]; then
    echo "Inga Chromecast Bridge-installationer hittades."
    exit 0
fi

echo ""
echo "  [A] Avinstallera ALLA"
echo "  [0] Avbryt"
echo ""

read -p "Välj installation att avinstallera: " choice

if [ -z "$choice" ] || [ "$choice" = "0" ]; then
    echo "Avbryter."
    exit 0
fi

declare -a TO_UNINSTALL

if [ "$choice" = "A" ] || [ "$choice" = "a" ]; then
    TO_UNINSTALL=("\${INSTALLATIONS[@]}")
else
    choice_num=$((choice - 1))
    if [ $choice_num -ge 0 ] && [ $choice_num -lt \${#INSTALLATIONS[@]} ]; then
        TO_UNINSTALL=("\${INSTALLATIONS[$choice_num]}")
    else
        echo "Ogiltigt val."
        exit 1
    fi
fi

echo ""
echo "Avinstallerar..."

for install in "\${TO_UNINSTALL[@]}"; do
    IFS='|' read -r service_name folder_path <<< "$install"
    
    if [ -n "$service_name" ]; then
        echo "  Stoppar service: $service_name"
        systemctl --user stop "$service_name" 2>/dev/null || true
        
        echo "  Inaktiverar service: $service_name"
        systemctl --user disable "$service_name" 2>/dev/null || true
        
        echo "  Tar bort service-fil"
        rm -f "$HOME/.config/systemd/user/$service_name.service"
    fi
    
    if [ -n "$folder_path" ] && [ -d "$folder_path" ]; then
        echo "  Tar bort mapp: $folder_path"
        rm -rf "$folder_path"
    fi
    
    display_name=\${service_name:-$(basename "$folder_path")}
    echo "  ✓ $display_name avinstallerad"
done

systemctl --user daemon-reload

echo ""
echo "========================================"
echo "  Avinstallation klar!"
echo "========================================"
echo ""`;

const README = `# Chromecast Bridge

Lokal bridge-tjänst för att styra Chromecast-skärmsläckare. Körs helt offline utan molnberoenden.

## Snabbinstallation

### Windows
1. Högerklicka på \`install-windows.ps1\`
2. Välj "Kör med PowerShell som administratör"
3. Följ instruktionerna

### Linux / Raspberry Pi
\`\`\`bash
chmod +x install-linux.sh
./install-linux.sh
\`\`\`

## Efter installation

Öppna http://localhost:3000 i webbläsaren för att:
- Välja vilken Chromecast som ska användas
- Ange URL för skärmsläckaren
- Aktivera automatisk skärmsläckare

## Avinstallation

- **Windows:** Kör \`uninstall-windows.ps1\`
- **Linux:** Kör \`./uninstall-linux.sh\`

## Konfiguration

All konfiguration lagras lokalt i \`config.json\`. Ingen data skickas till molnet.
`;

// Collect all files
const files: Record<string, string> = {
  "index.js": INDEX_JS,
  "package.json": PACKAGE_JSON,
  ".env.example": ENV_EXAMPLE,
  "public/index.html": PUBLIC_INDEX_HTML,
  "public/style.css": PUBLIC_STYLE_CSS,
  "public/app.js": PUBLIC_APP_JS,
  "install-windows.ps1": INSTALL_WINDOWS_PS1,
  "uninstall-windows.ps1": UNINSTALL_WINDOWS_PS1,
  "install-linux.sh": INSTALL_LINUX_SH,
  "uninstall-linux.sh": UNINSTALL_LINUX_SH,
  "README.md": README,
};

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const zipData = createZip(files);

    return new Response(zipData.buffer as ArrayBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=chromecast-bridge.zip",
        "Content-Length": zipData.length.toString(),
      },
    });
  } catch (error) {
    console.error("Error creating zip:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
