import type { GameApi, GameConfig, PlayerState } from '../api/types';
import { stateMachine, type GameState } from '../game/stateMachine';
import { renderLoadingScreen } from './screens/LoadingScreen';
import { renderJoinScreen } from './screens/JoinScreen';
import { renderHowToPlayScreen } from './screens/HowToPlayScreen';
import { renderLobbyScreen } from './screens/LobbyScreen';
import { renderCountdownScreen } from './screens/CountdownScreen';
import { renderRacingHud } from './screens/RacingHud';
import { renderPitScreen } from './screens/PitScreen';
import { renderResultsScreen } from './screens/ResultsScreen';
import { renderClosedScreen } from './screens/ClosedScreen';
import { renderErrorScreen } from './screens/ErrorScreen';
import { DEBUG_CONFIG } from '../config/constants';
import { clock } from '../util/clock';

export class ScreenManager {
  private container: HTMLElement;
  private api: GameApi;
  private activeCleanup: (() => void) | null = null;
  private debugOverlayEl: HTMLElement | null = null;
  private frameCount = 0;
  private lastFpsTime = performance.now();
  private currentFps = 60;

  constructor(container: HTMLElement, api: GameApi) {
    this.container = container;
    this.api = api;

    // Listen to state changes
    stateMachine.subscribe((newState, _prevState, context) => {
      this.renderState(newState, context);
    });

    if (DEBUG_CONFIG.isDebug) {
      this.setupDebugOverlay();
    }
  }

  private setupDebugOverlay(): void {
    this.debugOverlayEl = document.createElement('div');
    this.debugOverlayEl.className = 'debug-overlay';
    document.body.appendChild(this.debugOverlayEl);

    const updateFps = (now: number) => {
      this.frameCount++;
      if (now - this.lastFpsTime >= 500) {
        this.currentFps = Math.round((this.frameCount * 1000) / (now - this.lastFpsTime));
        this.frameCount = 0;
        this.lastFpsTime = now;
        if (this.debugOverlayEl) {
          this.debugOverlayEl.textContent = `FPS:${this.currentFps} | ST:${stateMachine.getState()} | OFF:${clock.getOffset()}ms`;
        }
      }
      requestAnimationFrame(updateFps);
    };
    requestAnimationFrame(updateFps);
  }

  public renderState(state: GameState, context: Record<string, unknown> = {}): void {
    if (this.activeCleanup) {
      this.activeCleanup();
      this.activeCleanup = null;
    }

    this.container.innerHTML = '';

    switch (state) {
      case 'LOADING': {
        const msg = (context.message as string) || 'CONNECTING TO SERVER...';
        renderLoadingScreen(this.container, msg);
        break;
      }

      case 'JOIN': {
        const defaultName = (context.defaultName as string) || '';
        this.activeCleanup = renderJoinScreen(this.container, this.api, defaultName);
        break;
      }

      case 'HOW_TO_PLAY': {
        this.activeCleanup = renderHowToPlayScreen(this.container);
        break;
      }

      case 'LOBBY': {
        const config = (context.config as GameConfig) || {
          startAt: Date.now() + 10000,
          endAt: Date.now() + 190000,
          isOpen: true,
          tankMaxMs: 30000,
          initialFuelMs: 30000,
          fuelPerCorrectMs: 20000,
          pitBelowFraction: 0.5,
          questionTimeMs: 15000,
          wrongLockoutMs: 3000,
          minLapMs: 36000,
        };
        const player = context.player ? (context.player as PlayerState) : null;
        this.activeCleanup = renderLobbyScreen(this.container, config, player);
        break;
      }

      case 'COUNTDOWN': {
        this.activeCleanup = renderCountdownScreen(this.container);
        break;
      }

      case 'RACING': {
        const config = (context.config as GameConfig) || {
          startAt: Date.now() - 1000,
          endAt: Date.now() + 180000,
          isOpen: true,
          tankMaxMs: 30000,
          initialFuelMs: 30000,
          fuelPerCorrectMs: 20000,
          pitBelowFraction: 0.5,
          questionTimeMs: 15000,
          wrongLockoutMs: 3000,
          minLapMs: 36000,
        };
        const initialFuelMs = context.initialFuelMs as number | undefined;
        const initialLaps = context.initialLaps as number | undefined;
        this.activeCleanup = renderRacingHud(this.container, {
          api: this.api,
          config,
          initialFuelMs,
          initialLaps,
        });
        break;
      }

      case 'PIT': {
        const config = (context.config as GameConfig) || {
          startAt: Date.now() - 1000,
          endAt: Date.now() + 180000,
          isOpen: true,
          tankMaxMs: 30000,
          initialFuelMs: 30000,
          fuelPerCorrectMs: 20000,
          pitBelowFraction: 0.5,
          questionTimeMs: 15000,
          wrongLockoutMs: 3000,
          minLapMs: 36000,
        };
        const remainingFuelMs = (context.remainingFuelMs as number) ?? 0;
        const laps = (context.laps as number) ?? 0;
        const reason = (context.reason as 'dry' | 'voluntary') ?? 'dry';
        this.activeCleanup = renderPitScreen(this.container, {
          api: this.api,
          config,
          remainingFuelMs,
          laps,
          reason,
        });
        break;
      }

      case 'ENDED': {
        const laps = (context.laps as number) ?? 0;
        this.activeCleanup = renderResultsScreen(this.container, {
          api: this.api,
          laps,
        });
        break;
      }

      case 'CLOSED': {
        this.activeCleanup = renderClosedScreen(this.container);
        break;
      }

      case 'ERROR': {
        const message = (context.message as string) || 'UNKNOWN ERROR OCCURRED';
        this.activeCleanup = renderErrorScreen(this.container, message);
        break;
      }
    }
  }
}
