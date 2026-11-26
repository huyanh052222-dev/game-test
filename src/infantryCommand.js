/**
 * Soviet Infantry Squad Selection & Tactical Attack Command System.
 *
 * Allows the player to enter INFANTRY_COMMAND_MODE (HUD button or KeyC),
 * select individual or groups of eligible Soviet allied soldiers via left-click,
 * drag-rectangle, or Shift+click, and issue right-click ATTACK ORDERS to any
 * battlefield location with coordinated Assault & Fire Support elements.
 */
import { CONFIG } from './config.js';
import { AI_STATE, BEHAVIOR_STATE } from './infantry.js';

export const COMMAND_STATE = {
  UNSELECTED: 'UNSELECTED',
  SELECTED: 'SELECTED',
  COMMAND_RECEIVED: 'COMMAND_RECEIVED',
  MOVING_TO_OBJECTIVE: 'MOVING_TO_OBJECTIVE',
  SEARCHING_FOR_COVER: 'SEARCHING_FOR_COVER',
  MOVING_TO_COVER: 'MOVING_TO_COVER',
  TAKING_COVER: 'TAKING_COVER',
  FIRE_SUPPORT: 'FIRE_SUPPORT',
  ASSAULTING: 'ASSAULTING',
  ENGAGING: 'ENGAGING',
  OBJECTIVE_REACHED: 'OBJECTIVE_REACHED',
  REPOSITIONING: 'REPOSITIONING',
  RETREATING: 'RETREATING',
  WOUNDED: 'WOUNDED',
  DEAD: 'DEAD',
};

