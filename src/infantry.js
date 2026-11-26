/**
 * German WWII Infantry Squad (8 independent soldier entities around Panzer III).
 * Articulated top-down 2D rendering with ALIVE / HIT / FALLING / DEAD state machine,
 * hit flinch, natural collapse animation, and persistent ground blood pool.
 */
import { CONFIG } from './config.js';
import { RIFLE_WEAPONS } from './combat/projectileData.js';
import { DetectionTracker, DETECTION_STATE } from './combat/detection.js';
import {
  createSoldierInventory,
  updateSoldierCQCAndThrowables,
  selectSoldierWeaponSlot,
  performSoldierMeleeThrust,
} from './combat/infantryCQC.js?v=21';

export const SOLDIER_STATE = {
  ALIVE: 'ALIVE',
  HIT: 'HIT',
  FALLING_WOUNDED: 'FALLING_WOUNDED',
  WOUNDED_IDLE: 'WOUNDED_IDLE',
  FALLING_DEAD: 'FALLING_DEAD',
  FALLING: 'FALLING',
  RAGDOLL: 'RAGDOLL',
  DEAD: 'DEAD',
};

export const DAMAGE_CATEGORY = {
  SMALL_ARMS_DAMAGE: 'SMALL_ARMS_DAMAGE',
  HEAVY_PROJECTILE_DAMAGE: 'HEAVY_PROJECTILE_DAMAGE',
  ARTILLERY_BLAST_DAMAGE: 'ARTILLERY_BLAST_DAMAGE',
  CRUSHING_DAMAGE: 'CRUSHING_DAMAGE',
  OTHER_ENVIRONMENTAL_DAMAGE: 'OTHER_ENVIRONMENTAL_DAMAGE',
};

export const CASUALTY_CONFIG = {
  WOUNDED_HP_THRESHOLD: 9,
  SEVERE_SMALL_ARMS_HIT_MIN: 7,
  OVERWHELMING_SMALL_ARMS_DMG: 22,
  BLEED_RATE_PER_SEC: 0.65,
  BLEED_POOL_INTERVAL: 1.8,
  FALLING_WOUNDED_DURATION: 0.48,
  FALLING_DEAD_DURATION: 0.56,
};

export function classifyDamageCategory(weaponType = 'mg', blastInfo = null) {
  if (
    weaponType === 'mg' ||
    weaponType === 'rifle' ||
    weaponType === 'smg' ||
    weaponType === 'kar98k' ||
    weaponType === 'mosin' ||
    weaponType === 'ppsh41' ||
    weaponType === 'dt_mg' ||
    weaponType === 'mg34'
  ) {
    return DAMAGE_CATEGORY.SMALL_ARMS_DAMAGE;
  }
  if (weaponType === 'cannon') {
    return !blastInfo || blastInfo.isDirect
      ? DAMAGE_CATEGORY.HEAVY_PROJECTILE_DAMAGE
      : DAMAGE_CATEGORY.ARTILLERY_BLAST_DAMAGE;
  }
  if (weaponType === 'artillery' || weaponType === 'explosion' || weaponType === 'he') {
    return DAMAGE_CATEGORY.ARTILLERY_BLAST_DAMAGE;
  }
  if (weaponType === 'crush') {
    return DAMAGE_CATEGORY.CRUSHING_DAMAGE;
  }
  return DAMAGE_CATEGORY.OTHER_ENVIRONMENTAL_DAMAGE;
}

export const AI_STATE = {
  IDLE: 'IDLE',
  WALKING: 'WALKING',
  RUNNING: 'RUNNING',
  DETECTING_TARGET: 'DETECTING_TARGET',
  TURNING_TO_TARGET: 'TURNING_TO_TARGET',
  AIMING: 'AIMING',
  FIRING: 'FIRING',
  CYCLING_BOLT: 'CYCLING_BOLT',
  RELOADING: 'RELOADING',
  SEEKING_COVER: 'SEEKING_COVER',
  TAKING_COVER: 'TAKING_COVER',
  CROUCHING: 'CROUCHING',
  PEEKING: 'PEEKING',
  RETREATING: 'RETREATING',
};

export const BEHAVIOR_STATE = {
  IDLE: 'IDLE',
  SOCIALIZING: 'SOCIALIZING',
  ALERT: 'ALERT',
  INVESTIGATING: 'INVESTIGATING',
  SUPPRESSED: 'SUPPRESSED',
  FRIGHTENED: 'FRIGHTENED',
  PANICKED: 'PANICKED',
  COMBAT: 'COMBAT',
  WOUNDED: 'WOUNDED',
  RETREATING: 'RETREATING',
  RECOVERING: 'RECOVERING',
  DEAD: 'DEAD',
};

export const FRIENDLY_COVER_RANGE_METERS = 200;
export const FRIENDLY_COVER_RANGE_PX = FRIENDLY_COVER_RANGE_METERS * CONFIG.TANK.PIXELS_PER_METER;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function rotateAround(pt, origin, angle) {
  if (!angle) return pt;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = pt.x - origin.x;
  const dy = pt.y - origin.y;
  return {
    x: origin.x + dx * c - dy * s,
    y: origin.y + dx * s + dy * c,
  };
}

