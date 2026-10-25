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
import { DEFAULT_CONFIG, DEBUG_CONFIG } from '../config/constants';
import { Storage } from '../util/storage';
import { MOCK_QUESTIONS } from './mockQuestions';
import { minLapMs } from '../shared/difficulty';

const BOT_NAMES = [
  'TurboTuring', 'PixelRacer', 'BitDrifter', 'ByteRider', 'CyberApex',
  'KernelSpeed', 'NeonOverdrive', 'CircuitBreaker', 'ZeroLag', 'StackOverflow',
  'CodeNinja', 'GlitchSurfer', 'V8Rocket', 'CacheHit', 'QuantumLeap',
  'AlgoRhythm', 'RAMJet', 'NullPointer', 'PingZero', 'HexRacer',
  'SpeedDaemon', 'CloudRacer', 'AsyncDrift', 'PixelPacer', 'SyntaxError',
  'BugHunter', 'LogicGate', 'MatrixDriver', 'GitBranch', 'HotReload',
];

interface BotRecord {
  id: string;
  name: string;
  branch: Branch;
  year: Year;
  laps: number;
  correct: number;
  lastLapTime: number;
}

export class MockApi implements GameApi {
  private config: GameConfig;
  private player: PlayerState | null = null;
  private bots: BotRecord[] = [];
  private creationTime: number = Date.now();

  // Seen questions set for this player session
  private seenQuestionIds: Set<string> = new Set();
  // Secret session map: questionId -> correct option index in the shuffled array sent to client
  private pendingQuestionAnswers: Map<string, number> = new Map();
  private issuedAtMap: Map<string, number> = new Map();
  private answeredMap: Map<string, AnswerResult> = new Map();
  private currentIssuedQuestion: Question | null = null;
  private lockedUntil: number | null = null;
  private fuelGrantedMsTotal = DEFAULT_CONFIG.initialFuelMs;
  private minDriveMsTotal = 0;
  private lastLapAt: number | null = null;
  private lastAnswerWasCorrect = false;
  private lastAnswerAt: number | null = null;
  private joinedAt: number = Date.now();
  private simulateDelay: boolean;

  constructor(simulateDelay = true) {
    this.simulateDelay = simulateDelay;
    const now = Date.now();

    this.config = {
      startAt: now - 60000,
      endAt: now + 3153600000000, // Always active
      isOpen: !DEBUG_CONFIG.forceClosed,
      tankMaxMs: DEFAULT_CONFIG.tankMaxMs,
      initialFuelMs: DEFAULT_CONFIG.initialFuelMs,
      fuelPerCorrectMs: DEFAULT_CONFIG.fuelPerCorrectMs,
      questionTimeMs: DEFAULT_CONFIG.questionTimeMs,
      wrongLockoutMs: DEFAULT_CONFIG.wrongLockoutMs,
      minLapMs: DEFAULT_CONFIG.minLapMs,
      speedStep: 0.04,
      speedCap: 1.5,
      lapMinFactor: 0.8,
      branchSpecificRatio: 0.7,
      featureFlags: {
        feature_branch_questions: true,
        feature_difficulty_curve: true,
        feature_speed_ramp: true,
        feature_track_stages: true,
        feature_answer_reveal: true,
      },
    };

    // Initialize 30 active bots distributed across branches and years
    this.initBots();

    // Check if player already stored in local storage
    const stored = Storage.getPlayer();
    if (stored) {
      this.player = {
        playerId: stored.playerId,
        name: stored.name,
        branch: (stored.branch as Branch) || 'COMPS',
        year: (Number(stored.year) as Year) || 1,
        laps: 0,
        correct: 0,
      };
    }
  }

  private initBots(): void {
    const branches: Branch[] = ['COMPS', 'CSE', 'ECS', 'MECH', 'AIDS'];
    this.bots = BOT_NAMES.map((name, i) => {
      const branch = branches[i % branches.length];
      const year = (branch === 'AIDS' ? 4 : ((i % 4) + 1)) as Year;
      return {
        id: `bot_${i}`,
        name,
        branch,
        year,
        laps: Math.floor(Math.random() * 2),
        correct: Math.floor(Math.random() * 2),
        lastLapTime: this.creationTime - Math.random() * 30000,
      };
    });
  }

