# 📱 Mobile Bridge Setup Guide

Turn your old Android phone into a dedicated Chromecast bridge server!

## What This Does

This creates a native Android app that:
- ✅ Runs on your old phone 24/7
- ✅ Connects to Supabase and listens for cast commands
- ✅ Controls your Chromecast on the local network
- ✅ Works even when your main device is offline
- ✅ Shows real-time status of cast operations

## Setup Instructions

### Step 1: Export to GitHub

1. Click the "Export to GitHub" button in Lovable
2. Clone the repository to your computer:
   ```bash
   git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
   cd YOUR_REPO
   ```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Initialize Capacitor

The project is already configured, but you need to add the Android platform:

```bash
npx cap add android
```

### Step 4: Build the Web App

```bash
npm run build
```

### Step 5: Sync to Android

```bash
npx cap sync android
```

### Step 6: Open in Android Studio

```bash
npx cap open android
```

This will open Android Studio. You may need to:
1. Install Android Studio if you haven't already: https://developer.android.com/studio
2. Let Android Studio download any required SDK components
3. Connect your old Android phone via USB (enable Developer Mode and USB Debugging)

### Step 7: Run on Your Phone

1. In Android Studio, select your phone from the device dropdown
2. Click the green "Run" button
3. The app will install and launch on your phone

## Using the Bridge App

### First Time Setup

1. Open the app on your phone
2. Enter a unique **Device ID** (e.g., "my-old-phone")
3. Click "Save Configuration"
4. Click "Start Bridge"

### Keep It Running

For best results:
- Keep the app open in the foreground
- Connect phone to power
- Keep phone connected to the same WiFi as your Chromecast
- Make sure the phone doesn't go into deep sleep

### Configure Your Main App

In your main web app's screensaver settings:
1. Use the same **Device ID** you configured on the phone
2. The bridge will now process all cast commands for that device ID

## How It Works

```
Your Web App → Queue Cast Command → Supabase Database 
                                          ↓
                                   [Realtime Updates]
                                          ↓
                              Your Old Phone (Bridge App)
                                          ↓
                                   Your Chromecast
```

## Troubleshooting

### App won't install
- Make sure USB Debugging is enabled on your phone
- Try a different USB cable
- Check Android Studio's Logcat for errors

### Bridge can't find Chromecast
- Ensure phone and Chromecast are on the same WiFi network
- Check that the WiFi allows device discovery (not in guest/isolation mode)
- Try restarting your Chromecast

### Commands not processing
- Check that the Device ID matches between web app and bridge app
- Ensure the bridge service is running (green status)
- Check your internet connection
- Verify Supabase credentials are correct

### App keeps closing
- Disable battery optimization for the app in Android settings
- Keep phone plugged in to power
- Consider using a "keep awake" app alongside it

## Important Notes

⚠️ **Current Limitation**: This version requires the app to stay open. True background service functionality would require additional native Android code that runs even when the app is closed.

💡 **Alternative**: For true 24/7 operation, consider using a Raspberry Pi or old laptop with the Node.js bridge service instead (see `bridge/README.md`).

## Advanced: Background Service (Future Enhancement)

To make this work as a true background service, you would need to:
1. Create a native Android foreground service
2. Add Capacitor plugin for background execution
3. Handle wake locks and battery optimization
4. Implement Chromecast discovery in native Android code

This requires native Android development skills and is beyond the scope of the current web-based implementation.

## Support

For issues or questions:
1. Check the console logs in the app
2. Review the Supabase database for command status
3. Test with the Node.js bridge first to verify your setup