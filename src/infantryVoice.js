/**
 * Unified English-Only Text Communication System (Infantry & Tanks)
 *
 * Audio Architecture:
 * - All spoken dialogue, casual conversations, commands, warnings, and TTS
 *   playback (German & Russian) are DISABLED for both infantry and tank crews.
 * - All units communicate exclusively via compact English world-space chat bubbles
 *   attached to their speaking soldier or tank (working even when audio is muted).
 * - Only brief non-verbal physical pain grunts (PAIN_MINOR, PAIN_SERIOUS, PAIN_DEATH)
 *   are routed to Web Audio via SoundEngine.infantryBus.
 */

export const VOICE_PRIORITY = {
  PAIN: 1,
  CASUALTY_WITNESS: 2,
  COMBAT_WARNING: 3,
  PANIC_RETREAT: 4,
  ACK: 5,
  CASUAL_CHAT: 6,
};

export const NON_VERBAL_PAIN_CATEGORIES = new Set([
  'PAIN_MINOR',
  'PAIN_SERIOUS',
  'PAIN_DEATH',
]);

export const SPOKEN_DIALOGUE_CATEGORIES = new Set([
  'CASUALTY_WITNESS',
  'ARTILLERY_REACTION',
  'WOUNDED_DISTRESS',
  'COMBAT_WARNING',
  'PANIC_RETREAT',
  'CREW_TANK_DANGER',
  'ACK',
  'RELOADING',
  'TAKING_COVER',
  'FRIENDLY_FIRE_WARN',
  'TARGET_LOST',
  'IDLE_CHAT_INIT',
  'IDLE_CHAT_REPLY',
  'TANK_TARGET_SPOTTED',
  'TANK_ENGAGING',
  'TANK_RELOADING',
  'TANK_TAKING_FIRE',
  'TANK_TRACK_DAMAGED',
  'TANK_NEED_SUPPORT',
  'TANK_MOVING_TO_POS',
  'TANK_POS_REACHED',
  'TANK_LOST_CONTACT',
]);

