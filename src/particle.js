/**
 * Object-pooled particle & track-mark manager for War Thunder-inspired
 * WWII tank effects: 85mm muzzle blast, MG flashes, diesel exhaust,
 * track dust, surface-aware impacts, and fading track imprints.
 */
import { CONFIG } from './config.js';

const POOL_SIZE = 420;

export class ParticleSystem {
  constructor() {
    // Pre-allocated particle pool (zero per-frame GC allocation)
    this.pool = new Array(POOL_SIZE);
    for (let i = 0; i < POOL_SIZE; i++) {
      this.pool[i] = {
        active: false,
        kind: 'smoke',
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        drag: 0,
        angle: 0,
        length: 0,
        width: 0,
        radius: 0,
        growRate: 0,
        life: 0,
        maxLife: 1,
        alpha: 1,
        color: '#888',
        colorCore: '#fff',
        colorOuter: '#f80',
      };
    }
    this._cursor = 0;

    // Pre-allocated ring buffer for ground track marks
    this.maxTrackMarks = 240;
    this.trackMarks = new Array(this.maxTrackMarks);
    for (let i = 0; i < this.maxTrackMarks; i++) {
      this.trackMarks[i] = { active: false, x: 0, y: 0, angle: 0, life: 0, maxLife: 6.5 };
    }
    this._trackCursor = 0;

    // Pre-allocated ring buffer for persistent ground blood stains
    this.maxBloodMarks = 32;
    this.bloodMarks = new Array(this.maxBloodMarks);
    for (let i = 0; i < this.maxBloodMarks; i++) {
      this.bloodMarks[i] = {
        active: false,
        x: 0,
        y: 0,
        angle: 0,
        radius: 8,
        seed: 0,
      };
    }
    this._bloodCursor = 0;

    // Pre-allocated ring buffer for battlefield tactical smoke clouds (world-space)
    this.maxSmokeClouds = 28;
    this.smokeClouds = new Array(this.maxSmokeClouds);
    for (let i = 0; i < this.maxSmokeClouds; i++) {
      this.smokeClouds[i] = {
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        radius: 26,
        maxRadius: 72,
        life: 0,
        maxLife: 7.5,
        density: 0.78,
        shade: 55,
      };
    }
    this._smokeCloudCursor = 0;
    this.windVx = 14;
    this.windVy = 4;
    this.windEnabled = false;
  }

  spawnAmbientDust(x, y) {
    const p = this._alloc();
    p.active = true;
    p.kind = 'smoke';
    p.x = x;
    p.y = y;
    p.vx = this.windVx * (0.7 + Math.random() * 0.6);
    p.vy = this.windVy + (Math.random() - 0.5) * 6;
    p.drag = 0.25;
    p.radius = 2.2 + Math.random() * 3.0;
    p.growRate = 2.2;
    p.life = 2.4 + Math.random() * 1.6;
    p.maxLife = 4.0;
    p.color = 'rgb(186, 174, 146)';
    p.alpha = 0.14;
  }

  reset() {
    for (let i = 0; i < POOL_SIZE; i++) this.pool[i].active = false;
    for (let i = 0; i < this.maxTrackMarks; i++) this.trackMarks[i].active = false;
    for (let i = 0; i < this.maxBloodMarks; i++) this.bloodMarks[i].active = false;
    for (let i = 0; i < this.maxSmokeClouds; i++) this.smokeClouds[i].active = false;
    this._cursor = 0;
    this._trackCursor = 0;
    this._bloodCursor = 0;
    this._smokeCloudCursor = 0;
    this.windVx = 14;
    this.windVy = 4;
    this.windEnabled = false;
  }

  spawnAmbientDust(x, y) {
    const p = this._alloc();
    p.active = true;
    p.kind = 'smoke';
    p.x = x;
    p.y = y;
    p.vx = this.windVx * (0.7 + Math.random() * 0.6);
    p.vy = this.windVy + (Math.random() - 0.5) * 6;
    p.drag = 0.25;
    p.radius = 2.2 + Math.random() * 3.0;
    p.growRate = 2.2;
    p.life = 2.4 + Math.random() * 1.6;
    p.maxLife = 4.0;
    p.color = 'rgb(186, 174, 146)';
    p.alpha = 0.14;
  }

