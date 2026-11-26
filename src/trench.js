/**
 * Interactive WWII Trench Battlefield System
 * - Irregular interconnected trench networks (shallow & deep segments, communication trenches, dugouts)
 * - Cached offscreen static trench layer + persistent dynamic damage decals, collapsed walls, sandbags & timbers
 * - Tank collision/crossing physics, infantry cover/depth lowering, and artillery soil deformation
 */
import { CONFIG } from './config.js';

export const TRENCH_COMBAT_CONFIG = {
  STANDARD_SHELL_INTERACTION_PROB: 0.30, // 30% qualifying interaction (70% pass over open trench)
  HE_SHELL_INTERACTION_PROB: 0.45,       // 45% HE significant trench explosion & excavation
  HE_EXCAVATION_MULT: 1.30,              // ~30% more soil excavated by HE vs standard shell
  SMALL_ARMS_300M_PROTECTION_PROB: 0.80, // 80% protection at >= 300m when crouched in deep trench
  TRENCH_CLOSE_ACCURACY_SPREAD_MULT: 0.62, // ~90% close-range hit accuracy from valid trench firing pos
};

function distPointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) {
    return { dist: Math.hypot(px - x1, py - y1), projX: x1, projY: y1, t: 0 };
  }
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return { dist: Math.hypot(px - projX, py - projY), projX, projY, t };
}

export class TrenchSystem {
  constructor(layoutType = 'firing_range') {
    this.layoutType = layoutType;
    this.segments = [];
    this.sandbags = [];
    this.barbedWire = [];
    this.collapsedWalls = [];
    this.debris = [];
    this.firingBays = [];
    this.excavatedSoilTotal = 0;
    this._staticCanvas = null;
    if (layoutType === 'soviet_trench_defense') {
      this._buildSovietDefenseLayout();
    } else {
      this._buildLayout();
    }
    this._bakeStaticCanvas();
  }

  _buildLayout() {
    let nextId = 1;
    const addPoly = (pts, halfWidth, depth = 'deep', hasRoof = false) => {
      for (let i = 0; i < pts.length - 1; i++) {
        this.segments.push({
          id: nextId++,
          x1: pts[i].x,
          y1: pts[i].y,
          x2: pts[i + 1].x,
          y2: pts[i + 1].y,
          halfWidth,
          depth,
          hasRoof,
          roofCollapsed: false,
        });
      }
    };

    // 1. Soviet Forward Staging Trench (SW near player spawn, accessible shallow trench + dugout)
    addPoly(
      [
        { x: 1210, y: 2060 },
        { x: 1285, y: 1965 },
        { x: 1335, y: 1895 },
        { x: 1365, y: 1815 },
      ],
      18,
      'shallow',
      false
    );
    // Soviet dugout shelter at south end
    addPoly(
      [
        { x: 1185, y: 2070 },
        { x: 1225, y: 2045 },
      ],
      22,
      'deep',
      true
    );

    // 2. Central No-Man's-Land Irregular Communication & Outpost Trenches
    addPoly(
      [
        { x: 1580, y: 1680 },
        { x: 1695, y: 1640 },
        { x: 1795, y: 1585 },
        { x: 1885, y: 1610 },
      ],
      18,
      'shallow',
      false
    );

    // 3. German Forward Defensive Line (zig-zag deep firing trench + communication trench + timber dugout)
    addPoly(
      [
        { x: 1885, y: 1455 },
        { x: 1980, y: 1415 },
        { x: 2055, y: 1450 },
        { x: 2175, y: 1405 },
        { x: 2295, y: 1360 },
        { x: 2375, y: 1295 },
      ],
      21,
      'deep',
      false
    );
    // German Rear Communication Trench
    addPoly(
      [
        { x: 2175, y: 1405 },
        { x: 2235, y: 1300 },
        { x: 2265, y: 1210 },
      ],
      19,
      'deep',
      false
    );
    // German Reinforced Timber-Roofed Dugout
    addPoly(
      [
        { x: 2245, y: 1215 },
        { x: 2305, y: 1185 },
      ],
      24,
      'deep',
      true
    );

    // Place sandbag parapets along firing bays
    const bagLines = [
      { x1: 1280, y1: 1945, x2: 1335, y2: 1875, count: 6 },
      { x1: 1975, y1: 1435, x2: 2055, y2: 1470, count: 7 },
      { x1: 2175, y1: 1425, x2: 2285, y2: 1380, count: 8 },
      { x1: 1690, y1: 1660, x2: 1790, y2: 1605, count: 7 },
    ];
    for (const bl of bagLines) {
      const ang = Math.atan2(bl.y2 - bl.y1, bl.x2 - bl.x1);
      for (let i = 0; i < bl.count; i++) {
        const t = (i + 0.5) / bl.count;
        this.sandbags.push({
          x: bl.x1 + (bl.x2 - bl.x1) * t,
          y: bl.y1 + (bl.y2 - bl.y1) * t,
          angle: ang + (i % 2 === 0 ? 0.08 : -0.08),
          displaced: false,
        });
      }
    }

    // Place barbed wire entanglements in no-man's-land
    this.barbedWire = [
      { x1: 1710, y1: 1525, x2: 1835, y2: 1480 },
      { x1: 1940, y1: 1545, x2: 2085, y2: 1505 },
      { x1: 1420, y1: 1750, x2: 1540, y2: 1715 },
    ];
  }

