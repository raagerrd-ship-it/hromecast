require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const castv2 = require('castv2');
const Bonjour = require('bonjour-service').Bonjour;

// Version - keep in sync with src/config/version.ts
const BRIDGE_VERSION = '1.3.62';

// Update state - when true, pauses screensaver activation
let updateInProgress = false;

// Configuration
const CONFIG_FILE = path.join(__dirname, 'config.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = parseInt(process.env.PORT || '3000');
const DEVICE_ID = process.env.DEVICE_ID || 'default-bridge';
const SONOS_IP = process.env.SONOS_IP || '192.168.1.175';
const SUPABASE_PUSH_URL = process.env.SUPABASE_PUSH_URL || 'https://plwchuzidrjgyuepwdcl.supabase.co/functions/v1/sonos-bridge-push';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsd2NodXppZHJqZ3l1ZXB3ZGNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0ODUyOTIsImV4cCI6MjA3NTA2MTI5Mn0.p9giTnFOK-b0NqrB4ZqN-3CJEaAqMNy-KYvRZ6P_qS0';
const BRIDGE_SECRET = process.env.SONOS_BRIDGE_SECRET || 'Fasanvagen';
const CUSTOM_APP_ID = 'FE376873';
const BACKDROP_APP_ID = 'E8C28D3C';

// Initialize Bonjour
const bonjour = new Bonjour();

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
// lastLoggedCheckStatus removed in v1.3.30 - now using lastCheckMessages array

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

// Note: Cooldown and recovery intervals are now configurable via config

// Retry configuration
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

// Track active heartbeats for cleanup
const activeHeartbeats = new Set();

// In-memory log buffer (keep last 100 entries)
const LOG_BUFFER_SIZE = 100;
let logBuffer = [];

// Track last status check messages for deduplication
let lastCheckMessages = [];

// Track last URL refresh time (for refreshUrlInterval feature)
let lastUrlRefreshTime = Date.now();

// Default config with timing settings (all in seconds unless noted)
// Note: discoveryInterval removed - discovery only runs at start, on reconnect, and manually
const DEFAULT_CONFIG = {
  enabled: false,
  url: '',
  selectedChromecast: null,
  // Sökning & Discovery
  discoveryTimeout: 10,              // Max time to wait for discovery (seconds)
  discoveryEarlyResolve: 4,          // Early resolve if devices found (seconds)
  discoveryRetryDelay: 5,            // Delay between discovery retry attempts (seconds)
  discoveryMaxRetries: 3,            // Max number of discovery retry attempts
  // Cast & Session
  screensaverCheckInterval: 60,      // How often to check if device is idle (seconds)
  keepAliveInterval: 5,              // Keep-alive ping interval (seconds)
  idleStatusTimeout: 5,              // Timeout for idle check (seconds)
  castRetryDelay: 2,                 // Base delay for retry backoff (seconds)
  castMaxRetries: 3,                 // Max cast retry attempts
  receiverAutoRefresh: 45,           // Auto-refresh receiver (minutes) - URL sent 2 min before
  // Återhämtning & Skydd
  cooldownAfterTakeover: 30,         // Cooldown after another app takes over (seconds)
  recoveryCheckInterval: 10,         // How often to check for recovery (seconds)
  circuitBreakerThreshold: 5,        // Failures before circuit breaker opens
  circuitBreakerCooldown: 5          // Circuit breaker pause (minutes)
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

function addToLogBuffer(level, msg, args) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message: msg,
    category: categorizeLog(level, msg),
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
    // Always add to buffer (frontend filters based on user preference)
    // Only print to console if DEBUG env is set
    if (process.env.DEBUG) {
      console.log(`[DEBUG] ${new Date().toISOString()} - ${msg}`, ...args);
    }
    addToLogBuffer('debug', msg, args);
  }
};

// ============ Utility Functions ============

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ Sonos UPnP Helpers ============

