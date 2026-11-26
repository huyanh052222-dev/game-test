/**
 * Full War Thunder-derived T-34-85 Audio Engine (Web Audio API):
 * - 4-band V-2-34 diesel RPM crossfade (00, 33, 66, 99) + load + real start/stop
 * - 3-band T-34 steel track crossfade (33, 66, 99) + turn rattle + track stop
 * - 85mm ZiS-S-53 main cannon shot
 * - 7.62mm DT coaxial & hull machine guns with stereo distinction
 * - 6 independent volume buses + anti-clipping limiter + crew voice ducking
 */
import { CrewVoiceManager } from './crewVoice.js?v=5';

export const ENGINE_STATE = {
  OFF: 'OFF',
  STARTING: 'STARTING',
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  SHUTDOWN: 'SHUTDOWN',
};

const SAMPLE_PATHS = {
  eng00: './assets/sounds/wt_t34_engine_00.wav',
  eng33: './assets/sounds/wt_t34_engine_33.wav',
  eng66: './assets/sounds/wt_t34_engine_66.wav',
  eng99: './assets/sounds/wt_t34_engine_99.wav',
  engLoad: './assets/sounds/wt_t34_engine_load.wav',
  engStart: './assets/sounds/wt_t34_engine_start.mp3',
  engStop: './assets/sounds/wt_t34_engine_stop.mp3',

  trk33: './assets/sounds/wt_t34_tracks_33.wav',
  trk66: './assets/sounds/wt_t34_tracks_66.wav',
  trk99: './assets/sounds/wt_t34_tracks_99.wav',
  trkTurn: './assets/sounds/wt_t34_turn_rattle.wav',
  trkStop: './assets/sounds/wt_t34_tracks_stop.mp3',

  cannonShot: './assets/sounds/wt_85mm_shot.mp3',
  dtShot: './assets/sounds/wt_dt_shot.mp3',

  // Kar98k reference URL (for manual licensed audio integration):
  // https://www.youtube.com/watch?v=jUKf7VjZz_E
  kar98kShot: './assets/sounds/kar98k_shot.wav',
  mosinShot: './assets/sounds/mosin_shot.wav',
  rifleBolt: './assets/sounds/rifle_bolt_cycle.wav',
  rifleReload: './assets/sounds/rifle_reload_clip.wav',
};

