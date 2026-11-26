/**
 * Keyboard input manager using e.code for reliable multi-key simultaneous handling.
 */

const PREVENT_DEFAULT_CODES = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

export class InputManager {
  constructor() {
    this.keysDown = new Set();
    this.mouseScreenX = 0;
    this.mouseScreenY = 0;
    this.mouseLeftDown = false;
    this._mouseOverHud = false;
    this._onFirstInteractCallbacks = [];
    this._interacted = false;

    this._handleKeyDown = this._handleKeyDown.bind(this);
    this._handleKeyUp = this._handleKeyUp.bind(this);
    this._handleMouseMove = this._handleMouseMove.bind(this);
    this._handleMouseDown = this._handleMouseDown.bind(this);
    this._handleMouseUp = this._handleMouseUp.bind(this);
    this._handleBlur = this._handleBlur.bind(this);
    this._handleVisibilityChange = this._handleVisibilityChange.bind(this);

    window.addEventListener('keydown', this._handleKeyDown);
    window.addEventListener('keyup', this._handleKeyUp);
    window.addEventListener('mousemove', this._handleMouseMove);
    window.addEventListener('mousedown', this._handleMouseDown);
    window.addEventListener('mouseup', this._handleMouseUp);
    window.addEventListener('blur', this._handleBlur);
    document.addEventListener('visibilitychange', this._handleVisibilityChange);
  }

  onFirstInteract(cb) {
    if (this._interacted) {
      cb();
    } else {
      this._onFirstInteractCallbacks.push(cb);
    }
  }

  _triggerFirstInteract() {
    if (this._interacted) return;
    this._interacted = true;
    for (const cb of this._onFirstInteractCallbacks) {
      cb();
    }
    this._onFirstInteractCallbacks.length = 0;
  }

  _handleKeyDown(e) {
    if (PREVENT_DEFAULT_CODES.has(e.code)) {
      e.preventDefault();
    }
    if (e.repeat) return;
    this._triggerFirstInteract();
    this.keysDown.add(e.code);
  }

  _handleKeyUp(e) {
    this.keysDown.delete(e.code);
  }

  _handleMouseMove(e) {
    this.mouseScreenX = e.clientX;
    this.mouseScreenY = e.clientY;
    this._mouseOverHud = Boolean(
      e.target && e.target.closest && e.target.closest('.hud-panel, button, input, .settings-gear-btn')
    );
  }

  _handleMouseDown(e) {
    if (e.button !== 0) return;
    this.mouseScreenX = e.clientX;
    this.mouseScreenY = e.clientY;
    this._mouseOverHud = Boolean(
      e.target && e.target.closest && e.target.closest('.hud-panel, button, input, .settings-gear-btn')
    );
    this._triggerFirstInteract();
    if (!this._mouseOverHud) {
      this.mouseLeftDown = true;
    }
  }

  _handleMouseUp(e) {
    if (e.button === 0) {
      this.mouseLeftDown = false;
    }
  }

  _handleBlur() {
    this.keysDown.clear();
    this.mouseLeftDown = false;
  }

  _handleVisibilityChange() {
    if (document.hidden) {
      this.keysDown.clear();
      this.mouseLeftDown = false;
    }
  }

  isDown(code) {
    return this.keysDown.has(code);
  }

  isAnyDown(...codes) {
    for (const code of codes) {
      if (this.keysDown.has(code)) return true;
    }
    return false;
  }

  destroy() {
    window.removeEventListener('keydown', this._handleKeyDown);
    window.removeEventListener('keyup', this._handleKeyUp);
    window.removeEventListener('mousemove', this._handleMouseMove);
    window.removeEventListener('mousedown', this._handleMouseDown);
    window.removeEventListener('mouseup', this._handleMouseUp);
    window.removeEventListener('blur', this._handleBlur);
    document.removeEventListener('visibilitychange', this._handleVisibilityChange);
  }
}
