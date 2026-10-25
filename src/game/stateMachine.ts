export type GameState =
  | 'LOADING'
  | 'JOIN'
  | 'HOW_TO_PLAY'
  | 'LOBBY'
  | 'COUNTDOWN'
  | 'RACING'
  | 'PIT'
  | 'ENDED'
  | 'CLOSED'
  | 'ERROR';

export type StateListener = (newState: GameState, prevState: GameState, context?: Record<string, unknown>) => void;

// Explicit transition table defining allowable next states
const ALLOWED_TRANSITIONS: Record<GameState, GameState[]> = {
  LOADING: ['JOIN', 'HOW_TO_PLAY', 'LOBBY', 'COUNTDOWN', 'RACING', 'ENDED', 'CLOSED', 'ERROR'],
  JOIN: ['HOW_TO_PLAY', 'LOBBY', 'COUNTDOWN', 'CLOSED', 'ERROR'],
  HOW_TO_PLAY: ['LOBBY', 'COUNTDOWN', 'RACING', 'CLOSED', 'ERROR'],
  LOBBY: ['COUNTDOWN', 'RACING', 'ENDED', 'CLOSED', 'ERROR'],
  COUNTDOWN: ['RACING', 'ENDED', 'ERROR'],
  RACING: ['JOIN', 'PIT', 'ENDED', 'ERROR'],
  PIT: ['RACING', 'ENDED', 'ERROR'],
  ENDED: ['JOIN', 'LOBBY', 'ERROR'],
  CLOSED: ['LOADING', 'JOIN', 'ERROR'],
  ERROR: ['LOADING', 'JOIN', 'LOBBY', 'RACING', 'CLOSED'],
};

export class GameStateMachine {
  private current: GameState = 'LOADING';
  private previous: GameState = 'LOADING';
  private listeners: Set<StateListener> = new Set();
  private lastContext: Record<string, unknown> = {};

  constructor(initialState: GameState = 'LOADING') {
    this.current = initialState;
    this.previous = initialState;
  }

  public getState(): GameState {
    return this.current;
  }

  public getPreviousState(): GameState {
    return this.previous;
  }

  public getContext(): Record<string, unknown> {
    return { ...this.lastContext };
  }

  public canTransitionTo(target: GameState): boolean {
    const allowed = ALLOWED_TRANSITIONS[this.current];
    return allowed ? allowed.includes(target) : false;
  }

  public transition(target: GameState, context: Record<string, unknown> = {}): boolean {
    if (this.current === target) {
      this.lastContext = { ...this.lastContext, ...context };
      return true;
    }

    if (!this.canTransitionTo(target)) {
      console.warn(`[StateMachine] Invalid state transition: ${this.current} -> ${target}`);
      return false;
    }

    const prev = this.current;
    this.previous = prev;
    this.current = target;
    this.lastContext = { ...context };

    this.notify(target, prev, this.lastContext);
    return true;
  }

  public forceState(target: GameState, context: Record<string, unknown> = {}): void {
    const prev = this.current;
    this.previous = prev;
    this.current = target;
    this.lastContext = { ...context };
    this.notify(target, prev, this.lastContext);
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(newState: GameState, prevState: GameState, context: Record<string, unknown>): void {
    this.listeners.forEach((listener) => {
      try {
        listener(newState, prevState, context);
      } catch (err) {
        console.error('[StateMachine] Listener error:', err);
      }
    });
  }
}

export const stateMachine = new GameStateMachine('LOADING');
