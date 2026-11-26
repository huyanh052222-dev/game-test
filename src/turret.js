/**
 * Unstabilized T-34-85 Turret & 85mm Gun Assembly:
 * - World-space hull orientation vs. hull-relative turret orientation
 * - Mechanical turret ring inertia (lag & damped oscillation on hull turns)
 * - Unstabilized barrel elevation nod on acceleration/braking & terrain vibration
 * - Subtle coaxial MG barrel heat glow on prolonged firing
 */
import { CONFIG } from './config.js';
import { MainGun, MachineGun } from './weapon.js?v=9';
import { renderTurretInternals } from './xray.js';
import { renderArmorImpactMarks } from './combat/damageEffects.js';

function normalizeAngle(a) {
  let res = (a + Math.PI) % (Math.PI * 2);
  if (res < 0) res += Math.PI * 2;
  return res - Math.PI;
}

export class Turret {
  constructor(initialHullAngle, mgAmmoPool, projectiles, particles, sound, camera) {
    this.hullAngle = normalizeAngle(initialHullAngle);
    this.relativeAngle = 0; // Turret angle relative to hull (no world-space stabilizer)
    this.angularVelocity = 0;

    // Turret ring inertia (damped spring-mass lag when hull turns)
    this.inertiaOffset = 0;
    this.inertiaVel = 0;

    // Unstabilized 85mm barrel pitch & terrain vibration
    this.barrelPitch = 0;
    this.barrelPitchVel = 0;
    this.barrelWobbleAngle = 0;
    this._vibPhase = 0;
    this._cannonVibTimer = 0;
    this._prevTraverseDir = 0;

    this.mainGun = new MainGun(projectiles, particles, sound, camera);
    this.coaxMG = new MachineGun('coax', mgAmmoPool, projectiles, particles, sound);
    this.sound = sound;
    this.poweredTraverse = false;
    this.turretMarks = [];
    this.maxTurretMarks = 90;
  }

  addTurretMark(mark) {
    if (this.turretMarks.length >= this.maxTurretMarks) {
      this.turretMarks.shift();
    }
    this.turretMarks.push(mark);
  }

  get worldAngle() {
    return normalizeAngle(
      this.hullAngle + this.relativeAngle + this.inertiaOffset + this.barrelWobbleAngle
    );
  }

