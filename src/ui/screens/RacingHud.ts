import type { GameApi, GameConfig, Scope } from '../../api/types';
import { stateMachine } from '../../game/stateMachine';
import { sounds } from '../../audio/soundManager';
import { DEBUG_CONFIG } from '../../config/constants';
import type { RaceScene } from '../../game/scenes/RaceScene';
import { Car } from '../../game/car';
import { Storage } from '../../util/storage';
import { speedMult } from '../../shared/difficulty';

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
  let currentScope: Scope = 'ALL';
  let prevLap = 0;
  let currentMyRank: number | null = null;

  // Track calibration metrics
  const trackLength = raceScene?.track.totalLength || 11200;
  const theoreticalBestLapMs = Math.round((trackLength / Car.MAX_SPEED) * 1000);
  const recommendedMinLapMs = Math.round(theoreticalBestLapMs * 0.8);

  container.innerHTML = `
    <div class="screen-layer transparent-bg" style="pointer-events:none;">
      <div class="scanlines"></div>

      <!-- Part 2: Compact Single-Row Top Strip (max 44px, <= 8% height) -->
      <div class="hud-topbar">
        <!-- 1. Fuel bar with seconds remaining inside (~55% width) -->
        <div class="hud-fuel-gauge">
          <div id="hud-fuel-fill" class="fuel-bar-fill" style="width: 100%;"></div>
          <span id="hud-fuel-sec" class="fuel-bar-sec">10s</span>
        </div>

        <!-- 2. Laps Pill (L3) -->
        <span id="hud-laps" class="hud-pill yellow-text">L0</span>

        <!-- 3. Correct Answers Pill (✓7) -->
        <span id="hud-correct" class="hud-pill green-text">✓0</span>

        <!-- 4. Rank Pill Button (#8, tappable to open leaderboard) -->
        <button id="hud-rank-btn" class="hud-pill-btn cyan-text" aria-label="Open Leaderboard">
          <span id="hud-rank">#--</span>
        </button>
      </div>

      <!-- HUD Toast Notification Container (single slot just below top strip) -->
      <div id="hud-toast-container" style="pointer-events:none;"></div>

      <!-- First-Run Steering Hint (fades on first steer) -->
      <div id="first-run-hint" class="first-run-hint">
        HOLD LEFT / RIGHT
      </div>

      <!-- Minimap Frame (Bottom-Right corner, 56x56, 60% opacity) -->
      <div class="minimap-frame" id="minimap-container">
        <canvas id="minimap-canvas" width="56" height="56"></canvas>
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
              <p id="leaderboard-status-tag" class="retro-text cyan-text" style="font-size:6px; margin-top:2px;">● LIVE FLASHMOB RANKINGS</p>
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <!-- Mute Button moved inside Leaderboard Header (Part 2) -->
              <button id="hud-mute-btn" class="sound-toggle-btn" style="padding:4px 6px; font-size:8px;">
                ${sounds.isMuted() ? '🔇' : '🔊'}
              </button>
              <button id="close-leaderboard-btn" class="retro-btn btn-secondary" style="width:auto; padding:4px 8px; font-size:8px;">
                CLOSE ✕
              </button>
            </div>
          </div>

          <!-- Scope Selection Tabs -->
          <div class="lb-tabs-container">
            <button id="tab-scope-all" class="lb-tab-btn active" data-scope="ALL">ALL</button>
            <button id="tab-scope-branch" class="lb-tab-btn" data-scope="BRANCH">MY BRANCH</button>
            <button id="tab-scope-year" class="lb-tab-btn" data-scope="YEAR">MY YEAR</button>
          </div>

          <div id="live-board-content" style="overflow-y: auto; max-height: 280px;">
            <p class="retro-text" style="font-size:8px; opacity:0.7; padding:10px 0; text-align:center;">
              FETCHING LIVE TELEMETRY...
            </p>
          </div>

          <div style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px; text-align: center;">
            <button id="hud-change-driver-btn" class="retro-btn btn-secondary" style="font-size:8px; padding:6px 12px; width:auto;">
              CHANGE DRIVER / CLASS
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  const fuelFillEl = container.querySelector('#hud-fuel-fill') as HTMLDivElement | null;
  const fuelSecEl = container.querySelector('#hud-fuel-sec') as HTMLSpanElement | null;
  const lapsEl = container.querySelector('#hud-laps') as HTMLSpanElement | null;
  const correctEl = container.querySelector('#hud-correct') as HTMLSpanElement | null;
  const rankEl = container.querySelector('#hud-rank') as HTMLSpanElement | null;
  const rankBtn = container.querySelector('#hud-rank-btn') as HTMLButtonElement | null;

  const muteBtn = container.querySelector('#hud-mute-btn') as HTMLButtonElement | null;
  const steerLeftBtn = container.querySelector('#steer-left-btn') as HTMLElement | null;
  const steerRightBtn = container.querySelector('#steer-right-btn') as HTMLElement | null;
  const debugLastLapEl = container.querySelector('#debug-last-lap') as HTMLDivElement | null;
  let firstRunHintEl = container.querySelector('#first-run-hint') as HTMLDivElement | null;
  const minimapContainer = container.querySelector('#minimap-container') as HTMLDivElement | null;

  const lbModalEl = container.querySelector('#leaderboard-modal') as HTMLDivElement | null;
  const closeLbBtn = container.querySelector('#close-leaderboard-btn') as HTMLButtonElement | null;
  const liveBoardContent = container.querySelector('#live-board-content') as HTMLDivElement | null;
  const lbStatusTag = container.querySelector('#leaderboard-status-tag') as HTMLElement | null;
  const toastContainer = container.querySelector('#hud-toast-container') as HTMLDivElement | null;

  // Part 2: Toast Queue (single slot below top strip, 1.2s duration)
  const toastQueue: string[] = [];
  let isToastActive = false;

  const processToastQueue = () => {
    if (isToastActive || toastQueue.length === 0 || !toastContainer) return;
    isToastActive = true;
    const msg = toastQueue.shift()!;
    toastContainer.innerHTML = `<div class="hud-toast-banner">${msg}</div>`;
    window.setTimeout(() => {
      if (toastContainer) toastContainer.innerHTML = '';
      isToastActive = false;
      processToastQueue();
    }, 1200);
  };

  const showHudToast = (msg: string) => {
    toastQueue.push(msg);
    processToastQueue();
  };
  (window as any).__showHudToast = showHudToast;

  // Setup Minimap Base Canvas (56x56 px)
  const miniCanvas = container.querySelector('#minimap-canvas') as HTMLCanvasElement | null;
  const miniCtx = miniCanvas?.getContext('2d');
  let baseMinimapImg: HTMLCanvasElement | null = null;
  if (raceScene) {
    baseMinimapImg = raceScene.track.renderMinimap();
  }
  (window as any).__updateHudMinimap = (newTrack: any) => {
    if (newTrack?.renderMinimap) {
      baseMinimapImg = newTrack.renderMinimap();
    }
  };


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

  // Wire auto pit stop on empty tank and low-fuel audio
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

  // Hide minimap while question overlay is active
  const unsubStateMachine = stateMachine.subscribe((state) => {
    if (minimapContainer) {
      minimapContainer.style.display = state === 'PIT' ? 'none' : 'block';
    }
  });

  // Leaderboard Modal Open/Close Handlers
  rankBtn?.addEventListener('click', () => {
    sounds.unlock();
    sounds.playClick();
    openLeaderboard();
  });

  closeLbBtn?.addEventListener('click', () => {
    sounds.unlock();
    sounds.playClick();
    closeLeaderboard();
  });

  const changeDriverBtn = container.querySelector('#hud-change-driver-btn') as HTMLButtonElement | null;
  changeDriverBtn?.addEventListener('click', () => {
    sounds.unlock();
    sounds.playClick();
    closeLeaderboard();
    stateMachine.transition('JOIN', {});
  });

  lbModalEl?.addEventListener('click', (e) => {
    if (e.target === lbModalEl) {
      closeLeaderboard();
    }
  });

  // Wire Scope Tabs
  const scopeTabs = container.querySelectorAll('.lb-tab-btn');
  scopeTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      sounds.unlock();
      sounds.playClick();
      const scope = (tab.getAttribute('data-scope') || 'ALL') as Scope;
      currentScope = scope;
      scopeTabs.forEach((t) => t.classList.toggle('active', t === tab));
      fetchLeaderboardData();
    });
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
    stopLeaderboardActivePolling();
  };

  const startLeaderboardActivePolling = () => {
    stopLeaderboardActivePolling();
    leaderboardPollTimer = window.setTimeout(async () => {
      if (isLeaderboardOpen) {
        await fetchLeaderboardData();
        startLeaderboardActivePolling();
      }
    }, 5000);
  };

  const stopLeaderboardActivePolling = () => {
    if (leaderboardPollTimer !== null) {
      window.clearTimeout(leaderboardPollTimer);
      leaderboardPollTimer = null;
    }
  };

  // Poll Global ALL rank in background every 15s to keep the #rank chip fresh
  const fetchGlobalRankOnly = async () => {
    try {
      const snap = await api.getLeaderboard('ALL');
      if (snap.me?.rank !== undefined) {
        currentMyRank = snap.me.rank;
        if (rankEl) {
          rankEl.textContent = `#${snap.me.rank || '--'}`;
        }
      }
    } catch (err) {
      console.warn('[HUD] Background global rank poll deferred:', err);
    }
  };
  fetchGlobalRankOnly();
  backgroundPollTimer = window.setInterval(fetchGlobalRankOnly, 15000);

  // Render Leaderboard Rows with Resilient Offline Stale UI
  const fetchLeaderboardData = async () => {
    if (!liveBoardContent) return;

    try {
      const snapshot = await api.getLeaderboard(currentScope);
      if (lbStatusTag) {
        if (snapshot.isStale) {
          lbStatusTag.innerHTML = `⚠️ <span style="color:var(--wrong-red);">OFFLINE (CACHED DATA)</span>`;
        } else {
          lbStatusTag.innerHTML = `● LIVE FLASHMOB RANKINGS`;
          lbStatusTag.className = 'retro-text cyan-text';
        }
      }

      if (snapshot.me?.rank !== undefined) {
        currentMyRank = snapshot.me.rank;
        if (rankEl) {
          rankEl.textContent = `#${snapshot.me.rank || '--'}`;
        }
      }

      if (snapshot.top.length === 0) {
        liveBoardContent.innerHTML = `
          <p class="retro-text" style="font-size:8px; opacity:0.7; padding:12px 0; text-align:center;">
            NO DRIVERS IN THIS CLASS YET. SET A RECORD!
          </p>
        `;
        return;
      }

      const rowsHtml = snapshot.top
        .map((entry) => {
          const isMe = entry.isMe;
          const rankColor =
            entry.rank === 1
              ? 'var(--accent-yellow)'
              : entry.rank === 2
                ? '#e0e0e0'
                : entry.rank === 3
                  ? '#cd7f32'
                  : 'var(--cyan)';

          return `
            <div class="lb-row ${isMe ? 'is-me' : ''}" style="display:flex; justify-content:space-between; align-items:center; padding: 4px 6px; margin-bottom: 2px; font-size: 8px; font-family: var(--font-retro); background: ${isMe ? 'rgba(0, 229, 255, 0.2)' : 'rgba(0,0,0,0.5)'}; border: 1px solid ${isMe ? 'var(--cyan)' : 'rgba(255,255,255,0.1)'};">
              <div style="display:flex; gap: 6px; align-items:center;">
                <span style="color:${rankColor}; min-width: 18px; font-weight:bold;">#${entry.rank}</span>
                <span style="color:${isMe ? 'var(--accent-yellow)' : '#fff'}; font-weight:bold;">${entry.name}</span>
                <span class="branch-tag branch-${entry.branch?.toLowerCase() || 'comps'}" style="font-size: 6px; padding: 1px 3px;">${entry.branch || 'COMPS'}</span>
                <span class="year-badge" style="font-size: 6px; padding: 1px 3px;">Y${entry.year || 1}</span>
              </div>
              <div style="display:flex; gap: 8px;">
                <span class="yellow-text">L${entry.laps}</span>
                <span class="green-text">✓${entry.correct}</span>
              </div>
            </div>
          `;
        })
        .join('');

      let myRankFooter = '';
      if (snapshot.me && snapshot.me.rank > 10) {
        const stored = Storage.getPlayer();
        myRankFooter = `
          <div style="margin-top: 6px; padding: 4px 6px; background: rgba(0, 229, 255, 0.25); border: 1px solid var(--cyan); display:flex; justify-content:space-between; font-size: 8px; font-family: var(--font-retro);">
            <div style="display:flex; gap: 6px;">
              <span class="cyan-text font-bold">#${snapshot.me.rank}</span>
              <span class="yellow-text font-bold">${stored?.name || 'YOU'} (YOU)</span>
              <span class="branch-tag branch-${stored?.branch?.toLowerCase() || 'comps'}" style="font-size: 6px; padding: 1px 3px;">${stored?.branch || 'COMPS'}</span>
            </div>
            <div style="display:flex; gap: 8px;">
              <span class="yellow-text">L${snapshot.me.laps ?? 0}</span>
              <span class="green-text">✓${snapshot.me.correct ?? 0}</span>
            </div>
          </div>
        `;
      }

      liveBoardContent.innerHTML = rowsHtml + myRankFooter;
    } catch {
      if (lbStatusTag) {
        lbStatusTag.innerHTML = `⚠️ <span style="color:var(--wrong-red);">NETWORK OFFLINE</span>`;
      }
    }
  };

  // Main UI Frame Animation Loop
  const updateLoop = () => {
    if (raceScene) {
      const currentLap = raceScene.lapManager.getLapCount();
      const currentCorrect = (window as any).__lastCorrectTotal || 0;

      // 1. Update Laps, Correct and Rank
      if (lapsEl) lapsEl.textContent = `L${currentLap}`;
      if (correctEl) correctEl.textContent = `✓${currentCorrect}`;
      if (rankEl && currentMyRank) rankEl.textContent = `#${currentMyRank}`;


      // Toast when speed increases on new lap
      if (currentLap !== prevLap) {
        if (currentLap > prevLap && prevLap > 0) {
          const curSpeedMult = speedMult(
            currentLap + 1,
            config.speedStep ?? 0.04,
            config.speedCap ?? 1.5,
            config.featureFlags?.feature_speed_ramp ?? true
          );
          if (curSpeedMult > 1.0) {
            showHudToast(`⚡ SPEED UP! ${curSpeedMult.toFixed(2)}x`);
          }
        }
        prevLap = currentLap;
      }

      // 2. Update Fuel Gauge (~55% width bar with seconds inside)
      const fuelRatio = raceScene.fuelSystem.getRatio();
      const fuelMs = raceScene.fuelSystem.getFuelMs();

      if (fuelFillEl) {
        fuelFillEl.style.width = `${Math.min(100, Math.max(0, fuelRatio * 100))}%`;
        const isCritical = raceScene.fuelSystem.isLowFuel();
        fuelFillEl.className = 'fuel-bar-fill' + (isCritical ? ' fuel-low-pulse' : '');
      }

      if (fuelSecEl) {
        fuelSecEl.textContent = `${Math.ceil(fuelMs / 1000)}s`;
      }

      // 3. Fade first-run hint on first steer input
      if (firstRunHintEl && raceScene.inputManager.getSteerInput() !== 0) {
        firstRunHintEl.classList.add('faded');
        window.setTimeout(() => firstRunHintEl?.remove(), 500);
        firstRunHintEl = null;
      }

      // 4. Update Minimap (56x56 in bottom-right corner)
      if (miniCtx && miniCanvas && baseMinimapImg) {
        miniCtx.clearRect(0, 0, 56, 56);
        miniCtx.drawImage(baseMinimapImg, 0, 0, 56, 56);

        blinkCounter++;
        if (blinkCounter % 20 < 14) {
          const mCoords = raceScene.track.worldToMinimap(raceScene.car.x, raceScene.car.y);
          // Scale from 80x80 to 56x56
          const scale56 = 56 / 80;
          const mx = mCoords.mx * scale56;
          const my = mCoords.my * scale56;

          miniCtx.fillStyle = '#ff2e4d';
          miniCtx.beginPath();
          miniCtx.arc(mx, my, 2.5, 0, Math.PI * 2);
          miniCtx.fill();

          miniCtx.fillStyle = '#ffffff';
          miniCtx.beginPath();
          miniCtx.arc(mx, my, 1, 0, Math.PI * 2);
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
    unsubStateMachine();
    delete (window as any).__showHudToast;
  };
}
