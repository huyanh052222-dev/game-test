/**
 * CUSTOM BATTLE Mode Configuration, Validation, Presets, Spawner & Force Tracker.
 * Completely isolated from Simulation, Firing Range, and Soviet Trench Defense modes.
 */
import { CONFIG } from './config.js';
import { GermanSoldier } from './infantry.js?v=21';
import { PanzerIIITarget } from './target.js?v=16';
import { HeavyMGPosition } from './combat/heavyMG.js?v=15';
import { ZiS3FieldGun } from './combat/zis3.js?v=17';

export const CUSTOM_UNIT_DEFS = {
  soviet: [
    {
      id: 't34_85',
      name: 'T-34-85 Model 1944',
      category: 'TANKS',
      weaponLabel: '85mm ZiS-S-53 + 2x 7.62mm DT',
      crewLabel: '5 vehicle crew (1st is player)',
      min: 0,
      max: 6,
      available: true,
    },
    {
      id: 'zis3',
      name: 'ZiS-3 76.2 mm Field Gun',
      category: 'ARTILLERY',
      weaponLabel: '76.2mm Model 1942 (6 shell types)',
      crewLabel: '3 artillery crew / gun',
      min: 0,
      max: 4,
      available: true,
    },
    {
      id: 'sov_mosin',
      name: 'Soviet Rifleman',
      category: 'INFANTRY',
      weaponLabel: 'Mosin-Nagant M1891/30',
      crewLabel: '1 soldier',
      min: 0,
      max: 30,
      available: true,
    },
    {
      id: 'sov_ppsh',
      name: 'Soviet SMG Trooper',
      category: 'INFANTRY',
      weaponLabel: 'PPSh-41 Submachine Gun',
      crewLabel: '1 soldier',
      min: 0,
      max: 30,
      available: true,
    },
    {
      id: 'dshk',
      name: 'DShK 12.7 mm Heavy MG',
      category: 'HEAVY WEAPONS',
      weaponLabel: '12.7x108mm Fixed Emplacement',
      crewLabel: '1 operator / emplacement',
      min: 0,
      max: 6,
      available: true,
    },
  ],
  germany: [
    {
      id: 'panzer_iii',
      name: 'Panzer III Ausf. L',
      category: 'TANKS',
      weaponLabel: '5 cm KwK 39 L/60 + MG 34',
      crewLabel: '5 vehicle crew',
      min: 0,
      max: 8,
      available: true,
    },
    {
      id: 'ger_kar98k',
      name: 'German Rifleman',
      category: 'INFANTRY',
      weaponLabel: 'Karabiner 98k',
      crewLabel: '1 soldier',
      min: 0,
      max: 35,
      available: true,
    },
  ],
};

export const CUSTOM_PRESETS = {
  balanced: {
    label: 'Balanced Battle',
    soviet: { t34_85: 1, zis3: 1, sov_mosin: 6, sov_ppsh: 4, dshk: 1 },
    germany: { panzer_iii: 2, ger_kar98k: 10 },
    map: 'trench',
    deployment: 'opposing',
    distance: 'medium',
  },
  soviet_defense: {
    label: 'Soviet Defensive Test',
    soviet: { t34_85: 2, zis3: 1, sov_mosin: 10, sov_ppsh: 4, dshk: 2 },
    germany: { panzer_iii: 3, ger_kar98k: 15 },
    map: 'trench',
    deployment: 'opposing',
    distance: 'medium',
  },
  german_armor: {
    label: 'German Armored Assault',
    soviet: { t34_85: 1, zis3: 1, sov_mosin: 4, sov_ppsh: 2, dshk: 1 },
    germany: { panzer_iii: 4, ger_kar98k: 12 },
    map: 'natural',
    deployment: 'flanking',
    distance: 'long',
  },
  infantry_test: {
    label: 'Infantry Combat Test',
    soviet: { t34_85: 0, zis3: 0, sov_mosin: 8, sov_ppsh: 6, dshk: 1 },
    germany: { panzer_iii: 0, ger_kar98k: 14 },
    map: 'trench',
    deployment: 'opposing',
    distance: 'close',
  },
  artillery_test: {
    label: 'Artillery Test',
    soviet: { t34_85: 0, zis3: 2, sov_mosin: 4, sov_ppsh: 0, dshk: 0 },
    germany: { panzer_iii: 2, ger_kar98k: 8 },
    map: 'natural',
    deployment: 'opposing',
    distance: 'medium',
  },
};

export function createDefaultCustomConfig() {
  return structuredClone(CUSTOM_PRESETS.balanced);
}

