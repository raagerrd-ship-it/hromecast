const { createClient } = require('@supabase/supabase-js');
const Client = require('castv2-client').Client;
const castv2 = require('castv2');
const Bonjour = require('bonjour-hap');
require('dotenv').config();

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
const SCREENSAVER_CHECK_INTERVAL = 60000;

// Report discovered devices to database
async function reportDiscoveredDevice(name, host, port) {
  try {
    const { data, error } = await supabase
      .from('discovered_chromecasts')
      .upsert({
        device_id: DEVICE_ID,
        chromecast_name: name,
        chromecast_host: host,
        chromecast_port: port,
        last_seen: new Date().toISOString()
      }, {
        onConflict: 'device_id,chromecast_host',
        ignoreDuplicates: false
      })
      .select()
      .single();

    if (error) {
      console.error('Error reporting device to database:', error);
    } else {
      console.log(`📊 Reported device to database: ${name}`);
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
      name: chromecast.chromecast_name,
      host: chromecast.chromecast_host,
      port: chromecast.chromecast_port
    };
  } catch (error) {
    console.error('Error getting selected chromecast:', error);
    return null;
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

// Check if Chromecast is idle
async function isChromecastIdle() {
  const selectedDevice = await getSelectedChromecast();
  const targetDevice = selectedDevice || currentDevice;
  
  if (!targetDevice) {
    console.log('⚠️  No target device available for idle check');
    return false;
  }
  
  return new Promise((resolve) => {
    const checkClient = new castv2.Client();
    
    const timeout = setTimeout(() => {
      console.log('⏱️  Idle check timeout - assuming busy');
      checkClient.close();
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
          
          const apps = data.status?.applications || [];
          // Filter out backdrop (E8C28D3C) and our own screensaver app (FE376873)
          const otherApps = apps.filter(app => app.appId !== 'E8C28D3C' && app.appId !== CUSTOM_APP_ID);
          const ourAppRunning = apps.some(app => app.appId === CUSTOM_APP_ID);
          
          if (ourAppRunning) {
            isScreensaverActive = true; // Sync local state
            resolve({ status: 'our_app' });
          } else if (otherApps.length === 0) {
            console.log('✅ Chromecast is idle (no active apps)');
            resolve({ status: 'idle' });
          } else {
            console.log(`⏸️  Chromecast is busy (${otherApps.length} other app(s): ${otherApps.map(a => a.displayName || a.appId).join(', ')})`);
            resolve({ status: 'busy', apps: otherApps.map(a => a.displayName || a.appId) });
          }
        }
      });
    });
    
    checkClient.on('error', (err) => {
      clearTimeout(timeout);
      console.error('❌ Error checking idle status:', err.message);
      checkClient.close();
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
  
  // Check Chromecast status
  const result = await isChromecastIdle();
  
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
    if (!isScreensaverActive) {
      isScreensaverActive = true;
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
      isScreensaverActive = false;
      
      // Batch: Log stop event + update status
      await Promise.all([
        supabase.from('cast_commands').insert({
          device_id: DEVICE_ID,
          command_type: 'screensaver_stop',
          url: settings.url || '',
          status: 'completed',
          processed_at: new Date().toISOString()
        }),
        supabase.from('screensaver_settings').update({ screensaver_active: false }).eq('device_id', DEVICE_ID)
      ]);
      
      console.log('📝 [AUTO-SCREENSAVER] Logged screensaver stop (device taken over)');
    }
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

// Discover Chromecast devices using Bonjour
function discoverDevices() {
  return new Promise((resolve) => {
    console.log('🔍 Scanning for Chromecast devices on local network (Bonjour)...');
    
    const browser = bonjour.find({ type: 'googlecast' });
    const discoveryTimeout = setTimeout(() => {
      browser.stop();
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

// Cast URL using castv2-client with reconnection handling
async function castMedia(url, retryCount = 0) {
  const selectedDevice = await getSelectedChromecast();
  const targetDevice = selectedDevice || currentDevice;
  
  if (!targetDevice) {
    throw new Error('No Chromecast devices found on network');
  }
  
  if (selectedDevice) {
    console.log(`🎯 Using user-selected device: ${selectedDevice.name}`);
  } else {
    console.log(`🎯 Using auto-selected device: ${currentDevice.name}`);
  }
  
  return new Promise((resolve, reject) => {
    console.log(`📺 Connecting to ${targetDevice.name} at ${targetDevice.host}...`);
    
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
      if (client) {
        try {
          client.close();
        } catch (e) {
          // Ignore close errors
        }
      }
    };
    
    client.connect(targetDevice.host, () => {
      console.log('✅ Connected to Chromecast');
      
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
      
      // Silent heartbeat - only log errors
      heartbeat.on('message', () => {});
      
      console.log('📡 Getting receiver status...');
      receiver.send({ type: 'GET_STATUS', requestId: 1 });
      
      launchTimeout = setTimeout(() => {
        console.error('⏱️  Timeout waiting for receiver response (120s)');
        console.log('Last appLaunched state:', appLaunched);
        console.log('Retry count:', retryCount);
        cleanup();
        
        // Retry on timeout if haven't exceeded retry limit
        if (retryCount < 2) {
          console.log('🔄 Retrying cast due to timeout...');
          setTimeout(() => {
            castMedia(url, retryCount + 1).then(resolve).catch(reject);
          }, 3000);
        } else {
          reject(new Error('Receiver timeout - Custom receiver may not be accessible'));
        }
      }, 120000);
      
      let appLaunched = false;
      
      receiver.on('message', (data) => {
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
                console.log(`⚠️  Wrong app running (${runningApp.displayName}), stopping it...`);
                receiver.send({ type: 'STOP', requestId: 3, sessionId: runningApp.sessionId });
                
                // Close connection and retry after app stops
                setTimeout(() => {
                  cleanup();
                  if (retryCount < 2) {
                    console.log('🔄 Reconnecting after stopping wrong app...');
                    castMedia(url, retryCount + 1).then(resolve).catch(reject);
                  } else {
                    reject(new Error('Failed to stop running app after multiple attempts'));
                  }
                }, 2000);
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
              console.log('⚠️  Still wrong app, will retry...');
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
    
    client.on('error', (err) => {
      console.error('❌ Client error:', err.message);
      cleanup();
      reject(err);
    });
    
    client.on('close', () => {
      console.log('🔌 Connection closed');
      cleanup();
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
  console.log('🚀 Starting Chromecast Bridge Service (Windows) with Custom Receiver');
  console.log(`📱 Device ID: ${DEVICE_ID}`);
  console.log(`🎬 Custom App ID: ${CUSTOM_APP_ID}`);
  console.log(`⏱️  Poll interval: ${POLL_INTERVAL}ms`);
  console.log('');

  // Discover devices (one-time scan at startup)
  await discoverDevices();

  console.log(`\n📊 Discovery complete: Found ${discoveredDevices.size} device(s)`);
  
  if (discoveredDevices.size === 0) {
    console.error('❌ No Chromecast devices found. Make sure your device is on the same network.');
    console.log('💡 Tip: Check Windows Firewall settings - it may be blocking mDNS/Bonjour');
    console.log('⚠️  Bridge will continue running and monitor for commands...');
  } else {
    console.log('✅ All devices reported to database');
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

  // Log bridge start
  await supabase.from('cast_commands').insert({
    device_id: DEVICE_ID,
    command_type: 'bridge_start',
    url: '',
    status: 'completed',
    processed_at: new Date().toISOString()
  });
  console.log('📝 Logged bridge start');

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
    
    clearInterval(pollInterval);
    clearInterval(screensaverInterval);
    await channel.unsubscribe();
    if (client) {
      client.close();
    }
    bonjour.destroy();
    process.exit(0);
  });
}

main().catch(console.error);