export const TACTICAL_ROLE = {
  ASSAULT: 'ASSAULT',
  FIRE_SUPPORT: 'FIRE_SUPPORT',
};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export class InfantryCommandSystem {
  constructor() {
    this.active = false; // INFANTRY_COMMAND_MODE
    this.selectedSoldiers = new Set();
    this.objective = null; // { x, y, markerTimer, targetEntity }
    this.groupStatus = 'READY';
    this.assaultCount = 0;
    this.fireSupportCount = 0;
    this.confirmationText = '';
    this.confirmationTimer = 0;

    this.dragBox = {
      active: false,
      startScreenX: 0,
      startScreenY: 0,
      endScreenX: 0,
      endScreenY: 0,
    };

    this._slotScanTimer = 0;
  }

  reset() {
    this.active = false;
    this.clearSelection();
    this.objective = null;
    this.confirmationText = '';
    this.confirmationTimer = 0;
    this.dragBox.active = false;
  }

  setModeActive(enabled) {
    this.active = Boolean(enabled);
    if (!this.active) {
      this.dragBox.active = false;
    }
    return this.active;
  }

  toggleMode() {
    return this.setModeActive(!this.active);
  }

  isEligibleSoldier(s) {
    return Boolean(
      s &&
      s.alive &&
      s.combatCapable !== false &&
      s.faction === 'soviet' &&
      !s.isPlayerControlled &&
      !s.isBoardingVehicle &&
      s.state !== 'FALLING_WOUNDED' &&
      s.state !== 'WOUNDED_IDLE' &&
      s.state !== 'FALLING_DEAD' &&
      s.state !== 'DEAD' &&
      s.state !== 'FALLING' &&
      s.state !== 'RAGDOLL'
    );
  }

  clearSelection() {
    for (const s of this.selectedSoldiers) {
      s.commandSelected = false;
      if (!s.commandOrder) {
        s.commandState = s.alive ? COMMAND_STATE.UNSELECTED : COMMAND_STATE.DEAD;
      }
    }
    this.selectedSoldiers.clear();
    this.assaultCount = 0;
    this.fireSupportCount = 0;
    this.groupStatus = 'READY';
  }

  _selectSoldier(s) {
    if (!this.isEligibleSoldier(s)) return false;
    this.selectedSoldiers.add(s);
    s.commandSelected = true;
    if (!s.commandState || s.commandState === COMMAND_STATE.UNSELECTED) {
      s.commandState = COMMAND_STATE.SELECTED;
    }
    return true;
  }

  _deselectSoldier(s) {
    this.selectedSoldiers.delete(s);
    if (s) {
      s.commandSelected = false;
      if (!s.commandOrder) {
        s.commandState = s.alive ? COMMAND_STATE.UNSELECTED : COMMAND_STATE.DEAD;
      }
    }
  }

  _recalculateRoles() {
    const aliveList = Array.from(this.selectedSoldiers).filter((s) => this.isEligibleSoldier(s));
    const n = aliveList.length;
    if (n === 0) {
      this.assaultCount = 0;
      this.fireSupportCount = 0;
      return;
    }

    // Divide dynamically: ~60% Assault (prefer PPSh-41), ~40% Fire Support (prefer Mosin-Nagant)
    const targetSupport = n === 1 ? 0 : Math.max(1, Math.round(n * 0.38));
    const targetAssault = n - targetSupport;

    // Sort so Mosin-Nagant riflemen gravitate toward Fire Support and PPSh-41 toward Assault
    const sorted = [...aliveList].sort((a, b) => {
      const aScore = a.weaponCfg?.id === 'PPSH_41' ? 1 : 0;
      const bScore = b.weaponCfg?.id === 'PPSH_41' ? 1 : 0;
      return bScore - aScore;
    });

    this.assaultCount = 0;
    this.fireSupportCount = 0;
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i];
      if (i < targetAssault) {
        s.commandRole = TACTICAL_ROLE.ASSAULT;
        this.assaultCount++;
      } else {
        s.commandRole = TACTICAL_ROLE.FIRE_SUPPORT;
        this.fireSupportCount++;
      }
    }
  }

  onMouseDown(screenX, screenY, button, shiftKey, { camera, viewportWidth, viewportHeight, infantry }) {
    if (!this.active) return false;

    if (button === 0) {
      this.dragBox.active = true;
      this.dragBox.startScreenX = screenX;
      this.dragBox.startScreenY = screenY;
      this.dragBox.endScreenX = screenX;
      this.dragBox.endScreenY = screenY;
      return true;
    }

    if (button === 2) {
      if (this.selectedSoldiers.size === 0) return false;
      const world = camera.screenToWorld(screenX, screenY, viewportWidth, viewportHeight);
      // If clicking directly on a visible enemy unit, snap objective to enemy's current position
      let targetEntity = null;
      for (const s of infantry) {
        if (!s.alive || s.faction === 'soviet') continue;
        if (Math.hypot(s.x - world.x, s.y - world.y) <= Math.max(s.hitboxRadius + 8, 18)) {
          targetEntity = s;
          break;
        }
      }
      const ox = targetEntity ? targetEntity.x : world.x;
      const oy = targetEntity ? targetEntity.y : world.y;
      return { issueOrder: true, x: ox, y: oy, targetEntity };
    }

    return false;
  }

  onMouseMove(screenX, screenY) {
    if (!this.active || !this.dragBox.active) return;
    this.dragBox.endScreenX = screenX;
    this.dragBox.endScreenY = screenY;
  }

  onMouseUp(screenX, screenY, button, shiftKey, { camera, viewportWidth, viewportHeight, infantry }) {
    if (!this.active || button !== 0 || !this.dragBox.active) return false;

    this.dragBox.endScreenX = screenX;
    this.dragBox.endScreenY = screenY;
    this.dragBox.active = false;

    const dragDist = Math.hypot(
      this.dragBox.endScreenX - this.dragBox.startScreenX,
      this.dragBox.endScreenY - this.dragBox.startScreenY
    );

    const wStart = camera.screenToWorld(
      this.dragBox.startScreenX,
      this.dragBox.startScreenY,
      viewportWidth,
      viewportHeight
    );
    const wEnd = camera.screenToWorld(
      this.dragBox.endScreenX,
      this.dragBox.endScreenY,
      viewportWidth,
      viewportHeight
    );

    if (dragDist < 7) {
      // Single click selection using actual soldier world positions & hitboxes
      let clicked = null;
      let bestD = Infinity;
      for (const s of infantry) {
        if (!this.isEligibleSoldier(s)) continue;
        const d = Math.hypot(s.x - wEnd.x, s.y - wEnd.y);
        const hitR = Math.max((s.hitboxRadius || 12) + 8, 18);
        if (d <= hitR && d < bestD) {
          bestD = d;
          clicked = s;
        }
      }

      if (shiftKey) {
        if (clicked) {
          if (this.selectedSoldiers.has(clicked)) {
            this._deselectSoldier(clicked);
          } else {
            this._selectSoldier(clicked);
          }
        }
      } else {
        this.clearSelection();
        if (clicked) {
          this._selectSoldier(clicked);
        }
      }
    } else {
      // Group rectangle selection in world space
      const minX = Math.min(wStart.x, wEnd.x);
      const maxX = Math.max(wStart.x, wEnd.x);
      const minY = Math.min(wStart.y, wEnd.y);
      const maxY = Math.max(wStart.y, wEnd.y);

      if (!shiftKey) {
        this.clearSelection();
      }
      for (const s of infantry) {
        if (!this.isEligibleSoldier(s)) continue;
        if (s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY) {
          this._selectSoldier(s);
        }
      }
    }

    this._recalculateRoles();
    this._syncGroupStatus();
    return true;
  }

  /**
   * Finds a physically reachable cover slot near (anchorX, anchorY) facing threat (threatX, threatY).
   * Evaluates trees, fallen trees, wooden crates, barrels, sandbags, trenches, and tank wrecks.
   */
  _findTacticalCoverSlot(anchorX, anchorY, threatX, threatY, soldier, environment, tanks, usedSlots) {
    const dirToThreatX = threatX - anchorX;
    const dirToThreatY = threatY - anchorY;
    const distT = Math.hypot(dirToThreatX, dirToThreatY) || 1;
    const nx = dirToThreatX / distT;
    const ny = dirToThreatY / distT;

    const candidates = [];

    // 1. Obstacles (trees, fallen trees, crates, barrels, sandbags)
    if (environment?.obstacles) {
      for (const obs of environment.obstacles) {
        const dAnchor = Math.hypot(obs.x - anchorX, obs.y - anchorY);
        if (dAnchor > 260) continue;
        const obsR = obs.trunkRadius || obs.collisionRadius || obs.radius || 18;
        const standOff = obsR + (soldier.hitboxRadius || 11) + 7;
        const cx = clamp(
          obs.x - nx * standOff,
          CONFIG.WORLD.BORDER_PADDING,
          CONFIG.WORLD.WIDTH - CONFIG.WORLD.BORDER_PADDING
        );
        const cy = clamp(
          obs.y - ny * standOff,
          CONFIG.WORLD.BORDER_PADDING,
          CONFIG.WORLD.HEIGHT - CONFIG.WORLD.BORDER_PADDING
        );
        candidates.push({ x: cx, y: cy, score: 120 - dAnchor * 0.4, kind: 'obstacle' });
      }
    }

    // 2. Trenches & reinforced firing positions
    if (environment?.trenchSystem?.findNearestTrenchCover) {
      const tCov = environment.trenchSystem.findNearestTrenchCover(anchorX, anchorY, 220);
      if (tCov) {
        const dT = Math.hypot(tCov.x - anchorX, tCov.y - anchorY);
        candidates.push({ x: tCov.x, y: tCov.y, score: 135 - dT * 0.45, kind: 'trench' });
      }
    }

    // 3. Destroyed or allied tank hulls as mobile/wreck cover
    for (const t of tanks) {
      if (!t) continue;
      const dTank = Math.hypot(t.x - anchorX, t.y - anchorY);
      if (dTank > 240) continue;
      const cx = clamp(
        t.x - nx * 82,
        CONFIG.WORLD.BORDER_PADDING,
        CONFIG.WORLD.WIDTH - CONFIG.WORLD.BORDER_PADDING
      );
      const cy = clamp(
        t.y - ny * 82,
        CONFIG.WORLD.BORDER_PADDING,
        CONFIG.WORLD.HEIGHT - CONFIG.WORLD.BORDER_PADDING
      );
      candidates.push({ x: cx, y: cy, score: 105 - dTank * 0.35, kind: 'wreck' });
    }

    // Filter out candidates already occupied by another squadmate
    candidates.sort((a, b) => b.score - a.score);
    for (const c of candidates) {
      const taken = usedSlots.some((u) => Math.hypot(u.x - c.x, u.y - c.y) < 26);
      if (!taken) return { x: c.x, y: c.y, hasCover: true };
    }

    return null;
  }

  issueAttackOrder(worldX, worldY, { environment = null, tanks = [], infantry = [] } = {}) {
    const eligible = Array.from(this.selectedSoldiers).filter((s) => this.isEligibleSoldier(s));
    if (eligible.length === 0) return false;

    const ox = clamp(worldX, CONFIG.WORLD.BORDER_PADDING, CONFIG.WORLD.WIDTH - CONFIG.WORLD.BORDER_PADDING);
    const oy = clamp(worldY, CONFIG.WORLD.BORDER_PADDING, CONFIG.WORLD.HEIGHT - CONFIG.WORLD.BORDER_PADDING);

    this.objective = {
      x: ox,
      y: oy,
      markerTimer: 6.0,
    };

    this._recalculateRoles();
    this._assignGroupPositions(eligible, environment, tanks);

    this.groupStatus = 'MOVING TO OBJECTIVE';
    this.confirmationText = 'ATTACK ORDER ISSUED';
    this.confirmationTimer = 3.0;
    this._slotScanTimer = 1.0;

    return true;
  }

  _assignGroupPositions(eligible, environment, tanks) {
    if (!this.objective || eligible.length === 0) return;

    const ox = this.objective.x;
    const oy = this.objective.y;

    // Compute group centroid for approach axis
    let cx = 0;
    let cy = 0;
    for (const s of eligible) {
      cx += s.x;
      cy += s.y;
    }
    cx /= eligible.length;
    cy /= eligible.length;

    const approachAngle = Math.atan2(oy - cy, ox - cx);
    const backX = -Math.cos(approachAngle);
    const backY = -Math.sin(approachAngle);
    const perpX = -Math.sin(approachAngle);
    const perpY = Math.cos(approachAngle);

    const usedSlots = [];
    let assaultIdx = 0;
    let supportIdx = 0;

    for (const s of eligible) {
      const isAssault = s.commandRole === TACTICAL_ROLE.ASSAULT;

      let anchorX;
      let anchorY;
      if (isAssault) {
        // Assault element advances into positions 45–115px around the objective
        const lateral = ((assaultIdx % 4) - 1.5) * 42;
        const depth = Math.floor(assaultIdx / 4) * 38 + 48;
        anchorX = clamp(
          ox + backX * depth + perpX * lateral,
          CONFIG.WORLD.BORDER_PADDING,
          CONFIG.WORLD.WIDTH - CONFIG.WORLD.BORDER_PADDING
        );
        anchorY = clamp(
          oy + backY * depth + perpY * lateral,
          CONFIG.WORLD.BORDER_PADDING,
          CONFIG.WORLD.HEIGHT - CONFIG.WORLD.BORDER_PADDING
        );
        assaultIdx++;
      } else {
        // Fire Support element holds cover 175–265px behind Assault to suppress & cover advance
        const lateral = ((supportIdx % 4) - 1.5) * 52;
        const distBack = Math.min(260, Math.max(165, Math.hypot(ox - cx, oy - cy) * 0.55));
        anchorX = clamp(
          ox + backX * distBack + perpX * lateral,
          CONFIG.WORLD.BORDER_PADDING,
          CONFIG.WORLD.WIDTH - CONFIG.WORLD.BORDER_PADDING
        );
        anchorY = clamp(
          oy + backY * distBack + perpY * lateral,
          CONFIG.WORLD.BORDER_PADDING,
          CONFIG.WORLD.HEIGHT - CONFIG.WORLD.BORDER_PADDING
        );
        supportIdx++;
      }

      const coverSlot = this._findTacticalCoverSlot(anchorX, anchorY, ox, oy, s, environment, tanks, usedSlots);
      const finalSlot = coverSlot || { x: anchorX, y: anchorY, hasCover: false };
      usedSlots.push(finalSlot);

      s.commandOrder = {
        role: s.commandRole,
        targetX: finalSlot.x,
        targetY: finalSlot.y,
        hasCover: finalSlot.hasCover,
        objectiveX: ox,
        objectiveY: oy,
      };
      s.commandState = COMMAND_STATE.COMMAND_RECEIVED;
    }
  }

  _syncGroupStatus() {
    if (this.selectedSoldiers.size === 0) {
      this.groupStatus = 'READY';
      return;
    }
    const list = Array.from(this.selectedSoldiers);
    if (list.some((s) => s.commandState === COMMAND_STATE.ENGAGING)) {
      this.groupStatus = 'ENGAGING';
    } else if (list.some((s) => s.commandState === COMMAND_STATE.ASSAULTING || s.commandState === COMMAND_STATE.MOVING_TO_OBJECTIVE)) {
      this.groupStatus = 'ASSAULTING';
    } else if (list.some((s) => s.commandState === COMMAND_STATE.FIRE_SUPPORT || s.commandState === COMMAND_STATE.TAKING_COVER)) {
      this.groupStatus = 'IN COVER';
    } else if (list.every((s) => s.commandState === COMMAND_STATE.OBJECTIVE_REACHED || s.commandState === COMMAND_STATE.TAKING_COVER)) {
      this.groupStatus = this.objective ? 'OBJECTIVE REACHED' : 'READY';
    } else {
      this.groupStatus = 'READY';
    }
  }

  update(dt, { environment = null, tanks = [] } = {}) {
    if (this.confirmationTimer > 0) {
      this.confirmationTimer = Math.max(0, this.confirmationTimer - dt);
      if (this.confirmationTimer === 0) this.confirmationText = '';
    }

    if (this.objective && this.objective.markerTimer > 0) {
      this.objective.markerTimer = Math.max(0, this.objective.markerTimer - dt);
    }

    // Prune dead / incapacitated / ineligible soldiers & rebalance roles if needed
    let changed = false;
    for (const s of Array.from(this.selectedSoldiers)) {
      if (!this.isEligibleSoldier(s)) {
        s.commandSelected = false;
        s.commandState = s.alive ? COMMAND_STATE.WOUNDED : COMMAND_STATE.DEAD;
        this.selectedSoldiers.delete(s);
        changed = true;
      }
    }
    if (changed) {
      this._recalculateRoles();
    }

    // Update each commanded soldier's state machine
    for (const s of this.selectedSoldiers) {
      if (!s.commandOrder) {
        s.commandState = s.wounded ? COMMAND_STATE.WOUNDED : COMMAND_STATE.SELECTED;
        continue;
      }

      const distToSlot = Math.hypot(s.commandOrder.targetX - s.x, s.commandOrder.targetY - s.y);
      if (s.behaviorState === BEHAVIOR_STATE.RETREATING || s.behaviorState === BEHAVIOR_STATE.PANICKED) {
        s.commandState = COMMAND_STATE.RETREATING;
      } else if (s.wounded) {
        s.commandState = COMMAND_STATE.WOUNDED;
      } else if (s._combatTarget || s.aiState === AI_STATE.FIRING || s.aiState === AI_STATE.AIMING) {
        s.commandState = COMMAND_STATE.ENGAGING;
      } else if (distToSlot > 20) {
        s.commandState =
          s.commandOrder.hasCover
            ? COMMAND_STATE.MOVING_TO_COVER
            : (s.commandRole === TACTICAL_ROLE.ASSAULT ? COMMAND_STATE.ASSAULTING : COMMAND_STATE.MOVING_TO_OBJECTIVE);
      } else if (s.commandOrder.hasCover) {
        s.commandState =
          s.commandRole === TACTICAL_ROLE.FIRE_SUPPORT ? COMMAND_STATE.FIRE_SUPPORT : COMMAND_STATE.TAKING_COVER;
      } else {
        s.commandState = COMMAND_STATE.OBJECTIVE_REACHED;
      }
    }

    // Periodic cover re-evaluation if an active objective exists
    if (this.objective && this.selectedSoldiers.size > 0) {
      this._slotScanTimer -= dt;
      if (this._slotScanTimer <= 0) {
        this._slotScanTimer = 2.0;
      }
    }

    this._syncGroupStatus();
  }

  renderWorld(ctx) {
    // 1. Selection rings & role badges beneath selected Soviet soldiers
    for (const s of this.selectedSoldiers) {
      if (!s.alive) continue;
      const isAssault = s.commandRole === TACTICAL_ROLE.ASSAULT;
      const ringColor = isAssault ? 'rgba(92, 224, 152, 0.88)' : 'rgba(240, 192, 84, 0.88)';

      ctx.save();
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 13.5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = isAssault ? 'rgba(92, 224, 152, 0.16)' : 'rgba(240, 192, 84, 0.16)';
      ctx.fill();

      // Subtle tactical movement line to assigned slot when moving
      if (s.commandOrder) {
        const d = Math.hypot(s.commandOrder.targetX - s.x, s.commandOrder.targetY - s.y);
        if (d > 24) {
          ctx.strokeStyle = isAssault ? 'rgba(92, 224, 152, 0.32)' : 'rgba(240, 192, 84, 0.28)';
          ctx.lineWidth = 1.0;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s.commandOrder.targetX, s.commandOrder.targetY);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.restore();
    }

    // 2. Attack Objective Marker at clicked world location
    if (this.objective && this.selectedSoldiers.size > 0) {
      const { x, y } = this.objective;
      const pulse = 1 + Math.sin(performance.now() * 0.008) * 0.14;
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 118, 72, 0.92)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(x, y, 16 * pulse, 0, Math.PI * 2);
      ctx.stroke();

      // Crosshair ticks
      ctx.beginPath();
      ctx.moveTo(x - 22, y);
      ctx.lineTo(x - 8, y);
      ctx.moveTo(x + 8, y);
      ctx.lineTo(x + 22, y);
      ctx.moveTo(x, y - 22);
      ctx.lineTo(x, y - 8);
      ctx.moveTo(x, y + 8);
      ctx.lineTo(x, y + 22);
      ctx.stroke();

      ctx.font = '700 9.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 196, 156, 0.95)';
      ctx.fillText('ATTACK', x, y - 24);
      ctx.restore();
    }
  }

  renderScreenOverlay(ctx, dpr = 1, viewportW = 1280, viewportH = 720, mouseX = 0, mouseY = 0) {
    if (!this.active) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Drag selection rectangle
    if (this.dragBox.active) {
      const x = Math.min(this.dragBox.startScreenX, this.dragBox.endScreenX);
      const y = Math.min(this.dragBox.startScreenY, this.dragBox.endScreenY);
      const w = Math.abs(this.dragBox.endScreenX - this.dragBox.startScreenX);
      const h = Math.abs(this.dragBox.endScreenY - this.dragBox.startScreenY);
      if (w > 4 || h > 4) {
        ctx.fillStyle = 'rgba(92, 224, 152, 0.14)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(134, 240, 178, 0.9)';
        ctx.lineWidth = 1.4;
        ctx.strokeRect(x, y, w, h);
      }
    }

    // Subtle command-mode cursor indicator
    if (mouseX > 0 && mouseY > 0 && mouseX < viewportW && mouseY < viewportH) {
      ctx.strokeStyle = 'rgba(134, 240, 178, 0.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(mouseX, mouseY, 7, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }
}