function clampInt(val, min, max) {
  const n = Number.isFinite(Number(val)) ? Math.floor(Number(val)) : 0;
  return Math.max(min, Math.min(max, n));
}

export function validateCustomConfig(cfg) {
  const clean = {
    soviet: {},
    germany: {},
    map: ['trench', 'natural', 'simulation'].includes(cfg?.map) ? cfg.map : 'trench',
    deployment: ['opposing', 'flanking', 'random'].includes(cfg?.deployment) ? cfg.deployment : 'opposing',
    distance: ['close', 'medium', 'long'].includes(cfg?.distance) ? cfg.distance : 'medium',
  };

  let sovietUnits = 0;
  let sovietEntities = 0;
  for (const def of CUSTOM_UNIT_DEFS.soviet) {
    const q = clampInt(cfg?.soviet?.[def.id] ?? 0, def.min, def.max);
    clean.soviet[def.id] = q;
    sovietUnits += q;
    if (def.id === 'zis3') sovietEntities += q * 4;
    else if (def.id === 'dshk') sovietEntities += q * 2;
    else sovietEntities += q;
  }

  let germanUnits = 0;
  for (const def of CUSTOM_UNIT_DEFS.germany) {
    const q = clampInt(cfg?.germany?.[def.id] ?? 0, def.min, def.max);
    clean.germany[def.id] = q;
    germanUnits += q;
  }

  const totalUnits = sovietUnits + germanUnits;
  const totalEntities = sovietEntities + germanUnits;
  const errors = [];
  if (totalUnits <= 0) {
    errors.push('Select at least 1 unit to start a Custom Battle.');
  }

  const warnings = [];
  if (totalEntities > 45) {
    warnings.push(`High entity count (${totalEntities} units/crews) may impact performance.`);
  }

  return {
    ok: errors.length === 0,
    config: clean,
    sovietUnits,
    germanUnits,
    totalUnits,
    totalEntities,
    errors,
    warnings,
  };
}

function clampWorld(v, max) {
  return Math.max(CONFIG.WORLD.BORDER_PADDING + 70, Math.min(max - CONFIG.WORLD.BORDER_PADDING - 70, v));
}

function isClearOfEnvironment(x, y, radius, environment, tanks) {
  for (const t of tanks) {
    if (!t) continue;
    if (Math.hypot(x - t.x, y - t.y) < radius + 76) return false;
  }
  if (environment?.obstacles) {
    for (const o of environment.obstacles) {
      if (o.state === 'FALLEN' || o.state === 'DESTROYED') continue;
      const r = o.trunkRadius || o.collisionRadius || o.radius || 22;
      if (Math.hypot(x - o.x, y - o.y) < radius + r + 8) return false;
    }
  }
  return true;
}