  update(dt, input, getPivotFn, hullMotion = {}) {
    const {
      hullAngle = this.hullAngle,
      hullAngularVel = 0,
      hullAngularAccel = 0,
      linearAccel = 0,
      speedRatio = 0,
      poweredTraverse = false,
      damageSystem = null,
    } = hullMotion;

    this.hullAngle = normalizeAngle(hullAngle);
    this.poweredTraverse = poweredTraverse;

    const gunnerIncapacitated = damageSystem
      ? !damageSystem.isCrewOperable('GUNNER') || damageSystem.vehicleDestroyed
      : false;

    // 1. Manual vs Powered turret rotation relative to hull (Q/O left, E/P right)
    const turnLeft = !gunnerIncapacitated && input.isAnyDown('KeyQ', 'KeyO');
    const turnRight = !gunnerIncapacitated && input.isAnyDown('KeyE', 'KeyP');
    let dir = 0;
    if (turnLeft) dir -= 1;
    if (turnRight) dir += 1;

    const maxSpd = poweredTraverse
      ? CONFIG.TURRET.ROTATE_SPEED
      : CONFIG.TURRET.MANUAL_ROTATE_SPEED;
    const accel = poweredTraverse
      ? CONFIG.TURRET.ROTATE_ACCEL
      : CONFIG.TURRET.MANUAL_ROTATE_ACCEL;
    const drag = poweredTraverse
      ? CONFIG.TURRET.ROTATE_DRAG
      : CONFIG.TURRET.MANUAL_ROTATE_DRAG;

    // Subtle mechanical gear engagement / brake settle when traverse starts or stops
    if (dir !== this._prevTraverseDir) {
      if (poweredTraverse) {
        if (dir !== 0 && this._prevTraverseDir === 0) {
          this.inertiaVel -= dir * 0.06;
        } else if (dir === 0 && this._prevTraverseDir !== 0) {
          this.inertiaVel += this._prevTraverseDir * 0.05;
        }
      }
      this._prevTraverseDir = dir;
    }

    if (dir !== 0) {
      if (Math.abs(this.angularVelocity) <= maxSpd || dir * this.angularVelocity < 0) {
        this.angularVelocity += dir * accel * dt;
        if (Math.abs(this.angularVelocity) > maxSpd && dir * this.angularVelocity > 0) {
          this.angularVelocity = dir * maxSpd;
        }
      } else {
        // Smoothly bleed down if transitioning from powered to manual while rotating
        const targetVel = dir * maxSpd;
        this.angularVelocity += (targetVel - this.angularVelocity) * (1 - Math.exp(-5.0 * dt));
      }
    } else {
      this.angularVelocity *= Math.exp(-drag * dt);
      if (Math.abs(this.angularVelocity) < 0.002) {
        this.angularVelocity = 0;
      }
    }

    this.relativeAngle = normalizeAngle(this.relativeAngle + this.angularVelocity * dt);
    this.sound?.updateManualTurretAudio?.(
      dt,
      !poweredTraverse && Math.abs(this.angularVelocity) > 0.005
    );

    // 2. Turret ring inertia (no gun stabilizer: lags slightly behind hull rotation, then settles)
    const stiffness = 34.0;
    const damping = 7.2;
    const hullCoupling = -hullAngularAccel * 0.045 - hullAngularVel * 0.45;
    this.inertiaVel +=
      (hullCoupling - stiffness * this.inertiaOffset - damping * this.inertiaVel) * dt;
    this.inertiaOffset += this.inertiaVel * dt;
    if (this.inertiaOffset > 0.14) {
      this.inertiaOffset = 0.14;
      this.inertiaVel *= 0.5;
    } else if (this.inertiaOffset < -0.14) {
      this.inertiaOffset = -0.14;
      this.inertiaVel *= 0.5;
    }
    if (
      Math.abs(hullAngularVel) < 0.01 &&
      Math.abs(this.inertiaOffset) < 0.0005 &&
      Math.abs(this.inertiaVel) < 0.002
    ) {
      this.inertiaOffset = 0;
      this.inertiaVel = 0;
    }

    // 3. Unstabilized barrel elevation nod (accel/braking) & rough terrain vibration
    const pitchStiffness = 28.0;
    const pitchDamping = 6.5;
    const targetPitchImpulse = -(linearAccel / CONFIG.TANK.BRAKE_DECELERATION) * 0.85;
    this.barrelPitchVel +=
      (targetPitchImpulse * 18.0 - pitchStiffness * this.barrelPitch - pitchDamping * this.barrelPitchVel) *
      dt;
    this.barrelPitch = Math.max(-1.0, Math.min(1.0, this.barrelPitch + this.barrelPitchVel * dt));

    this._vibPhase += dt * (18 + speedRatio * 24);
    if (speedRatio > 0.03) {
      const amp = 0.0045 * speedRatio;
      this.barrelWobbleAngle =
        Math.sin(this._vibPhase) * amp + Math.sin(this._vibPhase * 1.73) * amp * 0.5;
    } else {
      this.barrelWobbleAngle *= Math.exp(-10 * dt);
      if (Math.abs(this.barrelWobbleAngle) < 0.0002) this.barrelWobbleAngle = 0;
    }

    if (this._cannonVibTimer > 0) {
      this._cannonVibTimer = Math.max(0, this._cannonVibTimer - dt);
    }

    this.mainGun.update(dt, damageSystem);

    // 3b. 85mm Ammunition Type Selection (Keys 1-4)
    if (input.isDown('Digit1')) this.mainGun.setAmmoType('BR365K');
    else if (input.isDown('Digit2')) this.mainGun.setAmmoType('BR365A');
    else if (input.isDown('Digit3')) this.mainGun.setAmmoType('BR365P');
    else if (input.isDown('Digit4')) this.mainGun.setAmmoType('O365K');

    // 4. Fire 85mm main gun on SPACE
    if (input.isDown('Space')) {
      const muzzle = this.getMainGunMuzzle(getPivotFn());
      if (this.mainGun.tryFire(muzzle.x, muzzle.y, this.worldAngle, damageSystem)) {
        this._cannonVibTimer = 0.18;
        this.barrelPitchVel += 4.5; // Brief upward/recoil gun jump
      }
    }

    // 5. Fire coaxial 7.62mm DT on Z
    this.coaxMG.update(
      dt,
      input.isDown('KeyZ'),
      () => this.getCoaxMuzzle(getPivotFn()),
      gunnerIncapacitated
    );
  }

