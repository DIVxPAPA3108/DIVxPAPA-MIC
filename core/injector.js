(() => {
  if (window.__divxpapaInjectorReady) return;
  window.__divxpapaInjectorReady = true;

  // DIVxPAPA 💀 v10.0 — He built this. Stays true.
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

  const MSG_CFG = 'DIVXPAPA_CONFIG';
  const AUDIO_SEND_MAX_BITRATE = 128000;
  const PRESETS = {
    clear: { gainDb: 18, loudness: 1, drive: 0.22, thresholdDb: -28, ratio: 8, presenceDb: 3 },
    max: { gainDb: 30, loudness: 1.5, maxBoost: 6, drive: 0.35, thresholdDb: -24, ratio: 10, presenceDb: 5, highShelfDb: 5, sustainTargetDb: -15 },
    studio: { gainDb: 12, loudness: 0.8, drive: 0.15, thresholdDb: -32, ratio: 6, presenceDb: 4, reverbEnabled: true, reverbDelay: 0.035, reverbWet: 0.06, eqEnabled: true, eqLow: 2, eqMid: 1, eqHigh: 3 },
    safe: { gainDb: 8, loudness: 0.6, drive: 0.1, thresholdDb: -35, ratio: 4, limiterDb: -3, sustain: false }
  };

  const state = {
    config: { ...DEFAULTS },
    origMD: null,
    origLegacy: null,
    pipelines: new Set(),
    trackMap: new WeakMap(),
    processedTracks: new WeakSet(),
    processedMeta: new WeakMap(),
    senderWatchTracks: new WeakSet(),
    peerConnections: new Set(),
    senderRecords: new Set(),
    senderBySender: new WeakMap(),
    senderTuneAt: new WeakMap(),
    constraintKeys: new WeakMap(),
    refreshingSenders: new WeakSet(),
    recoverTimers: new Set(),
    sourceTracks: new Set(),
    remoteVolumeTimer: null,
    origApplyConstraints: null,
    lastAudioConstraints: { audio: true }
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));
  const dbToLinear = (db) => Math.pow(10, db / 20);

  function cfg(input = state.config) {
    const merged = { ...DEFAULTS, ...(input || {}) };
    merged.enabled = Boolean(merged.enabled);
    merged.maxBoost = clamp(merged.maxBoost, 1, 8);
    merged.loudness = clamp(merged.loudness, 0.5, merged.maxBoost);
    merged.gainDb = clamp(merged.gainDb, 0, 36);
    merged.drive = clamp(merged.drive, 0, 1);
    merged.thresholdDb = clamp(merged.thresholdDb, -60, 0);
    merged.ratio = clamp(merged.ratio, 1, 20);
    merged.attack = clamp(merged.attack, 0.0001, 1);
    merged.release = clamp(merged.release, 0.01, 1);
    merged.lowShelfDb = clamp(merged.lowShelfDb, -12, 12);
    merged.presenceDb = clamp(merged.presenceDb, -12, 12);
    merged.highShelfDb = clamp(merged.highShelfDb, -12, 12);
    merged.limiterDb = clamp(merged.limiterDb, -24, 0);
    merged.sustain = Boolean(merged.sustain);
    merged.sustainTargetDb = clamp(merged.sustainTargetDb, -24, 12);
    merged.sustainMaxGain = clamp(merged.sustainMaxGain, 1, 12);
    merged.forceRawMic = Boolean(merged.forceRawMic);
    merged.reverbEnabled = Boolean(merged.reverbEnabled);
    merged.reverbDelay = clamp(merged.reverbDelay, 0.01, 0.35);
    merged.reverbFeedback = clamp(merged.reverbFeedback, 0, 0.75);
    merged.reverbWet = clamp(merged.reverbWet, 0, 0.6);
    merged.keepAlive = Boolean(merged.keepAlive);
    merged.keepAliveGain = clamp(merged.keepAliveGain, 0, 0.0005);
    merged.senderRefreshMs = clamp(merged.senderRefreshMs, 1000, 3000);
    merged.remoteVolume = clamp(merged.remoteVolume, 0, 1);
    merged.remoteVolumeGuard = Boolean(merged.remoteVolumeGuard);
    merged.voiceLock = Boolean(merged.voiceLock);
    merged.noiseGateEnabled = Boolean(merged.noiseGateEnabled);
    merged.noiseGateThreshold = clamp(merged.noiseGateThreshold, -80, -20);
    merged.eqEnabled = Boolean(merged.eqEnabled);
    merged.eqLow = clamp(merged.eqLow, -12, 12);
    merged.eqMid = clamp(merged.eqMid, -12, 12);
    merged.eqHigh = clamp(merged.eqHigh, -12, 12);
    if (merged.preset && PRESETS[merged.preset]) {
      const preset = PRESETS[merged.preset];
      Object.keys(preset).forEach(key => {
        if (key in merged) merged[key] = preset[key];
      });
    }
    return merged;
  }

  function makeSaturationCurve(amount = 0.5) {
    const k = Math.max(0.0001, amount * 100);
    const n = 4096;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const x = (i * 2) / n - 1;
      curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  function setParam(param, value, ctx) {
    if (!param) return;
    const safeValue = clamp(value, param.minValue ?? -Infinity, param.maxValue ?? Infinity);
    const now = ctx?.currentTime || 0;
    try {
      if (typeof param.cancelScheduledValues === 'function') param.cancelScheduledValues(now);
      if (typeof param.setTargetAtTime === 'function') param.setTargetAtTime(safeValue, now, 0.005);
      else param.value = safeValue;
    } catch (_) {
      try { param.value = safeValue; } catch (_) {}
    }
  }

  function applyPipeline(pipeline, raw) {
    if (!pipeline || !raw) return;
    const c = raw.enabled ? raw : {
      ...raw,
      lowShelfDb: 0,
      presenceDb: 0,
      highShelfDb: 0,
      thresholdDb: -6,
      ratio: 1,
      loudness: 1,
      gainDb: 0,
      drive: 0,
      limiterDb: -0.5,
      noiseGateEnabled: false,
      eqEnabled: false,
      eqLow: 0,
      eqMid: 0,
      eqHigh: 0
    };
    const { ctx, nodes } = pipeline;
    setParam(nodes.low.gain, c.lowShelfDb, ctx);
    setParam(nodes.pres.gain, c.presenceDb, ctx);
    setParam(nodes.high.gain, c.highShelfDb, ctx);
    setParam(nodes.comp1.threshold, c.thresholdDb, ctx);
    setParam(nodes.comp1.ratio, c.ratio, ctx);
    setParam(nodes.comp1.attack, c.attack, ctx);
    setParam(nodes.comp1.release, c.release, ctx);
    setParam(nodes.loudness.gain, c.loudness, ctx);
    setParam(nodes.gain.gain, dbToLinear(c.gainDb), ctx);
    nodes.saturator.curve = makeSaturationCurve(c.drive);
    if (nodes.reverbDelay) setParam(nodes.reverbDelay.delayTime, c.reverbDelay, ctx);
    if (nodes.reverbSend) setParam(nodes.reverbSend.gain, c.reverbEnabled ? 1 : 0, ctx);
    if (nodes.reverbFeedback) setParam(nodes.reverbFeedback.gain, c.reverbEnabled ? c.reverbFeedback : 0, ctx);
    if (nodes.reverbWet) setParam(nodes.reverbWet.gain, c.reverbEnabled ? c.reverbWet : 0, ctx);
    if (nodes.keepAliveGain) setParam(nodes.keepAliveGain.gain, c.keepAlive ? c.keepAliveGain : 0, ctx);
    if (nodes.sustain && !c.sustain) setParam(nodes.sustain.gain, 1, ctx);
    setParam(nodes.limiter.threshold, c.limiterDb, ctx);
    if (nodes.noiseGate) {
      setParam(nodes.noiseGate.threshold, c.noiseGateEnabled ? c.noiseGateThreshold : -100, ctx);
    }
    if (nodes.eqLow) setParam(nodes.eqLow.gain, c.eqEnabled ? c.eqLow : 0, ctx);
    if (nodes.eqMid) setParam(nodes.eqMid.gain, c.eqEnabled ? c.eqMid : 0, ctx);
    if (nodes.eqHigh) setParam(nodes.eqHigh.gain, c.eqEnabled ? c.eqHigh : 0, ctx);
  }

  function updateAllPipelines(inputConfig = state.config) {
    for (const pipeline of state.pipelines) applyPipeline(pipeline, inputConfig);
  }

  function isLocalMediaElement(element) {
    const stream = element?.srcObject;
    if (!stream || typeof stream.getAudioTracks !== 'function') return false;
    return stream.getAudioTracks().some((track) =>
      state.sourceTracks.has(track) || state.processedTracks.has(track)
    );
  }

  function applyRemoteVolume() {
    const c = cfg();
    if (c.remoteVolume === 1 && !c.remoteVolumeGuard) return;
    const value = String(c.remoteVolume);
    document.querySelectorAll('audio, video').forEach((element) => {
      if (isLocalMediaElement(element)) return;
      if (element.dataset.divxpapaRemoteVolume === value) return;
      try {
        element.volume = c.remoteVolume;
        element.dataset.divxpapaRemoteVolume = value;
      } catch (_) {}
    });
  }

  function updateRemoteVolumeGuard() {
    applyRemoteVolume();
    const shouldWatch = cfg().remoteVolumeGuard;
    if (shouldWatch && !state.remoteVolumeTimer) {
      state.remoteVolumeTimer = setInterval(applyRemoteVolume, 900);
    } else if (!shouldWatch && state.remoteVolumeTimer) {
      clearInterval(state.remoteVolumeTimer);
      state.remoteVolumeTimer = null;
    }
  }

  function resumePipeline(pipeline) {
    const ctx = pipeline?.ctx;
    if (!ctx || ctx.state === 'closed' || typeof ctx.resume !== 'function') return;
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  }

  function resumeAllPipelines() {
    for (const pipeline of state.pipelines) resumePipeline(pipeline);
  }

  function rmsDbFromAnalyser(analyser, buffer) {
    analyser.getByteTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const sample = (buffer[i] - 128) / 128;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / buffer.length);
    return 20 * Math.log10(Math.max(rms, 0.00001));
  }

  function startSustainController(pipeline) {
    if (!pipeline || pipeline.sustainTimer) return;
    const { ctx, nodes } = pipeline;
    const buffer = new Uint8Array(nodes.meter.fftSize);
    let currentGain = 1;
    pipeline.sustainTimer = setInterval(() => {
      const c = cfg();
      if (!c.sustain || !nodes.sustain) return;
      const db = rmsDbFromAnalyser(nodes.meter, buffer);
      const target = c.sustainTargetDb;
      if (db < target) {
        const lift = 1 + Math.min(1.2, Math.max(0.02, (target - db) * 0.035));
        currentGain = Math.min(c.sustainMaxGain, currentGain * lift);
      } else {
        currentGain = Math.max(1, currentGain * 0.82);
      }
      setParam(nodes.sustain.gain, currentGain, ctx);
    }, 250);
  }

  function createAudioContext() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      return new AC({ latencyHint: 'interactive', sampleRate: 48000 });
    } catch (_) {
      return new AC({ latencyHint: 'interactive' });
    }
  }

  function createKeepAliveNoise(ctx) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * 2));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * 0.35;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return source;
  }

  function build(stream, inputConfig) {
    const ctx = createAudioContext();
    if (!ctx || !stream.getAudioTracks().length) return stream;
    stream.getAudioTracks().forEach(enforceRawMicTrack);

    const source = ctx.createMediaStreamSource(stream);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 75;
    hp.Q.value = 0.7;

    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf';
    low.frequency.value = 200;

    const eqLow = ctx.createBiquadFilter();
    eqLow.type = 'peaking';
    eqLow.frequency.value = 120;
    eqLow.Q.value = 1.0;

    const eqMid = ctx.createBiquadFilter();
    eqMid.type = 'peaking';
    eqMid.frequency.value = 1000;
    eqMid.Q.value = 1.0;

    const eqHigh = ctx.createBiquadFilter();
    eqHigh.type = 'peaking';
    eqHigh.frequency.value = 6000;
    eqHigh.Q.value = 1.0;

    const pres = ctx.createBiquadFilter();
    pres.type = 'peaking';
    pres.frequency.value = 3200;
    pres.Q.value = 1.5;

    const high = ctx.createBiquadFilter();
    high.type = 'highshelf';
    high.frequency.value = 6000;

    const noiseGate = ctx.createGain();
    const noiseGateThreshold = -60;
    const noiseGateReduction = 0.001;

    const comp1 = ctx.createDynamicsCompressor();
    const comp2 = ctx.createDynamicsCompressor();
    comp2.threshold.value = -10;
    comp2.knee.value = 5;
    comp2.ratio.value = 12;
    comp2.attack.value = 0.001;
    comp2.release.value = 0.05;

    const loudness = ctx.createGain();
    const gain = ctx.createGain();
    const saturator = ctx.createWaveShaper();
    saturator.oversample = '2x';
    const sustain = ctx.createGain();
    sustain.gain.value = 1;

    const reverbSend = ctx.createGain();
    reverbSend.gain.value = 0;
    const reverbDelay = ctx.createDelay(0.5);
    const reverbFeedback = ctx.createGain();
    const reverbWet = ctx.createGain();
    const keepAliveGain = ctx.createGain();
    keepAliveGain.gain.value = 0;
    const keepAliveSource = cfg(inputConfig).keepAlive ? createKeepAliveNoise(ctx) : null;

    const limiter = ctx.createDynamicsCompressor();
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.0001;
    limiter.release.value = 0.01;

    const meter = ctx.createAnalyser();
    meter.fftSize = 1024;
    meter.smoothingTimeConstant = 0.18;

    const dst = ctx.createMediaStreamDestination();

    // Signal flow
    source.connect(hp);
    hp.connect(low);
    low.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(pres);
    pres.connect(high);
    high.connect(noiseGate);
    noiseGate.connect(comp1);
    comp1.connect(comp2);
    comp2.connect(loudness);
    loudness.connect(gain);
    gain.connect(saturator);
    saturator.connect(sustain);
    saturator.connect(reverbSend);
    reverbSend.connect(reverbDelay);
    reverbDelay.connect(reverbFeedback);
    reverbFeedback.connect(reverbDelay);
    reverbDelay.connect(reverbWet);
    reverbWet.connect(sustain);
    sustain.connect(limiter);
    limiter.connect(meter);
    if (keepAliveSource) {
      keepAliveSource.connect(keepAliveGain);
      keepAliveGain.connect(meter);
    }
    meter.connect(dst);
    if (keepAliveSource) keepAliveSource.start(0);

    const pipeline = {
      ctx,
      nodes: {
        low,
        eqLow,
        eqMid,
        eqHigh,
        pres,
        high,
        noiseGate,
        comp1,
        loudness,
        gain,
        saturator,
        sustain,
        reverbSend,
        reverbDelay,
        reverbFeedback,
        reverbWet,
        keepAliveGain,
        limiter,
        meter
      },
      keepAliveSource,
      sustainTimer: null
    };

    applyPipeline(pipeline, inputConfig);
    state.pipelines.add(pipeline);
    startSustainController(pipeline);
    resumePipeline(pipeline);

    const outAudioTracks = dst.stream.getAudioTracks();
    outAudioTracks.forEach((track) => {
      state.processedTracks.add(track);
      state.processedMeta.set(track, { source: stream, pipeline });
    });

    const out = new MediaStream([
      ...outAudioTracks,
      ...stream.getTracks().filter((track) => track.kind !== 'audio')
    ]);

    const stop = () => {
      state.pipelines.delete(pipeline);
      if (pipeline.sustainTimer) clearInterval(pipeline.sustainTimer);
      stream.getAudioTracks().forEach((track) => state.sourceTracks.delete(track));
      try { pipeline.keepAliveSource?.stop(); } catch (_) {}
      try { ctx.close(); } catch (_) {}
    };

    outAudioTracks.forEach((track) => track.addEventListener('ended', stop, { once: true }));
    stream.getTracks().forEach((track) => track.addEventListener('ended', scheduleRecoveryPasses, { once: true }));

    return out;
  }

  function rawMicAudioConstraints(audio = {}) {
    const base = audio && typeof audio === 'object' ? audio : {};
    const processingOff = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      googEchoCancellation: false,
      googEchoCancellation2: false,
      googEchoCancellation3: false,
      googDAEchoCancellation: false,
      googExperimentalEchoCancellation: false,
      googHybridEchoCancellation: false,
      googHybridAec: false,
      googEchoCancellationHybrid: false,
      googAutoGainControl: false,
      googAutoGainControl2: false,
      googNoiseSuppression: false,
      googNoiseSuppression2: false,
      googExperimentalNoiseSuppression: false,
      googHighpassFilter: false,
      googTypingNoiseDetection: false,
      googAudioMirroring: false,
      googBeamforming: false,
      mozAutoGainControl: false,
      mozNoiseSuppression: false
    };
    return {
      ...base,
      ...processingOff,
      channelCount: { ideal: 1, max: 1 },
      sampleRate: { ideal: 48000 },
      sampleSize: { ideal: 16 }
    };
  }

  function enforceRawMicTrack(track) {
    const currentConfig = cfg();
    if (!track || track.kind !== 'audio' || !(currentConfig.forceRawMic || currentConfig.voiceLock)) return;
    state.sourceTracks.add(track);
    try { track.enabled = true; } catch (_) {}
    try { track.contentHint = 'speech'; } catch (_) {}
    if (typeof track.applyConstraints === 'function') {
      const key = `${currentConfig.forceRawMic}|${currentConfig.voiceLock}`;
      if (state.constraintKeys.get(track) !== key) {
        state.constraintKeys.set(track, key);
        try { track.applyConstraints(rawMicAudioConstraints()).catch(() => {}); } catch (_) {}
      }
    }
  }

  function enforceAllSourceConstraints() {
    for (const track of [...state.sourceTracks]) {
      if (!track || track.readyState === 'ended') {
        state.sourceTracks.delete(track);
        continue;
      }
      enforceRawMicTrack(track);
    }
  }

  function patchTrackConstraints() {
    const proto = window.MediaStreamTrack?.prototype;
    if (!proto || proto.__divxpapaTrackPatched || typeof proto.applyConstraints !== 'function') return;
    state.origApplyConstraints = proto.applyConstraints;
    proto.applyConstraints = function applyConstraints(constraints = {}) {
      const currentConfig = cfg();
      const next = currentConfig.enabled && (currentConfig.forceRawMic || currentConfig.voiceLock) && this.kind === 'audio'
        ? rawMicAudioConstraints(constraints)
        : constraints;
      return state.origApplyConstraints.call(this, next);
    };
    proto.__divxpapaTrackPatched = true;
  }

  function normalizeConstraints(constraints) {
    if (!constraints) return { audio: true };
    const next = { ...constraints };
    if (typeof next.audio === 'object') next.audio = rawMicAudioConstraints(next.audio);
    return next;
  }

  function wantsAudio(constraints) {
    if (constraints === true) return true;
    if (!constraints || typeof constraints !== 'object') return false;
    return 'audio' in constraints ? Boolean(constraints.audio) : true;
  }

  function processedStreamFor(originalStream, rawTrack, processedTrack) {
    if (!originalStream || typeof originalStream.getTracks !== 'function') return new MediaStream([processedTrack]);
    return new MediaStream(originalStream.getTracks().map((track) => (track === rawTrack ? processedTrack : track)));
  }

  function liveAudioTrack(stream) {
    if (!stream || typeof stream.getAudioTracks !== 'function') return null;
    return stream.getAudioTracks().find((track) => track.readyState !== 'ended') || null;
  }

  function processedSourceIsLive(track) {
    if (!track || !state.processedTracks.has(track)) return true;
    const meta = state.processedMeta.get(track);
    if (!meta) return true;
    resumePipeline(meta.pipeline);
    const sourceTrack = liveAudioTrack(meta.source);
    return Boolean(sourceTrack && sourceTrack.enabled !== false);
  }

  function trackNeedsRefresh(track) {
    if (!track || track.kind !== 'audio') return true;
    if (track.readyState === 'ended' || track.enabled === false) return true;
    if (!state.processedTracks.has(track)) return true;
    return !processedSourceIsLive(track);
  }

  function rebuildProcessedTrack(track) {
    const meta = state.processedMeta.get(track);
    const sourceTrack = liveAudioTrack(meta?.source);
    if (!sourceTrack) return track;
    try {
      const rebuiltStream = build(new MediaStream([sourceTrack]), state.config);
      return liveAudioTrack(rebuiltStream) || track;
    } catch (_) {
      return track;
    }
  }

  function cloneForSender(track) {
    const liveTrack = track?.readyState === 'ended' ? rebuildProcessedTrack(track) : track;
    if (!liveTrack || liveTrack.readyState === 'ended' || typeof liveTrack.clone !== 'function') return liveTrack;
    try {
      const clone = liveTrack.clone();
      state.processedTracks.add(clone);
      const meta = state.processedMeta.get(liveTrack);
      if (meta) state.processedMeta.set(clone, meta);
      return clone;
    } catch (_) {
      return liveTrack;
    }
  }

  function processAudioTrack(track, forSender = false) {
    if (!track || track.kind !== 'audio') return track;
    if (state.processedTracks.has(track)) {
      const nextTrack = track.readyState === 'ended' ? rebuildProcessedTrack(track) : track;
      return forSender ? cloneForSender(nextTrack) : nextTrack;
    }

    const existing = state.trackMap.get(track);
    if (existing) {
      const nextTrack = existing.readyState === 'ended' ? rebuildProcessedTrack(existing) : existing;
      if (nextTrack && nextTrack !== existing && nextTrack.readyState !== 'ended') state.trackMap.set(track, nextTrack);
      if (nextTrack && nextTrack.readyState !== 'ended') return forSender ? cloneForSender(nextTrack) : nextTrack;
    }

    const processedStream = build(new MediaStream([track]), state.config);
    const processedTrack = liveAudioTrack(processedStream) || track;
    if (processedTrack !== track) {
      state.processedTracks.add(processedTrack);
      state.trackMap.set(track, processedTrack);
      track.addEventListener('ended', () => {
        try { processedTrack.stop(); } catch (_) {}
      }, { once: true });
    }
    return forSender ? cloneForSender(processedTrack) : processedTrack;
  }

  function enhanceAudioSdp(sdp) {
    if (typeof sdp !== 'string' || !sdp.includes('m=audio')) return sdp;
    let next = sdp;
    next = next.replace(/a=fmtp:111 ([^\r\n]*)/g, (line, params) => {
      const additions = ['maxaveragebitrate=128000', 'stereo=0', 'sprop-stereo=0', 'useinbandfec=1', 'usedtx=0'];
      const merged = params || '';
      const suffix = additions.filter((item) => !new RegExp(`(^|;)\\s*${item.split('=')[0]}=`, 'i').test(merged));
      return suffix.length ? `${line};${suffix.join(';')}` : line;
    });
    next = next.replace(/b=AS:\d+/g, 'b=AS:128').replace(/b=TIAS:\d+/g, 'b=TIAS:128000');
    if (!/b=AS:128/.test(next)) next = next.replace(/(m=audio[^\r\n]*(?:\r?\n)c=IN[^\r\n]*)/, '$1\r\nb=AS:128');
    if (!/b=TIAS:128000/.test(next)) next = next.replace(/(b=AS:128)/, '$1\r\nb=TIAS:128000');
    return next;
  }

  function cloneDescriptionWithSdp(desc, sdp) {
    if (!desc || typeof desc !== 'object' || !sdp || sdp === desc.sdp) return desc;
    try {
      return new RTCSessionDescription({ type: desc.type, sdp });
    } catch (_) {
      try { return { ...desc, sdp }; } catch (_) { return desc; }
    }
  }

  function tuneAudioSender(sender) {
    if (!sender || typeof sender.getParameters !== 'function' || typeof sender.setParameters !== 'function') return;
    const now = Date.now();
    const lastTune = state.senderTuneAt.get(sender) || 0;
    if (now - lastTune < 2000) return;
    state.senderTuneAt.set(sender, now);
    try {
      const params = sender.getParameters() || {};
      const encodings = Array.isArray(params.encodings) && params.encodings.length ? params.encodings : [{}];
      params.encodings = encodings.map((encoding) => ({
        ...encoding,
        active: encoding.active !== false,
        dtx: false,
        maxBitrate: Math.min(Math.max(Number(encoding.maxBitrate) || 0, AUDIO_SEND_MAX_BITRATE), AUDIO_SEND_MAX_BITRATE),
        networkPriority: 'high',
        priority: 'high'
      }));
      sender.setParameters(params).catch(() => {});
    } catch (_) {}
  }

  function rememberPeerConnection(pc) {
    if (!pc || state.peerConnections.has(pc)) return;
    state.peerConnections.add(pc);
    if (typeof pc.addEventListener === 'function') {
      pc.addEventListener('connectionstatechange', () => {
        if (['closed', 'failed'].includes(pc.connectionState)) state.peerConnections.delete(pc);
      });
    }
  }

  function rememberSender(sender, track, pc = null) {
    if (!sender) return null;
    let record = state.senderBySender.get(sender);
    if (!record) {
      record = { sender, track: null, pc: null, kind: null };
      state.senderBySender.set(sender, record);
      state.senderRecords.add(record);
    }
    if (track) {
      record.track = track;
      record.kind = track.kind;
    }
    if (!record.kind && sender.track?.kind) record.kind = sender.track.kind;
    if (pc) record.pc = pc;
    return record;
  }

  function recordIsClosed(record) {
    const pc = record?.pc;
    if (!pc) return false;
    return ['closed', 'failed'].includes(pc.connectionState || pc.iceConnectionState || '');
  }

  async function reacquireProcessedTrackForSender() {
    if (!state.origMD) return null;
    try {
      const constraints = normalizeConstraints(state.lastAudioConstraints || { audio: true });
      const stream = await state.origMD(constraints);
      const rawTrack = liveAudioTrack(stream);
      if (!rawTrack) return null;
      return processAudioTrack(rawTrack, true);
    } catch (_) {
      return null;
    }
  }

  async function replaceSenderTrack(sender, track) {
    if (!sender || typeof sender.replaceTrack !== 'function') return null;
    try {
      const replacement = track?.readyState === 'ended' ? await reacquireProcessedTrackForSender() : processAudioTrack(track, true);
      if (!replacement) return null;
      await sender.replaceTrack(replacement);
      tuneAudioSender(sender);
      rememberSender(sender, replacement);
      watchSenderTrack(sender, replacement);
      return replacement;
    } catch (_) {
      return null;
    }
  }

  function queueSenderRefresh(sender, track) {
    resumeAllPipelines();
    if (!sender || state.refreshingSenders.has(sender)) return;
    state.refreshingSenders.add(sender);
    setTimeout(() => {
      replaceSenderTrack(sender, track).finally(() => state.refreshingSenders.delete(sender));
    }, 50);
  }

  function watchSenderTrack(sender, track) {
    if (!sender || !track || track.kind !== 'audio') return;
    rememberSender(sender, track);
    if (!state.processedTracks.has(track) || state.senderWatchTracks.has(track)) return;
    state.senderWatchTracks.add(track);
    track.addEventListener('ended', () => queueSenderRefresh(sender, track), { once: true });
    track.addEventListener('unmute', () => tuneAudioSender(sender), { passive: true });
  }

  function scheduleRecoveryPasses() {
    for (const timer of state.recoverTimers) clearTimeout(timer);
    state.recoverTimers.clear();
    [0, 500, 1500].forEach((delay) => {
      const timer = setTimeout(() => {
        state.recoverTimers.delete(timer);
        resumeAllPipelines();
        reconcileLiveSenders();
      }, delay);
      state.recoverTimers.add(timer);
    });
  }

  function reconcileLiveSenders() {
    if (!cfg().enabled && !cfg().voiceLock) return;
    resumeAllPipelines();
    for (const pc of [...state.peerConnections]) {
      if (typeof pc.getSenders === 'function') {
        try {
          for (const sender of pc.getSenders()) {
            const track = sender?.track;
            if (track?.kind === 'audio') rememberSender(sender, track, pc);
          }
        } catch (_) {}
      }
      if (typeof pc.getTransceivers === 'function') {
        try {
          for (const transceiver of pc.getTransceivers()) {
            const sender = transceiver?.sender;
            const receiverTrack = transceiver?.receiver?.track;
            const midLooksAudio = String(transceiver?.mid || '').toLowerCase().includes('audio');
            if (sender && (sender.track?.kind === 'audio' || receiverTrack?.kind === 'audio' || midLooksAudio)) {
              const record = rememberSender(sender, sender.track || null, pc);
              if (record) record.kind = 'audio';
            }
          }
        } catch (_) {}
      }
    }

    for (const record of [...state.senderRecords]) {
      if (recordIsClosed(record)) {
        state.senderRecords.delete(record);
        continue;
      }
      const sender = record.sender;
      const track = sender?.track || record.track;
      const isAudioRecord = track?.kind === 'audio' || record.kind === 'audio';
      if (!sender || !isAudioRecord) continue;
      if (!track || trackNeedsRefresh(track)) queueSenderRefresh(sender, track);
      else {
        tuneAudioSender(sender);
        watchSenderTrack(sender, track);
      }
    }
  }

  function patchPeerConnectionPaths() {
    const PC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (PC?.prototype && !PC.prototype.__divxpapaPcPatched) {
      const originalAddTrack = PC.prototype.addTrack;
      if (typeof originalAddTrack === 'function') {
        PC.prototype.addTrack = function addTrack(track, ...streams) {
          rememberPeerConnection(this);
          if (cfg().enabled && track?.kind === 'audio') {
            const processedTrack = processAudioTrack(track, true);
            const patchedStreams = streams.length
              ? streams.map((stream) => processedStreamFor(stream, track, processedTrack))
              : [new MediaStream([processedTrack])];
            const sender = originalAddTrack.call(this, processedTrack, ...patchedStreams);
            tuneAudioSender(sender);
            rememberSender(sender, processedTrack, this);
            if (typeof sender?.replaceTrack === 'function') watchSenderTrack(sender, processedTrack);
            return sender;
          }
          return originalAddTrack.call(this, track, ...streams);
        };
      }

      const originalAddStream = PC.prototype.addStream;
      if (typeof originalAddStream === 'function') {
        PC.prototype.addStream = function addStream(stream) {
          rememberPeerConnection(this);
          if (cfg().enabled && stream?.getAudioTracks?.().length) {
            const processedStream = build(stream, state.config);
            return originalAddStream.call(this, processedStream);
          }
          return originalAddStream.call(this, stream);
        };
      }

      const originalAddTransceiver = PC.prototype.addTransceiver;
      if (typeof originalAddTransceiver === 'function') {
        PC.prototype.addTransceiver = function addTransceiver(trackOrKind, init = undefined) {
          rememberPeerConnection(this);
          if (cfg().enabled && trackOrKind?.kind === 'audio') {
            const processedTrack = processAudioTrack(trackOrKind, true);
            const patchedInit = init?.streams
              ? { ...init, streams: init.streams.map((stream) => processedStreamFor(stream, trackOrKind, processedTrack)) }
              : init;
            const transceiver = originalAddTransceiver.call(this, processedTrack, patchedInit);
            tuneAudioSender(transceiver?.sender);
            rememberSender(transceiver?.sender, processedTrack, this);
            if (typeof transceiver?.sender?.replaceTrack === 'function') watchSenderTrack(transceiver.sender, processedTrack);
            return transceiver;
          }
          const transceiver = originalAddTransceiver.call(this, trackOrKind, init);
          if (cfg().enabled && trackOrKind === 'audio') {
            const record = rememberSender(transceiver?.sender, transceiver?.sender?.track || null, this);
            if (record) record.kind = 'audio';
            tuneAudioSender(transceiver?.sender);
            setTimeout(() => queueSenderRefresh(transceiver?.sender, transceiver?.sender?.track || null), 0);
          }
          return transceiver;
        };
      }

      const originalCreateOffer = PC.prototype.createOffer;
      if (typeof originalCreateOffer === 'function') {
        PC.prototype.createOffer = function createOffer(...args) {
          rememberPeerConnection(this);
          return originalCreateOffer.apply(this, args).then((offer) => cloneDescriptionWithSdp(offer, enhanceAudioSdp(offer?.sdp)));
        };
      }

      const originalCreateAnswer = PC.prototype.createAnswer;
      if (typeof originalCreateAnswer === 'function') {
        PC.prototype.createAnswer = function createAnswer(...args) {
          rememberPeerConnection(this);
          return originalCreateAnswer.apply(this, args).then((answer) => cloneDescriptionWithSdp(answer, enhanceAudioSdp(answer?.sdp)));
        };
      }

      const originalSetLocalDescription = PC.prototype.setLocalDescription;
      if (typeof originalSetLocalDescription === 'function') {
        PC.prototype.setLocalDescription = function setLocalDescription(desc) {
          rememberPeerConnection(this);
          const patched = cloneDescriptionWithSdp(desc, enhanceAudioSdp(desc?.sdp));
          return originalSetLocalDescription.call(this, patched);
        };
      }

      const originalSetRemoteDescription = PC.prototype.setRemoteDescription;
      if (typeof originalSetRemoteDescription === 'function') {
        PC.prototype.setRemoteDescription = function setRemoteDescription(desc) {
          rememberPeerConnection(this);
          const patched = cloneDescriptionWithSdp(desc, enhanceAudioSdp(desc?.sdp));
          const result = originalSetRemoteDescription.call(this, patched);
          Promise.resolve(result).then(scheduleRecoveryPasses).catch(() => {});
          return result;
        };
      }

      PC.prototype.__divxpapaPcPatched = true;
    }

    const Sender = window.RTCRtpSender;
    if (Sender?.prototype && !Sender.prototype.__divxpapaSenderPatched) {
      const originalReplaceTrack = Sender.prototype.replaceTrack;
      if (typeof originalReplaceTrack === 'function') {
        Sender.prototype.replaceTrack = function replaceTrack(track) {
          const currentKind = this.track?.kind;
          const shouldProcess = cfg().enabled && (track?.kind === 'audio' || (!track && currentKind === 'audio'));
          if (shouldProcess && !track) {
            const record = rememberSender(this, this.track || null);
            if (record) record.kind = 'audio';
            queueSenderRefresh(this, this.track || null);
          }
          const nextTrack = shouldProcess && track?.kind === 'audio' ? processAudioTrack(track, true) : track;
          const result = originalReplaceTrack.call(this, nextTrack);
          if (nextTrack?.kind === 'audio') {
            rememberSender(this, nextTrack);
            Promise.resolve(result).then(() => {
              tuneAudioSender(this);
              watchSenderTrack(this, nextTrack);
            }).catch(() => {});
          }
          return result;
        };
      }
      Sender.prototype.__divxpapaSenderPatched = true;
    }
  }

  async function getStreamWithFallback(orig, constraints, ctx) {
    try {
      return await orig.call(ctx, normalizeConstraints(constraints));
    } catch (_) {
      return orig.call(ctx, constraints);
    }
  }

  async function wrapped(orig, constraints, ctx) {
    if (wantsAudio(constraints)) state.lastAudioConstraints = constraints || { audio: true };
    if (!cfg().enabled) return orig.call(ctx, constraints);
    return getStreamWithFallback(orig, constraints, ctx).then((stream) => {
      if (!stream || !stream.getAudioTracks().length) return stream;
      return build(stream, state.config);
    });
  }

  // Main hooks — DIVxPAPA 💀
  if (navigator.mediaDevices?.getUserMedia) {
    state.origMD = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function getUserMedia(constraints) {
      return wrapped(state.origMD, constraints, navigator.mediaDevices);
    };
  }

  if (navigator.getUserMedia) {
    state.origLegacy = navigator.getUserMedia.bind(navigator);
    navigator.getUserMedia = (constraints, ok, fail) => {
      wrapped(state.origLegacy, constraints, navigator).then(ok).catch((err) => fail && fail(err));
    };
  }

  // DIVxPAPA 💀 message bus — replaces MANSURIxGOD
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === 'DIVXPAPA_CONFIG') {
      state.config = cfg(event.data.payload);
      updateAllPipelines(state.config);
      updateRemoteVolumeGuard();
      scheduleRecoveryPasses();
      return;
    }
    if (event.data.type === 'DIVXPAPA_APPLY_PRESET') {
      const preset = event.data.preset;
      if (preset && PRESETS[preset]) {
        state.config = cfg({ ...state.config, ...PRESETS[preset], preset });
        updateAllPipelines(state.config);
        scheduleRecoveryPasses();
      }
      return;
    }
    if (event.data.type === 'DIVXPAPA_RESET') {
      state.config = cfg({ ...DEFAULTS });
      updateAllPipelines(state.config);
      updateRemoteVolumeGuard();
      scheduleRecoveryPasses();
      return;
    }
  });

  document.addEventListener('play', (event) => {
    if (event.target?.tagName === 'AUDIO' || event.target?.tagName === 'VIDEO') {
      setTimeout(applyRemoteVolume, 0);
    }
  }, true);

  ['focus', 'pageshow', 'online'].forEach((type) => {
    window.addEventListener(type, scheduleRecoveryPasses, { passive: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleRecoveryPasses();
  });

  updateRemoteVolumeGuard();
  setInterval(() => {
    enforceAllSourceConstraints();
    resumeAllPipelines();
    reconcileLiveSenders();
  }, 1500);

  // DIVxPAPA 💀 ready signal
  window.postMessage({ type: 'DIVXPAPA_READY' }, '*');

  // Patch paths after load
  patchTrackConstraints();
  patchPeerConnectionPaths();

  console.info('[DIVxPAPA 💀] injector locked and loaded — He built this.');
})();