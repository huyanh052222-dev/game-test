/**
 * Infantry Weapon Inventory, Bayonet CQC, 25% Emergency Sidearm Response,
 * Fragmentation Grenades (F-1 / M24 Stielhandgranate) & Incendiary Weapons (Molotov / Brandflasche).
 *
 * Activated in CUSTOM_BATTLE mode (and exposed for unit tests) without altering other modes.
 */

export function createSoldierInventory(soldier, options = {}) {
  const wId = soldier.weaponCfg?.id || (soldier.faction === 'soviet' ? 'MOSIN_1891_30' : 'KAR98K');
  let hasBayonet = false;
  if (wId === 'PPSH_41') {
    hasBayonet = false;
  } else if (wId === 'MOSIN_1891_30') {
    hasBayonet = options.hasBayonet !== undefined ? Boolean(options.hasBayonet) : true;
  } else if (wId === 'KAR98K') {
    hasBayonet = options.hasBayonet !== undefined ? Boolean(options.hasBayonet) : true;
  }
  const bayonetEquipped = hasBayonet && Boolean(options.bayonetEquipped);

  const defaultHasSidearm = Boolean(
    soldier.isOfficer ||
    soldier.isArtilleryCrew ||
    soldier.isHmgOperator ||
    (soldier.id % 2 === 0)
  );
  const hasSidearm = options.hasSidearm !== undefined ? Boolean(options.hasSidearm) : defaultHasSidearm;
  const fragGrenades = options.fragGrenades !== undefined ? options.fragGrenades : 2;
  const incendiaries = options.incendiaries !== undefined ? options.incendiaries : ((soldier.id % 3 === 0) ? 1 : 0);

  return {
    primaryWeapon: wId,
    hasBayonet,
    bayonetEquipped,
    meleeReach: bayonetEquipped ? 28 : 18,
    meleeDamage: bayonetEquipped ? 18 : 8,
    hasSidearm,
    carriesSidearm: hasSidearm,
    sidearmId: soldier.faction === 'soviet' ? 'TT_33' : 'P08_LUGER',
    sidearmName: soldier.faction === 'soviet' ? 'TT-33 Tokarev' : 'Luger P08',
    sidearmMag: hasSidearm ? (options.sidearmMag ?? 8) : 0,
    sidearmMagCap: 8,
    sidearmReserve: hasSidearm ? (options.sidearmReserve ?? 16) : 0,
    fragGrenadeId: soldier.faction === 'soviet' ? 'F1_GRENADE' : 'M24_STIELHANDGRANATE',
    fragGrenadeName: soldier.faction === 'soviet' ? 'F-1 Frag Grenade' : 'M24 Stielhandgranate',
    fragGrenades,
    carriesFrag: fragGrenades > 0 || Boolean(options.carriesFrag),
    incendiaryId: soldier.faction === 'soviet' ? 'MOLOTOV_SOV' : 'BRANDFLASCHE_GER',
    incendiaryName: soldier.faction === 'soviet' ? 'Molotov Bottle' : 'Brandflasche',
    incendiaries,
    carriesIncendiary: incendiaries > 0 || Boolean(options.carriesIncendiary),
    selectedSlot: 'PRIMARY', // 'PRIMARY' | 'SIDEARM' | 'FRAG' | 'INCENDIARY'
    activeMode: bayonetEquipped ? 'BAYONET' : 'PRIMARY', // 'PRIMARY' | 'BAYONET' | 'SIDEARM' | 'THROWING'
    meleeCooldown: 0,
    meleeLungePhase: 0,
    meleeDodgeOffset: 0,
    meleeTarget: null,
    sidearmTimer: 0,
    sidearmShotsLeft: 0,
    throwTimer: 0,
    throwCooldown: 1.5 + (soldier.id % 4) * 0.6,
    evaluatedEncounters: new Set(),
  };
}

