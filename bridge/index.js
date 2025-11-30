const { createClient } = require('@supabase/supabase-js');
const Chromecasts = require('chromecasts');
require('dotenv').config();

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const DEVICE_ID = process.env.DEVICE_ID || 'default-bridge';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '5000');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env file');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Chromecast state
const chromecasts = new Chromecasts();
let currentDevice = null;
let activeSession = null;

// Keep session alive
function keepSessionAlive() {
  if (activeSession && currentDevice) {
    try {
      // Ping the device to keep connection alive
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

// Discover Chromecast devices
function discoverDevices() {
  console.log('🔍 Scanning for Chromecast devices on local network...');
  
  chromecasts.on('update', (player) => {
    console.log(`✅ Found Chromecast: ${player.name} at ${player.host}`);
    
    // Use the first device found
    if (!currentDevice) {
      currentDevice = player;
      console.log(`🎯 Using device: ${player.name}`);
    }
  });
}

// Cast media to Chromecast using custom receiver
async function castMedia(url) {
  if (!currentDevice) {
    throw new Error('No Chromecast devices found on network');
  }
  
  console.log(`📺 Casting to ${currentDevice.name}: ${url}`);
  
  // Use custom receiver App ID
  const CUSTOM_APP_ID = 'FE376873';
  
  return new Promise((resolve, reject) => {
    // First, launch the custom receiver app
    currentDevice.app(CUSTOM_APP_ID, (err, app) => {
      if (err) {
        console.error('❌ Failed to launch custom receiver:', err.message);
        reject(err);
        return;
      }
      
      console.log('✅ Custom receiver launched');
      
      // Load the URL via the custom receiver
      currentDevice.play(url, {
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
    // Fetch pending commands for this device
    const { data: commands, error } = await supabase
      .from('cast_commands')
      .select('*')
      .eq('device_id', DEVICE_ID)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);
    
    if (error) {
      console.error('❌ Error fetching commands:', error.message);
      return;
    }
    
    if (!commands || commands.length === 0) {
      return;
    }
    
    const command = commands[0];
    console.log(`📝 Processing command ${command.id}: ${command.command_type} - ${command.url}`);
    
    try {
      // Mark as processing
      await supabase
        .from('cast_commands')
        .update({ status: 'processing' })
        .eq('id', command.id);
      
      // Execute command
      if (command.command_type === 'cast') {
        await castMedia(command.url);
      } else {
        throw new Error(`Unknown command type: ${command.command_type}`);
      }
      
      // Mark as completed
      await supabase
        .from('cast_commands')
        .update({ 
          status: 'completed',
          processed_at: new Date().toISOString()
        })
        .eq('id', command.id);
      
      console.log(`✅ Command ${command.id} completed successfully`);
      
    } catch (error) {
      console.error(`❌ Error processing command ${command.id}:`, error.message);
      
      // Mark as failed
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
    console.error('❌ Error in processPendingCommands:', error.message);
  }
}

// Subscribe to realtime updates
function subscribeToCommands() {
  console.log('👂 Subscribing to realtime command updates...');
  
  const channel = supabase
    .channel('cast_commands')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'cast_commands',
        filter: `device_id=eq.${DEVICE_ID}`
      },
      (payload) => {
        console.log('🔔 New command received via realtime:', payload.new.id);
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

// Main function
async function main() {
  console.log('🚀 Starting Chromecast Bridge Service');
  console.log(`📍 Device ID: ${DEVICE_ID}`);
  console.log(`🔄 Poll Interval: ${POLL_INTERVAL}ms`);
  console.log('');
  
  // Discover Chromecast devices
  discoverDevices();
  
  // Wait a bit for discovery
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  if (!currentDevice) {
    console.warn('⚠️  No Chromecast devices found. Make sure your Chromecast is on the same network.');
    console.warn('⚠️  Bridge will keep running and retry when commands arrive.');
  }
  
  // Subscribe to realtime updates
  const channel = subscribeToCommands();
  
  // Poll for pending commands (fallback if realtime fails)
  const pollInterval = setInterval(processPendingCommands, POLL_INTERVAL);
  
  // Initial check
  await processPendingCommands();
  
  console.log('');
  console.log('✅ Bridge service is running');
  console.log('Press Ctrl+C to stop');
  console.log('');
  
  // Cleanup on exit
  process.on('SIGINT', () => {
    console.log('\n🛑 Stopping bridge service...');
    clearInterval(pollInterval);
    channel.unsubscribe();
    chromecasts.destroy();
    process.exit(0);
  });
}

// Start the service
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
