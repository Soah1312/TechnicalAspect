import type { GameApi, Branch, Year } from '../../api/types';
import { stateMachine } from '../../game/stateMachine';
import { Storage } from '../../util/storage';
import { sounds } from '../../audio/soundManager';

const BRANCHES: Branch[] = ['COMPS', 'CSE', 'ECS', 'MECH', 'AIDS'];
const YEARS: Year[] = [1, 2, 3, 4];

export function renderJoinScreen(
  container: HTMLElement,
  api: GameApi,
  defaultName = ''
): () => void {
  const storedPlayer = Storage.getPlayer();
  let selectedBranch: Branch | null = (storedPlayer?.branch as Branch) || null;
  let selectedYear: Year | null = storedPlayer?.year ? (Number(storedPlayer.year) as Year) : null;

  if (selectedBranch === 'AIDS') {
    selectedYear = 4;
  }

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

          <!-- Branch Selection Group -->
          <div style="margin-top: 10px;">
            <label class="retro-text highlight" style="display:block; margin-bottom: 5px; font-size: 8px;">
              SELECT BRANCH
            </label>
            <div id="branch-group" style="display:flex; flex-wrap:wrap; gap:4px;">
              ${BRANCHES.map(
                (b) => `
                <button type="button" class="retro-choice-btn branch-btn ${b === selectedBranch ? 'active' : ''}" data-branch="${b}">
                  ${b}
                </button>
              `
              ).join('')}
            </div>
          </div>

          <!-- Year Selection Group -->
          <div style="margin-top: 10px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
              <label class="retro-text highlight" style="font-size: 8px;">
                SELECT YEAR
              </label>
              <span id="aids-note" style="font-size:7px; color:var(--accent-yellow); display:${selectedBranch === 'AIDS' ? 'inline' : 'none'};">
                AIDS: 4th year only
              </span>
            </div>
            <div id="year-group" style="display:flex; gap:4px;">
              ${YEARS.map(
                (y) => `
                <button type="button" class="retro-choice-btn year-btn ${y === selectedYear ? 'active' : ''}" data-year="${y}">
                  ${y === 1 ? '1st' : y === 2 ? '2nd' : y === 3 ? '3rd' : '4th'}
                </button>
              `
              ).join('')}
            </div>
          </div>

          <div id="join-error" class="error-banner" style="margin-top: 8px;"></div>
        </div>

        <button id="start-engine-btn" class="retro-btn btn-green" disabled>
          START ENGINE
        </button>

        <p class="retro-text" style="font-size: 8px; opacity: 0.8;">
          50-100 RACERS ONLINE • AUTO-ACCELERATE • QUIZ REFUEL
        </p>
      </div>
    </div>
  `;

  const input = container.querySelector('#player-name-input') as HTMLInputElement | null;
  const button = container.querySelector('#start-engine-btn') as HTMLButtonElement | null;
  const errorBox = container.querySelector('#join-error') as HTMLDivElement | null;
  const branchBtns = container.querySelectorAll('.branch-btn');
  const yearBtns = container.querySelectorAll('.year-btn');
  const aidsNote = container.querySelector('#aids-note') as HTMLElement | null;

  const updateYearButtonsState = () => {
    yearBtns.forEach((btn) => {
      const y = Number((btn as HTMLElement).dataset.year) as Year;
      const bEl = btn as HTMLButtonElement;
      if (selectedBranch === 'AIDS' && y !== 4) {
        bEl.disabled = true;
        bEl.classList.remove('active');
      } else {
        bEl.disabled = false;
        if (y === selectedYear) {
          bEl.classList.add('active');
        } else {
          bEl.classList.remove('active');
        }
      }
    });

    if (aidsNote) {
      aidsNote.style.display = selectedBranch === 'AIDS' ? 'inline' : 'none';
    }
  };

  const updateButtonState = () => {
    if (!button || !input) return;
    const nameValid = input.value.trim().length >= 2;
    button.disabled = !(nameValid && selectedBranch && selectedYear);
  };

  branchBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      sounds.playClick();
      branchBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedBranch = (btn as HTMLElement).dataset.branch as Branch;

      if (selectedBranch === 'AIDS') {
        selectedYear = 4;
      }
      updateYearButtonsState();
      updateButtonState();
    });
  });

  yearBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const y = Number((btn as HTMLElement).dataset.year) as Year;
      if (selectedBranch === 'AIDS' && y !== 4) return;
      sounds.playClick();
      selectedYear = y;
      yearBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      updateButtonState();
    });
  });

  input?.addEventListener('input', () => {
    updateButtonState();
  });

  updateYearButtonsState();
  updateButtonState();

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
    if (!selectedBranch || !selectedYear) {
      return 'SELECT YOUR BRANCH & YEAR!';
    }
    return null;
  };

  const handleSubmit = async () => {
    sounds.unlock();

    if (!input || !button || !errorBox || !selectedBranch || !selectedYear) return;
    const name = input.value.trim();
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
      const player = await api.joinRace(name, selectedBranch, selectedYear);
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
      button.disabled = false;
      button.textContent = 'START ENGINE';
      sounds.playWrong();
      const message = err instanceof Error ? err.message : 'FAILED TO JOIN RACE';
      errorBox.textContent = message.toUpperCase();
    }
  };

  button?.addEventListener('click', handleSubmit);
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  });

  input?.focus();

  return () => {
    button?.removeEventListener('click', handleSubmit);
  };
}
