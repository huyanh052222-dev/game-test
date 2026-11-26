/**
 * Spatial-Chunk Persistent Tank Track Impression System
 * - Independent Left & Right track trails matching actual vehicle track spacing & turning arcs
 * - Surface-aware appearance (GRASS, DIRT, MUD, SAND, GRAVEL/NORMAL)
 * - World-coordinate persistent across camera panning, zooming, and tank/infantry focus switches
 * - Bounded per-chunk ring buffer for zero memory leaks over long sessions
 */
import { CONFIG } from './config.js';
import { SURFACE_TYPE } from './environment.js';

const CHUNK_SIZE = 600;
const MAX_MARKS_PER_CHUNK = 750;

export class PersistentTrackSystem {
  constructor() {
    this.chunks = new Map(); // "cx,cy" -> { marks: [], cursor: 0 }
    this.totalMarks = 0;
  }

  reset() {
    this.chunks.clear();
    this.totalMarks = 0;
  }

  _getChunk(cx, cy) {
    const key = `${cx},${cy}`;
    let ch = this.chunks.get(key);
    if (!ch) {
      ch = { cx, cy, marks: [], cursor: 0 };
      this.chunks.set(key, ch);
    }
    return ch;
  }

  /**
   * Stamps a single track shoe/tread impression at (x, y) with heading angle.
   */
  addImprint(x, y, angle, width = 14, surface = SURFACE_TYPE.GRASS, isPivot = false) {
    if (x < 0 || x >= CONFIG.WORLD.WIDTH || y < 0 || y >= CONFIG.WORLD.HEIGHT) return;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const ch = this._getChunk(cx, cy);

    const mark = {
      x,
      y,
      angle,
      width,
      surface,
      isPivot,
    };

    if (ch.marks.length < MAX_MARKS_PER_CHUNK) {
      ch.marks.push(mark);
      this.totalMarks++;
    } else {
      ch.marks[ch.cursor] = mark;
      ch.cursor = (ch.cursor + 1) % MAX_MARKS_PER_CHUNK;
    }
  }

  /**
   * Updates independent left/right track odometers on any tracked vehicle
   * and stamps surface-aware track impressions along actual turning arcs.
   */
  updateVehicleTracks(vehicle, dt, environment, trackHalfOffset, trackWidth, isFiringRange) {
    if (!vehicle) return;
    if (!vehicle._trackTrackers) {
      vehicle._trackTrackers = {
        leftDist: 0,
        rightDist: 0,
        pivotTimer: 0,
      };
    }

    const tr = vehicle._trackTrackers;
    const speed = vehicle.speed || 0;
    const angVel = vehicle.angularVelocity || 0;

    if (Math.abs(speed) < 2 && Math.abs(angVel) < 0.04) {
      return;
    }

    const leftVel = speed - angVel * trackHalfOffset;
    const rightVel = speed + angVel * trackHalfOffset;
    const stepSpacing = 7.5;

    const cos = Math.cos(vehicle.angle);
    const sin = Math.sin(vehicle.angle);
    const rearOffset = -(vehicle.halfLength ? vehicle.halfLength * 0.42 : 44);

    const stampSide = (sideSign, distAccumKey, sideVel) => {
      tr[distAccumKey] += Math.abs(sideVel) * dt;
      if (tr[distAccumKey] < stepSpacing) return;
      tr[distAccumKey] %= stepSpacing;

      const lx = rearOffset;
      const ly = sideSign * trackHalfOffset;
      const wx = vehicle.x + lx * cos - ly * sin;
      const wy = vehicle.y + lx * sin + ly * cos;

      // Do not stamp tracks on impassable deep trench walls
      if (environment?.trenchSystem) {
        const ti = environment.trenchSystem.getTrenchStateAt(wx, wy);
        if (ti.onWall && ti.depth === 'deep') {
          return;
        }
      }

      const surf = isFiringRange && environment
        ? environment.getSurfaceAt(wx, wy)
        : SURFACE_TYPE.NORMAL;

      const isPivot = Math.abs(speed) < 10 && Math.abs(angVel) > 0.08;
      this.addImprint(wx, wy, vehicle.angle, trackWidth, surf, isPivot);
    };

    stampSide(-1, 'leftDist', leftVel);
    stampSide(1, 'rightDist', rightVel);
  }

