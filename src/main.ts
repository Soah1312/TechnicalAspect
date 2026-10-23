import './style.css';
import { createGame } from './game/game';
import { ScreenManager } from './ui/screenManager';
import { mockApi } from './api/mockApi';
import { stateMachine } from './game/stateMachine';
import { clock, serverNow } from './util/clock';
import { Storage } from './util/storage';
import { sounds } from './audio/soundManager';

async function bootstrap() {
  const uiContainer = document.getElementById('ui-container');
  if (!uiContainer) {
    console.error('Fatal: #ui-container element not found');
    return;
  }

  // 1. Initialize Phaser 3 Game
  const game = createGame();

  // 2. Initialize UI Screen Manager
  new ScreenManager(uiContainer, mockApi, game);

  // 3. Audio unlock on first user tap/click anywhere
  const unlockAudio = () => {
    sounds.unlock();
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio, { passive: true });
  window.addEventListener('keydown', unlockAudio, { passive: true });

  // 4. Initial Loading State
  stateMachine.forceState('LOADING', { message: 'INITIALIZING TELEMETRY...' });

  try {
    // 5. Server Clock Synchronization
    await clock.syncWithServer(mockApi);
    clock.startPeriodicSync(mockApi, 60000);

    // 6. Fetch Server Config
    const config = await mockApi.getConfig();

    // 7. Check Kill Switch
    if (!config.isOpen) {
      stateMachine.forceState('CLOSED');
      return;
    }

    // 8. Check Existing Player Session for Sensible Resume
    const storedPlayer = Storage.getPlayer();

    if (!storedPlayer) {
      stateMachine.forceState('JOIN');
      return;
    }

    // Player found: update car visual in scene if loaded
    const raceScene = game.scene.getScene('RaceScene') as unknown as { updateCarTexture?: (id: string) => void };
    if (raceScene?.updateCarTexture) {
      raceScene.updateCarTexture(storedPlayer.playerId);
    }

    const now = serverNow();

    // Check race timing
    if (now >= config.endAt) {
      stateMachine.forceState('ENDED', { api: mockApi, config });
    } else if (now < config.startAt) {
      stateMachine.forceState('LOBBY', { config, player: storedPlayer });
    } else {
      // Race currently in progress!
      stateMachine.forceState('RACING', {
        api: mockApi,
        config,
        initialFuelMs: config.initialFuelMs,
        initialLaps: 0,
      });
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