function soapRequest(body, action, controlPath, serviceType) {
  controlPath = controlPath || '/MediaRenderer/AVTransport/Control';
  serviceType = serviceType || 'AVTransport';
  return new Promise((resolve, reject) => {
    const postData = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>${body}</s:Body>
</s:Envelope>`;
    
    const options = {
      hostname: SONOS_IP,
      port: 1400,
      path: controlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'SOAPAction': `"urn:schemas-upnp-org:service:${serviceType}:1#${action}"`,
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 2000
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    
    req.on('timeout', () => { req.destroy(); reject(new Error('SOAP request timeout')); });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function parseTime(timeStr) {
  if (!timeStr || timeStr === 'NOT_IMPLEMENTED') return null;
  const parts = timeStr.split(':');
  if (parts.length !== 3) return null;
  const [h, m, s] = parts.map(Number);
  if (isNaN(h) || isNaN(m) || isNaN(s)) return null;
  return (h * 3600 + m * 60 + s) * 1000;
}

function extractTag(xml, tag) {
  // Handle tags with attributes, e.g. <upnp:albumArtURI dlna:profileID="JPEG_TN">value</upnp:albumArtURI>
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapedTag}>`);
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function decodeXmlEntities(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractDidl(xml) {
  // Try entity-encoded first
  let didlMatch = xml.match(/&lt;DIDL-Lite[\s\S]*?&lt;\/DIDL-Lite&gt;/);
  let didl;
  if (didlMatch) {
    didl = decodeXmlEntities(didlMatch[0]);
  } else {
    // Try raw XML (e.g. from ContentDirectory Browse CDATA)
    didlMatch = xml.match(/<DIDL-Lite[\s\S]*?<\/DIDL-Lite>/);
    if (!didlMatch) return null;
    didl = didlMatch[0];
  }
  
  // Extract protocolInfo from <res protocolInfo="...">
  let protocolInfo = null;
  const resMatch = didl.match(/<res[^>]*protocolInfo="([^"]*)"[^>]*>/);
  if (resMatch) protocolInfo = resMatch[1];
  
  return {
    title: extractTag(didl, 'dc:title'),
    creator: extractTag(didl, 'dc:creator'),
    album: extractTag(didl, 'upnp:album'),
    albumArtURI: extractTag(didl, 'upnp:albumArtURI'),
    upnpClass: extractTag(didl, 'upnp:class'),
    originalTrackNumber: extractTag(didl, 'upnp:originalTrackNumber'),
    streamContent: extractTag(didl, 'r:streamContent'),
    radioShowMd: extractTag(didl, 'r:radioShowMd'),
    protocolInfo
  };
}

// Resolve next-track metadata with fallback to ContentDirectory Browse
async function resolveNextTrack(nextMeta, trackNumber, nrTracks) {
  let nextTrackName = null;
  let nextArtistName = null;
  let nextAlbumArtUri = null;
  let rawNextAlbumArtUri = null;

  // 1. Try NextAVTransportURIMetaData first
  if (nextMeta) {
    log.debug(`[SONOS] NextMeta present (${nextMeta.length} chars)`);
    let nextDidl = extractDidl(nextMeta);
    if (!nextDidl) nextDidl = extractDidl(decodeXmlEntities(nextMeta));
    if (nextDidl) {
      nextTrackName = nextDidl.title || null;
      nextArtistName = nextDidl.creator || null;
      log.debug(`[SONOS] Next from metadata: "${nextTrackName}" by "${nextArtistName}"`);
      if (nextDidl.albumArtURI) {
        rawNextAlbumArtUri = nextDidl.albumArtURI;
        nextAlbumArtUri = nextDidl.albumArtURI.startsWith('/')
          ? `/api/sonos${nextDidl.albumArtURI}`
          : `/api/sonos/art?url=${encodeURIComponent(nextDidl.albumArtURI)}`;
      }
    } else {
      log.debug(`[SONOS] NextMeta present but DIDL parse failed`);
    }
  } else {
    log.debug(`[SONOS] NextAVTransportURIMetaData is empty/null`);
  }

  // 2. Fallback: Browse queue at trackNumber + 1 via ContentDirectory
  if (!nextTrackName && trackNumber != null) {
    const nextIndex = parseInt(trackNumber, 10); // queue is 0-indexed, trackNumber is 1-indexed
    const total = nrTracks != null ? parseInt(nrTracks, 10) : 0;
    log.debug(`[SONOS] Next track fallback: trackNumber=${trackNumber}, nextIndex=${nextIndex}, total=${total}`);
    if (nextIndex < total) {
      try {
        const browseBody = `<u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
          <ObjectID>Q:0</ObjectID>
          <BrowseFlag>BrowseDirectChildren</BrowseFlag>
          <Filter>dc:title,dc:creator,upnp:album,upnp:albumArtURI,upnp:class</Filter>
          <StartingIndex>${nextIndex}</StartingIndex>
          <RequestedCount>1</RequestedCount>
          <SortCriteria></SortCriteria>
        </u:Browse>`;
        const browseXml = await soapRequest(browseBody, 'Browse', '/MediaServer/ContentDirectory/Control', 'ContentDirectory');
        const resultRaw = extractTag(browseXml, 'Result');
        if (resultRaw) {
          log.debug(`[SONOS] Browse result (${resultRaw.length} chars): ${resultRaw.substring(0, 200)}`);
          let browseDidl = extractDidl(resultRaw);
          if (!browseDidl) browseDidl = extractDidl(decodeXmlEntities(resultRaw));
          if (browseDidl) {
            nextTrackName = browseDidl.title || null;
            nextArtistName = browseDidl.creator || null;
            log.debug(`[SONOS] Next from browse: "${nextTrackName}" by "${nextArtistName}"`);
            if (browseDidl.albumArtURI) {
              rawNextAlbumArtUri = browseDidl.albumArtURI;
              nextAlbumArtUri = browseDidl.albumArtURI.startsWith('/')
                ? `/api/sonos${browseDidl.albumArtURI}`
                : `/api/sonos/art?url=${encodeURIComponent(browseDidl.albumArtURI)}`;
            }
          } else {
            log.debug(`[SONOS] Browse DIDL parse failed for result`);
          }
        } else {
          log.debug(`[SONOS] Browse returned no Result tag`);
        }
      } catch (err) {
        log.debug(`[SONOS] ContentDirectory browse fallback failed: ${err.message}`);
      }
    } else {
      log.debug(`[SONOS] No next track: nextIndex(${nextIndex}) >= total(${total})`);
    }
  }

  return { nextTrackName, nextArtistName, nextAlbumArtUri, rawNextAlbumArtUri };
}


// ============ Sonos UPnP Event Subscription (SSE) ============

let sonosEventClients = []; // SSE clients
let sonosSubscriptionSID = null;
let sonosSubscriptionRenewTimer = null;
let lastSonosEvent = null; // cache latest state for new SSE clients
let sonosIdleDebounceTimer = null;
let pendingSonosIdleEvent = null;
let pendingSonosIdleMeta = null;
let sonosTransitionRefreshTimer = null;
const SONOS_IDLE_DEBOUNCE_MS = 2000;
const SONOS_TRANSITION_REFRESH_MS = 700;
const SONOS_TRANSITION_MAX_REFRESHES = 3;

function getSonosTrackKey(eventData) {
  return [
    eventData?.trackURI || '',
    eventData?.trackNumber ?? '',
    eventData?.trackName || '',
    eventData?.artistName || ''
  ].join('|');
}

function getSonosPushSignature(eventData) {
  return `${getSonosTrackKey(eventData)}|${eventData?.playbackState || 'unknown'}`;
}

function isSonosTransitionState(transportState) {
  return transportState === 'TRANSITIONING';
}

function isSonosIdleCandidateTransportState(transportState) {
  return !transportState || transportState === 'STOPPED' || transportState === 'NO_MEDIA_PRESENT';
}

function getSonosPlaybackState(transportState) {
  if (transportState === 'PLAYING') return 'PLAYBACK_STATE_PLAYING';
  if (transportState === 'PAUSED_PLAYBACK') return 'PLAYBACK_STATE_PAUSED';
  if (transportState === 'TRANSITIONING') {
    if (lastSonosEvent?.playbackState && lastSonosEvent.playbackState !== 'PLAYBACK_STATE_IDLE') {
      return lastSonosEvent.playbackState;
    }
    return 'PLAYBACK_STATE_PLAYING';
  }
  if (transportState === 'STOPPED') {
    if (lastSonosEvent?.playbackState && lastSonosEvent.playbackState !== 'PLAYBACK_STATE_IDLE') {
      return lastSonosEvent.playbackState;
    }
    return 'PLAYBACK_STATE_PAUSED';
  }
  return 'PLAYBACK_STATE_IDLE';
}

function classifySonosIdleReason(transportState, eventData) {
  if (transportState === 'TRANSITIONING') return 'transition';

  const previousTrackKey = getSonosTrackKey(lastSonosEvent);
  const currentTrackKey = getSonosTrackKey(eventData);
  if (
    transportState === 'STOPPED' &&
    previousTrackKey &&
    currentTrackKey &&
    previousTrackKey !== currentTrackKey
  ) {
    return 'transition';
  }

  return 'stop-button';
}

function clearSonosTransitionRefresh() {
  if (sonosTransitionRefreshTimer) {
    clearTimeout(sonosTransitionRefreshTimer);
    sonosTransitionRefreshTimer = null;
  }
}

function cancelPendingSonosIdle(reason) {
  const hadPendingIdle = Boolean(sonosIdleDebounceTimer || pendingSonosIdleEvent);

  if (sonosIdleDebounceTimer) {
    clearTimeout(sonosIdleDebounceTimer);
    sonosIdleDebounceTimer = null;
  }

  pendingSonosIdleEvent = null;
  pendingSonosIdleMeta = null;

  if (hadPendingIdle) {
    log.info(`✅ [SONOS] Suppressed pending IDLE (${reason})`);
  }
}

function emitSonosEvent(eventData, rawAlbumArtUri, rawNextAlbumArtUri) {
  lastSonosEvent = eventData;
  broadcastSSE(eventData);
  pushToBridge(eventData, rawAlbumArtUri, rawNextAlbumArtUri);
}

function schedulePendingSonosIdle(eventData, meta) {
  pendingSonosIdleEvent = eventData;
  pendingSonosIdleMeta = meta;

  if (sonosIdleDebounceTimer) {
    clearTimeout(sonosIdleDebounceTimer);
  }

  sonosIdleDebounceTimer = setTimeout(() => {
    const idleEvent = pendingSonosIdleEvent;
    const idleMeta = pendingSonosIdleMeta;

    pendingSonosIdleEvent = null;
    pendingSonosIdleMeta = null;
    sonosIdleDebounceTimer = null;
    clearSonosTransitionRefresh();

    if (!idleEvent) return;

    const emittedIdleEvent = {
      ...idleEvent,
      playbackState: 'PLAYBACK_STATE_IDLE',
      timestamp: Date.now()
    };

    log.warn(`⚠️ [SONOS] Emitting IDLE after ${SONOS_IDLE_DEBOUNCE_MS}ms debounce (${idleMeta?.reason || 'unknown'}, transport=${idleMeta?.transportState || 'unknown'})`);
    emitSonosEvent(
      emittedIdleEvent,
      idleMeta?.rawAlbumArtUri || null,
      idleMeta?.rawNextAlbumArtUri || null
    );
  }, SONOS_IDLE_DEBOUNCE_MS);
}

function scheduleSonosTransitionRefresh(refreshCount) {
  if (refreshCount > SONOS_TRANSITION_MAX_REFRESHES) return;

  clearSonosTransitionRefresh();
  sonosTransitionRefreshTimer = setTimeout(() => {
    sonosTransitionRefreshTimer = null;
    handleSonosUPnPEvent({ source: 'transition-refresh', refreshCount });
  }, SONOS_TRANSITION_REFRESH_MS);
}

// Subscribe to Sonos AVTransport events
function subscribeSonosEvents() {
  const networkIP = getNetworkIP();
  const callbackUrl = `<http://${networkIP}:${PORT}/api/sonos/upnp-callback>`;
  
  const options = {
    hostname: SONOS_IP,
    port: 1400,
    path: '/MediaRenderer/AVTransport/Event',
    method: 'SUBSCRIBE',
    headers: {
      'CALLBACK': callbackUrl,
      'NT': 'upnp:event',
      'TIMEOUT': 'Second-300'
    },
    timeout: 5000
  };
  
  const req = http.request(options, (res) => {
    const sid = res.headers['sid'];
    if (sid) {
      sonosSubscriptionSID = sid;
      log.info(`📡 [SONOS] Subscribed to AVTransport events, SID: ${sid}`);
      clearTimeout(sonosSubscriptionRenewTimer);
      sonosSubscriptionRenewTimer = setTimeout(() => renewSonosSubscription(), 240000);
    } else {
      log.warn('⚠️ [SONOS] Subscribe response missing SID');
    }
  });
  
  req.on('error', (err) => {
    log.error(`❌ [SONOS] Subscribe error: ${err.message}`);
    setTimeout(() => subscribeSonosEvents(), 30000);
  });
  
  req.on('timeout', () => {
    req.destroy();
    log.error('❌ [SONOS] Subscribe timeout');
    setTimeout(() => subscribeSonosEvents(), 30000);
  });
  
  req.end();
}

function renewSonosSubscription() {
  if (!sonosSubscriptionSID) {
    subscribeSonosEvents();
    return;
  }
  
  const options = {
    hostname: SONOS_IP,
    port: 1400,
    path: '/MediaRenderer/AVTransport/Event',
    method: 'SUBSCRIBE',
    headers: {
      'SID': sonosSubscriptionSID,
      'TIMEOUT': 'Second-300'
    },
    timeout: 5000
  };
  
  const req = http.request(options, (res) => {
    if (res.statusCode === 200) {
      log.info(`🔄 [SONOS] Subscription renewed, SID: ${sonosSubscriptionSID}`);
      clearTimeout(sonosSubscriptionRenewTimer);
      sonosSubscriptionRenewTimer = setTimeout(() => renewSonosSubscription(), 240000);
    } else {
      log.warn(`⚠️ [SONOS] Renewal failed (${res.statusCode}), re-subscribing...`);
      sonosSubscriptionSID = null;
      subscribeSonosEvents();
    }
  });
  
  req.on('error', (err) => {
    log.error(`❌ [SONOS] Renewal error: ${err.message}, re-subscribing...`);
    sonosSubscriptionSID = null;
    setTimeout(() => subscribeSonosEvents(), 5000);
  });
  
  req.on('timeout', () => {
    req.destroy();
    sonosSubscriptionSID = null;
    setTimeout(() => subscribeSonosEvents(), 5000);
  });
  
  req.end();
}

// ============ Bridge Push to brew-monitor ============

let lastPushedTrack = null;

// Fetch image from local Sonos and upload to brew-monitor-tv's sonos-backgrounds bucket
async function fetchAndUploadArt(rawUri, filename) {
  if (!rawUri || !SUPABASE_PUSH_URL || !SUPABASE_ANON_KEY) return null;
  
  const decodedRawUri = decodeXmlEntities(String(rawUri).trim());

  let localUrl = decodedRawUri;
  if (decodedRawUri.startsWith('/')) localUrl = `http://${SONOS_IP}:1400${decodedRawUri}`;
  else if (!decodedRawUri.startsWith('http')) return null;
  
  try {
    log.info(`📥 [PUSH] Fetching art for ${filename}: ${localUrl}`);
    const imageBuffer = await new Promise((resolve, reject) => {
      const mod = localUrl.startsWith('https') ? require('https') : http;
      mod.get(localUrl, { timeout: 3000 }, (res) => {
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
    });
    
    if (imageBuffer.length < 500) {
      log.debug(`[PUSH] Image too small (${imageBuffer.length}b), skipping`);
      return null;
    }
    
    const https = require('https');
    const supabaseHost = new URL(SUPABASE_PUSH_URL).hostname;
    const storagePath = `/storage/v1/object/sonos-backgrounds/${filename}`;
    
    return await new Promise((resolve) => {
      const req = https.request({
        hostname: supabaseHost,
        path: storagePath,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'image/jpeg',
          'Content-Length': imageBuffer.length,
          'x-upsert': 'true'
        },
        timeout: 5000
      }, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            const publicUrl = `https://${supabaseHost}/storage/v1/object/public/sonos-backgrounds/${filename}`;
            log.info(`📤 [PUSH] Art uploaded: ${filename} (${imageBuffer.length}b)`);
            resolve(publicUrl);
          } else {
            log.warn(`⚠️ [PUSH] Art upload failed (${res.statusCode}): ${body.substring(0, 200)}`);
            resolve(null);
          }
        });
      });
      req.on('error', (e) => { log.warn(`⚠️ [PUSH] Art upload request error: ${e.message}`); resolve(null); });
      req.on('timeout', () => { req.destroy(); log.warn('⚠️ [PUSH] Art upload timeout'); resolve(null); });
      req.write(imageBuffer);
      req.end();
    });
  } catch (err) {
    log.warn(`⚠️ [PUSH] Art fetch/upload failed for ${filename}: ${err.message}`);
    return null;
  }
}

