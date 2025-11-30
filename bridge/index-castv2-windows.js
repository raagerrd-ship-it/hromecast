const { createClient } = require('@supabase/supabase-js');
const Client = require('castv2-client').Client;
const castv2 = require('castv2');
const Bonjour = require('bonjour-hap')();
require('dotenv').config();

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const DEVICE_ID = process.env.DEVICE_ID || 'default-bridge';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '5000');
const CUSTOM_APP_ID = 'C5A8C2D0'; // Test receiver app

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env file');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Chromecast state
let discoveredDevices = new Map(); // Store all discovered devices
let currentDevice = null;
let client = null;
let lastScreensaverCheck = 0;
const SCREENSAVER_CHECK_INTERVAL = 60000; // Check every minute

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

// Check if Chromecast is idle (no active sessions)
async function isChromecastIdle() {
  const selectedDevice = await getSelectedChromecast();
  const targetDevice = selectedDevice || currentDevice;
  
  if (!targetDevice) {
    console.log('⚠️  No target device available for idle check');
    return false;
  }
  
  return new Promise((resolve) => {
    const checkClient = new castv2.Client();
    
    // Set timeout to avoid hanging
    const timeout = setTimeout(() => {
      console.log('⏱️  Idle check timeout - assuming busy');
      checkClient.close();
      resolve(false);
    }, 5000);
    
    checkClient.connect(targetDevice.host, () => {
      const connection = checkClient.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
      const receiver = checkClient.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.receiver', 'JSON');
      
      // Connect first
      connection.send({ type: 'CONNECT' });
      
      // Request receiver status
      receiver.send({ type: 'GET_STATUS', requestId: 1 });
      
      receiver.on('message', (data) => {
        if (data.type === 'RECEIVER_STATUS') {
          clearTimeout(timeout);
          connection.send({ type: 'CLOSE' });
          checkClient.close();
          
          const apps = data.status?.applications || [];
          
          // Check if any app is running (except backdrop)
          const activeApps = apps.filter(app => 
            app.appId !== 'E8C28D3C' // Backdrop app ID
          );
          
          if (activeApps.length === 0) {
            console.log('✅ Chromecast is idle (no active apps)');
            resolve(true);
          } else {
            console.log(`⏸️  Chromecast is busy (${activeApps.length} active app(s)): ${activeApps.map(a => a.displayName).join(', ')}`);
            resolve(false);
          }
        }
      });
    });
    
    checkClient.on('error', (err) => {
      clearTimeout(timeout);
      console.error('❌ Error checking idle status:', err.message);
      checkClient.close();
      resolve(false);
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
  
  console.log('\n🔍 [AUTO-SCREENSAVER] Checking if screensaver should activate...');
  
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
  
  // Check if Chromecast is idle
  const isIdle = await isChromecastIdle();
  
  if (!isIdle) {
    console.log('⏭️  [AUTO-SCREENSAVER] Device busy, skipping');
    return;
  }
  
  // Cast screensaver
  console.log(`🎬 [AUTO-SCREENSAVER] Activating screensaver: ${settings.url}`);
  
  try {
    await castMedia(settings.url);
    console.log('✅ [AUTO-SCREENSAVER] Screensaver activated successfully');
  } catch (error) {
    console.error('❌ [AUTO-SCREENSAVER] Failed to activate:', error.message);
  }
}

// Discover Chromecast devices using Bonjour (only at startup)
function discoverDevices() {
  return new Promise((resolve) => {
    console.log('🔍 Scanning for Chromecast devices on local network...');
    
    const browser = Bonjour.find({ type: 'googlecast' });
    const discoveryTimeout = setTimeout(() => {
      browser.stop();
      resolve(browser);
    }, 8000); // Stop after 8 seconds
    
    browser.on('up', async (service) => {
      const deviceKey = `${service.referer.address}:${service.port}`;
      
      if (!discoveredDevices.has(deviceKey)) {
        discoveredDevices.set(deviceKey, {
          name: service.name,
          host: service.referer.address,
          port: service.port
        });
        
        console.log(`✅ Found Chromecast: ${service.name} at ${service.referer.address}:${service.port}`);
        
        // Report this device to database
        await reportDiscoveredDevice(service.name, service.referer.address, service.port);
      }
    });
    
    browser.on('error', (error) => {
      console.error('Bonjour browser error:', error);
    });
    
    browser.start();
  });
}

// Cast URL using custom receiver
async function castMedia(url) {
  // Check if user has selected a specific device
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
    
    client.connect(targetDevice.host, () => {
      console.log('✅ Connected to Chromecast');
      
      // Create channels
      const connection = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
      const heartbeat = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.heartbeat', 'JSON');
      const receiver = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.receiver', 'JSON');
      
      // Establish virtual connection
      connection.send({ type: 'CONNECT' });
      
      // Start heartbeat
      const heartbeatInterval = setInterval(() => {
        heartbeat.send({ type: 'PING' });
      }, 5000);
      
      // Listen for heartbeat responses
      heartbeat.on('message', (data) => {
        if (data.type === 'PONG') {
          console.log('💓 Heartbeat OK');
        }
      });
      
      // First, get current receiver status
      console.log('📡 Getting receiver status...');
      receiver.send({ type: 'GET_STATUS', requestId: 1 });
      
      // Set a timeout for app launch
      const launchTimeout = setTimeout(() => {
        console.error('⏱️  Timeout waiting for receiver response');
        clearInterval(heartbeatInterval);
        client.close();
        reject(new Error('Receiver timeout'));
      }, 15000);
      
      let appLaunched = false;
      
      receiver.on('message', (data) => {
        console.log('📨 Receiver message:', JSON.stringify(data, null, 2));
        
        // Handle launch errors
        if (data.type === 'LAUNCH_ERROR') {
          clearTimeout(launchTimeout);
          clearInterval(heartbeatInterval);
          console.error(`❌ Failed to launch custom receiver app: ${data.reason}`);
          console.log(`💡 Custom receiver app (${CUSTOM_APP_ID}) error: ${data.reason}`);
          
          if (data.reason === 'NOT_ALLOWED') {
            console.log('🔒 NOT_ALLOWED means:');
            console.log('   - Your Chromecast device serial number must be registered in Cast Developer Console');
            console.log('   - The app and device must be in the SAME Developer Console account');
            console.log('   - The app must be Published (not just saved)');
            console.log('   - Wait 15 minutes after registering device, then restart Chromecast');
          } else if (data.reason === 'NOT_FOUND') {
            console.log('🔍 NOT_FOUND means the receiver URL is incorrect or unreachable');
            console.log(`📝 Verify URL in Cast Console: https://db36ca02-4c2b-4e0e-a58f-a351aa767ebf.lovableproject.com/chromecast-receiver.html`);
          }
          
          client.close();
          reject(new Error(`Custom receiver not available: ${data.reason}`));
          return;
        }
        
        if (data.type === 'RECEIVER_STATUS') {
          // First response - receiver status received
          if (!appLaunched) {
            console.log(`🚀 Launching custom receiver app: ${CUSTOM_APP_ID}`);
            receiver.send({ type: 'LAUNCH', appId: CUSTOM_APP_ID, requestId: 2 });
            appLaunched = true;
            return;
          }
          
          // App launch response
          if (data.status && data.status.applications && data.status.applications.length > 0) {
            clearTimeout(launchTimeout);
            clearInterval(heartbeatInterval);
            
            const app = data.status.applications[0];
            console.log('📱 App launched:', app.displayName, 'AppId:', app.appId);
            
            // Verify it's our custom app
            if (app.appId !== CUSTOM_APP_ID) {
              console.log('⚠️  Wrong app running, stopping it first...');
              receiver.send({ type: 'STOP', requestId: 3, sessionId: app.sessionId });
              setTimeout(() => {
                receiver.send({ type: 'LAUNCH', appId: CUSTOM_APP_ID, requestId: 4 });
              }, 1000);
              return;
            }
            
            // Join the app session
            const sessionId = app.sessionId;
            const transportId = app.transportId;
            
            // Connect to the app
            const appConnection = client.createChannel('sender-0', transportId, 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
            appConnection.send({ type: 'CONNECT' });
            
            // Create media channel
            const media = client.createChannel('sender-0', transportId, 'urn:x-cast:com.google.cast.media', 'JSON');
            
            // Load the URL
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
            
            media.on('message', (data) => {
              console.log('📨 Media message:', JSON.stringify(data, null, 2));
              if (data.type === 'MEDIA_STATUS') {
                console.log('✅ Media loaded successfully');
                resolve({ success: true });
              }
            });
          } else {
            console.log('⚠️  No applications running in receiver status');
          }
        }
      });
    });
    
    client.on('error', (err) => {
      console.error('❌ Client error:', err.message);
      reject(err);
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
  const browser = await discoverDevices();

  console.log(`\n📊 Discovery complete: Found ${discoveredDevices.size} device(s)`);
  
  if (discoveredDevices.size === 0) {
    console.error('❌ No Chromecast devices found. Make sure your device is on the same network.');
    console.log('💡 Tip: Check Windows Firewall settings - it may be blocking mDNS/Bonjour');
    process.exit(1);
  }
  
  console.log('✅ All devices reported to database');
  
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

  // Initial poll
  processPendingCommands();
  
  // Initial screensaver check after 10 seconds
  setTimeout(checkAndActivateScreensaver, 10000);

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down bridge service...');
    clearInterval(pollInterval);
    clearInterval(screensaverInterval);
    await channel.unsubscribe();
    if (client) {
      client.close();
    }
    browser.stop();
    Bonjour.destroy();
    process.exit(0);
  });
}

main().catch(console.error);
