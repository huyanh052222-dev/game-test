# Audio Sources & Experimental Usage Notice

All primary T-34-85 audio assets in this directory are sourced from **Gaijin Entertainment's Official War Thunder Modder FMOD Studio Repository** (`https://github.com/GaijinEntertainment/fmod_studio_warthunder_for_modders`).

> **LOCAL-ONLY EXPERIMENTAL USE:** These War Thunder-derived audio assets are restricted strictly to private, local experimentation inside this project. Do not upload, publish, redistribute, or include them in any public repository or release package.

All source `.wav` files (Ogg Vorbis-encoded in the Gaijin FMOD repository) were decoded via `ffmpeg` to 22,050 Hz 16-bit mono WAV (for sample-accurate zero-padding seamless loops) or 192 kbps MP3 (for one-shots).

---

## 1. V-2-34 Diesel Engine (`Assets/tanks/engines/t34/`)
- `wt_t34_engine_start.mp3` ← `t34_engine_start.wav` (Startup cranking & ignition)
- `wt_t34_engine_stop.mp3` ← `t34_engine_stop.wav` (Shutdown spin-down)
- `wt_t34_engine_00.wav` ← `t34_engine_00_load.wav` (`7.65s` equal-power seamless loop — Idle)
- `wt_t34_engine_33.wav` ← `t34_engine_33.wav` (`11.65s` equal-power seamless loop — Low RPM)
- `wt_t34_engine_66.wav` ← `t34_engine_66.wav` (`7.65s` equal-power seamless loop — Medium RPM)
- `wt_t34_engine_99.wav` ← `t34_engine_99.wav` (`7.33s` equal-power seamless loop — High RPM)
- `wt_t34_engine_load.wav` ← `t34_engine_load-001.wav` (`3.20s` equal-power seamless loop — Throttle load)

## 2. Steel Tracks & Turning Rattle (`Assets/tanks/engines/t34/tracks/` & `Assets/tanks/surface/`)
- `wt_t34_tracks_33.wav` ← `t34_tracks_33.wav` (`9.58s` seamless loop — Low speed)
- `wt_t34_tracks_66.wav` ← `t34_tracks_66.wav` (`9.65s` seamless loop — Medium speed)
- `wt_t34_tracks_99.wav` ← `t34_tracks_99.wav` (`9.65s` seamless loop — High speed)
- `wt_t34_turn_rattle.wav` ← `turn_rattle_01.wav` (`6.26s` seamless loop — Turning/pivoting rattle)
- `wt_t34_tracks_stop.mp3` ← `tracks_stop-001.wav` (Track stopping clatter)

## 3. Weapons: 85mm ZiS-S-53 & 7.62mm DT (`Assets/tanks/weapon/`)
- `wt_85mm_shot.mp3` ← `cannons/cannon_85mm_zis_c53/cannon_85mm_zis_c53_shot_01.wav` (85mm main cannon blast)
- `wt_dt_shot.mp3` ← `machineguns/dt/mg_8mm_dt_lastshot_01.wav` (7.62mm DT individual round)

## 4. 6-Stage Cannon Reloading (`Assets/tanks/weapon/cannons/cannon_reloading/`)
1. `crew/mechanical/breech/wt_open_click.mp3` ← `reloading_open_click-001.wav`
2. `crew/mechanical/breech/wt_breech_open.mp3` ← `reloading_open-001.wav`
3. `crew/mechanical/shell_handling/wt_eject_shell.mp3` ← `reloading_eject_shell-001.wav`
4. `crew/mechanical/shell_loading/wt_insert_shell.mp3` ← `reloading_insert_projectile-001.wav`
5. `crew/mechanical/breech/wt_move_breech.mp3` ← `reloading_move_breech-001.wav`
6. `crew/mechanical/breech/wt_breech_close.mp3` ← `reloading_close-001.wav`

## 5. Russian Tank Crew Voices (`Assets/dialogs_wt_tanks_2023/russian_new/med/`)
- **Forward:** `wt_cmd_fwd_1/2.mp3` (`"Вперёд!"`), `wt_drv_fwd_1.mp3` (`"Есть, вперёд!"`)
- **Reverse:** `wt_cmd_rev_1/2.mp3` (`"Задний ход!"`)
- **Cannon Fire:** `wt_cmd_fire_1/2.mp3` (`"Огонь!"`), `wt_gun_shot_1/2.mp3` (`"Выстрел!"`)
- **Reload Started:** `wt_cmd_reload_1/2.mp3` (`"Перезаряжай!"`)
- **Reload Completed:** `wt_ldr_ap_ready_1/2.mp3` (`"Бронебойным готово!"`), `wt_gun_ready_1.mp3` (`"Пушка в строю!"`)

## 6. Infantry Rifles & Kar98k Reference Note
- `kar98k_shot.wav` (44,100 Hz, 16-bit mono WAV, 0.48s) — existing local Kar98k firing asset.
- **User Reference URL (manual integration required):** `https://www.youtube.com/watch?v=jUKf7VjZz_E`
  - Automated tooling could not access or analyze the YouTube audio stream, and YouTube audio cannot be redistributed without authorization. Replace `assets/sounds/kar98k_shot.wav` with an authorized/licensed 44,100 Hz mono WAV recording matching that reference if desired; `SoundEngine.playRifleShot('KAR98K', ...)` will use it automatically.
