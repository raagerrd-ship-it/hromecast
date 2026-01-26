// API helpers
const API_BASE = '';

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  return res.json();
}

// DOM elements
const elements = {
  status: document.getElementById('status'),
  statusText: document.getElementById('status-text'),
  versionBadge: document.getElementById('version-badge'),
  chromecastSelect: document.getElementById('chromecast-select'),
  refreshBtn: document.getElementById('refresh-btn'),
  deviceCount: document.getElementById('device-count'),
  enabledToggle: document.getElementById('enabled-toggle'),
  urlInput: document.getElementById('url-input'),
  screensaverStatus: document.getElementById('screensaver-status'),
  castBtn: document.getElementById('cast-btn'),
  stopBtn: document.getElementById('stop-btn'),
  previewContainer: document.getElementById('preview-container'),
  deviceId: document.getElementById('device-id'),
  port: document.getElementById('port'),
  networkUrl: document.getElementById('network-url'),
  mdnsUrl: document.getElementById('mdns-url'),
  copyUrlBtn: document.getElementById('copy-url-btn'),
  logsContainer: document.getElementById('logs-container'),
  clearLogsBtn: document.getElementById('clear-logs-btn'),
  // Settings elements
  toggleSettingsBtn: document.getElementById('toggle-settings-btn'),
  settingsContent: document.getElementById('settings-content'),
  screensaverCheckInput: document.getElementById('screensaver-check-input'),
  keepAliveInput: document.getElementById('keep-alive-input'),
  discoveryIntervalInput: document.getElementById('discovery-interval-input'),
  discoveryTimeoutInput: document.getElementById('discovery-timeout-input'),
  discoveryRetryDelayInput: document.getElementById('discovery-retry-delay-input'),
  discoveryMaxRetriesInput: document.getElementById('discovery-max-retries-input'),
  castRetryInput: document.getElementById('cast-retry-input'),
  castMaxRetriesInput: document.getElementById('cast-max-retries-input')
};

// State
let state = {
  settings: {},
  devices: [],
  isLoading: false
};

// ============ UI Updates ============

function updateStatus(online, text) {
  const dot = elements.status.querySelector('.status-dot');
  dot.classList.toggle('online', online);
  elements.statusText.textContent = text;
}

function updateDeviceList(devices) {
  const select = elements.chromecastSelect;
  const currentValue = select.value;
  
  // Keep first option
  select.innerHTML = '<option value="">-- Välj enhet --</option>';
  
  devices.forEach(device => {
    const option = document.createElement('option');
    option.value = device.name;
    option.textContent = device.name;
    select.appendChild(option);
  });
  
  // Restore selection if still available
  if (currentValue && devices.find(d => d.name === currentValue)) {
    select.value = currentValue;
  } else if (state.settings.selectedChromecast) {
    select.value = state.settings.selectedChromecast;
  }
  
  elements.deviceCount.textContent = `${devices.length} enhet(er) hittade`;
}

function updateScreensaverStatus(active) {
  const statusEl = elements.screensaverStatus;
  const indicator = statusEl.querySelector('.status-indicator');
  const text = statusEl.querySelector('span:last-child');
  
  indicator.classList.toggle('on', active);
  indicator.classList.toggle('off', !active);
  text.textContent = active ? 'Aktiv på TV' : 'Inaktiv';
}

function updatePreview(url) {
  const container = elements.previewContainer;
  
  if (!url) {
    container.innerHTML = '<p class="preview-placeholder">Ange en URL ovan för att se förhandsvisning</p>';
    return;
  }
  
  container.innerHTML = `<iframe src="${url}" sandbox="allow-scripts allow-same-origin"></iframe>`;
}

function formatLogTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function updateLogs(logs) {
  const container = elements.logsContainer;
  
  if (!logs || logs.length === 0) {
    container.innerHTML = '<p class="logs-placeholder">Inga loggar ännu...</p>';
    return;
  }
  
  // Show newest first
  const reversedLogs = [...logs].reverse();
  
  container.innerHTML = reversedLogs.map(log => `
    <div class="log-entry ${log.level}">
      <span class="log-time">${formatLogTime(log.timestamp)}</span>
      <span class="log-level">${log.level}</span>
      <span class="log-message">${log.message}</span>
    </div>
  `).join('');
}

function setLoading(loading) {
  state.isLoading = loading;
  elements.refreshBtn.disabled = loading;
  elements.castBtn.disabled = loading;
  elements.stopBtn.disabled = loading;
  
  if (loading) {
    elements.refreshBtn.classList.add('spin');
  } else {
    elements.refreshBtn.classList.remove('spin');
  }
}

