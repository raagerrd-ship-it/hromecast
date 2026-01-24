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
  copyUrlBtn: document.getElementById('copy-url-btn')
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
    
    // Update network URL display
    if (data.networkUrl && elements.networkUrl) {
      elements.networkUrl.textContent = data.networkUrl;
    }
    if (data.mdnsUrl && elements.mdnsUrl) {
      elements.mdnsUrl.textContent = data.mdnsUrl;
    }
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
