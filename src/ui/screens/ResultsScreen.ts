import type { GameApi } from '../../api/types';
import { stateMachine } from '../../game/stateMachine';
import { Storage } from '../../util/storage';

interface ResultsScreenProps {
  api: GameApi;
  laps?: number;
}

export function renderResultsScreen(
  container: HTMLElement,
  props: ResultsScreenProps
): () => void {
  const { api } = props;
  const player = Storage.getPlayer();

  container.innerHTML = `
    <div class="screen-layer">
      <div class="scanlines"></div>
      <div class="screen-content" style="justify-content: flex-start; overflow-y: auto; padding-top: 10px;">
        <div style="width:100%; text-align:center;">
          <h1 class="retro-title" style="color:var(--correct-green); font-size:16px;">
            🏁 RACE FINISHED! 🏁
          </h1>
          <p class="retro-text" style="font-size:8px;">CRESCENDO 2026 FLASHMOB</p>
        </div>

        <!-- Player Stat Summary -->
        <div class="retro-panel" style="width:100%; margin-top: 8px;">
          <p class="retro-text highlight" style="margin-bottom: 8px;">${player?.name || 'RACER'}</p>
          <div style="display:flex; justify-content:space-around; text-align:center;">
            <div>
              <span class="retro-text" style="font-size:7px; color:var(--cyan);">LAPS</span>
              <div id="res-laps" class="retro-subtitle highlight" style="font-size:16px; margin-top:2px;">
                ${props.laps ?? 0}
              </div>
            </div>
            <div>
              <span class="retro-text" style="font-size:7px; color:var(--cyan);">CORRECT</span>
              <div id="res-correct" class="retro-subtitle green-text" style="font-size:16px; margin-top:2px;">
                -
              </div>
            </div>
            <div>
              <span class="retro-text" style="font-size:7px; color:var(--cyan);">RANK</span>
              <div id="res-rank" class="retro-subtitle" style="font-size:16px; margin-top:2px; color:var(--accent-yellow);">
                #-
              </div>
            </div>
          </div>
        </div>

        <!-- Leaderboard Snapshot -->
        <div class="retro-panel" style="width:100%; margin-top: 8px; flex:1;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="retro-text highlight" style="font-size:8px;">TOP LEADERBOARD</span>
            <span id="res-total-racers" class="retro-text" style="font-size:7px; opacity:0.8;">-- DRIVERS</span>
          </div>

          <div id="leaderboard-content" style="margin-top:6px;">
            <p class="retro-text" style="font-size:8px; opacity:0.6; padding:10px 0;">FETCHING SCORES...</p>
          </div>
        </div>

        <button id="race-again-btn" class="retro-btn btn-cyan" style="margin-top: 10px;">
          RACE AGAIN
        </button>
      </div>
    </div>
  `;

  const rankEl = container.querySelector('#res-rank') as HTMLDivElement | null;
  const correctEl = container.querySelector('#res-correct') as HTMLDivElement | null;
  const totalRacersEl = container.querySelector('#res-total-racers') as HTMLSpanElement | null;
  const boardEl = container.querySelector('#leaderboard-content') as HTMLDivElement | null;
  const againBtn = container.querySelector('#race-again-btn') as HTMLButtonElement | null;

  againBtn?.addEventListener('click', () => {
    // Reset player state and restart
    Storage.clearPlayer();
    stateMachine.transition('JOIN');
  });

  const loadLeaderboard = async () => {
    try {
      const snap = await api.getLeaderboard();

      if (snap.me) {
        if (rankEl) rankEl.textContent = `#${snap.me.rank}`;
        if (correctEl) correctEl.textContent = snap.me.correct.toString();
      }
      if (totalRacersEl) {
        totalRacersEl.textContent = `${snap.totalPlayers} DRIVERS`;
      }

      if (boardEl) {
        boardEl.innerHTML = `
          <table class="leaderboard-table">
            <thead>
              <tr>
                <th style="width:18%;">RNK</th>
                <th style="width:46%;">NAME</th>
                <th style="width:18%; text-align:right;">LAP</th>
                <th style="width:18%; text-align:right;">COR</th>
              </tr>
            </thead>
            <tbody>
              ${snap.top
                .map(
                  (row) => `
                <tr class="${row.isMe ? 'my-row' : ''}">
                  <td>#${row.rank}</td>
                  <td style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:110px;">
                    ${row.name}
                  </td>
                  <td style="text-align:right;">${row.laps}</td>
                  <td style="text-align:right;">${row.correct}</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        `;
      }
    } catch {
      if (boardEl) {
        boardEl.innerHTML = `<p class="retro-text red-text" style="font-size:8px;">LEADERBOARD OFFLINE</p>`;
      }
    }
  };

  loadLeaderboard();

  return () => {
    // Cleanup
  };
}
