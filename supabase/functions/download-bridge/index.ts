import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "Content-Disposition",
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
// Version is injected dynamically from get-version endpoint
// ============================================================================

// Placeholder that will be replaced with actual version at download time
const VERSION_PLACEHOLDER = '__BRIDGE_VERSION__';

const INDEX_JS = `require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const castv2 = require('castv2');
const Bonjour = require('bonjour-service').Bonjour;

// Version - automatically set at download time
const BRIDGE_VERSION = '${VERSION_PLACEHOLDER}';

// Configuration
const CONFIG_FILE = path.join(__dirname, 'config.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = parseInt(process.env.PORT || '3000');
const DEVICE_ID = process.env.DEVICE_ID || 'default-bridge';
const CUSTOM_APP_ID = 'FE376873';
const BACKDROP_APP_ID = 'E8C28D3C';

// Initialize Bonjour
const bonjour = new Bonjour();

// State
let discoveredDevices = [];
let client = null;
let keepAliveInterval = null;
let screensaverActive = false;
let updateInProgress = false;

// In-memory log buffer (keep last 100 entries)
const LOG_BUFFER_SIZE = 100;
let logBuffer = [];

// Default config with timing settings (all in seconds unless noted)
const DEFAULT_CONFIG = {
  enabled: false,
  url: '',
  selectedChromecast: null,
  screensaverCheckInterval: 60,
  keepAliveInterval: 5,
  discoveryInterval: 30,
  discoveryTimeout: 8,
  discoveryEarlyResolve: 3,
  idleStatusTimeout: 5,
  castRetryDelay: 2,
  castMaxRetries: 3
};

// ============ Structured Logging ============

function addToLogBuffer(level, msg, args) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message: msg,
    args: args.length > 0 ? args : undefined
  };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) {
    logBuffer.shift();
  }
}

const log = {
  info: (msg, ...args) => {
    console.log(\`[INFO] \${new Date().toISOString()} - \${msg}\`, ...args);
    addToLogBuffer('info', msg, args);
  },
  warn: (msg, ...args) => {
    console.warn(\`[WARN] \${new Date().toISOString()} - \${msg}\`, ...args);
    addToLogBuffer('warn', msg, args);
  },
  error: (msg, ...args) => {
    console.error(\`[ERROR] \${new Date().toISOString()} - \${msg}\`, ...args);
    addToLogBuffer('error', msg, args);
  },
  debug: (msg, ...args) => {
    if (process.env.DEBUG) {
      console.log(\`[DEBUG] \${new Date().toISOString()} - \${msg}\`, ...args);
      addToLogBuffer('debug', msg, args);
    }
  }
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
    log.info('🔍 Scanning for Chromecast devices...');
    
    const browser = bonjour.find({ type: 'googlecast' });
    const foundDevices = [];
    let resolved = false;
    
    browser.on('up', (service) => {
      const name = service.name || service.txt?.fn || 'Unknown';
      const host = service.addresses?.[0] || service.referer?.address || service.host;
      const port = service.port || 8009;
      
      if (host && !foundDevices.find(d => d.host === host)) {
        const device = { name, host, port };
        foundDevices.push(device);
        log.info(\`✅ Found: \${name} at \${host}:\${port}\`);
      }
    });
    
    const config = loadConfig();
    const earlyResolveMs = (config.discoveryEarlyResolve || 3) * 1000;
    const maxTimeoutMs = (config.discoveryTimeout || 8) * 1000;
    
    const earlyResolveTimeout = setTimeout(() => {
      if (foundDevices.length > 0 && !resolved) {
        resolved = true;
        browser.stop();
        discoveredDevices = foundDevices;
        log.info(\`📡 Discovery complete (early): \${foundDevices.length} device(s)\`);
        resolve(foundDevices);
      }
    }, earlyResolveMs);
    
    setTimeout(() => {
      clearTimeout(earlyResolveTimeout);
      if (!resolved) {
        resolved = true;
        browser.stop();
        discoveredDevices = foundDevices;
        log.info(\`📡 Discovery complete: \${foundDevices.length} device(s)\`);
        resolve(foundDevices);
      }
    }, maxTimeoutMs);
  });
}

// ============ Chromecast Control using raw castv2 ============

function findDevice(name) {
  return discoveredDevices.find(d => d.name === name) || null;
}

async function isChromecastIdle(deviceName) {
  const device = findDevice(deviceName);
  if (!device) {
    log.warn('⚠️ Device not found for idle check:', deviceName);
    return true;
  }
  
  const config = loadConfig();
  const timeoutMs = (config.idleStatusTimeout || 5) * 1000;
  
  return new Promise((resolve) => {
    const checkClient = new castv2.Client();
    
    const timeout = setTimeout(() => {
      log.warn('⏱️ Idle check timeout');
      checkClient.close();
      resolve(true);
    }, timeoutMs);
    
    checkClient.on('error', (err) => {
      clearTimeout(timeout);
      log.error(\`❌ Idle check error: \${err.message}\`);
      checkClient.close();
      resolve(true);
    });
    
    checkClient.connect(device.host, () => {
      const connection = checkClient.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
      const receiver = checkClient.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.receiver', 'JSON');
      
      connection.send({ type: 'CONNECT' });
      receiver.send({ type: 'GET_STATUS', requestId: 1 });
      
      receiver.on('message', (data) => {
        if (data.type === 'RECEIVER_STATUS') {
          clearTimeout(timeout);
          connection.send({ type: 'CLOSE' });
          checkClient.close();
          
          const apps = data.status?.applications || [];
          const otherApps = apps.filter(app => app.appId !== BACKDROP_APP_ID && app.appId !== CUSTOM_APP_ID);
          const ourAppRunning = apps.some(app => app.appId === CUSTOM_APP_ID);
          
          if (ourAppRunning) {
            log.debug('Our app is running');
            screensaverActive = true;
            resolve(false);
          } else if (otherApps.length === 0) {
            log.debug('Device is idle');
            resolve(true);
          } else {
            log.debug(\`Device busy with: \${otherApps.map(a => a.displayName || a.appId).join(', ')}\`);
            resolve(false);
          }
        }
      });
    });
  });
}

async function castMedia(chromecastName, url) {
  const device = findDevice(chromecastName);
  if (!device) {
    throw new Error(\`Device "\${chromecastName}" not found\`);
  }
  
  log.info(\`📺 Casting to \${chromecastName}: \${url}\`);
  
  return new Promise((resolve, reject) => {
    client = new castv2.Client();
    let heartbeatInterval = null;
    let launchTimeout = null;
    
    const cleanup = () => {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      if (launchTimeout) {
        clearTimeout(launchTimeout);
        launchTimeout = null;
      }
    };
    
    client.on('error', (err) => {
      log.error(\`❌ Connection error: \${err.message}\`);
      cleanup();
      client.close();
      reject(err);
    });
    
    client.on('close', () => {
      log.debug('Connection closed');
      cleanup();
    });
    
    client.connect(device.host, () => {
      log.info('✅ Connected to Chromecast');
      
      const connection = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
      const heartbeat = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.heartbeat', 'JSON');
      const receiver = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.receiver', 'JSON');
      
      connection.send({ type: 'CONNECT' });
      
      heartbeatInterval = setInterval(() => {
        try {
          heartbeat.send({ type: 'PING' });
        } catch (e) {
          log.error('Heartbeat failed:', e.message);
          cleanup();
        }
      }, 5000);
      
      heartbeat.on('message', () => {});
      
      log.info('📡 Getting receiver status...');
      receiver.send({ type: 'GET_STATUS', requestId: 1 });
      
      launchTimeout = setTimeout(() => {
        log.error('⏱️ Timeout waiting for receiver response (120s)');
        cleanup();
        client.close();
        reject(new Error('Receiver timeout'));
      }, 120000);
      
      let appLaunched = false;
      let mediaLoaded = false;
      
      receiver.on('message', async (data) => {
        log.debug('📨 Receiver message:', JSON.stringify(data));
        
        if (data.type === 'LAUNCH_ERROR') {
          cleanup();
          log.error(\`❌ Failed to launch app: \${data.reason}\`);
          client.close();
          reject(new Error(\`Custom receiver not available: \${data.reason}\`));
          return;
        }
        
        if (data.type === 'RECEIVER_STATUS') {
          if (!appLaunched) {
            if (data.status && data.status.applications && data.status.applications.length > 0) {
              const runningApp = data.status.applications[0];
              
              if (runningApp.appId !== CUSTOM_APP_ID && runningApp.appId !== BACKDROP_APP_ID) {
                log.warn(\`⚠️ Another app running: \${runningApp.displayName}\`);
                cleanup();
                client.close();
                reject(new Error(\`Another app running: \${runningApp.displayName}\`));
                return;
              }
            }
            
            log.info(\`🚀 Launching custom receiver app: \${CUSTOM_APP_ID}\`);
            receiver.send({ type: 'LAUNCH', appId: CUSTOM_APP_ID, requestId: 2 });
            appLaunched = true;
            return;
          }
          
          if (!mediaLoaded && data.status && data.status.applications && data.status.applications.length > 0) {
            const app = data.status.applications[0];
            
            if (app.appId !== CUSTOM_APP_ID) {
              log.warn('⚠️ Wrong app detected during cast');
              return;
            }
            
            // Mark as loaded immediately to prevent duplicates
            mediaLoaded = true;
            clearTimeout(launchTimeout);
            
            log.info(\`📱 App launched: \${app.displayName} (\${app.appId})\`);
            
            const sessionId = app.sessionId;
            const transportId = app.transportId;
            
            const appConnection = client.createChannel('sender-0', transportId, 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
            appConnection.send({ type: 'CONNECT' });
            
            const media = client.createChannel('sender-0', transportId, 'urn:x-cast:com.google.cast.media', 'JSON');
            
            log.info(\`📺 Loading URL: \${url}\`);
            media.send({
              type: 'LOAD',
              requestId: 5,
              sessionId: sessionId,
              media: {
                contentId: url,
                contentType: 'text/html',
                streamType: 'LIVE',
                metadata: {
                  type: 0,
                  metadataType: 0,
                  title: 'Website Viewer'
                }
              },
              autoplay: true
            });
            
            log.info('✅ Cast successful');
            screensaverActive = true;
            keepAliveInterval = heartbeatInterval;
            
            resolve({ success: true });
            
            media.on('message', (data) => {
              log.debug('📨 Media message:', JSON.stringify(data));
            });
          }
        }
      });
    });
  });
}

async function castMediaWithRetry(chromecastName, url) {
  const config = loadConfig();
  const maxRetries = config.castMaxRetries || 3;
  const baseDelay = (config.castRetryDelay || 2) * 1000;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await castMedia(chromecastName, url);
    } catch (error) {
      log.warn(\`⚠️ Cast attempt \${attempt}/\${maxRetries} failed: \${error.message}\`);
      if (attempt === maxRetries) throw error;
      const delay = baseDelay * attempt;
      log.info(\`🔄 Retrying in \${delay / 1000}s...\`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function stopCast(chromecastName) {
  const device = findDevice(chromecastName);
  if (!device) {
    throw new Error(\`Device "\${chromecastName}" not found\`);
  }
  
  return new Promise((resolve, reject) => {
    const stopClient = new castv2.Client();
    
    stopClient.on('error', (err) => {
      log.error(\`❌ Stop error: \${err.message}\`);
      stopClient.close();
      reject(err);
    });
    
    stopClient.connect(device.host, () => {
      const connection = stopClient.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
      const receiver = stopClient.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.receiver', 'JSON');
      
      connection.send({ type: 'CONNECT' });
      receiver.send({ type: 'STOP', requestId: 1 });
      
      setTimeout(() => {
        connection.send({ type: 'CLOSE' });
        stopClient.close();
        screensaverActive = false;
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
          keepAliveInterval = null;
        }
        log.info('⏹️ Cast stopped');
        resolve({ success: true });
      }, 1000);
    });
  });
}

// ============ Auto-Screensaver ============

async function checkAndActivateScreensaver() {
  const config = loadConfig();
  if (!config.enabled || !config.url || !config.selectedChromecast) return;
  
  // Skip if update is in progress
  if (updateInProgress) {
    log.debug('Update in progress, skipping screensaver check');
    return;
  }
  
  const idle = await isChromecastIdle(config.selectedChromecast);
  if (idle && !screensaverActive) {
    log.info('💤 Device idle, activating screensaver...');
    try {
      await castMediaWithRetry(config.selectedChromecast, config.url);
    } catch (error) {
      log.error('Failed to activate screensaver:', error.message);
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
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  if (pathname.startsWith('/api/')) {
    try {
      if (req.method === 'GET' && pathname === '/api/settings') {
        const config = loadConfig();
        sendJson(res, { ...config, deviceId: DEVICE_ID, screensaverActive });
        return;
      }
      
      if (req.method === 'POST' && pathname === '/api/settings') {
        const body = await parseBody(req);
        const config = loadConfig();
        const newConfig = { ...config, ...body };
        saveConfig(newConfig);
        sendJson(res, { success: true, config: newConfig });
        return;
      }
      
      if (req.method === 'GET' && pathname === '/api/chromecasts') {
        sendJson(res, { devices: discoveredDevices });
        return;
      }
      
      if (req.method === 'POST' && pathname === '/api/chromecasts/refresh') {
        const devices = await discoverDevices();
        sendJson(res, { devices });
        return;
      }
      
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
      
      if (req.method === 'POST' && pathname === '/api/stop') {
        const config = loadConfig();
        if (config.selectedChromecast) {
          await stopCast(config.selectedChromecast);
        }
        sendJson(res, { success: true });
        return;
      }
      
      if (req.method === 'GET' && pathname === '/api/status') {
        const config = loadConfig();
        const networkIP = getNetworkIP();
        sendJson(res, {
          version: BRIDGE_VERSION,
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
      
      if (req.method === 'GET' && pathname === '/api/logs') {
        sendJson(res, { logs: logBuffer });
        return;
      }
      
      if (req.method === 'DELETE' && pathname === '/api/logs') {
        logBuffer = [];
        sendJson(res, { success: true });
        return;
      }
      
      if (req.method === 'POST' && pathname === '/api/restart') {
        log.info('🔄 Restart requested via API');
        sendJson(res, { success: true, message: 'Restarting...' });
        setTimeout(() => { process.exit(0); }, 500);
        return;
      }
      
      if (req.method === 'POST' && pathname === '/api/prepare-update') {
        log.info('🔄 Preparing for update - pausing all activity...');
        
        // Set update flag to prevent new screensaver activations
        updateInProgress = true;
        
        // Stop active cast if running
        const config = loadConfig();
        if (screensaverActive && config.selectedChromecast) {
          try {
            log.info('⏹️ Stopping active screensaver for update...');
            await stopCast(config.selectedChromecast);
          } catch (error) {
            log.warn(\`⚠️ Could not stop cast: \${error.message}\`);
          }
        }
        
        // Clean up client connection
        if (client) {
          try { client.close(); } catch(e) {}
          client = null;
        }
        
        // Give Chromecast time to return to backdrop
        await new Promise(r => setTimeout(r, 2000));
        
        log.info('✅ Ready for update - all activity paused');
        sendJson(res, { 
          success: true, 
          message: 'Bridge paused for update',
          wasActive: screensaverActive 
        });
        return;
      }
      
      sendJson(res, { error: 'Not found' }, 404);
    } catch (error) {
      sendJson(res, { error: error.message }, 500);
    }
    return;
  }
  
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(PUBLIC_DIR, filePath);
  
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  
  serveStatic(filePath, res);
});

// ============ Main ============

async function main() {
  log.info(\`🚀 Chromecast Bridge v\${BRIDGE_VERSION} starting...\`);
  log.info(\`📋 Device ID: \${DEVICE_ID}\`);
  
  writeNetworkInfo();
  
  server.listen(PORT, '0.0.0.0', () => {
    log.info(\`🚀 Server running on http://localhost:\${PORT}\`);
  });
  
  bonjour.publish({
    name: \`\${os.hostname()}-\${DEVICE_ID}\`,
    type: 'http',
    port: PORT,
    txt: { path: '/', version: BRIDGE_VERSION }
  });
  log.info(\`📡 mDNS published: \${os.hostname()}-\${DEVICE_ID}.local\`);
  
  await discoverDevices();
  
  const config = loadConfig();
  const discoveryMs = (config.discoveryInterval || 30) * 60 * 1000;
  const screensaverMs = (config.screensaverCheckInterval || 60) * 1000;
  
  setInterval(discoverDevices, discoveryMs);
  setInterval(checkAndActivateScreensaver, screensaverMs);
  
  process.on('SIGINT', () => {
    log.info('👋 Shutting down...');
    bonjour.unpublishAll();
    server.close();
    if (client) client.close();
    process.exit(0);
  });
}

main().catch((error) => {
  log.error('Fatal error:', error.message);
  process.exit(1);
});`;