  _buildSovietDefenseLayout() {
    let nextId = 1;
    const addPoly = (pts, halfWidth, depth = 'deep', hasRoof = false) => {
      for (let i = 0; i < pts.length - 1; i++) {
        this.segments.push({
          id: nextId++,
          x1: pts[i].x,
          y1: pts[i].y,
          x2: pts[i + 1].x,
          y2: pts[i + 1].y,
          halfWidth,
          depth,
          hasRoof,
          roofCollapsed: false,
        });
      }
    };

    // Expanded Central Soviet Rectangular Fortified Perimeter (x: 1300..2300, y: 1380..2220)
    // Wider firing trenches (halfWidth 26 -> 52px wide) & 180px N/S/E/W vehicle/infantry gates
    addPoly([
      { x: 1300, y: 1710 },
      { x: 1300, y: 1380 },
      { x: 1710, y: 1380 },
    ], 26, 'deep', false);

    addPoly([
      { x: 1890, y: 1380 },
      { x: 2300, y: 1380 },
      { x: 2300, y: 1710 },
    ], 26, 'deep', false);

    addPoly([
      { x: 2300, y: 1890 },
      { x: 2300, y: 2220 },
      { x: 1890, y: 2220 },
    ], 26, 'deep', false);

    addPoly([
      { x: 1710, y: 2220 },
      { x: 1300, y: 2220 },
      { x: 1300, y: 1890 },
    ], 26, 'deep', false);

    // Wider interior communication trenches & central command dugout
    addPoly([
      { x: 1410, y: 1380 },
      { x: 1410, y: 1490 },
    ], 22, 'shallow', false);
    addPoly([
      { x: 2190, y: 1380 },
      { x: 2190, y: 1490 },
    ], 22, 'shallow', false);
    addPoly([
      { x: 1410, y: 2220 },
      { x: 1410, y: 2110 },
    ], 22, 'shallow', false);
    addPoly([
      { x: 2190, y: 2220 },
      { x: 2190, y: 2110 },
    ], 22, 'shallow', false);
    addPoly([
      { x: 1745, y: 1800 },
      { x: 1855, y: 1800 },
    ], 24, 'deep', true);

    // Raised defensive firing bays so T-34-85s & ZiS-3 clear the trench parapet without clipping
    this.firingBays = [
      { id: 'bay_s', x: 1800, y: 1965, radius: 98, angle: -Math.PI / 2, kind: 'tank' },
      { id: 'bay_nw', x: 1545, y: 1620, radius: 98, angle: -Math.PI * 0.72, kind: 'tank' },
      { id: 'bay_ne', x: 2055, y: 1620, radius: 98, angle: -Math.PI * 0.28, kind: 'tank' },
      { id: 'bay_zis3', x: 1800, y: 1500, radius: 70, angle: -Math.PI / 2, kind: 'artillery' },
    ];

    // Reinforced sandbag parapets on outer defensive faces
    const bagLines = [
      { x1: 1330, y1: 1348, x2: 1690, y2: 1348, count: 18 },
      { x1: 1910, y1: 1348, x2: 2270, y2: 1348, count: 18 },
      { x1: 1330, y1: 2252, x2: 1690, y2: 2252, count: 18 },
      { x1: 1910, y1: 2252, x2: 2270, y2: 2252, count: 18 },
      { x1: 1268, y1: 1410, x2: 1268, y2: 1690, count: 14 },
      { x1: 1268, y1: 1910, x2: 1268, y2: 2190, count: 14 },
      { x1: 2332, y1: 1410, x2: 2332, y2: 1690, count: 14 },
      { x1: 2332, y1: 1910, x2: 2332, y2: 2190, count: 14 },
    ];
    for (const bl of bagLines) {
      const ang = Math.atan2(bl.y2 - bl.y1, bl.x2 - bl.x1);
      for (let i = 0; i < bl.count; i++) {
        const t = (i + 0.5) / bl.count;
        this.sandbags.push({
          x: bl.x1 + (bl.x2 - bl.x1) * t,
          y: bl.y1 + (bl.y2 - bl.y1) * t,
          angle: ang + (i % 2 === 0 ? 0.06 : -0.06),
          displaced: false,
        });
      }
    }

    // Outer perimeter barbed wire entanglements
    this.barbedWire = [
      { x1: 1310, y1: 1280, x2: 1670, y2: 1280 },
      { x1: 1930, y1: 1280, x2: 2290, y2: 1280 },
      { x1: 1310, y1: 2320, x2: 1670, y2: 2320 },
      { x1: 1930, y1: 2320, x2: 2290, y2: 2320 },
      { x1: 1205, y1: 1410, x2: 1205, y2: 1690 },
      { x1: 2395, y1: 1910, x2: 2395, y2: 2190 },
    ];
  }

