/**
 * T-34-85 Internal Module Inspection Mode (War Thunder-inspired X-ray view).
 * Renders all 5 crew positions, V-2-34 diesel engine, transmission/final drives,
 * 85mm gun breech + recoil assembly, coaxial & hull DT MGs, and ammunition racks
 * in their true hull-local and turret-local coordinate systems.
 */
import { CONFIG } from './config.js';
import { getModuleStateColor } from './combat/moduleDamage.js';
import { MODULE_STATE } from './combat/armorData.js';

const COLOR = {
  FILL: 'rgba(37, 133, 232, 0.42)',
  FILL_STRONG: 'rgba(37, 133, 232, 0.65)',
  DARK: 'rgba(15, 58, 112, 0.85)',
  STROKE: '#7cc4ff',
  CREW_FILL: 'rgba(56, 155, 255, 0.62)',
  CREW_STROKE: '#b5e0ff',
  LABEL_BG: 'rgba(10, 18, 28, 0.78)',
  LABEL_TEXT: '#bfe3ff',
};

function drawCrewSilhouette(ctx, x, y, facingAngle = 0, state = MODULE_STATE.NORMAL) {
  const c = getModuleStateColor(state);
  const isDead = state === MODULE_STATE.DESTROYED;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(facingAngle + (isDead ? 0.45 : 0));
  if (isDead) ctx.scale(1.12, 0.88);

  // Shoulders / torso
  ctx.fillStyle = c.fill;
  ctx.strokeStyle = c.stroke;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.ellipse(0, 0, 5.5, 8.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Tanker helmet / head (slumped slightly if DEAD)
  ctx.fillStyle = state === MODULE_STATE.NORMAL ? COLOR.DARK : c.fill;
  ctx.beginPath();
  ctx.arc(isDead ? -1.2 : 1.5, isDead ? 1.5 : 0, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function drawShellSilhouette(ctx, x, y, angle = 0, state = MODULE_STATE.NORMAL) {
  const c = getModuleStateColor(state);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = c.fill;
  ctx.strokeStyle = c.stroke;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(6.5, 0);
  ctx.lineTo(1.5, -1.7);
  ctx.lineTo(-6.5, -1.7);
  ctx.lineTo(-6.5, 1.7);
  ctx.lineTo(1.5, 1.7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function renderHullInternals(ctx, tank) {
  const scale = CONFIG.TANK.SCALE;
  const ds = tank.damageSystem;
  const st = (id) => (ds ? ds.getState(id) : MODULE_STATE.NORMAL);
  const engC = getModuleStateColor(st('ENGINE'));
  const trnC = getModuleStateColor(st('TRANSMISSION'));
  const lTrkC = getModuleStateColor(st('LEFT_TRACK'));
  const rTrkC = getModuleStateColor(st('RIGHT_TRACK'));
  const drvVisC = getModuleStateColor(st('DRIVER_VISION'));

  ctx.save();
  ctx.translate(tank.x, tank.y);
  ctx.rotate(tank.angle);
  ctx.scale(scale, scale);

  // 0. Left & Right Track X-Ray bands
  ctx.fillStyle = lTrkC.fill;
  ctx.strokeStyle = lTrkC.stroke;
  ctx.lineWidth = 1.0;
  ctx.fillRect(-106, -52, 212, 10);
  ctx.strokeRect(-106, -52, 212, 10);

  ctx.fillStyle = rTrkC.fill;
  ctx.strokeStyle = rTrkC.stroke;
  ctx.fillRect(-106, 42, 212, 10);
  ctx.strokeRect(-106, 42, 212, 10);

  // 1. V-2-34 V12 Diesel Engine (Rear-center hull, x: -74..-34)
  ctx.fillStyle = engC.fill;
  ctx.strokeStyle = engC.stroke;
  ctx.lineWidth = 1.2;
  ctx.fillRect(-74, -15, 38, 30);
  ctx.strokeRect(-74, -15, 38, 30);

  // V12 Cylinder banks & central block
  ctx.fillStyle = st('ENGINE') === MODULE_STATE.NORMAL ? COLOR.DARK : engC.fill;
  ctx.fillRect(-71, -12, 32, 8);
  ctx.fillRect(-71, 4, 32, 8);
  ctx.strokeStyle = engC.stroke;
  ctx.lineWidth = 0.8;
  for (let cx = -67; cx <= -43; cx += 6) {
    ctx.strokeRect(cx, -11, 4, 6);
    ctx.strokeRect(cx, 5, 4, 6);
  }

  // 2. Transmission, Gearbox & Final Drives (Rearmost hull, x: -104..-76)
  ctx.fillStyle = trnC.fill;
  ctx.strokeStyle = trnC.stroke;
  ctx.lineWidth = 1.2;
  ctx.fillRect(-98, -17, 20, 34);
  ctx.strokeRect(-98, -17, 20, 34);

  // Drive coupling & left/right final drive axles to rear drive sprockets
  ctx.fillStyle = st('TRANSMISSION') === MODULE_STATE.NORMAL ? COLOR.DARK : trnC.fill;
  ctx.fillRect(-78, -5, 5, 10);
  ctx.strokeStyle = trnC.stroke;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-92, -17);
  ctx.lineTo(-92, -45);
  ctx.moveTo(-92, 17);
  ctx.lineTo(-92, 45);
  ctx.stroke();
  // Final drive housings at sprockets
  ctx.fillStyle = trnC.fill;
  ctx.fillRect(-97, -48, 10, 7);
  ctx.strokeRect(-97, -48, 10, 7);
  ctx.fillRect(-97, 41, 10, 7);
  ctx.strokeRect(-97, 41, 10, 7);

  // 3. Hull Floor & Sponson 85mm Ammunition Racks
  const ammoFloorSt = st('AMMO_FLOOR');
  const ammoLSt = st('AMMO_SPONSON_L');
  const ammoRSt = st('AMMO_SPONSON_R');
  for (let sy = -10; sy <= 10; sy += 5) {
    drawShellSilhouette(ctx, -4, sy, 0, ammoFloorSt);
  }
  for (let sx = -4; sx <= 24; sx += 14) {
    drawShellSilhouette(ctx, sx, -27, 0, ammoLSt);
    drawShellSilhouette(ctx, sx, 27, 0, ammoRSt);
  }

  // 4. Front Hull Crew: Driver (-Y left) & Radio Operator (+Y right) + Driver Vision
  const isBailed = (id) => Boolean(ds && ds.getModule(id)?.bailedOut);
  const outsideId =
    tank.trackRepair && tank.trackRepair.isActive && tank.trackRepair.crewEmergence > 0.5
      ? tank.trackRepair.assignedCrewId
      : null;
  if (outsideId !== 'DRIVER' && !isBailed('DRIVER')) drawCrewSilhouette(ctx, 68, -16, 0, st('DRIVER'));
  if (outsideId !== 'RADIO_OP' && !isBailed('RADIO_OP')) drawCrewSilhouette(ctx, 68, 16, 0, st('RADIO_OP'));

  // Driver vision periscope block
  ctx.fillStyle = drvVisC.fill;
  ctx.strokeStyle = drvVisC.stroke;
  ctx.lineWidth = 0.9;
  ctx.fillRect(82, -21, 7, 10);
  ctx.strokeRect(82, -21, 7, 10);

  // 5. Hull-mounted 7.62mm DT Machine Gun (+82, +16)
  ctx.fillStyle = COLOR.FILL_STRONG;
  ctx.strokeStyle = COLOR.STROKE;
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.arc(82, 16, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Receiver & pan magazine inside glacis
  ctx.fillRect(72, 14, 12, 4);
  ctx.strokeRect(72, 14, 12, 4);
  ctx.beginPath();
  ctx.arc(76, 16, 3.2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

export function renderTurretInternals(ctx, pivot, turret, damageSystem = null) {
  const scale = CONFIG.TANK.SCALE;
  const recoil = turret.mainGun.recoilOffset;
  const st = (id) => (damageSystem ? damageSystem.getState(id) : MODULE_STATE.NORMAL);
  const barrelC = getModuleStateColor(st('GUN_BARREL'));
  const gOptC = getModuleStateColor(st('GUNNER_OPTICS'));
  const cOptC = getModuleStateColor(st('COMMANDER_OPTICS'));
  const ammoTurretSt = st('AMMO_TURRET');

  ctx.save();
  ctx.translate(pivot.x, pivot.y);
  ctx.rotate(turret.worldAngle);
  ctx.scale(scale, scale);

  // 1. Turret Ring & Interior Working Space
  ctx.strokeStyle = 'rgba(124, 196, 255, 0.55)';
  ctx.lineWidth = 1.4;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.arc(0, 0, 31, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // 2. Turret Rear Bustle Ready-Rack 85mm Ammunition
  for (let ry = -14; ry <= 14; ry += 7) {
    drawShellSilhouette(ctx, -30, ry, 0, ammoTurretSt);
  }

  // 3. 85mm Main Gun Breech, Recoil Cradle & Barrel (moves with recoilOffset!)
  ctx.save();
  ctx.translate(-recoil, 0);

  // External 85mm barrel X-ray overlay
  ctx.fillStyle = barrelC.fill;
  ctx.strokeStyle = barrelC.stroke;
  ctx.lineWidth = 0.9;
  ctx.fillRect(52, -3.0, 86, 6.0);
  ctx.strokeRect(52, -3.0, 86, 6.0);

  // Gun mounting / mantlet cradle
  ctx.fillStyle = st('GUN_BARREL') === MODULE_STATE.NORMAL ? COLOR.DARK : barrelC.fill;
  ctx.strokeStyle = barrelC.stroke;
  ctx.lineWidth = 1.0;
  ctx.fillRect(28, -9, 20, 18);
  ctx.strokeRect(28, -9, 20, 18);

  // Internal barrel section through mantlet
  ctx.fillStyle = barrelC.fill;
  ctx.fillRect(14, -3.6, 38, 7.2);
  ctx.strokeRect(14, -3.6, 38, 7.2);

  // Twin hydraulic recoil & recuperator cylinders
  ctx.fillStyle = COLOR.DARK;
  ctx.fillRect(12, -8, 18, 3.5);
  ctx.strokeRect(12, -8, 18, 3.5);
  ctx.fillRect(12, 4.5, 18, 3.5);
  ctx.strokeRect(12, 4.5, 18, 3.5);

  // Heavy 85mm vertical-wedge breech block
  ctx.fillStyle = barrelC.fill;
  ctx.fillRect(-4, -7, 18, 14);
  ctx.strokeRect(-4, -7, 18, 14);
  ctx.strokeRect(0, -4.5, 10, 9);

  ctx.restore();

  // 4. Coaxial 7.62mm DT Machine Gun (RIGHT +Y side at y = +11, fixed to mantlet)
  const cy = CONFIG.TURRET.COAX_OFFSET_Y;
  ctx.fillStyle = COLOR.FILL_STRONG;
  ctx.strokeStyle = COLOR.STROKE;
  ctx.lineWidth = 0.9;
  ctx.fillRect(22, cy - 2, 28, 4);
  ctx.strokeRect(22, cy - 2, 28, 4);
  // DT pan magazine on coaxial receiver
  ctx.beginPath();
  ctx.arc(27, cy, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 4b. Gunner Optics & Commander Cupola Optics
  ctx.fillStyle = gOptC.fill;
  ctx.strokeStyle = gOptC.stroke;
  ctx.fillRect(22, -20, 7, 5);
  ctx.strokeRect(22, -20, 7, 5);

  ctx.fillStyle = cOptC.fill;
  ctx.strokeStyle = cOptC.stroke;
  ctx.beginPath();
  ctx.arc(-14, -20, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 5. Turret Crew (3 positions: Gunner, Commander, Loader)
  const isBailed = (id) => Boolean(damageSystem && damageSystem.getModule(id)?.bailedOut);
  if (!isBailed('GUNNER')) drawCrewSilhouette(ctx, 10, -19, 0, st('GUNNER'));
  if (!isBailed('COMMANDER')) drawCrewSilhouette(ctx, -12, -20, 0, st('COMMANDER'));
  if (!isBailed('LOADER')) drawCrewSilhouette(ctx, -4, 21, -Math.PI / 2, st('LOADER'));

  ctx.restore();
}

function toWorld(originX, originY, angle, lx, ly, scale) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: originX + (lx * cos - ly * sin) * scale,
    y: originY + (lx * sin + ly * cos) * scale,
  };
}

function drawWorldLabel(ctx, pos, text) {
  ctx.font = '700 9px "JetBrains Mono", "SF Mono", monospace';
  const padX = 4;
  const w = ctx.measureText(text).width + padX * 2;
  const h = 13;

  ctx.fillStyle = COLOR.LABEL_BG;
  ctx.strokeStyle = 'rgba(124, 196, 255, 0.55)';
  ctx.lineWidth = 0.8;
  ctx.fillRect(pos.x - w / 2, pos.y - h / 2, w, h);
  ctx.strokeRect(pos.x - w / 2, pos.y - h / 2, w, h);

  ctx.fillStyle = COLOR.LABEL_TEXT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pos.x, pos.y + 0.5);
}

export function renderInspectionLabels(ctx, tank) {
  const scale = CONFIG.TANK.SCALE;
  const pivot = tank.getTurretPivot();
  const ta = tank.turret.worldAngle;
  const ha = tank.angle;

  ctx.save();

  // Hull-attached labels
  drawWorldLabel(ctx, toWorld(tank.x, tank.y, ha, -55, 0, scale), 'ENGINE');
  drawWorldLabel(ctx, toWorld(tank.x, tank.y, ha, -92, 0, scale), 'TRANSMISSION');
  drawWorldLabel(ctx, toWorld(tank.x, tank.y, ha, 72, -32, scale), 'DRIVER');
  drawWorldLabel(ctx, toWorld(tank.x, tank.y, ha, 72, 32, scale), 'RADIO OP');
  drawWorldLabel(ctx, toWorld(tank.x, tank.y, ha, 94, 22, scale), 'HULL MG');
  drawWorldLabel(ctx, toWorld(tank.x, tank.y, ha, 10, -34, scale), 'AMMO RACK');

  // Turret-attached labels
  drawWorldLabel(ctx, toWorld(pivot.x, pivot.y, ta, 6, 0, scale), 'MAIN GUN');
  drawWorldLabel(ctx, toWorld(pivot.x, pivot.y, ta, 42, 19, scale), 'COAXIAL MG');
  drawWorldLabel(ctx, toWorld(pivot.x, pivot.y, ta, 14, -30, scale), 'GUNNER');
  drawWorldLabel(ctx, toWorld(pivot.x, pivot.y, ta, -16, -32, scale), 'COMMANDER');
  drawWorldLabel(ctx, toWorld(pivot.x, pivot.y, ta, -8, 33, scale), 'LOADER');

  ctx.restore();
}

/**
 * Historical Panzer III (Ausf. L provisional) X-Ray internal module visualization:
 * - Front ZF SSG 77 transmission & final drives + central driveshaft
 * - Rear Maybach HL 120 TRM V12 engine + cooling radiators + fuel tanks
 * - Left/right tracks & front drive sprockets
 * - 5-man crew (Driver, Radio Op/Hull MG, Gunner, Commander, Loader)
 * - 5cm KwK 38/39 breech + coaxial MG 34 + sponson ammunition racks
 */
export function renderPanzerIIIInternals(ctx, target) {
  const scale = target.scale || CONFIG.TANK.SCALE;
  const ds = target.damageSystem;
  const st = (id) => (ds ? ds.getState(id) : MODULE_STATE.NORMAL);

  const lTrkC = getModuleStateColor(st('LEFT_TRACK'));
  const rTrkC = getModuleStateColor(st('RIGHT_TRACK'));
  const engC = getModuleStateColor(st('ENGINE'));
  const radC = getModuleStateColor(st('RADIATOR'));
  const fuelC = getModuleStateColor(st('FUEL_TANK'));
  const trnC = getModuleStateColor(st('TRANSMISSION'));
  const brC = getModuleStateColor(st('BREECH'));
  const ringC = getModuleStateColor(st('TURRET_RING'));
  const ammoLSt = st('AMMO_RACK');
  const ammoRSt = st('AMMO_RACK_R');

  ctx.save();
  ctx.translate(target.x, target.y);
  ctx.rotate(target.angle);
  ctx.scale(scale, scale);

  // 1. Tracks & Front Drive Sprockets
  ctx.fillStyle = lTrkC.fill;
  ctx.strokeStyle = lTrkC.stroke;
  ctx.lineWidth = 1.0;
  ctx.fillRect(-94, -50, 186, 8);
  ctx.strokeRect(-94, -50, 186, 8);
  ctx.beginPath();
  ctx.arc(84, -46, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = rTrkC.fill;
  ctx.strokeStyle = rTrkC.stroke;
  ctx.fillRect(-94, 42, 186, 8);
  ctx.strokeRect(-94, 42, 186, 8);
  ctx.beginPath();
  ctx.arc(84, 46, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 2. Front Transmission (ZF SSG 77) & Final Drive Axles to Front Sprockets
  ctx.fillStyle = trnC.fill;
  ctx.strokeStyle = trnC.stroke;
  ctx.lineWidth = 1.1;
  ctx.fillRect(66, -15, 20, 30);
  ctx.strokeRect(66, -15, 20, 30);
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  ctx.moveTo(76, -15);
  ctx.lineTo(84, -42);
  ctx.moveTo(76, 15);
  ctx.lineTo(84, 42);
  ctx.stroke();

  // Central driveshaft running under fighting compartment floor
  ctx.strokeStyle = engC.stroke;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-44, 0);
  ctx.lineTo(66, 0);
  ctx.stroke();

  // 3. Rear Maybach HL 120 TRM V12 Engine
  ctx.fillStyle = engC.fill;
  ctx.strokeStyle = engC.stroke;
  ctx.lineWidth = 1.2;
  ctx.fillRect(-80, -14, 36, 28);
  ctx.strokeRect(-80, -14, 36, 28);
  for (let cx = -75; cx <= -51; cx += 6) {
    ctx.strokeRect(cx, -11, 4, 8);
    ctx.strokeRect(cx, 3, 4, 8);
  }

  // 4. Cooling Radiators & Fans flanking engine
  ctx.fillStyle = radC.fill;
  ctx.strokeStyle = radC.stroke;
  ctx.lineWidth = 0.9;
  ctx.fillRect(-74, 18, 22, 11);
  ctx.strokeRect(-74, 18, 22, 11);
  ctx.fillRect(-74, -29, 22, 11);
  ctx.strokeRect(-74, -29, 22, 11);

  // 5. Fuel Tanks
  ctx.fillStyle = fuelC.fill;
  ctx.strokeStyle = fuelC.stroke;
  ctx.fillRect(-50, -29, 20, 12);
  ctx.strokeRect(-50, -29, 20, 12);

  // 6. 5cm Sponson Ammunition Racks
  for (let sx = -20; sx <= 6; sx += 13) {
    drawShellSilhouette(ctx, sx, -26, 0, ammoLSt);
    drawShellSilhouette(ctx, sx, 26, 0, ammoRSt);
  }

  // 7. Front Hull Crew: Driver (-Y) & Radio Operator / Bow MG 34 (+Y)
  const isBailed = (id) => Boolean(ds && ds.getModule(id)?.bailedOut);
  const outsideId =
    target.trackRepair && target.trackRepair.isActive && target.trackRepair.crewEmergence > 0.5
      ? target.trackRepair.assignedCrewId
      : null;
  if (outsideId !== 'DRIVER' && !isBailed('DRIVER')) drawCrewSilhouette(ctx, 56, -16, 0, st('DRIVER'));
  if (outsideId !== 'RADIO_OP' && !isBailed('RADIO_OP')) drawCrewSilhouette(ctx, 56, 16, 0, st('RADIO_OP'));

  // Bow Hull MG 34 mount
  ctx.fillStyle = COLOR.FILL_STRONG;
  ctx.strokeStyle = COLOR.STROKE;
  ctx.lineWidth = 0.9;
  ctx.fillRect(68, 14, 18, 4);
  ctx.strokeRect(68, 14, 18, 4);

  // 8. Turret Ring, 5cm Main Gun, Coax MG 34 & Turret Crew (static turret aligns with hull)
  ctx.strokeStyle = ringC.stroke;
  ctx.lineWidth = 1.3;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.arc(8, 0, 29, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // 5cm KwK 38/39 Breech & Barrel
  ctx.fillStyle = brC.fill;
  ctx.strokeStyle = brC.stroke;
  ctx.lineWidth = 1.0;
  ctx.fillRect(10, -6, 18, 12);
  ctx.strokeRect(10, -6, 18, 12);
  ctx.fillRect(28, -2.5, 62, 5);
  ctx.strokeRect(28, -2.5, 62, 5);

  // Coaxial MG 34
  ctx.fillStyle = COLOR.FILL_STRONG;
  ctx.strokeStyle = COLOR.STROKE;
  ctx.fillRect(22, 6, 22, 3);
  ctx.strokeRect(22, 6, 22, 3);

  // Turret Crew: Gunner, Commander (cupola), Loader
  if (outsideId !== 'GUNNER' && !isBailed('GUNNER')) drawCrewSilhouette(ctx, 14, -17, 0, st('GUNNER'));
  if (outsideId !== 'COMMANDER' && !isBailed('COMMANDER')) drawCrewSilhouette(ctx, -14, 0, 0, st('COMMANDER'));
  if (outsideId !== 'LOADER' && !isBailed('LOADER')) drawCrewSilhouette(ctx, 10, 17, -Math.PI / 2, st('LOADER'));

  ctx.restore();

  // World-space X-Ray Labels
  ctx.save();
  const ha = target.angle;
  drawWorldLabel(ctx, toWorld(target.x, target.y, ha, -62, 0, scale), 'MAYBACH HL120');
  drawWorldLabel(ctx, toWorld(target.x, target.y, ha, 76, 0, scale), 'TRANSMISSION');
  drawWorldLabel(ctx, toWorld(target.x, target.y, ha, -42, -32, scale), 'FUEL');
  drawWorldLabel(ctx, toWorld(target.x, target.y, ha, 56, -32, scale), 'DRIVER');
  drawWorldLabel(ctx, toWorld(target.x, target.y, ha, 56, 32, scale), 'RADIO OP');
  drawWorldLabel(ctx, toWorld(target.x, target.y, ha, 18, 0, scale), '5CM KWK');
  drawWorldLabel(ctx, toWorld(target.x, target.y, ha, -14, 0, scale), 'COMMANDER');
  drawWorldLabel(ctx, toWorld(target.x, target.y, ha, 14, -30, scale), 'GUNNER');
  drawWorldLabel(ctx, toWorld(target.x, target.y, ha, 10, 30, scale), 'LOADER');
  ctx.restore();
}
