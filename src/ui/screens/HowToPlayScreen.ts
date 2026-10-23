import { stateMachine } from '../../game/stateMachine';
import { Storage } from '../../util/storage';
import { sounds } from '../../audio/soundManager';

interface CardInfo {
  icon: string;
  title: string;
  description: string;
  hint: string;
}

const CARDS: CardInfo[] = [
  {
    icon: '🏎️',
    title: '1. AUTO-ACCEL & STEER',
    description: 'The car auto-accelerates while it has fuel! Hold LEFT or RIGHT to steer smoothly through corners.',
    hint: '(Touch left/right sides or use A / D / Arrow keys)',
  },
  {
    icon: '⛽',
    title: '2. FUEL IS TIME',
    description: 'Fuel drains continuously as you drive. If it runs out, your car rolls to a halt!',
    hint: '(30 seconds of pure driving on a full tank)',
  },
  {
    icon: '💡',
    title: '3. QUIZ TO REFUEL',
    description: 'Answer tech questions to pump fuel! The race clock keeps ticking, so answer fast.',
    hint: '(Voluntary pit stop is available when tank <= 50%)',
  },
];

export function renderHowToPlayScreen(container: HTMLElement): () => void {
  let currentIndex = 0;
  let touchStartX = 0;

  const updateCardView = () => {
    const card = CARDS[currentIndex];
    const isLast = currentIndex === CARDS.length - 1;

    container.innerHTML = `
      <div class="screen-layer">
        <div class="scanlines"></div>
        <div class="screen-content">
          <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
            <span class="retro-text highlight">INSTRUCTIONS</span>
            <button id="skip-tutorial-btn" class="retro-btn btn-secondary" style="width:auto; padding:6px 10px;">
              SKIP
            </button>
          </div>

          <div id="card-touch-area" class="card-frame">
            <div class="card-icon">${card.icon}</div>
            <h2 class="retro-subtitle highlight">${card.title}</h2>
            <p class="retro-text" style="padding: 0 10px;">${card.description}</p>
            <p class="retro-text cyan-text" style="font-size: 8px;">${card.hint}</p>

            <div class="card-indicators">
              ${CARDS.map(
                (_, idx) =>
                  `<div class="indicator-dot ${idx === currentIndex ? 'active' : ''}"></div>`
              ).join('')}
            </div>
          </div>

          <div style="width:100%; display:flex; gap: 10px;">
            ${
              currentIndex > 0
                ? `<button id="prev-card-btn" class="retro-btn btn-secondary" style="flex:1;">BACK</button>`
                : ''
            }
            <button id="next-card-btn" class="retro-btn ${isLast ? 'btn-green' : 'btn-cyan'}" style="flex:2;">
              ${isLast ? "LET'S RACE!" : 'NEXT >'}
            </button>
          </div>
        </div>
      </div>
    `;

    // Bind event listeners
    const nextBtn = container.querySelector('#next-card-btn') as HTMLButtonElement | null;
    const prevBtn = container.querySelector('#prev-card-btn') as HTMLButtonElement | null;
    const skipBtn = container.querySelector('#skip-tutorial-btn') as HTMLButtonElement | null;
    const cardArea = container.querySelector('#card-touch-area') as HTMLDivElement | null;

    nextBtn?.addEventListener('click', handleNext);
    prevBtn?.addEventListener('click', handlePrev);
    skipBtn?.addEventListener('click', handleFinish);
    cardArea?.addEventListener('click', handleNext);

    cardArea?.addEventListener('touchstart', (e: TouchEvent) => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    cardArea?.addEventListener('touchend', (e: TouchEvent) => {
      const touchEndX = e.changedTouches[0].screenX;
      if (touchEndX < touchStartX - 40) {
        // Swiped left -> next
        handleNext();
      } else if (touchEndX > touchStartX + 40 && currentIndex > 0) {
        // Swiped right -> prev
        handlePrev();
      }
    }, { passive: true });
  };

  const handleNext = () => {
    sounds.playCountdownTick();
    if (currentIndex < CARDS.length - 1) {
      currentIndex++;
      updateCardView();
    } else {
      handleFinish();
    }
  };

  const handlePrev = () => {
    sounds.playCountdownTick();
    if (currentIndex > 0) {
      currentIndex--;
      updateCardView();
    }
  };

  const handleFinish = () => {
    sounds.unlock();
    Storage.setTutorialSeen();
    stateMachine.transition('LOBBY');
  };

  updateCardView();

  return () => {
    // Cleanup if needed
  };
}
