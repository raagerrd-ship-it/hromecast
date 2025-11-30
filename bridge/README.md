# Chromecast Bridge Service

This local bridge service connects your Chromecast to the cloud, allowing you to control it remotely without keeping a browser open.

## How It Works

1. The bridge runs on a device in your local network (same network as your Chromecast)
2. It connects to Supabase and listens for cast commands
3. When a command arrives, it executes it on your Chromecast
4. Your web app can now cast videos even when closed

## Installation

### Prerequisites
- Node.js 18 or higher
- A device on the same network as your Chromecast (Raspberry Pi, PC, Mac, etc.)
- Your Chromecast device

### Setup

1. Navigate to the bridge directory:
```bash
cd bridge
```

2. Install dependencies:
```bash
npm install
```

3. Create your `.env` file:
```bash
cp .env.example .env
```

4. Edit `.env` and add your Supabase credentials:
```env
SUPABASE_URL=https://umxwaxzmoxwasryjibhe.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
DEVICE_ID=my-bridge
POLL_INTERVAL=5000
```

The `DEVICE_ID` should match the device ID you configure in the web app.

## Running the Bridge

### Development Mode (with auto-restart)
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

## Running as a Background Service

### On Linux/macOS (using systemd or launchd)

Create a systemd service file at `/etc/systemd/system/chromecast-bridge.service`:

```ini
[Unit]
Description=Chromecast Bridge Service
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/bridge
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable chromecast-bridge
sudo systemctl start chromecast-bridge
sudo systemctl status chromecast-bridge
```

### On Raspberry Pi

1. Install Node.js:
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

2. Follow the same systemd instructions above

### On Windows

You can use a tool like [NSSM](https://nssm.cc/) to run it as a Windows service.

## Troubleshooting

### Bridge can't find Chromecast
- Make sure your device is on the same local network as your Chromecast
- Check that mDNS/Bonjour is not blocked by your firewall
- Try restarting your Chromecast

### Commands not processing
- Check the bridge logs for errors
- Verify your Supabase credentials are correct
- Make sure the DEVICE_ID matches between web app and bridge

### Installation errors on Linux
If you get errors installing `mdns`, you may need to install system dependencies:

Ubuntu/Debian:
```bash
sudo apt-get install libavahi-compat-libdnssd-dev
```

Fedora/RedHat:
```bash
sudo yum install avahi-compat-libdns_sd-devel
```

## Configuration

- `DEVICE_ID`: Unique identifier for this bridge instance (default: "default-bridge")
- `POLL_INTERVAL`: How often to check for new commands in milliseconds (default: 5000)
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_ANON_KEY`: Your Supabase anonymous key

## Logs

The bridge outputs detailed logs to the console:
- 🔍 Device discovery status
- 📺 Cast operations
- ✅ Successful commands
- ❌ Errors and failures

## Security

The bridge uses your Supabase anonymous key, which is safe to use on a trusted local network device. The RLS policies in Supabase control access to commands.

For additional security, you can:
1. Use a firewall to restrict bridge network access
2. Run the bridge on a dedicated device
3. Use Supabase RLS policies to restrict command creation