export const FACTION_LINES = {
  german: {
    lang: 'en-US',
    PAIN_MINOR: ['Ugh!', 'Hit!', 'Grazed me!'],
    PAIN_SERIOUS: ["I'm hit! Medic!", 'Wounded! Need help!', 'Need medical aid!'],
    PAIN_DEATH: ['Argh...', "I'm done..."],
    CASUALTY_WITNESS: ['Squadmate hit!', 'Medic! Over here!', 'Man down!'],
    WOUNDED_DISTRESS: ["Medic! I'm hit!", 'Help me!', "I'm bleeding!", "I can't move!", 'Over here!'],
    ARTILLERY_REACTION: ['Artillery! Get down!', 'Incoming shells! Stay low!', 'Take cover!'],
    COMBAT_WARNING: ['Enemy spotted!', 'Watch your left!', 'Taking fire!'],
    PANIC_RETREAT: ['Fall back! Fall back!', "We're being overrun!", 'Pull back!'],
    CREW_TANK_DANGER: ['The tank is burning!', 'Bail out!', 'Vehicle hit!'],
    ACK: ['Copy that!', 'Move out!', 'On position!'],
    RELOADING: ['Reloading!', 'Changing clip!'],
    TAKING_COVER: ['Get behind the tank!', 'Stay low!', 'Moving to cover!'],
    FRIENDLY_FIRE_WARN: ['Watch your fire! Friendly!', "Cease fire, we're allies!"],
    TARGET_LOST: ['Lost sight of target.', 'Enemy out of view.'],
    IDLE_CHAT_INIT: ['All quiet here?', 'Keep eyes on the left flank.', 'Any movement ahead?'],
    IDLE_CHAT_REPLY: ['Yeah, no enemy movement yet.', 'Watching the sector.', 'All clear so far.'],
    TANK_TARGET_SPOTTED: ['Enemy tank spotted!', 'Target acquired!'],
    TANK_ENGAGING: ['Engaging target!', 'Firing!'],
    TANK_RELOADING: ['Reloading main gun!', 'Loading next round!'],
    TANK_TAKING_FIRE: ['Taking fire!', 'Armor hit!'],
    TANK_TRACK_DAMAGED: ['Track damaged!', 'Mobility hit!'],
    TANK_NEED_SUPPORT: ['We need support!', 'Need assistance!'],
    TANK_MOVING_TO_POS: ['Moving out!', 'Advancing!'],
    TANK_POS_REACHED: ['Position reached!', 'Holding position!'],
    TANK_LOST_CONTACT: ['Lost contact with target.', 'Target out of sight.'],
  },
  soviet: {
    lang: 'en-US',
    PAIN_MINOR: ['Ugh!', 'Hit!', 'Just a scratch!'],
    PAIN_SERIOUS: ["I'm hit! Medic!", 'Wounded! We need support!', 'Help!'],
    PAIN_DEATH: ['Argh...', 'Tell the squad...'],
    CASUALTY_WITNESS: ['Comrade down!', 'Medic! Over here!', 'Ally hit!'],
    WOUNDED_DISTRESS: ["Medic! I'm hit!", 'Help me!', "I'm bleeding!", "I can't move!", 'Over here!'],
    ARTILLERY_REACTION: ['Artillery! Take cover!', 'Incoming shells! Stay low!', 'Hit the dirt!'],
    COMBAT_WARNING: ['Enemy spotted!', 'Watch your right!', 'Shots fired! Take cover!'],
    PANIC_RETREAT: ['Fall back!', 'Pull back to cover!', 'Retreat!'],
    CREW_TANK_DANGER: ['The tank is on fire!', 'Bail out!', 'Ammo fire! Get clear!'],
    ACK: ['Copy that!', 'Move out!', 'Understood!'],
    RELOADING: ['Reloading!', 'Swapping drum!'],
    TAKING_COVER: ['Stay behind the tank!', 'Take cover!', 'Moving to cover!'],
    FRIENDLY_FIRE_WARN: ['Watch your fire! Friendly!', 'Hold fire, friendly unit!'],
    TARGET_LOST: ['Lost contact with enemy.', 'Target disappeared.'],
    IDLE_CHAT_INIT: ['How is the perimeter?', 'Watch the right flank.', 'Any enemy movement?'],
    IDLE_CHAT_REPLY: ['All quiet so far.', 'Eyes on the sector.', 'Nothing moving yet.'],
    TANK_TARGET_SPOTTED: ['Enemy tank spotted!', 'Target acquired!'],
    TANK_ENGAGING: ['Engaging target!', 'Firing!'],
    TANK_RELOADING: ['Reloading main gun!', 'Loader, next shell!'],
    TANK_TAKING_FIRE: ['Taking fire!', 'Hull hit!'],
    TANK_TRACK_DAMAGED: ['Track damaged!', 'Left or right track hit!'],
    TANK_NEED_SUPPORT: ['Need assistance!', 'We need support!'],
    TANK_MOVING_TO_POS: ['Moving to your position!', 'On the way!'],
    TANK_POS_REACHED: ['Position reached!', 'Holding wingman position!'],
    TANK_LOST_CONTACT: ['Lost sight of target.', 'Target out of range.'],
  },
};

export class InfantryVoiceSystem {
  constructor(soundEngine) {
    this.sound = soundEngine;
    // Spoken dialogue & TTS are disabled across all infantry & tank crews (English text-only).
    this.spokenDialogueEnabled = false;
    this._globalLastPlayTime = 0;
    this._lastPriorityPlayed = 99;
    this._areaChatCooldown = 6.0;
    this._activeCallouts = []; // { entity, soldier, isTank, x, y, text, faction, life, maxLife }
    this._lastIdxByKey = new Map();
  }

  reset() {
    this._activeCallouts.length = 0;
    this._areaChatCooldown = 6.0;
  }