async function pushToBridge(eventData, rawAlbumArtUri, rawNextAlbumArtUri) {
  if (!SUPABASE_PUSH_URL || !BRIDGE_SECRET) return;
  
  const pushSignature = getSonosPushSignature(eventData);
  if (pushSignature === lastPushedTrack) return;
  lastPushedTrack = pushSignature;
  
  log.info(`📤 [PUSH] Pushing ${eventData.playbackState}: "${eventData.trackName}" | next: "${eventData.nextTrackName || 'NONE'}" by "${eventData.nextArtistName || 'NONE'}"`);
  log.debug(`[PUSH] rawAlbumArtUri: ${rawAlbumArtUri || 'null'}, rawNextAlbumArtUri: ${rawNextAlbumArtUri || 'null'}`);
  
  const [albumArtUrl, nextAlbumArtUrl] = await Promise.all([
    fetchAndUploadArt(rawAlbumArtUri, 'bridge-current.jpg'),
    fetchAndUploadArt(rawNextAlbumArtUri, 'bridge-next.jpg')
  ]);
  
  const payload = JSON.stringify({
    trackName: eventData.trackName,
    artistName: eventData.artistName,
    albumName: eventData.albumName,
    albumArtUri: albumArtUrl,
    nextTrackName: eventData.nextTrackName,
    nextArtistName: eventData.nextArtistName,
    nextAlbumArtUri: nextAlbumArtUrl,
    playbackState: eventData.playbackState,
    positionMillis: eventData.positionMillis,
    durationMillis: eventData.durationMillis,
    volume: eventData.volume,
    mute: eventData.mute,
    bass: eventData.bass,
    treble: eventData.treble,
    loudness: eventData.loudness,
    crossfade: eventData.crossfade,
    mediaType: eventData.mediaType,
    trackNumber: eventData.trackNumber,
    trackURI: eventData.trackURI,
    nrTracks: eventData.nrTracks,
    currentURI: eventData.currentURI,
    nextAVTransportURI: eventData.nextAVTransportURI,
    playMedium: eventData.playMedium,
    streamContent: eventData.streamContent,
    radioShowMd: eventData.radioShowMd,
    originalTrackNumber: eventData.originalTrackNumber,
    protocolInfo: eventData.protocolInfo,
    pushedAt: Date.now()
  });
  
  const url = new URL(SUPABASE_PUSH_URL);
  const options = {
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'X-Bridge-Secret': BRIDGE_SECRET,
      'Content-Length': Buffer.byteLength(payload)
    },
    timeout: 5000
  };
  
  const https = require('https');
  const req = https.request(options, (res) => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      if (res.statusCode === 200) {
        log.info(`📤 [PUSH] Track pushed to brew-monitor: ${eventData.trackName}`);
      } else {
        log.warn(`⚠️ [PUSH] Push failed (${res.statusCode}): ${body}`);
      }
    });
  });
  
  req.on('error', (err) => {
    log.debug(`[PUSH] Push error: ${err.message}`);
  });
  
  req.on('timeout', () => {
    req.destroy();
    log.debug('[PUSH] Push timeout');
  });
  
  req.write(payload);
  req.end();
}

