import { describe, it, expect, beforeEach } from 'vitest';
import { FuelSystem } from './fuel';
import { MockApi } from '../api/mockApi';
import { MOCK_QUESTIONS } from '../api/mockQuestions';

describe('PART 1 — Exact +10s Fuel and Removed Pit Tests', () => {
  describe('FuelSystem Exact +10s Addition & Unclamped Scale', () => {
    it.each([0, 1, 5000, 9999])(
      'when fuel before is %d ms, adding 10000 ms results in exactly before + 10000 ms (no clamp to tank_max_ms)',
      (initialMs) => {
        const fuel = new FuelSystem(initialMs, 10000);
        expect(fuel.getFuelMs()).toBe(initialMs);

        fuel.addFuel(10000);
        expect(fuel.getFuelMs()).toBe(initialMs + 10000);
      }
    );

    it('fuel bar scale is max(tank_max_ms, currentFuel) so ratio never exceeds 1.0', () => {
      const fuel = new FuelSystem(10000, 10000);
      expect(fuel.getRatio()).toBe(1.0);

      // Add another 10,000ms (total 20,000ms)
      fuel.addFuel(10000);
      expect(fuel.getFuelMs()).toBe(20000);
      // scale = max(10000, 20000) = 20000, ratio = 20000 / 20000 = 1.0
      expect(fuel.getRatio()).toBe(1.0);

      // Drain 5000ms (remaining 15000ms)
      fuel.update(5000, 50);
      expect(fuel.getFuelMs()).toBe(15000);
      // scale = max(10000, 15000) = 15000, ratio = 15000 / 15000 = 1.0
      expect(fuel.getRatio()).toBe(1.0);

      // Drain down to 5000ms (scale is now tank_max_ms = 10000, ratio = 0.5)
      fuel.update(10000, 50);
      expect(fuel.getFuelMs()).toBe(5000);
      expect(fuel.getRatio()).toBe(0.5);
    });

    it('fuel never drops below 0 when drained excessively', () => {
      const fuel = new FuelSystem(2000, 10000);
      fuel.update(5000, 50);
      expect(fuel.getFuelMs()).toBe(0);
      expect(fuel.isEmpty()).toBe(true);
    });

    it('fuel does not drain when car is stationary (speed <= 5 px/s)', () => {
      const fuel = new FuelSystem(10000, 10000);
      fuel.update(2000, 0);
      expect(fuel.getFuelMs()).toBe(10000);
      fuel.update(2000, 4);
      expect(fuel.getFuelMs()).toBe(10000);
    });

    it('triggers low fuel warning below 25% or <= 3s', () => {
      const fuel = new FuelSystem(3100, 10000);
      expect(fuel.isLowFuel()).toBe(false);

      fuel.update(200, 50); // fuel becomes 2900ms <= 3000ms
      expect(fuel.isLowFuel()).toBe(true);
    });
  });

  describe('MockApi Exact 10s Fuel & Anti-Farming Rule', () => {
    let api: MockApi;

    beforeEach(async () => {
      api = new MockApi(false);
      await api.joinRace('TestDriver', 'COMPS', 1);
    });

    it('correct answer adds exactly 10,000 ms to fuelGrantedMs', async () => {
      const q = await api.requestQuestion();
      const orig = MOCK_QUESTIONS.find((item) => item.id === q.questionId)!;
      const correctText = orig.options[orig.correctIndex];
      const correctIdx = q.options.indexOf(correctText);

      const res = await api.submitAnswer(q.questionId, correctIdx);
      expect(res.correct).toBe(true);
      expect(res.fuelGrantedMs).toBe(10000);
    });

    it('retried submit_answer returns identical result without double-adding fuel', async () => {
      const q = await api.requestQuestion();
      const orig = MOCK_QUESTIONS.find((item) => item.id === q.questionId)!;
      const correctText = orig.options[orig.correctIndex];
      const correctIdx = q.options.indexOf(correctText);

      const first = await api.submitAnswer(q.questionId, correctIdx);
      const retry = await api.submitAnswer(q.questionId, correctIdx);

      expect(retry.correct).toBe(true);
      expect(retry.fuelGrantedMs).toBe(10000);
      expect(retry.correctTotal).toBe(first.correctTotal);
    });

    it('wrong answer and timeout grant exactly 0 fuel', async () => {
      const q1 = await api.requestQuestion();
      // Timeout by passing optionIndex -1
      const timeoutRes = await api.submitAnswer(q1.questionId, -1);
      expect(timeoutRes.correct).toBe(false);
      expect(timeoutRes.fuelGrantedMs).toBe(0);
      expect(timeoutRes.timedOut).toBe(true);
    });

    it('request_question is rejected with TOO_SOON right after a correct answer, and accepted after 0.8 * 10s', async () => {
      const now = Date.now();
      const q = await api.requestQuestion(now);
      const orig = MOCK_QUESTIONS.find((item) => item.id === q.questionId)!;
      const correctText = orig.options[orig.correctIndex];
      const correctIdx = q.options.indexOf(correctText);

      const res = await api.submitAnswer(q.questionId, correctIdx, now);
      expect(res.correct).toBe(true);

      // Immediate request: rejected with TOO_SOON
      const immediateQ = await api.requestQuestion(now + 100);
      expect(immediateQ.status).toBe('TOO_SOON');
      expect(immediateQ.waitMs).toBeGreaterThan(0);
      expect(immediateQ.waitMs).toBeLessThanOrEqual(8000);

      // After 8000ms: accepted
      const acceptedQ = await api.requestQuestion(now + 8050);
      expect(acceptedQ.status).toBeUndefined();
      expect(acceptedQ.questionId).toBeTruthy();
      expect(acceptedQ.options.length).toBe(4);
    });
  });
});