  _pickLine(faction, category, forcedIdx = null) {
    const lib = FACTION_LINES[faction] || FACTION_LINES.soviet;
    const list = lib[category];
    if (!list || list.length === 0) return null;

    let idx;
    if (forcedIdx !== null && forcedIdx >= 0 && forcedIdx < list.length) {
      idx = forcedIdx;
    } else {
      const key = `${faction}:${category}`;
      const prevIdx = this._lastIdxByKey.get(key) ?? -1;
      idx = Math.floor(Math.random() * list.length);
      if (list.length > 1 && idx === prevIdx) {
        idx = (idx + 1) % list.length;
      }
      this._lastIdxByKey.set(key, idx);
    }
    return { text: list[idx], lang: lib.lang, index: idx };
  }

  /**
   * Non-verbal pain/impact cue ONLY (never used for spoken dialogue/chat/commands).
   */
  _playNonVerbalPainCue(category, sx, sy, lx, ly, obstructed = false) {
    if (!NON_VERBAL_PAIN_CATEGORIES.has(category)) return;
    const s = this.sound;
    if (!s || !s.initialized || s.muted || !s.ctx || s.ctx.state !== 'running') return;
    const ctx = s.ctx;
    const now = ctx.currentTime;
    const distMeters = Math.hypot(sx - lx, sy - ly) / 37.8;
    if (distMeters > 45) return;

    const atten = Math.max(0.08, Math.min(1.0, 1 / (1 + distMeters * 0.048)));
    const panVal = Math.max(-0.85, Math.min(0.85, (sx - lx) / 480));
    const targetBus = s.infantryBus || s.masterGain;

    const dur = category === 'PAIN_DEATH' ? 0.24 : 0.18;
    const baseFreq = 128 + Math.random() * 28;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(70, baseFreq * 0.62), now + dur);

    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.setValueAtTime(680, now);
    formant.Q.value = 2.4;

    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.setValueAtTime(obstructed ? 880 : 2400, now);

