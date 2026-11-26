/**
 * Realistic WWII Armor Impact Marks Renderer & Factory.
 * Generates deterministic, non-uniform metallic decals driven strictly by
 * ballistics outcomes (mg, cannon_pen, partial_pen, cannon_nonpen, he_scorch, ricochet).
 */
import { IMPACT_OUTCOME } from './penetration.js';

function makeIrregularPolygon(sides, radius, jitter = 0.28) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const r = radius * (1 - jitter * 0.5 + Math.random() * jitter);
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

export function createImpactMark(outcome, ammo, lx, ly, dirAngle, part = 'hull') {
  if (ammo.caliberMm < 20) {
    return {
      kind: outcome === IMPACT_OUTCOME.RICOCHET ? 'ricochet' : 'mg',
      part,
      lx: lx + (Math.random() - 0.5) * 2.2,
      ly: ly + (Math.random() - 0.5) * 2.2,
      radius: 1.0 + Math.random() * 0.65,
      rot: dirAngle + (Math.random() - 0.5) * 0.35,
      scratchLen: 2.6 + Math.random() * 2.4,
    };
  }

  if (outcome === IMPACT_OUTCOME.RICOCHET) {
    return {
      kind: 'ricochet',
      part,
      lx,
      ly,
      radius: 2.2 + Math.random() * 0.8,
      rot: dirAngle,
      scratchLen: 10 + Math.random() * 6,
    };
  }

  if (
    outcome === IMPACT_OUTCOME.PENETRATION ||
    outcome === IMPACT_OUTCOME.PARTIAL_PENETRATION
  ) {
    const r = 3.2 + Math.random() * 1.1; // Proportional to 85mm shell
    return {
      kind: 'cannon_pen',
      part,
      lx,
      ly,
      radius: r,
      rot: dirAngle,
      partial: outcome === IMPACT_OUTCOME.PARTIAL_PENETRATION,
      poly: makeIrregularPolygon(8, r, 0.34),
      scorchRadius: r * (2.1 + Math.random() * 0.4),
    };
  }

  // NON_PENETRATION or HE_DETONATION
  const isHE = outcome === IMPACT_OUTCOME.HE_DETONATION;
  const r = isHE ? 4.8 + Math.random() * 1.4 : 3.5 + Math.random() * 1.1;
  return {
    kind: isHE ? 'he_scorch' : 'cannon_nonpen',
    part,
    lx,
    ly,
    radius: r,
    rot: dirAngle,
    poly: makeIrregularPolygon(7, r, 0.25),
    scorchRadius: r * (isHE ? 2.5 : 1.7),
  };
}

export function renderArmorImpactMarks(ctx, marks, paintChipColor = 'rgba(130, 145, 110, 0.55)') {
  for (const m of marks) {
    ctx.save();
    ctx.translate(m.lx, m.ly);
    ctx.rotate(m.rot);

    if (m.kind === 'mg') {
      // Subtle chipped paint flake + directional scratch
      ctx.strokeStyle = paintChipColor;
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(-m.scratchLen * 0.55, 0);
      ctx.lineTo(m.scratchLen * 0.55, 0);
      ctx.stroke();

      // Tiny dark metallic dent (not pure black)
      ctx.fillStyle = '#25282a';
      ctx.beginPath();
      ctx.arc(0, 0, m.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(140, 146, 150, 0.45)';
      ctx.beginPath();
      ctx.arc(-m.radius * 0.25, -m.radius * 0.25, m.radius * 0.35, 0, Math.PI * 2);
      ctx.fill();
    } else if (m.kind === 'ricochet') {
      // Dark scraped paint groove
      ctx.strokeStyle = 'rgba(28, 30, 32, 0.78)';
      ctx.lineWidth = m.radius * 1.35;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-m.scratchLen * 0.55, 0);
      ctx.lineTo(m.scratchLen * 0.55, 0);
      ctx.stroke();

      // Bright exposed raw steel gouge in center
      ctx.strokeStyle = 'rgba(195, 202, 208, 0.82)';
      ctx.lineWidth = m.radius * 0.55;
      ctx.beginPath();
      ctx.moveTo(-m.scratchLen * 0.42, 0);
      ctx.lineTo(m.scratchLen * 0.48, 0);
      ctx.stroke();
    } else if (m.kind === 'cannon_pen') {
      // Soft soot & heat-darkened halo
      ctx.fillStyle = 'rgba(22, 23, 21, 0.52)';
      ctx.beginPath();
      ctx.ellipse(-m.radius * 0.2, 0, m.scorchRadius, m.scorchRadius * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();

      // Chipped paint outer ring
      ctx.strokeStyle = paintChipColor;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      m.poly.forEach(([px, py], i) => {
        if (i === 0) ctx.moveTo(px * 1.28, py * 1.28);
        else ctx.lineTo(px * 1.28, py * 1.28);
      });
      ctx.closePath();
      ctx.stroke();

      // Torn steel lip + dark irregular penetration hole (or cracked core if partial)
      ctx.fillStyle = m.partial ? '#2b2e31' : '#0b0c0d';
      ctx.strokeStyle = '#5a5f64';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      m.poly.forEach(([px, py], i) => {
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      // NON_PENETRATION dent/gouge or HE scorch
      ctx.fillStyle = 'rgba(24, 25, 23, 0.48)';
      ctx.beginPath();
      ctx.arc(0, 0, m.scorchRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = paintChipColor;
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.ellipse(0, 0, m.radius * 1.25, m.radius * 0.85, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Dented dark-grey steel center (no hole)
      ctx.fillStyle = '#34383c';
      ctx.beginPath();
      ctx.ellipse(0, 0, m.radius * 0.9, m.radius * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();

      // Compressed bright metal ridge on trailing lip
      ctx.strokeStyle = 'rgba(175, 180, 185, 0.65)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(m.radius * 0.2, 0, m.radius * 0.65, -0.9, 0.9);
      ctx.stroke();
    }

    ctx.restore();
  }
}
