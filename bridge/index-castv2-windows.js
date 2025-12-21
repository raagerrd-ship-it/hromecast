const { createClient } = require('@supabase/supabase-js');
const Client = require('castv2-client').Client;
const castv2 = require('castv2');
const Bonjour = require('bonjour-hap');
require('dotenv').config();

// Version - uppdateras vid varje ändring
const VERSION = '1.0.15';
// Changelog:
// 1.0.15 - Force discovery command, IP-uppdatering vid device discovery
// 1.0.14 - Previous version

// Track last idle check log ID for updates instead of inserts
let lastIdleCheckLogId = null;
let idleCheckCount = 0;
let firstCheckTime = null;
let lastLoggedStatus = null; // Track last status to detect changes
let bridgeStartTime = null; // Track when this bridge session started

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const DEVICE_ID = process.env.DEVICE_ID || 'default-bridge';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '5000');
const CUSTOM_APP_ID = 'FE376873'; // Custom receiver with iframe support

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env file');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Chromecast state
const bonjour = Bonjour();
let discoveredDevices = new Map();
let currentDevice = null;
let client = null;
let lastScreensaverCheck = 0;
let isScreensaverActive = false; // Track if screensaver is currently casting
let lastTakeoverTime = 0; // Track when another app took over
let recoveryCheckInterval = null; // Fast checking during cooldown
const SCREENSAVER_CHECK_INTERVAL = 60000;
const COOLDOWN_AFTER_TAKEOVER = 5 * 60 * 1000; // 5 minutes cooldown after another app takes over
const RECOVERY_CHECK_INTERVAL = 10000; // Check every 10 seconds during/after cooldown
const REDISCOVERY_INTERVAL = 30 * 60 * 1000; // 30 minutes periodic re-discovery

// Retry configuration
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000; // 1 second base delay

// Circuit breaker configuration
const CIRCUIT_BREAKER_THRESHOLD = 5; // Number of failures before opening circuit
let circuitBreakerState = {
  failures: 0,
  lastFailureTime: 0,
  isOpen: false,
  cooldownMs: 5 * 60 * 1000 // 5 minutes in "open" state
};

// Track active heartbeats for cleanup
const activeHeartbeats = new Set();

// Calculate exponential backoff delay: base * 2^attempt (1s, 2s, 4s, 8s...)
function getBackoffDelay(attempt) {
  const delay = BASE_DELAY_MS * Math.pow(2, attempt);
  // Add jitter (±25%) to prevent thundering herd
  const jitter = delay * 0.25 * (Math.random() - 0.5);
  return Math.min(delay + jitter, 30000); // Cap at 30 seconds
}

// Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Circuit breaker functions
function checkCircuitBreaker() {
  if (circuitBreakerState.isOpen) {
    const elapsed = Date.now() - circuitBreakerState.lastFailureTime;
    if (elapsed > circuitBreakerState.cooldownMs) {
      // Half-open: allow one attempt
      console.log('⚡ [CIRCUIT] Half-open - allowing one attempt');
      circuitBreakerState.isOpen = false;
      circuitBreakerState.failures = 0;
    } else {
      const remainingSec = Math.ceil((circuitBreakerState.cooldownMs - elapsed) / 1000);
      console.log(`⚡ [CIRCUIT] Open - skipping attempt (${remainingSec}s remaining)`);
      return false; // Circuit is open, skip
    }
  }
  return true; // OK to try
}

function recordCircuitFailure() {
  circuitBreakerState.failures++;
  circuitBreakerState.lastFailureTime = Date.now();
  if (circuitBreakerState.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreakerState.isOpen = true;
    console.log(`⚡ [CIRCUIT] Opened after ${CIRCUIT_BREAKER_THRESHOLD} failures - pausing attempts for 5 min`);
    // Log to Activity Log
    supabase.from('cast_commands').insert({
      device_id: DEVICE_ID,
      command_type: 'circuit_breaker',
      url: JSON.stringify({ status: 'open', failures: CIRCUIT_BREAKER_THRESHOLD, cooldownMinutes: 5 }),
      status: 'failed',
      processed_at: new Date().toISOString()
    });
  }
}

function recordCircuitSuccess() {
  const wasOpen = circuitBreakerState.isOpen;
  const hadFailures = circuitBreakerState.failures > 0;
  
  circuitBreakerState.failures = 0;
  circuitBreakerState.isOpen = false;
  
  if (wasOpen) {
    console.log('⚡ [CIRCUIT] Closed - connection restored');
    // Log to Activity Log
    supabase.from('cast_commands').insert({
      device_id: DEVICE_ID,
      command_type: 'circuit_breaker',
      url: JSON.stringify({ status: 'closed', message: 'Connection restored' }),
      status: 'completed',
      processed_at: new Date().toISOString()
    });
  } else if (hadFailures) {
    console.log('⚡ [CIRCUIT] Reset - failures cleared');
  }
}

// Helper function to log screensaver stop (refactored from duplicated code)
async function logScreensaverStop(url) {
  if (!isScreensaverActive) return; // Already stopped
  
  isScreensaverActive = false;
  lastTakeoverTime = Date.now();
  
  await Promise.all([
    supabase.from('cast_commands').insert({
      device_id: DEVICE_ID,
      command_type: 'screensaver_stop',
      url: url,
      status: 'completed',
      processed_at: new Date().toISOString()
    }),
    supabase.from('screensaver_settings')
      .update({ screensaver_active: false })
      .eq('device_id', DEVICE_ID)
  ]);
  
  console.log('✅ screensaver_stop logged - cooldown started');
  startRecoveryCheck();
}

