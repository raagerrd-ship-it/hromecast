require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const castv2 = require('castv2');
const Bonjour = require('bonjour-service').Bonjour;

// Version — read from package.json as single source of truth
const BRIDGE_VERSION = require('./package.json').version;
const PI_OPTIMIZED = true; // Flag for Pi-specific behavior

// Git commit hash — resolved once at startup
const { execSync } = require('child_process');
let GIT_COMMIT = 'unknown';
let GIT_COMMIT_SHORT = 'unknown';
let GIT_BRANCH = 'unknown';
try {
  GIT_COMMIT = execSync('git rev-parse HEAD', { cwd: __dirname, timeout: 3000 }).toString().trim();
  GIT_COMMIT_SHORT = GIT_COMMIT.substring(0, 7);
  GIT_BRANCH = execSync('git rev-parse --abbrev-ref HEAD', { cwd: __dirname, timeout: 3000 }).toString().trim();
} catch (e) {
  // Not a git repo or git not available
}

// Update state - when true, pauses screensaver activation
let updateInProgress = false;

// Configuration
const startTime = Date.now();
const PCC_CONFIG_DIR = process.env.PCC_CONFIG_DIR?.trim();
const PCC_DATA_DIR = process.env.PCC_DATA_DIR?.trim();
const PCC_LOG_DIR = process.env.PCC_LOG_DIR?.trim();
const PORT = parseInt(process.env.PORT || '3052');
const UI_PORT = parseInt(process.env.UI_PORT || '3002');
const DEVICE_ID = process.env.DEVICE_ID || 'default-bridge';
const FALLBACK_CONFIG_DIR = path.join(os.homedir(), '.config', 'cast-away');
const FALLBACK_DATA_DIR = path.join(os.homedir(), '.local', 'share', 'cast-away');
const FALLBACK_LOG_DIR = path.join(os.homedir(), '.local', 'state', 'cast-away', 'logs');

function canWriteDirectory(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch (error) {
    return false;
  }
}

function resolveWritableDir(preferredDir, fallbackDir) {
  if (preferredDir) {
    return preferredDir;
  }

  return fallbackDir;
}

function resolveWritableConfigDir() {
  if (PCC_CONFIG_DIR) {
    return PCC_CONFIG_DIR;
  }

  return canWriteDirectory(FALLBACK_CONFIG_DIR) ? FALLBACK_CONFIG_DIR : os.tmpdir();
}

const CONFIG_DIR = resolveWritableConfigDir();
const DATA_DIR = resolveWritableDir(PCC_DATA_DIR, FALLBACK_DATA_DIR);
const LOG_DIR = resolveWritableDir(PCC_LOG_DIR, FALLBACK_LOG_DIR);
const CONFIG_FILE = path.join(CONFIG_DIR, 'settings.json');
const NETWORK_INFO_FILE = path.join(DATA_DIR, 'network-info.txt');
const HEALTHCHECK_FILE = path.join(DATA_DIR, `${DEVICE_ID || 'cast-away'}.health`);
const ENGINE_LOG_FILE = path.join(LOG_DIR, 'engine.log');
const CUSTOM_APP_ID = 'FE376873';
const BACKDROP_APP_ID = 'E8C28D3C';

function ensureDirectory(dirPath, label) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (error) {
    console.error(`[ERROR] Failed to create ${label} directory (${dirPath}): ${error.message}`);
  }
}

ensureDirectory(CONFIG_DIR, 'config');
ensureDirectory(DATA_DIR, 'data');
ensureDirectory(LOG_DIR, 'log');

const LEGACY_CONFIG_FILE = path.join(__dirname, 'config.json');
if (CONFIG_FILE !== LEGACY_CONFIG_FILE && !fs.existsSync(CONFIG_FILE) && fs.existsSync(LEGACY_CONFIG_FILE)) {
  try {
    fs.copyFileSync(LEGACY_CONFIG_FILE, CONFIG_FILE);
    console.log(`[INFO] Migrated config to writable path: ${CONFIG_FILE}`);
  } catch (error) {
    console.warn(`[WARN] Failed to migrate legacy config: ${error.message}`);
  }
}

// Lazy Bonjour init — only create when needed, destroy after discovery to free memory
let bonjour = null;
function getBonjour() {
  if (!bonjour) bonjour = new Bonjour();
  return bonjour;
}
function destroyBonjour() {
  if (bonjour) {
    try { bonjour.destroy(); } catch(e) {}
    bonjour = null;
  }
}

// ============ State ============

let discoveredDevices = [];
let client = null;
let keepAliveInterval = null;
let screensaverActive = false;

// Last device check result - for dashboard display and change detection
let lastDeviceCheck = {
  timestamp: null,
  status: null,  // 'idle', 'our_app', 'other_app', 'error', 'circuit_open'
  appName: null  // Name of running app if other_app
};

// Recovery state
let lastTakeoverTime = 0;
let recoveryCheckInterval = null;
let lastErrorType = 'takeover'; // 'takeover' (needs cooldown) or 'network_error' (skip cooldown)

// Circuit breaker state (threshold and cooldown now in config)
let circuitBreakerState = {
  failures: 0,
  lastFailureTime: 0,
  isOpen: false
};

// IP recovery backoff state
const IP_RECOVERY_BACKOFF = {
  baseInterval: 10000,        // 10 seconds base
  initialAttempts: 3,         // First 3 attempts at base interval
  maxInterval: 10 * 60 * 1000, // Max 10 minutes
  multiplier: 2,              // Double each time after initial attempts
  maintenanceInterval: 60 * 60 * 1000, // 1 hour in maintenance mode
  maintenanceThreshold: 12    // Go to maintenance mode after 12 attempts
};
let ipRecoveryState = {
  failedAttempts: 0,
  lastAttemptTime: 0,
  currentInterval: IP_RECOVERY_BACKOFF.baseInterval
};

// Retry configuration
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

// Track active heartbeats for cleanup
const activeHeartbeats = new Set();

const TOTAL_RAM_MB = Math.round(os.totalmem() / 1024 / 1024);
const LOG_BUFFER_SIZE = TOTAL_RAM_MB <= 512 ? 30 : 50;
const LOG_TRIM_TARGET = Math.max(12, Math.floor(LOG_BUFFER_SIZE * 0.6));
const MAX_LOG_MESSAGE_LENGTH = 220;
const MAX_LOG_ARG_LENGTH = 120;
const DISCOVERY_CACHE_TTL_MS = 2 * 60 * 1000;
const DISCOVERY_IDLE_TTL_MS = 30 * 1000;
const DISCOVERY_REFRESH_INTERVAL_MS = 60 * 1000; // when device is found
const DISCOVERY_REFRESH_INTERVAL_MISSING_MS = 15 * 1000; // when device is missing — search aggressively
const STATUS_CACHE_TTL_MS = 4000;
const MEMORY_CHECK_INTERVAL_MS = 60 * 1000;
const MEMORY_HEAP_WARN_MB = 45;
const MEMORY_RSS_WARN_MB = TOTAL_RAM_MB <= 512 ? 85 : 120;

let discoveredDevicesExpiresAt = 0;
let discoveryInFlight = null;
let backgroundDiscoveryTimer = null;
let statusSnapshotCache = null;
let statusSnapshotCacheTime = 0;

let logBuffer = [];

// Track last status check messages for deduplication
let lastCheckMessages = [];

// Track last URL refresh time (for refreshUrlInterval feature)
let lastUrlRefreshTime = Date.now();

// Default config with timing settings (all in seconds unless noted)
const DEFAULT_CONFIG = {
  enabled: false,
  url: '',
  selectedChromecast: null,
  // Sökning & Discovery
  discoveryTimeout: 10,
  discoveryEarlyResolve: 4,
  discoveryRetryDelay: 5,
  discoveryMaxRetries: 3,
  // Cast & Session
  screensaverCheckInterval: 60,
  keepAliveInterval: 5,
  idleStatusTimeout: 5,
  castRetryDelay: 2,
  castMaxRetries: 3,
  receiverAutoRefresh: 45,
  // Återhämtning & Skydd
  cooldownAfterTakeover: 30,
  recoveryCheckInterval: 10,
  circuitBreakerThreshold: 5,
  circuitBreakerCooldown: 5
};

