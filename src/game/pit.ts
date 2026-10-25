import type { GameApi, Question, AnswerResult } from '../api/types';

const PIT_STORAGE_KEY = 'cfr_in_pit';

export class PitManager {
  private api: GameApi;

  constructor(api: GameApi) {
    this.api = api;
  }

  public markEnteredPit(): void {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(PIT_STORAGE_KEY, 'true');
      }
    } catch {
      // Ignore
    }
  }

  public markExitedPit(): void {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(PIT_STORAGE_KEY);
      }
    } catch {
      // Ignore
    }
  }

  public isMarkedInPit(): boolean {
    try {
      if (typeof sessionStorage !== 'undefined') {
        return sessionStorage.getItem(PIT_STORAGE_KEY) === 'true';
      }
    } catch {
      // Ignore
    }
    return false;
  }

  /**
   * Fetches the next question. If server returns TOO_SOON (anti-farming rule),
   * waits for waitMs and retries automatically so normal play never hits an error.
   */
  public async fetchQuestion(): Promise<Question> {
    const maxRetries = 10;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const q = await this.api.requestQuestion();
      if (q.status === 'TOO_SOON') {
        const waitMs = Math.max(200, Math.min(q.waitMs || 1000, 3000));
        console.log(`[PitManager] Anti-farming wait: retrying in ${waitMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      return q;
    }
    return this.api.requestQuestion();
  }

  public async answerQuestion(questionId: string, optionIndex: number): Promise<AnswerResult> {
    return this.api.submitAnswer(questionId, optionIndex);
  }
}
