/**
 * Battlefield Environment System:
 * - Supports SIMULATION (grid proving ground) & FIRING_RANGE (natural terrain)
 * - Terrain surfaces (NORMAL, GRASS, DIRT, SAND, MUD, SOFT_GROUND)
 * - Trees, bushes, destructible props & interactive tall grass clusters
 * - Offscreen-baked natural terrain texture for high FPS
 */
import { CONFIG } from './config.js';
import { TrenchSystem } from './trench.js?v=17';

export const GAME_MODE = {
  SIMULATION: 'simulation',
  FIRING_RANGE: 'firing_range',
  SOVIET_TRENCH_DEFENSE: 'soviet_trench_defense',
  CUSTOM_BATTLE: 'custom_battle',
};

export const SURFACE_TYPE = {
  NORMAL: 'NORMAL',
  GRASS: 'GRASS',
  DIRT: 'DIRT',
  SAND: 'SAND',
  MUD: 'MUD',
  SOFT_GROUND: 'SOFT_GROUND',
};

export const LIGHTING_PRESETS = {
  MORNING: {
    id: 'MORNING',
    sunDir: { x: 0.78, y: 0.62 },
    shadowLen: 1.15,
    shadowAlpha: 0.24,
    tint: 'rgba(255, 224, 175, 0.08)',
    hazeAlpha: 0.14,
  },
  AFTERNOON: {
    id: 'AFTERNOON',
    sunDir: { x: 0.58, y: 0.81 },
    shadowLen: 0.95,
    shadowAlpha: 0.26,
    tint: 'rgba(255, 248, 230, 0.03)',
    hazeAlpha: 0.08,
  },
  LATE_AFTERNOON: {
    id: 'LATE_AFTERNOON',
    sunDir: { x: 0.85, y: 0.52 },
    shadowLen: 1.42,
    shadowAlpha: 0.28,
    tint: 'rgba(242, 175, 102, 0.12)',
    hazeAlpha: 0.16,
  },
  OVERCAST: {
    id: 'OVERCAST',
    sunDir: { x: 0.45, y: 0.89 },
    shadowLen: 0.65,
    shadowAlpha: 0.14,
    tint: 'rgba(175, 192, 188, 0.10)',
    hazeAlpha: 0.18,
  },
};

export const TREE_STATE = {
  STANDING: 'STANDING',
  SHAKING: 'SHAKING',
  FALLING: 'FALLING',
  FALLEN: 'FALLEN',
  DESTROYED: 'DESTROYED',
};

