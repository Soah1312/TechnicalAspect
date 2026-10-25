import { escapeHtml } from '../../util/html';
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
  let isLeaderboardOpen = false;
  let leaderboardPollTimer: number | null = null;
  let backgroundPollTimer: number | null = null;
  let currentScope: Scope = 'ALL';
  let disposed = false;
  let requestVersion = 0;
  let globalPending = false;
  let prevLap = 0;
  let currentMyRank: number | null = null;

  // Track calibration metrics
  const trackLength = raceScene?.track.totalLength || 11200;
  const theoreticalBestLapMs = Math.round((trackLength / Car.MAX_SPEED) * 1000);
  const recommendedMinLapMs = Math.round(theoreticalBestLapMs * 0.8);

  container.innerHTML = `
    <div class="screen-layer transparent-bg racing-hud" style="pointer-events:none;">
      <header class="race-telemetry">
        <div class="hud-topbar">
          <div class="hud-zone hud-fuel-zone">
            <div class="hud-meter-label"><span>FUEL</span><span id="hud-fuel-sec">10s</span></div>
            <div class="hud-fuel-gauge" role="meter" aria-label="Fuel remaining" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">
              <div id="hud-fuel-fill" class="fuel-bar-fill"></div>
            </div>
          </div>
          <div class="hud-zone hud-lap-zone"><span class="hud-label">LAP</span><span id="hud-laps" class="hud-value">00</span></div>
          <div class="hud-zone hud-score-zone"><span class="hud-label">SCORE</span><span id="hud-correct" class="hud-score-badge">000</span></div>
        </div>
        <div class="hud-secondary-bar">
          <button id="hud-rank-btn" class="hud-rank-button" aria-label="Open Leaderboard" aria-haspopup="dialog" aria-expanded="false">
            <span class="hud-label">LIVE RANK</span><span id="hud-rank">#--</span><span aria-hidden="true">↗</span>
          </button>
          <div class="minimap-frame" id="minimap-container" aria-label="Track map">
            <canvas id="minimap-canvas" width="80" height="80" aria-label="Your position on the track" role="img"></canvas>
          </div>
        </div>
      </header>
      <div id="hud-toast-container" style="pointer-events:none;"></div>
      <div id="first-run-hint" class="first-run-hint">HOLD TO STEER</div>

      <!-- Calibration Helper Bar (if ?debug=1) -->
      ${
        DEBUG_CONFIG.isDebug
          ? `
        <div style="position: absolute; top: 90px; left: 10px; background: rgba(0,0,0,0.85); border: 1px solid #00ff00; padding: 4px 6px; font-size:14px; color: #00ff00; font-family: monospace; pointer-events: none; z-index: 26;">
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
          <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M18 6 8 16l10 10v-7h8v-6h-8z" fill="currentColor"/></svg>
        </button>
        <button id="steer-right-btn" class="steer-thumb-btn" aria-label="Steer Right">
          <svg viewBox="0 0 32 32" aria-hidden="true"><path d="m14 6 10 10-10 10v-7H6v-6h8z" fill="currentColor"/></svg>
        </button>
      </div>

      <!-- Leaderboard Slide-up Panel Modal (Hidden by default) -->
      <div id="leaderboard-modal" role="dialog" aria-modal="true" aria-label="Live leaderboard" class="leaderboard-modal-overlay" style="display: none;">
        <div class="leaderboard-panel-sheet">
          <div class="leaderboard-header">
            <div>
              <span class="retro-text highlight" style="font-size:14px;">LEADERBOARD</span>
              <p id="leaderboard-status-tag" role="status" class="retro-text cyan-text" style="font-size:14px; margin-top:2px;">● LIVE FLASHMOB RANKINGS</p>
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <!-- Mute Button moved inside Leaderboard Header (Part 2) -->
              <button id="hud-mute-btn" aria-label="Toggle sound" class="sound-toggle-btn" style="padding:4px 6px; font-size:14px;">
                ${sounds.isMuted() ? '🔇' : '🔊'}
              </button>
              <button id="close-leaderboard-btn" class="retro-btn btn-secondary" style="width:auto; padding:4px 8px; font-size:14px;">
                CLOSE ✕
              </button>
            </div>
          </div>

          <!-- Scope Selection Tabs -->
          <div class="lb-tabs-container">
            <button id="tab-scope-all" class="lb-tab-btn active" aria-pressed="true" data-scope="ALL">ALL</button>
            <button id="tab-scope-branch" class="lb-tab-btn" aria-pressed="false" data-scope="BRANCH">MY BRANCH</button>
            <button id="tab-scope-year" class="lb-tab-btn" aria-pressed="false" data-scope="YEAR">MY YEAR</button>
          </div>

          <div id="live-board-content" style="overflow-y: auto; max-height: 280px;">
            <p class="retro-text" style="font-size:14px; opacity:0.7; padding:10px 0; text-align:center;">
              FETCHING LIVE TELEMETRY...
            </p>
          </div>

          <div style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px; text-align: center;">
            <button id="hud-change-driver-btn" class="retro-btn btn-secondary" style="font-size:14px; padding:6px 12px; width:auto;">
              CHANGE DRIVER / CLASS
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  raceScene?.layoutRaceViewport();

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
      scopeTabs.forEach((t) => {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-pressed', String(t === tab));
      });
      stopLeaderboardActivePolling();
      void fetchLeaderboardData().then(startLeaderboardActivePolling);
    });
  });

  const openLeaderboard = () => {
    isLeaderboardOpen = true;
    if (lbModalEl) lbModalEl.style.display = 'flex';
    rankBtn?.setAttribute('aria-expanded', 'true');
    closeLbBtn?.focus();
    void fetchLeaderboardData().then(startLeaderboardActivePolling);
  };

  const closeLeaderboard = () => {
    isLeaderboardOpen = false;
    requestVersion++;
    rankBtn?.setAttribute('aria-expanded', 'false');
    rankBtn?.focus();
    if (lbModalEl) lbModalEl.style.display = 'none';
    stopLeaderboardActivePolling();
  };

  const startLeaderboardActivePolling = () => {
    if (disposed || !isLeaderboardOpen) return;
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
    if (disposed || globalPending) return;
    globalPending = true;
    try {
      const snap = await api.getLeaderboard('ALL');
      if (disposed) return;
      if (snap.me?.rank !== undefined) {
        currentMyRank = snap.me.rank;
        if (rankEl) {
          rankEl.textContent = `#${snap.me.rank || '--'}`;
        }
      }
    } catch (err) {
      console.warn('[HUD] Background global rank poll deferred:', err);
    } finally {
      globalPending = false;
    }
  };
  fetchGlobalRankOnly();
  backgroundPollTimer = window.setInterval(fetchGlobalRankOnly, 15000);

  // Render Leaderboard Rows with Resilient Offline Stale UI
  const fetchLeaderboardData = async () => {
    if (!liveBoardContent || disposed || !isLeaderboardOpen) return;
    const scope = currentScope;
    const version = ++requestVersion;
    if (lbStatusTag) lbStatusTag.textContent = 'UPDATING RANKINGS...';
    liveBoardContent.setAttribute('aria-busy', 'true');
    // Clear rows on scope changes so a previous class is never labelled as the new one.
    if (liveBoardContent.dataset.scope !== scope) {
      liveBoardContent.textContent = 'FETCHING LIVE TELEMETRY...';
      liveBoardContent.dataset.scope = scope;
    }
    try {
      const snapshot = await api.getLeaderboard(scope);
      if (disposed || version !== requestVersion || !isLeaderboardOpen) return;
      if (lbStatusTag) {
        if (snapshot.isStale) {
          lbStatusTag.innerHTML = `⚠️ <span style="color:var(--wrong-red);">OFFLINE (CACHED DATA)</span>`;
        } else {
          lbStatusTag.innerHTML = `● LIVE FLASHMOB RANKINGS`;
          lbStatusTag.className = 'retro-text cyan-text';
        }
      }

      if (scope === 'ALL' && snapshot.me?.rank !== undefined) {
        currentMyRank = snapshot.me.rank;
        if (rankEl) {
          rankEl.textContent = `#${snapshot.me.rank || '--'}`;
        }
      }

      if (snapshot.top.length === 0) {
        liveBoardContent.innerHTML = `
          <p class="retro-text" style="font-size:14px; opacity:0.7; padding:12px 0; text-align:center;">
            ${snapshot.isStale ? 'RANKINGS UNAVAILABLE. RETRYING AUTOMATICALLY...' : 'NO DRIVERS IN THIS CLASS YET. SET A RECORD!'}
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
            <div class="lb-row ${isMe ? 'is-me' : ''}" style="display:flex; justify-content:space-between; align-items:center; padding: 4px 6px; margin-bottom: 2px; font-size:14px; font-family: var(--font-retro); background: ${isMe ? 'rgba(0, 229, 255, 0.12)' : 'rgba(0,0,0,0.5)'}; border: 1px solid ${isMe ? 'var(--cyan)' : 'rgba(255,255,255,0.1)'};">
              <div style="display:flex; gap: 6px; align-items:center;">
                <span style="color:${rankColor}; min-width: 18px; font-weight:bold;">#${entry.rank}</span>
                <span style="color:${isMe ? 'var(--accent-yellow)' : '#fff'}; font-weight:bold;">${escapeHtml(entry.name)}</span>
                <span class="branch-tag branch-${escapeHtml(entry.branch?.toLowerCase() || 'comps')}" style="font-size:14px; padding: 1px 3px;">${escapeHtml(entry.branch || 'COMPS')}</span>
                <span class="year-badge" style="font-size:14px; padding: 1px 3px;">Y${entry.year || 1}</span>
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
      if (snapshot.me && !snapshot.top.some((row) => row.isMe)) {
        const stored = Storage.getPlayer();
        myRankFooter = `
          <div style="margin-top: 6px; padding: 4px 6px; background: rgba(0, 229, 255, 0.16); border: 1px solid var(--cyan); display:flex; justify-content:space-between; font-size:14px; font-family: var(--font-retro);">
            <div style="display:flex; gap: 6px;">
              <span class="cyan-text font-bold">#${snapshot.me.rank}</span>
              <span class="yellow-text font-bold">${escapeHtml(stored?.name || 'YOU')} (YOU)</span>
              <span class="branch-tag branch-${escapeHtml(stored?.branch?.toLowerCase() || 'comps')}" style="font-size:14px; padding: 1px 3px;">${escapeHtml(stored?.branch || 'COMPS')}</span>
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
      if (disposed || version !== requestVersion || !isLeaderboardOpen) return;
      if (lbStatusTag) {
        lbStatusTag.innerHTML = `⚠️ <span style="color:var(--wrong-red);">NETWORK OFFLINE</span>`;
      }
    } finally {
      if (!disposed && version === requestVersion) liveBoardContent.removeAttribute('aria-busy');
    }
  };

  const onLeaderboardKeydown = (event: KeyboardEvent) => {
    if (!isLeaderboardOpen) return;
    if (event.key === 'Escape') { event.preventDefault(); closeLeaderboard(); }
    if (event.key === 'Tab') {
      const buttons = lbModalEl?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      const first = buttons?.[0];
      const last = buttons?.[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  lbModalEl?.addEventListener('keydown', onLeaderboardKeydown);

  // Main UI Frame Animation Loop
  const updateLoop = () => {
    if (raceScene) {
      const currentLap = raceScene.lapManager.getLapCount();
      const currentCorrect = (window as any).__lastCorrectTotal || 0;

      // 1. Update Laps, Correct and Rank
      if (lapsEl) lapsEl.textContent = String(currentLap).padStart(2, '0');
      if (correctEl) correctEl.textContent = String(currentCorrect).padStart(3, '0');
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
        fuelFillEl.parentElement?.setAttribute('aria-valuenow', String(Math.round(fuelRatio * 100)));
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
        const hint = firstRunHintEl;
        window.setTimeout(() => hint.remove(), 500);
        firstRunHintEl = null;
      }

      // The map uses its native 80px resolution and a steady player marker.
      if (miniCtx && miniCanvas && baseMinimapImg) {
        miniCtx.clearRect(0, 0, 80, 80);
        miniCtx.drawImage(baseMinimapImg, 0, 0, 80, 80);
        const { mx, my } = raceScene.track.worldToMinimap(raceScene.car.x, raceScene.car.y);
        miniCtx.fillStyle = '#ff2e4d';
        miniCtx.fillRect(Math.round(mx) - 3, Math.round(my) - 3, 6, 6);
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
    disposed = true;
    isLeaderboardOpen = false;
    requestVersion++;
    lbModalEl?.removeEventListener('keydown', onLeaderboardKeydown);
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