export function spawnCustomBattle(rawConfig, {
  playerTank,
  reinforcements,
  environment,
  targets,
  infantry,
  heavyMGs,
  artilleryGuns,
}) {
  const { config } = validateCustomConfig(rawConfig);
  const w = CONFIG.WORLD.WIDTH;
  const h = CONFIG.WORLD.HEIGHT;
  const cx = w * 0.5;
  const cy = h * 0.5;

  const distMap = { close: 540, medium: 920, long: 1360 };
  const sep = distMap[config.distance] || 920;
  const halfSep = sep * 0.5;

  let sovCenter = { x: cx - halfSep * 0.65, y: cy + halfSep * 0.55 };
  let gerCenter = { x: cx + halfSep * 0.65, y: cy - halfSep * 0.55 };

  if (config.deployment === 'flanking') {
    sovCenter = { x: cx, y: cy + halfSep * 0.8 };
    gerCenter = { x: cx + halfSep * 0.85, y: cy - halfSep * 0.55 };
  } else if (config.deployment === 'random') {
    const baseAng = Math.random() * Math.PI * 2;
    sovCenter = {
      x: clampWorld(cx + Math.cos(baseAng) * halfSep, w),
      y: clampWorld(cy + Math.sin(baseAng) * halfSep, h),
    };
    gerCenter = {
      x: clampWorld(cx - Math.cos(baseAng) * halfSep, w),
      y: clampWorld(cy - Math.sin(baseAng) * halfSep, h),
    };
  }

  const sovFacing = Math.atan2(gerCenter.y - sovCenter.y, gerCenter.x - sovCenter.x);
  const gerFacing = Math.atan2(sovCenter.y - gerCenter.y, sovCenter.x - gerCenter.x);
  const sovPerpX = -Math.sin(sovFacing);
  const sovPerpY = Math.cos(sovFacing);
  const gerPerpX = -Math.sin(gerFacing);
  const gerPerpY = Math.cos(gerFacing);

  const allTanks = [];
  let nextId = 800;

  // 1. Soviet T-34-85 Tanks (all start under AI control so player begins in SPECTATOR mode)
  const hasPlayerTank = false;
  for (let i = 0; i < config.soviet.t34_85; i++) {
    const lateral = (i - (config.soviet.t34_85 - 1) * 0.5) * 185;
    const tx = clampWorld(sovCenter.x + sovPerpX * lateral, w);
    const ty = clampWorld(sovCenter.y + sovPerpY * lateral, h);
    const aiTank = reinforcements.spawnDefenseTank(tx, ty, sovFacing, { x: tx, y: ty });
    allTanks.push(aiTank);
  }

  // 2. German Panzer III Tanks
  for (let i = 0; i < config.germany.panzer_iii; i++) {
    const lateral = (i - (config.germany.panzer_iii - 1) * 0.5) * 195;
    const tx = clampWorld(gerCenter.x + gerPerpX * lateral, w);
    const ty = clampWorld(gerCenter.y + gerPerpY * lateral, h);
    const pz = new PanzerIIITarget(tx, ty, gerFacing, { combatEnabled: true });
    pz.assaultObjective = {
      x: clampWorld(sovCenter.x + sovPerpX * lateral * 0.5, w),
      y: clampWorld(sovCenter.y + sovPerpY * lateral * 0.5, h),
    };
    targets.push(pz);
    allTanks.push(pz);
  }

  // 3. Soviet ZiS-3 76.2mm Field Guns + 3-person crews
  for (let i = 0; i < config.soviet.zis3; i++) {
    const lateral = (i - (config.soviet.zis3 - 1) * 0.5) * 170;
    const gx = clampWorld(sovCenter.x + Math.cos(sovFacing) * 95 + sovPerpX * lateral, w);
    const gy = clampWorld(sovCenter.y + Math.sin(sovFacing) * 95 + sovPerpY * lateral, h);

    const artCmd = new GermanSoldier(nextId++, gx - 19, gy + 12, sovFacing, {
      faction: 'soviet',
      uniformStyle: 'infantry',
      weaponId: 'MOSIN_1891_30',
      isArtilleryCrew: true,
      artilleryRole: 'COMMANDER',
      combatEnabled: true,
      customBattleMode: true,
    });
    const artLdr = new GermanSoldier(nextId++, gx + 19, gy + 20, sovFacing, {
      faction: 'soviet',
      uniformStyle: 'infantry',
      weaponId: 'MOSIN_1891_30',
      isArtilleryCrew: true,
      artilleryRole: 'LOADER',
      combatEnabled: true,
      customBattleMode: true,
    });
    const artGnr = new GermanSoldier(nextId++, gx - 10, gy + 32, sovFacing, {
      faction: 'soviet',
      uniformStyle: 'infantry',
      weaponId: 'MOSIN_1891_30',
      isArtilleryCrew: true,
      artilleryRole: 'GUNNER',
      combatEnabled: true,
      customBattleMode: true,
    });
    const gun = new ZiS3FieldGun(gx, gy, sovFacing, {
      id: `custom_zis3_${i + 1}`,
      commander: artCmd,
      loader: artLdr,
      gunner: artGnr,
    });
    artCmd.artilleryGun = gun;
    artLdr.artilleryGun = gun;
    artGnr.artilleryGun = gun;
    artilleryGuns.push(gun);
    infantry.push(artCmd, artLdr, artGnr);
  }

  // 4. Soviet DShK 12.7mm Heavy Machine-Gun Emplacements + Operators
  for (let i = 0; i < config.soviet.dshk; i++) {
    const lateral = (i - (config.soviet.dshk - 1) * 0.5) * 145;
    const hx = clampWorld(sovCenter.x + Math.cos(sovFacing) * 145 + sovPerpX * lateral, w);
    const hy = clampWorld(sovCenter.y + Math.sin(sovFacing) * 145 + sovPerpY * lateral, h);
    const op = new GermanSoldier(
      nextId++,
      hx - Math.cos(sovFacing) * 18,
      hy - Math.sin(sovFacing) * 18,
      sovFacing,
      {
        faction: 'soviet',
        uniformStyle: 'infantry',
        weaponId: 'MOSIN_1891_30',
        isHmgOperator: true,
        combatEnabled: true,
        customBattleMode: true,
      }
    );
    op.customBattleInfantry = true;
    const hmg = new HeavyMGPosition(`custom_dshk_${i + 1}`, hx, hy, sovFacing, {
      faction: 'soviet',
      operator: op,
    });
    op.hmgEmplacement = hmg;
    heavyMGs.push(hmg);
    infantry.push(op);
  }

  // 5. Soviet Mosin-Nagant & PPSh-41 Infantry
  const sovWeaponQueue = [
    ...Array(config.soviet.sov_ppsh).fill('PPSH_41'),
    ...Array(config.soviet.sov_mosin).fill('MOSIN_1891_30'),
  ];
  for (let i = 0; i < sovWeaponQueue.length; i++) {
    const row = Math.floor(i / 6);
    const col = (i % 6) - 2.5;
    let sx = clampWorld(sovCenter.x + Math.cos(sovFacing) * (175 + row * 42) + sovPerpX * col * 42, w);
    let sy = clampWorld(sovCenter.y + Math.sin(sovFacing) * (175 + row * 42) + sovPerpY * col * 42, h);
    if (!isClearOfEnvironment(sx, sy, 16, environment, allTanks)) {
      sx = clampWorld(sx + sovPerpX * 35, w);
      sy = clampWorld(sy + sovPerpY * 35, h);
    }
    const soldier = new GermanSoldier(nextId++, sx, sy, sovFacing, {
      faction: 'soviet',
      uniformStyle: 'infantry',
      weaponId: sovWeaponQueue[i],
      combatEnabled: true,
      customBattleMode: true,
    });
    soldier.customBattleInfantry = true;
    infantry.push(soldier);
  }

  // 6. German Kar98k Infantry
  for (let i = 0; i < config.germany.ger_kar98k; i++) {
    const row = Math.floor(i / 6);
    const col = (i % 6) - 2.5;
    let gx = clampWorld(gerCenter.x + Math.cos(gerFacing) * (135 + row * 42) + gerPerpX * col * 42, w);
    let gy = clampWorld(gerCenter.y + Math.sin(gerFacing) * (135 + row * 42) + gerPerpY * col * 42, h);
    if (!isClearOfEnvironment(gx, gy, 16, environment, allTanks)) {
      gx = clampWorld(gx + gerPerpX * 35, w);
      gy = clampWorld(gy + gerPerpY * 35, h);
    }
    const escort = targets.length > 0 ? targets[i % targets.length] : null;
    const soldier = new GermanSoldier(nextId++, gx, gy, gerFacing, {
      faction: 'german',
      uniformStyle: 'infantry',
      weaponId: 'KAR98K',
      combatEnabled: true,
      customBattleMode: true,
      assaultOrder: {
        targetX: sovCenter.x,
        targetY: sovCenter.y,
        escortTank: escort,
        lateralOffset: (col * 0.25),
        depthOffset: row * 34,
      },
    });
    soldier.customBattleInfantry = true;
    infantry.push(soldier);
  }

  return {
    hasPlayerTank,
    focusX: hasPlayerTank ? playerTank.x : (sovCenter.x + gerCenter.x) * 0.5,
    focusY: hasPlayerTank ? playerTank.y : (sovCenter.y + gerCenter.y) * 0.5,
    initialTotals: {
      sovietTanks: config.soviet.t34_85,
      sovietInfantry: config.soviet.sov_mosin + config.soviet.sov_ppsh + config.soviet.dshk,
      sovietArtillery: config.soviet.zis3,
      sovietArtilleryCrew: config.soviet.zis3 * 3,
      sovietHmg: config.soviet.dshk,
      germanTanks: config.germany.panzer_iii,
      germanInfantry: config.germany.ger_kar98k,
    },
  };
}

