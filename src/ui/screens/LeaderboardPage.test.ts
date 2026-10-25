// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calculateScore,
  formatYear,
  formatYearShort,
  renderLeaderboardPage,
} from './LeaderboardPage';
import type { GameApi, LeaderboardSnapshot } from '../../api/types';

vi.mock('../../audio/soundManager', () => ({
  sounds: {
    isMuted: () => true,
    unlock: vi.fn(),
    playClick: vi.fn(),
    toggleMute: () => false,
  },
}));

let container: HTMLDivElement;
let cleanup: (() => void) | undefined;

const createMockApi = (mockSnapshot: LeaderboardSnapshot): GameApi => ({
  getConfig: vi.fn(),
  getServerTime: vi.fn(),
  joinRace: vi.fn(),
  requestQuestion: vi.fn(),
  submitAnswer: vi.fn(),
  submitLap: vi.fn(),
  getLeaderboard: vi.fn().mockResolvedValue(mockSnapshot),
});

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  if (cleanup) cleanup();
  container.remove();
  vi.useRealTimers();
  document.body.className = '';
});

describe('Leaderboard Helpers', () => {
  it('calculates score based on formula (Laps * 1000 + Correct * 100)', () => {
    expect(calculateScore(0, 0)).toBe(0);
    expect(calculateScore(1, 0)).toBe(1000);
    expect(calculateScore(0, 1)).toBe(100);
    expect(calculateScore(12, 4)).toBe(12400);
    expect(calculateScore(25, 10)).toBe(26000);
  });

  it('formats years correctly for display', () => {
    expect(formatYear(1)).toBe('1st (FE)');
    expect(formatYear(2)).toBe('2nd (SE)');
    expect(formatYear(3)).toBe('3rd (TE)');
    expect(formatYear(4)).toBe('4th (BE)');

    expect(formatYearShort(1)).toBe('FE');
    expect(formatYearShort(2)).toBe('SE');
    expect(formatYearShort(3)).toBe('TE');
    expect(formatYearShort(4)).toBe('BE');
  });
});

describe('LeaderboardPage Component', () => {
  const sampleSnapshot: LeaderboardSnapshot = {
    top: [
      { rank: 1, name: 'Alice Racer', branch: 'COMPS', year: 2, laps: 10, correct: 5, isMe: false },
      { rank: 2, name: 'Bob Turbo', branch: 'MECH', year: 3, laps: 8, correct: 4, isMe: false },
      { rank: 3, name: 'Charlie Drift', branch: 'CSE', year: 1, laps: 6, correct: 2, isMe: true },
      { rank: 4, name: 'Dave Speed', branch: 'AIDS', year: 4, laps: 4, correct: 1, isMe: false },
      { rank: 5, name: 'Eve Spark', branch: 'ECS', year: 2, laps: 2, correct: 3, isMe: false },
    ],
    me: { rank: 3, name: 'Charlie Drift', branch: 'CSE', year: 1, laps: 6, correct: 2, isMe: true },
    totalPlayers: 5,
    isStale: false,
  };

  it('renders the header, metrics, and standings table with driver name, branch, year, and score', async () => {
    const api = createMockApi(sampleSnapshot);
    cleanup = renderLeaderboardPage(container, api);

    // Allow async data fetch to resolve
    await Promise.resolve();
    await Promise.resolve();

    expect(document.body.classList.contains('leaderboard-page-mode')).toBe(true);

    const title = container.querySelector('.lb-page-title');
    expect(title?.textContent).toContain('CRESCENDO FUEL RUSH');

    // Verify drivers are rendered
    const rows = container.querySelectorAll('.lb-table-row');
    expect(rows.length).toBe(5);

    // 1st driver: Alice Racer (COMPS, Y2, Score = 10*1000 + 5*100 = 10500)
    const firstRowText = rows[0].textContent;
    expect(firstRowText).toContain('Alice Racer');
    expect(firstRowText).toContain('COMPS');
    expect(firstRowText).toContain('SE');
    expect(firstRowText).toContain('10,500 PTS');
    expect(firstRowText).toContain('10 Laps');
    expect(firstRowText).toContain('5 Correct');

    // Verify Charlie Drift has YOU badge
    const charlieRow = rows[2];
    expect(charlieRow.textContent).toContain('Charlie Drift');
    expect(charlieRow.querySelector('.lb-you-badge')?.textContent).toBe('YOU');
  });

  it('renders top 3 podium cards with medals and scores', async () => {
    const api = createMockApi(sampleSnapshot);
    cleanup = renderLeaderboardPage(container, api);

    await Promise.resolve();
    await Promise.resolve();

    const podium = container.querySelector('#lb-podium-container') as HTMLElement;
    expect(podium.style.display).not.toBe('none');

    expect(podium.textContent).toContain('Alice Racer');
    expect(podium.textContent).toContain('Bob Turbo');
    expect(podium.textContent).toContain('Charlie Drift');
    expect(podium.textContent).toContain('10,500 PTS');
  });

  it('filters drivers when branch pills are clicked', async () => {
    const api = createMockApi(sampleSnapshot);
    cleanup = renderLeaderboardPage(container, api);

    await Promise.resolve();
    await Promise.resolve();

    // Click MECH branch pill
    const mechPill = container.querySelector('[data-branch="MECH"]') as HTMLButtonElement;
    expect(mechPill).toBeTruthy();
    mechPill.click();

    const rows = container.querySelectorAll('.lb-table-row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Bob Turbo');
    expect(rows[0].textContent).toContain('MECH');

    // Click ALL branch pill to restore
    const allPill = container.querySelector('[data-branch="ALL"]') as HTMLButtonElement;
    allPill.click();
    expect(container.querySelectorAll('.lb-table-row').length).toBe(5);
  });

  it('filters drivers by search input', async () => {
    const api = createMockApi(sampleSnapshot);
    cleanup = renderLeaderboardPage(container, api);

    await Promise.resolve();
    await Promise.resolve();

    const searchInput = container.querySelector('#lb-search-input') as HTMLInputElement;
    expect(searchInput).toBeTruthy();

    searchInput.value = 'dave';
    searchInput.dispatchEvent(new Event('input'));

    const rows = container.querySelectorAll('.lb-table-row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Dave Speed');
    expect(rows[0].textContent).toContain('AIDS');
  });

  it('refreshes periodically every 10 seconds', async () => {
    const api = createMockApi(sampleSnapshot);
    cleanup = renderLeaderboardPage(container, api);

    await Promise.resolve();
    await Promise.resolve();

    expect(api.getLeaderboard).toHaveBeenCalledTimes(1);

    // Fast forward 10 seconds
    vi.advanceTimersByTime(10000);
    await Promise.resolve();

    expect(api.getLeaderboard).toHaveBeenCalledTimes(2);
  });

  it('cleans up on unmount without leaking timers or styles', async () => {
    const api = createMockApi(sampleSnapshot);
    cleanup = renderLeaderboardPage(container, api);

    await Promise.resolve();
    expect(document.body.classList.contains('leaderboard-page-mode')).toBe(true);

    cleanup();
    cleanup = undefined;

    expect(document.body.classList.contains('leaderboard-page-mode')).toBe(false);
  });
});
