/**
 * Tank Crew Character Model, Hinged Hatch Animation & Field Track Repair System
 * for both T-34-85 (Soviet) and Panzer III (German).
 *
 * Crew Repair State Machine:
 *   INSIDE -> EXITING -> MOVING_TO_TRACK -> REPAIRING -> RETURNING -> ENTERING -> INSIDE
 *
 * Hatch State Machine:
 *   CLOSED -> OPENING -> OPEN -> CLOSING -> CLOSED
 */
import { MODULE_STATE } from './armorData.js';
import { CONFIG } from '../config.js';
import { GermanSoldier } from '../infantry.js';

export const TRACK_STATE = {
  OPERATIONAL: 'OPERATIONAL',
  BROKEN: 'BROKEN',
  REPAIRING: 'REPAIRING',
};

export const CREW_REPAIR_STATE = {
  INSIDE: 'INSIDE',
  EXITING: 'EXITING',
  MOVING_TO_TRACK: 'MOVING_TO_TRACK',
  REPAIRING: 'REPAIRING',
  RETURNING: 'RETURNING',
  ENTERING: 'ENTERING',
};

export const HATCH_STATE = {
  CLOSED: 'CLOSED',
  OPENING: 'OPENING',
  OPEN: 'OPEN',
  CLOSING: 'CLOSING',
};

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpPt(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function toHullLocal(wx, wy, hullX, hullY, hullAngle, scale) {
  const cos = Math.cos(-hullAngle);
  const sin = Math.sin(-hullAngle);
  const dx = wx - hullX;
  const dy = wy - hullY;
  return {
    x: (dx * cos - dy * sin) / scale,
    y: (dx * sin + dy * cos) / scale,
  };
}

export class TrackRepairSystem {
  constructor(damageSystem, faction = 'soviet') {
    this.damageSystem = damageSystem;
    this.faction = faction; // 'soviet' | 'german'

    this.crewState = CREW_REPAIR_STATE.INSIDE;
    this.hatchState = HATCH_STATE.CLOSED;
    this.hatchOpenAmount = 0; // 0 = closed, 1 = open
    this.assignedCrewId = null;
    this.targetTrackId = null; // 'LEFT_TRACK' | 'RIGHT_TRACK'

    this.stateTimer = 0;
    this.exitDuration = 2.0;
    this.enterDuration = 2.0;
    this.repairDuration = 18.0; // 15-30s field repair
    this.repairElapsed = 0;
    this.walkPhase = 0;
    this.workPhase = 0;

    // Hull-local unscaled coordinates of the crewman
    this.crewLx = 0;
    this.crewLy = 0;
    this.crewAngle = 0;
    this.crewEmergence = 0; // 0 = inside hull/turret, 1 = full standing/crouching outside
    this.handReach = 0; // 0..1 reach for hatch latch/rim
    this.legClimbPhase = 0;

    // Vehicle-specific geometry
    if (faction === 'german') {
      this.hullHalfLen = 100;
      this.hullHalfWid = 53;
      this.turretHatchLocal = { x: -12, y: 12, radius: 7.5, hingeSide: 1 };
      this.hullHatchLocal = { x: 52, y: 16, radius: 6.5, hingeSide: 1 };
    } else {
      this.hullHalfLen = 110;
      this.hullHalfWid = 54;
      // T-34-85 Model 1944 turret roof hatch (loader/commander side)
      this.turretHatchLocal = { x: -6, y: 18, radius: 8.0, hingeSide: 1 };
      this.hullHatchLocal = { x: 68, y: -16, radius: 7.0, hingeSide: -1 };
    }

    this._activeHatchMount = 'turret'; // 'turret' | 'hull'
    this._activeTurretPivot = { x: 0, y: 0 };
    this._activeTurretAngle = 0;
    this._waypoints = [];
    this._wpIndex = 0;
  }

  get isActive() {
    return this.crewState !== CREW_REPAIR_STATE.INSIDE;
  }

  getTrackDisplayState(trackId) {
    const modState = this.damageSystem.getState(trackId);
    if (this.crewState === CREW_REPAIR_STATE.REPAIRING && this.targetTrackId === trackId) {
      return TRACK_STATE.REPAIRING;
    }
    if (modState === MODULE_STATE.DESTROYED) {
      return TRACK_STATE.BROKEN;
    }
    return TRACK_STATE.OPERATIONAL;
  }

  get remainingSeconds() {
    if (this.crewState !== CREW_REPAIR_STATE.REPAIRING) return 0;
    return Math.max(0, this.repairDuration - this.repairElapsed);
  }

  get repairProgress() {
    if (this.crewState !== CREW_REPAIR_STATE.REPAIRING) return 0;
    return Math.min(1, this.repairElapsed / this.repairDuration);
  }

  _pickRepairCrewId() {
    const priority = ['LOADER', 'COMMANDER', 'RADIO_OP', 'GUNNER', 'DRIVER'];
    for (const id of priority) {
      if (this.damageSystem.isCrewOperable(id)) {
        return id;
      }
    }
    return null;
  }

  getWorldCrewPosition(vehicleX, vehicleY, vehicleAngle, scale = CONFIG.TANK.SCALE) {
    if (!this.isActive || this.crewEmergence <= 0.35) return null;
    const cos = Math.cos(vehicleAngle);
    const sin = Math.sin(vehicleAngle);
    return {
      x: vehicleX + (this.crewLx * cos - this.crewLy * sin) * scale,
      y: vehicleY + (this.crewLx * sin + this.crewLy * cos) * scale,
      radius: 10.5 * scale,
      crewId: this.assignedCrewId,
    };
  }

  onHitOutside(dmg, particles, hitX, hitY, impactAngle = 0, infantry = null, weaponType = 'mg', blastInfo = null) {
    if (!this.isActive || !this.assignedCrewId) return false;
    const crewId = this.assignedCrewId;
    this.damageSystem.applyDirectDamage(crewId, dmg, 'Exposed Repair Hit');
    if (particles) {
      particles.spawnBloodSplatter(hitX, hitY, impactAngle, dmg >= 50 ? 6 : 4);
    }
    if (!this.damageSystem.isCrewOperable(crewId)) {
      const mod = this.damageSystem.getModule(crewId);
      if (mod) mod.bailedOut = true;
      if (infantry) {
        // Spawn persistent falling/ragdoll tanker corpse at exact outside hit location
        const corpse = new GermanSoldier(Date.now() % 100000 + Math.floor(Math.random() * 1000), hitX, hitY, this.crewAngle, {
          faction: this.faction,
          uniformStyle: 'tanker',
          hp: 1,
        });
        corpse.takeDamage(100, particles, hitX, hitY, impactAngle, weaponType, blastInfo);
        infantry.push(corpse);
      } else if (particles && this.damageSystem.getState(crewId) === MODULE_STATE.DESTROYED) {
        particles.spawnBloodPool(hitX, hitY, impactAngle, 8);
      }
      this._abortToInside();
      return true;
    }
    return false;
  }

  _getHatchInHullLocal(hullX, hullY, hullAngle, turretPivot, turretAngle, scale) {
    if (this._activeHatchMount === 'turret') {
      const h = this.turretHatchLocal;
      const cosT = Math.cos(turretAngle);
      const sinT = Math.sin(turretAngle);
      const wx = turretPivot.x + (h.x * cosT - h.y * sinT) * scale;
      const wy = turretPivot.y + (h.x * sinT + h.y * cosT) * scale;
      return toHullLocal(wx, wy, hullX, hullY, hullAngle, scale);
    }
    return { x: this.hullHatchLocal.x, y: this.hullHatchLocal.y };
  }

  _getExitEdgeInHullLocal(hatchLocal) {
    // Step off hull onto nearest side edge outside tracks
    const sideY = hatchLocal.y >= 0 ? this.hullHalfWid + 12 : -(this.hullHalfWid + 12);
    return { x: hatchLocal.x, y: sideY };
  }

  _buildPerimeterPath(fromSideY, toTrackId) {
    const targetY = toTrackId === 'LEFT_TRACK' ? -(this.hullHalfWid + 12) : (this.hullHalfWid + 12);
    const workX = -10;
    const frontClearX = this.hullHalfLen + 15;
    const sameSide = (fromSideY < 0 && targetY < 0) || (fromSideY > 0 && targetY > 0);
    if (sameSide) {
      return [{ x: workX, y: targetY }];
    }
    return [
      { x: frontClearX, y: fromSideY },
      { x: frontClearX, y: targetY },
      { x: workX, y: targetY },
    ];
  }

  _abortToInside() {
    this.crewState = CREW_REPAIR_STATE.INSIDE;
    this.hatchState = HATCH_STATE.CLOSED;
    this.hatchOpenAmount = 0;
    this.crewEmergence = 0;
    this.assignedCrewId = null;
    this.targetTrackId = null;
    this.repairElapsed = 0;
  }

  update(
    dt,
    vehicleSpeed = 0,
    angularVelocity = 0,
    vehicleIncapacitated = false,
    kinematics = null
  ) {
    const scale = CONFIG.TANK.SCALE;
    const hullX = kinematics ? kinematics.hullX : 0;
    const hullY = kinematics ? kinematics.hullY : 0;
    const hullAngle = kinematics ? kinematics.hullAngle : 0;
    const turretPivot = kinematics ? kinematics.turretPivot : { x: hullX, y: hullY };
    const turretAngle = kinematics ? kinematics.turretAngle : hullAngle;

    this._activeTurretPivot = turretPivot;
    this._activeTurretAngle = turretAngle;

    const leftBroken = this.damageSystem.getState('LEFT_TRACK') === MODULE_STATE.DESTROYED;
    const rightBroken = this.damageSystem.getState('RIGHT_TRACK') === MODULE_STATE.DESTROYED;
    const isMoving = Math.abs(vehicleSpeed) > 5 || Math.abs(angularVelocity) > 0.04;

    if (this.isActive) {
      const crewUnfit =
        !this.assignedCrewId ||
        !this.damageSystem.isCrewOperable(this.assignedCrewId);
      if (vehicleIncapacitated || crewUnfit) {
        this._abortToInside();
        return;
      }
    }

    if (this.crewState === CREW_REPAIR_STATE.INSIDE) {
      if (vehicleIncapacitated || isMoving) return;
      if (!leftBroken && !rightBroken) return;

      const crewId = this._pickRepairCrewId();
      if (!crewId) return;

      this.assignedCrewId = crewId;
      this.targetTrackId = leftBroken ? 'LEFT_TRACK' : 'RIGHT_TRACK';
      this._activeHatchMount =
        crewId === 'DRIVER' || crewId === 'RADIO_OP' ? 'hull' : 'turret';

      const hatchLoc = this._getHatchInHullLocal(
        hullX,
        hullY,
        hullAngle,
        turretPivot,
        turretAngle,
        scale
      );
      this.crewLx = hatchLoc.x;
      this.crewLy = hatchLoc.y;
      this.crewEmergence = 0;
      this.hatchState = HATCH_STATE.OPENING;
      this.hatchOpenAmount = 0;
      this.stateTimer = 0;
      this.repairDuration = 18.0;
      this.repairElapsed = 0;
      this.crewState = CREW_REPAIR_STATE.EXITING;
      return;
    }

    const hatchLoc = this._getHatchInHullLocal(
      hullX,
      hullY,
      hullAngle,
      turretPivot,
      turretAngle,
      scale
    );
    const exitEdge = this._getExitEdgeInHullLocal(hatchLoc);

    // 9-step Hatch Exit Sequence
    if (this.crewState === CREW_REPAIR_STATE.EXITING) {
      this.stateTimer += dt;
      const p = clamp01(this.stateTimer / this.exitDuration);

      if (p < 0.22) {
        // 1-2: Crew reaches up to hatch latch
        this.hatchState = HATCH_STATE.OPENING;
        this.hatchOpenAmount = 0;
        this.crewEmergence = lerp(0.15, 0.28, p / 0.22);
        this.handReach = p / 0.22;
        this.crewLx = hatchLoc.x;
        this.crewLy = hatchLoc.y;
        this.crewAngle = Math.atan2(exitEdge.y - hatchLoc.y, exitEdge.x - hatchLoc.x);
      } else if (p < 0.48) {
        // 3-5: Hinged hatch swings open
        const t = (p - 0.22) / 0.26;
        this.hatchState = t < 0.95 ? HATCH_STATE.OPENING : HATCH_STATE.OPEN;
        this.hatchOpenAmount = t;
        this.crewEmergence = 0.32;
        this.handReach = 1.0;
        this.crewLx = hatchLoc.x;
        this.crewLy = hatchLoc.y;
      } else if (p < 0.74) {
        // 6-7: Head & torso rise out, hands brace on rim
        const t = (p - 0.48) / 0.26;
        this.hatchState = HATCH_STATE.OPEN;
        this.hatchOpenAmount = 1.0;
        this.crewEmergence = lerp(0.35, 0.85, t);
        this.handReach = 1.0 - t * 0.4;
        this.crewLx = lerp(hatchLoc.x, lerp(hatchLoc.x, exitEdge.x, 0.35), t);
        this.crewLy = lerp(hatchLoc.y, lerp(hatchLoc.y, exitEdge.y, 0.35), t);
      } else {
        // 8-9: Legs climb out sequentially onto ground beside tank
        const t = (p - 0.74) / 0.26;
        this.hatchState = HATCH_STATE.OPEN;
        this.hatchOpenAmount = 1.0;
        this.crewEmergence = lerp(0.85, 1.0, t);
        this.handReach = 0;
        this.legClimbPhase = t * Math.PI * 2;
        this.crewLx = lerp(lerp(hatchLoc.x, exitEdge.x, 0.35), exitEdge.x, t);
        this.crewLy = lerp(lerp(hatchLoc.y, exitEdge.y, 0.35), exitEdge.y, t);
        this.crewAngle = Math.atan2(exitEdge.y - hatchLoc.y, exitEdge.x - hatchLoc.x);
      }

      if (p >= 1) {
        this.crewEmergence = 1.0;
        this._waypoints = this._buildPerimeterPath(exitEdge.y, this.targetTrackId);
        this._wpIndex = 0;
        this.crewState = CREW_REPAIR_STATE.MOVING_TO_TRACK;
      }
      return;
    }

    if (this.crewState === CREW_REPAIR_STATE.MOVING_TO_TRACK) {
      this.walkPhase += dt * 10;
      const wp = this._waypoints[this._wpIndex];
      const dx = wp.x - this.crewLx;
      const dy = wp.y - this.crewLy;
      const dist = Math.hypot(dx, dy);
      const walkSpeed = 48;
      if (dist <= walkSpeed * dt) {
        this.crewLx = wp.x;
        this.crewLy = wp.y;
        this._wpIndex++;
        if (this._wpIndex >= this._waypoints.length) {
          this.crewState = CREW_REPAIR_STATE.REPAIRING;
          this.crewAngle = this.targetTrackId === 'LEFT_TRACK' ? Math.PI / 2 : -Math.PI / 2;
        }
      } else {
        this.crewLx += (dx / dist) * walkSpeed * dt;
        this.crewLy += (dy / dist) * walkSpeed * dt;
        this.crewAngle = Math.atan2(dy, dx);
      }
      return;
    }

    if (this.crewState === CREW_REPAIR_STATE.REPAIRING) {
      this.workPhase += dt * 5.2;
      this.repairElapsed += dt;
      if (this.repairElapsed >= this.repairDuration) {
        this.repairElapsed = this.repairDuration;
        const backPath = [...this._waypoints].reverse();
        backPath.push({ x: exitEdge.x, y: exitEdge.y });
        this._waypoints = backPath;
        this._wpIndex = 0;
        this.crewState = CREW_REPAIR_STATE.RETURNING;
      }
      return;
    }

    if (this.crewState === CREW_REPAIR_STATE.RETURNING) {
      this.walkPhase += dt * 10.5;
      const wp = this._waypoints[this._wpIndex];
      const dx = wp.x - this.crewLx;
      const dy = wp.y - this.crewLy;
      const dist = Math.hypot(dx, dy);
      const walkSpeed = 52;
      if (dist <= walkSpeed * dt) {
        this.crewLx = wp.x;
        this.crewLy = wp.y;
        this._wpIndex++;
        if (this._wpIndex >= this._waypoints.length) {
          this.stateTimer = 0;
          this.crewState = CREW_REPAIR_STATE.ENTERING;
        }
      } else {
        this.crewLx += (dx / dist) * walkSpeed * dt;
        this.crewLy += (dy / dist) * walkSpeed * dt;
        this.crewAngle = Math.atan2(dy, dx);
      }
      return;
    }

    // 6-step Hatch Return & Close Sequence
    if (this.crewState === CREW_REPAIR_STATE.ENTERING) {
      this.stateTimer += dt;
      const p = clamp01(this.stateTimer / this.enterDuration);

      if (p < 0.30) {
        // 1-2: Approach rim & grip hatch edge
        const t = p / 0.30;
        this.hatchState = HATCH_STATE.OPEN;
        this.hatchOpenAmount = 1.0;
        this.crewEmergence = 1.0;
        this.handReach = t;
        this.crewLx = lerp(exitEdge.x, lerp(exitEdge.x, hatchLoc.x, 0.55), t);
        this.crewLy = lerp(exitEdge.y, lerp(exitEdge.y, hatchLoc.y, 0.55), t);
        this.crewAngle = Math.atan2(hatchLoc.y - exitEdge.y, hatchLoc.x - exitEdge.x);
      } else if (p < 0.65) {
        // 3: Climb legs and torso sequentially into hatch
        const t = (p - 0.30) / 0.35;
        this.hatchState = HATCH_STATE.OPEN;
        this.hatchOpenAmount = 1.0;
        this.crewEmergence = lerp(1.0, 0.32, t);
        this.legClimbPhase = (1 - t) * Math.PI * 2;
        this.crewLx = lerp(lerp(exitEdge.x, hatchLoc.x, 0.55), hatchLoc.x, t);
        this.crewLy = lerp(lerp(exitEdge.y, hatchLoc.y, 0.55), hatchLoc.y, t);
      } else {
        // 4-6: Disappear inside & swing hinged hatch closed
        const t = (p - 0.65) / 0.35;
        this.crewEmergence = 0;
        this.hatchState = t < 0.95 ? HATCH_STATE.CLOSING : HATCH_STATE.CLOSED;
        this.hatchOpenAmount = 1.0 - t;
        this.crewLx = hatchLoc.x;
        this.crewLy = hatchLoc.y;
      }

      if (p >= 1) {
        const mod = this.damageSystem.getModule(this.targetTrackId);
        if (mod) {
          mod.hp = mod.maxHp;
          mod.state = MODULE_STATE.NORMAL;
        }
        this._abortToInside();
      }
    }
  }

  render(ctx, vehicleX, vehicleY, vehicleAngle, scale = CONFIG.TANK.SCALE, turretPivot = null, turretAngle = null) {
    if (!this.isActive) return;

    // 1. Render hinged hatch in its true mount coordinate space (turret OR hull)
    if (this.hatchState !== HATCH_STATE.CLOSED) {
      const isTurret = this._activeHatchMount === 'turret' && turretPivot !== null && turretAngle !== null;
      const hx = isTurret ? turretPivot.x : vehicleX;
      const hy = isTurret ? turretPivot.y : vehicleY;
      const ha = isTurret ? turretAngle : vehicleAngle;
      const hDef = isTurret ? this.turretHatchLocal : this.hullHatchLocal;

      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(ha);
      ctx.scale(scale, scale);

      // Dark interior hatch opening
      ctx.fillStyle = '#121412';
      ctx.strokeStyle = '#363b32';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(hDef.x, hDef.y, hDef.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Hinged hatch lid swinging open around its hinge edge
      const lidColor = this.faction === 'german' ? '#585f63' : '#4f6342';
      const hingeY = hDef.y + hDef.hingeSide * hDef.radius;
      ctx.save();
      ctx.translate(hDef.x, hingeY);
      ctx.rotate(this.hatchOpenAmount * hDef.hingeSide * 1.35);
      ctx.fillStyle = lidColor;
      ctx.strokeStyle = '#1e221b';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.ellipse(0, -hDef.hingeSide * hDef.radius * 0.85, hDef.radius * 0.92, hDef.radius * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.restore();
    }

    // 2. Render articulated crewman in hull-local world coordinates
    if (this.crewEmergence <= 0.05) return;

    ctx.save();
    ctx.translate(vehicleX, vehicleY);
    ctx.rotate(vehicleAngle);
    ctx.scale(scale, scale);
    ctx.translate(this.crewLx, this.crewLy);
    ctx.rotate(this.crewAngle);
    ctx.scale(this.crewEmergence, this.crewEmergence);

    this._renderArticulatedCrewman(ctx);
    ctx.restore();
  }

  _renderArticulatedCrewman(ctx) {
    const isSoviet = this.faction === 'soviet';
    const uniformFill = isSoviet ? '#4b523b' : '#24262a';
    const uniformShade = isSoviet ? '#3c422f' : '#181a1d';
    const helmetFill = isSoviet ? '#2e3128' : '#191b1e';
    const outline = '#111210';

    const isWalking = this.crewState === CREW_REPAIR_STATE.MOVING_TO_TRACK || this.crewState === CREW_REPAIR_STATE.RETURNING;
    const isRepairing = this.crewState === CREW_REPAIR_STATE.REPAIRING;
    const isClimbing = this.crewState === CREW_REPAIR_STATE.EXITING || this.crewState === CREW_REPAIR_STATE.ENTERING;

    const stride = isWalking ? Math.sin(this.walkPhase) * 4.5 : (isClimbing ? Math.sin(this.legClimbPhase) * 3.5 : 0);
    // Multi-phase varied repair posture (wrenching <-> inspecting <-> pulling)
    const repairMode = isRepairing ? Math.sin(this.workPhase * 0.25) : 0;
    const crouchLean = isRepairing ? 2.2 + Math.sin(this.workPhase * 0.5) * 1.2 : 0;
    const armWorkR = isRepairing ? Math.sin(this.workPhase) * 2.8 : 0;
    const armWorkL = isRepairing ? Math.cos(this.workPhase * 0.8) * 1.8 : 0;

    // 1. Ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.26)';
    ctx.beginPath();
    ctx.ellipse(-1, 1.5, 9.5, 10.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Two independent articulated legs (hip -> knee -> jackboot)
    this._drawLeg(ctx, { x: -2, y: -4.2 }, { x: 2 + stride * 0.6, y: -5.0 }, { x: 5.5 + stride, y: -4.6 }, uniformShade, outline);
    this._drawLeg(ctx, { x: -2, y: 4.2 }, { x: 2 - stride * 0.6, y: 5.0 }, { x: 5.5 - stride, y: 4.6 }, uniformShade, outline);

    // 3. Anatomical Tanker Torso (tapered shoulders-to-waist, not a box)
    ctx.fillStyle = uniformFill;
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(-4.5 + crouchLean * 0.3, -5.6);
    ctx.lineTo(1.0 + crouchLean * 0.5, -8.2);
    ctx.quadraticCurveTo(4.2 + crouchLean * 0.6, -4.5, 3.8 + crouchLean * 0.6, 0);
    ctx.quadraticCurveTo(4.2 + crouchLean * 0.6, 4.5, 1.0 + crouchLean * 0.5, 8.2);
    ctx.lineTo(-4.5 + crouchLean * 0.3, 5.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Belt & collar detail
    ctx.strokeStyle = isSoviet ? '#332b20' : '#4e535c';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-3.8 + crouchLean * 0.3, -4.8);
    ctx.lineTo(-3.8 + crouchLean * 0.3, 4.8);
    ctx.stroke();

    // 4. Two independent articulated arms (shoulder -> elbow -> hand)
    const reach = this.handReach * 4.5;
    const lShoulder = { x: 1.0 + crouchLean * 0.5, y: -8.0 };
    const lElbow = isRepairing
      ? { x: 5.5 + crouchLean, y: -8.6 + armWorkL * 0.4 }
      : { x: 4.5 + stride * 0.3 + reach * 0.5, y: -9.2 };
    const lHand = isRepairing
      ? { x: 10.5 + crouchLean + armWorkL, y: -3.2 + repairMode * 1.4 }
      : { x: 7.2 + stride * 0.4 + reach, y: -5.8 };

    const rShoulder = { x: 1.0 + crouchLean * 0.5, y: 8.0 };
    const rElbow = isRepairing
      ? { x: 5.5 + crouchLean, y: 8.8 - armWorkR * 0.3 }
      : { x: 4.5 - stride * 0.3 + reach * 0.5, y: 9.2 };
    const rHand = isRepairing
      ? { x: 11.2 + crouchLean + armWorkR, y: 2.5 }
      : { x: 7.2 - stride * 0.4 + reach, y: 5.8 };

    this._drawArm(ctx, lShoulder, lElbow, lHand, uniformFill, outline);
    this._drawArm(ctx, rShoulder, rElbow, rHand, uniformFill, outline);

    // Repair tool (steel wrench) in hand during REPAIRING
    if (isRepairing) {
      ctx.strokeStyle = '#9aa3ad';
      ctx.lineWidth = 1.7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(rHand.x, rHand.y);
      ctx.lineTo(rHand.x + 5.5, rHand.y - 2.8);
      ctx.stroke();
    }

    // 5. Head & Faction Tanker Helmet
    ctx.save();
    ctx.translate(2.4 + crouchLean * 0.8, 0);
    ctx.fillStyle = helmetFill;
    ctx.strokeStyle = outline;
    ctx.lineWidth = 0.95;
    ctx.beginPath();
    ctx.ellipse(0, 0, 5.0, 4.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (isSoviet) {
      // Ribbed padded Soviet tanker helmet ridges
      ctx.strokeStyle = '#43463a';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(-3.2, 0);
      ctx.lineTo(3.2, 0);
      ctx.moveTo(-2.5, -2.4);
      ctx.lineTo(2.5, -2.4);
      ctx.moveTo(-2.5, 2.4);
      ctx.lineTo(2.5, 2.4);
      ctx.stroke();
    } else {
      // German Panzer headset / cap band
      ctx.strokeStyle = '#4e535c';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.arc(0, 0, 3.6, -Math.PI * 0.7, Math.PI * 0.7);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawLeg(ctx, hip, knee, boot, trouserColor, outline) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = outline;
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    ctx.moveTo(hip.x, hip.y);
    ctx.lineTo(knee.x, knee.y);
    ctx.lineTo(boot.x, boot.y);
    ctx.stroke();

    ctx.strokeStyle = trouserColor;
    ctx.lineWidth = 2.9;
    ctx.beginPath();
    ctx.moveTo(hip.x, hip.y);
    ctx.lineTo(knee.x, knee.y);
    ctx.lineTo(boot.x, boot.y);
    ctx.stroke();

    ctx.fillStyle = '#191816';
    ctx.beginPath();
    ctx.roundRect(boot.x - 2.0, boot.y - 1.6, 4.4, 3.2, 1.1);
    ctx.fill();
  }

  _drawArm(ctx, shoulder, elbow, hand, sleeveColor, outline) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = outline;
    ctx.lineWidth = 3.9;
    ctx.beginPath();
    ctx.moveTo(shoulder.x, shoulder.y);
    ctx.lineTo(elbow.x, elbow.y);
    ctx.lineTo(hand.x, hand.y);
    ctx.stroke();

    ctx.strokeStyle = sleeveColor;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(shoulder.x, shoulder.y);
    ctx.lineTo(elbow.x, elbow.y);
    ctx.lineTo(hand.x, hand.y);
    ctx.stroke();

    ctx.fillStyle = '#cfa382';
    ctx.strokeStyle = '#3d2c20';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.arc(hand.x, hand.y, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}
