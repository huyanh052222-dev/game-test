/**
 * Soviet 12.7mm DShK Heavy Machine-Gun Emplacement.
 * - Fixed fortified sandbag pit & tripod/wheeled mount manned by a dedicated Soviet operator.
 * - Sustained automatic 12.7x108mm B-32 AP-I fire with arc limits, LOS checks, recoil, smoke & tracers.
 * - Reuses the existing T-34-85 DT machine-gun audio reference via sound.playDShKShot().
 */
import { AMMO_TYPES } from './projectileData.js';

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class HeavyMGPosition {
  constructor(id, x, y, baseAngle, options = {}) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.baseAngle = baseAngle;
    this.gunAngle = baseAngle;
    this.arcHalfAngle = options.arcHalfAngle ?? Math.PI * 0.48; // ~173 deg defensive sector
    this.maxRangePx = options.maxRangePx ?? 960;
    this.faction = options.faction || 'soviet';

    this.hp = 140;
    this.maxHp = 140;
    this.destroyed = false;
    this.hitboxRadius = 16;

    this.operator = options.operator || null;
    this.beltCapacity = 50;
    this.beltAmmo = 50;
    this.reserveAmmo = 250;
    this.reloading = false;
    this.reloadTimer = 0;
    this.reloadDuration = 3.2;

    this.shotInterval = 0.10; // ~600 RPM
    this._fireTimer = 0;
    this._burstRemaining = 0;
    this._burstPause = 0;
    this._recoil = 0;
    this._muzzleFlash = 0;
    this._scanTimer = Math.random() * 0.15;
    this._target = null;
  }

  get operational() {
    return Boolean(
      !this.destroyed &&
      this.operator &&
      this.operator.alive &&
      this.operator.combatCapable !== false
    );
  }

  takeDamage(dmg, particles = null) {
    if (this.destroyed) return false;
    this.hp = Math.max(0, this.hp - dmg);
    if (particles) {
      particles.spawnSpark?.(this.x, this.y, Math.random() * Math.PI * 2, 4);
    }
    if (this.hp <= 0) {
      this.destroyed = true;
      if (this.operator) {
        this.operator.isHmgOperator = false;
        this.operator.hmgEmplacement = null;
      }
      if (particles) {
        particles.spawnSmokeCloud?.(this.x, this.y, 14, 34, 4.0, 0.7, 50);
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
    // Avoid firing through friendly tanks
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
      const clearR = (t.halfWidth || 54) + 10;
      if (Math.hypot(t.x - px, t.y - py) < clearR) return false;
    }
    return true;
  }

  _findTarget(infantry, tanks, environment) {
    let best = null;
    let bestTier = Infinity;
    let bestDist = Infinity;

    for (const s of infantry) {
      if (!s || !s.alive || s.inVehicle || s.faction === this.faction) continue;
      const d = Math.hypot(s.x - this.x, s.y - this.y);
      if (d > this.maxRangePx) continue;
      if (!this._inFiringArc(s.x, s.y)) continue;
      if (!this._hasClearFireLine(s.x, s.y, tanks, environment)) continue;
      const tier = s.combatCapable === false ? 1 : 0;
      if (tier < bestTier || (tier === bestTier && d < bestDist)) {
        bestTier = tier;
        bestDist = d;
        best = s;
      }
    }
    if (best) return best;

    // Secondary: harass light/unarmored or close-range enemy vehicles within arc (won't penetrate heavy frontal armor)
    for (const t of tanks) {
      if (!t || t.faction === this.faction || t.destroyed || t.damageSystem?.vehicleDestroyed) continue;
      if (t.damageSystem?.vehicleAbandoned || t.vehicleState === 'BURNING' || t.vehicleState === 'BURNT_OUT') continue;
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (d > 480) continue;
      if (!this._inFiringArc(t.x, t.y)) continue;
      if (!this._hasClearFireLine(t.x, t.y, tanks, environment)) continue;
      return t;
    }
    return null;
  }

  update(dt, { infantry = [], tanks = [], environment = null, projectiles = null, particles = null, sound = null, listenerX = this.x, listenerY = this.y } = {}) {
    this._recoil = Math.max(0, this._recoil - dt * 16);
    this._muzzleFlash = Math.max(0, this._muzzleFlash - dt);

    if (this.operator && this.operator.alive && !this.destroyed) {
      this.operator.isHmgOperator = true;
      this.operator.hmgEmplacement = this;
      this.operator.x = this.x - Math.cos(this.gunAngle) * 18;
      this.operator.y = this.y - Math.sin(this.gunAngle) * 18;
      this.operator.angle = this.gunAngle;
      this.operator.baseAngle = this.gunAngle;
      this.operator.vx = 0;
      this.operator.vy = 0;
    }

    if (!this.operational) {
      this._target = null;
      this._burstRemaining = 0;
      return;
    }

    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        const load = Math.min(this.beltCapacity - this.beltAmmo, this.reserveAmmo);
        this.beltAmmo += load;
        this.reserveAmmo -= load;
        this.reloading = false;
      }
      return;
    }

    if (this.beltAmmo <= 0) {
      if (this.reserveAmmo > 0) {
        this.reloading = true;
        this.reloadTimer = this.reloadDuration;
      }
      return;
    }

    // Direct Player Possession override (CUSTOM_BATTLE mode)
    if (this.isPlayerPossessed && arguments[1]?.playerInput) {
      const inp = arguments[1].playerInput;
      if (inp.isDown('KeyR') && this.beltAmmo < this.beltCapacity && this.reserveAmmo > 0) {
        this.reloading = true;
        this.reloadTimer = this.reloadDuration;
        return;
      }
      const turnDir = (inp.isAnyDown('KeyD', 'KeyE', 'ArrowRight') ? 1 : 0) - (inp.isAnyDown('KeyA', 'KeyQ', 'ArrowLeft') ? 1 : 0);
      if (turnDir !== 0) {
        const nextAng = this.gunAngle + turnDir * 2.1 * dt;
        this.gunAngle = this.baseAngle + Math.max(-this.arcHalfAngle, Math.min(this.arcHalfAngle, normalizeAngle(nextAng - this.baseAngle)));
      }
      this._fireTimer -= dt;
      if (inp.isAnyDown('Space', 'KeyZ') && this._fireTimer <= 0 && this.beltAmmo > 0 && projectiles) {
        this._fireTimer = this.shotInterval;
        this.beltAmmo -= 1;
        this._recoil = 3.2;
        this._muzzleFlash = 0.045;
        const shotAngle = this.gunAngle + (Math.random() - 0.5) * 0.036;
        const mx = this.x + Math.cos(this.gunAngle) * 28;
        const my = this.y + Math.sin(this.gunAngle) * 28;
        if (typeof projectiles.spawnRifleBullet === 'function') {
          projectiles.spawnRifleBullet(mx, my, shotAngle, 'DSHK_127', this.faction, this.operator?.id || this.id, 1080, 22);
        }
        particles?.spawnMGMuzzleFlash?.(mx, my, shotAngle);
        sound?.playDShKShot?.(mx, my, listenerX, listenerY, false);
      }
      return;
    }

    this._scanTimer -= dt;
    if (this._scanTimer <= 0) {
      this._scanTimer = 0.18;
      this._target = this._findTarget(infantry, tanks, environment);
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
      }
    }

    if (!this._target) {
      // Slowly return toward center of defensive sector
      const diff = normalizeAngle(this.baseAngle - this.gunAngle);
      const step = 0.8 * dt;
      if (Math.abs(diff) <= step) this.gunAngle = this.baseAngle;
      else this.gunAngle += Math.sign(diff) * step;
      return;
    }

    const desiredAngle = Math.atan2(this._target.y - this.y, this._target.x - this.x);
    const clampedDesired = this.baseAngle + Math.max(-this.arcHalfAngle, Math.min(this.arcHalfAngle, normalizeAngle(desiredAngle - this.baseAngle)));
    const diff = normalizeAngle(clampedDesired - this.gunAngle);
    const turnStep = 2.0 * dt;
    if (Math.abs(diff) <= turnStep) {
      this.gunAngle = clampedDesired;
    } else {
      this.gunAngle += Math.sign(diff) * turnStep;
    }

    if (this._burstPause > 0) {
      this._burstPause = Math.max(0, this._burstPause - dt);
      return;
    }

    if (Math.abs(diff) < 0.14) {
      if (this._burstRemaining <= 0) {
        this._burstRemaining = 5 + Math.floor(Math.random() * 4);
      }
      this._fireTimer -= dt;
      if (this._fireTimer <= 0 && this.beltAmmo > 0 && projectiles) {
        this._fireTimer = this.shotInterval;
        this.beltAmmo -= 1;
        this._burstRemaining -= 1;
        this._recoil = 3.2;
        this._muzzleFlash = 0.045;

        const spread = (Math.random() - 0.5) * 0.044;
        const shotAngle = this.gunAngle + spread;
        const mx = this.x + Math.cos(this.gunAngle) * 28;
        const my = this.y + Math.sin(this.gunAngle) * 28;

        if (typeof projectiles.spawnRifleBullet === 'function') {
          projectiles.spawnRifleBullet(
            mx,
            my,
            shotAngle,
            'DSHK_127',
            this.faction,
            this.operator?.id || this.id,
            1080,
            22
          );
        } else if (typeof projectiles.spawn === 'function') {
          projectiles.spawn({
            x: mx,
            y: my,
            angle: shotAngle,
            speed: 1080,
            ammo: AMMO_TYPES.DSHK_127,
            weaponType: 'mg',
            ownerFaction: this.faction,
            ownerEntity: this.operator || this,
            maxLifetime: 1.05,
            radius: 2.0,
            isTracer: true,
            damage: 22,
          });
        }

        if (particles) {
          particles.spawnMGMuzzleFlash?.(mx, my, shotAngle);
        }

        const obstructed = Boolean(
          environment &&
          typeof environment.hasLineOfSight === 'function' &&
          !environment.hasLineOfSight(listenerX, listenerY, mx, my)
        );
        sound?.playDShKShot?.(mx, my, listenerX, listenerY, obstructed);

        if (this._burstRemaining <= 0) {
          this._burstPause = 0.28 + Math.random() * 0.22;
        }
      }
    }
  }

  render(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);

    // Fortified sandbag semicircle parapet around the emplacement front
    ctx.save();
    ctx.rotate(this.baseAngle);
    for (let i = -3; i <= 3; i++) {
      const a = i * 0.34;
      const sx = Math.cos(a) * 20;
      const sy = Math.sin(a) * 20;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(a + Math.PI * 0.5);
      ctx.fillStyle = this.destroyed ? '#5e5242' : '#8a795c';
      ctx.strokeStyle = '#3b3326';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(-7, -3.5, 14, 7, 2.5);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // Fixed tripod/wheeled mount
    ctx.strokeStyle = '#252822';
    ctx.lineWidth = 2.4;
    for (const legAng of [this.baseAngle + 0.75, this.baseAngle - 0.75, this.baseAngle + Math.PI]) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(legAng) * 11, Math.sin(legAng) * 11);
      ctx.stroke();
    }

    // Gun body & 12.7mm barrel
    ctx.rotate(this.gunAngle);
    const kick = -this._recoil;

    // Ammo box & brass belt feed on left side
    ctx.fillStyle = '#3d4731';
    ctx.strokeStyle = '#1b2016';
    ctx.lineWidth = 1.1;
    ctx.fillRect(-5, -10, 9, 6);
    ctx.strokeRect(-5, -10, 9, 6);
    ctx.fillStyle = '#c89e48';
    ctx.fillRect(-2, -4, 4, 3);

    // DShK receiver + spade grips
    ctx.fillStyle = this.destroyed ? '#222222' : '#2d312c';
    ctx.fillRect(-9 + kick, -3.2, 16, 6.4);
    ctx.strokeStyle = '#151715';
    ctx.strokeRect(-9 + kick, -3.2, 16, 6.4);

    // Heavy ribbed barrel + muzzle brake
    ctx.fillStyle = '#1f2220';
    ctx.fillRect(7 + kick, -1.6, 20, 3.2);
    ctx.fillStyle = '#161816';
    ctx.fillRect(25 + kick, -2.4, 4.5, 4.8);

    // Muzzle flash
    if (this._muzzleFlash > 0 && !this.destroyed) {
      ctx.fillStyle = 'rgba(255, 224, 120, 0.92)';
      ctx.beginPath();
      ctx.moveTo(30, 0);
      ctx.lineTo(43, -4.5);
      ctx.lineTo(40, 0);
      ctx.lineTo(43, 4.5);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }
}
