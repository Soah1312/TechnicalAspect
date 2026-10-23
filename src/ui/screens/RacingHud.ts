import type { GameApi, GameConfig } from '../../api/types';
import { stateMachine } from '../../game/stateMachine';
import { serverNow } from '../../util/clock';
import { sounds } from '../../audio/soundManager';
import { DEBUG_CONFIG } from '../../config/constants';
import type { RaceScene } from '../../game/scenes/RaceScene';
import { Car } from '../../game/car';

interface RacingHudProps {
  api: GameApi;
  config: GameConfig;
  raceScene?: RaceScene;
}

export function renderRacingHud(
  container: HTMLElement,
  props: RacingHudProps
): () => void {
  const { api, config, raceScene } = props;
  let animFrameId: number | null = null;
  let blinkCounter = 0;
  let isLeaderboardOpen = false;
  let leaderboardPollTimer: number | null = null;
  let backgroundPollTimer: number | null = null;

  // Track calibration metrics
  const trackLength = raceScene?.track.totalLength || 11200;
  const theoreticalBestLapMs = Math.round((trackLength / Car.MAX_SPEED) * 1000);
  const recommendedMinLapMs = Math.round(theoreticalBestLapMs * 0.8);

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
          <span id="hud-correct" class="hud-value green-text">0</span>
        </div>

        <div class="hud-group fuel-container" style="flex: 1; max-width: 105px;">
          <div style="display:flex; justify-content:space-between; font-size:7px;">
            <span class="hud-label">FUEL</span>
            <span id="hud-fuel-sec" class="hud-value" style="font-size:7px;">30s</span>
          </div>
          <div class="fuel-gauge-frame">
            <div id="hud-fuel-fill" class="fuel-gauge-fill" style="width: 100%;"></div>
          </div>
        </div>

        <!-- Tappable Rank Chip -->
        <button id="hud-rank-btn" class="sound-toggle-btn" style="min-width: 46px; padding:3px 5px; border-color:var(--cyan); cursor:pointer;">
          <span class="hud-label" style="display:block; font-size:6px;">RANK</span>
          <span id="hud-rank" class="hud-value cyan-text" style="font-size:10px;">#--</span>
        </button>

        <div class="hud-group" style="min-width: 46px;">
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
      <div style="position: absolute; top: 138px; right: 10px; pointer-events: auto; z-index: 24;">
        <button id="hud-pit-btn" class="pit-btn" style="display: none;">
          PIT STOP
        </button>
      </div>

      <!-- Calibration Helper Bar (if ?debug=1) -->
      ${
        DEBUG_CONFIG.isDebug
          ? `
        <div style="position: absolute; top: 90px; left: 10px; background: rgba(0,0,0,0.85); border: 1px solid #00ff00; padding: 4px 6px; font-size: 7px; color: #00ff00; font-family: monospace; pointer-events: none; z-index: 26;">
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

      <!-- Leaderboard Slide-up Panel Modal (Hidden by default) -->
      <div id="leaderboard-modal" class="leaderboard-modal-overlay" style="display: none;">
        <div class="leaderboard-panel-sheet">
          <div class="leaderboard-header">
            <div>
              <span class="retro-text highlight" style="font-size:10px;">LEADERBOARD</span>
              <p class="retro-text cyan-text" style="font-size:6px; margin-top:2px;">LIVE FLASHMOB RANKINGS</p>
            </div>
            <button id="close-leaderboard-btn" class="retro-btn btn-secondary" style="width:auto; padding:4px 8px; font-size:8px;">
              CLOSE ✕
            </button>
          </div>

          <div id="live-board-content" style="overflow-y: auto; max-height: 280px;">
            <p class="retro-text" style="font-size:8px; opacity:0.7; padding:10px 0; text-align:center;">
              FETCHING LIVE TELEMETRY...
            </p>
          </div>
        </div>
      </div>
    </div>
  `;

  const fuelFillEl = container.querySelector('#hud-fuel-fill') as HTMLDivElement | null;
  const fuelSecEl = container.querySelector('#hud-fuel-sec') as HTMLSpanElement | null;
  const raceTimeEl = container.querySelector('#hud-race-time') as HTMLSpanElement | null;
  const lapsEl = container.querySelector('#hud-laps') as HTMLSpanElement | null;
  const correctEl = container.querySelector('#hud-correct') as HTMLSpanElement | null;
  const rankEl = container.querySelector('#hud-rank') as HTMLSpanElement | null;
  const rankBtn = container.querySelector('#hud-rank-btn') as HTMLButtonElement | null;
  const pitBtn = container.querySelector('#hud-pit-btn') as HTMLButtonElement | null;
  const muteBtn = container.querySelector('#hud-mute-btn') as HTMLButtonElement | null;
  const steerLeftBtn = container.querySelector('#steer-left-btn') as HTMLElement | null;
  const steerRightBtn = container.querySelector('#steer-right-btn') as HTMLElement | null;
  const debugLastLapEl = container.querySelector('#debug-last-lap') as HTMLDivElement | null;

  const lbModalEl = container.querySelector('#leaderboard-modal') as HTMLDivElement | null;
  const closeLbBtn = container.querySelector('#close-leaderboard-btn') as HTMLButtonElement | null;
  const liveBoardContent = container.querySelector('#live-board-content') as HTMLDivElement | null;

  // Setup Minimap Base Canvas
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

  // Voluntary Pit Stop handler
  pitBtn?.addEventListener('click', () => {
    sounds.unlock();
    sounds.stopEngine();
    stateMachine.transition('PIT', {
      api,
      config,
      raceScene,
      reason: 'voluntary',
    });
  });

  // Wire auto pit stop on empty tank
  if (raceScene) {
    raceScene.fuelSystem.setListeners({
      onEmpty: () => {
        sounds.stopEngine();
        stateMachine.transition('PIT', {
          api,
          config,
          raceScene,
          reason: 'dry',
        });
      },
      onLowFuel: () => {
        sounds.playLowFuelBeep();
      },
    });
  }

  // Leaderboard Modal Open/Close Handlers
  rankBtn?.addEventListener('click', () => {
    sounds.unlock();
    openLeaderboard();
  });

  closeLbBtn?.addEventListener('click', () => {
    closeLeaderboard();
  });

  lbModalEl?.addEventListener('click', (e) => {
    if (e.target === lbModalEl) {
      closeLeaderboard();
    }
  });

  const openLeaderboard = () => {
    isLeaderboardOpen = true;
    if (lbModalEl) lbModalEl.style.display = 'flex';
    fetchLeaderboardData();
    startLeaderboardActivePolling();
  };

  const closeLeaderboard = () => {
    isLeaderboardOpen = false;
    if (lbModalEl) lbModalEl.style.display = 'none';
    if (leaderboardPollTimer !== null) {
      window.clearTimeout(leaderboardPollTimer);
      leaderboardPollTimer = null;
    }
  };

  // Poll leaderboard every 4s (+ 0-1s jitter) while panel is open
  const startLeaderboardActivePolling = () => {
    if (leaderboardPollTimer !== null) window.clearTimeout(leaderboardPollTimer);
    if (!isLeaderboardOpen) return;

    const jitter = Math.floor(Math.random() * 1000);
    leaderboardPollTimer = window.setTimeout(async () => {
      if (isLeaderboardOpen) {
        await fetchLeaderboardData();
        startLeaderboardActivePolling();
      }
    }, 4000 + jitter);
  };

  // Background polling every 8s to keep HUD rank chip updated
  const startBackgroundPolling = () => {
    backgroundPollTimer = window.setInterval(async () => {
      if (!isLeaderboardOpen) {
        try {
          const snap = await api.getLeaderboard();
          if (snap.me && rankEl) {
            rankEl.textContent = `#${snap.me.rank}`;
          }
        } catch {
          // Ignore
        }
      }
    }, 8000);
  };
  startBackgroundPolling();

  const fetchLeaderboardData = async () => {
    try {
      const snap = await api.getLeaderboard();

      if (snap.me) {
        if (rankEl) rankEl.textContent = `#${snap.me.rank}`;
        if (correctEl) correctEl.textContent = snap.me.correct.toString();
      }

      if (liveBoardContent) {
        const isMeInTop10 = snap.top.some((r) => r.isMe);

        liveBoardContent.innerHTML = `
          <table class="leaderboard-table" style="font-size:8px;">
            <thead>
              <tr>
                <th style="width:18%;">RNK</th>
                <th style="width:46%;">NAME</th>
                <th style="width:18%; text-align:right;">LAPS</th>
                <th style="width:18%; text-align:right;">COR</th>
              </tr>
            </thead>
            <tbody>
              ${snap.top
                .map(
                  (row) => `
                <tr class="${row.isMe ? 'my-row' : ''}">
                  <td>#${row.rank}</td>
                  <td style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:110px;">
                    ${row.name}
                  </td>
                  <td style="text-align:right;">${row.laps}</td>
                  <td style="text-align:right;">${row.correct}</td>
                </tr>
              `
                )
                .join('')}

              ${
                !isMeInTop10 && snap.me
                  ? `
                <tr>
                  <td colspan="4" style="text-align:center; padding: 4px; color:var(--cyan); border-top:1px dashed #444;">
                    ••• YOUR POSITION •••
                  </td>
                </tr>
                <tr class="my-row">
                  <td>#${snap.me.rank}</td>
                  <td style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:110px;">
                    ${snap.me.name}
                  </td>
                  <td style="text-align:right;">${snap.me.laps}</td>
                  <td style="text-align:right;">${snap.me.correct}</td>
                </tr>
              `
                  : ''
              }
            </tbody>
          </table>
        `;
      }
    } catch {
      if (liveBoardContent) {
        liveBoardContent.innerHTML = `<p class="retro-text red-text" style="font-size:8px; text-align:center;">LEADERBOARD OFFLINE</p>`;
      }
    }
  };

  // Main HUD Animation / Loop
  const updateLoop = () => {
    const nowServer = serverNow();
    const raceRemainingMs = config.endAt - nowServer;

    // Check race hard stop
    if (raceRemainingMs <= 0) {
      if (raceScene) {
        raceScene.isRaceActive = false;
        raceScene.car.stop();
      }
      sounds.stopEngine();
      sounds.playRaceEnd();

      if (leaderboardPollTimer !== null) {
        window.clearTimeout(leaderboardPollTimer);
        leaderboardPollTimer = null;
      }
      if (backgroundPollTimer !== null) {
        window.clearInterval(backgroundPollTimer);
        backgroundPollTimer = null;
      }

      const finishBanner = document.createElement('div');
      finishBanner.className = 'go-cue-banner';
      finishBanner.style.borderColor = 'var(--accent-yellow)';
      finishBanner.style.color = 'var(--accent-yellow)';
      finishBanner.textContent = '🏁 CHECKERED FLAG — RACE OVER! 🏁';
      container.appendChild(finishBanner);

      window.setTimeout(() => {
        stateMachine.transition('ENDED', {
          api,
          config,
          laps: raceScene?.lapManager.getLapCount() || 0,
        });
      }, 2000);
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

      // 3. Update Pit Button visibility & pulsing (only when fuel <= 50%)
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
    if (leaderboardPollTimer !== null) {
      window.clearTimeout(leaderboardPollTimer);
    }
    if (backgroundPollTimer !== null) {
      window.clearInterval(backgroundPollTimer);
    }
  };
}