export function selectSoldierWeaponSlot(soldier, action, onNotice = null) {
  if (!soldier || !soldier.alive || soldier.combatCapable === false) {
    return { ok: false, reason: 'INCAPACITATED' };
  }
  if (!soldier.inventory) {
    soldier.inventory = createSoldierInventory(soldier);
  }
  const inv = soldier.inventory;

  if (action === 'SLOT_1') {
    inv.selectedSlot = 'PRIMARY';
    inv.activeMode = inv.bayonetEquipped ? 'BAYONET' : 'PRIMARY';
    return { ok: true, slot: 'PRIMARY' };
  }

  if (action === 'SLOT_2') {
    if (!inv.hasSidearm) {
      onNotice?.('NO SIDEARM IN LOADOUT');
      return { ok: false, reason: 'NO_SIDEARM' };
    }
    if ((inv.sidearmMag + inv.sidearmReserve) <= 0) {
      onNotice?.('SIDEARM OUT OF AMMO');
      return { ok: false, reason: 'NO_SIDEARM_AMMO' };
    }
    if (inv.sidearmMag <= 0 && inv.sidearmReserve > 0) {
      const load = Math.min(inv.sidearmMagCap, inv.sidearmReserve);
      inv.sidearmMag += load;
      inv.sidearmReserve -= load;
    }
    inv.selectedSlot = 'SIDEARM';
    inv.activeMode = 'SIDEARM';
    return { ok: true, slot: 'SIDEARM' };
  }

  if (action === 'SLOT_3') {
    if (inv.fragGrenades <= 0) {
      onNotice?.('NO FRAG GRENADES REMAINING');
      return { ok: false, reason: 'NO_FRAG' };
    }
    inv.selectedSlot = 'FRAG';
    return { ok: true, slot: 'FRAG' };
  }

  if (action === 'SLOT_4') {
    if (inv.incendiaries <= 0) {
      onNotice?.('NO INCENDIARY WEAPONS REMAINING');
      return { ok: false, reason: 'NO_INCENDIARY' };
    }
    inv.selectedSlot = 'INCENDIARY';
    return { ok: true, slot: 'INCENDIARY' };
  }

  if (action === 'TOGGLE_BAYONET') {
    if (inv.primaryWeapon === 'PPSH_41' || !inv.hasBayonet) {
      if (inv.primaryWeapon !== 'PPSH_41') {
        onNotice?.('NO BAYONET COMPATIBLE WITH THIS RIFLE');
      }
      return { ok: false, reason: 'INCOMPATIBLE_BAYONET' };
    }
    inv.bayonetEquipped = !inv.bayonetEquipped;
    inv.meleeReach = inv.bayonetEquipped ? 28 : 18;
    inv.meleeDamage = inv.bayonetEquipped ? 18 : 8;
    if (inv.selectedSlot === 'PRIMARY') {
      inv.activeMode = inv.bayonetEquipped ? 'BAYONET' : 'PRIMARY';
    }
    onNotice?.(inv.bayonetEquipped ? 'BAYONET ATTACHED' : 'BAYONET DETACHED');
    return { ok: true, bayonetEquipped: inv.bayonetEquipped };
  }

  return { ok: false, reason: 'UNKNOWN_ACTION' };
}

export function performSoldierMeleeThrust(soldier, infantry = [], particles = null, environment = null) {
  if (!soldier || !soldier.alive || soldier.combatCapable === false) return { hit: false };
  if (!soldier.inventory) soldier.inventory = createSoldierInventory(soldier);
  const inv = soldier.inventory;
  if (inv.meleeCooldown > 0) return { hit: false, cooldown: true };

  inv.meleeCooldown = 0.78;
  inv.meleeLungePhase = 1.0;
  const reach = inv.bayonetEquipped && inv.hasBayonet ? 28 : 18;
  const dmg = inv.bayonetEquipped && inv.hasBayonet ? 18 : 8;

  let bestTarget = null;
  let bestDist = reach;
  for (const other of infantry) {
    if (!other || other === soldier || !other.alive || other.inVehicle) continue;
    const d = Math.hypot(other.x - soldier.x, other.y - soldier.y);
    if (d > bestDist) continue;
    const angTo = Math.atan2(other.y - soldier.y, other.x - soldier.x);
    let diff = angTo - soldier.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) > 0.95) continue;
    if (environment && typeof environment.hasLineOfSight === 'function' && !environment.hasLineOfSight(soldier.x, soldier.y, other.x, other.y)) {
      continue;
    }
    bestDist = d;
    bestTarget = other;
  }

  if (bestTarget) {
    bestTarget.takeDamage(dmg, particles, bestTarget.x, bestTarget.y, soldier.angle, 'rifle', null);
    return { hit: true, target: bestTarget, damage: dmg, reach };
  }
  return { hit: false, reach, damage: dmg };
}