function triWeight(val, center, halfWidth) {
  const d = Math.abs(val - center) / halfWidth;
  return Math.max(0, 1 - d);
}

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.limiter = null;

    this.engineBus = null;
    this.tracksBus = null;
    this.cannonBus = null;
    this.mgBus = null;
    this.infantryBus = null;
    this.reloadMechBus = null;
    this.crewVoiceBus = null;
    this.weaponsBus = null;

    this.muted = false;
    this.engineVolume = 0.85;
    this.tracksVolume = 0.85;
    this.cannonVolume = 0.95;
    this.mgVolume = 0.85;
    this.infantryVolume = 0.85;
    this.reloadMechVolume = 0.9;
    this.crewVoiceVolume = 0.95;
    this._activeRifleVoices = 0;
    this._duckMultiplier = 1.0;
    this.initialized = false;

    this.buffers = {};
    this._buffersLoaded = false;
    this._loadingPromise = null;
    this._noiseBuffer = null;

    this.engineState = ENGINE_STATE.OFF;
    this.engineDestroyed = false;
    this.engineHealthFactor = 1.0;
    this._stateTimer = 0;
    this._smoothedRpm = 0;
    this._smoothedLoad = 0;
    this._wasMoving = false;
    this._lfoPhase = 0;

    this._loopsActive = false;
    this._loopNodes = {};
    this._revOsc = null;
    this._revGain = null;
    this._manualCrankTimer = 0;

    this.crew = new CrewVoiceManager(this);
  }

  init() {
    if (!this.initialized) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.8;

      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.setValueAtTime(-3.5, this.ctx.currentTime);
      this.limiter.knee.setValueAtTime(6, this.ctx.currentTime);
      this.limiter.ratio.setValueAtTime(12, this.ctx.currentTime);
      this.limiter.attack.setValueAtTime(0.002, this.ctx.currentTime);
      this.limiter.release.setValueAtTime(0.15, this.ctx.currentTime);

      this.masterGain.connect(this.limiter);
      this.limiter.connect(this.ctx.destination);

      this.engineBus = this.ctx.createGain();
      this.engineBus.gain.value = this.engineVolume;
      this.engineBus.connect(this.masterGain);

      this.tracksBus = this.ctx.createGain();
      this.tracksBus.gain.value = this.tracksVolume;
      this.tracksBus.connect(this.masterGain);

      this.cannonBus = this.ctx.createGain();
      this.cannonBus.gain.value = this.cannonVolume;
      this.cannonBus.connect(this.masterGain);

      this.mgBus = this.ctx.createGain();
      this.mgBus.gain.value = this.mgVolume;
      this.mgBus.connect(this.masterGain);

      this.infantryBus = this.ctx.createGain();
      this.infantryBus.gain.value = this.infantryVolume;
      this.infantryBus.connect(this.masterGain);

      this.reloadMechBus = this.ctx.createGain();
      this.reloadMechBus.gain.value = this.reloadMechVolume;
      this.reloadMechBus.connect(this.masterGain);

      this.crewVoiceBus = this.ctx.createGain();
      this.crewVoiceBus.gain.value = this.crewVoiceVolume;
      this.crewVoiceBus.connect(this.masterGain);

      this.weaponsBus = this.ctx.createGain();
      this.weaponsBus.gain.value = 0.85;
      this.weaponsBus.connect(this.masterGain);

      // Outdoor battlefield convolution reverb (pre-computed IR, independent dry/wet)
      this._setupOutdoorReverb();

      this._noiseBuffer = this._createNoiseBuffer(1.5);
      this._buildPPShBuffers();
      this.initialized = true;
      this.preloadSamples();
      this.crew.preload();
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    if (this._pendingEngineStart && !this.engineDestroyed) {
      this.preloadSamples().then(() => {
        if (
          this._pendingEngineStart &&
          !this.engineDestroyed &&
          (this.engineState === ENGINE_STATE.RUNNING || this.engineState === ENGINE_STATE.IDLE)
        ) {
          this._startLoopNodes();
          this._pendingEngineStart = false;
        }
      });
    }
    // Engine remains OFF by default until player presses I or clicks ENGINE button
  }

  async preloadSamples() {
    if (this._buffersLoaded) return;
    if (this._loadingPromise) return this._loadingPromise;

    this._loadingPromise = (async () => {
      if (!this.ctx) return;
      await Promise.all(
        Object.entries(SAMPLE_PATHS).map(async ([key, url]) => {
          try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const arr = await resp.arrayBuffer();
            this.buffers[key] = await this.ctx.decodeAudioData(arr);
          } catch (err) {
            console.warn(`Audio sample load failed (${key}):`, err);
          }
        })
      );
      this._buffersLoaded = true;
    })();

    return this._loadingPromise;
  }

  _setupOutdoorReverb() {
    if (!this.ctx) return;
    const sr = this.ctx.sampleRate;
    const dur = 1.9;
    const len = Math.floor(sr * dur);
    const ir = this.ctx.createBuffer(2, len, sr);

    // Pre-delay ~32ms for outdoor terrain reflection spacing, then diffuse tail
    const preDelay = Math.floor(sr * 0.032);
    const reflections = [
      { t: 0.048, g: 0.55 },
      { t: 0.095, g: 0.36 },
      { t: 0.165, g: 0.22 },
      { t: 0.260, g: 0.14 },
    ];

    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = preDelay; i < len; i++) {
        const t = (i - preDelay) / sr;
        const env = Math.exp(-t * 3.1);
        data[i] = (Math.random() * 2 - 1) * env * 0.22;
      }
      for (const r of reflections) {
        const idx = Math.min(len - 1, Math.floor((r.t + ch * 0.007) * sr));
        data[idx] += r.g * (ch === 0 ? 1 : 0.9);
      }
    }

    this.reverbNode = this.ctx.createConvolver();
    this.reverbNode.buffer = ir;

    this.reverbFilter = this.ctx.createBiquadFilter();
    this.reverbFilter.type = 'lowpass';
    this.reverbFilter.frequency.value = 1350; // Warm distant terrain reflection

    this.reverbWetGain = this.ctx.createGain();
    this.reverbWetGain.gain.value = 0.38;

    this.reverbNode.connect(this.reverbFilter);
    this.reverbFilter.connect(this.reverbWetGain);
    this.reverbWetGain.connect(this.masterGain);

    // Independent wet sends (dry paths stay direct on masterGain with 0 latency)
    const cannonSend = this.ctx.createGain();
    cannonSend.gain.value = 0.45;
    this.cannonBus.connect(cannonSend);
    cannonSend.connect(this.reverbNode);

    const mgSend = this.ctx.createGain();
    mgSend.gain.value = 0.14;
    this.mgBus.connect(mgSend);
    mgSend.connect(this.reverbNode);

    const infSend = this.ctx.createGain();
    infSend.gain.value = 0.22;
    this.infantryBus.connect(infSend);
    infSend.connect(this.reverbNode);

    const expSend = this.ctx.createGain();
    expSend.gain.value = 0.30;
    this.weaponsBus.connect(expSend);
    expSend.connect(this.reverbNode);
  }

  _createNoiseBuffer(durationSec) {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * durationSec);
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  _startLoopNodes() {
    if (this._loopsActive || !this.ctx) return;
    const now = this.ctx.currentTime;

    const addLoop = (key, bus) => {
      const buf = this.buffers[key];
      if (!buf) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      src.connect(gain);
      gain.connect(bus);
      const offset = Math.random() * Math.max(0.1, buf.duration - 0.1);
      src.start(now, offset);
      this._loopNodes[key] = { src, gain };
    };

    // Engine RPM & Load layers
    addLoop('eng00', this.engineBus);
    addLoop('eng33', this.engineBus);
    addLoop('eng66', this.engineBus);
    addLoop('eng99', this.engineBus);
    addLoop('engLoad', this.engineBus);

    // Steel Track speed & Turn Rattle layers
    addLoop('trk33', this.tracksBus);
    addLoop('trk66', this.tracksBus);
    addLoop('trk99', this.tracksBus);
    addLoop('trkTurn', this.tracksBus);

    // Subtle reverse transmission whine
    this._revOsc = this.ctx.createOscillator();
    this._revOsc.type = 'sawtooth';
    this._revOsc.frequency.setValueAtTime(140, now);
    const revFilter = this.ctx.createBiquadFilter();
    revFilter.type = 'bandpass';
    revFilter.frequency.setValueAtTime(280, now);
    revFilter.Q.value = 3.0;
    this._revGain = this.ctx.createGain();
    this._revGain.gain.setValueAtTime(0, now);
    this._revOsc.connect(revFilter);
    revFilter.connect(this._revGain);
    this._revGain.connect(this.engineBus);
    this._revOsc.start(now);

    this._loopsActive = true;
  }

  _stopLoopNodes() {
    if (!this._loopsActive) return;
    for (const entry of Object.values(this._loopNodes)) {
      try {
        entry.src.stop();
        entry.src.disconnect();
        entry.gain.disconnect();
      } catch {
        // Ignore
      }
    }
    this._loopNodes = {};
    if (this._revOsc) {
      try {
        this._revOsc.stop();
        this._revOsc.disconnect();
      } catch {
        // Ignore
      }
      this._revOsc = null;
    }
    this._loopsActive = false;
  }

  _playOneShot(bufferKey, bus, gainVal = 1.0, rate = 1.0) {
    if (!this.ctx || !bus || !this.buffers[bufferKey]) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[bufferKey];
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainVal, now);
    src.connect(g);
    g.connect(bus);
    src.start(now);
  }

  startEngine() {
    if (this.engineDestroyed) return;
    if (!this.initialized) this.init();
    if (!this.ctx) return;
    if (
      this.engineState === ENGINE_STATE.STARTING ||
      this.engineState === ENGINE_STATE.IDLE ||
      this.engineState === ENGINE_STATE.RUNNING
    ) {
      return;
    }

    this.engineState = ENGINE_STATE.STARTING;
    const startBuf = this.buffers.engStart;
    this._stateTimer = startBuf ? Math.max(1.2, startBuf.duration - 0.35) : 1.5;
    this._startLoopNodes();
    this._playOneShot('engStart', this.engineBus, 0.85, 1.0);
  }

  /**
   * Immediately puts the engine in RUNNING state without startup delay
   * (used exclusively by SOVIET_TRENCH_DEFENSE mode).
   */
  startEngineImmediate() {
    if (this.engineDestroyed) return;
    this.engineState = ENGINE_STATE.RUNNING;
    this._stateTimer = 0;
    this._smoothedRpm = 0.12;
    this._smoothedLoad = 0.05;
    this._pendingEngineStart = true;

    if (this.initialized && this.ctx) {
      if (this._buffersLoaded) {
        this._startLoopNodes();
        this._pendingEngineStart = false;
      } else {
        this.preloadSamples().then(() => {
          if (
            this._pendingEngineStart &&
            !this.engineDestroyed &&
            (this.engineState === ENGINE_STATE.RUNNING || this.engineState === ENGINE_STATE.IDLE)
          ) {
            this._startLoopNodes();
            this._pendingEngineStart = false;
          }
        });
      }
    }
  }

  resetEngineImmediate() {
    this._pendingEngineStart = false;
    this._stopLoopNodes();
    this.engineState = ENGINE_STATE.OFF;
    this._stateTimer = 0;
    this._smoothedRpm = 0;
    this._smoothedLoad = 0;
  }

  stopEngine() {
    if (
      this.engineState === ENGINE_STATE.OFF ||
      this.engineState === ENGINE_STATE.SHUTDOWN
    ) {
      return;
    }
    this.engineState = ENGINE_STATE.SHUTDOWN;
    const stopBuf = this.buffers.engStop;
    this._stateTimer = stopBuf ? Math.max(1.0, stopBuf.duration) : 1.2;
    this._playOneShot('engStop', this.engineBus, 0.85, 1.0);
  }

  setEngineDamage(destroyed = false, healthFactor = 1.0) {
    this.engineHealthFactor = healthFactor;
    if (destroyed && !this.engineDestroyed) {
      this.engineDestroyed = true;
      if (this.engineState !== ENGINE_STATE.OFF && this.engineState !== ENGINE_STATE.SHUTDOWN) {
        this.stopEngine();
      }
    } else if (!destroyed) {
      this.engineDestroyed = false;
    }
  }

  toggleEngine() {
    if (this.engineDestroyed) return this.engineState;
    if (
      this.engineState === ENGINE_STATE.OFF ||
      this.engineState === ENGINE_STATE.SHUTDOWN
    ) {
      this.startEngine();
    } else {
      this.stopEngine();
    }
    return this.engineState;
  }

  update(dt, telemetry) {
    if (!this.initialized || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    const {
      speedRatio = 0,
      isReversing = false,
      isThrottling = false,
      turnRatio = 0,
      drivetrain = null,
    } = telemetry;

    if (this.engineState === ENGINE_STATE.STARTING) {
      this._stateTimer -= dt;
      // Smoothly crossfade eng00 idle loop in near the end of startup
      const idleFade = this._stateTimer < 0.7 ? (0.7 - this._stateTimer) / 0.7 : 0;
      if (this._loopNodes.eng00) {
        this._loopNodes.eng00.gain.gain.setTargetAtTime(idleFade * 0.65, now, 0.08);
      }
      if (this._stateTimer <= 0) {
        this._smoothedRpm = 0;
        this._smoothedLoad = 0;
        this.engineState = ENGINE_STATE.IDLE;
      }
      return;
    }

    if (this.engineState === ENGINE_STATE.SHUTDOWN) {
      this._stateTimer -= dt;
      for (const entry of Object.values(this._loopNodes)) {
        entry.gain.gain.setTargetAtTime(0, now, 0.12);
      }
      if (this._revGain) this._revGain.gain.setTargetAtTime(0, now, 0.08);
      if (this._stateTimer <= 0) {
        this._stopLoopNodes();
        this.engineState = ENGINE_STATE.OFF;
      }
      return;
    }

    if (this.engineState === ENGINE_STATE.OFF) {
      return;
    }

    // 1. Dynamic V-2-34 Diesel RPM & Load Crossfade (driven by sequential drivetrain when available)
    let targetRpm = Math.min(1, speedRatio * 0.9 + turnRatio * 0.35 + (isThrottling ? 0.18 : 0));
    let targetLoad = isThrottling ? Math.min(1, 0.45 + speedRatio * 0.55) : 0;
    if (drivetrain && drivetrain.preset) {
      const span = Math.max(1, drivetrain.preset.maxRpm - drivetrain.preset.idleRpm);
      targetRpm = Math.max(0, Math.min(1.08, (drivetrain.rpm - drivetrain.preset.idleRpm) / span));
      targetLoad = Math.max(0, Math.min(1, drivetrain.load));
    }
    const rpmRate = targetRpm > this._smoothedRpm ? 4.5 : 3.0;
    this._smoothedRpm += (targetRpm - this._smoothedRpm) * (1 - Math.exp(-rpmRate * dt));
    this._smoothedLoad += (targetLoad - this._smoothedLoad) * (1 - Math.exp(-4.5 * dt));

    const rpm = this._smoothedRpm;
    this.engineState = rpm > 0.05 ? ENGINE_STATE.RUNNING : ENGINE_STATE.IDLE;

    // Subtle non-harmonic breathing at idle/cruise
    this._lfoPhase += dt;
    const breath = 1 + Math.sin(this._lfoPhase * 2.1) * 0.02 + Math.sin(this._lfoPhase * 3.3) * 0.015;

    const w00 = triWeight(rpm, 0.0, 0.36) * 0.68 * breath;
    const w33 = triWeight(rpm, 0.33, 0.36) * 0.72 * breath;
    const w66 = triWeight(rpm, 0.66, 0.36) * 0.75 * breath;
    const w99 = triWeight(rpm, 1.0, 0.36) * 0.78 * breath;
    const wLoad = this._smoothedLoad * 0.38;

    const setBand = (key, gainVal, rateVal) => {
      const node = this._loopNodes[key];
      if (!node) return;
      node.gain.gain.setTargetAtTime(gainVal, now, 0.1);
      node.src.playbackRate.setTargetAtTime(rateVal, now, 0.1);
    };

    setBand('eng00', w00, 0.97 + rpm * 0.15);
    setBand('eng33', w33, 0.90 + rpm * 0.25);
    setBand('eng66', w66, 0.88 + rpm * 0.25);
    setBand('eng99', w99, 0.86 + rpm * 0.22);
    setBand('engLoad', wLoad, 0.92 + rpm * 0.2);

    if (this._revGain && this._revOsc) {
      const revLevel = isReversing && speedRatio > 0.03 ? speedRatio * 0.05 : 0;
      this._revGain.gain.setTargetAtTime(revLevel, now, 0.08);
      this._revOsc.frequency.setTargetAtTime(130 + speedRatio * 90, now, 0.08);
    }

    // 2. Dynamic T-34 Steel Track Speed & Turn Rattle Crossfade
    const trackSpeed = Math.min(1, speedRatio + turnRatio * 0.45);
    const isMoving = trackSpeed > 0.03;

    if (this._wasMoving && trackSpeed < 0.035) {
      this._playOneShot('trkStop', this.tracksBus, 0.55, 0.95 + Math.random() * 0.1);
    }
    this._wasMoving = trackSpeed > 0.12 ? true : (trackSpeed < 0.03 ? false : this._wasMoving);

    const t33 = isMoving ? triWeight(trackSpeed, 0.18, 0.42) * 0.62 : 0;
    const t66 = isMoving ? triWeight(trackSpeed, 0.58, 0.42) * 0.68 : 0;
    const t99 = isMoving ? triWeight(trackSpeed, 1.0, 0.44) * 0.72 : 0;
    const tTurn = turnRatio > 0.06 ? turnRatio * 0.58 : 0;

    setBand('trk33', t33, 0.82 + trackSpeed * 0.35);
    setBand('trk66', t66, 0.86 + trackSpeed * 0.32);
    setBand('trk99', t99, 0.88 + trackSpeed * 0.28);
    setBand('trkTurn', tTurn, 0.92 + turnRatio * 0.18);
  }

  updateManualTurretAudio(dt, isManualRotating) {
    if (!this.initialized || this.muted || !this.ctx || this.ctx.state !== 'running') return;
    if (!isManualRotating) {
      this._manualCrankTimer = 0;
      return;
    }
    this._manualCrankTimer += dt;
    if (this._manualCrankTimer >= 0.28) {
      this._manualCrankTimer = 0;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(160 + Math.random() * 25, now);
      osc.frequency.exponentialRampToValueAtTime(75, now + 0.035);
      g.gain.setValueAtTime(0.055, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.connect(g);
      g.connect(this.reloadMechBus);
      osc.start(now);
      osc.stop(now + 0.045);
    }
  }

  playCannon() {
    if (!this.initialized || this.muted || !this.ctx || !this.cannonBus) return;
    if (!this.buffers.cannonShot) return;
    const rate = 0.97 + Math.random() * 0.06;
    this._playOneShot('cannonShot', this.cannonBus, 0.98, rate);
  }

  playMG(sourceTag = 'coax') {
    if (!this.initialized || this.muted || !this.ctx || !this.mgBus) return;
    if (!this.buffers.dtShot) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.dtShot;
    src.playbackRate.value = 0.95 + Math.random() * 0.1;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.55 + Math.random() * 0.08, now);

    // Subtle stereo distinction: coax near center-right (+0.12), hull bow (+0.28)
    if (this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime(sourceTag === 'hull' ? 0.28 : 0.12, now);
      src.connect(gain);
      gain.connect(panner);
      panner.connect(this.mgBus);
    } else {
      src.connect(gain);
      gain.connect(this.mgBus);
    }

    src.start(now);
  }

  /**
   * 12.7mm DShK heavy machine-gun shot using the existing T-34-85 DT MG buffer
   * reference, pitched and attenuated for sustained heavy tripod emplacement fire.
   */
  playDShKShot(sx = 0, sy = 0, lx = sx, ly = sy, obstructed = false) {
    if (!this.initialized || this.muted || !this.ctx || !this.mgBus) return;
    if (!this.buffers.dtShot) return;

    const distMeters = Math.hypot(sx - lx, sy - ly) / 37.8;
    if (distMeters > 165) return;

    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.dtShot;
    // Lower playback rate gives the heavier 12.7x108mm thump without duplicating audio assets
    src.playbackRate.value = 0.72 + Math.random() * 0.06;

    const atten = 1 / (1 + Math.pow(distMeters / 34, 1.35));
    const vol = Math.max(0.03, Math.min(0.75, (0.68 + Math.random() * 0.08) * atten * (obstructed ? 0.68 : 1.0)));

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, now);

    let tail = gain;
    if (obstructed || distMeters > 35) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      const baseCut = obstructed ? 1850 : 4800;
      lp.frequency.setValueAtTime(Math.max(1100, baseCut - distMeters * 18), now);
      src.connect(lp);
      lp.connect(gain);
    } else {
      src.connect(gain);
    }

    if (this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      const pan = Math.max(-0.85, Math.min(0.85, (sx - lx) / 520));
      panner.pan.setValueAtTime(pan, now);
      tail.connect(panner);
      panner.connect(this.mgBus);
    } else {
      tail.connect(this.mgBus);
    }

    src.start(now);
  }

  playExplosion() {
    if (!this.initialized || this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(750, now);
    filter.frequency.exponentialRampToValueAtTime(90, now + 0.55);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.weaponsBus);
    noise.start(now);
    noise.stop(now + 0.62);
  }

  setInfantryVolume(v) {
    this.infantryVolume = Math.max(0, Math.min(1, v));
    if (this.infantryBus && this.ctx) {
      this.infantryBus.gain.setTargetAtTime(this.infantryVolume, this.ctx.currentTime, 0.02);
    }
  }

  playRifleShot(weaponId = 'KAR98K', sx = 0, sy = 0, lx = sx, ly = sy, obstructed = false, envType = 'open') {
    if (!this.initialized || this.muted || !this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    if (this._activeRifleVoices >= 10) return;

    const now = this.ctx.currentTime;
    const distMeters = Math.hypot(sx - lx, sy - ly) / 37.8;
    if (distMeters > 130) return;

    const distAtten = Math.max(0.08, Math.min(1.0, 1 / (1 + distMeters * 0.028)));
    const obsAtten = obstructed ? 0.65 : 1.0;
    const panVal = Math.max(-0.85, Math.min(0.85, (sx - lx) / 480));
    const volVar = 0.90 + Math.random() * 0.14;
    const pitchVar = 0.96 + Math.random() * 0.08;
    const targetBus = this.infantryBus || this.mgBus;

    const bufKey = weaponId === 'MOSIN_1891_30' ? 'mosinShot' : 'kar98kShot';
    const buf = this.buffers[bufKey];

    // Distance- & obstacle-dependent lowpass rolloff (sharp nearby, muffled far/obstructed)
    const lpFilter = this.ctx.createBiquadFilter();
    lpFilter.type = 'lowpass';
    lpFilter.frequency.setValueAtTime(
      obstructed
        ? 1250 + Math.random() * 200
        : Math.max(1850, 8400 - distMeters * 64 + Math.random() * 600),
      now
    );

    const crowdScale = 1 / Math.sqrt(Math.max(1, this._activeRifleVoices + 1));
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.80 * distAtten * obsAtten * volVar * crowdScale, now);

    const panner = typeof this.ctx.createStereoPanner === 'function' ? this.ctx.createStereoPanner() : null;
    lpFilter.connect(gain);
    if (panner) {
      panner.pan.setValueAtTime(panVal, now);
      gain.connect(panner);
      panner.connect(targetBus);
    } else {
      gain.connect(targetBus);
    }

    // Subtle outdoor early reflection tap (no artificial cavernous reverb)
    let reflDelay = null;
    let reflGain = null;
    if (!obstructed && distMeters < 65 && typeof this.ctx.createDelay === 'function') {
      reflDelay = this.ctx.createDelay(0.1);
      reflDelay.delayTime.setValueAtTime(envType === 'trench' ? 0.022 : envType === 'forest' ? 0.042 : 0.032, now);
      reflGain = this.ctx.createGain();
      reflGain.gain.setValueAtTime(0.13 * distAtten, now);
      lpFilter.connect(reflDelay);
      reflDelay.connect(reflGain);
      reflGain.connect(targetBus);
    }

    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = pitchVar;
      src.connect(lpFilter);
      this._activeRifleVoices++;
      src.onended = () => {
        this._activeRifleVoices = Math.max(0, this._activeRifleVoices - 1);
        try {
          src.disconnect();
          lpFilter.disconnect();
          gain.disconnect();
          panner?.disconnect();
          reflDelay?.disconnect();
          reflGain?.disconnect();
        } catch {}
      };
      src.start(now);
    } else if (this._noiseBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(weaponId === 'MOSIN_1891_30' ? 1950 : 1550, now);
      bp.Q.value = 0.7;
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      src.connect(bp);
      bp.connect(lpFilter);
      this._activeRifleVoices++;
      src.onended = () => {
        this._activeRifleVoices = Math.max(0, this._activeRifleVoices - 1);
      };
      src.start(now);
      src.stop(now + 0.18);
    }
  }

  playBoltCycle(sx = 0, sy = 0, lx = sx, ly = sy) {
    if (!this.initialized || this.muted || !this.ctx) return;
    const buf = this.buffers.rifleBolt;
    if (!buf) return;
    const distMeters = Math.hypot(sx - lx, sy - ly) / 37.8;
    if (distMeters > 45) return;
    const atten = Math.max(0.05, 1 / (1 + distMeters * 0.08));

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.96 + Math.random() * 0.08;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.24 * atten;
    src.connect(gain);
    gain.connect(this.reloadMechBus);
    src.start(this.ctx.currentTime);
  }

  _buildPPShBuffers() {
    if (!this.ctx) return;
    const sr = this.ctx.sampleRate;

    /**
     * PPSh-41 7.62x25mm Tokarev procedural shot buffer (~155ms).
     * Audio Reference URL (for manual audio asset integration):
     *   https://www.youtube.com/watch?v=GW-9NFnzMrI
     * Note: Automated environment cannot access/stream YouTube audio directly;
     * this original Web Audio synthesis models the real PPSh-41's sharp
     * compensator crack, tight 7.62x25mm low-mid body, open-bolt mechanical
     * slam (~18-38ms), and brief dry outdoor reflection tail.
     */
    const shotLen = Math.floor(sr * 0.155);
    const shotBuf = this.ctx.createBuffer(1, shotLen, sr);
    const sd = shotBuf.getChannelData(0);
    let lp = 0;
    let reflLp = 0;
    const reflDelaySamples = Math.floor(sr * 0.024);
    for (let i = 0; i < shotLen; i++) {
      const t = i / sr;
      const white = Math.random() * 2 - 1;
      lp += 0.32 * (white - lp);
      const hp = white - lp;

      // 1. Sharp supersonic muzzle crack & compensator snap
      const crackEnv = Math.exp(-t * 62);
      const muzzleSnap = Math.sin(t * 2 * Math.PI * (2400 * Math.exp(-t * 35) + 950)) * Math.exp(-t * 95) * 0.34;

      // 2. Tight 7.62x25mm low-mid chest punch (lighter/tighter than DT 7.62x54mmR)
      const bodyEnv = Math.exp(-t * 34);
      const punch = Math.sin(t * 2 * Math.PI * (195 * Math.exp(-t * 24) + 75)) * Math.exp(-t * 48) * 0.46;

      // 3. Characteristic open-bolt blowback clack & fiber-buffer slam
      let boltClack = 0;
      if (t > 0.017 && t < 0.044) {
        const bt = t - 0.017;
        boltClack =
          (Math.sin(bt * 2 * Math.PI * 1720) * 0.55 + Math.sin(bt * 2 * Math.PI * 2680) * 0.25) *
          Math.exp(-bt * 135) *
          0.3;
      }

      // 4. Dry outdoor environmental early reflection (subtle, no cavernous reverb)
      let refl = 0;
      if (i > reflDelaySamples) {
        const rt = (i - reflDelaySamples) / sr;
        const rNoise = sd[i - reflDelaySamples] || 0;
        reflLp += 0.18 * (rNoise - reflLp);
        refl = reflLp * Math.exp(-rt * 26) * 0.22;
      }

      const raw = hp * crackEnv * 0.92 + lp * bodyEnv * 0.52 + muzzleSnap + punch + boltClack + refl;
      sd[i] = Math.max(-0.98, Math.min(0.98, raw));
    }
    this.buffers.ppshShot = shotBuf;

    // 2. Layered metallic mechanical transients for PPSh-41, DT MG, Rifles & Panzer III
    const makeMech = (dur, { f1, f2, decay, noiseAmt, slideDelay = 0, slideFreq = 0 }) => {
      const len = Math.floor(sr * dur);
      const b = this.ctx.createBuffer(1, len, sr);
      const d = b.getChannelData(0);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = Math.exp(-t * decay);
        const w = Math.random() * 2 - 1;
        lp += 0.28 * (w - lp);
        const hp = w - lp;
        const metal =
          Math.sin(t * 2 * Math.PI * f1) * 0.45 +
          Math.sin(t * 2 * Math.PI * f2) * 0.28;
        let slide = 0;
        if (slideDelay > 0 && t > slideDelay) {
          const st = t - slideDelay;
          slide =
            (Math.sin(st * 2 * Math.PI * slideFreq) * 0.42 + hp * 0.35) *
            Math.exp(-st * (decay * 0.9));
        }
        d[i] = Math.max(-0.95, Math.min(0.95, (metal + hp * noiseAmt) * env + slide));
      }
      return b;
    };

    // PPSh-41 71-round stamped steel drum & heavy open-bolt rack
    this.buffers.ppshMagOut = makeMech(0.12, { f1: 580, f2: 1420, decay: 38, noiseAmt: 0.48, slideDelay: 0.025, slideFreq: 390 });
    this.buffers.ppshMagIn = makeMech(0.14, { f1: 440, f2: 1180, decay: 34, noiseAmt: 0.55, slideDelay: 0.032, slideFreq: 860 });
    this.buffers.ppshBoltRack = makeMech(0.15, { f1: 960, f2: 2150, decay: 36, noiseAmt: 0.62, slideDelay: 0.045, slideFreq: 1320 });
    this.buffers.ppshDryFire = makeMech(0.05, { f1: 1850, f2: 3100, decay: 95, noiseAmt: 0.32 });

    // DT 63-round pan magazine swap & charging handle rack
    this.buffers.dtPanOff = makeMech(0.16, { f1: 360, f2: 920, decay: 26, noiseAmt: 0.52, slideDelay: 0.04, slideFreq: 280 });
    this.buffers.dtPanOn = makeMech(0.18, { f1: 310, f2: 780, decay: 24, noiseAmt: 0.58, slideDelay: 0.05, slideFreq: 640 });
    this.buffers.dtRack = makeMech(0.17, { f1: 680, f2: 1640, decay: 28, noiseAmt: 0.65, slideDelay: 0.055, slideFreq: 1120 });

    // Bolt-action rifles (Kar98k / Mosin-Nagant): bolt stages & 5-round stripper clip stages
    this.buffers.rifleBoltOpen = makeMech(0.12, { f1: 1080, f2: 2350, decay: 40, noiseAmt: 0.45, slideDelay: 0.03, slideFreq: 740 });
    this.buffers.rifleBoltLiftPull = makeMech(0.14, { f1: 1140, f2: 2420, decay: 36, noiseAmt: 0.42, slideDelay: 0.035, slideFreq: 810 });
    this.buffers.rifleCasingEject = makeMech(0.08, { f1: 2650, f2: 4120, decay: 58, noiseAmt: 0.25 });
    this.buffers.rifleBoltPushLock = makeMech(0.14, { f1: 860, f2: 1880, decay: 36, noiseAmt: 0.46, slideDelay: 0.04, slideFreq: 1320 });
    this.buffers.rifleClipInsert = makeMech(0.09, { f1: 1380, f2: 2560, decay: 48, noiseAmt: 0.38 });
    this.buffers.rifleClipRound = makeMech(0.075, { f1: 1620, f2: 2890, decay: 68, noiseAmt: 0.36 });
    this.buffers.rifleClipEject = makeMech(0.09, { f1: 2940, f2: 4480, decay: 52, noiseAmt: 0.22 });
    this.buffers.rifleBoltClose = makeMech(0.13, { f1: 890, f2: 1940, decay: 38, noiseAmt: 0.48, slideDelay: 0.035, slideFreq: 1260 });

    // Panzer III 50mm KwK 39 breech open & close
    this.buffers.pzBreechOpen = makeMech(0.20, { f1: 260, f2: 740, decay: 20, noiseAmt: 0.54, slideDelay: 0.045, slideFreq: 420 });
    this.buffers.pzBreechClose = makeMech(0.19, { f1: 220, f2: 610, decay: 22, noiseAmt: 0.58, slideDelay: 0.04, slideFreq: 520 });
  }

  playPPShShot(sx = 0, sy = 0, lx = sx, ly = sy, obstructed = false) {
    if (!this.initialized || this.muted || !this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    this._activePPShVoices = this._activePPShVoices || 0;
    if (this._activePPShVoices >= 18) return;

    const now = this.ctx.currentTime;
    const distMeters = Math.hypot(sx - lx, sy - ly) / 37.8;
    if (distMeters > 110) return;

    const distAtten = Math.max(0.06, Math.min(1.0, 1 / (1 + distMeters * 0.036)));
    const obsAtten = obstructed ? 0.68 : 1.0;
    const panVal = Math.max(-0.85, Math.min(0.85, (sx - lx) / 480));
    const volVar = 0.9 + Math.random() * 0.14;
    const pitchVar = 0.95 + Math.random() * 0.10;
    const targetBus = this.infantryBus || this.mgBus;

    if (!this.buffers.ppshShot) this._buildPPShBuffers();
    const buf = this.buffers.ppshShot;
    if (!buf) return;

    const toneFilter = this.ctx.createBiquadFilter();
    toneFilter.type = 'lowpass';
    toneFilter.frequency.setValueAtTime(
      obstructed ? 1450 + Math.random() * 250 : Math.max(2400, 6600 - distMeters * 45 + Math.random() * 900),
      now
    );

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.64 * distAtten * obsAtten * volVar, now);

    const panner = typeof this.ctx.createStereoPanner === 'function' ? this.ctx.createStereoPanner() : null;
    toneFilter.connect(gain);
    if (panner) {
      panner.pan.setValueAtTime(panVal, now);
      gain.connect(panner);
      panner.connect(targetBus);
    } else {
      gain.connect(targetBus);
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitchVar;
    src.connect(toneFilter);
    this._activePPShVoices++;
    src.onended = () => {
      this._activePPShVoices = Math.max(0, this._activePPShVoices - 1);
    };
    src.start(now);
  }

  stopReloadSound(reloadKey) {
    if (!reloadKey || !this._activeReloadSources) return;
    const entry = this._activeReloadSources.get(reloadKey);
    if (entry) {
      try {
        entry.src.stop();
        entry.src.disconnect();
      } catch {
        // Ignore already stopped source
      }
      this._activeReloadSources.delete(reloadKey);
    }
  }

  stopAllReloadSounds() {
    if (!this._activeReloadSources) return;
    for (const key of Array.from(this._activeReloadSources.keys())) {
      this.stopReloadSound(key);
    }
    this.crew?.stopAllReloads?.();
  }

  _playReloadMechBuffer(buf, { reloadKey = null, sx = 0, sy = 0, lx = sx, ly = sy, baseGain = 0.32, rate = 1.0, maxDist = 48 } = {}) {
    if (!this.initialized || this.muted || !this.ctx || !this.reloadMechBus || !buf) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    const distMeters = Math.hypot(sx - lx, sy - ly) / 37.8;
    if (distMeters > maxDist) return;
    const atten = Math.max(0.05, Math.min(1.0, 1 / (1 + distMeters * 0.075)));

    this._activeReloadSources = this._activeReloadSources || new Map();
    if (reloadKey) {
      this.stopReloadSound(reloadKey);
    }

    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(baseGain * atten, now);

    const panner = typeof this.ctx.createStereoPanner === 'function' ? this.ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.setValueAtTime(Math.max(-0.85, Math.min(0.85, (sx - lx) / 480)), now);
      src.connect(gain);
      gain.connect(panner);
      panner.connect(this.reloadMechBus);
    } else {
      src.connect(gain);
      gain.connect(this.reloadMechBus);
    }

    if (reloadKey) {
      this._activeReloadSources.set(reloadKey, { src });
    }
    src.onended = () => {
      if (reloadKey && this._activeReloadSources?.get(reloadKey)?.src === src) {
        this._activeReloadSources.delete(reloadKey);
      }
      try {
        src.disconnect();
        gain.disconnect();
        panner?.disconnect();
      } catch {
        // Ignore cleanup errors
      }
    };
    src.start(now);
  }

  playPPShMech(kind = 'mag_in', sx = 0, sy = 0, lx = sx, ly = sy, reloadKey = null) {
    if (!this.buffers.ppshMagIn) this._buildPPShBuffers();
    const keyMap = {
      mag_out: 'ppshMagOut',
      mag_in: 'ppshMagIn',
      bolt_rack: 'ppshBoltRack',
      dry_fire: 'ppshDryFire',
    };
    const buf = this.buffers[keyMap[kind] || 'ppshMagIn'];
    this._playReloadMechBuffer(buf, {
      reloadKey,
      sx,
      sy,
      lx,
      ly,
      baseGain: kind === 'dry_fire' ? 0.22 : 0.30,
      rate: 0.96 + Math.random() * 0.08,
    });
  }

  playMGReloadStage(stage = 'pan_off', sourceTag = 'coax', sx = 0, sy = 0, lx = sx, ly = sy, reloadKey = null) {
    if (!this.buffers.dtPanOff) this._buildPPShBuffers();
    const map = {
      pan_off: 'dtPanOff',
      pan_on: 'dtPanOn',
      rack: 'dtRack',
    };
    const buf = this.buffers[map[stage] || 'dtPanOff'];
    const pitchBase = sourceTag === 'hull' ? 0.96 : 1.02;
    this._playReloadMechBuffer(buf, {
      reloadKey,
      sx,
      sy,
      lx,
      ly,
      baseGain: 0.34,
      rate: pitchBase + (Math.random() - 0.5) * 0.06,
      maxDist: 38,
    });
  }

  playBoltActionStage(stage = 'bolt_lift_pull', weaponId = 'KAR98K', sx = 0, sy = 0, lx = sx, ly = sy, reloadKey = null) {
    if (!this.buffers.rifleBoltLiftPull) this._buildPPShBuffers();
    const map = {
      bolt_lift_pull: 'rifleBoltLiftPull',
      casing_eject: 'rifleCasingEject',
      bolt_push_lock: 'rifleBoltPushLock',
    };
    const buf = this.buffers[map[stage] || 'rifleBoltLiftPull'];
    const weaponPitch = weaponId === 'MOSIN_1891_30' ? 0.93 : 1.04;
    this._playReloadMechBuffer(buf, {
      reloadKey,
      sx,
      sy,
      lx,
      ly,
      baseGain: stage === 'casing_eject' ? 0.18 : 0.25,
      rate: weaponPitch + (Math.random() - 0.5) * 0.06,
    });
  }

  playRifleReloadStage(stage = 'bolt_open', weaponId = 'KAR98K', sx = 0, sy = 0, lx = sx, ly = sy, reloadKey = null) {
    if (!this.buffers.rifleBoltOpen) this._buildPPShBuffers();
    const map = {
      bolt_open: 'rifleBoltOpen',
      clip_insert: 'rifleClipInsert',
      clip_round: 'rifleClipRound',
      clip_eject: 'rifleClipEject',
      bolt_close: 'rifleBoltClose',
    };
    const buf = this.buffers[map[stage] || 'rifleClipRound'];
    const weaponPitch = weaponId === 'MOSIN_1891_30' ? 0.93 : 1.04;
    this._playReloadMechBuffer(buf, {
      reloadKey,
      sx,
      sy,
      lx,
      ly,
      baseGain: stage === 'clip_round' || stage === 'clip_eject' ? 0.22 : 0.28,
      rate: weaponPitch + (Math.random() - 0.5) * 0.06,
    });
  }

  playPanzerReloadStage(stage = 'breech_open', sx = 0, sy = 0, lx = sx, ly = sy, reloadKey = null) {
    if (!this.buffers.pzBreechOpen) this._buildPPShBuffers();
    const buf = stage === 'breech_close' ? this.buffers.pzBreechClose : this.buffers.pzBreechOpen;
    this._playReloadMechBuffer(buf, {
      reloadKey,
      sx,
      sy,
      lx,
      ly,
      baseGain: 0.32,
      rate: 0.97 + Math.random() * 0.06,
      maxDist: 55,
    });
  }

  playRifleReload(sx = 0, sy = 0, lx = sx, ly = sy) {
    this.playRifleReloadStage('clip_round', 'KAR98K', sx, sy, lx, ly);
  }

  playGearShift() {
    if (!this.initialized || this.muted || !this.ctx || !this.engineBus) return;
    if (this.buffers.ppshMagIn) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffers.ppshMagIn;
      src.playbackRate.value = 0.58 + Math.random() * 0.08;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.24;
      src.connect(gain);
      gain.connect(this.engineBus);
      src.start(this.ctx.currentTime);
    }
  }

  playOverheat() {
    if (!this.initialized || this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2600;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.weaponsBus);
    noise.start(now);
    noise.stop(now + 0.48);
  }

  setVoiceDucking(active) {
    this._duckMultiplier = active ? 0.62 : 1.0;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const tau = active ? 0.06 : 0.25;
    if (this.engineBus) {
      this.engineBus.gain.setTargetAtTime(this.engineVolume * this._duckMultiplier, now, tau);
    }
    if (this.tracksBus) {
      this.tracksBus.gain.setTargetAtTime(this.tracksVolume * this._duckMultiplier, now, tau);
    }
  }

  setEngineVolume(val) {
    this.engineVolume = Math.max(0, Math.min(1, val));
    if (this.engineBus && this.ctx) {
      this.engineBus.gain.setTargetAtTime(this.engineVolume * this._duckMultiplier, this.ctx.currentTime, 0.03);
    }
  }

  setTracksVolume(val) {
    this.tracksVolume = Math.max(0, Math.min(1, val));
    if (this.tracksBus && this.ctx) {
      this.tracksBus.gain.setTargetAtTime(this.tracksVolume * this._duckMultiplier, this.ctx.currentTime, 0.03);
    }
  }

  setCannonVolume(val) {
    this.cannonVolume = Math.max(0, Math.min(1, val));
    if (this.cannonBus && this.ctx) {
      this.cannonBus.gain.setTargetAtTime(this.cannonVolume, this.ctx.currentTime, 0.03);
    }
  }

  setMGVolume(val) {
    this.mgVolume = Math.max(0, Math.min(1, val));
    if (this.mgBus && this.ctx) {
      this.mgBus.gain.setTargetAtTime(this.mgVolume, this.ctx.currentTime, 0.03);
    }
  }

  setReloadMechVolume(val) {
    this.reloadMechVolume = Math.max(0, Math.min(1, val));
    if (this.reloadMechBus && this.ctx) {
      this.reloadMechBus.gain.setTargetAtTime(this.reloadMechVolume, this.ctx.currentTime, 0.03);
    }
  }

  setCrewVoiceVolume(val) {
    this.crewVoiceVolume = Math.max(0, Math.min(1, val));
    if (this.crewVoiceBus && this.ctx) {
      this.crewVoiceBus.gain.setTargetAtTime(this.crewVoiceVolume, this.ctx.currentTime, 0.03);
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.03);
    }
    return this.muted;
  }
}
