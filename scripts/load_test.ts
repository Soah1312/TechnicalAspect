/**
 * Crescendo Fuel Rush — 100 Concurrent Racers Load Test Simulation
 *
 * Simulates 100 concurrent mobile racers connecting over Wi-Fi / cellular data,
 * testing anonymous auth sessions, config polling, leaderboard fetches,
 * race registration, questions, answers, and lap submission concurrency.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://bsaucqmsrxwibdvtrujb.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzYXVjcW1zcnh3aWJkdnRydWpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NzIwNDgsImV4cCI6MjEwODM0ODA0OH0.f4EqaUEOOEbyKx_VSvkslBEg1G3gxcUYw_-i7iT-WzA';

const CONCURRENT_RACERS = 100;

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

  // 3. Pre-join Leaderboard check
  await recordMetric('get_leaderboard', async () => {
    const { data, error } = await client.rpc('get_leaderboard', { p_limit: 10 });
    if (error) throw new Error(error.message);
    return data;
  });

  // 4. Join Race (names must contain only alphanumeric and spaces)
  const racerName = `Racer ${String(racerIndex).padStart(3, '0')}`;
  const joinRes = await recordMetric('join_race', async () => {
    const { data, error } = await client.rpc('join_race', { p_name: racerName });
    if (error) throw new Error(error.message);
    return data;
  });

  // 5. If race is active, simulate quiz loop and laps
  if (!joinRes.error) {
    // Request Question
    const qRes = await recordMetric('request_question', async () => {
      const { data, error } = await client.rpc('request_question');
      if (error) throw new Error(error.message);
      return data as { questionId: string; options: string[] };
    });

    if (qRes.result?.questionId) {
      // Submit Answer
      await recordMetric('submit_answer', async () => {
        const { data, error } = await client.rpc('submit_answer', {
          p_question_id: qRes.result!.questionId,
          p_option_index: 0,
        });
        if (error) throw new Error(error.message);
        return data;
      });
    }

    // Submit Lap
    await recordMetric('submit_lap', async () => {
      const { data, error } = await client.rpc('submit_lap', {
        p_lap_number: 1,
        p_lap_time_ms: 45000 + Math.floor(Math.random() * 5000),
      });
      if (error) throw new Error(error.message);
      return data;
    });
  }

  // 6. Post-race / Live Leaderboard refresh (concurrent read test)
  await recordMetric('get_leaderboard', async () => {
    const { data, error } = await client.rpc('get_leaderboard', { p_limit: 10 });
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
  console.log('🏎️  CRESCENDO FUEL RUSH — 100 CONCURRENT PLAYERS LOAD TEST');
  console.log(`🎯 Target Supabase Endpoint: ${SUPABASE_URL}`);
  console.log(`👥 Concurrency Level: ${CONCURRENT_RACERS} simultaneous racers`);
  console.log('================================================================\n');

  const overallStart = performance.now();

  console.log(`[LoadTest] Spawning ${CONCURRENT_RACERS} simultaneous racers...`);

  // Run in chunks of 25 with small jitter to mimic realistic flashmob QR code scans
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

  // Group metrics by RPC
  const grouped: Record<string, { durations: number[]; errors: number }> = {};
  for (const m of metrics) {
    if (!grouped[m.rpc]) {
      grouped[m.rpc] = { durations: [], errors: 0 };
    }
    grouped[m.rpc].durations.push(m.durationMs);
    if (!m.success) {
      grouped[m.rpc].errors++;
    }
  }

  console.log('-----------------------------------------------------------------------------------------');
  console.log('| RPC Call             | Calls | Errors | Min (ms) | Med p50 | 95th p95 | 99th p99 | Max (ms) |');
  console.log('-----------------------------------------------------------------------------------------');

  let totalCalls = 0;
  let totalErrors = 0;

  for (const [rpc, data] of Object.entries(grouped)) {
    const count = data.durations.length;
    const errors = data.errors;
    totalCalls += count;
    totalErrors += errors;

    const min = Math.round(Math.min(...data.durations));
    const max = Math.round(Math.max(...data.durations));
    const p50 = calculatePercentile(data.durations, 50);
    const p95 = calculatePercentile(data.durations, 95);
    const p99 = calculatePercentile(data.durations, 99);

    console.log(
      `| ${rpc.padEnd(20)} | ${String(count).padStart(5)} | ${String(errors).padStart(6)} | ${String(min).padStart(8)} | ${String(p50).padStart(7)} | ${String(p95).padStart(8)} | ${String(p99).padStart(8)} | ${String(max).padStart(8)} |`
    );
  }

  console.log('-----------------------------------------------------------------------------------------');
  const throughput = (totalCalls / totalElapsedSec).toFixed(1);
  console.log(`Total Requests: ${totalCalls} | Errors: ${totalErrors} | Throughput: ${throughput} req/s\n`);

  // Report errors if any
  const failedSamples = metrics.filter((m) => !m.success);
  if (failedSamples.length > 0) {
    const distinctErrors = Array.from(new Set(failedSamples.map((s) => s.error)));
    console.log('Observed API Warnings / Responses:');
    for (const err of distinctErrors) {
      console.log(`  - ${err}`);
    }
    console.log('');
  }
}

runLoadTest().catch((err) => {
  console.error('Fatal load test runner error:', err);
  process.exit(1);
});
