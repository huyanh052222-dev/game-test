/**
 * T-34-85 Tank entity: hull physics, differential track animation,
 * front hull 7.62mm DT machine gun, and independent turret assembly.
 */
import { CONFIG } from './config.js';
import { SharedMGAmmoPool, MachineGun } from './weapon.js?v=9';
import { Turret } from './turret.js?v=9';
import { CREW_EVENT } from './crewVoice.js';
import { renderHullInternals, renderInspectionLabels } from './xray.js';
import { VEHICLE_ARMOR_PRESETS, MODULE_STATE } from './combat/armorData.js';
import { AMMO_TYPES, interpolatePenetration } from './combat/projectileData.js';
import { resolveArmorImpact } from './combat/armorCollision.js';
import { resolvePenetration, IMPACT_OUTCOME } from './combat/penetration.js';
import { simulateInternalDamage } from './combat/spall.js';
import { ModuleDamageSystem } from './combat/moduleDamage.js';
import { TrackRepairSystem } from './combat/trackRepair.js';
import { CrewBailoutSystem } from './combat/crewBailout.js';
import { createImpactMark, renderArmorImpactMarks } from './combat/damageEffects.js';
import { DrivetrainController } from './drivetrain.js';
import { renderDetailedTrackTreads } from './tankDetails.js';

export class Tank {
  constructor(projectiles, particles, sound, camera) {
    this.x = CONFIG.TANK.START_X;
    this.y = CONFIG.TANK.START_Y;
    this.angle = CONFIG.TANK.START_ANGLE;
    this.scale = CONFIG.TANK.SCALE;
    this.faction = 'soviet';
    this.armorPreset = VEHICLE_ARMOR_PRESETS.T34_85_1944;
    this.damageSystem = new ModuleDamageSystem(this.armorPreset.modules);
    this.trackRepair = new TrackRepairSystem(this.damageSystem, 'soviet');
    this.bailout = new CrewBailoutSystem(this.damageSystem, 'soviet');
    this.selectedCrewId = 'DRIVER';
    this._gHoldTimer = 0;
    this._gHoldDuration = 1.5;
    this._gTriggeredHold = false;
    this._gWasDown = false;
    this._ammoCookoffTriggered = false;
    this._ammoFireSmokeTimer = 0;
    this._damagedSmokeTimer = 0;

    this.hullMarks = [];
    this.maxHullMarks = 120;

    this.speed = 0; // Forward/reverse scalar speed along hull heading
    this.angularVelocity = 0;

    this.leftTrackPhase = 0;
    this.rightTrackPhase = 0;
    this._trackMarkDist = 0;
    this._moveVoiceState = 'STOPPED';
    this._prevSpeed = 0;
    this._prevAngularVel = 0;
    this._exhaustTimer = 0;
    this._dustTimer = 0;
    this._iWasDown = false;
    this._shiftUpWasDown = false;
    this._shiftDownWasDown = false;
    this._rWasDown = false;
    this._nWasDown = false;
    this.dirtAccumulation = 0;
    this.drivetrain = new DrivetrainController('T34_85', 'N');
    this.drivetrain.onShift = () => this.sound?.playGearShift?.();

    this.projectiles = projectiles;
    this.particles = particles;
    this.sound = sound;

    this.mgAmmoPool = new SharedMGAmmoPool();
    this.hullMG = new MachineGun('hull', this.mgAmmoPool, projectiles, particles, sound);
    this.hullMG.ownerTank = this;
    this.turret = new Turret(
      this.angle,
      this.mgAmmoPool,
      projectiles,
      particles,
      sound,
      camera
    );
    if (this.turret.mainGun) this.turret.mainGun.ownerTank = this;
    if (this.turret.coaxMG) this.turret.coaxMG.ownerTank = this;
  }

  get gHoldProgress() {
    if (!this._gWasDown || this._gTriggeredHold || !this.selectedCrewId) return 0;
    return Math.min(1, this._gHoldTimer / this._gHoldDuration);
  }

  get gHoldRemaining() {
    if (!this._gWasDown || this._gTriggeredHold || !this.selectedCrewId) return 0;
    return Math.max(0, this._gHoldDuration - this._gHoldTimer);
  }

  _updateCrewSelectionInput(dt, input) {
    const eligible = this.bailout.getEligibleCrewIds(this.trackRepair);
    if (eligible.length === 0) {
      this.selectedCrewId = null;
      this._gHoldTimer = 0;
      this._gTriggeredHold = false;
      this._gWasDown = input.isDown('KeyG');
      return;
    }
    if (!this.selectedCrewId || !eligible.includes(this.selectedCrewId)) {
      this.selectedCrewId = eligible[0];
    }

    const gDown = input.isDown('KeyG');
    if (gDown) {
      if (!this._gWasDown) {
        this._gHoldTimer = 0;
        this._gTriggeredHold = false;
      }
      if (!this._gTriggeredHold) {
        this._gHoldTimer += dt;
        if (this._gHoldTimer >= this._gHoldDuration) {
          this._gTriggeredHold = true;
          this.bailout.dismountCrewMember(this.selectedCrewId, this.trackRepair);
          const remaining = this.bailout.getEligibleCrewIds(this.trackRepair);
          this.selectedCrewId = remaining.length > 0 ? remaining[0] : null;
        }
      }
    } else if (this._gWasDown) {
      if (!this._gTriggeredHold && this._gHoldTimer < 0.35 && eligible.length > 1) {
        const idx = eligible.indexOf(this.selectedCrewId);
        this.selectedCrewId = eligible[(idx + 1) % eligible.length];
      }
      this._gHoldTimer = 0;
      this._gTriggeredHold = false;
    }
    this._gWasDown = gDown;
  }

