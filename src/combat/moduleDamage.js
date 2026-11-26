/**
 * Module & Crew damage state tracker.
 * Maps states to X-Ray inspection colors:
 * - NORMAL: Blue (#2585E8)
 * - DAMAGED: Amber (#E8A325)
 * - CRITICAL: Red (#E83525)
 * - DESTROYED: Dark Grey (#4A4E52)
 */
import { MODULE_STATE } from './armorData.js';

export function getModuleStateColor(state) {
  switch (state) {
    case MODULE_STATE.DAMAGED:
      return { fill: 'rgba(232, 163, 37, 0.58)', stroke: '#ffd166' };
    case MODULE_STATE.CRITICAL:
      return { fill: 'rgba(232, 53, 37, 0.65)', stroke: '#ff8a80' };
    case MODULE_STATE.DESTROYED:
      return { fill: 'rgba(74, 78, 82, 0.72)', stroke: '#8c9298' };
    case MODULE_STATE.NORMAL:
    default:
      return { fill: 'rgba(37, 133, 232, 0.55)', stroke: '#7cc4ff' };
  }
}

export class ModuleDamageSystem {
  constructor(moduleDefs) {
    this.modules = moduleDefs.map((def) => ({
      ...def,
      hp: def.maxHp,
      state: MODULE_STATE.NORMAL,
    }));
    this.ammoDetonated = false;
    this.ammoFireActive = false;
    this.ammoFireTimer = 0;
    this.ammoFireDuration = 4.0;
    this.vehicleDestroyed = false;
    this.vehicleAbandoned = false;
  }

  getModule(id) {
    return this.modules.find((m) => m.id === id) || null;
  }

  getState(id) {
    const m = this.getModule(id);
    return m ? m.state : MODULE_STATE.NORMAL;
  }

  getCrewStatus(id) {
    const m = this.getModule(id);
    if (!m) return 'DEAD';
    if (m.state === MODULE_STATE.DESTROYED) return 'DEAD';
    if (m.state === MODULE_STATE.CRITICAL) return 'INCAPACITATED';
    if (m.bailedOut) return 'EMPTY';
    if (m.state === MODULE_STATE.DAMAGED) return 'WOUNDED';
    return 'HEALTHY';
  }

  isCrewOperable(id) {
    const m = this.getModule(id);
    if (!m || m.bailedOut) return false;
    return m.state === MODULE_STATE.NORMAL || m.state === MODULE_STATE.DAMAGED;
  }

  markCrewBailedOut(id) {
    const m = this.getModule(id);
    if (m) m.bailedOut = true;
    const anyInside = this.modules.some(
      (mod) =>
        mod.category === 'crew' &&
        !mod.bailedOut &&
        mod.state !== MODULE_STATE.DESTROYED &&
        mod.state !== MODULE_STATE.CRITICAL
    );
    if (!anyInside) {
      this.vehicleAbandoned = true;
    }
  }

  applyDirectDamage(id, damage, cause = 'Impact') {
    const m = this.getModule(id);
    if (!m || damage <= 0 || m.state === MODULE_STATE.DESTROYED) return null;
    return this.applyHits([{ module: m, damage, cause }]);
  }

  applyHits(hits) {
    const affected = [];

    for (const { module: m, damage, cause } of hits) {
      if (damage <= 0 || m.state === MODULE_STATE.DESTROYED) continue;
      m.hp = Math.max(0, m.hp - damage);

      const ratio = m.hp / m.maxHp;
      if (m.hp <= 0) {
        m.state = MODULE_STATE.DESTROYED;
      } else if (ratio <= 0.35) {
        m.state = MODULE_STATE.CRITICAL;
      } else if (ratio <= 0.75) {
        m.state = MODULE_STATE.DAMAGED;
      }

      affected.push(`${m.label} (${m.state} - ${cause})`);

      // Ammo rack fire / detonation check
      if (m.category === 'ammo') {
        if (m.state === MODULE_STATE.DESTROYED && damage >= 55) {
          this.ammoFireActive = true;
          this.ammoDetonated = true;
          this.vehicleDestroyed = true;
        } else if (m.state === MODULE_STATE.CRITICAL || m.state === MODULE_STATE.DESTROYED) {
          this.ammoFireActive = true;
        }
      }
    }

    // Check crew knockout (<= 1 operable crewman left, or all incapacitated/dead)
    const crewOperable = this.modules.filter(
      (m) =>
        m.category === 'crew' &&
        m.state !== MODULE_STATE.DESTROYED &&
        m.state !== MODULE_STATE.CRITICAL
    ).length;
    if (crewOperable <= 1) {
      this.vehicleDestroyed = true;
    }

    return affected;
  }

  update(dt) {
    if (this.ammoFireActive && !this.ammoDetonated) {
      this.ammoFireTimer += dt;
      if (this.ammoFireTimer >= this.ammoFireDuration) {
        this.ammoDetonated = true;
        this.vehicleDestroyed = true;
      }
    }
  }
}
