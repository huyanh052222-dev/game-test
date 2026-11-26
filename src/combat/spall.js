/**
 * Internal spall cone & APHE internal explosive detonation simulator.
 * Operates in target-local unscaled coordinates.
 */
import { IMPACT_OUTCOME } from './penetration.js';

function pointToRayDist(px, py, ox, oy, dx, dy) {
  const tx = px - ox;
  const ty = py - oy;
  const proj = tx * dx + ty * dy;
  if (proj < 0) return { proj, perp: Infinity };
  const perp = Math.abs(tx * -dy + ty * dx);
  return { proj, perp };
}

export function simulateInternalDamage(ammo, collision, penResult, modules) {
  const { localEntry, localDir } = collision;
  const { outcome, remainingPenMm, fuseArmed } = penResult;
  const hits = []; // { module, damage, cause }

  if (
    outcome === IMPACT_OUTCOME.NON_PENETRATION ||
    outcome === IMPACT_OUTCOME.RICOCHET
  ) {
    return hits;
  }

  // HE non-penetrating blast only affects external/exposed modules near impact
  if (outcome === IMPACT_OUTCOME.HE_DETONATION) {
    const blastRadius = 30;
    for (const m of modules) {
      const dist = Math.hypot(m.lx - localEntry.x, m.ly - localEntry.y);
      if (dist <= blastRadius + m.radius) {
        const falloff = 1 - dist / (blastRadius + m.radius);
        hits.push({ module: m, damage: Math.round(35 * falloff), cause: 'HE Blast' });
      }
    }
    return hits;
  }

  // Partial penetration: narrow short spall behind impact point
  const maxTravel =
    outcome === IMPACT_OUTCOME.PARTIAL_PENETRATION
      ? 45
      : Math.min(200, 95 + remainingPenMm * 0.85);
  const coneHalfTan = ammo.type === 'APCR' ? 0.24 : 0.42;

  for (const m of modules) {
    const { proj, perp } = pointToRayDist(
      m.lx,
      m.ly,
      localEntry.x,
      localEntry.y,
      localDir.x,
      localDir.y
    );
    if (proj < 0 || proj > maxTravel) continue;

    const coneRadius = 4 + proj * coneHalfTan + m.radius;
    if (perp <= coneRadius) {
      const directLine = perp <= m.radius * 0.75;
      const baseDmg =
        outcome === IMPACT_OUTCOME.PARTIAL_PENETRATION
          ? 28
          : directLine
          ? 72
          : 38;
      hits.push({
        module: m,
        damage: baseDmg,
        cause: directLine ? 'Direct Hit' : 'Spall Cone',
      });
    }
  }

  // APHE internal fuse detonation inside the tank
  if (
    outcome === IMPACT_OUTCOME.PENETRATION &&
    ammo.explosiveTntGrams > 0 &&
    fuseArmed
  ) {
    const fuseDist = Math.min(maxTravel * 0.65, 36);
    const detX = localEntry.x + localDir.x * fuseDist;
    const detY = localEntry.y + localDir.y * fuseDist;
    const blastR = ammo.explosiveTntGrams >= 150 ? 52 : 38;

    for (const m of modules) {
      const d = Math.hypot(m.lx - detX, m.ly - detY);
      if (d <= blastR + m.radius) {
        const falloff = Math.max(0.25, 1 - d / (blastR + m.radius));
        const heDmg = Math.round((ammo.explosiveTntGrams >= 150 ? 68 : 48) * falloff);
        const existing = hits.find((h) => h.module === m);
        if (existing) {
          existing.damage += heDmg;
          existing.cause = 'APHE Detonation';
        } else {
          hits.push({ module: m, damage: heDmg, cause: 'APHE Detonation' });
        }
      }
    }
  }

  return hits;
}
