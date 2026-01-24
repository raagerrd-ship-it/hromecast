require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const castv2 = require('castv2');
const Bonjour = require('bonjour-service').Bonjour;

// Version - keep in sync with src/config/version.ts
const BRIDGE_VERSION = '1.2.2';

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

// In-memory log buffer (keep last 100 entries)
const LOG_BUFFER_SIZE = 100;
let logBuffer = [];

// Default config with timing settings (all in seconds unless noted)
const DEFAULT_CONFIG = {
  enabled: false,
  url: '',
  selectedChromecast: null,
  // Timing settings
  screensaverCheckInterval: 60,      // How often to check if device is idle (seconds)
  keepAliveInterval: 5,              // Keep-alive ping interval (seconds)
  discoveryInterval: 30,             // Re-scan for devices interval (minutes)
  discoveryTimeout: 8,               // Max time to wait for discovery (seconds)
  discoveryEarlyResolve: 3,          // Early resolve if devices found (seconds)
  idleStatusTimeout: 5,              // Timeout for idle check (seconds)
  castRetryDelay: 2,                 // Base delay for retry backoff (seconds)
  castMaxRetries: 3                  // Max cast retry attempts
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
    console.log(`[INFO] ${new Date().toISOString()} - ${msg}`, ...args);
    addToLogBuffer('info', msg, args);
  },
  warn: (msg, ...args) => {
    console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`, ...args);
    addToLogBuffer('warn', msg, args);
  },
  error: (msg, ...args) => {
    console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`, ...args);
    addToLogBuffer('error', msg, args);
  },
  debug: (msg, ...args) => {
    if (process.env.DEBUG) {
      console.log(`[DEBUG] ${new Date().toISOString()} - ${msg}`, ...args);
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
        log.info(`✅ Found: ${name} at ${host}:${port}`);
      }
    });
    
    // Get timing from config
    const config = loadConfig();
    const earlyResolveMs = (config.discoveryEarlyResolve || 3) * 1000;
    const maxTimeoutMs = (config.discoveryTimeout || 8) * 1000;
    
    // Early resolve if devices found
    const earlyResolveTimeout = setTimeout(() => {
      if (foundDevices.length > 0 && !resolved) {
        resolved = true;
        browser.stop();
        discoveredDevices = foundDevices;
        log.info(`📡 Discovery complete (early): ${foundDevices.length} device(s)`);
        resolve(foundDevices);
      }
    }, earlyResolveMs);
    
    // Max timeout
    setTimeout(() => {
      clearTimeout(earlyResolveTimeout);
      if (!resolved) {
        resolved = true;
        browser.stop();
        discoveredDevices = foundDevices;
        log.info(`📡 Discovery complete: ${foundDevices.length} device(s)`);
        resolve(foundDevices);
      }
    }, maxTimeoutMs);
  });
}

// ============ Chromecast Control using raw castv2 ============

function findDevice(name) {
  return discoveredDevices.find(d => d.name === name) || null;
}

// Check if Chromecast is idle using raw castv2
async function isChromecastIdle(deviceName) {
  const device = findDevice(deviceName);
  if (!device) {
    log.warn('⚠️ Device not found for idle check:', deviceName);
    return true; // Assume idle if device not found
  }
  
  const config = loadConfig();
  const timeoutMs = (config.idleStatusTimeout || 5) * 1000;
  
  return new Promise((resolve) => {
    const checkClient = new castv2.Client();
    
    const timeout = setTimeout(() => {
      log.warn('⏱️ Idle check timeout');
      checkClient.close();
      resolve(true); // Assume idle on timeout
    }, timeoutMs);
    
    checkClient.on('error', (err) => {
      clearTimeout(timeout);
      log.error(`❌ Idle check error: ${err.message}`);
      checkClient.close();
      resolve(true); // Assume idle on error
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
          // Filter out backdrop and our own app
          const otherApps = apps.filter(app => app.appId !== BACKDROP_APP_ID && app.appId !== CUSTOM_APP_ID);
          const ourAppRunning = apps.some(app => app.appId === CUSTOM_APP_ID);
          
          if (ourAppRunning) {
            log.debug('Our app is running');
            screensaverActive = true;
            resolve(false); // Not idle - our app is running
          } else if (otherApps.length === 0) {
            log.debug('Device is idle');
            resolve(true);
          } else {
            log.debug(`Device busy with: ${otherApps.map(a => a.displayName || a.appId).join(', ')}`);
            resolve(false);
          }
        }
      });
    });
  });
}

