/**
 * Tactical Minimap System
 * - Offscreen-cached terrain & obstacle layer (zero per-frame full-scene re-render)
 * - World-coordinate accurate entity markers (hull + turret orientation)
 * - Player-side Fog-of-War / Line-of-Sight enemy visibility + fading last-known markers
 * - Supports full-map (1x) and player-centered zoom (1.6x, 2.4x) without rotating the map
 */
import { CONFIG } from './config.js';
import { GAME_MODE, SURFACE_TYPE, TREE_STATE } from './environment.js';
import { SOLDIER_STATE } from './infantry.js';

const ZOOM_LEVELS = [1.0, 1.6, 2.4];

export class TacticalMinimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.visible = true;
    this.zoomIndex = 0;

    // Offscreen terrain cache
    this._cacheCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    this._cacheCtx = this._cacheCanvas ? this._cacheCanvas.getContext('2d') : null;
    this._cacheSize = 360;
    if (this._cacheCanvas) {
      this._cacheCanvas.width = this._cacheSize;
      this._cacheCanvas.height = this._cacheSize;
    }
    this._cachedMode = null;
    this._cachedEnvRef = null;
    this._cachedStandingCount = -1;

    // Enemy Fog-of-War tracking (keyed by object reference)
    this._enemyMemory = new Map(); // entity -> { x, y, angle, turretAngle, isTank, lastSeenTimer, everSeen, currentlyVisible }
    this._tankSightRangePx = 780;
    this._infSightRangePx = 520;
    this._lastKnownPersistSec = 4.0;
  }

  get zoom() {
    return ZOOM_LEVELS[this.zoomIndex] || 1.0;
  }

  cycleZoom(delta = 1) {
    const next = this.zoomIndex + delta;
    this.zoomIndex = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, next));
    return this.zoom;
  }

  setVisible(vis) {
    this.visible = Boolean(vis);
  }

  resetVisibility() {
    this._enemyMemory.clear();
    this._cachedMode = null;
    this._cachedEnvRef = null;
    this._cachedStandingCount = -1;
  }

  _countStandingObstacles(environment) {
    if (!environment || !environment.obstacles) return 0;
    let count = 0;
    for (const o of environment.obstacles) {
      if (o.state !== TREE_STATE.FALLEN && o.state !== TREE_STATE.DESTROYED) {
        count++;
      }
    }
    return count;
  }

  _rebuildTerrainCache(environment) {
    if (!this._cacheCtx || !environment) return;
    const ctx = this._cacheCtx;
    const size = this._cacheSize;
    const worldW = CONFIG.WORLD.WIDTH;
    const worldH = CONFIG.WORLD.HEIGHT;
    const sx = size / worldW;
    const sy = size / worldH;

    ctx.clearRect(0, 0, size, size);

    if (environment.mode === GAME_MODE.FIRING_RANGE) {
      // Base green terrain
      ctx.fillStyle = '#2d3f22';
      ctx.fillRect(0, 0, size, size);

      // Surface zones (DIRT, SAND, MUD)
      for (const z of environment.surfaceZones || []) {
        ctx.save();
        ctx.translate(z.x * sx, z.y * sy);
        ctx.rotate(z.rot || 0);
        if (z.type === SURFACE_TYPE.DIRT) {
          ctx.fillStyle = 'rgba(116, 88, 56, 0.72)';
        } else if (z.type === SURFACE_TYPE.SAND) {
          ctx.fillStyle = 'rgba(168, 146, 98, 0.65)';
        } else if (z.type === SURFACE_TYPE.MUD) {
          ctx.fillStyle = 'rgba(68, 54, 38, 0.78)';
        } else {
          ctx.fillStyle = 'rgba(90, 110, 72, 0.45)';
        }
        ctx.beginPath();
        ctx.ellipse(0, 0, z.rx * sx, z.ry * sy, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Subtle sector grid overlay
      ctx.strokeStyle = 'rgba(210, 225, 195, 0.08)';
      ctx.lineWidth = 1;
      for (let c = 1; c < CONFIG.WORLD.GRID_COLS; c++) {
        const gx = c * CONFIG.WORLD.CELL_SIZE * sx;
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, size);
        ctx.stroke();
      }
      for (let r = 1; r < CONFIG.WORLD.GRID_ROWS; r++) {
        const gy = r * CONFIG.WORLD.CELL_SIZE * sy;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(size, gy);
        ctx.stroke();
      }

      // Trees & vegetation obstacles
      for (const o of environment.obstacles || []) {
        if (o.state === TREE_STATE.FALLEN || o.state === TREE_STATE.DESTROYED) continue;
        const ox = o.x * sx;
        const oy = o.y * sy;
        const r = Math.max(1.5, (o.canopyRadius || 20) * sx);
        if (o.kind === 'large_tree') {
          ctx.fillStyle = 'rgba(22, 42, 18, 0.92)';
        } else if (o.kind === 'small_tree') {
          ctx.fillStyle = 'rgba(34, 62, 26, 0.85)';
        } else {
          ctx.fillStyle = 'rgba(48, 78, 34, 0.72)';
        }
        ctx.beginPath();
        ctx.arc(ox, oy, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Trench network lines
      if (environment.trenchSystem) {
        ctx.lineCap = 'round';
        for (const s of environment.trenchSystem.segments) {
          ctx.strokeStyle = 'rgba(72, 54, 34, 0.88)';
          ctx.lineWidth = Math.max(2.2, s.halfWidth * 1.6 * sx);
          ctx.beginPath();
          ctx.moveTo(s.x1 * sx, s.y1 * sy);
          ctx.lineTo(s.x2 * sx, s.y2 * sy);
          ctx.stroke();

          ctx.strokeStyle = s.depth === 'deep' ? 'rgba(32, 24, 16, 0.95)' : 'rgba(46, 36, 24, 0.88)';
          ctx.lineWidth = Math.max(1.2, s.halfWidth * 0.9 * sx);
          ctx.beginPath();
          ctx.moveTo(s.x1 * sx, s.y1 * sy);
          ctx.lineTo(s.x2 * sx, s.y2 * sy);
          ctx.stroke();
        }
      }

      // Concealed T-34-85 spawn staging marker
      if (environment.spawn) {
        ctx.strokeStyle = 'rgba(94, 194, 255, 0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.arc(environment.spawn.x * sx, environment.spawn.y * sy, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else {
      // Simulation Mode: flat technical grid
      ctx.fillStyle = '#121813';
      ctx.fillRect(0, 0, size, size);

      ctx.strokeStyle = 'rgba(130, 165, 110, 0.12)';
      ctx.lineWidth = 0.75;
      for (let x = CONFIG.WORLD.SUBGRID_STEP; x < worldW; x += CONFIG.WORLD.SUBGRID_STEP) {
        const px = x * sx;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, size);
        ctx.stroke();
      }
      for (let y = CONFIG.WORLD.SUBGRID_STEP; y < worldH; y += CONFIG.WORLD.SUBGRID_STEP) {
        const py = y * sy;
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(size, py);
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(160, 200, 135, 0.28)';
      ctx.lineWidth = 1.1;
      for (let c = 1; c < CONFIG.WORLD.GRID_COLS; c++) {
        const gx = c * CONFIG.WORLD.CELL_SIZE * sx;
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, size);
        ctx.stroke();
      }
      for (let r = 1; r < CONFIG.WORLD.GRID_ROWS; r++) {
        const gy = r * CONFIG.WORLD.CELL_SIZE * sy;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(size, gy);
        ctx.stroke();
      }
    }

    // Playable boundary frame
    const padX = CONFIG.WORLD.BORDER_PADDING * sx;
    const padY = CONFIG.WORLD.BORDER_PADDING * sy;
    ctx.strokeStyle = 'rgba(200, 215, 185, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(padX, padY, size - padX * 2, size - padY * 2);

    this._cachedMode = environment.mode;
    this._cachedEnvRef = environment;
    this._cachedStandingCount = this._countStandingObstacles(environment);
  }

  _isEnemyObservedByPlayer(enemy, isTank, observers, environment) {
    if (!environment || environment.mode !== GAME_MODE.FIRING_RANGE) {
      return true; // Simulation Mode shows actual positions directly
    }

    for (const obs of observers) {
      const dist = Math.hypot(enemy.x - obs.x, enemy.y - obs.y);
      if (dist > obs.rangePx) continue;
      if (isTank && typeof enemy.getOBB === 'function' && typeof environment.hasTargetFootprintLOS === 'function') {
        if (environment.hasTargetFootprintLOS(obs.x, obs.y, enemy.getOBB())) {
          return true;
        }
      } else if (typeof environment.hasLineOfSight === 'function') {
        if (environment.hasLineOfSight(obs.x, obs.y, enemy.x, enemy.y)) {
          return true;
        }
      } else {
        return true;
      }
    }
    return false;
  }

  updateVisibility(dt, { environment, playerTank, friendlyTanks = [], targets = [], infantry = [] }) {
    if (!environment) return;

    const observers = [];
    if (playerTank && !playerTank.damageSystem?.vehicleDestroyed && !playerTank.damageSystem?.vehicleAbandoned) {
      observers.push({ x: playerTank.x, y: playerTank.y, rangePx: this._tankSightRangePx });
    }
    for (const ft of friendlyTanks) {
      if (ft && !ft.damageSystem?.vehicleDestroyed && !ft.damageSystem?.vehicleAbandoned) {
        observers.push({ x: ft.x, y: ft.y, rangePx: this._tankSightRangePx });
      }
    }
    for (const s of infantry) {
      if (s.alive && s.faction === 'soviet') {
        observers.push({ x: s.x, y: s.y, rangePx: this._infSightRangePx });
      }
    }

    const activeEnemies = new Set();

    for (const t of targets) {
      if (!t || t.faction === 'soviet') continue;
      activeEnemies.add(t);
      const visible = this._isEnemyObservedByPlayer(t, true, observers, environment);
      let rec = this._enemyMemory.get(t);
      if (!rec) {
        rec = {
          x: t.x,
          y: t.y,
          angle: t.angle,
          turretAngle: t.turretAngle ?? t.angle,
          isTank: true,
          lastSeenTimer: Infinity,
          everSeen: false,
          currentlyVisible: false,
        };
        this._enemyMemory.set(t, rec);
      }
      if (visible) {
        rec.x = t.x;
        rec.y = t.y;
        rec.angle = t.angle;
        rec.turretAngle = t.turretAngle ?? t.angle;
        rec.lastSeenTimer = 0;
        rec.everSeen = true;
        rec.currentlyVisible = true;
      } else {
        rec.currentlyVisible = false;
        if (rec.everSeen) {
          rec.lastSeenTimer += dt;
        }
      }
    }

    for (const s of infantry) {
      if (!s || s.faction === 'soviet') continue;
      if (s.state === SOLDIER_STATE.DEAD || s.state === SOLDIER_STATE.FALLING || s.state === SOLDIER_STATE.RAGDOLL) {
        this._enemyMemory.delete(s);
        continue;
      }
      activeEnemies.add(s);
      const visible = this._isEnemyObservedByPlayer(s, false, observers, environment);
      let rec = this._enemyMemory.get(s);
      if (!rec) {
        rec = {
          x: s.x,
          y: s.y,
          angle: s.angle,
          turretAngle: s.angle,
          isTank: false,
          lastSeenTimer: Infinity,
          everSeen: false,
          currentlyVisible: false,
        };
        this._enemyMemory.set(s, rec);
      }
      if (visible) {
        rec.x = s.x;
        rec.y = s.y;
        rec.angle = s.angle;
        rec.lastSeenTimer = 0;
        rec.everSeen = true;
        rec.currentlyVisible = true;
      } else {
        rec.currentlyVisible = false;
        if (rec.everSeen) {
          rec.lastSeenTimer += dt;
        }
      }
    }

    for (const key of this._enemyMemory.keys()) {
      if (!activeEnemies.has(key)) {
        this._enemyMemory.delete(key);
      }
    }
  }

  _worldToMini(wx, wy, viewCenterX, viewCenterY, halfViewW, halfViewH, cw, ch) {
    const nx = (wx - (viewCenterX - halfViewW)) / (halfViewW * 2);
    const ny = (wy - (viewCenterY - halfViewH)) / (halfViewH * 2);
    return { x: nx * cw, y: ny * ch };
  }

  _drawTankMarker(ctx, mx, my, hullAngle, turretAngle, fill, stroke, destroyed = false, immobilized = false) {
    ctx.save();
    ctx.translate(mx, my);

    // Hull rectangle
    ctx.save();
    ctx.rotate(hullAngle);
    ctx.fillStyle = destroyed ? '#5c5854' : fill;
    ctx.strokeStyle = destroyed ? '#2b2826' : (immobilized ? '#f0b443' : stroke);
    ctx.lineWidth = immobilized ? 1.6 : 1.1;
    ctx.fillRect(-6.5, -3.6, 13, 7.2);
    ctx.strokeRect(-6.5, -3.6, 13, 7.2);
    // Front heading chevron
    if (!destroyed) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(6.5, 0);
      ctx.lineTo(3.5, -2.2);
      ctx.lineTo(3.5, 2.2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Turret gun barrel indicator
    if (!destroyed) {
      ctx.save();
      ctx.rotate(turretAngle);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(9.5, 0);
      ctx.stroke();
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      // Wreck X
      ctx.strokeStyle = '#d46a62';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-4, -4);
      ctx.lineTo(4, 4);
      ctx.moveTo(4, -4);
      ctx.lineTo(-4, 4);
      ctx.stroke();
    }

    ctx.restore();
  }

  render({ environment, playerTank, friendlyTanks = [], controlledSoldier = null, targets = [], infantry = [] }) {
    if (!this.visible || !this.ctx || !this.canvas || !environment) return;

    const standingCount = this._countStandingObstacles(environment);
    if (
      this._cachedEnvRef !== environment ||
      this._cachedMode !== environment.mode ||
      this._cachedStandingCount !== standingCount
    ) {
      this._rebuildTerrainCache(environment);
    }

    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const worldW = CONFIG.WORLD.WIDTH;
    const worldH = CONFIG.WORLD.HEIGHT;
    const zoom = this.zoom;

    const focusEntity = controlledSoldier && controlledSoldier.alive ? controlledSoldier : playerTank;
    const halfViewW = (worldW * 0.5) / zoom;
    const halfViewH = (worldH * 0.5) / zoom;

    let viewCenterX = worldW * 0.5;
    let viewCenterY = worldH * 0.5;
    if (zoom > 1.01 && focusEntity) {
      viewCenterX = Math.max(halfViewW, Math.min(worldW - halfViewW, focusEntity.x));
      viewCenterY = Math.max(halfViewH, Math.min(worldH - halfViewH, focusEntity.y));
    }

    ctx.clearRect(0, 0, cw, ch);

    // 1. Blit cached terrain/grid layer
    if (this._cacheCanvas) {
      const srcX = ((viewCenterX - halfViewW) / worldW) * this._cacheSize;
      const srcY = ((viewCenterY - halfViewH) / worldH) * this._cacheSize;
      const srcW = ((halfViewW * 2) / worldW) * this._cacheSize;
      const srcH = ((halfViewH * 2) / worldH) * this._cacheSize;
      ctx.drawImage(this._cacheCanvas, srcX, srcY, srcW, srcH, 0, 0, cw, ch);
    }

    // 2. Enemy markers (Fog-of-War filtered in Firing Range Mode)
    for (const [entity, rec] of this._enemyMemory.entries()) {
      const isFiringRange = environment.mode === GAME_MODE.FIRING_RANGE;
      if (isFiringRange && !rec.currentlyVisible) {
        if (!rec.everSeen || rec.lastSeenTimer > this._lastKnownPersistSec) {
          continue;
        }
      }

      const pos = this._worldToMini(rec.x, rec.y, viewCenterX, viewCenterY, halfViewW, halfViewH, cw, ch);
      const alpha = !isFiringRange || rec.currentlyVisible
        ? 1.0
        : Math.max(0.25, 1.0 - rec.lastSeenTimer / this._lastKnownPersistSec);

      ctx.save();
      ctx.globalAlpha = alpha;
      if (rec.isTank) {
        const isDestroyed = Boolean(entity.destroyed || entity.damageSystem?.vehicleDestroyed);
        const isImmobilized =
          !isDestroyed &&
          (entity.damageSystem?.getState('ENGINE') === 'DESTROYED' ||
            entity.damageSystem?.getState('TRANSMISSION') === 'DESTROYED' ||
            entity.damageSystem?.getState('LEFT_TRACK') === 'DESTROYED' ||
            entity.damageSystem?.getState('RIGHT_TRACK') === 'DESTROYED');
        this._drawTankMarker(
          ctx,
          pos.x,
          pos.y,
          rec.angle,
          rec.turretAngle,
          '#d8483e',
          '#ff9b92',
          isDestroyed,
          isImmobilized
        );
      } else {
        ctx.fillStyle = '#ff5a4f';
        ctx.strokeStyle = '#3a0e0c';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 2.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    // 3. Friendly Soviet dismounted crew
    for (const s of infantry) {
      if (!s.alive || s.faction !== 'soviet') continue;
      const isActivePlayer = controlledSoldier === s;
      const pos = this._worldToMini(s.x, s.y, viewCenterX, viewCenterY, halfViewW, halfViewH, cw, ch);
      if (isActivePlayer) {
        ctx.strokeStyle = 'rgba(130, 220, 255, 0.75)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 5.2, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(pos.x + Math.cos(s.angle) * 6.5, pos.y + Math.sin(s.angle) * 6.5);
        ctx.stroke();
      }
      ctx.fillStyle = isActivePlayer ? '#7ad8ff' : '#4fa8e8';
      ctx.strokeStyle = '#0c273b';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, isActivePlayer ? 3.1 : 2.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 4. Friendly reinforcement T-34-85 markers
    for (const ft of friendlyTanks) {
      if (!ft) continue;
      const pos = this._worldToMini(ft.x, ft.y, viewCenterX, viewCenterY, halfViewW, halfViewH, cw, ch);
      const destroyed = Boolean(ft.damageSystem?.vehicleDestroyed);
      const immobilized =
        !destroyed &&
        (ft.damageSystem?.getState('ENGINE') === 'DESTROYED' ||
          ft.damageSystem?.getState('TRANSMISSION') === 'DESTROYED' ||
          ft.damageSystem?.getState('LEFT_TRACK') === 'DESTROYED' ||
          ft.damageSystem?.getState('RIGHT_TRACK') === 'DESTROYED');
      this._drawTankMarker(
        ctx,
        pos.x,
        pos.y,
        ft.angle,
        ft.turret?.worldAngle ?? ft.angle,
        '#46b978',
        '#d1fae5',
        destroyed,
        immobilized
      );
    }

    // 5. Player T-34-85 marker
    if (playerTank) {
      const pos = this._worldToMini(playerTank.x, playerTank.y, viewCenterX, viewCenterY, halfViewW, halfViewH, cw, ch);
      const destroyed = Boolean(playerTank.damageSystem?.vehicleDestroyed);
      const immobilized =
        !destroyed &&
        (playerTank.damageSystem?.getState('ENGINE') === 'DESTROYED' ||
          playerTank.damageSystem?.getState('TRANSMISSION') === 'DESTROYED' ||
          playerTank.damageSystem?.getState('LEFT_TRACK') === 'DESTROYED' ||
          playerTank.damageSystem?.getState('RIGHT_TRACK') === 'DESTROYED');
      this._drawTankMarker(
        ctx,
        pos.x,
        pos.y,
        playerTank.angle,
        playerTank.turret?.worldAngle ?? playerTank.angle,
        '#3f9be8',
        '#bfe7ff',
        destroyed,
        immobilized
      );
    }
  }
}
