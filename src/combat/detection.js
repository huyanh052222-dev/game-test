/**
 * Shared Line-of-Sight Detection State Machine for enemy vehicles & infantry.
 * States: UNAWARE -> INVESTIGATING -> TARGET_DETECTED -> ENGAGING -> LOST_CONTACT -> SEARCHING
 */

export const DETECTION_STATE = {
  UNAWARE: 'UNAWARE',
  INVESTIGATING: 'INVESTIGATING',
  TARGET_DETECTED: 'TARGET_DETECTED',
  ENGAGING: 'ENGAGING',
  LOST_CONTACT: 'LOST_CONTACT',
  SEARCHING: 'SEARCHING',
};

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class DetectionTracker {
  constructor(options = {}) {
    this.detectionRangePx = options.detectionRangePx ?? 640;
    this.peripheralRangePx = options.peripheralRangePx ?? 240;
    this.fovHalfAngle = options.fovHalfAngle ?? Math.PI * 0.45; // ~162 deg forward arc
    this.acquireDelay = options.acquireDelay ?? 0.65;
    this.confirmDelay = options.confirmDelay ?? 0.45;
    this.loseSightDelay = options.loseSightDelay ?? 2.0;
    this.searchDuration = options.searchDuration ?? 5.5;

    this.state = DETECTION_STATE.UNAWARE;
    this.target = null;
    this.lastKnownPos = null;
    this.awareness = 0;
    this.stateTimer = 0;
  }

  reset() {
    this.state = DETECTION_STATE.UNAWARE;
    this.target = null;
    this.lastKnownPos = null;
    this.awareness = 0;
    this.stateTimer = 0;
  }

  notifyThreat(x, y) {
    if (this.state === DETECTION_STATE.ENGAGING || this.state === DETECTION_STATE.TARGET_DETECTED) {
      return;
    }
    this.lastKnownPos = { x, y };
    this.state = DETECTION_STATE.INVESTIGATING;
    this.stateTimer = 0;
    this.awareness = Math.max(this.awareness, 0.45);
  }

  _canSeeCandidate(observerX, observerY, observerAngle, candidate, environment) {
    if (!candidate) return false;
    const dx = candidate.x - observerX;
    const dy = candidate.y - observerY;
    const dist = Math.hypot(dx, dy);
    if (dist > this.detectionRangePx) return false;

    const bearing = Math.atan2(dy, dx);
    const angDiff = Math.abs(normalizeAngle(bearing - observerAngle));
    const inForwardArc = angDiff <= this.fovHalfAngle;
    const inPeripheral = dist <= this.peripheralRangePx;
    const alreadyAlerted =
      this.state !== DETECTION_STATE.UNAWARE && dist <= this.detectionRangePx;

    if (!inForwardArc && !inPeripheral && !alreadyAlerted) {
      return false;
    }

    if (!environment) return true;

    if (typeof candidate.getOBB === 'function' && typeof environment.hasTargetFootprintLOS === 'function') {
      return environment.hasTargetFootprintLOS(observerX, observerY, candidate.getOBB());
    }
    if (typeof environment.hasLineOfSight === 'function') {
      return environment.hasLineOfSight(observerX, observerY, candidate.x, candidate.y);
    }
    return true;
  }

  update(dt, { observerX, observerY, observerAngle, candidates = [], environment = null, preferInfantry = false }) {
    let visibleTarget = null;
    let bestTier = Infinity;
    let bestDist = Infinity;

    for (const c of candidates) {
      if (!c) continue;
      if (c.alive === false || c.inVehicle === true || c.destroyed || c.damageSystem?.vehicleDestroyed) continue;
      if (!this._canSeeCandidate(observerX, observerY, observerAngle, c, environment)) continue;
      const d = Math.hypot(c.x - observerX, c.y - observerY);
      let tier = 0;
      if (preferInfantry) {
        if (typeof c.getOBB === 'function') {
          tier = 2;
        } else if (c.combatCapable === false) {
          tier = 1;
        } else {
          tier = 0;
        }
      }
      if (tier < bestTier || (tier === bestTier && d < bestDist)) {
        bestTier = tier;
        bestDist = d;
        visibleTarget = c;
      }
    }

    if (
      this.target &&
      (this.target.alive === false || this.target.inVehicle === true || this.target.destroyed || this.target.damageSystem?.vehicleDestroyed)
    ) {
      this.target = null;
    }

    if (visibleTarget) {
      this.target = visibleTarget;
      this.lastKnownPos = { x: visibleTarget.x, y: visibleTarget.y };
      const distFactor = Math.max(0.45, 1.35 - bestDist / this.detectionRangePx);

      if (this.state === DETECTION_STATE.UNAWARE || this.state === DETECTION_STATE.SEARCHING) {
        this.state = DETECTION_STATE.INVESTIGATING;
        this.stateTimer = 0;
        this.awareness = Math.max(this.awareness, 0.2);
      } else if (this.state === DETECTION_STATE.LOST_CONTACT) {
        this.state = DETECTION_STATE.TARGET_DETECTED;
        this.stateTimer = 0;
        this.awareness = 1.0;
      } else if (this.state === DETECTION_STATE.INVESTIGATING) {
        this.awareness = Math.min(1, this.awareness + (dt * distFactor) / Math.max(0.15, this.acquireDelay));
        if (this.awareness >= 1) {
          this.state = DETECTION_STATE.TARGET_DETECTED;
          this.stateTimer = 0;
        }
      } else if (this.state === DETECTION_STATE.TARGET_DETECTED) {
        this.stateTimer += dt;
        if (this.stateTimer >= this.confirmDelay) {
          this.state = DETECTION_STATE.ENGAGING;
          this.stateTimer = 0;
        }
      } else if (this.state === DETECTION_STATE.ENGAGING) {
        this.stateTimer += dt;
      }
      return this.state;
    }

    // No target currently in line of sight
    if (this.state === DETECTION_STATE.ENGAGING || this.state === DETECTION_STATE.TARGET_DETECTED) {
      this.state = DETECTION_STATE.LOST_CONTACT;
      this.stateTimer = 0;
    } else if (this.state === DETECTION_STATE.LOST_CONTACT) {
      this.stateTimer += dt;
      if (this.stateTimer >= this.loseSightDelay) {
        this.state = DETECTION_STATE.SEARCHING;
        this.stateTimer = 0;
      }
    } else if (this.state === DETECTION_STATE.INVESTIGATING) {
      this.stateTimer += dt;
      this.awareness = Math.max(0, this.awareness - dt * 0.25);
      if (this.stateTimer >= 2.5) {
        this.state = DETECTION_STATE.SEARCHING;
        this.stateTimer = 0;
      }
    } else if (this.state === DETECTION_STATE.SEARCHING) {
      this.stateTimer += dt;
      this.awareness = Math.max(0, this.awareness - dt * 0.15);
      if (this.stateTimer >= this.searchDuration) {
        this.reset();
      }
    }

    return this.state;
  }
}
