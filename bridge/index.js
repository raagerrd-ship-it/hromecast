require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const Chromecasts = require('chromecasts');
const Bonjour = require('bonjour-service').Bonjour;

// Version - keep in sync with src/config/version.ts
const BRIDGE_VERSION = '1.0.0';

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
  const info = `Chromecast Bridge - Nätverksinfo
================================
Startad: ${new Date().toLocaleString('sv-SE')}
Device ID: ${DEVICE_ID}

Åtkomst från denna dator:
  http://localhost:${PORT}

Åtkomst från mobil/annan enhet:
  http://${ip}:${PORT}

mDNS (om stöds):
  http://${DEVICE_ID}.local:${PORT}
`;
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
        console.log(`✅ Found: ${name} at ${host}:${port}`);
      }
    });
    
    setTimeout(() => {
      browser.stop();
      discoveredDevices = foundDevices;
      console.log(`📡 Discovery complete: ${foundDevices.length} device(s)`);
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
      reject(new Error(`Device "${chromecastName}" not found`));
      return;
    }
    
    currentDevice = player;
    console.log(`📺 Casting to ${chromecastName}: ${url}`);
    
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
      reject(new Error(`Device "${chromecastName}" not found`));
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
  const url = new URL(req.url, `http://localhost:${PORT}`);
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
          version: BRIDGE_VERSION,
          deviceId: DEVICE_ID,
          port: PORT,
          networkIP: networkIP,
          networkUrl: `http://${networkIP}:${PORT}`,
          mdnsUrl: `http://${DEVICE_ID}.local:${PORT}`,
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
  console.log(`📍 Device ID: ${DEVICE_ID}`);
  console.log('');
  console.log('🌐 Åtkomst:');
  console.log(`   Lokal:    http://localhost:${PORT}`);
  console.log(`   Nätverk:  http://${networkIP}:${PORT}`);
  console.log(`   mDNS:     http://${DEVICE_ID}.local:${PORT}`);
  console.log('');
  
  // Write network info to file (for background services)
  writeNetworkInfo();
  console.log(`📄 Nätverksinfo sparad till: network-info.txt`);
  console.log('');
  
  // Initial discovery
  await discoverDevices();
  
  // Start chromecasts library discovery
  chromecasts.on('update', (player) => {
    console.log(`📡 Chromecasts lib found: ${player.name}`);
  });
  
  // Start HTTP server
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running`);
    
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
      console.log(`📡 mDNS publicerad: ${DEVICE_ID}.local`);
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
    console.log('\n👋 Shutting down...');
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    bonjour.destroy();
    server.close();
    process.exit(0);
  });
}

main().catch(console.error);