// ============ Structured Logging ============

function categorizeLog(level, msg) {
  if (msg.includes('[DEBUG]')) {
    return 'debug';
  } else if (msg.includes('Cast') || msg.includes('Launching') || msg.includes('Sending URL') || msg.includes('📺')) {
    return 'cast';
  } else if (msg.includes('📊') || msg.includes('Heartbeat') || msg.includes('CHECK') || msg.includes('Status')) {
    return 'status';
  } else if (level === 'error' || msg.includes('❌') || msg.includes('Failed') || msg.includes('Error')) {
    return 'error';
  }
  return 'system';
}

function trimLogMessage(msg) {
  const message = String(msg || '');
  if (message.length <= MAX_LOG_MESSAGE_LENGTH) {
    return message;
  }
  return `${message.slice(0, MAX_LOG_MESSAGE_LENGTH)}…`;
}

function sanitizeLogArgs(args) {
  if (!args || args.length === 0) {
    return undefined;
  }

  const sanitized = args
    .map((arg) => {
      if (arg == null) return arg;
      if (typeof arg === 'string') {
        return arg.length > MAX_LOG_ARG_LENGTH ? `${arg.slice(0, MAX_LOG_ARG_LENGTH)}…` : arg;
      }
      if (typeof arg === 'number' || typeof arg === 'boolean') {
        return arg;
      }

      try {
        const serialized = JSON.stringify(arg);
        if (!serialized) return undefined;
        return serialized.length > MAX_LOG_ARG_LENGTH ? `${serialized.slice(0, MAX_LOG_ARG_LENGTH)}…` : serialized;
      } catch (error) {
        return '[unserializable]';
      }
    })
    .filter((arg) => arg !== undefined);

  return sanitized.length > 0 ? sanitized : undefined;
}

function trimLogBuffer(targetSize = LOG_BUFFER_SIZE) {
  if (logBuffer.length <= targetSize) {
    return;
  }

  logBuffer = logBuffer.slice(-targetSize);
}

function appendRuntimeLog(level, msg, args) {
  const line = [
    `[${level.toUpperCase()}]`,
    new Date().toISOString(),
    '-',
    trimLogMessage(msg),
    ...(sanitizeLogArgs(args) || [])
  ].join(' ');

  fs.appendFile(ENGINE_LOG_FILE, `${line}\n`, (error) => {
    if (error) {
      console.error(`[ERROR] Failed to write engine log: ${error.message}`);
    }
  });
}

function updateDiscoveryCache(devices) {
  discoveredDevices = devices;
  discoveredDevicesExpiresAt = Date.now() + (devices.length > 0 ? DISCOVERY_CACHE_TTL_MS : DISCOVERY_IDLE_TTL_MS);
}

function maybeExpireDiscoveredDevices(force = false) {
  if (discoveredDevices.length === 0) {
    return;
  }

  if (force || (!screensaverActive && Date.now() > discoveredDevicesExpiresAt)) {
    discoveredDevices = [];
    discoveredDevicesExpiresAt = 0;
  }
}

function getCompactMemoryStats(mem = process.memoryUsage()) {
  return {
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
    heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024 * 10) / 10,
    rssMB: Math.round(mem.rss / 1024 / 1024 * 10) / 10
  };
}

function buildStatusSnapshot() {
  const config = loadConfig();
  const networkIP = getNetworkIP();
  const mem = process.memoryUsage();
  const freeMem = os.freemem();
  const totalMem = os.totalmem();

  return {
    commit: GIT_COMMIT_SHORT,
    branch: GIT_BRANCH,
    version: BRIDGE_VERSION,
    platform: 'pi-zero-2w',
    deviceId: DEVICE_ID,
    port: PORT,
    uiPort: UI_PORT,
    networkIP,
    networkUrl: `http://${networkIP}:${UI_PORT}`,
    devices: discoveredDevices.length,
    selectedChromecast: config.selectedChromecast,
    screensaverActive,
    uptime: process.uptime(),
    lastDeviceCheck,
    circuitBreaker: {
      isOpen: circuitBreakerState.isOpen,
      failures: circuitBreakerState.failures
    },
    recovery: {
      active: recoveryCheckInterval !== null,
      lastErrorType,
      ipRecoveryAttempts: ipRecoveryState.failedAttempts
    },
    memory: {
      ...getCompactMemoryStats(mem),
      systemFreeMB: Math.round(freeMem / 1024 / 1024),
      systemTotalMB: Math.round(totalMem / 1024 / 1024)
    },
    cpuLoad: os.loadavg()
  };
}

function getStatusSnapshot(force = false) {
  const now = Date.now();
  if (!force && statusSnapshotCache && (now - statusSnapshotCacheTime) < STATUS_CACHE_TTL_MS) {
    return statusSnapshotCache;
  }

  statusSnapshotCache = buildStatusSnapshot();
  statusSnapshotCacheTime = now;
  return statusSnapshotCache;
}

function addToLogBuffer(level, msg, args) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message: trimLogMessage(msg),
    category: categorizeLog(level, msg),
    args: sanitizeLogArgs(args)
  };
  logBuffer.push(entry);
  trimLogBuffer();
}

const log = {
  info: (msg, ...args) => {
    console.log(`[INFO] ${new Date().toISOString()} - ${msg}`, ...args);
    addToLogBuffer('info', msg, args);
    appendRuntimeLog('info', msg, args);
  },
  warn: (msg, ...args) => {
    console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`, ...args);
    addToLogBuffer('warn', msg, args);
    appendRuntimeLog('warn', msg, args);
  },
  error: (msg, ...args) => {
    console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`, ...args);
    addToLogBuffer('error', msg, args);
    appendRuntimeLog('error', msg, args);
  },
  debug: (msg, ...args) => {
    if (process.env.DEBUG) {
      console.log(`[DEBUG] ${new Date().toISOString()} - ${msg}`, ...args);
    }
    addToLogBuffer('debug', msg, args);
    appendRuntimeLog('debug', msg, args);
  }
};

// ============ Utility Functions ============

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Calculate exponential backoff delay: base * 2^attempt (1s, 2s, 4s, 8s...)
function getBackoffDelay(attempt) {
  const delay = BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = delay * 0.25 * (Math.random() - 0.5);
  return Math.min(delay + jitter, 30000);
}

// Automatic zombie session cleanup - sends STOP to Chromecast, then optionally reconnects
async function autoForceStop(deviceHost, reason = 'zombie cleanup', autoReconnect = true) {
  log.info(`🛑 Auto force-stop: ${reason}`);
  
  const success = await new Promise((resolve) => {
    const forceClient = new castv2.Client();
    const timeout = setTimeout(() => {
      try { forceClient.close(); } catch(e) {
      }
      log.warn('⚠️ Force-stop timeout');
      resolve(false);
    }, 8000);
    
    forceClient.on('error', (err) => {
      clearTimeout(timeout);
      try { forceClient.close(); } catch(e) {
      }
      log.warn(`⚠️ Force-stop error: ${err.message}`);
      resolve(false);
    });
    
    forceClient.connect(deviceHost, () => {
      const connection = forceClient.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
      const receiver = forceClient.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.receiver', 'JSON');
      
      connection.send({ type: 'CONNECT' });
      receiver.send({ type: 'STOP', requestId: Date.now() });
      
      setTimeout(() => {
        connection.send({ type: 'CLOSE' });
        forceClient.close();
        clearTimeout(timeout);
        log.info('✅ Force-stop completed');
        resolve(true);
      }, 1000);
    });
  });
  
  if (success && autoReconnect) {
    log.info('🔄 Auto-reconnecting after force-stop...');
    await sleep(2000);
    const config = loadConfig();
    if (config.enabled && config.url && config.selectedChromecast) {
      checkAndActivateScreensaver();
    }
  }
  
  return success;
}

// ============ Circuit Breaker ============

