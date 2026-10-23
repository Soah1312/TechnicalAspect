import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  GameApi,
  GameConfig,
  PlayerState,
  Question,
  AnswerResult,
  LapResult,
  LeaderboardSnapshot,
  LeaderboardRow,
} from './types';
import { Storage } from '../util/storage';

interface QueuedLap {
  lapNumber: number;
  lapTimeMs: number;
  resolve: (res: LapResult) => void;
  reject: (err: unknown) => void;
  attempts: number;
}

export class SupabaseApi implements GameApi {
  private client: SupabaseClient;
  private authPromise: Promise<string> | null = null;
  private currentUserId: string | null = null;

  // Lap queue to guarantee FIFO order and resilience against network drops
  private lapQueue: QueuedLap[] = [];
  private isProcessingLapQueue = false;

  // Last cached leaderboard for offline resilience
  private cachedLeaderboard: LeaderboardSnapshot | null = null;

  constructor() {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.warn('[SupabaseApi] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
    }

    this.client = createClient(supabaseUrl || '', supabaseAnonKey || '', {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });

    // Start anonymous auth immediately in background
    this.ensureAuth().catch((err) => {
      console.warn('[SupabaseApi] Initial anonymous auth deferred:', err);
    });
  }

  /**
   * Ensures an active anonymous session exists and returns the user ID
   */
  public async ensureAuth(): Promise<string> {
    if (this.currentUserId) {
      return this.currentUserId;
    }

    if (this.authPromise) {
      return this.authPromise;
    }

    this.authPromise = (async () => {
      // 1. Check existing session
      const { data: sessionData, error: sessionErr } = await this.client.auth.getSession();
      if (!sessionErr && sessionData?.session?.user) {
        this.currentUserId = sessionData.session.user.id;
        return this.currentUserId;
      }

      // 2. Sign in anonymously
      const { data: anonData, error: anonErr } = await this.client.auth.signInAnonymously();
      if (anonErr) {
        if (anonErr.message?.includes('Anonymous sign-ins are disabled') || anonErr.status === 422) {
          throw new Error(
            'Supabase Anonymous Sign-Ins are disabled. Please enable Anonymous sign-in in Supabase Dashboard (Authentication -> Providers -> Anonymous).'
          );
        }
        throw new Error(`Supabase Auth Error: ${anonErr.message}`);
      }

      if (!anonData.user) {
        throw new Error('Supabase Auth failed to return an anonymous user.');
      }

      this.currentUserId = anonData.user.id;
      return this.currentUserId;
    })();

    try {
      return await this.authPromise;
    } finally {
      this.authPromise = null;
    }
  }