function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export class BattlefieldEnvironment {
  constructor(mode = GAME_MODE.SIMULATION, lightingPreset = 'AFTERNOON', firingRangePreset = 'trench') {
    this.mode = mode;
    this._windTime = 0;
    this._terrainCanvas = null;
    this.lighting = LIGHTING_PRESETS[lightingPreset] || LIGHTING_PRESETS.AFTERNOON;
    this.firingRangePreset = firingRangePreset;
    this.trenchSystem = null;
    this.craters = [];
    this.maxCraters = 60;

    if (mode === GAME_MODE.FIRING_RANGE) {
      this._initFiringRange();
    } else if (mode === GAME_MODE.SOVIET_TRENCH_DEFENSE) {
      this._initSovietTrenchDefense();
    } else if (mode === GAME_MODE.CUSTOM_BATTLE) {
      if (firingRangePreset === 'simulation') {
        this._initSimulation();
      } else {
        this._initFiringRange();
      }
    } else {
      this._initSimulation();
    }
  }

  _isCombatTerrainMode() {
    return (
      this.mode === GAME_MODE.FIRING_RANGE ||
      this.mode === GAME_MODE.SOVIET_TRENCH_DEFENSE ||
      (this.mode === GAME_MODE.CUSTOM_BATTLE && this.firingRangePreset !== 'simulation')
    );
  }

  setLightingPreset(key) {
    if (LIGHTING_PRESETS[key]) {
      this.lighting = LIGHTING_PRESETS[key];
    }
  }

  addShellCrater(x, y, caliberMm = 85, isHE = false) {
    if (!this._isCombatTerrainMode()) return;
    const radius = isHE ? Math.max(12, caliberMm * 0.24) : Math.max(7, caliberMm * 0.13);
    if (this.craters.length >= this.maxCraters) {
      this.craters.shift();
    }
    this.craters.push({
      x,
      y,
      radius,
      isHE,
      angle: Math.random() * Math.PI * 2,
    });
  }

  _initSimulation() {
    this.spawn = { x: CONFIG.TANK.START_X, y: CONFIG.TANK.START_Y, angle: CONFIG.TANK.START_ANGLE };
    this.targetSpawn = { x: 2060, y: 1480, angle: Math.PI * 0.78 };

    // Pure flat grid proving ground: no natural terrain, mud, trees, bushes, or tall grass
    this.surfaceZones = [];
    this.obstacles = [];
    this.tallGrass = [];
  }

  _initFiringRange() {
    // Dedicated concealed SW spawn clearing with open maneuvering space around it
    this.spawn = { x: 1460, y: 2040, angle: -Math.PI / 2 };
    this.targetSpawn = { x: 2120, y: 1320, angle: Math.PI * 0.82 };

    // Natural organic patches of dirt, sand, and mud over green grass base
    this.surfaceZones = [
      // Brown dirt training tracks & berms
      { x: 1480, y: 1960, rx: 190, ry: 120, rot: -0.32, type: SURFACE_TYPE.DIRT },
      { x: 2120, y: 1320, rx: 240, ry: 175, rot: 0.25, type: SURFACE_TYPE.DIRT },
      { x: 1480, y: 1480, rx: 210, ry: 130, rot: 0.55, type: SURFACE_TYPE.DIRT },
      { x: 2420, y: 1760, rx: 185, ry: 135, rot: -0.4, type: SURFACE_TYPE.DIRT },
      // Sand dunes & impact range patches
      { x: 2280, y: 1180, rx: 195, ry: 130, rot: -0.2, type: SURFACE_TYPE.SAND },
      { x: 1520, y: 1880, rx: 175, ry: 115, rot: 0.42, type: SURFACE_TYPE.SAND },
      { x: 2380, y: 2040, rx: 220, ry: 140, rot: 0.15, type: SURFACE_TYPE.SAND },
      // Muddy low-ground hollows
      { x: 1340, y: 1620, rx: 135, ry: 90, rot: -0.5, type: SURFACE_TYPE.MUD },
      { x: 2560, y: 1520, rx: 145, ry: 95, rot: 0.35, type: SURFACE_TYPE.MUD },
    ];

    const rng = seededRandom(1944085);
    this.obstacles = [];
    let nextId = 1;

    // Deliberate natural concealment screen between player spawn (1460, 2040) & enemy formation (2120, 1320)
    // Leaves >= 175px open maneuvering radius around player spawn while blocking full-footprint LOS
    const screenSpecs = [
      { kind: 'large_tree', x: 1580, y: 1790, trunk: 20, canopy: 48 },
      { kind: 'large_tree', x: 1675, y: 1740, trunk: 20, canopy: 50 },
      { kind: 'large_tree', x: 1775, y: 1685, trunk: 19, canopy: 48 },
      { kind: 'large_tree', x: 1875, y: 1645, trunk: 20, canopy: 49 },
      { kind: 'small_tree', x: 1630, y: 1775, trunk: 10, canopy: 30 },
      { kind: 'small_tree', x: 1725, y: 1715, trunk: 10, canopy: 30 },
      { kind: 'small_tree', x: 1825, y: 1665, trunk: 10, canopy: 30 },
      { kind: 'bush', x: 1535, y: 1825, trunk: 14, canopy: 24 },
      { kind: 'bush', x: 1695, y: 1795, trunk: 14, canopy: 24 },
      { kind: 'bush', x: 1795, y: 1745, trunk: 14, canopy: 24 },
      { kind: 'bush', x: 1910, y: 1695, trunk: 14, canopy: 24 },
      // East flank screen so flanking/spawn edges are also concealed
      { kind: 'large_tree', x: 1660, y: 1960, trunk: 19, canopy: 46 },
      { kind: 'bush', x: 1650, y: 1890, trunk: 14, canopy: 24 },
      { kind: 'large_tree', x: 1510, y: 1815, trunk: 19, canopy: 48 },
      { kind: 'small_tree', x: 1445, y: 1835, trunk: 10, canopy: 32 },
      { kind: 'bush', x: 1615, y: 1850, trunk: 14, canopy: 26 },
      { kind: 'large_tree', x: 1955, y: 1620, trunk: 19, canopy: 48 },
    ];
    for (const sp of screenSpecs) {
      this.obstacles.push({
        id: nextId++,
        kind: sp.kind,
        x: sp.x,
        y: sp.y,
        trunkRadius: sp.trunk,
        canopyRadius: sp.canopy,
        state: TREE_STATE.STANDING,
        hp: sp.kind === 'large_tree' ? 120 : 40,
        maxHp: sp.kind === 'large_tree' ? 120 : 40,
        crushed: false,
        pendingFall: false,
        shakeTimer: 0,
        shakeMag: 0,
        fallProgress: 0,
        fallDuration: sp.kind === 'large_tree' ? 0.85 : 0.48,
        fallAngle: 0,
        groundBurstSpawned: false,
      });
    }

    // Scatter additional trees & bushes organically, keeping spawn maneuvering zone & Panzer III zone clear
    const candidates = [
      { kind: 'large_tree', count: 14, trunk: 19, canopy: 44 },
      { kind: 'small_tree', count: 18, trunk: 9, canopy: 24 },
      { kind: 'bush', count: 22, trunk: 14, canopy: 18 },
    ];

    for (const cfg of candidates) {
      let placed = 0;
      let attempts = 0;
      while (placed < cfg.count && attempts < 240) {
        attempts++;
        const x = 980 + rng() * 1720;
        const y = 880 + rng() * 1720;
        // Keep player spawn maneuvering clearing & Panzer III formation zone clear
        if (Math.hypot(x - this.spawn.x, y - this.spawn.y) < 185) continue;
        if (Math.hypot(x - this.targetSpawn.x, y - this.targetSpawn.y) < 230) continue;

        let tooClose = false;
        for (const o of this.obstacles) {
          if (Math.hypot(x - o.x, y - o.y) < cfg.canopy + o.canopyRadius + 10) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;

        this.obstacles.push({
          id: nextId++,
          kind: cfg.kind,
          x,
          y,
          trunkRadius: cfg.trunk + (rng() - 0.5) * 3,
          canopyRadius: cfg.canopy + (rng() - 0.5) * 8,
          state: TREE_STATE.STANDING,
          hp: cfg.kind === 'large_tree' ? 120 : 40,
          maxHp: cfg.kind === 'large_tree' ? 120 : 40,
          crushed: false,
          pendingFall: false,
          shakeTimer: 0,
          shakeMag: 0,
          fallProgress: 0,
          fallDuration: cfg.kind === 'large_tree' ? 0.85 : 0.48,
          fallAngle: 0,
          groundBurstSpawned: false,
        });
        placed++;
      }
    }

    // Scatter 48 tall grass clusters
    this.tallGrass = [];
    for (let i = 0; i < 48; i++) {
      const gx = 1040 + rng() * 1620;
      const gy = 960 + rng() * 1580;
      if (Math.hypot(gx - this.spawn.x, gy - this.spawn.y) < 120) continue;
      const surf = this.getSurfaceAt(gx, gy);
      if (surf === SURFACE_TYPE.SAND) continue;

      const bladeCount = 10 + Math.floor(rng() * 8);
      const blades = [];
      const palette = ['#3d592c', '#506f39', '#678447', '#8b8a44'];
      for (let b = 0; b < bladeCount; b++) {
        const a = rng() * Math.PI * 2;
        const dist = rng() * 24;
        blades.push({
          ox: Math.cos(a) * dist,
          oy: Math.sin(a) * dist,
          len: 9 + rng() * 9,
          baseAngle: -Math.PI / 2 + (rng() - 0.5) * 0.9,
          color: palette[Math.floor(rng() * palette.length)],
        });
      }

      this.tallGrass.push({
        x: gx,
        y: gy,
        radius: 26,
        swayPhase: rng() * Math.PI * 2,
        flattened: 0,
        flatAngle: 0,
        recoverTimer: 0,
        blades,
      });
    }

    this._buildFiringRangeTerrainCanvas();
    if (this.firingRangePreset === 'trench') {
      this.trenchSystem = new TrenchSystem('firing_range');
    }
  }

  _initSovietTrenchDefense() {
    this._initFiringRange();
    this.spawn = { x: 1800, y: 1965, angle: -Math.PI / 2 };
    this.targetSpawn = { x: 1800, y: 520, angle: Math.PI / 2 };

    // Keep expanded central Soviet defensive fortification and map-edge German spawn corridors clear of trees/props
    this.obstacles = this.obstacles.filter((o) => {
      const inFort = o.x >= 1180 && o.x <= 2420 && o.y >= 1260 && o.y <= 2340;
      const inEdgeRing = o.x < 460 || o.x > CONFIG.WORLD.WIDTH - 460 || o.y < 460 || o.y > CONFIG.WORLD.HEIGHT - 460;
      return !inFort && !inEdgeRing;
    });
    this.tallGrass = this.tallGrass.filter((g) => {
      const inFort = g.x >= 1220 && g.x <= 2380 && g.y >= 1300 && g.y <= 2300;
      return !inFort;
    });

    this.trenchSystem = new TrenchSystem('soviet_trench_defense');
  }

  _drawOrganicBlob(ctx, cx, cy, rx, ry, rot, rng, lobes = 9) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.beginPath();
    for (let i = 0; i <= lobes; i++) {
      const a = (i / lobes) * Math.PI * 2;
      const jitter = 0.78 + rng() * 0.42;
      const px = Math.cos(a) * rx * jitter;
      const py = Math.sin(a) * ry * jitter;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _buildFiringRangeTerrainCanvas() {
    if (typeof document === 'undefined') return;
    const scale = 0.5;
    const w = Math.floor(CONFIG.WORLD.WIDTH * scale);
    const h = Math.floor(CONFIG.WORLD.HEIGHT * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const rng = seededRandom(85341944);

    // 1. Muted WWII olive grassland base
    ctx.fillStyle = '#3f502f';
    ctx.fillRect(0, 0, w, h);

    // 2. Organic multi-tone grassland & dry-grass variation (layered soft radial gradients + organic blobs)
    const grassShades = ['#374729', '#485a35', '#51633b', '#3b4a2b', '#625d39', '#6d653e'];
    for (let i = 0; i < 240; i++) {
      const gx = rng() * w;
      const gy = rng() * h;
      const rx = 42 + rng() * 115;
      const ry = 32 + rng() * 90;
      ctx.fillStyle = grassShades[i % grassShades.length];
      ctx.globalAlpha = i % 5 === 0 ? 0.24 : 0.34 + rng() * 0.22;
      this._drawOrganicBlob(ctx, gx, gy, rx, ry, rng() * Math.PI, rng, 10);
    }
    ctx.globalAlpha = 1;

    // 3. Subtle compacted dirt vehicle tracks / road ruts connecting range sectors
    ctx.save();
    ctx.strokeStyle = 'rgba(88, 70, 46, 0.36)';
    ctx.lineCap = 'round';
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.moveTo(1260 * scale, 2240 * scale);
    ctx.quadraticCurveTo(1680 * scale, 1920 * scale, 2120 * scale, 1320 * scale);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(64, 50, 32, 0.28)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(1252 * scale, 2232 * scale);
    ctx.quadraticCurveTo(1672 * scale, 1912 * scale, 2112 * scale, 1312 * scale);
    ctx.moveTo(1268 * scale, 2248 * scale);
    ctx.quadraticCurveTo(1688 * scale, 1928 * scale, 2128 * scale, 1328 * scale);
    ctx.stroke();
    ctx.restore();

    // 4. Natural dirt, sand, gravel & mud terrain zones (feathered multi-lobe organic shapes)
    for (const z of this.surfaceZones) {
      const zx = z.x * scale;
      const zy = z.y * scale;
      const rx = z.rx * scale;
      const ry = z.ry * scale;

      if (z.type === SURFACE_TYPE.DIRT) {
        ctx.fillStyle = 'rgba(98, 76, 49, 0.45)';
        this._drawOrganicBlob(ctx, zx, zy, rx * 1.08, ry * 1.08, z.rot, rng, 11);
        ctx.fillStyle = 'rgba(82, 62, 40, 0.68)';
        this._drawOrganicBlob(ctx, zx + 4, zy - 3, rx * 0.85, ry * 0.82, z.rot + 0.2, rng, 10);
        // Gravel scatter inside dirt patches
        for (let g = 0; g < 26; g++) {
          const ga = rng() * Math.PI * 2;
          const gd = rng() * Math.min(rx, ry) * 0.78;
          ctx.fillStyle = rng() > 0.5 ? 'rgba(130, 122, 108, 0.42)' : 'rgba(56, 44, 30, 0.45)';
          ctx.fillRect(zx + Math.cos(ga) * gd, zy + Math.sin(ga) * gd, 1.5 + rng() * 2, 1.5 + rng() * 1.5);
        }
      } else if (z.type === SURFACE_TYPE.SAND) {
        ctx.fillStyle = 'rgba(168, 146, 104, 0.42)';
        this._drawOrganicBlob(ctx, zx, zy, rx * 1.08, ry * 1.08, z.rot, rng, 11);
        ctx.fillStyle = 'rgba(182, 160, 116, 0.68)';
        this._drawOrganicBlob(ctx, zx - 4, zy + 4, rx * 0.76, ry * 0.72, z.rot - 0.15, rng, 10);
      } else if (z.type === SURFACE_TYPE.MUD) {
        ctx.fillStyle = 'rgba(64, 50, 34, 0.52)';
        this._drawOrganicBlob(ctx, zx, zy, rx * 1.05, ry * 1.05, z.rot, rng, 11);
        ctx.fillStyle = 'rgba(46, 36, 24, 0.78)';
        this._drawOrganicBlob(ctx, zx + 2, zy + 2, rx * 0.72, ry * 0.68, z.rot + 0.3, rng, 9);
        // Subtle wet mud sheen
        ctx.fillStyle = 'rgba(92, 102, 95, 0.18)';
        this._drawOrganicBlob(ctx, zx - 6, zy - 4, rx * 0.42, ry * 0.36, z.rot, rng, 8);
      }
    }

    // 5. Forest floor soil, fallen leaves & pine needles beneath standing trees
    for (const o of this.obstacles) {
      if (o.kind !== 'large_tree' && o.kind !== 'small_tree') continue;
      const ox = o.x * scale;
      const oy = o.y * scale;
      const fr = (o.canopyRadius * 1.15) * scale;
      ctx.fillStyle = 'rgba(46, 44, 28, 0.55)';
      this._drawOrganicBlob(ctx, ox, oy, fr, fr * 0.9, rng() * Math.PI, rng, 8);
      // Scattered fallen leaves/twigs
      for (let l = 0; l < 8; l++) {
        const la = rng() * Math.PI * 2;
        const ld = rng() * fr * 0.9;
        ctx.fillStyle = l % 2 === 0 ? 'rgba(116, 86, 44, 0.45)' : 'rgba(72, 82, 42, 0.45)';
        ctx.fillRect(ox + Math.cos(la) * ld, oy + Math.sin(la) * ld, 2, 1.2);
      }
    }

    // 6. Weathered historical shell craters, rocks, fallen branches & dead grass tufts
    for (let c = 0; c < 18; c++) {
      const cx = (1050 + rng() * 1550) * scale;
      const cy = (950 + rng() * 1550) * scale;
      const cr = (7 + rng() * 10) * scale;
      ctx.fillStyle = 'rgba(38, 32, 22, 0.52)';
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(104, 86, 62, 0.38)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    for (let r = 0; r < 65; r++) {
      const rx = rng() * w;
      const ry = rng() * h;
      if (r % 3 === 0) {
        // Small fallen branch / log
        ctx.save();
        ctx.translate(rx, ry);
        ctx.rotate(rng() * Math.PI);
        ctx.fillStyle = 'rgba(72, 54, 34, 0.65)';
        ctx.fillRect(-5, -1, 10 + rng() * 6, 2);
        ctx.restore();
      } else {
        // Small scattered rock / pebble
        ctx.fillStyle = r % 2 === 0 ? 'rgba(112, 108, 96, 0.55)' : 'rgba(84, 80, 72, 0.58)';
        ctx.beginPath();
        ctx.ellipse(rx, ry, 1.5 + rng() * 2.2, 1.2 + rng() * 1.8, rng() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 7. Fine natural soil/grass/sand micro-texture speckles
    for (let i = 0; i < 4200; i++) {
      const px = rng() * w;
      const py = rng() * h;
      const r = 0.7 + rng() * 1.6;
      ctx.fillStyle = rng() > 0.48 ? 'rgba(235, 225, 185, 0.07)' : 'rgba(18, 22, 12, 0.14)';
      ctx.fillRect(px, py, r, r);
    }

    // 8. Proving ground perimeter border
    ctx.strokeStyle = 'rgba(210, 215, 190, 0.30)';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, w - 4, h - 4);

    this._terrainCanvas = canvas;
  }

  getSurfaceAt(x, y) {
    for (const z of this.surfaceZones) {
      const dx = x - z.x;
      const dy = y - z.y;
      const cos = Math.cos(-z.rot);
      const sin = Math.sin(-z.rot);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      const norm = (lx * lx) / (z.rx * z.rx) + (ly * ly) / (z.ry * z.ry);
      if (norm <= 1.0) {
        return z.type;
      }
    }
    return this._isCombatTerrainMode() ? SURFACE_TYPE.GRASS : SURFACE_TYPE.NORMAL;
  }

  /**
   * World-space visual line-of-sight check obstructed by standing trees & bushes.
   */
  hasLineOfSight(x1, y1, x2, y2) {
    if (!this.obstacles || this.obstacles.length === 0) return true;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1) return true;

    for (const o of this.obstacles) {
      if (o.state === TREE_STATE.FALLEN || o.state === TREE_STATE.DESTROYED) continue;
      if (o.kind !== 'large_tree' && o.kind !== 'small_tree' && o.kind !== 'bush') continue;
      const blockR = o.kind === 'bush' ? o.canopyRadius * 0.92 : o.canopyRadius * 0.78;
      const t = Math.max(0, Math.min(1, ((o.x - x1) * dx + (o.y - y1) * dy) / lenSq));
      const px = x1 + t * dx;
      const py = y1 + t * dy;
      const distSq = (o.x - px) * (o.x - px) + (o.y - py) * (o.y - py);
      if (distSq <= blockR * blockR) {
        return false;
      }
    }
    return true;
  }

  /**
   * Checks visual line of sight against the full vehicle OBB footprint (center + 4 corners).
   */
  hasTargetFootprintLOS(observerX, observerY, obb) {
    if (!obb) return false;
    if (this.hasLineOfSight(observerX, observerY, obb.x, obb.y)) return true;

    const cos = Math.cos(obb.angle);
    const sin = Math.sin(obb.angle);
    const hx = obb.halfLength * 0.88;
    const hy = obb.halfWidth * 0.88;
    const corners = [
      { lx: hx, ly: hy },
      { lx: hx, ly: -hy },
      { lx: -hx, ly: hy },
      { lx: -hx, ly: -hy },
    ];
    for (const c of corners) {
      const wx = obb.x + c.lx * cos - c.ly * sin;
      const wy = obb.y + c.lx * sin + c.ly * cos;
      if (this.hasLineOfSight(observerX, observerY, wx, wy)) {
        return true;
      }
    }
    return false;
  }

  damageTree(o, dmg, impactAngle, particles = null, isExplosive = false) {
    if (!o || o.state === TREE_STATE.FALLEN || o.state === TREE_STATE.DESTROYED) return false;
    o.hp = Math.max(0, o.hp - dmg);
    o.fallAngle = impactAngle;

    if (particles) {
      particles.spawnTrackDust(o.x, o.y, Math.cos(impactAngle) * 18, Math.sin(impactAngle) * 18, isExplosive ? 0.85 : 0.45, true);
    }

    if (o.hp <= 0 && o.state !== TREE_STATE.FALLING) {
      // Stage 1: brief violent shake/crack before toppling
      o.state = TREE_STATE.SHAKING;
      o.pendingFall = true;
      o.shakeTimer = 0.24;
      o.shakeMag = 3.2;
      return true;
    }

    if (o.state === TREE_STATE.STANDING) {
      o.state = TREE_STATE.SHAKING;
      o.shakeTimer = 0.20;
      o.shakeMag = Math.min(2.8, 0.8 + dmg * 0.03);
    }
    return false;
  }

  update(dt, tank = null, particles = null) {
    this._windTime += dt;

    for (const o of this.obstacles) {
      if (o.state === TREE_STATE.SHAKING) {
        o.shakeTimer -= dt;
        if (o.shakeTimer <= 0) {
          o.shakeTimer = 0;
          if (o.pendingFall) {
            o.state = TREE_STATE.FALLING;
            o.crushed = true;
            o.fallProgress = 0;
          } else {
            o.state = TREE_STATE.STANDING;
          }
        }
      } else if (o.state === TREE_STATE.FALLING) {
        const dur = o.fallDuration || 0.65;
        o.fallProgress = Math.min(1, o.fallProgress + dt / dur);
        if (o.fallProgress >= 1) {
          o.state = TREE_STATE.FALLEN;
          if (!o.groundBurstSpawned) {
            o.groundBurstSpawned = true;
            if (particles) {
              const dist = o.kind === 'large_tree' ? 46 : 28;
              particles.spawnTrackDust(
                o.x + Math.cos(o.fallAngle) * dist,
                o.y + Math.sin(o.fallAngle) * dist,
                0,
                0,
                0.85,
                true
              );
            }
          }
        }
      } else if (o.crushed && o.fallProgress < 1) {
        o.fallProgress = Math.min(1, o.fallProgress + dt * 3.2);
      }
    }

    if (this.tallGrass.length > 0) {
      const tankMoving = tank && (Math.abs(tank.speed) > 4 || Math.abs(tank.angularVelocity) > 0.04);
      for (const g of this.tallGrass) {
        if (tank) {
          const dist = Math.hypot(g.x - tank.x, g.y - tank.y);
          if (dist < g.radius + 44) {
            if (tankMoving || g.flattened > 0.05) {
              g.flattened = Math.min(1, g.flattened + dt * 7.5);
              g.flatAngle = tank.angle;
              g.recoverTimer = 4.0;
            }
          }
        }
        if (g.recoverTimer > 0) {
          g.recoverTimer -= dt;
        } else if (g.flattened > 0) {
          g.flattened = Math.max(0, g.flattened - dt * 0.18);
        }
      }
    }
  }

  resolveTankCollisions(tank, particles) {
    if (this.trenchSystem) {
      this.trenchSystem.resolveTankInteraction(tank, particles);
    }
    const scale = CONFIG.TANK.SCALE;
    const halfLen = tank.halfLength || 110 * scale;
    const halfWid = tank.halfWidth || 54 * scale;
    const cos = Math.cos(tank.angle);
    const sin = Math.sin(tank.angle);
    const isMoving = Math.abs(tank.speed) > 4 || Math.abs(tank.angularVelocity) > 0.04;

    for (const o of this.obstacles) {
      if (o.state === TREE_STATE.DESTROYED) continue;

      // Fallen large tree has a low-profile log collider offset along fallAngle (NOT at old standing spot)
      let colX = o.x;
      let colY = o.y;
      let colR = o.trunkRadius;
      if (o.state === TREE_STATE.FALLEN) {
        if (o.kind !== 'large_tree') continue;
        colX = o.x + Math.cos(o.fallAngle) * 34;
        colY = o.y + Math.sin(o.fallAngle) * 34;
        colR = 11;
      } else if (o.state === TREE_STATE.FALLING || o.crushed) {
        continue;
      }

      const dx = colX - tank.x;
      const dy = colY - tank.y;
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;

      const cx = Math.max(-halfLen, Math.min(halfLen, lx));
      const cy = Math.max(-halfWid, Math.min(halfWid, ly));
      const diffX = lx - cx;
      const diffY = ly - cy;
      const distSq = diffX * diffX + diffY * diffY;

      if (distSq >= colR * colR) continue;

      if (o.kind === 'small_tree' || o.kind === 'bush' || o.kind === 'crate') {
        if (!isMoving) continue;
        o.crushed = true;
        o.state = o.kind === 'small_tree' ? TREE_STATE.FALLING : TREE_STATE.FALLEN;
        o.fallAngle = tank.angle + (Math.random() - 0.5) * 0.4;
        if (particles) {
          particles.spawnTrackDust(o.x, o.y, 0, 0, 0.7, o.kind !== 'crate');
        }
        continue;
      }

      // Large tree: check ramming speed; slow bump only shakes tree, fast ram knocks it down
      if (o.state !== TREE_STATE.FALLEN && isMoving && Math.abs(tank.speed) >= 55 && !o.pendingFall) {
        this.damageTree(o, 130, tank.angle, particles, false);
        tank.speed *= 0.55;
      } else if (o.state === TREE_STATE.STANDING && isMoving) {
        this.damageTree(o, 15, tank.angle, particles, false);
      }

      const dist = Math.sqrt(distSq);
      let lnx = 0;
      let lny = 0;
      let overlap = 0;
      if (dist > 0.001) {
        lnx = diffX / dist;
        lny = diffY / dist;
        overlap = colR - dist;
      } else {
        const penX = halfLen - Math.abs(lx) + colR;
        const penY = halfWid - Math.abs(ly) + colR;
        if (penX < penY) {
          lnx = lx >= 0 ? 1 : -1;
          overlap = penX;
        } else {
          lny = ly >= 0 ? 1 : -1;
          overlap = penY;
        }
      }
      const wnx = lnx * cos - lny * sin;
      const wny = lnx * sin + lny * cos;
      tank.x -= wnx * overlap;
      tank.y -= wny * overlap;
      tank.speed *= 0.65;
    }
  }

  renderTerrain(ctx) {
    if (this._isCombatTerrainMode() && this._terrainCanvas) {
      ctx.drawImage(this._terrainCanvas, 0, 0, CONFIG.WORLD.WIDTH, CONFIG.WORLD.HEIGHT);
    }
  }

  renderGroundZones(ctx, viewBounds = null) {
    if (this._isCombatTerrainMode()) {
      if (this.trenchSystem) {
        this.trenchSystem.renderGround(ctx, viewBounds);
      }
      // Render persistent combat shell craters on top of baked terrain
      for (const c of this.craters) {
        if (
          viewBounds &&
          (c.x + c.radius * 2 < viewBounds.minX ||
            c.x - c.radius * 2 > viewBounds.maxX ||
            c.y + c.radius * 2 < viewBounds.minY ||
            c.y - c.radius * 2 > viewBounds.maxY)
        ) {
          continue;
        }
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.angle);
        // Outer displaced soil rim
        ctx.fillStyle = 'rgba(78, 62, 42, 0.72)';
        ctx.beginPath();
        ctx.ellipse(0, 0, c.radius * 1.35, c.radius * 1.18, 0, 0, Math.PI * 2);
        ctx.fill();
        // Inner scorch / deep pit
        ctx.fillStyle = c.isHE ? 'rgba(26, 22, 18, 0.85)' : 'rgba(38, 30, 22, 0.76)';
        ctx.beginPath();
        ctx.ellipse(0, 0, c.radius * 0.78, c.radius * 0.68, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      return;
    }
    for (const z of this.surfaceZones) {
      ctx.save();
      ctx.translate(z.x, z.y);
      ctx.rotate(z.rot);
      if (z.type === SURFACE_TYPE.MUD) {
        ctx.fillStyle = 'rgba(72, 54, 36, 0.46)';
        ctx.beginPath();
        ctx.ellipse(0, 0, z.rx, z.ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(54, 40, 26, 0.42)';
        ctx.beginPath();
        ctx.ellipse(12, -6, z.rx * 0.68, z.ry * 0.62, 0.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(98, 86, 62, 0.30)';
        ctx.beginPath();
        ctx.ellipse(0, 0, z.rx, z.ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  _isUnderTank(px, py, radius, tank) {
    if (!tank) return false;
    const scale = CONFIG.TANK.SCALE;
    const halfLen = 110 * scale + radius * 0.4;
    const halfWid = 54 * scale + radius * 0.4;
    const cos = Math.cos(tank.angle);
    const sin = Math.sin(tank.angle);
    const dx = px - tank.x;
    const dy = py - tank.y;
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    return Math.abs(lx) <= halfLen && Math.abs(ly) <= halfWid;
  }

  _drawTallGrassCluster(ctx, g) {
    const sway = Math.sin(this._windTime * 2.1 + g.swayPhase) * 0.22 * (1 - g.flattened);
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.lineCap = 'round';
    ctx.globalAlpha = g.flattened > 0.12 ? 0.56 : 0.72;
    for (const b of g.blades) {
      const angle = b.baseAngle * (1 - g.flattened) + g.flatAngle * g.flattened + sway;
      const len = b.len * (1 + g.flattened * 0.25);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 2.1;
      ctx.beginPath();
      ctx.moveTo(b.ox, b.oy);
      ctx.lineTo(b.ox + Math.cos(angle) * len, b.oy + Math.sin(angle) * len);
      ctx.stroke();
    }
    ctx.restore();
  }

  renderOverhead(ctx, viewBounds = null) {
    if (this.trenchSystem) {
      this.trenchSystem.renderOverhead(ctx, viewBounds);
    }
  }

  /**
   * Layer 3: Low / flattened vegetation & trunks rendered BELOW vehicles and infantry.
   */
  renderLowVegetation(ctx, tank = null, viewBounds = null) {
    // Crushed props, fallen small trees, standing tree trunks, and crushed bushes
    for (const o of this.obstacles) {
      if (o.kind === 'bush' && !o.crushed) continue; // Intact bushes render in tall vegetation layer
      if (
        viewBounds &&
        (o.x + o.canopyRadius + 80 < viewBounds.minX ||
          o.x - o.canopyRadius - 80 > viewBounds.maxX ||
          o.y + o.canopyRadius + 80 < viewBounds.minY ||
          o.y - o.canopyRadius - 80 > viewBounds.maxY)
      ) {
        continue;
      }
      ctx.save();
      ctx.translate(o.x, o.y);

      if (o.kind === 'crate') {
        if (o.crushed) {
          ctx.rotate(o.fallAngle);
          ctx.fillStyle = 'rgba(110, 82, 48, 0.65)';
          ctx.fillRect(-10, -4, 9, 4);
          ctx.fillRect(2, 2, 10, 4);
        } else {
          ctx.fillStyle = '#755634';
          ctx.strokeStyle = '#2d2012';
          ctx.lineWidth = 1.4;
          ctx.fillRect(-10, -10, 20, 20);
          ctx.strokeRect(-10, -10, 20, 20);
          ctx.beginPath();
          ctx.moveTo(-10, -10);
          ctx.lineTo(10, 10);
          ctx.stroke();
        }
      } else if (o.kind === 'bush' && o.crushed) {
        ctx.fillStyle = 'rgba(60, 74, 46, 0.48)';
        ctx.beginPath();
        ctx.arc(0, 0, o.canopyRadius * 1.15, 0, Math.PI * 2);
        ctx.fill();
      } else if ((o.kind === 'small_tree' || o.kind === 'large_tree') && (o.state === TREE_STATE.FALLING || o.state === TREE_STATE.FALLEN || o.crushed)) {
        // Stump at original position + falling/fallen trunk extending along fallAngle
        ctx.fillStyle = '#5c4228';
        ctx.strokeStyle = '#241a0f';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(0, 0, o.trunkRadius * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.rotate(o.fallAngle);
        const maxLen = o.kind === 'large_tree' ? 56 : 34;
        const trunkW = o.kind === 'large_tree' ? 12 : 8;
        const t = o.fallProgress;
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const len = maxLen * ease;
        ctx.fillStyle = '#5a432c';
        ctx.strokeStyle = '#241a0f';
        ctx.fillRect(2, -trunkW / 2, len, trunkW);
        ctx.strokeRect(2, -trunkW / 2, len, trunkW);

        if (o.state === TREE_STATE.FALLEN) {
          ctx.fillStyle = o.kind === 'large_tree' ? 'rgba(54, 78, 42, 0.78)' : 'rgba(62, 86, 46, 0.78)';
          ctx.beginPath();
          ctx.arc(len + 10, 0, o.canopyRadius * 0.85, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (o.kind === 'small_tree' || o.kind === 'large_tree') {
        ctx.fillStyle = '#4e3924';
        ctx.strokeStyle = '#241a0f';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(0, 0, o.trunkRadius * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    // Flattened tall grass or grass currently underneath the tank hull
    for (const g of this.tallGrass) {
      if (g.flattened > 0.12 || this._isUnderTank(g.x, g.y, g.radius, tank)) {
        this._drawTallGrassCluster(ctx, g);
      }
    }
  }

  /**
   * Layer 5: Intact standing tall grass, intact bushes, and tree canopies ABOVE vehicles.
   */
  renderTallVegetation(ctx, tank = null, viewBounds = null) {
    for (const g of this.tallGrass) {
      if (
        viewBounds &&
        (g.x + g.radius + 20 < viewBounds.minX ||
          g.x - g.radius - 20 > viewBounds.maxX ||
          g.y + g.radius + 20 < viewBounds.minY ||
          g.y - g.radius - 20 > viewBounds.maxY)
      ) {
        continue;
      }
      if (g.flattened <= 0.12 && !this._isUnderTank(g.x, g.y, g.radius, tank)) {
        this._drawTallGrassCluster(ctx, g);
      }
    }

    const sun = this.lighting.sunDir;
    const sLen = this.lighting.shadowLen;
    const sAlpha = this.lighting.shadowAlpha;

    for (const o of this.obstacles) {
      if (o.state === TREE_STATE.FALLEN || o.state === TREE_STATE.DESTROYED) continue;
      if (
        viewBounds &&
        (o.x + o.canopyRadius + 90 < viewBounds.minX ||
          o.x - o.canopyRadius - 90 > viewBounds.maxX ||
          o.y + o.canopyRadius + 90 < viewBounds.minY ||
          o.y - o.canopyRadius - 90 > viewBounds.maxY)
      ) {
        continue;
      }
      const windSwayX = Math.sin(this._windTime * 1.4 + o.id * 1.7) * 1.3;
      const windSwayY = Math.cos(this._windTime * 1.1 + o.id * 2.3) * 0.9;

      if (o.kind === 'bush' && !o.crushed) {
        ctx.save();
        ctx.translate(o.x, o.y);
        const r = o.canopyRadius;
        // Directional soft ground shadow
        ctx.fillStyle = `rgba(12, 16, 10, ${(sAlpha * 0.78).toFixed(2)})`;
        ctx.beginPath();
        ctx.ellipse(sun.x * 5 * sLen, sun.y * 5 * sLen, r * 1.04, r * 0.9, 0.3, 0, Math.PI * 2);
        ctx.fill();

        // Irregular multi-lobed bush foliage
        const lobes = [
          { lx: -r * 0.32, ly: -r * 0.22, lr: r * 0.62, c: 'rgba(54, 74, 40, 0.88)' },
          { lx: r * 0.34, ly: -r * 0.16, lr: r * 0.58, c: 'rgba(60, 82, 44, 0.88)' },
          { lx: -r * 0.18, ly: r * 0.32, lr: r * 0.56, c: 'rgba(46, 64, 34, 0.88)' },
          { lx: r * 0.28, ly: r * 0.28, lr: r * 0.52, c: 'rgba(50, 70, 38, 0.88)' },
          { lx: 0, ly: 0, lr: r * 0.72, c: 'rgba(64, 88, 48, 0.9)' },
        ];
        for (const lb of lobes) {
          ctx.fillStyle = lb.c;
          ctx.beginPath();
          ctx.arc(lb.lx + windSwayX * 0.4, lb.ly + windSwayY * 0.4, lb.lr, 0, Math.PI * 2);
          ctx.fill();
        }
        // Sunward highlight
        ctx.fillStyle = 'rgba(98, 126, 70, 0.42)';
        ctx.beginPath();
        ctx.arc(-sun.x * r * 0.22, -sun.y * r * 0.22, r * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (o.kind === 'small_tree' || o.kind === 'large_tree') {
        let ox = o.x;
        let oy = o.y;
        if (o.state === TREE_STATE.SHAKING) {
          const vib = Math.sin(this._windTime * 48) * (o.shakeMag || 2.0);
          ox += Math.cos(o.fallAngle + 1.57) * vib + Math.cos(o.fallAngle) * 3;
          oy += Math.sin(o.fallAngle + 1.57) * vib + Math.sin(o.fallAngle) * 3;
        } else if (o.state === TREE_STATE.FALLING) {
          const maxLen = o.kind === 'large_tree' ? 56 : 34;
          const t = o.fallProgress;
          const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          ox += Math.cos(o.fallAngle) * (maxLen * ease + 10 * ease);
          oy += Math.sin(o.fallAngle) * (maxLen * ease + 10 * ease);
        }

        const r = o.canopyRadius;
        ctx.save();
        ctx.translate(ox, oy);

        // Directional canopy shadow on ground
        const shOffX = sun.x * (o.kind === 'large_tree' ? 14 : 9) * sLen;
        const shOffY = sun.y * (o.kind === 'large_tree' ? 14 : 9) * sLen;
        ctx.fillStyle = `rgba(10, 14, 9, ${sAlpha.toFixed(2)})`;
        ctx.beginPath();
        ctx.ellipse(shOffX, shOffY, r * 1.02, r * 0.94, 0.25, 0, Math.PI * 2);
        ctx.fill();

        // Multi-layered organic tree canopy
        const isLarge = o.kind === 'large_tree';
        const baseColor = isLarge ? 'rgba(42, 62, 32, 0.90)' : 'rgba(52, 74, 38, 0.88)';
        const midColor = isLarge ? 'rgba(54, 78, 42, 0.86)' : 'rgba(64, 88, 48, 0.86)';
        const hiColor = isLarge ? 'rgba(82, 110, 60, 0.55)' : 'rgba(92, 120, 66, 0.52)';

        const clusters = [
          { lx: -r * 0.36, ly: -r * 0.18, lr: r * 0.62 },
          { lx: r * 0.35, ly: -r * 0.24, lr: r * 0.58 },
          { lx: -r * 0.22, ly: r * 0.34, lr: r * 0.60 },
          { lx: r * 0.30, ly: r * 0.30, lr: r * 0.56 },
        ];
        ctx.fillStyle = baseColor;
        ctx.strokeStyle = 'rgba(20, 28, 16, 0.68)';
        ctx.lineWidth = 1.2;
        for (const cl of clusters) {
          ctx.beginPath();
          ctx.arc(cl.lx + windSwayX, cl.ly + windSwayY, cl.lr, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }

        // Central crown & sunward highlight
        ctx.fillStyle = midColor;
        ctx.beginPath();
        ctx.arc(windSwayX * 1.1, windSwayY * 1.1, r * 0.72, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = hiColor;
        ctx.beginPath();
        ctx.arc(-sun.x * r * 0.24 + windSwayX, -sun.y * r * 0.24 + windSwayY, r * 0.48, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }
    }
  }
}
