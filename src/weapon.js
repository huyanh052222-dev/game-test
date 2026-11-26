/**
 * Weapon systems for the T-34-85:
 * - MainGun (85mm ZiS-S-53) with 56-round ammo, 8.5s reload, and recoil
 * - SharedMGAmmoPool (1,890 rounds total = 30 x 63-round pan magazines)
 * - MachineGun (7.62mm DT) with independent 600 RPM fire, magazine swap, and overheat
 */
import { CONFIG } from './config.js';
import { CREW_EVENT } from './crewVoice.js';

export class MainGun {
  constructor(projectiles, particles, sound, camera) {
    this.projectiles = projectiles;
    this.particles = particles;
    this.sound = sound;
    this.camera = camera;

    this.ammoMax = CONFIG.MAIN_GUN.AMMO_MAX;
    this.ammoByType = {
      BR365K: 24, // APHEBC
      BR365A: 12, // APHE
      BR365P: 6,  // APCR
      O365K: 14,  // HE (O-365K)
    };
    this.selectedAmmoId = 'BR365K';
    this.loadedAmmoId = 'BR365K';
    this.isReloading = false;
    this.reloadTimer = 0;
    this.reloadDuration = CONFIG.MAIN_GUN.RELOAD_TIME;
    this.recoilOffset = 0;
  }

  get ammo() {
    return (
      (this.ammoByType.BR365K || 0) +
      (this.ammoByType.BR365A || 0) +
      (this.ammoByType.BR365P || 0) +
      (this.ammoByType.O365K || 0)
    );
  }

  getAmmoCount(ammoId) {
    return this.ammoByType[ammoId] || 0;
  }

  setAmmoType(ammoId) {
    if (!Object.prototype.hasOwnProperty.call(this.ammoByType, ammoId)) return false;
    if ((this.ammoByType[ammoId] || 0) <= 0) return false;
    this.selectedAmmoId = ammoId;
    if (!this.isReloading && this.loadedAmmoId !== ammoId && this.ammo > 0) {
      this.isReloading = true;
      this.reloadTimer = this.reloadDuration;
    }
    return true;
  }

  get reloadProgress() {
    if (!this.isReloading) return 1;
    return 1 - Math.max(0, this.reloadTimer / this.reloadDuration);
  }

  canFire(damageSystem = null) {
    if (this.ammo <= 0 || this.isReloading) return false;
    if (damageSystem) {
      if (damageSystem.vehicleDestroyed) return false;
      if (damageSystem.getState('GUN_BARREL') === 'DESTROYED') return false;
      if (!damageSystem.isCrewOperable('GUNNER')) return false;
    }
    return true;
  }

  tryFire(muzzleX, muzzleY, angle, damageSystem = null) {
    if (!this.canFire(damageSystem)) return false;

    const firedAmmoId =
      (this.ammoByType[this.loadedAmmoId] || 0) > 0
        ? this.loadedAmmoId
        : (Object.keys(this.ammoByType).find((k) => this.ammoByType[k] > 0) || this.selectedAmmoId);

    this.ammoByType[firedAmmoId] = Math.max(0, (this.ammoByType[firedAmmoId] || 0) - 1);
    this.recoilOffset = CONFIG.MAIN_GUN.RECOIL_DISTANCE;

    if (this.ammo > 0) {
      if ((this.ammoByType[this.selectedAmmoId] || 0) <= 0) {
        const fallback = Object.keys(this.ammoByType).find((k) => this.ammoByType[k] > 0);
        if (fallback) this.selectedAmmoId = fallback;
      }
      this.isReloading = true;
      this.reloadTimer = this.reloadDuration;
    }

    let fireAngle = angle;
    if (damageSystem) {
      const barrelState = damageSystem.getState('GUN_BARREL');
      if (barrelState === 'DAMAGED') {
        fireAngle += (Math.random() - 0.5) * 0.05;
      } else if (barrelState === 'CRITICAL') {
        fireAngle += (Math.random() - 0.5) * 0.12;
      }
    }

    this.projectiles.spawnCannonShell(
      muzzleX,
      muzzleY,
      fireAngle,
      firedAmmoId,
      this.ownerTank?.faction || 'soviet',
      this.ownerTank || null
    );
    this.particles.spawnCannonMuzzleBlast(muzzleX, muzzleY, fireAngle);
    this.camera.addShake(CONFIG.CAMERA.CANNON_SHAKE_AMOUNT);
    this.sound.playCannon();
    this.sound.crew.trigger(CREW_EVENT.CANNON_FIRED, 0.08);
    return true;
  }