function checkCircuitBreaker() {
  if (circuitBreakerState.isOpen) {
    const config = loadConfig();
    const cooldownMs = (config.circuitBreakerCooldown || 5) * 60 * 1000;
    const elapsed = Date.now() - circuitBreakerState.lastFailureTime;
    if (elapsed > cooldownMs) {
      log.info('⚡ [CIRCUIT] Half-open - allowing one attempt');
      circuitBreakerState.isOpen = false;
      circuitBreakerState.failures = 0;
      return 'half-open';
    } else {
      const remainingSec = Math.ceil((cooldownMs - elapsed) / 1000);
      log.debug(`⚡ [CIRCUIT] Open - skipping attempt (${remainingSec}s remaining)`);
      return false;
    }
  }
  return true;
}

function recordCircuitFailure() {
  const config = loadConfig();
  const threshold = config.circuitBreakerThreshold || 5;
  const cooldownMin = config.circuitBreakerCooldown || 5;
  
  circuitBreakerState.failures++;
  circuitBreakerState.lastFailureTime = Date.now();
  if (circuitBreakerState.failures >= threshold) {
    circuitBreakerState.isOpen = true;
    log.warn(`⚡ [CIRCUIT] Opened after ${threshold} failures - pausing attempts for ${cooldownMin} min`);
  }
}

function recordCircuitSuccess() {
  const wasOpen = circuitBreakerState.isOpen;
  circuitBreakerState.failures = 0;
  circuitBreakerState.isOpen = false;
  resetIPRecoveryBackoff();
  
  if (wasOpen) {
    log.info('⚡ [CIRCUIT] Closed - connection restored');
  }
}

// ============ IP Recovery Backoff ============

function getNextRecoveryInterval() {
  const { baseInterval, initialAttempts, maxInterval, multiplier, maintenanceInterval, maintenanceThreshold } = IP_RECOVERY_BACKOFF;
  
  if (ipRecoveryState.failedAttempts >= maintenanceThreshold) {
    return maintenanceInterval;
  }
  
  if (ipRecoveryState.failedAttempts < initialAttempts) {
    return baseInterval;
  }
  
  const attemptsAfterInitial = ipRecoveryState.failedAttempts - initialAttempts;
  const interval = baseInterval * Math.pow(multiplier, attemptsAfterInitial + 1);
  
  return Math.min(interval, maxInterval);
}

function recordIPRecoveryFailure() {
  const wasInMaintenance = ipRecoveryState.failedAttempts >= IP_RECOVERY_BACKOFF.maintenanceThreshold;
  
  ipRecoveryState.failedAttempts++;
  ipRecoveryState.lastAttemptTime = Date.now();
  ipRecoveryState.currentInterval = getNextRecoveryInterval();
  
  const intervalSecs = Math.round(ipRecoveryState.currentInterval / 1000);
  const intervalDisplay = intervalSecs >= 3600 
    ? `${Math.round(intervalSecs / 3600)}h` 
    : intervalSecs >= 60 
      ? `${Math.round(intervalSecs / 60)}min` 
      : `${intervalSecs}s`;
  
  const isInMaintenance = ipRecoveryState.failedAttempts >= IP_RECOVERY_BACKOFF.maintenanceThreshold;
  
  if (isInMaintenance && !wasInMaintenance) {
    log.warn(`🛠️ [IP-RECOVERY] Entering maintenance mode - checking every hour`);
  } else {
    log.info(`⏳ [IP-RECOVERY] Attempt ${ipRecoveryState.failedAttempts} failed, next check in ${intervalDisplay}`);
  }
}

function resetIPRecoveryBackoff() {
  if (ipRecoveryState.failedAttempts > 0) {
    log.info(`✅ [IP-RECOVERY] Reset backoff (was at ${Math.round(ipRecoveryState.currentInterval/1000)}s after ${ipRecoveryState.failedAttempts} failures)`);
    ipRecoveryState.failedAttempts = 0;
    ipRecoveryState.currentInterval = IP_RECOVERY_BACKOFF.baseInterval;
    ipRecoveryState.lastAttemptTime = 0;
  }
}

function canAttemptIPRecovery() {
  if (ipRecoveryState.lastAttemptTime === 0) return true;
  const timeSinceLastAttempt = Date.now() - ipRecoveryState.lastAttemptTime;
  return timeSinceLastAttempt >= ipRecoveryState.currentInterval;
}

// ============ Recovery Check Loop ============

function startRecoveryCheck() {
  if (recoveryCheckInterval) return;
  
  const config = loadConfig();
  const recoveryIntervalMs = (config.recoveryCheckInterval || 10) * 1000;
  const cooldownMs = (config.cooldownAfterTakeover || 30) * 1000;
  
  log.info('🔄 Starting recovery check with exponential backoff...');
  
  recoveryCheckInterval = setInterval(async () => {
    const timeSinceTakeover = Date.now() - lastTakeoverTime;
    
    const skipCooldown = lastErrorType === 'network_error' || lastErrorType === 'silent_disconnect';
    
    if (!skipCooldown && timeSinceTakeover < cooldownMs) {
      const remainingSecs = Math.ceil((cooldownMs - timeSinceTakeover) / 1000);
      log.debug(`⏸️ [RECOVERY] Cooldown: ${remainingSecs}s remaining`);
      return;
    }
    
    if (!canAttemptIPRecovery()) {
      const waitTime = ipRecoveryState.currentInterval - (Date.now() - ipRecoveryState.lastAttemptTime);
      const waitDisplay = waitTime >= 60000 
        ? `${Math.ceil(waitTime / 60000)}min`
        : `${Math.ceil(waitTime / 1000)}s`;
      log.debug(`⏳ [RECOVERY] Backoff active, next attempt in ${waitDisplay}`);
      return;
    }
    
    log.debug('🔍 [RECOVERY] Checking device status...');
    const currentConfig = loadConfig();
    
    if (!currentConfig.selectedChromecast) {
      log.warn('⚠️ [RECOVERY] No device selected');
      return;
    }
    
    const result = await isChromecastIdleWithRecovery(currentConfig.selectedChromecast);
    
    if (result.status === 'idle') {
      log.info('✅ [RECOVERY] Device idle, triggering screensaver...');
      resetIPRecoveryBackoff();
      stopRecoveryCheck();
      checkAndActivateScreensaver();
    } else if (result.status === 'our_app') {
      log.info('✅ [RECOVERY] Our app already running, stopping recovery check');
      resetIPRecoveryBackoff();
      stopRecoveryCheck();
    } else if (result.status === 'error') {
      log.info('🔄 [RECOVERY] Device unreachable, triggering rediscovery...');
      const devices = await discoverDevicesWithRetry();
      
      const device = findDevice(currentConfig.selectedChromecast);
      if (device) {
        log.info(`✅ [RECOVERY] Device \"${currentConfig.selectedChromecast}\" found at ${device.host} - reconnecting now!`);
        resetIPRecoveryBackoff();
        stopRecoveryCheck();
        checkAndActivateScreensaver();
        return;
      } else {
        recordIPRecoveryFailure();
      }
    } else {
      log.debug(`⏭️ [RECOVERY] Device still busy (${result.status}), will check again...`);
      resetIPRecoveryBackoff();
    }
  }, recoveryIntervalMs);
}

function stopRecoveryCheck() {
  if (recoveryCheckInterval) {
    log.info('🛑 Stopping recovery check');
    clearInterval(recoveryCheckInterval);
    recoveryCheckInterval = null;
  }
}

function logScreensaverStop(reason = 'takeover') {
  if (!screensaverActive) return;
  
  screensaverActive = false;
  lastTakeoverTime = Date.now();
  lastErrorType = reason;
  
  const cooldownMsg = reason === 'network_error' || reason === 'silent_disconnect' 
    ? 'no cooldown (network error)' 
    : 'cooldown started';
  log.info(`⏹️ Screensaver stopped (${reason}) - ${cooldownMsg}`);
  
  if (reason === 'network_error' || reason === 'silent_disconnect') {
    log.info('🔄 Network error detected - attempting immediate reconnect...');
    immediateReconnect();
  } else {
    startRecoveryCheck();
  }
}

