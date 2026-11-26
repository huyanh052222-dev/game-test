/**
 * Core game loop, asset loader, and 3x3 high-contrast technical lab renderer.
 */
import { CONFIG } from './config.js';
import { InputManager } from './input.js';
import { SoundEngine } from './audio.js?v=19';
import { Camera } from './camera.js?v=24';
import { ParticleSystem } from './particle.js';
import { ProjectileManager } from './projectile.js?v=17';
import { Tank } from './tank.js?v=9';
import { HUD } from './hud.js?v=22';
import { PanzerIIITarget } from './target.js?v=20';
import { CombatDebugOverlay } from './combat/debugMode.js';
import { createPanzerIIISquad, SOLDIER_STATE } from './infantry.js?v=21';
import { BattlefieldEnvironment, GAME_MODE } from './environment.js?v=18';
import { MODULE_STATE } from './combat/armorData.js';
import { TacticalMinimap } from './minimap.js';
import { PersistentTrackSystem } from './trackSystem.js';
import { InfantryVoiceSystem } from './infantryVoice.js?v=11';
import { ReinforcementManager, REINFORCEMENT_TYPE } from './reinforcements.js?v=20';
import { InfantryCommandSystem } from './infantryCommand.js?v=11';
import { setupSovietTrenchDefense, getDefenseForceCounts } from './trenchDefense.js?v=19';
import { spawnCustomBattle, getCustomBattleCounts, findSelectableCustomEntityAt } from './customBattle.js?v=21';
import { ThrowableManager } from './combat/infantryCQC.js?v=21';

export const CONTROL_MODE = {
  TANK_CONTROL: 'TANK_CONTROL',
  INFANTRY_CONTROL: 'INFANTRY_CONTROL',
};

