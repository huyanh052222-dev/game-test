/**
 * Probability-based ricochet evaluation dependent on projectile type,
 * impact angle from armor normal, and prior layer penetration.
 */

export function evaluateRicochet(ammo, impactAngleDeg, alreadyPenetratedLayer = false, rng = Math.random) {
  const { startDeg, halfDeg, guaranteeDeg } = ammo.ricochet;

  // After penetrating an outer spaced plate, yaw increases slightly, but
  // perpendicular shots (below startDeg) never ricochet randomly.
  const effectiveAngle = Math.max(
    0,
    impactAngleDeg - ammo.normalizationDeg + (alreadyPenetratedLayer ? 4 : 0)
  );

  let chance = 0;
  if (effectiveAngle >= guaranteeDeg) {
    chance = 1.0;
  } else if (effectiveAngle >= halfDeg) {
    chance = 0.5 + 0.5 * ((effectiveAngle - halfDeg) / Math.max(1, guaranteeDeg - halfDeg));
  } else if (effectiveAngle > startDeg) {
    chance = 0.5 * ((effectiveAngle - startDeg) / Math.max(1, halfDeg - startDeg));
  }

  const ricocheted = chance > 0 && rng() < chance;
  return { ricocheted, chance, effectiveAngleDeg: effectiveAngle };
}

export function computeDeflectionAngle(worldDirX, worldDirY, localNormal, targetAngle) {
  const cos = Math.cos(targetAngle);
  const sin = Math.sin(targetAngle);
  const wnx = localNormal.x * cos - localNormal.y * sin;
  const wny = localNormal.x * sin + localNormal.y * cos;
  const dot = worldDirX * wnx + worldDirY * wny;
  const rx = worldDirX - 2 * dot * wnx;
  const ry = worldDirY - 2 * dot * wny;
  return Math.atan2(ry, rx);
}
