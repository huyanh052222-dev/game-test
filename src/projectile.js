/**
 * Projectile manager for 85mm cannon shells and 7.62mm DT tracer rounds.
 * Each round has independent position, velocity, trail, and lifetime.
 */
import { CONFIG } from './config.js';
import { AMMO_TYPES } from './combat/projectileData.js';
import { TRENCH_COMBAT_CONFIG } from './trench.js?v=9';

function segmentHitsCircle(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return (cx - x1) * (cx - x1) + (cy - y1) * (cy - y1) <= r * r;
  }
  const t = Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / lenSq));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return (cx - px) * (cx - px) + (cy - py) * (cy - py) <= r * r;
}

export class ProjectileManager {
  constructor(particles, sound, debugOverlay = null) {
    this.projectiles = [];
    this.particles = particles;
    this.sound = sound;
    this.debugOverlay = debugOverlay;
    this._mgShotCounter = 0;
    this.friendlyFireEnabled = true;
    this.onFriendlyFire = null;
  }

  _getUnitLabel(entity) {
    if (!entity) return 'Unit';
    if (entity.armorPreset?.id === 'T34_85_1944' || entity.turret) {
      return entity.isReinforcement ? 'Allied T-34-85' : 'Player T-34-85';
    }
    if (entity.armorPreset?.id === 'PANZER_III_J' || entity.containsPoint) {
      return 'Panzer III';
    }
    if (entity.faction === 'soviet') {
      return entity.uniformStyle === 'tanker' ? 'Soviet Tank Crew' : 'Soviet Infantry';
    }
    return 'German Infantry';
  }

  _getShooterLabel(p) {
    if (p.ownerTank) return this._getUnitLabel(p.ownerTank);
    if (p.ownerId) return p.ownerFaction === 'soviet' ? 'Soviet Soldier' : 'German Soldier';
    return p.ownerFaction === 'soviet' ? 'Allied T-34-85' : 'Panzer III';
  }

  spawnCannonShell(x, y, angle, ammoId = 'BR365K', ownerFaction = 'soviet', ownerTank = null) {
    const speed = CONFIG.MAIN_GUN.PROJECTILE_SPEED;
    this.projectiles.push({
      type: 'cannon',
      ammoId,
      ownerFaction,
      ownerTank,
      x,
      y,
      spawnX: x,
      spawnY: y,
      prevX: x,
      prevY: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      angle,
      distanceTraveled: 0,
      ricocheted: false,
      hitSoldierIds: [],
      hitObstacleIds: [],
      life: CONFIG.MAIN_GUN.PROJECTILE_LIFETIME,
      maxLife: CONFIG.MAIN_GUN.PROJECTILE_LIFETIME,
      trail: [{ x, y }],
    });
  }

  spawnArtilleryShell(x, y, angle, ammoId = 'BR350A', ownerFaction = 'soviet', ownerGun = null) {
    const ammo = AMMO_TYPES[ammoId] || AMMO_TYPES.BR350A;
    const speed = Math.max(920, Math.round((ammo.muzzleVelocityMs || 662) * 1.84));
    this.projectiles.push({
      type: 'cannon',
      ammoId,
      ownerFaction,
      ownerTank: ownerGun,
      isArtillery: true,
      fromRaisedPosition: true,
      x,
      y,
      spawnX: x,
      spawnY: y,
      prevX: x,
      prevY: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      angle,
      distanceTraveled: 0,
      ricocheted: false,
      hitSoldierIds: [],
      hitObstacleIds: [],
      life: CONFIG.MAIN_GUN.PROJECTILE_LIFETIME * 1.15,
      maxLife: CONFIG.MAIN_GUN.PROJECTILE_LIFETIME * 1.15,
      trail: [{ x, y }],
    });
  }

