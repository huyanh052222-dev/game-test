/**
 * Smooth follow camera with cannon recoil screen-shake.
 */
import { CONFIG } from './config.js';

export class Camera {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.zoom = 1.0;
    this.vx = 0;
    this.vy = 0;
    this.spectatorAnchorX = x;
    this.spectatorAnchorY = y;
    this.shake = 0;
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;
  }

  setZoom(z, viewportWidth = 0, viewportHeight = 0) {
    this.zoom = Math.max(0.45, Math.min(2.2, Number(z) || 1.0));
    if (viewportWidth > 0 && viewportHeight > 0) {
      this.clampToBounds(viewportWidth, viewportHeight);
    }
  }

  getBounds(viewportWidth = 1280, viewportHeight = 720) {
    const worldW = CONFIG.WORLD.WIDTH;
    const worldH = CONFIG.WORLD.HEIGHT;
    const z = Math.max(0.45, this.zoom || 1.0);
    const halfViewW = Math.max(0, (Number(viewportWidth) || 0) / (2 * z));
    const halfViewH = Math.max(0, (Number(viewportHeight) || 0) / (2 * z));
    // Allow camera center to reach within min(halfViewport, 120px) of the outer map border
    // so corners (0,0)-(3600,3600) are always fully observable without exposing excessive void
    const marginX = Math.min(halfViewW, 120);
    const marginY = Math.min(halfViewH, 120);
    const minX = Math.min(worldW * 0.5, marginX);
    const maxX = Math.max(worldW * 0.5, worldW - marginX);
    const minY = Math.min(worldH * 0.5, marginY);
    const maxY = Math.max(worldH * 0.5, worldH - marginY);
    return { minX, maxX, minY, maxY, worldW, worldH };
  }

  clampToBounds(viewportWidth = 1280, viewportHeight = 720) {
    const b = this.getBounds(viewportWidth, viewportHeight);
    this.x = Math.max(b.minX, Math.min(b.maxX, this.x));
    this.y = Math.max(b.minY, Math.min(b.maxY, this.y));
    return b;
  }

  updateSpectator(input, dt, viewportWidth = 1280, viewportHeight = 720) {
    let dirX = 0;
    let dirY = 0;
    if (input) {
      if (input.isAnyDown('KeyW', 'ArrowUp')) dirY -= 1;
      if (input.isAnyDown('KeyS', 'ArrowDown')) dirY += 1;
      if (input.isAnyDown('KeyA', 'ArrowLeft')) dirX -= 1;
      if (input.isAnyDown('KeyD', 'ArrowRight')) dirX += 1;
    }

    // Normalize diagonal WASD vector so diagonal speed equals cardinal speed
    if (dirX !== 0 && dirY !== 0) {
      const invLen = Math.SQRT1_2;
      dirX *= invLen;
      dirY *= invLen;
    }

    const z = Math.max(0.45, this.zoom || 1.0);
    const maxSpeed = 720 / Math.max(0.55, Math.sqrt(z));
    const targetVx = dirX * maxSpeed;
    const targetVy = dirY * maxSpeed;
    const accelRate = dirX !== 0 || dirY !== 0 ? 16.0 : 14.0;
    const blend = 1 - Math.exp(-accelRate * dt);
    this.vx += (targetVx - this.vx) * blend;
    this.vy += (targetVy - this.vy) * blend;
    if (Math.abs(this.vx) < 0.5 && dirX === 0) this.vx = 0;
    if (Math.abs(this.vy) < 0.5 && dirY === 0) this.vy = 0;

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.clampToBounds(viewportWidth, viewportHeight);
    this.spectatorAnchorX = this.x;
    this.spectatorAnchorY = this.y;

    this._decayShake(dt);
  }

  addShake(amount) {
    this.shake = Math.min(18, this.shake + amount);
  }

  _decayShake(dt) {
    if (this.shake > 0.05) {
      const angle = Math.random() * Math.PI * 2;
      this.shakeOffsetX = Math.cos(angle) * this.shake;
      this.shakeOffsetY = Math.sin(angle) * this.shake;
      this.shake *= Math.exp(-CONFIG.CAMERA.RECOIL_SHAKE_DECAY * dt);
    } else {
      this.shake = 0;
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
    }
  }

  update(targetX, targetY, dt) {
    this.vx = 0;
    this.vy = 0;
    const t = 1 - Math.exp(-CONFIG.CAMERA.FOLLOW_LERP * dt);
    this.x += (targetX - this.x) * t;
    this.y += (targetY - this.y) * t;
    this._decayShake(dt);
  }

  applyTransform(ctx, viewportWidth, viewportHeight) {
    const z = this.zoom || 1.0;
    if (Math.abs(z - 1.0) < 1e-4) {
      const offsetX = Math.round(viewportWidth / 2 - this.x + this.shakeOffsetX);
      const offsetY = Math.round(viewportHeight / 2 - this.y + this.shakeOffsetY);
      ctx.translate(offsetX, offsetY);
    } else {
      ctx.translate(viewportWidth / 2 + this.shakeOffsetX, viewportHeight / 2 + this.shakeOffsetY);
      ctx.scale(z, z);
      ctx.translate(-this.x, -this.y);
    }
  }

  screenToWorld(screenX, screenY, viewportWidth, viewportHeight) {
    const z = this.zoom || 1.0;
    if (Math.abs(z - 1.0) < 1e-4) {
      const offsetX = Math.round(viewportWidth / 2 - this.x + this.shakeOffsetX);
      const offsetY = Math.round(viewportHeight / 2 - this.y + this.shakeOffsetY);
      return {
        x: screenX - offsetX,
        y: screenY - offsetY,
      };
    }
    return {
      x: (screenX - (viewportWidth / 2 + this.shakeOffsetX)) / z + this.x,
      y: (screenY - (viewportHeight / 2 + this.shakeOffsetY)) / z + this.y,
    };
  }
}
