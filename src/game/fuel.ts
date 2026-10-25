export interface FuelEvents {
  onFuelUpdate?: (fuelMs: number, ratio: number) => void;
  onLowFuel?: (fuelMs: number) => void;
  onEmpty?: () => void;
}

export class FuelSystem {
  private currentFuelMs: number;
  private readonly maxFuelMs: number;
  private readonly lowFuelFraction = 0.25;

  private wasLowFuel = false;
  private wasEmpty = false;

  private listeners: FuelEvents = {};

  constructor(initialFuelMs = 10000, maxFuelMs = 10000) {
    this.currentFuelMs = Math.max(0, initialFuelMs);
    this.maxFuelMs = maxFuelMs;

    this.wasLowFuel = this.isLowFuel();
    this.wasEmpty = this.currentFuelMs <= 0;
  }

  public setListeners(events: FuelEvents): void {
    this.listeners = { ...this.listeners, ...events };
  }

  public getFuelMs(): number {
    return this.currentFuelMs;
  }

  /**
   * Fuel bar's scale is max(tank_max_ms, currentFuel) so it never overflows 100%
   */
  public getRatio(): number {
    const scale = Math.max(this.maxFuelMs, this.currentFuelMs);
    return scale > 0 ? Math.max(0, Math.min(1, this.currentFuelMs / scale)) : 0;
  }

  public isEmpty(): boolean {
    return this.currentFuelMs <= 0;
  }

  /**
   * Low fuel check: below 25 percent or <= 3 s (3000 ms)
   */
  public isLowFuel(): boolean {
    return (this.getRatio() <= this.lowFuelFraction || this.currentFuelMs <= 3000) && !this.isEmpty();
  }

  /**
   * Adds exact fuel granted without clamping to tank_max_ms.
   * Full fuelGrantedMs is added to player's current fuel.
   */
  public addFuel(ms: number): void {
    this.currentFuelMs = Math.max(0, this.currentFuelMs + ms);
    const newRatio = this.getRatio();

    this.wasEmpty = this.currentFuelMs <= 0;
    this.wasLowFuel = this.isLowFuel();

    this.listeners.onFuelUpdate?.(this.currentFuelMs, newRatio);
  }

  public drainAll(): void {
    this.currentFuelMs = 0;
    this.wasEmpty = true;
    this.wasLowFuel = false;
    this.listeners.onFuelUpdate?.(0, 0);
    this.listeners.onEmpty?.();
  }

  public update(deltaMs: number, carSpeed: number): void {
    // Fuel drains only while moving above threshold (speed > 5 px/s) and never drops below 0
    if (this.currentFuelMs > 0 && carSpeed > 5) {
      this.currentFuelMs = Math.max(0, this.currentFuelMs - deltaMs);
    }

    const ratio = this.getRatio();
    this.listeners.onFuelUpdate?.(this.currentFuelMs, ratio);

    // Low Fuel Check (below 25% or <= 3 s)
    const isLow = this.isLowFuel();
    if (isLow && !this.wasLowFuel) {
      this.wasLowFuel = true;
      this.listeners.onLowFuel?.(this.currentFuelMs);
    } else if (!isLow && this.wasLowFuel) {
      this.wasLowFuel = false;
    }

    // Empty Check (0 ms)
    if (this.currentFuelMs <= 0 && !this.wasEmpty) {
      this.wasEmpty = true;
      console.log('[Fuel] Fuel tank empty - car stopped');
      this.listeners.onEmpty?.();
    }
  }
}
