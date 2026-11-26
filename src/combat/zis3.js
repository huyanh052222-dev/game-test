/**
 * Soviet ZiS-3 Model 1942 76.2mm Divisional Field Gun + 3-Person Artillery Crew.
 * Isolated to SOVIET_TRENCH_DEFENSE mode.
 *
 * Crew:
 *  - COMMANDER: aiming optics, target observation, traverse/elevation
 *  - LOADER: ammunition handling & 7.0s breech reload cycle
 *  - GUNNER: firing mechanism & traverse/elevation support
 */
import { AMMO_TYPES, interpolatePenetration } from './projectileData.js';
import { CONFIG } from '../config.js';
import { AI_STATE } from '../infantry.js';

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class ZiS3FieldGun {
  constructor(x, y, baseAngle = -Math.PI / 2, options = {}) {
    this.id = options.id || 'zis3_1';
    this.designation = 'ZIS-3 76.2MM M1942';
    this.caliberMm = 76.2;
    this.faction = 'soviet';
    this.x = x;
    this.y = y;
    this.baseAngle = baseAngle;
    this.gunAngle = baseAngle;
    this.arcHalfAngle = options.arcHalfAngle ?? Math.PI * 0.44; // ~158 deg forward sector
    this.elevationDeg = 2.0;
    this.maxRangePx = 1350;

    this.hp = 240;
    this.maxHp = 240;
    this.destroyed = false;
    this.hitboxRadius = 24;

    this.baseReloadDuration = 7.0;
    this.reloadDuration = 7.0;
    this.reloadTimer = 0;
    this._reloadSeqId = 0;
    this._reloadStage = 0;

    this.ammo = {
      BR350A: 14,
      BR350B: 10,
      BR350SP: 8,
      BR354P: 6,
      OF350: 16,
      SH354: 10,
    };
    this.selectedAmmoId = 'BR350A';

    // 3-person crew references (GermanSoldier instances with isArtilleryCrew = true)
    this.crew = {
      COMMANDER: options.commander || null,
      LOADER: options.loader || null,
      GUNNER: options.gunner || null,
    };

    this._recoil = 0;
    this._muzzleFlash = 0;
    this._scanTimer = 0;
    this._target = null;
    this._aimSettleTimer = 0;
  }

  getCrewAliveCount() {
    let n = 0;
    for (const role of ['COMMANDER', 'LOADER', 'GUNNER']) {
      const c = this.crew[role];
      if (c && c.alive && c.combatCapable !== false) n++;
    }
    return n;
  }

  get operational() {
    if (this.destroyed) return false;
    const cmdOk = Boolean(this.crew.COMMANDER?.alive && this.crew.COMMANDER?.combatCapable !== false);
    const gnrOk = Boolean(this.crew.GUNNER?.alive && this.crew.GUNNER?.combatCapable !== false);
    return (cmdOk || gnrOk) && this.getCrewAliveCount() >= 2;
  }

  getTotalAmmo() {
    return Object.values(this.ammo).reduce((sum, v) => sum + v, 0);
  }

  takeDamage(dmg, particles = null, sound = null) {
    if (this.destroyed) return false;
    this.hp = Math.max(0, this.hp - dmg);
    if (particles) {
      particles.spawnSpark?.(this.x, this.y, Math.random() * Math.PI * 2, 6);
    }
    if (this.hp <= 0) {
      this.destroyed = true;
      if (this._reloadStage > 0) {
        sound?.stopReloadSound?.(`zis3_${this._reloadSeqId}`);
      }
      this._reloadStage = 0;
      for (const role of ['COMMANDER', 'LOADER', 'GUNNER']) {
        const c = this.crew[role];
        if (c) {
          c.isArtilleryCrew = false;
          c.artilleryGun = null;
        }
      }
      if (particles) {
        particles.spawnSmokeCloud?.(this.x, this.y, 18, 42, 5.0, 0.75, 48);
      }
      return true;
    }
    return false;
  }

  _inFiringArc(tx, ty) {
    const ang = Math.atan2(ty - this.y, tx - this.x);
    return Math.abs(normalizeAngle(ang - this.baseAngle)) <= this.arcHalfAngle;
  }

  _hasClearFireLine(tx, ty, tanks, environment) {
    if (environment && typeof environment.hasLineOfSight === 'function') {
      if (!environment.hasLineOfSight(this.x, this.y, tx, ty)) return false;
    }
    const dx = tx - this.x;
    const dy = ty - this.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1) return false;
    for (const t of tanks) {
      if (!t || t.faction !== this.faction || t.destroyed) continue;
      const proj = Math.max(0, Math.min(1, ((t.x - this.x) * dx + (t.y - this.y) * dy) / lenSq));
      if (proj <= 0.05 || proj >= 0.98) continue;
      const px = this.x + proj * dx;
      const py = this.y + proj * dy;
      if (Math.hypot(t.x - px, t.y - py) < (t.halfWidth || 54) + 12) return false;
    }
    return true;
  }

  selectBestAmmo(tgt) {
    if (!tgt) return this.selectedAmmoId;
    const isTank = typeof tgt.getOBB === 'function';
    const distMeters = Math.hypot(tgt.x - this.x, tgt.y - this.y) / CONFIG.TANK.PIXELS_PER_METER;

    if (isTank) {
      const apcrPen = interpolatePenetration(AMMO_TYPES.BR354P, distMeters);
      const bPen = interpolatePenetration(AMMO_TYPES.BR350B, distMeters);
      if (this.ammo.BR354P > 0 && distMeters <= 320 && apcrPen >= bPen + 14) {
        this.selectedAmmoId = 'BR354P';
        return 'BR354P';
      }
      if (this.ammo.BR350B > 0) {
        this.selectedAmmoId = 'BR350B';
        return 'BR350B';
      }
      if (this.ammo.BR350A > 0) {
        this.selectedAmmoId = 'BR350A';
        return 'BR350A';
      }
      if (this.ammo.BR350SP > 0) {
        this.selectedAmmoId = 'BR350SP';
        return 'BR350SP';
      }
      if (this.ammo.BR354P > 0) {
        this.selectedAmmoId = 'BR354P';
        return 'BR354P';
      }
      if (this.ammo.OF350 > 0) {
        this.selectedAmmoId = 'OF350';
        return 'OF350';
      }
    } else {
      // Anti-personnel: Sh-354 Shrapnel at close/medium range, OF-350 HE at longer range
      if (this.ammo.SH354 > 0 && distMeters <= 220) {
        this.selectedAmmoId = 'SH354';
        return 'SH354';
      }
      if (this.ammo.OF350 > 0) {
        this.selectedAmmoId = 'OF350';
        return 'OF350';
      }
      if (this.ammo.SH354 > 0) {
        this.selectedAmmoId = 'SH354';
        return 'SH354';
      }
      for (const fallback of ['BR350A', 'BR350B', 'BR350SP', 'BR354P']) {
        if (this.ammo[fallback] > 0) {
          this.selectedAmmoId = fallback;
          return fallback;
        }
      }
    }
    return this.selectedAmmoId;
  }

  _findTarget(tanks, infantry, environment) {
    // Prioritize operational German tanks within arc, then German infantry
    let bestTank = null;
    let bestTankDist = Infinity;
    for (const t of tanks) {
      if (!t || t.faction === this.faction || t.destroyed || t.damageSystem?.vehicleDestroyed) continue;
      if (t.damageSystem?.vehicleAbandoned || t.vehicleState === 'BURNT_OUT') continue;
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (d > this.maxRangePx) continue;
      if (!this._inFiringArc(t.x, t.y)) continue;
      if (!this._hasClearFireLine(t.x, t.y, tanks, environment)) continue;
      if (d < bestTankDist) {
        bestTankDist = d;
        bestTank = t;
      }
    }
    if (bestTank) return bestTank;

    let bestInf = null;
    let bestInfDist = Infinity;
    for (const s of infantry) {
      if (!s || !s.alive || s.inVehicle || s.faction === this.faction) continue;
      const d = Math.hypot(s.x - this.x, s.y - this.y);
      if (d > this.maxRangePx) continue;
      if (!this._inFiringArc(s.x, s.y)) continue;
      if (!this._hasClearFireLine(s.x, s.y, tanks, environment)) continue;
      if (d < bestInfDist) {
        bestInfDist = d;
        bestInf = s;
      }
    }
    return bestInf;
  }

  _syncCrewPositions(dt) {
    const cos = Math.cos(this.gunAngle);
    const sin = Math.sin(this.gunAngle);
    const perpX = -sin;
    const perpY = cos;

    const offsets = {
      COMMANDER: { back: 12, side: -19 },
      GUNNER: { back: 32, side: -10 },
      LOADER: { back: 20, side: 19 },
    };

    for (const role of ['COMMANDER', 'LOADER', 'GUNNER']) {
      const c = this.crew[role];
      if (!c || !c.alive || c.combatCapable === false || this.destroyed) continue;
      const off = offsets[role];
      c.isArtilleryCrew = true;
      c.artilleryRole = role;
      c.artilleryGun = this;
      c.x = this.x - cos * off.back + perpX * off.side;
      c.y = this.y - sin * off.back + perpY * off.side;
      c.angle = this.gunAngle;
      c.baseAngle = this.gunAngle;
      c.vx = 0;
      c.vy = 0;

      if (role === 'LOADER' && this.reloadTimer > 0) {
        c.aiState = AI_STATE.RELOADING;
        c._reloadPhase = (c._reloadPhase || 0) + dt * 5.2;
      } else {
        c.aiState = AI_STATE.CROUCHING;
      }
    }
  }

  update(dt, { infantry = [], tanks = [], environment = null, projectiles = null, particles = null, sound = null, listenerX = this.x, listenerY = this.y } = {}) {
    this._recoil = Math.max(0, this._recoil - dt * 14);
    this._muzzleFlash = Math.max(0, this._muzzleFlash - dt);
    this._syncCrewPositions(dt);

    if (!this.operational) {
      this._target = null;
      this._aimSettleTimer = 0;
      if (this._reloadStage > 0) {
        sound?.stopReloadSound?.(`zis3_${this._reloadSeqId}`);
        this._reloadStage = 0;
      }
      return;
    }

    // Reload timer (7.0s nominal; slowed if loader is wounded or absent)
    if (this.reloadTimer > 0) {
      const loader = this.crew.LOADER;
      const loaderAlive = Boolean(loader && loader.alive && loader.combatCapable !== false);
      let reloadRate = 1.0;
      if (!loaderAlive) reloadRate = 0.54;
      else if (loader.wounded) reloadRate = 0.62;

      this.reloadTimer = Math.max(0, this.reloadTimer - dt * reloadRate);
      if (sound) {
        const p = 1 - this.reloadTimer / this.reloadDuration;
        const rk = `zis3_${this._reloadSeqId}`;
        if (this._reloadStage === 0 && p >= 0.14) {
          this._reloadStage = 1;
          sound.playPanzerReloadStage?.('breech_open', this.x, this.y, listenerX, listenerY, rk);
        } else if (this._reloadStage === 1 && p >= 0.86) {
          this._reloadStage = 2;
          sound.playPanzerReloadStage?.('breech_close', this.x, this.y, listenerX, listenerY, rk);
        }
      }
      if (this.reloadTimer <= 0) {
        this._reloadStage = 0;
      }
    }

    // Direct Player Possession override (CUSTOM_BATTLE mode)
    if (this.isPlayerPossessed && arguments[1]?.playerInput) {
      const inp = arguments[1].playerInput;
      const keys = ['BR350A', 'BR350B', 'BR350SP', 'BR354P', 'OF350', 'SH354'];
      for (let k = 0; k < keys.length; k++) {
        if (inp.isDown(`Digit${k + 1}`) && (this.ammo[keys[k]] || 0) > 0) {
          this.selectedAmmoId = keys[k];
        }
      }
      const turnDir = (inp.isAnyDown('KeyD', 'KeyE', 'ArrowRight') ? 1 : 0) - (inp.isAnyDown('KeyA', 'KeyQ', 'ArrowLeft') ? 1 : 0);
      if (turnDir !== 0) {
        const nextAng = this.gunAngle + turnDir * 0.65 * dt;
        const clamped = this.baseAngle + Math.max(-this.arcHalfAngle, Math.min(this.arcHalfAngle, normalizeAngle(nextAng - this.baseAngle)));
        this.gunAngle = clamped;
      }
      if (this.reloadTimer <= 0 && inp.isDown('Space') && this.getTotalAmmo() > 0 && projectiles) {
        let ammoId = this.selectedAmmoId;
        if ((this.ammo[ammoId] || 0) <= 0) {
          ammoId = keys.find((k) => (this.ammo[k] || 0) > 0) || ammoId;
          this.selectedAmmoId = ammoId;
        }
        if ((this.ammo[ammoId] || 0) > 0) {
          this.ammo[ammoId] -= 1;
          const mx = this.x + Math.cos(this.gunAngle) * 52;
          const my = this.y + Math.sin(this.gunAngle) * 52;
          projectiles.spawnArtilleryShell(mx, my, this.gunAngle, ammoId, this.faction, this);
          particles?.spawnCannonMuzzleBlast?.(mx, my, this.gunAngle);
          sound?.playCannon?.();
          this._recoil = 8.5;
          this._muzzleFlash = 0.08;
          this.reloadTimer = this.reloadDuration;
          this._reloadSeqId += 1;
          this._reloadStage = 0;
        }
      }
      return;
    }

    this._scanTimer -= dt;
    if (this._scanTimer <= 0) {
      this._scanTimer = 0.22;
      this._target = this._findTarget(tanks, infantry, environment);
    }

    if (this._target) {
      const t = this._target;
      const invalid =
        t.alive === false ||
        t.inVehicle === true ||
        t.destroyed ||
        t.damageSystem?.vehicleDestroyed ||
        !this._inFiringArc(t.x, t.y) ||
        !this._hasClearFireLine(t.x, t.y, tanks, environment);
      if (invalid) {
        this._target = null;
        this._aimSettleTimer = 0;
      }
    }

    if (!this._target) {
      this._aimSettleTimer = 0;
      return;
    }

    const desiredAngle = Math.atan2(this._target.y - this.y, this._target.x - this.x);
    const clampedDesired = this.baseAngle + Math.max(-this.arcHalfAngle, Math.min(this.arcHalfAngle, normalizeAngle(desiredAngle - this.baseAngle)));
    const diff = normalizeAngle(clampedDesired - this.gunAngle);
    const traverseRate = 0.55; // Handwheel traverse (~31 deg/s)
    const step = traverseRate * dt;
    if (Math.abs(diff) <= step) {
      this.gunAngle = clampedDesired;
    } else {
      this.gunAngle += Math.sign(diff) * step;
    }

    const distMeters = Math.hypot(this._target.x - this.x, this._target.y - this.y) / CONFIG.TANK.PIXELS_PER_METER;
    this.elevationDeg = Math.min(18, Math.max(0.5, distMeters * 0.045));

    if (Math.abs(diff) < 0.05) {
      this._aimSettleTimer += dt;
    } else {
      this._aimSettleTimer = 0;
    }

    if (this.reloadTimer <= 0 && this._aimSettleTimer >= 0.4 && this.getTotalAmmo() > 0 && projectiles) {
      const ammoId = this.selectBestAmmo(this._target);
      if ((this.ammo[ammoId] || 0) > 0) {
        this.ammo[ammoId] -= 1;
        const mx = this.x + Math.cos(this.gunAngle) * 52;
        const my = this.y + Math.sin(this.gunAngle) * 52;
        const spread = (Math.random() - 0.5) * 0.016;
        projectiles.spawnArtilleryShell(mx, my, this.gunAngle + spread, ammoId, this.faction, this);
        particles?.spawnCannonMuzzleBlast?.(mx, my, this.gunAngle);
        sound?.playCannon?.();
        this._recoil = 8.5;
        this._muzzleFlash = 0.08;
        this.reloadTimer = this.reloadDuration;
        this._reloadSeqId += 1;
        this._reloadStage = 0;
        this._aimSettleTimer = 0;
      }
    }
  }

  getHudStatus() {
    const aliveCount = this.getCrewAliveCount();
    const roleState = (r) => {
      const c = this.crew[r];
      if (!c || !c.alive) return 'KIA';
      if (c.combatCapable === false) return 'DOWN';
      return c.wounded ? 'WND' : 'OK';
    };
    return {
      designation: this.designation,
      caliber: '76.2 mm',
      selectedAmmoId: this.selectedAmmoId,
      ammo: { ...this.ammo },
      reloadTimer: this.reloadTimer,
      reloadDuration: this.reloadDuration,
      reloadProgress: this.reloadTimer > 0 ? Math.max(0, Math.min(1, 1 - this.reloadTimer / this.reloadDuration)) : 1,
      reloading: this.reloadTimer > 0,
      crewAlive: aliveCount,
      crewTotal: 3,
      crewRoles: {
        COMMANDER: roleState('COMMANDER'),
        LOADER: roleState('LOADER'),
        GUNNER: roleState('GUNNER'),
      },
      hp: this.hp,
      maxHp: this.maxHp,
      destroyed: this.destroyed,
      operational: this.operational,
    };
  }

  render(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);

    // Ammunition crates beside the emplacement
    ctx.save();
    ctx.rotate(this.baseAngle);
    ctx.fillStyle = '#4f5a38';
    ctx.strokeStyle = '#222818';
    ctx.lineWidth = 1.2;
    ctx.fillRect(-26, 22, 16, 10);
    ctx.strokeRect(-26, 22, 16, 10);
    ctx.fillRect(-8, 24, 14, 9);
    ctx.strokeRect(-8, 24, 14, 9);
    ctx.restore();

    ctx.rotate(this.gunAngle);
    const kick = -this._recoil;

    // Split-trail carriage legs & spades
    ctx.strokeStyle = this.destroyed ? '#2b2d29' : '#3d4830';
    ctx.lineWidth = 4.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-4, -3);
    ctx.lineTo(-34, -18);
    ctx.moveTo(-4, 3);
    ctx.lineTo(-34, 18);
    ctx.stroke();

    // Two large artillery wheels
    ctx.fillStyle = '#1b1d1a';
    ctx.strokeStyle = '#3c4235';
    ctx.lineWidth = 1.4;
    ctx.fillRect(-9, -22, 18, 5);
    ctx.strokeRect(-9, -22, 18, 5);
    ctx.fillRect(-9, 17, 18, 5);
    ctx.strokeRect(-9, 17, 18, 5);

    // Armored gun shield
    ctx.fillStyle = this.destroyed ? '#2c2f2a' : '#4b5b3d';
    ctx.strokeStyle = '#1d2217';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(6, -17);
    ctx.lineTo(10, -15);
    ctx.lineTo(10, 15);
    ctx.lineTo(6, 17);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Recoil cradle, breech block & aiming optics
    ctx.fillStyle = '#2d3328';
    ctx.fillRect(-14 + kick, -3.5, 24, 7);
    ctx.fillStyle = '#1f231c';
    ctx.fillRect(-17 + kick, -4.5, 6, 9);
    // Panoramic aiming optics on left side
    ctx.fillStyle = '#161a14';
    ctx.fillRect(0, -10, 5, 4);

    // 76.2mm long barrel + slotted muzzle brake
    ctx.fillStyle = this.destroyed ? '#242622' : '#3f4c33';
    ctx.strokeStyle = '#181c14';
    ctx.lineWidth = 1.0;
    ctx.fillRect(10 + kick, -2.3, 38, 4.6);
    ctx.strokeRect(10 + kick, -2.3, 38, 4.6);
    ctx.fillStyle = '#22261e';
    ctx.fillRect(46 + kick, -3.4, 7, 6.8);

    if (this._muzzleFlash > 0 && !this.destroyed) {
      ctx.fillStyle = 'rgba(255, 215, 110, 0.92)';
      ctx.beginPath();
      ctx.moveTo(54, 0);
      ctx.lineTo(74, -8);
      ctx.lineTo(69, 0);
      ctx.lineTo(74, 8);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }
}