// Log to database for Activity view
async function logToCloud(message, level = 'info') {
  try {
    await supabase.from('cast_commands').insert({
      device_id: DEVICE_ID,
      command_type: 'bridge_log',
      url: JSON.stringify({ message, level, timestamp: new Date().toISOString() }),
      status: level === 'error' ? 'failed' : 'completed',
      processed_at: new Date().toISOString()
    });
  } catch (e) {
    // Silently fail - don't want logging to break the bridge
  }
}

// Update or create idle check log (to avoid flooding activity log)
async function updateIdleCheckLog(message, checkCount = null) {
  try {
    const now = new Date().toISOString();
    
    // Extract status from message (e.g., "busy", "idle", "screensaver active")
    let currentStatus = 'unknown';
    if (message.includes('screensaver active')) {
      currentStatus = 'screensaver_active';
    } else if (message.includes('busy')) {
      currentStatus = 'busy';
    } else if (message.includes('idle')) {
      currentStatus = 'idle';
    }
    
    // If status changed, create a new log entry
    if (lastLoggedStatus !== null && lastLoggedStatus !== currentStatus) {
      console.log(`📊 Status changed: ${lastLoggedStatus} → ${currentStatus}, creating new log entry`);
      lastIdleCheckLogId = null; // Force new entry
      idleCheckCount = 0;
      firstCheckTime = now;
    }
    lastLoggedStatus = currentStatus;
    
    if (!firstCheckTime) {
      firstCheckTime = now;
    }
    const logData = { 
      message, 
      level: 'info', 
      timestamp: now,
      firstCheckTime: firstCheckTime,
      checkCount: checkCount || idleCheckCount,
      status: currentStatus
    };
    
    // If we don't have a log ID, try to find an existing recent idle check log
    // Only look for logs created AFTER this bridge session started AND with same status
    if (!lastIdleCheckLogId && bridgeStartTime) {
      const { data: existingLog } = await supabase
        .from('cast_commands')
        .select('id, created_at, url')
        .eq('device_id', DEVICE_ID)
        .eq('command_type', 'idle_check')
        .eq('status', 'completed')
        .gte('created_at', bridgeStartTime) // Only logs from this bridge session
        .order('processed_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      
      // Use existing log ONLY if status matches (don't reuse log with different status)
      if (existingLog) {
        try {
          const existingData = JSON.parse(existingLog.url);
          // Only reuse if status matches current status
          if (existingData.status === currentStatus) {
            lastIdleCheckLogId = existingLog.id;
            idleCheckCount = (existingData.checkCount || 0);
            firstCheckTime = existingData.firstCheckTime || existingLog.created_at;
            console.log(`📝 Reusing existing log (status: ${currentStatus}, count: ${idleCheckCount})`);
          } else {
            console.log(`📝 Status mismatch (${existingData.status} → ${currentStatus}), creating new log`);
            firstCheckTime = now;
          }
        } catch {
          // If parsing fails, create new log
          firstCheckTime = now;
        }
      }
    }
    
    // Increment check count
    idleCheckCount++;
    logData.checkCount = idleCheckCount;
    
    if (lastIdleCheckLogId) {
      // Update existing log entry
      await supabase
        .from('cast_commands')
        .update({
          url: JSON.stringify(logData),
          processed_at: new Date().toISOString()
        })
        .eq('id', lastIdleCheckLogId);
    } else {
      // Create new log entry with dedicated command_type
      const { data } = await supabase
        .from('cast_commands')
        .insert({
          device_id: DEVICE_ID,
          command_type: 'idle_check',
          url: JSON.stringify(logData),
          status: 'completed',
          processed_at: new Date().toISOString()
        })
        .select('id')
        .single();
      
      if (data?.id) {
        lastIdleCheckLogId = data.id;
      }
    }
  } catch (e) {
    // Silently fail
  }
}

// Start fast recovery checking
function startRecoveryCheck() {
  if (recoveryCheckInterval) return; // Already running
  
  console.log('🔄 Starting fast recovery check (every 10s)...');
  logToCloud('Recovery check started - monitoring for idle device');
  recoveryCheckInterval = setInterval(async () => {
    const timeSinceTakeover = Date.now() - lastTakeoverTime;
    
    // Still in cooldown?
    if (timeSinceTakeover < COOLDOWN_AFTER_TAKEOVER) {
      const remainingMinutes = Math.ceil((COOLDOWN_AFTER_TAKEOVER - timeSinceTakeover) / 60000);
      console.log(`⏸️  [RECOVERY] Cooldown: ${remainingMinutes} min remaining`);
      return;
    }
    
    // Cooldown over - check if device is idle
    console.log('🔍 [RECOVERY] Cooldown over, checking device status...');
    const result = await isChromecastIdle();
    
    if (result.status === 'idle') {
      console.log('✅ [RECOVERY] Device idle, triggering screensaver...');
      logToCloud('Device idle after cooldown - reactivating screensaver');
      stopRecoveryCheck();
      checkAndActivateScreensaver();
    } else if (result.status === 'our_app') {
      console.log('✅ [RECOVERY] Our app already running, stopping recovery check');
      stopRecoveryCheck();
    } else {
      console.log(`⏭️  [RECOVERY] Device still busy (${result.status}), will check again...`);
    }
  }, RECOVERY_CHECK_INTERVAL);
}

// Stop fast recovery checking
function stopRecoveryCheck() {
  if (recoveryCheckInterval) {
    console.log('🛑 Stopping fast recovery check');
    clearInterval(recoveryCheckInterval);
    recoveryCheckInterval = null;
  }
}

// Report discovered devices to database
async function reportDiscoveredDevice(name, host, port) {
  try {
    // First, check if this device already exists with a different IP
    const { data: existing } = await supabase
      .from('discovered_chromecasts')
      .select('id, chromecast_host')
      .eq('device_id', DEVICE_ID)
      .eq('chromecast_name', name)
      .maybeSingle();

    if (existing && existing.chromecast_host !== host) {
      // Device exists with different IP - update it
      console.log(`🔄 Device ${name} changed IP: ${existing.chromecast_host} → ${host}`);
      const { error: updateError } = await supabase
        .from('discovered_chromecasts')
        .update({
          chromecast_host: host,
          chromecast_port: port,
          last_seen: new Date().toISOString()
        })
        .eq('id', existing.id);

      if (updateError) {
        console.error('Error updating device IP:', updateError);
      } else {
        console.log(`✅ Updated device IP in database: ${name} → ${host}`);
      }
    } else if (existing) {
      // Same IP, just update last_seen
      await supabase
        .from('discovered_chromecasts')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', existing.id);
      console.log(`📊 Updated last_seen for: ${name}`);
    } else {
      // New device - insert it
      const { error: insertError } = await supabase
        .from('discovered_chromecasts')
        .insert({
          device_id: DEVICE_ID,
          chromecast_name: name,
          chromecast_host: host,
          chromecast_port: port,
          last_seen: new Date().toISOString()
        });

      if (insertError) {
        console.error('Error inserting device:', insertError);
      } else {
        console.log(`✨ New device added to database: ${name} (${host})`);
      }
    }
  } catch (error) {
    console.error('Error reporting device:', error);
  }
}

// Get selected Chromecast from database
async function getSelectedChromecast() {
  try {
    const { data, error } = await supabase
      .from('screensaver_settings')
      .select('selected_chromecast_id')
      .eq('device_id', DEVICE_ID)
      .single();

    if (error || !data?.selected_chromecast_id) {
      return null;
    }

    // Fetch the selected chromecast details
    const { data: chromecast, error: chromecastError } = await supabase
      .from('discovered_chromecasts')
      .select('*')
      .eq('id', data.selected_chromecast_id)
      .single();

    if (chromecastError || !chromecast) {
      return null;
    }

    return {
      id: chromecast.id,
      name: chromecast.chromecast_name,
      host: chromecast.chromecast_host,
      port: chromecast.chromecast_port
    };
  } catch (error) {
    console.error('Error getting selected chromecast:', error);
    return null;
  }
}

// Find newer IP for same device name (handles DHCP changes)
async function findNewerDeviceIP(deviceName, currentId) {
  try {
    // Find same device name with more recent last_seen
    const { data, error } = await supabase
      .from('discovered_chromecasts')
      .select('*')
      .eq('device_id', DEVICE_ID)
      .eq('chromecast_name', deviceName)
      .neq('id', currentId)
      .order('last_seen', { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) {
      return null;
    }

    const newerDevice = data[0];
    console.log(`🔄 Found newer IP for ${deviceName}: ${newerDevice.chromecast_host}`);
    await logToCloud(`Found newer IP for ${deviceName}: ${newerDevice.chromecast_host}`);
    
    return {
      id: newerDevice.id,
      name: newerDevice.chromecast_name,
      host: newerDevice.chromecast_host,
      port: newerDevice.chromecast_port
    };
  } catch (error) {
    console.error('Error finding newer device IP:', error);
    return null;
  }
}

// Update selected chromecast to new ID
async function updateSelectedChromecast(newId) {
  try {
    await supabase
      .from('screensaver_settings')
      .update({ selected_chromecast_id: newId })
      .eq('device_id', DEVICE_ID);
    console.log(`✅ Updated selected chromecast to: ${newId}`);
    await logToCloud(`Auto-switched to device with new IP`);
  } catch (error) {
    console.error('Error updating selected chromecast:', error);
  }
}

// Get screensaver settings from database
async function getScreensaverSettings() {
  try {
    const { data, error } = await supabase
      .from('screensaver_settings')
      .select('*')
      .eq('device_id', DEVICE_ID)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error getting screensaver settings:', error);
    return null;
  }
}

// Check if Chromecast is idle (with auto IP recovery and exponential backoff)
async function isChromecastIdle(retryWithNewIP = true, retryCount = 0) {
  // Check circuit breaker first
  if (!checkCircuitBreaker()) {
    return { status: 'circuit_open' };
  }
  
  const selectedDevice = await getSelectedChromecast();
  const targetDevice = selectedDevice || currentDevice;
  
  if (!targetDevice) {
    console.log('⚠️  No target device available for idle check');
    await logToCloud('Idle check skipped - no device selected', 'error');
    return { status: 'error' };
  }
  
  // Apply exponential backoff delay for retries
  if (retryCount > 0) {
    const delay = getBackoffDelay(retryCount - 1);
    console.log(`🔄 Idle check retry ${retryCount}/${MAX_RETRIES} - waiting ${Math.round(delay/1000)}s...`);
    await sleep(delay);
  }
  
  console.log(`🔍 Checking idle status for: ${targetDevice.name} (${targetDevice.host})${retryCount > 0 ? ` (attempt ${retryCount + 1})` : ''}`);
  await updateIdleCheckLog(`Checking idle: ${targetDevice.name} (${targetDevice.host})`);
  
  return new Promise((resolve) => {
    const checkClient = new castv2.Client();
    
    const timeout = setTimeout(async () => {
      console.log('⏱️  Idle check timeout - connection failed');
      checkClient.close();
      recordCircuitFailure();
      
      // Try to find newer IP for same device
      if (retryWithNewIP && targetDevice.id) {
        const newerDevice = await findNewerDeviceIP(targetDevice.name, targetDevice.id);
        if (newerDevice) {
          console.log(`🔄 Retrying with new IP: ${newerDevice.host}`);
          await updateSelectedChromecast(newerDevice.id);
          // Retry with new IP (but don't retry again to avoid infinite loop)
          const retryResult = await isChromecastIdle(false);
          resolve(retryResult);
          return;
        }
      }
      
      await logToCloud(`Idle check timeout: ${targetDevice.name} - no newer IP found`, 'error');
      resolve({ status: 'error' });
    }, 5000);
    
    checkClient.connect(targetDevice.host, () => {
      const connection = checkClient.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
      const receiver = checkClient.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.receiver', 'JSON');
      
      connection.send({ type: 'CONNECT' });
      receiver.send({ type: 'GET_STATUS', requestId: 1 });
      
      receiver.on('message', (data) => {
        if (data.type === 'RECEIVER_STATUS') {
          clearTimeout(timeout);
          connection.send({ type: 'CLOSE' });
          checkClient.close();
          recordCircuitSuccess(); // Success!
          
          const apps = data.status?.applications || [];
          // Filter out backdrop (E8C28D3C) and our own screensaver app (FE376873)
          const otherApps = apps.filter(app => app.appId !== 'E8C28D3C' && app.appId !== CUSTOM_APP_ID);
          const ourAppRunning = apps.some(app => app.appId === CUSTOM_APP_ID);
          
          if (ourAppRunning) {
            isScreensaverActive = true; // Sync local state
            updateIdleCheckLog(`Device ${targetDevice.name}: screensaver active`);
            resolve({ status: 'our_app' });
          } else if (otherApps.length === 0) {
            console.log('✅ Chromecast is idle (no active apps)');
            updateIdleCheckLog(`Device ${targetDevice.name}: idle`);
            resolve({ status: 'idle' });
          } else {
            const appNames = otherApps.map(a => a.displayName || a.appId).join(', ');
            console.log(`⏸️  Chromecast is busy (${otherApps.length} other app(s): ${appNames})`);
            updateIdleCheckLog(`Device ${targetDevice.name}: busy (${appNames})`);
            resolve({ status: 'busy', apps: otherApps.map(a => a.displayName || a.appId) });
          }
        }
      });
    });
    
    checkClient.on('error', async (err) => {
      clearTimeout(timeout);
      console.error(`❌ Error checking idle status: ${err.message}`);
      checkClient.close();
      recordCircuitFailure();
      
      // Try to find newer IP for same device on connection error
      if (retryWithNewIP && targetDevice.id && (err.message.includes('ETIMEDOUT') || err.message.includes('ECONNREFUSED'))) {
        const newerDevice = await findNewerDeviceIP(targetDevice.name, targetDevice.id);
        if (newerDevice) {
          console.log(`🔄 Connection failed, retrying with new IP: ${newerDevice.host}`);
          await updateSelectedChromecast(newerDevice.id);
          const retryResult = await isChromecastIdle(false, 0);
          resolve(retryResult);
          return;
        }
        
        // No new IP found - try exponential backoff retry
        if (retryCount < MAX_RETRIES) {
          console.log(`🔄 No new IP found, retrying with backoff (${retryCount + 1}/${MAX_RETRIES})...`);
          const retryResult = await isChromecastIdle(false, retryCount + 1);
          resolve(retryResult);
          return;
        }
      }
      
      // Generic retry for other errors
      if (retryCount < MAX_RETRIES) {
        console.log(`🔄 Retrying idle check with backoff (${retryCount + 1}/${MAX_RETRIES})...`);
        const retryResult = await isChromecastIdle(retryWithNewIP, retryCount + 1);
        resolve(retryResult);
        return;
      }
      
      await logToCloud(`Connection error after ${MAX_RETRIES} retries: ${targetDevice.name} - ${err.message}`, 'error');
      resolve({ status: 'error' });
    });
  });
}

// Auto-screensaver check - runs every minute
async function checkAndActivateScreensaver() {
  const now = Date.now();
  
  // Throttle checks to once per minute
  if (now - lastScreensaverCheck < SCREENSAVER_CHECK_INTERVAL) {
    return;
  }
  
  lastScreensaverCheck = now;
  
  console.log(`\n🔍 [AUTO-SCREENSAVER] Checking Chromecast status... (${new Date().toLocaleTimeString()})`);
  
  // Get screensaver settings
  const settings = await getScreensaverSettings();
  
  if (!settings) {
    console.log('⚠️  [AUTO-SCREENSAVER] No settings found');
    return;
  }
  
  if (!settings.enabled) {
    console.log('⏸️  [AUTO-SCREENSAVER] Screensaver disabled in settings');
    return;
  }
  
  if (!settings.url) {
    console.log('⚠️  [AUTO-SCREENSAVER] No URL configured');
    return;
  }
  
  // Capture state before checking (isChromecastIdle may modify isScreensaverActive)
  const wasScreensaverActive = isScreensaverActive;
  
  // Check Chromecast status
  const result = await isChromecastIdle();
  
  // Handle circuit breaker open state
  if (result.status === 'circuit_open') {
    console.log('⚡ [AUTO-SCREENSAVER] Circuit breaker open, skipping check');
    return;
  }
  
  // Update last check timestamp
  await supabase
    .from('screensaver_settings')
    .update({
      last_idle_check: new Date().toISOString()
    })
    .eq('device_id', DEVICE_ID);
  // Handle different states
  if (result.status === 'our_app') {
    console.log('✅ [AUTO-SCREENSAVER] Our app already running');
    
    // If we just discovered our app is running (e.g. after bridge restart), log it
    if (!wasScreensaverActive) {
      await Promise.all([
        supabase.from('cast_commands').insert({
          device_id: DEVICE_ID,
          command_type: 'screensaver_resumed',
          url: settings.url || '',
          status: 'completed',
          processed_at: new Date().toISOString()
        }),
        supabase.from('screensaver_settings').update({ screensaver_active: true }).eq('device_id', DEVICE_ID)
      ]);
      console.log('📝 [AUTO-SCREENSAVER] Logged screensaver resumed (app was already running)');
    }
    return;
  }
  
  if (result.status === 'busy' || result.status === 'error') {
    console.log('⏭️  [AUTO-SCREENSAVER] Device busy, skipping');
    
    // Mark screensaver as inactive if device is busy (someone else took over)
    if (isScreensaverActive) {
      await logScreensaverStop(settings.url || '');
      console.log('📝 [AUTO-SCREENSAVER] Logged screensaver stop (device taken over)');
    }
    return;
  }
  
  // Check cooldown period
  const timeSinceTakeover = Date.now() - lastTakeoverTime;
  if (lastTakeoverTime > 0 && timeSinceTakeover < COOLDOWN_AFTER_TAKEOVER) {
    const remainingMinutes = Math.ceil((COOLDOWN_AFTER_TAKEOVER - timeSinceTakeover) / 60000);
    console.log(`⏸️  [AUTO-SCREENSAVER] Cooldown active, ${remainingMinutes} min remaining`);
    return;
  }
  
  // status === 'idle' - activate screensaver
  
  // Cast screensaver
  console.log(`🎬 [AUTO-SCREENSAVER] Activating screensaver: ${settings.url}`);
  
  try {
    await castMedia(settings.url);
    isScreensaverActive = true;
    
    // Batch: Log activation + update status
    await Promise.all([
      supabase.from('cast_commands').insert({
        device_id: DEVICE_ID,
        command_type: 'screensaver_start',
        url: settings.url,
        status: 'completed',
        processed_at: new Date().toISOString()
      }),
      supabase.from('screensaver_settings').update({
        screensaver_active: true,
        last_idle_check: new Date().toISOString()
      }).eq('device_id', DEVICE_ID)
    ]);
    
    console.log('✅ [AUTO-SCREENSAVER] Screensaver activated and logged');
    stopRecoveryCheck(); // Stop fast checking since screensaver is active
  } catch (error) {
    console.error('❌ [AUTO-SCREENSAVER] Failed to activate:', error.message);
    
    // Batch: Log failure + update status
    await Promise.all([
      supabase.from('cast_commands').insert({
        device_id: DEVICE_ID,
        command_type: 'screensaver_start',
        url: settings.url || '',
        status: 'failed',
        error_message: error.message,
        processed_at: new Date().toISOString()
      }),
      supabase.from('screensaver_settings').update({
        screensaver_active: false,
        last_idle_check: new Date().toISOString()
      }).eq('device_id', DEVICE_ID)
    ]);
  }
}

// Clean up old discovered devices (older than 24 hours)
async function cleanupOldDevices() {
  try {
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: oldDevices, error: selectError } = await supabase
      .from('discovered_chromecasts')
      .select('id, chromecast_name')
      .eq('device_id', DEVICE_ID)
      .lt('last_seen', cutoffTime);
    
    if (selectError) {
      console.error('Error finding old devices:', selectError);
      return;
    }
    
    if (oldDevices && oldDevices.length > 0) {
      const { error: deleteError } = await supabase
        .from('discovered_chromecasts')
        .delete()
        .eq('device_id', DEVICE_ID)
        .lt('last_seen', cutoffTime);
      
      if (deleteError) {
        console.error('Error deleting old devices:', deleteError);
      } else {
        console.log(`🧹 Cleaned up ${oldDevices.length} old device(s): ${oldDevices.map(d => d.chromecast_name).join(', ')}`);
        await logToCloud(`Cleaned up ${oldDevices.length} old device(s)`, 'info');
      }
    }
  } catch (error) {
    console.error('Error in cleanup:', error);
  }
}

// Clean up old cast_commands logs (older than 7 days)
async function cleanupOldLogs() {
  try {
    const cutoffTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    
    // Count old logs first
    const { count, error: countError } = await supabase
      .from('cast_commands')
      .select('*', { count: 'exact', head: true })
      .eq('device_id', DEVICE_ID)
      .lt('created_at', cutoffTime);
    
    if (countError) {
      console.error('Error counting old logs:', countError);
      return;
    }
    
    if (count && count > 0) {
      const { error: deleteError } = await supabase
        .from('cast_commands')
        .delete()
        .eq('device_id', DEVICE_ID)
        .lt('created_at', cutoffTime);
      
      if (deleteError) {
        console.error('Error deleting old logs:', deleteError);
      } else {
        console.log(`🧹 Cleaned up ${count} old log(s) (>7 days)`);
        await logToCloud(`Cleaned up ${count} old log entries`, 'info');
      }
    }
  } catch (error) {
    console.error('Error in log cleanup:', error);
  }
}

// Discover Chromecast devices using Bonjour
function discoverDevices() {
  return new Promise((resolve) => {
    console.log('🔍 Scanning for Chromecast devices on local network (Bonjour)...');
    
    const browser = bonjour.find({ type: 'googlecast' });
    const discoveryTimeout = setTimeout(async () => {
      browser.stop();
      // Clean up old devices after discovery completes
      await cleanupOldDevices();
      resolve(browser);
    }, 8000);
    
    browser.on('up', async (service) => {
      const deviceKey = `${service.referer.address}:${service.port}`;
      
      if (!discoveredDevices.has(deviceKey)) {
        discoveredDevices.set(deviceKey, {
          name: service.name,
          host: service.referer.address,
          port: service.port
        });
        
        console.log(`✅ Found Chromecast: ${service.name} at ${service.referer.address}:${service.port}`);
        await reportDiscoveredDevice(service.name, service.referer.address, service.port);
      }
    });
    
    browser.on('error', (error) => {
      console.error('Bonjour browser error:', error);
    });
    
    browser.start();
  });
}

// Cast URL using castv2-client with exponential backoff retry
async function castMedia(url, retryCount = 0) {
  // Check circuit breaker first
  if (!checkCircuitBreaker()) {
    throw new Error('Circuit breaker open - connection attempts paused');
  }
  
  const selectedDevice = await getSelectedChromecast();
  const targetDevice = selectedDevice || currentDevice;
  
  if (!targetDevice) {
    throw new Error('No Chromecast devices found on network');
  }
  
  if (retryCount > 0) {
    const delay = getBackoffDelay(retryCount - 1);
    console.log(`🔄 Retry ${retryCount}/${MAX_RETRIES} - waiting ${Math.round(delay/1000)}s before reconnecting...`);
    await sleep(delay);
  }
  
  if (selectedDevice) {
    console.log(`🎯 Using user-selected device: ${selectedDevice.name}`);
  } else {
    console.log(`🎯 Using auto-selected device: ${currentDevice.name}`);
  }
  
  return new Promise((resolve, reject) => {
    console.log(`📺 Connecting to ${targetDevice.name} at ${targetDevice.host}...${retryCount > 0 ? ` (attempt ${retryCount + 1})` : ''}`);
    
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
      if (client) {
        try {
          client.close();
        } catch (e) {
          // Ignore close errors
        }
      }
    };
    
    // Handle connection errors with retry (single handler)
    client.on('error', async (err) => {
      console.error(`❌ Connection error: ${err.message}`);
      cleanup();
      recordCircuitFailure();
      
      if (retryCount < MAX_RETRIES) {
        console.log(`🔄 Will retry (${retryCount + 1}/${MAX_RETRIES})...`);
        try {
          const result = await castMedia(url, retryCount + 1);
          resolve(result);
        } catch (retryErr) {
          reject(retryErr);
        }
      } else {
        await logToCloud(`Cast failed after ${MAX_RETRIES} retries: ${err.message}`, 'error');
        reject(new Error(`Connection failed after ${MAX_RETRIES} retries: ${err.message}`));
      }
    });
    
    client.on('close', () => {
      console.log('🔌 Connection closed');
      cleanup();
    });
    
    client.connect(targetDevice.host, () => {
      console.log('✅ Connected to Chromecast');
      recordCircuitSuccess(); // Connection successful
      
      const connection = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
      const heartbeat = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.heartbeat', 'JSON');
      const receiver = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.receiver', 'JSON');
      
      connection.send({ type: 'CONNECT' });
      
      heartbeatInterval = setInterval(() => {
        try {
          heartbeat.send({ type: 'PING' });
        } catch (e) {
          console.error('Heartbeat failed:', e.message);
          cleanup();
        }
      }, 5000);
      activeHeartbeats.add(heartbeatInterval); // Track for cleanup
      
      // Silent heartbeat - only log errors
      heartbeat.on('message', () => {});
      
      console.log('📡 Getting receiver status...');
      receiver.send({ type: 'GET_STATUS', requestId: 1 });
      
      launchTimeout = setTimeout(async () => {
        console.error('⏱️  Timeout waiting for receiver response (120s)');
        console.log('Last appLaunched state:', appLaunched);
        console.log('Retry count:', retryCount);
        cleanup();
        recordCircuitFailure();
        
        // Retry on timeout with exponential backoff
        if (retryCount < MAX_RETRIES) {
          console.log(`🔄 Retrying cast due to timeout (${retryCount + 1}/${MAX_RETRIES})...`);
          try {
            const result = await castMedia(url, retryCount + 1);
            resolve(result);
          } catch (retryErr) {
            reject(retryErr);
          }
        } else {
          await logToCloud(`Cast timeout after ${MAX_RETRIES} retries`, 'error');
          reject(new Error('Receiver timeout - Custom receiver may not be accessible'));
        }
      }, 120000);
      
      let appLaunched = false;
      
      receiver.on('message', async (data) => {
        console.log('📨 Receiver message:', JSON.stringify(data, null, 2));
        
        if (data.type === 'LAUNCH_ERROR') {
          cleanup();
          console.error(`❌ Failed to launch custom receiver app: ${data.reason}`);
          reject(new Error(`Custom receiver not available: ${data.reason}`));
          return;
        }
        
        if (data.type === 'RECEIVER_STATUS') {
          // First response - need to launch app
          if (!appLaunched) {
            // Check if wrong app is running first
            if (data.status && data.status.applications && data.status.applications.length > 0) {
              const runningApp = data.status.applications[0];
              
              // Skip backdrop/screensaver
              if (runningApp.appId !== CUSTOM_APP_ID && runningApp.appId !== 'E8C28D3C') {
                console.log(`⚠️  Wrong app running (${runningApp.displayName}), someone else took over`);
                
                // Log stop event using helper
                await logScreensaverStop(url);
                
                cleanup();
                reject(new Error(`Another app running: ${runningApp.displayName}`));
                return;
              }
            }
            
            // No app running or only backdrop - launch our app
            console.log(`🚀 Launching custom receiver app: ${CUSTOM_APP_ID}`);
            console.log(`⚠️  IMPORTANT: Make sure Custom Receiver URL in Google Cast Console is set to your deployed URL + /chromecast-receiver.html`);
            receiver.send({ type: 'LAUNCH', appId: CUSTOM_APP_ID, requestId: 2 });
            appLaunched = true;
            return;
          }
          
          // Subsequent responses - check if app launched successfully
          if (data.status && data.status.applications && data.status.applications.length > 0) {
            const app = data.status.applications[0];
            console.log('📱 App launched:', app.displayName, 'AppId:', app.appId);
            
            if (app.appId !== CUSTOM_APP_ID) {
              console.log('⚠️  Wrong app detected during cast');
              
              // Log stop event using helper
              await logScreensaverStop(url);
              return;
            }
            
            clearTimeout(launchTimeout);
            // Keep heartbeat running to maintain connection
            
            const sessionId = app.sessionId;
            const transportId = app.transportId;
            
            const appConnection = client.createChannel('sender-0', transportId, 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
            appConnection.send({ type: 'CONNECT' });
            
            const media = client.createChannel('sender-0', transportId, 'urn:x-cast:com.google.cast.media', 'JSON');
            
            console.log(`📺 Loading URL: ${url}`);
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
            
            // For HTML content in custom receiver, we don't always get MEDIA_STATUS back
            // Clear timeout and resolve immediately after sending the LOAD command
            clearTimeout(launchTimeout);
            launchTimeout = null;
            console.log('✅ Load command sent - keeping connection alive indefinitely');
            // Keep heartbeat running to maintain connection
            // Don't close client - let it run until manually stopped
            resolve({ success: true });
            
            // Still listen for media messages for debugging
            media.on('message', (data) => {
              console.log('📨 Media message:', JSON.stringify(data, null, 2));
            });
          }
        }
      });
    });
  });
}

// Process pending commands

async function processPendingCommands() {
  try {
    const { data: commands, error } = await supabase
      .from('cast_commands')
      .select('*')
      .eq('device_id', DEVICE_ID)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) {
      console.error('Error fetching commands:', error.message);
      return;
    }

    if (!commands || commands.length === 0) {
      return;
    }

    const command = commands[0];
    console.log(`📋 Processing command ${command.id}: ${command.command_type}`);

    // Update status to processing
    await supabase
      .from('cast_commands')
      .update({ status: 'processing' })
      .eq('id', command.id);

    try {
      if (command.command_type === 'cast') {
        isScreensaverActive = false; // Reset when user manually casts something
        await castMedia(command.url);
      } else if (command.command_type === 'force_discovery') {
        console.log('🔍 Force discovery requested, scanning network...');
        await discoverDevices();
        console.log(`✅ Discovery complete, found ${discoveredDevices.length} devices`);
      }

      // Mark as completed
      await supabase
        .from('cast_commands')
        .update({
          status: 'completed',
          processed_at: new Date().toISOString()
        })
        .eq('id', command.id);

      console.log(`✅ Command ${command.id} completed`);
    } catch (error) {
      console.error(`❌ Command failed:`, error.message);

      await supabase
        .from('cast_commands')
        .update({
          status: 'failed',
          error_message: error.message,
          processed_at: new Date().toISOString()
        })
        .eq('id', command.id);
    }
  } catch (error) {
    console.error('Error processing commands:', error.message);
  }
}

