import { describe, it, expect, vi } from 'vitest';
import { SupabaseApi } from './supabaseApi';
import { networkMonitor } from '../util/network';

describe('Stage 5 Hardening & Resilience Tests', () => {
  it('returns graceful stale snapshot if leaderboard fetch fails or network drops', async () => {
    const api = new SupabaseApi();
    vi.spyOn(api, 'ensureAuth').mockResolvedValue('test-user-id');

    // Mock client.rpc to reject (simulating network failure or 10s timeout)
    const mockClient = (api as unknown as { client: { rpc: () => Promise<unknown> } }).client;
    vi.spyOn(mockClient, 'rpc').mockRejectedValue(new Error('Network timeout after 10000ms'));

    const snapshot = await api.getLeaderboard();
    expect(snapshot).toBeDefined();
    expect(snapshot.isStale).toBe(true);
    expect(Array.isArray(snapshot.top)).toBe(true);
  });

  it('preserves cached leaderboard data and marks it stale during network blackout', async () => {
    const api = new SupabaseApi();
    vi.spyOn(api, 'ensureAuth').mockResolvedValue('test-user-id');

    // 1. Successful first fetch
    const mockClient = (api as unknown as { client: { rpc: (fn: string) => Promise<{ data: unknown; error: unknown }> } }).client;
    vi.spyOn(mockClient, 'rpc').mockImplementation(async (fn: string) => {
      if (fn === 'get_leaderboard') {
        return {
          data: {
            top: [
              { rank: 1, name: 'SpeedyRacer', laps: 12, correct: 8, isMe: false },
              { rank: 2, name: 'FlashMobber', laps: 10, correct: 6, isMe: true },
            ],
            me: { rank: 2, name: 'FlashMobber', laps: 10, correct: 6, isMe: true },
            totalPlayers: 25,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const firstSnap = await api.getLeaderboard();
    expect(firstSnap.isStale).toBe(false);
    expect(firstSnap.top.length).toBe(2);
    expect(firstSnap.top[0].name).toBe('SpeedyRacer');

    // 2. Network blackout: rpc throws
    vi.spyOn(mockClient, 'rpc').mockRejectedValue(new Error('Connection lost'));

    const blackoutSnap = await api.getLeaderboard();
    expect(blackoutSnap.isStale).toBe(true);
    expect(blackoutSnap.top.length).toBe(2);
    expect(blackoutSnap.top[0].name).toBe('SpeedyRacer');
    expect(blackoutSnap.me?.rank).toBe(2);
  });

  it('holds lap submissions in FIFO queue when offline and flushes cleanly on reconnect', async () => {
    const api = new SupabaseApi();
    vi.spyOn(api, 'ensureAuth').mockResolvedValue('test-user-id');
    const mockClient = (api as unknown as { client: { rpc: (fn: string, params: unknown) => Promise<{ data: unknown; error: unknown }> } }).client;

    const rpcCalls: Array<{ fn: string; params: unknown }> = [];
    vi.spyOn(mockClient, 'rpc').mockImplementation(async (fn: string, params: unknown) => {
      rpcCalls.push({ fn, params });
      return {
        data: { accepted: true, laps: (params as { p_lap_number: number }).p_lap_number },
        error: null,
      };
    });

    // Simulate offline state
    vi.spyOn(networkMonitor, 'isOnline').mockReturnValue(false);

    // Enqueue 3 laps while offline
    const lap1Promise = api.submitLap(1, 45000);
    const lap2Promise = api.submitLap(2, 46000);
    const lap3Promise = api.submitLap(3, 44000);

    // Since offline, no rpc calls should have been made yet
    expect(rpcCalls.length).toBe(0);

    // Network restored
    vi.spyOn(networkMonitor, 'isOnline').mockReturnValue(true);
    api.flushLapQueue();

    const [res1, res2, res3] = await Promise.all([lap1Promise, lap2Promise, lap3Promise]);

    expect(res1.accepted).toBe(true);
    expect(res2.accepted).toBe(true);
    expect(res3.accepted).toBe(true);

    // Verified strict FIFO order (Lap 1, then Lap 2, then Lap 3)
    expect(rpcCalls.length).toBe(3);
    expect((rpcCalls[0].params as { p_lap_number: number }).p_lap_number).toBe(1);
    expect((rpcCalls[1].params as { p_lap_number: number }).p_lap_number).toBe(2);
    expect((rpcCalls[2].params as { p_lap_number: number }).p_lap_number).toBe(3);
  });
});