  spawnMGBullet(x, y, angle, sourceTag, ownerFaction = 'soviet', ownerTank = null) {
    const speed = CONFIG.MG.PROJECTILE_SPEED;
    this._mgShotCounter = (this._mgShotCounter + 1) % 3;
    const isTracer = this._mgShotCounter === 0;
    this.projectiles.push({
      type: 'mg',
      ammoId: 'DT_762',
      source: sourceTag, // 'coax' or 'hull'
      ownerFaction,
      ownerTank,
      isTracer,
      x,
      y,
      spawnX: x,
      spawnY: y,
      prevX: x,
      prevY: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      angle,
      distanceTraveled: 0,
      ricocheted: false,
      hitSoldierIds: [],
      hitObstacleIds: [],
      life: CONFIG.MG.PROJECTILE_LIFETIME,
      maxLife: CONFIG.MG.PROJECTILE_LIFETIME,
    });
  }

  spawnEnemyCannonShell(
    x,
    y,
    angle,
    ammoId = 'PZGR39_50',
    ownerFaction = 'german',
    speedOrTank = CONFIG.MAIN_GUN.PROJECTILE_SPEED * 1.05,
    ownerTank = null
  ) {
    const isTankObj = speedOrTank && typeof speedOrTank === 'object';
    const speed = isTankObj ? CONFIG.MAIN_GUN.PROJECTILE_SPEED * 1.05 : speedOrTank;
    const resolvedTank = isTankObj ? speedOrTank : ownerTank;
    this.projectiles.push({
      type: 'cannon',
      ammoId,
      ownerFaction,
      ownerTank: resolvedTank,
      x,
      y,
      spawnX: x,
      spawnY: y,
      prevX: x,
      prevY: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      angle,
      distanceTraveled: 0,
      ricocheted: false,
      hitSoldierIds: [],
      hitObstacleIds: [],
      life: CONFIG.MAIN_GUN.PROJECTILE_LIFETIME,
      maxLife: CONFIG.MAIN_GUN.PROJECTILE_LIFETIME,
      trail: [{ x, y }],
    });
  }

  spawnEnemyMGBullet(
    x,
    y,
    angle,
    ownerFaction = 'german',
    sourceTag = 'coax',
    speed = CONFIG.MG.PROJECTILE_SPEED,
    ownerTank = null
  ) {
    this._mgShotCounter = (this._mgShotCounter + 1) % 3;
    const isTracer = this._mgShotCounter === 0;
    this.projectiles.push({
      type: 'mg',
      ammoId: 'MG34_792',
      source: sourceTag,
      ownerFaction,
      ownerTank,
      isTracer,
      x,
      y,
      spawnX: x,
      spawnY: y,
      prevX: x,
      prevY: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      angle,
      distanceTraveled: 0,
      ricocheted: false,
      hitSoldierIds: [],
      hitObstacleIds: [],
      life: CONFIG.MG.PROJECTILE_LIFETIME,
      maxLife: CONFIG.MG.PROJECTILE_LIFETIME,
    });
  }

  spawnRifleBullet(x, y, angle, ammoId, ownerFaction, ownerId, speed = 980, damage = 15) {
    const isSMG = ammoId === 'SMG_762_25';
    const maxLife = isSMG ? 0.95 : 1.4;
    this.projectiles.push({
      type: 'mg',
      ammoId,
      source: 'rifle',
      ownerFaction,
      ownerId,
      damage,
      isTracer: !isSMG || (this._mgShotCounter = (this._mgShotCounter + 1) % 3) === 0,
      x,
      y,
      spawnX: x,
      spawnY: y,
      prevX: x,
      prevY: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      angle,
      distanceTraveled: 0,
      ricocheted: false,
      hitSoldierIds: [],
      hitObstacleIds: [],
      life: maxLife,
      maxLife,
    });
  }