const NULL_INPUT = {
  isDown: () => false,
  isAnyDown: () => false,
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load sprite: ${src}`));
    img.src = src;
  });
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.input = new InputManager();
    this.sound = new SoundEngine();
    this.camera = new Camera(CONFIG.TANK.START_X, CONFIG.TANK.START_Y);
    this.particles = new ParticleSystem();
    this.debugOverlay = new CombatDebugOverlay();
    this.projectiles = new ProjectileManager(this.particles, this.sound, this.debugOverlay);
    this.tank = new Tank(this.projectiles, this.particles, this.sound, this.camera);
    this.hud = new HUD(this.sound);
    this.minimap = new TacticalMinimap(document.getElementById('minimap-canvas'));
    this.trackSystem = new PersistentTrackSystem();
    this.infantryVoice = new InfantryVoiceSystem(this.sound);
    this.projectiles.infantryVoice = this.infantryVoice;
    if (this.sound?.crew) {
      this.sound.crew.onCrewEvent = (ev) => {
        if (ev === 'RELOAD_STARTED' && this.tank && !this.tank.damageSystem?.vehicleDestroyed) {
          this.infantryVoice.requestChat(
            this.tank,
            'TANK_RELOADING',
            4,
            this.camera.x,
            this.camera.y,
            this.environment
          );
        }
      };
    }
    this.reinforcements = new ReinforcementManager(this.projectiles, this.particles, this.sound, this.camera);
    this.infantryCommand = new InfantryCommandSystem();
    this.reinforcementMenuOpen = false;
    this._tWasDown = false;
    this._cWasDown = false;
    this._escWasDown = false;
    this._mWasDown = false;
    this._bindMinimapControls();
    this._bindReinforcementControls();
    this._bindInfantryCommandControls();
    this.controlMode = CONTROL_MODE.TANK_CONTROL;
    this.controlledSoldier = null;
    this.controlledCrewRole = null;
    this._gInfWasDown = false;
    this._hudNotice = '';
    this._hudNoticeTimer = 0;
    this._bindTankControlCallbacks();
    this.gameMode = GAME_MODE.SIMULATION;
    this.environment = new BattlefieldEnvironment(this.gameMode);
    this.nightMode = false;
    this._lightCanvas = document.createElement('canvas');
    this._lightCtx = this._lightCanvas.getContext('2d');
    this.hud.onToggleNightMode = () => {
      this.nightMode = !this.nightMode;
      return this.nightMode;
    };
    this.hud.onApplyGameMode = (mode, preset) => {
      this.setGameMode(mode, preset);
    };
    this.hasPlayerTank = true;
    this._customBattleTotals = null;
    this._customBattleStarting = false;
    this.hud.onStartCustomBattle = (customCfg) => {
      if (this._customBattleStarting) return;
      this._customBattleStarting = true;
      try {
        this.setGameMode(GAME_MODE.CUSTOM_BATTLE, customCfg.map, customCfg);
      } finally {
        this._customBattleStarting = false;
      }
    };
    this.hud.onReconfigureCustomBattle = () => {
      this.releaseCustomPossession();
      this._cleanupBattleEntities();
    };
    this.hud.onReturnToSpectator = () => {
      this.releaseCustomPossession();
      this._syncDefenseHUD();
    };
    this.throwables = new ThrowableManager(this.particles, this.sound);
    this.customPossession = {
      mode: 'SPECTATOR',
      entity: null,
      kind: null,
      label: 'SPECTATOR (CLICK UNIT TO POSSESS)',
    };
    this._vWasDown = false;
    this._bindCustomBattlePossessionControls();
    this.hud.onSelectAmmo = (ammoId) => {
      this.tank?.turret?.mainGun?.setAmmoType?.(ammoId);
    };
    this.friendlyFireEnabled = true;
    this.projectiles.friendlyFireEnabled = false; // Simulation Mode keeps default safety
    this.projectiles.onFriendlyFire = (ev) => {
      if (this.isCombatMode()) {
        this.hud.showFriendlyFireNotice(ev);
      }
    };
    this.hud.onToggleFriendlyFire = (enabled) => {
      this.friendlyFireEnabled = Boolean(enabled);
      this.projectiles.friendlyFireEnabled =
        this.isCombatMode() && this.friendlyFireEnabled;
    };
    this.targets = [];
    this.heavyMGs = [];
    this.artilleryGuns = [];
    this.spawnPanzerIII(2060, 1480, Math.PI * 0.78);
    this.infantry = createPanzerIIISquad(2060, 1480);

    this.sprites = {};
    this.running = false;
    this.lastTime = 0;
    this.inspectionMode = false;
    this._yWasDown = false;

    // Unlock Web Audio on first user interaction
    this.input.onFirstInteract(() => this.sound.init());
    window.addEventListener('pointerdown', () => this.sound.init(), { once: true });

    this._handleResize = this._handleResize.bind(this);
    this._loop = this._loop.bind(this);
    window.addEventListener('resize', this._handleResize);
    this._handleResize();
  }

  isCombatMode() {
    return (
      this.gameMode === GAME_MODE.FIRING_RANGE ||
      this.gameMode === GAME_MODE.SOVIET_TRENCH_DEFENSE ||
      this.gameMode === GAME_MODE.CUSTOM_BATTLE
    );
  }

  spawnPanzerIII(x = 2060, y = 1480, angle = Math.PI * 0.78) {
    this.targets.push(
      new PanzerIIITarget(x, y, angle, {
        combatEnabled: this.isCombatMode(),
      })
    );
  }

  _bindMinimapControls() {
    const panel = document.getElementById('minimap-panel');
    const toggleBtn = document.getElementById('btn-minimap-toggle');
    const zoomInBtn = document.getElementById('btn-minimap-zoom-in');
    const zoomOutBtn = document.getElementById('btn-minimap-zoom-out');
    const zoomLabel = document.getElementById('minimap-zoom-label');

    const toggleCollapse = () => {
      const nextVis = !this.minimap.visible;
      this.minimap.setVisible(nextVis);
      if (panel) panel.classList.toggle('collapsed', !nextVis);
      if (toggleBtn) toggleBtn.textContent = nextVis ? '_' : '+';
    };

    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCollapse();
      });
    }
    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const z = this.minimap.cycleZoom(1);
        if (zoomLabel) zoomLabel.textContent = `${z.toFixed(1)}x`;
      });
    }
    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const z = this.minimap.cycleZoom(-1);
        if (zoomLabel) zoomLabel.textContent = `${z.toFixed(1)}x`;
      });
    }
  }

  _bindTankControlCallbacks() {
    this.tank.bailout.onManualDismountComplete = (soldier, roleId) => {
      soldier.isPlayerControlled = true;
      this.controlledSoldier = soldier;
      this.controlledCrewRole = roleId;
      this.controlMode = CONTROL_MODE.INFANTRY_CONTROL;
      this._gInfWasDown = this.input.isDown('KeyG');
    };
    this.tank.bailout.onReentryComplete = (roleId) => {
      this.controlMode = CONTROL_MODE.TANK_CONTROL;
      this.controlledSoldier = null;
      this.controlledCrewRole = null;
      this.tank.selectedCrewId = roleId;
    };
    this.tank.bailout.onReentryFailed = (_roleId, reason) => {
      this._hudNotice = reason || 'RE-ENTRY BLOCKED';
      this._hudNoticeTimer = 2.0;
    };
  }

  _bindReinforcementControls() {
    const menu = document.getElementById('reinforcement-menu');
    const optInfantry = document.getElementById('reinf-opt-infantry');
    const optTank = document.getElementById('reinf-opt-tank');

    const handleSelect = (type) => {
      if (!this.isCombatMode()) return;
      this.reinforcements.requestReinforcement(type, {
        playerTank: this.tank,
        targets: this.targets,
        infantry: this.infantry,
        environment: this.environment,
      });
      this._closeReinforcementMenu();
    };

    if (optInfantry) {
      optInfantry.addEventListener('click', (e) => {
        e.stopPropagation();
        handleSelect(REINFORCEMENT_TYPE.INFANTRY_SQUAD);
      });
    }
    if (optTank) {
      optTank.addEventListener('click', (e) => {
        e.stopPropagation();
        handleSelect(REINFORCEMENT_TYPE.TANK);
      });
    }

    const handleContextClose = (e) => {
      if (!this.reinforcementMenuOpen) return;
      e.preventDefault();
      e.stopPropagation();
      this._closeReinforcementMenu();
    };
    if (menu) menu.addEventListener('contextmenu', handleContextClose);
    window.addEventListener('contextmenu', handleContextClose);
  }

  _bindCustomBattlePossessionControls() {
    const isHudTarget = (t) => Boolean(t && t.closest && t.closest('.hud-panel, button, input, select, .settings-gear-btn'));

    window.addEventListener(
      'wheel',
      (e) => {
        if (this.gameMode !== GAME_MODE.CUSTOM_BATTLE) return;
        if (isHudTarget(e.target)) return;
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 0.89;
        this.camera.setZoom(
          (this.camera.zoom || 1.0) * factor,
          window.innerWidth,
          window.innerHeight
        );
      },
      { passive: false }
    );

    window.addEventListener('mousedown', (e) => {
      if (this.gameMode !== GAME_MODE.CUSTOM_BATTLE) return;
      if (e.button !== 0 || this.infantryCommand.active || this.isModalOverlayOpen()) return;
      if (isHudTarget(e.target)) return;
      const mw = this.camera.screenToWorld(e.clientX, e.clientY, window.innerWidth, window.innerHeight);
      const hit = findSelectableCustomEntityAt(mw.x, mw.y, {
        friendlyTanks: this.reinforcements.friendlyTanks,
        targets: this.targets,
        artilleryGuns: this.artilleryGuns,
        heavyMGs: this.heavyMGs,
        infantry: this.infantry,
      });
      if (hit && hit.entity !== this.customPossession.entity) {
        this.possessCustomEntity(hit);
        this.input.mouseLeftDown = false;
        this._syncDefenseHUD();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (this.gameMode !== GAME_MODE.CUSTOM_BATTLE) return;
      if (this.isModalOverlayOpen() || this.infantryCommand.active) return;
      if (e.code === 'Escape' || e.code === 'KeyV') {
        if (this.customPossession && this.customPossession.mode !== 'SPECTATOR') {
          this.releaseCustomPossession();
          this._syncDefenseHUD();
        }
      }
    });
  }

  releaseCustomPossession() {
    const prev = this.customPossession?.entity;
    if (prev) {
      prev.isPlayerPossessed = false;
      prev.isPlayerControlled = false;
      prev._playerVx = 0;
      prev._playerVy = 0;
    }
    if (this.controlledSoldier) {
      this.controlledSoldier.isPlayerControlled = false;
      this.controlledSoldier._playerVx = 0;
      this.controlledSoldier._playerVy = 0;
      this.controlledSoldier = null;
    }
    this.controlMode = CONTROL_MODE.TANK_CONTROL;
    this.camera.vx = 0;
    this.camera.vy = 0;
    this.camera.spectatorAnchorX = this.camera.x;
    this.camera.spectatorAnchorY = this.camera.y;
    this.customPossession = {
      mode: 'SPECTATOR',
      entity: null,
      kind: null,
      label: 'SPECTATOR (CLICK UNIT TO POSSESS)',
    };
  }

  possessCustomEntity({ entity, kind, label }) {
    if (!entity) return;
    if (!this.customPossession || this.customPossession.mode === 'SPECTATOR') {
      this.camera.spectatorAnchorX = this.camera.x;
      this.camera.spectatorAnchorY = this.camera.y;
    }
    this.releaseCustomPossession();
    this.customPossession = {
      mode: kind,
      entity,
      kind,
      label: `${label} [V: SPECTATOR]`,
    };
    if (kind === 'INFANTRY') {
      entity.isPlayerControlled = true;
      this.controlMode = CONTROL_MODE.INFANTRY_CONTROL;
      this.controlledSoldier = entity;
    } else {
      entity.isPlayerPossessed = true;
    }
  }

  _bindInfantryCommandControls() {
    const toggleBtn = document.getElementById('btn-infantry-cmd');
    const clearBtn = document.getElementById('btn-inf-cmd-clear');

    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.infantryCommand.toggleMode();
        this._syncInfantryCommandUI();
        toggleBtn.blur();
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.infantryCommand.clearSelection();
        this._syncInfantryCommandUI();
        clearBtn.blur();
      });
    }

    const isHudTarget = (t) => Boolean(t && t.closest && t.closest('.hud-panel, button, input, .settings-gear-btn'));

    window.addEventListener('mousedown', (e) => {
      if (!this.infantryCommand.active || this.reinforcementMenuOpen) return;
      if (e.button === 0 && !isHudTarget(e.target)) {
        this.infantryCommand.onMouseDown(e.clientX, e.clientY, 0, e.shiftKey, {
          camera: this.camera,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          infantry: this.infantry,
        });
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.infantryCommand.active) return;
      this.infantryCommand.onMouseMove(e.clientX, e.clientY);
    });

    window.addEventListener('mouseup', (e) => {
      if (!this.infantryCommand.active || e.button !== 0) return;
      if (
        this.infantryCommand.onMouseUp(e.clientX, e.clientY, 0, e.shiftKey, {
          camera: this.camera,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          infantry: this.infantry,
        })
      ) {
        this._syncInfantryCommandUI();
      }
    });

    window.addEventListener('contextmenu', (e) => {
      if (!this.infantryCommand.active || this.reinforcementMenuOpen) return;
      if (isHudTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      const res = this.infantryCommand.onMouseDown(e.clientX, e.clientY, 2, e.shiftKey, {
        camera: this.camera,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        infantry: this.infantry,
      });
      if (res && res.issueOrder) {
        const allVehicles = [this.tank, ...this.reinforcements.friendlyTanks, ...this.targets];
        this.infantryCommand.issueAttackOrder(res.x, res.y, {
          environment: this.environment,
          tanks: allVehicles,
          infantry: this.infantry,
        });
        this._syncInfantryCommandUI();
      }
    });
  }

  _syncInfantryCommandUI() {
    const toggleBtn = document.getElementById('btn-infantry-cmd');
    const panel = document.getElementById('hud-infantry-cmd-panel');
    const selEl = document.getElementById('inf-cmd-selected');
    const assaultEl = document.getElementById('inf-cmd-assault');
    const supportEl = document.getElementById('inf-cmd-support');
    const statusEl = document.getElementById('inf-cmd-status');
    const objEl = document.getElementById('inf-cmd-obj');
    const confirmEl = document.getElementById('inf-cmd-confirm');

    if (toggleBtn) {
      toggleBtn.classList.toggle('active', this.infantryCommand.active);
      toggleBtn.textContent = this.infantryCommand.active ? 'CMD INFANTRY: ON [C]' : 'CMD INFANTRY [C]';
    }
    const count = this.infantryCommand.selectedSoldiers.size;
    if (panel) {
      panel.classList.toggle('hidden', count === 0);
    }
    if (selEl) selEl.textContent = String(count);
    if (assaultEl) assaultEl.textContent = String(this.infantryCommand.assaultCount);
    if (supportEl) supportEl.textContent = String(this.infantryCommand.fireSupportCount);
    if (statusEl) statusEl.textContent = this.infantryCommand.groupStatus;
    if (objEl) {
      objEl.textContent = this.infantryCommand.objective
        ? `Obj: ${Math.round(this.infantryCommand.objective.x)}, ${Math.round(this.infantryCommand.objective.y)}`
        : 'Obj: NONE';
    }
    if (confirmEl) {
      if (this.infantryCommand.confirmationTimer > 0 && this.infantryCommand.confirmationText) {
        confirmEl.textContent = this.infantryCommand.confirmationText;
        confirmEl.classList.remove('hidden');
      } else {
        confirmEl.classList.add('hidden');
      }
    }
  }

  _openReinforcementMenu() {
    if (!this.isCombatMode()) return;
    this.reinforcementMenuOpen = true;
    const menu = document.getElementById('reinforcement-menu');
    if (menu) menu.classList.remove('hidden');
    this._syncReinforcementUI();
  }

  _closeReinforcementMenu() {
    this.reinforcementMenuOpen = false;
    const menu = document.getElementById('reinforcement-menu');
    if (menu) menu.classList.add('hidden');
  }

  _syncReinforcementUI() {
    const cdLabel = document.getElementById('reinf-cooldown-label');
    const optInf = document.getElementById('reinf-opt-infantry');
    const optTank = document.getElementById('reinf-opt-tank');
    const badgeInf = document.getElementById('reinf-badge-infantry');
    const badgeTank = document.getElementById('reinf-badge-tank');

    if (this.reinforcementMenuOpen) {
      const cd = Math.ceil(this.reinforcements.cooldownRemaining);
      if (cdLabel) {
        cdLabel.textContent = cd > 0 ? `COOLDOWN ${cd}S` : 'RADIO READY';
        cdLabel.classList.toggle('busy', cd > 0);
      }
      const infCheck = this.reinforcements.canRequest(REINFORCEMENT_TYPE.INFANTRY_SQUAD);
      if (optInf && badgeInf) {
        optInf.classList.toggle('disabled', !infCheck.ok);
        badgeInf.textContent = infCheck.ok
          ? 'AVAILABLE'
          : this.reinforcements.hasActiveRequestOfType(REINFORCEMENT_TYPE.INFANTRY_SQUAD)
            ? 'DEPLOYED'
            : `WAIT ${cd}S`;
      }
      const tankCheck = this.reinforcements.canRequest(REINFORCEMENT_TYPE.TANK);
      if (optTank && badgeTank) {
        optTank.classList.toggle('disabled', !tankCheck.ok);
        badgeTank.textContent = tankCheck.ok
          ? 'AVAILABLE'
          : this.reinforcements.hasActiveRequestOfType(REINFORCEMENT_TYPE.TANK)
            ? 'DEPLOYED'
            : `WAIT ${cd}S`;
      }
    }

    const banner = document.getElementById('reinforcement-banner');
    const bannerTitle = document.getElementById('reinforcement-banner-title');
    const bannerSub = document.getElementById('reinforcement-banner-sub');
    const note = this.reinforcements.notification;
    if (banner && bannerTitle && bannerSub) {
      if (note && this.isCombatMode()) {
        banner.classList.remove('hidden', 'tone-info', 'tone-success', 'tone-warn', 'tone-danger');
        banner.classList.add(`tone-${note.tone || 'info'}`);
        bannerTitle.textContent = note.text;
        bannerSub.textContent = note.subtext || '';
      } else {
        banner.classList.add('hidden');
      }
    }
  }

  _cleanupBattleEntities() {
    this.releaseCustomPossession();
    this.projectiles.projectiles.length = 0;
    this.throwables?.reset();
    this.particles.reset();
    this.trackSystem.reset();
    this.infantryVoice.reset();
    this.reinforcements.reset();
    this.infantryCommand.reset();
    this._syncInfantryCommandUI();
    this.sound.stopAllReloadSounds();
    this._closeReinforcementMenu();
    this.targets = [];
    this.heavyMGs = [];
    this.artilleryGuns = [];
    this.infantry = [];
    this.camera.setZoom(1.0);
  }

  setGameMode(mode, preset = 'trench', customConfig = null) {
    if (mode === GAME_MODE.SOVIET_TRENCH_DEFENSE) {
      this.gameMode = GAME_MODE.SOVIET_TRENCH_DEFENSE;
    } else if (mode === GAME_MODE.CUSTOM_BATTLE) {
      this.gameMode = GAME_MODE.CUSTOM_BATTLE;
    } else if (mode === GAME_MODE.FIRING_RANGE) {
      this.gameMode = GAME_MODE.FIRING_RANGE;
    } else {
      this.gameMode = GAME_MODE.SIMULATION;
    }
    this.firingRangePreset = ['natural', 'simulation'].includes(preset) ? preset : 'trench';
    this._cleanupBattleEntities();
    this.projectiles.friendlyFireEnabled =
      this.isCombatMode() && this.friendlyFireEnabled;
    this.particles.windEnabled = this.isCombatMode() && this.firingRangePreset !== 'simulation';
    this.environment = new BattlefieldEnvironment(this.gameMode, 'AFTERNOON', this.firingRangePreset || 'trench');
    this.minimap.resetVisibility();

    // Reset player tank & camera without spawning a duplicate game loop or resetting audio settings
    this.sound.resetEngineImmediate?.();
    this.sound.setEngineDamage(false, 1.0);
    this.tank = new Tank(this.projectiles, this.particles, this.sound, this.camera);
    this.hasPlayerTank = true;
    this._customBattleTotals = null;
    this.controlMode = CONTROL_MODE.TANK_CONTROL;
    this.controlledSoldier = null;
    this.controlledCrewRole = null;
    this._gInfWasDown = false;
    this._hudNotice = '';
    this._hudNoticeTimer = 0;
    this._bindTankControlCallbacks();
    this.tank.x = this.environment.spawn.x;
    this.tank.y = this.environment.spawn.y;
    this.tank.angle = this.environment.spawn.angle;
    this.tank.turret.hullAngle = this.tank.angle;

    this.camera.x = this.tank.x;
    this.camera.y = this.tank.y;
    this.camera.shake = 0;

    if (this.gameMode === GAME_MODE.SOVIET_TRENCH_DEFENSE) {
      setupSovietTrenchDefense({
        playerTank: this.tank,
        reinforcements: this.reinforcements,
        environment: this.environment,
        targets: this.targets,
        infantry: this.infantry,
        heavyMGs: this.heavyMGs,
        artilleryGuns: this.artilleryGuns,
      });
      this.camera.x = this.tank.x;
      this.camera.y = this.tank.y;
    } else if (this.gameMode === GAME_MODE.CUSTOM_BATTLE && customConfig) {
      const res = spawnCustomBattle(customConfig, {
        playerTank: this.tank,
        reinforcements: this.reinforcements,
        environment: this.environment,
        targets: this.targets,
        infantry: this.infantry,
        heavyMGs: this.heavyMGs,
        artilleryGuns: this.artilleryGuns,
      });
      this.hasPlayerTank = res.hasPlayerTank;
      this._customBattleTotals = res.initialTotals;
      this.camera.x = res.focusX;
      this.camera.y = res.focusY;
      this.camera.vx = 0;
      this.camera.vy = 0;
      this.camera.clampToBounds(window.innerWidth, window.innerHeight);
      this.camera.spectatorAnchorX = this.camera.x;
      this.camera.spectatorAnchorY = this.camera.y;
    } else {
      this.spawnPanzerIII(
        this.environment.targetSpawn.x,
        this.environment.targetSpawn.y,
        this.environment.targetSpawn.angle
      );
      this.infantry = createPanzerIIISquad(
        this.environment.targetSpawn.x,
        this.environment.targetSpawn.y
      );
    }
    this._syncDefenseHUD();
  }

  _syncDefenseHUD() {
    if (this.gameMode === GAME_MODE.SOVIET_TRENCH_DEFENSE) {
      this.hud.updateCustomBattleStatus(false, null);
      const counts = getDefenseForceCounts({
        playerTank: this.tank,
        friendlyTanks: this.reinforcements.friendlyTanks,
        targets: this.targets,
        infantry: this.infantry,
        heavyMGs: this.heavyMGs,
        artilleryGuns: this.artilleryGuns,
      });
      this.hud.updateDefenseStatus(true, counts);
    } else if (this.gameMode === GAME_MODE.CUSTOM_BATTLE) {
      this.hud.updateDefenseStatus(false, null);
      const counts = getCustomBattleCounts({
        playerTank: this.tank,
        hasPlayerTank: this.hasPlayerTank,
        friendlyTanks: this.reinforcements.friendlyTanks,
        targets: this.targets,
        infantry: this.infantry,
        heavyMGs: this.heavyMGs,
        artilleryGuns: this.artilleryGuns,
        initialTotals: this._customBattleTotals,
      });
      counts.possessionLabel = this.customPossession?.label || 'SPECTATOR (CLICK UNIT TO POSSESS)';
      this.hud.updateCustomBattleStatus(true, counts);
    } else {
      this.hud.updateDefenseStatus(false, null);
      this.hud.updateCustomBattleStatus(false, null);
    }
  }

  async init() {
    const [hull, turret, mainGun, coaxMG, hullMG, panzer3, panzer3Hull, panzer3Turret, soldierStand, soldierDown] = await Promise.all([
      loadImage('./assets/tank/hull.svg'),
      loadImage('./assets/tank/turret.svg'),
      loadImage('./assets/tank/main-gun.svg'),
      loadImage('./assets/tank/coax-mg.svg'),
      loadImage('./assets/tank/hull-mg.svg'),
      loadImage('./assets/targets/panzer3.svg'),
      loadImage('./assets/targets/panzer3_hull.svg'),
      loadImage('./assets/targets/panzer3_turret.svg'),
      loadImage('./assets/targets/german_soldier_stand.svg'),
      loadImage('./assets/targets/german_soldier_down.svg'),
    ]);

    this.sprites = { hull, turret, mainGun, coaxMG, hullMG, panzer3, panzer3Hull, panzer3Turret, soldierStand, soldierDown };
  }

  start() {
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this._loop);
  }

  _handleResize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    if (this.gameMode === GAME_MODE.CUSTOM_BATTLE) {
      this.camera.clampToBounds(w, h);
    }
  }

  _loop(now) {
    if (!this.running) return;
    const rawDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    // Clamp dt to prevent huge jumps after tab switching
    const dt = Math.min(0.05, Math.max(0.001, rawDt));

    this._update(dt);
    this._render();

    requestAnimationFrame(this._loop);
  }

  isModalOverlayOpen() {
    const settingsDrawer = document.getElementById('settings-drawer');
    const customModal = document.getElementById('custom-battle-modal');
    const settingsOpen = Boolean(settingsDrawer && !settingsDrawer.classList.contains('hidden'));
    const customOpen = Boolean(customModal && !customModal.classList.contains('hidden'));
    return Boolean(this.reinforcementMenuOpen || settingsOpen || customOpen);
  }

  _update(dt) {
    // Hold-to-inspect X-Ray (Y): active only while KeyY is held down
    this.inspectionMode = this.input.isDown('KeyY');
    this.debugOverlay.updateInput(this.input);

    // Toggle tactical minimap (M)
    const mDown = this.input.isDown('KeyM');
    if (mDown && !this._mWasDown) {
      const panel = document.getElementById('minimap-panel');
      const toggleBtn = document.getElementById('btn-minimap-toggle');
      const nextVis = !this.minimap.visible;
      this.minimap.setVisible(nextVis);
      if (panel) panel.classList.toggle('collapsed', !nextVis);
      if (toggleBtn) toggleBtn.textContent = nextVis ? '_' : '+';
    }
    this._mWasDown = mDown;

    // Toggle Reinforcement Request Menu (T) and close on ESC (Firing Range Mode only)
    const tDown = this.input.isDown('KeyT');
    if (tDown && !this._tWasDown && this.isCombatMode()) {
      if (this.reinforcementMenuOpen) {
        this._closeReinforcementMenu();
      } else {
        this._openReinforcementMenu();
      }
    }
    this._tWasDown = tDown;

    // Toggle Infantry Command Mode (C)
    const cDown = this.input.isDown('KeyC');
    if (cDown && !this._cWasDown) {
      this.infantryCommand.toggleMode();
      this._syncInfantryCommandUI();
    }
    this._cWasDown = cDown;

    const escDown = this.input.isDown('Escape');
    if (escDown && !this._escWasDown) {
      if (this.reinforcementMenuOpen) {
        this._closeReinforcementMenu();
      } else if (this.infantryCommand.active) {
        if (this.infantryCommand.dragBox.active) {
          this.infantryCommand.dragBox.active = false;
        } else if (this.infantryCommand.selectedSoldiers.size > 0) {
          this.infantryCommand.clearSelection();
        } else {
          this.infantryCommand.setModeActive(false);
        }
        this._syncInfantryCommandUI();
      } else if (this.gameMode === GAME_MODE.CUSTOM_BATTLE && this.customPossession.mode !== 'SPECTATOR') {
        this.releaseCustomPossession();
        this._syncDefenseHUD();
      }
    }
    this._escWasDown = escDown;

    if (this._hudNoticeTimer > 0) {
      this._hudNoticeTimer = Math.max(0, this._hudNoticeTimer - dt);
      if (this._hudNoticeTimer === 0) this._hudNotice = '';
    }

    // Handle G-key return-to-tank command while in INFANTRY_CONTROL (only when player tank exists)
    if (this.controlMode === CONTROL_MODE.INFANTRY_CONTROL && this.hasPlayerTank) {
      const gDown = this.input.isDown('KeyG');
      if (gDown && !this._gInfWasDown && this.controlledSoldier && this.controlledSoldier.combatCapable) {
        const res = this.tank.bailout.requestReentry(
          this.controlledCrewRole,
          this.infantry,
          {
            hullX: this.tank.x,
            hullY: this.tank.y,
            hullAngle: this.tank.angle,
            turretPivot: this.tank.getTurretPivot(),
            turretAngle: this.tank.turret.worldAngle,
          },
          this.tank.trackRepair
        );
        if (!res.ok) {
          this._hudNotice = res.reason;
          this._hudNoticeTimer = 2.0;
        }
      }
      this._gInfWasDown = gDown;
    } else {
      this._gInfWasDown = false;
    }

    const modalOpen = this.isModalOverlayOpen();
    const tankInput =
      this.controlMode === CONTROL_MODE.TANK_CONTROL && !modalOpen
        ? this.input
        : NULL_INPUT;
    // Return to SPECTATOR on KeyV in CUSTOM_BATTLE, or auto-return if possessed unit dies/is destroyed
    const vDown = this.input.isDown('KeyV');
    if (vDown && !this._vWasDown && this.gameMode === GAME_MODE.CUSTOM_BATTLE) {
      this.releaseCustomPossession();
      this._syncDefenseHUD();
    }
    this._vWasDown = vDown;

    if (this.gameMode === GAME_MODE.CUSTOM_BATTLE && this.customPossession.entity) {
      const ent = this.customPossession.entity;
      const k = this.customPossession.kind;
      const deadOrDisabled =
        ent.alive === false ||
        ent.combatCapable === false ||
        ent.destroyed ||
        ent.damageSystem?.vehicleDestroyed ||
        ent.vehicleState === 'BURNT_OUT' ||
        ((k === 'ZIS3' || k === 'DSHK') && !ent.operational);
      if (deadOrDisabled) {
        this.releaseCustomPossession();
        this._syncDefenseHUD();
      }
    }

    const allEnemyAndAllied = [...this.targets, ...this.reinforcements.friendlyTanks];
    const isCombatRange = this.isCombatMode();
    if (this.hasPlayerTank) {
      this.tank.update(dt, tankInput, allEnemyAndAllied, this.infantry, this.environment);
      this.environment.update(dt, this.tank, this.particles);
      this.environment.resolveTankCollisions(this.tank, this.particles);
      this.trackSystem.updateVehicleTracks(
        this.tank,
        dt,
        this.environment,
        45 * CONFIG.TANK.SCALE,
        15 * CONFIG.TANK.SCALE,
        isCombatRange
      );
    } else {
      this.environment.update(dt, null, this.particles);
      if (
        this.gameMode === GAME_MODE.CUSTOM_BATTLE &&
        this.customPossession &&
        this.customPossession.mode !== 'SPECTATOR' &&
        this.customPossession.entity
      ) {
        this.camera.update(this.customPossession.entity.x, this.customPossession.entity.y, dt);
        this.camera.clampToBounds(window.innerWidth, window.innerHeight);
      } else {
        // Exclusive free-camera pan in spectator mode (paused while any modal overlay is open)
        this.camera.updateSpectator(modalOpen ? NULL_INPUT : this.input, dt, window.innerWidth, window.innerHeight);
      }
    }
    if (isCombatRange) {
      this.reinforcements.update(dt, {
        playerTank: this.hasPlayerTank ? this.tank : null,
        playerInput: this.gameMode === GAME_MODE.CUSTOM_BATTLE && !modalOpen ? this.input : null,
        targets: this.targets,
        infantry: this.infantry,
        environment: this.environment,
        voiceSystem: this.infantryVoice,
        persistentTracks: {
          recordTankTracks: (t, stepDt, env) =>
            this.trackSystem.updateVehicleTracks(
              t,
              stepDt,
              env,
              45 * CONFIG.TANK.SCALE,
              15 * CONFIG.TANK.SCALE,
              true
            ),
        },
      });
      for (const ft of this.reinforcements.friendlyTanks) {
        this.environment.resolveTankCollisions(ft, this.particles);
      }
    }
    this._syncReinforcementUI();
    this.projectiles.update(
      dt,
      this.targets,
      this.infantry,
      this.environment,
      this.hasPlayerTank ? this.tank : null,
      this.reinforcements.friendlyTanks
    );
    const targetCombatCtx = isCombatRange
      ? {
          playerTank: this.hasPlayerTank ? this.tank : null,
          friendlyTanks: this.reinforcements.friendlyTanks,
          allTargets: this.targets,
          environment: this.environment,
          projectiles: this.projectiles,
          sound: this.sound,
          voiceSystem: this.infantryVoice,
          playerInput: this.gameMode === GAME_MODE.CUSTOM_BATTLE && !modalOpen ? this.input : null,
        }
      : null;
    for (const target of this.targets) {
      target.update(dt, this.particles, this.infantry, targetCombatCtx);
      if (isCombatRange) {
        this.environment.resolveTankCollisions(target, this.particles);
        this.trackSystem.updateVehicleTracks(
          target,
          dt,
          this.environment,
          46 * CONFIG.TANK.SCALE,
          13 * CONFIG.TANK.SCALE,
          true
        );
      }
    }
    const mouseWorld = this.camera.screenToWorld(
      this.input.mouseScreenX,
      this.input.mouseScreenY,
      window.innerWidth,
      window.innerHeight
    );
    const infantryCmdInput =
      this.controlMode === CONTROL_MODE.INFANTRY_CONTROL && !modalOpen
        ? (this.infantryCommand.active
            ? {
                isDown: (c) => this.input.isDown(c),
                isAnyDown: (...c) => this.input.isAnyDown(...c),
                mouseLeftDown: false, // Suppress weapon firing while selecting/commanding squad
                _mouseOverHud: this.input._mouseOverHud,
              }
            : this.input)
        : null;
    const aiContext = {
      tanks: [
        ...(this.hasPlayerTank ? [this.tank] : []),
        ...this.reinforcements.friendlyTanks,
        ...this.targets,
      ],
      infantry: this.infantry,
      heavyMGs: this.heavyMGs,
      artilleryGuns: this.artilleryGuns,
      throwables: this.gameMode === GAME_MODE.CUSTOM_BATTLE ? this.throwables : null,
      customBattleMode: this.gameMode === GAME_MODE.CUSTOM_BATTLE,
      onHudNotice: (msg) => {
        if (msg) {
          this._hudNotice = msg;
          this._hudNoticeTimer = 2.2;
        }
      },
      environment: this.environment,
      projectiles: this.projectiles,
      particles: this.particles,
      sound: this.sound,
      listenerX: this.camera.x,
      listenerY: this.camera.y,
      input: infantryCmdInput,
      mouseWorld,
      combatEnabled: isCombatRange,
      voiceSystem: this.infantryVoice,
    };
    for (const soldier of this.infantry) {
      soldier.update(dt, this.particles, this.targets, aiContext);
    }
    for (const hmg of this.heavyMGs) {
      hmg.update(dt, {
        infantry: this.infantry,
        tanks: [
          ...(this.hasPlayerTank ? [this.tank] : []),
          ...this.reinforcements.friendlyTanks,
          ...this.targets,
        ],
        environment: this.environment,
        projectiles: this.projectiles,
        particles: this.particles,
        sound: this.sound,
        listenerX: this.camera.x,
        listenerY: this.camera.y,
        playerInput: this.gameMode === GAME_MODE.CUSTOM_BATTLE && !modalOpen ? this.input : null,
      });
    }
    for (const gun of this.artilleryGuns) {
      gun.update(dt, {
        infantry: this.infantry,
        tanks: [
          ...(this.hasPlayerTank ? [this.tank] : []),
          ...this.reinforcements.friendlyTanks,
          ...this.targets,
        ],
        environment: this.environment,
        projectiles: this.projectiles,
        particles: this.particles,
        sound: this.sound,
        listenerX: this.camera.x,
        listenerY: this.camera.y,
        playerInput: this.gameMode === GAME_MODE.CUSTOM_BATTLE && !modalOpen ? this.input : null,
      });
    }
    if (this.gameMode === GAME_MODE.CUSTOM_BATTLE) {
      this.throwables.update(dt, {
        infantry: this.infantry,
        tanks: [
          ...(this.hasPlayerTank ? [this.tank] : []),
          ...this.reinforcements.friendlyTanks,
          ...this.targets,
        ],
        heavyMGs: this.heavyMGs,
        artilleryGuns: this.artilleryGuns,
        environment: this.environment,
        friendlyFireEnabled: this.projectiles.friendlyFireEnabled,
      });
    }
    this._syncDefenseHUD();
    this.infantryCommand.update(dt, {
      environment: this.environment,
      tanks: [this.tank, ...this.reinforcements.friendlyTanks, ...this.targets],
    });
    this._syncInfantryCommandUI();
    this.infantryVoice.update(dt, this.infantry, this.environment, this.camera.x, this.camera.y);
    this.particles.update(dt);
    if (isCombatRange && Math.random() < dt * 2.2) {
      const dx = this.camera.x + (Math.random() - 0.5) * 900;
      const dy = this.camera.y + (Math.random() - 0.5) * 650;
      this.particles.spawnAmbientDust(dx, dy);
    }
    this.minimap.updateVisibility(dt, {
      environment: this.environment,
      playerTank: this.tank,
      friendlyTanks: this.reinforcements.friendlyTanks,
      targets: this.targets,
      infantry: this.infantry,
    });

    // If controlled soldier is wounded/incapacitated or KIA, immediately disable infantry controls & return to T-34-85 if operational
    if (this.controlMode === CONTROL_MODE.INFANTRY_CONTROL && this.controlledSoldier && !this.controlledSoldier.combatCapable) {
      this.controlledSoldier.isPlayerControlled = false;
      this.controlledSoldier._playerVx = 0;
      this.controlledSoldier._playerVy = 0;
      const tankOperational = !this.tank.damageSystem.vehicleDestroyed && !this.tank.damageSystem.vehicleAbandoned;
      if (tankOperational) {
        this.controlMode = CONTROL_MODE.TANK_CONTROL;
        this.controlledSoldier = null;
        this.controlledCrewRole = null;
      }
    }

    if (this.hasPlayerTank && this.gameMode !== GAME_MODE.CUSTOM_BATTLE) {
      if (this.controlMode === CONTROL_MODE.INFANTRY_CONTROL && this.controlledSoldier) {
        this.camera.update(this.controlledSoldier.x, this.controlledSoldier.y, dt);
      } else {
        this.camera.update(this.tank.x, this.tank.y, dt);
      }
    }
    const activeHudTank =
      this.gameMode === GAME_MODE.CUSTOM_BATTLE &&
      this.customPossession.kind === 'T34_85' &&
      this.customPossession.entity
        ? this.customPossession.entity
        : this.tank;
    this.hud.update(activeHudTank, CONFIG.WORLD.CELL_SIZE, this.inspectionMode, {
      gameMode: this.gameMode,
      customPossession: this.customPossession,
      controlMode: this.controlMode,
      controlledSoldier: this.controlledSoldier,
      controlledCrewRole: this.controlledCrewRole,
      notice: this._hudNotice,
    });
  }

  _render() {
    const ctx = this.ctx;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // Outer void outside the 3x3 proving ground
    ctx.fillStyle = '#0d0d0e';
    ctx.fillRect(0, 0, vw, vh);

    // Apply camera transform
    this.camera.applyTransform(ctx, vw, vh);

    const isFiringRange = this.isCombatMode();
    const lighting = isFiringRange ? this.environment.lighting : null;
    const viewBounds = {
      minX: this.camera.x - vw * 0.56,
      maxX: this.camera.x + vw * 0.56,
      minY: this.camera.y - vh * 0.56,
      maxY: this.camera.y + vh * 0.56,
    };

    // 1. Grid (Simulation) or Natural Terrain + Craters (Firing Range)
    if (isFiringRange) {
      this.environment.renderTerrain(ctx);
      this.environment.renderGroundZones(ctx, viewBounds);
    } else {
      this._renderGridWorld(ctx);
      this.environment.renderGroundZones(ctx);
    }

    // 2. Persistent spatial-chunk track impressions, ground decals & low vegetation below vehicles
    this.trackSystem.render(ctx, viewBounds, isFiringRange);
    this.particles.renderTrackMarks(ctx);
    this.particles.renderBloodMarks(ctx);
    this.environment.renderLowVegetation(ctx, this.tank, viewBounds);

    // 3. Subtle aim line from 85mm muzzle
    this._renderAimSightLine(ctx);

    // 3b. Neutralized infantry on ground (under vehicles)
    for (const s of this.infantry) {
      if (s.state === SOLDIER_STATE.DEAD) {
        if (
          s.x + 40 < viewBounds.minX ||
          s.x - 40 > viewBounds.maxX ||
          s.y + 40 < viewBounds.minY ||
          s.y - 40 > viewBounds.maxY
        ) {
          continue;
        }
        s.renderRifle(ctx);
        s.render(ctx, lighting);
      }
    }

    // 4. Target Vehicles (Panzer III) & Projectiles
    for (const target of this.targets) {
      target.render(
        ctx,
        this.sprites.panzer3,
        this.inspectionMode,
        this.sprites.panzer3Hull,
        this.sprites.panzer3Turret,
        lighting
      );
    }
    // Selection rings & attack objective marker beneath living infantry
    this.infantryCommand.renderWorld(ctx);

    // Fixed 12.7mm DShK heavy machine-gun emplacements & ZiS-3 76.2mm field gun
    for (const hmg of this.heavyMGs) {
      hmg.render(ctx);
    }
    for (const gun of this.artilleryGuns) {
      gun.render(ctx);
    }

    // Living, falling & ragdoll infantry around Panzer III
    for (const s of this.infantry) {
      if (s.state !== SOLDIER_STATE.DEAD) {
        if (
          s.x + 40 < viewBounds.minX ||
          s.x - 40 > viewBounds.maxX ||
          s.y + 40 < viewBounds.minY ||
          s.y - 40 > viewBounds.maxY
        ) {
          continue;
        }
        s.renderRifle(ctx);
        s.render(ctx, lighting);
      }
    }
    this.projectiles.render(ctx);
    if (this.gameMode === GAME_MODE.CUSTOM_BATTLE) {
      this.throwables.render(ctx);
      if (this.customPossession?.entity) {
        const ent = this.customPossession.entity;
        const r = this.customPossession.kind === 'INFANTRY' ? 18 : (this.customPossession.kind === 'DSHK' ? 26 : (this.customPossession.kind === 'ZIS3' ? 32 : 70));
        ctx.save();
        ctx.strokeStyle = 'rgba(137, 224, 108, 0.92)';
        ctx.lineWidth = 2.2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(ent.x, ent.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 5. Friendly Reinforcement Tanks & Player T-34-85 Tank
    this.reinforcements.renderFriendlyTanks(ctx, this.sprites, this.inspectionMode, lighting);
    if (this.hasPlayerTank) {
      this.tank.render(ctx, this.sprites, this.inspectionMode, lighting);
    }

    // 5. Overhead dugout roofs, tall standing vegetation & canopies (above vehicles/infantry) + 6. Effects
    this.environment.renderOverhead(ctx, viewBounds);
    this.environment.renderTallVegetation(ctx, this.tank, viewBounds);
    this.particles.render(ctx);
    this.particles.renderSmokeClouds(ctx);
    this.infantryVoice.renderCallouts(ctx);

    // Subtle aiming reticle at world mouse position during INFANTRY_CONTROL
    if (
      this.controlMode === CONTROL_MODE.INFANTRY_CONTROL &&
      this.controlledSoldier &&
      this.controlledSoldier.combatCapable &&
      !this.input._mouseOverHud
    ) {
      const mw = this.camera.screenToWorld(this.input.mouseScreenX, this.input.mouseScreenY, vw, vh);
      const s = this.controlledSoldier;
      const ready = s.magAmmo > 0 && s.aiState !== 'CYCLING_BOLT' && s.aiState !== 'RELOADING';
      ctx.save();
      ctx.strokeStyle = ready ? 'rgba(169, 204, 137, 0.85)' : 'rgba(240, 180, 67, 0.85)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(mw.x, mw.y, 9, 0, Math.PI * 2);
      ctx.moveTo(mw.x - 14, mw.y);
      ctx.lineTo(mw.x - 5, mw.y);
      ctx.moveTo(mw.x + 5, mw.y);
      ctx.lineTo(mw.x + 14, mw.y);
      ctx.moveTo(mw.x, mw.y - 14);
      ctx.lineTo(mw.x, mw.y - 5);
      ctx.moveTo(mw.x, mw.y + 5);
      ctx.lineTo(mw.x, mw.y + 14);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();

    // 7. Atmospheric color grading & subtle distance haze (Firing Range Mode only)
    if (isFiringRange && lighting && !this.nightMode) {
      ctx.save();
      ctx.scale(this.dpr, this.dpr);
      ctx.fillStyle = lighting.tint;
      ctx.fillRect(0, 0, vw, vh);
      const vg = ctx.createRadialGradient(
        vw * 0.5,
        vh * 0.5,
        Math.min(vw, vh) * 0.36,
        vw * 0.5,
        vh * 0.5,
        Math.hypot(vw, vh) * 0.62
      );
      vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vg.addColorStop(1, `rgba(18, 22, 16, ${lighting.hazeAlpha.toFixed(2)})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, vw, vh);
      ctx.restore();
    }

    // 8. Screen-space Night Combat darkness/headlights & localized optics damage overlays
    if (this.nightMode) {
      this._renderNightLighting(ctx, vw, vh);
    }
    this._renderOpticsEffects(ctx, vw, vh);

    this.minimap.render({
      environment: this.environment,
      playerTank: this.tank,
      friendlyTanks: this.reinforcements.friendlyTanks,
      controlledSoldier: this.controlMode === CONTROL_MODE.INFANTRY_CONTROL ? this.controlledSoldier : null,
      targets: this.targets,
      infantry: this.infantry,
    });

    this.infantryCommand.renderScreenOverlay(
      ctx,
      this.dpr,
      vw,
      vh,
      this.input.mouseScreenX,
      this.input.mouseScreenY
    );
  }

  _renderGridWorld(ctx) {
    const cols = CONFIG.WORLD.GRID_COLS;
    const rows = CONFIG.WORLD.GRID_ROWS;
    const cell = CONFIG.WORLD.CELL_SIZE;
    const sub = CONFIG.WORLD.SUBGRID_STEP;
    const totalW = CONFIG.WORLD.WIDTH;
    const totalH = CONFIG.WORLD.HEIGHT;
    const colLabels = ['A', 'B', 'C'];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cell;
        const y = r * cell;
        const isDark = (r + c) % 2 === 1;

        // High-contrast monochrome cell fill
        ctx.fillStyle = isDark ? '#18181a' : '#f0f0ec';
        ctx.fillRect(x, y, cell, cell);

        // Fine technical coordinate sub-grid
        ctx.strokeStyle = isDark
          ? 'rgba(255, 255, 255, 0.08)'
          : 'rgba(0, 0, 0, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let sx = sub; sx < cell; sx += sub) {
          ctx.moveTo(x + sx, y);
          ctx.lineTo(x + sx, y + cell);
        }
        for (let sy = sub; sy < cell; sy += sub) {
          ctx.moveTo(x, y + sy);
          ctx.lineTo(x + cell, y + sy);
        }
        ctx.stroke();

        // Center crosshairs in each cell
        const cx = x + cell / 2;
        const cy = y + cell / 2;
        ctx.strokeStyle = isDark
          ? 'rgba(255, 255, 255, 0.18)'
          : 'rgba(0, 0, 0, 0.18)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - 24, cy);
        ctx.lineTo(cx + 24, cy);
        ctx.moveTo(cx, cy - 24);
        ctx.lineTo(cx, cy + 24);
        ctx.stroke();

        // Sector label
        ctx.fillStyle = isDark
          ? 'rgba(255, 255, 255, 0.22)'
          : 'rgba(0, 0, 0, 0.22)';
        ctx.font = '700 28px "JetBrains Mono", "SF Mono", monospace';
        ctx.fillText(`${colLabels[c]}${r + 1}`, x + 28, y + 48);
      }
    }

    // Crisp 3x3 cell divider lines
    ctx.strokeStyle = '#6e6e6a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let c = 1; c < cols; c++) {
      ctx.moveTo(c * cell, 0);
      ctx.lineTo(c * cell, totalH);
    }
    for (let r = 1; r < rows; r++) {
      ctx.moveTo(0, r * cell);
      ctx.lineTo(totalW, r * cell);
    }
    ctx.stroke();

    // Outer proving ground perimeter frame
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, totalW, totalH);
  }

  _renderAimSightLine(ctx) {
    const ds = this.tank.damageSystem;
    const gunOpt = ds ? ds.getState('GUNNER_OPTICS') : MODULE_STATE.NORMAL;
    const gunnerDead = ds ? ds.getState('GUNNER') === MODULE_STATE.DESTROYED : false;
    if (gunnerDead || gunOpt === MODULE_STATE.DESTROYED) return;

    const pivot = this.tank.getTurretPivot();
    const muzzle = this.tank.turret.getMainGunMuzzle(pivot);
    const angle = this.tank.turret.worldAngle;
    const len = gunOpt === MODULE_STATE.NORMAL ? 320 : 150;

    ctx.save();
    ctx.strokeStyle = gunOpt === MODULE_STATE.NORMAL
      ? 'rgba(130, 175, 95, 0.35)'
      : 'rgba(220, 155, 65, 0.28)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(muzzle.x, muzzle.y);
    ctx.lineTo(muzzle.x + Math.cos(angle) * len, muzzle.y + Math.sin(angle) * len);
    ctx.stroke();
    ctx.restore();
  }

  _renderNightLighting(ctx, vw, vh) {
    if (this._lightCanvas.width !== vw || this._lightCanvas.height !== vh) {
      this._lightCanvas.width = vw;
      this._lightCanvas.height = vh;
    }
    const lctx = this._lightCtx;
    const ds = this.tank.damageSystem;
    const cmdrBad = ds && (ds.getState('COMMANDER_OPTICS') === MODULE_STATE.DESTROYED || ds.getState('COMMANDER') === MODULE_STATE.DESTROYED);
    const drvVisBad = ds && ds.getState('DRIVER_VISION') === MODULE_STATE.DESTROYED;

    lctx.save();
    lctx.clearRect(0, 0, vw, vh);
    lctx.fillStyle = cmdrBad ? 'rgba(4, 7, 14, 0.90)' : 'rgba(6, 10, 18, 0.82)';
    lctx.fillRect(0, 0, vw, vh);

    // Cut out light cones in world space
    lctx.translate(
      Math.round(vw / 2 - this.camera.x + this.camera.shakeOffsetX),
      Math.round(vh / 2 - this.camera.y + this.camera.shakeOffsetY)
    );
    lctx.globalCompositeOperation = 'destination-out';

    // Ambient close-range visibility around T-34-85
    const ambR = cmdrBad ? 120 : 175;
    const ambGrad = lctx.createRadialGradient(this.tank.x, this.tank.y, 20, this.tank.x, this.tank.y, ambR);
    ambGrad.addColorStop(0, 'rgba(0,0,0,0.92)');
    ambGrad.addColorStop(1, 'rgba(0,0,0,0)');
    lctx.fillStyle = ambGrad;
    lctx.beginPath();
    lctx.arc(this.tank.x, this.tank.y, ambR, 0, Math.PI * 2);
    lctx.fill();

    // Forward hull headlights cone (when tank is not destroyed)
    if (!ds || !ds.vehicleDestroyed) {
      const cos = Math.cos(this.tank.angle);
      const sin = Math.sin(this.tank.angle);
      const hx = this.tank.x + cos * 68;
      const hy = this.tank.y + sin * 68;
      const beamLen = drvVisBad ? 220 : 380;
      const beamGrad = lctx.createRadialGradient(hx, hy, 10, hx, hy, beamLen);
      beamGrad.addColorStop(0, drvVisBad ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.95)');
      beamGrad.addColorStop(1, 'rgba(0,0,0,0)');
      lctx.fillStyle = beamGrad;
      lctx.beginPath();
      lctx.moveTo(hx, hy);
      lctx.arc(hx, hy, beamLen, this.tank.angle - 0.38, this.tank.angle + 0.38);
      lctx.closePath();
      lctx.fill();
    }

    // Muzzle flash / explosion illumination
    if (this.tank.turret.mainGun.recoilOffset > 1.5 || this.tank.turret.coaxMG.isFiring || this.tank.hullMG.isFiring) {
      const pivot = this.tank.getTurretPivot();
      const m = this.tank.turret.getMainGunMuzzle(pivot);
      const flashR = this.tank.turret.mainGun.recoilOffset > 1.5 ? 240 : 140;
      const fg = lctx.createRadialGradient(m.x, m.y, 10, m.x, m.y, flashR);
      fg.addColorStop(0, 'rgba(0,0,0,0.95)');
      fg.addColorStop(1, 'rgba(0,0,0,0)');
      lctx.fillStyle = fg;
      lctx.beginPath();
      lctx.arc(m.x, m.y, flashR, 0, Math.PI * 2);
      lctx.fill();
    }

    lctx.restore();

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.drawImage(this._lightCanvas, 0, 0);
    ctx.restore();
  }

  _renderOpticsEffects(ctx, vw, vh) {
    const ds = this.tank.damageSystem;
    if (!ds) return;
    const gunOpt = ds.getState('GUNNER_OPTICS');
    const drvVis = ds.getState('DRIVER_VISION');
    const cmdOpt = ds.getState('COMMANDER_OPTICS');

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // Localized cracked sight indicator near center when Gunner Optics damaged (never darkens whole screen)
    if (gunOpt !== MODULE_STATE.NORMAL) {
      const cx = vw / 2;
      const cy = vh / 2;
      ctx.strokeStyle = gunOpt === MODULE_STATE.DESTROYED ? 'rgba(255, 110, 90, 0.45)' : 'rgba(255, 200, 100, 0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, 48, 0, Math.PI * 2);
      ctx.moveTo(cx - 32, cy - 28);
      ctx.lineTo(cx + 12, cy + 16);
      ctx.moveTo(cx + 26, cy - 22);
      ctx.lineTo(cx - 14, cy + 26);
      ctx.stroke();
    }

    // Localized driver periscope scratch strip at top-center edge
    if (drvVis !== MODULE_STATE.NORMAL) {
      ctx.fillStyle = drvVis === MODULE_STATE.DESTROYED ? 'rgba(30, 20, 18, 0.24)' : 'rgba(40, 35, 25, 0.14)';
      ctx.fillRect(vw * 0.32, 0, vw * 0.36, 26);
    }

    // Subtle peripheral vignette when Commander Cupola damaged
    if (cmdOpt !== MODULE_STATE.NORMAL) {
      const g = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.34, vw / 2, vh / 2, Math.max(vw, vh) * 0.68);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, cmdOpt === MODULE_STATE.DESTROYED ? 'rgba(0,0,0,0.42)' : 'rgba(0,0,0,0.22)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, vw, vh);
    }

    ctx.restore();
  }
}
