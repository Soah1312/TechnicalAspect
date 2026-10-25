/**
 * Crescendo Fuel Rush — 120 Concurrent Racers Load Test Simulation
 *
 * Simulates 120 concurrent mobile racers across all 5 branches and 4 years,
 * testing anonymous auth sessions, config polling, scoped leaderboard fetches
 * (ALL, BRANCH, YEAR), race registration, question generation, and lap submission concurrency.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://bsaucqmsrxwibdvtrujb.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzYXVjcW1zcnh3aWJkdnRydWpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NzIwNDgsImV4cCI6MjEwODM0ODA0OH0.f4EqaUEOOEbyKx_VSvkslBEg1G3gxcUYw_-i7iT-WzA';

const CONCURRENT_RACERS = 120;
const BRANCHES = ['COMPS', 'CSE', 'ECS', 'MECH', 'AIDS'] as const;

interface MetricSample {
  rpc: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

const metrics: MetricSample[] = [];

// In-memory mock storage so each simulated racer gets an isolated anonymous session
class MemoryStorage {
  private store: Record<string, string> = {};
  getItem(key: string): string | null {
    return this.store[key] || null;
  }
  setItem(key: string, value: string): void {
    this.store[key] = value;
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
}

async function recordMetric<T>(
  rpcName: string,
  fn: () => Promise<T>
): Promise<{ result?: T; error?: string }> {
  const start = performance.now();
  try {
    const res = await fn();
    const duration = performance.now() - start;
    metrics.push({ rpc: rpcName, durationMs: duration, success: true });
    return { result: res };
  } catch (err: unknown) {
    const duration = performance.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    metrics.push({ rpc: rpcName, durationMs: duration, success: false, error: msg });
    return { error: msg };
  }
}

async function simulateRacer(racerIndex: number): Promise<void> {
  const storage = new MemoryStorage();
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const branch = BRANCHES[racerIndex % BRANCHES.length];
  const year = branch === 'AIDS' ? 4 : ((racerIndex % 4) + 1);

  // 1. Anonymous Authentication
  await recordMetric('auth.signInAnonymously', async () => {
    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw new Error(error.message);
    return data;
  });

  // 2. Initial Config & Server Time
  await recordMetric('get_config', async () => {
    const { data, error } = await client.rpc('get_config');
    if (error) throw new Error(error.message);
    return data;
  });

  await recordMetric('get_server_time', async () => {
    const { data, error } = await client.rpc('get_server_time');
    if (error) throw new Error(error.message);
    return data;
  });

  // 3. Pre-join Scoped Leaderboard check
  await recordMetric('get_leaderboard(ALL)', async () => {
    const { data, error } = await client.rpc('get_leaderboard', { p_limit: 10, p_scope: 'ALL' });
    if (error) throw new Error(error.message);
    return data;
  });

  // 4. Join Race with Branch & Year Profile
  const racerName = `Racer ${String(racerIndex).padStart(3, '0')}`;
  const joinRes = await recordMetric('join_race', async () => {
    const { data, error } = await client.rpc('join_race', {
      p_name: racerName,
      p_branch: branch,
      p_year: year,
    });
    if (error) throw new Error(error.message);
    return data;
  });

  // 5. Simulate Quiz Loop and Laps
  if (!joinRes.error) {
    // Request Question (Exercises B4 branch & difficulty selection)
    const qRes = await recordMetric('request_question', async () => {
      const { data, error } = await client.rpc('request_question');
      if (error) throw new Error(error.message);
      return data as { questionId: string; options: string[]; difficulty?: number };
    });

    if (qRes.result?.questionId) {
      // Submit Answer
      await recordMetric('answer_question', async () => {
        const { data, error } = await client.rpc('answer_question', {
          p_question_id: qRes.result!.questionId,
          p_option_index: 0,
        });
        if (error) throw new Error(error.message);
        return data;
      });
    }

    // Submit Lap (Validated with dynamic minLapMs)
    await recordMetric('submit_lap', async () => {
      const { data, error } = await client.rpc('submit_lap', {
        p_lap_number: 1,
        p_lap_time_ms: 36000 + Math.floor(Math.random() * 4000),
      });
      if (error) throw new Error(error.message);
      return data;
    });
  }

  // 6. Post-race Scoped Leaderboards (BRANCH and YEAR)
  await recordMetric('get_leaderboard(BRANCH)', async () => {
    const { data, error } = await client.rpc('get_leaderboard', { p_limit: 10, p_scope: 'BRANCH' });
    if (error) throw new Error(error.message);
    return data;
  });

  await recordMetric('get_leaderboard(YEAR)', async () => {
    const { data, error } = await client.rpc('get_leaderboard', { p_limit: 10, p_scope: 'YEAR' });
    if (error) throw new Error(error.message);
    return data;
  });
}

function calculatePercentile(samples: number[], percentile: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((percentile / 100) * sorted.length));
  return Math.round(sorted[index]);
}

async function runLoadTest(): Promise<void> {
  console.log('================================================================');
  console.log('🏎️  CRESCENDO FUEL RUSH — 120 CONCURRENT PLAYERS LOAD TEST');
  console.log(`🎯 Target Supabase Endpoint: ${SUPABASE_URL}`);
  console.log(`👥 Concurrency Level: ${CONCURRENT_RACERS} simultaneous racers across 5 branches`);
  console.log('================================================================\n');

  const overallStart = performance.now();

  console.log(`[LoadTest] Spawning ${CONCURRENT_RACERS} simultaneous racers...`);

  const racerPromises: Promise<void>[] = [];
  for (let i = 1; i <= CONCURRENT_RACERS; i++) {
    const delay = Math.floor(Math.random() * 800); // 0-800ms natural jitter
    racerPromises.push(
      new Promise((resolve) => setTimeout(resolve, delay)).then(() => simulateRacer(i))
    );
  }

  await Promise.all(racerPromises);
  const totalElapsedSec = (performance.now() - overallStart) / 1000;

  console.log(`\n✅ Completed in ${totalElapsedSec.toFixed(2)}s\n`);

  // Analyze metrics per RPC
  const rpcs = Array.from(new Set(metrics.map((m) => m.rpc)));
  console.log('-----------------------------------------------------------------------------------------');
  console.log('RPC / CALL                 TOTAL   SUCCESS   FAIL   ERR %    P50 (ms)   P95 (ms)   MAX (ms)');
  console.log('-----------------------------------------------------------------------------------------');

  for (const rpc of rpcs) {
    const samples = metrics.filter((m) => m.rpc === rpc);
    const successCount = samples.filter((m) => m.success).length;
    const failCount = samples.length - successCount;
    const errRate = ((failCount / samples.length) * 100).toFixed(1);
    const durations = samples.map((m) => m.durationMs);

    const p50 = calculatePercentile(durations, 50);
    const p95 = calculatePercentile(durations, 95);
    const max = Math.round(Math.max(...durations));

    const rpcCol = rpc.padEnd(26);
    const totalCol = String(samples.length).padStart(6);
    const succCol = String(successCount).padStart(8);
    const failCol = String(failCount).padStart(7);
    const errCol = `${errRate}%`.padStart(8);
    const p50Col = `${p50}ms`.padStart(11);
    const p95Col = `${p95}ms`.padStart(11);
    const maxCol = `${max}ms`.padStart(10);

    console.log(`${rpcCol} ${totalCol} ${succCol} ${failCol} ${errCol} ${p50Col} ${p95Col} ${maxCol}`);
  }

  console.log('-----------------------------------------------------------------------------------------');

  const totalCalls = metrics.length;
  const totalFails = metrics.filter((m) => !m.success).length;
  const overallErrRate = ((totalFails / totalCalls) * 100).toFixed(2);
  const throughput = (totalCalls / totalElapsedSec).toFixed(1);

  console.log(`\n📊 SUMMARY:`);
  console.log(`• Total RPC Calls Executed: ${totalCalls}`);
  console.log(`• Global Error Rate: ${overallErrRate}% (${totalFails} failed)`);
  console.log(`• Average Throughput: ${throughput} req/s`);

  if (totalFails > 0) {
    console.log('\nSample Failures:');
    const fails = metrics.filter((m) => !m.success).slice(0, 5);
    fails.forEach((f) => console.log(`  - [${f.rpc}]: ${f.error}`));
  }
}

runLoadTest().catch(console.error);