  update(dt, targets = [], infantry = [], environment = null, playerTank = null, friendlyTanks = []) {
    const w = CONFIG.WORLD.WIDTH;
    const h = CONFIG.WORLD.HEIGHT;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.prevX = p.x;
      p.prevY = p.y;
      const stepX = p.vx * dt;
      const stepY = p.vy * dt;
      p.x += stepX;
      p.y += stepY;
      p.distanceTraveled += Math.hypot(stepX, stepY);
      p.life -= dt;

      if (p.type === 'cannon') {
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 10) {
          p.trail.shift();
        }
      }

      // Physical trench wall, dugout roof, and open trench traversal check
      let trenchOutcome = 'clear';
      if (environment?.trenchSystem?.resolveProjectileTraversal) {
        const tr = environment.trenchSystem.resolveProjectileTraversal(
          p.prevX,
          p.prevY,
          p.x,
          p.y,
          p,
          this.particles,
          environment
        );
        trenchOutcome = tr.outcome;
        if (tr.outcome === 'blocked') {
          this.projectiles.splice(i, 1);
          continue;
        }
        if (tr.outcome === 'wall_hit' || tr.outcome === 'trench_detonate') {
          this._applyCannonSplash(
            tr.x,
            tr.y,
            p.ammoId,
            infantry,
            environment,
            p.ownerFaction,
            p.ownerTank,
            [...(playerTank ? [playerTank] : []), ...friendlyTanks, ...targets],
            this._getShooterLabel(p)
          );
          this.sound.playExplosion();
          this.projectiles.splice(i, 1);
          continue;
        }
      }

      // Check collision against living infantry (swept segment vs hitbox, skip self & already-pierced)
      let hitSoldier = null;
      for (const s of infantry) {
        if (!s.alive) continue;
        if (p.ownerId && s.id === p.ownerId) continue;
        if (!this.friendlyFireEnabled && p.ownerFaction && s.faction === p.ownerFaction) continue;
        if (p.hitSoldierIds && p.hitSoldierIds.includes(s.id)) continue;
        if (segmentHitsCircle(p.prevX, p.prevY, p.x, p.y, s.x, s.y, s.hitboxRadius)) {
          hitSoldier = s;
          break;
        }
      }
      if (hitSoldier) {
        // Crouched soldier below deep-trench rim is protected from a shell passing cleanly overhead
        if (p.type === 'cannon' && trenchOutcome === 'pass_over') {
          const isCrouched = hitSoldier.aiState !== 'FIRING';
          if (isCrouched && hitSoldier.inTrench && hitSoldier.trenchDepth === 'deep') {
            hitSoldier = null;
          }
        }
      }
      if (hitSoldier) {
        if (p.hitSoldierIds) p.hitSoldierIds.push(hitSoldier.id);
        const impactAngle = Math.atan2(p.vy, p.vx);
        const isFriendlyHit = Boolean(p.ownerFaction && hitSoldier.faction === p.ownerFaction);
        if (p.type === 'mg') {
          if (environment?.trenchSystem) {
            const sTrench = environment.trenchSystem.getTrenchStateAt(hitSoldier.x, hitSoldier.y);
            const pTrench = environment.trenchSystem.getTrenchStateAt(p.prevX, p.prevY);
            if (sTrench.inTrench && !pTrench.inTrench) {
              const isCrouched = hitSoldier.aiState !== 'FIRING';
              const deepCover = sTrench.depth === 'deep' && isCrouched;
              const protectProb = sTrench.hasRoof
                ? 0.85
                : (deepCover ? TRENCH_COMBAT_CONFIG.SMALL_ARMS_300M_PROTECTION_PROB : 0.25);
              if (Math.random() < protectProb) {
                this.particles.spawnBulletImpact(p.x, p.y, false);
                this.projectiles.splice(i, 1);
                continue;
              }
            }
          }
          const killed = hitSoldier.takeDamage(p.damage || 15, this.particles, p.x, p.y, impactAngle, 'mg');
          if (isFriendlyHit) {
            this.onFriendlyFire?.({
              type: killed ? 'FRIENDLY INFANTRY CASUALTY' : 'FRIENDLY FIRE',
              detail: `${this._getShooterLabel(p)} hit ${this._getUnitLabel(hitSoldier)}`,
              isKill: Boolean(killed),
              isVehicle: false,
            });
          }
          this.projectiles.splice(i, 1);
          continue;
        } else {
          const ammo = AMMO_TYPES[p.ammoId] || AMMO_TYPES.BR365K;
          const isHE = ammo.type === 'HE';
          const killed = hitSoldier.takeDamage(100, this.particles, hitSoldier.x, hitSoldier.y, impactAngle, 'cannon', {
            blastX: hitSoldier.x,
            blastY: hitSoldier.y,
            blastRadius: isHE ? 95 : 42,
            intensity: 1.0,
            isDirect: true,
            ammoType: ammo.type,
          });
          if (isFriendlyHit) {
            this.onFriendlyFire?.({
              type: killed ? 'FRIENDLY INFANTRY CASUALTY' : 'FRIENDLY FIRE',
              detail: `${this._getShooterLabel(p)} hit ${this._getUnitLabel(hitSoldier)}`,
              isKill: Boolean(killed),
              isVehicle: false,
            });
          }

          if (isHE) {
            // HE 0.5mm fuse arms on impact: detonate and consume shell
            this._applyCannonSplash(
              hitSoldier.x,
              hitSoldier.y,
              p.ammoId,
              infantry,
              environment,
              p.ownerFaction,
              p.ownerTank,
              [...(playerTank ? [playerTank] : []), ...friendlyTanks, ...targets],
              this._getShooterLabel(p)
            );
            this.particles.spawnImpact(hitSoldier.x, hitSoldier.y, 'ground', 0.95);
            this.sound.playExplosion();
            this.projectiles.splice(i, 1);
            continue;
          } else {
            // APHE / APCR punches straight through human target with minimal kinetic loss
            const retain = ammo.type === 'APCR' ? 0.97 : 0.93;
            p.vx *= retain;
            p.vy *= retain;
            this.particles.spawnTrackDust(hitSoldier.x, hitSoldier.y, p.vx * 0.08, p.vy * 0.08, 0.45, false);
            // Continue in same frame to check targets behind the soldier!
          }
        }
      }

