/**
 * SOVIET TRENCH DEFENSE Scenario Setup & Force Tracking.
 *
 * Spawns:
 * - 3 Soviet T-34-85s (1 player + 2 AI defense tanks) inside the central fortification
 * - 20 Soviet infantry (4 PPSh-41 officers, 14 Mosin-Nagant riflemen, 2 DShK HMG operators)
 * - 2 12.7mm DShK Heavy Machine-Gun emplacements
 * - 5 German Panzer III tanks from randomized map-edge sectors
 * - 30 German Kar98k assault infantry in 5 spaced squads following the Panzer IIIs
 */
import { CONFIG } from './config.js';
import { GermanSoldier } from './infantry.js';
import { PanzerIIITarget } from './target.js';
import { HeavyMGPosition } from './combat/heavyMG.js?v=15';
import { ZiS3FieldGun } from './combat/zis3.js?v=17';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function isPointFree(x, y, radius, environment, tanks) {
  for (const t of tanks) {
    if (!t) continue;
    if (Math.hypot(x - t.x, y - t.y) < radius + 72) return false;
  }
  if (environment?.obstacles) {
    for (const o of environment.obstacles) {
      if (o.state === 'FALLEN') continue;
      const r = o.trunkRadius || o.collisionRadius || o.radius || 22;
      if (Math.hypot(x - o.x, y - o.y) < radius + r + 8) return false;
    }
  }
  return true;
}

