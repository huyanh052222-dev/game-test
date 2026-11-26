/**
 * Cached High-Detail WWII Armor & Weathering Overlays
 * - Pre-renders intricate hull & turret details once to 2x-resolution offscreen
 *   canvases so per-frame Tank/Panzer III rendering stays fast with zero allocations.
 * - Strictly preserves existing vehicle dimensions, pivots, hitboxes, and X-Ray alignment.
 */

const _cache = new Map();

function createHiResCanvas(w, h, scale = 2) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  return { canvas: c, ctx };
}

/**
 * T-34-85 Model 1944 Hull Surface & Component Overlay (local coords: -108..-53 -> 216x106)
 */
export function getT34HullDetailCanvas() {
  if (_cache.has('t34_hull')) return _cache.get('t34_hull');
  const W = 220;
  const H = 112;
  const { canvas, ctx } = createHiResCanvas(W, H, 2);
  ctx.translate(110, 56);

  // 1. Sloped 45mm front glacis bevel, plate boundaries & weld seams
  ctx.strokeStyle = 'rgba(20, 26, 16, 0.55)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(52, -37);
  ctx.lineTo(52, 37);
  ctx.moveTo(96, -37);
  ctx.lineTo(96, 37);
  ctx.moveTo(-42, -37);
  ctx.lineTo(-42, 37);
  ctx.stroke();

  // Weld seam highlight along glacis & turret ring surround
  ctx.strokeStyle = 'rgba(155, 174, 128, 0.28)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(53, -36);
  ctx.lineTo(53, 36);
  ctx.moveTo(-41, -36);
  ctx.lineTo(-41, 36);
  ctx.stroke();

  // 2. Spare track links & tow hooks on front glacis
  ctx.fillStyle = '#383d33';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(82, -26 + i * 7, 9, 5);
    ctx.strokeStyle = 'rgba(18, 22, 16, 0.7)';
    ctx.lineWidth = 0.6;
    ctx.strokeRect(82, -26 + i * 7, 9, 5);
  }
  // Front & rear tow hooks
  ctx.fillStyle = '#484f40';
  for (const [tx, ty] of [[101, -30], [101, 26], [-104, -30], [-104, 26]]) {
    ctx.fillRect(tx, ty, 5, 4);
    ctx.strokeStyle = 'rgba(15, 18, 13, 0.8)';
    ctx.strokeRect(tx, ty, 5, 4);
  }

  // 3. Driver's armored hatch (front-left glacis) with dual periscopes & hinges
  ctx.fillStyle = 'rgba(72, 86, 56, 0.85)';
  ctx.strokeStyle = 'rgba(18, 24, 15, 0.75)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(58, -28, 20, 22, 2);
  ctx.fill();
  ctx.stroke();
  // Edge wear on hatch lip
  ctx.strokeStyle = 'rgba(176, 184, 164, 0.32)';
  ctx.lineWidth = 0.7;
  ctx.strokeRect(59, -27, 18, 20);
  // Dual vision slots
  ctx.fillStyle = '#181d15';
  ctx.fillRect(72, -24, 4, 5);
  ctx.fillRect(72, -15, 4, 5);

  // 4. Bow DT MG armored ball mount collar (front-right glacis)
  ctx.fillStyle = '#4c5740';
  ctx.beginPath();
  ctx.arc(79, 16, 7.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(18, 22, 16, 0.8)';
  ctx.lineWidth = 0.9;
  ctx.stroke();

  // 5. Front mudguard fenders with stamped stiffening ribs & edge chipping
  for (const fy of [-51, 39]) {
    ctx.fillStyle = 'rgba(74, 86, 60, 0.55)';
    ctx.fillRect(88, fy, 17, 12);
    ctx.strokeStyle = 'rgba(22, 26, 18, 0.7)';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(88, fy, 17, 12);
    ctx.fillStyle = 'rgba(148, 154, 140, 0.25)';
    ctx.fillRect(102, fy + 1, 2.5, 10);
  }

  // 6. Engine deck ventilation grilles, radiator fan ring & rear access hatches
  // Central V-2-34 engine grille
  ctx.fillStyle = '#1d2219';
  ctx.fillRect(-76, -24, 30, 48);
  ctx.strokeStyle = 'rgba(92, 106, 76, 0.65)';
  ctx.lineWidth = 1.1;
  for (let gx = -73; gx <= -49; gx += 4.5) {
    ctx.beginPath();
    ctx.moveTo(gx, -23);
    ctx.lineTo(gx, 23);
    ctx.stroke();
  }
  // Circular radiator fan cover with radial bolts
  ctx.fillStyle = 'rgba(68, 82, 54, 0.9)';
  ctx.beginPath();
  ctx.arc(-61, 0, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(18, 22, 16, 0.8)';
  ctx.stroke();
  ctx.fillStyle = 'rgba(165, 176, 152, 0.4)';
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(-61 + Math.cos(ang) * 9, Math.sin(ang) * 9, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }

  // Rear transmission access panel & twin exhaust mufflers with soot
  ctx.fillStyle = 'rgba(66, 79, 52, 0.85)';
  ctx.strokeStyle = 'rgba(20, 24, 16, 0.75)';
  ctx.fillRect(-98, -22, 17, 44);
  ctx.strokeRect(-98, -22, 17, 44);

  for (const ey of [-21, 14]) {
    // Exhaust soot plume
    const sg = ctx.createRadialGradient(-101, ey + 3, 1, -101, ey + 3, 12);
    sg.addColorStop(0, 'rgba(18, 16, 14, 0.62)');
    sg.addColorStop(1, 'rgba(18, 16, 14, 0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(-101, ey + 3, 12, 0, Math.PI * 2);
    ctx.fill();

    // Exhaust pipe & bracket
    ctx.fillStyle = '#3f3832';
    ctx.fillRect(-105, ey, 8, 6);
    ctx.strokeStyle = 'rgba(18, 14, 12, 0.85)';
    ctx.strokeRect(-105, ey, 8, 6);
  }

  // 7. External cylindrical rear-side fuel drums (2x per side, iconic 1944 T-34-85)
  for (const sideY of [-42, 33]) {
    for (const fx of [-84, -56]) {
      ctx.fillStyle = '#4e5d3f';
      ctx.strokeStyle = 'rgba(18, 22, 15, 0.85)';
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      ctx.roundRect(fx, sideY, 22, 9, 3);
      ctx.fill();
      ctx.stroke();
      // Highlight along top cylinder ridge + straps
      ctx.fillStyle = 'rgba(164, 182, 136, 0.28)';
      ctx.fillRect(fx + 2, sideY + 1.5, 18, 2);
      ctx.fillStyle = '#24291f';
      ctx.fillRect(fx + 5, sideY, 2, 9);
      ctx.fillRect(fx + 15, sideY, 2, 9);
    }
  }

  // 8. Subtle localized edge wear & grab handles
  ctx.strokeStyle = 'rgba(168, 176, 156, 0.35)';
  ctx.lineWidth = 1.0;
  for (const hy of [-35, 35]) {
    ctx.beginPath();
    ctx.moveTo(28, hy);
    ctx.lineTo(42, hy);
    ctx.stroke();
  }

  const entry = { canvas, ox: -110, oy: -56 };
  _cache.set('t34_hull', entry);
  return entry;
}

/**
 * T-34-85 Model 1944 Cast Turret & 85mm ZiS-S-53 Detail Overlay
 */
export function getT34TurretDetailCanvas() {
  if (_cache.has('t34_turret')) return _cache.get('t34_turret');
  const W = 120;
  const H = 90;
  const { canvas, ctx } = createHiResCanvas(W, H, 2);
  ctx.translate(60, 45);

  // 1. Cast-steel rim shading & subtle stippled cast texture
  ctx.strokeStyle = 'rgba(174, 192, 146, 0.24)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.ellipse(-2, 0, 35, 27, 0, -Math.PI * 0.65, Math.PI * 0.45);
  ctx.stroke();

  // Subtle deterministic cast-steel micro-pitting on turret cheeks
  ctx.fillStyle = 'rgba(22, 28, 18, 0.16)';
  for (let i = 0; i < 36; i++) {
    const px = -28 + ((i * 37) % 52);
    const py = -20 + ((i * 23) % 40);
    if ((px * px) / (34 * 34) + (py * py) / (25 * 25) < 0.78) {
      ctx.fillRect(px, py, 1.4, 1.4);
    }
  }

  // 2. Commander's Cupola (left-rear) with 5 vision slits & split hatch hinges
  ctx.fillStyle = '#536243';
  ctx.strokeStyle = 'rgba(18, 22, 15, 0.85)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(-13, -12, 10.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 5 observation periscope ports
  ctx.fillStyle = '#181d15';
  for (let i = 0; i < 5; i++) {
    const a = -0.9 + i * 0.45;
    ctx.save();
    ctx.translate(-13 + Math.cos(a) * 8.5, -12 + Math.sin(a) * 8.5);
    ctx.rotate(a);
    ctx.fillRect(-1.2, -2, 2.4, 4);
    ctx.restore();
  }
  // Cupola inner hatch highlight
  ctx.strokeStyle = 'rgba(166, 184, 140, 0.3)';
  ctx.beginPath();
  ctx.arc(-13, -12, 6.2, 0, Math.PI * 2);
  ctx.stroke();

  // 3. Loader's Hatch (right-rear) with handle & hinge
  ctx.fillStyle = '#505f40';
  ctx.strokeStyle = 'rgba(18, 22, 15, 0.85)';
  ctx.beginPath();
  ctx.ellipse(-10, 12, 8.5, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(164, 178, 144, 0.4)';
  ctx.fillRect(-12, 11, 5, 1.6);

  // 4. Twin roof mushroom ventilator domes & gunner TSh-16 periscope hood
  for (const [vx, vy] of [[7, -11], [6, 11]]) {
    ctx.fillStyle = '#5c6c4a';
    ctx.beginPath();
    ctx.arc(vx, vy, 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(18, 22, 15, 0.8)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  // Gunner sight housing
  ctx.fillStyle = '#38422e';
  ctx.fillRect(15, -13, 6, 4.5);

  // 5. Turret lifting eyes & side grab rails
  ctx.strokeStyle = 'rgba(154, 168, 134, 0.45)';
  ctx.lineWidth = 1.1;
  for (const ry of [-26, 26]) {
    ctx.beginPath();
    ctx.moveTo(-20, ry);
    ctx.lineTo(2, ry);
    ctx.stroke();
  }

  // 6. Mantlet armor collar bolts & edge wear
  ctx.fillStyle = '#47543a';
  ctx.beginPath();
  ctx.roundRect(24, -13, 10, 26, 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(18, 22, 15, 0.8)';
  ctx.stroke();

  const entry = { canvas, ox: -60, oy: -45 };
  _cache.set('t34_turret', entry);
  return entry;
}

/**
 * Panzer III Ausf. L (5cm KwK 39 L/60) Hull Detail Overlay (200x106 footprint)
 */
export function getPanzer3HullDetailCanvas() {
  if (_cache.has('pz3_hull')) return _cache.get('pz3_hull');
  const W = 208;
  const H = 114;
  const { canvas, ctx } = createHiResCanvas(W, H, 2);
  ctx.translate(104, 57);

  // 1. 50mm + 20mm Spaced Front Armor (Vorpanzer) & Transmission Access Hatches
  ctx.strokeStyle = 'rgba(20, 22, 26, 0.65)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(46, -36);
  ctx.lineTo(46, 36);
  ctx.moveTo(82, -36);
  ctx.lineTo(82, 36);
  ctx.stroke();

  // Spaced armor mounting bolts along bow plate
  ctx.fillStyle = 'rgba(170, 178, 186, 0.45)';
  for (let y = -30; y <= 30; y += 15) {
    ctx.beginPath();
    ctx.arc(86, y, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }

  // 2. Driver's armored visor (left) & Radio Op MG34 ball mount (right)
  ctx.fillStyle = '#383d42';
  ctx.strokeStyle = 'rgba(15, 17, 20, 0.85)';
  ctx.fillRect(58, -28, 14, 10);
  ctx.strokeRect(58, -28, 14, 10);
  ctx.fillStyle = '#15181c';
  ctx.fillRect(67, -25, 4, 4); // Driver slit

  // Bow MG 34 Kugelblende mount
  ctx.fillStyle = '#484f56';
  ctx.beginPath();
  ctx.arc(68, 20, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#25292d';
  ctx.fillRect(72, 18.8, 12, 2.4);

  // 3. Notek blackout headlight (front-left fender) & fender tool mounts (jack/crowbar)
  ctx.fillStyle = '#31363b';
  ctx.beginPath();
  ctx.arc(87, -42, 3.2, 0, Math.PI * 2);
  ctx.fill();
  // Fender tools (jack & cleaning rods)
  ctx.fillStyle = '#4c463d';
  ctx.fillRect(-20, -48, 32, 3);
  ctx.fillRect(-15, 45, 28, 2.6);

  // 4. Panzer III Engine Deck: twin louvers + side armored air intakes
  ctx.fillStyle = '#1e2124';
  ctx.fillRect(-74, -27, 36, 20);
  ctx.fillRect(-74, 7, 36, 20);
  ctx.strokeStyle = 'rgba(98, 104, 110, 0.65)';
  ctx.lineWidth = 1;
  for (let gx = -71; gx <= -41; gx += 4.5) {
    ctx.beginPath();
    ctx.moveTo(gx, -26);
    ctx.lineTo(gx, -8);
    ctx.moveTo(gx, 8);
    ctx.lineTo(gx, 26);
    ctx.stroke();
  }
  // Twin engine hatches
  ctx.strokeStyle = 'rgba(18, 20, 22, 0.75)';
  ctx.strokeRect(-77, -30, 42, 60);

  // 5. Rear exhaust muffler & soot weathering
  for (const ey of [-22, 16]) {
    const sg = ctx.createRadialGradient(-94, ey + 3, 1, -94, ey + 3, 10);
    sg.addColorStop(0, 'rgba(14, 14, 14, 0.58)');
    sg.addColorStop(1, 'rgba(14, 14, 14, 0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(-94, ey + 3, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#3b3733';
    ctx.fillRect(-97, ey, 7, 5.5);
    ctx.strokeRect(-97, ey, 7, 5.5);
  }

  // 6. Front & rear tow shackles + edge metallic highlights
  ctx.fillStyle = '#4a5056';
  for (const [tx, ty] of [[92, -29], [92, 25], [-96, -29], [-96, 25]]) {
    ctx.fillRect(tx, ty, 5, 4);
  }

  const entry = { canvas, ox: -104, oy: -57 };
  _cache.set('pz3_hull', entry);
  return entry;
}

/**
 * Panzer III Ausf. L Turret Detail Overlay (centered around turret pivot at +8, 0)
 */
export function getPanzer3TurretDetailCanvas() {
  if (_cache.has('pz3_turret')) return _cache.get('pz3_turret');
  const W = 136;
  const H = 84;
  const { canvas, ctx } = createHiResCanvas(W, H, 2);
  ctx.translate(54, 42);

  // 1. Turret roof armor bevels & weld lines
  ctx.strokeStyle = 'rgba(170, 178, 186, 0.25)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-22, -21);
  ctx.lineTo(18, -17);
  ctx.lineTo(18, 17);
  ctx.lineTo(-22, 21);
  ctx.stroke();

  // 2. Cylindrical Commander's Cupola (rear) with 5 vision slits & split hatch
  ctx.fillStyle = '#535a61';
  ctx.strokeStyle = 'rgba(16, 18, 22, 0.85)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(-16, 0, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#14171a';
  for (let i = 0; i < 5; i++) {
    const a = -0.8 + i * 0.4;
    ctx.save();
    ctx.translate(-16 + Math.cos(a) * 8, Math.sin(a) * 8);
    ctx.rotate(a);
    ctx.fillRect(-1.1, -1.8, 2.2, 3.6);
    ctx.restore();
  }

  // 3. Rear Turret Stowage Bin (Rommelkiste)
  ctx.fillStyle = '#4a5056';
  ctx.strokeStyle = 'rgba(16, 18, 22, 0.85)';
  ctx.beginPath();
  ctx.roundRect(-36, -15, 11, 30, 1.5);
  ctx.fill();
  ctx.stroke();

  // 4. Spaced 20mm front turret mantlet (Ausf. L) + 5cm KwK 39 L/60 & Coax MG34
  ctx.fillStyle = '#464d54';
  ctx.fillRect(21, -14, 7, 28);
  ctx.strokeRect(21, -14, 7, 28);
  // Coax MG 34 barrel tip
  ctx.fillStyle = '#25292d';
  ctx.fillRect(28, 5, 14, 2.2);

  const entry = { canvas, ox: -54, oy: -42 };
  _cache.set('pz3_turret', entry);
  return entry;
}

/**
 * Shared detailed track tread renderer for both T-34-85 and Panzer III Ausf. L
 */
export function renderDetailedTrackTreads(ctx, yCenter, phase, { xStart, xEnd, linkStep = 5.2, isGerman = false, showMicro = true }) {
  const p = ((phase % linkStep) + linkStep) % linkStep;
  const halfW = isGerman ? 6.8 : 7.6;

  // Exposed front & rear track runs
  for (let x = xStart + p; x <= xEnd; x += linkStep) {
    // Track plate shadow & metallic face
    ctx.fillStyle = isGerman ? '#36393d' : '#3a3e36';
    ctx.fillRect(x - 1.6, yCenter - halfW, 3.2, halfW * 2);

    ctx.strokeStyle = isGerman ? '#595e64' : '#5e6457';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(x, yCenter - halfW);
    ctx.lineTo(x, yCenter + halfW);
    ctx.stroke();

    if (showMicro) {
      // Center guide horn & track pin heads
      ctx.fillStyle = isGerman ? '#72787e' : '#747a6c';
      ctx.fillRect(x - 0.7, yCenter - 1.4, 1.4, 2.8);
      ctx.fillRect(x - 0.5, yCenter - halfW - 0.6, 1.0, 1.2);
      ctx.fillRect(x - 0.5, yCenter + halfW - 0.6, 1.0, 1.2);
    }
  }
}