const PACKAGE_JSON = `{
  "name": "chromecast-bridge",
  "version": "1.4.0",
  "description": "Local service for controlling Chromecast screensaver",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "bonjour-service": "^1.3.0",
    "castv2": "^0.1.10",
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
      <div class="header-title">
        <h1>📺 Chromecast Bridge</h1>
        <span class="version-badge" id="version-badge">v...</span>
      </div>
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

      <!-- Timing Settings -->
      <section class="card settings-card">
        <div class="card-header">
          <h2>⏱️ Tidsinställningar</h2>
          <button id="toggle-settings-btn" class="btn btn-secondary btn-small">Visa</button>
        </div>
        <div class="card-content settings-content" id="settings-content" style="display: none;">
          <div class="settings-grid">
            <div class="form-group">
              <label for="screensaver-check-input">Screensaver-kontroll (sek)</label>
              <input type="number" id="screensaver-check-input" min="10" max="600" step="5" value="60">
              <span class="hint">Hur ofta kontrollera om enheten är ledig</span>
            </div>
            <div class="form-group">
              <label for="keep-alive-input">Keep-alive ping (sek)</label>
              <input type="number" id="keep-alive-input" min="1" max="60" step="1" value="5">
              <span class="hint">Intervall för session-kontroll</span>
            </div>
            <div class="form-group">
              <label for="discovery-interval-input">Enhetsökning (min)</label>
              <input type="number" id="discovery-interval-input" min="5" max="120" step="5" value="30">
              <span class="hint">Hur ofta söka efter nya enheter</span>
            </div>
            <div class="form-group">
              <label for="discovery-timeout-input">Sök-timeout (sek)</label>
              <input type="number" id="discovery-timeout-input" min="3" max="30" step="1" value="8">
              <span class="hint">Max tid för enhetssökning</span>
            </div>
            <div class="form-group">
              <label for="cast-retry-input">Retry-fördröjning (sek)</label>
              <input type="number" id="cast-retry-input" min="1" max="30" step="1" value="2">
              <span class="hint">Bas-fördröjning vid misslyckad cast</span>
            </div>
            <div class="form-group">
              <label for="cast-max-retries-input">Max försök</label>
              <input type="number" id="cast-max-retries-input" min="1" max="100" step="1" value="3">
              <span class="hint">Antal försök innan ge upp</span>
            </div>
          </div>
          <div class="settings-actions">
            <button id="restart-btn" class="btn btn-warning" title="Starta om bridge för att tillämpa ändringar">🔄 Starta om bridge</button>
          </div>
          <p class="hint settings-note">⚠️ Ändringar kräver omstart av bridge för full effekt</p>
        </div>
      </section>

      <!-- Logs -->
      <section class="card logs-card">
        <div class="card-header">
          <h2>📋 Loggar</h2>
          <button id="clear-logs-btn" class="btn btn-secondary btn-small">🗑️ Rensa</button>
        </div>
        <div class="card-content">
          <div class="logs-container" id="logs-container">
            <p class="logs-placeholder">Inga loggar ännu...</p>
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
  --warning: #eab308;
  --warning-hover: #ca8a04;
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

.header-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.version-badge {
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-muted);
  font-family: monospace;
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

/* Settings grid */
.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
}

.settings-grid .form-group {
  margin-bottom: 0;
}

.settings-grid input[type="number"] {
  width: 100%;
}

.settings-note {
  margin-top: 1rem;
  padding: 0.75rem;
  background: rgba(234, 179, 8, 0.1);
  border-left: 2px solid #eab308;
  border-radius: 4px;
}

.settings-actions {
  margin-top: 1rem;
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 480px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
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

.btn-warning {
  background: var(--warning);
  color: #000;
}

.btn-warning:hover {
  background: var(--warning-hover);
}

.btn.needs-restart {
  background: var(--danger);
  color: white;
  animation: pulse-attention 1.5s ease-in-out infinite;
}

.btn.needs-restart:hover {
  background: var(--danger-hover);
}

@keyframes pulse-attention {
  0%, 100% { 
    box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7);
  }
  50% { 
    box-shadow: 0 0 0 8px rgba(239, 68, 68, 0);
  }
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.header-buttons {
  display: flex;
  gap: 0.5rem;
  align-items: center;
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
}

/* Logs */
.logs-container {
  max-height: 300px;
  overflow-y: auto;
  background: var(--bg);
  border-radius: 8px;
  padding: 0.5rem;
  font-family: monospace;
  font-size: 0.75rem;
}

.logs-placeholder {
  color: var(--text-muted);
  text-align: center;
  padding: 1rem;
}

.log-entry {
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  margin-bottom: 0.25rem;
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
}

.log-entry:last-child {
  margin-bottom: 0;
}

.log-entry.info {
  background: rgba(59, 130, 246, 0.1);
  border-left: 2px solid var(--primary);
}

.log-entry.warn {
  background: rgba(234, 179, 8, 0.1);
  border-left: 2px solid #eab308;
}

.log-entry.error {
  background: rgba(239, 68, 68, 0.1);
  border-left: 2px solid var(--danger);
}

.log-entry.debug {
  background: rgba(161, 161, 170, 0.1);
  border-left: 2px solid var(--text-muted);
}

.log-time {
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.log-level {
  font-weight: 600;
  text-transform: uppercase;
  width: 40px;
  flex-shrink: 0;
}

.log-entry.info .log-level { color: var(--primary); }
.log-entry.warn .log-level { color: #eab308; }
.log-entry.error .log-level { color: var(--danger); }
.log-entry.debug .log-level { color: var(--text-muted); }

.log-message {
  flex: 1;
  word-break: break-word;
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
  versionBadge: document.getElementById('version-badge'),
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
  copyUrlBtn: document.getElementById('copy-url-btn'),
  logsContainer: document.getElementById('logs-container'),
  clearLogsBtn: document.getElementById('clear-logs-btn'),
  // Settings elements
  toggleSettingsBtn: document.getElementById('toggle-settings-btn'),
  settingsContent: document.getElementById('settings-content'),
  screensaverCheckInput: document.getElementById('screensaver-check-input'),
  keepAliveInput: document.getElementById('keep-alive-input'),
  discoveryIntervalInput: document.getElementById('discovery-interval-input'),
  discoveryTimeoutInput: document.getElementById('discovery-timeout-input'),
  castRetryInput: document.getElementById('cast-retry-input'),
  castMaxRetriesInput: document.getElementById('cast-max-retries-input')
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

function formatLogTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function updateLogs(logs) {
  const container = elements.logsContainer;
  
  if (!logs || logs.length === 0) {
    container.innerHTML = '<p class="logs-placeholder">Inga loggar ännu...</p>';
    return;
  }
  
  // Show newest first
  const reversedLogs = [...logs].reverse();
  
  container.innerHTML = reversedLogs.map(log => 
    '<div class="log-entry ' + log.level + '">' +
      '<span class="log-time">' + formatLogTime(log.timestamp) + '</span>' +
      '<span class="log-level">' + log.level + '</span>' +
      '<span class="log-message">' + log.message + '</span>' +
    '</div>'
  ).join('');
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
    
    // Load timing settings
    if (elements.screensaverCheckInput) {
      elements.screensaverCheckInput.value = data.screensaverCheckInterval || 60;
    }
    if (elements.keepAliveInput) {
      elements.keepAliveInput.value = data.keepAliveInterval || 5;
    }
    if (elements.discoveryIntervalInput) {
      elements.discoveryIntervalInput.value = data.discoveryInterval || 30;
    }
    if (elements.discoveryTimeoutInput) {
      elements.discoveryTimeoutInput.value = data.discoveryTimeout || 8;
    }
    if (elements.castRetryInput) {
      elements.castRetryInput.value = data.castRetryDelay || 2;
    }
    if (elements.castMaxRetriesInput) {
      elements.castMaxRetriesInput.value = data.castMaxRetries || 3;
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
    
    // Update version badge
    if (data.version && elements.versionBadge) {
      elements.versionBadge.textContent = 'v' + data.version;
    }
    
    // Update network URL display
    if (data.networkUrl && elements.networkUrl) {
      elements.networkUrl.textContent = data.networkUrl;
    }
    if (data.mdnsUrl && elements.mdnsUrl) {
      elements.mdnsUrl.textContent = data.mdnsUrl;
    }
    
    // Also load logs
    const logsData = await api('/api/logs');
    updateLogs(logsData.logs || []);
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
    // Spara URL:en först om den har ändrats
    const currentUrl = elements.urlInput.value.trim();
    if (currentUrl && currentUrl !== state.settings.url) {
      await saveSettings({ url: currentUrl });
      updatePreview(currentUrl);
    }
    
    // Kontrollera att vi har en URL att casta
    if (!currentUrl) {
      alert('Ange en URL att visa först!');
      setLoading(false);
      return;
    }
    
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

// Restart bridge
const restartBtn = document.getElementById('restart-btn');
let settingsModified = false;

function markSettingsModified() {
  settingsModified = true;
  if (restartBtn) {
    restartBtn.classList.add('needs-restart');
    restartBtn.textContent = '🔄 Starta om (krävs)';
  }
}

function clearSettingsModified() {
  settingsModified = false;
  if (restartBtn) {
    restartBtn.classList.remove('needs-restart');
    restartBtn.textContent = '🔄 Starta om';
  }
}

if (restartBtn) {
  restartBtn.addEventListener('click', async () => {
    if (!confirm('Vill du starta om bridge-tjänsten? Detta krävs för att timing-ändringar ska träda i kraft.')) {
      return;
    }
    
    restartBtn.disabled = true;
    restartBtn.textContent = '⏳ Startar om...';
    
    try {
      await api('/api/restart', { method: 'POST' });
      updateStatus(false, 'Startar om...');
      
      const pollReconnect = () => {
        setTimeout(async () => {
          try {
            await api('/api/status');
            updateStatus(true, 'Ansluten');
            restartBtn.disabled = false;
            clearSettingsModified();
            await loadSettings();
            await loadDevices();
            await loadStatus();
          } catch (e) {
            pollReconnect();
          }
        }, 1000);
      };
      pollReconnect();
    } catch (error) {
      console.error('Restart failed:', error);
      restartBtn.disabled = false;
      restartBtn.textContent = '🔄 Starta om';
    }
  });
}

// Toggle settings visibility
if (elements.toggleSettingsBtn && elements.settingsContent) {
  elements.toggleSettingsBtn.addEventListener('click', () => {
    const isHidden = elements.settingsContent.style.display === 'none';
    elements.settingsContent.style.display = isHidden ? 'block' : 'none';
    elements.toggleSettingsBtn.textContent = isHidden ? 'Dölj' : 'Visa';
  });
}

// Settings input handlers
const settingsInputs = [
  { el: elements.screensaverCheckInput, key: 'screensaverCheckInterval' },
  { el: elements.keepAliveInput, key: 'keepAliveInterval' },
  { el: elements.discoveryIntervalInput, key: 'discoveryInterval' },
  { el: elements.discoveryTimeoutInput, key: 'discoveryTimeout' },
  { el: elements.castRetryInput, key: 'castRetryDelay' },
  { el: elements.castMaxRetriesInput, key: 'castMaxRetries' }
];

settingsInputs.forEach(function(item) {
  if (item.el) {
    item.el.addEventListener('change', function(e) {
      const value = parseInt(e.target.value, 10);
      if (!isNaN(value)) {
        const update = {};
        update[item.key] = value;
        saveSettings(update);
        markSettingsModified();
      }
    });
  }
});

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

if (elements.clearLogsBtn) {
  elements.clearLogsBtn.addEventListener('click', async () => {
    try {
      await api('/api/logs', { method: 'DELETE' });
      updateLogs([]);
    } catch (error) {
      console.error('Failed to clear logs:', error);
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

const INSTALL_WINDOWS_PS1 = `# Chromecast Bridge - Windows Installer (Multi-Instance Support)
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
            Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File \`"$scriptPath\`" -Elevated" -Verb RunAs
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

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask -and $existingTask.State -eq "Running") {
    Write-Host "  Pausar befintlig bridge..." -ForegroundColor Gray
    
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:$Port/api/prepare-update" -Method Post -TimeoutSec 5 -ErrorAction Stop
        Write-Host "  Bridge pausad gracefully" -ForegroundColor Green
        Start-Sleep -Seconds 2
    } catch {
        Write-Host "  Kunde inte pausa gracefully, fortsatter anda..." -ForegroundColor Yellow
    }
    
    Write-Host "  Stoppar befintlig task..." -ForegroundColor Gray
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

# 3. Skapa app-mapp
Write-Host "[3/8] Skapar app-mapp..." -ForegroundColor Yellow
if (Test-Path $AppDir) {
    Write-Host "  Tar bort befintlig installation..." -ForegroundColor Gray
    Remove-Item -Path $AppDir -Recurse -Force
}
New-Item -ItemType Directory -Path $AppDir -Force | Out-Null
New-Item -ItemType Directory -Path "$AppDir\\public" -Force | Out-Null
Write-Host "  $AppDir" -ForegroundColor Green

# 4. Kopiera bridge-filer
Write-Host "[4/8] Kopierar filer..." -ForegroundColor Yellow
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
$EnvContent | Out-File -FilePath "$AppDir\\.env" -Encoding UTF8
Write-Host "  Device ID: $DeviceId" -ForegroundColor Green
Write-Host "  Port: $Port" -ForegroundColor Green

# 7. Skapa Scheduled Task (kors vid systemstart som SYSTEM)
Write-Host "[7/8] Skapar autostart-tjanst..." -ForegroundColor Yellow

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$NodePath = (Get-Command node).Source

$Action = New-ScheduledTaskAction -Execute $NodePath -Argument "index.js" -WorkingDirectory $AppDir
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 9999)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description "Chromecast Bridge - $AppName (startar vid systemstart)" | Out-Null

$createdTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $createdTask) {
    throw "Kunde inte skapa scheduled task '$TaskName'. Kontrollera att du har admin-rattigheter."
}
Write-Host "  Scheduled Task skapad (kors vid systemstart)" -ForegroundColor Green

# 8. Oppna brandvagg for mobil-atkomst
Write-Host "[8/8] Konfigurerar brandvagg..." -ForegroundColor Yellow
$FirewallRuleName = "Chromecast Bridge - $AppName (Port $Port)"

Remove-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue

try {
    New-NetFirewallRule -DisplayName $FirewallRuleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private,Domain -Description "Tillater atkomst till Chromecast Bridge fran andra enheter pa narverket" | Out-Null
    Write-Host "  Brandvaggsregel skapad for port $Port" -ForegroundColor Green
} catch {
    Write-Host "  Kunde inte skapa brandvaggsregel: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "  Du kan behova oppna port $Port manuellt i Windows-brandvaggen" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Startar bridge..." -ForegroundColor Yellow
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

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
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")`;