/**
 * Evaluates the 25% emergency sidearm response probability ONCE per close-range encounter.
 * Soldiers without a sidearm or sidearm ammo never trigger a pistol response.
 */
export function evaluateEmergencySidearmRoll(soldier, enemy, rngFn = Math.random) {
  const inv = soldier?.inventory;
  if (!inv || !enemy) return false;
  const key = enemy.id ?? enemy;
  if (inv.evaluatedEncounters.has(key)) {
    return inv.activeMode === 'SIDEARM';
  }
  inv.evaluatedEncounters.add(key);
  if (!inv.hasSidearm || inv.sidearmMag <= 0) {
    return false;
  }
  const roll = rngFn();
  return roll < 0.25;
}

export class ThrowableManager {
  constructor(particles = null, sound = null) {
    this.particles = particles;
    this.sound = sound;
    this.throwables = [];
    this.fireZones = [];
  }

  reset() {
    this.throwables.length = 0;
    this.fireZones.length = 0;
  }

  spawnThrowable({
    kind = 'frag', // 'frag' | 'incendiary'
    weaponId = 'F1_GRENADE',
    faction = 'soviet',
    owner = null,
    startX,
    startY,
    targetX,
    targetY,
    fuseTime = 2.2,
  }) {
    const dx = targetX - startX;
    const dy = targetY - startY;
    const dist = Math.max(10, Math.min(265, Math.hypot(dx, dy)));
    const flightTime = Math.max(0.45, Math.min(1.35, dist / 210));
    const ux = dx / Math.max(1e-4, Math.hypot(dx, dy));
    const uy = dy / Math.max(1e-4, Math.hypot(dx, dy));
    const speed = dist / flightTime;
    const gravity = 380;
    const vz = 0.5 * gravity * flightTime;

    const item = {
      kind,
      weaponId,
      faction,
      owner,
      x: startX,
      y: startY,
      z: 8,
      vx: ux * speed,
      vy: uy * speed,
      vz,
      angle: Math.atan2(dy, dx),
      spinRate: kind === 'incendiary' ? 7.5 : 9.2,
      fuseTimer: kind === 'incendiary' ? flightTime + 0.08 : Math.max(flightTime + 0.25, fuseTime),
      flightTime,
      elapsed: 0,
      landed: false,
      detonated: false,
    };
    this.throwables.push(item);
    return item;
  }

