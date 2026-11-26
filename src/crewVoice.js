/**
 * CrewVoiceManager: Event-driven Russian T-34-85 tank crew voice &
 * 4-stage manual 85mm reload mechanical audio coordinator.
 */

export const CREW_EVENT = {
  MOVEMENT_FORWARD_STARTED: 'MOVEMENT_FORWARD_STARTED',
  MOVEMENT_REVERSE_STARTED: 'MOVEMENT_REVERSE_STARTED',
  CANNON_FIRED: 'CANNON_FIRED',
  RELOAD_STARTED: 'RELOAD_STARTED',
  RELOAD_COMPLETED: 'RELOAD_COMPLETED',
};

const VOICE_CONFIG = {
  [CREW_EVENT.MOVEMENT_FORWARD_STARTED]: {
    priority: 1,
    cooldown: 2.5,
    files: [
      './assets/sounds/crew/movement/forward/wt_cmd_fwd_1.mp3',
      './assets/sounds/crew/movement/forward/wt_cmd_fwd_2.mp3',
      './assets/sounds/crew/movement/forward/wt_drv_fwd_1.mp3',
    ],
  },
  [CREW_EVENT.MOVEMENT_REVERSE_STARTED]: {
    priority: 1,
    cooldown: 2.5,
    files: [
      './assets/sounds/crew/movement/reverse/wt_cmd_rev_1.mp3',
      './assets/sounds/crew/movement/reverse/wt_cmd_rev_2.mp3',
    ],
  },
  [CREW_EVENT.CANNON_FIRED]: {
    priority: 3,
    cooldown: 1.0,
    files: [
      './assets/sounds/crew/cannon/fire/wt_cmd_fire_1.mp3',
      './assets/sounds/crew/cannon/fire/wt_cmd_fire_2.mp3',
      './assets/sounds/crew/cannon/fire/wt_gun_shot_1.mp3',
      './assets/sounds/crew/cannon/fire/wt_gun_shot_2.mp3',
    ],
  },
  [CREW_EVENT.RELOAD_STARTED]: {
    priority: 2,
    cooldown: 2.0,
    files: [
      './assets/sounds/crew/reload/loading/wt_cmd_reload_1.mp3',
      './assets/sounds/crew/reload/loading/wt_cmd_reload_2.mp3',
    ],
  },
  [CREW_EVENT.RELOAD_COMPLETED]: {
    priority: 3,
    cooldown: 1.5,
    files: [
      './assets/sounds/crew/reload/loaded/wt_ldr_ap_ready_1.mp3',
      './assets/sounds/crew/reload/loaded/wt_ldr_ap_ready_2.mp3',
      './assets/sounds/crew/reload/loaded/wt_gun_ready_1.mp3',
    ],
  },
};

const MECH_FILES = {
  openClick: './assets/sounds/crew/mechanical/breech/wt_open_click.mp3',
  breechOpen: './assets/sounds/crew/mechanical/breech/wt_breech_open.mp3',
  ejectShell: './assets/sounds/crew/mechanical/shell_handling/wt_eject_shell.mp3',
  insertShell: './assets/sounds/crew/mechanical/shell_loading/wt_insert_shell.mp3',
  moveBreech: './assets/sounds/crew/mechanical/breech/wt_move_breech.mp3',
  breechClose: './assets/sounds/crew/mechanical/breech/wt_breech_close.mp3',
};

export class CrewVoiceManager {
  constructor(soundEngine) {
    this.sound = soundEngine;
    this.enabled = true;
    // Spoken Russian tank crew voices are disabled (English text-only chat mode).
    // Mechanical 85mm breech/reload audio (MECH_FILES) remains active.
    this.spokenVoicesEnabled = false;
    this.onCrewEvent = null;

    this.voiceBuffers = {};
    this.mechBuffers = {};
    this._loaded = false;
    this._loadingPromise = null;

    this._activeSrc = null;
    this._activePriority = 0;
    this._voiceEndTime = 0;
    this._lastEventTime = {};
    this._pendingTimer = null;

    this._wasReloading = false;
    this._reloadStage = 0;
    this._voiceReloadStageDone = false;
  }

