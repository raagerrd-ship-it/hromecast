const { createClient } = require('@supabase/supabase-js');
const Client = require('castv2-client').Client;
const Bonjour = require('bonjour-hap')();
require('dotenv').config();

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const DEVICE_ID = process.env.DEVICE_ID || 'default-bridge';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '5000');
const CUSTOM_APP_ID = 'FE376873'; // Your custom receiver

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env file');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Chromecast state
let currentDevice = null;
let client = null;

// Discover Chromecast devices using Bonjour
function discoverDevices() {
  console.log('🔍 Scanning for Chromecast devices on local network...');
  
  const browser = Bonjour.find({ type: 'googlecast' });
  
  browser.on('up', (service) => {
    console.log(`✅ Found Chromecast: ${service.name} at ${service.referer.address}:${service.port}`);
    
    if (!currentDevice) {
      currentDevice = {
        name: service.name,
        host: service.referer.address,
        port: service.port
      };
      console.log(`🎯 Using device: ${service.name}`);
      browser.stop();
    }
  });
  
  browser.on('error', (error) => {
    console.error('Bonjour browser error:', error);
  });
  
  browser.start();
  
  return browser;
}

// Cast URL using custom receiver
async function castMedia(url) {
  if (!currentDevice) {
    throw new Error('No Chromecast devices found on network');
  }
  
  return new Promise((resolve, reject) => {
    console.log(`📺 Connecting to ${currentDevice.name} at ${currentDevice.host}...`);
    
    client = new Client();
    
    client.connect(currentDevice.host, () => {
      console.log('✅ Connected to Chromecast');
      
      // Create channels
      const connection = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.connection', 'JSON');
      const heartbeat = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.tp.heartbeat', 'JSON');
      const receiver = client.createChannel('sender-0', 'receiver-0', 'urn:x-cast:com.google.cast.receiver', 'JSON');
      
      // Establish virtual connection
      connection.send({ type: 'CONNECT' });
      
      // Start heartbeat
      setInterval(() => {
        heartbeat.send({ type: 'PING' });
      }, 5000);
      
      console.log(`🚀 Launching custom receiver app: ${CUSTOM_APP_ID}`);
      
      // Launch custom receiver
      receiver.send({ type: 'LAUNCH', appId: CUSTOM_APP_ID, requestId: 1 });
      
      receiver.on('message', (data) => {
        if (data.type === 'RECEIVER_STATUS' && data.status && data.status.applications) {
          const app = data.status.applications[0];
          console.log('📱 App launched:', app.displayName);
          
          // Join the app session
          const sessionId = app.sessionId;
          const transportId = app.transportId;
          
          // Create media channel
          const media = client.createChannel('sender-0', transportId, 'urn:x-cast:com.google.cast.media', 'JSON');
          
          // Load the URL
          console.log(`📺 Loading URL: ${url}`);
          media.send({
            type: 'LOAD',
            requestId: 2,
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
            if (data.type === 'MEDIA_STATUS') {
              console.log('✅ Media loaded successfully');
              resolve({ success: true });
            }
          });
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

  // Discover devices
  const browser = discoverDevices();

  // Wait a bit for device discovery
  await new Promise(resolve => setTimeout(resolve, 5000));

  if (!currentDevice) {
    console.error('❌ No Chromecast devices found. Make sure your device is on the same network.');
    console.log('💡 Tip: Check Windows Firewall settings - it may be blocking mDNS/Bonjour');
    process.exit(1);
  }

  // Subscribe to realtime updates
  const channel = subscribeToCommands();

  // Also poll for commands as fallback
  console.log('🔄 Starting command polling...');
  const pollInterval = setInterval(processPendingCommands, POLL_INTERVAL);

  // Initial poll
  processPendingCommands();

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down bridge service...');
    clearInterval(pollInterval);
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
