/**
 * Sequential Manual Transmission, Engine RPM & Torque Drivetrain Simulation
 * - Separate historical/gameplay configurations for T-34-85 (V-2-34 Diesel, 5-spd)
 *   and Panzer III Ausf. L (Maybach HL 120 TRM, ZF SSG 77)
 * - Delta-time physics with shifting intervals, clutch slip, engine braking,
 *   terrain rolling resistance, and damage integration
 */

export const GEAR_ORDER = ['R', 'N', '1', '2', '3', '4', '5'];

export const DRIVETRAIN_PRESETS = {
  T34_85: {
    id: 'T34_85',
    name: 'V-2-34 Diesel // 5-Speed Manual',
    massKg: 32000,
    idleRpm: 600,
    maxRpm: 1900,
    redlineRpm: 2050,
    baseAccelForce: 235,
    shiftDuration: 0.34,
    engineBrakeFactor: 52,
    gears: {
      R: { label: 'R', dir: -1, maxSpeed: 42, torqueMult: 3.4 },
      N: { label: 'N', dir: 0, maxSpeed: 0, torqueMult: 0 },
      '1': { label: '1', dir: 1, maxSpeed: 38, torqueMult: 3.6 },
      '2': { label: '2', dir: 1, maxSpeed: 76, torqueMult: 2.25 },
      '3': { label: '3', dir: 1, maxSpeed: 124, torqueMult: 1.48 },
      '4': { label: '4', dir: 1, maxSpeed: 176, torqueMult: 1.06 },
      '5': { label: '5', dir: 1, maxSpeed: 225, torqueMult: 0.80 },
    },
  },
  PANZER_III_L: {
    id: 'PANZER_III_L',
    name: 'Maybach HL 120 TRM // ZF SSG 77',
    massKg: 22300,
    idleRpm: 750,
    maxRpm: 3000,
    redlineRpm: 3200,
    baseAccelForce: 205,
    shiftDuration: 0.24,
    engineBrakeFactor: 44,
    gears: {
      R: { label: 'R', dir: -1, maxSpeed: 36, torqueMult: 3.3 },
      N: { label: 'N', dir: 0, maxSpeed: 0, torqueMult: 0 },
      '1': { label: '1', dir: 1, maxSpeed: 34, torqueMult: 3.5 },
      '2': { label: '2', dir: 1, maxSpeed: 66, torqueMult: 2.3 },
      '3': { label: '3', dir: 1, maxSpeed: 102, torqueMult: 1.55 },
      '4': { label: '4', dir: 1, maxSpeed: 140, torqueMult: 1.12 },
      '5': { label: '5', dir: 1, maxSpeed: 172, torqueMult: 0.85 },
    },
  },
};

export class DrivetrainController {
  constructor(presetKey = 'T34_85', initialGear = 'N') {
    this.preset = DRIVETRAIN_PRESETS[presetKey] || DRIVETRAIN_PRESETS.T34_85;
    this.gear = this.preset.gears[initialGear] ? initialGear : 'N';
    this.rpm = 0;
    this.throttle = 0;
    this.load = 0;
    this.isShifting = false;
    this.shiftTimer = 0;
    this.pendingGear = null;
    this.torqueRestore = 1.0;
    this.onShift = null; // optional callback(fromGear, toGear)
  }

  get maxForwardSpeed() {
    return this.preset.gears['5'].maxSpeed;
  }

  get maxReverseSpeed() {
    return this.preset.gears.R.maxSpeed;
  }

  get currentGearConfig() {
    return this.preset.gears[this.gear] || this.preset.gears.N;
  }

  requestShiftTo(targetGear, currentSpeed = 0) {
    if (!this.preset.gears[targetGear]) return false;
    const activeTarget = this.isShifting ? this.pendingGear : this.gear;
    if (targetGear === activeTarget) return false;

    // Prevent engaging Reverse at high forward speed (> 18 px/s)
    if (targetGear === 'R' && currentSpeed > 18) {
      return false;
    }
    // Prevent engaging forward gear while moving fast in reverse
    if (this.preset.gears[targetGear].dir > 0 && currentSpeed < -18) {
      return false;
    }

    const fromGear = activeTarget;
    this.pendingGear = targetGear;
    this.isShifting = true;
    this.shiftTimer = targetGear === 'N' ? this.preset.shiftDuration * 0.55 : this.preset.shiftDuration;
    this.torqueRestore = 0;
    if (this.onShift) this.onShift(fromGear, targetGear);
    return true;
  }