async function immediateReconnect() {
  const config = loadConfig();
  if (!config.enabled || !config.url || !config.selectedChromecast) {
    log.warn('⚠️ Cannot reconnect - missing config');
    startRecoveryCheck();
    return;
  }
  
  await sleep(2000);
  
  const result = await isChromecastIdleWithRecovery(config.selectedChromecast);
  
  if (result.status === 'idle') {
    log.info('✅ Device idle - reconnecting now');
    try {
      await castMedia(config.selectedChromecast, config.url);
      log.info('✅ Immediate reconnect successful');
    } catch (error) {
      log.error(`❌ Immediate reconnect failed: ${error.message}`);
      startRecoveryCheck();
    }
  } else if (result.status === 'our_app') {
    log.info('✅ Our app still running - no action needed');
    screensaverActive = true;
  } else if (result.status === 'error') {
    log.warn('⚠️ Device unreachable - starting recovery loop');
    startRecoveryCheck();
  } else {
    log.info(`ℹ️ Device busy (${result.status}) - starting recovery loop`);
    startRecoveryCheck();
  }
}

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
  const info = `Cast Away - Nätverksinfo
================================
Startad: ${new Date().toLocaleString('sv-SE')}
Device ID: ${DEVICE_ID}

Engine (API): http://${ip}:${PORT}
UI:           http://${ip}:${UI_PORT}
`;
  try {
    fs.writeFileSync(NETWORK_INFO_FILE, info.trim());
  } catch (error) {
    log.error('Could not write network-info.txt:', error.message);
  }
}

// ============ Config Management ============

// Config cache — avoid repeated disk reads on slow SD card (single-core optimization)
let configCache = null;
let configCacheTime = 0;
const CONFIG_CACHE_TTL = 5000; // 5 seconds

function loadConfig() {
  const now = Date.now();
  if (configCache && (now - configCacheTime) < CONFIG_CACHE_TTL) {
    return configCache;
  }
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      configCache = { ...DEFAULT_CONFIG, ...JSON.parse(data) };
      configCacheTime = now;
      return configCache;
    }
  } catch (error) {
    log.error('Error loading config:', error.message);
  }
  configCache = { ...DEFAULT_CONFIG };
  configCacheTime = now;
  return configCache;
}

function saveConfig(config) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    const tempFile = `${CONFIG_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(config, null, 2));
    fs.renameSync(tempFile, CONFIG_FILE);
    // Invalidate cache immediately on write
    configCache = { ...DEFAULT_CONFIG, ...config };
    configCacheTime = Date.now();
    return true;
  } catch (error) {
    log.error(`Error saving config to ${CONFIG_FILE}:`, error.message);
    return false;
  }
}

// ============ Chromecast Discovery ============

function discoverDevices() {
  if (discoveryInFlight) {
    log.debug('🔁 Discovery already running, reusing in-flight scan');
    return discoveryInFlight;
  }

  discoveryInFlight = new Promise((resolve) => {
    log.info('🔍 Scanning for Chromecast devices...');

    const b = getBonjour();
    const browser = b.find({ type: 'googlecast' });
    const foundDevices = [];
    let resolved = false;

    const finish = (devices, label) => {
      if (resolved) return;
      resolved = true;
      browser.stop();
      destroyBonjour();
      updateDiscoveryCache(devices);
      log.info(`📡 Discovery complete (${label}): ${devices.length} device(s)`);
      resolve(devices);
    };

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

    const config = loadConfig();
    const earlyResolveMs = (config.discoveryEarlyResolve || 4) * 1000;
    const maxTimeoutMs = (config.discoveryTimeout || 10) * 1000;

    const earlyResolveTimeout = setTimeout(() => {
      if (foundDevices.length > 0) {
        finish(foundDevices, 'early');
      }
    }, earlyResolveMs);

    setTimeout(() => {
      clearTimeout(earlyResolveTimeout);
      if (!resolved) {
        maybeExpireDiscoveredDevices();
        if (foundDevices.length === 0 && discoveredDevices.length > 0) {
          log.info(`📡 Discovery timeout, keeping ${discoveredDevices.length} cached device(s)`);
          resolved = true;
          browser.stop();
          destroyBonjour();
          resolve(discoveredDevices);
        } else {
          finish(foundDevices, 'timeout');
        }
      }
    }, maxTimeoutMs);
  }).finally(() => {
    discoveryInFlight = null;
  });

  return discoveryInFlight;
}

async function discoverDevicesWithRetry(maxRetriesOverride = null) {
  maybeExpireDiscoveredDevices();
  const config = loadConfig();
  const maxRetries = maxRetriesOverride ?? (config.discoveryMaxRetries || 3);
  const retryDelayMs = (config.discoveryRetryDelay || 5) * 1000;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const devices = await discoverDevices();
    
    if (devices.length > 0) {
      return devices;
    }
    
    if (attempt < maxRetries) {
      log.info(`🔄 No devices found, retrying in ${config.discoveryRetryDelay || 5}s (${attempt}/${maxRetries})...`);
      await sleep(retryDelayMs);
    }
  }
  
  log.warn('⚠️ No devices found after retries');
  return [];
}

async function checkAndReconnectSavedDevice() {
  const config = loadConfig();
  
  if (!config.selectedChromecast || !config.enabled || !config.url) {
    return;
  }
  
  if (screensaverActive) {
    return;
  }
  
  if (recoveryCheckInterval) {
    return;
  }
  
  const device = findDevice(config.selectedChromecast);
  if (device) {
    log.info(`🔗 Saved device \"${config.selectedChromecast}\" found at ${device.host} - checking status...`);
    
    const result = await isChromecastIdleWithRecovery(config.selectedChromecast);
    
    if (result.status === 'idle') {
      log.info('🚀 Device idle - auto-reconnecting...');
      checkAndActivateScreensaver();
    } else if (result.status === 'our_app') {
      log.info('✅ Our app already running on saved device');
      screensaverActive = true;
    } else {
      log.info(`ℹ️ Saved device status: ${result.status}`);
    }
  }
}

function startBackgroundDiscovery() {
  if (backgroundDiscoveryTimer) return;

  backgroundDiscoveryTimer = setInterval(async () => {
    const config = loadConfig();

    if (!config.enabled || !config.selectedChromecast) {
      return;
    }

    try {
      const devices = await discoverDevices();
      const selectedDevice = devices.find((device) => device.name === config.selectedChromecast);

      if (selectedDevice) {
        log.debug(`🛰️ Background discovery sees "${config.selectedChromecast}" at ${selectedDevice.host}`);
        if (!screensaverActive && !recoveryCheckInterval && config.url) {
          await checkAndReconnectSavedDevice();
        }
      } else {
        log.debug(`🛰️ Background discovery did not find "${config.selectedChromecast}"`);
      }
    } catch (error) {
      log.warn(`⚠️ Background discovery failed: ${error.message}`);
    }
  }, DISCOVERY_REFRESH_INTERVAL_MS);
}

// ============ Chromecast Control using raw castv2 ============

function findDevice(name) {
  return discoveredDevices.find(d => d.name === name) || null;
}

