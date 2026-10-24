import type { GameApi } from '../../api/types';
import { stateMachine } from '../../game/stateMachine';
import { Storage } from '../../util/storage';
import { sounds } from '../../audio/soundManager';

const YEARS = ['FE', 'SE', 'TE', 'BE'] as const;
const BRANCHES = ['COMPS', 'CSE', 'ECS', 'MECH'] as const;

export function renderJoinScreen(
  container: HTMLElement,
  api: GameApi,
  defaultName = ''
): () => void {
  const storedPlayer = Storage.getPlayer();
  const initialYear = storedPlayer?.year || 'FE';
  const initialBranch = storedPlayer?.branch || 'COMPS';

  container.innerHTML = `
    <div class="screen-layer">
      <div class="scanlines"></div>
      <div class="screen-content">
        <div>
          <h1 class="retro-title">CRESCENDO<br/><span class="cyan-text">FUEL RUSH</span></h1>
          <h2 class="retro-subtitle">FRCRCE 2026 FLASHMOB</h2>
        </div>

        <div class="retro-panel">
          <label for="player-name-input" class="retro-text highlight" style="display:block; margin-bottom: 6px;">
            ENTER DRIVER NAME
          </label>
          <input
            id="player-name-input"
            class="retro-input"
            type="text"
            maxlength="16"
            placeholder="DRIVER NAME"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
            value="${defaultName || storedPlayer?.name || ''}"
          />

          <div style="display:flex; gap:8px; margin-top: 10px;">
            <div style="flex:1;">
              <label for="player-year-select" class="retro-text highlight" style="display:block; margin-bottom: 4px; font-size: 8px;">
                YEAR
              </label>
              <select id="player-year-select" class="retro-select">
                ${YEARS.map(
                  (y) => `<option value="${y}" ${y === initialYear ? 'selected' : ''}>${y}</option>`
                ).join('')}
              </select>
            </div>

            <div style="flex:1.2;">
              <label for="player-branch-select" class="retro-text highlight" style="display:block; margin-bottom: 4px; font-size: 8px;">
                BRANCH
              </label>
              <select id="player-branch-select" class="retro-select">
                ${BRANCHES.map(
                  (b) => `<option value="${b}" ${b === initialBranch ? 'selected' : ''}>${b}</option>`
                ).join('')}
              </select>
            </div>
          </div>

          <div id="join-error" class="error-banner" style="margin-top: 8px;"></div>
        </div>

        <button id="start-engine-btn" class="retro-btn btn-green">
          START ENGINE
        </button>

        <p class="retro-text" style="font-size: 8px; opacity: 0.8;">
          50-100 RACERS ONLINE • AUTO-ACCELERATE • QUIZ REFUEL
        </p>
      </div>
    </div>
  `;

  const input = container.querySelector('#player-name-input') as HTMLInputElement | null;
  const yearSelect = container.querySelector('#player-year-select') as HTMLSelectElement | null;
  const branchSelect = container.querySelector('#player-branch-select') as HTMLSelectElement | null;
  const button = container.querySelector('#start-engine-btn') as HTMLButtonElement | null;
  const errorBox = container.querySelector('#join-error') as HTMLDivElement | null;

  const validate = (val: string): string | null => {
    const trimmed = val.trim();
    if (!trimmed) {
      return 'PLEASE ENTER A NAME!';
    }
    if (trimmed.length < 2) {
      return 'NAME TOO SHORT (MIN 2 CHARS)';
    }
    if (trimmed.length > 16) {
      return 'NAME TOO LONG (MAX 16 CHARS)';
    }
    if (!/^[a-zA-Z0-9 ]+$/.test(trimmed)) {
      return 'LETTERS, NUMBERS & SPACES ONLY';
    }
    return null;
  };

  const handleSubmit = async () => {
    sounds.unlock();

    if (!input || !button || !errorBox || !yearSelect || !branchSelect) return;
    const name = input.value.trim();
    const year = yearSelect.value;
    const branch = branchSelect.value;
    const error = validate(name);

    if (error) {
      errorBox.textContent = error;
      input.classList.add('input-error');
      sounds.playWrong();
      return;
    }

    errorBox.textContent = '';
    input.classList.remove('input-error');
    button.disabled = true;
    button.textContent = 'CONNECTING...';

    try {
      const player = await api.joinRace(name, year, branch);
      sounds.playCorrect();
      const config = await api.getConfig();

      // Check if tutorial seen this session
      const tutorialSeen = Storage.isTutorialSeen();
      if (!tutorialSeen) {
        stateMachine.transition('HOW_TO_PLAY', { player, config });
      } else {
        // Race is open: launch directly into countdown
        stateMachine.transition('COUNTDOWN', { player, config });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'FAILED TO JOIN RACE';
      errorBox.textContent = msg.toUpperCase();
      input.classList.add('input-error');
      button.disabled = false;
      button.textContent = 'START ENGINE';
      sounds.playWrong();
    }
  };

  button?.addEventListener('click', handleSubmit);
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  });

  return () => {
    button?.removeEventListener('click', handleSubmit);
  };
}