  getMainGunMuzzle(pivot) {
    const scale = CONFIG.TANK.SCALE;
    const angle = this.worldAngle;
    const pitchScale = 1.0 - this.barrelPitch * 0.025;
    const len =
      (CONFIG.TURRET.BARREL_MUZZLE_LENGTH * pitchScale - this.mainGun.recoilOffset) *
      scale;
    return {
      x: pivot.x + Math.cos(angle) * len,
      y: pivot.y + Math.sin(angle) * len,
      angle,
    };
  }

  getCoaxMuzzle(pivot) {
    const scale = CONFIG.TANK.SCALE;
    const angle = this.worldAngle;
    const fx = CONFIG.TURRET.COAX_OFFSET_X * scale;
    const fy = CONFIG.TURRET.COAX_OFFSET_Y * scale;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      x: pivot.x + fx * cos - fy * sin,
      y: pivot.y + fx * sin + fy * cos,
      angle,
    };
  }

  render(ctx, pivot, sprites, inspectionMode = false, damageSystem = null) {
    const scale = CONFIG.TANK.SCALE;
    const angle = this.worldAngle;

    // Subtle turret vibration when cannon fires
    let vibX = 0;
    let vibY = 0;
    if (this._cannonVibTimer > 0) {
      const mag = (this._cannonVibTimer / 0.18) * 1.4;
      vibX = (Math.random() - 0.5) * mag;
      vibY = (Math.random() - 0.5) * mag;
    }

    ctx.save();
    ctx.translate(pivot.x + vibX, pivot.y + vibY);
    ctx.rotate(angle);
    ctx.scale(scale, scale);

    // 1. Main 85mm gun barrel (with recoil & unstabilized vertical pitch foreshortening)
    if (sprites.mainGun) {
      const pitchScaleX = 1.0 - this.barrelPitch * 0.025;
      ctx.save();
      ctx.translate(-this.mainGun.recoilOffset, 0);
      ctx.scale(pitchScaleX, 1);
      ctx.drawImage(sprites.mainGun, -20, -15);
      const barrelState = damageSystem ? damageSystem.getState('GUN_BARREL') : 'NORMAL';
      if (barrelState === 'DAMAGED' || barrelState === 'CRITICAL') {
        ctx.fillStyle = barrelState === 'CRITICAL' ? 'rgba(40, 22, 16, 0.85)' : 'rgba(55, 50, 45, 0.72)';
        ctx.fillRect(72, -3.5, 16, 7);
        ctx.strokeStyle = '#ff8c42';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(74, -3.5);
        ctx.lineTo(82, 3.5);
        ctx.stroke();
      } else if (barrelState === 'DESTROYED') {
        // Split / scorched ruined muzzle
        ctx.fillStyle = 'rgba(20, 18, 18, 0.92)';
        ctx.fillRect(76, -4.5, 48, 9);
        ctx.strokeStyle = '#d94832';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(96, -4);
        ctx.lineTo(114, -9);
        ctx.moveTo(96, 4);
        ctx.lineTo(116, 8);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 2. Coaxial 7.62mm DT machine gun (mounted on RIGHT +Y side of main gun, parallel)
    if (sprites.coaxMG) {
      ctx.drawImage(sprites.coaxMG, -20, -10 + CONFIG.TURRET.COAX_OFFSET_Y);

      // Subtle barrel heat glow after prolonged firing
      const heat = this.coaxMG.heatRatio;
      if (heat > 0.45) {
        const glowAlpha = Math.min(0.45, ((heat - 0.45) / 0.55) * 0.45);
        ctx.fillStyle = `rgba(255, 115, 30, ${glowAlpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(55, CONFIG.TURRET.COAX_OFFSET_Y, 5.5, 1.6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 3. Cast T-34-85 turret body on top (pivot at 62, 60)
    if (sprites.turret) {
      if (inspectionMode) ctx.globalAlpha = 0.28;
      ctx.drawImage(sprites.turret, -62, -60);
      if (inspectionMode) ctx.globalAlpha = 1.0;
    }

    // 4. Persistent turret armor impact marks (rotate with turret)
    if (this.turretMarks.length > 0) {
      renderArmorImpactMarks(ctx, this.turretMarks, 'rgba(118, 140, 92, 0.58)');
    }

    ctx.restore();

    if (inspectionMode) {
      renderTurretInternals(ctx, pivot, this, damageSystem);
    }
  }
}
