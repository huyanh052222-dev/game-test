/**
 * Armor penetration & spaced-armor resolution.
 * Outcomes: PENETRATION | PARTIAL_PENETRATION | NON_PENETRATION | RICOCHET | HE_DETONATION
 */
import { interpolatePenetration } from './projectileData.js';
import { evaluateRicochet } from './ricochet.js';

export const IMPACT_OUTCOME = {
  PENETRATION: 'PENETRATION',
  PARTIAL_PENETRATION: 'PARTIAL_PENETRATION',
  NON_PENETRATION: 'NON_PENETRATION',
  RICOCHET: 'RICOCHET',
  HE_DETONATION: 'HE_DETONATION',
};

export function resolvePenetration(ammo, collision, distanceMeters, rng = Math.random) {
  const { zone, impactAngleDeg } = collision;
  const basePen = interpolatePenetration(ammo, distanceMeters);

  // HE shells detonate on contact rather than behaving like APHE/APCR
  if (ammo.type === 'HE') {
    const effMm = zone.thicknessMm / Math.max(0.15, Math.cos((impactAngleDeg * Math.PI) / 180));
    const outcome = basePen >= effMm ? IMPACT_OUTCOME.PENETRATION : IMPACT_OUTCOME.HE_DETONATION;
    return {
      outcome,
      penMm: basePen,
      actualMm: zone.thicknessMm,
      spacedMm: zone.spacedMm || 0,
      effectiveMm: effMm,
      remainingPenMm: Math.max(0, basePen - effMm),
      impactAngleDeg,
      ricochetChance: 0,
      fuseArmed: true,
    };
  }

  // Step 1: Check ricochet on outer armor surface
  const ric = evaluateRicochet(ammo, impactAngleDeg, false, rng);
  if (ric.ricocheted) {
    return {
      outcome: IMPACT_OUTCOME.RICOCHET,
      penMm: basePen,
      actualMm: zone.thicknessMm,
      spacedMm: zone.spacedMm || 0,
      effectiveMm: zone.thicknessMm / Math.max(0.08, Math.cos((ric.effectiveAngleDeg * Math.PI) / 180)),
      remainingPenMm: 0,
      impactAngleDeg,
      ricochetChance: ric.chance,
      fuseArmed: false,
    };
  }

  const effAngleRad = (Math.min(85, ric.effectiveAngleDeg) * Math.PI) / 180;
  const cosEff = Math.max(0.08, Math.cos(effAngleRad));
  let remPen = basePen;

  // Step 2: Spaced armor layer (if present) must be defeated first
  const spacedMm = zone.spacedMm || 0;
  let spacedEff = 0;
  if (spacedMm > 0) {
    spacedEff = (spacedMm / cosEff) * (zone.materialMod || 1.0);
    if (remPen < spacedEff) {
      return {
        outcome: IMPACT_OUTCOME.NON_PENETRATION,
        penMm: basePen,
        actualMm: zone.thicknessMm,
        spacedMm,
        effectiveMm: spacedEff + (zone.thicknessMm / cosEff),
        remainingPenMm: 0,
        impactAngleDeg,
        ricochetChance: ric.chance,
        fuseArmed: false,
      };
    }
    remPen -= spacedEff;
  }

  // Step 3: Base armor plate resistance
  const baseEff = (zone.thicknessMm / cosEff) * (zone.materialMod || 1.0);
  const totalEff = spacedEff + baseEff;
  const margin = remPen - baseEff;
  const fuseArmed = totalEff >= ammo.fuseSensitivityMm;

  let outcome = IMPACT_OUTCOME.NON_PENETRATION;
  if (margin >= baseEff * 0.04) {
    outcome = IMPACT_OUTCOME.PENETRATION;
  } else if (margin >= -baseEff * 0.06) {
    outcome = IMPACT_OUTCOME.PARTIAL_PENETRATION;
  }

  return {
    outcome,
    penMm: basePen,
    actualMm: zone.thicknessMm,
    spacedMm,
    effectiveMm: totalEff,
    remainingPenMm: Math.max(0, remPen - baseEff),
    impactAngleDeg,
    ricochetChance: ric.chance,
    fuseArmed,
  };
}