export function setupSovietTrenchDefense({
  playerTank,
  reinforcements,
  environment,
  targets,
  infantry,
  heavyMGs,
  artilleryGuns = [],
}) {
  const cx = 1800;
  const cy = 1800;

  // 1. Position 3 Soviet T-34-85s at dedicated raised firing bays inside the expanded fortification
  playerTank.x = 1800;
  playerTank.y = 1965;
  playerTank.angle = -Math.PI / 2;
  playerTank.turret.hullAngle = playerTank.angle;
  playerTank.turret.localAngle = 0;
  // SOVIET TRENCH DEFENSE only: all 3 T-34-85 engines start already RUNNING
  playerTank.sound?.startEngineImmediate?.();
  if (playerTank.drivetrain?.preset) {
    playerTank.drivetrain.rpm = playerTank.drivetrain.preset.idleRpm + 80;
  }

  const aiTank1 = reinforcements.spawnDefenseTank(1545, 1620, -Math.PI * 0.72, { x: 1545, y: 1620 });
  const aiTank2 = reinforcements.spawnDefenseTank(2055, 1620, -Math.PI * 0.28, { x: 2055, y: 1620 });
  for (const t of [aiTank1, aiTank2]) {
    if (t.drivetrain?.preset) {
      t.drivetrain.rpm = t.drivetrain.preset.idleRpm + 80;
    }
  }
  const sovietTanks = [playerTank, aiTank1, aiTank2];

  let nextId = 500;

  // 2. Spawn 2 Heavy Machine-Gun Emplacements (12.7mm DShK) + 2 operators on opposite corner bastions
  const hmgSpecs = [
    { id: 'dshk_ne', x: 2240, y: 1415, angle: -Math.PI * 0.25 },
    { id: 'dshk_sw', x: 1360, y: 2185, angle: Math.PI * 0.75 },
  ];
  for (const spec of hmgSpecs) {
    const op = new GermanSoldier(
      nextId++,
      spec.x - Math.cos(spec.angle) * 18,
      spec.y - Math.sin(spec.angle) * 18,
      spec.angle,
      {
        faction: 'soviet',
        uniformStyle: 'infantry',
        weaponId: 'MOSIN_1891_30',
        isHmgOperator: true,
        combatEnabled: true,
      }
    );
    op.defenseForce = true;
    const hmg = new HeavyMGPosition(spec.id, spec.x, spec.y, spec.angle, {
      faction: 'soviet',
      operator: op,
    });
    op.hmgEmplacement = hmg;
    heavyMGs.push(hmg);
    infantry.push(op);
  }

  // 3. Spawn 4 PPSh-41 Soviet Officers at strategic N/S/E/W perimeter sectors
  const officerPositions = [
    { x: 1560, y: 1385, angle: -Math.PI / 2 },
    { x: 2040, y: 1385, angle: -Math.PI / 2 },
    { x: 1305, y: 1995, angle: Math.PI },
    { x: 2295, y: 1995, angle: 0 },
  ];
  for (const pos of officerPositions) {
    const officer = new GermanSoldier(nextId++, pos.x, pos.y, pos.angle, {
      faction: 'soviet',
      uniformStyle: 'infantry',
      weaponId: 'PPSH_41',
      isOfficer: true,
      combatEnabled: true,
    });
    officer.defenseForce = true;
    infantry.push(officer);
  }

  // 4. Spawn 14 Mosin-Nagant Soviet Riflemen along expanded trench firing bays & corners
  const riflePositions = [
    { x: 1345, y: 1385, angle: -Math.PI * 0.75 },
    { x: 1455, y: 1385, angle: -Math.PI / 2 },
    { x: 1665, y: 1385, angle: -Math.PI / 2 },
    { x: 1935, y: 1385, angle: -Math.PI / 2 },
    { x: 2145, y: 1385, angle: -Math.PI / 2 },
    { x: 2295, y: 1525, angle: 0 },
    { x: 2295, y: 1655, angle: 0 },
    { x: 2295, y: 1925, angle: 0 },
    { x: 2185, y: 2215, angle: Math.PI * 0.25 },
    { x: 1975, y: 2215, angle: Math.PI / 2 },
    { x: 1655, y: 2215, angle: Math.PI / 2 },
    { x: 1495, y: 2215, angle: Math.PI / 2 },
    { x: 1305, y: 1525, angle: Math.PI },
    { x: 1305, y: 1655, angle: Math.PI },
  ];
  for (const pos of riflePositions) {
    const rifleman = new GermanSoldier(nextId++, pos.x, pos.y, pos.angle, {
      faction: 'soviet',
      uniformStyle: 'infantry',
      weaponId: 'MOSIN_1891_30',
      combatEnabled: true,
    });
    rifleman.defenseForce = true;
    infantry.push(rifleman);
  }

  // 4b. Spawn 1 Soviet ZiS-3 76.2mm Divisional Field Gun + 3-person artillery crew
  const zisPos = { x: 1800, y: 1500, angle: -Math.PI / 2 };
  const artCommander = new GermanSoldier(nextId++, zisPos.x - 19, zisPos.y + 12, zisPos.angle, {
    faction: 'soviet',
    uniformStyle: 'infantry',
    weaponId: 'MOSIN_1891_30',
    isArtilleryCrew: true,
    artilleryRole: 'COMMANDER',
    combatEnabled: true,
  });
  const artLoader = new GermanSoldier(nextId++, zisPos.x + 19, zisPos.y + 20, zisPos.angle, {
    faction: 'soviet',
    uniformStyle: 'infantry',
    weaponId: 'MOSIN_1891_30',
    isArtilleryCrew: true,
    artilleryRole: 'LOADER',
    combatEnabled: true,
  });
  const artGunner = new GermanSoldier(nextId++, zisPos.x - 10, zisPos.y + 32, zisPos.angle, {
    faction: 'soviet',
    uniformStyle: 'infantry',
    weaponId: 'MOSIN_1891_30',
    isArtilleryCrew: true,
    artilleryRole: 'GUNNER',
    combatEnabled: true,
  });
  const zis3 = new ZiS3FieldGun(zisPos.x, zisPos.y, zisPos.angle, {
    id: 'zis3_main',
    commander: artCommander,
    loader: artLoader,
    gunner: artGunner,
  });
  artCommander.artilleryGun = zis3;
  artLoader.artilleryGun = zis3;
  artGunner.artilleryGun = zis3;
  artilleryGuns.push(zis3);
  infantry.push(artCommander, artLoader, artGunner);

  // 5. Spawn 5 German Panzer III tanks from randomized map-edge sectors
  const w = CONFIG.WORLD.WIDTH;
  const h = CONFIG.WORLD.HEIGHT;
  const edgeSectors = [
    { x: 290, y: 290, objX: 1410, objY: 1470 },
    { x: w * 0.5, y: 250, objX: 1800, objY: 1360 },
    { x: w - 290, y: 290, objX: 2190, objY: 1470 },
    { x: w - 250, y: h * 0.5, objX: 2320, objY: 1800 },
    { x: w - 290, y: h - 290, objX: 2190, objY: 2130 },
    { x: w * 0.5, y: h - 250, objX: 1800, objY: 2240 },
    { x: 290, y: h - 290, objX: 1410, objY: 2130 },
    { x: 250, y: h * 0.5, objX: 1280, objY: 1800 },
  ];

  // Fisher-Yates shuffle to pick 5 distinct randomized edge sectors
  for (let i = edgeSectors.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [edgeSectors[i], edgeSectors[j]] = [edgeSectors[j], edgeSectors[i]];
  }
  const chosenSectors = edgeSectors.slice(0, 5);

  const germanTanks = [];
  for (let i = 0; i < chosenSectors.length; i++) {
    const sec = chosenSectors[i];
    const jitterX = (Math.random() - 0.5) * 90;
    const jitterY = (Math.random() - 0.5) * 90;
    const tx = clamp(sec.x + jitterX, 180, w - 180);
    const ty = clamp(sec.y + jitterY, 180, h - 180);
    const ang = Math.atan2(cy - ty, cx - tx);

    const pz = new PanzerIIITarget(tx, ty, ang, { combatEnabled: true });
    pz.assaultObjective = { x: sec.objX, y: sec.objY };
    targets.push(pz);
    germanTanks.push(pz);
  }

  // 6. Spawn 30 German Kar98k infantry in 5 squads (6 per Panzer III) following behind the armor
  const allTanks = [...sovietTanks, ...germanTanks];
  for (let tIdx = 0; tIdx < germanTanks.length; tIdx++) {
    const pz = germanTanks[tIdx];
    const backAng = Math.atan2(pz.y - cy, pz.x - cx);
    const perpX = -Math.sin(backAng);
    const perpY = Math.cos(backAng);

    for (let sIdx = 0; sIdx < 6; sIdx++) {
      const row = Math.floor(sIdx / 3);
      const col = (sIdx % 3) - 1;
      const distBack = 110 + row * 48;
      const lateral = col * 44;

      let sx = clamp(
        pz.x + Math.cos(backAng) * distBack + perpX * lateral,
        CONFIG.WORLD.BORDER_PADDING,
        w - CONFIG.WORLD.BORDER_PADDING
      );
      let sy = clamp(
        pz.y + Math.sin(backAng) * distBack + perpY * lateral,
        CONFIG.WORLD.BORDER_PADDING,
        h - CONFIG.WORLD.BORDER_PADDING
      );

      if (!isPointFree(sx, sy, 16, environment, allTanks)) {
        sx = clamp(sx + perpX * 26, CONFIG.WORLD.BORDER_PADDING, w - CONFIG.WORLD.BORDER_PADDING);
        sy = clamp(sy + perpY * 26, CONFIG.WORLD.BORDER_PADDING, h - CONFIG.WORLD.BORDER_PADDING);
      }

      const soldier = new GermanSoldier(nextId++, sx, sy, pz.angle, {
        faction: 'german',
        uniformStyle: 'infantry',
        weaponId: 'KAR98K',
        combatEnabled: true,
        assaultOrder: {
          targetX: pz.assaultObjective.x,
          targetY: pz.assaultObjective.y,
          escortTank: pz,
          lateralOffset: col * 0.32,
          depthOffset: row * 38,
        },
      });
      soldier.defenseForce = true;
      infantry.push(soldier);
    }
  }
}

