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

interface QuestionInternal {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
}

const QUESTION_BANK: QuestionInternal[] = [
  {
    id: 'q1',
    text: 'What does CSS stand for?',
    options: ['Cascading Style Sheets', 'Computer Style Syntax', 'Creative Styling Script', 'Control Sheet Standard'],
    correctIndex: 0,
  },
  {
    id: 'q2',
    text: 'Which data structure follows LIFO?',
    options: ['Queue', 'Stack', 'Tree', 'Graph'],
    correctIndex: 1,
  },
  {
    id: 'q3',
    text: 'Time complexity of binary search on sorted array?',
    options: ['O(n)', 'O(n log n)', 'O(log n)', 'O(1)'],
    correctIndex: 2,
  },
  {
    id: 'q4',
    text: 'What port does default HTTP use?',
    options: ['443', '21', '80', '8080'],
    correctIndex: 2,
  },
  {
    id: 'q5',
    text: 'In JavaScript, typeof null returns:',
    options: ['null', 'undefined', 'object', 'number'],
    correctIndex: 2,
  },
  {
    id: 'q6',
    text: 'Which protocol secures web traffic via SSL/TLS?',
    options: ['HTTPS', 'FTP', 'SMTP', 'SSH'],
    correctIndex: 0,
  },
  {
    id: 'q7',
    text: 'What does SQL stand for?',
    options: ['Structured Query Language', 'Simple Question Link', 'System Query Logic', 'Standard Quantum Loop'],
    correctIndex: 0,
  },
  {
    id: 'q8',
    text: 'Git command to stage changes for commit:',
    options: ['git push', 'git add', 'git commit', 'git stage-all'],
    correctIndex: 1,
  },
  {
    id: 'q9',
    text: 'Which layer of OSI model handles routing?',
    options: ['Data Link', 'Transport', 'Network', 'Session'],
    correctIndex: 2,
  },
  {
    id: 'q10',
    text: 'What is the base of Hexadecimal system?',
    options: ['8', '10', '16', '32'],
    correctIndex: 2,
  },
  {
    id: 'q11',
    text: 'Which HTML tag links external CSS?',
    options: ['<script>', '<style>', '<link>', '<css>'],
    correctIndex: 2,
  },
  {
    id: 'q12',
    text: 'What does API stand for?',
    options: [
      'Application Programming Interface',
      'Advanced Program Instruction',
      'Automated Protocol Interaction',
      'App Process Integration',
    ],
    correctIndex: 0,
  },
  {
    id: 'q13',
    text: 'Which HTTP method is idempotent?',
    options: ['POST', 'GET', 'PATCH', 'CONNECT'],
    correctIndex: 1,
  },
  {
    id: 'q14',
    text: 'In Python, which keyword defines a function?',
    options: ['func', 'fn', 'def', 'function'],
    correctIndex: 2,
  },
  {
    id: 'q15',
    text: 'Which algorithm is used in public key cryptography?',
    options: ['RSA', 'AES', 'SHA-256', 'MD5'],
    correctIndex: 0,
  },
];

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
  private lastQuestionIndex = 0;

  constructor() {
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

    // Initialize bot fleet
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
      correct: Math.floor(Math.random() * 3),
      lastLapTime: this.creationTime - Math.random() * 30000,
    }));
  }

  private async delay(): Promise<void> {
    const ms = Math.floor(Math.random() * 300) + 100; // 100 - 400 ms
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public async getConfig(): Promise<GameConfig> {
    await this.delay();
    return { ...this.config };
  }

  public async getServerTime(): Promise<number> {
    await this.delay();
    // In mock, server time is simulated real time with a tiny fixed skew
    return Date.now() + 50;
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

  public async requestQuestion(): Promise<Question> {
    await this.delay();
    // Cycle or pick random question
    const q = QUESTION_BANK[this.lastQuestionIndex % QUESTION_BANK.length];
    this.lastQuestionIndex++;

    return {
      questionId: q.id,
      text: q.text,
      options: [...q.options],
    };
  }

  public async submitAnswer(questionId: string, optionIndex: number): Promise<AnswerResult> {
    await this.delay();
    const q = QUESTION_BANK.find((item) => item.id === questionId);
    if (!q) {
      throw new Error('Question expired or not found.');
    }

    const isCorrect = q.correctIndex === optionIndex;
    if (this.player && isCorrect) {
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

    // Gradually advance bots to simulate an active flashmob
    const now = Date.now();
    if (now >= this.config.startAt && now <= this.config.endAt) {
      for (const bot of this.bots) {
        if (Math.random() < 0.25) {
          bot.laps += 1;
          bot.lastLapTime = now;
          if (Math.random() < 0.7) {
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

    // Sort: laps desc, correct desc, lastLapTime asc
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
