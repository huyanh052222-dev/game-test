/**
 * Data-driven vehicle armor zones & internal module layouts.
 * Note on Panzer III: Exact variant is marked UNCONFIRMED; values below use a
 * clearly documented provisional Ausf. L preset with spaced frontal armor layers.
 */

export const MODULE_STATE = {
  NORMAL: 'NORMAL',
  DAMAGED: 'DAMAGED',
  CRITICAL: 'CRITICAL',
  DESTROYED: 'DESTROYED',
};

export const VEHICLE_ARMOR_PRESETS = {
  T34_85_1944: {
    id: 'T34_85_1944',
    name: 'T-34-85 Model 1944',
    variantStatus: 'CONFIRMED',
    hullBounds: { halfLength: 110, halfWidth: 54 },
    turretPivotLocal: { x: 14, y: 0 },
    turretRadius: 34,
    zones: {
      HULL_UPPER_FRONT: { label: 'Upper Front Glacis', thicknessMm: 45, slopeDeg: 60, materialMod: 1.0, spacedMm: 0 },
      HULL_LOWER_FRONT: { label: 'Lower Front Plate', thicknessMm: 45, slopeDeg: 53, materialMod: 1.0, spacedMm: 0 },
      HULL_LEFT: { label: 'Hull Left Side', thicknessMm: 45, slopeDeg: 40, materialMod: 1.0, spacedMm: 0 },
      HULL_RIGHT: { label: 'Hull Right Side', thicknessMm: 45, slopeDeg: 40, materialMod: 1.0, spacedMm: 0 },
      HULL_REAR: { label: 'Hull Rear Plate', thicknessMm: 45, slopeDeg: 45, materialMod: 1.0, spacedMm: 0 },
      HULL_ROOF: { label: 'Hull Roof', thicknessMm: 20, slopeDeg: 0, materialMod: 1.0, spacedMm: 0 },
      HULL_FLOOR: { label: 'Hull Floor', thicknessMm: 20, slopeDeg: 0, materialMod: 1.0, spacedMm: 0 },
      TURRET_MANTLET: { label: 'Gun Mantlet', thicknessMm: 90, slopeDeg: 15, materialMod: 1.0, spacedMm: 0 },
      TURRET_FRONT: { label: 'Turret Front', thicknessMm: 90, slopeDeg: 30, materialMod: 1.0, spacedMm: 0 },
      TURRET_LEFT: { label: 'Turret Left Cheek', thicknessMm: 75, slopeDeg: 20, materialMod: 1.0, spacedMm: 0 },
      TURRET_RIGHT: { label: 'Turret Right Cheek', thicknessMm: 75, slopeDeg: 20, materialMod: 1.0, spacedMm: 0 },
      TURRET_REAR: { label: 'Turret Rear Bustle', thicknessMm: 52, slopeDeg: 10, materialMod: 1.0, spacedMm: 0 },
      TURRET_ROOF: { label: 'Turret Roof', thicknessMm: 20, slopeDeg: 0, materialMod: 1.0, spacedMm: 0 },
    },
    modules: [
      // Tracks (hull-local)
      { id: 'LEFT_TRACK', label: 'Left Track', category: 'track', part: 'hull', lx: 0, ly: -47, radius: 16, halfLen: 108, halfWid: 9, maxHp: 110 },
      { id: 'RIGHT_TRACK', label: 'Right Track', category: 'track', part: 'hull', lx: 0, ly: 47, radius: 16, halfLen: 108, halfWid: 9, maxHp: 110 },
      // Powertrain (hull-local)
      { id: 'ENGINE', label: 'V-2-34 Diesel Engine', category: 'powertrain', part: 'hull', lx: -55, ly: 0, radius: 20, maxHp: 120 },
      { id: 'TRANSMISSION', label: 'Transmission / Gearbox', category: 'powertrain', part: 'hull', lx: -88, ly: 0, radius: 17, maxHp: 100 },
      // Main Gun Barrel (turret-local)
      { id: 'GUN_BARREL', label: '85mm ZiS-S-53 Barrel', category: 'weapon', part: 'turret', lx: 78, ly: 0, radius: 14, maxHp: 90 },
      // Optics & Vision Devices
      { id: 'GUNNER_OPTICS', label: 'Gunner Sight (TSh-16)', category: 'optics', part: 'turret', lx: 18, ly: -18, radius: 9, maxHp: 50 },
      { id: 'COMMANDER_OPTICS', label: 'Commander Cupola', category: 'optics', part: 'turret', lx: -14, ly: -20, radius: 9, maxHp: 50 },
      { id: 'DRIVER_VISION', label: 'Driver Vision Periscope', category: 'optics', part: 'hull', lx: 82, ly: -16, radius: 9, maxHp: 50 },
      // Ammunition Racks
      { id: 'AMMO_FLOOR', label: 'Hull Floor Ammo Rack', category: 'ammo', part: 'hull', lx: -4, ly: 0, radius: 14, maxHp: 75 },
      { id: 'AMMO_SPONSON_L', label: 'Left Sponson Ammo Rack', category: 'ammo', part: 'hull', lx: 10, ly: -27, radius: 13, maxHp: 75 },
      { id: 'AMMO_SPONSON_R', label: 'Right Sponson Ammo Rack', category: 'ammo', part: 'hull', lx: 10, ly: 27, radius: 13, maxHp: 75 },
      { id: 'AMMO_TURRET', label: 'Turret Ready Rack', category: 'ammo', part: 'turret', lx: -30, ly: 0, radius: 14, maxHp: 75 },
      // 5 Crew Members
      { id: 'DRIVER', label: 'Driver', category: 'crew', part: 'hull', lx: 68, ly: -16, radius: 9, maxHp: 60 },
      { id: 'RADIO_OP', label: 'Radio Op / Hull MG', category: 'crew', part: 'hull', lx: 68, ly: 16, radius: 9, maxHp: 60 },
      { id: 'GUNNER', label: 'Gunner', category: 'crew', part: 'turret', lx: 10, ly: -19, radius: 9, maxHp: 60 },
      { id: 'COMMANDER', label: 'Commander', category: 'crew', part: 'turret', lx: -12, ly: -20, radius: 9, maxHp: 60 },
      { id: 'LOADER', label: 'Loader', category: 'crew', part: 'turret', lx: -4, ly: 21, radius: 9, maxHp: 60 },
    ],
  },

  PANZER_III_PROVISIONAL: {
    id: 'PANZER_III_PROVISIONAL',
    name: 'Panzer III (Provisional Ausf. L)',
    variantStatus: 'UNCONFIRMED (Provisional Ausf. L preset)',
    hullBounds: { halfLength: 100, halfWidth: 53 },
    turretPivotLocal: { x: 8, y: 0 },
    turretRadius: 34,
    zones: {
      HULL_UPPER_FRONT: { label: 'Upper Front + Spaced', thicknessMm: 50, slopeDeg: 10, materialMod: 1.0, spacedMm: 20 },
      HULL_LOWER_FRONT: { label: 'Lower Front + Spaced', thicknessMm: 50, slopeDeg: 20, materialMod: 1.0, spacedMm: 20 },
      HULL_LEFT: { label: 'Hull Left Side', thicknessMm: 30, slopeDeg: 0, materialMod: 1.0, spacedMm: 0 },
      HULL_RIGHT: { label: 'Hull Right Side', thicknessMm: 30, slopeDeg: 0, materialMod: 1.0, spacedMm: 0 },
      HULL_REAR: { label: 'Hull Rear Plate', thicknessMm: 30, slopeDeg: 8, materialMod: 1.0, spacedMm: 0 },
      HULL_ROOF: { label: 'Hull Roof', thicknessMm: 16, slopeDeg: 0, materialMod: 1.0, spacedMm: 0 },
      HULL_FLOOR: { label: 'Hull Floor', thicknessMm: 16, slopeDeg: 0, materialMod: 1.0, spacedMm: 0 },
      TURRET_MANTLET: { label: 'Gun Mantlet + Spaced', thicknessMm: 57, slopeDeg: 0, materialMod: 1.0, spacedMm: 20 },
      TURRET_FRONT: { label: 'Turret Front', thicknessMm: 57, slopeDeg: 8, materialMod: 1.0, spacedMm: 0 },
      TURRET_LEFT: { label: 'Turret Left Side', thicknessMm: 30, slopeDeg: 25, materialMod: 1.0, spacedMm: 0 },
      TURRET_RIGHT: { label: 'Turret Right Side', thicknessMm: 30, slopeDeg: 25, materialMod: 1.0, spacedMm: 0 },
      TURRET_REAR: { label: 'Turret Rear', thicknessMm: 30, slopeDeg: 10, materialMod: 1.0, spacedMm: 0 },
      TURRET_ROOF: { label: 'Turret Roof', thicknessMm: 10, slopeDeg: 0, materialMod: 1.0, spacedMm: 0 },
    },
    // Internal modules in Panzer III (Ausf. L provisional) local coordinates (unscaled SVG units)
    modules: [
      { id: 'LEFT_TRACK', label: 'Left Track & Sprocket', category: 'track', lx: 0, ly: -46, radius: 15, maxHp: 110 },
      { id: 'RIGHT_TRACK', label: 'Right Track & Sprocket', category: 'track', lx: 0, ly: 46, radius: 15, maxHp: 110 },
      { id: 'ENGINE', label: 'Engine (Maybach HL 120 TRM)', category: 'powertrain', lx: -62, ly: 0, radius: 18, maxHp: 100 },
      { id: 'RADIATOR', label: 'Cooling Radiators & Fans', category: 'powertrain', lx: -62, ly: 24, radius: 11, maxHp: 65 },
      { id: 'FUEL_TANK', label: 'Fuel Tanks', category: 'fuel', lx: -42, ly: -22, radius: 14, maxHp: 75 },
      { id: 'TRANSMISSION', label: 'ZF SSG 77 Transmission (Front)', category: 'powertrain', lx: 76, ly: 0, radius: 16, maxHp: 100 },
      { id: 'BREECH', label: '5cm KwK 38/39 Breech', category: 'weapon', lx: 18, ly: 0, radius: 12, maxHp: 90 },
      { id: 'TURRET_RING', label: 'Turret Traverse Ring', category: 'turret', lx: 8, ly: 0, radius: 22, maxHp: 100 },
      { id: 'AMMO_RACK', label: '5cm Left Sponson Ammo', category: 'ammo', lx: -8, ly: -26, radius: 14, maxHp: 75 },
      { id: 'AMMO_RACK_R', label: '5cm Right Sponson Ammo', category: 'ammo', lx: -8, ly: 26, radius: 14, maxHp: 75 },
      { id: 'DRIVER', label: 'Driver', category: 'crew', lx: 56, ly: -16, radius: 8, maxHp: 50 },
      { id: 'RADIO_OP', label: 'Radio Operator / Hull MG', category: 'crew', lx: 56, ly: 16, radius: 8, maxHp: 50 },
      { id: 'GUNNER', label: 'Gunner', category: 'crew', lx: 14, ly: -17, radius: 8, maxHp: 50 },
      { id: 'COMMANDER', label: 'Commander', category: 'crew', lx: -14, ly: 0, radius: 8, maxHp: 50 },
      { id: 'LOADER', label: 'Loader', category: 'crew', lx: 10, ly: 17, radius: 8, maxHp: 50 },
    ],
  },
};
