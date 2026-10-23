import type { GameApi, GameConfig, Question } from '../../api/types';
import { stateMachine } from '../../game/stateMachine';
import { sounds } from '../../audio/soundManager';
import { Vibration } from '../../util/vibration';
import { serverNow } from '../../util/clock';

interface PitScreenProps {
  api: GameApi;
  config: GameConfig;
  remainingFuelMs: number;
  laps: number;
  reason: 'dry' | 'voluntary';
}

export function renderPitScreen(
  container: HTMLElement,
  props: PitScreenProps
): () => void {
  const { api, config } = props;
  const remainingFuel = props.remainingFuelMs;
  const currentLaps = props.laps;

  let currentQuestion: Question | null = null;
  let isSubmitting = false;
  let questionTimer: number | null = null;
  let questionStart = Date.now();
  let raceCheckInterval: number | null = null;

  container.innerHTML = `
    <div class="modal-overlay">
      <div class="scanlines"></div>

      <!-- Question Top Bar -->
      <div class="question-header">
        <div>
          <span class="retro-text highlight">${props.reason === 'dry' ? 'OUT OF FUEL!' : 'PIT STOP REFUEL'}</span>
          <p class="retro-text" style="font-size:7px; margin-top:2px; opacity:0.8;">CAR STOPPED • RACE CLOCK ACTIVE</p>
        </div>
        <div style="text-align:right;">
          <span class="timer-tag" id="q-timer">--s</span>
        </div>
      </div>

      <!-- Question Content -->
      <div class="screen-content" style="justify-content:center; padding:10px 0;">
        <div class="retro-panel" style="width:100%; border-color:var(--cyan);">
          <p class="retro-text" id="q-text" style="font-size:10px; line-height:1.6;">
            FETCHING TECH QUESTION...
          </p>
        </div>

        <div id="q-status-banner" style="min-height:22px; width:100%;"></div>

        <!-- Options Container -->
        <div id="q-options" class="options-list"></div>
      </div>

      <div style="text-align:center; padding: 4px;">
        <p class="retro-text" style="font-size:7px; color:var(--cyan);">
          CORRECT = +${Math.round(config.fuelPerCorrectMs / 1000)}s FUEL • WRONG = ${Math.round(config.wrongLockoutMs / 1000)}s LOCKOUT
        </p>
      </div>
    </div>
  `;

  const qTextEl = container.querySelector('#q-text') as HTMLParagraphElement | null;
  const qOptionsEl = container.querySelector('#q-options') as HTMLDivElement | null;
  const qTimerEl = container.querySelector('#q-timer') as HTMLSpanElement | null;
  const statusBanner = container.querySelector('#q-status-banner') as HTMLDivElement | null;

  // Monitor race end time while answering
  raceCheckInterval = window.setInterval(() => {
    if (serverNow() >= config.endAt) {
      cleanup();
      sounds.playRaceEnd();
      stateMachine.transition('ENDED', { api, config, laps: currentLaps });
    }
  }, 250);

  const loadQuestion = async () => {
    isSubmitting = false;
    if (statusBanner) statusBanner.innerHTML = '';
    if (qTextEl) qTextEl.textContent = 'FETCHING TECH QUESTION...';
    if (qOptionsEl) qOptionsEl.innerHTML = '';

    try {
      currentQuestion = await api.requestQuestion();
      if (!currentQuestion) return;

      if (qTextEl) {
        qTextEl.textContent = currentQuestion.text;
      }

      if (qOptionsEl) {
        qOptionsEl.innerHTML = currentQuestion.options
          .map(
            (opt, idx) => `
          <button class="option-btn" data-index="${idx}">
            <span class="highlight" style="margin-right:6px;">${['A', 'B', 'C', 'D'][idx]}.</span> ${opt}
          </button>
        `
          )
          .join('');

        const buttons = qOptionsEl.querySelectorAll('.option-btn');
        buttons.forEach((btn) => {
          btn.addEventListener('click', () => {
            const index = parseInt(btn.getAttribute('data-index') || '0', 10);
            handleAnswer(index);
          });
        });
      }

      // Start question timer
      questionStart = Date.now();
      startQuestionCountdown();
    } catch {
      if (qTextEl) qTextEl.textContent = 'NETWORK GLITCH. RETRYING QUESTION...';
      window.setTimeout(loadQuestion, 1500);
    }
  };

  const startQuestionCountdown = () => {
    if (questionTimer !== null) {
      window.clearInterval(questionTimer);
    }

    questionTimer = window.setInterval(() => {
      const elapsed = Date.now() - questionStart;
      const leftMs = config.questionTimeMs - elapsed;

      if (qTimerEl) {
        const sec = Math.max(0, Math.ceil(leftMs / 1000));
        qTimerEl.textContent = `${sec}s`;
        if (sec <= 3) {
          qTimerEl.style.color = 'var(--wrong-red)';
        } else {
          qTimerEl.style.color = 'var(--accent-yellow)';
        }
      }

      if (leftMs <= 0 && !isSubmitting) {
        // Question timed out
        handleTimeout();
      }
    }, 100);
  };

  const handleTimeout = () => {
    if (isSubmitting) return;
    isSubmitting = true;
    if (questionTimer !== null) window.clearInterval(questionTimer);

    sounds.playWrong();
    Vibration.wrong();

    if (statusBanner) {
      statusBanner.innerHTML = `
        <div class="lockout-notice">
          TIME OUT! LOCKOUT ${Math.round(config.wrongLockoutMs / 1000)}s...
        </div>
      `;
    }

    const buttons = qOptionsEl?.querySelectorAll('.option-btn');
    buttons?.forEach((b) => ((b as HTMLButtonElement).disabled = true));

    window.setTimeout(() => {
      loadQuestion();
    }, config.wrongLockoutMs);
  };

  const handleAnswer = async (index: number) => {
    if (isSubmitting || !currentQuestion) return;
    isSubmitting = true;
    if (questionTimer !== null) window.clearInterval(questionTimer);

    const buttons = qOptionsEl?.querySelectorAll('.option-btn');
    const selectedBtn = buttons?.[index] as HTMLButtonElement | undefined;
    buttons?.forEach((b) => ((b as HTMLButtonElement).disabled = true));

    try {
      const result = await api.submitAnswer(currentQuestion.questionId, index);

      if (result.correct) {
        if (selectedBtn) selectedBtn.classList.add('selected-correct');
        sounds.playCorrect();
        Vibration.correct();

        const addedFuel = result.fuelGrantedMs || config.fuelPerCorrectMs;
        const newFuel = Math.min(config.tankMaxMs, remainingFuel + addedFuel);

        if (statusBanner) {
          statusBanner.innerHTML = `
            <div style="background-color:var(--correct-green); color:#000; padding:6px; font-size:9px; border:2px solid #000; text-align:center;">
              CORRECT! +${Math.round(addedFuel / 1000)}s FUEL
            </div>
          `;
        }

        window.setTimeout(() => {
          cleanup();
          stateMachine.transition('RACING', {
            api,
            config,
            initialFuelMs: newFuel,
            initialLaps: currentLaps,
          });
        }, 700);
      } else {
        if (selectedBtn) selectedBtn.classList.add('selected-wrong');
        sounds.playWrong();
        Vibration.wrong();

        if (statusBanner) {
          statusBanner.innerHTML = `
            <div class="lockout-notice">
              WRONG ANSWER! LOCKOUT ${Math.round(config.wrongLockoutMs / 1000)}s...
            </div>
          `;
        }

        window.setTimeout(() => {
          loadQuestion();
        }, config.wrongLockoutMs);
      }
    } catch (err) {
      console.warn('Answer submit error:', err);
      loadQuestion();
    }
  };

  const cleanup = () => {
    if (questionTimer !== null) {
      window.clearInterval(questionTimer);
      questionTimer = null;
    }
    if (raceCheckInterval !== null) {
      window.clearInterval(raceCheckInterval);
      raceCheckInterval = null;
    }
  };

  loadQuestion();

  return cleanup;
}