  getOBB() {
    return {
      x: this.x,
      y: this.y,
      angle: this.angle,
      halfLength: 110 * this.scale,
      halfWidth: 54 * this.scale,
    };
  }

  getTurretPivot() {
    const scale = CONFIG.TANK.SCALE;
    const ox = CONFIG.TANK.TURRET_OFFSET_X * scale;
    return {
      x: this.x + Math.cos(this.angle) * ox,
      y: this.y + Math.sin(this.angle) * ox,
    };
  }

  getHullMGMuzzle() {
    const scale = CONFIG.TANK.SCALE;
    const fx = (CONFIG.TANK.HULL_MG_OFFSET_X + CONFIG.TANK.HULL_MG_MUZZLE_LENGTH) * scale;
    const fy = CONFIG.TANK.HULL_MG_OFFSET_Y * scale;
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    return {
      x: this.x + fx * cos - fy * sin,
      y: this.y + fx * sin + fy * cos,
      angle: this.angle,
    };
  }

  get speedKmh() {
    return Math.abs(this.speed) * CONFIG.TANK.SPEED_TO_KMH;
  }

  get electricalPower() {
    const st = this.sound.engineState;
    return st === 'IDLE' || st === 'RUNNING' ? 'POWER_AVAILABLE' : 'POWER_OFF';
  }

  receiveImpact(projectile, particles, sound) {
    const ammo = AMMO_TYPES[projectile.ammoId] || AMMO_TYPES.BR365K;
    const distanceMeters = Math.max(
      10,
      (projectile.distanceTraveled || 100) / CONFIG.TANK.PIXELS_PER_METER
    );

    // 1. Check 85mm Gun Barrel hit in turret-local coordinates
    const pivot = this.getTurretPivot();
    const cosT = Math.cos(-this.turret.worldAngle);
    const sinT = Math.sin(-this.turret.worldAngle);
    const dxP = projectile.x - pivot.x;
    const dyP = projectile.y - pivot.y;
    const tlx = (dxP * cosT - dyP * sinT) / this.scale;
    const tly = (dxP * sinT + dyP * cosT) / this.scale;
    if (tlx >= 42 && tlx <= 140 && Math.abs(tly) <= 6) {
      if (ammo.caliberMm >= 20) {
        const prevState = this.damageSystem.getState('GUN_BARREL');
        const dmg = ammo.type === 'HE' ? 55 : 48;
        this.damageSystem.applyDirectDamage('GUN_BARREL', dmg, `${ammo.name} Barrel Hit`);
        particles?.spawnImpact?.(projectile.x, projectile.y, 'metal', 0.9);
        if (prevState !== MODULE_STATE.DESTROYED && this.damageSystem.getState('GUN_BARREL') === MODULE_STATE.DESTROYED) {
          particles?.spawnImpact?.(projectile.x, projectile.y, 'metal', 1.1);
        }
        return { outcome: IMPACT_OUTCOME.PENETRATION, zoneKey: 'GUN_BARREL' };
      }
      particles?.spawnBulletImpact?.(projectile.x, projectile.y, true);
      return { outcome: IMPACT_OUTCOME.NON_PENETRATION, zoneKey: 'GUN_BARREL' };
    }

    // 2. Check Left / Right Track hit in hull-local coordinates
    const cosH = Math.cos(-this.angle);
    const sinH = Math.sin(-this.angle);
    const dxH = projectile.x - this.x;
    const dyH = projectile.y - this.y;
    const hlx = (dxH * cosH - dyH * sinH) / this.scale;
    const hly = (dxH * sinH + dyH * cosH) / this.scale;
    if (Math.abs(hlx) <= 110 && Math.abs(hly) >= 39 && Math.abs(hly) <= 55) {
      const trackId = hly < 0 ? 'LEFT_TRACK' : 'RIGHT_TRACK';
      // 7.62mm MG cannot destroy heavy steel tracks; 20mm+ / 85mm checks vs ~22mm track steel
      if (ammo.caliberMm >= 20) {
        const trackPen = interpolatePenetration(ammo, distanceMeters) >= 22 || ammo.type === 'HE';
        if (trackPen) {
          const prevTrack = this.damageSystem.getState(trackId);
          const trackDmg = ammo.type === 'HE' ? 75 : 65;
          this.damageSystem.applyDirectDamage(trackId, trackDmg, `${ammo.name} Track Hit`);
          particles?.spawnBulletImpact?.(projectile.x, projectile.y, true);
          if (prevTrack !== MODULE_STATE.DESTROYED && this.damageSystem.getState(trackId) === MODULE_STATE.DESTROYED) {
            particles?.spawnImpact?.(projectile.x, projectile.y, 'ground', 0.85);
          }
        }
      } else {
        particles?.spawnBulletImpact?.(projectile.x, projectile.y, true);
      }
    }

    const collision = resolveArmorImpact(this, projectile);
    const penResult = resolvePenetration(ammo, collision, distanceMeters);
    const dirAngle = Math.atan2(collision.localDir.y, collision.localDir.x);

    // 3. Internal spall simulation against hull & turret modules
    const hullModules = this.damageSystem.modules.filter((m) => !m.part || m.part === 'hull');
    const hits = simulateInternalDamage(ammo, collision, penResult, hullModules);

    if (collision.zoneKey.startsWith('TURRET_')) {
      const tDir = Math.atan2(projectile.vy, projectile.vx) - this.turret.worldAngle;
      const turretCollision = {
        ...collision,
        localEntry: { x: tlx, y: tly },
        localDir: { x: Math.cos(tDir), y: Math.sin(tDir) },
      };
      const turretModules = this.damageSystem.modules.filter((m) => m.part === 'turret');
      hits.push(...simulateInternalDamage(ammo, turretCollision, penResult, turretModules));

      this.turret.addTurretMark(
        createImpactMark(penResult.outcome, ammo, tlx, tly, tDir, 'turret')
      );
    } else {
      if (this.hullMarks.length >= this.maxHullMarks) {
        this.hullMarks.shift();
      }
      this.hullMarks.push(
        createImpactMark(
          penResult.outcome,
          ammo,
          collision.localEntry.x,
          collision.localEntry.y,
          dirAngle,
          'hull'
        )
      );
    }

    this.damageSystem.applyHits(hits);

    // HE blast/fragmentation damages external optics, barrel & tracks even on non-penetration
    if (ammo.type === 'HE' && penResult.outcome !== IMPACT_OUTCOME.RICOCHET) {
      const extIds = collision.zoneKey.startsWith('TURRET_')
        ? ['GUN_BARREL', 'GUNNER_OPTICS', 'COMMANDER_OPTICS']
        : ['DRIVER_VISION', 'LEFT_TRACK', 'RIGHT_TRACK'];
      for (const extId of extIds) {
        this.damageSystem.applyDirectDamage(extId, 24, `${ammo.name} HE Frag`);
      }
    }

    if (ammo.caliberMm < 20 || penResult.outcome === IMPACT_OUTCOME.RICOCHET) {
      particles?.spawnBulletImpact?.(projectile.x, projectile.y, true);
    } else {
      particles?.spawnImpact?.(projectile.x, projectile.y, 'metal', 1.2);
      sound?.playExplosion?.();
    }

    return penResult;
  }

