import { describe, it, expect } from 'vitest';
import { MockApi } from './mockApi';
import { MOCK_QUESTIONS } from './mockQuestions';

describe('MockApi Quiz & Security Tests', () => {
  it('never sends correct answers or answer indices to the client', async () => {
    const api = new MockApi(false);
    const q = await api.requestQuestion();

    // Check Question contract shape
    expect(q).toHaveProperty('questionId');
    expect(q).toHaveProperty('text');
    expect(q).toHaveProperty('options');
    expect(q.options).toHaveLength(4);

    // CRITICAL: Ensure no answer-related properties exist on the object
    const untyped = q as unknown as Record<string, unknown>;
    expect(untyped['correctIndex']).toBeUndefined();
    expect(untyped['correct_index']).toBeUndefined();
    expect(untyped['answer']).toBeUndefined();
    expect(untyped['correctAnswer']).toBeUndefined();
    expect(untyped['answerIndex']).toBeUndefined();
  });

  it('evaluates answers correctly and only grants fuel on correct answer', async () => {
    const api = new MockApi(false);
    await api.joinRace('TestDriver');

    // 1. Request first question and submit wrong answer
    const q1 = await api.requestQuestion();
    const orig1 = MOCK_QUESTIONS.find((item) => item.id === q1.questionId)!;
    const correctText1 = orig1.options[orig1.correctIndex];
    const wrongIdx = (q1.options.indexOf(correctText1) + 1) % 4;

    const wrongResult = await api.submitAnswer(q1.questionId, wrongIdx);
    expect(wrongResult.correct).toBe(false);
    expect(wrongResult.fuelGrantedMs).toBe(0);
    expect(wrongResult.correctTotal).toBe(0);

    // Clear lockout so we can request the next question
    api.setConfig({ wrongLockoutMs: 0 });
    api.clearLockout();

    // 2. Request second question and submit correct answer
    const q2 = await api.requestQuestion();
    expect(q2.questionId).not.toBe(q1.questionId);

    const orig2 = MOCK_QUESTIONS.find((item) => item.id === q2.questionId)!;
    const correctText2 = orig2.options[orig2.correctIndex];
    const correctShuffledIdx = q2.options.indexOf(correctText2);

    const correctResult = await api.submitAnswer(q2.questionId, correctShuffledIdx);
    expect(correctResult.correct).toBe(true);
    expect(correctResult.fuelGrantedMs).toBeGreaterThan(0);
    expect(correctResult.correctTotal).toBe(1);
  });

  it('cycles through unseen questions without immediate repetition', async () => {
    const api = new MockApi(false);
    api.setConfig({ wrongLockoutMs: 0, fuelPerCorrectMs: 0 });
    const seenIds = new Set<string>();

    // Request and answer 60 questions
    for (let i = 0; i < 60; i++) {
      const q = await api.requestQuestion();
      expect(seenIds.has(q.questionId)).toBe(false);
      seenIds.add(q.questionId);
      // Answering question allows the next unseen question to be issued
      await api.submitAnswer(q.questionId, 0);
    }
    expect(seenIds.size).toBe(60);

    // 61st question recycles
    const q61 = await api.requestQuestion();
    expect(q61).toBeDefined();
  });
});
