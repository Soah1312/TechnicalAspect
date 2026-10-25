import { describe, it, expect, beforeEach } from 'vitest';
import { MockApi } from './mockApi';
import { calculateLogicalHeight } from '../game/layout';
import { MOCK_QUESTIONS } from './mockQuestions';

describe('Part A - Layout Centering & Answer Reveal Tests', () => {
  let api: MockApi;

  beforeEach(() => {
    api = new MockApi(false);
  });

  describe('A1: Dynamic Logical Canvas Height', () => {
    it('computes 640 for 360x640 standard viewport', () => {
      expect(calculateLogicalHeight(360, 640)).toBe(640);
    });

    it('computes ~779 for 390x844 tall iPhone viewport with zero letterboxing', () => {
      const h = calculateLogicalHeight(390, 844);
      expect(h).toBe(779);
      // Canvas aspect ratio (360/779) matches screen aspect ratio (390/844) within 0.001
      expect(Math.abs(360 / h - 390 / 844)).toBeLessThan(0.002);
    });

    it('computes ~800 for 412x915 modern Android viewport', () => {
      const h = calculateLogicalHeight(412, 915);
      expect(h).toBe(800);
    });

    it('clamps to bounds [560, 860] on extreme short and tall screens', () => {
      expect(calculateLogicalHeight(360, 480)).toBe(560); // Clamped minimum
      expect(calculateLogicalHeight(360, 1200)).toBe(860); // Clamped maximum
    });
  });

  describe('A2: Correct Answer Reveal & Anti-Leak Guarantees', () => {
    it('request_question, get_config and get_leaderboard never expose correct answer index', async () => {
      await api.joinRace('SecurityDriver');
      const q = await api.requestQuestion();
      const rawQ = q as unknown as Record<string, unknown>;
      expect(rawQ.correctIndex).toBeUndefined();
      expect(rawQ.correct_index).toBeUndefined();
      expect(rawQ.answer).toBeUndefined();

      const cfg = await api.getConfig();
      const rawCfg = cfg as unknown as Record<string, unknown>;
      expect(rawCfg.correctIndex).toBeUndefined();

      const lb = await api.getLeaderboard();
      const rawLb = lb as unknown as Record<string, unknown>;
      expect(rawLb.correctIndex).toBeUndefined();
    });

    it('correct answer never reveals correctIndex or explanation', async () => {
      await api.joinRace('CleverDriver');
      const q = await api.requestQuestion();
      
      // Find the correct option in shuffled options
      const orig = MOCK_QUESTIONS.find((item) => item.id === q.questionId)!;
      const correctText = orig.options[orig.correctIndex];
      const correctIdx = q.options.indexOf(correctText);

      const res = await api.submitAnswer(q.questionId, correctIdx);
      expect(res.correct).toBe(true);
      expect(res.correctIndex).toBeUndefined();
      expect(res.explanation).toBeUndefined();
      expect(res.fuelGrantedMs).toBeGreaterThan(0);
    });

    it('wrong answer reveals correctIndex only for the answered question, gated by feature_answer_reveal', async () => {
      await api.joinRace('RookieDriver');
      const q = await api.requestQuestion();

      const orig = MOCK_QUESTIONS.find((item) => item.id === q.questionId)!;
      const correctText = orig.options[orig.correctIndex];
      const correctIdx = q.options.indexOf(correctText);
      const wrongIdx = (correctIdx + 1) % 4;

      const res = await api.submitAnswer(q.questionId, wrongIdx);
      expect(res.correct).toBe(false);
      expect(res.correctIndex).toBe(correctIdx);
      expect(res.timedOut).toBe(false);
    });

    it('timeout submission reveals correctIndex and timedOut=true', async () => {
      await api.joinRace('TimeoutDriver');
      const q = await api.requestQuestion();

      const orig = MOCK_QUESTIONS.find((item) => item.id === q.questionId)!;
      const correctText = orig.options[orig.correctIndex];
      const correctIdx = q.options.indexOf(correctText);

      const res = await api.submitAnswer(q.questionId, -1);
      expect(res.correct).toBe(false);
      expect(res.timedOut).toBe(true);
      expect(res.correctIndex).toBe(correctIdx);
    });

    it('calling submit_answer twice returns identical stored result and does not double-count', async () => {
      await api.joinRace('RepeatDriver');
      const q = await api.requestQuestion();

      const orig = MOCK_QUESTIONS.find((item) => item.id === q.questionId)!;
      const correctText = orig.options[orig.correctIndex];
      const correctIdx = q.options.indexOf(correctText);
      const wrongIdx = (correctIdx + 1) % 4;

      const res1 = await api.submitAnswer(q.questionId, wrongIdx);
      const res2 = await api.submitAnswer(q.questionId, wrongIdx);

      expect(res1).toEqual(res2);
      expect(res2.correctIndex).toBe(correctIdx);
    });
  });
});
