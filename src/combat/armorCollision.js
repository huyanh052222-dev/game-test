/**
 * Armor zone & surface normal collision resolver in target-local coordinates.
 * Angle convention:
 * - impactAngleDeg = angle between incoming velocity vector (-dir) and outward plate normal (0° = perpendicular, 90° = grazing).
 */

export function resolveArmorImpact(target, projectile) {
  const cos = Math.cos(-target.angle);
  const sin = Math.sin(-target.angle);

  const toLocal = (wx, wy) => {
    const dx = wx - target.x;
    const dy = wy - target.y;
    return {
      x: (dx * cos - dy * sin) / target.scale,
      y: (dx * sin + dy * cos) / target.scale,
    };
  };

  const entry = toLocal(projectile.x, projectile.y);
  const prev = toLocal(projectile.prevX ?? projectile.x, projectile.prevY ?? projectile.y);

  // Incoming projectile travel direction in target-local space
  let vx = entry.x - prev.x;
  let vy = entry.y - prev.y;
  const vLen = Math.hypot(vx, vy) || 1;
  vx /= vLen;
  vy /= vLen;

  const preset = target.armorPreset;
  const { halfLength, halfWidth } = preset.hullBounds;

  // Determine which hull edge was crossed (or closest edge)
  const dxFront = halfLength - entry.x;
  const dxRear = entry.x + halfLength;
  const dyLeft = entry.y + halfWidth;
  const dyRight = halfWidth - entry.y;

  const minEdge = Math.min(dxFront, dxRear, dyLeft, dyRight);
  let zoneKey = 'HULL_UPPER_FRONT';
  let nx = 1;
  let ny = 0;

  if (minEdge === dxFront) {
    // Check if shot hit near turret height/mantlet area
    const tp = preset.turretPivotLocal;
    if (Math.abs(entry.y - tp.y) < 15 && entry.x < tp.x + 48) {
      zoneKey = 'TURRET_MANTLET';
    } else if (Math.abs(entry.y - tp.y) < 28 && entry.x < tp.x + 44) {
      zoneKey = 'TURRET_FRONT';
    } else {
      zoneKey = entry.y < 0 ? 'HULL_UPPER_FRONT' : 'HULL_LOWER_FRONT';
    }
    nx = 1;
    ny = 0;
  } else if (minEdge === dxRear) {
    zoneKey = 'HULL_REAR';
    nx = -1;
    ny = 0;
  } else if (minEdge === dyLeft) {
    zoneKey = Math.abs(entry.x - preset.turretPivotLocal.x) < 28 ? 'TURRET_LEFT' : 'HULL_LEFT';
    nx = 0;
    ny = -1;
  } else {
    zoneKey = Math.abs(entry.x - preset.turretPivotLocal.x) < 28 ? 'TURRET_RIGHT' : 'HULL_RIGHT';
    nx = 0;
    ny = 1;
  }

  // Angle between incoming ray (-vx, -vy) and outward normal (nx, ny) in 2D
  const dot2D = Math.max(-1, Math.min(1, -(vx * nx + vy * ny)));
  const horizAngleRad = Math.acos(Math.max(0, dot2D));

  // Combine 2D horizontal obliquity with vertical plate slope
  const zone = preset.zones[zoneKey];
  const slopeRad = ((zone.slopeDeg || 0) * Math.PI) / 180;
  const cosTotal = Math.max(0.05, Math.cos(horizAngleRad) * Math.cos(slopeRad));
  const impactAngleDeg = (Math.acos(cosTotal) * 180) / Math.PI;

  return {
    zoneKey,
    zone,
    localEntry: entry,
    localDir: { x: vx, y: vy },
    normal: { x: nx, y: ny },
    impactAngleDeg,
  };
}
