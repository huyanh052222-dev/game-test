/**
 * Player Reinforcement Request System (Firing Range Mode).
 *
 * Allows the player to press T to request:
 *   1. A 10-soldier Soviet infantry squad (2 PPSh-41 + 8 Mosin-Nagant M1891/30)
 *   2. One friendly T-34-85 reinforcement tank
 *
 * Reinforcements always enter from a valid map boundary outside the immediate
 * viewport and travel to support/follow the player's T-34-85 and engage hostiles.
 */
import { CONFIG } from './config.js';
import { Tank } from './tank.js';
import { GermanSoldier } from './infantry.js';
import { DetectionTracker, DETECTION_STATE } from './combat/detection.js';

export const REINFORCEMENT_TYPE = {
  INFANTRY_SQUAD: 'infantry_squad',
  TANK: 'tank',
};

export const REINFORCEMENT_STATE = {
  REQUESTED: 'REQUESTED',
  SPAWNING: 'SPAWNING',
  MOVING_TO_PLAYER: 'MOVING_TO_PLAYER',
  ARRIVED: 'ARRIVED',
  FOLLOWING: 'FOLLOWING',
  ENGAGING: 'ENGAGING',
  DESTROYED: 'DESTROYED',
  CANCELLED: 'CANCELLED',
};

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function isPointClearOfEnvironment(x, y, radius, environment, ignoreVehicles = []) {
  const pad = CONFIG.WORLD.BORDER_PADDING || 40;
  if (x < pad || x > CONFIG.WORLD.WIDTH - pad || y < pad || y > CONFIG.WORLD.HEIGHT - pad) {
    return false;
  }

  if (environment?.obstacles) {
    for (const obs of environment.obstacles) {
      const r = (obs.radius || obs.collisionRadius || 28) + radius;
      if (Math.hypot(x - obs.x, y - obs.y) < r) {
        return false;
      }
    }
  }

  if (environment?.trenchSystem) {
    const tState = environment.trenchSystem.getTrenchStateAt(x, y);
    if (tState?.inTrench && (tState.hasRoof || tState.depth === 'deep')) {
      return false;
    }
  }

  for (const veh of ignoreVehicles) {
    if (!veh) continue;
    const minDist = radius + 68;
    if (Math.hypot(x - veh.x, y - veh.y) < minDist) {
      return false;
    }
  }

  return true;
}

export class ReinforcementManager {
  constructor(projectiles, particles, sound, camera) {
    this.projectiles = projectiles;
    this.particles = particles;
    this.sound = sound;
    this.camera = camera;

    this.requests = [];
    this.friendlyTanks = [];
    this._nextReqId = 1;
    this._nextSoldierId = 9000;

    this.cooldownRemaining = 0;
    this.cooldownDuration = 8.0;

    // Radio / tactical HUD notification queue
    this.notification = null; // { text, subtext, timer, maxTimer, tone }
  }

  reset() {
    this.requests = [];
    this.friendlyTanks = [];
    this.cooldownRemaining = 0;
    this.notification = null;
  }

  notify(text, subtext = '', tone = 'info', duration = 4.2) {
    this.notification = {
      text,
      subtext,
      tone,
      timer: duration,
      maxTimer: duration,
    };
  }

  hasActiveRequestOfType(type) {
    return this.requests.some(
      (r) =>
        r.type === type &&
        r.state !== REINFORCEMENT_STATE.DESTROYED &&
        r.state !== REINFORCEMENT_STATE.CANCELLED
    );
  }

  canRequest(type) {
    if (this.cooldownRemaining > 0) {
      return {
        ok: false,
        reason: `Radio cooldown: ${Math.ceil(this.cooldownRemaining)}s remaining`,
      };
    }
    if (this.hasActiveRequestOfType(type)) {
      const label = type === REINFORCEMENT_TYPE.INFANTRY_SQUAD ? 'Soviet Infantry Squad' : 'T-34-85 Tank';
      return {
        ok: false,
        reason: `${label} is already deployed on the battlefield`,
      };
    }
    return { ok: true, reason: '' };
  }