    const gain = ctx.createGain();
    const peak = 0.2 * atten * (obstructed ? 0.7 : 1.0);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(formant);
    formant.connect(muffle);
    muffle.connect(gain);

    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(panVal, now);
      gain.connect(panner);
      panner.connect(targetBus);
    } else {
      gain.connect(targetBus);
    }

    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  /**
   * Unified English text chat request for both infantry soldiers and tanks.
   */
  requestChat(entity, category, priority, listenerX, listenerY, environment = null) {
    if (!entity) return false;
    const isTank = Boolean(entity.turret || entity.armorPreset);

    if (!isTank && (entity.state === 'DEAD' || entity.state === 'FALLING' || entity.state === 'RAGDOLL')) {
      if (category !== 'PAIN_DEATH') return false;
    }

    const nowSec = typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000;
    const minInterval = priority <= VOICE_PRIORITY.COMBAT_WARNING ? 0.35 : 0.95;

    if (nowSec - this._globalLastPlayTime < minInterval && priority >= this._lastPriorityPlayed) {
      return false;
    }
    const curCooldown = entity._voiceCooldown || 0;
    if (curCooldown > 0 && priority > VOICE_PRIORITY.PAIN && category !== 'IDLE_CHAT_REPLY') {
      return false;
    }

    const forcedIdx =
      category === 'IDLE_CHAT_REPLY' && Number.isInteger(entity._pendingChatPairIndex)
        ? entity._pendingChatPairIndex
        : null;
    const picked = this._pickLine(entity.faction || 'soviet', category, forcedIdx);
    if (!picked) return false;

    if (category === 'IDLE_CHAT_INIT' && entity._socialPartner) {
      entity._socialPartner._pendingChatPairIndex = picked.index;
    } else if (category === 'IDLE_CHAT_REPLY') {
      entity._pendingChatPairIndex = null;
    }

    const distMeters = Math.hypot(entity.x - listenerX, entity.y - listenerY) / 37.8;
    const obstructed = Boolean(
      environment &&
      typeof environment.hasLineOfSight === 'function' &&
      !environment.hasLineOfSight(listenerX, listenerY, entity.x, entity.y)
    );

    this._globalLastPlayTime = nowSec;
    this._lastPriorityPlayed = priority;
    entity._voiceCooldown = isTank
      ? 3.2
      : (priority <= VOICE_PRIORITY.CASUALTY_WITNESS ? 2.2 : 5.0);

    // Non-verbal pain cues ONLY; zero spoken dialogue audio
    if (!isTank && NON_VERBAL_PAIN_CATEGORIES.has(category)) {
      this._playNonVerbalPainCue(category, entity.x, entity.y, listenerX, listenerY, obstructed);
    }

    // World-space English chat bubble (works even when Audio Mixer is muted)
    if (distMeters <= 48) {
      const existingIdx = this._activeCallouts.findIndex((c) => c.entity === entity);
      if (existingIdx !== -1) {
        this._activeCallouts.splice(existingIdx, 1);
      } else if (this._activeCallouts.length >= 6) {
        this._activeCallouts.shift();
      }
      const duration = category.startsWith('IDLE_CHAT') ? 2.5 : 2.1;
      this._activeCallouts.push({
        entity,
        soldier: isTank ? null : entity,
        isTank,
        x: entity.x,
        y: entity.y,
        text: picked.text,
        faction: entity.faction || 'soviet',
        life: duration,
        maxLife: duration,
      });
    }
    return true;
  }

  // Backward-compatible alias
  requestVoice(entity, category, priority, listenerX, listenerY, environment = null) {
    return this.requestChat(entity, category, priority, listenerX, listenerY, environment);
  }

  update(dt, soldiers, environment, listenerX, listenerY) {
    // Decay and track entity world coordinates
    for (let i = this._activeCallouts.length - 1; i >= 0; i--) {
      const c = this._activeCallouts[i];
      c.life -= dt;
      if (c.entity) {
        const stillValid = c.isTank ? !c.entity.destroyed : c.entity.alive;
        if (stillValid) {
          c.x = c.entity.x;
          c.y = c.entity.y;
        }
      }
      if (c.life <= 0) {
        this._activeCallouts.splice(i, 1);
      }
    }

    // Decay tank cooldowns if tracked on active callouts
    for (const c of this._activeCallouts) {
      if (c.isTank && c.entity && c.entity._voiceCooldown > 0) {
        c.entity._voiceCooldown = Math.max(0, c.entity._voiceCooldown - dt);
      }
    }

    // Occasional English text-only casual conversations when nearby friendly soldiers are idle and safe
    this._areaChatCooldown = Math.max(0, this._areaChatCooldown - dt);
    if (this._areaChatCooldown > 0) return;

    for (let i = 0; i < soldiers.length; i++) {
      const a = soldiers[i];
      if (!a.alive || a.isPlayerControlled || a.isBoardingVehicle) continue;
      if (a.behaviorState !== 'IDLE' || a.morale < 0.78 || a._combatTarget) continue;

      for (let j = i + 1; j < soldiers.length; j++) {
        const b = soldiers[j];
        if (!b.alive || b.faction !== a.faction || b.isPlayerControlled || b.isBoardingVehicle) continue;
        if (b.behaviorState !== 'IDLE' || b.morale < 0.78 || b._combatTarget) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) > 125) continue;

        a.startSocializing(b);
        b.startSocializing(a);
        this.requestChat(a, 'IDLE_CHAT_INIT', VOICE_PRIORITY.CASUAL_CHAT, listenerX, listenerY, environment);
        b._pendingChatReplyTimer = 1.35;
        this._areaChatCooldown = 10.0 + Math.random() * 8.0;
        return;
      }
    }
    this._areaChatCooldown = 3.5;
  }

  /**
   * Local gunshot / cannon / explosion sound awareness (range-limited, never global).
   */
  emitSoundEvent({ x, y, kind, faction, radius, soldiers, environment, listenerX, listenerY }) {
    for (const s of soldiers) {
      if (!s.alive || s.isPlayerControlled || s.isBoardingVehicle) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d > radius) continue;
      s.onHearSoundEvent({ x, y, kind, faction, dist: d, environment, voiceSystem: this, listenerX, listenerY });
    }
  }

  /**
   * Local artillery casualty witnessing & morale impact.
   */
  emitCasualtyEvent({ victim, blastX, blastY, isArtillery, soldiers, environment, listenerX, listenerY }) {
    if (!victim) return;
    for (const s of soldiers) {
      if (s === victim || !s.alive || s.faction !== victim.faction || s.isPlayerControlled || s.isBoardingVehicle) continue;
      const d = Math.hypot(s.x - victim.x, s.y - victim.y);
      if (d > 340) continue;
      const hasLOS = !environment || typeof environment.hasLineOfSight !== 'function'
        ? true
        : environment.hasLineOfSight(s.x, s.y, victim.x, victim.y);
      s.onWitnessCasualty({ victim, blastX, blastY, isArtillery, dist: d, hasLOS, soldiers, environment, voiceSystem: this, listenerX, listenerY });
    }
  }

  /**
   * Dismounted crew reaction when a nearby friendly vehicle catches fire or explodes.
   */
  emitVehicleEvent({ tank, kind, soldiers, environment, listenerX, listenerY }) {
    if (!tank) return;
    for (const s of soldiers) {
      if (!s.alive || s.faction !== tank.faction || s.isPlayerControlled || s.isBoardingVehicle) continue;
      const d = Math.hypot(s.x - tank.x, s.y - tank.y);
      if (d > 300) continue;
      s.morale = Math.max(0.15, s.morale - (kind === 'destroyed' ? 0.35 : 0.22));
      s.behaviorState = kind === 'destroyed' ? 'FRIGHTENED' : 'ALERT';
      s._behaviorTimer = 2.4;
      this.requestChat(s, 'CREW_TANK_DANGER', VOICE_PRIORITY.COMBAT_WARNING, listenerX, listenerY, environment);
    }
  }

  renderCallouts(ctx) {
    if (this._activeCallouts.length === 0) return;
    ctx.save();
    ctx.font = '600 9.5px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';

    const placedBoxes = [];
    for (const c of this._activeCallouts) {
      const alpha = Math.min(0.92, c.life / 0.55);
      const isSoviet = c.faction === 'soviet';
      const w = ctx.measureText(c.text).width + 12;
      const h = 15;
      let boxY = c.y - (c.isTank ? 52 : 34);
      const boxX = c.x - w * 0.5;

      // De-overlap vertically if another nearby unit is chatting at the same time
      for (const prev of placedBoxes) {
        const overlapX = boxX < prev.x + prev.w + 4 && boxX + w + 4 > prev.x;
        const overlapY = boxY < prev.y + prev.h + 3 && boxY + h + 3 > prev.y;
        if (overlapX && overlapY) {
          boxY = prev.y - h - 4;
        }
      }
      placedBoxes.push({ x: boxX, y: boxY, w, h });

      ctx.globalAlpha = alpha;
      ctx.fillStyle = c.isTank ? 'rgba(14, 22, 16, 0.86)' : 'rgba(12, 16, 12, 0.80)';
      ctx.strokeStyle = isSoviet ? 'rgba(126, 198, 255, 0.52)' : 'rgba(230, 215, 168, 0.52)';
      ctx.lineWidth = c.isTank ? 1.0 : 0.8;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, w, h, 3);
      ctx.fill();
      ctx.stroke();

      // Pointer triangle toward speaking unit
      ctx.beginPath();
      ctx.moveTo(c.x - 3, boxY + h);
      ctx.lineTo(c.x, boxY + h + 4);
      ctx.lineTo(c.x + 3, boxY + h);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = isSoviet ? '#a6dcff' : '#efe0b2';
      ctx.fillText(c.text, c.x, boxY + 11);
    }
    ctx.restore();
  }
}
