import { createClient } from '@supabase/supabase-js';
import { Client, DefaultMediaReceiver } from 'castv2-client';
import Bonjour from 'bonjour-service';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
let chromecastDevices = new Map();
let currentClient = null;

// Discover Chromecast devices
function discoverDevices() {
  console.log('🔍 Scanning for Chromecast devices on local network...');
  
  const bonjour = new Bonjour();
  const browser = bonjour.find({ type: 'googlecast' });
  
  browser.on('up', (service) => {
    const deviceName = service.txt?.fn || service.name;
    const deviceHost = service.referer?.address || service.host;
    
    console.log(`✅ Found Chromecast: ${deviceName} at ${deviceHost}:${service.port}`);
    
    chromecastDevices.set(deviceName, {
      name: deviceName,
      host: deviceHost,
      port: service.port,
      txtRecord: service.txt
    });
  });
  
  browser.on('down', (service) => {
    const deviceName = service.txt?.fn || service.name;
    console.log(`❌ Chromecast offline: ${deviceName}`);
    chromecastDevices.delete(deviceName);
  });
  
  return browser;
}

// Connect to Chromecast
async function connectToChromecast(device) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    
    client.connect(device.host, () => {
      console.log(`🔗 Connected to ${device.name}`);
      currentClient = client;
      resolve(client);
    });
    
    client.on('error', (err) => {
      console.error(`❌ Error connecting to ${device.name}:`, err.message);
      currentClient = null;
      reject(err);
    });
  });
}

// Cast media to Chromecast
async function castMedia(url) {
  if (chromecastDevices.size === 0) {
    throw new Error('No Chromecast devices found on network');
  }
  
  // Get first available device
  const device = Array.from(chromecastDevices.values())[0];
  console.log(`📺 Casting to ${device.name}: ${url}`);
  
  try {
    // Connect if not already connected
    if (!currentClient) {
      await connectToChromecast(device);
    }
    
    // Launch DefaultMediaReceiver
    await new Promise((resolve, reject) => {
      currentClient.launch(DefaultMediaReceiver, (err, player) => {
        if (err) {
          reject(err);
          return;
        }
        
        // Load media - use text/html for viewer pages
        const media = {
          contentId: url,
          contentType: 'text/html',
          streamType: 'BUFFERED',
          metadata: {
            type: 0,
            metadataType: 0,
            title: 'Website Viewer',
            images: []
          }
        };
        
        player.load(media, { autoplay: true }, (err, status) => {
          if (err) {
            reject(err);
            return;
          }
          
          console.log('✅ Media loaded successfully');
          console.log('Status:', status);
          resolve(status);
        });
      });
    });
    
    return { success: true };
  } catch (error) {
    console.error('❌ Cast error:', error.message);
    // Reset connection on error
    if (currentClient) {
      currentClient.close();
      currentClient = null;
    }
    throw error;
  }
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
  const browser = discoverDevices();
  
  // Wait a bit for discovery
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  if (chromecastDevices.size === 0) {
    console.warn('⚠️  No Chromecast devices found. Make sure your Chromecast is on the same network.');
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
    browser.stop();
    channel.unsubscribe();
    if (currentClient) {
      currentClient.close();
    }
    process.exit(0);
  });
}

// Start the service
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});