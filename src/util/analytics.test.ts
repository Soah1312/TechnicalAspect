import { describe, it, expect, vi } from 'vitest';
import { analytics } from './analytics';

vi.mock('@vercel/analytics', () => ({
  inject: vi.fn(),
  track: vi.fn(),
}));

describe('Vercel Analytics Utility', () => {
  it('initializes without throwing', () => {
    expect(() => analytics.init()).not.toThrow();
  });

  it('tracks game join cleanly', () => {
    expect(() =>
      analytics.trackGameJoin({ branch: 'COMPS', year: '2' })
    ).not.toThrow();
  });

  it('tracks race lifecycle events', () => {
    expect(() => analytics.trackRaceStart()).not.toThrow();
    expect(() => analytics.trackLapCompleted(1)).not.toThrow();
    expect(() => analytics.trackPitStop('correct')).not.toThrow();
    expect(() => analytics.trackPitStop('wrong')).not.toThrow();
    expect(() => analytics.trackRaceFinished(2500, 2, 5)).not.toThrow();
  });

  it('tracks leaderboard views', () => {
    expect(() => analytics.trackLeaderboardView('AIDS', '3')).not.toThrow();
    expect(() => analytics.trackLeaderboardView()).not.toThrow();
  });
});