      // Check collision against exposed repairing crew outside target vehicles, player tank & friendly tanks
      let hitExposedCrew = null;
      const checkRepairList = [
        ...(playerTank ? [playerTank] : []),
        ...friendlyTanks,
        ...targets,
      ];
      for (const veh of checkRepairList) {
        if (!veh.trackRepair) continue;
        if (p.ownerTank === veh) continue;
        if (!this.friendlyFireEnabled && p.ownerFaction && veh.faction === p.ownerFaction) continue;
        const pos = veh.trackRepair.getWorldCrewPosition(veh.x, veh.y, veh.angle, veh.scale);
        if (pos && segmentHitsCircle(p.prevX, p.prevY, p.x, p.y, pos.x, pos.y, pos.radius)) {
          hitExposedCrew = { repair: veh.trackRepair, pos, veh };
          break;
        }
      }
      if (hitExposedCrew) {
        const impactAngle = Math.atan2(p.vy, p.vx);
        const dmg = p.type === 'mg' ? 30 : 100;
        const wType = p.type === 'mg' ? 'mg' : 'cannon';
        const bInfo = p.type === 'cannon' ? { blastX: hitExposedCrew.pos.x, blastY: hitExposedCrew.pos.y, intensity: 1.0, isDirect: true } : null;
        hitExposedCrew.repair.onHitOutside(dmg, this.particles, hitExposedCrew.pos.x, hitExposedCrew.pos.y, impactAngle, infantry, wType, bInfo);
        if (p.ownerFaction && hitExposedCrew.veh.faction === p.ownerFaction) {
          this.onFriendlyFire?.({
            type: 'FRIENDLY INFANTRY CASUALTY',
            detail: `${this._getShooterLabel(p)} hit ${this._getUnitLabel(hitExposedCrew.veh)} repair crew`,
            isKill: true,
            isVehicle: false,
          });
        }
        if (p.type === 'mg') {
          this.projectiles.splice(i, 1);
          continue;
        }
      }

