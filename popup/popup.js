// DIVxPAPA 💀 v10.0 — He built this. Stays true.
const EXT = globalThis.browser ?? globalThis.chrome;

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
  clear: {
    ...DEFAULTS,
    gainDb: 18,
    loudness: 1,
    drive: 0.22,
    thresholdDb: -28,
    ratio: 8,
    presenceDb: 3,
    highShelfDb: 3,
    sustainTargetDb: -12,
    sustainMaxGain: 6
  },
  max: {
    ...DEFAULTS,
    gainDb: 30,
    loudness: 1.5,
    maxBoost: 6,
    drive: 0.35,
    thresholdDb: -24,
    ratio: 10,
    presenceDb: 5,
    highShelfDb: 5,
    sustainTargetDb: -15,
    sustainMaxGain: 6
  },
  studio: {
    ...DEFAULTS,
    gainDb: 12,
    loudness: 0.8,
    drive: 0.15,
    thresholdDb: -32,
    ratio: 6,
    presenceDb: 4,
    reverbEnabled: true,
    reverbDelay: 0.035,
    reverbWet: 0.06,
    eqEnabled: true,
    eqLow: 2,
    eqMid: 1,
    eqHigh: 3
  },
  safe: {
    ...DEFAULTS,
    gainDb: 8,
    loudness: 0.6,
    drive: 0.1,
    thresholdDb: -35,
    ratio: 4,
    limiterDb: -3,
    sustain: false,
    maxBoost: 2,
    sustainMaxGain: 2
  }
};

const STORAGE_KEY = 'divxpapaConfig';
const MSG_CFG = 'DIVXPAPA_CONFIG';
const MSG_PRESET = 'DIVXPAPA_APPLY_PRESET';
const MSG_RESET = 'DIVXPAPA_RESET';
const MSG_HEARTBEAT = 'DIVXPAPA_HEARTBEAT';

const ids = Object.keys(DEFAULTS).filter((id) => id !== 'profileVersion');

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

function storageSet(value) {
  return new Promise((resolve) => {
    try {
      EXT.storage.local.set(value, () => {
        resolve(!EXT.runtime?.lastError);
      });
    } catch (_) {
      resolve(false);
    }
  });
}

