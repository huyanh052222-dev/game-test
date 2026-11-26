/**
 * Central configuration for the T-34-85 Top-Down Tank Simulator.
 * All physics, weapon, overheat, map, and visual parameters are defined here.
 */

export const CONFIG = {
  // Simulation & World (3x3 Technical Lab Grid)
  WORLD: {
    GRID_COLS: 3,
    GRID_ROWS: 3,
    CELL_SIZE: 1200,
    get WIDTH() {
      return this.GRID_COLS * this.CELL_SIZE;
    },
    get HEIGHT() {
      return this.GRID_ROWS * this.CELL_SIZE;
    },
    SUBGRID_STEP: 200,
    BORDER_PADDING: 70,
  },

  // Camera
  CAMERA: {
    FOLLOW_LERP: 8.5, // Smooth tracking responsiveness
    RECOIL_SHAKE_DECAY: 18,
    CANNON_SHAKE_AMOUNT: 7.5,
  },

  // T-34-85 Hull & Mobility (32t, V-2-34 500hp, clutch-and-brake steering)
  TANK: {
    SCALE: 1.05,
    PIXELS_PER_METER: 37.8, // 231px hull / 6.10m = 37.87 px/m; 113.4px width / 3.00m = 37.80 px/m
    START_X: 1800,
    START_Y: 1800,
    START_ANGLE: -Math.PI / 2, // Facing North (Up)
    COLLISION_RADIUS: 58,

    // Linear motion (pixels/sec & pixels/sec^2)
    MAX_FORWARD_SPEED: 225, // ~53 km/h scaled
    MAX_REVERSE_SPEED: 115,
    ACCELERATION: 210,
    REVERSE_ACCELERATION: 150,
    BRAKE_DECELERATION: 340,
    COAST_DRAG: 140,
    CORNERING_SCRUB_DRAG: 38, // Band-brake speed bleed during turns

    // Speed-dependent angular motion (rad/s & rad/s^2)
    PIVOT_TURN_SPEED: 0.44,       // Stationary pivot (~25.2 deg/s, heavy track resistance)
    LOW_SPEED_TURN_SPEED: 0.78,   // Tight turn around 10-15 km/h (~44.7 deg/s)
    HIGH_SPEED_TURN_SPEED: 0.38,  // Wide road-speed arc at 53 km/h (~21.8 deg/s)
    MAX_TURN_SPEED: 0.78,         // Peak angular rate ceiling for audio/HUD ratios
    TURN_ACCELERATION: 1.55,      // Gradual rotational buildup for 32t hull
    TURN_DRAG: 3.6,               // Natural rotational coast-down

    // Display conversion: px/s -> km/h (225 px/s ≈ 53 km/h)
    SPEED_TO_KMH: 53 / 225,

    // Geometry offsets in local tank space (scaled by SCALE at runtime)
    TURRET_OFFSET_X: 14,
    TURRET_OFFSET_Y: 0,
    HULL_MG_OFFSET_X: 82,
    HULL_MG_OFFSET_Y: 16,
    HULL_MG_MUZZLE_LENGTH: 14,
    TRACK_OFFSET_Y: 45,
    TRACK_WIDTH: 18,
  },

  // Turret (T-34-85 Model 1944 powered: 360 deg in ~21s ≈ 17.14 deg/s; manual: ~2.8 deg/s)
  TURRET: {
    ROTATE_SPEED: (Math.PI * 2) / 21, // ~0.2992 rad/s (17.14 deg/s)
    ROTATE_ACCEL: 0.72,               // Gradual electric motor ramp-up
    ROTATE_DRAG: 7.5,                 // Smooth mechanical coast-down
    MANUAL_ROTATE_SPEED: (2.8 * Math.PI) / 180, // ~0.0489 rad/s (2.80 deg/s tuning)
    MANUAL_ROTATE_ACCEL: 0.14,
    MANUAL_ROTATE_DRAG: 4.5,
    BARREL_MUZZLE_LENGTH: 156, // Distance from turret pivot to 85mm muzzle tip
    COAX_OFFSET_X: 60, // Forward from turret pivot to compact coax MG muzzle
    COAX_OFFSET_Y: 11, // Right (+Y) of main 85mm gun in mantlet, parallel
  },

  // 85mm ZiS-S-53 Main Cannon
  MAIN_GUN: {
    AMMO_MAX: 56,
    RELOAD_TIME: 8.5, // Seconds (8-10s requirement)
    PROJECTILE_SPEED: 1450,
    PROJECTILE_LIFETIME: 2.2,
    PROJECTILE_RADIUS: 4.2,
    RECOIL_DISTANCE: 14,
    RECOIL_RECOVERY_SPEED: 26,
    HULL_IMPULSE: 18,
  },

  // Dual 7.62mm DT Machine Guns (Coaxial + Front Hull)
  MG: {
    TOTAL_AMMO_MAX: 1890, // 30 magazines x 63 rounds
    MAGAZINE_SIZE: 63,
    MAGAZINE_COUNT: 30,
    MAG_RELOAD_TIME: 1.8, // Seconds to swap a 63-round pan magazine
    RPM: 600,             // 10 rounds/sec
    get FIRE_INTERVAL() {
      return 60 / this.RPM;
    },
    PROJECTILE_SPEED: 1650,
    PROJECTILE_LIFETIME: 1.15,
    SPREAD_RAD: 0.032,

    // Overheat system (independent per MG)
    HEAT_MAX: 100,
    HEAT_PER_SHOT: 2.8,
    COOL_RATE: 24,            // Heat units per second when not firing
    OVERHEAT_COOL_RATE: 28,   // Slightly faster venting when locked out
    RECOVERY_THRESHOLD: 30,   // Must cool to <= 30% after overheating
  },

  // Particle System Limits
  PARTICLES: {
    MAX_COUNT: 350,
  },
};
