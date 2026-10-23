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

    const q = await api.requestQuestion();

    // In the mock question bank, find the original question text
    const original = MOCK_QUESTIONS.find((item) => item.id === q.questionId)!;
    const correctText = original.options[original.correctIndex];

    // Find which index the correctText got shuffled to in q.options
    const correctShuffledIndex = q.options.indexOf(correctText);

    // First submit wrong answer on a duplicate request or another question
    const qWrong = await api.requestQuestion();
    const wrongOriginal = MOCK_QUESTIONS.find((item) => item.id === qWrong.questionId)!;
    const wrongCorrectText = wrongOriginal.options[wrongOriginal.correctIndex];
    const wrongIndex = (qWrong.options.indexOf(wrongCorrectText) + 1) % 4;

    const wrongResult = await api.submitAnswer(qWrong.questionId, wrongIndex);
    expect(wrongResult.correct).toBe(false);
    expect(wrongResult.fuelGrantedMs).toBe(0);

    // Now submit correct answer on q
    const correctResult = await api.submitAnswer(q.questionId, correctShuffledIndex);
    expect(correctResult.correct).toBe(true);
    expect(correctResult.fuelGrantedMs).toBeGreaterThan(0);
    expect(correctResult.correctTotal).toBe(1);
  });

  it('cycles through unseen questions without immediate repetition', async () => {
    const api = new MockApi(false);
    const seenIds = new Set<string>();

    // Request 60 questions
    for (let i = 0; i < 60; i++) {
      const q = await api.requestQuestion();
      expect(seenIds.has(q.questionId)).toBe(false);
      seenIds.add(q.questionId);
    }
    expect(seenIds.size).toBe(60);

    // 61st question recycles
    const q61 = await api.requestQuestion();
    expect(q61).toBeDefined();
  });
});