function sendMessage(message) {
  return new Promise((resolve) => {
    try {
      EXT.runtime.sendMessage(message, (res) => {
        if (EXT.runtime?.lastError) resolve(null);
        else resolve(res || null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

function numberText(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (Math.abs(n) > 0 && Math.abs(n) < 0.01) return n.toFixed(5);
  if (Math.abs(n) < 1 && !Number.isInteger(n)) return n.toFixed(2);
  return Math.abs(n) < 10 && !Number.isInteger(n) ? n.toFixed(1) : String(Math.round(n));
}

function multiplierFromGainDb(gainDb) {
  return Math.round(Math.pow(10, Number(gainDb) / 20));
}

function updateLabels() {
  ids.forEach((id) => {
    const el = document.getElementById(id);
    const label = document.getElementById(`${id}Val`);
    if (!label || el?.type === 'checkbox') return;
    if (id === 'gainDb') {
      label.textContent = `${numberText(el.value)} dB / ${multiplierFromGainDb(el.value)}x`;
    } else {
      label.textContent = numberText(el.value);
    }
  });
}

function presetMatches(config, preset) {
  return Object.entries(preset).every(([key, value]) => 
    Number(config[key]) === Number(value) || config[key] === value
  );
}

function activePreset(config) {
  if (presetMatches(config, PRESETS.clear)) return 'clear';
  if (presetMatches(config, PRESETS.max)) return 'max';
  if (presetMatches(config, PRESETS.studio)) return 'studio';
  if (presetMatches(config, PRESETS.safe)) return 'safe';
  return 'custom';
}

function updatePresetState(config) {
  const active = activePreset(config);
  document.body.dataset.theme = active;
  ['clear', 'max', 'studio', 'safe'].forEach((name) => {
    const button = document.getElementById(`${name}Preset`);
    if (button) {
      button.classList.toggle('active', active === name);
      button.setAttribute('aria-pressed', String(active === name));
    }
  });
}

function applyToControls(config) {
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = Boolean(config[id]);
    else el.value = config[id];
  });
  const enabled = document.getElementById('enabled');
  if (enabled) enabled.checked = Boolean(config.enabled);
  updateLabels();
  updatePresetState(config);
}

async function readConfig() {
  const stored = await storageGet(STORAGE_KEY);
  let saved = stored[STORAGE_KEY];
  if (typeof saved === 'string') {
    try { saved = JSON.parse(saved); } catch (_) { saved = null; }
  }
  if (!saved || saved.profileVersion !== DEFAULTS.profileVersion) return { ...DEFAULTS };
  return { ...DEFAULTS, ...saved };
}

async function saveConfig(config) {
  const merged = { ...DEFAULTS, ...config };
  currentConfig = merged;
  const saved = await storageSet({ [STORAGE_KEY]: JSON.stringify(merged) });
  applyToControls(merged);
  // Broadcast to content script
  window.postMessage({ type: MSG_CFG, payload: merged }, '*');
  // Send to background
  sendMessage({ type: 'DIVxPAPA_SET_CONFIG', config: merged });
  if (!saved) setActionStatus('Could not save settings. Try reopening.', 'warn');
  return saved;
}

let saveTimer;
let currentConfig = { ...DEFAULTS };

function queueConfigSave(id, el) {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => onControlInput(id, el), 180);
}

async function onControlInput(id, el) {
  currentConfig[id] = el.type === 'checkbox' ? el.checked : Number(el.value);
  await saveConfig(currentConfig);
}

function setActionStatus(message, tone = 'ok') {
  const el = document.getElementById('hookStatus');
  if (!el) return;
  el.dataset.actionMessage = message;
  el.dataset.actionTone = tone;
  window.clearTimeout(setActionStatus.timer);
  setActionStatus.timer = window.setTimeout(() => {
    delete el.dataset.actionMessage;
    delete el.dataset.actionTone;
    refreshHookStatus();
  }, 2800);
  el.textContent = message;
  el.className = `status ${tone}`;
}

async function openTelegram() {
  try {
    if (EXT?.tabs?.create) {
      await new Promise((resolve, reject) => {
        try {
          EXT.tabs.create({ url: 'https://web.telegram.org/' }, () => {
            if (EXT.runtime?.lastError) reject(EXT.runtime.lastError);
            else resolve();
          });
        } catch (error) {
          reject(error);
        }
      });
      setActionStatus('Telegram Web opened in a new tab.', 'ok');
    }
  } catch (_) {
    setActionStatus('Unable to open Telegram Web from this browser.', 'warn');
  }
}

async function resetSettings() {
  const confirmed = globalThis.confirm?.('Reset all microphone settings to DIVxPAPA default?');
  if (!confirmed) return;
  await saveConfig(DEFAULTS);
  window.postMessage({ type: MSG_RESET }, '*');
  sendMessage({ type: 'DIVxPAPA_RESET' });
  setActionStatus('Settings reset to default.', 'ok');
}

async function applyPreset(name) {
  if (PRESETS[name]) {
    await saveConfig(PRESETS[name]);
    window.postMessage({ type: MSG_PRESET, preset: name }, '*');
    sendMessage({ type: 'DIVxPAPA_APPLY_PRESET', preset: name });
    setActionStatus(`Preset applied: ${name}`, 'ok');
  }
}

async function runCommand(rawCommand) {
  const command = String(rawCommand || '').trim().toLowerCase().replace(/^\/+/, '');
  const presetMap = {
    clear: 'clear',
    max: 'max',
    studio: 'studio',
    safe: 'safe'
  };
  
  if (presetMap[command]) {
    await applyPreset(presetMap[command]);
    return;
  }
  
  if (command === 'mute' || command === 'off') {
    await saveConfig({ ...currentConfig, enabled: false });
    setActionStatus('Mic processing paused.', 'warn');
    return;
  }
  if (command === 'unmute' || command === 'on') {
    await saveConfig({ ...currentConfig, enabled: true });
    setActionStatus('Mic processing enabled.', 'ok');
    return;
  }
  if (command === 'reset') {
    await resetSettings();
    return;
  }
  if (command === 'open' || command === 'telegram') {
    await openTelegram();
    return;
  }
  if (command === 'status') {
    await refreshHookStatus();
    setActionStatus('Status refreshed.', 'ok');
    return;
  }
  if (command === 'photo') {
    document.getElementById('photoInput')?.click();
    return;
  }
  setActionStatus('Unknown command. Try /clear, /max, /studio, /safe, /mute, /reset, /open, /status, or /photo.', 'warn');
}

function loadPhoto() {
  return storageGet('divxpapaPhoto').then((stored) => {
    const photo = stored.divxpapaPhoto;
    if (photo) {
      document.body.style.setProperty('--profile-photo', `url("${photo}")`);
      document.body.classList.add('has-photo');
      const remove = document.getElementById('removePhoto');
      if (remove) remove.hidden = false;
    }
  });
}

function storePhoto(file) {
  if (!file || !file.type.startsWith('image/')) {
    setActionStatus('Please choose a valid image file.', 'warn');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = async () => {
      const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
      const saved = await storageSet({ divxpapaPhoto: dataUrl });
      if (saved) {
        document.body.style.setProperty('--profile-photo', `url("${dataUrl}")`);
        document.body.classList.add('has-photo');
        document.getElementById('removePhoto').hidden = false;
        setActionStatus('Your photo is now the background.', 'ok');
      } else {
        setActionStatus('Photo could not be saved. Try a smaller image.', 'warn');
      }
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
}

async function removePhoto() {
  await storageSet({ divxpapaPhoto: '' });
  document.body.style.removeProperty('--profile-photo');
  document.body.classList.remove('has-photo');
  document.getElementById('removePhoto').hidden = true;
  setActionStatus('Background photo removed.', 'ok');
}

async function init() {
  if (!EXT?.storage?.local) return;
  currentConfig = await readConfig();
  applyToControls(currentConfig);
  await loadPhoto();
  
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      updateLabels();
      queueConfigSave(id, el);
    });
    el.addEventListener('change', () => {
      window.clearTimeout(saveTimer);
      onControlInput(id, el);
    });
  });
  
  const enabled = document.getElementById('enabled');
  if (enabled) {
    enabled.addEventListener('change', () => {
      onControlInput('enabled', enabled);
    });
  }
  
  document.getElementById('clearPreset')?.addEventListener('click', () => applyPreset('clear'));
  document.getElementById('maxPreset')?.addEventListener('click', () => applyPreset('max'));
  document.getElementById('studioPreset')?.addEventListener('click', () => applyPreset('studio'));
  document.getElementById('safePreset')?.addEventListener('click', () => applyPreset('safe'));
  document.getElementById('openTelegram')?.addEventListener('click', openTelegram);
  document.getElementById('resetSettings')?.addEventListener('click', resetSettings);
  document.getElementById('photoInput')?.addEventListener('change', (event) => storePhoto(event.target.files?.[0]));
  document.getElementById('removePhoto')?.addEventListener('click', removePhoto);
  
  document.getElementById('commandForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.getElementById('commandInput');
    const value = input?.value || '';
    if (input) input.value = '';
    runCommand(value);
  });
  
  document.querySelectorAll('[data-command]').forEach((button) => {
    button.addEventListener('click', () => runCommand(button.dataset.command));
  });
  
  console.info('[DIVxPAPA 💀] popup initialized — He built this.');
}

async function refreshHookStatus() {
  const el = document.getElementById('hookStatus');
  if (!el || !EXT?.runtime) return;
  try {
    const status = await sendMessage({ type: 'DIVxPAPA_STATUS' });
    const ageMs = status?.lastHeartbeat ? Date.now() - status.lastHeartbeat : Infinity;
    if (el.dataset.actionMessage) return;
    if (status?.ok && ageMs < 12000) {
      el.textContent = 'Hook status: ACTIVE on this browser call site';
      el.className = 'status ok';
    } else {
      el.textContent = 'Hook status: waiting — open or reload a WebRTC call site';
      el.className = 'status warn';
    }
  } catch (_) {
    el.textContent = 'Hook status: unavailable';
    el.className = 'status warn';
  }
}

init();
setInterval(refreshHookStatus, 3000);
refreshHookStatus();