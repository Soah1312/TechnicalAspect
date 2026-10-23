import { stateMachine } from '../../game/stateMachine';

export function renderClosedScreen(container: HTMLElement): () => void {
  container.innerHTML = `
    <div class="screen-layer">
      <div class="scanlines"></div>
      <div class="screen-content">
        <h1 class="retro-title red-text">RACE IS CLOSED</h1>

        <div class="retro-panel" style="max-width: 300px;">
          <p class="retro-text highlight" style="margin-bottom: 10px;">STAND BY</p>
          <p class="retro-text" style="font-size: 9px; line-height: 1.6;">
            The Crescendo flashmob race is not open right now.
          </p>
          <p class="retro-text cyan-text" style="font-size: 8px; margin-top: 12px;">
            WINDOW: 1:15 PM - 1:45 PM IST<br/>26 OCTOBER 2026
          </p>
        </div>

        <button id="recheck-closed-btn" class="retro-btn btn-cyan" style="max-width: 260px;">
          CHECK AGAIN
        </button>
      </div>
    </div>
  `;

  const btn = container.querySelector('#recheck-closed-btn') as HTMLButtonElement | null;
  btn?.addEventListener('click', () => {
    stateMachine.transition('LOADING');
  });

  return () => {};
}
