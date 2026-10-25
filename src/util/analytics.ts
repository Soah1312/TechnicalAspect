import { inject, track } from '@vercel/analytics';

let initialized = false;

export const analytics = {
  /**
   * Initializes Vercel Web Analytics.
   * In auto mode, tracks page views and logs in dev, reports to Vercel in production.
   */
  init(): void {
    if (initialized) return;
    try {
      inject({ mode: 'auto' });
      initialized = true;
    } catch (err) {
      console.warn('[Analytics] Failed to initialize Vercel Analytics:', err);
    }
  },

  /**
   * Safe custom event tracker.
   */
  track(eventName: string, properties?: Record<string, string | number | boolean | null>): void {
    try {
      track(eventName, properties);
    } catch {
      // Non-blocking: analytics should never crash gameplay
    }
  },

  trackGameJoin(player: { branch: string; year: string }): void {
    this.track('game_joined', {
      branch: player.branch,
      year: player.year,
    });
  },

  trackRaceStart(): void {
    this.track('race_start');
  },

  trackLapCompleted(lapNumber: number): void {
    this.track('lap_completed', {
      lap: lapNumber,
    });
  },

  trackPitStop(result: 'correct' | 'wrong'): void {
    this.track('pit_stop', {
      result,
    });
  },

  trackRaceFinished(finalScore: number, totalLaps: number, correctAnswers: number): void {
    this.track('race_finished', {
      score: finalScore,
      laps: totalLaps,
      correct: correctAnswers,
    });
  },

  trackLeaderboardView(filterBranch?: string, filterYear?: string): void {
    this.track('leaderboard_view', {
      branch: filterBranch || 'ALL',
      year: filterYear || 'ALL',
    });
  },
};
