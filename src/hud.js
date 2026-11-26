/**
 * Military HUD controller: updates telemetry, compass dial, 85mm cannon status,
 * dual 7.62mm DT machine gun ammo & independent heat bars, and controls legend.
 */
import {
  CUSTOM_UNIT_DEFS,
  CUSTOM_PRESETS,
  createDefaultCustomConfig,
  validateCustomConfig,
} from './customBattle.js?v=21';

function toCompassDeg(rad) {
  // Convert Canvas angle (0 = East, -PI/2 = North) to standard 0-359° North=0°
  let deg = (rad * 180) / Math.PI + 90;
  deg = ((deg % 360) + 360) % 360;
  return Math.round(deg);
}

function getSectorLabel(x, y, cellSize) {
  const col = Math.min(2, Math.max(0, Math.floor(x / cellSize)));
  const row = Math.min(2, Math.max(0, Math.floor(y / cellSize)));
  const cols = ['A', 'B', 'C'];
  const rows = ['1', '2', '3'];
  return `${cols[col]}${rows[row]}`;
}

export class HUD {
  constructor(sound) {
    this.sound = sound;

    // Telemetry elements
    this.elSpeed = document.getElementById('hud-speed');
    this.elGear = document.getElementById('hud-gear');
    this.elRpm = document.getElementById('hud-rpm');
    this.elHullDeg = document.getElementById('hud-hull-deg');
    this.elTurretDeg = document.getElementById('hud-turret-deg');
    this.elSector = document.getElementById('hud-sector');
    this.elCoords = document.getElementById('hud-coords');
    this.elTraverseMode = document.getElementById('hud-traverse-mode');

    // Compass SVG needles
    this.elCompassHull = document.getElementById('compass-hull');
    this.elCompassTurret = document.getElementById('compass-turret');

    // Main gun 85mm
    this.elCannonAmmo = document.getElementById('hud-cannon-ammo');
    this.elCannonStatus = document.getElementById('hud-cannon-status');
    this.elCannonBar = document.getElementById('hud-cannon-bar');

    // Shared MG pool
    this.elMgTotal = document.getElementById('hud-mg-total');

    // Coaxial MG
    this.elCoaxMag = document.getElementById('hud-coax-mag');
    this.elCoaxStatus = document.getElementById('hud-coax-status');
    this.elCoaxHeat = document.getElementById('hud-coax-heat');
    this.elCoaxHeatPct = document.getElementById('hud-coax-heat-pct');

    // Hull MG
    this.elHullMgMag = document.getElementById('hud-hullmg-mag');
    this.elHullMgStatus = document.getElementById('hud-hullmg-status');
    this.elHullMgHeat = document.getElementById('hud-hullmg-heat');
    this.elHullMgHeatPct = document.getElementById('hud-hullmg-heat-pct');

    // Audio toggle & Engine / Tracks mixer
    this.elAudioBtn = document.getElementById('btn-audio');
    if (this.elAudioBtn) {
      this.elAudioBtn.addEventListener('click', () => {
        this.sound.init();
        const muted = this.sound.toggleMute();
        this.elAudioBtn.textContent = muted ? 'AUDIO: OFF' : 'AUDIO: ON';
        this.elAudioBtn.classList.toggle('muted', muted);
        this.elAudioBtn.blur();
      });
    }

    this.elEngineBtn = document.getElementById('btn-engine');
    if (this.elEngineBtn) {
      this.elEngineBtn.addEventListener('click', () => {
        this.sound.init();
        this.sound.toggleEngine();
        this.elEngineBtn.blur();
      });
    }

    this.elVolEngine = document.getElementById('vol-engine');
    this.elValVolEngine = document.getElementById('val-vol-engine');
    if (this.elVolEngine) {
      this.elVolEngine.addEventListener('input', (e) => {
        this.sound.init();
        const val = Number(e.target.value);
        this.sound.setEngineVolume(val / 100);
        if (this.elValVolEngine) this.elValVolEngine.textContent = `${val}%`;
      });
    }

    this.elVolTracks = document.getElementById('vol-tracks');
    this.elValVolTracks = document.getElementById('val-vol-tracks');
    if (this.elVolTracks) {
      this.elVolTracks.addEventListener('input', (e) => {
        this.sound.init();
        const val = Number(e.target.value);
        this.sound.setTracksVolume(val / 100);
        if (this.elValVolTracks) this.elValVolTracks.textContent = `${val}%`;
      });
    }

    this.elVolCannon = document.getElementById('vol-cannon');
    this.elValVolCannon = document.getElementById('val-vol-cannon');
    if (this.elVolCannon) {
      this.elVolCannon.addEventListener('input', (e) => {
        this.sound.init();
        const val = Number(e.target.value);
        this.sound.setCannonVolume(val / 100);
        if (this.elValVolCannon) this.elValVolCannon.textContent = `${val}%`;
      });
    }

    this.elVolMG = document.getElementById('vol-mg');
    this.elValVolMG = document.getElementById('val-vol-mg');
    if (this.elVolMG) {
      this.elVolMG.addEventListener('input', (e) => {
        this.sound.init();
        const val = Number(e.target.value);
        this.sound.setMGVolume(val / 100);
        if (this.elValVolMG) this.elValVolMG.textContent = `${val}%`;
      });
    }

    this.elVolInfantry = document.getElementById('vol-infantry');
    this.elValVolInfantry = document.getElementById('val-vol-infantry');
    if (this.elVolInfantry) {
      this.elVolInfantry.addEventListener('input', (e) => {
        this.sound.init();
        const val = Number(e.target.value);
        this.sound.setInfantryVolume(val / 100);
        if (this.elValVolInfantry) this.elValVolInfantry.textContent = `${val}%`;
      });
    }

    this.elVolReload = document.getElementById('vol-reload');
    this.elValVolReload = document.getElementById('val-vol-reload');
    if (this.elVolReload) {
      this.elVolReload.addEventListener('input', (e) => {
        this.sound.init();
        const val = Number(e.target.value);
        this.sound.setReloadMechVolume(val / 100);
        if (this.elValVolReload) this.elValVolReload.textContent = `${val}%`;
      });
    }

    this.elVolCrew = document.getElementById('vol-crew');
    this.elValVolCrew = document.getElementById('val-vol-crew');
    if (this.elVolCrew) {
      this.elVolCrew.addEventListener('input', (e) => {
        this.sound.init();
        const val = Number(e.target.value);
        this.sound.setCrewVoiceVolume(val / 100);
        if (this.elValVolCrew) this.elValVolCrew.textContent = `${val}%`;
      });
    }

    this.elCrewBtn = document.getElementById('btn-crew');
    if (this.elCrewBtn) {
      this.elCrewBtn.addEventListener('click', () => {
        this.sound.init();
        const enabled = this.sound.crew.toggleEnabled();
        this.elCrewBtn.textContent = enabled ? 'CREW: ON' : 'CREW: OFF';
        this.elCrewBtn.className = enabled ? 'engine-btn state-idle' : 'engine-btn';
        this.elCrewBtn.blur();
      });
    }

    this.elXrayPanel = document.getElementById('hud-xray-panel');
    this.elXrayStatus = document.getElementById('hud-xray-status');
    this.elDamageWarnings = document.getElementById('hud-damage-warnings');
    this.elRepairPanel = document.getElementById('hud-repair-panel');
    this.elTrackL = document.getElementById('hud-track-l');
    this.elTrackR = document.getElementById('hud-track-r');
    this.elRepairCrewStatus = document.getElementById('hud-repair-crew-status');
    this.elRepairTime = document.getElementById('hud-repair-time');
    this.elRepairBarWrap = document.getElementById('hud-repair-bar-wrap');
    this.elRepairBar = document.getElementById('hud-repair-bar');
    this.elCrewRows = document.querySelectorAll('#hud-crew-list .crew-row');
    this.elCrewHoldWrap = document.getElementById('hud-crew-hold-wrap');
    this.elCrewHoldRing = document.getElementById('hud-crew-hold-ring');
    this.elCrewHoldTime = document.getElementById('hud-crew-hold-time');
    this.elInfCtrlPanel = document.getElementById('hud-infantry-control');
    this.elInfCtrlTitle = document.getElementById('hud-inf-ctrl-title');
    this.elInfCtrlState = document.getElementById('hud-inf-ctrl-state');
    this.elInfCtrlRole = document.getElementById('hud-inf-ctrl-role');
    this.elInfCtrlHp = document.getElementById('hud-inf-ctrl-hp');
    this.elInfWeaponStatus = document.getElementById('hud-inf-weapon-status');
    this.elInfSlots = document.getElementById('hud-inf-slots');
    this.elInfBayonetRow = document.getElementById('hud-inf-bayonet-row');
    this.elInfBayonetLabel = document.getElementById('hud-inf-bayonet-label');
    this.elInfBayonetState = document.getElementById('hud-inf-bayonet-state');
    this.elCrewPanel = document.getElementById('hud-crew-panel');
    this.elTankBottomLeft = document.querySelector('.hud-bottom-left-cluster');
    this.elTankBottomRight = document.querySelector('.hud-bottom-right');
    this.elEmplacementPanel = document.getElementById('hud-emplacement-panel');
    this.elEmpTitle = document.getElementById('hud-emp-title');
    this.elEmpState = document.getElementById('hud-emp-state');
    this.elEmpWeapon = document.getElementById('hud-emp-weapon');
    this.elEmpAmmo = document.getElementById('hud-emp-ammo');
    this.elEmpCrew = document.getElementById('hud-emp-crew');
    this.elEmpHp = document.getElementById('hud-emp-hp');
    this.elEmpControls = document.getElementById('hud-emp-controls');
    this.elDefensePanel = document.getElementById('hud-defense-panel');
    this.elDefSovTanks = document.getElementById('def-sov-tanks');
    this.elDefSovInf = document.getElementById('def-sov-inf');
    this.elDefSovHmg = document.getElementById('def-sov-hmg');
    this.elDefGerTanks = document.getElementById('def-ger-tanks');
    this.elDefGerInf = document.getElementById('def-ger-inf');
    this.elDefOutcome = document.getElementById('def-outcome');
    this.elDefZisBox = document.getElementById('def-zis3-box');
    this.elDefZisStatus = document.getElementById('def-zis3-status');
    this.elDefZisReloadTxt = document.getElementById('def-zis3-reload-txt');
    this.elDefZisReloadBar = document.getElementById('def-zis3-reload-bar');
    this.elDefZisSel = document.getElementById('def-zis3-sel');
    this.elDefZisCrew = document.getElementById('def-zis3-crew');
    this.elDefZisRoles = document.getElementById('def-zis3-roles');
    this.elDefZisAmmo = document.getElementById('def-zis3-ammo');
    this.elInfCtrlWeapon = document.getElementById('hud-inf-ctrl-weapon');
    this.elInfCtrlAmmo = document.getElementById('hud-inf-ctrl-ammo');
    this.elNotice = document.getElementById('hud-notice');
    this.elAmmoPills = document.querySelectorAll('#hud-ammo-types .ammo-pill');
    this.elDayNightBtn = document.getElementById('btn-day-night');
    this.onToggleNightMode = null;

    if (this.elDayNightBtn) {
      this.elDayNightBtn.addEventListener('click', () => {
        const isNight = this.onToggleNightMode ? this.onToggleNightMode() : false;
        this.elDayNightBtn.textContent = isNight ? 'MODE: NIGHT' : 'MODE: DAY';
        this.elDayNightBtn.className = isNight ? 'engine-btn state-starting' : 'engine-btn state-idle';
        this.elDayNightBtn.blur();
      });
    }

    this.elModeCards = document.querySelectorAll('#settings-drawer .mode-card');
    this.elApplyModeBtn = document.getElementById('btn-apply-mode');
    this.onSelectAmmo = null;
    this._ammoBaseLabels = {
      BR365K: '1:APHE',
      BR365A: '2:BR-365A',
      BR365P: '3:APCR',
      O365K: '4:HE',
    };
    if (this.elAmmoPills) {
      for (const pill of this.elAmmoPills) {
        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onSelectAmmo?.(pill.dataset.ammo);
          pill.blur();
        });
      }
    }
    this.elFiringPresetBtn = document.getElementById('btn-firing-preset');
    this.elFriendlyFireBtn = document.getElementById('btn-friendly-fire');
    this.elFFToast = document.getElementById('friendly-fire-toast');
    this.elFFToastTitle = document.getElementById('ff-toast-title');
    this.elFFToastDetail = document.getElementById('ff-toast-detail');
    this._ffToastTimer = null;
    this._friendlyFireEnabled = true;
    this.onToggleFriendlyFire = null;
    this._selectedGameMode = 'simulation';
    this._selectedFiringPreset = 'trench';
    this.onApplyGameMode = null;

    if (this.elFriendlyFireBtn) {
      this.elFriendlyFireBtn.addEventListener('click', () => {
        this._friendlyFireEnabled = !this._friendlyFireEnabled;
        this.elFriendlyFireBtn.textContent = this._friendlyFireEnabled
          ? 'FRIENDLY FIRE: ON'
          : 'FRIENDLY FIRE: OFF';
        this.elFriendlyFireBtn.className = this._friendlyFireEnabled
          ? 'engine-btn state-running'
          : 'engine-btn state-idle';
        this.onToggleFriendlyFire?.(this._friendlyFireEnabled);
        this.elFriendlyFireBtn.blur();
      });
    }

    if (this.elFiringPresetBtn) {
      this.elFiringPresetBtn.addEventListener('click', () => {
        this._selectedFiringPreset = this._selectedFiringPreset === 'trench' ? 'natural' : 'trench';
        this.elFiringPresetBtn.textContent =
          this._selectedFiringPreset === 'trench' ? 'MAP: TRENCHES' : 'MAP: NATURAL';
        this.elFiringPresetBtn.blur();
      });
    }

    for (const card of this.elModeCards) {
      card.addEventListener('click', () => {
        this._selectedGameMode = card.dataset.mode;
        for (const c of this.elModeCards) {
          c.classList.toggle('selected', c.dataset.mode === this._selectedGameMode);
        }
        card.blur();
      });
    }

    if (this.elApplyModeBtn) {
      this.elApplyModeBtn.addEventListener('click', () => {
        if (this._selectedGameMode === 'custom_battle') {
          this.elSettingsDrawer?.classList.add('hidden');
          this.elSettingsToggle?.classList.remove('active');
          this.openCustomBattleModal();
        } else if (this.onApplyGameMode) {
          this.onApplyGameMode(this._selectedGameMode, this._selectedFiringPreset);
        }
        this.elApplyModeBtn.blur();
      });
    }

    this._initCustomBattleUI();

    this.elSettingsToggle = document.getElementById('btn-settings-toggle');
    this.elSettingsClose = document.getElementById('btn-settings-close');
    this.elSettingsDrawer = document.getElementById('settings-drawer');

    if (this.elSettingsToggle && this.elSettingsDrawer) {
      this.elSettingsToggle.addEventListener('click', () => {
        const isHidden = this.elSettingsDrawer.classList.toggle('hidden');
        this.elSettingsToggle.classList.toggle('active', !isHidden);
        this.elSettingsToggle.blur();
      });
    }

    this.elSettingsTabs = document.querySelectorAll('#settings-drawer .settings-tab');
    this.elSettingsPanes = document.querySelectorAll('#settings-drawer .settings-tab-pane');

    for (const tabBtn of this.elSettingsTabs) {
      tabBtn.addEventListener('click', () => {
        const target = tabBtn.dataset.tab;
        for (const t of this.elSettingsTabs) {
          const isMatch = t.dataset.tab === target;
          t.classList.toggle('active', isMatch);
          t.setAttribute('aria-selected', isMatch ? 'true' : 'false');
        }
        for (const p of this.elSettingsPanes) {
          p.classList.toggle('active', p.dataset.tabPane === target);
        }
        tabBtn.blur();
      });
    }

    if (this.elSettingsClose && this.elSettingsDrawer) {
      this.elSettingsClose.addEventListener('click', () => {
        this.elSettingsDrawer.classList.add('hidden');
        if (this.elSettingsToggle) {
          this.elSettingsToggle.classList.remove('active');
        }
        this.elSettingsClose.blur();
      });
    }
  }

  showFriendlyFireNotice({ type = 'FRIENDLY FIRE', detail = '', isKill = false } = {}) {
    if (!this.elFFToast || !this.elFFToastTitle || !this.elFFToastDetail) return;
    this.elFFToastTitle.textContent = type;
    this.elFFToastDetail.textContent = detail;
    this.elFFToast.classList.remove('hidden', 'kill');
    if (isKill) this.elFFToast.classList.add('kill');
    if (this._ffToastTimer) clearTimeout(this._ffToastTimer);
    this._ffToastTimer = setTimeout(() => {
      this.elFFToast?.classList.add('hidden');
    }, 3000);
  }

  update(tank, cellSize, inspectionMode = false, controlCtx = null) {
    const isCustomBattle = Boolean(controlCtx && controlCtx.gameMode === 'custom_battle');
    const customPoss = isCustomBattle && controlCtx.customPossession ? controlCtx.customPossession : null;
    const contextKind = isCustomBattle
      ? (customPoss && customPoss.mode !== 'SPECTATOR' && customPoss.entity ? customPoss.kind : 'SPECTATOR')
      : (controlCtx && controlCtx.controlMode === 'INFANTRY_CONTROL' && controlCtx.controlledSoldier ? 'INFANTRY' : 'T34_85');

    const showTankHud = contextKind === 'T34_85' || contextKind === 'PANZER_III';
    const showInfantryHud = contextKind === 'INFANTRY';
    const showEmplacementHud = contextKind === 'ZIS3' || contextKind === 'DSHK';

    if (this.elCrewPanel) this.elCrewPanel.classList.toggle('hidden', !showTankHud);
    if (this.elTankBottomLeft) this.elTankBottomLeft.classList.toggle('hidden', !showTankHud);
    if (this.elTankBottomRight) this.elTankBottomRight.classList.toggle('hidden', !showTankHud);
    if (this.elXrayPanel) {
      this.elXrayPanel.classList.toggle('hidden', !(showTankHud && inspectionMode));
    }
    if (this.elDamageWarnings) {
      this.elDamageWarnings.classList.toggle('hidden', !showTankHud);
    }
    if (!showTankHud && this.elRepairPanel) {
      this.elRepairPanel.classList.add('hidden');
    }

    const ds = tank ? tank.damageSystem : null;
    if (showTankHud && ds && this.elXrayStatus) {
      const crewAlive = ds.modules.filter((m) => m.category === 'crew' && m.state !== 'DESTROYED').length;
      const damagedCount = ds.modules.filter((m) => m.state !== 'NORMAL').length;
      this.elXrayStatus.textContent = damagedCount === 0
        ? `CREW: ${crewAlive}/5 • ALL MODULES: NORMAL`
        : `CREW: ${crewAlive}/5 • DAMAGED MODULES: ${damagedCount}`;
    }
    if (showTankHud && ds && this.elDamageWarnings) {
      const pills = [];
      const trackDmg = ds.getState('LEFT_TRACK') !== 'NORMAL' || ds.getState('RIGHT_TRACK') !== 'NORMAL';
      const engDmg = ds.getState('ENGINE') !== 'NORMAL';
      const gunBad = ds.getState('GUN_BARREL') === 'DESTROYED' || ds.getState('GUNNER') === 'DESTROYED';
      const opticsDmg = ds.getState('GUNNER_OPTICS') !== 'NORMAL' || ds.getState('COMMANDER_OPTICS') !== 'NORMAL' || ds.getState('DRIVER_VISION') !== 'NORMAL';
      const crewDead = ds.modules.some((m) => m.category === 'crew' && m.state === 'DESTROYED');

      if (ds.ammoFireActive) pills.push({ text: 'AMMUNITION FIRE', crit: true });
      if (trackDmg) pills.push({ text: 'TRACK DAMAGED', crit: ds.getState('LEFT_TRACK') === 'DESTROYED' || ds.getState('RIGHT_TRACK') === 'DESTROYED' });
      if (engDmg) pills.push({ text: 'ENGINE DAMAGED', crit: ds.getState('ENGINE') === 'DESTROYED' });
      if (gunBad) pills.push({ text: 'GUN DISABLED', crit: true });
      if (opticsDmg) pills.push({ text: 'OPTICS DAMAGED', crit: false });
      if (crewDead) pills.push({ text: 'CREW INCAPACITATED', crit: true });

      const key = pills.map((p) => `${p.text}:${p.crit}`).join('|');
      if (this._lastWarnKey !== key) {
        this._lastWarnKey = key;
        this.elDamageWarnings.innerHTML = pills
          .map((p) => `<span class="warn-pill${p.crit ? ' critical' : ''}">${p.text}</span>`)
          .join('');
      }
    }

    if (showTankHud && tank && tank.trackRepair && this.elRepairPanel) {
      const tr = tank.trackRepair;
      const stL = tr.getTrackDisplayState('LEFT_TRACK');
      const stR = tr.getTrackDisplayState('RIGHT_TRACK');
      const showRepair = stL !== 'OPERATIONAL' || stR !== 'OPERATIONAL' || tr.isActive;
      this.elRepairPanel.classList.toggle('hidden', !showRepair);
      if (showRepair) {
        if (this.elTrackL) this.elTrackL.textContent = stL;
        if (this.elTrackR) this.elTrackR.textContent = stR;
        if (this.elRepairCrewStatus) this.elRepairCrewStatus.textContent = `CREW: ${tr.crewState}`;
        const isRepairing = tr.crewState === 'REPAIRING';
        if (this.elRepairTime) this.elRepairTime.textContent = isRepairing ? `${tr.remainingSeconds.toFixed(1)}s` : '--';
        if (this.elRepairBarWrap) this.elRepairBarWrap.classList.toggle('hidden', !isRepairing);
        if (this.elRepairBar && isRepairing) {
          this.elRepairBar.style.width = `${(tr.repairProgress * 100).toFixed(1)}%`;
        }
      }
    }

    if (showTankHud && ds && this.elCrewRows) {
      for (const row of this.elCrewRows) {
        const cid = row.dataset.crew;
        const mod = ds.getModule(cid);
        const st = ds.getCrewStatus(cid);
        const isOut = Boolean(mod && mod.bailedOut) || (tank.trackRepair && tank.trackRepair.isActive && tank.trackRepair.assignedCrewId === cid);
        row.classList.toggle('selected', tank.selectedCrewId === cid);
        row.classList.toggle('outside', isOut);
        const metaEl = document.getElementById(`crew-meta-${cid}`);
        if (metaEl) {
          const healthLabel = st === 'EMPTY' ? 'HEALTHY' : st;
          metaEl.textContent = `${healthLabel} • ${isOut ? 'OUT' : 'IN'}`;
        }
      }
      if (this.elCrewHoldWrap) {
        const prog = tank.gHoldProgress || 0;
        this.elCrewHoldWrap.classList.toggle('hidden', prog <= 0);
        if (prog > 0) {
          if (this.elCrewHoldRing) {
            this.elCrewHoldRing.style.strokeDashoffset = (56.55 * (1 - prog)).toFixed(2);
          }
          if (this.elCrewHoldTime) {
            this.elCrewHoldTime.textContent = `${tank.gHoldRemaining.toFixed(1)}s`;
          }
        }
      }
    }

    if (this.elInfCtrlPanel) {
      const s = showInfantryHud
        ? ((customPoss && customPoss.kind === 'INFANTRY' && customPoss.entity) || (controlCtx && controlCtx.controlledSoldier) || null)
        : null;
      const isInf = Boolean(showInfantryHud && s);
      this.elInfCtrlPanel.classList.toggle('hidden', !isInf);
      if (isInf) {
        this._updateInfantryWeaponHud(s, controlCtx);
      }
    }

    if (this.elEmplacementPanel) {
      const emp = showEmplacementHud && customPoss ? customPoss.entity : null;
      const isEmp = Boolean(showEmplacementHud && emp);
      this.elEmplacementPanel.classList.toggle('hidden', !isEmp);
      if (isEmp) {
        this._updateEmplacementHud(customPoss.kind, emp);
      }
    }

    if (this.elNotice) {
      const msg = controlCtx && controlCtx.notice ? controlCtx.notice : '';
      this.elNotice.classList.toggle('hidden', !msg);
      if (msg) this.elNotice.textContent = msg;
    }

    if (!showTankHud || !tank || !tank.turret || !tank.turret.mainGun) {
      return;
    }
    if (this.elAmmoPills) {
      const gun = tank.turret.mainGun;
      const sel = gun.selectedAmmoId;
      const loaded = gun.loadedAmmoId || sel;
      for (const pill of this.elAmmoPills) {
        const id = pill.dataset.ammo;
        const cnt = gun.getAmmoCount ? gun.getAmmoCount(id) : gun.ammo;
        pill.classList.toggle('active', id === sel);
        pill.classList.toggle('loaded-ring', id === loaded);
        pill.disabled = cnt <= 0;
        const lbl = this._ammoBaseLabels[id] || id;
        pill.textContent = `${lbl} (${cnt})`;
      }
    }
    const hullDeg = toCompassDeg(tank.angle);
    const turretDeg = toCompassDeg(tank.turret.worldAngle);

    // Speed, Gear, RPM & orientation
    const dirTag = tank.speed < -2 ? ' REV' : '';
    this.elSpeed.textContent = `${tank.speedKmh.toFixed(1)} km/h${dirTag}`;
    if (tank.drivetrain && this.elGear && this.elRpm) {
      const dtState = tank.drivetrain;
      this.elGear.textContent = dtState.isShifting
        ? `SHF→${dtState.pendingGear}`
        : dtState.gear;
      const thrPct = Math.round(dtState.throttle * 100);
      this.elRpm.textContent = `${Math.round(dtState.rpm)} • ${thrPct}%`;
    }
    this.elHullDeg.textContent = `${String(hullDeg).padStart(3, '0')}°`;
    this.elTurretDeg.textContent = `${String(turretDeg).padStart(3, '0')}°`;
    this.elSector.textContent = getSectorLabel(tank.x, tank.y, cellSize);
    this.elCoords.textContent = `${Math.round(tank.x)}, ${Math.round(tank.y)}`;

    // Rotate compass indicators (0 deg = Up/North in SVG)
    this.elCompassHull.setAttribute('transform', `rotate(${hullDeg} 36 36)`);
    this.elCompassTurret.setAttribute('transform', `rotate(${turretDeg} 36 36)`);

    // Engine state badge & turret traverse mode
    if (this.elEngineBtn) {
      const st = this.sound.engineState;
      const label = st === 'SHUTDOWN' ? 'ENGINE STOPPING' : `ENGINE ${st}`;
      this.elEngineBtn.textContent = label;
      this.elEngineBtn.className = `engine-btn state-${st.toLowerCase()}`;
    }
    if (this.elTraverseMode) {
      const powered = tank.electricalPower === 'POWER_AVAILABLE';
      this.elTraverseMode.textContent = powered ? 'POWERED TRAVERSE' : 'MANUAL TRAVERSE';
      this.elTraverseMode.style.color = powered ? '#a6e388' : '#ffbe66';
    }

    // 85mm Main Gun
    const gun = tank.turret.mainGun;
    this.elCannonAmmo.textContent = `${gun.ammo} / ${gun.ammoMax}`;
    if (gun.ammo === 0) {
      this.elCannonStatus.textContent = 'DEPLETED';
      this.elCannonStatus.className = 'badge badge-danger';
      this.elCannonBar.style.width = '0%';
    } else if (gun.isReloading) {
      this.elCannonStatus.textContent = `RELOAD ${gun.reloadTimer.toFixed(1)}s`;
      this.elCannonStatus.className = 'badge badge-warn';
      this.elCannonBar.style.width = `${(gun.reloadProgress * 100).toFixed(1)}%`;
    } else {
      this.elCannonStatus.textContent = 'READY';
      this.elCannonStatus.className = 'badge badge-ok';
      this.elCannonBar.style.width = '100%';
    }

    // Shared 7.62mm DT Ammo Pool
    this.elMgTotal.textContent = tank.mgAmmoPool.totalAmmo.toLocaleString('en-US');

    // Coaxial MG
    this._updateMGPanel(
      tank.turret.coaxMG,
      this.elCoaxMag,
      this.elCoaxStatus,
      this.elCoaxHeat,
      this.elCoaxHeatPct
    );

    // Hull MG
    this._updateMGPanel(
      tank.hullMG,
      this.elHullMgMag,
      this.elHullMgStatus,
      this.elHullMgHeat,
      this.elHullMgHeatPct
    );
  }

  _updateInfantryWeaponHud(s, controlCtx) {
    const inv = s.inventory || null;
    const selectedSlot = inv && inv.selectedSlot ? inv.selectedSlot : 'PRIMARY';
    const primaryName = s.weaponCfg ? s.weaponCfg.name : 'RIFLE';

    if (this.elInfCtrlTitle) {
      const factionTag = s.faction === 'GERMAN' ? 'GERMAN INFANTRY' : 'SOVIET INFANTRY';
      this.elInfCtrlTitle.textContent = factionTag;
    }
    if (this.elInfCtrlState) {
      const dead = !s.alive;
      this.elInfCtrlState.textContent = dead ? 'KIA' : (s.wounded ? 'WOUNDED' : 'ALIVE');
      this.elInfCtrlState.className = dead ? 'badge badge-danger' : (s.wounded ? 'badge badge-warn' : 'badge badge-ok');
    }
    if (this.elInfCtrlRole) {
      const roleStr = (controlCtx && controlCtx.controlledCrewRole) || s.crewRole || (s.weaponId === 'PPSH_41' ? 'SMG ASSAULT' : 'RIFLEMAN');
      this.elInfCtrlRole.textContent = `ROLE: ${roleStr}`;
    }
    if (this.elInfCtrlHp) {
      this.elInfCtrlHp.textContent = `HP: ${Math.max(0, Math.round(s.hp))}`;
    }

    let activeWeaponLabel = `🔫 ${primaryName}`;
    let activeAmmoLabel = `${s.magAmmo} / ${s.reserveAmmo}`;
    let statusText = 'READY';
    let statusClass = 'badge badge-ok';

    if (selectedSlot === 'SIDEARM' && inv) {
      activeWeaponLabel = `🔫 ${inv.sidearmName || 'SIDEARM'}`;
      activeAmmoLabel = `${inv.sidearmMag} / ${inv.sidearmReserve}`;
      if (inv.sidearmReloadTimer > 0) {
        statusText = `RELOAD ${inv.sidearmReloadTimer.toFixed(1)}s`;
        statusClass = 'badge badge-warn';
      } else if (inv.sidearmMag <= 0 && inv.sidearmReserve <= 0) {
        statusText = 'EMPTY';
        statusClass = 'badge badge-danger';
      }
    } else if (selectedSlot === 'FRAG' && inv) {
      activeWeaponLabel = `💣 ${inv.fragGrenadeName || 'FRAG GRENADE'}`;
      activeAmmoLabel = `x${inv.fragGrenades}`;
      if (inv.fragGrenades <= 0) {
        statusText = 'DEPLETED';
        statusClass = 'badge badge-danger';
      } else if (inv.grenadeCooldown > 0) {
        statusText = `WAIT ${inv.grenadeCooldown.toFixed(1)}s`;
        statusClass = 'badge badge-warn';
      }
    } else if (selectedSlot === 'INCENDIARY' && inv) {
      activeWeaponLabel = `🔥 ${inv.incendiaryName || 'INCENDIARY'}`;
      activeAmmoLabel = `x${inv.incendiaries}`;
      if (inv.incendiaries <= 0) {
        statusText = 'DEPLETED';
        statusClass = 'badge badge-danger';
      } else if (inv.incendiaryCooldown > 0) {
        statusText = `WAIT ${inv.incendiaryCooldown.toFixed(1)}s`;
        statusClass = 'badge badge-warn';
      }
    } else {
      if (s.reloading) {
        statusText = `RELOAD ${Math.max(0, s.reloadTimer || 0).toFixed(1)}s`;
        statusClass = 'badge badge-warn';
      } else if (s.boltCycling || (s.cycleTimer && s.cycleTimer > 0.05)) {
        statusText = 'CYCLING BOLT';
        statusClass = 'badge badge-active';
      } else if (s.magAmmo <= 0 && s.reserveAmmo <= 0) {
        statusText = 'EMPTY';
        statusClass = 'badge badge-danger';
      }
    }

    if (this.elInfCtrlWeapon) this.elInfCtrlWeapon.textContent = activeWeaponLabel;
    if (this.elInfCtrlAmmo) this.elInfCtrlAmmo.textContent = activeAmmoLabel;
    if (this.elInfWeaponStatus) {
      this.elInfWeaponStatus.textContent = statusText;
      this.elInfWeaponStatus.className = statusClass;
    }

    if (this.elInfSlots) {
      const slots = [
        {
          key: '1',
          slot: 'PRIMARY',
          icon: '🔫',
          name: primaryName,
          count: `${s.magAmmo}/${s.reserveAmmo}`,
          depleted: s.magAmmo <= 0 && s.reserveAmmo <= 0,
        },
      ];
      if (inv && inv.carriesSidearm) {
        slots.push({
          key: '2',
          slot: 'SIDEARM',
          icon: '🔫',
          name: inv.sidearmName || 'SIDEARM',
          count: `${inv.sidearmMag}/${inv.sidearmReserve}`,
          depleted: (inv.sidearmMag + inv.sidearmReserve) <= 0,
        });
      }
      if (inv && inv.carriesFrag) {
        slots.push({
          key: '3',
          slot: 'FRAG',
          icon: '💣',
          name: inv.fragGrenadeName || 'FRAG GRENADE',
          count: `x${inv.fragGrenades}`,
          depleted: inv.fragGrenades <= 0,
        });
      }
      if (inv && inv.carriesIncendiary) {
        slots.push({
          key: '4',
          slot: 'INCENDIARY',
          icon: '🔥',
          name: inv.incendiaryName || 'INCENDIARY',
          count: `x${inv.incendiaries}`,
          depleted: inv.incendiaries <= 0,
        });
      }

      const sig = `${selectedSlot}|` + slots.map((it) => `${it.key}:${it.name}:${it.count}:${it.depleted}`).join('|');
      if (this._lastInfSlotsSig !== sig) {
        this._lastInfSlotsSig = sig;
        this.elInfSlots.innerHTML = slots
          .map((it) => {
            const isSel = selectedSlot === it.slot;
            const bg = isSel ? 'rgba(241,196,15,0.22)' : 'rgba(255,255,255,0.04)';
            const border = isSel ? '1px solid rgba(241,196,15,0.75)' : '1px solid rgba(255,255,255,0.08)';
            const color = it.depleted ? 'rgba(255,120,120,0.65)' : (isSel ? '#ffeaa7' : '#dfe6e9');
            return `<div data-inf-slot="${it.slot}" style="display:flex;align-items:center;justify-content:space-between;padding:3px 6px;border-radius:3px;background:${bg};border:${border};color:${color};">` +
              `<span><b>[${it.key}]</b> ${it.icon} ${it.name}</span>` +
              `<span style="font-weight:700;">${it.count}</span>` +
              `</div>`;
          })
          .join('');
      }
    }

    if (this.elInfBayonetRow) {
      const showBayonet = Boolean(inv && inv.hasBayonet && inv.primaryWeapon !== 'PPSH_41');
      this.elInfBayonetRow.classList.toggle('hidden', !showBayonet);
      if (showBayonet && this.elInfBayonetState) {
        const attached = Boolean(inv.bayonetEquipped);
        this.elInfBayonetState.textContent = attached ? 'ATTACHED' : 'DETACHED';
        this.elInfBayonetState.className = attached ? 'badge badge-ok' : 'badge badge-warn';
      }
    }
  }

  _updateEmplacementHud(kind, emp) {
    if (kind === 'ZIS3') {
      if (this.elEmpTitle) this.elEmpTitle.textContent = '76MM ZIS-3 FIELD GUN';
      const selAmmo = emp.selectedAmmoId || 'BR350A';
      const selCount = emp.ammo && emp.ammo[selAmmo] !== undefined ? emp.ammo[selAmmo] : 0;
      if (this.elEmpWeapon) this.elEmpWeapon.textContent = `SHELL: ${selAmmo} (${selCount})`;
      if (this.elEmpAmmo) {
        const a = emp.ammo || {};
        const apTotal = (a.BR350A || 0) + (a.BR350B || 0) + (a.BR350SP || 0) + (a.BR354P || 0);
        const heTotal = (a.OF350 || 0) + (a.SH354 || 0);
        this.elEmpAmmo.textContent = `AP:${apTotal} • HE/SH:${heTotal}`;
      }
      if (this.elEmpState) {
        if (emp.destroyed) {
          this.elEmpState.textContent = 'DESTROYED';
          this.elEmpState.className = 'badge badge-danger';
        } else if (emp.reloadTimer > 0) {
          this.elEmpState.textContent = `RELOAD ${emp.reloadTimer.toFixed(1)}s`;
          this.elEmpState.className = 'badge badge-warn';
        } else {
          this.elEmpState.textContent = 'READY';
          this.elEmpState.className = 'badge badge-ok';
        }
      }
      const aliveCrew = typeof emp.getCrewAliveCount === 'function' ? emp.getCrewAliveCount() : 3;
      if (this.elEmpCrew) this.elEmpCrew.textContent = `CREW: ${aliveCrew} / 3`;
      if (this.elEmpHp) this.elEmpHp.textContent = `HP: ${Math.max(0, Math.round(emp.hp || 0))}`;
      if (this.elEmpControls) this.elEmpControls.textContent = 'A/D AIM • 1-6 SHELLS • SPACE FIRE • V/ESC SPECTATOR';
    } else if (kind === 'DSHK') {
      if (this.elEmpTitle) this.elEmpTitle.textContent = '12.7MM DSHK HEAVY MG';
      if (this.elEmpWeapon) this.elEmpWeapon.textContent = '12.7×108MM BELT';
      if (this.elEmpAmmo) {
        if (emp.reloading || emp.reloadTimer > 0) {
          this.elEmpAmmo.textContent = `RELOAD ${emp.reloadTimer.toFixed(1)}s`;
        } else {
          this.elEmpAmmo.textContent = `${emp.beltAmmo ?? 50} / ${emp.reserveAmmo ?? 250}`;
        }
      }
      const gunner = emp.operator || emp.gunner || null;
      const gunnerAlive = Boolean(gunner && gunner.alive && gunner.combatCapable !== false);
      if (this.elEmpState) {
        this.elEmpState.textContent = gunnerAlive ? 'OPERATIONAL' : 'UNMANNED';
        this.elEmpState.className = gunnerAlive ? 'badge badge-ok' : 'badge badge-danger';
      }
      if (this.elEmpCrew) {
        this.elEmpCrew.textContent = `GUNNER: ${gunnerAlive ? 'ACTIVE' : 'DOWN'}`;
      }
      if (this.elEmpHp) this.elEmpHp.textContent = `HP: ${Math.max(0, Math.round(emp.hp || 140))}`;
      if (this.elEmpControls) this.elEmpControls.textContent = 'A/D AIM • SPACE FIRE BURST • V/ESC SPECTATOR';
    }
  }

  _updateMGPanel(mg, elMag, elStatus, elHeatBar, elHeatPct) {
    elMag.textContent = `${mg.magAmmo} / ${mg.magSize}`;

    const status = mg.statusText;
    elStatus.textContent = status;
    if (status === 'OVERHEAT' || status === 'EMPTY') {
      elStatus.className = 'badge badge-danger';
    } else if (status === 'RELOADING MAG') {
      elStatus.className = 'badge badge-warn';
    } else if (status === 'FIRING') {
      elStatus.className = 'badge badge-active';
    } else {
      elStatus.className = 'badge badge-ok';
    }

    const pct = Math.round(mg.heatRatio * 100);
    elHeatBar.style.width = `${pct}%`;
    elHeatPct.textContent = `${pct}%`;

    elHeatBar.classList.remove('heat-warm', 'heat-critical');
    if (mg.overheated || pct >= 80) {
      elHeatBar.classList.add('heat-critical');
    } else if (pct >= 45) {
      elHeatBar.classList.add('heat-warm');
    }
  }

  updateDefenseStatus(visible, counts) {
    if (!this.elDefensePanel) return;
    if (!visible || !counts) {
      this.elDefensePanel.classList.add('hidden');
      return;
    }
    this.elDefensePanel.classList.remove('hidden');
    if (this.elDefSovTanks) this.elDefSovTanks.textContent = `${counts.sovietTanks} / ${counts.sovietTanksMax}`;
    if (this.elDefSovInf) this.elDefSovInf.textContent = `${counts.sovietInfantry} / ${counts.sovietInfantryMax}`;
    if (this.elDefSovHmg) this.elDefSovHmg.textContent = String(counts.hmgActive);
    if (this.elDefGerTanks) this.elDefGerTanks.textContent = `${counts.germanTanks} / ${counts.germanTanksMax}`;
    if (this.elDefGerInf) this.elDefGerInf.textContent = `${counts.germanInfantry} / ${counts.germanInfantryMax}`;
    if (this.elDefOutcome) {
      if (counts.outcome) {
        this.elDefOutcome.style.display = 'inline-block';
        this.elDefOutcome.textContent = counts.outcome;
        this.elDefOutcome.className = counts.outcome === 'DEFENSE HELD' ? 'badge badge-ok' : 'badge badge-danger';
      } else {
        this.elDefOutcome.style.display = 'none';
      }
    }
    const z = counts.artillery;
    if (this.elDefZisBox) {
      this.elDefZisBox.style.display = z ? 'block' : 'none';
    }
    if (z) {
      if (this.elDefZisStatus) {
        this.elDefZisStatus.textContent = z.destroyed ? 'DESTROYED' : (z.operational ? 'OPERATIONAL' : 'DISABLED');
        this.elDefZisStatus.className = z.destroyed || !z.operational ? 'badge badge-danger' : 'badge badge-ok';
      }
      if (this.elDefZisReloadTxt) {
        this.elDefZisReloadTxt.textContent = z.reloading ? `RELOAD ${z.reloadTimer.toFixed(1)}s` : 'READY';
        this.elDefZisReloadTxt.style.color = z.reloading ? '#f0b443' : '#a9cc89';
      }
      if (this.elDefZisReloadBar) {
        this.elDefZisReloadBar.style.width = `${Math.round(z.reloadProgress * 100)}%`;
        this.elDefZisReloadBar.style.background = z.reloading ? '#f0b443' : '#89b864';
      }
      if (this.elDefZisSel) this.elDefZisSel.textContent = z.selectedAmmoId;
      if (this.elDefZisCrew) this.elDefZisCrew.textContent = `${z.crewAlive}/${z.crewTotal}`;
      if (this.elDefZisRoles) {
        this.elDefZisRoles.textContent = `C:${z.crewRoles.COMMANDER} L:${z.crewRoles.LOADER} G:${z.crewRoles.GUNNER}`;
      }
      if (this.elDefZisAmmo) {
        const a = z.ammo;
        this.elDefZisAmmo.textContent = `350A:${a.BR350A} 350B:${a.BR350B} SP:${a.BR350SP} 354P:${a.BR354P} OF:${a.OF350} Sh:${a.SH354}`;
      }
    }
  }

  _initCustomBattleUI() {
    this._customConfig = createDefaultCustomConfig();
    this.onStartCustomBattle = null;
    this.onReconfigureCustomBattle = null;
    this.onReturnToSpectator = null;

    this.elCustomModal = document.getElementById('custom-battle-modal');
    this.elCustomClose = document.getElementById('btn-cb-close');
    this.elCustomStart = document.getElementById('btn-cb-start');
    this.elCustomReconfig = document.getElementById('btn-cb-reconfigure');
    this.elCustomSpectatorBtn = document.getElementById('btn-cb-spectator');
    this.elCustomPossessionLabel = document.getElementById('cb-possession-label');
    this.elCustomPanel = document.getElementById('hud-custom-panel');
    this.elCbSovUnits = document.getElementById('cb-soviet-units');
    this.elCbGerUnits = document.getElementById('cb-germany-units');
    this.elCbTotSov = document.getElementById('cb-total-soviet');
    this.elCbTotGer = document.getElementById('cb-total-germany');
    this.elCbMap = document.getElementById('cb-map-select');
    this.elCbDeploy = document.getElementById('cb-deploy-select');
    this.elCbDist = document.getElementById('cb-dist-select');
    this.elCbValMsg = document.getElementById('cb-validation-msg');

    this.elCbSovTanks = document.getElementById('cb-sov-tanks');
    this.elCbGerTanks = document.getElementById('cb-ger-tanks');
    this.elCbSovInf = document.getElementById('cb-sov-inf');
    this.elCbGerInf = document.getElementById('cb-ger-inf');
    this.elCbSovArt = document.getElementById('cb-sov-art');
    this.elCbSovArtCrew = document.getElementById('cb-sov-art-crew');
    this.elCbSovHmg = document.getElementById('cb-sov-hmg');
    this.elCbOutcome = document.getElementById('cb-outcome');

    this.elCustomClose?.addEventListener('click', () => {
      this.elCustomModal?.classList.add('hidden');
    });

    this.elCustomReconfig?.addEventListener('click', () => {
      this.onReconfigureCustomBattle?.();
      this.openCustomBattleModal();
      this.elCustomReconfig.blur();
    });

    this.elCustomSpectatorBtn?.addEventListener('click', () => {
      this.onReturnToSpectator?.();
      this.elCustomSpectatorBtn.blur();
    });

    for (const btn of document.querySelectorAll('.cb-preset-btn')) {
      btn.addEventListener('click', () => {
        const preset = CUSTOM_PRESETS[btn.dataset.preset];
        if (!preset) return;
        this._customConfig = structuredClone(preset);
        this._renderCustomBattleForm();
        btn.blur();
      });
    }

    this.elCbMap?.addEventListener('change', (e) => {
      this._customConfig.map = e.target.value;
      this._syncCustomValidation();
    });
    this.elCbDeploy?.addEventListener('change', (e) => {
      this._customConfig.deployment = e.target.value;
    });
    this.elCbDist?.addEventListener('change', (e) => {
      this._customConfig.distance = e.target.value;
    });

    this.elCustomStart?.addEventListener('click', () => {
      const check = validateCustomConfig(this._customConfig);
      if (!check.ok) {
        this._syncCustomValidation();
        return;
      }
      this.elCustomModal?.classList.add('hidden');
      this.onStartCustomBattle?.(check.config);
      this.elCustomStart.blur();
    });

    this._renderCustomBattleForm();
  }

  openCustomBattleModal() {
    this._renderCustomBattleForm();
    this.elCustomModal?.classList.remove('hidden');
  }

  _getUnitSvg(unitId) {
    if (unitId === 't34_85') {
      return '<svg width="26" height="18" viewBox="0 0 26 18"><rect x="3" y="4" width="16" height="10" rx="1.5" fill="#5e744a" stroke="#181c14"/><rect x="13" y="7.5" width="11" height="3" fill="#4f6342"/><circle cx="11" cy="9" r="3.8" fill="#687f52" stroke="#181c14"/></svg>';
    }
    if (unitId === 'panzer_iii') {
      return '<svg width="26" height="18" viewBox="0 0 26 18"><rect x="4" y="4" width="15" height="10" rx="1" fill="#6b7278" stroke="#181c14"/><rect x="13" y="7.8" width="10" height="2.4" fill="#545a60"/><rect x="8" y="5.5" width="7" height="7" rx="1" fill="#777e84" stroke="#181c14"/></svg>';
    }
    if (unitId === 'zis3') {
      return '<svg width="26" height="18" viewBox="0 0 26 18"><line x1="3" y1="4" x2="13" y2="9" stroke="#4b5b3d" stroke-width="2"/><line x1="3" y1="14" x2="13" y2="9" stroke="#4b5b3d" stroke-width="2"/><rect x="12" y="3" width="3" height="12" fill="#5b6d48"/><rect x="14" y="7.8" width="10" height="2.4" fill="#3c4830"/></svg>';
    }
    if (unitId === 'dshk') {
      return '<svg width="26" height="18" viewBox="0 0 26 18"><circle cx="12" cy="9" r="4" fill="none" stroke="#8a795c" stroke-width="1.6"/><rect x="10" y="7.5" width="13" height="3" fill="#2d312c"/></svg>';
    }
    const col = unitId === 'ger_kar98k' ? '#6d7267' : '#6e7652';
    return `<svg width="26" height="18" viewBox="0 0 26 18"><circle cx="10" cy="9" r="4.5" fill="${col}" stroke="#181c14"/><line x1="13" y1="9" x2="23" y2="9" stroke="#2c241b" stroke-width="1.8"/></svg>`;
  }

  _renderFactionList(container, factionKey, defs) {
    if (!container) return;
    container.innerHTML = '';
    for (const def of defs) {
      const qty = this._customConfig[factionKey][def.id] ?? 0;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border:1px solid rgba(255,255,255,0.08);border-radius:3px;background:rgba(0,0,0,0.22);';
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
          ${this._getUnitSvg(def.id)}
          <div style="min-width:0;">
            <div style="font-size:11px;font-weight:700;color:#e4ecd8;">${def.name} <span style="font-size:9px;opacity:0.7;font-weight:400;">[${def.category}]</span></div>
            <div style="font-size:9.5px;color:#9eb08d;">${def.weaponLabel} • ${def.crewLabel}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">
          <button type="button" class="engine-btn state-idle cb-dec" data-faction="${factionKey}" data-unit="${def.id}" style="padding:2px 7px;font-size:11px;">-</button>
          <span class="cb-qty" style="min-width:22px;text-align:center;font-weight:700;font-size:12px;color:#fff;">${qty}</span>
          <button type="button" class="engine-btn state-idle cb-inc" data-faction="${factionKey}" data-unit="${def.id}" style="padding:2px 7px;font-size:11px;">+</button>
        </div>
      `;
      container.appendChild(row);
    }

    for (const btn of container.querySelectorAll('.cb-dec, .cb-inc')) {
      btn.addEventListener('click', () => {
        const fk = btn.dataset.faction;
        const uid = btn.dataset.unit;
        const def = CUSTOM_UNIT_DEFS[fk].find((d) => d.id === uid);
        if (!def) return;
        const delta = btn.classList.contains('cb-inc') ? 1 : -1;
        const cur = this._customConfig[fk][uid] ?? 0;
        this._customConfig[fk][uid] = Math.max(def.min, Math.min(def.max, cur + delta));
        this._renderCustomBattleForm();
      });
    }
  }

  _renderCustomBattleForm() {
    this._renderFactionList(this.elCbSovUnits, 'soviet', CUSTOM_UNIT_DEFS.soviet);
    this._renderFactionList(this.elCbGerUnits, 'germany', CUSTOM_UNIT_DEFS.germany);
    if (this.elCbMap) this.elCbMap.value = this._customConfig.map;
    if (this.elCbDeploy) this.elCbDeploy.value = this._customConfig.deployment;
    if (this.elCbDist) this.elCbDist.value = this._customConfig.distance;
    this._syncCustomValidation();
  }

  _syncCustomValidation() {
    const check = validateCustomConfig(this._customConfig);
    if (this.elCbTotSov) this.elCbTotSov.textContent = String(check.sovietUnits);
    if (this.elCbTotGer) this.elCbTotGer.textContent = String(check.germanUnits);
    if (this.elCbValMsg) {
      if (!check.ok) {
        this.elCbValMsg.style.color = '#e06458';
        this.elCbValMsg.textContent = check.errors[0];
      } else if (check.warnings.length > 0) {
        this.elCbValMsg.style.color = '#f0b443';
        this.elCbValMsg.textContent = check.warnings[0];
      } else {
        this.elCbValMsg.style.color = '#a9cc89';
        this.elCbValMsg.textContent = `Ready (${check.totalEntities} total units & crew).`;
      }
    }
    if (this.elCustomStart) {
      this.elCustomStart.disabled = !check.ok;
    }
  }

  updateCustomBattleStatus(visible, counts) {
    if (!this.elCustomPanel) return;
    if (!visible || !counts) {
      this.elCustomPanel.classList.add('hidden');
      return;
    }
    this.elCustomPanel.classList.remove('hidden');
    if (this.elCbSovTanks) this.elCbSovTanks.textContent = `${counts.sovietTanks} / ${counts.sovietTanksMax}`;
    if (this.elCbGerTanks) this.elCbGerTanks.textContent = `${counts.germanTanks} / ${counts.germanTanksMax}`;
    if (this.elCbSovInf) this.elCbSovInf.textContent = `${counts.sovietInfantry} / ${counts.sovietInfantryMax}`;
    if (this.elCbGerInf) this.elCbGerInf.textContent = `${counts.germanInfantry} / ${counts.germanInfantryMax}`;
    if (this.elCbSovArt) this.elCbSovArt.textContent = `${counts.sovietArtillery} / ${counts.sovietArtilleryMax}`;
    if (this.elCbSovArtCrew) this.elCbSovArtCrew.textContent = `${counts.sovietArtilleryCrew}/${counts.sovietArtilleryCrewMax}`;
    if (this.elCbSovHmg) this.elCbSovHmg.textContent = `${counts.sovietHmg} / ${counts.sovietHmgMax}`;
    if (this.elCustomPossessionLabel && counts.possessionLabel) {
      this.elCustomPossessionLabel.textContent = counts.possessionLabel;
    }
    if (this.elCbOutcome) {
      if (counts.outcome) {
        this.elCbOutcome.style.display = 'inline-block';
        this.elCbOutcome.textContent = counts.outcome;
        this.elCbOutcome.className = counts.outcome === 'SOVIET VICTORY' ? 'badge badge-ok' : 'badge badge-danger';
      } else {
        this.elCbOutcome.style.display = 'none';
      }
    }
  }
}
