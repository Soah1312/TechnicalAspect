import type { GameConfig } from '../../api/types';
import { stateMachine } from '../../game/stateMachine';
import { serverNow } from '../../util/clock';
import { sounds } from '../../audio/soundManager';
import { DEBUG_CONFIG } from '../../config/constants';
import type { RaceScene } from '../../game/scenes/RaceScene';
import { Car } from '../../game/car';

interface RacingHudProps {
  config: GameConfig;
  raceScene?: RaceScene;
}

export function renderRacingHud(
  container: HTMLElement,
  props: RacingHudProps
): () => void {
  const { config, raceScene } = props;
  let animFrameId: number | null = null;
  let blinkCounter = 0;

  // Track calibration metrics
  const trackLength = raceScene?.track.totalLength || 11200;
  const theoreticalBestLapMs = Math.round((trackLength / Car.MAX_SPEED) * 1000);
  const recommendedMinLapMs = Math.round(theoreticalBestLapMs * 0.8);

  if (DEBUG_CONFIG.isDebug) {
    console.log(
      `[Calibration Helper] Track Length: ${Math.round(trackLength)}px | Max Speed: ${Car.MAX_SPEED}px/s`
    );
    console.log(
      `[Calibration Helper] Theoretical Best Lap: ${(theoreticalBestLapMs / 1000).toFixed(1)}s`
    );
    console.log(
      `[Calibration Helper] RECOMMENDED minLapMs (80%): ${recommendedMinLapMs} ms`
    );
  }

  container.innerHTML = `
    <div class="screen-layer transparent-bg" style="pointer-events:none;">
      <div class="scanlines"></div>

      <!-- Retro Top Arcade HUD -->
      <div class="hud-topbar">
        <div class="hud-group" style="min-width: 44px;">
          <span class="hud-label">LAPS</span>
          <span id="hud-laps" class="hud-value">0</span>
        </div>

        <div class="hud-group" style="min-width: 44px;">
          <span class="hud-label">CORRECT</span>
          <span class="hud-value green-text">0</span>
        </div>

        <div class="hud-group fuel-container" style="flex: 1; max-width: 110px;">
          <div style="display:flex; justify-content:space-between; font-size:7px;">
            <span class="hud-label">FUEL</span>
            <span id="hud-fuel-sec" class="hud-value" style="font-size:7px;">30s</span>
          </div>
          <div class="fuel-gauge-frame">
            <div id="hud-fuel-fill" class="fuel-gauge-fill" style="width: 100%;"></div>
          </div>
        </div>

        <div class="hud-group" style="min-width: 42px;">
          <span class="hud-label">RANK</span>
          <span id="hud-rank" class="hud-value cyan-text">#--</span>
        </div>

        <div class="hud-group" style="min-width: 48px;">
          <span class="hud-label">TIME</span>
          <span id="hud-race-time" class="hud-value">--:--</span>
        </div>

        <button id="hud-mute-btn" class="sound-toggle-btn" style="padding:4px 6px; font-size:8px;">
          ${sounds.isMuted() ? '🔇' : '🔊'}
        </button>
      </div>

      <!-- Minimap Frame (Top Right) -->
      <div class="minimap-frame" id="minimap-container">
        <canvas id="minimap-canvas" width="80" height="80"></canvas>
      </div>

      <!-- Pulsing PIT Button (Appears when fuel <= 50%) -->
      <div style="position: absolute; top: 140px; right: 12px; pointer-events: auto; z-index: 24;">
        <button id="hud-pit-btn" class="pit-btn" style="display: none;">
          PIT STOP
        </button>
      </div>

      <!-- Debug Calibration Bar (if ?debug=1) -->
      ${
        DEBUG_CONFIG.isDebug
          ? `
        <div style="position: absolute; top: 90px; left: 10px; background: rgba(0,0,0,0.8); border: 1px solid #00ff00; padding: 4px 6px; font-size: 7px; color: #00ff00; font-family: monospace; pointer-events: none; z-index: 26;">
          <div>THEORETICAL BEST: ${(theoreticalBestLapMs / 1000).toFixed(1)}s</div>
          <div id="debug-last-lap">LAST LAP: --</div>
          <div>RECOMMENDED minLapMs: ${recommendedMinLapMs}ms</div>
        </div>
      `
          : ''
      }

      <!-- Bottom Multi-Touch Thumb Steering Controls -->
      <div class="steer-controls-container">
        <button id="steer-left-btn" class="steer-thumb-btn" aria-label="Steer Left">
          ◀
        </button>
        <button id="steer-right-btn" class="steer-thumb-btn" aria-label="Steer Right">
          ▶
        </button>
      </div>
    </div>
  `;

  const fuelFillEl = container.querySelector('#hud-fuel-fill') as HTMLDivElement | null;
  const fuelSecEl = container.querySelector('#hud-fuel-sec') as HTMLSpanElement | null;
  const raceTimeEl = container.querySelector('#hud-race-time') as HTMLSpanElement | null;
  const lapsEl = container.querySelector('#hud-laps') as HTMLSpanElement | null;
  const pitBtn = container.querySelector('#hud-pit-btn') as HTMLButtonElement | null;
  const muteBtn = container.querySelector('#hud-mute-btn') as HTMLButtonElement | null;
  const steerLeftBtn = container.querySelector('#steer-left-btn') as HTMLElement | null;
  const steerRightBtn = container.querySelector('#steer-right-btn') as HTMLElement | null;
  const debugLastLapEl = container.querySelector('#debug-last-lap') as HTMLDivElement | null;

  // Setup Minimap Base
  const miniCanvas = container.querySelector('#minimap-canvas') as HTMLCanvasElement | null;
  const miniCtx = miniCanvas?.getContext('2d');
  let baseMinimapImg: HTMLCanvasElement | null = null;
  if (raceScene) {
    baseMinimapImg = raceScene.track.renderMinimap();
  }

  // Bind Multi-Touch Thumb Steering Buttons
  if (raceScene && steerLeftBtn && steerRightBtn) {
    raceScene.inputManager.bindTouchButtons(steerLeftBtn, steerRightBtn);
  }

  // Mute Toggle Button
  muteBtn?.addEventListener('click', () => {
    sounds.unlock();
    const muted = sounds.toggleMute();
    if (muteBtn) {
      muteBtn.textContent = muted ? '🔇' : '🔊';
    }
  });

  // Pit Button (Stage 2: logs action and provides button feedback)
  pitBtn?.addEventListener('click', () => {
    sounds.unlock();
    console.log('[Pit] Voluntary pit clicked (questions will be wired in Stage 3)');
  });

  // Main HUD Update Loop
  const updateLoop = () => {
    const nowServer = serverNow();
    const raceRemainingMs = config.endAt - nowServer;

    // Check race hard stop
    if (raceRemainingMs <= 0) {
      sounds.stopEngine();
      sounds.playRaceEnd();
      stateMachine.transition('ENDED', {
        config,
        laps: raceScene?.lapManager.getLapCount() || 0,
      });
      return;
    }

    if (raceTimeEl) {
      const totalSec = Math.ceil(raceRemainingMs / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      raceTimeEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    if (raceScene) {
      // 1. Update Laps
      if (lapsEl) {
        lapsEl.textContent = raceScene.lapManager.getLapCount().toString();
      }

      // 2. Update Fuel Gauge
      const fuelRatio = raceScene.fuelSystem.getRatio();
      const fuelMs = raceScene.fuelSystem.getFuelMs();

      if (fuelFillEl) {
        fuelFillEl.style.width = `${Math.min(100, Math.max(0, fuelRatio * 100))}%`;
        fuelFillEl.className =
          'fuel-gauge-fill' + (fuelRatio <= 0.25 ? ' critical' : fuelRatio <= 0.5 ? ' low' : '');
      }

      if (fuelSecEl) {
        fuelSecEl.textContent = `${Math.ceil(fuelMs / 1000)}s`;
      }

      // 3. Update Pit Button visibility & pulsing
      const canPit = raceScene.fuelSystem.isPitAllowed();
      if (pitBtn) {
        if (canPit) {
          pitBtn.style.display = 'block';
          pitBtn.classList.add('pulsing-pit');
        } else {
          pitBtn.style.display = 'none';
          pitBtn.classList.remove('pulsing-pit');
        }
      }

      // 4. Update Minimap Blinking Car Dot
      if (miniCtx && miniCanvas && baseMinimapImg) {
        miniCtx.clearRect(0, 0, 80, 80);
        miniCtx.drawImage(baseMinimapImg, 0, 0);

        // Blinking car marker
        blinkCounter++;
        if (blinkCounter % 20 < 14) {
          const mCoords = raceScene.track.worldToMinimap(raceScene.car.x, raceScene.car.y);
          miniCtx.fillStyle = '#ff2e4d';
          miniCtx.beginPath();
          miniCtx.arc(mCoords.mx, mCoords.my, 3.5, 0, Math.PI * 2);
          miniCtx.fill();

          miniCtx.fillStyle = '#ffffff';
          miniCtx.beginPath();
          miniCtx.arc(mCoords.mx, mCoords.my, 1.5, 0, Math.PI * 2);
          miniCtx.fill();
        }
      }

      // 5. Update Debug Metrics
      if (DEBUG_CONFIG.isDebug && debugLastLapEl) {
        const lastLapTime = raceScene.lapManager.getLastLapDrivingTimeMs();
        debugLastLapEl.textContent = `LAST LAP: ${lastLapTime > 0 ? (lastLapTime / 1000).toFixed(1) + 's' : '--'}`;
      }
    }

    animFrameId = requestAnimationFrame(updateLoop);
  };

  animFrameId = requestAnimationFrame(updateLoop);

  return () => {
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId);
    }
  };
}