  shiftUp(currentSpeed = 0) {
    const cur = this.isShifting ? this.pendingGear : this.gear;
    const idx = GEAR_ORDER.indexOf(cur);
    if (idx === -1 || idx >= GEAR_ORDER.length - 1) return false;
    return this.requestShiftTo(GEAR_ORDER[idx + 1], currentSpeed);
  }

  shiftDown(currentSpeed = 0) {
    const cur = this.isShifting ? this.pendingGear : this.gear;
    const idx = GEAR_ORDER.indexOf(cur);
    if (idx <= 0) return false;
    return this.requestShiftTo(GEAR_ORDER[idx - 1], currentSpeed);
  }

  /**
   * AI helper for Panzer III: selects appropriate sequential gear for desired movement.
   */
  aiUpdateGear(desiredDir, currentSpeed) {
    if (this.isShifting) return;
    if (desiredDir === 0) {
      if (Math.abs(currentSpeed) < 6 && this.gear !== 'N') {
        this.requestShiftTo('N', currentSpeed);
      }
      return;
    }
    if (desiredDir < 0) {
      if (this.gear !== 'R' && currentSpeed <= 18) {
        this.requestShiftTo('R', currentSpeed);
      }
      return;
    }
    // Forward
    if (this.gear === 'N' || this.gear === 'R') {
      if (currentSpeed >= -18) this.requestShiftTo('1', currentSpeed);
      return;
    }
    const gCfg = this.currentGearConfig;
    const rpmNorm = (this.rpm - this.preset.idleRpm) / Math.max(1, this.preset.maxRpm - this.preset.idleRpm);
    if (rpmNorm > 0.88 && Math.abs(currentSpeed) > gCfg.maxSpeed * 0.84) {
      this.shiftUp(currentSpeed);
    } else if (rpmNorm < 0.25 && this.gear !== '1' && Math.abs(currentSpeed) < gCfg.maxSpeed * 0.42) {
      this.shiftDown(currentSpeed);
    }
  }

