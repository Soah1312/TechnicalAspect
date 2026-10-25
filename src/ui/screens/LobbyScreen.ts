import { escapeHtml } from '../../util/html';
import type { GameConfig, PlayerState } from '../../api/types';
import { stateMachine } from '../../game/stateMachine';
import { serverNow } from '../../util/clock';
import { sounds } from '../../audio/soundManager';
import { PALETTE } from '../../config/constants';
import { ICONS } from '../icons';

function getCarColor(playerId: string): string {
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) {
    hash = (hash << 5) - hash + playerId.charCodeAt(i);
    hash |= 0;
  }
  return PALETTE.carColors[Math.abs(hash) % PALETTE.carColors.length];
}

export function renderLobbyScreen(
  container: HTMLElement,
  config: GameConfig,
  player: PlayerState | null
): () => void {
  // Race is continuously open: skip straight to countdown!
  if (config.isOpen) {
    stateMachine.transition('COUNTDOWN', { config, player });
    return () => {};
  }

  const carColor = getCarColor(player?.playerId || 'player');

  container.innerHTML = `
    <div class="screen-layer">
      <div class="scanlines"></div>
      <div class="screen-content">
        <h1 class="retro-title">STARTING GRID</h1>

        <div class="retro-panel" style="max-width: 300px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
            <span class="retro-text highlight">RACER:</span>
            <span class="retro-text" style="color: ${carColor};">${escapeHtml(player?.name || 'GUEST DRIVER')}</span>
          </div>
          ${
            player?.year || player?.branch
              ? `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
            <span class="retro-text highlight">CLASS:</span>
            <span class="retro-text cyan-text">${player.year || ''} ${player.branch || ''}</span>
          </div>`
              : ''
          }
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="retro-text">CAR COLOR:</span>
            <div style="width: 24px; height: 16px; background-color: ${carColor}; border: 2px solid #fff;"></div>
          </div>
        </div>

        <div class="retro-panel" style="max-width: 300px;">
          <p class="retro-text cyan-text" style="margin-bottom: 8px;">RACE OPENS IN</p>
          <div id="lobby-timer" class="big-countdown" style="font-size: 38px;">--:--</div>
          <p class="retro-text" style="font-size: 8px; margin-top: 8px; opacity: 0.7;">
            SYNCHRONIZED WITH VENUE CLOCK
          </p>
        </div>

        <div style="display:flex; justify-content:center; gap: 10px; width: 100%;">
          <button id="lobby-mute-btn" class="sound-toggle-btn" style="display:inline-flex; align-items:center; gap:6px;">
            ${sounds.isMuted() ? ICONS.volumeMute(14) : ICONS.volumeOn(14)} <span>${sounds.isMuted() ? 'MUTED' : 'SOUND ON'}</span>
          </button>
        </div>

        <p class="retro-text" style="animation: blink 1s infinite alternate; font-size: 9px;">
          HOLD TIGHT FOR GREEN FLAG...
        </p>
      </div>
    </div>
  `;

  const timerEl = container.querySelector('#lobby-timer') as HTMLDivElement | null;
  const muteBtn = container.querySelector('#lobby-mute-btn') as HTMLButtonElement | null;

  muteBtn?.addEventListener('click', () => {
    sounds.unlock();
    const muted = sounds.toggleMute();
    if (muteBtn) {
      muteBtn.innerHTML = `${muted ? ICONS.volumeMute(14) : ICONS.volumeOn(14)} <span>${muted ? 'MUTED' : 'SOUND ON'}</span>`;
    }
  });

  const interval = window.setInterval(() => {
    const now = serverNow();
    const remainingMs = config.startAt - now;

    if (remainingMs <= 0) {
      window.clearInterval(interval);
      stateMachine.transition('COUNTDOWN', { config, player });
      return;
    }

    if (timerEl) {
      const totalSec = Math.ceil(remainingMs / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      timerEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
  }, 200);

  return () => {
    window.clearInterval(interval);
  };
}
