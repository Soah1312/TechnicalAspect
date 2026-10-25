import type { CheckpointGate, Point2D } from './track';

export interface LapCompleteEvent {
  lapNumber: number;
  drivingTimeMs: number;
  totalTimeMs: number;
}

export interface LapManagerEvents {
  onLapComplete?: (event: LapCompleteEvent) => void;
  onGatePassed?: (gateIndex: number) => void;
}

export class LapManager {
  private readonly gates: CheckpointGate[];
  private nextExpectedGate = 1; // Starts on Gate 0, expecting Gate 1 first
  private currentLap = 0;

  private currentLapDrivingTimeMs = 0;
  private currentLapTotalTimeMs = 0;
  private lastLapDrivingTimeMs = 0;
  private lastLapTotalTimeMs = 0;

  private prevPosition: Point2D = { x: 0, y: 0 };
  private hasPrevPosition = false;
  private listeners: LapManagerEvents = {};

  constructor(gates: CheckpointGate[]) {
    this.gates = gates;
  }

  public setListeners(events: LapManagerEvents): void {
    this.listeners = { ...this.listeners, ...events };
  }

  public getLapCount(): number {
    return this.currentLap;
  }

  public syncLapCount(serverLaps: number): void {
    this.currentLap = serverLaps;
  }

  public getNextExpectedGate(): number {
    return this.nextExpectedGate;
  }

  public getCurrentLapDrivingTimeMs(): number {
    return this.currentLapDrivingTimeMs;
  }

  public getLastLapDrivingTimeMs(): number {
    return this.lastLapDrivingTimeMs;
  }

  public getLastLapTotalTimeMs(): number {
    return this.lastLapTotalTimeMs;
  }

  public updateGates(newGates: CheckpointGate[]): void {
    this.gates.length = 0;
    this.gates.push(...newGates);
    this.nextExpectedGate = 1;
    this.hasPrevPosition = false;
  }

  public reset(startGate = 1): void {
    this.nextExpectedGate = startGate;
    this.currentLap = 0;
    this.currentLapDrivingTimeMs = 0;
    this.currentLapTotalTimeMs = 0;
    this.hasPrevPosition = false;
  }


  /**
   * Update gate crossings and lap driving timers
   */
  public update(
    currPos: Point2D,
    velocity: Point2D,
    deltaMs: number,
    isRaceActive = true
  ): void {
    const speed = Math.hypot(velocity.x, velocity.y);

    // Track lap times while race is active
    if (isRaceActive) {
      this.currentLapTotalTimeMs += deltaMs;
      // Driving time accumulates only while car is moving
      if (speed > 5) {
        this.currentLapDrivingTimeMs += deltaMs;
      }
    }

    if (!this.hasPrevPosition) {
      this.prevPosition.x = currPos.x;
      this.prevPosition.y = currPos.y;
      this.hasPrevPosition = true;
      return;
    }

    // Check each gate for a forward crossing
    for (let i = 0; i < this.gates.length; i++) {
      const gate = this.gates[i];
      if (this.checkGateCrossing(this.prevPosition, currPos, velocity, gate)) {
        this.handleGateCrossed(gate.gateIndex);
        break;
      }
    }

    this.prevPosition.x = currPos.x;
    this.prevPosition.y = currPos.y;
  }

  private handleGateCrossed(gateIndex: number): void {
    // Only accept gate if it matches nextExpectedGate in order
    if (gateIndex === this.nextExpectedGate) {
      this.listeners.onGatePassed?.(gateIndex);

      if (gateIndex === 0) {
        // Lap complete! Visited 1, 2, 3, 4, 5 and now crossed 0 forward
        this.currentLap++;
        this.lastLapDrivingTimeMs = this.currentLapDrivingTimeMs;
        this.lastLapTotalTimeMs = this.currentLapTotalTimeMs;

        const event: LapCompleteEvent = {
          lapNumber: this.currentLap,
          drivingTimeMs: this.lastLapDrivingTimeMs,
          totalTimeMs: this.lastLapTotalTimeMs,
        };

        this.listeners.onLapComplete?.(event);

        // Reset timer for next lap
        this.currentLapDrivingTimeMs = 0;
        this.currentLapTotalTimeMs = 0;
        this.nextExpectedGate = 1;
      } else {
        // Advance to next expected gate in 0..5 loop
        this.nextExpectedGate = (gateIndex + 1) % this.gates.length;
      }
    }
  }

  /**
   * Check if the segment from pPrev to pCurr crosses gate forward
   */
  public checkGateCrossing(
    pPrev: Point2D,
    pCurr: Point2D,
    velocity: Point2D,
    gate: CheckpointGate
  ): boolean {
    // 1. Forward direction test: velocity must dot positive with track tangent
    const forwardDot = velocity.x * gate.tangent.x + velocity.y * gate.tangent.y;
    if (forwardDot <= 0) {
      // Reversing or facing backwards through gate is rejected!
      return false;
    }

    // 2. Plane crossing test
    const dPrev = (pPrev.x - gate.center.x) * gate.tangent.x + (pPrev.y - gate.center.y) * gate.tangent.y;
    const dCurr = (pCurr.x - gate.center.x) * gate.tangent.x + (pCurr.y - gate.center.y) * gate.tangent.y;

    // Crossing from back (<=0) to front (>0)
    if (dPrev <= 0 && dCurr > 0) {
      const denom = dCurr - dPrev;
      const t = denom !== 0 ? -dPrev / denom : 0;
      const crossX = pPrev.x + t * (pCurr.x - pPrev.x);
      const crossY = pPrev.y + t * (pCurr.y - pPrev.y);

      // 3. Lateral width check: within gate half-width
      const lateralDist = Math.abs(
        (crossX - gate.center.x) * gate.normal.x + (crossY - gate.center.y) * gate.normal.y
      );

      return lateralDist <= gate.halfWidth;
    }

    return false;
  }
}