// When we receive a UPnP event, fetch full status and broadcast to SSE clients
async function handleSonosUPnPEvent({ source = 'upnp-event', refreshCount = 0 } = {}) {
  try {
    const posBody = `<u:GetPositionInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID></u:GetPositionInfo>`;
    const transBody = `<u:GetTransportInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID></u:GetTransportInfo>`;
    const mediaBody = `<u:GetMediaInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID></u:GetMediaInfo>`;
    const volBody = `<u:GetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0</InstanceID><Channel>Master</Channel></u:GetVolume>`;
    const muteBody = `<u:GetMute xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0</InstanceID><Channel>Master</Channel></u:GetMute>`;
    const bassBody = `<u:GetBass xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0</InstanceID></u:GetBass>`;
    const trebleBody = `<u:GetTreble xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0</InstanceID></u:GetTreble>`;
    const loudnessBody = `<u:GetLoudness xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0</InstanceID><Channel>Master</Channel></u:GetLoudness>`;
    const crossfadeBody = `<u:GetCrossfadeMode xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID></u:GetCrossfadeMode>`;
    
    const [posXml, transXml, mediaXml, volXml, muteXml, bassXml, trebleXml, loudnessXml, crossfadeXml] = await Promise.all([
      soapRequest(posBody, 'GetPositionInfo'),
      soapRequest(transBody, 'GetTransportInfo'),
      soapRequest(mediaBody, 'GetMediaInfo'),
      soapRequest(volBody, 'GetVolume', '/MediaRenderer/RenderingControl/Control', 'RenderingControl').catch(() => null),
      soapRequest(muteBody, 'GetMute', '/MediaRenderer/RenderingControl/Control', 'RenderingControl').catch(() => null),
      soapRequest(bassBody, 'GetBass', '/MediaRenderer/RenderingControl/Control', 'RenderingControl').catch(() => null),
      soapRequest(trebleBody, 'GetTreble', '/MediaRenderer/RenderingControl/Control', 'RenderingControl').catch(() => null),
      soapRequest(loudnessBody, 'GetLoudness', '/MediaRenderer/RenderingControl/Control', 'RenderingControl').catch(() => null),
      soapRequest(crossfadeBody, 'GetCrossfadeMode').catch(() => null)
    ]);
    
    let volume = null;
    if (volXml) {
      const volStr = extractTag(volXml, 'CurrentVolume');
      if (volStr !== null) volume = parseInt(volStr, 10);
    }
    let mute = null;
    if (muteXml) {
      const muteStr = extractTag(muteXml, 'CurrentMute');
      if (muteStr !== null) mute = muteStr === '1';
    }
    let bass = null;
    if (bassXml) {
      const bassStr = extractTag(bassXml, 'CurrentBass');
      if (bassStr !== null) bass = parseInt(bassStr, 10);
    }
    let treble = null;
    if (trebleXml) {
      const trebleStr = extractTag(trebleXml, 'CurrentTreble');
      if (trebleStr !== null) treble = parseInt(trebleStr, 10);
    }
    let loudness = null;
    if (loudnessXml) {
      const loudnessStr = extractTag(loudnessXml, 'CurrentLoudness');
      if (loudnessStr !== null) loudness = loudnessStr === '1';
    }
    
    const relTime = extractTag(posXml, 'RelTime');
    const trackDuration = extractTag(posXml, 'TrackDuration');
    const trackNumber = extractTag(posXml, 'Track');
    const trackURI = extractTag(posXml, 'TrackURI');
    const absTime = extractTag(posXml, 'AbsTime');
    const didl = extractDidl(posXml);
    const transportState = extractTag(transXml, 'CurrentTransportState');
    const currentTransportStatus = extractTag(transXml, 'CurrentTransportStatus');
    const currentSpeed = extractTag(transXml, 'CurrentSpeed');
    let crossfade = null;
    if (crossfadeXml) {
      const cfStr = extractTag(crossfadeXml, 'CrossfadeMode');
      if (cfStr !== null) crossfade = cfStr === '1';
    }
    
    const playbackState = getSonosPlaybackState(transportState);
    let albumArtUri = null;
    if (didl && didl.albumArtURI) {
      let artUrl = didl.albumArtURI;
      if (artUrl.startsWith('/')) {
        albumArtUri = `/api/sonos${artUrl}`;
      } else if (artUrl.startsWith('http')) {
        albumArtUri = `/api/sonos/art?url=${encodeURIComponent(artUrl)}`;
      }
    }
    
    const nrTracks = extractTag(mediaXml, 'NrTracks');
    const currentURI = extractTag(mediaXml, 'CurrentURI');
    const nextAVTransportURI = extractTag(mediaXml, 'NextAVTransportURI');
    const playMedium = extractTag(mediaXml, 'PlayMedium');
    const nextMeta = extractTag(mediaXml, 'NextAVTransportURIMetaData');
    const { nextTrackName, nextArtistName, nextAlbumArtUri, rawNextAlbumArtUri } = await resolveNextTrack(nextMeta, trackNumber, nrTracks);
    
    const mediaType = didl?.upnpClass?.includes('audioBroadcast') ? 'radio' : 'track';
    cachedMediaType = mediaType;
    cachedBass = bass;
    cachedTreble = treble;
    cachedLoudness = loudness;
    cachedCrossfade = crossfade;
    
    const eventData = {
      ok: true,
      source,
      playbackState,
      positionMillis: parseTime(relTime),
      durationMillis: parseTime(trackDuration),
      trackName: didl ? didl.title : null,
      artistName: didl ? didl.creator : null,
      albumName: didl ? didl.album : null,
      albumArtUri,
      nextTrackName,
      nextArtistName,
      nextAlbumArtUri,
      volume,
      mute,
      bass,
      treble,
      loudness,
      mediaType,
      trackNumber: trackNumber ? parseInt(trackNumber, 10) : null,
      trackURI,
      absTime,
      currentSpeed,
      currentTransportStatus,
      crossfade,
      nrTracks: nrTracks ? parseInt(nrTracks, 10) : null,
      currentURI,
      nextAVTransportURI,
      playMedium,
      streamContent: didl ? didl.streamContent : null,
      radioShowMd: didl ? didl.radioShowMd : null,
      originalTrackNumber: didl?.originalTrackNumber ? parseInt(didl.originalTrackNumber, 10) : null,
      protocolInfo: didl ? didl.protocolInfo : null,
      timestamp: Date.now()
    };

    if (transportState === 'PLAYING' || transportState === 'PAUSED_PLAYBACK') {
      cancelPendingSonosIdle(`received ${transportState}`);
      clearSonosTransitionRefresh();
      emitSonosEvent(eventData, didl?.albumArtURI || null, rawNextAlbumArtUri);
      return;
    }

    if (isSonosTransitionState(transportState) || isSonosIdleCandidateTransportState(transportState)) {
      const idleReason = classifySonosIdleReason(transportState, eventData);
      schedulePendingSonosIdle(eventData, {
        reason: idleReason,
        transportState,
        rawAlbumArtUri: didl?.albumArtURI || null,
        rawNextAlbumArtUri
      });

      if (idleReason === 'transition' && refreshCount < SONOS_TRANSITION_MAX_REFRESHES) {
        log.info(`🔄 [SONOS] Waiting for PLAYING after ${transportState || 'UNKNOWN'} (${refreshCount + 1}/${SONOS_TRANSITION_MAX_REFRESHES})`);
        scheduleSonosTransitionRefresh(refreshCount + 1);
      }
      return;
    }

    cancelPendingSonosIdle(`received ${transportState || 'UNKNOWN'}`);
    clearSonosTransitionRefresh();
    emitSonosEvent(eventData, didl?.albumArtURI || null, rawNextAlbumArtUri);
  } catch (err) {
    log.error(`❌ [SONOS] Event handler error: ${err.message}`);
  }
}

// Broadcast position via SSE every 250ms (UPnP events don't fire on position changes)
let positionBroadcastTimer = null;
let cachedMediaType = 'track'; // updated by UPnP events, reused by position-tick
let cachedBass = null;
let cachedTreble = null;
let cachedLoudness = null;
let cachedCrossfade = null;

function startPositionBroadcast() {
  if (positionBroadcastTimer) return;
  positionBroadcastTimer = setInterval(async () => {
    if (sonosEventClients.length === 0) return; // no listeners
    try {
      const posBody = `<u:GetPositionInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID></u:GetPositionInfo>`;
      const volBody = `<u:GetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0</InstanceID><Channel>Master</Channel></u:GetVolume>`;
      const muteBody = `<u:GetMute xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0</InstanceID><Channel>Master</Channel></u:GetMute>`;
      const [posXml, volXml, muteXml] = await Promise.all([
        soapRequest(posBody, 'GetPositionInfo'),
        soapRequest(volBody, 'GetVolume', '/MediaRenderer/RenderingControl/Control', 'RenderingControl').catch(() => null),
        soapRequest(muteBody, 'GetMute', '/MediaRenderer/RenderingControl/Control', 'RenderingControl').catch(() => null)
      ]);
      let volume = null;
      if (volXml) {
        const volStr = extractTag(volXml, 'CurrentVolume');
        if (volStr !== null) volume = parseInt(volStr, 10);
      }
      let mute = null;
      if (muteXml) {
        const muteStr = extractTag(muteXml, 'CurrentMute');
        if (muteStr !== null) mute = muteStr === '1';
      }
      const relTime = extractTag(posXml, 'RelTime');
      const trackDuration = extractTag(posXml, 'TrackDuration');
      broadcastSSE({
        ok: true,
        source: 'position-tick',
        positionMillis: parseTime(relTime),
        durationMillis: parseTime(trackDuration),
        volume,
        mute,
        mediaType: cachedMediaType,
        bass: cachedBass,
        treble: cachedTreble,
        loudness: cachedLoudness,
        crossfade: cachedCrossfade
      });
    } catch { /* ignore */ }
  }, 250);
}

// Periodic status push to brew-monitor every 30s (keeps remote UI in sync)
const PERIODIC_PUSH_INTERVAL_MS = 30000;
let periodicPushTimer = null;

function startPeriodicPush() {
  if (periodicPushTimer) return;
  periodicPushTimer = setInterval(async () => {
    if (!lastSonosEvent) return;
    // Only push periodically while playing — PAUSED/IDLE get a single event-driven push
    if (lastSonosEvent.playbackState !== 'PLAYBACK_STATE_PLAYING') {
      log.debug(`[PUSH] Periodic: skipped (state=${lastSonosEvent.playbackState})`);
      return;
    }
    // Fetch fresh position from Sonos before pushing
    try {
      const posBody = `<u:GetPositionInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID></u:GetPositionInfo>`;
      const posXml = await soapRequest(posBody, 'GetPositionInfo');
      const relTime = extractTag(posXml, 'RelTime');
      const trackDuration = extractTag(posXml, 'TrackDuration');
      const freshPosition = parseTime(relTime);
      const freshDuration = parseTime(trackDuration);
      // Update lastSonosEvent with fresh position
      lastSonosEvent.positionMillis = freshPosition;
      if (freshDuration != null) lastSonosEvent.durationMillis = freshDuration;
      log.debug(`[PUSH] Periodic: fresh position ${freshPosition}ms, duration ${freshDuration}ms`);
    } catch (e) {
      log.warn(`[PUSH] Periodic: failed to fetch fresh position, using cached: ${e.message}`);
    }
    // Force push by temporarily clearing the signature
    lastPushedTrack = null;
    // Push current state (will re-upload art if available)
    pushToBridge(lastSonosEvent, null, null).then(() => {
      log.debug(`[PUSH] Periodic status push complete (${lastSonosEvent.playbackState})`);
    }).catch(() => {});
  }, PERIODIC_PUSH_INTERVAL_MS);
  log.info(`📤 [PUSH] Periodic push started (every ${PERIODIC_PUSH_INTERVAL_MS / 1000}s)`);
}

function stopPeriodicPush() {
  if (periodicPushTimer) {
    clearInterval(periodicPushTimer);
    periodicPushTimer = null;
  }
}

function broadcastSSE(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sonosEventClients = sonosEventClients.filter(client => {
    try {
      client.write(msg);
      return true;
    } catch (e) {
      return false;
    }
  });
}