const UNINSTALL_WINDOWS_PS1 = `# Chromecast Bridge - Windows Uninstaller

# Fix console encoding
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "SilentlyContinue"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Chromecast Bridge Avinstallation" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Soker efter installerade bridges..." -ForegroundColor Yellow
Write-Host ""

$Tasks = Get-ScheduledTask | Where-Object { $_.TaskName -like "ChromecastBridge*" }
$Folders = Get-ChildItem "$env:APPDATA" -Directory | Where-Object { $_.Name -like "ChromecastBridge*" }

if ($Tasks.Count -eq 0 -and $Folders.Count -eq 0) {
    Write-Host "Inga Chromecast Bridge-installationer hittades." -ForegroundColor Gray
    Read-Host "Tryck Enter for att avsluta"
    exit 0
}

Write-Host "Hittade foljande installationer:" -ForegroundColor White
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

$choice = Read-Host "Valj installation att avinstallera"

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
    Write-Host "  [OK] $displayName avinstallerad" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Avinstallation klar!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Read-Host "Tryck Enter for att stanga"`;

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

echo "[1/7] Kontrollerar Node.js..."
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

echo "[2/7] Förbereder uppdatering..."

# Försök pausa befintlig bridge gracefully
if systemctl --user is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    echo "  Pausar befintlig bridge..."
    
    # Anropa prepare-update endpoint
    curl -s -X POST "http://localhost:$PORT/api/prepare-update" --connect-timeout 3 > /dev/null 2>&1 && {
        echo "  ✓ Bridge pausad gracefully"
        sleep 2
    } || {
        echo "  ⚠️ Kunde inte pausa gracefully, fortsätter ändå..."
    }
    
    echo "  Stoppar befintlig tjänst..."
    systemctl --user stop "$SERVICE_NAME"
fi

# Ta bort gammal installation om den finns
if [ -d "$APP_DIR" ]; then
    echo "  Tar bort befintlig installation..."
    rm -rf "$APP_DIR"
fi

mkdir -p "$APP_DIR"
mkdir -p "$APP_DIR/public"
echo "  ✓ $APP_DIR"

echo "[3/7] Kopierar filer..."
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

echo "[4/7] Installerar dependencies..."
cd "$APP_DIR"
npm install --production
echo "  ✓ Dependencies installerade"

echo "[5/7] Skapar konfiguration..."
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

echo "[6/7] Skapar systemd service..."
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
// Files are now created dynamically in the serve function

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Fetch current version from get-version endpoint
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const versionResponse = await fetch(`${supabaseUrl}/functions/v1/get-version`);
    const versionData = await versionResponse.json();
    const currentVersion = versionData.version || "1.0.0";

    // Inject version into INDEX_JS
    const indexJsWithVersion = INDEX_JS.replace(VERSION_PLACEHOLDER, currentVersion);

    const files: Record<string, string> = {
      "index.js": indexJsWithVersion,
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

    const zipData = createZip(files);

    return new Response(zipData.buffer as ArrayBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename=chromecast-bridge-${currentVersion}.zip`,
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