async function isChromecastIdleWithRecovery(deviceName, retryCount = 0) {
  const cbState = checkCircuitBreaker();
  if (cbState === false) {
    return { status: 'circuit_open' };
  }
  
  const device = findDevice(deviceName);
  if (!device) {
    log.warn('⚠️ Device not found for idle check:', deviceName);
    return { status: 'error' };
  }
  
  if (retryCount > 0) {
    const delay = getBackoffDelay(retryCount - 1);
    log.info(`🔄 Idle check retry ${retryCount}/${MAX_RETRIES} - waiting ${Math.round(delay/1000)}s...`);
    await sleep(delay);
  }
  
  const config = loadConfig();
  const timeoutMs = (config.idleStatusTimeout || 5) * 1000;
  
  return new Promise((resolve) => {
    const checkClient = new castv2.Client();
    
    const timeout = setTimeout(async () => {
      log.warn('⏱️ Idle check timeout');
      checkClient.close();
      recordCircuitFailure();
      
      if (retryCount < MAX_RETRIES) {
        const result = await isChromecastIdleWithRecovery(deviceName, retryCount + 1);
        resolve(result);
        return;
      }
      
      resolve({ status: 'error' });
    }, timeoutMs);
    
    checkClient.on('error', async (err) => {
      clearTimeout(timeout);
      log.error(`❌ Idle check error: ${err.message}`);
      checkClient.close();
      recordCircuitFailure();
      
      const isRetryableError = 
        err.message.includes('ETIMEDOUT') || 
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('ECONNRESET') ||
        err.message.includes('EPIPE');
      
      if (retryCount < MAX_RETRIES && isRetryableError) {
        log.info(`🔄 Retryable network error, will retry (${retryCount + 1}/${MAX_RETRIES})...`);
        const result = await isChromecastIdleWithRecovery(deviceName, retryCount + 1);
        resolve(result);
        return;
      }
      
      if (screensaverActive && (err.message.includes('ECONNRESET') || err.message.includes('EPIPE'))) {
        log.warn('⚠️ Connection reset while app was \"active\" - likely zombie session');
        screensaverActive = false;
        await autoForceStop(device.host, 'ECONNRESET during active session');
      }
      
      resolve({ status: 'error' });
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
          recordCircuitSuccess();
          
          const apps = data.status?.applications || [];
          const otherApps = apps.filter(app => app.appId !== BACKDROP_APP_ID && app.appId !== CUSTOM_APP_ID);
          const ourAppRunning = apps.some(app => app.appId === CUSTOM_APP_ID);
          
          const appList = apps.length === 0 ? 'none' : apps.map(a => `${a.displayName || 'unknown'}(${a.appId})`).join(', ');
          
          let result;
          if (ourAppRunning) {
            screensaverActive = true;
            result = { status: 'our_app', appList };
          } else if (otherApps.length === 0) {
            result = { status: 'idle', appList };
          } else {
            const appNames = otherApps.map(a => a.displayName || a.appId);
            result = { status: 'busy', apps: appNames, appList };
          }
          
          lastDeviceCheck = {
            timestamp: new Date().toISOString(),
            status: result.status,
            appName: result.apps ? result.apps[0] : null
          };
          
          resolve(result);
        }
      });
    });
  });
}

async function castMedia(chromecastName, url, retryCount = 0) {
  if (checkCircuitBreaker() === false) {
    throw new Error('Circuit breaker open - connection attempts paused');
  }
  
  const device = findDevice(chromecastName);
  if (!device) {
    throw new Error(`Device \"${chromecastName}\" not found`);
  }
  
  if (retryCount > 0) {
    const config = loadConfig();
    const baseDelay = (config.castRetryDelay || 2) * 1000;
    const delay = baseDelay * Math.pow(2, retryCount - 1);
    log.info(`🔄 Cast retry ${retryCount}/${MAX_RETRIES} - waiting ${Math.round(delay/1000)}s...`);
    await sleep(delay);
  }
  
  log.info(`📺 Casting to ${chromecastName}: ${url}`);
  
  return new Promise((resolve, reject) => {
    client = new castv2.Client();
    let heartbeatInterval = null;
    let launchTimeout = null;
    
    const cleanup = () => {
      if (heartbeatInterval) {
        activeHeartbeats.delete(heartbeatInterval);
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      if (launchTimeout) {
        clearTimeout(launchTimeout);
        launchTimeout = null;
      }
    };
    
    client.on('error', async (err) => {
      log.error(`❌ Connection error: ${err.message}`);
      cleanup();
      recordCircuitFailure();
      
      if (screensaverActive && (err.message.includes('ECONNRESET') || err.message.includes('EPIPE'))) {
        log.warn('⚠️ Connection reset - clearing potential zombie session');
        screensaverActive = false;
        await autoForceStop(device.host, 'ECONNRESET during cast');
      }
      
      if (retryCount < MAX_RETRIES) {
        log.info(`🔄 Will retry (${retryCount + 1}/${MAX_RETRIES})...`);
        try {
          const result = await castMedia(chromecastName, url, retryCount + 1);
          resolve(result);
        } catch (retryErr) {
          reject(retryErr);
        }
      } else {
        logScreensaverStop('network_error');
        reject(new Error(`Connection failed after ${MAX_RETRIES} retries: ${err.message}`));
      }
    });
    
    client.on('close', () => {
      log.info('🔌 Connection closed');
      cleanup();
      
      if (screensaverActive) {
        log.info('⚠️ Connection closed while active - checking status in 3s...');
        setTimeout(async () => {
          const config = loadConfig();
          if (config.selectedChromecast && config.enabled) {
            const result = await isChromecastIdleWithRecovery(config.selectedChromecast);
            if (result.status === 'idle') {
              log.info('🔄 Device idle after close - reactivating...');
              checkAndActivateScreensaver();
            } else if (result.status === 'our_app') {
              log.info('✅ Our app still running on device');
              screensaverActive = true;
            } else {
              log.info(`ℹ️ Device status after close: ${result.status}`);
              logScreensaverStop('network_error');
            }
          }
        }, 3000);
      }
    });
    
    client.connect(device.host, () => {
      log.info('✅ Connected to Chromecast');
      log.debug('📡 [DEBUG] Creating channels...');
      recordCircuitSuccess();
      
      const connection = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
      const heartbeat = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.heartbeat', 'JSON');
      const receiver = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.receiver', 'JSON');
      
      log.debug('📡 [DEBUG] Channels created, sending CONNECT...');
      connection.send({ type: 'CONNECT' });
      log.debug('📡 [DEBUG] CONNECT sent');
      
      const config = loadConfig();
      const heartbeatMs = (config.keepAliveInterval || 5) * 1000;
      
      heartbeatInterval = setInterval(() => {
        try {
          heartbeat.send({ type: 'PING' });
        } catch (e) {
          log.error(`❌ Heartbeat failed: ${e.message}`);
          if (heartbeatInterval) {
            activeHeartbeats.delete(heartbeatInterval);
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }
          if (client) {
            try { client.close(); } catch(e) {
            }
            client = null;
          }
          if (screensaverActive) {
            logScreensaverStop('network_error');
          }
        }
      }, heartbeatMs);
      activeHeartbeats.add(heartbeatInterval);
      
      heartbeat.on('message', () => {});
      
      log.info('📡 Getting receiver status...');
      receiver.send({ type: 'GET_STATUS', requestId: 1 });
      
      receiver.on('message', (data) => {
        log.debug(`📨 [DEBUG] Receiver message type: ${data.type}`);
        if (data.type === 'RECEIVER_STATUS') {
          const apps = data.status?.applications || [];
          log.debug(`📨 [DEBUG] RECEIVER_STATUS: ${apps.length} app(s) running`);
          apps.forEach((app, i) => {
            log.debug(`📨 [DEBUG]   App ${i}: ${app.displayName} (${app.appId})`);
          });
        } else {
          log.debug(`📨 [DEBUG] Full message: ${JSON.stringify(data)}`);
        }
      });
      
      launchTimeout = setTimeout(async () => {
        log.error('⏱️ Timeout waiting for receiver response (120s)');
        cleanup();
        recordCircuitFailure();
        
        if (retryCount < MAX_RETRIES) {
          try {
            const result = await castMedia(chromecastName, url, retryCount + 1);
            resolve(result);
          } catch (retryErr) {
            reject(retryErr);
          }
        } else {
          reject(new Error('Receiver timeout'));
        }
      }, 120000);
      
      let appLaunched = false;
      let mediaLoaded = false;
      
      receiver.on('message', async (data) => {
        
        if (data.type === 'LAUNCH_ERROR') {
          cleanup();
          log.error(`❌ Failed to launch app: ${data.reason}`);
          client.close();
          reject(new Error(`Custom receiver not available: ${data.reason}`));
          return;
        }
        
        if (data.type === 'RECEIVER_STATUS') {
          if (!appLaunched) {
            if (data.status && data.status.applications && data.status.applications.length > 0) {
              const runningApp = data.status.applications[0];
              
              if (runningApp.appId !== CUSTOM_APP_ID && runningApp.appId !== BACKDROP_APP_ID) {
                log.warn(`⚠️ Another app running: ${runningApp.displayName}`);
                cleanup();
                client.close();
                logScreensaverStop('takeover');
                reject(new Error(`Another app running: ${runningApp.displayName}`));
                return;
              }
            }
            
            log.info(`🚀 Launching custom receiver app: ${CUSTOM_APP_ID}`);
            receiver.send({ type: 'LAUNCH', appId: CUSTOM_APP_ID, requestId: 2 });
            appLaunched = true;
            return;
          }
          
          if (!mediaLoaded && data.status && data.status.applications && data.status.applications.length > 0) {
            const app = data.status.applications[0];
            
            if (app.appId !== CUSTOM_APP_ID) {
              log.warn('⚠️ Wrong app detected during cast');
              logScreensaverStop('takeover');
              return;
            }
            
            mediaLoaded = true;
            clearTimeout(launchTimeout);
            
            log.info(`📱 App launched: ${app.displayName} (${app.appId})`);
            
            const transportId = app.transportId;
            
            const appConnection = client.createChannel('sender-0', transportId, 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
            appConnection.send({ type: 'CONNECT' });
            
            const customChannel = client.createChannel('sender-0', transportId, 'urn:x-cast:com.website.cast', 'JSON');
            
            const config = loadConfig();
            const refreshMinutes = config.receiverAutoRefresh || 45;
            const urlWithRefresh = url.includes('?') 
              ? `${url}&refresh=${refreshMinutes}` 
              : `${url}?refresh=${refreshMinutes}`;
            
            log.info(`📺 Sending URL via custom channel: ${urlWithRefresh}`);
            customChannel.send({
              type: 'LOAD_WEBSITE',
              url: urlWithRefresh
            });
            
            log.info('✅ Cast successful - keeping connection alive indefinitely');
            screensaverActive = true;
            lastUrlRefreshTime = Date.now();
            stopRecoveryCheck();
            
            keepAliveInterval = heartbeatInterval;
            
            resolve({ success: true });
            
            customChannel.on('message', (data) => {
              log.debug('📨 Custom channel message:', JSON.stringify(data));
            });
          }
        }
      });
    });
  });
}

async function refreshMediaOnReceiver(chromecastName, url) {
  const device = findDevice(chromecastName);
  if (!device) {
    log.warn('⚠️ Refresh: Device not found');
    return { success: false, error: 'Device not found' };
  }
  
  return new Promise((resolve) => {
    const refreshClient = new castv2.Client();
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { refreshClient.close(); } catch(e) {
        }
        log.warn('⚠️ Refresh: Timeout');
        resolve({ success: false, error: 'Timeout' });
      }
    }, 10000);
    
    refreshClient.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        try { refreshClient.close(); } catch(e) {
        }
        log.warn(`⚠️ Refresh error: ${err.message}`);
        resolve({ success: false, error: err.message });
      }
    });
    
    refreshClient.connect(device.host, () => {
      const connection = refreshClient.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
      const receiver = refreshClient.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.receiver', 'JSON');
      
      connection.send({ type: 'CONNECT' });
      receiver.send({ type: 'GET_STATUS', requestId: 1 });
      
      receiver.on('message', (data) => {
        if (resolved) return;
        
        if (data.type === 'RECEIVER_STATUS' && data.status?.applications?.length > 0) {
          const app = data.status.applications[0];
          
          if (app.appId === CUSTOM_APP_ID) {
            const transportId = app.transportId;
            
            const appConnection = refreshClient.createChannel('sender-0', transportId, 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
            appConnection.send({ type: 'CONNECT' });
            
            const customChannel = refreshClient.createChannel('sender-0', transportId, 'urn:x-cast:com.website.cast', 'JSON');
            
            const config = loadConfig();
            const refreshMinutes = config.receiverAutoRefresh || 45;
            const urlWithRefresh = url.includes('?') 
              ? `${url}&refresh=${refreshMinutes}` 
              : `${url}?refresh=${refreshMinutes}`;
            
            log.debug(`🔄 Refreshing URL via custom channel: ${urlWithRefresh}`);
            customChannel.send({
              type: 'LOAD_WEBSITE',
              url: urlWithRefresh
            });
            
            setTimeout(() => {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                connection.send({ type: 'CLOSE' });
                refreshClient.close();
                log.debug('✅ URL refresh sent to receiver');
                resolve({ success: true });
              }
            }, 1000);
          } else {
            resolved = true;
            clearTimeout(timeout);
            refreshClient.close();
            log.warn(`⚠️ Refresh: Wrong app running (${app.appId})`);
            resolve({ success: false, error: 'Wrong app running' });
          }
        }
      });
    });
  });
}