  update(dt, {
    engineRunning = true,
    canDrive = true,
    throttleInput = 0, // 0..1
    brakeInput = 0,    // 0..1
    currentSpeed = 0,
    enginePowerMult = 1.0,
    trackSpeedMult = 1.0,
    surface = 'NORMAL',
    slopeDeg = 0,
    bothTracksBroken = false,
  }) {
    const p = this.preset;

    if (!engineRunning || enginePowerMult <= 0) {
      this.rpm = Math.max(0, this.rpm - 1200 * dt);
      this.throttle = 0;
      this.load = 0;
      const decel = (bothTracksBroken ? 320 : 120) * dt;
      let nextSpeed = currentSpeed;
      if (nextSpeed > 0) nextSpeed = Math.max(0, nextSpeed - decel);
      else if (nextSpeed < 0) nextSpeed = Math.min(0, nextSpeed + decel);
      return nextSpeed;
    }

    // Smooth throttle pedal
    const targetThrottle = canDrive ? Math.max(0, Math.min(1, throttleInput)) : 0;
    this.throttle += (targetThrottle - this.throttle) * (1 - Math.exp(-10 * dt));

    // Handle active shift timer
    if (this.isShifting) {
      this.shiftTimer -= dt;
      if (this.shiftTimer <= 0) {
        this.gear = this.pendingGear;
        this.pendingGear = null;
        this.isShifting = false;
        this.shiftTimer = 0;
      }
    } else if (this.torqueRestore < 1.0) {
      this.torqueRestore = Math.min(1.0, this.torqueRestore + dt * 5.5);
    }

    // Terrain rolling resistance & traction
    let rollingRes = 26;
    let tractionMult = 1.0;
    if (surface === 'MUD') { rollingRes = 78; tractionMult = 0.52; }
    else if (surface === 'SAND') { rollingRes = 56; tractionMult = 0.78; }
    else if (surface === 'DIRT') { rollingRes = 32; tractionMult = 0.96; }
    else if (surface === 'GRASS') { rollingRes = 30; tractionMult = 0.95; }

    const gCfg = this.currentGearConfig;
    const gearDir = this.isShifting ? 0 : gCfg.dir;

    // Torque curve peaks in mid-range RPM (0.45..0.85)
    const rpmNorm = Math.max(0, Math.min(1.1, (this.rpm - p.idleRpm) / Math.max(1, p.maxRpm - p.idleRpm)));
    const torqueCurve = 0.68 + Math.sin(Math.min(1, rpmNorm) * Math.PI * 0.85) * 0.42;

    let netAccel = 0;
    if (gearDir !== 0 && canDrive && !this.isShifting && trackSpeedMult > 0) {
      const effectiveMax = gCfg.maxSpeed * enginePowerMult * trackSpeedMult * (surface === 'MUD' ? 0.56 : surface === 'SAND' ? 0.82 : 1.0);
      const speedInGear = currentSpeed * gearDir;
      const govStart = effectiveMax * 0.88;
      const govSpan = Math.max(4, effectiveMax * 0.14);
      const overSpeed = speedInGear > govStart ? Math.min(1, (speedInGear - govStart) / govSpan) : 0;

      const driveForce =
        this.throttle *
        p.baseAccelForce *
        gCfg.torqueMult *
        torqueCurve *
        enginePowerMult *
        trackSpeedMult *
        tractionMult *
        this.torqueRestore *
        (1 - overSpeed);

      netAccel += gearDir * driveForce;

      // Engine braking when off throttle or over-revving in a lower gear
      if (this.throttle < 0.08 || overSpeed > 0.05) {
        const brakeStrength = p.engineBrakeFactor * (0.45 + gCfg.torqueMult * 0.28) * (1 + overSpeed * 2.2);
        if (Math.abs(currentSpeed) > 0.5) {
          netAccel -= Math.sign(currentSpeed) * brakeStrength;
        }
      }
    }

    // Slope resistance (uphill > 0 slows, downhill < 0 assists)
    if (slopeDeg !== 0) {
      netAccel -= Math.sin((slopeDeg * Math.PI) / 180) * 180;
    }

    // Rolling resistance, aerodynamic drag & player/broken-track braking
    const brakeAccel = (brakeInput * 320) + (bothTracksBroken ? 320 : 0);
    const resist = rollingRes + Math.abs(currentSpeed) * 0.22 + brakeAccel;

    let nextSpeed = currentSpeed + netAccel * dt;
    if (Math.abs(nextSpeed) <= resist * dt && Math.abs(netAccel) < resist) {
      nextSpeed = 0;
    } else if (Math.abs(nextSpeed) > 0) {
      const sign = Math.sign(nextSpeed);
      nextSpeed -= sign * resist * dt;
      if (Math.sign(nextSpeed) !== sign) nextSpeed = 0;
    }

    // Hard physical speed bounds
    nextSpeed = Math.max(-p.gears.R.maxSpeed * 1.15, Math.min(p.gears['5'].maxSpeed * 1.05, nextSpeed));

    // Engine RPM & Load update
    let targetRpm = p.idleRpm + this.throttle * (p.maxRpm - p.idleRpm) * 0.85;
    if (gearDir !== 0 && !this.isShifting && gCfg.maxSpeed > 0) {
      const ratio = Math.abs(nextSpeed) / gCfg.maxSpeed;
      const wheelRpm = p.idleRpm + ratio * (p.maxRpm - p.idleRpm);
      const launchSlip = Math.max(0, 1 - Math.abs(nextSpeed) / 14);
      targetRpm = wheelRpm * (1 - launchSlip) + (p.idleRpm + this.throttle * 650) * launchSlip;
    }
    targetRpm = Math.max(p.idleRpm, Math.min(p.redlineRpm, targetRpm));

    const rpmLerp = 1 - Math.exp(-(targetRpm > this.rpm ? 6.5 : 4.2) * dt);
    this.rpm += (targetRpm - this.rpm) * rpmLerp;
    this.rpm = Math.max(p.idleRpm, Math.min(p.redlineRpm, this.rpm));

    // Engine load (higher in mud/sand, uphill, or heavy throttle at low RPM)
    const surfLoad = surface === 'MUD' ? 0.35 : surface === 'SAND' ? 0.2 : 0;
    const targetLoad =
      gearDir === 0 || this.isShifting
        ? this.throttle * 0.25
        : Math.min(1, this.throttle * (0.45 + surfLoad + (1 - Math.min(1, rpmNorm)) * 0.35));
    this.load += (targetLoad - this.load) * (1 - Math.exp(-5.0 * dt));

    return nextSpeed;
  }
}
