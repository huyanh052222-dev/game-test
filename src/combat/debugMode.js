/**
 * Development-only Combat Ballistics Debug Overlay (toggle with F9).
 * Hidden during normal gameplay.
 */

export class CombatDebugOverlay {
  constructor() {
    this.enabled = window.location.search.includes('debug=1');
    this.lastReport = null;
    this.el = document.getElementById('combat-debug-panel');
    this._f9WasDown = false;
  }

  setReport(report) {
    this.lastReport = report;
    this._render();
  }

  updateInput(input) {
    const f9 = input.isDown('F9');
    if (f9 && !this._f9WasDown) {
      this.enabled = !this.enabled;
      this._render();
    }
    this._f9WasDown = f9;
  }

  _render() {
    if (!this.el) return;
    this.el.classList.toggle('hidden', !this.enabled);
    if (!this.enabled) return;

    if (!this.lastReport) {
      this.el.innerHTML =
        '<div class="dbg-title">BALLISTICS DEBUG [F9]</div><div class="dbg-row">Waiting for impact...</div>';
      return;
    }

    const r = this.lastReport;
    const mods = r.modulesAffected.length > 0 ? r.modulesAffected.join(', ') : 'None';
    this.el.innerHTML = `
      <div class="dbg-title">BALLISTICS DEBUG [F9]</div>
      <div class="dbg-row"><span>Ammo:</span><strong>${r.ammoName} (${r.ammoType})</strong></div>
      <div class="dbg-row"><span>Distance:</span><strong>${r.distanceMeters.toFixed(0)} m</strong></div>
      <div class="dbg-row"><span>Zone:</span><strong>${r.zoneLabel}</strong></div>
      <div class="dbg-row"><span>Impact Angle:</span><strong>${r.impactAngleDeg.toFixed(1)}°</strong></div>
      <div class="dbg-row"><span>Armor (Act/Eff):</span><strong>${r.actualMm}mm${r.spacedMm ? `+${r.spacedMm}mm` : ''} / ${r.effectiveMm.toFixed(1)}mm</strong></div>
      <div class="dbg-row"><span>Penetration:</span><strong>${r.penMm.toFixed(1)}mm (Rem: ${r.remainingPenMm.toFixed(1)}mm)</strong></div>
      <div class="dbg-row"><span>Ricochet %:</span><strong>${(r.ricochetChance * 100).toFixed(0)}%</strong></div>
      <div class="dbg-row"><span>Outcome:</span><strong>${r.outcome}</strong></div>
      <div class="dbg-row"><span>Damage:</span><strong>${mods}</strong></div>
    `;
  }
}
