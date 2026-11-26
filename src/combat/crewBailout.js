/**
 * Tank Crew Bailout & Infantry Dismount System
 * for T-34-85 (Soviet) and Panzer III (German).
 *
 * State Machine per crewman:
 *   INSIDE_VEHICLE -> PREPARING_TO_EXIT -> OPENING_HATCH -> EXITING_VEHICLE
 *   -> MOVING_TO_SAFETY -> DISMOUNTED_INFANTRY | WOUNDED_INFANTRY | DEAD
 */
import { MODULE_STATE } from './armorData.js';
import { CONFIG } from '../config.js';
import { GermanSoldier, SOLDIER_STATE } from '../infantry.js';

export const BAILOUT_STATE = {
  INSIDE_VEHICLE: 'INSIDE_VEHICLE',
  PREPARING_TO_EXIT: 'PREPARING_TO_EXIT',
  OPENING_HATCH: 'OPENING_HATCH',
  EXITING_VEHICLE: 'EXITING_VEHICLE',
  MOVING_TO_SAFETY: 'MOVING_TO_SAFETY',
  DISMOUNTED_INFANTRY: 'DISMOUNTED_INFANTRY',
  WOUNDED_INFANTRY: 'WOUNDED_INFANTRY',
  MOVING_TO_HATCH: 'MOVING_TO_HATCH',
  ENTERING_VEHICLE: 'ENTERING_VEHICLE',
  DEAD: 'DEAD',
};

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class CrewBailoutSystem {
  constructor(damageSystem, faction = 'soviet') {
    this.damageSystem = damageSystem;
    this.faction = faction;
    this.triggered = false;
    this.onManualDismountComplete = null;
    this.onReentryComplete = null;
    this.onReentryFailed = null;
    this._nextSoldierId = faction === 'soviet' ? 100 : 200;

    // Vehicle-specific hatch definitions
    if (faction === 'german') {
      this.hatches = {
        DRIVER_HATCH: { mount: 'hull', x: 56, y: -16, radius: 6.5, hingeSide: -1, openAmount: 0, state: 'CLOSED' },
        RADIO_HATCH: { mount: 'hull', x: 52, y: 16, radius: 6.5, hingeSide: 1, openAmount: 0, state: 'CLOSED' },
        CUPOLA_HATCH: { mount: 'turret', x: -14, y: 0, radius: 7.5, hingeSide: -1, openAmount: 0, state: 'CLOSED' },
        TURRET_SIDE_HATCH: { mount: 'turret', x: 10, y: 16, radius: 7.0, hingeSide: 1, openAmount: 0, state: 'CLOSED' },
      };
      this.crewDefs = [
        { id: 'COMMANDER', hatchKey: 'CUPOLA_HATCH', delay: 0.15, escapeSideAngle: -2.4 },
        { id: 'GUNNER', hatchKey: 'CUPOLA_HATCH', delay: 0.85, escapeSideAngle: -1.6 },
        { id: 'LOADER', hatchKey: 'TURRET_SIDE_HATCH', delay: 0.35, escapeSideAngle: 1.5 },
        { id: 'DRIVER', hatchKey: 'DRIVER_HATCH', delay: 0.25, escapeSideAngle: -0.9 },
        { id: 'RADIO_OP', hatchKey: 'RADIO_HATCH', delay: 0.45, escapeSideAngle: 0.9 },
      ];
    } else {
      this.hatches = {
        DRIVER_HATCH: { mount: 'hull', x: 68, y: -16, radius: 7.0, hingeSide: -1, openAmount: 0, state: 'CLOSED' },
        RADIO_HATCH: { mount: 'hull', x: 68, y: 16, radius: 6.8, hingeSide: 1, openAmount: 0, state: 'CLOSED' },
        TURRET_HATCH: { mount: 'turret', x: -6, y: 18, radius: 8.0, hingeSide: 1, openAmount: 0, state: 'CLOSED' },
      };
      this.crewDefs = [
        { id: 'COMMANDER', hatchKey: 'TURRET_HATCH', delay: 0.20, escapeSideAngle: 2.2 },
        { id: 'LOADER', hatchKey: 'TURRET_HATCH', delay: 0.95, escapeSideAngle: 1.4 },
        { id: 'GUNNER', hatchKey: 'TURRET_HATCH', delay: 1.65, escapeSideAngle: -2.0 },
        { id: 'DRIVER', hatchKey: 'DRIVER_HATCH', delay: 0.25, escapeSideAngle: -0.8 },
        { id: 'RADIO_OP', hatchKey: 'RADIO_HATCH', delay: 0.45, escapeSideAngle: 0.8 },
      ];
    }

    this.crewSlots = this.crewDefs.map((d) => ({
      ...d,
      state: BAILOUT_STATE.INSIDE_VEHICLE,
      timer: 0,
      wounded: false,
      manualDismount: false,
      emergence: 0,
      wx: 0,
      wy: 0,
      angle: 0,
      soldierEntity: null,
    }));
  }

  getEligibleCrewIds(trackRepair = null) {
    const order = ['DRIVER', 'RADIO_OP', 'COMMANDER', 'GUNNER', 'LOADER'];
    return order.filter((id) => {
      const slot = this.crewSlots.find((s) => s.id === id);
      if (!slot || slot.state !== BAILOUT_STATE.INSIDE_VEHICLE) return false;
      if (!this.damageSystem.isCrewOperable(id)) return false;
      if (trackRepair && trackRepair.isActive && trackRepair.assignedCrewId === id) return false;
      return true;
    });
  }

  dismountCrewMember(crewId, trackRepair = null) {
    const slot = this.crewSlots.find((s) => s.id === crewId);
    if (!slot || slot.state !== BAILOUT_STATE.INSIDE_VEHICLE) return false;
    if (!this.damageSystem.isCrewOperable(crewId)) return false;
    if (trackRepair && trackRepair.isActive && trackRepair.assignedCrewId === crewId) return false;

    const mod = this.damageSystem.getModule(crewId);
    slot.wounded = mod ? mod.state === MODULE_STATE.DAMAGED : false;
    slot.manualDismount = true;
    const hatch = this.hatches[slot.hatchKey];
    if (hatch && hatch.state === 'OPEN') {
      slot.state = BAILOUT_STATE.EXITING_VEHICLE;
    } else {
      if (hatch) hatch.state = 'OPENING';
      slot.state = BAILOUT_STATE.OPENING_HATCH;
    }
    slot.timer = 0;
    return true;
  }

  requestReentry(crewId, infantry, kinematics, trackRepair = null) {
    if (this.triggered || this.damageSystem.vehicleDestroyed || this.damageSystem.ammoFireActive) {
      return { ok: false, reason: 'VEHICLE UNSAFE / DESTROYED' };
    }
    const slot = this.crewSlots.find((s) => s.id === crewId);
    if (!slot || !slot.soldierEntity || !slot.soldierEntity.alive) {
      return { ok: false, reason: 'CREW UNABLE TO ENTER' };
    }
    if (
      slot.state === BAILOUT_STATE.MOVING_TO_HATCH ||
      slot.state === BAILOUT_STATE.ENTERING_VEHICLE
    ) {
      return { ok: false, reason: 'ALREADY ENTERING' };
    }

    const mod = this.damageSystem.getModule(crewId);
    if (!mod || !mod.bailedOut) {
      return { ok: false, reason: 'CREW POSITION OCCUPIED' };
    }

    const scale = CONFIG.TANK.SCALE;
    const hPos = this._getHatchWorldPos(
      slot.hatchKey,
      kinematics.hullX,
      kinematics.hullY,
      kinematics.hullAngle,
      kinematics.turretPivot,
      kinematics.turretAngle,
      scale
    );
    const dist = Math.hypot(slot.soldierEntity.x - hPos.x, slot.soldierEntity.y - hPos.y);
    if (dist > 140) {
      return { ok: false, reason: 'TOO FAR FROM VEHICLE' };
    }

    // Lock soldier & initiate return sequence
    const s = slot.soldierEntity;
    s.isPlayerControlled = false;
    s.isBoardingVehicle = true;
    s._playerVx = 0;
    s._playerVy = 0;
    s.moveTarget = null;
    slot.state = BAILOUT_STATE.MOVING_TO_HATCH;
    slot.timer = 0;
    slot.stallTimer = 0;
    slot.lastBoardDist = Infinity;
    return { ok: true };
  }

  triggerBailout() {
    if (this.triggered) return;
    this.triggered = true;

    for (const slot of this.crewSlots) {
      if (slot.state !== BAILOUT_STATE.INSIDE_VEHICLE) continue;
      const mod = this.damageSystem.getModule(slot.id);
      const st = mod ? mod.state : MODULE_STATE.DESTROYED;
      if (!mod || mod.bailedOut || st === MODULE_STATE.DESTROYED || st === MODULE_STATE.CRITICAL) {
        // Dead or incapacitated crew cannot self-bailout
        slot.state = st === MODULE_STATE.DESTROYED ? BAILOUT_STATE.DEAD : BAILOUT_STATE.INSIDE_VEHICLE;
        continue;
      }
      slot.wounded = st === MODULE_STATE.DAMAGED;
      slot.state = BAILOUT_STATE.PREPARING_TO_EXIT;
      slot.timer = slot.delay;
    }
  }

  _getHatchWorldPos(hatchKey, hullX, hullY, hullAngle, turretPivot, turretAngle, scale) {
    const h = this.hatches[hatchKey];
    if (h.mount === 'turret') {
      const c = Math.cos(turretAngle);
      const s = Math.sin(turretAngle);
      return {
        x: turretPivot.x + (h.x * c - h.y * s) * scale,
        y: turretPivot.y + (h.x * s + h.y * c) * scale,
      };
    }
    const c = Math.cos(hullAngle);
    const s = Math.sin(hullAngle);
    return {
      x: hullX + (h.x * c - h.y * s) * scale,
      y: hullY + (h.x * s + h.y * c) * scale,
    };
  }

  update(dt, kinematics, infantry = []) {
    const anyManualOrActive = this.crewSlots.some(
      (s) =>
        s.state === BAILOUT_STATE.PREPARING_TO_EXIT ||
        s.state === BAILOUT_STATE.OPENING_HATCH ||
        s.state === BAILOUT_STATE.EXITING_VEHICLE ||
        s.state === BAILOUT_STATE.MOVING_TO_HATCH ||
        s.state === BAILOUT_STATE.ENTERING_VEHICLE ||
        s.soldierEntity !== null
    );
    const anyHatchOpenOrClosing = Object.values(this.hatches).some(
      (h) => h.state === 'OPEN' || h.state === 'CLOSING'
    );
    if (!this.triggered && !anyManualOrActive && !anyHatchOpenOrClosing) return;

    // Close hatches that are no longer needed by manual dismounts/re-entry (when vehicle isn't burning)
    if (!this.triggered) {
      for (const [hKey, h] of Object.entries(this.hatches)) {
        if (h.state === 'OPEN') {
          const inUse = this.crewSlots.some(
            (s) =>
              s.hatchKey === hKey &&
              (s.state === BAILOUT_STATE.OPENING_HATCH ||
                s.state === BAILOUT_STATE.EXITING_VEHICLE ||
                s.state === BAILOUT_STATE.MOVING_TO_HATCH ||
                s.state === BAILOUT_STATE.ENTERING_VEHICLE)
          );
          if (!inUse) h.state = 'CLOSING';
        }
        if (h.state === 'CLOSING') {
          h.openAmount = Math.max(0, h.openAmount - dt * 1.8);
          if (h.openAmount <= 0) {
            h.openAmount = 0;
            h.state = 'CLOSED';
          }
        }
      }
    }

    const scale = CONFIG.TANK.SCALE;
    const { hullX, hullY, hullAngle, turretPivot, turretAngle } = kinematics;

    for (const slot of this.crewSlots) {
      const mod = this.damageSystem.getModule(slot.id);

      // Sync if crewman was killed inside before getting out
      if (
        slot.state === BAILOUT_STATE.PREPARING_TO_EXIT ||
        slot.state === BAILOUT_STATE.OPENING_HATCH ||
        slot.state === BAILOUT_STATE.EXITING_VEHICLE
      ) {
        if (!mod || mod.state === MODULE_STATE.DESTROYED) {
          slot.state = BAILOUT_STATE.DEAD;
          continue;
        }
      }

      // Handle MOVING_TO_HATCH & ENTERING_VEHICLE for re-entry
      if (slot.state === BAILOUT_STATE.MOVING_TO_HATCH) {
        const s = slot.soldierEntity;
        if (!s || !s.alive || this.triggered || this.damageSystem.vehicleDestroyed) {
          if (s) s.isBoardingVehicle = false;
          if (s && !s.alive) {
            slot.state = BAILOUT_STATE.DEAD;
            if (mod) { mod.hp = 0; mod.state = MODULE_STATE.DESTROYED; }
          } else {
            slot.state = slot.wounded ? BAILOUT_STATE.WOUNDED_INFANTRY : BAILOUT_STATE.DISMOUNTED_INFANTRY;
          }
          continue;
        }
        const hatch = this.hatches[slot.hatchKey];
        const hPos = this._getHatchWorldPos(slot.hatchKey, hullX, hullY, hullAngle, turretPivot, turretAngle, scale);
        if (hatch.state === 'CLOSED' || hatch.state === 'CLOSING') {
          hatch.state = 'OPENING';
        }
        if (hatch.state === 'OPENING') {
          hatch.openAmount = Math.min(1, hatch.openAmount + dt * 2.0);
          if (hatch.openAmount >= 1) hatch.state = 'OPEN';
        }

        const exitAngle = hullAngle + slot.escapeSideAngle;
        const boardDistTarget = 54 * scale;
        const boardX = hullX + Math.cos(exitAngle) * boardDistTarget;
        const boardY = hullY + Math.sin(exitAngle) * boardDistTarget;

        // If soldier is on the far side of the tank hull, orbit around the perimeter first
        const curAngle = Math.atan2(s.y - hullY, s.x - hullX);
        const curR = Math.hypot(s.x - hullX, s.y - hullY);
        const dAngle = normalizeAngle(exitAngle - curAngle);
        let targetX = boardX;
        let targetY = boardY;
        if (Math.abs(dAngle) > 0.55 && curR < 95 * scale) {
          const stepSign = dAngle >= 0 ? 1 : -1;
          const nextAng = curAngle + stepSign * 0.45;
          const orbitR = Math.max(58 * scale, curR);
          targetX = hullX + Math.cos(nextAng) * orbitR;
          targetY = hullY + Math.sin(nextAng) * orbitR;
        }

        const dx = targetX - s.x;
        const dy = targetY - s.y;
        const distToSteer = Math.hypot(dx, dy);
        const boardDist = Math.hypot(boardX - s.x, boardY - s.y);
        const walkSpd = slot.wounded ? 36 : 58;

        if (boardDist < (slot.lastBoardDist ?? Infinity) - 1.5) {
          slot.lastBoardDist = boardDist;
          slot.stallTimer = 0;
        } else {
          slot.stallTimer = (slot.stallTimer || 0) + dt;
        }

        if (slot.stallTimer >= 6.5) {
          s.isBoardingVehicle = false;
          s.isPlayerControlled = true;
          slot.state = slot.wounded ? BAILOUT_STATE.WOUNDED_INFANTRY : BAILOUT_STATE.DISMOUNTED_INFANTRY;
          slot.stallTimer = 0;
          if (this.onReentryFailed) {
            this.onReentryFailed(slot.id, 'RE-ENTRY BLOCKED');
          }
          continue;
        }

        if (boardDist <= Math.max(10, walkSpd * dt) && hatch.state === 'OPEN') {
          // Save ammo & remove external infantry entity as crewman climbs into hatch
          slot.savedMagAmmo = s.magAmmo;
          slot.savedReserveAmmo = s.reserveAmmo;
          s.isBoardingVehicle = false;
          s.inVehicle = true;
          const idx = infantry.indexOf(s);
          if (idx !== -1) infantry.splice(idx, 1);
          slot.soldierEntity = null;
          slot.enterStartX = s.x;
          slot.enterStartY = s.y;
          slot.wx = s.x;
          slot.wy = s.y;
          slot.emergence = 1.0;
          slot.angle = Math.atan2(hPos.y - s.y, hPos.x - s.x);
          slot.timer = 0;
          slot.stallTimer = 0;
          slot.state = BAILOUT_STATE.ENTERING_VEHICLE;
        } else if (distToSteer > 2) {
          const step = Math.min(distToSteer, walkSpd * dt);
          s.x += (dx / distToSteer) * step;
          s.y += (dy / distToSteer) * step;
          s.angle = Math.atan2(dy, dx);
          s.baseAngle = s.angle;
          s._movePhase += dt * 10;
        }
        continue;
      }

      if (slot.state === BAILOUT_STATE.ENTERING_VEHICLE) {
        const speedMult = slot.wounded ? 0.55 : 1.0;
        slot.timer += dt * speedMult;
        const p = clamp01(slot.timer / 0.85);
        const hPos = this._getHatchWorldPos(slot.hatchKey, hullX, hullY, hullAngle, turretPivot, turretAngle, scale);
        const sx = slot.enterStartX ?? hPos.x;
        const sy = slot.enterStartY ?? hPos.y;
        slot.wx = lerp(sx, hPos.x, p);
        slot.wy = lerp(sy, hPos.y, p);
        slot.emergence = lerp(1.0, 0.25, p);
        slot.angle = Math.atan2(hPos.y - sy, hPos.x - sx);
        if (p >= 1) {
          if (mod) mod.bailedOut = false;
          this.damageSystem.vehicleAbandoned = false;
          slot.state = BAILOUT_STATE.INSIDE_VEHICLE;
          slot.manualDismount = false;
          slot.emergence = 0;
          slot.stallTimer = 0;
          if (this.onReentryComplete) {
            this.onReentryComplete(slot.id);
          }
        }
        continue;
      }

      // Sync dismounted soldier health back to Bailout state & vehicle crew roster
      if (slot.soldierEntity) {
        if (slot.soldierEntity.state === SOLDIER_STATE.DEAD || slot.soldierEntity.state === SOLDIER_STATE.FALLING || slot.soldierEntity.state === SOLDIER_STATE.RAGDOLL) {
          slot.state = BAILOUT_STATE.DEAD;
          if (mod && mod.state !== MODULE_STATE.DESTROYED) {
            mod.hp = 0;
            mod.state = MODULE_STATE.DESTROYED;
          }
        } else if (slot.soldierEntity.hp < 15 && mod && mod.state === MODULE_STATE.NORMAL) {
          mod.hp = Math.min(mod.hp, 30);
          mod.state = MODULE_STATE.DAMAGED;
          slot.wounded = true;
          slot.soldierEntity.wounded = true;
        } else if (!slot.soldierEntity.moveTarget && slot.state === BAILOUT_STATE.MOVING_TO_SAFETY) {
          slot.state = slot.wounded ? BAILOUT_STATE.WOUNDED_INFANTRY : BAILOUT_STATE.DISMOUNTED_INFANTRY;
        }
        continue;
      }

      if (slot.state === BAILOUT_STATE.INSIDE_VEHICLE || slot.state === BAILOUT_STATE.DEAD) {
        continue;
      }

      const speedMult = slot.wounded ? 0.55 : 1.0;
      const hatch = this.hatches[slot.hatchKey];
      const hPos = this._getHatchWorldPos(slot.hatchKey, hullX, hullY, hullAngle, turretPivot, turretAngle, scale);
      const exitAngle = hullAngle + slot.escapeSideAngle;
      const landDist = 54 * scale;
      const landX = hullX + Math.cos(exitAngle) * landDist;
      const landY = hullY + Math.sin(exitAngle) * landDist;

      if (slot.state === BAILOUT_STATE.PREPARING_TO_EXIT) {
        slot.timer -= dt * speedMult;
        if (slot.timer <= 0) {
          if (hatch.state === 'OPEN') {
            // Hatch already open -> skip re-playing hatch opening animation
            slot.state = BAILOUT_STATE.EXITING_VEHICLE;
            slot.timer = 0;
          } else {
            hatch.state = 'OPENING';
            slot.state = BAILOUT_STATE.OPENING_HATCH;
            slot.timer = 0;
          }
        }
        continue;
      }

      if (slot.state === BAILOUT_STATE.OPENING_HATCH) {
        slot.timer += dt * speedMult;
        const p = clamp01(slot.timer / 0.55);
        hatch.openAmount = Math.max(hatch.openAmount, p);
        slot.wx = hPos.x;
        slot.wy = hPos.y;
        slot.emergence = 0.25;
        slot.angle = exitAngle;
        if (p >= 1) {
          hatch.state = 'OPEN';
          hatch.openAmount = 1;
          slot.state = BAILOUT_STATE.EXITING_VEHICLE;
          slot.timer = 0;
        }
        continue;
      }

      if (slot.state === BAILOUT_STATE.EXITING_VEHICLE) {
        slot.timer += dt * speedMult;
        const p = clamp01(slot.timer / 0.95);
        slot.emergence = lerp(0.35, 1.0, p);
        slot.wx = lerp(hPos.x, landX, p);
        slot.wy = lerp(hPos.y, landY, p);
        slot.angle = exitAngle;

        if (p >= 1) {
          // Hand off to independent infantry entity & vacate vehicle crew seat
          this.damageSystem.markCrewBailedOut(slot.id);
          const safeDist = 115 + Math.random() * 45;
          const safeX = hullX + Math.cos(exitAngle) * safeDist;
          const safeY = hullY + Math.sin(exitAngle) * safeDist;

          const soldier = new GermanSoldier(this._nextSoldierId++, landX, landY, exitAngle, {
            faction: this.faction,
            uniformStyle: 'tanker',
            wounded: slot.wounded,
            moveTarget: slot.manualDismount ? null : { x: safeX, y: safeY },
          });
          if (slot.savedMagAmmo !== undefined) {
            soldier.magAmmo = slot.savedMagAmmo;
            soldier.reserveAmmo = slot.savedReserveAmmo;
          }
          soldier.crewRole = slot.id;
          soldier.inVehicle = false;
          infantry.push(soldier);
          slot.soldierEntity = soldier;
          slot.state = slot.manualDismount
            ? (slot.wounded ? BAILOUT_STATE.WOUNDED_INFANTRY : BAILOUT_STATE.DISMOUNTED_INFANTRY)
            : BAILOUT_STATE.MOVING_TO_SAFETY;
          if (slot.manualDismount && this.onManualDismountComplete) {
            this.onManualDismountComplete(soldier, slot.id);
          }
        }
      }
    }
  }

  render(ctx, hullX, hullY, hullAngle, turretPivot, turretAngle, scale = CONFIG.TANK.SCALE) {
    const anyOpenHatch = Object.values(this.hatches).some((h) => h.state !== 'CLOSED' && h.openAmount > 0.01);
    const anyClimbing = this.crewSlots.some(
      (s) =>
        s.state === BAILOUT_STATE.OPENING_HATCH ||
        s.state === BAILOUT_STATE.EXITING_VEHICLE ||
        s.state === BAILOUT_STATE.ENTERING_VEHICLE
    );
    if (!this.triggered && !anyOpenHatch && !anyClimbing) return;

    // 1. Render open/opening hatches
    for (const h of Object.values(this.hatches)) {
      if (h.state === 'CLOSED' && h.openAmount <= 0.01) continue;
      const ox = h.mount === 'turret' ? turretPivot.x : hullX;
      const oy = h.mount === 'turret' ? turretPivot.y : hullY;
      const oa = h.mount === 'turret' ? turretAngle : hullAngle;

      ctx.save();
      ctx.translate(ox, oy);
      ctx.rotate(oa);
      ctx.scale(scale, scale);

      ctx.fillStyle = '#121412';
      ctx.strokeStyle = '#363b32';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      const lidColor = this.faction === 'german' ? '#585f63' : '#4f6342';
      const hingeY = h.y + h.hingeSide * h.radius;
      ctx.save();
      ctx.translate(h.x, hingeY);
      ctx.rotate(h.openAmount * h.hingeSide * 1.35);
      ctx.fillStyle = lidColor;
      ctx.strokeStyle = '#1e221b';
      ctx.beginPath();
      ctx.ellipse(0, -h.hingeSide * h.radius * 0.85, h.radius * 0.9, h.radius * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.restore();
    }

    // 2. Render crewmen currently climbing out (before they become infantry entities)
    const isSoviet = this.faction === 'soviet';
    for (const slot of this.crewSlots) {
      if (
        slot.state !== BAILOUT_STATE.OPENING_HATCH &&
        slot.state !== BAILOUT_STATE.EXITING_VEHICLE &&
        slot.state !== BAILOUT_STATE.ENTERING_VEHICLE
      ) continue;
      ctx.save();
      ctx.translate(slot.wx, slot.wy);
      ctx.rotate(slot.angle);
      ctx.scale(scale * slot.emergence, scale * slot.emergence);

      // Tanker shoulders, arms & helmet
      ctx.fillStyle = isSoviet ? '#34392f' : '#202226';
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.ellipse(0, 0, 5.2, 8.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isSoviet ? '#282b24' : '#191b1e';
      ctx.beginPath();
      ctx.ellipse(1.4, 0, 4.8, 4.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.stroke();

      ctx.fillStyle = isSoviet ? '#2e3128' : '#191b1e';
      ctx.beginPath();
      ctx.arc(1.8, 0, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.restore();
    }
  }
}
