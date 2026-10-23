import { stateMachine } from '../../game/stateMachine';
import { sounds } from '../../audio/soundManager';
import { Vibration } from '../../util/vibration';

export function renderCountdownScreen(container: HTMLElement): () => void {
  sounds.unlock();

  let step = 3;
  let timerId: number | null = null;

  container.innerHTML = `
    <div class="screen-layer transparent-bg" style="pointer-events:none;">
      <div class="scanlines"></div>
      <div class="screen-content" style="pointer-events:none;">
        <p class="retro-text highlight" style="font-size: 14px; letter-spacing: 2px;">GET READY</p>
        <div id="countdown-number" class="big-countdown">3</div>
      </div>
    </div>
  `;

  const numberEl = container.querySelector('#countdown-number') as HTMLDivElement | null;

  const runStep = () => {
    if (step > 0) {
      if (numberEl) {
        numberEl.textContent = step.toString();
        numberEl.className = 'big-countdown';
      }
      sounds.playCountdownTick();
      Vibration.countdownTick();
      step--;
      timerId = window.setTimeout(runStep, 1000);
    } else if (step === 0) {
      if (numberEl) {
        numberEl.textContent = 'GO!';
        numberEl.className = 'big-countdown go';
      }
      sounds.playCountdownGo();
      Vibration.countdownGo();
      step--;
      timerId = window.setTimeout(() => {
        stateMachine.transition('RACING');
      }, 750);
    }
  };

  runStep();

  return () => {
    if (timerId !== null) {
      window.clearTimeout(timerId);
    }
  };
}
