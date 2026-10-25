import { describe, it, expect, beforeEach } from 'vitest';
import { MockApi } from './mockApi';
import { createClient } from '@supabase/supabase-js';

describe('Stage 4 Server-Side Validation & Security Rules', () => {
  let api: MockApi;

  beforeEach(() => {
    api = new MockApi(false);
  });

  describe('Security & Data Leak Prevention', () => {
    it('RPC request_question never exposes correct answer index or text in payload', async () => {
      await api.joinRace('SecurityDriver');
      const q = await api.requestQuestion();

      const raw = q as unknown as Record<string, unknown>;
      expect(raw.correct_index).toBeUndefined();
      expect(raw.correctIndex).toBeUndefined();
      expect(raw.answer).toBeUndefined();
      expect(raw.correctAnswer).toBeUndefined();
      expect(raw.solution).toBeUndefined();
      expect(q.options).toHaveLength(4);
    });

    it('Direct table access with anon key fails (RLS table lock verification)', async () => {
      const url = 'https://bsaucqmsrxwibdvtrujb.supabase.co';
      const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzYXVjcW1zcnh3aWJkdnRydWpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NzIwNDgsImV4cCI6MjEwODM0ODA0OH0.f4EqaUEOOEbyKx_VSvkslBEg1G3gxcUYw_-i7iT-WzA';
      const client = createClient(url, anonKey);

      // Attempting to select from questions table directly with anon key must fail or return empty due to RLS
      const { data, error } = await client.from('questions').select('*');
      if (error) {
        expect(error).toBeDefined();
      } else {
        expect(data).toHaveLength(0);
      }

      // Attempting to select from issued_questions table
      const { data: issuedData, error: issuedErr } = await client.from('issued_questions').select('*');
      if (issuedErr) {
        expect(issuedErr).toBeDefined();
      } else {
        expect(issuedData).toHaveLength(0);
      }
    }, 15000);
  });

  describe('Lap Rejection Rules (a to e)', () => {
    it('Rejects lap if lapNumber is not sequential: (a) p_lap_number != laps + 1', async () => {
      await api.joinRace('LapTesterA');
      api.addFuel(60000);
      api.setJoinedAt(Date.now() - 40000);
      // Submitting lap 2 when laps = 0
      const res = await api.submitLap(2, 38000);
      expect(res.accepted).toBe(false);
      expect(res.reason).toMatch(/sequence/i);
    });

    it('Rejects lap if lapTimeMs is below minLapMs: (b) p_lap_time_ms < min_lap_ms', async () => {
      await api.joinRace('LapTesterB');
      api.addFuel(60000);
      api.setJoinedAt(Date.now() - 40000);
      // minLapMs is 36000, submitting 15000
      const res = await api.submitLap(1, 15000);
      expect(res.accepted).toBe(false);
      expect(res.reason).toMatch(/minimum/i);
    });

    it('Rejects lap if submitted too quickly since last lap: (c) < 0.9 * min_lap_ms', async () => {
      await api.joinRace('LapTesterC');
      api.addFuel(100000);
      api.setJoinedAt(Date.now() - 40000);
      // First lap is accepted
      const res1 = await api.submitLap(1, 38000);
      expect(res1.accepted).toBe(true);

      // Immediately submitting lap 2 with 0 elapsed real-time
      const res2 = await api.submitLap(2, 38000);
      expect(res2.accepted).toBe(false);
      expect(res2.reason).toMatch(/quickly/i);
    });

    it('Rejects lap if total laps exceed earned fuel: (d) (laps + 1) * minLapMs > fuelGrantedMs * 1.05', async () => {
      await api.joinRace('FuelTesterD');
      api.setJoinedAt(Date.now() - 40000);
      // Player initial fuel is 30000ms. 1 * 36000 > 30000 * 1.05 = 31500
      const res = await api.submitLap(1, 38000);
      expect(res.accepted).toBe(false);
      expect(res.reason).toMatch(/fuel/i);
    });

    it('Rejects lap if race window is closed or ended: (e)', async () => {
      await api.joinRace('ClosedTesterE');
      api.addFuel(60000);
      api.setConfig({ isOpen: false });

      const res = await api.submitLap(1, 38000);
      expect(res.accepted).toBe(false);
      expect(res.reason).toMatch(/closed/i);
    });
  });

  describe('Question Timeout, Lockouts & Idempotency', () => {
    it('Treats answer submitted after timeout as wrong and applies lockout', async () => {
      await api.joinRace('TimeoutDriver');
      const q = await api.requestQuestion();

      // Submit after questionTimeMs + 5000ms
      const res = await api.submitAnswer(q.questionId, 0, Date.now() + 20000);
      expect(res.correct).toBe(false);
      expect(res.fuelGrantedMs).toBe(0);
    });

    it('Rejects request_question while player is locked out', async () => {
      await api.joinRace('LockoutDriver');
      const q = await api.requestQuestion();

      // Submit wrong answer to trigger lockout
      await api.submitAnswer(q.questionId, 999);

      // Immediately requesting another question should fail during lockout
      await expect(api.requestQuestion()).rejects.toThrow(/locked out/i);
    });

    it('Handles repeated submission of already-answered question idempotently', async () => {
      await api.joinRace('IdempotentDriver');
      const q = await api.requestQuestion();

      const res1 = await api.submitAnswer(q.questionId, 0);
      // Repeated identical call (e.g. network retry)
      const res2 = await api.submitAnswer(q.questionId, 0);

      expect(res2.correct).toBe(res1.correct);
      expect(res2.laps).toBe(res1.laps);
      expect(res2.correctTotal).toBe(res1.correctTotal);
    });
  });
});