  getMaxTurnSpeed(speedRatio) {
    const pivot = CONFIG.TANK.PIVOT_TURN_SPEED;
    const low = CONFIG.TANK.LOW_SPEED_TURN_SPEED;
    const high = CONFIG.TANK.HIGH_SPEED_TURN_SPEED;
    if (speedRatio <= 0.22) {
      const t = speedRatio / 0.22;
      return pivot + (low - pivot) * (t * t * (3 - 2 * t));
    }
    const t = Math.min(1, (speedRatio - 0.22) / 0.78);
    return low + (high - low) * (t * t * (3 - 2 * t));
  }

  update(dt, input, targets = [], infantry = [], terrain = null) {
    this.damageSystem.update(dt);
    this._updateCrewSelectionInput(dt, input);
    if (this.damageSystem.ammoFireActive) {
      this.bailout.triggerBailout();
    }
    this.bailout.update(
      dt,
      {
        hullX: this.x,
        hullY: this.y,
        hullAngle: this.angle,
        turretPivot: this.getTurretPivot(),
        turretAngle: this.turret.worldAngle,
      },
      infantry
    );
    this.trackRepair.update(dt, this.speed, this.angularVelocity, this.damageSystem.vehicleDestroyed || this.bailout.triggered, {
      hullX: this.x,
      hullY: this.y,
      hullAngle: this.angle,
      turretPivot: this.getTurretPivot(),
      turretAngle: this.turret.worldAngle,
    });

    // Evaluate module & crew states
    const engStateDmg = this.damageSystem.getState('ENGINE');
    const engineDestroyed = engStateDmg === MODULE_STATE.DESTROYED || this.damageSystem.vehicleDestroyed;
    const leftTrackBroken = this.damageSystem.getState('LEFT_TRACK') === MODULE_STATE.DESTROYED;
    const rightTrackBroken = this.damageSystem.getState('RIGHT_TRACK') === MODULE_STATE.DESTROYED;
    const bothTracksBroken = leftTrackBroken && rightTrackBroken;
    const oneTrackBroken = (leftTrackBroken || rightTrackBroken) && !bothTracksBroken;
    const driverAlive = this.damageSystem.isCrewOperable('DRIVER');
    const radioOpAlive = this.damageSystem.isCrewOperable('RADIO_OP');

    let enginePowerMult = 1.0;
    if (engineDestroyed) enginePowerMult = 0;
    else if (engStateDmg === MODULE_STATE.CRITICAL) enginePowerMult = 0.35;
    else if (engStateDmg === MODULE_STATE.DAMAGED) enginePowerMult = 0.68;

    this.sound?.setEngineDamage?.(engineDestroyed, enginePowerMult);

    // Terrain modifier (NORMAL | GRASS | DIRT | SAND | MUD | SOFT_GROUND)
    const surface = terrain ? terrain.getSurfaceAt(this.x, this.y) : 'NORMAL';
    if (Math.abs(this.speed) > 10 && terrain) {
      if (surface === 'MUD') this.dirtAccumulation = Math.min(1, this.dirtAccumulation + dt * 0.22);
      else if (surface === 'DIRT' || surface === 'SAND') this.dirtAccumulation = Math.min(0.75, this.dirtAccumulation + dt * 0.08);
      else if (surface === 'GRASS') this.dirtAccumulation = Math.max(0, this.dirtAccumulation - dt * 0.015);
    }
    let terrainSpeedMult = 1.0;
    let terrainAccelMult = 1.0;
    let terrainTurnMult = 1.0;
    if (surface === 'MUD') {
      terrainSpeedMult = 0.45;
      terrainAccelMult = 0.52;
      terrainTurnMult = 0.55;
    } else if (surface === 'SOFT_GROUND') {
      terrainSpeedMult = 0.76;
      terrainAccelMult = 0.8;
      terrainTurnMult = 0.82;
    } else if (surface === 'SAND') {
      terrainSpeedMult = 0.82;
      terrainAccelMult = 0.78;
      terrainTurnMult = 0.85;
    } else if (surface === 'DIRT') {
      terrainSpeedMult = 0.96;
      terrainAccelMult = 0.95;
      terrainTurnMult = 0.97;
    }

    const trackSpeedMult = bothTracksBroken ? 0 : (oneTrackBroken ? 0.25 : 1.0);
    const trackTurnMult = bothTracksBroken ? 0 : (oneTrackBroken ? 0.24 : 1.0);

    // 0. Engine ignition / shutdown toggle (Key I)
    const iDown = input.isDown('KeyI');
    if (iDown && !this._iWasDown && !engineDestroyed) {
      this.sound.toggleEngine();
    }
    this._iWasDown = iDown;

    const engineOperational = !engineDestroyed && this.electricalPower === 'POWER_AVAILABLE';
    const canDrive = engineOperational && driverAlive && !bothTracksBroken && !this.trackRepair.isActive;

    // 1. Sequential Manual Gear Shifting (Shift+W: upshift, Shift+S: downshift, R: reverse, N: neutral)
    const shiftDown = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    const wDown = input.isDown('KeyW');
    const sDown = input.isDown('KeyS');
    const rDown = input.isDown('KeyR');
    const nDown = input.isDown('KeyN');

    const shiftUpCombo = shiftDown && wDown;
    const shiftDnCombo = shiftDown && sDown;
    if (canDrive) {
      if (shiftUpCombo && !this._shiftUpWasDown) {
        this.drivetrain.shiftUp(this.speed);
      }
      if (shiftDnCombo && !this._shiftDownWasDown) {
        this.drivetrain.shiftDown(this.speed);
      }
      if (rDown && !this._rWasDown) {
        this.drivetrain.requestShiftTo('R', this.speed);
      }
      if (nDown && !this._nWasDown) {
        this.drivetrain.requestShiftTo('N', this.speed);
      }
    }
    this._shiftUpWasDown = shiftUpCombo;
    this._shiftDownWasDown = shiftDnCombo;
    this._rWasDown = rDown;
    this._nWasDown = nDown;

    // 2. Throttle (W) & Brake (S, or S also reverses when already in R)
    const throttleActive = canDrive && !shiftDown && (this.drivetrain.gear === 'R' ? (wDown || sDown) : wDown);
    const brakeActive = canDrive && !shiftDown && this.drivetrain.gear !== 'R' && sDown;
    const throttleInput = throttleActive ? 1 : 0;
    const brakeInput = brakeActive ? 1 : 0;
    const throttle = throttleActive ? (this.drivetrain.gear === 'R' ? -1 : 1) : (brakeActive ? -1 : 0);

    const engineRunning = this.sound?.engineState === 'IDLE' || this.sound?.engineState === 'RUNNING';
    this.speed = this.drivetrain.update(dt, {
      engineRunning: engineRunning || engineOperational,
      canDrive,
      throttleInput,
      brakeInput,
      currentSpeed: this.speed,
      enginePowerMult,
      trackSpeedMult,
      surface,
      bothTracksBroken,
    });

    // Movement crew voice state machine (only on transition from stopped)
    if (Math.abs(this.speed) < 3 && throttle === 0) {
      this._moveVoiceState = 'STOPPED';
    } else if (throttle > 0 && this.speed > 5 && this._moveVoiceState !== 'FORWARD') {
      this._moveVoiceState = 'FORWARD';
      this.sound.crew.trigger(CREW_EVENT.MOVEMENT_FORWARD_STARTED);
    } else if (throttle < 0 && this.speed < -5 && this._moveVoiceState !== 'REVERSE') {
      this._moveVoiceState = 'REVERSE';
      this.sound.crew.trigger(CREW_EVENT.MOVEMENT_REVERSE_STARTED);
    }

    // 2. Speed-dependent hull steering with side-clutch/band-brake inertia
    const turnLeft = canDrive && input.isDown('KeyA');
    const turnRight = canDrive && input.isDown('KeyD');
    let steer = 0;
    if (turnLeft) steer -= 1;
    if (turnRight) steer += 1;

    const currentSpeedRatio = Math.min(1, Math.abs(this.speed) / CONFIG.TANK.MAX_FORWARD_SPEED);
    const maxT = this.getMaxTurnSpeed(currentSpeedRatio) * trackTurnMult * terrainTurnMult;

    if (steer !== 0) {
      // Reversing steering direction first brakes existing rotational momentum
      const isCounterSteering = steer * this.angularVelocity < 0;
      const accelMult = isCounterSteering ? 2.1 : 1.0;

      if (isCounterSteering || Math.abs(this.angularVelocity) < maxT) {
        this.angularVelocity += steer * CONFIG.TANK.TURN_ACCELERATION * accelMult * dt;
        if (!isCounterSteering && Math.abs(this.angularVelocity) > maxT) {
          this.angularVelocity = steer * maxT;
        }
      } else {
        // Smoothly bleed excess angular velocity when accelerating into a higher-speed band
        const targetVel = steer * maxT;
        this.angularVelocity += (targetVel - this.angularVelocity) * (1 - Math.exp(-5.0 * dt));
      }
    } else {
      this.angularVelocity *= Math.exp(-CONFIG.TANK.TURN_DRAG * dt);
      if (Math.abs(this.angularVelocity) < 0.004) {
        this.angularVelocity = 0;
      }
    }

    // Subtle band-brake cornering speed scrub when turning while moving
    if (Math.abs(this.angularVelocity) > 0.08 && Math.abs(this.speed) > 10) {
      const turnLoad = Math.abs(this.angularVelocity) / CONFIG.TANK.MAX_TURN_SPEED;
      const scrub = CONFIG.TANK.CORNERING_SCRUB_DRAG * turnLoad * dt;
      if (this.speed > 0) this.speed = Math.max(0, this.speed - scrub);
      else this.speed = Math.min(0, this.speed + scrub);
    }

    this.angle += this.angularVelocity * dt;
    // Normalize hull angle to [-PI, PI] to prevent floating-point drift
    this.angle = ((this.angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

    const linearAccel = (this.speed - this._prevSpeed) / dt;
    const hullAngularAccel = (this.angularVelocity - this._prevAngularVel) / dt;
    this._prevSpeed = this.speed;
    this._prevAngularVel = this.angularVelocity;

    // 3. Apply linear displacement along hull heading
    const dx = Math.cos(this.angle) * this.speed * dt;
    const dy = Math.sin(this.angle) * this.speed * dt;
    this.x += dx;
    this.y += dy;

    // Resolve solid OBB-to-OBB collision against stationary targets (Panzer III)
    if (targets.length > 0) {
      this._resolveTargetCollisions(targets);
    }

    // Resolve circle-vs-OBB collision against living infantry
    if (infantry.length > 0) {
      this._resolveInfantryCollisions(infantry);
    }

    // Clamp to 3x3 arena bounds
    const pad = CONFIG.WORLD.BORDER_PADDING;
    const maxX = CONFIG.WORLD.WIDTH - pad;
    const maxY = CONFIG.WORLD.HEIGHT - pad;
    if (this.x < pad) {
      this.x = pad;
      this.speed *= 0.4;
    } else if (this.x > maxX) {
      this.x = maxX;
      this.speed *= 0.4;
    }
    if (this.y < pad) {
      this.y = pad;
      this.speed *= 0.4;
    } else if (this.y > maxY) {
      this.y = maxY;
      this.speed *= 0.4;
    }

    // 4. Differential track animation & ground track marks
    const trackRadius = 46 * CONFIG.TANK.SCALE;
    const leftVel = this.speed + this.angularVelocity * trackRadius;
    const rightVel = this.speed - this.angularVelocity * trackRadius;
    this.leftTrackPhase = (this.leftTrackPhase + leftVel * dt) % 10;
    this.rightTrackPhase = (this.rightTrackPhase + rightVel * dt) % 10;

    const moveStep = Math.hypot(dx, dy) + Math.abs(this.angularVelocity) * 18 * dt;
    this._trackMarkDist += moveStep;
    if (this._trackMarkDist >= 16) {
      this._trackMarkDist = 0;
      const perpX = -Math.sin(this.angle) * 44 * CONFIG.TANK.SCALE;
      const perpY = Math.cos(this.angle) * 44 * CONFIG.TANK.SCALE;
      const rearX = -Math.cos(this.angle) * 75 * CONFIG.TANK.SCALE;
      const rearY = -Math.sin(this.angle) * 75 * CONFIG.TANK.SCALE;
      this.particles.addTrackMark(this.x + rearX - perpX, this.y + rearY - perpY, this.angle);
      this.particles.addTrackMark(this.x + rearX + perpX, this.y + rearY + perpY, this.angle);
    }

    // 5. Update multi-layered V-2-34 diesel engine & dynamic track audio
    const speedRatio = Math.abs(this.speed) / CONFIG.TANK.MAX_FORWARD_SPEED;
    const turnRatio = Math.abs(this.angularVelocity) / CONFIG.TANK.MAX_TURN_SPEED;
    const trackDistanceStep = (Math.abs(leftVel) + Math.abs(rightVel)) * 0.5 * dt;

    this.sound.update(dt, {
      speedRatio,
      isReversing: this.speed < -2,
      isThrottling: throttle !== 0 || steer !== 0,
      turnRatio,
      trackDistanceStep,
      drivetrain: this.drivetrain,
    });

    // 6. V-2-34 Diesel Exhaust Smoke & Track Dust
    const scale = CONFIG.TANK.SCALE;
    const tankVx = Math.cos(this.angle) * this.speed;
    const tankVy = Math.sin(this.angle) * this.speed;
    const engState = this.sound.engineState;

    if (engState === 'STARTING' || engState === 'IDLE' || engState === 'RUNNING') {
      const accelSurge = Math.min(1, Math.abs(linearAccel) / CONFIG.TANK.ACCELERATION);
      const loadIntensity = Math.min(
        1,
        speedRatio * 0.5 + (throttle !== 0 ? 0.3 : 0) + accelSurge * 0.45 + (engState === 'STARTING' ? 0.4 : 0)
      );
      const exhaustInterval = Math.max(0.055, 0.22 - loadIntensity * 0.15);
      this._exhaustTimer += dt;
      if (this._exhaustTimer >= exhaustInterval) {
        this._exhaustTimer = 0;
        const cos = Math.cos(this.angle);
        const sin = Math.sin(this.angle);
        const rearAngle = this.angle + Math.PI;
        for (const ey of [-21, 21]) {
          const ex = -100 * scale;
          const wy = ey * scale;
          this.particles.spawnExhaustSmoke(
            this.x + ex * cos - wy * sin,
            this.y + ex * sin + wy * cos,
            tankVx,
            tankVy,
            rearAngle,
            loadIntensity
          );
        }
      }
    }

    const dustIntensity = Math.min(1, speedRatio * 0.75 + turnRatio * 0.75);
    if (dustIntensity > 0.04) {
      const dustInterval = Math.max(0.035, 0.14 - dustIntensity * 0.095);
      this._dustTimer += dt;
      if (this._dustTimer >= dustInterval) {
        this._dustTimer = 0;
        const col = Math.min(2, Math.max(0, Math.floor(this.x / CONFIG.WORLD.CELL_SIZE)));
        const row = Math.min(2, Math.max(0, Math.floor(this.y / CONFIG.WORLD.CELL_SIZE)));
        const isDarkSurface = (row + col) % 2 === 1;
        const cos = Math.cos(this.angle);
        const sin = Math.sin(this.angle);
        const isPivoting = speedRatio < 0.08 && turnRatio > 0.08;
        for (const ty of [-45, 45]) {
          // Braked/pivoting inner track kicks up slightly denser dust
          const isInnerTrack = (ty < 0 && this.angularVelocity < -0.05) || (ty > 0 && this.angularVelocity > 0.05);
          const sideMult = isPivoting ? 1.25 : (isInnerTrack ? 1.15 : 0.85);
          const lx = (-65 + Math.random() * 125) * scale;
          const ly = ty * scale;
          this.particles.spawnTrackDust(
            this.x + lx * cos - ly * sin,
            this.y + lx * sin + ly * cos,
            tankVx,
            tankVy,
            Math.min(1, dustIntensity * sideMult),
            isDarkSurface
          );
        }
      }
    }

    // 6b. Damaged engine heavy black smoke & Ammo rack fire smoke/detonation
    if (engStateDmg === MODULE_STATE.DAMAGED || engStateDmg === MODULE_STATE.CRITICAL || engStateDmg === MODULE_STATE.DESTROYED) {
      this._damagedSmokeTimer += dt;
      const interval = engStateDmg === MODULE_STATE.CRITICAL ? 0.08 : 0.18;
      if (this._damagedSmokeTimer >= interval) {
        this._damagedSmokeTimer = 0;
        const cos = Math.cos(this.angle);
        const sin = Math.sin(this.angle);
        const ex = this.x - 58 * scale * cos;
        const ey = this.y - 58 * scale * sin;
        this.particles.spawnExhaustSmoke(ex, ey, tankVx, tankVy, this.angle + Math.PI, engStateDmg === MODULE_STATE.DAMAGED ? 0.5 : 1.0);
      }
    }

    if (this.damageSystem.ammoFireActive && !this.damageSystem.ammoDetonated) {
      this._ammoFireSmokeTimer += dt;
      if (this._ammoFireSmokeTimer >= 0.06) {
        this._ammoFireSmokeTimer = 0;
        const pivot = this.getTurretPivot();
        this.particles.spawnExhaustSmoke(pivot.x, pivot.y, tankVx * 0.3, tankVy * 0.3, this.angle + Math.PI, 1.0);
      }
    }

    if (this.damageSystem.ammoDetonated && !this._ammoCookoffTriggered) {
      this._ammoCookoffTriggered = true;
      this.particles.spawnImpact(this.x, this.y, 'metal', 2.2);
      this.sound?.playExplosion?.();
      this.projectiles?.applyExplosionBlast?.({
        x: this.x,
        y: this.y,
        radius: 190,
        baseDamage: 115,
        ownerFaction: this.faction,
        sourceTank: this,
        sourceLabel: this.isReinforcement ? 'Allied T-34-85 Ammo Rack' : 'Player T-34-85 Ammo Rack',
        infantry,
        vehicles: targets,
        environment: terrain,
      });
    }

    // 7. Update Front Hull 7.62mm DT (X) — fixed to hull heading (requires live Radio Operator)
    this.hullMG.update(
      dt,
      input.isDown('KeyX'),
      () => this.getHullMGMuzzle(),
      !radioOpAlive || this.damageSystem.vehicleDestroyed
    );

    // 8. Update Unstabilized Turret (Q/O, E/P, SPACE, Z) with powered/manual traverse
    this.turret.update(dt, input, () => this.getTurretPivot(), {
      hullAngle: this.angle,
      hullAngularVel: this.angularVelocity,
      hullAngularAccel,
      linearAccel,
      speedRatio,
      poweredTraverse: engineOperational,
      damageSystem: this.damageSystem,
    });
  }

  render(ctx, sprites, inspectionMode = false, lighting = null) {
    const scale = CONFIG.TANK.SCALE;

    // Directional sunlight hull shadow & ambient occlusion (Firing Range Mode)
    if (lighting && !inspectionMode) {
      const sun = lighting.sunDir;
      const shLen = lighting.shadowLen;
      const shAlpha = lighting.shadowAlpha;
      const ox = sun.x * 11 * shLen;
      const oy = sun.y * 11 * shLen;

      ctx.save();
      ctx.translate(this.x + ox, this.y + oy);
      ctx.rotate(this.angle);
      ctx.scale(scale, scale);
      ctx.fillStyle = `rgba(10, 14, 8, ${shAlpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.roundRect(-108, -53, 216, 106, 8);
      ctx.fill();
      ctx.restore();

      // Turret & gun barrel cast shadow
      const pivot = this.getTurretPivot();
      ctx.save();
      ctx.translate(pivot.x + ox * 1.15, pivot.y + oy * 1.15);
      ctx.rotate(this.turret.worldAngle);
      ctx.scale(scale, scale);
      ctx.fillStyle = `rgba(10, 14, 8, ${(shAlpha * 0.72).toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, 38, 30, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(28, -4.5, 92, 9);
      ctx.restore();
    }

    // Draw Hull + Tracks + Front Hull MG
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.scale(scale, scale);

    // Subtle ground contact ambient occlusion under tracks
    if (!inspectionMode) {
      ctx.fillStyle = 'rgba(8, 10, 7, 0.30)';
      ctx.fillRect(-108, -54, 216, 17);
      ctx.fillRect(-108, 37, 216, 17);
    }

    // Hull & tracks SVG (pivot at 130, 70)
    if (sprites.hull) {
      if (inspectionMode) ctx.globalAlpha = 0.28;
      ctx.drawImage(sprites.hull, -130, -70);
      if (inspectionMode) ctx.globalAlpha = 1.0;
    }

    // Mud / dirt weathering on lower fenders & tracks
    if (lighting && !inspectionMode && this.dirtAccumulation > 0.03) {
      const a = (this.dirtAccumulation * 0.42).toFixed(2);
      ctx.fillStyle = `rgba(74, 58, 38, ${a})`;
      ctx.fillRect(-104, -52, 208, 13);
      ctx.fillRect(-104, 39, 208, 13);
    }

    // Persistent hull armor impact marks (rotate with hull)
    if (this.hullMarks.length > 0) {
      renderArmorImpactMarks(ctx, this.hullMarks, 'rgba(118, 140, 92, 0.58)');
    }

    // Animated exposed track treads at front & rear of left/right tracks (or broken track visual)
    if (this.damageSystem.getState('LEFT_TRACK') === MODULE_STATE.DESTROYED) {
      this._renderBrokenTrack(ctx, -45);
    } else {
      this._renderAnimatedTrackTreads(ctx, -45, this.leftTrackPhase);
    }
    if (this.damageSystem.getState('RIGHT_TRACK') === MODULE_STATE.DESTROYED) {
      this._renderBrokenTrack(ctx, 45);
    } else {
      this._renderAnimatedTrackTreads(ctx, 45, this.rightTrackPhase);
    }

    // Internal ammo fire glow through turret ring / engine deck vents
    if (this.damageSystem.ammoFireActive) {
      const flicker = 0.55 + Math.sin(performance.now() * 0.025) * 0.25;
      ctx.fillStyle = `rgba(255, 110, 20, ${(0.5 * flicker).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(14, 0, 22, 0, Math.PI * 2);
      ctx.fill();
    }

    // Front Hull 7.62mm DT MG (at hull local +82, +16; pivot 20, 15)
    if (sprites.hullMG) {
      ctx.drawImage(
        sprites.hullMG,
        CONFIG.TANK.HULL_MG_OFFSET_X - 20,
        CONFIG.TANK.HULL_MG_OFFSET_Y - 15
      );
      const hullHeat = this.hullMG.heatRatio;
      if (hullHeat > 0.45) {
        const glowAlpha = Math.min(0.45, ((hullHeat - 0.45) / 0.55) * 0.45);
        ctx.fillStyle = `rgba(255, 115, 30, ${glowAlpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(
          CONFIG.TANK.HULL_MG_OFFSET_X + 10,
          CONFIG.TANK.HULL_MG_OFFSET_Y,
          4.5,
          1.5,
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }

    ctx.restore();

    if (inspectionMode) {
      renderHullInternals(ctx, this);
    }

    // Draw Independent Turret & 85mm Gun & Coax MG
    this.turret.render(ctx, this.getTurretPivot(), sprites, inspectionMode, this.damageSystem);

    // Draw evacuating/repairing crewman & open hinged hatch in world space
    this.trackRepair.render(
      ctx,
      this.x,
      this.y,
      this.angle,
      scale,
      this.getTurretPivot(),
      this.turret.worldAngle
    );
    this.bailout.render(
      ctx,
      this.x,
      this.y,
      this.angle,
      this.getTurretPivot(),
      this.turret.worldAngle,
      scale
    );

    if (inspectionMode) {
      renderInspectionLabels(ctx, this);
    }
  }

  _renderBrokenTrack(ctx, yCenter) {
    // Exposed dark track bed & drive sprocket / idler recess
    ctx.fillStyle = '#141512';
    ctx.fillRect(-108, yCenter - 7, 24, 14);
    ctx.fillRect(86, yCenter - 7, 20, 14);
    ctx.fillStyle = '#2c3128';
    ctx.beginPath();
    ctx.arc(-104, yCenter, 4.5, 0, Math.PI * 2);
    ctx.arc(103, yCenter, 4.5, 0, Math.PI * 2);
    ctx.fill();
    // Splayed broken steel track links
    ctx.strokeStyle = '#474a42';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(-104, yCenter - 4);
    ctx.lineTo(-118, yCenter + 5);
    ctx.moveTo(98, yCenter + 4);
    ctx.lineTo(114, yCenter - 5);
    ctx.stroke();
  }

  _resolveTargetCollisions(targets) {
    const scale = CONFIG.TANK.SCALE;
    const halfLenA = 110 * scale;
    const halfWidA = 54 * scale;
    const cosA = Math.cos(this.angle);
    const sinA = Math.sin(this.angle);
    const u0x = cosA, u0y = sinA;
    const u1x = -sinA, u1y = cosA;

    for (const target of targets) {
      const cosB = Math.cos(target.angle);
      const sinB = Math.sin(target.angle);
      const v0x = cosB, v0y = sinB;
      const v1x = -sinB, v1y = cosB;

      const cdx = this.x - target.x;
      const cdy = this.y - target.y;

      const axes = [
        [u0x, u0y],
        [u1x, u1y],
        [v0x, v0y],
        [v1x, v1y],
      ];

      let minOverlap = Infinity;
      let pushX = 0;
      let pushY = 0;
      let separated = false;

      for (const [ax, ay] of axes) {
        const rA =
          halfLenA * Math.abs(u0x * ax + u0y * ay) +
          halfWidA * Math.abs(u1x * ax + u1y * ay);
        const tHalfLen = target.halfLength ?? halfLenA;
        const tHalfWid = target.halfWidth ?? halfWidA;
        const rB =
          tHalfLen * Math.abs(v0x * ax + v0y * ay) +
          tHalfWid * Math.abs(v1x * ax + v1y * ay);
        const proj = cdx * ax + cdy * ay;
        const overlap = rA + rB - Math.abs(proj);

        if (overlap <= 0) {
          separated = true;
          break;
        }
        if (overlap < minOverlap) {
          minOverlap = overlap;
          const sign = proj >= 0 ? 1 : -1;
          pushX = ax * sign;
          pushY = ay * sign;
        }
      }

      if (!separated && minOverlap > 0) {
        this.x += pushX * minOverlap;
        this.y += pushY * minOverlap;

        // Remove inward velocity component along collision normal for smooth sliding
        const vx = Math.cos(this.angle) * this.speed;
        const vy = Math.sin(this.angle) * this.speed;
        const tVx = Math.cos(target.angle || 0) * (target.speed || 0);
        const tVy = Math.sin(target.angle || 0) * (target.speed || 0);
        const relVn = (vx - tVx) * pushX + (vy - tVy) * pushY;
        const vn = vx * pushX + vy * pushY;

        // High-speed ramming damage to tracks/suspension (never instant-kill on minor contact)
        const ffEnabled = this.projectiles?.friendlyFireEnabled ?? true;
        const sameFaction = Boolean(target.faction && target.faction === this.faction);
        if (Math.abs(relVn) > 95 && (!sameFaction || ffEnabled)) {
          const hitDmg = Math.min(35, (Math.abs(relVn) - 95) * 0.28);
          const localImpactY = -pushX * sinA + pushY * cosA;
          const trackMod = localImpactY >= 0 ? 'RIGHT_TRACK' : 'LEFT_TRACK';
          this.damageSystem?.applyDirectDamage?.(trackMod, hitDmg, 'Collision');
          target.damageSystem?.applyDirectDamage?.('LEFT_TRACK', hitDmg * 0.7, 'Collision');
          if (sameFaction) {
            const srcName = this.isReinforcement ? 'Allied T-34-85' : 'Player T-34-85';
            const dstName = target.isReinforcement ? 'Allied T-34-85' : (target.faction === 'soviet' ? 'Player T-34-85' : 'Panzer III');
            this.projectiles?.onFriendlyFire?.({
              type: 'ALLIED VEHICLE DAMAGED',
              detail: `${srcName} collided with ${dstName}`,
              isKill: false,
              isVehicle: true,
            });
          }
        }

        if (vn < 0) {
          const forwardDot = cosA * pushX + sinA * pushY;
          if (Math.abs(forwardDot) > 0.25) {
            this.speed *= Math.max(0, 1 - Math.abs(forwardDot));
          }
        }
      }
    }
  }

  _resolveInfantryCollisions(infantry) {
    const scale = CONFIG.TANK.SCALE;
    const halfLen = 110 * scale;
    const halfWid = 54 * scale;
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    const isLinearMoving = Math.abs(this.speed) >= 6;
    const isRotating = Math.abs(this.angularVelocity) >= 0.05;

    if (!isLinearMoving && !isRotating) return;

    for (const s of infantry) {
      if (!s.alive) continue;
      const dx = s.x - this.x;
      const dy = s.y - this.y;
      // Soldier center in tank local coordinates
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;

      const cx = Math.max(-halfLen, Math.min(halfLen, lx));
      const cy = Math.max(-halfWid, Math.min(halfWid, ly));
      const diffX = lx - cx;
      const diffY = ly - cy;
      const distSq = diffX * diffX + diffY * diffY;

      if (distSq <= s.hitboxRadius * s.hitboxRadius) {
        // Compute local velocity of the hull/track point contacting the soldier
        const vxLocal = this.speed - this.angularVelocity * ly;
        const vyLocal = this.angularVelocity * lx;
        const contactSpeed = Math.hypot(vxLocal, vyLocal);
        if (contactSpeed < 6) continue;

        const ffEnabled = this.projectiles?.friendlyFireEnabled ?? true;
        const isFriendly = Boolean(s.faction && s.faction === this.faction);
        if (isFriendly && !ffEnabled) {
          // Friendly Fire OFF: gently push friendly soldier clear without crushing damage
          s.x += (diffX / (Math.sqrt(distSq) || 1)) * 4;
          s.y += (diffY / (Math.sqrt(distSq) || 1)) * 4;
          continue;
        }

        const wvx = vxLocal * cos - vyLocal * sin;
        const wvy = vxLocal * sin + vyLocal * cos;
        const impactAngle = Math.atan2(wvy, wvx);
        const killed = s.takeDamage(100, this.particles, s.x, s.y, impactAngle, 'crush');
        if (isFriendly) {
          const srcName = this.isReinforcement ? 'Allied T-34-85' : 'Player T-34-85';
          const dstName = s.uniformStyle === 'tanker' ? 'Soviet Tank Crew' : 'Soviet Infantry';
          this.projectiles?.onFriendlyFire?.({
            type: killed ? 'FRIENDLY INFANTRY CASUALTY' : 'FRIENDLY FIRE',
            detail: `${srcName} crushed ${dstName}`,
            isKill: Boolean(killed),
            isVehicle: false,
          });
        }
      }
    }
  }

  _renderAnimatedTrackTreads(ctx, yCenter, phase) {
    const showMicro = ctx.getTransform().a >= 0.65;
    renderDetailedTrackTreads(ctx, yCenter, phase, { xStart: -110, xEnd: -101, linkStep: 5, isGerman: false, showMicro });
    renderDetailedTrackTreads(ctx, yCenter, phase, { xStart: 97, xEnd: 110, linkStep: 5, isGerman: false, showMicro });
  }
}