      // Check collision against standing trees in Firing Range / Environment
      if (environment && environment.obstacles && environment.obstacles.length > 0) {
        let hitTree = null;
        for (const o of environment.obstacles) {
          if (o.kind !== 'small_tree' && o.kind !== 'large_tree') continue;
          if (o.state === 'FALLING' || o.state === 'FALLEN' || o.state === 'DESTROYED') continue;
          if (p.hitObstacleIds && p.hitObstacleIds.includes(o.id)) continue;
          if (segmentHitsCircle(p.prevX, p.prevY, p.x, p.y, o.x, o.y, o.trunkRadius)) {
            hitTree = o;
            break;
          }
        }
        if (hitTree) {
          if (p.hitObstacleIds) p.hitObstacleIds.push(hitTree.id);
          const impactAngle = Math.atan2(p.vy, p.vx);
          if (p.type === 'mg') {
            environment.damageTree(hitTree, 2, impactAngle, this.particles, false);
            this.projectiles.splice(i, 1);
            continue;
          } else {
            const ammo = AMMO_TYPES[p.ammoId] || AMMO_TYPES.BR365K;
            const isHE = ammo.type === 'HE';
            const treeDmg = isHE ? 140 : (ammo.type === 'APCR' ? 65 : 80);
            environment.damageTree(hitTree, treeDmg, impactAngle, this.particles, isHE);
            if (isHE) {
              this.particles.spawnImpact(hitTree.x, hitTree.y, 'ground', 0.95);
              this.sound.playExplosion();
              this.projectiles.splice(i, 1);
              continue;
            } else {
              // APHE / APCR penetrates wood trunk and continues flying with slight energy loss
              const retain = ammo.type === 'APCR' ? 0.90 : 0.84;
              p.vx *= retain;
              p.vy *= retain;
            }
          }
        }
      }

      // Check collision against player T-34-85 and friendly reinforcement T-34-85s
      if (!p.ricocheted) {
        const sovietVehicles = playerTank ? [playerTank, ...friendlyTanks] : friendlyTanks;
        let hitFriendly = null;
        for (const veh of sovietVehicles) {
          if (!veh || p.ownerTank === veh) continue;
          if (!this.friendlyFireEnabled && p.ownerFaction && p.ownerFaction === veh.faction) continue;
          const obb = veh.getOBB();
          const cos = Math.cos(-obb.angle);
          const sin = Math.sin(-obb.angle);
          const dx = p.x - obb.x;
          const dy = p.y - obb.y;
          const lx = dx * cos - dy * sin;
          const ly = dx * sin + dy * cos;
          if (Math.abs(lx) <= obb.halfLength && Math.abs(ly) <= obb.halfWidth) {
            hitFriendly = veh;
            break;
          }
        }
        if (hitFriendly) {
          const wasDestroyed = Boolean(hitFriendly.damageSystem?.vehicleDestroyed);
          const impactRes = hitFriendly.receiveImpact(p, this.particles, this.sound);
          const isFriendlyFire = Boolean(p.ownerFaction && p.ownerFaction === hitFriendly.faction);
          if (isFriendlyFire && (p.type === 'cannon' || impactRes?.penetrated || impactRes?.spall || hitFriendly.damageSystem?.vehicleDestroyed)) {
            const nowDestroyed = Boolean(hitFriendly.damageSystem?.vehicleDestroyed);
            this.onFriendlyFire?.({
              type: !wasDestroyed && nowDestroyed ? 'ALLIED UNIT DESTROYED' : 'ALLIED VEHICLE DAMAGED',
              detail: `${this._getShooterLabel(p)} hit ${this._getUnitLabel(hitFriendly)}`,
              isKill: !wasDestroyed && nowDestroyed,
              isVehicle: true,
            });
          }
          if (p.type === 'cannon') {
            this._applyCannonSplash(
              p.x,
              p.y,
              p.ammoId,
              infantry,
              environment,
              p.ownerFaction,
              p.ownerTank,
              [...(playerTank ? [playerTank] : []), ...friendlyTanks, ...targets],
              this._getShooterLabel(p)
            );
          }
          this.projectiles.splice(i, 1);
          continue;
        }
      }

