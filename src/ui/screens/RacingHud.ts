import type { GameApi, GameConfig } from '../../api/types';
import { stateMachine } from '../../game/stateMachine';
import { serverNow } from '../../util/clock';
import { sounds } from '../../audio/soundManager';
import { Vibration } from '../../util/vibration';

interface RacingHudProps {
  api: GameApi;
  config: GameConfig;
  initialFuelMs?: number;
  initialLaps?: number;
}

export function renderRacingHud(
  container: HTMLElement,
  props: RacingHudProps
): () => void {
  const { api, config } = props;
  let currentFuelMs = props.initialFuelMs ?? config.initialFuelMs;
  let currentLaps = props.initialLaps ?? 0;
  let animFrameId: number | null = null;
  let lastTimestamp = performance.now();

  sounds.startEngine();

  container.innerHTML = `
    <div class="screen-layer transparent-bg" style="pointer-events:none;">
      <div class="scanlines"></div>

      <!-- Retro Top HUD Bar -->
      <div class="hud-topbar">
        <div class="hud-group">
          <span class="hud-label">LAP</span>
          <span id="hud-laps" class="hud-value">${currentLaps}</span>
        </div>

        <div class="hud-group fuel-container">
          <div style="display:flex; justify-content:space-between; font-size:7px;">
            <span class="hud-label">FUEL</span>
            <span id="hud-fuel-sec" class="hud-value" style="font-size:7px;">${Math.ceil(currentFuelMs / 1000)}s</span>
          </div>
          <div class="fuel-gauge-frame">
            <div id="hud-fuel-fill" class="fuel-gauge-fill" style="width: 100%;"></div>
          </div>
        </div>

        <div class="hud-group">
          <span class="hud-label">RACE TIME</span>
          <span id="hud-race-time" class="hud-value">--:--</span>
        </div>

        <button id="hud-mute-btn" class="sound-toggle-btn" style="padding:4px 6px; font-size:8px;">
          ${sounds.isMuted() ? '🔇' : '🔊'}
        </button>
      </div>

      <!-- Center Steering Indicator for Touch / Desktop -->
      <div style="flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center; pointer-events:none;">
        <p class="retro-text" style="opacity:0.6; font-size:8px;">
          [ HOLD LEFT / RIGHT TO STEER ]
        </p>
      </div>

      <!-- Retro Bottom Controls -->
      <div class="hud-bottombar" style="background-color: rgba(11, 11, 30, 0.85); border-top: 2px solid #ffffff;">
        <button id="hud-pit-btn" class="pit-btn" disabled>
          PIT STOP (50%↓)
        </button>

        <div style="display:flex; gap:6px;">
          <button id="hud-test-lap-btn" class="retro-btn btn-secondary" style="padding:6px 8px; font-size:7px; width:auto;">
            +1 LAP
          </button>
          <button id="hud-empty-fuel-btn" class="retro-btn btn-secondary" style="padding:6px 8px; font-size:7px; width:auto; color:var(--wrong-red);">
            DRAIN FUEL
          </button>
          <button id="hud-end-race-btn" class="retro-btn btn-secondary" style="padding:6px 8px; font-size:7px; width:auto;">
            END
          </button>
        </div>
      </div>
    </div>
  `;

  const fuelFillEl = container.querySelector('#hud-fuel-fill') as HTMLDivElement | null;
  const fuelSecEl = container.querySelector('#hud-fuel-sec') as HTMLSpanElement | null;
  const raceTimeEl = container.querySelector('#hud-race-time') as HTMLSpanElement | null;
  const lapsEl = container.querySelector('#hud-laps') as HTMLSpanElement | null;
  const pitBtn = container.querySelector('#hud-pit-btn') as HTMLButtonElement | null;
  const muteBtn = container.querySelector('#hud-mute-btn') as HTMLButtonElement | null;
  const testLapBtn = container.querySelector('#hud-test-lap-btn') as HTMLButtonElement | null;
  const drainFuelBtn = container.querySelector('#hud-empty-fuel-btn') as HTMLButtonElement | null;
  const endRaceBtn = container.querySelector('#hud-end-race-btn') as HTMLButtonElement | null;

  // Sound mute button
  muteBtn?.addEventListener('click', () => {
    sounds.unlock();
    const muted = sounds.toggleMute();
    if (muteBtn) {
      muteBtn.textContent = muted ? '🔇' : '🔊';
    }
  });

  // Voluntary Pit Stop handler
  pitBtn?.addEventListener('click', () => {
    sounds.unlock();
    stateMachine.transition('PIT', {
      api,
      config,
      remainingFuelMs: currentFuelMs,
      laps: currentLaps,
      reason: 'voluntary',
    });
  });

  // Test simulate lap button
  testLapBtn?.addEventListener('click', async () => {
    currentLaps++;
    if (lapsEl) lapsEl.textContent = currentLaps.toString();
    sounds.playLap();
    Vibration.lap();
    try {
      await api.submitLap(currentLaps, config.minLapMs + 1000);
    } catch (err) {
      console.warn('Error submitting lap:', err);
    }
  });

  // Drain fuel button
  drainFuelBtn?.addEventListener('click', () => {
    currentFuelMs = 0;
  });

  // Manual End race button for testing
  endRaceBtn?.addEventListener('click', () => {
    sounds.stopEngine();
    sounds.playRaceEnd();
    stateMachine.transition('ENDED', { api, config, laps: currentLaps });
  });

  // Main loop: fuel burn and race countdown timer
  const updateLoop = (nowTime: number) => {
    const deltaMs = nowTime - lastTimestamp;
    lastTimestamp = nowTime;

    // Check race hard stop
    const nowServer = serverNow();
    const raceRemainingMs = config.endAt - nowServer;

    if (raceRemainingMs <= 0) {
      sounds.stopEngine();
      sounds.playRaceEnd();
      stateMachine.transition('ENDED', { api, config, laps: currentLaps });
      return;
    }

    if (raceTimeEl) {
      const totalSec = Math.ceil(raceRemainingMs / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      raceTimeEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    // Drain fuel while car is moving
    if (currentFuelMs > 0) {
      currentFuelMs = Math.max(0, currentFuelMs - deltaMs);
      const ratio = currentFuelMs / config.tankMaxMs;
      sounds.updateEnginePitch(0.5 + 0.5 * ratio);

      if (fuelFillEl) {
        fuelFillEl.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
        fuelFillEl.className = 'fuel-gauge-fill' + (ratio <= 0.2 ? ' critical' : ratio <= 0.5 ? ' low' : '');
      }

      if (fuelSecEl) {
        fuelSecEl.textContent = `${Math.ceil(currentFuelMs / 1000)}s`;
      }

      // Check voluntary pit availability (tank <= 50%)
      const canPit = ratio <= config.pitBelowFraction;
      if (pitBtn) {
        pitBtn.disabled = !canPit;
      }
    } else {
      // Tank is completely dry! Rolls to stop and opens question modal
      sounds.stopEngine();
      stateMachine.transition('PIT', {
        api,
        config,
        remainingFuelMs: 0,
        laps: currentLaps,
        reason: 'dry',
      });
      return;
    }

    animFrameId = requestAnimationFrame(updateLoop);
  };

  animFrameId = requestAnimationFrame(updateLoop);

  return () => {
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId);
    }
    sounds.stopEngine();
  };
}