// ============ API Calls ============

async function loadSettings() {
  try {
    const data = await api('/api/settings');
    state.settings = data;
    
    elements.enabledToggle.checked = data.enabled;
    elements.urlInput.value = data.url || '';
    elements.deviceId.textContent = data.deviceId || '-';
    
    if (data.selectedChromecast) {
      elements.chromecastSelect.value = data.selectedChromecast;
    }
    
    // Load timing settings
    if (elements.screensaverCheckInput) {
      elements.screensaverCheckInput.value = data.screensaverCheckInterval || 60;
    }
    if (elements.keepAliveInput) {
      elements.keepAliveInput.value = data.keepAliveInterval || 5;
    }
    if (elements.discoveryIntervalInput) {
      elements.discoveryIntervalInput.value = data.discoveryInterval || 30;
    }
    if (elements.discoveryTimeoutInput) {
      elements.discoveryTimeoutInput.value = data.discoveryTimeout || 10;
    }
    if (elements.discoveryRetryDelayInput) {
      elements.discoveryRetryDelayInput.value = data.discoveryRetryDelay || 5;
    }
    if (elements.discoveryMaxRetriesInput) {
      elements.discoveryMaxRetriesInput.value = data.discoveryMaxRetries || 3;
    }
    if (elements.castRetryInput) {
      elements.castRetryInput.value = data.castRetryDelay || 2;
    }
    if (elements.castMaxRetriesInput) {
      elements.castMaxRetriesInput.value = data.castMaxRetries || 3;
    }
    
    updateScreensaverStatus(data.screensaverActive);
    updatePreview(data.url);
    updateStatus(true, 'Ansluten');
  } catch (error) {
    console.error('Failed to load settings:', error);
    updateStatus(false, 'Kunde inte ansluta');
  }
}

async function loadDevices() {
  try {
    const data = await api('/api/chromecasts');
    state.devices = data.devices || [];
    updateDeviceList(state.devices);
  } catch (error) {
    console.error('Failed to load devices:', error);
  }
}

async function loadStatus() {
  try {
    const data = await api('/api/status');
    elements.port.textContent = data.port || '-';
    updateScreensaverStatus(data.screensaverActive);
    
    // Update version badge
    if (data.version && elements.versionBadge) {
      elements.versionBadge.textContent = 'v' + data.version;
    }
    
    // Update network URL display
    if (data.networkUrl && elements.networkUrl) {
      elements.networkUrl.textContent = data.networkUrl;
    }
    if (data.mdnsUrl && elements.mdnsUrl) {
      elements.mdnsUrl.textContent = data.mdnsUrl;
    }
    // Also load logs
    const logsData = await api('/api/logs');
    updateLogs(logsData.logs || []);
  } catch (error) {
    console.error('Failed to load status:', error);
  }
}

async function saveSettings(updates) {
  try {
    const newSettings = { ...state.settings, ...updates };
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify(updates)
    });
    state.settings = newSettings;
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

if (elements.clearLogsBtn) {
  elements.clearLogsBtn.addEventListener('click', async () => {
    try {
      await api('/api/logs', { method: 'DELETE' });
      updateLogs([]);
    } catch (error) {
      console.error('Failed to clear logs:', error);
    }
  });
}

async function refreshDevices() {
  setLoading(true);
  elements.deviceCount.textContent = 'Söker...';
  
  try {
    const data = await api('/api/chromecasts/refresh', { method: 'POST' });
    state.devices = data.devices || [];
    updateDeviceList(state.devices);
  } catch (error) {
    console.error('Failed to refresh devices:', error);
    elements.deviceCount.textContent = 'Sökning misslyckades';
  }
  
  setLoading(false);
}

async function startCast() {
  setLoading(true);
  
  try {
    // Spara URL:en först om den har ändrats
    const currentUrl = elements.urlInput.value.trim();
    if (currentUrl && currentUrl !== state.settings.url) {
      await saveSettings({ url: currentUrl });
      updatePreview(currentUrl);
    }
    
    // Kontrollera att vi har en URL att casta
    if (!currentUrl) {
      alert('Ange en URL att visa först!');
      setLoading(false);
      return;
    }
    
    await api('/api/cast', { method: 'POST' });
    updateScreensaverStatus(true);
  } catch (error) {
    console.error('Cast failed:', error);
    alert('Kunde inte starta cast: ' + error.message);
  }
  
  setLoading(false);
}

async function stopCast() {
  setLoading(true);
  
  try {
    await api('/api/stop', { method: 'POST' });
    updateScreensaverStatus(false);
  } catch (error) {
    console.error('Stop failed:', error);
  }
  
  setLoading(false);
}