  render(ctx, viewBounds = null, isFiringRange = false) {
    if (this.chunks.size === 0) return;

    const minCx = viewBounds ? Math.max(0, Math.floor(viewBounds.minX / CHUNK_SIZE)) : 0;
    const maxCx = viewBounds ? Math.floor(viewBounds.maxX / CHUNK_SIZE) : 10;
    const minCy = viewBounds ? Math.max(0, Math.floor(viewBounds.minY / CHUNK_SIZE)) : 0;
    const maxCy = viewBounds ? Math.floor(viewBounds.maxY / CHUNK_SIZE) : 10;

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const ch = this.chunks.get(`${cx},${cy}`);
        if (!ch || ch.marks.length === 0) continue;

        for (let i = 0; i < ch.marks.length; i++) {
          const m = ch.marks[i];
          ctx.save();
          ctx.translate(m.x, m.y);
          ctx.rotate(m.angle);

          const hw = m.width * 0.5;
          if (!isFiringRange || m.surface === SURFACE_TYPE.NORMAL) {
            ctx.fillStyle = 'rgba(85, 88, 82, 0.24)';
            ctx.fillRect(-2.6, -hw, 5.2, m.width);
          } else if (m.surface === SURFACE_TYPE.MUD) {
            // Deep mud rut + raised muddy edges + subtle wet sheen
            ctx.fillStyle = 'rgba(30, 22, 14, 0.56)';
            ctx.fillRect(-3.4, -hw - 1, 6.8, m.width + 2);
            ctx.fillStyle = 'rgba(66, 52, 34, 0.42)';
            ctx.fillRect(-3.4, -hw - 2.2, 6.8, 1.5);
            ctx.fillRect(-3.4, hw + 0.7, 6.8, 1.5);
            ctx.fillStyle = 'rgba(110, 122, 114, 0.14)';
            ctx.fillRect(-2.0, -hw * 0.5, 4.0, hw);
          } else if (m.surface === SURFACE_TYPE.SAND) {
            // Wider soft sand depression + pale raised edges
            ctx.fillStyle = 'rgba(132, 112, 74, 0.45)';
            ctx.fillRect(-3.2, -hw - 0.8, 6.4, m.width + 1.6);
            ctx.fillStyle = 'rgba(204, 182, 134, 0.35)';
            ctx.fillRect(-3.2, -hw - 2.0, 6.4, 1.3);
            ctx.fillRect(-3.2, hw + 0.7, 6.4, 1.3);
          } else if (m.surface === SURFACE_TYPE.DIRT) {
            // Compacted dark dirt tread cleats
            ctx.fillStyle = 'rgba(54, 41, 26, 0.48)';
            ctx.fillRect(-2.8, -hw, 5.6, m.width);
            ctx.fillStyle = 'rgba(34, 26, 16, 0.45)';
            ctx.fillRect(-1.0, -hw + 1, 2.0, m.width - 2);
          } else {
            // GRASS: flattened olive/brownish vegetation + exposed soil cleat
            ctx.fillStyle = 'rgba(46, 52, 28, 0.42)';
            ctx.fillRect(-3.0, -hw, 6.0, m.width);
            ctx.fillStyle = 'rgba(64, 52, 34, 0.35)';
            ctx.fillRect(-1.2, -hw + 1.5, 2.4, m.width - 3);
          }

          if (m.isPivot) {
            ctx.fillStyle = 'rgba(42, 34, 22, 0.28)';
            ctx.fillRect(-4.5, -hw - 2, 9, m.width + 4);
          }

          ctx.restore();
        }
      }
    }
  }
}