  /**
   * Invokes an RPC with a Promise.race timeout
   */
  private async rpcWithTimeout<T>(
    fnName: string,
    params: Record<string, unknown> = {},
    timeoutMs = 5000
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`RPC ${fnName} timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
    });

    try {
      const rpcCall = (async () => {
        const { data, error } = await this.client.rpc(fnName, params);
        if (error) {
          throw new Error(`RPC ${fnName} failed: ${error.message}`);
        }
        return data as T;
      })();

      return await Promise.race([rpcCall, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Get server-authoritative configuration
   */
  public async getConfig(): Promise<GameConfig> {
    const data = await this.rpcWithTimeout<Record<string, unknown>>('get_config', {}, 5000);
    return {
      startAt: Number(data.startAt),
      endAt: Number(data.endAt),
      isOpen: Boolean(data.isOpen),
      tankMaxMs: Number(data.tankMaxMs),
      initialFuelMs: Number(data.initialFuelMs),
      fuelPerCorrectMs: Number(data.fuelPerCorrectMs),
      pitBelowFraction: Number(data.pitBelowFraction),
      questionTimeMs: Number(data.questionTimeMs),
      wrongLockoutMs: Number(data.wrongLockoutMs),
      minLapMs: Number(data.minLapMs),
    };
  }

  /**
   * Get server-authoritative epoch millisecond timestamp
   */
  public async getServerTime(): Promise<number> {
    const timeMs = await this.rpcWithTimeout<number>('get_server_time', {}, 5000);
    return Number(timeMs);
  }

  /**
   * Join or resume player in race
   */
  public async joinRace(name: string): Promise<PlayerState> {
    const userId = await this.ensureAuth();
    const res = await this.rpcWithTimeout<{
      playerId: string;
      name: string;
      laps: number;
      correct: number;
    }>('join_race', { p_name: name }, 5000);

    const player: PlayerState = {
      playerId: res.playerId || userId,
      name: res.name,
      laps: Number(res.laps || 0),
      correct: Number(res.correct || 0),
    };

    Storage.setPlayer(player.playerId, player.name);
    return player;
  }

  /**
   * Request unseen multiple-choice question
   */
  public async requestQuestion(): Promise<Question> {
    await this.ensureAuth();
    const data = await this.rpcWithTimeout<{
      questionId: string;
      text: string;
      options: string[];
    }>('request_question', {}, 5000);

    return {
      questionId: data.questionId,
      text: data.text,
      options: data.options,
    };
  }

  /**
   * Submit answer for currently issued question.
   * Never auto-retried blindly: callers catch errors and show "Retry".
   */
  public async submitAnswer(questionId: string, optionIndex: number): Promise<AnswerResult> {
    await this.ensureAuth();
    const data = await this.rpcWithTimeout<{
      correct: boolean;
      fuelGrantedMs: number;
      laps: number;
      correctTotal: number;
    }>('submit_answer', {
      p_question_id: questionId,
      p_option_index: optionIndex,
    }, 6000);

    return {
      correct: Boolean(data.correct),
      fuelGrantedMs: Number(data.fuelGrantedMs),
      laps: Number(data.laps),
      correctTotal: Number(data.correctTotal),
    };
  }

  /**
   * Submit completed lap with queue, order preservation, and automatic backoff retry
   */
  public async submitLap(lapNumber: number, lapTimeMs: number): Promise<LapResult> {
    return new Promise<LapResult>((resolve, reject) => {
      this.lapQueue.push({
        lapNumber,
        lapTimeMs,
        resolve,
        reject,
        attempts: 0,
      });

      this.processLapQueue();
    });
  }

  /**
   * Sequential lap queue processor preserving FIFO order
   */
  private async processLapQueue(): Promise<void> {
    if (this.isProcessingLapQueue || this.lapQueue.length === 0) {
      return;
    }

    this.isProcessingLapQueue = true;

    while (this.lapQueue.length > 0) {
      const item = this.lapQueue[0];
      try {
        await this.ensureAuth();
        const data = await this.rpcWithTimeout<{
          accepted: boolean;
          laps: number;
          reason?: string;
        }>('submit_lap', {
          p_lap_number: item.lapNumber,
          p_lap_time_ms: item.lapTimeMs,
        }, 5000);

        // Success (either accepted or cleanly rejected by server rule)
        this.lapQueue.shift();
        item.resolve({
          accepted: Boolean(data.accepted),
          laps: Number(data.laps),
          reason: data.reason,
        });
      } catch (err: unknown) {
        item.attempts++;
        console.warn(
          `[SupabaseApi] submit_lap failed (attempt ${item.attempts}/5):`,
          err
        );

        if (item.attempts >= 5) {
          // Exceeded max retries for this lap
          this.lapQueue.shift();
          item.reject(err);
        } else {
          // Exponential backoff before retrying
          const backoffMs = Math.min(1000 * Math.pow(1.5, item.attempts), 5000);
          await new Promise((r) => setTimeout(r, backoffMs));
        }
      }
    }

    this.isProcessingLapQueue = false;
  }

  /**
   * Get leaderboard with limited retry and fallback to cached snapshot
   */
  public async getLeaderboard(): Promise<LeaderboardSnapshot> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await this.ensureAuth();
        const data = await this.rpcWithTimeout<{
          top: LeaderboardRow[];
          me: LeaderboardRow | null;
          totalPlayers: number;
        }>('get_leaderboard', { p_limit: 10 }, 5000);

        const snapshot: LeaderboardSnapshot = {
          top: (data.top || []).map((r) => ({
            rank: Number(r.rank),
            name: String(r.name),
            laps: Number(r.laps),
            correct: Number(r.correct),
            isMe: Boolean(r.isMe),
          })),
          me: data.me
            ? {
                rank: Number(data.me.rank),
                name: String(data.me.name),
                laps: Number(data.me.laps),
                correct: Number(data.me.correct),
                isMe: true,
              }
            : null,
          totalPlayers: Number(data.totalPlayers || 0),
        };

        this.cachedLeaderboard = snapshot;
        return snapshot;
      } catch (err: unknown) {
        lastError = err;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 600));
        }
      }
    }

    if (this.cachedLeaderboard) {
      console.warn('[SupabaseApi] get_leaderboard using cached snapshot after retry failure.');
      return this.cachedLeaderboard;
    }

    throw lastError || new Error('Failed to fetch leaderboard from Supabase.');
  }
}

export const supabaseApi = new SupabaseApi();