function segmentIntersectsOBB(x1, y1, x2, y2, obb, pad = 0) {
  const cos = Math.cos(-obb.angle);
  const sin = Math.sin(-obb.angle);
  const dx1 = x1 - obb.x;
  const dy1 = y1 - obb.y;
  const dx2 = x2 - obb.x;
  const dy2 = y2 - obb.y;
  const lx1 = dx1 * cos - dy1 * sin;
  const ly1 = dx1 * sin + dy1 * cos;
  const lx2 = dx2 * cos - dy2 * sin;
  const ly2 = dx2 * sin + dy2 * cos;

  const minX = -(obb.halfLength + pad);
  const maxX = obb.halfLength + pad;
  const minY = -(obb.halfWidth + pad);
  const maxY = obb.halfWidth + pad;

  let t0 = 0;
  let t1 = 1;
  const ddx = lx2 - lx1;
  const ddy = ly2 - ly1;

  const slabs = [
    [-ddx, lx1 - minX],
    [ddx, maxX - lx1],
    [-ddy, ly1 - minY],
    [ddy, maxY - ly1],
  ];
  for (const [p, q] of slabs) {
    if (Math.abs(p) < 1e-8) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return t0 <= t1;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpPt(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function easeOutCubic(t) {
  const u = 1 - Math.max(0, Math.min(1, t));
  return 1 - u * u * u;
}

export class GermanSoldier {
  constructor(id, x, y, angle, options = {}) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.baseAngle = angle;
    this.angle = angle;
    this.scale = CONFIG.TANK.SCALE;

    this.faction = options.faction || 'german'; // 'german' | 'soviet'
    this.uniformStyle = options.uniformStyle || 'infantry'; // 'infantry' | 'tanker'
    this.wounded = Boolean(options.wounded);
    this.isPlayerControlled = Boolean(options.isPlayerControlled);
    this.crewRole = options.crewRole || null;
    this.inVehicle = Boolean(options.inVehicle);
    this.isOfficer = Boolean(options.isOfficer);
    this.isHmgOperator = Boolean(options.isHmgOperator);
    this.hmgEmplacement = options.hmgEmplacement || null;
    this.isArtilleryCrew = Boolean(options.isArtilleryCrew);
    this.artilleryRole = options.artilleryRole || null;
    this.artilleryGun = options.artilleryGun || null;
    this.assaultOrder = options.assaultOrder || null;
    this._playerVx = 0;
    this._playerVy = 0;
    this._mouseWasDown = false;
    this.moveTarget = options.moveTarget || null;
    this.moveSpeed = this.wounded ? 28 : 54;

    this.hitboxRadius = 11.5 * this.scale;
    this.state = SOLDIER_STATE.ALIVE;
    this.aiState = this.moveTarget ? AI_STATE.RETREATING : AI_STATE.IDLE;
    this.hp = options.hp !== undefined ? options.hp : (this.wounded ? 10 : 20);
    this.injurySeverity = 0;
    this.bleedRate = 0;
    this.woundedTime = 0;
    this._bleedPoolTimer = 0;
    this._woundedFallProgress = 0;
    this._deadFallProgress = 0;
    this._woundedBloodSpawned = false;
    this._finalBloodSpawned = false;

    // Tactical cover AI state (periodic scan to avoid scanning every frame)
    this._aiScanTimer = (id % 5) * 0.05;
    this._aiScanInterval = 0.25;
    this._coverSlotPos = null;
    this._coverTank = null;
    this._aiWaypoints = [];
    this._peekTimer = 0;
    this._movePhase = 0;
    this._threatAngle = angle;

    // Individual Weapon Assignment: explicit weaponId, else Soviet Tanker -> PPSh-41; Soviet Inf -> Mosin; German -> Kar98k
    if (options.weaponId && RIFLE_WEAPONS[options.weaponId]) {
      this.weaponCfg = RIFLE_WEAPONS[options.weaponId];
    } else if (this.faction === 'soviet') {
      this.weaponCfg = this.uniformStyle === 'tanker' ? RIFLE_WEAPONS.PPSH_41 : RIFLE_WEAPONS.MOSIN_1891_30;
    } else {
      this.weaponCfg = RIFLE_WEAPONS.KAR98K;
    }
    this.customBattleMode = Boolean(options.customBattleMode);
    if (this.customBattleMode && (this.weaponCfg.id === 'KAR98K' || this.weaponCfg.id === 'MOSIN_1891_30')) {
      this.weaponCfg = { ...this.weaponCfg, visualRangeMeters: 215 };
    }
    this.magAmmo = this.weaponCfg.magCapacity;
    this.reserveAmmo = this.weaponCfg.reserveDefault;
    this.inventory = createSoldierInventory(this, options.inventory || {});
    this._combatTarget = null;
    this._combatTimer = 0;
    this._reloadStepTimer = 0;
    this._boltPhase = 0;
    this._reloadPhase = 0;
    this._drumReloadProgress = 0;
    this._reloadCueStep = 0;
    this._autoFireTimer = 0;
    this._burstRemaining = 0;
    this._aimRaise = 0;
    this._recoilKick = 0;
    const detMeters = this.customBattleMode
      ? Math.max(this.weaponCfg.visualRangeMeters * 1.16, 245)
      : this.weaponCfg.visualRangeMeters;
    this.detection = new DetectionTracker({
      detectionRangePx: detMeters * CONFIG.TANK.PIXELS_PER_METER,
      peripheralRangePx: 210,
      fovHalfAngle: Math.PI * 0.46,
      acquireDelay: 0.55,
      confirmDelay: 0.35,
      loseSightDelay: 1.8,
      searchDuration: 5.0,
    });

    this._idlePhase = Math.random() * Math.PI * 2;
    this._idleSpeed = 1.2 + Math.random() * 0.7;

    // Hit reaction state
    this._hitTimer = 0;
    this._hitDuration = 0.22;
    this._hitTwist = 0;
    this._hitRecoilX = 0;

    // Contextual human behavior & morale state
    this.behaviorState = this.wounded ? BEHAVIOR_STATE.WOUNDED : BEHAVIOR_STATE.IDLE;
    this.morale = 1.0;
    this._behaviorTimer = 0;
    this._voiceCooldown = Math.random() * 1.5;
    this._socialPartner = null;
    this._pendingChatReplyTimer = 0;
    this._lastVoiceCtx = null;
    this._hitRecoilY = 0;

    // Falling & death pose state
    this._fallProgress = 0;
    this._fallDuration = 0.44;
    this._fallDir = id % 2 === 0 ? 1 : -1;
    this._deathSeed = ((id * 1.6180339) % 1);
    this._fallAngleOffset = (this._deathSeed - 0.5) * 0.55;
    this._fallSlideX = 0;
    this._fallSlideY = 0;
    this._bloodSpawned = false;

    // 2D Ragdoll & ejected rifle state (triggered by 85mm cannon blast)
    this._ragdollPose = false;
    this._ragVx = 0;
    this._ragVy = 0;
    this._ragAngVel = 0;
    this._limbs = {
      lArm: { angle: 0, angVel: 0, min: -1.1, max: 0.9 },
      rArm: { angle: 0, angVel: 0, min: -0.9, max: 1.1 },
      lLeg: { angle: 0, angVel: 0, min: -0.75, max: 0.65 },
      rLeg: { angle: 0, angVel: 0, min: -0.65, max: 0.75 },
      head: { angle: 0, angVel: 0, min: -0.45, max: 0.45 },
    };
    this._rifle = {
      active: false,
      settled: false,
      x: x,
      y: y,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      angle: angle,
      angVel: 0,
    };

    // Pre-allocated separated body parts for direct 85mm cannon dismemberment (zero GC)
    this._dismembered = false;
    this._debrisParts = [
      { kind: 'torso', x, y, z: 0, vx: 0, vy: 0, vz: 0, angle: 0, angVel: 0, settled: true },
      { kind: 'helmet', x, y, z: 0, vx: 0, vy: 0, vz: 0, angle: 0, angVel: 0, settled: true },
      { kind: 'arm', x, y, z: 0, vx: 0, vy: 0, vz: 0, angle: 0, angVel: 0, settled: true },
      { kind: 'arm', x, y, z: 0, vx: 0, vy: 0, vz: 0, angle: 0, angVel: 0, settled: true },
      { kind: 'leg', x, y, z: 0, vx: 0, vy: 0, vz: 0, angle: 0, angVel: 0, settled: true },
      { kind: 'leg', x, y, z: 0, vx: 0, vy: 0, vz: 0, angle: 0, angVel: 0, settled: true },
    ];
  }

  get alive() {
    return (
      this.state === SOLDIER_STATE.ALIVE ||
      this.state === SOLDIER_STATE.HIT ||
      this.state === SOLDIER_STATE.FALLING_WOUNDED ||
      this.state === SOLDIER_STATE.WOUNDED_IDLE
    );
  }

  get combatCapable() {
    return this.state === SOLDIER_STATE.ALIVE || this.state === SOLDIER_STATE.HIT;
  }

  containsPoint(px, py) {
    if (!this.alive) return false;
    const dx = px - this.x;
    const dy = py - this.y;
    return dx * dx + dy * dy <= this.hitboxRadius * this.hitboxRadius;
  }

  _enterSecondCollapse(particles, dirX = 0, dirY = 0, weaponType = 'mg', blastInfo = null) {
    this._cancelReloadAudio(this._lastVoiceCtx?.sound);
    this.hp = 0;
    this.behaviorState = BEHAVIOR_STATE.DEAD;
    this._pendingChatReplyTimer = 0;
    this._socialPartner = null;
    this._combatTarget = null;
    this.moveTarget = null;
    this.commandOrder = null;

    const intensity = blastInfo && Number.isFinite(blastInfo.intensity) ? blastInfo.intensity : 1.0;
    const isDirect = Boolean(blastInfo && blastInfo.isDirect);
    if (weaponType === 'cannon' && (isDirect || intensity >= 0.42)) {
      if (isDirect) {
        this._triggerDismemberment(Math.atan2(dirY, dirX), particles);
      } else {
        this._triggerRagdoll(Math.atan2(dirY, dirX), intensity, isDirect);
      }
      return true;
    }

    if (this._lastVoiceCtx) {
      this._lastVoiceCtx.voiceSystem?.requestVoice?.(
        this,
        'PAIN_DEATH',
        1,
        this._lastVoiceCtx.lx,
        this._lastVoiceCtx.ly,
        this._lastVoiceCtx.env
      );
    }

    if (this.state === SOLDIER_STATE.FALLING_WOUNDED || this.state === SOLDIER_STATE.WOUNDED_IDLE) {
      this.state = SOLDIER_STATE.FALLING_DEAD;
      this._deadFallProgress = 0;
      this._finalBloodSpawned = false;
    } else {
      this.state = SOLDIER_STATE.FALLING;
      this._fallProgress = 0;
    }
    const slideDist = weaponType === 'cannon' ? 5.5 + intensity * 9.5 : (weaponType === 'crush' ? 3.5 : 4.5);
    this._fallSlideX = dirX * slideDist;
    this._fallSlideY = dirY * slideDist;
    return true;
  }

  takeDamage(dmg, particles, hitX = this.x, hitY = this.y, impactAngle = null, weaponType = 'mg', blastInfo = null) {
    if (
      this.state === SOLDIER_STATE.FALLING ||
      this.state === SOLDIER_STATE.FALLING_DEAD ||
      this.state === SOLDIER_STATE.RAGDOLL ||
      this.state === SOLDIER_STATE.DEAD
    ) {
      return false;
    }

    let dirX;
    let dirY;
    if (impactAngle !== null && Number.isFinite(impactAngle)) {
      dirX = Math.cos(impactAngle);
      dirY = Math.sin(impactAngle);
    } else {
      const dx = this.x - hitX;
      const dy = this.y - hitY;
      const len = Math.hypot(dx, dy);
      if (len > 0.001) {
        dirX = dx / len;
        dirY = dy / len;
      } else {
        dirX = -Math.cos(this.angle);
        dirY = -Math.sin(this.angle);
      }
    }

    const category = classifyDamageCategory(weaponType, blastInfo);
    const prevHp = this.hp;
    this.hp -= dmg;

    if (particles) {
      const splatAngle = Math.atan2(dirY, dirX);
      const bloodCount = weaponType === 'cannon' ? 7 : (weaponType === 'crush' ? 4 : 5);
      particles.spawnBloodSplatter(hitX, hitY, splatAngle, bloodCount);
      if (weaponType === 'crush') {
        particles.spawnTrackDust(this.x, this.y, 0, 0, 0.45, false);
      }
    }

    // Already WOUNDED -> any lethal hit triggers SECOND COLLAPSE -> DEAD
    if (this.state === SOLDIER_STATE.FALLING_WOUNDED || this.state === SOLDIER_STATE.WOUNDED_IDLE) {
      if (this.hp <= 0) {
        return this._enterSecondCollapse(particles, dirX, dirY, weaponType, blastInfo);
      }
      this.bleedRate = Math.min(2.5, this.bleedRate + 0.35);
      return false;
    }

    // Two-stage collapse applies ONLY to serious survivable SMALL_ARMS_DAMAGE
    if (category === DAMAGE_CATEGORY.SMALL_ARMS_DAMAGE) {
      const isSeriousSurvivable =
        dmg >= CASUALTY_CONFIG.SEVERE_SMALL_ARMS_HIT_MIN &&
        dmg < CASUALTY_CONFIG.OVERWHELMING_SMALL_ARMS_DMG &&
        this.hp <= CASUALTY_CONFIG.WOUNDED_HP_THRESHOLD &&
        this.hp > -5;

      if (isSeriousSurvivable) {
        this._cancelReloadAudio(this._lastVoiceCtx?.sound);
        this.hp = Math.max(3, Math.min(8, Math.round(prevHp - dmg * 0.65)));
        this.wounded = true;
        this.injurySeverity = clamp(dmg / 15, 0.7, 1.5);
        this.bleedRate = CASUALTY_CONFIG.BLEED_RATE_PER_SEC * this.injurySeverity;
        this.woundedTime = 0;
        this._bleedPoolTimer = 0.6;
        this._woundedFallProgress = 0;
        this._woundedBloodSpawned = false;
        this.state = SOLDIER_STATE.FALLING_WOUNDED;
        this.behaviorState = BEHAVIOR_STATE.WOUNDED;
        this._pendingChatReplyTimer = 0;
        this._socialPartner = null;
        this._combatTarget = null;
        this.moveTarget = null;
        this._fallSlideX = dirX * 3.2;
        this._fallSlideY = dirY * 3.2;
        this.morale = Math.max(0.1, this.morale - 0.45);
        if (this._lastVoiceCtx) {
          this._lastVoiceCtx.voiceSystem?.requestVoice?.(
            this,
            'WOUNDED_DISTRESS',
            1,
            this._lastVoiceCtx.lx,
            this._lastVoiceCtx.ly,
            this._lastVoiceCtx.env
          );
        }
        return false; // Still alive (WOUNDED), not dead yet
      }

      if (this.hp <= 0) {
        return this._enterSecondCollapse(particles, dirX, dirY, weaponType, blastInfo);
      }
    } else {
      // Heavy projectile / Artillery blast / Crushing -> immediate death when lethal (never WOUNDED stage)
      if (this.hp <= 0) {
        return this._enterSecondCollapse(particles, dirX, dirY, weaponType, blastInfo);
      }
    }

    // Minor / moderate non-lethal hit reaction (remains operational)
    this.state = SOLDIER_STATE.HIT;
    this._hitTimer = this._hitDuration;
    this.morale = Math.max(0.15, this.morale - (this.hp <= 8 ? 0.35 : 0.18));
    if (this.hp <= 8) {
      this.wounded = true;
      this.behaviorState = BEHAVIOR_STATE.WOUNDED;
    } else {
      this.behaviorState = BEHAVIOR_STATE.ALERT;
      this._behaviorTimer = 2.0;
    }
    this._pendingChatReplyTimer = 0;
    this._socialPartner = null;
    if (this._lastVoiceCtx) {
      this._lastVoiceCtx.voiceSystem?.requestVoice?.(
        this,
        this.hp <= 8 ? 'PAIN_SERIOUS' : 'PAIN_MINOR',
        1,
        this._lastVoiceCtx.lx,
        this._lastVoiceCtx.ly,
        this._lastVoiceCtx.env
      );
    }
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    this._hitRecoilX = Math.max(-3.6, Math.min(3.6, (dirX * cos + dirY * sin) * 3.2));
    this._hitRecoilY = Math.max(-3.0, Math.min(3.0, (-dirX * sin + dirY * cos) * 2.6));
    const cross = cos * dirY - sin * dirX;
    this._hitTwist = Math.max(-0.5, Math.min(0.5, cross * 0.65));
    return false;
  }

  _triggerDismemberment(impactAngle, particles) {
    this.state = SOLDIER_STATE.RAGDOLL;
    this._dismembered = true;
    this._ragdollPose = true;

    const spreadOffsets = [0.05, -0.35, -0.75, 0.72, -0.52, 0.48];
    const speedBases = [145, 210, 175, 180, 130, 140];
    const vzBases = [55, 115, 85, 90, 60, 65];

    for (let i = 0; i < this._debrisParts.length; i++) {
      const p = this._debrisParts[i];
      const a = impactAngle + spreadOffsets[i] + (Math.random() - 0.5) * 0.35;
      const spd = speedBases[i] * (0.85 + Math.random() * 0.3);
      p.x = this.x + (Math.random() - 0.5) * 6;
      p.y = this.y + (Math.random() - 0.5) * 6;
      p.z = 5 + Math.random() * 4;
      p.vx = Math.cos(a) * spd;
      p.vy = Math.sin(a) * spd;
      p.vz = vzBases[i] + Math.random() * 30;
      p.angle = this.angle + (Math.random() - 0.5) * 1.4;
      p.angVel = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 9);
      p.settled = false;
    }

    // Eject Kar98k rifle independently
    const rifleAngle = impactAngle + (Math.random() - 0.5) * 0.85;
    const rifleSpeed = 230 + Math.random() * 90;
    this._rifle.active = true;
    this._rifle.settled = false;
    this._rifle.x = this.x;
    this._rifle.y = this.y;
    this._rifle.z = 7;
    this._rifle.vx = Math.cos(rifleAngle) * rifleSpeed;
    this._rifle.vy = Math.sin(rifleAngle) * rifleSpeed;
    this._rifle.vz = 95 + Math.random() * 35;
    this._rifle.angle = this.angle;
    this._rifle.angVel = (Math.random() < 0.5 ? -1 : 1) * 11;

    if (particles && !this._bloodSpawned) {
      this._bloodSpawned = true;
      particles.spawnBloodPool(this.x, this.y, impactAngle, 10);
    }
  }

  _triggerRagdoll(blastAngle, intensity, isDirect) {
    this.state = SOLDIER_STATE.RAGDOLL;
    this._ragdollPose = true;

    const jitterAngle = blastAngle + (Math.random() - 0.5) * 0.42;
    const power = clamp(isDirect ? 1.0 : intensity, 0.35, 1.0);
    const launchSpeed = (105 + power * 185) * (0.88 + Math.random() * 0.24);

    this._ragVx = Math.cos(jitterAngle) * launchSpeed;
    this._ragVy = Math.sin(jitterAngle) * launchSpeed;
    this._ragAngVel = (Math.random() < 0.5 ? -1 : 1) * (3.2 + power * 6.0);

    // Independent joint impulses for arms, legs, and head
    for (const key of Object.keys(this._limbs)) {
      const limb = this._limbs[key];
      limb.angle = (Math.random() - 0.5) * 0.25;
      limb.angVel = (Math.random() - 0.5) * (6.0 + power * 9.0);
    }

    // Eject Kar98k rifle from hands
    const rifleAngle = blastAngle + (Math.random() - 0.5) * 0.95;
    const rifleSpeed = (135 + power * 195) * (0.85 + Math.random() * 0.3);
    this._rifle.active = true;
    this._rifle.settled = false;
    this._rifle.x = this.x + Math.cos(this.angle) * 6;
    this._rifle.y = this.y + Math.sin(this.angle) * 6;
    this._rifle.z = 6;
    this._rifle.vx = Math.cos(rifleAngle) * rifleSpeed;
    this._rifle.vy = Math.sin(rifleAngle) * rifleSpeed;
    this._rifle.vz = 55 + power * 65;
    this._rifle.angle = this.angle;
    this._rifle.angVel = (Math.random() < 0.5 ? -1 : 1) * (6.5 + power * 8.5);
  }

  _keepClearOfTargets(px, py, radius, targets) {
    let x = clamp(px, CONFIG.WORLD.BORDER_PADDING, CONFIG.WORLD.WIDTH - CONFIG.WORLD.BORDER_PADDING);
    let y = clamp(py, CONFIG.WORLD.BORDER_PADDING, CONFIG.WORLD.HEIGHT - CONFIG.WORLD.BORDER_PADDING);
    for (const t of targets) {
      if (!t || typeof t.getOBB !== 'function') continue;
      const obb = t.getOBB();
      const cos = Math.cos(obb.angle);
      const sin = Math.sin(obb.angle);
      const dx = x - obb.x;
      const dy = y - obb.y;
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      const cx = clamp(lx, -obb.halfLength, obb.halfLength);
      const cy = clamp(ly, -obb.halfWidth, obb.halfWidth);
      const diffX = lx - cx;
      const diffY = ly - cy;
      const distSq = diffX * diffX + diffY * diffY;
      if (distSq < radius * radius) {
        const dist = Math.sqrt(distSq);
        let lnx = 0;
        let lny = 0;
        let overlap = 0;
        if (dist > 0.001) {
          lnx = diffX / dist;
          lny = diffY / dist;
          overlap = radius - dist;
        } else {
          lnx = lx >= 0 ? 1 : -1;
          overlap = obb.halfLength - Math.abs(lx) + radius;
        }
        x += (lnx * cos - lny * sin) * overlap;
        y += (lnx * sin + lny * cos) * overlap;
      }
    }
    return { x, y };
  }

  _isSegmentClear(x1, y1, x2, y2, tanks, environment, pad) {
    for (const t of tanks) {
      if (!t || typeof t.getOBB !== 'function') continue;
      if (segmentIntersectsOBB(x1, y1, x2, y2, t.getOBB(), pad)) return false;
    }
    if (environment && environment.obstacles) {
      for (const o of environment.obstacles) {
        if (o.kind !== 'large_tree' || o.state === 'FALLEN') continue;
        // Quick segment-vs-circle check
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        const proj = lenSq > 0 ? clamp(((o.x - x1) * dx + (o.y - y1) * dy) / lenSq, 0, 1) : 0;
        const px = x1 + proj * dx;
        const py = y1 + proj * dy;
        if (Math.hypot(o.x - px, o.y - py) < o.trunkRadius + pad) return false;
      }
    }
    return true;
  }

  _computePathAroundTanks(startX, startY, goalX, goalY, tanks, environment) {
    const pad = this.hitboxRadius + 5;
    if (this._isSegmentClear(startX, startY, goalX, goalY, tanks, environment, pad * 0.75)) {
      return [{ x: goalX, y: goalY }];
    }

    // Find the primary blocking tank and build left/right perimeter routes around its OBB
    let blockingOBB = null;
    for (const t of tanks) {
      if (!t || typeof t.getOBB !== 'function') continue;
      const obb = t.getOBB();
      if (segmentIntersectsOBB(startX, startY, goalX, goalY, obb, pad * 0.75)) {
        blockingOBB = obb;
        break;
      }
    }
    if (!blockingOBB) return [{ x: goalX, y: goalY }];

    const cPad = pad + 12;
    const hl = blockingOBB.halfLength + cPad;
    const hw = blockingOBB.halfWidth + cPad;
    const cos = Math.cos(blockingOBB.angle);
    const sin = Math.sin(blockingOBB.angle);
    const toW = (lx, ly) => ({
      x: clamp(blockingOBB.x + lx * cos - ly * sin, CONFIG.WORLD.BORDER_PADDING, CONFIG.WORLD.WIDTH - CONFIG.WORLD.BORDER_PADDING),
      y: clamp(blockingOBB.y + lx * sin + ly * cos, CONFIG.WORLD.BORDER_PADDING, CONFIG.WORLD.HEIGHT - CONFIG.WORLD.BORDER_PADDING),
    });

    const fl = toW(hl, -hw);
    const rl = toW(-hl, -hw);
    const fr = toW(hl, hw);
    const rr = toW(-hl, hw);
    const sl = toW(0, -hw);
    const sr = toW(0, hw);
    const fc = toW(hl, 0);
    const rc = toW(-hl, 0);

    const candidateRoutes = [
      [fl, rl, { x: goalX, y: goalY }],
      [rl, fl, { x: goalX, y: goalY }],
      [fr, rr, { x: goalX, y: goalY }],
      [rr, fr, { x: goalX, y: goalY }],
      [sl, { x: goalX, y: goalY }],
      [sr, { x: goalX, y: goalY }],
      [fc, { x: goalX, y: goalY }],
      [rc, { x: goalX, y: goalY }],
      [fl, { x: goalX, y: goalY }],
      [rl, { x: goalX, y: goalY }],
      [fr, { x: goalX, y: goalY }],
      [rr, { x: goalX, y: goalY }],
    ];

    let bestRoute = null;
    let bestLen = Infinity;
    for (const route of candidateRoutes) {
      let valid = true;
      let totalLen = 0;
      let px = startX;
      let py = startY;
      for (const wp of route) {
        if (!this._isSegmentClear(px, py, wp.x, wp.y, tanks, environment, pad * 0.6)) {
          valid = false;
          break;
        }
        totalLen += Math.hypot(wp.x - px, wp.y - py);
        px = wp.x;
        py = wp.y;
      }
      if (valid && totalLen < bestLen) {
        bestLen = totalLen;
        bestRoute = route;
      }
    }
    return bestRoute || null;
  }

  _hasClearShot(targetX, targetY, tanks, infantry, environment) {
    // 1. Large trees block LOS
    if (environment && environment.obstacles) {
      for (const o of environment.obstacles) {
        if (o.kind !== 'large_tree' || o.state === 'FALLEN') continue;
        const dx = targetX - this.x;
        const dy = targetY - this.y;
        const lenSq = dx * dx + dy * dy;
        const proj = lenSq > 0 ? clamp(((o.x - this.x) * dx + (o.y - this.y) * dy) / lenSq, 0, 1) : 0;
        const px = this.x + proj * dx;
        const py = this.y + proj * dy;
        if (Math.hypot(o.x - px, o.y - py) < o.trunkRadius) return false;
      }
    }
    // 2. Friendly tanks block LOS (prevent shooting through friendly armor)
    for (const t of tanks) {
      if (!t || t.faction !== this.faction || typeof t.getOBB !== 'function') continue;
      if (segmentIntersectsOBB(this.x, this.y, targetX, targetY, t.getOBB(), 2)) return false;
    }
    // 3. Friendly infantry block LOS (prevent friendly fire)
    for (const other of infantry) {
      if (other === this || !other.alive || other.faction !== this.faction) continue;
      const dx = targetX - this.x;
      const dy = targetY - this.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1) continue;
      const proj = ((other.x - this.x) * dx + (other.y - this.y) * dy) / lenSq;
      if (proj <= 0.05 || proj >= 0.95) continue;
      const px = this.x + proj * dx;
      const py = this.y + proj * dy;
      if (Math.hypot(other.x - px, other.y - py) < other.hitboxRadius + 4) return false;
    }
    return true;
  }

  _isTargetValid(tgt, infantry, allowTank = false) {
    if (!tgt || tgt.alive === false || tgt.inVehicle === true || tgt.destroyed || tgt.damageSystem?.vehicleDestroyed) {
      return false;
    }
    if (typeof tgt.getOBB === 'function') {
      if (!allowTank) return false;
      if (tgt.damageSystem?.vehicleAbandoned || tgt.vehicleState === 'BURNING' || tgt.vehicleState === 'BURNT_OUT') {
        return false;
      }
      return true;
    }
    return !Array.isArray(infantry) || infantry.includes(tgt);
  }

  _findRepositionPointForLOS(enemyPos, tanks, infantry, environment) {
    if (!enemyPos) return null;
    const baseAng = Math.atan2(enemyPos.y - this.y, enemyPos.x - this.x);
    const stepDists = [65, 110, 155];
    const sideAngles = [Math.PI * 0.45, -Math.PI * 0.45, Math.PI * 0.25, -Math.PI * 0.25, 0];
    for (const d of stepDists) {
      for (const off of sideAngles) {
        const ang = baseAng + off;
        const cx = clamp(this.x + Math.cos(ang) * d, CONFIG.WORLD.BORDER_PADDING, CONFIG.WORLD.WIDTH - CONFIG.WORLD.BORDER_PADDING);
        const cy = clamp(this.y + Math.sin(ang) * d, CONFIG.WORLD.BORDER_PADDING, CONFIG.WORLD.HEIGHT - CONFIG.WORLD.BORDER_PADDING);
        const cleared = this._keepClearOfTargets(cx, cy, this.hitboxRadius + 4, tanks);
        let blocked = false;
        if (environment && environment.obstacles) {
          for (const o of environment.obstacles) {
            if (o.kind === 'large_tree' && o.state !== 'FALLEN' && Math.hypot(cleared.x - o.x, cleared.y - o.y) < o.trunkRadius + 12) {
              blocked = true;
              break;
            }
          }
        }
        if (blocked) continue;
        // Check if from (cleared.x, cleared.y) we have LOS to enemyPos
        const savedX = this.x;
        const savedY = this.y;
        this.x = cleared.x;
        this.y = cleared.y;
        const hasShot = this._hasClearShot(enemyPos.x, enemyPos.y, tanks, infantry, environment);
        this.x = savedX;
        this.y = savedY;
        if (hasShot) {
          const path = this._computePathAroundTanks(this.x, this.y, cleared.x, cleared.y, tanks, environment);
          if (path && path.length > 0) return { pos: cleared, path };
        }
      }
    }
    return null;
  }

  _findHostileTarget(tanks, infantry, environment, combatEnabled = false) {
    const maxRange = this.weaponCfg.visualRangeMeters * CONFIG.TANK.PIXELS_PER_METER;
    const canEngageTank = Boolean(this.weaponCfg?.antiVehicle);

    if (combatEnabled && this.detection) {
      if (this.detection.state !== DETECTION_STATE.ENGAGING || !this.detection.target) {
        return null;
      }
      const t = this.detection.target;
      if (this._isTargetValid(t, infantry, canEngageTank)) {
        const d = Math.hypot(t.x - this.x, t.y - this.y);
        if (d <= maxRange && this._hasClearShot(t.x, t.y, tanks, infantry, environment)) {
          return t;
        }
      }
      // If detection locked onto a non-engageable tank or blocked target, check visible hostile infantry
      let bestVis = null;
      let bestVisTier = Infinity;
      let bestVisDist = Infinity;
      for (const other of infantry) {
        if (!other.alive || other.inVehicle || other.faction === this.faction) continue;
        const d = Math.hypot(other.x - this.x, other.y - this.y);
        if (d > maxRange) continue;
        if (!this.detection._canSeeCandidate(this.x, this.y, this.angle, other, environment)) continue;
        if (!this._hasClearShot(other.x, other.y, tanks, infantry, environment)) continue;
        const tier = other.combatCapable === false ? 1 : 0;
        if (tier < bestVisTier || (tier === bestVisTier && d < bestVisDist)) {
          bestVisTier = tier;
          bestVisDist = d;
          bestVis = other;
        }
      }
      return bestVis;
    }

    let bestInf = null;
    let bestInfTier = Infinity;
    let bestInfDist = Infinity;
    for (const other of infantry) {
      if (!other.alive || other.inVehicle || other.faction === this.faction) continue;
      const d = Math.hypot(other.x - this.x, other.y - this.y);
      if (d <= maxRange && this._hasClearShot(other.x, other.y, tanks, infantry, environment)) {
        const tier = other.combatCapable === false ? 1 : 0;
        if (tier < bestInfTier || (tier === bestInfTier && d < bestInfDist)) {
          bestInfTier = tier;
          bestInfDist = d;
          bestInf = other;
        }
      }
    }
    if (bestInf) return bestInf;

    if (!canEngageTank) return null;

    let bestTank = null;
    let bestTankDist = Infinity;
    for (const t of tanks) {
      if (!this._isTargetValid(t, infantry, true)) continue;
      if (t.faction === this.faction) continue;
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (d <= maxRange && d < bestTankDist && this._hasClearShot(t.x, t.y, tanks, infantry, environment)) {
        bestTankDist = d;
        bestTank = t;
      }
    }
    return bestTank;
  }

  _cancelReloadAudio(sound) {
    if (this._activeReloadKey) {
      sound?.stopReloadSound?.(this._activeReloadKey);
      this._activeReloadKey = null;
    }
    this._reloadCueStep = 0;
  }

  _startReload(sound, listenerX, listenerY) {
    if (
      !this.alive ||
      this.aiState === AI_STATE.RELOADING ||
      this.magAmmo >= this.weaponCfg.magCapacity ||
      this.reserveAmmo <= 0
    ) {
      return false;
    }
    this.aiState = AI_STATE.RELOADING;
    this._autoFireTimer = 0;
    this._reloadPhase = 0;
    this._drumReloadProgress = 0;
    this._reloadCueStep = 0;
    this._reloadSeqId = (this._reloadSeqId || 0) + 1;
    this._activeReloadKey = `inf_${this.id}_${this._reloadSeqId}`;

    if (this.weaponCfg.reloadMethod === 'drum_mag') {
      this._combatTimer = this.weaponCfg.reloadTime || 2.35;
      sound?.playPPShMech?.('mag_out', this.x, this.y, listenerX, listenerY, this._activeReloadKey);
      this._reloadCueStep = 1;
    } else {
      this._reloadStepTimer = -this.weaponCfg.clipInsertTime;
      const needed = Math.min(this.weaponCfg.magCapacity - this.magAmmo, this.reserveAmmo);
      this._combatTimer = this.weaponCfg.clipInsertTime + needed * this.weaponCfg.reloadPerRoundTime + 0.05;
      sound?.playRifleReloadStage?.('bolt_open', this.weaponCfg.id, this.x, this.y, listenerX, listenerY, this._activeReloadKey);
      this._reloadCueStep = 1;
    }
    return true;
  }

  _stepReload(dt, speedMult, sound, listenerX, listenerY) {
    if (!this.alive || this.isBoardingVehicle) {
      this._cancelReloadAudio(sound);
      return true;
    }
    this._aimRaise = Math.max(0, this._aimRaise - dt * 3);
    this._reloadPhase += dt * 4.5 * speedMult;
    this._combatTimer -= dt * speedMult;
    const rk = this._activeReloadKey || `inf_${this.id}`;

    if (this.weaponCfg.reloadMethod === 'drum_mag') {
      const total = this.weaponCfg.reloadTime || 2.35;
      this._drumReloadProgress = clamp(1 - this._combatTimer / total, 0, 1);
      if (this._reloadCueStep === 1 && this._drumReloadProgress >= 0.62) {
        sound?.playPPShMech?.('mag_in', this.x, this.y, listenerX, listenerY, rk);
        this._reloadCueStep = 2;
      }
      if (this._combatTimer <= 0) {
        const loadAmt = Math.min(this.weaponCfg.magCapacity - this.magAmmo, this.reserveAmmo);
        this.magAmmo += loadAmt;
        this.reserveAmmo -= loadAmt;
        this._drumReloadProgress = 0;
        this._reloadPhase = 0;
        this._reloadCueStep = 0;
        if (loadAmt > 0) {
          sound?.playPPShMech?.('bolt_rack', this.x, this.y, listenerX, listenerY, rk);
        }
        this._activeReloadKey = null;
        return true;
      }
      return false;
    }

    // Bolt-action stripper clip reload (rounds inserted 1 by 1 with synchronized audio)
    const prevTimer = this._reloadStepTimer;
    this._reloadStepTimer += dt * speedMult;
    if (prevTimer < 0 && this._reloadStepTimer >= 0 && this._reloadCueStep === 1) {
      this._reloadCueStep = 2;
      sound?.playRifleReloadStage?.('clip_insert', this.weaponCfg.id, this.x, this.y, listenerX, listenerY, rk);
    }
    if (
      this._reloadStepTimer >= this.weaponCfg.reloadPerRoundTime &&
      this.magAmmo < this.weaponCfg.magCapacity &&
      this.reserveAmmo > 0
    ) {
      this._reloadStepTimer -= this.weaponCfg.reloadPerRoundTime;
      this.magAmmo += 1;
      this.reserveAmmo -= 1;
      sound?.playRifleReloadStage?.('clip_round', this.weaponCfg.id, this.x, this.y, listenerX, listenerY, rk);
    }
    if (this.magAmmo >= this.weaponCfg.magCapacity || this.reserveAmmo <= 0 || this._combatTimer <= 0) {
      this._reloadPhase = 0;
      if (this._reloadCueStep === 2) {
        sound?.playRifleReloadStage?.('clip_eject', this.weaponCfg.id, this.x, this.y, listenerX, listenerY, rk);
      }
      this._reloadCueStep = 0;
      sound?.playRifleReloadStage?.('bolt_close', this.weaponCfg.id, this.x, this.y, listenerX, listenerY, rk);
      this._activeReloadKey = null;
      return true;
    }
    return false;
  }

  _stepBoltCycleAudio(sound, listenerX, listenerY) {
    const rk = `bolt_${this.id}`;
    if (this._boltCueStep === 0 && this._boltPhase >= 0.08) {
      this._boltCueStep = 1;
      sound?.playBoltActionStage?.('bolt_lift_pull', this.weaponCfg.id, this.x, this.y, listenerX, listenerY, rk);
    } else if (this._boltCueStep === 1 && this._boltPhase >= 0.40) {
      this._boltCueStep = 2;
      sound?.playBoltActionStage?.('casing_eject', this.weaponCfg.id, this.x, this.y, listenerX, listenerY, rk);
    } else if (this._boltCueStep === 2 && this._boltPhase >= 0.72) {
      this._boltCueStep = 3;
      sound?.playBoltActionStage?.('bolt_push_lock', this.weaponCfg.id, this.x, this.y, listenerX, listenerY, rk);
    }
  }

  _fireWeaponRound(fireAngle, aiContext) {
    const {
      projectiles = null,
      particles = null,
      sound = null,
      listenerX = this.x,
      listenerY = this.y,
    } = aiContext;
    if (this.magAmmo <= 0 || !projectiles) return false;

    this.magAmmo -= 1;
    const isSMG = this.weaponCfg.action === 'full-auto';
    const muzzleDist = (isSMG ? 15.5 : 17) * this.scale;
    const mx = this.x + Math.cos(fireAngle) * muzzleDist;
    const my = this.y + Math.sin(fireAngle) * muzzleDist;

    projectiles.spawnRifleBullet(
      mx,
      my,
      fireAngle,
      this.weaponCfg.ammoId,
      this.faction,
      this.id,
      this.weaponCfg.projectileSpeed,
      this.weaponCfg.damage ?? 15
    );
    particles?.spawnMGMuzzleFlash?.(mx, my, fireAngle);
    const obstructed = Boolean(
      aiContext.environment &&
      typeof aiContext.environment.hasLineOfSight === 'function' &&
      !aiContext.environment.hasLineOfSight(listenerX, listenerY, mx, my)
    );
    if (isSMG) {
      sound?.playPPShShot?.(mx, my, listenerX, listenerY, obstructed);
      this._recoilKick = 0.44;
    } else {
      const inTrench = Boolean(aiContext.environment?.trenchSystem?.getTrenchStateAt?.(mx, my)?.inTrench);
      const envType = inTrench ? 'trench' : 'open';
      sound?.playRifleShot?.(this.weaponCfg.id, mx, my, listenerX, listenerY, obstructed, envType);
      this._recoilKick = 1.0;
    }
    aiContext.voiceSystem?.emitSoundEvent?.({
      x: mx,
      y: my,
      kind: isSMG ? 'mg' : 'rifle',
      faction: this.faction,
      radius: isSMG ? 360 : 320,
      soldiers: aiContext.infantry || [],
      environment: aiContext.environment || null,
      listenerX,
      listenerY,
    });
    return true;
  }

  _updateRifleCombat(dt, aiContext) {
    const {
      tanks = [],
      infantry = [],
      environment = null,
      projectiles = null,
      particles = null,
      sound = null,
      listenerX = this.x,
      listenerY = this.y,
      combatEnabled = false,
    } = aiContext;
    if (this._recoilKick > 0) {
      this._recoilKick = Math.max(0, this._recoilKick - dt * 12);
    }

    if (combatEnabled && this.detection) {
      const candidates = [];
      for (const other of infantry) {
        if (other.alive && !other.inVehicle && other.faction !== this.faction) candidates.push(other);
      }
      for (const t of tanks) {
        if (
          t &&
          t.faction !== this.faction &&
          !t.destroyed &&
          !t.damageSystem?.vehicleDestroyed &&
          !t.damageSystem?.vehicleAbandoned &&
          t.vehicleState !== 'BURNING' &&
          t.vehicleState !== 'BURNT_OUT'
        ) {
          candidates.push(t);
        }
      }
      this.detection.update(dt, {
        observerX: this.x,
        observerY: this.y,
        observerAngle: this.angle,
        candidates,
        environment,
        preferInfantry: true,
      });
    }

    if (this._combatTarget && !this._isTargetValid(this._combatTarget, infantry, Boolean(this.weaponCfg?.antiVehicle))) {
      this._combatTarget = null;
      this._aimRaise = 0;
    }

    const speedMult = this.wounded ? 0.65 : 1.0;

    // 1. Handle active RELOADING
    if (this.aiState === AI_STATE.RELOADING) {
      if (this._stepReload(dt, speedMult, sound, listenerX, listenerY)) {
        this.aiState = this._coverSlotPos ? AI_STATE.CROUCHING : AI_STATE.IDLE;
      }
      return true;
    }

    // 2. Handle active CYCLING_BOLT after firing a round
    if (this.aiState === AI_STATE.CYCLING_BOLT) {
      this._combatTimer -= dt * speedMult;
      this._boltPhase = 1 - Math.max(0, this._combatTimer / this.weaponCfg.boltCycleTime);
      this._stepBoltCycleAudio(sound, listenerX, listenerY);
      if (this._combatTimer <= 0) {
        this._boltPhase = 0;
        if (this.magAmmo <= 0 && this.reserveAmmo > 0) {
          this._startReload(sound, listenerX, listenerY);
        } else {
          this.aiState = this._coverSlotPos ? AI_STATE.CROUCHING : AI_STATE.IDLE;
        }
      }
      return true;
    }

    // Need magazine check before engaging
    if (this.magAmmo <= 0) {
      if (this.reserveAmmo > 0) {
        this._startReload(sound, listenerX, listenerY);
        return true;
      }
      return false; // Completely out of ammo
    }

    // Do not interrupt active retreating or cover movement until arrived
    if (
      this.aiState === AI_STATE.RETREATING ||
      this.aiState === AI_STATE.TAKING_COVER ||
      this.aiState === AI_STATE.WALKING ||
      this.aiState === AI_STATE.RUNNING
    ) {
      this._aimRaise = Math.max(0, this._aimRaise - dt * 4);
      return false;
    }

    // 3. Detect & engage hostile target if clear LOS
    if (this.aiState === AI_STATE.TURNING_TO_TARGET || this.aiState === AI_STATE.AIMING || this.aiState === AI_STATE.FIRING) {
      const tgt = this._combatTarget;
      const canEngageTank = Boolean(this.weaponCfg?.antiVehicle);
      const tgtInvalid = !this._isTargetValid(tgt, infantry, canEngageTank);
      if (tgtInvalid || !this._hasClearShot(tgt.x, tgt.y, tanks, infantry, environment)) {
        this._combatTarget = null;
        this._aimRaise = 0;
        this.aiState = this._coverSlotPos ? AI_STATE.CROUCHING : AI_STATE.IDLE;
        return false;
      }

      const targetAngle = Math.atan2(tgt.y - this.y, tgt.x - this.x);
      let diff = ((targetAngle - this.angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

      if (this.aiState === AI_STATE.TURNING_TO_TARGET) {
        const turnStep = 5.5 * speedMult * dt;
        if (Math.abs(diff) <= turnStep) {
          this.angle = targetAngle;
          this.baseAngle = targetAngle;
          this.aiState = AI_STATE.AIMING;
          this._combatTimer = this.weaponCfg.aimTime;
        } else {
          this.angle += Math.sign(diff) * turnStep;
          this.baseAngle = this.angle;
        }
        return true;
      }

      if (this.aiState === AI_STATE.AIMING) {
        this.angle = targetAngle;
        this.baseAngle = targetAngle;
        this._aimRaise = Math.min(1, this._aimRaise + dt * 4);
        this._combatTimer -= dt * speedMult;
        if (this._combatTimer <= 0) {
          this.aiState = AI_STATE.FIRING;
        }
        return true;
      }

      if (this.aiState === AI_STATE.FIRING) {
        if (this.weaponCfg.action === 'full-auto') {
          if (this._burstRemaining <= 0) this._burstRemaining = 4 + Math.floor(Math.random() * 3);
          this._autoFireTimer -= dt;
          if (this._autoFireTimer <= 0 && this.magAmmo > 0 && projectiles) {
            this._autoFireTimer += this.weaponCfg.shotInterval;
            const isCrouched = Boolean(this._coverSlotPos);
            const stanceMod = isCrouched ? 0.72 : 1.15;
            const woundMod = this.wounded ? 1.8 : 1.0;
            const spread = (Math.random() - 0.5) * 2 * this.weaponCfg.baseSpreadRad * stanceMod * woundMod;
            this._fireWeaponRound(targetAngle + spread, aiContext);
            this._burstRemaining -= 1;
          }
          if (this.magAmmo <= 0) {
            this._burstRemaining = 0;
            if (this.reserveAmmo > 0) this._startReload(sound, listenerX, listenerY);
            else this.aiState = this._coverSlotPos ? AI_STATE.CROUCHING : AI_STATE.IDLE;
          } else if (this._burstRemaining <= 0) {
            this.aiState = AI_STATE.AIMING;
            this._combatTimer = 0.35;
          }
          return true;
        }

        if (this.magAmmo > 0 && projectiles) {
          const isCrouched = Boolean(this._coverSlotPos);
          const stanceMod = isCrouched ? 0.65 : 1.15;
          const trenchMod = this.inTrench ? 0.62 : 1.0;
          const woundMod = this.wounded ? 1.8 : 1.0;
          let distAndCondMod = 1.0;
          if (this.customBattleMode && tgt) {
            const maxR = this.weaponCfg.visualRangeMeters * CONFIG.TANK.PIXELS_PER_METER;
            const dRatio = Math.min(1.4, Math.hypot(tgt.x - this.x, tgt.y - this.y) / Math.max(1, maxR));
            const distMod = 0.72 + dRatio * 1.18;
            const tgtMoving =
              Math.hypot(tgt.vx || 0, tgt.vy || 0) > 4 ||
              tgt.aiState === AI_STATE.RUNNING ||
              tgt.aiState === AI_STATE.WALKING;
            const moveMod = tgtMoving ? 1.28 : 1.0;
            const suppMod = this.morale < 0.75 ? 1.35 : 1.0;
            distAndCondMod = distMod * moveMod * suppMod;
          }
          const spread = (Math.random() - 0.5) * 2 * this.weaponCfg.baseSpreadRad * stanceMod * trenchMod * woundMod * distAndCondMod;
          this._fireWeaponRound(targetAngle + spread, aiContext);
        }
        this.aiState = AI_STATE.CYCLING_BOLT;
        this._combatTimer = this.weaponCfg.boltCycleTime;
        this._boltPhase = 0;
        this._boltCueStep = 0;
        return true;
      }
    }

    // Periodic target acquisition when idle / crouching / peeking
    if (this._aiScanTimer <= 0.05) {
      const tgt = this._findHostileTarget(tanks, infantry, environment, combatEnabled);
      if (tgt) {
        this._combatTarget = tgt;
        this.aiState = AI_STATE.TURNING_TO_TARGET;
        return true;
      }
    }
    return false;
  }

  _updatePlayerControlled(dt, aiContext) {
    const {
      tanks = [],
      environment = null,
      input = null,
      mouseWorld = null,
      projectiles = null,
      particles = null,
      sound = null,
      listenerX = this.x,
      listenerY = this.y,
    } = aiContext || {};

    if (this._recoilKick > 0) {
      this._recoilKick = Math.max(0, this._recoilKick - dt * 12);
    }

    // 1. Normalized WASD movement (independent of rifle aim direction)
    let ix = 0;
    let iy = 0;
    if (input) {
      if (input.isDown('KeyW')) iy -= 1;
      if (input.isDown('KeyS')) iy += 1;
      if (input.isDown('KeyA')) ix -= 1;
      if (input.isDown('KeyD')) ix += 1;
    }

    const maxSpd = this.wounded ? 36 : 62;
    let targetVx = 0;
    let targetVy = 0;
    if (ix !== 0 || iy !== 0) {
      const len = Math.hypot(ix, iy);
      targetVx = (ix / len) * maxSpd;
      targetVy = (iy / len) * maxSpd;
    }

    const lerpRate = 1 - Math.exp(-12 * dt);
    this._playerVx += (targetVx - this._playerVx) * lerpRate;
    this._playerVy += (targetVy - this._playerVy) * lerpRate;

    const spd = Math.hypot(this._playerVx, this._playerVy);
    const isMoving = spd > 1.5;
    if (isMoving) {
      const moveDist = spd * dt;
      const steps = Math.max(1, Math.ceil(moveDist / 6));
      const stepVx = (this._playerVx * dt) / steps;
      const stepVy = (this._playerVy * dt) / steps;
      for (let sIdx = 0; sIdx < steps; sIdx++) {
        this.x += stepVx;
        this.y += stepVy;
        const cleared = this._keepClearOfTargets(this.x, this.y, this.hitboxRadius + 3, tanks);
        this.x = cleared.x;
        this.y = cleared.y;
        if (environment && environment.obstacles) {
          for (const o of environment.obstacles) {
            if (o.kind !== 'large_tree' || o.state === 'FALLEN') continue;
            const odx = this.x - o.x;
            const ody = this.y - o.y;
            const od = Math.hypot(odx, ody);
            const minD = o.trunkRadius + this.hitboxRadius;
            if (od > 0.001 && od < minD) {
              this.x = o.x + (odx / od) * minD;
              this.y = o.y + (ody / od) * minD;
            }
          }
        }
      }
      this._movePhase += dt * (spd * 0.2);
    } else {
      this._playerVx = 0;
      this._playerVy = 0;
    }

    // 2. Independent World-Space Mouse Aiming
    if (mouseWorld) {
      this.angle = Math.atan2(mouseWorld.y - this.y, mouseWorld.x - this.x);
      this.baseAngle = this.angle;
      this._aimRaise = Math.min(1, this._aimRaise + dt * 5);
    } else if (isMoving) {
      this.angle = Math.atan2(this._playerVy, this._playerVx);
      this.baseAngle = this.angle;
    }

    // 2b. Player Infantry Weapon Switching (1, 2, 3, 4), Bayonet Toggle (Q), & Melee Thrust (F)
    if (!this.inventory) {
      this.inventory = createSoldierInventory(this);
    }
    const inv = this.inventory;
    inv.meleeCooldown = Math.max(0, inv.meleeCooldown - dt);
    inv.meleeLungePhase = Math.max(0, inv.meleeLungePhase - dt * 3.5);
    if (inv.activeMode === 'THROWING') {
      inv.throwTimer = Math.max(0, inv.throwTimer - dt);
      if (inv.throwTimer <= 0) {
        inv.activeMode = inv.bayonetEquipped ? 'BAYONET' : 'PRIMARY';
      }
    }

    this._prevSlotKeys = this._prevSlotKeys || {};
    if (input) {
      const slotMap = [
        ['Digit1', 'SLOT_1'],
        ['Digit2', 'SLOT_2'],
        ['Digit3', 'SLOT_3'],
        ['Digit4', 'SLOT_4'],
        ['KeyQ', 'TOGGLE_BAYONET'],
      ];
      for (const [code, action] of slotMap) {
        const down = Boolean(input.isDown(code));
        if (down && !this._prevSlotKeys[code]) {
          selectSoldierWeaponSlot(this, action, aiContext?.onHudNotice || null);
        }
        this._prevSlotKeys[code] = down;
      }

      const fDown = Boolean(input.isDown('KeyF'));
      if (fDown && !this._prevSlotKeys.KeyF) {
        performSoldierMeleeThrust(this, aiContext?.infantry || [], particles, environment);
      }
      this._prevSlotKeys.KeyF = fDown;

      const rDown = Boolean(input.isDown('KeyR'));
      if (rDown && !this._prevSlotKeys.KeyR) {
        if (inv.selectedSlot === 'SIDEARM') {
          const need = inv.sidearmMagCap - inv.sidearmMag;
          if (need > 0 && inv.sidearmReserve > 0) {
            const load = Math.min(need, inv.sidearmReserve);
            inv.sidearmMag += load;
            inv.sidearmReserve -= load;
          }
        } else if (inv.selectedSlot === 'PRIMARY') {
          this._startReload(sound, listenerX, listenerY);
        }
      }
      this._prevSlotKeys.KeyR = rDown;
    }

    // 3. Weapon State Machine (Full-Auto PPSh-41 vs Bolt-Action Rifle)
    const speedMult = this.wounded ? 0.65 : 1.0;
    if (this.aiState === AI_STATE.RELOADING) {
      if (this._stepReload(dt, speedMult, sound, listenerX, listenerY)) {
        this.aiState = isMoving ? AI_STATE.WALKING : AI_STATE.IDLE;
      }
      this._mouseWasDown = Boolean(input && input.mouseLeftDown);
      return;
    }

    if (this.aiState === AI_STATE.CYCLING_BOLT) {
      this._combatTimer -= dt * speedMult;
      this._boltPhase = 1 - Math.max(0, this._combatTimer / this.weaponCfg.boltCycleTime);
      this._stepBoltCycleAudio(sound, listenerX, listenerY);
      if (this._combatTimer <= 0) {
        this._boltPhase = 0;
        if (this.magAmmo <= 0 && this.reserveAmmo > 0 && inv.selectedSlot === 'PRIMARY') {
          this._startReload(sound, listenerX, listenerY);
        } else {
          this.aiState = isMoving ? AI_STATE.WALKING : AI_STATE.IDLE;
        }
      }
      this._mouseWasDown = Boolean(input && input.mouseLeftDown);
      return;
    }

    if (inv.selectedSlot === 'PRIMARY' && this.magAmmo <= 0 && this.reserveAmmo > 0) {
      this._startReload(sound, listenerX, listenerY);
      this._mouseWasDown = Boolean(input && input.mouseLeftDown);
      return;
    }

    // 4. Firing / Throwing / Melee based on selected weapon slot
    const mouseDown = Boolean(input && input.mouseLeftDown && !input._mouseOverHud);
    const freshClick = mouseDown && !this._mouseWasDown;
    this._mouseWasDown = mouseDown;

    if (inv.selectedSlot === 'FRAG') {
      if (freshClick) {
        if (inv.fragGrenades > 0 && aiContext?.throwables && mouseWorld) {
          inv.fragGrenades -= 1;
          inv.activeMode = 'THROWING';
          inv.throwTimer = 0.38;
          aiContext.throwables.spawnThrowable({
            kind: 'frag',
            weaponId: inv.fragGrenadeId,
            faction: this.faction,
            owner: this,
            startX: this.x,
            startY: this.y,
            targetX: mouseWorld.x,
            targetY: mouseWorld.y,
          });
          if (inv.fragGrenades <= 0) {
            inv.selectedSlot = 'PRIMARY';
          }
        } else {
          aiContext?.onHudNotice?.('NO FRAG GRENADES REMAINING');
        }
      }
      this.aiState = isMoving ? AI_STATE.WALKING : AI_STATE.IDLE;
      return;
    }

    if (inv.selectedSlot === 'INCENDIARY') {
      if (freshClick) {
        if (inv.incendiaries > 0 && aiContext?.throwables && mouseWorld) {
          inv.incendiaries -= 1;
          inv.activeMode = 'THROWING';
          inv.throwTimer = 0.38;
          aiContext.throwables.spawnThrowable({
            kind: 'incendiary',
            weaponId: inv.incendiaryId,
            faction: this.faction,
            owner: this,
            startX: this.x,
            startY: this.y,
            targetX: mouseWorld.x,
            targetY: mouseWorld.y,
          });
          if (inv.incendiaries <= 0) {
            inv.selectedSlot = 'PRIMARY';
          }
        } else {
          aiContext?.onHudNotice?.('NO INCENDIARY WEAPONS REMAINING');
        }
      }
      this.aiState = isMoving ? AI_STATE.WALKING : AI_STATE.IDLE;
      return;
    }

    if (inv.selectedSlot === 'SIDEARM') {
      if (freshClick) {
        if (inv.sidearmMag <= 0 && inv.sidearmReserve > 0) {
          const load = Math.min(inv.sidearmMagCap, inv.sidearmReserve);
          inv.sidearmMag += load;
          inv.sidearmReserve -= load;
        }
        if (inv.sidearmMag > 0 && projectiles) {
          inv.sidearmMag -= 1;
          this._recoilKick = 0.7;
          const mx = this.x + Math.cos(this.angle) * 14;
          const my = this.y + Math.sin(this.angle) * 14;
          const spread = (Math.random() - 0.5) * 0.055;
          projectiles.spawnRifleBullet(mx, my, this.angle + spread, 'SMG_762_25', this.faction, this.id, 620, 12);
          sound?.playRifleShot?.('PPSH_41', mx, my, listenerX, listenerY, false, 'open');
        } else {
          aiContext?.onHudNotice?.('SIDEARM OUT OF AMMO');
        }
      }
      this.aiState = isMoving ? AI_STATE.WALKING : AI_STATE.IDLE;
      return;
    }

    // If bayonet is attached and an enemy is right within bayonet reach on click, execute bayonet thrust
    if (freshClick && inv.bayonetEquipped && inv.hasBayonet && inv.meleeCooldown <= 0) {
      const res = performSoldierMeleeThrust(this, aiContext?.infantry || [], particles, environment);
      if (res.hit) {
        return;
      }
    }

    if (this.weaponCfg.action === 'full-auto') {
      if (!mouseDown) {
        this._autoFireTimer = Math.max(0, this._autoFireTimer - dt);
        this.aiState = isMoving ? AI_STATE.WALKING : AI_STATE.IDLE;
        return;
      }
      if (this.magAmmo <= 0) {
        if (freshClick) sound?.playPPShMech?.('dry_fire', this.x, this.y, listenerX, listenerY);
        this.aiState = isMoving ? AI_STATE.WALKING : AI_STATE.IDLE;
        return;
      }
      this._autoFireTimer -= dt;
      let firedThisStep = 0;
      const moveMod = isMoving ? 1.65 : 0.85;
      const woundMod = this.wounded ? 1.65 : 1.0;
      while (this._autoFireTimer <= 0 && this.magAmmo > 0 && firedThisStep < 2) {
        this._autoFireTimer += this.weaponCfg.shotInterval;
        const spread = (Math.random() - 0.5) * 2 * this.weaponCfg.baseSpreadRad * moveMod * woundMod;
        this._fireWeaponRound(this.angle + spread, aiContext);
        firedThisStep++;
      }
      if (this.magAmmo <= 0 && this.reserveAmmo > 0) {
        this._startReload(sound, listenerX, listenerY);
        return;
      }
      this.aiState = AI_STATE.FIRING;
      return;
    }

    if (freshClick && this.magAmmo > 0 && projectiles) {
      const moveMod = isMoving ? 1.85 : 0.75;
      const woundMod = this.wounded ? 1.8 : 1.0;
      const spread = (Math.random() - 0.5) * 2 * this.weaponCfg.baseSpreadRad * moveMod * woundMod;
      this._fireWeaponRound(this.angle + spread, aiContext);
      this.aiState = AI_STATE.CYCLING_BOLT;
      this._combatTimer = this.weaponCfg.boltCycleTime;
      this._boltPhase = 0;
      this._boltCueStep = 0;
      return;
    }

    this.aiState = isMoving ? AI_STATE.WALKING : AI_STATE.IDLE;
  }

  _updateTacticalAI(dt, aiContext) {
    if (this.isHmgOperator && this.hmgEmplacement && !this.hmgEmplacement.destroyed) {
      return;
    }
    if (this.isArtilleryCrew && this.artilleryGun && !this.artilleryGun.destroyed) {
      return;
    }
    if (!aiContext) {
      this._idlePhase += dt * this._idleSpeed;
      this.angle = this.baseAngle + Math.sin(this._idlePhase) * 0.075;
      return;
    }

    if ((this.customBattleMode || aiContext.customBattleMode) && updateSoldierCQCAndThrowables(this, dt, aiContext, aiContext.throwables)) {
      return;
    }

    const { tanks = [], infantry = [], environment = null } = aiContext;
    if (this._updateRifleCombat(dt, aiContext)) {
      return;
    }
    this._aiScanTimer -= dt;
    if (tanks.length === 0 && !this.commandOrder && !this.reinforcementOrder && !aiContext?.combatEnabled) {
      if (this._aiScanTimer <= 0) this._aiScanTimer = this._aiScanInterval;
      this._idlePhase += dt * this._idleSpeed;
      this.angle = this.baseAngle + Math.sin(this._idlePhase) * 0.075;
      return;
    }

    if (this._aiScanTimer <= 0) {
      this._aiScanTimer = this._aiScanInterval;

      // 1. Detect nearest friendly tank within 200m (7560 px) that is NOT burning/destroyed
      let bestFriendly = null;
      let bestFriendlyDist = Infinity;
      let nearestEnemy = null;
      let bestEnemyDist = Infinity;
      const combatEnabled = Boolean(aiContext?.combatEnabled);

      for (const t of tanks) {
        if (!t) continue;
        const d = Math.hypot(t.x - this.x, t.y - this.y);
        if (t.faction === this.faction) {
          const isBurning = t.vehicleState === 'BURNING' || t.vehicleState === 'BURNT_OUT' || Boolean(t.damageSystem?.ammoFireActive);
          const isDead = Boolean(t.destroyed || t.damageSystem?.vehicleDestroyed);
          if (!isBurning && !isDead && d <= FRIENDLY_COVER_RANGE_PX && d < bestFriendlyDist) {
            bestFriendlyDist = d;
            bestFriendly = t;
          }
        } else if (!combatEnabled) {
          if (d < bestEnemyDist) {
            bestEnemyDist = d;
            nearestEnemy = t;
          }
        }
      }

      if (combatEnabled && this.detection) {
        // Share threat alert if friendly Panzer III within 280px has spotted a target
        if (
          this.detection.state === DETECTION_STATE.UNAWARE &&
          bestFriendly &&
          bestFriendly.detection &&
          (bestFriendly.detection.state === DETECTION_STATE.TARGET_DETECTED ||
            bestFriendly.detection.state === DETECTION_STATE.ENGAGING) &&
          bestFriendly.detection.lastKnownPos
        ) {
          this.detection.notifyThreat(
            bestFriendly.detection.lastKnownPos.x,
            bestFriendly.detection.lastKnownPos.y
          );
        }
        if (this.detection.state !== DETECTION_STATE.UNAWARE) {
          nearestEnemy = this.detection.target || this.detection.lastKnownPos;
        }
      }

      // Check if currently held cover tank started burning -> retreat away!
      if (this._coverTank) {
        const curBurning =
          this._coverTank.vehicleState === 'BURNING' ||
          this._coverTank.vehicleState === 'BURNT_OUT' ||
          Boolean(this._coverTank.damageSystem?.ammoFireActive);
        if (curBurning) {
          this.aiState = AI_STATE.RETREATING;
          const awayAngle = Math.atan2(this.y - this._coverTank.y, this.x - this._coverTank.x);
          this._coverSlotPos = {
            x: clamp(this._coverTank.x + Math.cos(awayAngle) * 145, CONFIG.WORLD.BORDER_PADDING, CONFIG.WORLD.WIDTH - CONFIG.WORLD.BORDER_PADDING),
            y: clamp(this._coverTank.y + Math.sin(awayAngle) * 145, CONFIG.WORLD.BORDER_PADDING, CONFIG.WORLD.HEIGHT - CONFIG.WORLD.BORDER_PADDING),
          };
          this._coverTank = null;
          return;
        }
      }

      if (this.commandOrder && Number.isFinite(this.commandOrder.targetX)) {
        const cx = this.commandOrder.targetX;
        const cy = this.commandOrder.targetY;
        const distToCmd = Math.hypot(cx - this.x, cy - this.y);
        this._threatAngle = Math.atan2(
          (this.commandOrder.objectiveY ?? cy) - this.y,
          (this.commandOrder.objectiveX ?? cx) - this.x
        );
        if (distToCmd > 16) {
          const path = this._computePathAroundTanks(this.x, this.y, cx, cy, tanks, environment);
          this._coverTank = null;
          this._coverSlotPos = { x: cx, y: cy };
          this._aiWaypoints = path || [{ x: cx, y: cy }];
          this.aiState = this.wounded
            ? AI_STATE.WALKING
            : (distToCmd > 140 ? AI_STATE.RUNNING : AI_STATE.TAKING_COVER);
        } else {
          this._coverTank = null;
          this._coverSlotPos = { x: cx, y: cy };
          this._aiWaypoints = [];
          this.aiState = this.commandOrder.hasCover ? AI_STATE.CROUCHING : AI_STATE.IDLE;
        }
      } else if (bestFriendly && nearestEnemy) {
        this._coverTank = bestFriendly;
        const threatAngle = Math.atan2(nearestEnemy.y - bestFriendly.y, nearestEnemy.x - bestFriendly.x);
        this._threatAngle = threatAngle;
        const coverBaseAngle = threatAngle + Math.PI;

        const halfLen = (bestFriendly.halfLength || 110 * CONFIG.TANK.SCALE);
        const halfWid = (bestFriendly.halfWidth || 54 * CONFIG.TANK.SCALE);
        const tankMoving = Math.abs(bestFriendly.speed || 0) > 8 || Math.abs(bestFriendly.angularVelocity || 0) > 0.05;
        const cosT = Math.cos(bestFriendly.angle || 0);
        const sinT = Math.sin(bestFriendly.angle || 0);

        // Candidate slots fanned behind the tank relative to threat
        const offsets = [0, 0.35, -0.35, 0.72, -0.72, 1.05, -1.05, 1.38, -1.38];
        let chosen = null;

        for (const off of offsets) {
          const a = coverBaseAngle + off;
          const dist = Math.max(halfLen, halfWid) + 28 + Math.abs(off) * 10;
          const cx = clamp(bestFriendly.x + Math.cos(a) * dist, CONFIG.WORLD.BORDER_PADDING, CONFIG.WORLD.WIDTH - CONFIG.WORLD.BORDER_PADDING);
          const cy = clamp(bestFriendly.y + Math.sin(a) * dist, CONFIG.WORLD.BORDER_PADDING, CONFIG.WORLD.HEIGHT - CONFIG.WORLD.BORDER_PADDING);

          // Avoid moving tank's forward/reverse track corridor
          if (tankMoving) {
            const dx = cx - bestFriendly.x;
            const dy = cy - bestFriendly.y;
            const ly = -dx * sinT + dy * cosT;
            if (Math.abs(ly) <= halfWid + 18) continue;
          }

          // Avoid large trees
          let blocked = false;
          if (environment && environment.obstacles) {
            for (const o of environment.obstacles) {
              if (o.kind === 'large_tree' && o.state !== 'FALLEN' && Math.hypot(cx - o.x, cy - o.y) < o.trunkRadius + 12) {
                blocked = true;
                break;
              }
            }
          }
          if (blocked) continue;

          // Anti-crowding: avoid slots claimed or occupied by other friendly soldiers
          let occupied = false;
          for (const other of infantry) {
            if (other === this || !other.alive) continue;
            const ox = other._coverSlotPos ? other._coverSlotPos.x : other.x;
            const oy = other._coverSlotPos ? other._coverSlotPos.y : other.y;
            if (Math.hypot(cx - ox, cy - oy) < 24) {
              occupied = true;
              break;
            }
          }
          if (!occupied) {
            chosen = { x: cx, y: cy };
            break;
          }
        }

        if (chosen) {
          const path = this._computePathAroundTanks(this.x, this.y, chosen.x, chosen.y, tanks, environment);
          if (path) {
            this._coverSlotPos = chosen;
            this._aiWaypoints = path;
            const distToSlot = Math.hypot(chosen.x - this.x, chosen.y - this.y);
            if (distToSlot > 12) {
              this.aiState = this.wounded ? AI_STATE.WALKING : AI_STATE.TAKING_COVER;
            } else if (this.aiState !== AI_STATE.PEEKING) {
              this.aiState = AI_STATE.CROUCHING;
            }
          } else {
            this._coverSlotPos = null;
            this._aiWaypoints = [];
            this.aiState = AI_STATE.IDLE;
          }
        } else {
          this.aiState = AI_STATE.SEEKING_COVER;
        }
      } else if (environment?.trenchSystem && nearestEnemy) {
        const trenchCov = environment.trenchSystem.findNearestTrenchCover(this.x, this.y, 260);
        if (trenchCov) {
          this._coverTank = null;
          this._coverSlotPos = { x: trenchCov.x, y: trenchCov.y };
          this._threatAngle = Math.atan2(nearestEnemy.y - this.y, nearestEnemy.x - this.x);
          this.aiState = AI_STATE.TAKING_COVER;
        } else {
          this._coverTank = null;
          this._coverSlotPos = null;
          if (this.aiState !== AI_STATE.RETREATING) {
            this.aiState = AI_STATE.IDLE;
          }
        }
      } else if (this.assaultOrder && Number.isFinite(this.assaultOrder.targetX)) {
        const escort = this.assaultOrder.escortTank;
        const escortAlive = Boolean(escort && !escort.destroyed && !escort.damageSystem?.vehicleDestroyed && !escort.damageSystem?.vehicleAbandoned);
        let ax = this.assaultOrder.targetX;
        let ay = this.assaultOrder.targetY;
        if (escortAlive) {
          // Follow behind escort Panzer III as moving cover while advancing toward perimeter
          const dirToObj = Math.atan2(ay - escort.y, ax - escort.x);
          const offAng = dirToObj + Math.PI + (this.assaultOrder.lateralOffset || 0);
          const trailDist = 95 + (this.assaultOrder.depthOffset || 0);
          ax = clamp(escort.x + Math.cos(offAng) * trailDist, CONFIG.WORLD.BORDER_PADDING, CONFIG.WORLD.WIDTH - CONFIG.WORLD.BORDER_PADDING);
          ay = clamp(escort.y + Math.sin(offAng) * trailDist, CONFIG.WORLD.BORDER_PADDING, CONFIG.WORLD.HEIGHT - CONFIG.WORLD.BORDER_PADDING);
        }
        const distToAssault = Math.hypot(ax - this.x, ay - this.y);
        if (distToAssault > 24) {
          const path = this._computePathAroundTanks(this.x, this.y, ax, ay, tanks, environment);
          this._coverTank = escortAlive ? escort : null;
          this._coverSlotPos = { x: ax, y: ay };
          this._aiWaypoints = path || [{ x: ax, y: ay }];
          this._threatAngle = Math.atan2(this.assaultOrder.targetY - this.y, this.assaultOrder.targetX - this.x);
          this.aiState = this.wounded ? AI_STATE.WALKING : (distToAssault > 180 ? AI_STATE.RUNNING : AI_STATE.TAKING_COVER);
        } else {
          this._coverTank = escortAlive ? escort : null;
          this._coverSlotPos = null;
          this._aiWaypoints = [];
          this.aiState = AI_STATE.CROUCHING;
        }
      } else if (this.reinforcementOrder && Number.isFinite(this.reinforcementOrder.targetX)) {
        const rx = this.reinforcementOrder.targetX;
        const ry = this.reinforcementOrder.targetY;
        const distToOrder = Math.hypot(rx - this.x, ry - this.y);
        if (distToOrder > 16) {
          const path = this._computePathAroundTanks(this.x, this.y, rx, ry, tanks, environment);
          this._coverTank = bestFriendly || null;
          this._coverSlotPos = { x: rx, y: ry };
          this._aiWaypoints = path || [{ x: rx, y: ry }];
          this.aiState = this.wounded ? AI_STATE.WALKING : (distToOrder > 180 ? AI_STATE.RUNNING : AI_STATE.WALKING);
        } else {
          this._coverTank = bestFriendly || null;
          this._coverSlotPos = null;
          this._aiWaypoints = [];
          this.aiState = AI_STATE.IDLE;
        }
      } else if (combatEnabled && nearestEnemy && !this._hasClearShot(nearestEnemy.x, nearestEnemy.y, tanks, infantry, environment)) {
        const repo = this._findRepositionPointForLOS(nearestEnemy, tanks, infantry, environment);
        if (repo) {
          this._coverTank = null;
          this._coverSlotPos = repo.pos;
          this._aiWaypoints = repo.path;
          this._threatAngle = Math.atan2(nearestEnemy.y - repo.pos.y, nearestEnemy.x - repo.pos.x);
          this.aiState = this.wounded ? AI_STATE.WALKING : AI_STATE.TAKING_COVER;
        } else {
          this._coverTank = null;
          this._coverSlotPos = null;
          if (this.aiState !== AI_STATE.RETREATING) {
            this.aiState = AI_STATE.IDLE;
          }
        }
      } else {
        this._coverTank = null;
        this._coverSlotPos = null;
        if (this.aiState !== AI_STATE.RETREATING) {
          this.aiState = AI_STATE.IDLE;
        }
      }
    }

    // Execute movement / crouching / peeking with waypoint pathfinding & substepped OBB collision
    const activeTarget = this.moveTarget || (this._aiWaypoints.length > 0 ? this._aiWaypoints[0] : this._coverSlotPos);
    if (activeTarget && (this.aiState === AI_STATE.TAKING_COVER || this.aiState === AI_STATE.WALKING || this.aiState === AI_STATE.RUNNING || this.aiState === AI_STATE.RETREATING)) {
      const dx = activeTarget.x - this.x;
      const dy = activeTarget.y - this.y;
      const dist = Math.hypot(dx, dy);
      const baseSpeed = this.aiState === AI_STATE.RETREATING || this.aiState === AI_STATE.RUNNING ? 56 : 42;
      const spd = baseSpeed * (this.wounded ? 0.55 : 1.0);

      if (dist <= Math.max(6, spd * dt)) {
        this.x = activeTarget.x;
        this.y = activeTarget.y;
        if (!this.moveTarget && this._aiWaypoints.length > 1) {
          this._aiWaypoints.shift();
          return;
        }
        this._aiWaypoints = [];
        this.moveTarget = null;
        if (this.aiState === AI_STATE.RETREATING) {
          this._coverSlotPos = null;
          this.aiState = AI_STATE.IDLE;
        } else {
          this.aiState = AI_STATE.CROUCHING;
          this.angle = this._threatAngle;
          this.baseAngle = this._threatAngle;
        }
      } else {
        const moveDist = spd * dt;
        const steps = Math.max(1, Math.ceil(moveDist / 6));
        const stepDist = moveDist / steps;
        const ux = dx / dist;
        const uy = dy / dist;

        for (let sIdx = 0; sIdx < steps; sIdx++) {
          this.x += ux * stepDist;
          this.y += uy * stepDist;
          const cleared = this._keepClearOfTargets(this.x, this.y, this.hitboxRadius + 3, tanks);
          this.x = cleared.x;
          this.y = cleared.y;
          if (environment && environment.obstacles) {
            for (const o of environment.obstacles) {
              if (o.kind !== 'large_tree' || o.state === 'FALLEN') continue;
              const odx = this.x - o.x;
              const ody = this.y - o.y;
              const od = Math.hypot(odx, ody);
              const minD = o.trunkRadius + this.hitboxRadius;
              if (od > 0.001 && od < minD) {
                this.x = o.x + (odx / od) * minD;
                this.y = o.y + (ody / od) * minD;
              }
            }
          }
        }
        this.angle = Math.atan2(dy, dx);
        this.baseAngle = this.angle;
        this._movePhase += dt * (spd * 0.22);
      }
      return;
    }

    if (this.aiState === AI_STATE.CROUCHING || this.aiState === AI_STATE.PEEKING) {
      this._peekTimer += dt;
      if (this.aiState === AI_STATE.CROUCHING && this._peekTimer >= 4.2) {
        this._peekTimer = 0;
        this.aiState = AI_STATE.PEEKING;
      } else if (this.aiState === AI_STATE.PEEKING && this._peekTimer >= 1.2) {
        this._peekTimer = 0;
        this.aiState = AI_STATE.CROUCHING;
      }
      this.angle = this._threatAngle + (this.aiState === AI_STATE.PEEKING ? Math.sin(this._peekTimer * 3) * 0.15 : 0);
      return;
    }

    this._idlePhase += dt * this._idleSpeed;
    this.angle = this.baseAngle + Math.sin(this._idlePhase) * 0.075;
  }

  startSocializing(partner) {
    if (!this.alive || this.isPlayerControlled || this.isBoardingVehicle) return;
    this.behaviorState = BEHAVIOR_STATE.SOCIALIZING;
    this._socialPartner = partner;
    this._behaviorTimer = 2.8;
    const lookAngle = Math.atan2(partner.y - this.y, partner.x - this.x);
    this.baseAngle = lookAngle;
    this.angle = lookAngle;
  }

  onHearSoundEvent({ x, y, kind, faction, dist, environment, voiceSystem, listenerX, listenerY }) {
    if (!this.alive || this.isPlayerControlled || this.isBoardingVehicle) return;
    if (faction === this.faction && (kind === 'rifle' || kind === 'mg')) return; // Ignore friendly small-arms

    this._pendingChatReplyTimer = 0;
    this._socialPartner = null;
    const dirAngle = Math.atan2(y - this.y, x - this.x);

    if (kind === 'explosion' || kind === 'cannon') {
      const severity = dist < 170 ? 0.34 : 0.16;
      this.morale = Math.max(0.15, this.morale - severity);
      this.behaviorState = dist < 160 ? BEHAVIOR_STATE.FRIGHTENED : BEHAVIOR_STATE.ALERT;
      this._behaviorTimer = 2.6;
      if (!this._combatTarget) {
        this.baseAngle = dirAngle;
        this.angle = dirAngle;
      }
      if (dist < 220) {
        this.aiState = AI_STATE.CROUCHING;
        voiceSystem?.requestVoice?.(this, 'COMBAT_WARNING', 3, listenerX, listenerY, environment);
      }
    } else if (kind === 'mg') {
      this.morale = Math.max(0.2, this.morale - 0.12);
      if (dist < 260 && !this.inTrench) {
        this.behaviorState = BEHAVIOR_STATE.SUPPRESSED;
        this._behaviorTimer = 2.0;
        this.aiState = AI_STATE.CROUCHING;
      } else {
        this.behaviorState = BEHAVIOR_STATE.ALERT;
        this._behaviorTimer = 2.2;
      }
      if (!this._combatTarget) {
        this.baseAngle = dirAngle;
        this.angle = dirAngle;
      }
      this.detection?.notifyThreat?.(x, y);
    } else if (kind === 'rifle') {
      this.behaviorState = BEHAVIOR_STATE.INVESTIGATING;
      this._behaviorTimer = 2.4;
      if (!this._combatTarget) {
        this.baseAngle = dirAngle;
        this.angle = dirAngle;
      }
      this.detection?.notifyThreat?.(x, y);
      if (dist < 220) {
        voiceSystem?.requestVoice?.(this, 'COMBAT_WARNING', 3, listenerX, listenerY, environment);
      }
    }
  }

  onWitnessCasualty({ victim, blastX, blastY, isArtillery, dist, hasLOS, soldiers, environment, voiceSystem, listenerX, listenerY }) {
    if (!this.alive || this.isPlayerControlled || this.isBoardingVehicle) return;
    this._pendingChatReplyTimer = 0;
    this._socialPartner = null;

    // Leadership/tank discipline mitigates panic
    const hasLeadership = soldiers.some(
      (o) => o !== this && o.alive && o.faction === this.faction && (o.isOfficer || o.crewRole === 'COMMANDER' || o.id === 1) && Math.hypot(o.x - this.x, o.y - this.y) < 220
    );
    const leadershipFactor = hasLeadership ? 0.6 : 1.0;

    if (hasLOS) {
      const moraleDrop = (isArtillery ? 0.44 : 0.25) * leadershipFactor * (dist < 140 ? 1.2 : 0.85);
      this.morale = Math.max(0.1, this.morale - moraleDrop);
      this.baseAngle = Math.atan2(victim.y - this.y, victim.x - this.x);
      this.angle = this.baseAngle;

      if (this.morale < 0.28) {
        this.behaviorState = BEHAVIOR_STATE.PANICKED;
        this._behaviorTimer = 3.5;
        this.aiState = AI_STATE.RETREATING;
        const awayAng = Math.atan2(this.y - blastY, this.x - blastX);
        this.moveTarget = {
          x: clamp(this.x + Math.cos(awayAng) * 115, CONFIG.WORLD.BORDER_PADDING, CONFIG.WORLD.WIDTH - CONFIG.WORLD.BORDER_PADDING),
          y: clamp(this.y + Math.sin(awayAng) * 115, CONFIG.WORLD.BORDER_PADDING, CONFIG.WORLD.HEIGHT - CONFIG.WORLD.BORDER_PADDING),
        };
        voiceSystem?.requestVoice?.(this, 'PANIC_RETREAT', 4, listenerX, listenerY, environment);

        // Local panic propagation to nearby allies within 185px with LOS
        for (const ally of soldiers) {
          if (ally === this || !ally.alive || ally.faction !== this.faction || ally.isPlayerControlled) continue;
          if (Math.hypot(ally.x - this.x, ally.y - this.y) > 185) continue;
          if (environment && typeof environment.hasLineOfSight === 'function' && !environment.hasLineOfSight(this.x, this.y, ally.x, ally.y)) continue;
          ally.morale = Math.max(0.15, ally.morale - 0.18 * leadershipFactor);
          if (ally.behaviorState === BEHAVIOR_STATE.IDLE || ally.behaviorState === BEHAVIOR_STATE.SOCIALIZING) {
            ally.behaviorState = BEHAVIOR_STATE.FRIGHTENED;
            ally._behaviorTimer = 2.2;
          }
        }
      } else {
        this.behaviorState = BEHAVIOR_STATE.FRIGHTENED;
        this._behaviorTimer = 2.4;
        this.aiState = AI_STATE.CROUCHING;
        voiceSystem?.requestVoice?.(
          this,
          isArtillery ? 'ARTILLERY_REACTION' : 'CASUALTY_WITNESS',
          2,
          listenerX,
          listenerY,
          environment
        );
      }
    } else {
      // Obstructed behind trench wall/cover: reacts to blast sound without direct visual witness
      this.morale = Math.max(0.25, this.morale - 0.14 * leadershipFactor);
      this.behaviorState = BEHAVIOR_STATE.ALERT;
      this._behaviorTimer = 2.0;
      this.aiState = AI_STATE.CROUCHING;
    }
  }

  update(dt, particles = null, targets = [], aiContext = null) {
    if (this._rifle.active && !this._rifle.settled) {
      this._rifle.x += this._rifle.vx * dt;
      this._rifle.y += this._rifle.vy * dt;
      this._rifle.angle += this._rifle.angVel * dt;
      this._rifle.z += this._rifle.vz * dt;
      this._rifle.vz -= 280 * dt;

      if (this._rifle.z <= 0) {
        this._rifle.z = 0;
        if (Math.abs(this._rifle.vz) > 24) {
          this._rifle.vz = -this._rifle.vz * 0.32;
          this._rifle.vx *= 0.65;
          this._rifle.vy *= 0.65;
          this._rifle.angVel *= 0.6;
        } else {
          this._rifle.vz = 0;
        }
      }

      const dragLin = this._rifle.z > 0 ? Math.exp(-1.6 * dt) : Math.exp(-6.0 * dt);
      this._rifle.vx *= dragLin;
      this._rifle.vy *= dragLin;
      this._rifle.angVel *= Math.exp(-5.5 * dt);

      const cleared = this._keepClearOfTargets(this._rifle.x, this._rifle.y, 6, targets);
      this._rifle.x = cleared.x;
      this._rifle.y = cleared.y;

      if (
        this._rifle.z === 0 &&
        Math.hypot(this._rifle.vx, this._rifle.vy) < 5 &&
        Math.abs(this._rifle.angVel) < 0.15
      ) {
        this._rifle.vx = 0;
        this._rifle.vy = 0;
        this._rifle.angVel = 0;
        this._rifle.settled = true;
      }
    }

    if (this.state === SOLDIER_STATE.DEAD) {
      this.behaviorState = BEHAVIOR_STATE.DEAD;
      return;
    }

    if (aiContext?.voiceSystem) {
      this._lastVoiceCtx = {
        voiceSystem: aiContext.voiceSystem,
        sound: aiContext.sound ?? null,
        lx: aiContext.listenerX ?? this.x,
        ly: aiContext.listenerY ?? this.y,
        env: aiContext.environment ?? null,
      };
    }

    this._voiceCooldown = Math.max(0, this._voiceCooldown - dt);
    if (this._pendingChatReplyTimer > 0 && this.alive && !this.isPlayerControlled && !this.isBoardingVehicle) {
      this._pendingChatReplyTimer -= dt;
      if (this._pendingChatReplyTimer <= 0 && this.behaviorState === BEHAVIOR_STATE.SOCIALIZING) {
        aiContext?.voiceSystem?.requestVoice?.(
          this,
          'IDLE_CHAT_REPLY',
          6,
          aiContext.listenerX ?? this.x,
          aiContext.listenerY ?? this.y,
          aiContext.environment ?? null
        );
      }
    }

    if (this._behaviorTimer > 0) {
      this._behaviorTimer -= dt;
      if (this._behaviorTimer <= 0 && this.alive) {
        if (this.behaviorState === BEHAVIOR_STATE.PANICKED || this.behaviorState === BEHAVIOR_STATE.FRIGHTENED || this.behaviorState === BEHAVIOR_STATE.SUPPRESSED) {
          this.behaviorState = BEHAVIOR_STATE.RECOVERING;
          this._behaviorTimer = 1.8;
        } else {
          this.behaviorState = this.wounded ? BEHAVIOR_STATE.WOUNDED : BEHAVIOR_STATE.IDLE;
          this._socialPartner = null;
        }
      }
    } else if (this.alive && this.morale < 1.0 && !this._combatTarget) {
      // Gradual morale recovery when safe
      this.morale = Math.min(1.0, this.morale + dt * 0.075);
    }

    if (aiContext?.environment?.trenchSystem) {
      const tState = aiContext.environment.trenchSystem.getTrenchStateAt(this.x, this.y);
      this.inTrench = tState.inTrench;
      this.trenchDepth = tState.depth;
    } else {
      this.inTrench = false;
      this.trenchDepth = null;
    }

    if (this.state === SOLDIER_STATE.ALIVE) {
      if (this.isBoardingVehicle) {
        return;
      }
      if (this.isPlayerControlled) {
        this._updatePlayerControlled(dt, aiContext);
        return;
      }
      if (this.moveTarget && !aiContext) {
        const dx = this.moveTarget.x - this.x;
        const dy = this.moveTarget.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= this.moveSpeed * dt) {
          this.x = this.moveTarget.x;
          this.y = this.moveTarget.y;
          this.baseAngle = Math.atan2(dy, dx);
          this.angle = this.baseAngle;
          this.moveTarget = null;
          this.aiState = AI_STATE.IDLE;
        } else {
          this.x += (dx / dist) * this.moveSpeed * dt;
          this.y += (dy / dist) * this.moveSpeed * dt;
          this.angle = Math.atan2(dy, dx);
          this.baseAngle = this.angle;
          this._movePhase += dt * 10;
        }
        return;
      }
      this._updateTacticalAI(dt, aiContext);
      return;
    }

    if (this.state === SOLDIER_STATE.HIT) {
      this._hitTimer -= dt;
      this._idlePhase += dt * this._idleSpeed * 0.5;
      if (this._hitTimer <= 0) {
        this._hitTimer = 0;
        this.state = SOLDIER_STATE.ALIVE;
      }
      return;
    }

    if (this.state === SOLDIER_STATE.FALLING_WOUNDED) {
      const prevP = this._woundedFallProgress;
      this._woundedFallProgress = Math.min(1, this._woundedFallProgress + dt / (this._woundedFallDuration || 0.42));

      const slidePrev = easeOutCubic(Math.min(1, prevP / 0.75));
      const slideNow = easeOutCubic(Math.min(1, this._woundedFallProgress / 0.75));
      const dSlide = (slideNow - slidePrev) * 0.65;
      this.x += this._fallSlideX * dSlide;
      this.y += this._fallSlideY * dSlide;

      if (this._woundedFallProgress >= 0.7 && !this._woundedBloodSpawned) {
        this._woundedBloodSpawned = true;
        if (particles) {
          particles.spawnBloodPool(this.x, this.y, this.angle + this._fallAngleOffset, 3.8 + this._deathSeed * 1.4);
        }
      }

      if (this._woundedFallProgress >= 1) {
        this.state = SOLDIER_STATE.WOUNDED_IDLE;
        this.woundedTime = 0;
        this._bleedPoolTimer = 0;
      }
      return;
    }

    if (this.state === SOLDIER_STATE.WOUNDED_IDLE) {
      this.woundedTime += dt;
      this._idlePhase += dt * 1.35;
      this.vx = 0;
      this.vy = 0;

      if (this.bleedRate > 0) {
        this.hp -= this.bleedRate * dt;
      }

      this._bleedPoolTimer += dt;
      if (this._bleedPoolTimer >= 1.15 && this.woundedTime < 14) {
        this._bleedPoolTimer = 0;
        if (particles) {
          const radius = Math.min(7.5, 3.6 + this.woundedTime * 0.25 + this._deathSeed * 1.1);
          particles.spawnBloodPool(
            this.x + Math.cos(this.angle + this._fallAngleOffset) * 1.5,
            this.y + Math.sin(this.angle + this._fallAngleOffset) * 1.5,
            this.angle + this._fallAngleOffset,
            radius
          );
        }
      }

      if (this.hp <= 0) {
        this.hp = 0;
        this._enterSecondCollapse(particles);
      }
      return;
    }

    if (this.state === SOLDIER_STATE.FALLING_DEAD) {
      const prevP = this._deadFallProgress;
      this._deadFallProgress = Math.min(1, this._deadFallProgress + dt / (this._deadFallDuration || 0.45));

      const slidePrev = easeOutCubic(Math.min(1, prevP / 0.75));
      const slideNow = easeOutCubic(Math.min(1, this._deadFallProgress / 0.75));
      const dSlide = (slideNow - slidePrev) * 0.45;
      this.x += this._fallSlideX * dSlide;
      this.y += this._fallSlideY * dSlide;

      if (this._deadFallProgress >= 0.65 && !this._finalBloodSpawned) {
        this._finalBloodSpawned = true;
        if (particles) {
          particles.spawnBloodPool(this.x, this.y, this.angle + this._fallAngleOffset, 8.0 + this._deathSeed * 2.5);
        }
      }

      if (this._deadFallProgress >= 1) {
        this.state = SOLDIER_STATE.DEAD;
      }
      return;
    }

    if (this.state === SOLDIER_STATE.FALLING) {
      const prevP = this._fallProgress;
      this._fallProgress = Math.min(1, this._fallProgress + dt / this._fallDuration);

      const slidePrev = easeOutCubic(Math.min(1, prevP / 0.75));
      const slideNow = easeOutCubic(Math.min(1, this._fallProgress / 0.75));
      const dSlide = slideNow - slidePrev;
      this.x += this._fallSlideX * dSlide;
      this.y += this._fallSlideY * dSlide;

      if (this._fallProgress >= 0.7 && !this._bloodSpawned) {
        this._bloodSpawned = true;
        if (particles) {
          particles.spawnBloodPool(this.x, this.y, this.angle + this._fallAngleOffset, 7.5 + this._deathSeed * 2.5);
        }
      }

      if (this._fallProgress >= 1) {
        this.state = SOLDIER_STATE.DEAD;
      }
      return;
    }

    if (this.state === SOLDIER_STATE.RAGDOLL) {
      if (this._dismembered) {
        let allSettled = true;
        for (const p of this._debrisParts) {
          if (p.settled) continue;
          allSettled = false;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.angle += p.angVel * dt;
          p.z += p.vz * dt;
          p.vz -= 300 * dt;
          if (p.z <= 0) {
            p.z = 0;
            if (Math.abs(p.vz) > 22) {
              p.vz = -p.vz * 0.28;
              p.vx *= 0.6;
              p.vy *= 0.6;
              p.angVel *= 0.55;
            } else {
              p.vz = 0;
            }
          }
          const drag = p.z > 0 ? Math.exp(-1.5 * dt) : Math.exp(-5.8 * dt);
          p.vx *= drag;
          p.vy *= drag;
          p.angVel *= Math.exp(-5.5 * dt);
          const cleared = this._keepClearOfTargets(p.x, p.y, 5, targets);
          p.x = cleared.x;
          p.y = cleared.y;
          if (p.z === 0 && Math.hypot(p.vx, p.vy) < 5 && Math.abs(p.angVel) < 0.15) {
            p.vx = 0;
            p.vy = 0;
            p.angVel = 0;
            p.settled = true;
          }
        }
        if (allSettled) {
          this.state = SOLDIER_STATE.DEAD;
        }
        return;
      }

      this.x += this._ragVx * dt;
      this.y += this._ragVy * dt;
      this.angle += this._ragAngVel * dt;

      const cleared = this._keepClearOfTargets(this.x, this.y, this.hitboxRadius, targets);
      this.x = cleared.x;
      this.y = cleared.y;

      const linDrag = Math.exp(-4.8 * dt);
      this._ragVx *= linDrag;
      this._ragVy *= linDrag;
      this._ragAngVel *= Math.exp(-5.0 * dt);

      for (const key of Object.keys(this._limbs)) {
        const limb = this._limbs[key];
        limb.angle += limb.angVel * dt;
        limb.angVel *= Math.exp(-5.8 * dt);
        if (limb.angle < limb.min) {
          limb.angle = limb.min;
          limb.angVel *= -0.25;
        } else if (limb.angle > limb.max) {
          limb.angle = limb.max;
          limb.angVel *= -0.25;
        }
      }

      const speed = Math.hypot(this._ragVx, this._ragVy);
      if (speed < 55 && !this._bloodSpawned) {
        this._bloodSpawned = true;
        if (particles) {
          particles.spawnBloodPool(this.x, this.y, this.angle, 8.0 + this._deathSeed * 2.5);
        }
      }

      if (speed < 8 && Math.abs(this._ragAngVel) < 0.25) {
        this._ragVx = 0;
        this._ragVy = 0;
        this._ragAngVel = 0;
        this.state = SOLDIER_STATE.DEAD;
      }
    }
  }

  render(ctx, lighting = null) {
    if (this._dismembered) {
      this._renderDismemberedParts(ctx);
      return;
    }
    const isRagdoll = this.state === SOLDIER_STATE.RAGDOLL || (this.state === SOLDIER_STATE.DEAD && this._ragdollPose);
    let f = 0;
    if (this.state === SOLDIER_STATE.FALLING) {
      f = easeOutCubic(this._fallProgress);
    } else if (this.state === SOLDIER_STATE.FALLING_WOUNDED) {
      f = 0.58 * easeOutCubic(this._woundedFallProgress);
    } else if (this.state === SOLDIER_STATE.WOUNDED_IDLE) {
      f = 0.58;
    } else if (this.state === SOLDIER_STATE.FALLING_DEAD) {
      f = 0.58 + 0.42 * easeOutCubic(this._deadFallProgress);
    } else if (this.state === SOLDIER_STATE.DEAD || this.state === SOLDIER_STATE.RAGDOLL) {
      f = 1;
    }

    const hitPulse = this.state === SOLDIER_STATE.HIT
      ? Math.sin((this._hitTimer / this._hitDuration) * Math.PI)
      : 0;

    const breathe = this.alive ? Math.sin(this._idlePhase * 1.4) * 0.45 : 0;
    const playerSpeed = this.isPlayerControlled ? Math.hypot(this._playerVx || 0, this._playerVy || 0) : 0;
    const isMovingAI = this.combatCapable && (
      playerSpeed > 2 ||
      this.aiState === AI_STATE.WALKING ||
      this.aiState === AI_STATE.RUNNING ||
      this.aiState === AI_STATE.TAKING_COVER ||
      this.aiState === AI_STATE.RETREATING ||
      Boolean(this.moveTarget)
    );
    const isCrouched = this.combatCapable && (this.aiState === AI_STATE.CROUCHING || this.aiState === AI_STATE.RELOADING || (this.inTrench && this.aiState !== AI_STATE.FIRING));
    const strideAmp = this.aiState === AI_STATE.RUNNING ? 5.0 : 4.2;
    const stride = isMovingAI ? Math.sin(this._movePhase) * strideAmp : 0;
    const crouchShift = isCrouched ? -1.4 : 0;
    const recoilShift = this.combatCapable ? -this._recoilKick * 2.2 + (this.inventory?.meleeLungePhase || 0) * 4.5 : 0;
    const boltHandShift = this.combatCapable && this.aiState === AI_STATE.CYCLING_BOLT ? Math.sin(this._boltPhase * Math.PI) * 3.5 : 0;
    const reloadHandShift = this.combatCapable && this.aiState === AI_STATE.RELOADING ? Math.sin(this._reloadPhase) * 3.2 : 0;
    const d = this._fallDir;

    // Pose interpolation: Standing/Idle (f=0) -> Sprawled Dead (f=1)
    const bodyRot = this.angle + (isRagdoll ? 0 : f * this._fallAngleOffset) + hitPulse * this._hitTwist;
    const torsoOx = lerp(hitPulse * this._hitRecoilX + crouchShift + recoilShift * 0.4, -1.5, f);
    const torsoOy = lerp(hitPulse * this._hitRecoilY, d * 0.8, f);

    // Legs (hip -> knee -> boot)
    const lHip = lerpPt({ x: -1.5, y: -4.6 }, { x: -5.5, y: -4.2 }, f);
    let lKnee = lerpPt({ x: 3.4 + stride * 0.6, y: -5.4 }, { x: -12.0, y: -6.8 * (0.9 + this._deathSeed * 0.2) }, f);
    let lBoot = lerpPt({ x: 7.4 + stride, y: -4.8 }, { x: -18.5, y: -5.4 }, f);

    const rHip = lerpPt({ x: -2.2, y: 4.6 }, { x: -5.5, y: 4.2 }, f);
    let rKnee = lerpPt({ x: -5.8 - stride * 0.6, y: 5.5 }, { x: -10.8, y: 8.2 * (0.9 + (1 - this._deathSeed) * 0.2) }, f);
    let rBoot = lerpPt({ x: -9.6 - stride, y: 4.8 }, { x: -17.8, y: 6.0 }, f);

    // Arms (shoulder -> elbow -> hand)
    const lShoulder = lerpPt(
      { x: 1.5 + torsoOx, y: -8.6 + torsoOy },
      { x: 3.5 + torsoOx, y: -6.8 + torsoOy },
      f
    );
    let lElbow = lerpPt(
      { x: 6.4 + torsoOx - hitPulse * 1.2, y: -9.8 + torsoOy - hitPulse * 1.8 },
      { x: 8.2, y: -11.4 },
      f
    );
    let lHand = lerpPt(
      { x: 11.4 + torsoOx - hitPulse * 1.5, y: -2.2 + torsoOy - hitPulse * 2.0 },
      { x: 13.4, y: -8.2 },
      f
    );

    const rShoulder = lerpPt(
      { x: 0.6 + torsoOx, y: 8.6 + torsoOy },
      { x: 3.5 + torsoOx, y: 6.8 + torsoOy },
      f
    );
    let rElbow = lerpPt(
      { x: 2.6 + torsoOx - hitPulse * 1.5, y: 11.4 + torsoOy + hitPulse * 1.2 },
      { x: 6.4, y: 11.6 },
      f
    );
    let rHand = lerpPt(
      { x: 5.8 + torsoOx - hitPulse * 1.2 - boltHandShift + reloadHandShift, y: 2.8 + torsoOy - Math.abs(reloadHandShift) * 0.4 },
      { x: 10.2, y: 9.8 },
      f
    );

    if (isRagdoll) {
      lKnee = rotateAround(lKnee, lHip, this._limbs.lLeg.angle);
      lBoot = rotateAround(lBoot, lHip, this._limbs.lLeg.angle * 1.15);
      rKnee = rotateAround(rKnee, rHip, this._limbs.rLeg.angle);
      rBoot = rotateAround(rBoot, rHip, this._limbs.rLeg.angle * 1.15);

      lElbow = rotateAround(lElbow, lShoulder, this._limbs.lArm.angle);
      lHand = rotateAround(lHand, lShoulder, this._limbs.lArm.angle * 1.1);
      rElbow = rotateAround(rElbow, rShoulder, this._limbs.rArm.angle);
      rHand = rotateAround(rHand, rShoulder, this._limbs.rArm.angle * 1.1);
    }

    // Kar98k / Mosin-Nagant rifle endpoints (aim raise + recoil kick)
    const rifleDropY = d > 0 ? 12.2 : -12.6;
    const rifleButt = lerpPt(
      { x: 2.6 + torsoOx + recoilShift, y: 3.4 + torsoOy },
      { x: 1.5, y: rifleDropY },
      f
    );
    const rifleFore = lerpPt(
      { x: 15.2 + torsoOx + breathe * 0.4 + this._aimRaise * 1.6 + recoilShift, y: -1.8 + torsoOy + hitPulse * 1.8 },
      { x: 13.5, y: rifleDropY + d * 2.2 },
      f
    );
    const rifleMuzzle = lerpPt(
      { x: 22.8 + torsoOx + breathe * 0.4 + this._aimRaise * 2.0 + recoilShift, y: -4.4 + torsoOy + hitPulse * 2.5 },
      { x: 21.0, y: rifleDropY + d * 3.4 },
      f
    );

    // Head / Stahlhelm position
    const headPos = lerpPt(
      { x: 2.6 + torsoOx - hitPulse * 1.4, y: torsoOy },
      { x: 8.8 + torsoOx, y: d * 0.7 },
      f
    );

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(bodyRot);
    const trenchScale = this.inTrench ? (this.trenchDepth === 'deep' ? 0.86 : 0.93) : 1.0;
    ctx.scale(this.scale * trenchScale, this.scale * trenchScale);
    if (this.state === SOLDIER_STATE.DEAD) {
      ctx.globalAlpha = 0.92;
    }

    // 1. Ground contact & directional sunlight shadow
    if (lighting) {
      const sun = lighting.sunDir;
      const shLen = lighting.shadowLen;
      ctx.save();
      ctx.rotate(-bodyRot);
      ctx.fillStyle = `rgba(10, 14, 8, ${lighting.shadowAlpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(sun.x * 4.2 * shLen, sun.y * 4.2 * shLen, lerp(10.5, 17.5, f), lerp(11.5, 9.5, f), bodyRot, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.26)';
    ctx.beginPath();
    ctx.ellipse(lerp(-1, -2, f), lerp(1.5, 1.0, f), lerp(10.0, 16.5, f), lerp(10.8, 9.0, f), 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Legs & Jackboots (drawn below torso)
    this._drawLeg(ctx, lHip, lKnee, lBoot, f);
    this._drawLeg(ctx, rHip, rKnee, rBoot, f);

    // 3. Dropped weapon on ground when falling/dead (only if not ejected as independent object)
    if (!this._rifle.active && f > 0.35) {
      this._drawWeapon(ctx, rifleButt, rifleFore, rifleMuzzle);
    }

    // 4. Anatomical Feldgrau Torso (not an oval blob)
    this._drawTorso(ctx, torsoOx, torsoOy, f, breathe);

    // 5. Two Distinct Articulated Arms (upper arm -> elbow -> forearm -> hand)
    this._drawArm(ctx, lShoulder, lElbow, lHand);
    this._drawArm(ctx, rShoulder, rElbow, rHand);

    // 6. Held weapon when standing/hit/early fall
    if (!this._rifle.active && f <= 0.35) {
      this._drawWeapon(ctx, rifleButt, rifleFore, rifleMuzzle);
    }

    // 7. Head & Stahlhelm Helmet
    const headTilt = isRagdoll ? this._limbs.head.angle : f * d * 0.25;
    this._drawStahlhelm(ctx, headPos.x, headPos.y, headTilt);

    ctx.restore();
  }

  renderRifle(ctx) {
    if (!this._rifle.active) return;
    const r = this._rifle;
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.scale(this.scale, this.scale);

    // Ground shadow offset by airborne height z
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.save();
    ctx.translate(0, r.z * 0.25 + 1.5);
    ctx.rotate(r.angle);
    ctx.fillRect(-10, -1.2, 20, 2.4);
    ctx.restore();

    // Rifle body lifted slightly by z
    ctx.translate(0, -r.z * 0.38);
    ctx.rotate(r.angle);
    this._drawWeapon(ctx, { x: -10, y: 0 }, { x: 2, y: 0 }, { x: 10.5, y: 0 });
    ctx.restore();
  }

  _renderDismemberedParts(ctx) {
    for (const p of this._debrisParts) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(this.scale, this.scale);
      if (this.state === SOLDIER_STATE.DEAD) {
        ctx.globalAlpha = 0.9;
      }

      // Ground shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
      ctx.beginPath();
      ctx.ellipse(0, p.z * 0.25 + 1.2, 5.5, 4.0, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.translate(0, -p.z * 0.35);
      ctx.rotate(p.angle);

      if (p.kind === 'torso') {
        this._drawTorso(ctx, 0, 0, 1, 0);
      } else if (p.kind === 'helmet') {
        this._drawStahlhelm(ctx, 0, 0, 0);
      } else if (p.kind === 'arm') {
        this._drawArm(ctx, { x: -5, y: 0 }, { x: 0, y: 1.8 }, { x: 5.5, y: 0.4 });
      } else if (p.kind === 'leg') {
        this._drawLeg(ctx, { x: -6, y: 0 }, { x: 0, y: 1.2 }, { x: 6.5, y: 0 }, 1);
      }
      ctx.restore();
    }
  }

  _drawLeg(ctx, hip, knee, boot, fallT) {
    const isTanker = this.uniformStyle === 'tanker';
    const isSoviet = this.faction === 'soviet';
    const trouserColor = isTanker
      ? (isSoviet ? '#2e332a' : '#1b1d21')
      : (isSoviet ? '#686442' : '#4b5547');
    // Thigh + shin
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#171a15';
    ctx.lineWidth = 4.7;
    ctx.beginPath();
    ctx.moveTo(hip.x, hip.y);
    ctx.lineTo(knee.x, knee.y);
    ctx.lineTo(boot.x, boot.y);
    ctx.stroke();

    ctx.strokeStyle = trouserColor;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(hip.x, hip.y);
    ctx.lineTo(knee.x, knee.y);
    ctx.lineTo(boot.x, boot.y);
    ctx.stroke();

    // Leather jackboot / tanker boot
    const bootAngle = Math.atan2(boot.y - knee.y, boot.x - knee.x);
    ctx.save();
    ctx.translate(boot.x, boot.y);
    ctx.rotate(fallT > 0.5 ? bootAngle : 0);
    ctx.fillStyle = isSoviet && !isTanker ? '#2a221b' : '#1d1c1a';
    ctx.strokeStyle = '#0e0e0d';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.roundRect(-2.5, -1.8, 5.4, 3.6, 1.3);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  _drawTorso(ctx, ox, oy, fallT, breathe) {
    ctx.save();
    ctx.translate(ox, oy);

    const isTanker = this.uniformStyle === 'tanker';
    const isSoviet = this.faction === 'soviet';
    const lenBack = lerp(-4.5, -7.2, fallT);
    const lenFront = lerp(4.2 + breathe * 0.3, 6.2, fallT);
    const shHalf = lerp(8.8, 6.8, fallT);
    const waistHalf = lerp(6.0, 5.4, fallT);

    // Shaped shoulder-to-waist uniform
    const tunicColor = isTanker
      ? (isSoviet ? '#34392f' : '#202226')
      : (isSoviet ? '#6f6b47' : '#576352');
    const foldColor = isTanker
      ? (isSoviet ? '#272b23' : '#16181b')
      : (isSoviet ? '#575336' : '#434d3f');

    ctx.fillStyle = tunicColor;
    ctx.strokeStyle = '#181c16';
    ctx.lineWidth = 1.05;
    ctx.beginPath();
    ctx.moveTo(lenBack, -waistHalf);
    ctx.lineTo(lerp(0.5, 2.5, fallT), -shHalf);
    ctx.quadraticCurveTo(lenFront + 1.2, -shHalf * 0.55, lenFront, 0);
    ctx.quadraticCurveTo(lenFront + 1.2, shHalf * 0.55, lerp(0.5, 2.5, fallT), shHalf);
    ctx.lineTo(lenBack, waistHalf);
    ctx.quadraticCurveTo(lenBack - 1.5, 0, lenBack, -waistHalf);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Subtle fabric fold shading & collar
    ctx.strokeStyle = foldColor;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(lenBack + 1.2, -waistHalf * 0.5);
    ctx.lineTo(lenFront - 1.2, -shHalf * 0.3);
    ctx.moveTo(lenBack + 1.2, waistHalf * 0.5);
    ctx.lineTo(lenFront - 1.2, shHalf * 0.3);
    ctx.stroke();

    // Neck & collar
    ctx.fillStyle = '#c89b79';
    ctx.beginPath();
    ctx.arc(lerp(1.4, 3.0, fallT), 0, 2.5, 0, Math.PI * 2);
    ctx.fill();

    if (!isTanker) {
      if (isSoviet) {
        // Brown leather belt & twin Mosin pouches
        ctx.strokeStyle = '#3c2a1c';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(lenBack + 0.8, -waistHalf * 0.85);
        ctx.lineTo(lenBack + 0.8, waistHalf * 0.85);
        ctx.stroke();
        ctx.fillStyle = '#4e3724';
        ctx.fillRect(lenFront - 2.4, -5.2, 2.2, 3.2);
        ctx.fillRect(lenFront - 2.4, 2.0, 2.2, 3.2);
        // Rear canvas pack / roll
        ctx.fillStyle = '#605a42';
        ctx.strokeStyle = '#252319';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.roundRect(lenBack - 1.6, -4.0, 3.2, 8.0, 1.0);
        ctx.fill();
        ctx.stroke();
      } else {
        // German Y-strap webbing, twin triple-cell Kar98k pouches, breadbag & canteen
        ctx.strokeStyle = '#2a2822';
        ctx.lineWidth = 1.35;
        ctx.beginPath();
        ctx.moveTo(lenBack + 0.5, -waistHalf * 0.68);
        ctx.lineTo(lerp(0.5, 1.5, fallT), 0);
        ctx.lineTo(lenBack + 0.5, waistHalf * 0.68);
        ctx.stroke();
        // Front Kar98k ammo pouches
        ctx.fillStyle = '#23201b';
        ctx.fillRect(lenFront - 2.2, -5.2, 2.0, 3.4);
        ctx.fillRect(lenFront - 2.2, 1.8, 2.0, 3.4);
        // Rear breadbag & canteen
        ctx.fillStyle = '#5f5844';
        ctx.strokeStyle = '#1b1d17';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.roundRect(lenBack - 1.4, -3.8, 3.2, 5.4, 0.9);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#464035';
        ctx.beginPath();
        ctx.arc(lenBack - 0.2, 3.4, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Tanker belt & harness
      ctx.strokeStyle = '#181816';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(lenBack + 0.8, -waistHalf * 0.8);
      ctx.lineTo(lenBack + 0.8, waistHalf * 0.8);
      ctx.stroke();
    }

    ctx.restore();
  }

  _drawArm(ctx, shoulder, elbow, hand) {
    const isTanker = this.uniformStyle === 'tanker';
    const isSoviet = this.faction === 'soviet';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Dark outline
    ctx.strokeStyle = '#181c16';
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    ctx.moveTo(shoulder.x, shoulder.y);
    ctx.lineTo(elbow.x, elbow.y);
    ctx.lineTo(hand.x, hand.y);
    ctx.stroke();

    // Sleeve
    const sleeveColor = isTanker
      ? (isSoviet ? '#31362c' : '#1e2024')
      : (isSoviet ? '#686442' : '#525d4d');
    ctx.strokeStyle = sleeveColor;
    ctx.lineWidth = 2.9;
    ctx.beginPath();
    ctx.moveTo(shoulder.x, shoulder.y);
    ctx.lineTo(elbow.x, elbow.y);
    ctx.lineTo(hand.x, hand.y);
    ctx.stroke();

    // Distinct hand
    ctx.fillStyle = '#cfa382';
    ctx.strokeStyle = '#3d2c20';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(hand.x, hand.y, 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  _drawWeapon(ctx, butt, fore, muzzle) {
    if (this.weaponCfg?.id === 'PPSH_41') {
      this._drawPPSh41(ctx, butt, fore, muzzle);
    } else {
      this._drawKar98k(ctx, butt, fore, muzzle);
    }
  }

  _drawPPSh41(ctx, butt, fore, muzzle) {
    const dx = muzzle.x - butt.x;
    const dy = muzzle.y - butt.y;
    const len = Math.hypot(dx, dy) || 1;
    const ang = Math.atan2(dy, dx);
    // Compact SMG proportions (shorter than full-length Mosin/Kar98k)
    const smgLen = Math.min(len, 17.5);
    const drumShift =
      this.aiState === AI_STATE.RELOADING
        ? Math.sin(this._drumReloadProgress * Math.PI) * 3.8
        : 0;

    ctx.save();
    ctx.translate(butt.x, butt.y);
    ctx.rotate(ang);

    // 1. Curved wooden stock & handguard
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#24170c';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(smgLen * 0.44, 0);
    ctx.stroke();

    ctx.strokeStyle = '#7b4d29';
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.moveTo(0.4, 0);
    ctx.lineTo(smgLen * 0.43, 0);
    ctx.stroke();

    // 2. Stamped steel receiver + charging handle knob
    ctx.fillStyle = '#2a2e32';
    ctx.strokeStyle = '#121416';
    ctx.lineWidth = 0.6;
    ctx.fillRect(smgLen * 0.36, -1.25, smgLen * 0.24, 2.5);
    ctx.strokeRect(smgLen * 0.36, -1.25, smgLen * 0.24, 2.5);
    // Charging handle
    ctx.fillStyle = '#5d656d';
    ctx.fillRect(smgLen * 0.46, 1.1, 1.3, 1.1);

    // 3. Distinctive 71-round circular drum magazine
    ctx.save();
    ctx.translate(smgLen * 0.56, 1.6 + drumShift);
    ctx.fillStyle = '#262a2e';
    ctx.strokeStyle = '#101214';
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.arc(0, 0, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Drum hub & ribs
    ctx.strokeStyle = '#4e545c';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.arc(0, 0, 1.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 4. Perforated barrel shroud + front/rear sights + muzzle
    const shroudStart = smgLen * 0.58;
    const shroudLen = smgLen * 0.38;
    ctx.fillStyle = '#31363b';
    ctx.strokeStyle = '#141618';
    ctx.lineWidth = 0.6;
    ctx.fillRect(shroudStart, -1.05, shroudLen, 2.1);
    // Cooling slots along perforated shroud
    ctx.fillStyle = '#111315';
    for (let s = 0; s < 4; s++) {
      ctx.fillRect(shroudStart + 0.8 + s * (shroudLen * 0.23), -0.5, 1.0, 1.0);
    }
    // Front & rear sight + short muzzle tip
    ctx.fillStyle = '#626a72';
    ctx.fillRect(smgLen * 0.40, -0.5, 0.9, 1.0);
    ctx.fillRect(shroudStart + shroudLen - 1.0, -0.5, 0.9, 1.0);
    ctx.fillStyle = '#1f2226';
    ctx.fillRect(shroudStart + shroudLen, -0.55, 1.2, 1.1);

    ctx.restore();
  }

  _drawKar98k(ctx, butt, fore, muzzle) {
    const isSoviet = this.faction === 'soviet';
    ctx.lineCap = 'round';
    // Rifle outline
    ctx.strokeStyle = '#24180e';
    ctx.lineWidth = 3.1;
    ctx.beginPath();
    ctx.moveTo(butt.x, butt.y);
    ctx.lineTo(fore.x, fore.y);
    ctx.stroke();

    // Wooden stock (Mosin-Nagant reddish-birch vs Kar98k dark walnut)
    ctx.strokeStyle = isSoviet ? '#7d4d29' : '#654226';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(butt.x, butt.y);
    ctx.lineTo(fore.x, fore.y);
    ctx.stroke();

    // Receiver & bolt handle detail
    const recX = lerp(butt.x, fore.x, 0.45);
    const recY = lerp(butt.y, fore.y, 0.45);
    ctx.fillStyle = '#2b3034';
    ctx.beginPath();
    ctx.arc(recX, recY, 1.45, 0, Math.PI * 2);
    ctx.fill();

    // Steel barrel + front sight
    ctx.strokeStyle = '#23272b';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(fore.x, fore.y);
    ctx.lineTo(muzzle.x, muzzle.y);
    ctx.stroke();

    ctx.strokeStyle = '#5c646c';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(fore.x, fore.y);
    ctx.lineTo(muzzle.x, muzzle.y);
    ctx.stroke();

    // Fixed bayonet attached to rifle muzzle when equipped
    if (this.inventory?.bayonetEquipped && this.inventory?.hasBayonet) {
      const bAng = Math.atan2(muzzle.y - fore.y, muzzle.x - fore.x);
      const bLen = isSoviet ? 6.4 : 5.6;
      const tipX = muzzle.x + Math.cos(bAng) * bLen;
      const tipY = muzzle.y + Math.sin(bAng) * bLen;
      ctx.strokeStyle = '#b9c4ce';
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.moveTo(muzzle.x, muzzle.y);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
    }
  }

  _drawStahlhelm(ctx, x, y, tilt) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);

    const isSoviet = this.faction === 'soviet';

    if (this.uniformStyle === 'tanker') {
      if (isSoviet) {
        // Soviet TSH-4 padded tanker helmet with ribbed crown & ear cups
        ctx.fillStyle = '#282b24';
        ctx.strokeStyle = '#10120e';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.ellipse(0, 0, 5.2, 5.0, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Earphone cups
        ctx.fillStyle = '#1b1d18';
        ctx.fillRect(-1.8, -5.8, 3.6, 1.8);
        ctx.fillRect(-1.8, 4.0, 3.6, 1.8);
        // Characteristic padded ribs
        ctx.strokeStyle = '#404439';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(-3.2, 0);
        ctx.lineTo(3.2, 0);
        ctx.moveTo(-2.5, -2.3);
        ctx.lineTo(2.5, -2.3);
        ctx.moveTo(-2.5, 2.3);
        ctx.lineTo(2.5, 2.3);
        ctx.stroke();
      } else {
        // German Panzer black side cap (Schiffchen) + headset
        ctx.fillStyle = '#191b1e';
        ctx.strokeStyle = '#0d0e10';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.ellipse(0, 0, 5.3, 4.1, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = '#3c4046';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(-3.4, 0);
        ctx.lineTo(3.4, 0);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    if (this.isOfficer && isSoviet) {
      // Historical WWII Soviet officer peaked visor cap (furazhka)
      ctx.fillStyle = '#181a16';
      ctx.beginPath();
      ctx.ellipse(3.6, 0, 2.5, 3.8, 0, -Math.PI * 0.45, Math.PI * 0.45);
      ctx.fill();
      // Khaki-olive crown
      ctx.fillStyle = '#535f3b';
      ctx.strokeStyle = '#232818';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.ellipse(-0.3, 0, 5.4, 5.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Crimson/red officer cap band & star
      ctx.strokeStyle = '#8b2424';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(0.3, 0, 3.8, 3.7, 0, -Math.PI * 0.55, Math.PI * 0.55);
      ctx.stroke();
      ctx.fillStyle = '#d44438';
      ctx.beginPath();
      ctx.arc(3.0, 0, 1.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    if (isSoviet) {
      // Soviet SSh-40 steel helmet (rounded olive-green dome)
      ctx.fillStyle = '#4e5838';
      ctx.strokeStyle = '#1c2114';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.ellipse(0, 0, 5.2, 4.9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#626e47';
      ctx.beginPath();
      ctx.ellipse(0.6, -0.3, 3.4, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // German M40/M42 Stahlhelm (flared neck guard silhouette + subtle metal highlight)
      ctx.fillStyle = '#464e42';
      ctx.strokeStyle = '#161b14';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.ellipse(0, 0, 5.5, 5.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#5c6657';
      ctx.strokeStyle = '#2b3128';
      ctx.lineWidth = 0.65;
      ctx.beginPath();
      ctx.ellipse(0.6, 0, 3.8, 3.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }
}

/**
 * Spawns exactly 8 German infantrymen in world coordinates around the Panzer III,
 * clear of the hull/turret and spaced for individual recognition.
 */
export function createPanzerIIISquad(centerX = 2060, centerY = 1480) {
  const offsets = [
    { dx: -130, dy: 115, angle: 2.35 },  // 1. Front-left scout
    { dx: -68, dy: 165, angle: 2.15 },   // 2. Front-right rifleman
    { dx: -155, dy: -25, angle: 2.95 },  // 3. Left flank forward
    { dx: -125, dy: -135, angle: -2.8 }, // 4. Left flank rear
    { dx: 105, dy: 130, angle: 1.75 },   // 5. Right flank forward
    { dx: 158, dy: 20, angle: 1.15 },    // 6. Right flank rear
    { dx: -15, dy: -165, angle: -1.45 }, // 7. Rear guard left
    { dx: 115, dy: -135, angle: -0.75 }, // 8. Rear guard right
  ];

  return offsets.map(
    (o, idx) => new GermanSoldier(idx + 1, centerX + o.dx, centerY + o.dy, o.angle)
  );
}