  _detonateFrag(item, { infantry = [], tanks = [], heavyMGs = [], artilleryGuns = [], environment = null, friendlyFireEnabled = true }) {
    item.detonated = true;
    const bx = item.x;
    const by = item.y;
    const blastRadius = 88;
    const baseDamage = 68;

    this.particles?.spawnImpact?.(bx, by, 'ground', 0.85);
    this.particles?.spawnSmokeCloud?.(bx, by, 16, 44, 3.6, 0.68, 56);
    this.sound?.playExplosion?.();

    const bTrench = environment?.trenchSystem?.getTrenchStateAt?.(bx, by);

    // 1. Damage exposed infantry, HMG operators, and artillery crew (never penetrates solid trench walls)
    for (const s of infantry) {
      if (!s || !s.alive || s.inVehicle) continue;
      if (!friendlyFireEnabled && item.faction && s.faction === item.faction) continue;
      const d = Math.hypot(s.x - bx, s.y - by);
      if (d > blastRadius) continue;

      // Solid trench wall obstruction check: if blast is outside trench and soldier is inside deep trench (or vice versa) across wall
      if (environment?.trenchSystem) {
        const sTrench = environment.trenchSystem.getTrenchStateAt(s.x, s.y);
        if (sTrench?.hasRoof && !bTrench?.hasRoof) continue;
        if (Boolean(sTrench?.inTrench) !== Boolean(bTrench?.inTrench) && (sTrench?.depth === 'deep' || bTrench?.depth === 'deep') && d > 36) {
          continue;
        }
      }

      const falloff = Math.max(0.18, 1 - d / blastRadius);
      const prot = environment?.trenchSystem?.getBlastProtectionMultiplier?.(s.x, s.y, bx, by) ?? 1.0;
      const dmg = Math.round(baseDamage * falloff * prot);
      if (dmg > 0) {
        const hitAng = Math.atan2(s.y - by, s.x - bx);
        // Use small-arms/fragmentation classification so non-fatal outer fragments can wound while close blast kills
        s.takeDamage(dmg, this.particles, s.x, s.y, hitAng, d < 32 ? 'explosion' : 'rifle', {
          isBlast: d < 32,
          isDirect: d < 16,
          dist: d,
          radius: blastRadius,
        });
      }
    }

    // 2. Damage exposed HMG & ZiS-3 equipment moderately (without auto-destroying full-health emplacements)
    for (const hmg of heavyMGs) {
      if (!hmg || hmg.destroyed) continue;
      if (!friendlyFireEnabled && item.faction && hmg.faction === item.faction) continue;
      const d = Math.hypot(hmg.x - bx, hmg.y - by);
      if (d <= blastRadius * 0.85) {
        hmg.takeDamage(Math.round(42 * (1 - d / blastRadius)), this.particles);
      }
    }
    for (const gun of artilleryGuns) {
      if (!gun || gun.destroyed) continue;
      if (!friendlyFireEnabled && item.faction && gun.faction === item.faction) continue;
      const d = Math.hypot(gun.x - bx, gun.y - by);
      if (d <= blastRadius * 0.85) {
        gun.takeDamage(Math.round(45 * (1 - d / blastRadius)), this.particles, this.sound);
      }
    }
    // Note: Ordinary fragmentation grenades do NOT penetrate thick tank armor.
  }

  _detonateIncendiary(item, { environment = null }) {
    item.detonated = true;
    const fx = item.x;
    const fy = item.y;
    this.particles?.spawnImpact?.(fx, fy, 'ground', 0.6);
    this.particles?.spawnSmokeCloud?.(fx, fy, 14, 48, 5.5, 0.72, 34);

    this.fireZones.push({
      x: fx,
      y: fy,
      radius: 42,
      duration: 7.5,
      maxDuration: 7.5,
      dps: 7.5,
      faction: item.faction,
      owner: item.owner,
      tickTimer: 0,
      phase: Math.random() * Math.PI * 2,
    });

    // Displace nearby sandbags slightly if hit directly
    if (environment?.trenchSystem?.sandbags) {
      for (const bag of environment.trenchSystem.sandbags) {
        if (Math.hypot(bag.x - fx, bag.y - fy) < 28) {
          bag.displaced = true;
        }
      }
    }
  }