async function stopCast(chromecastName) {
  const device = findDevice(chromecastName);
  if (!device) {
    throw new Error(`Device \"${chromecastName}\" not found`);
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
          activeHeartbeats.delete(keepAliveInterval);
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
  
  if (updateInProgress) {
    log.info('⏸️ Update in progress, skipping screensaver check');
    return;
  }
  
  const wasScreensaverActive = screensaverActive;
  
  const circuitState = checkCircuitBreaker();
  if (circuitState === false) {
    log.info('⚡ Circuit breaker open, skipping');
    return;
  }
  
  if (circuitState === 'half-open') {
    log.info('🔍 [CIRCUIT] Half-open - rediscovering devices before retry...');
    await discoverDevices();
    const device = findDevice(config.selectedChromecast);
    if (device) {
      log.info(`✅ [CIRCUIT] Device found at ${device.host} (.${device.host.split('.').pop()})`);
    } else {
      log.warn(`⚠️ [CIRCUIT] Device \"${config.selectedChromecast}\" not found after rediscovery`);
      recordCircuitFailure();
      return;
    }
  }
  
  const result = await isChromecastIdleWithRecovery(config.selectedChromecast);
  
  if (result.status === 'circuit_open') {
    log.info('⚡ Circuit breaker open, skipping');
    return;
  }
  
  // Heartbeat logging with deduplication
  const statusEmoji = {
    'our_app': '✅',
    'idle': '⏸️', 
    'busy': '📺',
    'error': '❌'
  }[result.status] || '❓';
  
  const statusLabel = {
    'our_app': 'Skärmsläckare aktiv',
    'idle': 'Inaktiv',
    'busy': 'Upptagen',
    'error': 'Ej nåbar'
  }[result.status] || result.status;
  
  const compactStatus = `📊 ${statusEmoji} ${statusLabel} | Apps: ${result.appList || 'none'}`;
  const now = new Date().toISOString();
  
  const newMessage = `📊 ${compactStatus}`;
  const existingIdx = logBuffer.findIndex(entry => entry.isHeartbeat);
  
  if (existingIdx !== -1) {
    const existing = logBuffer[existingIdx];
    
    if (existing.message === newMessage) {
      logBuffer.splice(existingIdx, 1);
    } else {
      existing.isHeartbeat = false;
    }
  }
  
  logBuffer.push({
    timestamp: now,
    level: 'info',
    message: newMessage,
    isHeartbeat: true
  });
  
  while (logBuffer.length > LOG_BUFFER_SIZE) {
    logBuffer.shift();
  }

  // Handle different states
  if (result.status === 'our_app') {
    if (!wasScreensaverActive) {
      log.info('✅ Screensaver resumed (was already running on device)');
      lastUrlRefreshTime = Date.now();
    }
    
    const receiverRefreshMs = (config.receiverAutoRefresh || 45) * 60 * 1000;
    const preRefreshBuffer = 2 * 60 * 1000;
    const refreshTriggerTime = receiverRefreshMs - preRefreshBuffer;
    const timeSinceRefresh = Date.now() - lastUrlRefreshTime;
    
    if (timeSinceRefresh >= refreshTriggerTime) {
      log.debug(`⏰ Sending URL before receiver auto-refresh (${Math.round(timeSinceRefresh / 60000)}/${config.receiverAutoRefresh || 45} min)`);
      try {
        await refreshMediaOnReceiver(config.selectedChromecast, config.url);
        lastUrlRefreshTime = Date.now();
      } catch (err) {
        log.warn(`⚠️ URL refresh failed: ${err.message}`);
      }
    }
    
    return;
  }
  
  if (result.status === 'busy') {
    if (wasScreensaverActive) {
      logScreensaverStop('takeover');
    }
    return;
  }
  
  if (result.status === 'error') {
    if (wasScreensaverActive) {
      logScreensaverStop('network_error');
      return;
    }

    log.info('🔄 Device unreachable during scheduled check - refreshing discovery cache...');
    await discoverDevices();

    const rediscoveredDevice = findDevice(config.selectedChromecast);
    if (rediscoveredDevice) {
      log.info(`✅ Device rediscovered at ${rediscoveredDevice.host} - retrying activation check`);
      const retryResult = await isChromecastIdleWithRecovery(config.selectedChromecast);

      if (retryResult.status === 'idle') {
        log.info('💤 Rediscovered device is idle, activating screensaver...');
        try {
          await castMedia(config.selectedChromecast, config.url);
        } catch (error) {
          log.error('Failed to activate screensaver after rediscovery:', error.message);
        }
      } else if (retryResult.status === 'our_app') {
        screensaverActive = true;
        lastUrlRefreshTime = Date.now();
        log.info('✅ Rediscovered device already runs our app');
      } else if (retryResult.status === 'busy') {
        log.info('ℹ️ Rediscovered device is busy, waiting for next check');
      }
    }
    return;
  }
  
  // status === 'idle'
  if (wasScreensaverActive) {
    log.warn('⚠️ Silent disconnect detected! Device idle but flag was active');
    logScreensaverStop('silent_disconnect');
  }
  
  const timeSinceTakeover = Date.now() - lastTakeoverTime;
  const skipCooldown = lastErrorType === 'network_error' || lastErrorType === 'silent_disconnect';
  const cooldownMs = (config.cooldownAfterTakeover || 30) * 1000;
  
  if (!skipCooldown && lastTakeoverTime > 0 && timeSinceTakeover < cooldownMs) {
    const remainingSecs = Math.ceil((cooldownMs - timeSinceTakeover) / 1000);
    log.info(`⏸️ Cooldown active, ${remainingSecs}s remaining`);
    return;
  }
  
  log.info('💤 Device idle, activating screensaver...');
  try {
    await castMedia(config.selectedChromecast, config.url);
  } catch (error) {
    log.error('Failed to activate screensaver:', error.message);
  }
}

// ============ HTTP Server (API only — no static file serving) ============

const MAX_BODY_SIZE = 10 * 1024;

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-XSS-Protection': '1; mode=block'
};