// Calculate exponential backoff delay: base * 2^attempt (1s, 2s, 4s, 8s...)
function getBackoffDelay(attempt) {
  const delay = BASE_DELAY_MS * Math.pow(2, attempt);
  // Add jitter (±25%) to prevent thundering herd
  const jitter = delay * 0.25 * (Math.random() - 0.5);
  return Math.min(delay + jitter, 30000); // Cap at 30 seconds
}

// Automatic zombie session cleanup - sends STOP to Chromecast, then optionally reconnects
async function autoForceStop(deviceHost, reason = 'zombie cleanup', autoReconnect = true) {
  log.info(`🛑 Auto force-stop: ${reason}`);
  
  const success = await new Promise((resolve) => {
    const forceClient = new castv2.Client();
    const timeout = setTimeout(() => {
      try { forceClient.close(); } catch(e) {}
      log.warn('⚠️ Force-stop timeout');
      resolve(false);
    }, 8000);
    
    forceClient.on('error', (err) => {
      clearTimeout(timeout);
      try { forceClient.close(); } catch(e) {}
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
  
  // Auto-reconnect after successful force-stop
  if (success && autoReconnect) {
    log.info('🔄 Auto-reconnecting after force-stop...');
    // Small delay to let Chromecast settle
    await sleep(2000);
    const config = loadConfig();
    if (config.enabled && config.url && config.selectedChromecast) {
      // Trigger screensaver activation
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
      // Half-open: allow one attempt
      log.info('⚡ [CIRCUIT] Half-open - allowing one attempt');
      circuitBreakerState.isOpen = false;
      circuitBreakerState.failures = 0;
      return 'half-open'; // Signal that we just transitioned
    } else {
      const remainingSec = Math.ceil((cooldownMs - elapsed) / 1000);
      log.debug(`⚡ [CIRCUIT] Open - skipping attempt (${remainingSec}s remaining)`);
      return false; // Circuit is open, skip
    }
  }
  return true; // OK to try
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
    return maintenanceInterval; // 1 hour in maintenance mode
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
  if (recoveryCheckInterval) return; // Already running
  
  const config = loadConfig();
  const recoveryIntervalMs = (config.recoveryCheckInterval || 10) * 1000;
  const cooldownMs = (config.cooldownAfterTakeover || 30) * 1000;
  
  log.info('🔄 Starting recovery check with exponential backoff...');
  
  recoveryCheckInterval = setInterval(async () => {
    const timeSinceTakeover = Date.now() - lastTakeoverTime;
    
    // Skip cooldown if last error was a network error or silent disconnect
    const skipCooldown = lastErrorType === 'network_error' || lastErrorType === 'silent_disconnect';
    
    // Still in cooldown?
    if (!skipCooldown && timeSinceTakeover < cooldownMs) {
      const remainingSecs = Math.ceil((cooldownMs - timeSinceTakeover) / 1000);
      log.debug(`⏸️ [RECOVERY] Cooldown: ${remainingSecs}s remaining`);
      return;
    }
    
    // Check if we should attempt based on backoff
    if (!canAttemptIPRecovery()) {
      const waitTime = ipRecoveryState.currentInterval - (Date.now() - ipRecoveryState.lastAttemptTime);
      const waitDisplay = waitTime >= 60000 
        ? `${Math.ceil(waitTime / 60000)}min`
        : `${Math.ceil(waitTime / 1000)}s`;
      log.debug(`⏳ [RECOVERY] Backoff active, next attempt in ${waitDisplay}`);
      return;
    }
    
    // Cooldown over - check if device is idle
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
      // Device unreachable - trigger rediscovery with retry
      log.info('🔄 [RECOVERY] Device unreachable, triggering rediscovery...');
      const devices = await discoverDevicesWithRetry();
      
      // Check if device was found with new IP
      const device = findDevice(currentConfig.selectedChromecast);
      if (device) {
        log.info(`✅ [RECOVERY] Device "${currentConfig.selectedChromecast}" found at ${device.host} - reconnecting now!`);
        resetIPRecoveryBackoff();
        stopRecoveryCheck();
        // Immediately try to reconnect
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

// Helper to log screensaver stop and start recovery
function logScreensaverStop(reason = 'takeover') {
  if (!screensaverActive) return;
  
  screensaverActive = false;
  lastTakeoverTime = Date.now();
  lastErrorType = reason;
  
  const cooldownMsg = reason === 'network_error' || reason === 'silent_disconnect' 
    ? 'no cooldown (network error)' 
    : 'cooldown started';
  log.info(`⏹️ Screensaver stopped (${reason}) - ${cooldownMsg}`);
  
  // For network errors and silent disconnects, try immediate reconnect
  if (reason === 'network_error' || reason === 'silent_disconnect') {
    log.info('🔄 Network error detected - attempting immediate reconnect...');
    immediateReconnect();
  } else {
    startRecoveryCheck();
  }
}

// Immediate reconnect attempt after network error
async function immediateReconnect() {
  const config = loadConfig();
  if (!config.enabled || !config.url || !config.selectedChromecast) {
    log.warn('⚠️ Cannot reconnect - missing config');
    startRecoveryCheck();
    return;
  }
  
  // Wait a moment for any cleanup to complete
  await sleep(2000);
  
  // First check if device is reachable
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
  const info = `Chromecast Bridge - Nätverksinfo
================================
Startad: ${new Date().toLocaleString('sv-SE')}
Device ID: ${DEVICE_ID}

Åtkomst från denna dator:
  http://localhost:${PORT}

Åtkomst från mobil/annan enhet:
  http://${ip}:${PORT}
`;
  try {
    fs.writeFileSync(path.join(__dirname, 'network-info.txt'), info.trim());
  } catch (error) {
    log.error('Could not write network-info.txt:', error.message);
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
    log.error('Error loading config:', error.message);
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    return true;
  } catch (error) {
    log.error('Error saving config:', error.message);
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
    const earlyResolveMs = (config.discoveryEarlyResolve || 4) * 1000;
    const maxTimeoutMs = (config.discoveryTimeout || 10) * 1000;
    
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
    
    // Max timeout - keep cached devices if none found
    setTimeout(() => {
      clearTimeout(earlyResolveTimeout);
      if (!resolved) {
        resolved = true;
        browser.stop();
        
        // If no devices found, keep the cached ones
        if (foundDevices.length === 0 && discoveredDevices.length > 0) {
          log.info(`📡 Discovery timeout, keeping ${discoveredDevices.length} cached device(s)`);
          resolve(discoveredDevices);
        } else {
          discoveredDevices = foundDevices;
          log.info(`📡 Discovery complete: ${foundDevices.length} device(s)`);
          resolve(foundDevices);
        }
      }
    }, maxTimeoutMs);
  });
}

// Discovery with automatic retry for refresh endpoint
async function discoverDevicesWithRetry(maxRetriesOverride = null) {
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

// Check if saved device is available and reconnect if needed
async function checkAndReconnectSavedDevice() {
  const config = loadConfig();
  
  // Only if we have a saved device and screensaver is enabled but not active
  if (!config.selectedChromecast || !config.enabled || !config.url) {
    return;
  }
  
  // Skip if already active
  if (screensaverActive) {
    return;
  }
  
  // Skip if in recovery mode (recovery loop handles this)
  if (recoveryCheckInterval) {
    return;
  }
  
  // Check if our saved device is now available
  const device = findDevice(config.selectedChromecast);
  if (device) {
    log.info(`🔗 Saved device "${config.selectedChromecast}" found at ${device.host} - checking status...`);
    
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

// Note: periodicDiscoveryWithReconnect removed - discovery now only runs at start/recovery/manual

// ============ Chromecast Control using raw castv2 ============

function findDevice(name) {
  return discoveredDevices.find(d => d.name === name) || null;
}

// Check if Chromecast is idle with recovery logic
async function isChromecastIdleWithRecovery(deviceName, retryCount = 0) {
  // Check circuit breaker first (called from isChromecastIdleWithRecovery, accept truthy)
  const cbState = checkCircuitBreaker();
  if (cbState === false) {
    return { status: 'circuit_open' };
  }
  
  const device = findDevice(deviceName);
  if (!device) {
    log.warn('⚠️ Device not found for idle check:', deviceName);
    return { status: 'error' };
  }
  
  // Apply backoff for retries
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
      
      // Retry with backoff
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
      
      // Retry with backoff on connection errors (including ECONNRESET)
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
      
      // If we thought app was running but got connection reset, auto force-stop
      if (screensaverActive && (err.message.includes('ECONNRESET') || err.message.includes('EPIPE'))) {
        log.warn('⚠️ Connection reset while app was "active" - likely zombie session');
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
          
          // Build result with app details for logging
          const appList = apps.length === 0 ? 'none' : apps.map(a => `${a.displayName || 'unknown'}(${a.appId})`).join(', ');
          
          let result;
          if (ourAppRunning) {
            screensaverActive = true; // Sync local state with device state
            result = { status: 'our_app', appList };
          } else if (otherApps.length === 0) {
            result = { status: 'idle', appList };
          } else {
            const appNames = otherApps.map(a => a.displayName || a.appId);
            result = { status: 'busy', apps: appNames, appList };
          }
          
          // Update last device check
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

// Note: isChromecastIdle() removed in v1.3.24 - was unused legacy wrapper

// Cast media using raw castv2 with retry and circuit breaker
async function castMedia(chromecastName, url, retryCount = 0) {
  // Check circuit breaker first (accept truthy = allowed)
  if (checkCircuitBreaker() === false) {
    throw new Error('Circuit breaker open - connection attempts paused');
  }
  
  const device = findDevice(chromecastName);
  if (!device) {
    throw new Error(`Device "${chromecastName}" not found`);
  }
  
  // Apply backoff for retries
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
      
      // If ECONNRESET while supposedly active, trigger auto force-stop first
      if (screensaverActive && (err.message.includes('ECONNRESET') || err.message.includes('EPIPE'))) {
        log.warn('⚠️ Connection reset - clearing potential zombie session');
        screensaverActive = false;
        await autoForceStop(device.host, 'ECONNRESET during cast');
      }
      
      // Retry with backoff
      if (retryCount < MAX_RETRIES) {
        log.info(`🔄 Will retry (${retryCount + 1}/${MAX_RETRIES})...`);
        try {
          const result = await castMedia(chromecastName, url, retryCount + 1);
          resolve(result);
        } catch (retryErr) {
          reject(retryErr);
        }
      } else {
        // Mark as network error for faster recovery
        logScreensaverStop('network_error');
        reject(new Error(`Connection failed after ${MAX_RETRIES} retries: ${err.message}`));
      }
    });
    
    client.on('close', () => {
      log.info('🔌 Connection closed');
      cleanup();
      
      // If we thought we were active, do an immediate status check
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
              // Start normal recovery for other statuses
              logScreensaverStop('network_error');
            }
          }
        }, 3000); // Wait 3 seconds for cleanup
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
      
      // ============ SIMPLE HEARTBEAT (matching v1.0.19) ============
      // The previous aggressive watchdog implementation was causing false disconnects.
      // v1.0.19 used a simple PING-only approach that was stable for weeks.
      
      const config = loadConfig();
      const heartbeatMs = (config.keepAliveInterval || 5) * 1000;
      
      // Simple heartbeat: just send PING every interval
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
            try { client.close(); } catch(err) {}
            client = null;
          }
          if (screensaverActive) {
            logScreensaverStop('network_error');
          }
        }
      }, heartbeatMs);
      activeHeartbeats.add(heartbeatInterval);
      
      // Silent PONG handler - only log errors
      heartbeat.on('message', () => {});
      
      log.info('📡 Getting receiver status...');
      receiver.send({ type: 'GET_STATUS', requestId: 1 });
      
      // Debug: Log ALL receiver messages (not just RECEIVER_STATUS)
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
      
      // Main receiver message handler (debug logging is above)
      receiver.on('message', async (data) => {
        
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
                logScreensaverStop('takeover');
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
              logScreensaverStop('takeover');
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
            
            // Use custom message channel that receiver listens on
            const customChannel = client.createChannel('sender-0', transportId, 'urn:x-cast:com.website.cast', 'JSON');
            
            // Add receiver auto-refresh parameter to URL
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
            lastUrlRefreshTime = Date.now(); // Reset URL refresh timer on new cast
            stopRecoveryCheck(); // Stop recovery since we're active
            
            // Keep connection alive - don't close client
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

// Refresh URL on already running receiver (for when receiver did auto-refresh)
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
        try { refreshClient.close(); } catch(e) {}
        log.warn('⚠️ Refresh: Timeout');
        resolve({ success: false, error: 'Timeout' });
      }
    }, 10000);
    
    refreshClient.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        try { refreshClient.close(); } catch(e) {}
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
            const sessionId = app.sessionId;
            
            // Connect to the running app
            const appConnection = refreshClient.createChannel('sender-0', transportId, 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
            appConnection.send({ type: 'CONNECT' });
            
            // Use custom message channel that receiver listens on
            const customChannel = refreshClient.createChannel('sender-0', transportId, 'urn:x-cast:com.website.cast', 'JSON');
            
            // Add receiver auto-refresh parameter to URL
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
            
            // Wait a moment then close
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
            // Wrong app running
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

// Note: castMediaWithRetry removed - castMedia() already has built-in retry logic

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
// CRITICAL FIX (v1.3.7): Always check device status every cycle, like the old working version (v1.0.19).
// The previous optimization of skipping checks when screensaverActive=true caused silent disconnects
// to go undetected for up to 3 minutes.

async function checkAndActivateScreensaver() {
  const config = loadConfig();
  if (!config.enabled || !config.url || !config.selectedChromecast) return;
  
  // If update is in progress, skip activation
  if (updateInProgress) {
    log.info('⏸️ Update in progress, skipping screensaver check');
    return;
  }
  
  // Capture state before checking (isChromecastIdleWithRecovery syncs screensaverActive)
  const wasScreensaverActive = screensaverActive;
  
  // Check circuit breaker state before attempting
  const circuitState = checkCircuitBreaker();
  if (circuitState === false) {
    log.info('⚡ Circuit breaker open, skipping');
    return;
  }
  
  // If circuit breaker just went half-open, rediscover devices first (IP may have changed)
  if (circuitState === 'half-open') {
    log.info('🔍 [CIRCUIT] Half-open - rediscovering devices before retry...');
    await discoverDevices();
    const device = findDevice(config.selectedChromecast);
    if (device) {
      log.info(`✅ [CIRCUIT] Device found at ${device.host} (.${device.host.split('.').pop()})`);
    } else {
      log.warn(`⚠️ [CIRCUIT] Device "${config.selectedChromecast}" not found after rediscovery`);
      recordCircuitFailure();
      return;
    }
  }
  
  // ALWAYS check device status - don't skip based on local flag
  // The old working version (v1.0.19) did this and never had silent disconnect issues
  const result = await isChromecastIdleWithRecovery(config.selectedChromecast);
  
  if (result.status === 'circuit_open') {
    log.info('⚡ Circuit breaker open, skipping');
    return;
  }
  
  // Build compact status message - single sticky log entry (v1.3.40)
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
  
  const compactStatus = `${statusEmoji} ${statusLabel} | Apps: ${result.appList || 'none'}`;
  const now = new Date().toISOString();
  const timeStr = new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  
  // Heartbeat logging with deduplication (v1.3.42)
  // Same status = replace (update time only)
  // Different status = keep old as history, add new
  const newMessage = `📊 ${compactStatus}`;
  const existingIdx = logBuffer.findIndex(entry => entry.isHeartbeat);
  
  if (existingIdx !== -1) {
    const existing = logBuffer[existingIdx];
    
    if (existing.message === newMessage) {
      // SAME status - remove old, add new with updated time
      logBuffer.splice(existingIdx, 1);
    } else {
      // DIFFERENT status - keep old as history (remove heartbeat flag)
      existing.isHeartbeat = false;
    }
  }
  
  // Add new heartbeat entry
  logBuffer.push({
    timestamp: now,
    level: 'info',
    message: newMessage,
    isHeartbeat: true
  });
  
  // Trim buffer if needed
  while (logBuffer.length > LOG_BUFFER_SIZE) {
    logBuffer.shift();
  }


  // Handle different states
  if (result.status === 'our_app') {
    // isChromecastIdleWithRecovery already synced screensaverActive = true
    if (!wasScreensaverActive) {
      log.info('✅ Screensaver resumed (was already running on device)');
      lastUrlRefreshTime = Date.now(); // Reset refresh timer on resume
    }
    
    // Send URL shortly before receiver's auto-refresh (2 min before)
    // This ensures receiver has fresh URL in memory right before reload
    const receiverRefreshMs = (config.receiverAutoRefresh || 45) * 60 * 1000;
    const preRefreshBuffer = 2 * 60 * 1000; // 2 minutes before
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
    }
    return;
  }
  
  // status === 'idle' - device is idle and our app is NOT running
  
  // If we thought we were active but device says idle, this is a silent disconnect
  if (wasScreensaverActive) {
    log.warn('⚠️ Silent disconnect detected! Device idle but flag was active');
    logScreensaverStop('silent_disconnect');
    // Continue to re-activate below (skip cooldown for silent_disconnect)
  }
  
  // Check cooldown period (skip for network_error and silent_disconnect)
  const timeSinceTakeover = Date.now() - lastTakeoverTime;
  const skipCooldown = lastErrorType === 'network_error' || lastErrorType === 'silent_disconnect';
  const cooldownMs = (config.cooldownAfterTakeover || 30) * 1000;
  
  if (!skipCooldown && lastTakeoverTime > 0 && timeSinceTakeover < cooldownMs) {
    const remainingSecs = Math.ceil((cooldownMs - timeSinceTakeover) / 1000);
    log.info(`⏸️ Cooldown active, ${remainingSecs}s remaining`);
    return;
  }
  
  // Activate screensaver
  log.info('💤 Device idle, activating screensaver...');
  try {
    await castMedia(config.selectedChromecast, config.url);
  } catch (error) {
    log.error('Failed to activate screensaver:', error.message);
  }
}

// ============ HTTP Server ============

// Security constants
const MAX_BODY_SIZE = 10 * 1024; // 10KB max request body
const ALLOWED_EXTENSIONS = new Set(['.html', '.css', '.js', '.json', '.png', '.jpg', '.ico']);

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

// Security headers for all responses
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-XSS-Protection': '1; mode=block'
};

function serveStatic(filePath, res) {
  const ext = path.extname(filePath);
  
  // Security: Only allow known file extensions
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    res.writeHead(403, SECURITY_HEADERS);
    res.end('Forbidden');
    return;
  }
  
  // Security: Prevent path traversal
  const normalizedPath = path.normalize(filePath);
  if (!normalizedPath.startsWith(PUBLIC_DIR)) {
    log.warn(`⚠️ Path traversal attempt blocked: ${filePath}`);
    res.writeHead(403, SECURITY_HEADERS);
    res.end('Forbidden');
    return;
  }
  
  const contentType = MIME_TYPES[ext] || 'text/plain';
  
  fs.readFile(normalizedPath, (err, data) => {
    if (err) {
      res.writeHead(404, SECURITY_HEADERS);
      res.end('Not Found');
    } else {
      res.writeHead(200, { 
        'Content-Type': contentType,
        ...SECURITY_HEADERS
      });
      res.end(data);
    }
  });
}

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

// Connection cleanup helper
function cleanupConnection() {
  if (keepAliveInterval) {
    activeHeartbeats.delete(keepAliveInterval);
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
  if (client) {
    try { client.close(); } catch(e) {}
    client = null;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  
  // Apply security headers and CORS to all responses
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
  
  // API Routes
  if (pathname.startsWith('/api/')) {
    try {
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
        // Use retry logic for manual refresh
        const devices = await discoverDevicesWithRetry();
        // Reset recovery state on manual refresh
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
        const config = loadConfig();
        const networkIP = getNetworkIP();
        sendJson(res, {
          version: BRIDGE_VERSION,
          deviceId: DEVICE_ID,
          port: PORT,
          networkIP: networkIP,
          networkUrl: `http://${networkIP}:${PORT}`,
          devices: discoveredDevices.length,
          selectedChromecast: config.selectedChromecast,
          screensaverActive,
          uptime: process.uptime(),
          // Last device check result
          lastDeviceCheck,
          // Recovery status
          circuitBreaker: {
            isOpen: circuitBreakerState.isOpen,
            failures: circuitBreakerState.failures
          },
          recovery: {
            active: recoveryCheckInterval !== null,
            lastErrorType,
            ipRecoveryAttempts: ipRecoveryState.failedAttempts
          }
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
      
      // POST /api/check - Manual status check and reconnect
      if (req.method === 'POST' && pathname === '/api/check') {
        log.info('🔍 Manual check requested via API');
        const config = loadConfig();
        
        if (!config.selectedChromecast) {
          sendJson(res, { success: false, error: 'No Chromecast selected' }, 400);
          return;
        }
        
        // Run status check immediately
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
      
      // POST /api/force-stop - Force stop all Chromecast apps (zombie cleanup)
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
          // Force close any existing connection first
          cleanupConnection();
          screensaverActive = false;
          
          // Create new connection and send STOP command
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
              
              // Send STOP to terminate all apps
              receiver.send({ type: 'STOP', requestId: Date.now() });
              
              // Wait a moment then close
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
      
      // POST /api/prepare-update - gracefully stop for update
      if (req.method === 'POST' && pathname === '/api/prepare-update') {
        log.info('🔄 Preparing for update - pausing all activity...');
        
        // Set update flag to prevent new screensaver activations
        updateInProgress = true;
        
        // Stop recovery check loop
        stopRecoveryCheck();
        
        // Stop active cast if running
        const config = loadConfig();
        if (screensaverActive && config.selectedChromecast) {
          try {
            log.info('⏹️ Stopping active screensaver for update...');
            await stopCast(config.selectedChromecast);
          } catch (error) {
            log.warn(`⚠️ Could not stop cast: ${error.message}`);
          }
        }
        
        // Clean up connections
        cleanupConnection();
        
        // Give Chromecast time to return to backdrop
        await sleep(2000);
        
        log.info('✅ Ready for update - all activity paused');
        sendJson(res, { 
          success: true, 
          message: 'Bridge paused for update',
          wasActive: screensaverActive 
        });
        return;
      }
      
      // POST /api/reset-recovery (manual reset of recovery state)
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
      
      // GET /api/sonos/status
      if (req.method === 'GET' && pathname === '/api/sonos/status') {
        try {
          const posBody = `<u:GetPositionInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID></u:GetPositionInfo>`;
          const transBody = `<u:GetTransportInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID></u:GetTransportInfo>`;
          const mediaBody = `<u:GetMediaInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID></u:GetMediaInfo>`;
          const volBody = `<u:GetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0</InstanceID><Channel>Master</Channel></u:GetVolume>`;
          const muteBody = `<u:GetMute xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0</InstanceID><Channel>Master</Channel></u:GetMute>`;
          const bassBody = `<u:GetBass xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0</InstanceID></u:GetBass>`;
          const trebleBody = `<u:GetTreble xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0</InstanceID></u:GetTreble>`;
          const loudnessBody = `<u:GetLoudness xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0</InstanceID><Channel>Master</Channel></u:GetLoudness>`;
          const crossfadeBody = `<u:GetCrossfadeMode xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID></u:GetCrossfadeMode>`;
          
          const [posXml, transXml, mediaXml, volXml, muteXml, bassXml, trebleXml, loudnessXml, crossfadeXml] = await Promise.all([
            soapRequest(posBody, 'GetPositionInfo'),
            soapRequest(transBody, 'GetTransportInfo'),
            soapRequest(mediaBody, 'GetMediaInfo'),
            soapRequest(volBody, 'GetVolume', '/MediaRenderer/RenderingControl/Control', 'RenderingControl').catch(() => null),
            soapRequest(muteBody, 'GetMute', '/MediaRenderer/RenderingControl/Control', 'RenderingControl').catch(() => null),
            soapRequest(bassBody, 'GetBass', '/MediaRenderer/RenderingControl/Control', 'RenderingControl').catch(() => null),
            soapRequest(trebleBody, 'GetTreble', '/MediaRenderer/RenderingControl/Control', 'RenderingControl').catch(() => null),
            soapRequest(loudnessBody, 'GetLoudness', '/MediaRenderer/RenderingControl/Control', 'RenderingControl').catch(() => null),
            soapRequest(crossfadeBody, 'GetCrossfadeMode').catch(() => null)
          ]);
          
          // Parse volume
          let volume = null;
          if (volXml) {
            const volStr = extractTag(volXml, 'CurrentVolume');
            if (volStr !== null) volume = parseInt(volStr, 10);
          }
          let mute = null;
          if (muteXml) {
            const muteStr = extractTag(muteXml, 'CurrentMute');
            if (muteStr !== null) mute = muteStr === '1';
          }
          let bass = null;
          if (bassXml) {
            const bassStr = extractTag(bassXml, 'CurrentBass');
            if (bassStr !== null) bass = parseInt(bassStr, 10);
          }
          let treble = null;
          if (trebleXml) {
            const trebleStr = extractTag(trebleXml, 'CurrentTreble');
            if (trebleStr !== null) treble = parseInt(trebleStr, 10);
          }
          let loudness = null;
          if (loudnessXml) {
            const loudnessStr = extractTag(loudnessXml, 'CurrentLoudness');
            if (loudnessStr !== null) loudness = loudnessStr === '1';
          }
          
          // Debug: log raw SOAP responses for troubleshooting
          log.info(`🔍 [SONOS] GetPositionInfo TrackMetaData present: ${posXml.includes('DIDL-Lite')}`);
          log.info(`🔍 [SONOS] GetMediaInfo NextAVTransportURIMetaData present: ${mediaXml.includes('NextAVTransportURIMetaData')}`);
          
          // Parse position info
          const relTime = extractTag(posXml, 'RelTime');
          const trackDuration = extractTag(posXml, 'TrackDuration');
          const trackNumber = extractTag(posXml, 'Track');
          const trackURI = extractTag(posXml, 'TrackURI');
          const absTime = extractTag(posXml, 'AbsTime');
          const didl = extractDidl(posXml);
          
          log.info(`🔍 [SONOS] DIDL parsed: title=${didl?.title}, albumArtURI=${didl?.albumArtURI}`);
          
          // Parse transport state
          const transportState = extractTag(transXml, 'CurrentTransportState');
          const currentTransportStatus = extractTag(transXml, 'CurrentTransportStatus');
          const currentSpeed = extractTag(transXml, 'CurrentSpeed');
          let crossfade = null;
          if (crossfadeXml) {
            const cfStr = extractTag(crossfadeXml, 'CrossfadeMode');
            if (cfStr !== null) crossfade = cfStr === '1';
          }
          let playbackState = 'PLAYBACK_STATE_IDLE';
          if (transportState === 'PLAYING') playbackState = 'PLAYBACK_STATE_PLAYING';
          else if (transportState === 'PAUSED_PLAYBACK') playbackState = 'PLAYBACK_STATE_PAUSED';
          else if (transportState === 'TRANSITIONING') playbackState = 'PLAYBACK_STATE_PLAYING';
          else if (transportState === 'STOPPED') playbackState = 'PLAYBACK_STATE_PAUSED';
          
          // Album art proxy URL
          let albumArtUri = null;
          if (didl && didl.albumArtURI) {
            let artUrl = didl.albumArtURI;
            if (artUrl.startsWith('/')) {
              albumArtUri = `/api/sonos${artUrl}`;
            } else if (artUrl.startsWith('http')) {
              albumArtUri = `/api/sonos/art?url=${encodeURIComponent(artUrl)}`;
            }
          }
          
          // MediaInfo fields
          const nrTracks = extractTag(mediaXml, 'NrTracks');
          const currentURI = extractTag(mediaXml, 'CurrentURI');
          const nextAVTransportURI = extractTag(mediaXml, 'NextAVTransportURI');
          const playMedium = extractTag(mediaXml, 'PlayMedium');
          
          // Parse next track from MediaInfo (with ContentDirectory fallback)
          const nextMeta = extractTag(mediaXml, 'NextAVTransportURIMetaData');
          const { nextTrackName, nextArtistName, nextAlbumArtUri } = await resolveNextTrack(nextMeta, trackNumber, nrTracks);
          const mediaType = didl?.upnpClass?.includes('audioBroadcast') ? 'radio' : 'track';
          
          sendJson(res, {
            ok: true,
            source: 'local-upnp',
            playbackState,
            positionMillis: parseTime(relTime),
            durationMillis: parseTime(trackDuration),
            trackName: didl ? didl.title : null,
            artistName: didl ? didl.creator : null,
            albumName: didl ? didl.album : null,
            albumArtUri,
            nextTrackName,
            nextArtistName,
            nextAlbumArtUri,
            volume,
            mute,
            bass,
            treble,
            loudness,
            mediaType,
            trackNumber: trackNumber ? parseInt(trackNumber, 10) : null,
            trackURI,
            absTime,
            currentSpeed,
            currentTransportStatus,
            crossfade,
            nrTracks: nrTracks ? parseInt(nrTracks, 10) : null,
            currentURI,
            nextAVTransportURI,
            playMedium,
            streamContent: didl ? didl.streamContent : null,
            radioShowMd: didl ? didl.radioShowMd : null,
            originalTrackNumber: didl?.originalTrackNumber ? parseInt(didl.originalTrackNumber, 10) : null,
            protocolInfo: didl ? didl.protocolInfo : null
          });
        } catch (err) {
          log.error(`❌ Sonos status error: ${err.message}`);
          sendJson(res, { ok: false, error: err.message }, 502);
        }
        return;
      }
      
      // GET /api/sonos/getaa* – proxy album art directly from Sonos speaker
      if (req.method === 'GET' && pathname.startsWith('/api/sonos/getaa')) {
        const sonosPath = pathname.replace('/api/sonos', '') + (url.search || '');
        const sonosUrl = `http://${SONOS_IP}:1400${sonosPath}`;
        log.info(`🖼️ [SONOS] Art proxy: ${sonosUrl}`);
        
        try {
          const artReq = http.get(sonosUrl, { timeout: 5000 }, (artRes) => {
            res.writeHead(artRes.statusCode, {
              'Content-Type': artRes.headers['content-type'] || 'image/jpeg',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'public, max-age=300',
              ...SECURITY_HEADERS
            });
            artRes.pipe(res);
          });
          
          artReq.on('timeout', () => {
            artReq.destroy();
            res.writeHead(502, SECURITY_HEADERS);
            res.end('Art fetch timeout');
          });
          
          artReq.on('error', (err) => {
            log.error(`❌ Sonos getaa proxy error: ${err.message}`);
            res.writeHead(502, SECURITY_HEADERS);
            res.end('Art fetch error');
          });
        } catch (err) {
          res.writeHead(502, SECURITY_HEADERS);
          res.end('Art fetch error');
        }
        return;
      }
      
      // GET /api/sonos/art?url=...
      if (req.method === 'GET' && pathname === '/api/sonos/art') {
        const artUrl = url.searchParams.get('url');
        if (!artUrl) {
          sendJson(res, { error: 'Missing url parameter' }, 400);
          return;
        }
        
        try {
          const artReq = http.get(artUrl, { timeout: 3000 }, (artRes) => {
            res.writeHead(artRes.statusCode, {
              'Content-Type': artRes.headers['content-type'] || 'image/jpeg',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'public, max-age=300',
              ...SECURITY_HEADERS
            });
            artRes.pipe(res);
          });
          
          artReq.on('timeout', () => {
            artReq.destroy();
            res.writeHead(502, SECURITY_HEADERS);
            res.end('Art fetch timeout');
          });
          
          artReq.on('error', (err) => {
            log.error(`❌ Sonos art proxy error: ${err.message}`);
            res.writeHead(502, SECURITY_HEADERS);
            res.end('Art fetch error');
          });
        } catch (err) {
          res.writeHead(502, SECURITY_HEADERS);
          res.end('Art fetch error');
        }
        return;
      }
      
      // GET /api/sonos/events – Server-Sent Events stream
      if (req.method === 'GET' && pathname === '/api/sonos/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          ...SECURITY_HEADERS
        });
        
        // Send last known state immediately
        if (lastSonosEvent) {
          res.write(`data: ${JSON.stringify(lastSonosEvent)}\n\n`);
        }
        
        sonosEventClients.push(res);
        log.info(`📡 [SONOS] SSE client connected (total: ${sonosEventClients.length})`);
        
        req.on('close', () => {
          sonosEventClients = sonosEventClients.filter(c => c !== res);
          log.info(`📡 [SONOS] SSE client disconnected (total: ${sonosEventClients.length})`);
        });
        
        // Keep-alive every 15s
        const keepAlive = setInterval(() => {
          try { res.write(':keepalive\n\n'); } catch(e) { clearInterval(keepAlive); }
        }, 15000);
        
        req.on('close', () => clearInterval(keepAlive));
        return;
      }
      
      // NOTIFY /api/sonos/upnp-callback – receives UPnP events from Sonos
      if (req.method === 'NOTIFY' && pathname === '/api/sonos/upnp-callback') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          log.info(`📡 [SONOS] UPnP event received (${body.length} bytes)`);
          res.writeHead(200);
          res.end();
          // Fetch full status and broadcast
          handleSonosUPnPEvent();
        });
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
  const config = loadConfig();
  
  log.info(`🚀 Chromecast Bridge v${BRIDGE_VERSION} starting...`);
  log.info(`📋 Device ID: ${DEVICE_ID}`);
  log.info(`🎬 Custom App ID: ${CUSTOM_APP_ID}`);
  log.info(`⚡ Circuit breaker: ${config.circuitBreakerThreshold || 5} failures = ${config.circuitBreakerCooldown || 5}min pause`);
  log.info(`🔄 Recovery: ${config.cooldownAfterTakeover || 30}s cooldown, exponential backoff`);
  
  // Write network info file
  writeNetworkInfo();
  
  // Handle HTTP server errors
  server.on('error', (err) => {
    log.error(`❌ HTTP server error: ${err.message}`);
    // Don't exit - try to recover
  });
  
  // Start HTTP server - bind to 0.0.0.0 to allow access from other devices on the network
  const networkIP = getNetworkIP();
  server.listen(PORT, '0.0.0.0', () => {
    log.info(`🚀 Server running on:`);
    log.info(`   Local:   http://localhost:${PORT}`);
    log.info(`   Network: http://${networkIP}:${PORT}`);
  });
  
  // Initial device discovery and check for saved device
  // Note: Discovery only runs at start, on reconnect (in recovery loop), and manually via API
  await discoverDevices();
  await checkAndReconnectSavedDevice();
  
  // Periodic tasks
  // Screensaver check interval (default: 60 seconds)
  // Note: No periodic discovery - it only runs at start, on reconnect, and manually
  const screensaverMs = (config.screensaverCheckInterval || 60) * 1000;
  setInterval(checkAndActivateScreensaver, screensaverMs);
  
  // Start Sonos UPnP event subscription for SSE
  log.info(`🔊 [SONOS] Starting UPnP event subscription to ${SONOS_IP}...`);
  subscribeSonosEvents();
  startPositionBroadcast();
  log.info(`🔊 [SONOS] Position broadcast started (250ms interval)`);
  startPeriodicPush();
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    log.info('👋 Shutting down...');
    server.close();
    stopRecoveryCheck();
    activeHeartbeats.forEach(h => clearInterval(h));
    if (client) client.close();
    process.exit(0);
  });
  
  // Handle uncaught exceptions - log but keep running
  process.on('uncaughtException', (err) => {
    log.error(`❌ Uncaught exception: ${err.message}`);
    log.error(err.stack || '');
    // Don't exit - try to keep the server alive
    // Reset client state in case it's the cause
    if (client) {
      try { client.close(); } catch(e) {}
      client = null;
    }
    screensaverActive = false;
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    log.error(`❌ Unhandled rejection: ${reason}`);
    // Don't exit - try to keep the server alive
    // Reset client state in case it's the cause
    if (client) {
      try { client.close(); } catch(e) {}
      client = null;
    }
    screensaverActive = false;
  });
}

main().catch((error) => {
  log.error('Fatal error:', error.message);
  process.exit(1);
});
