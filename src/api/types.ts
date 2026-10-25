export type Branch = 'COMPS' | 'CSE' | 'ECS' | 'MECH' | 'AIDS';
export type Year = 1 | 2 | 3 | 4;
export type Scope = 'ALL' | 'BRANCH' | 'YEAR';

export interface TrackStageConfig {
  fromLap: number;
  bestLapMsAtBase: number;
}

export interface GameConfig {
  startAt: number; // epoch ms (server-authoritative)
  endAt: number; // epoch ms
  isOpen: boolean; // kill switch
  tankMaxMs: number; // full tank, ms of driving
  initialFuelMs: number; // fuel at join
  fuelPerCorrectMs: number;
  pitBelowFraction: number; // 0.5
  questionTimeMs: number;
  wrongLockoutMs: number;
  minLapMs: number; // fastest physically possible lap (driving time)

  // V2 Contract Additions
  speedStep?: number;
  speedCap?: number;
  lapMinFactor?: number;
  trackStages?: TrackStageConfig[];
  featureFlags?: Record<string, boolean>;
  branchSpecificRatio?: number;
  difficultyCurve?: Array<{ minCorrect: number; weights: Record<string, number> }>;
}

export interface PlayerState {
  playerId: string;
  name: string;
  year?: Year;
  branch?: Branch;
  laps: number;
  correct: number;
}

export interface Question {
  questionId: string;
  text: string;
  options: string[];
  difficulty?: 1 | 2 | 3;
} // never includes the answer

export interface AnswerResult {
  correct: boolean;
  fuelGrantedMs: number;
  laps: number;
  correctTotal: number;
  correctIndex?: number; // ONLY present when answer was wrong or timed out
  explanation?: string;  // optional, same rule
  timedOut?: boolean;
}

export interface LapResult {
  accepted: boolean;
  laps: number;
  reason?: string;
}

export interface LeaderboardRow {
  rank: number;
  name: string;
  branch?: Branch;
  year?: Year;
  laps: number;
  correct: number;
  isMe: boolean;
}

export interface LeaderboardSnapshot {
  top: LeaderboardRow[];
  me: LeaderboardRow | null;
  totalPlayers: number;
  isStale?: boolean;
  scope?: Scope;
}

export interface GameApi {
  getConfig(): Promise<GameConfig>;
  getServerTime(): Promise<number>; // epoch ms
  joinRace(name: string, branch?: Branch, year?: Year): Promise<PlayerState>;
  requestQuestion(): Promise<Question>;
  submitAnswer(questionId: string, optionIndex: number): Promise<AnswerResult>;
  submitLap(lapNumber: number, lapTimeMs: number): Promise<LapResult>;
  getLeaderboard(scope?: Scope): Promise<LeaderboardSnapshot>;
}