export function getDefenseForceCounts({ playerTank, friendlyTanks = [], targets = [], infantry = [], heavyMGs = [], artilleryGuns = [] }) {
  const allSovietTanks = [playerTank, ...friendlyTanks].filter(Boolean);
  const sovietTanks = allSovietTanks.filter(
    (t) => !t.damageSystem?.vehicleDestroyed && t.vehicleState !== 'BURNT_OUT'
  ).length;
  const sovietInfantry = infantry.filter(
    (s) => s && s.alive && !s.inVehicle && s.faction === 'soviet' && s.defenseForce
  ).length;
  const hmgActive = heavyMGs.filter((h) => h && h.operational).length;
  const zis3 = artilleryGuns[0] || null;
  const artillery = zis3 ? zis3.getHudStatus() : null;

  const germanTanks = targets.filter(
    (t) => t && !t.destroyed && !t.damageSystem?.vehicleDestroyed && t.vehicleState !== 'BURNT_OUT'
  ).length;
  const germanInfantry = infantry.filter(
    (s) => s && s.alive && !s.inVehicle && s.faction === 'german' && s.defenseForce
  ).length;

  let outcome = null;
  if (germanTanks === 0 && germanInfantry === 0) {
    outcome = 'DEFENSE HELD';
  } else if (sovietTanks === 0 && sovietInfantry === 0 && (!artillery || !artillery.operational)) {
    outcome = 'POSITION OVERRUN';
  }

  return {
    sovietTanks,
    sovietTanksMax: 3,
    sovietInfantry,
    sovietInfantryMax: 20,
    hmgActive,
    hmgMax: 2,
    germanTanks,
    germanTanksMax: 5,
    germanInfantry,
    germanInfantryMax: 30,
    artillery,
    outcome,
  };
}