  /**
   * Picks a valid spawn coordinate near the map boundary, outside the active
   * camera viewport and clear of obstacles, deep trenches, and vehicles.
   */
  selectBoundarySpawn(playerTank, environment, targets = [], infantry = [], isTank = false) {
    const W = CONFIG.WORLD.WIDTH;
    const H = CONFIG.WORLD.HEIGHT;
    const margin = isTank ? 115 : 85;
    const clearRadius = isTank ? 62 : 24;

    const px = playerTank ? playerTank.x : W * 0.5;
    const py = playerTank ? playerTank.y : H * 0.5;
    const viewW = this.camera?.width || 1280;
    const viewH = this.camera?.height || 720;
    const camX = this.camera?.x ?? px - viewW * 0.5;
    const camY = this.camera?.y ?? py - viewH * 0.5;
    const viewBuffer = 160;

    const isOutsideViewport = (x, y) =>
      x < camX - viewBuffer ||
      x > camX + viewW + viewBuffer ||
      y < camY - viewBuffer ||
      y > camY + viewH + viewBuffer;

    // Candidate points along all 4 map boundaries
    const candidates = [];
    const steps = 10;
    for (let i = 1; i < steps; i++) {
      const frac = i / steps;
      candidates.push({ x: margin, y: margin + frac * (H - margin * 2), edge: 'west' });
      candidates.push({ x: W - margin, y: margin + frac * (H - margin * 2), edge: 'east' });
      candidates.push({ x: margin + frac * (W - margin * 2), y: margin, edge: 'north' });
      candidates.push({ x: margin + frac * (W - margin * 2), y: H - margin, edge: 'south' });
    }

    const allVehicles = [
      ...(playerTank ? [playerTank] : []),
      ...this.friendlyTanks,
      ...targets,
    ];

    // Prefer candidates outside viewport, far from enemy Panzer IIIs, behind/flanking player
    const rearAngle = playerTank ? playerTank.angle + Math.PI : Math.PI;
    const rearDirX = Math.cos(rearAngle);
    const rearDirY = Math.sin(rearAngle);

    let best = null;
    let bestScore = -Infinity;

    for (const c of candidates) {
      if (!isPointClearOfEnvironment(c.x, c.y, clearRadius, environment, allVehicles)) {
        continue;
      }

      // Ensure not overlapping existing infantry
      let soldierOverlap = false;
      for (const s of infantry) {
        if (!s.alive) continue;
        if (Math.hypot(s.x - c.x, s.y - c.y) < clearRadius + 24) {
          soldierOverlap = true;
          break;
        }
      }
      if (soldierOverlap) continue;

      let score = 0;
      if (isOutsideViewport(c.x, c.y)) score += 1000;

      const distToPlayer = Math.hypot(c.x - px, c.y - py);
      score -= Math.abs(distToPlayer - 1400) * 0.12;

      // Alignment with rear/flank of player tank
      if (distToPlayer > 1) {
        const dot = ((c.x - px) / distToPlayer) * rearDirX + ((c.y - py) / distToPlayer) * rearDirY;
        score += dot * 220;
      }

      // Keep away from enemy tanks so reinforcements don't spawn directly in front of them
      for (const t of targets) {
        if (!t || t.destroyed) continue;
        const dEnemy = Math.hypot(c.x - t.x, c.y - t.y);
        if (dEnemy < 500) score -= (500 - dEnemy) * 2.5;
      }

      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    if (best) return best;

    // Fallback: pick farthest corner from player & targets
    const corners = [
      { x: margin, y: margin },
      { x: W - margin, y: margin },
      { x: margin, y: H - margin },
      { x: W - margin, y: H - margin },
    ];
    corners.sort((a, b) => Math.hypot(b.x - px, b.y - py) - Math.hypot(a.x - px, a.y - py));
    return corners[0];
  }

  /**
   * Requests a reinforcement unit of the specified type.
   */
  requestReinforcement(type, { playerTank, targets = [], infantry = [], environment = null }) {
    const check = this.canRequest(type);
    if (!check.ok) {
      this.notify('REQUEST DENIED', check.reason, 'warn', 3.2);
      return { ok: false, reason: check.reason };
    }

    const reqId = `reinf_${this._nextReqId++}`;
    const isTank = type === REINFORCEMENT_TYPE.TANK;
    const spawn = this.selectBoundarySpawn(playerTank, environment, targets, infantry, isTank);

    const req = {
      id: reqId,
      type,
      state: REINFORCEMENT_STATE.SPAWNING,
      spawnPos: { x: spawn.x, y: spawn.y },
      soldiers: [],
      tank: null,
      wingmanSide: this.friendlyTanks.length % 2 === 0 ? -1 : 1,
      arrivedNotified: false,
      destroyedNotified: false,
      aiKeys: new Set(),
      aiPressed: new Set(),
      detection: null,
      _shiftCooldown: 0,
      _stuckTimer: 0,
      _reverseTimer: 0,
      _lastPos: { x: spawn.x, y: spawn.y },
    };

    const headingToPlayer = playerTank
      ? Math.atan2(playerTank.y - spawn.y, playerTank.x - spawn.x)
      : 0;

    if (type === REINFORCEMENT_TYPE.INFANTRY_SQUAD) {
      // Exact composition: 2 PPSh-41 submachine gunners + 8 Mosin-Nagant M1891/30 riflemen
      const weaponLoadout = [
        'PPSH_41',
        'PPSH_41',
        'MOSIN_1891_30',
        'MOSIN_1891_30',
        'MOSIN_1891_30',
        'MOSIN_1891_30',
        'MOSIN_1891_30',
        'MOSIN_1891_30',
        'MOSIN_1891_30',
        'MOSIN_1891_30',
      ];

      const perpX = -Math.sin(headingToPlayer);
      const perpY = Math.cos(headingToPlayer);
      const backX = -Math.cos(headingToPlayer);
      const backY = -Math.sin(headingToPlayer);

      for (let i = 0; i < weaponLoadout.length; i++) {
        const col = i % 5;
        const row = Math.floor(i / 5);
        const lateral = (col - 2) * 30;
        const depth = row * 34;

        let sx = clamp(
          spawn.x + perpX * lateral + backX * depth,
          CONFIG.WORLD.BORDER_PADDING,
          CONFIG.WORLD.WIDTH - CONFIG.WORLD.BORDER_PADDING
        );
        let sy = clamp(
          spawn.y + perpY * lateral + backY * depth,
          CONFIG.WORLD.BORDER_PADDING,
          CONFIG.WORLD.HEIGHT - CONFIG.WORLD.BORDER_PADDING
        );

        if (!isPointClearOfEnvironment(sx, sy, 18, environment, playerTank ? [playerTank] : [])) {
          sx = spawn.x + (Math.random() - 0.5) * 28;
          sy = spawn.y + (Math.random() - 0.5) * 28;
        }

        const soldier = new GermanSoldier(this._nextSoldierId++, sx, sy, headingToPlayer, {
          faction: 'soviet',
          uniformStyle: 'infantry',
          weaponId: weaponLoadout[i],
          combatEnabled: true,
        });
        soldier.isReinforcement = true;
        soldier.reinforcementId = reqId;
        soldier.reinforcementSlotIndex = i;
        soldier.reinforcementOrder = {
          targetX: playerTank ? playerTank.x : spawn.x,
          targetY: playerTank ? playerTank.y : spawn.y,
        };

        req.soldiers.push(soldier);
        infantry.push(soldier);
      }

      req.state = REINFORCEMENT_STATE.MOVING_TO_PLAYER;
      this.notify(
        'REINFORCEMENT REQUEST ACCEPTED',
        'Soviet Infantry Squad (2x PPSh-41, 8x Mosin-Nagant) advancing from perimeter',
        'info',
        4.6
      );
    } else if (type === REINFORCEMENT_TYPE.TANK) {
      const baseSound = this.sound;
      const aiSound = new Proxy(
        {
          engineState: 'RUNNING',
          crew: baseSound?.crew || { trigger() {}, updateReloadProgress() {} },
          update() {},
          setEngineDamage() {},
          toggleEngine() {},
        },
        {
          get(target, prop) {
            if (prop in target) return target[prop];
            const val = baseSound?.[prop];
            return typeof val === 'function' ? val.bind(baseSound) : val;
          },
        }
      );
      const tank = new Tank(this.projectiles, this.particles, aiSound, this.camera);
      tank.faction = 'soviet';
      tank.isReinforcement = true;
      tank.reinforcementId = reqId;
      tank.x = spawn.x;
      tank.y = spawn.y;
      tank.angle = headingToPlayer;
      tank.turret.hullAngle = headingToPlayer;
      tank.turret.localAngle = 0;

      // Start engine and shift into 1st gear ready to roll
      tank.drivetrain.requestShiftTo('1', 0);

      req.tank = tank;
      req.detection = new DetectionTracker({
        fovHalfAngle: (110 * Math.PI) / 180,
        maxRange: 1450,
        detectTime: 0.45,
        loseTime: 5.5,
      });
      req.state = REINFORCEMENT_STATE.MOVING_TO_PLAYER;
      this.friendlyTanks.push(tank);

      this.notify(
        'REINFORCEMENT REQUEST ACCEPTED',
        'Friendly T-34-85 approaching from map perimeter',
        'info',
        4.6
      );
    }

    this.requests.push(req);
    this.cooldownRemaining = this.cooldownDuration;
    this.sound?.playRadioConfirm?.();
    return { ok: true, request: req };
  }

  /**
   * Spawns a friendly AI T-34-85 stationed at a fixed defensive firing position
   * (used in SOVIET_TRENCH_DEFENSE mode).
   */
  spawnDefenseTank(x, y, angle, holdAnchor = { x, y }) {
    const reqId = `def_tank_${this._nextReqId++}`;
    const baseSound = this.sound;
    const aiSound = new Proxy(
      {
        engineState: 'RUNNING',
        crew: baseSound?.crew || { trigger() {}, updateReloadProgress() {} },
        update() {},
        setEngineDamage() {},
        toggleEngine() {},
      },
      {
        get(target, prop) {
          if (prop in target) return target[prop];
          const val = baseSound?.[prop];
          return typeof val === 'function' ? val.bind(baseSound) : val;
        },
      }
    );
    const tank = new Tank(this.projectiles, this.particles, aiSound, this.camera);
    tank.faction = 'soviet';
    tank.isReinforcement = true;
    tank.reinforcementId = reqId;
    tank.x = x;
    tank.y = y;
    tank.angle = angle;
    tank.turret.hullAngle = angle;
    tank.turret.localAngle = 0;
    tank.drivetrain.requestShiftTo('1', 0);

    const req = {
      id: reqId,
      type: REINFORCEMENT_TYPE.TANK,
      state: REINFORCEMENT_STATE.FOLLOWING,
      tank,
      soldiers: [],
      holdAnchor,
      detection: new DetectionTracker({
        fovHalfAngle: (125 * Math.PI) / 180,
        maxRange: 1450,
        detectTime: 0.35,
        loseTime: 5.5,
      }),
      aiKeys: new Set(),
      aiPressed: new Set(),
      _shiftCooldown: 0,
      wingmanSide: 1,
      arrivedNotified: true,
      destroyedNotified: false,
      _moveAnnounced: true,
      _hadTarget: false,
      _trackWarned: false,
      _lastPos: { x, y },
      _stuckTimer: 0,
      _reverseTimer: 0,
    };

    this.friendlyTanks.push(tank);
    this.requests.push(req);
    return tank;
  }

  /**
   * Computes non-overlapping formation slot around/behind the player's T-34-85.
   */
  _getSquadSlotPosition(slotIndex, totalCount, playerTank) {
    const px = playerTank.x;
    const py = playerTank.y;
    const rearAngle = playerTank.angle + Math.PI;
    // Fan out behind and to the flanks of the tank at 115px–175px radius
    // so soldiers never block the hull tracks or turret rotation.
    const row = Math.floor(slotIndex / 5);
    const col = slotIndex % 5;
    const arcSpan = Math.PI * 0.92;
    const angleOffset = ((col - 2) / 2) * (arcSpan * 0.5);
    const angle = rearAngle + angleOffset;
    const radius = 118 + row * 44 + (col % 2) * 14;

    return {
      x: clamp(
        px + Math.cos(angle) * radius,
        CONFIG.WORLD.BORDER_PADDING,
        CONFIG.WORLD.WIDTH - CONFIG.WORLD.BORDER_PADDING
      ),
      y: clamp(
        py + Math.sin(angle) * radius,
        CONFIG.WORLD.BORDER_PADDING,
        CONFIG.WORLD.HEIGHT - CONFIG.WORLD.BORDER_PADDING
      ),
    };
  }

  _updateSquadRequest(req, dt, playerTank, targets, infantry) {
    const aliveSoldiers = req.soldiers.filter((s) => s.alive);
    if (aliveSoldiers.length === 0) {
      req.state = REINFORCEMENT_STATE.DESTROYED;
      if (!req.destroyedNotified) {
        req.destroyedNotified = true;
        this.notify('SQUAD LOST', 'Soviet reinforcement infantry squad has been wiped out', 'danger', 4.5);
      }
      return;
    }

    let anyEngaging = false;
    let avgDistToPlayer = 0;

    for (let i = 0; i < aliveSoldiers.length; i++) {
      const s = aliveSoldiers[i];
      if (playerTank) {
        const slot = this._getSquadSlotPosition(i, aliveSoldiers.length, playerTank);
        s.reinforcementOrder = { targetX: slot.x, targetY: slot.y };
        avgDistToPlayer += Math.hypot(s.x - playerTank.x, s.y - playerTank.y);
      }
      if (s._combatTarget || (s.detection && s.detection.state === DETECTION_STATE.ENGAGING)) {
        anyEngaging = true;
      }
    }

    avgDistToPlayer /= aliveSoldiers.length;

    if (req.state === REINFORCEMENT_STATE.MOVING_TO_PLAYER && avgDistToPlayer <= 250) {
      req.state = REINFORCEMENT_STATE.ARRIVED;
      if (!req.arrivedNotified) {
        req.arrivedNotified = true;
        this.notify(
          'INFANTRY ARRIVED',
          `${aliveSoldiers.length} Soviet soldiers on your flank and ready`,
          'success',
          4.0
        );
        // Trigger contextual voice greeting if soldier has voice system
        const speaker = aliveSoldiers[0];
        speaker?.voiceSystem?.trySpeak?.('reinforcement_arrived', speaker, 1.0);
      }
    } else if (req.state === REINFORCEMENT_STATE.ARRIVED || req.state === REINFORCEMENT_STATE.FOLLOWING || req.state === REINFORCEMENT_STATE.ENGAGING) {
      if (anyEngaging) {
        req.state = REINFORCEMENT_STATE.ENGAGING;
      } else {
        req.state = REINFORCEMENT_STATE.FOLLOWING;
      }
    }
  }

  _buildTankInputAdapter(req) {
    return {
      isDown: (code) => req.aiKeys.has(code),
      isAnyDown: (...codes) => codes.some((c) => req.aiKeys.has(c)),
      wasPressed: (code) => req.aiPressed.has(code),
    };
  }

  _updateTankRequest(req, dt, playerTank, targets, infantry, environment, persistentTracks, voiceSystem = null, playerInput = null) {
    const tank = req.tank;
    if (!tank) return;

    const isDestroyed =
      tank.damageSystem?.vehicleDestroyed ||
      tank.vehicleState === 'BURNT_OUT' ||
      tank.vehicleState === 'BURNING';

    if (isDestroyed) {
      tank.isPlayerPossessed = false;
      req.state = REINFORCEMENT_STATE.DESTROYED;
      if (!req.destroyedNotified) {
        req.destroyedNotified = true;
        this.notify('T-34-85 DESTROYED', 'Friendly reinforcement T-34-85 has been knocked out', 'danger', 4.5);
      }
      // Still update tank so fire/smoke/crew bailout continues naturally
      req.aiKeys.clear();
      req.aiPressed.clear();
      const emptyInput = this._buildTankInputAdapter(req);
      tank.update(dt, emptyInput, [playerTank, ...targets].filter(Boolean), infantry, environment);
      return;
    }

    if (tank.isPlayerPossessed && playerInput) {
      const otherAllies = this.friendlyTanks.filter((t) => t && t !== tank);
      tank.update(dt, playerInput, [playerTank, ...otherAllies, ...targets].filter(Boolean), infantry, environment);
      if (persistentTracks && Math.abs(tank.speed) > 2) {
        persistentTracks.recordTankTracks(tank, dt, environment);
      }
      return;
    }

    req.aiKeys.clear();
    req.aiPressed.clear();
    req._shiftCooldown = Math.max(0, req._shiftCooldown - dt);

    // 1. Target detection (hostile Panzer IIIs first, then hostile German infantry)
    const hostileTargets = [];
    for (const t of targets) {
      if (!t || t.faction === 'soviet' || t.destroyed || t.vehicleState === 'BURNT_OUT') continue;
      hostileTargets.push({ entity: t, priority: 2, isVehicle: true });
    }
    for (const s of infantry) {
      if (!s || !s.alive || s.faction === 'soviet') continue;
      hostileTargets.push({ entity: s, priority: 1, isVehicle: false });
    }

    let primaryTarget = null;
    let bestTargetScore = -Infinity;
    for (const h of hostileTargets) {
      const d = Math.hypot(h.entity.x - tank.x, h.entity.y - tank.y);
      if (d > 1450) continue;
      const score = h.priority * 1000 - d;
      if (score > bestTargetScore) {
        bestTargetScore = score;
        primaryTarget = h;
      }
    }

    if (req.detection) {
      req.detection.update(dt, {
        observerX: tank.x,
        observerY: tank.y,
        observerAngle: tank.turret.worldAngle,
        target: primaryTarget ? primaryTarget.entity : null,
        environment,
      });
    }

    const targetSpotted = Boolean(primaryTarget);
    const distToPlayer = playerTank ? Math.hypot(playerTank.x - tank.x, playerTank.y - tank.y) : 0;
    const lx = playerTank ? playerTank.x : tank.x;
    const ly = playerTank ? playerTank.y : tank.y;

    if (!req._moveAnnounced) {
      req._moveAnnounced = true;
      voiceSystem?.requestChat?.(tank, 'TANK_MOVING_TO_POS', 5, lx, ly, environment);
    }

    // Track damage warning (once per track damage transition)
    const trackDamaged =
      tank.damageSystem?.getState('LEFT_TRACK') !== 'NORMAL' ||
      tank.damageSystem?.getState('RIGHT_TRACK') !== 'NORMAL';
    if (trackDamaged && !req._trackWarned) {
      req._trackWarned = true;
      voiceSystem?.requestChat?.(tank, 'TANK_TRACK_DAMAGED', 2, lx, ly, environment);
    } else if (!trackDamaged) {
      req._trackWarned = false;
    }

    // Target spotted / lost transitions
    if (targetSpotted && !req._hadTarget) {
      voiceSystem?.requestChat?.(tank, 'TANK_TARGET_SPOTTED', 3, lx, ly, environment);
    } else if (!targetSpotted && req._hadTarget) {
      voiceSystem?.requestChat?.(tank, 'TANK_LOST_CONTACT', 5, lx, ly, environment);
    }
    req._hadTarget = targetSpotted;

    // 2. Arrival & state transitions
    if (req.state === REINFORCEMENT_STATE.MOVING_TO_PLAYER && distToPlayer <= 310) {
      req.state = REINFORCEMENT_STATE.ARRIVED;
      if (!req.arrivedNotified) {
        req.arrivedNotified = true;
        this.notify('T-34-85 ARRIVED', 'Friendly T-34-85 has reached your position', 'success', 4.0);
        voiceSystem?.requestChat?.(tank, 'TANK_POS_REACHED', 5, lx, ly, environment);
      }
    } else if (req.state !== REINFORCEMENT_STATE.MOVING_TO_PLAYER) {
      req.state = targetSpotted ? REINFORCEMENT_STATE.ENGAGING : REINFORCEMENT_STATE.FOLLOWING;
    }

    // 3. Determine navigation goal: hold defensive anchor OR wingman slot beside/behind player tank
    let goalX = tank.x;
    let goalY = tank.y;
    let desiredDistThreshold = 75;

    if (req.holdAnchor) {
      goalX = req.holdAnchor.x;
      goalY = req.holdAnchor.y;
      desiredDistThreshold = 55;
    } else {
      if (playerTank) {
        const wingAngle = playerTank.angle + Math.PI + req.wingmanSide * 0.65;
        const wingDist = 185;
        goalX = clamp(
          playerTank.x + Math.cos(wingAngle) * wingDist,
          CONFIG.WORLD.BORDER_PADDING + 45,
          CONFIG.WORLD.WIDTH - CONFIG.WORLD.BORDER_PADDING - 45
        );
        goalY = clamp(
          playerTank.y + Math.sin(wingAngle) * wingDist,
          CONFIG.WORLD.BORDER_PADDING + 45,
          CONFIG.WORLD.HEIGHT - CONFIG.WORLD.BORDER_PADDING - 45
        );
      }

      // If engaging an enemy tank far from player, close to ~420px standoff while respecting wingman role
      if (primaryTarget && primaryTarget.isVehicle) {
        const dEnemy = Math.hypot(primaryTarget.entity.x - tank.x, primaryTarget.entity.y - tank.y);
        if (dEnemy > 560 && distToPlayer < 450) {
          const ang = Math.atan2(tank.y - primaryTarget.entity.y, tank.x - primaryTarget.entity.x);
          goalX = clamp(
            primaryTarget.entity.x + Math.cos(ang) * 420,
            CONFIG.WORLD.BORDER_PADDING + 50,
            CONFIG.WORLD.WIDTH - CONFIG.WORLD.BORDER_PADDING - 50
          );
          goalY = clamp(
            primaryTarget.entity.y + Math.sin(ang) * 420,
            CONFIG.WORLD.BORDER_PADDING + 50,
            CONFIG.WORLD.HEIGHT - CONFIG.WORLD.BORDER_PADDING - 50
          );
        }
      }
    }

    // 4. Obstacle & vehicle avoidance steering
    let steerAngle = Math.atan2(goalY - tank.y, goalX - tank.x);
    const distToGoal = Math.hypot(goalX - tank.x, goalY - tank.y);

    let avoidX = 0;
    let avoidY = 0;
    const avoidEntities = [
      ...(playerTank ? [{ x: playerTank.x, y: playerTank.y, r: 125 }] : []),
      ...targets.filter((t) => t && !t.destroyed).map((t) => ({ x: t.x, y: t.y, r: 125 })),
      ...(environment?.obstacles || []).map((o) => ({
        x: o.x,
        y: o.y,
        r: (o.radius || o.collisionRadius || 28) + 62,
      })),
    ];

    for (const av of avoidEntities) {
      const dx = tank.x - av.x;
      const dy = tank.y - av.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.1 && d < av.r) {
        const push = (av.r - d) / av.r;
        avoidX += (dx / d) * push * 2.2;
        avoidY += (dy / d) * push * 2.2;
      }
    }

    // Avoid deep trenches ahead
    if (environment?.trenchSystem) {
      const lookX = tank.x + Math.cos(tank.angle) * 75;
      const lookY = tank.y + Math.sin(tank.angle) * 75;
      const tState = environment.trenchSystem.getTrenchStateAt(lookX, lookY);
      if (tState?.inTrench && (tState.hasRoof || tState.depth === 'deep')) {
        avoidX += -Math.cos(tank.angle + 0.6) * 1.8;
        avoidY += -Math.sin(tank.angle + 0.6) * 1.8;
      }
    }

    if (avoidX !== 0 || avoidY !== 0) {
      const gx = distToGoal > 1 ? (goalX - tank.x) / distToGoal : Math.cos(tank.angle);
      const gy = distToGoal > 1 ? (goalY - tank.y) / distToGoal : Math.sin(tank.angle);
      steerAngle = Math.atan2(gy + avoidY, gx + avoidX);
    }

    // 5. Stuck detection & reverse recovery
    const moved = Math.hypot(tank.x - req._lastPos.x, tank.y - req._lastPos.y);
    req._lastPos.x = tank.x;
    req._lastPos.y = tank.y;

    if (distToGoal > desiredDistThreshold && moved < 8 * dt && req._reverseTimer <= 0) {
      req._stuckTimer += dt;
      if (req._stuckTimer > 1.6) {
        req._reverseTimer = 1.3;
        req._stuckTimer = 0;
      }
    } else {
      req._stuckTimer = Math.max(0, req._stuckTimer - dt * 2);
    }

    // 6. Sequential Drivetrain & Hull Steering via AI Input
    const headingErr = normalizeAngle(steerAngle - tank.angle);
    const isShifting = Boolean(tank.drivetrain.isShifting);
    if (req._reverseTimer > 0) {
      req._reverseTimer -= dt;
      if (tank.drivetrain.gear !== 'R') {
        if (!isShifting && req._shiftCooldown <= 0) {
          req.aiKeys.add('KeyR');
          req._shiftCooldown = 0.45;
        }
      } else {
        req.aiKeys.add('KeyW'); // reverse throttle
        req.aiKeys.add(headingErr >= 0 ? 'KeyA' : 'KeyD');
      }
    } else if (distToGoal > desiredDistThreshold) {
      // Forward travel using sequential gears 1 -> 4
      const gear = tank.drivetrain.gear;
      if (gear === 'N' || gear === 'R') {
        if (!isShifting && req._shiftCooldown <= 0) {
          req.aiKeys.add('ShiftLeft');
          req.aiKeys.add('KeyW');
          req._shiftCooldown = 0.45;
        }
      } else {
        const rpmNorm = tank.drivetrain.rpm / (tank.drivetrain.spec?.maxRpm || 2000);
        if (!isShifting && gear < 3 && rpmNorm > 0.86 && Math.abs(headingErr) < 0.45 && req._shiftCooldown <= 0) {
          req.aiKeys.add('ShiftLeft');
          req.aiKeys.add('KeyW');
          req._shiftCooldown = 0.55;
        } else if (!isShifting && gear > 1 && rpmNorm < 0.4 && req._shiftCooldown <= 0) {
          req.aiKeys.add('ShiftLeft');
          req.aiKeys.add('KeyS');
          req._shiftCooldown = 0.55;
        } else {
          req.aiKeys.add('KeyW');
        }
      }

      if (headingErr > 0.1) req.aiKeys.add('KeyD');
      else if (headingErr < -0.1) req.aiKeys.add('KeyA');
    } else {
      // Arrived at wingman slot: brake & shift to Neutral
      if (Math.abs(tank.speed) > 12) {
        req.aiKeys.add('KeyS');
      } else if (tank.drivetrain.gear !== 'N' && !isShifting && req._shiftCooldown <= 0) {
        req.aiKeys.add('KeyN');
        req._shiftCooldown = 0.45;
      }
    }

    // 7. Turret Aim & Weapons (85mm Cannon vs Panzer III, Coax MG vs German Infantry)
    if (primaryTarget) {
      const aimAngle = Math.atan2(primaryTarget.entity.y - tank.y, primaryTarget.entity.x - tank.x);
      const targetDist = Math.hypot(primaryTarget.entity.x - tank.x, primaryTarget.entity.y - tank.y);
      const turretErr = normalizeAngle(aimAngle - tank.turret.worldAngle);
      if (turretErr > 0.03) req.aiKeys.add('KeyE');
      else if (turretErr < -0.03) req.aiKeys.add('KeyQ');

      if (Math.abs(turretErr) < 0.11) {
        const dirX = Math.cos(tank.turret.worldAngle);
        const dirY = Math.sin(tank.turret.worldAngle);
        let allyBlocking = false;
        if (playerTank && !playerTank.damageSystem?.vehicleDestroyed) {
          const dx = playerTank.x - tank.x;
          const dy = playerTank.y - tank.y;
          const proj = dx * dirX + dy * dirY;
          if (proj > 20 && proj < targetDist - 30) {
            const perp = Math.abs(-dx * dirY + dy * dirX);
            if (perp < 44) allyBlocking = true;
          }
        }
        if (!allyBlocking) {
          for (const s of infantry) {
            if (!s.alive || s.faction !== 'soviet') continue;
            const dx = s.x - tank.x;
            const dy = s.y - tank.y;
            const proj = dx * dirX + dy * dirY;
            if (proj > 20 && proj < targetDist - 15) {
              const perp = Math.abs(-dx * dirY + dy * dirX);
              if (perp < 16) {
                allyBlocking = true;
                break;
              }
            }
          }
        }

        if (!allyBlocking) {
          if (primaryTarget.isVehicle) {
            tank.turret?.mainGun?.setAmmoType?.('BR365K');
            req.aiKeys.add('Space'); // fire 85mm APHE
            if (tank.turret?.mainGun?.isReady?.()) {
              voiceSystem?.requestChat?.(tank, 'TANK_ENGAGING', 4, lx, ly, environment);
            }
          } else {
            // Use 85mm HE (O-365K) against infantry if ready & available, otherwise coax DT MG
            if (
              tank.turret?.mainGun?.getAmmoCount?.('O365K') > 0 &&
              tank.turret?.mainGun?.loadedAmmoId === 'O365K' &&
              tank.turret?.mainGun?.isReady?.()
            ) {
              req.aiKeys.add('Space');
            } else {
              tank.turret?.mainGun?.setAmmoType?.('O365K');
              req.aiKeys.add('KeyZ'); // fire coax 7.62mm DT MG
            }
          }
        }
      }
    }

    // Run real Tank simulation
    const aiInput = this._buildTankInputAdapter(req);
    const otherVehicles = [playerTank, ...targets, ...this.friendlyTanks.filter((ft) => ft !== tank)].filter(Boolean);
    tank.update(dt, aiInput, otherVehicles, infantry, environment);

    // Record persistent tracks for friendly reinforcement tank
    if (persistentTracks && Math.abs(tank.speed) > 2) {
      persistentTracks.recordTankTracks(tank, dt, environment);
    }
  }

  update(dt, { playerTank, targets = [], infantry = [], environment = null, persistentTracks = null, voiceSystem = null, playerInput = null }) {
    if (this.cooldownRemaining > 0) {
      this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
    }

    if (this.notification) {
      this.notification.timer -= dt;
      if (this.notification.timer <= 0) {
        this.notification = null;
      }
    }

    for (const req of this.requests) {
      if (req.state === REINFORCEMENT_STATE.CANCELLED) continue;
      if (req.type === REINFORCEMENT_TYPE.INFANTRY_SQUAD) {
        this._updateSquadRequest(req, dt, playerTank, targets, infantry);
      } else if (req.type === REINFORCEMENT_TYPE.TANK) {
        this._updateTankRequest(req, dt, playerTank, targets, infantry, environment, persistentTracks, voiceSystem, playerInput);
      }
    }
  }

  renderFriendlyTanks(ctx, sprites, inspectionMode, lighting) {
    for (const tank of this.friendlyTanks) {
      tank.render(ctx, sprites, inspectionMode, lighting);
    }
  }
}