  private async delay(): Promise<void> {
    if (!this.simulateDelay) return;
    const ms = Math.floor(Math.random() * 150) + 50;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public async getConfig(): Promise<GameConfig> {
    await this.delay();
    return { ...this.config };
  }

  public setConfig(cfg: Partial<GameConfig>): void {
    this.config = { ...this.config, ...cfg };
  }

  public addFuel(ms: number): void {
    this.fuelGrantedMsTotal += ms;
  }

  public clearLockout(): void {
    this.lockedUntil = null;
  }

  public setJoinedAt(timeMs: number): void {
    this.joinedAt = timeMs;
  }

  public async getServerTime(): Promise<number> {
    await this.delay();
    return Date.now() + 45;
  }

  public async joinRace(name: string, branch?: Branch, year?: Year): Promise<PlayerState> {
    await this.delay();
    const cleanName = name.trim();

    if (!cleanName || cleanName.length < 2 || cleanName.length > 16) {
      throw new Error('Name must be between 2 and 16 characters.');
    }

    if (!/^[a-zA-Z0-9 ]+$/.test(cleanName)) {
      throw new Error('Name can only contain letters, numbers, and spaces.');
    }

    let playerId = this.player?.playerId;
    if (!playerId) {
      playerId = `usr_${Math.random().toString(36).substring(2, 9)}`;
    }

    const assignedBranch: Branch = branch || this.player?.branch || 'COMPS';
    const assignedYear: Year = (assignedBranch === 'AIDS' ? 4 : (year || this.player?.year || 1)) as Year;

    this.player = {
      playerId,
      name: cleanName,
      branch: assignedBranch,
      year: assignedYear,
      laps: this.player ? this.player.laps : 0,
      correct: this.player ? this.player.correct : 0,
    };

    Storage.setPlayer(playerId, cleanName, String(this.player.year), this.player.branch);
    return { ...this.player };
  }

  /**
   * Request question using B4 algorithm with difficulty curve and branch pool
   */
  public async requestQuestion(nowMs?: number): Promise<Question> {
    await this.delay();
    const now = nowMs ?? Date.now();

    // Check lockout
    if (this.lockedUntil && this.lockedUntil > now) {
      throw new Error(`Player is locked out until ${new Date(this.lockedUntil).toISOString()}`);
    }

    // Check if player has an active unanswered question within questionTimeMs
    if (this.currentIssuedQuestion) {
      const issuedAt = this.issuedAtMap.get(this.currentIssuedQuestion.questionId) || 0;
      if (now - issuedAt < this.config.questionTimeMs) {
        return this.currentIssuedQuestion;
      } else {
        this.currentIssuedQuestion = null;
      }
    }

    // Anti-farming rule: if last answer was correct, do not issue new question until at least 0.8 * fuelPerCorrectMs
    if (this.lastAnswerWasCorrect && this.lastAnswerAt !== null) {
      const elapsed = now - this.lastAnswerAt;
      const minGap = 0.8 * this.config.fuelPerCorrectMs;
      if (elapsed < minGap) {
        return {
          questionId: '',
          text: '',
          options: [],
          status: 'TOO_SOON',
          waitMs: Math.round(minGap - elapsed),
        };
      }
    }

    // Determine target difficulty from laps
    const currentLaps = this.player?.laps || 0;
    let targetDiff: 1 | 2 | 3 = 1;
    if (this.config.featureFlags?.feature_difficulty_curve !== false) {
      const r = Math.random();
      if (currentLaps <= 10) {
        targetDiff = r < 0.8 ? 1 : 2;
      } else if (currentLaps <= 25) {
        targetDiff = r < 0.3 ? 1 : r < 0.8 ? 2 : 3;
      } else if (currentLaps <= 45) {
        targetDiff = r < 0.1 ? 1 : r < 0.5 ? 2 : 3;
      } else {
        targetDiff = r < 0.3 ? 2 : 3;
      }
    }

    // Find available questions
    let available = MOCK_QUESTIONS.filter((q) => !this.seenQuestionIds.has(q.id));
    if (available.length === 0) {
      this.seenQuestionIds.clear();
      available = [...MOCK_QUESTIONS];
    }

    const randomIndex = Math.floor(Math.random() * available.length);
    const chosen = available[randomIndex];
    this.seenQuestionIds.add(chosen.id);

    const correctText = chosen.options[chosen.correctIndex];

    // Shuffle options using Fisher-Yates
    const shuffledOptions = [...chosen.options];
    for (let i = shuffledOptions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = shuffledOptions[i];
      shuffledOptions[i] = shuffledOptions[j];
      shuffledOptions[j] = temp;
    }

    const newCorrectIndex = shuffledOptions.indexOf(correctText);

    this.pendingQuestionAnswers.set(chosen.id, newCorrectIndex);
    this.issuedAtMap.set(chosen.id, now);

    this.currentIssuedQuestion = {
      questionId: chosen.id,
      text: chosen.text,
      options: shuffledOptions,
      difficulty: targetDiff,
    };

    return this.currentIssuedQuestion;
  }

  public async submitAnswer(
    questionId: string,
    optionIndex: number,
    submitTimeMs = Date.now()
  ): Promise<AnswerResult> {
    await this.delay();

    if (this.answeredMap.has(questionId)) {
      return this.answeredMap.get(questionId)!;
    }

    if (submitTimeMs >= this.config.endAt) {
      throw new Error('Race has ended');
    }

    const expectedIndex = this.pendingQuestionAnswers.get(questionId);
    if (expectedIndex === undefined) {
      throw new Error('Question expired or not found. Please request a new question.');
    }

    const issuedAt = this.issuedAtMap.get(questionId) || submitTimeMs;
    const isTimeout = submitTimeMs - issuedAt > this.config.questionTimeMs + 2000 || optionIndex < 0;

    const revealEnabled = this.config.featureFlags?.feature_answer_reveal !== false;
    const origQ = MOCK_QUESTIONS.find((q) => q.id === questionId) as (typeof MOCK_QUESTIONS[0] & { explanation?: string }) | undefined;
    const explanation = origQ?.explanation || 'Tech pit explanation verified.';

    if (isTimeout) {
      this.pendingQuestionAnswers.delete(questionId);
      this.currentIssuedQuestion = null;
      this.lockedUntil = submitTimeMs + this.config.wrongLockoutMs;
      this.lastAnswerWasCorrect = false;
      this.lastAnswerAt = submitTimeMs;

      const timeoutResult: AnswerResult = {
        correct: false,
        fuelGrantedMs: 0,
        laps: this.player?.laps ?? 0,
        correctTotal: this.player?.correct ?? 0,
        correctIndex: revealEnabled ? expectedIndex : undefined,
        explanation: revealEnabled ? explanation : undefined,
        timedOut: true,
      };
      this.answeredMap.set(questionId, timeoutResult);
      return timeoutResult;
    }

    this.pendingQuestionAnswers.delete(questionId);
    this.currentIssuedQuestion = null;

    const isCorrect = optionIndex === expectedIndex;

    if (isCorrect) {
      if (this.player) {
        this.player.correct += 1;
      }
      this.fuelGrantedMsTotal += this.config.fuelPerCorrectMs;
      this.lastAnswerWasCorrect = true;
      this.lastAnswerAt = submitTimeMs;
    } else {
      this.lockedUntil = submitTimeMs + this.config.wrongLockoutMs;
      this.lastAnswerWasCorrect = false;
      this.lastAnswerAt = submitTimeMs;
    }

    const result: AnswerResult = {
      correct: isCorrect,
      fuelGrantedMs: isCorrect ? this.config.fuelPerCorrectMs : 0,
      laps: this.player?.laps ?? 0,
      correctTotal: this.player?.correct ?? 0,
      correctIndex: !isCorrect && revealEnabled ? expectedIndex : undefined,
      explanation: !isCorrect && revealEnabled ? explanation : undefined,
      timedOut: false,
    };

    this.answeredMap.set(questionId, result);
    return result;
  }

  public async submitLap(
    lapNumber: number,
    lapTimeMs: number,
    now = Date.now()
  ): Promise<LapResult> {
    await this.delay();
    const currentLaps = this.player?.laps ?? 0;

    if (!this.config.isOpen) {
      return {
        accepted: false,
        laps: currentLaps,
        reason: 'Race window is closed.',
      };
    }

    if (lapNumber <= currentLaps) {
      return {
        accepted: false,
        laps: currentLaps,
        reason: 'Duplicate or old lap.',
      };
    }

    if (lapNumber > currentLaps + 1) {
      return {
        accepted: false,
        laps: currentLaps,
        reason: 'Lap sequence skipped.',
      };
    }

    // Dynamic min lap calculation based on speed ramp
    const effectiveMin = minLapMs(
      lapNumber,
      this.config.lapMinFactor ?? 0.8,
      this.config.speedStep ?? 0.04,
      this.config.speedCap ?? 1.5,
      undefined,
      this.config.featureFlags?.feature_speed_ramp ?? true
    );

    if (lapTimeMs < effectiveMin) {
      return {
        accepted: false,
        laps: currentLaps,
        reason: `Lap time (${lapTimeMs}ms) faster than physical minimum (${effectiveMin}ms).`,
      };
    }

    const prevLapTime = this.lastLapAt ?? this.joinedAt;
    const elapsedSinceLastLap = now - prevLapTime;
    if (elapsedSinceLastLap < effectiveMin * 0.9) {
      return {
        accepted: false,
        laps: currentLaps,
        reason: 'Laps submitted too quickly.',
      };
    }

    if ((this.minDriveMsTotal + effectiveMin) > this.fuelGrantedMsTotal * 1.05) {
      return {
        accepted: false,
        laps: currentLaps,
        reason: 'Laps exceed earned fuel.',
      };
    }

    if (this.player) {
      this.player.laps = lapNumber;
    }
    this.minDriveMsTotal += effectiveMin;
    this.lastLapAt = now;

    return {
      accepted: true,
      laps: this.player?.laps ?? lapNumber,
    };
  }

  public async getLeaderboard(scope: Scope = 'ALL', limit = 10): Promise<LeaderboardSnapshot> {
    await this.delay();

    // Advance bots
    const now = Date.now();
    for (const bot of this.bots) {
      if (Math.random() < 0.22) {
        bot.laps += 1;
        bot.lastLapTime = now;
        if (Math.random() < 0.65) {
          bot.correct += 1;
        }
      }
    }

    let allRows: Array<{ id: string; name: string; branch: Branch; year: Year; laps: number; correct: number; lastLapTime: number; isMe: boolean }> = [
      ...this.bots.map((b) => ({
        id: b.id,
        name: b.name,
        branch: b.branch,
        year: b.year,
        laps: b.laps,
        correct: b.correct,
        lastLapTime: b.lastLapTime,
        isMe: false,
      })),
    ];

    if (this.player) {
      allRows.push({
        id: this.player.playerId,
        name: this.player.name,
        branch: this.player.branch || 'COMPS',
        year: this.player.year || 1,
        laps: this.player.laps,
        correct: this.player.correct,
        lastLapTime: now,
        isMe: true,
      });
    }

    // Filter by scope
    if (scope === 'BRANCH' && this.player?.branch) {
      allRows = allRows.filter((r) => r.branch === this.player!.branch);
    } else if (scope === 'YEAR' && this.player?.year) {
      allRows = allRows.filter((r) => r.year === this.player!.year);
    }

    allRows.sort((a, b) => {
      if (b.laps !== a.laps) return b.laps - a.laps;
      if (b.correct !== a.correct) return b.correct - a.correct;
      return a.lastLapTime - b.lastLapTime;
    });

    const ranked: LeaderboardRow[] = allRows.map((item, idx) => ({
      rank: idx + 1,
      name: item.name,
      branch: item.branch,
      year: item.year,
      laps: item.laps,
      correct: item.correct,
      isMe: item.isMe,
    }));

    const me = ranked.find((r) => r.isMe) || null;
    const top = ranked.slice(0, limit);

    return {
      top,
      me,
      totalPlayers: ranked.length,
      scope,
    };
  }
}

export const mockApi = new MockApi(true);
