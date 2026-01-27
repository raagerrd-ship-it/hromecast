
# Plan: Add "Force Reload Receiver" Button to Bridge Dashboard

## Overview
Add a button to the bridge dashboard that forces the Chromecast receiver to reload completely. This is useful when the receiver is stuck on an old version or showing "Ready to cast..." and won't respond to normal cast commands.

## How It Works
The button will:
1. Send STOP command to completely terminate the receiver app
2. Wait 3 seconds for the Chromecast to fully close the app
3. Send a new CAST command to restart with the latest receiver code

This forces the Chromecast to download and run the newest version of `chromecast-receiver.html`.

## Changes

### 1. Update Dashboard HTML (`bridge/public/index.html`)
Add a new button in the Controls section:
- Button text: "🔄 Ladda om receiver"
- Button ID: `reload-receiver-btn`
- Styled as warning/info button
- Tooltip: "Stoppar och startar om receiver-appen för att tvinga ny version"

### 2. Update Dashboard JavaScript (`bridge/public/app.js`)
Add a click handler for the new button that:
- Disables the button during the operation
- Shows progress feedback via toast notifications
- Calls `/api/force-stop` first
- Waits 3 seconds
- Calls `/api/cast` to restart
- Shows success/error toast
- Re-enables the button

### 3. Update CSS (if needed) (`bridge/public/style.css`)
May need to add a `btn-warning` style for the new button if it doesn't exist.

---

## Technical Details

### Button HTML
```html
<button id="reload-receiver-btn" class="btn btn-warning" 
  title="Stoppar och startar om receiver-appen för att tvinga ny version">
  🔄 Ladda om receiver
</button>
```

### JavaScript Handler (app.js)
```javascript
async function reloadReceiver() {
  // 1. Stop the app completely
  await api('/api/force-stop', { method: 'POST' });
  
  // 2. Wait for Chromecast to close
  await new Promise(r => setTimeout(r, 3000));
  
  // 3. Start fresh cast
  await api('/api/cast', { method: 'POST' });
}
```

### Flow Diagram
```text
[User clicks button]
       |
       v
[Disable button, show "Stoppar..."]
       |
       v
[POST /api/force-stop] --> Sends STOP to Chromecast
       |
       v
[Wait 3 seconds]
       |
       v
[POST /api/cast] --> Launches receiver with fresh code
       |
       v
[Show success toast, enable button]
```

## Benefits
- Eliminates the "chicken and egg" problem where old receiver code can't auto-update
- No need to restart the entire bridge service
- No need to unplug/replug the Chromecast
- Keeps the session and configuration intact
