// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../audio/soundManager', () => ({ sounds: {
  isMuted: () => true, unlock: vi.fn(), playClick: vi.fn(), toggleMute: () => false,
} }));
import { renderRacingHud } from './RacingHud';
import { renderResultsScreen } from './ResultsScreen';
import { DEFAULT_CONFIG } from '../../config/constants';
import type { GameApi, LeaderboardSnapshot } from '../../api/types';

let cleanup: (() => void) | undefined;
let container: HTMLDivElement;
const snapshot = (name: string, rank = 1): LeaderboardSnapshot => ({
  top: [{ name, rank, laps: 3, correct: 4, isMe: true }],
  me: { name, rank, laps: 3, correct: 4, isMe: true }, totalPlayers: 12,
});
const click = (id: string) => container.querySelector<HTMLButtonElement>(id)!.click();
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  container = document.createElement('div'); document.body.append(container);
});
afterEach(() => { cleanup?.(); cleanup = undefined; container.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Live leaderboard UI', () => {
  it('ignores late tab responses and preserves the global rank badge', async () => {
    let resolveBranch!: (value: LeaderboardSnapshot) => void;
    const getLeaderboard = vi.fn((scope = 'ALL') => scope === 'BRANCH'
      ? new Promise<LeaderboardSnapshot>(resolve => { resolveBranch = resolve; })
      : Promise.resolve(snapshot(scope, scope === 'ALL' ? 12 : 2)));
    cleanup = renderRacingHud(container, { api: { getLeaderboard } as unknown as GameApi, config: { ...DEFAULT_CONFIG, startAt: 0, endAt: 9999999999999 } });
    await flush(); click('#hud-rank-btn'); await flush();
    click('#tab-scope-branch'); click('#tab-scope-year'); await flush();
    resolveBranch(snapshot('OLD BRANCH')); await flush();
    expect(container.querySelector('#live-board-content')!.textContent).toContain('YEAR');
    expect(container.querySelector('#live-board-content')!.textContent).not.toContain('OLD BRANCH');
    expect(container.querySelector('#hud-rank')!.textContent).toBe('#12');
  });

  it('refreshes while open, renders names as text, and stops after cleanup', async () => {
    const getLeaderboard = vi.fn().mockResolvedValue(snapshot('<img src=x onerror=alert(1)>'));
    cleanup = renderRacingHud(container, { api: { getLeaderboard } as unknown as GameApi, config: { ...DEFAULT_CONFIG, startAt: 0, endAt: 9999999999999 } });
    click('#hud-rank-btn'); await flush();
    expect(container.querySelector('#live-board-content img')).toBeNull();
    expect(container.querySelector('#live-board-content')!.textContent).toContain('<img');
    getLeaderboard.mockResolvedValue(snapshot('UPDATED'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(container.querySelector('#live-board-content')!.textContent).toContain('UPDATED');
    cleanup(); cleanup = undefined;
    const calls = getLeaderboard.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000);
    expect(getLeaderboard).toHaveBeenCalledTimes(calls);
  });

  it('does not resurrect polling when a request finishes after unmount', async () => {
    let resolve!: (value: LeaderboardSnapshot) => void;
    const getLeaderboard = vi.fn().mockReturnValue(new Promise<LeaderboardSnapshot>(r => { resolve = r; }));
    cleanup = renderRacingHud(container, { api: { getLeaderboard } as unknown as GameApi, config: { ...DEFAULT_CONFIG, startAt: 0, endAt: 9999999999999 } });
    click('#hud-rank-btn'); cleanup(); cleanup = undefined;
    resolve(snapshot('LATE')); await flush();
    await vi.advanceTimersByTimeAsync(30000);
    expect(getLeaderboard).toHaveBeenCalledTimes(2);
  });

  it('supports Escape and restores focus to the leaderboard trigger', async () => {
    cleanup = renderRacingHud(container, { api: { getLeaderboard: vi.fn().mockResolvedValue(snapshot('Racer')) } as unknown as GameApi, config: { ...DEFAULT_CONFIG, startAt: 0, endAt: 9999999999999 } });
    click('#hud-rank-btn'); await flush();
    expect(document.activeElement?.id).toBe('close-leaderboard-btn');
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement?.id).toBe('hud-rank-btn');
    expect(container.querySelector('#hud-rank-btn')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('retries stale results and picks up late confirmed scores', async () => {
    const getLeaderboard = vi.fn().mockResolvedValue({ ...snapshot('Racer'), isStale: true });
    cleanup = renderResultsScreen(container, { api: { getLeaderboard } as unknown as GameApi });
    await flush();
    expect(container.querySelector('#res-total-racers')!.textContent).toContain('STALE');
    getLeaderboard.mockResolvedValue(snapshot('Confirmed', 3));
    await vi.advanceTimersByTimeAsync(5000);
    expect(container.querySelector('#res-rank')!.textContent).toBe('#3');
  });
});
