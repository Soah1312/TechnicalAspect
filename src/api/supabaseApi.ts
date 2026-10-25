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
  Branch,
  Year,
  Scope,
} from './types';
import { Storage } from '../util/storage';
import { networkMonitor } from '../util/network';

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
  private cachedLeaderboards = new Map<Scope, LeaderboardSnapshot>();

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

    // Auto-flush pending lap queue on network reconnection
    networkMonitor.subscribe((status) => {
      if (status === 'reconnected' || status === 'online') {
        console.log('[SupabaseApi] Network restored — flushing lap queue in order');
        this.flushLapQueue();
      }
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
   * Invokes an RPC with a Promise.race timeout (default 10s per Stage 5 requirements)
   */
  private async rpcWithTimeout<T>(
    fnName: string,
    params: Record<string, unknown> = {},
    timeoutMs = 10000
  ): Promise<T> {
    const endReq = networkMonitor.startRequest();
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
      endReq();
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
      questionTimeMs: Number(data.questionTimeMs),
      wrongLockoutMs: Number(data.wrongLockoutMs),
      minLapMs: Number(data.minLapMs),
      speedStep: data.speedStep !== undefined ? Number(data.speedStep) : 0.04,
      speedCap: data.speedCap !== undefined ? Number(data.speedCap) : 1.5,
      lapMinFactor: data.lapMinFactor !== undefined ? Number(data.lapMinFactor) : 0.8,
      trackStages: (data.trackStages as any) || undefined,
      featureFlags: (data.featureFlags as Record<string, boolean>) || {
        feature_branch_questions: true,
        feature_difficulty_curve: true,
        feature_speed_ramp: true,
        feature_track_stages: true,
        feature_answer_reveal: true,
      },
      branchSpecificRatio: data.branchSpecificRatio !== undefined ? Number(data.branchSpecificRatio) : 0.7,
      difficultyCurve: (data.difficultyCurve as any) || undefined,
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
  public async joinRace(name: string, branch?: Branch, year?: Year): Promise<PlayerState> {
    const userId = await this.ensureAuth();
    const res = await this.rpcWithTimeout<{
      playerId: string;
      name: string;
      laps: number;
      correct: number;
      branch?: Branch;
      year?: Year;
    }>('join_race', {
      p_name: name,
      p_branch: branch,
      p_year: year,
    }, 5000);

    const player: PlayerState = {
      playerId: res.playerId || userId,
      name: res.name,
      branch: res.branch || branch || 'COMPS',
      year: res.year || year || 1,
      laps: Number(res.laps || 0),
      correct: Number(res.correct || 0),
    };

    this.cachedLeaderboards.clear();
    Storage.setLapCount(player.laps);
    Storage.setPlayer(player.playerId, player.name, String(player.year), player.branch);
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
      difficulty?: 1 | 2 | 3;
      status?: string;
      waitMs?: number;
    }>('request_question', {}, 5000);

    return {
      questionId: data.questionId,
      text: data.text,
      options: data.options,
      difficulty: data.difficulty,
      status: data.status,
      waitMs: data.waitMs,
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
      correctIndex?: number;
      explanation?: string;
      timedOut?: boolean;
    }>('answer_question', {
      p_question_id: questionId,
      p_option_index: optionIndex,
    }, 6000);

    return {
      correct: Boolean(data.correct),
      fuelGrantedMs: Number(data.fuelGrantedMs),
      laps: Number(data.laps),
      correctTotal: Number(data.correctTotal),
      correctIndex: data.correctIndex !== undefined ? Number(data.correctIndex) : undefined,
      explanation: data.explanation || undefined,
      timedOut: Boolean(data.timedOut),
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
   * Flush pending lap retry queue immediately
   */
  public flushLapQueue(): void {
    if (!this.isProcessingLapQueue && this.lapQueue.length > 0) {
      this.processLapQueue().catch((err) => {
        console.warn('[SupabaseApi] flushLapQueue error:', err);
      });
    }
  }

  /**
   * Sequential lap queue processor preserving strict FIFO order
   */
  private async processLapQueue(): Promise<void> {
    if (this.isProcessingLapQueue || this.lapQueue.length === 0) {
      return;
    }

    this.isProcessingLapQueue = true;

    while (this.lapQueue.length > 0) {
      // If client is currently offline, pause queue processing without dropping laps
      if (!networkMonitor.isOnline()) {
        console.log('[SupabaseApi] Client offline — holding pending laps in FIFO queue');
        break;
      }

      const item = this.lapQueue[0];
      try {
        await this.ensureAuth();
        const data = await this.rpcWithTimeout<{
          accepted: boolean;
          laps: number;
          reason?: string;
        }>('submit_lap', {
          p_lap_number: item.lapNumber,
          p_lap_time_ms: Math.round(item.lapTimeMs),
        }, 10000);

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
          `[SupabaseApi] submit_lap failed (attempt ${item.attempts}/8):`,
          err
        );

        if (!networkMonitor.isOnline()) {
          // Went offline mid-request: hold item for reconnection
          break;
        }

        if (item.attempts >= 8) {
          // Exceeded max retries for this lap after repeated server failure
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
   * Get leaderboard with limited retry and resilient fallback to cached/stale snapshot
   */
  public async getLeaderboard(scope: Scope = 'ALL'): Promise<LeaderboardSnapshot> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await this.ensureAuth();
        const data = await this.rpcWithTimeout<{
          top: LeaderboardRow[];
          me: LeaderboardRow | null;
          totalPlayers: number;
        }>('get_leaderboard', { p_limit: 10, p_scope: scope }, 8000);

        const snapshot: LeaderboardSnapshot = {
          top: (data.top || []).map((r) => ({
            rank: Number(r.rank),
            name: String(r.name),
            branch: r.branch as Branch,
            year: r.year ? (Number(r.year) as Year) : undefined,
            laps: Number(r.laps),
            correct: Number(r.correct),
            isMe: Boolean(r.isMe),
          })),
          me: data.me
            ? {
                rank: Number(data.me.rank),
                name: String(data.me.name),
                branch: data.me.branch as Branch,
                year: data.me.year ? (Number(data.me.year) as Year) : undefined,
                laps: Number(data.me.laps),
                correct: Number(data.me.correct),
                isMe: true,
              }
            : null,
          totalPlayers: Number(data.totalPlayers || 0),
          isStale: false,
          scope,
        };

        this.cachedLeaderboards.set(scope, snapshot);
        return snapshot;
      } catch {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 600));
        }
      }
    }

    // Network slow, offline, or timed out: return cached leaderboard with stale flag
    const cached = this.cachedLeaderboards.get(scope);
    if (cached) {
      console.warn('[SupabaseApi] get_leaderboard returning cached snapshot with isStale=true');
      return {
        ...cached,
        isStale: true,
        scope,
      };
    }

    // Initial load failed while offline: return graceful empty snapshot with isStale=true
    return {
      top: [],
      me: null,
      totalPlayers: 0,
      isStale: true,
      scope,
    };
  }
}

export const supabaseApi = new SupabaseApi();