// Cast media using raw castv2 (same method as the working bridge)
async function castMedia(chromecastName, url) {
  const device = findDevice(chromecastName);
  if (!device) {
    throw new Error(`Device "${chromecastName}" not found`);
  }
  
  log.info(`📺 Casting to ${chromecastName}: ${url}`);
  
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
      log.error(`❌ Connection error: ${err.message}`);
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
      
      // Keep connection alive with heartbeat
      heartbeatInterval = setInterval(() => {
        try {
          heartbeat.send({ type: 'PING' });
        } catch (e) {
          log.error('Heartbeat failed:', e.message);
          cleanup();
        }
      }, 5000);
      
      heartbeat.on('message', () => {}); // Silent heartbeat
      
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
          log.error(`❌ Failed to launch app: ${data.reason}`);
          client.close();
          reject(new Error(`Custom receiver not available: ${data.reason}`));
          return;
        }
        
        if (data.type === 'RECEIVER_STATUS') {
          // First response - need to launch app
          if (!appLaunched) {
            // Check if wrong app is running
            if (data.status && data.status.applications && data.status.applications.length > 0) {
              const runningApp = data.status.applications[0];
              
              if (runningApp.appId !== CUSTOM_APP_ID && runningApp.appId !== BACKDROP_APP_ID) {
                log.warn(`⚠️ Another app running: ${runningApp.displayName}`);
                cleanup();
                client.close();
                reject(new Error(`Another app running: ${runningApp.displayName}`));
                return;
              }
            }
            
            // Launch our custom receiver app
            log.info(`🚀 Launching custom receiver app: ${CUSTOM_APP_ID}`);
            receiver.send({ type: 'LAUNCH', appId: CUSTOM_APP_ID, requestId: 2 });
            appLaunched = true;
            return;
          }
          
          // App launched - now load media (only once)
          if (!mediaLoaded && data.status && data.status.applications && data.status.applications.length > 0) {
            const app = data.status.applications[0];
            
            if (app.appId !== CUSTOM_APP_ID) {
              log.warn('⚠️ Wrong app detected during cast');
              return;
            }
            
            // Mark as loaded immediately to prevent duplicates
            mediaLoaded = true;
            clearTimeout(launchTimeout);
            
            log.info(`📱 App launched: ${app.displayName} (${app.appId})`);
            
            const sessionId = app.sessionId;
            const transportId = app.transportId;
            
            // Connect to the app
            const appConnection = client.createChannel('sender-0', transportId, 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
            appConnection.send({ type: 'CONNECT' });
            
            const media = client.createChannel('sender-0', transportId, 'urn:x-cast:com.google.cast.media', 'JSON');
            
            log.info(`📺 Loading URL: ${url}`);
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
            
            // Keep connection alive
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

// Retry wrapper for cast operations with exponential backoff
async function castMediaWithRetry(chromecastName, url) {
  const config = loadConfig();
  const maxRetries = config.castMaxRetries || 3;
  const baseDelay = (config.castRetryDelay || 2) * 1000;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await castMedia(chromecastName, url);
    } catch (error) {
      log.warn(`⚠️ Cast attempt ${attempt}/${maxRetries} failed: ${error.message}`);
      if (attempt === maxRetries) throw error;
      const delay = baseDelay * attempt;
      log.info(`🔄 Retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function stopCast(chromecastName) {
  const device = findDevice(chromecastName);
  if (!device) {
    throw new Error(`Device "${chromecastName}" not found`);
  }
  
  return new Promise((resolve, reject) => {
    const stopClient = new castv2.Client();
    
    stopClient.on('error', (err) => {
      log.error(`❌ Stop error: ${err.message}`);
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
  
  // If screensaver is already active, skip check entirely
  // The idle check in isChromecastIdle will detect if our app is running
  // and return false (not idle), preventing duplicate casts
  if (screensaverActive) {
    log.debug('Screensaver flag active, skipping check');
    return;
  }
  
  const idle = await isChromecastIdle(config.selectedChromecast);
  if (idle) {
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
      
      // GET /api/logs
      if (req.method === 'GET' && pathname === '/api/logs') {
        sendJson(res, { logs: logBuffer });
        return;
      }
      
      // DELETE /api/logs (clear logs)
      if (req.method === 'DELETE' && pathname === '/api/logs') {
        logBuffer = [];
        sendJson(res, { success: true });
        return;
      }
      
      // POST /api/restart
      if (req.method === 'POST' && pathname === '/api/restart') {
        log.info('🔄 Restart requested via API');
        sendJson(res, { success: true, message: 'Restarting...' });
        setTimeout(() => { process.exit(0); }, 500);
        return;
      }
      
      // 404 for unknown API routes
      sendJson(res, { error: 'Not Found' }, 404);
      
    } catch (error) {
      log.error('API error:', error.message);
      sendJson(res, { error: error.message }, 500);
    }
    return;
  }
  
  // Static file serving
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(PUBLIC_DIR, filePath);
  
  serveStatic(filePath, res);
});

// ============ Main Entry Point ============

async function main() {
  log.info(`🚀 Chromecast Bridge v${BRIDGE_VERSION} starting...`);
  log.info(`📋 Device ID: ${DEVICE_ID}`);
  
  // Write network info file
  writeNetworkInfo();
  
  // Start HTTP server
  server.listen(PORT, () => {
    log.info(`🚀 Server running on http://localhost:${PORT}`);
  });
  
  // Publish mDNS service
  bonjour.publish({
    name: `${os.hostname()}-${DEVICE_ID}`,
    type: 'http',
    port: PORT,
    txt: { path: '/', version: BRIDGE_VERSION }
  });
  log.info(`📡 mDNS published: ${os.hostname()}-${DEVICE_ID}.local`);
  
  // Initial device discovery
  await discoverDevices();
  
  // Periodic tasks
  const config = loadConfig();
  
  // Discovery interval (default: 30 minutes)
  const discoveryMs = (config.discoveryInterval || 30) * 60 * 1000;
  setInterval(discoverDevices, discoveryMs);
  
  // Screensaver check interval (default: 60 seconds)
  const screensaverMs = (config.screensaverCheckInterval || 60) * 1000;
  setInterval(checkAndActivateScreensaver, screensaverMs);
  
  // Graceful shutdown
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
});
