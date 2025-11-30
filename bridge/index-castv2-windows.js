const { createClient } = require('@supabase/supabase-js');
const Chromecasts = require('chromecasts');
require('dotenv').config();

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const DEVICE_ID = process.env.DEVICE_ID || 'default-bridge';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '5000');
const CUSTOM_APP_ID = 'FE376873'; // Custom receiver that supports HTML via iframe

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env file');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Chromecast state
const chromecasts = new Chromecasts();
let discoveredDevices = new Map();
let currentDevice = null;
let activeSession = null;
let lastScreensaverCheck = 0;
const SCREENSAVER_CHECK_INTERVAL = 60000; // Check every minute

// Keep session alive
function keepSessionAlive() {
  if (activeSession && currentDevice) {
    try {
      currentDevice.status((err, status) => {
        if (err) {
          console.error('❌ Keep-alive error:', err.message);
          activeSession = null;
        } else {
          console.log('💓 Keep-alive successful');
        }
      });
    } catch (error) {
      console.error('❌ Keep-alive exception:', error.message);
      activeSession = null;
    }
  }
}

// Start keep-alive interval
setInterval(keepSessionAlive, 5000);

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

// Discover Chromecast devices using chromecasts library
function discoverDevices() {
  console.log('🔍 Scanning for Chromecast devices on local network...');
  
  chromecasts.on('update', async (player) => {
    console.log(`✅ Found Chromecast: ${player.name} at ${player.host}`);
    
    const deviceKey = `${player.host}:8009`;
    if (!discoveredDevices.has(deviceKey)) {
      discoveredDevices.set(deviceKey, {
        name: player.name,
        host: player.host,
        port: 8009,
        player: player
      });
      
      // Report to database
      await reportDiscoveredDevice(player.name, player.host, 8009);
    }
    
    // Use the first device found if none selected
    if (!currentDevice) {
      currentDevice = player;
      console.log(`🎯 Using device: ${player.name}`);
    }
  });
}

// Cast URL using chromecasts library (simple API that works!)
async function castMedia(url) {
  // Try to get selected device or use first found
  const selectedDevice = await getSelectedChromecast();
  
  let playerToUse = null;
  
  if (selectedDevice) {
    // Find the matching player from discovered devices
    for (const [key, device] of discoveredDevices) {
      if (device.host === selectedDevice.host && device.player) {
        playerToUse = device.player;
        console.log(`🎯 Using user-selected device: ${device.name}`);
        break;
      }
    }
  }
  
  // Fallback to currentDevice if no match found
  if (!playerToUse) {
    playerToUse = currentDevice;
  }
  
  if (!playerToUse) {
    throw new Error('No Chromecast devices found on network');
  }
  
  console.log(`📺 Casting to ${playerToUse.name}: ${url}`);
  
  return new Promise((resolve, reject) => {
    // First, launch the custom receiver app
    playerToUse.app(CUSTOM_APP_ID, (err, app) => {
      if (err) {
        console.error('❌ Failed to launch custom receiver:', err.message);
        reject(err);
        return;
      }
      
      console.log('✅ Custom receiver launched');
      
      // Load the URL via the custom receiver
      playerToUse.play(url, {
        title: 'Website Viewer',
        contentType: 'text/html',
        autoplay: true
      }, (err) => {
        if (err) {
          console.error('❌ Cast error:', err.message);
          reject(err);
          return;
        }
        
        console.log('✅ Media loaded successfully');
        activeSession = { url, startTime: Date.now() };
        resolve({ success: true });
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
