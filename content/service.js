(() => {
  // DIVxPAPA 💀 v10.0 — He built this. Stays true.
  const EXT = globalThis.browser ?? globalThis.chrome;
  if (!EXT?.runtime || !EXT?.storage?.local) return;

  const DEFAULTS = {
    profileVersion: 10,
    enabled: true,
    preset: 'clear',
    gainDb: 18,
    loudness: 1.0,
    maxBoost: 4,
    drive: 0.22,
    thresholdDb: -28,
    ratio: 8,
    attack: 0.0001,
    release: 0.03,
    lowShelfDb: 2,
    presenceDb: 3,
    highShelfDb: 3,
    limiterDb: -1,
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

  const STORAGE_KEY = 'divxpapaConfig';
  const MSG_CFG = 'DIVXPAPA_CONFIG';
  const MSG_PRESET = 'DIVXPAPA_APPLY_PRESET';
  const MSG_RESET = 'DIVXPAPA_RESET';
  const MSG_READY = 'DIVXPAPA_READY';
  const MSG_HEARTBEAT = 'DIVXPAPA_HEARTBEAT';

  let hookReady = false;

  function storageGet(key) {
    return new Promise((resolve) => {
      try {
        EXT.storage.local.get(key, (res) => {
          if (EXT.runtime?.lastError) resolve({});
          else resolve(res || {});
        });
      } catch (_) {
        resolve({});
      }
    });
  }

  function storageSet(data) {
    return new Promise((resolve) => {
      try {
        EXT.storage.local.set(data, () => {
          if (EXT.runtime?.lastError) resolve(false);
          else resolve(true);
        });
      } catch (_) {
        resolve(false);
      }
    });
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      try {
        EXT.runtime.sendMessage(message, () => {
          resolve(!EXT.runtime?.lastError);
        });
      } catch (_) {
        resolve(false);
      }
    });
  }

  function pushConfig(config) {
    window.postMessage({ type: MSG_CFG, payload: config }, '*');
  }

  function pushPreset(preset) {
    window.postMessage({ type: MSG_PRESET, preset }, '*');
  }

  function pushReset() {
    window.postMessage({ type: MSG_RESET }, '*');
  }

  async function loadConfig() {
    try {
      const res = await storageGet(STORAGE_KEY);
      let stored = res[STORAGE_KEY];
      
      if (typeof stored === 'string') {
        try {
          stored = JSON.parse(stored);
        } catch (_) {
          stored = null;
        }
      }
      
      if (!stored || stored.profileVersion !== DEFAULTS.profileVersion) {
        return { ...DEFAULTS };
      }
      
      return { ...DEFAULTS, ...stored };
    } catch (_) {
      return { ...DEFAULTS };
    }
  }

  async function saveConfig(config) {
    try {
      await storageSet({ [STORAGE_KEY]: JSON.stringify(config) });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function sync() {
    const config = await loadConfig();
    pushConfig(config);
    return config;
  }

  function heartbeat() {
    if (!hookReady) return;
    sendMessage({ type: MSG_HEARTBEAT }).catch(() => {});
  }

  // Listen for injector ready signal
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    
    if (event.data?.type === MSG_READY) {
      hookReady = true;
      sync().then(() => heartbeat());
      return;
    }

    // Handle config updates from popup/options via background
    if (event.data?.type === 'DIVXPAPA_CONFIG_UPDATE') {
      const config = event.data.config;
      if (config) {
        saveConfig(config);
        pushConfig(config);
      }
      return;
    }
  });

  // Listen for storage changes from background
  EXT.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) {
      sync();
    }
  });

  // Listen for messages from background
  EXT.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;

    if (message.type === 'DIVxPAPA_CONFIG_UPDATE') {
      const config = message.config;
      if (config) {
        saveConfig(config);
        pushConfig(config);
        sendResponse({ ok: true });
      }
      return true;
    }

    if (message.type === 'DIVxPAPA_APPLY_PRESET') {
      pushPreset(message.preset);
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'DIVxPAPA_RESET') {
      pushReset();
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });

  // Periodic sync and heartbeat
  setInterval(() => {
    if (hookReady) {
      sync();
      heartbeat();
    }
  }, 8000);

  // Initial sync attempt
  setTimeout(() => {
    sync().then(() => {
      // If injector already ready, heartbeat
      if (window.__divxpapaInjectorReady) {
        hookReady = true;
        heartbeat();
      }
    });
  }, 1500);

  console.info('[DIVxPAPA 💀] service layer locked and loaded — He built this.');
})();