  update(dt, damageSystem = null) {
    if (this.recoilOffset > 0) {
      this.recoilOffset = Math.max(
        0,
        this.recoilOffset - CONFIG.MAIN_GUN.RECOIL_RECOVERY_SPEED * dt
      );
    }

    if (this.isReloading) {
      let reloadRate = 1.0;
      if (damageSystem) {
        const loaderState = damageSystem.getState('LOADER');
        if (!damageSystem.isCrewOperable('LOADER')) {
          reloadRate = 0; // Loader incapacitated/dead: cannot reload
        } else if (loaderState === 'DAMAGED') {
          reloadRate = 0.55; // Wounded loader: slower reload
        }
      }
      if (reloadRate > 0) {
        this.reloadTimer -= dt * reloadRate;
        if (this.reloadTimer <= 0) {
          this.reloadTimer = 0;
          this.isReloading = false;
          if ((this.ammoByType[this.selectedAmmoId] || 0) > 0) {
            this.loadedAmmoId = this.selectedAmmoId;
          } else {
            const fallback = Object.keys(this.ammoByType).find((k) => this.ammoByType[k] > 0);
            if (fallback) {
              this.loadedAmmoId = fallback;
              this.selectedAmmoId = fallback;
            }
          }
        }
      }
    }

    this.sound.crew.updateReloadProgress(this);
  }
}

export class SharedMGAmmoPool {
  constructor() {
    this.totalAmmo = CONFIG.MG.TOTAL_AMMO_MAX;
    this.totalAmmoMax = CONFIG.MG.TOTAL_AMMO_MAX;
  }
}

export class MachineGun {
  constructor(tag, ammoPool, projectiles, particles, sound) {
    this.tag = tag; // 'coax' or 'hull'
    this.ammoPool = ammoPool;
    this.projectiles = projectiles;
    this.particles = particles;
    this.sound = sound;

    this.magSize = CONFIG.MG.MAGAZINE_SIZE;
    this.magAmmo = Math.min(this.magSize, this.ammoPool.totalAmmo);
    this.isReloadingMag = false;
    this.magReloadTimer = 0;

    this.fireCooldown = 0;
    this.heat = 0;
    this.overheated = false;
    this.isFiring = false;
  }

  get heatRatio() {
    return this.heat / CONFIG.MG.HEAT_MAX;
  }

  get statusText() {
    if (this.ammoPool.totalAmmo <= 0 && this.magAmmo <= 0) return 'EMPTY';
    if (this.overheated) return 'OVERHEAT';
    if (this.isReloadingMag) return 'RELOADING MAG';
    if (this.isFiring) return 'FIRING';
    return 'READY';
  }