  update(dt, context = {}) {
    const {
      infantry = [],
      tanks = [],
      heavyMGs = [],
      artilleryGuns = [],
      environment = null,
      friendlyFireEnabled = true,
    } = context;

    // 1. Step airborne / rolling throwables
    for (let i = this.throwables.length - 1; i >= 0; i--) {
      const t = this.throwables[i];
      t.elapsed += dt;
      t.fuseTimer -= dt;

      if (!t.landed) {
        t.x += t.vx * dt;
        t.y += t.vy * dt;
        t.z += t.vz * dt;
        t.vz -= 380 * dt;
        t.angle += t.spinRate * dt;

        if (t.z <= 0) {
          t.z = 0;
          if (t.kind === 'incendiary') {
            this._detonateIncendiary(t, context);
            this.throwables.splice(i, 1);
            continue;
          }
          t.landed = true;
          t.vx *= 0.25;
          t.vy *= 0.25;
        }
      } else {
        t.x += t.vx * dt;
        t.y += t.vy * dt;
        t.vx *= Math.max(0, 1 - dt * 5);
        t.vy *= Math.max(0, 1 - dt * 5);
      }

      if (t.fuseTimer <= 0) {
        if (t.kind === 'incendiary') {
          this._detonateIncendiary(t, context);
        } else {
          this._detonateFrag(t, { infantry, tanks, heavyMGs, artilleryGuns, environment, friendlyFireEnabled });
        }
        this.throwables.splice(i, 1);
      }
    }

    // 2. Step persistent incendiary fire zones (heat & burn damage)
    for (let i = this.fireZones.length - 1; i >= 0; i--) {
      const fz = this.fireZones[i];
      fz.duration -= dt;
      fz.phase += dt * 9;
      fz.tickTimer += dt;

      if (fz.tickTimer >= 0.35) {
        const stepDt = fz.tickTimer;
        fz.tickTimer = 0;

        if (Math.random() < 0.65) {
          this.particles?.spawnSmokeCloud?.(
            fz.x + (Math.random() - 0.5) * 18,
            fz.y + (Math.random() - 0.5) * 18,
            10,
            28,
            2.4,
            0.45,
            32
          );
        }

        // Burn exposed infantry & crew in the fire zone
        for (const s of infantry) {
          if (!s || !s.alive || s.inVehicle) continue;
          if (!friendlyFireEnabled && fz.faction && s.faction === fz.faction) continue;
          const d = Math.hypot(s.x - fz.x, s.y - fz.y);
          if (d <= fz.radius) {
            const burnDmg = Math.max(1, Math.round(fz.dps * stepDt * (1 - (d / fz.radius) * 0.45)));
            s.takeDamage(burnDmg, this.particles, s.x, s.y, 0, 'rifle', null);
          }
        }

        // Heat/damage vulnerable external tank components (engine air intakes / optics) without instant-destroying tanks
        for (const veh of tanks) {
          if (!veh || veh.destroyed || veh.damageSystem?.vehicleDestroyed) continue;
          if (!friendlyFireEnabled && fz.faction && veh.faction === fz.faction) continue;
          const d = Math.hypot(veh.x - fz.x, veh.y - fz.y);
          if (d <= fz.radius + 36 && veh.damageSystem) {
            const engMod = veh.damageSystem.getModule?.('ENGINE');
            if (engMod && engMod.hp > 0) {
              engMod.hp = Math.max(12, engMod.hp - 5.5 * stepDt); // Can damage/degrade engine without automatic instant destruction
              if (engMod.hp < 55 && engMod.state === 'NORMAL') {
                engMod.state = 'DAMAGED';
              }
            }
          }
        }

        // Burn exposed HMG / artillery positions
        for (const hmg of heavyMGs) {
          if (!hmg || hmg.destroyed) continue;
          if (!friendlyFireEnabled && fz.faction && hmg.faction === fz.faction) continue;
          if (Math.hypot(hmg.x - fz.x, hmg.y - fz.y) <= fz.radius) {
            hmg.takeDamage(4.5 * stepDt, this.particles);
          }
        }
        for (const gun of artilleryGuns) {
          if (!gun || gun.destroyed) continue;
          if (!friendlyFireEnabled && fz.faction && gun.faction === fz.faction) continue;
          if (Math.hypot(gun.x - fz.x, gun.y - fz.y) <= fz.radius) {
            gun.takeDamage(4.5 * stepDt, this.particles, this.sound);
          }
        }
      }

      if (fz.duration <= 0) {
        this.fireZones.splice(i, 1);
      }
    }
  }

