// DIVxPAPA 💀 v10.0 — ES Module background worker
// He built this. No remote. No webhooks. No token reads.

const DEFAULTS = {
  profileVersion: 10,
  enabled: true,
  preset: 'clear',
  gainDb: 18,
  loudness: 1,
  maxBoost: 4,
  drive: 0.22,
  thresholdDb: -28,
  ratio: 8,
  limiterDb: -1,
  presenceDb: 3,
  lowShelfDb: 2,
  highShelfDb: 3,
  sustain: true,
  sustainTargetDb: -12,
  sustainMaxGain: 6,
  forceRawMic: true,
  reverbEnabled: false,
  reverbDelay: 0.045,
  reverbFeedback: 0.12,
  reverbWet: 0.04,
  keepAlive: false,
  keepAliveGain: 0.00005,
  senderRefreshMs: 1500,
  remoteVolume: 1,
  remoteVolumeGuard: false,
  voiceLock: false,
  noiseGateEnabled: false,
  noiseGateThreshold: -50,
  eqEnabled: false,
  eqLow: 0,
  eqMid: 0,
  eqHigh: 0
};

const PRESETS = {
  clear: { ...DEFAULTS, gainDb: 18, loudness: 1, drive: 0.22, thresholdDb: -28, ratio: 8, presenceDb: 3 },
  max: { ...DEFAULTS, gainDb: 30, loudness: 1.5, maxBoost: 6, drive: 0.35, thresholdDb: -24, ratio: 10, presenceDb: 5, highShelfDb: 5, sustainTargetDb: -15 },
  studio: { ...DEFAULTS, gainDb: 12, loudness: 0.8, drive: 0.15, thresholdDb: -32, ratio: 6, presenceDb: 4, reverbEnabled: true, reverbDelay: 0.035, reverbWet: 0.06, eqEnabled: true, eqLow: 2, eqMid: 1, eqHigh: 3 },
  safe: { ...DEFAULTS, gainDb: 8, loudness: 0.6, drive: 0.1, thresholdDb: -35, ratio: 4, limiterDb: -3, sustain: false }
};

const state = {
  installedAt: Date.now(),
  lastHeartbeat: 0,
  hookActiveTabs: new Set(),
  config: { ...DEFAULTS }
};

// Storage
async function loadConfig() {
  try {
    const result = await chrome.storage.local.get('divxpapaConfig');
    if (result.divxpapaConfig) {
      const saved = JSON.parse(result.divxpapaConfig);
      if (saved.profileVersion === 10) {
        state.config = { ...DEFAULTS, ...saved };
        return;
      }
    }
    await saveConfig();
  } catch (_) {
    await saveConfig();
  }
}

async function saveConfig() {
  try {
    await chrome.storage.local.set({ divxpapaConfig: JSON.stringify(state.config) });
  } catch (_) {}
}

async function applyPreset(name) {
  if (PRESETS[name]) {
    state.config = { ...state.config, ...PRESETS[name], preset: name };
    await saveConfig();
    broadcastUpdate();
  }
}

function broadcastUpdate() {
  chrome.tabs.query({ url: ['https://*/*', 'http://localhost:*/*'] }, (tabs) => {
    tabs.forEach(tab => {
      try {
        chrome.tabs.sendMessage(tab.id, {
          type: 'DIVxPAPA_CONFIG_UPDATE',
          config: state.config
        }).catch(() => {});
      } catch (_) {}
    });
  });
}

// Message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  switch (message.type) {
    case 'DIVxPAPA_HEARTBEAT':
      state.lastHeartbeat = Date.now();
      if (sender?.tab?.id != null) state.hookActiveTabs.add(sender.tab.id);
      sendResponse({ ok: true });
      return false;

    case 'DIVxPAPA_STATUS':
      sendResponse({
        ok: true,
        installedAt: state.installedAt,
        lastHeartbeat: state.lastHeartbeat,
        activeTabs: [...state.hookActiveTabs],
        config: state.config
      });
      return false;

    case 'DIVxPAPA_RESET':
      state.lastHeartbeat = 0;
      state.hookActiveTabs.clear();
      sendResponse({ ok: true });
      return false;

    case 'DIVxPAPA_GET_CONFIG':
      sendResponse({ ok: true, config: state.config });
      return false;

    case 'DIVxPAPA_SET_CONFIG':
      state.config = { ...state.config, ...message.config };
      saveConfig();
      broadcastUpdate();
      sendResponse({ ok: true });
      return false;

    case 'DIVxPAPA_APPLY_PRESET':
      applyPreset(message.preset);
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
});

// Commands
chrome.commands.onCommand.addListener(async (command) => {
  switch (command) {
    case 'toggle-mic':
      state.config.enabled = !state.config.enabled;
      await saveConfig();
      broadcastUpdate();
      break;
    case 'clear-boost':
      await applyPreset('clear');
      break;
    case 'max-power':
      await applyPreset('max');
      break;
    case 'studio-mode':
      await applyPreset('studio');
      break;
    case 'reset-all':
      state.config = { ...DEFAULTS };
      await saveConfig();
      broadcastUpdate();
      break;
  }
});

// Tab cleanup
setInterval(() => {
  chrome.tabs.query({}, (tabs) => {
    const activeIds = new Set(tabs.map(t => t.id));
    for (const id of state.hookActiveTabs) {
      if (!activeIds.has(id)) state.hookActiveTabs.delete(id);
    }
  });
}, 30000);

// Init
await loadConfig();
console.info('[DIVxPAPA 💀] v10.0 locked and loaded — He built this.');