// API helpers — Engine runs on UI port + 50 (Pi Control Center convention)
const UI_PORT = parseInt(window.location.port) || 3002;
const ENGINE_PORT = UI_PORT + 50;
const API_BASE = `http://${window.location.hostname}:${ENGINE_PORT}`;

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

// ============ Toast Notifications ============

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const icons = {
    success: '✅',
    error: '❌',
    info: 'ℹ️'
  };
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${message}</span>
  `;
  
  container.appendChild(toast);
  
  // Auto-remove after 3 seconds
  setTimeout(() => {
    toast.style.animation = 'toast-out 0.3s ease-out forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
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
  checkBtn: document.getElementById('check-btn'),
  previewContainer: document.getElementById('preview-container'),
  deviceId: document.getElementById('device-id'),
  port: document.getElementById('port'),
  networkUrl: document.getElementById('network-url'),
  copyUrlBtn: document.getElementById('copy-url-btn'),
  logsContainer: document.getElementById('logs-container'),
  clearLogsBtn: document.getElementById('clear-logs-btn'),
  // Settings elements
  toggleSettingsBtn: document.getElementById('toggle-settings-btn'),
  settingsContent: document.getElementById('settings-content'),
  // Sökning & Discovery
  discoveryTimeoutInput: document.getElementById('discovery-timeout-input'),
  discoveryEarlyResolveInput: document.getElementById('discovery-early-resolve-input'),
  discoveryRetryDelayInput: document.getElementById('discovery-retry-delay-input'),
  discoveryMaxRetriesInput: document.getElementById('discovery-max-retries-input'),
  // Cast & Session
  screensaverCheckInput: document.getElementById('screensaver-check-input'),
  keepAliveInput: document.getElementById('keep-alive-input'),
  idleStatusTimeoutInput: document.getElementById('idle-status-timeout-input'),
  castRetryInput: document.getElementById('cast-retry-input'),
  castMaxRetriesInput: document.getElementById('cast-max-retries-input'),
  receiverAutoRefreshInput: document.getElementById('receiver-auto-refresh-input'),
  // Återhämtning & Skydd
  cooldownAfterTakeoverInput: document.getElementById('cooldown-after-takeover-input'),
  recoveryCheckIntervalInput: document.getElementById('recovery-check-interval-input'),
  circuitBreakerThresholdInput: document.getElementById('circuit-breaker-threshold-input'),
  circuitBreakerCooldownInput: document.getElementById('circuit-breaker-cooldown-input'),
  // Reset buttons
  resetDiscoveryBtn: document.getElementById('reset-discovery-btn'),
  resetCastBtn: document.getElementById('reset-cast-btn'),
  resetRecoveryBtn: document.getElementById('reset-recovery-btn'),
  // Restart overlay
  restartOverlay: document.getElementById('restart-overlay'),
  restartMessage: document.getElementById('restart-message'),
  restartTimer: document.getElementById('restart-timer')
};

// State
let state = {
  settings: {},
  devices: [],
  isLoading: false,
  previewActive: false,
  previewUrl: '',
  lastStatusFingerprint: '',
  lastLogsFingerprint: '',
  lastRenderedLogs: []
};

// Log filter state (debug OFF by default)
let logFilters = JSON.parse(localStorage.getItem('logFilters')) || {
  cast: true,
  status: true,
  debug: false,
  error: true,
  system: true
};

const POLL_INTERVAL_FALLBACK_SECONDS = 60;
const LOG_POLL_INTERVAL_MS = 15000;
let statusPollInterval = null;
let logsPollInterval = null;

// ============ UI Updates ============

function updateStatus(online, text) {
  const dot = elements.status.querySelector('.status-dot');
  dot.classList.toggle('online', online);
  if (elements.statusText.textContent !== text) {
    elements.statusText.textContent = text;
  }
}

function updateDeviceList(devices) {
  const select = elements.chromecastSelect;
  const currentValue = select.value;
  
  // Keep first option
  select.innerHTML = '<option value="">-- Välj enhet --</option>';
  
  devices.forEach(device => {
    const option = document.createElement('option');
    option.value = device.name;
    const lastOctet = device.host ? '.' + device.host.split('.').pop() : '';
    option.textContent = `${device.name}${lastOctet ? ' (…' + lastOctet + ')' : ''}`;
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

function ensurePreviewActivated() {
  if (state.previewActive) {
    return;
  }

  state.previewActive = true;
  renderPreview();
}

function renderPreview() {
  const container = elements.previewContainer;
  const url = state.previewUrl;

  if (!url) {
    container.innerHTML = '<p class="preview-placeholder">Ange en URL ovan för att se förhandsvisning</p>';
    return;
  }

  if (!state.previewActive) {
    container.innerHTML = '<p class="preview-placeholder">Förhandsvisning laddas först när du fokuserar URL-fältet eller startar en cast</p>';
    return;
  }

  const existingFrame = container.querySelector('iframe');
  if (existingFrame && existingFrame.dataset.src === url) {
    return;
  }

  container.innerHTML = `<iframe src="${url}" data-src="${url}" sandbox="allow-scripts allow-same-origin"></iframe>`;
}


function updatePreview(url) {
  state.previewUrl = url || '';
  renderPreview();
}

function formatLogTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function updateLogs(logs) {
  const container = elements.logsContainer;
  const fingerprint = JSON.stringify({ filters: logFilters, items: (logs || []).map(log => [log.timestamp, log.level, log.category, log.message]) });

  if (fingerprint === state.lastLogsFingerprint) {
    return;
  }

  state.lastLogsFingerprint = fingerprint;
  state.lastRenderedLogs = logs || [];
  
  if (!logs || logs.length === 0) {
    container.innerHTML = '<p class="logs-placeholder">Inga loggar ännu...</p>';
    return;
  }
  
  // Filter logs based on active filters
  const filteredLogs = logs.filter(log => {
    const category = log.category || 'system';
    // Also check if level is 'debug' - hide these unless debug filter is active
    if (log.level === 'debug' && !logFilters.debug) {
      return false;
    }
    return logFilters[category] !== false;
  });
  
  if (filteredLogs.length === 0) {
    container.innerHTML = '<p class="logs-placeholder">Inga loggar matchar filtret...</p>';
    return;
  }
  
  // Sort by timestamp descending (newest first)
  const sortedLogs = [...filteredLogs].sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    return timeB - timeA;
  });
  
  const html = sortedLogs.map(log => `
    <div class="log-entry ${log.level}" data-category="${log.category || 'system'}">
      <span class="log-time">${formatLogTime(log.timestamp)}</span>
      <span class="log-level">${log.level.toUpperCase()}</span>
      <span class="log-message">${log.message}</span>
    </div>
  `).join('');
  
  container.innerHTML = html;
}

// Initialize log filter buttons
function initLogFilters() {
  const filterButtons = document.querySelectorAll('.log-filter');
  
  // Set initial active states from localStorage
  filterButtons.forEach(btn => {
    const filter = btn.dataset.filter;
    if (logFilters[filter]) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  // Add click handlers
  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.dataset.filter;
      logFilters[filter] = !logFilters[filter];
      btn.classList.toggle('active', logFilters[filter]);
      localStorage.setItem('logFilters', JSON.stringify(logFilters));
      updateLogs(state.lastRenderedLogs);
    });
  });
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
    
    // Load timing settings - Sökning & Discovery
    if (elements.discoveryTimeoutInput) {
      elements.discoveryTimeoutInput.value = data.discoveryTimeout || 10;
    }
    if (elements.discoveryEarlyResolveInput) {
      elements.discoveryEarlyResolveInput.value = data.discoveryEarlyResolve || 4;
    }
    if (elements.discoveryRetryDelayInput) {
      elements.discoveryRetryDelayInput.value = data.discoveryRetryDelay || 5;
    }
    if (elements.discoveryMaxRetriesInput) {
      elements.discoveryMaxRetriesInput.value = data.discoveryMaxRetries || 3;
    }
    
    // Load timing settings - Cast & Session
    if (elements.screensaverCheckInput) {
      elements.screensaverCheckInput.value = data.screensaverCheckInterval || 60;
    }
    if (elements.keepAliveInput) {
      elements.keepAliveInput.value = data.keepAliveInterval || 5;
    }
    if (elements.idleStatusTimeoutInput) {
      elements.idleStatusTimeoutInput.value = data.idleStatusTimeout || 5;
    }
    if (elements.castRetryInput) {
      elements.castRetryInput.value = data.castRetryDelay || 2;
    }
    if (elements.castMaxRetriesInput) {
      elements.castMaxRetriesInput.value = data.castMaxRetries || 3;
    }
    if (elements.receiverAutoRefreshInput) {
      elements.receiverAutoRefreshInput.value = data.receiverAutoRefresh || 45;
    }
    
    // Load timing settings - Återhämtning & Skydd
    if (elements.cooldownAfterTakeoverInput) {
      elements.cooldownAfterTakeoverInput.value = data.cooldownAfterTakeover || 30;
    }
    if (elements.recoveryCheckIntervalInput) {
      elements.recoveryCheckIntervalInput.value = data.recoveryCheckInterval || 10;
    }
    if (elements.circuitBreakerThresholdInput) {
      elements.circuitBreakerThresholdInput.value = data.circuitBreakerThreshold || 5;
    }
    if (elements.circuitBreakerCooldownInput) {
      elements.circuitBreakerCooldownInput.value = data.circuitBreakerCooldown || 5;
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
    const fingerprint = JSON.stringify({
      port: data.port,
      active: data.screensaverActive,
      version: data.version,
      networkUrl: data.networkUrl,
      mem: data.memory,
      recovery: data.recovery,
      breaker: data.circuitBreaker,
      lastDeviceCheck: data.lastDeviceCheck
    });

    if (fingerprint === state.lastStatusFingerprint) {
      return;
    }

    state.lastStatusFingerprint = fingerprint;

    if (elements.port.textContent !== String(data.port || '-')) {
      elements.port.textContent = data.port || '-';
    }
    updateScreensaverStatus(data.screensaverActive);
    
    if (data.version && elements.versionBadge) {
      const versionText = 'v' + data.version;
      if (elements.versionBadge.textContent !== versionText) {
        elements.versionBadge.textContent = versionText;
      }
    }
    
    const receiverBadge = document.getElementById('receiver-version-badge');
    if (data.version && receiverBadge) {
      const receiverText = '📺 v' + data.version;
      if (receiverBadge.textContent !== receiverText) {
        receiverBadge.textContent = receiverText;
      }
    }
    
    if (data.networkUrl && elements.networkUrl && elements.networkUrl.textContent !== data.networkUrl) {
      elements.networkUrl.textContent = data.networkUrl;
    }
  } catch (error) {
    console.error('Failed to load status:', error);
  }
}

async function loadLogs() {
  try {
    const logsData = await api('/api/logs');
    updateLogs(logsData.logs || []);
  } catch (error) {
    console.error('Failed to load logs:', error);
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
    return true;
  } catch (error) {
    console.error('Failed to save settings:', error);
    showToast('Kunde inte spara inställningar', 'error');
    return false;
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
    showToast('Cast startad', 'success');
  } catch (error) {
    console.error('Cast failed:', error);
    showToast('Kunde inte starta cast: ' + error.message, 'error');
  }
  
  setLoading(false);
}

async function stopCast() {
  setLoading(true);
  
  try {
    await api('/api/stop', { method: 'POST' });
    updateScreensaverStatus(false);
    showToast('Cast stoppad', 'success');
  } catch (error) {
    console.error('Stop failed:', error);
    showToast('Kunde inte stoppa cast', 'error');
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

// Manual check button
if (elements.checkBtn) {
  elements.checkBtn.addEventListener('click', async () => {
    elements.checkBtn.disabled = true;
    elements.checkBtn.textContent = '🔍 Kontrollerar...';
    
    try {
      const result = await api('/api/check', { method: 'POST' });
      
      if (result.status === 'cast_triggered') {
        showToast('Cast startad!', 'success');
        updateScreensaverStatus(true);
      } else if (result.status === 'already_running') {
        showToast('Appen körs redan på TV', 'info');
        updateScreensaverStatus(true);
      } else if (result.status === 'busy') {
        showToast('Enheten används av annan app', 'info');
      } else if (result.status === 'idle') {
        showToast('Enheten ledig men screensaver ej aktiverat', 'info');
      } else {
        showToast(`Status: ${result.status}`, 'info');
      }
      
      // Reload status and logs
      await loadStatus();
    } catch (error) {
      console.error('Check failed:', error);
      showToast('Kunde inte kontrollera: ' + error.message, 'error');
    }
    
    elements.checkBtn.disabled = false;
    elements.checkBtn.textContent = '🔍 Kontrollera';
  });
}

// Reload receiver button - forces stop + restart to load fresh receiver code
const reloadReceiverBtn = document.getElementById('reload-receiver-btn');
if (reloadReceiverBtn) {
  reloadReceiverBtn.addEventListener('click', async () => {
    reloadReceiverBtn.disabled = true;
    const originalText = reloadReceiverBtn.textContent;
    reloadReceiverBtn.textContent = '⏳ Stoppar...';
    
    try {
      // 1. Stop the app completely
      await api('/api/force-stop', { method: 'POST' });
      showToast('Stoppar receiver...', 'info');
      
      // 2. Wait for Chromecast to close the app
      reloadReceiverBtn.textContent = '⏳ Väntar...';
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // 3. Start fresh cast
      reloadReceiverBtn.textContent = '⏳ Startar...';
      await api('/api/cast', { method: 'POST' });
      
      updateScreensaverStatus(true);
      showToast('Receiver omstartad!', 'success');
      
      // Reload logs to show the new activity
      await loadStatus();
    } catch (error) {
      console.error('Reload receiver failed:', error);
      showToast('Kunde inte ladda om receiver: ' + error.message, 'error');
    }
    
    reloadReceiverBtn.disabled = false;
    reloadReceiverBtn.textContent = originalText;
  });
}

// Restart bridge with overlay
const restartBtn = document.getElementById('restart-btn');
if (restartBtn) {
  restartBtn.addEventListener('click', async () => {
    if (!confirm('⚠️ Vill du starta om bridge-tjänsten?\n\nDetta kommer att:\n• Tillfälligt bryta anslutningen till Chromecast\n• Stoppa aktiv screensaver\n• Applicera alla inställningsändringar\n\nTjänsten startar om automatiskt inom några sekunder.')) {
      return;
    }
    
    restartBtn.disabled = true;
    
    // Show overlay
    if (elements.restartOverlay) {
      elements.restartOverlay.style.display = 'flex';
    }
    if (elements.restartMessage) {
      elements.restartMessage.textContent = 'Startar om bridge...';
    }
    
    // Start timer
    let seconds = 0;
    const timerInterval = setInterval(() => {
      seconds++;
      if (elements.restartTimer) {
        elements.restartTimer.textContent = `${seconds}s`;
      }
    }, 1000);
    
    try {
      await api('/api/restart', { method: 'POST' });
      
      // Update message
      if (elements.restartMessage) {
        elements.restartMessage.textContent = 'Återansluter...';
      }
      
      // Poll until server is back
      const pollReconnect = () => {
        setTimeout(async () => {
          try {
            await api('/api/status');
            // Server is back - hide overlay
            clearInterval(timerInterval);
            if (elements.restartOverlay) {
              elements.restartOverlay.style.display = 'none';
            }
            
            updateStatus(true, 'Ansluten');
            restartBtn.disabled = false;
            clearSettingsModified();
            await loadSettings();
            await loadDevices();
            await loadStatus();
            
            showToast('Bridge omstartad', 'success');
          } catch (e) {
            // Still restarting, poll again
            pollReconnect();
          }
        }, 1000);
      };
      pollReconnect();
    } catch (error) {
      console.error('Restart failed:', error);
      clearInterval(timerInterval);
      if (elements.restartOverlay) {
        elements.restartOverlay.style.display = 'none';
      }
      restartBtn.disabled = false;
      showToast('Kunde inte starta om bridge', 'error');
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

// Settings input handlers - all configurable settings
const settingsInputs = [
  // Sökning & Discovery
  { el: elements.discoveryTimeoutInput, key: 'discoveryTimeout' },
  { el: elements.discoveryEarlyResolveInput, key: 'discoveryEarlyResolve' },
  { el: elements.discoveryRetryDelayInput, key: 'discoveryRetryDelay' },
  { el: elements.discoveryMaxRetriesInput, key: 'discoveryMaxRetries' },
  // Cast & Session
  { el: elements.screensaverCheckInput, key: 'screensaverCheckInterval' },
  { el: elements.keepAliveInput, key: 'keepAliveInterval' },
  { el: elements.idleStatusTimeoutInput, key: 'idleStatusTimeout' },
  { el: elements.castRetryInput, key: 'castRetryDelay' },
  { el: elements.castMaxRetriesInput, key: 'castMaxRetries' },
  { el: elements.receiverAutoRefreshInput, key: 'receiverAutoRefresh' },
  // Återhämtning & Skydd
  { el: elements.cooldownAfterTakeoverInput, key: 'cooldownAfterTakeover' },
  { el: elements.recoveryCheckIntervalInput, key: 'recoveryCheckInterval' },
  { el: elements.circuitBreakerThresholdInput, key: 'circuitBreakerThreshold' },
  { el: elements.circuitBreakerCooldownInput, key: 'circuitBreakerCooldown' }
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
    restartBtn.textContent = '🔄 Starta om bridge';
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

// Default values for reset functionality
const DEFAULT_VALUES = {
  // Sökning & Discovery
  discoveryTimeout: 10,
  discoveryEarlyResolve: 4,
  discoveryRetryDelay: 5,
  discoveryMaxRetries: 3,
  // Cast & Session
  screensaverCheckInterval: 60,
  keepAliveInterval: 5,
  idleStatusTimeout: 5,
  castRetryDelay: 2,
  castMaxRetries: 3,
  receiverAutoRefresh: 45,
  // Återhämtning & Skydd
  cooldownAfterTakeover: 30,
  recoveryCheckInterval: 10,
  circuitBreakerThreshold: 5,
  circuitBreakerCooldown: 5
};

// Reset Discovery settings
if (elements.resetDiscoveryBtn) {
  elements.resetDiscoveryBtn.addEventListener('click', async () => {
    const updates = {
      discoveryTimeout: DEFAULT_VALUES.discoveryTimeout,
      discoveryEarlyResolve: DEFAULT_VALUES.discoveryEarlyResolve,
      discoveryRetryDelay: DEFAULT_VALUES.discoveryRetryDelay,
      discoveryMaxRetries: DEFAULT_VALUES.discoveryMaxRetries
    };
    
    // Update UI
    if (elements.discoveryTimeoutInput) {
      elements.discoveryTimeoutInput.value = updates.discoveryTimeout;
    }
    elements.discoveryEarlyResolveInput.value = updates.discoveryEarlyResolve;
    elements.discoveryRetryDelayInput.value = updates.discoveryRetryDelay;
    elements.discoveryMaxRetriesInput.value = updates.discoveryMaxRetries;
    
    // Save
    await saveSettings(updates);
    showToast('Sök-inställningar återställda', 'info');
    markSettingsModified();
  });
}

// Reset Cast settings
if (elements.resetCastBtn) {
  elements.resetCastBtn.addEventListener('click', async () => {
    const updates = {
      screensaverCheckInterval: DEFAULT_VALUES.screensaverCheckInterval,
      keepAliveInterval: DEFAULT_VALUES.keepAliveInterval,
      idleStatusTimeout: DEFAULT_VALUES.idleStatusTimeout,
      castRetryDelay: DEFAULT_VALUES.castRetryDelay,
      castMaxRetries: DEFAULT_VALUES.castMaxRetries,
      receiverAutoRefresh: DEFAULT_VALUES.receiverAutoRefresh
    };
    
    // Update UI
    elements.screensaverCheckInput.value = updates.screensaverCheckInterval;
    elements.keepAliveInput.value = updates.keepAliveInterval;
    elements.idleStatusTimeoutInput.value = updates.idleStatusTimeout;
    elements.castRetryInput.value = updates.castRetryDelay;
    elements.castMaxRetriesInput.value = updates.castMaxRetries;
    elements.receiverAutoRefreshInput.value = updates.receiverAutoRefresh;
    
    // Save
    await saveSettings(updates);
    showToast('Cast-inställningar återställda', 'info');
    markSettingsModified();
  });
}

// Reset Recovery settings
if (elements.resetRecoveryBtn) {
  elements.resetRecoveryBtn.addEventListener('click', async () => {
    const updates = {
      cooldownAfterTakeover: DEFAULT_VALUES.cooldownAfterTakeover,
      recoveryCheckInterval: DEFAULT_VALUES.recoveryCheckInterval,
      circuitBreakerThreshold: DEFAULT_VALUES.circuitBreakerThreshold,
      circuitBreakerCooldown: DEFAULT_VALUES.circuitBreakerCooldown
    };
    
    // Update UI
    elements.cooldownAfterTakeoverInput.value = updates.cooldownAfterTakeover;
    elements.recoveryCheckIntervalInput.value = updates.recoveryCheckInterval;
    elements.circuitBreakerThresholdInput.value = updates.circuitBreakerThreshold;
    elements.circuitBreakerCooldownInput.value = updates.circuitBreakerCooldown;
    
    // Save
    await saveSettings(updates);
    showToast('Recovery-inställningar återställda', 'info');
    markSettingsModified();
  });
}

// Copy URL button
if (elements.copyUrlBtn) {
  elements.copyUrlBtn.addEventListener('click', () => {
    const url = elements.networkUrl?.textContent;
    if (url && url !== '-') {
      navigator.clipboard.writeText(url).then(() => {
        showToast('URL kopierad till urklipp', 'success');
      });
    }
  });
}

// ============ Init ============

let statusPollInterval = null;

async function init() {
  updateStatus(false, 'Ansluter...');
  
  // Initialize log filters before loading data
  initLogFilters();
  
  await loadSettings();
  await loadDevices();
  await loadStatus();
  
  // Start polling based on screensaver check interval
  startStatusPolling();
}

function startStatusPolling() {
  // Clear existing interval if any
  if (statusPollInterval) {
    clearInterval(statusPollInterval);
  }
  
  // Poll at same interval as screensaver check (default 60 seconds)
  const intervalSeconds = state.settings.screensaverCheckInterval || 60;
  const intervalMs = intervalSeconds * 1000;
  
  console.log(`📊 Polling interval: ${intervalSeconds}s (matches screensaver check)`);
  
  statusPollInterval = setInterval(loadStatus, intervalMs);
}

init();
