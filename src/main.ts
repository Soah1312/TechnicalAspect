import './style.css';
import { createGame } from './game/game';
import { ScreenManager } from './ui/screenManager';
import { activeApi } from './api';
import { stateMachine } from './game/stateMachine';
import { clock, serverNow } from './util/clock';
import { Storage } from './util/storage';
import { sounds } from './audio/soundManager';
import { PitManager } from './game/pit';
import type { RaceScene } from './game/scenes/RaceScene';

async function bootstrap() {
  const uiContainer = document.getElementById('ui-container');
  if (!uiContainer) {
    console.error('Fatal: #ui-container element not found');
    return;
  }

  // 1. Initialize Phaser 3 Game
  const game = createGame();

  // 2. Initialize UI Screen Manager
  new ScreenManager(uiContainer, activeApi, game);

  const pitManager = new PitManager(activeApi);

  // 3. Audio unlock on first user tap/click anywhere
  const unlockAudio = () => {
    sounds.unlock();
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio, { passive: true });
  window.addEventListener('keydown', unlockAudio, { passive: true });

  // 4. Handle Tab Visibility / Phone Lock Edge Cases
  document.addEventListener('visibilitychange', () => {
    const isHidden = document.hidden;
    const raceScene = game.scene.getScene('RaceScene') as RaceScene | undefined;

    if (isHidden) {
      if (raceScene) {
        raceScene.isRaceActive = false;
      }
      sounds.stopEngine();
    } else {
      if (stateMachine.getState() === 'RACING') {
        if (raceScene) {
          raceScene.isRaceActive = true;
        }
        sounds.startEngine();
      }
    }
  });

  // 5. Initial Loading State
  stateMachine.forceState('LOADING', { message: 'INITIALIZING TELEMETRY...' });

  try {
    // 6. Server Clock Synchronization
    await clock.syncWithServer(activeApi);
    clock.startPeriodicSync(activeApi, 60000);

    // 7. Fetch Server Config
    const config = await activeApi.getConfig();

    // 8. Check Kill Switch
    if (!config.isOpen) {
      stateMachine.forceState('CLOSED');
      return;
    }

    // 9. Check Existing Player Session for Sensible Resume
    const storedPlayer = Storage.getPlayer();

    if (!storedPlayer) {
      stateMachine.forceState('JOIN');
      return;
    }

    // Player found: update car visual in scene if loaded
    const raceScene = game.scene.getScene('RaceScene') as RaceScene | undefined;
    if (raceScene?.updateCarTexture) {
      raceScene.updateCarTexture(storedPlayer.playerId);
    }

    const now = serverNow();

    // Check race timing
    if (now >= config.endAt) {
      stateMachine.forceState('ENDED', { api: activeApi, config });
    } else if (now < config.startAt) {
      stateMachine.forceState('LOBBY', { config, player: storedPlayer });
    } else {
      // Check Anti-Refresh Abuse: did player refresh mid-question?
      if (pitManager.isMarkedInPit()) {
        console.log('[Anti-Abuse] Refreshed during question. Resuming with empty tank in PIT.');
        raceScene?.fuelSystem.drainAll();
        stateMachine.forceState('PIT', {
          api: activeApi,
          config,
          raceScene,
          reason: 'dry',
        });
      } else {
        // Normal resume into active race
        stateMachine.forceState('RACING', {
          api: activeApi,
          config,
          raceScene,
        });
      }
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'FAILED TO INITIALIZE TELEMETRY';
    console.error('Bootstrap error:', err);
    stateMachine.forceState('ERROR', { message: errorMsg });
  }
}

// Start application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
