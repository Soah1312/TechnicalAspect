import { afterEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  rpc, auth: { getSession: async () => ({ data: { session: { user: { id: 'test' } } } }) },
}) }));
import { SupabaseApi } from './supabaseApi';

afterEach(() => { vi.useRealTimers(); rpc.mockReset(); });
const row = { rank: 1, name: 'Racer', laps: 2, correct: 5, isMe: true };
const data = { top: [row], me: row, totalPlayers: 1 };

describe('Production API contracts', () => {
  it('keeps offline caches isolated by leaderboard scope', async () => {
    vi.useFakeTimers();
    const api = new SupabaseApi();
    rpc.mockResolvedValue({ data, error: null });
    await api.getLeaderboard('ALL');
    rpc.mockRejectedValue(new Error('offline'));
    const branch = api.getLeaderboard('BRANCH');
    await vi.runAllTimersAsync();
    expect(await branch).toMatchObject({ top: [], scope: 'BRANCH', isStale: true });
    const all = api.getLeaderboard('ALL');
    await vi.runAllTimersAsync();
    expect(await all).toMatchObject({ top: [expect.objectContaining({ name: 'Racer' })], scope: 'ALL', isStale: true });
  });

  it('passes anti-farming wait responses through to the pit retry logic', async () => {
    const api = new SupabaseApi();
    rpc.mockResolvedValue({ data: { status: 'TOO_SOON', waitMs: 1200 }, error: null });
    expect(await api.requestQuestion()).toMatchObject({ status: 'TOO_SOON', waitMs: 1200 });
  });

  it('calls the current answer RPC and sends integer lap times', async () => {
    const api = new SupabaseApi();
    rpc.mockResolvedValue({ data: { correct: true, fuelGrantedMs: 10000, laps: 1, correctTotal: 1 }, error: null });
    await api.submitAnswer('question', 2);
    expect(rpc).toHaveBeenCalledWith('answer_question', { p_question_id: 'question', p_option_index: 2 });
    rpc.mockResolvedValue({ data: { accepted: true, laps: 1 }, error: null });
    await api.submitLap(1, 40000.1234);
    expect(rpc).toHaveBeenLastCalledWith('submit_lap', { p_lap_number: 1, p_lap_time_ms: 40000 });
  });
});