// ============ Event Handlers ============

elements.chromecastSelect.addEventListener('change', (e) => {
  saveSettings({ selectedChromecast: e.target.value || null });
});

elements.enabledToggle.addEventListener('change', (e) => {
  saveSettings({ enabled: e.target.checked });
});

elements.urlInput.addEventListener('change', (e) => {
  const url = e.target.value.trim();
  saveSettings({ url });
  updatePreview(url);
});

elements.refreshBtn.addEventListener('click', refreshDevices);
elements.castBtn.addEventListener('click', startCast);
elements.stopBtn.addEventListener('click', stopCast);

// Restart bridge
const restartBtn = document.getElementById('restart-btn');
if (restartBtn) {
  restartBtn.addEventListener('click', async () => {
    if (!confirm('Vill du starta om bridge-tjänsten? Detta krävs för att timing-ändringar ska träda i kraft.')) {
      return;
    }
    
    restartBtn.disabled = true;
    restartBtn.textContent = '⏳ Startar om...';
    
    try {
      await api('/api/restart', { method: 'POST' });
      // Show message and poll for reconnection
      updateStatus(false, 'Startar om...');
      
      // Poll until server is back
      const pollReconnect = () => {
        setTimeout(async () => {
          try {
            await api('/api/status');
            // Server is back
            updateStatus(true, 'Ansluten');
            restartBtn.disabled = false;
            clearSettingsModified();
            await loadSettings();
            await loadDevices();
            await loadStatus();
          } catch (e) {
            // Still restarting, poll again
            pollReconnect();
          }
        }, 1000);
      };
      pollReconnect();
    } catch (error) {
      console.error('Restart failed:', error);
      restartBtn.disabled = false;
      restartBtn.textContent = '🔄 Starta om';
    }
  });
}

// Toggle settings visibility
if (elements.toggleSettingsBtn && elements.settingsContent) {
  elements.toggleSettingsBtn.addEventListener('click', () => {
    const isHidden = elements.settingsContent.style.display === 'none';
    elements.settingsContent.style.display = isHidden ? 'block' : 'none';
    elements.toggleSettingsBtn.textContent = isHidden ? 'Dölj' : 'Visa';
  });
}

// Settings input handlers
const settingsInputs = [
  { el: elements.screensaverCheckInput, key: 'screensaverCheckInterval' },
  { el: elements.keepAliveInput, key: 'keepAliveInterval' },
  { el: elements.discoveryIntervalInput, key: 'discoveryInterval' },
  { el: elements.discoveryTimeoutInput, key: 'discoveryTimeout' },
  { el: elements.discoveryRetryDelayInput, key: 'discoveryRetryDelay' },
  { el: elements.discoveryMaxRetriesInput, key: 'discoveryMaxRetries' },
  { el: elements.castRetryInput, key: 'castRetryDelay' },
  { el: elements.castMaxRetriesInput, key: 'castMaxRetries' }
];

// Track if settings have been modified
let settingsModified = false;

function markSettingsModified() {
  settingsModified = true;
  const restartBtn = document.getElementById('restart-btn');
  if (restartBtn) {
    restartBtn.classList.add('needs-restart');
    restartBtn.textContent = '🔄 Starta om (krävs)';
  }
}

function clearSettingsModified() {
  settingsModified = false;
  const restartBtn = document.getElementById('restart-btn');
  if (restartBtn) {
    restartBtn.classList.remove('needs-restart');
    restartBtn.textContent = '🔄 Starta om';
  }
}

settingsInputs.forEach(({ el, key }) => {
  if (el) {
    el.addEventListener('change', (e) => {
      const value = parseInt(e.target.value, 10);
      if (!isNaN(value)) {
        saveSettings({ [key]: value });
        markSettingsModified();
      }
    });
  }
});

if (elements.copyUrlBtn) {
  elements.copyUrlBtn.addEventListener('click', () => {
    const url = elements.networkUrl?.textContent;
    if (url && url !== '-') {
      navigator.clipboard.writeText(url).then(() => {
        elements.copyUrlBtn.textContent = '✓ Kopierad!';
        setTimeout(() => {
          elements.copyUrlBtn.textContent = '📋 Kopiera';
        }, 2000);
      });
    }
  });
}

// ============ Init ============

async function init() {
  updateStatus(false, 'Ansluter...');
  
  await loadSettings();
  await loadDevices();
  await loadStatus();
  
  // Poll status every 10 seconds
  setInterval(loadStatus, 10000);
}

init();