  async preload() {
    if (this._loaded) return;
    if (this._loadingPromise) return this._loadingPromise;

    this._loadingPromise = (async () => {
      const ctx = this.sound.ctx;
      if (!ctx) return;

      const decodeUrl = async (url) => {
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const arr = await resp.arrayBuffer();
          return await ctx.decodeAudioData(arr);
        } catch (err) {
          console.warn(`Crew audio load failed (${url}):`, err);
          return null;
        }
      };

      const tasks = [];
      // Spoken crew voice MP3s (VOICE_CONFIG) are intentionally not preloaded/played.
      for (const [key, url] of Object.entries(MECH_FILES)) {
        tasks.push(
          decodeUrl(url).then((buf) => {
            if (buf) this.mechBuffers[key] = buf;
          })
        );
      }

      await Promise.all(tasks);
      this._loaded = true;
    })();

    return this._loadingPromise;
  }

  toggleEnabled() {
    this.enabled = !this.enabled;
    if (!this.enabled) {
      this._stopActiveVoice();
    }
    return this.enabled;
  }

  trigger(event, delaySec = 0) {
    this.onCrewEvent?.(event);
    if (!this.spokenVoicesEnabled) return;
    if (!this.enabled || !this.sound.initialized || this.sound.muted) return;
    const ctx = this.sound.ctx;
    if (!ctx || ctx.state !== 'running') return;

    const cfg = VOICE_CONFIG[event];
    const pool = this.voiceBuffers[event];
    if (!cfg || !pool || pool.length === 0) return;

    const now = ctx.currentTime;
    const last = this._lastEventTime[event] || -999;
    if (now - last < cfg.cooldown) return;

    // Cancel pending delayed line if higher priority arrives
    if (this._pendingTimer && cfg.priority >= this._activePriority) {
      clearTimeout(this._pendingTimer);
      this._pendingTimer = null;
    }

    if (delaySec > 0) {
      this._pendingTimer = setTimeout(() => {
        this._pendingTimer = null;
        this._playImmediate(event);
      }, delaySec * 1000);
      return;
    }

    this._playImmediate(event);
  }

  _playImmediate(event) {
    if (!this.spokenVoicesEnabled || !this.enabled || this.sound.muted || !this.sound.ctx || !this.sound.crewVoiceBus) {
      return;
    }
    const ctx = this.sound.ctx;
    const now = ctx.currentTime;
    const cfg = VOICE_CONFIG[event];
    const pool = this.voiceBuffers[event];
    if (!cfg || !pool || pool.length === 0) return;

    // Respect active voice priority & minimum spacing (0.3s)
    const isPlaying = this._activeSrc && now < this._voiceEndTime + 0.25;
    if (isPlaying) {
      if (cfg.priority < this._activePriority) {
        return; // Lower priority yields to active speech
      }
      this._stopActiveVoice();
    }

    const buf = pool[Math.floor(Math.random() * pool.length)];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.98 + Math.random() * 0.04;
    src.connect(this.sound.crewVoiceBus);

    this._activeSrc = src;
    this._activePriority = cfg.priority;
    this._voiceEndTime = now + buf.duration;
    this._lastEventTime[event] = now;

    // Duck engine & tracks smoothly while crew speaks
    this.sound.setVoiceDucking(true);

    src.onended = () => {
      if (this._activeSrc === src) {
        this._activeSrc = null;
        this._activePriority = 0;
        this.sound.setVoiceDucking(false);
      }
    };

    src.start(now);
  }

  _stopActiveVoice() {
    if (this._activeSrc) {
      try {
        this._activeSrc.stop();
        this._activeSrc.disconnect();
      } catch {
        // Ignore already stopped
      }
      this._activeSrc = null;
      this._activePriority = 0;
      this.sound.setVoiceDucking(false);
    }
  }

  _playMech(key, seqId = null, mainGun = null) {
    if (!this.sound.initialized || this.sound.muted || !this.sound.ctx || !this.sound.reloadMechBus) {
      return;
    }
    const buf = this.mechBuffers[key];
    if (!buf) return;

    const owner = mainGun?.ownerTank;
    const isReinf = Boolean(owner?.isReinforcement);
    const lx = owner?.camera?.x ?? owner?.x ?? 0;
    const ly = owner?.camera?.y ?? owner?.y ?? 0;
    const reloadKey = seqId ? `cannon_${seqId}` : null;

    if (isReinf && typeof this.sound._playReloadMechBuffer === 'function') {
      this.sound._playReloadMechBuffer(buf, {
        reloadKey,
        sx: owner.x,
        sy: owner.y,
        lx,
        ly,
        baseGain: 0.55,
        rate: 0.98 + Math.random() * 0.04,
        maxDist: 55,
      });
      return;
    }

    const now = this.sound.ctx.currentTime;
    const src = this.sound.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.sound.reloadMechBus);
    this._activeMechSources = this._activeMechSources || new Map();
    if (reloadKey) {
      const prev = this._activeMechSources.get(reloadKey);
      if (prev) {
        try { prev.stop(); prev.disconnect(); } catch {}
      }
      this._activeMechSources.set(reloadKey, src);
    }
    src.onended = () => {
      if (reloadKey && this._activeMechSources?.get(reloadKey) === src) {
        this._activeMechSources.delete(reloadKey);
      }
      try { src.disconnect(); } catch {}
    };
    src.start(now);
  }

  stopReload(seqId) {
    if (!seqId || !this._activeMechSources) return;
    const key = `cannon_${seqId}`;
    const src = this._activeMechSources.get(key);
    if (src) {
      try { src.stop(); src.disconnect(); } catch {}
      this._activeMechSources.delete(key);
    }
  }

  stopAllReloads() {
    if (!this._activeMechSources) return;
    for (const src of this._activeMechSources.values()) {
      try { src.stop(); src.disconnect(); } catch {}
    }
    this._activeMechSources.clear();
  }

  /**
   * Synchronizes 6-stage manual reload mechanical audio with each MainGun's
   * independent reload state & unique sequence ID (no shared singleton state).
   */
  updateReloadProgress(mainGun) {
    if (!mainGun) return;
    if (!mainGun._reloadAudioState) {
      mainGun._reloadAudioState = { wasReloading: false, stage: 0, seqId: 0, chatSent: false };
    }
    const st = mainGun._reloadAudioState;
    const destroyed = Boolean(mainGun.ownerTank?.damageSystem?.vehicleDestroyed);

    if (mainGun.isReloading && mainGun.ammo > 0 && !destroyed) {
      if (!st.wasReloading) {
        this._nextReloadSeqId = (this._nextReloadSeqId || 0) + 1;
        st.wasReloading = true;
        st.stage = 0;
        st.seqId = this._nextReloadSeqId;
        st.chatSent = false;
      }

      const p = mainGun.reloadProgress;

      // Stage 1: Breech unlocking click (~0.34s after shot)
      if (st.stage < 1 && p >= 0.04) {
        st.stage = 1;
        this._playMech('openClick', st.seqId, mainGun);
      }

      // Stage 2: Heavy breech block opening (~0.76s)
      if (st.stage < 2 && p >= 0.09) {
        st.stage = 2;
        this._playMech('breechOpen', st.seqId, mainGun);
      }

      // Text-only reload notification (~1.36s)
      if (!st.chatSent && p >= 0.16) {
        st.chatSent = true;
        this.trigger(CREW_EVENT.RELOAD_STARTED);
      }

      // Stage 3: Spent shell casing ejection & floor clatter (~2.12s)
      if (st.stage < 3 && p >= 0.25) {
        st.stage = 3;
        this._playMech('ejectShell', st.seqId, mainGun);
      }

      // Stage 4: Manual 85mm shell insertion into chamber (~4.25s)
      if (st.stage < 4 && p >= 0.50) {
        st.stage = 4;
        this._playMech('insertShell', st.seqId, mainGun);
      }

      // Stage 5: Heavy steel breech block sliding shut (~6.29s)
      if (st.stage < 5 && p >= 0.74) {
        st.stage = 5;
        this._playMech('moveBreech', st.seqId, mainGun);
      }

      // Stage 6: Breech locking slam (~7.48s)
      if (st.stage < 6 && p >= 0.88) {
        st.stage = 6;
        this._playMech('breechClose', st.seqId, mainGun);
      }
    } else if (st.wasReloading) {
      const completedNormally = !destroyed && !mainGun.isReloading && mainGun.ammo > 0 && mainGun.reloadTimer <= 0;
      if (!completedNormally) {
        // Interrupted (destroyed / cancelled) -> stop active reload sound immediately
        this.stopReload(st.seqId);
      } else {
        this.trigger(CREW_EVENT.RELOAD_COMPLETED);
      }
      st.wasReloading = false;
      st.stage = 0;
      st.seqId = 0;
      st.chatSent = false;
    }
  }
}