export function getCustomBattleCounts({
  playerTank,
  hasPlayerTank = true,
  friendlyTanks = [],
  targets = [],
  infantry = [],
  heavyMGs = [],
  artilleryGuns = [],
  initialTotals = null,
}) {
  const sovTanksList = [...(hasPlayerTank && playerTank ? [playerTank] : []), ...friendlyTanks];
  const sovietTanks = sovTanksList.filter(
    (t) => t && !t.damageSystem?.vehicleDestroyed && t.vehicleState !== 'BURNT_OUT'
  ).length;
  const sovietInfantry = infantry.filter(
    (s) => s && s.alive && !s.inVehicle && s.faction === 'soviet' && !s.isArtilleryCrew && s.customBattleInfantry
  ).length;
  const sovietArtillery = artilleryGuns.filter((g) => g && g.operational).length;
  const sovietArtilleryCrew = artilleryGuns.reduce((sum, g) => sum + (g ? g.getCrewAliveCount() : 0), 0);
  const sovietHmg = heavyMGs.filter((h) => h && h.operational).length;

  const germanTanks = targets.filter(
    (t) => t && !t.destroyed && !t.damageSystem?.vehicleDestroyed && t.vehicleState !== 'BURNT_OUT'
  ).length;
  const germanInfantry = infantry.filter(
    (s) => s && s.alive && !s.inVehicle && s.faction === 'german' && s.customBattleInfantry
  ).length;

  const sovAliveTotal = sovietTanks + sovietInfantry + sovietArtillery;
  const gerAliveTotal = germanTanks + germanInfantry;
  const hadBothSides = initialTotals &&
    (initialTotals.sovietTanks + initialTotals.sovietInfantry + initialTotals.sovietArtillery > 0) &&
    (initialTotals.germanTanks + initialTotals.germanInfantry > 0);

  let outcome = null;
  if (hadBothSides) {
    if (gerAliveTotal === 0 && sovAliveTotal > 0) outcome = 'SOVIET VICTORY';
    else if (sovAliveTotal === 0 && gerAliveTotal > 0) outcome = 'GERMAN VICTORY';
  }

  return {
    sovietTanks,
    sovietTanksMax: initialTotals?.sovietTanks ?? sovietTanks,
    sovietInfantry,
    sovietInfantryMax: initialTotals?.sovietInfantry ?? sovietInfantry,
    sovietArtillery,
    sovietArtilleryMax: initialTotals?.sovietArtillery ?? artilleryGuns.length,
    sovietArtilleryCrew,
    sovietArtilleryCrewMax: initialTotals?.sovietArtilleryCrew ?? artilleryGuns.length * 3,
    sovietHmg,
    sovietHmgMax: initialTotals?.sovietHmg ?? heavyMGs.length,
    germanTanks,
    germanTanksMax: initialTotals?.germanTanks ?? germanTanks,
    germanInfantry,
    germanInfantryMax: initialTotals?.germanInfantry ?? germanInfantry,
    outcome,
  };
}