// Subscribe to realtime changes
function subscribeToCommands() {
  console.log('👂 Subscribing to realtime command updates...');

  const channel = supabase
    .channel('cast_commands')
    .on('postgres_changes', 
      {
        event: 'INSERT',
        schema: 'public',
        table: 'cast_commands',
        filter: `device_id=eq.${DEVICE_ID}`
      },
      (payload) => {
        console.log('📬 New command received via realtime');
        processPendingCommands();
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ Subscribed to realtime updates');
      }
    });

  return channel;
}

// Main service
async function main() {
  console.log(`🚀 Chromecast Bridge v${VERSION}`);
  console.log(`📱 Device ID: ${DEVICE_ID}`);
  console.log(`🎬 Custom App ID: ${CUSTOM_APP_ID}`);
  console.log(`⏱️  Poll interval: ${POLL_INTERVAL}ms`);
  console.log(`🔄 Re-discovery interval: ${REDISCOVERY_INTERVAL / 60000} min`);
  console.log('');
  
  await logToCloud(`Bridge v${VERSION} starting...`);

  // Discover devices (one-time scan at startup)
  await discoverDevices();

  console.log(`\n📊 Discovery complete: Found ${discoveredDevices.size} device(s)`);
  
  if (discoveredDevices.size === 0) {
    console.error('❌ No Chromecast devices found. Make sure your device is on the same network.');
    console.log('💡 Tip: Check Windows Firewall settings - it may be blocking mDNS/Bonjour');
    console.log('⚠️  Bridge will continue running and monitor for commands...');
    await logToCloud('No Chromecast devices found on network', 'error');
  } else {
    console.log('✅ All devices reported to database');
    await logToCloud(`Found ${discoveredDevices.size} Chromecast device(s)`);
  }
  
  // Check if user has previously selected a device
  const settings = await getScreensaverSettings();
  if (settings && settings.selected_chromecast_id) {
    // Try to find the previously selected device in current discovery
    const { data: selectedChromecast } = await supabase
      .from('discovered_chromecasts')
      .select('*')
      .eq('id', settings.selected_chromecast_id)
      .single();
    
    if (selectedChromecast) {
      // Check if this device is in our discovered devices
      const deviceKey = `${selectedChromecast.chromecast_host}:${selectedChromecast.chromecast_port}`;
      if (discoveredDevices.has(deviceKey)) {
        currentDevice = {
          name: selectedChromecast.chromecast_name,
          host: selectedChromecast.chromecast_host,
          port: selectedChromecast.chromecast_port
        };
        console.log(`🎯 Auto-selected previously chosen device: ${currentDevice.name}`);
        await logToCloud(`Selected device: ${currentDevice.name}`);
      } else {
        console.log('⚠️  Previously selected device not found in current scan');
        console.log('⚠️  No device auto-selected - please choose a device via web interface');
      }
    }
  } else {
    console.log('ℹ️  No previously selected device found');
    console.log('ℹ️  Please choose a device via web interface');
  }

  // Subscribe to realtime updates
  const channel = subscribeToCommands();

  // Also poll for commands as fallback
  console.log('🔄 Starting command polling...');
  const pollInterval = setInterval(processPendingCommands, POLL_INTERVAL);

  // Start auto-screensaver monitoring
  console.log('🎬 Starting auto-screensaver monitoring (checks every 60s)...');
  const screensaverInterval = setInterval(checkAndActivateScreensaver, SCREENSAVER_CHECK_INTERVAL);

  // Periodic re-discovery of devices (handles IP changes)
  console.log('🔄 Starting periodic re-discovery (every 30 min)...');
  const rediscoveryInterval = setInterval(async () => {
    console.log('\n🔄 [RE-DISCOVERY] Periodic device scan...');
    await discoverDevices();
    console.log(`🔄 [RE-DISCOVERY] Complete: ${discoveredDevices.size} device(s) found\n`);
  }, REDISCOVERY_INTERVAL);

  // Periodic log cleanup (every 6 hours, cleans logs older than 7 days)
  const LOG_CLEANUP_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
  console.log('🧹 Starting periodic log cleanup (every 6h, removes logs >7 days)...');
  const logCleanupInterval = setInterval(cleanupOldLogs, LOG_CLEANUP_INTERVAL);
  
  // Initial log cleanup on startup
  await cleanupOldLogs();

  // Log bridge start and set session start time
  bridgeStartTime = new Date().toISOString();
  await supabase.from('cast_commands').insert({
    device_id: DEVICE_ID,
    command_type: 'bridge_start',
    url: '',
    status: 'completed',
    processed_at: bridgeStartTime
  });
  console.log('📝 Logged bridge start, session time:', bridgeStartTime);

  // Initial poll
  processPendingCommands();
  
  // Initial screensaver check after 10 seconds
  setTimeout(checkAndActivateScreensaver, 10000);

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down bridge service...');
    
    // Log bridge stop
    await supabase.from('cast_commands').insert({
      device_id: DEVICE_ID,
      command_type: 'bridge_stop',
      url: '',
      status: 'completed',
      processed_at: new Date().toISOString()
    });
    console.log('📝 Logged bridge stop');
    
    // Clear all intervals
    clearInterval(pollInterval);
    clearInterval(screensaverInterval);
    clearInterval(rediscoveryInterval);
    clearInterval(logCleanupInterval);
    
    // Clear all active heartbeats
    activeHeartbeats.forEach(interval => clearInterval(interval));
    activeHeartbeats.clear();
    
    // Stop recovery check if running
    stopRecoveryCheck();
    
    await channel.unsubscribe();
    if (client) {
      client.close();
    }
    bonjour.destroy();
    process.exit(0);
  });
}

main().catch(console.error);
