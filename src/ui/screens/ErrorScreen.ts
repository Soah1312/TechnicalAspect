import { stateMachine } from '../../game/stateMachine';

export function renderErrorScreen(container: HTMLElement, message = 'CONNECTION ERROR'): () => void {
  container.innerHTML = `
    <div class="screen-layer">
      <div class="scanlines"></div>
      <div class="screen-content">
        <h1 class="retro-title red-text">SIGNAL LOST!</h1>

        <div class="retro-panel" style="max-width: 300px; border-color:var(--wrong-red);">
          <p class="retro-text red-text" style="margin-bottom: 8px;">SYSTEM ERROR</p>
          <p class="retro-text" style="font-size: 9px; line-height: 1.6;">${message}</p>
          <p class="retro-text" style="font-size: 8px; margin-top: 10px; opacity: 0.7;">
            Check venue Wi-Fi or data connection and try again.
          </p>
        </div>

        <button id="retry-error-btn" class="retro-btn btn-green" style="max-width: 260px;">
          RETRY CONNECTION
        </button>
      </div>
    </div>
  `;

  const retryBtn = container.querySelector('#retry-error-btn') as HTMLButtonElement | null;
  retryBtn?.addEventListener('click', () => {
    stateMachine.transition('LOADING');
  });

  return () => {};
}