export function findSelectableCustomEntityAt(worldX, worldY, {
  friendlyTanks = [],
  targets = [],
  artilleryGuns = [],
  heavyMGs = [],
  infantry = [],
}) {
  // 1. Soviet T-34-85s
  for (const t of friendlyTanks) {
    if (!t || t.damageSystem?.vehicleDestroyed || t.vehicleState === 'BURNT_OUT') continue;
    if (Math.hypot(worldX - t.x, worldY - t.y) <= 68) {
      return { entity: t, kind: 'T34_85', label: 'SOVIET T-34-85' };
    }
  }
  // 2. German Panzer IIIs
  for (const pz of targets) {
    if (!pz || pz.destroyed || pz.damageSystem?.vehicleDestroyed || pz.vehicleState === 'BURNT_OUT') continue;
    if (Math.hypot(worldX - pz.x, worldY - pz.y) <= 65) {
      return { entity: pz, kind: 'PANZER_III', label: 'GERMAN PANZER III' };
    }
  }
  // 3. ZiS-3 76.2mm Field Guns
  for (const gun of artilleryGuns) {
    if (!gun || gun.destroyed || !gun.operational) continue;
    if (Math.hypot(worldX - gun.x, worldY - gun.y) <= 34) {
      return { entity: gun, kind: 'ZIS3', label: 'SOVIET ZIS-3 76.2MM' };
    }
  }
  // 4. DShK 12.7mm Heavy MG Emplacements
  for (const hmg of heavyMGs) {
    if (!hmg || hmg.destroyed || !hmg.operational) continue;
    if (Math.hypot(worldX - hmg.x, worldY - hmg.y) <= 28) {
      return { entity: hmg, kind: 'DSHK', label: 'SOVIET DSHK 12.7MM' };
    }
  }
  // 5. Soviet & German Infantry
  let bestInf = null;
  let bestInfDist = 24;
  for (const s of infantry) {
    if (!s || !s.alive || s.combatCapable === false || s.inVehicle) continue;
    if (s.isArtilleryCrew && s.artilleryGun && !s.artilleryGun.destroyed) continue;
    if (s.isHmgOperator && s.hmgEmplacement && !s.hmgEmplacement.destroyed) continue;
    const d = Math.hypot(worldX - s.x, worldY - s.y);
    if (d <= bestInfDist) {
      bestInfDist = d;
      bestInf = s;
    }
  }
  if (bestInf) {
    const fLabel = bestInf.faction === 'soviet' ? 'SOVIET' : 'GERMAN';
    const wLabel = bestInf.weaponCfg?.id === 'PPSH_41' ? 'PPSh-41' : (bestInf.weaponCfg?.id === 'KAR98K' ? 'Kar98k' : 'Mosin');
    return { entity: bestInf, kind: 'INFANTRY', label: `${fLabel} INFANTRY (${wLabel})` };
  }
  return null;
}