  render(ctx) {
    // 1. Render persistent incendiary fire zones
    for (const fz of this.fireZones) {
      const lifeRatio = Math.max(0.15, Math.min(1, fz.duration / fz.maxDuration));
      const r = fz.radius * (0.75 + 0.25 * lifeRatio);
      ctx.save();
      ctx.translate(fz.x, fz.y);

      // Scorched ground mark
      ctx.fillStyle = `rgba(20, 16, 12, ${(0.45 * lifeRatio).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
      ctx.fill();

      // Flickering flame tongues
      for (let k = 0; k < 5; k++) {
        const ang = (k / 5) * Math.PI * 2 + fz.phase * 0.3;
        const dist = (k % 2 === 0 ? 0.3 : 0.52) * r;
        const fx = Math.cos(ang) * dist;
        const fy = Math.sin(ang) * dist;
        const fr = (0.28 + 0.08 * Math.sin(fz.phase + k * 1.7)) * r;

        ctx.fillStyle = `rgba(235, 96, 28, ${(0.62 * lifeRatio).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(fx, fy, fr, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(255, 200, 68, ${(0.55 * lifeRatio).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(fx, fy, fr * 0.52, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 2. Render airborne & rolling grenades / incendiary bottles
    for (const t of this.throwables) {
      ctx.save();
      // Ground shadow under arc
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.beginPath();
      ctx.ellipse(t.x, t.y, 3.2, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.translate(t.x, t.y - t.z * 0.55);
      ctx.rotate(t.angle);

      if (t.kind === 'incendiary') {
        // Glass Molotov bottle + burning cloth wick
        ctx.fillStyle = '#3d5834';
        ctx.strokeStyle = '#182214';
        ctx.lineWidth = 0.8;
        ctx.fillRect(-3.6, -1.8, 5.2, 3.6);
        ctx.strokeRect(-3.6, -1.8, 5.2, 3.6);
        ctx.fillStyle = '#ffae34';
        ctx.beginPath();
        ctx.arc(2.8, 0, 1.8, 0, Math.PI * 2);
        ctx.fill();
      } else if (t.faction === 'german') {
        // German M24 Stielhandgranate (wooden handle + grey warhead)
        ctx.fillStyle = '#9a784c';
        ctx.fillRect(-4.2, -0.9, 4.8, 1.8);
        ctx.fillStyle = '#4e5552';
        ctx.strokeStyle = '#1d201e';
        ctx.lineWidth = 0.7;
        ctx.fillRect(0.6, -1.9, 3.4, 3.8);
        ctx.strokeRect(0.6, -1.9, 3.4, 3.8);
      } else {
        // Soviet F-1 pineapple fragmentation grenade
        ctx.fillStyle = '#4d5d38';
        ctx.strokeStyle = '#1d2415';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.ellipse(0, 0, 2.8, 2.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

export function updateSoldierCQCAndThrowables(soldier, dt, aiContext, throwableManager) {
  if (!soldier || !soldier.alive || soldier.combatCapable === false || soldier.inVehicle) return false;
  if (soldier.isHmgOperator || soldier.isArtilleryCrew) return false;
  if (!soldier.inventory) {
    soldier.inventory = createSoldierInventory(soldier);
  }
  const inv = soldier.inventory;
  const {
    infantry = [],
    tanks = [],
    heavyMGs = [],
    artilleryGuns = [],
    environment = null,
    projectiles = null,
    particles = null,
    sound = null,
    listenerX = soldier.x,
    listenerY = soldier.y,
  } = aiContext || {};

  inv.meleeCooldown = Math.max(0, inv.meleeCooldown - dt);
  inv.meleeLungePhase = Math.max(0, inv.meleeLungePhase - dt * 3.5);
  inv.throwCooldown = Math.max(0, inv.throwCooldown - dt);

  // 1. Handle active THROWING animation state
  if (inv.activeMode === 'THROWING') {
    inv.throwTimer -= dt;
    if (inv.throwTimer <= 0) {
      inv.activeMode = inv.bayonetEquipped ? 'BAYONET' : 'PRIMARY';
    }
    return true;
  }

  // Find closest visible enemy infantry for close-quarters melee / sidearm check
  let nearestEnemy = null;
  let nearestDist = Infinity;
  for (const other of infantry) {
    if (!other || !other.alive || other.inVehicle || other.faction === soldier.faction) continue;
    const d = Math.hypot(other.x - soldier.x, other.y - soldier.y);
    if (d < nearestDist) {
      if (!environment || typeof environment.hasLineOfSight !== 'function' || environment.hasLineOfSight(soldier.x, soldier.y, other.x, other.y)) {
        nearestDist = d;
        nearestEnemy = other;
      }
    }
  }

  // 2. Active SIDEARM emergency response state
  if (inv.activeMode === 'SIDEARM') {
    if (!nearestEnemy || nearestDist > 115 || inv.sidearmMag <= 0 || inv.sidearmShotsLeft <= 0) {
      inv.activeMode = inv.hasBayonet ? 'BAYONET' : 'PRIMARY';
      if (inv.hasBayonet) inv.bayonetEquipped = true;
      return false;
    }
    const targetAng = Math.atan2(nearestEnemy.y - soldier.y, nearestEnemy.x - soldier.x);
    soldier.angle = targetAng;
    soldier.baseAngle = targetAng;
    inv.sidearmTimer -= dt;
    if (inv.sidearmTimer <= 0) {
      inv.sidearmMag -= 1;
      inv.sidearmShotsLeft -= 1;
      inv.sidearmTimer = 0.24;
      const mx = soldier.x + Math.cos(targetAng) * 14;
      const my = soldier.y + Math.sin(targetAng) * 14;
      const spread = (Math.random() - 0.5) * 0.06;
      if (projectiles?.spawnRifleBullet) {
        projectiles.spawnRifleBullet(mx, my, targetAng + spread, 'SMG_762_25', soldier.faction, soldier.id, 620, 12);
      }
      sound?.playRifleShot?.('PPSH_41', mx, my, listenerX, listenerY, false, 'open');
      if (inv.sidearmShotsLeft <= 0) {
        inv.activeMode = inv.hasBayonet ? 'BAYONET' : 'PRIMARY';
        if (inv.hasBayonet) inv.bayonetEquipped = true;
      }
    }
    return true;
  }

  // 3. Close-Quarters Combat Initiation (<= 88px)
  if (nearestEnemy && nearestDist <= 88 && !soldier.wounded) {
    // Check 25% emergency sidearm response if enemy suddenly closed within 72px before bayonet was ready
    if (nearestDist <= 72 && !inv.bayonetEquipped && inv.activeMode === 'PRIMARY') {
      if (evaluateEmergencySidearmRoll(soldier, nearestEnemy)) {
        inv.activeMode = 'SIDEARM';
        inv.sidearmTimer = 0.22;
        inv.sidearmShotsLeft = Math.min(2, inv.sidearmMag);
        return true;
      }
    }

    if (inv.hasBayonet) {
      inv.bayonetEquipped = true;
      inv.activeMode = 'BAYONET';
      inv.meleeTarget = nearestEnemy;

      const ang = Math.atan2(nearestEnemy.y - soldier.y, nearestEnemy.x - soldier.x);
      soldier.angle = ang;
      soldier.baseAngle = ang;

      if (nearestDist > 25) {
        // Charge forward with slight defensive weave
        const spd = (soldier.moveSpeed || 54) * 1.12;
        soldier._movePhase = (soldier._movePhase || 0) + dt * 11;
        inv.meleeDodgeOffset = Math.sin(soldier._movePhase * 1.4) * 2.2;
        const perpX = -Math.sin(ang);
        const perpY = Math.cos(ang);
        soldier.x += Math.cos(ang) * spd * dt + perpX * inv.meleeDodgeOffset * dt * 2;
        soldier.y += Math.sin(ang) * spd * dt + perpY * inv.meleeDodgeOffset * dt * 2;
      } else if (inv.meleeCooldown <= 0) {
        // Execute bayonet thrust
        inv.meleeCooldown = 0.85;
        inv.meleeLungePhase = 1.0;
        nearestEnemy.takeDamage(16, particles, nearestEnemy.x, nearestEnemy.y, ang, 'rifle', null);
      }
      return true;
    }
  } else if (inv.activeMode === 'BAYONET' && (!nearestEnemy || nearestDist > 110)) {
    inv.activeMode = 'PRIMARY';
    inv.meleeTarget = null;
  }

  // 4. AI Throwable Weapon Evaluation (Frag Grenades & Incendiaries, 78..240px range)
  if (!soldier.isPlayerControlled && inv.throwCooldown <= 0 && (inv.fragGrenades > 0 || inv.incendiaries > 0) && throwableManager) {
    const hasFriendlyNear = (tx, ty, safeR) => {
      for (const f of infantry) {
        if (!f || !f.alive || f.faction !== soldier.faction) continue;
        if (Math.hypot(f.x - tx, f.y - ty) < safeR) return true;
      }
      for (const ft of tanks) {
        if (!ft || ft.destroyed || ft.faction !== soldier.faction) continue;
        if (Math.hypot(ft.x - tx, ft.y - ty) < safeR + 40) return true;
      }
      return false;
    };

    // A) Check incendiary target (enemy tank, HMG emplacement, or artillery gun within 75..215px)
    if (inv.incendiaries > 0) {
      let incTarget = null;
      for (const t of tanks) {
        if (!t || t.faction === soldier.faction || t.destroyed || t.damageSystem?.vehicleDestroyed) continue;
        const d = Math.hypot(t.x - soldier.x, t.y - soldier.y);
        if (d >= 75 && d <= 215 && !hasFriendlyNear(t.x, t.y, 58)) {
          incTarget = t;
          break;
        }
      }
      if (!incTarget) {
        for (const emp of [...heavyMGs, ...artilleryGuns]) {
          if (!emp || emp.destroyed || emp.faction === soldier.faction) continue;
          const d = Math.hypot(emp.x - soldier.x, emp.y - soldier.y);
          if (d >= 75 && d <= 220 && !hasFriendlyNear(emp.x, emp.y, 55)) {
            incTarget = emp;
            break;
          }
        }
      }
      if (incTarget) {
        inv.incendiaries -= 1;
        inv.activeMode = 'THROWING';
        inv.throwTimer = 0.42;
        inv.throwCooldown = 7.0;
        soldier.angle = Math.atan2(incTarget.y - soldier.y, incTarget.x - soldier.x);
        throwableManager.spawnThrowable({
          kind: 'incendiary',
          weaponId: inv.incendiaryId,
          faction: soldier.faction,
          owner: soldier,
          startX: soldier.x,
          startY: soldier.y,
          targetX: incTarget.x,
          targetY: incTarget.y,
        });
        return true;
      }
    }

    // B) Check fragmentation grenade target (exposed enemy infantry/crew within 85..235px)
    if (inv.fragGrenades > 0 && nearestEnemy && nearestDist >= 85 && nearestDist <= 235) {
      if (!hasFriendlyNear(nearestEnemy.x, nearestEnemy.y, 78)) {
        inv.fragGrenades -= 1;
        inv.activeMode = 'THROWING';
        inv.throwTimer = 0.42;
        inv.throwCooldown = 6.5;
        soldier.angle = Math.atan2(nearestEnemy.y - soldier.y, nearestEnemy.x - soldier.x);
        throwableManager.spawnThrowable({
          kind: 'frag',
          weaponId: inv.fragGrenadeId,
          faction: soldier.faction,
          owner: soldier,
          startX: soldier.x,
          startY: soldier.y,
          targetX: nearestEnemy.x,
          targetY: nearestEnemy.y,
        });
        return true;
      }
    }
  }

  return false;
}
