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

  public async fetchQuestion(): Promise<Question> {
    return this.api.requestQuestion();
  }

  public async answerQuestion(questionId: string, optionIndex: number): Promise<AnswerResult> {
    return this.api.submitAnswer(questionId, optionIndex);
  }
}