function parseBody(req, maxSize = MAX_BODY_SIZE) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxSize) {
        req.destroy();
        reject(new Error(`Request body too large (max ${maxSize} bytes)`));
        return;
      }
      body += chunk;
    });
    
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    
    req.on('error', (err) => {
      reject(err);
    });
  });
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    ...SECURITY_HEADERS
  });
  res.end(JSON.stringify(data));
}

function cleanupConnection() {
  if (keepAliveInterval) {
    activeHeartbeats.delete(keepAliveInterval);
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
  if (client) {
    try { client.close(); } catch(e) {
    }
    client = null;
  }
  statusSnapshotCache = null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  
  // CORS headers for all responses (UI runs on a different port)
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // API Routes only
  if (pathname.startsWith('/api/')) {
    try {
      // GET /api/health — required by Pi Control Center
      if (req.method === 'GET' && pathname === '/api/health') {
        const mem = process.memoryUsage();
        const rssMB = Math.round(mem.rss / 1024 / 1024);
        let healthStatus = 'ok';
        if (rssMB > 100) healthStatus = 'degraded';
        sendJson(res, {
          status: healthStatus,
          service: 'cast-away-engine',
          version: BRIDGE_VERSION,
          uptime: Math.floor((Date.now() - startTime) / 1000),
          memory: {
            rss: rssMB,
            heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotal: Math.round(mem.heapTotal / 1024 / 1024)
          },
          timestamp: new Date().toISOString()
        });
        return;
      }

      // GET /api/settings
      if (req.method === 'GET' && pathname === '/api/settings') {
        const config = loadConfig();
        sendJson(res, { 
          ...config, 
          deviceId: DEVICE_ID,
          screensaverActive,
          circuitBreakerOpen: circuitBreakerState.isOpen,
          recoveryActive: recoveryCheckInterval !== null
        });
        return;
      }
      
      // POST /api/settings
      if (req.method === 'POST' && pathname === '/api/settings') {
        const body = await parseBody(req);
        const config = loadConfig();
        const newConfig = { ...config, ...body };
        const saved = saveConfig(newConfig);
        if (!saved) {
          sendJson(res, { error: 'Failed to save config' }, 500);
          return;
        }
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
        const devices = await discoverDevicesWithRetry();
        resetIPRecoveryBackoff();
        lastTakeoverTime = 0;
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
        maybeExpireDiscoveredDevices();
        sendJson(res, getStatusSnapshot());
        return;
      }
      
      // GET /api/version — required by Pi Control Center
      if (req.method === 'GET' && pathname === '/api/version') {
        sendJson(res, {
          name: 'cast-away',
          version: BRIDGE_VERSION,
          commit: GIT_COMMIT,
          commitShort: GIT_COMMIT_SHORT,
          branch: GIT_BRANCH
        });
        return;
      }

      // GET /api/logs
      if (req.method === 'GET' && pathname === '/api/logs') {
        sendJson(res, { logs: logBuffer });
        return;
      }
      
      // DELETE /api/logs
      if (req.method === 'DELETE' && pathname === '/api/logs') {
        logBuffer = [];
        sendJson(res, { success: true });
        return;
      }
      
      // POST /api/check
      if (req.method === 'POST' && pathname === '/api/check') {
        log.info('🔍 Manual check requested via API');
        const config = loadConfig();
        
        if (!config.selectedChromecast) {
          sendJson(res, { success: false, error: 'No Chromecast selected' }, 400);
          return;
        }

        // Bypass circuit breaker for manual checks
        log.info('⚡ [CIRCUIT] Manual check - bypassing circuit breaker');
        circuitBreakerState.isOpen = false;
        circuitBreakerState.failures = 0;
        resetIPRecoveryBackoff();

        // Fresh discovery to get current IP
        await discoverDevicesWithRetry();
        
        const result = await isChromecastIdleWithRecovery(config.selectedChromecast);
        
        if (result.status === 'idle' && config.enabled && config.url) {
          log.info('✅ Device idle - triggering cast...');
          try {
            await castMedia(config.selectedChromecast, config.url);
            sendJson(res, { success: true, status: 'cast_triggered', deviceStatus: result });
          } catch (error) {
            sendJson(res, { success: false, status: 'cast_failed', error: error.message, deviceStatus: result });
          }
        } else if (result.status === 'our_app') {
          sendJson(res, { success: true, status: 'already_running', deviceStatus: result });
        } else {
          sendJson(res, { success: true, status: result.status, deviceStatus: result });
        }
        return;
      }
      
      // POST /api/restart
      if (req.method === 'POST' && pathname === '/api/restart') {
        log.info('🔄 Restart requested via API');
        sendJson(res, { success: true, message: 'Restarting...' });
        setTimeout(() => { process.exit(0); }, 500);
        return;
      }
      
      // POST /api/force-stop
      if (req.method === 'POST' && pathname === '/api/force-stop') {
        log.info('🛑 Force stop requested - clearing zombie sessions...');
        const config = loadConfig();
        
        if (!config.selectedChromecast) {
          sendJson(res, { success: false, error: 'No Chromecast selected' }, 400);
          return;
        }
        
        const device = findDevice(config.selectedChromecast);
        if (!device) {
          sendJson(res, { success: false, error: 'Device not found' }, 404);
          return;
        }
        
        try {
          cleanupConnection();
          screensaverActive = false;
          
          const forceClient = new castv2.Client();
          
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              forceClient.close();
              reject(new Error('Force stop timeout'));
            }, 10000);
            
            forceClient.on('error', (err) => {
              clearTimeout(timeout);
              forceClient.close();
              reject(err);
            });
            
            forceClient.connect(device.host, () => {
              const connection = forceClient.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
              const receiver = forceClient.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.receiver', 'JSON');
              
              connection.send({ type: 'CONNECT' });
              receiver.send({ type: 'STOP', requestId: Date.now() });
              
              setTimeout(() => {
                connection.send({ type: 'CLOSE' });
                forceClient.close();
                clearTimeout(timeout);
                resolve();
              }, 1000);
            });
          });
          
          log.info('✅ Force stop completed - zombie sessions cleared');
          sendJson(res, { success: true, message: 'Force stop completed' });
        } catch (error) {
          log.error(`❌ Force stop failed: ${error.message}`);
          sendJson(res, { success: false, error: error.message }, 500);
        }
        return;
      }
      
      // POST /api/prepare-update
      if (req.method === 'POST' && pathname === '/api/prepare-update') {
        log.info('🔄 Preparing for update - pausing all activity...');
        
        updateInProgress = true;
        stopRecoveryCheck();
        
        const config = loadConfig();
        if (screensaverActive && config.selectedChromecast) {
          try {
            log.info('⏹️ Stopping active screensaver for update...');
            await stopCast(config.selectedChromecast);
          } catch (error) {
            log.warn(`⚠️ Could not stop cast: ${error.message}`);
          }
        }
        
        cleanupConnection();
        await sleep(2000);
        
        log.info('✅ Ready for update - all activity paused');
        sendJson(res, { 
          success: true, 
          message: 'Bridge paused for update',
          wasActive: screensaverActive 
        });
        return;
      }
      
      // POST /api/reset-recovery
      if (req.method === 'POST' && pathname === '/api/reset-recovery') {
        log.info('🔄 Manual recovery reset requested');
        resetIPRecoveryBackoff();
        circuitBreakerState.failures = 0;
        circuitBreakerState.isOpen = false;
        lastTakeoverTime = 0;
        lastErrorType = 'takeover';
        stopRecoveryCheck();
        sendJson(res, { success: true, message: 'Recovery state reset' });
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
  
  // No static file serving — return 404 for non-API routes
  res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
  res.end('Not Found — this is the engine API. UI is served on a separate port.');
});

