/**
 * Static Panzer III target vehicle with full armor-zone ballistics,
 * ricochet deflection, internal spall/APHE damage, and X-Ray state rendering.
 */
import { CONFIG } from './config.js';
import { VEHICLE_ARMOR_PRESETS, MODULE_STATE } from './combat/armorData.js';
import { AMMO_TYPES, interpolatePenetration } from './combat/projectileData.js';
import { resolveArmorImpact } from './combat/armorCollision.js';
import { resolvePenetration, IMPACT_OUTCOME } from './combat/penetration.js';
import { computeDeflectionAngle } from './combat/ricochet.js';
import { simulateInternalDamage } from './combat/spall.js';
import { ModuleDamageSystem } from './combat/moduleDamage.js';
import { TrackRepairSystem } from './combat/trackRepair.js';
import { CrewBailoutSystem } from './combat/crewBailout.js';
import { createImpactMark, renderArmorImpactMarks } from './combat/damageEffects.js';
import { renderDetailedTrackTreads } from './tankDetails.js';
import { renderPanzerIIIInternals } from './xray.js';
import { DetectionTracker, DETECTION_STATE } from './combat/detection.js';
import { DrivetrainController } from './drivetrain.js';

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export const VEHICLE_STATE = {
  OPERATIONAL: 'OPERATIONAL',
  DISABLED: 'DISABLED',
  DESTROYED: 'DESTROYED',
  BURNING: 'BURNING',
  BURNT_OUT: 'BURNT_OUT',
};

export const ENEMY_AI_STATE = {
  IDLE: 'IDLE',
  PATROLLING: 'PATROLLING',
  DETECTING: 'DETECTING',
  TARGET_ACQUIRED: 'TARGET_ACQUIRED',
  MOVING_TO_POSITION: 'MOVING_TO_POSITION',
  TURNING_HULL: 'TURNING_HULL',
  AIMING: 'AIMING',
  FIRING: 'FIRING',
  RELOADING: 'RELOADING',
  REPOSITIONING: 'REPOSITIONING',
  LOST_CONTACT: 'LOST_CONTACT',
  DISABLED: 'DISABLED',
  DESTROYED: 'DESTROYED',
};

export class PanzerIIITarget {
  constructor(x, y, angle = (Math.PI * 3) / 4, options = {}) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.scale = CONFIG.TANK.SCALE;
    this.faction = 'german';
    this.combatEnabled = Boolean(options.combatEnabled);
    this.turretAngle = angle;
    this.turretRecoil = 0;
    this.reloadTimer = 0;
    this.reloadDuration = 4.3; // 5 cm KwK 39 L/60 (~13-15 RPM practical)
    this.variantName = 'Panzer III Ausf. L';
    this.gunDesignation = '5 cm KwK 39 L/60';
    this.aimSettleTimer = 0;
    this.mgBurstCooldown = 0;
    this.speed = 0;
    this.angularVelocity = 0;
    this.leftTrackPhase = 0;
    this.rightTrackPhase = 0;
    this.dirtAccumulation = 0;
    this.drivetrain = new DrivetrainController('PANZER_III_L', 'N');
    this.apAmmo = 44;   // 5 cm PzGr. 39 APCBC-HE
    this.apcrAmmo = 8;  // 5 cm PzGr. 40 APCR (limited tungsten-core)
    this.heAmmo = 20;   // 5 cm Sprgr. 38 HE
    this.selectedAmmoId = 'PZGR39_50';
    this.mgAmmo = 1500;
    this.aiState = this.combatEnabled ? ENEMY_AI_STATE.PATROLLING : ENEMY_AI_STATE.IDLE;
    this._homePos = { x, y };
    this._patrolWaypoints = [
      { x: x - 38, y: y + 12 },
      { x: x + 38, y: y - 12 },
    ];
    this._patrolIdx = 0;
    this._repositionTarget = null;
    this.assaultObjective = null;
    this._reverseTimer = 0;
    this._stallTimer = 0;
    this._navMonitor = {
      lastCheckPos: { x, y },
      checkTimer: 0,
      stallCount: 0,
      recoveryPhase: 'NONE', // 'NONE' | 'RECOVER_REVERSE' | 'RECOVER_TURN'
      recoveryTimer: 0,
      recoverySteerAngle: angle,
      unresolvableObstruction: false,
    };
    this.detection = new DetectionTracker({
      detectionRangePx: 780,
      peripheralRangePx: 260,
      fovHalfAngle: Math.PI * 0.48,
      acquireDelay: 0.7,
      confirmDelay: 0.45,
      loseSightDelay: 2.2,
      searchDuration: 6.0,
    });

    this.armorPreset = VEHICLE_ARMOR_PRESETS.PANZER_III_PROVISIONAL;
    this.halfLength = this.armorPreset.hullBounds.halfLength * this.scale;
    this.halfWidth = this.armorPreset.hullBounds.halfWidth * this.scale;

    this.damageSystem = new ModuleDamageSystem(this.armorPreset.modules);
    this.trackRepair = new TrackRepairSystem(this.damageSystem, 'german');
    this.bailout = new CrewBailoutSystem(this.damageSystem, 'german');
    this.vehicleState = VEHICLE_STATE.OPERATIONAL;
    this.fireCause = null;
    this.burnProgress = 0; // 0..1 across Stage 1 -> Stage 2 -> Stage 3 (BURNT_OUT)
    this.burnDuration = 16.0;
    this.postBurnSmokeTimer = 0;
    this.fireEmitters = []; // { lx, ly, startAt, maxRadius }
    this._ammoCookoffTriggered = false;
    this._smokeTimer = 0;
    this._sparkTimer = 0;
    this._flamePhase = 0;

