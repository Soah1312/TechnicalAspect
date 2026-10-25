import { escapeHtml } from '../../util/html';
export function renderLoadingScreen(container: HTMLElement, message = 'CONNECTING TO SERVER...'): void {
  container.innerHTML = `
    <div class="screen-layer">
      <div class="scanlines"></div>
      <div class="screen-content">
        <h1 class="retro-title">CRESCENDO<br/><span class="cyan-text">FUEL RUSH</span></h1>
        <div class="retro-panel" style="max-width: 280px;">
          <p class="retro-text highlight" style="margin-bottom: 12px;">PLEASE WAIT</p>
          <p class="retro-text" id="loading-status">${escapeHtml(message)}</p>
        </div>
      </div>
    </div>
  `;
}