      // Check collision against target vehicles (Panzer III etc.)
      if (!p.ricocheted) {
        let hitTarget = null;
        for (const target of targets) {
          if (!target || p.ownerTank === target) continue;
          if (!this.friendlyFireEnabled && p.ownerFaction && target.faction === p.ownerFaction) continue;
          if (target.containsPoint(p.x, p.y)) {
            hitTarget = target;
            break;
          }
        }
        if (hitTarget) {
          const wasDestroyed = Boolean(hitTarget.destroyed || hitTarget.damageSystem?.vehicleDestroyed);
          hitTarget.onHit(p, this.particles, this.sound, this.debugOverlay);
          const isFriendlyFire = Boolean(p.ownerFaction && hitTarget.faction === p.ownerFaction);
          if (isFriendlyFire && (p.type === 'cannon' || hitTarget.destroyed || hitTarget.damageSystem?.vehicleDestroyed)) {
            const nowDestroyed = Boolean(hitTarget.destroyed || hitTarget.damageSystem?.vehicleDestroyed);
            this.onFriendlyFire?.({
              type: !wasDestroyed && nowDestroyed ? 'ALLIED UNIT DESTROYED' : 'ALLIED VEHICLE DAMAGED',
              detail: `${this._getShooterLabel(p)} hit ${this._getUnitLabel(hitTarget)}`,
              isKill: !wasDestroyed && nowDestroyed,
              isVehicle: true,
            });
          }
          if (!p.ricocheted) {
            if (p.type === 'cannon') {
              this._applyCannonSplash(
                p.x,
                p.y,
                p.ammoId,
                infantry,
                environment,
                p.ownerFaction,
                p.ownerTank,
                [...(playerTank ? [playerTank] : []), ...friendlyTanks, ...targets],
                this._getShooterLabel(p)
              );
            }
            this.projectiles.splice(i, 1);
            continue;
          }
        }
      }