  _alloc() {
    for (let i = 0; i < POOL_SIZE; i++) {
      const idx = (this._cursor + i) % POOL_SIZE;
      if (!this.pool[idx].active) {
        this._cursor = (idx + 1) % POOL_SIZE;
        return this.pool[idx];
      }
    }
    // Overwrite oldest slot if pool is saturated
    const p = this.pool[this._cursor];
    this._cursor = (this._cursor + 1) % POOL_SIZE;
    return p;
  }

  addTrackMark(x, y, angle) {
    const m = this.trackMarks[this._trackCursor];
    this._trackCursor = (this._trackCursor + 1) % this.maxTrackMarks;
    m.active = true;
    m.x = x;
    m.y = y;
    m.angle = angle;
    m.life = 6.5;
    m.maxLife = 6.5;
  }

  spawnCannonMuzzleBlast(x, y, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    // 1. Intense, brief yellow-white directional core + warmer orange outer flash
    const mainFlash = this._alloc();
    mainFlash.active = true;
    mainFlash.kind = 'flash';
    mainFlash.x = x;
    mainFlash.y = y;
    mainFlash.angle = angle;
    mainFlash.length = 42;
    mainFlash.width = 13;
    mainFlash.life = 0.06;
    mainFlash.maxLife = 0.06;
    mainFlash.colorCore = '#fffde6';
    mainFlash.colorOuter = '#ff8a1f';

    // Subtle lateral muzzle gas jet (restrained, not spherical)
    for (const side of [-1, 1]) {
      const sideFlash = this._alloc();
      sideFlash.active = true;
      sideFlash.kind = 'flash';
      sideFlash.x = x;
      sideFlash.y = y;
      sideFlash.angle = angle + side * 0.95;
      sideFlash.length = 15;
      sideFlash.width = 7;
      sideFlash.life = 0.045;
      sideFlash.maxLife = 0.045;
      sideFlash.colorCore = '#fff4c2';
      sideFlash.colorOuter = '#ff6d14';
    }

    // 2. Warm directional outer muzzle glow (short-lived)
    const glow = this._alloc();
    glow.active = true;
    glow.kind = 'glow';
    glow.x = x + cos * 10;
    glow.y = y + sin * 10;
    glow.radius = 22;
    glow.growRate = 38;
    glow.life = 0.075;
    glow.maxLife = 0.075;
    glow.alpha = 0.42;
    glow.color = '#ff9830';

    // 3. Directional blast pressure ring around muzzle
    const ring = this._alloc();
    ring.active = true;
    ring.kind = 'ring';
    ring.x = x + cos * 12;
    ring.y = y + sin * 12;
    ring.radius = 6;
    ring.growRate = 230;
    ring.life = 0.17;
    ring.maxLife = 0.17;
    ring.color = 'rgba(235, 225, 205, 0.5)';

    // 4. Expanding grey-white propellant gas & smoke cloud (distinct from dark exhaust)
    for (let i = 0; i < 12; i++) {
      const spread = (Math.random() - 0.5) * 0.72;
      const speed = 75 + Math.random() * 175;
      const a = angle + spread;
      const shade = 185 + Math.floor(Math.random() * 35);
      const s = this._alloc();
      s.active = true;
      s.kind = 'smoke';
      s.x = x + cos * (4 + Math.random() * 10);
      s.y = y + sin * (4 + Math.random() * 10);
      s.vx = Math.cos(a) * speed;
      s.vy = Math.sin(a) * speed;
      s.drag = 3.6;
      s.radius = 5 + Math.random() * 5.5;
      s.growRate = 20 + Math.random() * 14;
      s.life = 0.65 + Math.random() * 0.75;
      s.maxLife = 1.4;
      s.color = `rgb(${shade}, ${shade}, ${shade + 2})`;
      s.alpha = 0.46;
    }

    // 5. Subtle ground dust disturbance beneath the muzzle blast
    for (let i = 0; i < 4; i++) {
      const a = angle + (Math.random() - 0.5) * 1.4;
      const speed = 35 + Math.random() * 55;
      const d = this._alloc();
      d.active = true;
      d.kind = 'smoke';
      d.x = x + cos * 20 + (Math.random() - 0.5) * 12;
      d.y = y + sin * 20 + (Math.random() - 0.5) * 12;
      d.vx = Math.cos(a) * speed;
      d.vy = Math.sin(a) * speed;
      d.drag = 3.2;
      d.radius = 6 + Math.random() * 5;
      d.growRate = 12;
      d.life = 0.6 + Math.random() * 0.45;
      d.maxLife = 1.05;
      d.color = 'rgb(148, 142, 130)';
      d.alpha = 0.25;
    }
  }