  _bakeStaticCanvas() {
    if (typeof document === 'undefined') return;
    const scale = 0.5;
    const w = Math.floor(CONFIG.WORLD.WIDTH * scale);
    const h = Math.floor(CONFIG.WORLD.HEIGHT * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    ctx.save();
    ctx.scale(scale, scale);

    // 0. Raised defensive firing bays (SOVIET_TRENCH_DEFENSE only)
    for (const bay of this.firingBays) {
      ctx.save();
      ctx.translate(bay.x, bay.y);
      ctx.rotate(bay.angle);
      ctx.fillStyle = 'rgba(84, 70, 48, 0.72)';
      ctx.strokeStyle = '#3b3022';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(-bay.radius * 0.75, -bay.radius * 0.65, bay.radius * 1.5, bay.radius * 1.3, 14);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // 1. Excavated outer earth berm & soil apron
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of this.segments) {
      ctx.strokeStyle = 'rgba(78, 61, 40, 0.72)';
      ctx.lineWidth = (s.halfWidth + 16) * 2;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
    }

    // 2. Sloped trench walls & wooden revetment edge
    for (const s of this.segments) {
      ctx.strokeStyle = s.depth === 'deep' ? '#4a3825' : '#57442e';
      ctx.lineWidth = (s.halfWidth + 5) * 2;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
    }

    // 3. Deep interior trench floor + directional shadow strip
    for (const s of this.segments) {
      ctx.strokeStyle = s.depth === 'deep' ? '#261d14' : '#352a1d';
      ctx.lineWidth = (s.halfWidth - 2) * 2;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();

      // Wooden revetment duckboards / side planks along deep segments
      if (s.depth === 'deep') {
        const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
        const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
        const steps = Math.max(2, Math.floor(len / 22));
        ctx.save();
        ctx.translate(s.x1, s.y1);
        ctx.rotate(ang);
        for (let k = 0; k < steps; k++) {
          const px = (k + 0.5) * (len / steps);
          ctx.fillStyle = '#483623';
          ctx.fillRect(px - 6, -s.halfWidth + 3, 12, 3);
          ctx.fillRect(px - 6, s.halfWidth - 6, 12, 3);
          ctx.fillStyle = '#3c2e1e';
          ctx.fillRect(px - 2, -s.halfWidth + 8, 4, (s.halfWidth - 8) * 2);
        }
        ctx.restore();
      }
    }

    // 4. Barbed wire coils
    for (const bw of this.barbedWire) {
      const len = Math.hypot(bw.x2 - bw.x1, bw.y2 - bw.y1);
      const ang = Math.atan2(bw.y2 - bw.y1, bw.x2 - bw.x1);
      const coils = Math.max(4, Math.floor(len / 14));
      ctx.save();
      ctx.translate(bw.x1, bw.y1);
      ctx.rotate(ang);
      ctx.strokeStyle = 'rgba(48, 52, 54, 0.72)';
      ctx.lineWidth = 1.1;
      for (let i = 0; i < coils; i++) {
        const cx = (i + 0.5) * (len / coils);
        ctx.beginPath();
        ctx.arc(cx, 0, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.restore();
    this._staticCanvas = canvas;
  }

  getTrenchStateAt(x, y) {
    let bestSeg = null;
    let bestInfo = null;
    let minDist = Infinity;

    for (const s of this.segments) {
      const info = distPointToSegment(x, y, s.x1, s.y1, s.x2, s.y2);
      if (info.dist < minDist) {
        minDist = info.dist;
        bestSeg = s;
        bestInfo = info;
      }
    }

    if (!bestSeg) {
      return { inTrench: false, onWall: false, segment: null, depth: null, hasRoof: false };
    }

    const inTrench = minDist <= bestSeg.halfWidth - 2;
    const onWall = !inTrench && minDist <= bestSeg.halfWidth + 12;
    const dx = x - bestInfo.projX;
    const dy = y - bestInfo.projY;
    const d = Math.hypot(dx, dy) || 1;

    return {
      inTrench,
      onWall,
      segment: bestSeg,
      depth: bestSeg.depth,
      distToCenter: minDist,
      wallNormalX: dx / d,
      wallNormalY: dy / d,
      hasRoof: Boolean(bestSeg.hasRoof && !bestSeg.roofCollapsed),
    };
  }

  /**
   * Finds nearest accessible trench firing/cover position for AI infantry.
   */
  findNearestTrenchCover(x, y, maxRange = 280) {
    let best = null;
    let bestDist = maxRange;
    for (const s of this.segments) {
      const info = distPointToSegment(x, y, s.x1, s.y1, s.x2, s.y2);
      if (info.dist < bestDist) {
        bestDist = info.dist;
        best = { x: info.projX, y: info.projY, segment: s };
      }
    }
    return best;
  }

  resolveTankInteraction(tank, particles = null) {
    if (!tank) return;
    const scale = CONFIG.TANK.SCALE;
    const halfLen = tank.halfLength || 110 * scale;
    const halfWid = tank.halfWidth || 54 * scale;
    const cos = Math.cos(tank.angle);
    const sin = Math.sin(tank.angle);

    // Sample center + front/rear corners of hull OBB
    const samplePts = [
      { lx: 0, ly: 0 },
      { lx: halfLen * 0.78, ly: halfWid * 0.75 },
      { lx: halfLen * 0.78, ly: -halfWid * 0.75 },
      { lx: -halfLen * 0.78, ly: halfWid * 0.75 },
      { lx: -halfLen * 0.78, ly: -halfWid * 0.75 },
    ];

    for (const sp of samplePts) {
      const wx = tank.x + sp.lx * cos - sp.ly * sin;
      const wy = tank.y + sp.lx * sin + sp.ly * cos;
      const st = this.getTrenchStateAt(wx, wy);
      if (!st.segment) continue;

      if (st.depth === 'deep' && (st.inTrench || st.onWall)) {
        // Push tank back outside deep trench berm
        const pushDist = st.segment.halfWidth + 14 - st.distToCenter;
        if (pushDist > 0) {
          tank.x += st.wallNormalX * pushDist * 0.55;
          tank.y += st.wallNormalY * pushDist * 0.55;
          tank.speed *= 0.72;
          this._disturbNearbySandbags(wx, wy, 28, Math.atan2(st.wallNormalY, st.wallNormalX));
        }
      } else if (st.depth === 'shallow' && (st.inTrench || st.onWall)) {
        // Shallow trench slows tank slightly and scatters soil
        if (Math.abs(tank.speed) > 15) {
          tank.speed *= 0.96;
          this._disturbNearbySandbags(wx, wy, 24, tank.angle);
          if (particles && Math.random() < 0.25) {
            particles.spawnTrackDust(wx, wy, 0, 0, 0.55, false);
          }
        }
      }
    }
  }

  _disturbNearbySandbags(x, y, radius, pushAngle) {
    for (const b of this.sandbags) {
      if (Math.hypot(b.x - x, b.y - y) <= radius) {
        b.x += Math.cos(pushAngle) * (4 + Math.random() * 6);
        b.y += Math.sin(pushAngle) * (4 + Math.random() * 6);
        b.angle += (Math.random() - 0.5) * 0.8;
        b.displaced = true;
      }
    }
  }

  /**
   * Handles 85mm / 50mm cannon impact on trenches:
   * direct hit inside trench, trench wall collapse, near-miss soil scatter, or dugout roof collapse.
   */
  applyArtilleryImpact(x, y, ammoId, particles = null, environment = null) {
    let nearestSeg = null;
    let nearestInfo = null;
    let minDist = Infinity;

    for (const s of this.segments) {
      const info = distPointToSegment(x, y, s.x1, s.y1, s.x2, s.y2);
      if (info.dist < minDist) {
        minDist = info.dist;
        nearestSeg = s;
        nearestInfo = info;
      }
    }

    const isHE = ammoId === 'O365K' || ammoId === 'SPRGR38_50';
    if (!nearestSeg || minDist > nearestSeg.halfWidth + 72) {
      return { hitTrench: false };
    }

    const blastAngle = Math.atan2(y - nearestInfo.projY, x - nearestInfo.projX);
    this._disturbNearbySandbags(x, y, isHE ? 65 : 38, blastAngle);

    if (nearestSeg.hasRoof && !nearestSeg.roofCollapsed && minDist <= nearestSeg.halfWidth + 24) {
      nearestSeg.roofCollapsed = true;
      this.debris.push({ x, y, radius: 18, angle: Math.random() * Math.PI * 2, kind: 'timber' });
    }

    if (minDist <= nearestSeg.halfWidth) {
      // Direct hit inside trench
      const wallR = isHE ? Math.round(18 * TRENCH_COMBAT_CONFIG.HE_EXCAVATION_MULT) : 14;
      this.excavatedSoilTotal += isHE ? 1.3 : 1.0;
      if (this.collapsedWalls.length < 64) {
        this.collapsedWalls.push({ x, y, radius: wallR, angle: Math.random() * Math.PI * 2, inside: true });
      }
      if (isHE && this.debris.length < 48) {
        this.debris.push({ x: x + (Math.random() - 0.5) * 14, y: y + (Math.random() - 0.5) * 14, radius: 12, angle: Math.random() * Math.PI * 2, kind: 'soil' });
      }
      particles?.spawnSoilExplosion?.(x, y, isHE ? 1.45 : 0.9);
      environment?.addShellCrater?.(x, y, isHE ? 92 : 54, isHE);
      return { hitTrench: true, type: 'direct_inside', segment: nearestSeg, excavatedMult: isHE ? TRENCH_COMBAT_CONFIG.HE_EXCAVATION_MULT : 1.0 };
    }

    if (minDist <= nearestSeg.halfWidth + 24) {
      // Impact on trench wall -> localized collapse into trench
      const wallR = isHE ? Math.round(17 * TRENCH_COMBAT_CONFIG.HE_EXCAVATION_MULT) : 14;
      this.excavatedSoilTotal += isHE ? 1.3 : 1.0;
      if (this.collapsedWalls.length < 64) {
        this.collapsedWalls.push({
          x: nearestInfo.projX,
          y: nearestInfo.projY,
          radius: wallR,
          angle: blastAngle,
          inside: false,
        });
      }
      if (isHE && this.debris.length < 48) {
        this.debris.push({ x: nearestInfo.projX, y: nearestInfo.projY, radius: 11, angle: blastAngle, kind: 'soil' });
      }
      particles?.spawnSoilExplosion?.(x, y, isHE ? 1.35 : 0.8);
      environment?.addShellCrater?.(x, y, isHE ? 92 : 54, isHE);
      return { hitTrench: true, type: 'wall_collapse', segment: nearestSeg, excavatedMult: isHE ? TRENCH_COMBAT_CONFIG.HE_EXCAVATION_MULT : 1.0 };
    }

    // Near miss beside trench -> soil & dust scattered into trench
    this.excavatedSoilTotal += isHE ? 0.65 : 0.5;
    particles?.spawnSoilExplosion?.(x, y, isHE ? 1.05 : 0.65);
    return { hitTrench: true, type: 'near_miss', segment: nearestSeg, excavatedMult: isHE ? TRENCH_COMBAT_CONFIG.HE_EXCAVATION_MULT : 1.0 };
  }

  /**
   * Evaluates physical projectile traversal across trench walls, dugout roofs,
   * and open trench rims along swept segment (x1,y1)->(x2,y2).
   * - Tank cannon shells:
   *   1. Direct dugout roof / solid trench wall intersection -> 'wall_hit'
   *   2. Open trench crossing -> configurable probability (30% standard, 45% HE) -> 'trench_detonate' or 'pass_over'
   * - Small-arms bullets:
   *   Blocked by solid dugout roofs or solid deep-trench walls when entering from outside.
   */
  resolveProjectileTraversal(x1, y1, x2, y2, projectile, particles = null, environment = null) {
    if (!projectile) return { outcome: 'clear' };
    projectile.checkedTrenchIds = projectile.checkedTrenchIds || new Set();

    const midX = (x1 + x2) * 0.5;
    const midY = (y1 + y2) * 0.5;
    const prevState = this.getTrenchStateAt(x1, y1);
    const curState = this.getTrenchStateAt(x2, y2);

    // Small-arms bullet collision with solid dugout roofs / deep trench walls
    if (projectile.type === 'mg') {
      if (curState.hasRoof && !prevState.hasRoof) {
        particles?.spawnBulletImpact?.(x2, y2, false);
        return { outcome: 'blocked', x: x2, y: y2 };
      }
      if (!prevState.inTrench && curState.onWall && curState.depth === 'deep') {
        particles?.spawnBulletImpact?.(x2, y2, false);
        return { outcome: 'blocked', x: x2, y: y2 };
      }
      return { outcome: 'clear' };
    }

    // Tank cannon shell traversal
    const seg = curState.segment || prevState.segment;
    if (!seg || projectile.checkedTrenchIds.has(seg.id)) {
      return { outcome: 'clear' };
    }

    // In SOVIET_TRENCH_DEFENSE, cannon shells fired from a raised firing bay clear their own parapet within 280px
    if (this.layoutType === 'soviet_trench_defense' && this.firingBays.length > 0) {
      const sx = projectile.spawnX ?? x1;
      const sy = projectile.spawnY ?? y1;
      const fromBay =
        projectile.fromRaisedPosition ||
        this.firingBays.some((b) => Math.hypot(sx - b.x, sy - b.y) <= b.radius + 75);
      if (fromBay && Math.hypot(x2 - sx, y2 - sy) < 280 && !curState.hasRoof) {
        projectile.checkedTrenchIds.add(seg.id);
        return { outcome: 'pass_over', segment: seg };
      }
    }

    // Dugout roof direct collision
    if (curState.hasRoof || prevState.hasRoof) {
      projectile.checkedTrenchIds.add(seg.id);
      this.applyArtilleryImpact(midX, midY, projectile.ammoId, particles, environment);
      return { outcome: 'wall_hit', x: midX, y: midY, segment: seg };
    }

    // Direct solid trench wall collision (shell enters reinforced deep parapet wall lip from outside)
    if (!prevState.inTrench && curState.onWall && seg.depth === 'deep') {
      projectile.checkedTrenchIds.add(seg.id);
      this.applyArtilleryImpact(x2, y2, projectile.ammoId, particles, environment);
      return { outcome: 'wall_hit', x: x2, y: y2, segment: seg };
    }

    // Open trench crossing: evaluate centralized interaction probability once per segment
    if (curState.inTrench || prevState.inTrench) {
      projectile.checkedTrenchIds.add(seg.id);
      const isHE = projectile.ammoId === 'O365K' || projectile.ammoId === 'SPRGR38_50';
      const prob = isHE
        ? TRENCH_COMBAT_CONFIG.HE_SHELL_INTERACTION_PROB
        : TRENCH_COMBAT_CONFIG.STANDARD_SHELL_INTERACTION_PROB;
      if (Math.random() < prob) {
        this.applyArtilleryImpact(midX, midY, projectile.ammoId, particles, environment);
        return { outcome: 'trench_detonate', x: midX, y: midY, segment: seg };
      }
      return { outcome: 'pass_over', segment: seg };
    }

    return { outcome: 'clear' };
  }

  /**
   * Returns blast damage multiplier for a soldier based on trench geometry & overhead cover.
   */
  getBlastProtectionMultiplier(soldierX, soldierY, blastX, blastY) {
    const sInfo = this.getTrenchStateAt(soldierX, soldierY);
    if (!sInfo.inTrench) return 1.0;

    const bInfo = this.getTrenchStateAt(blastX, blastY);
    if (bInfo.inTrench && bInfo.segment && sInfo.segment && bInfo.segment.id === sInfo.segment.id) {
      return 1.15; // Blast inside the same trench is confined and lethal
    }
    if (sInfo.hasRoof) return 0.22;
    return sInfo.depth === 'deep' ? 0.35 : 0.55;
  }

  renderGround(ctx, viewBounds = null) {
    if (this._staticCanvas) {
      ctx.drawImage(this._staticCanvas, 0, 0, CONFIG.WORLD.WIDTH, CONFIG.WORLD.HEIGHT);
    }

    // Dynamic collapsed walls & soil spills
    for (const cw of this.collapsedWalls) {
      if (
        viewBounds &&
        (cw.x + 40 < viewBounds.minX || cw.x - 40 > viewBounds.maxX || cw.y + 40 < viewBounds.minY || cw.y - 40 > viewBounds.maxY)
      ) {
        continue;
      }
      ctx.save();
      ctx.translate(cw.x, cw.y);
      ctx.rotate(cw.angle);
      ctx.fillStyle = 'rgba(72, 56, 36, 0.86)';
      ctx.beginPath();
      ctx.ellipse(0, 0, cw.radius, cw.radius * 0.76, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(34, 26, 18, 0.72)';
      ctx.beginPath();
      ctx.ellipse(2, 1, cw.radius * 0.52, cw.radius * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Sandbags (intact & displaced)
    for (const b of this.sandbags) {
      if (
        viewBounds &&
        (b.x + 20 < viewBounds.minX || b.x - 20 > viewBounds.maxX || b.y + 20 < viewBounds.minY || b.y - 20 > viewBounds.maxY)
      ) {
        continue;
      }
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);
      ctx.fillStyle = b.displaced ? '#8a7a5c' : '#9c8b68';
      ctx.strokeStyle = '#3b3324';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.roundRect(-6, -3.2, 12, 6.4, 2.2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  renderOverhead(ctx, viewBounds = null) {
    for (const s of this.segments) {
      if (!s.hasRoof) continue;
      const mx = (s.x1 + s.x2) * 0.5;
      const my = (s.y1 + s.y2) * 0.5;
      if (
        viewBounds &&
        (mx + 80 < viewBounds.minX || mx - 80 > viewBounds.maxX || my + 80 < viewBounds.minY || my - 80 > viewBounds.maxY)
      ) {
        continue;
      }
      const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(ang);
      if (s.roofCollapsed) {
        // Broken/collapsed dugout roof timbers
        ctx.fillStyle = 'rgba(66, 48, 30, 0.82)';
        ctx.fillRect(-len * 0.45, -s.halfWidth * 0.7, len * 0.35, 6);
        ctx.fillRect(len * 0.05, s.halfWidth * 0.2, len * 0.35, 6);
      } else {
        // Intact timber log + earth dugout roof
        ctx.fillStyle = '#4e3b26';
        ctx.strokeStyle = '#241a0e';
        ctx.lineWidth = 1.2;
        ctx.fillRect(-len * 0.52, -s.halfWidth, len * 1.04, s.halfWidth * 2);
        ctx.strokeRect(-len * 0.52, -s.halfWidth, len * 1.04, s.halfWidth * 2);
        ctx.fillStyle = 'rgba(84, 72, 46, 0.48)';
        ctx.fillRect(-len * 0.44, -s.halfWidth * 0.75, len * 0.88, s.halfWidth * 1.5);
      }
      ctx.restore();
    }
  }
}