  update(dt, wantsFire, getMuzzleFn, disabled = false) {
    this.isFiring = false;
    if (disabled) wantsFire = false;

    if (this.fireCooldown > 0) {
      this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    }

    // Handle 63-round magazine swap with synchronized 3-stage reload audio
    if (this.isReloadingMag) {
      const owner = this.ownerTank;
      const rk = `mg_${this.tag}_${this._reloadSeqId || 0}`;
      if (disabled || owner?.damageSystem?.vehicleDestroyed || this.ammoPool.totalAmmo <= 0) {
        this.isReloadingMag = false;
        this.magReloadTimer = 0;
        this._reloadStage = 0;
        this.sound?.stopReloadSound?.(rk);
      } else {
        this.magReloadTimer -= dt;
        const progress = 1 - Math.max(0, this.magReloadTimer) / CONFIG.MG.MAG_RELOAD_TIME;
        const ox = owner?.x ?? 0;
        const oy = owner?.y ?? 0;
        const lx = owner?.camera?.x ?? ox;
        const ly = owner?.camera?.y ?? oy;

        if (this._reloadStage === 1 && progress >= 0.52) {
          this._reloadStage = 2;
          this.sound?.playMGReloadStage?.('pan_on', this.tag, ox, oy, lx, ly, rk);
        }

        if (this.magReloadTimer <= 0) {
          this.isReloadingMag = false;
          this.magReloadTimer = 0;
          this._reloadStage = 0;
          this.magAmmo = Math.min(this.magSize, this.ammoPool.totalAmmo);
          if (this.magAmmo > 0) {
            this.sound?.playMGReloadStage?.('rack', this.tag, ox, oy, lx, ly, rk);
          }
        }
      }
    }

    // Ensure magAmmo never exceeds remaining shared pool
    if (this.magAmmo > this.ammoPool.totalAmmo) {
      this.magAmmo = this.ammoPool.totalAmmo;
    }

    let firedThisFrame = false;

    if (
      wantsFire &&
      !this.overheated &&
      !this.isReloadingMag &&
      this.magAmmo > 0 &&
      this.ammoPool.totalAmmo > 0
    ) {
      this.isFiring = true;

      if (this.fireCooldown <= 0) {
        this._fireOneRound(getMuzzleFn());
        this.fireCooldown += CONFIG.MG.FIRE_INTERVAL;
        firedThisFrame = true;
      }
    }

    // Cooling when not actively firing (or while overheated)
    if (!firedThisFrame && !this.isFiring) {
      const coolRate = this.overheated
        ? CONFIG.MG.OVERHEAT_COOL_RATE
        : CONFIG.MG.COOL_RATE;
      this.heat = Math.max(0, this.heat - coolRate * dt);

      if (this.overheated && this.heat <= CONFIG.MG.RECOVERY_THRESHOLD) {
        this.overheated = false;
      }
    }
  }

  _fireOneRound(muzzle) {
    this.ammoPool.totalAmmo -= 1;
    this.magAmmo -= 1;

    const spread = (Math.random() - 0.5) * 2 * CONFIG.MG.SPREAD_RAD;
    const shotAngle = muzzle.angle + spread;

    this.projectiles.spawnMGBullet(
      muzzle.x,
      muzzle.y,
      shotAngle,
      this.tag,
      this.ownerTank?.faction || 'soviet',
      this.ownerTank || null
    );
    this.particles.spawnMGMuzzleFlash(muzzle.x, muzzle.y, muzzle.angle);
    this.sound.playMG(this.tag);

    // Increase independent barrel heat
    this.heat = Math.min(CONFIG.MG.HEAT_MAX, this.heat + CONFIG.MG.HEAT_PER_SHOT);
    if (this.heat >= CONFIG.MG.HEAT_MAX) {
      this.overheated = true;
      this.sound.playOverheat();
    }

    // Trigger magazine reload if 63-round pan is empty and reserve ammo remains
    if (this.magAmmo <= 0 && this.ammoPool.totalAmmo > 0 && !this.isReloadingMag) {
      this.isReloadingMag = true;
      this.magReloadTimer = CONFIG.MG.MAG_RELOAD_TIME;
      this._reloadSeqId = (this._reloadSeqId || 0) + 1;
      this._reloadStage = 1;
      const ox = this.ownerTank?.x ?? muzzle.x;
      const oy = this.ownerTank?.y ?? muzzle.y;
      const lx = this.ownerTank?.camera?.x ?? ox;
      const ly = this.ownerTank?.camera?.y ?? oy;
      this.sound?.playMGReloadStage?.('pan_off', this.tag, ox, oy, lx, ly, `mg_${this.tag}_${this._reloadSeqId}`);
    }
  }
}