  spawnMGMuzzleFlash(x, y, angle) {
    const f = this._alloc();
    f.active = true;
    f.kind = 'flash';
    f.x = x;
    f.y = y;
    f.angle = angle;
    f.length = 12 + Math.random() * 4;
    f.width = 4.8;
    f.life = 0.038;
    f.maxLife = 0.038;
    f.colorCore = '#fffbe0';
    f.colorOuter = '#ff9e22';

    if (Math.random() < 0.35) {
      const a = angle + (Math.random() - 0.5) * 0.45;
      const speed = 30 + Math.random() * 40;
      const s = this._alloc();
      s.active = true;
      s.kind = 'smoke';
      s.x = x;
      s.y = y;
      s.vx = Math.cos(a) * speed;
      s.vy = Math.sin(a) * speed;
      s.drag = 4.2;
      s.radius = 1.8 + Math.random() * 1.5;
      s.growRate = 7;
      s.life = 0.25 + Math.random() * 0.2;
      s.maxLife = 0.45;
      s.color = 'rgb(155, 155, 150)';
      s.alpha = 0.28;
    }
  }

  spawnExhaustSmoke(x, y, tankVx, tankVy, rearAngle, intensity) {
    const speed = 18 + intensity * 34 + Math.random() * 14;
    const spread = (Math.random() - 0.5) * 0.55;
    const a = rearAngle + spread;
    const shade = Math.round(75 - intensity * 30 + Math.random() * 20);

    const p = this._alloc();
    p.active = true;
    p.kind = 'smoke';
    p.x = x + (Math.random() - 0.5) * 3;
    p.y = y + (Math.random() - 0.5) * 3;
    p.vx = tankVx * 0.28 + Math.cos(a) * speed;
    p.vy = tankVy * 0.28 + Math.sin(a) * speed;
    p.drag = 2.4;
    p.radius = 3.2 + intensity * 2.4;
    p.growRate = 9 + intensity * 7;
    p.life = 0.75 + Math.random() * 0.55;
    p.maxLife = 1.3;
    p.color = `rgb(${shade}, ${shade}, ${shade})`;
    p.alpha = 0.16 + intensity * 0.22;
  }

  spawnTrackDust(x, y, tankVx, tankVy, intensity, isDarkSurface) {
    const baseShade = isDarkSurface ? 115 : 155;
    const shade = baseShade + Math.floor(Math.random() * 22);
    const p = this._alloc();
    p.active = true;
    p.kind = 'smoke';
    p.x = x + (Math.random() - 0.5) * 8;
    p.y = y + (Math.random() - 0.5) * 8;
    p.vx = tankVx * 0.22 + (Math.random() - 0.5) * 24;
    p.vy = tankVy * 0.22 + (Math.random() - 0.5) * 24;
    p.drag = 3.0;
    p.radius = 3.5 + intensity * 4.5;
    p.growRate = 8 + intensity * 8;
    p.life = 0.55 + Math.random() * 0.5;
    p.maxLife = 1.05;
    p.color = `rgb(${shade}, ${shade - 4}, ${shade - 10})`;
    p.alpha = (isDarkSurface ? 0.12 : 0.22) * (0.5 + intensity * 0.6);
  }