      const hitBorder = p.x <= 0 || p.x >= w || p.y <= 0 || p.y >= h;
      if (hitBorder || p.life <= 0) {
        const clampedX = Math.max(0, Math.min(w, p.x));
        const clampedY = Math.max(0, Math.min(h, p.y));

        if (p.type === 'cannon') {
          const ammo = AMMO_TYPES[p.ammoId] || AMMO_TYPES.BR365K;
          this.particles.spawnImpact(
            clampedX,
            clampedY,
            hitBorder ? 'metal' : 'ground',
            hitBorder ? 1.1 : 0.95
          );
          if (!hitBorder) {
            environment?.addShellCrater?.(clampedX, clampedY, ammo.caliberMm, ammo.type === 'HE');
            environment?.trenchSystem?.applyArtilleryImpact?.(clampedX, clampedY, p.ammoId, this.particles, environment);
          }
          this._applyCannonSplash(
            clampedX,
            clampedY,
            p.ammoId,
            infantry,
            environment,
            p.ownerFaction,
            p.ownerTank,
            [...(playerTank ? [playerTank] : []), ...friendlyTanks, ...targets],
            this._getShooterLabel(p)
          );
          this.sound.playExplosion();
        } else if (hitBorder) {
          this.particles.spawnBulletImpact(clampedX, clampedY, true);
        }

        this.projectiles.splice(i, 1);
      }
    }
  }

  _applyCannonSplash(
    bx,
    by,
    ammoId,
    infantry,
    environment = null,
    ownerFaction = null,
    ownerTank = null,
    vehicles = [],
    sourceLabel = 'Shell Explosion'
  ) {
    let splashR = 46;
    let baseDmg = 100;
    if (ammoId === 'O365K' || ammoId === 'SPRGR38_50' || ammoId === 'OF350') splashR = 95;
    else if (ammoId === 'SH354') {
      splashR = 132;
      baseDmg = 88;
    } else if (ammoId === 'BR365A' || ammoId === 'BR350A') splashR = 54;
    else if (ammoId === 'BR350B') splashR = 44;
    else if (ammoId === 'BR365P' || ammoId === 'BR350SP' || ammoId === 'BR354P') splashR = 18;

    this.applyExplosionBlast({
      x: bx,
      y: by,
      radius: splashR,
      baseDamage: baseDmg,
      ownerFaction,
      sourceTank: ownerTank,
      sourceLabel,
      infantry,
      vehicles,
      environment,
      affectVehicles: ammoId === 'O365K' || ammoId === 'SPRGR38_50' || ammoId === 'OF350',
    });
  }

  /**
   * Unified radial blast damage for shell splashes & ammo-rack detonations.
   * Evaluates every nearby soldier and vehicle regardless of faction when
   * friendlyFireEnabled is true, factoring in distance, LOS, and trench cover.
   */
  applyExplosionBlast({
    x: bx,
    y: by,
    radius = 95,
    baseDamage = 100,
    ownerFaction = null,
    sourceTank = null,
    sourceLabel = 'Explosion',
    infantry = [],
    vehicles = [],
    environment = null,
    affectVehicles = true,
  }) {
    if (this.infantryVoice && infantry && infantry.length > 0) {
      this.infantryVoice.emitSoundEvent({
        x: bx,
        y: by,
        kind: 'explosion',
        faction: null,
        radius: 560,
        soldiers: infantry,
        environment,
        listenerX: bx,
        listenerY: by,
      });
    }

    const maxRadius = radius + 12;
    for (const s of infantry) {
      if (!s || !s.alive) continue;
      if (!this.friendlyFireEnabled && ownerFaction && s.faction === ownerFaction) continue;
      const dist = Math.hypot(s.x - bx, s.y - by);
      const limit = radius + s.hitboxRadius;
      if (dist <= limit) {
        const blastAngle = Math.atan2(s.y - by, s.x - bx);
        const protMult = environment?.trenchSystem?.getBlastProtectionMultiplier?.(s.x, s.y, bx, by) ?? 1.0;
        const losMult =
          environment && typeof environment.hasLineOfSight === 'function' && !environment.hasLineOfSight(bx, by, s.x, s.y)
            ? 0.55
            : 1.0;
        const effMult = protMult * losMult;
        const intensity = Math.max(0.12, Math.min(1.0, (1 - dist / maxRadius) * effMult));
        const killed = s.takeDamage(baseDamage * effMult, this.particles, s.x, s.y, blastAngle, 'cannon', {
          blastX: bx,
          blastY: by,
          blastRadius: limit,
          intensity,
          isDirect: false,
        });
        if (ownerFaction && s.faction === ownerFaction) {
          this.onFriendlyFire?.({
            type: killed ? 'FRIENDLY INFANTRY CASUALTY' : 'FRIENDLY FIRE',
            detail: `${sourceLabel} blast hit ${this._getUnitLabel(s)}`,
            isKill: Boolean(killed),
            isVehicle: false,
          });
        }
        if (killed && this.infantryVoice) {
          this.infantryVoice.emitCasualtyEvent({
            victim: s,
            blastX: bx,
            blastY: by,
            isArtillery: true,
            soldiers: infantry,
            environment,
            listenerX: bx,
            listenerY: by,
          });
        }
      }
    }

    if (!affectVehicles || !vehicles || vehicles.length === 0) return;
    for (const veh of vehicles) {
      if (!veh || veh === sourceTank) continue;
      if (!this.friendlyFireEnabled && ownerFaction && veh.faction === ownerFaction) continue;
      const dist = Math.hypot(veh.x - bx, veh.y - by);
      if (dist > radius + 35) continue;

      const protMult = environment?.trenchSystem?.getBlastProtectionMultiplier?.(veh.x, veh.y, bx, by) ?? 1.0;
      const losMult =
        environment && typeof environment.hasLineOfSight === 'function' && !environment.hasLineOfSight(bx, by, veh.x, veh.y)
          ? 0.5
          : 1.0;
      const falloff = Math.max(0.15, 1 - dist / (radius + 40));
      const blastDmg = baseDamage * 0.42 * falloff * protMult * losMult;
      if (blastDmg < 6) continue;

      const wasDestroyed = Boolean(veh.destroyed || veh.damageSystem?.vehicleDestroyed);
      veh.damageSystem?.applyDirectDamage?.('LEFT_TRACK', blastDmg, 'Explosion');
      veh.damageSystem?.applyDirectDamage?.('RIGHT_TRACK', blastDmg * 0.75, 'Explosion');
      if (blastDmg > 22) {
        veh.damageSystem?.applyDirectDamage?.('ENGINE', blastDmg * 0.55, 'Explosion');
      }

      if (ownerFaction && veh.faction === ownerFaction) {
        const nowDestroyed = Boolean(veh.destroyed || veh.damageSystem?.vehicleDestroyed);
        this.onFriendlyFire?.({
          type: !wasDestroyed && nowDestroyed ? 'ALLIED UNIT DESTROYED' : 'ALLIED VEHICLE DAMAGED',
          detail: `${sourceLabel} blast damaged ${this._getUnitLabel(veh)}`,
          isKill: !wasDestroyed && nowDestroyed,
          isVehicle: true,
        });
      }
    }
  }

  render(ctx) {
    for (const p of this.projectiles) {
      if (p.type === 'cannon') {
        this._renderCannonShell(ctx, p);
      } else {
        this._renderMGBullet(ctx, p);
      }
    }
  }

  _renderCannonShell(ctx, p) {
    // Glowing projectile trail
    if (p.trail.length >= 2) {
      for (let i = 1; i < p.trail.length; i++) {
        const a = p.trail[i - 1];
        const b = p.trail[i];
        const ratio = i / p.trail.length;
        ctx.strokeStyle = `rgba(255, 185, 70, ${(ratio * 0.75).toFixed(2)})`;
        ctx.lineWidth = ratio * 5.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // 85mm shell body + bright tracer core
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);

    // Outer glow
    ctx.fillStyle = 'rgba(255, 160, 40, 0.45)';
    ctx.beginPath();
    ctx.ellipse(-2, 0, 12, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Pointed shell silhouette
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-4, -3);
    ctx.lineTo(-8, -2.5);
    ctx.lineTo(-8, 2.5);
    ctx.lineTo(-4, 3);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  _renderMGBullet(ctx, p) {
    const tailLen = p.isTracer ? 22 : 10;
    const dx = Math.cos(p.angle);
    const dy = Math.sin(p.angle);
    const tailX = p.x - dx * tailLen;
    const tailY = p.y - dy * tailLen;

    const grad = ctx.createLinearGradient(tailX, tailY, p.x, p.y);
    if (p.isTracer) {
      grad.addColorStop(0, 'rgba(255, 130, 25, 0)');
      grad.addColorStop(0.55, 'rgba(255, 195, 65, 0.85)');
      grad.addColorStop(1, '#ffffff');
    } else {
      grad.addColorStop(0, 'rgba(180, 165, 140, 0)');
      grad.addColorStop(1, 'rgba(225, 210, 180, 0.55)');
    }

    ctx.strokeStyle = grad;
    ctx.lineWidth = p.isTracer ? 2.4 : 1.3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();

    if (p.isTracer) {
      ctx.fillStyle = '#fff9df';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
