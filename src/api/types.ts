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
}

export interface PlayerState {
  playerId: string;
  name: string;
  laps: number;
  correct: number;
}

export interface Question {
  questionId: string;
  text: string;
  options: string[];
} // never includes the answer

export interface AnswerResult {
  correct: boolean;
  fuelGrantedMs: number;
  laps: number;
  correctTotal: number;
}

export interface LapResult {
  accepted: boolean;
  laps: number;
  reason?: string;
}

export interface LeaderboardRow {
  rank: number;
  name: string;
  laps: number;
  correct: number;
  isMe: boolean;
}

export interface LeaderboardSnapshot {
  top: LeaderboardRow[];
  me: LeaderboardRow | null;
  totalPlayers: number;
  isStale?: boolean;
}

export interface GameApi {
  getConfig(): Promise<GameConfig>;
  getServerTime(): Promise<number>; // epoch ms
  joinRace(name: string): Promise<PlayerState>; // idempotent per auth user (resume)
  requestQuestion(): Promise<Question>;
  submitAnswer(questionId: string, optionIndex: number): Promise<AnswerResult>;
  submitLap(lapNumber: number, lapTimeMs: number): Promise<LapResult>;
  getLeaderboard(): Promise<LeaderboardSnapshot>;
}