  spawnImpact(x, y, surfaceType = 'ground', scale = 1.0) {
    // Brief impact flash
    const glow = this._alloc();
    glow.active = true;
    glow.kind = 'glow';
    glow.x = x;
    glow.y = y;
    glow.radius = 18 * scale;
    glow.growRate = 60 * scale;
    glow.life = 0.12;
    glow.maxLife = 0.12;
    glow.alpha = 0.65;
    glow.color = surfaceType === 'metal' ? '#ffd56b' : '#ff9933';

    // Shockwave ring
    const ring = this._alloc();
    ring.active = true;
    ring.kind = 'ring';
    ring.x = x;
    ring.y = y;
    ring.radius = 7 * scale;
    ring.growRate = 240 * scale;
    ring.life = 0.24;
    ring.maxLife = 0.24;
    ring.color = surfaceType === 'metal'
      ? 'rgba(255, 200, 95, 0.75)'
      : 'rgba(190, 175, 145, 0.65)';

    // Sparks (stronger on metal/wall impacts)
    const sparkCount = surfaceType === 'metal' ? 14 : 6;
    for (let i = 0; i < sparkCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = (140 + Math.random() * 240) * scale;
      const sp = this._alloc();
      sp.active = true;
      sp.kind = 'spark';
      sp.x = x;
      sp.y = y;
      sp.vx = Math.cos(a) * speed;
      sp.vy = Math.sin(a) * speed;
      sp.drag = 3.2;
      sp.radius = (surfaceType === 'metal' ? 2.0 : 1.5) * scale;
      sp.life = 0.18 + Math.random() * 0.22;
      sp.maxLife = 0.4;
      sp.color = '#ffe27a';
    }

    // Dust, soil debris & smoke
    const dustCount = surfaceType === 'metal' ? 8 : 14;
    for (let i = 0; i < dustCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = (20 + Math.random() * 90) * scale;
      const shade = surfaceType === 'metal'
        ? 65 + Math.floor(Math.random() * 45)
        : 110 + Math.floor(Math.random() * 45);
      const sm = this._alloc();
      sm.active = true;
      sm.kind = 'smoke';
      sm.x = x;
      sm.y = y;
      sm.vx = Math.cos(a) * speed;
      sm.vy = Math.sin(a) * speed;
      sm.drag = 2.6;
      sm.radius = (7 + Math.random() * 8) * scale;
      sm.growRate = 18 * scale;
      sm.life = 0.75 + Math.random() * 0.85;
      sm.maxLife = 1.6;
      sm.color = `rgb(${shade}, ${shade - 4}, ${shade - 8})`;
      sm.alpha = 0.55;
    }
    this.spawnSmokeCloud(x, y, 24 * scale, 58 * scale, 5.5 + scale * 2.5, Math.min(0.85, 0.55 * scale), surfaceType === 'metal' ? 42 : 76);
  }

  spawnSoilExplosion(x, y, scale = 1.0) {
    // 1. Expanding dirt plume & dust cloud
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = (28 + Math.random() * 115) * scale;
      const d = this._alloc();
      d.active = true;
      d.kind = 'smoke';
      d.x = x + (Math.random() - 0.5) * 10;
      d.y = y + (Math.random() - 0.5) * 10;
      d.vx = Math.cos(a) * speed;
      d.vy = Math.sin(a) * speed;
      d.drag = 3.1;
      d.radius = (8 + Math.random() * 9) * scale;
      d.growRate = 20 * scale;
      d.life = 0.85 + Math.random() * 0.9;
      d.maxLife = 1.75;
      const shade = 68 + Math.floor(Math.random() * 34);
      d.color = `rgb(${shade + 12}, ${shade}, ${shade - 14})`;
      d.alpha = 0.62;
    }