    // Persistent armor impact marks in target-local unscaled coordinates
    this.impactMarks = [];
    this.maxImpactMarks = 180;
  }

  getTurretPivot() {
    return {
      x: this.x + Math.cos(this.angle) * 8 * this.scale,
      y: this.y + Math.sin(this.angle) * 8 * this.scale,
    };
  }

  getOBB() {
    return {
      x: this.x,
      y: this.y,
      angle: this.angle,
      halfLength: this.halfLength,
      halfWidth: this.halfWidth,
    };
  }

  get destroyed() {
    return (
      this.vehicleState === VEHICLE_STATE.DESTROYED ||
      this.vehicleState === VEHICLE_STATE.BURNING ||
      this.vehicleState === VEHICLE_STATE.BURNT_OUT ||
      this.damageSystem.vehicleDestroyed
    );
  }

  _igniteFire(lx, ly, cause) {
    if (this.vehicleState === VEHICLE_STATE.BURNING || this.vehicleState === VEHICLE_STATE.BURNT_OUT) {
      return;
    }
    this.vehicleState = VEHICLE_STATE.BURNING;
    this.fireCause = cause;
    this.burnProgress = 0;
    this.fireEmitters = [
      { lx, ly, startAt: 0.0, maxRadius: 14 },
      { lx: -55, ly: 4, startAt: 0.22, maxRadius: 16 },
      { lx: 6, ly: -4, startAt: 0.42, maxRadius: 18 },
      { lx: -18, ly: 14, startAt: 0.60, maxRadius: 13 },
    ];
  }

  containsPoint(px, py) {
    const dx = px - this.x;
    const dy = py - this.y;
    const cos = Math.cos(-this.angle);
    const sin = Math.sin(-this.angle);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    return Math.abs(lx) <= this.halfLength && Math.abs(ly) <= this.halfWidth;
  }

  _addImpactMark(mark) {
    if (this.impactMarks.length >= this.maxImpactMarks) {
      this.impactMarks.shift();
    }
    this.impactMarks.push(mark);
  }

  onHit(projectile, particles, sound, debugOverlay = null) {
    if (this.combatEnabled && !this.destroyed) {
      this.detection.notifyThreat(projectile.prevX ?? projectile.x, projectile.prevY ?? projectile.y);
    }
    const ammo = AMMO_TYPES[projectile.ammoId] || AMMO_TYPES.BR365K;
    const distanceMeters = Math.max(
      10,
      (projectile.distanceTraveled || 100) / CONFIG.TANK.PIXELS_PER_METER
    );

    // Check Panzer III Left/Right Track hit in hull-local coordinates
    const cosH = Math.cos(-this.angle);
    const sinH = Math.sin(-this.angle);
    const dxH = projectile.x - this.x;
    const dyH = projectile.y - this.y;
    const hlx = (dxH * cosH - dyH * sinH) / this.scale;
    const hly = (dxH * sinH + dyH * cosH) / this.scale;
    if (Math.abs(hlx) <= 100 && Math.abs(hly) >= 38 && Math.abs(hly) <= 53) {
      const trackId = hly < 0 ? 'LEFT_TRACK' : 'RIGHT_TRACK';
      if (ammo.caliberMm >= 20) {
        const trackPen = interpolatePenetration(ammo, distanceMeters) >= 22 || ammo.type === 'HE';
        if (trackPen) {
          const prevTrack = this.damageSystem.getState(trackId);
          const trackDmg = ammo.type === 'HE' ? 75 : 65;
          this.damageSystem.applyDirectDamage(trackId, trackDmg, `${ammo.name} Track Hit`);
          if (prevTrack !== MODULE_STATE.DESTROYED && this.damageSystem.getState(trackId) === MODULE_STATE.DESTROYED) {
            particles?.spawnImpact?.(projectile.x, projectile.y, 'ground', 0.85);
          }
        }
      }
    }

    const collision = resolveArmorImpact(this, projectile);
    const penResult = resolvePenetration(ammo, collision, distanceMeters);
    const hits = simulateInternalDamage(
      ammo,
      collision,
      penResult,
      this.damageSystem.modules
    );
    const modulesAffected = this.damageSystem.applyHits(hits);

    // HE blast/fragmentation damages external optics, barrel & tracks even on non-penetration
    if (ammo.type === 'HE' && penResult.outcome !== IMPACT_OUTCOME.RICOCHET) {
      const extIds = collision.zoneKey.startsWith('TURRET_')
        ? ['GUN_BARREL', 'GUNNER_OPTICS', 'COMMANDER_OPTICS']
        : ['DRIVER_VISION', 'LEFT_TRACK', 'RIGHT_TRACK'];
      for (const extId of extIds) {
        this.damageSystem.applyDirectDamage(extId, 24, `${ammo.name} HE Frag`);
      }
    }

    const { lx, ly } = { lx: collision.localEntry.x, ly: collision.localEntry.y };
    const dirAngle = Math.atan2(collision.localDir.y, collision.localDir.x);
    const part = collision.zoneKey.startsWith('TURRET_') ? 'turret' : 'hull';

    this._addImpactMark(
      createImpactMark(penResult.outcome, ammo, lx, ly, dirAngle, part)
    );

    if (ammo.caliberMm < 20) {
      particles.spawnBulletImpact(projectile.x, projectile.y, true);
    } else {
      if (penResult.outcome === IMPACT_OUTCOME.RICOCHET) {
        particles.spawnBulletImpact(projectile.x, projectile.y, true);

        const worldLen = Math.hypot(projectile.vx, projectile.vy) || 1;
        const defAngle = computeDeflectionAngle(
          projectile.vx / worldLen,
          projectile.vy / worldLen,
          collision.normal,
          this.angle
        );
        projectile.ricocheted = true;
        projectile.angle = defAngle;
        projectile.vx = Math.cos(defAngle) * worldLen * 0.45;
        projectile.vy = Math.sin(defAngle) * worldLen * 0.45;
        projectile.life = Math.min(projectile.life, 0.35);
      } else if (
        penResult.outcome === IMPACT_OUTCOME.PENETRATION ||
        penResult.outcome === IMPACT_OUTCOME.PARTIAL_PENETRATION
      ) {
        particles.spawnImpact(projectile.x, projectile.y, 'metal', 1.35);
        sound.playExplosion();
      } else {
        particles.spawnImpact(projectile.x, projectile.y, 'metal', 1.15);
        sound.playExplosion();
      }

      if (this.damageSystem.ammoDetonated && !this._ammoCookoffTriggered) {
        this._ammoCookoffTriggered = true;
        particles.spawnImpact(this.x, this.y, 'metal', 2.1);
        sound.playExplosion();
        this._igniteFire(lx, ly, 'AMMUNITION_DETONATION');
        if (this._lastBlastCtx?.projectiles) {
          this._lastBlastCtx.projectiles.applyExplosionBlast({
            x: this.x,
            y: this.y,
            radius: 175,
            baseDamage: 105,
            ownerFaction: this.faction,
            sourceTank: this,
            sourceLabel: 'Panzer III Ammo Rack',
            infantry: this._lastBlastCtx.infantry || [],
            vehicles: this._lastBlastCtx.playerTank ? [this._lastBlastCtx.playerTank] : [],
            environment: this._lastBlastCtx.environment || null,
          });
        }
      } else if (
        this.vehicleState !== VEHICLE_STATE.BURNING &&
        this.vehicleState !== VEHICLE_STATE.BURNT_OUT
      ) {
        // Check explicit ignition sources (fuel tank rupture or explosive engine fire)
        const fuelMod = this.damageSystem.getModule('FUEL_TANK');
        const engMod = this.damageSystem.getModule('ENGINE');
        const fuelIgnited =
          fuelMod &&
          (fuelMod.state === MODULE_STATE.CRITICAL || fuelMod.state === MODULE_STATE.DESTROYED) &&
          hits.some((h) => h.module === fuelMod && h.damage > 0);
        const engineExplosiveFire =
          engMod &&
          (engMod.state === MODULE_STATE.CRITICAL || engMod.state === MODULE_STATE.DESTROYED) &&
          (ammo.explosiveTntGrams >= 100 || ammo.type === 'HE') &&
          hits.some((h) => h.module === engMod && h.damage > 0);

        if (fuelIgnited) {
          this._igniteFire(fuelMod.lx, fuelMod.ly, 'FUEL_FIRE');
        } else if (engineExplosiveFire) {
          this._igniteFire(engMod.lx, engMod.ly, 'ENGINE_FIRE');
        } else if (this.damageSystem.vehicleDestroyed) {
          // Crew knockout or structural defeat WITHOUT fire -> keeps original paint!
          this.vehicleState = VEHICLE_STATE.DESTROYED;
        } else {
          const engDead = engMod && engMod.state === MODULE_STATE.DESTROYED;
          const breechDead = this.damageSystem.getState('BREECH') === MODULE_STATE.DESTROYED;
          if (engDead && breechDead) {
            this.vehicleState = VEHICLE_STATE.DISABLED;
          }
        }
      }
    }

    if (debugOverlay && ammo.caliberMm >= 20) {
      debugOverlay.setReport({
        ammoName: ammo.name,
        ammoType: ammo.type,
        distanceMeters,
        zoneLabel: collision.zone.label,
        impactAngleDeg: penResult.impactAngleDeg,
        actualMm: penResult.actualMm,
        spacedMm: penResult.spacedMm,
        effectiveMm: penResult.effectiveMm,
        penMm: penResult.penMm,
        remainingPenMm: penResult.remainingPenMm,
        ricochetChance: penResult.ricochetChance,
        outcome: penResult.outcome,
        modulesAffected,
      });
    }

    return penResult;
  }

  _localToWorld(lx, ly) {
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    return {
      x: this.x + (lx * cos - ly * sin) * this.scale,
      y: this.y + (lx * sin + ly * cos) * this.scale,
    };
  }

  update(dt, particles, infantry = [], combatContext = null) {
    if (combatContext) {
      this._lastBlastCtx = {
        projectiles: combatContext.projectiles,
        infantry,
        playerTank: combatContext.playerTank,
        environment: combatContext.environment,
        voiceSystem: combatContext.voiceSystem || null,
      };
    }
    this._flamePhase += dt * 11;
    this.turretRecoil = Math.max(0, this.turretRecoil - dt * 5);
    const pivot = this.getTurretPivot();
    if (this.vehicleState === VEHICLE_STATE.BURNING) {
      this.bailout.triggerBailout();
    }
    this.bailout.update(
      dt,
      {
        hullX: this.x,
        hullY: this.y,
        hullAngle: this.angle,
        turretPivot: pivot,
        turretAngle: this.turretAngle,
      },
      infantry
    );
    this.trackRepair.update(dt, 0, 0, this.destroyed || this.bailout.triggered, {
      hullX: this.x,
      hullY: this.y,
      hullAngle: this.angle,
      turretPivot: pivot,
      turretAngle: this.turretAngle,
    });

    if (this.destroyed) {
      this.aiState = ENEMY_AI_STATE.DESTROYED;
      this.speed = 0;
      this.angularVelocity = 0;
    } else if (this.combatEnabled && combatContext && !this.damageSystem.vehicleAbandoned) {
      this._updateCombatAI(dt, particles, infantry, combatContext, pivot);
    }

    if (this.vehicleState === VEHICLE_STATE.BURNING) {
      this.burnProgress = Math.min(1, this.burnProgress + dt / this.burnDuration);
      this._smokeTimer += dt;
      this._sparkTimer += dt;

      // Stage 1 -> Stage 2 progressive smoke & spark emissions from active local emitters
      const smokeInterval = this.burnProgress < 0.25 ? 0.22 : 0.09;
      if (this._smokeTimer >= smokeInterval) {
        this._smokeTimer = 0;
        const activeEmitters = this.fireEmitters.filter((e) => this.burnProgress >= e.startAt);
        const em = activeEmitters[Math.floor(Math.random() * activeEmitters.length)] || this.fireEmitters[0];
        if (em && particles) {
          const wp = this._localToWorld(em.lx, em.ly);
          const intensity = this.burnProgress < 0.25 ? 0.45 : 0.95;
          particles.spawnExhaustSmoke(wp.x, wp.y, 0, -14, -Math.PI / 2, intensity);
        }
      }

      if (this.burnProgress >= 0.25 && this._sparkTimer >= 0.32) {
        this._sparkTimer = 0;
        const em = this.fireEmitters[0];
        if (em && particles) {
          const wp = this._localToWorld(em.lx, em.ly);
          particles.spawnBulletImpact(wp.x, wp.y, true);
        }
      }

      if (this.burnProgress >= 1) {
        this.vehicleState = VEHICLE_STATE.BURNT_OUT;
        this.postBurnSmokeTimer = 8.0;
      }
    } else if (this.vehicleState === VEHICLE_STATE.BURNT_OUT && this.postBurnSmokeTimer > 0) {
      this.postBurnSmokeTimer = Math.max(0, this.postBurnSmokeTimer - dt);
      this._smokeTimer += dt;
      if (this._smokeTimer >= 0.28) {
        this._smokeTimer = 0;
        const wp = this._localToWorld(-20, 0);
        const fade = this.postBurnSmokeTimer / 8.0;
        particles?.spawnExhaustSmoke?.(wp.x, wp.y, 0, -10, -Math.PI / 2, 0.35 * fade);
      }
    } else if (this.vehicleState === VEHICLE_STATE.DESTROYED) {
      // Non-burning destroyed wreck: only occasional light wisps if engine was hit
      const engState = this.damageSystem.getState('ENGINE');
      if (engState === MODULE_STATE.CRITICAL || engState === MODULE_STATE.DESTROYED) {
        this._smokeTimer += dt;
        if (this._smokeTimer >= 0.45) {
          this._smokeTimer = 0;
          const wp = this._localToWorld(-62, 0);
          particles?.spawnExhaustSmoke?.(wp.x, wp.y, 0, -8, -Math.PI / 2, 0.28);
        }
      }
    }
  }

  _hasClearCannonShot(x1, y1, x2, y2, infantry) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1) return true;
    for (const s of infantry) {
      if (!s.alive || s.faction !== this.faction) continue;
      const proj = ((s.x - x1) * dx + (s.y - y1) * dy) / lenSq;
      if (proj <= 0.02 || proj >= 0.98) continue;
      const px = x1 + proj * dx;
      const py = y1 + proj * dy;
      if (Math.hypot(s.x - px, s.y - py) < s.hitboxRadius + 10) return false;
    }
    return true;
  }

  _scoreForwardClearance(probeAngle, probeDist, environment, playerTank, allTanks = [], infantry = []) {
    const pad = CONFIG.WORLD.BORDER_PADDING + 75;
    let minClearance = probeDist;
    const tanksToCheck = allTanks.length > 0 ? allTanks : (playerTank ? [playerTank] : []);

    for (const frac of [0.55, 1.0]) {
      const px = this.x + Math.cos(probeAngle) * (probeDist * frac);
      const py = this.y + Math.sin(probeAngle) * (probeDist * frac);

      if (px < pad || px > CONFIG.WORLD.WIDTH - pad || py < pad || py > CONFIG.WORLD.HEIGHT - pad) {
        return -1000;
      }

      // Check all tanks & wrecks (friendly & enemy)
      for (const t of tanksToCheck) {
        if (!t || t === this) continue;
        const td = Math.hypot(px - t.x, py - t.y);
        const minSep = 122 * this.scale;
        if (td < minSep) return -520 + td;
        minClearance = Math.min(minClearance, td - minSep);
      }

      // Check trees & solid environmental objects
      if (environment && environment.obstacles) {
        for (const o of environment.obstacles) {
          if (o.state === 'FALLEN' || o.state === 'DESTROYED') continue;
          const r = o.trunkRadius || o.collisionRadius || o.radius || 18;
          const d = Math.hypot(px - o.x, py - o.y) - (r + this.halfWidth + 10);
          if (o.kind === 'small_tree') {
            // Mild preference to route around small trees, though destructible if needed
            if (d < 0) minClearance = Math.min(minClearance, -15);
            continue;
          }
          if (d < 0) return -450 + d;
          minClearance = Math.min(minClearance, d);
        }
      }

      // Check trenches & trench walls (avoid driving into deep/roofed trenches)
      if (environment?.trenchSystem?.segments) {
        for (const seg of environment.trenchSystem.segments) {
          if (seg.depth !== 'deep' && !seg.hasRoof) continue;
          const dx = seg.x2 - seg.x1;
          const dy = seg.y2 - seg.y1;
          const lenSq = dx * dx + dy * dy;
          const t = lenSq > 1e-6 ? Math.max(0, Math.min(1, ((px - seg.x1) * dx + (py - seg.y1) * dy) / lenSq)) : 0;
          const projX = seg.x1 + t * dx;
          const projY = seg.y1 + t * dy;
          const d = Math.hypot(px - projX, py - projY) - (seg.halfWidth + this.halfWidth + 8);
          if (d < 0) return -420 + d;
          minClearance = Math.min(minClearance, d);
        }
      }

      // Check intact sandbag parapets
      if (environment?.trenchSystem?.sandbags) {
        for (const bag of environment.trenchSystem.sandbags) {
          if (bag.displaced) continue;
          const d = Math.hypot(px - bag.x, py - bag.y) - (this.halfWidth + 10);
          if (d < 0) return -320 + d;
          minClearance = Math.min(minClearance, d);
        }
      }

      // Mildly deflect around deep shell craters
      if (environment?.craters) {
        for (const c of environment.craters) {
          if (c.radius < 12) continue;
          const d = Math.hypot(px - c.x, py - c.y) - (c.radius + this.halfWidth);
          if (d < 0) minClearance = Math.min(minClearance, 4);
        }
      }

      // Slight avoidance of infantry when maneuvering
      if (infantry && infantry.length > 0) {
        for (const s of infantry) {
          if (!s || !s.alive || s.inVehicle) continue;
          const d = Math.hypot(px - s.x, py - s.y) - (this.halfWidth + 12);
          if (d < 0) minClearance = Math.min(minClearance, 6);
        }
      }
    }
    return minClearance;
  }

  _pickFlankWaypoint(tgt, environment, playerTank, allTanks = []) {
    const bearing = Math.atan2(tgt.y - this.y, tgt.x - this.x);
    const pad = CONFIG.WORLD.BORDER_PADDING + 85;
    const offsets = [Math.PI * 0.35, -Math.PI * 0.35, Math.PI * 0.55, -Math.PI * 0.55, Math.PI * 0.8, -Math.PI * 0.8, 0];
    const tanksToCheck = allTanks.length > 0 ? allTanks : (playerTank ? [playerTank] : []);
    let best = null;
    let bestScore = -Infinity;
    for (const off of offsets) {
      const ang = bearing + off;
      const dist = off === 0 ? 150 : 190;
      const wx = Math.max(pad, Math.min(CONFIG.WORLD.WIDTH - pad, this.x + Math.cos(ang) * dist));
      const wy = Math.max(pad, Math.min(CONFIG.WORLD.HEIGHT - pad, this.y + Math.sin(ang) * dist));
      let blocked = false;
      for (const t of tanksToCheck) {
        if (!t || t === this) continue;
        if (Math.hypot(wx - t.x, wy - t.y) < 145) {
          blocked = true;
          break;
        }
      }
      if (!blocked && environment && environment.obstacles) {
        for (const o of environment.obstacles) {
          if (o.kind !== 'small_tree' && o.state !== 'FALLEN' && o.state !== 'DESTROYED') {
            const r = o.trunkRadius || o.collisionRadius || o.radius || 18;
            if (Math.hypot(wx - o.x, wy - o.y) < r + this.halfWidth + 14) {
              blocked = true;
              break;
            }
          }
        }
      }
      if (!blocked && environment?.trenchSystem?.segments) {
        for (const seg of environment.trenchSystem.segments) {
          if (seg.depth !== 'deep' && !seg.hasRoof) continue;
          const dx = seg.x2 - seg.x1;
          const dy = seg.y2 - seg.y1;
          const lenSq = dx * dx + dy * dy;
          const t = lenSq > 1e-6 ? Math.max(0, Math.min(1, ((wx - seg.x1) * dx + (wy - seg.y1) * dy) / lenSq)) : 0;
          if (Math.hypot(wx - (seg.x1 + t * dx), wy - (seg.y1 + t * dy)) < seg.halfWidth + this.halfWidth + 8) {
            blocked = true;
            break;
          }
        }
      }
      if (blocked) continue;
      const hasLOS = !environment || environment.hasLineOfSight(wx, wy, tgt.x, tgt.y);
      const score = (hasLOS ? 400 : 0) - Math.hypot(wx - tgt.x, wy - tgt.y) * 0.35;
      if (score > bestScore) {
        bestScore = score;
        best = { x: wx, y: wy };
      }
    }
    return best || { x: tgt.x, y: tgt.y };
  }

  _updateHullMovement(dt, moveGoal, reverseMode, canDrive, enginePowerMult, trackSpeedMult, terrain, playerTank, allTanks = [], infantry = []) {
    const surface = terrain ? terrain.getSurfaceAt(this.x, this.y) : 'NORMAL';
    let desiredDir = 0;
    let throttleInput = 0;
    let brakeInput = 0;
    const nav = this._navMonitor;

    if (!canDrive || !moveGoal) {
      this.angularVelocity = 0;
      brakeInput = 0.6;
      this.drivetrain.aiUpdateGear(0, this.speed);
      nav.checkTimer = 0;
      nav.lastCheckPos.x = this.x;
      nav.lastCheckPos.y = this.y;
    } else {
      let surfTurn = 1.0;
      if (surface === 'MUD') surfTurn = 0.58;
      else if (surface === 'SAND') surfTurn = 0.86;
      else if (surface === 'DIRT') surfTurn = 0.97;

      const turnRate = 0.95 * Math.max(0.4, enginePowerMult) * trackSpeedMult * surfTurn;
      const desiredBearing = Math.atan2(moveGoal.y - this.y, moveGoal.x - this.x);
      let steerAngle = desiredBearing;

      // Movement-progress monitor & stuck recovery state machine
      if (nav.recoveryPhase === 'RECOVER_REVERSE') {
        nav.recoveryTimer -= dt;
        reverseMode = true;
        steerAngle = nav.recoverySteerAngle;
        if (nav.recoveryTimer <= 0) {
          nav.recoveryPhase = 'RECOVER_TURN';
          nav.recoveryTimer = 0.85;
        }
      } else if (nav.recoveryPhase === 'RECOVER_TURN') {
        nav.recoveryTimer -= dt;
        steerAngle = nav.recoverySteerAngle;
        if (nav.recoveryTimer <= 0 || Math.abs(normalizeAngle(nav.recoverySteerAngle - this.angle)) < 0.25) {
          nav.recoveryPhase = 'NONE';
          this._repositionTarget = null;
          nav.lastCheckPos.x = this.x;
          nav.lastCheckPos.y = this.y;
          nav.checkTimer = 0;
        }
      } else if (this._reverseTimer > 0) {
        this._reverseTimer = Math.max(0, this._reverseTimer - dt);
        reverseMode = true;
      } else if (!reverseMode) {
        // 7-ray autonomous obstacle avoidance fan
        const directClear = this._scoreForwardClearance(desiredBearing, 115, terrain, playerTank, allTanks, infantry);
        if (directClear < 14) {
          const fanOffsets = [0, -0.38, 0.38, -0.75, 0.75, -1.15, 1.15];
          let bestAngle = desiredBearing;
          let bestScore = -Infinity;
          for (const off of fanOffsets) {
            const testAng = desiredBearing + off;
            const clr = this._scoreForwardClearance(testAng, 120, terrain, playerTank, allTanks, infantry);
            const score = clr - Math.abs(off) * 28;
            if (score > bestScore) {
              bestScore = score;
              bestAngle = testAng;
            }
          }
          if (bestScore < -60) {
            const rearClr = this._scoreForwardClearance(this.angle + Math.PI, 85, terrain, playerTank, allTanks, infantry);
            if (rearClr > -200) {
              this._reverseTimer = 0.85;
              reverseMode = true;
            } else {
              steerAngle = bestAngle;
            }
          } else {
            steerAngle = bestAngle;
          }
        }

        // Progress check every 0.6s
        nav.checkTimer += dt;
        if (nav.checkTimer >= 0.6) {
          const disp = Math.hypot(this.x - nav.lastCheckPos.x, this.y - nav.lastCheckPos.y);
          nav.lastCheckPos.x = this.x;
          nav.lastCheckPos.y = this.y;
          nav.checkTimer = 0;
          if (disp < 10) {
            nav.stallCount += 1;
            let bestEscAng = this.angle + Math.PI * 0.5;
            let bestEscClr = -Infinity;
            for (let k = 0; k < 12; k++) {
              const a = (k / 12) * Math.PI * 2;
              const c = this._scoreForwardClearance(a, 130, terrain, playerTank, allTanks, infantry);
              if (c > bestEscClr) {
                bestEscClr = c;
                bestEscAng = a;
              }
            }
            if (bestEscClr < -150 && nav.stallCount >= 4) {
              nav.unresolvableObstruction = true;
            } else {
              nav.unresolvableObstruction = false;
              nav.recoverySteerAngle = bestEscAng;
              const rearClr = this._scoreForwardClearance(this.angle + Math.PI, 80, terrain, playerTank, allTanks, infantry);
              nav.recoveryPhase = rearClr > -180 ? 'RECOVER_REVERSE' : 'RECOVER_TURN';
              nav.recoveryTimer = rearClr > -180 ? 0.95 : 0.85;
            }
          } else {
            nav.stallCount = 0;
            nav.unresolvableObstruction = false;
          }
        }
      }

      const targetHullAngle = reverseMode ? normalizeAngle(steerAngle + Math.PI) : steerAngle;
      const hullDiff = normalizeAngle(targetHullAngle - this.angle);

      const maxTurnStep = turnRate * dt;
      if (Math.abs(hullDiff) <= maxTurnStep) {
        this.angle = normalizeAngle(targetHullAngle);
        this.angularVelocity = 0;
      } else {
        const dir = Math.sign(hullDiff);
        this.angle = normalizeAngle(this.angle + dir * maxTurnStep);
        this.angularVelocity = dir * turnRate;
      }

      desiredDir = reverseMode ? -1 : 1;
      throttleInput = reverseMode ? 0.85 : (Math.abs(hullDiff) > 0.65 ? 0.35 : Math.max(0.55, Math.cos(hullDiff)));
      this.drivetrain.aiUpdateGear(desiredDir, this.speed);
    }

    this.speed = this.drivetrain.update(dt, {
      engineRunning: enginePowerMult > 0,
      canDrive,
      throttleInput,
      brakeInput,
      currentSpeed: this.speed,
      enginePowerMult,
      trackSpeedMult,
      surface,
      bothTracksBroken: trackSpeedMult <= 0,
    });

    if (Math.abs(this.speed) > 0.5 || Math.abs(this.angularVelocity) > 0.02) {
      this.x += Math.cos(this.angle) * this.speed * dt;
      this.y += Math.sin(this.angle) * this.speed * dt;
      const trackHalf = 46 * this.scale;
      this.leftTrackPhase += (this.speed - this.angularVelocity * trackHalf) * dt * 0.4;
      this.rightTrackPhase += (this.speed + this.angularVelocity * trackHalf) * dt * 0.4;
      if (terrain) {
        const surf = terrain.getSurfaceAt(this.x, this.y);
        if (surf === 'MUD') this.dirtAccumulation = Math.min(1, this.dirtAccumulation + dt * 0.22);
        else if (surf === 'DIRT' || surf === 'SAND') this.dirtAccumulation = Math.min(0.75, this.dirtAccumulation + dt * 0.08);
      }
    }

    // Clamp to playable world bounds
    const pad = CONFIG.WORLD.BORDER_PADDING + 58;
    this.x = Math.max(pad, Math.min(CONFIG.WORLD.WIDTH - pad, this.x));
    this.y = Math.max(pad, Math.min(CONFIG.WORLD.HEIGHT - pad, this.y));

    // Prevent driving through other tanks (friendly or enemy)
    const tanksToSep = allTanks.length > 0 ? allTanks : (playerTank ? [playerTank] : []);
    for (const other of tanksToSep) {
      if (!other || other === this) continue;
      const dx = this.x - other.x;
      const dy = this.y - other.y;
      const dist = Math.hypot(dx, dy);
      const minSep = 126 * this.scale;
      if (dist > 0.01 && dist < minSep) {
        const push = (minSep - dist) * (other.faction === this.faction ? 0.5 : 1.0);
        this.x += (dx / dist) * push;
        this.y += (dy / dist) * push;
        this.speed *= 0.45;
      }
    }
  }

  selectBestAmmoForTarget(tgt) {
    if (!tgt) return this.selectedAmmoId;
    const isTankTarget = typeof tgt.getOBB === 'function';
    if (!isTankTarget) {
      if (this.heAmmo > 0) {
        this.selectedAmmoId = 'SPRGR38_50';
        return 'SPRGR38_50';
      }
      this.selectedAmmoId = this.apAmmo > 0 ? 'PZGR39_50' : 'PZGR40_50';
      return this.selectedAmmoId;
    }
    const distMeters = Math.hypot(tgt.x - this.x, tgt.y - this.y) / CONFIG.TANK.PIXELS_PER_METER;
    const apPen = interpolatePenetration(AMMO_TYPES.PZGR39_50, distMeters);
    const apcrPen = interpolatePenetration(AMMO_TYPES.PZGR40_50, distMeters);
    if (this.apcrAmmo > 0 && (this.apAmmo === 0 || (distMeters <= 380 && apcrPen >= apPen + 12))) {
      this.selectedAmmoId = 'PZGR40_50';
      return 'PZGR40_50';
    }
    if (this.apAmmo > 0) {
      this.selectedAmmoId = 'PZGR39_50';
      return 'PZGR39_50';
    }
    if (this.heAmmo > 0) {
      this.selectedAmmoId = 'SPRGR38_50';
      return 'SPRGR38_50';
    }
    return this.selectedAmmoId;
  }

  getWeaponStatus() {
    return {
      variantName: this.variantName,
      gunDesignation: this.gunDesignation,
      selectedAmmoId: this.selectedAmmoId,
      apAmmo: this.apAmmo,
      apcrAmmo: this.apcrAmmo,
      heAmmo: this.heAmmo,
      reloadDuration: this.reloadDuration,
      reloadProgress: this.reloadTimer > 0 ? Math.max(0, Math.min(1, 1 - this.reloadTimer / this.reloadDuration)) : 1,
      reloading: this.reloadTimer > 0,
    };
  }

  _updateCombatAI(dt, particles, infantry, combatContext, pivot) {
    const {
      playerTank = null,
      environment = null,
      projectiles = null,
      sound = null,
    } = combatContext;

    const engState = this.damageSystem.getState('ENGINE');
    const transState = this.damageSystem.getState('TRANSMISSION');
    const leftTrackBroken = this.damageSystem.getState('LEFT_TRACK') === MODULE_STATE.DESTROYED;
    const rightTrackBroken = this.damageSystem.getState('RIGHT_TRACK') === MODULE_STATE.DESTROYED;
    const bothTracksBroken = leftTrackBroken && rightTrackBroken;
    const oneTrackBroken = (leftTrackBroken || rightTrackBroken) && !bothTracksBroken;
    const driverOk = this.damageSystem.isCrewOperable('DRIVER');

    let enginePowerMult = 1.0;
    if (engState === MODULE_STATE.DESTROYED || transState === MODULE_STATE.DESTROYED) enginePowerMult = 0;
    else if (engState === MODULE_STATE.CRITICAL || transState === MODULE_STATE.CRITICAL) enginePowerMult = 0.4;
    else if (engState === MODULE_STATE.DAMAGED || transState === MODULE_STATE.DAMAGED) enginePowerMult = 0.72;

    const trackSpeedMult = bothTracksBroken ? 0 : (oneTrackBroken ? 0.32 : 1.0);
    const canDrive = enginePowerMult > 0 && !bothTracksBroken && driverOk && !this.trackRepair.isActive;

    const turretRingState = this.damageSystem.getState('TURRET_RING');
    const breechState = this.damageSystem.getState('BREECH');
    const gunnerOk = this.damageSystem.isCrewOperable('GUNNER');
    const commanderOk = this.damageSystem.isCrewOperable('COMMANDER');
    const loaderOk = this.damageSystem.isCrewOperable('LOADER');

    const canTraverseTurret =
      turretRingState !== MODULE_STATE.DESTROYED && (gunnerOk || commanderOk);
    const canFireMainGun =
      breechState !== MODULE_STATE.DESTROYED && gunnerOk;

    if (!canDrive && !canFireMainGun && !canTraverseTurret) {
      this.aiState = ENEMY_AI_STATE.DISABLED;
      this._updateHullMovement(dt, null, false, false, 0, 0, environment, playerTank);
      return;
    }

    let traverseSpeed = 0.26; // ~15 deg/s for Panzer III Ausf. L
    if (turretRingState === MODULE_STATE.DAMAGED || !gunnerOk || this.damageSystem.getState('GUNNER') === MODULE_STATE.DAMAGED) {
      traverseSpeed *= 0.5;
    }

    let reloadRate = 1.0;
    if (!loaderOk) reloadRate *= 0.45;
    else if (this.damageSystem.getState('LOADER') === MODULE_STATE.DAMAGED) reloadRate *= 0.7;
    if (breechState === MODULE_STATE.DAMAGED) reloadRate *= 0.75;

    this.reloadTimer = Math.max(0, this.reloadTimer - dt * reloadRate);
    this.mgBurstCooldown = Math.max(0, this.mgBurstCooldown - dt);

    if (this.reloadTimer > 0 && (this.apAmmo + this.apcrAmmo + this.heAmmo) > 0 && !this.destroyed && breechState !== MODULE_STATE.DESTROYED && sound && playerTank) {
      const p = 1 - this.reloadTimer / this.reloadDuration;
      const rk = `pz3_${this.reloadSeqId || 0}`;
      if (this._pzReloadStage === 0 && p >= 0.14) {
        this._pzReloadStage = 1;
        sound.playPanzerReloadStage?.('breech_open', this.x, this.y, playerTank.x, playerTank.y, rk);
      } else if (this._pzReloadStage === 1 && p >= 0.86) {
        this._pzReloadStage = 2;
        sound.playPanzerReloadStage?.('breech_close', this.x, this.y, playerTank.x, playerTank.y, rk);
      }
    } else if (this.reloadTimer <= 0 || this.destroyed) {
      if (this.destroyed && this._pzReloadStage > 0) {
        sound?.stopReloadSound?.(`pz3_${this.reloadSeqId || 0}`);
      }
      this._pzReloadStage = 0;
    }

    // Direct Player Possession override (CUSTOM_BATTLE mode)
    if (this.isPlayerPossessed && combatContext?.playerInput && !this.destroyed) {
      const inp = combatContext.playerInput;
      if (inp.isDown('Digit1') && this.apAmmo > 0) this.selectedAmmoId = 'PZGR39_50';
      if (inp.isDown('Digit2') && this.apcrAmmo > 0) this.selectedAmmoId = 'PZGR40_50';
      if (inp.isDown('Digit3') && this.heAmmo > 0) this.selectedAmmoId = 'SPRGR38_50';

      if (canDrive) {
        const turnDir = (inp.isAnyDown('KeyD', 'ArrowRight') ? 1 : 0) - (inp.isAnyDown('KeyA', 'ArrowLeft') ? 1 : 0);
        const turnRate = 0.92 * enginePowerMult * trackSpeedMult;
        this.angularVelocity = turnDir * turnRate;
        this.angle = normalizeAngle(this.angle + this.angularVelocity * dt);
        const fwd = inp.isAnyDown('KeyW', 'ArrowUp');
        const rev = inp.isAnyDown('KeyS', 'ArrowDown');
        const desiredDir = fwd ? 1 : (rev ? -1 : 0);
        this.drivetrain.aiUpdateGear(desiredDir, this.speed);
        const surface = environment ? environment.getSurfaceAt(this.x, this.y) : 'NORMAL';
        this.speed = this.drivetrain.update(dt, {
          engineRunning: enginePowerMult > 0,
          canDrive,
          throttleInput: desiredDir !== 0 ? 0.95 : 0,
          brakeInput: desiredDir === 0 ? 0.6 : 0,
          currentSpeed: this.speed,
          enginePowerMult,
          trackSpeedMult,
          surface,
          bothTracksBroken,
        });
        this.x += Math.cos(this.angle) * this.speed * dt;
        this.y += Math.sin(this.angle) * this.speed * dt;
        const pad = CONFIG.WORLD.BORDER_PADDING + 58;
        this.x = Math.max(pad, Math.min(CONFIG.WORLD.WIDTH - pad, this.x));
        this.y = Math.max(pad, Math.min(CONFIG.WORLD.HEIGHT - pad, this.y));
      }

      if (canTraverseTurret) {
        const tDir = (inp.isAnyDown('KeyE', 'KeyP') ? 1 : 0) - (inp.isAnyDown('KeyQ', 'KeyO') ? 1 : 0);
        this.turretAngle = normalizeAngle(this.turretAngle + tDir * traverseSpeed * 1.35 * dt);
      }

      const updatedPivot = this.getTurretPivot();
      if (canFireMainGun && this.reloadTimer <= 0 && inp.isDown('Space') && projectiles) {
        let ammoId = this.selectedAmmoId;
        if (ammoId === 'PZGR39_50' && this.apAmmo <= 0) ammoId = this.apcrAmmo > 0 ? 'PZGR40_50' : 'SPRGR38_50';
        if (ammoId === 'PZGR40_50' && this.apcrAmmo <= 0) ammoId = this.apAmmo > 0 ? 'PZGR39_50' : 'SPRGR38_50';
        if (ammoId === 'SPRGR38_50' && this.heAmmo <= 0) ammoId = this.apAmmo > 0 ? 'PZGR39_50' : 'PZGR40_50';
        const hasSel =
          (ammoId === 'PZGR39_50' && this.apAmmo > 0) ||
          (ammoId === 'PZGR40_50' && this.apcrAmmo > 0) ||
          (ammoId === 'SPRGR38_50' && this.heAmmo > 0);
        if (hasSel) {
          if (ammoId === 'PZGR39_50') this.apAmmo--;
          else if (ammoId === 'PZGR40_50') this.apcrAmmo--;
          else this.heAmmo--;
          const mx = updatedPivot.x + Math.cos(this.turretAngle) * (112 * this.scale);
          const my = updatedPivot.y + Math.sin(this.turretAngle) * (112 * this.scale);
          projectiles.spawnEnemyCannonShell(mx, my, this.turretAngle, ammoId, this.faction, this);
          particles?.spawnCannonMuzzleFlash?.(mx, my, this.turretAngle);
          sound?.playCannon?.();
          this.turretRecoil = 1.0;
          this.reloadTimer = this.reloadDuration;
          this.reloadSeqId = (this.reloadSeqId || 0) + 1;
          this._pzReloadStage = 0;
        }
      }

      if (gunnerOk && this.mgAmmo > 0 && this.mgBurstCooldown <= 0 && inp.isDown('KeyZ') && projectiles) {
        const mx = updatedPivot.x + Math.cos(this.turretAngle) * (66 * this.scale);
        const my = updatedPivot.y + Math.sin(this.turretAngle) * (66 * this.scale);
        this.mgAmmo--;
        this.mgBurstCooldown = 0.085;
        projectiles.spawnEnemyMGBullet(mx, my, this.turretAngle + (Math.random() - 0.5) * 0.025, this.faction, this);
        particles?.spawnMGMuzzleFlash?.(mx, my, this.turretAngle);
        sound?.playMG?.('coax');
      }
      return;
    }

    // Prioritize operational Soviet tanks (player + allied T-34-85s), then Soviet infantry
    const candidates = [];
    const enemyTanks = [playerTank, ...(combatContext?.friendlyTanks || [])].filter(
      (t) => t && t.faction !== this.faction && !t.damageSystem?.vehicleDestroyed && !t.damageSystem?.vehicleAbandoned
    );
    for (const et of enemyTanks) {
      candidates.push(et);
    }
    for (const s of infantry) {
      if (s.alive && !s.inVehicle && s.faction !== this.faction) {
        candidates.push(s);
      }
    }

    const detState = this.detection.update(dt, {
      observerX: pivot.x,
      observerY: pivot.y,
      observerAngle: this.turretAngle,
      candidates,
      environment,
    });

    if (combatContext?.voiceSystem && playerTank) {
      const vs = combatContext.voiceSystem;
      if (detState !== this._prevDetState) {
        if (detState === DETECTION_STATE.TARGET_DETECTED) {
          vs.requestChat(this, 'TANK_TARGET_SPOTTED', 3, playerTank.x, playerTank.y, environment);
        } else if (detState === DETECTION_STATE.ENGAGING) {
          vs.requestChat(this, 'TANK_ENGAGING', 4, playerTank.x, playerTank.y, environment);
        } else if (detState === DETECTION_STATE.SEARCHING && this._prevDetState === DETECTION_STATE.ENGAGING) {
          vs.requestChat(this, 'TANK_LOST_CONTACT', 5, playerTank.x, playerTank.y, environment);
        }
        this._prevDetState = detState;
      }
      const trDmg =
        this.damageSystem.getState('LEFT_TRACK') !== 'NORMAL' ||
        this.damageSystem.getState('RIGHT_TRACK') !== 'NORMAL';
      if (trDmg && !this._trackChatWarned) {
        this._trackChatWarned = true;
        vs.requestChat(this, 'TANK_TRACK_DAMAGED', 2, playerTank.x, playerTank.y, environment);
      }
    }

    // Prioritize closest visible operational Soviet tank when detected
    if (
      (detState === DETECTION_STATE.TARGET_DETECTED || detState === DETECTION_STATE.ENGAGING) &&
      enemyTanks.length > 0 &&
      typeof this.detection.target?.getOBB !== 'function'
    ) {
      let bestTank = null;
      let bestTDist = Infinity;
      for (const et of enemyTanks) {
        if (!this.detection._canSeeCandidate(pivot.x, pivot.y, this.turretAngle, et, environment)) continue;
        const d = Math.hypot(et.x - this.x, et.y - this.y);
        if (d < bestTDist) {
          bestTDist = d;
          bestTank = et;
        }
      }
      if (bestTank) {
        this.detection.target = bestTank;
      }
    }

    // Decide hull movement goal & AI state
    let moveGoal = null;
    let reverseMode = false;
    let hasClearMuzzleLOS = false;

    if (
      (detState === DETECTION_STATE.TARGET_DETECTED || detState === DETECTION_STATE.ENGAGING) &&
      this.detection.target
    ) {
      const tgt = this.detection.target;
      const tgtDist = Math.hypot(tgt.x - this.x, tgt.y - this.y);
      const muzzleDist = 112 * this.scale;
      const mx = pivot.x + Math.cos(this.turretAngle) * muzzleDist;
      const my = pivot.y + Math.sin(this.turretAngle) * muzzleDist;
      hasClearMuzzleLOS =
        (!environment || environment.hasLineOfSight(mx, my, tgt.x, tgt.y)) &&
        this._hasClearCannonShot(mx, my, tgt.x, tgt.y, infantry);

      if (tgtDist < 195) {
        moveGoal = tgt;
        reverseMode = true;
        this._repositionTarget = null;
      } else if (tgtDist > 520 || !hasClearMuzzleLOS) {
        if (!this._repositionTarget || Math.hypot(this._repositionTarget.x - this.x, this._repositionTarget.y - this.y) < 35) {
          this._repositionTarget = this._pickFlankWaypoint(tgt, environment, playerTank);
        }
        moveGoal = this._repositionTarget;
      } else {
        this._repositionTarget = null;
      }
    } else if (
      (detState === DETECTION_STATE.INVESTIGATING ||
        detState === DETECTION_STATE.LOST_CONTACT ||
        detState === DETECTION_STATE.SEARCHING) &&
      this.detection.lastKnownPos
    ) {
      const lkp = this.detection.lastKnownPos;
      if (Math.hypot(lkp.x - this.x, lkp.y - this.y) > 280) {
        moveGoal = lkp;
      }
    } else if (detState === DETECTION_STATE.UNAWARE) {
      if (this.assaultObjective) {
        if (Math.hypot(this.assaultObjective.x - this.x, this.assaultObjective.y - this.y) > 95) {
          moveGoal = this.assaultObjective;
        }
      } else {
        const wp = this._patrolWaypoints[this._patrolIdx];
        if (Math.hypot(wp.x - this.x, wp.y - this.y) < 18) {
          this._patrolIdx = (this._patrolIdx + 1) % this._patrolWaypoints.length;
        }
        moveGoal = this._patrolWaypoints[this._patrolIdx];
      }
    }

    const allTanksForNav = [
      playerTank,
      ...(combatContext?.friendlyTanks || []),
      ...(combatContext?.allTargets || []),
    ].filter(Boolean);

    this._updateHullMovement(
      dt,
      moveGoal,
      reverseMode,
      canDrive,
      enginePowerMult,
      trackSpeedMult,
      environment,
      playerTank,
      allTanksForNav,
      infantry
    );

    // Recompute pivot & turret aim after hull update
    const updatedPivot = this.getTurretPivot();
    let desiredAngle = this.angle;
    if (
      (detState === DETECTION_STATE.TARGET_DETECTED || detState === DETECTION_STATE.ENGAGING) &&
      this.detection.target
    ) {
      desiredAngle = Math.atan2(
        this.detection.target.y - updatedPivot.y,
        this.detection.target.x - updatedPivot.x
      );
    } else if (
      (detState === DETECTION_STATE.INVESTIGATING ||
        detState === DETECTION_STATE.LOST_CONTACT ||
        detState === DETECTION_STATE.SEARCHING) &&
      this.detection.lastKnownPos
    ) {
      const base = Math.atan2(
        this.detection.lastKnownPos.y - updatedPivot.y,
        this.detection.lastKnownPos.x - updatedPivot.x
      );
      desiredAngle =
        detState === DETECTION_STATE.SEARCHING
          ? base + Math.sin(this.detection.stateTimer * 1.4) * 0.45
          : base;
    }

    const angleDiff = normalizeAngle(desiredAngle - this.turretAngle);
    if (canTraverseTurret) {
      const maxStep = traverseSpeed * dt;
      if (Math.abs(angleDiff) <= maxStep) {
        this.turretAngle = normalizeAngle(desiredAngle);
      } else {
        this.turretAngle = normalizeAngle(this.turretAngle + Math.sign(angleDiff) * maxStep);
      }
    }

    if (
      detState === DETECTION_STATE.ENGAGING &&
      this.detection.target &&
      Math.abs(angleDiff) < 0.055
    ) {
      this.aimSettleTimer += dt;
    } else {
      this.aimSettleTimer = 0;
    }

    // Update AI state & execute firing cycle
    let firedThisFrame = false;
    if (
      detState === DETECTION_STATE.ENGAGING &&
      this.detection.target &&
      canFireMainGun &&
      this.aimSettleTimer >= 0.35 &&
      this.reloadTimer <= 0 &&
      projectiles
    ) {
      const tgt = this.detection.target;
      const isTankTarget = typeof tgt.getOBB === 'function';
      const hasAmmo = isTankTarget ? (this.apAmmo + this.apcrAmmo) > 0 : (this.heAmmo + this.apAmmo + this.apcrAmmo) > 0;
      const muzzleDist = 112 * this.scale;
      const mx = updatedPivot.x + Math.cos(this.turretAngle) * muzzleDist;
      const my = updatedPivot.y + Math.sin(this.turretAngle) * muzzleDist;
      const clearLOS =
        (!environment || environment.hasLineOfSight(mx, my, tgt.x, tgt.y)) &&
        this._hasClearCannonShot(mx, my, tgt.x, tgt.y, infantry);

      if (hasAmmo && clearLOS) {
        const ammoId = this.selectBestAmmoForTarget(tgt);
        if (ammoId === 'PZGR39_50') this.apAmmo = Math.max(0, this.apAmmo - 1);
        else if (ammoId === 'PZGR40_50') this.apcrAmmo = Math.max(0, this.apcrAmmo - 1);
        else this.heAmmo = Math.max(0, this.heAmmo - 1);

        const spread = (Math.random() - 0.5) * 0.022;
        projectiles.spawnEnemyCannonShell(mx, my, this.turretAngle + spread, ammoId, this.faction, this);
        particles?.spawnCannonMuzzleFlash?.(mx, my, this.turretAngle);
        sound?.playCannon?.();
        this.turretRecoil = 1.0;
        this.reloadTimer = this.reloadDuration;
        this.reloadSeqId = (this.reloadSeqId || 0) + 1;
        this._pzReloadStage = 0;
        this.aimSettleTimer = 0;
        firedThisFrame = true;
      }
    } else if (
      detState === DETECTION_STATE.ENGAGING &&
      this.detection.target &&
      typeof this.detection.target.getOBB !== 'function' &&
      gunnerOk &&
      this.mgAmmo > 0 &&
      Math.abs(angleDiff) < 0.12 &&
      this.mgBurstCooldown <= 0 &&
      projectiles
    ) {
      const muzzleDist = 66 * this.scale;
      const mx = updatedPivot.x + Math.cos(this.turretAngle) * muzzleDist;
      const my = updatedPivot.y + Math.sin(this.turretAngle) * muzzleDist;
      const clearLOS =
        (!environment || environment.hasLineOfSight(mx, my, this.detection.target.x, this.detection.target.y)) &&
        this._hasClearCannonShot(mx, my, this.detection.target.x, this.detection.target.y, infantry);
      if (clearLOS) {
        this.mgAmmo = Math.max(0, this.mgAmmo - 1);
        const spread = (Math.random() - 0.5) * 0.045;
        projectiles.spawnEnemyMGBullet(mx, my, this.turretAngle + spread, this.faction, 'coax');
        particles?.spawnMGMuzzleFlash?.(mx, my, this.turretAngle);
        sound?.playMG?.('coax');
        this.mgBurstCooldown = 0.16;
      }
    }

    if (firedThisFrame) {
      this.aiState = ENEMY_AI_STATE.FIRING;
    } else if (detState === DETECTION_STATE.UNAWARE) {
      this.aiState = Math.abs(this.speed) > 2 ? ENEMY_AI_STATE.PATROLLING : ENEMY_AI_STATE.IDLE;
    } else if (detState === DETECTION_STATE.INVESTIGATING) {
      this.aiState = ENEMY_AI_STATE.DETECTING;
    } else if (detState === DETECTION_STATE.LOST_CONTACT || detState === DETECTION_STATE.SEARCHING) {
      this.aiState = ENEMY_AI_STATE.LOST_CONTACT;
    } else if (moveGoal && Math.abs(this.angularVelocity) > 0.1) {
      this.aiState = ENEMY_AI_STATE.TURNING_HULL;
    } else if (moveGoal && canDrive) {
      this.aiState = this._repositionTarget ? ENEMY_AI_STATE.REPOSITIONING : ENEMY_AI_STATE.MOVING_TO_POSITION;
    } else if (detState === DETECTION_STATE.TARGET_DETECTED) {
      this.aiState = ENEMY_AI_STATE.TARGET_ACQUIRED;
    } else if (this.reloadTimer > 0) {
      this.aiState = ENEMY_AI_STATE.RELOADING;
    } else {
      this.aiState = ENEMY_AI_STATE.AIMING;
    }
  }

  render(ctx, sprite, inspectionMode = false, hullSprite = null, turretSprite = null, lighting = null) {
    if (!sprite && (!hullSprite || !turretSprite)) return;

    if (lighting && !inspectionMode) {
      const sun = lighting.sunDir;
      const shLen = lighting.shadowLen;
      const shAlpha = lighting.shadowAlpha;
      const ox = sun.x * 10 * shLen;
      const oy = sun.y * 10 * shLen;

      ctx.save();
      ctx.translate(this.x + ox, this.y + oy);
      ctx.rotate(this.angle);
      ctx.scale(this.scale, this.scale);
      ctx.fillStyle = `rgba(10, 14, 8, ${shAlpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.roundRect(-100, -53, 200, 106, 7);
      ctx.fill();
      ctx.restore();

      const pivot = this.getTurretPivot();
      ctx.save();
      ctx.translate(pivot.x + ox * 1.15, pivot.y + oy * 1.15);
      ctx.rotate(this.turretAngle);
      ctx.scale(this.scale, this.scale);
      ctx.fillStyle = `rgba(10, 14, 8, ${(shAlpha * 0.7).toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, 34, 28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(28, -4, 68, 8);
      ctx.restore();
    }

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.scale(this.scale, this.scale);

    // Subtle ground contact shadow / ambient occlusion
    if (!inspectionMode) {
      ctx.fillStyle = lighting ? 'rgba(8, 10, 7, 0.30)' : 'rgba(0, 0, 0, 0.28)';
      if (lighting) {
        ctx.fillRect(-100, -53, 200, 17);
        ctx.fillRect(-100, 36, 200, 17);
      } else {
        ctx.fillRect(-102, -55, 204, 110);
      }
    }

    // Only BURNING (progressively) and BURNT_OUT darken the hull; DESTROYED without fire keeps original grey paint!
    if (inspectionMode) {
      ctx.globalAlpha = 0.28;
    } else if (this.vehicleState === VEHICLE_STATE.BURNING) {
      const dark = Math.max(0.42, 1.0 - this.burnProgress * 0.58);
      ctx.filter = `brightness(${dark.toFixed(2)}) contrast(${(1 + this.burnProgress * 0.15).toFixed(2)})`;
    } else if (this.vehicleState === VEHICLE_STATE.BURNT_OUT) {
      ctx.filter = 'brightness(0.38) contrast(1.15)';
    }

    if (hullSprite && turretSprite) {
      ctx.drawImage(hullSprite, -120, -65);
      // Animated track treads & broken track visuals on hull
      if (this.damageSystem.getState('LEFT_TRACK') === MODULE_STATE.DESTROYED) {
        this._renderBrokenTrack(ctx, -46);
      } else {
        this._renderAnimatedTrackTreads(ctx, -46, this.leftTrackPhase);
      }
      if (this.damageSystem.getState('RIGHT_TRACK') === MODULE_STATE.DESTROYED) {
        this._renderBrokenTrack(ctx, 46);
      } else {
        this._renderAnimatedTrackTreads(ctx, 46, this.rightTrackPhase);
      }
      if (lighting && !inspectionMode && this.dirtAccumulation > 0.03) {
        const a = (this.dirtAccumulation * 0.40).toFixed(2);
        ctx.fillStyle = `rgba(74, 58, 38, ${a})`;
        ctx.fillRect(-98, -51, 196, 12);
        ctx.fillRect(-98, 39, 196, 12);
      }
      ctx.save();
      ctx.translate(8, 0);
      ctx.rotate(this.turretAngle - this.angle);
      ctx.translate(-8, 0);
      ctx.drawImage(turretSprite, -120, -65);
      ctx.restore();
    } else {
      ctx.drawImage(sprite, -120, -65);
      if (this.damageSystem.getState('LEFT_TRACK') === MODULE_STATE.DESTROYED) {
        this._renderBrokenTrack(ctx, -46);
      }
      if (this.damageSystem.getState('RIGHT_TRACK') === MODULE_STATE.DESTROYED) {
        this._renderBrokenTrack(ctx, 46);
      }
    }
    ctx.filter = 'none';
    ctx.globalAlpha = 1.0;

    // Progressive localized char marks & flickering flame emitters during BURNING / BURNT_OUT
    if (!inspectionMode && (this.vehicleState === VEHICLE_STATE.BURNING || this.vehicleState === VEHICLE_STATE.BURNT_OUT)) {
      for (const em of this.fireEmitters) {
        if (this.burnProgress < em.startAt) continue;
        const localT = Math.min(1, (this.burnProgress - em.startAt) / Math.max(0.15, 1 - em.startAt));
        // Localized soot/char gradient around emitter
        const sootR = em.maxRadius * (1.2 + localT * 1.8);
        const sg = ctx.createRadialGradient(em.lx, em.ly, 2, em.lx, em.ly, sootR);
        sg.addColorStop(0, `rgba(18, 14, 12, ${(0.72 * localT).toFixed(2)})`);
        sg.addColorStop(0.6, `rgba(42, 28, 18, ${(0.45 * localT).toFixed(2)})`);
        sg.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(em.lx, em.ly, sootR, 0, Math.PI * 2);
        ctx.fill();

        // Active flickering flames (strong in Stage 1-2, dying embers in Stage 3 BURNT_OUT)
        const flameStrength = this.vehicleState === VEHICLE_STATE.BURNT_OUT
          ? 0.25 * (this.postBurnSmokeTimer / 8.0)
          : Math.sin(localT * Math.PI * 0.85) + 0.25;
        if (flameStrength > 0.05) {
          const flicker = 0.82 + Math.sin(this._flamePhase + em.lx) * 0.22;
          const fr = em.maxRadius * Math.min(1.15, flameStrength) * flicker;
          const fg = ctx.createRadialGradient(em.lx, em.ly, 1, em.lx, em.ly, fr);
          fg.addColorStop(0, 'rgba(255, 240, 160, 0.92)');
          fg.addColorStop(0.45, 'rgba(255, 125, 25, 0.78)');
          fg.addColorStop(1, 'rgba(180, 30, 10, 0)');
          ctx.fillStyle = fg;
          ctx.beginPath();
          ctx.arc(em.lx, em.ly, fr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    renderArmorImpactMarks(ctx, this.impactMarks, 'rgba(148, 154, 160, 0.55)');
    ctx.restore();

    const pivot = this.getTurretPivot();
    this.trackRepair.render(ctx, this.x, this.y, this.angle, this.scale, pivot, this.turretAngle);
    this.bailout.render(ctx, this.x, this.y, this.angle, pivot, this.turretAngle, this.scale);

    if (inspectionMode) {
      renderPanzerIIIInternals(ctx, this);
    }
  }

  _renderAnimatedTrackTreads(ctx, yCenter, phase) {
    const showMicro = ctx.getTransform().a >= 0.65;
    renderDetailedTrackTreads(ctx, yCenter, phase, { xStart: -101, xEnd: -91, linkStep: 5, isGerman: true, showMicro });
    renderDetailedTrackTreads(ctx, yCenter, phase, { xStart: 90, xEnd: 101, linkStep: 5, isGerman: true, showMicro });
  }

  _renderBrokenTrack(ctx, yCenter) {
    ctx.fillStyle = '#151614';
    ctx.fillRect(-94, yCenter - 6, 20, 12);
    ctx.fillRect(72, yCenter - 6, 18, 12);
    ctx.fillStyle = '#313538';
    ctx.beginPath();
    ctx.arc(-96, yCenter, 4.2, 0, Math.PI * 2);
    ctx.arc(96, yCenter, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#474a4f';
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    ctx.moveTo(-94, yCenter - 3);
    ctx.lineTo(-108, yCenter + 5);
    ctx.moveTo(90, yCenter + 3);
    ctx.lineTo(104, yCenter - 4);
    ctx.stroke();
  }
}