// ============ Pi Zero 2 W Optimizations ============

// Periodic GC hint — helps keep memory low on 512MB device
function scheduleMemoryMaintenance() {
  setInterval(() => {
    const mem = process.memoryUsage();
    const { heapUsedMB: heapMB, rssMB } = getCompactMemoryStats(mem);
    
    if (!screensaverActive) {
      maybeExpireDiscoveredDevices();
    }

    if (heapMB > MEMORY_HEAP_WARN_MB || rssMB > MEMORY_RSS_WARN_MB) {
      log.warn(`⚠️ [MEMORY] High heap usage: ${heapMB}MB (RSS: ${rssMB}MB)`);
      trimLogBuffer(LOG_TRIM_TARGET);

      if (!screensaverActive) {
        maybeExpireDiscoveredDevices(true);
      }

      if (global.gc) {
        global.gc();
        log.debug(`[MEMORY] GC triggered: heap ${heapMB}MB, RSS ${rssMB}MB`);
      }
    }

    statusSnapshotCache = null;
  }, MEMORY_CHECK_INTERVAL_MS);
}

// CPU temperature monitoring (Pi-specific)
function getCPUTemp() {
  try {
    const temp = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8');
    return parseInt(temp.trim()) / 1000;
  } catch(e) {
    return null;
  }
}

// Healthcheck — write a heartbeat file to PCC log dir so the host can verify
// the process is alive without polling the HTTP port
const HEALTHCHECK_INTERVAL = 15_000; // 15 seconds
let healthcheckTimer = null;

function writeHealthcheck() {
  try {
    const mem = process.memoryUsage();
    const data = JSON.stringify({
      pid: process.pid,
      ts: Date.now(),
      uptime: Math.round(process.uptime()),
      port: PORT,
      heapMB: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
      active: screensaverActive
    });
    fs.writeFileSync(HEALTHCHECK_FILE, data);
  } catch(e) { /* /tmp write should never fail, but don't crash if it does */ }
}

function startHealthcheck() {
  writeHealthcheck(); // immediate first write
  healthcheckTimer = setInterval(writeHealthcheck, HEALTHCHECK_INTERVAL);
}

function stopHealthcheck() {
  if (healthcheckTimer) {
    clearInterval(healthcheckTimer);
    healthcheckTimer = null;
  }
  try { fs.unlinkSync(HEALTHCHECK_FILE); } catch(e) {}
}

// ============ Main Entry Point ============

async function main() {
  const config = loadConfig();
  
  const totalMemMB = Math.round(os.totalmem() / 1024 / 1024);
  const cpuCores = os.cpus().length;
  const cpuModel = os.cpus()[0]?.model || 'unknown';
  
  log.info(`🚀 Cast Away v${BRIDGE_VERSION} Engine starting...`);
  log.info(`📋 Device ID: ${DEVICE_ID}`);
  log.info(`🗂️ Config path: ${CONFIG_FILE}`);
  log.info(`💾 Data dir: ${DATA_DIR}`);
  log.info(`📝 Log dir: ${LOG_DIR}`);
  log.info(`🖥️ Hardware: ${cpuModel} (${cpuCores} cores, ${totalMemMB}MB RAM)`);
  log.info(`🔌 Engine port: ${PORT} | UI port: ${UI_PORT}`);
  log.info(`🎬 Custom App ID: ${CUSTOM_APP_ID}`);
  log.info(`⚡ Circuit breaker: ${config.circuitBreakerThreshold || 5} failures = ${config.circuitBreakerCooldown || 5}min pause`);
  
  const cpuTemp = getCPUTemp();
  if (cpuTemp !== null) {
    log.info(`🌡️ CPU Temperature: ${cpuTemp.toFixed(1)}°C`);
  }
  
  writeNetworkInfo();
  
  server.on('error', (err) => {
    log.error(`❌ HTTP server error: ${err.message}`);
  });
  
  const networkIP = getNetworkIP();
  server.listen(PORT, '0.0.0.0', () => {
    log.info(`🚀 Engine API running on:`);
    log.info(`   Local:   http://localhost:${PORT}`);
    log.info(`   Network: http://${networkIP}:${PORT}`);
  });
  
  await discoverDevices();
  await checkAndReconnectSavedDevice();
  startBackgroundDiscovery();
  
  const screensaverMs = (config.screensaverCheckInterval || 60) * 1000;
  setInterval(() => {
    statusSnapshotCache = null;
    checkAndActivateScreensaver();
  }, screensaverMs);
  
  // Pi memory maintenance
  scheduleMemoryMaintenance();
  
  // Healthcheck heartbeat file for Pi Dashboard
  startHealthcheck();
  
  // Graceful shutdown — handle both SIGINT and SIGTERM (systemd sends SIGTERM)
  const gracefulShutdown = (signal) => {
    log.info(`👋 Shutting down (${signal})...`);
    stopHealthcheck();
    destroyBonjour();
    server.close();
    stopRecoveryCheck();
    if (backgroundDiscoveryTimer) {
      clearInterval(backgroundDiscoveryTimer);
      backgroundDiscoveryTimer = null;
    }
    activeHeartbeats.forEach(h => clearInterval(h));
    if (client) {
      try { client.close(); } catch(e) {
      }
    }
    process.exit(0);
  };
  
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  
  process.on('uncaughtException', (err) => {
    log.error(`❌ Uncaught exception: ${err.message}`);
    log.error(err.stack || '');
    if (client) {
      try { client.close(); } catch(e) {
      }
      client = null;
    }
    screensaverActive = false;
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    log.error(`❌ Unhandled rejection: ${reason}`);
    if (client) {
      try { client.close(); } catch(e) {
      }
      client = null;
    }
    screensaverActive = false;
  });
}

main().catch((error) => {
  log.error('Fatal error:', error.message);
  process.exit(1);
});