    // 2. Heavy soil clods, rocks & wood splinters thrown farther outward
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = (95 + Math.random() * 210) * scale;
      const c = this._alloc();
      c.active = true;
      c.kind = 'spark';
      c.x = x;
      c.y = y;
      c.vx = Math.cos(a) * speed;
      c.vy = Math.sin(a) * speed;
      c.drag = 1.65;
      c.radius = (1.8 + Math.random() * 2.4) * scale;
      c.life = 0.35 + Math.random() * 0.45;
      c.maxLife = 0.8;
      c.color = i % 4 === 0 ? '#6e5232' : '#4a3824';
    }

    this.spawnSmokeCloud(x, y, 28 * scale, 66 * scale, 6.2 + scale * 2.2, 0.65, 68);
  }

  spawnBulletImpact(x, y, isMetal = true) {
    const count = isMetal ? 5 : 3;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 55 + Math.random() * 120;
      const sp = this._alloc();
      sp.active = true;
      sp.kind = isMetal ? 'spark' : 'smoke';
      sp.x = x;
      sp.y = y;
      sp.vx = Math.cos(a) * speed;
      sp.vy = Math.sin(a) * speed;
      sp.drag = 5.0;
      sp.radius = isMetal ? 1.4 : 2.5;
      sp.growRate = isMetal ? 0 : 6;
      sp.life = 0.14 + Math.random() * 0.1;
      sp.maxLife = 0.24;
      sp.color = isMetal ? '#ffdd66' : 'rgb(145, 140, 130)';
      sp.alpha = 0.5;
    }
  }

  /**
   * Small directional blood droplets on infantry bullet/blast impact.
   */
  spawnBloodSplatter(x, y, dirAngle = 0, count = 5) {
    const colors = ['#7d1111', '#991818', '#5e0b0b'];
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * 1.45;
      const a = dirAngle + spread;
      const speed = 28 + Math.random() * 68;
      const b = this._alloc();
      b.active = true;
      b.kind = 'blood';
      b.x = x;
      b.y = y;
      b.vx = Math.cos(a) * speed;
      b.vy = Math.sin(a) * speed;
      b.drag = 7.5;
      b.radius = 1.0 + Math.random() * 1.25;
      b.growRate = 0;
      b.life = 0.18 + Math.random() * 0.14;
      b.maxLife = 0.32;
      b.color = colors[i % colors.length];
      b.alpha = 0.9;
    }
  }

  /**
   * Persistent ground blood stain beneath a fallen soldier (world-locked).
   */
  spawnBloodPool(x, y, angle = 0, radius = 8) {
    const m = this.bloodMarks[this._bloodCursor];
    this._bloodCursor = (this._bloodCursor + 1) % this.maxBloodMarks;
    m.active = true;
    m.x = x;
    m.y = y;
    m.angle = angle;
    m.radius = radius;
    m.seed = Math.random();
  }

  update(dt) {
    for (let i = 0; i < this.maxTrackMarks; i++) {
      const m = this.trackMarks[i];
      if (!m.active) continue;
      m.life -= dt;
      if (m.life <= 0) m.active = false;
    }

    for (let i = 0; i < this.maxSmokeClouds; i++) {
      const c = this.smokeClouds[i];
      if (!c.active) continue;
      c.life -= dt;
      if (c.life <= 0) {
        c.active = false;
        continue;
      }
      c.x += (c.vx + (this.windEnabled ? this.windVx * 0.65 : 0)) * dt;
      c.y += (c.vy + (this.windEnabled ? this.windVy * 0.65 : 0)) * dt;
      const ageRatio = 1 - c.life / c.maxLife;
      c.radius += (c.maxRadius - c.radius) * Math.min(1, dt * 1.4) + ageRatio * 2 * dt;
    }

    for (let i = 0; i < POOL_SIZE; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }

      if (p.kind !== 'flash' && p.kind !== 'ring' && p.kind !== 'glow') {
        p.x += (p.vx + (this.windEnabled && p.kind === 'smoke' ? this.windVx * 0.4 : 0)) * dt;
        p.y += (p.vy + (this.windEnabled && p.kind === 'smoke' ? this.windVy * 0.4 : 0)) * dt;
        if (p.drag > 0) {
          const damp = Math.exp(-p.drag * dt);
          p.vx *= damp;
          p.vy *= damp;
        }
      }
      if (p.growRate !== 0) {
        p.radius += p.growRate * dt;
      }
    }
  }

  renderTrackMarks(ctx) {
    for (let i = 0; i < this.maxTrackMarks; i++) {
      const m = this.trackMarks[i];
      if (!m.active) continue;
      const alpha = (m.life / m.maxLife) * (this.windEnabled ? 0.34 : 0.22);
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.angle);
      ctx.fillStyle = this.windEnabled
        ? `rgba(42, 34, 22, ${alpha.toFixed(3)})`
        : `rgba(110, 110, 105, ${alpha.toFixed(3)})`;
      ctx.fillRect(-3, -7, 6, 14);
      ctx.restore();
    }
  }

  renderBloodMarks(ctx) {
    for (let i = 0; i < this.maxBloodMarks; i++) {
      const m = this.bloodMarks[i];
      if (!m.active) continue;
      const r = m.radius;
      const ox = (m.seed - 0.5) * 3.0;
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.angle);
      ctx.fillStyle = 'rgba(72, 10, 10, 0.52)';
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.15, r * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(104, 14, 14, 0.68)';
      ctx.beginPath();
      ctx.ellipse(ox, 1.2, r * 0.72, r * 0.58, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  spawnSmokeCloud(x, y, startRadius = 24, maxRadius = 64, duration = 6.5, density = 0.78, shade = 52) {
    const c = this.smokeClouds[this._smokeCloudCursor];
    this._smokeCloudCursor = (this._smokeCloudCursor + 1) % this.maxSmokeClouds;
    c.active = true;
    c.x = x;
    c.y = y;
    c.vx = 4 + (Math.random() - 0.5) * 6;
    c.vy = -2 + (Math.random() - 0.5) * 6;
    c.radius = startRadius;
    c.maxRadius = maxRadius;
    c.life = duration;
    c.maxLife = duration;
    c.density = density;
    c.shade = shade;
  }

  getSmokeDensityAt(x, y) {
    let total = 0;
    for (let i = 0; i < this.maxSmokeClouds; i++) {
      const c = this.smokeClouds[i];
      if (!c.active) continue;
      const d = Math.hypot(x - c.x, y - c.y);
      if (d < c.radius) {
        const lifeT = Math.min(1, (c.life / c.maxLife) * 1.4);
        total += (1 - d / c.radius) * c.density * lifeT;
      }
    }
    return Math.min(1, total);
  }

  renderSmokeClouds(ctx) {
    for (let i = 0; i < this.maxSmokeClouds; i++) {
      const c = this.smokeClouds[i];
      if (!c.active) continue;
      const lifeRatio = Math.max(0, c.life / c.maxLife);
      const alpha = c.density * (lifeRatio > 0.75 ? 1 : lifeRatio / 0.75);
      const s = c.shade;
      const grad = ctx.createRadialGradient(c.x, c.y, c.radius * 0.15, c.x, c.y, c.radius);
      grad.addColorStop(0, `rgba(${s}, ${s}, ${s - 2}, ${alpha.toFixed(3)})`);
      grad.addColorStop(0.55, `rgba(${s + 8}, ${s + 8}, ${s + 5}, ${(alpha * 0.72).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${s + 14}, ${s + 14}, ${s + 10}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  render(ctx) {
    for (let i = 0; i < POOL_SIZE; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      const t = Math.max(0, p.life / p.maxLife);

      if (p.kind === 'flash') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.globalAlpha = t;

        ctx.fillStyle = p.colorOuter;
        ctx.beginPath();
        ctx.moveTo(0, -p.width * 0.35);
        ctx.lineTo(p.length, 0);
        ctx.lineTo(0, p.width * 0.35);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = p.colorCore;
        ctx.beginPath();
        ctx.moveTo(0, -p.width * 0.18);
        ctx.lineTo(p.length * 0.62, 0);
        ctx.lineTo(0, p.width * 0.18);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (p.kind === 'glow') {
        ctx.save();
        ctx.globalAlpha = t * p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (p.kind === 'ring') {
        ctx.save();
        ctx.globalAlpha = t;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2.0 * t + 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (p.kind === 'smoke') {
        ctx.save();
        ctx.globalAlpha = t * p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (p.kind === 'spark') {
        ctx.save();
        ctx.globalAlpha = t;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (p.kind === 'blood') {
        ctx.save();
        ctx.globalAlpha = t * p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }
}
