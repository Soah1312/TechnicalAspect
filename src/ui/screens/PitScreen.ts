import type { GameApi, GameConfig, Question } from '../../api/types';
import { stateMachine } from '../../game/stateMachine';
import { sounds } from '../../audio/soundManager';
import { Vibration } from '../../util/vibration';
import { PitManager } from '../../game/pit';
import type { RaceScene } from '../../game/scenes/RaceScene';

interface PitScreenProps {
  api: GameApi;
  config: GameConfig;
  raceScene?: RaceScene;
  reason?: 'dry' | 'voluntary';
}

export function renderPitScreen(
  container: HTMLElement,
  props: PitScreenProps
): () => void {
  const { api, config, raceScene } = props;
  const pitManager = new PitManager(api);

  // Mark pit entered for anti-refresh abuse protection
  pitManager.markEnteredPit();

  let currentQuestion: Question | null = null;
  let isSubmitting = false;
  let isLockedOut = false;
  let questionTimer: number | null = null;
  let questionStart = Date.now();
  let raceCheckInterval: number | null = null;

  container.innerHTML = `
    <div class="modal-overlay pit-overlay">
      <div class="scanlines"></div>

      <!-- Question Top Header -->
      <div class="question-header">
        <div>
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="retro-text highlight" style="font-size:12px;">
              ${props.reason === 'voluntary' ? 'PIT STOP REFUEL' : 'OUT OF FUEL!'}
            </span>
            <span id="q-diff-badge" style="display:none;"></span>
          </div>
          <p class="retro-text" style="font-size:7px; margin-top:3px; opacity:0.8;">
            CAR STOPPED • RACE CLOCK ACTIVE
          </p>
        </div>
        <div style="text-align:right;">
          <span class="timer-tag" id="q-timer" style="font-size:14px; font-weight:bold;">15s</span>
        </div>
      </div>

      <!-- Visual 15s Timer Bar -->
      <div class="q-timer-bar-frame">
        <div id="q-timer-bar" class="q-timer-bar-fill"></div>
      </div>

      <!-- Question Content Panel -->
      <div class="screen-content" style="justify-content:center; padding: 6px 0;">
        <div class="retro-panel" style="width:100%; border-color:var(--cyan); padding:10px;">
          <p class="retro-text" id="q-text" style="font-size:10px; line-height:1.6;">
            CONNECTING TO TECH PIT CREW...
          </p>
        </div>

        <div id="q-status-banner" style="min-height:24px; width:100%; display:flex; justify-content:center; align-items:center;"></div>

        <!-- 4 Large Answer Buttons -->
        <div id="q-options" class="options-list"></div>
      </div>

      <!-- Bottom Hint Bar -->
      <div style="text-align:center; padding: 2px;">
        <p class="retro-text" style="font-size:7px; color:var(--cyan);">
          CORRECT = +${Math.round(config.fuelPerCorrectMs / 1000)}s FUEL • WRONG = ${Math.round(config.wrongLockoutMs / 1000)}s LOCKOUT
        </p>
      </div>
    </div>
  `;

  const qTextEl = container.querySelector('#q-text') as HTMLParagraphElement | null;
  const qOptionsEl = container.querySelector('#q-options') as HTMLDivElement | null;
  const qTimerEl = container.querySelector('#q-timer') as HTMLSpanElement | null;
  const qTimerBarEl = container.querySelector('#q-timer-bar') as HTMLDivElement | null;
  const statusBanner = container.querySelector('#q-status-banner') as HTMLDivElement | null;

  // Race is continuously open: pit stops remain active without interruption
  const loadQuestion = async () => {
    isSubmitting = false;
    isLockedOut = false;
    if (statusBanner) statusBanner.innerHTML = '';
    if (qTextEl) qTextEl.textContent = 'FETCHING TECH QUESTION...';
    if (qOptionsEl) qOptionsEl.innerHTML = '';

    try {
      currentQuestion = await pitManager.fetchQuestion();
      if (!currentQuestion) return;

      if (qTextEl) {
        qTextEl.textContent = currentQuestion.text;
      }

      const diffBadgeEl = container.querySelector('#q-diff-badge') as HTMLElement | null;
      if (diffBadgeEl) {
        const diff = currentQuestion.difficulty || 1;
        if (diff === 1) {
          diffBadgeEl.className = 'diff-badge diff-easy';
          diffBadgeEl.textContent = 'EASY';
          diffBadgeEl.style.display = 'inline-block';
        } else if (diff === 2) {
          diffBadgeEl.className = 'diff-badge diff-medium';
          diffBadgeEl.textContent = 'MEDIUM';
          diffBadgeEl.style.display = 'inline-block';
        } else {
          diffBadgeEl.className = 'diff-badge diff-hard';
          diffBadgeEl.textContent = 'HARD';
          diffBadgeEl.style.display = 'inline-block';
        }
      }

      if (qOptionsEl) {
        qOptionsEl.innerHTML = currentQuestion.options
          .map(
            (opt, idx) => `
          <button class="option-btn" data-index="${idx}" style="font-size:10px; padding:12px 10px;">
            <span class="highlight" style="margin-right:6px;">${['A', 'B', 'C', 'D'][idx]}.</span> ${opt}
          </button>
        `
          )
          .join('');

        const buttons = qOptionsEl.querySelectorAll('.option-btn');
        buttons.forEach((btn) => {
          btn.addEventListener('click', () => {
            if (isSubmitting || isLockedOut) return;
            const index = parseInt(btn.getAttribute('data-index') || '0', 10);
            handleAnswer(index);
          });
        });
      }

      // Start 15s question countdown
      questionStart = Date.now();
      startQuestionCountdown();
    } catch (err: unknown) {
      console.error('[PitScreen] fetchQuestion error:', err);
      const errMsg = err instanceof Error ? err.message : 'FAILED TO LOAD QUESTION';
      if (qTextEl) {
        qTextEl.innerHTML = `
          <span style="color:var(--wrong-red); font-size:9px;">${errMsg.toUpperCase()}</span><br/>
          <button id="retry-question-btn" class="retro-btn btn-secondary" style="margin-top:8px; width:auto; padding:6px 12px;">
            RETRY QUESTION
          </button>
        `;
        const retryBtn = container.querySelector('#retry-question-btn');
        retryBtn?.addEventListener('click', () => loadQuestion());
      }
    }
  };

  const startQuestionCountdown = () => {
    if (questionTimer !== null) {
      window.clearInterval(questionTimer);
    }

    questionTimer = window.setInterval(() => {
      const elapsed = Date.now() - questionStart;
      const leftMs = config.questionTimeMs - elapsed;
      const ratio = Math.max(0, leftMs / config.questionTimeMs);

      if (qTimerEl) {
        const sec = Math.max(0, Math.ceil(leftMs / 1000));
        qTimerEl.textContent = `${sec}s`;
        if (sec <= 3) {
          qTimerEl.style.color = 'var(--wrong-red)';
        } else {
          qTimerEl.style.color = 'var(--accent-yellow)';
        }
      }

      if (qTimerBarEl) {
        qTimerBarEl.style.width = `${ratio * 100}%`;
        if (ratio <= 0.25) {
          qTimerBarEl.classList.add('critical');
        } else {
          qTimerBarEl.classList.remove('critical');
        }
      }

      if (leftMs <= 0 && !isSubmitting && !isLockedOut) {
        handleTimeout();
      }
    }, 100);
  };

  const handleTimeout = async () => {
    if (isSubmitting || isLockedOut || !currentQuestion) return;
    isLockedOut = true;
    if (questionTimer !== null) window.clearInterval(questionTimer);

    sounds.playWrong();
    Vibration.wrong();

    // Disable all options
    const buttons = qOptionsEl?.querySelectorAll('.option-btn');
    buttons?.forEach((b) => ((b as HTMLButtonElement).disabled = true));

    let lockoutRemaining = Math.round(config.wrongLockoutMs / 1000);

    try {
      const result = await pitManager.answerQuestion(currentQuestion.questionId, -1);
      
      // Reveal correct option if present
      if (result.correctIndex !== undefined && buttons?.[result.correctIndex]) {
        const correctBtn = buttons[result.correctIndex] as HTMLButtonElement;
        correctBtn.innerHTML = `<span class="answer-icon correct">✔</span> ${currentQuestion.options[result.correctIndex]}`;
        correctBtn.className = 'option-btn reveal-correct';
      }

      const updateLockoutBanner = () => {
        if (statusBanner) {
          statusBanner.innerHTML = `
            <div class="lockout-notice" style="width:100%;">
              <div style="color:var(--wrong-red); font-size:9px; margin-bottom:3px; font-weight:bold;">TIME UP!</div>
              ${result.correctIndex !== undefined ? `
                <div style="color:var(--correct-green); font-size:8px; margin-bottom:3px;">
                  CORRECT: ${currentQuestion?.options[result.correctIndex]}
                </div>
              ` : ''}
              ${result.explanation ? `
                <div style="color:#ffffff; font-size:7px; font-weight:normal; opacity:0.9; margin-bottom:3px;">
                  ${result.explanation}
                </div>
              ` : ''}
              <div style="font-size:7px; color:var(--cyan);">LOCKOUT: ${lockoutRemaining}s...</div>
            </div>
          `;
        }
      };

      updateLockoutBanner();

      const lockoutTimer = window.setInterval(() => {
        lockoutRemaining--;
        if (lockoutRemaining <= 0) {
          window.clearInterval(lockoutTimer);
          loadQuestion();
        } else {
          updateLockoutBanner();
        }
      }, 1000);
    } catch {
      loadQuestion();
    }
  };

  const handleAnswer = async (index: number) => {
    if (isSubmitting || isLockedOut || !currentQuestion) return;
    isSubmitting = true;
    if (questionTimer !== null) window.clearInterval(questionTimer);

    // 1. Immediately disable buttons to prevent double submission
    const buttons = qOptionsEl?.querySelectorAll('.option-btn');
    const selectedBtn = buttons?.[index] as HTMLButtonElement | undefined;
    buttons?.forEach((b) => ((b as HTMLButtonElement).disabled = true));

    if (selectedBtn) {
      selectedBtn.innerHTML += ` <span style="font-size:8px; color:var(--accent-yellow);">[CHECKING...]</span>`;
    }

    try {
      const result = await pitManager.answerQuestion(currentQuestion.questionId, index);

      if (result.correct) {
        if (selectedBtn) {
          selectedBtn.className = 'option-btn selected-correct';
          selectedBtn.innerHTML = `<span class="answer-icon correct">✔</span> ${currentQuestion.options[index]}`;
        }
        sounds.playCorrect();
        Vibration.correct();

        const fuelToAdd = result.fuelGrantedMs || config.fuelPerCorrectMs;
        if (raceScene) {
          raceScene.fuelSystem.addFuel(fuelToAdd);
        }

        // Mark pit exited cleanly
        pitManager.markExitedPit();

        if (statusBanner) {
          statusBanner.innerHTML = `
            <div style="background-color:var(--correct-green); color:#000; padding:6px 12px; font-size:10px; border:2px solid #000; text-align:center; font-weight:bold;">
              CORRECT! +${Math.round(fuelToAdd / 1000)}s FUEL
            </div>
          `;
        }

        // Show floating "+20s" text and brief "GO!" cue
        showFloatingFuelCue(Math.round(fuelToAdd / 1000));

        window.setTimeout(() => {
          cleanup();
          stateMachine.transition('RACING');
        }, 650);
      } else {
        if (selectedBtn) {
          selectedBtn.className = 'option-btn selected-wrong';
          selectedBtn.innerHTML = `<span class="answer-icon wrong">✖</span> ${currentQuestion.options[index]}`;
        }
        
        // Highlight correct answer in green
        if (result.correctIndex !== undefined && buttons?.[result.correctIndex]) {
          const correctBtn = buttons[result.correctIndex] as HTMLButtonElement;
          correctBtn.className = 'option-btn reveal-correct';
          correctBtn.innerHTML = `<span class="answer-icon correct">✔</span> ${currentQuestion.options[result.correctIndex]}`;
        }

        sounds.playWrong();
        Vibration.wrong();
        isLockedOut = true;

        let lockoutRemaining = Math.round(config.wrongLockoutMs / 1000);
        const updateWrongBanner = () => {
          if (statusBanner) {
            statusBanner.innerHTML = `
              <div class="lockout-notice" style="width:100%;">
                <div style="color:var(--wrong-red); font-size:9px; margin-bottom:3px; font-weight:bold;">WRONG ANSWER</div>
                ${result.correctIndex !== undefined ? `
                  <div style="color:var(--correct-green); font-size:8px; margin-bottom:3px;">
                    CORRECT: ${currentQuestion?.options[result.correctIndex]}
                  </div>
                ` : ''}
                ${result.explanation ? `
                  <div style="color:#ffffff; font-size:7px; font-weight:normal; opacity:0.9; margin-bottom:3px;">
                    ${result.explanation}
                  </div>
                ` : ''}
                <div style="font-size:7px; color:var(--cyan);">LOCKOUT: ${lockoutRemaining}s...</div>
              </div>
            `;
          }
        };

        updateWrongBanner();

        const lockoutTimer = window.setInterval(() => {
          lockoutRemaining--;
          if (lockoutRemaining <= 0) {
            window.clearInterval(lockoutTimer);
            loadQuestion();
          } else {
            updateWrongBanner();
          }
        }, 1000);
      }
    } catch {
      isSubmitting = false;
      if (statusBanner) {
        statusBanner.innerHTML = `
          <div style="color:var(--wrong-red); font-size:8px;">
            CHECK FAILED. RETRYING ANSWER...
          </div>
        `;
      }
      buttons?.forEach((b) => ((b as HTMLButtonElement).disabled = false));
    }
  };

  const showFloatingFuelCue = (fuelSeconds: number) => {
    const appEl = document.getElementById('app');
    if (!appEl) return;

    // 1. Floating +20s fuel banner
    const floatEl = document.createElement('div');
    floatEl.className = 'floating-fuel-text';
    floatEl.textContent = `+${fuelSeconds}s FUEL!`;
    appEl.appendChild(floatEl);

    // 2. Short "GO!" resume cue
    const goEl = document.createElement('div');
    goEl.className = 'resume-go-banner';
    goEl.textContent = 'GO!';
    appEl.appendChild(goEl);

    window.setTimeout(() => {
      floatEl.remove();
      goEl.remove();
    }, 1200);
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
