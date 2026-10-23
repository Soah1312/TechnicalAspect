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
import { DEFAULT_CONFIG, DEBUG_CONFIG } from '../config/constants';
import { Storage } from '../util/storage';
import { MOCK_QUESTIONS } from './mockQuestions';

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
  private simulateDelay: boolean;

  constructor(simulateDelay = true) {
    this.simulateDelay = simulateDelay;
    const now = Date.now();
    const startDelayMs = 10000; // 10 seconds lobby countdown
    const raceDurationMs = DEBUG_CONFIG.endInSeconds
      ? DEBUG_CONFIG.endInSeconds * 1000
      : 3 * 60 * 1000; // 3 minutes default

    this.config = {
      startAt: now + startDelayMs,
      endAt: now + startDelayMs + raceDurationMs,
      isOpen: !DEBUG_CONFIG.forceClosed,
      tankMaxMs: DEFAULT_CONFIG.tankMaxMs,
      initialFuelMs: DEFAULT_CONFIG.initialFuelMs,
      fuelPerCorrectMs: DEFAULT_CONFIG.fuelPerCorrectMs,
      pitBelowFraction: DEFAULT_CONFIG.pitBelowFraction,
      questionTimeMs: DEFAULT_CONFIG.questionTimeMs,
      wrongLockoutMs: DEFAULT_CONFIG.wrongLockoutMs,
      minLapMs: DEFAULT_CONFIG.minLapMs,
    };

    // Initialize 30 active bots
    this.initBots();

    // Check if player already stored in local storage
    const stored = Storage.getPlayer();
    if (stored) {
      this.player = {
        playerId: stored.playerId,
        name: stored.name,
        laps: 0,
        correct: 0,
      };
    }
  }

  private initBots(): void {
    this.bots = BOT_NAMES.map((name, i) => ({
      id: `bot_${i}`,
      name,
      laps: Math.floor(Math.random() * 2),
      correct: Math.floor(Math.random() * 2),
      lastLapTime: this.creationTime - Math.random() * 30000,
    }));
  }

  private async delay(): Promise<void> {
    if (!this.simulateDelay) return;
    const ms = Math.floor(Math.random() * 300) + 100; // 100 - 400 ms simulated network latency
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public async getConfig(): Promise<GameConfig> {
    await this.delay();
    return { ...this.config };
  }

  public async getServerTime(): Promise<number> {
    await this.delay();
    // Simulate server time with tiny fixed skew (+45ms)
    return Date.now() + 45;
  }

  public async joinRace(name: string): Promise<PlayerState> {
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

    this.player = {
      playerId,
      name: cleanName,
      laps: this.player ? this.player.laps : 0,
      correct: this.player ? this.player.correct : 0,
    };

    Storage.setPlayer(playerId, cleanName);
    return { ...this.player };
  }

  /**
   * Request a question the player has not seen yet.
   * Shuffles options and keeps the correct index secret in the mock only.
   */
  public async requestQuestion(): Promise<Question> {
    await this.delay();

    // Find available questions not yet seen
    let available = MOCK_QUESTIONS.filter((q) => !this.seenQuestionIds.has(q.id));
    if (available.length === 0) {
      // All 60 questions used! Reset seen set to recycle
      this.seenQuestionIds.clear();
      available = [...MOCK_QUESTIONS];
    }

    // Pick random question from available pool
    const randomIndex = Math.floor(Math.random() * available.length);
    const chosen = available[randomIndex];
    this.seenQuestionIds.add(chosen.id);

    // Identify the correct answer text before shuffling
    const correctText = chosen.options[chosen.correctIndex];

    // Shuffle options using Fisher-Yates
    const shuffledOptions = [...chosen.options];
    for (let i = shuffledOptions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = shuffledOptions[i];
      shuffledOptions[i] = shuffledOptions[j];
      shuffledOptions[j] = temp;
    }

    // Map where the correct option landed
    const newCorrectIndex = shuffledOptions.indexOf(correctText);

    // Store in internal secret map (never exposed to client)
    this.pendingQuestionAnswers.set(chosen.id, newCorrectIndex);

    return {
      questionId: chosen.id,
      text: chosen.text,
      options: shuffledOptions,
    };
  }

  /**
   * Submit an answer. Evaluates against internal secret session map.
   */
  public async submitAnswer(questionId: string, optionIndex: number): Promise<AnswerResult> {
    await this.delay();

    const expectedIndex = this.pendingQuestionAnswers.get(questionId);
    if (expectedIndex === undefined) {
      throw new Error('Question expired or not found. Please request a new question.');
    }

    // Remove from pending map so the same question cannot be answered twice
    this.pendingQuestionAnswers.delete(questionId);

    const isCorrect = optionIndex === expectedIndex;

    if (isCorrect && this.player) {
      this.player.correct += 1;
    }

    const fuelGranted = isCorrect ? this.config.fuelPerCorrectMs : 0;

    return {
      correct: isCorrect,
      fuelGrantedMs: fuelGranted,
      laps: this.player?.laps ?? 0,
      correctTotal: this.player?.correct ?? 0,
    };
  }

  public async submitLap(lapNumber: number, lapTimeMs: number): Promise<LapResult> {
    await this.delay();

    if (lapTimeMs < this.config.minLapMs) {
      return {
        accepted: false,
        laps: this.player?.laps ?? 0,
        reason: 'Lap time suspiciously fast.',
      };
    }

    if (this.player) {
      this.player.laps = Math.max(this.player.laps, lapNumber);
    }

    return {
      accepted: true,
      laps: this.player?.laps ?? lapNumber,
    };
  }

  public async getLeaderboard(): Promise<LeaderboardSnapshot> {
    await this.delay();

    // Gradually advance bots to simulate live flashmob competition
    const now = Date.now();
    if (now >= this.config.startAt && now <= this.config.endAt) {
      for (const bot of this.bots) {
        if (Math.random() < 0.22) {
          bot.laps += 1;
          bot.lastLapTime = now;
          if (Math.random() < 0.65) {
            bot.correct += 1;
          }
        }
      }
    }

    const allRows: Array<{ id: string; name: string; laps: number; correct: number; lastLapTime: number; isMe: boolean }> = [
      ...this.bots.map((b) => ({
        id: b.id,
        name: b.name,
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
        laps: this.player.laps,
        correct: this.player.correct,
        lastLapTime: now,
        isMe: true,
      });
    }

    // Sort: laps desc, then correct desc, then lastLapTime asc
    allRows.sort((a, b) => {
      if (b.laps !== a.laps) return b.laps - a.laps;
      if (b.correct !== a.correct) return b.correct - a.correct;
      return a.lastLapTime - b.lastLapTime;
    });

    const ranked: LeaderboardRow[] = allRows.map((item, idx) => ({
      rank: idx + 1,
      name: item.name,
      laps: item.laps,
      correct: item.correct,
      isMe: item.isMe,
    }));

    const myRow = ranked.find((r) => r.isMe) || null;
    const topRows = ranked.slice(0, 10);

    return {
      top: topRows,
      me: myRow,
      totalPlayers: ranked.length,
    };
  }

  public getInternalPlayer(): PlayerState | null {
    return this.player ? { ...this.player } : null;
  }
}

export const mockApi = new MockApi();
